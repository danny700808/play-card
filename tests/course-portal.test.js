'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const { normalizePhone, phoneMatches } = require('../functions/coursePortalUtils');

assert.strictEqual(normalizePhone('+886 912-345-678'), '0912345678');
assert.strictEqual(normalizePhone('0912 345 678'), '0912345678');
assert.strictEqual(phoneMatches('+886912345678', '0912345678'), true);
assert.strictEqual(phoneMatches('0912345678', '0987654321'), false);

const pages = [
  'teacher-course-portal.html',
  'student-course-portal.html',
  'room-booking.html',
  'course-portal-admin.html'
];

const portalLanding = fs.readFileSync(path.join(root, 'course-portal.html'), 'utf8');
const portalRoutes = [
  'student-course-portal.html',
  'teacher-course-portal.html',
  'room-booking.html'
];
portalRoutes.forEach((route) => {
  const occurrences = portalLanding.split(`href="${route}"`).length - 1;
  assert.strictEqual(occurrences, 1, `入口首頁的 ${route} 必須且只能出現一次`);
});
assert.strictEqual(
  (portalLanding.match(/class="card stack"/g) || []).length,
  3,
  '入口首頁必須維持三個獨立入口'
);

const commonSource = fs.readFileSync(path.join(root, 'course-portal-common.js'), 'utf8');
assert(commonSource.trimStart().startsWith('(function'), 'course-portal-common.js 不是可執行的 JavaScript');
new vm.Script(commonSource, { filename: 'course-portal-common.js' });
assert(commonSource.includes('coursePortalSendEmailOtp'), '入口缺少 Email 驗證碼寄送流程');
assert(commonSource.includes('coursePortalVerifyEmailOtp'), '入口缺少 Email 驗證碼確認流程');
assert(commonSource.includes('coursePortalStartLineLogin'), '入口缺少 LINE 快速登入');

for (const file of pages) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert(html.trimStart().toLowerCase().startsWith('<!doctype html>'), `${file} 不是 HTML 文件`);
  const hasPortalRuntime = html.includes('course-portal-common.js') ||
    (file === 'teacher-course-portal.html' && html.includes('teacher-course-session-v8.js'));
  assert(hasPortalRuntime, `${file} 未載入入口程式`);
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((code) => code.trim());
  inlineScripts.forEach((code, index) => {
    new vm.Script(code, { filename: `${file}:inline-${index + 1}` });
  });
}

['teacher-course-portal.html', 'student-course-portal.html', 'room-booking.html'].forEach((file) => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert(html.includes('data-auth-view'), `${file} 缺少統一登入畫面`);
  assert(html.includes('id="sessionLoading"'), `${file} 缺少登入狀態確認畫面`);
  assert(html.includes('data-first-use-form'), `${file} 缺少首次使用驗證`);
});
['teacher-course-portal.html', 'student-course-portal.html'].forEach((file) => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert(html.includes('data-email-login-form'), `${file} 缺少 Email 快速登入`);
});
assert(
  fs.readFileSync(path.join(root, 'room-booking.html'), 'utf8').includes('data-renter-contact-form'),
  '租用入口缺少姓名＋電話臨時登入'
);

const teacherPortal = fs.readFileSync(path.join(root, 'teacher-course-portal.html'), 'utf8');
assert(teacherPortal.includes('value="single_move"'), '老師入口缺少單次調課');
assert(teacherPortal.includes('value="permanent_move"'), '老師入口缺少永久調課');
assert(!portalLanding.includes('老師調課入口'), '老師調課不可誤拆成第四個入口');

const rentalSource = fs.readFileSync(path.join(root, 'room-booking-v2.js'), 'utf8');
const rentalSettingsSource = fs.readFileSync(path.join(root, 'course-portal-settings-v2.js'), 'utf8');
const teacherRoomRulesSource = fs.readFileSync(path.join(root, 'teacher-room-rules-v1.js'), 'utf8');
new vm.Script(rentalSource, { filename: 'room-booking-v2.js' });
new vm.Script(rentalSettingsSource, { filename: 'course-portal-settings-v2.js' });
new vm.Script(teacherRoomRulesSource, { filename: 'teacher-room-rules-v1.js' });
assert(rentalSource.includes('rental-room-equipment'), '租用教室卡片缺少鋼琴類型標示');
assert(rentalSource.includes('excludeDigitalPiano'), '鋼琴租用缺少排除電鋼琴選項');
assert(rentalSource.includes('allowGuzhengMove'), '古箏租用缺少自行搬運選項');
assert(rentalSource.includes('drumType'), '練鼓租用缺少鼓種篩選');
assert(rentalSettingsSource.includes('data-use-rate'), '租用用途設定缺少每小時固定費用');
assert(teacherRoomRulesSource.includes('需自行從展演空間搬古箏'), '老師調課缺少 KAWAI 古箏搬運提醒');

