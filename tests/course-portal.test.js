'use strict';

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const {
  normalizePhone,
  phoneMatches,
  normalizeScheduleStatus,
  courseSourceIds
} = require('../functions/coursePortalUtils');

assert.strictEqual(normalizePhone('+886 912-345-678'), '0912345678');
assert.strictEqual(normalizePhone('0912 345 678'), '0912345678');
assert.strictEqual(phoneMatches('+886912345678', '0912345678'), true);
assert.strictEqual(phoneMatches('0912345678', '0987654321'), false);
assert.strictEqual(normalizeScheduleStatus({ status: '已請假' }), 'leave');
assert.strictEqual(normalizeScheduleStatus('缺席'), 'absent');
assert.strictEqual(normalizeScheduleStatus('已取消'), 'cancelled');
assert.deepStrictEqual(
  courseSourceIds({ id: 'audit-event', sourceCourseId: 'fixed-course-5' }),
  ['audit-event', 'fixed-course-5'],
  '日表事件必須能以原固定課 ID 取代同時段固定課，避免請假後仍重複占用教室'
);
assert.deepStrictEqual(
  courseSourceIds({ id: 'audit-series-event', seriesId: 'fixed-course-6' }),
  ['audit-series-event', 'fixed-course-6'],
  '日表事件只保留 seriesId 時仍必須能追溯原固定課系列'
);

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
assert(commonSource.includes('coursePortalDirectRegularAccess'), '入口缺少一般方式直接登入流程');
assert(commonSource.includes('coursePortalStartLineLogin'), '入口缺少 LINE 快速登入');
assert(commonSource.includes('result.authorizationUrl'), 'LINE 登入仍未直接導向 OAuth');
assert(commonSource.includes('coursePortalCompleteLineRegistration'), '入口缺少 LINE 首次登入');
assert(commonSource.includes('coursePortalDirectRegularAccess'), '學生／家長入口沒有一般註冊流程');
assert(!commonSource.includes("purpose: 'account'"), '一般註冊／登入仍要求 Email 四碼驗證流程');
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
  assert(html.includes('使用 LINE 註冊／登入'), `${file} 缺少清楚的 LINE 按鈕`);
  assert(!html.includes('data-email-login-form'), `${file} 仍保留分離的 Email 登入`);
  assert(!html.includes('data-renter-contact-form'), `${file} 仍保留姓名電話臨時登入`);
  assert(!html.includes('data-show-first-use'), `${file} 仍保留額外的第一次使用入口`);
  assert(!html.includes('data-bind-result'), `${file} 仍保留舊綁定結果框`);
});

const teacherPortal = fs.readFileSync(path.join(root, 'teacher-course-portal.html'), 'utf8');
const teacherSource = fs.readFileSync(path.join(root, 'teacher-course-portal-v8.js'), 'utf8');
const teacherCss = fs.readFileSync(path.join(root, 'teacher-course-portal-v8.css'), 'utf8');
const studentPortal = fs.readFileSync(path.join(root, 'student-course-portal.html'), 'utf8');
const adminPortal = fs.readFileSync(path.join(root, 'course-portal-admin.html'), 'utf8');
new vm.Script(teacherSource, { filename: 'teacher-course-portal-v8.js' });
assert(teacherSource.includes('data-quick-action="single_move"'), '老師入口缺少單次調課');
assert(teacherSource.includes('data-quick-action="permanent_move"'), '老師入口缺少永久調課');
assert(teacherSource.includes('coursePortalTeacherSlotOptions'), '老師入口缺少先選空位再選課程的即時查詢');
assert(teacherSource.includes('data-target-browse'), '老師入口缺少從空白時段調入課程');
assert(teacherSource.includes('data-planner-room'), '老師入口缺少在課表原地選教室');
assert(teacherSource.includes('data-confirm-permanent'), '永久調課缺少衝突日期確認');
assert(teacherSource.includes('includePayroll: activeTab === \'payroll\''), '薪資資料沒有延後到薪資頁查詢');
assert(!teacherSource.includes("getElementById('actionModal')"), '老師入口仍會跳回舊電腦版大表單');
assert(!teacherSource.includes("getElementById('actionForm')"), '老師入口仍依賴已刪除的舊調課表單');
assert(teacherPortal.includes('id="teacherQuickBackdrop"'), '老師課表缺少點選後的快速操作選單');
assert(!teacherPortal.includes('id="weekPicker"'), '老師課表不應顯示日期／星期選擇器');
assert(teacherPortal.includes('id="prevWeek"') && teacherPortal.includes('id="nextWeek"'), '老師課表缺少前後週控制');
assert(teacherPortal.includes('id="teacherFlowBanner"'), '老師課表缺少原地操作狀態');
assert(teacherPortal.includes('id="teacherLegend"'), '老師課表缺少完整圖例');
assert(teacherPortal.includes('<i class="rental"></i>租用'), '老師課表圖例缺少教室租用');
assert(!teacherPortal.includes('id="actionModal"'), '老師入口仍保留舊電腦版調課表單');
assert(!teacherPortal.includes('id="thisWeek"'), '老師日期列仍保留重複的本週按鈕');
assert(!teacherPortal.includes('id="weekRange"'), '老師日期列仍保留重複的週範圍');
assert(!teacherPortal.includes('teacher-room-rules-v1.js'), '老師入口仍載入依賴舊表單的規則程式');
assert(teacherCss.includes('grid-template-columns:repeat(5,minmax(0,1fr))'), '老師底部五個功能沒有固定同一排');
assert(!teacherPortal.includes('teacher-summary-grid'), '老師入口仍保留多餘的上方統計卡');
assert(!portalLanding.includes('老師調課入口'), '老師調課不可誤拆成第四個入口');
assert(!commonSource.includes('installTeacherApprovedLayout'), '共用程式仍會插入老師上方快捷鍵');
assert(!commonSource.includes('teacherQuickHome'), '共用程式仍會插入重複的老師常用功能');
assert(!commonSource.includes('global.matchMedia ='), '老師入口仍會覆寫瀏覽器滑動行為');
const studentRegularForm = studentPortal.slice(
  studentPortal.indexOf('data-regular-auth-form'),
  studentPortal.indexOf('</form>', studentPortal.indexOf('data-regular-auth-form'))
);
const studentLineSetupForm = studentPortal.slice(
  studentPortal.indexOf('data-line-setup-form'),
  studentPortal.indexOf('</form>', studentPortal.indexOf('data-line-setup-form'))
);
assert(studentRegularForm.includes('name="email"'), '學生／家長一般註冊缺少 Email 欄位');
assert(!studentLineSetupForm.includes('name="email"'), '學生／家長 LINE 首次註冊仍強制填 Email');
assert(studentRegularForm.includes('name="name"') && studentRegularForm.includes('name="phone"'), '學生／家長註冊不是只保留姓名與電話');
assert(teacherPortal.includes('id="studentEditModal"'), '老師端缺少學生姓名電話修改視窗');
assert(teacherPortal.includes('id="studentStopModal"') && teacherPortal.includes('再次確認停課'), '老師端停課缺少二次確認');
assert(teacherPortal.includes('min="2026-07"'), '老師薪資月份未限制為民國 115 年 7 月起');
assert(teacherSource.includes('coursePortalTeacherUpdateStudent'), '老師修改學生資料未連接後端');
assert(teacherSource.includes('coursePortalTeacherStopStudent'), '老師停課未連接後端');
assert(teacherSource.includes('confirmed: true'), '老師停課未傳送二次確認結果');
assert(teacherSource.includes('coursePortalTeacherAttendance'), '老師端缺少當日簽到');
assert(teacherSource.includes('coursePortalTeacherLateAttendance'), '老師端缺少逾期補簽到');
assert(teacherSource.includes('coursePortalTeacherAttendanceCancellationRequest'), '老師端缺少取消簽到送主管審核');
assert(teacherSource.includes('row.date === todayKey()'), '老師正常簽到未限制當天');
assert(teacherSource.includes('補簽到（行政費 NT$50）'), '老師補簽到未清楚顯示行政費');
assert(adminPortal.includes('停課學費未繳清'), '管理者頁缺少停課學費未繳清專區');
assert(adminPortal.includes('coursePortalAdminSuspensionAction'), '管理者欠費簽核未連接後端');
assert(adminPortal.includes('取消簽到待確認'), '管理者頁缺少取消簽到審核窗口');
assert(adminPortal.includes('coursePortalAdminAttendanceCancellationAction'), '管理者取消簽到審核未連接後端');
assert(adminPortal.includes('id="bindingSearch"'), '登入帳號管理缺少搜尋');
assert(adminPortal.includes('data-action="approve"'), '管理者缺少登入綁定核准');
assert(adminPortal.includes('data-action="force_logout"'), '管理者缺少強制登出裝置');
assert(studentPortal.includes('name="relationship"'), '學生／家長綁定缺少關係選擇');
assert(studentPortal.includes('id="inactiveStudentView"'), '停課學生缺少受限功能畫面');
assert(studentPortal.includes('id="inactiveHistoryList"'), '停課學生無法查看自己的過去課表');
assert(studentPortal.includes('完成綁定並進入'), '學生 LINE 綁定仍顯示等待主管核准');
assert(teacherPortal.includes('完成綁定並進入老師課務'), '老師 LINE 綁定仍顯示等待主管核准');
assert(studentPortal.includes('paymentBlock(row, request)') && studentPortal.includes('period-payment'), '學生入口沒有把繳費整合到期別卡');
assert(studentPortal.includes('id="tuitionPaymentModal"'), '學生入口缺少繳費方式視窗');
assert(studentPortal.includes('name="paymentMethod" value="bank_transfer"'), '學生入口缺少轉帳繳費選項');
assert(studentPortal.includes('name="paymentMethod" value="onsite"'), '學生入口缺少現場繳費選項');
assert(studentPortal.includes('id="tuitionReceiptFile"'), '學生入口缺少匯款截圖上傳');
assert(studentPortal.includes('28881010149129'), '學生入口缺少既有台新銀行帳號 fallback');
assert(studentPortal.includes('coursePortalStudentSubmitTuitionPayment'), '學生繳費資料未連接後端');
assert(studentPortal.includes('data-tab="contact"'), '學生入口缺少課堂聯絡簿入口');
assert(studentPortal.includes('課程與學費') && studentPortal.includes('租用教室') && studentPortal.includes('LINE 提醒'), '學生底部入口不完整');
assert(studentPortal.includes('新系統僅顯示最新兩期資料') && studentPortal.includes('紙本上課證'), '學生入口未清楚說明只顯示最新兩期');
assert(studentPortal.includes('lesson-slot-grid') && studentPortal.includes('未使用'), '學生期別卡缺少堂次小格與未使用標示');
assert(studentPortal.includes('studentSwitcher') && studentPortal.includes('data.students.length <= 1'), '只有一位學生時仍顯示不必要的學生切換');
assert(studentPortal.includes('student-bottom-tabs') && studentPortal.includes('payment-due'), '學生入口缺少固定底部導航或末堂未繳提醒');
assert(studentPortal.includes('coursePortalStudentContactBookImage'), '學生入口無法安全查看聯絡簿照片');
assert(teacherSource.includes('data-quick-contact-book'), '老師課表缺少課堂聯絡簿操作');
assert(teacherSource.includes('coursePortalTeacherSubmitContactBookPost'), '老師聯絡簿未連接後端');
assert(!teacherPortal.slice(teacherPortal.indexOf('data-line-setup-form'), teacherPortal.indexOf('</form>', teacherPortal.indexOf('data-line-setup-form'))).includes('name="email"'), '老師 LINE 首次註冊仍要求 Email');
assert(adminPortal.includes('學費繳費待確認'), '管理者頁缺少學費繳費待確認專區');
assert(adminPortal.includes('coursePortalAdminTuitionPaymentScreenshot'), '管理者無法安全讀取匯款截圖');
assert(adminPortal.includes('coursePortalAdminTuitionPaymentAction'), '管理者學費確認未連接後端');

