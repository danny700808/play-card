'use strict';

const assert = require('assert');
const {
  mergeEducationDailyReceipts,
  mergeEducationDailyRentals
} = require('../functions/injiaoyunEducationPreview');
const {
  activeSyncOwnerMatches,
  applyOwnedSyncFinalization,
  auditCoversRange,
  auditIsRecent,
  convergenceOwnerForState,
  fullConvergenceIsRequired,
  reconcileAuditedAttendance,
  refreshTuitionUsage,
  syncReservationDirective,
  syncOwnerMatches
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
assert.strictEqual(auditCoversRange({
  runId: 'audit_1',
  startDate: '2026-07-22',
  endDate: '2026-07-28'
}, '2026-07-25', '2026-07-28'), true, '成功核對結果應可涵蓋近期補資料範圍');
assert.strictEqual(auditCoversRange({
  runId: 'audit_2',
  startDate: '2026-07-25',
  endDate: '2026-07-27'
}, '2026-07-25', '2026-07-28'), false, '未涵蓋結束日期的核對結果不可沿用');
assert.strictEqual(auditIsRecent({
  completedAt: { toMillis: () => Date.now() - (5 * 60 * 1000) }
}), true, '30 分鐘內完成的核對結果應可沿用');
assert.strictEqual(auditIsRecent({
  completedAt: { toMillis: () => Date.now() - (31 * 60 * 1000) }
}), false, '超過 30 分鐘的核對結果不可直接沿用');

function attemptSyncFinalization(status, requestedOwner, settingsOwner, scheduleOwner, overrides = {}) {
  const sourceVersion = 'source-v1';
  const syncScope = overrides.syncScope || 'full';
  const writes = [];
  const transaction = {
    set(ref, data, options) {
      writes.push({ path: ref.path, data, options });
    }
  };
  const applied = applyOwnedSyncFinalization(
    transaction,
    Object.assign({
      syncOwner: settingsOwner,
      syncScope,
      status: 'running',
      pendingSourceVersion: sourceVersion
    }, overrides.settings || {}),
    Object.assign({
      syncOwner: scheduleOwner,
      syncScope,
      syncing: true,
      pendingSourceVersion: sourceVersion,
      version: 41
    }, overrides.schedule || {}),
    requestedOwner,
    sourceVersion,
    syncScope,
    'owner-race-test',
    status,
    { status }
  );
  return { applied, writes };
}

assert.strictEqual(
  syncOwnerMatches({ syncOwner: 'owner-b' }, { syncOwner: 'owner-b' }, 'owner-a'),
  false,
  '舊 owner 不可通過同步終態檢查'
);
['success', 'error'].forEach((status) => {
  const stale = attemptSyncFinalization(status, 'owner-a', 'owner-b', 'owner-b');
  assert.strictEqual(stale.applied, false, `舊 owner 的 ${status} finalize 必須 no-op`);
  assert.deepStrictEqual(stale.writes, [], `舊 owner 的 ${status} finalize 不可覆寫新同步狀態或封鎖`);
});
const ownedSuccess = attemptSyncFinalization('success', 'owner-b', 'owner-b', 'owner-b');
assert.strictEqual(ownedSuccess.applied, true, '目前 owner 應可完成同步');
assert.strictEqual(ownedSuccess.writes.length, 2, '同步終態與 schedule 解鎖必須在同一交易一起寫入');
assert.strictEqual(ownedSuccess.writes[0].data.status, 'success');
assert.strictEqual(ownedSuccess.writes[0].data.syncOwner, '');
assert.strictEqual(ownedSuccess.writes[0].data.lastFinalizedOwner, 'owner-b');
assert.strictEqual(ownedSuccess.writes[1].data.syncOwner, '');
assert.strictEqual(ownedSuccess.writes[1].data.lastFinalizedOwner, 'owner-b');
assert.strictEqual(ownedSuccess.writes[1].data.writesBlocked, false);
assert.strictEqual(ownedSuccess.writes[1].data.version, 42);
const alreadyFinalized = attemptSyncFinalization(
  'error',
  'owner-b',
  '',
  '',
  {
    settings: { status: 'success', pendingSourceVersion: '', lastFinalizedOwner: 'owner-b' },
    schedule: { syncing: false, pendingSourceVersion: '', lastFinalizedOwner: 'owner-b' }
  }
);
assert.strictEqual(alreadyFinalized.applied, false, '成功後的第二次 error finalize 必須 no-op');
assert.deepStrictEqual(alreadyFinalized.writes, [], '成功終態不可被後續 catch 改寫成 error');
assert.strictEqual(
  activeSyncOwnerMatches(
    { syncOwner: 'owner-b', syncScope: 'full', status: 'running', pendingSourceVersion: 'source-old' },
    { syncOwner: 'owner-b', syncScope: 'full', syncing: true, pendingSourceVersion: 'source-old' },
    'owner-b',
    'source-new',
    'full'
  ),
  false,
  'owner 相同但 pending source 不同時仍不可寫入'
);
assert.strictEqual(
  activeSyncOwnerMatches(
    { syncOwner: 'owner-b', syncScope: 'full', status: 'success', pendingSourceVersion: 'source-v1' },
    { syncOwner: 'owner-b', syncScope: 'full', syncing: true, pendingSourceVersion: 'source-v1' },
    'owner-b',
    'source-v1',
    'full'
  ),
  false,
  '已完成的 SETTINGS 不可再次 finalize'
);
assert.strictEqual(
  activeSyncOwnerMatches(
    { syncOwner: 'owner-b', syncScope: 'full', status: 'running', pendingSourceVersion: 'source-v1' },
    { syncOwner: 'owner-b', syncScope: 'full', syncing: false, pendingSourceVersion: 'source-v1' },
    'owner-b',
    'source-v1',
    'full'
  ),
  false,
  'schedule 已非 syncing 時不可 finalize'
);
assert.deepStrictEqual(
  convergenceOwnerForState(
    { syncOwner: 'owner-c', syncScope: 'full', status: 'running', pendingSourceVersion: 'source-c' },
    { syncOwner: 'owner-c', syncScope: 'full', syncing: true, pendingSourceVersion: 'source-c' }
  ),
  { owner: 'owner-c', sourceVersion: 'source-c', active: true },
  'queued child 失敗後應能把 queue 改綁目前 active owner'
);
assert.deepStrictEqual(
  convergenceOwnerForState(
    {
      syncOwner: '',
      status: 'success',
      sourceVersion: 'source-b',
      lastFinalizedOwner: 'owner-b',
      lastFinalizedSourceVersion: 'source-b'
    },
    {
      syncOwner: '',
      syncing: false,
      lastFinalizedOwner: 'owner-b',
      lastFinalizedSourceVersion: 'source-b'
    }
  ),
  { owner: 'owner-b', sourceVersion: 'source-b', active: false },
  'queued child 在 reserve 前失敗時應恢復到最後完成 owner'
);
assert.strictEqual(
  convergenceOwnerForState(
    { status: 'success', lastFinalizedOwner: 'owner-a', lastFinalizedSourceVersion: 'source-a' },
    { syncing: false, lastFinalizedOwner: 'owner-b', lastFinalizedSourceVersion: 'source-b' }
  ),
  null,
  'SETTINGS 與 schedule 終態不一致時不可重新排 queue'
);
const expiredPartialFull = {
  status: 'running',
  sourceVersion: 'source-v1',
  fullConvergenceRequired: true,
  lockUntil: { toMillis: () => 100 }
};
const partialFullSchedule = { fullConvergenceRequired: true };
assert.strictEqual(
  fullConvergenceIsRequired(expiredPartialFull, partialFullSchedule),
  true,
  'full 一開始即須留下強制完整收斂旗標'
);
assert.strictEqual(
  syncReservationDirective(
    expiredPartialFull,
    partialFullSchedule,
    'source-v1',
    'recent',
    200
  ),
  'full-required',
  '過期 partial full 後不可讓 recent 接手'
);
assert.strictEqual(
  syncReservationDirective(
    { status: 'success', sourceVersion: 'source-v1', fullConvergenceRequired: true },
    { fullConvergenceRequired: true },
    'source-v1',
    'full',
    200
  ),
  'accept',
  '同 sourceVersion 仍有 full-required 時必須真正重跑 full'
);
assert.strictEqual(
  syncReservationDirective(
    { status: 'success', sourceVersion: 'source-v1', fullConvergenceRequired: false },
    { fullConvergenceRequired: false },
    'source-v1',
    'full',
    200
  ),
  'current',
  '完整成功且沒有 full-required 時才可沿用 current'
);
const fullSuccess = attemptSyncFinalization(
  'success',
  'owner-full',
  'owner-full',
  'owner-full',
  {
    syncScope: 'full',
    settings: { fullConvergenceRequired: true },
    schedule: { fullConvergenceRequired: true }
  }
);
assert.strictEqual(fullSuccess.applied, true, 'full success 應可 finalize');
assert.strictEqual(fullSuccess.writes[0].data.fullConvergenceRequired, false);
assert.strictEqual(fullSuccess.writes[1].data.fullConvergenceRequired, false);
const fullError = attemptSyncFinalization(
  'error',
  'owner-full',
  'owner-full',
  'owner-full',
  {
    syncScope: 'full',
    settings: { fullConvergenceRequired: true },
    schedule: { fullConvergenceRequired: true }
  }
);
assert.strictEqual(fullError.applied, true, 'full error 應記錄終態但保持強制收斂');
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(fullError.writes[0].data, 'fullConvergenceRequired'),
  false,
  'full error 不得清除 fullConvergenceRequired'
);
const recentBlocked = attemptSyncFinalization(
  'success',
  'owner-recent',
  'owner-recent',
  'owner-recent',
  {
    syncScope: 'recent',
    settings: { fullConvergenceRequired: true },
    schedule: { fullConvergenceRequired: true }
  }
);
assert.strictEqual(recentBlocked.applied, false, 'full-required 期間 recent 不可解除寫入封鎖');
assert.deepStrictEqual(recentBlocked.writes, [], '被拒的 recent finalize 不可寫入任何終態');
const recentSuccess = attemptSyncFinalization(
  'success',
  'owner-recent',
  'owner-recent',
  'owner-recent',
  { syncScope: 'recent' }
);
assert.strictEqual(recentSuccess.applied, true);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(recentSuccess.writes[0].data, 'fullConvergenceRequired'),
  false,
  'recent success 不得清除 fullConvergenceRequired'
);

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
