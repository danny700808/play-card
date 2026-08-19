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

test('listing snapshot applies fixed shop promos, MOMO delivery and compliance policy', () => {
  const snapshot = helpers.buildListingSnapshot('p-fixed', {
    internalSku: '1040160', internalName: 'Ibanez AZES40', currentStock: 1,
    easyStorePrice: 14800, momoPrice: 14800, coupangPrice: 14800
  }, {
    productDescription: '台灣繁體商品介紹', listingImageUrls: ['https://example.com/main.jpg'],
    shippingDecision: 'freight', packageLengthCm: 110, packageWidthCm: 45, packageHeightCm: 12, packageWeightKg: 5,
    enabledPlatforms: { easyStoreShopee: true, momo: true, coupang: true }
  });
  assert.match(snapshot.bodyHtml, /product-listing-description-promo-1\.jpg/);
  assert.match(snapshot.bodyHtml, /product-listing-description-promo-2\.jpg/);
  assert.deepEqual(snapshot.momoDelivery, { method: 'third-party', locationCode: '000001', locationLabel: '台中市圓環東路347號', carrier: '新竹物流' });
  assert.equal(snapshot.momoCatalogPolicy.targetListings, 1000);
  assert.equal(snapshot.momoCatalogPolicy.reservedSlots, 0);
  assert.equal(snapshot.momoCatalogPolicy.zeroStockAction, 'keep-published-by-default');
  assert.equal(snapshot.momoCatalogPolicy.preserveSoldOutWithSales, true);
  assert.equal(snapshot.regulatoryPolicy.ncc, 'fill-only-when-verified');
  assert.equal(snapshot.automationPolicy.duplicateGuard.reuseExistingDraft, true);
  assert.equal(snapshot.automationPolicy.duplicateGuard.neverCreateNewOnRetry, true);
  assert.deepEqual(snapshot.automationPolicy.publishVerification.requiredChecks, ['platform-list', 'official-catalog', 'exact-sku', 'price', 'stock', 'status']);
  assert.equal(snapshot.automationPolicy.momoPublishRecovery.resumeSameDraft, true);
  assert.equal(snapshot.automationPolicy.momoPublishRecovery.neverCreateReplacementDraft, true);
  assert.ok(snapshot.automationPolicy.momoPublishRecovery.reapplyWhenCleared.includes('third-party-location'));
  assert.equal(snapshot.automationPolicy.browserTabs.keepOneAuthenticatedAnchorPerPlatform, true);
});

test('MOMO publish verification rejects a success dialog when persisted fields were cleared', () => {
  const result = helpers.evaluateMomoPublishVerification(
    { sku: '2500118', momoPrice: 350, stock: 4 },
    {
      sku: '2500118', status: '暫存', stock: 0, price: null,
      platformListMatched: true, officialCatalogMatched: false, successDialogShown: true
    }
  );
  assert.equal(result.verified, false);
  assert.equal(result.needsRetry, true);
  assert.deepEqual(result.reasons, ['still-draft', 'blank-price', 'expected-stock-mismatch', 'missing-from-official-catalog']);
  assert.equal(result.recoveryAction, 'resume-same-draft-and-reapply-cleared-fields');
  assert.equal(result.neverCreateReplacementDraft, true);
});

test('MOMO publish verification accepts matching list and official catalog data', () => {
  const result = helpers.evaluateMomoPublishVerification(
    { sku: '2500118', momoPrice: 350, stock: 4 },
    {
      sku: '2500118', status: '上架', stock: 4, price: 350,
      platformListMatched: true, officialCatalogMatched: true
    }
  );
  assert.equal(result.verified, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.recoveryAction, 'none');
});

