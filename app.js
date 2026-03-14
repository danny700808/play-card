
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

function getPreferredRecorderMimeType(){
  const candidates = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/wav',
    'audio/webm;codecs=opus',
    'audio/webm'
  ];
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  for (const type of candidates){
    try{ if(type && MediaRecorder.isTypeSupported(type)) return type; }catch(e){}
  }
  return '';
}
async function startRecorder(onDone){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){throw new Error('目前裝置不支援錄音');}
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});
  const mimeType = getPreferredRecorderMimeType();
  const rec=new MediaRecorder(stream, mimeType?{mimeType}:undefined);
  const chunks=[];
  rec.ondataavailable=e=>{if(e.data && e.data.size) chunks.push(e.data);};
  rec.onstop=async()=>{
    stream.getTracks().forEach(t=>t.stop());
    const finalType = rec.mimeType || mimeType || 'audio/webm';
    const blob=new Blob(chunks,{type:finalType});
    const reader=new FileReader();
    reader.onload=()=>onDone(String(reader.result||''), finalType);
    reader.readAsDataURL(blob);
  };
  rec.start();
  return rec;
}

