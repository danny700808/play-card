/* Shared compact chrome. Never moves forms or replaces business event handlers. */
(function(){
 function init(){
  const routes=window.InternalWorkspaceRoutes;
  if(!routes)return;
  let user;try{user=JSON.parse(localStorage.getItem('employeeUser')||'null');}catch(e){return;}
  if(!user || user.portalSessionBridge===true || user.identityType==='external')return;
  const manager=typeof hasSettingsZoneAccess==='function'?hasSettingsZoneAccess(user):Boolean(user.showSettingsZone||String(user.role||'').toLowerCase()==='admin');
  const file=location.pathname.split('/').pop();
  const groupKey=routes.resolve(location.pathname,location.search);
  if(!groupKey&&file!=='settings.html')return;
  if(!manager&&groupKey!=='employee')return;
  document.body.classList.add('internal-workspace');
  let nav=document.querySelector('[data-yz-global-nav]');
  const shell=document.createElement('nav');shell.className='internal-nav';shell.setAttribute('aria-label','工作區導覽');
  const primary=document.createElement('div');primary.className='internal-nav-primary';
  function link(label,href,active){
   const a=document.createElement('a');a.textContent=label;a.href=href;
   if(active)a.setAttribute('aria-current','page');return a;
  }
  if(manager){
   primary.append(link('營運中心','portal.html#overview',false),link('管理工作區','settings.html',file==='settings.html'));
   ['hr','approval','work','teachers','rental','forms'].forEach(key=>{const g=routes.groups[key];const a=link(g.label,g.home,groupKey===key);if(groupKey===key)a.setAttribute('aria-current','true');primary.append(a);});
  }else primary.append(link('員工服務','dashboard.html',file==='dashboard.html'));
  const logout=document.createElement('button');logout.type='button';logout.textContent='登出';logout.className='internal-logout';
  logout.onclick=function(){if(typeof window.yzGlobalLogout==='function')window.yzGlobalLogout();};primary.append(logout);shell.append(primary);
  if(groupKey){
   const group=routes.groups[groupKey];const secondary=document.createElement('div');secondary.className='internal-nav-secondary';secondary.setAttribute('aria-label',group.label+'功能');
   group.links.forEach(([label,href])=>{
    const u=new URL(href,location.href);const current=new URL(location.href);
    const active=u.pathname===current.pathname&&[...u.searchParams].every(([k,v])=>current.searchParams.get(k)===v);
    secondary.append(link(label,href,active));
   });shell.append(secondary);
  }
  if(nav)nav.replaceWith(shell);else document.body.prepend(shell);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
