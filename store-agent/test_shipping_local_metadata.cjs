const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(capable=true){
 let handler,id=0;const sent=[];const window={addEventListener(type,fn){handler=fn;},postMessage(m){sent.push(m);queueMicrotask(()=>handler({source:window,origin:'https://danny700808.github.io',data:{namespace:'youzi-shipping-helper',version:1,direction:'helper',requestId:m.requestId,...(m.type==='probe'?{type:'ready',capabilities:{readMetadata:capable}}:{type:'metadata',results:[],error:'missing',verifiedAt:'2026-11-19T12:00:00+08:00'})}}));}};
 const ctx=vm.createContext({window,location:{origin:'https://danny700808.github.io'},crypto:{randomUUID:()=>String(++id)},setTimeout:()=>1,clearTimeout(){}});
 vm.runInContext(fs.readFileSync(__dirname+'/../shipping-local-metadata.js','utf8'),ctx);return {sent,read:window.YouziLocalMetadata.read};
}
test('metadata handshake sends only a read request to the same helper, never a document or shipment request',async()=>{
 const h=harness();const order={key:'EasyStore:123',externalId:'123',orderNo:'TEST1234567890'};
 const result=await h.read([order]);assert.equal(result.error,'missing');
 assert.deepEqual(h.sent.map(x=>x.type),['probe','get-metadata']);assert.deepEqual(h.sent[1].orders,[order]);
});
test('old helper receives an update message, no unsupported lookup',async()=>{
 const h=harness(false);await assert.rejects(h.read([]),/1.2.8/);assert.deepEqual(h.sent.map(x=>x.type),['probe']);
});
