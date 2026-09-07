'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cents, refundableAmount, validateTransaction } = require('../functions/courseTuitionLedger');
const payment = (id, amount) => ({ id, type: 'payment', amount });
const refund = (id, amount) => ({ id, type: 'refund', amount });

test('unpaid tuition cannot be refunded, regardless of tuition list price', () => {
  const period = { expectedAmount: 3600, transactions: [] };
  assert.equal(refundableAmount(period), 0);
  assert.throws(() => validateTransaction(period, refund('refund1', 1)), /退款不得超過/);
});
test('partial payments less cumulative refunds bound the next refund', () => {
  const period = { transactions: [payment('pay1', 1800), refund('refund1', 900)] };
  assert.equal(refundableAmount(period), 900);
  assert.throws(() => validateTransaction(period, refund('refund2', 901)), /退款不得超過/);
  assert.deepEqual(validateTransaction(period, refund('refund2', 900)), { duplicate: false });
});
test('retrying the same transaction is idempotent, reusing its ID with a new amount fails', () => {
  const period = { transactions: [payment('pay1', 1800), refund('refund1', 1800)] };
  assert.deepEqual(validateTransaction(period, refund('refund1', 1800)), { duplicate: true });
  assert.throws(() => validateTransaction(period, refund('refund1', 900)), /識別碼/);
});
test('imported receipt totals and matching receipt lines are not counted twice', () => {
  const period = { paidAmount: 3600, transactions: [payment('p1', 1800), payment('p2', 1800), refund('r1', 900)] };
  assert.equal(refundableAmount(period), 2700);
  assert.equal(refundableAmount({ receivedAmount: 1800, transactions: [] }), 1800);
});
test('amounts reject NaN, infinity, negative values and fractions smaller than a cent', () => {
  for (const amount of [NaN, Infinity, -1, 0.001]) assert.throws(() => cents(amount));
  assert.equal(cents(0.29), 29);
  assert.throws(() => validateTransaction({}, payment('p', 0)));
});
test('recording a refund does not mutate attendance, lesson usage or payroll', () => {
  const period = { transactions: [payment('p1', 3600)], usedCount: 2, attendance: ['lesson1', 'lesson2'], teacherAmount: 1080 };
  const before = structuredClone(period);
  validateTransaction(period, refund('r1', 900));
  assert.deepEqual(period, before);
});
