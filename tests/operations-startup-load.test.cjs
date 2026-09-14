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
