const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('Today reveals the current day including Sunday',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../teacher-course-portal-v8.js'),'utf8');
 const begin=source.indexOf("  document.getElementById('todayWeek').addEventListener"),end=source.indexOf("  document.getElementById('rosterSearch')",begin);
 for(const [day,left] of [['2026-09-08',150],['2026-09-09',300],['2026-09-13',750]]){
  let click;const button={addEventListener:(type,fn)=>click=fn},viewport={scrollLeft:0,scrollWidth:1098,clientWidth:348};
  const context={requestAnimationFrame:fn=>fn(),getComputedStyle:()=>({gridAutoRows:'30px'}),data:{hours:{start:9}},document:{getElementById:id=>id==='todayWeek'?button:{style:{getPropertyValue:()=>150}}},changingWeek:false,weekStart:'2026-08-01',loading(){},todayKey:()=>day,load:async()=>{},updateWeekViewport(){},weekViewport:viewport,addDays:(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10)};
  vm.createContext(context);vm.runInContext(source.slice(begin,end),context);await click();
  assert.equal(context.weekStart,'2026-09-07');assert.equal(viewport.scrollLeft,left);assert.equal(context.changingWeek,false);
 }
});
