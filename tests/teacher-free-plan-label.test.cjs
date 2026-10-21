'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const fixture=fs.readFileSync(path.join(__dirname,'course-portal.test.js'),'utf8');
const backend=fs.readFileSync(path.join(root,'functions/coursePortal.js'),'utf8')+'\nmodule.exports.labels=teacherLessonPlanLabels;';
const context={root,backend,Module,require,module,path};vm.createContext(context);
vm.runInContext(fixture.slice(fixture.indexOf('function backendFixtureDocument('),fixture.indexOf('function mirrorFixture(')),context);
const label=context.loadBackendForScheduleTests({collections:{}}).labels;
const event=(date,id=date)=>({id,sourceId:'course',fixedCourseId:'course',teacherId:'t',subjectId:'guitar',studentIds:['s'],date,startTime:'18:00',endTime:'19:00',status:'scheduled'});
const free=()=>({id:'free',studentId:'s',teacherId:'t',subjectId:'guitar',periodNo:1,startDate:'2026-10-21',lessonCount:2,usedCount:0,voidedLessonCount:1,expectedAmount:0,planSnapshot:{amount:0,name:'免費課程',splitType:'none',splitValue:0}});
const paid=()=>({...free(),id:'paid',periodNo:2,lessonCount:4,voidedLessonCount:0,expectedAmount:2800,planSnapshot:{amount:2800,name:'一般課程',splitType:'ratio',splitValue:.7}});
test('first free lesson is labelled and next paid lesson is not, without changing accounting',()=>{
  const data={s:{periods:[free(),paid()],attendance:[]}},before=JSON.stringify(data);
  const rows=label([event('2026-10-28'),event('2026-10-21')],data);
  assert.equal(rows[1].lessonPlanLabel,'免費課程');assert.equal(rows[0].lessonPlanLabel,'');
  assert.equal(JSON.stringify(data),before);
});
test('attended free lesson keeps its label after allowance is consumed',()=>{
  const period=free();period.usedCount=1;
  const record={studentId:'s',teacherId:'t',subjectId:'guitar',courseId:'course',date:'2026-10-21',periodId:'free',lessonUnits:1};
  const rows=label([{...event('2026-10-21'),status:'attended'},event('2026-10-28')],{s:{periods:[period,paid()],attendance:[record]}});
  assert.equal(rows[0].lessonPlanLabel,'免費課程');assert.equal(rows[1].lessonPlanLabel,'');
});
test('unconfigured amount is not labelled free and another subject does not consume allowance',()=>{
  const missing=free();delete missing.expectedAmount;delete missing.planSnapshot.amount;
  assert.equal(label([event('2026-10-21')],{s:{periods:[missing],attendance:[]}})[0].lessonPlanLabel,'');
  const rows=label([{...event('2026-10-21','other'),subjectId:'piano'},event('2026-10-21')],{s:{periods:[free(),paid()],attendance:[]}});
  assert.equal(rows[1].lessonPlanLabel,'免費課程');
});
test('teacher calendar and signing menu display free label while keeping the signing action',()=>{
  const source=fs.readFileSync(path.join(root,'teacher-course-portal-v8.js'),'utf8');
  let html='';
  const scope={clean:x=>String(x||''),todayKey:()=> '2026-10-21',isPastSlot:()=>false,courseSlotIsPast:()=>false,dayLabel:x=>x,
    escapeHtml:x=>String(x).replaceAll('<','&lt;'),showQuick:(title,subtitle,content)=>html=content};
  vm.createContext(scope);
  vm.runInContext(source.slice(source.indexOf('  function quickActionRow('),source.indexOf('  function openContactBook(')),scope);
  scope.openQuickForLesson({...event('2026-10-21'),lessonPlanLabel:'免費課程'});
  assert.match(html,/免費課程/);assert.match(html,/<button type="button" data-quick-attendance>老師簽到<\/button>/);
  const card=source.slice(source.indexOf('  function lessonCard('),source.indexOf('  function overlapGroups('));
  Object.assign(scope,{teacherOperations:{busy:()=>false},operationKey:()=>'',});
  vm.runInContext(card,scope);assert.match(scope.lessonCard({...event('2026-10-21'),lessonPlanLabel:'免費課程'}),/免費課程/);
});
