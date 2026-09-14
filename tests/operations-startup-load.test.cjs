'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('operations-phase1.js','utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('  async function loadOperationDatasets(');
assert(start>=0);
const end=source.indexOf('\n\n  async function loadAll(',start);
assert(end>start);
const context={Map,Promise,Array,Number,Math,setTimeout};
vm.runInNewContext(source.slice(start,end),context);
const run=context.loadOperationDatasets;
const items=Array.from({length:23},(_,n)=>({n,label:'group'+n}));
test('all datasets load in order with at most three active reads',async()=>{
  let active=0,peak=0;const progress=[];
  const results=await run(items,async item=>{
    active++;peak=Math.max(peak,active);
    for(let i=0;i<item.n%4;i++)await Promise.resolve();
    active--;return item.n;
  },{pause:async()=>{},onProgress:value=>progress.push(value)});
  assert.equal(peak,3);
  assert.deepEqual(Array.from(results),items.map(item=>item.n));
  assert.equal(progress.at(-1).completed,23);
  assert.equal(progress.at(-1).active.length,0);
});
test('failure stops queued reads and propagates after active reads settle',async()=>{
  let starts=0,active=0;
  await assert.rejects(run(items,async item=>{
    starts++;active++;
    try{if(item.n===0)throw new Error('offline');await Promise.resolve();return item.n;}
    finally{active--;}
  },{pause:async()=>{}}),/offline/);
  assert.equal(starts,3);assert.equal(active,0);
});
test('an empty batch does not call the reader',async()=>{
  const result=await run([],async()=>{throw new Error('unexpected');},{pause:async()=>{}});
  assert.equal(result.length,0);
});

test('mobile startup does not clone full operations data into IndexedDB or render a second cached dashboard',async()=>{
  const source=fs.readFileSync('operations-phase1.js','utf8');
  for(const name of ['saveFastStateCache','restoreFastStateCache','saveDashboardCache']){
    const start=source.indexOf('function '+name+'('),end=source.indexOf('\n  }',start)+4;
    const context={isCompactMobile:()=>true,openFastStateDb:()=>{throw Error('must not open mobile cache');},state:new Proxy({},{get(){throw Error('must not access or render full state');}})};
    vm.runInNewContext((name==='saveDashboardCache'?'':'async ')+source.slice(start,end),context);
    await context[name]();
  }
});

test('operations startup waits for verified auth before any history or settings reads',async()=>{
  const start=source.lastIndexOf('  async function init(){'),end=source.indexOf('\n\n  global.OperationsCenterV1',start);
  let release;const gate=new Promise(resolve=>release=resolve),events=[];
  const context={global:{requireLogin:()=>({id:'admin'}),hasSettingsZoneAccess:()=>true},ensureOperatingExpenseEngineLoaded:async()=>true,state:{},setText:()=>{},userLabel:()=>'',initDb:()=>({}),requireOperationsReadAuth:()=>gate,repairYsv104PreorderHistoryOnce:async()=>events.push('read'),restoreFastStateCache:async()=>{throw Error('stop-after-first-read');}};
  vm.runInNewContext(source.slice(start,end),context);
  const running=context.init();await Promise.resolve();await Promise.resolve();assert.deepEqual(events,[]);
  release();await assert.rejects(running,/stop-after-first-read/);assert.deepEqual(events,['read']);
});
test('operations read gate rejects email-only manager hints and accepts verified employee manager claims',async()=>{
  const start=source.indexOf('  async function requireOperationsReadAuth(){'),end=source.indexOf('  async function requireEasyStoreManagerAuth(){',start);
  for(const claims of [{email:'danny700808@gmail.com'},{employee:true,manager:false,employeeId:'e1'},{employee:true,manager:true,employeeId:'e1'}]){
    const context={requireEasyStoreManagerAuth:async()=>({ok:true,claims})};vm.runInNewContext(source.slice(start,end),context);
    if(claims.manager===true)await context.requireOperationsReadAuth();else await assert.rejects(context.requireOperationsReadAuth());
  }
});

test('permission-denied SDK reads retry once with verified ID token and preserve data types',async()=>{
 const start=source.indexOf('  async function getOperationDocument('),end=source.indexOf('  async function loadOnlineProducts(',start);const calls=[];
 const context={AbortController,setTimeout,clearTimeout,encodeURIComponent,FIRESTORE_READ_TIMEOUT_MS:1000,READ_LIMIT:10000,state:{diagnostics:[],db:{collection:()=>({limit:()=>({get:async()=>{throw Object.assign(Error('Missing permissions'),{code:'permission-denied'});}})})}},global:{firebase:{app:()=>({options:{projectId:'demo-youzi-security'}}),firestore:{Timestamp:{fromDate:d=>d}}}},requireOperationsReadAuth:async()=>({user:{getIdToken:async()=> 'verified-token'}}),withReadTimeout:p=>p,errorMessage:e=>e.message,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>[{document:{name:'projects/demo/databases/(default)/documents/opsInternalProducts/p1',fields:{price:{doubleValue:1200},createdAt:{timestampValue:'2026-09-14T00:00:00Z'},tags:{arrayValue:{values:[{stringValue:'piano'}]}}}}}]};}};
 vm.runInNewContext(source.slice(start,end),context);const result=await context.getCollection('opsInternalProducts',10000);
 assert.equal(result[0].price,1200);assert.equal(result[0].createdAt.toISOString(),'2026-09-14T00:00:00.000Z');assert.equal(result[0].tags[0],'piano');assert.equal(calls.length,1);assert.equal(calls[0].options.headers.Authorization,'Bearer verified-token');assert(!calls[0].url.includes('verified-token'));assert.equal(context.state.diagnostics[0].transport,'explicit-token');
 context.fetch=async()=>({ok:false,status:403,json:async()=>({error:{message:'denied'}})});await assert.rejects(context.getCollection('opsInternalProducts',10000));
});

