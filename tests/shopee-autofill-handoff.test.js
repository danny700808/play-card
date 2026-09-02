'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('operations-shopee-autofill-handoff-v1.js', 'utf8');

function rawPayload() {
  const now = Date.now();
  return {
    schemaVersion: 7,
    workflowVersion: 'youzi-four-channel-listing-v3',
    jobId: 'job-shopee-v2-1',
    snapshotId: 'snapshot-shopee-v2-1',
    snapshotFingerprint: 'a'.repeat(64),
    nonce: '0123456789abcdef0123456789abcdef',
    createdAt: now,
    expiresAt: now + 10 * 60 * 1000,
    productId: 'guitar-1',
    easyStoreProductId: '16403950',
    easyStoreUrl: 'https://admin.easystore.co/products/16403950',
    sku: '1040160-1',
    title: 'Ibanez AZES40-PRB 電吉他',
    publishMode: 'auto',
    variantGroup: null,
    listingPolicy: {
      mode: 'create-new', identitySource: 'new-draft', platformListingIds: [],
      preflightSkuSearch: false, uncertainSubmitRecovery: 'exact-sku-only'
    },
    categoryPath: ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯'],
    brand: 'Ibanez',
    advancedDescription: {
      mode: 'seller-center-native-file-upload-interleaved', source: 'prepared-text-blocks-and-downloaded-local-image-files',
      preparedBeforeNavigation: true, skipEasyStoreDescriptionImport: true,
      transferImagesThroughShopeeNativeUploader: true, memoryOnlyImageStaging: false,
      desktopDownloadRequired: true, dedicatedLocalStagingDirectoryRequired: true,
      uploadEntry: '商品描述/新增圖片/從電腦裝置上傳',
      deleteLocalStagingOnlyAfterReloadVerification: true, neverDeleteUntrackedUserFiles: true,
      directExternalImageUrlPasteForbidden: true,
      waitForEveryNativeImageUploadBeforeUpdate: true,
      verifyNativeImageCountAndInterleavedOrderBeforeUpdate: true,
      rejectZeroImageDescriptionBeforePublish: true,
      capabilityProbe: 'seller-center-rich-editor-and-file-input', contentFingerprint: 'b'.repeat(64),
      requiredFirstImageUrl: 'https://example.com/green-hero.jpg',
      fixedLastTwoImageUrls: ['https://example.com/promo-1.jpg', 'https://example.com/promo-2.jpg'],
      imageUrls: [
        'https://example.com/green-hero.jpg',
        'https://example.com/spec.jpg',
        'https://example.com/usage.jpg',
        'https://example.com/promo-1.jpg',
        'https://example.com/promo-2.jpg'
      ],
      expectedImageCount: 5,
      textBlocks: [
        { key: 'features', text: '商品特色\n1. 已驗證特色' },
        { key: 'specifications', text: '商品規格\n型號：AZES40-PRB' },
        { key: 'usage', text: '使用方式／適用情境\n1. 演奏前先調音' },
        { key: 'actual-product-notice', text: '商品圖片與文字說明僅供參考。' },
        { key: 'warranty-support-notice', text: '出貨與保固依商品類型辦理。' }
      ],
      blockPlan: [
        { type: 'text', key: 'features' },
        { type: 'image', key: 'product-image-1', imageUrl: 'https://example.com/green-hero.jpg' },
        { type: 'text', key: 'specifications' },
        { type: 'image', key: 'product-image-2', imageUrl: 'https://example.com/spec.jpg' },
        { type: 'text', key: 'usage' },
        { type: 'image', key: 'product-image-3', imageUrl: 'https://example.com/usage.jpg' },
        { type: 'text', key: 'actual-product-notice' },
        { type: 'text', key: 'warranty-support-notice' },
        { type: 'image', key: 'description-promo-1', imageUrl: 'https://example.com/promo-1.jpg' },
        { type: 'image', key: 'description-promo-2', imageUrl: 'https://example.com/promo-2.jpg' }
      ]
    },
    priceAdjustment: {
      enabled: true, synchronizeWithEasyStorePrice: true
    },
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
  assert.equal(payload.schemaVersion, 7);
  assert.equal(payload.workflowVersion, 'youzi-four-channel-listing-v3');
  assert.equal(payload.jobId, 'job-shopee-v2-1');
  assert.deepEqual(JSON.parse(JSON.stringify(payload.listingPolicy)), {
    mode: 'create-new', identitySource: 'new-draft', platformListingIds: [],
    preflightSkuSearch: false, uncertainSubmitRecovery: 'exact-sku-only'
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
  assert.equal(payload.advancedDescription.mode, 'seller-center-native-file-upload-interleaved');
  assert.equal(payload.advancedDescription.skipEasyStoreDescriptionImport, true);
  assert.equal(payload.advancedDescription.memoryOnlyImageStaging, false);
  assert.equal(payload.advancedDescription.desktopDownloadRequired, true);
  assert.equal(payload.advancedDescription.expectedImageCount, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.advancedDescription.imageUrls)), [
    'https://example.com/green-hero.jpg',
    'https://example.com/spec.jpg',
    'https://example.com/usage.jpg',
    'https://example.com/promo-1.jpg',
    'https://example.com/promo-2.jpg'
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(payload.priceAdjustment)), {
    enabled: true, synchronizeWithEasyStorePrice: true
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'costPrice'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'accessToken'), false);
  assert.doesNotMatch(serialized, /must-not-leak|"accessToken"|"costPrice"/);
});

