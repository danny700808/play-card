'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {database}=require('./helpers/security-fixtures.cjs');
const {createAccess,validateCommand,hash}=require('../functions/shippingDeskAccess');
function fixture(){
  let time=Date.now();const salt='test-salt',agent='a'.repeat(43);
  const config={enabled:true,version:'v1',passwordSalt:salt,passwordHash:crypto.scryptSync('test-only-password',salt,32).toString('hex'),agentHash:hash(agent)};
  const f=database({'shippingDeskPrivate/config':config,'shippingDeskPrivate/state':{agentSeenAt:time,snapshot:{orders:[]}}});
  return {...f,agent,api:createAccess({db:f.db,now:()=>time}),advance:ms=>time+=ms};
}
test('packing password yields a dedicated scope and remembers only when requested',async()=>{
  const f=fixture(),r=await f.api.login('test-only-password',true,'ip');
  const s=await f.api.session(r.token);assert.equal(s.scope,'packing');assert(s.expiresAtMs>Date.now()+89*86400000);
  assert.equal((await f.api.orders(r.token)).agentOnline,true);
  await assert.rejects(f.api.login('bad',true,'ip'));
  await assert.rejects(f.api.orders('inventory-session-token'));
});
test('logout and password version change revoke all access including document tickets',async()=>{
  const f=fixture(),{token}=await f.api.login('test-only-password',false,'ip');
  await f.api.logout(token);await assert.rejects(f.api.orders(token));
  const b=await f.api.login('test-only-password',false,'ip');
  f.rows.get('shippingDeskPrivate/config').version='v2';
  await assert.rejects(f.api.orders(b.token));
});
test('packing scope cannot run administration, inject URLs, or change timeframe',()=>{
  for(const action of ['config','upload','inventory','provide-document','shell'])assert.throws(()=>validateCommand(action,{}));
  assert.deepEqual(validateCommand('refresh',{days:30}),{days:3});
  assert.throws(()=>validateCommand('process',{key:'../../config.json',fingerprint:'a'.repeat(64)}));
  assert.throws(()=>validateCommand('preview',{key:'Coupang:123',options:{carrier:'https://other'}}));
});
test('queue is idempotent and each result is bound to the creating session',async()=>{
  const f=fixture(),a=await f.api.login('test-only-password',false,'a'),b=await f.api.login('test-only-password',false,'b');
  const input={command:'handling',body:{key:'Coupang:123',action:'printed'},requestId:'request-1234567890'};
  const one=await f.api.enqueue(a.token,input),two=await f.api.enqueue(a.token,input);assert.equal(one.jobId,two.jobId);
  await assert.rejects(f.api.result(b.token,one.jobId));
  await assert.rejects(f.api.enqueue(a.token,{...input,body:{key:'Coupang:123',action:'shipped'}}));
  await assert.rejects(f.api.poll('bad'));
  const {job}=await f.api.poll(f.agent);assert.equal(job.id,one.jobId);
  assert.equal((await f.api.poll(f.agent)).job,null);
  await f.api.complete(f.agent,job.id,job.claim,{ok:true});
  assert.equal((await f.api.result(a.token,job.id)).status,'done');
});
test('offline agent blocks requests, revoked sessions cannot execute queued jobs',async()=>{
  const f=fixture(),{token}=await f.api.login('test-only-password',false,'a');
  const r=await f.api.enqueue(token,{command:'refresh',body:{},requestId:'refresh-123456789'});
  await f.api.logout(token);assert.equal((await f.api.poll(f.agent)).job,null);
  assert.equal(f.rows.get('shippingDeskJobs/'+r.jobId).status,'error');
  const b=await f.api.login('test-only-password',false,'b');f.advance(91000);
  await assert.rejects(f.api.enqueue(b.token,{command:'refresh',body:{},requestId:'refresh-123456780'}));
});
test('signed document is bound to active packing session and expires',async()=>{
  const f=fixture(),{token}=await f.api.login('test-only-password',false,'a'),owner=await f.api.session(token),id='a'.repeat(64),ticket='b'.repeat(43);
  f.rows.set('shippingDeskJobs/'+id,{owner:owner.id,status:'done',expiresAtMs:Date.now()+10000,documentTicketHash:hash(ticket)});
  assert(await f.api.document(id,ticket));
  await assert.rejects(f.api.document(id,'x'.repeat(43)));
  await f.api.logout(token);await assert.rejects(f.api.document(id,ticket));
});
test('login attempts are limited before doing password work',async()=>{
  const f=fixture();for(let i=0;i<12;i++)await assert.rejects(f.api.login('wrong',false,'attacker'));
  await assert.rejects(f.api.login('test-only-password',false,'attacker'),e=>e.status===429);
});
