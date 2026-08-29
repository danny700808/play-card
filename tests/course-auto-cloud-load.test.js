'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const controller = read('operations-course-inline.js');
const runtime = read('operations-course-inline-runtime.js');
const template = read('operations-course-inline-template.html');
const schedulerData = read('course-scheduler-data.js');
const scheduler = read('course-scheduler.js');
const schedulerHtml = read('course-scheduler.html');
const operations = read('operations-phase1.js');
const autoRead = read('functions/injiaoyunEducationAutoRead.js');
const coursePortal = read('functions/coursePortal.js');
const mirror = read('functions/injiaoyunEducationMirror.js');
const courseIndex = read('functions/courseIndex.js');
const courseLoginIndex = read('functions/courseLoginIndexV3.js');
const portalUtils = read('functions/coursePortalUtils.js');
const publicAccessScript = read('.github/scripts/course-mirror-public.cjs');
const reportScript = read('.github/scripts/course-mirror-report.cjs');
const packageJson = JSON.parse(read('functions/package.json'));
const workflow = read('.github/workflows/firebase-functions-deploy.yml');
const hub = read('operations-hub.html');
const portal = read('portal.html');
const center = read('course-center.html');

[
  ['operations-course-inline.js', controller],
  ['operations-course-inline-runtime.js', runtime],
  ['course-scheduler-data.js', schedulerData],
  ['course-scheduler.js', scheduler],
  ['operations-phase1.js', operations],
  ['functions/injiaoyunEducationAutoRead.js', autoRead],
  ['functions/injiaoyunEducationMirror.js', mirror],
  ['functions/courseIndex.js', courseIndex],
  ['functions/courseLoginIndexV3.js', courseLoginIndex],
  ['functions/coursePortalUtils.js', portalUtils],
  ['.github/scripts/course-mirror-public.cjs', publicAccessScript],
  ['.github/scripts/course-mirror-report.cjs', reportScript]
].forEach(([filename, source]) => new vm.Script(source, { filename }));

