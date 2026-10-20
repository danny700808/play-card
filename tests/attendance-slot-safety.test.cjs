const {test} = require('node:test');
const assert = require('node:assert/strict');
const {slotHasAttendance} = require('../functions/attendanceSlotSafety');
const check = (rows, slotNo, usedCount=1) => slotHasAttendance({
  periodId:'p',slotNo,usedCount,rows,
  allocations:r=>r.periodAllocations || [{periodId:r.periodId,lessonUnits:r.units || 1}],
  units:r=>r.units || 1,status:s=>s
});
test('leave at slot 1 does not block void; attended slot 2 stays protected',()=>{
 const rows=[{periodId:'p',lessonNo:1,status:'leave',deducted:false},{periodId:'p',lessonNo:2,status:'attended'}];
 assert.equal(check(rows,1),false);assert.equal(check(rows,2),true);
});
test('half lesson protects its actual slot',()=>{
 assert.equal(check([{periodId:'p',slotNo:2,status:'attended',units:0.5}],2,0.5),true);
});
test('missing or incomplete slot evidence retains conservative protection',()=>{
 assert.equal(check([],1),true);
 assert.equal(check([{periodId:'p',status:'attended'}],1),true);
 assert.equal(check([{periodId:'p',slotNo:2,status:'attended',units:0.5}],1),true);
});
test('other period, cancelled and non-deducted records cannot occupy a slot',()=>{
 assert.equal(check([{periodId:'q',slotNo:1,status:'attended'},{periodId:'p',slotNo:1,status:'cancelled'},{periodId:'p',slotNo:1,status:'attended',deducted:false}],1,0),false);
});
test('absence that deducts tuition remains protected',()=>{
 assert.equal(check([{periodId:'p',slotNo:2,status:'absent'}],2),true);
});
