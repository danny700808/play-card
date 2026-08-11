'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

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
  assert.equal(helpers.overallPublishStatus({ easyStore: { status: 'failed' } }), 'partial-failed');
});
