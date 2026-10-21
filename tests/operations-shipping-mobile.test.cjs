const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function mount(navigator){
  const elements={},listeners={};
  const document={getElementById(id){return elements[id]??=(id==='opsShippingFrame'?{contentWindow:{}}:{});}};
  const window={navigator,addEventListener(type,fn){listeners[type]=fn;}};
  vm.runInNewContext(fs.readFileSync('operations-shipping.js','utf8'),{window,document,setTimeout:()=>1,clearTimeout(){}});
  const content={contains:f=>f===elements.opsShippingFrame};
  window.YouziShipping.mount(content);
  return {elements,window,content,listeners};
}
for(const navigator of [
  {userAgent:'iPhone',platform:'iPhone'},
  {userAgent:'Android',platform:'Linux'},
  {userAgent:'Safari Macintosh',platform:'MacIntel',maxTouchPoints:5}
])test('mobile/tablet mounts remote workbench inside portal: '+navigator.userAgent,()=>{
  const {elements,window,content,listeners}=mount(navigator);
  const frame=elements.opsShippingFrame,status=elements.opsShippingStatus;
  assert.equal(frame.src,'shipping-desk.html?embedded=1');
  assert.equal(status.hidden,false);
  listeners.message({source:frame.contentWindow,origin:'http://127.0.0.1:18765',data:{type:'youzi-shipping-ready'}});
  assert.equal(status.hidden,false);
  frame.onload();assert.equal(status.hidden,true);
  frame.src='preserve-open-order';window.YouziShipping.mount(content);
  assert.equal(frame.src,'preserve-open-order');
  elements.opsShippingReconnect.onclick();assert.equal(frame.src,'shipping-desk.html?embedded=1');
});
test('desktop preserves local connection and supports embedded remote fallback',()=>{
  const {elements,listeners}=mount({userAgent:'Windows',platform:'Win32',maxTouchPoints:0});
  const frame=elements.opsShippingFrame,status=elements.opsShippingStatus;
  assert.equal(frame.src,'http://127.0.0.1:18765/?embedded=1');
  listeners.message({source:frame.contentWindow,origin:'https://untrusted.example',data:{type:'youzi-shipping-ready'}});
  assert.equal(status.hidden,false);
  listeners.message({source:frame.contentWindow,origin:'http://127.0.0.1:18765',data:{type:'youzi-shipping-ready'}});
  assert.equal(status.hidden,true);
  elements.opsShippingRemote.onclick();assert.equal(frame.src,'shipping-desk.html?embedded=1');
});
