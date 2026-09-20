'use strict';
const {HttpsError}=require('firebase-functions/v2/https');
const clean=v=>String(v==null?'':v).trim();
function accountRow(row){
 const name=clean(row.name).slice(0,80),account=clean(row.account).replace(/[ -]/g,'');
 if(account&&!/^\d{1,30}$/.test(account))throw new HttpsError('invalid-argument','銀行帳號只能填入數字。');
 return {teacherId:clean(row.teacherId).slice(0,120),name,account,note:clean(row.note||'薪轉').slice(0,120),confirmedAgainst:clean(row.confirmedAgainst).slice(0,220)};
}
function createPayrollTransfer({db,profileId}){
 return async function(data,actor){
  const month=clean(data.month);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new HttpsError('invalid-argument','請選擇薪資月份。');
  const ref=db.collection('coursePayrollTransferSettings').doc('bankAccounts'),draftRef=db.collection('coursePayrollTransferDrafts').doc(month);
  if(data.action==='save'){
   if(!Array.isArray(data.accounts)||data.accounts.length>300||!Array.isArray(data.extras)||data.extras.length>100)throw new HttpsError('invalid-argument','轉帳名單格式不正確。');
   const accounts=data.accounts.map(accountRow),manager=accountRow(data.manager||{}),extras=data.extras.map(row=>({...accountRow(row),amount:Number(row.amount)})),managerAmount=Number(data.managerAmount||0);
   if(!Number.isFinite(managerAmount)||managerAmount<0||extras.some(r=>!Number.isFinite(r.amount)||r.amount<0))throw new HttpsError('invalid-argument','轉帳金額必須是零或正數。');
   const now=new Date().toISOString();
   await db.runTransaction(async tx=>{const old=await tx.get(ref);if(clean(old.exists?old.data().revision:"")!==clean(data.revision))throw new HttpsError('aborted','帳戶資料已在其他視窗更新，請關閉後重新開啟轉帳表。');tx.set(ref,{accounts,manager,revision:now,updatedBy:actor});tx.set(draftRef,{extras,managerAmount,updatedAt:now,updatedBy:actor});});
   return {ok:true,revision:now};
  }
  if(data.action&&data.action!=='load')throw new HttpsError('invalid-argument','不支援的操作。');
  const [settings,draft,teacherDocs]=await Promise.all([ref.get(),draftRef.get(),db.collection('opsEducationMirrorTeachers').get()]);
  const teachers=teacherDocs.docs.map(d=>{const r=d.data().source||d.data();return {id:clean(r.id||d.id),name:clean(r.name)};}).filter(r=>r.id&&r.name);
  const profiles=await Promise.all(teachers.map(async t=>{const id=profileId(t.id);const [official,pending,publicDoc]=await Promise.all([db.collection('teacherPrivateProfiles').doc(id).get(),db.collection('teacherProfileDrafts').doc(id).get(),db.collection('externalTeacherProfiles').doc(id).get()]);const o=official.exists?official.data():{},p=pending.exists?pending.data():{},pub=publicDoc.exists?publicDoc.data():{},current=accountRow({name:o.bankAccountName||pub.bankAccountName,account:o.bankAccountNumber||pub.bankAccountNumber}),proposed=accountRow({name:p.privateProfile&&p.privateProfile.bankAccountName,account:p.privateProfile&&p.privateProfile.bankAccountNumber});return {teacherId:t.id,name:t.name,official:current,pending:proposed,pendingStatus:clean(p.status)};}));
  return {ok:true,revision:settings.exists?clean(settings.data().revision):'',accounts:settings.exists?settings.data().accounts||[]:[],manager:settings.exists?settings.data().manager||{}:{},draft:draft.exists?draft.data():{},profiles};
 };
}
module.exports={createPayrollTransfer,accountRow};
