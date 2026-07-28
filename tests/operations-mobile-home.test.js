const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('portal URL opens the operations application directly', () => {
  const portal = read('portal.html');
  assert.match(portal, /id="opsContent"/);
  assert.match(portal, /operations-phase1\.js/);
  assert.match(portal, /operations-mobile-home-v1\.js/);
  assert.match(portal, /href="course-scheduler\.html"><span>日<\/span><div><b>課程日表/);
  assert.doesNotMatch(portal, /href="#course-calendar" data-view="course-calendar"/);
  assert.doesNotMatch(portal, /href="operations-hub\.html"/);
});

test('formal operations route uses the approved mobile home enhancement', () => {
  const hub = read('operations-hub.html');
  assert.match(hub, /operations-mobile-home-v1\.css/);
  assert.match(hub, /operations-mobile-home-v1\.js/);
  assert.match(hub, /href="course-scheduler\.html"><span>日<\/span><div><b>課程日表/);
});

test('mobile home contains live schedule and product search integrations', () => {
  const source = read('operations-mobile-home-v1.js');
  assert.match(source, /FORMAL_DB_NAME = 'youzi-course-scheduler'/);
  assert.match(source, /今日課表/);
  assert.match(source, /快速找商品/);
  assert.match(source, /operationsState\(\)/);
  assert.match(source, /正式資料/);
});

test('course shortcuts open the new scheduler and POS price is editable per sale', () => {
  const source = read('operations-phase1.js');
  assert.match(source, /nav\.dataset\.nav==='course-calendar'\)\{location\.href='course-scheduler\.html'/);
  assert.match(source, /state\.view==='course-calendar'\)\{global\.location\.replace\('course-scheduler\.html'\)/);
  assert.doesNotMatch(source, /開啟舊版音教雲/);
  assert.match(source, /class="ops-cart-price-editor"[^>]+data-cart-price=/);
  assert.doesNotMatch(source, /data-cart-price="[^"]+"[^>]*readonly/);
  assert.match(source, /只修改本次交易，不會改變商品主檔售價/);
});
