'use strict';
const crypto=require('crypto'),{promisify}=require('util'),scrypt=promisify(crypto.scrypt);
const {HttpsError}=require('firebase-functions/v2/https');
const webauthn=require('@simplewebauthn/server');
const OWNER='danny700808@gmail.com',RP='danny700808.github.io',ORIGIN='https://'+RP;
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const deny=(message='登入已失效，請用 Face ID 或專用密碼重新進入。',code='unauthenticated')=>{throw new HttpsError(code,message);};
async function passwordMatches(password,cfg){if(typeof password!=='string'||password.length>256||!cfg.passwordHash||!cfg.passwordSalt)return false;const expected=Buffer.from(cfg.passwordHash,'hex'),actual=await scrypt(password,cfg.passwordSalt,64);return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);}
function createAccess(db,verifier=webauthn){
 const config=async()=>{const c=(await db.doc('privateCalendarServer/access').get()).data();if(!c?.uid||!c.passwordHash)deny('專用入口尚未啟用。','failed-precondition');return c;};
 async function session(token){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))deny();const [cfg,snap]=await Promise.all([config(),db.doc('privateCalendarSessions/'+hash(token)).get()]);const s=snap.data();if(!s||s.expiresAt<Date.now()||s.uid!==cfg.uid||s.version!==cfg.version)deny();return s;}
 async function authorize(request){const s=await session(request.data?.calendarSession);return s.uid;}
 async function issue(cfg){const token=crypto.randomBytes(32).toString('base64url'),now=Date.now();await db.doc('privateCalendarSessions/'+hash(token)).set({uid:cfg.uid,version:cfg.version,createdAt:now,expiresAt:now+8*3600000});return {token,expiresAt:now+8*3600000};}
 async function throttle(request,kind,limit,period){const ip=request.rawRequest?.ip||'unknown';const ref=db.doc('privateCalendarLoginLimits/'+hash(kind+'|'+ip));await db.runTransaction(async tx=>{const old=(await tx.get(ref)).data()||{},now=Date.now(),active=old.until>now,count=active?old.count:0;if(count>=limit)deny('嘗試次數過多，請稍後再試。','resource-exhausted');tx.set(ref,{count:count+1,until:active?old.until:now+period});});}
 async function challenge(options,kind,uid){const ticket=crypto.randomBytes(32).toString('base64url');await db.doc('privateCalendarChallenges/'+hash(ticket)).set({challenge:options.challenge,kind,uid,expiresAt:Date.now()+300000});return {options,ticket};}
 async function consume(ticket,kind,uid){if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(ticket))deny('驗證已失效，請重試。');return db.runTransaction(async tx=>{const ref=db.doc('privateCalendarChallenges/'+hash(ticket)),c=(await tx.get(ref)).data();if(!c||c.used||c.kind!==kind||c.uid!==uid||c.expiresAt<Date.now())deny('驗證已失效，請重試。');tx.update(ref,{used:true});return c.challenge;});}
 async function registrationOwner(request,cfg){if(request.auth?.uid===cfg.uid&&String(request.auth.token?.email).toLowerCase()===OWNER)return;const s=await session(request.data?.calendarSession);if(s.createdAt<Date.now()-5*60000)deny('請先再輸入一次專用密碼，然後啟用 Face ID。');}
 async function api(request){const data=request.data||{},action=data.action;
  if(action==='logout'){if(typeof data.calendarSession==='string'&&/^[A-Za-z0-9_-]{43}$/.test(data.calendarSession))await db.doc('privateCalendarSessions/'+hash(data.calendarSession)).delete();return {ok:true};}
  await throttle(request,'requests',40,5*60000);const cfg=await config();
  if(action==='password'){await throttle(request,'password',5,15*60000);if(!await passwordMatches(data.password,cfg))deny('專用密碼不正確。');return issue(cfg);}
  const credentials=db.collection('privateCalendarPasskeys');
  if(action==='entryOptions'){const keys=await credentials.where('uid','==',cfg.uid).get();return {autoFace:cfg.autoFace!==false,hasPasskey:keys.docs.length>0};}
  if(action==='setAutoFace'){await authorize(request);if(typeof data.enabled!=='boolean')deny('設定值不正確。','invalid-argument');await db.doc('privateCalendarServer/access').set({autoFace:data.enabled},{merge:true});return {autoFace:data.enabled};}
  if(action==='registrationOptions'){
   await registrationOwner(request,cfg);const keys=(await credentials.where('uid','==',cfg.uid).get()).docs.map(d=>d.data());if(keys.length>=10)deny('已達裝置數量上限。','failed-precondition');
   const options=await verifier.generateRegistrationOptions({rpName:'柚子私人行事曆',rpID:RP,userID:Buffer.from(hash(cfg.uid),'hex'),userName:OWNER,attestationType:'none',excludeCredentials:keys.map(k=>({id:k.id,transports:k.transports})),authenticatorSelection:{residentKey:'required',userVerification:'required',authenticatorAttachment:'platform'}});
   return challenge(options,'register',cfg.uid);
  }
  if(action==='registrationVerify'){
   await registrationOwner(request,cfg);const expectedChallenge=await consume(data.ticket,'register',cfg.uid);
   let v;try{v=await verifier.verifyRegistrationResponse({response:data.response,expectedChallenge,expectedOrigin:ORIGIN,expectedRPID:RP,requireUserVerification:true});}catch{deny('裝置驗證失敗，請重新啟用。');}if(!v.verified)deny('裝置驗證失敗。');
   const c=v.registrationInfo.credential;await credentials.doc(hash(c.id)).create({id:c.id,uid:cfg.uid,publicKey:Buffer.from(c.publicKey).toString('base64'),counter:c.counter,transports:c.transports||[],createdAt:Date.now()});return {ok:true};
  }
  if(action==='authenticationOptions'){
   const keys=(await credentials.where('uid','==',cfg.uid).get()).docs.map(d=>d.data());if(!keys.length)deny('請先用專用密碼進入，再按「啟用 Face ID」。','failed-precondition');
   const options=await verifier.generateAuthenticationOptions({rpID:RP,userVerification:'required',allowCredentials:keys.map(k=>({id:k.id,transports:k.transports}))});return challenge(options,'login',cfg.uid);
  }
  if(action==='authenticationVerify'){
   const expectedChallenge=await consume(data.ticket,'login',cfg.uid),ref=credentials.doc(hash(data.response?.id||'')),k=(await ref.get()).data();if(!k||k.uid!==cfg.uid)deny('這個通行密鑰未綁定本行事曆。');
   let v;try{v=await verifier.verifyAuthenticationResponse({response:data.response,expectedChallenge,expectedOrigin:ORIGIN,expectedRPID:RP,requireUserVerification:true,credential:{id:k.id,publicKey:Buffer.from(k.publicKey,'base64'),counter:k.counter,transports:k.transports}});}catch{deny('Face ID 驗證未完成，可改用專用密碼。');}if(!v.verified)deny();
   await db.runTransaction(async tx=>{const latest=(await tx.get(ref)).data();if(!latest||latest.counter!==k.counter)deny('請重新驗證。');tx.update(ref,{counter:v.authenticationInfo.newCounter,lastUsedAt:Date.now()});});return issue(cfg);
  }
  deny('未知的登入操作。','invalid-argument');
 }
 return {api,authorize,session};
}
module.exports={createAccess,passwordMatches};
