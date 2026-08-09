const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'operations-phase1.js'), 'utf8');
const start = source.indexOf('async function repairYsv104PreorderHistoryOnce');
const end = source.indexOf('function kpi(', start);
const repair = source.slice(start, end);

test('YSV-104 repair is one-time and locked to the exact original documents', () => {
  assert.ok(start > 0 && end > start);
  for (const value of [
    'YSV104_1920102_HISTFIX_20260809',
    'bJ2oefMhfrsvbEEDYr1a',
    'Mhwu2eeQ0Wv0a1JIdg2A',
    'CD486cAze4ipgKYGUJnE',
    'JDCC45otSrorKnfx4Jlt',
    'mLxgBUQMvWpQWjw7Na5f',
    'JGwgBVcy6y1KVzKaoXXY',
    'yN8GiyxjwfKZZa8oA0YB',
    'PRE-20260716085756-UNWVV'
  ]) assert.match(repair, new RegExp(value));
  assert.match(repair, /if\(markerSnap\.exists\)return 'already_repaired'/);
  assert.match(repair, /runTransaction/);
  assert.match(repair, /exactTimestampOneOf\(sale\.soldAt,\[originalFulfillmentIso,soldAtIso\]\)/);
  assert.match(repair, /exactTimestampOneOf\(stockOut\.occurredAt,\[originalFulfillmentIso,deliveredAtIso\]\)/);
});

test('repair recognizes the sale on July 16 and delivery on August 5', () => {
  assert.match(repair, /soldAtIso='2026-07-16T08:57:56\.140Z'/);
  assert.match(repair, /deliveredAtIso='2026-08-05T05:04:00\.000Z'/);
  assert.match(repair, /soldAt:soldAt,preorderAt:soldAt,deliveredAt:deliveredAt/);
  assert.match(repair, /orderTotal:28500,total:28500,costTotal:15000,grossProfit:13500/);
  assert.match(repair, /occurredAt:stockReadyAt/);
  assert.match(repair, /occurredAt:deliveredAt/);
});

test('repair verifies both payments but never writes payment, receivable or product documents', () => {
  assert.match(repair, /Number\(deposit\.amount\|\|0\)===10000/);
  assert.match(repair, /Number\(tailPayment\.amount\|\|0\)===18500/);
  assert.match(repair, /Number\(receivable\.receivedAmount\|\|0\)===28500/);
  assert.match(repair, /Number\(product\.currentStock\|\|0\)===0/);
  assert.doesNotMatch(repair, /tx\.(?:set|update)\((?:receivableRef|depositRef|tailPaymentRef|productRef)/);
  assert.match(repair, /完全不寫入，避免重複入帳或再次增減庫存/);
});

test('authenticated operations startup runs the repair before loading cached reports', () => {
  const initStart = source.indexOf('async function init()');
  const initEnd = source.indexOf('global.OperationsCenterV1', initStart);
  const init = source.slice(initStart, initEnd);
  assert.match(init, /state\.db=initDb\(\)/);
  assert.match(init, /await repairYsv104PreorderHistoryOnce\(\)/);
  assert.ok(init.indexOf('await repairYsv104PreorderHistoryOnce()') < init.indexOf('restoreFastStateCache()'));
});
