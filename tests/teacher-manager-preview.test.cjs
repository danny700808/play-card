'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {database}=require('./helpers/security-fixtures.cjs'),preview=require('../functions/mobilePreviewContext'),targets=require('../functions/teacherManagerPreview');
const approved={employeeId:'e1',name:'New teacher',identityType:'external',profileReviewStatus:'approved',accountStatus:'active',employmentStatus:'active',coursePortalTeacherId:'t1',externalTeacherProfileId:'p1'};
const profile={status:'active',employeeId:'e1',coursePortalTeacherId:'t1'};
function fixture(extra={}){return database({'employees/e1':approved,'externalTeacherProfiles/p1':profile,...extra});}
const source=fs.readFileSync('functions/coursePortal.js','utf8');
function harness(f,teachers=[{id:'t1',name:'New teacher',active:true}]){
 const clean=v=>String(v??'').trim(),ctx={db:preview.guard(f.db),clean,sourceId:r=>r.id,sourceActive:r=>r.active!==false,mirrorRows:async()=>teachers,
  HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}},mobilePreviewContext:preview,withPortalReads:fn=>fn,
  require:name=>{if(name==='./teacherManagerPreview')return targets;throw Error('Unexpected dependency '+name);}};
 for(const name of ['teacherPortalData','teacherUtilitySession','teacherContractSession','teacherAvailability','teacherSlotOptions','teacherAttendanceCorrectionOptions','courseLessonHistory','rentalDayBoard','rentalWeekBoard','rentalAvailability','rentalMyBookings','publicRentalSettings'])ctx[name]=async()=>({ok:true,selected:preview.current().teacherId,employeeId:preview.current().managerPreviewEmployeeId||'',method:name});
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function mobileTeacherRoster()'),source.indexOf('\nfunction parseContactBookImages')),ctx);return ctx;
}
test('approved teacher is listed and previewable before first login without provisioning a binding or token',async()=>{
 const f=fixture(),ctx=harness(f),before=JSON.stringify([...f.rows]);
 const roster=await ctx.mobileTeacherRoster();assert.equal(roster.length,1);assert.equal(roster[0].id,'t1');assert.equal(roster[0].name,'New teacher');
 assert.equal(roster[0].employeeId,undefined);assert.equal(roster[0].email,undefined);
 const result=await ctx.mobileTeacherRead('t1','coursePortalTeacherData',{teacherId:'other',managerPreviewEmployeeId:'other'});
 assert.equal(result.selected,'t1');assert.equal(result.employeeId,'e1');assert.equal(JSON.stringify([...f.rows]),before);assert.equal(preview.current(),undefined);
});
test('preview eligibility excludes pending, hidden, archived, inactive and mismatched personnel',async()=>{
 for(const patch of [{profileReviewStatus:'pending'},{accountStatus:'profile_draft'},{hiddenFromActiveLists:true},{archived:true},{active:false},{identityType:'staff'},{employmentStatus:'inactive'}]){
  const f=fixture({'employees/e1':{...approved,...patch}}),ctx=harness(f);assert.equal((await ctx.mobileTeacherRoster()).length,0);await assert.rejects(ctx.mobileTeacherRead('t1','coursePortalTeacherData'));
 }
 for(const patch of [{status:'submitted_pending_admin'},{employeeId:'other'},{coursePortalTeacherId:'other'},{deleted:true}]){
  const f=fixture({'externalTeacherProfiles/p1':{...profile,...patch}}),ctx=harness(f);assert.equal((await ctx.mobileTeacherRoster()).length,0);await assert.rejects(ctx.mobileTeacherRead('t1','coursePortalTeacherData'));
 }
 const f=fixture(),ctx=harness(f,[{id:'t1',active:false}]);assert.equal((await ctx.mobileTeacherRoster()).length,0);await assert.rejects(ctx.mobileTeacherRead('t1','coursePortalTeacherData'));
});
test('ambiguous or malformed personnel links cannot enable a preview',async()=>{
 const f=fixture({'employees/e2':{...approved,employeeId:'e2'}});assert.equal(await targets.approvedTeacherTarget(f.db,'t1'),null);
 assert.equal(await targets.approvedTeacherTarget(f.db,'../other'),null);
 const missing=fixture({'employees/e1':{...approved,externalTeacherProfileId:'missing'}});assert.equal(await targets.approvedTeacherTarget(missing.db,'t1'),null);
});
test('existing bound teacher previews are preserved and renter preview still requires a binding',async()=>{
 const f=database({'coursePortalTeacherBindings/b1':{teacherId:'old',status:'active',authAccountId:'account'}}),ctx=harness(f,[{id:'old',name:'Existing',active:true}]);
 assert.equal((await ctx.mobileTeacherRoster())[0].id,'old');assert.equal((await ctx.mobileTeacherRead('old','coursePortalTeacherData')).selected,'old');
 await assert.rejects(ctx.mobilePortalRead('renter','r1','coursePortalRentalMyBookings'));
});
test('all preview paths remain read-only and reject unsupported methods and write flags',async()=>{
 const f=fixture(),ctx=harness(f),before=JSON.stringify([...f.rows]);
 await assert.rejects(ctx.mobileTeacherRead('t1','coursePortalTeacherData',{save:true}),/唯讀/);
 await assert.rejects(ctx.mobileTeacherRead('t1','coursePortalTeacherAction'),/唯讀/);
 ctx.teacherPortalData=async()=>ctx.db.collection('employees').doc('e1').set({accountStatus:'disabled'});
 await assert.rejects(ctx.mobileTeacherRead('t1','coursePortalTeacherData'),/唯讀/);assert.equal(JSON.stringify([...f.rows]),before);
});
test('a preview identity sent in callable JSON does not create a real teacher session',async()=>{
 const ctx={mobilePreviewContext:preview,clean:v=>String(v??'').trim(),HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}}};vm.createContext(ctx);
 const start=source.indexOf('async function requireSession('),end=source.indexOf('  const ref = db.collection',start);vm.runInContext(source.slice(start,end)+'}',ctx);
 await assert.rejects(ctx.requireSession({managerPreviewEmployeeId:'e1',teacherId:'t1'},['teacher']),/請先登入/);
});
