'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const runtime={};vm.runInNewContext(fs.readFileSync('course-scheduler-data.js','utf8'),{window:runtime});
const api=runtime.YouziCoursePreviewData;
const mode={enabled:true,teacherId:'t1',subjectId:'piano',studentIds:['s1'],effectiveDate:'2026-09-10',resumedFrom:'2026-09-13'};
test('irregular students follow the teacher and fixed-course effective date without duplicates',()=>{
 assert.equal(api.activeIrregularCourses([mode,mode], '2026-09-12','t1').length,1);
 assert.equal(api.activeIrregularCourses([mode], '2026-09-12','t2').length,0);
 assert.equal(api.activeIrregularCourses([mode], '2026-09-13','t1').length,0);
 assert.equal(api.activeIrregularCourses([{...mode,enabled:false}], '2026-09-12').length,0);
});
test('irregular placeholders disappear while attendance and arranged single lessons remain',()=>{
 const event={teacherId:'t1',subjectId:'piano',studentIds:['s1'],date:'2026-09-12',type:'fixed',status:'scheduled'};
 assert.equal(api.isIrregularPlaceholder(event,[mode]),true);
 assert.equal(api.isIrregularPlaceholder({...event,date:'2026-09-13'},[mode]),false);
 assert.equal(api.isIrregularPlaceholder({...event,status:'attended'},[mode]),false);
 assert.equal(api.isIrregularPlaceholder({...event,portalAction:'extra_lesson'},[mode]),false);
 assert.equal(api.isIrregularPlaceholder({...event,studentIds:['s2']},[mode]),false);
});
test('only new teacher stops enter receivables, irrespective of lesson completion',()=>{
 const period={id:'p1',studentId:'s1',subjectId:'piano',balance:3000,usedCount:1};
 const stop={id:'stop1',studentId:'s1',subjectId:'piano',teacherId:'t1',requestedBy:'teacher',receivableTrackingVersion:'teacher-stop-v1',receivablePeriodsAtStop:[{id:'p1',outstandingAmount:3000}]};
 const select=(stops,periods)=>api.stoppedCourseReceivables(stops,periods,p=>p.balance);
 assert.equal(select([], [{...period,usedCount:4}]).length,0);
 assert.equal(select([{...stop,receivableTrackingVersion:''}], [period]).length,0);
 assert.equal(select([stop], [period]).length,1);
 assert.equal(select([stop,stop],[period]).length,1);
 assert.equal(select([stop],[{...period,balance:0}]).length,0);
 assert.equal(select([stop],[{...period,usedCount:0}]).length,1);
 assert.equal(select([stop],[period,{id:'p2',studentId:'s1',subjectId:'violin',balance:9000}]).length,1);
 assert.equal(select([stop],[])[0].unpaidBalance,3000);
 assert.equal(select([stop],[{...period,subjectId:'violin'}]).length,0);
});
test('subject-specific suspension does not stop a second subject',()=>{
 const src=fs.readFileSync('functions/coursePortal.js','utf8');
 const fn=src.slice(src.indexOf('function suspensionAppliesToEvent('),src.indexOf('function applyStudentSuspensions('));
 const ctx={clean:v=>String(v||''),dateKey:v=>v,eventTeacherId:r=>r.teacherId,eventSubjectId:r=>r.subjectId,eventStudentIds:r=>r.studentIds,eventDate:r=>r.date};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 const stop={teacherId:'t1',studentId:'s1',subjectId:'piano',effectiveDate:'2026-09-11'};
 const event={teacherId:'t1',studentIds:['s1'],subjectId:'piano',date:'2026-09-12'};
 assert.equal(ctx.suspensionAppliesToEvent(stop,event),true);
 assert.equal(ctx.suspensionAppliesToEvent(stop,{...event,subjectId:'violin'}),false);
});
test('new teacher stop captures only its subject debt and duplicate stop does not rewrite it',async()=>{
 const src=fs.readFileSync('functions/coursePortal.js','utf8');
 const fn=src.slice(src.indexOf('async function teacherStopStudent('),src.indexOf('async function teacherAvailability('));
 const records=new Map(),writes=[];
 const courses=[{id:'c1',teacherId:'t1',subjectId:'piano',studentIds:['s1']},{id:'c2',teacherId:'t1',subjectId:'violin',studentIds:['s1']}];
 const periods=[{id:'p1',studentId:'s1',subjectId:'piano',teacherId:'t1',balance:3000},{id:'p2',studentId:'s1',subjectId:'violin',teacherId:'t1',balance:4000}];
 const ctx={requireSession:async()=>({teacherId:'t1'}),dateKey:v=>v,currentTaipeiDay:()=> '2026-09-10',assertPortalAdvanceDate(){},assertInput(){},teacherOwnsStudent:async()=>true,clean:v=>String(v||''),mirrorRows:async type=>type==='students'?[{id:'s1',name:'Student'}]:type==='teachers'?[{id:'t1',name:'Teacher'}]:type==='fixedCourses'?courses:[],mirrorRowsByField:async()=>periods,sourceId:r=>r.id,eventTeacherId:r=>r.teacherId,eventSubjectId:r=>r.subjectId,eventStudentIds:r=>r.studentIds,tuitionOutstandingAmount:r=>r.balance,courseSourceIds:r=>[r.id],hash:v=>v,FieldValue:{serverTimestamp:()=>1,increment:()=>1},nowText:()=> '2026-09-10',scheduleVersionRef:()=>({id:'version'}),HttpsError:Error,db:{collection:()=>({doc:id=>({id,get:async()=>({exists:records.has(id),data:()=>records.get(id)})})}),batch:()=>({set:(ref,row)=>{writes.push(row);if(ref.id!=='version')records.set(ref.id,row)},commit:async()=>{}})}};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 await ctx.teacherStopStudent({studentId:'s1',subjectId:'piano',effectiveDate:'2026-09-10',confirmed:true});
 const stop=records.values().next().value;
 assert.equal(stop.subjectId,'piano');assert.equal(stop.receivableTrackingVersion,'teacher-stop-v1');assert.equal(stop.receivablePeriodsAtStop.map(p=>p.id).join(','),'p1');
 const count=writes.length;await ctx.teacherStopStudent({studentId:'s1',subjectId:'piano',effectiveDate:'2026-09-10',confirmed:true});assert.equal(writes.length,count);
});
