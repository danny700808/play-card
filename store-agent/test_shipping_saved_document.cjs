const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('./shipping-ui/model.js');
function harness(overrides={},rejectSaved=false){
  const elements=new Map(),calls=[];
  function element(id){
    if(!elements.has(id))elements.set(id,{
      innerHTML:'',textContent:'',value:'',open:false,hidden:false,
      classList:{toggle(){}},addEventListener(){},querySelectorAll(){return [];},
      removeAttribute(){},showModal(){this.open=true;}
    });
    return elements.get(id);
  }
  const row={key:'MOMO:123:1',platform:'MOMO',channel:'MOMO',orderNo:'123',items:[],
    stage:'label',canDownload:true,documentReady:true,recipient:'陳○○',
    address:'100 台北市中正區 ○○○○',...overrides};
  const window={ShippingTransport:{loggedIn:()=>true,async api(path){
    calls.push(path);
    if(path==='/api/document-link'){
      if(rejectSaved)throw Error('舊文件與目前訂單尚未確認一致。');
      return {label:'https://example.test/current.pdf'};
    }
    if(path==='/api/preview')return {...row,action:'download',fingerprint:'current'};
    if(path==='/api/process')return {ready:true};
    if(path==='/api/orders')return {orders:[row],errors:{}};
    throw Error(path);
  }}};
  window.self=window;window.top=window;
  const context=vm.createContext({window,ShippingModel:model,
    document:{getElementById:element,querySelector:()=>null,documentElement:{classList:{toggle(){}}}},
    row});
  vm.runInContext(fs.readFileSync(__dirname+'/shipping-ui/app.js','utf8').split("$('refresh').addEventListener")[0]+
    '\ndata.orders=[row];selected=row.key;',context);
  return {calls,element,run:()=>vm.runInContext('prepare(row)',context)};
}
test('saved MOMO reprint uses one document command and no platform processing',async()=>{
  const h=harness();await h.run();
  assert.deepEqual(h.calls,['/api/document-link']);
  assert.match(h.element('documentSummary').innerHTML,/已遮蔽部分姓名或地址/);
  assert.match(h.element('documentSummary').innerHTML,/100 台北市中正區 ○○○○/);
  assert.equal(h.element('openDocument').href,'https://example.test/current.pdf');
});
test('first retrieval still validates and processes the platform document',async()=>{
  const h=harness({documentReady:false});await h.run();
  assert.deepEqual(h.calls,['/api/preview','/api/process','/api/orders','/api/document-link']);
});

test('a saved CVS label remains printable when an older snapshot says canCreate',async()=>{
  const h=harness({stage:'pending',canCreate:true,canDownload:false,handlingAction:'acquired'});
  await h.run();
  assert.deepEqual(h.calls,['/api/document-link']);
  assert.match(h.element('detail').innerHTML,/列印貨運單/);
  assert.doesNotMatch(h.element('detail').innerHTML,/申請出貨與貨運單/);
});

test('an invalidated saved document cannot fall back to creating another shipment',async()=>{
  const calls=[];
  await assert.rejects(model.obtainDocument(async(path)=>{
    calls.push(path);return {key:'MOMO:123:1',action:'create',fingerprint:'fresh'};
  },{key:'MOMO:123:1',documentReady:true,canDownload:false},{}),/未申請新出貨/);
  assert.deepEqual(calls,['/api/preview']);
});

test('Coupang home delivery obtains a document without a separate address-code form',async()=>{
  const h=harness({key:'Coupang:123',platform:'Coupang',channel:'酷澎',status:'ACCEPT',
    stage:'pending',carrierCode:'TWL_HCT',canCreate:true,canDownload:false,documentReady:false});
  await h.run();
  assert.deepEqual(h.calls,['/api/preview','/api/process','/api/orders','/api/document-link']);
  assert.equal(h.element('shipmentOptions').hidden,true);
});
test('a rejected saved document never silently creates or resubmits a shipment',async()=>{
  const h=harness({},true);await h.run();
  assert.deepEqual(h.calls,['/api/document-link']);
  assert.match(h.element('documentStatus').textContent,/舊文件與目前訂單/);
  assert.equal(h.element('documentControls').hidden,true);
});
test('changed records do not take the saved-document shortcut',async()=>{
  const h=harness({handlingChanged:true});await h.run();
  assert.equal(h.calls[0],'/api/preview');
});
test('unmasked address remains unchanged and has no misleading masking hint',async()=>{
  const h=harness({recipient:'測試收件人',address:'測試市測試路 1 號'});await h.run();
  assert.match(h.element('documentSummary').innerHTML,/測試市測試路 1 號/);
  assert.doesNotMatch(h.element('documentSummary').innerHTML,/已遮蔽部分/);
});
