'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'course-scheduler.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'course-scheduler.js'), 'utf8');
const dataClient = fs.readFileSync(path.join(root, 'course-scheduler-data.js'), 'utf8');
const mirror = fs.readFileSync(path.join(root, 'functions/injiaoyunEducationMirror.js'), 'utf8');
const preview = fs.readFileSync(path.join(root, 'functions/injiaoyunEducationPreview.js'), 'utf8');
const manual = fs.readFileSync(path.join(root, 'functions/injiaoyunManualSync.js'), 'utf8');

new vm.Script(client, { filename: 'course-scheduler.js' });
new vm.Script(dataClient, { filename: 'course-scheduler-data.js' });
new vm.Script(mirror, { filename: 'functions/injiaoyunEducationMirror.js' });
new vm.Script(preview, { filename: 'functions/injiaoyunEducationPreview.js' });
new vm.Script(manual, { filename: 'functions/injiaoyunManualSync.js' });

assert.strictEqual(
  (html.match(/id="syncInjiaoyunBtn"/g) || []).length,
  1,
  '課程日表只能保留一個同步入口'
);
assert(html.includes('更新音教雲最新資料'), '同步按鈕未清楚標示更新最新資料');
['sandboxLogBtn', 'undoSandboxBtn', 'resetSandboxBtn', 'loadMigratedDataBtn']
  .forEach((id) => assert(!html.includes(id), `不應保留舊按鈕 ${id}`));

assert(client.includes("var WORKSPACE_DB_KEY='workspace'"), '工作資料未保存至 IndexedDB');
assert(client.includes('requestPersistentStorage'), '未向瀏覽器要求保留課務資料庫');
assert(client.includes("embeddedMode=urlOption('embed')==='1'"), '課務頁未支援營運中心內嵌模式');
assert(client.includes("switchView(requestedView())"), '營運中心無法直接開啟指定的課務子頁');
assert(client.includes("type:'youzi-course-view-change'"), '課務子頁切換未回報營運中心');
assert(client.includes('開啟課務管理會直接顯示上次資料'), '畫面未清楚說明不需每次重新同步');
assert(client.includes('setTimeout(async function()'), '自動儲存未延遲執行，可能造成連續操作卡頓');
assert(client.includes('同步失敗，原資料已保留'), '同步失敗時未明確保留現有資料');
assert(client.includes('preserveWorkspaceConfiguration'), '同步未保留系統與教室設定');
assert(client.includes('storeSynchronizedDatabases'), '正式資料與工作資料未使用同一筆原子寫入');
assert(
  client.indexOf('if(!stored)throw new Error') < client.indexOf('formalState=nextFormal'),
  '資料寫入失敗前不可先覆蓋畫面中的原資料'
);
assert(client.includes('var refreshDate=todayKey()'), '手動更新未固定同步到今天最新資料');
assert(client.includes('會由舊音教雲最新資料覆蓋'), '同步前未提醒新版測試資料將被舊系統覆蓋');
assert(client.includes("loadingMigration=true;operationRunning=true"), '同步缺少連點鎖定');
assert(dataClient.includes('var usedByPeriod=attendance.reduce'), '扣堂統計未使用一次掃描，資料量大時可能卡頓');
assert(!dataClient.includes('period.usedCount=attendance.filter'), '不可逐期重掃全部簽到資料');

assert(mirror.includes('Promise.all(['), '課表核對與營運同步未平行執行');
assert(mirror.includes('ensureInjiaoyunOperationsSync(refreshDate)'), '未整合營運資料同步');
assert(mirror.includes('await runAuditForRange(startDate, endDate)'), '未依日期範圍同步課表');
assert(mirror.includes('syncRecentMirror('), '同步完成後未使用近期差異套用');
assert(mirror.includes("'manual-unified-recent-delta'"), '手動同步仍可能重建完整歷史鏡像');
assert(!mirror.includes("await syncLatestMirror('load-latest')"), '開啟頁面不應自動重建完整歷史鏡像');
assert(mirror.includes("settings.unifiedSyncStatus"), '核對觸發器未避免與手動同步重複套用');
assert(mirror.includes('snapshotForDates(MIRROR_TYPES.attendance, coveredDates)'), '近期同步仍讀取全部歷史簽到');
assert(mirror.includes('readEducationDaily(coveredDates)'), '近期同步仍讀取全部每日營運資料');
assert(mirror.includes('resolveAuditForRange(before, refreshRange.startDate, refreshRange.endDate)'), '相同日期範圍仍會重複啟動核對工作');
assert(mirror.includes('auditIsRecent(previousAudit)'), '同步未檢查可沿用的近期核對結果');
assert(preview.includes('mergeEducationDailyReceipts'), '學生實際付款未併入學費期別');
assert(preview.includes('reconcileAuditedAttendance') || mirror.includes('reconcileAuditedAttendance'), '最新簽到未重新核對');
assert(manual.includes("'course-scheduler'"), '營運同步未允許課程日表呼叫');
assert(manual.includes("'INJIAOYUN_STUDIO_ID'"), '雲端同步未帶入既有音教雲機構編號');
assert(manual.includes('resolveKnownStudioId()'), '雲端同步未自動沿用歷史資料的機構編號');
assert(manual.includes('invokeCloudRunJob(studioId)'), '啟動工作時未傳入已確認的機構編號');

console.log('course scheduler unified sync tests passed');
