'use strict';

const assert = require('assert');
const {
  auditedCourseStudents,
  buildTeacherPayroll,
  buildTuitionPeriods,
  courseStudentNames,
  mergeEducationDailyReceipts,
  mergeEducationDailyRentals,
  resolveTuitionSplitSnapshot
} = require('../functions/injiaoyunEducationPreview');
const {
  activeSyncOwnerMatches,
  applyOwnedSyncFinalization,
  auditCoversRange,
  auditIsRecent,
  combinedPayrollSyncRange,
  convergenceOwnerForState,
  dateKeysBetween,
  educationDailyCoverage,
  fullConvergenceIsRequired,
  intersectDateRanges,
  operationsSourceVersion,
  operationsSyncAdvanced,
  operationsSyncRange,
  mergePreservedAuditAttendance,
  mergeTuitionPlanSnapshot,
  reconcileAuditedAttendance,
  refreshTuitionUsage,
  registerInjiaoyunEducationMirror,
  syncReservationDirective,
  syncOwnerMatches,
  teacherPayrollRepairPlan,
  unifiedSyncIsActive
} = require('../functions/injiaoyunEducationMirror');
const {
  validStudioId
} = require('../functions/injiaoyunManualSync');

assert.deepStrictEqual(
  courseStudentNames({ students: { id: 'legacy-student-1', name: '黃郁喬' } }),
  ['黃郁喬'],
  '老師增課只有舊資料內嵌學生時，仍須保留姓名'
);
assert.deepStrictEqual(
  courseStudentNames({ studentNames: '黃郁喬' }),
  ['黃郁喬'],
  '日表核對直接提供學生姓名時，仍須保留姓名'
);
assert.deepStrictEqual(
  auditedCourseStudents(
    { studentIds: '6a7ad7b718881f00b3a4d487', studentNames: '黃郁喬' },
    { students: { _id: '6a7ad7b718881f00b3a4d487', name: '黃郁喬' } }
  ),
  { studentIds: ['6a7ad7b718881f00b3a4d487'], studentNames: ['黃郁喬'] },
  '實際老師增課的單筆學生欄位須同時保留編號與姓名'
);

const registeredMirrorFunctions = {};
registerInjiaoyunEducationMirror(registeredMirrorFunctions);
assert.strictEqual(
  typeof registeredMirrorFunctions.applyInjiaoyunEducationMirrorOnOperationsSuccess,
  'function',
  '必須註冊 opsSettings/injiaoyunCloudSync 成功事件觸發器'
);

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

const succeededAt100 = { toMillis: () => 100 };
const succeededAt200 = { toMillis: () => 200 };
assert.strictEqual(operationsSyncAdvanced(
  { status: 'success', lastSucceededAt: succeededAt100 },
  { status: 'success', lastSucceededAt: succeededAt200 }
), true, '保持 success 但 lastSucceededAt 前進時仍須觸發鏡像');
assert.strictEqual(operationsSyncAdvanced(
  { status: 'running', lastSucceededAt: succeededAt100 },
  { status: 'success', lastSucceededAt: succeededAt200 }
), true, '工作從 running 成功且成功時間前進時須觸發鏡像');
assert.strictEqual(operationsSyncAdvanced(
  { status: 'success', lastSucceededAt: succeededAt200 },
  { status: 'success', lastSucceededAt: succeededAt200 }
), false, '同一成功結果的其他欄位更新不可重複觸發');
assert.strictEqual(operationsSyncAdvanced(
  { status: 'success', lastSucceededAt: succeededAt100 },
  { status: 'running', lastSucceededAt: succeededAt200 }
), false, '尚未成功的工作不可提前套用鏡像');

