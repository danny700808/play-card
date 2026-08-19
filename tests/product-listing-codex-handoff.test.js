'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('operations-phase1.js', 'utf8');

test('一鍵上架按鈕把完整工作帶入指定 Codex 對話並等待使用者送出', () => {
  assert.match(source, /const PRODUCT_LISTING_CODEX_THREAD_URL = 'codex:\/\/threads\/'/);
  assert.match(source, /function productListingCodexThreadUrl\(prompt\)/);
  assert.match(source, /params\.set\('prompt',clean\(prompt\)\)/);
  assert.match(source, /async function handoffProductListingToCodex\(form\)/);
  assert.match(source, /caseStatus:'waiting-codex'/);
  assert.match(source, /codexHandoff:\{status:'pending'/);
  assert.match(source, /global\.location\.href=threadUrl/);
  assert.match(source, /切換後請在輸入框按 Enter 開始/);
  assert.doesNotMatch(source, /Codex 待辦已建立/);
});

test('主要按鈕不再直接執行 OpenAI 文案與圖片 API 流程', () => {
  const handler = source.match(/if\(action==='product-listing-codex-complete'\)\{[\s\S]*?\n\s*\}/)[0];
  assert.match(handler, /handoffProductListingToCodex/);
  assert.doesNotMatch(handler, /completeProductListingWithCodex/);
  assert.doesNotMatch(source, /async function completeProductListingWithCodex/);
  assert.doesNotMatch(handler, /researchProductListingCase|generateProductListingImage/);
  assert.match(source, /按 Enter 才會正式開始/);
  assert.match(source, /網頁本身不會先啟動 OpenAI/);
  assert.match(source, /已停用網頁 OpenAI/);
});
