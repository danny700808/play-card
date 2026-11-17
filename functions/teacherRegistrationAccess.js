'use strict';
const crypto=require('node:crypto');
const clean=v=>String(v??'').trim();
const emailOf=v=>clean(v).toLowerCase();
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const verified=v=>['bound','verified','已綁定','已驗證'].includes(clean(v));
const SOURCE='approved-teacher-registration-v1';
const ENTRY='https://danny700808.github.io/play-card/login.html?next=teacher-home.html';
const profileMetadata={portalProfileVersion:2,portalProfileSource:'course-portal-fresh-external-teacher-v2'};
const inactive=r=>!r||r.active===false||r.deleted===true||r.archived===true||r.hiddenFromActiveLists===true||[r.status,r.accountStatus,r.employmentStatus].some(v=>['revoked','disabled','archived','deleted','inactive','rejected'].includes(clean(v)));

// Called inside the existing manager approval transaction, before any writes.
// It grants the already-approved teacher role by verified email. LINE login is
// linked only by the teacher's later OAuth + email verification, never by name.
async function prepareApprovalAccess({db,tx,FieldValue,row,employeeId,teacherId,profileId,contractId,actor}){
 if(row.registrationOnly!==true||row.contractStatus!=='not_requested')return null;
 const email=emailOf(row.email);
 if(!verified(row.emailBindStatus)||!/^\S+@\S+\.\S+$/.test(email))return null;
 const bindingRef=db.collection('coursePortalTeacherBindings').doc(hash('approved-teacher-email|'+employeeId));
 const noticeRef=db.collection('notificationQueue').doc('teacher-registration-approved-'+contractId);
 const ownerSpecs=[['employees','email'],['employees','Email'],['employees','mail'],['employees','loginEmail'],['admins','email'],['admins','loginAccount']];
 const queries=[...ownerSpecs.map(([name,field])=>db.collection(name).where(field,'==',email)),db.collection('coursePortalTeacherBindings').where('emailNormalized','==',email),db.collection('coursePortalTeacherBindings').where('teacherId','==',teacherId)];
 const [stored,notice,...matches]=await Promise.all([tx.get(bindingRef),tx.get(noticeRef),...queries.map(q=>tx.get(q))]);
 if(matches.slice(0,6).some((match,i)=>match.docs.some(d=>i>=4||d.id!==employeeId)))throw Error('此 Email 已屬於其他人員，請先確認老師的登入 Email。');
 const bindings=[...new Map([...matches[6].docs,...matches[7].docs].map(d=>[d.id,d])).values()];
 if(bindings.some(d=>d.data().status==='active'&&(clean(d.data().teacherId)!==teacherId||emailOf(d.data().emailNormalized||d.data().email)!==email)))throw Error('老師的登入資料與其他身分衝突，請先確認。');
 if(stored.exists&&(inactive(stored.data())||stored.data().teacherId!==teacherId||emailOf(stored.data().emailNormalized)!==email))throw Error('老師原登入權限已停用或資料不一致，請先由管理者確認。');
 if(bindings.some(d=>['revoked','rejected','disabled'].includes(d.data().status)||clean(d.data().canonicalEmployeeId)&&d.data().canonicalEmployeeId!==employeeId))throw Error('老師原登入權限已停用或歸屬不一致，請先由管理者確認。');
 const existing=bindings.find(d=>d.data().status==='active'&&d.data().emailVerified===true&&clean(d.data().authAccountId));
 const ref=existing?existing.ref:bindingRef,previous=existing?existing.data():(stored.data()||{});
 const binding={...previous,type:'teacher',teacherId,email,emailNormalized:email,emailVerified:true,
  authAccountId:clean(previous.authAccountId)||'approved-teacher:'+hash(employeeId),
  name:clean(row.name||row.teacherName),status:'active',approvalStatus:'approved',
  personMasterId:employeeId,canonicalEmployeeId:employeeId,employeeId,linkedByManager:actor,
  linkedByManagerAt:previous.linkedByManagerAt||FieldValue.serverTimestamp(),
  registrationAccessSource:SOURCE,registrationProfileId:profileId,registrationContractId:contractId,
  updatedAt:FieldValue.serverTimestamp(),registeredAt:previous.registeredAt||FieldValue.serverTimestamp()};
 const body=[clean(row.name||row.teacherName)+'老師您好：','您的老師資料已核准，課表已開通。','',
  '請點登入入口：',ENTRY,'',
  '第一次：選「LINE 登入」，再使用本信箱收取六碼驗證碼，完成身分確認及 LINE 登入連結。之後用同一支 LINE 登入即可進入自己的課表。',
  '不方便用 LINE 時，也可以選「Email 登入」。不需要重填資料或貼綁定碼。',
  '銀行帳戶可稍後到「其他 → 我的資料」補填；契約日後另行通知。'].join('\n');
 return {write(){tx.set(ref,binding,{merge:true});if(!notice.exists)tx.set(noticeRef,{queueId:noticeRef.id,channel:'email',targetEmail:email,targetName:binding.name,targetRole:'teacher',title:'柚子樂器｜老師資料已核准，請登入課表',body,status:'pending',source:'teacher-registration-approved',contractId,employeeId,createdAt:FieldValue.serverTimestamp()});},profileMetadata,
  marker:{courseLoginReady:true,courseLoginBindingId:ref.id,courseLoginEntryUrl:ENTRY,approvalNoticeQueueId:noticeRef.id}};
}

