'use strict';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizePhone(value) {
  let digits = clean(value).replace(/\D/g, '');
  if (digits.startsWith('886')) digits = `0${digits.slice(3)}`;
  return digits;
}

function phoneMatches(left, right) {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  return Boolean(a && b && (a === b || a.slice(-9) === b.slice(-9)));
}

module.exports = {
  normalizePhone,
  phoneMatches
};