const contactPortalFunctions = fs.readFileSync(path.join(root, 'functions/coursePortal.js'), 'utf8');
assert(!contactPortalFunctions.includes('老師資料尚未登記 Email'), '老師 LINE 註冊仍被既有 Email 欄位阻擋');
const contactRules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const contactDeployment = fs.readFileSync(path.join(root, '.github/workflows/deploy-course-portal-auth.yml'), 'utf8');
assert(contactPortalFunctions.includes("const CONTACT_BOOK_POSTS = 'coursePortalLessonContactPosts'"), '課堂聯絡簿缺少私密資料集合');
assert(contactPortalFunctions.includes('coursePortalTeacherSubmitContactBookPost') && contactPortalFunctions.includes('coursePortalStudentContactBookImage'), '課堂聯絡簿 Callable Functions 不完整');
assert(contactPortalFunctions.includes('linkedAttendance') && contactPortalFunctions.includes('teacherPhone'), '學生入口無法從課程與簽到資料補出老師聯絡資訊');
assert(contactRules.includes('coursePortalLessonContactPosts') && contactRules.includes('allow read, write: if false'), '課堂聯絡簿資料不可由前端直接讀寫');
assert(contactDeployment.includes('functions:coursePortalTeacherSubmitContactBookPost') && contactDeployment.includes('functions:coursePortalStudentContactBookImage'), '部署流程缺少課堂聯絡簿 Functions');

const rentalSource = fs.readFileSync(path.join(root, 'room-booking-v2.js'), 'utf8');
const rentalHtml = fs.readFileSync(path.join(root, 'room-booking.html'), 'utf8');
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
assert(rentalSource.includes('slot.past'), '一般租用畫面未屏蔽當天已過時間');
assert(rentalSource.includes('day.past'), '一般租用畫面未屏蔽過去日期');
assert(rentalSource.includes('roomRequestId += 1'), '切換租用條件時沒有讓舊教室查詢失效');
assert(rentalSource.includes("role === 'student' && studentDiscountEligible"), '停課學生或非學生仍會看到學生半價選項');
assert(rentalSource.includes('Promise.all([loadRentalData(), loadBookings()])'), '租用首屏仍以串行方式載入');
assert(rentalHtml.includes('id="rentalHeaderTitle"'), '租用頁標題缺少登入姓名顯示位置');
assert(rentalSource.includes('renderWelcomeName(boardData.displayName)'), '租用頁沒有顯示後端確認的登入姓名');
assert(rentalSource.includes("normalize('NFKC')") && rentalSource.includes('/[@\\r\\n]/.test(name)'), '租用頁標題缺少全形 Email／電話防誤顯示保護');
assert(rentalHtml.includes('一般教室使用 <b>NT$100/小時</b>'), '錄音室確認缺少一般教室使用價格選項');
assert(rentalHtml.includes('錄音室錄音使用 <b>NT$300/小時</b>'), '錄音室確認缺少錄音使用價格選項');
assert(!/name="recordingUsage"[^>]*checked/.test(rentalHtml), '錄音室使用方式不可預先代選');
assert(rentalSource.includes('NT$100–300／小時'), '錄音室用途卡或教室卡未顯示 NT$100–300 價格範圍');
assert(rentalSource.includes('recordingUsage,'), '錄音室使用方式未送往後端');
assert(rentalSource.includes("selectedUse === 'recording' && !recordingUsage"), '前端未阻擋未選錄音室使用方式的預約');
assert(rentalSource.includes("classList.toggle('hidden', recording && !student)"), '錄音室非學生確認仍顯示重複的一般租用價格組');
assert(rentalSource.includes("recording ? '學生折扣（選填）' : '租用價格'"), '錄音室學生半價未標成獨立折扣');
assert(rentalSettingsSource.includes('data-use-rate'), '租用用途設定缺少每小時固定費用');
assert(rentalSettingsSource.includes('data-room-piano'), '教室租用設定缺少鋼琴設備種類');

const schedulerHtml = fs.readFileSync(path.join(root, 'course-scheduler.html'), 'utf8');
const schedulerSource = fs.readFileSync(path.join(root, 'course-scheduler.js'), 'utf8');
const schedulerCss = fs.readFileSync(path.join(root, 'course-scheduler.css'), 'utf8');
const schedulerDataSource = fs.readFileSync(path.join(root, 'course-scheduler-data.js'), 'utf8');
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
assert(schedulerHtml.includes('老師贈課'), '桌面課表圖例缺少老師贈課');
assert(schedulerHtml.includes('雙人／團體'), '桌面課表圖例缺少雙人／團體課');
assert(schedulerHtml.includes('取消／調走'), '桌面課表圖例缺少取消／調走');
assert(schedulerHtml.includes('曠課不扣學生堂數但仍列入老師薪資'), '桌面說明與曠課薪資規則不一致');
assert(schedulerSource.includes("return status==='leave'||status==='cancelled'"), '桌面課表仍錯把曠課視為釋出教室');
assert(schedulerDataSource.includes('course.start||course.startTime'), '桌面課表無法讀取入口建立的 startTime');
assert(schedulerDataSource.includes("typeof status==='object'?status.status:status"), '桌面課表無法讀取物件格式的請假／取消狀態');

