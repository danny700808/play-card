'use strict';
const {HttpsError}=require('firebase-functions/v2/https');
const {findAccount,accountStatus,normalizeUser,isManager}=require('./employeeAuth');
const crypto=require('node:crypto');
const GOODS_COLLECTIONS=new Set(['teacherGoods','teacherGoodsInquiry','websiteProducts','officialWebsiteProducts','easystoreProducts','websiteGoods','products']);
const OWN_COLLECTIONS=new Set(['employees','employeeSalaryConfigs','employeeSalaryConfigHistory','employeeSalarySettings','salaryProfiles','parttimeRecords','parttimeHourRequests','clockRecords','clockCorrections','leaveRecords','leaveRequests','temporaryAttendanceRequests','employeeSchedules','singleDaySchedules','profileChangeRequests','certificateApplications','formSubmissions']);
const SHARED_COLLECTIONS=new Set(['announcements','trainingItems','routines','routineTemplates','scheduleTemplates','leavePolicySettings','printTemplates','formSettings']);
const REQUEST_COLLECTIONS=new Set(['parttimeRecords','parttimeHourRequests','clockRecords','clockCorrections','leaveRequests','temporaryAttendanceRequests','profileChangeRequests','certificateApplications','formSubmissions']);
const OWNER_FIELDS=['assigneeId','employeeId','userId','員工ID','targetEmployeeId','applicantId'];
const pick=(row,fields)=>Object.fromEntries(fields.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
const clean=v=>String(v==null?'':v).trim();
function owns(row,id,user){if(!row||typeof row!=='object')return false;const primary=clean(row.employeeId||row['員工ID']||row.userId||row.applicantId);if(primary)return primary===user.employeeId;if(id===user.employeeId)return true;return ['email','Email','userEmail','employeeEmail'].some(field=>user.email&&clean(row[field]).toLowerCase()===user.email);}
function scrub(row){const out={...row};for(const key of Object.keys(out)){if(/password|passwd|密碼|resetToken|passwordHash/i.test(key))delete out[key];}return out;}
function createEmployeeDataGateway({db,FieldValue,Filter,queueManager,queueEmail,getManager,resolveTeacher}){
  async function identity(request,data={}){
    if(data.sessionToken&&resolveTeacher){
      if(!GOODS_COLLECTIONS.has(clean(data.collection)))throw new HttpsError('permission-denied','老師課務入口請使用對應的安全服務。');
      const resolved=await resolveTeacher(data),id=clean(resolved.employeeId||resolved.user.employeeId),ref=db.collection('employees').doc(id),doc=await ref.get();
      if(!doc.exists)throw new HttpsError('permission-denied','找不到老師主檔。');
      return {account:{id,ref,data:doc.data()},user:{...resolved.user,employeeId:id}};
    }
    const token=request&&request.auth&&request.auth.token;
    if(!token||token.employee!==true)throw new HttpsError('unauthenticated','請先登入員工帳號。');
    const account=await findAccount(db,clean(token.email).toLowerCase());
    if(!account||!['active','enabled','啟用','是'].includes(accountStatus(account.data)))throw new HttpsError('permission-denied','帳號目前未啟用。');
    const user=normalizeUser(account);if(clean(token.employeeId)!==user.employeeId)throw new HttpsError('permission-denied','帳號身分不一致。');
    return {account,user};
  }
  async function read(data,request){
    const {account,user}=await identity(request,data),collection=clean(data.collection),id=clean(data.id);
    if(!OWN_COLLECTIONS.has(collection)&&!SHARED_COLLECTIONS.has(collection)&&!GOODS_COLLECTIONS.has(collection)&&!['tasks','salarySetup','salarySettings','salaryConfigs','systemSettings'].includes(collection))throw new HttpsError('permission-denied','此資料需要管理者權限。');
    let docs;
    if(id){const doc=await db.collection(collection).doc(id).get();docs=doc.exists?[doc]:[];}
    else if(OWN_COLLECTIONS.has(collection)){
      const result=new Map();
      if(collection==='employees'){const doc=await account.ref.get();if(doc.exists)result.set(doc.id,doc);}
      else{
        const direct=await db.collection(collection).doc(user.employeeId).get();if(direct.exists)result.set(direct.id,direct);
        const filters=OWNER_FIELDS.map(field=>Filter.where(field,'==',user.employeeId));
        if(user.email)for(const field of ['email','Email','userEmail','employeeEmail'])filters.push(Filter.where(field,'==',user.email));
        const snapshot=await db.collection(collection).where(Filter.or(...filters)).limit(2000).get();
        snapshot.docs.forEach(doc=>result.set(doc.id,doc));
      }
      docs=[...result.values()];
    }else docs=(await db.collection(collection).limit(2000).get()).docs;
    return {ok:true,rows:docs.flatMap(doc=>{
      let row=doc.data()||{};
      if(collection==='teacherGoodsInquiry'&&!owns(row,doc.id,user))return [];
      if(collection==='teacherGoods'&&(row.enabled===false||row.deleted===true))return [];
      if(OWN_COLLECTIONS.has(collection)&&!(collection==='employees'&&doc.id===account.id)&&!owns(row,doc.id,user))return [];
      if(collection==='tasks'&&clean(row.assigneeId||row.employeeId)!==user.employeeId&&!['all','全體','全部'].includes(clean(row.targetEmployeeId||row.assigneeId||row.target)))return [];
      if(['salarySetup','salarySettings','salaryConfigs'].includes(collection)&&!owns(row,doc.id,user)){
        // Legacy pages expect a map-shaped response, but only this employee's entry leaves the server.
        const safe={};for(const field of ['employeeConfigMap','employeeConfigs','salaryConfigMap','configMap','configs']){const map=row[field];if(map&&typeof map==='object'&&!Array.isArray(map)){safe[field]={};for(const [key,value] of Object.entries(map))if([user.employeeId,account.id,user.email].includes(key)||owns(value,key,user))safe[field][key]=scrub(value);}}
        for(const field of ['employees','rows','list','employeeConfigsList'])if(Array.isArray(row[field]))safe[field]=row[field].filter(item=>owns(item,clean(item.id||item.__id),user)).map(scrub);
        row=safe;
      }
      if(collection==='systemSettings'){
        if(['工讀預設時薪','公司名稱','公司地址','公司IP','CLOCK_ALLOWED_IP'].includes(doc.id))return [{id:doc.id,data:pick(row,['key','value','設定值'])}];
        if(!['clock','attendance','leave','company','workTime','default'].includes(doc.id))return [];
        const safe={};for(const field of ['companyName','companyAddress','workStartTime','workEndTime','lateGraceMinutes','clockAllowedIps','allowedIps','clockLocations','timezone'])if(row[field]!==undefined)safe[field]=row[field];row=safe;
      }
      return [{id:doc.id,data:scrub(row)}];
    })};
  }
  async function selfService(data,request){
    const {account,user}=await identity(request,data),action=clean(data.action),input=data.payload||{};
    if(JSON.stringify(input).length>40000)throw new HttpsError('invalid-argument','資料過大。');
    if(action==='goods-inquiry'){
      const id=clean(data.id);if(!/^[A-Za-z0-9_-]{1,150}$/.test(id))throw Error('詢價編號不正確。');
      const row=pick(input,['sourceType','itemId','itemName','imageUrl','quantity','needBy','note','websiteProductId','websiteProductUrl','websiteOriginalPrice','websiteVariantSummary','websiteSource']);
      Object.assign(row,{inquiryId:id,userId:user.employeeId,teacherId:user.employeeId,teacherName:user.name,status:'待處理',createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),source:'protected-teacher-goods-inquiry'});
      await db.runTransaction(async tx=>{const ref=db.collection('teacherGoodsInquiry').doc(id),old=await tx.get(ref);if(old.exists){if(!owns(old.data(),id,user))throw Error('詢價編號已使用。');return;}tx.create(ref,row);});
      return {ok:true,inquiryId:id};
    }
    const before=account.data,line=clean(before.lineUserId||before['LINE User ID']),pref=clean(input.notificationPreference)||(line?'both':'email');
    if(!['line','email','both'].includes(pref))throw Error('請選擇通知方式。');
    if(action==='ensureEmployeeLineBindCode'){
      const code=(!input.forceNew&&clean(before.employeeBindCode||before.bindingCode||before.lineBindingCode))||'EMP-'+crypto.randomBytes(18).toString('hex').toUpperCase(),text='柚子人員綁定 '+code;
      const batch=db.batch();batch.set(account.ref,{employeeBindCode:code,bindingCode:code,employeeBindText:text,updatedAt:FieldValue.serverTimestamp()},{merge:true});
      batch.set(db.collection('employeeLineBindings').doc(code),{bindingCode:code,employeeBindCode:code,bindText:text,employeeId:user.employeeId,employeeDocId:account.id,targetCollection:'employees',status:line?'bound':'pending',name:user.name,email:user.email,updatedAt:FieldValue.serverTimestamp()},{merge:true});await batch.commit();
      return {ok:true,employeeBindCode:code,employeeBindText:text,bindText:text};
    }
    if(action==='saveMyNotificationSettings'||action==='setLineNotifyPreference'){
      const chosen=action==='setLineNotifyPreference'?(input.enabled===true||input.enabled==='是'?'both':'email'):pref;
      if(input.clearBinding)throw Error('更換 LINE 登入請使用帳號綁定設定。');
      if(clean(input.email)&&clean(input.email).toLowerCase()!==user.email)throw Error('更換登入 Email 請提交個人資料修改申請。');
      if(chosen==='line'&&!line)throw Error('請先完成 LINE 綁定。');
      const patch={notificationPreference:chosen,notificationMethod:chosen,notificationPreferenceLabel:chosen==='line'?'只用 LINE':chosen==='email'?'只用 Email':'LINE + Email',lineNotifyEnabled:!!line&&chosen!=='email',updatedAt:FieldValue.serverTimestamp()};
      await account.ref.set(patch,{merge:true});return {ok:true,message:'通知設定已儲存。',user:{...user,...patch}};
    }
    throw new HttpsError('permission-denied','不支援的個人設定。');
  }
  async function notify(data,request){
    const {user}=await identity(request),feature=clean(data.featureCode),direction=clean(data.direction);
    if(!['clock','leave','parttimePayroll','profileChange','certificate','registration','temporaryAttendance'].includes(feature)||!['manager','employee'].includes(direction))throw new HttpsError('permission-denied','不支援的通知項目。');
    const settingDoc=await db.collection('notificationFeatureSettings').doc(feature).get(),setting=settingDoc.exists?settingDoc.data():{};
    if(setting.enabled===false)return {ok:true,skipped:true};
    const body=user.name+'（'+user.employeeId+'）\n'+clean(data.message).slice(0,2000),title='員工申請通知';
    if(direction==='manager'){
      if(setting.notifyManagerLine===false&&setting.notifyManagerEmail!==true)return {ok:true,skipped:true};
      const primary=await getManager();let managers;
      if(primary&&primary.source==='PRIMARY_MANAGER_LINE')managers=[primary];
      else managers=(await db.collection('employees').limit(1000).get()).docs.filter(doc=>isManager(doc.data(),'employees')&&['active','enabled','啟用','是'].includes(accountStatus(doc.data()))).map(doc=>normalizeUser({id:doc.id,collection:'employees',data:doc.data()}));
      if(!managers.length&&primary)managers=[primary];
      for(const manager of managers)await queueEmail({title,body,source:'employee-'+feature,channel:setting.notifyManagerLine!==false&&manager.lineUserId?'line':'email',emailFallbackEnabled:!!manager.email,targetEmployeeId:manager.employeeId,targetLineUserId:manager.lineUserId||'',targetEmail:manager.email||'danny700808@gmail.com',targetName:manager.name||'主管'});
    }else{
      if(setting.notifyEmployeeLine===false&&setting.notifyEmployeeEmail!==true)return {ok:true,skipped:true};
      await queueEmail({title,body,source:'employee-'+feature,channel:setting.notifyEmployeeLine!==false&&user.lineUserId?'line':'email',targetEmployeeId:user.employeeId,targetLineUserId:user.lineUserId,targetEmail:user.email,targetName:user.name});
    }
    return {ok:true};
  }
  return {read,notify,selfService};
}
module.exports={createEmployeeDataGateway,owns,scrub};
