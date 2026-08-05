'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const engine = fs.readFileSync('operations-phase1.js', 'utf8');
const mobileHistory = fs.readFileSync('operations-mobile-pos-v4.js', 'utf8');
const portal = fs.readFileSync('portal.html', 'utf8');
const hub = fs.readFileSync('operations-hub.html', 'utf8');

const searchFields = [
  ['posSearch', 'posSearchResults'],
  ['productSearch', 'productSearchResults'],
  ['purchaseLowSearch', 'purchaseLowSearchResults'],
  ['purchaseEntrySearch', 'purchaseEntrySearchResults'],
  ['stocktakeSearch', 'stocktakeSearchResults'],
  ['inventorySearch', 'inventorySearchResults']
];

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace + 1, index);
    }
  }
  assert.fail(`unterminated function ${name}`);
}

test('obsolete waiting and input-stability search layers are completely removed', () => {
  for (const path of [
    'operations-search-product-ux-v1.js',
    'operations-search-product-ux-v1.css',
    'operations-input-stability-v1.js',
    'operations-input-stability-v1.css'
  ]) {
    assert.equal(fs.existsSync(path), false, `${path} must be deleted`);
  }

  for (const html of [portal, hub]) {
    assert.doesNotMatch(html, /operations-(?:search-product-ux|input-stability)-v1/);
    assert.doesNotMatch(html, /等待輸入/);
    assert.match(html, /operations-phase1\.js\?v=20260805-live-search-v4/);
  }
});

test('all six searches keep their input and replace only a stable results container', () => {
  const updater = functionBody(engine, 'renderLiveSearchResults');

  for (const [inputId, resultsId] of searchFields) {
    assert.match(engine, new RegExp(`id=["']${resultsId}["']`), `${inputId} needs a stable results container`);
    assert.match(updater, new RegExp(`inputId===['"]${inputId}['"]`), `${inputId} must use the shared partial updater`);
    assert.match(updater, new RegExp(`replaceLiveSearchHtml\\(['"]${resultsId}['"]`), `${inputId} must update only ${resultsId}`);
  }

  assert.doesNotMatch(updater, /rerenderKeepingFocus|opsContent|\.innerHTML\s*=/);
  assert.match(functionBody(engine, 'replaceLiveSearchHtml'), /replaceChildren/);
});

test('the next-frame live path tries the partial updater before any full-render fallback', () => {
  const scheduler = functionBody(engine, 'scheduleLiveSearchRender');

  assert.match(scheduler, /renderLiveSearchResults\(inputId\)/);
  assert.match(scheduler, /if\(!renderLiveSearchResults\(inputId\)\)rerenderKeepingFocus/);
  assert.match(scheduler, /requestAnimationFrame\(run\)/);
  assert.doesNotMatch(engine, /SEARCH_IDLE_DELAY_MS|scheduleDeferredSearchRender|deferredSearchTimers|requestIdleCallback/);
});

test('desktop and mobile keypads share the same caret-aware core action', () => {
  const action = functionBody(engine, 'applySearchKeyInput');
  const valueBuilder = functionBody(engine, 'nextSearchKeyValue');

  for (const [inputId] of searchFields) {
    assert.match(action, new RegExp(`${inputId}:['"]${inputId}['"]`));
  }
  assert.match(engine, /action==='mobile-key'\) return applySearchKeyInput\(el\.dataset\.target,el\.dataset\.key\)/);
  assert.match(engine, /action==='pos-key'\)return applySearchKeyInput\('posSearch',el\.dataset\.key\)/);
  assert.match(engine, /action==='pos-clear-search'\)return applySearchKeyInput\('posSearch','clear'\)/);
  assert.match(valueBuilder, /selection\.start/);
  assert.match(valueBuilder, /selection\.end/);
  assert.match(valueBuilder, /key==='clear'/);
  assert.match(valueBuilder, /key==='back'/);
  assert.match(action, /scheduleLiveSearchRender\(targetId,next\.value,true\)/);
});

test('keypad value logic handles 1, 12, backspace, clear and a middle caret', () => {
  const fakeDocument = { activeElement: null };
  const selection = Function('document', 'input', functionBody(engine, 'searchInputSelection')).bind(null, fakeDocument);
  const nextValue = Function('searchInputSelection', 'input', 'key', functionBody(engine, 'nextSearchKeyValue')).bind(null, selection);
  const input = { value: '', selectionStart: 0, selectionEnd: 0 };
  fakeDocument.activeElement = input;

  function apply(key) {
    const next = nextValue(input, key);
    input.value = next.value;
    input.selectionStart = next.caret;
    input.selectionEnd = next.caret;
    return next;
  }

  assert.deepEqual(apply('1'), { value: '1', caret: 1 });
  assert.deepEqual(apply('2'), { value: '12', caret: 2 });
  assert.deepEqual(apply('back'), { value: '1', caret: 1 });
  assert.deepEqual(apply('clear'), { value: '', caret: 0 });

  input.value = '12';
  input.selectionStart = 1;
  input.selectionEnd = 1;
  assert.deepEqual(apply('3'), { value: '132', caret: 2 });
  input.selectionStart = 0;
  input.selectionEnd = 2;
  assert.deepEqual(apply('back'), { value: '2', caret: 0 });
});

test('mobile enhancement has no second POS search implementation', () => {
  assert.doesNotMatch(mobileHistory, /posSearch|updateSearchResults|stopImmediatePropagation/);
  assert.match(mobileHistory, /buildHistoryCards/);
});

test('catalog search text and SKU order are prepared once and reused', () => {
  assert.match(engine, /prepareCatalogSearchIndex\(\)/);
  assert.match(engine, /function catalogRowsInSkuOrder\(/);
  assert.match(engine, /function catalogMatchesSearch\(/);
  assert.match(functionBody(engine, 'productFiltered'), /catalogRowsInSkuOrder\(\)/);
  assert.match(functionBody(engine, 'purchaseEntryFilteredProducts'), /catalogRowsInSkuOrder\(\)/);
  assert.match(functionBody(engine, 'stocktakeFilteredProducts'), /catalogRowsInSkuOrder\(\)/);
});

test('variant-first product images are retained in the core renderer', () => {
  assert.match(engine, /const mainImage=variantImages\[0\]\|\|parentImages\[0\]/);
  assert.match(engine, /const systemName=clean\(p\.originalName\|\|p\.name\|\|p\.onlineName\)/);
});
