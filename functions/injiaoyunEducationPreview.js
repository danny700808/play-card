'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const zlib = require('node:zlib');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FUNCTION_REGION = 'us-central1';
const COLLECTION_PREFIX = 'opsInjiaoyunTest';
const VERSION = '2026.07.22-v1-education-readonly-preview';
const MANUAL_SYNC_PIN = defineSecret('INJIAOYUN_MANUAL_SYNC_PIN');
const ALLOWED_ORIGINS = new Set([
  'https://danny700808.github.io',
  'https://www.mingtinghuang.com',
  'https://mingtinghuang.com'
]);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

// 僅限排課／教務；刻意沒有商品、庫存、銷售、進貨與供應商集合。
const EDUCATION_COLLECTIONS = Object.freeze({
  students: { suffix: 'Students', limit: 1200 },
  studentPayments: { suffix: 'StudentPayments', limit: 1200 },
  studentPaymentsOpen: { suffix: 'StudentPaymentsOpen', limit: 1200 },
  teachers: { suffix: 'Teachers', limit: 200 },
  rooms: { suffix: 'Rooms', limit: 200 },
  subjects: { suffix: 'Subjects', limit: 300 },
  charges: { suffix: 'Charges', limit: 500 },
  fixedCourses: { suffix: 'FixedCourses', limit: 800 },
  temporaryCourses: { suffix: 'TemporaryCourses', limit: 800 },
  leaves: { suffix: 'Leaves', limit: 1000 },
  leaveReasons: { suffix: 'LeaveReasons', limit: 100 },
  teacherRewards: { suffix: 'TeacherRewards', limit: 1000 },
  teacherDeductions: { suffix: 'TeacherDeductions', limit: 1000 },
  roomRentals: { suffix: 'RoomRentals', limit: 500 }
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
  if (source === 'course-scheduler-preview' && (ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin))) return;
  throw new HttpsError('permission-denied', '只允許從新版課程日表讀取課務預覽。');
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

function idOf(value) {
  if (value && typeof value === 'object') return clean(value._id || value.id || value.sourceId);
  return clean(value);
}

function nameOf(value) {
  if (value && typeof value === 'object') return clean(value.name || value.real_name || value.title || value.label);
  return '';
}

function numberOf(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value) {
  const text = clean(value);
  const direct = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function timeKey(value) {
  const text = clean(value);
  if (/^\d{1,2}:\d{2}/.test(text)) {
    const [hour, minute] = text.split(':');
    return `${String(Number(hour)).padStart(2, '0')}:${String(Number(minute)).padStart(2, '0')}`;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function durationMinutes(startsAt, endsAt) {
  const start = timeKey(startsAt);
  const end = timeKey(endsAt);
  if (!start || !end) return 60;
  const toMinutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  let duration = toMinutes(end) - toMinutes(start);
  if (duration <= 0) duration += 24 * 60;
  return Math.max(30, Math.min(8 * 60, Math.round(duration / 30) * 30));
}

function frequencyWeeks(value) {
  const text = clean(value).toLowerCase();
  if (/隔週|雙週|biweekly|every\s*2|^2$/.test(text)) return 2;
  const parsed = Number(text);
  if (Number.isFinite(parsed) && parsed >= 2) return 2;
  return 1;
}

function sourceBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value.toBuffer === 'function') return value.toBuffer();
  if (typeof value.toUint8Array === 'function') return Buffer.from(value.toUint8Array());
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

async function decodeSource(row) {
  if (!row || typeof row !== 'object') return {};
  try {
    let compressed = sourceBuffer(row.sourceGzip);
    if (!compressed && row.sourceEncoding === 'gzip-json-cloud-storage' && row.sourceBucket && row.sourceObject) {
      const result = await admin.storage().bucket(clean(row.sourceBucket)).file(clean(row.sourceObject)).download();
      compressed = result && result[0];
    }
    if (compressed) return JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  } catch (error) {
    console.warn('[injiaoyunEducationPreview decode]', clean(row.sourceId), clean(error && error.message));
  }
  return row.normalized && typeof row.normalized === 'object' ? row.normalized : {};
}

async function mapLimit(rows, limit, mapper) {
  const output = new Array(rows.length);
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await mapper(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length || 1) }, worker));
  return output;
}

