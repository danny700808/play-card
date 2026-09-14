'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,getDocs,collection,updateDoc,runTransaction}=require('firebase/firestore');
const {ref,uploadBytes,getBytes}=require('firebase/storage');
let env,staff,other,manager,guest;
const own={employee:true,employeeId:'e1',manager:false,email:'staff@example.test'};
before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-youzi-security',firestore:{rules:fs.readFileSync('firestore.rules','utf8')},storage:{rules:fs.readFileSync('storage.rules','utf8')}});
  staff=env.authenticatedContext('staff',own);other=env.authenticatedContext('other',{...own,employeeId:'e2'});manager=env.authenticatedContext('manager',{...own,manager:true});guest=env.unauthenticatedContext();
  await env.withSecurityRulesDisabled(async context=>{
    for(const [path,data] of [['employees/e1',{employeeId:'e1',role:'staff'}],['employees/e2',{employeeId:'e2',role:'admin'}],['employeeSalaryConfigs/e1',{employeeId:'e1',salary:32000}],['employeeSalaryConfigs/e2',{employeeId:'e2',salary:40000}],['admins/a1',{role:'admin'}],['rentalContracts/c1',{signToken:'secret'}],['externalTeacherProfiles/t1',{bindingCode:'secret'}]])await setDoc(doc(context.firestore(),path),data);
    await uploadBytes(ref(context.storage(),'rental-contracts/c1/id.jpg'),new Uint8Array([1,2,3]),{contentType:'image/jpeg'});
  });
});
after(async()=>{if(env)await env.cleanup();});
test('all former open collections reject anonymous reads and writes',async()=>{
  const source=fs.readFileSync('firestore.rules','utf8'),part=source.slice(source.indexOf('function isLegacyClientCollection'),source.indexOf('// 交接資料'));
  const collections=[...part.matchAll(/'([A-Za-z][A-Za-z0-9]+)'/g)].map(match=>match[1]);assert(collections.length>=90);
  for(const name of collections){if(name!=='rentalTemplateSettings')await assertFails(getDoc(doc(guest.firestore(),name,'test')));await assertFails(setDoc(doc(guest.firestore(),name,'test'),{role:'admin'}));}
});
test('employees read their own payroll, not coworkers or administrator records',async()=>{
  await assertSucceeds(getDoc(doc(staff.firestore(),'employeeSalaryConfigs/e1')));
  await assertFails(getDoc(doc(other.firestore(),'employeeSalaryConfigs/e1')));
  await assertFails(getDocs(collection(staff.firestore(),'employeeSalaryConfigs')));
  await assertFails(getDoc(doc(staff.firestore(),'admins/a1')));
  await assertSucceeds(getDocs(collection(manager.firestore(),'employeeSalaryConfigs')));
});
test('staff cannot promote themselves or create active employee accounts',async()=>{
  await assertFails(updateDoc(doc(staff.firestore(),'employees/e1'),{role:'admin',showSettingsZone:true}));
  await assertFails(setDoc(doc(staff.firestore(),'employees/new'),{employeeId:'new',role:'admin',accountStatus:'active'}));
  const emailOnly=env.authenticatedContext('email-only',{email:'danny700808@gmail.com'});
  await assertFails(getDoc(doc(emailOnly.firestore(),'admins/a1')));
});
test('normal self-service requests work but cannot target another employee or self-approve',async()=>{
  const request=doc(staff.firestore(),'leaveRequests/own-request');
  await assertSucceeds(setDoc(request,{employeeId:'e1',status:'待審核',reason:'休假'}));
  await assertSucceeds(updateDoc(request,{reason:'修改原因'}));
  await assertFails(updateDoc(request,{status:'已核准'}));
  await assertFails(updateDoc(request,{employeeId:'e2'}));
  await assertFails(setDoc(doc(staff.firestore(),'leaveRequests/conflicting-owner'),{employeeId:'e2',userId:'e1',status:'待審核'}));
  await assertFails(setDoc(doc(staff.firestore(),'profileChangeRequests/foreign-target'),{employeeId:'e1',targetEmployeeId:'e2',status:'待審核'}));
  await assertFails(setDoc(doc(staff.firestore(),'parttimeRecords/self-approved'),{employeeId:'e1',status:'已核准'}));
  await assertSucceeds(updateDoc(request,{status:'已刪除'}));
});
test('normal clock transaction can inspect its new document and atomically create it',async()=>{
  const database=staff.firestore(),target=doc(database,'clockRecords/CLK_e1_20260914');
  await assertSucceeds(runTransaction(database,async tx=>{const old=await tx.get(target);assert.equal(old.exists(),false);tx.set(target,{employeeId:'e1',status:'正常',clockType:'標準打卡'});}));
  await assertFails(getDoc(doc(other.firestore(),'clockRecords/CLK_e1_20260914')));
});
test('the actual browser compatibility wrapper preserves SDK transactions and private query results',async()=>{
  const vm=require('node:vm'),source=fs.readFileSync('firebase-client.js','utf8').split('// Protected legacy employee reads:')[1];
  const raw=staff.firestore(),calls=[],window={APP_CONFIG:{FIREBASE_CONFIG:{projectId:'demo-youzi-security'}},YZFirebase:{handleApi:async()=>null},localStorage:{getItem:()=>null},firebase:{auth:()=>({authStateReady:async()=>{},currentUser:{uid:'staff',getIdToken:async()=>'test',getIdTokenResult:async()=>({claims:own})}}),firestore:{Timestamp:require('firebase/compat/app').default.firestore.Timestamp}}};
  vm.runInNewContext('// Protected legacy employee reads:'+source,{window,setTimeout,clearTimeout,AbortController,fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({result:{rows:[{id:'later',data:{employeeId:'e1',createdAt:{_seconds:20,_nanoseconds:0}}},{id:'earlier',data:{employeeId:'e1',createdAt:{_seconds:10,_nanoseconds:0}}}]}})};}});
  const wrapped=window.YZProtectedData.wrap(raw),target=wrapped.collection('clockRecords').doc('CLK_proxy');
  await assertSucceeds(wrapped.runTransaction(async tx=>{const old=await tx.get(target);assert.equal(old.exists,false);tx.set(target,{employeeId:'e1',status:'正常',clockType:'標準打卡'});}));
  const rows=await wrapped.collection('clockRecords').where('employeeId','==','e1').orderBy('createdAt','desc').limit(1).get();assert.equal(rows.docs[0].id,'later');assert.equal(rows.docs[0].data().createdAt.toMillis(),20000);assert.equal(calls.length,1);
});
test('ordinary parttime submissions can be corrected without acquiring approval powers',async()=>{
  const target=doc(staff.firestore(),'parttimeRecords/PT_e1_20260914');
  await assertSucceeds(setDoc(target,{employeeId:'e1','員工ID':'e1',status:'少於有效班段','狀態':'少於有效班段',hours:3}));
  await assertSucceeds(updateDoc(target,{status:'正常','狀態':'正常',hours:4}));
  await assertFails(updateDoc(target,{approvalStatus:'approved'}));await assertFails(updateDoc(target,{reviewedBy:'manager'}));
});
test('a rejected correction can be resubmitted without keeping the previous review stamp',async()=>{
  await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'clockCorrections/rejected'),{employeeId:'e1',status:'已駁回',reviewedAt:'old',reviewedBy:'manager'}));
  await assertSucceeds(setDoc(doc(staff.firestore(),'clockCorrections/rejected'),{employeeId:'e1',status:'待審核',reason:'補充說明'}));
  await assertFails(updateDoc(doc(staff.firestore(),'clockCorrections/rejected'),{reviewStatus:'approved'}));
});
test('private contracts and attachment paths require protected access',async()=>{
  for(const context of [guest,staff]){
    await assertFails(getDoc(doc(context.firestore(),'rentalContracts/c1')));
    await assertFails(getDoc(doc(context.firestore(),'externalTeacherProfiles/t1')));
    await assertFails(getBytes(ref(context.storage(),'rental-contracts/c1/id.jpg')));
    await assertFails(uploadBytes(ref(context.storage(),'external-teachers/t1/id.jpg'),new Uint8Array([1]),{contentType:'image/jpeg'}));
  }
  await assertSucceeds(getBytes(ref(manager.storage(),'rental-contracts/c1/id.jpg')));
});
