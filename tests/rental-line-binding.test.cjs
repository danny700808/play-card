'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {database}=require('./helpers/security-fixtures.cjs');
const {bindingPatch,withoutBinding,createRentalLineBinding}=require('../functions/rentalLineBinding');
const id='U'+'1'.repeat(32),other='U'+'2'.repeat(32);
const bound={customerLineUserId:id,lineUserId:id,lineDisplayName:'Test customer',lineLinkStatus:'linked'};
test('stale blank editor cannot clear an existing binding',()=>{
  assert.equal(bindingPatch(bound,null,{customerLineUserId:''}).customerLineUserId,id);
  assert.deepEqual(withoutBinding({customerLineUserId:'',lineUserId:other,rentFee:2900}),{rentFee:2900});
});
test('application is authoritative over incoming editor data',()=>{
  assert.equal(bindingPatch({},bound,{customerLineUserId:other}).customerLineUserId,id);
  assert.deepEqual(bindingPatch({}, {}, {customerLineUserId:other}),{});
});
test('conflicting persisted recipients fail closed',()=>{
  assert.throws(()=>bindingPatch({customerLineUserId:other},bound),/不一致/);
});
test('explicit revocation is never resurrected from stale data',()=>{
  for(const revoked of [{globalLineRevokedAt:'now'},{lineLinkStatus:'unlinked'},{lineNotifyEnabled:false}]){
    assert.equal(bindingPatch({...bound,...revoked},bound).customerLineUserId,'');
    assert.equal(bindingPatch(bound,{...bound,...revoked}).customerLineUserId,'');
  }
});
test('invalid primary alias can fall back to valid legacy alias',()=>{
  assert.equal(bindingPatch({}, {customerLineUserId:'invalid',lineUserId:id}).customerLineUserId,id);
});
test('late binding repairs all contracts of only the exact application, idempotently',async()=>{
  const f=database({'rentalApplications/a':bound,'rentalContracts/c':{applicationId:'a',customerLineUserId:'',rentFee:2900,signToken:'keep'},'rentalContracts/c2':{applicationId:'a'},'rentalContracts/unrelated':{applicationId:'b',customerName:'Same name'}});
  const service=createRentalLineBinding(f.db);await service.syncApplication('a');await service.syncApplication('a');
  assert.equal(f.rows.get('rentalContracts/c').customerLineUserId,id);assert.equal(f.rows.get('rentalContracts/c2').customerLineUserId,id);
  assert.equal(f.rows.get('rentalContracts/c').signToken,'keep');assert.equal(f.rows.get('rentalContracts/c').rentFee,2900);
  assert.equal(f.rows.get('rentalContracts/unrelated').customerLineUserId,undefined);
});
test('send-time repair reloads current application instead of trusting stale contract',async()=>{
  const f=database({'rentalApplications/a':bound,'rentalContracts/c':{applicationId:'a'}});
  assert.equal((await createRentalLineBinding(f.db).repair('c')).customerLineUserId,id);
});
test('missing source and reassigned application are blocked without mutations',async()=>{
  const f=database({'rentalContracts/c':{applicationId:'missing'}}),service=createRentalLineBinding(f.db);
  await assert.rejects(service.repair('c'),/找不到原租賃申請/);
  await assert.rejects(f.db.runTransaction(tx=>service.applicationFor(tx,{applicationId:'a'},{applicationId:'b'})),/另一筆/);
  assert.equal(f.rows.get('rentalContracts/c').customerLineUserId,undefined);
});
function saveHandler(f){
  const source=fs.readFileSync(require.resolve('../functions/index.js'),'utf8');
  const start=source.indexOf('exports.rentalSaveContractHttp ='),end=source.indexOf('exports.rentalSendSignLinkHttp =',start);
  const context={exports:{},db:f.db,managerHttpEndpoint:fn=>fn,clean:v=>String(v||'').trim(),randomId:()=> 'c',randomToken:()=> 'token',stripRentalInlineAssets:x=>x,stripUndefined:x=>x,withoutRentalBinding:withoutBinding,rentalBindingPatch:bindingPatch,createRentalLineBinding,nowText:()=> 'now',admin:{firestore:{FieldValue:f.FieldValue}},buildSignUrl:()=> 'sign-url',buildOfficialContractUrl:()=> 'official-url'};
  vm.runInNewContext(source.slice(start,end),context);return context.exports.rentalSaveContractHttp;
}
test('actual save handler reads latest binding and atomically links contract and application',async()=>{
  const f=database({'rentalApplications/a':bound}),save=saveHandler(f);
  await save({applicationId:'a',customerLineUserId:'',makeSignLink:true,rentFee:2900});
  assert.equal(f.rows.get('rentalContracts/c').customerLineUserId,id);
  assert.equal(f.rows.get('rentalApplications/a').linkedContractId,'c');
  await save({contractId:'c',applicationId:'',customerLineUserId:'',rentFee:3100});
  assert.equal(f.rows.get('rentalContracts/c').applicationId,'a');
  assert.equal(f.rows.get('rentalContracts/c').customerLineUserId,id);assert.equal(f.rows.get('rentalContracts/c').rentFee,3100);
});
test('actual save handler preserves binding on repeated stale saves after late pairing',async()=>{
  const f=database({'rentalApplications/a':{}}),save=saveHandler(f);await save({applicationId:'a',customerLineUserId:''});
  f.rows.set('rentalApplications/a',{...f.rows.get('rentalApplications/a'),...bound});
  await createRentalLineBinding(f.db).syncApplication('a');
  await save({contractId:'c',applicationId:'a',customerLineUserId:''});assert.equal(f.rows.get('rentalContracts/c').customerLineUserId,id);
});
test('email fallback alone is not reported as successful LINE delivery',()=>{
  const html=fs.readFileSync(require.resolve('../rental-admin.html'),'utf8');
  const fn=html.split('\n').find(l=>l.includes('function notificationDeliveryAssessment('));
  const ctx={notifyPref:c=>c.pref,wantsNotifyLine:c=>c.pref!=='email',wantsNotifyEmail:c=>c.pref!=='line',notificationHasSendReport:()=>true,channelSendResult:()=>null,notificationResultText:()=>''};
  vm.runInNewContext(fn,ctx);
  assert.equal(ctx.notificationDeliveryAssessment({emailSent:true,lineSent:false},{pref:'both'}).ok,false);
  assert.equal(ctx.notificationDeliveryAssessment({emailSent:false,lineSent:true},{pref:'both'}).ok,true);
  assert.equal(ctx.notificationDeliveryAssessment({emailSent:true},{pref:'email'}).ok,true);
});
test('all admin inline scripts remain valid JavaScript',()=>{
  const html=fs.readFileSync(require.resolve('../rental-admin.html'),'utf8');
  for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())new vm.Script(m[1]);
});
test('signing, payment, renewal, return and expiry queues keep the repaired LINE recipient',async()=>{
  const source=fs.readFileSync(require.resolve('../functions/index.js'),'utf8');
  const start=source.indexOf('async function createCustomerNotificationQueues('),end=source.indexOf('function lineImageUrlFromQueue',start);
  const queued=[],ctx={clean:v=>String(v||'').trim(),customerEmailOf:r=>r.customerEmail,normalizeNotificationPreference:v=>v,queueTargetLineUserId:r=>r.customerLineUserId||r.lineUserId,isValidCustomerLineUserId:v=>/^U.{32}$/.test(v),wantsLineByPreference:p=>p!=='email',wantsEmailByPreference:p=>p!=='line',safeId:v=>v,stripUndefined:x=>x,isCustomerEmailVerified:()=>true,createNotificationQueue:async row=>queued.push(row)};
  vm.runInNewContext(source.slice(start,end),ctx);
  for(const stage of ['rental-sign-link','rental-formal-received','rental-renewal-customer-ack','rental-return-customer-ack','rental-expiry-reminder','rental-return-completed']){
    queued.length=0;
    const result=await ctx.createCustomerNotificationQueues({row:{...bound,customerEmail:'test@example.test',notificationPreference:'both'},source:stage,contractId:'c',title:'test',body:'test'});
    assert.equal(result.line,true);assert.equal(queued.length,1);assert.equal(queued[0].targetLineUserId,id);assert.equal(queued[0].channel,'line');
  }
});
test('official contract and admin renewal notices keep the repaired LINE recipient',async()=>{
  const html=fs.readFileSync(require.resolve('../rental-admin.html'),'utf8'),start=html.indexOf('    async function queueCustomerNotice('),end=html.indexOf('    function channelSendResult',start);
  const queued=[],ctx={R:{clean:v=>String(v||'').trim(),wantsLine:p=>p!=='email',wantsEmail:p=>p!=='line',emailVerified:()=>true,nowText:()=> 'now',db:()=>({collection:()=>({doc:()=>({set:async row=>queued.push(row)})})})},notifyPref:r=>r.notificationPreference,isValidCustomerLineId:v=>/^U.{32}$/.test(v),firebase:{firestore:{FieldValue:{serverTimestamp:()=> 'now'}}}};
  vm.runInNewContext(html.slice(start,end),ctx);
  for(const stage of ['rental-official-contract','rental-renewal-return-link','rental-renewal-confirmed']){
    queued.length=0;await ctx.queueCustomerNotice({...bound,contractId:'c',notificationPreference:'both',customerEmail:'test@example.test'},{source:stage,body:'test'});
    assert.equal(queued.filter(q=>q.channel==='line').length,1);assert.equal(queued.find(q=>q.channel==='line').targetLineUserId,id);
  }
});
