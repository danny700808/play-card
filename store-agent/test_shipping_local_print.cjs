const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('./shipping-ui/model.js');

function harness({rowChanges={},carrier='7-11店到店',shippingMethod,prepareStatus='prepared',prepareError='',printError='',documentOk=true,
  layouts=['packing-footer-v1'],replyLayout='packing-footer-v1',channel='MOMO',profiles=['momo-cvs-v1'],replyProfile='momo-cvs-v1',replyPages=1,printLink=true}={}){
  const elements=new Map(),calls=[];
  function el(){return {style:{},children:[],open:true,disabled:false,textContent:'',setAttribute(){},
    append(...nodes){this.children.push(...nodes);},prepend(node){this.children.unshift(node);elements.set(node.id,node);},
    remove(){elements.delete(this.id);}};}
  for(const id of ['documentControls','documentDialog','printerHint','documentPreviewImage','zoomDocumentPreview','documentPlaceholder','previewCaption'])elements.set(id,el());
  let printed=0;
  const window={confirm:()=>{throw Error('No extra confirmations');},ShippingModel:model};
  const context=vm.createContext({window,document:{getElementById:id=>elements.get(id),createElement:el},
    AbortSignal,FileReader:class{readAsDataURL(){this.result='data:application/pdf;base64,JVBERi0=';this.onload();}},
    fetch:async(url,options)=>{
      const body=options.body?JSON.parse(options.body):undefined;
      calls.push({url,body});
      if(url==='https://example.test/label.pdf')return {ok:documentOk,blob:async()=>new Blob(['%PDF-1.7\nlabel'])};
      if(url.endsWith('/health'))return {ok:true,json:async()=>({service:'youzi-shipping-print',printProfiles:profiles,packingLayouts:layouts})};
      if(url.endsWith('/prepare'))return {ok:!prepareError,json:async()=>prepareError?{error:prepareError}:{jobId:'job-1',status:body.reprint?'prepared':prepareStatus,alreadySubmitted:prepareStatus==='preview',layoutVersion:replyLayout,preview:'data:image/png;base64,cHJldmlldw==',pages:replyPages,printProfile:replyProfile,paperMm:[100,150]}};
      if(url.endsWith('/print'))return {ok:!printError,json:async()=>printError?{error:printError}:{status:'submitted'}};
      throw Error('Unexpected endpoint');
    }});
  vm.runInContext(fs.readFileSync(__dirname+'/../shipping-local-print.js','utf8'),context);
  window.YouziLocalPrint.attach({channel,items:[{name:'測試商品',variant:'藍色',sku:'2044749-17',quantity:2}],paidAmount:'2070',paidAmountStatus:'confirmed',paidCurrency:'TWD',orderNo:'TEST-ORDER',key:'MOMO:TEST',tracking:'TRACK-TEST',carrier,shippingMethod,...rowChanges},
    printLink?{print:'https://example.test/label.pdf'}:{label:'https://example.test/label.pdf'},async()=>{printed++;});
  const box=elements.get('localPrintControls');
  return {button:box.children[0],status:box.children[1],elements,calls,printed:()=>printed};
}

test('MOMO CVS uses a single-label caption and reports prepare errors without printing',async()=>{
  const h=harness({prepareError:'尚不支援此 PDF 版型'});
  await new Promise(setImmediate);
  assert.equal(h.button.textContent,'列印貨運單');
  assert.match(h.elements.get('printerHint').textContent,/單張原單/);
  await h.button.onclick();
  assert.match(h.status.textContent,/TEST-ORDER · 副機準備標籤：尚不支援此 PDF 版型/);
  assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,0);
  assert.equal(h.printed(),0);
  assert.equal(h.button.disabled,false);
});

test('MOMO home-delivery keeps the existing two-label setting',async()=>{
  const h=harness({carrier:'第三方物流-新竹貨運'});
  await new Promise(setImmediate);
  assert.equal(h.button.textContent,'列印貨運單');
  assert.match(h.elements.get('printerHint').textContent,/左右雙聯/);
  await h.button.onclick();
  assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,1);
  assert.equal(h.printed(),1);
});

test('a submitted document is identified before clicking; one explicit reprint submits once',async()=>{
  const h=harness({prepareStatus:'submitted'});
  await new Promise(setImmediate);
  assert.equal(h.button.textContent,'重印貨運單');
  assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,0);
  await h.button.onclick();
  assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,1);
  assert.equal(h.printed(),1);
  assert.equal(h.calls.filter(c=>c.url.endsWith('/prepare')).at(-1).body.reprint,true);
});

