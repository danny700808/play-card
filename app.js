
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
function canUseFeature(feature,user=getUser()){const type=identityTypeOf(user); if(!user) return false; if(feature==='dashboard') return type!=='external'; if(feature==='clock') return type==='staff' || type==='parttime'; if(feature==='parttime') return type==='parttime'; if(feature==='leave') return type==='staff' || type==='parttime'; if(feature==='routine') return type==='staff' || type==='parttime'; if(feature==='training') return type==='staff' || type==='parttime'; if(feature==='task') return true; if(feature==='contract') return type==='external'; if(feature==='contractAdmin') return !!(user && (user.showSettingsZone || String(user.role||'').toLowerCase()==='admin')); return true;}
function guardFeatureAccess(feature,user=getUser()){if(canUseFeature(feature,user)) return true; location.href=isExternalTeacher(user)?'teacher-home.html':'dashboard.html'; return false;}
function isSettingsMode(){return hasSettingsZoneAccess() && getPortalMode()==='settings'}
function modeHomeHref(){return isSettingsMode() ? 'settings.html' : 'dashboard.html'}
function settingsHomeHref(){return 'settings.html'}
function staffHomeHref(){return 'dashboard.html'}
function teacherHomeHref(){return 'teacher-home.html'}
function userHomeHref(user=getUser()){if(isExternalTeacher(user)) return teacherHomeHref(); return isManager(user)&&isSettingsMode() ? settingsHomeHref() : staffHomeHref()}
function userHomeLabel(user=getUser()){if(isExternalTeacher(user)) return '返回老師首頁'; return isManager(user)&&isSettingsMode() ? '返回管理首頁' : '返回員工首頁'}
function userHomeHeading(user=getUser()){
  if(isExternalTeacher(user)) return '外聘老師首頁';
  if(isPartTimeUser(user)) return '工讀首頁';
  if(isManager(user)&&isSettingsMode()) return '管理首頁';
  return '員工首頁';
}
function applyCurrentHomeTitle_(user=getUser()){
  if(!user) return;
  const path=String((location&&location.pathname)||'').split('/').pop().toLowerCase();
  const titleText=userHomeHeading(user);
  if(path==='dashboard.html'){
    const el=document.querySelector('.header .title');
    if(el) el.textContent=titleText;
    document.title=titleText;
    return;
  }
  if(path==='teacher-home.html'){
    const el=document.querySelector('.hero h1');
    if(el) el.textContent=titleText;
    document.title=titleText;
    return;
  }
  if(path==='settings.html'){
    const el=document.querySelector('.header .title');
    if(el) el.textContent=titleText;
    document.title=titleText;
  }
}
function portalSwitchLabel(user=getUser()){return hasSettingsZoneAccess(user) ? '切換入口' : '系統入口'}
function getUser(){try{return JSON.parse(localStorage.getItem('employeeUser')||'null')}catch(e){return null}}
function getApiUrl(){return API_URL}
function logout(){localStorage.removeItem('employeeUser'); localStorage.removeItem('employeeUserId'); clearPortalMode(); location.href='index.html'}
function currentFeatureKey(){const path=String((location&&location.pathname)||'').split('/').pop().toLowerCase(); if(path==='dashboard.html') return 'dashboard'; if(path==='clock.html') return 'clock'; if(path==='parttime.html') return 'parttime'; if(path==='leave.html') return 'leave'; if(path==='task.html') return 'task'; if(path==='routine.html') return 'routine'; if(path==='training.html') return 'training'; if(path==='contract.html') return 'contract'; if(path==='contract-admin.html') return 'contractAdmin'; if(path==='settings.html') return 'settings'; return '';}
function requireLogin(){const user=getUser(); if(!user){location.href='index.html'; return null;} const feature=currentFeatureKey(); if(feature==='contract' && !isExternalTeacher(user)){location.href='dashboard.html'; return null;} if(feature==='contractAdmin' && !isManager(user)){location.href='dashboard.html'; return null;} if(feature && feature!=='contract' && feature!=='contractAdmin' && feature!=='settings' && !guardFeatureAccess(feature,user)) return null; try{applyCurrentHomeTitle_(user);}catch(e){} return user;}
async function api(action, payload={}){
  const apiUrl=getApiUrl();
  if(!apiUrl) throw new Error('尚未設定 API 網址');
  const res=await fetch(apiUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...payload})});
  const raw=await res.text();
  try{return JSON.parse(raw);}catch(e){throw new Error(raw || '伺服器回傳格式錯誤');}
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
  .line-bind-mini{margin-top:12px;padding:12px 14px;border:1px solid #d9e2ef;border-radius:22px;background:#ffffff;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;box-shadow:0 8px 20px rgba(25,46,89,.04)}
  .line-bind-mini-left{min-width:0;display:flex;flex-direction:column;gap:4px;flex:1 1 220px}
  .line-bind-mini-title{font-size:14px;font-weight:900;color:#18314a;letter-spacing:.02em}
  .line-bind-mini-status{font-size:15px;font-weight:800;color:#5f7086;line-height:1.5}
  .line-bind-mini-status .on{color:#1f7a5a}
  .line-bind-mini-status .off{color:#9b7b11}
  .line-bind-mini-status .none{color:#70829a}
  .line-bind-mini-hint{font-size:12px;color:#8090a3;line-height:1.5}
  .line-bind-mini-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;flex:0 1 auto}
  .line-bind-mini .btn{width:auto;padding:10px 14px;border-radius:16px;font-size:14px;line-height:1.2;min-height:auto}
  .line-bind-mini .btn.secondary{background:#eef2f7;color:#25374d}
  @media (max-width:560px){
    .line-bind-mini{padding:10px 12px;border-radius:18px;gap:10px}
    .line-bind-mini-title{font-size:13px}
    .line-bind-mini-status{font-size:14px}
    .line-bind-mini-actions{width:100%;justify-content:flex-start}
    .line-bind-mini .btn{padding:10px 12px;font-size:13px}
  }
  `;
  document.head.appendChild(s);
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
  const existing=document.getElementById('lineBindPromptCard');
  if(existing) existing.remove();
  const target=(typeof targetSelector==='string' && document.querySelector(targetSelector))
    || document.getElementById('lineBindArea')
    || document.querySelector('.page')
    || document.querySelector('.container');
  if(!target) return;
  ensureLineBindPromptStyle_();
  const links=await getPublicSystemLinksCached();
  const wrap=document.createElement('div');
  wrap.className='line-bind-mini';
  wrap.id='lineBindPromptCard';
  const email=String(user.email||'').trim();
  const cmd=`柚子綁定 ${email}`;
  const hasLineId=!!String(user.lineUserId||'').trim();
  const notifyOn=String(user.lineNotifyEnabled||'').trim()==='是' || user.lineNotifyEnabled===true;

  let statusHtml='';
  let hint='';
  let actionsHtml='';

  if(!hasLineId){
    statusHtml='<span class="none">尚未綁定</span>';
    hint='加入官方 LINE 後貼上綁定文字即可，不會再跳出大提示。';
    actionsHtml=`
      ${links.lineAddFriendUrl ? `<a class="btn" id="lineBindJoinBtn" href="${links.lineAddFriendUrl}" target="_blank" rel="noopener">前往綁定</a>` : ''}
      <button class="btn secondary" type="button" id="copyLineBindCmdBtn">複製綁定文字</button>
    `;
  }else if(notifyOn){
    statusHtml='已綁定｜<span class="on">提醒開啟</span>';
    hint='可直接關閉提醒，真的不要再收 LINE 時再解除綁定即可。';
    actionsHtml=`
      <button class="btn secondary" type="button" id="toggleLineNotifyBtn">取消提醒</button>
      <button class="btn secondary" type="button" id="unbindLineBtn">解除綁定</button>
    `;
  }else{
    statusHtml='已綁定｜<span class="off">提醒關閉</span>';
    hint='LINE 還是綁著，需要時可再開啟提醒，不用重新綁定。';
    actionsHtml=`
      <button class="btn" type="button" id="toggleLineNotifyBtn">開啟提醒</button>
      <button class="btn secondary" type="button" id="unbindLineBtn">解除綁定</button>
    `;
  }

  wrap.innerHTML=`
    <div class="line-bind-mini-left">
      <div class="line-bind-mini-title">LINE 通知設定</div>
      <div class="line-bind-mini-status">${statusHtml}</div>
      <div class="line-bind-mini-hint">${hint}</div>
    </div>
    <div class="line-bind-mini-actions">${actionsHtml}</div>
  `;
  target.appendChild(wrap);

  const copyBtn=wrap.querySelector('#copyLineBindCmdBtn');
  if(copyBtn){
    copyBtn.onclick=async()=>{
      try{
        await navigator.clipboard.writeText(cmd);
        copyBtn.textContent='已複製';
        setTimeout(()=>{ if(document.body.contains(copyBtn)) copyBtn.textContent='複製綁定文字'; },1600);
      }catch(e){
        alert('複製失敗，請手動複製：\n'+cmd);
      }
    };
  }

  const toggleBtn=wrap.querySelector('#toggleLineNotifyBtn');
  if(toggleBtn){
    toggleBtn.onclick=async()=>{
      const wantEnable=!notifyOn;
      const text=wantEnable ? '確定要開啟 LINE 提醒嗎？' : '確定要取消 LINE 提醒嗎？';
      if(!window.confirm(text)) return;
      try{
        toggleBtn.disabled=true;
        toggleBtn.textContent='處理中...';
        await setLineNotifyPreference_(wantEnable,false);
        await renderLineBindPrompt_(targetSelector);
      }catch(e){
        alert(e.message || '儲存失敗');
        toggleBtn.disabled=false;
        toggleBtn.textContent=wantEnable ? '開啟提醒' : '取消提醒';
      }
    };
  }

  const unbindBtn=wrap.querySelector('#unbindLineBtn');
  if(unbindBtn){
    unbindBtn.onclick=async()=>{
      if(!window.confirm('確定要解除 LINE 綁定嗎？解除後首頁仍會保留綁定入口。')) return;
      try{
        unbindBtn.disabled=true;
        unbindBtn.textContent='處理中...';
        await setLineNotifyPreference_(false,true);
        await renderLineBindPrompt_(targetSelector);
      }catch(e){
        alert(e.message || '解除綁定失敗');
        unbindBtn.disabled=false;
        unbindBtn.textContent='解除綁定';
      }
    };
  }
}

const __btnProgressMap=new WeakMap();
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
  const existing=__btnProgressMap.get(btn);
  if(existing&&existing.timer) clearInterval(existing.timer);
  __btnProgressMap.delete(btn);
}
function startActionButtonProgress(btn, options={}){
  const nodes=ensureActionButton(btn);
  const existing=__btnProgressMap.get(btn);
  if(existing&&existing.timer) clearInterval(existing.timer);
  const state={
    pct:Math.max(0,Math.min(100,Number(options.startPct!=null?options.startPct:8)||0)),
    maxPct:Math.max(0,Math.min(95,Number(options.maxPct!=null?options.maxPct:88)||88)),
    label:String(options.label||options.text||'處理中').trim()||'處理中',
    formatter:typeof options.formatter==='function'?options.formatter:null
  };
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
      if(state.pct>=state.maxPct) return;
      const step=state.pct<35?8:(state.pct<65?5:2);
      state.pct=Math.min(state.maxPct, state.pct+step);
      render();
    }, Number(options.interval||180));
  }
  __btnProgressMap.set(btn,{timer,state,nodes,render});
  return {
    button:btn,
    set(percent,label){
      if(label!=null) state.label=String(label||state.label);
      state.pct=Math.max(0,Math.min(100,Number(percent)||0));
      render();
    },
    done(text='已完成', holdMs=900, keepDisabled=false){
      const current=__btnProgressMap.get(btn); if(current&&current.timer) clearInterval(current.timer);
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
      const current=__btnProgressMap.get(btn); if(current&&current.timer) clearInterval(current.timer);
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

function fillHeader(){const user=requireLogin(); if(!user) return; const manager=isManager(user); qsa('[data-user-name]').forEach(el=>el.textContent=user.name||'員工'); qsa('[data-if-parttime]').forEach(el=>el.style.display=isPartTimeUser(user)?'':'none'); qsa('[data-if-admin]').forEach(el=>el.style.display=manager?'':'none'); qsa('[data-if-staff-view]').forEach(el=>el.style.display=manager?'none':''); setTimeout(()=>{renderLineBindPrompt_();},0);}
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
