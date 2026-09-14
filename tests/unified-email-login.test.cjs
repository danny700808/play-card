const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {database}=require('./helpers/security-fixtures.cjs');
const {createUnifiedEmailLogin}=require('../functions/unifiedEmailLogin');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function setup(options={}){
 const f=database({'employees/e1':{employeeId:'e1',email:'staff@example.test',name:'Staff',role:'staff',accountStatus:'active'}}),sent=[],users=new Map();let now=100000;
 users.set('u1',{uid:'u1',email:'staff@example.test'});
 const auth={getUserByEmail:async email=>{const user=[...users.values()].find(u=>u.email===email);if(!user)throw Object.assign(Error(),{code:'auth/user-not-found'});return user;},createUser:async u=>{users.set(u.uid,u);return u;},setCustomUserClaims:async(uid,c)=>{users.get(uid).claims=c;},createCustomToken:async uid=>'token:'+uid};
 const api=createUnifiedEmailLogin({...f,auth,now:()=>now,sendEmail:async row=>sent.push(row),findPortalAccount:async()=>null,issuePortalSession:async()=>({sessionToken:'portal'}),...options});
 const proof='a'.repeat(64),request={rawRequest:{ip:'127.0.0.1'}};
 return {...f,api,sent,users,proof,request,tick:()=>now+=300001,send:extra=>api.send({email:'staff@example.test',proof,...extra},request),code:()=>sent.at(-1).body.match(/\d{6}/)[0]};
}
test('email code grants only live account role and is single-use',async()=>{
 const f=setup(),r=await f.send();const data={challengeToken:r.challengeToken,proof:f.proof,code:f.code(),role:'admin'};
 const outcomes=await Promise.allSettled([f.api.verify(data),f.api.verify(data)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.users.get('u1').claims.manager,false);
});
test('wrong codes are counted persistently and lock after five attempts',async()=>{
 const f=setup(),r=await f.send(),code=f.code();
 for(let i=0;i<5;i++)await assert.rejects(f.api.verify({challengeToken:r.challengeToken,proof:f.proof,code:code==='999999'?'888888':'999999'}));
 await assert.rejects(f.api.verify({challengeToken:r.challengeToken,proof:f.proof,code}));
});
test('expiry, browser proof and disabled live accounts reject verification',async()=>{
 for(const change of ['expiry','proof','disabled','firebase-disabled']){
 const f=setup(),r=await f.send();if(change==='expiry')f.tick();if(change==='disabled')f.rows.get('employees/e1').accountStatus='disabled';if(change==='firebase-disabled')f.users.get('u1').disabled=true;
 await assert.rejects(f.api.verify({challengeToken:r.challengeToken,code:f.code(),proof:change==='proof'?'b'.repeat(64):f.proof}));
 }
});
test('unknown email does not send mail and send limits are enforced',async()=>{
 const f=setup();await f.send({email:'unknown@example.test'});assert.equal(f.sent.length,0);
 for(let i=0;i<5;i++)await f.send();await assert.rejects(f.send(),/15/);
});
test('verified LINE email remembers account without password and rejects conflicting owner',async()=>{
 for(const conflict of [false,true]){
 const f=setup(),ticket='t'.repeat(64);f.rows.set('unifiedLoginTickets/'+hash(ticket),{status:'pending',expiresAtMs:400000,challenge:hash(f.proof),profile:{lineUserId:'line1'}});
 const lineKey=hash('line-login|line1');if(conflict)f.rows.set('employeeLoginBindings/'+lineKey,{uid:'other'});
 const r=await f.send({ticket}),data={challengeToken:r.challengeToken,proof:f.proof,code:f.code()};
 if(conflict)await assert.rejects(f.api.verify(data),/不一致/);else {await f.api.verify(data);assert.equal(f.rows.get('employeeLoginBindings/'+lineKey).uid,'u1');assert.equal(f.rows.get('unifiedLoginTickets/'+hash(ticket)).status,'used');}
 }
});

test('existing verified portal email uses its stored role and remembers LINE for future login',async()=>{
 const f=setup({findPortalAccount:async(role,email)=>role==='teacher'&&email==='teacher@example.test'?{type:'teacher',authAccountId:'t1'}:null});
 const ticket='t'.repeat(64);f.rows.set('unifiedLoginTickets/'+hash(ticket),{status:'pending',expiresAtMs:400000,challenge:hash(f.proof),profile:{lineUserId:'line-teacher'}});
 const r=await f.send({email:'teacher@example.test',ticket});
 const result=await f.api.verify({challengeToken:r.challengeToken,proof:f.proof,code:f.code()});
 assert.equal(result.role,'teacher');assert.equal(result.sessionToken,'portal');assert.equal(f.rows.get('unifiedPortalEmailBindings/'+hash('line-login|line-teacher')).email,'teacher@example.test');
});
