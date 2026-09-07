'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup(status='success',authorized=true){
 const calls=[];
 const payload={ok:true,dataMode:'mirror',runId:'verified-source',mirrorMeta:{status},students:[{id:'new-student',name:'new group'}],rooms:[{id:'room',name:'room'}],tuitionPeriods:[{id:'period',studentId:'new-student',expectedAmount:3600,lessonCount:4,transactions:[]}],events:[]};
 const context={console,Date,Map,Set,Promise,APP_CONFIG:{FIREBASE_CONFIG:{projectId:'test'}},getUser:()=>({role:'manager'}),YouziOperationsManagerAuth:{ensureManagerAuth:async()=>{calls.push('auth');return{ok:authorized,message:'session expired'}}},firebase:{apps:[{}],initializeApp:()=>{},app:()=>({functions:()=>({httpsCallable:name=>async()=>{calls.push(name);return{data:payload}}})})}};
 context.window=context;vm.runInNewContext(fs.readFileSync(require.resolve('../course-scheduler-data'),'utf8'),context);
 return {calls,payload,load:()=>context.YouziCoursePreviewData.loadPublished({anchorDate:'2026-09-07'})};
}
test('refresh loads completed cloud data through manager auth without starting legacy capture',async()=>{
 const s=setup(),result=await s.load();assert.deepEqual(s.calls,['auth','loadInjiaoyunEducationMirrorAuto']);
 assert.equal(result.students[0].id,'new-student');assert.equal(result.tuitionPeriods[0].expectedAmount,3600);assert.equal(result.tuitionPeriods[0].transactions.length,0);
});
test('incomplete sync and expired auth cannot supply replacement workspace data',async()=>{
 await assert.rejects(setup('running').load(),/尚未完成/);
 const s=setup('success',false);await assert.rejects(s.load(),/expired/);assert.deepEqual(s.calls,['auth']);
});
test('published tuition usage survives a partial attendance window and later local changes',async()=>{
 const s=setup();s.payload.tuitionPeriods[0].usedCount=3;
 s.payload.attendance=[{id:'a',periodId:'period',studentId:'new-student',date:'2026-09-01',deducted:true}];
 const result=await s.load(),period=result.tuitionPeriods[0];
 assert.equal(period.usedCount,3);assert.equal(period.attendanceUsageOffset,2);
 const runtime=fs.readFileSync(require.resolve('../operations-course-inline-runtime'),'utf8');
 const fn=runtime.match(/  function recalcPeriods\(\)\{[^\n]+/)[0];
 const context={state:result,numberOf:value=>Number(value)||0};
 vm.runInNewContext(fn+'; recalcPeriods();',context);assert.equal(period.usedCount,3);
 result.attendance.push({periodId:'period',deducted:true});
 vm.runInNewContext('recalcPeriods()',context);assert.equal(period.usedCount,4);
 result.attendance[0].deducted=false;
 vm.runInNewContext('recalcPeriods()',context);assert.equal(period.usedCount,3);
});
