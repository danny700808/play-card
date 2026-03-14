
const API_URL = window.APP_CONFIG.API_URL;
function qs(s){return document.querySelector(s)}
function qsa(s){return Array.from(document.querySelectorAll(s))}
function saveUser(user){localStorage.setItem('employeeUser', JSON.stringify(user))}
function getUser(){try{return JSON.parse(localStorage.getItem('employeeUser')||'null')}catch(e){return null}}
function logout(){localStorage.removeItem('employeeUser'); location.href='index.html'}
function requireLogin(){const user=getUser(); if(!user){location.href='index.html'; return null;} return user;}
async function api(action, payload={}){
  const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...payload})});
  return res.json();
}
function setMsg(el, text, isError=false){ if(!el) return; el.style.display=text?'block':'none'; el.textContent=text||''; el.classList.toggle('error',!!isError); }
function togglePassword(inputSel, btn){const input=typeof inputSel==='string'?qs(inputSel):inputSel; const show=input.type==='password'; input.type=show?'text':'password'; if(btn) btn.textContent=show?'🙈':'👁';}
async function getPublicIp(){try{const r=await fetch('https://api.ipify.org?format=json'); const j=await r.json(); return j.ip||'';}catch(e){return '';}}
async function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader(); r.onload=()=>resolve(String(r.result||'')); r.onerror=reject; r.readAsDataURL(file);});}
async function compressImageToDataUrl(file, maxSide=1280, quality=0.78){
  const imgUrl = await fileToDataUrl(file);
  const img = new Image();
  await new Promise((res,rej)=>{img.onload=res; img.onerror=rej; img.src=imgUrl;});
  let {width,height}=img;
  if(width>height){ if(width>maxSide){ height=Math.round(height*maxSide/width); width=maxSide; } }
  else { if(height>maxSide){ width=Math.round(width*maxSide/height); height=maxSide; } }
  const canvas=document.createElement('canvas'); canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,width,height);
  return canvas.toDataURL('image/jpeg', quality);
}
function redirectAfterLogin(user){
  location.href = user && user.role==='admin' ? 'task.html' : 'dashboard.html';
}
function fillHeader(){
  const user=requireLogin(); if(!user) return;
  qsa('[data-user-name]').forEach(el=>el.textContent=user.name||'員工');
  qsa('[data-if-parttime]').forEach(el=>el.style.display=user.isPartTime?'':'none');
  qsa('[data-if-admin]').forEach(el=>el.style.display=user.role==='admin'?'':'none');
}
