'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const fixture=fs.readFileSync(path.join(__dirname,'course-portal.test.js'),'utf8');
const backend=fs.readFileSync(path.join(root,'functions/coursePortal.js'),'utf8')+'\nmodule.exports.freePlan={attendancePeriodPayroll,attendancePayrollCalculation};';
const context={root,backend,Module,require,module,path};vm.createContext(context);
vm.runInContext(fixture.slice(fixture.indexOf('function backendFixtureDocument('),fixture.indexOf('function mirrorFixture(')),context);
const api=context.loadBackendForScheduleTests({collections:{}}).freePlan;
const free=()=>({id:'free-period',studentId:'student',lessonCount:2,usedCount:0,voidedLessonCount:1,expectedAmount:0,discount:0,planSnapshot:{name:'免費課程',amount:0,lessonCount:2,splitType:'none',splitValue:0,splitSource:'manager'}});
test('explicit free none+0 plan signs in with the existing zero tuition and teacher pay',()=>{
  const p=free(),before=JSON.stringify(p);
  const result=api.attendancePeriodPayroll('student',p);
  assert.equal(result.outputs.teacherAmount,0);assert.equal(result.outputs.lessonPrice,0);
  assert.equal(result.outputs.splitType,'none');assert.equal(result.inputs.lessonCount,2);
  const payroll=api.attendancePayrollCalculation({studentIds:['student'],teacherId:'teacher'},[{studentId:'student',period:p,lessonUnits:1}],'2026-10-21');
  assert.equal(payroll.teacherAmount,0);assert.equal(JSON.stringify(p),before);
});
test('missing or invalid financial inputs are still blocked for no-pay plans',()=>{
  for(const count of [0,-1,undefined]){const p=free();p.lessonCount=count;assert.throws(()=>api.attendancePeriodPayroll('student',p));}
  const p=free();delete p.expectedAmount;delete p.planSnapshot.amount;assert.throws(()=>api.attendancePeriodPayroll('student',p));
  p.planSnapshot.amount=-1;assert.throws(()=>api.attendancePeriodPayroll('student',p));
});
test('zero tuition does not silently authorize missing or percentage teacher pay',()=>{
  for(const plan of [{splitType:'none'},{splitType:'none',splitValue:1},{splitType:'ratio',splitValue:.7},{splitType:''}]){
    const p=free();p.planSnapshot={amount:0,...plan};assert.throws(()=>api.attendancePeriodPayroll('student',p));
  }
});
test('paid percentage plans retain their teacher salary',()=>{
  const p=free();p.lessonCount=4;p.expectedAmount=2800;p.planSnapshot={amount:2800,splitType:'ratio',splitValue:.7};
  const result=api.attendancePeriodPayroll('student',p);assert.equal(result.outputs.teacherAmount,490);assert.equal(result.outputs.lessonPrice,700);
});
