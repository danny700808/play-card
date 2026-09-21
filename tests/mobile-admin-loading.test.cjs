'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const runtime=fs.readFileSync('operations-course-inline-runtime.js','utf8');
const ops=fs.readFileSync('operations-phase1.js','utf8');
function section(source,start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
test('mobile salary navigation requests a month without waiting for the complete ledger; desktop keeps its existing gate',()=>{
  for(const mobile of [true,false]){
    const calls=[],node={classList:{toggle(){}},textContent:''};
    const ctx={mobileAdmin:()=>mobile,studentHistoryMode:false,afterWorkspaceReady:()=>{calls.push('ledger');return true;},currentView:'calendar',$$:()=>[],$:()=>node,renderTeachers:()=>calls.push('render'),refreshTeacherPayrollMonth:month=>calls.push(month),teacherListMonthKey:()=> '2026-09',embeddedMode:false,window:{scrollTo(){}}};
    vm.runInNewContext(section(runtime,'  function switchView(view){','  function slotPolicy('),ctx);ctx.switchView('teachers');
    assert.deepEqual(calls,mobile?['render','2026-09']:['ledger']);
  }
});
test('mobile room filtering removes holding/video columns without deleting any rooms or changing desktop',()=>{
  const rooms=[{id:'physical',kind:'normal'},{id:'video',kind:'video'},{id:'holding',kind:'holding'}];
  for(const mobile of [true,false]){
    const ctx={mobileAdmin:()=>mobile,activeRooms:()=>rooms,roomKindOf:r=>r.kind,clean:value=>String(value||'')};
    vm.runInNewContext(section(runtime,'  function calendarRooms(){','  function desktopCalendar(){'),ctx);
    assert.deepEqual(Array.from(ctx.calendarRooms(),r=>r.id),mobile?['physical']:['physical','video','holding']);assert.equal(rooms.length,3);
  }
});
function customerHarness(fail=false){
  const reads=[],state={loading:false},calls=[];
  const ctx={state,location:{hash:'#customers'},clearAlert(){},html:(_id,value)=>calls.push(value),loadingHtml:x=>x,emptyHtml:x=>x,showAlert:msg=>calls.push(msg),errorMessage:e=>e.message,requireOperationsReadAuth:async()=>{},loadMembershipSettings:async()=>reads.push('membership'),getCollection:async name=>{reads.push(name);if(fail)throw Error('offline');return [{status:'active'},{status:'voided'}];},loadOperationDatasets:async(items,read)=>Promise.all(items.map(read)),clean:String,Date,Promise,render:()=>calls.push('render'),ensureDataForCurrentView:()=>{calls.push('next-view');return true;},COLLECTIONS:{customers:'customers',sales:'sales',incomes:'incomes',receivables:'receivables',points:'points'}};
  for(const key of ['Customer','Sale','Income','Receivable','PointTransaction'])ctx['normalize'+key]=x=>x;
  vm.runInNewContext(section(ops,'  async function loadCustomersOnly(silent){','  async function loadAll(silent){'),ctx);
  return {ctx,state,reads,calls};
}
test('customer page reads only its five datasets and settings, preserves counts, and never marks the complete app loaded',async()=>{
  const f=customerHarness();await f.ctx.loadCustomersOnly(false);
  assert.deepEqual(f.reads.sort(),['customers','incomes','membership','points','receivables','sales']);
  assert.equal(f.state.sales.length,1);assert.equal(f.state.incomes.length,1);assert.equal(f.state.customers.length,2);
  assert(f.state.customersLoadedAt);assert.equal(f.state.fullLoadedAt,undefined);assert.equal(f.state.loadedAt,undefined);assert.equal(f.state.loading,false);
});
test('failed customer reads expose retry and do not render unverified empty balances',async()=>{
  const f=customerHarness(true);await f.ctx.loadCustomersOnly(false);
  assert.equal(f.state.customersLoadedAt,undefined);assert(!f.calls.includes('render'));assert(f.calls.includes('無法載入客戶資料'));assert.equal(f.state.loading,false);
});
test('leaving the customer page during loading requests the new view data after completion',async()=>{
  const f=customerHarness();const pending=f.ctx.loadCustomersOnly(false);f.ctx.location.hash='#sales';await pending;
  assert(f.calls.includes('next-view'));assert(!f.calls.includes('render'));
});
test('calendar bootstrap preserves salary month results and selected mobile salary view',()=>{
  const row={id:'paid',date:'2026-09-20',teacherAmount:700},calls=[];
  const ctx={clearTimeout(){},workspaceSaveTimer:0,mobileAdmin:()=>true,state:{teacherPayroll:[row],teacherAdjustments:[],dataMeta:{teacherPayrollMonths:{'2026-09':{count:1}}}},normalizeState:x=>x,preserveWorkspaceConfiguration:x=>x,clone:structuredClone,updateModeUI(){},refreshFormOptions(){},switchView:v=>calls.push(v),currentView:'teachers'};
  vm.runInNewContext(section(runtime,'  function applyCalendarState(loaded){','  function loadPublishedWorkspace(options){'),ctx);
  ctx.applyCalendarState({dataMeta:{partial:true},teachers:[{id:'teacher'}]});
  assert.equal(ctx.state.teacherPayroll[0].teacherAmount,700);assert.equal(ctx.state.readOnly,true);assert.equal(ctx.state.dataMeta.teacherPayrollMonths['2026-09'].count,1);assert.deepEqual(calls,['teachers']);
});
