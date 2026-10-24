'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('teacher-course-portal-v8.js','utf8');
const sessionSource=fs.readFileSync('teacher-course-session-v8.js','utf8');
function section(begin,end){return source.slice(source.indexOf(begin),source.indexOf(end,source.indexOf(begin)));}
function sessionFixture(){
 const timers=new Map(),listeners={};let timerId=0,observerCallback;
 const nodes=Object.fromEntries(['bindView','appView','sessionLoading','teacherSessionTitle','teacherSessionMessage','retryTeacherSession','spinner'].map(id=>{
  const classes=new Set(['hidden']);return [id,{hidden:false,disabled:false,textContent:'',attrs:{},classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k)},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this[k]=fn;},querySelector:()=>nodes.spinner}];
 }));
 const c={URLSearchParams,Promise,location:{search:''},localStorage:{getItem:()=> 'session'},document:{getElementById:id=>nodes[id]},navigator:{onLine:true},CoursePortal:{getSession:()=> 'session'},addEventListener:(k,fn)=>listeners[k]=fn,setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),MutationObserver:class{constructor(fn){observerCallback=fn;}observe(){}disconnect(){}}};c.window=c;
 vm.runInNewContext(sessionSource,c);return {c,nodes,timers,listeners,observe:()=>observerCallback()};
}
test('15 seconds of pending data keeps the login form hidden without discarding the session',()=>{
 const f=sessionFixture();[...f.timers.values()].find(t=>t.ms===15000).fn();
 assert(f.nodes.bindView.classList.contains('hidden'));assert(!f.nodes.sessionLoading.classList.contains('hidden'));
 assert.match(f.nodes.teacherSessionMessage.textContent,/仍在讀取/);assert(f.nodes.retryTeacherSession.hidden);
 f.nodes.appView.classList.remove('hidden');f.observe();assert(f.nodes.sessionLoading.classList.contains('hidden'));assert.equal(f.timers.size,0);
});
test('failure offers one retry; double taps and online events do not create parallel loads',async()=>{
 const f=sessionFixture();let calls=0;const retry=()=>{calls++;return new Promise(()=>{});};
 f.c.YouziTeacherSession.fail(Error('network'),retry);assert(!f.nodes.retryTeacherSession.hidden);
 f.nodes.retryTeacherSession.click();f.nodes.retryTeacherSession.click();f.listeners.online();await Promise.resolve();assert.equal(calls,1);
 assert(f.nodes.bindView.classList.contains('hidden'));assert(f.nodes.retryTeacherSession.disabled);
});
test('restoring connectivity retries a failed load and keeps failure controls if it fails again',async()=>{
 const f=sessionFixture();let calls=0;f.c.navigator.onLine=false;
 f.c.YouziTeacherSession.fail(Error('offline'),async()=>{calls++;throw Error('still offline');});assert.match(f.nodes.teacherSessionMessage.textContent,/沒有網路/);
 f.c.navigator.onLine=true;f.listeners.online();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1);assert(!f.nodes.retryTeacherSession.hidden);assert(!f.nodes.retryTeacherSession.disabled);
});
function invocationFixture(steps,extra={}){
 const calls=[],waits=[];const c={token:'teacher-session',clean:x=>String(x??'').trim(),Math,Error,Promise,global:{navigator:{onLine:true},setTimeout:(fn,ms)=>{waits.push(ms);queueMicrotask(fn);}},PortalAuth:{callableFor:(name,options)=>async payload=>{calls.push({name,options,payload});const next=steps.shift();if(next instanceof Error)throw next;return {data:next};}},...extra};
 vm.createContext(c);vm.runInContext(section('  async function invoke(','  function toast('),c);return {c,calls,waits};
}
const failure=code=>Object.assign(Error('temporary'),{code,details:{reason:'safe-reason'}});
test('temporary read errors retry twice using the same region and payload, then succeed',async()=>{
 const f=invocationFixture([failure('functions/internal'),failure('functions/unavailable'),{ok:true}]);const payload={sessionToken:'teacher-session',weekStart:'2026-10-19'};
 assert.equal((await f.c.invoke('coursePortalTeacherData',payload)).ok,true);assert.equal(f.calls.length,3);assert.equal(f.waits.length,2);
 assert(f.calls.every(r=>r.name==='coursePortalTeacherData'&&r.options.timeout===20000&&r.payload===payload));
});
test('repeated read failure stops after three attempts and preserves the Firebase error code and details',async()=>{
 const f=invocationFixture(Array.from({length:4},()=>failure('functions/deadline-exceeded')));
 await assert.rejects(f.c.invoke('coursePortalTeacherData',{}),e=>e.code==='functions/deadline-exceeded'&&e.details.reason==='safe-reason');assert.equal(f.calls.length,3);
});
test('sign-in failures and business rejections are never retried',async()=>{
 for(const code of ['functions/unauthenticated','functions/permission-denied','functions/failed-precondition','functions/already-exists']){
  const f=invocationFixture([failure(code)]);await assert.rejects(f.c.invoke('coursePortalTeacherData',{}),e=>e.code===code);assert.equal(f.calls.length,1);
 }
});
test('attendance, schedule changes, access exchange and reminder writes are never automatically resent',async()=>{
 for(const [name,payload] of [['coursePortalTeacherAttendanceV2',{}],['coursePortalTeacherAction',{operationId:'original'}],['coursePortalExchangeAccess',{}],['coursePortalTeacherData',{reminderSettings:true,save:true}]]){
  const f=invocationFixture([failure('functions/internal')]);await assert.rejects(f.c.invoke(name,payload));assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.timeout,180000);
 }
});
test('offline reads fail promptly; a changed account cancels the planned retry',async()=>{
 const f=invocationFixture([failure('functions/internal')]);f.c.global.navigator.onLine=false;await assert.rejects(f.c.invoke('coursePortalTeacherData',{}));assert.equal(f.calls.length,1);
 const g=invocationFixture([failure('functions/unavailable')]);g.c.global.setTimeout=fn=>{g.c.token='new-account';queueMicrotask(fn);};await assert.rejects(g.c.invoke('coursePortalTeacherData',{}));assert.equal(g.calls.length,1);
});
function loadFixture(error,visible=false){
 const effects=[];const c={token:'teacher-session',fetchData:async()=>{throw error;},refreshTeacherUtilityStatus:()=>effects.push('utility'),appView:{classList:{contains:()=>!visible}},global:{YouziTeacherSession:{fail:()=>effects.push('retry-screen')}},PortalAuth:{isSessionAuthError:e=>e.code==='functions/unauthenticated',invalidateSession:()=>effects.push('invalidate')},showDataFreshness:()=>effects.push('refresh-button'),toast:()=>effects.push('toast'),startTeacherPortal(){}};
 vm.createContext(c);vm.runInContext(section('  async function load(','  function activateTab('),c);return {c,effects};
}
test('initial data failure preserves login and provides recovery; verified auth failure still redirects',async()=>{
 const f=loadFixture(failure('functions/internal'));assert.equal(await f.c.load(false),false);assert.deepEqual(f.effects,['retry-screen']);
 const g=loadFixture(failure('functions/unauthenticated'));assert.equal(await g.c.load(false),false);assert.deepEqual(g.effects,['invalidate']);
 const h=loadFixture(failure('functions/internal'),true);await h.c.load(true);assert.deepEqual(h.effects,['refresh-button','toast']);
});
test('a failed old-account load cannot invalidate the newly selected account',async()=>{
 const f=loadFixture(failure('functions/unauthenticated'));f.c.fetchData=async()=>{f.c.token='new-account';throw failure('functions/unauthenticated');};await f.c.load(false);assert.deepEqual(f.effects,[]);
});
test('successful payroll recovery clears the failed-read notice and retry button',async()=>{
 const f=loadFixture(null,true);f.c.activeTab='payroll';f.c.fetchData=async()=>{};
 const notices=[];f.c.showDataFreshness=text=>notices.push(text);assert.equal(await f.c.load(true),true);assert.deepEqual(notices,['']);
});
test('recent successful week reads are reusable only for the same account and unchanged schedule',async()=>{
 let revision=0,now=1000;const c={token:'a',Date:{now:()=>now},Map,viewCache:{revision:()=>revision,load:(_,fn)=>fn()},invoke:async()=>({events:[]})};
 vm.createContext(c);vm.runInContext(section('  const verifiedWeeks =','  function prefetchNeighborWeeks('),c);
 assert(!c.isRecentlyVerifiedWeek('week'));await c.requestTeacherWeek('week');assert(c.isRecentlyVerifiedWeek('week'));
 revision++;assert(!c.isRecentlyVerifiedWeek('week'));await c.requestTeacherWeek('week');c.token='b';assert(!c.isRecentlyVerifiedWeek('week'));
 await c.requestTeacherWeek('week');now+=30000;assert(!c.isRecentlyVerifiedWeek('week'));
});
test('a recently prefetched week renders without a redundant network request',async()=>{
 let requests=0,renders=0;const c={viewCache:{revision:()=>0},teacherOperations:{version:()=>0},dataRequestVersion:0,token:'a',activeTab:'schedule',weekStart:'2026-10-19',payrollMonth:'2026-10',readCache:()=>({events:[]}),mergeData(){},renderAll:()=>renders++,isRecentlyVerifiedWeek:()=>true,showDataFreshness(){},prefetchNeighborWeeks(){},requestTeacherWeek:async()=>{requests++;}};
 vm.createContext(c);vm.runInContext(section('  async function fetchData(','  async function load('),c);await c.fetchData(false);assert.equal(renders,1);assert.equal(requests,0);
});
