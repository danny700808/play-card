'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');

const originalLoad = Module._load;
Module._load = function mockFirebase(request, parent, isMain) {
  if (request === 'firebase-functions/v2/https') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    return { onCall: (_options, handler) => handler, HttpsError };
  }
  if (request === 'firebase-functions/params') return { defineSecret: () => ({ value: () => '' }) };
  if (request === 'firebase-admin') {
    const firestore = () => ({ collection: () => { throw new Error('database not used in helper tests'); } });
    firestore.FieldValue = { serverTimestamp: () => ({ __serverTimestamp: true }) };
    return { firestore };
  }
  return originalLoad(request, parent, isMain);
};

const publish = require('../functions/productListingPublish');
Module._load = originalLoad;
const helpers = publish._test;

test('one canonical product description becomes safe marketplace HTML', () => {
  const html = helpers.productDescriptionToSafeHtml('好用的商品<script>alert(1)</script>\n\n商品特色\n1. 第一點\n2. 第二點\n\n商品規格\n型號：A&B');
  assert.equal(html, '<p>好用的商品&lt;script&gt;alert(1)&lt;/script&gt;</p><h3>商品特色</h3><ul><li>第一點</li><li>第二點</li></ul><h3>商品規格</h3><p>型號：A&amp;B</p>');
});

