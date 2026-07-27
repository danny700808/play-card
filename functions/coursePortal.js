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
const RENTAL_USE_OPTIONS = Object.freeze([
  { id: 'guitar', name: '彈吉他／自備樂器' },
  { id: 'piano', name: '彈鋼琴' },
  { id: 'drums', name: '打鼓' },
  { id: 'band', name: '樂團／多人排練' },
  { id: 'teaching', name: '教學／會議' },
  { id: 'other', name: '其他用途' }
]);

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

function taipeiDateTimeMillis(date, time) {
  const key = dateKey(date);
  const value = clean(time).slice(0, 5);
  if (!key || !/^\d{2}:\d{2}$/.test(value)) return 0;
  const parsed = Date.parse(`${key}T${value}:00+08:00`);
  return Number.isFinite(parsed) ? parsed : 0;
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
  const label = type === 'teacher' ? '老師入口' : (type === 'student' ? '學生入口' : '教室租用入口');
  await reply(replyToken, `綁定完成。\n請開啟「${label}」：\n${url}\n\n此連結 10 分鐘內有效；登入後這台裝置會保留登入狀態。`);
  return true;
}

async function exchangeAccessToken(data) {
  const raw = clean(data.accessToken);
  if (!raw) throw new HttpsError('invalid-argument', '缺少一次性登入碼。');
  const ref = db.collection('coursePortalAccessTokens').doc(hash(raw));
  const snapshot = await ref.get();
  const source = snapshot.exists ? snapshot.data() || {} : null;
  const acceptedStatuses = ['active', 'used', 'exchanged'];
  if (!source || !acceptedStatuses.includes(clean(source.status)) || asMillis(source.expiresAt) < Date.now()) {
    throw new HttpsError('permission-denied', '登入連結已逾時，請重新取得綁定連結。');
  }

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
  // LINE 內建瀏覽器可能會重複載入網址。必須先成功建立裝置登入，
  // 再記錄交換狀態；短效連結在到期前可安全重新交換，不會卡死使用者。
  await ref.set({
    status: 'exchanged',
    lastExchangedAt: FieldValue.serverTimestamp(),
    exchangeCount: FieldValue.increment(1)
  }, { merge: true });
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

function eventBlocksResource(event) {
  const status = clean(event && event.status).toLowerCase();
  return !['leave', '請假', 'cancelled', 'canceled', 'cancel', '註銷', '作廢'].includes(status);
}

function roomSupportsSubject(room, subjectId, bundle, setting = {}) {
  if (!subjectId) return true;
  const configured = firstArray(setting, ['allowedSubjectIds']);
  const sourceConfigured = firstArray(room, ['allowedSubjectIds', 'subjectIds']);
  const allowed = configured.length ? configured : sourceConfigured;
  if (allowed.length) return allowed.includes(subjectId);
  const subject = clean(bundle.maps.subjects[subjectId] && bundle.maps.subjects[subjectId].name).toLowerCase();
  const roomName = clean(room.name).toLowerCase();
  if (/爵士鼓|電子鼓|傳統鼓|鼓組/.test(subject)) return /鼓|展演|團練/.test(roomName);
  if (/鋼琴|電子琴|keyboard|piano/.test(subject)) return /鋼琴|平台|yamaha|kawai|琴房/.test(roomName);
  return true;
}

function rentalRoomProfile(room, setting = {}) {
  const name = clean(room.name).toLowerCase();
  let useTypes = firstArray(setting, ['useTypes', 'rentalUseTypes']);
  let equipment = firstArray(setting, ['equipment', 'rentalEquipment']);
  if (!useTypes.length) useTypes = firstArray(room, ['useTypes', 'rentalUseTypes']);
  if (!equipment.length) equipment = firstArray(room, ['equipment', 'rentalEquipment']);
  if (!useTypes.length) {
    useTypes = ['guitar', 'teaching', 'other'];
    if (/鼓|展演|團練/.test(name)) useTypes.push('drums', 'band');
    if (/鋼琴|平台|yamaha|kawai|琴房/.test(name)) useTypes.push('piano');
    if (/展演|團練|表演/.test(name)) useTypes.push('band');
  }
  if (!equipment.length) {
    if (/電子鼓/.test(name)) equipment.push('electronic_drums');
    if (/傳統鼓|爵士鼓|團練/.test(name)) equipment.push('acoustic_drums');
    if (/鋼琴|平台|yamaha|kawai|琴房/.test(name)) equipment.push('piano');
  }
  const inferredCapacity = /展演|團練|表演/.test(name) ? 8 : 3;
  return {
    useTypes: [...new Set(useTypes)],
    equipment: [...new Set(equipment)],
    capacity: Math.max(1, Number(setting.capacity || room.capacity || inferredCapacity)),
    publicName: clean(setting.publicName || room.publicName || room.name)
  };
}

function rentalRoomMatch(room, setting, data) {
  const profile = rentalRoomProfile(room, setting);
  const useType = clean(data.useType);
  const equipment = clean(data.equipment);
  const partySize = Math.max(1, Number(data.partySize || 1));
  if (profile.capacity < partySize) return { compatible: false, level: '', profile, reason: `最多容納 ${profile.capacity} 人` };
  if (equipment && equipment !== 'own' && !profile.equipment.includes(equipment)) {
    return { compatible: false, level: '', profile, reason: '沒有指定設備' };
  }
  if (!useType || profile.useTypes.includes(useType)) return { compatible: true, level: 'best', profile, reason: '' };
  if (equipment === 'own' || !equipment) return { compatible: true, level: 'alternative', profile, reason: '空間仍可使用' };
  return { compatible: false, level: '', profile, reason: '不適合這項用途' };
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
    portalAction: clean(row.portalAction),
    portalChangeId: clean(row.portalChangeId),
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
  const removed = new Set(overlay.filter((row) => ['single_move', 'cancel', 'lesson_status'].includes(row.action))
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
        if (key < startDate || (row.pendingDates || []).includes(key)) continue;
        const occurrenceStatus = overlay.some((change) =>
          change.action === 'lesson_status' &&
          dateKey(change.sourceDate) === key &&
          (
            clean(change.sourceCourseId) === clean(row.sourceCourseId || row.sourceEventId) ||
            clean(change.sourceEventId) === clean(row.event.id)
          )
        );
        if (occurrenceStatus) continue;
        const roomId = clean((row.roomOverrides || {})[key] || row.event.roomId);
        base.push(Object.assign({}, row.event, {
          date: key,
          roomId,
          __id: `${row.__id}@${key}`,
          portalAction: row.action,
          portalChangeId: row.__id
        }));
      }
    } else if (row.event && eventDate(row.event) >= startDate && eventDate(row.event) <= endDate) {
      base.push(Object.assign({
        __id: row.__id,
        portalAction: clean(row.action),
        portalChangeId: row.__id
      }, row.event));
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

async function teacherAvailability(data) {
  const session = await requireSession(data, ['teacher']);
  const startDate = dateKey(data.startDate || data.date);
  if (!startDate) throw new HttpsError('invalid-argument', '開始日期格式錯誤。');
  const days = Math.min(28, Math.max(7, Number(data.days || 14)));
  const endDate = addDays(startDate, days - 1);
  const startTime = clean(data.sourceStartTime || data.startTime).slice(0, 5);
  const endTime = clean(data.sourceEndTime || data.endTime).slice(0, 5);
  const duration = Math.max(30, timeMinutes(endTime) - timeMinutes(startTime) || Number(data.durationMinutes || 60));
  const subjectId = clean(data.subjectId);
  const sourceEventId = clean(data.sourceEventId);
  const sourceCourseId = clean(data.sourceCourseId);
  const sourceDate = dateKey(data.sourceDate);
  const bundle = await scheduleBundle(startDate, endDate, session.teacherId);
  const compatibleRooms = bundle.rooms.filter(sourceActive).filter((room) =>
    roomSupportsSubject(room, subjectId, bundle)
  );
  const slots = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(startDate, offset);
    if (weekday(date) === 2) continue;
    for (let minute = 600; minute + duration <= 1260; minute += 30) {
      const slotStart = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const slotEndMinute = minute + duration;
      const slotEnd = `${String(Math.floor(slotEndMinute / 60)).padStart(2, '0')}:${String(slotEndMinute % 60).padStart(2, '0')}`;
      const blockers = bundle.events.filter((event) => {
        const sourceMatch = event.date === sourceDate && (
          event.id === sourceEventId || event.sourceId === sourceEventId ||
          event.fixedCourseId === sourceCourseId
        );
        return eventBlocksResource(event) && !sourceMatch && overlaps(slotStart, slotEnd, event.startTime, event.endTime);
      });
      if (blockers.some((event) => event.teacherId === session.teacherId)) continue;
      const rooms = compatibleRooms.filter((room) =>
        !blockers.some((event) => event.roomId === sourceId(room))
      ).map((room) => ({ id: sourceId(room), name: clean(room.name) }));
      if (rooms.length) slots.push({ date, startTime: slotStart, endTime: slotEnd, rooms });
    }
  }
  return { ok: true, startDate, endDate, durationMinutes: duration, slots };
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
    const blocked = bundle.events.some((event) =>
      eventBlocksResource(event) && event.roomId === id && event.date === date &&
      overlaps(startTime, endTime, event.startTime, event.endTime)
    );
    const rentalMatch = rentalRoomMatch(room, setting, data);
    const compatible = subjectId ? roomSupportsSubject(room, subjectId, bundle, setting) : rentalMatch.compatible;
    const baseFee = Number(setting.rentalFee != null ? setting.rentalFee : (room.rentalFee || room.price || 0));
    const studentRate = session.role === 'student';
    return {
      id,
      name: rentalMatch.profile.publicName,
      available: !blocked && compatible && setting.rentable !== false,
      reason: blocked ? '時段已被使用' : (!compatible ? rentalMatch.reason : ''),
      matchLevel: rentalMatch.level,
      capacity: rentalMatch.profile.capacity,
      equipment: rentalMatch.profile.equipment,
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
    useOptions: RENTAL_USE_OPTIONS,
    rooms: rooms.sort((a, b) => (a.matchLevel === 'best' ? 0 : 1) - (b.matchLevel === 'best' ? 0 : 1) || a.name.localeCompare(b.name, 'zh-Hant'))
  };
}

async function rentalDayBoard(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const date = dateKey(data.date);
  if (!date) throw new HttpsError('invalid-argument', '請選擇日期。');
  const bundle = await scheduleBundle(date, date, session.role === 'teacher' ? session.teacherId : '');
  const subjectId = clean(data.subjectId);
  const roomSettings = await db.collection('coursePortalRoomSettings').get();
  const settingsMap = {};
  roomSettings.docs.forEach((doc) => { settingsMap[doc.id] = doc.data() || {}; });
  const closed = weekday(date) === 2;
  const slots = [];
  for (let minute = 600; minute < 1260; minute += 30) {
    const startTime = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const next = minute + 30;
    const endTime = `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
    const availableRooms = closed ? [] : bundle.rooms.filter(sourceActive).filter((room) => {
      const id = sourceId(room);
      const setting = settingsMap[id] || {};
      const rentalMatch = rentalRoomMatch(room, setting, data);
      if (setting.rentable === false || (subjectId ? !roomSupportsSubject(room, subjectId, bundle, setting) : !rentalMatch.compatible)) return false;
      return !bundle.events.some((event) =>
        eventBlocksResource(event) && event.roomId === id && event.date === date &&
        overlaps(startTime, endTime, event.startTime, event.endTime)
      );
    }).map((room) => { const match = rentalRoomMatch(room, settingsMap[sourceId(room)] || {}, data); return { id: sourceId(room), name: match.profile.publicName, matchLevel: match.level }; });
    slots.push({
      startTime,
      endTime,
      availableCount: availableRooms.length,
      rooms: availableRooms.slice(0, 6)
    });
  }
  return {
    ok: true,
    date,
    closed,
    role: session.role,
    priceType: session.role === 'student' ? '本校學生價' : '一般價格',
    subjects: bundle.subjects.map((row) => ({ id: sourceId(row), name: clean(row.name) })),
    useOptions: RENTAL_USE_OPTIONS,
    slots
  };
}

async function rentalWeekBoard(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const startDate = dateKey(data.startDate || data.date);
  if (!startDate) throw new HttpsError('invalid-argument', '請選擇週起始日期。');
  const endDate = addDays(startDate, 6);
  const bundle = await scheduleBundle(startDate, endDate, session.role === 'teacher' ? session.teacherId : '');
  const roomSettings = await db.collection('coursePortalRoomSettings').get();
  const settingsMap = {};
  roomSettings.docs.forEach((doc) => { settingsMap[doc.id] = doc.data() || {}; });
  const days = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(startDate, offset);
    const closed = weekday(date) === 2;
    const slots = [];
    for (let minute = 600; minute < 1260; minute += 30) {
      const startTime = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const endTime = `${String(Math.floor((minute + 30) / 60)).padStart(2, '0')}:${String((minute + 30) % 60).padStart(2, '0')}`;
      const rooms = closed ? [] : bundle.rooms.filter(sourceActive).map((room) => {
        const id = sourceId(room);
        const setting = settingsMap[id] || {};
        const match = rentalRoomMatch(room, setting, data);
        const blocked = bundle.events.some((event) => eventBlocksResource(event) && event.roomId === id && event.date === date && overlaps(startTime, endTime, event.startTime, event.endTime));
        return { id, name: match.profile.publicName, matchLevel: match.level, available: setting.rentable !== false && match.compatible && !blocked };
      }).filter((room) => room.available);
      slots.push({ startTime, endTime, availableCount: rooms.length, rooms: rooms.slice(0, 8) });
    }
    days.push({ date, closed, availableSlotCount: slots.filter((slot) => slot.availableCount > 0).length, slots });
  }
  return { ok: true, startDate, endDate, role: session.role, useOptions: RENTAL_USE_OPTIONS, days };
}

async function createRoomBooking(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const availability = await rentalAvailability(data);
  if (taipeiDateTimeMillis(availability.date, availability.startTime) <= Date.now()) {
    throw new HttpsError('failed-precondition', '只能預約尚未開始的時段。');
  }
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
    roomName: room.name,
    subjectId: clean(data.subjectId),
    purpose: clean(data.purpose),
    useType: clean(data.useType),
    equipment: clean(data.equipment),
    partySize: Math.max(1, Number(data.partySize || 1)),
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

async function rentalMyBookings(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const snapshot = await db.collection('coursePortalRoomBookings')
    .where('lineUserId', '==', session.lineUserId)
    .get();
  const bookings = snapshot.docs.map((doc) => {
    const row = jsonValue(doc.data()) || {};
    return {
      id: doc.id,
      date: dateKey(row.date),
      startTime: clean(row.startTime).slice(0, 5),
      endTime: clean(row.endTime).slice(0, 5),
      roomId: clean(row.roomId),
      roomName: clean(row.roomName),
      purpose: clean(row.purpose),
      useType: clean(row.useType),
      amount: Number(row.amount || 0),
      paymentStatus: clean(row.paymentStatus),
      status: clean(row.status || (row.active === false ? 'cancelled' : 'confirmed')),
      active: row.active !== false,
      canCancel: row.active !== false && taipeiDateTimeMillis(row.date, row.startTime) > Date.now(),
      createdAtText: clean(row.createdAtText),
      cancelledAtText: clean(row.cancelledAtText)
    };
  }).filter((row) => row.date && row.startTime)
    .sort((a, b) => `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`))
    .slice(0, 100);

  if (bookings.some((row) => !row.roomName)) {
    const rooms = indexById(await mirrorRows('rooms'));
    bookings.forEach((row) => {
      if (!row.roomName) row.roomName = clean(rooms[row.roomId] && rooms[row.roomId].name);
    });
  }
  return { ok: true, bookings };
}

async function cancelRoomBooking(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const bookingId = clean(data.bookingId);
  if (!bookingId) throw new HttpsError('invalid-argument', '缺少租用紀錄。');
  const bookingRef = db.collection('coursePortalRoomBookings').doc(bookingId);
  const changeRef = db.collection('coursePortalScheduleChanges').doc(`rental-${bookingId}`);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(bookingRef);
    if (!snapshot.exists) throw new HttpsError('not-found', '找不到這筆租用紀錄。');
    const booking = snapshot.data() || {};
    if (clean(booking.lineUserId) !== clean(session.lineUserId)) {
      throw new HttpsError('permission-denied', '只能取消自己預約的教室。');
    }
    if (booking.active === false || clean(booking.status) === 'cancelled') {
      throw new HttpsError('failed-precondition', '這筆租用已經取消。');
    }
    if (taipeiDateTimeMillis(booking.date, booking.startTime) <= Date.now()) {
      throw new HttpsError('failed-precondition', '課程開始後不能自行取消，請聯絡櫃台。');
    }
    tx.set(bookingRef, {
      active: false,
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledAtText: nowText(),
      cancelledBy: session.role
    }, { merge: true });
    tx.set(changeRef, {
      active: false,
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: session.role
    }, { merge: true });
  });
  return { ok: true, bookingId, status: 'cancelled' };
}

async function teacherLessonState(data) {
  const session = await requireSession(data, ['teacher']);
  const state = clean(data.state);
  const portalChangeId = clean(data.portalChangeId);
  if (state === 'cancel_change') {
    if (!portalChangeId) throw new HttpsError('invalid-argument', '這堂課不是老師新增或調整的課程。');
    const ref = db.collection('coursePortalScheduleChanges').doc(portalChangeId);
    const snapshot = await ref.get();
    const row = snapshot.exists ? snapshot.data() || {} : null;
    if (!row || row.active === false || clean(row.createdByTeacherId) !== clean(session.teacherId)) {
      throw new HttpsError('permission-denied', '只能取消自己新增或調整的課程。');
    }
    await ref.set({
      active: false,
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledAtText: nowText(),
      cancelledByTeacherId: session.teacherId
    }, { merge: true });
    return { ok: true, state: 'cancelled', message: '此次安排已取消。' };
  }

  if (!['leave', 'absent'].includes(state)) {
    throw new HttpsError('invalid-argument', '不支援的課程狀態。');
  }
  const sourceDate = dateKey(data.sourceDate);
  const sourceEventId = clean(data.sourceEventId);
  const sourceCourseId = clean(data.sourceCourseId);
  if (!sourceDate || (!sourceEventId && !sourceCourseId)) {
    throw new HttpsError('invalid-argument', '缺少原課程資料。');
  }
  const bundle = await scheduleBundle(sourceDate, sourceDate, session.teacherId);
  const source = bundle.events.find((event) =>
    event.teacherId === session.teacherId &&
    event.date === sourceDate &&
    (
      event.id === sourceEventId ||
      event.sourceId === sourceEventId ||
      event.fixedCourseId === sourceCourseId ||
      event.portalChangeId === portalChangeId
    )
  );
  if (!source) throw new HttpsError('not-found', '找不到這堂課，請重新整理後再試。');

  const activeChanges = await db.collection('coursePortalScheduleChanges').where('active', '==', true).get();
  const id = db.collection('coursePortalScheduleChanges').doc().id;
  const batch = db.batch();
  activeChanges.docs.forEach((doc) => {
    const row = doc.data() || {};
    if (
      doc.id === portalChangeId &&
      clean(row.action) !== 'permanent_move' &&
      clean(row.createdByTeacherId) === clean(session.teacherId)
    ) {
      batch.set(doc.ref, { active: false, supersededAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    if (
      row.action === 'lesson_status' &&
      clean(row.createdByTeacherId) === clean(session.teacherId) &&
      dateKey(row.sourceDate) === sourceDate &&
      (
        clean(row.sourceCourseId) === clean(source.fixedCourseId || sourceCourseId) ||
        clean(row.sourceEventId) === clean(source.sourceId || sourceEventId)
      )
    ) {
      batch.set(doc.ref, { active: false, supersededAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });
  const event = {
    id: randomToken(12),
    date: sourceDate,
    startTime: source.startTime,
    endTime: source.endTime,
    roomId: source.roomId,
    teacherId: session.teacherId,
    studentId: source.studentIds[0] || '',
    studentIds: source.studentIds,
    subjectId: source.subjectId,
    fixedCourseId: source.fixedCourseId || sourceCourseId,
    type: source.type || 'lesson',
    status: state,
    paymentStatus: state === 'absent' ? 'teacher_payable_absence' : 'student_leave',
    teacherPayable: state === 'absent',
    note: clean(data.note)
  };
  batch.set(db.collection('coursePortalScheduleChanges').doc(id), {
    id,
    action: 'lesson_status',
    active: true,
    sourceEventId: source.sourceId || sourceEventId,
    sourceCourseId: source.fixedCourseId || sourceCourseId,
    sourceDate,
    event,
    createdByTeacherId: session.teacherId,
    createdAt: FieldValue.serverTimestamp(),
    createdAtText: nowText()
  });
  await batch.commit();
  return {
    ok: true,
    id,
    state,
    message: state === 'absent' ? '已標示曠課；本堂仍列入老師薪資。' : '已標示請假，該教室時段已釋出。'
  };
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
  const sourceEventId = clean(data.sourceEventId);
  const sourceCourseId = clean(data.sourceCourseId);
  const sourceDate = dateKey(data.sourceDate);
  const ignoredSource = (event) => event.date === sourceDate && (
    event.id === sourceEventId || event.sourceId === sourceEventId || event.fixedCourseId === sourceCourseId
  );
  const conflict = bundle.events.find((event) =>
    eventBlocksResource(event) && !ignoredSource(event) && overlaps(startTime, endTime, event.startTime, event.endTime) &&
    (event.roomId === roomId || event.teacherId === session.teacherId)
  );
  if (conflict) {
    throw new HttpsError(
      'already-exists',
      conflict.teacherId === session.teacherId ? '老師在這個時段已有課程。' : '所選教室時段已被使用。'
    );
  }
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
  const roomOverrides = {};
  const pendingDates = [];
  if (action === 'permanent_move') {
    const horizonEnd = addDays(date, 364);
    const future = await scheduleBundle(date, horizonEnd, session.teacherId);
    const compatibleRooms = future.rooms.filter(sourceActive).filter((room) =>
      roomSupportsSubject(room, event.subjectId, future)
    );
    for (let occurrence = date; occurrence <= horizonEnd; occurrence = addDays(occurrence, 7)) {
      const blockers = future.events.filter((row) => {
        const sourceMatch = row.fixedCourseId === sourceCourseId || row.id === sourceEventId || row.sourceId === sourceEventId;
        return eventBlocksResource(row) && !sourceMatch && row.date === occurrence && overlaps(startTime, endTime, row.startTime, row.endTime);
      });
      if (blockers.some((row) => row.teacherId === session.teacherId)) {
        pendingDates.push(occurrence);
        continue;
      }
      if (!blockers.some((row) => row.roomId === roomId)) continue;
      const alternative = compatibleRooms.find((room) =>
        !blockers.some((row) => row.roomId === sourceId(room))
      );
      if (alternative) roomOverrides[occurrence] = sourceId(alternative);
      else pendingDates.push(occurrence);
    }
  }
  const changePayload = {
    id,
    action,
    active: true,
    sourceEventId,
    sourceDate,
    sourceCourseId,
    effectiveDate: action === 'permanent_move' ? date : '',
    event,
    roomOverrides,
    pendingDates,
    createdByTeacherId: session.teacherId,
    createdAt: FieldValue.serverTimestamp(),
    createdAtText: nowText()
  };
  let cleanedFutureCount = 0;
  if (action === 'permanent_move') {
    const activeChanges = await db.collection('coursePortalScheduleChanges').where('active', '==', true).get();
    const batch = db.batch();
    activeChanges.docs.forEach((doc) => {
      const row = doc.data() || {};
      const rowEvent = row.event || {};
      const rowDate = dateKey(rowEvent.date || row.sourceDate || row.effectiveDate);
      const sameStudent = eventStudentIds(rowEvent).includes(studentId);
      const sameSubject = !event.subjectId || eventSubjectId(rowEvent) === event.subjectId;
      if (
        clean(row.createdByTeacherId) === clean(session.teacherId) &&
        ['single_move', 'extra_lesson', 'teacher_gift', 'lesson_status'].includes(clean(row.action)) &&
        rowDate >= date &&
        sameStudent &&
        sameSubject
      ) {
        cleanedFutureCount += 1;
        batch.set(doc.ref, {
          active: false,
          supersededBy: id,
          supersededAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    });
    batch.set(db.collection('coursePortalScheduleChanges').doc(id), changePayload);
    await batch.commit();
  } else {
    await db.collection('coursePortalScheduleChanges').doc(id).set(changePayload);
  }
  return {
    ok: true,
    id,
    event,
    roomOverrides,
    pendingDates,
    cleanedFutureCount,
    message: pendingDates.length
      ? `永久調課已建立；已清除 ${cleanedFutureCount} 筆後續臨時安排，另有 ${pendingDates.length} 個特殊日期待補排。`
      : (Object.keys(roomOverrides).length
        ? `永久調課已建立；已清除 ${cleanedFutureCount} 筆後續臨時安排，${Object.keys(roomOverrides).length} 個單次衝突日期已自動改用其他教室。`
        : (action === 'permanent_move'
          ? `永久調課已建立；已清除 ${cleanedFutureCount} 筆後續臨時安排。`
          : '課程已儲存。'))
  };
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
    const statusByDate = {};
    (row.pendingDates || []).forEach((key) => { statusByDate[key] = { status: 'cancelled', source: 'course-portal-pending' }; });
    Object.keys(row.roomOverrides || {}).forEach((key) => { statusByDate[key] = { status: 'cancelled', source: 'course-portal-room-override' }; });
    payload.fixedCourses.push(Object.assign({}, course || {}, row.event, {
      id: row.id,
      startDate: eventDate(row.event),
      date: eventDate(row.event),
      frequencyWeeks: 1,
      statusByDate,
      source: 'course-portal',
      portalAction: 'permanent_move'
    }));
    Object.keys(row.roomOverrides || {}).forEach((key) => {
      payload.temporaryCourses = Array.isArray(payload.temporaryCourses) ? payload.temporaryCourses : [];
      payload.temporaryCourses.push(Object.assign({}, row.event, {
        id: `${row.id}-room-${key}`,
        date: key,
        roomId: row.roomOverrides[key],
        type: 'temporary',
        source: 'course-portal',
        portalAction: 'permanent_room_exception'
      }));
    });
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
  exportsObject.coursePortalTeacherAvailability = callable(teacherAvailability, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalStudentData = callable(studentPortalData, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalRentalDayBoard = callable(rentalDayBoard, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalRentalWeekBoard = callable(rentalWeekBoard, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalRentalAvailability = callable(rentalAvailability, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalCreateRoomBooking = callable(createRoomBooking, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalRentalMyBookings = callable(rentalMyBookings);
  exportsObject.coursePortalCancelRoomBooking = callable(cancelRoomBooking);
  exportsObject.coursePortalTeacherAction = callable(teacherAction, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherLessonState = callable(teacherLessonState, { timeoutSeconds: 180, memory: '1GiB' });
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
