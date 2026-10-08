'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {schedule,withSchedule,shiftMonth,batchRows,taipeiTimestamp}=require('../functions/payrollSchedule');
const {enrichLateAttendanceFees}=require('../functions/payrollAdjustmentDetails');
const view=require('../payroll-payout-view');
const {fakeDb}=require('./payroll-test-db.cjs');
test('Taipei 9th 23:59:59 qualifies; 10th midnight goes to next month, even UTC previous day',()=>{
 const r={date:'2026-09-28',source:'teacher-late-attendance'};
 assert.equal(schedule({...r,createdAt:'2026-10-09T15:59:59.999Z'}).expectedPayDate,'2026-10-10');
 assert.equal(schedule({...r,createdAt:'2026-10-09T16:00:00.000Z'}).expectedPayDate,'2026-11-10');
 assert.equal(schedule({...r,createdAtText:'2026/10/03 12:00'}).expectedPayDate,'2026-10-10');
 assert.equal(schedule({...r,createdAtText:'2026/12/10 00:00'}).expectedPayDate,'2027-01-10');
 assert.equal(shiftMonth('2026-12',1),'2027-01');
 assert.equal(schedule({...r,createdAtText:'2026/09/10 00:00'}).expectedPayDate,'2026-10-10');
 assert.equal(schedule(r).payoutNeedsReview,true);
 assert.equal(taipeiTimestamp({_seconds:Date.parse('2026-10-09T16:00:00Z')/1000}),'2026-10-10 00:00:00');
});
test('fee identifies student and follows original lesson cutoff, without mutating original fee date',async()=>{
 const db=fakeDb({'coursePortalTeacherAttendancePayroll/p':{teacherId:'t',studentName:'學生甲',date:'2026-09-28',createdAt:'2026-10-09T16:00:00Z'}});
 const [fee]=await enrichLateAttendanceFees(db,[{id:'attendance-fee-p',teacherId:'t',type:'late_attendance_fee',date:'2026-10-10',amount:-50}]);
 assert.match(fee.note,/學生甲.*2026-09-28/);assert.equal(withSchedule(fee).expectedPayDate,'2026-11-10');assert.equal(fee.date,'2026-10-10');
 const [other]=await enrichLateAttendanceFees(db,[{id:'attendance-fee-p',teacherId:'different',type:'late_attendance_fee'}]);assert(!other.studentName);assert(other.payoutNeedsReview);
});
test('cancelled, superseded and unknown timestamps never enter transfer totals',()=>{
 const rows=[{id:'a',date:'2026-09-01'},{id:'b',date:'2026-09-01',active:false},{id:'c',date:'2026-09-01',status:'superseded'},{id:'d',date:'2026-09-01',source:'teacher-late-attendance'}].map(withSchedule);
 assert.deepEqual(batchRows(rows,'2026-09').map(r=>r.id),['a']);
});
test('monthly backend includes older supplements, excludes deferred lessons, links fees exactly once',async()=>{
 const r=(id,date,createdAt)=>({id,teacherId:'t',date,createdAt,source:'teacher-late-attendance',teacherAmount:420});
 const early=r('early','2026-09-28','2026-10-09T15:59:59Z'),late=r('late','2026-09-29','2026-10-09T16:00:00Z'),older=r('older','2026-08-28','2026-09-15T03:00:00Z');
 const db=fakeDb(Object.fromEntries([early,late,older].map(r=>['coursePortalTeacherAttendancePayroll/'+r.id,r]).concat([
 ['coursePortalTeacherAdjustments/attendance-fee-early',{id:'attendance-fee-early',teacherId:'t',type:'late_attendance_fee',date:'2026-10-09',amount:-50}],
 ['coursePortalTeacherAdjustments/attendance-fee-older',{id:'attendance-fee-older',teacherId:'t',type:'late_attendance_fee',date:'2026-09-15',amount:-50}],
 ['coursePortalTeacherAdjustments/attendance-fee-late',{id:'attendance-fee-late',teacherId:'t',type:'late_attendance_fee',date:'2026-10-10',amount:-50}]
 ])));
 const source=fs.readFileSync(require.resolve('../functions/coursePortal'),'utf8');
 const code=source.slice(source.indexOf('async function teacherPayrollMonthData('),source.indexOf('\nfunction applyPortalAttendanceToPeriods'));
 const context={db,withSchedule,batchRows,shiftMonth,enrichLateAttendanceFees,ATTENDANCE_PAYROLL:'coursePortalTeacherAttendancePayroll',ATTENDANCE_CANCELLATIONS:'cancellations',clean:v=>String(v||''),jsonValue:v=>v,sourceId:r=>r.id,eventDate:r=>r.date,teacherPayrollMonthBounds:m=>({month:m,startDate:m+'-01',endDate:m+'-31'}),mirrorRowsByDateRange:async()=>[],portalRowsByDateRange:async(c,start,end)=>{const s=await db.collection(c).get();return s.docs.map(d=>d.data()).filter(r=>r.date>=start&&r.date<=end);},enrichTeacherPayrollRows:r=>r,mergeTeacherPayrollRows:(a,b)=>a.concat(b),mergeTeacherAdjustmentRows:(a,b)=>a.concat(b),refreshPayrollPeriodLinks:async r=>r};
 vm.createContext(context);vm.runInContext(code+'\nthis.run=teacherPayrollMonthData;',context);
 const sep=await context.run('2026-09','t');
 assert.deepEqual(Array.from(sep.teacherPayroll,r=>r.id),['early','late']);
 assert.deepEqual(Array.from(sep.teacherPayoutPayroll,r=>r.id),['early','older']);
 assert.deepEqual(Array.from(sep.teacherPayoutAdjustments,r=>r.id).sort(),['attendance-fee-early','attendance-fee-older']);
 const oct=await context.run('2026-10','t');assert.deepEqual(Array.from(oct.teacherPayoutPayroll,r=>r.id),['late']);assert.equal(oct.teacherPayoutAdjustments.length,1);
});
test('teacher payout display escapes personal text and distinguishes expected from confirmed transfer',()=>{
 const batch={payout:{expectedPayDate:'2026-10-10',cutoffAt:'2026-10-10 00:00'},teacherPayoutPayroll:[{teacherId:'t',studentName:'<img onerror=x>',date:'2026-09-28',teacherAmount:420}],teacherPayoutAdjustments:[{teacherId:'t',type:'late_attendance_fee',amount:-50,note:'費用'}]};
 const html=view.render(batch,'t');assert.match(html,/NT\$370/);assert.match(html,/尚未確認匯款/);assert(!html.includes('<img'));assert.match(html,/&lt;img/);
 batch.paidBatches=[{teacherId:'t',transferDate:'2026-10-10',amount:370}];assert.match(view.render(batch,'t'),/已確認匯款：2026-10-10/);
});
module.exports={fakeDb};
