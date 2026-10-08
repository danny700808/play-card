'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../private-calendar.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const calls=[],renders=[],nodes={};
 const ctx={S:{view:'list',listStart:new Date(2026,9,8),days:7,refreshVersion:0,events:[],status:{},calendars:[]},calendarSession:'session',
  api:(action,data)=>request('private',action,data),workApi:(action,data)=>request('shared',action,data),
  workEvent:t=>({...t,id:'shared:'+t.id,source:'shared'}),message(){},connectionRender(){},settingsRender(){},
  render(){renders.push(ctx.S.events.map(e=>e.id));},$:id=>nodes[id]||(nodes[id]={}),
 };
 function request(service,action,data){return new Promise((resolve,reject)=>calls.push({service,action,data,resolve,reject}));}
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf(' function range(){'),source.indexOf(' function connectionRender(){'))+source.slice(source.indexOf(' async function refresh(){'),source.indexOf(' const dayKey=')),ctx);
 function finish(batch,tag='one'){for(const c of batch){if(c.action==='status')c.resolve({googleConnected:false});else if(c.service==='private')c.resolve({events:[{id:tag,start:'2026-10-08T01:00:00Z'}]});else c.resolve({tasks:[]});}}
 return {ctx,calls,renders,finish};
}
test('first request covers seven calendar days; month mode requests the full grid',()=>{const {ctx}=harness();let r=ctx.range();assert.equal((new Date(r.end)-new Date(r.start))/86400000,7);ctx.S.view='month';ctx.S.month=new Date(2026,9,8);r=ctx.range();assert.equal((new Date(r.end)-new Date(r.start))/86400000,42);});
test('events start alongside metadata and paint while metadata is still pending',async()=>{const h=harness(),done=h.ctx.refresh();assert.equal(h.calls.length,4);h.calls.find(c=>c.action==='list'&&c.service==='private').resolve({events:[{id:'early'}]});await tick();assert.ok(h.renders.some(r=>r.includes('early')));assert.equal(h.ctx.S.loading,true);h.finish(h.calls);await done;assert.equal(h.ctx.S.loading,false);});
test('a slower previous range cannot overwrite a newer navigation',async()=>{const h=harness(),old=h.ctx.refresh(),first=h.calls.slice();h.ctx.S.listStart=new Date(2026,9,15);const recent=h.ctx.refresh(),second=h.calls.slice(4);h.finish(second,'new');await recent;h.finish(first,'old');await old;assert.deepEqual(Array.from(h.ctx.S.events,e=>e.id),['new']);});
test('locking during an in-flight load cannot restore private data',async()=>{const h=harness(),done=h.ctx.refresh();h.ctx.calendarSession='';h.ctx.S.events=[];h.finish(h.calls);await done;assert.equal(h.ctx.S.events.length,0);});
test('read failure remains incomplete and does not claim an empty schedule',async()=>{const h=harness(),done=h.ctx.refresh();h.calls[0].reject(Error('offline'));h.finish(h.calls.slice(1));await assert.rejects(done,/offline/);assert.equal(h.ctx.S.googleIncomplete,true);assert.equal(h.ctx.S.lastRefresh,0);});
test('show more fetches only the next seven days and deduplicates spanning events',async()=>{const h=harness(),first=h.ctx.refresh();h.finish(h.calls,'spanning');await first;const old=h.ctx.range();h.ctx.S.appendRange=old;h.ctx.S.days=14;const next=h.ctx.refresh(),batch=h.calls.slice(4);assert.equal(batch[0].data.start,old.end);assert.equal((new Date(batch[0].data.end)-new Date(batch[0].data.start))/86400000,7);assert.equal(h.ctx.S.events[0].id,'spanning');h.finish(batch,'spanning');await next;assert.equal(h.ctx.S.events.length,1);});
test('legacy shared entry redirects without loading private events or settings',async()=>{let redirect='',requests=0;const ctx={calendarSession:'',sessionStorage:{setItem(){}},URLSearchParams,location:{search:'?shared=1',replace:url=>redirect=url},refresh:()=>requests++,access:()=>requests++};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf(' async function openCalendar('),source.indexOf(' async function loginTask(')),ctx);await ctx.openCalendar({token:'valid'});assert.equal(redirect,'shared-calendar.html?owner=1');assert.equal(requests,0);});
test('returning within a minute avoids duplicate requests but shared changes invalidate the interval',async()=>{const h=harness();let calls=0;Object.assign(h.ctx,{document:{hidden:false},returnRefresh:false,refresh:async()=>calls++,syncSharedDate(){},message(){}});h.ctx.S.lastRefresh=Date.now();vm.runInContext(source.slice(source.indexOf(' async function refreshOnReturn(){'),source.indexOf(" window.addEventListener('focus'")),h.ctx);await h.ctx.refreshOnReturn();assert.equal(calls,0);h.ctx.syncSharedDate=()=>{h.ctx.S.lastRefresh=0;};await h.ctx.refreshOnReturn();assert.equal(calls,1);});
