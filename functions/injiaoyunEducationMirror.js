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
const VERSION = '2026.07.28-v8-scoped-recent-delta-sync';
const MANUAL_SYNC_PIN = defineSecret('INJIAOYUN_MANUAL_SYNC_PIN');
const SETTINGS_REF = db.collection('opsSettings').doc('injiaoyunEducationMirror');
const OPERATIONS_SYNC_REF = db.collection('opsSettings').doc('injiaoyunCloudSync');
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

async function commitOperations(operations) {
  let commits = 0;
  for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    operations.slice(offset, offset + BATCH_SIZE).forEach((operation) => {
      batch.set(operation.ref, operation.data, { merge: true });
    });
    await batch.commit();
    commits += 1;
  }
  return commits;
}

async function syncType(type, collectionName, rows, runId) {
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
    const hash = sourceHash(source);
    const prior = existing.get(id);
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

  const commits = await commitOperations(operations);
  return { sourceCount: rows.length, created, updated, unchanged, missing, deactivated, writes: operations.length, commits };
}

// 日表核對每次只抓指定日期範圍；範圍外的歷史事件要保留，範圍內則以本次舊系統結果完整覆蓋。
async function syncScopedEvents(collectionName, rows, auditRunId, coveredDates) {
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

  const commits = await commitOperations(operations);
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
  const dates = [...new Set((coveredDates || []).map(dateKey).filter(Boolean))].slice(0, 30);
  if (!dates.length) {
    throw new Error(`近期同步缺少 ${collectionName} 的日期範圍。`);
  }
  try {
    return await db.collection(collectionName).where('source.date', 'in', dates).get();
  } catch (error) {
    // 舊集合若尚未建立欄位索引，退回一次完整讀取；仍只會寫入指定日期。
    console.warn('[snapshotForDates fallback]', collectionName, clean(error && error.message));
    return db.collection(collectionName).get();
  }
}

