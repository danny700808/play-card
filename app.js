const API_URL = window.APP_CONFIG.API_URL;
function qs(s){return document.querySelector(s)}
function qsa(s){return Array.from(document.querySelectorAll(s))}
function saveUser(user){localStorage.setItem('employeeUser', JSON.stringify(user))}
function getUser(){try{return JSON.parse(localStorage.getItem('employeeUser')||'null')}catch(e){return null}}
function logout(){localStorage.removeItem('employeeUser'); location.href='index.html'}
function requireLogin(){const user=getUser(); if(!user){location.href='index.html'; return null;} return user;}
async function api(action, payload={}){const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...payload})}); return res.json();}
function setMsg(el, text, isError=false){if(!el) return; el.style.display=text?'block':'none'; el.textContent=text||''; el.classList.toggle('error',!!isError)}
function togglePassword(inputSel, btn){const input=qs(inputSel); const show=input.type==='password'; input.type=show?'text':'password'; if(btn) btn.textContent=show?'🙈':'👁';}
async function getPublicIp(){try{const r=await fetch('https://api.ipify.org?format=json'); const j=await r.json(); return j.ip||'';}catch(e){return '';}}
async function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader(); r.onload=()=>resolve(String(r.result||'')); r.onerror=reject; r.readAsDataURL(file);});}
async function compressImageToDataUrl(file, maxSize=1280, quality=0.78){
  const original = await fileToDataUrl(file);
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = ()=>{
      let {width, height} = img;
      if(width > maxSize || height > maxSize){
        const ratio = Math.min(maxSize/width, maxSize/height);
        width = Math.round(width*ratio); height = Math.round(height*ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img,0,0,width,height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = original;
  });
}
function fillHeader(){
  const user=requireLogin(); if(!user) return;
  qsa('[data-user-name]').forEach(el=>el.textContent=user.name||'員工');
  qsa('[data-if-parttime]').forEach(el=>el.style.display=user.isPartTime?'':'none');
  qsa('[data-if-admin]').forEach(el=>el.style.display=user.role==='admin'?'':'none');
}
function getEmployeeOptions(){
  const list = (window.APP_CONFIG && Array.isArray(window.APP_CONFIG.EMPLOYEES)) ? window.APP_CONFIG.EMPLOYEES : [];
  return list.map(x=>({name:(x.name||'').trim(), email:(x.email||'').trim(), id:(x.id||'').trim()})).filter(x=>x.name && x.email);
}
function findEmployeeByName(name){
  const target = String(name||'').trim();
  return getEmployeeOptions().find(x=>x.name === target) || null;
}
function employeeOptionsHtml(selectedEmail=''){
  const opts = getEmployeeOptions();
  return opts.map(x=>`<option value="${x.name.replace(/"/g,'&quot;')}" data-email="${x.email.replace(/"/g,'&quot;')}">${x.name}</option>`).join('');
}
function formatTaskStatus(s){
  const v = String(s||'');
  if(v==='待完成') return '待完成';
  if(v==='已完成') return '已完成';
  return v || '待完成';
}
