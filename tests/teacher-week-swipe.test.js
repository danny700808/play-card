'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
test('only explicit week navigation changes weeks and retains time position',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../teacher-course-portal-v8.js'),'utf8');const listeners={};
 const viewport={scrollLeft:900,scrollWidth:1200,clientWidth:300,scrollTop:220,addEventListener:(name,fn)=>{listeners[name]=fn;}};
 const buttons=new Map();const button=id=>{if(!buttons.has(id))buttons.set(id,{disabled:false,classList:{add(){},remove(){}},setAttribute(){},removeAttribute(){}});return buttons.get(id);};
 let loads=0;const context={document:{querySelector:()=>viewport,getElementById:button},weekStart:'2026-09-21',planner:null,load:async()=>{loads++;},startSourceMove:async()=>{},addDays:(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10)};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf("  const weekViewport = document.querySelector('[data-two-day-viewport]');"),source.indexOf("  weekViewport.addEventListener('scroll',")),context);
 assert.equal(listeners.touchstart,undefined);assert.equal(listeners.touchend,undefined);assert.equal(loads,0);
 await context.navigateTeacherWeek(1);assert.equal(context.weekStart,'2026-09-28');assert.equal(viewport.scrollLeft,0);assert.equal(viewport.scrollTop,220);
 await context.navigateTeacherWeek(-1);assert.equal(context.weekStart,'2026-09-21');assert.equal(loads,2);assert([...buttons.values()].every(b=>!b.disabled));
});