const schedulerSandbox = {
  window: {},
  console,
  Date,
  Set,
  Map,
  Number,
  String,
  Object,
  Array,
  Math,
  Promise
};
vm.createContext(schedulerSandbox);
new vm.Script(schedulerDataSource, { filename: 'course-scheduler-data.js' }).runInContext(schedulerSandbox);
const normalizedPortalState = schedulerSandbox.window.YouziCoursePreviewData.buildState({
  rooms: [{ id: 'room-1', name: '展演空間', active: true }],
  subjects: [{ id: 'subject-1', name: '鋼琴', active: true }],
  teachers: [{ id: 'teacher-1', name: '老師', active: true }],
  students: [{ id: 'student-1', name: '學生', active: true }],
  fixedCourses: [{
    id: 'portal-fixed',
    date: '2026-07-30',
    startTime: '18:00',
    endTime: '19:00',
    roomId: 'room-1',
    teacherId: 'teacher-1',
    studentIds: ['student-1'],
    subjectId: 'subject-1',
    statusByDate: { '2026-07-30': { status: 'leave' } }
  }]
}, '2026-07-30');
assert(
  normalizedPortalState.events.some((row) => row.sourceCourseId === 'portal-fixed' && row.start === '18:00' && row.status === 'leave'),
  '桌面課表沒有正確顯示入口建立的課程與請假狀態'
);
const normalizedGuzhengState = schedulerSandbox.window.YouziCoursePreviewData.buildState({
  rooms: [
    { id: 'room-show', name: '展演空間', active: true },
    { id: 'room-kawai', name: 'KAWAI 教室', active: true }
  ],
  subjects: [{ id: 'subject-guzheng', name: '古箏', active: true }],
  fixedCourses: [{
    id: 'guzheng-course',
    active: true,
    date: '2026-07-30',
    recurrenceEndDate: '2026-07-30',
    startTime: '18:00',
    endTime: '19:00',
    roomId: 'room-show',
    subjectId: 'subject-guzheng',
    subjectName: '古箏'
  }],
  roomRentals: [{
    id: 'guzheng-rental',
    active: true,
    date: '2026-07-30',
    startTime: '18:00',
    endTime: '19:00',
    roomId: 'room-kawai',
    useType: 'guzheng',
    useName: '古箏'
  }]
}, '2026-07-30');
const normalizedGuzhengCourse = normalizedGuzhengState.events.find((row) => row.sourceCourseId === 'guzheng-course');
const normalizedGuzhengRental = normalizedGuzhengState.events.find((row) => row.portalBookingId === 'guzheng-rental');
assert(normalizedGuzhengCourse.resourceIds.includes('equipment:guzheng'), '古箏課程未標記共用古箏資源');
assert.strictEqual(normalizedGuzhengRental.useType, 'guzheng', '桌面租用資料遺失古箏用途');
assert(normalizedGuzhengRental.resourceIds.includes('equipment:guzheng'), '古箏租用未標記共用古箏資源');
assert(schedulerSource.includes('eventSharedResourceIds(other)'), '桌面課表未檢查不同教室的古箏共用資源衝突');

const backend = fs.readFileSync(path.join(root, 'functions/coursePortal.js'), 'utf8');
const mirrorSource = fs.readFileSync(path.join(root, 'functions/injiaoyunEducationMirror.js'), 'utf8');
const deployWorkflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-course-portal-auth.yml'), 'utf8');

function backendFixtureDocument(id, data) {
  return {
    id,
    exists: true,
    data: () => data
  };
}

function backendFixtureValue(source, field) {
  return String(field || '').split('.').reduce((value, key) => (
    value == null ? undefined : value[key]
  ), source);
}

function createBackendFixtureDb(state) {
  class FixtureQuery {
    constructor(name, filters = []) {
      this.name = name;
      this.filters = filters;
    }

    where(field, operator, expected) {
      return new FixtureQuery(this.name, this.filters.concat({ field, operator, expected }));
    }

    doc(id) {
      const collectionName = this.name;
      return {
        async get() {
          const entry = (state.collections[collectionName] || []).find((row) => row.id === id);
          return entry
            ? backendFixtureDocument(entry.id, entry.data)
            : { id, exists: false, data: () => undefined };
        }
      };
    }

    async get() {
      const rows = (state.collections[this.name] || []).filter((entry) => (
        this.filters.every(({ field, operator, expected }) => {
          const actual = backendFixtureValue(entry.data, field);
          if (operator === '==') return actual === expected;
          if (operator === '>=') return actual >= expected;
          if (operator === '<=') return actual <= expected;
          if (operator === 'in') return Array.isArray(expected) && expected.includes(actual);
          throw new Error(`unsupported fixture query operator: ${operator}`);
        })
      ));
      const docs = rows.map((entry) => backendFixtureDocument(entry.id, entry.data));
      return { docs, size: docs.length, empty: docs.length === 0 };
    }
  }

  return {
    collection(name) {
      return new FixtureQuery(name);
    }
  };
}