test('listing snapshot keeps seven gallery slots and moves overflow product images before the two fixed description promos', () => {
  const productImages = Array.from({ length: 12 }, (_, index) => `https://example.com/product-${index + 1}.jpg`);
  const snapshot = helpers.buildListingSnapshot('p-images', {
    internalSku: 'IMG-12', internalName: '十二張圖片商品', currentStock: 1,
    easyStorePrice: 1200, momoPrice: 1200, coupangPrice: 1200
  }, {
    productDescription: '完整商品介紹', listingImageUrls: productImages,
    enabledPlatforms: { easyStoreShopee: true, momo: true, coupang: true }
  });

  assert.equal(snapshot.productImageUrls.length, 12);
  assert.equal(snapshot.images.length, 7);
  assert.deepEqual(snapshot.images.slice(0, 6), productImages.slice(0, 6));
  assert.match(snapshot.images[6], /product-listing-store-promo\.png$/);
  assert.deepEqual(snapshot.descriptionImageUrls, productImages.slice(6));
  assert.ok(snapshot.bodyHtml.indexOf('product-7.jpg') < snapshot.bodyHtml.indexOf('product-listing-description-promo-1.jpg'));
  assert.ok(snapshot.bodyHtml.indexOf('product-listing-description-promo-1.jpg') < snapshot.bodyHtml.indexOf('product-listing-description-promo-2.jpg'));
  assert.ok(snapshot.momoHtml.indexOf('product-7.jpg') < snapshot.momoHtml.indexOf('product-listing-description-promo-1.jpg'));
  assert.ok(snapshot.coupangDescriptionHtml.indexOf('product-7.jpg') < snapshot.coupangDescriptionHtml.indexOf('product-listing-description-promo-1.jpg'));
  assert.equal(snapshot.imagePolicy.galleryMaximum, 7);
  assert.equal(snapshot.imagePolicy.sourceImageMaximum, 12);
});

test('Coupang uses the second clean product image as main while MOMO keeps the green template first', () => {
  const productImages = Array.from({ length: 6 }, (_, index) => `https://example.com/product-${index + 1}.jpg`);
  const snapshot = helpers.buildListingSnapshot('p-platform-images', {
    internalSku: 'PLATFORM-IMG', internalName: '平台主圖測試', currentStock: 1,
    easyStorePrice: 1200, momoPrice: 1200, coupangPrice: 1200
  }, {
    productDescription: '完整商品介紹', listingImageUrls: productImages,
    enabledPlatforms: { easyStoreShopee: true, momo: true, coupang: true }
  });

  const momo = helpers.platformPayloadSnapshot('MOMO', snapshot);
  const coupang = helpers.platformPayloadSnapshot('Coupang', snapshot);
  assert.equal(momo.images[0], productImages[0]);
  assert.equal(coupang.images[0], productImages[1]);
  assert.equal(coupang.images[1], productImages[0]);
  assert.equal(coupang.imagePolicy.brandedGreenTemplateAllowedAsMain, false);
  assert.deepEqual(helpers.coupangMissingFields(snapshot), []);
});

test('Coupang stops before queueing when no second clean product image exists', () => {
  const snapshot = helpers.buildListingSnapshot('p-coupang-image-missing', {
    internalSku: 'COUPANG-ONE-IMG', internalName: '只有綠底主圖', currentStock: 1, coupangPrice: 1200
  }, {
    productDescription: '完整商品介紹', listingImageUrls: ['https://example.com/green-template.jpg'],
    enabledPlatforms: { easyStoreShopee: false, momo: false, coupang: true }
  });
  assert.match(helpers.coupangMissingFields(snapshot).join('、'), /酷澎乾淨主圖/);
});

test('one-click listing always targets all channels and falls back to the product price', () => {
  const snapshot = helpers.buildListingSnapshot('one-click-all', {
    internalSku: 'ONE-CLICK-ALL', internalName: '木製吉他腳踏板', currentStock: 2, storePrice: 500
  }, {
    productDescription: '木製吉他腳踏板，適合演奏時支撐腳部使用。',
    listingImageUrls: ['https://example.com/green.jpg', 'https://example.com/clean.jpg'],
    enabledPlatforms: { easyStoreShopee: false, momo: false, coupang: false }
  });

  assert.equal(snapshot.enabledEasyStoreShopee, true);
  assert.equal(snapshot.enabledMomo, true);
  assert.equal(snapshot.enabledCoupang, true);
  assert.equal(snapshot.easyStorePrice, 500);
  assert.equal(snapshot.momoPrice, 500);
  assert.equal(snapshot.coupangPrice, 500);
});

