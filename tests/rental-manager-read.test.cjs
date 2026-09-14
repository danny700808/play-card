const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../rental-common.js'),'utf8');
function setup({claims={employee:true,manager:true,employeeId:'manager-1'},search='',status=200,ready=Promise.resolve()}={}){
  const requests=[];
  const firestore=()=>{throw Error('SDK private read must not run');};
  firestore.Timestamp={fromDate:date=>date};
  const currentUser={getIdTokenResult:async(force)=>{assert.equal(force,undefined);return {claims,token:'test-id-token'};}};
  const auth={currentUser,authStateReady:()=>ready};
  const window={APP_CONFIG:{FIREBASE_CONFIG:{projectId:'demo-rental'}},location:{search},firebase:{apps:[{}],app:()=>({}),auth:()=>auth,firestore}};
  const context={window,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{
    requests.push({url,options});
    const doc={name:'projects/demo-rental/databases/(default)/documents/rentalContracts/c1',fields:{status:{stringValue:'租用中'},amount:{integerValue:'1200'},items:{arrayValue:{values:[{mapValue:{fields:{name:{stringValue:'鋼琴'}}}}]}}}};
    return {ok:status===200,status,json:async()=>url.endsWith(':runQuery')?[{document:doc},{readTime:'now'}]:doc,text:async()=>JSON.stringify({ok:true,contract:{contractId:'customer-contract'}})};
  }};
  vm.runInNewContext(source,context);
  return {R:window.YZRental,requests,auth};
}
test('manager read waits for restored identity and uses one authenticated query',async()=>{
  let release;const ready=new Promise(resolve=>release=resolve);
  const {R,requests}=setup({ready});const pending=R.all('rentalContracts',800);
  await Promise.resolve();assert.equal(requests.length,0);release();
  const rows=await pending;assert.equal(rows.length,1);assert.equal(rows[0].__id,'c1');assert.equal(rows[0].amount,1200);assert.equal(rows[0].items[0].name,'鋼琴');
  assert.equal(requests.length,1);assert.equal(requests[0].options.headers.Authorization,'Bearer test-id-token');
  assert.equal(JSON.parse(requests[0].options.body).structuredQuery.limit,800);
});
test('non-manager cannot issue a private query',async()=>{
  const {R,requests}=setup({claims:{employee:true,employeeId:'teacher'}});
  await assert.rejects(R.all('rentalApplications'),/沒有設備租賃管理權限/);assert.equal(requests.length,0);
});
test('permission failure stays a failure, not an empty list',async()=>{
  const {R}=setup({status:403});await assert.rejects(R.all('rentalContracts'),/權限拒絕/);
});
test('single contract read uses authenticated document path',async()=>{
  const {R,requests}=setup();assert.equal((await R.get('rentalContracts','c1')).__id,'c1');
  assert.match(requests[0].url,/\/rentalContracts\/c1$/);assert.equal(requests[0].options.method,'GET');
});
test('customer contract token still uses scoped backend without manager authentication',async()=>{
  const {R,requests,auth}=setup({search:'?token=customer-secret'});auth.currentUser=null;
  assert.equal((await R.get('rentalContracts','c1')).contractId,'customer-contract');
  assert.match(requests[0].url,/rentalGetContractHttp$/);assert.equal(JSON.parse(requests[0].options.body).token,'customer-secret');
});
test('admin loading commits both collections together and rejects false empty state',async()=>{
  const html=fs.readFileSync(path.join(__dirname,'../rental-admin.html'),'utf8');
  const load=html.match(/async function loadAll\(\)\{[\s\S]*?(?=\n    window.retryRentalLoad)/)[0];
  let resolveApplications;const applicationsPending=new Promise(resolve=>resolveApplications=resolve);const calls=[];
  const context={rentalDataState:'loading',applications:[],contracts:[],renderList(){},renderStats(){},R:{all:name=>{calls.push(name);return name==='rentalApplications'?applicationsPending:Promise.reject(Error('denied'));},toast(){}}};
  vm.createContext(context);vm.runInContext(load,context);await context.loadAll();
  assert.deepEqual(calls,['rentalApplications','rentalContracts']);assert.equal(context.rentalDataState,'error');assert.equal(context.applications.length,0);resolveApplications([{__id:'a1'}]);
});
