'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module'),vm=require('vm');
const {database}=require('./helpers/security-fixtures.cjs');
const root=path.resolve(__dirname,'..'),memory=database();
const fixture=fs.readFileSync(path.join(__dirname,'course-portal.test.js'),'utf8');
// Only external identity/schedule reads are replaced. The production attendance
// transaction, payroll calculation, duplicate locks and persisted rows are real.
const backend=fs.readFileSync(path.join(root,'functions/coursePortal.js'),'utf8')+`
let testScenario;
currentTaipeiDay=()=> '2026-10-21';
requireSession=async()=>({role:'teacher',teacherId:testScenario.event.teacherId});
teacherAttendanceEvent=async()=>({event:testScenario.event,sourceDate:testScenario.event.date,sourceEventId:testScenario.event.id,sourceCourseId:testScenario.event.fixedCourseId});
attendancePeriodsForEvent=async(event,date)=>{
 const studentId=event.studentIds[0];
 const period=attendancePeriodCandidate([testScenario.period],event,studentId,date);
 if(!period)throw Error('No matching period');
 const units=eventLessonUnits(event),allocations=[{periodId:period.id,lessonUnits:units}];
 return {rows:[{studentId,period,lessonUnits:units}],byStudent:{[studentId]:period},allocationsByStudent:{[studentId]:allocations},rollovers:[]};
};
module.exports.check={set:value=>testScenario=value,run:applyTeacherAttendance,label:teacherLessonPlanLabels};`;
const context={root,backend,Module,require,module,path};vm.createContext(context);
vm.runInContext(fixture.slice(fixture.indexOf('function backendFixtureDocument('),fixture.indexOf('function mirrorFixture(')),context);
context.createBackendFixtureDb=()=>memory.db;
const api=context.loadBackendForScheduleTests({collections:{}}).check;
function scenario(teacherId,subjectId){
 const period={id:'free-period',studentId:'student',teacherId,subjectId,lessonCount:2,usedCount:0,voidedLessonCount:1,startDate:'2026-10-21',expectedAmount:0,discount:0,planSnapshot:{name:'免費課程',amount:0,lessonCount:2,splitType:'none',splitValue:0}};
 const event={id:'lesson',sourceId:'lesson',fixedCourseId:'course',studentIds:['student'],studentNames:['測試學生'],teacherId,subjectId,date:'2026-10-21',startTime:'18:00',endTime:'19:00',status:'scheduled'};
 return {event,period};
}
test('all subject IDs and teacher identities can commit free attendance once, with label retained',async()=>{
 for(const teacherId of ['teacher-a','teacher-b','new-teacher'])for(let subject=1;subject<=19;subject++){
  memory.rows.clear();const s=scenario(teacherId,'subject-'+subject);api.set(s);
  const preview=await api.run({attendancePreview:true},false);assert.equal(preview.ok,true);assert.equal(memory.rows.size,0);
  const result=await api.run({attendancePreview:false},false);assert.equal(result.ok,true);
  const records=[...memory.rows.entries()].filter(([key])=>key.startsWith('coursePortalAttendanceRecords/')).map(([,row])=>row);
  const payroll=[...memory.rows.entries()].filter(([key])=>key.startsWith('coursePortalTeacherAttendancePayroll/')).map(([,row])=>row);
  assert.equal(records.length,1);assert.equal(records[0].status,'attended');assert.equal(records[0].teacherId,teacherId);
  assert.equal(records[0].subjectId,s.event.subjectId);assert.equal(records[0].lessonUnits,1);assert.equal(records[0].periodId,s.period.id);
  assert.equal(payroll.length,1);assert.equal(payroll[0].teacherAmount,0);assert.equal(payroll[0].lessonPrice,0);
  const display=api.label([{...s.event,status:'attended'}],{student:{periods:[s.period],attendance:records}});
  assert.equal(display[0].lessonPlanLabel,'免費課程');
  const before=memory.rows.size;await assert.rejects(api.run({attendancePreview:false},false),/已經完成簽到|已經記錄/);assert.equal(memory.rows.size,before);
 }
});
test('invalid free-plan data does not commit attendance or payroll',async()=>{
 memory.rows.clear();const s=scenario('teacher-a','any-new-subject');delete s.period.planSnapshot.splitValue;api.set(s);
 await assert.rejects(api.run({attendancePreview:false},false));assert.equal(memory.rows.size,0);
});
