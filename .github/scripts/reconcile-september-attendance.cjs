'use strict';
// Owner-confirmed single lesson: reverse only the September 10 trial duplicate.
// Logs are anonymous. Private before-images are retained for restoration.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const report=console.log.bind(console);console.log=console.info=console.warn=console.error=()=>{};
const filename=path.resolve('functions/coursePortal.js'),backend=new Module(filename,module);
backend.filename=filename;backend.paths=Module._nodeModulePaths(path.dirname(filename));
backend._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.repair={db,MIRROR,FieldValue,withPortalReads,mirrorRowsByDateRange,portalRowsByDateRange,ATTENDANCE_RECORDS,ATTENDANCE_PAYROLL,ATTENDANCE_CANCELLATIONS,mergeTeacherPayrollRows,mergePortalAttendanceRows,enrichTeacherPayrollRows,teacherPayrollStudentIds,eventDate,sourceId,scheduleVersionRef,scheduleBundle,attendanceOperationId,attendanceLessonLockId,attendanceLineage,hash};',filename);
const a=backend.exports.repair,runId='september10-trial-duplicate-20261008-v3';
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const people=r=>JSON.stringify(a.teacherPayrollStudentIds(r).slice().sort());
const key=r=>JSON.stringify([a.eventDate(r),r.teacherId,people(r)]);
async function main(){
 const auditRef=a.db.collection('coursePortalReconciliationAudits').doc(runId);
 if((await auditRef.get()).exists){report(JSON.stringify({status:'already-applied'}));return;}
 const start='2026-09-01',end='2026-09-30',date='2026-09-10';
 const [mirror,attendance,native,cancels,records,board]=await Promise.all([a.mirrorRowsByDateRange('teacherPayroll',start,end),a.mirrorRowsByDateRange('attendance',start,end),a.portalRowsByDateRange(a.ATTENDANCE_PAYROLL,start,end),a.portalRowsByDateRange(a.ATTENDANCE_CANCELLATIONS,start,end),a.portalRowsByDateRange(a.ATTENDANCE_RECORDS,start,end),a.scheduleBundle(date,date,'',{adminDelta:true})]);
 const baseline=a.enrichTeacherPayrollRows(mirror,attendance);
 const merge=rows=>a.mergeTeacherPayrollRows(baseline,rows,cancels.filter(r=>r.status==='approved').concat(rows.filter(r=>r.active===false)));
 const before=merge(native),nativeIds=new Set(native.map(a.sourceId));
 const candidates=before.filter(r=>a.eventDate(r)===date&&nativeIds.has(a.sourceId(r))).map(trial=>({trial,official:before.filter(r=>key(r)===key(trial)&&!nativeIds.has(a.sourceId(r)))})).filter(x=>x.official.length===1);
 if(candidates.length!==1)throw Error('unique duplicate guard failed');
 const {trial,official:[official]}=candidates[0];
 if(people(trial)==='[]'||!(Number(trial.teacherAmount)>0)||!(Number(official.teacherAmount)>0)||trial.active===false||trial.status!=='attended')throw Error('payroll guard failed');
 const linked=attendance.filter(r=>a.sourceId(r)===a.sourceId(official));
 const duplicateRecords=records.filter(r=>r.operationId===trial.operationId&&r.status==='attended'&&r.active!==false);
 report(JSON.stringify({kind:'attendance-diagnostics',linked:linked.length,records:duplicateRecords.length,trialHasOperation:!!trial.operationId,recordDateMatches:duplicateRecords.map(r=>a.eventDate(r)===date),teacherMatches:duplicateRecords.map(r=>r.teacherId===trial.teacherId),studentMatches:duplicateRecords.map(r=>people(r)===people(trial))})); if(linked.length!==1||duplicateRecords.length!==1||key(duplicateRecords[0])!==key(trial))throw Error('attendance guard failed');
 const events=board.resourceEvents.filter(e=>a.eventDate(e)===date&&e.teacherId===trial.teacherId&&people(e)===people(trial)&&a.attendanceOperationId(e.teacherId,date,e)===trial.operationId);
 if(events.length!==1)throw Error('calendar identity guard failed');
 const event=events[0],lineage=a.attendanceLineage(event);
 const patch={active:false,status:'cancelled',deducted:false,source:'attendance-cancellation-approved',reconciliationRunId:runId,reconciliationReason:'owner-confirmed-trial-duplicate-before-formal-cutover'};
 const expected=merge(native.map(r=>a.sourceId(r)===a.sourceId(trial)?{...r,...patch}:r));
 const unaffected=before.filter(r=>a.sourceId(r)!==a.sourceId(trial));
 if(expected.length!==before.length-1||digest(expected)!==digest(unaffected)||expected.filter(r=>key(r)===key(trial)).length!==1)throw Error('payroll regression guard failed');
 const attendanceBefore=a.mergePortalAttendanceRows(attendance,records);
 const attendanceAfter=a.mergePortalAttendanceRows(attendance,records.map(r=>r.operationId===trial.operationId?{...r,...patch}:r));
 const officialRetained=attendanceAfter.some(r=>a.sourceId(r)===a.sourceId(linked[0]));
 const otherAttendance=attendanceBefore.filter(r=>r.operationId!==trial.operationId);
 if(!officialRetained||digest(attendanceAfter)!==digest(otherAttendance))throw Error('attendance regression guard failed');
 const target=a.db.collection(a.ATTENDANCE_PAYROLL).doc(trial.__id),versionRef=a.scheduleVersionRef();
 const statusRef=a.db.collection('coursePortalScheduleChanges').doc('lesson-status-'+a.hash([trial.teacherId,lineage,date].join('|')));
 const lockRef=a.db.collection('coursePortalAttendanceLessonLocks').doc(a.attendanceLessonLockId(date,event));
 const requestRef=a.db.collection(a.ATTENDANCE_CANCELLATIONS).doc(a.hash(['attendance-cancellation',trial.operationId].join('|')));
 const attendanceRef=a.db.collection(a.ATTENDANCE_RECORDS).doc(duplicateRecords[0].__id);
 const refs=[target,attendanceRef,statusRef,lockRef,requestRef,versionRef,a.db.collection(a.MIRROR.teacherPayroll).doc(official.__id),a.db.collection(a.MIRROR.attendance).doc(linked[0].__id)];
 const snaps=await a.db.getAll(...refs),fingerprints=snaps.map(d=>digest(d.exists?d.data():null));
 if(!snaps[0].exists||snaps[0].data().date!==date||!snaps[2].exists||snaps[2].data().event?.status!=='attended')throw Error('target guard failed');
 const corrections=await a.db.collection('coursePortalAttendanceCorrections').where('replacementOperationId','==',trial.operationId).get();
 if(!corrections.empty)throw Error('replacement lesson guard failed');
 const summary={date,duplicatePayrollRowsCancelled:1,duplicateAttendanceRowsCancelled:1,officialAttendanceRetained:true,otherPayrollUnchanged:true,otherAttendanceUnchanged:true,mode:process.env.APPLY_RECONCILIATION==='true'?'apply':'dry-run'};
 report(JSON.stringify(summary));
 if(process.env.APPLY_RECONCILIATION!=='true')return;
 await a.db.runTransaction(async tx=>{
  const current=await tx.getAll(...refs),audit=await tx.get(auditRef);
  if(audit.exists||current.some((d,i)=>digest(d.exists?d.data():null)!==fingerprints[i]))throw Error('concurrent edit guard failed');
  snaps.slice(0,6).forEach((doc,i)=>tx.create(auditRef.collection('before').doc(String(i)),{path:doc.ref.path,existed:doc.exists,before:doc.exists?doc.data():null}));
  const stamp=a.FieldValue.serverTimestamp();
  tx.update(target,{...patch,cancellationRequestId:requestRef.id,cancelledAt:stamp,updatedAt:stamp});
  tx.update(attendanceRef,{...patch,cancellationRequestId:requestRef.id,cancelledAt:stamp,updatedAt:stamp});
  tx.update(statusRef,{'event.status':'cancelled','event.teacherPayable':false,'event.note':'管理者核對：新舊系統重複簽到，保留舊系統正式課程',reconciliationRunId:runId,updatedAt:stamp});
  tx.set(lockRef,{operationId:trial.operationId,teacherId:trial.teacherId,date,active:true,status:'cancelled',cancellationRequestId:requestRef.id,updatedAt:stamp},{merge:true});
  tx.set(requestRef,{id:requestRef.id,operationId:trial.operationId,active:true,status:'approved',teacherId:trial.teacherId,studentIds:a.teacherPayrollStudentIds(trial),date,eventId:trial.eventId||'',courseId:trial.courseId||'',startTime:trial.startTime||'',endTime:trial.endTime||'',attendanceRecordIds:[attendanceRef.id],reason:'管理者核對：9/10 只上一次，撤銷新系統重複簽到及計薪',approvedByManager:true,reconciliationRunId:runId,updatedAt:stamp},{merge:true});
  tx.set(versionRef,{version:Number(snaps[5].data()?.version||0)+1,updatedAt:stamp,updatedBy:'attendance-reconciliation'},{merge:true});
  tx.create(auditRef,{...summary,status:'applied',targetPath:target.path,retainedPath:refs[6].path,createdAt:stamp});
 });
 const saved=await a.db.getAll(target,attendanceRef,statusRef);
 if(saved[0].data()?.status!=='cancelled'||saved[1].data()?.status!=='cancelled'||saved[2].data()?.event?.status!=='cancelled')throw Error('verification guard failed');
 report(JSON.stringify({status:'applied-and-verified',...summary}));
}
a.withPortalReads(main)().catch(error=>{report(JSON.stringify({status:'failed',reason:/guard failed$/.test(error.message)?error.message:'internal error'}));process.exitCode=1;});

