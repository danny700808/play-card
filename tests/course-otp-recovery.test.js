'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(require('node:path').join(__dirname,'../functions/coursePortal.js'),'utf8');
function fixture(){
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');let now=1000000;const rows=new Map();
 class Clock extends Date{static now(){return now;}}
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const db={collection:name=>({doc:id=>({get:async()=>({exists:rows.has(name+'/'+id),data:()=>rows.get(name+'/'+id)}),set:async data=>rows.set(name+'/'+id,data)})})};
 rows.set('coursePortalOtpRecovery/'+hash('email-link'),{kind:'email-link',challengeToken:'challenge',type:'teacher',lineUserId:'owner',expiresAt:1300000});
 rows.set('coursePortalEmailOtps/'+hash('challenge'),{status:'pending',purpose:'line-registration',type:'teacher',lineUserId:'owner',lineSetupId:'setup',expiresAt:1300000,email:'test@example.invalid'});
 rows.set('coursePortalLineSetupTokens/setup',{status:'pending',type:'teacher',lineUserId:'owner',expiresAt:2000000});
 const context={db,hash,Date:Clock,HttpsError,clean:v=>String(v||'').trim(),asMillis:Number,EMAIL_OTP_MAX_ATTEMPTS:5,FieldValue:{serverTimestamp:()=>now},randomToken:()=>crypto.randomBytes(36).toString('hex'),maskedEmail:()=> 't***@example.invalid'};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function readOtpRecovery('),source.indexOf('async function startLineLogin(')),context);
 return {api:context,rows,hash,setNow:value=>{now=value;}};
}
test('email return requires matching LINE identity and preserves remaining time',async()=>{
 const f=fixture();await assert.rejects(f.api.resumeEmailOtp({resumeToken:'email-link'}));
 await assert.rejects(f.api.completeOtpRecovery('email-link',{lineUserId:'other'}),e=>e.code==='permission-denied');
 f.setNow(1090000);const proof=await f.api.completeOtpRecovery('email-link',{lineUserId:'owner'});const result=await f.api.resumeEmailOtp({resumeToken:proof.verifiedToken});assert.equal(result.expiresInSeconds,210);assert.equal(result.challengeToken,'challenge');
 f.setNow(1300000);await assert.rejects(f.api.resumeEmailOtp({resumeToken:proof.verifiedToken}));await assert.rejects(f.api.completeOtpRecovery('email-link',{lineUserId:'owner'}));
});
test('used, locked or removed registration cannot be recovered',async()=>{
 for(const state of ['used','locked','missing-setup']){const f=fixture();const otp=f.rows.get('coursePortalEmailOtps/'+f.hash('challenge'));if(state==='missing-setup')f.rows.delete('coursePortalLineSetupTokens/setup');else otp.status=state;await assert.rejects(f.api.completeOtpRecovery('email-link',{lineUserId:'owner'}));}
});
