'use strict';
// Owner-confirmed reconciliation; all private values remain inside Firestore.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const report=console.log.bind(console);console.log=console.info=console.warn=console.error=()=>{};
const filename=path.resolve('functions/coursePortal.js'),backend=new Module(filename,module);
backend.filename=filename;backend.paths=Module._nodeModulePaths(path.dirname(filename));
backend._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.repair={db,MIRROR,FieldValue,withPortalReads,mirrorRowsByDateRange,portalRowsByDateRange,ATTENDANCE_RECORDS,ATTENDANCE_PAYROLL,ATTENDANCE_CANCELLATIONS,mergeTeacherPayrollRows,mergePortalAttendanceRows,enrichTeacherPayrollRows,teacherPayrollStudentIds,teacherPayrollCourseId,eventTeacherId,eventDate,sourceId,scheduleVersionRef};',filename);
const a=backend.exports.repair,runId='confirmed-september-payroll-attendance-20261008-v4';
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const people=r=>JSON.stringify(a.teacherPayrollStudentIds(r).slice().sort());
const same=(x,y)=>a.eventDate(x)===a.eventDate(y)&&people(x)===people(y)&&a.eventTeacherId(x)===a.eventTeacherId(y);
async function main(){
 const auditRef=a.db.collection('coursePortalReconciliationAudits').doc(runId);
 if((await auditRef.get()).exists){report(JSON.stringify({status:'already-applied'}));return;}
 const start='2026-09-01',end='2026-09-30';
 const [mirror,attendance,native,cancels,records]=await Promise.all([a.mirrorRowsByDateRange('teacherPayroll',start,end),a.mirrorRowsByDateRange('attendance',start,end),a.portalRowsByDateRange(a.ATTENDANCE_PAYROLL,start,end),a.portalRowsByDateRange(a.ATTENDANCE_CANCELLATIONS,start,end),a.portalRowsByDateRange(a.ATTENDANCE_RECORDS,start,end)]);
 const baseline=a.enrichTeacherPayrollRows(mirror,attendance);
 const merge=(m,n)=>a.mergeTeacherPayrollRows(m,n,cancels.filter(r=>r.status==='approved').concat(n.filter(r=>r.active===false)));
 const before=merge(baseline,native),nativeIds=new Set(native.map(a.sourceId));
 const candidates=before.filter(r=>a.eventDate(r)==='2026-09-10'&&nativeIds.has(a.sourceId(r))).map(trial=>({trial,official:before.filter(r=>same(r,trial)&&!nativeIds.has(a.sourceId(r)))})).filter(x=>x.official.length===1);
 if(candidates.length!==1)throw Error('unique duplicate guard failed');
 const {trial,official:[official]}=candidates[0];
 const effectiveAttendance=a.mergePortalAttendanceRows(attendance,records);
 const valid=effectiveAttendance.filter(r=>same(r,trial)&&r.active!==false&&r.status==='attended');
 if(valid.length!==1||valid[0].operationId!==trial.operationId||Number(trial.teacherAmount)!==Number(official.teacherAmount)||!(Number(trial.teacherAmount)>0))throw Error('single actual attendance guard failed');
 // A canceled zero-fee legacy row must not remain in payroll or lesson counts.
 const stale=before.filter(r=>a.eventDate(r)==='2026-09-13'&&!nativeIds.has(a.sourceId(r))&&Number(r.teacherAmount)===0).map(zero=>{
  const old=attendance.filter(r=>a.sourceId(r)===a.sourceId(zero)&&same(r,zero));
  const cancelled=records.filter(r=>same(r,zero)&&r.active===false&&r.status==='cancelled'&&a.teacherPayrollCourseId(r)===a.teacherPayrollCourseId(zero)&&r.periodId===zero.periodId);
  const paid=before.filter(r=>same(r,zero)&&nativeIds.has(a.sourceId(r))&&Number(r.teacherAmount)>0);
  return {zero,old,cancelled,paid};
 }).filter(x=>x.old.length===1&&x.cancelled.length===1&&x.paid.length===1);
 if(stale.length!==1)throw Error('cancelled free lesson guard failed');
 const {zero,old:[old],cancelled:[cancelled],paid:[paid]}=stale[0];
 if(!records.some(r=>same(r,paid)&&r.operationId===paid.operationId&&r.active!==false&&r.status==='attended'))throw Error('retained paid attendance guard failed');
 const expected=merge(baseline.filter(r=>a.sourceId(r)!==a.sourceId(zero)),native.map(r=>a.sourceId(r)===a.sourceId(trial)?{...r,status:'superseded'}:r));
 const unaffected=before.filter(r=>![a.sourceId(trial),a.sourceId(zero)].includes(a.sourceId(r)));
 if(expected.length!==before.length-2||digest(expected)!==digest(unaffected))throw Error('payroll regression guard failed');
 const afterAttendance=a.mergePortalAttendanceRows(attendance.filter(r=>a.sourceId(r)!==a.sourceId(old)),records);
 if(digest(afterAttendance)!==digest(effectiveAttendance.filter(r=>a.sourceId(r)!==a.sourceId(old)))||afterAttendance.filter(r=>same(r,trial)&&r.status==='attended').length!==1)throw Error('attendance regression guard failed');
 const versionRef=a.scheduleVersionRef();
 const writes=[
  {ref:a.db.collection(a.ATTENDANCE_PAYROLL).doc(trial.__id),patch:{status:'superseded',supersededByLegacyPayrollId:a.sourceId(official),reconciliationReason:'owner-confirmed-one-lesson-duplicate-payroll'}},
  {ref:a.db.collection(a.ATTENDANCE_RECORDS).doc(valid[0].__id),patch:{confirmedLegacyPayrollId:a.sourceId(official),reconciliationReason:'owner-confirmed-single-actual-lesson-retained'}},
  {ref:a.db.collection(a.MIRROR.teacherPayroll).doc(zero.__id),patch:{sourceActive:false,'source.active':false,reconciliationReason:'cancelled-zero-fee-lesson-retain-paid-lesson'}},
  {ref:a.db.collection(a.MIRROR.attendance).doc(old.__id),patch:{sourceActive:false,'source.active':false,reconciliationReason:'already-cancelled-zero-fee-attendance'}}
 ];
 const refs=[...writes.map(w=>w.ref),versionRef,a.db.collection(a.MIRROR.teacherPayroll).doc(official.__id),a.db.collection(a.ATTENDANCE_RECORDS).doc(cancelled.__id),a.db.collection(a.ATTENDANCE_PAYROLL).doc(paid.__id)];
 const snaps=await a.db.getAll(...refs),fingerprints=snaps.map(d=>digest(d.exists?d.data():null));
 if(snaps.some(d=>!d.exists)||snaps[0].data().status!=='attended'||snaps[1].data().status!=='attended'||snaps[2].data().source?.date!=='2026-09-13'||snaps[3].data().source?.date!=='2026-09-13')throw Error('target guard failed');
 const summary={duplicatePayrollRemoved:1,cancelledZeroFeePayrollRemoved:1,cancelledZeroFeeAttendanceRemoved:1,actualSeptember10AttendanceRetained:1,otherPayrollUnchanged:true,otherAttendanceUnchanged:true,mode:process.env.APPLY_RECONCILIATION==='true'?'apply':'dry-run'};
 report(JSON.stringify(summary));
 if(process.env.APPLY_RECONCILIATION!=='true')return;
 await a.db.runTransaction(async tx=>{
  const current=await tx.getAll(...refs),audit=await tx.get(auditRef);
  if(audit.exists||current.some((d,i)=>digest(d.exists?d.data():null)!==fingerprints[i]))throw Error('concurrent edit guard failed');
  snaps.slice(0,5).forEach((doc,i)=>tx.create(auditRef.collection('before').doc(String(i)),{path:doc.ref.path,before:doc.data()}));
  const stamp=a.FieldValue.serverTimestamp();
  writes.forEach(w=>tx.update(w.ref,{...w.patch,reconciliationRunId:runId,reconciledAt:stamp}));
  tx.set(versionRef,{version:Number(snaps[4].data()?.version||0)+1,updatedAt:stamp,updatedBy:'attendance-reconciliation'},{merge:true});
  tx.create(auditRef,{...summary,status:'applied',retainedOfficialPayrollPath:refs[5].path,createdAt:stamp});
 });
 const saved=await a.db.getAll(...writes.map(w=>w.ref));
 if(saved[0].data()?.status!=='superseded'||saved[1].data()?.status!=='attended'||saved[2].data()?.sourceActive!==false||saved[3].data()?.sourceActive!==false)throw Error('verification guard failed');
 report(JSON.stringify({status:'applied-and-verified',...summary}));
}
a.withPortalReads(main)().catch(error=>{report(JSON.stringify({status:'failed',reason:/guard failed$/.test(error.message)?error.message:'internal error'}));process.exitCode=1;});
