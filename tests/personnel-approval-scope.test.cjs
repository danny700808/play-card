const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),scope=require('../personnel-approval-scope.js'),routes=require('../internal-workspace-routes.js');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('approval grouping uses the subject ID, preserves unknowns, and never matches names or reviewers',()=>{
 const map=scope.indexEmployees([{id:'a',identityType:'staff',name:'same'},{id:'b',identityType:'parttime',name:'same'},{id:'c',identityType:'external'},{id:'conflict',identityType:'staff'},{id:'conflict',identityType:'parttime'}]);
 assert.equal(scope.classify({employeeId:'a',reviewedBy:'b'},map),'staff');
 assert.equal(scope.classify({raw:{employeeId:'b'}},map),'parttime');
 assert.equal(scope.classify({employeeId:'c'},map),'external');
 assert.equal(scope.classify({teacherId:'t'},map),'external');
 assert.equal(scope.classify({name:'same',reviewedBy:'a',notificationReceiver:'b'},map),'unknown');
 assert.equal(scope.classify({employeeId:'conflict'},map),'unknown');
 assert.equal(scope.classify({employeeId:'a',userId:'b'},map),'unknown');
 assert.equal(scope.classify({requestedIdentityType:'external'},map),'external');
 assert.equal(scope.classify({identityType:'未確認',employeeId:'a'},map),'unknown');
});
test('filtering keeps full rows unchanged and updates counts/context without business writes',async()=>{
 const dom=new JSDOM('<nav data-yz-global-nav></nav><main><div class="approval-toolbar"></div><input id="other" value="preserved"></main>',{url:'https://example.test/clock-corrections-admin.html?identity=parttime&nav=parttime-clock',runScripts:'outside-only'});
 const w=dom.window;w.InternalWorkspaceRoutes=routes;w.localStorage.setItem('employeeUser',JSON.stringify({id:'admin',role:'admin'}));w.hasSettingsZoneAccess=()=>true;
 let calls=0,renders=0;w.api=async(action)=>{assert.equal(action,'getEmployeeManagementData');calls++;return {ok:true,rows:[{id:'a',identityType:'staff'},{id:'b',identityType:'parttime'}]};};
 w.eval(read('internal-workspace.js'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));w.eval(read('personnel-approval-scope.js'));
 await Promise.all([w.PersonnelApprovalScope.load(()=>renders++),w.PersonnelApprovalScope.load(()=>renders++)]);assert.equal(calls,1);
 const rows=[{employeeId:'a',amount:100},{employeeId:'b',amount:200},{employeeId:'legacy',amount:300}],before=JSON.stringify(rows);
 assert.deepEqual(Array.from(w.PersonnelApprovalScope.filter(rows),r=>r.amount),[200]);
 const select=w.document.querySelector('select');select.value='staff';select.dispatchEvent(new w.Event('change'));
 assert.equal(renders,1);assert.deepEqual(Array.from(w.PersonnelApprovalScope.filter(rows),r=>r.amount),[100]);assert.match(w.document.querySelector('.internal-breadcrumbs').textContent,/專職人員/);
 select.value='unknown';select.dispatchEvent(new w.Event('change'));assert.deepEqual(Array.from(w.PersonnelApprovalScope.filter(rows),r=>r.amount),[300]);
 select.value='all';select.dispatchEvent(new w.Event('change'));assert.equal(w.PersonnelApprovalScope.filter(rows).length,3);assert.equal(JSON.stringify(rows),before);assert.equal(w.document.querySelector('#other').value,'preserved');assert.equal(calls,1);dom.window.close();
});
test('roster failure is surfaced and retriable; unprivileged sessions do not read personnel',async()=>{
 const dom=new JSDOM('<div class="approval-toolbar"></div>',{url:'https://example.test/leave.html?mode=approval&identity=staff',runScripts:'outside-only'});const w=dom.window;w.eval(read('personnel-approval-scope.js'));
 let calls=0;w.api=async()=>{calls++;return {ok:false};};w.hasSettingsZoneAccess=()=>true;
 await assert.rejects(w.PersonnelApprovalScope.load(),/重新登入/);assert.equal(calls,0);
 w.localStorage.setItem('employeeUser',JSON.stringify({id:'manager'}));await assert.rejects(w.PersonnelApprovalScope.load(),/讀取失敗/);
 w.api=async()=>({ok:true,rows:[]});await w.PersonnelApprovalScope.load();assert.equal(w.PersonnelApprovalScope.filter([{name:'unknown'}]).length,0);dom.window.close();
});
test('static help is removed including later inserts, while values and errors remain',async()=>{
 const dom=new JSDOM('<main><p class="subtitle">長說明</p><div class="field-hint" id="error" role="alert">必填</div><div class="muted">2026-10-31</div><input value="unchanged"></main>',{url:'https://example.test/employee-admin.html',runScripts:'outside-only'});const w=dom.window;w.InternalWorkspaceRoutes=routes;w.localStorage.setItem('employeeUser',JSON.stringify({id:'admin',role:'admin'}));w.eval(read('internal-workspace.js'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 const later=w.document.createElement('p');later.className='hint';later.textContent='動態插入的操作說明';w.document.querySelector('main').append(later);await new Promise(r=>w.setTimeout(r,0));
 assert(w.document.querySelector('.subtitle').classList.contains('internal-description'));assert(later.classList.contains('internal-description'));assert(!w.document.querySelector('#error').classList.contains('internal-description'));assert.equal(w.document.querySelector('.muted').textContent,'2026-10-31');assert.equal(w.document.querySelector('input').value,'unchanged');assert.equal(w.document.querySelectorAll('.internal-help').length,0);dom.window.close();
});
test('scoped links require an implemented filter and valid personnel context',()=>{
 for(const id of ['staff-clock','staff-leave-review','staff-profile','staff-registration','parttime-clock','parttime-temporary','parttime-profile','external-profile','external-registration']){
  const n=routes.treeNode(id),u=new URL(routes.treeLink(n),'https://example.test/');assert(read(u.pathname.slice(1)).includes('personnel-approval-scope.js'));assert.equal(u.searchParams.get('identity'),id.split('-')[0]);assert(routes.pageContext(u.pathname,u.search,u.hash).some(x=>x.id===id.split('-')[0]));
 }
});
test('new standard schedule exposes editable times and retains existing off-day behavior',()=>{
 const html=read('schedule-admin.html');const dom=new JSDOM(html,{url:'https://example.test/schedule-admin.html',runScripts:'outside-only'});const w=dom.window;
 for(const script of w.document.querySelectorAll('script:not([src])'))if(script.textContent.trim())w.eval(script.textContent);
 w.buildDayFields();const start=w.document.querySelector('#mondayTime'),end=w.document.querySelector('#mondayEndTime');
 assert(!start.parentElement.classList.contains('hidden'));assert(!end.parentElement.classList.contains('hidden'));
 start.value='09:00';end.value='18:00';const kind=w.document.querySelector('#mondayType');kind.value='無班';w.toggleDayTime('monday');assert(start.parentElement.classList.contains('hidden'));
 kind.value='標準打卡';w.toggleDayTime('monday');assert(!start.parentElement.classList.contains('hidden'));assert.equal(start.value,'');assert.equal(end.value,'');start.value='09:00';end.value='18:00';w.updateDayPreview('monday');assert.match(w.document.querySelector('#mondayPreview').textContent,/09:00-18:00/);
 assert(w.document.querySelector('#mondayPreview').closest('details'));dom.window.close();
});
