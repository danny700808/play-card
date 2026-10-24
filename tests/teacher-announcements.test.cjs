'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTeacherAnnouncements,recipients}=require('../functions/teacherAnnouncements');
const {datesBetween,filterReminder,prepareReminder}=require('../functions/courseClosurePolicy');
const LINE='U'+'a'.repeat(32);
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const tomorrow=new Date(Date.parse(day)+86400000).toISOString().slice(0,10);
function fixture(){
  const store=new Map();let chain=Promise.resolve();
  const snap=(path)=>({id:path.split('/').at(-1),exists:store.has(path),data:()=>structuredClone(store.get(path))});
  const ref=path=>({path,id:path.split('/').at(-1),get:async()=>snap(path),create:async data=>{assert(!store.has(path));store.set(path,structuredClone(data));}});
  const collection=name=>{const query={name,doc:id=>ref(name+'/'+id),get:async()=>({docs:[...store.keys()].filter(k=>k.startsWith(name+'/')).map(snap)})};query.orderBy=()=>query;query.limit=()=>query;return query;};
  const db={collection,runTransaction:fn=>{const run=chain.then(async()=>{const writes=[];const result=await fn({get:r=>r.get(),create:(r,d)=>writes.push(()=>{assert(!store.has(r.path));store.set(r.path,structuredClone(d));}),set:(r,d,opts)=>writes.push(()=>store.set(r.path,opts?.merge?{...store.get(r.path),...structuredClone(d)}:structuredClone(d))),update:(r,d)=>writes.push(()=>store.set(r.path,{...store.get(r.path),...structuredClone(d)}))});writes.forEach(w=>w());return result;});chain=run.catch(()=>{});return run;}};
  const teachers=[{id:'t1',name:'甲老師'},{id:'t2',name:'乙老師'},{id:'t3',name:'丙老師'}];
  store.set('coursePortalTeacherBindings/a',{teacherId:'t1',status:'active',lineUserId:LINE,email:'one@example.test'});
  store.set('coursePortalTeacherBindings/b',{teacherId:'t2',status:'active',email:'two@example.test'});
  const events=[{teacherId:'t1',date:day,status:'scheduled'},{teacherId:'t1',date:day,status:'scheduled'},{teacherId:'t2',date:day,status:'scheduled'}];
  const handle=createTeacherAnnouncements({db,loadTeachers:async()=>teachers,loadSchedule:async()=>events,uploadImage:async()=> 'https://example.test/image.jpg'});
  return {db,store,events,handle,async payload(extra={}){const preview=await handle({action:'inspect',startDate:day,endDate:day},'admin');return {action:'submit',kind:'closure',startDate:day,endDate:day,title:'停課',body:'今天停課',reason:'颱風',teacherIds:['t1','t2'],directoryVersion:preview.directoryVersion,requestId:'request_1234567890',...extra};}};
}
test('valid date range rejects invalid leap day and limits duration',()=>{assert.throws(()=>datesBetween('2026-02-29','2026-03-01'));assert.throws(()=>datesBetween('2026-01-01','2026-02-01'));assert.equal(datesBetween('2028-02-28','2028-03-01').length,3);});
test('uses existing bindings once per teacher; LINE first, Email second; ambiguous accounts excluded',()=>{
  const bindings=[{teacherId:'a',status:'active',lineUserId:LINE,email:'a@example.test'},{teacherId:'a',status:'active',email:'a@example.test'},{teacherId:'b',status:'active',email:'b@example.test'}];
  const rows=recipients([{id:'a'},{id:'b'},{id:'c'}],bindings,[{teacherId:'a',status:'scheduled'},{teacherId:'a',status:'leave'}]);assert.equal(rows.length,3);assert.equal(rows.find(r=>r.teacherId==='a').channel,'line');assert.equal(rows.find(r=>r.teacherId==='a').lessonCount,1);assert.equal(rows.find(r=>r.teacherId==='b').channel,'email');assert.equal(rows.find(r=>r.teacherId==='c').eligible,false);
  bindings.push({teacherId:'a',status:'active',lineUserId:'U'+'b'.repeat(32)});assert.equal(recipients([{id:'a'}],bindings,[])[0].eligible,false);
});
test('inspect is read-only and excludes private contact addresses',async()=>{const f=fixture(),size=f.store.size;const p=await f.handle({action:'inspect',startDate:day},'admin');assert.equal(f.store.size,size);assert.equal(p.rows.length,3);assert(!JSON.stringify(p).includes('@'));assert(!JSON.stringify(p).includes(LINE));});
test('closure and two notifications committed together; double click and concurrent retry do not duplicate',async()=>{const f=fixture(),p=await f.payload();const results=await Promise.all([f.handle(p,'admin'),f.handle(p,'admin')]);assert.equal(results.filter(r=>r.duplicate).length,1);assert.equal(f.store.get('courseClassClosures/'+day).active,true);const queues=[...f.store].filter(([k])=>k.startsWith('notificationQueue/'));assert.equal(queues.length,2);assert.equal(queues[0][1].channel,'line');assert.equal(queues[1][1].channel,'email');assert(![...f.store.keys()].some(k=>/attendance|payroll|tuition/i.test(k)));});
test('unselected teacher still covered by whole-school closure; zero recipients permits closure only',async()=>{const f=fixture();await f.handle(await f.payload({teacherIds:[]}),'admin');assert.equal(f.store.get('courseClassClosures/'+day).active,true);assert.equal([...f.store.keys()].filter(k=>k.startsWith('notificationQueue/')).length,0);});
test('general announcement never creates a closure',async()=>{const f=fixture();await f.handle(await f.payload({kind:'notice'}),'admin');assert(!f.store.has('courseClassClosures/'+day));});
test('reject stale roster, invalid teacher, overlapping closure and changed request id payload',async()=>{const f=fixture(),p=await f.payload();f.events.push({teacherId:'t1',status:'scheduled',date:day});await assert.rejects(()=>f.handle(p,'admin'),/已變更/);const p2=await f.payload();await assert.rejects(()=>f.handle({...p2,teacherIds:['t3']},'admin'),/綁定資料/);await f.handle(p2,'admin');await assert.rejects(()=>f.handle({...p2,title:'Changed'},'admin'),/內容已變更/);await assert.rejects(()=>f.handle({...p2,requestId:'different_12345678'},'admin'),/已有停課/);});
test('release preserves notices and original records, idempotent and scoped by announcement owner',async()=>{const f=fixture(),p=await f.payload();await f.handle(p,'admin');const size=f.store.size;await f.handle({action:'release',id:p.requestId},'admin');assert.equal(f.store.get('courseClassClosures/'+day).active,false);assert.equal(f.store.size,size);assert.equal((await f.handle({action:'release',id:p.requestId},'admin')).duplicate,true);});
test('unauthorized call cannot inspect or change data',async()=>{const f=fixture();await assert.rejects(()=>f.handle({action:'inspect',startDate:day},''),/管理者/);});
test('image must belong to current manager, and history reports actual Email fallback state',async()=>{const f=fixture();f.store.set('teacherAnnouncementImages/asset_12345678900',{actor:'other',url:'https://example.test/a.jpg'});await assert.rejects(async()=>f.handle(await f.payload({assetId:'asset_12345678900'}),'admin'),/重新上傳/);await f.handle(await f.payload(),'admin');const key=[...f.store.keys()].find(k=>k.startsWith('notificationQueue/'));const q=f.store.get(key);f.store.set(key,{...q,status:'已轉寄Email',fallbackQueueId:'fallback'});f.store.set('notificationQueue/fallback',{status:'已發送'});const h=await f.handle({action:'inspect',startDate:day},'admin');assert.equal(h.history[0].deliveries[0].channel,'email');assert.equal(h.history[0].deliveries[0].status,'已發送');});
test('send-time suppression handles queued reminders and removes only closed lesson sections on normal days',async()=>{const row={eventCode:'teacher_daily_courses',noticeDate:tomorrow,reminderSections:[{date:day,body:'closed yesterday'},{date:tomorrow,body:'open today'}],reminderFooter:'portal',body:'old'};assert.equal(filterReminder(row,new Set([tomorrow])).cancelled,true);const filtered=filterReminder(row,new Set([day]));assert.equal(filtered.row.body,'open today\n\nportal');const f=fixture();f.store.set('courseClassClosures/'+tomorrow,{active:true});assert.equal((await prepareReminder(f.db,row)).cancelled,true);});
test('unrelated notifications do not read closure storage; old queued reminders cancelled conservatively',async()=>{const row={eventCode:'teacher_payroll_transfer_completed'};assert.equal((await prepareReminder({collection(){throw Error('unexpected read')}},row)).row,row);assert.equal(filterReminder({eventCode:'teacher_evening_attendance',noticeDate:day},new Set([day])).cancelled,true);});