test('handoff refuses incomplete identity data', () => {
  const { api } = loadBridge();
  const payload = rawPayload();
  payload.sku = '';
  assert.throws(() => api.sanitizePayload(payload), /資料不完整/);
});

test('handoff requires the immutable EasyStore advanced-description plan', () => {
  const payload = rawPayload();
  delete payload.advancedDescription;
  assert.throws(() => loadBridge().api.sanitizePayload(payload), /資料不完整/);
  const wrongCount = rawPayload();
  wrongCount.advancedDescription.expectedImageCount = 1;
  assert.throws(() => loadBridge().api.sanitizePayload(wrongCount), /資料不完整/);
});

test('handoff refuses an unsafe or contradictory central platform policy', () => {
  const { api } = loadBridge();
  const payload = rawPayload();
  payload.listingPolicy.preflightSkuSearch = true;
  assert.throws(() => api.sanitizePayload(payload), /中央平台 ID 規則不完整/);
  payload.listingPolicy.preflightSkuSearch = false;
  assert.doesNotThrow(() => api.sanitizePayload(payload));
  payload.listingPolicy.platformListingIds = ['4116442'];
  assert.throws(() => api.sanitizePayload(payload), /中央平台 ID 規則不完整/);
});

test('handoff rejects schema 5 and never translates its retired listing decision', () => {
  const { api } = loadBridge();
  const payload = rawPayload();
  payload.schemaVersion = 5;
  payload.listingPolicy = {
    decision: 'existing', matchKey: 'sku', allowCreate: false,
    existingListingIds: ['4116442'], onZero: 'create-only-if-confirmed',
    onOne: 'update', onMultiple: 'block'
  };
  assert.throws(() => api.sanitizePayload(payload), /版本不相容/);
});

test('handoff preserves every localized add-variant field in schema 7', () => {
  const { api } = loadBridge();
  const payload = rawPayload();
  payload.publishMode = 'add-variant-to-existing';
  payload.listingPolicy = {
    mode: 'add-variant-to-existing', identitySource: 'central-platform-id',
    platformListingIds: ['4116442'], preflightSkuSearch: false,
    uncertainSubmitRecovery: 'exact-sku-only'
  };
  payload.variantGroup = {
    parentProductId: 'parent-1', parentSku: 'PARENT-100', parentName: '原商品',
    attributeName: '顏色', parentAttributeValue: '原木色', attributeValue: '深木色',
    parentImageUrl: 'https://example.com/parent-zh-tw.jpg',
    imageUrl: 'https://example.com/child-zh-tw.jpg'
  };
  const sanitized = api.sanitizePayload(payload);
  assert.deepEqual(JSON.parse(JSON.stringify(sanitized.variantGroup)), payload.variantGroup);
  assert.deepEqual(JSON.parse(JSON.stringify(sanitized.listingPolicy)), payload.listingPolicy);
  assert.equal(JSON.stringify(sanitized).includes('onZero'), false);
  assert.equal(JSON.stringify(sanitized).includes('listingDecision'), false);
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
  assert.equal(posted[0].message.type, 'YOUZI_SHOPEE_AUTOFILL_QUEUE_V2');
  listeners.get('message')({
    source: window,
    origin: window.location.origin,
    data: { type: 'YOUZI_SHOPEE_AUTOFILL_ACK_V2', nonce: rawPayload().nonce, ok: true }
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
