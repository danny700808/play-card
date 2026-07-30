'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
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
const LINE_LOGIN_CHANNEL_SECRET = defineSecret('LINE_LOGIN_CHANNEL_SECRET');
const LINE_LOGIN_CHANNEL_ID = '2010902226';
const LINE_LOGIN_CALLBACK_URL = 'https://us-central1-youzi-c1b74.cloudfunctions.net/coursePortalLineLoginCallback';
const PORTAL_BASE = 'https://danny700808.github.io/play-card';
const EMAIL_OTP_TTL_MS = 180 * 1000;
const EMAIL_OTP_MAX_ATTEMPTS = 5;
const LINE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const LINE_SETUP_TTL_MS = 20 * 60 * 1000;
const PORTAL_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
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
const RENTAL_USES_VERSION = 4;
const RENTAL_USE_OPTIONS = Object.freeze([
  { id: 'piano', name: '彈鋼琴', icon: '🎹', roomIds: [] },
  { id: 'drums', name: '練鼓', icon: '🥁', roomIds: [] },
  { id: 'band', name: '團練', icon: '🎸', roomIds: [] },
  { id: 'guzheng', name: '古箏', icon: '🪕', roomIds: [] },
  { id: 'recording', name: '錄音室', icon: '🎙️', roomIds: [], hourlyRate: 300 },
  { id: 'other', name: '其他用途', icon: '🎵', roomIds: [] }
]);
const DEFAULT_BUSINESS_HOURS = Object.freeze({
  '0': { closed: false, start: '10:00', end: '21:00' },
  '1': { closed: true, start: '', end: '' },
  '2': { closed: false, start: '12:30', end: '21:00' },
  '3': { closed: false, start: '12:30', end: '21:00' },
  '4': { closed: false, start: '12:30', end: '21:00' },
  '5': { closed: false, start: '12:30', end: '21:00' },
  '6': { closed: false, start: '10:00', end: '21:00' }
});

function roomKind(room, setting = {}) {
  const explicit = clean(setting.kind || setting.roomKind).toLowerCase();
  if (['normal', 'video', 'holding'].includes(explicit)) return explicit;
  const name = clean(room && room.name);
  if (/不定時/.test(name)) return 'holding';
  if (/視訊/.test(name)) return 'video';
  return 'normal';
}

function defaultRoomFee(room) {
  const name = clean(room && room.name);
  return /團練室|展演空間|平台鋼琴|5號鋼琴|五號鋼琴/.test(name) ? 200 : 100;
}

function roomRentable(room, setting = {}) {
  if (setting.roomRulesVersion === 1 && typeof setting.rentable === 'boolean') return setting.rentable;
  return roomKind(room, setting) === 'normal';
}

function roomTeacherSchedulable(room, setting = {}) {
  if (setting.roomRulesVersion === 1 && typeof setting.teacherSchedulable === 'boolean') return setting.teacherSchedulable;
  return true;
}

function effectiveRoomFee(room, setting = {}) {
  if (setting.roomRulesVersion === 1 && setting.rentalFee !== undefined && setting.rentalFee !== null && setting.rentalFee !== '') {
    return Math.max(0, Number(setting.rentalFee) || 0);
  }
  return defaultRoomFee(room);
}

function effectiveRentalFee(room, setting = {}, useOption = {}) {
  if (useOption.hourlyRate !== undefined && useOption.hourlyRate !== null && useOption.hourlyRate !== '') {
    return Math.max(0, Number(useOption.hourlyRate) || 0);
  }
  if (/錄音室|錄音/.test(clean(room && room.name))) return 100;
  return effectiveRoomFee(room, setting);
}

function defaultRentalUseOptions(rooms) {
  const normal = (rooms || []).filter((room) => roomKind(room) === 'normal');
  const ids = (pattern) => normal.filter((room) => pattern.test(clean(room.name))).map(sourceId);
  return [
    {
      id: 'piano',
      name: '彈鋼琴',
      icon: '🎹',
      description: '可選擇是否排除電鋼琴',
      roomIds: ids(/鋼琴|平台|琴房|piano|yamaha|kawai|卡哇伊|展演|團練/i),
      hourlyRate: null,
      active: true
    },
    { id: 'drums', name: '練鼓', icon: '🥁', description: '可指定傳統鼓或電子鼓，也可不指定', roomIds: ids(/鼓|展演|團練/), hourlyRate: null, active: true },
    { id: 'band', name: '團練', icon: '🎸', description: '', roomIds: ids(/展演|團練/), hourlyRate: null, active: true },
    {
      id: 'guzheng',
      name: '古箏',
      icon: '🪕',
      description: '預設展演空間；可自行搬運時才加入 KAWAI 教室',
      roomIds: ids(/展演|kawai|卡哇伊/i),
      hourlyRate: null,
      active: true
    },
    {
      id: 'recording',
      name: '錄音室',
      icon: '🎙️',
      description: '錄音用途每小時 NT$300；其他用途每小時 NT$100',
      roomIds: ids(/錄音室|錄音/),
      hourlyRate: 300,
      active: true
    },
    { id: 'other', name: '其他用途', icon: '🎵', description: '', roomIds: normal.map(sourceId), hourlyRate: null, active: true }
  ];
}

async function rentalUseOptions(rooms = []) {
  const snap = await db.collection('coursePortalSettings').doc('rentalUses').get();
  const defaults = defaultRentalUseOptions(rooms);
  const saved = snap.exists ? snap.data() || {} : {};
  const savedRows = Array.isArray(saved.items) ? saved.items : [];
  let rows = defaults;
  if (saved.version === RENTAL_USES_VERSION) {
    rows = savedRows;
  } else if (saved.version === 3) {
    const defaultIds = new Set(defaults.map((row) => row.id));
    rows = defaults.map((fallback) => {
      const previous = savedRows.find((row) => clean(row.id) === fallback.id);
      if (!previous) return fallback;
      return Object.assign({}, fallback, {
        name: clean(previous.name) || fallback.name,
        icon: clean(previous.icon) || fallback.icon,
        description: clean(fallback.description || previous.description),
        roomIds: [...new Set([...(fallback.roomIds || []), ...(Array.isArray(previous.roomIds) ? previous.roomIds : [])])],
        hourlyRate: fallback.hourlyRate == null ? previous.hourlyRate : fallback.hourlyRate,
        active: previous.active !== false
      });
    }).concat(savedRows.filter((row) => !defaultIds.has(clean(row.id))));
  }
  return rows.map((row, index) => ({
    id: clean(row.id) || ('use-' + (index + 1)),
    name: clean(row.name) || ('用途 ' + (index + 1)),
    icon: clean(row.icon) || (defaults[index] && defaults[index].icon) || '🎵',
    description: clean(row.description),
    roomIds: Array.isArray(row.roomIds) && row.roomIds.length ? row.roomIds.map(clean).filter(Boolean) : ((defaults.find((item) => item.id === clean(row.id)) || {}).roomIds || []),
    hourlyRate: row.hourlyRate === undefined || row.hourlyRate === null || row.hourlyRate === ''
      ? null
      : Math.max(0, Number(row.hourlyRate) || 0),
    active: row.active !== false
  })).filter((row) => row.active);
}

function rentalUseAllowsRoom(options, useType, roomId) {
  const selected = (options || []).find((row) => row.id === clean(useType));
  return Boolean(selected && selected.roomIds.includes(clean(roomId)));
}

async function rentalPolicySettings() {
  const snap = await db.collection('coursePortalSettings').doc('rentalPolicy').get();
  const saved = snap.exists ? snap.data() || {} : {};
  const raw = saved.version === 3 ? saved : {};
  const businessHours = {};
  Object.keys(DEFAULT_BUSINESS_HOURS).forEach((day) => {
    const fallback = DEFAULT_BUSINESS_HOURS[day];
    const row = raw.businessHours && raw.businessHours[day] || {};
    businessHours[day] = {
      closed: row.closed === true || (row.closed == null && fallback.closed),
      start: clean(row.start) || fallback.start,
      end: clean(row.end) || fallback.end
    };
  });
  return {
    businessHours,
    studentDiscountRate: Number(raw.studentDiscountRate == null ? 0.5 : raw.studentDiscountRate) || 0.5,
    maxDurationMinutes: Math.min(300, Math.max(30, Number(raw.maxDurationMinutes || 300))),
    onsitePayment: true
  };
}

function businessWindow(policy, date) {
  const row = policy.businessHours[String(weekday(date))] || {};
  return {
    closed: row.closed === true,
    start: clean(row.start),
    end: clean(row.end),
    startMinutes: timeMinutes(row.start),
    endMinutes: timeMinutes(row.end)
  };
}

