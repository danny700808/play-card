'use strict';
const crypto=require('crypto');
const {HttpsError,onCall,onRequest}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const PAGE='https://danny700808.github.io/play-card/enrollment.html';
const SITE='https://youzi-music-enrollment-preview.danny700808.chatgpt.site/';
const CALLBACK='https://asia-east1-youzi-c1b74.cloudfunctions.net/coursePortalLineLoginCallback';
const CONSENT_VERSION='enrollment-line-2026-11-15-v1';
const OFFICIAL_LINE='https://lin.ee/Fx5Y2mL';
const C={invites:'onlineEnrollmentInvites',oauth:'onlineEnrollmentOAuth',grants:'onlineEnrollmentGrants',records:'onlineEnrollmentSubmissions',limits:'onlineEnrollmentLimits'};
const clean=v=>String(v==null?'':v).trim(),hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const random=()=>crypto.randomBytes(32).toString('base64url');
const formKey=v=>JSON.stringify(Object.keys(v).sort().map(k=>[k,v[k]]));
const token=v=>/^[\w-]{43}$/.test(clean(v)),id=v=>/^[a-zA-Z0-9_-]{1,130}$/.test(clean(v));
const fail=(message,code='failed-precondition')=>{throw new HttpsError(code,message);};
const dayKey=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
function dateValid(date,time,now){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:(00|30)$/.test(time))return false;
 const d=new Date(date+'T12:00:00+08:00'),today=dayKey(now),last=dayKey(new Date(today+'T12:00:00+08:00').getTime()+45*86400000);
 if(!Number.isFinite(d.getTime())||dayKey(d)!==date||date<today||date>last||d.getUTCDay()===1)return false;
 const start=[0,6].includes(d.getUTCDay())?'10:00':'12:30';
 return time>=start&&time<='20:00'&&new Date(date+'T'+time+':00+08:00').getTime()>now;
}
function assertManager(r){
 const t=r?.auth?.token||{},role=clean(t.role||t.userRole||t.permissionRole).toLowerCase();
 if(!r?.auth?.uid||!(t.admin===true||t.manager===true||t.owner===true||['admin','manager','owner','主管','管理者'].includes(role)||clean(t.email).toLowerCase()==='danny700808@gmail.com'))fail('請先以管理者帳號登入。','permission-denied');
 return clean(t.email||r.auth.uid);
}
function createEnrollmentService({db,catalog,scheduler,now=Date.now,stamp=()=>Date.now()}){
 const col=k=>db.collection(C[k]),row=async(k,key)=>(await col(k).doc(key).get()).data();
 function activeInvite(r){return r&&r.active===true&&r.expiresAt>now()&&Number(r.usedCount||0)<Number(r.maxSubmissions||100);}
 async function invite(raw){if(!token(raw))fail('請使用教室提供的測試邀請連結。','permission-denied');const key=hash(raw),r=await row('invites',key);if(!activeInvite(r))fail('這個測試邀請已到期或停止使用，請聯絡教室。','permission-denied');return {key,row:r};}
 async function form(value){
  const f=value||{},data=await catalog(),course=data.courses.find(c=>String(c.id)===String(f.courseId)),option=course?.options.find(p=>p.id===f.optionId);
  if(!course||!option)fail('課程或班別已更新，請重新選擇。');
  const out={courseId:course.id,subjectId:course.subjectId,courseName:course.name,optionId:option.id,optionName:option.name,price:option.price,lessons:option.lessons,people:option.people,date:clean(f.date),time:clean(f.time),name:clean(f.name),secondName:option.id==='duo'?clean(f.secondName):'',phone:clean(f.phone).replace(/[\s()-]/g,''),email:clean(f.email).toLowerCase(),note:clean(f.note)};
  if(!out.name||out.name.length>80||out.secondName.length>80||(option.id==='duo'&&(!out.secondName||out.name===out.secondName)))fail('請填寫上課人的姓名。');
  if(!/^(09\d{8}|\+8869\d{8})$/.test(out.phone)||out.email.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)||out.note.length>600)fail('請確認手機、Email 或其他需求的內容。');
  if(!dateValid(out.date,out.time,now()))fail('請選擇未來 45 天內、週二至週日的有效時段。');
  return out;
 }
 async function rate(key,max){
  const ref=col('limits').doc(hash(key));
  await db.runTransaction(async tx=>{const r=(await tx.get(ref)).data()||{},count=r.until>now()?r.count:0;if(count>=max)fail('操作較頻繁，請稍後再試。','resource-exhausted');tx.set(ref,{count:count+1,until:r.until>now()?r.until:now()+3600000,expiresAt:now()+86400000});});
 }
 async function start(d,request){
  const i=clean(d.invite)?await invite(d.invite):{key:''};
  if(d.consent!==true||d.consentVersion!==CONSENT_VERSION||!/^[a-f0-9]{64}$/.test(clean(d.challenge))||!token(d.submissionKey))fail('請先確認資料並勾選 LINE 綁定同意。','invalid-argument');
  const returnUrl=d.returnUrl===SITE?SITE:PAGE;
  if(d.returnUrl&&![PAGE,SITE].includes(d.returnUrl))fail('報名返回網址無效。','invalid-argument');
  const f=await form(d.form);await rate('ip|'+clean(request?.ip||'unknown'),20);if(i.key)await rate('invite|'+i.key,150);
  const state='en_'+random(),oauthVerifier=random();
  await col('oauth').doc(hash(state)).create({status:'pending',form:f,inviteId:i.key,submissionKey:d.submissionKey,challenge:d.challenge,consentVersion:CONSENT_VERSION,consentAt:now(),returnUrl,callbackUrl:CALLBACK,oauthVerifier,createdAt:now(),expiresAt:now()+600000});
  const p=new URLSearchParams({response_type:'code',client_id:'2010902226',redirect_uri:CALLBACK,state,scope:'openid profile',bot_prompt:'normal',code_challenge:crypto.createHash('sha256').update(oauthVerifier).digest('base64url'),code_challenge_method:'S256'});
  return {authorizationUrl:'https://access.line.me/oauth2/v2.1/authorize?'+p.toString()};
 }
 async function callback(req,res,{exchange,profile}){
  res.set('Cache-Control','no-store, max-age=0');res.set('Referrer-Policy','no-referrer');
  if(req.method!=='GET')return res.status(405).send('Method Not Allowed');
  const state=clean(req.query?.state);let target=PAGE,ref;
  try{
   if(!/^en_[\w-]{43}$/.test(state))fail('LINE 驗證已失效，請重新操作。');
   ref=col('oauth').doc(hash(state));
   const r=await db.runTransaction(async tx=>{const v=(await tx.get(ref)).data();if(!v||v.status!=='pending'||v.expiresAt<=now())fail('LINE 驗證已處理或逾時，請回原頁面重新操作。');tx.update(ref,{status:'processing'});return v;});
   target=[PAGE,SITE].includes(r.returnUrl)?r.returnUrl:PAGE;
   if(req.query.error||!req.query.code){await ref.update({status:'cancelled',form:null,oauthVerifier:''});return res.redirect(302,target+'#enrollmentError=cancelled');}
   const access=await exchange(clean(req.query.code),r.callbackUrl,r.oauthVerifier),p=await profile(access.access_token);
   if(!/^U[a-f0-9]{32}$/i.test(p.lineUserId||''))fail('無法確認 LINE 帳號，請重新操作。');
   const grant=random();
   await db.runTransaction(async tx=>{
    const fresh=(await tx.get(ref)).data(),i=r.inviteId?(await tx.get(col('invites').doc(r.inviteId))).data():null;
    if(fresh?.status!=='processing'||fresh.expiresAt<=now()||(r.inviteId&&!activeInvite(i)))fail('LINE 驗證已失效，請重新操作。');
    tx.create(col('grants').doc(hash(grant)),{...r,oauthVerifier:'',status:'verified',profile:{lineUserId:p.lineUserId,lineDisplayName:clean(p.lineDisplayName).slice(0,100),lineFriendFlag:p.lineFriendFlag===true},expiresAt:now()+600000});
    tx.update(ref,{status:'complete',form:null,oauthVerifier:''});
   });
   return res.redirect(302,target+'#enrollmentTicket='+encodeURIComponent(grant));
  }catch(e){
   if(ref)await ref.update({form:null,oauthVerifier:''}).catch(()=>{});
   return res.redirect(302,target+'#enrollmentError=expired');
  }
 }
 function receipt(r,key){return {receiptId:key,courseName:r.form.courseName,optionName:r.form.optionName,price:r.form.price,lessons:r.form.lessons,date:r.form.date,time:r.form.time,name:r.form.name,secondName:r.form.secondName,lineDisplayName:r.line.lineDisplayName,lineFriendFlag:r.line.lineFriendFlag,officialLineUrl:OFFICIAL_LINE};}
 async function redeem(d){
  if(!token(d.ticket)||!token(d.verifier))fail('請回原本填寫的瀏覽器完成 LINE 綁定。');
  const ref=col('grants').doc(hash(d.ticket)),t=(await ref.get()).data();
  if(!t||t.challenge!==hash(d.verifier)||t.expiresAt<=now())fail('請回原本填寫的瀏覽器，或重新綁定 LINE。');
  if(t.status==='used'){const r=await row('records',t.receiptId);if(r)return receipt(r,t.receiptId);fail('找不到報名資料。');}
  if(t.status!=='verified')fail('LINE 驗證尚未完成。');
  const f=await form(t.form);
  if(formKey(f)!==formKey(t.form))fail('課程資訊已更新，請重新確認報名。');
  const key='enr-'+hash((t.inviteId||'direct')+'|'+t.submissionKey).slice(0,32),recordRef=col('records').doc(key);
  return db.runTransaction(async tx=>{
   const g=(await tx.get(ref)).data(),ir=t.inviteId?col('invites').doc(t.inviteId):null,i=ir?(await tx.get(ir)).data():null,existing=(await tx.get(recordRef)).data();
   if(!g||g.challenge!==hash(d.verifier)||g.expiresAt<=now())fail('LINE 驗證已失效。');
   if(g.status==='used'&&existing)return receipt(existing,key);
   if(g.status!=='verified'||(ir&&!activeInvite(i)))fail('LINE 驗證或報名連結已失效，請重新操作。');
   if(existing&&(existing.line.lineUserId!==g.profile.lineUserId||formKey(existing.form)!==formKey(g.form)))fail('這份報名已經送出，請重新開始另一份報名。');
   const r=existing||{form:g.form,line:g.profile,inviteId:g.inviteId||'',inviteLabel:i?.label||'直接報名',source:ir?'legacy-invite':'direct',status:'received',version:1,consent:{version:g.consentVersion,acceptedAt:g.consentAt,verifiedAt:now()},createdAt:now(),updatedAt:now(),studentIds:[],messages:[],managerNote:''};
   if(!existing){
    const notice=require('./enrollmentNotifications').managerNotification(key,r,stamp()),queueRef=db.collection('notificationQueue').doc(notice.queueId),queued=await tx.get(queueRef);
    r.managerNotification={queueId:notice.queueId,queuedAt:now()};
    tx.create(recordRef,r);if(!queued.exists)tx.create(queueRef,notice);if(ir)tx.update(ir,{usedCount:Number(i.usedCount||0)+1});
   }
   tx.update(ref,{status:'used',form:null,profile:null,receiptId:key});
   return receipt(r,key);
  });
 }
 async function publicApi(d,req){
  if(d.action==='status')return {consentVersion:CONSENT_VERSION,officialLineUrl:OFFICIAL_LINE};
  if(d.action==='inviteStatus'){const i=await invite(d.invite);return {label:i.row.label||'課程報名',consentVersion:CONSENT_VERSION,officialLineUrl:OFFICIAL_LINE};}
  if(d.action==='start')return start(d,req);
  if(d.action==='redeem')return redeem(d);
  fail('不支援的操作。','invalid-argument');
 }
 async function matches(r){
  const [profiles,mirror]=await Promise.all([db.collection('coursePortalStudentProfiles').get(),db.collection('opsEducationMirrorStudents').get()]);
  const values=new Map();
  for(const doc of mirror.docs){const v=doc.data().source||{};if(doc.data().sourceActive!==false)values.set(clean(v.id||v._id||doc.id),v);}
  for(const doc of profiles.docs)values.set(doc.id,{...(values.get(doc.id)||{}),...doc.data()});
  return [...values].filter(([key,v])=>v.active!==false&&(clean(v.phone).replace(/[\s()-]/g,'')===r.form.phone||[r.form.name,r.form.secondName].includes(clean(v.name)))).map(([key,v])=>({id:key,name:clean(v.name),phone:clean(v.phone)})).slice(0,25);
 }
 async function adminApi(request){
  const actor=assertManager(request),d=request.data||{};
  if(d.action==='invites'){
   const s=await col('invites').orderBy('createdAt','desc').limit(30).get();
   return {invites:s.docs.map(x=>({id:x.id,...x.data()}))};
  }
  if(d.action==='createInvite'){
   const raw=random(),key=hash(raw),v={label:clean(d.label).slice(0,60)||'朋友測試',active:true,createdAt:now(),expiresAt:now()+14*86400000,maxSubmissions:100,usedCount:0,createdBy:actor};
   // Keep only a hash; the secret link is returned once to the manager.
   await col('invites').doc(key).create(v);return {id:key,...v,url:PAGE+'#invite='+raw};
  }
  if(d.action==='revokeInvite'){if(!/^[a-f0-9]{64}$/.test(d.id||''))fail('邀請編號無效。');await col('invites').doc(d.id).update({active:false,revokedAt:now(),revokedBy:actor});return {ok:true};}
  if(d.action==='list'){
   let query=col('records').orderBy('createdAt','desc').limit(100);
   if(d.cursor){if(!id(d.cursor))fail('分頁編號無效。');const cursor=await col('records').doc(d.cursor).get();if(!cursor.exists)fail('分頁資料已更新，請重新整理。');query=query.startAfter(cursor);}
   const s=await query.get();return {records:s.docs.map(x=>{const {messages,...record}=x.data();return {id:x.id,...record};}),nextCursor:s.docs.length===100?s.docs.at(-1).id:''};
  }
  if(!id(d.id))fail('報名編號無效。','invalid-argument');
  const ref=col('records').doc(d.id),r=(await ref.get()).data();if(!r)fail('找不到這份報名。','not-found');
  if(['scheduleOptions','saveScheduleDraft','confirmSchedule'].includes(d.action))return require('./enrollmentScheduling').createEnrollmentScheduling({db,scheduler,matches,now,stamp}).run(d,r,actor);
  if(d.action==='detail'){
   const messages=await Promise.all((r.messages||[]).slice(-30).map(async m=>{const q=(await db.collection('notificationQueue').doc(m.queueId).get()).data()||{};return {...m,status:q.status||'待發送',error:q.lastError||''};}));
   const notice=r.managerNotification?.queueId?(await db.collection('notificationQueue').doc(r.managerNotification.queueId).get()).data():null;
   const managerNotification={queueId:r.managerNotification?.queueId||'',status:notice?.status||'尚未建立通知',error:notice?.lastError||'',sentAt:notice?.sentAt||null};
   return {record:{id:d.id,...r,messages,managerNotification},matches:await matches(r)};
  }
  if(d.action==='update'){
   if(!['received','contacted','admitted','scheduled','closed'].includes(d.status)||(d.status==='admitted'&&!r.studentIds?.length)||(d.status==='scheduled'&&!r.schedule)||(r.schedule&&!['scheduled','closed'].includes(d.status)))fail('處理狀態無效。');
   const note=clean(d.note);if(note.length>2000)fail('備註最多 2000 字。');
   await db.runTransaction(async tx=>{const v=(await tx.get(ref)).data();if(v.version!==d.version)fail('資料已更新，請重新開啟。','aborted');tx.update(ref,{status:d.status,managerNote:note,version:v.version+1,updatedAt:now(),updatedBy:actor});});return {ok:true};
  }
  if(d.action==='admit'){
   if(r.studentIds?.length)return {studentIds:r.studentIds};
   const candidates=await matches(r),names=[r.form.name,...(r.form.secondName?[r.form.secondName]:[])],selected=Array.isArray(d.studentIds)?d.studentIds:[];
   if(selected.length!==names.length)fail('請確認每位學生的建檔方式。');
   const ids=selected.map((v,n)=>{if(v==='new')return 'online-'+d.id+'-'+(n+1);if(!candidates.some(c=>c.id===v))fail('請從符合的學生名單選擇，或建立新資料。');return v;});
   if(new Set(ids).size!==ids.length)fail('兩位學生不可選擇同一份資料。');
   const bindings=ids.map(sid=>db.collection('coursePortalStudentBindings').doc(hash('enrollment|'+sid+'|'+r.line.lineUserId)));
   const savedIds=await db.runTransaction(async tx=>{
    const v=(await tx.get(ref)).data();if(v.studentIds?.length)return v.studentIds;
    if(v.version!==d.version)fail('資料已更新，請重新開啟。','aborted');
    const refs=ids.map(sid=>db.collection('coursePortalStudentProfiles').doc(sid)),snapshots=await Promise.all(refs.map(x=>tx.get(x)));
    const oldBindings=await Promise.all(bindings.map(x=>tx.get(x)));
    if(oldBindings.some(b=>b.exists&&b.data().status!=='active'))fail('此學生的 LINE 綁定曾停用，請至綁定管理確認。');
    ids.forEach((sid,n)=>{
     if(selected[n]==='new'){
      if(snapshots[n].exists)fail('學生建檔編號已使用，請重新整理。');
      tx.create(refs[n],{id:sid,name:names[n],phone:r.form.phone,email:r.form.email,active:true,studentActive:true,managerCreated:true,managerNote:'由線上報名確認建檔',enrollmentId:d.id,updatedAt:stamp(),updatedBy:actor});
     }
     if(!oldBindings[n].exists)tx.create(bindings[n],{id:bindings[n].id,type:'student',studentId:sid,targetId:sid,targetName:names[n],name:names[n],phone:r.form.phone,email:r.form.email,status:'active',method:'line',lineUserId:r.line.lineUserId,lineDisplayName:r.line.lineDisplayName,lineFriendFlag:r.line.lineFriendFlag,authAccountId:hash('line-account|student|'+r.line.lineUserId),approvedAt:stamp(),approvedBy:actor,sourceEnrollmentId:d.id,createdAt:stamp()});
    });
    tx.update(ref,{studentIds:ids,status:'admitted',version:v.version+1,updatedAt:now(),updatedBy:actor});
    return ids;
   });return {studentIds:savedIds};
  }
  if(d.action==='message'){
   const text=clean(d.text);if(!text||text.length>2000||!token(d.operationId))fail('請填寫訊息，最多 2000 字。');
   if(!r.line.lineFriendFlag)fail('此帳號尚未確認加入官方 LINE，請先使用電話或請對方從報名完成頁開啟官方 LINE。');
   const qid='enrollment-'+hash(d.id+'|'+d.operationId),qr=db.collection('notificationQueue').doc(qid);
   await db.runTransaction(async tx=>{
    const fresh=(await tx.get(ref)).data(),q=(await tx.get(qr)).data();if(q){if(q.body!==text)fail('訊息編號已使用。');return;}
    if((fresh.messages||[]).length>=100)fail('此筆報名已達訊息上限，請改由官方 LINE 後台聯絡。');
    tx.create(qr,{queueId:qid,channel:'line',status:'待發送',source:'online-enrollment-admin',eventCode:'online_enrollment_contact',targetLineUserId:fresh.line.lineUserId,targetName:fresh.form.name,title:'柚子樂器｜課程報名',body:text,emailFallbackEnabled:false,enrollmentId:d.id,createdAt:stamp(),createdBy:actor});
    tx.update(ref,{messages:[...(fresh.messages||[]),{queueId:qid,text,createdAt:now(),createdBy:actor}],status:fresh.status==='received'?'contacted':fresh.status,version:fresh.version+1,updatedAt:now()});
   });return {queueId:qid,status:'待發送'};
  }
  fail('不支援的管理操作。','invalid-argument');
 }
 async function cleanup(){
  let removed=0;for(const key of ['oauth','grants','limits']){const s=await col(key).where('expiresAt','<',now()-86400000).limit(400).get();if(s.docs.length){const b=db.batch();s.docs.forEach(x=>b.delete(x.ref));await b.commit();removed+=s.docs.length;}}return removed;
 }
 return {publicApi,adminApi,callback,cleanup};
}
let service;
function instance(){
 if(service)return service;const admin=require('firebase-admin');if(!admin.apps.length)admin.initializeApp();const db=admin.firestore();
 service=createEnrollmentService({db,catalog:require('./enrollmentCatalog').createEnrollmentCatalog({db}),scheduler:{context:()=>require('./coursePortal').enrollmentScheduleContext(),commit:(data,integration)=>require('./coursePortal').commitEnrollmentSchedule(data,integration)},stamp:()=>admin.firestore.FieldValue.serverTimestamp()});return service;
}
function register(exports){
 const origins=['https://danny700808.github.io',new URL(SITE).origin,/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
 exports.enrollmentPublicHttp=onRequest({region:['asia-east1','us-central1'],cors:origins,timeoutSeconds:60,memory:'256MiB'},async(req,res)=>{
  res.set('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({ok:false,message:'Method Not Allowed'});
  try{if((req.rawBody?.length||0)>20000)fail('表單內容過大。','invalid-argument');const result=await instance().publicApi(req.body||{},req);res.json({ok:true,...result});}
  catch(e){const status=e.code==='permission-denied'?403:e.code==='resource-exhausted'?429:400;res.status(status).json({ok:false,message:e instanceof HttpsError?e.message:'暫時無法處理，請稍後再試。'});}
 });
 exports.enrollmentAdmin=onCall({region:['asia-east1','us-central1'],cors:origins,timeoutSeconds:180,memory:'1GiB'},r=>instance().adminApi(r));
 exports.enrollmentCleanup=onSchedule({region:'asia-east1',schedule:'every day 04:30',timeZone:'Asia/Taipei'},()=>instance().cleanup());
}
module.exports={register,createEnrollmentService,callback:(req,res,deps)=>instance().callback(req,res,deps),dateValid,assertManager,CONSENT_VERSION,PAGE,SITE,C};
