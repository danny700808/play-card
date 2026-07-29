'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const bootstrap = read('course-data-auto-bootstrap-v1.js');
const mobileCourse = read('operations-mobile-course-fix-v1.js');
const schedulerData = read('course-scheduler-data.js');
const scheduler = read('course-scheduler.js');
const schedulerHtml = read('course-scheduler.html');
const liveSchedulerHtml = read('course-scheduler-live.html');
const liveEntry = read('course-scheduler-live-entry-v1.js');
const authoritativeRoute = read('operations-course-authoritative-v1.js');
const operations = read('operations-phase1.js');
const autoRead = read('functions/injiaoyunEducationAutoRead.js');
const courseIndex = read('functions/courseIndex.js');
const portalUtils = read('functions/coursePortalUtils.js');
const publicAccessScript = read('.github/scripts/course-mirror-public.cjs');
const reportScript = read('.github/scripts/course-mirror-report.cjs');
const packageJson = JSON.parse(read('functions/package.json'));
const workflow = read('.github/workflows/firebase-functions-deploy.yml');
const hub = read('operations-hub.html');
const portal = read('portal.html');

[
  ['course-data-auto-bootstrap-v1.js', bootstrap],
  ['operations-mobile-course-fix-v1.js', mobileCourse],
  ['course-scheduler-data.js', schedulerData],
  ['course-scheduler.js', scheduler],
  ['course-scheduler-live-entry-v1.js', liveEntry],
  ['operations-course-authoritative-v1.js', authoritativeRoute],
  ['functions/injiaoyunEducationAutoRead.js', autoRead],
  ['functions/courseIndex.js', courseIndex],
  ['functions/coursePortalUtils.js', portalUtils],
  ['.github/scripts/course-mirror-public.cjs', publicAccessScript],
  ['.github/scripts/course-mirror-report.cjs', reportScript]
].forEach(([filename, source]) => new vm.Script(source, { filename }));

