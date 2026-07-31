'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');
const {
  buildTeacherPayroll,
  buildPreview,
  EDUCATION_PREVIEW_VERSION,
  latestAuditRunInfo,
  latestAuditSchedule,
  latestMigrationRunId,
  mergeEducationDailyReceipts,
  mergeEducationDailyRentals,
  readEducationDaily
} = require('./injiaoyunEducationPreview');
const {
  startInjiaoyunCloudSync,
  waitForInjiaoyunCloudSync
} = require('./injiaoyunManualSync');
const { appendCoursePortalData } = require('./coursePortal');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;
const FUNCTION_REGION = 'us-central1';
const VERSION = '2026.08.01-v15-safe-payroll-convergence';
const TEACHER_PAYROLL_REPAIR_VERSION = '2026-07-current-month-v1';
const TEACHER_PAYROLL_REPAIR_START_DATE = '2026-07-01';
const TEACHER_PAYROLL_REPAIR_END_DATE = '2026-07-31';
const MANUAL_SYNC_PIN = defineSecret('INJIAOYUN_MANUAL_SYNC_PIN');
const SETTINGS_REF = db.collection('opsSettings').doc('injiaoyunEducationMirror');
const OPERATIONS_SYNC_REF = db.collection('opsSettings').doc('injiaoyunCloudSync');
const COURSE_PORTAL_SCHEDULE_VERSION_REF = db.collection('coursePortalRuntime').doc('scheduleVersion');
const AUDIT_JOB_REGION = 'asia-east1';
const AUDIT_JOB_NAME = 'injiaoyun-course-audit-0723-0724-v4';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const LOCK_MS = 12 * 60 * 1000;
const MISSING_CONFIRMATIONS = 2;
const BATCH_SIZE = 350;
const ALLOWED_ORIGINS = new Set([
  'https://danny700808.github.io',
  'https://www.mingtinghuang.com',
  'https://mingtinghuang.com'
]);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

// source 欄位由音教雲單向覆蓋；local 欄位保留給新版日後自行開發，不受同步影響。
const MIRROR_TYPES = Object.freeze({
  rooms: 'opsEducationMirrorRooms',
  subjects: 'opsEducationMirrorSubjects',
  feePlans: 'opsEducationMirrorFeePlans',
  students: 'opsEducationMirrorStudents',
  teachers: 'opsEducationMirrorTeachers',
  teacherPayroll: 'opsEducationMirrorTeacherPayroll',
  teacherAdjustments: 'opsEducationMirrorTeacherAdjustments',
  tuitionPeriods: 'opsEducationMirrorTuitionPeriods',
  attendance: 'opsEducationMirrorAttendance',
  fixedCourses: 'opsEducationMirrorFixedCourses',
  temporaryCourses: 'opsEducationMirrorTemporaryCourses',
  roomRentals: 'opsEducationMirrorRoomRentals',
  events: 'opsEducationMirrorEvents',
  leaveReasons: 'opsEducationMirrorLeaveReasons'
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function syncOwnerMatches(settings, schedule, syncOwner) {
  const owner = clean(syncOwner);
  return Boolean(
    owner &&
    clean(settings && settings.syncOwner) === owner &&
    clean(schedule && schedule.syncOwner) === owner
  );
}

function normalizedSyncScope(value) {
  return clean(value).toLowerCase() === 'recent' ? 'recent' : 'full';
}

function operationsSyncAdvanced(before, after) {
  return Boolean(
    clean(after && after.status).toLowerCase() === 'success' &&
    timestampMillis(after && after.lastSucceededAt) > timestampMillis(before && before.lastSucceededAt)
  );
}

function unifiedSyncIsActive(settings, nowMillis = Date.now()) {
  if (clean(settings && settings.unifiedSyncStatus).toLowerCase() !== 'running') return false;
  const explicitUntil = timestampMillis(settings && settings.unifiedSyncLockUntil);
  if (explicitUntil > 0) return explicitUntil > Number(nowMillis || 0);
  const startedAt = timestampMillis(settings && settings.unifiedSyncStartedAt);
  // 舊狀態若沒有時間，不能永久擋住事件；有開始時間者最多保護一個 LOCK_MS。
  return startedAt > 0 && startedAt + LOCK_MS > Number(nowMillis || 0);
}

function operationsSyncRange(settings) {
  const endDate = dateKey(settings && settings.lastEndDateKey);
  if (!endDate) return null;
  const requestedStartDate = dateKey(settings && settings.lastStartDateKey);
  return {
    startDate: requestedStartDate && requestedStartDate <= endDate ? requestedStartDate : endDate,
    endDate
  };
}

function intersectDateRanges(left, right) {
  const leftStart = dateKey(left && left.startDate);
  const leftEnd = dateKey(left && left.endDate);
  const rightStart = dateKey(right && right.startDate);
  const rightEnd = dateKey(right && right.endDate);
  if (!leftStart || !leftEnd || !rightStart || !rightEnd) return null;
  const startDate = leftStart > rightStart ? leftStart : rightStart;
  const endDate = leftEnd < rightEnd ? leftEnd : rightEnd;
  return startDate <= endDate ? { startDate, endDate } : null;
}

function combinedPayrollSyncRange(requestedRange, repair) {
  const requestedStartDate = dateKey(requestedRange && requestedRange.startDate);
  const requestedEndDate = dateKey(requestedRange && requestedRange.endDate);
  const repairStartDate = dateKey(repair && repair.startDate);
  const repairEndDate = dateKey(repair && repair.endDate);
  const startDate = requestedStartDate && repairStartDate
    ? (requestedStartDate < repairStartDate ? requestedStartDate : repairStartDate)
    : requestedStartDate || repairStartDate;
  const endDate = requestedEndDate && repairEndDate
    ? (requestedEndDate > repairEndDate ? requestedEndDate : repairEndDate)
    : requestedEndDate || repairEndDate;
  return startDate && endDate && startDate <= endDate ? { startDate, endDate } : null;
}

function teacherPayrollRepairPlan(operationsSettings, mirrorSettings) {
  const operationsRange = operationsSyncRange(operationsSettings);
  if (!operationsRange || operationsRange.endDate < TEACHER_PAYROLL_REPAIR_START_DATE) return null;
  const availableEndDate = operationsRange.endDate < TEACHER_PAYROLL_REPAIR_END_DATE
    ? operationsRange.endDate
    : TEACHER_PAYROLL_REPAIR_END_DATE;
  const sameVersion = clean(mirrorSettings && mirrorSettings.teacherPayrollRepairVersion) ===
    TEACHER_PAYROLL_REPAIR_VERSION;
  const repairedThroughDate = sameVersion
    ? dateKey(mirrorSettings && mirrorSettings.teacherPayrollRepairThroughDate)
    : '';
  if (repairedThroughDate && repairedThroughDate >= availableEndDate) return null;
  const nextDate = repairedThroughDate && repairedThroughDate >= TEACHER_PAYROLL_REPAIR_START_DATE
    ? shiftDate(repairedThroughDate, 1)
    : TEACHER_PAYROLL_REPAIR_START_DATE;
  if (!nextDate || nextDate > availableEndDate) return null;
  return {
    version: TEACHER_PAYROLL_REPAIR_VERSION,
    startDate: nextDate,
    endDate: availableEndDate
  };
}

function fullConvergenceIsRequired(settings, schedule) {
  return Boolean(
    settings && settings.fullConvergenceRequired === true ||
    schedule && schedule.fullConvergenceRequired === true
  );
}

function syncReservationDirective(current, schedule, sourceVersion, syncScope, nowMillis) {
  const scope = normalizedSyncScope(syncScope);
  const fullRequired = fullConvergenceIsRequired(current, schedule);
  if (
    !fullRequired &&
    clean(current && current.sourceVersion) === clean(sourceVersion) &&
    clean(current && current.status).toLowerCase() === 'success'
  ) return 'current';
  const lockUntil = current && current.lockUntil && typeof current.lockUntil.toMillis === 'function'
    ? current.lockUntil.toMillis()
    : 0;
  if (
    clean(current && current.status).toLowerCase() === 'running' &&
    lockUntil > Number(nowMillis || 0)
  ) {
    if (
      clean(current && current.pendingSourceVersion) === clean(sourceVersion) &&
      normalizedSyncScope(current && current.syncScope) === scope
    ) return 'running-current';
    return 'running';
  }
  if (scope === 'recent' && fullRequired) return 'full-required';
  return 'accept';
}

function activeSyncOwnerMatches(settings, schedule, syncOwner, sourceVersion, syncScope) {
  const expectedSourceVersion = clean(sourceVersion);
  const expectedScope = normalizedSyncScope(syncScope);
  return Boolean(
    syncOwnerMatches(settings, schedule, syncOwner) &&
    clean(settings && settings.status).toLowerCase() === 'running' &&
    schedule && schedule.syncing === true &&
    expectedSourceVersion &&
    clean(settings && settings.pendingSourceVersion) === expectedSourceVersion &&
    clean(schedule && schedule.pendingSourceVersion) === expectedSourceVersion &&
    clean(settings && settings.syncScope) === expectedScope &&
    clean(schedule && schedule.syncScope) === expectedScope
  );
}

function convergenceOwnerForState(settings, schedule) {
  const activeOwner = clean(settings && settings.syncOwner);
  const activeSourceVersion = clean(settings && settings.pendingSourceVersion);
  const activeScope = normalizedSyncScope(settings && settings.syncScope);
  if (activeSyncOwnerMatches(settings, schedule, activeOwner, activeSourceVersion, activeScope)) {
    return { owner: activeOwner, sourceVersion: activeSourceVersion, active: true };
  }
  if (
    clean(settings && settings.status).toLowerCase() === 'running' ||
    schedule && schedule.syncing === true
  ) return null;
  const settingsOwner = clean(settings && (settings.lastFinalizedOwner || settings.syncOwner));
  const scheduleOwner = clean(schedule && (schedule.lastFinalizedOwner || schedule.syncOwner));
  const settingsSourceVersion = clean(
    settings && (settings.lastFinalizedSourceVersion || settings.sourceVersion)
  );
  const scheduleSourceVersion = clean(
    (schedule && schedule.lastFinalizedSourceVersion) || settingsSourceVersion
  );
  if (
    !settingsOwner ||
    settingsOwner !== scheduleOwner ||
    !settingsSourceVersion ||
    settingsSourceVersion !== scheduleSourceVersion
  ) return null;
  return { owner: settingsOwner, sourceVersion: settingsSourceVersion, active: false };
}

function applyOwnedSyncFinalization(
  transaction,
  settings,
  schedule,
  syncOwner,
  sourceVersion,
  syncScope,
  trigger,
  status,
  settingsUpdates
) {
  const owner = clean(syncOwner);
  const finalizedSourceVersion = clean(sourceVersion);
  const finalizedScope = normalizedSyncScope(syncScope);
  if (
    !activeSyncOwnerMatches(
      settings,
      schedule,
      owner,
      finalizedSourceVersion,
      finalizedScope
    )
  ) return false;
  if (finalizedScope === 'recent' && fullConvergenceIsRequired(settings, schedule)) return false;
  const succeeded = clean(status).toLowerCase() === 'success';
  const finalSettings = Object.assign({}, settingsUpdates || {}, {
    syncOwner: '',
    syncScope: '',
    pendingSourceVersion: '',
    lastFinalizedOwner: owner,
    lastFinalizedSourceVersion: finalizedSourceVersion,
    lastFinalizedSyncScope: finalizedScope
  });
  const finalSchedule = {
    version: Number(schedule && schedule.version || 0) + 1,
    syncOwner: '',
    syncScope: '',
    pendingSourceVersion: '',
    lastFinalizedOwner: owner,
    lastFinalizedSourceVersion: finalizedSourceVersion,
    lastFinalizedSyncScope: finalizedScope,
    syncing: false,
    syncingUntil: Timestamp.fromMillis(0),
    writesBlocked: !succeeded,
    integrityStatus: succeeded ? 'healthy' : 'error',
    lastSyncStatus: clean(status) || (succeeded ? 'success' : 'error'),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: `injiaoyun-mirror:${clean(trigger) || 'sync'}`
  };
  // 部分 full 寫入即使失敗也可能留下混合資料；只有 full 成功才能解除強制完整收斂。
  if (succeeded && finalizedScope === 'full') {
    finalSettings.fullConvergenceRequired = false;
    finalSchedule.fullConvergenceRequired = false;
  }
  transaction.set(SETTINGS_REF, finalSettings, { merge: true });
  transaction.set(COURSE_PORTAL_SCHEDULE_VERSION_REF, finalSchedule, { merge: true });
  return true;
}

async function markCoursePortalScheduleUpdated(
  trigger,
  status = 'success',
  syncOwner,
  sourceVersion,
  syncScope,
  settingsUpdates
) {
  const owner = clean(syncOwner);
  if (!owner) return { finalized: false, reason: 'missing-owner' };
  return db.runTransaction(async (transaction) => {
    const [settingsSnapshot, scheduleSnapshot] = await Promise.all([
      transaction.get(SETTINGS_REF),
      transaction.get(COURSE_PORTAL_SCHEDULE_VERSION_REF)
    ]);
    const settings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
    const schedule = scheduleSnapshot.exists ? scheduleSnapshot.data() || {} : {};
    const finalized = applyOwnedSyncFinalization(
      transaction,
      settings,
      schedule,
      owner,
      sourceVersion,
      syncScope,
      trigger,
      status,
      settingsUpdates
    );
    return {
      finalized,
      reason: finalized ? 'finalized' : 'owner-changed'
    };
  });
}

function dateKey(value) {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})$/);
  if (!match) return '';
  const date = new Date(`${match[1]}T12:00:00+08:00`);
  if (!Number.isFinite(date.getTime())) return '';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date) === match[1] ? match[1] : '';
}

