'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const {database}=require('./helpers/security-fixtures.cjs');
const {createTeacherApprovalSync}=require('../functions/teacherApprovalSync');
const {createUnifiedEmailLogin}=require('../functions/unifiedEmailLogin');
const {createUnifiedLogin}=require('../functions/unifiedLogin');
const {createPersonalWorkspace}=require('../functions/personalWorkspace');
const access=require('../functions/teacherRegistrationAccess');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const profile={name:'測試老師',mobile:'0912345678',email:'teacher@example.test',emailBindStatus:'bound',lineBindStatus:'pending',bindingMethod:'email',registrationOnly:true,contractStatus:'not_requested',status:'submitted_pending_admin',profileSubmittedAt:'2026-11-17',idNumber:'TEST',birthDate:'1990-01-01',householdAddress:'測試地址',mailingAddress:'測試地址',emergencyContact:'聯絡人',emergencyPhone:'0912345679',identityUrls:['https://example.test/private-proof'],teachingAbilities:[{subjectId:'g',item:'木吉他',level:'專業'}]};
function setup(extra={}){
 const f=database({'externalTeacherContracts/p1':profile,'externalTeacherProfiles/p1':profile,'opsEducationMirrorSubjects/g':{sourceActive:true,source:{id:'g',name:'木吉他',active:true}},...extra});
 const original=f.db.runTransaction.bind(f.db);
 f.db.runTransaction=fn=>original(tx=>{const get=tx.get;let wrote=false;tx.get=ref=>{assert.equal(wrote,false,'Firestore transaction read after write');return ref.path?get(ref):ref.get();};for(const key of ['set','update','create','delete']){const write=tx[key];tx[key]=(...args)=>{wrote=true;return write(...args);};}return fn(tx);});
 const source=fs.readFileSync('functions/coursePortal.js','utf8'),ctx={db:f.db,clean:v=>String(v??'').trim(),normalizeEmail:v=>String(v||'').trim().toLowerCase(),bindingCollection:role=>'coursePortal'+role[0].toUpperCase()+role.slice(1)+'Bindings',require:name=>{assert.equal(name,'./teacherRegistrationAccess');return access;}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function findEmailLoginAccount('),source.indexOf('async function prepareLineRegistrationIdentity(')),ctx);
 const find=ctx.findEmailLoginAccount,approve=createTeacherApprovalSync(f),users=new Map(),sent=[];
 const auth={getUserByEmail:async email=>{const u=[...users.values()].find(u=>u.email===email);if(!u)throw Object.assign(Error('missing'),{code:'auth/user-not-found'});return u;},getUser:async id=>users.get(id),createUser:async u=>{users.set(u.uid,u);return u;},setCustomUserClaims:async(id,c)=>{users.get(id).customClaims=c;},createCustomToken:async id=>'test-token:'+id};
 const issued=[];const issue=async row=>{issued.push(row);return {sessionToken:'test-portal-session'};};
 const email=createUnifiedEmailLogin({...f,auth,sendEmail:async row=>sent.push(row),findPortalAccount:find,issuePortalSession:issue});
 const line=createUnifiedLogin({...f,auth,hash,randomToken:()=>crypto.randomBytes(32).toString('base64url'),Timestamp:{fromMillis:v=>v},findPortalAccount:find,issuePortalSession:issue,bindingsForLine:async()=>[],decideLineLoginBinding:()=>({action:'setup'})});
 const workspace=createPersonalWorkspace({...f,auth,findPortalAccount:find,issuePortalSession:issue});
 return {...f,approve,find,email,line,workspace,users,sent,issued};
}
test('approval opens only the approved teacher email account and queues one complete entry notice',async()=>{
 const f=setup();assert.equal(await f.find('teacher',profile.email),null);
 const result=await f.approve('p1','manager');assert.equal(result.courseLoginReady,true);
 const found=await f.find('teacher',profile.email);assert.equal(found.targetId,result.teacherId);assert.equal(found.lineUserId,'');
 const binding=[...f.rows].find(([p])=>p.startsWith('coursePortalTeacherBindings/'))[1];
 assert.equal(binding.canonicalEmployeeId,result.employeeId);assert.equal(binding.registrationProfileId,'p1');assert.equal(f.rows.get('externalTeacherProfiles/p1').portalProfileVersion,2);
 const notice=f.rows.get('notificationQueue/teacher-registration-approved-p1');assert.match(notice.body,/六碼驗證碼/);assert.match(notice.body,/不需要重填資料或貼綁定碼/);assert.equal(notice.targetEmail,profile.email);
 await f.approve('p1','manager');assert.equal([...f.rows.keys()].filter(p=>p.startsWith('notificationQueue/')).length,1);assert.equal([...f.rows.keys()].filter(p=>p.startsWith('coursePortalTeacherBindings/')).length,1);
});
test('first LINE plus email OTP connects contact and login; later LINE enters the same teacher without another OTP',async()=>{
 const f=setup(),approved=await f.approve('p1','manager'),proof='a'.repeat(64),lineUserId='U'+'1'.repeat(32);
 const ticket=await f.line.issue({lineUserId,displayName:'Teacher LINE'},{challenge:hash(proof)});
 assert.equal((await f.line.status({ticket,proof})).choices.length,0);
 const challenge=await f.email.send({email:profile.email,proof,ticket});
 const first=await f.email.verify({challengeToken:challenge.challengeToken,proof,code:f.sent[0].body.match(/\d{6}/)[0]});
 assert.equal(first.user.courseLoginReady,true);assert.equal(first.user.isManagerAccount,false);
 const employee=f.rows.get('employees/'+approved.employeeId);assert.equal(employee.lineUserId,lineUserId);assert.equal(f.rows.get('externalTeacherProfiles/p1').lineBindStatus,'bound');
 const next=await f.line.issue({lineUserId},{challenge:hash(proof)}),choices=await f.line.status({ticket:next,proof});assert.equal(choices.choices[0].id,'employee');
 const repeat=await f.line.redeem({ticket:next,proof,choice:'employee'});assert.equal(repeat.user.employeeId,approved.employeeId);assert.equal(f.sent.length,1);
 const opened=await f.workspace.handle({action:'open-role',role:'teacher'},{auth:{token:{employee:true,email:profile.email,employeeId:approved.employeeId}}});
 assert.equal(opened.sessionToken,'test-portal-session');assert.equal(f.issued.at(-1).targetId,approved.teacherId);
});
test('email-only entry works without creating any LINE binding',async()=>{
 const f=setup();await f.approve('p1','manager');const proof='b'.repeat(64),challenge=await f.email.send({email:profile.email,proof});
 const result=await f.email.verify({proof,challengeToken:challenge.challengeToken,code:f.sent[0].body.match(/\d{6}/)[0]});assert.equal(result.user.courseLoginReady,true);
 assert(![...f.rows.keys()].some(p=>p.startsWith('employeeLoginBindings/')));assert.equal(f.rows.get('externalTeacherProfiles/p1').lineBindStatus,'pending');
});
test('pending, disabled and mismatched teachers cannot gain or retain approved registration access',async()=>{
 const pending=setup({'externalTeacherContracts/p1':{...profile,status:'waiting_contract'}});await assert.rejects(pending.approve('p1','manager'));assert.equal(await pending.find('teacher',profile.email),null);
 for(const patch of [{accountStatus:'disabled'},{hiddenFromActiveLists:true},{profileReviewStatus:'pending'},{coursePortalTeacherId:'other'}]){
  const f=setup(),result=await f.approve('p1','manager');Object.assign(f.rows.get('employees/'+result.employeeId),patch);assert.equal(await f.find('teacher',profile.email),null);
 }
});
test('duplicate email, administrator email, other teacher bindings and revoked access block approval atomically',async()=>{
 for(const extra of [{'employees/other':{email:profile.email}},{'admins/admin':{loginAccount:profile.email}},{'coursePortalTeacherBindings/other':{teacherId:'other',emailNormalized:profile.email,status:'active'}},{'coursePortalTeacherBindings/old':{teacherId:'old',emailNormalized:profile.email,status:'revoked'}}]){
  const f=setup(extra),before=structuredClone([...f.rows]);await assert.rejects(f.approve('p1','manager'));assert.deepEqual([...f.rows],before);
 }
});
test('LINE already owned by another person cannot be reassigned by approved teacher OTP',async()=>{
 const lineUserId='U'+'2'.repeat(32),f=setup({'employees/other':{lineUserId,email:'other@example.test'}});await f.approve('p1','manager');
 const proof='c'.repeat(64),ticket=await f.line.issue({lineUserId},{challenge:hash(proof)}),challenge=await f.email.send({email:profile.email,proof,ticket});
 await assert.rejects(f.email.verify({proof,challengeToken:challenge.challengeToken,code:f.sent[0].body.match(/\d{6}/)[0]}),/不一致/);
 assert.equal(f.rows.get('externalTeacherProfiles/p1').lineBindStatus,'pending');assert(![...f.rows.keys()].some(p=>p.startsWith('employeeLoginBindings/')));
});
