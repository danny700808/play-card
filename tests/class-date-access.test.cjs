'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const access=require('../functions/classDateAccess');
const source=fs.readFileSync(require('node:path').join(__dirname,'../functions/coursePortal.js'),'utf8');
function fixture(){const rows=new Map(),calls=[];const db={collection:name=>({doc:id=>({id,get:async()=>{calls.push(id);return {id,data:()=>rows.get(id)};}})})};return {db,rows,calls};}
test('closure guards only active dates and rechecks within transactions after an earlier open result',async()=>{
 const f=fixture(),date='2026-10-25';await access.assertOpen(f.db,date);f.rows.set(date,{active:true,reason:'颱風天'});let reads=0;
 await assert.rejects(access.assertOpen(f.db,date,{get:ref=>{reads++;return ref.get();}}),/2026-10-25.*颱風天.*其他日期/);assert.equal(reads,1);
 await access.assertOpen(f.db,'2026-10-26');f.rows.set(date,{active:false});await access.assertOpen(f.db,date);
});
test('selected closed teacher slot fails before loading candidates; open date reaches normal validation',async()=>{
 const f=fixture(),day='2026-10-25';f.rows.set(day,{active:true,reason:'颱風天'});
 const c={db:f.db,require:()=>access,requireSession:async()=>({teacherId:'t'}),dateKey:v=>v,clean:v=>String(v||''),validPortalTime:()=>true,courseDateIsPast:()=>false,assertPortalAdvanceDate:()=>{},HttpsError:class extends Error{},currentTaipeiDay:()=>{throw Error('normal validation reached');}};
 vm.createContext(c);const start=source.indexOf('async function teacherSlotOptions(');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),c);
 await assert.rejects(c.teacherSlotOptions({date:day,startTime:'14:00'}),/颱風天/);await assert.rejects(c.teacherSlotOptions({date:'2026-10-26',startTime:'14:00'}),/normal validation reached/);
});
test('rental availability reports closure before exposing any available rooms',async()=>{
 const f=fixture(),date='2026-10-25';f.rows.set(date,{active:true,reason:'臨時休館'});
 const c={db:f.db,require:()=>access,requireSession:async()=>({role:'renter'}),dateKey:v=>v,clean:v=>String(v||''),rentalPolicySettings:async()=>({maxDurationMinutes:180}),timeMinutes:t=>Number(t.slice(0,2))*60+Number(t.slice(3)),validPortalTime:()=>true,HttpsError:class extends Error{}};
 vm.createContext(c);const start=source.indexOf('async function rentalAvailability(');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),c);await assert.rejects(c.rentalAvailability({date,startTime:'14:00',durationMinutes:60}),/臨時休館/);
});
