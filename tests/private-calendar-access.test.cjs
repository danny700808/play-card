'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto'),{database}=require('./helpers/security-fixtures.cjs'),{createAccess}=require('../functions/privateCalendarAccess');
function setup(verifier){const cfg={uid:'owner-calendar',passwordSalt:'test-salt',passwordHash:crypto.scryptSync('test-password','test-salt',64).toString('hex'),version:'v1'},f=database({'privateCalendarServer/access':cfg});f.db.doc=p=>{const [col,...rest]=p.split('/'),r=f.db.collection(col).doc(rest.join('/'));r.delete=async()=>f.rows.delete(p);r.create=async v=>{if(f.rows.has(p))throw Error('exists');f.rows.set(p,v);};return r;};const collection=f.db.collection;f.db.collection=(...args)=>{const q=collection(...args),doc=q.doc;q.doc=id=>{const r=doc(id);r.create=async v=>{if(f.rows.has(r.path))throw Error('exists');f.rows.set(r.path,v);};return r;};return q;};return {...f,cfg,...createAccess(f.db,verifier)};}
const req=(action,more={})=>({data:{action,...more},rawRequest:{ip:'test-client'}});
test('password creates calendar-only opaque session, rejects guessing and expires',async()=>{
 const a=setup();await assert.rejects(a.api(req('password',{password:'wrong'})),/不正確/);
 const s=await a.api(req('password',{password:'test-password'}));assert.match(s.token,/^[\w-]{43}$/);assert.equal(s.customToken,undefined);assert.equal(await a.authorize(req('anything',{calendarSession:s.token})),'owner-calendar');
 assert.ok(!JSON.stringify([...a.rows.values()]).includes(s.token));await assert.rejects(a.authorize(req('status',{calendarSession:'fake'})));
 const session=[...a.rows.entries()].find(([k])=>k.startsWith('privateCalendarSessions/'));session[1].expiresAt=0;await assert.rejects(a.authorize(req('status',{calendarSession:s.token})));
});
test('five password attempts rate-limit subsequent guesses',async()=>{const a=setup();for(let i=0;i<5;i++)await assert.rejects(a.api(req('password',{password:'wrong'})));await assert.rejects(a.api(req('password',{password:'test-password'})),/次數過多/);});
test('passkey enrollment needs a fresh session and enforces origin, RP and user verification',async()=>{
 const seen=[],verifier={generateRegistrationOptions:async o=>{seen.push(o);return {challenge:'registration-challenge'};},verifyRegistrationResponse:async o=>{seen.push(o);return {verified:true,registrationInfo:{credential:{id:'key1',publicKey:Buffer.from('public-key'),counter:0,transports:['internal']}}};},generateAuthenticationOptions:async o=>{seen.push(o);return {challenge:'login-challenge'};},verifyAuthenticationResponse:async o=>{seen.push(o);return {verified:true,authenticationInfo:{newCounter:1}};}};
 const a=setup(verifier);await assert.rejects(a.api(req('registrationOptions')));
 const session=await a.api(req('password',{password:'test-password'})),start=await a.api(req('registrationOptions',{calendarSession:session.token}));
 assert.equal(seen[0].authenticatorSelection.userVerification,'required');assert.equal(seen[0].authenticatorSelection.authenticatorAttachment,'platform');
 await a.api(req('registrationVerify',{calendarSession:session.token,ticket:start.ticket,response:{id:'key1'}}));assert.equal(seen[1].expectedOrigin,'https://danny700808.github.io');assert.equal(seen[1].requireUserVerification,true);
 await assert.rejects(a.api(req('registrationVerify',{calendarSession:session.token,ticket:start.ticket,response:{id:'key1'}})),/失效/);
 const login=await a.api(req('authenticationOptions'));const result=await a.api(req('authenticationVerify',{ticket:login.ticket,response:{id:'key1'}}));assert.ok(result.token);assert.equal(seen.at(-1).expectedRPID,'danny700808.github.io');
 await assert.rejects(a.api(req('authenticationVerify',{ticket:login.ticket,response:{id:'key1'}})),/失效/);
 const record=[...a.rows.entries()].find(([k])=>k.startsWith('privateCalendarSessions/')&&k.endsWith(crypto.createHash('sha256').update(session.token).digest('hex')));record[1].createdAt=Date.now()-360000;await assert.rejects(a.api(req('registrationOptions',{calendarSession:session.token})),/再輸入/);
});
