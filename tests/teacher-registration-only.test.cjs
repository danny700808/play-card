'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {database}=require('./helpers/security-fixtures.cjs');
const {createLegacyTeacherForms}=require('../functions/legacyTeacherForms');
const {createTeacherApprovalSync}=require('../functions/teacherApprovalSync');
const asset=(id='t1')=>'https://asia-east1-youzi-c1b74.cloudfunctions.net/privateContractAssetHttp?'+new URLSearchParams({kind:'teacher',id,token:'secret',path:`external-teachers/${id}/private/id.jpg`});
const profile=()=>({name:'測試老師',mobile:'0912345678',idNumber:'ID',birthDate:'1990-01-01',householdAddress:'住址',mailingAddress:'通訊地址',emergencyContact:'聯絡人',emergencyPhone:'0912345679',identityUrls:[asset()],teachingAbilities:[{subjectId:'g',item:'木吉他',level:'專業'}]});
function setup(patch={}){
 const f=database({'externalTeacherContracts/t1':{bindingCode:'secret',lineBindStatus:'bound',status:'waiting_contract',...profile(),...patch},'opsEducationMirrorSubjects/g':{sourceActive:true,source:{id:'g',name:'木吉他',active:true}}});
 const api=createLegacyTeacherForms({...f,baseUrl:'https://example.test/',queueManager:async(row,tx)=>tx.set(f.db.collection('notificationQueue').doc('notice'),row)});
 return {...f,api};
}
const request=record=>({id:'t1',token:'secret',action:'submit-profile',record});
test('step 3 submission and approval activate scheduling without signature or bank and never create a contract',async()=>{
 const f=setup(),result=await f.api.update(request(profile()));
 assert.equal(result.record.registrationOnly,true);assert.equal(result.record.contractStatus,'not_requested');
 assert.match(f.rows.get('notificationQueue/notice').title,/資料待確認/);
 const approved=await createTeacherApprovalSync(f)('t1','manager');
 const row=f.rows.get('externalTeacherContracts/t1'),employee=f.rows.get('employees/'+approved.employeeId);
 assert.equal(row.status,'active');assert.equal(row.contractStatus,'not_requested');assert.equal(employee.accountStatus,'active');
 assert.equal(employee.latestExternalContractStatus,undefined);assert.equal(employee.currentExternalContractId,undefined);
 for(const field of ['signatureUrl','signedAt','contractText','contractHtmlUrl'])assert.equal(row[field],undefined);
 assert.deepEqual(f.rows.get('coursePortalTeacherSubjectAssignments/'+approved.teacherId).effectiveSubjectIds,['g']);
 assert.equal([...f.rows.keys()].filter(k=>k.startsWith('teacherContractAssignments/')).length,0);
 await createTeacherApprovalSync(f)('t1','manager');
 assert.equal([...f.rows.keys()].filter(k=>k.startsWith('employees/')).length,1);
});
test('unbound, incomplete, wrong-owner attachments and missing subjects cannot submit',async()=>{
 for(const [patch,record] of [[{lineBindStatus:'pending'},profile()],[{}, {...profile(),birthDate:''}],[{}, {...profile(),identityUrls:[asset('other')]}],[{}, {...profile(),teachingAbilities:[]} ]]){
  const f=setup(patch),before=structuredClone([...f.rows]);await assert.rejects(f.api.update(request(record)));assert.deepEqual([...f.rows],before);
 }
});
test('old signed records cannot be reclassified as unsigned registrations',async()=>{
 const f=setup({signatureUrl:'historical-signature',signedAt:'2025-01-01',status:'needs_revision'}),before=structuredClone([...f.rows]);
 await assert.rejects(f.api.update(request(profile())),/歷史契約/);assert.deepEqual([...f.rows],before);
});
test('client cannot activate, mark signed, or bypass submission via draft fields',async()=>{
 const f=setup();await f.api.update({id:'t1',token:'secret',action:'draft',record:{registrationOnly:true,contractStatus:'not_requested',profileSubmittedAt:'fake',status:'active',signatureUrl:'fake',signedAt:'fake'}});
 const row=f.rows.get('externalTeacherContracts/t1');assert.equal(row.registrationOnly,undefined);assert.equal(row.signatureUrl,undefined);
 await assert.rejects(createTeacherApprovalSync(f)('t1','manager'));
});
