'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'room-booking.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'room-booking-v2.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'room-booking-v2.css'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'functions/coursePortal.js'), 'utf8');

new vm.Script(client, { filename: 'room-booking-v2.js' });

assert(html.includes('id="rentalHeaderTitle"'), '租用頁缺少歡迎姓名標題');
assert(html.includes('一般教室使用 <b>NT$100/小時</b>'), '確認單缺少一般教室使用選項');
assert(html.includes('錄音室錄音使用 <b>NT$300/小時</b>'), '確認單缺少錄音使用選項');
assert(!/name="recordingUsage"[^>]*checked/.test(html), '錄音室使用方式不可預先代選');
assert(client.includes('NT$100–300／小時'), '用途卡或教室卡缺少錄音室價格範圍');
assert(client.includes('recordingUsage,'), '確認的錄音室使用方式未送到後端');
assert(client.includes("selectedUse === 'recording' && !recordingUsage"), '未選錄音室使用方式仍可送出');
assert(client.includes("classList.toggle('hidden', recording && !student)"), '錄音室非學生仍顯示重複價格組');
assert(client.includes("recording ? '學生折扣（選填）' : '租用價格'"), '學生半價未與錄音室使用方式分開');
assert(client.includes('renderWelcomeName(boardData.displayName)'), '租用標題未使用後端登入姓名');
assert(client.includes("normalize('NFKC')"), '歡迎姓名未先正規化全形電話或 Email');
assert(css.includes('.rental-use-card small.rental-use-price'), '錄音室價格範圍會被用途卡樣式隱藏');
assert(backend.includes('recordingRentalSelection(data, true)'), '後端建立預約前未強制驗證錄音室使用方式');
assert(backend.includes('displayName: await displayNamePromise'), '租用週表未回傳登入姓名');
assert(backend.includes("const teachers = await mirrorRows('teachers')"), '老師姓名缺少 mirror fallback');
assert(backend.includes("const students = await mirrorRows('students')"), '學生姓名缺少 mirror fallback');

const pricingStart = backend.indexOf('const RECORDING_RENTAL_OPTIONS');
const pricingEnd = backend.indexOf('function defaultRentalUseOptions', pricingStart);
assert(pricingStart >= 0 && pricingEnd > pricingStart, '找不到錄音室後端計價 helper');

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const pricingSandbox = {
  module: { exports: {} },
  HttpsError: FakeHttpsError,
  clean: (value) => String(value == null ? '' : value).trim()
};
vm.runInNewContext(
  `${backend.slice(pricingStart, pricingEnd)}
module.exports = {
  recordingRentalSelection,
  rentalAmount,
  effectiveRentalFee
};`,
  pricingSandbox,
  { filename: 'coursePortal-recording-pricing.js' }
);
const pricing = pricingSandbox.module.exports;
const general = pricing.recordingRentalSelection({
  useType: 'recording',
  recordingUsage: 'general_room'
}, true);
const studio = pricing.recordingRentalSelection({
  useType: 'recording',
  recordingUsage: 'studio_recording'
}, true);

assert.strictEqual(general.hourlyRate, 100);
assert.strictEqual(studio.hourlyRate, 300);
assert.strictEqual(pricing.effectiveRentalFee({}, {}, { id: 'recording', hourlyRate: 300 }), null);
assert.strictEqual(pricing.effectiveRentalFee({}, {}, { id: 'recording', hourlyRate: 300 }, general), 100);
assert.strictEqual(pricing.effectiveRentalFee({}, {}, { id: 'recording', hourlyRate: 300 }, studio), 300);
assert.strictEqual(pricing.rentalAmount(100, 90), 150);
assert.strictEqual(pricing.rentalAmount(300, 90), 450);
assert.strictEqual(pricing.rentalAmount(300, 90, 0.5), 225);
assert.throws(
  () => pricing.recordingRentalSelection({ useType: 'recording' }, true),
  (error) => error && error.code === 'invalid-argument'
);
assert.throws(
  () => pricing.recordingRentalSelection({ useType: 'recording', recordingUsage: 'general' }, true),
  (error) => error && error.code === 'invalid-argument'
);

console.log('room booking v2 tests passed');
