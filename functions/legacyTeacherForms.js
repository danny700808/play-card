'use strict';
const {validateAssetUrl}=require('./privateContractAssets');
const defaultTemplate=require('./legacyTeacherContractTemplate.json');
const crypto=require('node:crypto');
const clean=v=>String(v==null?'':v).trim();
const PROFILE_FIELDS=['name','mobile','email','teachingItems','teachingItemsText','teachingAbilities','bindingMethod','idNumber','birthDate','householdAddress','mailingAddress','address','contactAddress','emergencyContact','emergencyPhone'];
const SIGNED_FIELDS=['identityUrls','signatureUrl','contractHtmlUrl','signedDate'];
const LOCKED=new Set(['submitted_pending_admin','active','approved','confirmed','effective','signed','已生效','已確認','已核准','已簽核','已送出','contract_effective','completed','complete','管理端已確認，契約生效','契約生效','完成']);
function pick(data,fields){const result={};for(const field of fields)if(data[field]!==undefined)result[field]=data[field];return result;}
function publicRow(row){const copy={...row};delete copy.emailVerificationToken;return copy;}
function createLegacyTeacherForms({db,FieldValue,baseUrl,queueEmail,queueManager}){
  const ref=id=>{if(!/^[A-Za-z0-9_-]{1,150}$/.test(clean(id)))throw Error('簽約連結不完整。');return db.collection('externalTeacherContracts').doc(id);};
  async function authorize(id,token){const doc=await ref(id).get();if(!doc.exists)throw Error('找不到簽約資料。');const row=doc.data();if(!clean(token)||![row.bindingCode,row.onboardingToken].map(clean).filter(Boolean).includes(clean(token)))throw Error('簽約連結驗證失敗。');return {ref:doc.ref,row:{...row,id:doc.id}};}
  function bound(row){return ['bound','verified','已綁定','已驗證'].includes(clean(row.lineBindStatus))||['bound','verified','已綁定','已驗證'].includes(clean(row.emailBindStatus));}
  async function template(){const doc=await db.collection('externalTeacherContractTemplates').doc('current').get();return {ok:true,template:doc.exists?{...defaultTemplate,...doc.data()}:defaultTemplate};}
  async function read(data){
    const {ref:docRef,row}=await authorize(data.id,data.token);
    const profile=await db.collection('externalTeacherProfiles').doc(data.id).get();
    if(profile.exists&&profile.data().lineUserId&&row.lineBindStatus!=='bound'){
      const update={lineUserId:profile.data().lineUserId,lineDisplayName:profile.data().lineDisplayName||'',lineBindStatus:'bound',updatedAt:FieldValue.serverTimestamp()};
      await docRef.set(update,{merge:true});Object.assign(row,update);
    }
    return {ok:true,record:publicRow(row)};
  }
  async function create(data){
    const input=data.record||{};if(JSON.stringify(input).length>80000)throw Error('基本資料過大。');
    const basic=pick(input,PROFILE_FIELDS);basic.name=clean(basic.name);basic.mobile=clean(basic.mobile);basic.email=clean(basic.email).toLowerCase();
    if(!basic.name||!basic.mobile||!['line','email','both'].includes(basic.bindingMethod))throw Error('請完整填寫基本資料。');
    if(basic.bindingMethod!=='line'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(basic.email))throw Error('請填寫正確 Email。');
    let docRef,old={};
    if(data.id){const existing=await authorize(data.id,data.token);docRef=existing.ref;old=existing.row;if(LOCKED.has(clean(old.status)))throw Error('契約已送出或確認，請由管理者退回補件。');}
    else docRef=db.collection('externalTeacherContracts').doc();
    const code=clean(old.bindingCode||old.onboardingToken)||'EMP-'+crypto.randomBytes(18).toString('hex').toUpperCase();
    const emailNonce=crypto.randomBytes(24).toString('base64url');
    const year=Number(input.contractYear),currentYear=new Date().getFullYear();if(!Number.isInteger(year)||year<currentYear-1||year>currentYear+2)throw Error('合約年度不正確。');
    const url=new URL('external-teacher-onboarding.html',baseUrl);url.search=new URLSearchParams({id:docRef.id,code}).toString();
    const row={...basic,id:docRef.id,teacherId:docRef.id,employeeId:clean(old.employeeId),externalTeacherEmployeeId:clean(old.employeeId),bindingCode:code,onboardingToken:code,employeeBindCode:code,employeeBindText:'柚子人員綁定 '+code,onboardingUrl:url.href,contractYear:year,contractRocYear:year-1911,contractStartDate:year>currentYear?year+'-01-01':new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date()),contractEndDate:year+'-12-31',lineBindStatus:old.lineBindStatus||'pending',emailBindStatus:old.email===basic.email?(old.emailBindStatus||'pending'):'pending',emailVerificationToken:emailNonce,status:bound(old)?'waiting_contract':'waiting_bindings',createdAt:old.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
    const batch=db.batch();batch.set(docRef,row,{merge:true});batch.set(db.collection('externalTeacherProfiles').doc(docRef.id),row,{merge:true});
    if(row.bindingMethod!=='email'&&row.lineBindStatus!=='bound'){
      const binding={bindingCode:code,bindCode:code,employeeBindCode:code,bindText:row.employeeBindText,teacherId:docRef.id,externalTeacherContractId:docRef.id,targetCollection:'externalTeacherContracts',employeeId:row.employeeId,employeeDocId:row.employeeId,name:row.name,teacherName:row.name,email:row.email,mobile:row.mobile,mobilePhone:row.mobile,bindingMethod:row.bindingMethod,onboardingToken:code,onboardingUrl:url.href,status:'pending',createdAt:row.createdAt,updatedAt:row.updatedAt};
      batch.set(db.collection('externalTeacherLineBindings').doc(code),binding,{merge:true});batch.set(db.collection('employeeLineBindings').doc(code),binding,{merge:true});
    }
    if(row.bindingMethod!=='line'&&row.emailBindStatus!=='bound'){
      url.searchParams.set('verify','email');url.searchParams.set('emailToken',emailNonce);
      await queueEmail({queueId:'legacy-teacher-email-'+docRef.id+'-'+emailNonce.slice(0,8),channel:'email',targetEmail:row.email,targetName:row.name,title:'柚子樂器外聘老師資料驗證',body:'您好 '+row.name+' 老師，請由這個連結驗證 Email 並繼續填寫合約：\n'+url.href,source:'external-teacher-email-verify'},batch);
    }
    await queueManager({title:'外聘老師基本資料已送出',body:'姓名：'+row.name+'\n'+new URL('external-teacher-admin.html?contractId='+encodeURIComponent(docRef.id),baseUrl).href,source:'external-teacher-created',contractId:docRef.id},batch);
    await batch.commit();
    return {ok:true,record:publicRow(row)};
  }
  async function update(data){
    const {ref:docRef}=await authorize(data.id,data.token),input=data.record||{};
    if(JSON.stringify(input).length>100000)throw Error('資料過大。');
    let result;
    await db.runTransaction(async tx=>{
      const doc=await tx.get(docRef),before=doc.data();
      if(LOCKED.has(clean(before.status)))throw Error('契約已送出或確認，請由管理者退回補件。');
      const templateDoc=data.action==='submit'?await tx.get(db.collection('externalTeacherContractTemplates').doc('current')):null;
      const patch=pick(input,PROFILE_FIELDS.concat(SIGNED_FIELDS));
      const policy={kind:'teacher',id:data.id,token:data.token,previous:[before.signatureUrl,before.contractHtmlUrl,...(before.identityUrls||[])].filter(Boolean)};
      for(const field of ['signatureUrl','contractHtmlUrl'])if(patch[field])validateAssetUrl(patch[field],policy);
      if(patch.identityUrls){if(!Array.isArray(patch.identityUrls)||patch.identityUrls.length>4)throw Error('證件附件數量不正確。');for(const url of patch.identityUrls)validateAssetUrl(url,policy);}
      // Contact verification cannot be changed by a profile update.
      delete patch.email;delete patch.bindingMethod;
      if(data.action==='verify-email'){
        if(before.emailVerificationToken&&clean(data.emailToken)!==before.emailVerificationToken)throw Error('請使用寄到您信箱的驗證連結。');
        patch.emailBindStatus='bound';patch.emailVerifiedAt=new Date().toISOString();
      }
      const next={...before,...patch};
      if(data.action==='submit'){
        if(!bound(next))throw Error('請先完成 LINE 或 Email 驗證。');
        if(!clean(next.idNumber)||!clean(next.signatureUrl)||!Array.isArray(next.identityUrls)||!next.identityUrls.length)throw Error('請完整填寫證件資料與簽名。');
        const template={...defaultTemplate,...(templateDoc.exists?templateDoc.data():{})};
        patch.templateTitle=template.title;patch.templateVersion=template.version;patch.contractText=template.clausesText;patch.signedAt=new Date().toISOString();
        patch.status='submitted_pending_admin';patch.profileStatus=patch.status;patch.contractStatus=patch.status;patch.submittedAtText=new Date().toISOString();patch.submittedAt=FieldValue.serverTimestamp();patch.progressStatus='老師已送出，等待管理端確認';
      }else patch.status=bound(next)?'waiting_contract':'waiting_bindings';
      patch.updatedAt=FieldValue.serverTimestamp();
      tx.set(docRef,patch,{merge:true});tx.set(db.collection('externalTeacherProfiles').doc(docRef.id),patch,{merge:true});result=publicRow({...before,...patch,id:docRef.id});
    if(data.action==='submit')await queueManager({title:'外聘老師契約待確認',body:'姓名：'+clean(result.name)+'\n年度：'+result.contractYear+'\n'+new URL('external-teacher-admin.html?from=approval&filterStatus=submitted_pending_admin&contractId='+encodeURIComponent(data.id),baseUrl).href,source:'external-teacher-submitted',contractId:data.id},tx);
    });
    return {ok:true,record:result};
  }
  return {authorize,template,read,create,update};
}
module.exports={createLegacyTeacherForms,publicRow};
