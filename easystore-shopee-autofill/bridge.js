(function installYouziQueueBridge() {
  "use strict";

  const helpers = globalThis.YouziShopeeAutofillHelpers;
  const TRUSTED_ORIGIN = "https://danny700808.github.io";
  const TRUSTED_SOURCE = "youzi-operations-hub";
  const QUEUE_MESSAGE = "YOUZI_SHOPEE_AUTOFILL_QUEUE";
  const ACK_MESSAGE = "YOUZI_SHOPEE_AUTOFILL_ACK";

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

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== TRUSTED_ORIGIN) {
      return;
    }
    const message = event.data;
    if (
      !message ||
      message.source !== TRUSTED_SOURCE ||
      message.type !== QUEUE_MESSAGE
    ) {
      return;
    }
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
})();
