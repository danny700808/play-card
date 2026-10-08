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

const {profileId,noticeBody,lateReminders}=require('../functions/payrollNotices');
test('both channels receive one notification; email alone is eligible',async()=>{
 for(const both of [true,false]){const f=fixture();f.db.records.set('teacherPrivateProfiles/'+profileId('t'),{email:'teacher@example.com'});if(!both)f.db.records.delete('coursePortalTeacherBindings/b');const p=await f.preview();assert(p.rows[0].eligible);await send(f,p);const q=[...f.db.records.entries()].filter(([k])=>k.startsWith('notificationQueue/')).map(([,v])=>v);assert.equal(q.length,both?2:1);assert(q.some(r=>r.channel==='email'&&r.targetEmail==='teacher@example.com'));assert.equal((await f.preview()).rows[0].eligible,false);}
});
test('adding email after a LINE notice sends only email and keeps the original payment',async()=>{
 const f=fixture();await send(f,await f.preview());f.db.records.set('teacherPrivateProfiles/'+profileId('t'),{email:'teacher@example.com'});const p=await f.api({action:'notice-preview',month:'2026-09',transferDate:'2026-02-02'},'admin');assert(p.rows[0].eligible);assert.match(p.rows[0].body,/2026\/01\/01/);assert.equal((await send(f,p)).queued,1);assert.equal([...f.db.records.keys()].filter(k=>k.startsWith('coursePayrollPaidBatches/')).length,1);
});
test('changed email invalidates preview; malformed email is not used',async()=>{
 const f=fixture(),key='teacherPrivateProfiles/'+profileId('t');f.db.records.set(key,{email:'teacher@example.com'});const p=await f.preview();f.db.records.set(key,{email:'other@example.com'});await assert.rejects(send(f,p));f.db.records.delete('coursePortalTeacherBindings/b');f.db.records.set(key,{email:'invalid'});assert(!(await f.preview()).rows[0].eligible);
});
test('simple notification includes bank timing without links or supplement reminders',()=>{
 const pay={teacherPayroll:[{teacherId:'t',date:'2026-09-28',attendanceSignedAt:'2026-10-10 00:00:00',expectedPayDate:'2026-11-10'},{teacherId:'other',date:'2026-09-28',attendanceSignedAt:'2026-10-03',expectedPayDate:'2026-10-10'}]};
 const body=noticeBody({name:'甲',amount:420,lateReminders:lateReminders(pay,'t')},'2026-09','2026-10-10');assert.match(body,/2026 年 9 月薪資/);assert.match(body,/依銀行作業為準/);assert.doesNotMatch(body,/https?:|結算批次|補簽|補登|預計|2026\/11\/10/);
});

test('previously opened previews cannot send the removed reminder to either channel',async()=>{
 const f=fixture();f.db.records.set('teacherPrivateProfiles/'+profileId('t'),{email:'teacher@example.com'});const p=await f.preview();const key='coursePayrollNoticePreviews/'+p.previewId;const saved=f.db.records.get(key);saved.rows[0].body+='\n補簽發放提醒：old reminder';await send(f,p);const queues=[...f.db.records.entries()].filter(([k])=>k.startsWith('notificationQueue/'));assert.equal(queues.length,2);queues.forEach(([,r])=>assert.doesNotMatch(r.body,/補簽|old reminder/));
});
