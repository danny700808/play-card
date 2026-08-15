const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('preorders recognize the full transaction and estimated profit on the original sale date', () => {
  const source = read('operations-phase1.js');
  assert.match(source, /function estimatePreorderCost\(raw,qty\)/);
  assert.match(source, /grossProfit=orderTotal-costTotal/);
  assert.match(source, /orderTotal:orderTotal,total:orderTotal,costTotal:costTotal,costEstimated:preorder/);
  assert.match(source, /costSource:preorder\?'preorderEstimate':'fifo'/);
  assert.match(source, /尚未設定成本，請先在商品主檔填入成本再建立預購/);
  assert.doesNotMatch(source, /total:preorder\?0:orderTotal/);
  assert.match(source, /預購成交已成立；收款與交貨分開追蹤/);
});

test('preorder delivery only records delivery and never moves the original sale date or collects money', () => {
  const source = read('operations-phase1.js');
  const start = source.indexOf('async function savePreorderFulfillment');
  const end = source.indexOf('function openSaleEdit', start);
  assert.ok(start > 0 && end > start);
  const fulfillment = source.slice(start, end);
  assert.match(fulfillment, /deliveredAt:deliveredAt,fulfillmentStatus:'delivered'/);
  assert.match(fulfillment, /costEstimated:false,costSource:'fifo'/);
  assert.match(fulfillment, /預購交貨（不含收款）/);
  assert.doesNotMatch(fulfillment, /soldAt:deliveredAt/);
  assert.doesNotMatch(fulfillment, /name="receivedAmount"/);
  assert.doesNotMatch(fulfillment, /receivablePayments/);
});

test('one preorder drawer shows transaction, payment history, stock and delivery separately', () => {
  const source = read('operations-phase1.js');
  assert.match(source, /function openPreorderTracking\(id\)/);
  assert.match(source, /預購訂單集中追蹤/);
  assert.match(source, /完整成交金額/);
  assert.match(source, /收款流水/);
  assert.match(source, /商品與庫存/);
  assert.match(source, /確認商品已交給客人/);
  assert.match(source, /id="preorderPaymentForm"/);
  assert.match(source, /placeholder="請手動輸入，不會自動帶入尾款"/);
  assert.match(source, /id="preorderFulfillmentForm"/);
  assert.match(source, /這個動作只記錄交貨並扣庫存，不會順便收款/);
});

test('sales and receivables route preorders to the same dual-status tracker', () => {
  const source = read('operations-phase1.js');
  assert.match(source, /function renderOpenPreorderTrackingV1\(\)/);
  assert.match(source, /預購集中追蹤/);
  assert.match(source, /收款：'\+tracking\.paymentLabel/);
  assert.match(source, /交貨：'\+tracking\.deliveryLabel/);
  assert.match(source, /data-action="preorder-track"/);
  assert.match(source, /查看整張訂單/);
  assert.match(source, /if\(sale&&sale\.saleType==='preorder'\)return openPreorderTracking\(sale\.id\)/);
});

test('store reporting recognizes product sales on soldAt and does not count later tail payments again', () => {
  const source = read('operations-phase1.js');
  assert.match(source, /const recognizedSales=sales\.filter\(function\(sale\)\{return sale\.saleType!=='internalUse';\}\)/);
  assert.match(source, /const productRevenue=sum\(recognizedSales,function\(sale\)\{return Math\.max\(0,Number\(sale\.total\|\|sale\.orderTotal\|\|0\)\);\}\)/);
  assert.match(source, /商品依成交日認列；收款與交貨另外追蹤/);
  assert.doesNotMatch(source, /paymentBySale/);
  assert.match(source, /今日商品成交/);
});

test('preorder tracker is mobile friendly and cache versions are bumped', () => {
  const css = read('operations-phase1.css');
  const portal = read('portal.html');
  const hub = read('operations-hub.html');
  assert.match(css, /\.ops-preorder-tracking-board/);
  assert.match(css, /\.ops-preorder-tracking-drawer/);
  assert.match(css, /@media\(max-width:620px\)[\s\S]*\.ops-preorder-identity,\.ops-preorder-finance-grid,\.ops-preorder-status-summary\{grid-template-columns:1fr\}/);
  for (const html of [portal, hub]) {
    assert.match(html, /operations-phase1\.css\?v=20260815-product-images-v2/);
    assert.match(html, /operations-phase1\.js\?v=20260815-product-images-v2/);
  }
});
