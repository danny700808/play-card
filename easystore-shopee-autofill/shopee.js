(function installYouziShopeeNativeDescription() {
  "use strict";

  const helpers = globalThis.YouziShopeeAutofillHelpers;
  const FETCH_IMAGES_MESSAGE = "YOUZI_SHOPEE_FETCH_DESCRIPTION_IMAGES_V1";
  const OVERLAY_ID = "youzi-shopee-native-description-overlay";
  const SELLER_PRODUCT_PATH = /^\/portal\/product\/([1-9]\d{5,29})\/?$/;
  const UPLOAD_TIMEOUT_MS = 45_000;

  if (!helpers || location.hostname !== "seller.shopee.tw") return;

  const queueStorage = chrome.storage && chrome.storage[helpers.QUEUE_STORAGE_AREA];
  if (!queueStorage) return;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizedText(value) {
    return String(value == null ? "" : value).replace(/[\s\u00a0]+/g, "").trim();
  }

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function currentItemId() {
    const match = location.pathname.match(SELLER_PRODUCT_PATH);
    return match ? match[1] : "";
  }

  function fieldContainerForLabel(labelText) {
    const wanted = normalizedText(labelText);
    const label = Array.from(document.querySelectorAll("label, span, div"))
      .filter(visible)
      .find((element) => normalizedText(element.textContent) === wanted);
    if (!label) return null;
    let container = label.parentElement;
    for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
      if (container.querySelector("input")) return container;
    }
    return null;
  }

  function visibleSellerSku() {
    const container = fieldContainerForLabel("主商品貨號");
    const input = container && Array.from(container.querySelectorAll("input")).find(visible);
    return String(input && input.value || "").trim();
  }

  function readQueue() {
    return new Promise((resolve, reject) => {
      queueStorage.get(helpers.QUEUE_STORAGE_KEY, (stored) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(stored && stored[helpers.QUEUE_STORAGE_KEY] || {});
      });
    });
  }

  async function matchingRecord() {
    const itemId = currentItemId();
    if (!itemId) return null;
    const queue = await readQueue();
    const sku = visibleSellerSku();
    const candidates = [];
    Object.values(queue).forEach((record) => {
      const validation = helpers.validateQueuePayload(record && record.payload, Date.now());
      if (!validation.ok) return;
      const payload = validation.value;
      const ids = payload.listingPolicy && payload.listingPolicy.platformListingIds || [];
      const idMatch = ids.includes(itemId);
      const skuMatch = sku && payload.sku === sku;
      if (idMatch || skuMatch) candidates.push(Object.assign({}, record, { payload }));
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function editorParts() {
    const editor = Array.from(document.querySelectorAll(".ql-editor[contenteditable='true']")).find(visible) || null;
    let root = editor;
    let fileInput = null;
    for (let depth = 0; root && depth < 9 && !fileInput; depth += 1, root = root.parentElement) {
      const candidates = Array.from(root.querySelectorAll("input[type='file'][multiple]"));
      fileInput = candidates.find((input) => input.matches(".file-upload, .eds-upload__input"))
        || (candidates.length === 1 ? candidates[0] : null);
    }
    return { editor, root, fileInput };
  }

  async function waitForEditor(timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const parts = editorParts();
      if (parts.editor && parts.fileInput) return parts;
      await sleep(180);
    }
    return editorParts();
  }

  function editorPlainText(plan) {
    const blocks = new Map(plan.textBlocks.map((row) => [row.key, row.text]));
    return ["features", "specifications", "usage", "actual-product-notice", "warranty-support-notice"]
      .map((key) => blocks.get(key) || "")
      .filter(Boolean)
      .join("\n\n");
  }

  function replaceEditorText(editor, text) {
    editor.focus();
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand("insertText", false, text)) {
      editor.textContent = text;
    }
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setCaretAfterText(editor, text, searchFrom) {
    const fullText = editor.textContent || "";
    const start = fullText.indexOf(text, Math.max(0, searchFrom || 0));
    if (start < 0) throw new Error("找不到預定的文字插圖位置");
    const targetOffset = start + text.length;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let consumed = 0;
    let node = walker.nextNode();
    while (node) {
      const length = node.nodeValue.length;
      if (consumed + length >= targetOffset) {
        const range = document.createRange();
        range.setStart(node, Math.max(0, targetOffset - consumed));
        range.collapse(true);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        editor.focus();
        return targetOffset;
      }
      consumed += length;
      node = walker.nextNode();
    }
    throw new Error("無法定位預定的文字插圖位置");
  }

  function base64Bytes(value) {
    const binary = atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function preparedFile(image, index) {
    const extension = image.mimeType === "image/png" ? "png" : image.mimeType === "image/webp" ? "webp" : "jpg";
    const fileName = `${String(index + 1).padStart(2, "0")}-${String(image.fileName || `detail.${extension}`)
      .replace(/[^A-Za-z0-9._-]+/g, "-")}`;
    return new File([base64Bytes(image.base64)], fileName, { type: image.mimeType, lastModified: Date.now() });
  }

  function imageGroups(plan) {
    const groups = [];
    let boundaryKey = "";
    plan.blockPlan.forEach((row) => {
      if (row.type === "text") {
        boundaryKey = row.key;
        return;
      }
      let group = groups[groups.length - 1];
      if (!group || group.boundaryKey !== boundaryKey) {
        group = { boundaryKey, rows: [] };
        groups.push(group);
      }
      group.rows.push(row);
    });
    return groups;
  }

  function successfulNativeImages(editor) {
    return Array.from(editor.querySelectorAll("img")).filter((image) =>
      image.getAttribute("data-upload-status") === "success"
      && /^https:\/\/(?:cf\.shopee\.tw|s-cf-tw\.shopeesz\.com)\/file\//i.test(image.src)
    );
  }

  async function waitForNativeImageCount(editor, expected) {
    const started = Date.now();
    while (Date.now() - started < UPLOAD_TIMEOUT_MS) {
      const all = Array.from(editor.querySelectorAll("img"));
      const uploaded = successfulNativeImages(editor);
      if (all.length === expected && uploaded.length === expected) return uploaded;
      const failed = all.find((image) => image.getAttribute("data-upload-status") === "fail");
      if (failed) throw new Error("蝦皮回報其中一張詳細圖上傳失敗");
      await sleep(250);
    }
    throw new Error(`蝦皮詳細圖等待逾時（目前 ${successfulNativeImages(editor).length}／應有 ${expected} 張）`);
  }

  async function uploadFileGroup(parts, files, expectedCount) {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    parts.fileInput.files = transfer.files;
    parts.fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await waitForNativeImageCount(parts.editor, expectedCount);
    parts.fileInput.value = "";
  }

  function fetchPreparedImages(plan) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: FETCH_IMAGES_MESSAGE,
        urls: plan.imageUrls
      }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!response || response.ok !== true) reject(new Error(response && response.error || "圖片暫存失敗"));
        else resolve(response.images || []);
      });
    });
  }

  function verifyInterleavedEditor(editor, plan) {
    const text = editor.textContent || "";
    let offset = -1;
    for (const block of plan.textBlocks) {
      const next = text.indexOf(block.text, offset + 1);
      if (next < 0) return { ok: false, reason: `缺少文字區塊：${block.key}` };
      offset = next;
    }
    const images = successfulNativeImages(editor);
    if (images.length !== plan.expectedImageCount) {
      return { ok: false, reason: `圖片數量不符（${images.length}／${plan.expectedImageCount}）` };
    }
    const closing = plan.blockPlan.slice(-3).map((row) => row.key).join("|");
    if (closing !== "warranty-support-notice|description-promo-1|description-promo-2") {
      return { ok: false, reason: "固定保固結尾與最後兩張圖片順序不正確" };
    }
    const imageToken = "\u0000YOUZI_NATIVE_IMAGE\u0000";
    const expectedSequence = plan.blockPlan.map((row) => row.type === "image"
      ? imageToken : normalizedText(plan.textBlocks.find((block) => block.key === row.key).text)).join("");
    let actualSequence = "";
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "IMG") return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) actualSequence += normalizedText(node.nodeValue);
      else if (node.tagName === "IMG") actualSequence += imageToken;
      node = walker.nextNode();
    }
    if (actualSequence !== expectedSequence) {
      return { ok: false, reason: "蝦皮編輯器的實際圖文交錯順序與 V3 計畫不一致" };
    }
    return { ok: true, imageCount: images.length };
  }

  function exactButton(label) {
    return Array.from(document.querySelectorAll("button, [role='button']"))
      .filter(visible)
      .find((element) => String(element.textContent || "").trim() === label
        && !element.matches(":disabled, [disabled], [aria-disabled='true']")) || null;
  }

  async function waitForUpdateResult() {
    const started = Date.now();
    while (Date.now() - started < 12_000) {
      const text = String(document.body && document.body.innerText || "");
      if (/錯誤。請稍後再試|更新失敗|儲存失敗/.test(text)) throw new Error("蝦皮更新失敗，已保留工作資料供重試");
      if (/更新成功|儲存成功|商品已更新/.test(text)) return true;
      await sleep(250);
    }
    return false;
  }

  function consumeRecord(payload) {
    return new Promise((resolve, reject) => {
      queueStorage.get(helpers.QUEUE_STORAGE_KEY, (stored) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const queue = stored && stored[helpers.QUEUE_STORAGE_KEY] || {};
        const record = queue[payload.easyStoreProductId];
        if (!record || !record.payload || record.payload.nonce !== payload.nonce) {
          resolve(false);
          return;
        }
        const next = Object.assign({}, queue);
        delete next[payload.easyStoreProductId];
        const done = () => chrome.runtime.lastError
          ? reject(new Error(chrome.runtime.lastError.message)) : resolve(true);
        if (Object.keys(next).length) queueStorage.set({ [helpers.QUEUE_STORAGE_KEY]: next }, done);
        else queueStorage.remove(helpers.QUEUE_STORAGE_KEY, done);
      });
    });
  }

  function append(parent, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function mountOverlay(record) {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
    const overlay = document.createElement("section");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483646;width:360px;padding:16px;border-radius:12px;background:#fff;color:#222;box-shadow:0 8px 30px rgba(0,0,0,.25);font:14px/1.5 Arial,sans-serif";
    append(overlay, "strong", "", "柚子樂器－蝦皮原生圖文");
    append(overlay, "div", "", `${record.payload.title || "待處理商品"}\nSKU：${record.payload.sku}`);
    const status = append(overlay, "div", "", "已找到對應商品，尚未修改詳細介紹。");
    status.style.cssText = "margin:10px 0;white-space:pre-wrap";
    const start = append(overlay, "button", "", "自動套用圖文並更新");
    start.type = "button";
    start.style.cssText = "border:0;border-radius:8px;padding:9px 12px;background:#ee4d2d;color:#fff;cursor:pointer";
    document.documentElement.appendChild(overlay);

    async function run() {
      start.disabled = true;
      const plan = record.payload.advancedDescription;
      let preparedImages = [];
      try {
        status.textContent = "正在準備文字區塊與記憶體圖片……";
        const parts = await waitForEditor(12_000);
        if (!parts.editor || !parts.fileInput) throw new Error("找不到蝦皮詳細介紹的原生圖片上傳欄位");
        preparedImages = await fetchPreparedImages(plan);
        if (preparedImages.length !== plan.expectedImageCount) throw new Error("記憶體圖片數量不完整");
        replaceEditorText(parts.editor, editorPlainText(plan));
        await sleep(500);
        if (parts.editor.querySelectorAll("img").length) throw new Error("舊詳細圖沒有被完整清除，已停止避免重複");
        const textByKey = new Map(plan.textBlocks.map((row) => [row.key, row.text]));
        const imageIndex = new Map(plan.imageUrls.map((url, index) => [url, index]));
        let uploadedCount = 0;
        let searchFrom = 0;
        for (const group of imageGroups(plan)) {
          const boundaryText = textByKey.get(group.boundaryKey);
          if (!boundaryText) throw new Error(`缺少插圖文字邊界：${group.boundaryKey}`);
          searchFrom = setCaretAfterText(parts.editor, boundaryText, searchFrom);
          const files = group.rows.map((row) => preparedFile(
            preparedImages[imageIndex.get(row.imageUrl)],
            imageIndex.get(row.imageUrl)
          ));
          uploadedCount += files.length;
          status.textContent = `正在由蝦皮原生上傳器處理圖片 ${uploadedCount}／${plan.expectedImageCount}……`;
          await uploadFileGroup(parts, files, uploadedCount);
        }
        const evidence = verifyInterleavedEditor(parts.editor, plan);
        if (!evidence.ok) throw new Error(evidence.reason);
        preparedImages.length = 0;
        status.textContent = `圖文已完成：${evidence.imageCount} 張圖片，全程未寫入桌面。`;
        if (record.payload.publishMode === "fill-only") {
          start.textContent = "已填入，請人工更新";
          return;
        }
        const update = exactButton("更新");
        if (!update) throw new Error("找不到可按的蝦皮更新按鈕");
        status.textContent = "圖文核對完成，正在更新同一個蝦皮商品……";
        update.click();
        const confirmed = await waitForUpdateResult();
        if (!confirmed) throw new Error("蝦皮沒有回傳明確的更新成功訊息，已保留工作資料");
        await consumeRecord(record.payload);
        status.textContent = "蝦皮圖文已更新成功；記憶體圖片已清除，桌面沒有新增檔案。";
        start.textContent = "已完成";
      } catch (error) {
        preparedImages.length = 0;
        status.textContent = `已停止：${error.message}\n未刪除任何使用者檔案；需要時可改用人工 ZIP 上傳。`;
        start.disabled = false;
        start.textContent = "重新嘗試原生圖文上傳";
      }
    }

    start.addEventListener("click", run);
    if (["auto", "add-variant-to-existing"].includes(record.payload.publishMode)) {
      setTimeout(() => {
        if (overlay.isConnected && !start.disabled) start.click();
      }, 900);
    }
  }

  async function initialize() {
    const started = Date.now();
    let record = null;
    while (!record && Date.now() - started < 15_000) {
      record = await matchingRecord();
      if (!record) await sleep(300);
    }
    if (record) mountOverlay(record);
  }

  initialize().catch(() => {});
})();