test('publish results become product-level platform status without claiming queued work is live', () => {
  const status = helpers.platformListingStatusFromPublish({}, {
    easyStore: { status: 'created', productId: 'es-1', message: '已建立' },
    momo: { status: 'awaiting-store-agent', message: '等待店內電腦' },
    coupang: { status: 'failed', message: '需處理' }
  });
  assert.equal(status.easyStore.status, 'active');
  assert.equal(status.easyStore.listingId, 'es-1');
  assert.equal(status.momo.status, 'queued');
  assert.equal(status.coupang.status, 'error');
});

test('EasyStore payload publishes one exact SKU with stock, price, package and at most seven gallery images', () => {
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
  assert.equal(snapshot.images.length, 7);
  assert.equal(body.inventory_management, 'easystore');
  assert.equal(body.images.length, 7);
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
  assert.doesNotMatch(helpers.momoMissingFields(empty).join('、'), /MOMO 分類/);
  assert.doesNotMatch(helpers.coupangMissingFields(empty).join('、'), /酷澎分類/);
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
    ['Body Material', 'Poplar'], ['Pickup Configuration', 'HSS'],
    ['Quantity', '1'], ['Quantity per Pack', '1']
  ]);
  assert.equal(payload.logistics.packageTotalCm, 162.6);
  assert.deepEqual(payload.logistics.methods.find((row) => row.label === '新竹物流'), {
    label: '新竹物流', enabled: true, option: 'S170', feeTwd: null, sellerPays: false
  });
  assert.deepEqual(payload.logistics.methods.find((row) => row.label === '賣家宅配：大型/超重物品運送'), {
    label: '賣家宅配：大型/超重物品運送', enabled: false, option: '', feeTwd: null, sellerPays: false
  });
  assert.deepEqual(
    payload.logistics.methods.filter((row) => row.enabled).map((row) => row.label),
    ['新竹物流']
  );
  assert.equal(payload.logistics.methods.length, 9);
  assert.ok(payload.logistics.methods
    .filter((row) => row.label !== '新竹物流')
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
  assert.deepEqual(
    helpers.shopeeCategorySegments('愛好與收藏品 > 樂器與配件 > 吉他與貝斯 > 電吉他', { title: 'Ibanez AZES40 電吉他' }),
    ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯']
  );
});

test('music products choose one controlled Shopee family instead of inheriting the guitar branch', () => {
  assert.deepEqual(helpers.shopeeCategorySegments('樂器與配件 > 電鋼琴', { title: 'Roland FP-30X 電鋼琴' }).slice(0, 3),
    ['愛好與收藏品', '樂器與樂器配件', '鍵盤樂器']);
  assert.deepEqual(helpers.shopeeCategorySegments('樂器與配件 > 電子鼓', { title: 'NUX DM-210 電子鼓' }).slice(0, 3),
    ['愛好與收藏品', '樂器與樂器配件', '打擊樂器']);
  assert.deepEqual(helpers.shopeeCategorySegments('樂器與配件 > 長笛', { title: 'Yamaha YFL-212 長笛' }).slice(0, 3),
    ['愛好與收藏品', '樂器與樂器配件', '管樂器']);
  assert.deepEqual(helpers.shopeeCategorySegments('樂器與配件 > 吉他弦', { title: 'Elixir 吉他弦' }).slice(0, 3),
    ['愛好與收藏品', '樂器與樂器配件', '樂器配件']);
  assert.deepEqual(
    helpers.shopeeCategorySegments('愛好與收藏品 > 樂器與樂器配件 > 弦樂器 > 吉他、貝斯', { title: 'Elixir 吉他弦' }),
    ['愛好與收藏品', '樂器與樂器配件', '樂器配件']
  );
  assert.deepEqual(
    helpers.shopeeCategorySegments('愛好與收藏品 > 樂器與樂器配件 > 樂器配件 > 效果器', { title: 'Ibanez AZES40 電吉他' }),
    ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯']
  );
});

