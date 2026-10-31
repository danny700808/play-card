'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const {handleCertificateSelfService}=require('../functions/certificateSelfService');
const scope=require('../certificate-workspace');

test('certificate scope separates external, staff and unknown legacy identities',()=>{
  const rows=[{certificateType:'employment',identityType:'external'},{certificateType:'teaching',formData:{teacherIdentity:'專職老師'}},{certificateType:'employment'}];
  assert.deepEqual(rows.map(scope.identityOf),['external','staff','unknown']);
  assert.equal(rows.filter(row=>scope.matches(row,'external','employment')).length,1);
  assert.equal(rows.filter(row=>scope.matches(row,'unknown','all')).length,1);
  assert.equal(rows.filter(row=>scope.matches(row,'all','all')).length,3);
});

function fakeDb(){
  const data=new Map([['printTemplates/teachingCertificate',{title:'已設定範本',privateField:'not exposed'}]]),reads=[],writes=[];
  const db={collection(col){return {get:async()=>({docs:[...data].filter(([key])=>key.startsWith(col+'/')).map(([key,row])=>({id:key.split('/')[1],data:()=>row}))}),doc(id){const key=col+'/'+id;return {key,get:async()=>{reads.push(key);return {exists:data.has(key),data:()=>data.get(key)}}};},where(field,op,id){return {get:async()=>({docs:[...data].filter(([key,row])=>key.startsWith(col+'/')&&row[field]===id).map(([key,row])=>({id:key.split('/')[1],data:()=>row}))})};}};},async runTransaction(fn){return fn({get:ref=>ref.get(),create(ref,row){assert.equal(data.has(ref.key),false);data.set(ref.key,row);writes.push(row);}});}};
  return {db,data,reads,writes};
}
test('personal certificate retries create one pending request under the verified identity',async()=>{
  const {db,writes,data}=fakeDb(),identity={employeeId:'E1',name:'測試老師',external:true};
  const payload={action:'submitCertificateApplication',certificateType:'teaching',submissionKey:'test_submission_123',employeeId:'E2',admin:true,status:'已核准',templateSnapshot:{title:'forged'},formData:{teacherName:'測試老師',idNumber:'TESTONLY',subject:'鋼琴',periodStart:'2026-01-01',stillTeaching:true,status:'approved',employeeId:'E2'}};
  data.set('employees/M1',{role:'admin',name:'主管',lineUserId:'test-only-line'});
  const first=await handleCertificateSelfService(payload,identity,db);
  const again=await handleCertificateSelfService(payload,identity,db);
  assert.equal(first.requestId,again.requestId);assert.equal(writes.length,2);assert.equal(writes[1].source,'certificate-notification');
  assert.equal(writes[0].employeeId,'E1');assert.equal(writes[0].status,'待主管審核');
  assert.equal(writes[0].formData.employeeId,undefined);assert.equal(writes[0].formData.status,undefined);
  assert.equal(writes[0].templateSnapshot.title,'已設定範本');assert.equal(writes[0].templateSnapshot.privateField,undefined);
  assert.equal(writes[0].identityType,'external');
});
test('personal history ignores client admin and other employee IDs',async()=>{
  const {db,data}=fakeDb();data.set('certificateApplications/A',{employeeId:'E1',status:'已核准'});data.set('certificateApplications/B',{employeeId:'E2',status:'待主管審核'});
  const result=await handleCertificateSelfService({action:'getCertificateApplications',admin:true,employeeId:'E2'},{employeeId:'E1'},db);
  assert.deepEqual(result.rows.map(row=>row.requestId),['A']);
  await assert.rejects(()=>handleCertificateSelfService({action:'getCertificateApplications'},{},db),/登入/);
});
test('invalid submission is rejected without writes',async()=>{
  const {db,writes}=fakeDb();await assert.rejects(()=>handleCertificateSelfService({action:'submitCertificateApplication',formData:{}},{employeeId:'E1'},db),/姓名/);assert.equal(writes.length,0);
});
test('teacher work authenticates before serving the fixed gift template',async()=>{
  let reads=0;const db={collection(name){assert.equal(name,'printTemplates');return {doc(id){assert.equal(id,'giftPointCard');return {get:async()=>{reads++;return {exists:true,data:()=>({cardTitle:'共用卡',rules:'既有規則',secret:'omit'})}}};}};}};
  const exports={};const firebase={apps:[{}],firestore:Object.assign(()=>db,{FieldValue:{}})};
  const context={module:{exports:{}},exports:{},require(name){if(name==='firebase-admin')return firebase;if(name==='firebase-functions/v2/https')return {onCall:(_,fn)=>fn,HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}}};if(name==='./certificateSelfService')return {handleCertificateSelfService};return require(name);},Set,Map,Date,Intl,URL};
  vm.runInNewContext(read('functions/externalTeacherWork.js'),context);
  context.module.exports.registerExternalTeacherWork(exports,{requireTeacherSession:async(data)=>{assert.equal(data.sessionToken,'valid');return {teacherId:'T1'};},resolveTeacherEmployee:async()=>({employeeId:'E1',user:{employeeId:'E1'}})});
  await assert.rejects(()=>exports.externalTeacherWork({data:{action:'getGiftPointCardTemplate'}}),/登入/);assert.equal(reads,0);
  const result=await exports.externalTeacherWork({data:{action:'getGiftPointCardTemplate',sessionToken:'valid',documentId:'other'}});
  assert.equal(result.template.cardTitle,'共用卡');assert.equal(result.template.secret,undefined);assert.equal(reads,1);
});
test('gift loader propagates failure and never writes defaults; saves preserve unknown fields',async()=>{
  let writes=0,auth=0;const ref={get:async()=>{throw Error('offline');},set:async(data,options)=>{writes++;assert.equal(data.unknown,undefined);assert.equal(options.merge,true);}};
  const context={window:null,APP_CONFIG:{FIREBASE_CONFIG:{}},firebase:{apps:[{}],firestore:()=>({collection:name=>{assert.equal(name,'printTemplates');return {doc:id=>{assert.equal(id,'giftPointCard');return ref;}};}})},YZManagerAuth:{requireManagerSession:async()=>{auth++;}},setTimeout,clearTimeout,Date};context.window=context;
  vm.runInNewContext(read('gift-card-service.js'),context);
  await assert.rejects(()=>context.GiftCardService.load({id:'manager'},true),/offline/);assert.equal(writes,0);
  await context.GiftCardService.save({id:'manager'},{cardTitle:'新版',unknown:'keep server value'});assert.equal(writes,1);assert.equal(auth,2);
});
test('personal certificate calls initialize Firebase and never fall back to the legacy API',async()=>{
  let initialized=0,legacy=0;
  const context={window:null,APP_CONFIG:{FIREBASE_CONFIG:{}},firebase:{apps:[],initializeApp(){initialized++;this.apps.push({});}},api:async()=>{legacy++;return {};},YZProtectedData:{call:async(name,payload)=>{assert.equal(name,'externalTeacherWork');throw Error('permission-denied');}}};context.window=context;
  vm.runInNewContext(read('certificate-self-service.js'),context);
  await assert.rejects(()=>context.api('getCertificateApplications'),/permission-denied/);
  assert.equal(initialized,1);assert.equal(legacy,0);
  await context.api('unrelatedAction');assert.equal(legacy,1);
});
test('contract reads wait for authentication and report denied sources',async()=>{
  const page=read('external-teacher-admin.html');
  const start=page.indexOf('async function readExternalTeacherCollection('),end=page.indexOf('async function readExternalTeacherRows(',start);
  const context={db:()=>({collection:()=>({limit:()=>({get:async()=>{throw Error('denied');}})})}),console:{warn(){}}};
  vm.runInNewContext(page.slice(start,end),context);
  await assert.rejects(()=>context.readExternalTeacherCollection('externalTeacherContracts',100),/denied/);
  assert.match(page,/setLoading\(true\);await waitForManagerAuth\(\);const year=/);
});
test('certificate administration waits for manager identity and propagates read failures',async()=>{
  const steps=[];const user={id:'manager'};
  const context={window:null,getUser:()=>user,api:async()=>{throw Error('legacy fallback forbidden');},YZManagerAuth:{requireManagerSession:async options=>{assert.equal(options.expectedManager,user);steps.push('auth');}},YZFirebase:{handleApi:async()=>{steps.push('read');throw Error('offline');}}};context.window=context;
  vm.runInNewContext(read('certificate-admin-session.js'),context);
  await assert.rejects(()=>context.api('getCertificateTemplate',{}),/offline/);assert.deepEqual(steps,['auth','read']);
});
test('modified inline scripts parse and new workspace links resolve locally',()=>{
  const pages=['quotation-contract-hub.html','form-settings-hub.html','external-teacher-forms-admin.html','gift-point-card.html','gift-point-card-admin.html','employment-certificate.html','teaching-certificate.html','certificate-review-admin.html','certificate-history-admin.html','my-certificates.html','teacher-hub.html','forms-hub.html','employment-certificate-admin.html','teaching-certificate-admin.html','employment-certificate-admin-issue.html','teaching-certificate-admin-issue.html'];
  for(const file of pages){const html=read(file);for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))if(match[1].trim())new vm.Script(match[1],{filename:file});for(const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)){const url=match[1].split(/[?#]/)[0];if(!/^(https?:|data:|javascript:)/.test(url)&&!/[{}]/.test(url))assert.ok(fs.existsSync(path.join(root,url)),file+' → '+url);}}
  assert.match(read('my-certificates.html'),/currentApp\?\.status==='已核准'/);
  assert.match(read('gift-point-card-admin.html'),/if\(!giftLoaded\|\|giftSaving\)return/);
});
