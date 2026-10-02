'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('operations-course-inline-runtime.js','utf8');
function searchHarness(){
 const nodes={studentSearch:{value:'Alice'},studentPaymentFilter:{value:'all'},studentMetrics:{},studentRows:{}};
 const reads=[],people=[{id:'a',name:'Alice',phone:'123'},{id:'b',name:'Bob',phone:'456'}];
 const ready=new Set();let directoryReads=0;
 const c={Map,Set,Promise,clean:x=>String(x||''),esc:x=>String(x||''),currentView:'students',studentHistoryMode:true,state:{students:[],subjects:[],tuitionPeriods:[]},$:id=>nodes[id],calendarPartial:()=>true,studentDetailCache:()=>({ready}),metric:()=>'',bySort:(a,b)=>a.name.localeCompare(b.name),studentCourseStatusLabel:()=>'',periodBalance:p=>p.due,periodRemaining:p=>p.remaining,ensureStudentDetails:async ids=>{reads.push(...ids);for(const id of ids){ready.add(id);c.state.tuitionPeriods.push({studentId:id,due:id==='a'?100:0,remaining:2});}return true;},window:{YouziCoursePreviewData:{loadStudentDirectory:async()=>{directoryReads++;return people;},loadPublished:()=>{throw Error('global read forbidden');}}}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  var studentDirectory='),source.indexOf('  function renderStudents(){')),c);
 return {c,nodes,reads,directoryReads:()=>directoryReads};
}
test('search retrieves identities once and does not load student ledgers',async()=>{
 const h=searchHarness();await h.c.renderStudentSearch();assert.match(h.nodes.studentRows.innerHTML,/Alice/);assert.doesNotMatch(h.nodes.studentRows.innerHTML,/Bob/);assert.deepEqual(h.reads,[]);
 h.nodes.studentSearch.value='Bob';await h.c.renderStudentSearch();assert.equal(h.directoryReads(),1);assert.deepEqual(h.reads,[]);assert.match(h.nodes.studentRows.innerHTML,/Bob/);
});
test('an explicit unpaid filter reads only matching students',async()=>{
 const h=searchHarness();h.nodes.studentPaymentFilter.value='due';await h.c.renderStudentSearch();assert.deepEqual(h.reads,['a']);assert.match(h.nodes.studentRows.innerHTML,/Alice/);assert.doesNotMatch(h.nodes.studentRows.innerHTML,/Bob/);
});
test('an old search cannot overwrite a newer query or reopen a cleared search',async()=>{
 const h=searchHarness();let finish;h.c.window.YouziCoursePreviewData.loadStudentDirectory=()=>new Promise(resolve=>finish=resolve);
 const first=h.c.renderStudentSearch();h.nodes.studentSearch.value='Bob';const second=h.c.renderStudentSearch();finish([{id:'a',name:'Alice'},{id:'b',name:'Bob'}]);await Promise.all([first,second]);assert.match(h.nodes.studentRows.innerHTML,/Bob/);assert.doesNotMatch(h.nodes.studentRows.innerHTML,/Alice/);
 const other=searchHarness();let release;other.c.window.YouziCoursePreviewData.loadStudentDirectory=()=>new Promise(resolve=>release=resolve);const pending=other.c.renderStudentSearch();other.c.studentHistoryMode=false;other.nodes.studentRows.innerHTML='recent-list';release([]);await pending;assert.equal(other.nodes.studentRows.innerHTML,'recent-list');
});
test('subject search requests only the selected subject scope without loading details',async()=>{
 const h=searchHarness(),scopes=[];h.c.state.subjects=[{id:'piano',name:'Piano'}];h.nodes.studentSearch.value='Piano';h.c.window.YouziCoursePreviewData.loadStudentDirectory=async ids=>{scopes.push(ids);return [{id:'a',name:'Alice'}];};await h.c.renderStudentSearch();assert.deepEqual(Array.from(scopes[1]),['piano']);assert.deepEqual(h.reads,[]);assert.match(h.nodes.studentRows.innerHTML,/Alice/);
});
test('teacher prefetch warms next week only and respects cache and hidden pages',async()=>{
 const text=fs.readFileSync('teacher-course-portal-v8.js','utf8');const start=text.indexOf('  function prefetchNeighborWeeks('),end=text.indexOf('\n  function setSession(',start);let timer;const reads=[];
 const c={weekPrefetchTimer:0,clearTimeout(){},setTimeout:fn=>{timer=fn;return 1;},token:'t',weekStart:10,activeTab:'schedule',viewCache:{revision:()=>0},teacherOperations:{hasPending:()=>false},document:{visibilityState:'visible'},addDays:(a,b)=>a+b,readCache:()=>null,requestTeacherWeek:async week=>reads.push(week)};
 vm.createContext(c);vm.runInContext(text.slice(start,end),c);c.prefetchNeighborWeeks(10);await timer();assert.deepEqual(reads,[17]);c.readCache=()=>({});c.prefetchNeighborWeeks(10);await timer();assert.deepEqual(reads,[17]);c.readCache=()=>null;c.document.visibilityState='hidden';c.prefetchNeighborWeeks(10);await timer();assert.deepEqual(reads,[17]);
});
test('calendar background status refresh never requests balances; explicit stopped list does',async()=>{
 let requested=[];const c={irregularLoadPromise:null,irregularLoadedAt:0,calendarBootstrapLoading:false,desktopCalendar:()=>true,Date,Promise,JSON,state:{irregularCourses:[]},followupStopsCache:null,renderCalendar(){},renderFollowupCounts(){},toast(){},window:{location:{hash:'#course-calendar'},document:{hidden:false},YouziCoursePreviewData:{loadCalendarFollowupState:async flag=>{requested.push(flag);return {irregularCourses:[],followupStops:[]};}}}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  function refreshIrregularList('),source.indexOf('  function weekStartKey(')),c);await c.refreshIrregularList(true);await c.refreshIrregularList(true,true);assert.deepEqual(requested,[false,true]);assert.doesNotMatch(source,/setInterval\(refreshIrregularList/);
});
