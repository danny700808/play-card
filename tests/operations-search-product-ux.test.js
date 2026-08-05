'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const script = fs.readFileSync('operations-search-product-ux-v1.js', 'utf8');
const css = fs.readFileSync('operations-search-product-ux-v1.css', 'utf8');
const portal = fs.readFileSync('portal.html', 'utf8');
const hub = fs.readFileSync('operations-hub.html', 'utf8');

function indexOfOrFail(source, needle, label) {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, label + ' should exist');
  return index;
}

test('search UX loads before operations engine in both entrances', () => {
  for (const [name, html] of [['portal', portal], ['operations hub', hub]]) {
    const guard = indexOfOrFail(html, 'operations-search-product-ux-v1.js?v=20260805-search-product-ux-v1', name + ' search guard');
    const engine = indexOfOrFail(html, 'operations-phase1.js?', name + ' operations engine');
    assert.ok(guard < engine, name + ' must register capture listeners before the operations engine');
    assert.match(html, /operations-search-product-ux-v1\.css\?v=20260805-search-product-ux-v1/);
  }
});

test('typing is debounced while Enter remains immediate', () => {
  assert.match(script, /return isMobile\(\) \? 850 : 700/);
  assert.match(script, /event\.key !== 'Enter'/);
  assert.match(script, /dispatchEvent\(new KeyboardEvent\('keydown'/);
  assert.match(script, /event\.stopImmediatePropagation\(\)/);
});

test('product presentation prioritizes variant media and central name', () => {
  assert.match(script, /images\.variant\.length/);
  assert.match(script, /identity\.variant/);
  assert.match(script, /ops-central-product-name/);
  assert.match(script, /網路名稱：/);
  assert.match(css, /ops-spec-image-placeholder/);
  assert.match(css, /ops-network-product-name/);
});

test('mobile number pad gets an explicit search action', () => {
  assert.match(script, /dataYouziMobileSearch|youziMobileSearch/);
  assert.match(script, /ops-mobile-search-submit/);
  assert.match(css, /ops-mobile-search-submit/);
});
