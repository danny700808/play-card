'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
test('horizontal edge swipes cross weeks and retain time position; vertical swipes do not',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../teacher-course-portal-v8.js'),'utf8');const listeners={};
 const viewport={scrollLeft:900,scrollWidth:1200,clientWidth:300,scrollTop:220,addEventListener:(name,fn)=>{listeners[name]=fn;}};
 let loads=0;const context={document:{querySelector:()=>viewport},weekStart:'2026-09-21',planner:null,load:async()=>{loads++;},startSourceMove:async()=>{},addDays:(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10)};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf("  const weekViewport = document.querySelector('[data-two-day-viewport]');"),source.indexOf("  weekViewport.addEventListener('scroll',")),context);
 listeners.touchstart({touches:[{clientX:300,clientY:300}]});await listeners.touchend({changedTouches:[{clientX:100,clientY:305}]});assert.equal(context.weekStart,'2026-09-28');assert.equal(viewport.scrollLeft,0);assert.equal(viewport.scrollTop,220);
 listeners.touchstart({touches:[{clientX:100,clientY:300}]});await listeners.touchend({changedTouches:[{clientX:300,clientY:305}]});assert.equal(context.weekStart,'2026-09-21');assert.equal(viewport.scrollLeft,900);
 listeners.touchstart({touches:[{clientX:300,clientY:300}]});await listeners.touchend({changedTouches:[{clientX:270,clientY:100}]});assert.equal(loads,2);
});
