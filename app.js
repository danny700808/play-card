const API_URL = window.APP_CONFIG.API_URL;
function qs(s){return document.querySelector(s)}
function qsa(s){return Array.from(document.querySelectorAll(s))}
function saveUser(user){localStorage.setItem('employeeUser', JSON.stringify(user))}
function getUser(){try{return JSON.parse(localStorage.getItem('employeeUser')||'null')}catch(e){return null}}
function logout(){localStorage.removeItem('employeeUser'); location.href='index.html'}
function requireLogin(){const user=getUser(); if(!user){location.href='index.html'; return null;} return user;}
async function api(action, payload={}){const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...payload})}); return res.json();}
function setMsg(el, text, isError=false){if(!el) return; el.style.display=text?'block':'none'; el.textContent=text||''; el.classList.toggle('error',!!isError)}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));}
function togglePassword(inputSel, btn){const input=qs(inputSel); const show=input.type==='password'; input.type=show?'text':'password'; btn.textContent=show?'🙈':'👁';}
async function getPublicIp(){try{const r=await fetch('https://api.ipify.org?format=json'); const j=await r.json(); return j.ip||'';}catch(e){return '';}}
async function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader(); r.onload=()=>resolve(String(r.result||'')); r.onerror=reject; r.readAsDataURL(file);});}
function fillHeader(){const user=requireLogin(); if(!user) return; qsa('[data-user-name]').forEach(el=>el.textContent=user.name||'員工'); qsa('[data-if-parttime]').forEach(el=>el.style.display=user.isPartTime?'':'none'); qsa('[data-if-admin]').forEach(el=>el.style.display=user.role==='admin'?'':'none'); qsa('[data-if-staff-view]').forEach(el=>el.style.display=user.role==='admin'?'none':'');}
function redirectAfterLogin(user){saveUser(user); location.href = user.role==='admin' ? 'task.html' : 'dashboard.html';}
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
async function compressFilesToDataUrls(files, onProgress){
  const list=Array.from(files||[]);
  const out=[];
  for(let i=0;i<list.length;i++){
    const file=list[i];
    const data=await compressImageToDataUrl(file, 1600, 0.8);
    out.push(data);
    if(onProgress) onProgress(i+1, list.length, file);
  }
  return out;
}
function formatTaskStatusTag(status){
  const cls=status==='待處理'?'pending':(status==='已完成'?'done':'');
  return `<span class="tag ${cls}">${status}</span>`;
}
function pickSupportedRecorderMime(){
  if(typeof MediaRecorder==='undefined') return '';
  const prefs=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus','audio/ogg'];
  for(const mt of prefs){
    try{ if(MediaRecorder.isTypeSupported(mt)) return mt; }catch(e){}
  }
  return '';
}
async function startRecorder(options={}){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){throw new Error('目前裝置或瀏覽器不支援錄音');}
  if(typeof MediaRecorder==='undefined'){throw new Error('目前瀏覽器不支援 MediaRecorder 錄音');}
  let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  }catch(err){
    if(err && (err.name==='NotAllowedError' || err.name==='SecurityError')) throw new Error('你目前沒有允許麥克風權限，請先開啟瀏覽器的麥克風權限');
    if(err && err.name==='NotFoundError') throw new Error('找不到可用的麥克風裝置');
    throw new Error('無法啟動錄音：' + (err.message || err.name || err));
  }

  const mimeType=pickSupportedRecorderMime();
  const rec=new MediaRecorder(stream, mimeType?{mimeType}:undefined);
  const chunks=[];
  let stopped=false;
  let audioContext=null;
  let analyser=null;
  let rafId=0;

  try{
    const AudioCtx=window.AudioContext || window.webkitAudioContext;
    if(AudioCtx){
      audioContext=new AudioCtx();
      const source=audioContext.createMediaStreamSource(stream);
      analyser=audioContext.createAnalyser();
      analyser.fftSize=256;
      source.connect(analyser);
      const data=new Uint8Array(analyser.frequencyBinCount);
      const loop=()=>{
        if(stopped) return;
        analyser.getByteFrequencyData(data);
        let sum=0;
        for(let i=0;i<data.length;i++) sum+=data[i];
        const level=Math.min(1, (sum/data.length)/110);
        if(options.onLevel) options.onLevel(level);
        rafId=requestAnimationFrame(loop);
      };
      loop();
    }
  }catch(e){
    if(options.onLevel) options.onLevel(0.2);
  }

  rec.ondataavailable=e=>{if(e.data && e.data.size) chunks.push(e.data);};
  rec.onerror=e=>{ if(options.onError) options.onError(new Error((e && e.error && e.error.message) || '錄音時發生錯誤')); };

  const cleanup=()=>{
    stopped=true;
    try{ if(rafId) cancelAnimationFrame(rafId); }catch(e){}
    try{ stream.getTracks().forEach(t=>t.stop()); }catch(e){}
    try{ if(audioContext && audioContext.state!=='closed') audioContext.close(); }catch(e){}
    if(options.onLevel) options.onLevel(0);
  };

  rec.onstop=()=>{
    cleanup();
    const finalType=rec.mimeType || mimeType || (chunks[0]&&chunks[0].type) || 'audio/webm';
    const blob=new Blob(chunks,{type:finalType});
    if(!blob.size){
      if(options.onError) options.onError(new Error('錄音檔是空的，請確認麥克風權限與輸入裝置')); 
      return;
    }
    const reader=new FileReader();
    reader.onload=()=>{
      if(options.onDone) options.onDone(String(reader.result||''), { blob, mimeType: finalType, size: blob.size, objectUrl: URL.createObjectURL(blob) });
    };
    reader.onerror=()=>{ if(options.onError) options.onError(new Error('錄音檔讀取失敗')); };
    reader.readAsDataURL(blob);
  };

  rec.start(250);
  return {
    recorder: rec,
    stop(){ if(rec.state!=='inactive') rec.stop(); },
    cancel(){ cleanup(); },
    mimeType: mimeType || rec.mimeType || ''
  };
}
