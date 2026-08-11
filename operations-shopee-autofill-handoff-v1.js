(function (global) {
  'use strict';

  const QUEUE_TYPE = 'YOUZI_SHOPEE_AUTOFILL_QUEUE';
  const ACK_TYPE = 'YOUZI_SHOPEE_AUTOFILL_ACK';
  const SOURCE = 'youzi-operations-hub';
  const MAX_TTL_MS = 30 * 60 * 1000;
  const MIN_REMAINING_MS = 1000;

  function clean(value, limit) {
    return String(value == null ? '' : value).trim().slice(0, limit || 500);
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function sanitizePayload(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const now = Date.now();
    const categoryPath = (Array.isArray(value.categoryPath) ? value.categoryPath : [])
      .map((item) => clean(item, 120)).filter(Boolean).slice(0, 8);
    const attributes = (Array.isArray(value.attributes) ? value.attributes : []).map((row) => ({
      label: clean(row && row.label, 120),
      value: clean(row && row.value, 300),
      confidence: ['high', 'medium', 'low'].includes(clean(row && row.confidence, 20))
        ? clean(row.confidence, 20) : 'low',
      note: clean(row && row.note, 500)
    })).filter((row) => row.label && row.value).slice(0, 30);
    const methods = (value.logistics && Array.isArray(value.logistics.methods) ? value.logistics.methods : [])
      .map((row) => ({
        label: clean(row && row.label, 120),
        enabled: row && row.enabled === true,
        option: clean(row && row.option, 120),
        sellerPays: row && row.sellerPays === true
      })).filter((row) => row.label).slice(0, 20);
    const createdAt = numberOrNull(value.createdAt);
    const expiresAt = numberOrNull(value.expiresAt);
    if (value.schemaVersion !== 1) {
      throw new Error('蝦皮自動填寫資料版本不相容，請重新執行「確認上架」。');
    }
    if (!Number.isSafeInteger(createdAt) || createdAt <= 0 || createdAt > now + 60 * 1000) {
      throw new Error('蝦皮自動填寫資料的建立時間無效，請重新執行「確認上架」。');
    }
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= createdAt) {
      throw new Error('蝦皮自動填寫資料的有效期限無效，請重新執行「確認上架」。');
    }
    if (expiresAt <= now) {
      throw new Error('蝦皮自動填寫資料已過期，請重新執行「確認上架」。');
    }
    if (expiresAt - now < MIN_REMAINING_MS) {
      throw new Error('蝦皮自動填寫資料即將過期，請重新執行「確認上架」。');
    }
    if (expiresAt - now > MAX_TTL_MS + 5000 || now - createdAt > MAX_TTL_MS + 60 * 1000) {
      throw new Error('蝦皮自動填寫資料不在允許的 30 分鐘時窗內。');
    }
    const easyStoreProductId = clean(value.easyStoreProductId, 100);
    if (!/^[1-9]\d{0,29}$/.test(easyStoreProductId)) {
      throw new Error('EasyStore 商品 ID 無效，請重新執行「確認上架」。');
    }
    const canonicalEasyStoreUrl = `https://admin.easystore.co/products/${easyStoreProductId}`;
    const payload = {
      schemaVersion: 1,
      nonce: clean(value.nonce, 100),
      createdAt,
      expiresAt,
      productId: clean(value.productId, 200),
      easyStoreProductId,
      easyStoreUrl: canonicalEasyStoreUrl,
      sku: clean(value.sku, 120),
      title: clean(value.title, 255),
      categoryPath,
      brand: clean(value.brand, 120),
      attributes,
      package: {
        lengthCm: numberOrNull(value.package && value.package.lengthCm),
        widthCm: numberOrNull(value.package && value.package.widthCm),
        heightCm: numberOrNull(value.package && value.package.heightCm),
        weightKg: numberOrNull(value.package && value.package.weightKg)
      },
      logistics: {
        decision: clean(value.logistics && value.logistics.decision, 30),
        packageTotalCm: numberOrNull(value.logistics && value.logistics.packageTotalCm),
        methods,
        requiresConfirmation: value.logistics && value.logistics.requiresConfirmation === true
      },
      preorder: {
        enabled: value.preorder && value.preorder.enabled === true,
        days: Math.max(1, Math.min(30, Math.round(numberOrNull(value.preorder && value.preorder.days) || 1)))
      },
      guard: {
        brand: clean(value.guard && value.guard.brand, 120),
        model: clean(value.guard && value.guard.model, 120),
        color: clean(value.guard && value.guard.color, 120),
        identityStatus: clean(value.guard && value.guard.identityStatus, 30)
      }
    };
    if (!payload.nonce || !payload.productId || !payload.sku || !payload.categoryPath.length) {
      throw new Error('蝦皮自動填寫資料不完整，請重新執行「確認上架」。');
    }
    return payload;
  }

  function queueSanitized(sanitized) {
    return new Promise((resolve) => {
      let finished = false;
      function finish(value) {
        if (finished) return;
        finished = true;
        global.removeEventListener('message', onMessage);
        global.clearTimeout(timer);
        resolve(value);
      }
      function onMessage(event) {
        const data = event && event.data;
        if (event.source !== global || event.origin !== global.location.origin || !data || data.type !== ACK_TYPE) return;
        if (clean(data.nonce, 100) !== sanitized.nonce) return;
        finish({ payload: sanitized, extensionReady: data.ok === true, error: clean(data.error, 300) });
      }
      global.addEventListener('message', onMessage);
      const timer = global.setTimeout(() => finish({ payload: sanitized, extensionReady: false, error: '' }), 1600);
      global.postMessage({ source: SOURCE, type: QUEUE_TYPE, payload: sanitized }, global.location.origin);
    });
  }

  function queue(payload) {
    return queueSanitized(sanitizePayload(payload));
  }

  function queueAndOpen(payload) {
    const sanitized = sanitizePayload(payload);
    const pending = queueSanitized(sanitized);
    global.open(sanitized.easyStoreUrl, '_blank', 'noopener');
    return pending;
  }

  global.YouziShopeeAutofill = Object.freeze({ queue, queueAndOpen, sanitizePayload });
})(window);
