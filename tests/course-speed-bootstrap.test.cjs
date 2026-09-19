'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const backend=fs.readFileSync('functions/coursePortal.js','utf8');
const runtime=fs.readFileSync('operations-course-inline-runtime.js','utf8');
const clean=value=>String(value||''),addDays=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
function bootstrapFixture(changed=false){
  let reads=0;const ranges=[];
  const context={clean,dateKey:value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value:'',addDays,HttpsError:class extends Error{constructor(code,msg){super(msg);this.code=code;}},readScheduleVersion:async()=>changed?++reads:4,
    db:{collection:name=>{assert.equal(name,'opsSettings');return {doc:()=>({get:async()=>({exists:true,data:()=>({status:'success',sourceRunId:'run'})})})};}},
    scheduleBundle:async(start,end,teacher,options)=>{ranges.push({start,end,teacher,options});return {rooms:[{id:'room'}],students:[],subjects:[],teachers:[],managerEvents:[],irregularModes:[]};}};
  const start=backend.indexOf('async function managerCalendarBootstrap(');vm.runInNewContext(backend.slice(start,backend.indexOf('\nfunction registerCoursePortal',start)),context);
  return {context,ranges};
}
test('initial calendar covers exactly previous, current and next weeks without financial history',async()=>{
  const f=bootstrapFixture(),payload=await f.context.managerCalendarBootstrap({anchorDate:'2026-09-18'});
  assert.equal(payload.calendarRange.startDate,'2026-09-07');assert.equal(payload.calendarRange.endDate,'2026-09-27');
  assert.equal(payload.dataQuality.auditCoveredDates.length,21);assert.equal(f.ranges[0].options.adminDelta,true);
  for(const field of ['tuitionPeriods','attendance','teacherPayroll','teacherAdjustments'])assert.equal(payload[field],undefined);
  assert.equal(payload.events.length,0,'an authoritative empty calendar is valid');
});
test('a changed schedule version cannot be published as a complete calendar snapshot',async()=>{
  await assert.rejects(bootstrapFixture(true).context.managerCalendarBootstrap({anchorDate:'2026-09-18'}),error=>error.code==='aborted');
  await assert.rejects(bootstrapFixture().context.managerCalendarBootstrap({anchorDate:'invalid'}),error=>error.code==='invalid-argument');
});
test('calendar bootstrap retains manager authorization before any data access',async()=>{
  let reads=0;const exports={};
  const HttpsError=class extends Error{constructor(code,msg){super(msg);this.code=code;}};
  const require=name=>{
    if(name==='firebase-functions/v2/https')return {HttpsError,onCall:(_options,handler)=>handler};
    if(name==='firebase-admin')return {apps:[{}],firestore:()=>({collection:()=>({doc:()=>({})})})};
    if(name==='./coursePortal')return {managerCalendarBootstrap:async()=>{reads++;return {ok:true};}};
    if(name==='./portalReadContext')return {withPortalReads:handler=>handler};
    if(name==='./courseOperationTiming')return {withOperationTiming:(_n,_r,handler)=>handler};
    throw Error(name);
  };
  const module={exports:{}};vm.runInNewContext(fs.readFileSync('functions/injiaoyunEducationAutoRead.js','utf8'),{require,module,console,URL});
  module.exports.registerInjiaoyunEducationAutoRead(exports);
  await assert.rejects(exports.loadInjiaoyunEducationMirrorAutoTaiwan({data:{scope:'calendar-bootstrap'}}),error=>error.code==='permission-denied');assert.equal(reads,0);
  await exports.loadInjiaoyunEducationMirrorAutoTaiwan({auth:{token:{manager:true}},data:{scope:'calendar-bootstrap'}});assert.equal(reads,1);
});
test('client marks bounded calendar data as partial and does not expand full historical recurrence',()=>{
  const window={};vm.runInNewContext(fs.readFileSync('course-scheduler-data.js','utf8'),{window});
  const state=window.YouziCoursePreviewData.buildState({scope:'calendar-bootstrap',calendarRange:{startDate:'2026-09-07',endDate:'2026-09-27'},rooms:[{id:'r'}],events:[{id:'in',date:'2026-09-18',roomId:'r',start:'10:00'},{id:'out',date:'2026-08-18',roomId:'r',start:'10:00'}]},'2026-09-18');
  assert.equal(state.dataMeta.partial,true);assert.deepEqual(Array.from(state.events,row=>row.id),['in']);assert.equal(state.readOnly,true);
});
function runtimeFixture(){
  const calls=[],nodes=new Map();let next;
  const $=id=>{if(!nodes.has(id))nodes.set(id,{classList:{add(){},remove(){}},textContent:'',disabled:false});return nodes.get(id);};
  const context={workspaceLoadPromise:null,calendarBootstrapLoading:false,loadingMigration:false,operationRunning:false,workspaceSaveTimer:0,currentView:'calendar',state:{currentDate:'2026-09-18',dataMeta:{}},$,clean,clearTimeout,
    closeModal(){},updateModeUI(){},todayKey:()=> '2026-09-18',isReadOnly:()=>context.state.readOnly===true,toast:(...args)=>calls.push(['toast',...args]),
    clone:value=>JSON.parse(JSON.stringify(value)),normalizeState:value=>value,preserveWorkspaceConfiguration:value=>value,refreshFormOptions(){},switchView(){},
    applyFormalState:async loaded=>{calls.push(['persist']);context.state=loaded;context.state.readOnly=false;},window:{YouziCoursePreviewData:{loadPublished:options=>{calls.push(['load',options]);return new Promise(resolve=>{next=resolve;});}}}};
  const start=runtime.indexOf('  function calendarPartial()'),end=runtime.indexOf('  function bindEvents(){',start);vm.runInNewContext(runtime.slice(start,end),context);
  return {context,calls,nodes,resolve:data=>next(data)};
}
test('partial startup never replaces the persisted ledger and detail requests share one full load',async()=>{
  const f=runtimeFixture(),c=f.context;
  const initial=c.loadPublishedWorkspace({calendarOnly:true});f.resolve({currentDate:'2026-09-18',dataMeta:{partial:true,rangeStart:'2026-09-07',rangeEnd:'2026-09-27'},events:[]});await initial;
  assert.equal(c.state.readOnly,true);assert(!f.calls.some(row=>row[0]==='persist'));
  let opened=0;c.afterWorkspaceReady(()=>opened++);c.afterWorkspaceReady(()=>opened++);
  assert.equal(f.calls.filter(row=>row[0]==='load').length,2);assert.equal(opened,0);
  f.resolve({currentDate:'2026-09-18',dataMeta:{partial:false},tuitionPeriods:[{id:'paid-period',transactions:[{amount:2800}]}]});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(opened,2);assert.equal(f.calls.filter(row=>row[0]==='persist').length,1);assert.equal(c.state.tuitionPeriods[0].transactions[0].amount,2800);
});
test('navigation beyond a partial calendar shows loading and does not display a false empty day',async()=>{
  const f=runtimeFixture(),c=f.context;c.state.dataMeta={partial:true,rangeStart:'2026-09-07',rangeEnd:'2026-09-27'};
  let renders=0;assert.equal(c.calendarRangeReady('2026-10-01','2026-10-01','grid',()=>renders++),false);
  assert.match(f.nodes.get('grid').textContent,/正在讀取/);assert.equal(renders,0);
  assert.equal(f.calls.find(row=>row[0]==='load')[1].calendarOnly,true);
  assert.equal(f.calls.find(row=>row[0]==='load')[1].anchorDate,'2026-10-01');
  f.resolve({currentDate:'2026-10-01',dataMeta:{partial:false},events:[]});await new Promise(resolve=>setImmediate(resolve));assert.equal(renders,1);
});

test('ledger prefetch starts after calendar paint and a click shares the same pending request',async()=>{
 const f=runtimeFixture(),c=f.context,timers=[];c.window.setTimeout=fn=>timers.push(fn);c.window.document={hidden:false};
 const load=c.loadPublishedWorkspace({calendarOnly:true});f.resolve({dataMeta:{partial:true},events:[]});await load;
 assert.equal(timers.length,1);assert.equal(f.calls.filter(row=>row[0]==='load').length,1);
 timers[0]();let opened=0;c.afterWorkspaceReady(()=>opened++);
 assert.equal(f.calls.filter(row=>row[0]==='load').length,2);
 f.resolve({dataMeta:{partial:false},events:[]});await new Promise(resolve=>setImmediate(resolve));assert.equal(opened,1);
});
