'use strict';
const {HttpsError}=require('firebase-functions/v2/https');
const clean=value=>String(value??'').trim();
const formFields=['name','teacherName','idNumber','jobTitle','workNature','hireDate','stillWorking','unitKey','issueDate','subject','periodStart','periodEnd','stillTeaching','lessonType','location','purpose','cooperationYear','cooperationStart','cooperationEnd','cooperationContent'];
const templateFields=['certificateType','title','defaultUnitKey','showBrandLogo','introText','footerText','closingText','watermarkPending','watermarkRejected'];
const pick=(row,fields)=>Object.fromEntries(fields.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
async function notificationRows(db,row){
  const settings=await db.collection('notificationFeatureSettings').doc('certificateSubmitted').get();
  const setting=settings.exists?settings.data()||{}:{};
  if(setting.enabled===false)return [];
  const snap=await db.collection('employees').get();
  let managers=snap.docs.map(doc=>({...doc.data(),employeeId:doc.id})).filter(person=>person.showSettingsZone===true||['admin','manager'].includes(clean(person.role)));
  const primary=managers.filter(person=>person.employeeId==='PRIMARY_MANAGER_LINE'&&clean(person.lineUserId));
  if(primary.length)managers=primary;
  const notices=[];
  for(const person of managers){
    for(const channel of ['line','email']){
      if(channel==='line'&&(setting.notifyManagerLine===false||!clean(person.lineUserId)))continue;
      if(channel==='email'&&(setting.notifyManagerEmail!==true||!clean(person.email||person.Email)))continue;
      const id=row.requestId+'_'+require('crypto').createHash('sha256').update(person.employeeId).digest('hex').slice(0,16)+'_'+channel;
      const body='證明申請：'+row.name+'\n'+row.certificateTypeLabel+'\n請至表單與證明審核';
      notices.push({ref:db.collection('notificationQueue').doc(id),data:{queueId:id,channel,targetEmployeeId:person.employeeId,targetName:clean(person.name),targetEmail:clean(person.email||person.Email),targetLineUserId:clean(person.lineUserId),title:'證明申請提醒',message:body,body,status:'待發送',createdAt:row.createdAt,source:'certificate-notification',requestId:row.requestId}});
    }
  }
  return notices;
}
async function handleCertificateSelfService(data,identity,db){
  const actions=['getCertificateTemplate','getCertificateApplications','submitCertificateApplication'];
  if(!actions.includes(data.action))return null;
  const employeeId=clean(identity.employeeId);
  if(!employeeId)throw new HttpsError('unauthenticated','找不到目前登入的人員資料。');
  const type=data.certificateType==='teaching'?'teaching':'employment';
  if(data.action==='getCertificateApplications'){
    const snap=await db.collection('certificateApplications').where('employeeId','==',employeeId).get();
    return {ok:true,rows:snap.docs.map(doc=>({...doc.data(),requestId:doc.id})).sort((a,b)=>clean(b.submittedAtText).localeCompare(clean(a.submittedAtText)))};
  }
  const snap=await db.collection('printTemplates').doc(type==='teaching'?'teachingCertificate':'employmentCertificate').get();
  const template=pick(snap.exists?snap.data()||{}:{},templateFields);
  if(data.action==='getCertificateTemplate')return {ok:true,template,exists:snap.exists};
  const input=data.formData||{};
  if(JSON.stringify(input).length>16000)throw new HttpsError('invalid-argument','申請內容過長。');
  const form=pick(input,formFields);
  for(const key of Object.keys(form))if(typeof form[key]!=='boolean')form[key]=clean(form[key]).slice(0,2000);
  for(const key of ['stillWorking','stillTeaching'])if(key in form)form[key]=form[key]===true;
  if(!clean(form.name||form.teacherName)||!clean(form.idNumber))throw new HttpsError('invalid-argument','請填寫姓名與身分證字號。');
  if(type==='teaching'&&(!form.subject||!form.periodStart||(!form.stillTeaching&&!form.periodEnd)))throw new HttpsError('invalid-argument','請填寫任教科目與任教期間。');
  if(type==='employment'&&(!form.jobTitle||!form.hireDate||!['shangpin','kaili'].includes(form.unitKey)))throw new HttpsError('invalid-argument','請填寫職稱、到職日與開立單位。');
  const key=clean(data.submissionKey);
  if(!/^[a-zA-Z0-9_-]{12,80}$/.test(key))throw new HttpsError('invalid-argument','申請識別碼有誤，請重新整理。');
  const identityType=identity.external?'external':(identity.identityType==='parttime'?'parttime':'staff');
  const identityLabel=identityType==='external'?'外聘老師':identityType==='parttime'?'工讀生':'專職';
  Object.assign(form,{certificateType:type,identityType,identityLabel});
  if(type==='teaching')form.teacherIdentity=identityLabel;
  const requestId='CERT_'+type+'_'+require('crypto').createHash('sha256').update(employeeId+'|'+key).digest('hex').slice(0,32);
  const now=new Date().toISOString();
  const row={requestId,employeeId,name:clean(identity.name||form.name||form.teacherName),email:identity.email||'',identityType,identityLabel,certificateType:type,certificateTypeLabel:type==='teaching'?'教學證明':'在職證明',idNumber:clean(form.idNumber).toUpperCase(),formData:form,templateSnapshot:template,status:'待主管審核',submittedAt:now,submittedAtText:now,createdAt:now,hiddenBy:[],source:'certificate-self-service'};
  const ref=db.collection('certificateApplications').doc(requestId);
  const notices=await notificationRows(db,row);
  await db.runTransaction(async tx=>{const old=await tx.get(ref);if(old.exists){if(old.data().employeeId!==employeeId)throw new HttpsError('permission-denied','無法使用此申請編號。');return;}tx.create(ref,row);for(const notice of notices)tx.create(notice.ref,notice.data);});
  return {ok:true,requestId,message:'已送出申請，待主管審核。'};
}
module.exports={handleCertificateSelfService};