assert.deepStrictEqual(operationsSyncRange({
  lastStartDateKey: '2026-07-01',
  lastEndDateKey: '2026-07-31'
}), { startDate: '2026-07-01', endDate: '2026-07-31' });
assert.deepStrictEqual(operationsSyncRange({
  lastStartDateKey: 'invalid',
  lastEndDateKey: '2026-07-31'
}), { startDate: '2026-07-31', endDate: '2026-07-31' }, '缺少可靠起日時只同步已確認的迄日');
assert.strictEqual(operationsSyncRange({ lastStartDateKey: '2026-07-01' }), null, '缺少迄日不可猜測同步範圍');
assert.deepStrictEqual(intersectDateRanges(
  { startDate: '2026-07-01', endDate: '2026-07-31' },
  { startDate: '2026-07-25', endDate: '2026-08-01' }
), { startDate: '2026-07-25', endDate: '2026-07-31' }, '夜間同步只能套用最新 audit 已涵蓋的日期');
assert.strictEqual(intersectDateRanges(
  { startDate: '2026-08-01', endDate: '2026-08-02' },
  { startDate: '2026-07-25', endDate: '2026-07-31' }
), null, 'audit 未涵蓋的新日期不可硬套用舊核對結果');
assert.strictEqual(dateKeysBetween('2026-07-01', '2026-07-31').length, 31, '薪資修復須能安全涵蓋完整 31 天月份');
assert.strictEqual(
  operationsSourceVersion({
    lastStartDateKey: '2026-07-01',
    lastEndDateKey: '2026-07-31',
    lastSucceededAt: succeededAt200
  }),
  '2026-07-01:2026-07-31:200',
  '來源版本須同時包含起日、迄日與成功時間'
);
assert.deepStrictEqual(teacherPayrollRepairPlan({
  lastStartDateKey: '2026-07-01',
  lastEndDateKey: '2026-07-31'
}, {}), {
  version: '2026-07-current-month-v1',
  startDate: '2026-07-01',
  endDate: '2026-07-31'
}, '第一次套用新規則時只回填 2026-07 老師薪資');
assert.deepStrictEqual(teacherPayrollRepairPlan({
  lastStartDateKey: '2026-07-01',
  lastEndDateKey: '2026-07-31'
}, {
  teacherPayrollRepairVersion: '2026-07-current-month-v1',
  teacherPayrollRepairThroughDate: '2026-07-20'
}), {
  version: '2026-07-current-month-v1',
  startDate: '2026-07-21',
  endDate: '2026-07-31'
}, '中斷後只能續補尚未完成的日期，不可每晚重建整月');
assert.strictEqual(teacherPayrollRepairPlan({
  lastStartDateKey: '2026-07-01',
  lastEndDateKey: '2026-07-31'
}, {
  teacherPayrollRepairVersion: '2026-07-current-month-v1',
  teacherPayrollRepairThroughDate: '2026-07-31'
}), null, '完成版本標記後夜間同步不可再次回填整月');
assert.deepStrictEqual(combinedPayrollSyncRange(
  { startDate: '2026-07-15', endDate: '2026-08-01' },
  { startDate: '2026-07-01', endDate: '2026-07-31' }
), {
  startDate: '2026-07-01',
  endDate: '2026-08-01'
}, '順便做 7 月 repair 時必須把驗證範圍擴到整個 7 月，不能只驗 operations 較短區間');

