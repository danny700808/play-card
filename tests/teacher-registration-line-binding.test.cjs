'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const {database} = require('./helpers/security-fixtures.cjs');
const {createTeacherRegistrationLineBinding} = require('../functions/teacherRegistrationLineBinding');
const {createTeacherApprovalSync} = require('../functions/teacherApprovalSync');
const code = 'EMP-' + 'A'.repeat(36), line = 'U' + '1'.repeat(32), otherLine = 'U' + '2'.repeat(32);
function seed(id='t1', token=code) {
  const row = {name:'測試老師', mobile:'0912345678', bindingCode:token, onboardingToken:token, employeeBindCode:token,
    registrationOnly:true, contractStatus:'not_requested', status:'submitted_pending_admin', profileStatus:'submitted_pending_admin',
    emailBindStatus:'bound', lineBindStatus:'pending', bindingMethod:'both', teachingAbilities:[{subjectId:'g',level:'專業'}],
    idNumber:'ID', birthDate:'1990-01-01', householdAddress:'地址', mailingAddress:'地址', emergencyContact:'聯絡人',
    emergencyPhone:'0912345679', identityUrls:['private-test-asset'], profileSubmittedAt:'2026-11-16'};
  const index = {bindingCode:token, targetCollection:'externalTeacherContracts', teacherId:id, externalTeacherContractId:id, employeeId:'', status:'pending'};
  return {['externalTeacherContracts/'+id]:row, ['externalTeacherProfiles/'+id]:structuredClone(row),
    ['employeeLineBindings/'+token]:index, ['externalTeacherLineBindings/'+token]:structuredClone(index),
    'opsEducationMirrorSubjects/g':{sourceActive:true,source:{id:'g',name:'木吉他',active:true}}};
}
function setup(data=seed(), options={}) {
  const f=database(data), original=f.db.runTransaction.bind(f.db), replies=[];
  // Add query reads and enforce Firestore's read-before-write transaction rule.
  f.db.runTransaction = fn => original(tx => {
    const get=tx.get, set=tx.set; let written=false;
    tx.get=ref=>{assert.equal(written,false,'transaction read after write');return ref.path?get(ref):ref.get();};
    tx.set=(...args)=>{written=true;return set(...args);};
    return fn(tx);
  });
  const handle=createTeacherRegistrationLineBinding({...f, baseUrl:'https://example.test/',
    replyLineMessage:async(token,text)=>replies.push(text), getLineProfile:async()=>({displayName:'測試 LINE'}),
    getPrimaryManagerLineRecipient:async()=>null, ...options});
  return {...f, replies, handle};
}
const event=(token=code, user=line)=>({type:'message',message:{type:'text',text:'柚子人員綁定 '+token},source:{type:'user',userId:user},replyToken:'test-only'});
test('current pending teacher code binds all contact records without losing review, email, subjects or private profile',async()=>{
  const f=setup(), before=structuredClone(f.rows.get('externalTeacherContracts/t1'));
  assert.equal(await f.handle(event()),true);
  for (const collection of ['externalTeacherContracts','externalTeacherProfiles']) {
    const row=f.rows.get(collection+'/t1');assert.equal(row.lineUserId,line);assert.equal(row.lineBindStatus,'bound');
    for (const key of Object.keys(before)) if(key!=='lineBindStatus') assert.deepEqual(row[key],before[key]);
    assert.equal(row.signatureUrl,undefined);assert.equal(row.signedAt,undefined);
  }
  for(const collection of ['employeeLineBindings','externalTeacherLineBindings'])assert.equal(f.rows.get(collection+'/'+code).status,'bound');
  assert.match(f.replies[0],/綁定完成/);assert.match(f.replies[0],/等待管理者確認/);
  assert(![...f.rows.keys()].some(path=>/^(employees|employeeLoginBindings|coursePortalTeacherBindings|notificationQueue)\//.test(path)));
});
test('repeat paste is idempotent, and another LINE cannot take the bound code',async()=>{
  const f=setup();await f.handle(event());const before=structuredClone([...f.rows]);
  await f.handle(event());assert.deepEqual([...f.rows],before);
  await f.handle(event(code,otherLine));assert.match(f.replies.at(-1),/已綁定其他 LINE/);assert.deepEqual([...f.rows],before);
});
test('unsubmitted teacher receives a resumable step 3 link without opening contracts',async()=>{
  const data=seed();for(const name of ['externalTeacherContracts','externalTeacherProfiles'])data[name+'/t1'].status='waiting_bindings';
  const f=setup(data);await f.handle(event());assert.match(f.replies[0],/第三步/);assert.match(f.replies[0],/external-teacher-onboarding.html\?id=t1&code=/);
  assert.equal(f.rows.get('externalTeacherContracts/t1').contractStatus,'not_requested');
});
test('unknown, generic employee, and historical signed codes are not handled by the new registration path',async()=>{
  for(const patch of [{registrationOnly:false},{contractStatus:'active'},{signatureUrl:'historical'},{signedAt:'2025'},{contractHtmlUrl:'historical'}]) {
    const data=seed();Object.assign(data['externalTeacherContracts/t1'],patch);const f=setup(data),before=structuredClone([...f.rows]);
    assert.equal(await f.handle(event()),false);assert.deepEqual([...f.rows],before);assert.equal(f.replies.length,0);
  }
  const f=setup();assert.equal(await f.handle(event('EMP-'+'B'.repeat(36))),false);assert.equal(await f.handle(event('EMP-OLD')),false);
});
test('revoked, mismatched, missing and disabled registration records cannot bind',async()=>{
  for(const [path,patch] of [['externalTeacherContracts/t1',{bindingCode:'changed',onboardingToken:'changed'}],
    ['employeeLineBindings/'+code,{status:'revoked'}], ['externalTeacherLineBindings/'+code,{teacherId:'other',externalTeacherContractId:'other'}],
    ['externalTeacherProfiles/t1',{active:false}], ['externalTeacherProfiles/t1',{bindingCode:'other',onboardingToken:'other'}],
    ['externalTeacherContracts/t1',{status:'deleted'}]]) {
    const data=seed();Object.assign(data[path],patch);const f=setup(data),before=structuredClone([...f.rows]);
    await f.handle(event());assert.match(f.replies[0],/失效|不一致/);assert.deepEqual([...f.rows],before);
  }
  const data=seed();delete data['externalTeacherLineBindings/'+code];const f=setup(data),before=structuredClone([...f.rows]);
  await f.handle(event());assert.deepEqual([...f.rows],before);
});
test('manager account, another employee, teacher profile, portal teacher or group sender cannot claim the code',async()=>{
  const manager=setup(seed(),{getPrimaryManagerLineRecipient:async()=>({lineUserId:line})});await manager.handle(event());assert.match(manager.replies[0],/主管/);
  for(const collection of ['employees','externalTeacherContracts','externalTeacherProfiles','coursePortalTeacherBindings']) {
    const data=seed();data[collection+'/other']={lineUserId:line,teacherId:'other',status:'active'};
    const f=setup(data),before=structuredClone([...f.rows]);await f.handle(event());assert.match(f.replies[0],/已綁定其他人員/);assert.deepEqual([...f.rows],before);
  }
  const f=setup(),before=structuredClone([...f.rows]);await f.handle({...event(),source:{type:'group',userId:line}});assert.match(f.replies[0],/私訊/);assert.deepEqual([...f.rows],before);
});
test('simultaneous codes cannot claim one LINE for two pending teachers',async()=>{
  const second='EMP-'+'B'.repeat(36),f=setup({...seed(),...seed('t2',second)});
  await Promise.all([f.handle(event()),f.handle(event(second))]);
  assert.equal(['t1','t2'].filter(id=>f.rows.get('externalTeacherContracts/'+id).lineBindStatus==='bound').length,1);
  assert(f.replies.some(message=>message.includes('已綁定其他人員')));
});
test('binding before approval synchronizes to employee; late binding after approval also synchronizes without changing approval',async()=>{
  for(const first of ['binding','approval']) {
    const f=setup();if(first==='binding')await f.handle(event());
    const approved=await createTeacherApprovalSync(f)('t1','manager');if(first==='approval')await f.handle(event());
    const employee=f.rows.get('employees/'+approved.employeeId),row=f.rows.get('externalTeacherContracts/t1');
    assert.equal(employee.lineUserId,line);assert.equal(employee.lineBindStatus,'bound');assert.equal(employee.accountStatus,'active');
    assert.equal(row.status,'active');assert.equal(row.contractStatus,'not_requested');
  }
});
test('approval uses LINE contact verified after its initial read, not the stale pending snapshot',async()=>{
  const f=setup(),original=f.db.runTransaction.bind(f.db);let injected=false;
  f.db.runTransaction=async fn=>{if(!injected){injected=true;await f.handle(event());}return original(fn);};
  const result=await createTeacherApprovalSync(f)('t1','manager');
  assert.equal(f.rows.get('employees/'+result.employeeId).lineUserId,line);
  assert.equal(f.rows.get('employees/'+result.employeeId).lineBindStatus,'bound');
});
test('actual webhook dispatches current registrations before disabled legacy and generic employee paths',async()=>{
  const source=fs.readFileSync('functions/index.js','utf8'),start=source.indexOf('async function handleLineWebhookMessage(event)'),end=source.indexOf('exports.lineWebhook =',start);
  const f=setup(),c={db:f.db,replyLineMessage:async()=>{},normalizeText:v=>String(v||'').trim(),require:()=>({createSharedLine:()=>({handle:async()=>false})}),
    handleTeacherRegistrationLineEvent:f.handle,handleExternalTeacherLineEvent:()=>{throw Error('incorrect legacy route');},handleCoursePortalLineEvent:()=>{throw Error('incorrect portal route');}};
  vm.runInNewContext(source.slice(start,end),c);await c.handleLineWebhookMessage(event());
  assert.equal(f.rows.get('externalTeacherContracts/t1').lineUserId,line);assert.match(f.replies[0],/綁定完成/);
});
