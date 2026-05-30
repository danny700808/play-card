(function(global){
  'use strict';
  const TYPE_LABEL={employment:'在職證明',teaching:'教學證明'};
  const TYPE_TITLE={employment:'在職證明書',teaching:'教學證明書'};
  const STATUS={DRAFT:'草稿',PENDING:'待主管審核',APPROVED:'已核准',REJECTED:'已退回'};
  const UNITS={
    company:{
      key:'company', shortName:'尚品樂器行', name:'尚品樂器行', idLabel:'統一編號', idNo:'99680937',
      address:'台中市豐原區圓環東路347號4樓', phone:'04-25227893',
      unitStamp:'shangpin-company-seal.png', invoiceStamp:'shangpin-invoice-stamp.png', personalStamp:'personal-seal.png'
    },
    school:{
      key:'school', shortName:'凱立音樂短期補習班', name:'台中市私立凱立音樂短期補習班', idLabel:'證號', idNo:'1110094357 號',
      address:'台中市豐原區圓環東路347號', phone:'04-25227893',
      unitStamp:'kaili-school-seal.png', invoiceStamp:'', personalStamp:'personal-seal.png'
    }
  };
  const ASSETS={logoBlack:'yuzu-logo-black.png',logoGreen:'yuzu-logo-green.png',personalStamp:'personal-seal.png'};
  const DEFAULT_TEMPLATES={
    employment:{
      type:'employment', documentTitle:'在職證明書', defaultUnit:'company', showLogo:true, logoFile:ASSETS.logoBlack,
      bodyText:'茲證明下列人員現任職於本單位，任職資料如下，特此證明。',
      footerText:'本證明僅作為申請人任職事實之證明，不作其他用途。',
      closingText:'特此證明', showUnitStamp:true, showPersonalStamp:true, showApprovalLine:true,
      watermarkDraft:'草稿\n尚未送出', watermarkPending:'主管尚未核准\n僅供預覽', watermarkRejected:'申請已退回\n僅供預覽',
      noteText:'請依實際任職／教學身分選擇開立單位。若是補習班老師身分，請選擇「台中市私立凱立音樂短期補習班」；若是公司／樂器行工作身分，請選擇「尚品樂器行」。開立單位會影響證明書名稱與使用印章，請勿選錯。'
    },
    teaching:{
      type:'teaching', documentTitle:'教學證明書', defaultUnit:'school', showLogo:true, logoFile:ASSETS.logoBlack,
      bodyText:'茲證明下列教師於本單位擔任教學工作，教學資料如下，特此證明。',
      footerText:'本證明僅作為申請人於本單位教學事實之證明，不作其他用途。',
      closingText:'特此證明', showUnitStamp:true, showPersonalStamp:true, showApprovalLine:true,
      watermarkDraft:'草稿\n尚未送出', watermarkPending:'主管尚未核准\n僅供預覽', watermarkRejected:'申請已退回\n僅供預覽',
      noteText:'教學證明預設由「台中市私立凱立音樂短期補習班」開立，授課地點固定為合法立案地址：台中市豐原區圓環東路347號。'
    }
  };
  const SAMPLE_DATA={
    employment:{name:'王小明',idNumber:'A123456789',jobTitle:'專職老師',workNature:'音樂教學',hireDate:'2024-08-01',stillEmployed:true,issueDate:today(),issuerUnit:'company'},
    teaching:{teacherName:'王小明',idNumber:'A123456789',teacherRole:'外聘老師',subject:'鋼琴',periodStart:'2024-08-01',periodEnd:'',stillTeaching:true,lessonType:'個別課',issueDate:today(),issuerUnit:'school'}
  };

  function clean(v){return String(v==null?'':v).trim();}
  function upperId(v){return clean(v).toUpperCase().replace(/\s+/g,'');}
  function escapeHtml(v){return clean(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function nl2br(v){return escapeHtml(v).replace(/\n/g,'<br>');}
  function today(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function nowIso(){return new Date().toISOString();}
  function dateText(v){const s=clean(v); if(!s) return ''; if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10); return s;}
  function dateTimeText(v){ if(!v) return ''; try{ const d=(v&&typeof v.toDate==='function')?v.toDate():new Date(v); if(isNaN(d.getTime())) return clean(v); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }catch(e){return clean(v);} }
  function rocDate(v){const s=dateText(v)||today(); const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(!m) return s; return '民國 '+(Number(m[1])-1911)+' 年 '+Number(m[2])+' 月 '+Number(m[3])+' 日';}
  function maskId(v){const s=upperId(v); if(!s) return ''; if(s.length<=4) return s; return s.slice(0,1)+'*****'+s.slice(-4);}
  function getUserSafe(){try{ if(typeof global.getUser==='function') return global.getUser(); return JSON.parse(localStorage.getItem('employeeUser')||'null'); }catch(e){return null;} }
  function userKey(user){return clean(user && (user.id||user.employeeId||user.userId||user.email||user.name)) || 'unknown';}
  function userName(user){return clean(user && (user.name||user.displayName||user.email)) || '未命名';}
  function isManagerSafe(user){try{ if(typeof global.isManager==='function') return global.isManager(user); }catch(e){} return !!(user && (user.showSettingsZone || clean(user.role).toLowerCase()==='admin'));}
  function requireLoginSafe(){try{ if(typeof global.requireLogin==='function') return global.requireLogin(); }catch(e){} const u=getUserSafe(); if(!u){location.href='index.html'; return null;} return u;}
  function homeHref(user){try{ if(typeof global.userHomeHref==='function') return global.userHomeHref(user); }catch(e){} return clean(user&&user.identityType)==='external'?'teacher-home.html':'dashboard.html';}
  function setMessage(el,text,isError){ if(!el) return; el.textContent=text||''; el.classList.toggle('error',!!isError); el.classList.toggle('show',!!text); }
  function db(){ try{ if(global.YZFirebase && typeof global.YZFirebase.init==='function') return global.YZFirebase.init(); }catch(e){} try{ if(global.firebase && global.firebase.firestore) return global.firebase.firestore(); }catch(e){} return null; }
  function deepMerge(a,b){const out=Object.assign({},a||{}); Object.keys(b||{}).forEach(k=>{ if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k]) && !(b[k] instanceof Date)){out[k]=deepMerge(out[k],b[k]);} else {out[k]=b[k];} }); return out;}
  function templateDocId(type){return type==='teaching'?'teachingCertificate':'employmentCertificate';}
  function defaultTemplate(type){return deepMerge({}, DEFAULT_TEMPLATES[type]||DEFAULT_TEMPLATES.employment);}
  function localKey(key){return 'YZ_CERT_'+key;}
  function getLocalJson(key,def){try{return JSON.parse(localStorage.getItem(localKey(key))||'')||def;}catch(e){return def;}}
  function setLocalJson(key,val){try{localStorage.setItem(localKey(key),JSON.stringify(val));}catch(e){}}

  async function getTemplate(type){
    const base=defaultTemplate(type);
    const d=db();
    if(d){
      try{
        const snap=await d.collection('printTemplates').doc(templateDocId(type)).get();
        if(snap.exists) return deepMerge(base, snap.data()||{});
      }catch(e){console.warn('[certificate] getTemplate Firebase fallback',e);}
    }
    return deepMerge(base, getLocalJson('template_'+type, {}));
  }
  async function saveTemplate(type,template,user){
    const row=deepMerge(defaultTemplate(type),template||{});
    row.type=type; row.updatedAt=nowIso(); row.updatedBy=userName(user); row.updatedById=userKey(user);
    const history=deepMerge({}, row); history.historyId='TPL_'+type+'_'+Date.now(); history.createdAt=nowIso();
    const d=db();
    if(d){
      try{
        await d.collection('printTemplates').doc(templateDocId(type)).set(row,{merge:true});
        await d.collection('certificateTemplateHistory').doc(history.historyId).set(history,{merge:true});
        setLocalJson('template_'+type,row);
        return {ok:true,id:history.historyId};
      }catch(e){console.warn('[certificate] saveTemplate Firebase fallback',e);}
    }
    setLocalJson('template_'+type,row);
    const list=getLocalJson('templateHistory_'+type,[]); list.unshift(history); setLocalJson('templateHistory_'+type,list.slice(0,50));
    return {ok:true,id:history.historyId,local:true};
  }
  async function getTemplateHistory(type){
    const d=db();
    if(d){
      try{
        const snap=await d.collection('certificateTemplateHistory').where('type','==',type).get();
        const rows=[]; snap.forEach(doc=>rows.push(Object.assign({historyId:doc.id},doc.data()||{})));
        return rows.sort((a,b)=>clean(b.createdAt||b.updatedAt).localeCompare(clean(a.createdAt||a.updatedAt)));
      }catch(e){console.warn('[certificate] getTemplateHistory Firebase fallback',e);}
    }
    return getLocalJson('templateHistory_'+type,[]);
  }
  async function deleteTemplateHistory(id,type){
    const d=db();
    if(d){ try{await d.collection('certificateTemplateHistory').doc(id).delete(); return {ok:true};}catch(e){console.warn('[certificate] deleteTemplateHistory fallback',e);} }
    const list=getLocalJson('templateHistory_'+type,[]).filter(r=>r.historyId!==id); setLocalJson('templateHistory_'+type,list); return {ok:true,local:true};
  }
  async function saveApplication(type,payload,opts){
    opts=opts||{}; const user=opts.user||getUserSafe(); const id=clean(opts.applicationId)||clean(payload.applicationId)||('CERT_'+type+'_'+userKey(user)+'_'+Date.now());
    const status=opts.status||STATUS.DRAFT; const old=opts.old||{};
    const templateSnapshot=opts.templateSnapshot || old.templateSnapshot || await getTemplate(type);
    const row=Object.assign({},old,{applicationId:id,type,status,applicantId:userKey(user),applicantName:userName(user),applicantIdentity:clean(user&&user.identityType),data:payload,templateSnapshot,updatedAt:nowIso(),updatedBy:userName(user)});
    if(!row.createdAt) row.createdAt=nowIso();
    if(status===STATUS.PENDING) row.submittedAt=nowIso();
    if(status===STATUS.DRAFT && !row.submittedAt) row.submittedAt='';
    const d=db();
    if(d){ try{ await d.collection('certificateApplications').doc(id).set(row,{merge:true}); return {ok:true,row}; }catch(e){console.warn('[certificate] saveApplication Firebase fallback',e);} }
    const list=getLocalJson('applications',[]); const idx=list.findIndex(r=>r.applicationId===id); if(idx>=0) list[idx]=row; else list.unshift(row); setLocalJson('applications',list); return {ok:true,row,local:true};
  }
  async function getMyApplications(type,user){
    const key=userKey(user); const d=db();
    if(d){
      try{
        const snap=await d.collection('certificateApplications').where('applicantId','==',key).get();
        const rows=[]; snap.forEach(doc=>rows.push(Object.assign({applicationId:doc.id},doc.data()||{})));
        return rows.filter(r=>r.type===type).sort((a,b)=>clean(b.updatedAt||b.createdAt).localeCompare(clean(a.updatedAt||a.createdAt)));
      }catch(e){console.warn('[certificate] getMyApplications Firebase fallback',e);}
    }
    return getLocalJson('applications',[]).filter(r=>r.type===type && r.applicantId===key).sort((a,b)=>clean(b.updatedAt||b.createdAt).localeCompare(clean(a.updatedAt||a.createdAt)));
  }
  async function getAllApplications(filters){
    filters=filters||{}; const d=db(); let rows=[];
    if(d){
      try{ const snap=await d.collection('certificateApplications').get(); snap.forEach(doc=>rows.push(Object.assign({applicationId:doc.id},doc.data()||{}))); }
      catch(e){console.warn('[certificate] getAllApplications Firebase fallback',e); rows=getLocalJson('applications',[]);}
    }else rows=getLocalJson('applications',[]);
    if(filters.type) rows=rows.filter(r=>r.type===filters.type);
    if(filters.status) rows=rows.filter(r=>r.status===filters.status);
    return rows.sort((a,b)=>clean(b.updatedAt||b.createdAt).localeCompare(clean(a.updatedAt||a.createdAt)));
  }
  async function updateApplicationStatus(id,status,extra){
    extra=extra||{}; const d=db(); const update=Object.assign({},extra,{status,reviewedAt:nowIso(),updatedAt:nowIso()});
    if(status===STATUS.APPROVED) update.approvedAt=nowIso();
    if(status===STATUS.REJECTED) update.rejectedAt=nowIso();
    if(d){ try{ await d.collection('certificateApplications').doc(id).set(update,{merge:true}); return {ok:true}; }catch(e){console.warn('[certificate] updateApplicationStatus fallback',e);} }
    const list=getLocalJson('applications',[]); const idx=list.findIndex(r=>r.applicationId===id); if(idx>=0){ list[idx]=Object.assign({},list[idx],update); setLocalJson('applications',list); }
    return {ok:true,local:true};
  }
  async function deleteApplication(id){
    const d=db(); if(d){ try{ await d.collection('certificateApplications').doc(id).delete(); return {ok:true}; }catch(e){console.warn('[certificate] deleteApplication fallback',e);} }
    const list=getLocalJson('applications',[]).filter(r=>r.applicationId!==id); setLocalJson('applications',list); return {ok:true,local:true};
  }

  function unitFor(data,template,type){const k=clean(data&&data.issuerUnit)||clean(template&&template.defaultUnit)||((type==='teaching')?'school':'company'); return UNITS[k]||UNITS.company;}
  function periodText(start,end,still){const s=dateText(start); const e=still?'迄今':dateText(end); return [s,e].filter(Boolean).join(' 至 ') || '—';}
  function tableRows(type,data){
    data=data||{};
    if(type==='teaching'){
      return [
        ['教師姓名', data.teacherName], ['身分證字號', upperId(data.idNumber)], ['教師身分', data.teacherRole], ['任教科目', data.subject],
        ['任教期間', periodText(data.periodStart,data.periodEnd,data.stillTeaching)], ['授課類型', data.lessonType], ['授課地點', '台中市豐原區圓環東路347號']
      ];
    }
    return [
      ['姓名', data.name], ['身分證字號', upperId(data.idNumber)], ['職稱', data.jobTitle], ['工作性質', data.workNature],
      ['到職日期', dateText(data.hireDate)], ['任職狀態', data.stillEmployed?'現仍在職':'已離職']
    ];
  }
  function statusClass(status){if(status===STATUS.APPROVED) return 'approved'; if(status===STATUS.PENDING) return 'pending'; if(status===STATUS.REJECTED) return 'rejected'; return 'draft';}
  function watermarkText(status,template){if(status===STATUS.APPROVED) return ''; if(status===STATUS.PENDING) return template.watermarkPending||DEFAULT_TEMPLATES.employment.watermarkPending; if(status===STATUS.REJECTED) return template.watermarkRejected||DEFAULT_TEMPLATES.employment.watermarkRejected; return template.watermarkDraft||DEFAULT_TEMPLATES.employment.watermarkDraft;}
  function renderCertificate(type,data,template,options){
    options=options||{}; data=data||{}; template=deepMerge(defaultTemplate(type),template||{}); const unit=unitFor(data,template,type); const status=options.status||STATUS.DRAFT; const wm=options.hideWatermark?'':watermarkText(status,template);
    const issueDate=data.issueDate||dateText(data.approvedAt)||today();
    const rows=tableRows(type,data).map(([k,v])=>`<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v||'—')}</td></tr>`).join('');
    const stampHtml=[];
    if(template.showUnitStamp!==false){ stampHtml.push(`<div class="cert-stamp-box"><img class="cert-stamp unit" src="${escapeHtml(unit.unitStamp)}" alt="單位章"><div>單位章</div></div>`); }
    if(template.showPersonalStamp!==false){ stampHtml.push(`<div class="cert-stamp-box"><img class="cert-stamp personal" src="${escapeHtml(unit.personalStamp||ASSETS.personalStamp)}" alt="個人章"><div>負責人章</div></div>`); }
    const approvalLine = template.showApprovalLine===false ? '' : `<div class="cert-approval-line">${status===STATUS.APPROVED?'主管核准：'+escapeHtml(data.approvedByName||data.reviewedByName||'主管')+'｜核准時間：'+escapeHtml(dateTimeText(data.approvedAt||data.reviewedAt)): '主管核准後，本證明始為正式文件。'}</div>`;
    return `<article class="certificate-page" data-cert-type="${escapeHtml(type)}">
      ${wm?`<div class="cert-watermark">${nl2br(wm)}</div>`:''}
      <div class="certificate-content">
        ${template.showLogo===false?'':`<div class="cert-logo-wrap"><img class="cert-logo" src="${escapeHtml(template.logoFile||ASSETS.logoBlack)}" alt="柚子樂器 YOU ZI MUSIC"></div>`}
        <h1 class="cert-doc-title">${escapeHtml(template.documentTitle||TYPE_TITLE[type])}</h1>
        <p class="cert-body-text">${nl2br(template.bodyText||'')}</p>
        <table class="cert-table"><tbody>${rows}</tbody></table>
        <div class="cert-footer-text">${nl2br(template.footerText||'')}</div>
        <div class="cert-footer-text">${nl2br(template.closingText||'特此證明')}</div>
        <div class="cert-spacer"></div>
        <section class="cert-issuer">
          <div class="cert-issuer-row"><span class="cert-issuer-label">對外品牌</span><span>柚子樂器｜YOU ZI MUSIC</span></div>
          <div class="cert-issuer-row"><span class="cert-issuer-label">開立單位</span><span>${escapeHtml(unit.name)}</span></div>
          <div class="cert-issuer-row"><span class="cert-issuer-label">${escapeHtml(unit.idLabel)}</span><span>${escapeHtml(unit.idNo)}</span></div>
          <div class="cert-issuer-row"><span class="cert-issuer-label">地址</span><span>${escapeHtml(unit.address)}</span></div>
          <div class="cert-issuer-row"><span class="cert-issuer-label">電話</span><span>${escapeHtml(unit.phone)}</span></div>
          <div class="cert-issuer-row"><span class="cert-issuer-label">開立日期</span><span>${escapeHtml(rocDate(issueDate))}</span></div>
          ${approvalLine}
        </section>
        <div class="cert-stamp-zone">${stampHtml.join('')}</div>
      </div>
    </article>`;
  }
  function waitForImages(root){
    const imgs=Array.from((root||document).querySelectorAll('img'));
    return Promise.all(imgs.map(img=>img.complete?Promise.resolve():new Promise(res=>{img.onload=img.onerror=res;})));
  }
  function collectTemplateForm(type){
    const v=id=>{const el=document.getElementById(id); return el?el.value:''};
    const c=id=>{const el=document.getElementById(id); return el?el.checked:false};
    return {type,documentTitle:v('documentTitle'),defaultUnit:v('defaultUnit'),showLogo:c('showLogo'),logoFile:v('logoFile')||ASSETS.logoBlack,bodyText:v('bodyText'),footerText:v('footerText'),closingText:v('closingText'),showUnitStamp:c('showUnitStamp'),showPersonalStamp:c('showPersonalStamp'),showApprovalLine:c('showApprovalLine'),watermarkDraft:v('watermarkDraft'),watermarkPending:v('watermarkPending'),watermarkRejected:v('watermarkRejected'),noteText:v('noteText')};
  }
  function fillTemplateForm(template){
    const set=(id,val)=>{const el=document.getElementById(id); if(el) el.value=val==null?'':val;};
    const chk=(id,val)=>{const el=document.getElementById(id); if(el) el.checked=val!==false;};
    set('documentTitle',template.documentTitle); set('defaultUnit',template.defaultUnit); set('logoFile',template.logoFile||ASSETS.logoBlack); set('bodyText',template.bodyText); set('footerText',template.footerText); set('closingText',template.closingText); set('watermarkDraft',template.watermarkDraft); set('watermarkPending',template.watermarkPending); set('watermarkRejected',template.watermarkRejected); set('noteText',template.noteText); chk('showLogo',template.showLogo); chk('showUnitStamp',template.showUnitStamp); chk('showPersonalStamp',template.showPersonalStamp); chk('showApprovalLine',template.showApprovalLine);
  }
  function collectUserForm(type){
    const v=id=>{const el=document.getElementById(id); return el?el.value:''};
    const c=id=>{const el=document.getElementById(id); return !!(el&&el.checked);};
    if(type==='teaching') return {teacherName:v('teacherName'),idNumber:upperId(v('idNumber')),teacherRole:v('teacherRole'),subject:v('subject'),periodStart:v('periodStart'),periodEnd:v('periodEnd'),stillTeaching:c('stillTeaching'),lessonType:v('lessonType'),issueDate:v('issueDate')||today(),issuerUnit:v('issuerUnit')||'school'};
    return {name:v('name'),idNumber:upperId(v('idNumber')),jobTitle:v('jobTitle'),workNature:v('workNature'),hireDate:v('hireDate'),stillEmployed:c('stillEmployed'),issueDate:v('issueDate')||today(),issuerUnit:v('issuerUnit')||'company'};
  }
  function fillUserForm(type,data){
    data=data||{}; const set=(id,val)=>{const el=document.getElementById(id); if(el) el.value=val==null?'':val;}; const chk=(id,val)=>{const el=document.getElementById(id); if(el) el.checked=!!val;};
    if(type==='teaching'){set('teacherName',data.teacherName); set('idNumber',upperId(data.idNumber)); set('teacherRole',data.teacherRole); set('subject',data.subject); set('periodStart',dateText(data.periodStart)); set('periodEnd',dateText(data.periodEnd)); chk('stillTeaching',data.stillTeaching); set('lessonType',data.lessonType); set('issueDate',dateText(data.issueDate)||today()); set('issuerUnit',data.issuerUnit||'school');}
    else {set('name',data.name); set('idNumber',upperId(data.idNumber)); set('jobTitle',data.jobTitle); set('workNature',data.workNature); set('hireDate',dateText(data.hireDate)); chk('stillEmployed',data.stillEmployed!==false); set('issueDate',dateText(data.issueDate)||today()); set('issuerUnit',data.issuerUnit||'company');}
  }
  function validateData(type,data){
    const miss=[];
    if(type==='teaching'){
      if(!clean(data.teacherName)) miss.push('教師姓名'); if(!upperId(data.idNumber)) miss.push('身分證字號'); if(!clean(data.teacherRole)) miss.push('教師身分'); if(!clean(data.subject)) miss.push('任教科目'); if(!clean(data.periodStart)) miss.push('任教期間起日'); if(!clean(data.lessonType)) miss.push('授課類型');
    }else{
      if(!clean(data.name)) miss.push('姓名'); if(!upperId(data.idNumber)) miss.push('身分證字號'); if(!clean(data.jobTitle)) miss.push('職稱'); if(!clean(data.workNature)) miss.push('工作性質'); if(!clean(data.hireDate)) miss.push('到職日期'); if(!clean(data.issuerUnit)) miss.push('開立單位');
    }
    return miss;
  }
  function setIdUppercaseBinding(){ const el=document.getElementById('idNumber'); if(el){ el.addEventListener('input',()=>{const pos=el.selectionStart; el.value=upperId(el.value); try{el.setSelectionRange(pos,pos);}catch(e){} }); } }
  function statusPill(status){return `<span class="cert-status-pill ${statusClass(status)}">${escapeHtml(status||STATUS.DRAFT)}</span>`;}
  function bindInputs(selector,cb){Array.from(document.querySelectorAll(selector)).forEach(el=>{el.addEventListener('input',cb); el.addEventListener('change',cb);});}
  function renderIntoPrintArea(type,data,template,status){const el=document.getElementById('printArea'); if(el) el.innerHTML=renderCertificate(type,data,template,{status});}

  async function initTemplateAdmin(type){
    const user=requireLoginSafe(); if(!user) return; if(!isManagerSafe(user)){location.href='dashboard.html';return;}
    const msg=document.getElementById('msg'); const label=TYPE_LABEL[type]; document.querySelectorAll('[data-cert-label]').forEach(el=>el.textContent=label);
    let template=await getTemplate(type); fillTemplateForm(template); renderIntoPrintArea(type,Object.assign({},SAMPLE_DATA[type],{issuerUnit:template.defaultUnit}),template,STATUS.PENDING);
    bindInputs('#templateForm input,#templateForm textarea,#templateForm select',()=>{template=collectTemplateForm(type); renderIntoPrintArea(type,Object.assign({},SAMPLE_DATA[type],{issuerUnit:template.defaultUnit}),template,STATUS.PENDING);});
    const saveBtn=document.getElementById('saveTemplateBtn'); if(saveBtn) saveBtn.onclick=async()=>{try{template=collectTemplateForm(type); await saveTemplate(type,template,user); setMessage(msg,'已儲存範本，並新增一筆範本歷史。'); await renderTemplateHistory(type);}catch(e){setMessage(msg,e.message||'儲存失敗',true);}};
    await renderTemplateHistory(type);
  }
  async function renderTemplateHistory(type){
    const box=document.getElementById('templateHistory'); if(!box) return; const rows=await getTemplateHistory(type);
    if(!rows.length){box.innerHTML='<div class="cert-empty">目前沒有範本歷史紀錄。</div>';return;}
    box.innerHTML=rows.map((r,i)=>`<div class="cert-history-item" data-history-id="${escapeHtml(r.historyId)}"><div class="cert-history-head"><div><div class="cert-history-title">${escapeHtml(r.documentTitle||TYPE_TITLE[type])}</div><div class="cert-history-meta">${escapeHtml(dateTimeText(r.createdAt||r.updatedAt))}｜開立單位：${escapeHtml((UNITS[r.defaultUnit]||{}).name||r.defaultUnit||'')}</div></div><div class="cert-mini-preview">A4</div></div><div class="cert-history-actions"><button class="btn cert-ghost" type="button" data-action="preview">預覽</button><button class="btn" type="button" data-action="apply">套用</button><button class="btn cert-danger" type="button" data-action="delete">刪除</button></div></div>`).join('');
    Array.from(box.querySelectorAll('button')).forEach(btn=>btn.onclick=async()=>{const item=btn.closest('[data-history-id]'); const id=item&&item.getAttribute('data-history-id'); const row=rows.find(r=>r.historyId===id); const act=btn.getAttribute('data-action'); if(!row) return; if(act==='preview'){renderIntoPrintArea(type,Object.assign({},SAMPLE_DATA[type],{issuerUnit:row.defaultUnit}),row,STATUS.PENDING);} if(act==='apply'){fillTemplateForm(row); renderIntoPrintArea(type,Object.assign({},SAMPLE_DATA[type],{issuerUnit:row.defaultUnit}),row,STATUS.PENDING); window.scrollTo({top:0,behavior:'smooth'});} if(act==='delete'){if(confirm('確定刪除這筆範本歷史？')){await deleteTemplateHistory(id,type); await renderTemplateHistory(type);}} });
  }

  async function initUserApplication(type){
    const user=requireLoginSafe(); if(!user) return; document.querySelectorAll('[data-cert-label]').forEach(el=>el.textContent=TYPE_LABEL[type]); const back=document.getElementById('backHomeBtn'); if(back){back.href=homeHref(user);} const msg=document.getElementById('msg'); let template=await getTemplate(type); let current=null; let currentStatus=STATUS.DRAFT;
    const defaults=Object.assign({},SAMPLE_DATA[type]); if(type==='teaching'){defaults.teacherName=userName(user); defaults.idNumber=''; defaults.periodStart=''; defaults.periodEnd=''; defaults.subject=''; defaults.teacherRole=clean(user.identityType)==='external'?'外聘老師':''; defaults.lessonType='個別課'; defaults.issuerUnit='school';}
    else {defaults.name=userName(user); defaults.idNumber=''; defaults.hireDate=''; defaults.issuerUnit=template.defaultUnit||'company'; defaults.stillEmployed=true;}
    fillUserForm(type,defaults); setIdUppercaseBinding(); renderIntoPrintArea(type,collectUserForm(type),template,currentStatus); bindInputs('#applicationForm input,#applicationForm textarea,#applicationForm select',()=>{renderIntoPrintArea(type,collectUserForm(type),current&&current.templateSnapshot?current.templateSnapshot:template,currentStatus);});
    const statusBox=document.getElementById('currentStatusBox'); const refreshStatus=()=>{if(statusBox) statusBox.innerHTML=statusPill(currentStatus)+(current&&current.rejectReason?`<div class="cert-muted" style="margin-top:6px">退回原因：${escapeHtml(current.rejectReason)}</div>`:'');}; refreshStatus();
    async function loadHistory(){ const box=document.getElementById('applicationHistory'); if(!box) return; const rows=await getMyApplications(type,user); if(!rows.length){box.innerHTML='<div class="cert-empty">目前沒有歷史申請紀錄。</div>';return;} box.innerHTML=rows.map(r=>{const d=r.data||{}; const name=type==='teaching'?d.teacherName:d.name; return `<div class="cert-history-item" data-app-id="${escapeHtml(r.applicationId)}"><div class="cert-history-head"><div><div class="cert-history-title">${escapeHtml(TYPE_LABEL[type])}｜${escapeHtml(name||'未填姓名')} ${statusPill(r.status)}</div><div class="cert-history-meta">更新：${escapeHtml(dateTimeText(r.updatedAt||r.createdAt))}｜身分證：${escapeHtml(maskId(d.idNumber))}</div></div><div class="cert-mini-preview">預覽</div></div><div class="cert-history-actions"><button class="btn cert-ghost" type="button" data-action="view">查看</button><button class="btn" type="button" data-action="reuse">帶入修改</button><button class="btn cert-danger" type="button" data-action="delete">刪除</button></div></div>`;}).join(''); Array.from(box.querySelectorAll('button')).forEach(btn=>btn.onclick=async()=>{const id=btn.closest('[data-app-id]').getAttribute('data-app-id'); const row=rows.find(r=>r.applicationId===id); if(!row) return; const act=btn.getAttribute('data-action'); if(act==='delete'){if(confirm('確定刪除這筆歷史申請？')){await deleteApplication(id); if(current&&current.applicationId===id){current=null; currentStatus=STATUS.DRAFT;} await loadHistory(); return;}} current=row; currentStatus=row.status||STATUS.DRAFT; fillUserForm(type,row.data||{}); renderIntoPrintArea(type,Object.assign({},row.data||{},row),row.templateSnapshot||template,currentStatus); refreshStatus(); setMessage(msg,act==='view'?'已載入歷史紀錄預覽。':'已帶入歷史資料，可修改後儲存草稿或重新送審。'); window.scrollTo({top:0,behavior:'smooth'});}); }
    async function saveWithStatus(status){ const data=collectUserForm(type); const miss=validateData(type,data); if(miss.length){setMessage(msg,'請先填寫：'+miss.join('、'),true);return;} try{ const res=await saveApplication(type,data,{user,status,applicationId:current&&current.applicationId,old:current||{},templateSnapshot:(current&&current.templateSnapshot)||template}); current=res.row; currentStatus=status; renderIntoPrintArea(type,data,current.templateSnapshot||template,currentStatus); refreshStatus(); await loadHistory(); setMessage(msg,status===STATUS.PENDING?'已送出主管審核。核准前預覽與列印會保留浮水印。':'已儲存草稿。'); }catch(e){setMessage(msg,e.message||'儲存失敗',true);} }
    const saveDraftBtn=document.getElementById('saveDraftBtn'); if(saveDraftBtn) saveDraftBtn.onclick=()=>saveWithStatus(STATUS.DRAFT);
    const submitBtn=document.getElementById('submitReviewBtn'); if(submitBtn) submitBtn.onclick=()=>saveWithStatus(STATUS.PENDING);
    const printBtn=document.getElementById('printBtn'); if(printBtn) printBtn.onclick=async()=>{const raw=collectUserForm(type); const data=Object.assign({},raw,current||{}); if(!verifyIdPassword(raw.idNumber,'列印驗證')) return; renderIntoPrintArea(type,data,(current&&current.templateSnapshot)||template,currentStatus); document.body.classList.add('cert-print-unlocked'); setTimeout(()=>{global.print(); setTimeout(()=>document.body.classList.remove('cert-print-unlocked'),800);},80);};
    const pdfBtn=document.getElementById('downloadPdfBtn'); if(pdfBtn) pdfBtn.onclick=async()=>{const raw=collectUserForm(type); const data=Object.assign({},raw,current||{}); if(!verifyIdPassword(raw.idNumber,'另存加密 PDF 驗證')) return; try{setMessage(msg,'正在產生加密 PDF，請稍候。'); await downloadEncryptedPdf(type,data,(current&&current.templateSnapshot)||template,currentStatus); setMessage(msg,'已產生加密 PDF。開啟檔案時，密碼為本人身分證字號。');}catch(e){setMessage(msg,e.message||'PDF 產生失敗',true);} };
    await loadHistory();
  }
  function verifyIdPassword(idNumber,title){ const real=upperId(idNumber); if(!real){alert('請先填寫身分證字號。');return false;} const input=upperId(prompt((title||'文件驗證')+'\n\n此文件含個人資料，請輸入本人身分證字號。英文會自動轉成大寫。')||''); if(!input) return false; if(input!==real){alert('身分證字號不符，無法列印或另存。');return false;} return true; }
  async function downloadEncryptedPdf(type,data,template,status){
    if(!(global.html2canvas && global.jspdf && global.jspdf.jsPDF)) throw new Error('PDF 套件尚未載入完成，請重新整理後再試。');
    const holder=document.createElement('div'); holder.style.position='fixed'; holder.style.left='-10000px'; holder.style.top='0'; holder.style.width='210mm'; holder.style.background='#fff'; holder.innerHTML=renderCertificate(type,data,template,{status}); document.body.appendChild(holder); await waitForImages(holder); const page=holder.querySelector('.certificate-page');
    const canvas=await global.html2canvas(page,{scale:2,useCORS:true,backgroundColor:'#ffffff'}); const img=canvas.toDataURL('image/jpeg',0.98); const password=upperId(data.idNumber); const {jsPDF}=global.jspdf; const pdf=new jsPDF({orientation:'p',unit:'mm',format:'a4',encryption:{userPassword:password,ownerPassword:password+'_YUZU_OWNER',userPermissions:['print']}}); pdf.addImage(img,'JPEG',0,0,210,297); const blob=pdf.output('blob'); holder.remove(); const url=URL.createObjectURL(blob); const a=document.createElement('a'); const n=type==='teaching'?(data.teacherName||'教學證明'):(data.name||'在職證明'); a.href=url; a.download=`${TYPE_LABEL[type]}_${clean(n).replace(/[\\/:*?"<>|]/g,'_')}_${today().replace(/-/g,'')}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  async function initReviewAdmin(){
    const user=requireLoginSafe(); if(!user) return; if(!isManagerSafe(user)){location.href='dashboard.html'; return;} const msg=document.getElementById('msg'); let rows=[]; let selected=null;
    async function load(){ const type=document.getElementById('filterType').value; const status=document.getElementById('filterStatus').value; rows=await getAllApplications({type,status}); renderList(); }
    function renderList(){ const box=document.getElementById('reviewList'); if(!box) return; if(!rows.length){box.innerHTML='<div class="cert-empty">目前沒有符合條件的申請。</div>'; document.getElementById('printArea').innerHTML=''; return;} box.innerHTML=rows.map(r=>{const d=r.data||{}; const name=r.type==='teaching'?d.teacherName:d.name; return `<div class="cert-history-item" data-app-id="${escapeHtml(r.applicationId)}"><div class="cert-history-head"><div><div class="cert-history-title">${escapeHtml(TYPE_LABEL[r.type]||r.type)}｜${escapeHtml(name||r.applicantName||'未填姓名')} ${statusPill(r.status)}</div><div class="cert-history-meta">申請人：${escapeHtml(r.applicantName||'')}｜送出：${escapeHtml(dateTimeText(r.submittedAt||r.updatedAt||r.createdAt))}｜身分證：${escapeHtml(maskId(d.idNumber))}</div></div><div class="cert-mini-preview">A4</div></div><div class="cert-history-actions"><button class="btn" type="button" data-action="view">預覽</button><button class="btn" type="button" data-action="approve">核准</button><button class="btn cert-warn" type="button" data-action="reject">退回</button><button class="btn cert-danger" type="button" data-action="delete">刪除</button></div></div>`;}).join(''); Array.from(box.querySelectorAll('button')).forEach(btn=>btn.onclick=async()=>{const id=btn.closest('[data-app-id]').getAttribute('data-app-id'); const row=rows.find(r=>r.applicationId===id); if(!row) return; const act=btn.getAttribute('data-action'); if(act==='view'){selected=row; renderSelected(); return;} if(act==='approve'){if(confirm('確定核准這筆證明申請？')){await updateApplicationStatus(id,STATUS.APPROVED,{reviewedById:userKey(user),reviewedByName:userName(user),approvedByName:userName(user)}); setMessage(msg,'已核准申請。'); await load();}} if(act==='reject'){const reason=prompt('請輸入退回原因：')||''; if(!reason) return; await updateApplicationStatus(id,STATUS.REJECTED,{reviewedById:userKey(user),reviewedByName:userName(user),rejectReason:reason}); setMessage(msg,'已退回申請。'); await load();} if(act==='delete'){if(confirm('確定刪除這筆申請？')){await deleteApplication(id); setMessage(msg,'已刪除申請。'); await load();}} }); }
    function renderSelected(){ if(!selected) return; const data=Object.assign({},selected.data||{},selected); renderIntoPrintArea(selected.type,data,selected.templateSnapshot||defaultTemplate(selected.type),selected.status||STATUS.DRAFT); const info=document.getElementById('selectedInfo'); if(info) info.innerHTML=`目前預覽：${escapeHtml(TYPE_LABEL[selected.type])}｜${escapeHtml(selected.applicantName||'')}｜${statusPill(selected.status)}`; }
    document.getElementById('filterType').onchange=load; document.getElementById('filterStatus').onchange=load; await load();
  }

  global.Certificates={STATUS,UNITS,TYPE_LABEL,defaultTemplate,getTemplate,renderCertificate,initTemplateAdmin,initUserApplication,initReviewAdmin};
})(window);