test('explicit nonconsecutive dates ignore legacy range, normalize duplicates and reject malformed days',()=>{
 const {range}=require('../functions/teacherAnnouncements');
 assert.deepEqual(range({dates:['2026-12-03','2026-12-01','2026-12-03'],startDate:'2026-12-01',endDate:'2026-12-03'}),['2026-12-01','2026-12-03']);
 for(const dates of [[],['2026-02-29'],['bad'],null])assert.throws(()=>range({dates}));
});
test('multiple owned images retain order in queue and history, and retries do not duplicate',async()=>{
 const f=fixture(),assetIds=Array.from({length:12},(_,i)=>'image_asset_123456_'+i);
 for(const id of assetIds)f.store.set('teacherAnnouncementImages/'+id,{actor:'admin',url:'https://example.test/'+id+'.jpg'});
 const p=await f.payload({assetIds});await f.handle(p,'admin');assert.equal((await f.handle(p,'admin')).duplicate,true);
 const q=[...f.store].find(([k])=>k.startsWith('notificationQueue/'))[1];assert.deepEqual(q.lineImageUrls,assetIds.map(id=>'https://example.test/'+id+'.jpg'));
 const h=await f.handle({action:'inspect',dates:[day]},'admin');assert.deepEqual(h.history[0].imageUrls,q.lineImageUrls);
 await assert.rejects(()=>f.handle({...p,assetIds:assetIds.slice().reverse()},'admin'),/內容已變更/);
});
test('image upload accepts 10 MiB boundary and rejects larger payload before storing',async()=>{
 const f=fixture();const encoded=Buffer.alloc(10*1024*1024).toString('base64');
 const r=await f.handle({action:'upload',base64:encoded},'admin');assert(r.assetId);
 await assert.rejects(()=>f.handle({action:'upload',base64:Buffer.alloc(10*1024*1024+1).toString('base64')},'admin'),/10 MB/);
});