async function syncRowsFromSnapshot(type, collectionName, rows, runId, snapshot, options = {}) {
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
    const hash = sourceHash(source);
    const prior = existing.get(id);
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

  const commits = await commitOperations(operations);
  return { sourceCount: rows.length, created, updated, unchanged, missing, deactivated, writes: operations.length, commits };
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
  const [migrationRunId, auditInfo, operationsSnapshot] = await Promise.all([
    latestMigrationRunId(),
    preferredAuditRunId
      ? Promise.resolve({ runId: clean(preferredAuditRunId) })
      : latestAuditRunInfo(),
    OPERATIONS_SYNC_REF.get()
  ]);
  if (!migrationRunId) throw new Error('找不到已完成的音教雲歷史資料。');
  if (!auditInfo.runId) throw new Error('找不到最新的音教雲日表核對資料。');
  const operationsSettings = operationsSnapshot.exists ? operationsSnapshot.data() || {} : {};
  const operationsVersion = `${clean(operationsSettings.lastEndDateKey)}:${timestampMillis(operationsSettings.lastSucceededAt)}`;
  const sourceVersion = `${migrationRunId}|${auditInfo.runId}|${operationsVersion}|${VERSION}|${EDUCATION_PREVIEW_VERSION}`;
  const reservation = await reserveSync(sourceVersion, trigger);
  if (!reservation.accepted) {
    return {
      ok: true,
      status: reservation.reason,
      runId: migrationRunId,
      auditRunId: auditInfo.runId,
      summary: reservation.current && reservation.current.summary || {}
    };
  }

  try {
    const audit = await latestAuditSchedule(auditInfo.runId);
    if (!audit.runId) throw new Error('音教雲近期日表核對資料讀取失敗。');
    const coveredDates = audit.coveredDates.filter((date) => date >= selectedStartDate && date <= selectedEndDate);
    if (!coveredDates.length) throw new Error('近期核對結果沒有涵蓋所選日期。');
    const [
      dailyRows,
      periodSnapshot,
      attendanceSnapshot,
      roomSnapshot,
      payrollSnapshot,
      rentalSnapshot,
      eventSnapshot
    ] = await Promise.all([
      readEducationDaily(coveredDates),
      db.collection(MIRROR_TYPES.tuitionPeriods).get(),
      snapshotForDates(MIRROR_TYPES.attendance, coveredDates),
      db.collection(MIRROR_TYPES.rooms).get(),
      snapshotForDates(MIRROR_TYPES.teacherPayroll, coveredDates),
      snapshotForDates(MIRROR_TYPES.roomRentals, coveredDates),
      snapshotForDates(MIRROR_TYPES.events, coveredDates)
    ]);
    const covered = new Set(coveredDates);
    const scopedDaily = dailyRows.filter((row) => {
      const day = dateKey(row && (row.dateKey || row._id));
      return day && covered.has(day);
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
      { initialUsedByPeriod }
    );
    refreshTuitionUsage(periods, reconciledAttendance, initialUsedByPeriod);
    const recentAttendance = reconciledAttendance.filter((row) => covered.has(dateKey(row.date)));
    const recentPayroll = buildTeacherPayroll(scopedDaily).filter((row) => covered.has(dateKey(row.date)));
    const recentRentals = [];
    const rentalResult = mergeEducationDailyRentals(recentRentals, scopedDaily, { rows: rooms });
    const recentEvents = (Array.isArray(audit.events) ? audit.events : [])
      .filter((row) => covered.has(dateKey(row.date)));

    const results = {
      tuitionPeriods: await syncRowsFromSnapshot(
        'tuitionPeriods',
        MIRROR_TYPES.tuitionPeriods,
        periods,
        migrationRunId,
        periodSnapshot
      ),
      attendance: await syncRowsFromSnapshot(
        'attendance',
        MIRROR_TYPES.attendance,
        recentAttendance,
        audit.runId,
        attendanceSnapshot,
        { coveredDates, deactivateMissing: true }
      ),
      teacherPayroll: await syncRowsFromSnapshot(
        'teacherPayroll',
        MIRROR_TYPES.teacherPayroll,
        recentPayroll,
        audit.runId,
        payrollSnapshot,
        { coveredDates, deactivateMissing: true }
      ),
      roomRentals: await syncRowsFromSnapshot(
        'roomRentals',
        MIRROR_TYPES.roomRentals,
        recentRentals,
        audit.runId,
        rentalSnapshot,
        { coveredDates, deactivateMissing: false }
      ),
      events: await syncRowsFromSnapshot(
        'events',
        MIRROR_TYPES.events,
        recentEvents,
        audit.runId,
        eventSnapshot,
        { coveredDates, deactivateMissing: true }
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
      recentReceiptCount: receiptResult.total,
      recentReceiptLinkedCount: receiptResult.linked,
      recentReceiptUpdatedCount: receiptResult.updated,
      recentReceiptUnmatchedCount: receiptResult.unmatched,
      recentReceiptCreatedPeriodCount: receiptResult.createdPeriods,
      recentRentalCount: rentalResult.total,
      recentRentalLinkedCount: rentalResult.linked,
      recentRentalUnmatchedCount: rentalResult.unmatched
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
    await SETTINGS_REF.set({
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
    }, { merge: true });
    await db.collection('opsEducationSyncRuns').doc(documentId('syncRun', sourceVersion)).set({
      runId: migrationRunId,
      auditRunId: audit.runId,
      sourceVersion,
      status: 'success',
      trigger: clean(trigger) || 'manual-recent-delta',
      refreshStartDate: selectedStartDate,
      refreshEndDate: selectedEndDate,
      summary,
      typeResults: results,
      completedAt: FieldValue.serverTimestamp(),
      version: VERSION
    }, { merge: true });
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
    await SETTINGS_REF.set({
      status: 'error',
      pendingRunId: '',
      pendingSourceVersion: '',
      failedAt: FieldValue.serverTimestamp(),
      lockUntil: Timestamp.fromMillis(0),
      lastError: message,
      version: VERSION
    }, { merge: true });
    throw error;
  }
}

async function reserveSync(sourceVersion, trigger) {
  const now = Timestamp.now();
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(SETTINGS_REF);
    const current = snapshot.exists ? snapshot.data() || {} : {};
    const lockUntil = current.lockUntil && typeof current.lockUntil.toMillis === 'function'
      ? current.lockUntil.toMillis()
      : 0;
    if (clean(current.sourceVersion) === sourceVersion && clean(current.status) === 'success') {
      return { accepted: false, reason: 'current', current };
    }
    if (clean(current.status) === 'running' && lockUntil > now.toMillis()) {
      return { accepted: false, reason: 'running', current };
    }
    transaction.set(SETTINGS_REF, {
      status: 'running',
      trigger: clean(trigger) || 'automatic',
      pendingSourceVersion: sourceVersion,
      startedAt: now,
      lockUntil: Timestamp.fromMillis(now.toMillis() + LOCK_MS),
      lastError: '',
      version: VERSION
    }, { merge: true });
    return { accepted: true, current };
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
  const operationsVersion = `${clean(operationsSettings.lastEndDateKey)}:${timestampMillis(operationsSettings.lastSucceededAt)}`;
  const sourceVersion = `${migrationRunId}|${auditInfo.runId}|${operationsVersion}|${VERSION}|${EDUCATION_PREVIEW_VERSION}`;
  const reservation = await reserveSync(sourceVersion, trigger);
  if (!reservation.accepted) {
    return {
      ok: true,
      status: reservation.reason,
      runId: migrationRunId,
      auditRunId: auditInfo.runId,
      summary: reservation.current && reservation.current.summary || {}
    };
  }

  try {
    // 只有來源版本真的改變時才讀取完整 audit 子集合，避免每次開頁都重抓全部歷史資料。
    const [preview, audit] = await Promise.all([
      buildPreview(migrationRunId),
      latestAuditSchedule(auditInfo.runId)
    ]);
    if (!audit.runId) throw new Error('音教雲舊日表核對資料讀取失敗。');
    const reconciledAttendance = reconcileAuditedAttendance(
      Array.isArray(preview.attendance) ? preview.attendance : [],
      Array.isArray(audit.attendance) ? audit.attendance : [],
      Array.isArray(preview.tuitionPeriods) ? preview.tuitionPeriods : [],
      audit.coveredDates
    );
    const results = {};
    for (const [type, collectionName] of Object.entries(MIRROR_TYPES)) {
      if (type === 'events') {
        results[type] = await syncScopedEvents(collectionName, audit.events, audit.runId, audit.coveredDates);
      } else {
        results[type] = await syncType(
          type,
          collectionName,
          type === 'attendance' ? reconciledAttendance : (Array.isArray(preview[type]) ? preview[type] : []),
          migrationRunId
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
    await SETTINGS_REF.set({
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
    }, { merge: true });
    await db.collection('opsEducationSyncRuns').doc(documentId('syncRun', sourceVersion)).set({
      runId: migrationRunId,
      auditRunId: audit.runId,
      sourceVersion,
      status: 'success',
      trigger: clean(trigger) || 'automatic',
      summary,
      typeResults: results,
      completedAt: FieldValue.serverTimestamp(),
      version: VERSION
    }, { merge: true });
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
    await SETTINGS_REF.set({
      status: 'error',
      pendingRunId: '',
      pendingSourceVersion: '',
      failedAt: FieldValue.serverTimestamp(),
      lockUntil: Timestamp.fromMillis(0),
      lastError: message,
      version: VERSION
    }, { merge: true });
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
        unifiedSyncLastError: '',
        version: VERSION
      }, { merge: true });

      // 營運資料與課表核對彼此獨立，平行執行可大幅縮短等待時間。
      const [operationsSync, freshAudit] = await Promise.all([
        ensureInjiaoyunOperationsSync(refreshDate),
        (async () => {
          await runAuditForRange(refreshRange.startDate, refreshRange.endDate);
          return waitForFreshAudit(
            before.runId,
            refreshRange.startDate,
            refreshRange.endDate
          );
        })()
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
      // 手動一鍵同步會在核對完成後自行做近期差異套用；觸發器不可再搶先啟動第二批。
      if (clean(settings.unifiedSyncStatus).toLowerCase() === 'running') return;
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
  auditRefreshRange,
  dateKey,
  readMirrorPayload,
  reconcileAuditedAttendance,
  refreshTuitionUsage,
  registerInjiaoyunEducationMirror,
  runAuditForRange,
  sourceHash,
  syncRecentMirror,
  syncLatestMirror
};
