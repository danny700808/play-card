(function(){
  const KEYS = {
    token: 'emp_session_token',
    name: 'emp_name',
    email: 'emp_email',
    empId: 'emp_id'
  };

  function qs(id){ return document.getElementById(id); }
  function setMsg(id, text){ const el = qs(id); if(el) el.innerText = text; }
  function getSessionToken(){ return localStorage.getItem(KEYS.token) || ''; }
  function getUser(){
    return {
      token: getSessionToken(),
      name: localStorage.getItem(KEYS.name) || '',
      email: localStorage.getItem(KEYS.email) || '',
      empId: localStorage.getItem(KEYS.empId) || ''
    };
  }
  function saveSession(result){
    localStorage.setItem(KEYS.token, result.sessionToken || '');
    localStorage.setItem(KEYS.name, result.name || '');
    localStorage.setItem(KEYS.email, result.email || '');
    localStorage.setItem(KEYS.empId, result.empId || '');
  }
  function clearSession(){
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  }
  function requireLogin(){
    if(!getSessionToken()){
      location.href = './index.html';
      return false;
    }
    return true;
  }
  async function postApi(payload){
    const apiUrl = (window.EMP_CONFIG && window.EMP_CONFIG.API_URL) || '';
    if(!apiUrl || /REPLACE_WITH_YOUR_DEPLOYMENT_ID/.test(apiUrl)){
      return { status:false, msg:'請先打開 config.js，填入 Apps Script 的部署網址' };
    }
    try{
      const res = await fetch(apiUrl, {
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      try{
        return JSON.parse(text);
      }catch(err){
        return { status:false, msg:'API 回傳格式錯誤\n' + text };
      }
    }catch(err){
      return { status:false, msg:'連線失敗：' + err.message };
    }
  }
  async function logoutAction(){
    const token = getSessionToken();
    if(token){
      await postApi({ action:'employeeLogout', sessionToken: token });
    }
    clearSession();
    location.href = './index.html';
  }
  async function getPublicIp(){
    try{
      const res = await fetch('https://api.ipify.org?format=json', { cache:'no-store' });
      const data = await res.json();
      return String(data.ip || '').trim();
    }catch(err){
      return '';
    }
  }
  function getTodayInfo(){
    const now = new Date();
    return {
      date: now.toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'long'}),
      time: now.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
    };
  }
  function escapeHtml(str){
    return String(str || '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
  }

  window.EMP_APP = {
    qs, setMsg, postApi, getSessionToken, getUser, saveSession, clearSession,
    requireLogin, logoutAction, getPublicIp, getTodayInfo, escapeHtml
  };
})();
