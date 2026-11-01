'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('firebase-client.js','utf8');
function page(name,needle){
 const html=fs.readFileSync(name,'utf8'),dom=new JSDOM(html,{url:'https://example.test/'+name,runScripts:'outside-only'}),w=dom.window;
 w.qs=s=>w.document.querySelector(s);w.qsa=s=>[...w.document.querySelectorAll(s)];w.requireLogin=()=>({id:'e1'});w.getUser=w.requireLogin;w.identityTypeOf=()=> 'parttime';w.setMsg=(el,text)=>el.textContent=text;w.fillHeader=()=>{};
 w.eval(fs.readFileSync('employee-month-view.js','utf8'));
 const code=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes(needle));
 w.eval(code+(name==='parttime.html'?"\nwindow.setTestMonth=()=>parttimeMonthControl=EmployeeMonthView.mount('#parttimeHistoryMonth',{month:'2024-02',onSearch:searchHistoryRange});":name==='leave.html'?"\nwindow.setTestUser=()=>currentUser={id:'e1',identityType:'parttime'};window.testSegments=()=>leaveSegmentsState;":''));return {dom,w};
}
test('month controls wait for confirmation and handle leap years / December',async()=>{
 const dom=new JSDOM('<div id="m"></div>',{runScripts:'outside-only'}),w=dom.window;w.eval(fs.readFileSync('employee-month-view.js','utf8'));
 const calls=[],control=w.EmployeeMonthView.mount('#m',{month:'2024-02',onSearch:v=>calls.push(v)});
 assert.equal(control.get().endDate,'2024-02-29');assert.equal(calls.length,0);
 const selects=w.document.querySelectorAll('select');selects[0].value='2026';selects[1].value='12';selects[1].dispatchEvent(new w.Event('change'));assert.equal(calls.length,0);
 await w.document.querySelector('button').onclick();assert.equal(calls[0].startDate,'2026-12-01');assert.equal(calls[0].endDate,'2026-12-31');dom.window.close();
});
test('monthly schedule uses existing recurrence and manager single-day shifts with constant reads',async()=>{
 const pos=source.indexOf('  async function resolveTodaySchedule'),start=source.lastIndexOf('(function(global){',pos),end=source.indexOf('})(window);',pos)+11;
 let reads=0;const data={singleDaySchedules:[{employeeId:'e1',recordId:'extra',date:'2026-11-03',startTime:'14:00',endTime:'17:00'},{employeeId:'other',date:'2026-11-03',startTime:'09:00',endTime:'18:00'}],employeeSchedules:[{employeeId:'e1',assignmentId:'regular',templateId:'tpl',startDate:'2026-11-01',endDate:'2026-11-15'}],scheduleTemplates:[{templateId:'tpl',mondayType:'標準打卡',mondayStartTime:'09:00',mondayEndTime:'12:00'}]};
 function query(col,field,value){return {where:f=>(query(col,f,arguments[2])),get:async()=>{reads++;const rows=(data[col]||[]).filter(r=>!field||r[field]===value);return {forEach:fn=>rows.forEach((r,i)=>fn({id:String(i),data:()=>r}))};}};}
 const db={collection:col=>({get:()=>query(col).get(),where:(f,op,v)=>query(col,f,v)})};
 const w={YZFirebase:{init:()=>db},localStorage:{getItem:()=>null}};const context=vm.createContext({window:w,localStorage:w.localStorage,console});vm.runInContext(source.slice(start,end),context);
 const result=await w.YZFirebase.handleApi('getMonthlySchedule',{userId:'e1',month:'2026-11'});
 assert.deepEqual(Array.from(result.rows,r=>r.date),['2026-11-02','2026-11-03','2026-11-09']);assert.equal(reads,5);assert.equal(result.rows[1].source,'singleDaySchedules');
 await assert.rejects(w.YZFirebase.handleApi('getMonthlySchedule',{userId:'e1',month:'2026-99'}));
});
test('hours hide irrelevant double pay and query exactly the selected month',async()=>{
 const {dom,w}=page('parttime.html','function nextHoursSelection');const calls=[];w.api=async(a,p)=>{calls.push([a,p]);return {ok:true,rows:[],totalHours:0};};
 w.renderHoursGrid();w.renderDateContext({workDate:'2026-11-01',canRegister:false});assert(w.qs('#doublePayBtn').hidden);assert(w.qs('#dateStatusNote').hidden);assert(w.qs('#submitBtn').disabled);assert.equal(w.qs('#monthBadge'),null);
 w.renderDateContext({workDate:'2026-11-02',canRegister:true,scheduledHours:3});assert.equal(w.qs('#doublePayBtn').hidden,false);
 w.setTestMonth();await w.searchHistoryRange();assert.equal(calls[0][1].startDate,'2024-02-01');assert.equal(calls[0][1].endDate,'2024-02-29');assert.match(w.qs('#historySearchResult').textContent,/尚無資料/);dom.window.close();
});
test('clock shows three days and searches only a selected month without pending card',async()=>{
 const {dom,w}=page('clock.html','async function loadEditableHistory');let calls=[];w.api=async(a,p)=>{calls.push([a,p]);return {ok:true,rows:[]};};w.renderIntoList=()=>{};w.renderPendingReviewList=()=>{};
 await w.loadEditableHistory();const p=calls[0][1];assert.equal((new Date(p.endDate)-new Date(p.startDate))/86400000,2);assert(w.qs('#clockPendingCard').hidden);
 w.initRangeDefault();w.qs('#clockHistoryMonth select').value='2024';w.qsa('#clockHistoryMonth select')[1].value='2';await w.searchRange();assert.equal(calls[1][1].endDate,'2024-02-29');dom.window.close();
});
test('leave uses actual scheduled choices, preserves selection and requests history on demand',async()=>{
 const {dom,w}=page('leave.html','let leaveSegmentsState');w.setTestUser();
 const calls=[];w.api=async(a,p)=>{calls.push([a,p]);return a==='getMonthlySchedule'?{ok:true,rows:[{date:'2026-11-04',startTime:'09:00',endTime:'12:00',source:'singleDaySchedules'}]}:{ok:true,rows:[]};};
 w.renderSegments=()=>{};w.initLeaveMonthViews();await new Promise(r=>setTimeout(r,10));assert.equal(calls.length,1);assert.equal(calls[0][0],'getMonthlySchedule');
 w.qs('[data-leave-day]').click();assert.equal(w.testSegments()[0].startDate,'2026-11-04');
 const input=w.document.createElement('input');input.dataset.segmentStartDate='SEG_1';input.value='2026-11-04';w.qs('#segmentList').append(input);w.applyScheduledDateChoices();const select=w.qs('[data-segment-start-date]');assert.equal(select.tagName,'SELECT');assert.equal(select.options.length,2);assert.equal(select.value,'2026-11-04');
 await w.searchLeaveMonth({month:'2025-02'});assert.equal(calls[1][1].month,'2025-02');assert.equal(w.qs('#yearText').textContent,'尚無資料');dom.window.close();
});
test('changed pages and shared scripts compile',()=>{
 for(const file of ['clock.html','parttime.html','leave.html','employee-schedule.html'])for(const match of fs.readFileSync(file,'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1],{filename:file});
 for(const file of ['employee-month-view.js','firebase-client.js','personal-workspace.js','personal-preview-frame.js'])new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
});
