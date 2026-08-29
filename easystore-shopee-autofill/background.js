"use strict";

importScripts("image-collector-helpers.js");

const imageCollector = globalThis.YouziImageCollectorHelpers;
const OPERATIONS_PRODUCTS_URL = `${imageCollector.OPERATIONS_ORIGIN}/play-card/portal.html#products`;
const COLLECTOR_FILES = ["image-collector-helpers.js", "supplier-collector.js"];
const IMAGE_FETCH_TIMEOUT_MS = 15_000;
const capturingWindowIds = new Set();

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

function bytesToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
function sniffImageMimeType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return "";
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

async function fetchPageImage(imageUrl, pageUrl) {
  const normalized = imageCollector.normalizeImageUrl(imageUrl, pageUrl);
  if (!normalized) throw new Error("這張網頁圖片無法直接讀取，將改用畫面截圖");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(normalized, {
      credentials: "include",
      cache: "no-store",
      referrer: imageCollector.isSupplierPageUrl(pageUrl) ? pageUrl : undefined,
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("圖片讀取逾時，將改用畫面截圖");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) throw new Error(`圖片讀取失敗（${response.status}）`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > imageCollector.MAX_IMAGE_BYTES) throw new Error("每張圖片不可超過 8 MB");
  const blob = await response.blob();
  if (!blob.size || blob.size > imageCollector.MAX_IMAGE_BYTES) throw new Error("每張圖片不可超過 8 MB");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mimeType = imageCollector.imageMimeType(blob.type || response.headers.get("content-type"))
    || sniffImageMimeType(bytes);
  if (!mimeType) throw new Error("只支援 JPG、PNG 或 WebP 圖片");
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
  if (!imageCollector.isCollectablePageUrl(pageUrl)) {
    return responseError("UNSUPPORTED_IMAGE_PAGE", "只能從一般網頁收圖");
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

  let image;
  try {
    image = message.type === imageCollector.CAPTURE_DATA_MESSAGE
      ? preparedSupplierImage(payload.image, pageUrl)
      : await fetchPageImage(payload.imageUrl, pageUrl);
  } catch (error) {
    const code = message.type === imageCollector.FETCH_MESSAGE ? "IMAGE_READ_FAILED" : "CAPTURE_DATA_INVALID";
    return responseError(code, error);
  }

  try {
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
    return responseError("DELIVERY_FAILED", error);
  }
}

function captureFailure(error) {
  const message = String(error && error.message ? error.message : error || "");
  if (/(?:<all_urls>|activeTab).*permission|required.*permission/i.test(message)) {
    return responseError("CAPTURE_PERMISSION_MISSING", "Chrome 尚未啟用完整截圖權限；請更新到助手 0.3.34，在擴充功能頁重新載入並允許存取所有網站。");
  }
  if (/(?:cannot access|restricted|chrome:\/\/|chrome web store|extensions gallery)/i.test(message)) {
    return responseError("CAPTURE_PAGE_RESTRICTED", "這是 Chrome 限制的特殊頁面，無法顯示頁內框選；請改在一般商品網頁，或用 Win+Shift+S 截圖後回商品頁貼上。");
  }
  if (/(?:MAX_CAPTURE|too many|rate limit|quota)/i.test(message)) {
    return responseError("CAPTURE_TOO_FAST", "截圖速度太快，請稍候一秒再試一次。");
  }
  return responseError("CAPTURE_FAILED", /[\u3400-\u9fff]/.test(message)
    ? message
    : "目前畫面暫時無法截取，請重新整理商品頁後再試一次。");
}

async function captureVisiblePageTab(sender) {
  const pageUrl = String((sender && sender.tab && sender.tab.url) || (sender && sender.url) || "");
  if (!imageCollector.isCollectablePageUrl(pageUrl)) {
    return responseError("UNSUPPORTED_IMAGE_PAGE", "這個頁面不支援框選截圖");
  }
  if (!sender.tab || !Number.isInteger(sender.tab.id) || !Number.isInteger(sender.tab.windowId)) {
    return responseError("IMAGE_PAGE_NOT_ACTIVE", "請先切回要截圖的網頁");
  }
  const activeTabs = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
  if (!activeTabs.some((tab) => tab.id === sender.tab.id)) {
    return responseError("IMAGE_PAGE_NOT_ACTIVE", "截圖前分頁已切換，請回到要截圖的商品頁再按一次。");
  }
  if (capturingWindowIds.has(sender.tab.windowId)) {
    return responseError("CAPTURE_BUSY", "上一張截圖仍在處理，請稍候一下。");
  }
  capturingWindowIds.add(sender.tab.windowId);
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
    if (!dataUrl || !dataUrl.startsWith("data:image/png;base64,")) throw new Error("無法取得目前畫面");
    return { ok: true, dataUrl };
  } catch (error) {
    return captureFailure(error);
  } finally {
    capturingWindowIds.delete(sender.tab.windowId);
  }
}

function isCollectorPageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (url.origin === imageCollector.OPERATIONS_ORIGIN && url.pathname.startsWith("/play-card/")) return false;
    if (url.hostname === "admin.easystore.co") return false;
    return true;
  } catch (error) {
    return false;
  }
}

async function collectorIsReady(tabId) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: imageCollector.COLLECTOR_PING_MESSAGE });
    return Boolean(result && result.ok);
  } catch (error) {
    return false;
  }
}

async function ensureCollectorInTab(tab) {
  if (!tab || !Number.isInteger(tab.id) || !isCollectorPageUrl(tab.url)) return false;
  if (await collectorIsReady(tab.id)) return true;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: COLLECTOR_FILES
    });
  } catch (error) {
    return false;
  }
  return collectorIsReady(tab.id);
}

async function installCollectorsInOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.allSettled(tabs.filter((tab) => isCollectorPageUrl(tab.url)).map(ensureCollectorInTab));
}

async function startCropInTab(tab) {
  if (!await ensureCollectorInTab(tab)) return;
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

if (imageCollector) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return false;
    if (message.type === imageCollector.BIND_OPERATIONS_TAB_MESSAGE) {
      bindOperationsTab(message, sender).then(sendResponse).catch((error) => sendResponse(responseError("BIND_FAILED", error)));
      return true;
    }
    if (message.type === imageCollector.CAPTURE_MESSAGE) {
      captureVisiblePageTab(sender).then(sendResponse).catch((error) => sendResponse(captureFailure(error)));
      return true;
    }
    if (![imageCollector.FETCH_MESSAGE, imageCollector.CAPTURE_DATA_MESSAGE].includes(message.type)) return false;
    collectImage(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse(responseError("DELIVERY_FAILED", error)));
    return true;
  });
  if (chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener(startCropInTab);
  }
  if (chrome.commands && chrome.commands.onCommand) {
    chrome.commands.onCommand.addListener(async (command) => {
      if (command !== "start-image-crop") return;
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      await startCropInTab(tabs[0]);
    });
  }
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[imageCollector.SESSION_STORAGE_KEY]) return;
      const validation = imageCollector.normalizeSessionPayload(changes[imageCollector.SESSION_STORAGE_KEY].newValue, Date.now());
      if (!validation.ok || !validation.value.active) return;
      installCollectorsInOpenTabs().catch(() => {});
    });
  }
}
