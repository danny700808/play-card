'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('course-scheduler-data.js','utf8');
function harness(authResult={ok:true},response={ok:true}) {
  const calls=[],authCalls=[];
  const window={
    APP_CONFIG:{FIREBASE_CONFIG:{projectId:'test'}},
    getUser:()=>({role:'admin'}),
    YouziOperationsManagerAuth:{ensureManagerAuth:async(...args)=>{authCalls.push(args);return authResult;}},
    firebase:{apps:[{}],initializeApp(){},app:()=>({functions:()=>({httpsCallable:name=>async payload=>{calls.push({name,payload});return {data:response};}})})}
  };
  vm.runInNewContext(source,{window,console});
  return {api:window.YouziCoursePreviewData,calls,authCalls};
}
test('room availability saves with current manager login and no migration PIN',async()=>{
  const h=harness();
  const policies={4:{'10:00':{blockSchedule:false,blockRental:true,subjectIds:[]},'11:00':{blockSchedule:false,blockRental:true,subjectIds:[]}}};
  await h.api.saveRoomSettings({roomId:'guitar',publicName:'吉他教室',policies,rentalFee:100});
  assert.equal(h.authCalls.length,1);
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].name,'coursePortalAdminSaveRoomEquipment');
  assert.equal(h.calls[0].payload.roomId,'guitar');
  assert.deepEqual(h.calls[0].payload.policies,policies);
  assert.equal('adminPin' in h.calls[0].payload,false);
});
test('expired manager login blocks saving, even with a stored migration PIN',async()=>{
  const h=harness({ok:false,message:'請重新登入',reauth:true});
  await assert.rejects(h.api.saveRoomSettings({roomId:'guitar',manualSyncPin:'obsolete'}),/請重新登入/);
  assert.equal(h.calls.length,0);
});
test('backend failure is not reported as a successful save',async()=>{
  const h=harness({ok:true},{ok:false});
  await assert.rejects(h.api.saveRoomSettings({roomId:'guitar'}),/未完成/);
});
test('missing classroom is rejected before any write',async()=>{
  const h=harness();
  await assert.rejects(h.api.saveRoomSettings({}),/缺少教室/);
  assert.equal(h.calls.length,0);
});
