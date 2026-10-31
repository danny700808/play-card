(function(global){
 'use strict';
 const pages=new Set(['teacher-course-portal.html','teacher-profile.html','room-booking.html','announcements.html','task.html','teacher-goods.html','forms-hub.html','contract.html','gift-point-card.html','employment-certificate.html','teaching-certificate.html','clock.html','parttime.html','leave.html','temporary-attendance.html','training.html','routine.html','profile.html']);
 let active=null;
 function close(){if(active){window.removeEventListener('message',active.listener);active.frame.remove();active=null;}}
 function childBootstrap(config){
  const pending=new Map();let next=0;
  const storageMap=new Map(Object.entries(config.storage));
  const storage={getItem:k=>storageMap.get(k)??null,setItem:(k,v)=>{storageMap.set(k,String(v));send('storage',{key:k,value:String(v)});},removeItem:k=>{storageMap.delete(k);send('storage',{key:k,value:null});},clear:()=>{storageMap.clear();send('storage',{clear:true});},key:i=>[...storageMap.keys()][i]??null,get length(){return storageMap.size;}};
  Object.defineProperty(window,'localStorage',{value:storage});Object.defineProperty(window,'sessionStorage',{value:storage});
  const send=(kind,data)=>parent.postMessage({previewChannel:config.channel,kind,...data},'*');
  const pageUrl=new URL(config.page);
  const virtualLocation={assign:href=>send('navigate',{href:new URL(href,pageUrl).href}),replace:href=>send('navigate',{href:new URL(href,pageUrl).href}),reload:()=>send('navigate',{href:pageUrl.href})};
  for(const key of ['href','search','pathname','origin','hash','host','hostname','protocol'])Object.defineProperty(virtualLocation,key,{get:()=>pageUrl[key],set:value=>{const next=new URL(pageUrl);next[key]=value;send('navigate',{href:next.href});}});
  window.__previewLocation=virtualLocation;
  const rpc=(method,payload={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error('讀取逾時，請重新開啟。'));},175000);pending.set(id,{resolve,reject,timer});send('read',{id,method,payload});});
  addEventListener('message',event=>{if(event.source!==parent||event.data?.previewChannel!==config.channel)return;const p=pending.get(event.data.id);if(!p)return;clearTimeout(p.timer);pending.delete(event.data.id);event.data.error?p.reject(Error(event.data.error)):p.resolve(event.data.result);});
  const blocked=()=>Promise.reject(Error('唯讀檢視，不會送出或修改資料。'));
  const invoke=(name,data)=>rpc(name.replace(/Taiwan$/,''),data).then(data=>({data}));
  const functions={httpsCallable:name=>data=>invoke(name,data)};
  function query(collection,id='',filters=[]){return {id,doc:key=>query(collection,key||'preview-only'),where:(field,op,value)=>query(collection,id,filters.concat({field,op,value})),limit(){return this;},orderBy(){return this;},async get(){const result=await rpc('employeeDataRead',{collection,id});const docs=(result.rows||[]).filter(r=>filters.every(f=>{const v=r.data[f.field];return f.op==='=='?v===f.value:f.op==='>='?v>=f.value:f.op==='<='?v<=f.value:f.op==='in'?f.value.includes(v):f.op==='array-contains'?Array.isArray(v)&&v.includes(f.value):false;})).map(r=>({id:r.id,exists:true,data:()=>r.data,ref:query(collection,r.id)}));return id?(docs[0]||{id,exists:false,data:()=>undefined,ref:query(collection,id)}):{docs,empty:!docs.length,size:docs.length,forEach:fn=>docs.forEach(fn)};},set:blocked,update:blocked,delete:blocked,add:blocked};}
  const db={collection:name=>query(name),settings(){},enablePersistence:()=>Promise.resolve(),batch:()=>({set:blocked,commit:blocked}),runTransaction:blocked};
  const viewer=config.role==='employee'?{uid:'readonly-preview',getIdToken:async()=> 'readonly-preview',getIdTokenResult:async()=>({claims:{employee:true,employeeId:config.user.employeeId,manager:false}})}:null;
  const auth={currentUser:viewer,authStateReady:async()=>{},onAuthStateChanged:fn=>{queueMicrotask(()=>fn(viewer));return ()=>{};},signOut:blocked};
  const app={functions:()=>functions,firestore:()=>db,auth:()=>auth};
  function firestore(){return db;}firestore.FieldValue={serverTimestamp:()=>new Date(),delete:()=>null};firestore.FieldPath={documentId:()=> '__name__'};firestore.Timestamp=class {constructor(seconds,nanoseconds=0){this.seconds=seconds;this.nanoseconds=nanoseconds;}toDate(){return new Date(this.seconds*1000);}toMillis(){return this.seconds*1000;}static fromDate(d){return new this(d.getTime()/1000);}static now(){return this.fromDate(new Date());}};
  Object.defineProperty(window,'firebase',{value:{apps:[app],app:()=>app,initializeApp:()=>app,functions:()=>functions,auth:()=>auth,firestore},writable:false});
  window.fetch=async(url,options={})=>{const name=String(url).split('/').pop().split('?')[0];const data=options.body?JSON.parse(options.body).data||{}:{};const result=await rpc(name==='employeePrivateDataRead'?'employeeDataRead':name,data);return {ok:true,status:200,json:async()=>({result})};};
  window.XMLHttpRequest=class {open(){throw Error('唯讀檢視已隔離網路寫入。');}};
  window.WebSocket=class {constructor(){throw Error('唯讀檢視已隔離網路寫入。');}};
  window.open=()=>null;window.confirm=()=>false;window.alert=message=>send('notice',{message:String(message)});
  const writeLabel=/^(送出|儲存|確認(送出|簽|預約|辦理)|刪除|登出|寄送|上班打卡|下班打卡|送交主管)/;
  function protect(){document.querySelectorAll('button,input[type=submit]').forEach(n=>{if(writeLabel.test(n.textContent.trim())||(n.type==='submit'&&n.form)){n.disabled=true;n.title='唯讀檢視';}});document.querySelectorAll('input[type=file]').forEach(n=>n.disabled=true);}
  addEventListener('submit',event=>{event.preventDefault();event.stopImmediatePropagation();send('notice',{message:'唯讀檢視，不會送出。'});},true);
  addEventListener('click',event=>{
   const link=event.target.closest('a[href]');if(link){const href=link.getAttribute('href');if(!href||href.startsWith('#'))return;event.preventDefault();event.stopImmediatePropagation();send('navigate',{href:link.href});return;}
   const button=event.target.closest('button');if(button&&/^(回老師課務|返回老師|回老師首頁)/.test(button.textContent.trim())){event.preventDefault();event.stopImmediatePropagation();send('navigate',{href:'teacher-course-portal.html'});}
  },true);
  addEventListener('DOMContentLoaded',()=>{protect();new MutationObserver(protect).observe(document.body,{childList:true,subtree:true});});
  // Inline announcement frames navigate through the same protected parent loader.
  const srcDescriptor=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src');
  Object.defineProperty(HTMLIFrameElement.prototype,'src',{get:srcDescriptor.get,set(value){if(value&&value!=='about:blank'){send('navigate',{href:value});return;}srcDescriptor.set.call(this,value);}});
 }
 async function open({container,page,user,read,role='teacher'}){
  close();const channel=crypto.randomUUID();const frame=document.createElement('iframe');frame.className='personal-preview-frame';frame.title='人員實際手機畫面';frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');
  container.replaceChildren();const toolbar=document.createElement('div');toolbar.className='personal-frame-head';const back=document.createElement('button');back.className='personal-btn';back.textContent='← 返回';toolbar.append(back);const status=document.createElement('span');status.setAttribute('role','status');toolbar.append(status);container.append(toolbar,frame);
  const history=[];let currentPage='',navigation=0,memoryStorage=null;
  async function navigate(href,remember=true){
   const url=new URL(href,location.href),name=url.pathname.split('/').pop();if(url.origin!==location.origin||!pages.has(name)){status.textContent='此連結不在唯讀檢視範圍';return;}
   if(remember&&currentPage)history.push(currentPage);currentPage=url.href;const version=++navigation;status.textContent='讀取中…';
   const response=await fetch(url.href,{credentials:'omit'});if(!response.ok)throw Error('頁面讀取失敗。');const doc=new DOMParser().parseFromString(await response.text(),'text/html');if(!active||active.channel!==channel||version!==navigation)return;
   doc.querySelectorAll('meta[http-equiv="refresh"],base').forEach(n=>n.remove());
   doc.querySelectorAll('script[src]').forEach(n=>{if(/firebase(?:js|-[a-z]+-compat)|teacher-personal-entry\.js/.test(n.src))n.remove();});
   // Instrument only this isolated copy so existing links and page-specific routing work in srcdoc.
   const rewrite=source=>source.replace(/(?<![\w$.])(?:(?:window|global)\.)?location\.(href|search|pathname|origin|hash|host|hostname|protocol|assign|replace|reload)\b/g,'window.__previewLocation.$1');
   await Promise.all([...doc.querySelectorAll('script')].map(async node=>{
    const src=node.getAttribute('src');if(src){const asset=new URL(src,url);if(asset.origin!==location.origin)return;const response=await fetch(asset.href,{credentials:'omit'});if(!response.ok)throw Error('預覽元件讀取失敗。');node.removeAttribute('src');node.textContent=rewrite(await response.text()).replace(/<\/script/gi,'<\\/script');}
    else node.textContent=rewrite(node.textContent);
   }));
   if(!active||active.channel!==channel||version!==navigation)return;
   const base=doc.createElement('base');base.href=url.href;doc.head.prepend(base);
   const policy=doc.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content="default-src 'none'; script-src 'unsafe-inline' https://danny700808.github.io https://cdn.jsdelivr.net; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'";doc.head.prepend(policy);
   let fingerprint=2166136261;for(const char of 'readonly-preview')fingerprint=Math.imul(fingerprint^char.charCodeAt(0),16777619);
   const storage={employeeUser:JSON.stringify(user),employeeUserId:user.id,employeeSecureAuthVersion:'1',['youzi.coursePortal.'+role+'.session.v1']:'readonly-preview','youzi.coursePortal.lastRole.v2':role,'youzi.coursePortal.authStateMigration.20260805.v1':'done','youzi.teacherMore.authorization.v4':JSON.stringify({employeeId:user.employeeId||user.id,tokenFingerprint:(fingerprint>>>0).toString(16).padStart(8,'0'),validatedAt:Date.now()})};
   if(role==='employee'){const style=doc.createElement('link');style.rel='stylesheet';style.href='personal-embedded.css?v=20261031-mobile3';doc.head.append(style);doc.body.classList.add('personal-embedded');}
   if(!memoryStorage)memoryStorage=new Map(Object.entries(storage));
   const script=doc.createElement('script');script.textContent='('+childBootstrap.toString()+')('+JSON.stringify({channel,storage:Object.fromEntries(memoryStorage),page:url.href,role,user}).replace(/</g,'\\u003c')+');';doc.head.insertBefore(script,base.nextSibling);
   frame.srcdoc='<!doctype html>'+doc.documentElement.outerHTML;status.textContent='唯讀';
  }
  const listener=async event=>{
   if(event.source!==frame.contentWindow||event.data?.previewChannel!==channel)return;const message=event.data;
   if(message.kind==='storage'){if(message.clear)memoryStorage.clear();else if(message.value===null)memoryStorage.delete(message.key);else memoryStorage.set(message.key,String(message.value));return;}
   if(message.kind==='navigate'){navigate(message.href).catch(e=>status.textContent=e.message);return;}
   if(message.kind==='notice'){status.textContent=message.message;return;}
   if(message.kind!=='read')return;
   try{const result=await read(message.method,message.payload);if(active?.channel===channel)frame.contentWindow.postMessage({previewChannel:channel,id:message.id,result},'*');}catch(e){if(active?.channel===channel)frame.contentWindow.postMessage({previewChannel:channel,id:message.id,error:e.message},'*');}
  };
  active={frame,listener,channel};window.addEventListener('message',listener);back.onclick=()=>navigate(history.pop()||page,false).catch(e=>status.textContent=e.message);await navigate(page,false);
 }
 global.PersonalPreviewFrame={open,close};
})(window);
