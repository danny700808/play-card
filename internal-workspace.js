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
  // Fold static explanations only; live status, totals, form controls, and warnings stay visible.
  const noteSelectors=['.internal-home-intro','.internal-home-group header p','.tile > span:not(.badge)', '.hub-card .d','.home-tile .tile-desc','.manage-card > span','.hero > div > p','.section-head p','.compact-note','.hr-help','.rule','.sheet-desc','.subtitle','.sub'];
  const notes=Array.from(document.querySelectorAll(noteSelectors.join(','))).filter(node=>
    !node.id && !node.querySelector('[id],input,select,textarea,button,[role="alert"],[aria-live]') && node.textContent.trim() && !node.closest('[role="dialog"],.modal,.dialog')
  );
  if(notes.length){
   const details=document.createElement('details');details.className='internal-help';
   const summary=document.createElement('summary');summary.textContent='操作說明';details.append(summary);
   notes.forEach(node=>{
    if(node.closest('.internal-description'))return;
    const copy=node.cloneNode(true);copy.removeAttribute('class');copy.className='internal-help-item';
    const parentLink=node.closest('a');
    if(parentLink){const label=parentLink.querySelector('strong,b,.h,.tile-title');if(label){const heading=document.createElement('strong');heading.textContent=label.textContent+'：';copy.prepend(heading);}}
    details.append(copy);node.classList.add('internal-description');
   });
   const content=document.querySelector('.internal-home-sections')?.parentElement || document.querySelector('body > .container,body > main,body > .wrap');
   (content||document.body).append(details);
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
