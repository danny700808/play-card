'use strict';
const { chromium, webkit }=require('playwright');
const fs=require('fs'),assert=require('node:assert/strict');
const source=fs.readFileSync('operations-course-inline-runtime.js','utf8');
const logic=source.slice(source.indexOf('  var mobileCalendarPages='),source.indexOf('\n  function fillSelect(',source.indexOf('  var mobileCalendarPages=')));
(async()=>{
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
  let browser;try{browser=await engine.launch({headless:true});}catch(e){if(name==='webkit'){console.log('WebKit unavailable: '+e.message.split('\n')[0]);continue;}throw e;}
  for(const width of [320,390,430]){
   const page=await browser.newPage({viewport:{width,height:844},hasTouch:true,isMobile:true});
   await page.setContent('<style>'+fs.readFileSync('course-scheduler.css','utf8')+'\n'+fs.readFileSync('operations-mobile-admin.css','utf8')+'</style><div class="course-inline-body"><div class="form-grid"><div class="field"><label>日期</label><input type="date" value="2026-09-22"></div><div class="field"><label>開始時間</label><input type="time" value="15:00"></div><div class="field"><input type="month" value="2026-09"></div></div><div id="mobileCalendarNav"></div><div id="scheduleScroll" class="schedule-scroll"><div id="scheduleGrid" class="schedule-grid"></div></div></div>');
   await page.evaluate(()=>{
    window.$=id=>document.getElementById(id);window.mobileAdmin=()=>true;window.weekMode=false;window.state={currentDate:'2026-09-22'};
    window.calendarRooms=()=>Array.from({length:9},(_,i)=>({id:String(i)}));
    window.scheduleHoursForDate=()=>({start:600,end:1260});window.effectiveEventsForDate=()=>[{roomId:'0',start:'15:00',duration:60},{roomId:'7',start:'18:00',duration:60}];
    window.timeToMin=t=>Number(t.split(':')[0])*60+Number(t.split(':')[1]);window.numberOf=Number;
    let html='<div class="grid-corner" style="grid-row:1;grid-column:1">時間</div>';
    for(let i=0;i<9;i++)html+='<div class="room-head" style="grid-row:1;grid-column:'+(i+2)+'">教室'+i+'</div>';
    for(let row=0;row<22;row++)for(let col=0;col<10;col++)html+='<div class="'+(col?'slot':'time-label')+'" style="grid-row:'+(row+2)+';grid-column:'+(col+1)+'">'+(col?'':row)+'</div>';
    $('scheduleGrid').innerHTML=html;
   });
   await page.addScriptTag({content:logic+'\nfitMobileCalendar();bindMobileCalendar();'});
   const layout=await page.evaluate(()=>({dates:[...document.querySelectorAll('input')].map(n=>({right:n.getBoundingClientRect().right,parent:n.parentElement.getBoundingClientRect().right,width:n.getBoundingClientRect().width})),pages:mobileCalendarPages,scrollWidth:$('scheduleScroll').scrollWidth,clientWidth:$('scheduleScroll').clientWidth}));
   for(const r of layout.dates)assert(r.right<=r.parent+.5&&r.width>0,`${name} ${width}: date overflow`);
   assert.equal(layout.pages.x.length,2);assert(Math.abs(layout.scrollWidth-layout.clientWidth-layout.pages.x[1])<2);
   async function swipe(dx,dy,cancel=false){
    await page.evaluate(({dx,dy,cancel})=>{
     const el=$('scheduleScroll');
     function emit(type,x,y){const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:type==='touchend'||type==='touchcancel'?[]:[{clientX:x,clientY:y}]});el.dispatchEvent(e);}
     emit('touchstart',200,200);emit('touchmove',200+dx,200+dy);emit(cancel?'touchcancel':'touchend',200+dx,200+dy);
    },{dx,dy,cancel});await page.waitForTimeout(650);
    return page.evaluate(()=>({left:$('scheduleScroll').scrollLeft,top:$('scheduleScroll').scrollTop}));
   }
   let pos=await swipe(-100,-35);assert(Math.abs(pos.left-layout.pages.x[1])<2);assert.equal(pos.top,0);
   pos=await swipe(12,2);assert(Math.abs(pos.left-layout.pages.x[1])<2);
   pos=await swipe(100,25);assert.equal(pos.left,0);
   pos=await swipe(-25,-140);assert.equal(pos.left,0);assert(Math.abs(pos.top-layout.pages.y[1])<2);
   pos=await swipe(90,5,true);assert.equal(pos.left,0);
   console.log(`${name} ${width}: date bounds, two room pages, diagonal lock, short swipe, reverse, vertical page, cancellation passed`);
   await page.close();
  }await browser.close();
 }
})().catch(e=>{console.error(e);process.exit(1)});
