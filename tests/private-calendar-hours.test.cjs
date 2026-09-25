'use strict';
process.env.TZ='Asia/Taipei';
const test=require('node:test'),assert=require('node:assert/strict'),{hourRanges,saveJobs}=require('../private-calendar-hours');
test('adjacent hours merge, separated hours stay separate and 24 means next midnight',()=>{
 const r=hourRanges('2026-09-30',[23,9,10,14,10]);assert.deepEqual(r.map(x=>[x.from,x.to]),[[9,11],[14,15],[23,24]]);
 assert.equal(r[2].end,'2026-09-30T16:00:00.000Z');assert.equal(hourRanges('2026-09-30',Array.from({length:24},(_,i)=>i)).length,1);
 assert.throws(()=>hourRanges('2026-09-30',[]));assert.throws(()=>hourRanges('2026-09-30',[24]));
});
const jobs=()=>hourRanges('2026-09-30',[9,10,14]).map((r,i)=>({id:'local'+i,event:{title:'同一件事',start:r.start,end:r.end,note:'',remind:true,reminderMinutes:10,completed:false,source:'google',calendarId:'personal',googleId:''},requestId:'request'+i,revision:0,googleWrite:true,files:[{name:'photo.png',mime:'image/png',size:1,base64:'AA=='}],uploaded:0,knownAssets:[]}));
function backend(fail){const calls=[],rows=new Map();return {calls,rows,api:async(action,data)=>{
 calls.push({action,data:structuredClone(data)});if(fail?.(action,data))throw Error('network failure');
 if(action==='googleWrite')return {event:{id:'event'+data.requestId,calendarId:data.calendarId,googleId:'google'+data.requestId}};
 if(action==='save'){rows.set(data.id,{...structuredClone(data.event),revision:data.revision+1,assets:[]});return {id:data.id};}
 if(action==='detail'){if(!rows.has(data.id))throw Object.assign(Error('missing'),{code:'functions/not-found'});return {event:structuredClone(rows.get(data.id))};}
 if(action==='upload'){const asset={id:'asset'+calls.length,name:data.name,mime:data.mime,size:1};rows.get(data.id).assets.push(asset);rows.get(data.id).revision++;return {asset};}
 throw Error(action);
}};}
test('every separate Google event gets the same title, reminder and attachment',async()=>{
 const b=backend(),j=jobs();await saveJobs(j,b.api);assert.equal(b.rows.size,2);
 for(const row of b.rows.values()){assert.equal(row.title,'同一件事');assert.equal(row.remind,true);assert.equal(row.reminderMinutes,10);assert.equal(row.assets.length,1);}
 assert.equal(new Set(b.calls.filter(x=>x.action==='googleWrite').map(x=>x.data.requestId)).size,2);
});
test('retry resumes incomplete segment without recreating completed event',async()=>{
 let fail=true;const b=backend((a,d)=>a==='save'&&d.id==='eventrequest1'&&fail),j=jobs();
 await assert.rejects(saveJobs(j,b.api));assert.equal(j[0].done,true);fail=false;await saveJobs(j,b.api);
 assert.equal(b.calls.filter(x=>x.action==='googleWrite').length,2);assert.equal(b.calls.filter(x=>x.action==='upload').length,2);assert.ok(j.every(x=>x.done));
});
test('lost save and upload responses recover from persisted state',async()=>{
 const b=backend(),j=jobs();let loseSave=true,loseUpload=true;
 const api=async(a,d)=>{const r=await b.api(a,d);if(a==='save'&&loseSave){loseSave=false;throw Error('lost save response');}if(a==='upload'&&loseUpload){loseUpload=false;throw Error('lost upload response');}return r;};
 await assert.rejects(saveJobs(j,api));await assert.rejects(saveJobs(j,api));await saveJobs(j,api);
 assert.equal(b.calls.filter(x=>x.action==='save').length,2);assert.equal(b.calls.filter(x=>x.action==='upload').length,2);assert.ok(j.every(x=>x.done));
});
