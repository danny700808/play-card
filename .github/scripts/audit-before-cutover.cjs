'use strict';
// Read-only audit using the owner's confirmed September 15 formal cutover.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const report=console.log.bind(console);console.log=console.info=console.warn=console.error=()=>{};
const filename=path.resolve('functions/coursePortal.js'),backend=new Module(filename,module);
backend.filename=filename;backend.paths=Module._nodeModulePaths(path.dirname(filename));
backend._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.audit={withPortalReads,mirrorRowsByDateRange,portalRowsByDateRange,ATTENDANCE_PAYROLL,ATTENDANCE_CANCELLATIONS,enrichTeacherPayrollRows,mergeTeacherPayrollRows,teacherPayrollStudentIds,eventDate,sourceId};',filename);
const a=backend.exports.audit;
async function main(){
 const start='2026-09-01',end='2026-09-14';
 const [mirror,attendance,native,cancels]=await Promise.all([a.mirrorRowsByDateRange('teacherPayroll',start,end),a.mirrorRowsByDateRange('attendance',start,end),a.portalRowsByDateRange(a.ATTENDANCE_PAYROLL,start,end),a.portalRowsByDateRange(a.ATTENDANCE_CANCELLATIONS,start,end)]);
 const baseline=a.enrichTeacherPayrollRows(mirror,attendance);
 const current=a.mergeTeacherPayrollRows(baseline,native,cancels.filter(r=>r.status==='approved').concat(native.filter(r=>r.active===false)));
 const nativeIds=new Set(native.map(a.sourceId)),baselineIds=new Set(baseline.map(a.sourceId)),currentIds=new Set(current.map(a.sourceId));
 const groups=new Map();
 current.forEach(p=>a.teacherPayrollStudentIds(p).forEach(id=>{const key=a.eventDate(p)+'|'+id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}));
 let cases=0;
 for(const rows of groups.values())if(rows.length>1){cases++;report(JSON.stringify({kind:'sameStudentSameDay',case:cases,date:a.eventDate(rows[0]),rows:rows.length,teachers:new Set(rows.map(r=>r.teacherId)).size,origins:rows.map(r=>nativeIds.has(a.sourceId(r))?'trial-native':'legacy-baseline'),zeroAmount:rows.map(r=>Number(r.teacherAmount)===0),sameSubject:new Set(rows.map(r=>r.subjectId||r.subject||'')).size===1}));}
 report(JSON.stringify({kind:'cutoverComparison',legacyBaselineRows:baseline.length,currentMergedRows:current.length,trialRowsIncluded:current.filter(r=>nativeIds.has(a.sourceId(r))).length,legacyRowsExcludedByCurrentMerge:baseline.filter(r=>!currentIds.has(a.sourceId(r))).length,rowsNotInLegacyBaseline:current.filter(r=>!baselineIds.has(a.sourceId(r))).length,sameStudentDayGroups:cases}));
}
a.withPortalReads(main)().catch(()=>{report('Read-only cutoff audit failed; no identifying values logged.');process.exitCode=1;});
