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
const schedulerCss = read('course-scheduler.css');
const operations = read('operations-phase1.js');
const portalCommon = read('course-portal-common.js');
const inlineBuilder = read('.github/scripts/build-inline-course-workspace.cjs');
const inlineWorkflow = read('.github/workflows/build-live-course-scheduler.yml');

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
    /operations-course-inline\.js\?v=[^"']+/.test(html),
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
assert(inlineBuilder.includes("const VERSION = '20260808-teacher-payroll-month-v1'"), '課務產生器仍使用舊快取版本');
assert(inlineBuilder.includes('money(periodNetExpectedAmount(period))'), '課務產生器會重新產生錯誤的比例折扣金額');
assert.strictEqual((inlineBuilder.match(/money\(period\.expectedAmount-period\.discount\)/g) || []).length, 1, '課務產生器的學生 renderer 仍直接以比例值扣原價');
assert(inlineBuilder.includes('if (existingIsScoped)'), '課務產生器不會保留已完成更新的 inline runtime');
assert(inlineBuilder.includes('if (inlineTag.test(source))'), '課務產生器不會原位更新既有 inline script 版本');
assert(!inlineBuilder.includes('source = source.replace(/course-scheduler-data'), '課務產生器仍會誤改 course-scheduler-data 快取版本');
assert(inlineWorkflow.includes("operations.includes('href=\"course-portal-admin.html?section=bindings\"')"), '課務 workflow 未從營運中心主程式驗證入口綁定');
assert(!inlineWorkflow.includes("template.includes('course-portal-admin.html')"), '課務 workflow 仍對課務模板套用舊入口假設');

assert(operations.includes('YouziOperationsCourseInline.mount(content,courseView)'), '營運中心未在原頁掛載完整課務');
assert(!operations.includes('<iframe id="opsCourseFrame"'), '營運中心仍使用舊 iframe 課務');
assert(!operations.includes('frame.contentWindow.postMessage'), '營運中心仍保留舊 iframe 訊息傳遞');
assert(runtime.includes('window.__YOUZI_COURSE_INLINE_DOCUMENT__'), '完整課表沒有使用隔離文件介面');
assert(runtime.includes('window.__YOUZI_COURSE_INLINE_BOOTSTRAP_STATE__'), '完整課表沒有從控制器接收工作區');
assert(runtime.includes('refreshPortalRentals();'), '開啟課表後沒有更新入口成立或取消的租用');
assert(!runtime.includes('restoreFormalDatabase().then(refreshPortalRentals)'), '開頁仍會重複還原資料後再讀租用');
[
  ['inline 課務', runtime],
  ['獨立課務', scheduler]
].forEach(([label, source]) => {
  assert(source.includes('class="btn small outline tuition-receipt-button"'), `${label}已繳清摘要缺少收據按鈕`);
  assert(source.includes("receiptButton(latestPayment)"), `${label}收據按鈕沒有連到最新一筆收費`);
  assert(source.includes("payment='<span class=\"payment-summary\">'+paymentStatus+receiptButton(latestPayment)+'</span>'"), `${label}部分付款時沒有在上方保留唯一收據按鈕`);
  assert(!source.includes("receiptButton(entry,'查看／補印收據')"), `${label}每筆收費右側仍重複顯示收據按鈕`);
  assert(!source.includes("button.textContent='查看／補印收據'"), `${label}補建收據後仍恢復舊按鈕文字`);
  assert(source.includes('var viewer=openTuitionReceiptPlaceholder()'), `${label}補建收據未先開啟視窗，可能被瀏覽器阻擋`);
  assert(source.includes('openTuitionReceipt(transaction.receiptImageUrl,viewer)'), `${label}補建完成後未沿用預先開啟的收據視窗`);
  assert(!source.includes('money(period.expectedAmount-period.discount)'), `${label}學生列表仍直接扣除比例折扣值`);
  assert(!source.includes('(numberOf(period.expectedAmount)-numberOf(period.discount))'), `${label}單堂、薪資或退款仍直接扣除比例折扣值`);
  assert(source.includes('money(periodNetExpectedAmount(period))'), `${label}學生列表未顯示折扣後應收金額`);
  assert(source.includes('Math.round(periodNetExpectedAmount(period)/Math.max(1,numberOf(period.lessonCount)))'), `${label}單堂或退款金額未使用折扣後應收金額`);
  assert((source.match(/periodNetExpectedAmount\(period\)/g) || []).length >= 9, `${label}仍有財務計算未統一使用折扣後應收金額`);
  assert(source.includes('discountType:clean(current.discountType||current.planSnapshot&&current.planSnapshot.discountType)'), `${label}自動延續下一期時遺失折扣類型`);

  const teacherRenderer = source.slice(source.indexOf('function renderTeachers(){'), source.indexOf('function splitText(row)'));
  assert(source.includes('function teacherListMonthKey()'), `${label}老師薪資總表沒有月份狀態`);
  assert(source.includes('function shiftMonthKey(key,amount)'), `${label}老師薪資總表無法切換前後月份`);
  assert(teacherRenderer.includes('monthKey=teacherListMonthKey()'), `${label}老師薪資總表沒有依選擇月份查詢`);
  assert(teacherRenderer.includes("clean(row.date).slice(0,7)===monthKey"), `${label}老師薪資資料沒有按月份篩選`);
  assert(!teacherRenderer.includes('state.currentDate.slice(0,7)'), `${label}老師薪資仍錯誤跟著課表日期切換`);
  assert(source.includes("$('teacherPayrollMonth').value=teacherListMonthKey()"), `${label}老師薪資明細沒有沿用總表月份`);
  assert(source.includes("$('teacherListMonthPrev').addEventListener('click'"), `${label}缺少上一月操作`);
  assert(source.includes("$('teacherListMonthNext').addEventListener('click'"), `${label}缺少下一月操作`);
  assert(source.includes("$('teacherListMonthCurrent').addEventListener('click'"), `${label}缺少回到本月操作`);

  const netHelper = (source.match(/function periodNetExpectedAmount\(period\)\{[^\n]+\}/) || [])[0];
  const balanceHelper = (source.match(/function periodBalance\(period\)\{[^\n]+\}/) || [])[0];
  assert(netHelper && balanceHelper, `${label}缺少依折扣類型計算應收餘額的函式`);
  const tuitionMath = new Function(
    'numberOf',
    'clean',
    'periodRefunded',
    'periodPaid',
    `${netHelper}\n${balanceHelper}\nreturn {periodNetExpectedAmount,periodBalance};`
  )(
    (value) => Number.isFinite(Number(value)) ? Number(value) : 0,
    (value) => String(value == null ? '' : value).trim(),
    (period) => (period.transactions || []).filter((row) => row.type === 'refund').reduce((total, row) => total + Number(row.amount || 0), 0),
    (period) => (period.transactions || []).reduce((total, row) => total + (row.type === 'refund' ? -Number(row.amount || 0) : Number(row.amount || 0)), 0)
  );
  const ratioPeriod = { expectedAmount: 4000, discount: 0.1, discountType: 'ratio', lessonCount: 4 };
  assert.strictEqual(tuitionMath.periodNetExpectedAmount(ratioPeriod), 3600, `${label}九折應收金額不是 3600`);
  assert.strictEqual(tuitionMath.periodNetExpectedAmount(ratioPeriod) / ratioPeriod.lessonCount, 900, `${label}九折後單堂金額不是 900`);
  assert.strictEqual(tuitionMath.periodBalance(ratioPeriod), 3600, `${label}九折應收餘額不是 3600`);
  assert.strictEqual(tuitionMath.periodBalance({ expectedAmount: 4000, discount: 200, discountType: 'amount' }), 3800, `${label}金額折扣應收餘額錯誤`);
  assert.strictEqual(tuitionMath.periodBalance({ expectedAmount: 4000, discount: 0.1, planSnapshot: { discountType: 'ratio' } }), 3600, `${label}沒有沿用方案快照的比例折扣`);
  assert.strictEqual(tuitionMath.periodBalance({ expectedAmount: 4000, discount: 0.1, discountType: 'ratio', transactions: [{ type: 'payment', amount: 1000 }] }), 2600, `${label}比例折扣後的部分付款餘額錯誤`);
});

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
  'teacherListMonth',
  'teacherListMonthPrev',
  'teacherListMonthNext',
  'teacherListMonthCurrent',
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
assert(/id="teacherListMonth" type="month"/.test(template), '老師薪資總表缺少月份選擇欄位');
assert(template.includes('薪資月份查詢'), '老師薪資總表沒有清楚標示月份查詢');
assert(schedulerCss.includes('.teacher-month-filter'), '老師薪資月份查詢缺少桌機版排版');
assert(schedulerCss.includes('.teacher-month-control'), '老師薪資月份欄位缺少整體樣式');
['rooms', 'subjects', 'fees'].forEach((tab) => {
  assert(template.includes(`data-settings-tab="${tab}"`), `inline 課務缺少設定分頁：${tab}`);
});

assert(portalCommon.includes('beginSessionResolution'), '入口登入完成後缺少工作階段解析遮罩');
assert(portalCommon.includes('登入連結驗證完成後會直接進入'), '登入期間未避免重複輸入資料');
assert(!portalCommon.includes('teacher-quick-grid'), '共用登入程式仍插入重複的老師上方快捷鍵');
assert(!portalCommon.includes('installTeacherApprovedLayout'), '共用登入程式仍覆寫老師入口版面');

console.log('inline course workspace persistence tests passed');
