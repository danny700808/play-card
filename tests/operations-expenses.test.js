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
assert.match(operationsSource,/每月沒變動就不用重複登錄/,'支出頁必須清楚說明月份沿用方式');
assert.match(operationsSource,/按月支出只分攤到非星期一的營業日/,'支出頁必須說明星期一不分攤');
assert.match(operationsSource,/const body=operatingExpenseRuleNoticeHtml\(\)\+'<div class="ops-expense-detail-head">/,'扣款規則說明必須位於支出明細頁最上方');
assert.match(operationsHubSource,/href="#expenses" data-view="expenses"/,'左側選單必須有獨立營運支出入口');
assert.match(operationsHubSource,/>營運支出</,'左側選單必須明確標示營運支出');
assert.match(formalPortalSource,/href="#expenses" data-view="expenses"/,'正式入口的左側選單也必須有營運支出');
assert.match(formalPortalSource,/operations-expenses\.js\?v=20260801-operating-expenses-v3/,'正式入口必須先載入支出分攤程式');
assert.match(formalPortalSource,/operations-phase1\.js\?v=20260801-expense-master-v27/,'正式入口必須使用新版主程式快取號');
assert.match(operationsSource,/expenses:renderOperatingExpensesPage/,'營運支出入口必須顯示獨立右側頁面');
assert.match(operationsSource,/id="operatingExpenseMonth"/,'營運支出頁必須可以選擇查詢月份');
assert.match(operationsSource,/data-action="expense-month-shift"/,'營運支出頁必須可以切換前後月份');
assert.match(operationsSource,/支出主表/,'營運支出頁必須用單一月份主表管理');
assert.match(operationsSource,/data-action="expense-plan-edit"/,'每月延續項目必須可從主表直接修改');
assert.match(operationsSource,/data-action="expense-record-edit"/,'帳單與單次支出必須可從主表直接修改');
assert.doesNotMatch(operationsSource,/data-action="operating-expense-settings">固定費用設定/,'支出頁不得再顯示獨立固定費用設定入口');
assert.match(operationsSource,/一次性支出依實際發生日保留/,'星期一仍必須保留一次性實際支出');

const startupDocument={readyState:'loading',addEventListener:function(){}};
const startupWindow={document:startupDocument};
startupWindow.window=startupWindow;
vm.runInNewContext(operationsSource,{window:startupWindow,document:startupDocument,console,Date,Map,Set,Promise,JSON,Math,Number,String,Array,Object,RegExp,Error,Intl,URL,Blob,FormData,setTimeout,clearTimeout});
assert.ok(startupWindow.OperationsCenterV1,'支出模組即使暫時沒載入，營運中心也不得白畫面');

console.log('operations expense allocation tests passed');
