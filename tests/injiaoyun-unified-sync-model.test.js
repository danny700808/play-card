'use strict';

const assert = require('assert');
const {
  mergeEducationDailyReceipts,
  mergeEducationDailyRentals
} = require('../functions/injiaoyunEducationPreview');
const {
  reconcileAuditedAttendance
} = require('../functions/injiaoyunEducationMirror');

const periods = [{
  id: 'period_old',
  sourcePaymentId: 'old',
  studentId: 'student_1',
  subjectId: 'drums',
  subjectName: '爵士鼓',
  teacherId: 'teacher_1',
  planId: 'plan_1',
  periodNo: 1,
  startDate: '2026-07-01',
  lessonCount: 4,
  usedCount: 4,
  expectedAmount: 2800,
  discount: 0,
  transactions: [{ id: 'old_payment', type: 'payment', amount: 2800 }],
  lessonAdjustments: [],
  planSnapshot: { name: '爵士鼓四堂', leaveNoDeduct: true }
}];

const receiptResult = mergeEducationDailyReceipts(periods, [{
  _id: '2026-07-25',
  tuitionReceipts: [{
    sourceId: 'new_period_payment',
    paidAt: '2026-07-25T12:00:00+08:00',
    studentId: 'student_1',
    subject: '爵士鼓',
    amount: 2800,
    paymentMethod: '現金',
    isRevenue: true
  }]
}]);

assert.strictEqual(receiptResult.createdPeriods, 1, '最新實收應自動續接下一期');
assert.strictEqual(periods.length, 2);
assert.strictEqual(periods[1].periodNo, 2);
assert.strictEqual(periods[1].transactions[0].amount, 2800);

const rentalRows = [];
const rentalResult = mergeEducationDailyRentals(rentalRows, [{
  _id: '2026-07-25',
  roomRentals: [{
    sourceId: 'rental_1',
    startAt: '2026-07-25T13:00:00+08:00',
    endAt: '2026-07-25T15:00:00+08:00',
    roomName: '展演空間',
    clientName: '王小姐',
    amount: 400
  }]
}], { rows: [{ id: 'room_1', name: '展演空間' }] });

assert.deepStrictEqual(rentalResult, { total: 1, linked: 1, unmatched: 0 });
assert.strictEqual(rentalRows[0].duration, 120);
assert.strictEqual(rentalRows[0].roomId, 'room_1');

const dates = ['2026-07-25', '2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29'];
const reconciled = reconcileAuditedAttendance([], dates.map((date, index) => ({
  id: `attendance_${index + 1}`,
  sourcePaymentId: 'new_period_payment',
  sourceCourseId: `course_${index + 1}`,
  studentId: 'student_1',
  subjectId: 'drums',
  status: 'attended',
  date,
  lessonNo: index + 1
})), periods, dates);

assert.strictEqual(reconciled.filter((row) => row.deducted).length, 4, '一期最多只能扣四堂');
assert.strictEqual(reconciled[4].reconciliationStatus, 'over-period-limit-review');

console.log('injiaoyun unified sync model tests passed');
