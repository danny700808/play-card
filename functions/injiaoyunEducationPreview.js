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
const AUDIT_RUNS_COLLECTION = 'opsInjiaoyunCourseAuditV3Runs';
const VERSION = '2026.07.24-v9-fixed-course-date-boundary';
const MANUAL_SYNC_PIN = defineSecret('INJIAOYUN_MANUAL_SYNC_PIN');
const ALLOWED_ORIGINS = new Set([
  'https://danny700808.github.io',
  'https://www.mingtinghuang.com',
  'https://mingtinghuang.com'
]);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

// 僅讀排課、學生、學費、師資與教室資料。刻意排除商品、庫存、銷售、進貨與供應商。
const EDUCATION_COLLECTIONS = Object.freeze({
  students: { suffix: 'Students', limit: 2000 },
  studentDetails: { suffix: 'StudentDetails', limit: 2000 },
  studentCourses: { suffix: 'StudentCourses', limit: 5000 },
  studentPayments: { suffix: 'StudentPayments', limit: 3000 },
  studentPaymentsAll: { suffix: 'StudentPaymentsAll', limit: 3000 },
  studentPaymentsOpen: { suffix: 'StudentPaymentsOpen', limit: 3000 },
  studentPaymentDetails: { suffix: 'StudentPaymentDetails', limit: 5000 },
  teachers: { suffix: 'Teachers', limit: 500 },
  rooms: { suffix: 'Rooms', limit: 500 },
  subjects: { suffix: 'Subjects', limit: 500 },
  subjectTypes: { suffix: 'SubjectTypes', limit: 500 },
  charges: { suffix: 'Charges', limit: 1000 },
  fixedCourses: { suffix: 'FixedCourses', limit: 3000 },
  temporaryCourses: { suffix: 'TemporaryCourses', limit: 3000 },
  leaves: { suffix: 'Leaves', limit: 5000 },
  leaveReasons: { suffix: 'LeaveReasons', limit: 500 },
  checkinLeaves: { suffix: 'CheckinLeaves', limit: 5000 },
  checkinSkips: { suffix: 'CheckinSkips', limit: 5000 },
  teacherRewards: { suffix: 'TeacherRewards', limit: 3000 },
  teacherDeductions: { suffix: 'TeacherDeductions', limit: 3000 },
  roomRentals: { suffix: 'RoomRentals', limit: 3000 },
  roomRentalsAll: { suffix: 'RoomRentalsAll', limit: 5000 },
  roomRentalCards: { suffix: 'RoomRentalCards', limit: 2000 },
  roomRentalCardSpecs: { suffix: 'RoomRentalCardSpecs', limit: 1000 }
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function firstValue(...values) {
  return values.find((value) => (
    value !== undefined &&
    value !== null &&
    (typeof value !== 'string' || value.trim() !== '')
  ));
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
  if (value && typeof value === 'object') {
    return clean(firstValue(value._id, value.id, value.sourceId, value._migrationSourceId, value.value));
  }
  return clean(value);
}

function nameOf(value) {
  if (value && typeof value === 'object') {
    return clean(firstValue(value.name, value.real_name, value.fullName, value.title, value.label, value.subjectName));
  }
  return typeof value === 'string' && !/^[a-f0-9]{20,32}$/i.test(value) ? clean(value) : '';
}

function numberOf(value) {
  if (typeof value === 'string') value = value.replace(/[$,\s]/g, '');
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanOf(value, fallback) {
  if (value === true || value === false) return value;
  const text = clean(value).toLowerCase();
  if (['true', '1', 'yes', 'on', '是', '啟用', '上架'].includes(text)) return true;
  if (['false', '0', 'no', 'off', '否', '停用', '下架'].includes(text)) return false;
  return fallback;
}

function unique(values) {
  return [...new Set(array(values).map(idOf).filter(Boolean))];
}

function dateKey(value) {
  if (value && typeof value === 'object') {
    if (typeof value.toDate === 'function') value = value.toDate();
    else value = firstValue(value.date, value.startDate, value.created, value.updated, value.value);
  }
  const text = clean(value);
  let direct = text.match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)/);
  if (direct) return `${direct[1]}-${String(Number(direct[2])).padStart(2, '0')}-${String(Number(direct[3])).padStart(2, '0')}`;
  direct = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function timeKey(value) {
  if (value && typeof value === 'object') {
    if (typeof value.toDate === 'function') value = value.toDate();
    else if (Number.isFinite(Number(firstValue(value.seconds, value._seconds)))) {
      value = new Date(Number(firstValue(value.seconds, value._seconds)) * 1000);
    }
    else if (value.hour !== undefined) {
      value = `${value.hour}:${value.minute === undefined ? '00' : value.minute}`;
    }
    else value = firstValue(
      value.time, value.start, value.startsAt, value.startTime,
      value.date, value.datetime, value.timestamp, value.iso, value.$date, value.value
    );
  }
  const formatDate = (date) => new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date).replace(/^24:/, '00:');
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? formatDate(value) : '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 1e12) return formatDate(new Date(value));
    if (value >= 1e9) return formatDate(new Date(value * 1000));
    if (value >= 0 && value < 24) {
      const hour = Math.floor(value);
      const minute = Math.round((value - hour) * 60);
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }
  let text = clean(value)
    .replace(/[：︰]/g, ':')
    .replace(/[時时點点]/g, ':')
    .replace(/分/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';

  // 只有日期、沒有時間時視為未辨識；否則 Date 會自行補成午夜，造成另一種假課表。
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(text) || /^\d{8}$/.test(text)) return '';
  const dotNetDate = text.match(/^\/Date\((\d{10,13})(?:[+-]\d+)?\)\/$/);
  if (dotNetDate) {
    const stamp = Number(dotNetDate[1]);
    return formatDate(new Date(dotNetDate[1].length === 10 ? stamp * 1000 : stamp));
  }

  // 帶有時區的完整日期必須先換算為台北時間，不能直接截取字面上的小時。
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const zonedDate = new Date(text);
    if (Number.isFinite(zonedDate.getTime())) return formatDate(zonedDate);
  }
  if (/^\d{10,13}$/.test(text)) {
    const stamp = Number(text);
    const stampedDate = new Date(text.length === 10 ? stamp * 1000 : stamp);
    if (Number.isFinite(stampedDate.getTime())) return formatDate(stampedDate);
  }

  const period = (text.match(/上午|下午|凌晨|中午|\bam\b|\bpm\b/i) || [])[0] || '';
  const clock = text.match(/(?:^|[^\d])([0-2]?\d):([0-5]\d)(?:[^\d]|$)/);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2]);
    if (hour > 23) return '';
    if (/下午|中午|pm/i.test(period) && hour < 12) hour += 12;
    if (/上午|凌晨|am/i.test(period) && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  const compact = text.match(/^([0-2]?\d)([0-5]\d)$/);
  if (compact && Number(compact[1]) <= 23) {
    return `${String(Number(compact[1])).padStart(2, '0')}:${compact[2]}`;
  }
  const hourOnly = text.match(/^(?:上午|下午|凌晨|中午|am|pm)?\s*([0-2]?\d)\s*(?:上午|下午|凌晨|中午|am|pm)?$/i);
  if (hourOnly) {
    let hour = Number(hourOnly[1]);
    if (hour > 23) return '';
    if (/下午|中午|pm/i.test(period) && hour < 12) hour += 12;
    if (/上午|凌晨|am/i.test(period) && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:00`;
  }
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? formatDate(date) : '';
}

function resolvedTime(row, fields) {
  for (const field of fields) {
    const raw = row && row[field];
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) continue;
    const time = timeKey(raw);
    if (time) return { time, field };
  }
  return { time: '', field: '' };
}

function durationMinutes(startsAt, endsAt, explicit) {
  const explicitMinutes = numberOf(explicit);
  if (explicitMinutes > 0) {
    const minutes = explicitMinutes <= 8 ? explicitMinutes * 60 : explicitMinutes;
    return Math.max(30, Math.min(8 * 60, Math.round(minutes / 30) * 30));
  }
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
  return 1;
}

function latestDate(values) {
  return array(values).map(dateKey).filter(Boolean).sort().pop() || '';
}

function weekdayName(value) {
  const key = dateKey(value);
  if (!key) return '';
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const date = new Date(`${key}T12:00:00+08:00`);
  return Number.isFinite(date.getTime()) ? names[date.getDay()] : '';
}

function inactiveRecord(row) {
  row = row || {};
  const status = clean(firstValue(row.status, row.state, row.courseStatus, row.studentStatus)).toLowerCase();
  return row.active === false || row.end === true || row.off === true || row.stop === true ||
    row.stopped === true || row.cancel === true || row.cancelled === true ||
    /停課|停止|暫停|inactive|stopped|suspend|paused|cancelled/.test(status);
}

// 音教雲 FixedCourse 的 end 布林語意與 Student 相反：
// FixedCourse.end=true 是仍在固定課表，false 才是已結束。
function inactiveFixedCourse(row) {
  row = row || {};
  const status = clean(firstValue(row.status, row.state, row.courseStatus)).toLowerCase();
  return row.active === false || row.end === false || row.off === true || row.stop === true ||
    row.stopped === true || row.cancel === true || row.cancelled === true ||
    /停課|停止|暫停|inactive|stopped|suspend|paused|cancelled/.test(status);
}

// 有些舊固定課的建立日期不是實際上課星期。以歷史簽到／請假紀錄中最常出現的星期
// 校正週期錨點，可避免星期六固定課被錯排到其他天。
function recurringAnchorDate(sourceDate, statusDates) {
  const dates = array(statusDates).map(dateKey).filter(Boolean).sort();
  if (!dates.length) return dateKey(sourceDate);
  const counts = dates.reduce((result, date) => {
    const day = weekdayName(date);
    if (day) result[day] = (result[day] || 0) + 1;
    return result;
  }, {});
  const dominant = Object.keys(counts).sort((left, right) => counts[right] - counts[left])[0] || '';
  const source = dateKey(sourceDate);
  if (source && weekdayName(source) === dominant) return source;
  return dates.find((date) => weekdayName(date) === dominant) || source || dates[0];
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

function auditDateKeys(startDate, endDate) {
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  if (!start || !end || start > end) return [];
  const rows = [];
  const cursor = new Date(`${start}T12:00:00+08:00`);
  const last = new Date(`${end}T12:00:00+08:00`);
  while (cursor <= last && rows.length < 62) {
    rows.push(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

function auditRelatedCourseId(row) {
  return idOf(firstValue(
    row && row.fixCourse,
    row && row.fixedCourse,
    row && row.tempCourse,
    row && row.temporaryCourse,
    row && row.course
  ));
}

async function latestAuditRunInfo() {
  const runs = await db.collection(AUDIT_RUNS_COLLECTION)
    // runId 以「查詢日期」開頭，不能用文件名稱判斷哪一次最後執行。
    // 例如先抓 7/25、再重抓 7/23 時，7/23 的新結果仍必須成為最新來源。
    .orderBy('completedAt', 'desc')
    .limit(20)
    .get();
  const runDoc = runs.docs.find((doc) => clean((doc.data() || {}).status).toLowerCase() === 'success');
  if (!runDoc) return { runId: '', startDate: '', endDate: '' };
  const run = runDoc.data() || {};
  return {
    runId: runDoc.id,
    startDate: dateKey(run.startDate),
    endDate: dateKey(run.endDate)
  };
}

// FixedCourse.end=true 代表仍存在於固定課資料；false 才是停用。
// Student.end 只能描述學生主檔目前狀態，不能單獨判定某一堂固定課已結束。
// 例如同一位已結束學生可能已有一筆新的固定課，而新課本身沒有 endDate。
// 有明確 endDate 時，該日期起不再推算；歷史當天若有簽到／請假／缺席證據則仍可補回。
function fixedCourseFallbackAllowed(raw, date, linkedStatus) {
  if (linkedStatus) return true;
  if (!raw || raw.end === false || raw.active === false || raw.off === true ||
      raw.stop === true || raw.stopped === true || raw.cancel === true || raw.cancelled === true) {
    return false;
  }
  const stopped = dateKey(firstValue(raw.endDate, raw.stoppedAt, raw.cancelledAt));
  return !stopped || date < stopped;
}

// 課表同步必須以舊音教雲日表核對程式的最後結果為準。
// migration collections 只補學生、老師、科目、收費等主檔，不能再自行推算某日課表。
async function latestAuditSchedule(preferredRunId) {
  const info = preferredRunId
    ? { runId: clean(preferredRunId) }
    : await latestAuditRunInfo();
  if (!info.runId) return { runId: '', startDate: '', endDate: '', coveredDates: [], events: [] };
  const runDoc = await db.collection(AUDIT_RUNS_COLLECTION).doc(info.runId).get();
  if (!runDoc.exists || clean((runDoc.data() || {}).status).toLowerCase() !== 'success') {
    return { runId: '', startDate: '', endDate: '', coveredDates: [], events: [] };
  }
  const run = runDoc.data() || {};
  const [candidateSnapshot, rawSnapshot] = await Promise.all([
    runDoc.ref.collection('calendarCandidates').get(),
    runDoc.ref.collection('rawRecords').get()
  ]);
  const rawBySourceId = new Map();
  const rawFixedCourses = [];
  const candidateFixedKeys = new Set();
  const statusByCourseDate = new Map();
  const putCourseStatus = (courseId, day, status) => {
    if (!courseId || !day) return;
    const key = `${courseId}|${day}`;
    if (status === 'absent' || !statusByCourseDate.has(key)) statusByCourseDate.set(key, status);
  };
  rawSnapshot.docs.forEach((doc) => {
    const envelope = doc.data() || {};
    const raw = envelope.raw && typeof envelope.raw === 'object' ? envelope.raw : {};
    const sourceId = clean(envelope.sourceId) || idOf(raw);
    if (sourceId) rawBySourceId.set(sourceId, raw);
    const sourceType = clean(envelope.sourceType).toLowerCase();
    if (sourceType === 'fixed-course') rawFixedCourses.push(raw);
    if (['fixed-course', 'adjusted-course'].includes(sourceType)) {
      nestedCheckins(raw).forEach((checkin) => {
        const day = dateKey(firstValue(checkin.date, checkin.startDate, checkin.created));
        if (!day || checkin.cancel === true) return;
        putCourseStatus(sourceId, day, statusForCheckin(checkin));
      });
    }
    if (!['leave', 'checkin-leave', 'checkin-skip'].includes(sourceType)) return;
    const courseId = auditRelatedCourseId(raw);
    const day = dateKey(firstValue(raw.date, raw.leaveDate, raw.checkinDate, raw.startDate, raw.created));
    if (!courseId || !day || raw.cancel === true) return;
    const status = sourceType === 'checkin-skip' ? 'absent' : 'leave';
    putCourseStatus(courseId, day, status);
  });

  const startDate = dateKey(run.startDate);
  const endDate = dateKey(run.endDate);
  const coveredDates = auditDateKeys(startDate, endDate);
  const events = [];
  candidateSnapshot.docs.forEach((doc, index) => {
    const row = doc.data() || {};
    const sourceType = clean(row.sourceType).toLowerCase();
    // 舊日表核對程式已確認當天實際出現的固定課、調課與租用；
    // 這份日期候選必須優先於學生／課程目前是否已結束的主檔狀態。
    if (!['fixed-course', 'adjusted-course', 'rental'].includes(sourceType) || row.cancel === true) return;
    const sourceCourseId = clean(row.sourceId);
    const date = dateKey(row.dateKey);
    const start = timeKey(row.startsAt);
    const roomId = clean(row.roomId);
    if (!sourceCourseId || !date || !start || !roomId) return;
    if (sourceType === 'fixed-course') candidateFixedKeys.add(`${sourceCourseId}|${date}`);
    const raw = rawBySourceId.get(sourceCourseId) || {};
    const linkedStatus = statusByCourseDate.get(`${sourceCourseId}|${date}`);
    const type = sourceType === 'fixed-course' ? 'fixed' : sourceType === 'rental' ? 'rental' : 'single';
    const status = linkedStatus || (row.alreadyCheckin === true || raw.alreadyCheckin === true ? 'attended' : 'scheduled');
    events.push({
      id: `audit_${sourceType}_${sourceCourseId}_${date}`,
      sourceCourseId,
      seriesId: sourceCourseId,
      date,
      roomId,
      roomName: clean(row.roomName),
      start,
      duration: durationMinutes(start, timeKey(row.endsAt), firstValue(
        raw.minute, raw.minutes, raw.duration, raw.durationMinutes, raw.hours, raw.hour
      )),
      type,
      frequency: 'once',
      studentIds: unique(row.studentIds),
      teacherId: clean(row.teacherId),
      subjectId: clean(row.subjectId),
      tuitionPeriodId: '',
      clientName: type === 'rental' ? (clean(row.clientName) || nameOf(raw.client) || '教室租用') : '',
      rentalFee: type === 'rental' ? Math.max(0, numberOf(firstValue(raw.money, raw.amount, raw.fee))) : 0,
      status,
      note: clean(firstValue(raw.remark, raw.note)),
      readOnly: true,
      source: 'injiaoyun-audit',
      sourceAuditRunId: runDoc.id,
      sortIndex: index
    });
  });

  rawFixedCourses.forEach((raw, rawIndex) => {
    const sourceCourseId = idOf(raw);
    const seed = dateKey(firstValue(raw.startDate, raw.startsAt, raw.created));
    const start = timeKey(firstValue(raw.startsAt, raw.startTime, raw.time));
    const roomId = idOf(raw.room);
    if (!sourceCourseId || !seed || !start || !roomId) return;
    const students = courseStudentValues(raw);
    const studentIds = unique(students);
    const seedWeekday = weekdayName(seed);
    const every = frequencyWeeks(firstValue(raw.frequency, raw.week, raw.every));
    coveredDates.forEach((date, dateIndex) => {
      if (date < seed || weekdayName(date) !== seedWeekday) return;
      if (every >= 2) {
        const elapsed = Math.round((
          new Date(`${date}T12:00:00+08:00`) - new Date(`${seed}T12:00:00+08:00`)
        ) / 86400000);
        if (Math.floor(elapsed / 7) % every !== 0) return;
      }
      if (candidateFixedKeys.has(`${sourceCourseId}|${date}`)) return;
      const linkedStatus = statusByCourseDate.get(`${sourceCourseId}|${date}`);
      // 核對程式可能因 Student.end=true 漏掉一筆仍有效的新固定課。
      // 以固定課自己的 end/endDate 為界線；學生主檔的結束旗標不能單獨刪課。
      // 歷史當天有簽到、請假或缺席證據時，即使之後已結束也仍須補回。
      if (!fixedCourseFallbackAllowed(raw, date, linkedStatus)) return;
      events.push({
        id: `audit_fixed-course_${sourceCourseId}_${date}`,
        sourceCourseId,
        seriesId: sourceCourseId,
        date,
        roomId,
        roomName: '',
        start,
        duration: durationMinutes(start, timeKey(firstValue(raw.endsAt, raw.endTime)), firstValue(
          raw.minute, raw.minutes, raw.duration, raw.durationMinutes, raw.hours, raw.hour
        )),
        type: 'fixed',
        frequency: 'once',
        studentIds,
        teacherId: idOf(raw.teacher),
        subjectId: idOf(raw.subject),
        tuitionPeriodId: '',
        clientName: '',
        rentalFee: 0,
        status: linkedStatus || 'scheduled',
        note: clean(firstValue(raw.remark, raw.note)),
        readOnly: true,
        source: 'injiaoyun-audit',
        sourceAuditRunId: runDoc.id,
        sortIndex: candidateSnapshot.size + rawIndex * coveredDates.length + dateIndex
      });
    });
  });

  const priority = { fixed: 0, single: 1, trial: 2, rental: 3 };
  events.sort((left, right) => (
    `${left.date}|${left.start}|${left.roomId}`.localeCompare(`${right.date}|${right.start}|${right.roomId}`) ||
    (priority[left.type] || 0) - (priority[right.type] || 0) ||
    left.sortIndex - right.sortIndex
  ));
  events.forEach((row) => { delete row.sortIndex; });
  const countsByDate = Object.fromEntries(coveredDates.map((date) => [date, {
    fixed: 0,
    single: 0,
    rental: 0,
    students: 0,
    leave: 0,
    leaveEvents: 0,
    absent: 0
  }]));
  events.forEach((row) => {
    if (!countsByDate[row.date]) return;
    if (Object.prototype.hasOwnProperty.call(countsByDate[row.date], row.type)) {
      countsByDate[row.date][row.type] += 1;
    }
    if (row.type !== 'rental') countsByDate[row.date].students += 1;
    if (row.status === 'leave') countsByDate[row.date].leaveEvents += 1;
    if (row.status === 'absent') countsByDate[row.date].absent += 1;
  });
  coveredDates.forEach((date) => {
    const daily = run.daily && run.daily[date];
    countsByDate[date].leave = daily && daily.leave != null
      ? Math.max(0, numberOf(daily.leave))
      : countsByDate[date].leaveEvents;
  });
  const countMismatches = [];
  coveredDates.forEach((date) => {
    const daily = run.daily && run.daily[date] || {};
    const header = daily.displayedHeader && typeof daily.displayedHeader === 'object'
      ? daily.displayedHeader
      : {};
    // 只有確定畫面日期正確且抓到數字時才檢查，避免把導頁失敗的其他日期誤當真。
    if (daily.displayedDateMatched === false) return;
    const expectedStudents = header.students == null || header.students === ''
      ? null
      : numberOf(header.students);
    const expectedFixed = header.fixedCourses == null || header.fixedCourses === ''
      ? null
      : numberOf(header.fixedCourses);
    const actual = countsByDate[date];
    if (expectedStudents != null && actual.students !== expectedStudents) {
      countMismatches.push(`${date} 學生 ${actual.students}/${expectedStudents}`);
    }
    if (expectedFixed != null && actual.fixed !== expectedFixed) {
      countMismatches.push(`${date} 固定課 ${actual.fixed}/${expectedFixed}`);
    }
  });
  if (countMismatches.length) {
    throw new Error(`舊日表完整性檢查未通過：${countMismatches.join('；')}`);
  }
  return {
    runId: runDoc.id,
    startDate,
    endDate,
    coveredDates,
    countsByDate,
    events
  };
}

async function readCollection(config, runId) {
  const name = `${COLLECTION_PREFIX}${config.suffix}`;
  const snapshot = await db.collection(name).where('migrationRunId', '==', runId).limit(config.limit).get();
  const decoded = await mapLimit(snapshot.docs, 16, async (doc) => {
    const envelope = doc.data() || {};
    const source = await decodeSource(envelope);
    if (!source || typeof source !== 'object') return null;
    return Object.assign({}, source, {
      _migrationParentId: clean(envelope.parentSourceId),
      _migrationSourceId: clean(envelope.sourceId || doc.id)
    });
  });
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

function referenceIds(value) {
  if (Array.isArray(value)) return unique(value);
  const id = idOf(value);
  return id ? [id] : [];
}

function statusForCheckin(row, fallback = 'attended') {
  if (!row || typeof row !== 'object') return fallback;
  const status = clean(row.status || row.type).toLowerCase();
  if (/leave|請假|sleave|tleave/.test(status) || row.leave === true || row.sleave === true || row.tleave === true) return 'leave';
  if (/skip|absent|缺席|曠課/.test(status) || row.skip === true || row.absent === true) return 'absent';
  if (/cancel|停課/.test(status) || row.cancel === true) return 'leave';
  return 'attended';
}

function nestedCheckins(row) {
  return array(firstValue(row && row.checkins, row && row.attendance, row && row.signins));
}

function transactionRows(payment, periodId, expectedAmount) {
  const rows = [];
  const usedIds = new Set();
  const add = (source, type, method, index) => {
    if (source == null) return;
    const row = typeof source === 'object' ? source : { money: source };
    const amount = Math.abs(numberOf(firstValue(row.amount, row.money, row.value, row.pay, row.total)));
    if (!amount) return;
    const id = idOf(row) || `${periodId}_${type}_${method}_${index}`;
    if (usedIds.has(id)) return;
    usedIds.add(id);
    rows.push({
      id, type, periodId,
      date: dateKey(firstValue(row.date, row.created, row.updated, payment.updated, payment.created)),
      amount,
      method: clean(firstValue(row.method, row.payType, row.paymentMethod, method, '未註明')),
      note: clean(firstValue(row.note, row.remark, row.reason))
    });
  };

  const payList = array(firstValue(payment.payList, payment.payList_Model, payment.payments, payment.transactions));
  payList.forEach((row, index) => add(row, 'payment', '', index));
  array(payment.refunds).forEach((row, index) => add(row, 'refund', '退款', index));

  if (!rows.some((row) => row.type === 'payment')) {
    [
      ['pay1', '店面營收'], ['cash', '現金'], ['transfer', '轉帳'], ['card', '刷卡'],
      ['online', '線上繳費'], ['streetPay', '街口支付']
    ].forEach(([field, label], index) => add(payment[field], 'payment', label, index));
  }
  if (!rows.some((row) => row.type === 'payment') && payment.revenue !== false && expectedAmount > 0) {
    add({ amount: expectedAmount, date: firstValue(payment.updated, payment.created) }, 'payment', '既有收款', 0);
  }
  return rows;
}

function buildSubjects(data) {
  const rows = [];
  const byId = new Map();
  const byName = new Map();
  const add = (value, fallbackName = '') => {
    const id = idOf(value);
    const name = nameOf(value) || clean(fallbackName);
    if (!id && !name) return null;
    if (id && byId.has(id)) return byId.get(id);
    if (name && byName.has(name)) return byName.get(name);
    const source = value && typeof value === 'object' ? value : {};
    const row = {
      id: id || `subject_${rows.length + 1}`,
      name: name || `未命名科目 ${rows.length + 1}`,
      sort: numberOf(source.sort) || rows.length + 1,
      active: source.off !== true && source.end !== true && source.active !== false
    };
    rows.push(row);
    byId.set(row.id, row);
    byName.set(row.name, row);
    return row;
  };

  data.subjects.forEach((row) => add(row));
  data.subjectTypes.forEach((row) => add(row));
  data.charges.forEach((row) => add(row.subject, nameOf(row.subject)));
  data.fixedCourses.concat(data.temporaryCourses, data.studentCourses).forEach((row) => add(row.subject, nameOf(row.subject)));
  return { rows, byId, byName, add };
}

function buildRooms(data) {
  const rows = [];
  const byId = new Map();
  const add = (value, fallbackName = '') => {
    const id = idOf(value);
    const name = nameOf(value) || clean(fallbackName);
    if (!id && !name) return null;
    if (id && byId.has(id)) return byId.get(id);
    const source = value && typeof value === 'object' ? value : {};
    const row = {
      id: id || `room_${rows.length + 1}`,
      name: name || `教室 ${rows.length + 1}`,
      publicName: clean(firstValue(source.publicName, source.bookingName, source.reserveName)),
      note: clean(firstValue(source.remark, source.note)),
      rentalFee: numberOf(firstValue(source.rentalFee, source.rent, source.money)),
      sort: numberOf(source.sort) || rows.length + 1,
      active: source.off !== true && source.end !== true && source.active !== false,
      policies: normalizeRoomPolicies(source)
    };
    rows.push(row);
    byId.set(row.id, row);
    return row;
  };

  data.rooms.forEach((row) => add(row));
  data.fixedCourses.concat(data.temporaryCourses, data.roomRentals, data.roomRentalsAll)
    .forEach((row) => add(row.room, referenceName(row.room, new Map(), row.roomName)));
  if (!rows.length) add({ id: 'room_unknown', name: '未設定教室' });
  return { rows, byId, add };
}

function normalizeRoomPolicies(room) {
  if (room.policies && typeof room.policies === 'object') return room.policies;
  const output = {};
  const weekdayFields = {
    sun: ['sun', 'Sunday', 'Sunday_houList'], mon: ['mon', 'Monday', 'Monday_houList'],
    tue: ['tue', 'Tuesday', 'Tuesday_houList'], wed: ['wed', 'Wednesday', 'Wednesday_houList'],
    thu: ['thu', 'Thursday', 'Thursday_houList'], fri: ['fri', 'Friday', 'Friday_houList'],
    sat: ['sat', 'Saturday', 'Saturday_houList']
  };
  Object.entries(weekdayFields).forEach(([day, fields]) => {
    const slots = fields.reduce((found, field) => found.length ? found : array(room[field]), []);
    if (!slots.length) return;
    output[day] = {};
    slots.forEach((slot) => {
      const value = slot && typeof slot === 'object' ? slot : { time: slot };
      const time = timeKey(firstValue(value.time, value.start, value.startsAt, value.hour));
      if (!time) return;
      const allowSchedule = firstValue(
        value.allowSchedule, value.canSchedule, value.scheduleAllowed, value.openForSchedule
      );
      const allowRental = firstValue(
        value.allowRental, value.canRent, value.rentalAllowed, value.openForRental
      );
      output[day][time] = {
        blockSchedule: allowSchedule == null
          ? booleanOf(firstValue(value.blockSchedule, value.noCourse, value.forbidCourse), false)
          : !booleanOf(allowSchedule, true),
        blockRental: allowRental == null
          ? booleanOf(firstValue(value.blockRental, value.noRent, value.forbidRent), false)
          : !booleanOf(allowRental, true),
        subjectIds: referenceIds(firstValue(value.subjectIds, value.subjects, value.subject))
      };
    });
  });
  return output;
}

function buildStudents(data) {
  const details = new Map();
  data.studentDetails.forEach((row) => {
    const student = row.student && typeof row.student === 'object' ? row.student : row;
    const id = clean(row._migrationParentId) || idOf(student) || idOf(row);
    if (id) details.set(id, student);
  });
  const seen = new Set();
  const rows = [];
  const add = (source) => {
    const id = idOf(source) || clean(source && source._migrationParentId);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const detail = details.get(id) || {};
    const merged = Object.assign({}, source || {}, detail);
    rows.push({
      id,
      name: nameOf(merged) || '未命名學生',
      phone: clean(firstValue(merged.phone, merged.mobile, merged.tel)),
      line: clean(firstValue(merged.line_user_id, merged.lineUserId)) ? true : null,
      note: clean(firstValue(merged.remark, merged.note, merged.specialReminder)),
      active: !inactiveRecord(merged)
    });
  };
  data.students.forEach(add);
  data.studentDetails.forEach((row) => add(Object.assign({}, row.student || row, { _migrationParentId: row._migrationParentId })));
  return rows;
}

function buildFeePlans(data, subjects) {
  const subjectLookup = subjects.byId;
  return data.charges.map((row, index) => {
    const subject = subjects.add(row.subject, nameOf(row.subject));
    const splitValue = numberOf(firstValue(row.allot, row.splitValue));
    return {
      id: idOf(row) || `fee_${index + 1}`,
      subjectId: subject && subject.id || idOf(row.subject),
      subjectName: subject && subject.name || referenceName(row.subject, subjectLookup, ''),
      sort: numberOf(row.sort) || index + 1,
      name: clean(row.name) || `收費方案 ${index + 1}`,
      amount: Math.max(0, numberOf(firstValue(row.money, row.amount, row.tuition))),
      lessonCount: Math.max(1, Math.round(numberOf(firstValue(row.courseNumber, row.lessonCount, 4)))),
      splitType: clean(row.splitType) || (splitValue > 0 && splitValue <= 1 ? 'ratio' : splitValue > 0 ? 'fixed' : 'none'),
      splitValue,
      leaveNoDeduct: row.leaveNoDeduct != null ? row.leaveNoDeduct === true : row.leaveDelay !== false,
      expiryDays: Math.max(0, Math.round(numberOf(firstValue(row.expiryDays, row.limitDays)))),
      active: row.off !== true && row.end !== true && row.active !== false,
      listed: row.down !== true && row.listed !== false
    };
  });
}

function paymentPriorityRows(data) {
  const sources = [
    data.studentPayments,
    data.studentPaymentsAll,
    data.studentPaymentsOpen,
    data.studentPaymentDetails
  ];
  const map = new Map();
  sources.forEach((rows, priority) => rows.forEach((row, index) => {
    const parent = clean(row._migrationParentId) || idOf(row.student);
    const id = idOf(row) || `${parent}_${priority}_${index}`;
    const key = `${parent}|${id}`;
    map.set(key, Object.assign({}, map.get(key) || {}, row, { _previewPriority: priority }));
  }));
  return [...map.values()];
}

function buildTuitionPeriods(data, subjects, feePlans) {
  const feeById = new Map(feePlans.map((row) => [row.id, row]));
  const periods = paymentPriorityRows(data).map((row, index) => {
    const chargeValue = row.chargeType || row.charge || row.plan;
    const charge = chargeValue && typeof chargeValue === 'object' ? chargeValue : feeById.get(idOf(chargeValue)) || {};
    const planId = idOf(chargeValue) || idOf(charge);
    const plan = feeById.get(planId) || {};
    const subject = subjects.add(firstValue(row.subject, charge.subject), nameOf(firstValue(row.subject, charge.subject)));
    const studentId = idOf(row.student) || clean(row._migrationParentId);
    const sourcePaymentId = idOf(row) || clean(row._migrationSourceId) || `payment_${index + 1}`;
    const lessonCount = Math.max(1, Math.round(numberOf(firstValue(row.courseNumber, charge.courseNumber, plan.lessonCount, 4))));
    const usedCount = nestedCheckins(row).filter((checkin) => statusForCheckin(checkin) !== 'leave').length;
    const expectedAmount = Math.max(0, numberOf(firstValue(row.money, row.amount, charge.money, plan.amount)));
    const transactions = transactionRows(row, sourcePaymentId, expectedAmount);
    const paid = transactions.reduce((total, item) => total + (item.type === 'refund' ? -item.amount : item.amount), 0);
    const startDate = dateKey(firstValue(row.startDate, row.created, row.updated));
    const expiryDate = dateKey(firstValue(row.expiryDate, row.endDate, row.deadline));
    const active = row.end !== true && row.off !== true && usedCount < lessonCount;
    return {
      id: `period_${sourcePaymentId}`,
      sourcePaymentId,
      studentId,
      subjectId: subject && subject.id || idOf(firstValue(row.subject, charge.subject)),
      teacherId: idOf(firstValue(row.teacher, charge.teacher)),
      planId: planId || plan.id || '',
      periodNo: numberOf(firstValue(row.periodNo, row.period, row.stage, row.number)),
      startDate,
      expiryDate,
      lessonCount,
      usedCount,
      expectedAmount,
      discount: Math.max(0, numberOf(firstValue(row.discount, row.offMoney, typeof row.off === 'number' ? row.off : 0))),
      status: active ? 'active' : paid < expectedAmount ? 'unpaid' : 'completed',
      note: clean(firstValue(row.remark, row.note)),
      transactions,
      planSnapshot: {
        id: planId || plan.id || '',
        name: clean(firstValue(charge.name, plan.name, row.name, '既有收費')),
        amount: expectedAmount,
        lessonCount,
        splitType: clean(firstValue(plan.splitType, charge.splitType)) || (numberOf(charge.allot) > 0 ? 'ratio' : 'none'),
        splitValue: numberOf(firstValue(plan.splitValue, charge.allot)),
        leaveNoDeduct: charge.leaveNoDeduct != null ? charge.leaveNoDeduct === true : charge.leaveDelay !== false,
        sourceCapturedAt: clean(firstValue(row.updated, row.created))
      }
    };
  }).filter((row) => row.studentId);

  const groups = new Map();
  periods.forEach((row) => {
    const key = `${row.studentId}|${row.subjectId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  groups.forEach((rows) => {
    rows.sort((left, right) => (left.startDate || '').localeCompare(right.startDate || '') || left.id.localeCompare(right.id));
    rows.forEach((row, index) => { if (!row.periodNo) row.periodNo = index + 1; });
  });
  return periods;
}

function courseStudentValues(row) {
  return array(row.students).concat(referenceIds(row.student));
}

function coursePaymentValues(row) {
  const values = array(row.studentPayments).concat(referenceIds(row.studentPayment));
  nestedCheckins(row).forEach((checkin) => values.push(...referenceIds(firstValue(checkin.studentPayment, checkin.payment))));
  return unique(values);
}

function courseStatusMap(row, leaveRows) {
  const output = {};
  nestedCheckins(row).forEach((checkin) => {
    const key = dateKey(firstValue(checkin.date, checkin.startDate, checkin.created));
    if (key) output[key] = statusForCheckin(checkin);
  });
  leaveRows.forEach((leave) => {
    const key = dateKey(firstValue(leave.date, leave.startDate, leave.created));
    if (key && leave.cancel !== true) output[key] = 'leave';
  });
  return output;
}

function courseRow(row, type, lookups, leavesByCourse) {
  const studentValues = courseStudentValues(row);
  const studentIds = unique(studentValues);
  const studentNames = studentValues.map((value) => referenceName(value, lookups.students, '')).filter(Boolean);
  const teacherId = idOf(row.teacher);
  const subject = lookups.subjectInfo.add(row.subject, nameOf(row.subject));
  const subjectId = subject && subject.id || idOf(row.subject);
  const room = lookups.roomInfo.add(row.room, nameOf(row.room));
  const roomId = room && room.id || idOf(row.room);
  const id = idOf(row) || clean(row._migrationSourceId) || `${type}_${roomId}_${clean(row.startDate)}_${clean(row.startsAt)}`;
  const startResult = resolvedTime(row, [
    'startsAt', 'startTime', 'startAt', 'start', 'time',
    // 日期欄只能決定哪一天，不能被當成上課時間；否則缺時間的資料會被錯誤排到同一格。
    'beginAt', 'beginTime'
  ]);
  const endResult = resolvedTime(row, [
    'endsAt', 'endTime', 'endAt', 'end', 'finishTime', 'finishAt'
  ]);
  const startsAt = startResult.time;
  const endsAt = endResult.time;
  const statusByDate = courseStatusMap(row, leavesByCourse.get(id) || []);
  const linkedStudents = studentValues.map((value) => {
    if (value && typeof value === 'object') return value;
    return lookups.students.get(idOf(value)) || {};
  }).filter((value) => Object.keys(value).length);
  // 課程本身仍被標成啟用、但所有關聯學生都已停課時，不可再把固定課延伸到未來。
  const studentsStillActive = !linkedStudents.length || linkedStudents.some((student) => !inactiveRecord(student));
  const active = !(type === 'fixed' ? inactiveFixedCourse(row) : inactiveRecord(row)) && studentsStillActive;
  const explicitStopDate = dateKey(firstValue(
    row.stopDate, row.stoppedAt, row.endedAt, row.endDate, row.offDate, row.cancelDate,
    row.pauseDate, row.suspendedAt, row.inactiveAt
  ));
  // 舊資料常只有 end=true，沒有獨立停課日。此時才用最後一筆實際出席／請假紀錄
  // 作為歷史課表的終點；仍在上課的固定課不可被最後簽到日截斷。
  const stopDate = active ? '' : (explicitStopDate || latestDate(Object.keys(statusByDate)) ||
    dateKey(firstValue(row.updated, row.created, row.startDate)));
  return {
    id,
    type,
    active,
    stopDate,
    // 固定課有明確結束日，即使舊資料仍標成啟用，也不可無限延伸到未來。
    recurrenceEndDate: explicitStopDate,
    date: type === 'fixed'
      ? recurringAnchorDate(
        firstValue(row.startDate, row.date, row.startsAt, row.created),
        Object.keys(statusByDate)
      )
      : dateKey(firstValue(row.startDate, row.date, row.startsAt, row.created)),
    start: startsAt,
    timeResolved: Boolean(startsAt),
    timeSource: startResult.field,
    timeIssue: startsAt ? '' : 'unrecognized-start-time',
    duration: durationMinutes(startsAt, endsAt, firstValue(
      row.minute, row.minutes, row.duration, row.durationMinutes, row.hours, row.hour
    )),
    frequencyWeeks: type === 'fixed' ? frequencyWeeks(firstValue(row.frequency, row.week, row.every)) : 0,
    frequency: clean(firstValue(row.frequency, row.week, row.every)),
    roomId,
    roomName: room && room.name || referenceName(row.room, lookups.rooms, ''),
    studentIds,
    studentNames,
    studentPaymentIds: coursePaymentValues(row),
    teacherId,
    teacherName: referenceName(row.teacher, lookups.teachers, ''),
    subjectId,
    subjectName: subject && subject.name || referenceName(row.subject, lookups.subjects, ''),
    statusByDate,
    note: clean(firstValue(row.remark, row.note)),
    source: 'injiaoyun-migration'
  };
}

function buildAttendance(data, courses, periods) {
  const periodBySource = new Map(periods.map((row) => [row.sourcePaymentId, row]));
  const courseById = new Map(courses.map((row) => [row.id, row]));
  const output = new Map();
  const priority = { attended: 1, leave: 2, absent: 3 };
  const add = (source, fallbackStatus, context = {}) => {
    const row = source && typeof source === 'object' ? source : {};
    const courseId = idOf(firstValue(row.fixCourse, row.tempCourse, row.course)) || clean(context.courseId);
    const course = courseById.get(courseId) || {};
    const paymentId = idOf(firstValue(row.studentPayment, row.payment)) || clean(context.paymentId);
    const period = periodBySource.get(paymentId) || {};
    const studentId = idOf(row.student) || clean(context.studentId) || period.studentId || array(course.studentIds)[0] || '';
    const date = dateKey(firstValue(row.date, row.startDate, row.created, context.date));
    if (!studentId || !date) return;
    const status = statusForCheckin(row, fallbackStatus);
    const key = `${studentId}|${date}|${courseId || paymentId}|${period.id || ''}`;
    const current = output.get(key);
    if (current && priority[current.status] >= priority[status]) return;
    output.set(key, {
      id: idOf(row) || clean(row._migrationSourceId) || `attendance_${output.size + 1}`,
      sourceCourseId: courseId,
      eventId: '',
      studentId,
      periodId: period.id || '',
      sourcePaymentId: paymentId,
      status,
      date,
      lessonNo: numberOf(firstValue(row.lessonNo, row.courseNumber, context.lessonNo)),
      teacherId: idOf(row.teacher) || clean(context.teacherId) || course.teacherId || '',
      reasonId: idOf(firstValue(row.reason, row.leaveReason)),
      note: clean(firstValue(row.remark, row.note))
    });
  };

  paymentPriorityRows(data).forEach((payment) => nestedCheckins(payment).forEach((checkin, index) => add(checkin, 'attended', {
    paymentId: idOf(payment), studentId: idOf(payment.student) || clean(payment._migrationParentId), lessonNo: index + 1
  })));
  data.fixedCourses.concat(data.temporaryCourses).forEach((course) => nestedCheckins(course).forEach((checkin, index) => add(checkin, 'attended', {
    courseId: idOf(course), studentId: unique(courseStudentValues(course))[0], teacherId: idOf(course.teacher), lessonNo: index + 1
  })));
  data.studentDetails.forEach((detail) => {
    const studentId = clean(detail._migrationParentId) || idOf(detail.student) || idOf(detail);
    const context = { studentId };
    array(firstValue(detail.checkins, detail.attendance, detail.signins)).forEach((row, index) => add(row, 'attended', Object.assign({ lessonNo: index + 1 }, context)));
    array(firstValue(detail.leaves, detail.leaveRecords)).forEach((row) => add(row, 'leave', context));
    array(firstValue(detail.checkinLeaves, detail.studentLeaves)).forEach((row) => add(row, 'leave', context));
    array(firstValue(detail.checkinSkips, detail.skips, detail.absences)).forEach((row) => add(row, 'absent', context));
  });
  data.leaves.forEach((row) => add(row, 'leave'));
  data.checkinLeaves.forEach((row) => add(row, 'leave'));
  data.checkinSkips.forEach((row) => add(row, 'absent'));
  return [...output.values()];
}

function buildTeachers(data, subjects, courseRows) {
  const taught = new Map();
  courseRows.forEach((course) => {
    if (!course.teacherId || !course.subjectId) return;
    if (!taught.has(course.teacherId)) taught.set(course.teacherId, new Set());
    taught.get(course.teacherId).add(course.subjectId);
  });
  const rewards = new Map();
  data.teacherRewards.forEach((row) => rewards.set(idOf(row.teacher), (rewards.get(idOf(row.teacher)) || 0) + numberOf(row.money)));
  const deductions = new Map();
  data.teacherDeductions.forEach((row) => deductions.set(idOf(row.teacher), (deductions.get(idOf(row.teacher)) || 0) + numberOf(row.money)));
  return data.teachers.map((row, index) => {
    const id = idOf(row) || `teacher_${index + 1}`;
    const subjectIds = new Set();
    referenceIds(firstValue(row.subjects, row.subjectIds, row.subject)).forEach((value) => {
      const subject = subjects.add(value, nameOf(value));
      if (subject) subjectIds.add(subject.id);
    });
    (taught.get(id) || new Set()).forEach((subjectId) => subjectIds.add(subjectId));
    return {
      id,
      name: nameOf(row) || '未命名老師',
      phone: clean(firstValue(row.phone, row.mobile, row.tel)),
      subjectIds: [...subjectIds],
      subjects: [...subjectIds].map((subjectId) => subjects.byId.get(subjectId) && subjects.byId.get(subjectId).name).filter(Boolean),
      reward: rewards.get(id) || 0,
      deduction: deductions.get(id) || 0,
      active: row.off !== true && row.end !== true && row.active !== false,
      note: clean(firstValue(row.remark, row.note))
    };
  });
}

function buildRoomRentals(data, lookups) {
  const map = new Map();
  data.roomRentals.concat(data.roomRentalsAll).forEach((row, index) => {
    const id = idOf(row) || clean(row._migrationSourceId) || `rental_${index + 1}`;
    const room = lookups.roomInfo.add(row.room, nameOf(row.room));
    const startResult = resolvedTime(row, [
      'startsAt', 'startTime', 'startAt', 'start', 'time',
      // 租用也必須有真正的時間欄位，不能從日期欄位猜測時間。
      'beginAt', 'beginTime'
    ]);
    const endResult = resolvedTime(row, [
      'endsAt', 'endTime', 'endAt', 'end', 'finishTime', 'finishAt'
    ]);
    const startsAt = startResult.time;
    map.set(id, {
      id,
      type: 'rental',
      date: dateKey(firstValue(row.startDate, row.date, row.startsAt, row.created)),
      start: startsAt,
      timeResolved: Boolean(startsAt),
      timeSource: startResult.field,
      timeIssue: startsAt ? '' : 'unrecognized-start-time',
      duration: durationMinutes(startsAt, endResult.time, firstValue(
        row.minute, row.minutes, row.duration, row.durationMinutes, row.hours, row.hour
      )),
      roomId: room && room.id || idOf(row.room),
      roomName: room && room.name || referenceName(row.room, lookups.rooms, ''),
      clientName: nameOf(firstValue(row.client, row.customer)) || clean(firstValue(row.name, row.clientName, '教室租用')),
      amount: Math.max(0, numberOf(firstValue(row.money, row.amount, row.fee))),
      status: row.alreadyCheckin === true || row.checkout === true ? 'attended' : row.cancel === true ? 'cancelled' : 'scheduled',
      note: clean(firstValue(row.remark, row.note))
    });
  });
  return [...map.values()].filter((row) => row.date && row.roomId);
}

async function buildPreview(runId) {
  const entries = await Promise.all(Object.entries(EDUCATION_COLLECTIONS).map(async ([key, config]) => (
    [key, await readCollection(config, runId)]
  )));
  const data = Object.fromEntries(entries);
  const subjectInfo = buildSubjects(data);
  const roomInfo = buildRooms(data);
  const students = buildStudents(data);
  const studentLookup = new Map(students.map((row) => [row.id, row]));
  const lookups = {
    students: studentLookup,
    teachers: mapById(data.teachers),
    rooms: roomInfo.byId,
    subjects: subjectInfo.byId,
    roomInfo,
    subjectInfo
  };

  const leavesByCourse = new Map();
  data.leaves.concat(data.checkinLeaves).forEach((leave) => {
    const courseId = idOf(firstValue(leave.fixCourse, leave.tempCourse, leave.course));
    if (!courseId) return;
    if (!leavesByCourse.has(courseId)) leavesByCourse.set(courseId, []);
    leavesByCourse.get(courseId).push(leave);
  });

  const fixedCourses = data.fixedCourses.map((row) => courseRow(row, 'fixed', lookups, leavesByCourse));
  const temporaryCourses = data.temporaryCourses.map((row) => {
    const checkins = nestedCheckins(row);
    const isTrial = row.test === true || row.fromTest === true || checkins.some((checkin) => checkin && checkin.fromTest === true);
    return courseRow(row, isTrial ? 'trial' : 'single', lookups, leavesByCourse);
  });
  const allCourses = fixedCourses.concat(temporaryCourses);
  const feePlans = buildFeePlans(data, subjectInfo);
  const tuitionPeriods = buildTuitionPeriods(data, subjectInfo, feePlans);
  const attendance = buildAttendance(data, allCourses, tuitionPeriods);
  const teachers = buildTeachers(data, subjectInfo, allCourses);
  const roomRentals = buildRoomRentals(data, lookups);
  const unresolvedFixedCourses = fixedCourses.filter((row) => !row.timeResolved).length;
  const unresolvedTemporaryCourses = temporaryCourses.filter((row) => !row.timeResolved).length;
  const unresolvedRoomRentals = roomRentals.filter((row) => !row.timeResolved).length;
  const countWeekdays = (rows) => rows.reduce((counts, row) => {
    const day = weekdayName(row.date);
    if (day) counts[day] = (counts[day] || 0) + 1;
    return counts;
  }, { sun: 0, mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 });
  const dataQuality = {
    totalTimeRecords: fixedCourses.length + temporaryCourses.length + roomRentals.length,
    resolvedTimeRecords: fixedCourses.length + temporaryCourses.length + roomRentals.length -
      unresolvedFixedCourses - unresolvedTemporaryCourses - unresolvedRoomRentals,
    unresolvedTimeRecords: unresolvedFixedCourses + unresolvedTemporaryCourses + unresolvedRoomRentals,
    unresolvedFixedCourses,
    unresolvedTemporaryCourses,
    unresolvedRoomRentals,
    fixedCourseWeekdays: countWeekdays(fixedCourses),
    activeFixedCourseWeekdays: countWeekdays(fixedCourses.filter((row) => row.active)),
    temporaryCourseWeekdays: countWeekdays(temporaryCourses)
  };
  const leaveReasons = data.leaveReasons.map((row, index) => ({
    id: idOf(row) || `leave_${index + 1}`,
    name: nameOf(row) || clean(row.reason) || '其他',
    sort: numberOf(row.sort) || index + 1,
    active: row.off !== true && row.active !== false
  }));

  return {
    ok: true,
    readOnly: true,
    scope: 'education-only',
    excludedDomains: ['products', 'inventory', 'sales', 'purchases', 'suppliers'],
    runId,
    version: VERSION,
    loadedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])),
    dataQuality,
    rooms: roomInfo.rows,
    subjects: subjectInfo.rows,
    feePlans,
    charges: feePlans,
    students,
    teachers,
    tuitionPeriods,
    attendance,
    fixedCourses,
    temporaryCourses,
    roomRentals,
    leaveReasons,
    rentalCardCounts: {
      cards: data.roomRentalCards.length,
      specifications: data.roomRentalCardSpecs.length
    }
  };
}

function registerInjiaoyunEducationPreview(exportsObject) {
  exportsObject.loadInjiaoyunEducationPreview = onCall({
    region: FUNCTION_REGION,
    timeoutSeconds: 300,
    memory: '2GiB',
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
  EDUCATION_PREVIEW_VERSION: VERSION,
  EDUCATION_COLLECTIONS,
  buildPreview,
  buildAttendance,
  buildFeePlans,
  buildTuitionPeriods,
  courseRow,
  dateKey,
  durationMinutes,
  frequencyWeeks,
  fixedCourseFallbackAllowed,
  latestAuditSchedule,
  latestAuditRunInfo,
  latestMigrationRunId,
  timeKey
};
