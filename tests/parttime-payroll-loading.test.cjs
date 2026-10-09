const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../data-center.html'),'utf8');
function page(authResult){
  const nodes=new Map();
  const reads=[];
  const context={console,Date,setTimeout,clearTimeout,localStorage:{getItem:()=>JSON.stringify({role:'admin'})},document:{querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{value:'',textContent:'',innerHTML:'',addEventListener(){}});return nodes.get(selector);}},firebase:{apps:[{}],firestore:()=>({})},YouziOperationsManagerAuth:{ensureManagerAuth:()=>authResult}};
  context.window=context;
  context.APP_CONFIG={FIREBASE_CONFIG:{}};
  vm.createContext(context);
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(match[1].trim())vm.runInContext(match[1],context);
  context.all=async collection=>{reads.push(collection);return collection==='employees'?[{employeeId:'test-worker',name:'測試工讀生',isPartTime:true}]:[];};
  context.buildSalaryConfigMap=()=>({});
  context.mergeEmployeeSalaryConfig=row=>row;
  context.employee=row=>({id:row.employeeId,name:row.name,part:true,active:true});
  context.renderAll=()=>{};
  return {context,nodes,reads};
}
test('waits for restored manager authentication before querying and shows the roster',async()=>{
  let resolveAuth;
  const p=page(new Promise(resolve=>{resolveAuth=resolve;}));
  const pending=p.context.reloadAll();
  await Promise.resolve();
  assert.deepEqual(p.reads,[]);
  assert.equal(p.nodes.get('#employeeCount').textContent,'讀取中');
  resolveAuth({ok:true});
  await pending;
  assert.equal(p.reads[0],'employees');
  assert.equal(p.nodes.get('#employeeCount').textContent,'1 人');
  assert.match(p.nodes.get('#employeeList').innerHTML,/測試工讀生/);
});
test('expired login does not query payroll or show a misleading zero roster',async()=>{
  const p=page(Promise.resolve({ok:false,reauth:true,message:'管理者安全登入已失效'}));
  await p.context.reloadAll();
  assert.deepEqual(p.reads,[]);
  assert.equal(p.nodes.get('#employeeCount').textContent,'未載入');
  assert.match(p.nodes.get('#pageMsg').innerHTML,/login.html\?next=data-center/);
});
test('transient auth errors remain retryable without forcing login',async()=>{
  const p=page(Promise.resolve({ok:false,reauth:false,message:'登入恢復較慢'}));
  await p.context.reloadAll();
  assert.deepEqual(p.reads,[]);
  assert.match(p.nodes.get('#pageMsg').innerHTML,/重新讀取/);
  assert.doesNotMatch(p.nodes.get('#pageMsg').innerHTML,/href="login/);
});
test('query failure displays an actionable error rather than zero employees',async()=>{
  const p=page(Promise.resolve({ok:true}));
  p.context.all=async()=>{throw Error('Missing or insufficient permissions.');};
  await p.context.reloadAll();
  assert.match(p.nodes.get('#pageMsg').innerHTML,/Missing or insufficient permissions/);
  assert.equal(p.nodes.get('#employeeCount').textContent,'未載入');
  assert.match(html,/#pageMsg:not\(:empty\)\{display:block\}/);
});
