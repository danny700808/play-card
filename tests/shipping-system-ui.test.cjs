const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(embedded=true){
  let listener,reads=0;const requests=[],elements={};
  const element=id=>elements[id]??={hidden:false,value:'',addEventListener(){},classList:{toggle(){}}};
  const user={getIdToken:async()=> 'verified.firebase.token'};
  const auth={currentUser:user,onAuthStateChanged(fn){listener=fn;return ()=>{};}};
  const location={origin:'https://danny700808.github.io',search:embedded?'?embedded=1':''};
  const window={parent:{location,firebase:{auth:()=>auth}},addEventListener(){}};
  const context={window,location,URLSearchParams,AbortSignal,document:{getElementById:element,querySelectorAll:()=>[]},
    localStorage:{getItem(){reads++;return null;},removeItem(){}},sessionStorage:{getItem(){reads++;return null;},removeItem(){}},
    fetch:async(url,options)=>{requests.push(options);return {ok:true,json:async()=>({orders:[],agentOnline:true})};}};
  vm.runInNewContext(fs.readFileSync('shipping-desk.js','utf8'),context);
  return {window,auth,user,elements,requests,reads:()=>reads,notify:async u=>{auth.currentUser=u;await listener(u);}};
}
test('portal entry uses parent Firebase identity without password or stored packing session',async()=>{
  const f=fixture();let starts=0;
  f.window.ShippingTransport.ready(async()=>{starts++;await f.window.ShippingTransport.api('/api/orders');});
  assert(!f.elements.packingLogin.innerHTML.includes('type="password"'));
  assert.equal(f.reads(),0);
  await f.notify(f.user);
  assert.equal(starts,1);assert.equal(f.elements.packingLogin.hidden,true);
  assert.equal(f.requests[0].headers.Authorization,'Bearer verified.firebase.token');
  assert.equal(JSON.parse(f.requests[0].body).action,'orders');
  await f.notify(null);
  assert.equal(f.elements.packingApp.hidden,true);assert.equal(f.window.ShippingTransport.loggedIn(),false);
  await assert.rejects(f.window.ShippingTransport.api('/api/orders'));
  assert.equal(f.requests.length,1);
});
test('missing system login stays locked and never calls the API',async()=>{
  const f=fixture();f.window.ShippingTransport.ready(()=>assert.fail('must not start'));
  await f.notify(null);assert.equal(f.requests.length,0);assert.equal(f.elements.packingApp.hidden,true);
});
test('standalone packing login remains available',()=>{
  const f=fixture(false);f.window.ShippingTransport.ready(()=>{});
  assert(f.reads()>0);assert.equal(f.elements.packingLogin.innerHTML,undefined);
  assert.equal(f.elements.packingLogin.hidden,false);
});
