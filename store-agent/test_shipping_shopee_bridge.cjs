const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const row={key:'EasyStore:123',platform:'EasyStore',channel:'蝦皮',externalId:'123',orderNo:'ORDER-123',stage:'shipped',tracking:'TRACK-1'};
function harness(){
  const sent=[],timers=new Map();let listener,n=0;
  const elements=new Map();
  const element=()=>({children:[],open:false,dataset:{},style:{},append(...items){this.children.push(...items);},remove(){},addEventListener(){}});
  elements.set('documentDialog',element());elements.set('directShipmentOptions',element());
  const origin='https://danny700808.github.io';
  const window={postMessage:m=>sent.push(m),addEventListener:(name,fn)=>{if(name==='message')listener=fn;},dispatchEvent(){}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../shipping-shopee-bridge.js','utf8'),{
    window,document:{getElementById:id=>elements.get(id),createElement:element,createTextNode:text=>text},location:{origin},crypto:{randomUUID:()=>String(++n)},Event:class{},atob,Uint8Array,
    setTimeout:(fn)=>{timers.set(n,fn);return n;},clearTimeout:id=>timers.delete(id)});
  function reply(message,overrides={}){listener({source:window,origin,...overrides,data:{namespace:'youzi-shipping-helper',version:1,direction:'helper',...message}});}
  const ready=()=>reply({requestId:sent.find(m=>m.type==='probe').requestId,type:'ready',capabilities:{unifiedDocument:true}});
  const document=()=>({type:'document',key:row.key,orderNo:row.orderNo,tracking:row.tracking,
    pdfBase64:Buffer.from('%PDF-1.7\noriginal').toString('base64'),previewDataUrl:'data:image/png;base64,iVBORw0KGgo='});
  return {bridge:window.YouziShopeeBridge,sent,reply,ready,document,timers,elements};
}
const flush=()=>new Promise(setImmediate);
test('loading only probes; getting an existing label requests reprint and returns bytes, never print',async()=>{
  const h=harness();assert.deepEqual(h.sent.map(m=>m.type),['probe']);
  h.ready();const promise=h.bridge.getDocument(row);await flush();
  const req=h.sent.at(-1);assert.equal(req.type,'get-document');assert.equal(req.order.mode,'reprint');
  h.reply({...h.document(),requestId:req.requestId});
  const result=await promise;assert.equal(Buffer.from(result.pdf).toString(),'%PDF-1.7\noriginal');
  assert.equal(h.sent.some(m=>m.type==='print'),false);
});