const htmlIds = new Set(Array.from(schedulerHtml.matchAll(/\bid=["']([^"']+)["']/g), (match) => match[1]));
const bindEventsSource = (scheduler.match(/function bindEvents\(\)\{([\s\S]*?)\n\s*function init\(\)/) || [])[1] || '';
const requiredSchedulerIds = new Set(Array.from(bindEventsSource.matchAll(/(?<!\$)\$\(['"]([^'"]+)['"]\)/g), (match) => match[1]));
const missingSchedulerIds = Array.from(requiredSchedulerIds).filter((id) => !htmlIds.has(id));
assert.deepStrictEqual(missingSchedulerIds, [], `完整課表 HTML 缺少初始化需要的元素：${missingSchedulerIds.join('、')}`);

assert(bootstrap.includes("AUTO_FUNCTION_NAME = 'loadInjiaoyunEducationMirrorAuto'"), '前端未呼叫唯讀雲端課務資料');
assert(bootstrap.includes("AUTHENTICATED_FUNCTION_NAME = 'loadInjiaoyunEducationMirror'"), '自動讀取尚未部署時缺少既有唯讀函式相容路徑');
assert(bootstrap.includes("FORMAL_KEY = 'latest'"), '未保存正式課務快照');
assert(bootstrap.includes("WORKSPACE_KEY = 'workspace'"), '未保存可操作課務工作區');
assert(bootstrap.includes('不會重新執行音教雲同步'), '畫面未區分讀取資料與主動同步');
assert(bootstrap.includes('function hasScheduleData'), '缺少真正課程資料判斷');
assert(bootstrap.includes("['events', 'recurringRules', 'fixedCourses', 'temporaryCourses', 'roomRentals']"), '有效課表判斷未涵蓋正式課、調課與租用');
assert(bootstrap.includes('return hasScheduleData(source) && hasDirectoryData(source)'), '只有老師、學生或教室資料仍可能被誤判為完整課表');
assert(!bootstrap.includes('syncInjiaoyunEducationMirrorNow'), '正常開頁不得觸發音教雲同步');
assert(bootstrap.includes('YouziCoursePreviewData.buildState'), '雲端鏡像未轉換成完整課務狀態');

assert(liveEntry.includes("FORMAL_KEY = 'latest'"), '互動課表未讀取正式課務快照');
assert(liveEntry.includes("WORKSPACE_KEY = 'workspace'"), '互動課表未優先讀取可操作工作區');
assert(liveEntry.includes("CLOUD_FUNCTION = 'loadInjiaoyunEducationMirrorAuto'"), '本機沒有資料時缺少雲端唯讀備援');
assert(liveEntry.includes('parentSnapshot'), '嵌入營運中心時未接收父頁課表快照');
assert(liveEntry.includes('readDatabase'), '互動課表沒有直接讀取 IndexedDB');
assert(liveEntry.includes('seedSnapshot'), '互動課表未把正式資料建立成可操作工作區');
assert(liveEntry.includes('loadScheduler'), '資料完成後沒有載入互動課表主程式');
assert(liveSchedulerHtml.includes('course-scheduler-live-entry-v1.js'), '互動課表入口未載入唯一啟動程式');
assert(!liveSchedulerHtml.includes('course-scheduler-startup-gate-v1.js'), '互動課表仍載入舊啟動閘門');
assert(!liveSchedulerHtml.includes('course-data-auto-bootstrap-v1.js'), '互動課表仍載入會重新整理的舊 bootstrap');
assert(!liveSchedulerHtml.includes('<script src="course-scheduler.js'), '互動課表不得在資料完成前直接初始化');

assert(scheduler.includes('function bindEvents()'), '互動課表缺少事件綁定');
assert(scheduler.includes("$('scheduleGrid').addEventListener('click'"), '課表格線無法點擊新增或查看課程');
assert(scheduler.includes('eventDetails(row)'), '課程卡片無法開啟課程明細');
assert(scheduler.includes('openSchedule({date:state.currentDate'), '互動課表缺少新增／調課入口');
assert(scheduler.includes('setAttendance'), '互動課表缺少簽到、請假與曠課處理');
assert(scheduler.includes('storeSynchronizedDatabases'), '同步完成後沒有安全更新 latest 與 workspace');
assert(scheduler.includes('preserveWorkspaceConfiguration'), '音教雲更新時沒有保留新版教室與系統設定');
assert(scheduler.includes('syncInjiaoyunEducationMirrorNow') || schedulerData.includes('syncInjiaoyunEducationMirrorNow'), '互動課表缺少手動同步功能');

assert(authoritativeRoute.includes("'course-calendar': 'calendar'"), '唯一正式路由沒有接管課程日表');
assert(authoritativeRoute.includes('course-scheduler-live.html'), '唯一正式路由沒有開啟互動課表');
assert(!authoritativeRoute.includes('operations-course-simple-full'), '正式路由不可再開啟靜態簡易完整課表');
assert(operations.includes('id="opsCourseFrame"'), '營運中心沒有互動課表容器');

assert(mobileCourse.includes('function hasScheduleData'), '手機首頁缺少課程事件判斷');
assert(mobileCourse.includes("if (!meaningful(snapshot)) return loadingCardHtml()"), '手機首頁仍可能用不完整資料畫出空白格線');
assert(mobileCourse.includes('youzi-course-auto-data-ready'), '自動還原完成後手機首頁不會立即更新');

assert(autoRead.includes('loadInjiaoyunEducationMirrorAuto'), '後端缺少自動讀取函式');
assert(autoRead.includes('assertAllowedRead'), '後端讀取沒有來源限制');
assert(autoRead.includes("where('sourceActive', '==', true)"), '後端未優先讀取有效鏡像資料');
assert(autoRead.includes("invoker: 'public'"), '唯讀課表函式沒有宣告網站可公開呼叫');
assert(!autoRead.includes('MANUAL_SYNC_PIN'), '一般開頁讀取不應再要求手動同步密碼');
assert(!autoRead.includes('syncInjiaoyunEducationMirrorNow'), '一般開頁不得觸發音教雲同步');

assert.strictEqual(packageJson.main, 'courseIndex.js', 'Firebase Functions 未使用明確課務入口');
assert(courseIndex.includes("require('./index')"), '明確入口未保留既有正式 Functions');
assert(courseIndex.includes('registerInjiaoyunEducationAutoRead(exports)'), '明確入口未註冊自動課表讀取函式');
assert(!portalUtils.includes('registerInjiaoyunEducationAutoRead'), '工具模組仍在循環載入期間註冊 Firebase Function');
assert(publicAccessScript.includes('cloudfunctions.googleapis.com/v2/'), 'IAM 腳本未從 Cloud Functions API 取得實際 Cloud Run 服務');
assert(publicAccessScript.includes(':setIamPolicy'), 'IAM 腳本未設定 Cloud Run 呼叫權限');
assert(publicAccessScript.includes('roles/run.invoker'), 'IAM 腳本未授權 Cloud Run Invoker');
assert(publicAccessScript.includes('allUsers'), 'IAM 腳本未允許網站匿名呼叫唯讀課表');
assert(reportScript.includes('DEPLOY_OUTCOME'), '最終狀態回報未包含 Firebase 部署結果');
assert(workflow.includes('firebase deploy'), '工作流程沒有真正部署 Firebase Function');
assert(workflow.includes('node .github/scripts/course-mirror-public.cjs'), '工作流程未執行穩定的 Cloud Run 權限腳本');
assert(workflow.includes('node .github/scripts/course-mirror-report.cjs'), '工作流程未使用 CommonJS 最終狀態回報器');
assert(workflow.includes('course-mirror-diagnostics'), '驗證失敗時未保留可檢查的診斷紀錄');
assert(workflow.includes('Fail workflow when deployment, access, or health check failed'), '部署、權限或健康檢查失敗時工作流程仍可能顯示成功');

[hub, portal].forEach((html) => {
  const converterIndex = html.indexOf('course-scheduler-data.js');
  const bootstrapIndex = html.indexOf('course-data-auto-bootstrap-v1.js');
  const operationsIndex = html.indexOf('operations-phase1.js');
  const authoritativeIndex = html.indexOf('operations-course-authoritative-v1.js');
  assert(converterIndex >= 0, '營運入口未載入課務資料轉換器');
  assert(bootstrapIndex > converterIndex, '自動復原必須在資料轉換器之後載入');
  assert(operationsIndex > bootstrapIndex, '自動復原必須在營運頁面初始化前載入');
  assert(authoritativeIndex > operationsIndex, '唯一互動課表路由必須在營運中心之後接管 iframe');
  assert(!html.includes('operations-course-persistence-v1.js'), '營運入口仍載入舊常駐補丁');
  assert(!html.includes('operations-course-simple-full-v1.js'), '營運入口仍載入不可操作的靜態課表補丁');
  assert(!html.includes('operations-course-snapshot-bridge-v1.js'), '營運入口仍載入舊快照橋接補丁');
  assert(!html.includes('operations-course-live-route-v1.js'), '營運入口仍載入舊路由補丁');
  assert(html.includes('operations-course-authoritative-v1.js?v=20260729-interactive-course-v1'), '營運入口未載入唯一互動課表路由');
});

console.log('automatic course cloud load and interactive scheduler tests passed');
