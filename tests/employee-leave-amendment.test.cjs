const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('firebase-client.js','utf8');
const part = (from,to) => source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));
const lines = [
  part('  function stableHash(text){ let h=2166136261', '  function safeId(text){ return clean(text).replace'),
  part('  function leaveDocFromPayload(', '  async function linkedCorrections('),
  part('  async function reviewLeaveFlow(', '  function leaveCoveredClockIds('),
  part('  function restoreLeaveEffect(', '  function leaveReplacementPlan(')
].join('\n');

function harness(status='已核准'){
  const date='2026-11-27',employeeId='test-worker';
  const seg=(startTime,endTime)=>({date,startTime,endTime,allDay:false,hours:1.5});
  const records=new Map([['leaveRequests/old',{requestId:'old',employeeId,status,reason:'事假',segments:[seg('18:00','19:30')],segmentSummaryText:'18:00–19:30'}]]);
  const col=name=>({doc:id=>name+'/'+id});
  const database={collection:col,runTransaction:async fn=>{
    const writes=[];
    const result=await fn({get:async key=>({exists:records.has(key),data:()=>records.get(key)}),
      set:(key,row)=>writes.push([key,row])});
    for(const [key,row] of writes)records.set(key,{...records.get(key),...row});
    return result;
  }};
  const ctx={PENDING:'待審核',APPROVED:'已核准',REJECTED:'已駁回',VERSION:'test',db:()=>database,
    clean:v=>String(v??'').trim(),lower:v=>String(v??'').toLowerCase(),serverTs:()=>42,employeeIdFrom:p=>p?.userId||employeeId,
    currentUser:()=>({id:employeeId}),segmentText:s=>s.startTime+'–'+s.endTime,statusOf:r=>r.status,
    normalizeLeave:r=>({...r,raw:r,payFactor:0}),findDirectOrQuery:async(c,id)=>records.has(c+'/'+id)?{...records.get(c+'/'+id),__id:id}:null,
    getPayMode:async()=>'無薪',payFactor:()=>0,enrichRequestedSegments:async(id,p)=>p.segments,validateNewLeave:async()=>{},
    queueNotification:async()=>{},linkedCorrections:async()=>[],rowsByEmployee:async()=>[],effectiveScheduleInfo:async()=>({clockRecords:[]}),
    employeeRow:async()=>({}),employeeType:()=>'parttime',hourlyRateOf:()=>200,leaveReplacementPlan:()=>[],normalizeClock:r=>r,isActiveRow:()=>true,reconcileAttendance:async()=>{}};
  vm.runInNewContext(lines,ctx);
  const edit=(id,expectedStatus,expectedVersion=0)=>ctx.submitLeaveFlow('modifyLeaveRequest',{userId:employeeId,requestId:id,expectedStatus,expectedVersion,
    reason:'事假',note:'更正時間',segments:[seg('19:30','21:00')],singleDayFlow:true,leaveReplacementAcknowledged:true});
  const review=(id,decision,expectedVersion=0)=>ctx.reviewLeaveFlow({requestId:id,decision,expectedVersion});
  return {edit,review,records,ctx};
}

test('already approved hours remain effective until the corrected hours are approved',async()=>{
  const {edit,review,records}=harness();
  const change=await edit('old','已核准');
  assert.equal(change.ok,true,change.message);
  assert.equal(records.get('leaveRequests/old').status,'已核准');
  assert.equal(records.get('leaveRequests/'+change.requestId).status,'待審核');
  assert.equal((await edit('old','已核准')).ok,false);
  const decision=await review(change.requestId,'approve');
  assert.equal(decision.ok,true,decision.message);
  const active=[...records].filter(([key,row])=>key.startsWith('leaveRequests/')&&row.status==='已核准');
  assert.equal(active.length,1);
  assert.equal(active[0][1].startTime,'19:30');assert.equal(active[0][1].endTime,'21:00');
  assert.equal((await review(change.requestId,'approve')).ok,false);
});
test('rejection keeps the approved leave and a new correction can then be requested',async()=>{
  const {edit,review,records}=harness();
  const change=await edit('old','已核准');
  assert.equal((await review(change.requestId,'reject')).ok,true);
  assert.equal(records.get('leaveRequests/old').status,'已核准');
  assert.equal(records.get('leaveRequests/old').segments[0].startTime,'18:00');
  assert.equal((await edit('old','已核准',1)).ok,true);
});
test('pending edits invalidate stale employee forms and stale manager decisions',async()=>{
  const {edit,review}=harness('待審核');
  assert.equal((await edit('old','待審核')).ok,true);
  assert.equal((await edit('old','待審核')).ok,false);
  assert.equal((await review('old','approve')).ok,false);
  assert.equal((await review('old','approve',1)).ok,true);
  assert.equal((await edit('old','待審核',1)).ok,false);
});
test('restore only attendance and pay affected by the old leave',()=>{
  const {ctx}=harness();
  const row={leaveReplacementIds:['old'],attendanceSupersededByLeave:true,leaveOriginalHours:4,leaveOriginalGrossPay:800};
  assert.equal(ctx.restoreLeaveEffect(row,'old','parttimeRecords').totalHours,4);
  assert.equal(ctx.restoreLeaveEffect(row,'old','parttimeRecords').grossPay,800);
  assert.equal(Object.keys(ctx.restoreLeaveEffect(row,'other','parttimeRecords')).length,0);
});
