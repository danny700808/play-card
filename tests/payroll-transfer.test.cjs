'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');const transfer=require('../payroll-transfer');const ExcelJS=require('../vendor/exceljs-4.4.0.min.js');
test('teachers without bank accounts remain payable separately and never block bank export',()=>{
 const rows=transfer.buildRows([{id:'a',name:'Bank teacher',amount:420},{id:'b',name:'Other teacher',amount:1260},{id:'c',name:'Zero teacher',amount:0}],{manager:{name:'Manager',account:'001'},accounts:[{teacherId:'a',account:'002'}],draft:{managerAmount:12000}});
 assert.equal(rows[2].included,false);
 assert.deepEqual(transfer.otherPaymentRows(rows).map(r=>[r.teacherId,r.amount]),[['b',1260]]);
 assert.equal(transfer.bankRows(rows).reduce((s,r)=>s+r.amount,0),12420);
 assert.equal(rows.filter(r=>r.kind==='teacher').reduce((s,r)=>s+r.amount,0),1680);
 assert.deepEqual(transfer.validate(rows),[]);
 assert.match(transfer.summaryText(rows,'2026-09'),/另行付款：1 位／\$1,260/);
});
test('export defensively excludes missing teacher accounts even with stale selection',async()=>{
 const rows=[{kind:'manager',name:'Manager',account:'001',amount:12000,included:true},{kind:'teacher',teacherName:'Other teacher',name:'Other teacher',account:' ',amount:1260,included:true},{kind:'teacher',name:'Bank teacher',account:'002',amount:420,included:true}];
 assert.deepEqual(transfer.validate(rows),[]);
 const bytes=await transfer.createWorkbook(ExcelJS,rows,'2026-09','2026-10-08').xlsx.writeBuffer();
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);const sheet=wb.worksheets[0];
 assert.equal(wb.worksheets.length,1);assert.equal(sheet.getCell('C5').value,'Bank teacher');assert.equal(sheet.getCell('G6').result,12420);
 assert(!sheet.getSheetValues().flat(2).includes('Other teacher'));
});
test('a subsequently supplied official account moves the teacher back into bank payment',()=>{
 const rows=transfer.buildRows([{id:'t',name:'Teacher',amount:1260}],{profiles:[{teacherId:'t',official:{name:'Teacher',account:'0000123'}}]});
 assert.equal(rows[1].included,true);assert.equal(transfer.otherPaymentRows(rows).length,0);assert.equal(transfer.bankRows(rows)[1].amount,1260);
});
test('malformed nonempty accounts and account conflicts still require correction',()=>{
 const row={kind:'teacher',name:'Teacher',account:'not-a-number',amount:420,included:true};assert(transfer.validate([row]).length);
 assert(transfer.validate([{kind:'manager',name:'Manager',account:'',amount:100,included:true}]).length);
});
test('payroll includes manual bonus and deductions only in selected month',()=>{const rows=transfer.totals([{id:'t',name:'Test'}],[{teacherId:'t',date:'2026-09-13',teacherAmount:420},{teacherId:'t',date:'2026-08-13',teacherAmount:999}],[{teacherId:'t',date:'2026-09-01',type:'bonus',amount:100},{teacherId:'t',date:'2026-09-02',type:'late_attendance_fee',amount:20}],'2026-09');assert.equal(rows[0].amount,500);});
test('manager fixed first and teacher totals independent of name search or template amounts',()=>{const rows=transfer.buildRows([{id:'t',name:'Test',amount:420}],{accounts:[{teacherId:'t',name:'Test',account:'00123456789',amount:999}],draft:{managerAmount:50}});assert.equal(rows[0].kind,'manager');assert.equal(rows[1].amount,420);assert.equal(rows[1].account,'00123456789');});
test('bank mismatch blocks export until exact current profile is acknowledged',()=>{const row={kind:'teacher',name:'Test',account:'00123',amount:420,included:true,profile:{official:{name:'Test',account:'00999'}}};assert(transfer.validate([row]).length);row.confirmedAgainst='Test|00999|||';assert.equal(transfer.validate([row]).length,0);row.profile.official.account='00888';assert(transfer.validate([row]).length);row.included=false;assert.equal(transfer.validate([row]).length,0);});
test('xlsx round trip keeps account as text, native borders, sums, date and printable page',async()=>{const rows=[{kind:'manager',name:'Manager',account:'0000123456789',amount:50,included:true},{kind:'teacher',name:'Teacher',account:'0012345678901',amount:420,included:true},{kind:'teacher',name:'Skipped',account:'',amount:0,included:false}];const wb=transfer.createWorkbook(ExcelJS,rows,'2026-09','2026-09-20');const bytes=await wb.xlsx.writeBuffer();fs.writeFileSync('../transfer-layout-test.xlsx',Buffer.from(bytes));const check=new ExcelJS.Workbook();await check.xlsx.load(bytes);const s=check.worksheets[0];assert.equal(check.worksheets.length,1);assert.equal(s.getCell('D4').value,'0000123456789');assert.equal(s.getCell('G6').result,470);assert.equal(s.getCell('G6').formula,'SUM(G4:G5)');assert.equal(s.getCell('E2').value,'日期：115年9月20日');assert.equal(s.getCell('E2').alignment.horizontal,'left');assert.equal(s.getCell('D2').master.address,'B2');assert.equal(s.getCell('G4').numFmt,'0');assert.equal(s.getCell('G6').numFmt,'0');assert.equal(s.getCell('D4').border.top.style,'medium');assert.equal(s.pageSetup.printArea,'B2:H8');assert.equal(s.pageSetup.fitToWidth,1);assert(s.getCell('C4').note);});

test('new months start with the corrected 120000 manager amount',()=>{assert.equal(transfer.buildRows([],{})[0].amount,120000);});
