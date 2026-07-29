'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const bootstrap = read('course-data-auto-bootstrap-v1.js');
const mobileCourse = read('operations-mobile-course-fix-v1.js');
const reviewData = read('course-scheduler-review-data.js');
const scheduler = read('course-scheduler.js');
const schedulerHtml = read('course-scheduler.html');
const autoRead = read('functions/injiaoyunEducationAutoRead.js');
const courseIndex = read('functions/courseIndex.js');
const portalUtils = read('functions/coursePortalUtils.js');
const publicAccessScript = read('.github/scripts/course-mirror-public.cjs');
const packageJson = JSON.parse(read('functions/package.json'));
const workflow = read('.github/workflows/firebase-functions-deploy.yml');
const hub = read('operations-hub.html');
const portal = read('portal.html');

new vm.Script(bootstrap, { filename: 'course-data-auto-bootstrap-v1.js' });
new vm.Script(mobileCourse, { filename: 'operations-mobile-course-fix-v1.js' });
new vm.Script(reviewData, { filename: 'course-scheduler-review-data.js' });
new vm.Script(scheduler, { filename: 'course-scheduler.js' });
new vm.Script(autoRead, { filename: 'functions/injiaoyunEducationAutoRead.js' });
new vm.Script(courseIndex, { filename: 'functions/courseIndex.js' });
new vm.Script(portalUtils, { filename: 'functions/coursePortalUtils.js' });
new vm.Script(publicAccessScript, { filename: '.github/scripts/course-mirror-public.cjs' });

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
assert(bootstrap.includes('global.location.reload()'), '首次自動寫入後未重新開啟完整課表');

assert(mobileCourse.includes('function hasScheduleData'), '手機首頁缺少課程事件判斷');
assert(mobileCourse.includes("if (!meaningful(snapshot)) return loadingCardHtml()"), '手機首頁仍可能用不完整資料畫出空白格線');
assert(mobileCourse.includes('不需要再按音教雲同步'), '手機空白狀態仍錯誤要求使用者同步');
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
assert(workflow.includes('node .github/scripts/course-mirror-public.cjs'), '工作流程未執行穩定的 Cloud Run 權限腳本');
assert(workflow.includes('course-mirror-diagnostics'), '驗證失敗時未保留可檢查的診斷紀錄');
assert(reviewData.includes('loadAutomaticCourseBootstrap'), '獨立課程日表未在初始化前啟動自動復原');

[hub, portal].forEach((html) => {
  const converterIndex = html.indexOf('course-scheduler-data.js');
  const bootstrapIndex = html.indexOf('course-data-auto-bootstrap-v1.js');
  const operationsIndex = html.indexOf('operations-phase1.js');
  assert(converterIndex >= 0, '營運入口未載入課務資料轉換器');
  assert(bootstrapIndex > converterIndex, '自動復原必須在資料轉換器之後載入');
  assert(operationsIndex > bootstrapIndex, '自動復原必須在營運頁面初始化前載入');
});

console.log('automatic course cloud load tests passed');
