'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const sandbox={module:{exports:{}},exports:{},console,Buffer,Intl,Date,require:name=>{
 if(name==='firebase-admin')return{apps:[{}],firestore:()=>({})};
 if(name==='firebase-functions/v2/https')return{onCall:()=>{},HttpsError:Error};
 if(name==='firebase-functions/params')return{defineSecret:()=>({value:()=>''})};
 return require(name.startsWith('.')?path.join(__dirname,'../functions',name):name);
}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../functions/injiaoyunEducationPreview.js'),'utf8'),sandbox);
const build=sandbox.module.exports.buildRecentMasterAdditions;
const envelope=(sourceType,raw)=>({sourceType,raw});
const charge={_id:'charge',name:'group',money:3600,courseNumber:4,allot:0.6,leaveDelay:true,subject:{_id:'subject',name:'guitar'}};
const payment={_id:'payment',created:'2026-09-04',student:'student',subject:charge.subject,chargeType:charge,money:3600,payList:[]};
const raw=()=>[envelope('student',{_id:'student',name:'new group',created:'2026-09-04'}),envelope('charge',charge),envelope('student-payments-open',payment),envelope('fixed-course',{_id:'course',students:['student'],studentPayments:['payment'],teacher:'teacher',subject:'subject'})];
test('new unpaid group retains exact tuition and split without manufacturing a receipt',()=>{
 const result=build(raw(),[],[],'2026-09-01','2026-09-06','2026-07-21');
 assert.equal(result.students.length,1);assert.equal(result.periods.length,1);
 const p=result.periods[0];assert.equal(p.expectedAmount,3600);assert.equal(p.lessonCount,4);assert.equal(p.planSnapshot.splitValue,0.6);assert.equal(p.teacherId,'teacher');assert.equal(p.transactions.length,0);
});
test('existing masters are never duplicated or replaced and out-of-range creations are excluded',()=>{
 const existing=build(raw(),[{id:'student'}],[{sourcePaymentId:'payment'}],'2026-09-01','2026-09-06','2026-07-21');
 assert.equal(existing.students.length,0);assert.equal(existing.periods.length,0);
 for(const created of ['2026-07-20','2026-09-07']){
  const result=build([envelope('student',{_id:'student',created}),envelope('student-payments-open',{...payment,created})],[],[],'2026-09-01','2026-09-06','2026-07-21');
  assert.equal(result.students.length,0);assert.equal(result.periods.length,0);
 }
});
test('baseline counts only earlier valid source check-ins, leaving current batch for reconciliation',()=>{
 const p={...payment,created:'2026-08-01',checkins:[{_id:'before',date:'2026-08-30'},{_id:'canceled',date:'2026-08-31',cancel:true},{_id:'current',date:'2026-09-05'}]};
 const result=build([envelope('charge',charge),envelope('student-payments-open',p)],[],[],'2026-09-01','2026-09-06','2026-07-21');
 assert.equal(result.periods[0].usedCount,1);
});
