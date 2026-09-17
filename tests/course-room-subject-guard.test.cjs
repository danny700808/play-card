'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const backend=fs.readFileSync('functions/coursePortal.js','utf8');
const extract=(src,name,next)=>src.slice(src.indexOf(name),src.indexOf(next,src.indexOf(name)));
for(const file of ['course-scheduler.js','operations-course-inline-runtime.js']){
 const src=fs.readFileSync(file,'utf8'),ctx={clean:v=>String(v||''),roomKindOf:r=>r.roomKind||'normal',subjectById:id=>({name:{drum:'爵士鼓',piano:'鋼琴'}[id]}),roomPianoType:r=>r.pianoType||'none'};
 vm.createContext(ctx);vm.runInContext(extract(src,'  function roomAllowsSubject(','  function updateRoomOptions('),ctx);
 test(file+': instrument restrictions use existing settings and equipment',()=>{
  const piano={name:'YAMAHA直立鋼琴教室',allowedSubjectIds:['piano'],pianoType:'upright_piano',roomRulesVersion:1,rentalEquipment:[]};
  const drums={name:'鼓教室',allowedSubjectIds:['drum'],pianoType:'none',roomRulesVersion:1,rentalEquipment:['electronic_drums']};
  assert(!ctx.roomAllowsSubject(piano,'drum'));assert(ctx.roomAllowsSubject(piano,'piano'));
  assert(!ctx.roomAllowsSubject(drums,'piano'));assert(ctx.roomAllowsSubject(drums,'drum'));
  assert(!ctx.roomAllowsSubject({...drums,allowedSubjectIds:[],rentalEquipment:[]},'drum'));
  assert(ctx.roomAllowsSubject({name:'展演空間（電子鼓）',allowedSubjectIds:['drum'],rentalEquipment:['electronic_drums'],roomRulesVersion:1},'drum'));
 });
}
const ctx={clean:v=>String(v||''),firstArray:(r,keys)=>keys.map(k=>r[k]).find(Array.isArray)||[],currentTaipeiDay:()=> '2026-09-17',HttpsError:class extends Error{constructor(c,m){super(m)}}};
vm.createContext(ctx);vm.runInContext(extract(backend,'function followupLessonSource(','async function teacherAvailability('),ctx);
test('irregular and stopped single lessons retain their original subject without further reads',()=>{
 const mode={id:'i',teacherId:'t',subjectId:'drum',studentIds:['s']};const bundle={irregularModes:[mode]};const request={action:'extra_lesson',irregularId:'i',subjectId:'drum',studentIds:['s']};
 assert.equal(ctx.followupLessonSource(request,bundle,'t',null).subjectId,'drum');
 assert.throws(()=>ctx.followupLessonSource({...request,subjectId:'piano'},bundle,'t',null),/原課程/);
 assert.throws(()=>ctx.followupLessonSource(request,bundle,'other',null),/已變更/);
 assert.throws(()=>ctx.followupLessonSource({...request,subjectId:'piano',irregularId:''},bundle,'t',mode),/原課程/);
});
for(const file of ['course-scheduler.js','operations-course-inline-runtime.js']){
 const src=fs.readFileSync(file,'utf8');
 test(file+': rental price edits apply only committed fields without reloading the workspace',async()=>{
  const row={id:'r',type:'rental',date:'2026-09-17',start:'13:00',duration:60,roomId:'room',rentalFee:100,clientName:'測試'};
  let calls=0;const c={state:{currentDate:row.date},storedMigrationPin:()=>'',findEvent:()=>row,materializeEvent:v=>v,renderCalendar(){},scheduleWorkspaceSave(){},window:{YouziCoursePreviewData:{saveLessonSettings:async req=>{calls++;assert.equal(req.kind,'rentalDetails');return {ok:true,fields:{rentalFee:200}};},loadPublished:async()=>{throw Error('must not reload workspace');}}}};
  vm.createContext(c);vm.runInContext(extract(src,'  async function persistScheduleChange(','  function nextPeriodNumber('),c);
  await c.persistScheduleChange({...row,rentalFee:200},{source:{...row}});assert.equal(row.rentalFee,200);assert.equal(calls,1);
  c.window.YouziCoursePreviewData.saveLessonSettings=async()=>{throw Error('save failed');};
  await assert.rejects(c.persistScheduleChange({...row,rentalFee:300},{source:{...row}}),/save failed/);assert.equal(row.rentalFee,200);
 });
}
