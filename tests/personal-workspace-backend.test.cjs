'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./helpers/security-fixtures.cjs');
const {createPersonalWorkspace}=require('../functions/personalWorkspace');
const user={employeeId:'e1',email:'one@example.test',name:'Employee',identityType:'parttime',accountStatus:'active'},request={auth:{uid:'u1',token:{employee:true,employeeId:'e1',email:user.email}}};
function fixture(extra={},options={}){const f=database({'employees/e1':user,...extra});let minted=0;const service=createPersonalWorkspace({...f,auth:{getUserByEmail:async()=>({uid:'u1',customClaims:{employee:true,employeeId:'e1'}}),createCustomToken:async()=>{minted++;return 'token';}},findPortalAccount:async()=>null,issuePortalSession:async()=>({sessionToken:'session'}),requirePortalSession:async()=>({role:'teacher',teacherId:'t1',authAccountId:'a1'}),...options});return {...f,service,minted:()=>minted};}
test('legacy contact fields remain visible and stale review compares the original values',()=>{
 const {profileOf,reviewedProfilePatch}=require('../functions/personalWorkspace');const row={employeeId:'e1',phone:'0900000000','聯絡地址':'原地址',bankAccountNumber:'01234567890123'};
 assert.equal(profileOf(row).mobilePhone,row.phone);assert.equal(profileOf(row).address,'原地址');assert.equal(profileOf(row).bankAccount,row.bankAccountNumber);
 assert.throws(()=>reviewedProfilePatch({employeeId:'e1',changes:[{key:'address',before:'',after:'新地址'}]},row,'e1'));
 assert.equal(profileOf({...row,mobilePhone:'0911111111'}).mobilePhone,'0911111111');
});
test('personal overview verifies identity and omits payment history',async()=>{
 const f=fixture({'employeeSalaryPayments/p1':{employeeId:'e1',status:'paid',paidDate:'2026-10-05',month:'2026-09',amount:500},'employeeSalaryPayments/p2':{employeeId:'e2',status:'paid',amount:90000,paidDate:'2026-10-05'},'employeeSalaryPayments/p3':{employeeId:'e1',status:'draft',paidDate:'2026-10-05',amount:800}});
 await assert.rejects(f.service.handle({},{}));await assert.rejects(f.service.handle({}, {auth:{token:{...request.auth.token,employeeId:'e2'}}}));
 await assert.rejects(f.service.handle({action:'profile-submit',expectedEmployeeId:'e2',profile:{address:'must not write'}},request));assert.equal([...f.rows.keys()].filter(k=>k.startsWith('profileChangeRequests/')).length,0);
 const r=await f.service.handle({employeeId:'e2'},request);assert.equal(r.user.employeeId,'e1');assert.equal(r.payments,undefined);assert.deepEqual(r.capabilities,{attendance:true,teacher:false,renter:false});assert.equal(r.profile.password,undefined);assert.equal(r.user.passwordHash,undefined);
 f.rows.get('employees/e1').accountStatus='disabled';await assert.rejects(f.service.handle({},request));
});
test('capabilities require existing verified portal accounts; caller cannot invent a role',async()=>{
 const f=fixture();await assert.rejects(f.service.handle({action:'open-role',role:'teacher'},request));await assert.rejects(f.service.handle({action:'open-role',role:'admin'},request));
 const linked=fixture({}, {findPortalAccount:async(role,email)=>role==='teacher'&&email===user.email?{type:'teacher',targetId:'t1',authAccountId:'a1'}:null});
 assert.equal((await linked.service.handle({},request)).capabilities.teacher,true);assert.equal((await linked.service.handle({action:'open-role',role:'teacher',targetId:'someone-else'},request)).sessionToken,'session');
});
test('teacher to staff entry needs verified session-owned binding and existing non-manager claims',async()=>{
 const f=fixture({'coursePortalTeacherBindings/b':{teacherId:'other',authAccountId:'a1',status:'active',emailVerified:true,emailNormalized:user.email}});
 assert.equal((await f.service.handle({action:'portal-capabilities'},{})).employee,null);
 f.rows.get('coursePortalTeacherBindings/b').teacherId='t1';f.rows.get('coursePortalTeacherBindings/b').emailVerified=false;assert.equal((await f.service.handle({action:'portal-capabilities'},{})).employee,null);
 f.rows.get('coursePortalTeacherBindings/b').emailVerified=true;assert.equal((await f.service.handle({action:'portal-capabilities'},{})).employee.identityType,'parttime');assert.equal(f.minted(),0);
 await f.service.handle({action:'employee-entry'},{});assert.equal(f.minted(),1);
 const denied=fixture({'coursePortalTeacherBindings/b':{teacherId:'t1',authAccountId:'a1',status:'active',emailVerified:true,emailNormalized:user.email}},{auth:{getUserByEmail:async()=>({uid:'u1',customClaims:{employee:true,employeeId:'e1',manager:true}})}});await assert.rejects(denied.service.handle({action:'employee-entry'},{}));
});
test('profile supplement queues a review without changing identity, payroll or canonical values; duplicate submits keep history',async()=>{
 const f=fixture();const payload={action:'profile-submit',employeeId:'e2',profile:{mobilePhone:'0912345678',bankAccount:'01234567890123',role:'admin',identityType:'staff',employeeId:'e2',email:'attacker@example.test',salary:999999}};
 const results=await Promise.allSettled([f.service.handle(payload,request),f.service.handle(payload,request)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(f.rows.get('employees/e1'),user);
 const rows=[...f.rows].filter(([k])=>k.startsWith('profileChangeRequests/'));assert.equal(rows.length,1);const [key,r]=rows[0];assert.equal(r.employeeId,'e1');assert.equal(r.identityType,'parttime');assert.equal(r.email,undefined);assert.equal(r.salary,undefined);assert.equal(r.bankAccount,'01234567890123');
 f.rows.set(key,{...r,status:'已核准',approvalStatus:'approved'});await f.service.handle({...payload,profile:{address:'新地址'}},request);assert.equal([...f.rows.keys()].filter(k=>k.startsWith('profileChangeRequests/')).length,2);assert.equal(f.rows.get(key).approvalStatus,'approved');
});
test('manager approval of a mobile supplement refuses stale or cross-person changes',()=>{
 const {reviewedProfilePatch}=require('../functions/personalWorkspace');const row={employeeId:'e1',changes:[{key:'address',before:'原地址',after:'新地址'}]};
 assert.deepEqual(reviewedProfilePatch(row,{employeeId:'e1',address:'原地址'},'e1'),{address:'新地址',contactAddress:'新地址'});
 assert.throws(()=>reviewedProfilePatch(row,{employeeId:'e2',address:'原地址'},'e2'));
 assert.throws(()=>reviewedProfilePatch(row,{employeeId:'e1',address:'主管已更新'},'e1'));
 assert.throws(()=>reviewedProfilePatch({employeeId:'e1',changes:[{key:'role',before:'staff',after:'admin'}]},user,'e1'));
});
test('cash payment queues review without clearing existing bank data',async()=>{
 const f=fixture({'employees/e1':{...user,bankAccount:'01234567890123'}});
 await f.service.handle({action:'profile-submit',profile:{paymentMethod:'cash',bankAccount:'invalid'}},request);
 const row=[...f.rows].find(([key])=>key.startsWith('profileChangeRequests/'))[1];
 assert.equal(row.paymentMethod,'cash');assert.equal(row.bankAccount,undefined);assert.equal(f.rows.get('employees/e1').bankAccount,'01234567890123');
 const {reviewedProfilePatch}=require('../functions/personalWorkspace');assert.deepEqual(reviewedProfilePatch(row,f.rows.get('employees/e1'),'e1'),{paymentMethod:'cash'});
});
test('teacher preview requires a manager and forwards only the chosen teacher identity',async()=>{
 const calls=[];const f=fixture({'admins/m1':{employeeId:'m1',email:'manager@example.test',role:'admin',accountStatus:'active'}},{teacherRead:async(...args)=>{calls.push(args);return {ok:true};}});
 const input={action:'teacher-read',teacherId:'t1',method:'coursePortalTeacherData',payload:{teacherId:'t2'}};
 await assert.rejects(f.service.handle(input,request));assert.equal(calls.length,0);
 await f.service.handle(input,{auth:{token:{employee:true,manager:true,employeeId:'m1',email:'manager@example.test'}}});assert.equal(calls[0][0],'t1');assert.equal(f.minted(),0);
});
test('employee rental preview resolves its existing binding and ignores a supplied target',async()=>{
 const calls=[];const f=fixture({'admins/m1':{employeeId:'m1',email:'manager@example.test',role:'admin',accountStatus:'active'}},{findPortalAccount:async(role,email)=>role==='renter'&&email===user.email?{targetId:'',renterId:'r1'}:null,portalRoleRead:async(...args)=>{calls.push(args);return {ok:true};}});
 const input={action:'preview-role-read',employeeDocId:'e1',role:'renter',targetId:'wrong',method:'coursePortalRentalMyBookings',payload:{renterId:'wrong'}};
 await assert.rejects(f.service.handle(input,request));
 await f.service.handle(input,{auth:{token:{employee:true,manager:true,employeeId:'m1',email:'manager@example.test'}}});
 assert.deepEqual(calls[0].slice(0,2),['renter','r1']);assert.equal(f.minted(),0);
});
test('employee form preview uses selected-person scope and rejects write methods',async()=>{
 const f=fixture({'admins/m1':{employeeId:'m1',email:'manager@example.test',role:'admin',accountStatus:'active'},'employees/e2':{...user,employeeId:'e2',email:'other@example.test'}}),manager={auth:{token:{employee:true,manager:true,employeeId:'m1',email:'manager@example.test'}}};
 const input={action:'preview-employee-read',employeeDocId:'e1',method:'employeeDataRead',payload:{collection:'employees',id:'e2'}};
 assert.deepEqual((await f.service.handle(input,manager)).rows,[]);
 const own=await f.service.handle({...input,payload:{collection:'employees',id:'e1'}},manager);assert.equal(own.rows[0].data.employeeId,'e1');
 await assert.rejects(f.service.handle({...input,method:'employeeSelfService'},manager));await assert.rejects(f.service.handle(input,request));
});
test('manager employee preview is read-only, rejects employee impersonation and uses the selected canonical person',async()=>{
 const f=fixture({'admins/m1':{employeeId:'m1',email:'manager@example.test',name:'Manager',role:'admin',accountStatus:'active'},'employees/e2':{...user,employeeId:'e2',email:'two@example.test',name:'Other',identityType:'staff'}});
 const manager={auth:{token:{employee:true,manager:true,employeeId:'m1',email:'manager@example.test'}}};
 await assert.rejects(f.service.handle({action:'preview',employeeDocId:'e2'},request));await assert.rejects(f.service.handle({action:'preview-roster'},request));
 const original=JSON.stringify([...f.rows]);const roster=await f.service.handle({action:'preview-roster'},manager);assert.deepEqual(roster.rows.map(r=>r.id),['e1','e2']);assert.equal(roster.rows[0].email,undefined);
 const view=await f.service.handle({action:'preview',employeeDocId:'e1',expectedEmployeeId:'m1'},manager);assert.equal(view.user.name,'Employee');assert.equal(view.user.id,'e1');assert.equal(view.readOnly,true);assert.equal(JSON.stringify([...f.rows]),original);assert.equal(f.minted(),0);
 await assert.rejects(f.service.handle({action:'preview',employeeDocId:'missing'},manager));
});
