"use strict";

importScripts("image-collector-helpers.js");

const imageCollector = globalThis.YouziImageCollectorHelpers;
const SUPPLIER_CROP_MENU_ID = "youzi-supplier-image-crop";
const PERSISTENT_CAPTURE_PERMISSION = { origins: ["<all_urls>"] };
const OPERATIONS_PRODUCTS_URL = `${imageCollector.OPERATIONS_ORIGIN}/play-card/portal.html#products`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseError(code, error) {
  return {
    ok: false,
    code,
    error: String(error && error.message ? error.message : error || "圖片收集失敗").slice(0, 300)
  };
}

function captureNeedsExplicitGesture(error) {
  const message = String(error && error.message ? error.message : error || "");
  return /(?:<all_urls>|activeTab).*permission|permission.*(?:<all_urls>|activeTab)|Either the .* permission is required/i.test(message);
}

async function requestPersistentCapturePermission() {
  if (!chrome.permissions || !chrome.permissions.request) return false;
  try {
    return await chrome.permissions.request(PERSISTENT_CAPTURE_PERMISSION) === true;
  } catch (error) {
    return false;
  }
}

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function currentSession() {
  const stored = await chrome.storage.local.get(imageCollector.SESSION_STORAGE_KEY);
  const validation = imageCollector.normalizeSessionPayload(
    stored && stored[imageCollector.SESSION_STORAGE_KEY],
    Date.now()
  );
  if (!validation.ok) return null;
  return validation.value;
}

async function storeSession(session) {
  await chrome.storage.local.set({
    [imageCollector.SESSION_STORAGE_KEY]: session
  });
}

async function fetchSupplierImage(imageUrl, pageUrl) {
  const normalized = imageCollector.normalizeImageUrl(imageUrl, pageUrl);
  if (!normalized) throw new Error("這張圖片不是淘寶、天貓、1688 或阿里巴巴可讀取的圖片");
  const response = await fetch(normalized, {
    credentials: "include",
    cache: "no-store",
    referrer: imageCollector.isSupplierPageUrl(pageUrl) ? pageUrl : undefined
  });
  if (!response.ok) throw new Error(`圖片讀取失敗（${response.status}）`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > imageCollector.MAX_IMAGE_BYTES) throw new Error("每張圖片不可超過 8 MB");
  const blob = await response.blob();
  const mimeType = imageCollector.imageMimeType(blob.type || response.headers.get("content-type"));
  if (!mimeType) throw new Error("只支援 JPG、PNG 或 WebP 圖片");
  if (!blob.size || blob.size > imageCollector.MAX_IMAGE_BYTES) throw new Error("每張圖片不可超過 8 MB");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    sourceUrl: normalized,
    mimeType,
    fileName: imageCollector.safeImageFileName(normalized, mimeType),
    base64: bytesToBase64(bytes),
    size: blob.size
  };
}

function preparedSupplierImage(value, pageUrl) {
  const row = value && typeof value === "object" ? value : {};
  const mimeType = imageCollector.imageMimeType(row.mimeType);
  const base64 = String(row.base64 || "").replace(/\s+/g, "");
  if (!mimeType || !base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error("截圖格式不正確，請重新框選");
  }
  const padding = (base64.match(/=*$/) || [""])[0].length;
  const size = Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
  if (!size || size > imageCollector.MAX_IMAGE_BYTES) throw new Error("每張截圖不可超過 8 MB");
  return {
    sourceUrl: pageUrl,
    mimeType,
    fileName: String(row.fileName || `supplier-screenshot-${Date.now()}.${imageCollector.imageFileExtension(mimeType)}`)
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .slice(0, 120),
    base64,
    size
  };
}

