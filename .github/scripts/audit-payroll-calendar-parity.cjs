'use strict';
// Read-only parity audit. Logs contain counts and relationship flags only;
// never names, account details, document IDs, credentials or salary amounts.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const report = console.log.bind(console);
console.log = console.info = console.warn = console.error = () => {};
const filename = path.resolve('functions/coursePortal.js');
const backend = new Module(filename, module);
backend.filename = filename;
backend.paths = Module._nodeModulePaths(path.dirname(filename));
backend._compile(fs.readFileSync(filename, 'utf8') + `
module.exports.audit = {db,mirrorRows,teacherPortalProfileId,teacherUtilityProfileBundle,scheduleBundle,withPortalReads,mirrorRowsByDateRange,portalRowsByDateRange,
mirrorRowsByField,courseSourceIds,eventSubjectId,eventStart,ATTENDANCE_RECORDS,eventStudentIds,eventTeacherId,ATTENDANCE_PAYROLL,ATTENDANCE_CANCELLATIONS,mergeTeacherPayrollRows,enrichTeacherPayrollRows,
teacherPayrollStudentIds,teacherPayrollCourseId,teacherPayrollMinute,eventDate,sourceId};
`, filename);
const a = backend.exports.audit;
const start = '2026-09-01', end = '2026-09-30';
const sameStudents = (p,e) => {
  const left = a.teacherPayrollStudentIds(p).slice().sort();
  const right = (e.studentIds || []).slice().sort();
  return left.length && JSON.stringify(left) === JSON.stringify(right);
};
async function main() {
  const [mirror, attendance, native, cancellations, board] = await Promise.all([
    a.mirrorRowsByDateRange('teacherPayroll',start,end),
    a.mirrorRowsByDateRange('attendance',start,end),
    a.portalRowsByDateRange(a.ATTENDANCE_PAYROLL,start,end),
    a.portalRowsByDateRange(a.ATTENDANCE_CANCELLATIONS,start,end),
    a.scheduleBundle(start,end,'',{adminDelta:true})
  ]);
  const enriched = a.enrichTeacherPayrollRows(mirror,attendance);
  const payroll = a.mergeTeacherPayrollRows(enriched,native,cancellations.filter(r=>r.status==='approved').concat(native.filter(r=>r.active===false)));
  const nativeIds = new Set(native.map(a.sourceId));
  const origin = r => nativeIds.has(a.sourceId(r)) ? 'native' : 'mirror';
  const events = board.resourceEvents.filter(e=>(e.studentIds||[]).length);
  const candidates = p => events.filter(e=>e.date===a.eventDate(p)&&e.teacherId===p.teacherId&&sameStudents(p,e));
  const missing = payroll.filter(p=>!candidates(p).some(e=>e.status==='attended'));
  const nativeAttendance=await a.portalRowsByDateRange(a.ATTENDANCE_RECORDS,start,end);
  const fixed=await a.mirrorRows('fixedCourses');
  const attendanceCandidates=(p,rows)=>rows.filter(r=>a.eventDate(r)===a.eventDate(p)&&(!a.eventTeacherId(r)||a.eventTeacherId(r)===p.teacherId)&&a.eventStudentIds(r).some(id=>a.teacherPayrollStudentIds(p).includes(id)));
  const safeStatus=r=>['attended','scheduled','cancelled','absent','leave'].includes(r.status)?r.status:'other';
  const aliases=new Map();const ref=v=>{if(!v)return '';v=String(v);if(!aliases.has(v))aliases.set(v,'r'+(aliases.size+1));return aliases.get(v);};
  const shape=r=>Object.fromEntries(['id','__id','sourceId','eventId','sourceEventId','courseId','fixedCourseId','sourceCourseId','operationId','periodId','sourcePaymentId'].map(k=>[k,ref(r[k])]).concat([['status',safeStatus(r)],['active',r.active!==false],['start',r.startTime||r.start||''],['end',r.endTime||''],['periodRefs',Object.values(r.periodIds||{}).map(ref)],['sourceAttendanceRef',ref(r.attendanceId)]]));
  for(const [index,p] of missing.entries()) {
    const ma=attendanceCandidates(p,attendance),na=attendanceCandidates(p,nativeAttendance);
    const periods=(await Promise.all(a.teacherPayrollStudentIds(p).map(id=>a.mirrorRowsByField('tuitionPeriods','studentId',id)))).flat();
    report(JSON.stringify({kind:'subjectEvidence',case:index+1,attendance:ma.map(r=>({course:fixed.filter(c=>a.courseSourceIds(c).includes(a.teacherPayrollCourseId(r))).map(c=>({ref:ref(a.sourceId(c)),subject:ref(a.eventSubjectId(c)),start:a.eventStart(c)})),period:periods.filter(t=>[a.sourceId(t),t.id].includes(r.periodId)).map(t=>({subject:ref(a.eventSubjectId(t)),ref:ref(a.sourceId(t))}))})),calendar:candidates(p).map(e=>({subject:ref(e.subjectId),start:e.startTime,ref:ref(e.id)}))}));
    if(candidates(p).length>1)report(JSON.stringify({kind:'ambiguousCourseChanges',case:index+1,changes:(board.scheduleChanges||[]).filter(r=>r.event&&a.eventStudentIds(r.event).some(id=>a.teacherPayrollStudentIds(p).includes(id))).map(r=>({action:['permanent_move','single_move','lesson_status','cancel','extra_lesson'].includes(r.action)?r.action:'other',sourceDate:r.sourceDate||'',sourceCourse:ref(r.sourceCourseId),sourceEvent:ref(r.sourceEventId),cutover:r.cutoverDate||'',event:shape(r.event)}))}));
    report(JSON.stringify({kind:'anonymousMissingTopology',case:index+1,payroll:shape(p),attendance:ma.map(shape),calendar:candidates(p).map(shape)}));
    report(JSON.stringify({kind:'missingAttendanceTrace',case:index+1,date:a.eventDate(p),mirrorMatches:ma.length,nativeMatches:na.length,mirrorStatus:ma.map(safeStatus),nativeStatus:na.map(safeStatus),nativeActive:na.map(r=>r.active!==false),nativeHasPayroll:na.map(r=>native.some(n=>[n.id,n.operationId].filter(Boolean).includes(r.operationId))),mirrorCourseMatch:ma.map(r=>candidates(p).some(e=>a.teacherPayrollCourseId(r)&&[e.id,e.sourceId,e.fixedCourseId].includes(a.teacherPayrollCourseId(r)))),nativeCourseMatch:na.map(r=>candidates(p).some(e=>a.teacherPayrollCourseId(r)&&[e.id,e.sourceId,e.fixedCourseId].includes(a.teacherPayrollCourseId(r))))}));
  }
  report(JSON.stringify({kind:'totals',payrollRows:payroll.length,mirrorRows:mirror.length,nativeRows:native.length,attendedCalendar:events.filter(e=>e.status==='attended').length,missingSignedCalendar:missing.length}));
  for(const date of [...new Set(missing.map(a.eventDate))].sort()) {
    const rows=missing.filter(p=>a.eventDate(p)===date);
    report(JSON.stringify({kind:'missing',date,count:rows.length,native:rows.filter(p=>origin(p)==='native').length,mirror:rows.filter(p=>origin(p)==='mirror').length,scheduledMatches:rows.filter(p=>candidates(p).some(e=>e.status==='scheduled')).length,noEvent:rows.filter(p=>!candidates(p).length).length,
      linkedAttendance:rows.filter(p=>attendance.some(r=>a.sourceId(r)===a.sourceId(p))).length,
      missingCourse:rows.filter(p=>!a.teacherPayrollCourseId(p)).length,
      matchingCourse:rows.filter(p=>a.teacherPayrollCourseId(p)&&candidates(p).some(e=>[e.fixedCourseId,e.sourceId,e.id].includes(a.teacherPayrollCourseId(p)))).length,
      matchingMinute:rows.filter(p=>candidates(p).some(e=>a.teacherPayrollMinute(e)===a.teacherPayrollMinute(p))).length}));
  }
  const groups = new Map();
  payroll.forEach(p=>{
    const key=JSON.stringify([p.teacherId,a.eventDate(p),a.teacherPayrollStudentIds(p).slice().sort()]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(p);
  });
  for(const rows of groups.values()) if(rows.length>1) {
    const [x,y]=rows;
    if(rows.some(p=>origin(p)==='mirror')&&rows.some(p=>origin(p)==='native')) {
      const ma=attendanceCandidates(x,attendance),na=attendanceCandidates(x,nativeAttendance);
      report(JSON.stringify({kind:'anonymousMixedTopology',date:a.eventDate(x),payroll:rows.map(shape),mirrorAttendance:ma.map(shape),nativeAttendance:na.map(shape),nativePayroll:attendanceCandidates(x,native).map(shape),calendar:candidates(x).map(shape)}));
      report(JSON.stringify({kind:'mixedAttendanceTrace',date:a.eventDate(x),mirrorMatches:ma.length,nativeMatches:na.length,mirrorStatuses:ma.map(safeStatus),nativeStatuses:na.map(safeStatus),nativeActive:na.map(r=>r.active!==false),sameOperation:rows.every(p=>!!p.operationId)&&x.operationId===y.operationId,mirrorPeriodMatchesNativeAttendance:na.map(r=>!!x.periodId&&[r.periodId,...Object.keys(r.periodIds||{})].includes(x.periodId)),calendarStatus:candidates(x).map(safeStatus)}));
    }
    report(JSON.stringify({kind:'multipleSameDay',date:a.eventDate(x),rows:rows.length,origins:rows.map(origin),calendarEvents:candidates(x).length,signedCalendarEvents:candidates(x).filter(e=>e.status==='attended').length,sameMinute:a.teacherPayrollMinute(x)===a.teacherPayrollMinute(y),missingMinute:rows.some(p=>a.teacherPayrollMinute(p)==null),sameCourse:a.teacherPayrollCourseId(x)===a.teacherPayrollCourseId(y),missingCourse:rows.some(p=>!a.teacherPayrollCourseId(p)),sameAmount:x.teacherAmount===y.teacherAmount,
      linkedAttendance:rows.map(p=>attendance.some(r=>a.sourceId(r)===a.sourceId(p))),
      samePeriod:!!x.periodId&&x.periodId===y.periodId,
      mirrorNoon:rows.filter(p=>origin(p)==='mirror').every(p=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'}).format(new Date(a.teacherPayrollMinute(p)*60000))==='12:00')}));
  }
  const teachers=await a.mirrorRows('teachers');
  let withEmail=0,paidWithEmail=0,paidTeachers=0;
  for(const teacher of teachers) {
    const id=a.sourceId(teacher),profileId=a.teacherPortalProfileId(id);
    const [external,privateDoc]=await a.db.getAll(
      a.db.collection('externalTeacherProfiles').doc(profileId),
      a.db.collection('teacherPrivateProfiles').doc(profileId),
      {fieldMask:['email','Email','loginEmail','contactEmail']}
    );
    const hasEmail=!!a.teacherUtilityProfileBundle({externalProfile:external.data(),privateProfile:privateDoc.data()}).profile.email;
    const paid=payroll.some(p=>p.teacherId===id);
    if(hasEmail)withEmail++;
    if(paid)paidTeachers++;
    if(paid&&hasEmail)paidWithEmail++;
  }
  report(JSON.stringify({kind:'currentProfileEmailCoverage',teachers:teachers.length,withEmail,paidTeachers,paidWithEmail}));
}
a.withPortalReads(main)().catch(()=>{report('Parity audit failed; no record values logged.');process.exitCode=1;});