test('print failure remains distinct from document preparation and never records success',async()=>{
  const h=harness({printError:'印表機佇列不可用'});
  await h.button.onclick();
  assert.match(h.status.textContent,/副機送交印表機：印表機佇列不可用/);
  assert.equal(h.printed(),0);
});

test('an expired document URL never reaches the packing-PC print service',async()=>{
  const h=harness({documentOk:false});
  await h.button.onclick();
  assert.match(h.status.textContent,/副機準備標籤：原單連結已失效/);
  assert.equal(h.calls.filter(c=>c.body).length,0);
  assert.equal(h.printed(),0);
});

for(const [carrier,shippingMethod] of [['全家店到店','family'],['7-11店到店','seven']])
test(carrier+' transmits the exact single-label profile on every preparation',async()=>{
  const h=harness({carrier,shippingMethod,prepareStatus:'submitted'});
  await new Promise(setImmediate);
  assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,0);
  await h.button.onclick();
  const requests=h.calls.filter(c=>c.url.endsWith('/prepare'));
  assert(requests.length>=2);
  for(const {body} of requests){
    assert.equal(body.printProfile,'momo-cvs-v1');assert.equal(body.shippingMethod,shippingMethod);
    assert.equal(body.orderKey,'MOMO:TEST');assert.equal(body.tracking,'TRACK-TEST');
  }
  assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,1);
});

for(const options of [{profiles:[]},{replyProfile:'old'},{replyPages:2},{printLink:false},
  {carrier:'全家店到店',shippingMethod:'seven'}])
test('unsafe or outdated CVS preparation cannot reach /print: '+JSON.stringify(options),async()=>{
  const h=harness(options);await h.button.onclick();
  assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,0);
  assert.equal(h.printed(),0);assert.match(h.status.textContent,/尚未送印|不一致/);
});

for(const channel of ['蝦皮','MOMO','酷澎','官網'])
test(channel+' uses the final label pixels for preview and sends all footer details without printing',async()=>{
 const h=harness({channel,prepareStatus:'preview'});await new Promise(setImmediate);
 const requests=h.calls.filter(c=>c.url.endsWith('/prepare'));
 assert.equal(requests.length,1);
 assert.equal(requests[0].body.packingFooter.items[0].name,'測試商品 / 藍色');
 assert.equal(requests[0].body.packingFooter.items[0].sku,'204-4749-17');
 assert.equal(requests[0].body.packingFooter.paidAmount,'2070');
 assert.equal(h.button.textContent,'重印貨運單');
 assert.equal(h.elements.get('documentPreviewImage').src,'data:image/png;base64,cHJldmlldw==');
 assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,0);
 await h.button.onclick();
 assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,1);
 assert.equal(h.calls.filter(c=>c.url.endsWith('/prepare')).at(-1).body.reprint,true);
});
for(const option of [{layouts:[]},{replyLayout:'old'}])
test('cannot silently print an old cached layout: '+JSON.stringify(option),async()=>{
 const h=harness(option);await h.button.onclick();
 assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,0);
});

test('MOMO items without SKU reach preparation and explicit print with full name and quantity',async()=>{
 const h=harness({rowChanges:{items:[{name:'木箱鼓',variant:'P02',sku:'134-0106',quantity:1},
  {name:'木箱鼓專用袋',variant:'P02專用袋',sku:null,quantity:1}]}});
 await new Promise(setImmediate);
 assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,0);
 assert.equal(h.calls.filter(c=>c.url.endsWith('/prepare')).length,1);
 await h.button.onclick();
 for(const {body} of h.calls.filter(c=>c.url.endsWith('/prepare'))){
  assert.equal(body.packingFooter.items.length,2);
  assert.deepEqual(body.packingFooter.items[1],{name:'木箱鼓專用袋 / P02專用袋',sku:'',quantity:1});
 }
 assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,1);
});

test('unpaid Shopee 425 reaches both preview and reprint footer with the existing helper contract',async()=>{
 const h=harness({channel:'蝦皮',prepareStatus:'preview',rowChanges:{
  paidAmount:null,paidAmountStatus:'pending_collection',payableAmount:'425'}});
 await new Promise(setImmediate);
 assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,0);
 assert.equal(h.calls.filter(c=>c.url.endsWith('/prepare')).length,1);
 await h.button.onclick();
 for(const {body} of h.calls.filter(c=>c.url.endsWith('/prepare'))){
  assert.equal(body.packingFooter.paidAmount,'425');
  assert.equal(body.packingFooter.paidAmountStatus,'confirmed');
  assert.equal(body.packingFooter.paidCurrency,'TWD');
 }
 assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,1);
});