function bookingLockRows(date, roomId, startTime, endTime) {
  const rows = [];
  for (let minute = timeMinutes(startTime); minute < timeMinutes(endTime); minute += 30) {
    const slot = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
    rows.push({ id: hash(['room-lock', date, roomId, slot].join('|')), slot });
  }
  return rows;
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeName(value) {
  return clean(value).replace(/\s+/g, '').toLowerCase();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function maskedEmail(value) {
  const email = normalizeEmail(value);
  const [name, domain] = email.split('@');
  if (!name || !domain) return '';
  const visible = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, Math.min(6, name.length - visible.length)))}@${domain}`;
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

function randomEmailOtp() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
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

function sourceEmail(row) {
  return normalizeEmail(row && (
    row.email || row.mail || row.contactEmail || row.parentEmail ||
    row.guardianEmail || row.loginEmail
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

function currentTaipeiDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

async function consumeRateLimit(kind, identity) {
  const day = currentTaipeiDay();
  const rawIdentity = clean(identity);
  const normalizedIdentity = rawIdentity.includes('@') ? normalizeEmail(rawIdentity) : normalizePhone(rawIdentity);
  const ref = db.collection('coursePortalRateLimits').doc(hash(`${kind}|${normalizedIdentity}|${day}`));
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const count = Number(snapshot.exists && snapshot.data().count || 0);
    if (count >= 8) throw new HttpsError('resource-exhausted', '今天嘗試次數過多，請聯絡管理者協助登入。');
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
  if (matches.length > 1) throw new HttpsError('failed-precondition', '找到多筆相同資料，請由管理者確認後再登入。');
  return matches[0];
}

async function createBindCode({ type, targetId, name, phone, email, relationship, renterId }) {
  const code = randomBindCode();
  const expiresAt = Timestamp.fromMillis(Date.now() + 20 * 60 * 1000);
  await db.collection('coursePortalBindCodes').doc(hash(code)).set({
    codeHint: code.slice(-4),
    type,
    targetId: clean(targetId),
    renterId: clean(renterId),
    name: clean(name),
    phoneHash: hash(normalizePhone(phone)),
    email: normalizeEmail(email),
    emailNormalized: normalizeEmail(email),
    emailVerified: Boolean(normalizeEmail(email)),
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
  throw new HttpsError(
    'failed-precondition',
    '為了保護帳號，請先完成 Email 四碼驗證，再進行第一次 LINE 綁定。'
  );
}

async function prepareBindingIdentity(data) {
  const type = clean(data.type).toLowerCase();
  const name = clean(data.name);
  const phone = normalizePhone(data.phone);
  const email = normalizeEmail(data.email);
  assertInput(name, '姓名');
  assertInput(phone, '電話');
  assertInput(email, 'Email');
  if (!validEmail(email)) throw new HttpsError('invalid-argument', 'Email 格式不正確。');
  if (!['teacher', 'student', 'renter'].includes(type)) {
    throw new HttpsError('invalid-argument', '不支援的入口類型。');
  }

  if (type === 'teacher') {
    const teacher = await findPerson('teachers', name, phone);
    const registeredEmail = sourceEmail(teacher);
    if (registeredEmail && registeredEmail !== email) {
      throw new HttpsError('permission-denied', 'Email 與老師登記資料不符，請確認後再試。');
    }
    return { type, targetId: sourceId(teacher), name, phone, email, relationship: '', renterId: '' };
  }
  if (type === 'student') {
    const student = await findPerson('students', name, phone);
    const registeredEmail = sourceEmail(student);
    if (registeredEmail && registeredEmail !== email) {
      throw new HttpsError('permission-denied', 'Email 與學生登記資料不符，請確認後再試。');
    }
    return {
      type,
      targetId: sourceId(student),
      name,
      phone,
      email,
      relationship: clean(data.relationship) || '本人'
    };
  }

  const renterId = hash(`${normalizeName(name)}|${phone}`).slice(0, 32);
  return { type, targetId: '', renterId, name, phone, email, relationship: '' };
}

function bindingCollection(type) {
  if (type === 'teacher') return 'coursePortalTeacherBindings';
  if (type === 'student') return 'coursePortalStudentBindings';
  return 'coursePortalRenterBindings';
}

function identityTargetField(type) {
  if (type === 'teacher') return 'teacherId';
  if (type === 'student') return 'studentId';
  return 'renterId';
}

function identityTargetId(identity) {
  return identity.type === 'renter' ? clean(identity.renterId) : clean(identity.targetId);
}

function regularAccountId(type, email) {
  return hash(`regular-account|${clean(type)}|${normalizeEmail(email)}`);
}

async function resolveRegularIdentity(identity) {
  const type = clean(identity.type);
  const targetField = identityTargetField(type);
  const targetId = identityTargetId(identity);
  const authAccountId = regularAccountId(type, identity.email);
  const snapshot = await db.collection(bindingCollection(type))
    .where(targetField, '==', targetId)
    .get();
  const rows = snapshot.docs.map((doc) => Object.assign({
    __id: doc.id,
    __ref: doc.ref
  }, doc.data() || {}));
  const sameAccount = rows.filter((row) =>
    clean(row.authAccountId) === authAccountId ||
    normalizeEmail(row.emailNormalized || row.email) === normalizeEmail(identity.email)
  );
  if (sameAccount.some((row) => clean(row.status) === 'revoked')) {
    throw new HttpsError('permission-denied', '這個入口帳號目前已停用，請聯絡柚子樂器協助恢復。');
  }
  const active = sameAccount.find((row) => clean(row.status) === 'active') || null;
  return {
    authAccountId,
    bindingId: clean(active && active.__id),
    lineUserId: clean(active && active.lineUserId)
  };
}

async function findEmailLoginAccount(type, email) {
  if (!['teacher', 'student', 'renter'].includes(type)) return null;
  const snapshot = await db.collection(bindingCollection(type))
    .where('emailNormalized', '==', normalizeEmail(email))
    .get();
  const rows = snapshot.docs
    .map((doc) => Object.assign({ __id: doc.id }, doc.data() || {}))
    .filter((row) => clean(row.status) === 'active' && row.emailVerified === true);
  const accountKeys = [...new Set(rows.map((row) =>
    clean(row.authAccountId) || (clean(row.lineUserId) ? `line:${clean(row.lineUserId)}` : '')
  ).filter(Boolean))];
  if (accountKeys.length !== 1) return null;
  const row = rows.find((item) =>
    (clean(item.authAccountId) || (clean(item.lineUserId) ? `line:${clean(item.lineUserId)}` : '')) === accountKeys[0]
  ) || {};
  return {
    type,
    lineUserId: clean(row.lineUserId),
    authAccountId: clean(row.authAccountId),
    targetId: type === 'teacher' ? clean(row.teacherId) : (type === 'student' ? clean(row.studentId) : ''),
    renterId: type === 'renter' ? clean(row.renterId) : ''
  };
}

async function sendEmailOtp(data, helpers = {}) {
  const requestedPurpose = clean(data.purpose).toLowerCase();
  const purpose = requestedPurpose === 'account'
    ? 'account'
    : (requestedPurpose === 'login' ? 'login' : 'bind');
  const type = clean(data.type).toLowerCase();
  if (!['teacher', 'student', 'renter'].includes(type)) {
    throw new HttpsError('invalid-argument', '不支援的入口類型。');
  }

  const email = normalizeEmail(data.email);
  assertInput(email, 'Email');
  if (!validEmail(email)) throw new HttpsError('invalid-argument', 'Email 格式不正確。');
  await consumeRateLimit(`email-otp-${purpose}-${type}`, email);

  let identity = null;
  if (purpose === 'account' || purpose === 'bind') {
    identity = await prepareBindingIdentity(data);
    if (purpose === 'account') {
      identity = Object.assign(identity, await resolveRegularIdentity(identity));
    }
  } else {
    identity = await findEmailLoginAccount(type, email);
  }
  const challenge = randomToken(32);
  const code = randomEmailOtp();
  const expiresAt = Timestamp.fromMillis(Date.now() + EMAIL_OTP_TTL_MS);
  const payload = {
    purpose,
    type,
    email,
    emailNormalized: email,
    codeHash: hash(`${challenge}|${code}`),
    attempts: 0,
    maxAttempts: EMAIL_OTP_MAX_ATTEMPTS,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt
  };
  if (identity) {
    payload.lineUserId = clean(identity.lineUserId);
    payload.authAccountId = clean(identity.authAccountId);
    payload.bindingId = clean(identity.bindingId);
    payload.targetId = clean(identity.targetId);
    payload.renterId = clean(identity.renterId);
    payload.name = clean(identity.name);
    payload.phone = normalizePhone(identity.phone);
    payload.relationship = clean(identity.relationship);
  } else {
    payload.decoy = true;
  }
  const ref = db.collection('coursePortalEmailOtps').doc(hash(challenge));
  await ref.set(payload);

  if (identity && typeof helpers.sendEmail !== 'function') {
    await ref.delete().catch(() => {});
    throw new HttpsError('internal', '驗證信服務尚未啟用，請使用 LINE 快速登入或聯絡管理者。');
  }
  if (identity) {
    try {
      await helpers.sendEmail({
        channel: 'email',
        targetEmail: email,
        title: `柚子樂器${purpose === 'bind' ? '首次驗證' : '登入'}驗證碼`,
        body: [
          `您的四碼驗證碼是：${code}`,
          '',
          '驗證碼 180 秒內有效，最多可輸入 5 次。',
          '若不是您本人操作，請忽略這封信，也不要把驗證碼告訴任何人。'
        ].join('\n')
      });
    } catch (error) {
      await ref.delete().catch(() => {});
      console.error('[course portal email otp failed]', error);
      throw new HttpsError('internal', '驗證信暫時無法寄出，請稍後再試或使用 LINE 快速登入。');
    }
  }

  return {
    ok: true,
    challengeToken: challenge,
    expiresInSeconds: Math.floor(EMAIL_OTP_TTL_MS / 1000),
    maskedEmail: maskedEmail(email),
    message: '四碼驗證碼已寄到您的 Email。'
  };
}

async function activeStudentIdsForAccount(authAccountId) {
  if (!clean(authAccountId)) return [];
  const snapshot = await db.collection('coursePortalStudentBindings')
    .where('authAccountId', '==', clean(authAccountId))
    .where('status', '==', 'active')
    .get();
  return [...new Set(snapshot.docs.map((doc) => clean(doc.data().studentId)).filter(Boolean))];
}

async function activeStudentBindingsForSession(session) {
  const queries = [];
  if (clean(session && session.lineUserId)) {
    queries.push(
      db.collection('coursePortalStudentBindings')
        .where('lineUserId', '==', clean(session.lineUserId))
        .where('status', '==', 'active')
        .get()
    );
  }
  if (clean(session && session.authAccountId)) {
    queries.push(
      db.collection('coursePortalStudentBindings')
        .where('authAccountId', '==', clean(session.authAccountId))
        .where('status', '==', 'active')
        .get()
    );
  }
  const snapshots = await Promise.all(queries);
  return [...new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((doc) => [
    doc.id,
    Object.assign({ __id: doc.id, __ref: doc.ref }, doc.data() || {})
  ])).values()];
}

async function activeStudentIdsForSession(session) {
  const bindings = await activeStudentBindingsForSession(session);
  return [...new Set(bindings.map((row) => clean(row.studentId)).filter(Boolean))];
}

function sessionOwnerKey(session) {
  const authAccountId = clean(session && session.authAccountId);
  const lineUserId = clean(session && session.lineUserId);
  if (authAccountId) return `account:${authAccountId}`;
  if (lineUserId) return `line:${lineUserId}`;
  return '';
}

async function issueSession({ type, lineUserId, authAccountId, targetId, renterId, authMethod, ttlMs }) {
  const session = randomToken(36);
  const sessionTtlMs = Math.max(30 * 60 * 1000, Number(ttlMs || PORTAL_SESSION_TTL_MS));
  const expiresAt = Timestamp.fromMillis(Date.now() + sessionTtlMs);
  const sessionPayload = {
    role: type,
    lineUserId: clean(lineUserId),
    authAccountId: clean(authAccountId),
    teacherId: type === 'teacher' ? clean(targetId) : '',
    renterId: type === 'renter' ? clean(renterId) : '',
    authMethod: clean(authMethod) || 'line',
    sliding: sessionTtlMs >= PORTAL_SESSION_TTL_MS,
    sessionTtlMs,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: FieldValue.serverTimestamp(),
    expiresAt
  };
  if (type === 'student') {
    const [lineStudentIds, accountStudentIds] = await Promise.all([
      clean(lineUserId) ? activeStudentIdsForLine(lineUserId) : [],
      clean(authAccountId) ? activeStudentIdsForAccount(authAccountId) : []
    ]);
    sessionPayload.studentIds = [...new Set([
      ...lineStudentIds,
      ...accountStudentIds,
      clean(targetId)
    ].filter(Boolean))];
  }
  await db.collection('coursePortalSessions').doc(hash(session)).set(sessionPayload);
  return { sessionToken: session, expiresAt };
}

async function completeRegularAccount(source) {
  const type = clean(source.type);
  const targetId = clean(source.targetId);
  const renterId = clean(source.renterId);
  const authAccountId = clean(source.authAccountId) || regularAccountId(type, source.email);
  const collection = db.collection(bindingCollection(type));
  const generatedBindingId = hash([
    'regular-login',
    type,
    authAccountId,
    type === 'renter' ? renterId : targetId
  ].join('|'));
  const bindingId = clean(source.bindingId) || generatedBindingId;
  const bindingRef = collection.doc(bindingId);
  const existing = await bindingRef.get();
  const previous = existing.exists ? existing.data() || {} : {};
  if (clean(previous.status) === 'revoked') {
    throw new HttpsError('permission-denied', '這個入口帳號目前已停用，請聯絡柚子樂器協助恢復。');
  }

  const payload = {
    type,
    authAccountId,
    authProvider: clean(previous.lineUserId) ? 'line-login+email' : 'email-otp',
    name: clean(source.name),
    phoneHash: hash(normalizePhone(source.phone)),
    email: normalizeEmail(source.email),
    emailNormalized: normalizeEmail(source.email),
    emailVerified: true,
    emailVerifiedAt: FieldValue.serverTimestamp(),
    status: 'active',
    updatedAt: FieldValue.serverTimestamp(),
    registeredAt: previous.registeredAt || FieldValue.serverTimestamp()
  };
  if (type === 'teacher') payload.teacherId = targetId;
  if (type === 'student') {
    payload.studentId = targetId;
    payload.relationship = clean(source.relationship) || '本人';
  }
  if (type === 'renter') payload.renterId = renterId;

  const batch = db.batch();
  if (type === 'renter') {
    batch.set(db.collection('coursePortalRenters').doc(renterId), {
      renterId,
      name: clean(source.name),
      phone: normalizePhone(source.phone),
      email: normalizeEmail(source.email),
      emailNormalized: normalizeEmail(source.email),
      emailVerified: true,
      emailVerifiedAt: FieldValue.serverTimestamp(),
      source: 'regular-registration',
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
      createdAtText: nowText()
    }, { merge: true });
  }
  batch.set(bindingRef, payload, { merge: true });
  await batch.commit();

  const issued = await issueSession({
    type,
    lineUserId: clean(previous.lineUserId || source.lineUserId),
    authAccountId,
    targetId,
    renterId,
    authMethod: 'email-otp'
  });
  return {
    ok: true,
    purpose: 'account',
    role: type,
    sessionToken: issued.sessionToken,
    expiresAt: issued.expiresAt.toDate().toISOString()
  };
}

async function verifyEmailOtp(data) {
  const challenge = clean(data.challengeToken);
  const code = clean(data.code).replace(/\D/g, '');
  if (!challenge || !/^\d{4}$/.test(code)) {
    throw new HttpsError('invalid-argument', '請輸入四碼驗證碼。');
  }
  const ref = db.collection('coursePortalEmailOtps').doc(hash(challenge));
  let source = null;
  let verificationError = null;
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const row = snapshot.exists ? snapshot.data() || {} : null;
    if (!row || row.status !== 'pending' || asMillis(row.expiresAt) < Date.now()) {
      throw new HttpsError('deadline-exceeded', '驗證碼已失效，請重新寄送。');
    }
    const attempts = Number(row.attempts || 0);
    if (attempts >= EMAIL_OTP_MAX_ATTEMPTS) {
      throw new HttpsError('resource-exhausted', '驗證碼輸入次數已達上限，請重新寄送。');
    }
    if (!safeEqual(row.codeHash, hash(`${challenge}|${code}`))) {
      tx.set(ref, {
        attempts: attempts + 1,
        status: attempts + 1 >= EMAIL_OTP_MAX_ATTEMPTS ? 'locked' : 'pending',
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      verificationError = new HttpsError('permission-denied', '驗證碼不正確。');
      return;
    }
    source = row;
    tx.set(ref, {
      attempts: attempts + 1,
      status: 'used',
      usedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  if (verificationError) throw verificationError;

  if (!source || source.decoy) {
    throw new HttpsError('permission-denied', '驗證碼不正確或帳號資料不相符。');
  }
  if (source.purpose === 'account') {
    return completeRegularAccount(source);
  }
  if (source.purpose === 'login') {
    const result = await issueSession({
      type: source.type,
      lineUserId: source.lineUserId,
      authAccountId: source.authAccountId,
      targetId: source.targetId,
      renterId: source.renterId,
      authMethod: 'email-otp'
    });
    return {
      ok: true,
      purpose: 'login',
      role: source.type,
      sessionToken: result.sessionToken,
      expiresAt: result.expiresAt.toDate().toISOString()
    };
  }

  if (source.type === 'renter') {
    await db.collection('coursePortalRenters').doc(clean(source.renterId)).set({
      renterId: clean(source.renterId),
      name: clean(source.name),
      phone: normalizePhone(source.phone),
      email: normalizeEmail(source.email),
      emailNormalized: normalizeEmail(source.email),
      emailVerified: true,
      emailVerifiedAt: FieldValue.serverTimestamp(),
      source: 'public-registration',
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
      createdAtText: nowText()
    }, { merge: true });
  }
  const bind = await createBindCode({
    type: source.type,
    targetId: source.targetId,
    renterId: source.renterId,
    name: source.name,
    phone: source.phone,
    email: source.email,
    relationship: source.relationship
  });
  return Object.assign({}, bind, { purpose: 'bind', emailVerified: true });
}

function portalPageForRole(type) {
  if (type === 'teacher') return 'teacher-course-portal.html';
  if (type === 'student') return 'student-course-portal.html';
  return 'room-booking.html';
}

function portalUrlForRole(type, params = {}) {
  const url = new URL(`${PORTAL_BASE}/${portalPageForRole(type)}`);
  Object.keys(params).forEach((key) => {
    const value = clean(params[key]);
    if (value) url.searchParams.set(key, value);
  });
  return url.toString();
}

function lineAuthorizationUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINE_LOGIN_CHANNEL_ID,
    redirect_uri: LINE_LOGIN_CALLBACK_URL,
    state,
    scope: 'openid profile',
    bot_prompt: 'aggressive'
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}

async function startLineLogin(data) {
  const type = clean(data.type).toLowerCase();
  if (!['teacher', 'student', 'renter'].includes(type)) {
    throw new HttpsError('invalid-argument', '不支援的入口類型。');
  }
  const state = randomToken(32);
  const expiresAt = Timestamp.fromMillis(Date.now() + LINE_OAUTH_STATE_TTL_MS);
  await db.collection('coursePortalLineOAuthStates').doc(hash(state)).set({
    type,
    stateHint: state.slice(-6),
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt
  });
  return {
    ok: true,
    authorizationUrl: lineAuthorizationUrl(state),
    expiresAt: expiresAt.toDate().toISOString()
  };
}

async function renterContactLogin(data) {
  const name = clean(data.name);
  const phone = normalizePhone(data.phone);
  assertInput(name, '姓名');
  assertInput(phone, '電話');
  await consumeRateLimit('renter-contact-login', phone);

  const renterId = hash(`${normalizeName(name)}|${phone}`).slice(0, 32);
  const [renterSnapshot, bindingSnapshot] = await Promise.all([
    db.collection('coursePortalRenters').doc(renterId).get(),
    db.collection('coursePortalRenterBindings').where('renterId', '==', renterId).get()
  ]);
  const renter = renterSnapshot.exists ? renterSnapshot.data() || {} : null;
  const bindings = bindingSnapshot.docs
    .map((doc) => doc.data() || {})
    .filter((row) => clean(row.status) === 'active' && clean(row.lineUserId));
  const lineUserIds = [...new Set(bindings.map((row) => clean(row.lineUserId)).filter(Boolean))];
  if (
    !renter ||
    renter.active === false ||
    normalizeName(renter.name) !== normalizeName(name) ||
    !phoneMatches(renter.phone, phone) ||
    lineUserIds.length !== 1
  ) {
    throw new HttpsError('permission-denied', '姓名或電話不正確，或這筆租用帳號尚未完成註冊。');
  }

  const issued = await issueSession({
    type: 'renter',
    lineUserId: lineUserIds[0],
    renterId,
    authMethod: 'renter-name-phone',
    ttlMs: 8 * 60 * 60 * 1000
  });
  return {
    ok: true,
    role: 'renter',
    sessionToken: issued.sessionToken,
    temporary: true,
    expiresAt: issued.expiresAt.toDate().toISOString()
  };
}

async function issueAccessToken({ type, lineUserId, targetId, renterId, authMethod, lineFriendFlag }) {
  const raw = randomToken(32);
  const expiresAt = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
  await db.collection('coursePortalAccessTokens').doc(hash(raw)).set({
    type,
    lineUserId,
    targetId: clean(targetId),
    renterId: clean(renterId),
    authMethod: clean(authMethod) || 'line',
    lineFriendFlag: lineFriendFlag !== false,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt
  });
  return raw;
}

function lineQueryValue(req, key) {
  const value = req && req.query && req.query[key];
  return clean(Array.isArray(value) ? value[0] : value);
}

async function exchangeLineAuthorizationCode(code) {
  const secret = clean(LINE_LOGIN_CHANNEL_SECRET.value());
  if (!secret) throw new Error('LINE Login Channel secret 尚未設定。');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: LINE_LOGIN_CALLBACK_URL,
    client_id: LINE_LOGIN_CHANNEL_ID,
    client_secret: secret
  });
  const response = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !clean(payload.access_token)) {
    console.error('[course portal LINE token exchange failed]', response.status, payload.error || payload.error_description || '');
    throw new Error('LINE 登入授權已失效，請重新登入。');
  }
  return payload;
}

async function lineLoginProfile(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const [profileResponse, friendResponse] = await Promise.all([
    fetch('https://api.line.me/v2/profile', { headers }),
    fetch('https://api.line.me/friendship/v1/status', { headers }).catch(() => null)
  ]);
  const profile = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok || !clean(profile.userId)) {
    throw new Error('無法取得 LINE 登入身分，請重新登入。');
  }
  let friendFlag = false;
  if (friendResponse && friendResponse.ok) {
    const friendship = await friendResponse.json().catch(() => ({}));
    friendFlag = friendship.friendFlag === true;
  }
  return {
    lineUserId: clean(profile.userId),
    lineDisplayName: clean(profile.displayName),
    linePictureUrl: clean(profile.pictureUrl),
    lineFriendFlag: friendFlag
  };
}

async function bindingsForLine(type, lineUserId) {
  const snapshot = await db.collection(bindingCollection(type))
    .where('lineUserId', '==', lineUserId)
    .get();
  return snapshot.docs
    .map((doc) => Object.assign({ __id: doc.id, __ref: doc.ref }, doc.data() || {}));
}

async function refreshLineBindingProfile(bindings, profile) {
  if (!bindings.length) return;
  const batch = db.batch();
  bindings.forEach((binding) => {
    batch.set(binding.__ref, {
      lineDisplayName: profile.lineDisplayName,
      linePictureUrl: profile.linePictureUrl,
      lineFriendFlag: profile.lineFriendFlag,
      lineProfileCheckedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  await batch.commit();
}

function redirectLineLoginError(res, type, message) {
  const safeType = ['teacher', 'student', 'renter'].includes(type) ? type : '';
  const target = safeType
    ? portalUrlForRole(safeType, { lineError: message || 'LINE 登入未完成，請重新操作。' })
    : `${PORTAL_BASE}/course-portal.html?lineError=${encodeURIComponent(message || 'LINE 登入未完成，請重新操作。')}`;
  res.redirect(302, target);
}

async function lineLoginCallback(req, res) {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const state = lineQueryValue(req, 'state');
  const code = lineQueryValue(req, 'code');
  const lineError = lineQueryValue(req, 'error');
  const stateRef = state
    ? db.collection('coursePortalLineOAuthStates').doc(hash(state))
    : null;
  let type = '';

  try {
    if (!stateRef) throw new Error('LINE 登入狀態不完整，請重新操作。');
    let stateRow = null;
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(stateRef);
      const row = snapshot.exists ? snapshot.data() || {} : null;
      type = clean(row && row.type);
      if (
        !row ||
        clean(row.status) !== 'pending' ||
        asMillis(row.expiresAt) < Date.now() ||
        !['teacher', 'student', 'renter'].includes(type)
      ) {
        throw new Error('LINE 登入連結已失效，請回到入口重新登入。');
      }
      stateRow = row;
      tx.set(stateRef, {
        status: 'processing',
        processingAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
    if (!stateRow) throw new Error('LINE 登入狀態不完整，請重新操作。');
    if (lineError || !code) {
      await stateRef.set({
        status: 'cancelled',
        error: lineError || 'missing_code',
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      redirectLineLoginError(res, type, '您已取消 LINE 登入。');
      return;
    }

    const token = await exchangeLineAuthorizationCode(code);
    const profile = await lineLoginProfile(token.access_token);
    const allBindings = await bindingsForLine(type, profile.lineUserId);
    const bindings = allBindings.filter((row) => clean(row.status) === 'active');
    if (!bindings.length && allBindings.some((row) => clean(row.status) === 'revoked')) {
      await stateRef.set({
        status: 'blocked',
        lineUserId: profile.lineUserId,
        completedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      redirectLineLoginError(res, type, '這個入口帳號目前已停用，請聯絡柚子樂器協助恢復。');
      return;
    }
    await refreshLineBindingProfile(bindings, profile);

    if (bindings.length) {
      const binding = bindings[0];
      const accessToken = await issueAccessToken({
        type,
        lineUserId: profile.lineUserId,
        targetId: type === 'teacher' ? clean(binding.teacherId) : (type === 'student' ? clean(binding.studentId) : ''),
        renterId: type === 'renter' ? clean(binding.renterId) : '',
        authMethod: 'line-oauth',
        lineFriendFlag: profile.lineFriendFlag
      });
      await stateRef.set({
        status: 'used',
        lineUserId: profile.lineUserId,
        lineFriendFlag: profile.lineFriendFlag,
        completedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      res.redirect(302, portalUrlForRole(type, { access: accessToken }));
      return;
    }

    const setupToken = randomToken(36);
    const setupExpiresAt = Timestamp.fromMillis(Date.now() + LINE_SETUP_TTL_MS);
    await db.collection('coursePortalLineSetupTokens').doc(hash(setupToken)).set({
      type,
      lineUserId: profile.lineUserId,
      lineDisplayName: profile.lineDisplayName,
      linePictureUrl: profile.linePictureUrl,
      lineFriendFlag: profile.lineFriendFlag,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: setupExpiresAt
    });
    await stateRef.set({
      status: 'used',
      lineUserId: profile.lineUserId,
      lineFriendFlag: profile.lineFriendFlag,
      setupRequired: true,
      completedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    res.redirect(302, portalUrlForRole(type, { lineSetup: setupToken }));
  } catch (error) {
    console.error('[course portal LINE callback failed]', error);
    if (stateRef) {
      await stateRef.set({
        status: 'error',
        error: clean(error && error.message).slice(0, 300),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true }).catch(() => {});
    }
    redirectLineLoginError(res, type, clean(error && error.message) || 'LINE 登入未完成，請重新操作。');
  }
}

async function completeLineRegistration(data) {
  const setupToken = clean(data.setupToken);
  const requestedType = clean(data.type).toLowerCase();
  if (!setupToken) throw new HttpsError('invalid-argument', 'LINE 登入資料已遺失，請重新登入。');
  const setupRef = db.collection('coursePortalLineSetupTokens').doc(hash(setupToken));
  const setupSnapshot = await setupRef.get();
  const setup = setupSnapshot.exists ? setupSnapshot.data() || {} : null;
  const type = clean(setup && setup.type);
  if (
    !setup ||
    clean(setup.status) !== 'pending' ||
    asMillis(setup.expiresAt) < Date.now() ||
    !['teacher', 'student', 'renter'].includes(type) ||
    type !== requestedType ||
    !clean(setup.lineUserId)
  ) {
    throw new HttpsError('permission-denied', 'LINE 登入資料已失效，請重新登入。');
  }

  const identity = await prepareBindingIdentity(Object.assign({}, data, { type }));
  await consumeRateLimit(`line-oauth-setup-${type}`, identity.phone);
  const lineUserId = clean(setup.lineUserId);
  const targetId = clean(identity.targetId);
  const renterId = clean(identity.renterId);
  const conflictField = type === 'teacher' ? 'teacherId' : (type === 'renter' ? 'renterId' : '');
  if (conflictField) {
    const conflicts = await db.collection(bindingCollection(type))
      .where(conflictField, '==', type === 'teacher' ? targetId : renterId)
      .get();
    const conflictRows = conflicts.docs.map((doc) => doc.data() || {});
    if (conflictRows.some((row) => clean(row.status) === 'revoked')) {
      throw new HttpsError('permission-denied', '這個入口帳號目前已停用，請聯絡柚子樂器協助恢復。');
    }
    const claimed = conflictRows.some((row) =>
      clean(row.status) === 'active' &&
      clean(row.lineUserId) &&
      clean(row.lineUserId) !== lineUserId
    );
    if (claimed) {
      throw new HttpsError('already-exists', '這筆資料已由其他 LINE 帳號使用，請由管理者刪除舊登入資料後再試。');
    }
  }

  const bindingId = type === 'student'
    ? hash(`${targetId}|${lineUserId}`)
    : hash(lineUserId);
  const bindingRef = db.collection(bindingCollection(type)).doc(bindingId);
  const previousBinding = await bindingRef.get();
  if (previousBinding.exists && clean(previousBinding.data().status) === 'revoked') {
    throw new HttpsError('permission-denied', '這個入口帳號目前已停用，請聯絡柚子樂器協助恢復。');
  }
  const payload = {
    type,
    lineUserId,
    lineDisplayName: clean(setup.lineDisplayName),
    linePictureUrl: clean(setup.linePictureUrl),
    lineFriendFlag: setup.lineFriendFlag === true,
    lineVerified: true,
    authProvider: 'line-login',
    email: normalizeEmail(identity.email),
    emailNormalized: normalizeEmail(identity.email),
    emailVerified: false,
    status: 'active',
    updatedAt: FieldValue.serverTimestamp(),
    boundAt: FieldValue.serverTimestamp(),
    reminderLastLesson: true,
    reminderPayment: true
  };
  if (type === 'teacher') payload.teacherId = targetId;
  if (type === 'student') {
    payload.studentId = targetId;
    payload.relationship = clean(identity.relationship) || '本人';
  }
  if (type === 'renter') payload.renterId = renterId;

  await db.runTransaction(async (tx) => {
    const currentSetup = await tx.get(setupRef);
    const current = currentSetup.exists ? currentSetup.data() || {} : null;
    if (!current || clean(current.status) !== 'pending' || asMillis(current.expiresAt) < Date.now()) {
      throw new HttpsError('permission-denied', 'LINE 登入資料已使用或失效，請重新登入。');
    }
    if (type === 'renter') {
      tx.set(db.collection('coursePortalRenters').doc(renterId), {
        renterId,
        name: clean(identity.name),
        phone: normalizePhone(identity.phone),
        email: normalizeEmail(identity.email),
        emailNormalized: normalizeEmail(identity.email),
        emailVerified: false,
        source: 'line-login-registration',
        active: true,
        updatedAt: FieldValue.serverTimestamp(),
        createdAtText: nowText()
      }, { merge: true });
    }
    tx.set(bindingRef, payload, { merge: true });
    tx.set(setupRef, {
      status: 'used',
      targetId,
      renterId,
      usedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  const issued = await issueSession({
    type,
    lineUserId,
    targetId,
    renterId,
    authMethod: 'line-oauth-registration'
  });
  return {
    ok: true,
    role: type,
    sessionToken: issued.sessionToken,
    expiresAt: issued.expiresAt.toDate().toISOString(),
    reminderReady: setup.lineFriendFlag === true
  };
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
  const bindMatch = text.match(/^柚子(老師入口|學生綁定|租用綁定)\s+(CP-[A-Z0-9]+)$/i);
  const loginMatch = text.match(/^柚子(老師|學生|租用)快速登入\s+(CP-L[A-Z0-9]+)$/i);
  if (!bindMatch && !loginMatch) return false;

  const lineUserId = clean(event && event.source && event.source.userId);
  const replyToken = clean(event && event.replyToken);
  const reply = helpers.replyLineMessage;
  if (!lineUserId || typeof reply !== 'function') return true;

  if (loginMatch) {
    const typeMap = { 老師: 'teacher', 學生: 'student', 租用: 'renter' };
    const type = typeMap[loginMatch[1]];
    const code = loginMatch[2].toUpperCase();
    const codeRef = db.collection('coursePortalLineLoginCodes').doc(hash(code));
    const [codeSnapshot, bindings] = await Promise.all([
      codeRef.get(),
      db.collection(bindingCollection(type)).where('lineUserId', '==', lineUserId).get()
    ]);
    const row = codeSnapshot.exists ? codeSnapshot.data() || {} : null;
    const active = bindings.docs
      .map((doc) => doc.data() || {})
      .filter((item) => clean(item.status) === 'active');
    if (!row || row.status !== 'pending' || row.type !== type || asMillis(row.expiresAt) < Date.now() || !active.length) {
      await reply(replyToken, '快速登入碼無效、已逾時，或這個 LINE 尚未綁定。請回到入口頁重新取得。');
      return true;
    }
    const binding = active[0] || {};
    await codeRef.set({
      status: 'used',
      usedAt: FieldValue.serverTimestamp(),
      lineUserId
    }, { merge: true });
    const access = await issueAccessToken({
      type,
      lineUserId,
      targetId: type === 'teacher' ? clean(binding.teacherId) : (type === 'student' ? clean(binding.studentId) : ''),
      renterId: type === 'renter' ? clean(binding.renterId) : '',
      authMethod: 'line-login'
    });
    const page = type === 'teacher'
      ? 'teacher-course-portal.html'
      : (type === 'student' ? 'student-course-portal.html' : 'room-booking.html');
    const label = type === 'teacher' ? '老師入口' : (type === 'student' ? '學生入口' : '教室租用入口');
    const url = `${PORTAL_BASE}/${page}?access=${encodeURIComponent(access)}`;
    await reply(replyToken, `身分確認完成。\n請開啟「${label}」：\n${url}\n\n這不是重新綁定；登入後這台瀏覽器會記住您的帳號。`);
    return true;
  }

  const typeMap = { 老師入口: 'teacher', 學生綁定: 'student', 租用綁定: 'renter' };
  const type = typeMap[bindMatch[1]];
  const code = bindMatch[2].toUpperCase();
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
    email: normalizeEmail(row.email),
    emailNormalized: normalizeEmail(row.email),
    emailVerified: row.emailVerified === true,
    emailVerifiedAt: row.emailVerified === true ? FieldValue.serverTimestamp() : null,
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
    renterId: clean(row.renterId),
    authMethod: 'line-binding'
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
    throw new HttpsError('permission-denied', '登入連結已逾時，請重新登入。');
  }

  const issued = await issueSession({
    type: source.type,
    lineUserId: source.lineUserId,
    targetId: source.targetId,
    renterId: source.renterId,
    authMethod: source.authMethod || 'line'
  });
  // LINE 內建瀏覽器可能會重複載入網址。必須先成功建立裝置登入，
  // 再記錄交換狀態；短效連結在到期前可安全重新交換，不會卡死使用者。
  await ref.set({
    status: 'exchanged',
    lastExchangedAt: FieldValue.serverTimestamp(),
    exchangeCount: FieldValue.increment(1)
  }, { merge: true });
  return {
    ok: true,
    sessionToken: issued.sessionToken,
    role: source.type,
    expiresAt: issued.expiresAt.toDate().toISOString(),
    reminderReady: source.lineFriendFlag !== false
  };
}

async function requireSession(data, allowedRoles) {
  const raw = clean(data && data.sessionToken);
  if (!raw) throw new HttpsError('unauthenticated', '請先登入。');
  const ref = db.collection('coursePortalSessions').doc(hash(raw));
  const snapshot = await ref.get();
  const session = snapshot.exists ? snapshot.data() || {} : null;
  if (!session || session.status !== 'active' || asMillis(session.expiresAt) < Date.now()) {
    throw new HttpsError('unauthenticated', '登入狀態已到期，請重新登入。');
  }
  if (allowedRoles && !allowedRoles.includes(session.role)) {
    throw new HttpsError('permission-denied', '這個帳號沒有此頁面權限。');
  }
  const update = { lastUsedAt: FieldValue.serverTimestamp() };
  if (session.sliding !== false) {
    update.expiresAt = Timestamp.fromMillis(Date.now() + PORTAL_SESSION_TTL_MS);
  }
  await ref.set(update, { merge: true });
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
  const subject = clean(bundle.maps.subjects[subjectId] && bundle.maps.subjects[subjectId].name).toLowerCase();
  const roomName = clean(room.name).toLowerCase();
  if (/爵士鼓|電子鼓|傳統鼓|鼓組/.test(subject)) return /鼓|展演|團練/.test(roomName);
  if (/古箏/.test(subject)) return /展演|kawai|卡哇伊/.test(roomName);
  if (/鋼琴|電子琴|keyboard|piano/.test(subject)) return /鋼琴|平台|yamaha|kawai|卡哇伊|琴房|展演|團練/.test(roomName);
  const configured = firstArray(setting, ['allowedSubjectIds']);
  const sourceConfigured = firstArray(room, ['allowedSubjectIds', 'subjectIds']);
  const allowed = configured.length ? configured : sourceConfigured;
  if (allowed.length) return allowed.includes(subjectId);
  return true;
}

function normalizePianoType(value) {
  const type = clean(value).toLowerCase();
  if (['none', 'no_piano'].includes(type)) return 'none';
  if (['digital_piano', 'digital', 'electric_piano', '電鋼琴'].includes(type)) return 'digital_piano';
  if (['grand_piano', 'grand', '平台鋼琴'].includes(type)) return 'grand_piano';
  if (['upright_piano', 'upright', '直立鋼琴'].includes(type)) return 'upright_piano';
  return '';
}

function inferredPianoType(room) {
  const name = clean(room && room.name);
  if (/展演|團練/.test(name)) return 'digital_piano';
  if (/yamaha.*平台|平台.*yamaha|5號鋼琴|五號鋼琴/i.test(name)) return 'grand_piano';
  if (/kawai|卡哇伊|yamaha.*直立|直立.*yamaha/i.test(name)) return 'upright_piano';
  return '';
}

function configuredPianoType(room, setting = {}) {
  const explicit = normalizePianoType(setting.pianoType || setting.pianoEquipmentType);
  if (explicit === 'none') return '';
  if (explicit) return explicit;
  const equipment = [
    ...firstArray(setting, ['equipment', 'rentalEquipment']),
    ...firstArray(room, ['equipment', 'rentalEquipment'])
  ];
  const configured = equipment.map(normalizePianoType).find((type) =>
    ['digital_piano', 'grand_piano', 'upright_piano'].includes(type)
  );
  return configured || inferredPianoType(room);
}

function pianoTypeLabel(type) {
  if (type === 'digital_piano') return '電鋼琴';
  if (type === 'grand_piano') return '平台鋼琴';
  if (type === 'upright_piano') return '直立鋼琴';
  return '';
}

function roomEquipmentLabel(room, setting = {}) {
  return pianoTypeLabel(configuredPianoType(room, setting));
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
    if (/鋼琴|平台|yamaha|kawai|卡哇伊|琴房|展演|團練/.test(name)) useTypes.push('piano');
    if (/展演|團練|表演/.test(name)) useTypes.push('band');
    if (/展演|kawai|卡哇伊/.test(name)) useTypes.push('guzheng');
    if (/錄音室|錄音/.test(name)) useTypes.push('recording');
  }
  if (/電子鼓/.test(name)) equipment.push('electronic_drums');
  if (/傳統鼓|爵士鼓|團練/.test(name)) equipment.push('acoustic_drums');
  if (/鋼琴|平台|yamaha|kawai|琴房/.test(name)) equipment.push('piano');
  if (/展演|團練/.test(name)) equipment.push('digital_piano', 'piano');
  if (/yamaha.*平台|平台.*yamaha|5號鋼琴|五號鋼琴/.test(name)) equipment.push('grand_piano', 'piano');
  if (/kawai|卡哇伊|yamaha.*直立|直立.*yamaha/.test(name)) equipment.push('upright_piano', 'piano');
  if (/展演/.test(name)) equipment.push('guzheng');
  const pianoType = configuredPianoType(room, setting);
  if (pianoType) equipment.push(pianoType, 'piano');
  const inferredCapacity = /展演|團練|表演/.test(name) ? 8 : 3;
  return {
    useTypes: [...new Set(useTypes)],
    equipment: [...new Set(equipment)],
    capacity: Math.max(1, Number(setting.capacity || room.capacity || inferredCapacity)),
    publicName: clean(setting.publicName || room.publicName || room.name)
  };
}

function flagTrue(value) {
  return value === true || clean(value).toLowerCase() === 'true';
}

function rentalPreferenceAllowsRoom(room, setting, data) {
  const useType = clean(data && data.useType);
  const name = clean(room && room.name);
  if (useType === 'piano') {
    if (normalizePianoType(setting && (setting.pianoType || setting.pianoEquipmentType)) === 'none') return false;
    const roomPianoType = configuredPianoType(room, setting);
    const preference = clean(data && data.pianoType).toLowerCase() ||
      (flagTrue(data && data.excludeDigitalPiano) ? 'exclude_digital' : 'any');
    if (preference === 'exclude_digital' && roomPianoType === 'digital_piano') return false;
    if (preference === 'grand_piano' && roomPianoType !== 'grand_piano') return false;
    if (preference === 'upright_piano' && roomPianoType !== 'upright_piano') return false;
  }
  if (useType === 'guzheng' && /kawai|卡哇伊/i.test(name) && !flagTrue(data.allowGuzhengMove)) {
    return false;
  }
  if (useType === 'drums') {
    const drumType = clean(data.drumType);
    if (['acoustic_drums', 'electronic_drums'].includes(drumType)) {
      return rentalRoomProfile(room, setting).equipment.includes(drumType);
    }
  }
  return true;
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
  if (!teacher) throw new HttpsError('not-found', '找不到這個老師帳號的資料。');
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
  const [payroll, adjustments, portalAdjustmentsSnap] = await Promise.all([
    mirrorRowsByField('teacherPayroll', 'teacherId', session.teacherId),
    mirrorRowsByField('teacherAdjustments', 'teacherId', session.teacherId),
    db.collection('coursePortalTeacherAdjustments').where('teacherId','==',session.teacherId).get()
  ]);
  const portalAdjustments=portalAdjustmentsSnap.docs.map(doc=>Object.assign({__id:doc.id},jsonValue(doc.data())||{}));
  return {
    ok: true,
    teacher: {
      id: session.teacherId,
      name: clean(teacher.name),
      phoneLast4: normalizePhone(sourcePhone(teacher)).slice(-4),
      subjectIds: firstArray(teacher, ['subjectIds', 'subjects'])
    },
    week: { start, end },
    hours: { start: 10, end: 21, closedWeekday: 1 },
    rooms: bundle.rooms.map((room) => ({
      id: sourceId(room),
      name: clean(room.name),
      equipmentLabel: roomEquipmentLabel(room),
      rentalFee: Number(room.rentalFee || room.price || 0),
      allowedSubjectIds: firstArray(room, ['allowedSubjectIds', 'subjectIds'])
    })),
    subjects: bundle.subjects.map((subject) => ({ id: sourceId(subject), name: clean(subject.name) })),
    events: bundle.events,
    roster,
    payroll: payroll.filter((row) => clean(row.month || row.payrollMonth || eventDate(row).slice(0, 7)) === month),
    adjustments: adjustments.concat(portalAdjustments).filter((row) => clean(row.month || row.payrollMonth || eventDate(row).slice(0, 7)) === month)
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
  const [bundle, policy, roomSettingsSnapshot] = await Promise.all([
    scheduleBundle(startDate, endDate, session.teacherId),
    rentalPolicySettings(),
    db.collection('coursePortalRoomSettings').get()
  ]);
  const roomSettingsMap = {};
  roomSettingsSnapshot.docs.forEach((doc) => { roomSettingsMap[doc.id] = doc.data() || {}; });
  const compatibleRooms = bundle.rooms.filter(sourceActive).filter((room) =>
    roomKind(room, roomSettingsMap[sourceId(room)] || {}) === 'normal' &&
    roomTeacherSchedulable(room, roomSettingsMap[sourceId(room)] || {}) &&
    roomSupportsSubject(room, subjectId, bundle, roomSettingsMap[sourceId(room)] || {})
  );
  const slots = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(startDate, offset);
    const window = businessWindow(policy, date);
    if (window.closed) continue;
    for (let minute = window.startMinutes; minute + duration <= window.endMinutes; minute += 30) {
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
      ).map((room) => ({
        id: sourceId(room),
        name: clean(room.name),
        equipmentLabel: roomEquipmentLabel(room)
      }));
      if (rooms.length) slots.push({ date, startTime: slotStart, endTime: slotEnd, rooms });
    }
  }
  return { ok: true, startDate, endDate, durationMinutes: duration, slots };
}

async function studentPortalData(data) {
  const session = await requireSession(data, ['student']);
  const sessionBindings = await activeStudentBindingsForSession(session);
  const currentIds = [...new Set(sessionBindings.map((row) => clean(row.studentId)).filter(Boolean))];
  const requested = clean(data.studentId);
  if (requested && !currentIds.includes(requested)) throw new HttpsError('permission-denied', '沒有這位學生的查看權限。');
  const studentIds = requested ? [requested] : currentIds;
  const [students, periods, attendance, events, teachers, subjects] = await Promise.all([
    mirrorRows('students'),
    mirrorRows('tuitionPeriods'),
    mirrorRows('attendance'),
    mirrorRows('events'),
    mirrorRows('teachers'),
    mirrorRows('subjects')
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
    bindings: sessionBindings.map((row) => {
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

async function updateStudentReminder(data) {
  const session = await requireSession(data, ['student']);
  const studentId = clean(data.studentId);
  if (!studentId) throw new HttpsError('invalid-argument', '請選擇學生。');
  const sessionBindings = await activeStudentBindingsForSession(session);
  const allowed = [...new Set(sessionBindings.map((row) => clean(row.studentId)).filter(Boolean))];
  if (!allowed.includes(studentId)) {
    throw new HttpsError('permission-denied', '沒有這位學生的提醒設定權限。');
  }
  const targets = sessionBindings.filter((row) => clean(row.studentId) === studentId);
  if (!targets.length) throw new HttpsError('not-found', '找不到這位學生的有效登入帳號。');
  const batch = db.batch();
  targets.forEach((row) => batch.set(row.__ref, {
    reminderLastLesson: data.reminderLastLesson !== false,
    reminderPayment: data.reminderPayment !== false,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true }));
  await batch.commit();
  return { ok: true, studentId };
}

async function rentalAvailability(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const date = dateKey(data.date);
  const startTime = clean(data.startTime).slice(0, 5);
  const policy = await rentalPolicySettings();
  const duration = Math.min(policy.maxDurationMinutes, Math.max(30, Number(data.durationMinutes || 60)));
  const startMinutes = timeMinutes(startTime);
  const endMinutes = startMinutes + duration;
  const endTime = String(Math.floor(endMinutes / 60)).padStart(2, '0') + ':' + String(endMinutes % 60).padStart(2, '0');
  if (!date || !startTime) throw new HttpsError('invalid-argument', '請選擇日期與時間。');
  const window = businessWindow(policy, date);
  if (window.closed) throw new HttpsError('failed-precondition', '這一天公休，不能預約。');
  if (startMinutes < window.startMinutes || endMinutes > window.endMinutes) {
    throw new HttpsError('failed-precondition', '所選時間不在營業時間內。');
  }
  const bundle = await scheduleBundle(date, date, session.role === 'teacher' ? session.teacherId : '');
  const roomSettings = await db.collection('coursePortalRoomSettings').get();
  const useOptions = await rentalUseOptions(bundle.rooms);
  const selectedUse = useOptions.find((row) => row.id === clean(data.useType));
  if (!selectedUse) throw new HttpsError('invalid-argument', '請選擇租用用途。');
  const settingsMap = {};
  roomSettings.docs.forEach((doc) => { settingsMap[doc.id] = doc.data() || {}; });
  const studentRate = data.studentDiscountRequested === true || clean(data.studentDiscountRequested).toLowerCase() === 'true';
  const rooms = bundle.rooms.filter(sourceActive).map((room) => {
    const id = sourceId(room);
    const setting = settingsMap[id] || {};
    const blocked = bundle.events.some((event) =>
      eventBlocksResource(event) && event.roomId === id && event.date === date &&
      overlaps(startTime, endTime, event.startTime, event.endTime)
    );
    const profile = rentalRoomProfile(room, setting);
    const rentable = roomRentable(room, setting);
    const categoryAllowed = rentalUseAllowsRoom(useOptions, data.useType, id);
    const preferenceAllowed = rentalPreferenceAllowsRoom(room, setting, data);
    const baseFee = effectiveRentalFee(room, setting, selectedUse);
    const available = !blocked && rentable && categoryAllowed && preferenceAllowed;
    const equipmentLabel = roomEquipmentLabel(room, setting);
    return {
      id,
      name: profile.publicName,
      kind: roomKind(room, setting),
      available,
      reason: blocked
        ? '時段已被使用'
        : (!rentable
          ? '不開放租用'
          : (!categoryAllowed
            ? '不屬於這個用途'
            : (!preferenceAllowed ? '已依設備條件排除' : ''))),
      matchLevel: 'best',
      capacity: profile.capacity,
      equipment: profile.equipment,
      equipmentLabel,
      unitFee: baseFee,
      price: Math.round(baseFee * duration / 60 * (studentRate ? policy.studentDiscountRate : 1)),
      priceType: studentRate ? '柚子學生半價' : '一般價格'
    };
  });
  return {
    ok: true,
    date,
    startTime,
    endTime,
    durationMinutes: duration,
    businessHours: policy.businessHours,
    useOptions,
    studentDiscountRate: policy.studentDiscountRate,
    rooms: rooms.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  };
}

async function rentalDayBoard(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const date = dateKey(data.date);
  if (!date) throw new HttpsError('invalid-argument', '請選擇日期。');
  const policy = await rentalPolicySettings();
  const duration = Math.min(policy.maxDurationMinutes, Math.max(30, Number(data.durationMinutes || 60)));
  const window = businessWindow(policy, date);
  const bundle = await scheduleBundle(date, date, session.role === 'teacher' ? session.teacherId : '');
  const roomSettings = await db.collection('coursePortalRoomSettings').get();
  const useOptions = await rentalUseOptions(bundle.rooms);
  const settingsMap = {};
  roomSettings.docs.forEach((doc) => { settingsMap[doc.id] = doc.data() || {}; });
  const slots = [];
  if (!window.closed) {
    for (let minute = window.startMinutes; minute + duration <= window.endMinutes; minute += 30) {
      const startTime = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
      const endMinute = minute + duration;
      const endTime = String(Math.floor(endMinute / 60)).padStart(2, '0') + ':' + String(endMinute % 60).padStart(2, '0');
      const availableRooms = bundle.rooms.filter(sourceActive).filter((room) => {
        const id = sourceId(room);
        const setting = settingsMap[id] || {};
        if (
          !roomRentable(room, setting) ||
          !rentalUseAllowsRoom(useOptions, data.useType, id) ||
          !rentalPreferenceAllowsRoom(room, setting, data)
        ) return false;
        return !bundle.events.some((event) =>
          eventBlocksResource(event) && event.roomId === id && event.date === date &&
          overlaps(startTime, endTime, event.startTime, event.endTime)
        );
      }).map((room) => ({ id: sourceId(room), name: rentalRoomProfile(room, settingsMap[sourceId(room)] || {}).publicName }));
      slots.push({ startTime, endTime, availableCount: availableRooms.length, rooms: availableRooms.slice(0, 8) });
    }
  }
  return { ok: true, date, closed: window.closed, role: session.role, useOptions, slots };
}

async function rentalWeekBoard(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const startDate = dateKey(data.startDate || data.date);
  if (!startDate) throw new HttpsError('invalid-argument', '請選擇週起始日期。');
  const endDate = addDays(startDate, 6);
  const policy = await rentalPolicySettings();
  const duration = Math.min(policy.maxDurationMinutes, Math.max(30, Number(data.durationMinutes || 60)));
  const bundle = await scheduleBundle(startDate, endDate, session.role === 'teacher' ? session.teacherId : '');
  const roomSettings = await db.collection('coursePortalRoomSettings').get();
  const useOptions = await rentalUseOptions(bundle.rooms);
  const settingsMap = {};
  roomSettings.docs.forEach((doc) => { settingsMap[doc.id] = doc.data() || {}; });
  const days = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(startDate, offset);
    const window = businessWindow(policy, date);
    const slots = [];
    if (!window.closed) {
      for (let minute = window.startMinutes; minute + duration <= window.endMinutes; minute += 30) {
        const startTime = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
        const endMinute = minute + duration;
        const endTime = String(Math.floor(endMinute / 60)).padStart(2, '0') + ':' + String(endMinute % 60).padStart(2, '0');
        const rooms = bundle.rooms.filter(sourceActive).filter((room) => {
          const id = sourceId(room);
          const setting = settingsMap[id] || {};
          if (
            !roomRentable(room, setting) ||
            !rentalUseAllowsRoom(useOptions, data.useType, id) ||
            !rentalPreferenceAllowsRoom(room, setting, data)
          ) return false;
          return !bundle.events.some((event) =>
            eventBlocksResource(event) && event.roomId === id && event.date === date &&
            overlaps(startTime, endTime, event.startTime, event.endTime)
          );
        }).map((room) => ({ id: sourceId(room), name: rentalRoomProfile(room, settingsMap[sourceId(room)] || {}).publicName }));
        slots.push({ startTime, endTime, availableCount: rooms.length, rooms: rooms.slice(0, 8) });
      }
    }
    days.push({ date, closed: window.closed, availableSlotCount: slots.filter((slot) => slot.availableCount > 0).length, slots });
  }
  return { ok: true, startDate, endDate, role: session.role, durationMinutes: duration, useOptions, businessHours: policy.businessHours, days };
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
  const studentIds = session.role === 'student' ? await activeStudentIdsForSession(session) : [];
  const ownerKey = sessionOwnerKey(session);
  if (!ownerKey) throw new HttpsError('unauthenticated', '登入資料不完整，請重新登入。');
  const locks = bookingLockRows(availability.date, room.id, availability.startTime, availability.endTime);
  const booking = {
    id,
    type: 'room_rental',
    date: availability.date,
    startTime: availability.startTime,
    endTime: availability.endTime,
    roomId: room.id,
    roomName: room.name,
    purpose: clean(data.purpose),
    useType: clean(data.useType),
    useName: clean((availability.useOptions.find((row) => row.id === clean(data.useType)) || {}).name),
    pianoType: clean(data.pianoType).toLowerCase() ||
      (flagTrue(data.excludeDigitalPiano) ? 'exclude_digital' : 'any'),
    excludeDigitalPiano: flagTrue(data.excludeDigitalPiano),
    allowGuzhengMove: flagTrue(data.allowGuzhengMove),
    drumType: clean(data.drumType),
    role: session.role,
    teacherId: clean(session.teacherId),
    renterId: clean(session.renterId),
    studentIds,
    studentDiscountRequested: data.studentDiscountRequested === true || clean(data.studentDiscountRequested).toLowerCase() === 'true',
    ownerKey,
    lineUserId: clean(session.lineUserId),
    authAccountId: clean(session.authAccountId),
    amount: room.price,
    unitFee: room.unitFee,
    equipmentLabel: clean(room.equipmentLabel),
    priceType: room.priceType,
    paymentStatus: 'onsite_unpaid',
    status: 'confirmed',
    active: true,
    lockIds: locks.map((row) => row.id),
    createdAt: FieldValue.serverTimestamp(),
    createdAtText: nowText()
  };
  const bookingRef = db.collection('coursePortalRoomBookings').doc(id);
  const changeRef = db.collection('coursePortalScheduleChanges').doc('rental-' + id);
  await db.runTransaction(async (tx) => {
    const lockRefs = locks.map((row) => db.collection('coursePortalRoomLocks').doc(row.id));
    for (const ref of lockRefs) {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data().active !== false) {
        throw new HttpsError('already-exists', '這個時段剛剛已被其他人預約，請重新選擇。');
      }
    }
    tx.set(bookingRef, booking);
    tx.set(changeRef, { action: 'room_booking', active: true, event: booking, createdAt: FieldValue.serverTimestamp() });
    lockRefs.forEach((ref, index) => tx.set(ref, {
      active: true,
      bookingId: id,
      date: availability.date,
      roomId: room.id,
      slot: locks[index].slot,
      createdAt: FieldValue.serverTimestamp()
    }));
  });
  const reminderAt = Math.max(Date.now(), taipeiDateTimeMillis(booking.date, booking.startTime) - 60 * 60 * 1000);
  if (clean(session.lineUserId)) {
    await db.collection('notificationQueue').doc(`course-portal-booking-${id}-reminder`).set({
      queueId: `course-portal-booking-${id}-reminder`,
      channel: 'line',
      targetLineUserId: session.lineUserId,
      title: '教室租用提醒',
      body: [
        `您預約的「${booking.roomName}」將於 ${booking.date} ${booking.startTime} 開始。`,
        `用途：${booking.useName || '教室租用'}`,
        `時間：${booking.startTime}～${booking.endTime}`,
        `如不使用，可在結束前進入租用頁取消：${PORTAL_BASE}/room-booking.html`
      ].join('\n'),
      message: [
        `教室租用提醒`,
        `您預約的「${booking.roomName}」將於 ${booking.date} ${booking.startTime} 開始。`,
        `時間：${booking.startTime}～${booking.endTime}`,
        `如不使用，可在結束前進入租用頁取消：${PORTAL_BASE}/room-booking.html`
      ].join('\n'),
      bookingId: id,
      source: 'course-portal-room-booking',
      status: '待發送',
      scheduledAt: Timestamp.fromMillis(reminderAt),
      createdAt: FieldValue.serverTimestamp(),
      createdAtText: nowText()
    }, { merge: true }).catch((error) => {
      console.error('[course portal rental reminder queue failed]', id, error);
    });
  }
  return { ok: true, booking: jsonValue(booking) };
}

async function rentalMyBookings(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const bookingQueries = [
    db.collection('coursePortalRoomBookings').where('ownerKey', '==', sessionOwnerKey(session)).get()
  ];
  if (clean(session.lineUserId)) {
    bookingQueries.push(
      db.collection('coursePortalRoomBookings').where('lineUserId', '==', clean(session.lineUserId)).get()
    );
  }
  if (clean(session.authAccountId)) {
    bookingQueries.push(
      db.collection('coursePortalRoomBookings').where('authAccountId', '==', clean(session.authAccountId)).get()
    );
  }
  const bookingSnapshots = await Promise.all(bookingQueries);
  const bookingDocs = [...new Map(bookingSnapshots.flatMap((snapshot) => snapshot.docs).map((doc) => [doc.id, doc])).values()];
  const bookings = bookingDocs.map((doc) => {
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
      useName: clean(row.useName),
      amount: Number(row.amount || 0),
      paymentStatus: clean(row.paymentStatus),
      status: clean(row.status || (row.active === false ? 'cancelled' : 'confirmed')),
      active: row.active !== false,
      canCancel: row.active !== false && taipeiDateTimeMillis(row.date, row.endTime) > Date.now(),
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
    const sameOwner = clean(booking.ownerKey)
      ? clean(booking.ownerKey) === sessionOwnerKey(session)
      : (
        (clean(booking.lineUserId) && clean(booking.lineUserId) === clean(session.lineUserId)) ||
        (clean(booking.authAccountId) && clean(booking.authAccountId) === clean(session.authAccountId))
      );
    if (!sameOwner) {
      throw new HttpsError('permission-denied', '只能取消自己預約的教室。');
    }
    if (booking.active === false || clean(booking.status) === 'cancelled') {
      throw new HttpsError('failed-precondition', '這筆租用已經取消。');
    }
    if (taipeiDateTimeMillis(booking.date, booking.endTime) <= Date.now()) {
      throw new HttpsError('failed-precondition', '租用時間已結束，無法再取消。');
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
    (Array.isArray(booking.lockIds) ? booking.lockIds : []).forEach((lockId) => {
      tx.delete(db.collection('coursePortalRoomLocks').doc(clean(lockId)));
    });
  });
  await db.collection('notificationQueue').doc(`course-portal-booking-${bookingId}-reminder`).set({
    status: '已取消',
    active: false,
    cancelledAt: FieldValue.serverTimestamp(),
    cancelledAtText: nowText()
  }, { merge: true });
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
  if (!['revoke', 'restore', 'delete'].includes(action)) {
    throw new HttpsError('invalid-argument', '不支援的帳號操作。');
  }
  if (!['single_move', 'permanent_move', 'extra_lesson', 'teacher_gift'].includes(action)) {
    throw new HttpsError('invalid-argument', '不支援的課務操作。');
  }
  const date = dateKey(data.date);
  const startTime = clean(data.startTime).slice(0, 5);
  const endTime = clean(data.endTime).slice(0, 5);
  const roomId = clean(data.roomId);
  const studentId = clean(data.studentId);
  const subjectId = clean(data.subjectId);
  if (!date || !startTime || !endTime || !roomId || !studentId) {
    throw new HttpsError('invalid-argument', '請完整選擇學生、日期、時間與教室。');
  }
  const policy = await rentalPolicySettings();
  const window = businessWindow(policy, date);
  if (window.closed) throw new HttpsError('failed-precondition', '星期一為公休日。');
  if (timeMinutes(startTime) < window.startMinutes || timeMinutes(endTime) > window.endMinutes) {
    throw new HttpsError('failed-precondition', '所選時間不在營業時間內。');
  }
  const bundle = await scheduleBundle(date, date, session.teacherId);
  const roomSettingsSnapshot = await db.collection('coursePortalRoomSettings').get();
  const roomSettingsMap = {};
  roomSettingsSnapshot.docs.forEach((doc) => { roomSettingsMap[doc.id] = doc.data() || {}; });
  const selectedRoom = bundle.rooms.find((room) => sourceId(room) === roomId);
  if (!selectedRoom || !roomTeacherSchedulable(selectedRoom, roomSettingsMap[roomId] || {})) {
    throw new HttpsError('failed-precondition', '這個教室不開放老師排課。');
  }
  if (!roomSupportsSubject(selectedRoom, subjectId, bundle, roomSettingsMap[roomId] || {})) {
    throw new HttpsError('failed-precondition', '這個教室不適合所選樂器，請改選其他教室。');
  }
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
    subjectId,
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
      roomKind(room, roomSettingsMap[sourceId(room)] || {}) === 'normal' &&
      roomTeacherSchedulable(room, roomSettingsMap[sourceId(room)] || {}) &&
      roomSupportsSubject(room, event.subjectId, future, roomSettingsMap[sourceId(room)] || {})
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

async function teacherLateAttendance(data){
  const session=await requireSession(data,['teacher']);
  const sourceDate=dateKey(data.sourceDate);
  const sourceEventId=clean(data.sourceEventId);
  const sourceCourseId=clean(data.sourceCourseId);
  if(!sourceDate||(!sourceEventId&&!sourceCourseId))throw new HttpsError('invalid-argument','缺少要補簽到的課程。');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:TAIPEI,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  if(sourceDate>=today)throw new HttpsError('failed-precondition','當日課程請於晚上 12 點前完成正常簽到；隔日後才能使用補簽到。');
  const bundle=await scheduleBundle(sourceDate,sourceDate,session.teacherId);
  const event=bundle.events.find(row=>row.teacherId===session.teacherId&&row.date===sourceDate&&(row.id===sourceEventId||row.sourceId===sourceEventId||row.fixedCourseId===sourceCourseId));
  if(!event)throw new HttpsError('not-found','找不到這堂課。');
  const key=hash(['late-attendance',session.teacherId,sourceDate,sourceEventId||sourceCourseId].join('|'));
  const requestRef=db.collection('coursePortalLateAttendance').doc(key);
  const adjustmentRef=db.collection('coursePortalTeacherAdjustments').doc(key);
  await db.runTransaction(async tx=>{
    if((await tx.get(requestRef)).exists)throw new HttpsError('already-exists','這堂課已經補簽到。');
    tx.set(requestRef,{id:key,teacherId:session.teacherId,date:sourceDate,eventId:sourceEventId,courseId:sourceCourseId,studentIds:event.studentIds||[],status:'approved',administrationFee:50,createdAt:FieldValue.serverTimestamp(),createdAtText:nowText()});
    tx.set(adjustmentRef,{id:key,teacherId:session.teacherId,month:sourceDate.slice(0,7),date:sourceDate,type:'late_attendance_fee',amount:-50,note:'補簽到行政處理費 NT$50',source:'teacher-portal',createdAt:FieldValue.serverTimestamp(),createdAtText:nowText()});
  });
  return {ok:true,message:'補簽到已完成，並已建立行政處理費 NT$50 扣款。'};
}

async function teacherBonusRequest(data){
  const session=await requireSession(data,['teacher']);
  const studentId=clean(data.studentId),description=clean(data.description);
  if(!studentId||!description)throw new HttpsError('invalid-argument','請選擇學生並填寫申請內容。');
  const photoData=clean(data.photoData);
  if(photoData.length>900000)throw new HttpsError('invalid-argument','照片太大，請重新拍攝或縮小後上傳。');
  const id=db.collection('coursePortalTeacherBonusRequests').doc().id;
  await db.collection('coursePortalTeacherBonusRequests').doc(id).set({id,teacherId:session.teacherId,studentId,studentName:clean(data.studentName),description,photoData,status:'pending',approvedAmount:0,createdAt:FieldValue.serverTimestamp(),createdAtText:nowText()});
  return {ok:true,id,message:'申請已送出，待主管確認獎金金額。'};
}

async function adminBonusRequests(){
  const [requests,teachers]=await Promise.all([db.collection('coursePortalTeacherBonusRequests').orderBy('createdAt','desc').limit(200).get(),mirrorRows('teachers')]);
  const map=indexById(teachers);
  return {ok:true,requests:requests.docs.map(doc=>{const row=jsonValue(doc.data())||{};return Object.assign({},row,{id:doc.id,teacherName:clean(map[clean(row.teacherId)]&&map[clean(row.teacherId)].name)});})};
}
async function adminApproveBonus(data){
  const id=clean(data.id),amount=Math.max(0,Number(data.amount||0));
  if(!id||!amount)throw new HttpsError('invalid-argument','請輸入核定獎金金額。');
  const ref=db.collection('coursePortalTeacherBonusRequests').doc(id);
  await db.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists)throw new HttpsError('not-found','找不到申請。');const row=snap.data()||{};if(clean(row.status)==='approved')throw new HttpsError('already-exists','這筆申請已核定。');tx.set(ref,{status:'approved',approvedAmount:amount,approvedAt:FieldValue.serverTimestamp(),approvedAtText:nowText()},{merge:true});tx.set(db.collection('coursePortalTeacherAdjustments').doc('bonus-'+id),{id:'bonus-'+id,teacherId:clean(row.teacherId),studentId:clean(row.studentId),studentName:clean(row.studentName),month:new Intl.DateTimeFormat('en-CA',{timeZone:TAIPEI,year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7),date:new Intl.DateTimeFormat('en-CA',{timeZone:TAIPEI,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),type:'teacher_bonus',amount,note:clean(row.description),source:'teacher-bonus-request',createdAt:FieldValue.serverTimestamp(),createdAtText:nowText()});});
  return {ok:true,message:'獎金已核定並寫入老師薪資。'};
}

async function publicRentalSettings() {
  const rooms = await mirrorRows('rooms');
  const [items, policy] = await Promise.all([rentalUseOptions(rooms), rentalPolicySettings()]);
  return { ok: true, items, policy };
}

async function adminRentalSettingsData() {
  const rooms = await mirrorRows('rooms');
  const [items, policy, roomSettings] = await Promise.all([
    rentalUseOptions(rooms),
    rentalPolicySettings(),
    db.collection('coursePortalRoomSettings').get()
  ]);
  const settingsMap = {};
  roomSettings.docs.forEach((doc) => { settingsMap[doc.id] = doc.data() || {}; });
  return {
    ok: true,
    items,
    policy,
    rooms: rooms.map((room) => {
      const id = sourceId(room);
      const setting = settingsMap[id] || {};
      return {
        id,
        name: clean(room.name),
        kind: roomKind(room, setting),
        pianoType: configuredPianoType(room, setting),
        rentalFee: effectiveRoomFee(room, setting),
        rentable: roomRentable(room, setting),
        teacherSchedulable: roomTeacherSchedulable(room, setting)
      };
    })
  };
}

async function adminSaveRentalSettings(data) {
  const rooms = await mirrorRows('rooms');
  const allowed = new Set(rooms.map(sourceId));
  const items = (Array.isArray(data.items) ? data.items : []).map((row, index) => ({
    id: clean(row.id) || ('use-' + (index + 1)),
    name: clean(row.name),
    icon: clean(row.icon) || '🎵',
    description: clean(row.description),
    roomIds: (Array.isArray(row.roomIds) ? row.roomIds : []).map(clean).filter((id) => allowed.has(id)),
    hourlyRate: row.hourlyRate === undefined || row.hourlyRate === null || row.hourlyRate === ''
      ? null
      : Math.max(0, Number(row.hourlyRate) || 0),
    active: row.active !== false
  })).filter((row) => row.name);
  const policyInput = data.policy || {};
  const businessHours = {};
  Object.keys(DEFAULT_BUSINESS_HOURS).forEach((day) => {
    const fallback = DEFAULT_BUSINESS_HOURS[day];
    const row = policyInput.businessHours && policyInput.businessHours[day] || fallback;
    businessHours[day] = {
      closed: row.closed === true,
      start: clean(row.start) || fallback.start,
      end: clean(row.end) || fallback.end
    };
  });
  const batch = db.batch();
  batch.set(db.collection('coursePortalSettings').doc('rentalUses'), {
    version: RENTAL_USES_VERSION,
    items,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtText: nowText()
  }, { merge: true });
  batch.set(db.collection('coursePortalSettings').doc('rentalPolicy'), {
    version: 3,
    businessHours,
    studentDiscountRate: 0.5,
    maxDurationMinutes: 300,
    onsitePayment: true,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtText: nowText()
  }, { merge: true });
  (Array.isArray(data.rooms) ? data.rooms : []).forEach((row) => {
    const id = clean(row.id);
    if (!allowed.has(id)) return;
    batch.set(db.collection('coursePortalRoomSettings').doc(id), {
      roomRulesVersion: 1,
      kind: ['normal', 'video', 'holding'].includes(clean(row.kind)) ? clean(row.kind) : 'normal',
      pianoType: normalizePianoType(row.pianoType) || 'none',
      rentalFee: Math.max(0, Number(row.rentalFee || 0)),
      rentable: row.rentable === true,
      teacherSchedulable: row.teacherSchedulable !== false,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtText: nowText()
    }, { merge: true });
  });
  await batch.commit();
  return adminRentalSettingsData();
}

async function adminSaveRoomEquipment(data) {
  const roomId = clean(data.roomId);
  if (!roomId) throw new HttpsError('invalid-argument', '缺少教室資料。');
  const rooms = await mirrorRows('rooms');
  const room = rooms.find((row) => sourceId(row) === roomId);
  if (!room) throw new HttpsError('not-found', '找不到這間教室。');
  const allowedEquipment = new Set([
    'piano',
    'digital_piano',
    'grand_piano',
    'upright_piano',
    'acoustic_drums',
    'electronic_drums',
    'guzheng'
  ]);
  const pianoType = normalizePianoType(data.pianoType) || 'none';
  const equipment = [...new Set(
    (Array.isArray(data.equipment) ? data.equipment : [])
      .map(clean)
      .filter((value) => allowedEquipment.has(value))
      .filter((value) => !['piano', 'digital_piano', 'grand_piano', 'upright_piano'].includes(value))
      .concat(pianoType === 'none' ? [] : ['piano', pianoType])
  )];
  await db.collection('coursePortalRoomSettings').doc(roomId).set({
    pianoType,
    rentalEquipment: equipment,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtText: nowText()
  }, { merge: true });
  return {
    ok: true,
    roomId,
    pianoType: pianoType === 'none' ? '' : pianoType,
    equipment
  };
}

function assertAdminPin(request) {
  const value = clean(request && request.data && request.data.adminPin);
  let expected = '';
  try { expected = clean(ADMIN_PIN.value()); } catch (_) { expected = clean(process.env.INJIAOYUN_MANUAL_SYNC_PIN); }
  if (!expected || !safeEqual(value, expected)) throw new HttpsError('permission-denied', '管理密碼錯誤。');
}

async function adminData() {
  const [teachers, students, renters, teacherRows, studentRows, renterRows, sessions] = await Promise.all([
    db.collection('coursePortalTeacherBindings').get(),
    db.collection('coursePortalStudentBindings').get(),
    db.collection('coursePortalRenterBindings').get(),
    mirrorRows('teachers'),
    mirrorRows('students'),
    db.collection('coursePortalRenters').get(),
    db.collection('coursePortalSessions').get()
  ]);
  const teacherMap = indexById(teacherRows);
  const studentMap = indexById(studentRows);
  const renterMap = {};
  renterRows.docs.forEach((doc) => { renterMap[doc.id] = doc.data() || {}; });
  const activeSessionsByLine = {};
  const activeSessionsByAccount = {};
  sessions.docs.forEach((doc) => {
    const row = doc.data() || {};
    const lineUserId = clean(row.lineUserId);
    const authAccountId = clean(row.authAccountId);
    if (clean(row.status) !== 'active' || asMillis(row.expiresAt) < Date.now()) return;
    if (lineUserId) {
      activeSessionsByLine[lineUserId] = activeSessionsByLine[lineUserId] || new Set();
      activeSessionsByLine[lineUserId].add(doc.id);
    }
    if (authAccountId) {
      activeSessionsByAccount[authAccountId] = activeSessionsByAccount[authAccountId] || new Set();
      activeSessionsByAccount[authAccountId].add(doc.id);
    }
  });
  const map = (snapshot) => snapshot.docs.map((doc) => {
    const row = doc.data() || {};
    const activeSessionIds = new Set([
      ...((activeSessionsByLine[clean(row.lineUserId)] || new Set())),
      ...((activeSessionsByAccount[clean(row.authAccountId)] || new Set()))
    ]);
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
      lineFriendFlag: row.lineFriendFlag == null ? null : row.lineFriendFlag === true,
      authProvider: clean(row.authProvider),
      email: normalizeEmail(row.email),
      emailVerified: row.emailVerified === true,
      emailVerifiedAt: jsonValue(row.emailVerifiedAt),
      relationship: clean(row.relationship),
      teacherId: clean(row.teacherId),
      studentId: clean(row.studentId),
      renterId: clean(row.renterId),
      boundAt: jsonValue(row.boundAt),
      activeSessionCount: activeSessionIds.size,
      reminderLastLesson: row.reminderLastLesson !== false,
      reminderPayment: row.reminderPayment !== false
    };
  });
  return { ok: true, bindings: [...map(teachers), ...map(students), ...map(renters)] };
}

async function commitOperations(operations) {
  const unique = [...new Map(operations.map((operation) => [operation.ref.path, operation])).values()];
  for (let offset = 0; offset < unique.length; offset += 400) {
    const batch = db.batch();
    unique.slice(offset, offset + 400).forEach((operation) => {
      if (operation.action === 'delete') batch.delete(operation.ref);
      else batch.set(operation.ref, operation.data || {}, { merge: true });
    });
    await batch.commit();
  }
}

async function adminBindingAction(data) {
  const type = clean(data.type);
  const id = clean(data.id);
  if (!['teacher', 'student', 'renter'].includes(type) || !id) throw new HttpsError('invalid-argument', '登入資料不完整。');
  const action = clean(data.action);
  const bindingRef = db.collection(bindingCollection(type)).doc(id);
  const bindingSnapshot = await bindingRef.get();
  if (!bindingSnapshot.exists) throw new HttpsError('not-found', '找不到這筆登入資料。');
  const row = bindingSnapshot.data() || {};
  const lineUserId = clean(row.lineUserId);
  const authAccountId = clean(row.authAccountId);

  if (action === 'delete') {
    const collections = [
      'coursePortalSessions',
      'coursePortalAccessTokens',
      'coursePortalEmailOtps',
      'coursePortalBindCodes',
      'coursePortalLineLoginCodes',
      'coursePortalLineOAuthStates',
      'coursePortalLineSetupTokens'
    ];
    const lineSnapshots = lineUserId
      ? await Promise.all(collections.map((name) => db.collection(name).where('lineUserId', '==', lineUserId).get()))
      : [];
    const accountSnapshots = authAccountId
      ? await Promise.all([
        db.collection('coursePortalSessions').where('authAccountId', '==', authAccountId).get(),
        db.collection('coursePortalEmailOtps').where('authAccountId', '==', authAccountId).get()
      ])
      : [];
    const operations = [{ action: 'delete', ref: bindingRef }];
    [...lineSnapshots, ...accountSnapshots].forEach((snapshot) => snapshot.docs.forEach((doc) => {
      operations.push({ action: 'delete', ref: doc.ref });
    }));
    const email = normalizeEmail(row.email);
    if (email) {
      const emailSnapshots = await Promise.all([
        db.collection('coursePortalEmailOtps').where('emailNormalized', '==', email).get(),
        db.collection('coursePortalBindCodes').where('emailNormalized', '==', email).get()
      ]);
      emailSnapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => {
        const source = doc.data() || {};
        if (!clean(source.type) || clean(source.type) === type) {
          operations.push({ action: 'delete', ref: doc.ref });
        }
      }));
      ['bind', 'login', 'account'].forEach((purpose) => {
        const kind = `email-otp-${purpose}-${type}`;
        operations.push({
          action: 'delete',
          ref: db.collection('coursePortalRateLimits').doc(hash(`${kind}|${email}|${currentTaipeiDay()}`))
        });
      });
    }
    if (type === 'renter' && clean(row.renterId)) {
      const renterSnapshot = await db.collection('coursePortalRenters').doc(clean(row.renterId)).get();
      const renterPhone = normalizePhone(renterSnapshot.exists && renterSnapshot.data().phone);
      if (renterPhone) {
        operations.push({
          action: 'delete',
          ref: db.collection('coursePortalRateLimits').doc(
            hash(`renter-contact-login|${renterPhone}|${currentTaipeiDay()}`)
          )
        });
      }
    }
    await commitOperations(operations);
    return {
      ok: true,
      status: 'deleted',
      deletedAuthRecords: new Set(operations.map((operation) => operation.ref.path)).size,
      retainedBusinessHistory: true
    };
  }

  const status = action === 'restore' ? 'active' : 'revoked';
  await bindingRef.set({
    status,
    revokedAt: status === 'revoked' ? FieldValue.serverTimestamp() : null,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  if (status === 'revoked') {
    const sessionSnapshots = await Promise.all([
      lineUserId
        ? db.collection('coursePortalSessions').where('lineUserId', '==', lineUserId).get()
        : Promise.resolve({ docs: [] }),
      authAccountId
        ? db.collection('coursePortalSessions').where('authAccountId', '==', authAccountId).get()
        : Promise.resolve({ docs: [] })
    ]);
    await commitOperations(sessionSnapshots.flatMap((snapshot) => snapshot.docs).map((doc) => ({
      action: 'set',
      ref: doc.ref,
      data: { status: 'revoked', revokedAt: FieldValue.serverTimestamp() }
    })));
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
    if (!clean(binding.lineUserId)) continue;
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
  exportsObject.coursePortalSendEmailOtp = callable((data) => sendEmailOtp(data, {
    sendEmail: helpers.sendEmail
  }));
  exportsObject.coursePortalVerifyEmailOtp = callable(verifyEmailOtp);
  exportsObject.coursePortalStartLineLogin = callable(startLineLogin);
  exportsObject.coursePortalCompleteLineRegistration = callable(completeLineRegistration);
  exportsObject.coursePortalLineLoginCallback = onRequest({
    region: REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [LINE_LOGIN_CHANNEL_SECRET]
  }, lineLoginCallback);
  exportsObject.coursePortalRenterContactLogin = callable(renterContactLogin);
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
  exportsObject.coursePortalTeacherLateAttendance = callable(teacherLateAttendance, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherBonusRequest = callable(teacherBonusRequest, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalRentalUseSettings = callable(publicRentalSettings);
  exportsObject.coursePortalAdminRentalSettingsData = callable(async (data, request) => {
    assertAdminPin(request);
    return adminRentalSettingsData();
  }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalAdminSaveRentalSettings = callable(async (data,request)=>{assertAdminPin(request);return adminSaveRentalSettings(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminSaveRoomEquipment = callable(async (data,request)=>{assertAdminPin(request);return adminSaveRoomEquipment(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminBonusRequests = callable(async (data,request)=>{assertAdminPin(request);return adminBonusRequests();},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminApproveBonus = callable(async (data,request)=>{assertAdminPin(request);return adminApproveBonus(data);},{secrets:[ADMIN_PIN]});
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
