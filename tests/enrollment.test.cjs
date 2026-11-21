'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createEnrollmentService,dateValid,CONSENT_VERSION,PAGE,C}=require('../functions/enrollment');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex'),random=()=>crypto.randomBytes(32).toString('base64url');
// Transactional fixture implements Firestore reads-before-writes and rejects undefined values.
function database(){
 const rows=new Map();let serial=Promise.resolve();
 const validate=v=>{if(v===undefined)throw Error('undefined value');if(v&&typeof v==='object')Object.values(v).forEach(validate);};
 const snap=p=>({id:p.split('/').at(-1),ref:ref(p),exists:rows.has(p),data:()=>structuredClone(rows.get(p))});
 const write=(p,v,merge=false)=>{validate(v);rows.set(p,{...(merge?rows.get(p):{}),...structuredClone(v)});};
 const ref=p=>({path:p,id:p.split('/').at(-1),get:async()=>snap(p),create:async v=>{if(rows.has(p))throw Error('exists');write(p,v);},update:async v=>{if(!rows.has(p))throw Error('missing');write(p,v,true);},set:async(v,o)=>write(p,v,o?.merge)});
 const query=(name,filters=[],order=null,cap=Infinity,after=null)=>({doc:id=>ref(name+'/'+id),where:(f,op,v)=>query(name,[...filters,{f,op,v}],order,cap,after),orderBy:(f,dir)=>query(name,filters,{f,dir},cap,after),limit:n=>query(name,filters,order,n,after),startAfter:s=>query(name,filters,order,cap,s.id),get:async()=>{
  let docs=[...rows.keys()].filter(p=>p.split('/')[0]===name).map(snap).filter(s=>filters.every(({f,op,v})=>op==='<'?s.data()[f]<v:s.data()[f]===v));
  if(order)docs.sort((a,b)=>(a.data()[order.f]-b.data()[order.f])*(order.dir==='desc'?-1:1));if(after)docs=docs.slice(docs.findIndex(d=>d.id===after)+1);docs=docs.slice(0,cap);return {docs,empty:!docs.length};
 }});
 const writer=()=>{const writes=[];return {get:async r=>{assert.equal(writes.length,0,'transaction reads must precede writes');return snap(r.path);},create:(r,v)=>{if(rows.has(r.path))throw Error('exists');writes.push(()=>write(r.path,v));},update:(r,v)=>{if(!rows.has(r.path))throw Error('missing');writes.push(()=>write(r.path,v,true));},set:(r,v,o)=>writes.push(()=>write(r.path,v,o?.merge)),delete:r=>writes.push(()=>rows.delete(r.path)),commit:async()=>writes.forEach(f=>f())};};
 const db={collection:query,batch:writer,runTransaction(fn){const p=serial.then(async()=>{const tx=writer(),r=await fn(tx);await tx.commit();return r;});serial=p.catch(()=>{});return p;}};return {rows,db};
}
function harness(){
 const fixture=database();let clock=Date.parse('2026-11-15T04:15:00Z');
 const courses=[{id:1,subjectId:'631813def9b3a600b1fcb07a',name:'古典鋼琴',options:[{id:'solo',name:'單人班',price:'2800～3000',lessons:4,people:1},{id:'duo',name:'雙人班',price:'3600～3800',lessons:4,people:2}]}];
 const service=createEnrollmentService({db:fixture.db,catalog:async()=>({courses}),now:()=>clock,stamp:()=>clock});
 const manager=data=>service.adminApi({auth:{uid:'manager',token:{role:'admin'}},data});
 const publicApi=data=>service.publicApi(data,{ip:'fixture-only'});
 const count=k=>[...fixture.rows.keys()].filter(p=>p.startsWith((C[k]||k)+'/')).length;
 const form={courseId:1,optionId:'solo',name:'測試學生',secondName:'',phone:'0912345678',email:'fixture@example.invalid',date:'2026-11-21',time:'13:00',note:''};
 async function invitation(){const v=await manager({action:'createInvite',label:'單元測試'});return {...v,token:new URLSearchParams(new URL(v.url).hash.slice(1)).get('invite')};}
 async function start(i,extra={}){const verifier=random(),submissionKey=random(),args={action:'start',invite:i.token,form,challenge:hash(verifier),submissionKey,consent:true,consentVersion:CONSENT_VERSION,returnUrl:PAGE,...extra};const v=await publicApi(args);return {...v,verifier,submissionKey,state:new URL(v.authorizationUrl).searchParams.get('state'),args};}
 async function callback(s,options={}){const res={set(){return this;},status(n){this.statusCode=n;return this;},send(v){this.body=v;},redirect(n,url){this.statusCode=n;this.url=url;}};const calls=[];
  await service.callback({method:'GET',query:{state:s.state,code:'test-code',...options.query}},res,{exchange:async(...args)=>{calls.push(args);return {access_token:'test-token'};},profile:async()=>({lineUserId:'U'+'a'.repeat(32),lineDisplayName:'測試帳號',lineFriendFlag:true,...options.profile})});return {...res,calls,ticket:new URLSearchParams(new URL(res.url).hash.slice(1)).get('enrollmentTicket')};}
 async function submit(extra={}){const i=await invitation(),s=await start(i,extra),c=await callback(s),r=await publicApi({action:'redeem',ticket:c.ticket,verifier:s.verifier});return {i,s,c,r};}
 return {...fixture,service,manager,publicApi,count,form,courses,invitation,start,callback,submit,advance:ms=>clock+=ms,now:()=>clock};
}
test('server scheduling policy includes day 45 and correct weekday/weekend hours',()=>{
 const n=Date.parse('2026-11-15T04:15:00Z');for(const [d,t,expected] of [['2026-12-30','20:00',true],['2026-12-31','13:00',false],['2026-11-16','13:00',false],['2026-11-17','12:00',false],['2026-11-17','12:30',true],['2026-11-21','10:00',true],['2026-11-21','20:30',false],['2026-11-21','13:15',false],['2026-11-15','12:00',false],['2026-02-29','13:00',false]])assert.equal(dateValid(d,t,n),expected,d+' '+t);
});
test('direct visitor requires no invitation, but still needs consent and verified LINE plus browser proof',async()=>{
 const h=harness();assert.equal((await h.publicApi({action:'status'})).consentVersion,CONSENT_VERSION);
 await assert.rejects(h.start({token:''},{consent:false}),/同意/);assert.equal(h.count('oauth'),0);
 const s=await h.start({token:''});assert.equal(h.count('invites'),0);assert.equal(h.count('records'),0);
 const c=await h.callback(s);assert(c.ticket);assert.equal(h.count('records'),0);
 await assert.rejects(h.publicApi({action:'redeem',ticket:c.ticket,verifier:random()}));
 const r=await h.publicApi({action:'redeem',ticket:c.ticket,verifier:s.verifier}),again=await h.publicApi({action:'redeem',ticket:c.ticket,verifier:s.verifier});assert.equal(again.receiptId,r.receiptId);
 const row=h.rows.get(C.records+'/'+r.receiptId);assert.equal(row.source,'direct');assert.equal(row.inviteId,'');assert.equal(h.count('records'),1);assert.equal(h.count('invites'),0);assert.equal(h.count('notificationQueue'),1);
});
test('direct visitors cannot bypass validation or the existing request rate limit',async()=>{
 const h=harness();await assert.rejects(h.start({token:''},{returnUrl:'https://evil.invalid/'}));await assert.rejects(h.start({token:''},{form:{...h.form,date:'2026-11-16'}}));
 for(let n=0;n<20;n++)await h.start({token:''});await assert.rejects(h.start({token:''}),/操作較頻繁/);assert.equal(h.count('records'),0);
});
test('invites and manager actions require actual authorization',async()=>{
 const h=harness();await assert.rejects(h.service.adminApi({data:{action:'list',role:'admin'}}),/管理者/);await assert.rejects(h.service.adminApi({auth:{uid:'student',token:{role:'student'}},data:{action:'createInvite'}}),/管理者/);
 await assert.rejects(h.publicApi({action:'inviteStatus',invite:random()}),/到期/);const i=await h.invitation();assert.equal(h.count('invites'),1);assert(!JSON.stringify([...h.rows]).includes(i.token));await h.publicApi({action:'inviteStatus',invite:i.token});
 await h.manager({action:'revokeInvite',id:i.id});await assert.rejects(h.start(i),/到期/);assert.equal(h.count('records'),0);
});
test('consent, course, return URL and timing enforced before OAuth',async()=>{
 const h=harness(),i=await h.invitation();for(const extra of [{consent:false},{consentVersion:'old'},{returnUrl:'https://evil.invalid/'},{form:{...h.form,courseId:999}},{form:{...h.form,date:'2026-11-16'}},{form:{...h.form,optionId:'duo'}}])await assert.rejects(h.start(i,extra));
 const s=await h.start(i,{form:{...h.form,price:0,lineUserId:'forged'}}),p=new URL(s.authorizationUrl).searchParams,row=h.rows.get(C.oauth+'/'+hash(s.state));assert.equal(row.form.price,'2800～3000');assert.equal(row.form.lineUserId,undefined);assert.equal(p.get('code_challenge'),crypto.createHash('sha256').update(row.oauthVerifier).digest('base64url'));assert.equal(p.get('code_challenge_method'),'S256');assert.equal(h.count('records'),0);assert.equal(h.count('notificationQueue'),0);
});
test('cancelled, expired and replayed LINE states never create a submission',async()=>{
 const h=harness(),i=await h.invitation(),s=await h.start(i),c=await h.callback(s,{query:{error:'access_denied'}});assert.match(c.url,/cancelled/);assert.equal(c.calls.length,0);assert.equal(h.rows.get(C.oauth+'/'+hash(s.state)).form,null);assert.match((await h.callback(s)).url,/expired/);
 const another=await h.start(i);h.advance(601000);assert.match((await h.callback(another)).url,/expired/);assert.equal(h.count('records'),0);
});
test('verified callback plus browser proof creates one receipt; concurrent retries are idempotent',async()=>{
 const h=harness(),i=await h.invitation(),s=await h.start(i),pending=h.rows.get(C.oauth+'/'+hash(s.state)),c=await h.callback(s);assert(c.ticket);assert.notEqual(c.ticket,s.state);assert.deepEqual(c.calls[0],['test-code',pending.callbackUrl,pending.oauthVerifier]);assert.equal(h.count('records'),0);
 await assert.rejects(h.publicApi({action:'redeem',ticket:c.ticket,verifier:random()}),/瀏覽器/);
 const result=await Promise.all([1,2,3].map(()=>h.publicApi({action:'redeem',ticket:c.ticket,verifier:s.verifier})));assert.equal(new Set(result.map(r=>r.receiptId)).size,1);assert.equal(h.count('records'),1);assert.equal(h.rows.get(C.invites+'/'+i.id).usedCount,1);assert.equal(h.count('notificationQueue'),1);
 const record=h.rows.get(C.records+'/'+result[0].receiptId);assert.equal(record.line.lineUserId,'U'+'a'.repeat(32));assert.equal(record.consent.version,CONSENT_VERSION);assert.equal(record.studentIds.length,0);assert.equal(h.rows.get(C.grants+'/'+hash(c.ticket)).form,null);
 // Retrying the same draft with a second successful OAuth callback must still dedupe.
 const s2=await h.start(i,{submissionKey:s.submissionKey}),c2=await h.callback(s2),r2=await h.publicApi({action:'redeem',ticket:c2.ticket,verifier:s2.verifier});assert.equal(r2.receiptId,result[0].receiptId);assert.equal(h.count('records'),1);
});
test('revoked invite and changed authoritative catalog cannot be redeemed',async()=>{
 for(const mode of ['revoke','catalog']){const h=harness(),i=await h.invitation(),s=await h.start(i),c=await h.callback(s);if(mode==='revoke')await h.manager({action:'revokeInvite',id:i.id});else h.courses[0].options[0].price='3200';await assert.rejects(h.publicApi({action:'redeem',ticket:c.ticket,verifier:s.verifier}));assert.equal(h.count('records'),0);}
});
test('student creation requires manager choice, keeps existing matches untouched, and is idempotent',async()=>{
 const h=harness();h.rows.set('coursePortalStudentProfiles/existing',{id:'existing',name:h.form.name,phone:h.form.phone,active:true});const {r}=await h.submit(),detail=await h.manager({action:'detail',id:r.receiptId});assert.equal(detail.matches.length,1);assert.equal(h.count('coursePortalStudentBindings'),0);
 await assert.rejects(h.manager({action:'admit',id:r.receiptId,version:1,studentIds:['unrelated']}));
 const responses=await Promise.all([1,2].map(()=>h.manager({action:'admit',id:r.receiptId,version:1,studentIds:['new']})));assert.deepEqual(responses[0],responses[1]);assert.equal(h.count('coursePortalStudentProfiles'),2);assert.equal(h.count('coursePortalStudentBindings'),1);assert.equal(h.rows.get('coursePortalStudentProfiles/existing').enrollmentId,undefined);
 const v=h.rows.get(C.records+'/'+r.receiptId);await h.manager({action:'update',id:r.receiptId,version:v.version,status:'admitted',note:'checked'});await assert.rejects(h.manager({action:'update',id:r.receiptId,version:1,status:'closed',note:''}),/資料已更新/);
});
test('two-person enrollment creates distinct profiles and same verified LINE for both',async()=>{
 const h=harness(),{r}=await h.submit({form:{...h.form,optionId:'duo',secondName:'第二位學生',secondPhone:'0922222222'}});const v=await h.manager({action:'admit',id:r.receiptId,version:1,studentIds:['new','new']});assert.equal(new Set(v.studentIds).size,2);assert.equal(h.count('coursePortalStudentBindings'),2);assert.equal(h.count('notificationQueue'),1);
});
test('manual contact derives recipient from verified identity and de-duplicates a retried operation',async()=>{
 const h=harness(),{r}=await h.submit(),operationId=random(),args={action:'message',id:r.receiptId,text:'fixture message',operationId,targetLineUserId:'forged'};assert.equal(h.count('notificationQueue'),1);
 await h.manager(args);await h.manager(args);assert.equal(h.count('notificationQueue'),2);const row=[...h.rows.entries()].find(([k,v])=>k.startsWith('notificationQueue/')&&v.eventCode==='online_enrollment_contact')[1];assert.equal(row.targetLineUserId,'U'+'a'.repeat(32));assert.equal(row.emailFallbackEnabled,false);await assert.rejects(h.manager({...args,text:'different'}),/編號已使用/);
 h.rows.get(C.records+'/'+r.receiptId).line.lineFriendFlag=false;await assert.rejects(h.manager({...args,operationId:random()}),/官方 LINE/);
});
test('cleanup removes expired temporary data, keeps submitted records, and responses serialize cleanly',async()=>{
 const h=harness();await h.submit();const i=await h.invitation();await h.start(i);h.advance(3*86400000);assert((await h.service.cleanup())>0);assert.equal(h.count('oauth'),0);assert.equal(h.count('grants'),0);assert.equal(h.count('records'),1);
 const result=await h.manager({action:'list'});assert.equal(result.records.length,1);assert(!Object.hasOwn(result.records[0],'messages'));assert.equal(JSON.parse(JSON.stringify(result)).records.length,1);
});


