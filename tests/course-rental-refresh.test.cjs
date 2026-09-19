'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const backend=fs.readFileSync('functions/coursePortal.js','utf8');
const {courseSourceIds}=require('../functions/coursePortalUtils');
const {applyLessonSettings}=require('../functions/courseLessonSettings');
const date='2026-09-19';
function client(){const window={};vm.runInNewContext(fs.readFileSync('course-scheduler-data.js','utf8'),{window});return window.YouziCoursePreviewData;}
test('full and partial booking snapshots both remain rentals with their cancellation identity',()=>{
 const api=client(),booking={id:'booking',date,roomId:'r',startTime:'15:00',endTime:'17:00',clientName:'租用者',amount:100,source:'course-portal'};
 const full=api.buildState({roomRentals:[booking]},date);
 assert.equal(full.events[0].type,'rental');
 api.applyWorkspaceSlice(full,{calendars:[{scope:{startDate:date,endDate:date},events:[{...booking,id:'booking@'+date,sourceId:'booking',duration:120,type:'lesson',portalAction:'room_booking',portalBookingId:'booking',rentalFee:100}]}]});
 assert.equal(full.events.length,1);assert.equal(full.events[0].type,'rental');assert.equal(full.events[0].portalBookingId,'booking');assert.equal(full.events[0].clientName,'租用者');assert.equal(full.events[0].rentalFee,100);
 assert.equal(api.buildState({events:[{...booking,type:'room_rental',duration:120}]},date).events[0].type,'rental');
});
test('published cancellation suppresses old rental and temporary copies only for the affected occurrence',()=>{
 const start=backend.indexOf('  const removed = new Set(changeRows.filter',backend.indexOf('async function appendCoursePortalData('));
 const end=backend.indexOf('  payload.fixedCourses =',start);
 const old={id:'old',date,roomId:'r',startTime:'11:00',duration:60},keep={...old,id:'keep',startTime:'15:00'},later={...old,date:'2026-09-20'};
 const payload={events:[old,keep],roomRentals:[old,keep,later],temporaryCourses:[old,keep]};
 vm.runInNewContext(backend.slice(start,end),{payload,changeRows:[{action:'cancel',sourceEventId:'old',sourceDate:date}],clean:x=>String(x||''),dateKey:x=>String(x||'').slice(0,10),sourceId:r=>r.id,eventDate:r=>r.date,courseSourceIds});
 assert.deepEqual(payload.roomRentals.map(r=>r.id),['keep','old']);assert.equal(payload.roomRentals[1].date,'2026-09-20');assert.deepEqual(payload.events.map(r=>r.id),['keep']);assert.deepEqual(payload.temporaryCourses.map(r=>r.id),['keep']);
});
test('old payment settings cannot resurrect cancellation or inactive rental',()=>{
 const settings=[{date,eventIds:['rent'],fields:{status:'scheduled',rentalPaymentStatus:'unpaid'}}];
 for(const row of [{id:'rent',date,status:'cancelled'},{id:'rent',date,status:'scheduled',active:false}])assert.equal(applyLessonSettings([row],settings)[0],row);
 const active={id:'rent',date,status:'scheduled'};assert.equal(applyLessonSettings([active],[{date,eventIds:['rent'],fields:{status:'attended',rentalPaymentStatus:'paid'}}])[0].status,'attended');
});
test('desktop startup uses one authoritative snapshot and hides stale calendar while loading',()=>{
 const runtime=fs.readFileSync('operations-course-inline-runtime.js','utf8'),init=runtime.slice(runtime.lastIndexOf('    state=loadInitialState();'));
 assert(!init.includes('refreshPortalRentals();'));assert(init.includes('loadPublishedWorkspace({calendarOnly:true});'));
 const start=runtime.indexOf('  function loadPublishedWorkspace('),end=runtime.indexOf('  function bindEvents()',start),code=runtime.slice(start,end);
 assert(code.includes("$('scheduleGrid').classList.add('hidden')"));assert(code.includes("$('scheduleGrid').classList.remove('hidden')"));
});
