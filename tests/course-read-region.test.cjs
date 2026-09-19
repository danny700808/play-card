'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const names=['TeacherData','TeacherAvailability','TeacherSlotOptions','StudentData','LessonHistory','RentalWeekBoard','RentalAvailability'].map(n=>'coursePortal'+n);
const common=fs.readFileSync('course-portal-common.js','utf8');
test('course reads and teacher attendance route to Taiwan; unrelated writes and login retain their endpoints',async()=>{
 const calls=[];
 const global={APP_CONFIG:{FIREBASE_CONFIG:{}},firebase:{apps:[{}],app:()=>({functions:region=>({httpsCallable:(name,options)=>async payload=>{calls.push({region,name,options,payload});return {data:payload};}})})}};
 const code=common.slice(common.indexOf('  const config'),common.indexOf('  const CACHE_PREFIX'));
 const c={global};vm.createContext(c);vm.runInContext(code+'\nglobal.resolve=callableFor;',c);
 for(const name of [...names,'coursePortalTeacherAttendance','coursePortalCreateRoomBooking','coursePortalExchangeAccess','coursePortalUpdateStudentReminder']){
  const payload={sessionToken:'test-only',date:'2026-09-10'},options={timeout:180000};
  await global.resolve(name,options)(payload);
  const call=calls.at(-1),regional=names.includes(name)||name==='coursePortalTeacherAttendance';
  assert.equal(call.region,regional?'asia-east1':'us-central1');
  assert.equal(call.name,name+(regional?'Taiwan':''));assert.equal(call.payload,payload);assert.equal(call.options,options);
 }
});
test('regional copies preserve the same handlers, auth wrappers and resource settings',()=>{
 const backend=fs.readFileSync('functions/coursePortal.js','utf8');
 for(const name of names){
  const old=backend.split('\n').find(l=>l.includes('exportsObject.'+name+' ='));
  const regional=backend.split('\n').find(l=>l.includes('exportsObject.'+name+'Taiwan ='));
  assert.equal(regional.replace(name+'Taiwan =',name+' =').replace("region: 'asia-east1', ",''),old);
 }
 const regionalLines=backend.split('\n').filter(l=>/region:\s*'asia-east1'/.test(l));
 assert.equal(regionalLines.length,21);
 assert(!regionalLines.some(l=>/onSchedule|onDocument/.test(l)));
});
test('teacher uses shared region routing and all portal pages load the updated common script',()=>{
 assert.match(fs.readFileSync('teacher-course-portal-v8.js','utf8'),/PortalAuth\.callableFor\(name, \{ timeout: 180000 \}\)/);
 for(const file of fs.readdirSync('.').filter(n=>n.endsWith('.html'))){
  const page=fs.readFileSync(file,'utf8');if(page.includes('course-portal-common.js'))assert.match(page,/course-portal-common\.js\?v=20260919-taiwan-v2/);
 }
});
test('verified Taiwan teacher routes are enabled and retain a reversible deployment flag',async()=>{
 const names=['TeacherUtilitySession','TeacherUpdateStudent','TeacherSubmitContactBookPost','TeacherBonusRequest'].map(name=>'coursePortal'+name);
 for(const enabled of [false,true]){
  const calls=[],global={APP_CONFIG:{FIREBASE_CONFIG:{},COURSE_PORTAL_TAIWAN_EXTENDED:enabled},firebase:{apps:[{}],app:()=>({functions:region=>({httpsCallable:name=>async()=>{calls.push({region,name});return {data:{}};}})})}};
  const code=common.slice(common.indexOf('  const config'),common.indexOf('  const CACHE_PREFIX'));
  vm.runInNewContext(code+'\nglobal.resolve=callableFor;',{global});
  for(const name of names){await global.resolve(name)({});assert.equal(calls.at(-1).region,enabled?'asia-east1':'us-central1');assert.equal(calls.at(-1).name,name+(enabled?'Taiwan':''));}
 }
 const config=fs.readFileSync('config.js','utf8');assert.match(config,/COURSE_PORTAL_TAIWAN_EXTENDED:\s*true/);
});

test('unified Taiwan setting routes login and remaining mutations without retrying another region',async()=>{
 for(const region of ['asia-east1','us-central1']){
  const calls=[],global={APP_CONFIG:{FIREBASE_CONFIG:{},FUNCTION_REGION:region},firebase:{apps:[{}],app:()=>({functions:location=>({httpsCallable:name=>async()=>{calls.push({location,name});throw Error('network error');}})})}};
  const code=common.slice(common.indexOf('  const config'),common.indexOf('  const CACHE_PREFIX'));
  vm.runInNewContext(code+'\nglobal.resolve=callableFor;',{global});
  for(const name of ['coursePortalStartLineLogin','coursePortalExchangeAccess','coursePortalCreateRoomBooking','coursePortalStudentSubmitTuitionPayment']){
   const before=calls.length;await assert.rejects(global.resolve(name)({}),/network error/);
   assert.equal(calls.length,before+1);assert.equal(calls.at(-1).location,region);assert.equal(calls.at(-1).name,name);
  }
 }
});