async function registrationBindingActive(db,binding){
 if(binding.registrationAccessSource!==SOURCE)return true;
 const {approvedTeacherTarget}=require('./teacherManagerPreview');
 const target=await approvedTeacherTarget(db,clean(binding.teacherId));
 return !!target&&target.employeeId===clean(binding.canonicalEmployeeId)&&target.profileId===clean(binding.registrationProfileId)&&verified(target.profile.emailBindStatus)&&emailOf(target.profile.email)===emailOf(binding.emailNormalized)&&emailOf(target.employee.email)===emailOf(binding.emailNormalized);
}

// Only invoked after a real LINE OAuth ticket and the approved teacher's email
// OTP have both been verified. Reads are returned as a deferred write plan so
// the LINE login binding and contact sync commit in the same transaction.
async function prepareVerifiedLineContact({db,tx,FieldValue,account,lineProfile}){
 const employee=account.data;
 if(account.collection!=='employees'||employee.identityType!=='external'||employee.profileReviewStatus!=='approved'||!employee.externalTeacherProfileId)return null;
 const lineUserId=clean(lineProfile?.lineUserId);
 if(!/^U[a-f0-9]{32}$/i.test(lineUserId))throw Error('LINE 身分資料不完整，請重新登入。');
 const employeeRef=db.collection('employees').doc(account.id),profileRef=db.collection('externalTeacherProfiles').doc(employee.externalTeacherProfileId),contractRef=db.collection('externalTeacherContracts').doc(employee.externalTeacherProfileId);
 const [current,profile,contract,...owners]=await Promise.all([tx.get(employeeRef),tx.get(profileRef),tx.get(contractRef),...['employees','admins','coursePortalTeacherBindings'].map(name=>tx.get(db.collection(name).where('lineUserId','==',lineUserId))),...['employeeLineBindings','externalTeacherLineBindings'].map(name=>tx.get(db.collection(name).where('teacherId','==',employee.externalTeacherProfileId)))]);
 const row=current.data()||{},p=profile.data()||{},c=contract.data()||{};
 if(!current.exists||inactive(row)||row.accountStatus!=='active'||row.profileReviewStatus!=='approved'||!profile.exists||p.status!=='active'||p.employeeId!==account.id||p.coursePortalTeacherId!==row.coursePortalTeacherId||!contract.exists||c.status!=='active'||c.employeeId!==account.id||emailOf(row.email)!==emailOf(account.data.email))throw Error('老師資料已變更，請聯絡管理者確認。');
 if([row,p,c].some(r=>clean(r.lineUserId)&&r.lineUserId!==lineUserId)||owners[0].docs.some(d=>d.id!==account.id)||owners[1].docs.length||owners[2].docs.some(d=>!inactive(d.data())&&d.data().teacherId!==row.coursePortalTeacherId))throw Error('這支 LINE 與原有老師資料不一致，請聯絡管理者確認。');
 const patch={lineUserId,lineDisplayName:clean(lineProfile.displayName||lineProfile.lineDisplayName),lineBindStatus:'bound',lineNotifyEnabled:true,lineBoundAt:row.lineBoundAt||FieldValue.serverTimestamp(),lineLoginLinkedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()};
 if(owners.slice(3).some(s=>s.docs.some(d=>!inactive(d.data())&&clean(d.data().lineUserId)&&d.data().lineUserId!==lineUserId)))throw Error('原 LINE 綁定資料不一致，請聯絡管理者確認。');
 return {write(){for(const ref of [employeeRef,profileRef,contractRef])tx.set(ref,patch,{merge:true});for(const s of owners.slice(3))for(const d of s.docs)if(!inactive(d.data())&&d.data().targetCollection==='externalTeacherContracts')tx.set(d.ref,{...patch,status:'bound',employeeId:account.id,boundAt:patch.lineBoundAt},{merge:true});}};
}
module.exports={prepareApprovalAccess,registrationBindingActive,prepareVerifiedLineContact,SOURCE,ENTRY};
