'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const hub = read('operations-hub.html');
const portal = read('portal.html');
const controller = read('operations-course-inline.js');
const runtime = read('operations-course-inline-runtime.js');
const template = read('operations-course-inline-template.html');
const scheduler = read('course-scheduler.js');
const operations = read('operations-phase1.js');
const portalCommon = read('course-portal-common.js');

[
  ['operations-course-inline.js', controller],
  ['operations-course-inline-runtime.js', runtime],
  ['course-scheduler.js', scheduler],
  ['operations-phase1.js', operations],
  ['course-portal-common.js', portalCommon]
].forEach(([filename, source]) => new vm.Script(source, { filename }));

[hub, portal].forEach((html) => {
  [
    ['#course-calendar', 'course-calendar'],
    ['#course-students', 'course-students'],
    ['#course-teachers', 'course-teachers'],
    ['#course-settings', 'course-settings']
  ].forEach(([href, view]) => {
    assert(
      html.includes(`href="${href}" data-view="${view}"`),
      `營運入口缺少同頁課務導覽：${view}`
    );
  });
  assert(
    html.includes('operations-course-inline.js?v=20260801-teacher-adjustments-v1'),
    '營運入口未載入統一 inline 課務控制器'
  );
  assert(!html.includes('operations-course-authoritative-v1.js'), '營運入口仍載入舊課務轉址層');
  assert(!html.includes('operations-mobile-course-fix-v1.js'), '營運入口仍載入舊手機課務補丁');
  assert(!html.includes('operations-mobile-course-dense-v1.css'), '營運入口仍載入舊手機課務樣式');
  assert(!html.includes('course-data-auto-bootstrap-v1.js'), '營運入口仍在開頁時自動重讀舊鏡像');
});

assert(controller.includes("attachShadow({ mode: 'open' })"), '統一課務沒有 Shadow DOM 隔離');
assert(controller.includes("WORKSPACE_KEY = 'workspace'"), '課務控制器未保存可操作工作區');
assert(controller.includes("LATEST_KEY = 'latest'"), '課務控制器未保留正式快照');
assert(controller.includes('async function readDatabase()'), '課務控制器沒有讀取 IndexedDB');
assert(controller.includes('async function writeDatabase(latest, workspace)'), '課務控制器沒有寫入 IndexedDB');
assert(controller.includes('if (hasRealContent(saved.workspace)) return makeWorkspace(saved.workspace)'), '開頁沒有優先沿用工作區');
assert(controller.includes('if (hasRealContent(saved.latest))'), '工作區不存在時沒有正式快照備援');
assert(controller.includes('var legacy = readLegacyState()'), '舊版瀏覽器資料沒有一次性相容備援');
assert(controller.includes('isDemo(source)'), '課務控制器沒有排除示範資料');
assert(controller.includes('global.__YOUZI_COURSE_INLINE_BOOTSTRAP_STATE__ = workspace ? clone(workspace) : null'), '工作區沒有交給 inline runtime');
assert(!controller.includes('YouziCoursePreviewData.load'), '正常開頁仍會自動重新讀取雲端鏡像');
assert(!controller.includes('YouziCoursePreviewData.sync'), '正常開頁仍會自動執行音教雲同步');

assert(operations.includes('YouziOperationsCourseInline.mount(content,courseView)'), '營運中心未在原頁掛載完整課務');
assert(!operations.includes('<iframe id="opsCourseFrame"'), '營運中心仍使用舊 iframe 課務');
assert(!operations.includes('frame.contentWindow.postMessage'), '營運中心仍保留舊 iframe 訊息傳遞');
assert(runtime.includes('window.__YOUZI_COURSE_INLINE_DOCUMENT__'), '完整課表沒有使用隔離文件介面');
assert(runtime.includes('window.__YOUZI_COURSE_INLINE_BOOTSTRAP_STATE__'), '完整課表沒有從控制器接收工作區');
assert(runtime.includes('refreshPortalRentals();'), '開啟課表後沒有更新入口成立或取消的租用');
assert(!runtime.includes('restoreFormalDatabase().then(refreshPortalRentals)'), '開頁仍會重複還原資料後再讀租用');

assert(scheduler.includes("WORKSPACE_DB_KEY='workspace'"), '互動課表未使用 workspace 資料庫');
assert(scheduler.includes("FORMAL_DB_KEY='latest'"), '互動課表未使用 latest 正式快照');
assert(scheduler.includes('scheduleWorkspaceSave'), '課表操作後沒有排程自動保存');
assert(scheduler.includes('storeWorkspaceDatabase(state)'), '課表操作沒有寫回工作資料庫');
assert(scheduler.includes('storeSynchronizedDatabases'), '手動同步後沒有更新正式與工作資料');
assert(scheduler.includes('preserveWorkspaceConfiguration'), '音教雲更新時沒有保留本機教室設定');
assert(scheduler.includes("$('scheduleGrid').addEventListener('click'"), '完整課表格線無法操作');
assert(scheduler.includes('eventDetails(row)'), '完整課表課程卡無法開啟明細');
assert(scheduler.includes('setAttendance'), '完整課表缺少簽到、請假與曠課操作');

[
  'calendarPage',
  'studentsPage',
  'teachersPage',
  'settingsPage',
  'scheduleModal',
  'eventModal',
  'studentModal',
  'tuitionModal',
  'transactionModal',
  'teacherPayrollModal',
  'teacherAdjustmentModal',
  'policyModal'
].forEach((id) => assert(template.includes(`id="${id}"`), `inline 課務缺少完整功能：${id}`));
['rooms', 'subjects', 'fees'].forEach((tab) => {
  assert(template.includes(`data-settings-tab="${tab}"`), `inline 課務缺少設定分頁：${tab}`);
});

assert(portalCommon.includes('beginSessionResolution'), '入口登入完成後缺少工作階段解析遮罩');
assert(portalCommon.includes('登入連結驗證完成後會直接進入'), '登入期間未避免重複輸入資料');
assert(!portalCommon.includes('teacher-quick-grid'), '共用登入程式仍插入重複的老師上方快捷鍵');
assert(!portalCommon.includes('installTeacherApprovedLayout'), '共用登入程式仍覆寫老師入口版面');

console.log('inline course workspace persistence tests passed');
