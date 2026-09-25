'use strict';
const admin=require('firebase-admin');
const crypto=require('crypto');
const {onCall,onRequest,HttpsError}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const storage=require('./storageRouting');
if(!admin.apps.length)admin.initializeApp();
const db=admin.firestore();
const privateAccess=require('./privateCalendarAccess').createAccess(db);
const OWNER='danny700808@gmail.com', REGION='asia-east1';
const PAGE='https://danny700808.github.io/play-card/private-calendar.html';
const CALLBACK='https://asia-east1-youzi-c1b74.cloudfunctions.net/privateCalendarGoogleCallback';
const SCOPES='openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events';
const text=v=>String(v??'').trim();
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const fail=(msg,code='invalid-argument')=>{throw new HttpsError(code,msg);};
function owner(request){if(!request.auth?.uid||text(request.auth.token?.email).toLowerCase()!==OWNER)fail('這是私人行事曆，請使用自己的管理者帳號登入。','permission-denied');return request.auth.uid;}
const profile=uid=>db.collection('privateCalendarUsers').doc(hash(uid));
const validId=v=>/^[a-zA-Z0-9_-]{1,128}$/.test(text(v));
function validateEvent(input){
 const title=text(input.title).slice(0,200),start=new Date(input.start).getTime(),end=new Date(input.end).getTime();
 if(!title||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)fail('請填標題與正確的開始／結束時間。');
 const offsets=reminderOffsets(input),minutes=offsets[0]??60;
 if(input.remind===true&&!offsets.length)fail('請至少選擇一個提醒時間。');
 return {title,start:new Date(start).toISOString(),end:new Date(end).toISOString(),note:text(input.note).slice(0,12000),remind:input.remind===true,reminderMinutes:minutes,reminderOffsets:offsets,completed:input.completed===true};
}
function googleEvent(row,calendar){
 const start=row.start?.dateTime||(row.start?.date?row.start.date+'T09:00:00+08:00':null);
 return {id:hash(calendar.id+'|'+row.id),source:'google',googleId:row.id,calendarId:calendar.id,calendarName:calendar.summary,editable:['owner','writer'].includes(calendar.accessRole),title:row.summary||'未命名活動',start,end:row.end?.dateTime||(row.end?.date?row.end.date+'T00:00:00+08:00':null),allDay:!!row.start?.date,description:row.description||'',htmlLink:row.htmlLink||'',etag:row.etag,status:row.status};
}
function reminderOffsets(event){const raw=event.reminderOffsets===undefined?[Number(event.reminderMinutes??10)]:event.reminderOffsets;if(!Array.isArray(raw)||raw.length>10||raw.some(v=>!Number.isInteger(v)||![0,5,10,30,60,120,180,1440,2880,4320].includes(v)))fail('提醒時間無效。');return [...new Set(raw)].sort((a,b)=>a-b);}
function dueReminders(list,now){return list.flatMap(e=>reminderOffsets(e).map(minutes=>({...e,reminderMinutes:minutes}))).filter(e=>due(e,now));}
function due(event,now){const time=Date.parse(event.start)-Number(event.reminderMinutes??10)*60000;return event.remind===true&&!event.completed&&event.status!=='cancelled'&&Number.isFinite(time)&&time<=now&&time>now-24*3600000;}
function deliveryId(event){return hash([event.id,event.start,event.reminderMinutes,event.reminderRevision||0].join('|'));}
function currentReminder(event,note){return {...event,...note,...(event.source==='google'?{start:event.start,end:event.end,status:event.status}:{} )};}
async function configuration(){return (await db.collection('privateCalendarServer').doc('google').get()).data()||{};}
async function access(uid){
 const p=profile(uid),snap=await p.collection('secrets').doc('google').get(),s=snap.data()||{};
 if(!s.refreshToken)fail('請先連接 Google 行事曆。','failed-precondition');
 if(s.accessToken&&s.expiresAt>Date.now()+60000)return s.accessToken;
 const cfg=await configuration();
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:cfg.clientId,client_secret:cfg.clientSecret,refresh_token:s.refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
 const data=await response.json();
 if(!response.ok){await p.set({googleError:'Google 授權已失效，請重新連接。'},{merge:true});fail('Google 授權已失效，請重新連接。','failed-precondition');}
 await snap.ref.set({accessToken:data.access_token,expiresAt:Date.now()+Number(data.expires_in)*1000},{merge:true});
 return data.access_token;
}
async function google(uid,path,options={}){
 const response=await fetch('https://www.googleapis.com/calendar/v3/'+path,{...options,headers:{Authorization:'Bearer '+await access(uid),'Content-Type':'application/json',...(options.headers||{})},signal:AbortSignal.timeout(20000)});
 if(response.status===409&&options.method==='POST'&&options.body){const id=JSON.parse(options.body).id;if(id)return google(uid,path+'/'+encodeURIComponent(id));}
 if(!response.ok)fail(response.status===412?'Google 行程已被修改，請重新整理再編輯。':'Google 讀取／更新失敗（'+response.status+'），請確認授權與行事曆權限。','failed-precondition');
 return response.status===204?{}:response.json();
}
async function calendars(uid){let items=[],pageToken='';do{const data=await google(uid,'users/me/calendarList?maxResults=250'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''));items.push(...(data.items||[]));pageToken=data.nextPageToken||'';}while(pageToken);return items.map(c=>({id:c.id,summary:c.summaryOverride||c.summary,accessRole:c.accessRole,primary:!!c.primary,color:c.backgroundColor||'#5767ae'}));}
async function events(uid,start,end){
 const p=profile(uid),prefs=(await p.get()).data()||{},local=(await p.collection('entries').get()).docs.map(d=>({id:d.id,...d.data()}));
 const result=local.filter(e=>e.source==='local'&&!e.deleted&&Date.parse(e.start)<Date.parse(end)&&Date.parse(e.end)>Date.parse(start));
 const warnings=[];
 if(prefs.googleConnected){try{
  const list=await calendars(uid);
  for(const c of list.filter(c=>(prefs.calendarIds||[]).includes(c.id))){
   let pageToken='';
   do{
    const q=new URLSearchParams({timeMin:start,timeMax:end,singleEvents:'true',maxResults:'2500',timeZone:'Asia/Taipei',...(pageToken?{pageToken}:{})});
    const data=await google(uid,'calendars/'+encodeURIComponent(c.id)+'/events?'+q);
    for(const raw of data.items||[]){if(raw.status==='cancelled')continue;const row=googleEvent(raw,c),note=local.find(x=>x.id===row.id)||{};result.push({...row,note:note.note||'',assets:note.assets||[],completed:note.completed===true,remind:note.remind===true,reminderMinutes:note.reminderMinutes??10,reminderOffsets:reminderOffsets(note),reminderRevision:note.reminderRevision||0,revision:note.revision||0});}
    pageToken=data.nextPageToken||'';
   }while(pageToken);
  }
 }catch(e){warnings.push(e.message);}}
 return {events:result.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)),warnings};
}
async function targets(uid){
 const user=await admin.auth().getUser(uid);if(text(user.email).toLowerCase()!==OWNER)return [];
 const result=[];
 for(const collection of ['employees','admins']){
  const docs=await db.collection(collection).where('email','==',OWNER).get();
  for(const doc of docs.docs){const r=doc.data(),id=text(r.lineUserId||r['LINE User ID']);if(/^U[0-9a-f]{32}$/i.test(id)&&r.lineNotifyEnabled!==false&&!['disabled','inactive','revoked'].includes(text(r.status||r.accountStatus).toLowerCase()))result.push({id,name:r.name||r.displayName||'我的 LINE'});}
 }
 return [...new Map(result.map(x=>[x.id,x])).values()];
}
async function sendLine(to,message,retryKey){
 const token=text(process.env.LINE_CHANNEL_ACCESS_TOKEN);if(!token)fail('官方 LINE 發送設定尚未完成。','failed-precondition');
 const res=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Line-Retry-Key':retryKey},body:JSON.stringify({to,messages:[{type:'text',text:message.slice(0,4900)}]}),signal:AbortSignal.timeout(15000)});
 if(!res.ok&&!(res.status===409&&res.headers.get('x-line-accepted-request-id')))throw new Error('LINE 發送失敗（'+res.status+'）');
}
async function api(request){
 const uid=request.data?.calendarSession?await privateAccess.authorize(request):owner(request),data=request.data||{},p=profile(uid),action=data.action;
 if(action==='status'){
  const prefs=(await p.get()).data()||{},cfg=await configuration(),dest=await targets(uid);
  return {googleConfigured:!!(cfg.clientId&&cfg.clientSecret),googleConnected:!!prefs.googleConnected,googleEmail:prefs.googleEmail||'',googleError:prefs.googleError||'',calendarIds:prefs.calendarIds||[],lineEnabled:!!prefs.lineEnabled,lineConfigured:!!process.env.LINE_CHANNEL_ACCESS_TOKEN,targets:dest.map(t=>({key:hash(t.id),name:t.name,masked:t.id.slice(0,5)+'…'+t.id.slice(-4)})),targetKey:prefs.targetKey||'',callback:CALLBACK,lastReminderRun:prefs.lastReminderRun||null,lastReminderError:prefs.lastReminderError||'',lastSentAt:prefs.lastSentAt||null};
 }
 if(action==='connect'){
  const cfg=await configuration();if(!cfg.clientId||!cfg.clientSecret)fail('Google 串接程式已就緒；尚需設定 OAuth 用戶端。請開啟「連線設定」完成一次設定。','failed-precondition');
  const state=crypto.randomBytes(32).toString('hex');await db.collection('privateCalendarOAuthStates').doc(hash(state)).set({uid,expires:Date.now()+600000,used:false});
  return {url:'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:cfg.clientId,redirect_uri:CALLBACK,response_type:'code',scope:SCOPES,state,access_type:'offline',prompt:'consent',login_hint:OWNER})};
 }
 if(action==='configureGoogle'){
  if(!/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(text(data.clientId))||text(data.clientSecret).length<12)fail('請填入有效的 Google OAuth 用戶端 ID 與密鑰。');
  await db.collection('privateCalendarServer').doc('google').set({clientId:text(data.clientId),clientSecret:text(data.clientSecret),updatedAt:Date.now()});return {ok:true};
 }
 if(action==='disconnect'){
  const ref=p.collection('secrets').doc('google');await ref.delete();await p.set({googleConnected:false,calendarIds:[],googleEmail:'',googleError:''},{merge:true});return {ok:true};
 }
 if(action==='calendars')return {calendars:await calendars(uid)};
 if(action==='settings'){
  const patch={uid};
  if(Array.isArray(data.calendarIds)){const available=await calendars(uid);if(data.calendarIds.length>10||data.calendarIds.some(id=>!available.some(c=>c.id===id)))fail('請選擇可存取的行事曆（最多 10 本）。');patch.calendarIds=data.calendarIds;}
  if(typeof data.lineEnabled==='boolean'){const dest=(await targets(uid)).find(t=>hash(t.id)===data.targetKey);if(data.lineEnabled&&!dest)fail('請先完成自己 LINE 的綁定並選擇收件者。');patch.lineEnabled=data.lineEnabled;patch.targetKey=dest?hash(dest.id):'';}
  await p.set(patch,{merge:true});return {ok:true};
 }
 if(action==='list'){
  const start=new Date(data.start),end=new Date(data.end);if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||end-start>100*86400000)fail('查詢區間需在 100 天以內。');
  return events(uid,start.toISOString(),end.toISOString());
 }
 if(action==='detail'){
  if(!validId(data.id))fail('記事編號無效。');const note=(await p.collection('entries').doc(data.id).get()).data();if(!note||note.deleted)fail('找不到這則記事。','not-found');
  if(note.source==='google'){const prefs=(await p.get()).data()||{};if(!(prefs.calendarIds||[]).includes(note.calendarId))fail('此行事曆已取消顯示。');const c=(await calendars(uid)).find(c=>c.id===note.calendarId);if(!c)fail('無法存取行事曆。');const raw=await google(uid,'calendars/'+encodeURIComponent(c.id)+'/events/'+encodeURIComponent(note.googleId));const mapped=googleEvent(raw,c);return {event:{...note,...mapped,note:note.note||'',revision:note.revision||0}};}
  return {event:{id:data.id,...note}};
 }
 if(action==='save'){
  if(!['local','google'].includes(data.event?.source||'local'))fail('行程來源無效。');
  const validated=validateEvent(data.event||{}),id=text(data.id)||crypto.randomUUID();if(!validId(id))fail('記事編號無效。');
  const ref=p.collection('entries').doc(id),before=(await ref.get()).data()||{};
  // Google times are only changed by the separate etag-checked action.
  if(before.source==='google'||data.event.source==='google'){
   const c=(await calendars(uid)).find(c=>c.id===data.event.calendarId);if(!c)fail('無法存取此行事曆。','permission-denied');
   const raw=await google(uid,'calendars/'+encodeURIComponent(c.id)+'/events/'+encodeURIComponent(data.event.googleId));
   if(hash(c.id+'|'+raw.id)!==id)fail('活動編號不一致。');
   const mapped=googleEvent(raw,c);validated.start=mapped.start;validated.end=mapped.end;validated.title=mapped.title;
  }
  await db.runTransaction(async tx=>{
   const old=(await tx.get(ref)).data()||{};if(Number(data.revision||0)!==Number(old.revision||0))fail('這則記事已被更新，請重新整理後再儲存。','aborted');
   const reminderChanged=old.start!==validated.start||JSON.stringify(reminderOffsets(old))!==JSON.stringify(validated.reminderOffsets);
   tx.set(ref,{...validated,source:before.source||data.event.source||'local',calendarId:text(data.event.calendarId),googleId:text(data.event.googleId),assets:old.assets||[],deleted:false,revision:Number(old.revision||0)+1,reminderRevision:Number(old.reminderRevision||0)+(reminderChanged?1:0),updatedAt:Date.now()},{merge:true});
  });
  await p.set({uid},{merge:true});return {ok:true,id};
 }
 if(action==='googleWrite'){
  const event=validateEvent(data.event||{}),c=(await calendars(uid)).find(c=>c.id===data.calendarId);
  if(!c||!['owner','writer'].includes(c.accessRole))fail('此行事曆只有查看權限。','permission-denied');
  const body={summary:event.title,start:{dateTime:event.start,timeZone:'Asia/Taipei'},end:{dateTime:event.end,timeZone:'Asia/Taipei'}};
  if(!data.googleId){if(!validId(data.requestId))fail('缺少新增操作編號。');body.id=hash(uid+'|'+data.requestId);}
  if(data.googleId&&!text(data.etag))fail('缺少版本資訊，請重新整理。');
  const raw=await google(uid,'calendars/'+encodeURIComponent(c.id)+'/events'+(data.googleId?'/'+encodeURIComponent(data.googleId):''),{method:data.googleId?'PATCH':'POST',headers:data.googleId?{'If-Match':data.etag}:{},body:JSON.stringify(body)});
  return {event:googleEvent(raw,c)};
 }
 if(action==='archive'){
  if(!validId(data.id))fail('記事編號無效。');const ref=p.collection('entries').doc(data.id);
  await db.runTransaction(async tx=>{const row=(await tx.get(ref)).data();if(!row||row.source!=='local')fail('只能封存本機新增的私人行程；Google 行程請回 Google 處理。');tx.update(ref,{deleted:true,remind:false,revision:Number(row.revision||0)+1});});return {ok:true};
 }
 if(action==='upload'){
  if(!validId(data.id))fail('請先儲存記事。');const ref=p.collection('entries').doc(data.id);if(!(await ref.get()).exists)fail('記事不存在。');
  const mime=text(data.mime).split(';')[0];if(!['image/jpeg','image/png','image/webp','image/gif','audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav'].includes(mime))fail('請使用 JPG、PNG、WebP、GIF 或錄音檔。');
  if(typeof data.base64!=='string'||data.base64.length>7100000)fail('單一附件上限 5 MB。');const buffer=Buffer.from(data.base64,'base64');if(!buffer.length||buffer.length>5*1024*1024)fail('附件需小於 5 MB。');
  const asset={id:crypto.randomUUID(),name:text(data.name).slice(0,100)||'附件',mime,size:buffer.length};
  const path='private-calendar/'+hash(uid)+'/'+data.id+'/'+asset.id;
  await storage.writeBucket().file(path).save(buffer,{resumable:false,metadata:{contentType:mime,cacheControl:'private,no-store'}});
  try{await db.runTransaction(async tx=>{const row=(await tx.get(ref)).data();if(!row||row.deleted||(row.assets||[]).length>=12)fail('每則記事最多 12 個附件。');tx.update(ref,{assets:[...(row.assets||[]),asset],revision:Number(row.revision||0)+1});});}catch(e){await storage.writeBucket().file(path).delete().catch(()=>{});throw e;}
  return {asset};
 }
 if(action==='asset'){
  if(!validId(data.id)||!validId(data.assetId))fail('附件編號無效。');const row=(await p.collection('entries').doc(data.id).get()).data(),a=row?.assets?.find(a=>a.id===data.assetId);if(!a)fail('附件不存在。','not-found');
  const [buffer]=await storage.writeBucket().file('private-calendar/'+hash(uid)+'/'+data.id+'/'+a.id).download();return {mime:a.mime,base64:buffer.toString('base64')};
 }
 if(action==='testLine'){
  const dest=(await targets(uid)).find(t=>hash(t.id)===data.targetKey);if(!dest)fail('請選擇已綁定的自己的 LINE。');
  // Separate explicit button; never automatically send when configuring or deploying.
  const testRef=p.collection('deliveries').doc('test');let key;
  await db.runTransaction(async tx=>{const row=(await tx.get(testRef)).data()||{};if(Date.now()-Number(row.at||0)<60000)fail('請等一分鐘再發送測試。','resource-exhausted');key=crypto.randomUUID();tx.set(testRef,{at:Date.now(),key});});
  await sendLine(dest.id,'🔔 柚子私人行事曆測試提醒\n連線正常。查看行事曆：\n'+PAGE,key);return {ok:true};
 }
 fail('不支援的操作。');
}
async function callback(req,res){
 res.set('Cache-Control','no-store');
 try{
  if(typeof req.query.state!=='string'||typeof req.query.code!=='string')throw new Error('授權取消或缺少驗證資料，請回記事頁重新連接。');
  const ref=db.collection('privateCalendarOAuthStates').doc(hash(req.query.state));let uid;
  await db.runTransaction(async tx=>{const row=(await tx.get(ref)).data();if(!row||row.used||row.expires<Date.now())throw new Error('授權連結已過期。');uid=row.uid;tx.update(ref,{used:true});});
  const user=await admin.auth().getUser(uid);if(text(user.email).toLowerCase()!==OWNER)throw new Error('帳號不符。');
  const cfg=await configuration(),response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:cfg.clientId,client_secret:cfg.clientSecret,code:req.query.code,redirect_uri:CALLBACK,grant_type:'authorization_code'}),signal:AbortSignal.timeout(15000)}),token=await response.json();
  if(!response.ok||!token.refresh_token)throw new Error('未取得持續同步授權，請重新連接並同意要求的權限。');
  const info=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});const person=await info.json();
  if(!info.ok||text(person.email).toLowerCase()!==OWNER||person.email_verified!==true)throw new Error('請使用 '+OWNER+' 的 Google 帳號授權。');
  const p=profile(uid);await p.collection('secrets').doc('google').set({refreshToken:token.refresh_token,accessToken:token.access_token,expiresAt:Date.now()+Number(token.expires_in)*1000});
  const list=await calendars(uid);const existing=(await p.get()).data()||{};
  await p.set({uid,googleConnected:true,googleEmail:person.email,googleError:'',calendarIds:existing.calendarIds?.length?existing.calendarIds.filter(id=>list.some(c=>c.id===id)):list.filter(c=>c.primary||c.summary==='豐原西南社').map(c=>c.id)},{merge:true});
  res.redirect(302,PAGE+'?connected=1');
 }catch(e){res.status(400).type('text/plain').send('Google 連接未完成：'+e.message+'\n請返回 '+PAGE);}
}
async function reminders(){
 const users=await db.collection('privateCalendarUsers').where('lineEnabled','==',true).get();
 for(const doc of users.docs){const prefs=doc.data(),uid=prefs.uid;if(!uid)continue;
  try{
   const recipient=(await targets(uid)).find(t=>hash(t.id)===prefs.targetKey);if(!recipient)throw new Error('LINE 綁定已失效，請重新選擇自己的 LINE。');
   const now=Date.now(),list=await events(uid,new Date(now-2*86400000).toISOString(),new Date(now+4*86400000).toISOString());
   for(const event of dueReminders(list.events,now)){
    const ref=doc.ref.collection('deliveries').doc(deliveryId(event));let key,claimed=false;
    await db.runTransaction(async tx=>{const r=(await tx.get(ref)).data()||{};if(r.status==='sent'||r.leaseUntil>now)return;key=r.key||crypto.randomUUID();tx.set(ref,{key,status:'sending',leaseUntil:now+120000,eventId:event.id,at:now},{merge:true});claimed=true;});
    if(!claimed)continue;
    try{
     const latest=(await doc.ref.collection('entries').doc(event.id).get()).data(),freshPrefs=(await doc.ref.get()).data()||{};
     if(!freshPrefs.lineEnabled||freshPrefs.targetKey!==prefs.targetKey||!latest||latest.deleted||!latest.remind||latest.completed||!reminderOffsets(latest).includes(event.reminderMinutes)||deliveryId({...currentReminder(event,latest),reminderMinutes:event.reminderMinutes})!==deliveryId(event)){await ref.set({status:'cancelled',leaseUntil:0},{merge:true});continue;}
     if(event.source==='google'){
      const raw=await google(uid,'calendars/'+encodeURIComponent(event.calendarId)+'/events/'+encodeURIComponent(event.googleId));
      const current=googleEvent(raw,{id:event.calendarId,summary:event.calendarName});
      if(current.status==='cancelled'||Date.parse(current.start)!==Date.parse(event.start)||!(freshPrefs.calendarIds||[]).includes(event.calendarId)){await ref.set({status:'cancelled',leaseUntil:0},{merge:true});continue;}
     }
     const when=new Date(event.start).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
     await sendLine(recipient.id,'🔔 '+event.title+'\n'+when+(event.note?'\n'+event.note.slice(0,500):'')+'\n查看圖片／錄音：\n'+PAGE+'?event='+encodeURIComponent(event.id)+'&openExternalBrowser=1',key);
     await ref.set({status:'sent',sentAt:Date.now(),leaseUntil:0},{merge:true});await doc.ref.set({lastSentAt:Date.now()},{merge:true});
    }catch(e){await ref.set({status:'failed',error:e.message,leaseUntil:0},{merge:true});throw e;}
   }
   await doc.ref.set({lastReminderRun:Date.now(),lastReminderError:list.warnings.join('；')},{merge:true});
  }catch(e){await doc.ref.set({lastReminderRun:Date.now(),lastReminderError:e.message},{merge:true});}
 }
}
function register(exports){require('./sharedCalendar').register(exports);exports.privateCalendarAccess=onCall({region:REGION,timeoutSeconds:60,memory:'256MiB',maxInstances:3},privateAccess.api);exports.privateCalendarApi=onCall({region:REGION,timeoutSeconds:120,memory:'512MiB',maxInstances:5},api);exports.privateCalendarGoogleCallback=onRequest({region:REGION,timeoutSeconds:60,maxInstances:3},callback);exports.privateCalendarReminders=onSchedule({schedule:'every 1 minutes',timeZone:'Asia/Taipei',region:REGION,timeoutSeconds:120,maxInstances:1},reminders);}
module.exports={register,_test:{owner,validateEvent,googleEvent,due,reminderOffsets,dueReminders,deliveryId,validId,currentReminder,api,callback}};
