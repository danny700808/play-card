'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('operations-phase1.js', 'utf8');

test('一鍵上架按鈕建立待辦並切換到指定 Codex 對話', () => {
  assert.match(source, /const PRODUCT_LISTING_CODEX_THREAD_URL = 'codex:\/\/threads\/'/);
  assert.match(source, /async function handoffProductListingToCodex\(form\)/);
  assert.match(source, /caseStatus:'waiting-codex'/);
  assert.match(source, /codexHandoff:\{status:'pending'/);
  assert.match(source, /global\.location\.href=PRODUCT_LISTING_CODEX_THREAD_URL/);
});

test('主要按鈕不再直接執行 OpenAI 文案與圖片 API 流程', () => {
  const handler = source.match(/if\(action==='product-listing-codex-complete'\)\{[\s\S]*?\n\s*\}/)[0];
  assert.match(handler, /handoffProductListingToCodex/);
  assert.doesNotMatch(handler, /completeProductListingWithCodex/);
  assert.doesNotMatch(source, /async function completeProductListingWithCodex/);
  assert.doesNotMatch(handler, /researchProductListingCase|generateProductListingImage/);
  assert.match(source, /網頁本身不會先啟動 OpenAI/);
  assert.match(source, /已停用網頁 OpenAI/);
});
