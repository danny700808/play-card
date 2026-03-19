
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
    maxInputMB: 180,
    fallbackPassThroughMB: 80,
    maxWidth: 1280,
    fps: 24,
    videoBitsPerSecond: 1200000,
    audioBitsPerSecond: 96000
  }, opts||{});
  if(!file) return '';
  if(!file.type.startsWith('video/')) return await fileToDataUrl(file);
  const sizeMB=file.size/1024/1024;
  if(sizeMB>options.maxInputMB){
    throw new Error('影片檔太大，請先在手機修剪到 4 分鐘內或降低畫質後再上傳');
  }
  const canRecord=!!(window.MediaRecorder && document.createElement('canvas').captureStream);
  if(!canRecord){
    if(sizeMB<=options.fallbackPassThroughMB) return await fileToDataUrl(file);
    throw new Error('此裝置不支援影片自動壓縮，請先用手機修剪影片後再上傳');
  }
  const objectUrl=URL.createObjectURL(file);
  const video=document.createElement('video');
  video.preload='metadata';
  video.muted=false;
  video.volume=1;
  video.playsInline=true;
  video.src=objectUrl;
  await new Promise((resolve,reject)=>{
    video.onloadedmetadata=()=>resolve();
    video.onerror=()=>reject(new Error('讀取影片失敗'));
  });
  const srcW=video.videoWidth||1280, srcH=video.videoHeight||720;
  let targetW=srcW, targetH=srcH;
  if(targetW>options.maxWidth){
    targetH=Math.round(targetH*options.maxWidth/targetW);
    targetW=options.maxWidth;
  }
  if(targetW%2) targetW-=1;
  if(targetH%2) targetH-=1;
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(2,targetW);
  canvas.height=Math.max(2,targetH);
  const ctx=canvas.getContext('2d');
  const mimeCandidates=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  const mimeType=mimeCandidates.find(t=>MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  const stream=canvas.captureStream(options.fps);
  let audioStream=null, audioCtx=null, dest=null, source=null;
  try{
    if(video.captureStream){
      audioStream=video.captureStream();
    }else if(video.mozCaptureStream){
      audioStream=video.mozCaptureStream();
    }
  }catch(e){}
  if(audioStream && audioStream.getAudioTracks && audioStream.getAudioTracks().length && (window.AudioContext || window.webkitAudioContext)){
    const Ctx=window.AudioContext || window.webkitAudioContext;
    audioCtx=new Ctx();
    source=audioCtx.createMediaStreamSource(audioStream);
    dest=audioCtx.createMediaStreamDestination();
    source.connect(dest);
    dest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
  }
  const recorder=new MediaRecorder(stream, {
    mimeType: mimeType || undefined,
    videoBitsPerSecond: options.videoBitsPerSecond,
    audioBitsPerSecond: options.audioBitsPerSecond
  });
  const chunks=[];
  recorder.ondataavailable=e=>{ if(e.data && e.data.size) chunks.push(e.data); };
  const drawFrame=()=>{
    if(video.paused || video.ended) return;
    try{ ctx.drawImage(video,0,0,canvas.width,canvas.height); }catch(e){}
    requestAnimationFrame(drawFrame);
  };
  const donePromise=new Promise((resolve,reject)=>{
    recorder.onerror=()=>reject(new Error('影片壓縮失敗'));
    recorder.onstop=()=>{
      try{ source && source.disconnect(); }catch(e){}
      try{ dest && dest.disconnect && dest.disconnect(); }catch(e){}
      try{ audioCtx && audioCtx.close && audioCtx.close(); }catch(e){}
      const blob=new Blob(chunks,{type:recorder.mimeType || 'video/webm'});
      const fr=new FileReader();
      fr.onload=()=>resolve(String(fr.result||''));
      fr.onerror=()=>reject(new Error('影片轉檔失敗'));
      fr.readAsDataURL(blob);
    };
  });
  recorder.start(1000);
  try{ await video.play(); }catch(e){
    try{ video.muted=true; await video.play(); }catch(e2){
      URL.revokeObjectURL(objectUrl);
      if(sizeMB<=options.fallbackPassThroughMB) return await fileToDataUrl(file);
      throw new Error('影片播放失敗，請改用較短影片或稍後再試');
    }
  }
  drawFrame();
  await new Promise((resolve,reject)=>{
    video.onended=resolve;
    video.onerror=()=>reject(new Error('影片播放失敗'));
  });
  try{ recorder.stop(); }catch(e){}
  const result=await donePromise;
  URL.revokeObjectURL(objectUrl);
  return result || await fileToDataUrl(file);
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
