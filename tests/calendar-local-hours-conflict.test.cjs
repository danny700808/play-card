const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('operations-course-inline-runtime.js','utf8');
const fn=source.slice(source.indexOf('  function eventConflictReasons('),source.indexOf('  function eventDisplayName('));
function reasons(hours,others=[],policy={}) {
 const event={id:'morning',date:'2026-09-24',type:'fixed',start:'10:30',duration:60,roomId:'guitar',teacherId:'teacher',studentIds:['student'],subjectId:'guitar'};
 const context={state:{dataMode:'live'},scheduleHoursForDate:()=>hours,isNonOccupyingEvent:()=>false,timeToMin:s=>Number(s.slice(0,2))*60+Number(s.slice(3)),numberOf:Number,roomById:()=>({}),roomAllowsSubject:()=>true,crossedTimes:()=>['10:30','11:00'],slotPolicy:()=>policy,eventSharedResourceIds:()=>[],effectiveEventsForDate:()=>[event,...others],isHiddenEvent:()=>false,eventDisplayName:()=> '另一堂課',unique:a=>[...new Set(a)]};
 vm.runInNewContext(fn,context);
 return Array.from(context.eventConflictReasons(event,[event.id]));
}
test('morning course has identical conflict result across device display preferences',()=>{
 for(const hours of [{start:750,end:1260,closed:false},{start:600,end:1260,closed:false},{start:750,end:1260,closed:true}])assert.deepEqual(reasons(hours),[]);
});
test('real room, teacher and student overlaps still report conflicts',()=>{
 const result=reasons({},[{id:'other',start:'11:00',duration:60,roomId:'guitar',teacherId:'teacher',studentIds:['student']}]);
 assert.equal(result.length,3);for(const name of ['教室','老師','學生'])assert.ok(result.some(r=>r.startsWith(name)));
});
test('shared room closure stays enforced and adjacent courses do not overlap',()=>{
 assert.equal(reasons({},[],{blockSchedule:true}).length,2);
 assert.deepEqual(reasons({},[{id:'next',start:'11:30',duration:60,roomId:'guitar',teacherId:'teacher',studentIds:['student']}]),[]);
});
