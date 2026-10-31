'use strict';
const {HttpsError}=require('firebase-functions/v2/https');
const {findAccount,accountStatus,normalizeUser}=require('./employeeAuth');
const clean=v=>String(v??'').trim();
const active=row=>['active','enabled','啟用','是'].includes(accountStatus(row));
const PROFILE_FIELDS={mobilePhone:'手機',birthDate:'生日',idNumber:'證件號碼',address:'聯絡地址',householdAddress:'戶籍地址',emergencyContact:'緊急聯絡人',emergencyPhone:'緊急聯絡電話',paymentMethod:'領薪方式',bankCode:'銀行代碼',bankName:'銀行名稱',bankAccount:'薪資帳號',accountName:'戶名'};
const PROFILE_ALIASES={mobilePhone:['phone','mobile','行動電話'],birthDate:['birthday','出生年月日'],idNumber:['身分證字號'],address:['contactAddress','聯絡地址'],householdAddress:['戶籍地址'],emergencyContact:['緊急聯絡人'],emergencyPhone:['emergencyContactPhone','緊急聯絡人電話'],bankCode:['銀行代碼'],bankName:['銀行名稱'],bankAccount:['bankAccountNumber','銀行帳號'],accountName:['bankAccountName','戶名']};
function profileOf(row){return Object.fromEntries(Object.keys(PROFILE_FIELDS).map(key=>[key,[key,...(PROFILE_ALIASES[key]||[])].map(k=>clean(row[k])).find(Boolean)||'']));}
function reviewedProfilePatch(requestRow,current,docId){
 const canonicalId=clean(current.employeeId||current['員工ID']||docId);
 if(canonicalId!==clean(requestRow.employeeId))throw new HttpsError('failed-precondition','人員歸屬不一致。');
 const before=profileOf(current),patch={};
 for(const change of requestRow.changes||[]){
  if(!Object.hasOwn(PROFILE_FIELDS,change.key))throw new HttpsError('failed-precondition','申請含有不支援的欄位。');
  if(before[change.key]!==clean(change.before))throw new HttpsError('failed-precondition','正式資料已有變更，請退回員工重新確認。');
  patch[change.key]=clean(change.after);
  if(change.key==='address')patch.contactAddress=patch.address;
 }
 return patch;
}
function createPersonalWorkspace({db,auth,FieldValue,findPortalAccount,issuePortalSession,requirePortalSession,teacherRoster,teacherRead,portalRoleRead}){
 async function employee(request){
  const token=request?.auth?.token;
  if(token?.employee!==true)throw new HttpsError('unauthenticated','請先登入。');
  const account=await findAccount(db,clean(token.email).toLowerCase());
  if(!account||!active(account.data))throw new HttpsError('permission-denied','帳號尚未啟用。');
  const user=normalizeUser(account);
  if(user.employeeId!==clean(token.employeeId))throw new HttpsError('permission-denied','登入身分不一致。');
  return {account,user};
 }
 async function portalEmployee(data){
  const session=await requirePortalSession(data,['teacher','renter']);
  const collection=session.role==='teacher'?'coursePortalTeacherBindings':'coursePortalRenterBindings';
  // Only a verified, active binding belonging to this exact session can bridge.
  const field=session.authAccountId?'authAccountId':'lineUserId',value=clean(session[field]);
  if(!value)return null;
  const snap=await db.collection(collection).where(field,'==',value).get();
  const rows=snap.docs.map(d=>d.data()).filter(r=>r.status==='active'&&r.emailVerified===true&&
   (session.role!=='teacher'||clean(r.teacherId)===clean(session.teacherId))&&
   (session.role!=='renter'||clean(r.renterId)===clean(session.renterId)));
  const emails=[...new Set(rows.map(r=>clean(r.emailNormalized).toLowerCase()).filter(Boolean))];
  if(emails.length!==1)return null;
  const account=await findAccount(db,emails[0]);
  if(!account||account.collection!=='employees'||!active(account.data))return null;
  const user=normalizeUser(account);
  if(!['staff','parttime'].includes(user.identityType)||user.isManagerAccount)return null;
  const firebaseUser=await auth.getUserByEmail(emails[0]).catch(e=>{if(e.code==='auth/user-not-found')return null;throw e;});
  const claims=firebaseUser?.customClaims;
  if(!firebaseUser||firebaseUser.disabled||claims?.employee!==true||claims.manager===true||clean(claims.employeeId)!==user.employeeId)return null;
  return {user,firebaseUser};
 }
 async function handle(data,request){
  const action=clean(data.action)||'overview';
  if(['portal-capabilities','employee-entry'].includes(action)){
   const found=await portalEmployee(data);
   if(action==='portal-capabilities')return {ok:true,employee:found?{identityType:found.user.identityType,label:found.user.identityLabel}:null};
   if(!found)throw new HttpsError('permission-denied','尚未連結已啟用的員工帳號，請使用原員工帳號登入。');
   // Reuses existing claims. Never creates an employee, changes a password, or grants roles.
   return {ok:true,user:found.user,token:await auth.createCustomToken(found.firebaseUser.uid)};
  }
  let {account,user}=await employee(request);
  if(clean(data.expectedEmployeeId)&&clean(data.expectedEmployeeId)!==user.employeeId)throw new HttpsError('permission-denied','帳號已切換，請重新開啟工作台。');
  if(['preview-roster','preview','preview-month','teacher-read','preview-role-read'].includes(action)){
   if(request.auth.token.manager!==true||!user.isManagerAccount)throw new HttpsError('permission-denied','僅管理者可檢視員工畫面。');
   if(action==='preview-roster'){
    const snapshot=await db.collection('employees').get();
    const rows=snapshot.docs.flatMap(doc=>{const row=doc.data(),person=normalizeUser({collection:'employees',id:doc.id,data:row});return active(row)&&!person.isManagerAccount&&['staff','parttime'].includes(person.identityType)?[{id:doc.id,employeeId:person.employeeId,name:person.name,identityType:person.identityType,identityLabel:person.identityLabel}]:[];});
    const teachers=teacherRoster?await teacherRoster():[];
    return {ok:true,rows:rows.concat(teachers.map(t=>({...t,id:'teacher:'+t.id,teacherId:t.id})))};
   }
   if(action==='teacher-read')return teacherRead(clean(data.teacherId),clean(data.method),data.payload||{});
   const id=clean(data.employeeDocId);if(!id||id.includes('/'))throw new HttpsError('invalid-argument','請選擇員工。');
   const doc=await db.collection('employees').doc(id).get();if(!doc.exists||!active(doc.data()))throw new HttpsError('not-found','找不到已啟用的人員資料。');
   account={collection:'employees',id:doc.id,ref:doc.ref,data:doc.data()};user=normalizeUser(account);
   if(user.isManagerAccount||!['staff','parttime'].includes(user.identityType))throw new HttpsError('permission-denied','請選擇工讀生或專職人員。');
  }
  if(action==='preview-role-read'){
   const role=clean(data.role);if(!['teacher','renter'].includes(role))throw new HttpsError('permission-denied','不支援此身分。');
   const linked=await findPortalAccount(role,user.email);if(!linked)throw new HttpsError('permission-denied','尚未連結此身分。');
   return portalRoleRead(role,role==='renter'?linked.renterId:linked.targetId,clean(data.method),data.payload||{});
  }
  if(action==='payroll-month'||action==='preview-month')return require('./personalPayroll').monthData(db,account,user,clean(data.month));
  if(action==='open-role'){
   const role=clean(data.role);if(!['teacher','renter'].includes(role))throw new HttpsError('invalid-argument','不支援的功能。');
   const linked=await findPortalAccount(role,user.email);
   if(!linked)throw new HttpsError('permission-denied','尚未完成這個身分的核准與綁定。');
   return {ok:true,role,...await issuePortalSession({...linked,authMethod:'employee-verified-account'})};
  }
  if(action==='overview'||action==='preview'){
   const [teacher,renter,changes]=await Promise.all([
    findPortalAccount('teacher',user.email),findPortalAccount('renter',user.email),
    db.collection('profileChangeRequests').where('employeeId','==',user.employeeId).get()
   ]);
   const profile=profileOf(account.data);
   return {ok:true,readOnly:action==='preview',user,profile,hireDate:clean(account.data.hireDate||account.data.startDate||account.data['到職日']),missingFields:Object.keys(PROFILE_FIELDS).filter(k=>!profile[k]&&!(profile.paymentMethod==='cash'&&['bankCode','bankName','bankAccount','accountName'].includes(k))),
    capabilities:{attendance:['staff','parttime'].includes(user.identityType),teacher:!!teacher,renter:!!renter},
    profilePending:changes.docs.some(d=>['pending','pending_review','待審核','未處理'].includes(clean(d.data().approvalStatus||d.data().status)))};
  }
  if(action==='profile-submit'){
   if(!['staff','parttime'].includes(user.identityType))throw new HttpsError('permission-denied','請使用您的專屬資料入口。');
   const payload=data.profile||{},patch={};
   for(const key of Object.keys(PROFILE_FIELDS))if(Object.hasOwn(payload,key)){
    const value=clean(payload[key]);if(value.length>300)throw new HttpsError('invalid-argument','欄位內容過長。');
    if(value)patch[key]=value;
   }
   if(patch.paymentMethod&&!['bank','cash'].includes(patch.paymentMethod))throw new HttpsError('invalid-argument','請選擇領薪方式。');
   if(patch.paymentMethod==='cash')for(const k of ['bankCode','bankName','bankAccount','accountName'])delete patch[k];
   if(patch.bankAccount&&!/^\d{8,20}$/.test(patch.bankAccount))throw new HttpsError('invalid-argument','請填寫 8～20 碼銀行帳號。');
   if(patch.birthDate&&!/^\d{4}-\d{2}-\d{2}$/.test(patch.birthDate))throw new HttpsError('invalid-argument','生日格式不正確。');
   const ref=db.collection('profileChangeRequests').doc(),lockRef=db.collection('employeeMobileProfileLocks').doc(account.id);
   await db.runTransaction(async tx=>{
    const [latest,lock]=await Promise.all([tx.get(account.ref),tx.get(lockRef)]);
    const previousId=lock.exists?clean(lock.data().requestId):'';
    const previous=previousId?await tx.get(db.collection('profileChangeRequests').doc(previousId)):null;
    if(!latest.exists||!active(latest.data()))throw new HttpsError('permission-denied','帳號尚未啟用。');
    if(previous?.exists&&['pending','pending_review','待審核'].includes(clean(previous.data().approvalStatus||previous.data().status)))throw new HttpsError('failed-precondition','已有資料送交主管，請等候處理。');
    const before=profileOf(latest.data());
    const changes=Object.keys(patch).filter(k=>patch[k]!==before[k]).map(key=>({key,label:PROFILE_FIELDS[key],before:before[key],after:patch[key]}));
    if(!changes.length)throw new HttpsError('failed-precondition','資料沒有變更。');
    tx.set(ref,{requestId:ref.id,employeeId:user.employeeId,employeeDocId:account.id,name:user.name,identityType:user.identityType,
     ...Object.fromEntries(changes.map(c=>[c.key,c.after])),changes,status:'待審核',approvalStatus:'pending',source:'employee-mobile',createdAt:FieldValue.serverTimestamp()});
    tx.set(lockRef,{requestId:ref.id});
   });return {ok:true,message:'已送交主管。'};
  }
  throw new HttpsError('invalid-argument','不支援的操作。');
 }
 return {handle};
}
module.exports={createPersonalWorkspace,PROFILE_FIELDS,profileOf,reviewedProfilePatch};
