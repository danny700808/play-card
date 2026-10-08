'use strict';
// Read-only September validation. Only anonymous relationship flags are logged.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const report=console.log.bind(console);console.log=console.info=console.warn=console.error=()=>{};
const filename=path.resolve('functions/coursePortal.js'),backend=new Module(filename,module);
backend.filename=filename;backend.paths=Module._nodeModulePaths(path.dirname(filename));
backend._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.audit={withPortalReads,mirrorRowsByDateRange,portalRowsByDateRange,ATTENDANCE_PAYROLL,ATTENDANCE_RECORDS,ATTENDANCE_CANCELLATIONS,enrichTeacherPayrollRows,mergeTeacherPayrollRows,teacherPayrollStudentIds,eventDate,sourceId};',filename);
const a=backend.exports.audit;
const students=r=>JSON.stringify(a.teacherPayrollStudentIds(r).sort());
const same=(x,y)=>a.eventDate(x)===a.eventDate(y)&&x.teacherId===y.teacherId&&students(x)===students(y);
async function main(){
 const start='2026-09-01',end='2026-09-30';
 const [mirror,attendance,native,cancels,records]=await Promise.all([a.mirrorRowsByDateRange('teacherPayroll',start,end),a.mirrorRowsByDateRange('attendance',start,end),a.portalRowsByDateRange(a.ATTENDANCE_PAYROLL,start,end),a.portalRowsByDateRange(a.ATTENDANCE_CANCELLATIONS,start,end),a.portalRowsByDateRange(a.ATTENDANCE_RECORDS,start,end)]);
 const baseline=a.enrichTeacherPayrollRows(mirror,attendance);
 const current=a.mergeTeacherPayrollRows(baseline,native,cancels.filter(r=>r.status==='approved').concat(native.filter(r=>r.active===false)));
 const nativeIds=new Set(native.map(a.sourceId)),baselineIds=new Set(baseline.map(a.sourceId));
 const groups=new Map();
 current.forEach(p=>a.teacherPayrollStudentIds(p).forEach(id=>{const key=a.eventDate(p)+'|'+id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}));
 let cases=0;
 for(const rows of groups.values())if(rows.length>1){cases++;report(JSON.stringify({kind:'sameStudentSameDay',case:cases,date:a.eventDate(rows[0]),rows:rows.length,teachers:new Set(rows.map(r=>r.teacherId)).size,origins:rows.map(r=>nativeIds.has(a.sourceId(r))?'native':'legacy'),sameSubject:new Set(rows.map(r=>r.subjectId||r.subject||'')).size===1}));}
 for(const r of current.filter(r=>a.eventDate(r)<'2026-09-15'&&nativeIds.has(a.sourceId(r))))report(JSON.stringify({kind:'preCutoverNative',date:a.eventDate(r),sameLegacyId:baselineIds.has(a.sourceId(r)),sameLegacyLesson:baseline.filter(b=>same(b,r)).length,hasActiveAttendance:records.some(n=>n.operationId===r.operationId&&n.active!==false&&n.status==='attended'),explicitManagerAdjustment:!!r.teacherPayAdjustmentReason,hasPayrollSnapshot:!!r.payrollCalculation?.version,source:r.source==='teacher-attendance'?'teacher-attendance':r.source==='teacher-late-attendance'?'teacher-late-attendance':'other'}));
 const invalid=current.filter(r=>!Number.isFinite(Number(r.teacherAmount))||Number(r.teacherAmount)<0);
 const post=current.filter(r=>a.eventDate(r)>='2026-09-15');
 const unsigned=post.filter(r=>!records.some(n=>n.active!==false&&n.status==='attended'&&same(n,r))&&!attendance.some(n=>n.active!==false&&n.status==='attended'&&same(n,r)));
 const activeNative=records.filter(r=>a.eventDate(r)>='2026-09-15'&&r.active!==false&&r.status==='attended');
 const unpaid=activeNative.filter(r=>!current.some(p=>same(p,r)));
 report(JSON.stringify({kind:'monthValidation',payrollRows:current.length,invalidAmounts:invalid.length,postCutoverPayrollWithoutAttendance:unsigned.length,postCutoverAttendanceWithoutPayroll:unpaid.length,sameStudentDayGroups:cases}));
 for(const r of unsigned)report(JSON.stringify({kind:'unsignedPayroll',date:a.eventDate(r),origin:nativeIds.has(a.sourceId(r))?'native':'legacy'}));
 for(const r of unpaid)report(JSON.stringify({kind:'attendanceWithoutPayroll',date:a.eventDate(r)}));
}
a.withPortalReads(main)().catch(()=>{report('Read-only audit failed.');process.exitCode=1;});
