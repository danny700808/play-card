const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('operations-course-inline-runtime.js','utf8');
const start=source.indexOf('  function calendarDisplayHours(');
const context={timeToMin:s=>Number(s.slice(0,2))*60+Number(s.slice(3)),numberOf:v=>Number(v)||0,isHiddenEvent:e=>e.hidden===true};
vm.runInNewContext(source.slice(start,source.indexOf('  function renderCalendar(',start)),context);
const hours={start:750,end:1260,closed:false};
test('10:30 lesson is visible even when this device starts the calendar at 12:30',()=>{
 const result=context.calendarDisplayHours(hours,[{start:'10:30',duration:60}]);
 assert.equal(result.start,630);assert.equal(result.end,1260);assert.equal(hours.start,750);
});
test('late lessons and half-hour rounding keep the whole course visible',()=>{
 const result=context.calendarDisplayHours(hours,[{start:'21:00',duration:60},{start:'10:15',duration:60}]);
 assert.equal(result.start,600);assert.equal(result.end,1320);
});
test('closed-day existing lessons remain visible without changing scheduling settings',()=>{
 const closed={...hours,closed:true};assert.equal(context.calendarDisplayHours(closed,[{start:'10:30',duration:60}]).closed,false);
 assert.equal(closed.closed,true);assert.equal(context.calendarDisplayHours(closed,[]).closed,true);
});
test('empty, hidden and invalid events do not widen the calendar',()=>{
 const result=context.calendarDisplayHours(hours,[{start:'bad',duration:60},{start:'10:30',duration:0},{start:'10:30',duration:60,hidden:true}]);
 assert.equal(result.start,750);assert.equal(result.end,1260);
});