test('only verified submissions notify the primary manager once, and detail reads actual delivery status',async()=>{
 const h=harness(),i=await h.invitation(),s=await h.start(i),c=await h.callback(s,{profile:{lineFriendFlag:false}});
 assert.equal(h.count('notificationQueue'),0);
 await assert.rejects(h.publicApi({action:'redeem',ticket:c.ticket,verifier:random()}));assert.equal(h.count('notificationQueue'),0);
 const r=await h.publicApi({action:'redeem',ticket:c.ticket,verifier:s.verifier});
 const record=h.rows.get(C.records+'/'+r.receiptId),q=h.rows.get('notificationQueue/'+record.managerNotification.queueId);
 assert.equal(q.targetRole,'manager');assert.equal(q.targetEmployeeId,'PRIMARY_MANAGER_LINE');assert.equal(q.targetLineUserId,undefined);assert.equal(q.emailFallbackEnabled,false);assert(!q.body.includes(record.line.lineUserId));
 assert.equal(new URL(q.approvalUrl).searchParams.get('enrollment'),r.receiptId);assert.match(q.body,/尚未確認加入官方 LINE/);
 assert.equal(h.count('coursePortalStudentBindings'),0);assert.equal(h.count('coursePortalStudentProfiles'),0);
 for(let n=0;n<3;n++)await h.publicApi({action:'redeem',ticket:c.ticket,verifier:s.verifier});assert.equal(h.count('notificationQueue'),1);
 q.status='已發送';q.sentAt=h.now();
 const detail=await h.manager({action:'detail',id:r.receiptId});assert.equal(detail.record.managerNotification.status,'已發送');assert.equal(detail.record.managerNotification.sentAt,h.now());
});

