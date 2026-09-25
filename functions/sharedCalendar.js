'use strict';
const admin=require('firebase-admin');
const {onCall}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {createSharedAccess,hash}=require('./sharedCalendarAccess');
const {createSharedCore}=require('./sharedCalendarCore');
const storage=require('./storageRouting');
if(!admin.apps.length)admin.initializeApp();
const db=admin.firestore(),privateAccess=require('./privateCalendarAccess').createAccess(db);
const auth=createSharedAccess({db,ownerSession:privateAccess.session,passwordless:()=>passwordless});
async function ownerLine(uid){
 const prefs=(await db.doc('privateCalendarUsers/'+hash(uid)).get()).data()||{};if(!prefs.lineEnabled||!prefs.targetKey)return null;
 const owner=await admin.auth().getUser(uid);if(owner.email?.toLowerCase()!=='danny700808@gmail.com')return null;
 for(const collection of ['employees','admins'])for(const doc of (await db.collection(collection).where('email','==',owner.email).get()).docs){const r=doc.data(),id=String(r.lineUserId||r['LINE User ID']||'').trim();if(/^U[0-9a-f]{32}$/i.test(id)&&hash(id)===prefs.targetKey&&r.lineNotifyEnabled!==false&&!['disabled','inactive','revoked','rejected'].includes(String(r.accountStatus||r.status||'').toLowerCase()))return id;}
 return null;
}
async function sendLine(to,message,key){
 const token=process.env.LINE_CHANNEL_ACCESS_TOKEN;if(!token)throw Error('官方 LINE 發送設定尚未完成。');
 const r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Line-Retry-Key':key},body:JSON.stringify({to,messages:[{type:'text',text:message.slice(0,4900)}]}),signal:AbortSignal.timeout(15000)});
 if(!r.ok&&!(r.status===409&&r.headers.get('x-line-accepted-request-id')))throw Error('LINE 發送失敗（'+r.status+'），系統將重試。');
}
let cachedBotId='',botUntil=0;
async function botId(){if(cachedBotId&&botUntil>Date.now())return cachedBotId;const r=await fetch('https://api.line.me/v2/bot/info',{headers:{Authorization:'Bearer '+process.env.LINE_CHANNEL_ACCESS_TOKEN},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('官方 LINE 暫時無法連線。');const b=await r.json();cachedBotId=b.basicId;botUntil=Date.now()+3600000;return cachedBotId;}
async function sendEmail(to,subject,text){if(!process.env.GMAIL_USER||!process.env.GMAIL_APP_PASSWORD)throw Error('Email 寄信服務尚未設定。');return require('nodemailer').createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_APP_PASSWORD.replace(/\s+/g,'')}}).sendMail({from:process.env.EMAIL_FROM||process.env.GMAIL_USER,to,subject,text});}
const passwordless=require('./sharedCalendarLogin').createSharedLogin({db,auth,sendEmail,authorizationUrl:state=>require('./courseLoginAuthV3').lineAuthorizationUrl(state)});
const emailBindings=require('./sharedCalendarEmail').createSharedEmail({db,sendEmail});
const lineBindings=require('./sharedCalendarLine').createSharedLine({db,botId});
const core=createSharedCore({db,auth,bucket:storage.writeBucket,ownerLine,sendLine,lineBindings,emailBindings,sendEmail});
function register(exports){
 exports.sharedCalendarAccess=onCall({region:'asia-east1',timeoutSeconds:60,memory:'256MiB',maxInstances:3},auth.api);
 exports.sharedCalendarApi=onCall({region:'asia-east1',timeoutSeconds:120,memory:'512MiB',maxInstances:3},core.api);
 exports.sharedCalendarReminders=onSchedule({region:'asia-east1',schedule:'every 1 minutes',timeZone:'Asia/Taipei',timeoutSeconds:120,maxInstances:1},core.tick);
}
module.exports={register,lineCallback:(req,res,dependencies)=>passwordless.callback(req,res,dependencies)};
