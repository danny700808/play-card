// 全站統一：回到上一頁 / 登出
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
  function fallbackHref(){
    var user=readUser();
    var file=String(location.pathname||'').split('/').pop().toLowerCase();
    if(!user) return 'index.html';
    if(identityType(user)==='external') return 'teacher-home.html';
    if(file==='settings.html') return 'dashboard.html';
    if(isManager(user)&&localStorage.getItem('employeePortalMode')==='settings') return 'settings.html';
    return 'dashboard.html';
  }
  function goBack(){
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
  function bind(){
    var nav=document.querySelector('[data-yz-global-nav]');
    if(!nav) return;
    var back=nav.querySelector('[data-yz-nav-back]');
    var logout=nav.querySelector('[data-yz-nav-logout]');
    if(back) back.addEventListener('click',goBack);
    if(logout) logout.addEventListener('click',doLogout);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
  else bind();
  window.yzGlobalBack=goBack;
  window.yzGlobalLogout=doLogout;
})();
