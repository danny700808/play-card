'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const engine = fs.readFileSync('operations-phase1.js', 'utf8');
const pos = fs.readFileSync('operations-mobile-pos-v4.js', 'utf8');
const portal = fs.readFileSync('portal.html', 'utf8');
const hub = fs.readFileSync('operations-hub.html', 'utf8');

test('the erroneous waiting-search module is completely removed', () => {
  assert.equal(fs.existsSync('operations-search-product-ux-v1.js'), false);
  assert.equal(fs.existsSync('operations-search-product-ux-v1.css'), false);
  for (const html of [portal, hub]) {
    assert.doesNotMatch(html, /operations-search-product-ux-v1/);
    assert.doesNotMatch(html, /等待輸入/);
    assert.match(html, /operations-phase1\.js\?v=20260805-live-search-v3/);
  }
});

test('product and inventory searches use the same next-frame interaction as POS', () => {
  assert.match(pos, /requestAnimationFrame\(run\)/);
  assert.match(engine, /function scheduleLiveSearchRender/);
  assert.match(engine, /requestAnimationFrame\(run\)/);
  assert.match(engine, /scheduleLiveSearchRender\(input\.id,state\[key\],false\)/);
  assert.match(engine, /scheduleLiveSearchRender\(targetId,next,false\)/);
  assert.doesNotMatch(engine, /SEARCH_IDLE_DELAY_MS|scheduleDeferredSearchRender|deferredSearchTimers|requestIdleCallback/);
});

test('POS and all product-operation search fields stay on the same shared live path', () => {
  for (const id of ['posSearch', 'productSearch', 'inventorySearch', 'purchaseLowSearch', 'purchaseEntrySearch', 'stocktakeSearch']) {
    assert.match(engine, new RegExp(id + ":'" + id + "'"));
  }
  assert.doesNotMatch(engine, /等待輸入…|data-youzi-search-for|ops-stable-search-button/);
});

test('variant-first product images are retained in the core renderer', () => {
  assert.match(engine, /const mainImage=variantImages\[0\]\|\|parentImages\[0\]/);
  assert.match(engine, /const systemName=clean\(p\.originalName\|\|p\.name\|\|p\.onlineName\)/);
});
