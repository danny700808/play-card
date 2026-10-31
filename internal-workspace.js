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
   primary.append(link('營運中心','portal.html#overview',false),link('管理樹狀圖','settings.html',file==='settings.html'));
   const approvals=link('人事','settings.html#people',false);
   const badge=document.createElement('span');badge.id='badge-approval';badge.className='internal-nav-badge';approvals.append(badge);primary.append(approvals);
  }else primary.append(link('員工服務','dashboard.html',file==='dashboard.html'));
  const logout=document.createElement('button');logout.type='button';logout.textContent='登出';logout.className='internal-logout';
  logout.onclick=function(){if(typeof window.yzGlobalLogout==='function')window.yzGlobalLogout();};primary.append(logout);shell.append(primary);
  if(manager&&file!=='settings.html'&&file!=='hr-payroll-settings-hub.html'){
   const crumbs=document.createElement('div');crumbs.className='internal-breadcrumbs';crumbs.setAttribute('aria-label','目前位置');
   function renderCrumbs(){
   if(crumbs.replaceChildren)crumbs.replaceChildren();
   const path=routes.pageContext(location.pathname,location.search,location.hash);
   path.forEach((node,index)=>{
    if(index){const sep=document.createElement('span');sep.textContent='›';sep.setAttribute('aria-hidden','true');crumbs.append(sep);}
    const isCurrent=index===path.length-1&&!node.children&&new URL(node.href,location.href).pathname===location.pathname;
    crumbs.append(link(node.label,routes.treeLink(node),isCurrent));
   });
   const last=path[path.length-1];
   if(last?.children||last?.href&&new URL(last.href,location.href).pathname!==location.pathname){const title=document.createElement('span');title.className='internal-current-page';title.textContent='› '+(document.title||routes.groups[groupKey]?.label||'目前頁面');crumbs.append(title);}
   const parent=[...path].reverse().find(node=>node.children);
   if(parent){const back=link('返回'+parent.label,routes.treeLink(parent),false);back.className='internal-parent-link';crumbs.append(back);}
   }
   renderCrumbs();
   window.InternalWorkspaceNavigation={refresh:renderCrumbs,setPersonnelType(type){
    if(!['employee-admin.html','salary-admin.html'].includes(file))return;
    const u=new URL(location.href);u.searchParams.delete('nav');
    if(['staff','parttime','external'].includes(type))u.searchParams.set('type',type);else u.searchParams.delete('type');
    if(type==='external')u.searchParams.set('source','teacher-hub');
    if(type!=='external'&&u.searchParams.get('source')==='teacher-hub')u.searchParams.delete('source');
    history.replaceState(null,'',u.pathname+u.search+u.hash);renderCrumbs();
   }};
   shell.append(crumbs);
  }else if(!manager&&groupKey){
   const group=routes.groups[groupKey];const secondary=document.createElement('div');secondary.className='internal-nav-secondary';secondary.setAttribute('aria-label',group.label+'功能');
   group.links.forEach(([label,href])=>{
    const u=new URL(href,location.href);const current=new URL(location.href);
    const active=u.pathname===current.pathname&&[...u.searchParams].every(([k,v])=>current.searchParams.get(k)===v);
    secondary.append(link(label,href,active));
   });shell.append(secondary);
  }
  if(nav)nav.replaceWith(shell);else document.body.prepend(shell);
  // Remove static explanatory copy only. IDs, fields, links, alerts and live data are preserved.
  const noteSelectors=['.internal-home-intro','.internal-home-group header p','.tile > span:not(.badge)','.hub-card .d','.home-tile .tile-desc','.manage-card > span','.hero > div > p','.hero > p','.section-head p','.compact-note','.hr-help','.rule','.sheet-desc','.subtitle','.sub','.hub-desc','.entry-card > span','.internal-explanation','.help-text','.field-hint','.section-desc','.section-note','.hint'];
  function hideStaticNotes(){
   document.querySelectorAll(noteSelectors.join(',')).forEach(node=>{
    if(node.id||node.querySelector('[id],input,select,textarea,button,a,[role="alert"],[aria-live]')||node.closest('[role="alert"],[aria-live],.approval-note,.approval-meta')||!node.textContent.trim())return;
    node.classList.add('internal-description');
   });
  }
  hideStaticNotes();
  if(typeof MutationObserver==='function'){
   let queued=false;
   new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;hideStaticNotes();});}).observe(document.body,{childList:true,subtree:true});
  }
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
