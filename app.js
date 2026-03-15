
const API_URL = window.APP_CONFIG.API_URL;
function qs(s){return document.querySelector(s)}
function qsa(s){return Array.from(document.querySelectorAll(s))}
function saveUser(user){localStorage.setItem('employeeUser', JSON.stringify(user))}
function getUser(){try{return JSON.parse(localStorage.getItem('employeeUser')||'null')}catch(e){return null}}
function logout(){localStorage.removeItem('employeeUser'); location.href='index.html'}
function requireLogin(){const user=getUser(); if(!user){location.href='index.html'; return null;} return user;}
async function api(action, payload={}){const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...payload})}); return res.json();}
function setMsg(el, text, isError=false){if(!el) return; el.style.display=text?'block':'none'; el.textContent=text||''; el.classList.toggle('error',!!isError)}
function togglePassword(inputSel, btn){const input=qs(inputSel); const show=input.type==='password'; input.type=show?'text':'password'; btn.textContent=show?'🙈':'👁';}
async function getPublicIp(){try{const r=await fetch('https://api.ipify.org?format=json'); const j=await r.json(); return j.ip||'';}catch(e){return '';}}
async function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader(); r.onload=()=>resolve(String(r.result||'')); r.onerror=reject; r.readAsDataURL(file);});}
function fillHeader(){const user=requireLogin(); if(!user) return; qsa('[data-user-name]').forEach(el=>el.textContent=user.name||'員工'); qsa('[data-if-parttime]').forEach(el=>el.style.display=user.isPartTime?'':'none'); qsa('[data-if-admin]').forEach(el=>el.style.display=user.role==='admin'?'':'none'); qsa('[data-if-staff-view]').forEach(el=>el.style.display=user.role==='admin'?'none':'');}
function redirectAfterLogin(user){saveUser(user); location.href = user.role==='admin' ? 'task.html' : 'dashboard.html';}
function saveLoginPref(email,password,remember=true){if(!remember){localStorage.removeItem('employeeSavedLogin');return;}localStorage.setItem('employeeSavedLogin',JSON.stringify({email:email||'',password:password||'',remember:true}));}
function getSavedLogin(){try{return JSON.parse(localStorage.getItem('employeeSavedLogin')||'null')}catch(e){return null}}
function applySavedLogin(emailSel='#email',passwordSel='#password',rememberSel='#rememberLogin'){const s=getSavedLogin();if(!s)return;const e=qs(emailSel),p=qs(passwordSel),r=qs(rememberSel);if(e)e.value=s.email||'';if(p)p.value=s.password||'';if(r)r.checked=!!s.remember;}
function getDriveFileId(url){const m=String(url||'').match(/(?:file\/d\/|[?&]id=)([-_a-zA-Z0-9]+)/);return m?m[1]:'';}
function imagePreviewUrl(url){const id=getDriveFileId(url);return id?('https://drive.google.com/thumbnail?id='+id+'&sz=w1200'):url;}
function audioOpenUrl(url){const id=getDriveFileId(url);return id?('https://drive.google.com/file/d/'+id+'/view'):url;}
function audioStreamUrl(url){const id=getDriveFileId(url);return id?('https://drive.google.com/uc?export=download&id='+id):url;}
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


function escapeHtml(s){return String(s==null?'':s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",""":"&quot;","'":"&#39;"}[m]));}
async function fetchTaskAudioData(taskId, audioUrl){
  return await api('getTaskAudioData',{taskId:taskId||'',audioUrl:audioUrl||'',userId:(getUser()||{}).id||''});
}
async function loadTaskAudio(taskId, audioUrl, btn){
  const audio=document.getElementById('audio_'+taskId);
  const status=document.getElementById('audio_status_'+taskId);
  if(!audio) return;
  try{
    if(btn){btn.disabled=true; btn.textContent='載入錄音中...';}
    if(status){status.textContent='錄音載入中...'; status.classList.remove('hidden');}
    const r=await fetchTaskAudioData(taskId, audioUrl);
    if(!r || !r.ok || !r.dataUrl) throw new Error((r&&r.message)||'錄音讀取失敗');
    audio.src=r.dataUrl;
    if(r.contentType){ audio.setAttribute('data-content-type', r.contentType); }
    audio.load();
    try{ await audio.play(); }catch(e){}
    if(status){status.textContent='錄音已載入，可直接播放'; status.classList.remove('hidden');}
    if(btn){btn.textContent='重新載入錄音'; btn.disabled=false;}
  }catch(err){
    if(status){status.textContent='錄音載入失敗：'+(err.message||String(err)); status.classList.remove('hidden');}
    if(btn){btn.textContent='重新載入錄音'; btn.disabled=false;}
  }
}

