'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const hub = read('operations-hub.html');
const portal = read('portal.html');
const authoritative = read('operations-course-authoritative-v1.js');
const liveEntry = read('course-scheduler-live-entry-v1.js');
const scheduler = read('course-scheduler.js');
const mobileCourse = read('operations-mobile-course-fix-v1.js');
const denseCss = read('operations-mobile-course-dense-v1.css');
const portalCommon = read('course-portal-common.js');

new vm.Script(authoritative, { filename: 'operations-course-authoritative-v1.js' });
new vm.Script(liveEntry, { filename: 'course-scheduler-live-entry-v1.js' });
new vm.Script(scheduler, { filename: 'course-scheduler.js' });
new vm.Script(mobileCourse, { filename: 'operations-mobile-course-fix-v1.js' });
new vm.Script(portalCommon, { filename: 'course-portal-common.js' });

[hub, portal].forEach((html) => {
  assert(html.includes('id="opsCoursePersistentHost"'), '營運入口缺少課務顯示容器');
  assert(html.includes('operations-course-authoritative-v1.js?v=20260729-interactive-course-v1'), '營運入口未載入唯一互動課表路由');
  assert(html.includes('operations-mobile-course-fix-v1.js'), '營運入口未載入手機課表資料修正');
  assert(html.includes('operations-mobile-course-dense-v1.css'), '營運入口未載入手機九教室同屏樣式');
  assert(!html.includes('operations-course-persistence-v1.js'), '已停用的課表常駐補丁仍被載入');
  assert(!html.includes('operations-course-simple-full-v1.js'), '不可操作的靜態完整課表仍被載入');
  assert(!html.includes('operations-course-snapshot-bridge-v1.js'), '舊快照橋接補丁仍被載入');
  assert(!html.includes('operations-course-live-route-v1.js'), '舊課表路由補丁仍被載入');
});

assert(authoritative.includes("'course-calendar': 'calendar'"), '唯一互動路由未接管課程日表');
assert(authoritative.includes("'course-students': 'students'"), '唯一互動路由未接管學生與學費');
assert(authoritative.includes("'course-teachers': 'teachers'"), '唯一互動路由未接管老師薪資');
assert(authoritative.includes("'course-settings': 'settings'"), '唯一互動路由未接管系統設定');
assert(authoritative.includes('course-scheduler-live.html'), '唯一互動路由沒有使用完整可操作課表');

assert(liveEntry.includes("WORKSPACE_KEY = 'workspace'"), '完整課表未優先讀取工作資料庫');
assert(liveEntry.includes("FORMAL_KEY = 'latest'"), '完整課表未保留正式快照備援');
assert(liveEntry.includes('readDatabase'), '完整課表開啟時沒有讀取本機資料庫');
assert(liveEntry.includes('seedSnapshot'), '完整課表沒有建立可操作工作資料');
assert(liveEntry.includes('loadScheduler'), '資料完成後沒有啟動互動課表');

assert(scheduler.includes("WORKSPACE_DB_KEY='workspace'"), '互動課表未使用 workspace 資料庫');
assert(scheduler.includes("FORMAL_DB_KEY='latest'"), '互動課表未使用 latest 正式快照');
assert(scheduler.includes('scheduleWorkspaceSave'), '課表操作後沒有排程自動保存');
assert(scheduler.includes('storeWorkspaceDatabase(state)'), '課表操作沒有寫回工作資料庫');
assert(scheduler.includes('storeSynchronizedDatabases'), '同步成功後沒有一起更新正式與工作資料');
assert(scheduler.includes('preserveWorkspaceConfiguration'), '更新音教雲時沒有保留新版教室與系統設定');
assert(scheduler.includes("toast('同步失敗，原資料已保留'"), '同步失敗時沒有明確保留舊資料');
assert(scheduler.includes("$('scheduleGrid').addEventListener('click'"), '完整課表格線無法操作');
assert(scheduler.includes('eventDetails(row)'), '完整課表課程卡無法開啟明細');
assert(scheduler.includes('setAttendance'), '完整課表缺少簽到與請假操作');

assert(mobileCourse.includes("WORKSPACE_KEY = 'workspace'"), '手機首頁未讀取工作資料庫');
assert(mobileCourse.includes("FORMAL_KEY = 'latest'"), '手機首頁未保留正式資料庫相容讀取');
assert(mobileCourse.includes('meaningful(workspace) ? workspace'), '手機首頁未優先使用最新本機工作資料');
assert(mobileCourse.includes("addEventListener('hashchange'"), '回到營運總覽時未重新讀取課表');
assert(mobileCourse.includes('全部 ') && mobileCourse.includes('間教室同時顯示'), '手機課表未標示全部教室同屏');

assert(denseCss.includes('repeat(var(--room-count), minmax(0, 1fr))'), '手機課表欄位未按畫面寬度平均壓縮');
assert(denseCss.includes('overflow-x: hidden'), '手機首頁課表仍會左右滑動');
assert(denseCss.includes('.ops-mobile-course-event b'), '學生姓名沒有獨立的優先顯示樣式');

assert(portalCommon.includes('beginSessionResolution'), '入口綁定完成後缺少登入解析遮罩');
assert(portalCommon.includes('登入連結驗證完成後會直接進入'), '登入期間未避免再次顯示姓名電話表單');
assert(portalCommon.includes('teacher-quick-grid'), '老師入口未保留核准的快速功能排列');
['本週課表','我的學生','薪資查詢','增加課程','老師調課','租用教室'].forEach((label) => {
  assert(portalCommon.includes(label), `老師入口缺少快速功能：${label}`);
});

console.log('interactive course workspace persistence tests passed');