const teacherAllotContext = {
  paymentId: 'payment_1',
  courseId: 'course_1',
  teacherId: 'teacher_1',
  chargeId: 'plan_1',
  subjectId: 'piano',
  capturedAt: '2026-07-01T10:00:00+08:00'
};
assert.deepStrictEqual(
  resolveTuitionSplitSnapshot(
    {},
    { _id: 'plan_1', allot: 80 },
    { splitType: 'ratio', splitValue: 0.6 },
    [{ _id: 'allot_1', teacher: 'teacher_1', course: 'course_1', allot: 0.7 }],
    teacherAllotContext
  ),
  { splitType: 'ratio', splitValue: 0.8, splitSource: 'payment-embedded-charge' },
  '付款內嵌 charge 的拆帳必須優先於 teacherAllot 與當前通用方案'
);
assert.deepStrictEqual(
  resolveTuitionSplitSnapshot(
    {},
    null,
    { splitType: 'ratio', splitValue: 0.6 },
    [{
      _id: 'allot_1',
      teacher: 'teacher_1',
      course: 'course_1',
      charge: 'plan_1',
      allot: 70,
      created: '2026-06-01T10:00:00+08:00'
    }],
    teacherAllotContext
  ),
  {
    splitType: 'ratio',
    splitValue: 0.7,
    splitSource: 'payment-teacher-allot',
    teacherAllotId: 'allot_1',
    score: 800,
    capturedMillis: new Date('2026-06-01T10:00:00+08:00').getTime()
  },
  '付款當時老師／課程專屬 TeacherAllot 必須實際覆蓋當前通用方案，60/70 百分比也須正規化'
);
assert.strictEqual(
  resolveTuitionSplitSnapshot(
    {},
    null,
    { splitType: 'ratio', splitValue: 0.6 },
    [{
      teacher: 'teacher_1',
      course: 'course_1',
      allot: 0.7,
      created: '2026-08-01T10:00:00+08:00'
    }],
    teacherAllotContext
  ).splitValue,
  0.6,
  '付款後才建立的非付款專屬 TeacherAllot 不得回寫舊付款薪資'
);
const integratedAllotPeriods = buildTuitionPeriods({
  studentPayments: [{
    _id: 'payment_1',
    student: 'student_1',
    charge: 'plan_1',
    created: '2026-07-01T10:00:00+08:00',
    money: 2800,
    courseNumber: 4
  }],
  studentPaymentsAll: [],
  studentPaymentsOpen: [],
  studentPaymentDetails: [],
  teacherAllots: [{
    _id: 'allot_1',
    teacher: 'teacher_1',
    course: 'course_1',
    charge: 'plan_1',
    allot: 70,
    created: '2026-06-01T10:00:00+08:00'
  }]
}, {
  add(value) {
    const id = typeof value === 'object' ? value._id : value;
    return id ? { id, name: '鋼琴' } : null;
  }
}, [{
  id: 'plan_1',
  name: '鋼琴四堂',
  subjectId: 'piano',
  amount: 2800,
  lessonCount: 4,
  splitType: 'ratio',
  splitValue: 0.6
}], [{
  id: 'course_1',
  active: true,
  teacherId: 'teacher_1',
  subjectId: 'piano',
  studentIds: ['student_1'],
  studentPaymentIds: ['payment_1']
}]);
assert.strictEqual(integratedAllotPeriods[0].teacherId, 'teacher_1', '付款應從連結課程保存當時老師');
assert.strictEqual(integratedAllotPeriods[0].planSnapshot.splitValue, 0.7, 'buildTuitionPeriods 必須真的使用 data.teacherAllots，不可只讀不套用');
assert.strictEqual(integratedAllotPeriods[0].planSnapshot.teacherAllotId, 'allot_1');

assert.strictEqual(mergeTuitionPlanSnapshot(
  { splitType: 'ratio', splitValue: 0.6, splitSource: 'current-generic-plan' },
  { splitType: 'ratio', splitValue: 0.7, splitSource: 'payment-teacher-allot' }
).splitValue, 0.7, '已保存有效歷史快照優先於當前通用方案');
assert.strictEqual(mergeTuitionPlanSnapshot(
  { splitType: 'ratio', splitValue: 0.8, splitSource: 'payment-embedded-charge' },
  { splitType: 'ratio', splitValue: 0.7, splitSource: 'historical-snapshot' }
).splitValue, 0.8, '本次讀到付款內嵌 charge 時應高於舊歷史快照');
assert.strictEqual(mergeTuitionPlanSnapshot(
  { splitType: 'ratio', splitValue: 0.6, splitSource: 'current-generic-plan' },
  { splitType: 'none', splitValue: 0, splitSource: 'unresolved' }
).splitValue, 0.6, '空值／0 不是有效歷史快照，不得永久鎖死後續正確方案');

const julyDates = dateKeysBetween('2026-07-01', '2026-07-31');
const completeJulyDaily = julyDates.map((date) => ({ _id: `daily_${date}`, dateKey: date, sessions: [] }));
assert.strictEqual(educationDailyCoverage(completeJulyDaily, julyDates).complete, true, '7 月 31 天各有日表文件才可標記修復完成');
assert.deepStrictEqual(
  educationDailyCoverage(completeJulyDaily.slice(0, -1), julyDates).missingDates,
  ['2026-07-31'],
  '缺任何一天都必須辨識為不完整，停用與完成標記會在寫入前被阻止'
);
assert.deepStrictEqual(
  educationDailyCoverage(completeJulyDaily.map((row, index) => index === 10 ? { dateKey: row.dateKey } : row), julyDates).incompleteDates,
  ['2026-07-11'],
  '日文件沒有 sessions 陣列也不可當成完整的零堂日'
);

