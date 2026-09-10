'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const names=['TeacherData','TeacherAvailability','TeacherSlotOptions','StudentData','LessonHistory','RentalWeekBoard','RentalAvailability'].map(n=>'coursePortal'+n);
const common=fs.readFileSync('course-portal-common.js','utf8');
test('seven read calls route to Taiwan; writes and login keep US endpoints and payloads',async()=>{
 const calls=[];
 const global={APP_CONFIG:{FIREBASE_CONFIG:{}},firebase:{apps:[{}],app:()=>({functions:region=>({httpsCallable:(name,options)=>async payload=>{calls.push({region,name,options,payload});return {data:payload};}})})}};
 const code=common.slice(common.indexOf('  const config'),common.indexOf('  const CACHE_PREFIX'));
 const c={global};vm.createContext(c);vm.runInContext(code+'\nglobal.resolve=callableFor;',c);
 for(const name of [...names,'coursePortalTeacherAttendance','coursePortalCreateRoomBooking','coursePortalExchangeAccess','coursePortalUpdateStudentReminder']){
  const payload={sessionToken:'test-only',date:'2026-09-10'},options={timeout:180000};
  await global.resolve(name,options)(payload);
  const call=calls.at(-1),regional=names.includes(name);
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
 const regionalLines=backend.split('\n').filter(l=>l.includes("region: 'asia-east1'"));
 assert.equal(regionalLines.length,7);
 assert(!regionalLines.some(l=>/onSchedule|onDocument/.test(l)));
});
test('teacher uses shared region routing and all portal pages load the updated common script',()=>{
 assert.match(fs.readFileSync('teacher-course-portal-v8.js','utf8'),/PortalAuth\.callableFor\(name, \{ timeout: 180000 \}\)/);
 for(const file of fs.readdirSync('.').filter(n=>n.endsWith('.html'))){
  const page=fs.readFileSync(file,'utf8');if(page.includes('course-portal-common.js'))assert.match(page,/course-portal-common\.js\?v=20260910-taiwan-reads-v1/);
 }
});
