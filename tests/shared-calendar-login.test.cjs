'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto');
const {setup,event}=require('./shared-calendar.test.cjs');
const {hash}=require('../functions/sharedCalendarAccess');
const proof=()=>crypto.randomBytes(32).toString('base64url');
async function line(f,{invite,memberId,link,teamSession,line='U'+'d'.repeat(32),friend=true}={}){
 const verifier=proof(),r=await f.ar('lineLoginStart',{invite,memberId,link,teamSession,challenge:hash(verifier)}),state=new URL(r.authorizationUrl).searchParams.get('state');let redirect;
 const res={set(){},redirect(code,url){assert.equal(code,302);redirect=url;},status(){return this;},send(){}};
 await f.passwordless.callback({method:'GET',query:{state,code:'verified-provider-code'}},res,{exchange:async(code,callback)=>{assert.equal(callback,'https://asia-east1-youzi-c1b74.cloudfunctions.net/coursePortalLineLoginCallback');return {access_token:'provider-token'};},profile:async()=>({lineUserId:line,lineFriendFlag:friend})});
 assert.match(redirect,/#lineTicket=/);const ticket=new URLSearchParams(new URL(redirect).hash.slice(1)).get('lineTicket');await assert.rejects(f.ar('loginRedeem',{ticket:state,verifier}));return {ticket,verifier};
}
async function invite(f,name='Member'){return (await f.owner('invite',{name})).url.split('#invite=')[1];}
test('LINE invitation authorizes, binds, creates a session and routes assignment to that private LINE',async()=>{
 const f=setup(),i=await invite(f),r=await line(f,{invite:i});
 assert.equal([...f.rows.values()].filter(x=>x.status==='active').length,0);
 const joined=await f.ar('loginRedeem',r),m=f.rows.get('sharedCalendarMembers/'+joined.memberId);
 assert.equal(m.lineUserId,'U'+'d'.repeat(32));assert.equal(m.status,'active');assert.equal(m.passwordHash,'');
 await f.owner('save',{id:'line-work',assignedTo:joined.memberId,event:event()});await f.owner('publish',{id:'line-work'});assert.equal(f.sent[0].to,m.lineUserId);
 await assert.rejects(f.ar('loginRedeem',r),/失效/);await assert.rejects(line(f,{invite:i}),/已使用/);
 const next=await f.ar('loginRedeem',await line(f));assert.equal(next.memberId,joined.memberId);
});
test('OAuth return ticket cannot be used from another browser or with a forged profile',async()=>{
 const f=setup(),r=await line(f,{invite:await invite(f)});
 await assert.rejects(f.ar('loginRedeem',{...r,verifier:proof(),lineUserId:'U'+'e'.repeat(32)}),/原本/);
 const joined=await f.ar('loginRedeem',{...r,lineUserId:'U'+'e'.repeat(32)});assert.equal(f.rows.get('sharedCalendarMembers/'+joined.memberId).lineUserId,'U'+'d'.repeat(32));
 await assert.rejects(f.ar('loginRedeem',await line(f,{memberId:joined.memberId,line:'U'+'e'.repeat(32)})),/已綁定/);
});
test('revoked/reissued invitations invalidate pending OAuth; resetting clears old identity bindings',async()=>{
 const f=setup(),i=await invite(f),r=await line(f,{invite:i}),id=f.rows.get('sharedCalendarInvites/'+hash(i)).memberId;
 await f.owner('revoke',{memberId:id});await assert.rejects(f.ar('loginRedeem',r));
 const ni=(await f.owner('reinvite',{memberId:id})).url.split('#invite=')[1],joined=await f.ar('loginRedeem',await line(f,{invite:ni}));
 const oldLogin=await line(f,{memberId:id});const second=(await f.owner('reinvite',{memberId:id})).url.split('#invite=')[1];
 await assert.rejects(f.ar('loginRedeem',oldLogin));const m=f.rows.get('sharedCalendarMembers/'+id);assert.equal(m.lineUserId,'');assert.equal(m.email,'');
 await f.activate(second,'new-owner@example.test');await assert.rejects(f.ar('loginRedeem',await line(f)),/尚未加入/);
 await assert.rejects(f.core.api({data:{action:'status',teamSession:joined.token}}));
});
test('LINE claims prevent the same identity from activating two different invited members',async()=>{
 const f=setup();await f.ar('loginRedeem',await line(f,{invite:await invite(f,'A')}));
 const i=await invite(f,'B'),r=await line(f,{invite:i});await assert.rejects(f.ar('loginRedeem',r),/另一位/);
 assert.equal(f.rows.get('sharedCalendarInvites/'+hash(i)).used,false);
});
test('Email invite, subsequent passwordless login, wrong code limit and unknown email privacy',async()=>{
 const f=setup(),i=await invite(f),v=proof(),r=await f.ar('emailLoginStart',{invite:i,email:'hello@example.test',challenge:hash(v)}),code=f.mail.at(-1).text.match(/\d{6}/)[0];
 await assert.rejects(f.ar('loginRedeem',{ticket:r.ticket,verifier:v,code:'wrong'}),/不正確/);assert.equal(f.rows.get('sharedCalendarInvites/'+hash(i)).used,false);
 const joined=await f.ar('loginRedeem',{ticket:r.ticket,verifier:v,code});assert.equal(f.rows.get('sharedCalendarMembers/'+joined.memberId).email,'hello@example.test');
 f.rows.get('sharedCalendarLoginLimits/'+hash('email|hello@example.test')).sentAt=0;
 const next=await f.ar('emailLoginStart',{email:'hello@example.test',challenge:hash(v)});const login=await f.ar('loginRedeem',{ticket:next.ticket,verifier:v,code:f.mail.at(-1).text.match(/\d{6}/)[0]});assert.equal(login.memberId,joined.memberId);
 const count=f.mail.length,unknown=await f.ar('emailLoginStart',{email:'unknown@example.test',challenge:hash(v)});assert.ok(unknown.ticket);assert.equal(f.mail.length,count);await assert.rejects(f.ar('loginRedeem',{ticket:unknown.ticket,verifier:v,code:'123456'}),/失效/);
 const j=await invite(f),wrong=await f.ar('emailLoginStart',{invite:j,email:'attempts@example.test',challenge:hash(v)}),correct=f.mail.at(-1).text.match(/\d{6}/)[0];for(let n=0;n<5;n++)await assert.rejects(f.ar('loginRedeem',{ticket:wrong.ticket,verifier:v,code:'wrong'}));await assert.rejects(f.ar('loginRedeem',{ticket:wrong.ticket,verifier:v,code:correct}),/失效/);
});
test('concurrent Email redemption is single use and preserves unique identity claims',async()=>{
 const f=setup(),i=await invite(f),v=proof(),r=await f.ar('emailLoginStart',{invite:i,email:'only@example.test',challenge:hash(v)}),data={ticket:r.ticket,verifier:v,code:f.mail.at(-1).text.match(/\d{6}/)[0]};
 const results=await Promise.allSettled([f.ar('loginRedeem',data),f.ar('loginRedeem',data)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 f.rows.get('sharedCalendarLoginLimits/'+hash('email|only@example.test')).sentAt=0;
 await assert.rejects(f.activate(await invite(f,'Second'),'only@example.test'),/另一位/);
});
test('Email member can add LINE with authenticated linking; revoked and foreign owner cannot redeem',async()=>{
 const f=setup(),joined=await f.activate(await invite(f)),r=await line(f,{link:true,teamSession:joined.token});const linked=await f.ar('loginRedeem',r);assert.equal(linked.memberId,joined.memberId);
 const foreign=await line(f,{memberId:joined.memberId});f.rows.get('privateCalendarServer/access').uid='different';await assert.rejects(f.ar('loginRedeem',foreign),/失效/);
});
test('OAuth cancellation/invalid state stays on shared login and cannot issue sessions',async()=>{
 const f=setup(),v=proof(),r=await f.ar('lineLoginStart',{invite:await invite(f),challenge:hash(v)}),state=new URL(r.authorizationUrl).searchParams.get('state');let url;
 const res={set(){},redirect(_,u){url=u;}};
 await f.passwordless.callback({method:'GET',query:{state,error:'access_denied'}},res,{exchange:()=>assert.fail('must not exchange cancelled code')});assert.match(url,/shared-calendar.html#loginError=/);
 await assert.rejects(f.ar('loginRedeem',{ticket:state,verifier:v}));
});