function loadBackendForScheduleTests(state) {
  const backendPath = path.join(root, 'functions/coursePortal.js');
  const fixtureDb = createBackendFixtureDb(state);
  const fakeFirestore = () => fixtureDb;
  fakeFirestore.FieldValue = {
    serverTimestamp: () => 'fixture-server-time',
    increment: (value) => value,
    delete: () => 'fixture-delete'
  };
  fakeFirestore.Timestamp = {
    fromDate: (value) => value
  };
  const FakeHttpsError = class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  };
  const firebaseAdmin = {
    apps: [{}],
    initializeApp() {},
    firestore: fakeFirestore
  };
  const originalLoad = Module._load;
  Module._load = function fixtureModuleLoad(request, parent, isMain) {
    if (request === 'firebase-admin') return firebaseAdmin;
    if (request === 'firebase-functions/v2/https') {
      return {
        HttpsError: FakeHttpsError,
        onCall: (options, handler) => handler || options,
        onRequest: (options, handler) => handler || options
      };
    }
    if (request === 'firebase-functions/v2/scheduler') {
      return { onSchedule: (options, handler) => handler || options };
    }
    if (request === 'firebase-functions/params') {
      return { defineSecret: () => ({ value: () => '' }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const fixtureModule = new Module(backendPath, module);
    fixtureModule.filename = backendPath;
    fixtureModule.paths = Module._nodeModulePaths(path.dirname(backendPath));
    fixtureModule._compile(
      `${backend}\n` +
      'module.exports.__testScheduleBundle = scheduleBundle;\n' +
      'module.exports.__testAssertScheduleWritable = assertScheduleWritable;\n' +
      'module.exports.__testRecordingRentalSelection = recordingRentalSelection;\n' +
      'module.exports.__testRentalAmount = rentalAmount;\n' +
      'module.exports.__testEffectiveRentalFee = effectiveRentalFee;\n' +
      'module.exports.__testSafeRentalDisplayName = safeRentalDisplayName;\n' +
      'module.exports.__testRentalSessionDisplayName = rentalSessionDisplayName;\n' +
      'module.exports.__testMergePortalTuitionRows = mergePortalTuitionRows;\n' +
      'module.exports.__testBuildTuitionPaymentCandidates = buildTuitionPaymentCandidates;\n',
      backendPath
    );
    return fixtureModule.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function mirrorFixture(source) {
  return {
    sourceActive: true,
    source
  };
}

function scheduleFixtureCollections(overrides = {}) {
  return Object.assign({
    opsEducationMirrorRooms: [],
    opsEducationMirrorSubjects: [],
    opsEducationMirrorStudents: [],
    opsEducationMirrorTeachers: [],
    opsEducationMirrorEvents: [],
    opsEducationMirrorFixedCourses: [],
    opsEducationMirrorTemporaryCourses: [],
    opsEducationMirrorRoomRentals: [],
    coursePortalScheduleChanges: [],
    coursePortalRoomBookings: [],
    coursePortalRoomSettings: [],
    coursePortalStudentProfiles: [],
    coursePortalStudentSuspensions: []
  }, overrides);
}

async function runBackendScheduleRegressionTests() {
  const failures = [];
  const check = (callback) => {
    try {
      callback();
    } catch (error) {
      failures.push(error);
    }
  };
  const sharedMirrors = {
    opsEducationMirrorRooms: [
      { id: 'room-old', data: mirrorFixture({ id: 'room-old', name: '舊教室', active: true }) },
      { id: 'room-new', data: mirrorFixture({ id: 'room-new', name: '新教室', active: true }) }
    ],
    opsEducationMirrorSubjects: [
      { id: 'subject-piano', data: mirrorFixture({ id: 'subject-piano', name: '鋼琴', active: true }) }
    ],
    opsEducationMirrorStudents: [
      { id: 'student-1', data: mirrorFixture({ id: 'student-1', name: '學生', active: true }) }
    ],
    opsEducationMirrorTeachers: [
      { id: 'teacher-1', data: mirrorFixture({ id: 'teacher-1', name: '老師', active: true }) }
    ]
  };
  const fixedCourse = {
    id: 'fixed-1',
    active: true,
    date: '2026-07-01',
    startTime: '18:00',
    endTime: '19:00',
    recurrenceEndDate: '2026-08-31',
    frequencyWeeks: 1,
    roomId: 'room-old',
    teacherId: 'teacher-1',
    studentIds: ['student-1'],
    subjectId: 'subject-piano'
  };
  const oldPermanent = {
    id: 'permanent-old',
    active: true,
    action: 'permanent_move',
    sourceCourseId: 'fixed-1',
    sourceDate: '2026-07-15',
    cutoverDate: '2026-07-15',
    anchorDate: '2026-07-16',
    frequencyWeeks: 1,
    createdAtText: '2026-07-01T10:00:00+08:00',
    event: Object.assign({}, fixedCourse, {
      id: 'permanent-old-event',
      date: '2026-07-16',
      roomId: 'room-old',
      fixedCourseId: 'fixed-1',
      seriesId: 'fixed-1'
    })
  };
  const newPermanent = {
    id: 'permanent-new',
    active: true,
    action: 'permanent_move',
    sourceCourseId: 'fixed-1',
    sourceDate: '2026-07-15',
    cutoverDate: '2026-07-15',
    anchorDate: '2026-07-16',
    frequencyWeeks: 1,
    createdAtText: '2026-07-02T10:00:00+08:00',
    event: Object.assign({}, fixedCourse, {
      id: 'permanent-new-event',
      date: '2026-07-16',
      roomId: 'room-new',
      fixedCourseId: 'fixed-1',
      seriesId: 'fixed-1'
    })
  };
  const duplicatePermanentState = {
    collections: scheduleFixtureCollections(Object.assign({}, sharedMirrors, {
      opsEducationMirrorFixedCourses: [
        { id: 'fixed-1', data: mirrorFixture(fixedCourse) }
      ],
      coursePortalRenters: [
        { id: 'renter-1', data: { name: '林租客', phone: '0912345678', email: 'renter@example.com' } }
      ],
      coursePortalTeacherBindings: [
        {
          id: 'teacher-binding-wrong',
          data: {
            status: 'active',
            authAccountId: 'account-teacher',
            teacherId: 'teacher-2',
            name: '其他老師'
          }
        },
        {
          id: 'teacher-binding-exact',
          data: {
            status: 'active',
            authAccountId: 'account-teacher',
            teacherId: 'teacher-1',
            name: '王老師'
          }
        }
      ],
      coursePortalScheduleChanges: [
        { id: 'permanent-old', data: oldPermanent },
        { id: 'permanent-new', data: newPermanent }
      ]
    }))
  };
  const duplicatePermanentBackend = loadBackendForScheduleTests(duplicatePermanentState);
  const [renterDisplayName, teacherDisplayName, studentDisplayName] = await Promise.all([
    duplicatePermanentBackend.__testRentalSessionDisplayName({
      role: 'renter',
      renterId: 'renter-1',
      authAccountId: 'account-renter'
    }),
    duplicatePermanentBackend.__testRentalSessionDisplayName({
      role: 'teacher',
      teacherId: 'teacher-1',
      authAccountId: 'account-teacher'
    }),
    duplicatePermanentBackend.__testRentalSessionDisplayName({
      role: 'student',
      studentIds: ['student-1'],
      authAccountId: 'account-student'
    })
  ]);
  const mergedTuitionRows = duplicatePermanentBackend.__testMergePortalTuitionRows(
    [{
      id: 'period-existing',
      studentId: 'student-1',
      expectedAmount: 3200,
      paidAmount: 0,
      transactions: []
    }],
    [{
      id: 'period-portal',
      studentId: 'student-1',
      expectedAmount: 3200,
      paidAmount: 0,
      active: true
    }],
    [{
      id: 'payment-portal',
      studentId: 'student-1',
      periodId: 'period-portal',
      status: 'confirmed',
      amount: 3200,
      active: true
    }]
  );
  const nextTuitionCandidates = duplicatePermanentBackend.__testBuildTuitionPaymentCandidates({
    students: [{ id: 'student-1', name: '林小明' }],
    subjects: [{ id: 'subject-piano', name: '鋼琴' }],
    teachers: [{ id: 'teacher-1', name: '王老師' }],
    studentIds: ['student-1'],
    periods: [{
      id: 'period-3',
      studentId: 'student-1',
      subjectId: 'subject-piano',
      teacherId: 'teacher-1',
      periodNo: 3,
      lessonCount: 4,
      usedCount: 4,
      expectedAmount: 3200,
      paidAmount: 3200
    }]
  });
  const paidNextTuitionCandidates = duplicatePermanentBackend.__testBuildTuitionPaymentCandidates({
    students: [{ id: 'student-1', name: '林小明' }],
    subjects: [{ id: 'subject-piano', name: '鋼琴' }],
    teachers: [{ id: 'teacher-1', name: '王老師' }],
    studentIds: ['student-1'],
    periods: [
      {
        id: 'period-3',
        studentId: 'student-1',
        subjectId: 'subject-piano',
        teacherId: 'teacher-1',
        periodNo: 3,
        lessonCount: 4,
        usedCount: 4,
        expectedAmount: 3200,
        paidAmount: 3200
      },
      {
        id: 'period-4',
        studentId: 'student-1',
        subjectId: 'subject-piano',
        teacherId: 'teacher-1',
        periodNo: 4,
        lessonCount: 4,
        usedCount: 0,
        expectedAmount: 3200,
        paidAmount: 3200
      }
    ]
  });
  check(() => {
    assert.strictEqual(renterDisplayName, '林租客', '一般或 LINE 租用登入未保留已註冊姓名');
    assert.strictEqual(teacherDisplayName, '王老師', '老師租用頁未優先使用目前 teacherId 的綁定姓名');
    assert.strictEqual(studentDisplayName, '學生', '學生租用頁缺少 mirror 姓名 fallback');
    const portalPeriod = mergedTuitionRows.find((row) => row.id === 'period-portal');
    assert(portalPeriod, '主管確認後沒有建立新的入口學費期別');
    assert.strictEqual(portalPeriod.paidAmount, 3200, '入口付款沒有合併到正確期別');
    assert.strictEqual(portalPeriod.transactions.length, 1, '入口付款沒有形成正式付款紀錄');
    assert.strictEqual(nextTuitionCandidates.length, 1, '完成第 4 堂後沒有產生下一期繳費資料');
    assert.strictEqual(nextTuitionCandidates[0].nextPeriodNo, 4, '下一期沒有自動承接正確期別');
    assert.strictEqual(nextTuitionCandidates[0].studentName, '林小明', '下一期繳費資料缺少學生姓名');
    assert.strictEqual(nextTuitionCandidates[0].expectedAmount, 3200, '下一期沒有沿用本期學費金額');
    assert.strictEqual(paidNextTuitionCandidates.length, 0, '下一期已繳費仍重複產生繳費提醒');
    const general = duplicatePermanentBackend.__testRecordingRentalSelection({
      useType: 'recording',
      recordingUsage: 'general_room'
    }, true);
    const studio = duplicatePermanentBackend.__testRecordingRentalSelection({
      useType: 'recording',
      recordingUsage: 'studio_recording'
    }, true);
    assert.strictEqual(general.hourlyRate, 100, '一般教室使用未套用每小時 NT$100');
    assert.strictEqual(studio.hourlyRate, 300, '錄音室錄音使用未套用每小時 NT$300');
    assert.strictEqual(
      duplicatePermanentBackend.__testEffectiveRentalFee({}, {}, { id: 'recording', hourlyRate: 300 }),
      null,
      '錄音室未選使用方式時仍預先顯示固定 NT$300'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testEffectiveRentalFee({}, {}, { id: 'recording', hourlyRate: 300 }, general),
      100,
      '後端未依一般教室使用選項重算單價'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testRentalAmount(general.hourlyRate, 90),
      150,
      '一般教室使用未依 90 分鐘租期重算'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testRentalAmount(studio.hourlyRate, 90, 0.5),
      225,
      '錄音室錄音使用未在依租期重算後保留學生半價'
    );
    assert.throws(
      () => duplicatePermanentBackend.__testRecordingRentalSelection({ useType: 'recording' }, true),
      (error) => error && error.code === 'invalid-argument',
      '後端仍接受未選錄音室使用方式的預約'
    );
    assert.throws(
      () => duplicatePermanentBackend.__testRecordingRentalSelection({
        useType: 'recording',
        recordingUsage: 'general'
      }, true),
      (error) => error && error.code === 'invalid-argument',
      '後端仍接受偽造的錄音室使用方式'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testSafeRentalDisplayName('王小明'),
      '王小明',
      '租用頁未保留有效登入姓名'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testSafeRentalDisplayName('user@example.com'),
      '',
      '租用頁可能把 Email 當成歡迎姓名'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testSafeRentalDisplayName('0912-345-678'),
      '',
      '租用頁可能把電話當成歡迎姓名'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testSafeRentalDisplayName('０９１２３４５６７８'),
      '',
      '租用頁可能把全形電話當成歡迎姓名'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testSafeRentalDisplayName('user＠example.com'),
      '',
      '租用頁可能把全形 Email 當成歡迎姓名'
    );
  });
  const suspensionBackend = loadBackendForScheduleTests({
    collections: scheduleFixtureCollections(Object.assign({}, sharedMirrors, {
      opsEducationMirrorFixedCourses: [
        { id: 'fixed-1', data: mirrorFixture(fixedCourse) }
      ],
      coursePortalStudentSuspensions: [{
        id: 'stop-1',
        data: {
          status: 'active',
          teacherId: 'teacher-1',
          studentId: 'student-1',
          effectiveDate: '2026-07-22'
        }
      }]
    }))
  });
  const suspensionBundle = await suspensionBackend.__testScheduleBundle(
    '2026-07-15',
    '2026-07-29',
    'teacher-1'
  );
  check(() => {
    assert(
      suspensionBundle.events.some((row) => row.fixedCourseId === 'fixed-1' && row.date === '2026-07-15'),
      '停課生效日前的既有課程被錯誤移除'
    );
    assert(
      !suspensionBundle.events.some((row) => row.fixedCourseId === 'fixed-1' && row.date >= '2026-07-22'),
      '老師完成停課後，生效日之後的課程仍會出現在課表'
    );
  });
  const groupSuspensionBackend = loadBackendForScheduleTests({
    collections: scheduleFixtureCollections(Object.assign({}, sharedMirrors, {
      opsEducationMirrorStudents: sharedMirrors.opsEducationMirrorStudents.concat([
        { id: 'student-2', data: mirrorFixture({ id: 'student-2', name: '同班學生', active: true }) }
      ]),
      opsEducationMirrorFixedCourses: [{
        id: 'fixed-group',
        data: mirrorFixture(Object.assign({}, fixedCourse, {
          id: 'fixed-group',
          studentIds: ['student-1', 'student-2']
        }))
      }],
      coursePortalStudentSuspensions: [{
        id: 'stop-group-1',
        data: {
          status: 'active',
          teacherId: 'teacher-1',
          studentId: 'student-1',
          effectiveDate: '2026-07-22'
        }
      }]
    }))
  });
  const groupSuspensionBundle = await groupSuspensionBackend.__testScheduleBundle(
    '2026-07-22',
    '2026-07-22',
    'teacher-1'
  );
  check(() => {
    const groupEvent = groupSuspensionBundle.events.find((row) => row.fixedCourseId === 'fixed-group');
    assert(groupEvent, '團體課其中一位學生停課時，整堂課被錯誤取消');
    assert.deepStrictEqual(groupEvent.studentIds, ['student-2'], '團體課停課後沒有只移除指定學生');
  });
  const expiredSync = { toMillis: () => Date.now() - 60 * 1000 };
  const scheduleSnapshot = (data) => ({ exists: true, data: () => data });
  check(() => {
    assert.throws(
      () => duplicatePermanentBackend.__testAssertScheduleWritable(scheduleSnapshot({
        syncing: true,
        syncingUntil: expiredSync,
        writesBlocked: true,
        integrityStatus: 'syncing'
      })),
      (error) => error && error.code === 'aborted',
      '同步逾時後 writesBlocked=true 仍必須拒絕課表寫入'
    );
  });
  check(() => {
    assert.throws(
      () => duplicatePermanentBackend.__testAssertScheduleWritable(scheduleSnapshot({
        syncing: false,
        syncingUntil: expiredSync,
        writesBlocked: false,
        integrityStatus: 'error'
      })),
      (error) => error && error.code === 'aborted',
      '同步逾時後 integrityStatus=error 仍必須拒絕課表寫入'
    );
  });
  check(() => {
    assert.doesNotThrow(
      () => duplicatePermanentBackend.__testAssertScheduleWritable(scheduleSnapshot({
        syncing: false,
        syncingUntil: expiredSync,
        writesBlocked: false,
        integrityStatus: 'healthy',
        lastSyncStatus: 'success'
      })),
      '只有同步成功並解除 writesBlocked 後才應恢復課表寫入'
    );
  });
  const duplicateBundle = await duplicatePermanentBackend.__testScheduleBundle(
    '2026-07-15',
    '2026-07-31',
    'teacher-1'
  );
  const permanentOccurrences = duplicateBundle.events.filter((row) => (
    row.portalAction === 'permanent_move' && row.fixedCourseId === 'fixed-1'
  ));
  check(() => {
    assert.deepStrictEqual(
      permanentOccurrences.map((row) => `${row.date}|${row.roomId}`),
      [
        '2026-07-16|room-new',
        '2026-07-23|room-new',
        '2026-07-30|room-new'
      ],
      '同一 cutover 的舊 permanent_move 未被新版取代，造成固定系列雙展開'
    );
  });

  const canonicalAuditEvent = Object.assign({}, fixedCourse, {
    id: 'audit_fixed_1_2026_07_22',
    sourceCourseId: 'fixed-1',
    seriesId: 'fixed-1',
    date: '2026-07-22'
  });
  const movedTimePermanent = Object.assign({}, newPermanent, {
    id: 'permanent-time',
    event: Object.assign({}, newPermanent.event, {
      id: 'permanent-time-event',
      startTime: '19:00',
      endTime: '20:00'
    })
  });
  const canonicalAuditState = {
    collections: scheduleFixtureCollections(Object.assign({}, sharedMirrors, {
      opsEducationMirrorFixedCourses: [
        { id: 'fixed-1', data: mirrorFixture(fixedCourse) }
      ],
      opsEducationMirrorEvents: [
        { id: canonicalAuditEvent.id, data: mirrorFixture(canonicalAuditEvent) }
      ],
      coursePortalScheduleChanges: [
        { id: movedTimePermanent.id, data: movedTimePermanent }
      ]
    }))
  };
  const canonicalAuditBackend = loadBackendForScheduleTests(canonicalAuditState);
  const canonicalAuditBundle = await canonicalAuditBackend.__testScheduleBundle(
    '2026-07-22',
    '2026-07-23',
    'teacher-1'
  );
  check(() => {
    assert.deepStrictEqual(
      canonicalAuditBundle.events
        .filter((row) => row.fixedCourseId === 'fixed-1')
        .map((row) => `${row.date}|${row.startTime}-${row.endTime}|${row.roomId}`),
      ['2026-07-23|19:00-20:00|room-new'],
      '永久調課 cutover 後仍保留 id 不同、但 sourceCourseId／seriesId 相同的舊正式事件'
    );
  });

  const seriesOnlyStatusEvent = Object.assign({}, fixedCourse, {
    id: 'audit_series_only_absent',
    seriesId: 'fixed-1',
    date: '2026-07-22',
    status: 'absent'
  });
  const seriesOnlyStatusState = {
    collections: scheduleFixtureCollections(Object.assign({}, sharedMirrors, {
      opsEducationMirrorFixedCourses: [
        { id: 'fixed-1', data: mirrorFixture(fixedCourse) }
      ],
      opsEducationMirrorEvents: [
        { id: seriesOnlyStatusEvent.id, data: mirrorFixture(seriesOnlyStatusEvent) }
      ],
      coursePortalScheduleChanges: [
        { id: movedTimePermanent.id, data: movedTimePermanent }
      ]
    }))
  };
  const seriesOnlyStatusBackend = loadBackendForScheduleTests(seriesOnlyStatusState);
  const seriesOnlyStatusBundle = await seriesOnlyStatusBackend.__testScheduleBundle(
    '2026-07-22',
    '2026-07-23',
    'teacher-1'
  );
  check(() => {
    const movedStatusEvents = seriesOnlyStatusBundle.events.filter((row) =>
      row.fixedCourseId === 'fixed-1'
    );
    assert.strictEqual(movedStatusEvents.length, 1, 'seriesId-only audit status 造成永久系列遺失或重複');
    assert.strictEqual(
      movedStatusEvents[0].status,
      'absent',
      'seriesId-only canonical status 未映射到 cutover 後的新永久系列'
    );
  });

  const seriesOnlyCancelledEvent = Object.assign({}, fixedCourse, {
    id: 'audit_series_only_cancelled',
    seriesId: 'fixed-1',
    date: '2026-07-22',
    status: 'cancelled'
  });
  const seriesOnlyCancelledState = {
    collections: scheduleFixtureCollections(Object.assign({}, sharedMirrors, {
      opsEducationMirrorFixedCourses: [
        { id: 'fixed-1', data: mirrorFixture(fixedCourse) }
      ],
      opsEducationMirrorEvents: [
        { id: seriesOnlyCancelledEvent.id, data: mirrorFixture(seriesOnlyCancelledEvent) }
      ],
      coursePortalScheduleChanges: [
        { id: movedTimePermanent.id, data: movedTimePermanent }
      ]
    }))
  };
  const seriesOnlyCancelledBackend = loadBackendForScheduleTests(seriesOnlyCancelledState);
  const seriesOnlyCancelledBundle = await seriesOnlyCancelledBackend.__testScheduleBundle(
    '2026-07-22',
    '2026-07-23',
    'teacher-1'
  );
  check(() => {
    assert.strictEqual(
      seriesOnlyCancelledBundle.events.filter((row) => row.fixedCourseId === 'fixed-1').length,
      0,
      'seriesId-only cancelled canonical tombstone 未抑制 cutover 後的新永久 occurrence'
    );
  });

  const appendPayload = {
    rooms: [{ id: 'room-old', name: '舊教室', active: true }, { id: 'room-new', name: '新教室', active: true }],
    fixedCourses: [Object.assign({}, fixedCourse, {
      exceptions: {
        '2026-07-23': { status: 'absent' }
      }
    })],
    temporaryCourses: [],
    roomRentals: [],
    events: []
  };
  const appended = await duplicatePermanentBackend.appendCoursePortalData(appendPayload);
  const appendedPermanent = appended.fixedCourses.filter((row) => row.portalAction === 'permanent_move');
  check(() => {
    assert.strictEqual(appendedPermanent.length, 1, '同一 cutover 的舊 permanent_move 仍被匯出為第二個固定系列');
    assert.strictEqual(appendedPermanent[0].roomId, 'room-new', '同一 cutover 沒有保留最新 permanent_move');
    assert.strictEqual(
      normalizeScheduleStatus(appendedPermanent[0].statusByDate['2026-07-23']),
      'absent',
      '永久系列沒有承接原 fixedCourse 的 statusByDate／exceptions'
    );
  });

  const lessonStatus = {
    id: 'absence-1',
    active: true,
    action: 'lesson_status',
    sourceCourseId: 'fixed-1',
    sourceEventId: 'fixed-1@2026-07-22',
    sourceDate: '2026-07-22',
    event: {
      id: 'absence-event-1',
      date: '2026-07-22',
      fixedCourseId: 'fixed-1',
      roomId: 'room-old',
      teacherId: 'teacher-1',
      studentIds: ['student-1'],
      subjectId: 'subject-piano',
      startTime: '18:00',
      endTime: '19:00',
      status: 'absent'
    }
  };
  const absenceState = {
    collections: scheduleFixtureCollections(Object.assign({}, sharedMirrors, {
      opsEducationMirrorFixedCourses: [
        { id: 'fixed-1', data: mirrorFixture(fixedCourse) }
      ],
      coursePortalScheduleChanges: [
        { id: 'permanent-new', data: newPermanent },
        { id: 'absence-1', data: lessonStatus }
      ]
    }))
  };
  const absenceBackend = loadBackendForScheduleTests(absenceState);
  const absenceBundle = await absenceBackend.__testScheduleBundle(
    '2026-07-22',
    '2026-07-24',
    'teacher-1'
  );
  const movedAbsence = absenceBundle.events.filter((row) => (
    row.fixedCourseId === 'fixed-1' && row.date === '2026-07-23'
  ));
  check(() => {
    assert.strictEqual(movedAbsence.length, 1, '永久系列的 lesson_status 例外被移除或重複展開');
    assert.strictEqual(movedAbsence[0].status, 'absent', '永久系列遺失 lesson_status 的曠課狀態');
  });

  const cancelledCanonical = Object.assign({}, fixedCourse, {
    id: 'canonical-cancelled',
    sourceCourseId: 'fixed-1',
    fixedCourseId: 'fixed-1',
    date: '2026-07-29',
    status: 'cancelled'
  });
  const staleTemporary = Object.assign({}, fixedCourse, {
    id: 'stale-temporary',
    sourceId: 'canonical-cancelled',
    sourceCourseId: 'fixed-1',
    fixedCourseId: 'fixed-1',
    date: '2026-07-29',
    type: 'temporary',
    status: 'scheduled'
  });
  const staleRental = {
    id: 'stale-rental',
    sourceId: 'canonical-cancelled',
    sourceCourseId: 'fixed-1',
    date: '2026-07-29',
    startTime: '18:00',
    endTime: '19:00',
    roomId: 'room-old',
    type: 'rental',
    status: 'scheduled'
  };
  const tombstoneState = {
    collections: scheduleFixtureCollections(Object.assign({}, sharedMirrors, {
      opsEducationMirrorFixedCourses: [
        { id: 'fixed-1', data: mirrorFixture(fixedCourse) }
      ],
      opsEducationMirrorEvents: [
        { id: 'canonical-cancelled', data: mirrorFixture(cancelledCanonical) }
      ],
      opsEducationMirrorTemporaryCourses: [
        { id: 'stale-temporary', data: mirrorFixture(staleTemporary) }
      ],
      opsEducationMirrorRoomRentals: [
        { id: 'stale-rental', data: mirrorFixture(staleRental) }
      ]
    }))
  };
  const tombstoneBackend = loadBackendForScheduleTests(tombstoneState);
  const tombstoneBundle = await tombstoneBackend.__testScheduleBundle(
    '2026-07-29',
    '2026-07-29',
    'teacher-1'
  );
  check(() => {
    assert.strictEqual(
      tombstoneBundle.events.filter((row) => (
        row.date === '2026-07-29' &&
        (row.fixedCourseId === 'fixed-1' || row.sourceId === 'canonical-cancelled')
      )).length,
      0,
      'cancelled canonical event 被舊 active temporary／rental 副本復活'
    );
  });
  check(() => {
    assert(
      permanentHorizonCoversSeries,
      '有結束日的永久系列只檢查 364 天，之後的既有衝突可能形成雙占用'
    );
  });
  if (failures.length) {
    assert.fail(failures.map((error) => error.message).join('\n'));
  }
}
assert(
  deployWorkflow.includes('functions:coursePortalRentalUseSettings'),
  'Firebase 部署清單漏掉租用用途讀取功能'
);
assert(
  deployWorkflow.includes('functions:coursePortalAdminSaveRoomEquipment'),
  'Firebase 部署清單漏掉教室設備同步功能'
);
[
  'coursePortalStudentPhoneAccess',
  'coursePortalSendEmailOtp',
  'coursePortalVerifyEmailOtp',
  'coursePortalStartLineLogin',
  'coursePortalCompleteLineRegistration',
  'coursePortalLineLoginCallback',
  'coursePortalExchangeAccess',
  'coursePortalTeacherData',
  'coursePortalTeacherSlotOptions',
  'coursePortalStudentData',
  'coursePortalStudentSubmitTuitionPayment',
  'coursePortalRentalAvailability',
  'coursePortalCreateRoomBooking',
  'coursePortalRentalMyBookings',
  'coursePortalCancelRoomBooking',
  'coursePortalAdminSaveRoomEquipment',
  'coursePortalAdminRoomBookings',
  'coursePortalTeacherAction',
  'coursePortalTeacherLessonState',
  'coursePortalTeacherAttendance',
  'coursePortalTeacherLateAttendance',
  'coursePortalTeacherAttendanceCancellationRequest',
  'coursePortalTeacherUpdateStudent',
  'coursePortalTeacherStopStudent',
  'coursePortalUpdateStudentReminder',
  'coursePortalAdminBindingAction',
  'coursePortalAdminAttendanceCancellationAction',
  'coursePortalAdminSuspensionAction',
  'coursePortalAdminTuitionPaymentAction',
  'coursePortalAdminTuitionPaymentScreenshot',
  'coursePortalStudentReminderDaily'
].forEach((name) => assert(backend.includes(name), `缺少後端函式 ${name}`));
assert(deployWorkflow.includes('functions:coursePortalTeacherSlotOptions'), '部署清單漏掉老師目標時段查詢');
[
  'functions:coursePortalStudentPhoneAccess',
  'functions:coursePortalStudentSubmitTuitionPayment',
  'functions:coursePortalTeacherAttendance',
  'functions:coursePortalTeacherLateAttendance',
  'functions:coursePortalTeacherAttendanceCancellationRequest',
  'functions:coursePortalTeacherUpdateStudent',
  'functions:coursePortalTeacherStopStudent',
  'functions:coursePortalAdminSuspensionAction',
  'functions:coursePortalAdminAttendanceCancellationAction',
  'functions:coursePortalAdminTuitionPaymentAction',
  'functions:coursePortalAdminTuitionPaymentScreenshot',
  'functions:coursePortalStudentReminderDaily'
].forEach((name) => assert(deployWorkflow.includes(name), `Firebase 部署清單漏掉 ${name}`));
assert(backend.includes("where('ownerKey', '==', sessionOwnerKey(session))"), '租用紀錄未限制為目前登入帳號');
assert(backend.includes('只能取消自己預約的教室'), '取消租用缺少本人權限檢查');
assert(backend.includes('const EMAIL_OTP_TTL_MS = 180 * 1000'), 'Email 四碼驗證碼不是 180 秒');
assert(backend.includes('EMAIL_OTP_MAX_ATTEMPTS = 5'), 'Email 驗證碼缺少五次輸入限制');
assert(backend.includes("source.purpose === 'account'"), '一般註冊／登入驗證後未直接建立工作階段');
assert(backend.includes('authAccountId'), '一般登入缺少獨立帳號識別');
assert(backend.includes('const regularIdentity = await resolveRegularIdentity(identity)'), 'LINE 首次登入沒有合併同一人的 Email 帳號鍵');
assert(backend.includes('authAccountId: source.authAccountId'), 'LINE 一次性登入碼交換時遺失帳號鍵');
assert(backend.includes('sharedBindingAuthAccountId(type, bindings)'), 'LINE 多筆綁定未使用穩定帳號鍵');
assert(backend.includes("lineAccountId(type, lineUserId)"), '不同家長的 LINE 帳號鍵沒有獨立，提醒設定可能互相連動');
assert(backend.includes("authMethod: 'email-otp'"), '一般登入未建立 Email 驗證工作階段');
assert(backend.includes("authMethod: 'student-name-phone'"), '學生／家長姓名電話註冊未建立正式工作階段');
assert(backend.includes("const TEACHER_PAYROLL_MIN_MONTH = '2026-07'"), '老師薪資後端未限制民國 115 年 7 月起');
assert(backend.includes("db.collection('coursePortalStudentProfiles')"), '老師修改學生資料沒有保存同步覆寫資料');
assert(backend.includes("db.collection('coursePortalStudentSuspensions')"), '老師停課沒有建立管理者追蹤資料');
assert(backend.includes('tuitionUsedCount(row) >= 4'), '學生完成第 4 堂後沒有建立下一期繳費流程');
assert(backend.includes("status: 'payment_due'"), '下一期學費沒有先建立待繳狀態');
assert(backend.includes("? 'pending_review' : 'onsite_pending'"), '匯款與現場繳費沒有進入各自的待確認狀態');
assert(backend.includes("status: 'confirmed'"), '主管確認後沒有建立正式付款狀態');
assert(backend.includes("admin.storage().bucket().file(storagePath).save"), '匯款截圖沒有由後端存進私人儲存空間');
assert(backend.includes("cacheControl: 'private, no-store, max-age=0'"), '匯款截圖沒有設定私人禁止快取');
assert(backend.includes('mergePortalTuitionRows'), '主管確認後的期別與付款沒有合併回學費資料');
assert(backend.includes("schedule: '0 * * * *'"), '第 4 堂學費 LINE 提醒不是每小時檢查');
assert(backend.includes('taipeiDateTimeMillis(row.date, row.endTime) > Date.now()'), '租用進行中無法取消');
assert(backend.includes('course-portal-booking-${id}-reminder'), '租用缺少開始前一小時提醒');
assert(backend.includes("action === 'delete'"), '後台綁定管理缺少刪除登入資料');
assert(backend.includes("approvalStatus: approved ? 'approved' : 'pending'"), '一般登入的新綁定未進入主管核准流程');
const lineRegistrationSource = backend.slice(
  backend.indexOf('async function completeLineRegistration('),
  backend.indexOf('async function activeStudentIdsForLine(')
);
assert(lineRegistrationSource.includes("status: 'active'"), 'LINE 綁定仍需要主管逐筆核准');
assert(!lineRegistrationSource.includes('pendingApproval: true'), 'LINE 綁定完成後仍回傳等待主管核准');
assert(backend.includes("approvalSource: 'line-self-service'"), 'LINE 自助綁定沒有標記直接啟用來源');
assert(!backend.includes("status: 'pending_approval'"), '既有 LINE 待核准綁定沒有在再次登入時自動啟用');
assert(backend.includes('authorizedBindingsForSession(session)'), '敏感入口沒有在每次請求重新確認有效綁定');
assert(backend.includes('reconcileStudentSuspensionsForNewSchedules'), '停課學生新增排課後不會自動恢復');
assert(backend.includes("accessStatus: allowed.has(id) ? 'active' : 'history_and_rental'"), '停課學生沒有保留過去課表與租用權限');
assert(backend.includes("Promise.all(studentIds.map((id) => mirrorRowsByField('attendance'"), '停課學生沒有讀取自己的歷史上課紀錄');
assert(backend.includes('studentDiscountEligible: await studentDiscountEligiblePromise'), '停課學生仍可能取得在籍學生租用折扣');
assert(commonSource.includes("linkAnother: role === 'student' && authView.dataset.addStudent === 'true'"), '家長無法從已登入狀態啟動另一位學生的 LINE 綁定');
assert(backend.includes('bindings.length && stateRow.linkAnother !== true'), 'LINE 已有學生綁定時仍會略過新增另一位學生的流程');
assert(backend.includes('if (!learningIds.has(studentId)) continue;'), '停課學生仍可能收到上課或學費 LINE 提醒');
assert(backend.includes("type: 'late_attendance_fee'"), '補簽到沒有建立 NT$50 薪資扣款');
assert(backend.includes("type: 'attendance_cancellation_fee'"), '取消簽到核准後沒有建立 NT$50 薪資扣款');
assert(backend.includes("status: 'pending'") && backend.includes('ATTENDANCE_CANCELLATIONS'), '取消簽到沒有等待主管核准');
assert(backend.includes("const LINE_LOGIN_CHANNEL_SECRET = defineSecret('LINE_LOGIN_CHANNEL_SECRET')"), 'LINE Channel secret 未使用後端密鑰');
assert(backend.includes("bot_prompt: 'aggressive'"), 'LINE 登入未顯示加入官方帳號流程');
assert(backend.includes('https://api.line.me/friendship/v1/status'), 'LINE 登入未確認好友狀態');
assert(backend.includes("authMethod: 'line-oauth'"), 'LINE OAuth 登入未建立正式工作階段');
assert(backend.includes('LINE_OAUTH_STATE_TTL_MS'), 'LINE OAuth 缺少短效 state 驗證');
assert(backend.includes("clean(row.lineUserId) &&\n      clean(row.lineUserId) !== lineUserId"), '一般帳號會錯誤阻擋同一人改用 LINE 登入');
assert(commonSource.includes('global.sessionStorage'), '租用借用裝置登入沒有使用瀏覽階段儲存');
assert(backend.includes('姓名加電話快速登入已停用'), '後端仍允許只用姓名電話登入');
assert(!commonSource.includes('coursePortalRenterContactLogin'), '前端仍會呼叫已停用的姓名電話登入');
assert(backend.includes("id: 'guzheng'"), '租用用途缺少古箏');
assert(backend.includes("id: 'recording'"), '租用用途缺少錄音室');
assert(backend.includes('hourlyRate: 300'), '錄音用途未設定每小時 NT$300');
assert(backend.includes("if (/錄音室|錄音/.test(clean(room && room.name))) return 100;"), '錄音室其他用途未固定為每小時 NT$100');
assert(backend.includes('recordingRentalSelection(data, true)'), '建立錄音室預約前未強制驗證使用方式');
assert(backend.includes('recordingUsage: clean(recordingSelection && recordingSelection.id)'), '成立預約未保存錄音室使用方式');
assert(backend.includes('displayName: await displayNamePromise'), '租用週表未回傳已驗證的登入姓名');
assert(backend.includes("const teachers = await mirrorRows('teachers')"), '老師租用頁歡迎姓名缺少 mirror fallback');
assert(backend.includes("const students = await mirrorRows('students')"), '學生租用頁歡迎姓名缺少 mirror fallback');
assert(schedulerSource.includes("['guzheng','古箏']"), '教室設定缺少古箏用途');
assert(schedulerSource.includes("['recording','錄音室']"), '教室設定缺少錄音用途');
assert(schedulerSource.includes('data-policy-rental-use'), '教室設定沒有保存可租用途');
assert(backend.includes('function rentalUseAllowsRoom'), '後端未以教室用途限制租用搜尋');
assert(backend.includes('data.excludeDigitalPiano'), '後端缺少排除電鋼琴規則');
assert(backend.includes('data.pianoType'), '後端缺少鋼琴種類篩選');
assert(backend.includes('data.allowGuzhengMove'), '後端缺少 KAWAI 古箏搬運接受規則');
assert(teacherSource.includes('data-guzheng-move-confirm'), '老師選用 KAWAI 教室時缺少古箏搬運確認');
assert(teacherSource.includes('context.payload.allowGuzhengMove = true'), '老師確認搬運後沒有傳送古箏搬運許可');
assert(backend.includes('KAWAI 教室沒有固定放置古箏'), '老師儲存時沒有再次驗證 KAWAI 古箏搬運');
assert(backend.includes('data.drumType'), '後端缺少鼓種篩選規則');
assert(backend.includes("return '電鋼琴'"), '團練室／展演空間缺少電鋼琴分類');
assert(backend.includes("return '平台鋼琴'"), 'YAMAHA 平台教室／5號鋼琴缺少平台鋼琴分類');
assert(backend.includes("return '直立鋼琴'"), 'KAWAI 教室／YAMAHA 直立鋼琴缺少直立鋼琴分類');
assert(backend.includes("mirrorRows('fixedCourses')"), '租用空檔未讀取固定課表');
assert(backend.includes("mirrorRowsByDateRange('temporaryCourses'"), '租用空檔未依日期讀取臨時課表');
assert(backend.includes("mirrorRowsByDateRange('roomRentals'"), '租用空檔未依日期讀取既有租用');
assert(backend.includes('scheduleChangeDocsByDateRange(startDate, endDate)'), '課表查詢仍會讀取全部歷史異動');
assert(backend.includes("collection.where('event.date', '>=', startDate).where('event.date', '<=', endDate)"), '課表異動未依新時段日期查詢');
assert(backend.includes("collection.where('sourceDate', '>=', startDate).where('sourceDate', '<=', endDate)"), '課表異動未依原課程日期查詢');
assert(backend.includes('overlappingEvents.some((event) => event.roomId === id)'), '租用查詢未依教室與日期排除有課時段');
assert(backend.includes('overlaps(startTime, endTime, event.startTime, event.endTime)'), '租用查詢未檢查課程時段重疊');
assert(backend.includes("const GUZHENG_RESOURCE_ID = 'equipment:guzheng'"), '古箏未建成跨教室共用資源');
assert(backend.includes('sharedEquipmentLockRows'), '古箏共用資源缺少最後寫入鎖');
assert(backend.includes('sharedResourceConflict(blockers, requestedResourceIds)'), '老師調課未檢查跨教室古箏衝突');
assert(backend.includes('function scheduleResourceConflicts(events)'), '後台缺少 room／teacher／student／equipment 30 分鐘衝突掃描');
assert(backend.includes('coursePortalAdminScheduleConflictAudit'), '後台缺少可執行的課表衝突檢查入口');
assert(backend.includes('row.durationMinutes || row.duration || row.minutes || 60'), '老師課表未依課程長度計算結束時間');
assert(backend.includes('courseSourceIds(row).forEach'), '日表事件未依原固定課 ID 排除重複占用');
assert(backend.includes('exactSourceRows.forEach'), '已取消的日表資料未保留 tombstone，固定課可能被重新展開');
assert(
  backend.includes("return !['leave', 'cancelled', 'pending_conflict'].includes(status)"),
  '請假／取消／待補排未釋出，或曠課被錯誤釋出'
);
assert(backend.includes('function isRoomRentalEvent(event)'), '老師課務未區分教室租用與學生課程');
assert(teacherSource.includes("if (isRental)"), '老師手機版仍會對租用顯示請假／曠課操作');
assert(backend.includes('publicRentalSlotIsPast(date, startTime)'), '一般租用後端未封鎖過去時段');
assert(backend.includes('availableSlotCount: slots.filter((slot) => !slot.past'), '當天已過時間仍被計入可租時段');
assert(backend.includes("session.role === 'student'"), '學生半價未在後端確認登入角色');
assert(backend.includes('exactTarget = data.exactTarget === true'), '老師點特定時段仍會搜尋整週資料');
assert(backend.includes('event.studentIds.some((studentId) => studentIds.includes(studentId))'), '老師儲存時未檢查每位學生衝突');
assert(backend.includes("throw new HttpsError('aborted'"), '多人同時操作時缺少版本衝突保護');
assert(backend.includes('assertScheduleWritable(versionSnapshot)'), '課表同步進行中仍可寫入租用或調課');
assert(backend.includes("!['extra_lesson', 'teacher_gift'].includes(clean(preview.action))"), '調課取消可能在已釋出的原位置復活並造成雙訂');
assert(backend.includes("source.studentIds.length > 1"), '團體課單一學生請假仍會錯誤釋出整間教室');
assert(backend.includes('cutoverDate:'), '永久調課缺少原系列切換日');
assert(backend.includes('anchorDate:'), '永久調課缺少新系列起算日');
assert(backend.includes('handledPermanentExceptions'), '永久調課後的舊單次例外未映射到新週期，可能重複上課');
assert(backend.includes('futureException'), '永久調課未攔截尚未整理的未來調課／請假例外');
const permanentHorizonCoversSeries = !backend.includes(
    "const horizonEnd = recurrenceEndDate && recurrenceEndDate < addDays(date, 364)\n" +
    '      ? recurrenceEndDate\n' +
    '      : addDays(date, 364);'
);
assert(teacherSource.includes('row.recurring === true'), '老師入口仍從一般來源 ID 猜測固定課');
assert(schedulerDataSource.includes('rentalUseTypes:unique(options.rentalUseTypes)'), '桌面教室用途未同步到入口設定');
assert(schedulerDataSource.includes('room.roomRulesVersion===1||Array.isArray(room.rentalUseTypes)'), '舊教室空用途清單仍會被誤認為管理者刻意關閉');
assert(schedulerSource.includes("if(!explicitRules||typeof room.rentable!=='boolean')"), '載入伺服器教室設定時會覆寫明確的可租用狀態');
assert(schedulerDataSource.includes("policies:options.policies&&typeof options.policies==='object'?options.policies:{}"), '桌面教室開放時段未同步到入口設定');
assert(backend.includes('payload.rooms = payload.rooms.map'), '音教雲教室資料未合併入口設定');
[
  'rentable',
  'teacherSchedulable',
  'allowedSubjectIds',
  'rentalUseTypes',
  'rentalEquipment',
  'pianoType',
  'policies',
  'roomRulesVersion'
].forEach((field) => assert(backend.includes(`'${field}'`), `教室設定合併缺少 ${field}`));
assert(mirrorSource.includes('COURSE_PORTAL_SCHEDULE_VERSION_REF'), '音教雲同步沒有連動課表版本');
assert(mirrorSource.includes('async function markCoursePortalScheduleUpdated'), '音教雲同步缺少課表版本更新程序');
assert(mirrorSource.includes('syncing: true'), '音教雲同步開始前沒有鎖住課表寫入');
assert(mirrorSource.includes('syncing: false'), '音教雲同步完成或失敗後沒有解除課表鎖');
assert(mirrorSource.includes('syncingUntil'), '音教雲同步鎖缺少逾時保護');
assert(mirrorSource.includes('{ coveredDates, deactivateMissing: true }'), '近期權威日表沒有停用已刪除的舊租用／事件');
const reserveSyncSource = mirrorSource.slice(
  mirrorSource.indexOf('async function reserveSync('),
  mirrorSource.indexOf('function reconcileAuditedAttendance(')
);
assert(
  reserveSyncSource.includes("if (directive === 'running')"),
  '同步已在 running 時沒有辨識仍有效的同步鎖'
);
assert(
  reserveSyncSource.includes('transaction.set(SETTINGS_REF, {\n        convergenceQueued: true,'),
  '同步已在 running 時沒有以同一交易寫入 convergenceQueued'
);
assert(
  reserveSyncSource.includes("return { accepted: false, reason: 'running', current };"),
  '同步已在 running 時仍可能啟動第二批同步'
);
const queuedConvergenceSource = mirrorSource.slice(
  mirrorSource.indexOf('async function runQueuedMirrorConvergence('),
  mirrorSource.indexOf('async function auditRefreshRange(')
);
assert(
  queuedConvergenceSource.includes('if (settings.convergenceQueued !== true) return null;'),
  '排隊收斂沒有先確認 convergenceQueued'
);
assert(
  queuedConvergenceSource.includes('convergenceQueued: false'),
  '開始排隊收斂前沒有清除 convergenceQueued，可能重複執行'
);
assert(
  queuedConvergenceSource.includes("return await syncLatestMirror(`${clean(trigger) || 'sync'}:queued-convergence`);"),
  '排隊收斂沒有重新執行最新鏡像同步'
);
assert(
  queuedConvergenceSource.includes('requeueMirrorConvergenceAfterFailure(trigger)'),
  'queued child 在 reserve 前失敗時沒有恢復 convergence queue'
);
assert(
  (mirrorSource.match(
    /const converged = await runQueuedMirrorConvergence\(\s*trigger,\s*reservation\.syncOwner,\s*sourceVersion\s*\)/g
  ) || []).length >= 2,
  '完整同步與近期差異同步成功後沒有以目前 owner 執行 queued convergence'
);
assert(
  (mirrorSource.match(/markCoursePortalScheduleUpdated\(\s*trigger,\s*'success',\s*reservation\.syncOwner/g) || []).length >= 2,
  '完整同步與近期差異同步未以各自 owner 更新課表版本'
);
assert(
  mirrorSource.includes('!activeSyncOwnerMatches(') &&
    mirrorSource.includes('finalizedScope') &&
    mirrorSource.includes('return { accepted: true, current, syncOwner, syncScope: scope };'),
  '同步解鎖沒有驗證 active owner/source/scope，或 accepted reservation 沒有回傳 owner'
);

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
assert(rules.includes('match /coursePortalTuitionPaymentRequests/{document=**} { allow read, write: if false; }'));
assert(rules.includes('match /coursePortalTuitionPeriods/{document=**} { allow read, write: if false; }'));
assert(rules.includes('match /coursePortalTuitionPaymentTransactions/{document=**} { allow read, write: if false; }'));
assert(rules.includes('match /coursePortalAttendanceRecords/{document=**} { allow read, write: if false; }'));
assert(rules.includes('match /coursePortalAttendanceCancellationRequests/{document=**} { allow read, write: if false; }'));
assert(rules.includes('match /coursePortalTeacherAttendancePayroll/{document=**} { allow read, write: if false; }'));

runBackendScheduleRegressionTests()
  .then(() => {
    console.log('course portal tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
