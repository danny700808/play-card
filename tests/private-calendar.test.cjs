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