async function deliverToOperations(payload, session) {
  let tabs = [];
  if (session && Number.isInteger(session.operationsTabId) && session.operationsTabId > 0) {
    try {
      const owner = await chrome.tabs.get(session.operationsTabId);
      if (owner) tabs = [owner];
    } catch (error) {}
  }
  if (!tabs.length) tabs = await chrome.tabs.query({
    url: [
      "https://danny700808.github.io/play-card/portal.html*",
      "https://danny700808.github.io/play-card/operations-hub.html*"
    ]
  });
  if (!tabs.length) {
    const restored = await chrome.tabs.create({ url: OPERATIONS_PRODUCTS_URL, active: false });
    if (restored && Number.isInteger(restored.id)) tabs = [restored];
  }
  if (!tabs.length) throw new Error("找不到營運中心，請重新開啟商品的「準備上架」頁");
  let lastError = null;
  for (const tab of tabs) {
    if (!Number.isInteger(tab.id)) continue;
    for (const delay of [0, 500, 1000, 2000, 3000]) {
      if (delay) await wait(delay);
      try {
        const result = await chrome.tabs.sendMessage(tab.id, {
          type: imageCollector.DELIVER_MESSAGE,
          payload
        });
        if (result && result.ok) return result;
        const message = String(result && result.error ? result.error : "商品上架頁尚未準備好收圖");
        lastError = new Error(message);
        if (!/(?:尚未準備|目前沒有啟動|請保留原本|目前收圖商品已經更換)/.test(message)) break;
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError || new Error("找不到正在收圖的商品上架頁");
}

async function collectImage(message, sender) {
  const pageUrl = String((sender && sender.tab && sender.tab.url) || (sender && sender.url) || "");
  if (!imageCollector.isSupplierPageUrl(pageUrl)) {
    return responseError("UNTRUSTED_SUPPLIER_PAGE", "只能從淘寶、天貓、1688 或阿里巴巴頁面收圖");
  }
  const payload = message && message.payload && typeof message.payload === "object" ? message.payload : {};
  const session = await currentSession();
  if (!session || !session.active) return responseError("NO_ACTIVE_SESSION", "請先在準備上架商品按「開始收圖」");
  if (payload.sessionId !== session.sessionId || payload.productId !== session.productId) {
    return responseError("SESSION_MISMATCH", "目前收圖商品已經更換，請重新確認商品");
  }
  if (session.currentCount >= session.maxImages) {
    return responseError("IMAGE_LIMIT_REACHED", `這件商品已收滿 ${session.maxImages} 張`);
  }

  try {
    const image = message.type === imageCollector.CAPTURE_DATA_MESSAGE
      ? preparedSupplierImage(payload.image, pageUrl)
      : await fetchSupplierImage(payload.imageUrl, pageUrl);
    const requestId = crypto.randomUUID();
    const result = await deliverToOperations({
      requestId,
      sessionId: session.sessionId,
      productId: session.productId,
      sku: session.sku,
      image
    }, session);
    const currentCount = Math.min(
      session.maxImages,
      Math.max(session.currentCount + 1, Number(result.count || 0))
    );
    const next = Object.assign({}, session, {
      currentCount,
      active: currentCount < session.maxImages,
      stoppedReason: currentCount >= session.maxImages ? "full" : ""
    });
    await storeSession(next);
    return {
      ok: true,
      code: currentCount >= session.maxImages ? "COLLECTED_AND_FULL" : "COLLECTED",
      count: currentCount,
      maxImages: session.maxImages,
      sourceUrl: image.sourceUrl
    };
  } catch (error) {
    return responseError("COLLECTION_FAILED", error);
  }
}

async function captureVisibleSupplierTab(sender) {
  const pageUrl = String((sender && sender.tab && sender.tab.url) || (sender && sender.url) || "");
  if (!imageCollector.isSupplierPageUrl(pageUrl)) {
    return responseError("UNTRUSTED_SUPPLIER_PAGE", "只能在淘寶、天貓、1688 或阿里巴巴頁面框選截圖");
  }
  if (!sender.tab || sender.tab.active !== true || !Number.isInteger(sender.tab.windowId)) {
    return responseError("SUPPLIER_TAB_NOT_ACTIVE", "請先切回要截圖的供應商頁面");
  }
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
    if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) throw new Error("無法取得目前畫面");
    return { ok: true, dataUrl };
  } catch (error) {
    if (captureNeedsExplicitGesture(error)) {
      return responseError(
        "CAPTURE_USER_GESTURE_REQUIRED",
        "第一次請在頁面按右鍵選「柚子掌櫃：框選截圖」並同意快速截圖；之後可直接點綠框"
      );
    }
    return responseError("CAPTURE_FAILED", error);
  }
}

async function startCropInTab(tab) {
  if (!tab || !Number.isInteger(tab.id) || !imageCollector.isSupplierPageUrl(tab.url || "")) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: imageCollector.START_CROP_MESSAGE });
  } catch (error) {}
}

