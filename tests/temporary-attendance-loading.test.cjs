'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('temporary-attendance.html','utf8');
const source=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)][0][1];
const client=fs.readFileSync('firebase-client.js','utf8');
function setup({failure,hang,loggedIn=true}={}){
  const elements=new Map(),calls=[];
  const node=()=>({value:'',textContent:'',innerHTML:'',style:{},classList:{add(){},remove(){},toggle(){}}});
  const user={uid:'u1',getIdTokenResult:async()=>({claims:{employee:true,manager:false}}),getIdToken:async()=>'test-token'};
  const rawDb={collection:name=>({get(){throw Error('unscoped read attempted');},doc:id=>({id})})};
  const context=vm.createContext({console,Date,URLSearchParams,AbortController,clearTimeout,
    setTimeout:(fn,ms)=>setTimeout(fn,hang?5:ms),
    location:{search:''},
    document:{querySelector:key=>{if(!elements.has(key))elements.set(key,node());return elements.get(key);}},
    localStorage:{getItem:()=>null},APP_CONFIG:{FIREBASE_CONFIG:{projectId:'test'},FUNCTION_REGION:'asia-east1'},
    firebase:{auth:()=>({authStateReady:async()=>{},currentUser:user})},
    requireLogin:()=>loggedIn?{id:'e1',name:'Test staff'}:null,
    api:async()=>({ok:true,schedules:[]}),
    fetch:async(url)=>{calls.push(url);if(hang)return new Promise(()=>{});if(failure)throw Error(failure);return {ok:true,json:async()=>({result:{rows:[{id:'e1',data:{employeeId:'e1',name:'Test staff',identityType:'parttime',hourlyRate:210}}]}})};},
    YZFirebase:{handleApi:async()=>{},init:()=>context.YZProtectedData.wrap(rawDb)}
  });
  context.window=context;
  vm.runInContext(client.slice(client.indexOf('// Protected legacy employee reads:')),context);
  vm.runInContext(source,context);
  return {context,elements,calls};
}
test('ordinary employee loads through the real private gateway and reaches the form',async()=>{
  const {context,elements,calls}=setup();await context.init();
  assert.equal(calls.length,1);assert.match(calls[0],/employeePrivateDataRead$/);
  assert.match(elements.get('#employeeNameBox').textContent,/Test staff/);
  assert.equal(elements.get('#employeeTypeBox').textContent,'工讀生');
  assert.equal(vm.runInContext('currentAnalysis.ok',context),true);
});
test('denied employee read clears loading and does not allow submission',async()=>{
  const {context,elements}=setup({failure:'permission-denied'});await context.init();
  assert.equal(elements.get('#employeeNameBox').textContent,'員工資料未載入');
  assert.match(elements.get('#msg').innerHTML,/permission-denied/);
  assert.equal(vm.runInContext('currentEmployee',context),null);
});
test('stalled employee read becomes a visible timeout',async()=>{
  const {context,elements}=setup({hang:true});await context.init();
  assert.equal(elements.get('#employeeNameBox').textContent,'員工資料未載入');
  assert.match(elements.get('#msg').innerHTML,/讀取逾時/);
});
test('missing login never queries employee data',async()=>{
  const {context,elements,calls}=setup({loggedIn:false});await context.init();
  assert.equal(calls.length,0);assert.match(elements.get('#msg').innerHTML,/重新登入/);
});