test('Shopee helper leaves Hsinchu Logistics off when package limits are incomplete or exceeded', () => {
  const missing = helpers.buildShopeeLogistics({ shippingDecision: 'freight', packageLengthCm: 100, packageWidthCm: 40 });
  assert.equal(missing.methods.find((row) => row.label === '新竹物流').enabled, false);
  assert.deepEqual(missing.methods.find((row) => row.label === '賣家宅配：大型/超重物品運送'), {
    label: '賣家宅配：大型/超重物品運送', enabled: false, option: '', feeTwd: null, sellerPays: false
  });
  assert.equal(missing.requiresConfirmation, true);

  const tooHeavy = helpers.buildShopeeLogistics({
    shippingDecision: 'freight', packageLengthCm: 100, packageWidthCm: 40, packageHeightCm: 20, packageWeightKg: 21
  });
  assert.equal(tooHeavy.methods.find((row) => row.label === '新竹物流').enabled, false);
  assert.deepEqual(tooHeavy.methods.find((row) => row.label === '賣家宅配：大型/超重物品運送'), {
    label: '賣家宅配：大型/超重物品運送', enabled: false, option: '', feeTwd: null, sellerPays: false
  });
  assert.ok(tooHeavy.methods
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
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '新竹物流').enabled, true);
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '新竹物流').option, 'S90');
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '黑貓宅急便').enabled, false);
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '嘉里快遞').enabled, false);
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '賣家宅配：大型/超重物品運送').enabled, false);
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
  assert.match(source, /version: '2026\.08\.13-shopee-taxonomy-v5'/);
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

test('MOMO and Coupang categories use official auto recommendation when no code was provided', () => {
  const snapshot = { title: '敦煌牌 中胡弦套裝', shopeeCategoryPath: '愛好與收藏品 > 樂器與樂器配件 > 樂器配件' };
  const momo = helpers.platformCategoryResolution('MOMO', snapshot, {});
  const coupang = helpers.platformCategoryResolution('Coupang', { ...snapshot, coupangCategoryCode: '79995' }, {});
  assert.equal(momo.mode, 'auto');
  assert.equal(momo.scope, 'music-instruments-only');
  assert.deepEqual(momo.allowedRootNames, ['樂器', '樂器配件']);
  assert.match(momo.hint, /限定根分類：樂器／樂器配件/);
  assert.equal(coupang.mode, 'provided');
  assert.equal(coupang.code, '79995');
  assert.equal(coupang.scope, 'music-instruments-only');
});

test('new SKU can safely target an existing parent as a platform variant', () => {
  const parent = {
    internalSku: 'PARENT-100', internalName: '既有商品', sourceProductId: 'es-parent',
    platformMappings: {
      easyStore: { productId: 'es-parent', variantIds: ['es-old'] },
      shopee: { itemId: 'shopee-parent' },
      momo: { goodsCode: 'momo-parent', goodsdtCode: 'momo-parent-detail' },
      coupang: { vendorItemId: 'coupang-parent' }
    }
  };
  const snapshot = helpers.buildListingSnapshot('child-1', {
    internalSku: 'CHILD-BLUE', internalName: '新顏色', currentStock: 2,
    easyStorePrice: 26000, momoPrice: 26000, coupangPrice: 26000
  }, {
    listingMode: 'add-variant', variantParentProductId: 'parent-1',
    variantAttributeName: '顏色', variantParentAttributeValue: '黑色', variantAttributeValue: '藍色',
    variantParentImageUrl: 'https://example.com/parent-source.jpg',
    variantChildImageUrl: 'https://example.com/blue-source.jpg',
    generatedListingImages: [{
      status: 'ready', localizationStatus: 'completed',
      sourceImageUrl: 'https://example.com/blue-source.jpg', url: 'https://example.com/blue-zh-tw.jpg'
    }],
    productDescription: '商品介紹', listingImageUrls: ['https://example.com/other-zh-tw.jpg', 'https://example.com/blue-zh-tw.jpg']
  }, parent, {
    generatedListingImages: [{
      status: 'ready', localizationStatus: 'completed',
      sourceImageUrl: 'https://example.com/parent-source.jpg', url: 'https://example.com/parent-zh-tw.jpg'
    }]
  });

  assert.equal(snapshot.listingMode, 'add-variant');
  assert.equal(snapshot.variantParentProductId, 'parent-1');
  assert.equal(snapshot.variantParentSku, 'PARENT-100');
  assert.equal(snapshot.variantParentEasyStoreProductId, 'es-parent');
  assert.equal(snapshot.variantParentImageUrl, 'https://example.com/parent-zh-tw.jpg');
  assert.equal(snapshot.variantChildImageUrl, 'https://example.com/blue-zh-tw.jpg');
  assert.equal(snapshot.images[0], 'https://example.com/other-zh-tw.jpg');
  assert.deepEqual(snapshot.shopeeExistingListingIds, ['shopee-parent']);
  assert.deepEqual(helpers.buildPlatformQueuePolicy({}, 'MOMO', snapshot), {
    mode: 'add-variant-to-existing', matchKey: 'parent-listing-id+sku', sku: 'CHILD-BLUE',
    existingListingIds: ['momo-parent|momo-parent-detail'], parentProductId: 'parent-1', parentSku: 'PARENT-100',
    variantAttributeName: '顏色', variantParentAttributeValue: '黑色', variantAttributeValue: '藍色',
    variantParentImageUrl: 'https://example.com/parent-zh-tw.jpg', variantImageUrl: 'https://example.com/blue-zh-tw.jpg',
    onZero: 'block', onOne: 'append-variant', onMultiple: 'block', onUncertain: 'block'
  });
  const shopee = helpers.buildShopeeAutofillPayload(snapshot, { productId: 'es-parent' });
  assert.equal(shopee.publishMode, 'add-variant-to-existing');
  assert.equal(shopee.listingPolicy.allowCreate, false);
  assert.equal(shopee.listingPolicy.onOne, 'append-variant');
  assert.deepEqual(shopee.variantGroup, {
    parentProductId: 'parent-1', parentSku: 'PARENT-100', parentName: '既有商品',
    attributeName: '顏色', parentAttributeValue: '黑色', attributeValue: '藍色',
    parentImageUrl: 'https://example.com/parent-zh-tw.jpg', imageUrl: 'https://example.com/blue-zh-tw.jpg'
  });
});

