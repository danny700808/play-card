(function installYouziSupplierImageCollector() {
  "use strict";

  const helpers = globalThis.YouziImageCollectorHelpers;
  if (!helpers || !helpers.isCollectablePageUrl(location.href)) return;
  const collectorRuntimeVersion = chrome.runtime.getManifest().version;
  if (globalThis.__youziSupplierImageCollectorInstalled === collectorRuntimeVersion) return;
  globalThis.__youziSupplierImageCollectorInstalled = collectorRuntimeVersion;
  document.getElementById("youziImageCollectorPanel")?.remove();
  document.getElementById("youziImageCropOverlay")?.remove();
  document.getElementById("youziImageCollectorStyle")?.remove();


  let session = null;
  let hoveredElement = null;
  let sending = false;
  let directPickEnabled = false;
  let cropOverlay = null;
  let confirmCropSelection = null;
  let captureUiHidden = false;
  let cropCaptureInFlight = false;
  let statusMessage = "";
  let statusIsError = false;
  const queue = [];
  const queuedElements = new WeakSet();

  const style = document.createElement("style");
  style.id = "youziImageCollectorStyle";
  style.textContent = `
    .youzi-image-collector-hover {
      outline: 4px solid #16a36f !important;
      outline-offset: -4px !important;
      cursor: copy !important;
    }
    .youzi-image-collector-suppressed-hover-artifact { visibility: hidden !important; opacity: 0 !important; }
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
    #youziImageCollectorPanel .youzi-status { margin-top: 8px; min-height: 20px; }
    #youziImageCollectorPanel .youzi-error { color: #c9463f; }
    #youziImageCollectorPanel .youzi-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 10px; }
    #youziImageCollectorPanel button {
      min-height: 40px; padding: 8px 10px; border: 0; border-radius: 9px;
      background: #173247; color: #fff; font-weight: 800; cursor: pointer;
    }
    #youziImageCollectorPanel button[data-youzi-direct] { background: #e9eef1; color: #455a64; }
    #youziImageCollectorPanel button[data-youzi-direct].is-active {
      background: #16a36f; color: #fff; box-shadow: 0 0 0 3px rgba(22,163,111,.18);
    }
    #youziImageCollectorPanel button[data-youzi-stop] { grid-column: 1 / -1; background: #647681; }
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
    #youziImageCropOverlay.youzi-crop-capture-hidden { opacity: 0 !important; }
    #youziImageCropOverlay .youzi-crop-toolbar {
      position: absolute; top: calc(100% + 10px); right: -3px; display: none; gap: 7px;
      padding: 6px; border-radius: 10px; background: #173247; box-shadow: 0 8px 20px rgba(0,0,0,.3);
      white-space: nowrap;
    }
    #youziImageCropOverlay .youzi-crop-selection.toolbar-above .youzi-crop-toolbar { top: auto; bottom: calc(100% + 10px); }
    #youziImageCropOverlay .youzi-crop-selection.is-ready .youzi-crop-toolbar { display: flex; }
    #youziImageCropOverlay .youzi-crop-toolbar button {
      min-height: 34px; padding: 6px 11px; border: 0; border-radius: 7px;
      background: #12a66d; color: #fff; font: 800 13px/1.2 "Microsoft JhengHei", sans-serif; cursor: pointer;
    }
    #youziImageCropOverlay .youzi-crop-toolbar button[data-crop-reset] { background: #fff; color: #173247; }
    #youziImageCropOverlay .youzi-crop-toolbar button[data-crop-cancel] { background: #647681; color: #fff; }
  `;
  (document.head || document.documentElement).appendChild(style);

  const panel = document.createElement("aside");
  panel.id = "youziImageCollectorPanel";
  panel.hidden = true;
  panel.innerHTML = `
    <b>柚子掌櫃收圖中</b>
    <div class="youzi-product" data-youzi-product></div>
    <div class="youzi-progress" data-youzi-progress></div>
    <div class="youzi-status" data-youzi-status></div>
    <div class="youzi-actions">
      <button type="button" data-youzi-direct aria-pressed="false">點圖片加入：關閉</button>
      <button type="button" data-youzi-crop>框選截圖</button>
      <button type="button" data-youzi-stop>結束搜圖（Esc）</button>
    </div>
  `;
  (document.body || document.documentElement).appendChild(panel);

  const productText = panel.querySelector("[data-youzi-product]");
  const progressText = panel.querySelector("[data-youzi-progress]");
  const statusText = panel.querySelector("[data-youzi-status]");
  const directButton = panel.querySelector("[data-youzi-direct]");

  function setStatus(message, isError) {
    statusMessage = message || "";
    statusIsError = Boolean(isError);
    statusText.textContent = statusMessage;
    statusText.classList.toggle("youzi-error", statusIsError);
  }

  function updatePanel() {
    if (!session) {
      panel.hidden = true;
      statusMessage = "";
      statusIsError = false;
      setStatus("");
      return;
    }
    panel.hidden = Boolean(cropOverlay || captureUiHidden);
    productText.textContent = `${session.sku}｜${session.title || "準備上架商品"}`;
    progressText.textContent = `已加入 ${session.currentCount}／${session.maxImages} 張`;
    directButton.classList.toggle("is-active", directPickEnabled);
    directButton.setAttribute("aria-pressed", directPickEnabled ? "true" : "false");
    directButton.textContent = directPickEnabled ? "✓ 點圖片加入：開啟" : "點圖片加入：關閉";
    if (!session.active && session.stoppedReason === "full") {
      setStatus(`已收滿 ${session.maxImages} 張，收圖模式已自動結束。`);
    } else if (!sending && !statusMessage) {
      setStatus(directPickEnabled ? "移到圖片上，出現綠框後點一下；不用時可再按一次關閉。" : "點圖功能目前關閉；需要時按「點圖片加入」開啟，或使用「框選截圖」。");
    } else {
      statusText.textContent = statusMessage;
      statusText.classList.toggle("youzi-error", statusIsError);
    }
  }

  function clearHover() {
    if (hoveredElement) hoveredElement.classList.remove("youzi-image-collector-hover");
    hoveredElement = null;
  }

  function visibleImageElement(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width >= 20 && rect.height >= 20 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function decorativeOverlayImage(image) {
    if (!(image instanceof HTMLImageElement)) return false;
    const marker = `${image.id || ""} ${String(image.className || "")}`;
    return !String(image.alt || "").trim() && /(?:badge|watermark|mask|lens|overlay|sprite)/i.test(marker);
  }

  function candidateFromImage(image) {
    if (!(image instanceof HTMLImageElement) || !visibleImageElement(image) || decorativeOverlayImage(image)) return null;
    const candidates = [
      image.getAttribute("data-original"), image.getAttribute("data-original-src"),
      image.getAttribute("data-ks-lazyload"), image.getAttribute("data-lazy-src"),
      image.getAttribute("data-src"), image.getAttribute("data-hi-res-src"),
      image.getAttribute("data-zoom-image"), image.getAttribute("data-large"),
      image.getAttribute("data-large-img"), image.getAttribute("data-full"),
      image.getAttribute("data-master"), image.getAttribute("data-image"),
      image.getAttribute("data-srcset"), image.getAttribute("data-lazy-srcset"),
      image.getAttribute("srcset"), image.currentSrc, image.getAttribute("src")
    ];
    return { element: image, url: helpers.chooseImageUrl(candidates, location.href) || "" };
  }

  function backgroundImageUrl(element) {
    const candidates = [];
    ["", "::before", "::after"].forEach((pseudo) => {
      let background = "";
      try { background = getComputedStyle(element, pseudo || null).backgroundImage || ""; } catch (error) {}
      for (const match of background.matchAll(/url\((["']?)(.*?)\1\)/gi)) candidates.push(match[2]);
    });
    return helpers.chooseImageUrl(candidates, location.href) || "";
  }

  function candidateFromElement(element) {
    if (!visibleImageElement(element)) return null;
    if (element instanceof HTMLImageElement) return candidateFromImage(element);
    if (element instanceof HTMLVideoElement) {
      const poster = helpers.normalizeImageUrl(element.poster || element.getAttribute("poster"), location.href);
      return { element, url: poster || "" };
    }
    if (element instanceof HTMLCanvasElement) return { element, url: "" };
    if (String(element.localName || "").toLowerCase() === "image") {
      const href = element.href && element.href.baseVal ? element.href.baseVal : element.getAttribute("href") || element.getAttribute("xlink:href");
      return { element, url: helpers.normalizeImageUrl(href, location.href) || "" };
    }
    const background = backgroundImageUrl(element);
    return background ? { element, url: background } : null;
  }

  function imageCandidateAt(target) {
    if (!(target instanceof Element) || target.closest("#youziImageCollectorPanel,#youziImageCropOverlay")) return null;
    const direct = target.closest("img,video,canvas,svg image");
    if (direct) {
      const directCandidate = candidateFromElement(direct);
      if (directCandidate) return directCandidate;
    }
    let element = target;
    let screenshotCandidate = null;
    for (let depth = 0; element && depth < 9; depth += 1, element = element.parentElement) {
      const ownCandidate = candidateFromElement(element);
      if (ownCandidate) {
        if (ownCandidate.url) return ownCandidate;
        if (!screenshotCandidate) screenshotCandidate = ownCandidate;
      }
      if (depth <= 5 && element.querySelectorAll) {
        const descendants = Array.from(element.querySelectorAll("img,video[poster],canvas,svg image")).filter(visibleImageElement).sort((a, b) => {
          const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
          return br.width * br.height - ar.width * ar.height;
        }).slice(0, 20);
        for (const descendant of descendants) {
          const candidate = candidateFromElement(descendant);
          if (!candidate) continue;
          if (candidate.url) return candidate;
          if (!screenshotCandidate) screenshotCandidate = candidate;
        }
      }
    }
    return screenshotCandidate;
  }

  function eventImageCandidate(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const target = path.find((node) => node instanceof Element) || event.target;
    return imageCandidateAt(target);
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

  async function deliverPreparedImage(image) {
    const result = await chrome.runtime.sendMessage({
      type: helpers.CAPTURE_DATA_MESSAGE,
      payload: { sessionId: session.sessionId, productId: session.productId, image }
    });
    if (!result || !result.ok) throw new Error(result && result.error ? result.error : "截圖傳送失敗");
    applyCollectionResult(result);
    return result;
  }

  async function sendPreparedImage(image) {
    if (sending || !session || !session.active) return;
    sending = true;
    setStatus("正在送到準備上架商品…");
    try {
      await deliverPreparedImage(image);
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
      let result = null;
      if (next.url) {
        result = await chrome.runtime.sendMessage({
          type: helpers.FETCH_MESSAGE,
          payload: { sessionId: session.sessionId, productId: session.productId, imageUrl: next.url }
        });
      }
      if (result && result.ok) {
        next.element.classList.remove("youzi-image-collector-hover");
        applyCollectionResult(result);
      } else {
        if (result && result.code !== "IMAGE_READ_FAILED") {
          throw new Error(result.error || "圖片傳送失敗");
        }
        setStatus("原圖讀取受限，正在改用畫面截圖…");
        next.element.classList.remove("youzi-image-collector-hover");
        const captured = await captureVisiblePage(next.element);
        if (!captured.rect || captured.rect.width < 20 || captured.rect.height < 20) {
          throw new Error("圖片目前不在可見範圍，請把圖片捲到畫面中再點一次。");
        }
        await deliverPreparedImage(await cropVisibleCapture(captured.dataUrl, captured.rect));
      }
    } catch (error) {
      next.element.classList.remove("youzi-image-collector-hover");
      setStatus(String(error && error.message ? error.message : error), true);
    } finally {
      queuedElements.delete(next.element);
      next.element.classList.remove("youzi-image-collector-hover");
      if (hoveredElement === next.element) hoveredElement = null;
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

  function resizeCanvas(source, scale) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("瀏覽器無法建立截圖畫布");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function canvasBlobWithinLimit(source) {
    let working = source;
    let blob = await canvasBlob(working, "image/png");
    if (!blob) throw new Error("瀏覽器無法產生截圖");
    if (blob.size <= helpers.MAX_IMAGE_BYTES) return blob;
    for (const quality of [.94, .86, .76, .66]) {
      blob = await canvasBlob(working, "image/jpeg", quality);
      if (blob && blob.size <= helpers.MAX_IMAGE_BYTES) return blob;
    }
    for (let attempt = 0; attempt < 3 && blob && blob.size > helpers.MAX_IMAGE_BYTES; attempt += 1) {
      const scale = Math.max(.5, Math.min(.85, Math.sqrt(helpers.MAX_IMAGE_BYTES / blob.size) * .9));
      working = resizeCanvas(working, scale);
      blob = await canvasBlob(working, "image/jpeg", .84);
    }
    if (!blob || !blob.size || blob.size > helpers.MAX_IMAGE_BYTES) throw new Error("截圖太大，請縮小框選範圍後再試一次");
    return blob;
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
    if (!context) throw new Error("瀏覽器無法建立截圖畫布");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      image,
      Math.round(rect.left * scaleX), Math.round(rect.top * scaleY), canvas.width, canvas.height,
      0, 0, canvas.width, canvas.height
    );
    return blobToImage(await canvasBlobWithinLimit(canvas), "supplier-crop");
  }

  function elementRectInViewport(element) {
    if (!(element instanceof Element) || !element.isConnected) return null;
    const raw = element.getBoundingClientRect();
    const left = Math.max(0, raw.left), top = Math.max(0, raw.top);
    const right = Math.min(window.innerWidth, raw.right), bottom = Math.min(window.innerHeight, raw.bottom);
    const width = Math.max(0, right - left), height = Math.max(0, bottom - top);
    return width >= 20 && height >= 20 ? { left, top, width, height } : null;
  }

  function rectanglesOverlap(a, b) {
    return Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
  }

  function suppressSupplierHoverArtifacts(targetElement) {
    const selectors = [
      ".ks-imagezoom-lens", ".detail-gallery-turn-lens", ".detail-gallery-turn-mask", ".product-badge-img",
      "[class*='imagezoom'][class*='lens']", "[class*='magnifier'][class*='lens']",
      "[class*='zoom'][class*='lens']", "[class*='zoom'][class*='mask']",
      "[class*='preview'][class*='mask']", "[class*='gallery'][class*='mask']",
      "[class*='lens-mask']", "[class*='magnify-mask']", "[class*='magnifier-mask']"
    ];
    const hidden = new Set();
    const hide = (node) => {
      if (!(node instanceof Element) || node === targetElement || node.closest("#youziImageCollectorPanel,#youziImageCropOverlay")) return;
      if (node.classList.contains("youzi-image-collector-suppressed-hover-artifact")) return;
      node.classList.add("youzi-image-collector-suppressed-hover-artifact");
      hidden.add(node);
    };
    selectors.forEach((selector) => {
      try { document.querySelectorAll(selector).forEach(hide); } catch (error) { /* Ignore supplier-specific invalid selectors. */ }
    });
    if (targetElement instanceof Element) {
      const targetRect = targetElement.getBoundingClientRect();
      document.querySelectorAll("[class],[id]").forEach((node) => {
        if (node === targetElement || node.contains(targetElement) || targetElement.contains(node)) return;
        const marker = `${node.id || ""} ${String(node.className || "")}`;
        if (!/(?:badge|watermark|mask|lens|overlay|sprite|zoom|magnifier)/i.test(marker)) return;
        const position = getComputedStyle(node).position;
        if (!["absolute", "fixed", "sticky"].includes(position)) return;
        if (rectanglesOverlap(node.getBoundingClientRect(), targetRect)) hide(node);
      });
    }
    return () => hidden.forEach((node) => node.classList.remove("youzi-image-collector-suppressed-hover-artifact"));
  }

  function dismissSupplierHoverPreview() {
    const target = hoveredElement;
    clearHover();
    if (target) ["pointerout", "pointerleave", "mouseout", "mouseleave"].forEach((type) => {
      try { target.dispatchEvent(new MouseEvent(type, { bubbles: type !== "pointerleave" && type !== "mouseleave", clientX: 0, clientY: 0 })); } catch (error) { /* Best effort. */ }
    });
  }

  async function captureVisiblePage(targetElement) {
    dismissSupplierHoverPreview();
    const restoreArtifacts = suppressSupplierHoverArtifacts(targetElement);
    captureUiHidden = true;
    updatePanel();
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const restoreLateArtifacts = suppressSupplierHoverArtifacts(targetElement);
      const rect = targetElement ? elementRectInViewport(targetElement) : null;
      let result;
      try { result = await chrome.runtime.sendMessage({ type: helpers.CAPTURE_MESSAGE }); }
      finally { restoreLateArtifacts(); }
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : "無法截取目前畫面");
      return { dataUrl: result.dataUrl, rect };
    } finally {
      restoreArtifacts();
      captureUiHidden = false;
      updatePanel();
    }
  }

  async function captureSelection(rect) {
    try {
      const captured = await captureVisiblePage();
      await sendPreparedImage(await cropVisibleCapture(captured.dataUrl, rect));
    } catch (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    } finally {
      updatePanel();
    }
  }

  function cancelCrop(showStatus = true) {
    if (cropOverlay) cropOverlay.remove();
    cropOverlay = null;
    confirmCropSelection = null;
    if (showStatus) setStatus("已取消框選，可繼續操作原網頁。");
    updatePanel();
  }

  function beginCrop() {
    if (!session || !session.active || sending || cropCaptureInFlight || cropOverlay) return;
    clearHover();
    cropOverlay = document.createElement("div");
    cropOverlay.id = "youziImageCropOverlay";
    cropOverlay.innerHTML = '<div class="youzi-crop-help">按住滑鼠拉出範圍；不需要時按「取消框選」回到網頁</div><div class="youzi-crop-selection"><div class="youzi-crop-toolbar"><button type="button" data-crop-capture>確認截圖</button><button type="button" data-crop-reset>重新框選</button><button type="button" data-crop-cancel>取消框選</button></div></div>';
    document.documentElement.appendChild(cropOverlay);
    const selection = cropOverlay.querySelector(".youzi-crop-selection");
    const help = cropOverlay.querySelector(".youzi-crop-help");
    let rect = null;
    let interaction = null;
    const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
    const drawSelection = (next) => {
      rect = next ? {
        left: clamp(next.left, 0, Math.max(0, window.innerWidth - 20)),
        top: clamp(next.top, 0, Math.max(0, window.innerHeight - 20)),
        width: Math.max(20, Math.min(next.width, window.innerWidth - clamp(next.left, 0, Math.max(0, window.innerWidth - 20)))),
        height: Math.max(20, Math.min(next.height, window.innerHeight - clamp(next.top, 0, Math.max(0, window.innerHeight - 20))))
      } : null;
      if (!rect) {
        selection.style.display = "none";
        selection.classList.remove("is-ready");
        help.textContent = "按住滑鼠拖曳框選；Esc 取消";
        return;
      }
      selection.style.display = "block";
      selection.style.left = `${rect.left}px`;
      selection.style.top = `${rect.top}px`;
      selection.style.width = `${rect.width}px`;
      selection.style.height = `${rect.height}px`;
      selection.classList.toggle("toolbar-above", rect.top + rect.height > window.innerHeight - 64);
    };
    const finishInteraction = () => {
      if (!interaction) return;
      interaction = null;
      if (!rect || rect.width < 20 || rect.height < 20) {
        drawSelection(null);
        setStatus("框選範圍太小，請重新框選", true);
        return;
      }
      selection.classList.add("is-ready");
      help.textContent = "範圍正確就按「確認截圖」；不需要可按「取消框選」回到網頁";
    };
    confirmCropSelection = async () => {
      if (!rect || rect.width < 20 || rect.height < 20 || sending || cropCaptureInFlight) return;
      cropCaptureInFlight = true;
      cropOverlay.classList.add("youzi-crop-capture-hidden");
      cropOverlay.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      try { await captureSelection(Object.assign({}, rect)); }
      finally {
        cropCaptureInFlight = false;
        cancelCrop(false);
      }
    };
    cropOverlay.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest(".youzi-crop-toolbar")) return;
      interaction = { startX: event.clientX, startY: event.clientY };
      selection.classList.remove("is-ready");
      rect = { left: event.clientX, top: event.clientY, width: 20, height: 20 };
      drawSelection(rect);
      cropOverlay.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    cropOverlay.addEventListener("pointermove", (event) => {
      if (!interaction) return;
      const left = Math.min(interaction.startX, event.clientX), top = Math.min(interaction.startY, event.clientY);
      drawSelection({ left, top, width: Math.abs(event.clientX - interaction.startX), height: Math.abs(event.clientY - interaction.startY) });
      event.preventDefault();
    });
    cropOverlay.addEventListener("pointerup", finishInteraction);
    cropOverlay.addEventListener("pointercancel", finishInteraction);
    cropOverlay.querySelector("[data-crop-capture]").addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); confirmCropSelection(); });
    cropOverlay.querySelector("[data-crop-reset]").addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); interaction = null; drawSelection(null); });
    cropOverlay.querySelector("[data-crop-cancel]").addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); cancelCrop(); });
    updatePanel();
  }

  async function stopSession() {
    cancelCrop();
    directPickEnabled = false;
    clearHover();
    queue.splice(0);
    await chrome.storage.local.remove(helpers.SESSION_STORAGE_KEY);
  }

  document.addEventListener("mousemove", (event) => {
    if (!directPickEnabled || !session || !session.active) return clearHover();
    const candidate = eventImageCandidate(event);
    if (!candidate) return clearHover();
    if (hoveredElement !== candidate.element) {
      clearHover();
      hoveredElement = candidate.element;
      hoveredElement.classList.add("youzi-image-collector-hover");
    }
  }, true);

  document.addEventListener("click", (event) => {
    if (!directPickEnabled || !session || !session.active) return;
    const candidate = eventImageCandidate(event);
    if (!candidate) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (queuedElements.has(candidate.element)) return setStatus("這張圖片正在加入，請稍候");
    queuedElements.add(candidate.element);
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
    if (event.key === "Enter" && cropOverlay && confirmCropSelection) {
      event.preventDefault();
      event.stopImmediatePropagation();
      confirmCropSelection();
      return;
    }
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
    setStatus(directPickEnabled ? "點圖功能已開啟；移到圖片上，綠框出現後點一下。" : "點圖功能已關閉；現在可正常點擊網頁連結。");
    updatePanel();
  });
  panel.querySelector("[data-youzi-crop]").addEventListener("click", beginCrop);
  panel.querySelector("[data-youzi-stop]").addEventListener("click", stopSession);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return false;
    if (message.type === helpers.COLLECTOR_PING_MESSAGE) {
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
      return false;
    }
    if (message.type !== helpers.START_CROP_MESSAGE) return false;
    beginCrop();
    sendResponse({ ok: true });
    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[helpers.SESSION_STORAGE_KEY]) return;
    const previousSessionId = session && session.sessionId;
    const next = changes[helpers.SESSION_STORAGE_KEY].newValue;
    const validation = helpers.normalizeSessionPayload(next, Date.now());
    session = validation.ok ? validation.value : null;
    if (session && session.active && session.sessionId !== previousSessionId) {
      directPickEnabled = false;
      clearHover();
      setStatus("");
    }
    if (!session || !session.active) {
      directPickEnabled = false;
      cancelCrop();
      clearHover();
    }
    updatePanel();
  });

  chrome.storage.local.get(helpers.SESSION_STORAGE_KEY).then((stored) => {
    const validation = helpers.normalizeSessionPayload(stored[helpers.SESSION_STORAGE_KEY], Date.now());
    session = validation.ok ? validation.value : null;
    directPickEnabled = false;
    updatePanel();
  });
})();
