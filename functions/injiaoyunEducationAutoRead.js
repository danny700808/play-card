'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const REGION = 'us-central1';
const VERSION = '2026.07.29-auto-read-v2';
const SETTINGS_REF = db.collection('opsSettings').doc('injiaoyunEducationMirror');
const ALLOWED_ORIGINS = new Set([
  'https://danny700808.github.io',
  'https://www.mingtinghuang.com',
  'https://mingtinghuang.com'
]);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
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

function requestOrigin(request) {
  const headers = request && request.rawRequest && request.rawRequest.headers || {};
  const direct = clean(headers.origin).toLowerCase().replace(/\/$/, '');
  if (direct) return direct;
  const referer = clean(headers.referer || headers.referrer);
  if (!referer) return '';
  try { return new URL(referer).origin.toLowerCase().replace(/\/$/, ''); }
  catch (_) { return ''; }
}

function assertAllowedRead(request) {
  const source = clean(request && request.data && request.data.source).toLowerCase();
  const origin = requestOrigin(request);
  const validSource = ['course-scheduler', 'operations-hub', 'portal'].includes(source);
  if (validSource && (ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin))) return;
  throw new HttpsError('permission-denied', '只允許從柚子樂器課務系統讀取已同步資料。');
}

function jsonValue(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'object') {
    const result = {};
    Object.keys(value).forEach((key) => {
      if (!key.startsWith('__')) result[key] = jsonValue(value[key]);
    });
    return result;
  }
  return value;
}

async function readActiveSources(collectionName) {
  const collection = db.collection(collectionName);
  let documents = [];
  try {
    const activeSnapshot = await collection.where('sourceActive', '==', true).get();
    documents = activeSnapshot.docs;
  } catch (error) {
    console.warn('[course auto read active query fallback]', collectionName, clean(error && error.message));
  }
  if (!documents.length) {
    const allSnapshot = await collection.get();
    documents = allSnapshot.docs.filter((doc) => (doc.data() || {}).sourceActive !== false);
  }
  return documents
    .map((doc) => jsonValue((doc.data() || {}).source))
    .filter((source) => source && typeof source === 'object');
}

function hasUsableCourseData(payload) {
  const scheduleCount = ['fixedCourses', 'temporaryCourses', 'events', 'roomRentals']
    .reduce((total, key) => total + (Array.isArray(payload[key]) ? payload[key].length : 0), 0);
  const directoryCount = ['rooms', 'students', 'teachers']
    .reduce((total, key) => total + (Array.isArray(payload[key]) ? payload[key].length : 0), 0);
  return scheduleCount > 0 && directoryCount > 0;
}

async function readMirrorPayload() {
  const [settingsSnapshot, ...rows] = await Promise.all([
    SETTINGS_REF.get(),
    ...Object.values(MIRROR_TYPES).map(readActiveSources)
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
      status: clean(settings.status) || 'legacy-data',
      auditRunId: clean(settings.auditRunId),
      completedAt: jsonValue(settings.completedAt || null),
      summary: jsonValue(settings.summary || {})
    }
  };
  Object.keys(MIRROR_TYPES).forEach((type, index) => {
    payload[type] = rows[index] || [];
  });
  const { appendCoursePortalData } = require('./coursePortal');
  const merged = await appendCoursePortalData(payload);
  if (!hasUsableCourseData(merged)) {
    throw new HttpsError('failed-precondition', '雲端尚未找到可顯示的課表資料；請確認舊系統課表抓取是否已完成。');
  }
  return merged;
}

function registerInjiaoyunEducationAutoRead(exportsObject) {
  if (!exportsObject || exportsObject.loadInjiaoyunEducationMirrorAuto) return;
  exportsObject.loadInjiaoyunEducationMirrorAuto = onCall({
    region: REGION,
    timeoutSeconds: 300,
    memory: '2GiB',
    cors: [...ALLOWED_ORIGINS, LOCAL_ORIGIN]
  }, async (request) => {
    assertAllowedRead(request);
    try {
      return await readMirrorPayload();
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('[loadInjiaoyunEducationMirrorAuto]', error);
      throw new HttpsError('internal', `自動讀取課務資料失敗：${clean(error && error.message).slice(0, 300)}`);
    }
  });
}

module.exports = {
  registerInjiaoyunEducationAutoRead
};