function shiftDate(key, days) {
  const date = new Date(`${dateKey(key)}T12:00:00+08:00`);
  if (!Number.isFinite(date.getTime())) return '';
  date.setDate(date.getDate() + Number(days || 0));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function dateKeysBetween(startDate, endDate, maximumDays = 62) {
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  if (!start || !end || start > end) return [];
  const dates = [];
  let cursor = start;
  while (cursor && cursor <= end && dates.length < maximumDays) {
    dates.push(cursor);
    cursor = shiftDate(cursor, 1);
  }
  if (dates[dates.length - 1] !== end) {
    throw new Error(`日期範圍超過安全上限 ${maximumDays} 天。`);
  }
  return dates;
}

function operationsSourceVersion(settings) {
  const range = operationsSyncRange(settings);
  return `${range && range.startDate || ''}:${range && range.endDate || ''}:${timestampMillis(settings && settings.lastSucceededAt)}`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function validPayrollSplitSnapshot(snapshot) {
  const row = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const type = clean(row.splitType).toLowerCase();
  const value = Number(row.splitValue);
  if (!Number.isFinite(value) || value <= 0) return false;
  if (type === 'fixed') return true;
  return type === 'ratio' && value <= 1;
}

function mergeTuitionPlanSnapshot(currentSnapshot, historicalSnapshot) {
  const current = jsonValue(currentSnapshot) || {};
  const historical = jsonValue(historicalSnapshot) || {};
  const historicalValid = validPayrollSplitSnapshot(historical);
  const currentValid = validPayrollSplitSnapshot(current);
  const currentEmbedded = currentValid && /^payment-(?:embedded|teacher-allot)/.test(clean(current.splitSource));
  const merged = Object.assign({}, current, historical);
  const chosen = currentEmbedded
    ? current
    : historicalValid ? historical : currentValid ? current : null;
  if (chosen) {
    merged.splitType = clean(chosen.splitType);
    merged.splitValue = Number(chosen.splitValue);
    merged.splitSource = clean(chosen.splitSource) || (chosen === historical ? 'historical-snapshot' : 'current-generic-plan');
    if (clean(chosen.teacherAllotId)) merged.teacherAllotId = clean(chosen.teacherAllotId);
    else delete merged.teacherAllotId;
  } else {
    // 空值或 0 不是有效歷史憑據；保留本次「尚未解析」狀態，讓後續來源補齊時仍可更新。
    merged.splitType = clean(current.splitType) || 'none';
    merged.splitValue = Number.isFinite(Number(current.splitValue)) ? Number(current.splitValue) : 0;
    merged.splitSource = clean(current.splitSource) || 'unresolved';
    delete merged.teacherAllotId;
  }
  return merged;
}

function projectId() {
  return clean(
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    (admin.app().options && admin.app().options.projectId) ||
    'youzi-c1b74'
  );
}

async function waitForOperation(authClient, operation, timeoutMs) {
  let current = operation || {};
  if (!clean(current.name)) throw new Error('舊音教雲抓取工作沒有回傳執行編號。');
  const deadline = Date.now() + timeoutMs;
  while (current && current.done !== true && Date.now() < deadline) {
    await sleep(5000);
    const response = await authClient.request({
      url: `https://run.googleapis.com/v2/${clean(current.name)}`,
      method: 'GET',
      timeout: 30000
    });
    current = response.data || {};
  }
  if (!current || current.done !== true) {
    throw new Error('舊音教雲抓取時間超過預期；工作仍可能在背景執行，請稍後再按一次同步。');
  }
  if (current.error) {
    throw new Error(clean(current.error.message || current.error.status || '舊音教雲抓取工作失敗。'));
  }
  return current;
}

async function runAuditForRange(startDate, endDate) {
  const selectedStartDate = dateKey(startDate);
  const selectedEndDate = dateKey(endDate);
  if (!selectedStartDate || !selectedEndDate || selectedStartDate > selectedEndDate) {
    throw new Error('同步日期範圍不正確。');
  }
  const auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
  const authClient = await auth.getClient();
  const jobResource = `projects/${projectId()}/locations/${AUDIT_JOB_REGION}/jobs/${AUDIT_JOB_NAME}`;
  const response = await authClient.request({
    url: `https://run.googleapis.com/v2/${jobResource}:run`,
    method: 'POST',
    timeout: 30000,
    data: {
      overrides: {
        containerOverrides: [{
          env: [
            { name: 'AUDIT_START_DATE', value: selectedStartDate },
            { name: 'AUDIT_END_DATE', value: selectedEndDate }
          ]
        }]
      }
    }
  });
  // 保留時間給 Firestore 新結果與鏡像同步；Callable 上限為 540 秒。
  await waitForOperation(authClient, response.data, 360000);
  return { startDate: selectedStartDate, endDate: selectedEndDate };
}

async function waitForFreshAudit(previousRunId, startDate, endDate, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await latestAuditRunInfo();
    if (
      info.runId &&
      info.runId !== previousRunId &&
      info.startDate <= startDate &&
      info.endDate >= endDate
    ) return info;
    await sleep(3000);
  }
  throw new Error(`已完成抓取 ${startDate}～${endDate}，但尚未找到新的核對結果，請稍後再按一次同步。`);
}

function auditCoversRange(info, startDate, endDate) {
  return Boolean(
    clean(info && info.runId) &&
    dateKey(info && info.startDate) &&
    dateKey(info && info.endDate) &&
    info.startDate <= startDate &&
    info.endDate >= endDate
  );
}

function auditIsRecent(info, maxAgeMs = 30 * 60 * 1000) {
  const completedAt = timestampMillis(info && info.completedAt);
  return completedAt > 0 && Date.now() - completedAt <= maxAgeMs;
}

async function resolveAuditForRange(previousAudit, startDate, endDate) {
  if (auditCoversRange(previousAudit, startDate, endDate) && auditIsRecent(previousAudit)) {
    return Object.assign({}, previousAudit, { reused: true });
  }
  try {
    await runAuditForRange(startDate, endDate);
    return await waitForFreshAudit(previousAudit.runId, startDate, endDate);
  } catch (error) {
    // Cloud Run 偶發退出時，若同一日期範圍剛有成功結果，直接沿用，
    // 避免使用者重按後再次啟動完全相同的核對工作。
    const fallback = await latestAuditRunInfo();
    if (auditCoversRange(fallback, startDate, endDate) && auditIsRecent(fallback, 60 * 60 * 1000)) {
      console.warn('[resolveAuditForRange reuse after job error]', clean(error && error.message));
      return Object.assign({}, fallback, { reused: true });
    }
    throw error;
  }
}

async function waitForMirrorAudit(auditRunId, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await SETTINGS_REF.get();
    const settings = snapshot.exists ? snapshot.data() || {} : {};
    if (
      clean(settings.status) === 'success' &&
      clean(settings.auditRunId) === auditRunId
    ) return settings;
    await sleep(3000);
  }
  return null;
}

async function waitForMirrorIdle(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await SETTINGS_REF.get();
    const settings = snapshot.exists ? snapshot.data() || {} : {};
    if (clean(settings.status) !== 'running') return settings;
    await sleep(3000);
  }
  throw new Error('前一批資料仍在套用中，請稍後再按一次同步。');
}

async function requeueMirrorConvergenceAfterFailure(trigger) {
  return db.runTransaction(async (transaction) => {
    const [settingsSnapshot, scheduleSnapshot] = await Promise.all([
      transaction.get(SETTINGS_REF),
      transaction.get(COURSE_PORTAL_SCHEDULE_VERSION_REF)
    ]);
    const settings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
    const schedule = scheduleSnapshot.exists ? scheduleSnapshot.data() || {} : {};
    const convergenceOwner = convergenceOwnerForState(settings, schedule);
    if (!convergenceOwner) return false;
    transaction.set(SETTINGS_REF, {
      convergenceQueued: true,
      convergenceQueuedForOwner: convergenceOwner.owner,
      convergenceQueuedForSourceVersion: convergenceOwner.sourceVersion,
      convergenceQueuedAt: FieldValue.serverTimestamp(),
      convergenceQueuedBy: `${clean(trigger) || 'queued-convergence'}:retry-after-error`
    }, { merge: true });
    return true;
  });
}

async function runQueuedMirrorConvergence(trigger, syncOwner, sourceVersion) {
  const owner = clean(syncOwner);
  const expectedSourceVersion = clean(sourceVersion);
  if (!owner || !expectedSourceVersion) return null;
  const queued = await db.runTransaction(async (transaction) => {
    const [settingsSnapshot, scheduleSnapshot] = await Promise.all([
      transaction.get(SETTINGS_REF),
      transaction.get(COURSE_PORTAL_SCHEDULE_VERSION_REF)
    ]);
    const settings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
    const schedule = scheduleSnapshot.exists ? scheduleSnapshot.data() || {} : {};
    if (settings.convergenceQueued !== true) return null;
    const convergenceOwner = convergenceOwnerForState(settings, schedule);
    if (!convergenceOwner || convergenceOwner.active) return null;
    const queuedOwner = clean(settings.convergenceQueuedForOwner);
    const queuedSourceVersion = clean(settings.convergenceQueuedForSourceVersion);
    if (
      convergenceOwner.owner !== owner ||
      convergenceOwner.sourceVersion !== expectedSourceVersion
    ) return null;
    if (queuedOwner && queuedOwner !== owner) return null;
    if (queuedSourceVersion && queuedSourceVersion !== expectedSourceVersion) return null;
    transaction.set(SETTINGS_REF, {
      convergenceQueued: false,
      convergenceQueuedForOwner: '',
      convergenceQueuedForSourceVersion: '',
      convergenceStartedAt: FieldValue.serverTimestamp(),
      convergenceTrigger: clean(trigger) || 'queued-convergence'
    }, { merge: true });
    return true;
  });
  if (!queued) return null;
  try {
    return await syncLatestMirror(`${clean(trigger) || 'sync'}:queued-convergence`);
  } catch (error) {
    await requeueMirrorConvergenceAfterFailure(trigger).catch((requeueError) => {
      console.error('[course portal queued convergence requeue failed]', requeueError);
    });
    throw error;
  }
}

async function auditRefreshRange(endDate) {
  const selectedEndDate = dateKey(endDate);
  if (!selectedEndDate) throw new Error('同步日期格式不正確。');
  const snapshot = await SETTINGS_REF.get();
  const settings = snapshot.exists ? snapshot.data() || {} : {};
  const coveredDates = Array.isArray(settings.auditCoveredDates)
    ? settings.auditCoveredDates.map(dateKey).filter((date) => date && date <= selectedEndDate).sort()
    : [];
  const latestCovered = coveredDates[coveredDates.length - 1] || '';
  const recentStart = shiftDate(selectedEndDate, -6);
  const firstMissing = latestCovered && latestCovered < selectedEndDate
    ? shiftDate(latestCovered, 1)
    : selectedEndDate;
  let startDate = firstMissing < recentStart ? firstMissing : recentStart;
  const oldestAllowed = shiftDate(selectedEndDate, -30);
  if (startDate < oldestAllowed) startDate = oldestAllowed;
  return { startDate, endDate: selectedEndDate };
}

