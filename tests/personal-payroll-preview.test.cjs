'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {database}=require('./helpers/security-fixtures.cjs');
const payroll=require('../functions/personalPayroll'),context=require('../functions/mobilePreviewContext');
test('server payroll rules stay identical to settlement rules',()=>{
 const source=fs.readFileSync('parttime-payroll-common.js','utf8').replace(/\r\n/g,'\n');
 assert(fs.readFileSync('functions/parttimePayrollRules.js','utf8').replace(/\r\n/g,'\n').includes(source));
});
test('historical payroll selects the effective configuration, isolates employee, and never deducts employer retirement',async()=>{
 const config={employeeId:'e1',effectiveDate:'2026-04-01',hourlyRate:196,laborSelfPay:100,healthSelfPay:50,selfRetirementEnabled:'是',selfRetirementAmount:20,laborRetirementEmployerAmount:600};
 const f=database({'employeeSalaryConfigs/e1':{...config,effectiveDate:'2026-11-01',hourlyRate:220,laborSelfPay:500},'employeeSalaryConfigHistory/old':config,'parttimeRecords/a':{employeeId:'e1',date:'2026-10-20',totalHours:4,hourlyRate:196,grossPay:784},'parttimeRecords/b':{employeeId:'e2',date:'2026-10-20',totalHours:9,grossPay:9000}});
 const result=await payroll.monthData(f.db,{data:{}},{employeeId:'e1',identityType:'parttime'},'2026-10');
 assert.equal(result.gross,784);assert.equal(result.deduction,170);assert.equal(result.net,614);assert.equal(result.insurance.employerRetirement,600);assert.equal(result.rate,196);
 const empty=await payroll.monthData(f.db,{data:{}},{employeeId:'e1',identityType:'parttime'},'2025-10');assert.equal(empty.hasData,false);assert.equal(empty.net,null);assert.equal(empty.configKnown,false);
});
test('unknown historical insurance remains unknown instead of borrowing a future configuration',()=>{
 assert.equal(payroll.configForMonth([],{effectiveDate:'2026-11-01'},'2026-10'),null);
 assert.equal(payroll.insuranceOf(null).labor,null);
});
test('existing 2026 configured insurance calculation matches the management screen only for its known year',()=>{
 const config={laborStatus:'在保',laborPlan:'LAB_PART_11100',healthStatus:'未保',laborRetirementSalary:6000};
 const current=payroll.insuranceOf(config,'2026-10');assert.equal(current.labor,277);assert.equal(current.health,0);assert.equal(current.employerRetirement,360);
 assert.equal(payroll.insuranceOf(config,'2024-10').labor,null);
});
test('legacy manager-deleted wage records never contribute to the monthly total',async()=>{
 const f=database({'parttimeRecords/deleted':{employeeId:'e1',date:'2026-10-01',status:'主管刪除',grossPay:9999,totalHours:8}});
 assert.equal((await payroll.monthData(f.db,{data:{}},{employeeId:'e1',identityType:'parttime'},'2026-10')).hasData,false);
});
test('preview context permits reads but blocks writes through references and snapshots, without affecting concurrent normal requests',async()=>{
 const f=database({'employees/e1':{name:'Before'}}),db=context.guard(f.db);
 await Promise.all([context.run({teacherId:'t1'},async()=>{
  const snap=await db.collection('employees').doc('e1').get();assert.equal(snap.data().name,'Before');
  assert.throws(()=>snap.ref.set({name:'Wrong'}));assert.throws(()=>db.batch().set(snap.ref,{}));assert.throws(()=>db.runTransaction(()=>{}));
  await new Promise(r=>setTimeout(r,5));assert.equal(context.current().teacherId,'t1');
 }), (async()=>{assert.equal(context.current(),undefined);await db.collection('employees').doc('e2').set({name:'Normal'});})()]);
 assert.equal(f.rows.get('employees/e1').name,'Before');assert.equal(f.rows.get('employees/e2').name,'Normal');assert.equal(context.current(),undefined);
});
