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
assert(!portalLanding.includes('請選擇您的入口'), '入口首頁仍顯示多餘的小字說明');
assert(!portalLanding.includes('所有入口都可使用 LINE 安全登入'), '入口首頁仍顯示多餘的 LINE 說明');
assert(portalLanding.includes('id="portalEntryNotice"') && portalLanding.includes('notice hidden'), 'LINE 錯誤訊息區沒有預設隱藏');

const commonSource = fs.readFileSync(path.join(root, 'course-portal-common.js'), 'utf8');
assert(commonSource.trimStart().startsWith('(function'), 'course-portal-common.js 不是可執行的 JavaScript');
new vm.Script(commonSource, { filename: 'course-portal-common.js' });
assert(!commonSource.includes('coursePortalDirectRegularAccess'), '入口仍可繞過 Email 四碼直接登入');
assert(commonSource.includes('coursePortalStartLineLogin'), '入口缺少 LINE 快速登入');
assert(commonSource.includes('result.authorizationUrl'), 'LINE 登入仍未直接導向 OAuth');
assert(!commonSource.includes('coursePortalCompleteLineRegistration'), 'LINE 首次註冊仍可跳過 Email 四碼');
assert(commonSource.includes("purpose: 'account'"), '一般註冊／登入沒有統一使用 Email 四碼驗證');
assert(commonSource.includes("purpose: 'line-registration'"), 'LINE 首次註冊沒有接上 Email 四碼驗證');
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
  const regularForm = html.slice(
    html.indexOf('data-regular-auth-form'),
    html.indexOf('</form>', html.indexOf('data-regular-auth-form'))
  );
  const lineSetupForm = html.slice(
    html.indexOf('data-line-setup-form'),
    html.indexOf('</form>', html.indexOf('data-line-setup-form'))
  );
  assert(html.includes('data-auth-view'), `${file} 缺少統一登入畫面`);
  assert(html.includes('id="sessionLoading"'), `${file} 缺少登入狀態確認畫面`);
  assert(html.includes('data-auth-choice-list'), `${file} 缺少兩種登入方式`);
  assert(html.includes('data-line-login'), `${file} 缺少 LINE 優先登入`);
  assert(html.includes('data-regular-auth-form'), `${file} 缺少一般註冊／登入`);
  assert(html.includes('data-line-setup-form'), `${file} 缺少 LINE 首次資料表單`);
  assert(html.includes(file==='teacher-course-portal.html'?'Email 驗證登入':'一般註冊／登入'), `${file} 一般方式標示不清楚`);
  assert(html.includes('使用 LINE 註冊／登入'), `${file} 缺少清楚的 LINE 按鈕`);
  assert(!html.includes('data-email-login-form'), `${file} 仍保留分離的 Email 登入`);
  assert(!html.includes('data-renter-contact-form'), `${file} 仍保留姓名電話臨時登入`);
  assert(!html.includes('data-show-first-use'), `${file} 仍保留額外的第一次使用入口`);
  assert(!html.includes('data-bind-result'), `${file} 仍保留舊綁定結果框`);
  assert(/name="email"[^>]*required/.test(regularForm), `${file} 一般註冊未強制填寫 Email`);
  assert(/name="email"[^>]*required/.test(lineSetupForm), `${file} LINE 首次註冊未強制填寫 Email`);
  assert(regularForm.includes('寄送四碼驗證碼'), `${file} 一般註冊未清楚顯示四碼驗證`);
  assert(lineSetupForm.includes('寄送四碼驗證碼'), `${file} LINE 首次註冊未清楚顯示四碼驗證`);
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
assert(teacherSource.includes('data-unavailable-target'), '老師課表未標示不夠完整課程長度的半小時空檔');
assert(teacherSource.includes('時段不足') && teacherSource.includes('需要連續'), '老師課表未清楚說明完整課程長度');
assert(teacherSource.includes('durationMinutes: planner.durationMinutes'), '老師加課未把完整課程長度送到後端再驗證');
assert(teacherSource.includes('defaultAddFits') && teacherSource.includes('直接新增的課程需要'), '老師直接點半小時空檔時仍可誤按一小時加課');
assert(teacherCss.includes('.empty-slot.unavailable-target'), '老師課表缺少時段不足的醒目樣式');
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
assert(studentLineSetupForm.includes('name="email"'), '學生／家長 LINE 首次註冊缺少 Email 欄位');
assert(studentRegularForm.includes('name="name"') && studentRegularForm.includes('name="phone"'), '學生／家長註冊缺少姓名或電話');
assert(/name="email"[^>]*required/.test(studentRegularForm), '學生／家長一般註冊沒有把 Email 設為必填');
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
assert(teacherSource.includes("giftLesson ? '補簽到（贈送課程不收行政費）' : '補簽到'"), '補簽按鈕不應在老師點擊前顯示行政費');
assert(teacherSource.includes('補簽到會收取行政處理費 NT$50'), '老師點擊補簽後未清楚顯示行政費');
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
assert(studentLineSetupForm.includes('寄送四碼驗證碼'), '學生 LINE 首次註冊未要求 Email 四碼');
assert(teacherPortal.includes('寄送四碼驗證碼'), '老師 LINE 首次註冊未要求 Email 四碼');
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
assert(studentPortal.includes('newSystemPeriodNumber(row)'), '學生繳費視窗沒有換算新系統期數');
assert(!studentPortal.includes('第 ${Number(row.nextPeriodNo || 0)} 期'), '學生繳費視窗仍直接顯示舊系統原始期數');
assert(studentPortal.includes('row.systemPeriodNo'), '學生期別卡未使用持久的新系統期數');
assert(studentPortal.includes('item.targetPeriodId === row.id'), '學費申請沒有唯一綁定目標期別');
assert(studentPortal.includes('id="upcomingCourseList"'), '學生入口沒有顯示接下來的課程');
assert(studentPortal.includes('period-payment-amount') && studentPortal.includes('period-payment-state'), '學生學費資訊沒有整理成卡片內的獨立圖框');
assert(!studentPortal.includes('未指定老師') && !studentPortal.includes('尚未指定'), '學生老師聯絡區仍顯示多餘的未登記提示');
assert(teacherSource.includes('data-quick-contact-book'), '老師課表缺少課堂聯絡簿操作');
assert(teacherSource.includes('coursePortalTeacherSubmitContactBookPost'), '老師聯絡簿未連接後端');
assert(/name="email"[^>]*required/.test(teacherPortal.slice(teacherPortal.indexOf('data-line-setup-form'), teacherPortal.indexOf('</form>', teacherPortal.indexOf('data-line-setup-form')))), '老師 LINE 首次註冊沒有把 Email 設為必填');
assert(/name="email"[^>]*required/.test(teacherPortal.slice(teacherPortal.indexOf('data-regular-auth-form'), teacherPortal.indexOf('</form>', teacherPortal.indexOf('data-regular-auth-form')))), '老師 Email 四碼登入沒有把 Email 設為必填');
assert(adminPortal.includes('學費繳費待確認'), '管理者頁缺少學費繳費待確認專區');
assert(adminPortal.includes('coursePortalAdminTuitionPaymentScreenshot'), '管理者無法安全讀取匯款截圖');
assert(adminPortal.includes('coursePortalAdminTuitionPaymentAction'), '管理者學費確認未連接後端');
assert(adminPortal.includes('學費收據紀錄') && adminPortal.includes('data-issued-receipt'), '管理者頁缺少學費收據查看與補印');
assert(adminPortal.includes('@page{size:15cm 10cm'), '學費收據列印尺寸不是 15 × 10 公分');

