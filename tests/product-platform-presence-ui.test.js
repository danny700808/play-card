const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'operations-phase1.js'), 'utf8');

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  let depth = 0;
  let opened = false;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') { depth += 1; opened = true; }
    if (source[index] === '}') depth -= 1;
    if (opened && depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body was not closed`);
}

test('商品資訊只顯示 1、5、9 開頭的可上架商品', () => {
  assert.match(functionBody('isSellableListingSku'), /\^\[159\]/);
  assert.match(functionBody('productFiltered'), /if\(!isSellableListingSku\(p\.sku\)\)return false/);
  assert.match(functionBody('openProductListingCase'), /只有 1、5、9 開頭的商品需要上架/);
});

test('四平台狀態只顯示有或沒有，沒有可直接進準備上架', () => {
  const body = functionBody('productPlatformStatusHtml');
  assert.match(body, />有<\/i>/);
  assert.match(body, />沒有<\/i>/);
  assert.match(body, /data-action="product-platform-missing"/);
  assert.match(functionBody('handleAction'), /product-platform-missing.*openProductListingCase/);
});

test('商品卡只保留列印條碼與準備上架操作', () => {
  for (const name of ['productCard', 'productTextRow']) {
    const body = functionBody(name);
    assert.match(body, /product-print-label/);
    assert.match(body, /product-listing-case-open/);
    assert.doesNotMatch(body, /product-platform-status-open/);
    assert.doesNotMatch(body, /product-listing-variant-open/);
  }
});

test('商品搜尋列不再顯示平台狀態篩選', () => {
  const body = functionBody('renderProducts');
  assert.doesNotMatch(body, /productPlatformFilter/);
  assert.match(body, /productSearch/);
  assert.match(body, /product-display-mode/);
});
