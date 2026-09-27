'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../functions/coursePortal.js'),'utf8');
const context={
  clean:x=>String(x??'').trim(),dateKey:x=>String(x??'').slice(0,10),
  sourceId:x=>x.id||x.__id||'',eventDate:x=>x.date||'',eventSubjectId:x=>x.subjectId||'',
  eventTeacherId:x=>x.teacherId||'',eventStudentIds:x=>x.studentIds||[x.studentId],
  tuitionPeriodNumber:x=>Number(x.periodNo),tuitionUsedCount:x=>Number(x.usedCount||0),
  tuitionLessonCount:x=>Number(x.lessonCount||4),normalizeScheduleStatus:x=>x,
  attendanceRowsMatch:(a,b)=>a.studentId===b.studentId&&a.date===b.date&&a.courseId===b.courseId,
  HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}}
};
vm.createContext(context);
for(const name of ['attendanceLessonUnits','attendanceAllocations','tuitionPeriodAvailable','tuitionPeriodUsableIdentity','attendancePeriodMatches','newestAttendancePeriod','attendancePeriodCandidate','attendancePeriodsWithRecordedTeachers','attendanceRolloverSourcePeriod']){
  const start=source.indexOf('function '+name+'(');
  assert(start>=0,name);vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
}
const event={studentIds:['s'],teacherId:'t',subjectId:'drums',date:'2026-09-27',roomId:'new-room',fixedCourseId:'moved-course'};
const periods=[{id:'p4',studentId:'s',subjectId:'drums',teacherId:'t',periodNo:4,usedCount:4,lessonCount:4},{id:'p5',studentId:'s',subjectId:'drums',teacherId:'',periodNo:5,usedCount:4,lessonCount:4}];
const record={studentId:'s',subjectId:'drums',teacherId:'t',date:'2026-09-23',periodId:'p5',status:'attended',active:true,courseId:'original-course',roomId:'old-room'};
function choose(rows,e=event){return context.attendanceRolloverSourcePeriod({periods:rows,event:e,studentId:'s',sourceDate:e.date});}
test('completed legacy period renews from period 5 after teacher move and manager room move',()=>{
  const identified=context.attendancePeriodsWithRecordedTeachers(periods,[],[record],event.date);
  assert.equal(identified[1].teacherId,'t');assert.equal(periods[1].teacherId,'');
  for(const e of [event,{...event,roomId:'old-room',fixedCourseId:'original-course'}])assert.equal(choose(identified,e).id,'p5');
});
test('missing latest teacher never silently rolls back to a settled earlier period',()=>{
  assert.throws(()=>choose(periods),/最新一期/);
});
test('ambiguous, cancelled, future, different student or subject evidence cannot infer a teacher',()=>{
  for(const records of [[record,{...record,teacherId:'other'}],[{...record,active:false}],[{...record,status:'cancelled'}],[{...record,date:'2026-10-01'}],[{...record,studentId:'other'}],[{...record,subjectId:'piano'}],[{...record,periodId:'p4'}]]){
    const rows=context.attendancePeriodsWithRecordedTeachers(periods,[],records,event.date);
    assert.equal(rows[1].teacherId,'');assert.throws(()=>choose(rows),/最新一期/);
  }
});
test('portal cancellation suppresses stale mirror evidence and explicit identity stays intact',()=>{
  const rows=context.attendancePeriodsWithRecordedTeachers(periods,[record],[{...record,status:'cancelled',active:false}],event.date);
  assert.equal(rows[1].teacherId,'');assert.equal(rows[0].teacherId,'t');
});
test('cross-period lesson evidence applies only to the actual allocated periods',()=>{
  const rows=context.attendancePeriodsWithRecordedTeachers(periods,[],[{...record,periodId:'p4',periodAllocations:[{periodId:'p4',lessonUnits:.5},{periodId:'p5',lessonUnits:.5}]}],event.date);
  assert.equal(choose(rows).id,'p5');
});
test('legacy attendance without a subject can identify its explicitly linked period teacher',()=>{
  const rows=context.attendancePeriodsWithRecordedTeachers(periods,[{...record,subjectId:''}],[],event.date);
  assert.equal(choose(rows).id,'p5');
});
test('both teacher and manager attendance resolve recorded teachers before rollover',()=>{
  assert.match(source,/const identifiedPeriods = attendancePeriodsWithRecordedTeachers\(periods, mirrorAttendance, portalAttendance, sourceDate\)/);
  assert.match(source,/applyPortalAttendanceToPeriods\(identifiedPeriods, mirrorAttendance, portalAttendance\)/);
});
