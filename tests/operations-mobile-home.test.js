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
  assert.match(portal, /id="opsCourseMenuToggle"/);
  assert.match(portal, /href="#course-calendar" data-view="course-calendar"/);
  assert.match(portal, /href="#course-students" data-view="course-students"/);
  assert.match(portal, /href="#course-teachers" data-view="course-teachers"/);
  assert.match(portal, /href="#course-settings" data-view="course-settings"/);
  assert.doesNotMatch(portal, /href="operations-hub\.html"/);
});

test('formal operations route uses the approved mobile home enhancement', () => {
  const hub = read('operations-hub.html');
  assert.match(hub, /operations-mobile-home-v1\.css/);
  assert.match(hub, /operations-mobile-home-v1\.js/);
  assert.match(hub, /id="opsCourseGroup"/);
  assert.match(hub, /href="#course-calendar" data-view="course-calendar"/);
});

test('mobile home contains live schedule and product search integrations', () => {
  const source = read('operations-mobile-home-v1.js');
  assert.match(source, /FORMAL_DB_NAME = 'youzi-course-scheduler'/);
  assert.match(source, /今日課表/);
  assert.match(source, /快速找商品/);
  assert.match(source, /operationsState\(\)/);
  assert.match(source, /正式資料/);
});

test('course management stays in the operations shell and POS price is editable per sale', () => {
  const source = read('operations-phase1.js');
  assert.match(source, /const COURSE_WORKSPACE_VIEWS/);
  assert.match(source, /course-scheduler\.html\?embed=1&amp;view=/);
  assert.match(source, /youzi-course-view-change/);
  assert.match(source, /if\(isCourseWorkspaceView\(view\)\)return false/);
  assert.doesNotMatch(source, /location\.href='course-scheduler\.html'/);
  assert.doesNotMatch(source, /global\.location\.replace\('course-scheduler\.html'\)/);
  assert.doesNotMatch(source, /開啟舊版音教雲/);
  assert.match(source, /class="ops-cart-price-editor"[^>]+data-cart-price=/);
  assert.doesNotMatch(source, /data-cart-price="[^"]+"[^>]*readonly/);
  assert.match(source, /只修改本次交易，不會改變商品主檔售價/);
});
