'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../private-calendar.js'),'utf8');
const boot=source.slice(source.indexOf(' const previousSession=calendarSession;'),source.lastIndexOf('})();'));
async function run(entry,fail=false){const calls=[],els={},ctx={calendarSession:'old-session',showGate:()=>{calls.push('locked');ctx.calendarSession='';},accessCall:async d=>calls.push(d.action),access:async()=>entry,faceAuthenticate:async()=>{calls.push('face');if(fail)throw Error('cancel');},$:id=>els[id]||(els[id]={}),window:{addEventListener(){}},location:{reload(){}},loginTask:fn=>{ctx.done=fn().catch(()=>calls.push('fallback'));}};vm.runInNewContext(boot,ctx);await ctx.done;return {calls,els};}
test('opening always locks old sessions then automatically authenticates once',async()=>{assert.deepEqual((await run({autoFace:true,hasPasskey:true})).calls,['locked','logout','face']);});
test('cancelled automatic verification does not loop or reuse the old session',async()=>{assert.deepEqual((await run({autoFace:true,hasPasskey:true},true)).calls,['locked','logout','face','fallback']);});
test('disabled preference stays locked; first-time setup opens password entry',async()=>{assert.deepEqual((await run({autoFace:false,hasPasskey:true})).calls,['locked','logout']);const r=await run({autoFace:true,hasPasskey:false});assert.deepEqual(r.calls,['locked','logout']);assert.equal(r.els.passwordFallback.open,true);});
