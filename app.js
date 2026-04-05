// 這份是補丁版 app.js，只處理這次你要的兩個問題：
// 1. 管理者也能切換到設定區
// 2. 登入後正確保留 userId / API URL / 角色資料

const API_URL = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || window.API_BASE || '';

function qs(sel){ return document.querySelector(sel); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }

function saveUser(user){
  localStorage.setItem('employeeUser', JSON.stringify(user || {}));
  if(user && user.id) localStorage.setItem('employeeUserId', user.id);
  else localStorage.removeItem('employeeUserId');
  if(API_URL) localStorage.setItem('employeeApiBaseUrl', API_URL);
}
function getUser(){
  try{ return JSON.parse(localStorage.getItem('employeeUser') || 'null'); }catch(e){ return null; }
}
function logout(){
  localStorage.removeItem('employeeUser');
  localStorage.removeItem('employeeUserId');
  localStorage.removeItem('teacherUserId');
  location.href='index.html';
}
function api(action, payload){
  if(!API_URL) return Promise.reject(new Error('缺少 API_URL'));
  return fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({action}, payload||{}))}).then(r=>r.json());
}
function fillHeader(){
  const user=getUser();
  qsa('[data-user-name]').forEach(el=>{ el.textContent = (user && user.name) || ''; });
}
function requireLogin(){
  const user=getUser();
  if(!user || !user.id){ location.href='index.html'; return null; }
  return user;
}
function canAccessSettingsZone(user){
  return !!(user && (user.showSettingsZone || String(user.role||'').toLowerCase()==='admin'));
}
function setPortalMode(mode){
  document.body.dataset.portalMode = mode || '';
}
function guardFeatureAccess(){ return true; }
function canUseFeature(feature, user){
  const t = String((user && user.identityType) || '').toLowerCase();
  if(feature==='parttime') return !!(user && user.isPartTime);
  if(feature==='clock' || feature==='leave' || feature==='task' || feature==='training' || feature==='dashboard') return t !== 'external';
  if(feature==='routine') return t !== 'external';
  return true;
}
function renderLineBindCard(container){ if(container) container.innerHTML=''; }
async function getPublicSystemLinks(){ try{ return await api('getPublicSystemLinks',{}); }catch(e){ return {}; } }

function showMsg(text, isError){
  const box = qs('#message');
  if(!box) return;
  box.style.display='block';
  box.textContent=text || '';
  box.className='message' + (isError ? ' error' : ' success');
}

function togglePassword(id, btn){
  const input = document.getElementById(id);
  if(!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  if(btn) btn.textContent = input.type === 'password' ? '👁' : '🙈';
}

function initLoginPage(){
  try{
    const remembered = JSON.parse(localStorage.getItem('rememberLogin') || 'null');
    if(remembered && remembered.email){ qs('#loginEmail').value = remembered.email || ''; }
    if(remembered && remembered.password){ qs('#loginPassword').value = remembered.password || ''; }
    if(remembered){ qs('#rememberMe').checked = true; }
  }catch(e){}
}

async function login(){
  const email = (qs('#loginEmail') && qs('#loginEmail').value || '').trim();
  const password = (qs('#loginPassword') && qs('#loginPassword').value || '').trim();
  if(!email || !password){ showMsg('請輸入 Email 與密碼。', true); return; }
  try{
    const res = await api('login',{email,password});
    if(!res || !res.ok){ showMsg((res && res.message) || '登入失敗', true); return; }
    const user = res.user || {};
    saveUser(user);
    if(qs('#rememberMe') && qs('#rememberMe').checked){
      localStorage.setItem('rememberLogin', JSON.stringify({email,password}));
    }else{
      localStorage.removeItem('rememberLogin');
    }
    const identity = String(user.identityType || '').toLowerCase();
    if(identity === 'external') location.href = 'teacher-home.html';
    else location.href = 'dashboard.html';
  }catch(err){
    showMsg(err && err.message ? err.message : String(err), true);
  }
}

function goRegister(){ location.href='register.html'; }
function goForgotPassword(){ location.href='forgot-password.html'; }
function goChangePassword(){ location.href='change-password.html'; }
