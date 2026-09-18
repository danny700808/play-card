const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createAttendanceTiming}=require('../functions/courseAttendanceTiming');
test('timings separate save and refresh, record phases and mark over three seconds',async()=>{
 let clock=0;const rows=[],t=createAttendanceTiming({now:()=>clock,log:r=>rows.push(r)});
 const handler=t.withAttendanceTiming(async()=>{await t.timeAttendanceStage('authorize',()=>{clock+=10});await t.timeAttendanceStage('commit',()=>{clock+=3100});return {ok:true};},'asia-east1');
 assert.deepEqual(await handler({},{}),{ok:true});assert.equal(rows[0].action,'save');assert.equal(rows[0].totalMs,3110);assert.equal(rows[0].overThreeSeconds,true);assert.equal(rows[0].firstRequestInInstance,true);
 await handler({action:'refresh'},{});assert.equal(rows[1].action,'refresh');assert.equal(rows[1].firstRequestInInstance,false);assert.deepEqual(rows[0].stages.map(s=>s.stage),['authorize','commit']);
});
test('failure timing preserves the original error and excludes request identity and credentials',async()=>{
 const rows=[],t=createAttendanceTiming({log:r=>rows.push(r)}),error=Object.assign(Error('secret message'),{code:'permission-denied'});
 const handler=t.withAttendanceTiming(()=>t.timeAttendanceStage('authorize',()=>{throw error;}),'asia-east1');
 await assert.rejects(handler({studentId:'private-student',adminPin:'private-pin'},{}),e=>e===error);
 assert.equal(rows[0].errorCode,'permission-denied');assert.equal(rows[0].outcome,'error');assert(!/private|secret message/.test(JSON.stringify(rows)));
});
test('concurrent requests do not mix stages, logging failure cannot turn a save into failure',async()=>{
 const rows=[],t=createAttendanceTiming({log:r=>rows.push(r)});let release;const wait=new Promise(r=>release=r);
 const first=t.withAttendanceTiming(()=>t.timeAttendanceStage('commit',()=>wait),'asia-east1')({},{});
 await t.withAttendanceTiming(()=>t.timeAttendanceStage('refresh_tuition',()=>42),'asia-east1')({action:'refresh'},{});release();await first;
 assert.deepEqual(rows.find(r=>r.action==='save').stages.map(s=>s.stage),['commit']);assert.deepEqual(rows.find(r=>r.action==='refresh').stages.map(s=>s.stage),['refresh_tuition']);
 const broken=createAttendanceTiming({log:()=>{throw Error('log failed')}});assert.equal(await broken.withAttendanceTiming(()=>42,'asia-east1')({},{}),42);
 assert.equal(await t.timeAttendanceStage('outside_admin',()=>17),17);assert.equal(rows.length,2);
});
test('desktop save and refresh keep manager authorization and route desktop mutations to Taiwan',async()=>{
 const calls=[],logs=[];let authorizations=0;const root={APP_CONFIG:{FIREBASE_CONFIG:{projectId:'test'}},console:{info:(...r)=>logs.push(r)},YouziOperationsManagerAuth:{ensureManagerAuth:async()=>{authorizations++;return {ok:true}}},firebase:{apps:[{}],initializeApp(){},app:()=>({functions:region=>({httpsCallable:name=>async payload=>{calls.push({region,name,payload});return {data:{ok:true}}}})})}};
 vm.runInNewContext(fs.readFileSync('course-scheduler-data.js','utf8'),{window:root});
 await root.YouziCoursePreviewData.setAttendance({teacherId:'t',status:'attended'});await root.YouziCoursePreviewData.refreshAttendance({studentIds:['s'],payrollScopes:[]});await root.YouziCoursePreviewData.saveLeaveReason({name:'test'});
 assert.equal(authorizations,3);assert.deepEqual(calls.slice(0,2).map(r=>[r.region,r.name]),[['asia-east1','coursePortalAdminSetAttendanceTaiwan'],['asia-east1','coursePortalAdminSetAttendanceTaiwan']]);assert.equal(calls[1].payload.action,'refresh');assert.equal(calls[2].region,'asia-east1');assert(logs.some(r=>r[1].stage==='manager_auth'));assert(logs.some(r=>r[1].stage==='request'));assert(!JSON.stringify(logs).includes('teacherId'));
});
test('both server regions use the same authorization gate before save or refresh',async()=>{
 const source=fs.readFileSync('functions/coursePortal.js','utf8');const start=source.indexOf('  const adminAttendanceHandler ='),end=source.indexOf('  exportsObject.coursePortalAdminSaveStudent',start),exportsObject={};let allowed=false;const calls=[];
 vm.runInNewContext(source.slice(start,end),{exportsObject,REGION:'us-central1',ADMIN_PIN:'secret-reference',callable:(handler,options)=>({handler,options}),withPortalReads:f=>f,withAttendanceTiming:f=>f,timeAttendanceStage:(_,f)=>f(),assertAdminPin:()=>{if(!allowed)throw Error('denied');},adminSetAttendance:()=>{calls.push('save');return {ok:true}},adminAttendanceDetail:()=>{calls.push('refresh');return {ok:true}}});
 for(const name of ['coursePortalAdminSetAttendance','coursePortalAdminSetAttendanceTaiwan'])for(const action of ['save','refresh'])await assert.rejects(exportsObject[name].handler({action},{}),/denied/);
 assert.equal(calls.length,0);allowed=true;await exportsObject.coursePortalAdminSetAttendanceTaiwan.handler({action:'save'},{});await exportsObject.coursePortalAdminSetAttendanceTaiwan.handler({action:'refresh'},{});assert.deepEqual(calls,['save','refresh']);assert.equal(exportsObject.coursePortalAdminSetAttendanceTaiwan.options.region,'asia-east1');assert.deepEqual(Array.from(exportsObject.coursePortalAdminSetAttendanceTaiwan.options.secrets),['secret-reference']);
});
