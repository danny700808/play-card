const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const model=require('./shipping-ui/model.js');
const source=fs.readFileSync(__dirname+'/shipping-ui/app.js','utf8').split("$('refresh').addEventListener")[0];
const tick=()=>new Promise(setImmediate);
function harness({channel='MOMO',saved=false,printFailure=false,delay=false,refreshFailure=false,metadataDelay=false}={}){
  const elements=new Map(),calls=[],prints=[];let releases={},dialogs=0;
  function element(id){if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,open:false,
    classList:{toggle(){}},querySelectorAll:()=>[],addEventListener(){},showModal(){dialogs++;this.open=true;},close(){this.open=false;}});return elements.get(id);}
  const row={key:channel==='蝦皮'?'EasyStore:123':channel+':123',externalId:'123',orderNo:'TEST1234567890',platform:['蝦皮','官網','LINE'].includes(channel)?'EasyStore':channel==='酷澎'?'Coupang':'MOMO',
    channel,stage:'pending',date:'2026-11-20',handled:false,tracking:saved?'TRACK':'',documentReady:saved,canCreate:!saved,canDownload:saved,
    carrierCode:'TWL_HCT',items:[{id:'1',name:'TEST ITEM',quantity:1,sku:'123'}],paidAmountStatus:'confirmed',paidAmount:'1800',paidCurrency:'TWD',
    ...(['官網','LINE'].includes(channel)?{documentType:'postal-address-v1',shippingMethod:'postal'}:{})};
  const snapshot=()=>({orders:[row],errors:{},days:3,updated:new Date().toISOString()});
  const window={};window.self=window;window.top=window;
  window.ShippingTransport={loggedIn:()=>true,api:async(path,body)=>{
    calls.push({path,body});
    if(path==='/api/refresh'){
      if(delay)await new Promise(resolve=>releases.refresh=resolve);
      if(refreshFailure)throw Error('host offline');return snapshot();
    }
    if(path==='/api/orders')return snapshot();
    if(path==='/api/preview')return {...row,action:'create',fingerprint:'F'};
    if(path==='/api/process'){row.documentReady=true;row.handlingAction='acquired';row.handled=true;return {};}
    if(path==='/api/document-link')return {print:'/saved.pdf'};
    if(['/api/print-event','/api/handling'].includes(path))return {};
    throw Error('Unexpected '+path);
  }};
  window.YouziLocalPrint={reset(){},async printDocument(row,links,submitted,options){
    prints.push({row,links,options});options.onStatus('準備中');
    if(delay)await new Promise(resolve=>releases.print=resolve);
    if(printFailure)throw Error('送印結果尚未確認');
    if(options.isActive())await submitted();
  }};
  window.YouziShopeeBridge={cancel(){},async getDocument(row,progress,options){calls.push({path:'helper',options});return {tracking:'TRACK',pdf:new Uint8Array([1,2,3])};}};
  window.YouziLocalMetadata={async read(){calls.push({path:'metadata'});if(metadataDelay)await new Promise(resolve=>releases.metadata=resolve);return {results:[],verifiedAt:new Date().toISOString()};}};
  const context=vm.createContext({window,ShippingModel:model,document:{getElementById:element,querySelector:()=>null,documentElement:{classList:{toggle(){}}}},row,Blob,URL:{createObjectURL:()=>'/blob.pdf',revokeObjectURL(){}},Uint8Array});
  vm.runInContext(source+'\ndata.orders=[row];selected=row.key;',context);
  return {row,calls,prints,releases,element,dialogs:()=>dialogs,run:code=>vm.runInContext(code,context)};
}
for(const channel of ['蝦皮','MOMO','酷澎','官網','LINE'])test(channel+' one click acquires and prints without opening a preview, then returns to pending',async()=>{
  const h=harness({channel});await h.run('printOrder(row)');
  assert.equal(h.prints.length,1);assert.equal(h.dialogs(),0);assert.equal(h.run('activeWork'),'pending');assert.equal(h.row.handled,true);
  assert.ok(h.calls.some(c=>c.path===(channel==='蝦皮'?'/api/handling':'/api/print-event')));
  if(channel==='蝦皮')assert.equal(h.calls.find(c=>c.path==='helper').options.direct,true);
  assert.equal(h.run('busy'),false);
});
for(const channel of ['蝦皮','MOMO','酷澎','官網','LINE'])test(channel+' packing action obtains the same label and submits one combined job',async()=>{
  const h=harness({channel});await h.run('printPacking(row)');
  assert.equal(h.prints.length,1);assert.equal(h.prints[0].options.packingSheet,true);
  assert.equal(h.prints[0].row.orderNo,h.row.orderNo);assert.equal(h.dialogs(),0);
  assert.equal(h.row.handled,true);assert.equal(h.run('activeWork'),'pending');
});
test('a combined print failure leaves the order pending and never requests a separate label print',async()=>{
  const h=harness({saved:true,printFailure:true});await h.run('printPacking(row)');
  assert.equal(h.prints.length,1);assert.equal(h.row.handled,false);
  assert.equal(h.calls.some(c=>c.path==='/api/print-event'),false);
});
test('saved labels go straight to their document link without creating another shipment',async()=>{
 const h=harness({saved:true});await h.run('printOrder(row)');
 assert.equal(h.prints.length,1);assert.equal(h.calls.some(c=>['/api/preview','/api/process'].includes(c.path)),false);
});
test('double click waits on the same print; uncertain printing is not recorded as completed',async()=>{
 const h=harness({delay:true,printFailure:true,saved:true});const first=h.run('printOrder(row)');await tick();await h.run('printOrder(row)');
 assert.equal(h.prints.length,1);h.releases.print();await first;
 assert.equal(h.row.handled,false);assert.match(h.element('notice').textContent,/尚未確認/);
 assert.equal(h.calls.some(c=>c.path==='/api/print-event'),false);
});
test('changed or invalid order cannot create or print a shipment',async()=>{
 const h=harness();h.row.stale=true;await h.run('printOrder(row)');assert.equal(h.calls.length,0);assert.equal(h.prints.length,0);
});
test('refresh button stays waiting through both host update and local deadline read',async()=>{
 const h=harness({channel:'蝦皮',delay:true,metadataDelay:true});const update=h.run('refresh()');await tick();
 assert.equal(h.element('refresh').disabled,true);assert.equal(h.element('refresh').textContent,'更新中，請等待…');
 await h.run('refresh()');assert.equal(h.calls.filter(c=>c.path==='/api/refresh').length,1);
 h.releases.refresh();await tick();assert.equal(h.element('refresh').disabled,true);assert.ok(h.releases.metadata);
 h.releases.metadata();await update;assert.equal(h.element('refresh').disabled,false);assert.equal(h.element('refresh').textContent,'更新讀取最新訂單');
});
test('failed refresh restores the button and displays its error',async()=>{
 const h=harness({refreshFailure:true});await h.run('refresh()');assert.equal(h.element('refresh').disabled,false);
 assert.equal(h.element('refresh').textContent,'更新讀取最新訂單');assert.match(h.element('notice').textContent,/host offline/);
});
