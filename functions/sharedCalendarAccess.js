'use strict';
const crypto=require('crypto'),{promisify}=require('util'),scrypt=promisify(crypto.scrypt);
const {HttpsError}=require('firebase-functions/v2/https');
const webauthn=require('@simplewebauthn/server');
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const random=()=>crypto.randomBytes(32).toString('base64url');
const validToken=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
function fail(message,code='permission-denied'){throw new HttpsError(code,message);}
const RP='danny700808.github.io',ORIGIN='https://'+RP;
function createSharedAccess({db,ownerSession,verifier=webauthn}){
 const memberRef=id=>db.doc('sharedCalendarMembers/'+id);
 async function ownerUid(){const cfg=(await db.doc('privateCalendarServer/access').get()).data();if(!cfg?.uid)fail('管理者入口尚未設定。');return cfg.uid;}
 async function member(id){if(!validId(id))fail('成員入口無效。','unauthenticated');const m=(await memberRef(id).get()).data();if(!m||m.ownerUid!==await ownerUid()||m.status!=='active')fail('成員未啟用或權限已取消。','unauthenticated');return {id,...m};}
 async function identity(request){
  const d=request.data||{};
  if(d.calendarSession){const s=await ownerSession(d.calendarSession);if(s.uid!==await ownerUid())fail('管理者身分不符。');return {id:'owner',ownerUid:s.uid,name:'管理者',role:'owner',createdAt:s.createdAt};}
  if(!validToken(d.teamSession))fail('請先登入共用行事曆。','unauthenticated');
  const s=(await db.doc('sharedCalendarSessions/'+hash(d.teamSession)).get()).data();
  if(!s||s.expiresAt<=Date.now())fail('登入已過期，請重新登入。','unauthenticated');
  const m=await member(s.memberId);if(s.version!==m.version||s.ownerUid!==m.ownerUid)fail('權限已更新，請重新登入。','unauthenticated');
  return {id:m.id,ownerUid:m.ownerUid,name:m.name,role:'member',createdAt:s.createdAt};
 }
 async function issue(m){const token=random(),now=Date.now();await db.doc('sharedCalendarSessions/'+hash(token)).set({memberId:m.id,ownerUid:m.ownerUid,version:m.version,createdAt:now,expiresAt:now+8*3600000});return {token,memberId:m.id,name:m.name};}
 async function throttle(request,kind,limit){const ip=request.rawRequest?.ip||'unknown',ref=db.doc('sharedCalendarLimits/'+hash(kind+'|'+ip));await db.runTransaction(async tx=>{const r=(await tx.get(ref)).data()||{},now=Date.now(),count=r.until>now?r.count:0;if(count>=limit)fail('嘗試次數過多，請十五分鐘後再試。','resource-exhausted');tx.set(ref,{count:count+1,until:r.until>now?r.until:now+900000});});}
 async function challenge(options,kind,m){const ticket=random();await db.doc('sharedCalendarChallenges/'+hash(ticket)).set({challenge:options.challenge,kind,memberId:m.id,version:m.version,expiresAt:Date.now()+300000});return {ticket,options};}
 async function consume(ticket,kind,m){if(!validToken(ticket))fail('驗證已失效。');return db.runTransaction(async tx=>{const ref=db.doc('sharedCalendarChallenges/'+hash(ticket)),c=(await tx.get(ref)).data();if(!c||c.used||c.kind!==kind||c.memberId!==m.id||c.version!==m.version||c.expiresAt<Date.now())fail('驗證已失效，請重試。');tx.update(ref,{used:true});return c.challenge;});}
 async function freshMember(request){const who=await identity(request);if(who.role!=='member'||who.createdAt<Date.now()-300000)fail('請重新用自己的密碼登入，再啟用 Face ID。');return member(who.id);}
 async function api(request){
  const d=request.data||{},action=d.action;
  if(action==='logout'){if(validToken(d.teamSession))await db.doc('sharedCalendarSessions/'+hash(d.teamSession)).delete();return {ok:true};}
  await throttle(request,'access',80);
  if(action==='activate'){
   await throttle(request,'password',8);if(!validToken(d.invite)||typeof d.password!=='string'||d.password.length<10||d.password.length>128)fail('邀請無效，或密碼未滿 10 個字元。','invalid-argument');
   const salt=random(),passwordHash=(await scrypt(d.password,salt,64)).toString('hex'),ref=db.doc('sharedCalendarInvites/'+hash(d.invite)),uid=await ownerUid();let activated;
   await db.runTransaction(async tx=>{const invite=(await tx.get(ref)).data();if(!invite||invite.used||invite.expiresAt<Date.now()||invite.ownerUid!==uid)fail('邀請已使用或過期，請管理者重新邀請。');const mr=memberRef(invite.memberId),m=(await tx.get(mr)).data();if(!m||m.status!=='invited'||m.version!==invite.version||m.ownerUid!==uid)fail('邀請已撤銷。');activated={...m,id:invite.memberId,status:'active'};tx.update(ref,{used:true});tx.update(mr,{status:'active',passwordSalt:salt,passwordHash,activatedAt:Date.now()});});
   return issue(activated);
  }
  if(action==='password'){
   await throttle(request,'password',8);const m=await member(d.memberId);if(typeof d.password!=='string'||d.password.length>128)fail('密碼不正確。','unauthenticated');const expected=Buffer.from(m.passwordHash||'','hex'),actual=await scrypt(d.password,m.passwordSalt||'',64);if(expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual))fail('密碼不正確。','unauthenticated');return issue(m);
  }
  const credentials=db.collection('sharedCalendarPasskeys');
  if(action==='registrationOptions'){
   const m=await freshMember(request),keys=(await credentials.where('memberId','==',m.id).get()).docs.map(d=>d.data()).filter(k=>k.version===m.version);if(keys.length>=8)fail('已達裝置數量上限。');
   return challenge(await verifier.generateRegistrationOptions({rpName:'柚子共用工作行事曆',rpID:RP,userID:Buffer.from(hash('shared|'+m.id),'hex'),userName:m.id,userDisplayName:m.name,attestationType:'none',excludeCredentials:keys.map(k=>({id:k.id,transports:k.transports})),authenticatorSelection:{residentKey:'required',userVerification:'required',authenticatorAttachment:'platform'}}),'register',m);
  }
  if(action==='registrationVerify'){
   const m=await freshMember(request),expectedChallenge=await consume(d.ticket,'register',m);let v;try{v=await verifier.verifyRegistrationResponse({response:d.response,expectedChallenge,expectedOrigin:ORIGIN,expectedRPID:RP,requireUserVerification:true});}catch{fail('裝置驗證未完成。');}if(!v.verified)fail('裝置驗證未完成。');const c=v.registrationInfo.credential;await credentials.doc(hash(c.id)).create({id:c.id,memberId:m.id,version:m.version,publicKey:Buffer.from(c.publicKey).toString('base64'),counter:c.counter,transports:c.transports||[]});return {ok:true};
  }
  if(action==='authenticationOptions'){
   const m=await member(d.memberId),keys=(await credentials.where('memberId','==',m.id).get()).docs.map(d=>d.data()).filter(k=>k.version===m.version);if(!keys.length)fail('請先用自己的密碼登入，再啟用 Face ID。');return challenge(await verifier.generateAuthenticationOptions({rpID:RP,userVerification:'required',allowCredentials:keys.map(k=>({id:k.id,transports:k.transports}))}),'login',m);
  }
  if(action==='authenticationVerify'){
   const m=await member(d.memberId),expectedChallenge=await consume(d.ticket,'login',m),ref=credentials.doc(hash(d.response?.id||'')),k=(await ref.get()).data();if(!k||k.memberId!==m.id||k.version!==m.version)fail('通行密鑰不屬於此成員。');let v;try{v=await verifier.verifyAuthenticationResponse({response:d.response,expectedChallenge,expectedOrigin:ORIGIN,expectedRPID:RP,requireUserVerification:true,credential:{id:k.id,publicKey:Buffer.from(k.publicKey,'base64'),counter:k.counter,transports:k.transports}});}catch{fail('Face ID 驗證未完成。');}if(!v.verified)fail('Face ID 驗證未完成。');await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(!current||current.counter!==k.counter)fail('請重新驗證。');tx.update(ref,{counter:v.authenticationInfo.newCounter});});return issue(m);
  }
  fail('不支援的登入操作。','invalid-argument');
 }
 return {api,identity,ownerUid,member};
}
module.exports={createSharedAccess,hash,random,validId,fail};
