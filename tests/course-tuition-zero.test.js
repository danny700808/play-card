'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
test('a zero tuition price remains zero even when the old plan price is nonzero',()=>{
 const source=fs.readFileSync(require('path').join(__dirname,'../course-scheduler-data.js'),'utf8'),start=source.indexOf('  function normalizePeriods('),end=source.indexOf('\n  }',start)+4;
 const c={array:v=>Array.isArray(v)?v:[],clean:v=>String(v??''),numberOf:v=>Number(v)||0,dateKey:v=>String(v||''),safeId:(a,id)=>id,clone:v=>JSON.parse(JSON.stringify(v)),planSnapshot:()=>({amount:3600,lessonCount:4}),normalizeTransactions:()=>[]};vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 const row=c.normalizePeriods({tuitionPeriods:[{id:'p',studentId:'s',lessonCount:4,expectedAmount:0,voidedLessonCount:1,lessonAdjustments:[{slotNo:4,type:'void'}]}]},[])[0];assert.equal(row.expectedAmount,0);assert.equal(row.voidedLessonCount,1);assert.equal(row.lessonAdjustments.length,1);
});
