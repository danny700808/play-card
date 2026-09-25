'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {setup,event}=require('./shared-calendar.test.cjs');
const {createSharedEmail}=require('../functions/sharedCalendarEmail');
const {createSharedCore}=require('../functions/sharedCalendarCore');
test('Email is verified, throttled and selected only when LINE is not bound',async()=>{
 const f=setup(),m=await f.join(),mail=[];await m.call('lineUnlink');
 const sendEmail=async(to,subject,text)=>mail.push({to,subject,text}),emailBindings=createSharedEmail({db:f.db,sendEmail});
 const core=createSharedCore({db:f.db,auth:f.auth,ownerLine:async()=>null,sendLine:async()=>{throw Error('unexpected LINE');},emailBindings,sendEmail});
 const call=(action,data={})=>core.api({data:{action,teamSession:m.token,...data}});
 await call('emailStart',{email:'test@example.test'});assert.equal((await call('status')).myEmail,'');
 await assert.rejects(call('emailStart',{email:'spam@example.test'}),/稍後/);
 await assert.rejects(call('emailVerify',{code:'000000'}),/不正確/);const code=mail[0].text.match(/\d{6}/)[0];
 await call('emailVerify',{code});assert.equal((await call('status')).myEmail,'test@example.test');await assert.rejects(call('emailVerify',{code}),/失效/);
 await core.api({data:{action:'save',calendarSession:'owner-secret',id:'email-task',assignedTo:m.memberId,event:event()}});
 const result=await core.api({data:{action:'publish',calendarSession:'owner-secret',id:'email-task'}});assert.equal(result.notification.sent,1);assert.equal(mail.at(-1).to,'test@example.test');assert.match(mail.at(-1).subject,/交辦/);
 await assert.rejects(call('emailUnlink'),/先綁定 LINE/);f.rows.get('sharedCalendarMembers/'+m.memberId).lineUserId='U'+'c'.repeat(32);
 await call('emailUnlink');assert.equal((await call('status')).myEmail,'');
});
test('Email verification attempts are bounded and cannot survive membership reset',async()=>{
 const f=setup(),m=await f.join(),sent=[],email=createSharedEmail({db:f.db,sendEmail:async(...a)=>sent.push(a)}),who=await f.auth.identity({data:{teamSession:m.token}});
 await email.start(who,'test@example.test');for(let i=0;i<5;i++)await assert.rejects(email.verify(who,'wrong'));
 await assert.rejects(email.verify(who,sent[0][2].match(/\d{6}/)[0]),/失效/);
 f.rows.get('sharedCalendarEmailTickets/'+m.memberId).sentAt=0;await email.start(who,'test@example.test');await f.owner('reinvite',{memberId:m.memberId});await assert.rejects(email.verify(who,sent[1][2].match(/\d{6}/)[0]));
});
