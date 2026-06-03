/* 安全版按鈕進度條狀態：避免 iOS / LINE WebView 快取舊版 app.js 時卡登入 */
window.__btnProgressMap = window.__btnProgressMap || new WeakMap();
function getBtnProgressMap_(){
  if(!window.__btnProgressMap){ window.__btnProgressMap = new WeakMap(); }
  return window.__btnProgressMap;
}
var __btnProgressMap = getBtnProgressMap_();


const API_URL = String((window.APP_CONFIG && window.APP_CONFIG.API_URL) || window.API_URL || localStorage.getItem('EMPLOYEE_SYSTEM_API_BASE') || '').trim();
function qs(s){return document.querySelector(s)}
function qsa(s){return Array.from(document.querySelectorAll(s))}
function saveUser(user){localStorage.setItem('employeeUser', JSON.stringify(user)); if(user&&user.id){localStorage.setItem('employeeUserId', String(user.id))} else {localStorage.removeItem('employeeUserId')}}
function setPortalMode(mode){localStorage.setItem('employeePortalMode', mode==='settings'?'settings':'staff')}
function getPortalMode(){return localStorage.getItem('employeePortalMode')||'staff'}
function clearPortalMode(){localStorage.removeItem('employeePortalMode')}
function hasSettingsZoneAccess(user=getUser()){return !!(user && (user.showSettingsZone || String(user.role||'').toLowerCase()==='admin'))}
function isManager(user=getUser()){return !!(user && (user.showSettingsZone || String(user.role||'').toLowerCase()==='admin'))}
function identityTypeOf(user=getUser()){const raw=String((user&&user.identityType)||'').trim().toLowerCase(); if(raw==='parttime'||raw==='staff'||raw==='external') return raw; return user&&user.isPartTime?'parttime':'staff'}
function identityLabelOf(user=getUser()){const type=identityTypeOf(user); return type==='parttime'?'工讀生':(type==='external'?'外聘老師':'專職員工')}
function isPartTimeUser(user=getUser()){return identityTypeOf(user)==='parttime'}
function isExternalTeacher(user=getUser()){return identityTypeOf(user)==='external'}
function canUseFeature(feature,user=getUser()){const type=identityTypeOf(user); if(!user) return false; if(feature==='dashboard') return type!=='external'; if(feature==='clock') return type==='staff' || type==='parttime'; if(feature==='parttime') return type==='parttime'; if(feature==='leave') return type==='staff' || type==='parttime'; if(feature==='routine') return type==='staff' || type==='parttime'; if(feature==='training') return type==='staff' || type==='parttime'; if(feature==='announcement') return true; if(feature==='forms') return true;
if(feature==='task') return true; if(feature==='contract') return type==='external'; if(feature==='contractAdmin') return !!(user && (user.showSettingsZone || String(user.role||'').toLowerCase()==='admin')); return true;}
function guardFeatureAccess(feature,user=getUser()){if(canUseFeature(feature,user)) return true; location.href=isExternalTeacher(user)?'teacher-home.html':'dashboard.html'; return false;}
function isSettingsMode(){return hasSettingsZoneAccess() && getPortalMode()==='settings'}
function modeHomeHref(){return isSettingsMode() ? 'settings.html' : 'dashboard.html'}
function settingsHomeHref(){return 'settings.html'}
function staffHomeHref(){return 'dashboard.html'}
function teacherHomeHref(){return 'teacher-home.html'}
function userHomeHref(user=getUser()){if(isExternalTeacher(user)) return teacherHomeHref(); return isManager(user)&&isSettingsMode() ? settingsHomeHref() : staffHomeHref()}
function userHomeLabel(user=getUser()){if(isExternalTeacher(user)) return '返回老師首頁'; if(isPartTimeUser(user)) return '返回工讀首頁'; return isManager(user)&&isSettingsMode() ? '返回管理首頁' : '返回員工首頁'}
function portalSwitchLabel(user=getUser()){return hasSettingsZoneAccess(user) ? '切換入口' : '系統入口'}
function getUser(){try{return JSON.parse(localStorage.getItem('employeeUser')||'null')}catch(e){return null}}
function getApiUrl(){return API_URL}
function logout(){localStorage.removeItem('employeeUser'); localStorage.removeItem('employeeUserId'); clearPortalMode(); location.href='index.html'}
function currentFeatureKey(){const path=String((location&&location.pathname)||'').split('/').pop().toLowerCase(); if(path==='dashboard.html') return 'dashboard'; if(path==='clock.html') return 'clock'; if(path==='parttime.html') return 'parttime'; if(path==='leave.html') return 'leave'; if(path==='announcements.html') return 'announcement'; if(path==='task.html') return 'task'; if(path==='routine.html') return 'routine'; if(path==='training.html') return 'training'; if(path==='contract.html') return 'contract'; if(path==='contract-admin.html') return 'contractAdmin'; if(path==='forms-hub.html'||path==='gift-point-card.html'||path==='employment-certificate.html'||path==='teaching-certificate.html') return 'forms'; if(path==='settings.html') return 'settings'; return '';}
function requireLogin(){const user=getUser(); if(!user){location.href='index.html'; return null;} const feature=currentFeatureKey(); if(feature==='contract' && !isExternalTeacher(user)){location.href='dashboard.html'; return null;} if(feature==='contractAdmin' && !isManager(user)){location.href='dashboard.html'; return null;} if(feature && feature!=='contract' && feature!=='contractAdmin' && feature!=='settings' && !guardFeatureAccess(feature,user)) return null; return user;}
async function api(action, payload={}){
  const firebaseOnlyActions = {
    getSalarySetupOptions:true,
    saveEmployeeSalaryConfig:true,
    getMySalaryInfo:true,
    getMyProfileFull:true,
    getMyDataFull:true,
    getEmployeeManagementData:true,
    updateEmployeeAdminStatus:true,
    getEmployeeHistorySnapshot:true,
    getEmployeeOptions:true,
    searchTeacherWebsiteGoods:true,
    getTeacherGoodsList:true,
    getTeacherGoodsAdminData:true,
    getTeacherGoodsInquiries:true,
    getTeacherGoodsInquiryAdminList:true,
    getTeacherGoodsBadgeCounts:true,
    submitTeacherGoodsInquiry:true,
    replyTeacherGoodsInquiry:true,
    saveTeacherGoodsItem:true,
    deleteTeacherGoodsItem:true,
    getTeacherContractAdminConfig:true,
    saveTeacherContractSetting:true,
    publishTeacherContract:true,
    archiveTeacherContract:true,
    getTeacherContractAdminList:true,
    getTeacherContracts:true,
    getTeacherContractStatus:true,
    submitTeacherContractSignature:true,
    resendTeacherContractPdf:true
  };
  // Firebase 第二階段：讀取型資料優先走 Firebase；薪資/投保相關資料已正式切換為 Firebase-only。
  try{
    if(window.YZFirebase && typeof window.YZFirebase.handleApi === 'function'){
      const fbRes = await window.YZFirebase.handleApi(action, payload || {});
      if(fbRes) return fbRes;
    }
    if(firebaseOnlyActions[action]) throw new Error('Firebase 尚未回應此薪資投保功能');
  }catch(firebaseErr){
    if(firebaseOnlyActions[action]){
      console.warn('[Firebase only action failed]', action, firebaseErr);
      throw firebaseErr;
    }
    console.warn('[Firebase read fallback to GS]', action, firebaseErr);
  }
  if(firebaseOnlyActions[action]) throw new Error('薪資與投保設定目前只允許使用 Firebase / Firestore，不再回退舊系統。');
  const apiUrl=getApiUrl();
  if(!apiUrl) throw new Error('尚未設定 API 網址');
  const res=await fetch(apiUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...payload})});
  const raw=await res.text();
  let parsed;
  try{ parsed = JSON.parse(raw); }catch(e){ throw new Error(raw || '伺服器回傳格式錯誤'); }

  // Firebase 第三階段：寫入型資料先採「雙寫」。
  // 原 GS 成功後，再同步鏡像一份到 Firebase；若 Firebase 同步失敗，不阻斷原本正式流程。
  try{
    if(parsed && parsed.ok && window.YZFirebase && typeof window.YZFirebase.mirrorApiWrite === 'function'){
      await window.YZFirebase.mirrorApiWrite(action, payload || {}, parsed);
    }
  }catch(firebaseMirrorErr){
    console.warn('[Firebase mirror write failed]', action, firebaseMirrorErr);
  }
  return parsed;
}
function setMsg(el, text, isError=false){if(!el) return; el.style.display=text?'block':'none'; el.textContent=text||''; el.classList.toggle('error',!!isError)}
function togglePassword(inputSel, btn){const input=qs(inputSel); const show=input.type==='password'; input.type=show?'text':'password'; btn.textContent=show?'🙈':'👁';}
async function getPublicIp(){try{const r=await fetch('https://api.ipify.org?format=json'); const j=await r.json(); return j.ip||'';}catch(e){return '';}}
async function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader(); r.onload=()=>resolve(String(r.result||'')); r.onerror=reject; r.readAsDataURL(file);});}