const nowMillis = Date.parse('2026-08-01T12:00:00Z');
assert.strictEqual(unifiedSyncIsActive({
  unifiedSyncStatus: 'running',
  unifiedSyncLockUntil: { toMillis: () => nowMillis + 1000 }
}, nowMillis), true, 'TTL 尚未到期的手動同步仍可暫緩重複觸發');
assert.strictEqual(unifiedSyncIsActive({
  unifiedSyncStatus: 'running',
  unifiedSyncLockUntil: { toMillis: () => nowMillis - 1 }
}, nowMillis), false, 'running TTL 到期後必須能恢復，不可永久 return');
assert.strictEqual(unifiedSyncIsActive({ unifiedSyncStatus: 'running' }, nowMillis), false, '舊 running 若沒有時間不得永久鎖住同步');

const payrollRows = buildTeacherPayroll([{
  _id: '2026-07-05',
  dateKey: '2026-07-05',
  sessions: [{
    sourceId: 'payroll_0705_fixed',
    teacherId: 'teacher_1',
    teacherName: '王老師',
    lessonPrice: 800,
    hourlyFee: 500,
    teacherAmount: 500,
    schoolShare: 300
  }, {
    sourceId: 'payroll_0705_ratio',
    teacherId: 'teacher_2',
    lessonPrice: 1000,
    allotRate: 60,
    teacherAmount: 600,
    schoolShare: 400
  }]
}]);
assert.deepStrictEqual(payrollRows.map((row) => ({
  id: row.id,
  date: row.date,
  splitType: row.splitType,
  splitValue: row.splitValue,
  teacherAmount: row.teacherAmount,
  schoolShare: row.schoolShare
})), [{
  id: 'payroll_0705_fixed',
  date: '2026-07-05',
  splitType: 'fixed',
  splitValue: 500,
  teacherAmount: 500,
  schoolShare: 300
}, {
  id: 'payroll_0705_ratio',
  date: '2026-07-05',
  splitType: 'ratio',
  splitValue: 60,
  teacherAmount: 600,
  schoolShare: 400
}], '薪資鏡像須直接沿用每日來源已算好的老師所得與教室分成');

