'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const expenses=require('../operations-expenses.js');

function total(rows){return rows.reduce((sum,row)=>sum+row.amount,0);}

const julyRent=expenses.allocateMonthlyAmount(42500,'2026-07',[1]);
assert.equal(julyRent.length,27,'2026 年 7 月應排除 4 個星期一');
assert.equal(total(julyRent),42500,'房租月合計必須一元不差');
assert.equal(julyRent[0].dateKey,'2026-07-01');
assert.equal(julyRent[0].amount,1576,'餘數 2 元應全部放在第一個營業日');
assert.ok(julyRent.slice(1).every(row=>row.amount===1574),'其他營業日應使用整數商數');
assert.ok(julyRent.every(row=>new Date(row.dateKey+'T12:00:00').getDay()!==1),'星期一不得分攤固定支出');

const june=expenses.allocateMonthlyAmount(6500,'2026-06',[1]);
assert.equal(june[0].dateKey,'2026-06-02','1 號是星期一時，餘數應放在星期二');
assert.equal(total(june),6500);

const settings=expenses.normalizeSettings({});
const beforeStart=expenses.buildLedger({settings,expenses:[],start:'2026-06-01',end:'2026-06-30'});
assert.equal(total(beforeStart),0,'所有預設固定支出均從 2026 年 7 月開始');

const julyLedger=expenses.buildLedger({settings,expenses:[],start:'2026-07-01',end:'2026-07-31'});
assert.equal(total(julyLedger),49000,'七月固定支出應為房租 42,500 加 Yamaha 6,500');

const carriedSettings=expenses.normalizeSettings({recurringRules:[
  {id:'rent',category:'房屋租金',amount:42500,startMonth:'2026-07',active:true,monthlyOverrides:[{month:'2026-08',amount:43000},{month:'2026-10',amount:44000}]},
  {id:'yamaha-authorization',category:'Yamaha 授權費',amount:6500,startMonth:'2026-07',active:true}
]});
assert.equal(expenses.effectiveRuleForMonth(carriedSettings.recurringRules[0],'2026-07').amount,42500,'變動前月份應保留原始金額');
assert.equal(expenses.effectiveRuleForMonth(carriedSettings.recurringRules[0],'2026-08').amount,43000,'變動月份應使用新金額');
assert.equal(expenses.effectiveRuleForMonth(carriedSettings.recurringRules[0],'2026-09').amount,43000,'未再變動的下個月應自動沿用');
assert.equal(expenses.effectiveRuleForMonth(carriedSettings.recurringRules[0],'2026-10').amount,44000,'下一次變動只從指定月份起生效');
assert.equal(total(expenses.buildLedger({settings:carriedSettings,expenses:[],start:'2026-09-01',end:'2026-09-30'})),49500,'九月應沿用八月房租並加上 Yamaha');

const monthOnlySettings=expenses.normalizeSettings({recurringRules:[
  {id:'parttime-payroll',category:'工讀生薪資',amount:3000,startMonth:'2026-07',allocationMode:'actual',active:true,monthlyOverrides:[{month:'2026-08',amount:4200,mode:'actual'}]}
]});
const monthOnlyRule=monthOnlySettings.recurringRules.find(row=>row.id==='parttime-payroll');
assert.equal(expenses.effectiveRuleForMonth(monthOnlyRule,'2026-07').amount,3000,'只扣本月項目應計入建立月份');
assert.equal(expenses.effectiveRuleForMonth(monthOnlyRule,'2026-08').amount,4200,'只扣本月項目可以設定另一個月份');
assert.equal(expenses.effectiveRuleForMonth(monthOnlyRule,'2026-09').amount,0,'只扣本月項目不得自動延續');

const splitSettings=expenses.normalizeSettings({recurringRules:[
  {id:'electricity',category:'電費',amount:3001,startMonth:'2026-07',allocationMode:'bimonthly',active:true,monthlyOverrides:[{month:'2026-08',amount:3000,mode:'bimonthly'}]}
]});
const splitRule=splitSettings.recurringRules.find(row=>row.id==='electricity');
assert.equal(expenses.effectiveRuleForMonth(splitRule,'2026-07').amount,3001);
assert.equal(expenses.effectiveRuleForMonth(splitRule,'2026-08').amount,3000);
assert.equal(expenses.effectiveRuleForMonth(splitRule,'2026-09').amount,0,'兩月帳單分完後不得延續到第三個月');

