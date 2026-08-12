'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('operations-shopee-autofill-handoff-v1.js', 'utf8');

function rawPayload() {
  const now = Date.now();
  return {
    schemaVersion: 2,
    nonce: '0123456789abcdef0123456789abcdef',
    createdAt: now,
    expiresAt: now + 10 * 60 * 1000,
    productId: 'guitar-1',
    easyStoreProductId: '16403950',
    easyStoreUrl: 'https://admin.easystore.co/products/16403950',
    sku: '1040160-1',
    title: 'Ibanez AZES40-PRB 電吉他',
    publishMode: 'auto',
    categoryPath: ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯'],
    brand: 'Ibanez',
    attributes: [
      { label: 'Pickup Configuration', value: 'HSS', confidence: 'high', note: '官方規格' }
    ],
    package: { lengthCm: 106.7, widthCm: 45.7, heightCm: 10.2, weightKg: 4.2 },
    logistics: {
      decision: 'freight', packageTotalCm: 162.6, requiresConfirmation: false,
      methods: [{ label: '新竹物流', enabled: true, option: 'S170', sellerPays: false }]
    },
    preorder: { enabled: false, days: 1 },
    guard: { brand: 'Ibanez', model: 'AZES40-PRB', color: 'Purist Blue', identityStatus: 'confirmed' },
    costPrice: 7400,
    accessToken: 'must-not-leak'
  };
}

function loadBridge() {
  const listeners = new Map();
  const posted = [];
  const opened = [];
  const window = {
    location: { origin: 'https://danny700808.github.io' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    setTimeout() { return 1; },
    clearTimeout() {},
    postMessage(message, targetOrigin) { posted.push({ message, targetOrigin }); },
    open(url, target, features) { opened.push({ url, target, features }); }
  };
  vm.runInNewContext(source, { window, URL, encodeURIComponent, Object, Array, String, Number, Math, Date, Error });
  return { api: window.YouziShopeeAutofill, window, listeners, posted, opened };
}

test('handoff keeps only approved Shopee fields and never exposes costs or credentials', () => {
  const { api } = loadBridge();
  const payload = api.sanitizePayload(rawPayload());
  const serialized = JSON.stringify(payload);
  assert.equal(payload.sku, '1040160-1');
  assert.equal(payload.attributes[0].value, 'HSS');
  assert.equal(payload.publishMode, 'auto');
  assert.equal(payload.logistics.methods[0].option, 'S170');
  assert.doesNotMatch(serialized, /7400|must-not-leak|accessToken|costPrice/);
});

test('handoff refuses incomplete identity data', () => {
  const { api } = loadBridge();
  const payload = rawPayload();
  payload.sku = '';
  assert.throws(() => api.sanitizePayload(payload), /資料不完整/);
});

test('handoff rejects an expired record and never silently extends its expiry', () => {
  const { api, posted, opened } = loadBridge();
  const payload = rawPayload();
  payload.createdAt = Date.now() - 20 * 60 * 1000;
  payload.expiresAt = Date.now() - 1;
  assert.throws(() => api.sanitizePayload(payload), /已過期/);
  assert.throws(() => api.queueAndOpen(payload), /已過期/);
  assert.deepEqual(posted, []);
  assert.deepEqual(opened, []);
});

test('handoff always rebuilds the EasyStore product URL from the validated product ID', () => {
  const { api } = loadBridge();
  const payload = rawPayload();
  payload.easyStoreUrl = 'https://admin.easystore.co/settings?product_ids=16403950#unsafe';
  const sanitized = api.sanitizePayload(payload);
  assert.equal(sanitized.easyStoreUrl, 'https://admin.easystore.co/products/16403950');
  assert.equal(sanitized.expiresAt, payload.expiresAt);
});

test('handoff rejects a non-numeric EasyStore product ID', () => {
  const { api } = loadBridge();
  const payload = rawPayload();
  payload.easyStoreProductId = '../settings';
  assert.throws(() => api.sanitizePayload(payload), /商品 ID 無效/);
});

test('handoff accepts only the extension acknowledgement with the matching nonce', async () => {
  const { api, window, listeners, posted } = loadBridge();
  const pending = api.queue(rawPayload());
  assert.equal(posted.length, 1);
  assert.equal(posted[0].message.type, 'YOUZI_SHOPEE_AUTOFILL_QUEUE');
  listeners.get('message')({
    source: window,
    origin: window.location.origin,
    data: { type: 'YOUZI_SHOPEE_AUTOFILL_ACK', nonce: rawPayload().nonce, ok: true }
  });
  const result = await pending;
  assert.equal(result.extensionReady, true);
});

test('queueAndOpen opens only the sanitized EasyStore product URL', () => {
  const { api, opened } = loadBridge();
  api.queueAndOpen(rawPayload());
  assert.deepEqual(opened, [{
    url: 'https://admin.easystore.co/products/16403950', target: '_blank', features: 'noopener'
  }]);
});