const schedulerHtml = fs.readFileSync(path.join(root, 'course-scheduler.html'), 'utf8');
const schedulerSource = fs.readFileSync(path.join(root, 'course-scheduler.js'), 'utf8');
const schedulerCss = fs.readFileSync(path.join(root, 'course-scheduler.css'), 'utf8');
assert(schedulerHtml.includes('id="dataModePanel"'), '排課頁缺少資料同步面板');
assert(schedulerHtml.includes('id="syncInjiaoyunBtn"'), '排課頁缺少單一同步按鈕');
assert(!schedulerHtml.includes('sandboxLogBtn'), '不應保留測試紀錄按鈕');
assert(!schedulerHtml.includes('undoSandboxBtn'), '不應保留測試復原按鈕');
assert(!schedulerHtml.includes('resetSandboxBtn'), '不應保留測試重設按鈕');
assert(!schedulerHtml.includes('loadMigratedDataBtn'), '不應保留另外載入資料按鈕');
assert(schedulerSource.includes("var WORKSPACE_DB_KEY='workspace'"), '操作資料未使用 IndexedDB 工作區');
assert(schedulerSource.includes('storeWorkspaceDatabase(state)'), '操作後未自動儲存工作區');
assert(schedulerSource.includes('workspaceFromFormal'), '同步後未由最新音教雲資料重建工作區');
assert(schedulerSource.includes('slotCoverageClass(events,room.id,min)'), '有課區間未隱藏內部半小時格線');
assert(schedulerSource.includes('collapseFinalSlotLayers'), '同一教室時段未套用最後成立資料');
assert(schedulerSource.includes('修改租用金額／資料'), '租用明細缺少金額修改入口');
assert(schedulerSource.includes("Object.prototype.hasOwnProperty.call(source,'rentalFee')"), '租用金額為 0 時會被錯誤清空');
assert(schedulerCss.includes('.slot.event-from-prev{border-top-color:transparent}'), '跨半小時課程仍會顯示內部上格線');
assert(schedulerCss.includes('.slot.event-to-next{border-bottom-color:transparent}'), '跨半小時課程仍會顯示內部下格線');
assert(!schedulerCss.includes('.event.leave,.event.absent,.event.cancelled{opacity:.38'), '請假／曠課卡片不可再以透明浮水印顯示');
assert(!schedulerHtml.includes('半透明＝請假／停課'), '課表圖例仍誤導為半透明狀態');

const backend = fs.readFileSync(path.join(root, 'functions/coursePortal.js'), 'utf8');
[
  'coursePortalStartBinding',
  'coursePortalSendEmailOtp',
  'coursePortalVerifyEmailOtp',
  'coursePortalStartLineLogin',
  'coursePortalRenterContactLogin',
  'coursePortalExchangeAccess',
  'coursePortalTeacherData',
  'coursePortalStudentData',
  'coursePortalRentalAvailability',
  'coursePortalCreateRoomBooking',
  'coursePortalRentalMyBookings',
  'coursePortalCancelRoomBooking',
  'coursePortalTeacherAction',
  'coursePortalTeacherLessonState',
  'coursePortalUpdateStudentReminder',
  'coursePortalAdminBindingAction',
  'coursePortalStudentReminderDaily'
].forEach((name) => assert(backend.includes(name), `缺少後端函式 ${name}`));
assert(backend.includes("where('lineUserId', '==', session.lineUserId)"), '租用紀錄未限制為目前 LINE 使用者');
assert(backend.includes('只能取消自己預約的教室'), '取消租用缺少本人權限檢查');
assert(backend.includes('const EMAIL_OTP_TTL_MS = 180 * 1000'), 'Email 四碼驗證碼不是 180 秒');
assert(backend.includes('EMAIL_OTP_MAX_ATTEMPTS = 5'), 'Email 驗證碼缺少五次輸入限制');
assert(backend.includes('taipeiDateTimeMillis(row.date, row.endTime) > Date.now()'), '租用進行中無法取消');
assert(backend.includes('course-portal-booking-${id}-reminder'), '租用缺少開始前一小時提醒');
assert(backend.includes("action === 'delete'"), '後台綁定管理缺少刪除登入資料');
assert(backend.includes("authMethod: 'renter-name-phone'"), '租用入口缺少姓名＋電話臨時登入');
assert(commonSource.includes('global.sessionStorage'), '租用借用裝置登入沒有使用瀏覽階段儲存');
assert(backend.includes("id: 'guzheng'"), '租用用途缺少古箏');
assert(backend.includes("id: 'recording'"), '租用用途缺少錄音室');
assert(backend.includes('hourlyRate: 300'), '錄音用途未設定每小時 NT$300');
assert(backend.includes("if (/錄音室|錄音/.test(clean(room && room.name))) return 100;"), '錄音室其他用途未固定為每小時 NT$100');
assert(backend.includes('data.excludeDigitalPiano'), '後端缺少排除電鋼琴規則');
assert(backend.includes('data.allowGuzhengMove'), '後端缺少 KAWAI 古箏搬運接受規則');
assert(backend.includes('data.drumType'), '後端缺少鼓種篩選規則');
assert(backend.includes("return '電鋼琴'"), '團練室／展演空間缺少電鋼琴分類');
assert(backend.includes("return '平台鋼琴'"), 'YAMAHA 平台教室／5號鋼琴缺少平台鋼琴分類');
assert(backend.includes("return '直立鋼琴'"), 'KAWAI 教室／YAMAHA 直立鋼琴缺少直立鋼琴分類');

const portalCss = fs.readFileSync(path.join(root, 'course-portal.css'), 'utf8');
assert(portalCss.includes('@media (max-width: 760px)'), '外部入口缺少手機版樣式');
const internalMobileCss = fs.readFileSync(path.join(root, 'internal-mobile.css'), 'utf8');
assert(internalMobileCss.includes('@media (max-width: 780px)'), '內部系統缺少手機版斷點');
assert(internalMobileCss.includes('body.yz-internal-theme'), '內部手機樣式未限制在內部主題');

const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
assert(rules.includes('match /coursePortalSessions/{document=**} { allow read, write: if false; }'));
assert(rules.includes('match /coursePortalStudentBindings/{document=**} { allow read, write: if false; }'));
assert(rules.includes('match /coursePortalEmailOtps/{document=**} { allow read, write: if false; }'));
assert(rules.includes('match /coursePortalLineLoginCodes/{document=**} { allow read, write: if false; }'));

console.log('course portal tests passed');