test('direct mode accepts complete platform defaults without opening a dialog and does not repeat a confirmation',async()=>{
 const h=harness();h.ready();const p=h.bridge.getDocument(row,()=>{},{direct:true});await flush();
 const id=h.sent.at(-1).requestId;
 const form={requestId:id,type:'shipment-form',key:row.key,orderNo:row.orderNo,phase:'confirm',fields:[{id:'location',label:'寄件地點',type:'select',value:'1',options:[{id:'1',label:'既有寄件地點'}]}]};
 h.reply(form);assert.equal(h.sent.at(-1).type,'shipment-choice');assert.equal(h.sent.at(-1).values.location,'1');
 assert.equal(h.elements.get('documentDialog').open,false);assert.equal(h.elements.get('directShipmentOptions').children.length,0);
 h.reply(form);assert.equal(h.sent.filter(m=>m.type==='shipment-choice').length,1);
 h.reply({...h.document(),requestId:id});await p;
});
test('ambiguous shipping choices stay inline and are never guessed',async()=>{
 const h=harness();h.ready();const p=h.bridge.getDocument(row,()=>{},{direct:true});await flush();const id=h.sent.at(-1).requestId;
 h.reply({requestId:id,type:'shipment-form',key:row.key,orderNo:row.orderNo,phase:'options',fields:[{id:'location',label:'寄件地點',type:'select',value:'',options:[{id:'1',label:'地點一'},{id:'2',label:'地點二'}]}]});
 assert.equal(h.sent.some(m=>m.type==='shipment-choice'),false);assert.equal(h.elements.get('directShipmentOptions').children.length,1);
 assert.equal(h.elements.get('documentDialog').open,false);h.reply({...h.document(),requestId:id});await p;
});
test('other windows, origins, request IDs and orders cannot complete a pending request',async()=>{
  const h=harness();h.ready();let done=false;
  const p=h.bridge.getDocument(row).then(r=>{done=true;return r;});await flush();
  const id=h.sent.at(-1).requestId,msg={...h.document(),requestId:id};
  h.reply(msg,{source:{}});h.reply(msg,{origin:'https://other.test'});
  h.reply({...msg,requestId:'wrong'});h.reply({...msg,orderNo:'OTHER'});await flush();assert.equal(done,false);
  h.reply(msg);await p;assert.equal(done,true);
});
test('tracking mismatch, non-PDF, and executable preview formats are rejected',async()=>{
  for(const change of [{tracking:'OTHER'},{pdfBase64:Buffer.from('<html>login</html>').toString('base64')},{previewDataUrl:'data:image/svg+xml,<svg/>'}]){
    const h=harness();h.ready();const p=h.bridge.getDocument(row);await flush();
    h.reply({...h.document(),...change,requestId:h.sent.at(-1).requestId});await assert.rejects(p);
  }
});
test('login-required stops in the shared dialog without an automatic navigation or new shipment',async()=>{
  const h=harness();h.ready();const p=h.bridge.getDocument(row);await flush();
  h.reply({type:'error',key:row.key,orderNo:row.orderNo,code:'login_required',requestId:h.sent.at(-1).requestId});
  await assert.rejects(p,/登入已失效/);assert.deepEqual(h.sent.map(m=>m.type),['probe','get-document']);
});
test('closing while discovery is pending does not start a late shipment',async()=>{
  const h=harness();const p=h.bridge.getDocument({...row,tracking:'',stage:'pending'});
  h.bridge.cancel();h.ready();await assert.rejects(p,/已關閉/);
  assert.equal(h.sent.some(m=>m.type==='get-document'),false);
});
test('cancelled and stale orders are blocked before the helper sees order data',async()=>{
  for(const changes of [{stage:'cancelled'},{stage:'partial'},{stale:true},{externalId:'123&other=456'}]){
    const h=harness();h.ready();await assert.rejects(h.bridge.getDocument({...row,...changes}));
    assert.equal(h.sent.some(m=>m.type==='get-document'),false);
  }
});
test('timeout does not retry a potentially completed shipment',async()=>{
  const h=harness();h.ready();const p=h.bridge.getDocument(row);await flush();
  h.timers.get(Number(h.sent.at(-1).requestId))();
  await assert.rejects(p,/不會自動重送/);
  assert.deepEqual(h.sent.map(m=>m.type),['probe','get-document','cancel']);
});

test('missing historical original is distinct from a new label still being prepared',async()=>{
 const h=harness();h.ready();
 const p=h.bridge.getDocument(row);await flush();
 h.reply({type:'error',key:row.key,orderNo:row.orderNo,code:'not_ready',requestId:h.sent.at(-1).requestId});
 await assert.rejects(p,/已處理不代表這台電腦已保存原單/);
 assert.equal(h.sent.filter(m=>m.type==='get-document').length,1);
 assert.equal(h.sent.at(-1).order.mode,'reprint');
 const fresh=harness();fresh.ready();
 const newOrder={...row,stage:'pending',tracking:''};
 const pending=fresh.bridge.getDocument(newOrder);await flush();
 fresh.reply({type:'error',key:row.key,orderNo:row.orderNo,code:'not_ready',requestId:fresh.sent.at(-1).requestId});
 await assert.rejects(pending,/目前未能取得這筆貨運單/);
 assert.equal(fresh.sent.filter(m=>m.type==='get-document').length,1);
});