const htmlIds = new Set(
  Array.from(template.matchAll(/\bid=["']([^"']+)["']/g), (match) => match[1])
);
const bindEventsSource = (
  runtime.match(/function bindEvents\(\)\{([\s\S]*?)\n\s*function init\(\)/) || []
)[1] || '';
const requiredRuntimeIds = new Set(
  Array.from(bindEventsSource.matchAll(/(?<!\$)\$\(['"]([^'"]+)['"]\)/g), (match) => match[1])
);
const guardedOptionalIds = new Set();
if (/var conflictButton=\$\('conflictBtn'\);if\(conflictButton\)/.test(bindEventsSource)) {
  guardedOptionalIds.add('conflictBtn');
}
const missingRuntimeIds = Array.from(requiredRuntimeIds).filter((id) =>
  !htmlIds.has(id) && !guardedOptionalIds.has(id)
);
assert.deepStrictEqual(
  missingRuntimeIds,
  [],
  `inline 課表 HTML 缺少初始化需要的元素：${missingRuntimeIds.join('、')}`
);

assert(controller.includes("WORKSPACE_KEY = 'workspace'"), '統一課務控制器未優先讀取工作區');
assert(controller.includes("LATEST_KEY = 'latest'"), '統一課務控制器未保留正式快照');
assert(controller.includes('async function resolveWorkspace()'), '統一課務控制器缺少本機資料解析');
assert(controller.includes('readDatabase().catch'), 'IndexedDB 失敗時沒有安全備援');
assert(controller.includes('if (hasRealContent(saved.workspace))'), '已有工作區時仍可能被舊資料覆蓋');
assert(controller.includes('if (hasRealContent(saved.latest))'), '工作區不存在時沒有正式快照備援');
assert(controller.includes('global.__YOUZI_COURSE_INLINE_BOOTSTRAP_STATE__'), '本機課表沒有傳入完整 runtime');
assert(!controller.includes('YouziCoursePreviewData.load'), '正常開頁仍會大量讀取音教雲鏡像');
assert(!controller.includes('YouziCoursePreviewData.sync'), '正常開頁仍會自動同步音教雲');

assert(runtime.includes('window.__YOUZI_COURSE_INLINE_BOOTSTRAP_STATE__'), 'inline runtime 沒有使用控制器準備的工作區');
assert(runtime.includes('refreshPortalRentals();'), 'inline runtime 沒有更新入口租用異動');
assert(!runtime.includes('restoreFormalDatabase().then(refreshPortalRentals)'), '開頁仍重複還原正式資料');
assert(runtime.includes('function syncInjiaoyun()'), '完整課表缺少使用者主動同步功能');
assert(runtime.includes('function eventStudentNames(event)'), 'inline 課表未提供舊姓名顯示備援');
assert(runtime.includes("eventStudentNames(event).join('、')"), 'inline 課程卡片未使用舊姓名顯示備援');
assert(runtime.includes('YouziCoursePreviewData.sync'), '主動同步沒有呼叫音教雲同步元件');
assert(runtime.includes('function refreshTeacherPayrollMonth(monthKey)'), '老師薪資沒有依月份自動更新');
assert(runtime.includes('YouziCoursePreviewData.loadTeacherPayrollMonth'), '老師薪資沒有使用月份專用雲端讀取');
assert(runtime.includes('teacherPayrollSyncState'), '老師薪資沒有顯示雲端同步狀態');
assert(runtime.includes("$('teacherPayrollRefreshBtn').addEventListener('click'"), '老師薪資缺少手動重試按鈕');
assert(template.includes('id="teacherPayrollSyncPanel"'), '老師薪資缺少手機與電腦共用的同步狀態區');
assert(schedulerData.includes('async function loadTeacherPayrollMonth(options)'), '課務資料元件缺少薪資月份讀取');
assert(schedulerData.includes("scope:'teacher-payroll-month'"), '薪資月份仍會要求整包課務資料');
assert(schedulerData.includes('await ensureTeacherPayrollManagerAuth();'), '月份薪資沒有先等待管理者 Firebase 登入恢復');
assert(schedulerData.indexOf('await ensureTeacherPayrollManagerAuth();') < schedulerData.indexOf("payload=await call(AUTO_LOAD_FUNCTION_NAME"), '月份薪資在管理者登入恢復前就讀取雲端');
assert(schedulerData.includes('if(usesManagerAuth||!pin)throw error;'), '管理頁薪資更新失敗時仍可能靜默退回舊整包資料');

const dataWindow = {};
new vm.Script(schedulerData, { filename: 'course-scheduler-data.js' }).runInNewContext({
  window: dataWindow,
  console,
  Date,
  Intl,
  Map,
  Set,
  Promise
});
const legacyNameState = dataWindow.YouziCoursePreviewData.buildState({
  rooms: [{ id: 'room-1', name: '吉他教室' }],
  subjects: [{ id: 'subject-1', name: '木吉他' }],
  teachers: [{ id: 'teacher-1', name: '王虹婕' }],
  events: [{
    id: 'audit_adjusted-course_test_2026-08-29',
    date: '2026-08-29',
    start: '16:00',
    duration: 60,
    roomId: 'room-1',
    subjectId: 'subject-1',
    teacherId: 'teacher-1',
    studentIds: [],
    studentNames: ['黃郁喬'],
    type: 'single',
    status: 'attended'
  }],
  dataQuality: { auditCoveredDates: ['2026-08-29'] }
}, '2026-08-29');
assert.strictEqual(
  JSON.stringify(legacyNameState.events[0].studentNames),
  JSON.stringify(['黃郁喬']),
  '新版資料轉換不得丟失尚未綁定學生檔的舊姓名'
);

assert(scheduler.includes('function bindEvents()'), '互動課表缺少事件綁定');
assert(scheduler.includes("$('scheduleGrid').addEventListener('click'"), '課表格線無法點擊新增或查看課程');
assert(scheduler.includes('eventDetails(row)'), '課程卡片無法開啟明細');
assert(scheduler.includes('openSchedule({date:state.currentDate'), '互動課表缺少新增／調課入口');
assert(scheduler.includes('setAttendance'), '互動課表缺少簽到、請假與曠課處理');
assert(scheduler.includes('storeSynchronizedDatabases'), '主動同步完成後沒有安全更新 latest 與 workspace');
assert(scheduler.includes('preserveWorkspaceConfiguration'), '音教雲更新時沒有保留新版教室設定');

assert(autoRead.includes('loadInjiaoyunEducationMirrorAuto'), '後端缺少唯讀課務資料函式');
assert(autoRead.includes('assertAllowedRead'), '後端唯讀函式沒有來源限制');
assert(autoRead.includes("where('sourceActive', '==', true)"), '後端未優先讀取有效鏡像資料');
assert(autoRead.includes("invoker: 'public'"), '唯讀課表函式沒有宣告網站可公開呼叫');
assert(!autoRead.includes('MANUAL_SYNC_PIN'), '一般唯讀資料不應要求手動同步密碼');
assert(!autoRead.includes('syncInjiaoyunEducationMirrorNow'), '唯讀函式不得觸發音教雲同步');
assert(autoRead.includes("=== 'teacher-payroll-month'"), '唯讀函式沒有薪資月份的輕量路徑');
assert(autoRead.includes("const ADMIN_EMAILS = new Set(['danny700808@gmail.com'])"), '薪資月份後端沒有沿用正式管理者帳號');
assert(autoRead.includes('token.admin === true'), '薪資月份後端沒有接受管理者權限');
assert(autoRead.includes('token.owner === true'), '薪資月份後端沒有接受擁有者權限');
assert(coursePortal.includes('async function teacherPayrollMonthData(monthValue)'), '後端缺少月份薪資合併');
assert(coursePortal.includes("mirrorRowsByDateRange('teacherPayroll'"), '月份薪資沒有依日期讀取舊系統鏡像');
assert(coursePortal.includes('mergeTeacherPayrollRows('), '月份薪資沒有合併新版入口簽到資料');

assert(mirror.includes('COURSE_PORTAL_SCHEDULE_VERSION_REF'), '音教雲鏡像沒有連動入口衝突版本');
assert(mirror.includes('async function markCoursePortalScheduleUpdated'), '音教雲鏡像缺少版本更新函式');
assert(
  (mirror.match(/markCoursePortalScheduleUpdated\(\s*trigger,\s*'success',\s*reservation\.syncOwner/g) || []).length >= 2,
  '完整同步與近期差異同步沒有以各自 owner 更新入口衝突版本'
);
assert(
  mirror.includes('!activeSyncOwnerMatches(') && mirror.includes('finalizedScope'),
  '入口解鎖未同時驗證 running、scope、兩份 owner 與 pending source'
);

assert.strictEqual(packageJson.main, 'courseLoginIndexV3.js', 'Firebase Functions 未使用包含 LINE V3 的正式入口');
assert(courseLoginIndex.includes("require('./courseIndex')"), 'LINE V3 入口未鏈入完整課務 Functions');
assert(courseIndex.includes("require('./index')"), '課務入口未保留既有 Functions');
assert(courseIndex.includes('registerInjiaoyunEducationAutoRead(exports)'), '課務入口未註冊唯讀課表函式');
assert(!portalUtils.includes('registerInjiaoyunEducationAutoRead'), '工具模組仍在循環載入期間註冊 Firebase Function');
assert(publicAccessScript.includes('cloudfunctions.googleapis.com/v2/'), 'IAM 腳本未取得實際 Cloud Run 服務');
assert(publicAccessScript.includes(':setIamPolicy'), 'IAM 腳本未設定 Cloud Run 呼叫權限');
assert(publicAccessScript.includes('roles/run.invoker'), 'IAM 腳本未授權 Cloud Run Invoker');
assert(publicAccessScript.includes('allUsers'), 'IAM 腳本未允許網站匿名呼叫唯讀課表');
assert(publicAccessScript.includes('if (!changed)'), 'IAM 腳本仍會在公開權限已存在時重複寫入');
assert(publicAccessScript.includes('retryableQuotaError'), 'IAM 腳本遇到 Cloud Run 寫入額度時不會安全重試');
assert(publicAccessScript.includes('IAM_RETRY_DELAYS_MS'), 'IAM 腳本缺少有限次退避重試');
assert(reportScript.includes('DEPLOY_OUTCOME'), '部署回報未包含 Firebase 結果');
assert(workflow.includes('firebase deploy'), '工作流程沒有真正部署 Firebase Function');
assert(workflow.includes('node .github/scripts/course-mirror-public.cjs'), '工作流程未執行 Cloud Run 權限腳本');
assert(workflow.includes('node .github/scripts/course-mirror-report.cjs'), '工作流程未產生最終狀態回報');
assert(workflow.includes('course-mirror-diagnostics'), '驗證失敗時未保留診斷紀錄');
assert(workflow.includes('Fail workflow when deployment, access, or health check failed'), '部署失敗時 workflow 仍可能成功');

[hub, portal].forEach((html) => {
  const converterIndex = html.indexOf('course-scheduler-data.js');
  const controllerIndex = html.indexOf('operations-course-inline.js');
  const operationsIndex = html.indexOf('operations-phase1.js');
  assert(converterIndex >= 0, '營運入口未載入課務資料轉換器');
  assert(controllerIndex > converterIndex, 'inline 控制器必須在資料轉換器之後載入');
  assert(operationsIndex > controllerIndex, '營運中心必須在 inline 控制器之後初始化');
  assert(!html.includes('course-data-auto-bootstrap-v1.js'), '營運入口仍載入舊自動雲端 bootstrap');
  assert(!html.includes('operations-course-authoritative-v1.js'), '營運入口仍載入舊課務轉址層');
  assert(!html.includes('operations-mobile-course-fix-v1.js'), '營運入口仍載入舊手機補丁');
  assert(!html.includes('operations-mobile-course-dense-v1.css'), '營運入口仍載入舊手機樣式');
  assert(/operations-course-inline\.js\?v=[^"']+/.test(html), '營運入口未載入統一 inline 課務');
});

assert(operations.includes('YouziOperationsCourseInline.mount(content,courseView)'), '營運中心沒有掛載 inline 課務');
assert(!operations.includes('<iframe id="opsCourseFrame"'), '營運中心仍使用舊 iframe');
assert(center.includes("location.replace('portal.html#'+(map[view]||'course-calendar'))"), '舊課務網址沒有返回統一營運中心');

[
  'course-scheduler-full-bootstrap.js',
  'course-scheduler-standalone.css',
  'operations-mobile-course-fix-v1.js',
  'operations-mobile-course-dense-v1.css'
].forEach((file) => assert(!fs.existsSync(path.join(root, file)), `已淘汰的重複課務層仍存在：${file}`));

console.log('inline course startup and mirror boundary tests passed');