async function ensureInjiaoyunOperationsSync(endDate) {
  const selectedEndDate = dateKey(endDate);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const started = await startInjiaoyunCloudSync({
      requestedBy: '課程日表一鍵同步',
      requestedOrigin: 'internal-course-scheduler',
      requestedEndDateKey: selectedEndDate
    });
    const startedEndDate = dateKey(started.requestedEndDateKey);
    if (startedEndDate >= selectedEndDate) {
      return waitForInjiaoyunCloudSync({
        requestedEndDateKey: selectedEndDate,
        requestedAtMillis: started.requestedAtMillis,
        timeoutMs: 390000
      });
    }
    if (startedEndDate) {
      await waitForInjiaoyunCloudSync({
        requestedEndDateKey: startedEndDate,
        requestedAtMillis: started.requestedAtMillis,
        timeoutMs: 360000
      });
    }
    const delaySeconds = Math.max(2, Number(started.retryAfterSeconds) || 2);
    await sleep(delaySeconds * 1000);
  }
  throw new Error(`音教雲營運資料尚未排程到 ${selectedEndDate}，請稍後再按一次同步。`);
}

function requestOrigin(request) {
  const headers = request && request.rawRequest && request.rawRequest.headers || {};
  const direct = clean(headers.origin).toLowerCase().replace(/\/$/, '');
  if (direct) return direct;
  const referer = clean(headers.referer || headers.referrer);
  if (!referer) return '';
  try { return new URL(referer).origin.toLowerCase().replace(/\/$/, ''); }
  catch (_) { return ''; }
}

function assertAllowedCaller(request) {
  const source = clean(request && request.data && request.data.source).toLowerCase();
  const origin = requestOrigin(request);
  if (source === 'course-scheduler' && (ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin))) return;
  throw new HttpsError('permission-denied', '只允許從新版課程日表執行課務同步。');
}

function secureEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left), 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(String(right), 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function assertManualPin(request) {
  const expected = clean(MANUAL_SYNC_PIN.value());
  const provided = clean(request && request.data && request.data.manualSyncPin);
  if (expected.length < 12) throw new HttpsError('failed-precondition', '尚未設定音教雲手動同步密碼。');
  if (!provided || !secureEqual(provided, expected)) throw new HttpsError('permission-denied', '手動同步密碼不正確。');
}

function jsonValue(value) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
}

function sourceId(row, index) {
  return clean(row && row.id) || `row_${index + 1}`;
}

function documentId(type, id) {
  return crypto.createHash('sha256').update(`${type}:${id}`, 'utf8').digest('hex').slice(0, 32);
}

function sourceHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function syncOwnershipError() {
  const error = new Error('這批同步已由較新的工作接手，停止寫入舊資料。');
  error.code = 'sync-owner-changed';
  return error;
}

async function commitOperations(operations, syncContext) {
  const owner = clean(syncContext && syncContext.syncOwner);
  const sourceVersion = clean(syncContext && syncContext.sourceVersion);
  const syncScope = normalizedSyncScope(syncContext && syncContext.syncScope);
  let commits = 0;
  const chunks = [];
  for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
    chunks.push(operations.slice(offset, offset + BATCH_SIZE));
  }
  if (!chunks.length) chunks.push([]);
  for (const chunk of chunks) {
    await db.runTransaction(async (transaction) => {
      const [settingsSnapshot, scheduleSnapshot] = await Promise.all([
        transaction.get(SETTINGS_REF),
        transaction.get(COURSE_PORTAL_SCHEDULE_VERSION_REF)
      ]);
      const settings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
      const schedule = scheduleSnapshot.exists ? scheduleSnapshot.data() || {} : {};
      if (!activeSyncOwnerMatches(settings, schedule, owner, sourceVersion, syncScope)) {
        throw syncOwnershipError();
      }
      chunk.forEach((operation) => {
        transaction.set(operation.ref, operation.data, { merge: true });
      });
    });
    if (chunk.length) commits += 1;
  }
  return commits;
}

async function syncType(type, collectionName, rows, runId, syncContext) {
  const collection = db.collection(collectionName);
  const snapshot = await collection.get();
  const existing = new Map(snapshot.docs.map((doc) => [clean(doc.data() && doc.data().sourceId), {
    ref: doc.ref,
    data: doc.data() || {}
  }]));
  const seen = new Set();
  const operations = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let missing = 0;
  let deactivated = 0;

  rows.forEach((raw, index) => {
    const id = sourceId(raw, index);
    const source = jsonValue(raw);
    const prior = existing.get(id);
    if (
      type === 'tuitionPeriods' &&
      prior &&
      prior.data &&
      prior.data.source &&
      prior.data.source.planSnapshot &&
      Object.keys(prior.data.source.planSnapshot).length
    ) {
      // 付款當時的拆帳方案是薪資憑據。後續方案被改名或改比例時，只補新欄位，
      // 有效歷史值優先於當前通用方案；但舊版留下的空值／0 不能永久鎖死。
      source.planSnapshot = mergeTuitionPlanSnapshot(
        source.planSnapshot,
        prior.data.source.planSnapshot
      );
    }
    const hash = sourceHash(source);
    seen.add(id);
    if (prior && prior.data.sourceHash === hash && Number(prior.data.missingCount || 0) === 0 && prior.data.sourceActive !== false) {
      unchanged += 1;
      return;
    }
    const ref = prior ? prior.ref : collection.doc(documentId(type, id));
    operations.push({
      ref,
      data: {
        sourceId: id,
        sourceType: type,
        source,
        sourceHash: hash,
        // sourceActive 代表「本次來源仍存在」，不是課程／學生的業務啟用狀態。
        // 業務狀態完整保留在 source.active，歷史課表仍需要已結束學生的姓名。
        sourceActive: true,
        missingCount: 0,
        lastChangedRunId: runId,
        sourceUpdatedAt: FieldValue.serverTimestamp(),
        version: VERSION
      }
    });
    if (prior) updated += 1;
    else created += 1;
  });

  existing.forEach((prior, id) => {
    if (seen.has(id)) return;
    missing += 1;
    const nextMissingCount = Number(prior.data.missingCount || 0) + 1;
    const shouldDeactivate = nextMissingCount >= MISSING_CONFIRMATIONS;
    operations.push({
      ref: prior.ref,
      data: {
        missingCount: nextMissingCount,
        sourceActive: shouldDeactivate ? false : prior.data.sourceActive !== false,
        missingSinceRunId: clean(prior.data.missingSinceRunId) || runId,
        lastMissingRunId: runId,
        sourceUpdatedAt: FieldValue.serverTimestamp(),
        version: VERSION
      }
    });
    if (shouldDeactivate && prior.data.sourceActive !== false) deactivated += 1;
  });

  const commits = await commitOperations(operations, syncContext);
  return { sourceCount: rows.length, created, updated, unchanged, missing, deactivated, writes: operations.length, commits };
}

// 日表核對每次只抓指定日期範圍；範圍外的歷史事件要保留，範圍內則以本次舊系統結果完整覆蓋。
async function syncScopedEvents(collectionName, rows, auditRunId, coveredDates, syncContext) {
  const collection = db.collection(collectionName);
  const snapshot = await collection.get();
  const existing = new Map(snapshot.docs.map((doc) => [clean((doc.data() || {}).sourceId), {
    ref: doc.ref,
    data: doc.data() || {}
  }]));
  const covered = new Set(Array.isArray(coveredDates) ? coveredDates.map(clean).filter(Boolean) : []);
  const seen = new Set();
  const operations = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let missing = 0;
  let deactivated = 0;

  rows.forEach((raw, index) => {
    const id = sourceId(raw, index);
    const source = jsonValue(raw);
    const hash = sourceHash(source);
    const prior = existing.get(id);
    seen.add(id);
    if (prior && prior.data.sourceHash === hash && prior.data.sourceActive !== false) {
      unchanged += 1;
      return;
    }
    const ref = prior ? prior.ref : collection.doc(documentId('events', id));
    operations.push({
      ref,
      data: {
        sourceId: id,
        sourceType: 'events',
        source,
        sourceHash: hash,
        sourceActive: true,
        missingCount: 0,
        lastChangedRunId: auditRunId,
        sourceUpdatedAt: FieldValue.serverTimestamp(),
        version: VERSION
      }
    });
    if (prior) updated += 1;
    else created += 1;
  });

  existing.forEach((prior, id) => {
    if (seen.has(id)) return;
    const priorDate = clean(prior.data && prior.data.source && prior.data.source.date);
    if (!covered.has(priorDate)) return;
    missing += 1;
    operations.push({
      ref: prior.ref,
      data: {
        sourceActive: false,
        missingCount: 1,
        lastMissingRunId: auditRunId,
        sourceUpdatedAt: FieldValue.serverTimestamp(),
        version: VERSION
      }
    });
    if (prior.data.sourceActive !== false) deactivated += 1;
  });

  const commits = await commitOperations(operations, syncContext);
  return { sourceCount: rows.length, created, updated, unchanged, missing, deactivated, writes: operations.length, commits };
}

function snapshotSources(snapshot, activeOnly = true) {
  return (snapshot && snapshot.docs || []).map((doc) => {
    const envelope = doc.data() || {};
    if (activeOnly && envelope.sourceActive === false) return null;
    const source = jsonValue(envelope.source);
    return source && typeof source === 'object' ? source : null;
  }).filter(Boolean);
}

async function snapshotForDates(collectionName, coveredDates) {
  const dates = [...new Set((coveredDates || []).map(dateKey).filter(Boolean))];
  if (!dates.length) {
    throw new Error(`近期同步缺少 ${collectionName} 的日期範圍。`);
  }
  if (dates.length > 30) {
    throw new Error(`${collectionName} 日期查詢超過 Firestore in 上限；呼叫端必須分批，禁止截短後停用資料。`);
  }
  try {
    return await db.collection(collectionName).where('source.date', 'in', dates).get();
  } catch (error) {
    // 舊集合若尚未建立欄位索引，退回一次完整讀取；仍只會寫入指定日期。
    console.warn('[snapshotForDates fallback]', collectionName, clean(error && error.message));
    return db.collection(collectionName).get();
  }
}

async function readEducationDailyForDates(coveredDates) {
  const dates = [...new Set((coveredDates || []).map(dateKey).filter(Boolean))];
  const chunks = [];
  for (let index = 0; index < dates.length; index += 30) chunks.push(dates.slice(index, index + 30));
  const rows = (await Promise.all(chunks.map((chunk) => readEducationDaily(chunk)))).flat();
  const uniqueRows = new Map();
  rows.forEach((row) => {
    const id = clean(row && row._id) || dateKey(row && row.dateKey);
    if (id) uniqueRows.set(id, row);
  });
  return [...uniqueRows.values()];
}

function mergeEducationDailyRows(...rowSets) {
  const rows = new Map();
  rowSets.flat().forEach((row) => {
    const id = clean(row && row._id) || dateKey(row && row.dateKey);
    if (id) rows.set(id, row);
  });
  return [...rows.values()];
}

function educationDailyCoverage(dailyRows, coveredDates) {
  const expectedDates = [...new Set((coveredDates || []).map(dateKey).filter(Boolean))].sort();
  const rowsByDate = new Map();
  (Array.isArray(dailyRows) ? dailyRows : []).forEach((row) => {
    const day = dateKey(row && (row.dateKey || row._id));
    if (!day) return;
    if (!rowsByDate.has(day)) rowsByDate.set(day, []);
    rowsByDate.get(day).push(row);
  });
  const missingDates = expectedDates.filter((day) => !rowsByDate.has(day));
  const duplicateDates = expectedDates.filter((day) => (rowsByDate.get(day) || []).length !== 1 && rowsByDate.has(day));
  const incompleteDates = expectedDates.filter((day) => {
    const rows = rowsByDate.get(day) || [];
    return rows.length === 1 && !Array.isArray(rows[0] && rows[0].sessions);
  });
  return {
    complete: missingDates.length === 0 && duplicateDates.length === 0 && incompleteDates.length === 0,
    expectedDates,
    missingDates,
    duplicateDates,
    incompleteDates
  };
}