async function latestMigrationRunId() {
  const settings = await db.collection('opsSettings').doc('injiaoyunDataMigration').get();
  const row = settings.exists ? settings.data() || {} : {};
  const preferred = clean(row.lastRunId || row.currentRunId);
  if (preferred) return preferred;
  const snapshot = await db.collection('opsInjiaoyunMigrationRuns')
    .orderBy(admin.firestore.FieldPath.documentId(), 'desc').limit(1).get();
  return snapshot.empty ? '' : snapshot.docs[0].id;
}

async function readCollection(config, runId) {
  const name = `${COLLECTION_PREFIX}${config.suffix}`;
  const snapshot = await db.collection(name).where('migrationRunId', '==', runId).limit(config.limit).get();
  const decoded = await mapLimit(snapshot.docs, 16, async (doc) => decodeSource(doc.data() || {}));
  return decoded.filter((row) => row && typeof row === 'object');
}

function mapById(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const id = idOf(row);
    if (id) map.set(id, row);
  });
  return map;
}

function referenceName(value, lookup, fallback) {
  const direct = nameOf(value);
  if (direct) return direct;
  const linked = lookup.get(idOf(value));
  return nameOf(linked) || clean(fallback);
}

function paymentCheckinCount(payment) {
  const rows = Array.isArray(payment && payment.checkins) ? payment.checkins : [];
  return rows.filter((row) => {
    if (typeof row !== 'object') return true;
    return row.cancel !== true && row.leave !== true && row.sleave !== true && row.tleave !== true;
  }).length;
}

function statusForCheckin(row) {
  if (!row || typeof row !== 'object') return 'attended';
  if (row.leave === true || row.sleave === true || row.tleave === true || row.cancel === true) return 'leave';
  if (row.skip === true) return 'absent';
  return 'attended';
}

function courseStatusMap(course, leaveRows) {
  const result = {};
  (Array.isArray(course.checkins) ? course.checkins : []).forEach((checkin) => {
    const key = dateKey(checkin && checkin.date);
    if (key) result[key] = statusForCheckin(checkin);
  });
  leaveRows.forEach((leave) => {
    const key = dateKey(leave && leave.date);
    if (key && leave.cancel !== true) result[key] = 'leave';
  });
  return result;
}

function courseRow(row, type, lookups, leavesByCourse) {
  const students = Array.isArray(row.students) ? row.students : [];
  const studentIds = students.map(idOf).filter(Boolean);
  const studentNames = students.map((student) => referenceName(student, lookups.students, '')).filter(Boolean);
  const teacherId = idOf(row.teacher);
  const subjectId = idOf(row.subject);
  const roomId = idOf(row.room);
  const id = idOf(row) || `${type}_${roomId}_${clean(row.startDate)}_${clean(row.startsAt)}`;
  return {
    id,
    type,
    active: row.end !== true && row.off !== true,
    date: dateKey(row.startDate || row.date),
    start: timeKey(row.startsAt),
    duration: durationMinutes(row.startsAt, row.endsAt),
    frequencyWeeks: type === 'fixed' ? frequencyWeeks(row.frequency) : 0,
    frequency: clean(row.frequency),
    roomId,
    roomName: referenceName(row.room, lookups.rooms, ''),
    studentIds,
    studentNames,
    teacherId,
    teacherName: referenceName(row.teacher, lookups.teachers, ''),
    subjectId,
    subjectName: referenceName(row.subject, lookups.subjects, ''),
    statusByDate: courseStatusMap(row, leavesByCourse.get(id) || []),
    note: clean(row.remark || row.note),
    source: 'injiaoyun-migration'
  };
}

