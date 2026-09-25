'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const p=require('../functions/privateCalendar')._test;
test('only authenticated private owner can use the API, other managers cannot',()=>{
 assert.throws(()=>p.owner({}),/私人行事曆/);
 assert.throws(()=>p.owner({auth:{uid:'other',token:{email:'other@example.com',admin:true}}}),/私人行事曆/);
 assert.equal(p.owner({auth:{uid:'owner',token:{email:'danny700808@gmail.com'}}}),'owner');
});
test('every callable operation rejects unauthorized callers before reading data',async()=>{
 for(const action of ['status','list','save','asset','upload','configureGoogle','connect','settings','testLine','googleWrite','detail','archive'])await assert.rejects(p.api({data:{action}}),/私人行事曆/);
});
test('event validation rejects invalid times and unsupported reminders',()=>{
 const e={title:'記事',start:'2026-09-24T10:00:00+08:00',end:'2026-09-24T11:00:00+08:00',reminderMinutes:10};
 assert.equal(p.validateEvent(e).start,'2026-09-24T02:00:00.000Z');
 for(const patch of [{title:''},{start:'bad'},{end:e.start},{reminderMinutes:-1}])assert.throws(()=>p.validateEvent({...e,...patch}));
 assert.equal(p.validateEvent({...e,remind:'true'}).remind,false);
});
test('shared Google calendars remain readonly and same event IDs in different calendars do not collide',()=>{
 const raw={id:'abc',summary:'社團',start:{dateTime:'2026-09-24T10:00:00+08:00'},end:{dateTime:'2026-09-24T11:00:00+08:00'}};
 const a=p.googleEvent(raw,{id:'a',accessRole:'reader'}),b=p.googleEvent(raw,{id:'b',accessRole:'owner'});
 assert.equal(a.editable,false);assert.equal(b.editable,true);assert.notEqual(a.id,b.id);
});
test('all day events remind at 09:00 Taiwan and retain exclusive Google end date',()=>{
 const e=p.googleEvent({id:'x',start:{date:'2026-09-24'},end:{date:'2026-09-25'}},{id:'c'});
 assert.equal(e.start,'2026-09-24T09:00:00+08:00');assert.equal(e.end,'2026-09-25T00:00:00+08:00');assert.equal(e.allDay,true);
});
test('reminders respect enabled, completion, cancellation and bounded catch-up',()=>{
 const now=Date.parse('2026-09-24T02:00:00Z'),e={id:'a',start:'2026-09-24T02:10:00Z',reminderMinutes:10,remind:true};
 assert.equal(p.due(e,now),true);assert.equal(p.due(e,now-1),false);
 for(const patch of [{remind:false},{completed:true},{status:'cancelled'},{start:'2026-09-22T02:10:00Z'}])assert.equal(p.due({...e,...patch},now),false);
});
test('delivery identity is stable for retries and changes when event time changes',()=>{
 const e={id:'a',start:'2026-09-24T02:00:00Z',reminderMinutes:10,reminderRevision:1};
 assert.equal(p.deliveryId(e),p.deliveryId({...e,note:'new note'}));assert.notEqual(p.deliveryId(e),p.deliveryId({...e,start:'2026-09-24T03:00:00Z'}));
});
test('old private notes cannot override Google rescheduling in reminder checks',()=>{
 const e={id:'a',source:'google',start:'2026-09-25T02:00:00Z'},old={start:'2026-09-24T02:00:00Z',remind:true};
 assert.equal(p.currentReminder(e,old).start,e.start);assert.equal(p.currentReminder({...e,source:'local'},old).start,old.start);
});
test('asset identifiers cannot escape owner storage namespace',()=>{
 for(const id of ['../other','x/y','','a'.repeat(129)])assert.equal(p.validId(id),false);assert.equal(p.validId('a-123'),true);
});
function fixture(){
 const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),rows=new Map();let serial=Promise.resolve();
 const snapshot=path=>({exists:rows.has(path),id:path.split('/').at(-1),ref:reference(path),data:()=>structuredClone(rows.get(path))});
 function reference(path){return {path,get:async()=>snapshot(path),set:async(data,opt)=>rows.set(path,{...(opt?.merge?rows.get(path):{}),...structuredClone(data)}),delete:async()=>rows.delete(path),collection:name=>collection(path+'/'+name)};}
 function collection(path){return {doc:id=>reference(path+'/'+id),get:async()=>({docs:[...rows.keys()].filter(k=>k.startsWith(path+'/')&&!k.slice(path.length+1).includes('/')).map(snapshot)})};}
 const db={collection,runTransaction(fn){const out=serial.then(async()=>{const writes=[];const value=await fn({get:ref=>ref.get(),set:(ref,data,opt)=>writes.push(()=>ref.set(data,opt)),update:(ref,data)=>writes.push(()=>ref.set(data,{merge:true}))});for(const f of writes)await f();return value;});serial=out.catch(()=>{});return out;}};
 const fakeAdmin={apps:[{}],firestore:()=>db};const mod={exports:{}};
 const customRequire=name=>name==='firebase-admin'?fakeAdmin:name==='./storageRouting'?{}:require('node:module').createRequire(require.resolve('../functions/privateCalendar'))(name);
 const script=fs.readFileSync(require.resolve('../functions/privateCalendar'),'utf8');
 const calls=[];
 const fetch=async url=>{calls.push(url);return {ok:true,status:200,json:async()=>url.includes('calendarList')?{items:[{id:'shared',summary:'社團',accessRole:'reader'}]}:{items:[]}};};
 vm.runInNewContext('(function(require,module,exports){'+script+'})',{fetch,URLSearchParams,AbortSignal,Buffer,console,process}).call(null,customRequire,mod,mod.exports);
 const base='privateCalendarUsers/'+crypto.createHash('sha256').update('owner').digest('hex');
 const run=(action,data={})=>mod.exports._test.api({auth:{uid:'owner',token:{email:'danny700808@gmail.com'}},data:{action,...data}});
 return {run,rows,base,calls};
}
test('private CRUD persists data and rejects simultaneous stale saves',async()=>{
 const x=fixture(),event={source:'local',title:'測試',start:'2026-09-24T10:00:00+08:00',end:'2026-09-24T11:00:00+08:00'};
 await x.run('save',{id:'a',revision:0,event});
 const results=await Promise.allSettled([x.run('save',{id:'a',revision:1,event:{...event,title:'新版甲'}}),x.run('save',{id:'a',revision:1,event:{...event,title:'新版乙'}})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const listed=await x.run('list',{start:'2026-09-24T00:00:00Z',end:'2026-09-25T00:00:00Z'});assert.equal(listed.events.length,1);assert.equal(listed.events[0].revision,2);
 await x.run('archive',{id:'a'});assert.equal((await x.run('list',{start:'2026-09-24T00:00:00Z',end:'2026-09-25T00:00:00Z'})).events.length,0);
});
test('server refuses writing to shared readonly Google calendar before any event mutation',async()=>{
 const x=fixture();x.rows.set(x.base+'/secrets/google',{refreshToken:'test',accessToken:'test',expiresAt:Date.now()+3600000});
 await assert.rejects(x.run('googleWrite',{calendarId:'shared',event:{title:'改動',start:'2026-09-24T10:00:00+08:00',end:'2026-09-24T11:00:00+08:00'}}),/查看權限/);
 assert.equal(x.calls.length,1);assert.match(x.calls[0],/calendarList/);
});
test('asset fetch cannot read an unassociated attachment even with valid IDs',async()=>{
 const x=fixture();x.rows.set(x.base+'/entries/a',{assets:[{id:'mine'}]});await assert.rejects(x.run('asset',{id:'a',assetId:'someone-else'}),/不存在/);
});
test('multiple reminders validate, persist and use independent delivery identities',async()=>{
 const start='2026-09-30T10:00:00+08:00',event={id:'multi',title:'多次提醒',start,end:'2026-09-30T11:00:00+08:00',remind:true,reminderOffsets:[4320,60,120,60]};
 const validated=p.validateEvent(event);assert.deepEqual(validated.reminderOffsets,[60,120,4320]);
 assert.throws(()=>p.validateEvent({...event,reminderOffsets:[]}));assert.throws(()=>p.validateEvent({...event,reminderOffsets:[999]}));
 const beforeThreeDays=Date.parse(start)-4320*60000;assert.deepEqual(p.dueReminders([event],beforeThreeDays).map(e=>e.reminderMinutes),[4320]);
 const beforeHour=Date.parse(start)-60*60000,queue=p.dueReminders([event],beforeHour);assert.deepEqual(queue.map(e=>e.reminderMinutes),[60,120]);assert.equal(new Set(queue.map(p.deliveryId)).size,2);
 assert.equal(p.dueReminders([{...event,completed:true}],beforeHour).length,0);
 const old={...event,reminderOffsets:undefined,reminderMinutes:60};assert.equal(p.deliveryId(p.dueReminders([old],beforeHour)[0]),p.deliveryId(old));
 const x=fixture();await x.run('save',{id:'multi',revision:0,event:{...event,source:'local'}});assert.deepEqual(Array.from(x.rows.get(x.base+'/entries/multi').reminderOffsets),[60,120,4320]);
});
