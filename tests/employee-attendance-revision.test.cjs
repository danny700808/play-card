'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('firebase-client.js','utf8'),payroll=require('../functions/parttimePayrollRules');
function context(){
 const clean=v=>String(v??'').trim(),minutes=v=>{const [h,m]=String(v||'').split(':').map(Number);return h*60+m;};
 const c={clean,minutes,truthy:v=>v===true||v==='是',dateText:v=>String(v||'').slice(0,10),hoursBetween:(s,e)=>(minutes(e)-minutes(s))/60,scheduleRawKey:s=>s.scheduleKey,isActiveRow:r=>!r.attendanceSupersededByLeave&&!['已刪除','已被取代'].includes(r.status),isIndependentTemporaryClock:r=>r.clockType==='臨時出勤'||!!r.raw?.temporaryAttendanceRequestId};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  function leaveCoveredClockIds('),source.indexOf('  async function getLeaveReplacementImpact(')),c);return c;
}
const shift={scheduleKey:'shift-a',startTime:'18:00',endTime:'21:00'};
function info(){return{date:'2026-10-30',originalSchedules:[shift],fullyCoveredSchedules:[shift],schedules:[],leaveBlocks:[{requestId:'leave'}],clockRecords:[{id:'in',date:'2026-10-30',time:'18:10',actionName:'上班打卡',scheduleKey:'shift-a::EFF::1800-2100',status:'遲到',raw:{lateMinutes:10}},{id:'out',date:'2026-10-30',time:'21:10',actionName:'下班打卡',scheduleKey:'shift-a::EFF::1800-2100',status:'正常',raw:{}}]};}
const part={__id:'hours',date:'2026-10-30',totalHours:3,grossPay:600,status:'正常',sourceType:'parttimeScheduleHours'};
test('approved full-shift leave retires both punches including early/late punches and normal hours',()=>{
 const c=context(),plan=c.leaveReplacementPlan(info(),[part]);assert.equal(plan.length,3);const hour=plan.find(p=>p.collection==='parttimeRecords').data;
 assert.equal(hour.totalHours,0);assert.equal(hour.grossPay,0);assert.equal(hour.leaveOriginalHours,3);assert.equal(hour.leaveOriginalGrossPay,600);
 assert.equal(plan[0].data.leaveOriginalLateMinutes,10);assert.equal(plan[0].data.lateMinutes,0);
 assert.equal(payroll.latestEffectiveParttimeRecords([{...part,...hour,id:'hours'}]).length,0);
 const employee={id:'e1',employeeId:'e1'};assert.equal(payroll.calculateLate({employee,employees:[employee],hourlyRate:200,clockRows:[{...info().clockRecords[0],...plan[0].data,employeeId:'e1'}]}).lateDeduction,0);
});
test('partial leave caps ordinary hours, preserves temporary work and is idempotent',()=>{
 const c=context(),day=info();day.fullyCoveredSchedules=[];day.schedules=[{...shift,startTime:'19:00'}];
 day.clockRecords.push({id:'temp',clockType:'臨時出勤',time:'21:00'});
 const extra={...part,__id:'temp-hours',sourceType:'temporaryAttendanceApproved',temporaryAttendanceRequestId:'temp',totalHours:1,grossPay:200};
 const plan=c.leaveReplacementPlan(day,[part,extra]);assert.equal(plan.length,1);assert.equal(plan[0].id,'hours');assert.equal(plan[0].data.totalHours,2);assert.equal(plan[0].data.grossPay,400);
 assert.equal(c.leaveReplacementPlan(day,[{...part,...plan[0].data},extra]).length,0);
 day.fullyCoveredSchedules=[shift];day.schedules=[];const full=c.leaveReplacementPlan(day,[part,extra]);assert(!full.some(p=>p.id==='temp'||p.id==='temp-hours'));
});
test('one covered shift does not replace another shift that day',()=>{
 const c=context(),day=info(),other={scheduleKey:'shift-b',startTime:'09:00',endTime:'12:00'};day.originalSchedules.push(other);day.schedules=[other];day.clockRecords.push({id:'morning',scheduleKey:'shift-b',time:'08:55',actionName:'上班打卡'});
 assert.deepEqual(Array.from(c.leaveCoveredClockIds(day)),['in','out']);
});
test('approval commits replacements atomically; rejection and concurrent edits preserve records',async()=>{
 for(const scenario of ['approve','reject','changed']){
  const c=context(),day=info();day.clockRecords.forEach(r=>{r.__id=r.id;r.raw={recordId:r.id,clockTime:r.time,status:r.status,lateMinutes:r.id==='in'?10:0};});
  const leave={requestId:'leave',employeeId:'e1',status:'待審核',segments:[{date:day.date}],payFactor:0,segmentSummaryText:'10/30',raw:{}};
  const store=new Map([['leaveRequests/leave',leave],['clockRecords/in',{...day.clockRecords[0].raw}],['clockRecords/out',{...day.clockRecords[1].raw}],['parttimeRecords/hours',{...part}]]);store.get('parttimeRecords/hours').__id=undefined;
  if(scenario==='changed')store.get('clockRecords/in').clockTime='18:30';
  const db={collection:col=>({doc:id=>({path:col+'/'+id})}),runTransaction:async fn=>{const pending=[];const result=await fn({get:async ref=>({exists:store.has(ref.path),data:()=>store.get(ref.path)}),set:(ref,data)=>pending.push([ref.path,data])});for(const [key,data]of pending)store.set(key,{...store.get(key),...data});return result;}};
  Object.assign(c,{db:()=>db,PENDING:'待審核',APPROVED:'已核准',REJECTED:'已駁回',VERSION:'test',serverTs:()=>1,findDirectOrQuery:async()=>leave,normalizeLeave:r=>({...r,raw:r}),linkedCorrections:async()=>[],currentUser:()=>({id:'manager'}),effectiveScheduleInfo:async()=>day,rowsByEmployee:async()=>[part],employeeRow:async()=>({}),employeeType:()=> 'parttime',hourlyRateOf:()=>200,payFactor:()=>0,statusOf:r=>r.status,reconcileAttendance:async()=>{},queueNotification:async()=>{},safeId:v=>v});
  vm.runInContext(source.slice(source.indexOf('  async function reviewLeaveFlow('),source.indexOf('  function leaveCoveredClockIds(')),c);
  const result=await c.reviewLeaveFlow({requestId:'leave',decision:scenario==='reject'?'reject':'approve'});
  if(scenario==='approve'){assert(result.ok);assert.equal(store.get('leaveRequests/leave').status,'已核准');assert.equal(store.get('parttimeRecords/hours').totalHours,0);assert.equal(store.get('clockRecords/in').status,'已被取代');}
  else {assert.equal(store.get('parttimeRecords/hours').totalHours,3);assert.equal(store.get('clockRecords/in').status,'遲到');assert.equal(result.ok,scenario==='reject');assert.equal(store.get('leaveRequests/leave').status,scenario==='reject'?'已駁回':'待審核');}
 }
});
function page(file,needle){const html=fs.readFileSync(file,'utf8'),dom=new JSDOM(html,{url:'https://example.test/'+file,runScripts:'outside-only'}),w=dom.window;w.qs=s=>w.document.querySelector(s);w.qsa=s=>[...w.document.querySelectorAll(s)];w.requireLogin=()=>({id:'e1'});w.setMsg=(n,t)=>n.textContent=t;w.eval(fs.readFileSync('employee-attendance-view.js','utf8'));w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.onclose?.()};w.eval([...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes(needle))+(file==='leave.html'?"\nwindow.testReady=()=>{leavePageReady=true;leaveSegmentsState=[{mode:'retro',leaveDate:'2026-10-30',startTime:'18:00',endTime:'21:00'}];};":''));return {dom,w};}
test('no shift hides hours and submit; scheduled day restores them',()=>{
 const {dom,w}=page('parttime.html','function renderDateContext');w.renderHoursGrid();w.renderDateContext({workDate:'2026-11-01',canRegister:false});assert(w.qs('#fieldHours').hidden);assert(w.qs('#submitBtn').hidden);
 w.renderDateContext({workDate:'2026-11-03',canRegister:true});assert.equal(w.qs('#fieldHours').hidden,false);assert.equal(w.qs('#submitBtn').hidden,false);dom.window.close();
});
test('every recent punch offers correction and late status is explicit',()=>{
 const {dom,w}=page('clock.html','function renderHistoryRow');w.pendingAutoReturnText=()=>'';w.renderIntoList('#editableList',[{id:'in',date:'2026-10-30',time:'18:10',actionName:'上班打卡',clockType:'標準打卡',status:'遲到',lateMinutes:10,canModify:false},{id:'out',date:'2026-10-30',time:'21:00',actionName:'下班打卡',status:'正常',canModify:false}],false);
 assert.equal(w.qsa('#editableList [data-ea-correct]').length,2);assert.equal(w.qsa('#editableList .ea-day').length,1);assert.equal(w.qsa('#editableList .ea-day .ea-punch').length,2);assert.match(w.qs('#editableList').textContent,/上班18:10/);assert.match(w.qs('#editableList').textContent,/下班21:00/);assert(w.qs('.ea-alert'));dom.window.close();
});
test('cancelling retroactive leave impact confirmation never submits a leave request',async()=>{
 const {dom,w}=page('leave.html','let leaveSegmentsState');w.testReady();w.validateForm=()=>true;w.validateLeaveClockConflictBeforeSubmit=async()=>({ok:true});const calls=[];w.api=async action=>{calls.push(action);return {ok:true,requiresConfirmation:true,rows:[{date:'2026-10-30',clocks:[{action:'上班打卡',time:'18:00',replaced:true}],hoursRemoved:3}]};};let text='';w.confirm=t=>{text=t;return false;};await w.submitLeave();assert.deepEqual(calls,['getLeaveReplacementImpact']);assert.match(text,/主管核准後/);assert.match(text,/工讀時數減少 3 小時/);dom.window.close();
});


test('approved correction clears stale late payroll minutes and cannot restore leave-replaced punches',async()=>{
 for(const retired of [false,true]){
  const c=context(),request={requestId:'fix',requestKind:'recordCorrection',originalRecordId:'in',employeeId:'e1',correctDate:'2026-10-30',correctTime:'17:59',correctAction:'上班打卡',correctionType:'標準打卡',status:'待審核'};
  const store=new Map([['clockCorrections/fix',request],['clockRecords/in',{employeeId:'e1',clockDate:'2026-10-30',actionName:'上班打卡',clockTime:'18:10',status:retired?'已被取代':'遲到',lateMinutes:10,finalLateMinutes:10,attendanceSupersededByLeave:retired}]]);
  const db={collection:col=>({doc:id=>({path:col+'/'+id})}),runTransaction:async fn=>{const pending=[];await fn({get:async ref=>({exists:store.has(ref.path),data:()=>store.get(ref.path)}),set:(ref,data)=>pending.push([ref.path,data])});for(const [key,data]of pending)store.set(key,{...store.get(key),...data});}};
  Object.assign(c,{db:()=>db,PENDING:'待審核',APPROVED:'已核准',REJECTED:'已駁回',VERSION:'test',serverTs:()=>1,findDirectOrQuery:async()=>request,correctionNorm:r=>r,currentUser:()=>({id:'manager'}),effectiveScheduleInfo:async()=>({schedules:[shift]}),chooseEffectiveSchedule:()=>shift,statusOf:r=>r.status,safeId:v=>v,applyEarlyLeavePayroll:async()=>null,reconcileAttendance:async()=>{},queueNotification:async()=>{}});
  vm.runInContext(source.slice(source.indexOf('  function attendanceState('),source.indexOf('  function companyClockIp(',source.indexOf('  function attendanceState('))),c);
  vm.runInContext(source.slice(source.indexOf('  async function reviewCorrection('),source.indexOf('  async function leaveDateContext(')),c);
  const result=await c.reviewCorrection({requestId:'fix'},true),row=store.get('clockRecords/in');assert.equal(result.ok,!retired,result.message);
  if(retired){assert.equal(row.status,'已被取代');assert.equal(store.get('clockCorrections/fix').status,'待審核');}
  else {assert.equal(row.status,'正常');assert.equal(row.lateMinutes,0);assert.equal(row.finalLateMinutes,0);assert.equal(row.clockTime,'17:59');}
 }
});


test('scheduled blank days show both missing punches without creating records, and exclude leave/temporary coverage',()=>{
 const c=context();Object.assign(c,{PENDING:'待審核',nowMinutes:()=>12*60,statusOf:r=>r.status,temporaryBlockCoversPunch:(b,a,t)=>b.start<=t&&b.end>=t});
 vm.runInContext(source.slice(source.indexOf('  function missingRowsForDay('),source.indexOf('  async function attendanceHistoryWithMissing(')),c);
 const day={date:'2026-10-30',schedules:[{...shift,originalScheduleKey:'shift-a'}]};
 const rows=c.missingRowsForDay(day,[],'2026-11-01');assert.equal(rows.length,2);assert(rows.every(r=>r.status==='未打卡'&&r.attendanceNeedsReview&&r.canModify&&r.missing));assert.equal(rows[0].time,'');
 assert.equal(c.missingRowsForDay({...day,schedules:[]},[],'2026-11-01').length,0);
 assert.equal(c.missingRowsForDay({...day,date:'2026-11-02'},[],'2026-11-01').length,0);
 const pending=c.missingRowsForDay(day,[{status:'待審核',correctDate:day.date,correctAction:'上班打卡',scheduleKey:'shift-a'}],'2026-11-01');assert(pending[0].pendingCorrection);assert.equal(pending[0].canModify,false);
 const temporary=c.missingRowsForDay({...day,approvedTemporaryAttendanceBlocks:[{start:18*60,end:21*60}]},[],'2026-11-01');assert.equal(temporary.length,0);
 const leavePending=c.missingRowsForDay({...day,pendingLeaveBlocks:[{start:18*60,end:21*60}]},[],'2026-11-01');assert(leavePending.every(r=>!r.canModify&&r.status==='請假待審'));
});

test('missing punch opens a reason form and submits a missingClock approval without writing a punch',async()=>{
 const {dom,w}=page('clock.html','function renderHistoryRow');let sent;w.searchRange=async()=>{};
 w.api=async(action,payload)=>{sent={action,payload};return{ok:true,message:'送出'};};
 w.renderIntoList('#editableList',[{id:'missing-in',date:'2026-10-30',missing:true,expectedTime:'18:00',actionName:'上班打卡',clockType:'標準打卡',status:'未打卡',attendanceNeedsReview:true,canModify:true,scheduleSnapshot:shift}],false);
 assert.equal(w.qs('[data-ea-correct]').textContent,'補打卡');assert.match(w.qs('#editableList').textContent,/整天未打卡・待確認/);
 w.qs('[data-ea-correct]').click();const form=w.qs('dialog form');form.elements.reason.value='忘記打卡';await form.onsubmit({preventDefault(){}});
 assert.equal(sent.action,'submitClockCorrection');assert.equal(sent.payload.requestKind,'missingClock');assert.equal(sent.payload.originalRecordId,'');assert.equal(sent.payload.correctTime,'18:00');assert.equal(sent.payload.scheduleKey,'shift-a');dom.window.close();
});
