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
  assert.match(portal, /href="#expenses" data-view="expenses"/);
  assert.match(portal, /operations-expenses\.js\?v=20260801-operating-expenses-v6/);
  assert.match(portal, /operations-phase1\.js\?v=20260811-product-image-url-import-v1/);
  assert.match(portal, /operations-mobile-home-v1\.js\?v=20260803-mobile-overview-day-v1/);
  assert.match(portal, /operations-mobile-home-v1\.css\?v=20260809-mobile-quick-nav-v1/);
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
  assert.match(source, /全體週課表/);
  assert.match(source, /data-approved-one-day-viewport/);
  assert.match(source, /scroll\.clientWidth - timeWidth/);
  assert.match(source, /每次查看一天/);
  assert.doesNotMatch(source, /data-approved-two-day-viewport/);
  assert.doesNotMatch(source, /weekSnapTimer|weekSnapTargets|snapApprovedWeekViewport|scrollend|scroll\.scrollTo/);
  assert.match(source, /eventLabel\(event\)/);
  assert.match(source, /快速找商品/);
  assert.match(source, /operationsState\(\)/);
  assert.doesNotMatch(source, /今天的營運狀況/);
  assert.doesNotMatch(source, /正式資料/);
  assert.doesNotMatch(source, /圖片、售價與庫存一起確認/);
});

test('mobile overview is compact while desktop keeps the full report', () => {
  const source = read('operations-phase1.js');
  assert.match(source, /mobile\?'':'<label class="ops-overview-day-label">/);
  assert.match(source, /ops-mobile-overview-periods/);
  assert.match(source, /搜尋日期/);
  assert.match(source, /opsMobileOverviewReportTemplate/);
  assert.doesNotMatch(source, /id="opsMobileOverviewDetails"/);
  assert.match(source, /if\(isCompactMobile\(\)\)return rangeHtml\+mobileProfitHtml\+mobileQuickNavHtml\+'<template/);
  assert.match(source, /return rangeHtml\+heroHtml\+'<div class="ops-v8-channel-grid">'/);
});

test('mobile common actions mirror the full sidebar and use one black style', () => {
  const source = read('operations-phase1.js');
  const css = read('operations-mobile-home-v1.css');
  const required = [
    ['overview', '營運總覽'],
    ['course-calendar', '課程日表'],
    ['course-students', '學生與學費'],
    ['course-teachers', '老師薪資'],
    ['course-settings', '系統設定'],
    ['sales', '現場銷售'],
    ['sync', '平台訂單'],
    ['products', '商品資訊'],
    ['purchases', '庫存作業'],
    ['receivables', '應收帳款'],
    ['customers', '客戶會員'],
    ['rentals', '租賃營運'],
    ['expenses', '營運支出']
  ];
  required.forEach(([view, label]) => {
    assert.match(source, new RegExp(`class="ops-button" data-nav="${view}">${label}<`));
  });
  assert.match(source, /class="ops-button ops-mobile-admin-link" href="settings\.html">返回管理首頁</);
  assert.doesNotMatch(source, /data-action="mobile-overview-details">營運報表/);
  assert.match(css, /\.ops-mobile-direct-nav \.ops-button[\s\S]*background:\s*#111827\s*!important/);
  assert.match(css, /\.ops-mobile-direct-nav \.ops-button[\s\S]*color:\s*#fff\s*!important/);
});

test('mobile profit and expense groups use distinct semantic styling', () => {
  const source = read('operations-phase1.js');
  const css = read('operations-mobile-home-v1.css');
  assert.match(source, /ops-mobile-profit-summary/);
  assert.match(source, /ops-mobile-profit-channels/);
  for (const kind of ['net', 'gross', 'expense', 'store', 'platform', 'course', 'rental']) {
    assert.match(source, new RegExp(`is-${kind}`));
    assert.match(css, new RegExp(`\\.ops-mobile-profit-box\\.is-${kind}`));
  }
});

test('course management stays in the operations shell and POS price is editable per sale', () => {
  const source = read('operations-phase1.js');
  assert.match(source, /const COURSE_WORKSPACE_VIEWS/);
  assert.match(source, /ops-course-inline-placeholder/);
  assert.match(source, /global\.YouziOperationsCourseInline\.mount\(content,courseView\)/);
  assert.match(source, /global\.YouziOperationsCourseInline\.show\(view\)/);
  assert.match(source, /if\(isCourseWorkspaceView\(view\)\)return false/);
  assert.doesNotMatch(source, /location\.href='course-scheduler\.html'/);
  assert.doesNotMatch(source, /global\.location\.replace\('course-scheduler\.html'\)/);
  assert.doesNotMatch(source, /開啟舊版音教雲/);
  assert.match(source, /class="ops-cart-price-editor"[^>]+data-cart-price=/);
  assert.doesNotMatch(source, /data-cart-price="[^"]+"[^>]*readonly/);
  assert.match(source, /只修改本次交易，不會改變商品主檔售價/);
});

test('POS electric piano rental income rolls into rental operations without helper clutter', () => {
  const source = read('operations-phase1.js');
  assert.match(source, /data-mode="pianoRental"[^>]*>電鋼琴租用收入/);
  assert.match(source, /const rentalRevenue=contractRentalRevenue\+pianoRentalRevenue/);
  assert.match(source, /metricRow\('電鋼琴租用收入',money\(pianoRentalRevenue\)\)/);
  assert.doesNotMatch(source, /輸入商品編號或名稱，再點選/);
  assert.doesNotMatch(source, /也可以使用左側數字鍵盤快速輸入 SKU/);
  assert.doesNotMatch(source, /商品、價格與收款集中在同一區/);
  assert.doesNotMatch(source, /加入本次銷售/);
});

test('mobile profit cards align consistently and keep six-digit values on one line', () => {
  const source = read('operations-phase1.js');
  const approvedCss = read('operations-mobile-home-v1.css');
  const compactCss = read('mobile-layout.css');
  assert.match(source, /Math\.abs\(Number\(value\)\|\|0\)>=100000\?' is-wide'/);
  assert.doesNotMatch(source, /全部通路與營運項目加總/);
  assert.doesNotMatch(source, /直接開啟，不需要再展開選單/);
  assert.doesNotMatch(source, /已顯示上次整理結果/);
  for (const css of [approvedCss, compactCss]) {
    assert.match(css, /\.ops-mobile-profit-box[\s\S]*display:\s*flex/);
    assert.match(css, /\.ops-mobile-profit-box[\s\S]*justify-content:\s*center/);
    assert.match(css, /\.ops-mobile-profit-box strong[\s\S]*white-space:\s*nowrap/);
    assert.match(css, /\.ops-mobile-profit-box strong\.is-wide/);
  }
});