async function bindOperationsTab(message, sender) {
  const pageUrl = String((sender && sender.tab && sender.tab.url) || (sender && sender.url) || "");
  const payload = message && message.payload && typeof message.payload === "object" ? message.payload : {};
  if (!pageUrl.startsWith(`${imageCollector.OPERATIONS_ORIGIN}/play-card/`) || !sender.tab || !Number.isInteger(sender.tab.id)) {
    return responseError("UNTRUSTED_OPERATIONS_PAGE", "只能由全通路營運中心綁定收圖頁面");
  }
  const session = await currentSession();
  if (!session || session.sessionId !== payload.sessionId || session.productId !== payload.productId) {
    return responseError("SESSION_MISMATCH", "目前收圖商品已經更換");
  }
  const next = Object.assign({}, session, { operationsTabId: sender.tab.id });
  await storeSession(next);
  return { ok: true, operationsTabId: sender.tab.id };
}

function ensureContextMenu() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.remove(SUPPLIER_CROP_MENU_ID, () => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: SUPPLIER_CROP_MENU_ID,
      title: "柚子掌櫃：框選截圖",
      contexts: ["page", "image"],
      documentUrlPatterns: [
        "https://*.taobao.com/*", "https://*.tmall.com/*",
        "https://*.1688.com/*", "https://*.alibaba.com/*"
      ]
    }, () => { void chrome.runtime.lastError; });
  });
}

if (imageCollector) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return false;
    if (message.type === imageCollector.BIND_OPERATIONS_TAB_MESSAGE) {
      bindOperationsTab(message, sender).then(sendResponse).catch((error) => sendResponse(responseError("BIND_FAILED", error)));
      return true;
    }
    if (message.type === imageCollector.CAPTURE_MESSAGE) {
      captureVisibleSupplierTab(sender).then(sendResponse).catch((error) => sendResponse(responseError("CAPTURE_FAILED", error)));
      return true;
    }
    if (![imageCollector.FETCH_MESSAGE, imageCollector.CAPTURE_DATA_MESSAGE].includes(message.type)) return false;
    collectImage(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse(responseError("COLLECTION_FAILED", error)));
    return true;
  });
  if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener(startCropInTab);
  }
  if (chrome.runtime.onInstalled && chrome.contextMenus) {
    chrome.runtime.onInstalled.addListener(ensureContextMenu);
  }
  if (chrome.runtime.onStartup && chrome.contextMenus) {
    chrome.runtime.onStartup.addListener(ensureContextMenu);
  }
  if (chrome.contextMenus && chrome.contextMenus.onClicked) {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
      if (info.menuItemId === SUPPLIER_CROP_MENU_ID) {
        await requestPersistentCapturePermission();
        await startCropInTab(tab);
      }
    });
  }
  if (chrome.commands && chrome.commands.onCommand) {
    chrome.commands.onCommand.addListener(async (command) => {
      if (command !== "start-image-crop") return;
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      await startCropInTab(tabs[0]);
    });
  }
  ensureContextMenu();
}
