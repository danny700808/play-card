'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/shipping-ui/app.js','utf8').split("$('refresh').addEventListener")[0];
function harness({channel='蝦皮',action='',fail=false}={}){
  const elements=new Map(),calls=[],renders=[];let release;
  const waiting=new Promise(r=>release=r);
  function element(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,open:id==='documentDialog',
    classList:{toggle(){}},close(){this.open=false;}});return elements.get(id);}
  const row={key:'TEST:123',orderNo:'TEST1234567890',platform:channel==='蝦皮'?'EasyStore':'MOMO',channel,
    tracking:'TRACK1',stage:'label',handled:!!action,handlingAction:action,items:[],date:'2026-11-11',printCount:2};
  const window={ShippingTransport:{async api(path,body){calls.push({path,body});await waiting;if(fail)throw Error('offline');return {ok:true};}}};
  window.self=window;window.top=window;
  const context=vm.createContext({window,ShippingModel:require('./shipping-ui/model.js'),document:{getElementById:element,querySelector:()=>null,documentElement:{classList:{toggle(){}}}},row,renders});
  vm.runInContext(source+'\ndata.orders=[row];selected=row.key;render=()=>renders.push({work:activeWork,keys:filtered().map(r=>r.key)});',context);
  return {row,calls,renders,element,release,run:()=>vm.runInContext('recordLocalSubmission({...row})',context),
    evaluate:code=>vm.runInContext(code,context)};
}
test('successful local Shopee submission moves immediately, saves without refreshing all orders',async()=>{
  const h=harness();const work=h.run();
  assert.equal(h.row.handled,true);assert.equal(h.row.handlingAction,'processed');
  assert.equal(h.renders.at(-1).work,'done');assert.equal(h.renders.at(-1).keys[0],h.row.key);
  assert.equal(h.element('documentDialog').open,false);
  assert.deepEqual(h.calls.map(x=>x.path),['/api/handling']);assert.equal(h.calls[0].body.action,'processed');
  h.release();await work;assert.match(h.element('notice').textContent,/已保存/);
  assert.equal(h.row.stage,'label');assert.notEqual(h.row.handlingAction,'shipped');
});
test('save failure remains distinct from printing and restores unsaved classification without resending',async()=>{
  const h=harness({fail:true});const work=h.run();h.release();await work;
  assert.equal(h.row.handled,false);assert.match(h.element('notice').textContent,/已送印.*未保存/);
  assert.equal(h.calls.length,1);assert.equal(h.renders.at(-1).work,'pending');
});
test('host-backed labels preserve print count and use their existing print-event endpoint',async()=>{
  const h=harness({channel:'MOMO'});const work=h.run();
  assert.equal(h.row.handled,true);assert.equal(h.row.printCount,3);
  assert.deepEqual(h.calls.map(x=>x.path),['/api/print-event']);h.release();await work;
});
test('reprinting cannot downgrade printed or shipped handling',async()=>{
  for(const action of ['printed','shipped']){const h=harness({action});await h.run();
    assert.equal(h.row.handlingAction,action);assert.equal(h.calls.length,0);}
});
test('late save failure does not navigate away from another selected order',async()=>{
  const h=harness({fail:true});const work=h.run();h.evaluate("selected='OTHER';activeWork='all'");
  h.release();await work;assert.equal(h.evaluate('selected'),'OTHER');assert.equal(h.evaluate('activeWork'),'all');
});
test('newer handling confirmation is not overwritten by a late save failure',async()=>{
  const h=harness({fail:true});const work=h.run();h.row.handlingAction='printed';h.row.handlingSource='店內確認';
  h.release();await work;assert.equal(h.row.handlingAction,'printed');assert.equal(h.row.handled,true);
});
test('changed tracking does not mark the replacement shipment processed',async()=>{
  const h=harness();h.evaluate("var printed={...row};row.tracking='OTHER'");
  await h.evaluate('recordLocalSubmission(printed)');assert.equal(h.row.handled,false);assert.equal(h.calls.length,0);
});
