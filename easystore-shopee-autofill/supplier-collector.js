(function installYouziSupplierImageCollector() {
  "use strict";

  const helpers = globalThis.YouziImageCollectorHelpers;
  if (!helpers || !helpers.isSupplierPageUrl(location.href)) return;

  let session = null;
  let hoveredElement = null;
  let sending = false;
  let directPickEnabled = false;
  let cropOverlay = null;
  const queue = [];
  const queuedUrls = new Set();
  const collectedUrls = new Set();

  const style = document.createElement("style");
  style.textContent = `
    .youzi-image-collector-hover {
      outline: 4px solid #16a36f !important;
      outline-offset: -4px !important;
      cursor: copy !important;
    }
    .youzi-image-collector-collected {
      outline: 4px solid #118755 !important;
      outline-offset: -4px !important;
      filter: saturate(.8) brightness(.95);
    }
    #youziImageCollectorPanel {
      position: fixed;
      z-index: 2147483646;
      top: 14px;
      right: 14px;
      width: min(350px, calc(100vw - 28px));
      padding: 14px;
      border: 2px solid #16845f;
      border-radius: 14px;
      background: #fff;
      color: #173247;
      box-shadow: 0 12px 36px rgba(0,0,0,.24);
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Microsoft JhengHei", sans-serif;
    }
    #youziImageCollectorPanel[hidden] { display: none !important; }
    #youziImageCollectorPanel b { display: block; font-size: 16px; margin-bottom: 4px; }
    #youziImageCollectorPanel .youzi-product { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #youziImageCollectorPanel .youzi-progress { color: #16845f; font-weight: 800; }
    #youziImageCollectorPanel .youzi-help { color: #667985; margin-top: 7px; }
    #youziImageCollectorPanel .youzi-status { margin-top: 8px; min-height: 20px; }
    #youziImageCollectorPanel .youzi-error { color: #c9463f; }
    #youziImageCollectorPanel .youzi-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 10px; }
    #youziImageCollectorPanel .youzi-shortcut { grid-column: 1 / -1; padding: 9px 11px; border-radius: 9px; background: #e9f5ef; color: #17684e; font-weight: 800; }
    #youziImageCollectorPanel .youzi-shortcut small { display: block; margin-top: 2px; color: #4d6d61; font-weight: 600; }
    #youziImageCollectorPanel button {
      min-height: 40px; padding: 8px 10px; border: 0; border-radius: 9px;
      background: #173247; color: #fff; font-weight: 800; cursor: pointer;
    }
    #youziImageCollectorPanel button[data-youzi-direct] { background: #e9f5ef; color: #17684e; }
    #youziImageCropOverlay {
      position: fixed; z-index: 2147483647; inset: 0; cursor: crosshair;
      background: rgba(8,26,38,.12); user-select: none; touch-action: none;
    }
    #youziImageCropOverlay .youzi-crop-help {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      padding: 10px 16px; border-radius: 999px; background: #173247; color: #fff;
      box-shadow: 0 8px 24px rgba(0,0,0,.25); font: 800 14px/1.4 "Microsoft JhengHei", sans-serif;
    }
    #youziImageCropOverlay .youzi-crop-selection {
      position: fixed; display: none; border: 3px solid #12a66d;
      background: rgba(18,166,109,.12); box-shadow: 0 0 0 9999px rgba(8,26,38,.34);
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  const panel = document.createElement("aside");
  panel.id = "youziImageCollectorPanel";
  panel.hidden = true;
  panel.innerHTML = `
    <b>柚子掌櫃收圖中</b>
    <div class="youzi-product" data-youzi-product></div>
    <div class="youzi-progress" data-youzi-progress></div>
    <div class="youzi-help">用滑鼠框出你真正要的畫面，放開後會自動加入商品。</div>
    <div class="youzi-status" data-youzi-status></div>
    <div class="youzi-actions">
      <div class="youzi-shortcut">頁面按右鍵 →「柚子掌櫃：框選截圖」<small>也可按 Ctrl＋Shift＋Y；Windows 截圖後可按 Ctrl＋V</small></div>
      <button type="button" data-youzi-direct>原圖點選：關閉</button>
      <button type="button" data-youzi-stop>結束收圖（Esc）</button>
    </div>
  `;
  (document.body || document.documentElement).appendChild(panel);

  const productText = panel.querySelector("[data-youzi-product]");
  const progressText = panel.querySelector("[data-youzi-progress]");
  const statusText = panel.querySelector("[data-youzi-status]");
  const directButton = panel.querySelector("[data-youzi-direct]");

  function setStatus(message, isError) {
    statusText.textContent = message || "";
    statusText.classList.toggle("youzi-error", Boolean(isError));
  }

  function updatePanel() {
    if (!session) {
      panel.hidden = true;
      setStatus("");
      return;
    }
    panel.hidden = Boolean(cropOverlay);
    productText.textContent = `${session.sku}｜${session.title || "準備上架商品"}`;
    progressText.textContent = `已加入 ${session.currentCount}／${session.maxImages} 張`;
    directButton.textContent = `原圖點選：${directPickEnabled ? "開啟" : "關閉"}`;
    if (!session.active && session.stoppedReason === "full") {
      setStatus(`已收滿 ${session.maxImages} 張，收圖模式已自動結束。`);
    } else if (!sending) {
      setStatus(directPickEnabled ? "原圖點選已開啟；綠框出現後再點圖片。" : "等待你框選截圖");
    }
  }

  function clearHover() {
    if (hoveredElement && !hoveredElement.classList.contains("youzi-image-collector-collected")) {
      hoveredElement.classList.remove("youzi-image-collector-hover");
    }
    hoveredElement = null;
  }

  function imageCandidateAt(target) {
    if (!(target instanceof Element) || target.closest("#youziImageCollectorPanel")) return null;
    let element = target;
    for (let depth = 0; element && depth < 5; depth += 1, element = element.parentElement) {
      const image = element.tagName === "IMG" ? element : element.querySelector && element.querySelector(":scope > img");
      if (image) {
        const candidates = [
          image.getAttribute("data-original"), image.getAttribute("data-ks-lazyload"),
          image.getAttribute("data-lazy-src"), image.getAttribute("data-src"),
          image.getAttribute("data-zoom-image"), image.getAttribute("srcset"),
          image.currentSrc, image.getAttribute("src")
        ];
        const url = helpers.chooseImageUrl(candidates, location.href);
        if (url) return { element: image, url };
      }
      const background = getComputedStyle(element).backgroundImage || "";
      const match = background.match(/url\(["']?([^"')]+)["']?\)/i);
      if (match) {
        const url = helpers.normalizeImageUrl(match[1], location.href);
        if (url) return { element, url };
      }
    }
    return null;
  }

  function applyCollectionResult(result) {
    session = Object.assign({}, session, {
      currentCount: Number(result.count || session.currentCount + 1),
      active: result.code !== "COLLECTED_AND_FULL",
      stoppedReason: result.code === "COLLECTED_AND_FULL" ? "full" : ""
    });
    setStatus(`已加入第 ${session.currentCount} 張`);
    updatePanel();
  }

  async function sendPreparedImage(image) {
    if (sending || !session || !session.active) return;
    sending = true;
    setStatus("正在送到準備上架商品…");
    try {
      const result = await chrome.runtime.sendMessage({
        type: helpers.CAPTURE_DATA_MESSAGE,
        payload: { sessionId: session.sessionId, productId: session.productId, image }
      });
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : "截圖傳送失敗");
      applyCollectionResult(result);
    } catch (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    } finally {
      sending = false;
      updatePanel();
    }
  }

  async function processQueue() {
    if (sending || !session || !session.active) return;
    const next = queue.shift();
    if (!next) return updatePanel();
    sending = true;
    setStatus("正在送到準備上架商品…");
    try {
      const result = await chrome.runtime.sendMessage({
        type: helpers.FETCH_MESSAGE,
        payload: { sessionId: session.sessionId, productId: session.productId, imageUrl: next.url }
      });
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : "圖片傳送失敗");
      collectedUrls.add(next.url);
      next.element.classList.remove("youzi-image-collector-hover");
      next.element.classList.add("youzi-image-collector-collected");
      applyCollectionResult(result);
    } catch (error) {
      queuedUrls.delete(next.url);
      next.element.classList.remove("youzi-image-collector-hover");
      setStatus(String(error && error.message ? error.message : error), true);
    } finally {
      sending = false;
      if (session && session.active) processQueue();
    }
  }

  function blobToImage(blob, prefix) {
    if (!blob || !helpers.imageMimeType(blob.type)) throw new Error("只支援 JPG、PNG 或 WebP 圖片");
    if (!blob.size || blob.size > helpers.MAX_IMAGE_BYTES) throw new Error("每張截圖不可超過 8 MB");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("無法讀取截圖"));
      reader.onload = () => {
        const value = String(reader.result || ""), marker = ";base64,";
        const at = value.indexOf(marker);
        if (at < 0) return reject(new Error("截圖格式不正確"));
        resolve({
          mimeType: helpers.imageMimeType(blob.type),
          fileName: `${prefix || "supplier-screenshot"}-${Date.now()}.${helpers.imageFileExtension(blob.type)}`,
          base64: value.slice(at + marker.length),
          size: blob.size
        });
      };
      reader.readAsDataURL(blob);
    });
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function cropVisibleCapture(dataUrl, rect) {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("無法讀取目前畫面"));
      image.src = dataUrl;
    });
    const scaleX = image.naturalWidth / Math.max(1, window.innerWidth);
    const scaleY = image.naturalHeight / Math.max(1, window.innerHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width * scaleX));
    canvas.height = Math.max(1, Math.round(rect.height * scaleY));
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(
      image,
      Math.round(rect.left * scaleX), Math.round(rect.top * scaleY), canvas.width, canvas.height,
      0, 0, canvas.width, canvas.height
    );
    let blob = await canvasBlob(canvas, "image/png");
    if (blob && blob.size > helpers.MAX_IMAGE_BYTES) blob = await canvasBlob(canvas, "image/jpeg", .94);
    return blobToImage(blob, "supplier-crop");
  }

  async function captureSelection(rect) {
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = await chrome.runtime.sendMessage({ type: helpers.CAPTURE_MESSAGE });
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : "無法截取目前畫面");
      await sendPreparedImage(await cropVisibleCapture(result.dataUrl, rect));
    } catch (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    } finally {
      updatePanel();
    }
  }

  function cancelCrop() {
    if (cropOverlay) cropOverlay.remove();
    cropOverlay = null;
    updatePanel();
  }

  function beginCrop() {
    if (!session || !session.active || sending || cropOverlay) return;
    clearHover();
    cropOverlay = document.createElement("div");
    cropOverlay.id = "youziImageCropOverlay";
    cropOverlay.innerHTML = '<div class="youzi-crop-help">按住滑鼠拖曳框選；Esc 取消</div><div class="youzi-crop-selection"></div>';
    document.documentElement.appendChild(cropOverlay);
    const selection = cropOverlay.querySelector(".youzi-crop-selection");
    let start = null;
    cropOverlay.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      selection.style.display = "block";
      selection.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    cropOverlay.addEventListener("pointermove", (event) => {
      if (!start) return;
      const left = Math.min(start.x, event.clientX), top = Math.min(start.y, event.clientY);
      selection.style.left = `${left}px`;
      selection.style.top = `${top}px`;
      selection.style.width = `${Math.abs(event.clientX - start.x)}px`;
      selection.style.height = `${Math.abs(event.clientY - start.y)}px`;
    });
    cropOverlay.addEventListener("pointerup", (event) => {
      if (!start) return cancelCrop();
      const rect = {
        left: Math.max(0, Math.min(start.x, event.clientX)),
        top: Math.max(0, Math.min(start.y, event.clientY)),
        width: Math.min(window.innerWidth, Math.abs(event.clientX - start.x)),
        height: Math.min(window.innerHeight, Math.abs(event.clientY - start.y))
      };
      cancelCrop();
      if (rect.width < 20 || rect.height < 20) return setStatus("框選範圍太小，請重新框選", true);
      panel.hidden = true;
      captureSelection(rect);
    });
    updatePanel();
  }

  async function stopSession() {
    cancelCrop();
    clearHover();
    queue.splice(0);
    queuedUrls.clear();
    await chrome.storage.local.remove(helpers.SESSION_STORAGE_KEY);
  }

  document.addEventListener("mousemove", (event) => {
    if (!directPickEnabled || !session || !session.active) return clearHover();
    const candidate = imageCandidateAt(event.target);
    if (!candidate || collectedUrls.has(candidate.url)) return clearHover();
    if (hoveredElement !== candidate.element) {
      clearHover();
      hoveredElement = candidate.element;
      hoveredElement.classList.add("youzi-image-collector-hover");
    }
  }, true);

  document.addEventListener("click", (event) => {
    if (!directPickEnabled || !session || !session.active) return;
    const candidate = imageCandidateAt(event.target);
    if (!candidate) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (queuedUrls.has(candidate.url) || collectedUrls.has(candidate.url)) return setStatus("這張圖片已經選過了");
    queuedUrls.add(candidate.url);
    queue.push(candidate);
    candidate.element.classList.add("youzi-image-collector-hover");
    processQueue();
  }, true);

  document.addEventListener("paste", (event) => {
    if (!session || !session.active || sending) return;
    const items = Array.from(event.clipboardData && event.clipboardData.items || []);
    const item = items.find((row) => row.kind === "file" && helpers.imageMimeType(row.type));
    if (!item) return;
    event.preventDefault();
    blobToImage(item.getAsFile(), "windows-snip").then(sendPreparedImage).catch((error) => setStatus(String(error.message || error), true));
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && cropOverlay) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelCrop();
      return;
    }
    if (event.key === "Escape" && session) {
      event.preventDefault();
      stopSession();
    }
  }, true);

  panel.querySelector("[data-youzi-direct]").addEventListener("click", () => {
    directPickEnabled = !directPickEnabled;
    if (!directPickEnabled) clearHover();
    updatePanel();
  });
  panel.querySelector("[data-youzi-stop]").addEventListener("click", stopSession);

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== helpers.START_CROP_MESSAGE) return false;
    beginCrop();
    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[helpers.SESSION_STORAGE_KEY]) return;
    const next = changes[helpers.SESSION_STORAGE_KEY].newValue;
    const validation = helpers.normalizeSessionPayload(next, Date.now());
    session = validation.ok ? validation.value : null;
    if (!session || !session.active) {
      cancelCrop();
      clearHover();
    }
    updatePanel();
  });

  chrome.storage.local.get(helpers.SESSION_STORAGE_KEY).then((stored) => {
    const validation = helpers.normalizeSessionPayload(stored[helpers.SESSION_STORAGE_KEY], Date.now());
    session = validation.ok ? validation.value : null;
    updatePanel();
  });
})();
