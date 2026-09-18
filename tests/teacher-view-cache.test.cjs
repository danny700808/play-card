'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../teacher-view-cache');
function fixture(extra={}) {
  const storage={};
  Object.defineProperties(storage,{
    getItem:{value:key=>storage[key]||null},setItem:{value:(key,value)=>{storage[key]=value;}},removeItem:{value:key=>{delete storage[key];}}
  });
  let owner='teacher-a',time=1000;
  const cache=create({storage,prefix:'test:',ttl:100,now:()=>time,owner:()=>owner,maxEntries:3,...extra});
  return {cache,storage,owner:value=>{owner=value;},time:value=>{time=value;}};
}
test('repeated navigation shares one in-flight read and stores the result',async()=>{
  const {cache}=fixture();let reads=0,resolve;
  const a=cache.load('week:a',()=>{reads++;return new Promise(done=>{resolve=done;});});
  const b=cache.load('week:a',()=>{throw Error('duplicate read');});
  assert.equal(a,b);await Promise.resolve();assert.equal(reads,1);resolve({events:['new']});
  await a;assert.deepEqual(cache.get('week:a'),{events:['new']});
});
test('an old read cannot repopulate cache after a write invalidates its dates',async()=>{
  const {cache}=fixture();let resolve;
  const old=cache.load('week:a',()=>new Promise(done=>{resolve=done;}));await Promise.resolve();
  cache.invalidate(scope=>scope==='week:a');await cache.load('week:a',async()=>({version:2}));
  resolve({version:1});await old;assert.equal(cache.get('week:a').version,2);
});
test('switching accounts while reading cannot publish the former teacher data',async()=>{
  const f=fixture();let resolve;
  const old=f.cache.load('week:a',()=>new Promise(done=>{resolve=done;}));await Promise.resolve();f.owner('teacher-b');
  resolve({private:'a'});await old;assert.equal(f.cache.get('week:a'),null);assert.equal(Object.keys(f.storage).length,0);
});
test('only changed scopes expire and payroll uses its own shorter TTL',()=>{
  const f=fixture();f.cache.put('week:a',1);f.cache.put('week:b',2);f.cache.put('payroll:month',3,10);
  f.cache.invalidate(scope=>scope==='week:a');assert.equal(f.cache.get('week:b'),2);
  f.time(1011);assert.equal(f.cache.get('payroll:month'),null);assert.equal(f.cache.get('week:b'),2);
});
test('bounded storage prunes old weeks without touching unrelated application data',()=>{
  const f=fixture();f.storage.other='keep';
  for(let i=0;i<5;i++){f.time(1000+i);f.cache.put('week:'+i,i);}
  assert.equal(Object.keys(f.storage).filter(key=>key.startsWith('test:')).length,3);
  assert.equal(f.cache.get('week:0'),null);assert.equal(f.cache.get('week:4'),4);assert.equal(f.storage.other,'keep');
});
test('denied browser storage still permits network reads and a failed request can retry',async()=>{
  const {cache}=fixture({storage:()=>{throw Error('storage denied');}});
  assert.equal(cache.get('week:a'),null);assert.doesNotThrow(()=>cache.invalidate());
  await assert.rejects(cache.load('week:a',async()=>{throw Error('offline');}),/offline/);
  assert.equal(await cache.load('week:a',async()=>42),42);
});
