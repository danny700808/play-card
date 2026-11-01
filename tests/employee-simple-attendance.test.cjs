'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{JSDOM}=require('jsdom');
const view=require('../employee-attendance-view'),leave=require('../employee-single-day-leave'),{createScheduleComputer}=require('../functions/employeeAttendanceSchedule');
const date='2026-10-27';
test('daily overview keeps the first in and last out, retains distinct temporary work, and orders in before out',()=>{
 const input=[{id:'in',date,time:'18:00:11',actionName:'上班打卡'},{id:'out',date,time:'21:02:01',actionName:'下班打卡'},{id:'tin',date,time:'17:30:00',actionName:'上班打卡',clockType:'臨時出勤'},{id:'tout',date,time:'18:00:00',actionName:'下班打卡',clockType:'臨時出勤'}],before=JSON.stringify(input);
 const [day]=view.days([...input,input[0]]);assert.deepEqual(day.main.map(r=>r.id),['tin','out']);assert.deepEqual(new Set(day.extra.map(r=>r.id)),new Set(['in','tout']));assert(day.temporary);assert.equal(JSON.stringify(input),before);
 const half=view.days([{...input[0],date:'2026-10-29'},{date:'2026-10-29',actionName:'下班打卡',missing:true,status:'未打卡',attendanceNeedsReview:true}])[0];assert(!half.absent);assert(!half.unconfirmed);assert.equal(half.main[1].status,'未打卡');
 const blank=view.days([{date,actionName:'上班打卡',missing:true,status:'未打卡',attendanceNeedsReview:true},{date,actionName:'下班打卡',missing:true,status:'未打卡',attendanceNeedsReview:true}])[0];assert(!blank.absent);assert(blank.unconfirmed);
});
test('partial leave options remain inside a contiguous scheduled interval and exclude reversed times',()=>{
 const shifts=[{startTime:'09:00',endTime:'12:00'},{startTime:'14:00',endTime:'17:00'}];
 assert(!leave.timeOptions(shifts).includes('13:00'));assert.deepEqual(leave.timeOptions(shifts,'11:30'),['12:00']);assert.deepEqual(leave.timeOptions(shifts,'16:30'),['17:00']);assert.deepEqual(leave.timeOptions(shifts,'17:00'),[]);
});
function modal(){const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=dom.window;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.onclose?.()};w.eval(fs.readFileSync('employee-single-day-leave.js','utf8'));return{dom,w};}
test('whole-day request requires conflict confirmation; cancel changes nothing and confirmation submits only one day',async()=>{
 const {dom,w}=modal(),calls=[],options={date,shifts:[{startTime:'18:00',endTime:'21:00'}],userId:'e1',api:async(a,p)=>{calls.push({a,p});return a==='getLeaveReplacementImpact'?{ok:true,requiresConfirmation:true,rows:[{clocks:[{replaced:true}]}]}:{ok:true};}};
 const d=w.EmployeeSingleDayLeave.open(options),form=d.querySelector('form');form.elements.reason.value='事假';form.elements.note.value='家庭事務';let warning='';w.confirm=text=>{warning=text;return false;};
 await form.onsubmit({preventDefault(){}});assert.deepEqual(calls.map(c=>c.a),['getLeaveReplacementImpact']);assert.match(warning,/主管核准整天請假後/);assert(d.open);assert.equal(d.querySelectorAll('[data-mode]').length,2);assert.equal(d.querySelectorAll('input[type=date]').length,0);
 w.confirm=()=>true;await form.onsubmit({preventDefault(){}});const sent=calls[calls.length-1];assert.equal(sent.a,'leaveRequest');assert.equal(sent.p.segments.length,1);assert.equal(sent.p.segments[0].startDate,date);assert.equal(sent.p.segments[0].endDate,date);assert.equal(sent.p.segments[0].mode,'schedule');assert(sent.p.leaveReplacementAcknowledged);assert(sent.p.singleDayFlow);dom.window.close();
});
test('single-day exclusion skips only the named date, retaining the recurring assignment and neighboring workdays',async()=>{
 const assignment={employeeId:'e1',assignmentId:'regular',templateId:'t',enabled:true,startDate:'2026-05-26',indefinite:true,excludedDates:['2026-10-23']};
 const template={templateId:'t',enabled:true,thursdayType:'標準打卡',thursdayStartTime:'18:00',thursdayEndTime:'21:00',fridayType:'標準打卡',fridayStartTime:'18:00',fridayEndTime:'21:00'};
 const compute=createScheduleComputer({employeeSchedules:[assignment],scheduleTemplates:[template]},new Date('2026-11-01T12:00:00+08:00'));
 assert.equal((await compute.day({employeeId:'e1'},'2026-10-23')).schedules.length,0);
 for(const d of ['2026-10-22','2026-10-30']){const r=await compute.day({employeeId:'e1'},d);assert.equal(r.schedules.length,1);assert.match(r.schedules[0].scheduleKey,/regular/);}
});
test('approved temporary work writes two punches and one doubled payroll row atomically',async()=>{
 const source=fs.readFileSync('firebase-client.js','utf8'),start=source.indexOf('  async function reviewTemporary('),end=source.indexOf('\n  async function ',start+15);
 for(const multiplier of [1,2]){
  const raw={__id:'req',requestId:'req',employeeId:'e1',name:'Test',employeeType:'工讀生',date,startTime:'17:00',endTime:'18:00',hourlyRate:196,status:'待審核',payMultiplier:2},store=new Map([['temporaryAttendanceRequests/req',raw]]);
  const clean=v=>String(v??''),minutes=v=>{const [h,m]=String(v).split(':').map(Number);return h*60+m;};
  const context={clean,lower:v=>clean(v).toLowerCase(),shortTime:v=>clean(v).slice(0,5),dateText:v=>clean(v).slice(0,10),minutes,hoursBetween:(a,b)=>(minutes(b)-minutes(a))/60,statusOf:r=>r.status,PENDING:'待審核',APPROVED:'已核准',REJECTED:'已駁回',VERSION:'test',findDirectOrQuery:async()=>raw,effectiveScheduleInfo:async()=>({schedules:[],originalSchedules:[],leaveRequestBlocks:[]}),rowsByEmployee:async()=>[],currentUser:()=>({id:'manager'}),safeId:clean,serverTs:()=>1,queueNotification:async()=>{},mergeIntervals:r=>r,subtractIntervals:(s,e)=>[[s,e]],rangesOverlap:()=>false,timeOverlap:()=>false};
  context.db=()=>({collection:col=>({doc:id=>({path:col+'/'+id})}),runTransaction:async fn=>{const writes=[];await fn({get:async ref=>({exists:store.has(ref.path),data:()=>store.get(ref.path)}),set:(ref,data)=>writes.push([ref.path,data])});for(const [path,data]of writes)store.set(path,{...store.get(path),...data});}});
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);const result=await context.reviewTemporary({requestId:'req',decision:'approve',payMultiplier:multiplier});assert(result.ok,result.message);assert.equal([...store.keys()].filter(k=>k.startsWith('clockRecords/')).length,2);const payroll=store.get('parttimeRecords/PT_TEMP_req');assert.equal(payroll.totalHours,1);assert.equal(payroll.grossPay,196*multiplier);assert.equal(payroll.payMultiplier,multiplier);
 }
});
