'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../teacher-course-portal-v8.js'),'utf8');
const begin=source.indexOf('  function renderWeek()'),end=source.indexOf('\n  function ',begin+10);
function render(status='leave',planning=false,extra=[],past=false){
 const node={dataset:{},parentElement:{scrollLeft:0},innerHTML:''};const event={id:'leave1',own:true,date:'2026-09-16',startTime:'17:00',endTime:'18:00',status};
 const c={activeTab:'schedule',document:{getElementById:()=>node},weekStart:'2026-09-16',data:{events:[event,...extra],hours:{start:17,end:19}},planner:planning?{slots:[{date:'2026-09-16',startTime:'17:00'}]}:null,uniqueEvents:x=>x,addDays:(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10),overlapGroups:events=>events.map(e=>({startTime:e.startTime,endTime:e.endTime,events:[e]})),timeMinutes:t=>Number(t.slice(0,2))*60+Number(t.slice(3)),timeText:n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0'),escapeHtml:String,todayKey:()=> '2026-09-16',dayLabel:String,courseSlotIsPast:()=>past,requestAnimationFrame:()=>{},lessonCard:e=>'<button class="lesson leave" data-event="'+e.id+'">請假紀錄</button>',plannerDurationMinutes:()=>60,continuousTeacherGapMinutes:()=>120,clean:v=>String(v||'')};
 const gapStart=source.indexOf('  function eventBlocksPlannerGap('),gapEnd=source.indexOf('\n  function ',gapStart+10);vm.createContext(c);vm.runInContext(source.slice(gapStart,gapEnd)+'\n'+source.slice(begin,end),c);c.renderWeek();return node.innerHTML;
}
test('leave records keep details and expose both half-hour start slots',()=>{const html=render();assert(html.includes('data-event="leave1"'));for(const time of ['17:00','17:30'])assert(html.includes('data-empty="2026-09-16|'+time+'|'));assert(!html.includes('＋ 排課'));assert(html.includes('margin-right:46%'));});
test('available planner target is exposed over a leave record',()=>{assert(render('leave',true).includes('data-flow-target="2026-09-16|17:00"'));});
test('normal and absent courses still block insertion, including beside a leave record',()=>{for(const status of ['scheduled','attended','absent'])assert(!render(status).includes('data-empty="2026-09-16|17:00|'));assert(!render('leave',false,[{id:'other',own:true,date:'2026-09-16',startTime:'17:00',endTime:'18:00',status:'scheduled'}]).includes('data-empty="2026-09-16|17:00|'));});
test('past leave records offer no new scheduling entry',()=>assert(!render('leave',false,[],true).includes('data-empty="2026-09-16|17:00|')));
module.exports={render};