test('both students have a phone and all requested slots survive LINE authorization',async()=>{
 const h=harness(),times=['2026-11-21 13:00','2026-11-21 15:00','2026-11-22 10:00'];
 const form={...h.form,optionId:'duo',secondName:'乙',times};
 await assert.rejects(h.start({token:''},{form}),/第二位/);
 const complete={...form,secondPhone:'0922-222-222'};
 await assert.rejects(h.start({token:''},{form:{...complete,times:[times[0],'2026-11-23 13:00']}}),/時段/);
 const {r}=await h.submit({form:complete}),row=h.rows.get(C.records+'/'+r.receiptId);
 assert.deepEqual(row.form.times,times);assert.deepEqual(r.times,times);
 assert.equal(row.form.secondPhone,'0922222222');
 const {studentIds}=await h.manager({action:'admit',id:r.receiptId,version:1,studentIds:['new','new']});
 assert.deepEqual(studentIds.map(id=>h.rows.get('coursePortalStudentProfiles/'+id).phone),[form.phone,'0922222222']);
});

test('optional trial preference survives LINE, receipt and inbox without scheduling, tuition or payment',async()=>{
 for(const preferFreeTrial of [true,false]){
  const h=harness(),s=await h.start({token:''},{form:{...h.form,preferFreeTrial,price:0}});
  assert.equal(h.rows.get(C.oauth+'/'+hash(s.state)).form.preferFreeTrial,preferFreeTrial);
  const c=await h.callback(s),grant=h.rows.get(C.grants+'/'+hash(c.ticket));
  assert.equal(grant.form.preferFreeTrial,preferFreeTrial);
  assert.equal(h.count('records'),0);
  const args={action:'redeem',ticket:c.ticket,verifier:s.verifier,preferFreeTrial:!preferFreeTrial};
  const r=await h.publicApi(args),retry=await h.publicApi(args);
  assert.deepEqual(retry,r);
  assert.equal(r.preferFreeTrial,preferFreeTrial);
  assert.equal(r.price,'2800～3000');
  assert.equal(r.lessons,4);
  const record=(await h.manager({action:'detail',id:r.receiptId})).record;
  assert.equal(record.form.preferFreeTrial,preferFreeTrial);
  assert.equal((await h.manager({action:'list'})).records[0].form.preferFreeTrial,preferFreeTrial);
  assert.equal(record.status,'received');
  assert.equal(record.schedule,undefined);
  assert.deepEqual(record.studentIds,[]);
  const q=h.rows.get('notificationQueue/'+record.managerNotification.queueId);
  assert.equal(q.targetEmployeeId,'PRIMARY_MANAGER_LINE');
  assert.equal(/免費試上（待確認）/.test(q.body),preferFreeTrial);
  assert.match(q.body,preferFreeTrial?/正式課程參考學費：NT\$ 2800～3000/:/報名費用：NT\$ 2800～3000/);
  assert.equal(h.count('notificationQueue'),1);
  assert.deepEqual([...new Set([...h.rows.keys()].map(p=>p.split('/')[0]))].sort(),[C.grants,C.limits,C.oauth,C.records,'notificationQueue'].sort());
 }
});

