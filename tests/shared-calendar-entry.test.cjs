'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {rememberChange,recentChange,changeKey}=require('../shared-calendar-jobs');
const source=fs.readFileSync(require.resolve('../shared-calendar.js'),'utf8');
function storage(initial={}){const rows=new Map(Object.entries(initial));return {getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};}
function entry(search,hash,saved){const ctx={URLSearchParams,location:{search,hash},sessionStorage:storage(saved),localStorage:storage()};vm.createContext(ctx);const code=source.slice(source.indexOf(' const params='),source.indexOf(' const S='));vm.runInContext(code+';globalThis.entry={invite,memberId,owner};',ctx);return ctx;}
test('LINE notification and owner links override a previously saved invitation',()=>{
 for(const search of ['?member=recipient&task=job','?task=job','?owner=1']){const ctx=entry(search,'',{youziSharedInvite:'consumed-invite'});assert.equal(ctx.entry.invite,'');assert.equal(ctx.sessionStorage.getItem('youziSharedInvite'),null);}
 const fresh=entry('?member=old','#invite=new-invite',{youziSharedInvite:'old-invite'});assert.equal(fresh.entry.invite,'new-invite');
 const callback=entry('','#lineTicket=callback-ticket',{youziSharedInvite:'pending-invite'});assert.equal(callback.entry.invite,'pending-invite');
});
test('saved shared event date can follow between private/shared pages without storing task contents',()=>{
 const s=storage(),now=Date.now();const day=rememberChange(s,'2026-09-27T23:00:00+08:00',now);assert.match(day,/^2026-09-/);assert.deepEqual(recentChange(s,0,now),{day,at:now});assert.equal(recentChange(s,now,now),null);assert.equal(recentChange(s,0,now+31*60000),null);assert.deepEqual(Object.keys(JSON.parse(s.getItem(changeKey))).sort(),['at','day']);s.setItem(changeKey,'not json');assert.equal(recentChange(s),null);
});
test('opening notification details focuses its date before showing the shared editor',async()=>{
 const calls=[],S={},task={id:'job',start:'2026-10-27T15:00:00Z'},ctx={S,api:async()=>({task,notifications:[]}),key:()=> '2026-10-27',refresh:async()=>calls.push('refresh'),showEditor:r=>{assert.equal(r.id,'job');calls.push('editor');},$:()=>({})};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf(' async function openTask('),source.indexOf(' function showEditor(')),ctx);await ctx.openTask('job',true);assert.equal(S.selected,'2026-10-27');assert.deepEqual(calls,['refresh','editor']);
});
