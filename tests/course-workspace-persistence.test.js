'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const hub = read('operations-hub.html');
const portal = read('portal.html');
const persistence = read('operations-course-persistence-v1.js');
const mobileCourse = read('operations-mobile-course-fix-v1.js');
const denseCss = read('operations-mobile-course-dense-v1.css');
const reviewData = read('course-scheduler-review-data.js');
const portalCommon = read('course-portal-common.js');

new vm.Script(persistence, { filename: 'operations-course-persistence-v1.js' });
new vm.Script(mobileCourse, { filename: 'operations-mobile-course-fix-v1.js' });
new vm.Script(reviewData, { filename: 'course-scheduler-review-data.js' });
new vm.Script(portalCommon, { filename: 'course-portal-common.js' });

[hub, portal].forEach((html) => {
  assert(html.includes('id="opsCoursePersistentHost"'), '營運入口缺少課表常駐容器');
  assert(html.includes('operations-course-persistence-v1.js'), '營運入口未載入課表常駐程式');
  assert(html.includes('operations-mobile-course-fix-v1.js'), '營運入口未載入手機課表資料修正');
  assert(html.includes('operations-mobile-course-dense-v1.css'), '營運入口未載入手機九教室同屏樣式');
});

assert(persistence.includes('opsCoursePersistentHost'), '課表未搬移至常駐容器');
assert(persistence.includes('youzi.operations.courseWorkspacePosition.v1'), '課表捲動位置未保存');
assert(persistence.includes("content.hidden=active") || persistence.includes('content.hidden = active'), '其他頁面沒有只隱藏課表');
assert(!persistence.includes('removeChild'), '切換功能時不應刪除課表 iframe');

assert(mobileCourse.includes("WORKSPACE_KEY = 'workspace'"), '手機首頁未讀取工作資料庫');
assert(mobileCourse.includes("FORMAL_KEY = 'latest'"), '手機首頁未保留正式資料庫相容讀取');
assert(mobileCourse.includes('meaningful(workspace) ? workspace'), '手機首頁未優先使用最新本機工作資料');
assert(mobileCourse.includes("addEventListener('hashchange'"), '回到營運總覽時未重新讀取課表');
assert(mobileCourse.includes('全部 ') && mobileCourse.includes('間教室同時顯示'), '手機課表未標示全部教室同屏');

assert(denseCss.includes('repeat(var(--room-count), minmax(0, 1fr))'), '手機課表欄位未按畫面寬度平均壓縮');
assert(denseCss.includes('overflow-x: hidden'), '手機首頁課表仍會左右滑動');
assert(denseCss.includes('.ops-mobile-course-event b'), '學生姓名沒有獨立的優先顯示樣式');

assert(reviewData.includes('recoverSavedCourseWorkspace'), '缺少舊本機工作資料自動復原');
assert(reviewData.includes("WORKSPACE_KEY = 'workspace'"), '復原流程未讀取工作資料');
assert(reviewData.includes('put(makeFormal(rows.workspace), FORMAL_KEY)'), '工作資料未補回正式快照');
assert(reviewData.includes('global.location.reload()'), '修復快照後未重新開啟課表');
assert(!reviewData.includes('syncInjiaoyunEducationMirrorNow'), '本機復原不得觸發音教雲同步');

assert(portalCommon.includes('beginSessionResolution'), '入口綁定完成後缺少登入解析遮罩');
assert(portalCommon.includes('登入連結驗證完成後會直接進入'), '登入期間未避免再次顯示姓名電話表單');
assert(portalCommon.includes('teacher-quick-grid'), '老師入口未保留核准的快速功能排列');
['本週課表','我的學生','薪資查詢','增加課程','老師調課','租用教室'].forEach((label) => {
  assert(portalCommon.includes(label), `老師入口缺少快速功能：${label}`);
});

console.log('course workspace persistence tests passed');