test('EasyStore payload publishes one exact SKU with stock, price, package and at most nine images', () => {
  const listingCase = {
    researchedProductName: 'Ibanez AZES40-MGR 電吉他',
    productDescription: '適合入門與日常練習。\n\n商品特色\n1. 輕巧好彈\n\n商品規格\n型號：AZES40-MGR',
    listingImageUrls: Array.from({ length: 12 }, (_, index) => `https://example.com/${index}.jpg`),
    packageLengthCm: 106.7, packageWidthCm: 45.7, packageHeightCm: 10.2, packageWeightKg: 4.2,
    enabledPlatforms: { easyStoreShopee: true, momo: false, coupang: false }
  };
  const snapshot = helpers.buildListingSnapshot('p1', {
    internalSku: ' 1040160-1 ', currentStock: 3, easyStorePrice: 14800, storePrice: 15900,
    latestPurchaseCost: 7400, barcode: '4549763289575'
  }, listingCase);
  const body = helpers.buildEasyStoreProductBody(snapshot, true).product;

  assert.equal(snapshot.sku, '1040160-1');
  assert.equal(snapshot.images.length, 9);
  assert.equal(body.inventory_management, 'easystore');
  assert.equal(body.images.length, 9);
  assert.equal(body.variants.length, 1);
  assert.deepEqual(body.variants[0], {
    sku: '1040160-1', barcode: '4549763289575', price: 14800, inventory_quantity: 3,
    width: 45.7, height: 10.2, length: 106.7, weight: 4.2, weight_unit: 'kg',
    inventory_policy: false, taxable: true, is_enabled: true, compare_at_price: 15900, cost_price: 7400
  });
  assert.match(body.body_html, /<h3>商品特色<\/h3>/);
  assert.match(body.published_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('zero stock remains published as out of stock and does not fail the EasyStore publish gate', () => {
  const snapshot = helpers.buildListingSnapshot('out-of-stock-1', {
    internalSku: 'OUT-OF-STOCK-1', currentStock: 0, easyStorePrice: 9800
  }, {
    researchedProductName: '缺貨但仍需上架的商品',
    productDescription: '商品資料完整，庫存稍後由既有庫存同步流程更新。',
    listingImageUrls: ['https://example.com/out-of-stock.jpg'],
    enabledPlatforms: { easyStoreShopee: true, momo: false, coupang: false }
  });
  const body = helpers.buildEasyStoreProductBody(snapshot, true).product;

  assert.equal(snapshot.stock, 0);
  assert.equal(body.variants[0].inventory_quantity, 0);
  assert.equal(body.variants[0].inventory_policy, false);
  assert.equal(body.variants[0].is_enabled, true);
  assert.match(body.published_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.deepEqual(helpers.easyStoreMissingFields(snapshot), []);
});

test('EasyStore duplicate guard matches only the exact normalized SKU', () => {
  const payload = { data: { products: [{ id: 99, variants: [
    { id: 1, sku: '1040160-10' },
    { id: 2, sku: "'1040160-1" }
  ] }] } };
  assert.deepEqual(helpers.exactEasyStoreMatches(payload, '1040160-1').map((row) => [row.productId, row.variantId]), [['99', '2']]);
});

test('each platform reports missing fields instead of pretending to publish', () => {
  const empty = { sku: '', title: '', description: '', images: [], easyStorePrice: null, momoGoodsName: '', momoCategoryCode: '', momoPrice: null, coupangTitle: '', coupangCategoryCode: '', coupangPrice: null };
  assert.deepEqual(helpers.easyStoreMissingFields(empty), ['SKU', '商品名稱', '完整商品介紹', '上架圖片', 'EasyStore 售價']);
  assert.ok(helpers.momoMissingFields(empty).includes('MOMO 分類'));
  assert.ok(helpers.coupangMissingFields(empty).includes('酷澎分類'));
  assert.equal(helpers.overallPublishStatus({ easyStore: { status: 'created' }, momo: { status: 'missing-fields' } }), 'needs-input');
  assert.equal(helpers.overallPublishStatus({ easyStore: { status: 'updated' }, shopee: { status: 'waiting-easystore-sync' } }), 'submitted');
  assert.equal(helpers.overallPublishStatus({ momo: { status: 'already-queued' }, coupang: { status: 'already-completed' } }), 'submitted');
  assert.equal(helpers.overallPublishStatus({ easyStore: { status: 'failed' } }), 'partial-failed');
});

test('Shopee helper payload maps researched guitar fields and large-item logistics without changing stock', () => {
  const snapshot = helpers.buildListingSnapshot('guitar-1', {
    internalSku: '1040160-1', currentStock: 0, easyStorePrice: 14800, brand: '舊資料品牌',
    model: 'AZES40-PRB', barcode: '4549763289575'
  }, {
    researchedProductName: 'Ibanez AZES40-PRB 電吉他',
    productDescription: '完整商品介紹',
    listingImageUrls: ['https://example.com/guitar.jpg'],
    brand: '舊資料品牌', shopeeBrand: 'Ibanez', model: 'AZES40-PRB', color: 'Purist Blue', identityStatus: 'confirmed',
    shopeeTitle: 'Ibanez AZES40-PRB 電吉他',
    shopeeListingDecision: 'new',
    shopeeCategoryPath: '愛好與收藏品 > 樂器與樂器配件 > 弦樂器 > 吉他、貝斯',
    shopeeAttributeValues: [
      { label: 'Body Material', value: 'Poplar', confidence: 'high', note: 'Ibanez 官方規格' },
      { label: 'Pickup Configuration', value: 'HSS', confidence: 'high', note: 'Ibanez 官方規格' }
    ],
    packageLengthCm: 106.7, packageWidthCm: 45.7, packageHeightCm: 10.2, packageWeightKg: 4.2,
    shippingDecision: 'freight', enabledPlatforms: { easyStoreShopee: true, momo: false, coupang: false }
  });
  const payload = helpers.buildShopeeAutofillPayload(snapshot, { productId: '16403950' });

  assert.equal(snapshot.stock, 0);
  assert.equal(payload.sku, '1040160-1');
  assert.equal(payload.schemaVersion, 4);
  assert.equal(payload.publishMode, 'auto');
  assert.deepEqual(payload.listingPolicy, {
    decision: 'new', matchKey: 'sku', allowCreate: true, existingListingIds: [],
    onZero: 'create-only-if-confirmed', onOne: 'update', onMultiple: 'block'
  });
  assert.equal(payload.brand, 'Ibanez');
  assert.deepEqual(payload.categoryPath, ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯']);
  assert.deepEqual(payload.attributes.map((row) => [row.label, row.value]), [
    ['Body Material', 'Poplar'], ['Pickup Configuration', 'HSS']
  ]);
  assert.equal(payload.logistics.packageTotalCm, 162.6);
  assert.deepEqual(payload.logistics.methods.find((row) => row.label === '新竹物流'), {
    label: '新竹物流', enabled: true, option: 'S170', feeTwd: null, sellerPays: false
  });
  assert.deepEqual(payload.logistics.methods.find((row) => row.label === '賣家宅配：大型/超重物品運送'), {
    label: '賣家宅配：大型/超重物品運送', enabled: true, option: '', feeTwd: 100, sellerPays: false
  });
  assert.deepEqual(
    payload.logistics.methods.filter((row) => row.enabled).map((row) => row.label),
    ['新竹物流', '賣家宅配：大型/超重物品運送']
  );
  assert.equal(payload.logistics.methods.length, 9);
  assert.ok(payload.logistics.methods
    .filter((row) => !['新竹物流', '賣家宅配：大型/超重物品運送'].includes(row.label))
    .every((row) => row.enabled === false));
  assert.deepEqual(payload.preorder, { enabled: false, days: 1 });
  assert.equal(payload.easyStoreUrl, 'https://admin.easystore.co/products/16403950');
  assert.match(payload.nonce, /^[a-f0-9]{32}$/);
  assert.equal(Object.hasOwn(payload, 'costPrice'), false);
});

test('legacy researched category wording is canonicalized before the EasyStore handoff', () => {
  assert.deepEqual(
    helpers.shopeeCategorySegments('樂器與配件 > 弦樂器 > 吉他、貝斯'),
    ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯']
  );
  assert.deepEqual(
    helpers.shopeeCategorySegments('愛好與收藏品 > 樂器與樂器配件 > 弦樂器 > 吉他、貝斯'),
    ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯']
  );
});

test('Shopee helper leaves Hsinchu Logistics off when package limits are incomplete or exceeded', () => {
  const missing = helpers.buildShopeeLogistics({ shippingDecision: 'freight', packageLengthCm: 100, packageWidthCm: 40 });
  assert.equal(missing.methods.find((row) => row.label === '新竹物流').enabled, false);
  assert.deepEqual(missing.methods.find((row) => row.label === '賣家宅配：大型/超重物品運送'), {
    label: '賣家宅配：大型/超重物品運送', enabled: true, option: '', feeTwd: 100, sellerPays: false
  });
  assert.equal(missing.requiresConfirmation, true);

  const tooHeavy = helpers.buildShopeeLogistics({
    shippingDecision: 'freight', packageLengthCm: 100, packageWidthCm: 40, packageHeightCm: 20, packageWeightKg: 21
  });
  assert.equal(tooHeavy.methods.find((row) => row.label === '新竹物流').enabled, false);
  assert.deepEqual(tooHeavy.methods.find((row) => row.label === '賣家宅配：大型/超重物品運送'), {
    label: '賣家宅配：大型/超重物品運送', enabled: true, option: '', feeTwd: 100, sellerPays: false
  });
  assert.ok(tooHeavy.methods
    .filter((row) => row.label !== '賣家宅配：大型/超重物品運送')
    .every((row) => row.enabled === false));
  assert.equal(tooHeavy.requiresConfirmation, true);
});

test('backend Hsinchu tariff boundaries stay aligned with the extension contract', () => {
  assert.equal(helpers.hsinchuSizeBand(140), 'S150');
  assert.equal(helpers.hsinchuSizeBand(140.1), 'S160');
  assert.equal(helpers.hsinchuSizeBand(160), 'S160');
  assert.equal(helpers.hsinchuSizeBand(160.1), 'S170');
  assert.equal(helpers.hsinchuSizeBand(170), 'S170');
  assert.equal(helpers.hsinchuSizeBand(170.1), 'S180');
});

test('manual shipping choice controls autofill and convenience limits are enforced when measurements are known', () => {
  const manualConvenience = helpers.buildShopeeLogistics({ shippingDecision: 'convenience' });
  assert.equal(manualConvenience.methods.find((row) => row.label === '蝦皮店到店').enabled, false);
  assert.equal(manualConvenience.methods.find((row) => row.label === '新竹物流').enabled, false);
  assert.equal(manualConvenience.packageTotalCm, null);
  assert.equal(manualConvenience.requiresConfirmation, true);

  const verifiedConvenience = helpers.buildShopeeLogistics({
    shippingDecision: 'convenience', packageLengthCm: 40, packageWidthCm: 30,
    packageHeightCm: 20, packageWeightKg: 4
  });
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '蝦皮店到店').enabled, true);
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '7-ELEVEN').enabled, true);
  assert.equal(verifiedConvenience.requiresConfirmation, false);

  const oversizedConvenience = helpers.buildShopeeLogistics({
    shippingDecision: 'convenience', packageLengthCm: 46, packageWidthCm: 30,
    packageHeightCm: 20, packageWeightKg: 4
  });
  assert.equal(oversizedConvenience.methods.find((row) => row.label === '蝦皮店到店').enabled, false);
  assert.equal(oversizedConvenience.requiresConfirmation, true);

  const overweightConvenience = helpers.buildShopeeLogistics({
    shippingDecision: 'convenience', packageLengthCm: 40, packageWidthCm: 30,
    packageHeightCm: 20, packageWeightKg: 5.1
  });
  assert.equal(overweightConvenience.methods.find((row) => row.label === '7-ELEVEN').enabled, false);
  assert.equal(overweightConvenience.requiresConfirmation, true);

  const manualHome = helpers.buildShopeeLogistics({
    shippingDecision: 'home', packageLengthCm: 106.7, packageWidthCm: 45.7,
    packageHeightCm: 10.2, packageWeightKg: 4.2
  });
  assert.equal(manualHome.methods.find((row) => row.label === '新竹物流').enabled, false);
  assert.equal(manualHome.requiresConfirmation, true);
});

test('Shopee persistence summary never stores one-time autofill handoff secrets', () => {
  const platforms = {
    easyStore: {
      status: 'created', message: 'EasyStore 商品已建立。', productId: '16403950', variantIds: ['v1']
    },
    shopee: {
      status: 'waiting-easystore-sync', message: '可啟動蝦皮助手。',
      autofillPayload: {
        nonce: '0123456789abcdef0123456789abcdef',
        createdAt: 1800000000000,
        expiresAt: 1800001800000,
        easyStoreProductId: '16403950',
        sku: '1040160-1'
      }
    },
    momo: {
      status: 'missing-fields', message: '請先補資料。', missingFields: ['MOMO 分類'], queueId: 'queue-1'
    }
  };
  const stored = helpers.summarizePlatformsForStorage(platforms);

  assert.deepEqual(stored, {
    easyStore: { status: 'created', message: 'EasyStore 商品已建立。' },
    shopee: { status: 'waiting-easystore-sync', message: '可啟動蝦皮助手。' },
    momo: { status: 'missing-fields', message: '請先補資料。', missingFields: ['MOMO 分類'], queueId: 'queue-1' }
  });
  assert.doesNotMatch(JSON.stringify(stored), /autofillPayload|nonce|createdAt|expiresAt|16403950|1040160-1/);
  assert.equal(platforms.shopee.autofillPayload.nonce, '0123456789abcdef0123456789abcdef');

  const source = fs.readFileSync('functions/productListingPublish.js', 'utf8');
  assert.match(source, /const platformsForStorage = summarizePlatformsForStorage\(platforms\)/);
  assert.match(source, /jobRef\.set\(\{ status, platforms: platformsForStorage,/);
  assert.match(source, /publishState: \{ jobId, status, platforms: platformsForStorage,/);
  assert.match(source, /return \{ ok:[\s\S]*status, platforms \};/);
  assert.match(source, /updatedBy: '商品上架', schemaVersion: 8/);
  assert.match(source, /version: '2026\.08\.12-shopee-autopublish-v4'/);
  assert.doesNotMatch(source, /updatedBy: '商品上架', schemaVersion: 7/);
});

test('platform listing identity always prefers existing IDs and otherwise requires exact SKU upsert', () => {
  const product = {
    platformMappings: {
      shopee: { itemIds: ['4116442', '4116442'] },
      momo: { goodsCode: 'MOMO-100', goodsdtCodes: ['MOMO-100-RED'] },
      coupang: { vendorItemIds: ['90001'] }
    }
  };
  const snapshot = { productId: 'p1', sku: 'SKU-1' };
  assert.deepEqual(helpers.platformListingIds(product, 'shopee'), ['4116442']);
  assert.deepEqual(helpers.platformListingIds(product, 'momo'), ['MOMO-100|MOMO-100-RED']);
  assert.deepEqual(helpers.platformListingIds(product, 'coupang'), ['90001']);
  assert.deepEqual(helpers.buildPlatformQueuePolicy(product, 'MOMO', snapshot), {
    mode: 'update-existing', matchKey: 'sku', sku: 'SKU-1',
    existingListingIds: ['MOMO-100|MOMO-100-RED'], onZero: 'create', onOne: 'update',
    onMultiple: 'block', onUncertain: 'block'
  });
  assert.deepEqual(helpers.buildPlatformQueuePolicy({}, 'Coupang', snapshot), {
    mode: 'upsert-by-exact-sku', matchKey: 'sku', sku: 'SKU-1', existingListingIds: [],
    onZero: 'create', onOne: 'update', onMultiple: 'block', onUncertain: 'block'
  });
  assert.equal(helpers.buildPlatformQueuePolicy({
    platformMappings: { coupang: { vendorItemIds: ['90001', '90002'] } }
  }, 'Coupang', snapshot).mode, 'block-duplicate');
});

test('platform queue fingerprint is stable for a retry and changes with listing content', () => {
  const snapshot = {
    productId: 'p1', sku: 'SKU-1', title: '商品', description: '內容', images: ['https://example.com/1.jpg'],
    stock: 0, packageLengthCm: 10, packageWidthCm: 20, packageHeightCm: 30, packageWeightKg: 1,
    momoGoodsName: 'MOMO 商品', momoSlogan: '', momoCategoryCode: 'CAT', momoPrice: 100,
    coupangTitle: '酷澎商品', coupangCategoryCode: 'C-CAT', coupangPrice: 110
  };
  const first = helpers.platformQueueFingerprint('MOMO', snapshot);
  const retry = helpers.platformQueueFingerprint('MOMO', { ...snapshot });
  const changed = helpers.platformQueueFingerprint('MOMO', { ...snapshot, momoPrice: 101 });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, retry);
  assert.notEqual(first, changed);
});

test('known Shopee mapping forces update policy even when the form still says new', () => {
  const snapshot = helpers.buildListingSnapshot('p1', {
    internalSku: 'SKU-1', platformMappings: { shopee: { itemId: '4116442' } }
  }, { shopeeListingDecision: 'new' });
  const payload = helpers.buildShopeeAutofillPayload(snapshot, { productId: '16965067' });
  assert.equal(snapshot.shopeeListingDecision, 'existing');
  assert.deepEqual(payload.listingPolicy.existingListingIds, ['4116442']);
  assert.equal(payload.listingPolicy.allowCreate, false);
});

test('Shopee autofill accepts explicit manual confirmation while unresolved identity stays blocked', () => {
  assert.equal(helpers.identityAllowsShopeeAutofill('confirmed'), true);
  assert.equal(helpers.identityAllowsShopeeAutofill('possible'), true);
  assert.equal(helpers.identityAllowsShopeeAutofill('conflict'), false);
  assert.equal(helpers.identityAllowsShopeeAutofill('conflict', true), true);
  assert.equal(helpers.identityAllowsShopeeAutofill('not_found', true), true);
  assert.equal(helpers.identityAllowsShopeeAutofill('conflict', false), false);
  assert.equal(helpers.identityAllowsShopeeAutofill('not_found'), false);
  assert.equal(helpers.identityAllowsShopeeAutofill(''), false);
});

test('listing snapshot keeps the manual identity confirmation audit fields', () => {
  const confirmedAt = { seconds: 1800000000, nanoseconds: 0 };
  const snapshot = helpers.buildListingSnapshot('guitar-2', { internalSku: 'GUITAR-2' }, {
    identityStatus: 'conflict',
    identityManualConfirmed: true,
    identityManualConfirmedAt: confirmedAt,
    identityManualConfirmedBy: 'manager@example.com',
    identityManualConfirmationNote: '已核對型號、顏色與照片。'
  });

  assert.equal(snapshot.identityStatus, 'conflict');
  assert.equal(snapshot.identityManualConfirmed, true);
  assert.equal(snapshot.identityManualConfirmedAt, confirmedAt);
  assert.equal(snapshot.identityManualConfirmedBy, 'manager@example.com');
  assert.equal(snapshot.identityManualConfirmationNote, '已核對型號、顏色與照片。');
});