function paymentSummary(payment) {
  const charge = payment && payment.chargeType && typeof payment.chargeType === 'object' ? payment.chargeType : {};
  const lessonCount = Math.max(0, Math.round(numberOf(charge.courseNumber)));
  const used = paymentCheckinCount(payment);
  const tuition = Math.max(0, numberOf(charge.money));
  return {
    id: idOf(payment),
    studentId: idOf(payment && payment.student),
    subjectId: idOf(payment && payment.subject || charge.subject),
    subjectName: nameOf(payment && payment.subject || charge.subject),
    chargeName: clean(charge.name),
    lessonCount,
    used,
    remaining: Math.max(0, lessonCount - used),
    tuition,
    paid: payment && payment.revenue === false ? 0 : tuition,
    updated: clean(payment && (payment.updated || payment.created))
  };
}

function newestByStudent(payments) {
  const map = new Map();
  payments.forEach((payment) => {
    if (!payment.studentId) return;
    const previous = map.get(payment.studentId);
    if (!previous || clean(payment.updated) >= clean(previous.updated)) map.set(payment.studentId, payment);
  });
  return map;
}

function fallbackRooms(courseRows) {
  const names = [
    '團練室（傳統鼓）', '展演空間（電子鼓）', '鼓教室（電子鼓）', '5號鋼琴＆表演教室',
    'YAMAHA 平台鋼琴教室', 'YAMAHA 直立鋼琴教室', 'KAWAI 直立鋼琴教室', '吉他教室', '錄音室', '不定時'
  ];
  const ids = [...new Set(courseRows.map((row) => row.roomId).filter(Boolean))];
  return ids.map((id, index) => ({ id, name: names[index] || `教室 ${index + 1}`, note: '' }));
}

