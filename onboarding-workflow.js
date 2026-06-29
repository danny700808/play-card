/*
 * 註冊審核暨入職建檔 2026-06-24
 * - 申請人只填基本資料與證件正面。
 * - 待審核資料獨立存於 registrationApplications。
 * - 主管完成身分、薪資投保與班表後，使用 Firestore batch 一次建立正式人員。
 * - 相容舊版 employees 內 accountStatus=pending 的註冊資料，避免再建立第二筆員工。
 */
(function(global){
  'use strict';

  const fb = global.YZFirebase || {};
  if(!fb || fb.__onboardingWorkflowV20260624) return;
  const previousHandle = fb.handleApi;
  const VERSION = 'onboarding-20260624-v1';
  const APP_COLLECTION = 'registrationApplications';

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function numberValue(v){
    if(v === '' || v === null || v === undefined) return 0;
    const n = Number(String(v).replace(/[^\d.-]/g,''));
    return Number.isFinite(n) ? n : 0;
  }
  function hasNumber(v){ return v !== '' && v !== null && v !== undefined && Number.isFinite(Number(String(v).replace(/[^\d.-]/g,''))); }
  function truthy(v){ const s=lower(v); return v===true || ['是','yes','true','1','active','enabled','啟用','在保','已投保'].includes(s); }
  function safeId(v){ return clean(v).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,120); }
  function randomToken(bytes){
    const length = Math.max(8, Number(bytes || 16));
    try{
      const a = new Uint8Array(length);
      global.crypto.getRandomValues(a);
      return Array.from(a).map(x=>x.toString(16).padStart(2,'0')).join('');
    }catch(e){
      return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
  }
  function pad(n){ return String(n).padStart(2,'0'); }
  function nowText(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  function dateText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') v = v.toDate();
    if(v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())}`;
    const s=clean(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0,10) : s;
  }
  function dateTimeText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') v = v.toDate();
    if(v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}`;
    return clean(v);
  }
  function serverTs(){ return global.firebase.firestore.FieldValue.serverTimestamp(); }
  function arrayUnion(v){ return global.firebase.firestore.FieldValue.arrayUnion(v); }
  function database(){ try{return fb.init && fb.init();}catch(e){return null;} }
  function currentUser(){ try{return JSON.parse(global.localStorage.getItem('employeeUser') || 'null') || {};}catch(e){return {};} }
  function stripUndefined(obj){
    const out={};
    Object.keys(obj||{}).forEach(k=>{ if(obj[k] !== undefined) out[k]=obj[k]; });
    return out;
  }
  function lineItems(value){
    return (Array.isArray(value)?value:[]).map(function(row){
      row=row||{};
      return {name:clean(row.name||row.label),amount:numberValue(row.amount||row.value)};
    }).filter(function(row){ return row.name || row.amount; });
  }
  function todayText(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function identityDocumentTypeLabel(type){
    const t=clean(type);
    if(t==='resident_certificate') return '居留證';
    if(t==='passport') return '護照';
    return '國民身分證';
  }
  function identityLabel(type){ return type==='parttime'?'工讀生':(type==='external'?'外聘老師':'專職員工'); }
  function notificationPreference(value, hasEmail){ const v=lower(value); if(['line','line_only','line-only','只用line','只用 line'].includes(v)) return 'line'; if(['email','email_only','email-only','只用email','只用 email'].includes(v)) return 'email'; if(['both','line_email','line+email','line + email','all','雙軌','兩者'].includes(v)) return 'both'; return hasEmail?'both':'line'; }
  function notificationLabel(pref){ return pref==='email'?'只用 Email':(pref==='line'?'只用 LINE':'LINE + Email'); }
  function wantsLine(pref){ return pref==='line'||pref==='both'; }
  function wantsEmail(pref){ return pref==='email'||pref==='both'; }
  function makeEmployeeBindCode(){ return 'EMP-' + randomToken(4).slice(0,8).toUpperCase(); }
  function employeeBindText(code){ return code ? ('柚子人員綁定 ' + code) : ''; }
  function maskId(v){ const s=clean(v).toUpperCase(); if(!s) return ''; return s.length<=5 ? s : s.slice(0,1)+'*****'+s.slice(-4); }
  function maskEmail(v){ const s=lower(v); const p=s.split('@'); if(p.length!==2) return s; const local=p[0]; return (local.slice(0,2)||'*')+'***@'+p[1]; }
  function statusKey(row){
    return lower(row && (row.applicationStatus || row.statusKey || row.accountStatus || row.status || row['狀態']));
  }
  function isPendingStatus(row){
    const s=statusKey(row);
    if(['approved','active','rejected','archived','deleted','已核准','已啟用','已駁回','封存','刪除'].includes(s)) return false;
    return !s || ['pending','pending_setup','waiting_line_binding','draft','needs_identity_resubmission','waiting_manager_setup','待審核','等待 line 綁定','等待line綁定','待主管建檔','主管建檔草稿','待補件'].includes(s);
  }
  function isSystemEmployee(row){
    const id=clean(row && (row.employeeId || row.__id));
    return id==='PRIMARY_MANAGER_LINE' || lower(row && row.recordType)==='system_setting' || lower(row && row.identityType)==='system';
  }
  function applicationStatusLabel(key){
    const s=clean(key);
    if(s==='draft') return '主管建檔草稿';
    if(s==='needs_identity_resubmission') return '待申請人補件';
    if(s==='waiting_line_binding') return '等待 LINE 綁定';
    if(s==='approved') return '已完成入職建檔';
    if(s==='rejected') return '已駁回';
    return '待主管建檔';
  }
  function event(action, note){
    const u=currentUser();
    return {action, note:clean(note), actorId:clean(u.id||u.employeeId), actorName:clean(u.name), atText:nowText(), source:VERSION};
  }

  async function all(collection){
    const d=database(); if(!d) throw new Error('Firebase 尚未啟用。');
    const snap=await d.collection(collection).get();
    const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id},doc.data()||{})));
    return rows;
  }
  async function getDoc(collection,id){
    const d=database(); if(!d || !clean(id)) return null;
    const snap=await d.collection(collection).doc(clean(id)).get();
    return snap.exists ? Object.assign({__id:snap.id},snap.data()||{}) : null;
  }
  async function queryRows(collection,field,value){
    const d=database(); if(!d) throw new Error('Firebase 尚未啟用。');
    const snap=await d.collection(collection).where(field,'==',value).get();
    const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id},doc.data()||{})));
    return rows;
  }
  async function employeesByEmail(email){
    const e=lower(email); if(!e) return [];
    const rows=[];
    for(const field of ['email','Email']){
      try{ (await queryRows('employees',field,e)).forEach(r=>{ if(!rows.some(x=>x.__id===r.__id)) rows.push(r); }); }catch(err){}
    }
    return rows;
  }
  async function applicationByEmail(email){
    const e=lower(email); if(!e) return [];
    try{return await queryRows(APP_COLLECTION,'email',e);}catch(err){return [];}
  }
  function normalizeApplication(raw){
    raw=raw||{};
    const applicationId=clean(raw.applicationId||raw.__id);
    const applicationStatus=clean(raw.applicationStatus||'pending_setup');
    const draft=(raw.onboardingDraft && typeof raw.onboardingDraft==='object') ? raw.onboardingDraft : {};
    return Object.assign({},raw,{
      id:applicationId,
      applicationId,
      name:clean(raw.name||raw['姓名']),
      email:lower(raw.email||raw.Email),
      idNumber:clean(raw.idNumber||raw['身分證字號']).toUpperCase(),
      idNumberMasked:maskId(raw.idNumber||raw['身分證字號']),
      birthDate:dateText(raw.birthDate||raw['出生年月日']),
      mobilePhone:clean(raw.mobilePhone||raw['行動電話']),
      contactAddress:clean(raw.contactAddress||raw.address||raw['聯絡地址']),
      emergencyContact:clean(raw.emergencyContact||raw['緊急聯絡人']),
      emergencyPhone:clean(raw.emergencyPhone||raw['緊急聯絡人電話']),
      identityDocumentType:clean(raw.identityDocumentType||'national_id'),
      identityDocumentTypeLabel:identityDocumentTypeLabel(raw.identityDocumentType),
      identityDocumentUrl:clean(raw.identityDocumentUrl),
      identityDocumentPublicId:clean(raw.identityDocumentPublicId),
      identityDocumentVerified:raw.identityDocumentVerified===true || clean(raw.identityVerificationStatus)==='verified',
      applicationStatus,
      applicationStatusLabel:applicationStatusLabel(applicationStatus),
      statusLabel:applicationStatusLabel(applicationStatus),
      requestedIdentityType:clean(raw.requestedIdentityType||raw.registrationType||raw.identityType||''),
      requestedIdentityLabel:identityLabel(clean(raw.requestedIdentityType||raw.registrationType||raw.identityType||'')),
      notificationPreference:notificationPreference(raw.notificationPreference||raw.notificationMethod, !!clean(raw.email)),
      notificationPreferenceLabel:notificationLabel(notificationPreference(raw.notificationPreference||raw.notificationMethod, !!clean(raw.email))),
      employeeBindCode:clean(raw.employeeBindCode||raw.bindingCode||raw.lineBindingCode),
      employeeBindText:clean(raw.employeeBindText)||employeeBindText(clean(raw.employeeBindCode||raw.bindingCode||raw.lineBindingCode)),
      lineBindStatus:clean(raw.lineBindStatus||raw.lineStatus||''),
      emailBindStatus:clean(raw.emailBindStatus||''),
      currentStep:clean(raw.currentStep||raw.progressStatus||''),
      onboardingDraft:draft,
      createdAtText:clean(raw.createdAtText)||dateTimeText(raw.createdAt),
      updatedAtText:clean(raw.updatedAtText)||dateTimeText(raw.updatedAt),
      resubmissionReason:clean(raw.resubmissionReason),
      emailMasked:maskEmail(raw.email)
    });
  }

  async function pendingApplications(){
    const appRows=(await all(APP_COLLECTION).catch(()=>[])).filter(isPendingStatus).map(normalizeApplication);
    const linkedLegacy=new Set(appRows.map(x=>clean(x.legacyEmployeeDocId)).filter(Boolean));
    const appEmails=new Set(appRows.map(x=>lower(x.email)).filter(Boolean));
    const legacy=(await all('employees').catch(()=>[])).filter(r=>!isSystemEmployee(r) && isPendingStatus(r) && !linkedLegacy.has(clean(r.__id)) && !appEmails.has(lower(r.email||r.Email))).map(r=>normalizeApplication({
      applicationId:'LEGACY__'+clean(r.__id),
      legacyEmployeeDocId:clean(r.__id),
      linkedEmployeeId:clean(r.employeeId||r.__id),
      name:r.name||r['姓名'], email:r.email||r.Email, idNumber:r.idNumber||r['身分證字號'], birthDate:r.birthDate||r['出生年月日'],
      mobilePhone:r.mobilePhone||r['行動電話'], contactAddress:r.contactAddress||r.address||r['聯絡地址'], emergencyContact:r.emergencyContact||r['緊急聯絡人'], emergencyPhone:r.emergencyPhone||r['緊急聯絡人電話'],
      identityDocumentType:r.identityDocumentType||'national_id', identityDocumentUrl:r.identityDocumentUrl||'', identityDocumentPublicId:r.identityDocumentPublicId||'',
      applicationStatus:'pending_setup', createdAt:r.createdAt, createdAtText:r.createdAtText, source:'legacy-employees-pending'
    }));
    return appRows.concat(legacy).sort((a,b)=>clean(b.createdAtText).localeCompare(clean(a.createdAtText)) || clean(a.name).localeCompare(clean(b.name),'zh-Hant'));
  }

  function validateApplicant(payload){
    const required=[['name','請填寫姓名。'],['email','請填寫 Email。'],['idNumber','請填寫身分證字號或證件號碼。'],['birthDate','請填寫出生年月日。'],['mobilePhone','請填寫行動電話。'],['contactAddress','請填寫聯絡地址。'],['emergencyContact','請填寫緊急聯絡人。'],['emergencyPhone','請填寫緊急聯絡人電話。'],['identityDocumentType','請選擇證件類型。'],['identityDocumentUrl','請上傳證件正面。']];
    for(const [key,msg] of required){ if(!clean(payload[key])) return msg; }
    if(!payload.identityDocumentConsent) return '請先勾選證件使用說明。';
    if(!/^\S+@\S+\.\S+$/.test(lower(payload.email))) return 'Email 格式不正確。';
    return '';
  }

  async function createApplication(payload){
    payload=payload||{};
    const requested=clean(payload.requestedIdentityType||payload.registrationType||payload.identityType);
    if(!['staff','parttime'].includes(requested)) return {ok:false,message:'請先選擇專職員工或工讀生註冊；外聘老師請使用外聘老師資料與合約入口。'};
    const error=validateApplicant(payload); if(error) return {ok:false,message:error};
    const email=lower(payload.email);
    const pref=notificationPreference(payload.notificationPreference||payload.notificationMethod, !!email);
    const employeeRows=await employeesByEmail(email);
    if(employeeRows.some(r=>['active','enabled','啟用','正常'].includes(lower(r.accountStatus||r.status||'active')))) return {ok:false,message:'這個 Email 已經是正式人員帳號，請直接登入。'};
    const existing=(await applicationByEmail(email)).filter(r=>!['approved','rejected','archived'].includes(statusKey(r)));
    if(existing.length) return {ok:false,message:'這個 Email 已有尚未完成的申請，請勿重複送出。'};
    const applicationId='REG_'+Date.now()+'_'+randomToken(5).slice(0,10);
    const bindCode=wantsLine(pref)?makeEmployeeBindCode():'';
    const bindText=employeeBindText(bindCode);
    const row={
      applicationId,
      registrationType:requested, requestedIdentityType:requested, requestedIdentityLabel:identityLabel(requested),
      name:clean(payload.name), email, idNumber:clean(payload.idNumber).toUpperCase(), birthDate:dateText(payload.birthDate),
      mobilePhone:clean(payload.mobilePhone), contactAddress:clean(payload.contactAddress), address:clean(payload.contactAddress),
      emergencyContact:clean(payload.emergencyContact), emergencyPhone:clean(payload.emergencyPhone),
      notificationPreference:pref, notificationPreferenceLabel:notificationLabel(pref), notificationMethod:pref,
      employeeBindCode:bindCode, employeeBindText:bindText,
      lineBindStatus:wantsLine(pref)?'pending':'not_required', emailBindStatus:wantsEmail(pref)?'provided':'not_required',
      currentStep:wantsLine(pref)?'等待 LINE 綁定':'等待主管審核', progressStatus:wantsLine(pref)?'等待 LINE 綁定':'等待主管審核',
      identityDocumentType:clean(payload.identityDocumentType), identityDocumentTypeLabel:identityDocumentTypeLabel(payload.identityDocumentType),
      identityDocumentUrl:clean(payload.identityDocumentUrl), identityDocumentPublicId:clean(payload.identityDocumentPublicId),
      identityDocumentFileName:clean(payload.identityDocumentFileName), identityDocumentUploadedAtText:clean(payload.identityDocumentUploadedAtText)||nowText(),
      identityDocumentWatermark:clean(payload.identityDocumentWatermark), identityDocumentConsent:true,
      applicationStatus:wantsLine(pref)?'waiting_line_binding':'pending_setup', status:wantsLine(pref)?'等待 LINE 綁定':'待主管建檔', accountStatus:'pending',
      onboardingDraft:{identityType:requested}, createdAt:serverTs(), createdAtText:nowText(), updatedAt:serverTs(), updatedAtText:nowText(),
      applicantResubmissionToken:randomToken(18), source:VERSION, history:[event('submitted',`申請人送出${identityLabel(requested)}註冊資料`)]
    };
    const d=database(); const batch=d.batch();
    batch.set(d.collection(APP_COLLECTION).doc(applicationId),row);
    if(bindCode){
      batch.set(d.collection('employeeLineBindings').doc(bindCode),{
        bindingCode:bindCode, employeeBindCode:bindCode, bindText, applicationId, targetCollection:APP_COLLECTION,
        status:'pending', employeeId:'', name:row.name, email:row.email, mobilePhone:row.mobilePhone,
        requestedIdentityType:requested, notificationPreference:pref, createdAt:serverTs(), createdAtText:nowText(), updatedAt:serverTs(), source:VERSION
      },{merge:true});
    }
    await batch.commit();
    try{
      if(typeof previousHandle === 'function'){
        await previousHandle('queueFeatureNotification',{
          featureCode:'registration', direction:'manager', name:row.name, email:row.email, applicationId,
          notificationMessage:`新${identityLabel(requested)}註冊申請：${row.name}\n通知方式：${notificationLabel(pref)}\n${bindText?('LINE 綁定文字：'+bindText):'不需 LINE 綁定'}\n請至後台審核`
        });
      }
    }catch(e){ console.warn('[onboarding manager notification skipped]', e); }
    return {ok:true,message:'註冊申請已送出，後台已建立資料。',applicationId,notificationPreference:pref,employeeBindCode:bindCode,employeeBindText:bindText,lineBindStatus:row.lineBindStatus};
  }

  async function ensureApplication(applicationId){
    let id=clean(applicationId);
    if(!id) throw new Error('缺少註冊申請 ID。');
    let app=await getDoc(APP_COLLECTION,id);
    if(app) return {id:clean(app.__id),data:app};
    if(!id.startsWith('LEGACY__')) throw new Error('找不到這筆註冊申請。');
    const legacyDocId=id.slice('LEGACY__'.length);
    const legacy=await getDoc('employees',legacyDocId);
    if(!legacy) throw new Error('找不到舊版待審核資料。');
    const newId='REG_LEGACY_'+safeId(legacyDocId);
    const existing=await getDoc(APP_COLLECTION,newId);
    if(existing) return {id:newId,data:existing};
    const row={
      applicationId:newId, legacyEmployeeDocId:legacyDocId, linkedEmployeeId:clean(legacy.employeeId||legacyDocId),
      name:clean(legacy.name||legacy['姓名']), email:lower(legacy.email||legacy.Email), idNumber:clean(legacy.idNumber||legacy['身分證字號']).toUpperCase(), birthDate:dateText(legacy.birthDate||legacy['出生年月日']),
      mobilePhone:clean(legacy.mobilePhone||legacy['行動電話']), contactAddress:clean(legacy.contactAddress||legacy.address||legacy['聯絡地址']), address:clean(legacy.contactAddress||legacy.address||legacy['聯絡地址']),
      emergencyContact:clean(legacy.emergencyContact||legacy['緊急聯絡人']), emergencyPhone:clean(legacy.emergencyPhone||legacy['緊急聯絡人電話']),
      identityDocumentType:clean(legacy.identityDocumentType||'national_id'), identityDocumentUrl:clean(legacy.identityDocumentUrl), identityDocumentPublicId:clean(legacy.identityDocumentPublicId),
      applicationStatus:'pending_setup', status:'待主管建檔', accountStatus:'pending', notificationPreference:'both', notificationPreferenceLabel:'LINE + Email', lineBindStatus:'pending', emailBindStatus:'provided', onboardingDraft:{},
      applicantResubmissionToken:randomToken(18), createdAt:legacy.createdAt||serverTs(), createdAtText:clean(legacy.createdAtText)||nowText(), updatedAt:serverTs(), updatedAtText:nowText(),
      source:'legacy-employees-migrated', history:[event('legacy_migrated','舊版待審核資料轉入新入職建檔流程')]
    };
    await database().collection(APP_COLLECTION).doc(newId).set(row);
    return {id:newId,data:Object.assign({__id:newId},row)};
  }

  function normalizedDraft(payload){
    const p=(payload&&payload.onboardingDraft)||payload||{};
    return {
      identityVerificationStatus:clean(p.identityVerificationStatus),
      identityVerificationNote:clean(p.identityVerificationNote),
      identityType:clean(p.identityType),
      startDate:dateText(p.startDate||p.hireDate||p.cooperationStartDate),
      baseSalary:numberValue(p.baseSalary), hourlyRate:numberValue(p.hourlyRate), isPartialHours:clean(p.isPartialHours||'否'), averageSalary:numberValue(p.averageSalary),
      laborStatus:clean(p.laborStatus), laborInsuredSalary:numberValue(p.laborInsuredSalary), laborSelfPay:hasNumber(p.laborSelfPay)?numberValue(p.laborSelfPay):'', laborTotalPremium:numberValue(p.laborTotalPremium), laborEmployerPay:numberValue(p.laborEmployerPay), laborGovernmentPay:numberValue(p.laborGovernmentPay),
      healthStatus:clean(p.healthStatus), healthInsuredSalary:numberValue(p.healthInsuredSalary), healthDependents:numberValue(p.healthDependents), healthSelfPay:hasNumber(p.healthSelfPay)?numberValue(p.healthSelfPay):'', healthTotalPremium:numberValue(p.healthTotalPremium), healthEmployerPay:numberValue(p.healthEmployerPay), healthGovernmentPay:numberValue(p.healthGovernmentPay),
      selfRetirementEnabled:clean(p.selfRetirementEnabled||'否'), selfRetirementRate:numberValue(p.selfRetirementRate),
      salaryEffectiveDate:dateText(p.salaryEffectiveDate||p.effectiveDate),
      scheduleMode:clean(p.scheduleMode), scheduleTemplateId:clean(p.scheduleTemplateId||p.templateId), scheduleTemplateName:clean(p.scheduleTemplateName||p.templateName), scheduleEffectiveDate:dateText(p.scheduleEffectiveDate),
      externalAccessEnabled:clean(p.externalAccessEnabled||'是'), externalContractStatus:clean(p.externalContractStatus),
      jobAllowances:lineItems(p.jobAllowances), allowances:lineItems(p.allowances),
      managerNote:clean(p.managerNote||p.note)
    };
  }

  function insuranceActive(status){ return ['在保','已投保','投保','有效'].includes(clean(status)); }
  function onboardingMissing(app,draft){
    const r=[];
    if(!clean(app.identityDocumentUrl)) r.push('缺少證件正面');
    if(draft.identityVerificationStatus!=='verified') r.push('主管尚未確認證件與申請資料相符');
    if(!['staff','parttime','external'].includes(draft.identityType)) r.push('尚未選擇專職或工讀');
    const pref=notificationPreference(app.notificationPreference||app.notificationMethod, !!clean(app.email));
    if(wantsLine(pref) && clean(app.employeeBindCode) && clean(app.lineBindStatus)!=='bound') r.push('申請人尚未完成 LINE 綁定');
    if(!draft.startDate) r.push(draft.identityType==='external'?'尚未填寫合作起始日':'尚未填寫到職日');
    if(draft.identityType==='staff' || draft.identityType==='parttime'){
      if(draft.identityType==='staff' && !(draft.baseSalary>0)) r.push('專職員工尚未填寫本薪');
      if(draft.identityType==='parttime' && !(draft.hourlyRate>0)) r.push('工讀生尚未填寫時薪');
      if(draft.identityType==='parttime' && !(draft.averageSalary>0)) r.push('工讀生尚未填寫目前申報月平均薪資總額');
      if(!draft.salaryEffectiveDate) r.push('尚未填寫薪資生效日');
      if(!draft.laborStatus) r.push('尚未選擇勞保狀態');
      if(!draft.healthStatus) r.push('尚未選擇健保狀態');
      if(insuranceActive(draft.laborStatus)){
        if(!(draft.laborInsuredSalary>0)) r.push('勞保在保但未填寫投保薪資／級距');
      }
      if(insuranceActive(draft.healthStatus)){
        if(!(draft.healthInsuredSalary>0)) r.push('健保在保但未填寫投保薪資／級距');
      }
      if(!['template','none'].includes(draft.scheduleMode)) r.push('尚未選擇固定班表或無固定班表');
      if(draft.scheduleMode==='template'){
        if(!draft.scheduleTemplateId) r.push('尚未選擇班表模板');
        if(!draft.scheduleEffectiveDate) r.push('尚未填寫班表生效日');
      }
    }
    if(draft.identityType==='external'){
      if(!draft.externalContractStatus) r.push('尚未設定外聘合作／契約狀態');
      if(!['是','否'].includes(draft.externalAccessEnabled)) r.push('尚未設定外聘帳號是否啟用');
    }
    return r;
  }

  async function saveDraft(payload){
    const ensured=await ensureApplication(payload.applicationId);
    const draft=normalizedDraft(payload);
    const patch={
      onboardingDraft:draft, applicationStatus:'draft', status:'主管建檔草稿', accountStatus:'pending',
      onboardingMissing:onboardingMissing(ensured.data,draft), updatedAt:serverTs(), updatedAtText:nowText(),
      lastEditedBy:clean(payload.userId||currentUser().id), history:arrayUnion(event('draft_saved','主管儲存入職建檔草稿'))
    };
    await database().collection(APP_COLLECTION).doc(ensured.id).set(patch,{merge:true});
    const next=Object.assign({},ensured.data,patch,{__id:ensured.id});
    return {ok:true,message:'入職建檔草稿已儲存。',row:normalizeApplication(next),missing:patch.onboardingMissing};
  }

  async function scheduleTemplates(){
    const rows=await all('scheduleTemplates').catch(()=>[]);
    return rows.filter(r=>{
      const e=r.enabled===undefined?r['是否啟用']:r.enabled;
      return e===undefined || truthy(e) || ['TRUE','啟用'].includes(clean(e));
    }).map(r=>({templateId:clean(r.templateId||r['模板ID']||r.__id),templateName:clean(r.templateName||r['模板名稱']||r.name||'未命名班表')})).filter(x=>x.templateId);
  }

  function generateEmployeeId(type){
    const prefix=type==='parttime'?'PT':(type==='external'?'EXT':'STF');
    const d=new Date(); const date=`${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
    return `${prefix}_${date}_${randomToken(4).slice(0,8).toUpperCase()}`;
  }
  function generateInitialPassword(){
    const letters='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const digits='23456789';
    let out=letters[Math.floor(Math.random()*letters.length)]+digits[Math.floor(Math.random()*digits.length)];
    const all=letters+digits;
    while(out.length<8) out+=all[Math.floor(Math.random()*all.length)];
    return out.split('').sort(()=>Math.random()-.5).join('');
  }
  function moneyText(v){ const n=numberValue(v); return n.toLocaleString('zh-TW')+' 元'; }
  function feeRound(v){ return Math.round(numberValue(v)); }
  function laborFeeBreakdown(salary){
    const s=numberValue(salary);
    if(!(s>0)) return {total:0,employee:0,employer:0,government:0};
    const ordinaryRate=0.115, employmentRate=0.01;
    const employee=feeRound(s*ordinaryRate*0.20)+feeRound(s*employmentRate*0.20);
    const employer=feeRound(s*ordinaryRate*0.70)+feeRound(s*employmentRate*0.70);
    const government=feeRound(s*ordinaryRate*0.10)+feeRound(s*employmentRate*0.10);
    return {total:employee+employer+government,employee,employer,government};
  }
  function healthFeeBreakdown(salary,dependents){
    const s=numberValue(salary);
    if(!(s>0)) return {total:0,employee:0,employer:0,government:0,dependents:0};
    const dep=Math.max(0,Math.min(3,Math.floor(numberValue(dependents))));
    const base=s*0.0517;
    const employee=feeRound(base*0.30*(1+dep));
    const employer=feeRound(base*0.60*1.56);
    const government=feeRound(base*0.10*1.56);
    return {total:employee+employer+government,employee,employer,government,dependents:dep};
  }
  function retirementEmployerAmount(v){ const n=numberValue(v); return n>0 ? Math.round(n*0.06) : 0; }
  function salaryConfig(app,draft,employeeId){
    const isPart=draft.identityType==='parttime';
    const laborSalary=insuranceActive(draft.laborStatus)?numberValue(draft.laborInsuredSalary):0;
    const healthSalary=insuranceActive(draft.healthStatus)?numberValue(draft.healthInsuredSalary):0;
    const laborFees=insuranceActive(draft.laborStatus)?laborFeeBreakdown(laborSalary):{total:0,employee:0,employer:0,government:0};
    const healthFees=insuranceActive(draft.healthStatus)?healthFeeBreakdown(healthSalary,draft.healthDependents):{total:0,employee:0,employer:0,government:0,dependents:0};
    const laborSelf=insuranceActive(draft.laborStatus)?(hasNumber(draft.laborSelfPay)?numberValue(draft.laborSelfPay):laborFees.employee):0;
    const healthSelf=insuranceActive(draft.healthStatus)?(hasNumber(draft.healthSelfPay)?numberValue(draft.healthSelfPay):healthFees.employee):0;
    const employerRetirement=insuranceActive(draft.laborStatus)?retirementEmployerAmount(laborSalary):0;
    const selfRetirement=insuranceActive(draft.laborStatus)&&clean(draft.selfRetirementEnabled)==='是'?Math.round(laborSalary*numberValue(draft.selfRetirementRate)/100):0;
    return {
      employeeId, name:clean(app.name), email:lower(app.email), identityType:draft.identityType,
      salaryDisplayType:isPart?'PARTTIME_DIRECT':'STAFF_DIRECT', baseSalary:isPart?0:numberValue(draft.baseSalary), hourlyRate:isPart?numberValue(draft.hourlyRate):0,
      isPartialHours:isPart?(draft.isPartialHours||'否'):'否', averageSalary:isPart?numberValue(draft.averageSalary):0,
      laborStatus:draft.laborStatus, laborPlan:laborSalary?`LAB_${laborSalary}`:'', laborPlanText:laborSalary?moneyText(laborSalary):'', laborSalary:laborSalary, laborInsuredSalary:laborSalary,
      laborSelfPay:laborSelf, laborEmployeeSelfPay:laborSelf, laborSelfPayText:insuranceActive(draft.laborStatus)?moneyText(laborSelf):'', laborInsuranceSelfPay:laborSelf, laborTotalPremium:laborFees.total, laborEmployerPay:laborFees.employer, laborGovernmentPay:laborFees.government, laborFeeSource:'BLI_115_GENERAL_LABOR_EMPLOYMENT',
      healthStatus:draft.healthStatus, healthPlan:healthSalary?`NHI_${healthSalary}`:'', healthPlanText:healthSalary?moneyText(healthSalary):'', healthSalary:healthSalary, healthInsuredSalary:healthSalary,
      healthDependents:numberValue(draft.healthDependents), healthSelfPay:healthSelf, healthEmployeeSelfPay:healthSelf, healthSelfPayText:insuranceActive(draft.healthStatus)?moneyText(healthSelf):'', healthInsuranceSelfPay:healthSelf, healthTotalPremium:healthFees.total, healthEmployerPay:healthFees.employer, healthGovernmentPay:healthFees.government, healthFeeSource:'NHI_115_EMPLOYEE',
      selfRetirementEnabled:draft.selfRetirementEnabled||'否', selfRetirementRate:numberValue(draft.selfRetirementRate), selfRetirementAmount:selfRetirement,
      retirementEmployerRate:6, laborRetirementEmployerRate:6, retirementEmployerAmount:employerRetirement, laborRetirementEmployerAmount:employerRetirement,
      retirementEmployerText:insuranceActive(draft.laborStatus)?('6%｜'+moneyText(employerRetirement)):'', laborRetirementEmployerText:insuranceActive(draft.laborStatus)?('6%｜'+moneyText(employerRetirement)):'', laborRetirementSalary:laborSalary,
      effectiveDate:draft.salaryEffectiveDate, salaryEffectiveDate:draft.salaryEffectiveDate, note:draft.managerNote,
      jobAllowances:lineItems(draft.jobAllowances), allowances:lineItems(draft.allowances), salaryConfigured:true, source:VERSION, updatedAt:serverTs(), updatedAtText:nowText()
    };
  }
  function employeeBase(app,draft,employeeId,password){
    const isPart=draft.identityType==='parttime';
    const isExternal=draft.identityType==='external';
    return {
      employeeId, name:clean(app.name), email:lower(app.email), password, role:'staff',
      identityType:draft.identityType, identityLabel:identityLabel(draft.identityType), isPartTime:isPart, isExternalTeacher:isExternal,
      notificationPreference:notificationPreference(app.notificationPreference||app.notificationMethod, !!clean(app.email)), notificationPreferenceLabel:notificationLabel(notificationPreference(app.notificationPreference||app.notificationMethod, !!clean(app.email))),
      employeeBindCode:clean(app.employeeBindCode), employeeBindText:clean(app.employeeBindText)||employeeBindText(clean(app.employeeBindCode)), lineBindStatus:clean(app.lineBindStatus||''), emailBindStatus:clean(app.emailBindStatus||''), lineUserId:clean(app.lineUserId||''), lineDisplayName:clean(app.lineDisplayName||''), lineNotifyEnabled:!!clean(app.lineUserId),
      accountStatus:isExternal && draft.externalAccessEnabled==='否'?'inactive':'active', employmentStatus:'active', hiddenFromActiveLists:false,
      idNumber:clean(app.idNumber).toUpperCase(), birthDate:dateText(app.birthDate), mobilePhone:clean(app.mobilePhone), address:clean(app.contactAddress), contactAddress:clean(app.contactAddress),
      emergencyContact:clean(app.emergencyContact), emergencyPhone:clean(app.emergencyPhone),
      hireDate:isExternal?'':draft.startDate, cooperationStartDate:isExternal?draft.startDate:'',
      identityDocumentType:clean(app.identityDocumentType), identityDocumentTypeLabel:identityDocumentTypeLabel(app.identityDocumentType),
      identityDocumentUrl:clean(app.identityDocumentUrl), identityDocumentPublicId:clean(app.identityDocumentPublicId), identityDocumentVerified:true,
      identityVerificationStatus:'verified', identityVerifiedAt:serverTs(), identityVerifiedAtText:nowText(), identityVerifiedBy:clean(currentUser().id||currentUser().employeeId),
      identityDocumentUseNotice:'僅供柚子樂器人事身分核對、建檔、契約及投保作業使用',
      registrationApplicationId:clean(app.applicationId||app.__id), onboardingCompleted:true, onboardingCompletedAt:serverTs(), onboardingCompletedAtText:nowText(),
      externalContractStatus:isExternal?draft.externalContractStatus:'', externalAccessEnabled:isExternal?draft.externalAccessEnabled:'',
      scheduleMode:isExternal?'not_applicable':draft.scheduleMode, salarySource:isExternal?'not_applicable':'employeeSalaryConfigs',
      source:VERSION, updatedAt:serverTs(), updatedAtText:nowText()
    };
  }
  async function findScheduleTemplate(id){
    if(!clean(id)) return null;
    const direct=await getDoc('scheduleTemplates',id); if(direct) return direct;
    const rows=await queryRows('scheduleTemplates','templateId',clean(id)).catch(()=>[]); return rows[0]||null;
  }
  function loginUrl(){ try{return new URL('index.html',global.location.href).href;}catch(e){return 'index.html';} }

  async function approve(payload){
    const ensured=await ensureApplication(payload.applicationId);
    const app=Object.assign({},ensured.data,{applicationId:ensured.id});
    const draft=normalizedDraft(payload);
    const missing=onboardingMissing(app,draft);
    if(missing.length) return {ok:false,message:'尚有必填資料未完成：'+missing.join('、'),missing};

    const sameEmail=await employeesByEmail(app.email);
    const legacyDocId=clean(app.legacyEmployeeDocId);
    const conflicting=sameEmail.find(r=>clean(r.__id)!==legacyDocId && !['pending','rejected','inactive','archived'].includes(lower(r.accountStatus||r.status||'active')));
    if(conflicting) return {ok:false,message:'這個 Email 已綁定其他正式人員，請先處理重複主檔。'};
    const existing=legacyDocId ? await getDoc('employees',legacyDocId) : (sameEmail.find(r=>['pending','rejected','inactive'].includes(lower(r.accountStatus||r.status)))||null);
    const employeeId=clean(existing && (existing.employeeId||existing.__id)) || clean(app.linkedEmployeeId) || generateEmployeeId(draft.identityType);
    const employeeDocId=clean(existing&&existing.__id)||employeeId;
    const initialPassword=clean(existing&&existing.password)||generateInitialPassword();
    const employee=employeeBase(app,draft,employeeId,initialPassword);
    if(!existing){ employee.createdAt=serverTs(); employee.createdAtText=nowText(); }
    const salary=(draft.identityType==='staff'||draft.identityType==='parttime')?salaryConfig(app,draft,employeeId):null;
    if(salary) Object.assign(employee,{
      baseSalary:salary.baseSalary,hourlyRate:salary.hourlyRate,isPartialHours:salary.isPartialHours,averageSalary:salary.averageSalary,
      laborStatus:salary.laborStatus,laborPlan:salary.laborPlan,laborPlanText:salary.laborPlanText,laborInsuredSalary:salary.laborInsuredSalary,laborSelfPay:salary.laborSelfPay,laborEmployeeSelfPay:salary.laborEmployeeSelfPay,laborSelfPayText:salary.laborSelfPayText,laborInsuranceSelfPay:salary.laborInsuranceSelfPay,laborTotalPremium:salary.laborTotalPremium,laborEmployerPay:salary.laborEmployerPay,laborGovernmentPay:salary.laborGovernmentPay,
      healthStatus:salary.healthStatus,healthPlan:salary.healthPlan,healthPlanText:salary.healthPlanText,healthInsuredSalary:salary.healthInsuredSalary,healthDependents:salary.healthDependents,healthSelfPay:salary.healthSelfPay,healthEmployeeSelfPay:salary.healthEmployeeSelfPay,healthSelfPayText:salary.healthSelfPayText,healthInsuranceSelfPay:salary.healthInsuranceSelfPay,healthTotalPremium:salary.healthTotalPremium,healthEmployerPay:salary.healthEmployerPay,healthGovernmentPay:salary.healthGovernmentPay,
      salaryEffectiveDate:salary.salaryEffectiveDate,salaryConfigured:true
    });

    let template=null, assignment=null;
    if(draft.scheduleMode==='template'){
      template=await findScheduleTemplate(draft.scheduleTemplateId);
      if(!template) return {ok:false,message:'找不到選擇的班表模板，請重新選擇。'};
      const assignmentId='SCH_ONBOARD_'+safeId(employeeId)+'_'+safeId(draft.scheduleEffectiveDate);
      assignment={
        assignmentId, employeeId, employeeName:clean(app.name), templateId:clean(template.templateId||template.__id), templateName:clean(template.templateName||template.name||'班表模板'),
        startDate:draft.scheduleEffectiveDate, endDate:'', indefinite:'TRUE', enabled:'TRUE', note:'入職建檔初始班表', source:VERSION, createdAt:serverTs(), updatedAt:serverTs()
      };
      employee.scheduleConfigured=true; employee.currentScheduleTemplateId=assignment.templateId; employee.currentScheduleTemplateName=assignment.templateName; employee.scheduleEffectiveDate=draft.scheduleEffectiveDate;
    }else if(draft.identityType!=='external'){
      employee.scheduleConfigured=true; employee.currentScheduleTemplateId=''; employee.currentScheduleTemplateName='無固定班表'; employee.scheduleEffectiveDate=draft.startDate;
    }

    const d=database(); if(!d) return {ok:false,message:'Firebase 尚未啟用。'};
    const batch=d.batch();
    batch.set(d.collection('employees').doc(employeeDocId),employee,{merge:true});
    if(salary) batch.set(d.collection('employeeSalaryConfigs').doc(employeeId),salary,{merge:true});
    if(assignment) batch.set(d.collection('employeeSchedules').doc(assignment.assignmentId),assignment,{merge:true});
    const queueIdBase='onboarding-approved-'+safeId(employeeId)+'-'+Date.now();
    const pref=notificationPreference(app.notificationPreference||app.notificationMethod, !!clean(app.email));
    const emailBody=[
      `${clean(app.name)}您好：`,
      '',
      '您的柚子樂器人員申請已核准。',
      `身分：${identityLabel(draft.identityType)}`,
      `員工編號：${employeeId}`,
      `登入帳號：${lower(app.email)}`,
      `初始密碼：${initialPassword}`,
      '',
      `登入網址：${loginUrl()}`,
      '第一次登入後請立即修改密碼。'
    ].join('\n');
    const createdQueueIds=[];
    if(wantsEmail(pref) && lower(app.email)){
      const queueId=queueIdBase+'-email'; createdQueueIds.push(queueId);
      batch.set(d.collection('notificationQueue').doc(queueId),{
        queueId,channel:'email',targetEmail:lower(app.email),targetEmployeeId:employeeId,targetName:clean(app.name),title:'人員申請已核准',body:emailBody,message:emailBody,status:'待發送',source:VERSION,createdAt:serverTs(),createdAtText:nowText()
      },{merge:true});
    }
    if(wantsLine(pref) && clean(app.lineUserId)){
      const queueId=queueIdBase+'-line'; createdQueueIds.push(queueId);
      batch.set(d.collection('notificationQueue').doc(queueId),{
        queueId,channel:'line',targetLineUserId:clean(app.lineUserId),targetEmployeeId:employeeId,targetName:clean(app.name),title:'人員申請已核准',body:emailBody,message:emailBody,status:'待發送',source:VERSION,createdAt:serverTs(),createdAtText:nowText()
      },{merge:true});
    }
    batch.set(d.collection(APP_COLLECTION).doc(ensured.id),{
      applicationStatus:'approved',status:'已完成入職建檔',accountStatus:'approved',onboardingDraft:draft,onboardingMissing:[],
      approvedEmployeeId:employeeId,approvedEmployeeDocId:employeeDocId,approvedAt:serverTs(),approvedAtText:nowText(),approvedBy:clean(payload.userId||currentUser().id),
      initialPasswordIssued:true,approvalNotificationQueueIds:createdQueueIds,approvalEmailQueueId:createdQueueIds.find(x=>x.endsWith('-email'))||'',approvalLineQueueId:createdQueueIds.find(x=>x.endsWith('-line'))||'',updatedAt:serverTs(),updatedAtText:nowText(),history:arrayUnion(event('approved',`完成入職建檔：${identityLabel(draft.identityType)}`))
    },{merge:true});
    await batch.commit();
    return {ok:true,message:'已完成入職建檔，員工、薪資投保與班表已一次建立。',employeeId,initialPassword,notificationQueueIds:createdQueueIds,emailQueued:createdQueueIds.some(x=>x.endsWith('-email')),lineQueued:createdQueueIds.some(x=>x.endsWith('-line'))};
  }

  async function reject(payload){
    const ensured=await ensureApplication(payload.applicationId||payload.id||payload.email);
    const app=ensured.data; const reason=clean(payload.rejectReason||payload.reason);
    if(!reason) return {ok:false,message:'請填寫駁回理由。'};
    const d=database(); const batch=d.batch();
    batch.set(d.collection(APP_COLLECTION).doc(ensured.id),{applicationStatus:'rejected',status:'已駁回',accountStatus:'rejected',rejectReason:reason,rejectedAt:serverTs(),rejectedAtText:nowText(),rejectedBy:clean(payload.userId||currentUser().id),updatedAt:serverTs(),updatedAtText:nowText(),history:arrayUnion(event('rejected',reason))},{merge:true});
    if(clean(app.legacyEmployeeDocId)) batch.set(d.collection('employees').doc(clean(app.legacyEmployeeDocId)),{accountStatus:'rejected',employmentStatus:'archived',hiddenFromActiveLists:true,rejectReason:reason,updatedAt:serverTs()},{merge:true});
    const queueId='onboarding-rejected-'+safeId(ensured.id)+'-'+Date.now();
    const body=`${clean(app.name)}您好：\n\n申請未通過。\n原因：${reason}`;
    batch.set(d.collection('notificationQueue').doc(queueId),{queueId,channel:'email',targetEmail:lower(app.email),targetName:clean(app.name),title:'人員申請未通過',body,message:body,status:'待發送',source:VERSION,createdAt:serverTs(),createdAtText:nowText()},{merge:true});
    await batch.commit();
    return {ok:true,message:'已駁回申請並建立 Email 通知。'};
  }

  async function requestResubmission(payload){
    const ensured=await ensureApplication(payload.applicationId);
    const app=ensured.data; const reason=clean(payload.reason||payload.resubmissionReason);
    if(!reason) return {ok:false,message:'請填寫需要補件的原因。'};
    const token=randomToken(20);
    let url='register.html';
    try{ url=new URL('register.html',global.location.href).href+`?mode=resubmit&applicationId=${encodeURIComponent(ensured.id)}&token=${encodeURIComponent(token)}`; }catch(e){}
    const d=database(); const batch=d.batch();
    batch.set(d.collection(APP_COLLECTION).doc(ensured.id),{applicationStatus:'needs_identity_resubmission',status:'待補件',accountStatus:'pending',resubmissionReason:reason,applicantResubmissionToken:token,resubmissionRequestedAt:serverTs(),resubmissionRequestedAtText:nowText(),updatedAt:serverTs(),updatedAtText:nowText(),history:arrayUnion(event('resubmission_requested',reason))},{merge:true});
    const queueId='onboarding-resubmit-'+safeId(ensured.id)+'-'+Date.now();
    const body=`${clean(app.name)}您好：\n\n申請資料需補件。\n原因：${reason}\n\n請重新上傳證件正面：\n${url}`;
    batch.set(d.collection('notificationQueue').doc(queueId),{queueId,channel:'email',targetEmail:lower(app.email),targetName:clean(app.name),title:'人員申請需補件',body,message:body,status:'待發送',source:VERSION,createdAt:serverTs(),createdAtText:nowText()},{merge:true});
    await batch.commit();
    return {ok:true,message:'已退回補件並建立 Email 通知。'};
  }

  async function getResubmission(payload){
    const id=clean(payload.applicationId), token=clean(payload.token);
    const app=await getDoc(APP_COLLECTION,id);
    if(!app || !token || clean(app.applicantResubmissionToken)!==token || statusKey(app)!=='needs_identity_resubmission') return {ok:false,message:'補件連結無效或已失效。'};
    return {ok:true,application:{applicationId:id,name:clean(app.name),emailMasked:maskEmail(app.email),identityDocumentType:clean(app.identityDocumentType||'national_id'),reason:clean(app.resubmissionReason)}};
  }

  async function resubmitIdentity(payload){
    const id=clean(payload.applicationId), token=clean(payload.token);
    const app=await getDoc(APP_COLLECTION,id);
    if(!app || !token || clean(app.applicantResubmissionToken)!==token) return {ok:false,message:'補件連結無效或已失效。'};
    if(!clean(payload.identityDocumentUrl)) return {ok:false,message:'請先上傳證件正面。'};
    await database().collection(APP_COLLECTION).doc(id).set({
      identityDocumentType:clean(payload.identityDocumentType||app.identityDocumentType||'national_id'), identityDocumentTypeLabel:identityDocumentTypeLabel(payload.identityDocumentType||app.identityDocumentType),
      identityDocumentUrl:clean(payload.identityDocumentUrl), identityDocumentPublicId:clean(payload.identityDocumentPublicId), identityDocumentFileName:clean(payload.identityDocumentFileName),
      identityDocumentUploadedAtText:nowText(), identityDocumentWatermark:clean(payload.identityDocumentWatermark), identityDocumentConsent:true,
      applicationStatus:'pending_setup',status:'待主管建檔',accountStatus:'pending',resubmissionReason:'',applicantResubmissionToken:'',updatedAt:serverTs(),updatedAtText:nowText(),history:arrayUnion({action:'identity_resubmitted',note:'申請人重新上傳證件正面',actorId:'applicant',actorName:clean(app.name),atText:nowText(),source:VERSION})
    },{merge:true});
    return {ok:true,message:'證件已重新送出，請等待主管審核。'};
  }

  function rawEmployeeId(row){ return clean(row&&((row.employeeId||row.id||row.userId||row.__id))); }
  function rawEmployeeEmail(row){ return lower(row&&((row.email||row.Email))); }
  function isSystemEmployeeRow(row){
    const raw=row&&row.raw&&typeof row.raw==='object'?row.raw:row||{};
    return isSystemEmployee(Object.assign({},raw,{employeeId:rawEmployeeId(row)}));
  }
  function employeeActiveRank(row){
    const account=lower(row&&(row.accountStatus||row.status));
    const employment=lower(row&&row.employmentStatus);
    const hidden=row&&row.hiddenFromActiveLists===true;
    if(account==='active' && (!employment||employment==='active') && !hidden) return 4;
    if(account==='pending') return 1;
    if(account==='rejected') return 0;
    return 2;
  }
  function employeeQuality(row){
    const raw=row&&row.raw&&typeof row.raw==='object'?row.raw:row||{};
    return employeeActiveRank(row)*100 + (truthy(raw.onboardingCompleted)?30:0) + (clean(raw.idNumber)?8:0) + (clean(raw.mobilePhone)?4:0) + (clean(raw.hireDate||raw.cooperationStartDate)?2:0);
  }
  function dedupeEmployeeRows(rows){
    const groups=new Map();
    (rows||[]).filter(function(row){ return !isSystemEmployeeRow(row); }).forEach(function(row){
      const email=rawEmployeeEmail(row), id=rawEmployeeId(row);
      const key=email?('email:'+email):('id:'+id);
      if(!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(row);
    });
    const out=[], duplicateGroups=[];
    groups.forEach(function(group,key){
      group.sort(function(a,b){ return employeeQuality(b)-employeeQuality(a); });
      const chosen=Object.assign({},group[0]);
      chosen.duplicateRecordCount=Math.max(0,group.length-1);
      chosen.duplicateRecordIds=group.slice(1).map(rawEmployeeId).filter(Boolean);
      out.push(chosen);
      if(group.length>1) duplicateGroups.push({key,count:group.length,keptEmployeeId:rawEmployeeId(chosen),recordIds:group.map(rawEmployeeId).filter(Boolean)});
    });
    return {rows:out,duplicateGroups};
  }
  async function managementData(payload){
    const base=typeof previousHandle==='function'?await previousHandle('getEmployeeManagementData',payload||{}):{ok:true,rows:[]};
    if(!base||base.ok===false) return base;
    const deduped=dedupeEmployeeRows(base.rows||base.employees||base.list||[]);
    const rows=deduped.rows;
    const active=function(row){ return employeeActiveRank(row)===4; };
    const countsByType={staff:0,parttime:0,external:0};
    rows.filter(active).forEach(function(row){
      const type=clean(row.identityType)==='parttime'?'parttime':(clean(row.identityType)==='external'?'external':'staff');
      countsByType[type]++;
    });
    return Object.assign({},base,{rows,employees:rows,list:rows,countsByType,duplicateGroups:deduped.duplicateGroups,systemRecordsExcluded:true});
  }
  async function findEmployeeRecord(payload){
    payload=payload||{};
    const ids=[clean(payload.employeeId),clean(payload.id),clean(payload.userId)].filter(Boolean);
    for(const id of ids){
      let row=await getDoc('employees',id); if(row&&!isSystemEmployee(row)) return row;
      const q=await queryRows('employees','employeeId',id).catch(()=>[]); if(q[0]&&!isSystemEmployee(q[0])) return q[0];
    }
    const email=lower(payload.email);
    if(email){ const rows=await employeesByEmail(email); const valid=rows.filter(function(r){return !isSystemEmployee(r);}); if(valid[0]) return valid[0]; }
    return null;
  }
  async function findSalaryRecord(employee){
    if(!employee) return null;
    const id=clean(employee.employeeId||employee.__id), email=lower(employee.email||employee.Email);
    let row=id?await getDoc('employeeSalaryConfigs',id):null;
    if(row) return row;
    if(id){ const q=await queryRows('employeeSalaryConfigs','employeeId',id).catch(()=>[]); if(q[0]) return q[0]; }
    if(email){ const q=await queryRows('employeeSalaryConfigs','email',email).catch(()=>[]); if(q[0]) return q[0]; }
    return null;
  }
  function scheduleEnabled(row){
    const enabled=clean(row&&(row.enabled!==undefined?row.enabled:row['是否啟用'])).toLowerCase();
    if(['false','0','否','停用','disabled'].includes(enabled)) return false;
    const end=dateText(row&&(row.endDate||row['結束日期']));
    return !end || end>=todayText();
  }
  async function lifecycleSummary(payload){
    const employee=await findEmployeeRecord(payload||{});
    if(!employee) return {ok:false,message:'找不到員工資料。'};
    const employeeId=clean(employee.employeeId||employee.__id);
    const [salary,schedules]=await Promise.all([findSalaryRecord(employee),all('employeeSchedules').catch(()=>[])]);
    const matched=schedules.filter(function(row){ return clean(row.employeeId||row['員工ID'])===employeeId; }).sort(function(a,b){ return dateText(b.startDate||b['開始日期']).localeCompare(dateText(a.startDate||a['開始日期'])); });
    const current=matched.find(scheduleEnabled)||matched[0]||null;
    return {ok:true,employeeId,salary:salary||{},schedule:current?{
      assignmentId:clean(current.assignmentId||current.__id),templateId:clean(current.templateId||current['模板ID']),templateName:clean(current.templateName||current['模板名稱']||'未命名班表'),
      startDate:dateText(current.startDate||current['開始日期']),endDate:dateText(current.endDate||current['結束日期']),enabled:scheduleEnabled(current)
    }:{},scheduleCount:matched.length};
  }
  async function archiveLifecycle(payload){
    const employee=await findEmployeeRecord(payload||{});
    if(!employee) return {ok:false,message:'找不到員工資料。'};
    const employeeId=clean(employee.employeeId||employee.__id), docId=clean(employee.__id||employeeId);
    const d=database(); const batch=d.batch(); const endDate=dateText(payload.endDate)||todayText(); const external=clean(employee.identityType)==='external';
    batch.set(d.collection('employees').doc(docId),{
      accountStatus:'archived',employmentStatus:external?'contractorEnded':'resigned',hiddenFromActiveLists:true,resignedDate:external?'':endDate,cooperationEndDate:external?endDate:'',
      lineNotifyEnabled:false,statusNote:clean(payload.reason||payload.statusNote||'由主管執行離職／合作結束並封存'),archivedAt:serverTs(),archivedAtText:nowText(),archivedBy:clean(payload.userId||currentUser().id),updatedAt:serverTs(),updatedAtText:nowText(),source:VERSION
    },{merge:true});
    const schedules=await all('employeeSchedules').catch(()=>[]); let closed=0;
    schedules.filter(function(row){return clean(row.employeeId||row['員工ID'])===employeeId&&scheduleEnabled(row);}).forEach(function(row){
      const id=clean(row.assignmentId||row.__id); if(!id) return; closed++;
      batch.set(d.collection('employeeSchedules').doc(id),{enabled:'FALSE',endDate:endDate,closedByArchive:true,updatedAt:serverTs(),updatedAtText:nowText()},{merge:true});
    });
    await batch.commit();
    return {ok:true,message:external?'已結束合作並封存；歷史資料仍保留。':'已辦理離職並封存；歷史資料仍保留。',employeeId,closedSchedules:closed};
  }
  async function saveSalaryConfigExtended(payload){
    const base=typeof previousHandle==='function'?await previousHandle('saveEmployeeSalaryConfig',payload||{}):null;
    if(base&&base.ok===false) return base;
    const employee=await findEmployeeRecord(payload||{});
    if(!employee) return base||{ok:false,message:'找不到員工資料。'};
    const employeeId=clean(employee.employeeId||employee.__id),docId=clean(employee.__id||employeeId);
    const laborActive=insuranceActive(payload.laborStatus),healthActive=insuranceActive(payload.healthStatus);
    const patch={updatedAt:serverTs(),updatedAtText:nowText(),source:VERSION};
    if(!laborActive){ Object.assign(patch,{laborInsuredSalary:0,laborSalary:0,laborSelfPay:0,laborEmployeeSelfPay:0,laborInsuranceSelfPay:0,laborSelfPayText:'',laborTotalPremium:0,laborEmployerPay:0,laborGovernmentPay:0,retirementEmployerAmount:0,laborRetirementEmployerAmount:0,retirementEmployerText:'',laborRetirementEmployerText:'',laborRetirementSalary:0,selfRetirementAmount:0}); }
    else{
      const laborSalary=hasNumber(payload.laborInsuredSalary)?numberValue(payload.laborInsuredSalary):numberValue(payload.laborRetirementSalary);
      const laborFees=laborFeeBreakdown(laborSalary);
      const employerAmount=hasNumber(payload.retirementEmployerAmount)?numberValue(payload.retirementEmployerAmount):retirementEmployerAmount(laborSalary);
      const selfAmount=hasNumber(payload.selfRetirementAmount)?numberValue(payload.selfRetirementAmount):(clean(payload.selfRetirementEnabled)==='是'?Math.round(laborSalary*numberValue(payload.selfRetirementRate)/100):0);
      if(laborSalary>0) Object.assign(patch,{laborInsuredSalary:laborSalary,laborSalary:laborSalary,laborRetirementSalary:laborSalary});
      const laborEmployee=hasNumber(payload.laborSelfPay)?numberValue(payload.laborSelfPay):laborFees.employee;
      Object.assign(patch,{laborSelfPay:laborEmployee,laborEmployeeSelfPay:laborEmployee,laborInsuranceSelfPay:laborEmployee,laborSelfPayText:moneyText(laborEmployee),laborTotalPremium:hasNumber(payload.laborTotalPremium)?numberValue(payload.laborTotalPremium):laborFees.total,laborEmployerPay:hasNumber(payload.laborEmployerPay)?numberValue(payload.laborEmployerPay):laborFees.employer,laborGovernmentPay:hasNumber(payload.laborGovernmentPay)?numberValue(payload.laborGovernmentPay):laborFees.government,laborFeeSource:'BLI_115_GENERAL_LABOR_EMPLOYMENT'});
      Object.assign(patch,{retirementEmployerRate:6,laborRetirementEmployerRate:6,retirementEmployerAmount:employerAmount,laborRetirementEmployerAmount:employerAmount,retirementEmployerText:'6%｜'+moneyText(employerAmount),laborRetirementEmployerText:'6%｜'+moneyText(employerAmount),selfRetirementAmount:selfAmount});
    }
    if(!healthActive){ Object.assign(patch,{healthInsuredSalary:0,healthSalary:0,healthDependents:0,healthSelfPay:0,healthEmployeeSelfPay:0,healthInsuranceSelfPay:0,healthSelfPayText:'',healthTotalPremium:0,healthEmployerPay:0,healthGovernmentPay:0}); }
    else{
      const healthSalary=numberValue(payload.healthInsuredSalary);
      const healthFees=healthFeeBreakdown(healthSalary,payload.healthDependents);
      if(hasNumber(payload.healthInsuredSalary)) Object.assign(patch,{healthInsuredSalary:healthSalary,healthSalary:healthSalary});
      const healthEmployee=hasNumber(payload.healthSelfPay)?numberValue(payload.healthSelfPay):healthFees.employee;
      Object.assign(patch,{healthDependents:numberValue(payload.healthDependents),healthSelfPay:healthEmployee,healthEmployeeSelfPay:healthEmployee,healthInsuranceSelfPay:healthEmployee,healthSelfPayText:moneyText(healthEmployee),healthTotalPremium:hasNumber(payload.healthTotalPremium)?numberValue(payload.healthTotalPremium):healthFees.total,healthEmployerPay:hasNumber(payload.healthEmployerPay)?numberValue(payload.healthEmployerPay):healthFees.employer,healthGovernmentPay:hasNumber(payload.healthGovernmentPay)?numberValue(payload.healthGovernmentPay):healthFees.government,healthFeeSource:'NHI_115_EMPLOYEE'});
    }
    if(Array.isArray(payload.jobAllowances)) patch.jobAllowances=lineItems(payload.jobAllowances);
    if(Array.isArray(payload.allowances)) patch.allowances=lineItems(payload.allowances);
    const batch=database().batch();
    batch.set(database().collection('employees').doc(docId),patch,{merge:true});
    batch.set(database().collection('employeeSalaryConfigs').doc(employeeId),patch,{merge:true});
    await batch.commit();
    return Object.assign({},base||{ok:true,message:'薪資設定已儲存。'},{employeeConfig:Object.assign({},base&&base.employeeConfig||{},patch)});
  }

  async function profileWithIdentity(action,payload){
    const base=typeof previousHandle==='function' ? await previousHandle(action,payload||{}) : null;
    if(!base || base.ok===false) return base;
    let employee=null;
    const ids=[clean(payload&&payload.employeeId),clean(payload&&payload.userId),clean(payload&&payload.id)].filter(Boolean);
    for(const id of ids){ employee=await getDoc('employees',id); if(employee) break; try{const rows=await queryRows('employees','employeeId',id); if(rows[0]){employee=rows[0];break;}}catch(e){} }
    if(!employee && clean(payload&&payload.email)){ const rows=await employeesByEmail(payload.email); employee=rows[0]||null; }
    if(employee){
      base.profile=Object.assign({},base.profile||{}, {
        identityDocumentType:clean(employee.identityDocumentType), identityDocumentTypeLabel:identityDocumentTypeLabel(employee.identityDocumentType),
        identityDocumentUrl:clean(employee.identityDocumentUrl), identityDocumentVerified:employee.identityDocumentVerified===true,
        identityVerificationStatus:clean(employee.identityVerificationStatus), identityVerifiedAtText:clean(employee.identityVerifiedAtText),
        identityDocumentUseNotice:clean(employee.identityDocumentUseNotice)
      });
    }
    return base;
  }

  async function countsWithApplications(action,payload){
    const base=typeof previousHandle==='function' ? (await previousHandle(action,payload||{}).catch(()=>({ok:true,counts:{}}))) : {ok:true,counts:{}};
    const count=(await pendingApplications()).length;
    const counts=Object.assign({},base&&base.counts||base&&base.summary||base||{});
    const oldReg=Number(counts.registrationCount||counts.pendingRegistrationCount||counts.registrations||0)||0;
    const oldApproval=Number(counts.approvalCount||0)||0;
    counts.registrationCount=count; counts.pendingRegistrationCount=count; counts.registrations=count;
    if(oldApproval) counts.approvalCount=Math.max(0,oldApproval-oldReg+count);
    return Object.assign({},base||{ok:true},counts,{counts});
  }


  async function ensureEmployeeLineBindCode(payload){
    payload=payload||{};
    const key=clean(payload.employeeId||payload.id||payload.userId);
    const email=lower(payload.email);
    let target=key?await getDoc('employees',key).catch(()=>null):null;
    if(!target && email){ const rows=await employeesByEmail(email); target=rows[0]||null; }
    if(!target) return {ok:false,message:'找不到人員資料，無法產生 LINE 綁定碼。'};
    const docId=clean(target.__id||target.employeeId||key);
    let code=clean(target.employeeBindCode||target.bindingCode||target.lineBindingCode);
    if(!code || payload.forceNew===true) code=makeEmployeeBindCode();
    const pref=notificationPreference(payload.notificationPreference||target.notificationPreference||target.notificationMethod, !!lower(target.email||email));
    const bindText=employeeBindText(code);
    const d=database(); const batch=d.batch();
    batch.set(d.collection('employees').doc(docId),{employeeBindCode:code,employeeBindText:bindText,notificationPreference:pref,notificationPreferenceLabel:notificationLabel(pref),lineBindStatus:clean(target.lineUserId)?'bound':'pending',updatedAt:serverTs(),updatedAtText:nowText(),source:VERSION},{merge:true});
    batch.set(d.collection('employeeLineBindings').doc(code),{bindingCode:code,employeeBindCode:code,bindText,employeeId:clean(target.employeeId||docId),employeeDocId:docId,targetCollection:'employees',status:clean(target.lineUserId)?'bound':'pending',name:clean(target.name||target.displayName),email:lower(target.email||email),mobilePhone:clean(target.mobilePhone||target.phone),notificationPreference:pref,updatedAt:serverTs(),updatedAtText:nowText(),source:VERSION},{merge:true});
    await batch.commit();
    return {ok:true,message:'已產生 LINE 綁定文字。',employeeBindCode:code,employeeBindText:bindText,bindText};
  }
  fb.handleApi=async function(action,payload){
    const a=clean(action);
    if(a==='register') return await createApplication(payload||{});
    if(a==='getPendingRegistrations'){ const rows=await pendingApplications(); return {ok:true,rows,list:rows}; }
    if(a==='getOnboardingSetupOptions') return {ok:true,scheduleTemplates:await scheduleTemplates()};
    if(a==='saveRegistrationOnboardingDraft') return await saveDraft(payload||{});
    if(a==='approveRegistrationOnboarding') return await approve(payload||{});
    if(a==='approveRegistrationApi' && (payload&&payload.onboardingDraft)) return await approve(payload||{});
    if(a==='rejectRegistrationApi') return await reject(payload||{});
    if(a==='requestRegistrationResubmission') return await requestResubmission(payload||{});
    if(a==='getRegistrationResubmission') return await getResubmission(payload||{});
    if(a==='resubmitRegistrationIdentity') return await resubmitIdentity(payload||{});
    if(a==='getEmployeeManagementData') return await managementData(payload||{});
    if(a==='getEmployeeLifecycleSummary') return await lifecycleSummary(payload||{});
    if(a==='archiveEmployeeLifecycle') return await archiveLifecycle(payload||{});
    if(a==='ensureEmployeeLineBindCode' || a==='generateEmployeeLineBindCode') return await ensureEmployeeLineBindCode(payload||{});
    if(a==='saveEmployeeSalaryConfig') return await saveSalaryConfigExtended(payload||{});
    if(a==='getMyProfileFull' || a==='getMyDataFull') return await profileWithIdentity(a,payload||{});
    if(a==='getDashboardSummary' || a==='getPendingCounts') return await countsWithApplications(a,payload||{});
    if(typeof previousHandle==='function') return await previousHandle(action,payload||{});
    return null;
  };

  fb.__onboardingWorkflowV20260624=true;
  global.YZOnboarding={VERSION,pendingApplications,onboardingMissing,normalizeApplication};
  global.YZFirebase=fb;
})(window);
