'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module'),vm=require('vm');
const root=path.resolve(__dirname,'..');let fixture=fs.readFileSync(path.join(__dirname,'course-portal.test.js'),'utf8').replace(/\r\n/g,'\n');
fixture=fixture.replace('async get() {\n      const rows', 'async get() {\n      (state.queries||(state.queries=[])).push({name:this.name,filters:this.filters});\n      const rows');
const backend=fs.readFileSync(path.join(root,'functions/coursePortal.js'),'utf8');const context={root,backend,Module,require,module,path};vm.createContext(context);vm.runInContext(fixture.slice(fixture.indexOf('function backendFixtureDocument('),fixture.indexOf('function mirrorFixture(')),context);
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const doc=(id,data)=>({id,data});const mirror=(id,source)=>doc(id,{sourceActive:true,source});
const period=(id,studentId,startDate)=>({id,studentId,startDate,lessonCount:4,usedCount:0,expectedAmount:2800,periodNo:1,subjectId:'guitar',teacherId:'teacher',planSnapshot:{name:'外聘',amount:2800,lessonCount:4,splitType:'ratio',splitValue:.6}});
test('recent students include recent lessons and new periods but omit inactive history, without global ledger/payroll reads',async()=>{
 const data={collections:{opsEducationMirrorAttendance:[mirror('a',{id:'a',studentId:'recent',periodId:'p1',date:today,status:'attended',deducted:true}),mirror('old-a',{id:'old-a',studentId:'old',date:'2020-01-01',status:'attended'})],opsEducationMirrorTuitionPeriods:[mirror('p1',period('p1','recent','2020-01-01')),mirror('p-old',period('p-old','old','2020-01-01'))],coursePortalTuitionPeriods:[doc('p2',period('p2','new',today))],opsEducationMirrorStudents:[mirror('recent',{id:'recent',name:'最近有上課'}),mirror('new',{id:'new',name:'剛新增期別'}),mirror('old',{id:'old',name:'舊學生'})]}};
 const result=await context.loadBackendForScheduleTests(data).managerRecentStudents();
 assert.deepEqual(result.students.map(x=>x.id).sort(),['new','recent']);assert.equal(result.tuitionPeriods.length,2);assert.equal(result.attendance.length,1);assert.ok(result.rangeStart<today);
 assert.ok(!data.queries.some(q=>/Payroll|Rental|Schedule/.test(q.name)));
 for(const q of data.queries.filter(q=>/Tuition|Attendance/.test(q.name)))assert.ok(q.filters.length>0,'must not scan all '+q.name);
});
test('combined followup reads only stopped students ledgers and uses current payments',async()=>{
 const stop=(id,studentId)=>doc(id,{status:'active',studentId,teacherId:'teacher',subjectId:'guitar',effectiveDate:'2026-09-01',receivablePeriodsAtStop:[{id:'p-'+studentId,outstandingAmount:2800}]});
 const data={collections:{coursePortalStudentSuspensions:[stop('s1','owing'),stop('s2','paid')],opsEducationMirrorTuitionPeriods:[mirror('p-owing',period('p-owing','owing','2026-08-01')),mirror('p-paid',period('p-paid','paid','2026-08-01')),mirror('p-unrelated',period('p-unrelated','old','2020-01-01'))],coursePortalTuitionPaymentTransactions:[doc('tx1',{studentId:'owing',periodId:'p-owing',status:'confirmed',type:'payment',amount:1000}),doc('tx2',{studentId:'paid',periodId:'p-paid',status:'confirmed',type:'payment',amount:2800})]}};
 const result=await context.loadBackendForScheduleTests(data).managerCalendarFollowup();
 assert.equal(result.followupStops.find(r=>r.studentId==='owing').currentUnpaidAmount,1800);assert.equal(result.followupStops.find(r=>r.studentId==='paid').currentUnpaidAmount,0);assert.equal(result.followupStops.length,2);
 for(const q of data.queries.filter(q=>/Tuition/.test(q.name)))assert.ok(q.filters.length>0,'must not scan all '+q.name);
});
