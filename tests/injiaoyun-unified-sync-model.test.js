'use strict';

const assert = require('assert');
const {
  mergeEducationDailyReceipts,
  mergeEducationDailyRentals
} = require('../functions/injiaoyunEducationPreview');
const {
  reconcileAuditedAttendance,
  refreshTuitionUsage
} = require('../functions/injiaoyunEducationMirror');
const {
  validStudioId
} = require('../functions/injiaoyunManualSync');

assert.strictEqual(
  validStudioId('6312daadfb859900b029d6a3'),
  '6312daadfb859900b029d6a3',
  '既有音教雲機構編號應可安全沿用'
);
assert.strictEqual(validStudioId('not-a-studio-id'), '', '不合法的機構編號不可傳給雲端工作');

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

refreshTuitionUsage(periods, reconciled);
assert.strictEqual(periods[1].usedCount, 4, '近期差異套用後應重新計算期別已用堂數');
assert.strictEqual(periods[1].status, 'completed', '四堂都已扣除的期別應結束');

const recentPeriod = [{
  id: 'period_recent',
  sourcePaymentId: 'recent_payment',
  studentId: 'student_recent',
  subjectId: 'piano',
  lessonCount: 4,
  usedCount: 4,
  expectedAmount: 3200,
  transactions: [{ id: 'recent_payment', type: 'payment', amount: 3200 }],
  planSnapshot: { leaveNoDeduct: true }
}];
const priorRecentRows = [{
  id: 'old_recent_attendance',
  periodId: 'period_recent',
  sourcePaymentId: 'recent_payment',
  studentId: 'student_recent',
  subjectId: 'piano',
  date: '2026-07-28',
  status: 'attended',
  deducted: true
}];
const baselineUsage = new Map([['period_recent', 3]]);
refreshTuitionUsage(recentPeriod, [], baselineUsage);
const replacedRecentRows = reconcileAuditedAttendance(priorRecentRows, [{
  id: 'new_recent_attendance',
  sourcePaymentId: 'recent_payment',
  studentId: 'student_recent',
  subjectId: 'piano',
  date: '2026-07-28',
  status: 'attended'
}], recentPeriod, ['2026-07-28'], { initialUsedByPeriod: baselineUsage });
refreshTuitionUsage(recentPeriod, replacedRecentRows, baselineUsage);
assert.strictEqual(replacedRecentRows.length, 1, '近期同步應只產生指定日期範圍的簽到');
assert.strictEqual(replacedRecentRows[0].deducted, true, '替換近期簽到時不可重複占用堂數');
assert.strictEqual(recentPeriod[0].usedCount, 4, '近期差異應接續範圍外既有堂數');

console.log('injiaoyun unified sync model tests passed');
