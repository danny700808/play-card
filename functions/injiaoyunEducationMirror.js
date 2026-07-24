'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const {
  buildPreview,
  latestMigrationRunId
} = require('./injiaoyunEducationPreview');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;
const FUNCTION_REGION = 'us-central1';
const VERSION = '2026.07.24-v1-injiaoyun-education-mirror';
const MANUAL_SYNC_PIN = defineSecret('INJIAOYUN_MANUAL_SYNC_PIN');
const SETTINGS_REF = db.collection('opsSettings').doc('injiaoyunEducationMirror');
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
  tuitionPeriods: 'opsEducationMirrorTuitionPeriods',
  attendance: 'opsEducationMirrorAttendance',
  fixedCourses: 'opsEducationMirrorFixedCourses',
  temporaryCourses: 'opsEducationMirrorTemporaryCourses',
  roomRentals: 'opsEducationMirrorRoomRentals',
  leaveReasons: 'opsEducationMirrorLeaveReasons'
});

function clean(value) {
  return String(value == null ? '' : value).trim();
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

async function reserveSync(runId, trigger) {
  const now = Timestamp.now();
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(SETTINGS_REF);
    const current = snapshot.exists ? snapshot.data() || {} : {};
    const lockUntil = current.lockUntil && typeof current.lockUntil.toMillis === 'function'
      ? current.lockUntil.toMillis()
      : 0;
    if (clean(current.sourceRunId) === runId && clean(current.status) === 'success') {
      return { accepted: false, reason: 'current', current };
    }
    if (clean(current.status) === 'running' && lockUntil > now.toMillis()) {
      return { accepted: false, reason: 'running', current };
    }
    transaction.set(SETTINGS_REF, {
      status: 'running',
      trigger: clean(trigger) || 'automatic',
      pendingRunId: runId,
      startedAt: now,
      lockUntil: Timestamp.fromMillis(now.toMillis() + LOCK_MS),
      lastError: '',
      version: VERSION
    }, { merge: true });
    return { accepted: true };
  });
}

async function syncLatestMirror(trigger = 'automatic') {
  const runId = await latestMigrationRunId();
  if (!runId) throw new Error('找不到已完成的音教雲移轉資料。');
  const reservation = await reserveSync(runId, trigger);
  if (!reservation.accepted) {
    return {
      ok: true,
      status: reservation.reason,
      runId,
      summary: reservation.current && reservation.current.summary || {}
    };
  }

  try {
    const preview = await buildPreview(runId);
    const results = {};
    for (const [type, collectionName] of Object.entries(MIRROR_TYPES)) {
      results[type] = await syncType(type, collectionName, Array.isArray(preview[type]) ? preview[type] : [], runId);
    }
    const summary = Object.values(results).reduce((total, row) => {
      Object.keys(total).forEach((key) => { total[key] += Number(row[key] || 0); });
      return total;
    }, { sourceCount: 0, created: 0, updated: 0, unchanged: 0, missing: 0, deactivated: 0, writes: 0, commits: 0 });
    await SETTINGS_REF.set({
      status: 'success',
      sourceRunId: runId,
      pendingRunId: '',
      completedAt: FieldValue.serverTimestamp(),
      lockUntil: Timestamp.fromMillis(0),
      summary,
      typeResults: results,
      sourceCounts: preview.counts || {},
      dataQuality: preview.dataQuality || {},
      version: VERSION
    }, { merge: true });
    await db.collection('opsEducationSyncRuns').doc(runId).set({
      runId,
      status: 'success',
      trigger: clean(trigger) || 'automatic',
      summary,
      typeResults: results,
      completedAt: FieldValue.serverTimestamp(),
      version: VERSION
    }, { merge: true });
    return { ok: true, status: 'success', runId, summary, typeResults: results };
  } catch (error) {
    const message = clean(error && error.message || error).slice(0, 1000);
    await SETTINGS_REF.set({
      status: 'error',
      pendingRunId: '',
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
      completedAt: settings.completedAt || null,
      summary: settings.summary || {}
    }
  };
  Object.keys(MIRROR_TYPES).forEach((type, index) => {
    payload[type] = snapshots[index].docs.map((doc) => jsonValue((doc.data() || {}).source)).filter(Boolean);
  });
  return payload;
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
    try {
      return await syncLatestMirror('manual-course-scheduler');
    } catch (error) {
      console.error('[syncInjiaoyunEducationMirrorNow]', error);
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
      const latestRunId = await latestMigrationRunId();
      const settingsSnapshot = await SETTINGS_REF.get();
      const settings = settingsSnapshot.exists ? settingsSnapshot.data() || {} : {};
      if (latestRunId && clean(settings.sourceRunId) !== latestRunId) {
        await syncLatestMirror('load-latest');
      }
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
}

module.exports = {
  MIRROR_TYPES,
  readMirrorPayload,
  registerInjiaoyunEducationMirror,
  sourceHash,
  syncLatestMirror
};
