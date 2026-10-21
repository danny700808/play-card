const {test}=require('node:test'),assert=require('node:assert/strict');
const {database}=require('./helpers/security-fixtures.cjs');
const {createAccess}=require('../functions/shippingDeskAccess');
function fixture(){
  const now=Date.now(),f=database({'shippingDeskPrivate/config':{enabled:true,version:'v1'},'shippingDeskPrivate/state':{agentSeenAt:now,snapshot:{orders:[{key:'EasyStore:123'}]}}});
  let allowed=true,calls=0;
  const api=createAccess({db:f.db,now:()=>now,requireManager:async req=>{
    calls++;if(!allowed||req.headers.authorization!=='Bearer valid.system.token')throw Object.assign(Error('denied'),{httpStatus:403});
    return {uid:'manager-1',auth_time:10,exp:Math.floor(now/1000)+3600};
  }});
  return {...f,api,deny:()=>allowed=false,calls:()=>calls};
}
test('system identity reads orders without packing password and is rechecked for every request',async()=>{
  const f=fixture();assert.equal((await f.api.orders('valid.system.token')).orders[0].key,'EasyStore:123');
  const one=await f.api.session('valid.system.token'),two=await f.api.session('valid.system.token');
  assert.equal(one.id,two.id);assert.equal(one.source,'system');assert.equal(f.calls(),3);
  assert.equal(f.rows.get('shippingDeskSessions/'+one.id).uid,'manager-1');
  f.deny();await assert.rejects(f.api.orders('valid.system.token'),/denied/);
  await assert.rejects(f.api.enqueue('valid.system.token',{command:'refresh',requestId:'x'.repeat(20)}),/denied/);
});
test('embedded marker or forged token never authorizes orders',async()=>{
  const f=fixture();await assert.rejects(f.api.orders('embedded=1'));
  await assert.rejects(f.api.orders('fake.system.token'),/denied/);
  const api=createAccess({db:f.db});await assert.rejects(api.orders('valid.system.token'));
});
test('system sessions preserve packing command restrictions and existing job ownership',async()=>{
  const f=fixture(),token='valid.system.token';
  await assert.rejects(f.api.enqueue(token,{command:'admin',requestId:'x'.repeat(20)}));
  const job=await f.api.enqueue(token,{command:'refresh',requestId:'x'.repeat(20)});
  assert.equal((await f.api.result(token,job.jobId)).status,'queued');
});