test('trial preference rejects non-booleans and does not bypass contact or time validation',async()=>{
 const h=harness();
 for(const invalid of ['true','false',1,0,null,[],{}])await assert.rejects(h.start({token:''},{form:{...h.form,preferFreeTrial:invalid}}),/免費試上偏好/);
 await assert.rejects(h.start({token:''},{form:{...h.form,preferFreeTrial:true,date:'2026-11-16'}}),/有效時段/);
 await assert.rejects(h.start({token:''},{form:{...h.form,preferFreeTrial:true,phone:''}}),/手機/);
 assert.equal(h.count('oauth'),0);
 assert.equal(h.count('records'),0);
});

test('old pending/verified forms may omit the preference; unchecked retries dedupe, checked differs',async()=>{
 const h=harness(),direct={token:''},s=await h.start(direct);
 assert(!Object.hasOwn(h.rows.get(C.oauth+'/'+hash(s.state)).form,'preferFreeTrial'));
 const c=await h.callback(s);
 assert(!Object.hasOwn(h.rows.get(C.grants+'/'+hash(c.ticket)).form,'preferFreeTrial'));
 const r=await h.publicApi({action:'redeem',ticket:c.ticket,verifier:s.verifier});
 assert(!Object.hasOwn(r,'preferFreeTrial'));
 assert(!Object.hasOwn((await h.manager({action:'detail',id:r.receiptId})).record.form,'preferFreeTrial'));
 const click=async preferFreeTrial=>{
  const start=await h.start(direct,{submissionKey:s.submissionKey,form:{...h.form,preferFreeTrial}}),callback=await h.callback(start);
  return h.publicApi({action:'redeem',ticket:callback.ticket,verifier:start.verifier});
 };
 assert.deepEqual(await click(false),r);
 await assert.rejects(click(true),/已經送出/);
 assert.equal(h.count('records'),1);
 assert.equal(h.count('notificationQueue'),1);
});