const payrollStudentRecoveredFromAttendance = buildTeacherPayroll([{
  _id: '2026-07-06',
  dateKey: '2026-07-06',
  sessions: [{
    sourceId: 'payroll_0706_student_fallback',
    teacherId: 'teacher_1',
    lessonPrice: 800,
    hourlyFee: 500,
    teacherAmount: 500,
    schoolShare: 300
  }]
}], [{
  id: 'payroll_0706_student_fallback',
  studentId: 'student_1'
}]);
assert.strictEqual(
  payrollStudentRecoveredFromAttendance[0].studentId,
  'student_1',
  '每日薪資缺學生欄位時，應由同 sourceId 的簽到紀錄安全補回'
);

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
assert.strictEqual(
  syncReservationDirective(
    {
      status: 'running',
      pendingSourceVersion: 'source-v1',
      syncScope: 'recent',
      lockUntil: { toMillis: () => 500 }
    },
    {},
    'source-v1',
    'recent',
    200
  ),
  'running-current',
  '同一 ops 成功事件重送時須沿用目前工作，不可排入第二次完整同步'
);
assert.strictEqual(
  syncReservationDirective(
    {
      status: 'running',
      pendingSourceVersion: 'source-old',
      syncScope: 'recent',
      lockUntil: { toMillis: () => 500 }
    },
    {},
    'source-new',
    'recent',
    200
  ),
  'running',
  '不同來源版本仍須保留既有收斂排隊保護'
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

assert.strictEqual(rentalResult.total, 1);
assert.strictEqual(rentalResult.linked, 0, '新建安全鏡像不可誤報為已和既有行程連結');
assert.strictEqual(rentalResult.mirrored, 1, '名稱可正常對應且起訖完整時才可寫入租用鏡像');
assert.strictEqual(rentalResult.unmatched, 0);
assert.strictEqual(rentalResult.incomplete, 0);
assert.strictEqual(rentalResult.created, 1);
assert.strictEqual(rentalRows[0].duration, 120);
assert.strictEqual(rentalRows[0].roomId, 'room_1');
assert.strictEqual(rentalRows[0].sourceId, 'rental_1');
assert.strictEqual(rentalRows[0].timeResolved, true);

const roomIdRentalRows = [];
const roomIdRentalResult = mergeEducationDailyRentals(roomIdRentalRows, [{
  _id: '2026-07-26',
  roomRentals: [{
    sourceId: 'rental_room_id_in_name',
    startAt: '2026-07-26T13:00:00+08:00',
    endAt: '2026-07-26T14:00:00+08:00',
    roomName: '63181389f3c4de00b1f1513d',
    amount: 250
  }]
}], { rows: [{ id: '63181389f3c4de00b1f1513d', name: '團練教室' }] });

assert.strictEqual(roomIdRentalResult.mirrored, 1, 'roomName 實際存教室 ID 時仍應精確對應');
assert.strictEqual(roomIdRentalResult.unmatched, 0);
assert.strictEqual(roomIdRentalRows[0].roomId, '63181389f3c4de00b1f1513d');
assert.strictEqual(roomIdRentalRows[0].roomName, '團練教室');

const incompleteRentalRows = [];
const incompleteRentalResult = mergeEducationDailyRentals(incompleteRentalRows, [{
  _id: '2026-07-27',
  roomRentals: [{
    sourceId: 'rental_without_end',
    startAt: '2026-07-27T07:00:00Z',
    roomName: '63181389f3c4de00b1f1513d',
    amount: 100
  }]
}], { rows: [{ id: '63181389f3c4de00b1f1513d', name: '團練教室' }] });

assert.strictEqual(incompleteRentalResult.linked, 0);
assert.strictEqual(incompleteRentalResult.unmatched, 0, '教室已對應但時段不完整，不可誤報為未配對');
assert.strictEqual(incompleteRentalResult.incomplete, 1, '缺少結束時間或時數應另外列為時段不完整');
assert.strictEqual(incompleteRentalResult.issueCounts.missingEndOrDuration, 1);
assert.strictEqual(incompleteRentalRows.length, 0, '不可用收入時間自動虛構一小時租用行程');

const auditedRentalSchedule = [{
  id: 'audit_rental_6a123_2026-07-27',
  sourceCourseId: '6a123',
  seriesId: '6a123',
  type: 'rental',
  date: '2026-07-27',
  start: '19:00',
  duration: 120,
  roomId: '63181389f3c4de00b1f1513d',
  roomName: '團練教室',
  rentalFee: 0
}];
const auditLinkedRows = [];
const auditLinkedResult = mergeEducationDailyRentals(auditLinkedRows, [{
  _id: '2026-07-27',
  roomRentals: [{
    sourceId: 'rental:6a123',
    startAt: '2026-07-27T07:00:00Z',
    roomName: '63181389f3c4de00b1f1513d',
    clientName: '林小姐',
    amount: 450
  }]
}], { rows: [{ id: '63181389f3c4de00b1f1513d', name: '團練教室' }] }, {
  scheduleRows: auditedRentalSchedule
});

assert.strictEqual(auditLinkedResult.linked, 1, '穩定來源編號應連到日表已核對的真實租用行程');
assert.strictEqual(auditLinkedResult.scheduleLinked, 1);
assert.strictEqual(auditLinkedResult.incomplete, 0, '已有真實日表行程時不受收入資料缺少結束時間影響');
assert.strictEqual(auditLinkedRows.length, 0, '連到日表事件後不可再建立重複租用鏡像');
assert.strictEqual(auditedRentalSchedule[0].start, '19:00', '收入時間不可覆蓋真實租用時間');
assert.strictEqual(auditedRentalSchedule[0].duration, 120);
assert.strictEqual(auditedRentalSchedule[0].rentalFee, 450);
assert.strictEqual(auditedRentalSchedule[0].clientName, '林小姐');

const duplicateRentalRows = [];
const duplicateRentalResult = mergeEducationDailyRentals(duplicateRentalRows, [{
  _id: '2026-07-28',
  roomRentals: [{
    sourceId: 'stable_rental_source',
    startAt: '2026-07-28T10:00:00+08:00',
    endAt: '2026-07-28T11:00:00+08:00',
    roomName: '展演空間',
    amount: 300
  }, {
    sourceId: 'rental:stable_rental_source',
    startAt: '2026-07-28T10:00:00+08:00',
    endAt: '2026-07-28T11:00:00+08:00',
    roomName: '展演空間',
    amount: 300
  }]
}], { rows: [{ id: 'room_1', name: '展演空間' }] });

assert.strictEqual(duplicateRentalResult.total, 2);
assert.strictEqual(duplicateRentalResult.mirrored, 1);
assert.strictEqual(duplicateRentalResult.duplicates, 1, '相同來源編號（含 rental 前綴差異）在同批只能寫入一次');
assert.strictEqual(duplicateRentalRows.length, 1);

const existingRentalRows = [{
  id: 'existing_rental',
  sourceId: 'existing_rental',
  date: '2026-07-29',
  start: '18:30',
  duration: 90,
  timeResolved: true,
  timeSource: 'startAt',
  durationSource: 'explicit-end-time',
  roomId: 'room_1',
  roomName: '展演空間',
  amount: 200
}];
const existingRentalResult = mergeEducationDailyRentals(existingRentalRows, [{
  _id: '2026-07-29',
  roomRentals: [{
    sourceId: 'existing_rental',
    roomName: 'room_1',
    amount: 350
  }]
}], { rows: [{ id: 'room_1', name: '展演空間' }] });

assert.strictEqual(existingRentalResult.linked, 1, '穩定來源編號可更新已驗證的既有行程');
assert.strictEqual(existingRentalResult.updated, 1);
assert.strictEqual(existingRentalResult.preservedSchedule, 1);
assert.strictEqual(existingRentalRows.length, 1, '重複同步不可新增第二筆');
assert.strictEqual(existingRentalRows[0].start, '18:30', '每日收入缺少時段時須保留既有真實時間');
assert.strictEqual(existingRentalRows[0].duration, 90);
assert.strictEqual(existingRentalRows[0].amount, 350);

const missingSourceRows = [];
const missingSourceResult = mergeEducationDailyRentals(missingSourceRows, [{
  _id: '2026-07-30',
  roomRentals: [{
    startAt: '2026-07-30T10:00:00+08:00',
    endAt: '2026-07-30T11:00:00+08:00',
    roomName: '展演空間'
  }]
}], { rows: [{ id: 'room_1', name: '展演空間' }] });

assert.strictEqual(missingSourceResult.unmatched, 1, '缺少穩定來源編號時不可用陣列位置造 ID');
assert.strictEqual(missingSourceResult.issueCounts.missingSourceId, 1);
assert.strictEqual(missingSourceRows.length, 0);

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

const preservedAttendance = mergePreservedAuditAttendance([{
  id: 'preview_current',
  date: '2026-07-31',
  studentId: 'student_1'
}], [{
  id: 'prior_audit_history',
  date: '2026-07-15',
  studentId: 'student_1',
  periodId: 'period_old',
  deducted: true
}, {
  id: 'prior_in_latest_range',
  date: '2026-07-31',
  studentId: 'student_2'
}], ['2026-07-31']);
assert.deepStrictEqual(
  preservedAttendance.map((row) => row.id).sort(),
  ['preview_current', 'prior_audit_history'],
  'full sync 必須保留最新 audit 範圍外的既有簽到，範圍內才由新 audit 完整覆蓋'
);

const previewSource = require('fs').readFileSync(require.resolve('../functions/injiaoyunEducationPreview'), 'utf8');
assert.strictEqual(
  previewSource.includes("map(dateKey).filter(Boolean))].slice(0, 30)"),
  false,
  'readEducationDaily 不可再把 31 天日期靜默截成 30 天'
);
const mirrorSource = require('fs').readFileSync(require.resolve('../functions/injiaoyunEducationMirror'), 'utf8');
assert.ok(
  mirrorSource.includes('syncOperationsTeacherPayrollRange(') &&
  mirrorSource.includes("'operations-success-trigger-teacher-payroll'"),
  'operations 成功觸發必須先獨立同步完整 operations 老師薪資範圍'
);

console.log('injiaoyun unified sync model tests passed');
