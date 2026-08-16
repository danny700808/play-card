(function installYouziOperationsBridge() {
  "use strict";

  const helpers = globalThis.YouziShopeeAutofillHelpers;
  const imageCollector = globalThis.YouziImageCollectorHelpers;
  const TRUSTED_ORIGIN = "https://danny700808.github.io";
  const TRUSTED_SOURCE = "youzi-operations-hub";
  const QUEUE_MESSAGE = "YOUZI_SHOPEE_AUTOFILL_QUEUE";
  const ACK_MESSAGE = "YOUZI_SHOPEE_AUTOFILL_ACK";
  const pendingImageDeliveries = new Map();

  if (!helpers || location.origin !== TRUSTED_ORIGIN) {
    return;
  }

  const queueStorage = chrome.storage && chrome.storage[helpers.QUEUE_STORAGE_AREA];
  if (!queueStorage) {
    return;
  }

  function acknowledge(nonce, ok, error, details) {
    window.postMessage(Object.assign({
      type: ACK_MESSAGE,
      nonce: typeof nonce === "string" ? nonce : "",
      ok,
      error: typeof error === "string" ? error.slice(0, 300) : ""
    }, details || {}), TRUSTED_ORIGIN);
  }

  function collectorPost(type, payload) {
    if (!imageCollector) return;
    window.postMessage({
      source: imageCollector.EXTENSION_SOURCE,
      type,
      payload: payload || {}
    }, TRUSTED_ORIGIN);
  }

  function collectorAcknowledge(action, sessionId, ok, error, details) {
    collectorPost(imageCollector.SESSION_ACK_MESSAGE, Object.assign({
      action,
      sessionId: typeof sessionId === "string" ? sessionId : "",
      ok,
      error: typeof error === "string" ? error.slice(0, 300) : ""
    }, details || {}));
  }

  function startImageCollection(payload) {
    const validation = imageCollector.normalizeSessionPayload(payload, Date.now());
    if (!validation.ok) {
      collectorAcknowledge("start", payload && payload.sessionId, false, validation.errors.join("；"));
      return;
    }
    const session = Object.assign({}, validation.value, { active: true, stoppedReason: "" });
    queueStorage.set({ [imageCollector.SESSION_STORAGE_KEY]: session }, () => {
      if (chrome.runtime.lastError) {
        collectorAcknowledge("start", session.sessionId, false, chrome.runtime.lastError.message);
        return;
      }
      collectorAcknowledge("start", session.sessionId, true, "", {
        productId: session.productId,
        sku: session.sku,
        currentCount: session.currentCount,
        maxImages: session.maxImages
      });
    });
  }

  function stopImageCollection(payload) {
    const requestedSessionId = payload && typeof payload.sessionId === "string" ? payload.sessionId : "";
    queueStorage.get(imageCollector.SESSION_STORAGE_KEY, (stored) => {
      const current = stored && stored[imageCollector.SESSION_STORAGE_KEY];
      if (requestedSessionId && current && current.sessionId !== requestedSessionId) {
        collectorAcknowledge("stop", requestedSessionId, false, "目前收圖商品已經更換");
        return;
      }
      queueStorage.remove(imageCollector.SESSION_STORAGE_KEY, () => {
        if (chrome.runtime.lastError) {
          collectorAcknowledge("stop", requestedSessionId, false, chrome.runtime.lastError.message);
          return;
        }
        collectorAcknowledge("stop", requestedSessionId, true, "");
      });
    });
  }

  function resolveImageDelivery(payload) {
    const requestId = payload && typeof payload.requestId === "string" ? payload.requestId : "";
    const pending = pendingImageDeliveries.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingImageDeliveries.delete(requestId);
    pending.sendResponse({
      ok: payload.ok === true,
      count: Number(payload.count || 0),
      error: typeof payload.error === "string" ? payload.error.slice(0, 300) : ""
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== TRUSTED_ORIGIN) {
      return;
    }
    const message = event.data;
    if (!message || message.source !== TRUSTED_SOURCE) return;

    if (imageCollector && message.type === imageCollector.START_MESSAGE) {
      startImageCollection(message.payload);
      return;
    }
    if (imageCollector && message.type === imageCollector.STOP_MESSAGE) {
      stopImageCollection(message.payload);
      return;
    }
    if (imageCollector && message.type === imageCollector.FILE_ACK_MESSAGE) {
      resolveImageDelivery(message.payload);
      return;
    }
    if (message.type !== QUEUE_MESSAGE) return;

    const nonce = message.payload && message.payload.nonce;
    const validation = helpers.validateQueuePayload(message.payload, Date.now());
    if (!validation.ok) {
      acknowledge(nonce, false, validation.errors.slice(0, 6).join("；"), {
        code: "INVALID_PAYLOAD"
      });
      return;
    }

    queueStorage.get(helpers.QUEUE_STORAGE_KEY, (stored) => {
      if (chrome.runtime.lastError) {
        acknowledge(nonce, false, chrome.runtime.lastError.message, { code: "STORAGE_READ_FAILED" });
        return;
      }
      const now = Date.now();
      const queue = helpers.pruneAndMergeQueue(
        stored[helpers.QUEUE_STORAGE_KEY],
        validation.value,
        now,
        now
      );
      queueStorage.set({ [helpers.QUEUE_STORAGE_KEY]: queue }, () => {
        if (chrome.runtime.lastError) {
          acknowledge(nonce, false, chrome.runtime.lastError.message, { code: "STORAGE_WRITE_FAILED" });
          return;
        }
        acknowledge(nonce, true, "", {
          code: "QUEUED",
          sku: validation.value.sku,
          easyStoreProductId: validation.value.easyStoreProductId,
          expiresAt: validation.value.expiresAt,
          storedAt: now
        });
      });
    });
  }, false);

  if (imageCollector && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== imageCollector.DELIVER_MESSAGE || !message.payload) return false;
      const requestId = typeof message.payload.requestId === "string" ? message.payload.requestId : "";
      if (!requestId || pendingImageDeliveries.has(requestId)) {
        sendResponse({ ok: false, error: "圖片工作代碼不正確" });
        return false;
      }
      const timer = setTimeout(() => {
        const pending = pendingImageDeliveries.get(requestId);
        if (!pending) return;
        pendingImageDeliveries.delete(requestId);
        pending.sendResponse({ ok: false, error: "商品上架頁接收圖片逾時" });
      }, 120_000);
      pendingImageDeliveries.set(requestId, { sendResponse, timer });
      collectorPost(imageCollector.DELIVER_MESSAGE, message.payload);
      return true;
    });
  }

  if (imageCollector && chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== helpers.QUEUE_STORAGE_AREA || !changes[imageCollector.SESSION_STORAGE_KEY]) return;
      collectorPost(imageCollector.SESSION_STATE_MESSAGE, {
        session: changes[imageCollector.SESSION_STORAGE_KEY].newValue || null
      });
    });
  }
})();
