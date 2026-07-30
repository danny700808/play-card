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
assert(commonSource.includes('result.authorizationUrl'), 'LINE 登入仍未直接導向 OAuth');
assert(commonSource.includes('coursePortalCompleteLineRegistration'), '入口缺少 LINE 首次登入');
assert(commonSource.includes("purpose: 'account'"), '一般註冊／登入未使用統一帳號流程');
assert(!commonSource.includes('請用已綁定的 LINE 傳送這段快速登入文字'), 'LINE 登入仍停留在複製文字舊流程');
assert(!commonSource.includes('複製綁定文字'), '入口程式仍保留複製綁定文字');
assert(!commonSource.includes('renderLineAction'), '入口程式仍保留舊 LINE 文字綁定畫面');

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
  assert(html.includes('data-auth-choice-list'), `${file} 缺少兩種登入方式`);
  assert(html.includes('data-line-login'), `${file} 缺少 LINE 優先登入`);
  assert(html.includes('data-regular-auth-form'), `${file} 缺少一般註冊／登入`);
  assert(html.includes('data-line-setup-form'), `${file} 缺少 LINE 首次資料表單`);
  assert(html.includes('一般註冊／登入'), `${file} 一般方式標示不清楚`);
  assert(html.includes('使用 LINE 繼續'), `${file} 缺少清楚的 LINE 按鈕`);
  assert(!html.includes('data-email-login-form'), `${file} 仍保留分離的 Email 登入`);
  assert(!html.includes('data-renter-contact-form'), `${file} 仍保留姓名電話臨時登入`);
  assert(!html.includes('data-show-first-use'), `${file} 仍保留額外的第一次使用入口`);
  assert(!html.includes('data-bind-result'), `${file} 仍保留舊綁定結果框`);
});

const teacherPortal = fs.readFileSync(path.join(root, 'teacher-course-portal.html'), 'utf8');
assert(teacherPortal.includes('value="single_move"'), '老師入口缺少單次調課');
assert(teacherPortal.includes('value="permanent_move"'), '老師入口缺少永久調課');
assert(teacherPortal.includes('id="teacherQuickBackdrop"'), '老師課表缺少點選後的快速操作選單');
assert(teacherPortal.includes('id="weekPicker"'), '老師課表缺少直接選擇星期');
assert(!teacherPortal.includes('teacher-summary-grid'), '老師入口仍保留多餘的上方統計卡');
assert(!portalLanding.includes('老師調課入口'), '老師調課不可誤拆成第四個入口');

