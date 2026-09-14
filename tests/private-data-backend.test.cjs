'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {database}=require('./helpers/security-fixtures.cjs');
const {createEmployeeDataGateway}=require('../functions/employeeDataGateway');
const {createEmployeeRegistration}=require('../functions/employeeRegistration');
const {createLegacyTeacherForms}=require('../functions/legacyTeacherForms');
const {createPrivateContractAssets,parseAsset,validateAssetUrl}=require('../functions/privateContractAssets');
const {createInventoryCountAccess}=require('../functions/inventoryCountAccess');
const {renewalDraft,assertOnlineSignable}=require('../functions/rentalCustomerPolicy');
const staff={auth:{uid:'u1',token:{employee:true,employeeId:'e1',email:'staff@example.test'}}};
const employee={employeeId:'e1',email:'staff@example.test',name:'Staff',accountStatus:'active',role:'staff',passwordHash:'private-hash'};
test('employee gateway requires an active identity and returns only its rows and payroll map',async()=>{
  const f=database({'employees/e1':employee,'employees/e2':{employeeId:'e2',email:'other@example.test'},'salarySetup/default':{employeeConfigMap:{e1:{employeeId:'e1',salary:32000},e2:{employeeId:'e2',salary:40000}},secret:'hidden'},'leaveRequests/conflict':{employeeId:'e2',email:'staff@example.test'}});
  const api=createEmployeeDataGateway(f);
  await assert.rejects(api.read({collection:'employees'},{}));
  const rows=(await api.read({collection:'employees'},staff)).rows;assert.equal(rows.length,1);assert.equal(rows[0].data.passwordHash,undefined);
  const salary=(await api.read({collection:'salarySetup'},staff)).rows[0].data;assert.deepEqual(Object.keys(salary.employeeConfigMap),['e1']);assert.equal(salary.secret,undefined);
  assert.equal((await api.read({collection:'leaveRequests'},staff)).rows.length,0);
  f.rows.get('employees/e1').accountStatus='disabled';await assert.rejects(api.read({collection:'employees'},staff));
});
test('public registration cannot supply an active account or elevated role and concurrent emails create one row',async()=>{
  const f=database(),api=createEmployeeRegistration({...f,notify:async()=>{}}),payload={name:'New',email:'new@example.test',role:'admin',accountStatus:'active',manager:true};
  const results=await Promise.allSettled([api(payload),api(payload)]);assert.equal(results.filter(row=>row.status==='fulfilled'&&row.value.ok).length,1);
  const employees=[...f.rows].filter(([path])=>path.startsWith('employees/'));assert.equal(employees.length,1);assert.equal(employees[0][1].role,'staff');assert.equal(employees[0][1].accountStatus,'pending');assert.equal(employees[0][1].manager,undefined);
});
test('a teacher submits only their own attachments and the server-owned contract template',async()=>{
  const f=database({'externalTeacherContracts/t1':{bindingCode:'secret',lineBindStatus:'bound',status:'waiting_contract',name:'Teacher',contractYear:2026},'externalTeacherContractTemplates/current':{title:'Template',version:'v2',clausesText:'Original terms'}});
  const api=createLegacyTeacherForms({...f,baseUrl:'https://example.test/',queueManager:async(row,writer)=>writer.set(f.db.collection('notificationQueue').doc('teacher-submit'),row)});
  const url=name=>'https://us-central1-youzi-c1b74.cloudfunctions.net/privateContractAssetHttp?'+new URLSearchParams({kind:'teacher',id:'t1',token:'secret',path:'external-teachers/t1/private/'+name+'.png'});
  const request={id:'t1',token:'secret',action:'submit',record:{idNumber:'ID',signatureUrl:url('sig'),identityUrls:[url('id')],contractText:'Tampered terms',templateVersion:'fake'}};
  await assert.rejects(api.update({...request,record:{...request.record,contractHtmlUrl:'javascript:alert(1)'}}));
  const result=await api.update(request);assert.equal(result.record.contractText,'Original terms');assert.equal(result.record.templateVersion,'v2');assert(f.rows.has('notificationQueue/teacher-submit'));
  await assert.rejects(api.update(request),/已送出/);
});
test('notification preparation failure cannot leave a created employee or teacher contract behind',async()=>{
  const f=database(),fail=async()=>{throw Error('queue unavailable');};
  await assert.rejects(createEmployeeRegistration({...f,notify:fail})({name:'New',email:'new@example.test'}));assert.equal(f.rows.size,0);
  const api=createLegacyTeacherForms({...f,baseUrl:'https://example.test/',queueManager:fail,queueEmail:async()=>{}});
  await assert.rejects(api.create({record:{name:'Teacher',mobile:'0900',bindingMethod:'line',contractYear:2026}}));assert.equal(f.rows.size,0);
});
test('self-service binding and notification preferences cannot change another person or login email',async()=>{
  const f=database({'employees/e1':employee,'employees/e2':{employeeId:'e2',email:'other@example.test'}}),api=createEmployeeDataGateway(f);
  const result=await api.selfService({action:'ensureEmployeeLineBindCode',payload:{employeeId:'e2'}},staff);
  assert.equal(f.rows.get('employeeLineBindings/'+result.employeeBindCode).employeeId,'e1');assert.equal(f.rows.get('employees/e2').employeeBindCode,undefined);
  await assert.rejects(api.selfService({action:'saveMyNotificationSettings',payload:{email:'other@example.test'}},staff));
  await api.selfService({action:'saveMyNotificationSettings',payload:{notificationPreference:'email'}},staff);assert.equal(f.rows.get('employees/e1').notificationPreference,'email');
  await api.selfService({action:'goods-inquiry',collection:'teacherGoodsInquiry',id:'inquiry-1',payload:{userId:'e2',teacherId:'e2',itemName:'Piano',replyPrice:1,status:'approved'}},staff);
  const row=f.rows.get('teacherGoodsInquiry/inquiry-1');assert.equal(row.userId,'e1');assert.equal(row.replyPrice,undefined);assert.equal(row.status,'待處理');
});
test('new private URLs require the right contract, token and project; existing HTTPS attachments remain usable',()=>{
  const policy={kind:'rental',id:'c1',token:'secret'},url='https://us-central1-youzi-c1b74.cloudfunctions.net/privateContractAssetHttp?'+new URLSearchParams({kind:'rental',id:'c1',token:'secret',path:'rental-contracts/c1/private/sign.png'});
  assert.equal(validateAssetUrl(url,policy),url);assert.throws(()=>validateAssetUrl(url,{...policy,id:'c2'}));assert.throws(()=>validateAssetUrl(url,{...policy,token:'wrong'}));
  assert.throws(()=>validateAssetUrl('javascript:alert(1)',{...policy,previous:['javascript:alert(1)']}));
  assert.equal(validateAssetUrl('https://old.example.test/attachment',{...policy,previous:['https://old.example.test/attachment']}),'https://old.example.test/attachment');
});
test('legacy teacher links stay token-scoped and a new Email verification requires the mailed nonce',async()=>{
  const f=database(),mail=[],api=createLegacyTeacherForms({...f,baseUrl:'https://example.test/',queueEmail:async row=>mail.push(row),queueManager:async()=>{}});
  const {record}=await api.create({record:{name:'Teacher',mobile:'0900000000',email:'teacher@example.test',bindingMethod:'email',contractYear:2026,lineBindStatus:'bound',role:'admin',employeeId:'someone-else'}});
  assert.equal(record.employeeId,'');assert.equal(record.lineBindStatus,'pending');assert.equal(record.role,undefined);assert.equal(record.emailVerificationToken,undefined);
  await assert.rejects(api.read({id:record.id,token:'wrong'}));
  await assert.rejects(api.update({id:record.id,token:record.bindingCode,action:'verify-email',record:{}}));
  const nonce=new URL(mail[0].body.split('\n').at(-1)).searchParams.get('emailToken');
  const verified=await api.update({id:record.id,token:record.bindingCode,action:'verify-email',emailToken:nonce,record:{}});assert.equal(verified.record.emailBindStatus,'bound');
  f.rows.get('externalTeacherContracts/'+record.id).status='contract_effective';
  await assert.rejects(api.update({id:record.id,token:record.bindingCode,action:'submit',record:{idNumber:'new'}}));
});
test('private uploads reject wrong contracts and require authorization again for download',async()=>{
  const files=new Map(),bucket={file:path=>({save:async(buffer,options)=>files.set(path,{buffer,options}),getMetadata:async()=>[{size:files.get(path).buffer.length,contentType:files.get(path).options.metadata.contentType}],download:async()=>[files.get(path).buffer]})};
  const api=createPrivateContractAssets({bucket,baseUrl:'https://example.test/privateContractAssetHttp',authorize:async(kind,id,token)=>{if(id!=='c1'||token!=='secret')throw Error('invalid token');}}),data={id:'c1',token:'secret',path:'rental-contracts/c1/id.jpg',dataUrl:'data:image/jpeg;base64,/9j/2Q=='};
  await assert.rejects(api.upload('rental',{...data,path:'rental-contracts/c2/id.jpg'}));
  const result=await api.upload('rental',data),params=Object.fromEntries(new URL(result.url).searchParams);
  assert.equal(files.size,1);assert.equal([...files.values()][0].options.metadata.firebaseStorageDownloadTokens,undefined);
  await assert.rejects(api.download({...params,token:'wrong'}));assert.equal((await api.download(params)).buffer.length,4);
  assert.throws(()=>parseAsset({...data,dataUrl:'data:image/svg+xml;base64,AAAA'}));
  assert.throws(()=>parseAsset({...data,path:'rental-contracts/c1/../c2/a.jpg'}));
});
test('PIN verification precedes stock reads; retrying a count is idempotent and stale stock is rejected',async()=>{
  const pinHash=crypto.createHash('sha256').update('my-pin').digest('hex');
  const f=database({'opsSettings/inventoryCount':{enabled:true,pinHash},'opsInternalProducts/p1':{currentStock:4,internalSku:'P1',internalName:'Product',averageCost:20,costLayers:[]}}),api=createInventoryCountAccess(f);
  await assert.rejects(api.products({token:''}));await assert.rejects(api.login({pin:'wrong'}));
  const {token}=await api.login({pin:'my-pin'}),rows=await api.products({token});assert.equal(rows.products[0].averageCost,undefined);
  const data={token,productId:'p1',operator:'Counter',target:5,expectedStock:4,operationId:'operation-1234567890'};
  await api.save(data);await api.save(data);assert.equal(f.rows.get('opsInternalProducts/p1').currentStock,5);assert.equal([...f.rows.keys()].filter(path=>path.startsWith('opsInventoryTransactions/')).length,1);
  await assert.rejects(api.save({...data,operationId:'operation-1234567891'}),/庫存已被其他/);
});
test('renewal prices and dates come from the contract; closed or paper contracts cannot be signed online',()=>{
  const draft=renewalDraft({rentalType:'digitalPiano',endDate:'2026-09-30',periodDays:90},{periods:1,rentFee:1},'now');assert.equal(draft.rentFee,2800);assert.equal(draft.startDate,'2026-10-01');assert.equal(draft.endDate,'2026-12-29');
  assert.throws(()=>renewalDraft({endDate:'bad'},{periods:1},'now'));assert.throws(()=>assertOnlineSignable({status:'租賃中'}));assert.throws(()=>assertOnlineSignable({customerOnlineSigningDisabled:true}));
});
