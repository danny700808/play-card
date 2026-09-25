'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto');
const {createSharedAccess,hash}=require('../functions/sharedCalendarAccess');
const {createSharedLogin}=require('../functions/sharedCalendarLogin');
const {createSharedLine}=require('../functions/sharedCalendarLine');
const {createSharedCore}=require('../functions/sharedCalendarCore');
function database(initial){
 const rows=new Map(Object.entries(structuredClone(initial)));let serial=Promise.resolve();
 const snap=p=>({id:p.split('/').at(-1),ref:ref(p),exists:rows.has(p),data:()=>structuredClone(rows.get(p))});
 const ref=p=>({path:p,id:p.split('/').at(-1),get:async()=>snap(p),set:async(v,o)=>rows.set(p,{...(o?.merge?rows.get(p):{}),...structuredClone(v)}),create:async v=>{if(rows.has(p))throw Error('exists');rows.set(p,structuredClone(v));},delete:async()=>rows.delete(p)});
 const query=(name,filters=[])=>({doc:id=>ref(name+'/'+id),where:(k,op,v)=>query(name,[...filters,[k,v]]),get:async()=>({docs:[...rows].filter(([p,r])=>p.startsWith(name+'/')&&p.split('/').length===name.split('/').length+1&&filters.every(([k,v])=>r[k]===v)).map(([p])=>snap(p))})});
 const db={doc:ref,collection:query,runTransaction(fn){const job=serial.then(async()=>{const writes=[];let writing=false;const tx={delete:r=>{writing=true;writes.push(()=>rows.delete(r.path));},get:async r=>{assert(!writing,'Firestore reads must precede writes');return snap(r.path);},set:(r,v,o)=>{writing=true;writes.push(()=>rows.set(r.path,{...(o?.merge?rows.get(r.path):{}),...structuredClone(v)}));},update:(r,v)=>{writing=true;writes.push(()=>rows.set(r.path,{...rows.get(r.path),...structuredClone(v)}));},create:(r,v)=>{writing=true;assert(!rows.has(r.path));writes.push(()=>rows.set(r.path,structuredClone(v)));}};const result=await fn(tx);writes.forEach(f=>f());return result;});serial=job.catch(()=>{});return job;}};return {db,rows};
}
function setup(options={}){
 const f=database({'privateCalendarServer/access':{uid:'owner'},'employees/helper':{name:'Assistant',email:'fixture@example.test',accountStatus:'active',lineUserId:'U'+'b'.repeat(32)}}),sent=[],files=new Map();
 let passwordless;const mail=[];
 const auth=createSharedAccess({passwordless:()=>passwordless,db:f.db,ownerSession:async token=>{if(token!=='owner-secret')throw Error('private denial');return {uid:'owner',createdAt:Date.now()};},verifier:options.verifier});
 passwordless=createSharedLogin({db:f.db,auth,sendEmail:async(to,subject,text)=>mail.push({to,subject,text}),authorizationUrl:state=>'https://example.test/?state='+state});
 const lineBindings=createSharedLine({db:f.db,botId:async()=>'@fixture'});
 const core=createSharedCore({lineBindings,db:f.db,auth,bucket:()=>({file:p=>({save:async b=>files.set(p,b),download:async()=>[files.get(p)]})}),ownerLine:async()=>options.noOwnerLine?null:'U'+'a'.repeat(32),sendLine:async(to,message,key)=>{if(options.failSend)throw Error('temporary LINE failure');sent.push({to,message,key});}});
 const owner=(action,data={})=>core.api({data:{action,calendarSession:'owner-secret',...data}});
 const ar=(action,data={})=>auth.api({data:{action,...data},rawRequest:{ip:'test-'+(data.memberId||data.invite||action)}});
 async function activate(invite,email=crypto.randomUUID()+'@example.test'){const verifier=crypto.randomBytes(32).toString('base64url'),r=await ar('emailLoginStart',{invite,email,challenge:hash(verifier)});return ar('loginRedeem',{ticket:r.ticket,verifier,code:mail.at(-1).text.match(/\d{6}/)[0]});}
 async function join(name='Assistant'){const inv=await owner('invite',{name,contactKey:'employees/helper'}),invite=inv.url.split('#invite=')[1],login=await activate(invite);const row=f.rows.get('sharedCalendarMembers/'+login.memberId);row.email='';row.emailVerifiedAt=0;return {...login,invite,call:(action,data={})=>core.api({data:{action,teamSession:login.token,...data}})};}
 return {...f,auth,core,lineBindings,passwordless,mail,sent,files,owner,ar,join,activate,options};
}
const event=()=>({title:'客人換吉他弦',note:'先確認客人需求',start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),remind:true,reminderMinutes:10});
test('single-use invitation creates separate member credentials; plaintext tokens are not stored',async()=>{
 const f=setup(),m=await f.join();assert.match(m.token,/^[\w-]{43}$/);assert.equal((await m.call('status')).me.role,'member');assert(!JSON.stringify([...f.rows.values()]).includes(m.token));await assert.rejects(f.activate(m.invite),/失效/);await assert.rejects(m.call('invite',{name:'Other'}),/管理者/);
 await assert.rejects(f.ar('password',{memberId:m.memberId,password:'long-fixture-password'}),/LINE 或 Email/);
});
test('expired, revoked, and reissued invites cannot activate; revocation invalidates existing sessions',async()=>{
 const f=setup(),inv=await f.owner('invite',{name:'Expired'}),token=inv.url.split('#invite=')[1];f.rows.get('sharedCalendarInvites/'+hash(token)).expiresAt=0;await assert.rejects(f.activate(token),/過期/);
 const m=await f.join();await f.owner('revoke',{memberId:m.memberId});await assert.rejects(m.call('status'),/取消/);await assert.rejects(f.ar('password',{memberId:m.memberId,password:'long-fixture-password'}));
 const inv2=await f.owner('reinvite',{memberId:m.memberId});await assert.rejects(m.call('status'));const login=await f.activate(inv2.url.split('#invite=')[1]);assert.ok(login.token);
});
test('member sees only created or assigned tasks; private API identity cannot be forged',async()=>{
 const f=setup(),a=await f.join('A'),b=await f.join('B');await a.call('save',{id:'a-task',event:event(),assignedTo:'owner',ownerUid:'forged',createdBy:'owner'});await a.call('publish',{id:'a-task'});
 assert.equal(f.rows.get('sharedCalendarTasks/a-task').createdBy,a.memberId);await assert.rejects(b.call('detail',{id:'a-task'}));await assert.rejects(b.call('save',{id:'a-task',revision:1,event:event()}));
 const span={start:new Date(Date.now()-86400000).toISOString(),end:new Date(Date.now()+86400000).toISOString()};assert.equal((await b.call('list',span)).tasks.length,0);assert.equal((await f.owner('list',span)).tasks.length,1);
 await assert.rejects(f.core.api({data:{action:'status',calendarSession:a.token}}));await assert.rejects(f.core.api({data:{action:'status',teamSession:'fake',role:'owner'}}));
});
test('attachments remain scoped and notifications are sent only after publish, once',async()=>{
 const f=setup(),a=await f.join(),b=await f.join();await a.call('save',{id:'work',event:event(),assignedTo:'owner'});assert.equal(f.sent.length,0);
 await a.call('upload',{id:'work',assetId:'image-1',mime:'image/png',name:'chat.png',base64:'aGVsbG8='});await a.call('upload',{id:'work',assetId:'image-1',mime:'image/png',name:'chat.png',base64:'aGVsbG8='});assert.equal(f.rows.get('sharedCalendarTasks/work').assets.length,1);
 await assert.rejects(b.call('asset',{id:'work',assetId:'image-1'}));await assert.rejects(a.call('asset',{id:'work',assetId:'../../private'}));assert.equal((await a.call('asset',{id:'work',assetId:'image-1'})).base64,'aGVsbG8=');
 const r=await a.call('publish',{id:'work'});assert.equal(r.notification.sent,1);assert.equal(f.sent[0].to,'U'+'a'.repeat(32));const link=new URL(f.sent[0].message.split('\n').at(-1));assert.equal(link.pathname,'/play-card/private-calendar.html');assert.equal(link.searchParams.get('task'),'work');assert.equal(link.searchParams.get('openExternalBrowser'),'1');await a.call('publish',{id:'work'});assert.equal(f.sent.length,1);
});
test('unrelated assignee can update progress but cannot alter title or upload; completion notifies creator',async()=>{
 const f=setup(),a=await f.join();await f.owner('save',{id:'work',event:event(),assignedTo:a.memberId});await f.owner('publish',{id:'work'});assert.equal(f.sent[0].to,'U'+'b'.repeat(32));
 await assert.rejects(a.call('save',{id:'work',revision:1,event:event(),assignedTo:'owner'}),/建立者/);await assert.rejects(a.call('upload',{id:'work',mime:'image/png',base64:'aGVsbG8='}),/上傳/);
 await a.call('progress',{id:'work',revision:1,status:'done'});assert.equal(f.sent.length,2);assert.equal(f.sent[1].to,'U'+'a'.repeat(32));await a.call('progress',{id:'work',revision:1,status:'done'});assert.equal(f.sent.length,2);
});
test('failed LINE stays visible and retries with the same delivery key',async()=>{
 const f=setup({failSend:true}),m=await f.join();await m.call('save',{id:'retry',event:event(),assignedTo:'owner'});const r=await m.call('publish',{id:'retry'});assert.equal(r.notification.pending,1);
 const job=[...f.rows].find(([p])=>p.startsWith('sharedCalendarOutbox/'))[1];assert.equal(job.state,'failed');f.options.failSend=false;await f.core.tick();assert.equal(f.sent.length,1);assert.equal(f.sent[0].key,job.key);await f.core.tick();assert.equal(f.sent.length,1);
});
test('due reminders run once, stop after completion and never send to revoked members',async()=>{
 const f=setup(),m=await f.join(),e={...event(),start:new Date(Date.now()-60000).toISOString(),end:new Date(Date.now()+60000).toISOString(),reminderMinutes:0};await f.owner('save',{id:'due',event:e,assignedTo:m.memberId});await f.owner('publish',{id:'due'});await f.core.tick();assert.equal(f.sent.length,2);await f.core.tick();assert.equal(f.sent.length,2);
 await f.owner('progress',{id:'due',revision:1,status:'done'});await f.core.tick();assert.equal(f.sent.length,2);
 await f.owner('save',{id:'revoked',event:e,assignedTo:m.memberId});await f.owner('publish',{id:'revoked'});const count=f.sent.length;await f.owner('revoke',{memberId:m.memberId});await f.core.tick();assert.equal(f.sent.length,count);
});
test('no LINE binding does not falsely report a sent notification and rejects forged contact selection',async()=>{
 const f=setup({noOwnerLine:true}),m=await f.join();await assert.rejects(f.owner('invite',{name:'Bad',contactKey:'arbitrary/U123'}));await m.call('save',{id:'unbound',event:event()});const r=await m.call('publish',{id:'unbound'});assert.equal(r.notification.sent,0);assert.equal(r.notification.pending,1);assert.match((await m.call('detail',{id:'unbound'})).notifications[0].error,/綁定/);
});
test('stale content saves and cross-workspace forged records are rejected',async()=>{
 const f=setup(),m=await f.join();await m.call('save',{id:'work',event:event()});await assert.rejects(m.call('save',{id:'work',revision:0,event:event()}),/更新/);f.rows.set('sharedCalendarTasks/foreign',{...event(),ownerUid:'someone-else',createdBy:m.memberId});await assert.rejects(m.call('detail',{id:'foreign'}));
});
test('passkeys enforce RP, origin, member version and one-time challenges',async()=>{
 const seen=[],verifier={generateRegistrationOptions:async o=>{seen.push(o);return {challenge:'reg'};},verifyRegistrationResponse:async o=>{seen.push(o);return {verified:true,registrationInfo:{credential:{id:'key-1',publicKey:Buffer.from('key'),counter:0}}};},generateAuthenticationOptions:async o=>{seen.push(o);return {challenge:'login'};},verifyAuthenticationResponse:async o=>{seen.push(o);return {verified:true,authenticationInfo:{newCounter:1}};}};
 const f=setup({verifier}),m=await f.join();await assert.rejects(f.ar('registrationOptions'));
 const c=await f.ar('registrationOptions',{teamSession:m.token});assert.equal(seen[0].authenticatorSelection.userVerification,'required');await f.ar('registrationVerify',{teamSession:m.token,ticket:c.ticket,response:{id:'key-1'}});assert.equal(seen[1].expectedOrigin,'https://danny700808.github.io');await assert.rejects(f.ar('registrationVerify',{teamSession:m.token,ticket:c.ticket,response:{id:'key-1'}}));
 const a=await f.ar('authenticationOptions',{memberId:m.memberId});const s=await f.ar('authenticationVerify',{memberId:m.memberId,ticket:a.ticket,response:{id:'key-1'}});assert.ok(s.token);assert.equal(seen.at(-1).expectedRPID,'danny700808.github.io');await f.owner('reinvite',{memberId:m.memberId});await assert.rejects(f.ar('authenticationOptions',{memberId:m.memberId}));
});
test('shared multiple reminder times are independent and never resent on repeated ticks',async()=>{
 const f=setup(),m=await f.join(),e={...event(),start:new Date(Date.now()+59*60000).toISOString(),end:new Date(Date.now()+120*60000).toISOString(),reminderOffsets:[60,120,180]};
 await f.owner('save',{id:'multi',event:e,assignedTo:m.memberId});await f.owner('publish',{id:'multi'});const initial=f.sent.length;await f.core.tick();assert.equal(f.sent.length-initial,3);await f.core.tick();assert.equal(f.sent.length-initial,3);
 assert.equal(new Set(f.sent.map(x=>x.key)).size,f.sent.length);assert.deepEqual(f.rows.get('sharedCalendarTasks/multi').reminderOffsets,[60,120,180]);
 await assert.rejects(f.owner('save',{id:'invalid',event:{...e,reminderOffsets:[999]},assignedTo:m.memberId}));
});
test('member without LINE can activate, log in and notify a bound owner',async()=>{
 const f=setup(),inv=await f.owner('invite',{name:'Unbound member',contactKey:''});
 const login=await f.activate(inv.url.split('#invite=')[1]);
 const call=(action,data={})=>f.core.api({data:{action,teamSession:login.token,...data}});
 const status=await call('status');assert.equal(status.myLineReady,false);assert.equal(status.ownerLineReady,true);
 await call('save',{id:'unbound-member-task',assignedTo:'owner',event:event()});
 const r=await call('publish',{id:'unbound-member-task'});assert.equal(r.notification.sent,1);assert.equal(f.sent[0].to,'U'+'a'.repeat(32));
});

