'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const model=require('../personal-workspace-model'),scope=require('../personnel-approval-scope'),pending=require('../management-pending-counts');
const user={employeeId:'e1',identityType:'parttime'};
test('approval badges match subject identity, deduplicate requests, omit leave-owned clocks and expose read failures',()=>{
 const sources={leave:[{requestId:'l1',employeeId:'e1',status:'待審核'}],clock:[{requestId:'c1',employeeId:'e1',managedByLeaveApproval:true}],temporary:[{requestId:'t1',employeeId:'e1'},{requestId:'t1',employeeId:'e1'}],profile:[{requestId:'p1',teacherId:'teacher',status:'待審核'},{requestId:'p2',status:'待審核'}],registration:[],contract:[]};
 const counts=pending.countsFor(sources,[user],scope);assert.equal(counts['parttime-clock'],0);assert.equal(counts['parttime-temporary'],1);assert.equal(counts.parttime,2);assert.equal(counts.external,1);assert.equal(counts['approval-unclassified'],1);assert.equal(counts.people,4);assert.equal(counts.approvals,4);
 const failed=pending.countsFor({...sources,leave:null},[user],scope);assert.equal(failed.people,null);assert.equal(failed['parttime-leave-review'],null);assert.equal(failed['parttime-temporary'],1);
});
test('roles add tabs without granting unrelated features',()=>{assert.deepEqual(model.tabs({attendance:true}).map(t=>t[0]),['attendance','salary','more']);assert.deepEqual(model.tabs({attendance:true,teacher:true,renter:true}).map(t=>t[0]),['schedule','attendance','salary','rental','more']);});
test('manager preview is interactive but never writes, loads real employee data or embeds operational forms',async()=>{
 const {JSDOM}=require('jsdom');const dom=new JSDOM(fs.readFileSync('dashboard.html','utf8'),{url:'https://example.test/dashboard.html?preview=parttime',runScripts:'outside-only'}),w=dom.window;let calls=0;
 w.APP_CONFIG={FIREBASE_CONFIG:{}};w.firebase={apps:[{}],auth:()=>({currentUser:{getIdTokenResult:async()=>({claims:{employee:true,manager:true}})}})};w.getUser=()=>({id:'manager',role:'admin'});w.isManager=()=>true;w.ensureHrSession=async()=>{};w.fetch=w.api=w.saveUser=()=>{calls++;throw Error('preview must not call');};
 w.eval(fs.readFileSync('personal-workspace-model.js','utf8'));w.eval(fs.readFileSync('personal-workspace.js','utf8'));await new Promise(r=>setTimeout(r,15));
 assert.match(w.document.body.textContent,/示範資料・不會送出/);w.document.querySelector('[data-action=clock]').click();w.document.querySelector('[data-action=demo-send]').click();assert.match(w.document.getElementById('personalStatus').textContent,/沒有正式送出/);
 w.document.querySelector('[data-tab=more]').click();w.document.querySelector('[data-action=profile]').click();w.document.getElementById('personalProfileForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
 w.document.getElementById('previewRole').value='staff';w.document.getElementById('previewRole').dispatchEvent(new w.Event('change'));assert(!w.document.querySelector('[data-action=hours]'));w.document.getElementById('previewTeacher').checked=true;w.document.getElementById('previewTeacher').dispatchEvent(new w.Event('change'));assert(w.document.querySelector('[data-tab=schedule]'));
 assert.equal(w.document.querySelectorAll('iframe').length,0);assert.equal(calls,0);dom.window.close();
});
test('teacher attendance entry stays hidden unless the protected service confirms an employee role',async()=>{
 const {JSDOM}=require('jsdom');
 for(const employee of [null,{identityType:'parttime'}]){
  const dom=new JSDOM('<nav><button id="teacherEmployeeEntry" hidden style="display:none">出勤</button></nav><a id="teacherMobilePreview" hidden style="display:none"></a>',{url:'https://example.test/teacher-course-portal.html',runScripts:'outside-only'}),w=dom.window;let calls=[];
  w.firebase={apps:[{}],auth:()=>({currentUser:null})};w.CoursePortal={getSession:()=> 'verified-session',call:async(name,data)=>{calls.push([name,data.action]);return {employee};}};
  w.eval(fs.readFileSync('teacher-personal-entry.js','utf8'));await new Promise(r=>setTimeout(r,10));
  assert.equal(w.document.getElementById('teacherEmployeeEntry').hidden,!employee);assert.deepEqual(calls,[['personalWorkspace','portal-capabilities']]);assert.equal(w.document.getElementById('teacherMobilePreview').hidden,true);dom.window.close();
 }
});
