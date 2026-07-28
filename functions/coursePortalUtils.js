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

// functions/index.js 會先載入課務模組；沿著 CommonJS 父層找到 index exports，
// 註冊唯讀課務資料函式，避免碰觸大型 index.js。
(function registerAutomaticEducationRead() {
  try {
    let indexModule = module.parent;
    while (indexModule) {
      const filename = String(indexModule.filename || '').replace(/\\/g, '/');
      if (/\/functions\/index\.js$/.test(filename)) break;
      indexModule = indexModule.parent;
    }
    if (!indexModule || !indexModule.exports) return;
    const { registerInjiaoyunEducationAutoRead } = require('./injiaoyunEducationAutoRead');
    registerInjiaoyunEducationAutoRead(indexModule.exports);
  } catch (error) {
    console.error('[registerAutomaticEducationRead]', error);
  }
}());

module.exports = {
  normalizePhone,
  phoneMatches
};
