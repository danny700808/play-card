const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const routes=require('../internal-workspace-routes.js');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('all tree destinations exist and preserve existing filters and anchors',()=>{
 const ids=new Set();
 function visit(node){assert(!ids.has(node.id));ids.add(node.id);if(node.href){const original=new URL(node.href,'https://example.test/'),linked=new URL(routes.treeLink(node),'https://example.test/');assert(fs.existsSync(path.join(__dirname,'..',original.pathname)));assert.equal(linked.hash,original.hash);for(const [key,value] of original.searchParams)assert.equal(linked.searchParams.get(key),value);}for(const child of [...node.children||[],...node.common||[]])visit(child);}
 visit(routes.tree);
 assert.deepEqual(routes.treeNode('people').children.map(n=>n.id),['staff','parttime','external','recruit']);
});
test('same shared page retains chosen personnel branch, with safe default and invalid-context rejection',()=>{
 const ids=(file,query)=>routes.pageContext('/'+file,query,'').map(n=>n.id);
 assert.deepEqual(ids('salary-admin.html','?type=staff'),['root','people','staff','staff-salary']);
 assert.deepEqual(ids('salary-admin.html','?type=parttime&nav=staff-salary'),['root','people','parttime','parttime-salary']);
 assert.deepEqual(ids('schedule-admin.html','?nav=parttime-schedule'),['root','people','parttime','parttime-schedule']);
 assert.deepEqual(ids('schedule-admin.html',''),['root','people','all-schedule']);
 assert.deepEqual(ids('employment-certificate-admin-issue.html','?identity=staff'),['root','people','staff','staff-certificate']);
 assert.deepEqual(ids('employee-admin.html','?type=external&source=teacher-hub'),['root','people','external','external-people']);
 assert(!ids('rental-admin.html','?nav=staff-salary').includes('staff'));
});
function fixture(hash=''){
 const dom=new JSDOM('<main><section data-management-tree="root"></section></main>',{url:'https://example.test/settings.html'+hash,runScripts:'outside-only'});
 dom.window.InternalWorkspaceRoutes=routes;dom.window.eval(read('management-tree.js'));return dom;
}
test('tree exposes deep links in one map, supports focus, history and safe invalid hashes',async()=>{
 const dom=fixture(),w=dom.window,doc=w.document;
 assert.ok(doc.querySelector('[data-node-id=staff-salary]'));assert.ok(doc.querySelector('[data-node-id=parttime-leave-review]'));assert.ok(doc.querySelector('[data-node-id=external-contract-review]'));
 w.location.hash='people';w.dispatchEvent(new w.HashChangeEvent('hashchange'));
 assert.ok(doc.querySelector('[data-node-id=staff-salary]'));assert.ok(doc.querySelector('[data-node-id=parttime-salary]'));assert.ok(!doc.querySelector('[data-node-id=rental-applications]'));
 assert.equal(doc.querySelector('.management-up').getAttribute('href'),'#root');
 w.location.hash='parttime';w.dispatchEvent(new w.HashChangeEvent('hashchange'));
 assert.equal(doc.querySelector('.management-ancestor.is-current').textContent,'工讀生');
 const salary=[...doc.querySelectorAll('.management-node')].find(n=>n.textContent.includes('薪資與投保'));
 assert.equal(salary.getAttribute('href'),'salary-admin.html?type=parttime&nav=parttime-salary');
 assert.equal(doc.querySelector('.management-up').getAttribute('href'),'#people');
 w.history.back();await new Promise(resolve=>w.setTimeout(resolve,20));
 assert.equal(doc.querySelector('.management-ancestor.is-current').textContent,'人事');
 w.location.hash='<script>';w.dispatchEvent(new w.HashChangeEvent('hashchange'));
 assert.equal(doc.querySelector('.management-ancestor.is-current').textContent,'管理工作區');
 dom.window.close();
});
test('changing personnel type updates breadcrumbs without touching inputs or making requests',()=>{
 const dom=new JSDOM('<nav data-yz-global-nav></nav><main><input value="preserved"></main>',{url:'https://example.test/salary-admin.html?type=staff&employeeId=sample',runScripts:'outside-only'});
 const w=dom.window;w.InternalWorkspaceRoutes=routes;w.localStorage.setItem('employeeUser',JSON.stringify({id:'admin',role:'admin'}));
 w.eval(read('internal-workspace.js'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 w.InternalWorkspaceNavigation.setPersonnelType('parttime');
 assert.equal(new URL(w.location.href).searchParams.get('employeeId'),'sample');
 assert.match(w.document.querySelector('.internal-breadcrumbs').textContent,/工讀生/);
 assert.doesNotMatch(w.document.querySelector('.internal-breadcrumbs').textContent,/專職/);
 assert.equal(w.document.querySelector('input').value,'preserved');
 dom.window.close();
});