async function buildPreview(runId) {
  const entries = await Promise.all(Object.entries(EDUCATION_COLLECTIONS).map(async ([key, config]) => (
    [key, await readCollection(config, runId)]
  )));
  const data = Object.fromEntries(entries);
  const lookups = {
    students: mapById(data.students), teachers: mapById(data.teachers),
    rooms: mapById(data.rooms), subjects: mapById(data.subjects)
  };
  const leavesByCourse = new Map();
  data.leaves.forEach((leave) => {
    const courseId = idOf(leave.fixCourse || leave.tempCourse || leave.course);
    if (!courseId) return;
    if (!leavesByCourse.has(courseId)) leavesByCourse.set(courseId, []);
    leavesByCourse.get(courseId).push(leave);
  });
  const fixedCourses = data.fixedCourses.map((row) => courseRow(row, 'fixed', lookups, leavesByCourse));
  const temporaryCourses = data.temporaryCourses.map((row) => {
    const checkins = Array.isArray(row.checkins) ? row.checkins : [];
    const isTrial = row.test === true || row.fromTest === true || checkins.some((checkin) => checkin && checkin.fromTest === true);
    return courseRow(row, isTrial ? 'trial' : 'single', lookups, leavesByCourse);
  });
  const allCourses = fixedCourses.concat(temporaryCourses);
  let rooms = data.rooms.map((row) => ({ id: idOf(row), name: nameOf(row) || clean(row.remark), note: clean(row.remark) }))
    .filter((row) => row.id);
  if (!rooms.length) rooms = fallbackRooms(allCourses);
  const roomNameMap = new Map(rooms.map((row) => [row.id, row.name]));
  allCourses.forEach((row) => { if (!row.roomName) row.roomName = roomNameMap.get(row.roomId) || ''; });

  const openPayments = data.studentPaymentsOpen.map(paymentSummary);
  const currentPayment = newestByStudent(data.studentPayments.map(paymentSummary).concat(openPayments));
  const courseByStudent = new Map();
  allCourses.forEach((course) => course.studentIds.forEach((studentId) => {
    if (!courseByStudent.has(studentId) || course.active) courseByStudent.set(studentId, course);
  }));
  const students = data.students.map((row) => {
    const id = idOf(row);
    const payment = currentPayment.get(id) || {};
    const course = courseByStudent.get(id) || {};
    return {
      id,
      name: nameOf(row) || '未命名學生',
      phone: clean(row.phone),
      line: null,
      active: row.end !== true,
      subject: course.subjectName || payment.subjectName || referenceName(payment.subjectId, lookups.subjects, ''),
      teacher: course.teacherName || '',
      remaining: numberOf(payment.remaining),
      tuition: numberOf(payment.tuition),
      paid: numberOf(payment.paid),
      expiry: '',
      note: clean(row.remark)
    };
  });

  const rewards = new Map();
  data.teacherRewards.forEach((row) => rewards.set(idOf(row.teacher), (rewards.get(idOf(row.teacher)) || 0) + numberOf(row.money)));
  const deductions = new Map();
  data.teacherDeductions.forEach((row) => deductions.set(idOf(row.teacher), (deductions.get(idOf(row.teacher)) || 0) + numberOf(row.money)));
  const teachers = data.teachers.map((row) => ({
    id: idOf(row), name: nameOf(row) || '未命名老師', phone: clean(row.phone),
    subjects: (Array.isArray(row.subjects) ? row.subjects : []).map((subject) => referenceName(subject, lookups.subjects, '')).filter(Boolean),
    reward: rewards.get(idOf(row)) || 0, deduction: deductions.get(idOf(row)) || 0,
    active: row.off !== true, note: clean(row.remark)
  }));

  const subjects = data.subjects.map(nameOf).filter(Boolean);
  const charges = data.charges.map((row) => ({
    id: idOf(row), subject: referenceName(row.subject, lookups.subjects, ''), name: clean(row.name),
    lessons: numberOf(row.courseNumber), tuition: numberOf(row.money), allot: numberOf(row.allot)
  }));
  const roomRentals = data.roomRentals.map((row) => ({
    id: idOf(row), type: 'rental', date: dateKey(row.startDate), start: timeKey(row.startsAt),
    duration: durationMinutes(row.startsAt, row.endsAt), roomId: idOf(row.room),
    roomName: referenceName(row.room, lookups.rooms, roomNameMap.get(idOf(row.room)) || ''),
    clientName: referenceName(row.client, new Map(), nameOf(row.client)), amount: numberOf(row.money),
    status: row.alreadyCheckin === true ? 'attended' : 'scheduled', note: clean(row.remark)
  }));

  return {
    ok: true, readOnly: true, runId, version: VERSION,
    loadedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])),
    rooms, subjects, charges, students, teachers, fixedCourses, temporaryCourses,
    roomRentals, leaveReasons: data.leaveReasons.map(nameOf).filter(Boolean)
  };
}

function registerInjiaoyunEducationPreview(exportsObject) {
  exportsObject.loadInjiaoyunEducationPreview = onCall({
    region: FUNCTION_REGION,
    timeoutSeconds: 180,
    memory: '1GiB',
    cors: [...ALLOWED_ORIGINS, LOCAL_ORIGIN],
    secrets: [MANUAL_SYNC_PIN]
  }, async (request) => {
    assertAllowedCaller(request);
    assertManualPin(request);
    const runId = await latestMigrationRunId();
    if (!runId) throw new HttpsError('not-found', '找不到已完成的音教雲移轉資料。');
    try {
      return await buildPreview(runId);
    } catch (error) {
      console.error('[loadInjiaoyunEducationPreview]', runId, error);
      throw new HttpsError('internal', `課務預覽讀取失敗：${clean(error && error.message).slice(0, 300)}`);
    }
  });
}

module.exports = {
  registerInjiaoyunEducationPreview,
  EDUCATION_COLLECTIONS,
  courseRow,
  dateKey,
  durationMinutes,
  frequencyWeeks,
  paymentSummary,
  timeKey
};
