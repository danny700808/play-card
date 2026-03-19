
const API_URL = window.APP_CONFIG.API_URL;
function qs(s){return document.querySelector(s)}
function qsa(s){return Array.from(document.querySelectorAll(s))}
function saveUser(user){localStorage.setItem('employeeUser', JSON.stringify(user))}
function setPortalMode(mode){localStorage.setItem('employeePortalMode', mode==='settings'?'settings':'staff')}
function getPortalMode(){return localStorage.getItem('employeePortalMode')||'staff'}
function clearPortalMode(){localStorage.removeItem('employeePortalMode')}
function hasSettingsZoneAccess(user=getUser()){return !!(user && user.showSettingsZone)}
function isSettingsMode(){return hasSettingsZoneAccess() && getPortalMode()==='settings'}
function modeHomeHref(){return isSettingsMode() ? 'settings.html' : 'dashboard.html'}
function getUser(){try{return JSON.parse(localStorage.getItem('employeeUser')||'null')}catch(e){return null}}
function logout(){localStorage.removeItem('employeeUser'); clearPortalMode(); location.href='index.html'}
function requireLogin(){const user=getUser(); if(!user){location.href='index.html'; return null;} return user;}
async function api(action, payload={}){
  const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...payload})});
  const raw=await res.text();
  try{return JSON.parse(raw);}catch(e){throw new Error(raw || '伺服器回傳格式錯誤');}
}
function setMsg(el, text, isError=false){if(!el) return; el.style.display=text?'block':'none'; el.textContent=text||''; el.classList.toggle('error',!!isError)}
function togglePassword(inputSel, btn){const input=qs(inputSel); const show=input.type==='password'; input.type=show?'text':'password'; btn.textContent=show?'🙈':'👁';}
async function getPublicIp(){try{const r=await fetch('https://api.ipify.org?format=json'); const j=await r.json(); return j.ip||'';}catch(e){return '';}}
async function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader(); r.onload=()=>resolve(String(r.result||'')); r.onerror=reject; r.readAsDataURL(file);});}
function fillHeader(){const user=requireLogin(); if(!user) return; qsa('[data-user-name]').forEach(el=>el.textContent=user.name||'員工'); qsa('[data-if-parttime]').forEach(el=>el.style.display=user.isPartTime?'':'none'); qsa('[data-if-admin]').forEach(el=>el.style.display=user.role==='admin'?'':'none'); qsa('[data-if-staff-view]').forEach(el=>el.style.display=user.role==='admin'?'none':'');}
function redirectAfterLogin(user){saveUser(user); if(user && user.showSettingsZone){setPortalMode('staff'); location.href='portal.html'; return;} location.href = user.role==='admin' ? 'task.html' : 'dashboard.html';}
function saveLoginPref(email,password,remember=true){if(!remember){localStorage.removeItem('employeeSavedLogin');return;}localStorage.setItem('employeeSavedLogin',JSON.stringify({email:email||'',password:password||'',remember:true}));}
function getSavedLogin(){try{return JSON.parse(localStorage.getItem('employeeSavedLogin')||'null')}catch(e){return null}}
function applySavedLogin(emailSel='#email',passwordSel='#password',rememberSel='#rememberLogin'){const s=getSavedLogin();if(!s)return;const e=qs(emailSel),p=qs(passwordSel),r=qs(rememberSel);if(e)e.value=s.email||'';if(p)p.value=s.password||'';if(r)r.checked=!!s.remember;}
function getDriveFileId(url){
  const s=String(url||'').trim();
  const m=s.match(/(?:file\/d\/|[?&]id=|\/d\/)([-_a-zA-Z0-9]{20,})/);
  return m?m[1]:'';
}
function imagePreviewUrl(url){const id=getDriveFileId(url);return id?('https://drive.google.com/thumbnail?id='+id+'&sz=w1200'):url;}
function driveViewUrl(url){const id=getDriveFileId(url);return id?('https://drive.google.com/file/d/'+id+'/view?usp=drivesdk'):String(url||'');}
function drivePreviewUrl(url){const id=getDriveFileId(url);return id?('https://drive.google.com/file/d/'+id+'/preview'):String(url||'');}
function audioOpenUrl(url){return driveViewUrl(url);}
function audioStreamUrl(url){const id=getDriveFileId(url);return id?('https://drive.google.com/uc?export=download&id='+id):String(url||'');}
function openMediaInTopWindow(url){
  const finalUrl=driveViewUrl(url);
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
