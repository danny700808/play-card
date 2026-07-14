// 全站統一：回到上一頁 / 登出 / 內部系統視覺主題
(function(){
  function readUser(){
    try{return JSON.parse(localStorage.getItem('employeeUser')||'null');}
    catch(e){return null;}
  }
  function identityType(user){
    var raw=String((user&&user.identityType)||'').trim().toLowerCase();
    if(raw==='external'||raw==='parttime'||raw==='staff') return raw;
    return user&&user.isPartTime?'parttime':'staff';
  }
  function isManager(user){
    return !!(user&&(user.showSettingsZone||String(user.role||'').toLowerCase()==='admin'));
  }
  function currentFile(){
    return String(location.pathname||'').split('/').pop().toLowerCase();
  }
  function fallbackHref(){
    var user=readUser();
    var file=currentFile();
    if(!user) return 'index.html';
    if(identityType(user)==='external') return 'teacher-home.html';
    if(file==='portal.html') return isManager(user)?'portal.html':'dashboard.html';
    if(file==='settings.html') return 'portal.html';
    if(isManager(user)&&localStorage.getItem('employeePortalMode')==='settings') return 'settings.html';
    return 'dashboard.html';
  }
  function goBack(){
    var file=currentFile();
    if(file==='settings.html'){ location.href='portal.html'; return; }
    if(file==='dashboard.html' && isManager(readUser()) && localStorage.getItem('employeePortalMode')==='settings'){
      location.href='settings.html'; return;
    }
    if(window.history && window.history.length>1){
      window.history.back();
      return;
    }
    location.href=fallbackHref();
  }
  function doLogout(){
    try{
      localStorage.removeItem('employeeUser');
      localStorage.removeItem('employeeUserId');
      localStorage.removeItem('employeePortalMode');
      localStorage.removeItem('loginUser');
      localStorage.removeItem('currentUser');
    }catch(e){}
    location.href='index.html';
  }
  function applyTheme(user){
    if(!user || !document.body) return;
    document.body.classList.add('yz-internal-theme');
    if(isManager(user)) document.body.classList.add('yz-manager-theme');
  }
  function bind(){
    var nav=document.querySelector('[data-yz-global-nav]');
    var user=readUser();
    applyTheme(user);
    if(!nav) return;
    // 客人公開頁也可共用此檔；沒有登入員工系統時不顯示管理用返回 / 登出列。
    if(!user && nav.getAttribute('data-yz-show-without-login')!=='true'){
      nav.style.display='none';
      return;
    }
    var file=currentFile();
    var back=nav.querySelector('[data-yz-nav-back]');
    var logout=nav.querySelector('[data-yz-nav-logout]');
    if(file==='portal.html'){
      nav.classList.add('yz-nav-root');
      if(back) back.style.display='none';
    }else if(back){
      if(file==='settings.html') back.textContent='返回系統入口';
      else if(isManager(user)&&localStorage.getItem('employeePortalMode')==='settings') back.textContent='返回內部系統';
      back.addEventListener('click',goBack);
    }
    if(logout) logout.addEventListener('click',doLogout);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
  else bind();
  window.yzGlobalBack=goBack;
  window.yzGlobalLogout=doLogout;
})();
