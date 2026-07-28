'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const bootstrap = read('course-data-auto-bootstrap-v1.js');
const reviewData = read('course-scheduler-review-data.js');
const autoRead = read('functions/injiaoyunEducationAutoRead.js');
const portalUtils = read('functions/coursePortalUtils.js');
const workflow = read('.github/workflows/firebase-functions-deploy.yml');
const hub = read('operations-hub.html');
const portal = read('portal.html');

new vm.Script(bootstrap, { filename: 'course-data-auto-bootstrap-v1.js' });
new vm.Script(reviewData, { filename: 'course-scheduler-review-data.js' });
new vm.Script(autoRead, { filename: 'functions/injiaoyunEducationAutoRead.js' });
new vm.Script(portalUtils, { filename: 'functions/coursePortalUtils.js' });

assert(bootstrap.includes("FUNCTION_NAME = 'loadInjiaoyunEducationMirrorAuto'"), '前端未呼叫唯讀雲端課務資料');
assert(bootstrap.includes("FORMAL_KEY = 'latest'"), '未保存正式課務快照');
assert(bootstrap.includes("WORKSPACE_KEY = 'workspace'"), '未保存可操作課務工作區');
assert(bootstrap.includes('不會重新執行音教雲同步'), '畫面未區分讀取資料與主動同步');
assert(!/\['events'[^\]]*'rooms'\]/.test(bootstrap), '只有教室欄位不可再被判定為有效課表');
assert(bootstrap.includes('YouziCoursePreviewData.buildState'), '雲端鏡像未轉換成完整課務狀態');
assert(bootstrap.includes("global.location.reload()"), '首次自動寫入後未重新開啟完整課表');

assert(autoRead.includes('loadInjiaoyunEducationMirrorAuto'), '後端缺少自動讀取函式');
assert(autoRead.includes('assertAllowedRead'), '後端讀取沒有來源限制');
assert(autoRead.includes("where('sourceActive', '==', true)"), '後端未只讀取有效鏡像資料');
assert(!autoRead.includes('MANUAL_SYNC_PIN'), '一般開頁讀取不應再要求手動同步密碼');
assert(!autoRead.includes('syncInjiaoyunEducationMirrorNow'), '一般開頁不得觸發音教雲同步');

assert(portalUtils.includes('registerInjiaoyunEducationAutoRead'), 'Firebase Functions 未註冊自動讀取函式');
assert(workflow.includes("'loadInjiaoyunEducationMirrorAuto'"), '部署流程未驗證自動讀取函式');
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