test('variant representative source images never publish before their localized outputs exist', () => {
  const snapshot = helpers.buildListingSnapshot('child-2', {
    internalSku: 'CHILD-RED', internalName: '紅色細項', currentStock: 1,
    easyStorePrice: 1000, momoPrice: 1000, coupangPrice: 1000
  }, {
    listingMode: 'add-variant', variantParentProductId: 'parent-2',
    variantAttributeName: '顏色', variantParentAttributeValue: '黑色', variantAttributeValue: '紅色',
    variantParentImageUrl: 'https://example.com/parent-source.jpg',
    variantChildImageUrl: 'https://example.com/red-source.jpg',
    productDescription: '商品介紹', listingImageUrls: ['https://example.com/gallery.jpg']
  }, { internalSku: 'PARENT-200', sourceProductId: 'es-parent-2' }, {});

  const missing = helpers.easyStoreMissingFields(snapshot);
  assert.ok(missing.includes('原商品代表圖的繁體完成版'));
  assert.ok(missing.includes('新細項代表圖的繁體完成版'));
  assert.equal(snapshot.variantParentImageUrl, '');
  assert.equal(snapshot.variantChildImageUrl, '');
});

test('variant publishing blocks when a parent platform listing is missing or ambiguous', () => {
  const missing = helpers.buildPlatformQueuePolicy({}, 'Coupang', {
    listingMode: 'add-variant', productId: 'child', sku: 'CHILD', variantParentProductId: 'parent',
    variantParentSku: 'PARENT', variantAttributeName: '尺寸', variantParentAttributeValue: '小', variantAttributeValue: '大', variantParentPlatformMappings: {}
  });
  assert.equal(missing.mode, 'block-missing-parent');
  assert.equal(missing.onZero, 'block');

  const ambiguous = helpers.buildPlatformQueuePolicy({}, 'Coupang', {
    listingMode: 'add-variant', productId: 'child', sku: 'CHILD', variantParentProductId: 'parent',
    variantParentSku: 'PARENT', variantAttributeName: '尺寸', variantParentAttributeValue: '小', variantAttributeValue: '大',
    variantParentPlatformMappings: { coupang: { vendorItemIds: ['1', '2'] } }
  });
  assert.equal(ambiguous.mode, 'block-duplicate-parent');
});
