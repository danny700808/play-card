'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx={window:{},console};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'..','course-scheduler-data.js'),'utf8'),ctx);
const api=ctx.window.YouziCoursePreviewData;
const course={id:'series',date:'2026-10-15',start:'16:30',duration:60,frequencyWeeks:1,roomId:'r',teacherId:'t',subjectId:'q',studentIds:['s'],studentNames:['Student'],active:true};
const payload={rooms:[{id:'r',name:'Room'}],teachers:[{id:'t',name:'Teacher'}],subjects:[{id:'q',name:'Subject'}],students:[{id:'s',name:'Student'},{id:'other',name:'Other'}],fixedCourses:[course]};
const stop={studentId:'s',teacherId:'t',subjectId:'q',effectiveDate:'2026-10-22',status:'active'};

test('payroll uses the recorded subject name without changing the amount or zero split',()=>{
 const rows=[{id:'paid',teacherId:'t',date:'2026-09-16',subjectName:'木吉他',teacherAmount:420,allotRate:0.6},
 {id:'zero',teacherId:'t',date:'2026-09-15',subjectName:'木吉他',splitType:'none',splitValue:0,teacherAmount:0},
 {id:'legacy',teacherId:'t',date:'2026-09-01',chargeName:'外聘2800',teacherAmount:420}];
 const state=api.buildState({...payload,teacherPayroll:rows},'2026-09-16');
 assert.deepEqual(Array.from(state.teacherPayroll,r=>[r.subject,r.teacherAmount]),[['木吉他',420],['木吉他',0],['外聘2800',420]]);
 assert.equal(state.teacherPayroll[0].allotRate,0.6);
});
test('ended legacy series cannot reappear on an anchor after its end',()=>{
 const state=api.buildState({...payload,fixedCourses:[{...course,recurrenceEndDate:'2026-10-14'}]},'2026-10-15');
 assert.equal(state.events.length,0);
});
test('teacher stop applies to future generated lessons and audited rows',()=>{
 const state=api.buildState({...payload,stoppedCourseReceivables:[stop],events:[{...course,id:'exact',date:'2026-10-29'}],dataQuality:{auditCoveredDates:['2026-10-29']}},'2026-10-15');
 assert(state.events.some(e=>e.date==='2026-10-15'));
 assert(!state.events.some(e=>e.date>='2026-10-22'));
});
test('stops retain other group students and ignore other teachers or subjects',()=>{
 const state=api.buildState({...payload,fixedCourses:[{...course,studentIds:['s','other'],studentNames:['Student','Other']}],stoppedCourseReceivables:[stop]},'2026-10-15');
 const future=state.events.find(e=>e.date==='2026-10-22');
 assert.deepEqual(Array.from(future.studentIds),['other']);assert.deepEqual(Array.from(future.studentNames),['Other']);
 for(const change of [{teacherId:'another'},{subjectId:'another'},{status:'resolved'}]){
  const result=api.buildState({...payload,stoppedCourseReceivables:[{...stop,...change}]},'2026-10-15');
  assert(result.events.some(e=>e.date==='2026-10-22'));
 }
});
test('irregular transition hides uncompleted placeholders but preserves attended and single lessons',()=>{
 const mode={teacherId:'t',subjectId:'q',studentIds:['s'],effectiveDate:'2026-10-15',enabled:true};
 const events=['scheduled','leave','attended','absent'].map((status,i)=>({...course,id:'e'+i,date:'2026-10-15',start:(12+i)+':00',status}));
 events.push({...course,id:'single',date:'2026-10-15',start:'18:00',status:'scheduled',portalAction:'single_move'});
 const state=api.buildState({...payload,irregularCourses:[mode],events,dataQuality:{auditCoveredDates:['2026-10-15']}},'2026-10-15');
 assert.deepEqual(Array.from(state.events.filter(e=>e.date==='2026-10-15').map(e=>e.id)).sort(),['e2','e3','single']);
});
test('fortnightly final schedule continues in the same phase',()=>{
 const state=api.buildState({...payload,fixedCourses:[{...course,frequencyWeeks:2}]},'2026-10-15');
 assert(state.events.some(e=>e.date==='2026-10-29'));
 assert(!state.events.some(e=>e.date==='2026-10-22'));
});
