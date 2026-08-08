// 全站統一：回到上一頁 / 登出 / 內部系統視覺主題
(function(){
  var TEACHER_SESSION_KEY='youzi.coursePortal.teacher.session.v1';
  function loadMobileTheme(){
    if(!document.head || document.querySelector('link[data-yz-internal-mobile]')) return;
    var link=document.createElement('link');
    link.rel='stylesheet';
    link.href='internal-mobile.css?v=20260727-mobile-v1';
    link.media='(max-width: 780px)';
    link.setAttribute('data-yz-internal-mobile','');
    document.head.appendChild(link);
  }
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
  function hasTeacherPortalSession(){
    try{return !!String(localStorage.getItem(TEACHER_SESSION_KEY)||'').trim();}
    catch(e){return false;}
  }
  function isTeacherPortalUser(user){
    return !!(user&&user.portalSessionBridge===true);
  }
  function isTeacherPortalNav(nav,user){
    if(!nav||!nav.hasAttribute('data-yz-teacher-nav')) return false;
    var params=new URLSearchParams(location.search||'');
    if(params.get('mode')==='admin'||params.get('source')==='teacher-hub') return false;
    if(user&&!isTeacherPortalUser(user)&&(user.id||user.employeeId||user.email)) return false;
    return isTeacherPortalUser(user)||hasTeacherPortalSession();
  }
  function localDateKey(){
    var d=new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function prepareClockPolicy(){
    if(currentFile()!=='clock.html') return;
    var effectiveDate='2026-08-05';
    window.__YZ_CLOCK_ACTIVE_SHIFT_POLICY_EFFECTIVE_DATE__=effectiveDate;
    // 2026/08/04 的既有案件不追溯套用；自隔日起才啟用班段進行中禁止補打卡。
    if(localDateKey()<effectiveDate) window.__YZ_CLOCK_ACTIVE_SHIFT_GUARD_INLINE_V1__=true;
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
      var user=readUser();
      if(user&&user.portalSessionBridge===true&&window.YZTeacherMoreAuth&&typeof window.YZTeacherMoreAuth.clearPortalBridge==='function') window.YZTeacherMoreAuth.clearPortalBridge();
      localStorage.removeItem('employeeUser');
      localStorage.removeItem('employeeUserId');
      localStorage.removeItem('employeePortalMode');
      localStorage.removeItem('loginUser');
      localStorage.removeItem('currentUser');
    }catch(e){}
    location.href='index.html';
  }
  function doTeacherLogout(){
    try{
      var user=readUser();
      if(window.YZTeacherMoreAuth&&typeof window.YZTeacherMoreAuth.clearPortalBridge==='function'){
        window.YZTeacherMoreAuth.clearPortalBridge();
      }else{
        localStorage.removeItem(TEACHER_SESSION_KEY);
        localStorage.removeItem('youzi.teacherMore.authorization.v2');
        localStorage.removeItem('youzi.teacherMore.authorization.v3');
        localStorage.removeItem('youzi.teacherMore.authorization.v4');
        if(isTeacherPortalUser(user)){
          localStorage.removeItem('employeeUser');
          localStorage.removeItem('employeeUserId');
        }
      }
    }catch(e){}
    location.replace('course-portal.html?method=line&role=teacher');
  }
  function applyTheme(user){
    if(!user || !document.body) return;
    document.body.classList.add('yz-internal-theme');
    if(isManager(user)) document.body.classList.add('yz-manager-theme');
  }
  function bind(){
    var nav=document.querySelector('[data-yz-global-nav]');
    var user=readUser();
    var teacherPortalNav=isTeacherPortalNav(nav,user);
    if(teacherPortalNav){
      document.body.classList.remove('yz-internal-theme','yz-manager-theme');
      document.body.classList.add('yz-teacher-portal-context');
      nav.classList.add('yz-teacher-nav');
    }else{
      applyTheme(user);
      if(nav) nav.classList.remove('yz-teacher-nav');
    }
    if(!nav) return;
    // 客人公開頁也可共用此檔；沒有登入員工系統時不顯示管理用返回 / 登出列。
    if(!user && !teacherPortalNav && nav.getAttribute('data-yz-show-without-login')!=='true'){
      nav.style.display='none';
      return;
    }
    var file=currentFile();
    var back=nav.querySelector('[data-yz-nav-back]');
    var logout=nav.querySelector('[data-yz-nav-logout]');
    if(teacherPortalNav){
      if(back){
        back.textContent='回老師課務';
        back.addEventListener('click',function(){location.href='teacher-course-portal.html';});
      }
    }else if(file==='portal.html'){
      nav.classList.add('yz-nav-root');
      if(back) back.style.display='none';
    }else if(back){
      if(file==='settings.html') back.textContent='返回系統入口';
      else if(isManager(user)&&localStorage.getItem('employeePortalMode')==='settings') back.textContent='返回內部系統';
      back.addEventListener('click',goBack);
    }
    if(logout) logout.addEventListener('click',teacherPortalNav?doTeacherLogout:doLogout);
  }
  prepareClockPolicy();
  loadMobileTheme();
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind);
  else bind();
  window.yzGlobalBack=goBack;
  window.yzGlobalLogout=doLogout;
})();