const contactPortalFunctions = fs.readFileSync(path.join(root, 'functions/coursePortal.js'), 'utf8');
const tuitionReceiptTemplate = fs.readFileSync(path.join(root, 'functions/assets/tuition-receipt-blank.png'));
assert.strictEqual(tuitionReceiptTemplate.readUInt32BE(16), 1500, '學費收據圖片寬度不是 1500 像素');
assert.strictEqual(tuitionReceiptTemplate.readUInt32BE(20), 1000, '學費收據圖片高度不是 1000 像素');
assert(contactPortalFunctions.includes("const TUITION_RECEIPTS = 'coursePortalTuitionReceipts'"), '後端缺少學費收據資料集合');
assert(contactPortalFunctions.includes('renderTuitionReceiptPng') && contactPortalFunctions.includes('saveTuitionReceiptImage'), '後端沒有產生與保存學費收據圖片');
assert(contactPortalFunctions.includes('adminEnsureTuitionReceipt') && contactPortalFunctions.includes('historical-admin-backfill'), '管理者無法替舊繳費紀錄補建收據');
assert(contactPortalFunctions.includes('historical_not_sent'), '舊收據補建流程不可誤傳歷史 LINE 通知');
assert(contactPortalFunctions.includes('forceBoundDelivery: true') && contactPortalFunctions.includes('lineImageUrl'), '已綁定 LINE 的家長沒有自動收到收據圖片');
assert(contactPortalFunctions.includes("@expo-google-fonts/noto-sans-tc/700Bold/NotoSansTC_700Bold.ttf"), '後端缺少可在雲端部署的繁體中文字型');
assert(!studentPortal.includes('data-issued-receipt'), '學生個人頁不應顯示管理者補印收據功能');
assert(!studentPortal.includes('查看／補印收據'), '學生個人頁不應顯示查看／補印收據按鈕');
assert(!contactPortalFunctions.includes('老師資料尚未登記 Email'), '老師 LINE 註冊仍被既有 Email 欄位阻擋');
const contactRules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const contactDeployment = fs.readFileSync(path.join(root, '.github/workflows/deploy-course-portal-auth.yml'), 'utf8');
assert(contactDeployment.includes('functions:coursePortalAdminEnsureTuitionReceipt'), '舊繳費收據補建 Function 未加入部署清單');
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
const schedulerUiHtml = fs.readFileSync(path.join(root, 'operations-course-inline-template.html'), 'utf8');
const schedulerSource = fs.readFileSync(path.join(root, 'course-scheduler.js'), 'utf8');
const schedulerCss = fs.readFileSync(path.join(root, 'course-scheduler.css'), 'utf8');
const schedulerDataSource = fs.readFileSync(path.join(root, 'course-scheduler-data.js'), 'utf8');
assert(schedulerHtml.includes('portal.html#course-calendar'), '舊排課網址未導向現行課務管理');
assert(!schedulerHtml.includes('id="dataModePanel"'), '舊排課頁仍保留重複的課務介面');
assert(schedulerUiHtml.includes('id="dataModePanel"'), '現行課務管理缺少資料同步面板');
assert(schedulerUiHtml.includes('id="syncInjiaoyunBtn"'), '現行課務管理缺少單一同步按鈕');
assert(!schedulerUiHtml.includes('sandboxLogBtn'), '不應保留測試紀錄按鈕');
assert(!schedulerUiHtml.includes('undoSandboxBtn'), '不應保留測試復原按鈕');
assert(!schedulerUiHtml.includes('resetSandboxBtn'), '不應保留測試重設按鈕');
assert(!schedulerUiHtml.includes('loadMigratedDataBtn'), '不應保留另外載入資料按鈕');
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
assert(schedulerUiHtml.includes('id="teacherAdjustmentModal"'), '管理者缺少老師獎勵／扣薪登錄視窗');
assert(schedulerUiHtml.includes('可選擇過去日期補登歷史資料'), '老師獎勵／扣薪不可補登過去資料');
assert(schedulerSource.includes('data-teacher-adjustment'), '老師清單缺少獎勵／扣薪入口');
assert(schedulerSource.includes('function submitTeacherAdjustment'), '老師獎勵／扣薪表單沒有儲存流程');
assert(schedulerSource.includes('選擇上方月份即可查看過去資料'), '老師薪資明細沒有歷史獎勵／扣薪說明');
assert(schedulerDataSource.includes("call('coursePortalAdminSaveTeacherAdjustment'"), '老師薪資異動沒有連接後端');
assert(schedulerCss.includes('.slot.event-from-prev{border-top-color:transparent}'), '跨半小時課程仍會顯示內部上格線');
assert(schedulerCss.includes('.slot.event-to-next{border-bottom-color:transparent}'), '跨半小時課程仍會顯示內部下格線');
assert(!schedulerCss.includes('.event.leave,.event.absent,.event.cancelled{opacity:.38'), '請假／曠課卡片不可再以透明浮水印顯示');
assert(!schedulerUiHtml.includes('半透明＝請假／停課'), '課表圖例仍誤導為半透明狀態');
assert(schedulerUiHtml.includes('老師贈課'), '桌面課表圖例缺少老師贈課');
assert(schedulerUiHtml.includes('雙人／團體'), '桌面課表圖例缺少雙人／團體課');
assert(schedulerUiHtml.includes('取消／調走'), '桌面課表圖例缺少取消／調走');
assert(schedulerUiHtml.includes('只有實際完成簽到才扣學生堂數並列入老師薪資'), '桌面說明與實際完成才計薪規則不一致');
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
      'module.exports.__testAssertTeacherMoveDuration = assertTeacherMoveDuration;\n' +
      'module.exports.__testMergePortalTuitionRows = mergePortalTuitionRows;\n' +
      'module.exports.__testBuildTuitionPaymentCandidates = buildTuitionPaymentCandidates;\n' +
      'module.exports.__testNormalizeTeacherShareRatio = normalizeTeacherShareRatio;\n' +
      'module.exports.__testAttendancePeriodCandidate = attendancePeriodCandidate;\n' +
      'module.exports.__testAttendancePeriodPayroll = attendancePeriodPayroll;\n' +
      'module.exports.__testAttendancePayrollCalculation = attendancePayrollCalculation;\n' +
      'module.exports.__testApplyPortalAttendanceToPeriods = applyPortalAttendanceToPeriods;\n' +
      'module.exports.__testMergeTeacherPayrollRows = mergeTeacherPayrollRows;\n' +
      'module.exports.__testTeacherPayrollMatchesCancellation = teacherPayrollMatchesCancellation;\n' +
      'module.exports.__testAttendanceLessonLockId = attendanceLessonLockId;\n' +
      'module.exports.__testTeacherEventMatchesRequest = teacherEventMatchesRequest;\n' +
      'module.exports.__testNormalizeAdminTeacherAdjustment = normalizeAdminTeacherAdjustment;\n',
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
      ],
      coursePortalTeacherAttendancePayroll: [
        { id: 'portal-admin-payroll', data: {
          id: 'portal-admin-payroll',
          active: true,
          status: 'attended',
          date: '2026-07-31',
          occurredAt: '2026-07-31T10:00:00+08:00',
          teacherId: 'teacher-1',
          studentId: 'student-1',
          studentIds: ['student-1'],
          courseId: 'fixed-1',
          teacherAmount: 420,
          payrollCalculation: { version: 'attendance-period-payroll-v1' }
        } }
      ],
      coursePortalTeacherAdjustments: [
        { id: 'portal-admin-adjustment', data: {
          id: 'portal-admin-adjustment',
          active: true,
          teacherId: 'teacher-1',
          month: '2026-07',
          date: '2026-07-31',
          type: 'teacher_bonus',
          amount: 100
        } }
      ]
    }))
  };
  const duplicatePermanentBackend = loadBackendForScheduleTests(duplicatePermanentState);
  check(() => {
    const teacher = { id: 'teacher-1', name: '王老師' };
    const reward = duplicatePermanentBackend.__testNormalizeAdminTeacherAdjustment({
      requestId: 'teacher_adjustment_reward_20260710',
      teacherId: 'teacher-1',
      date: '2026-07-10',
      type: 'reward',
      amount: 500,
      note: '協助成果發表'
    }, teacher);
    assert.strictEqual(reward.month, '2026-07', '補登獎勵沒有歸入所選歷史月份');
    assert.strictEqual(reward.amount, 500, '補登獎勵金額錯誤');
    assert.strictEqual(reward.type, 'reward', '補登獎勵類型錯誤');
    const deduction = duplicatePermanentBackend.__testNormalizeAdminTeacherAdjustment({
      requestId: 'teacher_adjustment_deduction_20260715',
      teacherId: 'teacher-1',
      date: '2026-07-15',
      type: 'deduction',
      amount: 50,
      note: '遲交教學紀錄'
    }, teacher);
    assert.strictEqual(deduction.type, 'deduction', '扣薪沒有保存為負向薪資異動類型');
    assert.throws(
      () => duplicatePermanentBackend.__testNormalizeAdminTeacherAdjustment({
        requestId: 'teacher_adjustment_invalid_amount',
        teacherId: 'teacher-1',
        date: '2026-07-15',
        type: 'deduction',
        amount: -50,
        note: '錯誤金額'
      }, teacher),
      /金額必須是/,
      '負數扣薪金額不應被後端接受'
    );
  });
  check(() => {
    assert.strictEqual(
      duplicatePermanentBackend.__testNormalizeTeacherShareRatio(0.6),
      0.6,
      '0.6 應正規化為 60%'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testNormalizeTeacherShareRatio(60),
      0.6,
      '60 應正規化為 60%'
    );
    assert.throws(
      () => duplicatePermanentBackend.__testNormalizeTeacherShareRatio(101),
      /不可超過 100/,
      '超過 100% 的老師分成必須拒絕，不能寫入異常薪資'
    );

    const ratioPeriod = {
      id: 'period-ratio',
      studentId: 'student-1',
      subjectId: 'subject-piano',
      teacherId: 'teacher-1',
      periodNo: 3,
      startDate: '2026-07-01',
      lessonCount: 4,
      usedCount: 2,
      expectedAmount: 2800,
      discount: 0,
      planSnapshot: {
        id: 'plan-ratio',
        name: '鋼琴四堂 60%',
        splitType: 'ratio',
        splitValue: 0.6
      }
    };
    const percentagePeriod = Object.assign({}, ratioPeriod, {
      id: 'period-percentage',
      planSnapshot: Object.assign({}, ratioPeriod.planSnapshot, { splitValue: 60 })
    });
    const ratioPay = duplicatePermanentBackend.__testAttendancePeriodPayroll('student-1', ratioPeriod);
    const percentagePay = duplicatePermanentBackend.__testAttendancePeriodPayroll('student-1', percentagePeriod);
    assert.strictEqual(ratioPay.outputs.lessonPrice, 700);
    assert.strictEqual(ratioPay.outputs.teacherAmount, 420);
    assert.strictEqual(percentagePay.outputs.teacherAmount, 420, '0.6 與 60 不可算出不同老師薪資');
    assert.strictEqual(percentagePay.outputs.splitValue, 0.6, '薪資快照必須保存正規化後的比例');

    const fixedPay = duplicatePermanentBackend.__testAttendancePeriodPayroll('student-1', Object.assign({}, ratioPeriod, {
      id: 'period-fixed',
      planSnapshot: {
        id: 'plan-fixed',
        name: '每堂固定 600',
        splitType: 'fixed',
        splitValue: 600
      }
    }));
    assert.strictEqual(fixedPay.outputs.teacherAmount, 600, '固定拆帳應直接計入每堂 NT$600');

    const event = {
      id: 'event-attended',
      fixedCourseId: 'fixed-1',
      date: '2026-07-31',
      teacherId: 'teacher-1',
      subjectId: 'subject-piano',
      studentIds: ['student-1']
    };
    const selected = duplicatePermanentBackend.__testAttendancePeriodCandidate(
      [Object.assign({}, ratioPeriod, { id: 'period-old', periodNo: 2, usedCount: 4 }), ratioPeriod],
      event,
      'student-1',
      event.date
    );
    assert.strictEqual(selected.id, 'period-ratio', '簽到必須配到同學生、同課程且仍有堂數的期別');
    const multiPaymentCandidate = duplicatePermanentBackend.__testAttendancePeriodCandidate([
      Object.assign({}, ratioPeriod, {
        id: 'period-multi-old', sourcePaymentId: 'payment-multi-old', periodNo: 2, startDate: '2026-05-01'
      }),
      Object.assign({}, ratioPeriod, {
        id: 'period-multi-new', sourcePaymentId: 'payment-multi-new', periodNo: 4, startDate: '2026-07-01'
      })
    ], Object.assign({}, event, {
      studentPaymentIds: ['payment-multi-old', 'payment-multi-new']
    }), 'student-1', event.date);
    assert.strictEqual(
      multiPaymentCandidate.id,
      'period-multi-new',
      '固定課帶多個歷史付款編號時，不能依陣列順序誤選舊期別'
    );
    const perStudentPeriodCandidate = duplicatePermanentBackend.__testAttendancePeriodCandidate([
      Object.assign({}, ratioPeriod, {
        id: 'period-student-exact', sourcePaymentId: 'payment-student-exact', periodNo: 2
      }),
      Object.assign({}, ratioPeriod, {
        id: 'period-general-new', sourcePaymentId: 'payment-general-new', periodNo: 4
      })
    ], Object.assign({}, event, {
      tuitionPeriodIds: { 'student-1': 'period-student-exact' },
      studentPaymentIds: ['payment-general-new']
    }), 'student-1', event.date);
    assert.strictEqual(
      perStudentPeriodCandidate.id,
      'period-student-exact',
      '逐生保存的精準期別 ID 必須優先於固定課的多期付款清單'
    );
    const attendedPayroll = duplicatePermanentBackend.__testAttendancePayrollCalculation(
      event,
      [{ studentId: 'student-1', period: ratioPeriod }],
      event.date
    );
    assert.strictEqual(attendedPayroll.tuitionAmount, 700);
    assert.strictEqual(attendedPayroll.teacherAmount, 420);
    assert.strictEqual(attendedPayroll.schoolShare, 280);
    assert.strictEqual(attendedPayroll.rate, '60%');
    assert.strictEqual(attendedPayroll.planSnapshot.name, '鋼琴四堂 60%');
    assert.strictEqual(attendedPayroll.payrollCalculation.inputs.eventId, 'event-attended');
    assert.strictEqual(attendedPayroll.payrollCalculation.students[0].periodId, 'period-ratio');
    assert.strictEqual(attendedPayroll.payrollCalculation.outputs.teacherAmount, 420);

    const freeGiftPayroll = duplicatePermanentBackend.__testAttendancePayrollCalculation({
      id: 'gift-free',
      date: '2026-07-31',
      teacherId: 'teacher-1',
      studentIds: ['student-1'],
      portalAction: 'teacher_gift',
      specialLesson: true,
      teacherPayable: false
    }, [], '2026-07-31');
    assert.strictEqual(freeGiftPayroll.teacherAmount, 0, '老師明確免費贈課應可完成簽到但不計薪');
    assert.strictEqual(freeGiftPayroll.payrollExcluded, true, '免費贈課必須留下明確排除薪資的稽核旗標');
    assert.throws(() => duplicatePermanentBackend.__testAttendancePayrollCalculation({
      id: 'special-missing-pay',
      date: '2026-07-31',
      teacherId: 'teacher-1',
      studentIds: ['student-1'],
      specialLesson: true,
      teacherPayable: true
    }, [], '2026-07-31'), /尚未設定老師薪資/, '一般特殊課未填薪資時不可悄悄寫成 0');
    const paidSpecialPayroll = duplicatePermanentBackend.__testAttendancePayrollCalculation({
      id: 'special-paid',
      date: '2026-07-31',
      teacherId: 'teacher-1',
      studentIds: ['student-1'],
      specialLesson: true,
      teacherPayable: true,
      specialTeacherPay: 500
    }, [], '2026-07-31');
    assert.strictEqual(paidSpecialPayroll.teacherAmount, 500, '一般特殊課明確設定 NT$500 時應正常計薪');

    const grossDiscountPay = duplicatePermanentBackend.__testAttendancePeriodPayroll('student-1', Object.assign({}, ratioPeriod, {
      id: 'period-gross-discount',
      discount: 0.5,
      discountType: 'ratio',
      payByDiscount: false,
      teacherPayBasis: 'gross'
    }));
    const netDiscountPay = duplicatePermanentBackend.__testAttendancePeriodPayroll('student-1', Object.assign({}, ratioPeriod, {
      id: 'period-net-discount',
      discount: 0.5,
      discountType: 'ratio',
      payByDiscount: true,
      teacherPayBasis: 'net'
    }));
    assert.strictEqual(grossDiscountPay.outputs.teacherAmount, 420, '不按折扣計薪時仍須用原價 700 × 60%');
    assert.strictEqual(netDiscountPay.outputs.teacherAmount, 210, '按五折計薪時須用 350 × 60%');
    assert.strictEqual(grossDiscountPay.outputs.collectedAmount, 350, '老師按原價計薪時，本堂實收仍只能是折扣後 NT$350');
    assert.strictEqual(grossDiscountPay.outputs.lessonPrice, 350, '對外課堂金額不可誤顯示折扣前原價');
    assert.strictEqual(grossDiscountPay.outputs.teacherPayLessonPrice, 700, '老師原價計薪基準需另存，不能冒充實收');
    assert.strictEqual(grossDiscountPay.outputs.schoolShare, -70, '實收低於老師薪資時必須顯示負分潤，不能造出正數假利潤');
    const grossDiscountCalculation = duplicatePermanentBackend.__testAttendancePayrollCalculation(
      event,
      [{ studentId: 'student-1', period: Object.assign({}, ratioPeriod, {
        id: 'period-gross-discount-calculation',
        discount: 0.5,
        discountType: 'ratio',
        payByDiscount: false,
        teacherPayBasis: 'gross'
      }) }],
      event.date
    );
    assert.strictEqual(grossDiscountCalculation.collectedAmount, 350);
    assert.strictEqual(grossDiscountCalculation.teacherAmount, 420);
    assert.strictEqual(grossDiscountCalculation.schoolShare, -70);
    assert.strictEqual(grossDiscountCalculation.payrollCalculation.outputs.collectedAmount, 350);
    const mixedGroupCalculation = duplicatePermanentBackend.__testAttendancePayrollCalculation(
      Object.assign({}, event, { studentIds: ['student-1', 'student-2'] }),
      [
        { studentId: 'student-1', period: Object.assign({}, ratioPeriod, {
          id: 'period-group-gross',
          discount: 0.5,
          discountType: 'ratio',
          payByDiscount: false,
          teacherPayBasis: 'gross'
        }) },
        { studentId: 'student-2', period: Object.assign({}, ratioPeriod, {
          id: 'period-group-fixed',
          studentId: 'student-2',
          planSnapshot: { id: 'plan-fixed-group', splitType: 'fixed', splitValue: 600 }
        }) }
      ],
      event.date
    );
    assert.strictEqual(mixedGroupCalculation.collectedAmount, 1050, '團體課實收須加總每位學生的折扣後金額');
    assert.strictEqual(mixedGroupCalculation.teacherAmount, 1020, '團體課老師薪資須加總各方案的計薪基準');
    assert.strictEqual(mixedGroupCalculation.schoolShare, 30, 'mixed/group 分潤須以總實收減總老師薪資');
    assert.strictEqual(mixedGroupCalculation.splitType, 'mixed');
    assert.throws(() => duplicatePermanentBackend.__testAttendancePeriodPayroll('student-1', Object.assign({}, ratioPeriod, {
      id: 'period-ambiguous-discount',
      discount: 0.5
    })), /沒有保存老師按原價或折扣後金額計薪/, '舊折扣缺少薪資基準時應停止而不是猜測');

    const explicitPaymentPeriod = duplicatePermanentBackend.__testAttendancePeriodCandidate([
      Object.assign({}, ratioPeriod, { id: 'period-payment-old', sourcePaymentId: 'payment-old', periodNo: 2 }),
      Object.assign({}, ratioPeriod, { id: 'period-payment-new', sourcePaymentId: 'payment-new', periodNo: 4 })
    ], Object.assign({}, event, { studentPaymentIds: ['payment-old'] }), 'student-1', event.date);
    assert.strictEqual(explicitPaymentPeriod.id, 'period-payment-old', '固定課已保存付款編號時必須優先使用明確期別');

    const periodOne = Object.assign({}, ratioPeriod, { id: 'period-one', periodNo: 1, usedCount: 2 });
    const periodTwo = Object.assign({}, ratioPeriod, { id: 'period-two', periodNo: 2, usedCount: 1 });
    const cancelledPortalAttendance = [{
      id: 'portal-attendance-1',
      studentId: 'student-1',
      teacherId: 'teacher-1',
      subjectId: 'subject-piano',
      eventId: 'event-1',
      courseId: 'fixed-1',
      periodId: 'period-one',
      date: '2026-07-31',
      status: 'cancelled',
      active: false,
      source: 'attendance-cancellation-approved'
    }];
    const noMirrorRestore = duplicatePermanentBackend.__testApplyPortalAttendanceToPeriods(
      [periodOne, periodTwo], [], cancelledPortalAttendance
    );
    assert.deepStrictEqual(noMirrorRestore.map((row) => row.usedCount), [2, 1], '鏡像尚未含 portal 簽到時不可多還一堂');
    const matchedMirrorAttendance = [{
      id: 'mirror-attendance-1',
      studentId: 'student-1',
      teacherId: 'teacher-1',
      eventId: 'different-source-event',
      sourceCourseId: 'fixed-1',
      periodId: 'period-one',
      date: '2026-07-31',
      status: 'attended'
    }];
    const restoredOriginalPeriod = duplicatePermanentBackend.__testApplyPortalAttendanceToPeriods(
      [periodOne, periodTwo], matchedMirrorAttendance, cancelledPortalAttendance
    );
    assert.deepStrictEqual(restoredOriginalPeriod.map((row) => row.usedCount), [1, 1], '取消簽到只能還回原第 1 期，不可移到最新期');
    const sameDayCancellation = cancelledPortalAttendance.map((row) => Object.assign({}, row, {
      source: 'teacher-same-day-attendance-cancellation'
    }));
    const restoredSameDayCancellation = duplicatePermanentBackend.__testApplyPortalAttendanceToPeriods(
      [periodOne, periodTwo], matchedMirrorAttendance, sameDayCancellation
    );
    assert.deepStrictEqual(restoredSameDayCancellation.map((row) => row.usedCount), [1, 1], '同日直接取消若鏡像已含簽到，也必須還回原期別');
    const unrelatedSameDayAttendance = matchedMirrorAttendance.map((row) => Object.assign({}, row, {
      sourceCourseId: 'different-fixed-course'
    }));
    const unrelatedNotRestored = duplicatePermanentBackend.__testApplyPortalAttendanceToPeriods(
      [periodOne, periodTwo], unrelatedSameDayAttendance, cancelledPortalAttendance
    );
    assert.deepStrictEqual(unrelatedNotRestored.map((row) => row.usedCount), [2, 1], '同學生同日另一堂課不可被誤認成取消目標');

    const canonicalPortalRow = (overrides) => Object.assign({
      id: 'portal-pay-1',
      eventId: 'portal-event-1',
      date: '2026-07-31',
      occurredAt: '2026-07-31T10:00:00+08:00',
      teacherId: 'teacher-1',
      studentId: 'student-1',
      studentIds: ['student-1'],
      teacherAmount: 420,
      status: 'attended',
      active: true,
      payrollCalculation: { version: 'attendance-period-payroll-v1' }
    }, overrides || {});
    const mirrorRow = (overrides) => Object.assign({
      id: 'mirror-pay-1',
      date: '2026-07-31',
      occurredAt: '2026-07-31T02:00:00.000Z',
      teacherId: 'teacher-1',
      studentId: 'student-1',
      teacherAmount: 420
    }, overrides || {});
    const utcMerged = duplicatePermanentBackend.__testMergeTeacherPayrollRows(
      [mirrorRow()], [canonicalPortalRow()]
    );
    assert.strictEqual(utcMerged.length, 1, 'UTC 與台北同一分鐘的同一堂薪資不可重複');
    assert.strictEqual(utcMerged[0].id, 'portal-pay-1', '有完整計算快照的 portal 薪資應成為正式來源');
    const twoLessons = duplicatePermanentBackend.__testMergeTeacherPayrollRows([
      mirrorRow({ id: 'mirror-10', occurredAt: '2026-07-31T02:00:00.000Z' }),
      mirrorRow({ id: 'mirror-11', occurredAt: '2026-07-31T03:00:00.000Z' })
    ], [
      canonicalPortalRow({ id: 'portal-10', occurredAt: '2026-07-31T10:00:00+08:00' }),
      canonicalPortalRow({ id: 'portal-11', eventId: 'portal-event-2', occurredAt: '2026-07-31T11:00:00+08:00' })
    ]);
    assert.strictEqual(twoLessons.length, 2, '同學生同日兩堂課必須保留兩筆，不可用 Set 吃掉一堂');
    const groupPortal = canonicalPortalRow({
      id: 'portal-group',
      studentId: 'student-1',
      studentIds: ['student-1', 'student-2'],
      teacherAmount: 840
    });
    const groupMerged = duplicatePermanentBackend.__testMergeTeacherPayrollRows([
      mirrorRow({ id: 'mirror-s1', studentId: 'student-1' }),
      mirrorRow({ id: 'mirror-s2', studentId: 'student-2' })
    ], [groupPortal]);
    assert.deepStrictEqual(groupMerged.map((row) => row.id), ['portal-group'], '群體課 portal 合計列應取代鏡像逐生列');
    const partialGroup = duplicatePermanentBackend.__testMergeTeacherPayrollRows([
      mirrorRow({ id: 'mirror-partial-s1', studentId: 'student-1' })
    ], [groupPortal]);
    assert.deepStrictEqual(partialGroup.map((row) => row.id), ['portal-group'], '群體課只有部分鏡像時仍保留完整 portal，已覆蓋的鏡像列需移除');
    const multisetRows = duplicatePermanentBackend.__testMergeTeacherPayrollRows([
      mirrorRow({ id: 'mirror-extra-1' }),
      mirrorRow({ id: 'mirror-extra-2' }),
      mirrorRow({ id: 'mirror-extra-3' })
    ], [canonicalPortalRow()]);
    assert.strictEqual(multisetRows.length, 3, '一筆 portal 只能消除一筆鏡像，額外重複列需保留供稽核');
    assert.strictEqual(multisetRows.filter((row) => String(row.id).startsWith('mirror-extra')).length, 2);
    const legacyZeroPortalIgnored = duplicatePermanentBackend.__testMergeTeacherPayrollRows(
      [mirrorRow()],
      [Object.assign({}, canonicalPortalRow(), { payrollCalculation: {}, teacherAmount: 0 })]
    );
    assert.deepStrictEqual(legacyZeroPortalIgnored.map((row) => row.id), ['mirror-pay-1'], '舊的 portal NT$0 暫存列不可蓋掉正確鏡像');
    const legacyPositivePortal = Object.assign({}, canonicalPortalRow(), {
      id: 'legacy-portal-positive',
      payrollCalculation: {},
      teacherAmount: 420
    });
    const legacyPositiveWithoutMirror = duplicatePermanentBackend.__testMergeTeacherPayrollRows(
      [],
      [legacyPositivePortal]
    );
    assert.deepStrictEqual(
      legacyPositiveWithoutMirror.map((row) => row.id),
      ['legacy-portal-positive'],
      '已部署但尚無新版計算快照的有效 portal 正薪資不可從畫面消失'
    );
    const legacyPositiveWithMirror = duplicatePermanentBackend.__testMergeTeacherPayrollRows(
      [mirrorRow()],
      [legacyPositivePortal]
    );
    assert.deepStrictEqual(
      legacyPositiveWithMirror.map((row) => row.id),
      ['legacy-portal-positive'],
      '舊版 portal 正薪資與可強識別的鏡像列必須只保留一筆'
    );
    const freeGiftAuditRow = Object.assign({}, canonicalPortalRow(), {
      id: 'portal-free-gift-audit',
      teacherAmount: 0,
      teacherPayable: false,
      payrollExcluded: true,
      payrollExclusionReason: 'teacher_gift_no_pay'
    });
    assert.deepStrictEqual(
      duplicatePermanentBackend.__testMergeTeacherPayrollRows([], [freeGiftAuditRow])
        .map((row) => row.id),
      ['portal-free-gift-audit'],
      '新版免費贈課雖為 NT$0，仍須保留計算快照與不計薪稽核列'
    );

    const cancellationRequest = {
      operationId: 'portal-operation-1',
      eventId: 'source-event-1',
      courseId: 'fixed-1',
      teacherId: 'teacher-1',
      studentIds: ['student-1'],
      date: '2026-07-31',
      startTime: '10:00'
    };
    const cancellationPayroll = mirrorRow({
      operationId: 'mirror-operation-1',
      eventId: 'different-mirror-event',
      courseId: 'fixed-1',
      occurredAt: '2026-07-31T10:00:00+08:00'
    });
    assert.strictEqual(
      duplicatePermanentBackend.__testTeacherPayrollMatchesCancellation(cancellationPayroll, cancellationRequest),
      true,
      '取消薪資須能用同老師、學生、日期、時間與課程強識別同一堂'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testTeacherPayrollMatchesCancellation(
        Object.assign({}, cancellationPayroll, { teacherId: 'teacher-2' }),
        cancellationRequest
      ),
      false,
      '取消簽到不可刪除同課程但不同老師的薪資'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testTeacherPayrollMatchesCancellation(
        Object.assign({}, cancellationPayroll, { studentId: 'student-2' }),
        cancellationRequest
      ),
      false,
      '取消簽到不可刪除同課程但不同學生的薪資'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testTeacherPayrollMatchesCancellation(
        Object.assign({}, cancellationPayroll, { occurredAt: '2026-07-31T11:00:00+08:00' }),
        cancellationRequest
      ),
      false,
      '同一固定課同一天的第二堂課不可被第一堂的取消申請刪除'
    );
    const cancellationMerged = duplicatePermanentBackend.__testMergeTeacherPayrollRows([
      cancellationPayroll,
      Object.assign({}, cancellationPayroll, {
        id: 'mirror-second-lesson',
        operationId: 'mirror-operation-2',
        occurredAt: '2026-07-31T11:00:00+08:00'
      })
    ], [], [Object.assign({ status: 'approved' }, cancellationRequest)]);
    assert.deepStrictEqual(
      cancellationMerged.map((row) => row.id),
      ['mirror-second-lesson'],
      '核准取消只能移除被核對的第一堂薪資，同日同課程第二堂必須保留'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testAttendanceLessonLockId('2026-07-31', {
        fixedCourseId: 'fixed-1', teacherId: 'teacher-1'
      }),
      duplicatePermanentBackend.__testAttendanceLessonLockId('2026-07-31', {
        fixedCourseId: 'fixed-1', teacherId: 'teacher-2'
      }),
      '簽到取消 tombstone 必須跨老師共用，改派老師不可繞過鎖'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testTeacherEventMatchesRequest({
        id: 'same-day-first',
        date: '2026-07-31',
        teacherId: 'teacher-1',
        fixedCourseId: 'fixed-1'
      }, 'teacher-1', '2026-07-31', '', '', ''),
      false,
      '空 sourceEventId／sourceCourseId／portalChangeId 不可誤選同日第一堂'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testTeacherEventMatchesRequest({
        id: 'same-day-first',
        sourceId: 'same-day-first',
        date: '2026-07-31',
        teacherId: 'teacher-1',
        fixedCourseId: 'fixed-1'
      }, 'teacher-1', '2026-07-31', 'same-day-second', 'fixed-1', ''),
      false,
      '指定事件編號不符時不可退回只看 courseId，否則會誤選同日第一堂'
    );
    assert.strictEqual(
      duplicatePermanentBackend.__testTeacherEventMatchesRequest({
        id: 'same-day-second',
        sourceId: 'same-day-second',
        date: '2026-07-31',
        teacherId: 'teacher-1',
        fixedCourseId: 'fixed-1',
        portalChangeId: 'portal-change-2'
      }, 'teacher-1', '2026-07-31', 'same-day-second', 'fixed-1', 'portal-change-2'),
      true,
      '事件、課程與 portal 變更編號都一致時才可選中指定課堂'
    );
  });
  check(() => {
    assert.strictEqual(
      duplicatePermanentBackend.__testAssertTeacherMoveDuration(
        60,
        { startTime: '15:00', endTime: '16:00' }
      ),
      60,
      '一小時原課程應可排入完整一小時的新時段'
    );
    assert.throws(
      () => duplicatePermanentBackend.__testAssertTeacherMoveDuration(
        30,
        { startTime: '15:00', endTime: '16:00' }
      ),
      /原課程是 60 分鐘/,
      '一小時原課程仍可被縮成半小時並卡住相鄰課程'
    );
  });
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
    assert.strictEqual(nextTuitionCandidates[0].currentSystemPeriodNo, 1, '目前期別沒有重編為新系統期數');
    assert.strictEqual(nextTuitionCandidates[0].nextSystemPeriodNo, 2, '下一期仍沿用舊系統原始期數');
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
    events: [],
    teacherPayroll: [{
      id: 'mirror-admin-payroll',
      date: '2026-07-31',
      occurredAt: '2026-07-31T10:00:00+08:00',
      teacherId: 'teacher-1',
      studentId: 'student-1',
      courseId: 'fixed-1',
      teacherAmount: 420
    }],
    teacherAdjustments: []
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
    assert.deepStrictEqual(
      appended.teacherPayroll.map((row) => row.id),
      ['portal-admin-payroll'],
      '管理端必須合併 portal 正式薪資並移除可強識別的鏡像重複列'
    );
    assert.deepStrictEqual(
      appended.teacherAdjustments.map((row) => row.id),
      ['portal-admin-adjustment'],
      '管理端必須顯示 portal 老師獎勵／扣款'
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
assert(
  deployWorkflow.includes('functions:coursePortalAdminSaveTeacherAdjustment'),
  'Firebase 部署清單漏掉老師獎勵／扣薪功能'
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
  'coursePortalAdminSaveTeacherAdjustment',
  'coursePortalAdminRoomBookings',
  'coursePortalTeacherAction',
  'coursePortalTeacherLessonState',
  'coursePortalTeacherAttendance',
  'coursePortalTeacherLateAttendance',
  'coursePortalTeacherAttendanceCancellationRequest',
  'coursePortalTeacherUtilitySession',
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
  'functions:coursePortalTeacherUtilitySession',
  'functions:coursePortalTeacherUpdateStudent',
  'functions:coursePortalTeacherStopStudent',
  'functions:coursePortalAdminSaveTeacherAdjustment',
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
assert(backend.includes("source.purpose === 'line-registration'"), 'LINE 首次註冊驗證後未建立工作階段');
assert(backend.includes('completeVerifiedLineRegistration(source)'), 'LINE 首次註冊沒有鎖定在四碼驗證成功後執行');
assert(backend.includes('authAccountId'), '一般登入缺少獨立帳號識別');
assert(backend.includes('const authAccountId = lineAccountId(type, lineUserId)'), 'LINE 首次登入仍未以 LINE 身分建立帳號鍵');
assert(backend.includes('authAccountId: source.authAccountId'), 'LINE 一次性登入碼交換時遺失帳號鍵');
assert(!backend.includes('sharedBindingAuthAccountId'), 'LINE 登入仍會從 Email 綁定推算帳號鍵');
assert(backend.includes('所有新註冊都必須填寫 Email 並完成四碼驗證'), '學生／家長或租用者仍可繞過 Email 四碼直接登入');
assert(backend.includes('第一次使用 LINE 註冊時，必須先填寫 Email 並完成四碼驗證'), '舊 LINE 完成端點仍可繞過 Email 四碼');
assert(backend.includes('async function teacherUtilitySession(data)'), '老師其他六頁缺少安全的工作階段轉接');
assert(backend.includes('authAccountId: lineAccountId(type, profile.lineUserId)'), '既有老師或租用者 LINE 登入仍使用 Email 帳號鍵');
assert(backend.includes("lineAccountId(type, lineUserId)"), '不同家長的 LINE 帳號鍵沒有獨立，提醒設定可能互相連動');
assert(backend.includes("authMethod: 'email-otp'"), '一般登入未建立 Email 驗證工作階段');
assert(backend.includes("authMethod: 'line-oauth+email-otp-registration'"), 'LINE 首次註冊工作階段未記錄 Email 四碼驗證');
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
assert(backend.includes("schedule: '0 9 * * *'"), '老師每日課程 LINE 提醒不是台北時間上午 9 點');
assert(backend.includes('此課程昨日未完成簽到，因此尚未記錄堂數'), '老師昨日未完成紀錄缺少確認後文字');
const teacherDailyReminderSource = backend.slice(
  backend.indexOf('async function dailyTeacherCourseReminders('),
  backend.indexOf('async function dailyStudentReminders(')
);
assert(!teacherDailyReminderSource.includes('ATTENDANCE_ADMIN_FEE'), '昨日未完成 LINE 提醒不應提前顯示補簽行政費');
assert(backend.includes('taipeiDateTimeMillis(row.date, row.startTime) > Date.now()'), '租用開始後仍可自行取消');
assert(backend.includes('const PORTAL_MAX_ADVANCE_MONTHS = 2'), '老師新增／調課與租用未限制兩個月內');
assert(backend.includes("const TUITION_SYSTEM_PERIODS = 'coursePortalTuitionSystemPeriods'"), '新系統期數沒有持久保存');
assert(backend.includes("source: 'attendance-cancellation-approved'"), '隔日取消簽到核准後沒有保留堂數補回稽核');
assert(backend.includes('course-portal-booking-${id}-reminder'), '租用缺少開始前一小時提醒');
assert(backend.includes("action === 'delete'"), '後台綁定管理缺少刪除登入資料');
assert(backend.includes("approvalStatus: approved ? 'approved' : 'pending'"), '一般登入的新綁定未進入主管核准流程');
const lineRegistrationSource = backend.slice(
  backend.indexOf('async function completeVerifiedLineRegistration('),
  backend.indexOf('async function activeStudentIdsForLine(')
);
assert(lineRegistrationSource.includes("status: 'active'"), 'LINE 四碼驗證完成後仍需要主管逐筆核准');
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
assert(backend.includes("db.collection(ATTENDANCE_PAYROLL).get()"), '管理端鏡像沒有讀取新系統老師薪資');
assert(backend.includes('payload.teacherPayroll = mergeTeacherPayrollRows'), '管理端沒有把新舊老師薪資安全去重合併');
assert(backend.includes('payload.attendance = mergePortalAttendanceRows'), '管理端沒有合併新系統正式簽到');
assert(backend.includes("db.collection('coursePortalAttendanceLessonLocks')"), '正式簽到缺少不含老師編號的課堂唯一鎖');
assert(backend.includes("if (clean(existingLessonLock.status) === 'cancelled')"), '已取消簽到的 tombstone 沒有阻擋改派老師重簽');
assert(
  (backend.match(/active: true,\n\s+status: 'cancelled',\n\s+operationId/g) || []).length >= 2,
  '同日取消與主管核准取消都必須保留 active cancellation tombstone'
);
const cancellationAdminSource = backend.slice(
  backend.indexOf('async function adminAttendanceCancellationAction('),
  backend.indexOf('async function adminData()')
);
const cancellationRejectSource = cancellationAdminSource.slice(
  cancellationAdminSource.indexOf("if (action === 'reject')"),
  cancellationAdminSource.indexOf('const lineage =')
);
assert(cancellationRejectSource.includes('db.runTransaction'), '取消簽到 reject 未使用交易，可能覆寫已 approve 狀態');
assert(cancellationRejectSource.includes('tx.get(requestRef)') && cancellationRejectSource.includes("clean(current.status) !== 'pending'"), '取消簽到 reject 沒有在交易內重新確認 pending');
assert(backend.includes("paymentStatus: state === 'absent' ? 'student_absent_no_pay'"), '曠課仍被錯誤標記為老師可計薪');
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
