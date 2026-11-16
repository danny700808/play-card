const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),policy=require('../management-pending-records'),{countsFor}=require('../management-pending-counts'),scope=require('../personnel-approval-scope'),routes=require('../internal-workspace-routes');
const read=n=>fs.readFileSync(path.join(__dirname,'..',n),'utf8');
const empty={leave:[],clock:[],temporary:[],profile:[],registration:[],contract:[],certificate:[],goods:[],rental:[],enrollment:[]};
test('new teacher review deduplicates profile/contract mirrors and excludes drafts, approved and returned records',()=>{
 const contracts=[{id:'new',registrationOnly:true,status:'submitted_pending_admin'},{id:'signed',status:'submitted_pending_admin'},{id:'approved',status:'active'},{id:'revision',status:'needs_revision',progressStatus:'老師已送出'}];
 const profiles=[{id:'p',currentContractId:'new',registrationOnly:true,status:'submitted_pending_admin'},{id:'old',currentContractId:'approved',profileStatus:'submitted_pending_admin'},{id:'draft',status:'draft'}];
 const rows=policy.mergeExternalTeacherRows(contracts,profiles),c=countsFor({...empty,contract:rows},[],scope);
 assert.equal(c['external-teacher-review'],1);assert.equal(c['external-contract-review'],1);assert.equal(c['external-approvals'],2);assert.equal(c.external,2);assert.equal(c.people,2);assert.equal(c.root,2);
 for(const [node,type] of [['external-teacher-review','registration'],['external-contract-review','contract']]){const url=new URL(routes.treeLink(routes.treeNode(node)),'https://example.test');assert.equal(url.searchParams.get('reviewType'),type);assert.equal(c[node],policy.teacherReviewRows(rows,type).length);}
});
test('rental pending list includes return requests, deduplicates cases, excludes converted or canceled records',()=>{
 const rows=[{kind:'application',__id:'a',status:'待店家確認'},{kind:'application',__id:'old',contractId:'c',status:'待店家確認'}, {kind:'contract',__id:'c',applicationId:'a',status:'待付款確認'}, {kind:'contract',__id:'r',status:'退租待安排'}, {kind:'contract',__id:'expired',status:'到期提醒中',endDate:'2000-01-01'}, {kind:'contract',__id:'cancelled',status:'已取消',pendingRenewal:{startDate:'2026-11-17'}}, {kind:'contract',__id:'returned',status:'已退租',pendingRenewal:{periods:1}}];
 const before=JSON.stringify(rows),selected=policy.rentalPendingRows(rows),c=countsFor({...empty,rental:rows},[],scope);
 assert.equal(selected.length,3);assert.equal(c.rental,3);assert.equal(c['rental-overdue'],1);assert.equal(c['rental-reminder'],1);assert.equal(JSON.stringify(rows),before);
 assert.equal(new URL(routes.treeLink(routes.treeNode('rental-applications')),'https://example.test').searchParams.get('filter'),'pending');
});
test('enrollment count includes unresolved registrations only, including pages after the first 100 records',async()=>{
 let calls=0;const rows=await policy.readEnrollmentRows(async(name,d)=>{assert.equal(name,'enrollmentAdmin');calls++;return d.cursor?{records:[{id:'pending',status:'contacted'}],nextCursor:''}:{records:Array.from({length:100},(_,i)=>({id:String(i),status:'scheduled'})),nextCursor:'99'};});
 assert.equal(calls,2);const c=countsFor({...empty,enrollment:rows},[],scope);assert.equal(c['online-enrollment'],1);assert.equal(c.enrollment,1);assert.equal(c.root,1);
 assert.equal(countsFor({...empty,enrollment:null},[],scope).root,null);
 await assert.rejects(policy.readEnrollmentRows(async()=>({records:[],nextCursor:'same'})),/分頁/);
});
function fixture(){const d=new JSDOM('<section data-management-tree="root"></section><span id="badge-approval"></span>',{url:'https://example.test/settings.html',runScripts:'outside-only'});const w=d.window;w.InternalWorkspaceRoutes=routes;w.eval(read('management-tree.js'));return d;}
test('zero, failed, stale, invalid and not-yet-loaded badges are hidden, including after tree navigation',()=>{
 const d=fixture(),w=d.window,b=()=>w.document.querySelector('#node-count-external-teacher-review');
 assert.equal(b().hidden,true);w.InternalManagementTree.setNodeCount('external-teacher-review',1);assert.equal(b().textContent,'1');assert.equal(b().hidden,false);
 for(const v of [0,null,undefined,NaN,-1,0.5,'?']){w.InternalManagementTree.setNodeCount('external-teacher-review',v);assert.equal(b().hidden,true);assert.equal(b().textContent,'');}
 w.InternalManagementTree.setNodeCount('external-teacher-review',3);w.InternalManagementTree.clearCounts();w.location.hash='external';w.dispatchEvent(new w.HashChangeEvent('hashchange'));assert.equal(b().hidden,true);assert.equal(b().textContent,'');d.window.close();
});
test('failed refresh clears previously displayed counts and never queries the disconnected legacy application API',async()=>{
 const d=fixture(),w=d.window;await new Promise(r=>w.addEventListener('load',r,{once:true}));
 w.getUser=()=>({id:'manager'});w.hasSettingsZoneAccess=()=>true;w.ensureHrSession=async()=>{};w.PersonnelApprovalScope=scope;
 w.api=async action=>{assert.notEqual(action,'getTeacherApplicationsAdmin');return {ok:true,rows:[]};};
 w.YZProtectedData={call:async name=>name==='enrollmentAdmin'?{records:[],nextCursor:''}:{rows:[]}};
 w.firebase={firestore:()=>({collection:name=>({get:async()=>({docs:name==='externalTeacherContracts'?[{id:'new',data:()=>({registrationOnly:true,status:'submitted_pending_admin'})}]:[]})})})};
 w.eval(read('management-pending-records.js'));w.eval(read('management-pending-counts.js'));await w.PersonalPendingCounts.refresh();
 assert.equal(w.document.querySelector('#node-count-external-teacher-review').textContent,'1');assert.equal(w.document.querySelector('#badge-approval').textContent,'1');assert.equal(w.document.querySelector('#pendingTreeStatus').textContent,'');
 w.ensureHrSession=async()=>{throw Error('expired');};await w.PersonalPendingCounts.refresh();
 assert.equal(w.document.querySelector('#node-count-external-teacher-review').textContent,'');assert.equal(w.document.querySelector('#badge-approval').textContent,'');assert.match(w.document.querySelector('#pendingTreeStatus').textContent,/讀取失敗/);d.window.close();
});
test('legacy recruiting remains accessible under Common functions and is not confused with new teacher registration',()=>{
 assert(!routes.treeNode('recruit').children.some(n=>n.id==='recruit-applications'));assert(routes.treeNode('recruit').common.some(n=>n.id==='recruit-applications'));
});
test('changed HTML inline scripts compile and their shared policy loads before consumers',()=>{
 const vm=require('node:vm');for(const file of ['external-teacher-admin.html','rental-admin.html','settings.html','hr-payroll-settings-hub.html','enrollment-admin.html']){const dom=new JSDOM(read(file));for(const s of dom.window.document.querySelectorAll('script:not([src])'))new vm.Script(s.textContent,{filename:file});const scripts=[...dom.window.document.querySelectorAll('script[src]')].map(x=>x.getAttribute('src'));assert(scripts.some(x=>x.startsWith('management-pending-records.js?')));dom.window.close();}
});
