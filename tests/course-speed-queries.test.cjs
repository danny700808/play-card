'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('functions/coursePortal.js','utf8');
const extract=name=>{const start=source.indexOf('async function '+name+'(');assert(start>=0);return source.slice(start,source.indexOf('\n}',start)+2);};
const clean=value=>String(value||''),addDays=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
function sessionFixture({active=true,expiry=Date.now()+86400000*20,lastUsed=Date.now(),sliding=true,allowed=true}={}) {
  const writes=[];let checks=0;
  const session={role:'teacher',status:active?'active':'revoked',expiresAt:expiry,lastUsedAt:lastUsed,sliding};
  const context={clean,hash:x=>x,asMillis:x=>Number(x)||0,HttpsError:class extends Error {constructor(code,msg){super(msg);this.code=code;}},PORTAL_SESSION_TTL_MS:86400000*90,
    Timestamp:{fromMillis:x=>x},FieldValue:{serverTimestamp:()=>Date.now()},authorizedBindingsForSession:async()=>{checks++;return allowed?[{}]:[];},
    db:{collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>session}),set:async value=>writes.push(value)})})}};
  vm.runInNewContext(extract('requireSession'),context);return {context,writes,checks:()=>checks};
}
test('frequent session reads still validate access each time without repeated heartbeat writes',async()=>{
  const f=sessionFixture();for(let i=0;i<3;i++)await f.context.requireSession({sessionToken:'s'},['teacher']);
  assert.equal(f.checks(),3);assert.equal(f.writes.length,0);
});
test('revocation and expiry still reject immediately and do not extend access',async()=>{
  for(const options of [{active:false},{expiry:Date.now()-1},{allowed:false}]){
    const f=sessionFixture(options);await assert.rejects(f.context.requireSession({sessionToken:'s'},['teacher']));
    assert(!f.writes.some(row=>row.expiresAt));
  }
});
test('idle or nearly expired sliding sessions refresh; fixed expiry remains fixed',async()=>{
  for(const options of [{lastUsed:Date.now()-6*60000},{expiry:Date.now()+60000}]){
    const f=sessionFixture(options);await f.context.requireSession({sessionToken:'s'},['teacher']);assert.equal(f.writes.length,1);assert(f.writes[0].expiresAt>Date.now()+86400000);
  }
  const f=sessionFixture({sliding:false,lastUsed:0});await f.context.requireSession({sessionToken:'s'},['teacher']);assert.equal(f.writes[0].expiresAt,undefined);
});
test('all monthly payroll sources receive the authorized teacher filter; manager queries remain complete',async()=>{
  const calls=[],refreshed=[],read=async(...args)=>{calls.push(args);return [];};
  const context={clean,refreshPayrollPeriodLinks:async rows=>{refreshed.push(rows);return rows;},teacherPayrollMonthBounds:()=>({month:'2026-09',startDate:'2026-09-01',endDate:'2026-09-30'}),mirrorRowsByDateRange:read,portalRowsByDateRange:read,ATTENDANCE_PAYROLL:'payroll',ATTENDANCE_CANCELLATIONS:'cancellations',enrichTeacherPayrollRows:r=>r,mergeTeacherPayrollRows:(a,b)=>a.concat(b),mergeTeacherAdjustmentRows:(a,b)=>a.concat(b),eventDate:r=>r.date};
  vm.runInNewContext(extract('teacherPayrollMonthData'),context);
  await context.teacherPayrollMonthData('2026-09','teacher-a');assert.equal(calls.length,6);assert.equal(refreshed.length,1);
  assert(calls.every((args,i)=>(i<3?args[3].teacherId:args[3])==='teacher-a'));
  calls.length=0;await context.teacherPayrollMonthData('2026-09');assert(calls.every((args,i)=>(i<3?args[3].teacherId:args[3])===''));
});
test('date query index fallback retains the teacher constraint and transient errors do not scan collections',async()=>{
  for(const mirror of [true,false])for(const code of [9,'unavailable']){
    const queries=[];let attempts=0;
    const db={collection:name=>query(name,[])};
    function query(name,filters){return {where:(...filter)=>query(name,filters.concat([filter])),get:async()=>{queries.push({name,filters});if(++attempts===1)throw Object.assign(Error('query'),{code});return {docs:[]};}};}
    const context={clean,addDays,db,console:{warn(){}},dateKey:x=>x,jsonValue:x=>x,asMillis:()=>0,MIRROR:{teacherPayroll:'mirror'},projectCourseGroups:(_type,rows)=>rows,readCourseGroups:async()=>[],eventDate:r=>r.date};
    const name=mirror?'mirrorRowsByDateRangeUncached':'portalRowsByDateRange';vm.runInNewContext(extract(name),context);
    const result=context[name](mirror?'teacherPayroll':'payroll','2026-09-01','2026-09-30',mirror?{teacherId:'t'}:'t');
    if(code===9)await result;else await assert.rejects(result);
    assert.equal(queries.length,code===9?2:1);assert(queries.every(row=>row.filters.some(([key,op,value])=>key===(mirror?'source.teacherId':'teacherId')&&op==='=='&&value==='t')));
  }
});
test('nested operation timings emit one safe record with the inner stages',async()=>{
  const rows=[],{createOperationTiming}=require('../functions/courseOperationTiming'),timing=createOperationTiming({log:row=>rows.push(row)});
  const inner=timing.withOperationTiming('inner','asia-east1',()=>timing.timeOperationStage('read',async()=>42));
  assert.equal(await timing.withOperationTiming('outer','asia-east1',inner)({sessionToken:'private'},{}),42);
  assert.equal(rows.length,1);assert.equal(rows[0].stages[0].stage,'read');assert(!JSON.stringify(rows).includes('private'));
});
