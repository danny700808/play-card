(function installYouziSupplierImageCollector() {
  "use strict";

  const helpers = globalThis.YouziImageCollectorHelpers;
  if (!helpers || !helpers.isSupplierPageUrl(location.href)) return;

  let session = null;
  let hoveredElement = null;
  let sending = false;
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
      z-index: 2147483647;
      top: 14px;
      right: 14px;
      width: min(330px, calc(100vw - 28px));
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
    #youziImageCollectorPanel .youzi-help { color: #667985; margin-top: 5px; }
    #youziImageCollectorPanel .youzi-status { margin-top: 8px; min-height: 20px; }
    #youziImageCollectorPanel .youzi-error { color: #c9463f; }
    #youziImageCollectorPanel button {
      width: 100%; margin-top: 10px; padding: 9px 12px; border: 0; border-radius: 9px;
      background: #173247; color: #fff; font-weight: 700; cursor: pointer;
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
    <div class="youzi-help">滑鼠移到商品圖，出現綠框後直接點一下。</div>
    <div class="youzi-status" data-youzi-status></div>
    <button type="button" data-youzi-stop>結束收圖（Esc）</button>
  `;
  (document.body || document.documentElement).appendChild(panel);

  const productText = panel.querySelector("[data-youzi-product]");
  const progressText = panel.querySelector("[data-youzi-progress]");
  const statusText = panel.querySelector("[data-youzi-status]");

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
    panel.hidden = false;
    productText.textContent = `${session.sku}｜${session.title || "準備上架商品"}`;
    progressText.textContent = `已加入 ${session.currentCount}／${session.maxImages} 張`;
    if (!session.active && session.stoppedReason === "full") {
      setStatus(`已收滿 ${session.maxImages} 張，收圖模式已自動結束。`);
    } else if (!sending) {
      setStatus("等待點選圖片");
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
          image.getAttribute("data-original"),
          image.getAttribute("data-ks-lazyload"),
          image.getAttribute("data-lazy-src"),
          image.getAttribute("data-src"),
          image.getAttribute("data-zoom-image"),
          image.getAttribute("srcset"),
          image.currentSrc,
          image.getAttribute("src")
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

  async function stopSession() {
    clearHover();
    queue.splice(0);
    queuedUrls.clear();
    await chrome.storage.local.remove(helpers.SESSION_STORAGE_KEY);
  }

  async function processQueue() {
    if (sending || !session || !session.active) return;
    const next = queue.shift();
    if (!next) {
      setStatus("等待點選圖片");
      return;
    }
    sending = true;
    setStatus("正在送到準備上架商品…");
    try {
      const result = await chrome.runtime.sendMessage({
        type: helpers.FETCH_MESSAGE,
        payload: {
          sessionId: session.sessionId,
          productId: session.productId,
          imageUrl: next.url
        }
      });
      if (!result || !result.ok) throw new Error(result && result.error ? result.error : "圖片傳送失敗");
      collectedUrls.add(next.url);
      next.element.classList.remove("youzi-image-collector-hover");
      next.element.classList.add("youzi-image-collector-collected");
      session = Object.assign({}, session, {
        currentCount: Number(result.count || session.currentCount + 1),
        active: result.code !== "COLLECTED_AND_FULL",
        stoppedReason: result.code === "COLLECTED_AND_FULL" ? "full" : ""
      });
      setStatus(`已加入第 ${session.currentCount} 張`);
      updatePanel();
    } catch (error) {
      queuedUrls.delete(next.url);
      next.element.classList.remove("youzi-image-collector-hover");
      setStatus(String(error && error.message ? error.message : error), true);
    } finally {
      sending = false;
      if (session && session.active) processQueue();
    }
  }

  document.addEventListener("mousemove", (event) => {
    if (!session || !session.active) return clearHover();
    const candidate = imageCandidateAt(event.target);
    if (!candidate || collectedUrls.has(candidate.url)) return clearHover();
    if (hoveredElement !== candidate.element) {
      clearHover();
      hoveredElement = candidate.element;
      hoveredElement.classList.add("youzi-image-collector-hover");
    }
  }, true);

  document.addEventListener("click", (event) => {
    if (!session || !session.active) return;
    const candidate = imageCandidateAt(event.target);
    if (!candidate) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (queuedUrls.has(candidate.url) || collectedUrls.has(candidate.url)) {
      setStatus("這張圖片已經選過了");
      return;
    }
    queuedUrls.add(candidate.url);
    queue.push(candidate);
    candidate.element.classList.add("youzi-image-collector-hover");
    processQueue();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && session) {
      event.preventDefault();
      stopSession();
    }
  }, true);

  panel.querySelector("[data-youzi-stop]").addEventListener("click", stopSession);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[helpers.SESSION_STORAGE_KEY]) return;
    const next = changes[helpers.SESSION_STORAGE_KEY].newValue;
    const validation = helpers.normalizeSessionPayload(next, Date.now());
    session = validation.ok ? validation.value : null;
    if (!session || !session.active) clearHover();
    updatePanel();
  });

  chrome.storage.local.get(helpers.SESSION_STORAGE_KEY).then((stored) => {
    const validation = helpers.normalizeSessionPayload(stored[helpers.SESSION_STORAGE_KEY], Date.now());
    session = validation.ok ? validation.value : null;
    updatePanel();
  });
})();
