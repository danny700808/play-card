function initPage(){
 const user=requireLogin();if(!user)return;if(!hasSettingsZoneAccess(user)){location.href='forms-hub.html';return;}
 const query=new URLSearchParams(location.search);
 document.querySelectorAll('[data-form-link]').forEach(link=>{const url=new URL(link.href);for(const key of ['identity','source'])if(query.has(key))url.searchParams.set(key,query.get(key));link.href=url.href;});
 if(query.get('identity')==='external'&&document.title==='表單與證明')document.querySelector('h1').textContent='外聘老師表單與證明';
}
