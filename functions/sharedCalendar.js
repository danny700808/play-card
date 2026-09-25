'use strict';
const admin=require('firebase-admin');
const {onCall}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {createSharedAccess,hash}=require('./sharedCalendarAccess');
const {createSharedCore}=require('./sharedCalendarCore');
const storage=require('./storageRouting');
if(!admin.apps.length)admin.initializeApp();
const db=admin.firestore(),privateAccess=require('./privateCalendarAccess').createAccess(db);
const auth=createSharedAccess({db,ownerSession:privateAccess.session});
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
const core=createSharedCore({db,auth,bucket:storage.writeBucket,ownerLine,sendLine});
function register(exports){
 exports.sharedCalendarAccess=onCall({region:'asia-east1',timeoutSeconds:60,memory:'256MiB',maxInstances:3},auth.api);
 exports.sharedCalendarApi=onCall({region:'asia-east1',timeoutSeconds:120,memory:'512MiB',maxInstances:3},core.api);
 exports.sharedCalendarReminders=onSchedule({region:'asia-east1',schedule:'every 1 minutes',timeZone:'Asia/Taipei',timeoutSeconds:120,maxInstances:1},core.tick);
}
module.exports={register};
