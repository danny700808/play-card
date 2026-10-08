'use strict';
// Read only. Trace the previously identified single September 10 time ambiguity.
// Do not log names, identifiers, contacts, salary, tokens or login information.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const report=console.log.bind(console);console.log=console.info=console.warn=console.error=()=>{};
const filename=path.resolve('functions/coursePortal.js'),backend=new Module(filename,module);
backend.filename=filename;backend.paths=Module._nodeModulePaths(path.dirname(filename));
backend._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.trace={db,withPortalReads,mirrorRowsByDateRange,scheduleBundle,teacherPayrollStudentIds,eventStudentIds,eventDate,eventStart,eventEnd,ATTENDANCE_RECORDS,ATTENDANCE_PAYROLL,sourceId};',filename);
const a=backend.exports.trace;
async function main(){
 const date='2026-09-10';
 const [payroll,mirror,board]=await Promise.all([a.mirrorRowsByDateRange('teacherPayroll',date,date),a.mirrorRowsByDateRange('attendance',date,date),a.scheduleBundle(date,date,'',{adminDelta:true})]);
 const sameStudents=(x,y)=>JSON.stringify(a.teacherPayrollStudentIds(x).sort())===JSON.stringify(a.teacherPayrollStudentIds(y).sort());
 const targets=payroll.filter(p=>{
  const es=board.resourceEvents.filter(e=>e.date===date&&e.teacherId===p.teacherId&&sameStudents(p,e));
  return es.length===2&&es.some(e=>e.startTime==='14:00'&&e.endTime==='15:00')&&es.some(e=>e.startTime==='19:00'&&e.endTime==='20:00');
 });
 if(targets.length!==1)throw Error('target is not unique');
 const target=targets[0],studentIds=a.teacherPayrollStudentIds(target);
 const nativeSnapshots=await Promise.all(studentIds.map(id=>a.db.collection(a.ATTENDANCE_RECORDS).where('studentId','==',id).get()));
 const paySnapshot=await a.db.collection(a.ATTENDANCE_PAYROLL).where('teacherId','==',target.teacherId).get();
 const changes=await a.db.collection('coursePortalScheduleChanges').where('sourceDate','==',date).get();
 const rows=nativeSnapshots.flatMap(s=>s.docs.map(d=>d.data())).filter(r=>a.eventDate(r)===date||r.originalLessonDate===date);
 const summarize=r=>({date:a.eventDate(r),status:['attended','cancelled','scheduled','leave','absent'].includes(r.status)?r.status:'other',active:r.active!==false,start:a.eventStart(r),end:a.eventEnd(r),hasRecordedTimestamp:!!(r.attendanceRecordedAtText||r.createdAtText||r.createdAt),hasOperationId:!!r.operationId,teacherMatches:r.teacherId===target.teacherId,sourceIsTeacherAttendance:['teacher-attendance','teacher-late-attendance'].includes(r.source)});
 report(JSON.stringify({kind:'teacher-side-primary-attendance',matchingRecords:rows.length,records:rows.map(summarize)}));
 report(JSON.stringify({kind:'teacher-side-payroll',records:paySnapshot.docs.map(d=>d.data()).filter(r=>a.eventDate(r)===date&&a.teacherPayrollStudentIds(r).some(id=>studentIds.includes(id))).map(summarize)}));
 report(JSON.stringify({kind:'teacher-signin-schedule-actions-including-inactive',records:changes.docs.map(d=>d.data()).filter(r=>r.action==='lesson_status'&&r.event&&r.event.teacherId===target.teacherId&&a.eventStudentIds(r.event).some(id=>studentIds.includes(id))).map(r=>({...summarize(r.event),changeActive:r.active!==false,createdByTeacher:r.createdByTeacherId===target.teacherId}))}));
 report(JSON.stringify({kind:'retained-attendance-used-by-course-history',records:mirror.filter(r=>sameStudents(r,target)&&(!r.teacherId||r.teacherId===target.teacherId)).map(summarize)}));
}
a.withPortalReads(main)().catch(()=>{report('Read-only teacher attendance trace failed; no record values logged.');process.exitCode=1;});