function assertEducationDailyCoverage(dailyRows, coveredDates, label = '老師薪資同步') {
  const coverage = educationDailyCoverage(dailyRows, coveredDates);
  if (coverage.complete) return coverage;
  const issues = [];
  if (coverage.missingDates.length) issues.push(`缺少日期 ${coverage.missingDates.join('、')}`);
  if (coverage.duplicateDates.length) issues.push(`日期重複 ${coverage.duplicateDates.join('、')}`);
  if (coverage.incompleteDates.length) issues.push(`sessions 未完整 ${coverage.incompleteDates.join('、')}`);
  throw new Error(`${clean(label)}的 opsEducationDaily 不完整：${issues.join('；')}。本次不會停用舊薪資，也不會標記完成。`);
}

async function snapshotForDateChunks(collectionName, coveredDates) {
  const dates = [...new Set((coveredDates || []).map(dateKey).filter(Boolean))];
  const chunks = [];
  for (let index = 0; index < dates.length; index += 30) chunks.push(dates.slice(index, index + 30));
  const snapshots = await Promise.all(chunks.map((chunk) => snapshotForDates(collectionName, chunk)));
  const documents = new Map();
  snapshots.forEach((snapshot) => (snapshot && snapshot.docs || []).forEach((doc) => {
    documents.set(clean(doc && doc.ref && doc.ref.path) || clean(doc && doc.id), doc);
  }));
  return { docs: [...documents.values()] };
}

async function syncRowsFromSnapshot(type, collectionName, rows, runId, snapshot, options = {}, syncContext) {
  const collection = db.collection(collectionName);
  const covered = new Set((options.coveredDates || []).map(dateKey).filter(Boolean));
  const existing = new Map((snapshot && snapshot.docs || []).map((doc) => [clean((doc.data() || {}).sourceId), {
    ref: doc.ref,
    data: doc.data() || {}
  }]));
  const seen = new Set();
  const operations = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let missing = 0;
  let deactivated = 0;

  rows.forEach((raw, index) => {
    const source = jsonValue(raw);
    const sourceDate = dateKey(source && source.date);
    if (covered.size && !covered.has(sourceDate)) return;
    const id = sourceId(source, index);
    const prior = existing.get(id);
    if (
      type === 'tuitionPeriods' &&
      prior &&
      prior.data &&
      prior.data.source &&
      prior.data.source.planSnapshot
    ) {
      source.planSnapshot = mergeTuitionPlanSnapshot(
        source.planSnapshot,
        prior.data.source.planSnapshot
      );
    }
    if (type === 'teacherPayroll' && prior && prior.data && prior.data.source) {
      const priorSource = jsonValue(prior.data.source) || {};
      ['courseId', 'subjectId', 'periodId', 'sourcePaymentId'].forEach((field) => {
        if (!clean(source[field]) && clean(priorSource[field])) source[field] = clean(priorSource[field]);
      });
    }
    const hash = sourceHash(source);
    seen.add(id);
    if (prior && prior.data.sourceHash === hash && prior.data.sourceActive !== false) {
      unchanged += 1;
      return;
    }
    const ref = prior ? prior.ref : collection.doc(documentId(type, id));
    operations.push({
      ref,
      data: {
        sourceId: id,
        sourceType: type,
        source,
        sourceHash: hash,
        sourceActive: true,
        missingCount: 0,
        lastChangedRunId: runId,
        sourceUpdatedAt: FieldValue.serverTimestamp(),
        version: VERSION
      }
    });
    if (prior) updated += 1;
    else created += 1;
  });

  if (options.deactivateMissing === true) {
    existing.forEach((prior, id) => {
      if (seen.has(id) || prior.data.sourceActive === false) return;
      const priorDate = dateKey(prior.data && prior.data.source && prior.data.source.date);
      if (covered.size && !covered.has(priorDate)) return;
      missing += 1;
      deactivated += 1;
      operations.push({
        ref: prior.ref,
        data: {
          sourceActive: false,
          missingCount: 1,
          lastMissingRunId: runId,
          sourceUpdatedAt: FieldValue.serverTimestamp(),
          version: VERSION
        }
      });
    });
  }

  const commits = await commitOperations(operations, syncContext);
  return { sourceCount: rows.length, created, updated, unchanged, missing, deactivated, writes: operations.length, commits };
}

async function syncTeacherPayrollFromDaily(
  dailyRows,
  coveredDates,
  runId,
  snapshot,
  syncContext,
  attendanceRows = []
) {
  const dates = [...new Set((coveredDates || []).map(dateKey).filter(Boolean))].sort();
  assertEducationDailyCoverage(dailyRows, dates);
  const covered = new Set(dates);
  const rows = buildTeacherPayroll(Array.isArray(dailyRows) ? dailyRows : [], attendanceRows)
    .filter((row) => covered.has(dateKey(row && row.date)));
  const result = await syncRowsFromSnapshot(
    'teacherPayroll',
    MIRROR_TYPES.teacherPayroll,
    rows,
    runId,
    snapshot,
    { coveredDates: dates, deactivateMissing: true },
    syncContext
  );
  return { rows, result };
}

function refreshTuitionUsage(periods, attendance, initialUsedByPeriod) {
  const usedByPeriod = initialUsedByPeriod instanceof Map
    ? new Map([...initialUsedByPeriod.entries()].map(([id, count]) => [clean(id), Math.max(0, Number(count) || 0)]))
    : new Map();
  attendance.forEach((row) => {
    if (!row || row.deducted !== true || !clean(row.periodId)) return;
    usedByPeriod.set(clean(row.periodId), (usedByPeriod.get(clean(row.periodId)) || 0) + 1);
  });
  periods.forEach((period) => {
    const lessonCount = Math.max(1, Number(period.lessonCount) || 4);
    period.usedCount = Math.min(lessonCount, usedByPeriod.get(clean(period.id)) || 0);
    const paid = (Array.isArray(period.transactions) ? period.transactions : []).reduce(
      (total, item) => total + (clean(item && item.type) === 'refund' ? -Number(item.amount || 0) : Number(item && item.amount || 0)),
      0
    );
    period.status = period.usedCount >= lessonCount
      ? 'completed'
      : paid < Math.max(0, Number(period.expectedAmount) || 0) ? 'unpaid' : 'active';
  });
}

