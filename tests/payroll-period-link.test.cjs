'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const fixture=fs.readFileSync(path.join(__dirname,'course-portal.test.js'),'utf8');
const source=fs.readFileSync(path.join(root,'functions/coursePortal.js'),'utf8');
const backend=source+'\nmodule.exports.linked={payrollWithCurrentPeriods,attendancePayrollCalculation,refreshPayrollPeriodLinks};';
const context={root,backend,Module,require,module,path};vm.createContext(context);
vm.runInContext(fixture.slice(fixture.indexOf('function backendFixtureDocument('),fixture.indexOf('function mirrorFixture(')),context);
const api=context.loadBackendForScheduleTests({collections:{}}).linked;
const period=(id='period_p',studentId='s',amount=2800)=>({id,studentId,subjectId:'guitar',lessonCount:4,expectedAmount:amount,discount:0,planSnapshot:{name:'外聘(6/4)'+amount,amount,splitType:'ratio',splitValue:.6,splitSource:'manager'}});
const row={id:'r',studentId:'s',teacherId:'t',subjectId:'guitar',date:'2026-09-04',sourcePaymentId:'p',lessonPrice:700,teacherAmount:0,splitType:'none',splitValue:0};
test('all teachers and both legacy/new records follow only the corrected period, without mutating audit records',()=>{
 for(const teacherId of ['t','other']){let r={...row,teacherId};let changed=api.payrollWithCurrentPeriods([r],[period()])[0];assert.equal(changed.teacherAmount,420);assert.equal(changed.allotRate,.6);assert.equal(changed.planSnapshot.name,'外聘(6/4)2800');assert.equal(r.teacherAmount,0);assert.equal(api.payrollWithCurrentPeriods([r],[period('different')])[0].teacherAmount,0);assert.equal(api.payrollWithCurrentPeriods([r],[period('period_p','other')])[0].teacherAmount,0);assert.equal(api.payrollWithCurrentPeriods([changed],[period('period_p','s',3200)])[0].teacherAmount,480);}
});
test('group and cross-period allocations preserve untouched plans, half lessons, cash and special adjustments',()=>{
 const old=period();old.planSnapshot.splitType='none';old.planSnapshot.splitValue=0;
 const other=period('p2','s2');other.planSnapshot.splitType='fixed';other.planSnapshot.splitValue=500;
 const event={studentIds:['s','s2'],teacherId:'t',date:'2026-09-04',teacherPayAdjustment:50};
 const initial={...event,...api.attendancePayrollCalculation(event,[{studentId:'s',period:old,lessonUnits:.5},{studentId:'s2',period:other,lessonUnits:1}],event.date),collectedAmount:800};
 const changed=api.payrollWithCurrentPeriods([initial],[period()])[0];assert.equal(changed.teacherAmount,760);assert.equal(changed.collectedAmount,800);assert.equal(changed.teacherPayAdjustment,50);
 const crossEvent={studentIds:['s'],teacherId:'t',date:'2026-09-04'};const next=period('next');next.planSnapshot.splitValue=.7;
 const cross={...crossEvent,...api.attendancePayrollCalculation(crossEvent,[{studentId:'s',period:old,lessonUnits:.5},{studentId:'s',period:next,lessonUnits:.5}],crossEvent.date)};
 assert.equal(api.payrollWithCurrentPeriods([cross],[period()])[0].teacherAmount,455);
});
test('cancelled, uncorrected free classes and teacher gifts are preserved; manual adjustment is never doubled',()=>{
 const free={...row,lessonPrice:0,teacherAmount:420,teacherPayAdjustment:420,teacherPayAdjustmentReason:'教室贈課程'};
 const freePeriod=period();freePeriod.planSnapshot.splitSource='unresolved';freePeriod.expectedAmount=0;
 assert.equal(api.payrollWithCurrentPeriods([free],[freePeriod])[0].teacherAmount,420);
 assert.equal(api.payrollWithCurrentPeriods([{...row,active:false}],[period()])[0].teacherAmount,0);
 assert.equal(api.payrollWithCurrentPeriods([{...row,specialLesson:true}],[period()])[0].teacherAmount,0);
 const adjusted=api.payrollWithCurrentPeriods([{...row,teacherPayAdjustment:50,teacherAmount:50}],[period()])[0];assert.equal(adjusted.teacherAmount,470);assert.equal(api.payrollWithCurrentPeriods([adjusted],[period()])[0].teacherAmount,470);
});
test('invalid revised plans keep prior amount and expose a diagnostic instead of silently showing zero',()=>{
 const invalid=period();invalid.lessonCount=0;const output=api.payrollWithCurrentPeriods([{...row,teacherAmount:420}],[invalid])[0];assert.equal(output.teacherAmount,420);assert.ok(output.payrollPeriodError);
});
test('desktop and mobile payroll show student names without schedule times and retain adjustment reasons',()=>{
 for(const file of ['course-scheduler.js','operations-course-inline-runtime.js']){const text=fs.readFileSync(path.join(root,file),'utf8');const render=text.slice(text.indexOf('  function renderTeacherPayroll('),text.indexOf('  function openTeacherAdjustment('));assert.doesNotMatch(render,/row.startTime|row.endTime|row.durationMinutes/);assert.match(render,/teacherPayAdjustmentReason/);}
});
test('explicitly revised zero-tuition plans retain fixed teacher pay and single-lesson additions',()=>{
 const free=period();free.expectedAmount=free.planSnapshot.amount=0;free.planSnapshot.splitType='fixed';free.planSnapshot.splitValue=420;
 assert.equal(api.payrollWithCurrentPeriods([row],[free])[0].teacherAmount,420);
 free.planSnapshot.splitType='none';free.planSnapshot.splitValue=0;
 assert.equal(api.payrollWithCurrentPeriods([{...row,teacherPayAdjustment:420}],[free])[0].teacherAmount,420);
});
