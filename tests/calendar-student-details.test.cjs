'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('operations-course-inline-runtime.js','utf8');
function harness(){
  const reads=[],pending=[],nodes=new Map();let catalogReads=0;
  const ctx={Set,Map,WeakMap,Promise,clean:x=>String(x||''),state:{readOnly:true,dataMode:'migration',dataMeta:{partial:true},tuitionPeriods:[{id:'other',studentId:'other'}],feePlans:[]},
    isReadOnly:()=>ctx.state.readOnly,toast(){},$:id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{dataset:{},classList:{add:x=>classes.add(x),contains:x=>classes.has(x),remove:x=>classes.delete(x)}});}return nodes.get(id);},openModal:id=>ctx.$(id).classList.add('open'),
    window:{YouziCoursePreviewData:{loadScheduleCatalog:async()=>{catalogReads++;return [{id:'plan'}];},refreshWorkspaceSlice:scope=>{reads.push(scope);return new Promise((resolve,reject)=>pending.push({resolve,reject}));},applyWorkspaceSlice:(state,payload)=>{assert.equal(state.feePlans[0].id,'plan');state.tuitionPeriods=state.tuitionPeriods.filter(p=>p.studentId!==payload.studentId).concat({id:'period-'+payload.studentId,studentId:payload.studentId});},loadPublished:()=>{throw Error('must not read all students');}}}};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  function calendarPartial(){'),source.indexOf('  async function ensureWorkspaceDetails(){')),ctx);
  return {ctx,reads,pending,nodes,catalogReads:()=>catalogReads};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('first click reads only the chosen student and retains other students and partial snapshot protection',async()=>{
  const h=harness();let opened=0;
  assert.equal(h.ctx.afterStudentDetailsReady(['a'],()=>opened++,'eventModal','A'),true);
  assert.equal(h.ctx.$('eventModal').classList.contains('open'),true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.reads)),[{studentIds:['a']}]);
  h.pending[0].resolve({studentId:'a'});await flush();assert.equal(opened,1);
  assert.equal(h.ctx.state.readOnly,false);assert.equal(h.ctx.state.dataMode,'sandbox');assert.equal(h.ctx.state.dataMeta.partial,true);
  assert.deepEqual(h.ctx.state.tuitionPeriods.map(p=>p.studentId),['other','a']);
  assert.equal(h.ctx.afterStudentDetailsReady(['a'],()=>opened++,'eventModal','A'),false);assert.equal(h.reads.length,1);
  h.ctx.afterStudentDetailsReady(['b'],()=>opened++,'eventModal','B');assert.equal(h.reads.length,2);assert.deepEqual(Array.from(h.reads[1].studentIds),['b']);
  h.pending[1].resolve({studentId:'b'});await flush();assert.equal(h.catalogReads(),1);
});
test('rapid student switching only displays the latest selection',async()=>{
  const h=harness(),opened=[];
  h.ctx.afterStudentDetailsReady(['a'],()=>opened.push('a'),'eventModal','A');
  h.ctx.afterStudentDetailsReady(['b'],()=>opened.push('b'),'eventModal','B');
  h.pending[1].resolve({studentId:'b'});await flush();h.pending[0].resolve({studentId:'a'});await flush();assert.deepEqual(opened,['b']);
});
test('concurrent requests share the selected ledger and failures can retry',async()=>{
  const h=harness();const a=h.ctx.ensureStudentDetails(['a']),b=h.ctx.ensureStudentDetails(['a']);assert.equal(h.reads.length,1);
  h.pending[0].reject(Error('offline'));await Promise.all([assert.rejects(a),assert.rejects(b)]);
  const retry=h.ctx.ensureStudentDetails(['a']);assert.equal(h.reads.length,2);h.pending[1].resolve({studentId:'a'});assert.equal(await retry,true);
});
test('closing details while loading does not reopen the modal',async()=>{
  const h=harness();let opened=false;h.ctx.afterStudentDetailsReady(['a'],()=>opened=true,'eventModal','A');h.ctx.$('eventModal').classList.remove('open');h.pending[0].resolve({studentId:'a'});await flush();assert.equal(opened,false);
});
test('a changed calendar rejects an old response and does not reuse old ledger cache',async()=>{
  const h=harness(),old=h.ctx.state,load=h.ctx.ensureStudentDetails(['a']);h.ctx.state={readOnly:true,dataMeta:{partial:true},tuitionPeriods:[],feePlans:[]};
  h.pending[0].resolve({studentId:'a'});assert.equal(await load,false);assert.equal(h.ctx.state.tuitionPeriods.length,0);assert.equal(old.tuitionPeriods.length,1);
  const retry=h.ctx.ensureStudentDetails(['a']);assert.equal(h.reads.length,2);h.pending[1].resolve({studentId:'a'});await retry;
});
test('group classes fetch each participant once and rental details fetch no student ledger',async()=>{
  const h=harness();h.ctx.afterStudentDetailsReady(['a','b','a'],()=>{},'eventModal','Group');assert.equal(h.reads.length,2);h.pending[0].resolve({studentId:'a'});h.pending[1].resolve({studentId:'b'});await flush();
  const rental=harness();const ready=rental.ctx.ensureStudentDetails([]);await ready;assert.equal(rental.reads.length,0);
});
test('event and student entry points do not use the full workspace gate',()=>{
  for(const [start,end] of [['  function eventDetails(event){','  function detailLine'],['  function openStudent(','  function periodLessonSlots']]){
    const code=source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));assert.match(code,/afterStudentDetailsReady/);assert.doesNotMatch(code,/afterWorkspaceReady/);
  }
  assert.match(source,/if\(!isSandbox\(\)\|\|calendarPartial\(\)\)return/);
  assert.match(source,/\$\('tuitionStudent'\)\.disabled=!!id\|\|calendarPartial\(\)/);
});