const electricRows=expenses.buildLedger({
  settings,
  expenses:[{id:'electric-1',category:'電費',amount:6001,allocationMode:'bimonthly',periodStartMonth:'2026-07',periodEndMonth:'2026-08',occurredAt:'2026-09-05'}],
  start:'2026-07-01',
  end:'2026-08-31'
}).filter(row=>row.sourceId==='electric-1');
assert.equal(total(electricRows.filter(row=>row.expenseMonth==='2026-07')),3001,'奇數帳單餘額應放在前一個費用月份');
assert.equal(total(electricRows.filter(row=>row.expenseMonth==='2026-08')),3000);
assert.ok(electricRows.every(row=>new Date(row.dateKey+'T12:00:00').getDay()!==1));

const actualMonday=expenses.buildLedger({
  settings,
  expenses:[{id:'actual-1',category:'臨時支出',amount:800,allocationMode:'actual',occurredAt:'2026-07-06'}],
  start:'2026-07-06',
  end:'2026-07-06'
}).filter(row=>row.sourceId==='actual-1');
assert.equal(total(actualMonday),800,'實際發生的一次性支出仍應保留星期一日期');

const operationsSource=fs.readFileSync(path.join(__dirname,'..','operations-phase1.js'),'utf8');
const operationsHubSource=fs.readFileSync(path.join(__dirname,'..','operations-hub.html'),'utf8');
const formalPortalSource=fs.readFileSync(path.join(__dirname,'..','portal.html'),'utf8');
assert.match(operationsSource,/扣款方式：星期一不計算/,'支出頁最上方必須清楚說明星期一規則');
assert.match(operationsSource,/主表內的月支出只分攤到非星期一的營業日/,'支出頁必須說明星期一不分攤');
assert.match(operationsSource,/const body=operatingExpenseRuleNoticeHtml\(\)\+'<div class="ops-expense-detail-head">/,'扣款規則說明必須位於支出明細頁最上方');
assert.match(operationsHubSource,/href="#expenses" data-view="expenses"/,'左側選單必須有獨立營運支出入口');
assert.match(operationsHubSource,/>營運支出</,'左側選單必須明確標示營運支出');
assert.match(formalPortalSource,/href="#expenses" data-view="expenses"/,'正式入口的左側選單也必須有營運支出');
assert.match(formalPortalSource,/operations-expenses\.js\?v=20260801-operating-expenses-v4/,'正式入口必須先載入支出分攤程式');
assert.match(formalPortalSource,/operations-phase1\.js\?v=20260801-expense-departments-v29/,'正式入口必須使用雙部門新版主程式快取號');
assert.match(operationsSource,/expenses:renderOperatingExpensesPage/,'營運支出入口必須顯示獨立右側頁面');
assert.match(operationsSource,/id="operatingExpenseMonth"/,'營運支出頁必須可以選擇查詢月份');
assert.match(operationsSource,/data-action="expense-month-shift"/,'營運支出頁必須可以切換前後月份');
assert.match(operationsSource,/支出主表/,'營運支出頁必須用單一月份主表管理');
assert.match(operationsSource,/data-action="expense-plan-edit"/,'每月延續項目必須可從主表直接修改');
assert.match(operationsSource,/id="operatingExpenseMonthForm"/,'主表必須能一次儲存多個本月金額');
assert.match(operationsSource,/data-expense-plan-amount/,'主表金額必須可以直接輸入');
assert.match(operationsSource,/engine\.EXPENSE_CATEGORIES\.forEach/,'主表必須列出所有預設支出類別，未設定者顯示 0');
assert.match(operationsSource,/data-action="expense-custom-new"/,'主表底部必須能增加尚未存在的自訂項目');
assert.doesNotMatch(operationsSource,/data-action="operating-expense-settings">固定費用設定/,'支出頁不得再顯示獨立固定費用設定入口');
assert.match(operationsSource,/一次性支出依實際發生日保留/,'星期一仍必須保留一次性實際支出');
assert.match(operationsSource,/\{id:'store',label:'尚品樂器行',shortLabel:'營業部門'\}/,'既有支出帳必須明確歸屬尚品樂器行／營業部門');
assert.match(operationsSource,/\{id:'academy',label:'凱莉音樂補習班',shortLabel:'補習部門'\}/,'第二本支出帳必須明確歸屬凱莉音樂補習班／補習部門');
assert.match(operationsSource,/data-action="expense-department"/,'支出頁必須可以直接切換兩個部門');
assert.match(operationsSource,/departments\.store\|\|source/,'既有單一帳冊資料必須完整保留為營業部門資料');
assert.match(operationsSource,/departments\.academy\?operatingExpenseEngine\(\)\.normalizeSettings\(departments\.academy\):zeroOperatingExpenseSettings\(\)/,'補習部門首次建立時必須全部從 0 開始');
assert.match(operationsSource,/schemaVersion:2,departments:\{store:store,academy:academy\}/,'雙部門帳冊必須使用可辨識的第二版資料結構');
assert.match(operationsSource,/operatingExpenseLedgerForDepartmentBounds\('store',bounds\)\.concat\(operatingExpenseLedgerForDepartmentBounds\('academy',bounds\)\)/,'營運總覽必須合併兩個部門的支出後再扣除');
assert.match(operationsSource,/operatingExpenseSettingsForDepartment\(operatingExpenseDepartmentKey\(\)\),changed=0/,'主表批次儲存必須只寫入目前選擇的部門');
assert.match(operationsSource,/settings=operatingExpenseSettingsForDepartment\(operatingExpenseDepartmentKey\(\)\)/,'自訂支出項目必須只新增到目前選擇的部門');
assert.match(operationsSource,/clean\(row\.department\|\|row\.departmentKey\)\|\|'store'/,'沒有部門欄位的舊支出紀錄必須自動視為營業部門');
assert.match(operationsSource,/department=existing\?clean\(existing\.department\|\|existing\.departmentKey\)\|\|'store':operatingExpenseDepartmentKey\(\)/,'新支出紀錄必須保存部門且舊紀錄不得被搬錯帳');
assert.match(operationsSource,/<th>部門<\/th>/,'合併支出明細必須顯示每筆所屬部門');

const expensePageSource=operationsSource.slice(operationsSource.indexOf('function renderOperatingExpensesPage'),operationsSource.indexOf('function openOperatingExpenseDetail'));
assert.doesNotMatch(expensePageSource,/data-action="expense-new"/,'月份工具列與主表表頭不得再放增加按鈕');
const planEditorSource=operationsSource.slice(operationsSource.indexOf('function openOperatingExpensePlan'),operationsSource.indexOf('function expenseCategoryOptions'));
assert.doesNotMatch(planEditorSource,/name="paymentMethod"|name="occurredAt"/,'新版支出修改與新增表單不得要求付款方式或發生日');

assert.match(operationsSource,/data-nav="sales">前往銷售/,'門市營運必須導向現場銷售');
assert.match(operationsSource,/data-nav="sync">前往訂單/,'網路營運必須導向平台訂單');
assert.match(operationsSource,/data-nav="rentals">前往租賃/,'租賃營運必須導向租賃頁');
assert.match(operationsSource,/data-nav="course-calendar">前往課務/,'補習班營運必須導向主要課程日表');
assert.doesNotMatch(operationsSource,/summaryBox\('固定支出規則','星期一不分攤'/,'總覽不得再顯示固定支出規則方塊');
assert.ok(operationsSource.indexOf('<b>門市應收帳款</b>')<operationsSource.indexOf('<b>平台同步異常</b>'),'需要注意區的門市應收帳款必須排第一');
assert.ok(formalPortalSource.indexOf('href="#expenses" data-view="expenses"')>formalPortalSource.indexOf('href="#rentals" data-view="rentals"'),'營運支出必須放在左側選單最下面');
assert.doesNotMatch(formalPortalSource,/<b>營運支出<\/b><small>/,'營運支出選單不得再顯示小字');

const startupDocument={readyState:'loading',addEventListener:function(){}};
const startupWindow={document:startupDocument};
startupWindow.window=startupWindow;
vm.runInNewContext(operationsSource,{window:startupWindow,document:startupDocument,console,Date,Map,Set,Promise,JSON,Math,Number,String,Array,Object,RegExp,Error,Intl,URL,Blob,FormData,setTimeout,clearTimeout});
assert.ok(startupWindow.OperationsCenterV1,'支出模組即使暫時沒載入，營運中心也不得白畫面');

console.log('operations expense allocation tests passed');
