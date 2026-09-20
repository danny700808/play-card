'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const vm=require('vm');
const source=fs.readFileSync('operations-course-inline-runtime.js','utf8');
function harness(){
 let finish,calls=0;const nodes={};
 const ctx={followupStopsCache:[],clean:String,esc:String,followupRows:()=>[],state:{irregularCourses:[],stoppedCourseReceivables:[]},calendarBootstrapLoading:false,calendarPartial:()=>true,desktopCalendar:()=>true,Date,Promise,renderCalendar:()=>{},renderFollowupCounts:()=>{},$:id=>nodes[id]||(nodes[id]={value:'',classList:{remove(){}}}),afterWorkspaceReady:()=>{throw Error('unexpected full history load');},irregularRows:()=>[],openModal:()=>{},window:{location:{hash:'#course-calendar'},document:{hidden:false},YouziCoursePreviewData:{loadCalendarFollowupState:()=>{calls++;return new Promise(resolve=>finish=resolve);}}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  var followupMonthFilter='),source.indexOf('  function weekStartKey')),ctx);
 return {ctx,resolve:x=>finish(x),calls:()=>calls};
}
test('partial calendar opens irregular list without requesting full workspace',()=>{const {ctx}=harness();ctx.openFollowupList('day');ctx.openFollowupList('week');});
test('concurrent refresh shares request and updates only followup state',async()=>{
 const h=harness();h.ctx.state.tuitionPeriods=[{id:'keep-history'}];const first=h.ctx.refreshIrregularList(),second=h.ctx.refreshIrregularList();assert.equal(first,second);assert.equal(h.calls(),1);
 h.resolve({irregularCourses:[{id:'new'}],stoppedCourseReceivables:[{id:'stop'}]});await first;
 assert.equal(h.ctx.state.irregularCourses[0].id,'new');assert.equal(h.ctx.state.stoppedCourseReceivables[0].id,'stop');assert.equal(h.ctx.state.tuitionPeriods[0].id,'keep-history');
 await h.ctx.refreshIrregularList();assert.equal(h.calls(),1);
 h.ctx.irregularLoadedAt=0;const next=h.ctx.refreshIrregularList();assert.equal(h.calls(),2);h.resolve({irregularCourses:[],stoppedCourseReceivables:[]});await next;assert.equal(h.ctx.state.irregularCourses.length,0);
});
test('failed refresh can retry without replacing existing data',async()=>{
 const h=harness();h.ctx.window.YouziCoursePreviewData.loadCalendarFollowupState=async()=>{throw Error('offline');};await h.ctx.refreshIrregularList();assert.equal(h.ctx.irregularLoadPromise,null);assert.equal(h.ctx.irregularLoadedAt,0);
});