async function syncRecentMirror(startDate, endDate, preferredAuditRunId, trigger = 'manual-recent-delta') {
  const selectedStartDate = dateKey(startDate);
  const selectedEndDate = dateKey(endDate);
  if (!selectedStartDate || !selectedEndDate || selectedStartDate > selectedEndDate) {
    throw new Error('近期同步日期範圍不正確。');
  }
  const [migrationRunId, auditInfo, operationsSnapshot, mirrorSettingsSnapshot] = await Promise.all([
    latestMigrationRunId(),
    preferredAuditRunId
      ? Promise.resolve({ runId: clean(preferredAuditRunId) })
      : latestAuditRunInfo(),
    OPERATIONS_SYNC_REF.get(),
    SETTINGS_REF.get()
  ]);
  if (!migrationRunId) throw new Error('找不到已完成的音教雲歷史資料。');
  if (!auditInfo.runId) throw new Error('找不到最新的音教雲日表核對資料。');
  const operationsSettings = operationsSnapshot.exists ? operationsSnapshot.data() || {} : {};
  const mirrorSettings = mirrorSettingsSnapshot.exists ? mirrorSettingsSnapshot.data() || {} : {};
  const payrollRepair = teacherPayrollRepairPlan(operationsSettings, mirrorSettings);
  const operationsVersion = operationsSourceVersion(operationsSettings);
  const payrollRepairVersion = payrollRepair
    ? `|payroll-repair:${payrollRepair.version}:${payrollRepair.startDate}:${payrollRepair.endDate}`
    : '';
  if (payrollRepair) {
    const repairDates = dateKeysBetween(payrollRepair.startDate, payrollRepair.endDate);
    const repairDailyRows = await readEducationDailyForDates(repairDates);
    assertEducationDailyCoverage(repairDailyRows, repairDates, '7 月老師薪資修復');
  }
  const sourceVersion = `${migrationRunId}|${auditInfo.runId}|${operationsVersion}|recent:${selectedStartDate}:${selectedEndDate}|${VERSION}|${EDUCATION_PREVIEW_VERSION}${payrollRepairVersion}`;
  const reservation = await reserveSync(sourceVersion, trigger, 'recent');
  if (!reservation.accepted) {
    if (reservation.reason === 'full-required') {
      return syncLatestMirror(`${clean(trigger) || 'operations-teacher-payroll'}:full-convergence-required`);
    }
    if (reservation.reason === 'full-required') {
      return syncLatestMirror(`${clean(trigger) || 'recent-sync'}:full-convergence-required`);
    }
    if (reservation.reason === 'current' || reservation.reason === 'current-repaired') {
      const converged = await runQueuedMirrorConvergence(
        trigger,
        reservation.finalizedOwner,
        sourceVersion
      );
      if (converged) return converged;
    }
    return {
      ok: true,
      status: reservation.reason,
      runId: migrationRunId,
      auditRunId: auditInfo.runId,
      summary: reservation.current && reservation.current.summary || {}
    };
  }
  const syncContext = { syncOwner: reservation.syncOwner, sourceVersion, syncScope: 'recent' };

  try {
    const audit = await latestAuditSchedule(auditInfo.runId);
    if (!audit.runId) throw new Error('音教雲近期日表核對資料讀取失敗。');
    const coveredDates = audit.coveredDates.filter((date) => date >= selectedStartDate && date <= selectedEndDate);
    if (!coveredDates.length) throw new Error('近期核對結果沒有涵蓋所選日期。');
    const payrollRepairDates = payrollRepair
      ? dateKeysBetween(payrollRepair.startDate, payrollRepair.endDate)
      : [];
    const payrollDates = [...new Set(coveredDates.concat(payrollRepairDates))].sort();
    const dailyRowsPromise = payrollRepairDates.length
      ? Promise.all([
        readEducationDaily(coveredDates),
        readEducationDailyForDates(payrollRepairDates)
      ]).then((rowSets) => mergeEducationDailyRows(...rowSets))
      : readEducationDaily(coveredDates);
    const [
      dailyRows,
      periodSnapshot,
      attendanceSnapshot,
      roomSnapshot,
      payrollSnapshot,
      rentalSnapshot,
      eventSnapshot
    ] = await Promise.all([
      dailyRowsPromise,
      db.collection(MIRROR_TYPES.tuitionPeriods).get(),
      snapshotForDateChunks(MIRROR_TYPES.attendance, coveredDates),
      db.collection(MIRROR_TYPES.rooms).get(),
      snapshotForDateChunks(MIRROR_TYPES.teacherPayroll, payrollDates),
      snapshotForDateChunks(MIRROR_TYPES.roomRentals, coveredDates),
      snapshotForDateChunks(MIRROR_TYPES.events, coveredDates)
    ]);
    const covered = new Set(coveredDates);
    const payrollCovered = new Set(payrollDates);
    const scopedDaily = dailyRows.filter((row) => {
      const day = dateKey(row && (row.dateKey || row._id));
      return day && covered.has(day);
    });
    const payrollDaily = dailyRows.filter((row) => {
      const day = dateKey(row && (row.dateKey || row._id));
      return day && payrollCovered.has(day);
    });
    const periods = snapshotSources(periodSnapshot);
    const currentAttendance = snapshotSources(attendanceSnapshot);
    const rooms = snapshotSources(roomSnapshot);
    const receiptResult = mergeEducationDailyReceipts(periods, scopedDaily);
    // 近期同步只讀取指定日期的簽到。以期別原本已用堂數扣除這次將被覆蓋的舊簽到，
    // 得到範圍外的基準堂數，不必再載入全部歷史簽到。
    const initialUsedByPeriod = new Map(periods.map((period) => [
      clean(period.id),
      Math.max(0, Number(period.usedCount) || 0)
    ]));
    currentAttendance.forEach((row) => {
      const periodId = clean(row && row.periodId);
      if (!periodId || row.deducted !== true) return;
      initialUsedByPeriod.set(periodId, Math.max(0, (initialUsedByPeriod.get(periodId) || 0) - 1));
    });
    refreshTuitionUsage(periods, [], initialUsedByPeriod);
    const reconciledAttendance = reconcileAuditedAttendance(
      currentAttendance,
      Array.isArray(audit.attendance) ? audit.attendance : [],
      periods,
      coveredDates,
      { initialUsedByPeriod, auditRunId: audit.runId }
    );
    refreshTuitionUsage(periods, reconciledAttendance, initialUsedByPeriod);
    const recentAttendance = reconciledAttendance.filter((row) => covered.has(dateKey(row.date)));
    const recentEvents = (Array.isArray(audit.events) ? audit.events : [])
      .filter((row) => covered.has(dateKey(row.date)));
    // 先帶入範圍內既有鏡像，讓每日收入可用穩定 sourceId 精確更新原行程；
    // 每日資料沒有完整起訖時間時只保留已驗證過的行程，絕不另造一筆假時段。
    const recentRentalSourceIds = new Set();
    scopedDaily.forEach((day) => (Array.isArray(day && day.roomRentals) ? day.roomRentals : [])
      .forEach((row) => {
        const id = clean(row && (row.sourceId || row.id || row._migrationSourceId)).replace(/^rental:/i, '');
        if (id) recentRentalSourceIds.add(id);
      }));
    const recentRentals = snapshotSources(rentalSnapshot)
      .filter((row) => (
        covered.has(dateKey(row && row.date)) &&
        row.timeResolved === true &&
        clean(row.durationSource) &&
        recentRentalSourceIds.has(clean(row && (row.sourceId || row.id)).replace(/^rental:/i, ''))
      ));
    const rentalResult = mergeEducationDailyRentals(
      recentRentals,
      scopedDaily,
      { rows: rooms },
      { scheduleRows: recentEvents }
    );
    const payrollSync = await syncTeacherPayrollFromDaily(
      payrollDaily,
      payrollDates,
      payrollRepair ? `operations-payroll:${timestampMillis(operationsSettings.lastSucceededAt)}` : audit.runId,
      payrollSnapshot,
      syncContext,
      reconciledAttendance
    );
    const recentPayroll = payrollSync.rows;

    const results = {
      tuitionPeriods: await syncRowsFromSnapshot(
        'tuitionPeriods',
        MIRROR_TYPES.tuitionPeriods,
        periods,
        migrationRunId,
        periodSnapshot,
        {},
        syncContext
      ),
      attendance: await syncRowsFromSnapshot(
        'attendance',
        MIRROR_TYPES.attendance,
        recentAttendance,
        audit.runId,
        attendanceSnapshot,
        { coveredDates, deactivateMissing: true },
        syncContext
      ),
      teacherPayroll: payrollSync.result,
      roomRentals: await syncRowsFromSnapshot(
        'roomRentals',
        MIRROR_TYPES.roomRentals,
        recentRentals,
        audit.runId,
        rentalSnapshot,
        { coveredDates, deactivateMissing: true },
        syncContext
      ),
      events: await syncRowsFromSnapshot(
        'events',
        MIRROR_TYPES.events,
        recentEvents,
        audit.runId,
        eventSnapshot,
        { coveredDates, deactivateMissing: true },
        syncContext
      )
    };
    const summary = Object.values(results).reduce((total, row) => {
      Object.keys(total).forEach((key) => { total[key] += Number(row[key] || 0); });
      return total;
    }, { sourceCount: 0, created: 0, updated: 0, unchanged: 0, missing: 0, deactivated: 0, writes: 0, commits: 0 });
    const previousCoveredDates = reservation.current && reservation.current.auditCoveredDates;
    const auditCoveredDates = [...new Set(
      (Array.isArray(previousCoveredDates) ? previousCoveredDates : []).concat(coveredDates)
    )].sort();
    const previousCounts = reservation.current && reservation.current.sourceCounts || {};
    const previousQuality = reservation.current && reservation.current.dataQuality || {};
    const dataQuality = Object.assign({}, previousQuality, {
      auditRunId: audit.runId,
      auditRangeStart: selectedStartDate,
      auditRangeEnd: selectedEndDate,
      auditCoveredDates,
      auditEventCount: recentEvents.length,
      auditAttendanceCount: recentAttendance.length,
      auditCountsByDate: audit.countsByDate || {},
      auditScheduleVersion: EDUCATION_PREVIEW_VERSION,
      teacherPayrollSyncStart: payrollDates[0] || '',
      teacherPayrollSyncEnd: payrollDates[payrollDates.length - 1] || '',
      teacherPayrollSyncCount: recentPayroll.length,
      teacherPayrollRepairApplied: Boolean(payrollRepair),
      recentReceiptCount: receiptResult.total,
      recentReceiptLinkedCount: receiptResult.linked,
      recentReceiptUpdatedCount: receiptResult.updated,
      recentReceiptUnmatchedCount: receiptResult.unmatched,
      recentReceiptCreatedPeriodCount: receiptResult.createdPeriods,
      recentRentalCount: rentalResult.total,
      recentRentalLinkedCount: rentalResult.linked,
      recentRentalMirroredCount: rentalResult.mirrored,
      recentRentalUnmatchedCount: rentalResult.unmatched,
      recentRentalIncompleteScheduleCount: rentalResult.incomplete,
      recentRentalDuplicateSourceCount: rentalResult.duplicates,
      recentRentalCreatedCount: rentalResult.created,
      recentRentalUpdatedCount: rentalResult.updated,
      recentRentalScheduleLinkedCount: rentalResult.scheduleLinked,
      recentRentalPreservedScheduleCount: rentalResult.preservedSchedule,
      recentRentalIssueCounts: rentalResult.issueCounts
    });
    const typeResults = Object.assign({}, reservation.current && reservation.current.typeResults || {}, results);
    const sourceCounts = Object.assign({}, previousCounts, {
      events: recentEvents.length,
      tuitionPeriods: periods.length,
      teacherPayrollRecent: recentPayroll.length,
      roomRentalsRecent: recentRentals.length
    });
    if (previousCounts.attendance != null) {
      sourceCounts.attendance = Math.max(
        0,
        Number(previousCounts.attendance || 0) - currentAttendance.length + recentAttendance.length
      );
    }
    const finalSettings = {
      status: 'success',
      sourceRunId: migrationRunId,
      auditRunId: audit.runId,
      sourceVersion,
      pendingRunId: '',
      pendingSourceVersion: '',
      completedAt: FieldValue.serverTimestamp(),
      lockUntil: Timestamp.fromMillis(0),
      summary,
      typeResults,
      sourceCounts,
      dataQuality,
      auditCoveredDates,
      version: VERSION
    };
    if (payrollRepair) {
      Object.assign(finalSettings, {
        teacherPayrollRepairVersion: payrollRepair.version,
        teacherPayrollRepairStartDate: payrollRepair.startDate,
        teacherPayrollRepairThroughDate: payrollRepair.endDate,
        teacherPayrollRepairSourceSucceededAt: operationsSettings.lastSucceededAt || null,
        teacherPayrollRepairCompletedAt: FieldValue.serverTimestamp()
      });
    }
    const finalization = await markCoursePortalScheduleUpdated(
      trigger,
      'success',
      reservation.syncOwner,
      sourceVersion,
      'recent',
      finalSettings
    );
    if (!finalization.finalized) {
      return {
        ok: true,
        status: 'superseded',
        runId: migrationRunId,
        auditRunId: audit.runId,
        summary,
        typeResults: results
      };
    }
    await db.collection('opsEducationSyncRuns').doc(documentId('syncRun', sourceVersion)).set({
      runId: migrationRunId,
      auditRunId: audit.runId,
      sourceVersion,
      syncOwner: reservation.syncOwner,
      syncScope: 'recent',
      status: 'success',
      trigger: clean(trigger) || 'manual-recent-delta',
      refreshStartDate: selectedStartDate,
      refreshEndDate: selectedEndDate,
      summary,
      typeResults: results,
      completedAt: FieldValue.serverTimestamp(),
      version: VERSION
    }, { merge: true }).catch((syncError) => {
      console.error('[education mirror sync run log failed after success]', syncError);
    });
    const converged = await runQueuedMirrorConvergence(
      trigger,
      reservation.syncOwner,
      sourceVersion
    ).catch((syncError) => {
      console.error('[course portal queued convergence failed after success]', syncError);
      return null;
    });
    if (converged) return converged;
    return {
      ok: true,
      status: 'success',
      runId: migrationRunId,
      auditRunId: audit.runId,
      summary,
      typeResults: results
    };
  } catch (error) {
    const message = clean(error && error.message || error).slice(0, 1000);
    const finalization = await markCoursePortalScheduleUpdated(
      `${trigger}:error`,
      'error',
      reservation.syncOwner,
      sourceVersion,
      'recent',
      {
        status: 'error',
        pendingRunId: '',
        pendingSourceVersion: '',
        failedAt: FieldValue.serverTimestamp(),
        lockUntil: Timestamp.fromMillis(0),
        lastError: message,
        version: VERSION
      }
    ).catch((syncError) => {
      console.error('[course portal schedule sync unlock failed]', syncError);
      return null;
    });
    if (finalization && finalization.finalized) {
      const recovered = await runQueuedMirrorConvergence(
        `${trigger}:error-recovery`,
        reservation.syncOwner,
        sourceVersion
      ).catch((syncError) => {
        console.error('[course portal queued convergence failed]', syncError);
        return null;
      });
      if (recovered) return recovered;
    }
    throw error;
  }
}

