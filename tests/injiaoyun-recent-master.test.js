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
const refresh=sandbox.module.exports.buildRecentMasterRefresh;
const complete=(payments)=>[envelope('charge',charge),envelope('student',{_id:'student',name:'group'}),...payments.map(p=>envelope('student-payments-all',p))];
test('complete refresh includes old periods paid after cutoff and preserves numbering',()=>{
 const payments=Array.from({length:7},(_,i)=>({...payment,_id:`payment${i+1}`,created:`2026-0${i<6?i+1:9}-01`,payList:i===5?[{_id:'receipt6',money:1800,date:'2026-08-11'}]:[]}));
 const result=refresh(complete(payments),'2026-07-21','2026-09-07');
 assert.deepEqual(Array.from(result.periods,p=>p.periodNo),[6,7]);
 assert.equal(result.periods[0].transactions[0].amount,1800);
 assert.equal(result.sourcePeriodCount,7);
});
test('complete refresh replaces paid closed metadata without inventing receipts on unpaid periods',()=>{
 const result=refresh(complete([{...payment,end:true,payList:[{_id:'paid',money:3600,date:'2026-09-05'}]}, {...payment,_id:'unpaid'}]),'2026-07-21','2026-09-07');
 assert.equal(result.periods[0].transactions.length,1);
 assert.equal(result.periods[1].transactions.length,0);
 assert.equal(result.periods[1].lessonCount,4);
});
test('complete refresh uses each historical split and deduplicates/cancels attendance',()=>{
 const check={_id:'attend',date:'2026-09-05'};
 const result=refresh(complete([{...payment,chargeType:{...charge,allot:0.5},checkins:[check,check,{_id:'canceled',date:'2026-09-06',cancel:true}]}]),'2026-07-21','2026-09-07');
 assert.equal(result.periods[0].planSnapshot.splitValue,0.5);
 assert.equal(result.periods[0].usedCount,1);
});
test('complete refresh rejects open-only evidence and excludes untouched old periods',()=>{
 assert.throws(()=>refresh(raw(),'2026-07-21','2026-09-07'),/Complete payment source/);
 assert.equal(refresh(complete([{...payment,created:'2026-07-20'}]),'2026-07-21','2026-09-07').periods.length,0);
});
test('payment channel flags never manufacture a one-dollar receipt',()=>{
 const result=refresh(complete([{...payment,payList:[],cash:true,card:true,online:true,pay1:false}]),'2026-07-21','2026-09-07');
 assert.equal(result.periods[0].transactions.length,0);
});
test('reference-only attendance is flagged instead of overwriting usage with zero',()=>{
 const result=refresh(complete([{...payment,checkins:['checkin-id']}]),'2026-07-21','2026-09-07');
 assert.equal(result.periods[0].usedCount,undefined);
 assert.equal(result.incompleteAttendancePeriodIds.length,1);
});
test('cash flag on an actual money receipt preserves its method',()=>{
 const result=refresh(complete([{...payment,payList:[{money:3600,cash:true,date:'2026-09-05'}]}]),'2026-07-21','2026-09-07');
 assert.equal(result.periods[0].transactions[0].method,'現金');
});
test('expanded legacy refund is retained separately and payByDis is preserved',()=>{
 const result=refresh(complete([{...payment,payByDis:false,payList:[{money:3600,date:'2026-09-05'}],refund:{_id:'refund',money:700,created:'2026-09-06'}}]),'2026-07-21','2026-09-07');
 assert.equal(result.periods[0].transactions.filter(t=>t.type==='refund')[0].amount,700);
 assert.equal(result.periods[0].planSnapshot.teacherPayBasis,'gross');
});
test('a refund reference without its amount blocks a complete financial acceptance',()=>{
 const result=refresh(complete([{...payment,refund:'refund-id'}]),'2026-07-21','2026-09-07');
 assert.equal(result.incompleteRefundPeriodIds.length,1);
});