function dataUrlToBlob(dataUrl){
  const raw=String(dataUrl||'');
  if(!raw.startsWith('data:')) throw new Error('附件格式錯誤');
  const parts=raw.split(',');
  const meta=parts[0]||'';
  const body=parts[1]||'';
  const mime=((meta.match(/^data:([^;]+)/)||[])[1])||'application/octet-stream';
  const bin=atob(body);
  const arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
function dataUrlToFile(dataUrl, filename='upload.bin'){
  const blob=dataUrlToBlob(dataUrl);
  return new File([blob], filename, {type:blob.type || 'application/octet-stream'});
}
function getCloudinaryConfig(){
  const cfg=window.APP_CONFIG||{};
  return {
    cloudName:String(cfg.CLOUDINARY_CLOUD_NAME||'').trim(),
    uploadPreset:String(cfg.CLOUDINARY_UPLOAD_PRESET||'').trim(),
    rootFolder:String(cfg.CLOUDINARY_ROOT_FOLDER||'employee-system').trim() || 'employee-system',
    chunkSizeMB:Number(cfg.CLOUDINARY_CHUNK_SIZE_MB||20) || 20,
    maxVideoMB:Number(cfg.CLOUDINARY_SOFT_MAX_VIDEO_MB||0) || 0
  };
}
function sanitizeFolderSegment(value){
  return String(value||'').trim().replace(/\+/g,'/').replace(/^\/+|\/+$/g,'').replace(/[^a-zA-Z0-9_\-/]/g,'-');
}
function guessExtensionByMime(mime=''){
  const map={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','audio/webm':'webm','audio/mp4':'m4a','audio/mpeg':'mp3','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','application/pdf':'pdf','text/plain':'txt'};
  return map[String(mime||'').toLowerCase()] || 'bin';
}
function isCloudinaryUrl(url=''){
  return /https?:\/\/res\.cloudinary\.com\//i.test(String(url||''));
}
function transformCloudinaryUrl(url='', transform=''){
  const s=String(url||'').trim();
  if(!isCloudinaryUrl(s) || !transform) return s;
  return s.replace(/\/(image|video|raw)\/upload\//, function(m, rt){ return '/' + rt + '/upload/' + transform.replace(/^\/+|\/+$/g,'') + '/'; });
}
function optimizedVideoUrl(url=''){ return isCloudinaryUrl(url) ? transformCloudinaryUrl(url,'f_auto,q_auto') : String(url||''); }
function optimizedImageUrl(url=''){ return isCloudinaryUrl(url) ? transformCloudinaryUrl(url,'f_auto,q_auto') : String(url||''); }
function cloudinaryAssetFromResponse(res={}){
  return {
    url:String(res.secure_url||res.url||'').trim(),
    publicId:String(res.public_id||'').trim(),
    resourceType:String(res.resource_type||'').trim(),
    format:String(res.format||'').trim(),
    originalFilename:String(res.original_filename||res.display_name||res.public_id||'').trim(),
    bytes:Number(res.bytes||0) || 0
  };
}
async function uploadFileToCloudinary(file, opts={}){
  if(!file) throw new Error('沒有可上傳的檔案');
  const cfg=getCloudinaryConfig();
  if(!cfg.cloudName || !cfg.uploadPreset) throw new Error('Cloudinary 設定未完成');
  const folderParts=[cfg.rootFolder, sanitizeFolderSegment(opts.folder||'')].filter(Boolean);
  const endpoint=`https://api.cloudinary.com/v1_1/${cfg.cloudName}/auto/upload`;
  const chunkBytes=Math.max(5, Number(opts.chunkSizeMB||cfg.chunkSizeMB||20)) * 1024 * 1024;
  const total=file.size||0;
  const uploadId=`u_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
  const maxVideoMB=Number(opts.softMaxVideoMB||cfg.maxVideoMB||0) || 0;
  if(maxVideoMB && String(file.type||'').startsWith('video/') && total > maxVideoMB*1024*1024){
    throw new Error(`影片較大（${(total/1024/1024).toFixed(1)}MB），請確認網路穩定後再上傳`);
  }
  async function sendChunk(start){
    const end=Math.min(start+chunkBytes,total);
    const form=new FormData();
    form.append('file', file.slice(start,end), file.name||'upload.bin');
    form.append('upload_preset', cfg.uploadPreset);
    if(folderParts.length) form.append('folder', folderParts.join('/'));
    if(opts.publicId) form.append('public_id', String(opts.publicId));
    return await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open('POST', endpoint, true);
      xhr.setRequestHeader('X-Unique-Upload-Id', uploadId);
      xhr.setRequestHeader('Content-Range', `bytes ${start}-${end-1}/${total}`);
      xhr.upload.onprogress=(evt)=>{
        if(!opts.onProgress) return;
        const local=evt.lengthComputable ? evt.loaded/(end-start) : 0;
        const ratio=Math.max(0, Math.min(1, (start + ((end-start)*local))/total));
        opts.onProgress(ratio, evt);
      };
      xhr.onerror=()=>reject(new Error('Cloudinary 上傳失敗，請檢查網路後再試'));
      xhr.onload=()=>{
        try{
          const json=JSON.parse(xhr.responseText||'{}');
          if(xhr.status>=200 && xhr.status<300){ resolve(json); return; }
          reject(new Error(json.error?.message || 'Cloudinary 上傳失敗'));
        }catch(err){ reject(new Error('Cloudinary 回傳格式錯誤')); }
      };
      xhr.send(form);
    });
  }
  if(total && total>chunkBytes){
    let start=0,last={};
    while(start<total){
      last=await sendChunk(start);
      start=Math.min(start+chunkBytes,total);
      if(opts.onProgress) opts.onProgress(Math.max(0, Math.min(1, start/total)), null);
    }
    return last;
  }
  const form=new FormData();
  form.append('file', file);
  form.append('upload_preset', cfg.uploadPreset);
  if(folderParts.length) form.append('folder', folderParts.join('/'));
  if(opts.publicId) form.append('public_id', String(opts.publicId));
  return await new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open('POST', endpoint, true);
    xhr.upload.onprogress=(evt)=>{
      if(!opts.onProgress || !evt.lengthComputable) return;
      opts.onProgress(Math.max(0, Math.min(1, evt.loaded/evt.total)), evt);
    };
    xhr.onerror=()=>reject(new Error('Cloudinary 上傳失敗，請檢查網路後再試'));
    xhr.onload=()=>{
      try{
        const json=JSON.parse(xhr.responseText||'{}');
        if(xhr.status>=200 && xhr.status<300 && json.secure_url){ resolve(json); return; }
        reject(new Error(json.error?.message || 'Cloudinary 上傳失敗'));
      }catch(err){ reject(new Error('Cloudinary 回傳格式錯誤')); }
    };
    xhr.send(form);
  });
}
async function uploadFilesToCloudinary(files, opts={}){
  const list=Array.from(files||[]).filter(Boolean);
  const results=[];
  for(let i=0;i<list.length;i++){
    const file=list[i];
    const r=await uploadFileToCloudinary(file, Object.assign({}, opts, {
      onProgress:(ratio, evt)=>{
        if(typeof opts.onItemProgress==='function') opts.onItemProgress({index:i,total:list.length,ratio,file,event:evt});
        if(typeof opts.onProgress==='function') opts.onProgress(((i+ratio)/list.length), {index:i,total:list.length,ratio,file,event:evt});
      }
    }));
    results.push(r);
    if(typeof opts.onProgress==='function') opts.onProgress((i+1)/list.length, {index:i,total:list.length,ratio:1,file});
  }
  return results;
}

function isLineBound(user=getUser()){
  if(!user) return false;
  return !!(String(user.lineUserId||'').trim() && (String(user.lineNotifyEnabled||'').trim()==='是' || user.lineNotifyEnabled===true));
}
let __lineBindLinksCache=null;
async function getPublicSystemLinksCached(){
  if(__lineBindLinksCache) return __lineBindLinksCache;
  try{
    const r=await api('getPublicSystemLinks',{});
    __lineBindLinksCache={
      lineAddFriendUrl:String(r.lineAddFriendUrl||'').trim(),
      lineBotBasicId:String(r.lineBotBasicId||'').trim()
    };
  }catch(e){
    __lineBindLinksCache={lineAddFriendUrl:String((window.APP_CONFIG&&window.APP_CONFIG.LINE_ADD_FRIEND_URL)||'').trim(),lineBotBasicId:''};
  }
  return __lineBindLinksCache;
}

function ensureLineBindPromptStyle_(){
  if(document.getElementById('lineBindPromptStyle')) return;
  const s=document.createElement('style');
  s.id='lineBindPromptStyle';
  s.textContent=`

    /* 首頁上方三格：完全比照「個人資料」卡片 */
    .home-head-tools,
    .hero-tools{
      display:grid!important;
      grid-template-columns:repeat(3,minmax(0,1fr))!important;
      gap:12px!important;
      align-items:stretch!important;
      width:min(100%,620px)!important;
    }
    .home-head-tools > *,
    .hero-tools > *,
    .home-head-tools .top-tool-card,
    .hero-tools .top-tool-card{
      height:104px!important;
      min-height:104px!important;
      width:100%!important;
      box-sizing:border-box!important;
    }
    .home-head-tools .top-tool-card,
    .hero-tools .top-tool-card{
      padding:14px 16px!important;
      border:1px solid #d9e2ef!important;
      border-radius:24px!important;
      background:#f5f8fc!important;
      color:inherit!important;
      display:flex!important;
      flex-direction:column!important;
      justify-content:space-between!important;
      align-items:center!important;
      gap:8px!important;
      text-align:center!important;
      text-decoration:none!important;
      overflow:hidden!important;
    }
    .home-head-tools .top-tool-main,
    .hero-tools .top-tool-main{
      width:100%!important;
      display:flex!important;
      flex-direction:column!important;
      gap:6px!important;
      align-items:center!important;
      justify-content:flex-start!important;
      text-align:center!important;
    }
    .home-head-tools .top-tool-title,
    .hero-tools .top-tool-title{
      font-size:15px!important;
      font-weight:900!important;
      line-height:1.25!important;
      color:#18314a!important;
      white-space:nowrap!important;
      text-align:center!important;
    }
    .home-head-tools .top-tool-desc,
    .hero-tools .top-tool-desc{
      font-size:13px!important;
      font-weight:800!important;
      line-height:1.45!important;
      color:#5f7086!important;
      white-space:nowrap!important;
      text-align:center!important;
    }
    .home-head-tools .top-tool-actions,
    .hero-tools .top-tool-actions{
      display:flex!important;
      justify-content:center!important;
      align-items:center!important;
      width:100%!important;
      margin-top:auto!important;
    }
    .home-head-tools .top-tool-btn,
    .hero-tools .top-tool-btn{
      min-width:86px!important;
      padding:9px 14px!important;
      border-radius:16px!important;
      background:#1f7a5a!important;
      color:#fff!important;
      border:none!important;
      font-weight:900!important;
      font-size:14px!important;
      line-height:1.2!important;
      display:inline-flex!important;
      align-items:center!important;
      justify-content:center!important;
      text-decoration:none!important;
      white-space:nowrap!important;
    }
    .home-head-tools .top-tool-logout,
    .hero-tools .top-tool-logout{
      background:#f5f8fc!important;
      border-color:#d9e2ef!important;
      color:inherit!important;
    }
    .home-head-tools .top-tool-logout .logout-only-text,
    .hero-tools .top-tool-logout .logout-only-text{
      color:#18314a!important;
      font-size:15px!important;
      font-weight:900!important;
      line-height:1.25!important;
      white-space:nowrap!important;
    }
  
    /* 登出卡統一：所有首頁工具列的登出格，外框同大，整格綠底白字置中 */
    .home-head-tools .top-tool-logout,
    .hero-tools .top-tool-logout,
    .manage-head-tools .top-tool-logout,
    .home-head-tools .logout-card,
    .hero-tools .logout-card,
    .manage-head-tools .logout-card{
      height:96px!important;
      min-height:96px!important;
      width:100%!important;
      box-sizing:border-box!important;
      border:1px solid #1f7a5a!important;
      border-radius:22px!important;
      background:#1f7a5a!important;
      color:#fff!important;
      display:flex!important;
      align-items:center!important;
      justify-content:center!important;
      text-align:center!important;
      padding:12px!important;
      text-decoration:none!important;
      overflow:hidden!important;
    }
    .home-head-tools .top-tool-logout *,
    .hero-tools .top-tool-logout *,
    .manage-head-tools .top-tool-logout *,
    .home-head-tools .logout-card *,
    .hero-tools .logout-card *,
    .manage-head-tools .logout-card *{
      color:#fff!important;
    }
    .logout-only-text,
    .logout-mini-btn{
      color:#fff!important;
      font-size:16px!important;
      font-weight:900!important;
      line-height:1.2!important;
      white-space:nowrap!important;
      background:transparent!important;
      border:none!important;
      padding:0!important;
      margin:0!important;
    }
    @media(min-width:561px){
      .home-head-tools .top-tool-logout,
      .hero-tools .top-tool-logout,
      .manage-head-tools .top-tool-logout,
      .home-head-tools .logout-card,
      .hero-tools .logout-card,
      .manage-head-tools .logout-card{
        height:104px!important;
        min-height:104px!important;
        border-radius:24px!important;
        padding:14px 16px!important;
      }
    }

  @media(max-width:560px){
      .home-head-tools,
      .hero-tools{
        gap:10px!important;
        width:100%!important;
        grid-template-columns:repeat(3,minmax(0,1fr))!important;
      }
      .home-head-tools > *,
      .hero-tools > *,
      .home-head-tools .top-tool-card,
      .hero-tools .top-tool-card{
        height:96px!important;
        min-height:96px!important;
      }
      .home-head-tools .top-tool-card,
      .hero-tools .top-tool-card{
        padding:12px!important;
        border-radius:22px!important;
      }
      .home-head-tools .top-tool-title,
      .hero-tools .top-tool-title,
      .home-head-tools .top-tool-logout .logout-only-text,
      .hero-tools .top-tool-logout .logout-only-text{
        font-size:14px!important;
      }
      .home-head-tools .top-tool-desc,
      .hero-tools .top-tool-desc{
        font-size:12px!important;
      }
      .home-head-tools .top-tool-btn,
      .hero-tools .top-tool-btn{
        padding:8px 12px!important;
        font-size:13px!important;
      }
    }

  `;
 document.head.appendChild(s);
}

function ensureLineBindGuideModalStyle_(){
  if(document.getElementById('lineBindGuideModalStyle')) return;
  const s=document.createElement('style');
  s.id='lineBindGuideModalStyle';
  s.textContent=`
    .line-bind-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:18px;z-index:9999}
    .line-bind-modal{width:min(100%,520px);background:#fff;border-radius:24px;border:1px solid var(--line);box-shadow:0 24px 60px rgba(15,23,42,.22);padding:22px 20px 18px}
    .line-bind-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
    .line-bind-modal-title{font-size:22px;font-weight:900;color:#18314a;line-height:1.2}
    .line-bind-modal-sub{font-size:14px;color:var(--muted);line-height:1.7;margin-top:6px}
    .line-bind-modal-close{border:none;background:#eef2f6;color:#24384f;border-radius:999px;padding:8px 12px;font-weight:800;cursor:pointer}
    .line-bind-modal-steps{display:grid;gap:10px;margin:8px 0 14px}
    .line-bind-modal-step{display:flex;gap:10px;align-items:flex-start;background:#f7fafc;border:1px solid var(--line);border-radius:16px;padding:12px 14px}
    .line-bind-modal-num{flex:0 0 28px;height:28px;border-radius:999px;background:#1f7a5a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900}
    .line-bind-modal-text{font-size:15px;line-height:1.7;color:#18314a}
    .line-bind-modal-code{margin-top:6px;background:#0f172a;color:#f8fafc;border-radius:14px;padding:12px 14px;word-break:break-all;font-size:14px;line-height:1.7}
    .line-bind-modal-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;margin-top:8px}
    .line-bind-modal-actions .btn,.line-bind-modal-actions .btn.secondary{width:auto;padding:10px 16px}
    @media (max-width:640px){
      .line-bind-modal{padding:18px 16px 16px;border-radius:20px}
      .line-bind-modal-title{font-size:19px}
      .line-bind-modal-text{font-size:14px}
      .line-bind-modal-actions{justify-content:stretch}
      .line-bind-modal-actions .btn,.line-bind-modal-actions .btn.secondary,.line-bind-modal-close{flex:1 1 auto;text-align:center;justify-content:center}
    }
  
  .top-tool-logout,
  .top-tool-logout *,
  .logout-card,
  .logout-card *,
  .top-tool-logout .logout-only-text,
  .top-tool-logout span,
  .top-tool-logout button{
    color:#fff!important;
    -webkit-text-fill-color:#fff!important;
  }
`;
  document.head.appendChild(s);
}

async function openLineBindGuide_(email){
  const targetEmail=String(email||'').trim();
  if(!targetEmail) throw new Error('找不到可綁定的 Email');
  ensureLineBindGuideModalStyle_();
  const old=document.getElementById('lineBindGuideModalBackdrop');
  if(old) old.remove();
  let lineUrl='';
  try{
    const links=await getPublicSystemLinksCached();
    lineUrl=String((links&&links.lineAddFriendUrl)||'').trim();
  }catch(e){}
  const cmd=`柚子綁定 ${targetEmail}`;
  const wrap=document.createElement('div');
  wrap.id='lineBindGuideModalBackdrop';
  wrap.className='line-bind-modal-backdrop';
  wrap.innerHTML=`
    <div class="line-bind-modal" role="dialog" aria-modal="true" aria-labelledby="lineBindGuideModalTitle">
      <div class="line-bind-modal-head">
        <div>
          <div class="line-bind-modal-title" id="lineBindGuideModalTitle">LINE 綁定方式</div>
          <div class="line-bind-modal-sub">請依照下面步驟完成綁定，三種身份與管理者皆使用同一種方式。</div>
        </div>
        <button type="button" class="line-bind-modal-close" id="closeLineBindGuideModalBtn">關閉</button>
      </div>
      <div class="line-bind-modal-steps">
        <div class="line-bind-modal-step"><div class="line-bind-modal-num">1</div><div class="line-bind-modal-text">先加入柚子樂器官方 LINE。</div></div>
        <div class="line-bind-modal-step"><div class="line-bind-modal-num">2</div><div class="line-bind-modal-text">到官方 LINE 的留言區，貼上下面這串綁定文字並送出。<div class="line-bind-modal-code" id="lineBindGuideModalCode"></div></div></div>
      </div>
      <div class="line-bind-modal-actions" id="lineBindGuideModalActions">
        <button class="btn secondary" type="button" id="copyLineBindGuideModalBtn">複製綁定文字</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const codeEl=wrap.querySelector('#lineBindGuideModalCode');
  if(codeEl) codeEl.textContent=cmd;
  const close=()=>{ const el=document.getElementById('lineBindGuideModalBackdrop'); if(el) el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey=(ev)=>{ if(ev.key==='Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click',(ev)=>{ if(ev.target===wrap) close(); });
  const closeBtn=wrap.querySelector('#closeLineBindGuideModalBtn');
  if(closeBtn) closeBtn.onclick=close;
  const actionBox=wrap.querySelector('#lineBindGuideModalActions');
  if(actionBox && lineUrl){
    const a=document.createElement('a');
    a.className='btn';
    a.href=lineUrl;
    a.target='_blank';
    a.rel='noopener';
    a.textContent='加入官方 LINE';
    actionBox.insertBefore(a, actionBox.firstChild);
  }
  const copyBtn=wrap.querySelector('#copyLineBindGuideModalBtn');
  if(copyBtn){
    copyBtn.onclick=async()=>{
      try{
        const progress=startActionButtonProgress(copyBtn,{label:'複製中',startPct:12,maxPct:78,interval:120});
        if(navigator.clipboard && navigator.clipboard.writeText){
          await navigator.clipboard.writeText(cmd);
        }else{
          const ta=document.createElement('textarea'); ta.value=cmd; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        }
        progress.done('已複製',900);
      }catch(e){
        finishActionButtonError(copyBtn,'複製失敗',1400);
        alert('複製失敗，請手動複製：\n'+cmd);
      }
    };
  }
}


function getLineBindState_(user){
  const safeUser=user||getUser()||{};
  const hasLineId=!!String(safeUser.lineUserId||'').trim();
  const notifyOn=String(safeUser.lineNotifyEnabled||'').trim()==='是' || safeUser.lineNotifyEnabled===true;
  return {
    user:safeUser,
    hasLineId:hasLineId,
    notifyOn:notifyOn,
    statusText: !hasLineId ? '尚未綁定' : (notifyOn ? '已綁定' : '已綁定｜通知關閉'),
    primaryText: !hasLineId ? '前往綁定' : (notifyOn ? '關閉通知' : '開啟通知')
  };
}

async function refreshLineUserForManage_(user){
  let safeUser = user || getUser() || null;
  if(!safeUser) throw new Error('找不到登入資料');
  try{
    const uid = safeUser.id || safeUser.userId || safeUser.employeeId;
    if(uid){
      const refreshed = await api('refreshUserSession',{userId:uid});
      if(refreshed && refreshed.ok && refreshed.user){
        saveUser(refreshed.user);
        return refreshed.user;
      }
    }
  }catch(e){}
  return safeUser;
}

function openLineBindManageModal_(user, refreshFn){
  const state=getLineBindState_(user);
  const safeUser=state.user||{};
  if(!state.hasLineId){
    return openLineBindGuide_(String(safeUser.email||'').trim());
  }

  ensureLineBindGuideModalStyle_();
  const old=document.getElementById('lineBindGuideModalBackdrop');
  if(old) old.remove();

  const wrap=document.createElement('div');
  wrap.id='lineBindGuideModalBackdrop';
  wrap.className='line-bind-modal-backdrop';
  wrap.innerHTML=`
    <div class="line-bind-modal" role="dialog" aria-modal="true" aria-labelledby="lineBindManageModalTitle">
      <div class="line-bind-modal-head">
        <div>
          <div class="line-bind-modal-title" id="lineBindManageModalTitle">LINE設定</div>
          <div class="line-bind-modal-sub">首頁版面維持不變，所有操作都在這個視窗裡完成。</div>
        </div>
        <button type="button" class="line-bind-modal-close" id="closeLineManageModalBtn">關閉</button>
      </div>
      <div class="line-bind-modal-steps">
        <div class="line-bind-modal-step">
          <div class="line-bind-modal-num">1</div>
          <div class="line-bind-modal-text">綁定狀態：${state.hasLineId ? '已綁定' : '尚未綁定'}</div>
        </div>
        <div class="line-bind-modal-step">
          <div class="line-bind-modal-num">2</div>
          <div class="line-bind-modal-text">通知狀態：${state.notifyOn ? '已開啟' : '已關閉'}</div>
        </div>
      </div>
      <div class="line-bind-modal-actions" id="lineBindManageModalActions">
        ${state.notifyOn
          ? '<button class="btn" type="button" id="lineManageToggleBtn">關閉通知</button>'
          : '<button class="btn" type="button" id="lineManageToggleBtn">開啟通知</button>'}
        <button class="btn secondary" type="button" id="lineManageUnbindBtn">解除綁定</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const close=()=>{ const el=document.getElementById('lineBindGuideModalBackdrop'); if(el) el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey=(ev)=>{ if(ev.key==='Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click',(ev)=>{ if(ev.target===wrap) close(); });
  const closeBtn=wrap.querySelector('#closeLineManageModalBtn');
  if(closeBtn) closeBtn.onclick=close;

  const refresh=async()=>{
    if(typeof refreshFn==='function') await refreshFn();
  };

  const toggleBtn=wrap.querySelector('#lineManageToggleBtn');
  if(toggleBtn){
    toggleBtn.onclick=async()=>{
      const wantEnable=!state.notifyOn;
      const progress=startActionButtonProgress(toggleBtn,{label:'處理中',startPct:10,maxPct:84,interval:140});
      try{
        await setLineNotifyPreference_(wantEnable,false);
        progress.done(wantEnable ? '已開啟' : '已關閉',700);
        close();
        await refresh();
      }catch(e){
        progress.fail(e && e.message ? e.message : '儲存失敗',1400);
      }
    };
  }

  const unbindBtn=wrap.querySelector('#lineManageUnbindBtn');
  if(unbindBtn){
    unbindBtn.onclick=async()=>{
      if(!window.confirm('確定要解除 LINE 綁定嗎？解除後仍可再重新綁定。')) return;
      const progress=startActionButtonProgress(unbindBtn,{label:'解除中',startPct:10,maxPct:84,interval:140});
      try{
        await setLineNotifyPreference_(false,true);
        progress.done('已解除',700);
        close();
        await refresh();
      }catch(e){
        progress.fail(e && e.message ? e.message : '解除失敗',1400);
      }
    };
  }
}

async function handleLineCardPrimaryAction_(user, refreshFn){
  let safeUser=user || getUser() || null;
  if(!safeUser) throw new Error('找不到登入資料');
  safeUser = await refreshLineUserForManage_(safeUser);
  await openLineBindManageModal_(safeUser, refreshFn);
}


async function setLineNotifyPreference_(enabled, clearBinding){
  const user=getUser();
  if(!user || !user.id) throw new Error('找不到登入資料，請重新登入');
  const res=await api('setLineNotifyPreference',{
    userId:user.id,
    enabled:enabled ? '是' : '否',
    clearBinding:clearBinding ? '是' : '否'
  });
  if(!res.ok) throw new Error(res.message || '儲存 LINE 設定失敗');
  if(res.user) saveUser(res.user);
  return res;
}

async function renderLineBindPrompt_(targetSelector){
  const user=getUser();
  if(!user) return;
  const path=(location.pathname.split('/').pop()||'').toLowerCase();
  if(path && !['dashboard.html','teacher-home.html','settings.html'].includes(path)) return;

  const existing=document.getElementById('lineBindPromptCard');
  if(existing) existing.remove();

  const target=(typeof targetSelector==='string' && document.querySelector(targetSelector))
    || document.getElementById('lineBindArea')
    || document.querySelector('.page')
    || document.querySelector('.container');
  if(!target) return;

  ensureLineBindPromptStyle_();

  const wrap=document.createElement('div');
  wrap.className='top-tool-card';
  wrap.id='lineBindPromptCard';
  wrap.innerHTML=`
    <div class="top-tool-main">
      <div class="top-tool-title">LINE設定</div>
      <div class="top-tool-desc">查看與修改</div>
    </div>
    <div class="top-tool-actions">
      <button class="top-tool-btn" type="button" id="showLineBindGuideBtn">查看</button>
    </div>
  `;
  target.appendChild(wrap);

  const guideBtn=wrap.querySelector('#showLineBindGuideBtn');
  if(guideBtn){
    guideBtn.onclick=async()=>{
      let progress=null;
      try{
        progress = typeof startActionButtonProgress==='function'
          ? startActionButtonProgress(guideBtn,{label:'讀取中',startPct:15,maxPct:82,interval:160})
          : null;
        await handleLineCardPrimaryAction_(user, ()=>renderLineBindPrompt_(targetSelector));
        if(progress && progress.done) progress.done('查看',300);
      }catch(err){
        if(progress && progress.fail) progress.fail('失敗',900);
        alert(err&&err.message?err.message:'LINE 設定開啟失敗');
      }finally{
        if(!progress && guideBtn) guideBtn.disabled=false;
      }
    };
  }
}



function ensureActionButton(btn){
  if(!btn) return null;
  if(btn.dataset.progressReady==='1') return {fill:btn.querySelector('.btn-progress-fill'),label:btn.querySelector('.btn-progress-label')};
  const idleText=(btn.dataset.idleText||btn.textContent||'').trim()||'送出';
  btn.dataset.idleText=idleText;
  btn.classList.add('btn-progress');
  btn.textContent='';
  const fill=document.createElement('span');
  fill.className='btn-progress-fill';
  const label=document.createElement('span');
  label.className='btn-progress-label';
  label.textContent=idleText;
  btn.appendChild(fill);
  btn.appendChild(label);
  btn.dataset.progressReady='1';
  return {fill,label};
}
function setActionButtonIdle(btn, text){
  if(!btn) return;
  const nodes=ensureActionButton(btn);
  const idle=(text||btn.dataset.idleText||nodes.label.textContent||'').trim()||'送出';
  if(text) btn.dataset.idleText=idle;
  btn.disabled=false;
  btn.classList.remove('is-loading','is-success','is-error');
  nodes.fill.style.width='0%';
  nodes.label.textContent=idle;
  const existing=getBtnProgressMap_().get(btn);
  if(existing&&existing.timer) clearInterval(existing.timer);
  getBtnProgressMap_().delete(btn);
}
function startActionButtonProgress(btn, options={}){
  const nodes=ensureActionButton(btn);
  const existing=getBtnProgressMap_().get(btn);
  if(existing&&existing.timer) clearInterval(existing.timer);
  const rawSequence=Array.isArray(options.sequence)&&options.sequence.length
    ? options.sequence
    : (options.fixedSteps===false ? null : [20,40,60,80]);
  const sequence=(rawSequence||[])
    .map(v=>Math.max(0,Math.min(95,Number(v)||0)))
    .filter((v,i,arr)=>i===0||v>arr[i-1]);
  const startPct=Math.max(0,Math.min(100,Number(options.startPct!=null?options.startPct:(sequence[0]||8))||0));
  const state={
    pct:startPct,
    maxPct:Math.max(0,Math.min(95,Number(options.maxPct!=null?options.maxPct:(sequence.length?sequence[sequence.length-1]:88))||88)),
    label:String(options.label||options.text||'處理中').trim()||'處理中',
    formatter:typeof options.formatter==='function'?options.formatter:null,
    sequence:sequence,
    stepIndex:0
  };
  while(state.stepIndex<state.sequence.length && state.sequence[state.stepIndex] <= state.pct){ state.stepIndex++; }
  const render=()=>{
    nodes.fill.style.width=`${Math.max(0,Math.min(100,state.pct))}%`;
    nodes.label.textContent=state.formatter ? state.formatter(Math.round(state.pct), state.label) : `${state.label} ${Math.round(state.pct)}%`;
  };
  btn.disabled=true;
  btn.classList.add('is-loading');
  btn.classList.remove('is-success','is-error');
  render();
  let timer=null;
  if(options.auto!==false){
    timer=setInterval(()=>{
      if(state.sequence.length){
        if(state.stepIndex>=state.sequence.length) return;
        state.pct=Math.min(state.maxPct, state.sequence[state.stepIndex]);
        state.stepIndex+=1;
        render();
        return;
      }
      if(state.pct>=state.maxPct) return;
      const remain=Math.max(0, state.maxPct-state.pct);
      const step=Math.max(state.pct<25 ? 4 : (state.pct<55 ? 3 : 1), Math.ceil(remain*(state.pct<60 ? 0.16 : 0.08)));
      state.pct=Math.min(state.maxPct, state.pct+step);
      render();
    }, Number(options.interval||220));
  }
  getBtnProgressMap_().set(btn,{timer,state,nodes,render});
  return {
    button:btn,
    set(percent,label){
      if(label!=null) state.label=String(label||state.label);
      state.pct=Math.max(0,Math.min(100,Number(percent)||0));
      render();
    },
    done(text='已完成', holdMs=900, keepDisabled=false){
      const current=getBtnProgressMap_().get(btn); if(current&&current.timer) clearInterval(current.timer);
      state.pct=100;
      btn.classList.remove('is-loading','is-error');
      btn.classList.add('is-success');
      nodes.fill.style.width='100%';
      nodes.label.textContent=`✓ ${text}`;
      btn.disabled=!!keepDisabled;
      if(!keepDisabled){
        setTimeout(()=>setActionButtonIdle(btn), holdMs);
      }
    },
    fail(text='送出失敗', holdMs=1300){
      const current=getBtnProgressMap_().get(btn); if(current&&current.timer) clearInterval(current.timer);
      state.pct=100;
      btn.classList.remove('is-loading','is-success');
      btn.classList.add('is-error');
      nodes.fill.style.width='100%';
      nodes.label.textContent=text;
      btn.disabled=false;
      setTimeout(()=>setActionButtonIdle(btn), holdMs);
    },
    reset(text){ setActionButtonIdle(btn, text); }
  };
}
function finishActionButtonSuccess(btn, text='已完成', holdMs=900, keepDisabled=false){
  const ctl=startActionButtonProgress(btn,{auto:false,label:text,startPct:100,maxPct:100});
  ctl.done(text, holdMs, keepDisabled);
  return ctl;
}
function finishActionButtonError(btn, text='送出失敗', holdMs=1300){
  const ctl=startActionButtonProgress(btn,{auto:false,label:text,startPct:100,maxPct:100});
  ctl.fail(text, holdMs);
  return ctl;
}


async function getTeacherContractStatus(payload={}){
  return await api('getTeacherContractStatus', payload);
}
function shouldShowTeacherContractCard(res){
  return !!(res && res.ok && !res.signed);
}

function fillHeader(){const user=requireLogin(); if(!user) return; const manager=isManager(user); const homeTitleEl=qs('#homeTitle'); if(homeTitleEl){ homeTitleEl.textContent=isPartTimeUser(user)?'工讀首頁':'員工首頁'; } if(document.title==='員工首頁' || document.title==='工讀首頁'){ document.title=isPartTimeUser(user)?'工讀首頁':'員工首頁'; } qsa('[data-user-name]').forEach(el=>el.textContent=user.name||'員工'); qsa('[data-if-parttime]').forEach(el=>el.style.display=isPartTimeUser(user)?'':'none'); qsa('[data-if-admin]').forEach(el=>el.style.display=manager?'':'none'); qsa('[data-if-staff-view]').forEach(el=>el.style.display=manager?'none':'');}
function redirectAfterLogin(user){saveUser(user); if(hasSettingsZoneAccess(user)){setPortalMode('settings'); location.href='settings.html'; return;} if(isExternalTeacher(user)){ location.href='teacher-home.html'; return; } setPortalMode('staff'); location.href='dashboard.html';}
function saveLoginPref(email,password,remember=true){if(!remember){localStorage.removeItem('employeeSavedLogin');return;}localStorage.setItem('employeeSavedLogin',JSON.stringify({email:email||'',password:password||'',remember:true}));}
function getSavedLogin(){try{return JSON.parse(localStorage.getItem('employeeSavedLogin')||'null')}catch(e){return null}}
function applySavedLogin(emailSel='#email',passwordSel='#password',rememberSel='#rememberLogin'){const s=getSavedLogin();if(!s)return;const e=qs(emailSel),p=qs(passwordSel),r=qs(rememberSel);if(e)e.value=s.email||'';if(p)p.value=s.password||'';if(r)r.checked=!!s.remember;}
function getDriveFileId(url){
  const s=String(url||'').trim();
  const m=s.match(/(?:file\/d\/|[?&]id=|\/d\/)([-_a-zA-Z0-9]{20,})/);
  return m?m[1]:'';
}
function imagePreviewUrl(url){ if(isCloudinaryUrl(url)) return optimizedImageUrl(url); const id=getDriveFileId(url);return id?('https://drive.google.com/thumbnail?id='+id+'&sz=w1200'):url;}
function driveViewUrl(url){ if(isCloudinaryUrl(url)) return optimizedVideoUrl(url); const id=getDriveFileId(url);return id?('https://drive.google.com/file/d/'+id+'/view?usp=drivesdk'):String(url||'');}
function drivePreviewUrl(url){ if(isCloudinaryUrl(url)) return optimizedVideoUrl(url); const id=getDriveFileId(url);return id?('https://drive.google.com/file/d/'+id+'/preview'):String(url||'');}
function audioOpenUrl(url){return isCloudinaryUrl(url) ? optimizedVideoUrl(url) : driveViewUrl(url);}
function audioStreamUrl(url){ if(isCloudinaryUrl(url)) return optimizedVideoUrl(url); const id=getDriveFileId(url);return id?('https://drive.google.com/uc?export=download&id='+id):String(url||'');}
function openMediaInTopWindow(url){
  const finalUrl=isCloudinaryUrl(url) ? optimizedVideoUrl(url) : driveViewUrl(url);
  if(!finalUrl) return;
  try{
    if(window.top && window.top!==window){
      window.top.location.href=finalUrl;
      return;
    }
  }catch(e){}
  location.href=finalUrl;
}
async function compressImageToDataUrl(file, maxSize=1280, quality=0.78){
  if(!file) return '';
  if(!file.type.startsWith('image/')) return await fileToDataUrl(file);
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        let {width,height}=img;
        if(width>height && width>maxSize){height=Math.round(height*maxSize/width); width=maxSize;}
        else if(height>=width && height>maxSize){width=Math.round(width*maxSize/height); height=maxSize;}
        const canvas=document.createElement('canvas');
        canvas.width=width; canvas.height=height;
        const ctx=canvas.getContext('2d');
        ctx.drawImage(img,0,0,width,height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror=reject;
      img.src=String(fr.result||'');
    };
    fr.onerror=reject;
    fr.readAsDataURL(file);
  });
}

async function compressImagesToDataUrls(files, maxSize=1600, quality=0.75){
  const list=Array.from(files||[]).filter(Boolean);
  if(!list.length) return [];
  const out=[];
  for(const file of list){
    out.push(await compressImageToDataUrl(file, maxSize, quality));
  }
  return out.filter(Boolean);
}


async function compressVideoToDataUrl(file, opts={}){
  const options=Object.assign({
    maxInputMB: 45,
    allowedTypes: ['video/mp4','video/quicktime','video/webm']
  }, opts||{});
  if(!file) return '';
  if(!String(file.type||'').startsWith('video/')) return await fileToDataUrl(file);
  const sizeMB=file.size/1024/1024;
  if(sizeMB>options.maxInputMB){
    throw new Error('影片檔太大，請先在手機修剪到較短版本或降低畫質後再上傳');
  }
  const mime=String(file.type||'').toLowerCase();
  if(options.allowedTypes.length && !options.allowedTypes.includes(mime)){
    throw new Error('目前影片格式不建議直接上傳，請先用手機存成 MP4 後再試');
  }
  return await fileToDataUrl(file);
}
function formatTaskStatusTag(status){
  const cls=status==='待處理'?'pending':(status==='已完成'?'done':'');
  return `<span class="tag ${cls}">${status}</span>`;
}
async function startRecorder(onDone, onLevel){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){throw new Error('目前裝置不支援錄音');}
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});
  const mimeCandidates=['audio/mp4','audio/m4a','audio/wav','audio/webm;codecs=opus','audio/webm'];
  const mimeType=mimeCandidates.find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(t))||'';
  const rec=new MediaRecorder(stream, mimeType?{mimeType}:undefined);
  const chunks=[];
  let audioCtx=null, analyser=null, source=null, rafId=0, dataArray=null;
  if(onLevel && (window.AudioContext || window.webkitAudioContext)) {
    const Ctx=window.AudioContext || window.webkitAudioContext;
    audioCtx=new Ctx();
    analyser=audioCtx.createAnalyser();
    analyser.fftSize=256;
    source=audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    dataArray=new Uint8Array(analyser.frequencyBinCount);
    const tick=()=>{
      analyser.getByteFrequencyData(dataArray);
      let sum=0;
      for(let i=0;i<dataArray.length;i++) sum+=dataArray[i];
      const avg=sum/dataArray.length/255;
      onLevel(avg);
      rafId=requestAnimationFrame(tick);
    };
    tick();
  }
  rec.ondataavailable=e=>{if(e.data && e.data.size) chunks.push(e.data);};
  rec.onstop=async()=>{
    if(rafId) cancelAnimationFrame(rafId);
    try{ source && source.disconnect(); }catch(e){}
    try{ analyser && analyser.disconnect(); }catch(e){}
    try{ audioCtx && audioCtx.close && audioCtx.close(); }catch(e){}
    stream.getTracks().forEach(t=>t.stop());
    const blob=new Blob(chunks,{type:rec.mimeType || mimeType || 'audio/webm'});
    const reader=new FileReader();
    reader.onload=()=>onDone(String(reader.result||''));
    reader.readAsDataURL(blob);
  };
  rec.start(250);
  return rec;
}


function isStrongPassword(v){
  const s=String(v||'');
  return s.length>=8 && /[A-Za-z]/.test(s) && /\d/.test(s);
}
function normalizeBirthDate(v){
  const s=String(v||'').trim();
  if(!s) return '';
  const m=s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if(!m) return s;
  const y=m[1];
  const mo=m[2].padStart(2,'0');
  const d=m[3].padStart(2,'0');
  return `${y}-${mo}-${d}`;
}


async function ensureGoogleIdentityLoaded(){
  if(window.google && window.google.accounts && window.google.accounts.oauth2) return;
  await new Promise((resolve,reject)=>{
    const existing=[...document.scripts].find(s=>String(s.src||'').includes('accounts.google.com/gsi/client'));
    if(existing){
      existing.addEventListener('load',()=>resolve(),{once:true});
      existing.addEventListener('error',()=>reject(new Error('Google 身分驗證載入失敗')), {once:true});
      if(window.google && window.google.accounts && window.google.accounts.oauth2) resolve();
      return;
    }
    const s=document.createElement('script');
    s.src='https://accounts.google.com/gsi/client';
    s.async=true; s.defer=true;
    s.onload=()=>resolve();
    s.onerror=()=>reject(new Error('Google 身分驗證載入失敗'));
    document.head.appendChild(s);
  });
}
let __googleTokenClient=null;
function getGoogleClientId(){
  return String((window.APP_CONFIG && window.APP_CONFIG.GOOGLE_CLIENT_ID) || '').trim();
}
async function getGoogleAccessTokenInteractive(scope='https://www.googleapis.com/auth/drive.file'){
  const clientId=getGoogleClientId();
  if(!clientId){
    throw new Error('尚未設定 GOOGLE_CLIENT_ID，請先依說明建立 Google OAuth Web Client 並填入 config.js');
  }
  await ensureGoogleIdentityLoaded();
  return await new Promise((resolve,reject)=>{
    try{
      __googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope,
        callback: (resp)=>{
          if(resp && resp.access_token) resolve(resp.access_token);
          else reject(new Error((resp&&resp.error)||'Google 授權失敗'));
        }
      });
      __googleTokenClient.requestAccessToken({prompt:'consent'});
    }catch(e){ reject(e); }
  });
}
async function driveCreateResumableSession(file, folderId, accessToken){
  const metadata={ name:file.name, mimeType:file.type || 'application/octet-stream' };
  if(folderId) metadata.parents=[folderId];
  const res=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink', {
    method:'POST',
    headers:{
      'Authorization':'Bearer '+accessToken,
      'Content-Type':'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(file.size || 0)
    },
    body: JSON.stringify(metadata)
  });
  if(!res.ok){ throw new Error('建立 Google Drive 上傳工作失敗'); }
  const uploadUrl=res.headers.get('Location');
  if(!uploadUrl) throw new Error('Google Drive 沒有回傳上傳位置');
  return uploadUrl;
}
async function driveUploadFileResumable(file, folderId, accessToken, onProgress){
  const uploadUrl=await driveCreateResumableSession(file, folderId, accessToken);
  const chunkSize=8 * 1024 * 1024;
  let offset=0;
  while(offset < file.size){
    const end=Math.min(offset + chunkSize, file.size);
    const chunk=file.slice(offset, end);
    const res=await fetch(uploadUrl,{
      method:'PUT',
      headers:{
        'Content-Length': String(end-offset),
        'Content-Type': file.type || 'application/octet-stream',
        'Content-Range': `bytes ${offset}-${end-1}/${file.size}`
      },
      body: chunk
    });
    if(!(res.ok || res.status===308)){
      let msg='影片直傳 Google Drive 失敗';
      try{ const t=await res.text(); if(t) msg += '：'+t; }catch(e){}
      throw new Error(msg);
    }
    offset=end;
    if(onProgress) onProgress(Math.min(100, Math.round(offset / file.size * 100)));
    if(res.ok){
      const data=await res.json();
      return data;
    }
  }
  throw new Error('影片直傳未完成');
}


async function renderCompactLineCard_(targetSelector, user){
  if(user){
    try{
      const current=getUser()||{};
      saveUser(Object.assign({}, current, user));
    }catch(e){}
  }
  return renderLineBindPrompt_(targetSelector);
}

/************************************************************
 * 歷史紀錄查詢共用規則
 ************************************************************/
function isHistoryManagerMode_(){
  try{const u=getUser&&getUser();return !!(u&&(u.showSettingsZone||String(u.role||'').toLowerCase()==='admin'));}catch(e){return false;}
}
function addDaysForHistory_(dateStr,days){const d=new Date(String(dateStr||'')+'T00:00:00');if(isNaN(d.getTime()))return '';d.setDate(d.getDate()+Number(days||0));return d.toISOString().slice(0,10);}
function enforceHistoryDateRange_(startInput,endInput){const startEl=typeof startInput==='string'?document.querySelector(startInput):startInput;const endEl=typeof endInput==='string'?document.querySelector(endInput):endInput;if(!startEl||!endEl)return;startEl.addEventListener('change',function(){if(!startEl.value)return;if(isHistoryManagerMode_()){if(!endEl.value)endEl.value=addDaysForHistory_(startEl.value,70);return;}endEl.value=addDaysForHistory_(startEl.value,70);});endEl.addEventListener('change',function(){if(isHistoryManagerMode_())return;if(!startEl.value||!endEl.value)return;const s=new Date(startEl.value+'T00:00:00');const e=new Date(endEl.value+'T00:00:00');if(isNaN(s.getTime())||isNaN(e.getTime()))return;const diff=Math.floor((e-s)/86400000);if(diff>70){endEl.value=addDaysForHistory_(startEl.value,70);alert('歷史紀錄一次最多查詢 70 天。');}});}
function buildHistoryQueryPayload_(extra,startSelector,endSelector){const startEl=typeof startSelector==='string'?document.querySelector(startSelector):startSelector;const endEl=typeof endSelector==='string'?document.querySelector(endSelector):endSelector;const payload=Object.assign({},extra||{});if(startEl&&startEl.value)payload.startDate=startEl.value;if(endEl&&endEl.value)payload.endDate=endEl.value;payload.historyMode='是';payload.isManagerHistory=isHistoryManagerMode_()?'是':'否';return payload;}
function isHistoryStatus_(status,type){const s=String(status||'').trim();if(!s)return false;return ['已讀','已完成','完成','已確認','已結案','結案','已核准','核准','已駁回','駁回','已取消','取消','已簽署','簽署完成','已回覆','已處理','停用','已停用'].some(w=>s.indexOf(w)>=0);}


/************************************************************
 * 歷史紀錄共用 UI：日期限制 + 卡片淡色輪替
 ************************************************************/
function isHistoryManagerMode_(){
  try{const u=getUser&&getUser();return !!(u&&(u.showSettingsZone||String(u.role||'').toLowerCase()==='admin'));}catch(e){return false;}
}
function addDaysForHistory_(dateStr,days){const d=new Date(String(dateStr||'')+'T00:00:00');if(isNaN(d.getTime()))return '';d.setDate(d.getDate()+Number(days||0));return d.toISOString().slice(0,10);}
function enforceHistoryDateRange_(startInput,endInput){const startEl=typeof startInput==='string'?document.querySelector(startInput):startInput;const endEl=typeof endInput==='string'?document.querySelector(endInput):endInput;if(!startEl||!endEl)return;startEl.addEventListener('change',function(){if(!startEl.value)return;if(isHistoryManagerMode_()){if(!endEl.value)endEl.value=addDaysForHistory_(startEl.value,70);return;}endEl.value=addDaysForHistory_(startEl.value,70);});endEl.addEventListener('change',function(){if(isHistoryManagerMode_())return;if(!startEl.value||!endEl.value)return;const s=new Date(startEl.value+'T00:00:00');const e=new Date(endEl.value+'T00:00:00');if(isNaN(s.getTime())||isNaN(e.getTime()))return;const diff=Math.floor((e-s)/86400000);if(diff>70){endEl.value=addDaysForHistory_(startEl.value,70);alert('歷史紀錄一次最多查詢 70 天。');}});}
function buildHistoryQueryPayload_(extra,startSelector,endSelector){const startEl=typeof startSelector==='string'?document.querySelector(startSelector):startSelector;const endEl=typeof endSelector==='string'?document.querySelector(endSelector):endSelector;const payload=Object.assign({},extra||{});if(startEl&&startEl.value)payload.startDate=startEl.value;if(endEl&&endEl.value)payload.endDate=endEl.value;payload.historyMode='是';payload.isManagerHistory=isHistoryManagerMode_()?'是':'否';return payload;}
function isHistoryStatus_(status,type){const s=String(status||'').trim();if(!s)return false;return ['已讀','已完成','完成','已確認','已結案','結案','已核准','核准','已駁回','駁回','已取消','取消','已簽署','簽署完成','已回覆','已處理','停用','已停用'].some(w=>s.indexOf(w)>=0);}
function ensureHistoryCardStyle_(){
  if(document.getElementById('historyCardToneStyle'))return;
  const st=document.createElement('style');
  st.id='historyCardToneStyle';
  st.textContent=`
    .history-search{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;margin:12px 0}
    .history-search label{font-weight:900;font-size:13px}
    .history-search input{width:100%;border:1px solid #cbd5e1;border-radius:12px;padding:10px 12px;background:#fff}
    .history-color-list{display:grid;gap:12px}
    .history-tone-0{background:#f0fdf4!important;border-color:#bbf7d0!important}
    .history-tone-1{background:#fffbeb!important;border-color:#fde68a!important}
    .history-tone-2{background:#eff6ff!important;border-color:#bfdbfe!important}
    .history-tone-3{background:#fff1f2!important;border-color:#fecdd3!important}
    .history-tone-4{background:#f8fafc!important;border-color:#cbd5e1!important}
    @media(max-width:640px){.history-search{grid-template-columns:1fr}}
  `;
  document.head.appendChild(st);
}
function colorHistoryCards_(rootSelector){
  ensureHistoryCardStyle_();
  const root=typeof rootSelector==='string'?document.querySelector(rootSelector):rootSelector;
  if(!root)return;
  root.classList.add('history-color-list');
  const children=Array.from(root.children||[]).filter(el=>!el.classList.contains('empty'));
  children.forEach((el,i)=>{
    el.classList.remove('history-tone-0','history-tone-1','history-tone-2','history-tone-3','history-tone-4');
    el.classList.add('history-tone-'+(i%5));
    if(!el.style.borderRadius) el.style.borderRadius='18px';
  });
}
function activateHistoryColoring_(rootSelector){
  ensureHistoryCardStyle_();
  const root=typeof rootSelector==='string'?document.querySelector(rootSelector):rootSelector;
  if(!root)return;
  colorHistoryCards_(root);
  try{
    const obs=new MutationObserver(()=>colorHistoryCards_(root));
    obs.observe(root,{childList:true,subtree:false});
  }catch(e){}
}


function hideClockZeroBadge_(){
  try{
    var el=document.getElementById('clockCount');
    if(!el) return;
    var n=Number(el.textContent||0)||0;
    el.style.display = n>0 ? '' : 'none';
  }catch(e){}
}
document.addEventListener('DOMContentLoaded', function(){ setTimeout(hideClockZeroBadge_, 300); setTimeout(hideClockZeroBadge_, 1200); });

/************************************************************
 * 管理端通知工具：功能提醒設定 + 浮動 LINE / Email 手動通知
 * - 前端只負責寫入 Firebase 佇列與設定；實際 LINE / Email 由後端 / Cloud Function 處理。
 ************************************************************/
(function(){
  if(window.__notifyToolsV20260529) return;
  window.__notifyToolsV20260529 = true;

  function escNotify_(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function cleanNotify_(v){return String(v==null?'':v).trim();}
  function hasNotifyApi_(){ return !!(window.YZFirebase && typeof window.YZFirebase.handleApi === 'function'); }
  function isAdminPage_(){
    try{
      const user = typeof getUser === 'function' ? getUser() : null;
      if(!user || !(user.showSettingsZone || String(user.role||'').toLowerCase()==='admin')) return false;
      const p = String((location && location.pathname) || '').split('/').pop().toLowerCase();
      if(p === 'dashboard.html' || p === 'index.html' || p === 'portal.html') return false;
      return /settings|admin|approval|hub|policy|payroll|registration|corrections|temporary|salary|schedule|items|application|teacher|data-center/.test(p);
    }catch(e){return false;}
  }
  function currentFeatureNotify_(){
    const p = String((location && location.pathname) || '').split('/').pop().toLowerCase();
    if(p === 'clock-corrections-admin.html') return {code:'clock', name:'打卡簽核提醒', submitted:'員工送出特殊打卡 / 補打卡 / 修正時通知主管', result:'主管核准 / 駁回後通知員工'};
    if(p === 'temporary-attendance-admin.html') return {code:'temporaryAttendance', name:'臨時出勤 / 工讀超時提醒', submitted:'員工送出臨時出勤或超出排班時數時通知主管', result:'主管核准 / 駁回後通知員工'};
    if(p === 'leave.html' && String(location.search||'').indexOf('mode=approval') >= 0) return {code:'leave', name:'請假簽核提醒', submitted:'員工送出請假 / 事後補假時通知主管', result:'主管核准 / 駁回後通知員工'};
    if(p === 'profile-change-admin.html') return {code:'profileChange', name:'個資修改提醒', submitted:'員工送出個資修改時通知主管', result:'主管核准 / 駁回後通知員工'};
    if(p === 'registration-approval.html') return {code:'registration', name:'註冊簽核提醒', submitted:'新帳號送出註冊時通知主管', result:'主管核准 / 駁回後通知員工'};
    if(p === 'parttime-payroll-admin.html') return {code:'parttimePayroll', name:'工讀薪資提醒', submitted:'工讀生時數異常或超時申請時通知主管', result:'主管處理後通知員工'};
    return null;
  }
  function notifyStyle_(){
    if(document.getElementById('notifyToolStyleV20260529')) return;
    const s = document.createElement('style');
    s.id = 'notifyToolStyleV20260529';
    s.textContent = `
      .notify-floating-btn{position:fixed;right:18px;bottom:18px;z-index:9998;border:none;border-radius:999px;background:#06c755;color:#fff;font-weight:900;box-shadow:0 12px 32px rgba(15,23,42,.24);padding:13px 16px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:15px}
      .notify-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
      .notify-modal{width:min(100%,620px);max-height:88vh;overflow:auto;background:#fff;border:1px solid #dbe5f1;border-radius:24px;padding:18px;box-shadow:0 24px 70px rgba(15,23,42,.28)}
      .notify-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px}.notify-modal-title{font-size:22px;font-weight:900;color:#18314a}.notify-close{border:none;background:#eef2f6;color:#18314a;border-radius:999px;padding:8px 12px;font-weight:900;cursor:pointer}
      .notify-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.notify-field{display:grid;gap:6px;margin-bottom:10px}.notify-field label{font-size:13px;font-weight:900;color:#18314a}.notify-field input,.notify-field textarea,.notify-field select{border:1px solid #cbd5e1;border-radius:14px;padding:11px 12px;font-size:15px}.notify-field textarea{min-height:110px;resize:vertical}.notify-rec-list{max-height:210px;overflow:auto;border:1px solid #dbe5f1;border-radius:16px;padding:8px;background:#f8fafc;display:grid;gap:6px}.notify-rec{display:flex;gap:8px;align-items:center;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:8px 10px;font-weight:800}.notify-rec small{color:#64748b;font-weight:700}.notify-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:12px}.notify-actions .btn,.notify-actions .btn.secondary{width:auto}.notify-status{margin-top:10px;padding:10px 12px;border-radius:14px;background:#ecfdf3;color:#166534;border:1px solid #bbf7d0;font-weight:900}.notify-status.err{background:#fff1f2;color:#991b1b;border-color:#fecaca}
      .notify-setting-card{margin-top:16px;background:#fff;border:1px solid #dbe5f1;border-radius:20px;padding:16px;box-shadow:0 8px 24px rgba(15,23,42,.04)}.notify-setting-card h3{margin:0 0 8px;font-size:20px;color:#18314a}.notify-setting-card .muted{color:#64748b;line-height:1.7}.notify-check-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.notify-check{display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:10px;font-weight:800}.notify-check input{width:18px;height:18px}
      @media(max-width:640px){.notify-floating-btn{right:14px;bottom:14px;padding:12px 14px}.notify-grid,.notify-check-grid{grid-template-columns:1fr}.notify-actions .btn,.notify-actions .btn.secondary{width:100%}}
    `;
    document.head.appendChild(s);
  }
  async function loadRecipients_(){
    const res = await api('getEmployeeRecipients',{});
    return (res && (res.rows || res.list)) || [];
  }
  function openManualNotifyModal_(){
    notifyStyle_();
    const old = document.getElementById('notifyManualModalBackdrop');
    if(old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'notifyManualModalBackdrop';
    wrap.className = 'notify-modal-backdrop';
    wrap.innerHTML = `
      <div class="notify-modal" role="dialog" aria-modal="true">
        <div class="notify-modal-head"><div><div class="notify-modal-title">LINE / Email 手動通知</div><div class="muted">選擇收件人並輸入訊息。送出後會由後端直接推送 LINE / Email，並留下發送紀錄。</div></div><button class="notify-close" type="button" id="notifyCloseBtn">關閉</button></div>
        <div class="notify-grid">
          <div class="notify-field"><label>快速篩選</label><select id="notifyRecipientFilter"><option value="">全部</option><option value="staff">專職員工</option><option value="parttime">工讀生</option><option value="admin">主管 / 管理員</option><option value="line">已綁定 LINE</option><option value="email">有 Email</option></select></div>
          <div class="notify-field"><label>發送方式</label><div class="notify-check-grid" style="margin-top:0"><label class="notify-check"><input type="checkbox" id="notifyByLine" checked>LINE</label><label class="notify-check"><input type="checkbox" id="notifyByEmail">Email</label></div></div>
        </div>
        <div class="notify-field"><label>收件人</label><div class="notify-rec-list" id="notifyRecipientList"><div class="muted">讀取中...</div></div></div>
        <div class="notify-field"><label>訊息內容</label><textarea id="notifyMessageText" placeholder="請輸入要傳送的文字"></textarea></div>
        <div class="notify-actions"><button class="btn secondary" type="button" id="notifySelectAllBtn">全選目前名單</button><button class="btn" type="button" id="notifySendBtn">送出通知</button></div>
        <div id="notifyModalStatus"></div>
      </div>`;
    document.body.appendChild(wrap);
    const close = function(){ const el=document.getElementById('notifyManualModalBackdrop'); if(el) el.remove(); };
    wrap.querySelector('#notifyCloseBtn').onclick = close;
    wrap.addEventListener('click', function(e){ if(e.target === wrap) close(); });
    let recipients = [];
    const status = wrap.querySelector('#notifyModalStatus');
    const list = wrap.querySelector('#notifyRecipientList');
    function showStatus(t,err){status.innerHTML=t?`<div class="notify-status ${err?'err':''}">${escNotify_(t)}</div>`:'';}
    function renderList(){
      const f = cleanNotify_(wrap.querySelector('#notifyRecipientFilter').value);
      const rows = recipients.filter(function(r){
        if(!f) return true;
        if(f === 'line') return !!cleanNotify_(r.lineUserId);
        if(f === 'email') return !!cleanNotify_(r.email);
        if(f === 'admin') return !!r.isManager;
        return cleanNotify_(r.identityType) === f;
      });
      list.innerHTML = rows.length ? rows.map(function(r){
        return `<label class="notify-rec"><input type="checkbox" class="notifyRecipientChk" value="${escNotify_(r.employeeId)}"><span>${escNotify_(r.name||r.employeeId)}<br><small>${escNotify_(r.identityLabel||'')}｜${escNotify_(r.email||'無 Email')}${r.lineUserId?'｜LINE 已綁定':'｜LINE 未綁定'}</small></span></label>`;
      }).join('') : '<div class="muted">沒有符合條件的收件人</div>';
    }
    wrap.querySelector('#notifyRecipientFilter').onchange = renderList;
    wrap.querySelector('#notifySelectAllBtn').onclick = function(){ wrap.querySelectorAll('.notifyRecipientChk').forEach(function(x){x.checked=true;}); };
    wrap.querySelector('#notifySendBtn').onclick = async function(){
      try{
        showStatus('');
        const ids = Array.from(wrap.querySelectorAll('.notifyRecipientChk:checked')).map(function(x){return x.value;});
        const message = cleanNotify_(wrap.querySelector('#notifyMessageText').value);
        const channels = [];
        if(wrap.querySelector('#notifyByLine').checked) channels.push('line');
        if(wrap.querySelector('#notifyByEmail').checked) channels.push('email');
        if(!ids.length) throw new Error('請選擇收件人。');
        if(!channels.length) throw new Error('請至少選擇 LINE 或 Email。');
        if(!message) throw new Error('請輸入訊息內容。');
        const selected = recipients.filter(function(r){return ids.indexOf(cleanNotify_(r.employeeId)) >= 0;});
        const res = await api('queueManualNotification',{targets:selected, channels:channels, message:message, page:location.pathname});
        showStatus((res && res.message) || '已送出通知。');
      }catch(e){ showStatus(e.message || String(e), true); }
    };
    loadRecipients_().then(function(rows){recipients = rows || []; renderList();}).catch(function(e){list.innerHTML = `<div class="notify-status err">讀取收件人失敗：${escNotify_(e.message||e)}</div>`;});
  }
  function addFloatingNotifyButton_(){
    if(!isAdminPage_() || !hasNotifyApi_()) return;
    notifyStyle_();
    if(document.getElementById('notifyFloatingBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'notifyFloatingBtn';
    btn.type = 'button';
    btn.className = 'notify-floating-btn';
    btn.textContent = 'LINE / Email';
    btn.onclick = openManualNotifyModal_;
    document.body.appendChild(btn);
  }
  async function renderFeatureNotificationSettings_(){
    if(!isAdminPage_() || !hasNotifyApi_()) return;
    const feature = currentFeatureNotify_();
    if(!feature) return;
    notifyStyle_();
    if(document.getElementById('featureNotifySettingCard')) return;
    const container = document.querySelector('.container') || document.body;
    const card = document.createElement('div');
    card.id = 'featureNotifySettingCard';
    card.className = 'notify-setting-card';
    card.innerHTML = `
      <h3>${escNotify_(feature.name)}</h3>
      <div class="muted">${escNotify_(feature.submitted)}；${escNotify_(feature.result)}。</div>
      <div class="notify-check-grid">
        <label class="notify-check"><input type="checkbox" data-notify-field="notifyManagerLine">送主管 LINE</label>
        <label class="notify-check"><input type="checkbox" data-notify-field="notifyManagerEmail">送主管 Email</label>
        <label class="notify-check"><input type="checkbox" data-notify-field="notifyEmployeeLine">處理結果送員工 LINE</label>
        <label class="notify-check"><input type="checkbox" data-notify-field="notifyEmployeeEmail">處理結果送員工 Email</label>
      </div>
      <div class="notify-actions"><button class="btn" type="button" id="saveFeatureNotifyBtn">儲存提醒設定</button></div>
      <div id="featureNotifyMsg"></div>`;
    container.appendChild(card);
    const msg = card.querySelector('#featureNotifyMsg');
    function setMsg(t,err){msg.innerHTML=t?`<div class="notify-status ${err?'err':''}">${escNotify_(t)}</div>`:'';}
    try{
      const res = await api('getFeatureNotificationSetting',{featureCode:feature.code});
      const setting = (res && res.setting) || {};
      card.querySelectorAll('[data-notify-field]').forEach(function(el){ el.checked = setting[el.dataset.notifyField] !== false; });
    }catch(e){ card.querySelectorAll('[data-notify-field]').forEach(function(el){ el.checked = true; }); }
    card.querySelector('#saveFeatureNotifyBtn').onclick = async function(){
      try{
        const setting = {featureCode:feature.code, featureName:feature.name};
        card.querySelectorAll('[data-notify-field]').forEach(function(el){ setting[el.dataset.notifyField] = !!el.checked; });
        const res = await api('saveFeatureNotificationSetting', setting);
        setMsg((res && res.message) || '已儲存提醒設定。');
      }catch(e){ setMsg(e.message || String(e), true); }
    };
  }
  document.addEventListener('DOMContentLoaded', function(){
    setTimeout(addFloatingNotifyButton_, 150);
    setTimeout(renderFeatureNotificationSettings_, 350);
  });
})();

/* 2026-05-29 module notification panel + manager quick message */
(function(){
  if(window.__managerNotifyToolsV20260529) return;
  window.__managerNotifyToolsV20260529 = true;
  function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
  function clean(v){return String(v==null?'':v).trim()}
  function ensureStyle(){
    if(document.getElementById('managerNotifyToolStyle')) return;
    const st=document.createElement('style'); st.id='managerNotifyToolStyle'; st.textContent=`
      .module-notify-panel{border:1px solid var(--line,#e5e7eb);border-radius:18px;background:#fff;padding:16px;margin-top:16px;box-shadow:0 10px 24px rgba(16,24,40,.05)}
      .module-notify-title{font-size:20px;font-weight:900;color:#18314a;margin:0 0 6px}.module-notify-desc{font-size:14px;color:#667085;line-height:1.65;margin-bottom:12px}
      .module-notify-row{border:1px solid #e5e7eb;border-radius:14px;background:#f8fafc;padding:12px;margin-top:10px}.module-notify-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.module-notify-name{font-weight:900;color:#111827}.module-notify-help{font-size:13px;color:#667085;line-height:1.55;margin-top:2px}.module-notify-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.module-notify-checks label{display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;padding:8px 10px;font-size:13px;font-weight:800;color:#334155}.module-notify-checks input{width:auto}.module-notify-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}.module-notify-msg{font-size:13px;font-weight:800;color:#1f7a5a}.module-notify-msg.err{color:#b42318}@media(max-width:560px){.module-notify-checks{grid-template-columns:1fr}}
      .manager-quick-msg-btn{position:fixed;right:16px;bottom:18px;z-index:9999;border:0;border-radius:999px;background:#1f7a5a;color:#fff;font-weight:900;padding:13px 16px;box-shadow:0 12px 28px rgba(15,23,42,.22);cursor:pointer}.manager-quick-msg-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:10000;display:none;align-items:center;justify-content:center;padding:14px}.manager-quick-msg-backdrop.show{display:flex}.manager-quick-msg-modal{width:min(94vw,680px);max-height:88vh;overflow:auto;background:#fff;border-radius:22px;padding:18px;box-shadow:0 24px 70px rgba(15,23,42,.28)}.manager-quick-msg-top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}.manager-quick-msg-top h3{margin:0;font-size:22px;color:#18314a}.manager-quick-msg-close{border:0;background:#eef2f6;color:#18314a;border-radius:12px;padding:8px 12px;font-weight:900}.manager-quick-msg-field{margin-top:12px}.manager-quick-msg-field label{display:block;font-weight:900;margin-bottom:6px}.manager-quick-msg-field input,.manager-quick-msg-field textarea{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:14px;padding:11px 12px;font-size:15px}.manager-quick-msg-field textarea{min-height:110px;resize:vertical}.manager-quick-recips{border:1px solid #e5e7eb;border-radius:14px;background:#f8fafc;max-height:220px;overflow:auto;padding:8px}.manager-quick-recips label{display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid #e5e7eb;font-size:14px}.manager-quick-recips label:last-child{border-bottom:0}.manager-quick-recips input{width:auto}.manager-quick-channel{display:flex;gap:12px;flex-wrap:wrap}.manager-quick-channel label{display:inline-flex;align-items:center;gap:6px;font-weight:900}.manager-quick-channel input{width:auto}.manager-quick-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.manager-quick-actions button{border:0;border-radius:14px;padding:12px 14px;font-weight:900}.manager-quick-send{background:#1f7a5a;color:#fff}.manager-quick-cancel{background:#eef2f6;color:#18314a}.manager-quick-status{font-weight:900;margin-top:10px;color:#1f7a5a}.manager-quick-status.err{color:#b42318}@media(max-width:560px){.manager-quick-msg-btn{right:12px;bottom:12px}.manager-quick-actions{grid-template-columns:1fr}}`;
    document.head.appendChild(st);
  }
  window.renderModuleNotificationPanel = async function(containerSelector, moduleKey, title){
    ensureStyle();
    const box = typeof containerSelector === 'string' ? document.querySelector(containerSelector) : containerSelector;
    if(!box) return;
    box.innerHTML = `<div class="module-notify-panel"><div class="module-notify-title">${esc(title||'LINE / Email 提醒設定')}</div><div class="module-notify-desc">此區只設定本功能的提醒。可決定員工送出時是否通知主管，以及主管審核後是否通知員工。</div><div class="module-notify-msg">讀取中…</div></div>`;
    try{
      const res = await api('getModuleNotificationSettings',{moduleKey});
      const rows = Array.isArray(res.rows) ? res.rows : [];
      const html = `<div class="module-notify-panel"><div class="module-notify-title">${esc(title||'LINE / Email 提醒設定')}</div><div class="module-notify-desc">此區只設定本功能的提醒。LINE / Email 會由後端直接推送，並留下發送紀錄。</div><div class="module-notify-list">${rows.map((r,i)=>`<div class="module-notify-row" data-index="${i}" data-event-key="${esc(r.eventKey)}"><div class="module-notify-head"><div><div class="module-notify-name">${esc(r.eventName||r.eventKey)}</div><div class="module-notify-help">${esc(r.description||'')}</div></div><label style="white-space:nowrap;font-weight:900"><input type="checkbox" data-field="enabled" ${r.enabled!==false?'checked':''}> 啟用</label></div><div class="module-notify-checks"><label>通知主管 LINE <input type="checkbox" data-field="managerLineEnabled" ${r.managerLineEnabled?'checked':''}></label><label>通知主管 Email <input type="checkbox" data-field="managerEmailEnabled" ${r.managerEmailEnabled?'checked':''}></label><label>通知員工 LINE <input type="checkbox" data-field="employeeLineEnabled" ${r.employeeLineEnabled?'checked':''}></label><label>通知員工 Email <input type="checkbox" data-field="employeeEmailEnabled" ${r.employeeEmailEnabled?'checked':''}></label></div></div>`).join('')}</div><div class="module-notify-actions"><button class="btn" type="button" data-save-module-notify>儲存提醒設定</button><span class="module-notify-msg" data-module-notify-msg></span></div></div>`;
      box.innerHTML = html;
      const originalRows = rows;
      const saveBtn = box.querySelector('[data-save-module-notify]');
      if(saveBtn){
        saveBtn.onclick = async()=>{
          const msg = box.querySelector('[data-module-notify-msg]');
          try{
            if(msg){msg.textContent='儲存中…'; msg.classList.remove('err');}
            const nextRows = Array.from(box.querySelectorAll('.module-notify-row')).map((row,idx)=>{
              const base = Object.assign({}, originalRows[idx]||{});
              base.moduleKey = moduleKey;
              base.eventKey = row.getAttribute('data-event-key') || base.eventKey;
              ['enabled','managerLineEnabled','managerEmailEnabled','employeeLineEnabled','employeeEmailEnabled'].forEach(f=>{ const el=row.querySelector(`[data-field="${f}"]`); base[f]=!!(el&&el.checked); });
              return base;
            });
            const r = await api('saveModuleNotificationSettings',{moduleKey,rows:nextRows});
            if(msg) msg.textContent = r.message || '已儲存。';
          }catch(err){ if(msg){ msg.textContent = (err&&err.message)||'儲存失敗'; msg.classList.add('err'); } }
        };
      }
    }catch(err){ box.innerHTML = `<div class="module-notify-panel"><div class="module-notify-title">${esc(title||'LINE / Email 提醒設定')}</div><div class="module-notify-msg err">讀取失敗：${esc((err&&err.message)||err)}</div></div>`; }
  };
  function canInstallQuick(){
    try{ const u=typeof getUser==='function'?getUser():null; return !!(u && (u.showSettingsZone || String(u.role||'').toLowerCase()==='admin') && window.YZFirebase); }catch(e){ return false; }
  }
  function installQuickMessage(){
    ensureStyle();
    if(document.getElementById('managerQuickMsgBtn') || !canInstallQuick()) return;
    const btn=document.createElement('button'); btn.id='managerQuickMsgBtn'; btn.className='manager-quick-msg-btn'; btn.type='button'; btn.textContent='LINE / Email'; document.body.appendChild(btn);
    const modal=document.createElement('div'); modal.id='managerQuickMsgModal'; modal.className='manager-quick-msg-backdrop'; modal.innerHTML=`<div class="manager-quick-msg-modal"><div class="manager-quick-msg-top"><h3>傳送訊息</h3><button class="manager-quick-msg-close" type="button">關閉</button></div><div class="manager-quick-msg-field"><label>搜尋收件人</label><input id="managerQuickSearch" placeholder="姓名、Email、員工ID"></div><div class="manager-quick-msg-field"><label>收件人</label><div class="manager-quick-recips" id="managerQuickRecipients">讀取中…</div></div><div class="manager-quick-msg-field"><label>發送方式</label><div class="manager-quick-channel"><label><input type="checkbox" value="line" checked> LINE</label><label><input type="checkbox" value="email"> Email</label></div></div><div class="manager-quick-msg-field"><label>訊息內容</label><textarea id="managerQuickBody" placeholder="輸入要發送給員工的訊息"></textarea></div><div class="manager-quick-actions"><button class="manager-quick-send" type="button">送出</button><button class="manager-quick-cancel" type="button">取消</button></div><div class="manager-quick-status" id="managerQuickStatus"></div></div>`; document.body.appendChild(modal);
    let recipients=[];
    async function loadRecipients(keyword=''){
      const wrap=modal.querySelector('#managerQuickRecipients'); wrap.textContent='讀取中…';
      try{ const r=await api('getNotificationRecipients',{keyword}); recipients=Array.isArray(r.rows)?r.rows:[]; wrap.innerHTML=recipients.map((x,i)=>`<label><input type="checkbox" value="${i}"><span>${esc(x.name||'未命名')}｜${esc(x.identityLabel||'')}｜${esc(x.email||x.employeeId||'')}</span></label>`).join('') || '沒有符合的收件人'; }catch(err){ wrap.textContent='讀取收件人失敗'; }
    }
    function open(){ modal.classList.add('show'); loadRecipients(''); }
    function close(){ modal.classList.remove('show'); }
    btn.onclick=open; modal.querySelector('.manager-quick-msg-close').onclick=close; modal.querySelector('.manager-quick-cancel').onclick=close;
    let searchTimer=null; modal.querySelector('#managerQuickSearch').addEventListener('input', e=>{ clearTimeout(searchTimer); searchTimer=setTimeout(()=>loadRecipients(e.target.value),250); });
    modal.querySelector('.manager-quick-send').onclick=async()=>{
      const status=modal.querySelector('#managerQuickStatus'); status.textContent=''; status.classList.remove('err');
      const idxs=Array.from(modal.querySelectorAll('#managerQuickRecipients input:checked')).map(x=>Number(x.value));
      const targets=idxs.map(i=>recipients[i]).filter(Boolean);
      const channels=Array.from(modal.querySelectorAll('.manager-quick-channel input:checked')).map(x=>x.value);
      const message=clean(modal.querySelector('#managerQuickBody').value);
      try{ status.textContent='建立發送佇列中…'; const r=await api('sendManualNotification',{targets,channels,message}); if(!r.ok) throw new Error(r.message||'送出失敗'); status.textContent=r.message||'已建立發送佇列。'; modal.querySelector('#managerQuickBody').value=''; }catch(err){ status.textContent=(err&&err.message)||'送出失敗'; status.classList.add('err'); }
    };
  }
  function boot(){ setTimeout(installQuickMessage, 500); setTimeout(installQuickMessage, 1500); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();


/************************************************************
 * 通知工具強制掛載修正版 20260529 notify visible v2
 * - 不再只依賴 showSettingsZone / role=admin，改用主管功能頁網址判斷。
 * - 自動在主管功能頁底部補上 LINE / Email 提醒設定。
 * - 自動在主管功能頁右下角補上手動 LINE / Email 浮動按鈕。
 ************************************************************/
(function(){
  if(window.__notifyVisibleFixV2_20260529) return;
  window.__notifyVisibleFixV2_20260529 = true;
  function clean(v){return String(v==null?'':v).trim();}
  function esc(v){return clean(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function page(){return clean((location.pathname||'').split('/').pop()).toLowerCase() || 'index.html';}
  function isManagerFeaturePage(){
    var p=page();
    if(['dashboard.html','index.html','portal.html','clock.html','parttime.html','profile.html','salary.html','temporary-attendance.html','announcements.html','routine.html','task.html','contract.html','teacher-home.html'].indexOf(p)>=0) return false;
    if(p.indexOf('admin')>=0 || p.indexOf('approval')>=0 || p==='settings.html' || p==='approval-hub.html' || p==='leave-policy-admin.html' || p==='clock-records-admin.html' || p==='data-center.html' || p==='items-hub.html') return true;
    return false;
  }
  function feature(){
    var p=page();
    if(p==='clock-corrections-admin.html') return {key:'clock', title:'打卡簽核提醒設定'};
    if(p==='temporary-attendance-admin.html') return {key:'temporaryAttendance', title:'臨時出勤 / 工讀超時提醒設定'};
    if(p==='parttime-payroll-admin.html') return {key:'parttimePayroll', title:'工讀時數 / 超出排班提醒設定'};
    if(p==='registration-approval.html') return {key:'registration', title:'註冊簽核提醒設定'};
    if(p==='profile-change-admin.html') return {key:'profileChange', title:'個資修改提醒設定'};
    if(p==='leave.html' && ((location.search||'').indexOf('mode=approval')>=0 || (location.search||'').indexOf('entry=approval')>=0)) return {key:'leave', title:'請假簽核提醒設定'};
    return null;
  }
  function apiCall(action,payload){
    if(typeof api==='function') return api(action,payload||{});
    if(window.YZFirebase && typeof window.YZFirebase.handleApi==='function') return window.YZFirebase.handleApi(action,payload||{});
    return Promise.reject(new Error('Firebase API 尚未啟用'));
  }
  function style(){
    if(document.getElementById('notifyVisibleFixStyleV2')) return;
    var s=document.createElement('style'); s.id='notifyVisibleFixStyleV2';
    s.textContent='\
    .notify-v2-fab{position:fixed;right:16px;bottom:18px;z-index:2147483000;border:0;border-radius:999px;background:#06c755;color:#fff;font-weight:900;padding:13px 16px;box-shadow:0 12px 30px rgba(15,23,42,.26);cursor:pointer;font-size:15px}\
    .notify-v2-panel{margin:16px auto;max-width:1120px;background:#fff;border:1px solid #dbe5f1;border-radius:20px;padding:16px;box-shadow:0 8px 24px rgba(15,23,42,.05)}\
    .notify-v2-panel h3{margin:0 0 6px;font-size:20px;color:#18314a}.notify-v2-muted{color:#64748b;line-height:1.6;font-size:13px}.notify-v2-list{display:grid;gap:10px;margin-top:12px}.notify-v2-row{border:1px solid #e2e8f0;background:#f8fafc;border-radius:16px;padding:12px}.notify-v2-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.notify-v2-name{font-weight:900;color:#18314a}.notify-v2-checks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}.notify-v2-checks label{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:8px;font-size:13px;font-weight:800;color:#334155;display:flex;align-items:center;justify-content:space-between;gap:6px}.notify-v2-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}.notify-v2-actions button,.notify-v2-send,.notify-v2-secondary{border:0;border-radius:14px;padding:11px 14px;font-weight:900;cursor:pointer}.notify-v2-send,.notify-v2-actions button{background:#1f7a5a;color:#fff}.notify-v2-secondary{background:#eef2f6;color:#18314a}.notify-v2-msg{font-size:13px;font-weight:900;color:#1f7a5a}.notify-v2-msg.err{color:#b42318}\
    .notify-v2-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2147483001;display:none;align-items:center;justify-content:center;padding:14px}.notify-v2-backdrop.show{display:flex}.notify-v2-modal{width:min(94vw,680px);max-height:88vh;overflow:auto;background:#fff;border-radius:22px;padding:18px;box-shadow:0 24px 70px rgba(15,23,42,.28)}.notify-v2-top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}.notify-v2-top h3{margin:0;font-size:22px;color:#18314a}.notify-v2-field{margin-top:12px}.notify-v2-field label{display:block;font-weight:900;margin-bottom:6px}.notify-v2-field input,.notify-v2-field textarea,.notify-v2-field select{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:14px;padding:11px 12px;font-size:15px}.notify-v2-field textarea{min-height:110px;resize:vertical}.notify-v2-recip{border:1px solid #e5e7eb;border-radius:14px;background:#f8fafc;max-height:230px;overflow:auto;padding:8px}.notify-v2-recip label{display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:800}.notify-v2-recip label:last-child{border-bottom:0}.notify-v2-recip input{width:auto}.notify-v2-channels{display:flex;gap:12px;flex-wrap:wrap}.notify-v2-channels label{display:inline-flex;gap:6px;align-items:center;font-weight:900}.notify-v2-channels input{width:auto}.notify-v2-modal-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.notify-v2-status{font-weight:900;margin-top:10px;color:#1f7a5a}.notify-v2-status.err{color:#b42318}@media(max-width:640px){.notify-v2-fab{right:12px;bottom:12px}.notify-v2-checks{grid-template-columns:1fr}.notify-v2-modal-actions{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }
  function waitApi(cb,tries){
    tries=tries||0;
    if((typeof api==='function') || (window.YZFirebase && typeof window.YZFirebase.handleApi==='function')) return cb();
    if(tries>30) return;
    setTimeout(function(){waitApi(cb,tries+1);},200);
  }
  async function renderPanel(box, f){
    style();
    box.innerHTML='<div class="notify-v2-panel"><h3>'+esc(f.title)+'</h3><div class="notify-v2-muted">讀取提醒設定中…</div></div>';
    try{
      var res=await apiCall('getModuleNotificationSettings',{moduleKey:f.key});
      var rows=Array.isArray(res.rows)?res.rows:[];
      box.innerHTML='<div class="notify-v2-panel"><h3>'+esc(f.title)+'</h3><div class="notify-v2-muted">此區只設定本功能的 LINE / Email 提醒。送出後會由後端直接推送並留下紀錄。</div><div class="notify-v2-list">'+rows.map(function(r,i){return '<div class="notify-v2-row" data-i="'+i+'" data-key="'+esc(r.eventKey)+'"><div class="notify-v2-head"><div><div class="notify-v2-name">'+esc(r.eventName||r.eventKey)+'</div><div class="notify-v2-muted">'+esc(r.description||'')+'</div></div><label style="font-weight:900;white-space:nowrap"><input type="checkbox" data-f="enabled" '+(r.enabled!==false?'checked':'')+'> 啟用</label></div><div class="notify-v2-checks"><label>通知主管 LINE <input type="checkbox" data-f="managerLineEnabled" '+(r.managerLineEnabled?'checked':'')+'></label><label>通知主管 Email <input type="checkbox" data-f="managerEmailEnabled" '+(r.managerEmailEnabled?'checked':'')+'></label><label>通知員工 LINE <input type="checkbox" data-f="employeeLineEnabled" '+(r.employeeLineEnabled?'checked':'')+'></label><label>通知員工 Email <input type="checkbox" data-f="employeeEmailEnabled" '+(r.employeeEmailEnabled?'checked':'')+'></label></div></div>';}).join('')+'</div><div class="notify-v2-actions"><button type="button" data-notify-v2-save>儲存提醒設定</button><span class="notify-v2-msg" data-notify-v2-msg></span></div></div>';
      var btn=box.querySelector('[data-notify-v2-save]');
      if(btn){btn.onclick=async function(){
        var msg=box.querySelector('[data-notify-v2-msg]');
        try{
          if(msg){msg.textContent='儲存中…'; msg.classList.remove('err');}
          var next=Array.from(box.querySelectorAll('.notify-v2-row')).map(function(row,idx){
            var base=Object.assign({},rows[idx]||{}); base.moduleKey=f.key; base.eventKey=row.getAttribute('data-key')||base.eventKey;
            ['enabled','managerLineEnabled','managerEmailEnabled','employeeLineEnabled','employeeEmailEnabled'].forEach(function(k){var el=row.querySelector('[data-f="'+k+'"]'); base[k]=!!(el&&el.checked);});
            return base;
          });
          var rr=await apiCall('saveModuleNotificationSettings',{moduleKey:f.key,rows:next});
          if(msg) msg.textContent=(rr&&rr.message)||'已儲存。';
        }catch(e){if(msg){msg.textContent=e.message||'儲存失敗'; msg.classList.add('err');}}
      };}
    }catch(e){box.innerHTML='<div class="notify-v2-panel"><h3>'+esc(f.title)+'</h3><div class="notify-v2-msg err">讀取失敗：'+esc(e.message||e)+'</div></div>';}
  }
  function installPanel(){
    var f=feature(); if(!f) return;
    var box=document.getElementById('notifyVisibleFeaturePanelV2');
    if(!box){ box=document.createElement('div'); box.id='notifyVisibleFeaturePanelV2'; var target=document.querySelector('.container:last-of-type')||document.body; target.appendChild(box); }
    waitApi(function(){renderPanel(box,f);});
  }
  function installFloating(){
    if(!isManagerFeaturePage()) return;
    style();
    if(document.getElementById('notifyForceQuickBtn') || document.getElementById('managerQuickMsgBtn') || document.getElementById('notifyFloatingBtn')) return;
    var btn=document.createElement('button'); btn.id='notifyForceQuickBtn'; btn.className='notify-v2-fab'; btn.type='button'; btn.textContent='LINE / Email'; document.body.appendChild(btn);
    var modal=document.createElement('div'); modal.id='notifyForceQuickModal'; modal.className='notify-v2-backdrop'; modal.innerHTML='<div class="notify-v2-modal"><div class="notify-v2-top"><h3>LINE / Email 手動通知</h3><button class="notify-v2-secondary" type="button" data-close>關閉</button></div><div class="notify-v2-field"><label>搜尋收件人</label><input data-search placeholder="姓名、Email、員工ID"></div><div class="notify-v2-field"><label>收件人</label><div class="notify-v2-recip" data-recip>讀取中…</div></div><div class="notify-v2-field"><label>發送方式</label><div class="notify-v2-channels"><label><input type="checkbox" value="line" checked> LINE</label><label><input type="checkbox" value="email"> Email</label></div></div><div class="notify-v2-field"><label>訊息內容</label><textarea data-message placeholder="輸入要發送給員工的訊息"></textarea></div><div class="notify-v2-modal-actions"><button class="notify-v2-send" type="button" data-send>送出通知</button><button class="notify-v2-secondary" type="button" data-cancel>取消</button></div><div class="notify-v2-status" data-status></div></div>'; document.body.appendChild(modal);
    var recips=[]; var timer=null;
    function status(t,err){var el=modal.querySelector('[data-status]'); el.textContent=t||''; el.className='notify-v2-status'+(err?' err':'');}
    function render(list){var wrap=modal.querySelector('[data-recip]'); wrap.innerHTML=list.length?list.map(function(x,i){return '<label><input type="checkbox" value="'+i+'"><span>'+esc(x.name||'未命名')+'｜'+esc(x.identityLabel||'')+'｜'+esc(x.email||x.employeeId||'')+(x.lineUserId?'｜LINE 已綁定':'')+'</span></label>';}).join(''):'沒有符合的收件人';}
    async function load(q){
      var wrap=modal.querySelector('[data-recip]'); wrap.textContent='讀取中…';
      try{var r=await apiCall('getNotificationRecipients',{keyword:q||''}); recips=Array.isArray(r.rows)?r.rows:[]; render(recips);}catch(e){wrap.textContent='讀取收件人失敗：'+(e.message||e);}
    }
    function open(){modal.classList.add('show'); waitApi(function(){load('');});}
    function close(){modal.classList.remove('show');}
    btn.onclick=open; modal.querySelector('[data-close]').onclick=close; modal.querySelector('[data-cancel]').onclick=close; modal.addEventListener('click',function(e){if(e.target===modal) close();});
    modal.querySelector('[data-search]').addEventListener('input',function(e){clearTimeout(timer); timer=setTimeout(function(){load(e.target.value);},250);});
    modal.querySelector('[data-send]').onclick=async function(){
      try{
        status('');
        var idxs=Array.from(modal.querySelectorAll('[data-recip] input:checked')).map(function(x){return Number(x.value);});
        var targets=idxs.map(function(i){return recips[i];}).filter(Boolean);
        var channels=Array.from(modal.querySelectorAll('.notify-v2-channels input:checked')).map(function(x){return x.value;});
        var message=clean(modal.querySelector('[data-message]').value);
        if(!targets.length) throw new Error('請選擇收件人。');
        if(!channels.length) throw new Error('請至少選擇 LINE 或 Email。');
        if(!message) throw new Error('請輸入訊息內容。');
        status('建立發送佇列中…');
        var r=await apiCall('sendManualNotification',{targets:targets,channels:channels,message:message,page:location.pathname});
        if(!r || r.ok===false) throw new Error((r&&r.message)||'送出失敗');
        status((r&&r.message)||'已建立發送佇列。'); modal.querySelector('[data-message]').value='';
      }catch(e){status(e.message||'送出失敗',true);}
    };
  }
  function boot(){installFloating(); installPanel(); setTimeout(installFloating,700); setTimeout(installPanel,900); setTimeout(installFloating,1800);}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();

/*****************************************************************
 * Notification V2 final UI patch
 * - Module-level panels only.
 * - Manual floating LINE / Email button.
 * - Hides old notification setting widgets to avoid confusion.
 *****************************************************************/
(function(){
  if(window.__notificationV2FinalUi20260530) return;
  window.__notificationV2FinalUi20260530 = true;

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function clean(v){return String(v==null?'':v).trim();}
  function pathName(){return String((location && location.pathname) || '').split('/').pop().toLowerCase() || 'index.html';}
  function isManagerLikely(){
    const p=pathName();
    const managerPages=['settings.html','approval-hub.html','clock-corrections-admin.html','temporary-attendance-admin.html','parttime-payroll-admin.html','registration-approval.html','profile-change-admin.html','announcement-admin.html','task.html','routine.html','teacher-hub.html','application-admin.html','salary-admin.html','schedule-admin.html','leave-policy-admin.html','contract-admin.html','teacher-goods-admin.html','clock-records-admin.html','data-center.html','approval-notification-settings.html','teacher-notification-settings.html','application-notification-settings.html'];
    if(managerPages.indexOf(p)>=0) return true;
    if(p==='leave.html' && (location.search||'').indexOf('mode=approval')>=0) return true;
    try{const u=typeof getUser==='function'?getUser():null; return !!(u && (u.showSettingsZone || String(u.role||'').toLowerCase()==='admin'));}catch(e){return false;}
  }
  function modulesForPage(){
    const p=pathName();
    if(p==='approval-notification-settings.html') return [
      {key:'registration', title:'註冊簽核提醒設定'},
      {key:'clock', title:'打卡簽核提醒設定'},
      {key:'temporaryAttendance', title:'補登 / 臨時出勤提醒設定'},
      {key:'leave', title:'請假簽核提醒設定'},
      {key:'profileChange', title:'個資修改簽核提醒設定'}
    ];
    if(p==='teacher-notification-settings.html') return [
      {key:'contractor', title:'外聘老師提醒設定'}
    ];
    if(p==='application-notification-settings.html') return [
      {key:'recruitment', title:'應聘老師提醒設定'}
    ];
    return [];
  }
  function moduleForPage(){
    const list=modulesForPage();
    return list.length ? list[0] : null;
  }
  function apiCall(action,payload){
    if(typeof api==='function') return api(action,payload||{});
    if(window.YZFirebase && typeof window.YZFirebase.handleApi==='function') return window.YZFirebase.handleApi(action,payload||{});
    return Promise.reject(new Error('通知系統尚未載入完成'));
  }
  function style(){
    if(document.getElementById('notificationV2FinalStyle')) return;
    const s=document.createElement('style');
    s.id='notificationV2FinalStyle';
    s.textContent=`
      #notifyVisibleFeaturePanelV2,#managerNotifyPanel,.module-notify-panel,.notify-setting-card,.notify-v2-panel,#notifyForceQuickBtn,#managerQuickMsgBtn,#notifyFloatingBtn,.notify-floating-btn{display:none!important}
      .n2-panel{margin:18px 0 28px;background:#fff;border:1px solid #dbe5f1;border-radius:22px;padding:16px;box-shadow:0 10px 28px rgba(15,23,42,.05)}
      .n2-title{font-size:21px;font-weight:950;color:#18314a;margin:0 0 6px}.n2-desc{font-size:13px;line-height:1.7;color:#64748b;margin-bottom:12px}.n2-list{display:grid;gap:10px}.n2-row{border:1px solid #e2e8f0;border-radius:16px;background:#f8fafc;padding:12px}.n2-row-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.n2-name{font-size:15px;font-weight:950;color:#18314a}.n2-help{font-size:12px;color:#64748b;line-height:1.6;margin-top:2px}.n2-enable{font-weight:900;white-space:nowrap}.n2-checks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}.n2-checks label{display:flex;align-items:center;justify-content:space-between;gap:6px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:9px;font-size:13px;font-weight:850;color:#334155}.n2-checks input,.n2-enable input{width:18px;height:18px;accent-color:#1f7a5a}.n2-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}.n2-actions button,.n2-fab,.n2-send,.n2-secondary{border:0;border-radius:14px;padding:11px 14px;font-weight:950;cursor:pointer}.n2-actions button,.n2-send{background:#1f7a5a;color:#fff}.n2-secondary{background:#eef2f6;color:#18314a}.n2-msg{font-size:13px;font-weight:950;color:#1f7a5a}.n2-msg.err{color:#b42318}.n2-quick{display:flex;gap:8px;flex-wrap:wrap}.n2-quick button{background:#eef7f0;color:#1f7a5a;border:1px solid #bbdfca;border-radius:999px;padding:8px 11px;font-size:13px}
      .n2-fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;background:#06c755;color:#fff;box-shadow:0 14px 34px rgba(15,23,42,.25)}
      .n2-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2147483001;display:none;align-items:center;justify-content:center;padding:14px}.n2-backdrop.show{display:flex}.n2-modal{width:min(94vw,700px);max-height:88vh;overflow:auto;background:#fff;border-radius:24px;padding:18px;box-shadow:0 24px 70px rgba(15,23,42,.28)}.n2-modal-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}.n2-modal-title{font-size:22px;font-weight:950;color:#18314a}.n2-field{margin-top:12px}.n2-field label{display:block;font-weight:900;margin-bottom:6px}.n2-field input,.n2-field textarea,.n2-field select{width:100%;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:14px;padding:11px 12px;font-size:15px}.n2-field textarea{min-height:112px;resize:vertical}.n2-recips{border:1px solid #e5e7eb;border-radius:14px;background:#f8fafc;max-height:250px;overflow:auto;padding:8px}.n2-recips label{display:flex;align-items:flex-start;gap:8px;padding:8px;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:850;line-height:1.45}.n2-recips label:last-child{border-bottom:0}.n2-recips input{width:auto;margin-top:2px}.n2-small{display:block;color:#64748b;font-size:12px;font-weight:750}.n2-channels{display:flex;gap:12px;flex-wrap:wrap}.n2-channels label{display:inline-flex;gap:6px;align-items:center;font-weight:900}.n2-channels input{width:auto}.n2-modal-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.n2-status{font-weight:950;margin-top:10px;color:#1f7a5a;line-height:1.6}.n2-status.err{color:#b42318}
      @media(max-width:720px){.n2-checks{grid-template-columns:1fr 1fr}.n2-modal-actions{grid-template-columns:1fr}.n2-fab{right:12px;bottom:12px}.n2-row-head{display:grid}.n2-enable{justify-self:start}}@media(max-width:420px){.n2-checks{grid-template-columns:1fr}.n2-panel{padding:14px;border-radius:18px}}
    `;
    document.head.appendChild(s);
  }
  function renderLoading(section, mod){
    section.innerHTML='<section class="n2-panel"><div class="n2-title">'+esc(mod.title)+'</div><div class="n2-desc">讀取提醒設定中…</div></section>';
  }
  async function renderOneModulePanel(section, mod){
    renderLoading(section, mod);
    try{
      const res=await apiCall('getNotificationV2Settings',{moduleKey:mod.key});
      const rows=Array.isArray(res.rows)?res.rows:[];
      section.innerHTML='<section class="n2-panel"><div class="n2-title">'+esc(res.title||mod.title)+'</div><div class="n2-desc">這裡只設定本功能區的 LINE / Email 提醒。若收件人沒有綁定 LINE 或沒有開啟 LINE 通知，即使此處有勾 LINE，也不會建立 LINE 發送。</div><div class="n2-quick"><button type="button" data-n2-select="managerLineEnabled">主管 LINE 全選</button><button type="button" data-n2-select="managerEmailEnabled">主管 Email 全選</button><button type="button" data-n2-select="employeeLineEnabled">員工 LINE 全選</button><button type="button" data-n2-select="employeeEmailEnabled">員工 Email 全選</button><button type="button" data-n2-clear>全部取消</button></div><div class="n2-list">'+rows.map(function(r,i){return '<div class="n2-row" data-index="'+i+'" data-event="'+esc(r.eventKey)+'"><div class="n2-row-head"><div><div class="n2-name">'+esc(r.eventName||r.eventKey)+'</div><div class="n2-help">'+esc(r.description||'')+'</div></div><label class="n2-enable"><input type="checkbox" data-field="enabled" '+(r.enabled!==false?'checked':'')+'> 啟用</label></div><div class="n2-checks"><label>主管 LINE <input type="checkbox" data-field="managerLineEnabled" '+(r.managerLineEnabled?'checked':'')+'></label><label>主管 Email <input type="checkbox" data-field="managerEmailEnabled" '+(r.managerEmailEnabled?'checked':'')+'></label><label>員工 LINE <input type="checkbox" data-field="employeeLineEnabled" '+(r.employeeLineEnabled?'checked':'')+'></label><label>員工 Email <input type="checkbox" data-field="employeeEmailEnabled" '+(r.employeeEmailEnabled?'checked':'')+'></label></div></div>';}).join('')+'</div><div class="n2-actions"><button type="button" data-n2-save>儲存提醒設定</button><span class="n2-msg" data-n2-msg></span></div></section>';
      section.querySelectorAll('[data-n2-select]').forEach(function(btn){btn.onclick=function(){const field=btn.getAttribute('data-n2-select'); section.querySelectorAll('[data-field="'+field+'"]').forEach(x=>x.checked=true);};});
      const clear=section.querySelector('[data-n2-clear]'); if(clear) clear.onclick=function(){section.querySelectorAll('.n2-checks input').forEach(x=>x.checked=false);};
      const save=section.querySelector('[data-n2-save]');
      if(save) save.onclick=async function(){
        const msg=section.querySelector('[data-n2-msg]');
        try{
          if(msg){msg.textContent='儲存中…'; msg.classList.remove('err');}
          const next=Array.from(section.querySelectorAll('.n2-row')).map(function(row,idx){
            const base=Object.assign({}, rows[idx]||{}); base.moduleKey=mod.key; base.eventKey=row.getAttribute('data-event')||base.eventKey;
            ['enabled','managerLineEnabled','managerEmailEnabled','employeeLineEnabled','employeeEmailEnabled'].forEach(function(k){const el=row.querySelector('[data-field="'+k+'"]'); base[k]=!!(el&&el.checked);});
            return base;
          });
          const rr=await apiCall('saveNotificationV2Settings',{moduleKey:mod.key,rows:next});
          if(!rr || rr.ok===false) throw new Error((rr&&rr.message)||'儲存失敗');
          if(msg) msg.textContent=rr.message||'已儲存。';
        }catch(e){if(msg){msg.textContent=e.message||'儲存失敗'; msg.classList.add('err');}}
      };
    }catch(e){section.innerHTML='<section class="n2-panel"><div class="n2-title">'+esc(mod.title)+'</div><div class="n2-msg err">讀取失敗：'+esc(e.message||e)+'</div></section>';}
  }
  async function renderModulePanel(){
    const mods=modulesForPage();
    if(!mods.length || !isManagerLikely()) return;
    style();
    let box=document.getElementById('notificationV2FinalPanel');
    if(!box){ box=document.createElement('div'); box.id='notificationV2FinalPanel'; const target=document.querySelector('.container:last-of-type') || document.querySelector('main') || document.body; target.appendChild(box); }
    box.innerHTML='';
    mods.forEach(function(mod){ const holder=document.createElement('div'); holder.setAttribute('data-n2-module', mod.key); box.appendChild(holder); renderOneModulePanel(holder, mod); });
  }
  function installFab(){
    if(!isManagerLikely()) return;
    style();
    if(!document.getElementById('notificationManualCategoryStyle')){
      const cs=document.createElement('style');
      cs.id='notificationManualCategoryStyle';
      cs.textContent=`
        .n2-cat-grid{display:grid;grid-template-columns:1fr;gap:10px}
        .n2-cat-card{width:100%;border:1px solid #dbe5f1;background:#fff;border-radius:16px;padding:13px 14px;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:950;color:#18314a;box-shadow:0 6px 16px rgba(15,23,42,.04)}
        .n2-cat-card:hover{background:#f1f8f4;border-color:#b7dcc5}
        .n2-cat-title{font-size:16px}.n2-cat-sub{display:block;color:#64748b;font-size:12px;font-weight:750;margin-top:2px}.n2-cat-arrow{font-size:22px;color:#1f7a5a}
        .n2-recip-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}.n2-recip-title{font-size:16px;font-weight:950;color:#18314a}.n2-back{border:0;border-radius:999px;background:#eef2f6;color:#18314a;padding:8px 11px;font-weight:950;cursor:pointer}
        .n2-select-tools{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.n2-select-tools button{border:1px solid #bbdfca;background:#eef7f0;color:#1f7a5a;border-radius:999px;padding:7px 10px;font-weight:900;cursor:pointer;font-size:12px}
      `;
      document.head.appendChild(cs);
    }
    if(document.getElementById('notificationV2FinalFab')) return;
    const btn=document.createElement('button'); btn.id='notificationV2FinalFab'; btn.className='n2-fab'; btn.type='button'; btn.textContent='LINE / Email'; document.body.appendChild(btn);
    const modal=document.createElement('div'); modal.id='notificationV2FinalModal'; modal.className='n2-backdrop'; modal.innerHTML='<div class="n2-modal"><div class="n2-modal-head"><div><div class="n2-modal-title">LINE / Email 手動通知</div><div class="n2-small">主管臨時傳訊息用。先選工讀生、專職員工或外聘老師，再勾選收件人。已離職、停用、封存或隱藏於日常清單的人不會出現。</div></div><button class="n2-secondary" type="button" data-close>關閉</button></div><div class="n2-field"><label>搜尋收件人</label><input data-search placeholder="請先選擇收件人類別" disabled></div><div class="n2-field"><label>收件人類別 / 收件人</label><div class="n2-recips" data-recip>讀取中…</div></div><div class="n2-field"><label>發送方式</label><div class="n2-channels"><label><input type="checkbox" value="line" checked> LINE</label><label><input type="checkbox" value="email"> Email</label></div></div><div class="n2-field"><label>訊息內容</label><textarea data-message placeholder="輸入要發送的文字"></textarea></div><div class="n2-modal-actions"><button class="n2-send" type="button" data-send>送出通知</button><button class="n2-secondary" type="button" data-cancel>取消</button></div><div class="n2-status" data-status></div></div>'; document.body.appendChild(modal);
    let allRecips=[]; let currentList=[]; let selectedCategory=''; let timer=null;
    const categories=[
      {key:'parttime', title:'工讀生', hint:'點進去選擇工讀生收件人'},
      {key:'staff', title:'專職員工', hint:'點進去選擇專職員工收件人'},
      {key:'external', title:'外聘老師', hint:'點進去選擇外聘老師收件人'}
    ];
    function setStatus(t,err){const el=modal.querySelector('[data-status]'); el.textContent=t||''; el.className='n2-status'+(err?' err':'');}
    function truthyLocal(v){ const s=clean(v).toLowerCase(); return v===true || v===1 || s==='1' || s==='true' || s==='yes' || s==='是' || s==='on'; }
    function isHiddenOrInactive(x){
      const a=clean(x.accountStatus||x['帳號狀態']||'active').toLowerCase();
      const e=clean(x.employmentStatus||x['任職狀態']||x['在職狀態']||'active').toLowerCase();
      const h=x.hiddenFromActiveLists===true || truthyLocal(x.hiddenFromActiveLists) || truthyLocal(x['隱藏於日常清單']) || truthyLocal(x['是否隱藏']);
      return h || ['inactive','rejected','pending','archived','disabled','停用','駁回','待審核','封存'].indexOf(a)>=0 || ['resigned','suspended','archived','contractorended','離職','暫停任用','封存','合作結束','外聘合作結束'].indexOf(e)>=0;
    }
    function normType(x){
      const raw=clean(x.identityType||x['身分類型']||x.identityLabel||x.role||x.employeeType||x['員工身分']).toLowerCase();
      if(raw.indexOf('工讀')>=0 || raw==='parttime' || truthyLocal(x.isPartTime || x['是否工讀生'])) return 'parttime';
      if(raw.indexOf('外聘')>=0 || raw==='external' || raw==='teacher' || raw==='contractor') return 'external';
      return 'staff';
    }
    function rowsByCat(cat){return allRecips.filter(x=>normType(x)===cat && !isHiddenOrInactive(x));}
    function catTitle(cat){const c=categories.find(x=>x.key===cat); return c?c.title:'收件人';}
    function renderCategoryHome(){
      selectedCategory=''; currentList=[];
      const search=modal.querySelector('[data-search]'); search.value=''; search.disabled=true; search.placeholder='請先選擇收件人類別';
      const wrap=modal.querySelector('[data-recip]');
      wrap.innerHTML='<div class="n2-cat-grid">'+categories.map(function(c){
        const count=rowsByCat(c.key).length;
        return '<button type="button" class="n2-cat-card" data-cat="'+esc(c.key)+'"><span><span class="n2-cat-title">'+esc(c.title)+'</span><span class="n2-cat-sub">'+esc(c.hint)+'｜目前可通知名單 '+count+' 人</span></span><span class="n2-cat-arrow">›</span></button>';
      }).join('')+'</div>';
      // 用事件委派處理點擊，避免手機瀏覽器點到內層 span 時沒有觸發。
      wrap.onclick=function(ev){
        const card=ev.target && ev.target.closest ? ev.target.closest('[data-cat]') : null;
        if(card){ ev.preventDefault(); openCategory(card.getAttribute('data-cat')); }
      };
    }
    function renderPeople(keyword){
      const k=lower(keyword||'');
      const source=rowsByCat(selectedCategory);
      currentList=source.filter(function(x){
        if(!k) return true;
        return [x.name,x.employeeName,x.employeeId,x.id,x.email,x.identityLabel].join(' ').toLowerCase().indexOf(k)>=0;
      });
      const wrap=modal.querySelector('[data-recip]');
      wrap.onclick=null;
      wrap.innerHTML='<div class="n2-recip-head"><button type="button" class="n2-back" data-back>← 返回類別</button><div class="n2-recip-title">'+esc(catTitle(selectedCategory))+'</div></div><div class="n2-select-tools"><button type="button" data-select-all>全選本頁</button><button type="button" data-clear-all>取消全選</button></div>'+(currentList.length?currentList.map(function(x,i){const lineState=x.lineUserId?(x.lineNotifyEnabled?'LINE 可通知':'LINE 已綁定但通知關閉'):'LINE 未綁定'; const mail=x.email?'Email 可通知':'無 Email'; return '<label><input type="checkbox" value="'+i+'"><span>'+esc(x.name||x.employeeName||'未命名')+'<span class="n2-small">'+esc(x.email||x.employeeId||x.id||'')+'｜'+esc(lineState)+'｜'+esc(mail)+'</span></span></label>';}).join(''):'沒有符合的收件人');
      const back=wrap.querySelector('[data-back]'); if(back) back.onclick=renderCategoryHome;
      const sel=wrap.querySelector('[data-select-all]'); if(sel) sel.onclick=function(){wrap.querySelectorAll('input[type="checkbox"]').forEach(x=>x.checked=true);};
      const clr=wrap.querySelector('[data-clear-all]'); if(clr) clr.onclick=function(){wrap.querySelectorAll('input[type="checkbox"]').forEach(x=>x.checked=false);};
    }
    function openCategory(cat){
      selectedCategory=cat;
      const search=modal.querySelector('[data-search]'); search.disabled=false; search.value=''; search.placeholder='搜尋 '+catTitle(cat)+' 姓名、Email、員工ID';
      renderPeople('');
    }
    async function loadAll(){
      const wrap=modal.querySelector('[data-recip]'); wrap.textContent='讀取中…';
      try{const r=await apiCall('getNotificationRecipientsV2',{keyword:'',statusMode:'active'}); allRecips=Array.isArray(r.rows)?r.rows:[]; renderCategoryHome();}
      catch(e){wrap.textContent='讀取收件人失敗：'+(e.message||e);}
    }
    function open(){modal.classList.add('show'); setStatus(''); loadAll();}
    function close(){modal.classList.remove('show');}
    btn.onclick=open; modal.querySelector('[data-close]').onclick=close; modal.querySelector('[data-cancel]').onclick=close; modal.addEventListener('click',function(e){if(e.target===modal) close();});
    modal.querySelector('[data-search]').addEventListener('input',function(e){clearTimeout(timer); timer=setTimeout(function(){ if(selectedCategory) renderPeople(e.target.value); },180);});
    modal.querySelector('[data-send]').onclick=async function(){
      try{
        setStatus('');
        if(!selectedCategory) throw new Error('請先選擇工讀生、專職員工或外聘老師。');
        const idxs=Array.from(modal.querySelectorAll('[data-recip] input[type="checkbox"]:checked')).map(x=>Number(x.value));
        const targets=idxs.map(i=>currentList[i]).filter(Boolean);
        const channels=Array.from(modal.querySelectorAll('.n2-channels input:checked')).map(x=>x.value);
        const message=clean(modal.querySelector('[data-message]').value);
        if(!targets.length) throw new Error('請選擇收件人。');
        if(!channels.length) throw new Error('請至少選擇 LINE 或 Email。');
        if(!message) throw new Error('請輸入訊息內容。');
        setStatus('建立發送佇列中…');
        const r=await apiCall('sendManualNotificationV2',{targets,channels,message,page:pathName(),recipientCategory:selectedCategory});
        if(!r || r.ok===false) throw new Error((r&&r.message)||'送出失敗');
        setStatus(r.message||'已建立發送佇列。'); modal.querySelector('[data-message]').value='';
      }catch(e){setStatus(e.message||'送出失敗',true);}
    };
  }
  function boot(){style(); installFab(); renderModulePanel(); setTimeout(installFab,600); setTimeout(renderModulePanel,800); setTimeout(installFab,1600);}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();


/*****************************************************************
 * Notification V3 complete matrix UI 20260531
 * - Uses the selected reminder list confirmed by owner.
 * - Adds editable delay fields: reviewDeadlineDays / beforeMinutes / afterMinutes.
 * - Keeps manual LINE / Email tool as a fixed function, not a reminder option.
 *****************************************************************/
(function(){
  if(window.__notificationV3CompleteMatrix20260531) return;
  window.__notificationV3CompleteMatrix20260531 = true;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function clean(v){return String(v==null?'':v).trim();}
  function pathName(){return String((location && location.pathname) || '').split('/').pop().toLowerCase() || 'index.html';}
  function apiCall(action,payload){
    if(typeof api==='function') return api(action,payload||{});
    if(window.YZFirebase && typeof window.YZFirebase.handleApi==='function') return window.YZFirebase.handleApi(action,payload||{});
    return Promise.reject(new Error('通知系統尚未載入完成'));
  }
  function isManagerLikely(){
    const p=pathName();
    const managerPages=['settings.html','notification-settings.html','approval-hub.html','approval-notification-settings.html','teacher-notification-settings.html','application-notification-settings.html','certificate-notification-settings.html','teacher-hub.html','application-admin.html','quotation-contract-hub.html','announcement-admin.html','task.html','routine.html','salary-admin.html','teacher-goods-admin.html','certificate-review-admin.html'];
    if(managerPages.indexOf(p)>=0) return true;
    if(p==='leave.html' && (location.search||'').indexOf('mode=approval')>=0) return true;
    try{const u=typeof getUser==='function'?getUser():null; return !!(u && (u.showSettingsZone || String(u.role||'').toLowerCase()==='admin'));}catch(e){return false;}
  }
  function modulesForPage(){
    const p=pathName();
    if(p==='approval-notification-settings.html') return [
      {key:'registration', title:'註冊簽核提醒'},
      {key:'clock', title:'打卡修正 / 補登簽核提醒'},
      {key:'clockAuto', title:'上下班打卡自動提醒'},
      {key:'leave', title:'請假簽核提醒'},
      {key:'temporaryAttendance', title:'工讀 / 臨時出勤 / 工讀時數簽核提醒'},
      {key:'profileChange', title:'個人資料修改提醒'}
    ];
    if(p==='teacher-notification-settings.html') return [{key:'contractor', title:'外聘老師 / 合約 / 拿貨提醒'}];
    if(p==='application-notification-settings.html') return [{key:'recruitment', title:'應聘老師 / 履歷審核提醒'}];
    if(p==='certificate-notification-settings.html') return [{key:'certificate', title:'證明申請提醒'}];
    if(p==='notification-settings.html') return [
      {key:'account', title:'帳號 / LINE 綁定提醒'},
      {key:'task', title:'交辦事項 / 任務提醒'},
      {key:'announcement', title:'公告提醒'},
      {key:'salary', title:'薪資 / 投保提醒'},
      {key:'dailySummary', title:'每日待審核摘要'}
    ];
    return [];
  }
  function style(){
    if(document.getElementById('notificationV3Style')) return;
    const s=document.createElement('style');
    s.id='notificationV3Style';
    s.textContent=`
      #notifyVisibleFeaturePanelV2,#managerNotifyPanel,.module-notify-panel,.notify-setting-card,.notify-v2-panel,#notifyForceQuickBtn,#managerQuickMsgBtn,#notifyFloatingBtn,.notify-floating-btn{display:none!important}
      .n3-panel{margin:18px 0 28px;background:#fff;border:1px solid #dbe5f1;border-radius:22px;padding:16px;box-shadow:0 10px 28px rgba(15,23,42,.05)}
      .n3-title{font-size:21px;font-weight:950;color:#18314a;margin:0 0 6px}.n3-desc{font-size:13px;line-height:1.7;color:#64748b;margin:0 0 12px}.n3-list{display:grid;gap:10px}.n3-row{border:1px solid #e2e8f0;border-radius:16px;background:#f8fafc;padding:12px}.n3-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.n3-name{font-size:15px;font-weight:950;color:#18314a}.n3-code{font-size:12px;color:#94a3b8;font-weight:800}.n3-help{font-size:12px;color:#64748b;line-height:1.6;margin-top:3px}.n3-enable{font-weight:900;white-space:nowrap}.n3-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}.n3-grid label{display:flex;align-items:center;justify-content:space-between;gap:6px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:9px;font-size:13px;font-weight:850;color:#334155}.n3-grid input,.n3-enable input{width:18px;height:18px;accent-color:#1f7a5a}.n3-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.n3-field{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:9px}.n3-field span{display:block;font-size:12px;font-weight:900;color:#475569;margin-bottom:4px}.n3-field input{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:8px;font-size:14px}.n3-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}.n3-actions button{border:0;border-radius:14px;padding:11px 14px;font-weight:950;cursor:pointer;background:#1f7a5a;color:#fff}.n3-actions .secondary{background:#eef2f6;color:#18314a}.n3-msg{font-size:13px;font-weight:950;color:#1f7a5a}.n3-msg.err{color:#b42318}.n3-quick{display:flex;gap:8px;flex-wrap:wrap}.n3-quick button{background:#eef7f0;color:#1f7a5a;border:1px solid #bbdfca;border-radius:999px;padding:8px 11px;font-size:13px;font-weight:900;cursor:pointer}
      @media(max-width:760px){.n3-grid{grid-template-columns:1fr 1fr}.n3-fields{grid-template-columns:1fr}.n3-head{display:grid}.n3-enable{justify-self:start}}@media(max-width:430px){.n3-grid{grid-template-columns:1fr}.n3-panel{padding:14px;border-radius:18px}}
    `;
    document.head.appendChild(s);
  }
  function fieldLabel(k){return {reviewDeadlineDays:'逾期未審提醒天數',beforeMinutes:'提前提醒分鐘',afterMinutes:'未打卡後提醒分鐘',unreadReminderDays:'未讀提醒天數'}[k]||k;}
  function getExtraFields(r){
    const fields=Array.isArray(r.settingFields)?r.settingFields.slice():[];
    ['reviewDeadlineDays','beforeMinutes','afterMinutes','unreadReminderDays'].forEach(function(k){ if(r[k]!==undefined && fields.indexOf(k)<0) fields.push(k); });
    return fields;
  }
  function rowHtml(r,i){
    const fields=getExtraFields(r);
    return '<div class="n3-row" data-index="'+i+'" data-event="'+esc(r.eventKey)+'">'
      + '<div class="n3-head"><div><div class="n3-name">'+esc(r.no? r.no+'｜':'')+esc(r.eventName||r.eventKey)+'</div><div class="n3-code">'+esc(r.eventKey||'')+'</div><div class="n3-help">'+esc(r.description||'')+'</div></div><label class="n3-enable"><input type="checkbox" data-field="enabled" '+(r.enabled!==false?'checked':'')+'> 啟用</label></div>'
      + '<div class="n3-grid"><label>主管 LINE <input type="checkbox" data-field="managerLineEnabled" '+(r.managerLineEnabled?'checked':'')+'></label><label>主管 Email <input type="checkbox" data-field="managerEmailEnabled" '+(r.managerEmailEnabled?'checked':'')+'></label><label>員工 LINE <input type="checkbox" data-field="employeeLineEnabled" '+(r.employeeLineEnabled?'checked':'')+'></label><label>員工 Email <input type="checkbox" data-field="employeeEmailEnabled" '+(r.employeeEmailEnabled?'checked':'')+'></label></div>'
      + (fields.length?'<div class="n3-fields">'+fields.map(function(k){const val=r[k]==null?'':r[k]; return '<label class="n3-field"><span>'+esc(fieldLabel(k))+'</span><input type="number" min="0" step="1" data-field="'+esc(k)+'" value="'+esc(val)+'"></label>';}).join('')+'</div>':'')
      + '</div>';
  }
  async function renderOne(holder, mod){
    holder.innerHTML='<section class="n3-panel"><div class="n3-title">'+esc(mod.title)+'</div><div class="n3-desc">讀取提醒設定中…</div></section>';
    try{
      const res=await apiCall('getNotificationV2Settings',{moduleKey:mod.key,version:'v3'});
      const rows=Array.isArray(res.rows)?res.rows:[];
      holder.innerHTML='<section class="n3-panel"><div class="n3-title">'+esc(res.title||mod.title)+'</div><div class="n3-desc">每個提醒可獨立設定 LINE / Email。逾期未審預設 1 天；打卡提前提醒預設 10 分鐘；未打卡提醒預設 30 分鐘，之後都可在這裡修改。</div><div class="n3-quick"><button type="button" data-sel="managerLineEnabled">主管 LINE 全選</button><button type="button" data-sel="managerEmailEnabled">主管 Email 全選</button><button type="button" data-sel="employeeLineEnabled">員工 LINE 全選</button><button type="button" data-sel="employeeEmailEnabled">員工 Email 全選</button><button type="button" data-clear>全部取消管道</button></div><div class="n3-list">'+rows.map(rowHtml).join('')+'</div><div class="n3-actions"><button type="button" data-save>儲存提醒設定</button><button class="secondary" type="button" data-reload>重新讀取</button><span class="n3-msg" data-msg></span></div></section>';
      holder.querySelectorAll('[data-sel]').forEach(function(btn){btn.onclick=function(){const f=btn.getAttribute('data-sel'); holder.querySelectorAll('[data-field="'+f+'"]').forEach(function(x){x.checked=true;});};});
      const clear=holder.querySelector('[data-clear]'); if(clear) clear.onclick=function(){holder.querySelectorAll('.n3-grid input').forEach(function(x){x.checked=false;});};
      const reload=holder.querySelector('[data-reload]'); if(reload) reload.onclick=function(){renderOne(holder,mod);};
      const save=holder.querySelector('[data-save]'); if(save) save.onclick=async function(){
        const msg=holder.querySelector('[data-msg]');
        try{
          if(msg){msg.textContent='儲存中…'; msg.classList.remove('err');}
          const next=Array.from(holder.querySelectorAll('.n3-row')).map(function(row,idx){
            const base=Object.assign({}, rows[idx]||{}); base.moduleKey=mod.key; base.eventKey=row.getAttribute('data-event')||base.eventKey;
            ['enabled','managerLineEnabled','managerEmailEnabled','employeeLineEnabled','employeeEmailEnabled'].forEach(function(k){const el=row.querySelector('[data-field="'+k+'"]'); base[k]=!!(el&&el.checked);});
            getExtraFields(base).forEach(function(k){const el=row.querySelector('[data-field="'+k+'"]'); if(el) base[k]=Number(el.value||0)||0;});
            return base;
          });
          const rr=await apiCall('saveNotificationV2Settings',{moduleKey:mod.key,rows:next,version:'v3'});
          if(!rr || rr.ok===false) throw new Error((rr&&rr.message)||'儲存失敗');
          if(msg) msg.textContent=rr.message||'已儲存。';
        }catch(e){if(msg){msg.textContent=e.message||'儲存失敗'; msg.classList.add('err');}}
      };
    }catch(e){holder.innerHTML='<section class="n3-panel"><div class="n3-title">'+esc(mod.title)+'</div><div class="n3-msg err">讀取失敗：'+esc(e.message||e)+'</div></section>';}
  }
  function render(){
    if(!isManagerLikely()) return;
    const mods=modulesForPage(); if(!mods.length) return;
    style();
    const old=document.getElementById('notificationV2FinalPanel'); if(old) old.remove();
    let box=document.getElementById('notificationV3Panel');
    if(!box){box=document.createElement('div'); box.id='notificationV3Panel'; const target=document.querySelector('.container:last-of-type') || document.querySelector('main') || document.body; target.appendChild(box);}
    box.innerHTML='';
    mods.forEach(function(mod){const h=document.createElement('div'); h.setAttribute('data-n3-module',mod.key); box.appendChild(h); renderOne(h,mod);});
  }
  function boot(){setTimeout(render,900); setTimeout(render,1800);}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();

/*****************************************************************
 * Manual LINE / Email notification final hard fix 20260531
 * - Only show for logged-in managers, never on login page.
 * - Rebuilds the floating manual notification modal with category drill-down.
 * - Category cards: 工讀生 / 專職員工 / 外聘老師 -> click to show people.
 *****************************************************************/
(function(){
  if(window.__manualNotifyFinalHardFix20260531) return;
  window.__manualNotifyFinalHardFix20260531 = true;

  function clean(v){return String(v==null?'':v).trim();}
  function lower(v){return clean(v).toLowerCase();}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function pathName(){return String((location&&location.pathname)||'').split('/').pop().toLowerCase() || 'index.html';}
  function user(){try{return typeof getUser==='function'?getUser():JSON.parse(localStorage.getItem('employeeUser')||'null');}catch(e){return null;}}
  function isAdminUser(){const u=user(); return !!(u && (u.showSettingsZone || lower(u.role)==='admin' || lower(u.role)==='manager' || lower(u.role)==='主管' || lower(u.role)==='管理者'));}
  function isLoginPage(){const p=pathName(); return !p || p==='index.html' || p==='login.html' || p==='register.html';}
  function removeManual(){
    ['notificationV2FinalFab','notificationV2FinalModal'].forEach(function(id){const el=document.getElementById(id); if(el) el.remove();});
  }
  function truthy(v){const s=lower(v); return v===true || v===1 || s==='1' || s==='true' || s==='yes' || s==='是' || s==='on';}
  function apiCall(action,payload){
    if(typeof api==='function') return api(action,payload||{});
    if(window.YZFirebase && typeof window.YZFirebase.handleApi==='function') return window.YZFirebase.handleApi(action,payload||{});
    return Promise.reject(new Error('通知系統尚未載入完成'));
  }
  function typeOfRecipient(x){
    const raw=lower(x.identityType||x['身分類型']||x.identityLabel||x.role||x.employeeType||x['員工身分']);
    if(raw.indexOf('工讀')>=0 || raw==='parttime' || raw==='pt' || truthy(x.isPartTime)||truthy(x['是否工讀生'])) return 'parttime';
    if(raw.indexOf('外聘')>=0 || raw==='external' || raw==='teacher' || raw==='contractor') return 'external';
    return 'staff';
  }
  function isHiddenOrInactive(x){
    const a=lower(x.accountStatus||x['帳號狀態']||'active');
    const e=lower(x.employmentStatus||x['任職狀態']||x['在職狀態']||'active');
    const h=x.hiddenFromActiveLists===true || truthy(x.hiddenFromActiveLists)||truthy(x['隱藏於日常清單'])||truthy(x['是否隱藏']);
    return h || ['inactive','rejected','pending','archived','disabled','停用','駁回','待審核','封存'].indexOf(a)>=0 || ['resigned','suspended','archived','contractorended','離職','暫停任用','封存','合作結束','外聘合作結束'].indexOf(e)>=0;
  }
  function installStyle(){
    if(document.getElementById('manualNotifyFinalHardStyle')) return;
    const s=document.createElement('style');
    s.id='manualNotifyFinalHardStyle';
    s.textContent=`
      .n2-fab{position:fixed;right:18px;bottom:18px;z-index:9998;border:0;border-radius:999px;background:#1f7a5a;color:#fff;padding:13px 18px;font-weight:950;box-shadow:0 12px 28px rgba(15,23,42,.22);cursor:pointer}
      .n2-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:none;align-items:center;justify-content:center;padding:18px}.n2-backdrop.show{display:flex}
      .n2-modal{width:min(640px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:24px;padding:18px;box-shadow:0 24px 80px rgba(15,23,42,.28);font-family:Arial,'Noto Sans TC',sans-serif;color:#18314a}
      .n2-modal-head,.n2-modal-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.n2-modal-title{font-size:22px;font-weight:950}.n2-small{display:block;color:#64748b;font-size:12px;line-height:1.55;margin-top:3px}.n2-field{margin-top:14px}.n2-field>label{display:block;font-weight:950;margin-bottom:6px}.n2-field input[type='text'],.n2-field textarea,.n2-field input[data-search]{width:100%;box-sizing:border-box;border:1px solid #d7e1ec;border-radius:14px;padding:12px;font-size:14px}.n2-field textarea{min-height:96px;resize:vertical}
      .n2-secondary,.n2-send{border:0;border-radius:14px;padding:11px 14px;font-weight:950;cursor:pointer}.n2-secondary{background:#eef2f6;color:#18314a}.n2-send{background:#1f7a5a;color:#fff;min-width:150px}.n2-channels{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.n2-channels label{font-weight:950}.n2-channels input{width:18px;height:18px;accent-color:#1f7a5a}.n2-status{font-size:13px;font-weight:950;color:#1f7a5a;margin-top:10px}.n2-status.err{color:#b42318}
      .n2-recips{border:1px solid #e2e8f0;background:#f8fafc;border-radius:16px;padding:10px;max-height:240px;overflow:auto}.n2-cat-grid{display:grid;gap:10px}.n2-cat-card{width:100%;border:1px solid #dbe5f1;background:#fff;border-radius:16px;padding:14px;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:950;color:#18314a}.n2-cat-card:hover{background:#f1f8f4;border-color:#b7dcc5}.n2-cat-title{font-size:16px}.n2-cat-sub{display:block;color:#64748b;font-size:12px;font-weight:750;margin-top:3px}.n2-cat-arrow{font-size:24px;color:#1f7a5a}.n2-recip-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}.n2-recip-title{font-size:16px;font-weight:950}.n2-back{border:0;border-radius:999px;background:#eef2f6;color:#18314a;padding:8px 11px;font-weight:950;cursor:pointer}.n2-select-tools{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.n2-select-tools button{border:1px solid #bbdfca;background:#eef7f0;color:#1f7a5a;border-radius:999px;padding:7px 10px;font-weight:900;cursor:pointer;font-size:12px}.n2-recips label{display:flex;align-items:flex-start;gap:9px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:9px;margin:7px 0;font-weight:900}.n2-recips input[type='checkbox']{width:18px;height:18px;accent-color:#1f7a5a;flex:0 0 auto;margin-top:2px}
      @media(max-width:520px){.n2-modal{padding:14px;border-radius:20px}.n2-modal-head,.n2-modal-actions{align-items:stretch}.n2-modal-actions{display:grid}.n2-fab{right:12px;bottom:12px}}
    `;
    document.head.appendChild(s);
  }
  function build(){
    if(isLoginPage() || !isAdminUser()){
      removeManual();
      return;
    }
    removeManual();
    installStyle();
    const btn=document.createElement('button'); btn.id='notificationV2FinalFab'; btn.className='n2-fab'; btn.type='button'; btn.textContent='LINE / Email'; document.body.appendChild(btn);
    const modal=document.createElement('div'); modal.id='notificationV2FinalModal'; modal.className='n2-backdrop';
    modal.innerHTML='<div class="n2-modal"><div class="n2-modal-head"><div><div class="n2-modal-title">LINE / Email 手動通知</div><span class="n2-small">主管臨時傳訊息用。先選工讀生、專職員工或外聘老師，再勾選收件人。</span></div><button class="n2-secondary" type="button" data-close>關閉</button></div><div class="n2-field"><label>搜尋收件人</label><input data-search placeholder="請先選擇收件人類別" disabled></div><div class="n2-field"><label>收件人類別 / 收件人</label><div class="n2-recips" data-recip>讀取中…</div></div><div class="n2-field"><label>發送方式</label><div class="n2-channels"><label><input type="checkbox" value="line" checked> LINE</label><label><input type="checkbox" value="email"> Email</label></div></div><div class="n2-field"><label>訊息內容</label><textarea data-message placeholder="輸入要發送的文字"></textarea></div><div class="n2-modal-actions"><button class="n2-send" type="button" data-send>送出通知</button><button class="n2-secondary" type="button" data-cancel>取消</button></div><div class="n2-status" data-status></div></div>';
    document.body.appendChild(modal);
    const categories=[{key:'parttime',title:'工讀生',hint:'點進去選擇工讀生收件人'},{key:'staff',title:'專職員工',hint:'點進去選擇專職員工收件人'},{key:'external',title:'外聘老師',hint:'點進去選擇外聘老師收件人'}];
    let all=[], current=[], selected='', timer=null;
    const wrap=modal.querySelector('[data-recip]'), search=modal.querySelector('[data-search]');
    function status(t,err){const el=modal.querySelector('[data-status]'); el.textContent=t||''; el.className='n2-status'+(err?' err':'');}
    function title(cat){const c=categories.find(x=>x.key===cat); return c?c.title:'收件人';}
    function rows(cat){return all.filter(x=>typeOfRecipient(x)===cat && !isHiddenOrInactive(x));}
    function renderHome(){
      selected=''; current=[]; search.value=''; search.disabled=true; search.placeholder='請先選擇收件人類別';
      wrap.innerHTML='<div class="n2-cat-grid">'+categories.map(function(c){const count=rows(c.key).length; return '<button type="button" class="n2-cat-card" data-manual-cat="'+esc(c.key)+'"><span><span class="n2-cat-title">'+esc(c.title)+'</span><span class="n2-cat-sub">'+esc(c.hint)+'｜目前可通知名單 '+count+' 人</span></span><span class="n2-cat-arrow">›</span></button>';}).join('')+'</div>';
    }
    function renderPeople(keyword){
      const k=lower(keyword||''), src=rows(selected);
      current=src.filter(function(x){if(!k) return true; return [x.name,x.employeeName,x.employeeId,x.id,x.email,x.identityLabel].join(' ').toLowerCase().indexOf(k)>=0;});
      wrap.innerHTML='<div class="n2-recip-head"><button type="button" class="n2-back" data-back>← 返回類別</button><div class="n2-recip-title">'+esc(title(selected))+'</div></div><div class="n2-select-tools"><button type="button" data-select-all>全選本頁</button><button type="button" data-clear-all>取消全選</button></div>'+(current.length?current.map(function(x,i){const lineState=(x.lineUserId||x['LINE User ID'])?((x.lineNotifyEnabled!==false && !/否|false|0/i.test(String(x.lineNotifyEnabled||x['LINE 通知啟用']||'')))?'LINE 可通知':'LINE 已綁定但通知關閉'):'LINE 未綁定'; const mail=(x.email||x.Email)?'Email 可通知':'無 Email'; return '<label><input type="checkbox" value="'+i+'"><span>'+esc(x.name||x.employeeName||x['姓名']||'未命名')+'<span class="n2-small">'+esc(x.email||x.Email||x.employeeId||x.id||'')+'｜'+esc(lineState)+'｜'+esc(mail)+'</span></span></label>';}).join(''):'沒有符合的收件人');
    }
    function openCat(cat){selected=cat; search.disabled=false; search.value=''; search.placeholder='搜尋 '+title(cat)+' 姓名、Email、員工ID'; renderPeople('');}
    wrap.addEventListener('click',function(ev){
      const cat=ev.target.closest && ev.target.closest('[data-manual-cat]');
      if(cat){ev.preventDefault(); openCat(cat.getAttribute('data-manual-cat')); return;}
      const back=ev.target.closest && ev.target.closest('[data-back]');
      if(back){ev.preventDefault(); renderHome(); return;}
      const sel=ev.target.closest && ev.target.closest('[data-select-all]');
      if(sel){ev.preventDefault(); wrap.querySelectorAll('input[type="checkbox"]').forEach(x=>x.checked=true); return;}
      const clr=ev.target.closest && ev.target.closest('[data-clear-all]');
      if(clr){ev.preventDefault(); wrap.querySelectorAll('input[type="checkbox"]').forEach(x=>x.checked=false); return;}
    });
    async function load(){wrap.textContent='讀取中…'; try{const r=await apiCall('getNotificationRecipientsV2',{keyword:'',statusMode:'active'}); all=Array.isArray(r&&r.rows)?r.rows:[]; renderHome();}catch(e){wrap.textContent='讀取收件人失敗：'+(e.message||e);}}
    function open(){if(!isAdminUser()||isLoginPage()){removeManual();return;} modal.classList.add('show'); status(''); load();}
    function close(){modal.classList.remove('show');}
    btn.addEventListener('click',open); modal.querySelector('[data-close]').addEventListener('click',close); modal.querySelector('[data-cancel]').addEventListener('click',close); modal.addEventListener('click',function(e){if(e.target===modal) close();});
    search.addEventListener('input',function(e){clearTimeout(timer); timer=setTimeout(function(){if(selected) renderPeople(e.target.value);},160);});
    modal.querySelector('[data-send]').addEventListener('click',async function(){
      try{status(''); if(!selected) throw new Error('請先選擇工讀生、專職員工或外聘老師。'); const idxs=Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked')).map(x=>Number(x.value)); const targets=idxs.map(i=>current[i]).filter(Boolean); const channels=Array.from(modal.querySelectorAll('.n2-channels input:checked')).map(x=>x.value); const message=clean(modal.querySelector('[data-message]').value); if(!targets.length) throw new Error('請選擇收件人。'); if(!channels.length) throw new Error('請至少選擇 LINE 或 Email。'); if(!message) throw new Error('請輸入訊息內容。'); status('建立發送佇列中…'); const r=await apiCall('sendManualNotificationV2',{targets,channels,message,page:pathName(),recipientCategory:selected}); if(!r||r.ok===false) throw new Error((r&&r.message)||'送出失敗'); status(r.message||'已建立發送佇列。'); modal.querySelector('[data-message]').value='';}catch(e){status(e.message||'送出失敗',true);}
    });
  }
  function boot(){setTimeout(build,1200); setTimeout(function(){if(isLoginPage()||!isAdminUser()) removeManual();},2600);}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();

/*****************************************************************
 * 2026-05-31 手動通知修正：改成三分類切換名單，不再使用第二層點進去。
 * - 第一層固定顯示三個切換按鈕：工讀生 / 專職員工 / 外聘老師
 * - 下方直接顯示該分類人員，可直接勾選
 * - 預設只在管理者登入後、非登入頁顯示
 * - 會排除離職、停用、封存、隱藏、待審核、駁回人員
 *****************************************************************/
(function(){
  if(window.__manualNotifyTabsStable20260531) return;
  window.__manualNotifyTabsStable20260531 = true;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function low(v){ return clean(v).toLowerCase(); }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function truthy(v){ var s=low(v); return v===true || v===1 || s==='1' || s==='true' || s==='yes' || s==='是' || s==='on'; }
  function pageName(){ return String((location && location.pathname) || '').split('/').pop().toLowerCase() || 'index.html'; }
  function getCurrentUser(){
    try{
      if(typeof getUser === 'function') return getUser();
      return JSON.parse(localStorage.getItem('employeeUser') || localStorage.getItem('user') || 'null');
    }catch(e){ return null; }
  }
  function isLoginPage(){ var p=pageName(); return !p || p==='index.html' || p==='login.html' || p==='register.html'; }
  function isAdmin(){
    var u=getCurrentUser();
    if(!u) return false;
    var role=low(u.role || u['角色'] || u.userRole || '');
    return !!(u.showSettingsZone || u.isAdmin || role==='admin' || role==='manager' || role==='主管' || role==='管理者');
  }
  function apiCall(action,payload){
    if(typeof api === 'function') return api(action,payload||{});
    if(window.YZFirebase && typeof window.YZFirebase.handleApi === 'function') return window.YZFirebase.handleApi(action,payload||{});
    return Promise.reject(new Error('Firebase 通知 API 尚未載入完成'));
  }
  function typeOf(x){
    var raw=low(x.identityType || x['身分類型'] || x.identityLabel || x['身分'] || x.employeeType || x.role || '');
    if(raw.indexOf('工讀')>=0 || raw==='parttime' || raw==='pt' || truthy(x.isPartTime) || truthy(x['是否工讀生'])) return 'parttime';
    if(raw.indexOf('外聘')>=0 || raw==='external' || raw==='teacher' || raw==='contractor') return 'external';
    return 'staff';
  }
  function isInactive(x){
    var a=low(x.accountStatus || x['帳號狀態'] || 'active');
    var e=low(x.employmentStatus || x['任職狀態'] || x['在職狀態'] || 'active');
    var h=truthy(x.hiddenFromActiveLists) || truthy(x['隱藏於日常清單']) || truthy(x['是否隱藏']);
    return h || ['inactive','disabled','rejected','pending','archived','停用','駁回','待審核','封存'].indexOf(a)>=0 || ['resigned','suspended','archived','contractorended','離職','暫停任用','封存','合作結束','外聘合作結束'].indexOf(e)>=0;
  }
  function displayName(x){ return clean(x.name || x.employeeName || x['姓名'] || x.teacherName || x['老師姓名'] || x.employeeId || x.id || '未命名'); }
  function employeeId(x){ return clean(x.employeeId || x.id || x.userId || x['員工ID'] || x.email || x.Email || displayName(x)); }
  function emailOf(x){ return clean(x.email || x.Email || x['Email']); }
  function lineOf(x){ return clean(x.lineUserId || x['LINE User ID'] || x.lineId); }
  function lineEnabled(x){
    var v = x.lineNotifyEnabled;
    if(v == null) v = x['LINE 通知啟用'];
    if(v == null || v === '') return !!lineOf(x);
    return truthy(v);
  }
  function removeOld(){
    ['notifyFloatingBtn','notifyManualModalBackdrop','notificationV2FinalFab','notificationV2FinalModal','manualNotifyTabsBtn','manualNotifyTabsModal'].forEach(function(id){ var el=document.getElementById(id); if(el) el.remove(); });
  }
  function installStyle(){
    if(document.getElementById('manualNotifyTabsStableStyle')) return;
    var s=document.createElement('style');
    s.id='manualNotifyTabsStableStyle';
    s.textContent=`
      .mn-fab{position:fixed;right:18px;bottom:18px;z-index:9998;border:0;border-radius:999px;background:#1f7a5a;color:#fff;padding:13px 18px;font-weight:950;box-shadow:0 12px 28px rgba(15,23,42,.22);cursor:pointer}
      .mn-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:none;align-items:center;justify-content:center;padding:18px}.mn-backdrop.show{display:flex}
      .mn-modal{width:min(650px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:24px;padding:18px;box-shadow:0 24px 80px rgba(15,23,42,.28);font-family:Arial,'Noto Sans TC',sans-serif;color:#18314a}
      .mn-head,.mn-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.mn-title{font-size:22px;font-weight:950}.mn-small{display:block;color:#64748b;font-size:12px;line-height:1.55;margin-top:3px}.mn-field{margin-top:14px}.mn-field>label{display:block;font-weight:950;margin-bottom:6px}.mn-field input[type='text'],.mn-field textarea{width:100%;box-sizing:border-box;border:1px solid #d7e1ec;border-radius:14px;padding:12px;font-size:14px}.mn-field textarea{min-height:96px;resize:vertical}
      .mn-close,.mn-secondary,.mn-send{border:0;border-radius:14px;padding:11px 14px;font-weight:950;cursor:pointer}.mn-close,.mn-secondary{background:#eef2f6;color:#18314a}.mn-send{background:#1f7a5a;color:#fff;min-width:150px}.mn-status{font-size:13px;font-weight:950;color:#1f7a5a;margin-top:10px}.mn-status.err{color:#b42318}
      .mn-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.mn-tab{border:1px solid #dbe5f1;background:#fff;border-radius:16px;padding:11px 9px;font-weight:950;color:#18314a;cursor:pointer}.mn-tab.active{background:#1f7a5a;color:#fff;border-color:#1f7a5a}.mn-tab small{display:block;font-size:11px;font-weight:800;margin-top:4px;opacity:.78}
      .mn-list{border:1px solid #e2e8f0;background:#f8fafc;border-radius:16px;padding:10px;max-height:250px;overflow:auto}.mn-list label{display:flex;align-items:flex-start;gap:9px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:9px;margin:7px 0;font-weight:900}.mn-list input[type='checkbox']{width:18px;height:18px;accent-color:#1f7a5a;flex:0 0 auto;margin-top:2px}.mn-tools{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.mn-tools button{border:1px solid #bbdfca;background:#eef7f0;color:#1f7a5a;border-radius:999px;padding:7px 10px;font-weight:900;cursor:pointer;font-size:12px}.mn-channels{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.mn-channels label{font-weight:950}.mn-channels input{width:18px;height:18px;accent-color:#1f7a5a}.mn-muted{color:#64748b;font-weight:800;line-height:1.6;padding:8px}
      @media(max-width:520px){.mn-modal{padding:14px;border-radius:20px}.mn-tabs{grid-template-columns:1fr}.mn-actions{display:grid}.mn-fab{right:12px;bottom:12px}}
    `;
    document.head.appendChild(s);
  }
  function build(){
    removeOld();
    if(isLoginPage() || !isAdmin()) return;
    installStyle();
    var btn=document.createElement('button');
    btn.id='manualNotifyTabsBtn'; btn.type='button'; btn.className='mn-fab'; btn.textContent='LINE / Email';
    document.body.appendChild(btn);
    var modal=document.createElement('div');
    modal.id='manualNotifyTabsModal'; modal.className='mn-backdrop';
    modal.innerHTML=`<div class="mn-modal"><div class="mn-head"><div><div class="mn-title">LINE / Email 手動通知</div><span class="mn-small">主管臨時發訊息用。先用三個分類切換名單，再直接勾選收件人。</span></div><button class="mn-close" type="button" data-close>關閉</button></div><div class="mn-field"><label>收件人分類</label><div class="mn-tabs" data-tabs></div></div><div class="mn-field"><label>搜尋收件人</label><input type="text" data-search placeholder="搜尋目前分類的姓名、Email、員工ID"></div><div class="mn-field"><label>收件人</label><div class="mn-tools"><button type="button" data-select>全選目前名單</button><button type="button" data-clear>取消全選</button></div><div class="mn-list" data-list>讀取中…</div></div><div class="mn-field"><label>發送方式</label><div class="mn-channels"><label><input type="checkbox" value="line" checked> LINE</label><label><input type="checkbox" value="email"> Email</label></div></div><div class="mn-field"><label>訊息內容</label><textarea data-message placeholder="輸入要發送的文字"></textarea></div><div class="mn-actions"><button class="mn-send" type="button" data-send>送出通知</button><button class="mn-secondary" type="button" data-cancel>取消</button></div><div class="mn-status" data-status></div></div>`;
    document.body.appendChild(modal);

    var categories=[{key:'parttime',title:'工讀生'},{key:'staff',title:'專職員工'},{key:'external',title:'外聘老師'}];
    var all=[], current=[], active='parttime', timer=null;
    var tabs=modal.querySelector('[data-tabs]'), list=modal.querySelector('[data-list]'), search=modal.querySelector('[data-search]'), stat=modal.querySelector('[data-status]');
    function setStatus(t,err){stat.textContent=t||''; stat.className='mn-status'+(err?' err':'');}
    function rowsFor(cat){ return all.filter(function(x){ return typeOf(x)===cat && !isInactive(x); }); }
    function renderTabs(){
      tabs.innerHTML=categories.map(function(c){return '<button type="button" class="mn-tab '+(active===c.key?'active':'')+'" data-cat="'+esc(c.key)+'">'+esc(c.title)+'<small>'+rowsFor(c.key).length+' 人</small></button>';}).join('');
    }
    function renderList(){
      var kw=low(search.value), base=rowsFor(active);
      current=base.filter(function(x){ if(!kw) return true; return [displayName(x), employeeId(x), emailOf(x), x.identityLabel, x['身分類型']].join(' ').toLowerCase().indexOf(kw)>=0; });
      if(!current.length){ list.innerHTML='<div class="mn-muted">目前分類沒有可通知收件人。</div>'; return; }
      list.innerHTML=current.map(function(x,i){
        var lineState=lineOf(x) ? (lineEnabled(x)?'LINE 可通知':'LINE 通知關閉') : 'LINE 未綁定';
        var mail=emailOf(x) ? 'Email 可通知' : '無 Email';
        return '<label><input type="checkbox" value="'+i+'"><span>'+esc(displayName(x))+'<span class="mn-small">'+esc(emailOf(x)||employeeId(x))+'｜'+esc(lineState)+'｜'+esc(mail)+'</span></span></label>';
      }).join('');
    }
    function renderAll(){ renderTabs(); renderList(); }
    async function load(){
      list.innerHTML='<div class="mn-muted">讀取中…</div>';
      try{
        var r;
        try{ r=await apiCall('getNotificationRecipientsV2',{keyword:'',statusMode:'active'}); }
        catch(e){ r=await apiCall('getEmployeeRecipients',{}); }
        all=Array.isArray(r&&r.rows)?r.rows:(Array.isArray(r&&r.list)?r.list:[]);
        renderAll();
      }catch(e){ list.innerHTML='<div class="mn-muted">讀取收件人失敗：'+esc(e.message||e)+'</div>'; }
    }
    function open(){ if(isLoginPage() || !isAdmin()){ removeOld(); return; } modal.classList.add('show'); setStatus(''); load(); }
    function close(){ modal.classList.remove('show'); }
    btn.addEventListener('click',open);
    modal.querySelector('[data-close]').addEventListener('click',close);
    modal.querySelector('[data-cancel]').addEventListener('click',close);
    modal.addEventListener('click',function(e){ if(e.target===modal) close(); });
    tabs.addEventListener('click',function(e){ var b=e.target.closest && e.target.closest('[data-cat]'); if(!b) return; active=b.getAttribute('data-cat'); search.value=''; renderAll(); });
    search.addEventListener('input',function(){ clearTimeout(timer); timer=setTimeout(renderList,120); });
    modal.querySelector('[data-select]').addEventListener('click',function(){ list.querySelectorAll('input[type="checkbox"]').forEach(function(x){ x.checked=true; }); });
    modal.querySelector('[data-clear]').addEventListener('click',function(){ list.querySelectorAll('input[type="checkbox"]').forEach(function(x){ x.checked=false; }); });
    modal.querySelector('[data-send]').addEventListener('click',async function(){
      try{
        setStatus('');
        var idxs=Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(function(x){return Number(x.value);});
        var targets=idxs.map(function(i){return current[i];}).filter(Boolean);
        var channels=Array.from(modal.querySelectorAll('.mn-channels input:checked')).map(function(x){return x.value;});
        var message=clean(modal.querySelector('[data-message]').value);
        if(!targets.length) throw new Error('請選擇收件人。');
        if(!channels.length) throw new Error('請至少選擇 LINE 或 Email。');
        if(!message) throw new Error('請輸入訊息內容。');
        setStatus('建立發送佇列中…');
        var r;
        try{ r=await apiCall('sendManualNotificationV2',{targets:targets,channels:channels,message:message,page:pageName(),recipientCategory:active}); }
        catch(e){ r=await apiCall('queueManualNotification',{targets:targets,channels:channels,message:message,page:pageName(),recipientCategory:active}); }
        if(!r || r.ok===false) throw new Error((r&&r.message)||'送出失敗');
        setStatus((r&&r.message)||'已建立發送佇列。');
        modal.querySelector('[data-message]').value='';
      }catch(e){ setStatus(e.message||String(e), true); }
    });
  }
  function boot(){ setTimeout(build,1800); setTimeout(build,3200); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
