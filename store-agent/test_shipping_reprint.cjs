const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../shipping-local-print.js','utf8');
const model=require('./shipping-ui/model.js'), tick=()=>new Promise(setImmediate);
function harness({channel='MOMO',history='prepared',handlingAction='',delay=false,printFailure=false}={}){
  const elements=new Map(), calls=[];let records=0,confirmations=0,release,printed=false;
  const wait=new Promise(r=>release=r);
  class Element{
    constructor(){this.children=[];this.open=true;}
    set id(v){this._id=v;elements.set(v,this);} get id(){return this._id;}
    append(...v){this.children.push(...v);} prepend(v){this.children.unshift(v);}
    remove(){elements.delete(this.id);} setAttribute(){}
  }
  for(const id of ['localPrintSlot','documentDialog','printerHint']){const e=new Element();e.id=id;}
  const window={ShippingModel:model,confirm(){confirmations++;throw Error('Unexpected confirmation');}};
  const ctx={window,document:{getElementById:id=>elements.get(id),createElement:()=>new Element()},AbortSignal,Blob,Promise,Error,
    FileReader:class{readAsDataURL(){this.result='data:application/pdf;base64,JVBERi0xLjQ=';this.onload();}},
    fetch:async(url,options={})=>{
      const body=options.body&&JSON.parse(options.body);calls.push({url,body});
      const ok=value=>({ok:true,json:async()=>value});
      if(url==='/original.pdf'){if(delay)await wait;return {ok:true,blob:async()=>new Blob(['%PDF-1.4 test'])};}
      if(url.endsWith('/health'))return ok({service:'youzi-shipping-print'});
      if(url.endsWith('/prepare'))return ok({jobId:'a'.repeat(32),pages:channel==='MOMO'?2:1,status:body.reprint?'prepared':printed?'submitted':history});
      if(url.endsWith('/print')){if(printFailure)throw Error('connection lost');printed=true;return ok({status:'submitted'});}
      throw Error(url);
    }};
  vm.runInNewContext(source,ctx);
  window.YouziLocalPrint.attach({channel,handlingAction,orderNo:'TEST1234567890',documentReady:true},{print:'/original.pdf'},async()=>records++);
  const box=elements.get('localPrintControls');
  return {window,elements,calls,release,button:box.children[0],status:box.children[1],records:()=>records,confirmations:()=>confirmations,
    prints:()=>calls.filter(c=>c.url.endsWith('/print'))};
}
for(const channel of ['MOMO','酷澎','蝦皮','官網'])test(channel+' new print prepares silently then submits exactly once',async()=>{
 const h=harness({channel});await tick();assert.equal(h.prints().length,0);assert.equal(h.button.textContent,'列印貨運單');
 await h.button.onclick();assert.equal(h.prints().length,1);assert.equal(h.records(),1);assert.equal(h.confirmations(),0);
});
test('known reprint remains reprint throughout and one click submits without confirm',async()=>{
 const h=harness({handlingAction:'printed',history:'submitted'});assert.equal(h.button.textContent,'重印貨運單');await tick();
 assert.equal(h.button.textContent,'重印貨運單');await h.button.onclick();assert.equal(h.prints().length,1);assert.equal(h.confirmations(),0);
 assert.equal(h.calls.filter(c=>c.url.endsWith('/prepare')).at(-1).body.reprint,true);
});
test('local history detects a reprint before first click, even when host history is absent',async()=>{
 const h=harness({history:'submitted'});await tick();assert.equal(h.button.textContent,'重印貨運單');assert.equal(h.prints().length,0);
 await h.button.onclick();assert.equal(h.prints().length,1);
});
test('overlapping clicks submit only once',async()=>{
 const h=harness({delay:true});const first=h.button.onclick();await h.button.onclick();h.release();await first;assert.equal(h.prints().length,1);
});
test('closing or replacing dialog during preparation does not print',async()=>{
 const h=harness({delay:true});const first=h.button.onclick();h.window.YouziLocalPrint.reset();h.release();await first;assert.equal(h.prints().length,0);
});
test('unknown previous result does not automatically clone or print',async()=>{
 const h=harness({history:'uncertain',handlingAction:'printed'});await tick();await h.button.onclick();
 assert.equal(h.prints().length,0);assert(!h.calls.some(c=>c.body?.reprint));assert.match(h.status.textContent,/結果不明/);
});
test('lost print response is not retried or recorded as success',async()=>{
 const h=harness({printFailure:true});await tick();await h.button.onclick();await tick();
 assert.equal(h.prints().length,1);assert.equal(h.records(),0);assert.match(h.status.textContent,/尚未確認/);
});

