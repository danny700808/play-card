const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
for(const file of ['course-scheduler.js','operations-course-inline-runtime.js']){
 const source=fs.readFileSync(file,'utf8');
 const fn=source.slice(source.indexOf('  function eventConflictReasons('),source.indexOf('  function eventDisplayName('));
 const original={id:'manager-schedule@2026-09-22',sourceCourseId:'manager-schedule',date:'2026-09-22',start:'17:00',duration:60,roomId:'guitar',teacherId:'teacher',subjectId:'guitar',studentIds:['student'],type:'fixed'};
 const signed={...original,id:'lesson-status@2026-09-22',sourceId:'lesson-status',status:'attended'};
 function reasons(candidate,others,ignored=[candidate.id]){
  const context={state:{dataMode:'live',events:[original,...others]},isNonOccupyingEvent:()=>false,timeToMin:s=>Number(s.slice(0,2))*60+Number(s.slice(3)),numberOf:Number,roomById:()=>({}),roomAllowsSubject:()=>true,crossedTimes:()=>[],slotPolicy:()=>({}),eventSharedResourceIds:()=>[],effectiveEventsForDate:()=>others,isHiddenEvent:()=>false,eventDisplayName:()=> '學生',unique:a=>[...new Set(a)]};
  vm.runInNewContext(fn,context);return Array.from(context.eventConflictReasons(candidate,ignored));
 }
 test(file+': full ledger original does not conflict with its signed calendar overlay',()=>assert.deepEqual(reasons(original,[signed]),[]));
 test(file+': genuine separate course with identical people and slot still conflicts',()=>assert.equal(reasons(original,[{...signed,sourceCourseId:'another-course'}]).length,3));
 test(file+': adding a course must not ignore an existing occurrence',()=>assert.equal(reasons({...original,id:''},[signed],[]).length,3));
 test(file+': same series at an overlapping different start still conflicts',()=>assert.equal(reasons(original,[{...signed,start:'17:30'}]).length,3));
 test(file+': different subject or group members are not aliases',()=>{
  assert.equal(reasons(original,[{...signed,subjectId:'piano'}]).length,3);
  assert.equal(reasons(original,[{...signed,studentIds:['student','second']}]).length,3);
 });
 test(file+': editing a lesson excludes its stored original alias',()=>assert.deepEqual(reasons({...original,start:'17:30'},[signed]),[]));
}
