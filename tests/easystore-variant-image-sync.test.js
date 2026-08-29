const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EasyStoreSync = require('../functions/easystoreCatalogSync.js');

test('EasyStore image_id is resolved to the exact product image bound to a variant', () => {
  const built = EasyStoreSync.buildCatalog([{
    id: 9001,
    title: 'Roland FP-30X',
    handle: 'roland-fp-30x',
    images: [
      { id: 101, src: 'https://cdn.example.com/fp30x-black.jpg' },
      { id: 102, src: 'https://cdn.example.com/fp30x-white.jpg' }
    ],
    variants: [
      { id: 201, sku: 'FP30X-BK', title: '黑色', image_id: 101, price: 26000 },
      { id: 202, sku: 'FP30X-WH', title: '白色', image_id: 102, price: 26000 }
    ]
  }]);

  assert.equal(built.rows.length, 2);
  assert.deepEqual(built.rows[0].variantImageUrls, ['https://cdn.example.com/fp30x-black.jpg']);
  assert.deepEqual(built.rows[1].variantImageUrls, ['https://cdn.example.com/fp30x-white.jpg']);
  assert.equal(built.rows[0].variantImageId, '101');
  assert.equal(built.rows[1].variantImageId, '102');
  assert.equal(built.rows[0].productVariantCount, 2);
  assert.equal(built.rows[0].hasMultipleVariants, true);
  assert.equal(built.rows[0].hasVariantImage, true);
  assert.equal(built.rows[0].automaticVariantImageUrl, 'https://cdn.example.com/fp30x-black.jpg');
  assert.equal(built.rows[0].variantImageStatus, 'available');
});

test('an unbound multi-variant SKU stays missing instead of borrowing another colour image', () => {
  const built = EasyStoreSync.buildCatalog([{
    id: 9002,
    title: 'Colour product',
    images: [{ id: 301, src: 'https://cdn.example.com/shared-main.jpg' }],
    variants: [
      { id: 401, sku: 'COLOUR-RED', title: '紅色', image_id: 301 },
      { id: 402, sku: 'COLOUR-BLUE', title: '藍色', image_id: 0 }
    ]
  }]);

  assert.deepEqual(built.rows[0].variantImageUrls, ['https://cdn.example.com/shared-main.jpg']);
  assert.deepEqual(built.rows[1].variantImageUrls, []);
  assert.equal(built.rows[1].hasVariantImage, false);
  assert.equal(built.rows[1].automaticVariantImageUrl, '');
  assert.equal(built.rows[1].variantImageStatus, 'missing');
  assert.ok(built.rows[1].parentImageUrls.includes('https://cdn.example.com/shared-main.jpg'));
});

test('a single-variant product safely uses its official main image without entering the missing list', () => {
  const built = EasyStoreSync.buildCatalog([{
    id: 9003,
    title: 'Single product',
    images: [{ id: 501, src: 'https://cdn.example.com/single-main.jpg' }],
    variants: [{ id: 601, sku: 'SINGLE-001', title: 'Default' }]
  }]);

  assert.equal(built.rows[0].hasVariantImage, false);
  assert.equal(built.rows[0].automaticVariantImageUrl, 'https://cdn.example.com/single-main.jpg');
  assert.equal(built.rows[0].variantImageStatus, 'single-main');
});

test('EasyStore publish state is normalized for exact-SKU central reconciliation', () => {
  assert.equal(EasyStoreSync.productListingStatus({ status: 'published' }), 'active');
  assert.equal(EasyStoreSync.productListingStatus({ published: false }), 'draft');
  assert.equal(EasyStoreSync.productListingStatus({ status: 'unpublished' }), 'inactive');
  assert.equal(EasyStoreSync.productListingStatus({}), 'mapped');

  const built = EasyStoreSync.buildCatalog([{
    id: 9004,
    title: 'Published product',
    status: 'published',
    variants: [{ id: 701, sku: 'LIVE-001', title: 'Default' }]
  }]);
  assert.equal(built.rows[0].listingStatus, 'active');
});

test('numeric image identifiers are not mistaken for website image URLs', () => {
  assert.deepEqual(EasyStoreSync.collectImages({ image: 12345 }), []);
  assert.equal(EasyStoreSync.variantImageReferenceId({ image_id: 0 }), '');
});

test('product inventory exposes the EasyStore API sync action and pending state', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'operations-phase1.js'), 'utf8');
  assert.match(source, /data-action="sync-easystore-api"/);
  assert.match(source, /EasyStore API 同步/);
  assert.match(source, /EasyStore 同步中…/);
  assert.doesNotMatch(source, /inferredFrom:'官網同步'/);
  assert.match(source, /data-action="product-platform-status-edit"/);
  assert.match(source, /openProductPlatformStatus\(el\.dataset\.id\)/);
});