test('password activation is retired without consuming invitations',async()=>{
 const f=setup(),inv=await f.owner('invite',{name:'Member'}),invite=inv.url.split('#invite=')[1];
 await assert.rejects(f.ar('activate',{invite,password:'123456'}),/LINE 或 Email/);
 assert.ok((await f.activate(invite)).token);
});
test('owner deletion clears member credentials and invitations while preserving recorded work',async()=>{
 const f=setup(),m=await f.join(),other=await f.join('Other');
 await m.call('save',{id:'kept-record',event:event()});await m.call('publish',{id:'kept-record'});
 f.rows.set('sharedCalendarPasskeys/delete-test',{memberId:m.memberId,version:'old',publicKey:'fixture'});
 f.rows.set('sharedCalendarChallenges/delete-test',{memberId:m.memberId,challenge:'fixture'});
 await assert.rejects(other.call('deleteMember',{memberId:m.memberId}),/管理者/);
 f.rows.set('sharedCalendarMembers/another-workspace',{ownerUid:'different',status:'active'});
 await assert.rejects(f.owner('deleteMember',{memberId:'another-workspace'}),/不存在/);
 await f.owner('deleteMember',{memberId:m.memberId});
 const tombstone=f.rows.get('sharedCalendarMembers/'+m.memberId);assert.equal(tombstone.status,'deleted');assert.equal(tombstone.passwordHash,undefined);assert.equal(tombstone.name,undefined);assert.equal(tombstone.contactKey,undefined);
 for(const [path,row] of f.rows)if(/^sharedCalendar(Invites|Sessions|Passkeys|Challenges)\//.test(path))assert.notEqual(row.memberId,m.memberId);
 await assert.rejects(m.call('status'));await assert.rejects(f.ar('password',{memberId:m.memberId,password:'long-fixture-password'}));
 await assert.rejects(f.owner('reinvite',{memberId:m.memberId}),/不存在/);
 assert(!(await f.owner('status')).members.some(x=>x.id===m.memberId));
 assert.equal((await f.owner('detail',{id:'kept-record'})).task.title,event().title);
 assert.equal((await other.call('status')).me.id,other.memberId);
 await f.owner('deleteMember',{memberId:m.memberId});
 const inv=await f.owner('invite',{name:'Assistant'});assert.notEqual(inv.memberId,m.memberId);
});
test('failed deletion cleanup can be retried without restoring member access',async()=>{
 const f=setup(),m=await f.join(),collection=f.db.collection;let failOnce=true;
 f.db.collection=name=>{const q=collection(name);if(name==='sharedCalendarSessions'&&failOnce){q.where=()=>({get:async()=>{failOnce=false;throw Error('temporary cleanup failure');}});}return q;};
 await assert.rejects(f.owner('deleteMember',{memberId:m.memberId}),/cleanup failure/);
 await assert.rejects(m.call('status'));
 await f.owner('deleteMember',{memberId:m.memberId});
 assert(![...f.rows].some(([p,r])=>p.startsWith('sharedCalendarSessions/')&&r.memberId===m.memberId));
});
test('members can assign active teammates while unrelated work remains private',async()=>{
 const f=setup(),a=await f.join('A'),b=await f.join('B'),c=await f.join('C');
 assert((await a.call('status')).assignees.some(x=>x.id===b.memberId));
 await a.call('save',{id:'team-task',assignedTo:b.memberId,event:event()});await a.call('publish',{id:'team-task'});
 assert.equal((await b.call('detail',{id:'team-task'})).task.createdBy,a.memberId);await assert.rejects(c.call('detail',{id:'team-task'}));
 await f.owner('revoke',{memberId:b.memberId});await assert.rejects(a.call('save',{id:'inactive-target',assignedTo:b.memberId,event:event()}));
});
test('LINE binding is single-use, member-version scoped and receives task reminders',async()=>{
 const f=setup(),a=await f.join('A'),b=await f.join('B'),replies=[],reply=async(_,t)=>replies.push(t),id='U'+'c'.repeat(32);
 const first=await a.call('lineStart'),second=await a.call('lineStart');
 const evt=r=>({source:{type:'user',userId:id},message:{text:decodeURIComponent(r.url.split('/?')[1])},replyToken:'fixture'});
 await f.lineBindings.handle(evt(first),reply);assert.match(replies.at(-1),/失效/);
 await f.lineBindings.handle({...evt(second),source:{type:'group',userId:id}},reply);assert.match(replies.at(-1),/私訊/);
 await f.lineBindings.handle(evt(second),reply);assert.match(replies.at(-1),/已綁定/);assert.equal(f.rows.get('sharedCalendarMembers/'+a.memberId).lineUserId,id);
 await f.lineBindings.handle(evt(second),reply);assert.match(replies.at(-1),/失效/);
 const bStart=await b.call('lineStart');await f.lineBindings.handle(evt(bStart),reply);assert.match(replies.at(-1),/另一位/);
 await b.call('save',{id:'line-team',assignedTo:a.memberId,event:event()});await b.call('publish',{id:'line-team'});assert.equal(f.sent.at(-1).to,id);
 await assert.rejects(a.call('lineUnlink'),/先綁定 Email/);f.rows.get('sharedCalendarMembers/'+a.memberId).emailVerifiedAt=Date.now();
 await a.call('lineUnlink');assert.equal((await a.call('status')).myLineReady,false);
 await f.lineBindings.handle(evt(bStart),reply);assert.match(replies.at(-1),/已綁定/);
 const stale=await b.call('lineStart');await f.owner('revoke',{memberId:b.memberId});await f.lineBindings.handle(evt(stale),reply);assert.match(replies.at(-1),/失效/);
 await f.owner('deleteMember',{memberId:b.memberId});assert(![...f.rows].some(([p,r])=>/sharedCalendarLine(Tickets|Owners)\//.test(p)&&r.memberId===b.memberId));
});
module.exports={setup,event};
