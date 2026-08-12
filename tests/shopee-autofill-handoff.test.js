'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('operations-shopee-autofill-handoff-v1.js', 'utf8');

function rawPayload() {
  const now = Date.now();
  return {
    schemaVersion: 4,
    nonce: '0123456789abcdef0123456789abcdef',
    createdAt: now,
    expiresAt: now + 10 * 60 * 1000,
    productId: 'guitar-1',
    easyStoreProductId: '16403950',
    easyStoreUrl: 'https://admin.easystore.co/products/16403950',
    sku: '1040160-1',
    title: 'Ibanez AZES40-PRB 電吉他',
    publishMode: 'auto',
    listingPolicy: {
      decision: 'auto', matchKey: 'sku', allowCreate: false, existingListingIds: [],
      onZero: 'create-only-if-confirmed', onOne: 'update', onMultiple: 'block'
    },
    categoryPath: ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯'],
    brand: 'Ibanez',
    attributes: [
      { label: 'Pickup Configuration', value: 'HSS', confidence: 'high', note: '官方規格' }
    ],
    package: { lengthCm: 106.7, widthCm: 45.7, heightCm: 10.2, weightKg: 4.2 },
    logistics: {
      decision: 'freight', packageTotalCm: 162.6, requiresConfirmation: false,
      methods: [
        { label: '黑貓宅急便', enabled: false, option: '', feeTwd: null, sellerPays: false },
        { label: '蝦皮店到店 - 隔日到貨', enabled: false, option: '', feeTwd: null, sellerPays: false },
        { label: '蝦皮店到店', enabled: false, option: '', feeTwd: null, sellerPays: false },
        { label: '7-ELEVEN', enabled: false, option: '', feeTwd: null, sellerPays: false },
        { label: '新竹物流', enabled: true, option: 'S170', feeTwd: null, sellerPays: false },
        { label: '全家', enabled: false, option: '', feeTwd: null, sellerPays: false },
        { label: '賣家宅配：大型/超重物品運送', enabled: true, option: '', feeTwd: 100, sellerPays: false },
        { label: '嘉里快遞', enabled: false, option: '', feeTwd: null, sellerPays: false },
        { label: '店到家宅配', enabled: false, option: '', feeTwd: null, sellerPays: false }
      ]
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
  assert.equal(payload.schemaVersion, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.listingPolicy)), {
    decision: 'auto', matchKey: 'sku', allowCreate: false, existingListingIds: [],
    onZero: 'create-only-if-confirmed', onOne: 'update', onMultiple: 'block'
  });
  assert.equal(payload.attributes[0].value, 'HSS');
  assert.equal(payload.publishMode, 'auto');
  const hct = payload.logistics.methods.find((row) => row.label === '新竹物流');
  const sellerLargeHome = payload.logistics.methods.find((row) => row.label === '賣家宅配：大型/超重物品運送');
  assert.equal(hct.enabled, true);
  assert.equal(hct.option, 'S170');
  assert.equal(hct.feeTwd, null);
  assert.equal(sellerLargeHome.enabled, true);
  assert.equal(sellerLargeHome.feeTwd, 100);
  assert.equal(sellerLargeHome.sellerPays, false);
  assert.equal(payload.logistics.methods.length, 9);
  assert.equal(payload.logistics.methods.filter((row) => row.enabled).length, 2);
  assert.equal(payload.logistics.methods
    .filter((row) => !['新竹物流', '賣家宅配：大型/超重物品運送'].includes(row.label))
    .every((row) => row.enabled === false), true);
  assert.equal(payload.preorder.enabled, false);
  assert.equal(payload.preorder.days, 1);
  assert.doesNotMatch(serialized, /7400|must-not-leak|accessToken|costPrice/);
});

test('handoff refuses incomplete identity data', () => {
  const { api } = loadBridge();
  const payload = rawPayload();
  payload.sku = '';
  assert.throws(() => api.sanitizePayload(payload), /資料不完整/);
});

test('handoff refuses an unsafe or contradictory listing policy', () => {
  const { api } = loadBridge();
  const payload = rawPayload();
  payload.listingPolicy.allowCreate = true;
  assert.throws(() => api.sanitizePayload(payload), /防重規則不完整/);
  payload.listingPolicy.decision = 'new';
  assert.doesNotThrow(() => api.sanitizePayload(payload));
  payload.listingPolicy.existingListingIds = ['4116442'];
  assert.throws(() => api.sanitizePayload(payload), /防重規則不完整/);
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
