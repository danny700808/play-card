'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fakeDb}=require('./payroll-test-db.cjs');
const {createPayrollNotices,bindingTarget}=require('../functions/payrollNotices');
const line='U'+'a'.repeat(32);
function fixture(){
 const db=fakeDb({'coursePortalRuntime/scheduleVersion':{version:1},'opsEducationMirrorTeachers/t':{source:{id:'t',name:'老師甲'}},'coursePortalTeacherBindings/b':{teacherId:'t',status:'active',lineUserId:line},'coursePayrollTransferSettings/bankAccounts':{accounts:[{teacherId:'t',account:'001234'}]}});
 const pay={teacherPayoutPayroll:[{teacherId:'t',teacherAmount:420}],teacherPayoutAdjustments:[{teacherId:'t',type:'late_attendance_fee',amount:-50}],payout:{expectedPayDate:'2026-10-10'}};
 let now=100000;
 const api=createPayrollNotices({db,loadPayroll:async()=>pay,now:()=>now});
 return {db,pay,api,advance:()=>{now+=31*60000;},preview:()=>api({action:'notice-preview',month:'2026-09',transferDate:'2026-01-01'},'admin')};
}
const send=(f,p)=>f.api({action:'notice-send',month:'2026-09',previewId:p.previewId,teacherIds:['t'],confirmedTransferred:true},'admin');
test('preview has exact net amount, hides LINE identifiers and creates no notification',async()=>{
 const f=fixture(),p=await f.preview();assert.equal(p.rows[0].amount,370);assert(p.rows[0].eligible);assert(!JSON.stringify(p).includes(line));assert.match(p.rows[0].body,/NT\$370/);assert(![...f.db.records.keys()].some(k=>k.startsWith('notificationQueue/')));
});
test('two simultaneous sends create exactly one immutable paid record and one notification',async()=>{
 const f=fixture(),p=await f.preview();const results=await Promise.all([send(f,p),send(f,p)]);assert.equal(results.reduce((n,r)=>n+r.queued,0),1);
 assert.equal([...f.db.records.keys()].filter(k=>k.startsWith('notificationQueue/')).length,1);assert.equal([...f.db.records.keys()].filter(k=>k.startsWith('coursePayrollPaidBatches/')).length,1);
 const next=await f.preview();assert(!next.rows[0].eligible);assert(next.rows[0].alreadyQueued);
});
test('changed salary, binding and expired preview block sending',async()=>{
 for(const kind of ['amount','binding','expiry']){const f=fixture(),p=await f.preview();if(kind==='amount')f.pay.teacherPayoutPayroll[0].teacherAmount=500;if(kind==='binding')f.db.records.set('coursePortalTeacherBindings/b',{teacherId:'t',status:'inactive',lineUserId:line});if(kind==='expiry')f.advance();await assert.rejects(send(f,p));assert(![...f.db.records.keys()].some(k=>k.startsWith('notificationQueue/')));}
});
test('missing confirmation or actor cannot send, and previews belong to their creator',async()=>{
 const f=fixture(),p=await f.preview();await assert.rejects(f.api({action:'notice-send',month:'2026-09',previewId:p.previewId,teacherIds:['t']},'admin'));
 await assert.rejects(f.api({action:'notice-preview',month:'2026-09',transferDate:'2026-01-01'},''));
 await assert.rejects(f.api({action:'notice-send',month:'2026-09',previewId:p.previewId,teacherIds:['t'],confirmedTransferred:true},'other'));
});
test('ambiguous/shared LINE bindings and unbanked teachers are not eligible',async()=>{
 assert(bindingTarget([{teacherId:'t',status:'active',lineUserId:line},{teacherId:'other',status:'active',lineUserId:line}],'t').reason);
 const f=fixture();f.db.records.set('coursePayrollTransferSettings/bankAccounts',{accounts:[]});assert(!(await f.preview()).rows[0].eligible);
});
test('version changes during payroll read invalidate preview',async()=>{
 const f=fixture();const api=createPayrollNotices({db:f.db,loadPayroll:async()=>{f.db.records.set('coursePortalRuntime/scheduleVersion',{version:2});return f.pay;}});
 await assert.rejects(api({action:'notice-preview',month:'2026-09',transferDate:'2026-01-01'},'admin'),/重新預覽/);
});
