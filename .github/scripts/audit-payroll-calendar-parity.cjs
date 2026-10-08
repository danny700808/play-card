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
module.exports.audit = {scheduleBundle,withPortalReads,mirrorRowsByDateRange,portalRowsByDateRange,
ATTENDANCE_PAYROLL,ATTENDANCE_CANCELLATIONS,mergeTeacherPayrollRows,enrichTeacherPayrollRows,
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
    report(JSON.stringify({kind:'multipleSameDay',date:a.eventDate(x),rows:rows.length,origins:rows.map(origin),calendarEvents:candidates(x).length,signedCalendarEvents:candidates(x).filter(e=>e.status==='attended').length,sameMinute:a.teacherPayrollMinute(x)===a.teacherPayrollMinute(y),missingMinute:rows.some(p=>a.teacherPayrollMinute(p)==null),sameCourse:a.teacherPayrollCourseId(x)===a.teacherPayrollCourseId(y),missingCourse:rows.some(p=>!a.teacherPayrollCourseId(p)),sameAmount:x.teacherAmount===y.teacherAmount,
      linkedAttendance:rows.map(p=>attendance.some(r=>a.sourceId(r)===a.sourceId(p))),
      samePeriod:!!x.periodId&&x.periodId===y.periodId,
      mirrorNoon:rows.filter(p=>origin(p)==='mirror').every(p=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'}).format(new Date(a.teacherPayrollMinute(p)*60000))==='12:00')}));
  }
}
a.withPortalReads(main)().catch(()=>{report('Parity audit failed; no record values logged.');process.exitCode=1;});