const rentalSource = fs.readFileSync(path.join(root, 'room-booking-v2.js'), 'utf8');
const rentalSettingsSource = fs.readFileSync(path.join(root, 'course-portal-settings-v2.js'), 'utf8');
const teacherRoomRulesSource = fs.readFileSync(path.join(root, 'teacher-room-rules-v1.js'), 'utf8');
new vm.Script(rentalSource, { filename: 'room-booking-v2.js' });
new vm.Script(rentalSettingsSource, { filename: 'course-portal-settings-v2.js' });
new vm.Script(teacherRoomRulesSource, { filename: 'teacher-room-rules-v1.js' });
assert(rentalSource.includes('rental-room-equipment'), '租用教室卡片缺少鋼琴類型標示');
[
  '不指定',
  '排除電鋼琴',
  '指定平台鋼琴',
  '指定直立鋼琴'
].forEach((label) => assert(rentalSource.includes(label), `鋼琴租用缺少「${label}」選項`));
assert(rentalSource.includes('name="pianoType"'), '鋼琴條件未使用互斥單選');
assert(rentalSource.includes('allowGuzhengMove'), '古箏租用缺少自行搬運選項');
assert(rentalSource.includes('drumType'), '練鼓租用缺少鼓種篩選');
assert(rentalSource.includes('data-retry-rental'), '租用資料失敗時缺少重新讀取按鈕');
assert(!rentalSource.includes('間可租</small>'), '租用開始時間仍顯示多餘的教室數量');
assert(!rentalSource.includes('個時段</em>'), '租用日期仍顯示多餘的時段數量');
assert(rentalSettingsSource.includes('data-use-rate'), '租用用途設定缺少每小時固定費用');
assert(rentalSettingsSource.includes('data-room-piano'), '教室租用設定缺少鋼琴設備種類');
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
assert(schedulerSource.includes("['digital_piano','電鋼琴']"), '教室設定缺少電鋼琴');
assert(schedulerSource.includes("['grand_piano','平台鋼琴']"), '教室設定缺少平台鋼琴');
assert(schedulerSource.includes("['upright_piano','直立鋼琴']"), '教室設定缺少直立鋼琴');
assert(schedulerSource.includes('saveRoomSettings'), '教室設備沒有同步到租用設定');
assert(schedulerSource.includes('refreshPortalRentals'), '正式課表未自動更新入口成立或取消的租用');
assert(schedulerSource.includes('slotCoverageClass(events,room.id,min)'), '有課區間未隱藏內部半小時格線');
assert(schedulerSource.includes('collapseFinalSlotLayers'), '同一教室時段未套用最後成立資料');
assert(schedulerSource.includes('修改租用金額／資料'), '租用明細缺少金額修改入口');
assert(schedulerSource.includes("Object.prototype.hasOwnProperty.call(source,'rentalFee')"), '租用金額為 0 時會被錯誤清空');
assert(schedulerCss.includes('.slot.event-from-prev{border-top-color:transparent}'), '跨半小時課程仍會顯示內部上格線');
assert(schedulerCss.includes('.slot.event-to-next{border-bottom-color:transparent}'), '跨半小時課程仍會顯示內部下格線');
assert(!schedulerCss.includes('.event.leave,.event.absent,.event.cancelled{opacity:.38'), '請假／曠課卡片不可再以透明浮水印顯示');
assert(!schedulerHtml.includes('半透明＝請假／停課'), '課表圖例仍誤導為半透明狀態');

