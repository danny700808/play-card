const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function harness({carrier='7-11店到店',prepareStatus='prepared',prepareError='',printError='',documentOk=true}={}){
  const elements=new Map(),calls=[];
  function el(){return {style:{},children:[],open:true,disabled:false,textContent:'',setAttribute(){},
    append(...nodes){this.children.push(...nodes);},prepend(node){this.children.unshift(node);elements.set(node.id,node);},
    remove(){elements.delete(this.id);}};}
  for(const id of ['documentControls','documentDialog','printerHint'])elements.set(id,el());
  let printed=0;
  const window={confirm:()=>true};
  const context=vm.createContext({window,document:{getElementById:id=>elements.get(id),createElement:el},
    AbortSignal,FileReader:class{readAsDataURL(){this.result='data:application/pdf;base64,JVBERi0=';this.onload();}},
    fetch:async(url,options)=>{
      const body=options.body?JSON.parse(options.body):undefined;
      calls.push({url,body});
      if(url==='https://example.test/label.pdf')return {ok:documentOk,blob:async()=>new Blob(['%PDF-1.7\nlabel'])};
      if(url.endsWith('/health'))return {ok:true,json:async()=>({service:'youzi-shipping-print'})};
      if(url.endsWith('/prepare'))return {ok:!prepareError,json:async()=>prepareError?{error:prepareError}:{jobId:'job-1',status:prepareStatus,pages:1}};
      if(url.endsWith('/print'))return {ok:!printError,json:async()=>printError?{error:printError}:{status:'submitted'}};
      throw Error('Unexpected endpoint');
    }});
  vm.runInContext(fs.readFileSync(__dirname+'/../shipping-local-print.js','utf8'),context);
  window.YouziLocalPrint.attach({channel:'MOMO',orderNo:'TEST-ORDER',carrier},
    {print:'https://example.test/label.pdf'},async()=>{printed++;});
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

test('a submitted document is not silently printed again; explicit reprint uses the reprint flag',async()=>{
  const h=harness({prepareStatus:'submitted'});
  await h.button.onclick();
  assert.equal(h.button.textContent,'重印貨運單');
  assert.equal(h.calls.filter(c=>c.url.endsWith('/print')).length,0);
  assert.equal(h.printed(),0);
  await h.button.onclick();
  assert.equal(h.calls.filter(c=>c.url.endsWith('/prepare'))[1].body.reprint,true);
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
  assert.match(h.status.textContent,/讀取原貨運單：原單連結已失效/);
  assert.equal(h.calls.filter(c=>c.body).length,0);
  assert.equal(h.printed(),0);
});
