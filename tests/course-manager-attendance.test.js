'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const source=fs.readFileSync(require('path').join(__dirname,'../functions/coursePortal.js'),'utf8');
function fixture(original){
 const docs=new Map([['version',{version:1}]]),event={id:'event',sourceId:'event',fixedCourseId:'course',date:'2026-09-01',teacherId:'teacher',studentIds:['student'],subjectId:'guitar',tuitionPeriodId:'newer-period',startTime:'18:00',endTime:'19:00',roomId:'room'};
 const ref=path=>({path,id:path.split('/').at(-1)}),snapshot=r=>({exists:docs.has(r.path),data:()=>docs.get(r.path)});
 const c={db:{collection:name=>({doc:id=>ref(name+'/'+id)}),runTransaction:async work=>{let writing=false;await work({get:async r=>{assert(!writing);return snapshot(r);},set:(r,d,o)=>{writing=true;docs.set(r.path,o?.merge?{...docs.get(r.path),...d}:d);}});}},
 attendanceLessonUnits:r=>Number(r?.lessonUnits)||1,attendanceAllocations:r=>r?.periodAllocations||[{periodId:r?.periodId,lessonUnits:Number(r?.lessonUnits)||1}],clean:v=>String(v??'').trim(),hash:v=>crypto.createHash('sha256').update(v).digest('hex'),
 HttpsError:class extends Error{},FieldValue:{serverTimestamp:()=>1},
 ATTENDANCE_RECORDS:'attendance',ATTENDANCE_PAYROLL:'payroll',ATTENDANCE_CANCELLATIONS:'cancellations',
 readScheduleVersion:async()=>1,scheduleVersionRef:()=>ref('version'),assertScheduleWritable:s=>{if(s.data().writesBlocked)throw Error('blocked');},
 teacherAttendanceEvent:async()=>({event,sourceDate:event.date,sourceEventId:event.id,sourceCourseId:'course'}),
 attendanceOperationId:()=> 'operation',attendanceLineage:()=> 'course',attendanceLessonLockId:()=> 'lock',eventStudentIds:e=>e.studentIds,
 attendanceChangePayload:(e,d,ei,ci,ti,status)=>({id:'change',event:{...e,status}}),normalizeScheduleStatus:v=>v,
 mirrorRowsByDateRange:async()=>original?[original]:[],attendanceRowsMatch:(a,b)=>a.studentId===b.studentId&&a.sourceCourseId===b.courseId,
 applyTeacherAttendance:async (data,late,session)=>({ok:true,teacherId:session.teacherId,late})};
 vm.createContext(c);let start=source.indexOf('async function adminSetAttendance(');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),c);return{c,docs};
}
test('manager cancellation restores the original period and leaves financial transactions untouched',async()=>{
 const f=fixture({studentId:'student',sourceCourseId:'course',periodId:'original-period',status:'attended',deducted:true});
 await f.c.adminSetAttendance({teacherId:'teacher',status:'scheduled'});
 const attendance=[...f.docs].find(([k])=>k.startsWith('attendance/'))[1];assert.equal(attendance.periodId,'original-period');assert.equal(attendance.active,false);
 assert.equal(f.docs.get('payroll/operation').active,false);
 assert(![...f.docs.keys()].some(k=>/transactions|payment|refund/i.test(k)));
});
test('changing an unsigned future lesson does not create fake cancellation credits or wage locks',async()=>{
 const f=fixture();await f.c.adminSetAttendance({teacherId:'teacher',status:'leave'});
 assert.equal(f.docs.get('coursePortalScheduleChanges/change').event.status,'leave');
 assert(![...f.docs.keys()].some(k=>/attendance\/|payroll\/|cancellations\/|AttendanceLessonLocks/.test(k)));
});
test('manager attendance uses the shared server attendance handler with no late fee mode',async()=>{
 const f=fixture();const result=await f.c.adminSetAttendance({teacherId:'teacher',status:'attended'});
 assert.equal(result.teacherId,'teacher');assert.equal(result.late,false);
 assert.match(source,/coursePortalAdminSetAttendance = callable\(async \(data, request\) => \{ assertAdminPin\(request\); return adminSetAttendance\(data\)/);
});
