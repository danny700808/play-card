const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('teacher-course-portal-v8.js','utf8');
test('Today and the date picker jump straight to their respective dates',async()=>{
 const handlers={},selected=[];
 const c={document:{getElementById:id=>({addEventListener:(_,fn)=>handlers[id]=fn})},todayKey:()=> '2026-11-22',selectScheduleDay:async date=>selected.push(date)};
 vm.runInNewContext(source.slice(source.indexOf("  document.getElementById('todayWeek').addEventListener"),source.indexOf("  document.getElementById('rosterSearch')")),c);
 await handlers.todayWeek();handlers.scheduleDate({target:{value:'2026-11-29'}});
 assert.deepEqual(selected,['2026-11-22','2026-11-29']);
});
test('rapid day changes leave the latest date in control of the planner',async()=>{
 const requests=[],refreshed=[],nodes={};
 const c={weekStart:'',weekViewport:{scrollTop:100},teacherOperations:{hasPending:()=>false},dayLabel:String,data:{},document:{getElementById:id=>nodes[id]||=( {})},load:()=>new Promise(resolve=>requests.push(resolve)),schedulePlannerViewportSearch:()=>refreshed.push(c.weekStart)};
 vm.runInNewContext(source.slice(source.indexOf('  async function selectScheduleDay'),source.indexOf("  weekViewport.addEventListener('touchstart'")),c);
 const first=c.selectScheduleDay('2026-11-20'),second=c.selectScheduleDay('2026-11-21');
 requests[1](true);await second;requests[0](false);await first;
 assert.deepEqual(refreshed,['2026-11-21']);assert.equal(nodes.scheduleDate.value,'2026-11-21');
});
