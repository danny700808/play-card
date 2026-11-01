'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./helpers/security-fixtures.cjs');
const policy=require('../functions/rentalContractIdentity');
function fixture(row){const f=database();let now=100000000;const api=policy.createRentalContractIdentity({db:f.db,now:()=>now,authorize:async(id,token)=>{if(id!=='c1'||token!=='secret')throw Error('invalid token');return {contract:{__id:id,...row}};}});return {...f,read:(data={},ip='test-ip')=>api.read({contractId:'c1',token:'secret',...data},{ip}),advance:()=>now+=16*60*1000};}
const contract={status:'租賃中',customerIdNumber:'A123456789',customerName:'Test customer',customerSubmittedFormalAt:'2026-01-01',customerSignatureDataUrl:'private signature'};
test('a valid link alone returns only an identity challenge, never private fields',async()=>{
 const f=fixture(contract),r=await f.read();assert.deepEqual(r,{requiresIdentity:true});assert(!JSON.stringify(r).includes('private'));await assert.rejects(f.read({token:'wrong'}),/invalid token/);
});
test('correct lowercase initial unlocks existing contract; wrong identity cannot change it',async()=>{
 const f=fixture(contract);await assert.rejects(f.read({identityNumber:'A000000000'}),/不符/);
 assert.equal((await f.read({identityNumber:' a123456789 '})).contract.customerName,'Test customer');
 assert.throws(()=>policy.assertUnchangedIdentity(contract,'B123456789'),/不符/);policy.assertUnchangedIdentity(contract,'a123456789');
});
test('passport, residence permit and company identifiers use saved value without Taiwan-only format restriction',async()=>{
 for(const value of ['P-345678','AB12345678','12345678']){const f=fixture({...contract,customerIdNumber:value});assert((await f.read({identityNumber:value[0].toLowerCase()+value.slice(1)})).contract);}
 assert.equal(policy.identityFor({customerIdNumber:'',customerTaxId:'12345678'}),'12345678');
});
test('paper and completed contracts with no recorded identity fail closed',async()=>{
 for(const status of ['租賃中','到期提醒中','已退租','待客人補資料']){const f=fixture({status,paperSignedConfirmedAt:'date'});const r=await f.read({identityNumber:'anything'});assert(r.identityUnavailable);assert(!r.contract);}
});
test('new unsigned customer can fill identity, but formal token or signed data cannot bypass gate',async()=>{
 const row={status:'待客人補資料',signToken:'secret'};assert((await fixture(row).read()).contract);
 assert((await fixture({...row,signToken:'different',officialContractToken:'secret'}).read()).identityUnavailable);
 assert((await fixture({...row,customerSignedAt:'date'}).read()).identityUnavailable);
});
test('failed attempts are stored without identity values and blocked until timeout',async()=>{
 const f=fixture(contract);for(let i=0;i<6;i++)await assert.rejects(f.read({identityNumber:'WRONG'}),/不符/);
 await assert.rejects(f.read({identityNumber:'a123456789'}),/15 分鐘/);
 assert(!JSON.stringify([...f.rows]).includes('WRONG'));assert(!JSON.stringify([...f.rows]).includes('A123456789'));
 f.advance();assert((await f.read({identityNumber:'a123456789'})).contract);
});
test('client coalesces reads, shows explanation, uppercases first letter and stores identity only in memory',async()=>{
 const {JSDOM}=require('jsdom');const dom=new JSDOM('<body><div id="contractPreview"></div></body>',{url:'https://example.test/rental-contract.html?contractId=c1&token=secret',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const calls=[];w.fetch=async(url,opts)=>{const payload=JSON.parse(opts.body);calls.push(payload);const body=payload.identityNumber==='A123456789'?{ok:true,contract}:{ok:true,requiresIdentity:true};return {ok:true,text:async()=>JSON.stringify(body)};};
 w.eval(fs.readFileSync(require('node:path').join(__dirname,'../rental-common.js'),'utf8'));
 const a=w.YZRental.get('rentalContracts','c1'),b=w.YZRental.get('rentalContracts','c1');await new Promise(r=>setImmediate(r));
 assert.equal(calls.length,1);assert.equal(w.document.querySelectorAll('dialog').length,1);assert.match(w.document.querySelector('dialog').textContent,/護照號碼或居留證號碼/);
 assert.equal(w.document.querySelector('#contractPreview').textContent,'');const input=w.document.querySelector('input');assert.equal(input.type,'password');
 input.value='a123456789';input.dispatchEvent(new w.Event('input'));assert.equal(input.value,'A123456789');
 w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal((await a).customerName,'Test customer');await b;
 assert.equal(w.document.querySelectorAll('dialog').length,0);assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);assert(!w.location.href.includes('A123456789'));dom.window.close();
});
