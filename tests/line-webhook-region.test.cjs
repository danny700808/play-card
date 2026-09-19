'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const {database}=require('./helpers/security-fixtures.cjs');
const {createLineWebhookEvents}=require('../functions/lineWebhookEvents');
const event={webhookEventId:'01H810YECXQQZ37VAXPF6H9E6T',type:'message',message:{type:'text',text:'private fixture'},source:{userId:'fixture-user'},replyToken:'fixture-token'};
function processor(f,options={}){return createLineWebhookEvents({...f,channelId:'2006335686',region:'asia-east1',log(){},...options});}
test('concurrent US/Taiwan copies and later redelivery run one business handler',async()=>{
 const f=database(),us=processor(f,{region:'us-central1'}),tw=processor(f);let count=0;
 await Promise.all([us.run(event,async()=>{count++;}),tw.run({...event,deliveryContext:{isRedelivery:true}},async()=>{count++;})]);
 await tw.run(event,async()=>{count++;});assert.equal(count,1);assert.equal(f.rows.size,1);assert.equal([...f.rows.values()][0].status,'completed');
 assert(!JSON.stringify([...f.rows]).includes('fixture-token'));assert(!JSON.stringify([...f.rows]).includes('private fixture'));assert(!JSON.stringify([...f.rows]).includes('fixture-user'));
});
test('ambiguous business failure remains reviewable and cannot be automatically replayed',async()=>{
 const f=database(),p=processor(f);let effects=0;
 await assert.rejects(p.run(event,async()=>{effects++;throw Error('response lost');}));
 assert.equal([...f.rows.values()][0].status,'needs-review');await p.run(event,async()=>{effects++;});assert.equal(effects,1);
});
test('database claim failure prevents business effects',async()=>{
 const f=database();f.db.runTransaction=async()=>{throw Error('unavailable');};let count=0;
 await assert.rejects(processor(f).run(event,async()=>{count++;}));assert.equal(count,0);
});
test('stale in-flight claim is reported for review instead of reclaimed',async()=>{
 const f=database();let finish;const gate=new Promise(resolve=>{finish=resolve;});let count=0;
 const a=processor(f,{now:()=>0}).run(event,async()=>{count++;await gate;});
 await new Promise(resolve=>setImmediate(resolve));const logs=[];
 await processor(f,{now:()=>180000,log:(...args)=>logs.push(args)}).run(event,async()=>{count++;});
 assert.equal(count,1);assert.equal(logs.length,1);finish();await a;
});
test('distinct event IDs and channels do not suppress legitimate new events',async()=>{
 const f=database();let count=0;const handle=async()=>{count++;};
 await processor(f).run(event,handle);await processor(f).run({...event,webhookEventId:'second-event'},handle);await processor(f,{channelId:'another-channel'}).run(event,handle);assert.equal(count,3);
});
test('missing event identifier cannot reach a business handler',async()=>{
 const f=database();let count=0;await assert.rejects(processor(f).run({...event,webhookEventId:''},async()=>{count++;}));assert.equal(count,0);assert.equal(f.rows.size,0);
});
const source=fs.readFileSync('functions/index.js','utf8');
test('signature verification authenticates raw bytes and rejects missing, forged or altered bodies',()=>{
 const start=source.indexOf('function validLineWebhookSignature'),end=source.indexOf('const lineWebhookEvents',start);
 const c={normalizeText:v=>String(v||'').trim(),LINE_CHANNEL_SECRET:{value:()=> 'fixture-secret'},process:{env:{}},crypto,Buffer};vm.runInNewContext(source.slice(start,end),c);
 const rawBody=Buffer.from('{"events":[]}'),signature=crypto.createHmac('sha256','fixture-secret').update(rawBody).digest('base64');
 const req={rawBody,headers:{'x-line-signature':signature}};assert(c.validLineWebhookSignature(req));assert(!c.validLineWebhookSignature({...req,rawBody:Buffer.from('{ "events":[] }')}));assert(!c.validLineWebhookSignature({...req,headers:{}}));assert(!c.validLineWebhookSignature({...req,headers:{'x-line-signature':'forged'}}));
});
test('actual HTTP handler rejects signatures before processing and keeps later batch events after one failure',async()=>{
 const start=source.indexOf('exports.lineWebhook = onRequest('),end=source.indexOf('\n\nexports.sendGmailTestEmail',start);
 const handled=[],c={exports:{},onRequest:(_,fn)=>fn,LINE_CHANNEL_SECRET:{},validLineWebhookSignature:req=>req.valid===true,lineWebhookEvents:{run:async(e,fn)=>{if(e.webhookEventId==='bad')throw Error('failure');return fn();}},handleLineWebhookMessage:async e=>handled.push(e.webhookEventId),console:{error(){}}};vm.runInNewContext(source.slice(start,end),c);
 const response=()=>({status(n){this.code=n;return this;},send(text){this.text=text;}});
 let res=response();await c.exports.lineWebhook({method:'POST',valid:false,body:{events:[event]}},res);assert.equal(res.code,401);assert.equal(handled.length,0);
 res=response();await c.exports.lineWebhook({method:'POST',valid:true,body:{events:[]}},res);assert.equal(res.code,200);
 res=response();await c.exports.lineWebhook({method:'POST',valid:true,body:{events:[{...event,webhookEventId:'bad'},event]}},res);assert.equal(res.code,500);assert.deepEqual(handled,[event.webhookEventId]);
});
