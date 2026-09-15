const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('rental-contract-admin.html','utf8');
const code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const nodes=new Map();function el(){return {value:'',textContent:'',style:{},classList:{add(){},remove(){}},setAttribute(){}}}
const document={querySelector(s){if(!nodes.has(s))nodes.set(s,el());return nodes.get(s)},getElementById(id){return nodes.get('#'+id)},createElement(){return el()},body:{appendChild(e){nodes.set('#'+e.id,e)}},fonts:{ready:Promise.resolve()}};
let saves=0,writes=0,closed=0,aborted=0,apiCalls=0,prints=0;
const c={document,console,setInterval(){return 1},clearInterval(){},setTimeout(fn){fn()},window:null};c.window=c;c.print=()=>prints++;vm.createContext(c);vm.runInContext(code,c);
c.buildFileName=()=> 'contract.pdf';c.renderPreview=()=>{};c.buildPdfBlob=async()=>({pdf:{save:async()=>saves++},blob:'pdf'});c.api=async()=>{apiCalls++;throw Error('server unavailable')};
const message=()=>nodes.get('#contractActionStatus')?.textContent;
(async()=>{
await c.savePdf();assert.equal(saves,1);assert.equal(apiCalls,0);assert.match(message(),/下載/);
c.showSaveFilePicker=async options=>{assert.equal(options.startIn,'desktop');return {name:'contract.pdf',createWritable:async()=>({write:async()=>writes++,close:async()=>closed++,abort:async()=>aborted++})}};
await c.savePdf();assert.equal(writes,1);assert.equal(closed,1);assert.match(message(),/已儲存/);
c.showSaveFilePicker=async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'})};await c.savePdf();assert.match(message(),/取消/);assert.equal(writes,1);
c.showSaveFilePicker=async()=>{throw Object.assign(Error('blocked'),{name:'SecurityError'})};await c.savePdf();assert.equal(saves,2);
delete c.showSaveFilePicker;c.buildPdfBlob=async()=>{throw Error('render failed')};await c.savePdf();assert.match(message(),/render failed/);assert.equal(nodes.get('#saveContractPdfBtn').disabled,false);
await c.printContract();assert.equal(prints,1);assert.equal(apiCalls,0);
await c.sendContractEmail();assert.match(message(),/有效的收件人/);assert.equal(apiCalls,0);
vm.runInContext('currentUser = {id:"test"}',c);await c.saveCurrentContract();assert.match(message(),/server unavailable/);
assert.doesNotThrow(()=>c.startButtonProgress({timeRemaining(){return 1}},'load'));
console.log('PASS: download, desktop picker, cancellation, fallback, failure feedback, print, email validation, save failure, idle callback guard');
})();
