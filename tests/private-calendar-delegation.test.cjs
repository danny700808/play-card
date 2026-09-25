'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../private-calendar.js'),'utf8'),{saveJobs}=require('../shared-calendar-jobs');
function fixture(){const els={title:{value:'送吉他'},handoffNote:{value:'請帶琴袋'},workAssignee:{value:'member-b'},remind:{checked:true}},S={current:null,pending:[{name:'照片',type:'image/png'}]},calls=[];const ctx={S,$:id=>els[id]||(els[id]={}),selectedRanges:()=>[{start:'2026-10-01T10:00:00.000Z',end:'2026-10-01T11:00:00.000Z'}],selectedReminders:()=>[30,60],base64:async()=> 'fixture-image',crypto:require('node:crypto')};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf(' async function prepareWorkJobs()'),source.indexOf(' function assetNode(')),ctx);return {ctx,els,calls};}
test('private composer sends only selected shared task fields and uploads before publication',async()=>{
 const {ctx}=fixture(),jobs=await ctx.prepareWorkJobs();assert.equal(jobs[0].assignedTo,'member-b');assert.equal(jobs[0].event.note,'請帶琴袋');assert.equal(jobs[0].event.source,undefined);assert.equal(jobs[0].event.calendarId,undefined);assert.equal(jobs[0].event.completed,undefined);
 const calls=[];let fail=true;const api=async(action,data)=>{calls.push({action,data});if(action==='upload'&&fail){fail=false;throw Error('temporary upload');}return action==='publish'?{notification:{sent:1,pending:0}}:{};};
 await assert.rejects(saveJobs(jobs,api));assert.deepEqual(calls.map(x=>x.action),['save','upload']);await saveJobs(jobs,api);assert.deepEqual(calls.map(x=>x.action),['save','upload','upload','publish']);assert.equal(calls[1].data.assetId,calls[2].data.assetId);
});
test('existing private events cannot silently become shared tasks',async()=>{const {ctx}=fixture();ctx.S.current={source:'local',note:'private note'};await assert.rejects(ctx.prepareWorkJobs(),/新增/);});
