'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createUnifiedLogin}=require('../functions/unifiedLogin');
const {createManagerAccess}=require('../functions/managerAccess');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function setup(){
  const rows=new Map(),users=new Map();let serial=Promise.resolve();
  const snap=path=>{const value=structuredClone(rows.get(path));return {id:path.split('/').at(-1),ref:ref(path),exists:value!==undefined,data:()=>structuredClone(value)};};
  const ref=path=>({path,id:path.split('/').at(-1),get:async()=>snap(path),set:async(data,options)=>rows.set(path,{...(options&&options.merge?rows.get(path):{}),...structuredClone(data)})});
  const db={collection:name=>({doc:id=>ref(name+'/'+id),where:(field,op,value)=>({limit:()=>({get:async()=>{const docs=[...rows.keys()].filter(path=>path.startsWith(name+'/')&&rows.get(path)[field]===value).map(snap);return {empty:!docs.length,docs};}})})}),runTransaction(fn){const task=serial.then(async()=>{const writes=[];const result=await fn({get:async r=>snap(r.path),set:(r,data)=>writes.push(()=>rows.set(r.path,structuredClone(data))),update:(r,data)=>writes.push(()=>rows.set(r.path,{...rows.get(r.path),...structuredClone(data)}))});writes.forEach(fn=>fn());return result;});serial=task.catch(()=>{});return task;}};
  const auth={getUser:async uid=>{if(!users.has(uid))throw Error('missing');return structuredClone(users.get(uid));},setCustomUserClaims:async(uid,claims)=>{users.get(uid).customClaims=claims;},createCustomToken:async uid=>'token:'+uid,verifyIdToken:async token=>{if(token!=='good')throw Error('invalid');return users.get('u1').customClaims;}};
  const proof='a'.repeat(64),now=1000000;
  rows.set('employees/e1',{employeeId:'e1',email:'staff@example.test',name:'Staff',role:'staff',accountStatus:'active'});
  users.set('u1',{uid:'u1',email:'staff@example.test',customClaims:{employee:true,employeeId:'e1',manager:false,email:'staff@example.test'}});
  const api=createUnifiedLogin({db,auth,hash,randomToken:()=>crypto.randomBytes(32).toString('base64url'),Timestamp:{fromMillis:v=>v},FieldValue:{serverTimestamp:()=>now},now:()=>now,bindingsForLine:async()=>[],decideLineLoginBinding:()=>({action:'setup'}),issueSetupToken:async()=>'setup',portalEntryUrl:()=> 'https://example.test/course-portal.html'});
  const request={auth:{uid:'u1',token:{employee:true,employeeId:'e1',email:'staff@example.test',auth_time:now/1000,firebase:{sign_in_provider:'password'}}}};
  return {api,rows,users,db,auth,proof,request,issue:()=>api.issue({lineUserId:'line-1'},{challenge:hash(proof)})};
}
test('employee LINE requires first password binding; notification LINE fields cannot grant login',async()=>{
  const f=setup();f.rows.get('employees/e1').lineUserId='line-1';
  const ticket=await f.issue();assert.deepEqual((await f.api.status({ticket,proof:f.proof})).choices,[]);
  await assert.rejects(f.api.redeem({ticket,proof:f.proof,choice:'employee'}),/原帳密/);
  await f.api.link({ticket,proof:f.proof},f.request);
  const next=await f.issue();assert.equal((await f.api.status({ticket:next,proof:f.proof})).choices[0].id,'employee');
  assert.equal((await f.api.redeem({ticket:next,proof:f.proof,choice:'employee'})).token,'token:u1');
  assert.equal(f.users.get('u1').customClaims.manager,false);
});
test('forwarded callback ticket without browser proof cannot link or redeem',async()=>{
  const f=setup(),ticket=await f.issue();
  for(const method of ['status','redeem','link'])await assert.rejects(f.api[method]({ticket,proof:'b'.repeat(64),choice:'teacher'},f.request),/同一個瀏覽器/);
  assert.equal(f.rows.has('employeeLoginOwners/u1'),false);
});
test('stale password auth, custom-token sessions, and mismatched employee claims cannot bind',async()=>{
  for(const change of [c=>c.auth_time=1,c=>c.firebase.sign_in_provider='custom',c=>c.employeeId='someone-else']){
    const f=setup(),ticket=await f.issue();change(f.request.auth.token);
    await assert.rejects(f.api.link({ticket,proof:f.proof},f.request));
    assert.equal(f.rows.has('employeeLoginOwners/u1'),false);
  }
});
test('each login ticket redeems at most once, including concurrent requests',async()=>{
  const f=setup(),ticket=await f.issue();
  const result=await Promise.allSettled([f.api.redeem({ticket,proof:f.proof,choice:'teacher'}),f.api.redeem({ticket,proof:f.proof,choice:'teacher'})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
});
test('disabled employee cannot use a previously linked LINE',async()=>{
  const f=setup();await f.api.link({ticket:await f.issue(),proof:f.proof},f.request);
  f.rows.get('employees/e1').accountStatus='disabled';
  await assert.rejects(f.api.redeem({ticket:await f.issue(),proof:f.proof,choice:'employee'}));
});
test('role downgrade removes legacy administrative claims at LINE login',async()=>{
  const f=setup();await f.api.link({ticket:await f.issue(),proof:f.proof},f.request);
  Object.assign(f.users.get('u1').customClaims,{admin:true,owner:true,manager:true,role:'admin'});
  await f.api.redeem({ticket:await f.issue(),proof:f.proof,choice:'employee'});
  const claims=f.users.get('u1').customClaims;
  assert.equal(claims.manager,false);assert.equal(claims.admin,undefined);assert.equal(claims.owner,undefined);assert.equal(claims.role,'staff');
});
test('management HTTP guard rejects missing, forged, staff and stale manager tokens',async()=>{
  const f=setup(),guard=createManagerAccess(f.auth,f.db);
  for(const authorization of ['', 'Bearer forged','Bearer good'])await assert.rejects(guard({headers:{authorization}}));
  f.users.get('u1').customClaims.manager=true;
  await assert.rejects(guard({headers:{authorization:'Bearer good'}}),/未啟用/);
  f.rows.get('employees/e1').role='manager';
  assert.equal((await guard({headers:{authorization:'Bearer good'}})).manager,true);
  f.rows.get('employees/e1').accountStatus='disabled';
  await assert.rejects(guard({headers:{authorization:'Bearer good'}}));
});
