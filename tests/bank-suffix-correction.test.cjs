'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {planCorrection, correctAccount} = require('../.github/scripts/correct-approved-bank-suffix.cjs');
const target = {requestId:'request-test', profileId:'profile-test', employeeId:'employee-test', teacherId:'teacher-test'};
const account = '00123456789012';
const request = {...target, status:'已核准', approvalStatus:'approved', changes:[{key:'bankAccountNumber',before:account,after:account+'3456'}]};
const official = {...target,coursePortalTeacherId:target.teacherId,bankAccountNumber:account+'3456',bankAccountName:'Test',idNumber:'untouched'};
function fixture(draft=false) {
  const records = new Map([
    ['profileChangeRequests/'+target.requestId, structuredClone(request)],
    ['teacherPrivateProfiles/'+target.profileId, structuredClone(official)],
    ['externalTeacherProfiles/'+target.profileId, {employeeId:target.employeeId,name:'Test'}]
  ]);
  if (draft) records.set('teacherProfileDrafts/'+target.profileId, {status:'draft'});
  const writes=[];
  const snapshot=key=>({exists:records.has(key),data:()=>records.get(key)});
  const db={collection:collection=>({doc:id=>({path:collection+'/'+id,get:async()=>snapshot(collection+'/'+id)})}),
    runTransaction:async fn=>{const pending=[];const result=await fn({get:async ref=>snapshot(ref.path),update:(ref,patch)=>pending.push([ref.path,patch,true]),create:(ref,patch)=>{assert(!records.has(ref.path));pending.push([ref.path,patch,false]);}});for(const [path,patch,merge] of pending){records.set(path,merge?{...records.get(path),...patch}:patch);writes.push(path);}return result;}};
  return {db,records,writes};
}
test('only the approved 18-to-original-14 suffix correction is allowed',()=>{
  assert.equal(planCorrection(request,official,target).after,account);
  assert.throws(()=>planCorrection({...request,status:'pending'},official,target));
  assert.throws(()=>planCorrection(request,{...official,bankAccountNumber:'9'.repeat(18)},target));
  assert.throws(()=>planCorrection(request,official,{...target,employeeId:'someone-else'}));
  assert.throws(()=>planCorrection({...request,changes:[{...request.changes[0],after:'1'+account+'345'}]},official,target));
});
test('inspection makes no writes and newer drafts block changes',async()=>{
  let f=fixture();assert.equal((await correctAccount(f.db,()=>123,target,false)).status,'ready-no-writes');assert.equal(f.writes.length,0);
  f=fixture(true);await assert.rejects(correctAccount(f.db,()=>123,target,true),/newer editable draft/);assert.equal(f.writes.length,0);
});
test('correction updates only official account, preserves history and is idempotent',async()=>{
  const f=fixture();const result=await correctAccount(f.db,()=>123,target,true);
  assert.equal(result.readBackVerified,true);assert.equal(f.writes.length,3);
  const saved=f.records.get('teacherPrivateProfiles/'+target.profileId);
  assert.equal(saved.bankAccountNumber,account);assert.equal(saved.bankAccountName,official.bankAccountName);assert.equal(saved.idNumber,official.idNumber);
  assert.deepEqual(f.records.get('profileChangeRequests/'+target.requestId),request);
  assert.equal((await correctAccount(f.db,()=>124,target,true)).status,'already-corrected');assert.equal(f.writes.length,3);
});