test('trial preference rollout status is safe to check without writing any data',async()=>{
 const h=harness(),status=await h.publicApi({action:'status'});
 assert.equal(status.supportsFreeTrialPreference,true);
 assert.equal(status.consentVersion,CONSENT_VERSION);
 assert.equal(h.rows.size,0);
});

test('a checked trial preference does not create a record or staff notice after LINE cancellation',async()=>{
 const h=harness(),s=await h.start({token:''},{form:{...h.form,preferFreeTrial:true}});
 const c=await h.callback(s,{query:{error:'access_denied'}});
 assert.match(c.url,/enrollmentError=cancelled/);
 assert.equal(h.rows.get(C.oauth+'/'+hash(s.state)).form,null);
 assert.equal(h.count('grants'),0);
 assert.equal(h.count('records'),0);
 assert.equal(h.count('notificationQueue'),0);
});


test('free-trial eligibility matches the eight live offering IDs and their canonical subjects exactly',async()=>{
 const h=harness(),status=await h.publicApi({action:'status'});
 const expected=[
  [1,'631813def9b3a600b1fcb07a'],[5,'631813caf0ea0e00b13acdef'],[7,'631813f0f0ea0e00b13acdf0'],[8,'648823805bce9600b204d45c'],
  [9,'64ad1a8919d06000b27286c6'],[10,'64b3957b95ae1700b1aa46e4'],[11,'6482daaeb3d73400b1f2c180'],[12,'648823898e9b2800b28d339e']
 ];
 assert.deepEqual(status.freeTrialEligibleCourses.map(c=>[c.courseId,c.subjectId]),expected);
 assert.equal(status.freeTrialEligibleCourses.find(c=>c.courseId===8).scope,'爵士鼓');
 for(const [id,subjectId] of expected.slice(1))h.courses.push({...h.courses[0],id,subjectId});
 h.courses.push({...h.courses[0],id:6,subjectId:'portal-subject-5b1c4b3b3b6491083cfce026',name:'民謠吉他演奏 Fingerstyle'});
 h.courses.push({...h.courses[0],id:13,name:'古典鋼琴同名課'});
 for(const [courseId] of expected)assert((await h.start({token:''},{form:{...h.form,courseId,preferFreeTrial:true,willingToDiscussPaidTrial:false}})).state);
 for(const courseId of [6,13]){
  for(const field of [{preferFreeTrial:true},{preferFreeTrial:true,willingToDiscussPaidTrial:true}]){
   await assert.rejects(h.start({token:''},{form:{...h.form,courseId,...field}}),/未開放免費試上洽詢/);
  }
  assert((await h.start({token:''},{form:{...h.form,courseId,preferFreeTrial:false}})).state);
 }
 h.courses.find(c=>c.id===7).subjectId='reassigned';
 await assert.rejects(h.start({token:''},{form:{...h.form,courseId:7,preferFreeTrial:true,willingToDiscussPaidTrial:false}}),/未開放免費試上洽詢/);
});

