'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const fixture=fs.readFileSync(path.join(__dirname,'course-portal.test.js'),'utf8');
const source=fs.readFileSync(path.join(root,'functions/coursePortal.js'),'utf8');
const names=['attendanceLessonUnits','eventLessonUnits','attendanceAllocations','attendancePeriodPayroll','attendancePayrollCalculation','applyPortalAttendanceToPeriods','attendancePeriodsForEvent','attendancePeriodCandidate','buildAttendanceTuitionRollover','tuitionLessonCount','tuitionUsedCount'];
const backend=source+'\nmodule.exports.half={'+names.join(',')+'};';
const context={root,backend,Module,require,module,path};vm.createContext(context);
vm.runInContext(fixture.slice(fixture.indexOf('function backendFixtureDocument('),fixture.indexOf('function mirrorFixture(')),context);
const api=context.loadBackendForScheduleTests({collections:{}}).half;
const ui=require('../course-lesson-units');
const period=(id='p1',used=0)=>({id,studentId:'s',teacherId:'t',subjectId:'piano',periodNo:1,systemPeriodNo:1,startDate:'2026-09-01',lessonCount:4,usedCount:used,expectedAmount:3200,planId:'plan',planSnapshot:{id:'plan',amount:3200,splitType:'fixed',splitValue:401}});
const event={id:'e',studentIds:['s'],teacherId:'t',subjectId:'piano',date:'2026-09-12',startTime:'15:00',endTime:'15:30'};
test('30-minute attendance pays exactly half for fixed and proportional plans; legacy attendance remains one',()=>{
 assert.equal(api.eventLessonUnits(event),.5);assert.equal(api.attendanceLessonUnits({}),1);
 const half=api.attendancePayrollCalculation(event,[{studentId:'s',period:period()}],event.date);
 assert.equal(half.teacherAmount,200.5);assert.equal(half.lessonPrice,400);
 const full=api.attendancePayrollCalculation({...event,endTime:'16:00'},[{studentId:'s',period:period()}],event.date);
 assert.equal(full.teacherAmount,401);assert.equal(half.teacherAmount*2,full.teacherAmount);
 const ratio=period();ratio.planSnapshot={...ratio.planSnapshot,splitType:'ratio',splitValue:.6};assert.equal(api.attendancePayrollCalculation(event,[{studentId:'s',period:ratio}],event.date).teacherAmount,240);
});
test('one attendance can allocate half to each period and compute salary once',()=>{
 const total=api.attendancePayrollCalculation({...event,endTime:'16:00'},[{studentId:'s',period:period(),lessonUnits:.5},{studentId:'s',period:{...period('p2'),periodNo:2},lessonUnits:.5}],event.date);
 assert.equal(total.teacherAmount,401);assert.equal(total.lessonPrice,800);
});
const row={id:'a',studentId:'s',teacherId:'t',courseId:'c',eventId:'e',date:'2026-09-12',status:'attended',active:true,deducted:true,periodId:'p1',lessonUnits:.5};
test('a half-lesson consumes .5 and cancellation returns .5 without changing tuition',()=>{
 const a=api.applyPortalAttendanceToPeriods([period()],[],[row]);assert.equal(a[0].usedCount,.5);assert.equal(a[0].expectedAmount,3200);
 const cancelled={...row,active:false,status:'cancelled',source:'attendance-cancellation-approved'};
 assert.equal(api.applyPortalAttendanceToPeriods([period()],[],[cancelled])[0].usedCount,0);
 assert.equal(api.applyPortalAttendanceToPeriods([period('p1',.5)],[row],[cancelled])[0].usedCount,0);
});
test('cross-period cancellation restores both original halves and duplicate mirror rows do not double deduct',()=>{
 const cross={...row,lessonUnits:1,periodAllocations:[{periodId:'p1',lessonUnits:.5},{periodId:'p2',lessonUnits:.5}]};
 const actual=api.applyPortalAttendanceToPeriods([period('p1',3.5),period('p2')],[],[cross]);assert.deepEqual(actual.map(r=>r.usedCount),[4,.5]);
 const mirrored=api.applyPortalAttendanceToPeriods(actual,[cross],[cross]);assert.deepEqual(mirrored.map(r=>r.usedCount),[4,.5]);
 const cancelled={...cross,active:false,status:'cancelled',source:'attendance-cancellation-approved'};
 assert.deepEqual(api.applyPortalAttendanceToPeriods(actual,[cross],[cancelled]).map(r=>r.usedCount),[3.5,0]);
});
test('four physical cells can show two independently dated halves in one cell',()=>{
 const rows=[1,2,3].map(n=>({date:'2026-09-0'+n,lessonUnits:1})).concat([{date:'2026-09-04',lessonUnits:.5},{date:'2026-09-05',lessonUnits:.5}]);
 const cells=ui.slots(period('p1',4),rows);assert.equal(cells.length,4);assert.equal(cells[3].length,2);assert.equal(cells[3].reduce((n,r)=>n+r.slotUnits,0),1);
});
test('frontends load half-slot renderer and both schedule APIs enforce acknowledgement',()=>{
 for(const file of ['teacher-course-portal.html','student-course-portal.html','portal.html','operations-hub.html'])assert.match(fs.readFileSync(path.join(root,file),'utf8'),/course-lesson-units.js/);
 assert.match(source,/targetDuration === 30 && data.halfHourAcknowledged !== true/);
 assert.match(source,/raw.halfHourAcknowledged !== true/);
 const teacher=fs.readFileSync(path.join(root,'teacher-course-portal-v8.js'),'utf8');assert.match(teacher,/接下來四堂課內/);assert.match(teacher,/halfHourAcknowledged: planner.halfHourAcknowledged === true/);
 const runtime=fs.readFileSync(path.join(root,'operations-course-inline-runtime.js'),'utf8');assert.match(runtime,/halfHourAcknowledged/);assert.match(runtime,/YouziLessonUnits/);
});
test('actual period resolution fills the old half-slot and creates a full-price next period',async()=>{
 const c={...api,ATTENDANCE_RECORDS:'attendance',ATTENDANCE_PAYROLL:'payroll',clean:v=>String(v??'').trim(),sourceId:r=>r?.id||'',eventStudentIds:e=>e.studentIds,eventTeacherId:e=>e.teacherId,eventSubjectId:e=>e.subjectId,
  mirrorRowsByField:async type=>type==='tuitionPeriods'?[period('p1',3.5)]:[],
  db:{collection:()=>({where(){return this;},async get(){return{docs:[]};}})},
  assignNewSystemPeriodNumbers:async rows=>rows,attendanceHistoricalSplitSource:()=>null,
  teacherPayrollSplitRows:()=>[],enrichTeacherPayrollRows:()=>[],jsonValue:x=>x,
  eventDate:r=>r.date,HttpsError:class extends Error{constructor(code,message){super(message);}}};
 vm.createContext(c);const at=source.indexOf('async function attendancePeriodsForEvent(');vm.runInContext(source.slice(at,source.indexOf('\nfunction attendanceChangePayload',at)),c);
 const result=await c.attendancePeriodsForEvent({...event,endTime:'16:00'},event.date,{allowRollover:true});
 assert.equal(result.rows.length,2);assert.deepEqual(Array.from(result.rows,r=>r.lessonUnits),[.5,.5]);
 assert.equal(result.rollovers.length,1);assert.equal(result.rollovers[0].period.expectedAmount,3200);assert.equal(result.rollovers[0].period.lessonCount,4);
});
