const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
for(const file of ['course-scheduler.js','operations-course-inline-runtime.js']){
 const source=fs.readFileSync(file,'utf8');
 const roomFn=source.slice(source.indexOf('  function roomAllowsSubject('),source.indexOf('  function updateRoomOptions('));
 const fn=source.slice(source.indexOf('  function eventConflictReasons('),source.indexOf('  function eventDisplayName('));
 function evaluate(candidate,policy={},events=[]){const ctx={clean:v=>String(v||''),roomKindOf:()=>'normal',roomPianoType:()=>'none',state:{},Set,scheduleHoursForDate:()=>({start:0,end:1440,closed:false}),isNonOccupyingEvent:()=>false,timeToMin:()=>780,numberOf:Number,roomById:()=>({allowedSubjectIds:['piano']}),subjectById:()=>({name:'吉他'}),crossedTimes:()=>['13:00'],slotPolicy:()=>policy,eventSharedResourceIds:()=>[],effectiveEventsForDate:()=>events,isHiddenEvent:()=>false,eventDisplayName:()=> '既有課程',unique:v=>[...new Set(v)]};vm.createContext(ctx);vm.runInContext(roomFn+fn,ctx);return Array.from(ctx.eventConflictReasons({type:'fixed',start:'13:00',duration:60,roomId:'room',studentIds:[],...candidate},[]));}
 test(file+': incomplete subject does not create a restriction conflict',()=>{assert.deepEqual(evaluate({subjectId:''},{subjectIds:['piano']}),[]);});
 test(file+': selected incompatible subject remains blocked',()=>{assert.equal(evaluate({subjectId:'guitar'},{subjectIds:['piano']}).length,2);assert.deepEqual(evaluate({subjectId:'piano'},{subjectIds:['piano']}),[]);});
 test(file+': missing subject still detects closed slots and occupied rooms',()=>{assert.equal(evaluate({subjectId:''},{blockSchedule:true}).length,1);assert.equal(evaluate({subjectId:''},{},[{id:'existing',roomId:'room',start:'13:00',duration:60}]).length,1);});
 test(file+': rental ignores subject restrictions but retains rental closure',()=>{assert.deepEqual(evaluate({type:'rental'},{subjectIds:['piano']}),[]);assert.equal(evaluate({type:'rental'},{blockRental:true}).length,1);});
}
