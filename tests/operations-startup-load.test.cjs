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
test('all datasets load in order with at most six active reads',async()=>{
  let active=0,peak=0;const progress=[];
  const results=await run(items,async item=>{
    active++;peak=Math.max(peak,active);
    await Promise.resolve();
    for(let i=0;i<item.n%4;i++)await Promise.resolve();
    active--;return item.n;
  },{pause:async()=>{},onProgress:value=>progress.push(value)});
  assert.equal(peak,6);
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
  assert.equal(starts,6);assert.equal(active,0);
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

test('operations reads go directly with cached verified ID token without failed SDK requests',async()=>{
 const start=source.indexOf('  async function getOperationDocument('),end=source.indexOf('  async function loadOnlineProducts(',start);const calls=[];
 const context={COLLECTIONS:{products:'opsInternalProducts'},OPERATION_PRODUCT_READ_FIELDS:['price','createdAt','tags'],AbortController,setTimeout,clearTimeout,encodeURIComponent,FIRESTORE_READ_TIMEOUT_MS:1000,READ_LIMIT:10000,state:{diagnostics:[],db:{collection:()=>({limit:()=>({get:async()=>{assert.fail('Must not attempt failing SDK reads');}})})}},global:{firebase:{app:()=>({options:{projectId:'demo-youzi-security'}}),firestore:{Timestamp:{fromDate:d=>d}}}},requireOperationsReadAuth:async()=>({user:{getIdToken:async(force)=>{assert.notEqual(force,true);return 'verified-token';}}}),withReadTimeout:p=>p,errorMessage:e=>e.message,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>[{document:{name:'projects/demo/databases/(default)/documents/opsInternalProducts/p1',fields:{price:{doubleValue:1200},createdAt:{timestampValue:'2026-09-14T00:00:00Z'},tags:{arrayValue:{values:[{stringValue:'piano'}]}}}}}]};}};
 vm.runInNewContext(source.slice(start,end),context);const result=await context.getCollection('opsInternalProducts',10000);
 assert.equal(result[0].price,1200);assert.equal(result[0].createdAt.toISOString(),'2026-09-14T00:00:00.000Z');assert.equal(result[0].tags[0],'piano');assert.equal(calls.length,1);assert.equal(calls[0].options.headers.Authorization,'Bearer verified-token');assert(!calls[0].url.includes('verified-token'));assert.equal(context.state.diagnostics[0].transport,'explicit-token');
 await context.getOperationQuerySnapshot('opsSettings/suppliers/directory',null,1000);assert(calls[1].url.includes('/documents/opsSettings/suppliers:runQuery'));
 await context.getOperationQuerySnapshot('opsProductListingCases',{field:'batchQueueStatus',value:'pending'},1000);assert.equal(JSON.parse(calls[2].options.body).structuredQuery.where.fieldFilter.value.stringValue,'pending');
 context.fetch=async()=>({ok:false,status:403,json:async()=>({error:{message:'denied'}})});await assert.rejects(context.getCollection('opsInternalProducts',10000));
});


test('product projection includes every direct and legacy alias read by product normalizer',()=>{
 const declaration=source.match(/const OPERATION_PRODUCT_READ_FIELDS = (\[[^;]+\]);/)[1],fields=new Set(JSON.parse(declaration));
 const normalizer=source.slice(source.indexOf('  function normalizeInternal('),source.indexOf('  function onlineScore('));
 for(const match of normalizer.matchAll(/obj\.([A-Za-z0-9_]+)/g))assert(fields.has(match[1]),match[1]);
 for(const match of normalizer.matchAll(/firstValue\(obj,\[([^\]]+)\]/g))for(const name of match[1].matchAll(/'([^']+)'/g))assert(fields.has(name[1]),name[1]);
 for(const name of ['easyStorePrice','momoPrice','coupangPrice','currentStock','costLayers','averageCost','latestPurchaseCost','purchasePrice'])assert(fields.has(name),name);
});
