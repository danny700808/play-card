'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('operations-course-inline-runtime.js','utf8');
function section(start,end){const i=source.indexOf(start);assert(i>=0);const j=source.indexOf(end,i);assert(j>i);return source.slice(i,j);}
function snapshot(partial=true,feePlans=[]){return {dataMode:'migration',dataMeta:{partial},feePlans,settings:{},rooms:[],subjects:[]};}
function harness(){
  const pending=[],ledgers=[],applied=[],selected=[],nodes={};
  const ctx={Map,Promise,state:snapshot(),clone:x=>JSON.parse(JSON.stringify(x)),clean:x=>String(x||''),
    calendarPartial:()=>!!ctx.state.dataMeta.partial,writable:()=>true,
    $:id=>nodes[id]||(nodes[id]={}),toast(){},updateScheduleConflict(){},
    selectScheduleStudent:id=>selected.push(id),
    window:{YouziCoursePreviewData:{
      loadScheduleCatalog:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),
      refreshWorkspaceSlice:scope=>new Promise(resolve=>ledgers.push({scope,resolve})),
      applyWorkspaceSlice:(state,payload)=>applied.push({state,payload})
    }}
  };
  vm.createContext(ctx);
  vm.runInContext(section('  var scheduleCatalogPromise=','  function selectScheduleStudent('),ctx);
  vm.runInContext(section('  function preserveWorkspaceConfiguration(','  function workspaceFromFormal('),ctx);
  return {ctx,pending,ledgers,applied,selected};
}
test('date navigation preserves plans and reloads a catalog for the new snapshot',async()=>{
  const h=harness(),plans=[{id:'jazz',subjectId:'drums',sort:1}];
  const first=h.ctx.ensureScheduleCatalog();h.pending[0].resolve(plans);await first;
  h.ctx.state=h.ctx.preserveWorkspaceConfiguration(snapshot(),h.ctx.state);
  assert.equal(h.ctx.state.feePlans[0].id,'jazz');
  const next=h.ctx.ensureScheduleCatalog();assert.equal(h.pending.length,2);
  h.pending[1].resolve([{id:'piano',subjectId:'piano'}]);await next;
  assert.equal(h.ctx.state.feePlans[0].id,'piano');
});
test('a partial response cannot erase plans but an authoritative empty full snapshot can',()=>{
  const h=harness(),old=snapshot(false,[{id:'jazz'}]);
  assert.equal(h.ctx.preserveWorkspaceConfiguration(snapshot(),old).feePlans.length,1);
  assert.equal(h.ctx.preserveWorkspaceConfiguration(snapshot(false),old).feePlans.length,0);
  assert.equal(h.ctx.preserveWorkspaceConfiguration(snapshot(true,[{id:'new'}]),old).feePlans[0].id,'new');
});
test('concurrent subject/student requests share one catalog and accept a genuinely empty result',async()=>{
  const h=harness(),a=h.ctx.ensureScheduleCatalog(),b=h.ctx.ensureScheduleCatalog();
  assert.equal(h.pending.length,1);h.pending[0].resolve([]);await Promise.all([a,b]);
  await h.ctx.ensureScheduleCatalog();assert.equal(h.pending.length,1);
});
test('late catalog responses cannot overwrite the current date or clear its pending request',async()=>{
  const h=harness(),old=h.ctx.ensureScheduleCatalog();
  h.ctx.state=snapshot();const current=h.ctx.ensureScheduleCatalog();
  h.pending[0].resolve([{id:'stale'}]);await old;
  assert.equal(h.ctx.state.feePlans.length,0);
  assert.equal(h.ctx.scheduleCatalogReady,false);
  assert.equal(h.ctx.ensureScheduleCatalog(),current);
  h.pending[1].resolve([{id:'current'}]);await current;
  assert.equal(h.ctx.state.feePlans[0].id,'current');
});
test('failed catalog loads can retry without discarding existing options',async()=>{
  const h=harness();h.ctx.state.feePlans=[{id:'existing'}];
  const failed=h.ctx.ensureScheduleCatalog();h.pending[0].reject(Error('offline'));
  await assert.rejects(failed,/offline/);assert.equal(h.ctx.state.feePlans.length,1);
  assert.equal(h.ctx.scheduleCatalogReady,false);
  const retry=h.ctx.ensureScheduleCatalog();assert.equal(h.pending.length,2);
  h.pending[1].resolve([{id:'updated'}]);await retry;
  assert.equal(h.ctx.state.feePlans[0].id,'updated');
  assert.equal(h.ctx.scheduleCatalogError,'');
});
test('switching dates while student data is pending never applies the old ledger',async()=>{
  const h=harness(),old=h.ctx.loadSelectedScheduleStudent('same',true);
  h.ctx.state=snapshot();const current=h.ctx.loadSelectedScheduleStudent('same',true);
  h.pending[0].resolve([{id:'old'}]);h.ledgers[0].resolve({date:'old'});await old;
  assert.equal(h.applied.length,0);assert.equal(h.selected.length,0);
  h.pending[1].resolve([{id:'new'}]);h.ledgers[1].resolve({date:'new'});await current;
  assert.equal(h.applied.length,1);assert.equal(h.applied[0].state,h.ctx.state);
  assert.deepEqual(h.selected,['same']);
});
test('complete workspaces do not redundantly fetch their catalog',async()=>{
  const h=harness();h.ctx.state=snapshot(false,[{id:'jazz'}]);
  await h.ctx.ensureScheduleCatalog();assert.equal(h.pending.length,0);
});
test('opening a schedule loads the catalog even before choosing a student',()=>{
  assert.match(section('  function openSchedule(','  function openPermanentSchedule('),/ensureScheduleCatalog\(\)/);
  const enrollment=section('  function updateScheduleEnrollment(','  function setScheduleStudentMode(');
  assert.match(enrollment,/正在讀取收費方案/);assert.match(enrollment,/收費方案讀取失敗/);
});
