'use strict';

// Monetary accounting is independent of attendance and teacher compensation.
function cents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(Math.round(number * 100)) || Math.abs(Math.round(number * 100) - number * 100) > 0.000001) {
    throw new Error('金額必須為有效的非負數，最多兩位小數。');
  }
  return Math.round(number * 100);
}

function refundableAmount(period) {
  const rows = Array.isArray(period.transactions) ? period.transactions : [];
  const payments = rows.filter(row => row.type !== 'refund').reduce((sum, row) => sum + cents(row.amount || 0), 0);
  const refunds = rows.filter(row => row.type === 'refund').reduce((sum, row) => sum + cents(row.amount || 0), 0);
  // Some imported records have a receipt total without individual transactions.
  const received = Math.max(payments, cents(period.paidAmount ?? period.receivedAmount ?? 0));
  return Math.max(0, received - refunds) / 100;
}

function validateTransaction(period, incoming) {
  if (!['payment', 'refund'].includes(incoming.type)) throw new Error('請選擇收費或退款。');
  if (!incoming.id || !/^[A-Za-z0-9_-]{1,160}$/.test(incoming.id)) throw new Error('交易識別碼格式錯誤。');
  if (cents(incoming.amount) <= 0) throw new Error('收退款金額必須大於零。');
  const existing = (period.transactions || []).find(row => row.id === incoming.id);
  if (existing) {
    if (existing.type !== incoming.type || cents(existing.amount) !== cents(incoming.amount)) throw new Error('交易識別碼已用於另一筆異動。');
    return { duplicate: true };
  }
  if (incoming.type === 'refund' && cents(incoming.amount) > cents(refundableAmount(period))) {
    throw new Error('退款不得超過實收扣除已退款的餘額。');
  }
  return { duplicate: false };
}

module.exports = { cents, refundableAmount, validateTransaction };
