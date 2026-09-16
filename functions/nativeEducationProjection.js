'use strict';
const admin=require('firebase-admin');
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {CUTOFF,buildNativeEducationDays}=require('./nativeEducationDaily');
async function refreshNativeEducationDaily(db){
  const runtime=db.doc('coursePortalRuntime/scheduleVersion'),version=await runtime.get();
  if(version.data()?.syncing||version.data()?.writesBlocked)throw Error('Course write in progress');
  const specifications={payroll:['coursePortalTeacherAttendancePayroll','date'],transactions:['coursePortalTuitionPaymentTransactions','date'],bookings:['coursePortalRoomBookings','date'],changes:['coursePortalScheduleChanges','event.date'],settings:['coursePortalLessonSettings','date'],mirrorRentals:['opsEducationMirrorEvents','source.date'],periods:['coursePortalTuitionPeriods'],students:['opsEducationMirrorStudents'],profiles:['coursePortalStudentProfiles'],teachers:['opsEducationMirrorTeachers'],existing:['opsEducationDaily','dateKey']};
  const input={};await Promise.all(Object.entries(specifications).map(async([name,[collection,field]])=>{let q=db.collection(collection);if(field)q=q.where(field,'>=',CUTOFF);const snap=await q.get();input[name]=snap.docs.map(d=>({...d.data(),id:d.id}));}));
  input.students=input.students.map(s=>s.source).concat(input.profiles).filter(Boolean);input.teachers=input.teachers.map(s=>s.source).filter(Boolean);input.existingDates=input.existing.filter(d=>d.source==='course-portal').map(d=>d.dateKey);
  const days=buildNativeEducationDays(input),previous=new Map(input.existing.map(d=>[d.id,d]));
  const changed=days.filter(d=>{const prior=previous.get(d.id);return !prior||['sessions','tuitionReceipts','roomRentals','summary'].some(k=>JSON.stringify(prior[k])!==JSON.stringify(d[k]));});
  for(let i=0;i<changed.length;i+=400)await db.runTransaction(async tx=>{const current=await tx.get(runtime);if(!current.updateTime.isEqual(version.updateTime))throw Error('Course records changed while computing daily totals');for(const d of changed.slice(i,i+400))tx.set(db.doc('opsEducationDaily/'+d.id),{...d,projectedAt:admin.firestore.FieldValue.serverTimestamp()});});
  return {days:days.length,updated:changed.length};
}
function registerNativeEducationProjection(target){target.coursePortalNativeEducationDailyTaiwan=onDocumentWritten({document:'coursePortalRuntime/scheduleVersion',region:'asia-east1',retry:true,timeoutSeconds:180,memory:'512MiB',maxInstances:2},()=>refreshNativeEducationDaily(admin.firestore()));}
module.exports={refreshNativeEducationDaily,registerNativeEducationProjection};
