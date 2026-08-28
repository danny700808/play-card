const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'operations-phase1.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'storage.rules'), 'utf8');

test('商品編輯頁不論有圖或無圖都提供中央商品圖片上傳', () => {
  assert.match(source, /id="productMasterImageUpload"/);
  assert.match(source, /＋ 加入商品圖片/);
  assert.match(source, /尚無商品圖片/);
});

test('中央商品圖片上傳後直接保存主圖與圖片清單', () => {
  assert.match(source, /async function uploadProductMasterImages\(form,files\)/);
  assert.match(source, /path='ops-internal-products\/'\+id\+'\/images\/'/);
  assert.match(source, /imageUrl:images\[0\],imageUrls:images/);
  assert.match(source, /imageSource:'central-product-manual-upload'/);
  assert.match(source, /if\(event\.target\.id==='productMasterImageUpload'\)/);
});

test('中央商品圖片有獨立且受限的 Storage 規則', () => {
  assert.match(rules, /match \/ops-internal-products\/\{productId\}\/images\/\{fileName\}/);
  assert.match(rules, /request\.resource\.size < 8388608/);
  assert.match(rules, /image\/\(jpeg\|png\|webp\)/);
});
