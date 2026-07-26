'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { normalizePhone, phoneMatches } = require('./coursePortalUtils');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;
const REGION = 'us-central1';
const TAIPEI = 'Asia/Taipei';
const ADMIN_PIN = defineSecret('INJIAOYUN_MANUAL_SYNC_PIN');
const PORTAL_BASE = 'https://danny700808.github.io/play-card';
const ALLOWED_ORIGINS = [
  'https://danny700808.github.io',
  'https://www.mingtinghuang.com',
  'https://mingtinghuang.com',
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i
];
const MIRROR = Object.freeze({
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
  events: 'opsEducationMirrorEvents'
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeName(value) {
  return clean(value).replace(/\s+/g, '').toLowerCase();
}

function dateKey(value) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00+08:00`);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date) === match[0] ? match[0] : '';
}

function nowText() {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: TAIPEI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
}

function hash(value) {
  return crypto.createHash('sha256').update(clean(value)).digest('hex');
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function randomBindCode() {
  return `CP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function safeEqual(left, right) {
  const a = Buffer.from(clean(left));
  const b = Buffer.from(clean(right));
  return Boolean(a.length && a.length === b.length && crypto.timingSafeEqual(a, b));
}

function asMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function addDays(key, amount) {
  const value = new Date(`${key}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + Number(amount || 0));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function weekday(key) {
  return new Date(`${key}T12:00:00+08:00`).getDay();
}

function timeMinutes(value) {
  const match = clean(value).match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
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

function sourceId(row) {
  return clean(row && (row.id || row.sourceId || row._id || row.__id));
}

function sourcePhone(row) {
  return clean(row && (
    row.phone || row.mobile || row.tel || row.telephone ||
    row.contactPhone || row.parentPhone || row.guardianPhone
  ));
}

function sourceActive(row) {
  const value = row && (row.active != null ? row.active : row.status);
  if (value == null || value === '') return true;
  return !['false', '停用', '離職', '註銷', 'inactive', 'disabled'].includes(clean(value).toLowerCase());
}

function firstArray(row, keys) {
  for (const key of keys) {
    if (Array.isArray(row && row[key])) return row[key].map(clean).filter(Boolean);
  }
  return [];
}

async function mirrorRows(type) {
  const snapshot = await db.collection(MIRROR[type]).where('sourceActive', '==', true).get();
  return snapshot.docs
    .map((doc) => Object.assign({ __id: doc.id }, jsonValue((doc.data() || {}).source) || {}))
    .filter(Boolean);
}

async function mirrorRowsByField(type, field, value) {
  const snapshot = await db.collection(MIRROR[type]).where('sourceActive', '==', true).get();
  return snapshot.docs
    .map((doc) => Object.assign({ __id: doc.id }, jsonValue((doc.data() || {}).source) || {}))
    .filter((row) => clean(row[field]) === clean(value));
}

function assertInput(value, label) {
  if (!clean(value)) throw new HttpsError('invalid-argument', `請填寫${label}。`);
}

async function consumeRateLimit(kind, phone) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  const ref = db.collection('coursePortalRateLimits').doc(hash(`${kind}|${normalizePhone(phone)}|${day}`));
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const count = Number(snapshot.exists && snapshot.data().count || 0);
    if (count >= 8) throw new HttpsError('resource-exhausted', '今天嘗試次數過多，請聯絡管理者協助綁定。');
    tx.set(ref, {
      kind,
      count: count + 1,
      day,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function findPerson(type, name, phone) {
  const rows = await mirrorRows(type);
  const wantedName = normalizeName(name);
  const matches = rows.filter((row) =>
    sourceActive(row) &&
    normalizeName(row.name || row.teacherName || row.studentName) === wantedName &&
    phoneMatches(sourcePhone(row), phone)
  );
  if (!matches.length) throw new HttpsError('not-found', '姓名與電話找不到相符資料，請確認輸入內容或請管理者協助。');
  if (matches.length > 1) throw new HttpsError('failed-precondition', '找到多筆相同資料，請由管理者確認後綁定。');
  return matches[0];
}

async function createBindCode({ type, targetId, name, phone, relationship, renterId }) {
  const code = randomBindCode();
  const expiresAt = Timestamp.fromMillis(Date.now() + 20 * 60 * 1000);
  await db.collection('coursePortalBindCodes').doc(hash(code)).set({
    codeHint: code.slice(-4),
    type,
    targetId: clean(targetId),
    renterId: clean(renterId),
    name: clean(name),
    phoneHash: hash(normalizePhone(phone)),
    relationship: clean(relationship),
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt
  });
  const labels = {
    teacher: '老師入口',
    student: '學生綁定',
    renter: '租用綁定'
  };
  const bindText = `柚子${labels[type]} ${code}`;
  return {
    ok: true,
    code,
    bindText,
    expiresAt: expiresAt.toDate().toISOString(),
    lineUrl: `https://line.me/R/msg/text/?${encodeURIComponent(bindText)}`
  };
}

async function startBinding(data) {
  const type = clean(data.type).toLowerCase();
  const name = clean(data.name);
  const phone = normalizePhone(data.phone);
  assertInput(name, '姓名');
  assertInput(phone, '電話');
  if (!['teacher', 'student', 'renter'].includes(type)) {
    throw new HttpsError('invalid-argument', '不支援的入口類型。');
  }
  await consumeRateLimit(type, phone);

  if (type === 'teacher') {
    const teacher = await findPerson('teachers', name, phone);
    return createBindCode({ type, targetId: sourceId(teacher), name, phone });
  }
  if (type === 'student') {
    const student = await findPerson('students', name, phone);
    return createBindCode({
      type,
      targetId: sourceId(student),
      name,
      phone,
      relationship: clean(data.relationship) || '本人'
    });
  }

  const renterId = hash(`${normalizeName(name)}|${phone}`).slice(0, 32);
  await db.collection('coursePortalRenters').doc(renterId).set({
    renterId,
    name,
    phone,
    source: 'public-registration',
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
    createdAtText: nowText()
  }, { merge: true });
  return createBindCode({ type, renterId, name, phone });
}

function bindingCollection(type) {
  if (type === 'teacher') return 'coursePortalTeacherBindings';
  if (type === 'student') return 'coursePortalStudentBindings';
  return 'coursePortalRenterBindings';
}

async function issueAccessToken({ type, lineUserId, targetId, renterId }) {
  const raw = randomToken(32);
  const expiresAt = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
  await db.collection('coursePortalAccessTokens').doc(hash(raw)).set({
    type,
    lineUserId,
    targetId: clean(targetId),
    renterId: clean(renterId),
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt
  });
  return raw;
}

async function activeStudentIdsForLine(lineUserId) {
  const snapshot = await db.collection('coursePortalStudentBindings')
    .where('lineUserId', '==', lineUserId)
    .where('status', '==', 'active')
    .get();
  return [...new Set(snapshot.docs.map((doc) => clean(doc.data().studentId)).filter(Boolean))];
}

async function handleCoursePortalLineEvent(event, helpers = {}) {
  const text = clean(event && event.message && event.message.text);
  const match = text.match(/^柚子(老師入口|學生綁定|租用綁定)\s+(CP-[A-Z0-9]+)$/i);
  if (!match) return false;

  const typeMap = { 老師入口: 'teacher', 學生綁定: 'student', 租用綁定: 'renter' };
  const type = typeMap[match[1]];
  const code = match[2].toUpperCase();
  const lineUserId = clean(event && event.source && event.source.userId);
  const replyToken = clean(event && event.replyToken);
  const reply = helpers.replyLineMessage;
  if (!lineUserId || typeof reply !== 'function') return true;

  const codeRef = db.collection('coursePortalBindCodes').doc(hash(code));
  const codeSnapshot = await codeRef.get();
  const row = codeSnapshot.exists ? codeSnapshot.data() || {} : null;
  if (!row || row.status !== 'pending' || row.type !== type || asMillis(row.expiresAt) < Date.now()) {
    await reply(replyToken, '這組綁定碼無效或已逾時，請回到入口頁重新取得。');
    return true;
  }

  let profile = {};
  if (typeof helpers.getLineProfile === 'function') {
    try { profile = await helpers.getLineProfile(lineUserId) || {}; } catch (_) { profile = {}; }
  }

  const bindId = type === 'student'
    ? hash(`${row.targetId}|${lineUserId}`)
    : hash(lineUserId);
  const bindRef = db.collection(bindingCollection(type)).doc(bindId);
  const payload = {
    type,
    lineUserId,
    lineDisplayName: clean(profile.displayName),
    status: 'active',
    updatedAt: FieldValue.serverTimestamp(),
    boundAt: FieldValue.serverTimestamp(),
    reminderLastLesson: true,
    reminderPayment: true
  };
  if (type === 'teacher') payload.teacherId = clean(row.targetId);
  if (type === 'student') {
    payload.studentId = clean(row.targetId);
    payload.relationship = clean(row.relationship) || '本人';
  }
  if (type === 'renter') payload.renterId = clean(row.renterId);
  await bindRef.set(payload, { merge: true });
  await codeRef.set({ status: 'used', usedAt: FieldValue.serverTimestamp(), lineUserId }, { merge: true });

  const access = await issueAccessToken({
    type,
    lineUserId,
    targetId: clean(row.targetId),
    renterId: clean(row.renterId)
  });
  const page = type === 'teacher'
    ? 'teacher-course-portal.html'
    : (type === 'student' ? 'student-course-portal.html' : 'room-booking.html');
  const url = `${PORTAL_BASE}/${page}?access=${encodeURIComponent(access)}`;
  const label = type === 'teacher' ? '老師課務入口' : (type === 'student' ? '學生／家長入口' : '教室租用入口');
  await reply(replyToken, `綁定完成。\n請開啟「${label}」：\n${url}\n\n此連結只能使用一次，之後這台裝置會保留登入狀態。`);
  return true;
}

async function exchangeAccessToken(data) {
  const raw = clean(data.accessToken);
  if (!raw) throw new HttpsError('invalid-argument', '缺少一次性登入碼。');
  const ref = db.collection('coursePortalAccessTokens').doc(hash(raw));
  let source = null;
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    source = snapshot.exists ? snapshot.data() || {} : null;
    if (!source || source.status !== 'active' || asMillis(source.expiresAt) < Date.now()) {
      throw new HttpsError('permission-denied', '登入連結無效或已使用，請重新綁定。');
    }
    tx.set(ref, { status: 'used', usedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  const session = randomToken(36);
  const expiresAt = Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const sessionPayload = {
    role: source.type,
    lineUserId: source.lineUserId,
    teacherId: source.type === 'teacher' ? clean(source.targetId) : '',
    renterId: source.type === 'renter' ? clean(source.renterId) : '',
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: FieldValue.serverTimestamp(),
    expiresAt
  };
  if (source.type === 'student') {
    sessionPayload.studentIds = await activeStudentIdsForLine(source.lineUserId);
  }
  await db.collection('coursePortalSessions').doc(hash(session)).set(sessionPayload);
  return {
    ok: true,
    sessionToken: session,
    role: source.type,
    expiresAt: expiresAt.toDate().toISOString()
  };
}

async function requireSession(data, allowedRoles) {
  const raw = clean(data && data.sessionToken);
  if (!raw) throw new HttpsError('unauthenticated', '請先完成 LINE 綁定。');
  const ref = db.collection('coursePortalSessions').doc(hash(raw));
  const snapshot = await ref.get();
  const session = snapshot.exists ? snapshot.data() || {} : null;
  if (!session || session.status !== 'active' || asMillis(session.expiresAt) < Date.now()) {
    throw new HttpsError('unauthenticated', '登入狀態已到期，請重新綁定。');
  }
  if (allowedRoles && !allowedRoles.includes(session.role)) {
    throw new HttpsError('permission-denied', '這個帳號沒有此頁面權限。');
  }
  await ref.set({ lastUsedAt: FieldValue.serverTimestamp() }, { merge: true });
  return session;
}

function eventDate(row) {
  return dateKey(row.date || row.courseDate || row.startDate || row.lessonDate);
}

function eventStart(row) {
  return clean(row.startTime || row.timeStart || row.beginTime || row.start || '10:00').slice(0, 5);
}

function eventEnd(row) {
  return clean(row.endTime || row.timeEnd || row.finishTime || row.end || '11:00').slice(0, 5);
}

function eventTeacherId(row) {
  return clean(row.teacherId || row.teacher_id || row.instructorId);
}

function eventRoomId(row) {
  return clean(row.roomId || row.room_id || row.classroomId);
}

function eventStudentIds(row) {
  return firstArray(row, ['studentIds', 'students', 'student_ids']).concat(
    clean(row.studentId) ? [clean(row.studentId)] : []
  );
}

function eventSubjectId(row) {
  return clean(row.subjectId || row.subject_id || row.courseId);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return timeMinutes(aStart) < timeMinutes(bEnd) && timeMinutes(bStart) < timeMinutes(aEnd);
}

function publicEvent(row, maps, ownTeacherId) {
  const teacherId = eventTeacherId(row);
  const studentIds = eventStudentIds(row);
  const isOwn = Boolean(ownTeacherId && teacherId === ownTeacherId);
  return {
    id: sourceId(row),
    sourceId: sourceId(row),
    fixedCourseId: clean(row.fixedCourseId || row.courseId || row.scheduleId),
    date: eventDate(row),
    startTime: eventStart(row),
    endTime: eventEnd(row),
    roomId: eventRoomId(row),
    roomName: clean(maps.rooms[eventRoomId(row)] && maps.rooms[eventRoomId(row)].name),
    teacherId,
    teacherName: isOwn ? clean(maps.teachers[teacherId] && maps.teachers[teacherId].name) : '',
    studentIds: isOwn ? studentIds : [],
    studentNames: isOwn ? studentIds.map((id) => clean(maps.students[id] && maps.students[id].name)).filter(Boolean) : [],
    subjectId: eventSubjectId(row),
    subjectName: clean(maps.subjects[eventSubjectId(row)] && maps.subjects[eventSubjectId(row)].name),
    status: clean(row.status || 'scheduled'),
    type: clean(row.type || row.kind || 'lesson'),
    own: isOwn,
    busy: !isOwn
  };
}

function indexById(rows) {
  return rows.reduce((acc, row) => {
    const id = sourceId(row);
    if (id) acc[id] = row;
    return acc;
  }, {});
}

async function scheduleBundle(startDate, endDate, ownTeacherId) {
  const [rooms, subjects, students, teachers, events, fixed, temporary, rentals, changes] = await Promise.all([
    mirrorRows('rooms'),
    mirrorRows('subjects'),
    mirrorRows('students'),
    mirrorRows('teachers'),
    mirrorRows('events'),
    mirrorRows('fixedCourses'),
    mirrorRows('temporaryCourses'),
    mirrorRows('roomRentals'),
    db.collection('coursePortalScheduleChanges').where('active', '==', true).get()
  ]);
  const maps = {
    rooms: indexById(rooms),
    subjects: indexById(subjects),
    students: indexById(students),
    teachers: indexById(teachers)
  };
  const exact = [...events, ...temporary, ...rentals]
    .filter((row) => eventDate(row) >= startDate && eventDate(row) <= endDate);
  const exactKeys = new Set(exact.map((row) => `${sourceId(row)}|${eventDate(row)}`));
  const expanded = [];
  fixed.forEach((row) => {
    const start = eventDate(row);
    if (!start) return;
    const finalDate = dateKey(row.endDate || row.recurrenceEndDate) || endDate;
    const interval = Math.max(1, Number(row.frequencyWeeks || row.intervalWeeks || 1));
    for (let key = start; key <= endDate && key <= finalDate; key = addDays(key, interval * 7)) {
      if (key < startDate) continue;
      const statusByDate = row.statusByDate || row.exceptions || {};
      const status = clean(statusByDate[key] && (statusByDate[key].status || statusByDate[key]));
      if (['cancelled', 'leave', '註銷', '請假'].includes(status.toLowerCase())) continue;
      const clone = Object.assign({}, row, { date: key, __id: `${sourceId(row)}@${key}`, fixedCourseId: sourceId(row) });
      if (!exactKeys.has(`${sourceId(row)}|${key}`)) expanded.push(clone);
    }
  });
  const overlay = changes.docs.map((doc) => Object.assign({ __id: doc.id }, jsonValue(doc.data()) || {}));
  const removed = new Set(overlay.filter((row) => row.action === 'single_move' || row.action === 'cancel')
    .flatMap((row) => [
      `${clean(row.sourceEventId)}|${dateKey(row.sourceDate)}`,
      `${clean(row.sourceCourseId)}|${dateKey(row.sourceDate)}`
    ]));
  const permanent = overlay.filter((row) => row.action === 'permanent_move' && row.event);
  const base = [...exact, ...expanded].filter((row) =>
    !removed.has(`${clean(row.fixedCourseId || sourceId(row))}|${eventDate(row)}`) &&
    !removed.has(`${sourceId(row)}|${eventDate(row)}`) &&
    !permanent.some((change) =>
      clean(change.sourceCourseId || change.sourceEventId) === clean(row.fixedCourseId || sourceId(row)) &&
      eventDate(row) >= dateKey(change.sourceDate || change.effectiveDate)
    )
  );
  overlay.forEach((row) => {
    if (row.action === 'permanent_move' && row.event) {
      for (let key = eventDate(row.event); key && key <= endDate; key = addDays(key, 7)) {
        if (key >= startDate) base.push(Object.assign({}, row.event, { date: key, __id: `${row.__id}@${key}` }));
      }
    } else if (row.event && eventDate(row.event) >= startDate && eventDate(row.event) <= endDate) {
      base.push(Object.assign({ __id: row.__id }, row.event));
    }
  });
  return {
    rooms,
    subjects,
    students,
    teachers,
    maps,
    events: base.map((row) => publicEvent(row, maps, ownTeacherId))
  };
}

async function teacherPortalData(data) {
  const session = await requireSession(data, ['teacher']);
  const start = dateKey(data.weekStart);
  if (!start) throw new HttpsError('invalid-argument', '週起始日期格式錯誤。');
  const end = addDays(start, 6);
  const month = clean(data.month).match(/^\d{4}-\d{2}$/) ? clean(data.month) : start.slice(0, 7);
  const bundle = await scheduleBundle(start, end, session.teacherId);
  const teacher = bundle.maps.teachers[session.teacherId];
  if (!teacher) throw new HttpsError('not-found', '找不到已綁定老師資料。');
  const ownEvents = bundle.events.filter((row) => row.teacherId === session.teacherId);
  const [allFixed, allTemporary] = await Promise.all([mirrorRows('fixedCourses'), mirrorRows('temporaryCourses')]);
  const studentIds = [...new Set(
    [...allFixed, ...allTemporary]
      .filter((row) => eventTeacherId(row) === session.teacherId)
      .flatMap(eventStudentIds)
      .concat(ownEvents.flatMap((row) => row.studentIds))
  )];
  const roster = studentIds.map((id) => {
    const student = bundle.maps.students[id] || {};
    return { id, name: clean(student.name), phoneLast4: normalizePhone(sourcePhone(student)).slice(-4) };
  }).filter((row) => row.name);
  const [payroll, adjustments] = await Promise.all([
    mirrorRowsByField('teacherPayroll', 'teacherId', session.teacherId),
    mirrorRowsByField('teacherAdjustments', 'teacherId', session.teacherId)
  ]);
  return {
    ok: true,
    teacher: {
      id: session.teacherId,
      name: clean(teacher.name),
      phoneLast4: normalizePhone(sourcePhone(teacher)).slice(-4),
      subjectIds: firstArray(teacher, ['subjectIds', 'subjects'])
    },
    week: { start, end },
    hours: { start: 10, end: 21, closedWeekday: 2 },
    rooms: bundle.rooms.map((room) => ({
      id: sourceId(room),
      name: clean(room.name),
      rentalFee: Number(room.rentalFee || room.price || 0),
      allowedSubjectIds: firstArray(room, ['allowedSubjectIds', 'subjectIds'])
    })),
    subjects: bundle.subjects.map((subject) => ({ id: sourceId(subject), name: clean(subject.name) })),
    events: bundle.events,
    roster,
    payroll: payroll.filter((row) => clean(row.month || row.payrollMonth || eventDate(row).slice(0, 7)) === month),
    adjustments: adjustments.filter((row) => clean(row.month || row.payrollMonth || eventDate(row).slice(0, 7)) === month)
  };
}

async function studentPortalData(data) {
  const session = await requireSession(data, ['student']);
  const currentIds = await activeStudentIdsForLine(session.lineUserId);
  const requested = clean(data.studentId);
  if (requested && !currentIds.includes(requested)) throw new HttpsError('permission-denied', '沒有這位學生的查看權限。');
  const studentIds = requested ? [requested] : currentIds;
  const [students, periods, attendance, events, teachers, subjects, bindings] = await Promise.all([
    mirrorRows('students'),
    mirrorRows('tuitionPeriods'),
    mirrorRows('attendance'),
    mirrorRows('events'),
    mirrorRows('teachers'),
    mirrorRows('subjects'),
    db.collection('coursePortalStudentBindings').where('lineUserId', '==', session.lineUserId).where('status', '==', 'active').get()
  ]);
  const maps = { teachers: indexById(teachers), subjects: indexById(subjects) };
  const allowed = new Set(studentIds);
  const selectedStudents = students.filter((row) => allowed.has(sourceId(row))).map((row) => ({
    id: sourceId(row),
    name: clean(row.name),
    phoneLast4: normalizePhone(sourcePhone(row)).slice(-4)
  }));
  return {
    ok: true,
    students: selectedStudents,
    bindings: bindings.docs.map((doc) => {
      const row = doc.data() || {};
      return {
        studentId: clean(row.studentId),
        relationship: clean(row.relationship),
        reminderLastLesson: row.reminderLastLesson !== false,
        reminderPayment: row.reminderPayment !== false
      };
    }),
    periods: periods.filter((row) => allowed.has(clean(row.studentId))).map((row) => ({
      id: sourceId(row),
      studentId: clean(row.studentId),
      periodNo: Number(row.periodNo || row.period || 0),
      subjectId: clean(row.subjectId),
      subjectName: clean(maps.subjects[clean(row.subjectId)] && maps.subjects[clean(row.subjectId)].name),
      teacherId: clean(row.teacherId),
      teacherName: clean(maps.teachers[clean(row.teacherId)] && maps.teachers[clean(row.teacherId)].name),
      lessonCount: Number(row.lessonCount || row.totalLessons || 4),
      usedCount: Number(row.usedCount || row.attendedCount || 0),
      expectedAmount: Number(row.expectedAmount || row.amount || 0),
      paidAmount: Number(row.paidAmount || row.receivedAmount || 0),
      status: clean(row.status),
      transactions: jsonValue(row.transactions || [])
    })),
    attendance: attendance.filter((row) => allowed.has(clean(row.studentId))).map((row) => ({
      id: sourceId(row),
      studentId: clean(row.studentId),
      date: eventDate(row),
      status: clean(row.status || row.type),
      teacherName: clean(maps.teachers[eventTeacherId(row)] && maps.teachers[eventTeacherId(row)].name)
    })),
    upcoming: events.filter((row) =>
      eventDate(row) >= new Intl.DateTimeFormat('en-CA', {
        timeZone: TAIPEI, year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date()) &&
      eventStudentIds(row).some((id) => allowed.has(id))
    ).slice(0, 30).map((row) => ({
      id: sourceId(row),
      date: eventDate(row),
      startTime: eventStart(row),
      endTime: eventEnd(row),
      studentIds: eventStudentIds(row),
      subjectName: clean(maps.subjects[eventSubjectId(row)] && maps.subjects[eventSubjectId(row)].name),
      teacherName: clean(maps.teachers[eventTeacherId(row)] && maps.teachers[eventTeacherId(row)].name),
      status: clean(row.status)
    }))
  };
}

async function rentalAvailability(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const date = dateKey(data.date);
  const startTime = clean(data.startTime).slice(0, 5);
  const duration = Math.min(240, Math.max(30, Number(data.durationMinutes || 60)));
  const startMinutes = timeMinutes(startTime);
  const endMinutes = startMinutes + duration;
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  if (!date || !startTime) throw new HttpsError('invalid-argument', '請選擇日期與時間。');
  if (weekday(date) === 2) throw new HttpsError('failed-precondition', '星期二為公休日，不能預約。');
  if (startMinutes < 600 || endMinutes > 1260) throw new HttpsError('failed-precondition', '可預約時間為 10:00～21:00。');
  const bundle = await scheduleBundle(date, date, session.role === 'teacher' ? session.teacherId : '');
  const subjectId = clean(data.subjectId);
  const roomSettings = await db.collection('coursePortalRoomSettings').get();
  const settingsMap = {};
  roomSettings.docs.forEach((doc) => { settingsMap[doc.id] = doc.data() || {}; });
  const rooms = bundle.rooms.filter(sourceActive).map((room) => {
    const id = sourceId(room);
    const setting = settingsMap[id] || {};
    const allowed = firstArray(setting, ['allowedSubjectIds']).length
      ? firstArray(setting, ['allowedSubjectIds'])
      : firstArray(room, ['allowedSubjectIds', 'subjectIds']);
    const blocked = bundle.events.some((event) =>
      event.roomId === id && event.date === date &&
      overlaps(startTime, endTime, event.startTime, event.endTime)
    );
    const compatible = !subjectId || !allowed.length || allowed.includes(subjectId);
    const baseFee = Number(setting.rentalFee != null ? setting.rentalFee : (room.rentalFee || room.price || 0));
    const studentRate = session.role === 'student';
    return {
      id,
      name: clean(room.name),
      available: !blocked && compatible && setting.rentable !== false,
      reason: blocked ? '時段已被使用' : (!compatible ? '這間教室不適用此科目' : ''),
      unitFee: baseFee,
      price: Math.round(baseFee * duration / 60 * (studentRate ? 0.5 : 1)),
      priceType: studentRate ? '本校學生半價' : '一般價格'
    };
  });
  return {
    ok: true,
    date,
    startTime,
    endTime,
    durationMinutes: duration,
    subjects: bundle.subjects.map((row) => ({ id: sourceId(row), name: clean(row.name) })),
    rooms
  };
}

async function createRoomBooking(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const availability = await rentalAvailability(data);
  const room = availability.rooms.find((item) => item.id === clean(data.roomId));
  if (!room || !room.available) throw new HttpsError('failed-precondition', room && room.reason || '這間教室目前不能預約。');
  const id = db.collection('coursePortalRoomBookings').doc().id;
  const studentIds = session.role === 'student' ? await activeStudentIdsForLine(session.lineUserId) : [];
  const booking = {
    id,
    type: 'room_rental',
    date: availability.date,
    startTime: availability.startTime,
    endTime: availability.endTime,
    roomId: room.id,
    subjectId: clean(data.subjectId),
    purpose: clean(data.purpose),
    role: session.role,
    teacherId: clean(session.teacherId),
    renterId: clean(session.renterId),
    studentIds,
    lineUserId: session.lineUserId,
    amount: room.price,
    paymentStatus: 'onsite_unpaid',
    status: 'confirmed',
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    createdAtText: nowText()
  };
  await db.collection('coursePortalRoomBookings').doc(id).set(booking);
  await db.collection('coursePortalScheduleChanges').doc(`rental-${id}`).set({
    action: 'room_booking',
    active: true,
    event: booking,
    createdAt: FieldValue.serverTimestamp()
  });
  return { ok: true, booking: jsonValue(booking) };
}

async function teacherAction(data) {
  const session = await requireSession(data, ['teacher']);
  const action = clean(data.action);
  if (!['single_move', 'permanent_move', 'extra_lesson', 'teacher_gift'].includes(action)) {
    throw new HttpsError('invalid-argument', '不支援的課務操作。');
  }
  const date = dateKey(data.date);
  const startTime = clean(data.startTime).slice(0, 5);
  const endTime = clean(data.endTime).slice(0, 5);
  const roomId = clean(data.roomId);
  const studentId = clean(data.studentId);
  if (!date || !startTime || !endTime || !roomId || !studentId) {
    throw new HttpsError('invalid-argument', '請完整選擇學生、日期、時間與教室。');
  }
  if (weekday(date) === 2) throw new HttpsError('failed-precondition', '星期二為公休日。');
  const bundle = await scheduleBundle(date, date, session.teacherId);
  const [allFixed, allTemporary] = await Promise.all([mirrorRows('fixedCourses'), mirrorRows('temporaryCourses')]);
  const ownStudent = [...allFixed, ...allTemporary].some((row) =>
    eventTeacherId(row) === session.teacherId && eventStudentIds(row).includes(studentId)
  ) || bundle.events.some((event) =>
    event.teacherId === session.teacherId && event.studentIds.includes(studentId)
  );
  if (!ownStudent) throw new HttpsError('permission-denied', '老師只能操作自己的學生。');
  const conflict = bundle.events.find((event) =>
    event.roomId === roomId && overlaps(startTime, endTime, event.startTime, event.endTime) &&
    event.id !== clean(data.sourceEventId)
  );
  if (conflict) throw new HttpsError('already-exists', '所選教室時段已被使用。');
  const event = {
    id: randomToken(12),
    date,
    startTime,
    endTime,
    roomId,
    teacherId: session.teacherId,
    studentId,
    studentIds: [studentId],
    subjectId: clean(data.subjectId),
    type: action === 'teacher_gift' ? 'teacher_gift' : 'temporary',
    status: 'scheduled',
    paymentStatus: action === 'teacher_gift' ? 'teacher_gift_no_charge' : clean(data.paymentStatus || 'not_applicable'),
    teacherPayable: action !== 'teacher_gift',
    note: clean(data.note)
  };
  const id = db.collection('coursePortalScheduleChanges').doc().id;
  await db.collection('coursePortalScheduleChanges').doc(id).set({
    id,
    action,
    active: true,
    sourceEventId: clean(data.sourceEventId),
    sourceDate: dateKey(data.sourceDate),
    sourceCourseId: clean(data.sourceCourseId),
    effectiveDate: action === 'permanent_move' ? date : '',
    event,
    createdByTeacherId: session.teacherId,
    createdAt: FieldValue.serverTimestamp(),
    createdAtText: nowText()
  });
  return { ok: true, id, event };
}

async function updateStudentReminder(data) {
  const session = await requireSession(data, ['student']);
  const studentId = clean(data.studentId);
  const allowed = await activeStudentIdsForLine(session.lineUserId);
  if (!allowed.includes(studentId)) throw new HttpsError('permission-denied', '沒有這位學生的權限。');
  const ref = db.collection('coursePortalStudentBindings').doc(hash(`${studentId}|${session.lineUserId}`));
  await ref.set({
    reminderLastLesson: data.reminderLastLesson !== false,
    reminderPayment: data.reminderPayment !== false,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
}

function assertAdminPin(request) {
  const value = clean(request && request.data && request.data.adminPin);
  let expected = '';
  try { expected = clean(ADMIN_PIN.value()); } catch (_) { expected = clean(process.env.INJIAOYUN_MANUAL_SYNC_PIN); }
  if (!expected || !safeEqual(value, expected)) throw new HttpsError('permission-denied', '管理密碼錯誤。');
}

async function adminData() {
  const [teachers, students, renters, teacherRows, studentRows, renterRows] = await Promise.all([
    db.collection('coursePortalTeacherBindings').get(),
    db.collection('coursePortalStudentBindings').get(),
    db.collection('coursePortalRenterBindings').get(),
    mirrorRows('teachers'),
    mirrorRows('students'),
    db.collection('coursePortalRenters').get()
  ]);
  const teacherMap = indexById(teacherRows);
  const studentMap = indexById(studentRows);
  const renterMap = {};
  renterRows.docs.forEach((doc) => { renterMap[doc.id] = doc.data() || {}; });
  const map = (snapshot) => snapshot.docs.map((doc) => {
    const row = doc.data() || {};
    const targetName = row.type === 'teacher'
      ? clean(teacherMap[clean(row.teacherId)] && teacherMap[clean(row.teacherId)].name)
      : (row.type === 'student'
        ? clean(studentMap[clean(row.studentId)] && studentMap[clean(row.studentId)].name)
        : clean(renterMap[clean(row.renterId)] && renterMap[clean(row.renterId)].name));
    return {
      id: doc.id,
      type: clean(row.type),
      status: clean(row.status),
      targetName,
      lineDisplayName: clean(row.lineDisplayName),
      relationship: clean(row.relationship),
      teacherId: clean(row.teacherId),
      studentId: clean(row.studentId),
      renterId: clean(row.renterId),
      boundAt: jsonValue(row.boundAt),
      reminderLastLesson: row.reminderLastLesson !== false,
      reminderPayment: row.reminderPayment !== false
    };
  });
  return { ok: true, bindings: [...map(teachers), ...map(students), ...map(renters)] };
}

async function adminBindingAction(data) {
  const type = clean(data.type);
  const id = clean(data.id);
  if (!['teacher', 'student', 'renter'].includes(type) || !id) throw new HttpsError('invalid-argument', '綁定資料不完整。');
  const status = clean(data.action) === 'restore' ? 'active' : 'revoked';
  await db.collection(bindingCollection(type)).doc(id).set({
    status,
    revokedAt: status === 'revoked' ? FieldValue.serverTimestamp() : null,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  if (status === 'revoked') {
    const snapshot = await db.collection(bindingCollection(type)).doc(id).get();
    const row = snapshot.data() || {};
    const sessions = await db.collection('coursePortalSessions').where('lineUserId', '==', clean(row.lineUserId)).get();
    const batch = db.batch();
    sessions.docs.forEach((doc) => batch.set(doc.ref, { status: 'revoked' }, { merge: true }));
    await batch.commit();
  }
  return { ok: true, status };
}

async function dailyStudentReminders(pushLineMessage) {
  if (typeof pushLineMessage !== 'function') return;
  const [bindings, periods, students] = await Promise.all([
    db.collection('coursePortalStudentBindings').where('status', '==', 'active').get(),
    mirrorRows('tuitionPeriods'),
    mirrorRows('students')
  ]);
  const studentMap = indexById(students);
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  for (const doc of bindings.docs) {
    const binding = doc.data() || {};
    const studentId = clean(binding.studentId);
    const studentPeriods = periods.filter((row) => clean(row.studentId) === studentId && !['closed', 'completed'].includes(clean(row.status).toLowerCase()));
    const lastLesson = studentPeriods.find((row) => Number(row.lessonCount || 4) - Number(row.usedCount || 0) === 1);
    const unpaid = studentPeriods.find((row) => Number(row.expectedAmount || row.amount || 0) > Number(row.paidAmount || row.receivedAmount || 0));
    const messages = [];
    if (binding.reminderLastLesson !== false && lastLesson) messages.push('目前課程剩最後一堂，請留意續課安排。');
    if (binding.reminderPayment !== false && unpaid) messages.push('目前有尚未繳清的學費，金額請以現場確認為準。');
    if (!messages.length) continue;
    const logRef = db.collection('coursePortalReminderLogs').doc(hash(`${day}|${studentId}|${binding.lineUserId}|${messages.join('|')}`));
    if ((await logRef.get()).exists) continue;
    const name = clean(studentMap[studentId] && studentMap[studentId].name) || '學生';
    await pushLineMessage(binding.lineUserId, `${name}課務提醒\n${messages.join('\n')}`);
    await logRef.set({ day, studentId, lineUserId: binding.lineUserId, messages, sentAt: FieldValue.serverTimestamp() });
  }
}

async function appendCoursePortalData(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const [changes, bookings] = await Promise.all([
    db.collection('coursePortalScheduleChanges').where('active', '==', true).get(),
    db.collection('coursePortalRoomBookings').where('active', '==', true).get()
  ]);
  const changeRows = changes.docs.map((doc) => Object.assign({ id: doc.id }, jsonValue(doc.data()) || {}));
  const removed = new Set(changeRows.filter((row) => row.action === 'single_move' || row.action === 'cancel')
    .flatMap((row) => [
      `${clean(row.sourceEventId)}|${dateKey(row.sourceDate)}`,
      `${clean(row.sourceCourseId)}|${dateKey(row.sourceDate)}`
    ]));
  if (Array.isArray(payload.events)) {
    payload.events = payload.events.filter((row) =>
      !removed.has(`${sourceId(row)}|${eventDate(row)}`) &&
      !removed.has(`${clean(row.fixedCourseId || row.courseId || row.scheduleId)}|${eventDate(row)}`)
    );
  }
  payload.fixedCourses = Array.isArray(payload.fixedCourses) ? payload.fixedCourses : [];
  changeRows.filter((row) => row.action === 'single_move' || row.action === 'cancel').forEach((row) => {
    const course = payload.fixedCourses.find((item) =>
      sourceId(item) === clean(row.sourceCourseId || row.sourceEventId)
    );
    if (!course || !dateKey(row.sourceDate)) return;
    course.statusByDate = Object.assign({}, course.statusByDate || {}, {
      [dateKey(row.sourceDate)]: { status: 'cancelled', source: 'course-portal' }
    });
  });
  changeRows.filter((row) => row.action === 'permanent_move' && row.event).forEach((row) => {
    const courseId = clean(row.sourceCourseId || row.sourceEventId);
    const course = payload.fixedCourses.find((item) => sourceId(item) === courseId);
    const sourceDate = dateKey(row.sourceDate || row.effectiveDate);
    if (course && sourceDate) {
      course.recurrenceEndDate = addDays(sourceDate, -1);
      course.endDate = addDays(sourceDate, -1);
    }
    payload.fixedCourses.push(Object.assign({}, course || {}, row.event, {
      id: row.id,
      startDate: eventDate(row.event),
      date: eventDate(row.event),
      frequencyWeeks: 1,
      source: 'course-portal',
      portalAction: 'permanent_move'
    }));
  });
  payload.temporaryCourses = Array.isArray(payload.temporaryCourses) ? payload.temporaryCourses : [];
  changeRows.filter((row) => row.event && !['room_booking', 'permanent_move'].includes(row.action)).forEach((row) => {
    payload.temporaryCourses.push(Object.assign({}, row.event, {
      id: row.id,
      portalAction: row.action,
      source: 'course-portal'
    }));
  });
  payload.roomRentals = Array.isArray(payload.roomRentals) ? payload.roomRentals : [];
  bookings.docs.forEach((doc) => {
    const row = jsonValue(doc.data()) || {};
    payload.roomRentals.push(Object.assign({}, row, { id: doc.id, source: 'course-portal' }));
  });
  payload.portalMeta = {
    changes: changeRows.length,
    bookings: bookings.size,
    mergedAt: new Date().toISOString()
  };
  return payload;
}

function registerCoursePortal(exportsObject, helpers = {}) {
  const callable = (handler, options = {}) => onCall(Object.assign({
    region: REGION,
    cors: ALLOWED_ORIGINS,
    timeoutSeconds: 120,
    memory: '512MiB'
  }, options), async (request) => handler(request && request.data || {}, request));

  exportsObject.coursePortalStartBinding = callable(startBinding);
  exportsObject.coursePortalExchangeAccess = callable(exchangeAccessToken);
  exportsObject.coursePortalTeacherData = callable(teacherPortalData, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalStudentData = callable(studentPortalData, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalRentalAvailability = callable(rentalAvailability, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalCreateRoomBooking = callable(createRoomBooking, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherAction = callable(teacherAction, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalUpdateStudentReminder = callable(updateStudentReminder);
  exportsObject.coursePortalAdminData = callable(async (data, request) => {
    assertAdminPin(request);
    return adminData();
  }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalAdminBindingAction = callable(async (data, request) => {
    assertAdminPin(request);
    return adminBindingAction(data);
  }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalStudentReminderDaily = onSchedule({
    schedule: '0 10 * * *',
    timeZone: TAIPEI,
    region: REGION,
    timeoutSeconds: 180,
    memory: '512MiB'
  }, async () => dailyStudentReminders(helpers.pushLineMessage));
}

module.exports = {
  appendCoursePortalData,
  handleCoursePortalLineEvent,
  normalizePhone,
  phoneMatches,
  registerCoursePortal
};