async function syncOperationsTeacherPayrollRange(
  operationsSettings,
  trigger = 'operations-success-trigger-teacher-payroll',
  options = {}
) {
  const repair = options.repair || null;
  const requestedRange = options.range || operationsSyncRange(operationsSettings);
  // 同一次 operations 同步可順便完成 7 月回填，但驗證範圍必須真正涵蓋整個 repair，
  // 不能只讀 operations 的較短區間卻把 repairThroughDate 標到月底。
  const combinedRange = combinedPayrollSyncRange(requestedRange, repair);
  const startDate = dateKey(combinedRange && combinedRange.startDate);
  const endDate = dateKey(combinedRange && combinedRange.endDate);
  if (!startDate || !endDate) {
    return { ok: true, status: 'current', synced: false, repaired: false };
  }
  // 完整性檢查在取得寫入鎖之前完成；缺日或超過安全範圍時完全不碰既有鏡像狀態。
  const coveredDates = dateKeysBetween(startDate, endDate);
  const dailyRows = await readEducationDailyForDates(coveredDates);
  assertEducationDailyCoverage(
    dailyRows,
    coveredDates,
    repair ? '7 月老師薪資修復' : 'operations 老師薪資同步'
  );
  const sourceVersion = [
    'operations-teacher-payroll',
    operationsSourceVersion(operationsSettings),
    startDate,
    endDate,
    repair ? `${repair.version}:${repair.startDate}:${repair.endDate}` : 'no-repair-marker',
    VERSION,
    EDUCATION_PREVIEW_VERSION
  ].join('|');
  const reservation = await reserveSync(sourceVersion, trigger, 'recent');
  if (!reservation.accepted) {
    if (reservation.reason === 'current' || reservation.reason === 'current-repaired') {
      const converged = await runQueuedMirrorConvergence(
        trigger,
        reservation.finalizedOwner,
        sourceVersion
      );
      if (converged) return converged;
    }
    return {
      ok: true,
      status: reservation.reason,
      synced: false,
      repaired: false,
      summary: reservation.current && reservation.current.summary || {}
    };
  }
  const syncContext = { syncOwner: reservation.syncOwner, sourceVersion, syncScope: 'recent' };
  try {
    const [payrollSnapshot, attendanceSnapshot] = await Promise.all([
      snapshotForDateChunks(MIRROR_TYPES.teacherPayroll, coveredDates),
      snapshotForDateChunks(MIRROR_TYPES.attendance, coveredDates)
    ]);
    const payrollSync = await syncTeacherPayrollFromDaily(
      dailyRows,
      coveredDates,
      `operations-payroll:${timestampMillis(operationsSettings && operationsSettings.lastSucceededAt)}`,
      payrollSnapshot,
      syncContext,
      snapshotSources(attendanceSnapshot)
    );
    const typeResults = Object.assign(
      {},
      reservation.current && reservation.current.typeResults || {},
      { teacherPayroll: payrollSync.result }
    );
    const sourceCounts = Object.assign(
      {},
      reservation.current && reservation.current.sourceCounts || {},
      {
        teacherPayrollOperations: payrollSync.rows.length,
        ...(repair ? { teacherPayrollRepair: payrollSync.rows.length } : {})
      }
    );
    const dataQuality = Object.assign(
      {},
      reservation.current && reservation.current.dataQuality || {},
      {
        teacherPayrollSyncStart: startDate,
        teacherPayrollSyncEnd: endDate,
        teacherPayrollSyncCount: payrollSync.rows.length,
        teacherPayrollRepairApplied: Boolean(repair),
        teacherPayrollDailyCoverageComplete: true
      }
    );
    const completionUpdates = {
      status: 'success',
      sourceVersion,
      pendingSourceVersion: '',
      completedAt: FieldValue.serverTimestamp(),
      lockUntil: Timestamp.fromMillis(0),
      summary: reservation.current && reservation.current.summary || {},
      typeResults,
      sourceCounts,
      dataQuality,
      version: VERSION
    };
    if (repair) Object.assign(completionUpdates, {
      teacherPayrollRepairVersion: repair.version,
      teacherPayrollRepairStartDate: repair.startDate,
      teacherPayrollRepairThroughDate: repair.endDate,
      teacherPayrollRepairSourceSucceededAt: operationsSettings.lastSucceededAt || null,
      teacherPayrollRepairCompletedAt: FieldValue.serverTimestamp()
    });
    const finalization = await markCoursePortalScheduleUpdated(
      trigger,
      'success',
      reservation.syncOwner,
      sourceVersion,
      'recent',
      completionUpdates
    );
    if (!finalization.finalized) {
      return { ok: true, status: 'superseded', repaired: false, typeResults: { teacherPayroll: payrollSync.result } };
    }
    await db.collection('opsEducationSyncRuns').doc(documentId('syncRun', sourceVersion)).set({
      sourceVersion,
      syncOwner: reservation.syncOwner,
      syncScope: 'recent',
      status: 'success',
      trigger: clean(trigger) || 'operations-success-trigger-teacher-payroll',
      refreshStartDate: startDate,
      refreshEndDate: endDate,
      repairType: repair ? 'teacherPayroll' : '',
      typeResults: { teacherPayroll: payrollSync.result },
      completedAt: FieldValue.serverTimestamp(),
      version: VERSION
    }, { merge: true }).catch((syncError) => {
      console.error('[teacher payroll repair run log failed after success]', syncError);
    });
    const converged = await runQueuedMirrorConvergence(
      trigger,
      reservation.syncOwner,
      sourceVersion
    ).catch((syncError) => {
      console.error('[course portal queued convergence failed after payroll repair]', syncError);
      return null;
    });
    if (converged) return converged;
    return {
      ok: true,
      status: 'success',
      synced: true,
      repaired: Boolean(repair),
      repairStartDate: repair ? repair.startDate : '',
      repairEndDate: repair ? repair.endDate : '',
      syncStartDate: startDate,
      syncEndDate: endDate,
      typeResults: { teacherPayroll: payrollSync.result }
    };
  } catch (error) {
    const message = clean(error && error.message || error).slice(0, 1000);
    const finalization = await markCoursePortalScheduleUpdated(
      `${trigger}:error`,
      'error',
      reservation.syncOwner,
      sourceVersion,
      'recent',
      {
        status: 'error',
        pendingSourceVersion: '',
        failedAt: FieldValue.serverTimestamp(),
        lockUntil: Timestamp.fromMillis(0),
        lastError: message,
        version: VERSION
      }
    ).catch((syncError) => {
      console.error('[teacher payroll repair unlock failed]', syncError);
      return null;
    });
    if (finalization && finalization.finalized) {
      const recovered = await runQueuedMirrorConvergence(
        `${trigger}:error-recovery`,
        reservation.syncOwner,
        sourceVersion
      ).catch((syncError) => {
        console.error('[course portal queued convergence failed]', syncError);
        return null;
      });
      if (recovered) return recovered;
    }
    throw error;
  }
}

async function syncTeacherPayrollRepair(operationsSettings, trigger = 'operations-payroll-repair') {
  const mirrorSnapshot = await SETTINGS_REF.get();
  const mirrorSettings = mirrorSnapshot.exists ? mirrorSnapshot.data() || {} : {};
  const repair = teacherPayrollRepairPlan(operationsSettings, mirrorSettings);
  if (!repair) return { ok: true, status: 'current', synced: false, repaired: false };
  return syncOperationsTeacherPayrollRange(operationsSettings, trigger, { range: repair, repair });
}

async function reserveSync(sourceVersion, trigger, syncScope = 'full') {
  const now = Timestamp.now();
  const scope = normalizedSyncScope(syncScope);
  const syncOwner = `injiaoyun-mirror:${crypto.randomUUID()}`;
  return db.runTransaction(async (transaction) => {
    const [snapshot, scheduleSnapshot] = await Promise.all([
      transaction.get(SETTINGS_REF),
      transaction.get(COURSE_PORTAL_SCHEDULE_VERSION_REF)
    ]);
    const current = snapshot.exists ? snapshot.data() || {} : {};
    const schedule = scheduleSnapshot.exists ? scheduleSnapshot.data() || {} : {};
    const fullRequired = fullConvergenceIsRequired(current, schedule);
    const directive = syncReservationDirective(
      current,
      schedule,
      sourceVersion,
      scope,
      now.toMillis()
    );
    if (directive === 'current') {
      const currentOwner = clean(current.syncOwner);
      const scheduleOwner = clean(schedule.syncOwner);
      const finalizedOwner = clean(current.lastFinalizedOwner || currentOwner);
      const scheduleKnownOwner = clean(scheduleOwner || schedule.lastFinalizedOwner);
      const scheduleKnownSourceVersion = clean(
        schedule.pendingSourceVersion || schedule.lastFinalizedSourceVersion
      );
      // 舊版成功狀態沒有 owner；只要 schedule 也沒有 owner，仍可修復遺漏的解鎖。
      // schedule 已有不同 owner 時代表較新的同步已接手，舊狀態不可解除它的封鎖。
      const repairOwnerMatches = (
        (!scheduleKnownOwner || Boolean(finalizedOwner && finalizedOwner === scheduleKnownOwner)) &&
        (!scheduleKnownSourceVersion || scheduleKnownSourceVersion === sourceVersion)
      );
      if (
        repairOwnerMatches &&
        (
          schedule.writesBlocked === true ||
          schedule.syncing === true ||
          clean(schedule.integrityStatus).toLowerCase() !== 'healthy'
        )
      ) {
        const scheduleVersion = Number(schedule.version || 0);
        const repairUpdates = {
          version: scheduleVersion + 1,
          syncing: false,
          syncingUntil: Timestamp.fromMillis(0),
          writesBlocked: false,
          integrityStatus: 'healthy',
          lastSyncStatus: 'success',
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: `injiaoyun-mirror:${clean(trigger) || 'sync'}:repair-completed-sync`
        };
        if (finalizedOwner || scheduleKnownOwner) {
          const repairedOwner = finalizedOwner || scheduleKnownOwner;
          repairUpdates.syncOwner = '';
          repairUpdates.syncScope = '';
          repairUpdates.pendingSourceVersion = '';
          repairUpdates.lastFinalizedOwner = repairedOwner;
          repairUpdates.lastFinalizedSourceVersion = sourceVersion;
          if (currentOwner) {
            transaction.set(SETTINGS_REF, {
              syncOwner: '',
              syncScope: '',
              pendingSourceVersion: '',
              lastFinalizedOwner: repairedOwner,
              lastFinalizedSourceVersion: sourceVersion
            }, { merge: true });
          }
        }
        transaction.set(COURSE_PORTAL_SCHEDULE_VERSION_REF, repairUpdates, { merge: true });
        return { accepted: false, reason: 'current-repaired', current, finalizedOwner };
      }
      return { accepted: false, reason: 'current', current, finalizedOwner };
    }
    if (directive === 'running-current') {
      return { accepted: false, reason: 'running', duplicate: true, current };
    }
    if (directive === 'running') {
      transaction.set(SETTINGS_REF, {
        convergenceQueued: true,
        convergenceQueuedForOwner: clean(current.syncOwner),
        convergenceQueuedForSourceVersion: clean(current.pendingSourceVersion),
        convergenceQueuedAt: FieldValue.serverTimestamp(),
        convergenceQueuedBy: clean(trigger) || 'automatic'
      }, { merge: true });
      return { accepted: false, reason: 'running', current };
    }
    if (directive === 'full-required') {
      return { accepted: false, reason: 'full-required', current };
    }
    const preserveQueuedConvergence = (
      scope === 'full' &&
      fullRequired &&
      current.convergenceQueued === true
    );
    transaction.set(SETTINGS_REF, {
      status: 'running',
      trigger: clean(trigger) || 'automatic',
      pendingSourceVersion: sourceVersion,
      syncOwner,
      syncScope: scope,
      fullConvergenceRequired: scope === 'full' ? true : fullRequired,
      convergenceQueued: preserveQueuedConvergence,
      convergenceQueuedForOwner: preserveQueuedConvergence ? syncOwner : '',
      convergenceQueuedForSourceVersion: preserveQueuedConvergence ? sourceVersion : '',
      startedAt: now,
      lockUntil: Timestamp.fromMillis(now.toMillis() + LOCK_MS),
      lastError: '',
      version: VERSION
    }, { merge: true });
    const scheduleVersion = Number(schedule.version || 0);
    transaction.set(COURSE_PORTAL_SCHEDULE_VERSION_REF, {
      version: scheduleVersion + 1,
      syncOwner,
      syncScope: scope,
      pendingSourceVersion: sourceVersion,
      fullConvergenceRequired: scope === 'full' ? true : fullRequired,
      syncing: true,
      syncingUntil: Timestamp.fromMillis(now.toMillis() + LOCK_MS),
      writesBlocked: true,
      integrityStatus: 'syncing',
      lastSyncStatus: 'running',
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: `injiaoyun-mirror:${clean(trigger) || 'sync'}:start`
    }, { merge: true });
    return { accepted: true, current, syncOwner, syncScope: scope };
  });
}

