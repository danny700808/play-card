'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const runtime=fs.readFileSync(path.join(root,'operations-course-inline-runtime.js'),'utf8');
const start=runtime.indexOf('  function loadPublishedWorkspace(options){');
assert(start>=0,'The startup callback must exist before init binds and invokes it');
const loader=runtime.slice(start,runtime.indexOf('  function bindEvents(){',start));
assert(runtime.includes("if(window.__YOUZI_COURSE_SCHEDULER_TEST__!==true)loadPublishedWorkspace({calendarOnly:true});"));

function harness(fail=false){
 const nodes=new Map(),calls=[];
 const element=id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,textContent:'',classList:{add:v=>calls.push(['hide',id,v]),remove:v=>calls.push(['show',id,v])}});return nodes.get(id);};
 const ctx={calendarPartial:()=>Boolean(ctx.state.dataMeta&&ctx.state.dataMeta.partial),workspaceLoadPromise:null,calendarBootstrapLoading:false,currentView:'calendar',loadingMigration:false,operationRunning:false,state:{currentDate:'2026-09-16'},$:element,closeModal:()=>{},updateModeUI:()=>{},todayKey:()=> '2026-09-13',clean:String,toast:(...args)=>calls.push(['toast',...args]),window:{YouziCoursePreviewData:{loadPublished:async options=>{calls.push(['load',options.anchorDate]);if(fail)throw Object.assign(new Error('Session expired'),{reauth:true});return {events:[{id:'lesson'}]};}}},applyFormalState:async data=>calls.push(['apply',data.events.length])};
 vm.createContext(ctx);vm.runInContext(loader+'\nthis.runLoader=loadPublishedWorkspace;',ctx);
 return {ctx,calls,nodes};
}
test('calendar startup automatically reads saved courses without success banners',async()=>{
 const {ctx,calls,nodes}=harness();await ctx.runLoader();
 assert(calls.some(x=>x[0]==='load'&&x[1]==='2026-09-16'));
 assert(calls.some(x=>x[0]==='apply'&&x[1]===1));
 assert(!calls.some(x=>x[0]==='toast'));
 assert.equal(ctx.operationRunning,false);assert.equal(nodes.get('loadPublishedBtn').disabled,false);
});
test('startup failure retains the workspace and exposes sign-in recovery',async()=>{
 const {ctx,calls}=harness(true);await ctx.runLoader();
 assert.equal(ctx.state.currentDate,'2026-09-16');assert.equal(ctx.state.readOnly,true);
 assert(calls.some(x=>x[0]==='show'&&x[1]==='calendarReauthPanel'));
 assert(calls.some(x=>x[0]==='toast'));assert.equal(ctx.loadingMigration,false);
});
test('migration controls stay hidden even before JavaScript starts',()=>{
 const html=fs.readFileSync(path.join(root,'operations-course-inline-template.html'),'utf8');
 assert.match(html,/id="dataModePanel" hidden style="display:none"/);
 assert.match(html,/class="cloud-refresh-bar" hidden style="display:none"/);
 assert(!html.includes('正式資料已保存'));assert(!html.includes('正在自動開啟資料庫'));
});

test('opening details keeps a freshly verified partial calendar visible',async()=>{
 const {ctx,calls}=harness();ctx.state.dataMeta={partial:true};await ctx.runLoader();
 assert(!calls.some(x=>x[0]==='hide'&&x[1]==='scheduleGrid'));
 assert(calls.some(x=>x[0]==='apply'));
});

test('calendar boot does not fetch the ledger until details are requested',async()=>{
 const {ctx}=harness(),requests=[],timers=[];
 ctx.window.setTimeout=fn=>timers.push(fn);
 ctx.window.document={hidden:false};
 ctx.window.YouziCoursePreviewData.loadPublished=async options=>{
   requests.push(options.calendarOnly===true);
   return options.calendarOnly?{dataMeta:{partial:true},events:[]}:{events:[]};
 };
 ctx.applyCalendarState=data=>{ctx.state=data;};
 ctx.applyFormalState=async data=>{ctx.state=data;};
 await ctx.runLoader({calendarOnly:true});
 for(const timer of timers)await timer();
 assert.deepEqual(requests,[true]);
 assert.equal(ctx.operationRunning,false);
 const gate=runtime.slice(runtime.indexOf('  async function ensureWorkspaceDetails(){'),runtime.indexOf('  function afterWorkspaceReady('));
 ctx.isReadOnly=()=>false;vm.runInContext(gate,ctx);
 await ctx.ensureWorkspaceDetails();
 assert.deepEqual(requests,[true,false]);
 assert.equal(Boolean(ctx.state.dataMeta&&ctx.state.dataMeta.partial),false);
});