test('paid-trial willingness is a strict separate boolean only for an eligible free-trial inquiry',async()=>{
 for(const willingness of [true,false]){
  const h=harness(),{r}=await h.submit({form:{...h.form,preferFreeTrial:true,willingToDiscussPaidTrial:willingness}});
  assert.equal(r.willingToDiscussPaidTrial,willingness);
  const record=(await h.manager({action:'detail',id:r.receiptId})).record;
  assert.equal(record.form.willingToDiscussPaidTrial,willingness);
  const queue=h.rows.get('notificationQueue/'+record.managerNotification.queueId);
  assert.match(queue.body,willingness?/願意先討論一堂付費試上.*先告知單堂費用，經同意再安排/:/未表示可接受付費試上/);
  assert.equal(r.price,'2800～3000');assert.equal(record.schedule,undefined);assert.deepEqual(record.studentIds,[]);
 }
 const h=harness();
 for(const v of [null,1,0,'true',[],{}])await assert.rejects(h.start({token:''},{form:{...h.form,preferFreeTrial:true,willingToDiscussPaidTrial:v}}),/付費試上偏好/);
 for(const preferFreeTrial of [false,undefined])for(const willingToDiscussPaidTrial of [true,false]){
  const form={...h.form,willingToDiscussPaidTrial};if(preferFreeTrial===false)form.preferFreeTrial=false;
  await assert.rejects(h.start({token:''},{form}),/請先勾選洽詢免費試上/);
 }
 assert.equal(h.count('oauth'),0);
});

test('legacy pending free-trial inquiries can redeem on previously unrestricted courses and convey no paid consent',async()=>{
 const h=harness();h.courses.push({...h.courses[0],id:6,name:'Fingerstyle',subjectId:'fingerstyle'});
 const s=await h.start({token:''},{form:{...h.form,courseId:6,preferFreeTrial:false}});
 // The previous release issued the same form with true on any course, without the new field.
 h.rows.get(C.oauth+'/'+hash(s.state)).form.preferFreeTrial=true;
 const c=await h.callback(s),r=await h.publicApi({action:'redeem',ticket:c.ticket,verifier:s.verifier});
 assert.equal(r.preferFreeTrial,true);assert(!Object.hasOwn(r,'willingToDiscussPaidTrial'));
 const record=await h.manager({action:'detail',id:r.receiptId});
 assert(!Object.hasOwn(record.record.form,'willingToDiscussPaidTrial'));
 assert.match(h.rows.get('notificationQueue/'+record.record.managerNotification.queueId).body,/舊版報名未記錄付費試上偏好.*不可視為同意/);
});
