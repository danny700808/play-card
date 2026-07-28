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
['sandboxLogBtn', 'undoSandboxBtn', 'resetSandboxBtn', 'loadMigratedDataBtn']
  .forEach((id) => assert(!html.includes(id), `不應保留舊按鈕 ${id}`));

assert(client.includes("var WORKSPACE_DB_KEY='workspace'"), '工作資料未保存至 IndexedDB');
assert(client.includes('setTimeout(async function()'), '自動儲存未延遲執行，可能造成連續操作卡頓');
assert(client.includes('同步失敗，原資料已保留'), '同步失敗時未明確保留現有資料');
assert(client.includes('preserveWorkspaceConfiguration'), '同步未保留系統與教室設定');
assert(client.includes("loadingMigration=true;operationRunning=true"), '同步缺少連點鎖定');
assert(dataClient.includes('var usedByPeriod=attendance.reduce'), '扣堂統計未使用一次掃描，資料量大時可能卡頓');
assert(!dataClient.includes('period.usedCount=attendance.filter'), '不可逐期重掃全部簽到資料');

assert(mirror.includes('Promise.all(['), '課表核對與營運同步未平行執行');
assert(mirror.includes('ensureInjiaoyunOperationsSync(refreshDate)'), '未整合營運資料同步');
assert(mirror.includes('runAuditForRange(refreshRange.startDate, refreshRange.endDate)'), '未依日期範圍同步課表');
assert(preview.includes('mergeEducationDailyReceipts'), '學生實際付款未併入學費期別');
assert(preview.includes('reconcileAuditedAttendance') || mirror.includes('reconcileAuditedAttendance'), '最新簽到未重新核對');
assert(manual.includes("'course-scheduler'"), '營運同步未允許課程日表呼叫');

console.log('course scheduler unified sync tests passed');
