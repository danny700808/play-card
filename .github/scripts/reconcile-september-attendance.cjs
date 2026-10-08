'use strict';
// Owner narrowed scope: no September 10 records may be changed.
// Exclude only a September 13 mirror with exact cancelled attendance evidence.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const report=console.log.bind(console);console.log=console.info=console.warn=console.error=()=>{};
const filename=path.resolve('functions/coursePortal.js'),backend=new Module(filename,module);
backend.filename=filename;backend.paths=Module._nodeModulePaths(path.dirname(filename));
backend._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.repair={db,MIRROR,FieldValue,withPortalReads,mirrorRowsByDateRange,portalRowsByDateRange,ATTENDANCE_RECORDS,ATTENDANCE_PAYROLL,ATTENDANCE_CANCELLATIONS,mergeTeacherPayrollRows,enrichTeacherPayrollRows,teacherPayrollStudentIds,teacherPayrollCourseId,eventTeacherId,eventDate,sourceId,scheduleVersionRef};',filename);
const a=backend.exports.repair,runId='september13-cancelled-payroll-20261008-v1';
const students=r=>JSON.stringify(a.teacherPayrollStudentIds(r).slice().sort());
const sameLessonPeople=(p,r)=>a.eventDate(r)===a.eventDate(p)&&a.eventTeacherId(r)===p.teacherId&&students(p)===students(r);
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function main(){
 const auditRef=a.db.collection('coursePortalReconciliationAudits').doc(runId);
 if((await auditRef.get()).exists){report(JSON.stringify({status:'already-applied'}));return;}
 const date='2026-09-13';
 const [mirror,attendance,native,records,cancellations]=await Promise.all([
  a.mirrorRowsByDateRange('teacherPayroll',date,date),a.mirrorRowsByDateRange('attendance',date,date),
  a.portalRowsByDateRange(a.ATTENDANCE_PAYROLL,date,date),a.portalRowsByDateRange(a.ATTENDANCE_RECORDS,date,date),
  a.portalRowsByDateRange(a.ATTENDANCE_CANCELLATIONS,date,date)]);
 const payroll=a.mergeTeacherPayrollRows(a.enrichTeacherPayrollRows(mirror,attendance),native,cancellations.filter(r=>r.status==='approved').concat(native.filter(r=>r.active===false)));
 const nativeIds=new Set(native.map(a.sourceId)),matches=[];
 for(const p of payroll.filter(p=>!nativeIds.has(a.sourceId(p)))){
  const ma=attendance.filter(r=>a.sourceId(r)===a.sourceId(p)&&sameLessonPeople(p,r));
  if(ma.length!==1||!p.periodId||!a.teacherPayrollCourseId(p))continue;
  const retired=records.filter(r=>sameLessonPeople(p,r)&&r.active===false&&r.status==='cancelled'&&a.teacherPayrollCourseId(r)===a.teacherPayrollCourseId(p)&&r.periodId===p.periodId);
  if(retired.length!==1)continue;
  const cancelledPayroll=native.filter(r=>sameLessonPeople(p,r)&&r.active===false&&r.status==='cancelled'&&r.operationId===retired[0].operationId&&a.teacherPayrollCourseId(r)===a.teacherPayrollCourseId(p));
  const signed=payroll.filter(r=>nativeIds.has(a.sourceId(r))&&sameLessonPeople(p,r)&&r.active!==false&&r.status==='attended');
  if(cancelledPayroll.length!==1||signed.length!==1)throw Error('cancellation evidence changed');
  const active=records.filter(r=>sameLessonPeople(p,r)&&r.active!==false&&r.status==='attended'&&r.operationId===signed[0].operationId);
  if(active.length!==1)throw Error('active attendance evidence changed');
  matches.push({p,ma:ma[0],retired:retired[0],cancelledPayroll:cancelledPayroll[0],signed:signed[0],active:active[0]});
 }
 if(matches.length!==1)throw Error('unexpected plan counts');
 const m=matches[0],target=a.db.collection(a.MIRROR.teacherPayroll).doc(m.p.__id),versionRef=a.scheduleVersionRef();
 const refs=[target,a.db.collection(a.MIRROR.attendance).doc(m.ma.__id),a.db.collection(a.ATTENDANCE_RECORDS).doc(m.retired.__id),a.db.collection(a.ATTENDANCE_PAYROLL).doc(m.cancelledPayroll.__id),a.db.collection(a.ATTENDANCE_RECORDS).doc(m.active.__id),a.db.collection(a.ATTENDANCE_PAYROLL).doc(m.signed.__id),versionRef];
 const before=await a.db.getAll(...refs),fingerprints=new Map(before.map(d=>[d.ref.path,d.exists?digest(d.data()):null]));
 if(!before[0].exists||before[0].data().source?.date!==date)throw Error('target date guard failed');
 const summary={date,retiredPayrollRows:1,attendanceRowsChanged:0,september10RowsChanged:0,mode:process.env.APPLY_RECONCILIATION==='true'?'apply':'dry-run'};
 report(JSON.stringify(summary));
 if(process.env.APPLY_RECONCILIATION!=='true')return;
 await a.db.runTransaction(async tx=>{
  const current=await tx.getAll(...refs),prior=await tx.get(auditRef);
  if(prior.exists)throw Error('already applied');
  if(current.some(d=>(d.exists?digest(d.data()):null)!==fingerprints.get(d.ref.path)))throw Error('concurrent edit detected');
  tx.create(auditRef.collection('before').doc('payroll'),{path:target.path,before:before[0].data()});
  tx.update(target,{sourceActive:false,'source.active':false,reconciliationRunId:runId,reconciliationReason:'exact-attendance-and-payroll-operation-cancelled',cancelledAttendanceOperationId:m.retired.operationId,retainedAttendanceOperationId:m.signed.operationId});
  tx.set(versionRef,{version:Number(before.at(-1).data()?.version||0)+1,updatedAt:a.FieldValue.serverTimestamp(),updatedBy:'attendance-reconciliation'},{merge:true});
  tx.create(auditRef,{...summary,status:'applied',createdAt:a.FieldValue.serverTimestamp(),retainsOriginalAttendance:true});
 });
 report(JSON.stringify({status:'applied',...summary}));
}
a.withPortalReads(main)().catch(error=>{report(JSON.stringify({status:'failed',reason:['cancellation evidence changed','active attendance evidence changed','unexpected plan counts','target date guard failed','concurrent edit detected','already applied'].includes(error.message)?error.message:'internal error'}));process.exitCode=1;});
