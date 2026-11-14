'use strict';
const crypto=require('node:crypto');
const {prepareTeachingAbilitySubjects,profileAssignmentPatch,mergeTeacherRows,TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION}=require('./courseSubjectCatalog');
const clean=v=>String(v==null?'':v).trim();
const digits=v=>clean(v).replace(/\D/g,'');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex').slice(0,24);
const identity=row=>[clean(row.name||row.teacherName||row.displayName),digits(row.mobile||row.mobilePhone||row.phone)].join('|');
function assertReady(row){
 if(!['submitted_pending_admin','active'].includes(clean(row.status)))throw Error('老師尚未送出待確認資料，不能啟用排課。');
 if(!clean(row.signatureUrl))throw Error('缺少老師簽名，不能核准。');
 if(!clean(row.name||row.teacherName)||!digits(row.mobile||row.phone))throw Error('缺少老師姓名或手機。');
 if(!['bound','verified','已綁定','已驗證'].includes(clean(row.lineBindStatus))&&!['bound','verified','已綁定','已驗證'].includes(clean(row.emailBindStatus)))throw Error('老師尚未完成 LINE 或 Email 綁定。');
 if(!Array.isArray(row.teachingAbilities)||!row.teachingAbilities.length||row.teachingAbilities.some(a=>!clean(a.level)))throw Error('請先補齊授課科目與程度。');
}
function createTeacherApprovalSync({db,FieldValue}){
 return async function approve(contractId,actor){
 if(!/^[A-Za-z0-9_-]{1,150}$/.test(clean(contractId)))throw Error('合約編號格式錯誤。');
 const contractRef=db.collection('externalTeacherContracts').doc(contractId),initial=await contractRef.get();
 if(!initial.exists)throw Error('找不到這筆老師資料。');const row=initial.data();assertReady(row);
 const [plan,employees,mirror,assignments]=await Promise.all([
 prepareTeachingAbilitySubjects({db,FieldValue,abilities:row.teachingAbilities,requireExisting:true}),
 db.collection('employees').get(),db.collection('opsEducationMirrorTeachers').get(),db.collection(TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION).get()]);
 const matches=employees.docs.filter(d=>identity(d.data())===identity(row));
 const explicitEmployee=clean(row.employeeId||row.externalTeacherEmployeeId);
 if(!explicitEmployee&&matches.length>1)throw Error('找到多筆同姓名與手機的人員，請先確認歸屬。');
 const employeeId=explicitEmployee||(matches[0]&&matches[0].id)||'EXTEMP_'+hash(identity(row));
 const employeeRef=db.collection('employees').doc(employeeId),existingEmployee=await employeeRef.get();
 const employee=existingEmployee.exists?existingEmployee.data():{};
 if(existingEmployee.exists&&!['external','externalTeacher'].includes(clean(employee.identityType||employee.employeeType||employee.role))&&!employee.isExternalTeacher)throw Error('此人員不是外聘老師，請先確認人員歸屬。');
 const teachers=mergeTeacherRows(mirror.docs.map(d=>({...d.data().source})),assignments.docs);
 const matchingTeachers=teachers.filter(t=>identity(t)===identity(row));
 const linkedTeacher=clean(row.coursePortalTeacherId||employee.coursePortalTeacherId);
 if(!linkedTeacher&&matchingTeachers.length>1)throw Error('找到多筆排課老師，請先確認歸屬。');
 const teacherId=linkedTeacher||(matchingTeachers[0]&&matchingTeachers[0].id)||'external-'+hash(employeeId);
 if(teacherId.includes('/')||employeeId.includes('/'))throw Error('老師識別碼格式錯誤。');
 const assignmentRef=db.collection(TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION).doc(teacherId);
 const profileId=clean(row.externalTeacherProfileId||row.portalProfileId||contractId);
 if(profileId.includes('/'))throw Error('老師資料識別碼格式錯誤。');
 const profileRef=db.collection('externalTeacherProfiles').doc(profileId),versionRef=db.collection('coursePortalRuntime').doc('scheduleVersion');
 await db.runTransaction(async tx=>{
 const [current,employeeNow,assignment,version]=await Promise.all([tx.get(contractRef),tx.get(employeeRef),tx.get(assignmentRef),tx.get(versionRef)]);
 const latest=current.data()||{};assertReady(latest);
 for(const field of ['name','teacherName','mobile','phone','signatureUrl','teachingAbilities'])if(JSON.stringify(latest[field])!==JSON.stringify(row[field]))throw Error('老師資料剛剛已更新，請重新整理再核准。');
 if(clean(employeeNow.data()?.coursePortalTeacherId)&&employeeNow.data().coursePortalTeacherId!==teacherId)throw Error('老師歸屬剛剛已變更，請重新整理。');
 const prior=assignment.exists?assignment.data():{};
 if(prior.employeeId&&prior.employeeId!==employeeId)throw Error('排課老師已屬於另一位人員，請先確認歸屬。');
 for(const [field,expected] of [['employeeId',employeeId],['externalTeacherEmployeeId',employeeId],['coursePortalTeacherId',teacherId]])if(clean(latest[field])&&clean(latest[field])!==expected)throw Error('老師歸屬剛剛已變更，請重新整理。');
 const subjects=profileAssignmentPatch(prior,plan.allSubjectIds,{teacherId,employeeId,profileId,activeProfileSubjectIds:plan.subjectIds,source:'approved-external-teacher',nowText:new Date().toISOString()},FieldValue);
 const common={employeeId,externalTeacherEmployeeId:employeeId,coursePortalTeacherId:teacherId,employeeRef:'employees/'+employeeId,updatedAt:FieldValue.serverTimestamp()};
 const status={status:'active',profileStatus:'active',contractStatus:'active',progressStatus:'管理端已確認，契約生效',confirmedBy:actor,confirmedAt:FieldValue.serverTimestamp()};
 tx.set(employeeRef,{...common,name:clean(row.name||row.teacherName),displayName:clean(row.name||row.teacherName),mobile:clean(row.mobile||row.phone),phone:clean(row.mobile||row.phone),email:clean(row.email),lineUserId:clean(row.lineUserId||employee.lineUserId),lineBindStatus:clean(row.lineBindStatus),identityType:'external',employeeType:'externalTeacher',role:'externalTeacher',isExternalTeacher:true,accountStatus:'active',employmentStatus:'active',hiddenFromActiveLists:false,currentExternalContractId:contractId,externalTeacherContractId:contractId,externalTeacherProfileId:profileId,portalProfileId:profileId,teachingAbilities:plan.abilities,subjectIds:subjects.effectiveSubjectIds,latestExternalContractStatus:'active',profileReviewStatus:'approved'}, {merge:true});
 tx.set(assignmentRef,{...subjects,managerProfile:{...(prior.managerProfile||{}),name:clean(row.name||row.teacherName),phone:clean(row.mobile||row.phone),active:true},updatedBy:actor},{merge:true});
 tx.set(contractRef,{...common,...status,teachingAbilities:plan.abilities},{merge:true});
 tx.set(profileRef,{...common,...status,name:clean(row.name||row.teacherName),mobile:clean(row.mobile||row.phone),teachingAbilities:plan.abilities},{merge:true});
 tx.set(versionRef,{version:Number(version.data()?.version||0)+1,updatedAt:FieldValue.serverTimestamp(),updatedBy:'teacher-approval-sync'},{merge:true});
 });
 return {ok:true,status:'active',teacherId,employeeId,message:'已核准老師並同步排課名單與授課科目。'};
 };
}
module.exports={createTeacherApprovalSync};
