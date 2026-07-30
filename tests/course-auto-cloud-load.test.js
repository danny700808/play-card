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
const mirror = read('functions/injiaoyunEducationMirror.js');
const courseIndex = read('functions/courseIndex.js');
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
const missingRuntimeIds = Array.from(requiredRuntimeIds).filter((id) => !htmlIds.has(id));
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
assert(runtime.includes('YouziCoursePreviewData.sync'), '主動同步沒有呼叫音教雲同步元件');

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

assert.strictEqual(packageJson.main, 'courseIndex.js', 'Firebase Functions 未使用明確課務入口');
assert(courseIndex.includes("require('./index')"), '課務入口未保留既有 Functions');
assert(courseIndex.includes('registerInjiaoyunEducationAutoRead(exports)'), '課務入口未註冊唯讀課表函式');
assert(!portalUtils.includes('registerInjiaoyunEducationAutoRead'), '工具模組仍在循環載入期間註冊 Firebase Function');
assert(publicAccessScript.includes('cloudfunctions.googleapis.com/v2/'), 'IAM 腳本未取得實際 Cloud Run 服務');
assert(publicAccessScript.includes(':setIamPolicy'), 'IAM 腳本未設定 Cloud Run 呼叫權限');
assert(publicAccessScript.includes('roles/run.invoker'), 'IAM 腳本未授權 Cloud Run Invoker');
assert(publicAccessScript.includes('allUsers'), 'IAM 腳本未允許網站匿名呼叫唯讀課表');
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
  assert(html.includes('operations-course-inline.js?v=20260730-mobile-rental-teacher-v1'), '營運入口未載入統一 inline 課務');
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
