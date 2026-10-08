'use strict';
// Owner-requested September reconciliation. Defaults to dry-run; retains originals
// in a server-only audit collection. No identifying or financial values are logged.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const report=console.log.bind(console);
console.log=console.info=console.warn=console.error=()=>{};
const filename=path.resolve('functions/coursePortal.js'),backend=new Module(filename,module);
backend.filename=filename;backend.paths=Module._nodeModulePaths(path.dirname(filename));
backend._compile(fs.readFileSync(filename,'utf8')+`
module.exports.repair={db,MIRROR,FieldValue,withPortalReads,scheduleBundle,mirrorRowsByDateRange,mirrorRowsByField,portalRowsByDateRange,
ATTENDANCE_RECORDS,ATTENDANCE_PAYROLL,ATTENDANCE_CANCELLATIONS,mergeTeacherPayrollRows,enrichTeacherPayrollRows,
teacherPayrollStudentIds,teacherPayrollCourseId,eventStudentIds,eventTeacherId,eventSubjectId,eventDate,sourceId,attendanceChangePayload,scheduleVersionRef};`,filename);
const a=backend.exports.repair,runId='september-attendance-20261008-v1';
const sameStudents=(p,e)=>JSON.stringify(a.teacherPayrollStudentIds(p).slice().sort())===JSON.stringify(a.eventStudentIds(e).slice().sort());
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function main(){
 const auditRef=a.db.collection('coursePortalReconciliationAudits').doc(runId);
 if((await auditRef.get()).exists){report(JSON.stringify({status:'already-applied'}));return;}
 const [mirror,attendance,native,records,cancellations,board]=await Promise.all([
  a.mirrorRowsByDateRange('teacherPayroll','2026-09-01','2026-09-30'),
  a.mirrorRowsByDateRange('attendance','2026-09-01','2026-09-30'),
  a.portalRowsByDateRange(a.ATTENDANCE_PAYROLL,'2026-09-01','2026-09-30'),
  a.portalRowsByDateRange(a.ATTENDANCE_RECORDS,'2026-09-01','2026-09-30'),
  a.portalRowsByDateRange(a.ATTENDANCE_CANCELLATIONS,'2026-09-01','2026-09-30'),
  a.scheduleBundle('2026-09-01','2026-09-30','',{adminDelta:true})]);
 const enriched=a.enrichTeacherPayrollRows(mirror,attendance);
 const payroll=a.mergeTeacherPayrollRows(enriched,native,cancellations.filter(r=>r.status==='approved').concat(native.filter(r=>r.active===false)));
 const events=board.resourceEvents.filter(e=>a.eventStudentIds(e).length);
 const candidates=(p,rows)=>rows.filter(r=>a.eventDate(r)===a.eventDate(p)&&(!a.eventTeacherId(r)||a.eventTeacherId(r)===p.teacherId)&&sameStudents(p,r));
 const nativeIds=new Set(native.map(a.sourceId)),writes=[],evidenceRefs=new Map();let linked=0,ambiguous=0,cancelled=0,superseded=0,ownerConfirmed=0;
 const evidence=(collection,id)=>{if(!id)throw Error('missing evidence id');const ref=a.db.collection(collection).doc(id);evidenceRefs.set(ref.path,ref);return ref;};
 const addWrite=(ref,patch)=>{evidenceRefs.set(ref.path,ref);writes.push({ref,patch});};
 for(const p of payroll.filter(p=>a.eventDate(p)==='2026-09-10'&&!candidates(p,events).some(e=>e.status==='attended'))){
  const rows=candidates(p,attendance).filter(r=>r.active!==false&&r.status==='attended');
  if(rows.length!==1||candidates(p,records).length)throw Error('attendance evidence changed');
  const att=rows[0],periods=(await Promise.all(a.teacherPayrollStudentIds(p).map(id=>a.mirrorRowsByField('tuitionPeriods','studentId',id)))).flat();
  const period=periods.filter(t=>[a.sourceId(t),t.id].includes(att.periodId));
  if(period.length!==1||!a.eventSubjectId(period[0]))throw Error('period evidence missing');
  let choices=candidates(p,events).filter(e=>e.status==='scheduled'&&e.subjectId===a.eventSubjectId(period[0]));
  let confirmedTime=false;
  // The owner explicitly confirmed the sole ambiguous September 10 lesson as
  // 19:00-20:00; the unsigned 14:00 occurrence must remain unsigned.
  if(choices.length===2&&choices.some(e=>e.startTime==='14:00'&&e.endTime==='15:00')&&choices.some(e=>e.startTime==='19:00'&&e.endTime==='20:00')){
   choices=choices.filter(e=>e.startTime==='19:00');confirmedTime=true;ownerConfirmed++;
  }
  if(choices.length!==1){ambiguous++;continue;}
  const event=choices[0];
  const payload=a.attendanceChangePayload(event,event.date,event.sourceId,event.fixedCourseId,event.teacherId,'attended','依既有簽到紀錄修復日表對應；未新增簽到或薪資');
  Object.assign(payload,{createdByTeacherId:'',reconciledBy:'manager-requested-audit',reconciliationRunId:runId,reconciledFromAttendanceId:a.sourceId(att),timeConfirmedByOwner:confirmedTime});
  addWrite(a.db.collection('coursePortalScheduleChanges').doc(payload.id),payload);
  addWrite(evidence(a.MIRROR.teacherPayroll,p.__id),{'source.attendanceId':a.sourceId(att),'source.eventId':event.sourceId,'source.courseId':event.fixedCourseId,'source.startTime':event.startTime,'source.endTime':event.endTime,'source.occurredAt':event.date+'T'+event.startTime+':00+08:00',reconciliationRunId:runId});
  evidence(a.MIRROR.attendance,att.__id);linked++;
 }
 const groups=new Map();payroll.forEach(p=>{const key=JSON.stringify([p.teacherId,a.eventDate(p),a.teacherPayrollStudentIds(p).slice().sort()]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);});
 for(const rows of groups.values()){
  if(rows.length!==2)continue;
  const imported=rows.filter(p=>!nativeIds.has(a.sourceId(p))),signed=rows.filter(p=>nativeIds.has(a.sourceId(p)));
  if(imported.length!==1||signed.length!==1)continue;
  const p=imported[0],live=signed[0],date=a.eventDate(p);
  if(!['2026-09-10','2026-09-13'].includes(date))continue;
  const ma=candidates(p,attendance),na=candidates(p,records),active=na.filter(r=>r.active!==false&&r.status==='attended');
  if(active.length!==1||active[0].operationId!==live.operationId){report(JSON.stringify({kind:'evidence-check',date,mirrorAttendance:ma.length,nativeAttendance:na.length,active:active.length,sameOperation:active.map(r=>r.operationId===live.operationId),nativePayrollStudentCount:a.teacherPayrollStudentIds(live).length,mirrorStudentCount:a.teacherPayrollStudentIds(p).length,matchingDateRecords:records.filter(r=>a.eventDate(r)===date&&a.eventTeacherId(r)===p.teacherId&&a.eventStudentIds(r).some(id=>a.teacherPayrollStudentIds(p).includes(id))).map(r=>({studentCount:a.eventStudentIds(r).length,active:r.active!==false,signed:r.status==='attended',sameOperation:r.operationId===live.operationId}))}));throw Error('native operation evidence changed');}
  let reason='';
  if(date==='2026-09-13'){
   const retired=na.filter(r=>r.active===false&&r.status==='cancelled'&&a.teacherPayrollCourseId(r)===a.teacherPayrollCourseId(p)&&r.periodId===p.periodId);
   if(ma.length!==1||a.sourceId(ma[0])!==a.sourceId(p)||retired.length!==1||!a.teacherPayrollCourseId(p)||!p.periodId)throw Error('cancellation evidence changed');
   evidence(a.MIRROR.attendance,ma[0].__id);evidence(a.ATTENDANCE_RECORDS,retired[0].__id);cancelled++;reason='cancelled-attendance';
  }else{
   if(ma.length||a.teacherPayrollCourseId(p)||p.periodId||p.eventId||p.operationId||na.length!==1||candidates(p,events).filter(e=>e.status==='attended').length!==1||Number(p.teacherAmount)!==Number(live.teacherAmount))throw Error('orphan summary evidence changed');
   superseded++;reason='orphan-summary-superseded-by-unique-signed-operation';
  }
  evidence(a.ATTENDANCE_RECORDS,active[0].__id);evidence(a.ATTENDANCE_PAYROLL,live.__id);
  addWrite(evidence(a.MIRROR.teacherPayroll,p.__id),{sourceActive:false,'source.active':false,reconciliationRunId:runId,reconciliationReason:reason,supersededByAttendanceOperationId:live.operationId});
 }
 if(payroll.length!==424||linked!==9||ambiguous!==0||ownerConfirmed!==1||cancelled!==1||superseded!==1)throw Error('unexpected plan counts');
 const versionRef=a.scheduleVersionRef();evidenceRefs.set(versionRef.path,versionRef);
 const refs=[...evidenceRefs.values()],before=await a.db.getAll(...refs);
 const fingerprints=new Map(before.map(d=>[d.ref.path,d.exists?digest(d.data()):null]));
 const summary={linked,ambiguous,ownerConfirmed,cancelled,superseded,writes:writes.length,mode:process.env.APPLY_RECONCILIATION==='true'?'apply':'dry-run'};
 report(JSON.stringify(summary));
 if(process.env.APPLY_RECONCILIATION!=='true')return;
 await a.db.runTransaction(async tx=>{
  const current=await tx.getAll(...refs),prior=await tx.get(auditRef);
  if(prior.exists)throw Error('audit already applied');
  if(current.some(d=>(d.exists?digest(d.data()):null)!==fingerprints.get(d.ref.path)))throw Error('concurrent edit detected');
  for(const [index,w] of writes.entries()){
   const old=before.find(d=>d.ref.path===w.ref.path);
   tx.create(auditRef.collection('before').doc(String(index)),{path:w.ref.path,existed:old.exists,before:old.exists?old.data():null});
   if(old.exists)tx.update(w.ref,w.patch);else tx.set(w.ref,w.patch);
  }
  const version=before.find(d=>d.ref.path===versionRef.path);
  tx.set(versionRef,{version:Number(version.data()?.version||0)+1,updatedAt:a.FieldValue.serverTimestamp(),updatedBy:'attendance-reconciliation'},{merge:true});
  tx.create(auditRef,{...summary,status:'applied',createdAt:a.FieldValue.serverTimestamp(),scope:'2026-09',retainsOriginalAttendance:true});
 });
 report(JSON.stringify({status:'applied',...summary}));
}
a.withPortalReads(main)().catch(error=>{report(JSON.stringify({status:'failed',reason:['missing evidence id','attendance evidence changed','period evidence missing','native operation evidence changed','cancellation evidence changed','orphan summary evidence changed','unexpected plan counts','concurrent edit detected','audit already applied'].includes(error.message)?error.message:'internal error'}));process.exitCode=1;});