const backend = fs.readFileSync(path.join(root, 'functions/coursePortal.js'), 'utf8');
const deployWorkflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-course-portal-auth.yml'), 'utf8');
assert(
  deployWorkflow.includes('functions:coursePortalRentalUseSettings'),
  'Firebase 部署清單漏掉租用用途讀取功能'
);
assert(
  deployWorkflow.includes('functions:coursePortalAdminSaveRoomEquipment'),
  'Firebase 部署清單漏掉教室設備同步功能'
);
[
  'coursePortalSendEmailOtp',
  'coursePortalVerifyEmailOtp',
  'coursePortalStartLineLogin',
  'coursePortalCompleteLineRegistration',
  'coursePortalLineLoginCallback',
  'coursePortalExchangeAccess',
  'coursePortalTeacherData',
  'coursePortalStudentData',
  'coursePortalRentalAvailability',
  'coursePortalCreateRoomBooking',
  'coursePortalRentalMyBookings',
  'coursePortalCancelRoomBooking',
  'coursePortalAdminSaveRoomEquipment',
  'coursePortalAdminRoomBookings',
  'coursePortalTeacherAction',
  'coursePortalTeacherLessonState',
  'coursePortalUpdateStudentReminder',
  'coursePortalAdminBindingAction',
  'coursePortalStudentReminderDaily'
].forEach((name) => assert(backend.includes(name), `缺少後端函式 ${name}`));
assert(backend.includes("where('ownerKey', '==', sessionOwnerKey(session))"), '租用紀錄未限制為目前登入帳號');
assert(backend.includes('只能取消自己預約的教室'), '取消租用缺少本人權限檢查');
assert(backend.includes('const EMAIL_OTP_TTL_MS = 180 * 1000'), 'Email 四碼驗證碼不是 180 秒');
assert(backend.includes('EMAIL_OTP_MAX_ATTEMPTS = 5'), 'Email 驗證碼缺少五次輸入限制');
assert(backend.includes("source.purpose === 'account'"), '一般註冊／登入驗證後未直接建立工作階段');
assert(backend.includes('authAccountId'), '一般登入缺少獨立帳號識別');
assert(backend.includes("authMethod: 'email-otp'"), '一般登入未建立 Email 驗證工作階段');
assert(backend.includes('taipeiDateTimeMillis(row.date, row.endTime) > Date.now()'), '租用進行中無法取消');
assert(backend.includes('course-portal-booking-${id}-reminder'), '租用缺少開始前一小時提醒');
assert(backend.includes("action === 'delete'"), '後台綁定管理缺少刪除登入資料');
assert(backend.includes("const LINE_LOGIN_CHANNEL_SECRET = defineSecret('LINE_LOGIN_CHANNEL_SECRET')"), 'LINE Channel secret 未使用後端密鑰');
assert(backend.includes("bot_prompt: 'aggressive'"), 'LINE 登入未顯示加入官方帳號流程');
assert(backend.includes('https://api.line.me/friendship/v1/status'), 'LINE 登入未確認好友狀態');
assert(backend.includes("authMethod: 'line-oauth'"), 'LINE OAuth 登入未建立正式工作階段');
assert(backend.includes('LINE_OAUTH_STATE_TTL_MS'), 'LINE OAuth 缺少短效 state 驗證');
assert(backend.includes("clean(row.lineUserId) &&\n      clean(row.lineUserId) !== lineUserId"), '一般帳號會錯誤阻擋同一人改用 LINE 登入');
assert(commonSource.includes('global.sessionStorage'), '租用借用裝置登入沒有使用瀏覽階段儲存');
assert(backend.includes("id: 'guzheng'"), '租用用途缺少古箏');
assert(backend.includes("id: 'recording'"), '租用用途缺少錄音室');
assert(backend.includes('hourlyRate: 300'), '錄音用途未設定每小時 NT$300');
assert(backend.includes("if (/錄音室|錄音/.test(clean(room && room.name))) return 100;"), '錄音室其他用途未固定為每小時 NT$100');
assert(backend.includes('data.excludeDigitalPiano'), '後端缺少排除電鋼琴規則');
assert(backend.includes('data.pianoType'), '後端缺少鋼琴種類篩選');
assert(backend.includes('data.allowGuzhengMove'), '後端缺少 KAWAI 古箏搬運接受規則');
assert(backend.includes('data.drumType'), '後端缺少鼓種篩選規則');
assert(backend.includes("return '電鋼琴'"), '團練室／展演空間缺少電鋼琴分類');
assert(backend.includes("return '平台鋼琴'"), 'YAMAHA 平台教室／5號鋼琴缺少平台鋼琴分類');
assert(backend.includes("return '直立鋼琴'"), 'KAWAI 教室／YAMAHA 直立鋼琴缺少直立鋼琴分類');
assert(backend.includes("mirrorRows('fixedCourses')"), '租用空檔未讀取固定課表');
assert(backend.includes("mirrorRows('temporaryCourses')"), '租用空檔未讀取臨時課表');
assert(backend.includes("mirrorRows('roomRentals')"), '租用空檔未讀取既有租用');
assert(backend.includes("event.roomId === id && event.date === date"), '租用查詢未依教室與日期排除有課時段');
assert(backend.includes('overlaps(startTime, endTime, event.startTime, event.endTime)'), '租用查詢未檢查課程時段重疊');
assert(backend.includes('row.durationMinutes || row.duration || row.minutes || 60'), '老師課表未依課程長度計算結束時間');

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
assert(rules.includes('match /coursePortalLineOAuthStates/{document=**} { allow read, write: if false; }'));
assert(rules.includes('match /coursePortalLineSetupTokens/{document=**} { allow read, write: if false; }'));

console.log('course portal tests passed');
