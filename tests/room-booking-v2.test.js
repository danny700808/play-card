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
assert(html.includes('id="confirmRenter"'), '確認預約缺少租用人姓名');
assert(html.includes('id="bookingStudent"'), '學生帳號缺少本次租用學生選擇');
assert(html.includes('data-use="piano"'), '固定租用用途沒有直接寫入頁面');
assert(!html.includes('正在載入用途…'), '固定租用用途仍顯示不必要的載入提示');
assert(html.includes('id="rentalPhotoBackdrop"'), '租用頁缺少教室照片彈窗');
assert(html.includes('id="closeRentalPhoto"'), '教室照片彈窗缺少手機可按的關閉按鈕');
assert(html.includes('一般教室使用 <b>NT$100/小時</b>'), '確認單缺少一般教室使用選項');
assert(html.includes('錄音室錄音使用 <b>NT$300/小時</b>'), '確認單缺少錄音使用選項');
assert(!/name="recordingUsage"[^>]*checked/.test(html), '錄音室使用方式不可預先代選');
assert(client.includes('NT$100–300／小時'), '教室選擇卡缺少錄音室價格範圍');
assert(client.includes("row.id === 'recording' ? '' : clean(row.priceRangeText)"), '最前面的錄音室用途卡仍顯示價格');
assert(client.includes('rental-guzheng.png?v=20260801-guzheng-v1'), '古箏用途卡沒有使用真正的古箏圖片');
assert(client.includes('const immediateRentalUseOptions'), '固定租用用途缺少前端立即顯示資料');
assert(client.indexOf('renderUses(immediateRentalUseOptions)') < client.indexOf('await Promise.all([loadRentalData(), loadBookings()])'), '固定用途仍需等待後端租用資料');
assert(client.includes('data-room-photo='), '教室卡缺少獨立的照片按鈕');
assert(client.includes('openRoomPhotos(photoRoom)'), '教室照片按鈕沒有開啟原頁彈窗');
assert(client.includes('https://cdn.store-assets.com/s/887148/f/10015248.png'), '教室照片未沿用官網既有圖片');
assert(client.includes("photoImage.removeAttribute('src')"), '關閉照片後沒有釋放目前圖片');
assert(css.includes('.rental-use-card > .rental-use-image'), '古箏圖片缺少手機用途卡尺寸');
assert(css.includes('.rental-room-photo-button'), '教室照片按鈕缺少手機版樣式');
assert(css.includes('.rental-photo-backdrop'), '教室照片彈窗缺少遮罩樣式');
assert(css.includes('.rental-photo-close'), '教室照片彈窗缺少關閉按鈕樣式');
assert(fs.existsSync(path.join(root, 'rental-guzheng.png')), '古箏圖片檔案不存在');
assert(client.includes('recordingUsage,'), '確認的錄音室使用方式未送到後端');
assert(client.includes('studentId: selectedStudentId'), '學生租用沒有送出實際使用學生');
assert(client.includes("selectedUse === 'recording' && !recordingUsage"), '未選錄音室使用方式仍可送出');
assert(client.includes("classList.toggle('hidden', recording && !student)"), '錄音室非學生仍顯示重複價格組');
assert(client.includes("recording ? '學生折扣（選填）' : '租用價格'"), '學生半價未與錄音室使用方式分開');
assert(client.includes('renderWelcomeName(boardData.displayName)'), '租用標題未使用後端登入姓名');
assert(client.includes("normalize('NFKC')"), '歡迎姓名未先正規化全形電話或 Email');
assert(css.includes('.rental-use-card small.rental-use-price'), '錄音室價格範圍會被用途卡樣式隱藏');
assert(backend.includes('recordingRentalSelection(data, true)'), '後端建立預約前未強制驗證錄音室使用方式');
assert(backend.includes('displayName: identity.displayName'), '租用週表未回傳登入姓名');
assert(backend.includes('clientName: identity.clientName'), '建立租用時沒有保存租用人姓名');
assert(backend.includes('clientPhone: identity.clientPhone'), '建立租用時沒有保存租用人電話');
assert(backend.includes('rentalStudentId: identity.studentId'), '學生租用沒有保存實際學生');
assert(backend.includes('coursePortalAdminCancelRoomBooking'), '管理者缺少強制取消租用後端');
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