function reconcileAuditedAttendance(previewAttendance, auditAttendance, periods, coveredDates, options = {}) {
  const covered = new Set(Array.isArray(coveredDates) ? coveredDates.map(dateKey).filter(Boolean) : []);
  const hasInitialUsage = options.initialUsedByPeriod instanceof Map;
  const initialUsedByPeriod = hasInitialUsage
    ? new Map([...options.initialUsedByPeriod.entries()].map(([id, count]) => [clean(id), Math.max(0, Number(count) || 0)]))
    : new Map();
  const assignedByPeriod = new Map();
  const periodById = new Map(periods.map((row) => [clean(row.id), row]));
  const periodBySource = new Map(periods.map((row) => [clean(row.sourcePaymentId), row]).filter(([id]) => id));
  const periodsByStudentSubject = new Map();
  periods.forEach((period) => {
    const key = `${clean(period.studentId)}|${clean(period.subjectId)}`;
    if (!periodsByStudentSubject.has(key)) periodsByStudentSubject.set(key, []);
    periodsByStudentSubject.get(key).push(period);
  });
  periodsByStudentSubject.forEach((rows) => rows.sort((left, right) => (
    `${dateKey(right.startDate)}|${String(Number(right.periodNo) || 0).padStart(6, '0')}`
      .localeCompare(`${dateKey(left.startDate)}|${String(Number(left.periodNo) || 0).padStart(6, '0')}`)
  )));
  const existingById = new Map(previewAttendance.map((row) => [clean(row.id), row]));
  const existingByCourseDateStudent = new Map();
  previewAttendance.forEach((row) => {
    const key = `${clean(row.sourceCourseId)}|${dateKey(row.date)}|${clean(row.studentId)}`;
    if (!existingByCourseDateStudent.has(key)) existingByCourseDateStudent.set(key, row);
  });
  const merged = previewAttendance.filter((row) => !covered.has(dateKey(row.date))).map(jsonValue);
  const seen = new Set();
  auditAttendance.forEach((raw, index) => {
    const row = jsonValue(raw) || {};
    const date = dateKey(row.date);
    if (!date || !covered.has(date) || !clean(row.studentId)) return;
    const fallbackKey = `${clean(row.sourceCourseId)}|${date}|${clean(row.studentId)}`;
    const prior = existingById.get(clean(row.id)) || existingByCourseDateStudent.get(fallbackKey) || {};
    const explicitPeriod = periodBySource.get(clean(row.sourcePaymentId)) || periodById.get(clean(prior.periodId));
    const subjectCandidates = periodsByStudentSubject.get(`${clean(row.studentId)}|${clean(row.subjectId)}`) || [];
    const inferredPeriod = subjectCandidates.find((candidate) => (
      (!candidate.startDate || candidate.startDate <= date) &&
      (
        hasInitialUsage
          ? (initialUsedByPeriod.get(clean(candidate.id)) || 0) + (assignedByPeriod.get(clean(candidate.id)) || 0)
          : Number(candidate.usedCount || 0)
      ) < Math.max(1, Number(candidate.lessonCount) || 4)
    ));
    const period = explicitPeriod || inferredPeriod || {};
    const status = clean(row.status) || 'attended';
    const leaveNoDeduct = period.planSnapshot && period.planSnapshot.leaveNoDeduct !== false;
    const linked = Boolean(period.id);
    const deducted = linked && (
      status === 'attended' ||
      status === 'absent' ||
      (status === 'leave' && !leaveNoDeduct)
    );
    if (deducted && hasInitialUsage) {
      assignedByPeriod.set(clean(period.id), (assignedByPeriod.get(clean(period.id)) || 0) + 1);
    }
    const id = clean(row.id) || `audit_attendance_${index + 1}`;
    const dedupeKey = `${id}|${date}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    merged.push(Object.assign({}, row, {
      id,
      date,
      periodId: clean(period.id),
      sourcePaymentId: clean(row.sourcePaymentId) || clean(period.sourcePaymentId),
      source: clean(row.source) || 'injiaoyun-audit',
      sourceAuditRunId: clean(row.sourceAuditRunId) || clean(options.auditRunId),
      deducted,
      reconciliationStatus: linked
        ? explicitPeriod ? 'linked-explicit-payment' : 'linked-student-subject-period'
        : 'unmatched-no-explicit-payment'
    }));
  });
  merged.sort((left, right) => (
    `${dateKey(left.date)}|${String(Number(left.lessonNo) || 0).padStart(4, '0')}|${clean(left.id)}`
      .localeCompare(`${dateKey(right.date)}|${String(Number(right.lessonNo) || 0).padStart(4, '0')}|${clean(right.id)}`)
  ));
  const usedByPeriod = hasInitialUsage ? new Map(initialUsedByPeriod) : new Map();
  merged.forEach((row) => {
    if (!row.deducted || !row.periodId) return;
    const period = periodById.get(clean(row.periodId));
    if (!period) {
      row.deducted = false;
      row.reconciliationStatus = 'unmatched-payment-period';
      return;
    }
    const used = usedByPeriod.get(row.periodId) || 0;
    if (used >= Math.max(1, Number(period.lessonCount) || 4)) {
      row.deducted = false;
      row.reconciliationStatus = 'over-period-limit-review';
      return;
    }
    usedByPeriod.set(row.periodId, used + 1);
  });
  return merged;
}

function attendanceIdentity(row) {
  const sourceId = clean(row && (row.id || row.sourceId));
  if (sourceId) return `id|${sourceId}`;
  return [
    'course',
    clean(row && (row.sourceCourseId || row.courseId)),
    dateKey(row && row.date),
    clean(row && row.studentId),
    clean(row && row.sourcePaymentId)
  ].join('|');
}

function mergePreservedAuditAttendance(previewAttendance, mirrorAttendance, latestCoveredDates) {
  const covered = new Set((latestCoveredDates || []).map(dateKey).filter(Boolean));
  const merged = new Map();
  (Array.isArray(previewAttendance) ? previewAttendance : []).forEach((row) => {
    merged.set(attendanceIdentity(row), jsonValue(row));
  });
  (Array.isArray(mirrorAttendance) ? mirrorAttendance : []).forEach((row) => {
    const date = dateKey(row && row.date);
    // 舊版尚未在 audit 簽到寫 source 標記，因此範圍外的既有簽到全部保留；
    // 真正需要刪除／更正的日期必須由涵蓋該日的新 audit 覆蓋，不能靠「最新 audit 沒看到」推論。
    if (!date || covered.has(date)) return;
    merged.set(attendanceIdentity(row), jsonValue(row));
  });
  return [...merged.values()];
}

async function syncLatestMirror(trigger = 'automatic') {
  const [migrationRunId, auditInfo, operationsSnapshot] = await Promise.all([
    latestMigrationRunId(),
    latestAuditRunInfo(),
    OPERATIONS_SYNC_REF.get()
  ]);
  if (!migrationRunId) throw new Error('找不到已完成的音教雲移轉資料。');
  if (!auditInfo.runId) throw new Error('找不到已完成的音教雲舊日表核對資料。');
  // 納入同步規則版本；即使來源 run 未改變，部署新判定規則後也會重新套用一次。
  // 同步版本同時綁定日表判定程式；日表邏輯更新後，即使來源 run 相同也必須重建鏡像。
  const operationsSettings = operationsSnapshot.exists ? operationsSnapshot.data() || {} : {};
  const operationsVersion = operationsSourceVersion(operationsSettings);
  const sourceVersion = `${migrationRunId}|${auditInfo.runId}|${operationsVersion}|${VERSION}|${EDUCATION_PREVIEW_VERSION}`;
  const reservation = await reserveSync(sourceVersion, trigger, 'full');
  if (!reservation.accepted) {
    if (reservation.reason === 'current' || reservation.reason === 'current-repaired') {
      const converged = await runQueuedMirrorConvergence(
        trigger,
        reservation.finalizedOwner,
        sourceVersion
      );
      if (converged) return converged;
    }
    return {
      ok: true,
      status: reservation.reason,
      runId: migrationRunId,
      auditRunId: auditInfo.runId,
      summary: reservation.current && reservation.current.summary || {}
    };
  }
  const syncContext = { syncOwner: reservation.syncOwner, sourceVersion, syncScope: 'full' };

  try {
    // 只有來源版本真的改變時才讀取完整 audit 子集合，避免每次開頁都重抓全部歷史資料。
    const [preview, audit, priorAttendanceSnapshot, priorPeriodSnapshot] = await Promise.all([
      buildPreview(migrationRunId),
      latestAuditSchedule(auditInfo.runId),
      db.collection(MIRROR_TYPES.attendance).get(),
      db.collection(MIRROR_TYPES.tuitionPeriods).get()
    ]);
    if (!audit.runId) throw new Error('音教雲舊日表核對資料讀取失敗。');
    const previewPeriods = Array.isArray(preview.tuitionPeriods) ? preview.tuitionPeriods : [];
    const priorPeriodsById = new Map(snapshotSources(priorPeriodSnapshot).map((row) => [clean(row.id), row]));
    previewPeriods.forEach((period) => {
      const prior = priorPeriodsById.get(clean(period.id));
      if (prior && prior.planSnapshot) {
        period.planSnapshot = mergeTuitionPlanSnapshot(period.planSnapshot, prior.planSnapshot);
      }
    });
    const attendanceBase = mergePreservedAuditAttendance(
      Array.isArray(preview.attendance) ? preview.attendance : [],
      snapshotSources(priorAttendanceSnapshot),
      audit.coveredDates
    );
    const reconciledAttendance = reconcileAuditedAttendance(
      attendanceBase,
      Array.isArray(audit.attendance) ? audit.attendance : [],
      previewPeriods,
      audit.coveredDates,
      { auditRunId: audit.runId }
    );
    // full reconcile 也必須以最終合併後的完整簽到重算堂數；不能沿用 preview 在 audit 覆蓋前的 usedCount。
    refreshTuitionUsage(previewPeriods, reconciledAttendance);
    const results = {};
    for (const [type, collectionName] of Object.entries(MIRROR_TYPES)) {
      if (type === 'events') {
        results[type] = await syncScopedEvents(
          collectionName,
          audit.events,
          audit.runId,
          audit.coveredDates,
          syncContext
        );
      } else {
        results[type] = await syncType(
          type,
          collectionName,
          type === 'attendance' ? reconciledAttendance : (Array.isArray(preview[type]) ? preview[type] : []),
          migrationRunId,
          syncContext
        );
      }
    }
    const summary = Object.values(results).reduce((total, row) => {
      Object.keys(total).forEach((key) => { total[key] += Number(row[key] || 0); });
      return total;
    }, { sourceCount: 0, created: 0, updated: 0, unchanged: 0, missing: 0, deactivated: 0, writes: 0, commits: 0 });
    const previousCoveredDates = reservation.current && reservation.current.auditCoveredDates;
    const auditCoveredDates = [...new Set(
      (Array.isArray(previousCoveredDates) ? previousCoveredDates : []).concat(audit.coveredDates)
    )].sort();
    const dataQuality = Object.assign({}, preview.dataQuality || {}, {
      auditRunId: audit.runId,
      auditRangeStart: audit.startDate,
      auditRangeEnd: audit.endDate,
      auditCoveredDates,
      auditEventCount: audit.events.length,
      auditAttendanceCount: reconciledAttendance.length,
      auditCountsByDate: audit.countsByDate || {},
      auditScheduleVersion: EDUCATION_PREVIEW_VERSION
    });
    const finalization = await markCoursePortalScheduleUpdated(
      trigger,
      'success',
      reservation.syncOwner,
      sourceVersion,
      'full',
      {
        status: 'success',
        sourceRunId: migrationRunId,
        auditRunId: audit.runId,
        sourceVersion,
        pendingRunId: '',
        pendingSourceVersion: '',
        completedAt: FieldValue.serverTimestamp(),
        lockUntil: Timestamp.fromMillis(0),
        summary,
        typeResults: results,
        sourceCounts: Object.assign({}, preview.counts || {}, { events: audit.events.length }),
        dataQuality,
        auditCoveredDates,
        version: VERSION
      }
    );
    if (!finalization.finalized) {
      return {
        ok: true,
        status: 'superseded',
        runId: migrationRunId,
        auditRunId: audit.runId,
        summary,
        typeResults: results
      };
    }
    await db.collection('opsEducationSyncRuns').doc(documentId('syncRun', sourceVersion)).set({
      runId: migrationRunId,
      auditRunId: audit.runId,
      sourceVersion,
      syncOwner: reservation.syncOwner,
      syncScope: 'full',
      status: 'success',
      trigger: clean(trigger) || 'automatic',
      summary,
      typeResults: results,
      completedAt: FieldValue.serverTimestamp(),
      version: VERSION
    }, { merge: true }).catch((syncError) => {
      console.error('[education mirror sync run log failed after success]', syncError);
    });
    const converged = await runQueuedMirrorConvergence(
      trigger,
      reservation.syncOwner,
      sourceVersion
    ).catch((syncError) => {
      console.error('[course portal queued convergence failed after success]', syncError);
      return null;
    });
    if (converged) return converged;
    return {
      ok: true,
      status: 'success',
      runId: migrationRunId,
      auditRunId: audit.runId,
      summary,
      typeResults: results
    };
  } catch (error) {
    const message = clean(error && error.message || error).slice(0, 1000);
    const finalization = await markCoursePortalScheduleUpdated(
      `${trigger}:error`,
      'error',
      reservation.syncOwner,
      sourceVersion,
      'full',
      {
        status: 'error',
        pendingRunId: '',
        pendingSourceVersion: '',
        failedAt: FieldValue.serverTimestamp(),
        lockUntil: Timestamp.fromMillis(0),
        lastError: message,
        version: VERSION
      }
    ).catch((syncError) => {
      console.error('[course portal schedule sync unlock failed]', syncError);
      return null;
    });
    if (finalization && finalization.finalized) {
      const recovered = await runQueuedMirrorConvergence(
        `${trigger}:error-recovery`,
        reservation.syncOwner,
        sourceVersion
      ).catch((syncError) => {
        console.error('[course portal queued convergence failed]', syncError);
        return null;
      });
      if (recovered) return recovered;
    }
    throw error;
  }
}

async function readMirrorPayload() {
  const [settingsSnapshot, ...snapshots] = await Promise.all([
    SETTINGS_REF.get(),
    ...Object.values(MIRROR_TYPES).map((name) => db.collection(name).where('sourceActive', '==', true).get())
  ]);
  const settings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
  const payload = {
    ok: true,
    readOnly: true,
    scope: 'education-only',
    dataMode: 'mirror',
    runId: clean(settings.sourceRunId),
    version: VERSION,
    loadedAt: new Date().toISOString(),
    counts: settings.sourceCounts || {},
    dataQuality: settings.dataQuality || {},
    mirrorMeta: {
      status: clean(settings.status),
      auditRunId: clean(settings.auditRunId),
      completedAt: settings.completedAt || null,
      summary: settings.summary || {}
    }
  };
  Object.keys(MIRROR_TYPES).forEach((type, index) => {
    payload[type] = snapshots[index].docs.map((doc) => jsonValue((doc.data() || {}).source)).filter(Boolean);
  });
  return appendCoursePortalData(payload);
}

function registerInjiaoyunEducationMirror(exportsObject) {
  exportsObject.syncInjiaoyunEducationMirrorNow = onCall({
    region: FUNCTION_REGION,
    timeoutSeconds: 540,
    memory: '2GiB',
    cors: [...ALLOWED_ORIGINS, LOCAL_ORIGIN],
    secrets: [MANUAL_SYNC_PIN]
  }, async (request) => {
    assertAllowedCaller(request);
    assertManualPin(request);
    const refreshDate = dateKey(request && request.data && request.data.refreshDate);
    try {
      if (!refreshDate) return await syncLatestMirror('manual-course-scheduler');
      const before = await latestAuditRunInfo();
      const refreshRange = await auditRefreshRange(refreshDate);
      await SETTINGS_REF.set({
        unifiedSyncStatus: 'running',
        unifiedSyncStartDate: refreshRange.startDate,
        unifiedSyncEndDate: refreshRange.endDate,
        unifiedSyncStartedAt: FieldValue.serverTimestamp(),
        unifiedSyncLockUntil: Timestamp.fromMillis(Date.now() + LOCK_MS),
        unifiedSyncLastError: '',
        version: VERSION
      }, { merge: true });

      // 營運資料與課表核對彼此獨立，平行執行可大幅縮短等待時間。
      const [operationsSync, freshAudit] = await Promise.all([
        ensureInjiaoyunOperationsSync(refreshDate),
        resolveAuditForRange(before, refreshRange.startDate, refreshRange.endDate)
      ]);
      const syncResult = await syncRecentMirror(
        refreshRange.startDate,
        refreshRange.endDate,
        freshAudit.runId,
        'manual-unified-recent-delta'
      );
      if (clean(syncResult.status) === 'running') {
        throw new Error('另一批近期資料正在套用，請稍候完成後再按一次同步。');
      }
      await SETTINGS_REF.set({
        unifiedSyncStatus: 'success',
        unifiedSyncStartDate: refreshRange.startDate,
        unifiedSyncEndDate: refreshRange.endDate,
        unifiedSyncCompletedAt: FieldValue.serverTimestamp(),
        unifiedSyncLockUntil: Timestamp.fromMillis(0),
        unifiedSyncDeferredOperations: false,
        unifiedSyncDeferredAudit: false,
        unifiedSyncLastError: '',
        version: VERSION
      }, { merge: true });
      return {
        ok: true,
        status: 'success',
        refreshStartDate: refreshRange.startDate,
        refreshDate,
        auditRunId: freshAudit.runId,
        runId: clean(syncResult.runId),
        operationsEndDate: clean(operationsSync.lastEndDateKey) || refreshDate,
        summary: syncResult.summary || {}
      };
    } catch (error) {
      console.error('[syncInjiaoyunEducationMirrorNow]', error);
      await SETTINGS_REF.set({
        unifiedSyncStatus: 'error',
        unifiedSyncEndDate: refreshDate || '',
        unifiedSyncFailedAt: FieldValue.serverTimestamp(),
        unifiedSyncLockUntil: Timestamp.fromMillis(0),
        unifiedSyncLastError: clean(error && error.message).slice(0, 1000),
        version: VERSION
      }, { merge: true }).catch(() => {});
      throw new HttpsError('internal', `新版課務同步失敗：${clean(error && error.message).slice(0, 300)}`);
    }
  });

  exportsObject.loadInjiaoyunEducationMirror = onCall({
    region: FUNCTION_REGION,
    timeoutSeconds: 300,
    memory: '2GiB',
    cors: [...ALLOWED_ORIGINS, LOCAL_ORIGIN],
    secrets: [MANUAL_SYNC_PIN]
  }, async (request) => {
    assertAllowedCaller(request);
    assertManualPin(request);
    try {
      return await readMirrorPayload();
    } catch (error) {
      console.error('[loadInjiaoyunEducationMirror]', error);
      throw new HttpsError('internal', `新版課務讀取失敗：${clean(error && error.message).slice(0, 300)}`);
    }
  });

  // 營運 Cloud Run 每次成功寫回新 lastSucceededAt 後，老師薪資獨立同步完整 operations 範圍；
  // 課表、簽到與租用仍只套用最新 audit 已核對涵蓋的交集。
  exportsObject.applyInjiaoyunEducationMirrorOnOperationsSuccess = onDocumentWritten({
    document: 'opsSettings/injiaoyunCloudSync',
    region: FUNCTION_REGION,
    timeoutSeconds: 540,
    memory: '2GiB'
  }, async (event) => {
    const before = event.data && event.data.before && event.data.before.exists
      ? event.data.before.data() || {}
      : {};
    const after = event.data && event.data.after && event.data.after.exists
      ? event.data.after.data() || {}
      : {};
    if (!operationsSyncAdvanced(before, after)) return;
    try {
      const [auditInfo, mirrorSnapshot, currentOperationsSnapshot] = await Promise.all([
        latestAuditRunInfo(),
        SETTINGS_REF.get(),
        OPERATIONS_SYNC_REF.get()
      ]);
      const mirrorSettings = mirrorSnapshot.exists ? mirrorSnapshot.data() || {} : {};
      const currentOperations = currentOperationsSnapshot.exists
        ? currentOperationsSnapshot.data() || {}
        : {};
      const operationsSettings = (
        clean(currentOperations.status).toLowerCase() === 'success' &&
        timestampMillis(currentOperations.lastSucceededAt) >= timestampMillis(after.lastSucceededAt)
      ) ? currentOperations : after;
      // 手動一鍵同步會在兩個來源都完成後自行套用；仍寫入可恢復佇列標記，
      // 且 running 只在 TTL 內有效，舊狀態不會永久吃掉後續事件。
      if (unifiedSyncIsActive(mirrorSettings)) {
        await SETTINGS_REF.set({
          unifiedSyncDeferredOperations: true,
          unifiedSyncDeferredOperationsStartDate: clean(operationsSyncRange(operationsSettings) && operationsSyncRange(operationsSettings).startDate),
          unifiedSyncDeferredOperationsEndDate: clean(operationsSyncRange(operationsSettings) && operationsSyncRange(operationsSettings).endDate),
          unifiedSyncDeferredOperationsAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return;
      }
      if (clean(mirrorSettings.unifiedSyncStatus).toLowerCase() === 'running') {
        await SETTINGS_REF.set({
          unifiedSyncStatus: 'stale-recovered',
          unifiedSyncLockUntil: Timestamp.fromMillis(0),
          unifiedSyncRecoveredAt: FieldValue.serverTimestamp(),
          unifiedSyncRecoveredBy: 'operations-success-trigger'
        }, { merge: true });
      }
      const operationsRange = operationsSyncRange(operationsSettings);
      if (!operationsRange) return;
      const payrollResult = await syncOperationsTeacherPayrollRange(
        operationsSettings,
        'operations-success-trigger-teacher-payroll',
        { repair: teacherPayrollRepairPlan(operationsSettings, mirrorSettings) }
      );
      if (clean(payrollResult && payrollResult.status) === 'running') return;
      const refreshRange = intersectDateRanges(operationsSyncRange(operationsSettings), auditInfo);
      if (!refreshRange) {
        console.warn('[applyInjiaoyunEducationMirrorOnOperationsSuccess] latest audit does not cover operations range', {
          operationsRange: operationsSyncRange(operationsSettings),
          auditRange: { startDate: auditInfo.startDate, endDate: auditInfo.endDate }
        });
        // 老師薪資已在上方完整同步；未核對日期只是不建立／停用課表。
        return;
      }
      await syncRecentMirror(
        refreshRange.startDate,
        refreshRange.endDate,
        auditInfo.runId,
        'operations-success-trigger-recent-delta'
      );
    } catch (error) {
      console.error('[applyInjiaoyunEducationMirrorOnOperationsSuccess]', error);
    }
  });

  // 原始抓取完成並切換 lastRunId 後自動套用；沒有新 run 時不會重寫資料。
  exportsObject.applyInjiaoyunEducationMirrorOnMigration = onDocumentWritten({
    document: 'opsSettings/injiaoyunDataMigration',
    region: FUNCTION_REGION,
    timeoutSeconds: 540,
    memory: '2GiB'
  }, async (event) => {
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() || {} : {};
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() || {} : {};
    const beforeRun = clean(before.lastRunId || before.currentRunId);
    const afterRun = clean(after.lastRunId || after.currentRunId);
    if (!afterRun || afterRun === beforeRun) return;
    try {
      await syncLatestMirror('migration-trigger');
    } catch (error) {
      console.error('[applyInjiaoyunEducationMirrorOnMigration]', afterRun, error);
    }
  });

  // 舊日表核對抓取完成後，以該次日期範圍的最終結果覆蓋新版課表。
  exportsObject.applyInjiaoyunEducationMirrorOnAudit = onDocumentWritten({
    document: 'opsInjiaoyunCourseAuditV3Runs/{runId}',
    region: FUNCTION_REGION,
    timeoutSeconds: 540,
    memory: '2GiB'
  }, async (event) => {
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() || {} : {};
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() || {} : {};
    if (clean(after.status).toLowerCase() !== 'success' || clean(before.status).toLowerCase() === 'success') return;
    try {
      const settingsSnapshot = await SETTINGS_REF.get();
      const settings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
      // 手動一鍵同步會自行套用同一批；保留 audit 佇列資訊並使用 TTL，避免 stale running 永久略過。
      if (unifiedSyncIsActive(settings)) {
        await SETTINGS_REF.set({
          unifiedSyncDeferredAudit: true,
          unifiedSyncDeferredAuditRunId: clean(after.runId || event.params.runId),
          unifiedSyncDeferredAuditAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return;
      }
      if (clean(settings.unifiedSyncStatus).toLowerCase() === 'running') {
        await SETTINGS_REF.set({
          unifiedSyncStatus: 'stale-recovered',
          unifiedSyncLockUntil: Timestamp.fromMillis(0),
          unifiedSyncRecoveredAt: FieldValue.serverTimestamp(),
          unifiedSyncRecoveredBy: 'audit-success-trigger'
        }, { merge: true });
      }
      const startDate = dateKey(after.startDate);
      const endDate = dateKey(after.endDate);
      if (startDate && endDate) {
        await syncRecentMirror(startDate, endDate, clean(after.runId || event.params.runId), 'audit-trigger-recent-delta');
      } else {
        await syncLatestMirror('audit-trigger');
      }
    } catch (error) {
      console.error('[applyInjiaoyunEducationMirrorOnAudit]', clean(after.runId || event.params.runId), error);
    }
  });
}

module.exports = {
  MIRROR_TYPES,
  activeSyncOwnerMatches,
  applyOwnedSyncFinalization,
  auditCoversRange,
  auditIsRecent,
  auditRefreshRange,
  convergenceOwnerForState,
  combinedPayrollSyncRange,
  dateKey,
  dateKeysBetween,
  educationDailyCoverage,
  fullConvergenceIsRequired,
  intersectDateRanges,
  mergePreservedAuditAttendance,
  mergeTuitionPlanSnapshot,
  operationsSourceVersion,
  operationsSyncAdvanced,
  operationsSyncRange,
  readMirrorPayload,
  reconcileAuditedAttendance,
  refreshTuitionUsage,
  registerInjiaoyunEducationMirror,
  runAuditForRange,
  sourceHash,
  syncReservationDirective,
  syncOwnerMatches,
  syncOperationsTeacherPayrollRange,
  teacherPayrollRepairPlan,
  syncRecentMirror,
  syncTeacherPayrollRepair,
  syncLatestMirror,
  unifiedSyncIsActive
};
