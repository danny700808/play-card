'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const {
  normalizePhone,
  phoneMatches,
  normalizeScheduleStatus,
  courseSourceIds
} = require('./coursePortalUtils');

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
const TEACHER_PAYROLL_MIN_MONTH = '2026-07';
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

const RECORDING_RENTAL_OPTIONS = Object.freeze([
  Object.freeze({
    id: 'general_room',
    name: '一般教室使用',
    hourlyRate: 100
  }),
  Object.freeze({
    id: 'studio_recording',
    name: '錄音室錄音使用',
    hourlyRate: 300
  })
]);

function recordingRentalSelection(data, required = false) {
  const useType = clean(data && data.useType);
  const selectionId = clean(data && data.recordingUsage);
  if (useType !== 'recording') {
    if (selectionId) {
      throw new HttpsError('invalid-argument', '只有錄音室用途可以選擇錄音室使用方式。');
    }
    return null;
  }
  if (!selectionId) {
    if (required) {
      throw new HttpsError(
        'invalid-argument',
        '請選擇「一般教室使用 NT$100/小時」或「錄音室錄音使用 NT$300/小時」。'
      );
    }
    return null;
  }
  const selection = RECORDING_RENTAL_OPTIONS.find((row) => row.id === selectionId);
  if (!selection) {
    throw new HttpsError('invalid-argument', '錄音室使用方式無效，請重新選擇。');
  }
  return selection;
}

function rentalAmount(unitFee, durationMinutes, discountRate = 1) {
  return Math.round(
    Math.max(0, Number(unitFee) || 0) *
    Math.max(0, Number(durationMinutes) || 0) / 60 *
    Math.max(0, Number(discountRate) || 0)
  );
}

function effectiveRentalFee(room, setting = {}, useOption = {}, recordingSelection = null) {
  if (clean(useOption.id) === 'recording') {
    return recordingSelection ? recordingSelection.hourlyRate : null;
  }
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
    priceRangeText: clean(row.id) === 'recording' ? 'NT$100–300／小時' : '',
    roomIds: Array.isArray(row.roomIds) && row.roomIds.length ? row.roomIds.map(clean).filter(Boolean) : ((defaults.find((item) => item.id === clean(row.id)) || {}).roomIds || []),
    hourlyRate: row.hourlyRate === undefined || row.hourlyRate === null || row.hourlyRate === ''
      ? null
      : Math.max(0, Number(row.hourlyRate) || 0),
    active: row.active !== false
  })).filter((row) => row.active);
}

function rentalUseAllowsRoom(options, useType, roomId, room, setting = {}) {
  const selectedUseType = clean(useType);
  if (
    setting.roomRulesVersion === 1 &&
    Object.prototype.hasOwnProperty.call(setting, 'rentalUseTypes') &&
    Array.isArray(setting.rentalUseTypes)
  ) {
    return setting.rentalUseTypes.map(clean).includes(selectedUseType);
  }
  if (
    room &&
    Object.prototype.hasOwnProperty.call(room, 'rentalUseTypes') &&
    Array.isArray(room.rentalUseTypes)
  ) {
    return room.rentalUseTypes.map(clean).includes(selectedUseType);
  }
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
    rows.push({ id: hash(['room-lock', date, roomId, slot].join('|')), slot, roomId, resourceId: '' });
  }
  return rows;
}

function sharedEquipmentLockRows(date, resourceIds, startTime, endTime) {
  const rows = [];
  [...new Set((resourceIds || []).map(clean).filter(Boolean))].forEach((resourceId) => {
    for (let minute = timeMinutes(startTime); minute < timeMinutes(endTime); minute += 30) {
      const slot = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
      rows.push({
        id: hash(['equipment-lock', date, resourceId, slot].join('|')),
        slot,
        roomId: '',
        resourceId
      });
    }
  });
  return rows;
}

function scheduleVersionRef() {
  return db.collection('coursePortalRuntime').doc('scheduleVersion');
}

async function readScheduleVersion() {
  const snapshot = await scheduleVersionRef().get();
  return Number(snapshot.exists && snapshot.data().version || 0);
}

function scheduleSyncInProgress(snapshot) {
  if (!snapshot || !snapshot.exists) return false;
  const row = snapshot.data() || {};
  return row.syncing === true && asMillis(row.syncingUntil) > Date.now();
}

function assertScheduleWritable(snapshot) {
  if (scheduleSyncInProgress(snapshot)) {
    throw new HttpsError('aborted', '課表正在同步最新資料，請稍候再試。');
  }
  if (snapshot && snapshot.exists) {
    const row = snapshot.data() || {};
    if (row.writesBlocked === true || clean(row.integrityStatus).toLowerCase() === 'error') {
      throw new HttpsError(
        'aborted',
        '上一批課表同步未完整完成，為避免重複排課目前暫停儲存；請由管理者重新同步成功後再試。'
      );
    }
  }
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
  return ![
    'false', '停用', '離職', '註銷', '停課', '取消', '已取消', '完成',
    'inactive', 'disabled', 'stopped', 'completed', 'cancelled', 'canceled'
  ].includes(clean(value).toLowerCase());
}

function studentPhoneAccountId(phone) {
  return hash(`student-phone-account|${normalizePhone(phone)}`);
}

async function mergeStudentProfileOverrides(rows) {
  const snapshot = await db.collection('coursePortalStudentProfiles').get();
  const overrides = new Map(snapshot.docs.map((doc) => [doc.id, doc.data() || {}]));
  return rows.map((row) => {
    const override = overrides.get(sourceId(row));
    if (!override || override.active === false) return row;
    const next = Object.assign({}, row);
    const name = clean(override.name);
    const phone = normalizePhone(override.phone);
    if (name) next.name = name;
    if (phone) next.phone = phone;
    return next;
  });
}

function firstArray(row, keys) {
  for (const key of keys) {
    if (Array.isArray(row && row[key])) return row[key].map(clean).filter(Boolean);
  }
  return [];
}

async function mirrorRows(type) {
  const snapshot = await db.collection(MIRROR[type]).where('sourceActive', '==', true).get();
  const rows = snapshot.docs
    .map((doc) => Object.assign({ __id: doc.id }, jsonValue((doc.data() || {}).source) || {}))
    .filter(Boolean);
  return type === 'students' ? mergeStudentProfileOverrides(rows) : rows;
}

async function mirrorRowsByDateRange(type, startDate, endDate, options = {}) {
  const includeInactive = options.includeInactive === true;
  const dates = [];
  for (let key = dateKey(startDate), guard = 0; key && key <= endDate && guard < 3700; key = addDays(key, 1), guard += 1) {
    dates.push(key);
  }
  if (!dates.length) return [];
  try {
    const chunks = [];
    for (let offset = 0; offset < dates.length; offset += 30) chunks.push(dates.slice(offset, offset + 30));
    const snapshots = await Promise.all(chunks.map((chunk) =>
      db.collection(MIRROR[type]).where('source.date', 'in', chunk).get()
    ));
    const rows = new Map();
    snapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => {
      const envelope = doc.data() || {};
      if (!includeInactive && envelope.sourceActive === false) return;
      const source = jsonValue(envelope.source) || {};
      rows.set(doc.id, Object.assign({
        __id: doc.id,
        __mirrorActive: envelope.sourceActive !== false,
        __mirrorUpdatedAt: asMillis(envelope.sourceUpdatedAt || envelope.updatedAt)
      }, source));
    }));
    return [...rows.values()];
  } catch (error) {
    console.warn('[course portal date range fallback]', type, clean(error && error.message));
    const snapshot = includeInactive
      ? await db.collection(MIRROR[type]).get()
      : await db.collection(MIRROR[type]).where('sourceActive', '==', true).get();
    return snapshot.docs.map((doc) => {
      const envelope = doc.data() || {};
      if (!includeInactive && envelope.sourceActive === false) return null;
      const source = jsonValue(envelope.source) || {};
      return Object.assign({
        __id: doc.id,
        __mirrorActive: envelope.sourceActive !== false,
        __mirrorUpdatedAt: asMillis(envelope.sourceUpdatedAt || envelope.updatedAt)
      }, source);
    }).filter((row) => {
      const key = row && eventDate(row);
      return key >= startDate && key <= endDate;
    });
  }
}

async function mirrorRowsByField(type, field, value) {
  const collection = db.collection(MIRROR[type]);
  try {
    const snapshot = await collection
      .where('sourceActive', '==', true)
      .where(`source.${field}`, '==', clean(value))
      .get();
    return snapshot.docs
      .map((doc) => Object.assign({ __id: doc.id }, jsonValue((doc.data() || {}).source) || {}));
  } catch (error) {
    console.warn('[course portal field query fallback]', type, field, clean(error && error.message));
    const snapshot = await collection.where('sourceActive', '==', true).get();
    return snapshot.docs
      .map((doc) => Object.assign({ __id: doc.id }, jsonValue((doc.data() || {}).source) || {}))
      .filter((row) => clean(row[field]) === clean(value));
  }
}

async function scheduleChangeDocsByDateRange(startDate, endDate) {
  const collection = db.collection('coursePortalScheduleChanges');
  try {
    const snapshots = await Promise.all([
      collection.where('event.date', '>=', startDate).where('event.date', '<=', endDate).get(),
      collection.where('sourceDate', '>=', startDate).where('sourceDate', '<=', endDate).get(),
      collection.where('action', '==', 'permanent_move').get()
    ]);
    const docs = new Map();
    snapshots.forEach((snapshot) => snapshot.docs.forEach((doc) => {
      const row = doc.data() || {};
      if (row.active === false) return;
      if (
        clean(row.action) === 'permanent_move' &&
        dateKey(row.cutoverDate || row.sourceDate || row.effectiveDate || row.event && row.event.date) > endDate
      ) return;
      docs.set(doc.id, doc);
    }));
    return [...docs.values()];
  } catch (error) {
    console.warn('[course portal schedule change range fallback]', clean(error && error.message));
    const snapshot = await collection.where('active', '==', true).get();
    return snapshot.docs;
  }
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
  if (!['teacher', 'student', 'renter'].includes(type)) {
    throw new HttpsError('invalid-argument', '不支援的入口類型。');
  }
  assertInput(name, '姓名');
  assertInput(phone, '電話');
  if (type !== 'student') {
    assertInput(email, 'Email');
  }
  if (email && !validEmail(email)) {
    throw new HttpsError('invalid-argument', 'Email 格式不正確。');
  }

  if (type === 'teacher') {
    const teacher = await findPerson('teachers', name, phone);
    const registeredEmail = sourceEmail(teacher);
    if (!registeredEmail) {
      throw new HttpsError('failed-precondition', '老師資料尚未登記 Email，請先由管理者補上後再註冊。');
    }
    if (registeredEmail !== email) {
      throw new HttpsError('permission-denied', 'Email 與老師登記資料不符，請確認後再試。');
    }
    return { type, targetId: sourceId(teacher), name, phone, email, relationship: '', renterId: '' };
  }
  if (type === 'student') {
    const student = await findPerson('students', name, phone);
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
  const renterSnapshot = await db.collection('coursePortalRenters').doc(renterId).get();
  let existingEmailVerified = false;
  if (renterSnapshot.exists) {
    const renter = renterSnapshot.data() || {};
    if (renter.active === false) {
      throw new HttpsError('permission-denied', '這個租用帳號目前已停用，請聯絡柚子樂器。');
    }
    const registeredEmail = sourceEmail(renter);
    if (registeredEmail && registeredEmail !== email) {
      throw new HttpsError('permission-denied', 'Email 與既有租用帳號不符，請使用原 Email 登入或請管理者協助。');
    }
    existingEmailVerified = renter.emailVerified === true;
  }
  return { type, targetId: '', renterId, name, phone, email, relationship: '', existingEmailVerified };
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

function bindingAuthAccountId(type, binding) {
  const explicit = clean(binding && binding.authAccountId);
  if (explicit) return explicit;
  const email = normalizeEmail(binding && (binding.emailNormalized || binding.email));
  return validEmail(email) ? regularAccountId(type, email) : '';
}

function sharedBindingAuthAccountId(type, bindings) {
  const accountIds = [...new Set(
    (bindings || []).map((binding) => bindingAuthAccountId(type, binding)).filter(Boolean)
  )];
  // 同一位家長可能綁多位學生且各有不同 Email。這種情況維持以 LINE
  // 使用者作為租用擁有者，避免任取第一筆而讓每次登入落到不同帳號。
  return accountIds.length === 1 ? accountIds[0] : '';
}

async function resolveRegularIdentity(identity) {
  const type = clean(identity.type);
  const targetField = identityTargetField(type);
  const targetId = identityTargetId(identity);
  const phoneOnlyStudent = type === 'student' && !validEmail(identity.email);
  const fallbackAuthAccountId = phoneOnlyStudent
    ? studentPhoneAccountId(identity.phone)
    : regularAccountId(type, identity.email);
  const phoneHash = hash(normalizePhone(identity.phone));
  const snapshot = await db.collection(bindingCollection(type))
    .where(targetField, '==', targetId)
    .get();
  const rows = snapshot.docs.map((doc) => Object.assign({
    __id: doc.id,
    __ref: doc.ref
  }, doc.data() || {}));
  const sameAccount = rows.filter((row) =>
    clean(row.authAccountId) === fallbackAuthAccountId ||
    (
      validEmail(identity.email) &&
      normalizeEmail(row.emailNormalized || row.email) === normalizeEmail(identity.email)
    ) ||
    (phoneOnlyStudent && clean(row.phoneHash) === phoneHash)
  );
  if (sameAccount.some((row) => clean(row.status) === 'revoked')) {
    throw new HttpsError('permission-denied', '這個入口帳號目前已停用，請聯絡柚子樂器協助恢復。');
  }
  const active = sameAccount.find((row) =>
    clean(row.status) === 'active' && clean(row.lineUserId)
  ) || sameAccount.find((row) => clean(row.status) === 'active') || null;
  return {
    authAccountId: clean(active && active.authAccountId) || fallbackAuthAccountId,
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

async function studentPhoneAccess(data) {
  const identity = await prepareBindingIdentity(Object.assign({}, data, {
    type: 'student',
    email: ''
  }));
  await consumeRateLimit('student-name-phone-access', identity.phone);
  const regularIdentity = await resolveRegularIdentity(identity);
  const authAccountId = regularIdentity.authAccountId || studentPhoneAccountId(identity.phone);
  const bindingId = clean(regularIdentity.bindingId) || hash([
    'student-name-phone',
    authAccountId,
    identity.targetId
  ].join('|'));
  const bindingRef = db.collection('coursePortalStudentBindings').doc(bindingId);
  const existing = await bindingRef.get();
  const previous = existing.exists ? existing.data() || {} : {};
  if (clean(previous.status) === 'revoked') {
    throw new HttpsError('permission-denied', '這個入口帳號目前已停用，請聯絡柚子樂器協助恢復。');
  }
  await bindingRef.set({
    type: 'student',
    studentId: clean(identity.targetId),
    name: clean(identity.name),
    phoneHash: hash(normalizePhone(identity.phone)),
    authAccountId,
    authProvider: clean(previous.lineUserId) ? 'line-login+name-phone' : 'name-phone',
    relationship: clean(data.relationship) || clean(previous.relationship) || '本人／家長',
    status: 'active',
    reminderLastLesson: previous.reminderLastLesson !== false,
    reminderPayment: previous.reminderPayment !== false,
    registeredAt: previous.registeredAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  const issued = await issueSession({
    type: 'student',
    lineUserId: clean(previous.lineUserId || regularIdentity.lineUserId),
    authAccountId,
    targetId: clean(identity.targetId),
    renterId: '',
    authMethod: 'student-name-phone'
  });
  return {
    ok: true,
    role: 'student',
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
  void data;
  throw new HttpsError(
    'failed-precondition',
    '姓名加電話快速登入已停用；請使用 LINE 登入，或以姓名、電話及 Email 接收四碼驗證碼。'
  );
}

async function issueAccessToken({ type, lineUserId, authAccountId, targetId, renterId, authMethod, lineFriendFlag }) {
  const raw = randomToken(32);
  const expiresAt = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
  await db.collection('coursePortalAccessTokens').doc(hash(raw)).set({
    type,
    lineUserId,
    authAccountId: clean(authAccountId),
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
        authAccountId: sharedBindingAuthAccountId(type, bindings),
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
  // LINE 與 Email 是兩種登入方法，不是兩個人。帳號鍵只能由伺服器依
  // 已核對的角色、內部對象與 Email 產生，不能採信前端傳入的值。
  const regularIdentity = await resolveRegularIdentity(identity);
  const authAccountId = regularIdentity.authAccountId;
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
    authAccountId,
    authProvider: 'line-login',
    name: clean(identity.name),
    phoneHash: hash(normalizePhone(identity.phone)),
    status: 'active',
    updatedAt: FieldValue.serverTimestamp(),
    boundAt: FieldValue.serverTimestamp(),
    reminderLastLesson: true,
    reminderPayment: true
  };
  if (validEmail(identity.email)) {
    payload.email = normalizeEmail(identity.email);
    payload.emailNormalized = normalizeEmail(identity.email);
    payload.emailVerified = false;
  }
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
        // 後來加用 LINE 不得把原本已通過四碼驗證的 Email 降級。
        emailVerified: identity.existingEmailVerified === true,
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
    authAccountId,
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
      authAccountId: sharedBindingAuthAccountId(type, active),
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
    authAccountId: regularAccountId(type, row.email),
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
    authAccountId: payload.authAccountId,
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
    authAccountId: source.authAccountId,
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

function safeRentalDisplayName(value) {
  const name = clean(value).normalize('NFKC');
  if (!name || name.length > 60 || /[@\r\n]/.test(name) || /[\p{Cc}\p{Cf}]/u.test(name)) return '';
  const digits = name.replace(/\D/g, '');
  if (digits.length >= 8) return '';
  return name;
}

async function rentalSessionDisplayName(session) {
  const directName = safeRentalDisplayName(session && (session.displayName || session.name));
  if (directName) return directName;
  try {
    if (clean(session && session.role) === 'renter' && clean(session.renterId)) {
      const renterSnapshot = await db.collection('coursePortalRenters').doc(clean(session.renterId)).get();
      const renter = renterSnapshot.exists ? renterSnapshot.data() || {} : {};
      const renterName = safeRentalDisplayName(renter.name || renter.displayName);
      if (renterName) return renterName;
    }

    let bindings = [];
    if (clean(session && session.role) === 'student') {
      bindings = await activeStudentBindingsForSession(session);
    } else {
      const role = clean(session && session.role);
      const collection = db.collection(bindingCollection(role));
      const queries = [];
      if (clean(session && session.authAccountId)) {
        queries.push(collection.where('authAccountId', '==', clean(session.authAccountId)).get());
      }
      if (clean(session && session.lineUserId)) {
        queries.push(collection.where('lineUserId', '==', clean(session.lineUserId)).get());
      }
      if (role === 'teacher' && clean(session.teacherId)) {
        queries.push(collection.where('teacherId', '==', clean(session.teacherId)).get());
      }
      if (role === 'renter' && clean(session.renterId)) {
        queries.push(collection.where('renterId', '==', clean(session.renterId)).get());
      }
      const snapshots = await Promise.all(queries);
      bindings = [...new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((doc) => [
        doc.id,
        Object.assign({ __id: doc.id }, doc.data() || {})
      ])).values()];
    }
    const active = bindings.filter((row) => clean(row.status || 'active') === 'active');
    const role = clean(session && session.role);
    const exactBindings = role === 'teacher' && clean(session.teacherId)
      ? active.filter((row) => clean(row.teacherId) === clean(session.teacherId))
      : (role === 'renter' && clean(session.renterId)
        ? active.filter((row) => clean(row.renterId) === clean(session.renterId))
        : active);
    const preferredBindings = exactBindings.length ? exactBindings : active;
    const registeredName = preferredBindings
      .map((row) => safeRentalDisplayName(row.name || row.displayName))
      .find(Boolean);
    if (registeredName) return registeredName;
    const lineDisplayName = preferredBindings
      .map((row) => safeRentalDisplayName(row.lineDisplayName))
      .find(Boolean);
    if (lineDisplayName) return lineDisplayName;

    if (clean(session && session.role) === 'teacher' && clean(session.teacherId)) {
      const teachers = await mirrorRows('teachers');
      const teacher = teachers.find((row) => sourceId(row) === clean(session.teacherId)) || {};
      return safeRentalDisplayName(teacher.name || teacher.displayName || teacher.teacherName);
    }
    if (clean(session && session.role) === 'student') {
      const studentIds = [...new Set([
        ...(Array.isArray(session.studentIds) ? session.studentIds : []),
        ...active.map((row) => row.studentId)
      ].map(clean).filter(Boolean))];
      if (studentIds.length) {
        const students = await mirrorRows('students');
        const student = students.find((row) => studentIds.includes(sourceId(row))) || {};
        return safeRentalDisplayName(student.name || student.displayName || student.studentName);
      }
    }
    return '';
  } catch (error) {
    console.warn('[course portal rental display name]', clean(error && error.message));
    return '';
  }
}

function eventDate(row) {
  return dateKey(row.date || row.courseDate || row.startDate || row.lessonDate);
}

function eventStart(row) {
  return clean(row.startTime || row.timeStart || row.beginTime || row.start).slice(0, 5);
}

function eventEnd(row) {
  const explicit = clean(row.endTime || row.timeEnd || row.finishTime || row.end).slice(0, 5);
  if (explicit) return explicit;
  const start = eventStart(row);
  if (!start) return '';
  const duration = Math.max(30, Number(row.durationMinutes || row.duration || row.minutes || 60));
  const end = timeMinutes(start) + duration;
  return String(Math.floor(end / 60)).padStart(2, '0') + ':' + String(end % 60).padStart(2, '0');
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

const GUZHENG_RESOURCE_ID = 'equipment:guzheng';

function subjectUsesGuzheng(subjectId, maps = {}) {
  const id = clean(subjectId).toLowerCase();
  const subject = maps.subjects && maps.subjects[subjectId] || {};
  const name = clean(subject.name || subject.subjectName || subject.title).toLowerCase();
  return id === 'guzheng' || /古箏/.test(name);
}

function eventUsesGuzheng(row, maps = {}) {
  const useType = clean(row && (row.useType || row.rentalUseType || row.purposeType)).toLowerCase();
  const description = clean(row && (row.useName || row.subjectName || row.purpose || row.title)).toLowerCase();
  return useType === 'guzheng' ||
    /古箏/.test(description) ||
    subjectUsesGuzheng(eventSubjectId(row || {}), maps);
}

function eventSharedResourceIds(row, maps = {}) {
  const explicit = firstArray(row || {}, ['resourceIds', 'sharedResourceIds']).map(clean).filter(Boolean);
  if (eventUsesGuzheng(row, maps)) explicit.push(GUZHENG_RESOURCE_ID);
  return [...new Set(explicit)];
}

function sharedResourceConflict(events, resourceIds) {
  const requested = new Set((resourceIds || []).map(clean).filter(Boolean));
  if (!requested.size) return false;
  return (events || []).some((event) =>
    (event.resourceIds || []).some((resourceId) => requested.has(clean(resourceId)))
  );
}

function requestedRentalResourceIds(data) {
  return clean(data && data.useType).toLowerCase() === 'guzheng'
    ? [GUZHENG_RESOURCE_ID]
    : [];
}

function requestedSubjectResourceIds(subjectId, bundle) {
  return subjectUsesGuzheng(subjectId, bundle && bundle.maps || {})
    ? [GUZHENG_RESOURCE_ID]
    : [];
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return timeMinutes(aStart) < timeMinutes(bEnd) && timeMinutes(bStart) < timeMinutes(aEnd);
}

function validPortalTime(value, halfHourOnly = false) {
  const match = clean(value).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return false;
  return !halfHourOnly || ['00', '30'].includes(match[2]);
}

function assertPortalInterval(startTime, endTime) {
  if (!validPortalTime(startTime, true) || !validPortalTime(endTime, true)) {
    throw new HttpsError('invalid-argument', '時間必須以 30 分鐘為單位。');
  }
  const duration = timeMinutes(endTime) - timeMinutes(startTime);
  if (duration < 30 || duration > 300 || duration % 30 !== 0) {
    throw new HttpsError('invalid-argument', '結束時間必須晚於開始時間，且最長為 5 小時。');
  }
  return duration;
}

function safeFrequencyWeeks(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(52, Math.max(1, Math.floor(parsed)));
}

function daysBetween(left, right) {
  const start = dateKey(left);
  const end = dateKey(right);
  if (!start || !end) return NaN;
  return Math.round(
    (new Date(`${end}T12:00:00+08:00`).getTime() -
      new Date(`${start}T12:00:00+08:00`).getTime()) / 86400000
  );
}

function permanentLineage(row) {
  return clean(row && (
    row.sourceCourseId ||
    row.sourceEventId ||
    row.event && (row.event.fixedCourseId || row.event.seriesId)
  ));
}

function permanentCutover(row) {
  return dateKey(row && (
    row.cutoverDate ||
    row.sourceDate ||
    row.effectiveDate ||
    row.event && eventDate(row.event)
  ));
}

function permanentAnchor(row) {
  return dateKey(row && (
    row.anchorDate ||
    row.event && eventDate(row.event) ||
    row.effectiveDate ||
    permanentCutover(row)
  ));
}

function changeOrderValue(row) {
  return Math.max(
    asMillis(row && row.updatedAt),
    asMillis(row && row.createdAt),
    asMillis(row && row.createdAtText)
  );
}

function effectivePermanentChanges(rows) {
  const latest = new Map();
  (rows || []).filter((row) => clean(row && row.action) === 'permanent_move' && row.event).forEach((row) => {
    const lineage = permanentLineage(row);
    const cutover = permanentCutover(row);
    if (!lineage || !cutover) return;
    const key = `${lineage}|${cutover}`;
    const current = latest.get(key);
    if (
      !current ||
      changeOrderValue(row) > changeOrderValue(current) ||
      (
        changeOrderValue(row) === changeOrderValue(current) &&
        clean(row.__id || row.id).localeCompare(clean(current.__id || current.id)) > 0
      )
    ) latest.set(key, row);
  });
  return [...latest.values()].sort((left, right) =>
    permanentLineage(left).localeCompare(permanentLineage(right)) ||
    permanentCutover(left).localeCompare(permanentCutover(right)) ||
    changeOrderValue(left) - changeOrderValue(right) ||
    clean(left.__id || left.id).localeCompare(clean(right.__id || right.id))
  );
}

function translateRecurringStatusMap(statusByDate, cutoverDate, anchorDate, frequencyWeeks) {
  const source = statusByDate && typeof statusByDate === 'object' ? statusByDate : {};
  const cutover = dateKey(cutoverDate);
  const anchor = dateKey(anchorDate);
  const stepDays = safeFrequencyWeeks(frequencyWeeks) * 7;
  if (!cutover || !anchor) return Object.assign({}, source);
  return Object.entries(source).reduce((result, [rawDate, value]) => {
    const key = dateKey(rawDate);
    if (!key) return result;
    if (key < cutover) {
      result[key] = value;
      return result;
    }
    const delta = daysBetween(cutover, key);
    if (delta >= 0 && delta % stepDays === 0) {
      result[addDays(anchor, delta)] = value;
    } else {
      // 有些舊資料已用調整後的實際日期記錄例外；非原週期日不可直接丟棄。
      result[key] = value;
    }
    return result;
  }, {});
}

function scheduleOccurrenceActive(row) {
  return row && row.__mirrorActive !== false &&
    normalizeScheduleStatus(row.status || 'scheduled') !== 'cancelled' &&
    sourceActive(row);
}

function eventBlocksResource(event) {
  const status = normalizeScheduleStatus(event && event.status);
  // 請假、取消或已調走才會釋出空間。曠課時老師仍可能在原教室等待，
  // 因此曠課仍占用老師與教室，避免同時再排入另一堂課。
  return !['leave', 'cancelled', 'pending_conflict'].includes(status);
}

function scheduleResourceConflicts(events) {
  const slots = new Map();
  (events || []).filter(eventBlocksResource).forEach((event) => {
    const identity = [
      clean(event.fixedCourseId || event.seriesId || event.sourceId || event.id),
      clean(event.date),
      clean(event.startTime),
      clean(event.endTime)
    ].join('|');
    const resources = [
      clean(event.roomId) ? `room:${clean(event.roomId)}` : '',
      clean(event.teacherId) ? `teacher:${clean(event.teacherId)}` : '',
      ...(event.studentIds || []).map((id) => clean(id) ? `student:${clean(id)}` : ''),
      ...(event.resourceIds || []).map(clean)
    ].filter(Boolean);
    for (let minute = timeMinutes(event.startTime); minute < timeMinutes(event.endTime); minute += 30) {
      const slot = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
      resources.forEach((resource) => {
        const key = `${event.date}|${slot}|${resource}`;
        if (!slots.has(key)) slots.set(key, new Map());
        slots.get(key).set(identity, clean(event.id || event.sourceId));
      });
    }
  });
  return [...slots.entries()].filter(([, identities]) => identities.size > 1).slice(0, 500).map(([key, identities]) => {
    const [date, slot, ...resourceParts] = key.split('|');
    const resource = resourceParts.join('|');
    return { date, slot, resource, eventIds: [...identities.values()].filter(Boolean) };
  });
}

function isRoomRentalEvent(event) {
  const type = clean(event && event.type).toLowerCase();
  const action = clean(event && event.portalAction).toLowerCase();
  return ['rental', 'room_rental'].includes(type) ||
    ['rental', 'room_booking'].includes(action);
}

function publicRentalSlotIsPast(date, startTime) {
  return taipeiDateTimeMillis(date, startTime) <= Date.now();
}

function roomPolicyForSlot(room, setting, date, startTime) {
  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][weekday(date)];
  const policies = setting && setting.policies || room && room.policies || {};
  return policies && policies[day] && policies[day][startTime] || {};
}

function roomAllowsInterval(room, setting, date, startTime, endTime, subjectId, mode) {
  for (let minute = timeMinutes(startTime); minute < timeMinutes(endTime); minute += 30) {
    const slot = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
    const policy = roomPolicyForSlot(room, setting, date, slot);
    if (mode === 'rental' ? policy.blockRental === true : policy.blockSchedule === true) return false;
    if (
      mode !== 'rental' &&
      Array.isArray(policy.subjectIds) &&
      policy.subjectIds.length &&
      !policy.subjectIds.map(clean).includes(clean(subjectId))
    ) return false;
  }
  return true;
}

function roomSupportsSubject(room, subjectId, bundle, setting = {}) {
  if (!subjectId) return true;
  const subject = clean(bundle.maps.subjects[subjectId] && bundle.maps.subjects[subjectId].name).toLowerCase();
  const roomName = clean(room.name).toLowerCase();
  const configured = firstArray(setting, ['allowedSubjectIds']);
  const sourceConfigured = firstArray(room, ['allowedSubjectIds', 'subjectIds']);
  const allowed = configured.length ? configured : sourceConfigured;
  if (allowed.length && !allowed.includes(subjectId)) return false;
  const profile = rentalRoomProfile(room, setting);
  if (/爵士鼓|電子鼓|傳統鼓|鼓組/.test(subject)) {
    return profile.equipment.some((item) => ['acoustic_drums', 'electronic_drums'].includes(item)) ||
      /鼓|展演|團練/.test(roomName);
  }
  if (/古箏/.test(subject)) {
    return profile.equipment.includes('guzheng') || /展演|kawai|卡哇伊/.test(roomName);
  }
  if (/鋼琴|電子琴|keyboard|piano/.test(subject)) {
    if (normalizePianoType(setting.pianoType || setting.pianoEquipmentType) === 'none') return false;
    return profile.equipment.includes('piano') || Boolean(configuredPianoType(room, setting)) ||
      /鋼琴|平台|yamaha|kawai|卡哇伊|琴房|展演|團練/.test(roomName);
  }
  if (allowed.length) return true;
  return true;
}

function roomRequiresGuzhengMove(room, subjectId, bundle) {
  const subject = clean(bundle.maps.subjects[subjectId] && bundle.maps.subjects[subjectId].name).toLowerCase();
  return /古箏/.test(subject) && /kawai|卡哇伊/i.test(clean(room && room.name));
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

function resourceEvent(row, maps = {}, recurringLineages = new Set()) {
  const seriesCandidateId = clean(
    row.seriesId ||
    row.fixedCourseId ||
    row.sourceCourseId ||
    row.courseId ||
    row.scheduleId
  );
  const recurring = row.recurring === true ||
    recurringLineages.has(seriesCandidateId) ||
    (
      clean(row.type || row.kind).toLowerCase() === 'fixed' &&
      recurringLineages.has(clean(row.fixedCourseId || row.seriesId || sourceId(row)))
    );
  return {
    id: sourceId(row),
    sourceId: sourceId(row),
    fixedCourseId: clean(row.fixedCourseId || row.sourceCourseId || row.seriesId || row.courseId || row.scheduleId),
    seriesId: clean(row.seriesId || row.fixedCourseId || row.sourceCourseId || row.courseId || row.scheduleId),
    recurring,
    date: eventDate(row),
    startTime: eventStart(row),
    endTime: eventEnd(row),
    roomId: eventRoomId(row),
    teacherId: eventTeacherId(row),
    studentIds: [...new Set(eventStudentIds(row))],
    subjectId: eventSubjectId(row),
    status: normalizeScheduleStatus(row.status || 'scheduled'),
    type: clean(row.type || row.kind || 'lesson'),
    portalAction: clean(row.portalAction),
    portalChangeId: clean(row.portalChangeId),
    requestedRoomId: clean(row.requestedRoomId),
    pendingReason: clean(row.pendingReason),
    resourceIds: eventSharedResourceIds(row, maps)
  };
}

function publicEvent(row, maps, ownTeacherId, recurringLineages = new Set()) {
  const resource = resourceEvent(row, maps, recurringLineages);
  const isOwn = Boolean(ownTeacherId && resource.teacherId === ownTeacherId);
  return {
    id: resource.id,
    sourceId: resource.sourceId,
    fixedCourseId: resource.fixedCourseId,
    seriesId: resource.seriesId,
    recurring: resource.recurring,
    date: resource.date,
    startTime: resource.startTime,
    endTime: resource.endTime,
    roomId: resource.roomId,
    roomName: clean(maps.rooms[resource.roomId] && maps.rooms[resource.roomId].name),
    teacherId: resource.teacherId,
    teacherName: isOwn ? clean(maps.teachers[resource.teacherId] && maps.teachers[resource.teacherId].name) : '',
    studentIds: isOwn ? resource.studentIds : [],
    studentNames: isOwn ? resource.studentIds.map((id) => clean(maps.students[id] && maps.students[id].name)).filter(Boolean) : [],
    subjectId: resource.subjectId,
    subjectName: clean(maps.subjects[resource.subjectId] && maps.subjects[resource.subjectId].name),
    status: resource.status,
    type: resource.type,
    portalAction: resource.portalAction,
    portalChangeId: resource.portalChangeId,
    requestedRoomId: resource.requestedRoomId,
    pendingReason: resource.pendingReason,
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

async function activeStudentSuspensions() {
  const snapshot = await db.collection('coursePortalStudentSuspensions')
    .where('status', '==', 'active')
    .get();
  return snapshot.docs.map((doc) => Object.assign({
    id: doc.id
  }, jsonValue(doc.data()) || {}));
}

function suspensionAppliesToEvent(suspension, row) {
  const effectiveDate = dateKey(
    suspension.effectiveDate ||
    suspension.stopDate ||
    suspension.requestedAtText
  );
  return clean(suspension.teacherId) === eventTeacherId(row) &&
    eventStudentIds(row).includes(clean(suspension.studentId)) &&
    (!effectiveDate || eventDate(row) >= effectiveDate);
}

function applyStudentSuspensions(row, suspensions) {
  const originalStudentIds = eventStudentIds(row);
  if (!originalStudentIds.length) return row;
  const retainedStudentIds = originalStudentIds.filter((studentId) =>
    !(suspensions || []).some((suspension) =>
      clean(suspension.studentId) === studentId &&
      suspensionAppliesToEvent(suspension, row)
    )
  );
  if (retainedStudentIds.length === originalStudentIds.length) return row;
  if (!retainedStudentIds.length) return null;
  return Object.assign({}, row, {
    studentId: retainedStudentIds.length === 1 ? retainedStudentIds[0] : '',
    studentIds: retainedStudentIds,
    students: retainedStudentIds,
    student_ids: retainedStudentIds
  });
}

async function scheduleBundle(startDate, endDate, ownTeacherId) {
  const [rooms, subjects, students, teachers, events, fixed, temporary, rentals, changes, suspensions] = await Promise.all([
    mirrorRows('rooms'),
    mirrorRows('subjects'),
    mirrorRows('students'),
    mirrorRows('teachers'),
    mirrorRowsByDateRange('events', startDate, endDate, { includeInactive: true }),
    mirrorRows('fixedCourses'),
    mirrorRowsByDateRange('temporaryCourses', startDate, endDate),
    mirrorRowsByDateRange('roomRentals', startDate, endDate),
    scheduleChangeDocsByDateRange(startDate, endDate),
    activeStudentSuspensions()
  ]);
  const maps = {
    rooms: indexById(rooms),
    subjects: indexById(subjects),
    students: indexById(students),
    teachers: indexById(teachers)
  };
  const livePortalSource = (row) => /^course-portal/i.test(clean(row && row.source));
  // 入口建立的資料以 live change 為唯一準據；同步進 mirror 的舊副本一律不再
  // 參與即時占用，這樣取消後不會等下一次音教雲同步才釋出。
  const inRangeExact = (row) =>
    !livePortalSource(row) &&
    eventDate(row) >= startDate &&
    eventDate(row) <= endDate &&
    eventStart(row) &&
    eventEnd(row);
  const canonicalEvents = events.filter(inRangeExact);
  const canonicalKeys = new Set();
  canonicalEvents.forEach((row) => {
    courseSourceIds(row).forEach((id) => canonicalKeys.add(`${id}|${eventDate(row)}`));
  });
  // 正式日表 events 是同課同日的唯一準據。即使時間已改、業務狀態已取消，
  // 都必須蓋過 temporaryCourses / roomRentals 的舊副本；因此優先鍵不含時間。
  const selectedCanonicalKeys = new Set();
  const selectedCanonical = canonicalEvents
    .filter(scheduleOccurrenceActive)
    .slice()
    .sort((left, right) =>
      Number(right.__mirrorUpdatedAt || asMillis(right.updatedAt)) -
        Number(left.__mirrorUpdatedAt || asMillis(left.updatedAt)) ||
      sourceId(right).localeCompare(sourceId(left))
    )
    .filter((row) => {
      const keys = courseSourceIds(row).map((id) => `${id}|${eventDate(row)}`);
      if (keys.some((key) => selectedCanonicalKeys.has(key))) return false;
      keys.forEach((key) => selectedCanonicalKeys.add(key));
      return true;
    });
  const canonicalStatusByKey = new Map();
  selectedCanonical.forEach((row) => {
    courseSourceIds(row).forEach((id) => {
      canonicalStatusByKey.set(`${id}|${eventDate(row)}`, normalizeScheduleStatus(row.status || 'scheduled'));
    });
  });
  canonicalEvents.forEach((row) => {
    courseSourceIds(row).forEach((id) => {
      const key = `${id}|${eventDate(row)}`;
      if (!canonicalStatusByKey.has(key)) canonicalStatusByKey.set(key, 'cancelled');
    });
  });
  const lowerExactRows = [...temporary, ...rentals].filter(inRangeExact).filter((row) =>
    !courseSourceIds(row).some((id) => canonicalKeys.has(`${id}|${eventDate(row)}`))
  );
  const exactSourceRows = [...canonicalEvents, ...lowerExactRows];
  const exactCandidates = [...selectedCanonical, ...lowerExactRows.filter(scheduleOccurrenceActive)];
  // 日表 events 是指定日期的最新真相，優先於 temporaryCourses / roomRentals
  // 中可能仍殘留的同一來源副本。以所有來源 id + 日期時間建立別名，避免同一堂
  // 被重複算成兩個占用事件。
  const exactAlias = new Set();
  const exact = [];
  exactCandidates.forEach((row) => {
    const aliases = courseSourceIds(row).map((id) =>
      `${id}|${eventDate(row)}|${eventStart(row)}|${eventEnd(row)}`
    );
    if (aliases.some((key) => exactAlias.has(key))) return;
    exact.push(row);
    aliases.forEach((key) => exactAlias.add(key));
  });
  const exactKeys = new Set();
  // 取消／停課的日表列本身不占用，但仍是固定課該日期的 tombstone；
  // 必須阻止 recurring expansion 把它重新生回來。
  exactSourceRows.forEach((row) => {
    courseSourceIds(row).forEach((id) => exactKeys.add(`${id}|${eventDate(row)}`));
  });
  const expanded = [];
  fixed.filter((row) => !livePortalSource(row)).forEach((row) => {
    const start = eventDate(row);
    if (!start || !eventStart(row) || !eventEnd(row)) return;
    const explicitEnd = dateKey(row.endDate || row.recurrenceEndDate);
    const stopDate = dateKey(row.stopDate || row.stoppedAtDate || row.inactiveDate);
    const finalDate = explicitEnd && stopDate
      ? [explicitEnd, stopDate].sort()[0]
      : (explicitEnd || stopDate || (sourceActive(row) ? endDate : start));
    const interval = safeFrequencyWeeks(row.frequencyWeeks || row.intervalWeeks);
    const stepDays = interval * 7;
    const elapsedDays = Math.max(0, Math.floor(
      (new Date(`${startDate}T12:00:00+08:00`).getTime() - new Date(`${start}T12:00:00+08:00`).getTime()) / 86400000
    ));
    let key = elapsedDays ? addDays(start, Math.ceil(elapsedDays / stepDays) * stepDays) : start;
    for (; key <= endDate && key <= finalDate; key = addDays(key, stepDays)) {
      const statusByDate = row.statusByDate || row.exceptions || {};
      const status = normalizeScheduleStatus(statusByDate[key]);
      if (status === 'cancelled') continue;
      const clone = Object.assign({}, row, {
        date: key,
        status: status === 'scheduled' ? clean(row.status || 'scheduled') : status,
        __id: `${sourceId(row)}@${key}`,
        fixedCourseId: sourceId(row)
      });
      if (!exactKeys.has(`${sourceId(row)}|${key}`)) expanded.push(clone);
    }
  });
  const overlay = changes.map((doc) => Object.assign({ __id: doc.id }, jsonValue(doc.data()) || {}));
  const removed = new Set(overlay.filter((row) => ['single_move', 'cancel', 'lesson_status'].includes(row.action))
    .flatMap((row) => [
      `${clean(row.sourceEventId)}|${dateKey(row.sourceDate)}`,
      `${clean(row.sourceCourseId)}|${dateKey(row.sourceDate)}`
    ]));
  const activeFixedRows = fixed.filter((row) => !livePortalSource(row) && sourceActive(row));
  const activeFixedByLineage = new Map(activeFixedRows.map((row) => [sourceId(row), row]));
  const permanent = effectivePermanentChanges(overlay).filter((row) => {
    if (row.action !== 'permanent_move' || !row.event) return false;
    const lineage = permanentLineage(row);
    return activeFixedByLineage.has(lineage);
  });
  const effectivePermanentIds = new Set(permanent.map((row) => clean(row.__id || row.id)));
  const recurringLineages = new Set(
    activeFixedRows.map(sourceId).filter(Boolean)
  );
  permanent.forEach((row) => {
    const lineage = permanentLineage(row);
    if (lineage) recurringLineages.add(lineage);
  });
  const permanentStatusById = new Map();
  const permanentByLineage = new Map();
  permanent.forEach((row) => {
    const lineage = permanentLineage(row);
    if (!permanentByLineage.has(lineage)) permanentByLineage.set(lineage, []);
    permanentByLineage.get(lineage).push(row);
  });
  permanentByLineage.forEach((rows, lineage) => {
    const sourceSeries = activeFixedByLineage.get(lineage) || {};
    let statusByDate = Object.assign({}, sourceSeries.statusByDate || sourceSeries.exceptions || {});
    canonicalStatusByKey.forEach((status, key) => {
      const separator = key.lastIndexOf('|');
      if (separator < 0 || key.slice(0, separator) !== lineage) return;
      statusByDate[key.slice(separator + 1)] = { status, source: 'canonical-event' };
    });
    rows.slice().sort((left, right) =>
      permanentCutover(left).localeCompare(permanentCutover(right)) ||
      changeOrderValue(left) - changeOrderValue(right)
    ).forEach((row) => {
      const frequencyWeeks = safeFrequencyWeeks(row.frequencyWeeks || row.event.frequencyWeeks || row.intervalWeeks);
      statusByDate = translateRecurringStatusMap(
        statusByDate,
        permanentCutover(row),
        permanentAnchor(row),
        frequencyWeeks
      );
      permanentStatusById.set(clean(row.__id || row.id), Object.assign({}, statusByDate));
    });
  });
  const occurrenceIds = (row) => [...new Set([
    ...courseSourceIds(row),
    clean(row && row.seriesId),
    clean(row && row.sourceEventId),
    clean(row && row.portalChangeId)
  ].filter(Boolean))];
  const permanentMatchesOccurrence = (change, row) => {
    const changeIds = new Set([
      ...occurrenceIds(change),
      ...occurrenceIds(change && change.event),
      permanentLineage(change)
    ].filter(Boolean));
    return occurrenceIds(row).some((id) => changeIds.has(id));
  };
  const removedOccurrence = (row, key) => occurrenceIds(row).some((id) => removed.has(`${id}|${key}`));
  const base = [...exact, ...expanded].filter((row) =>
    !removedOccurrence(row, eventDate(row)) &&
    !permanent.some((change) =>
      permanentMatchesOccurrence(change, row) &&
      eventDate(row) >= dateKey(change.cutoverDate || change.sourceDate || change.effectiveDate)
    )
  );
  const handledPermanentExceptions = new Set();
  [...overlay].sort((left, right) => {
    const actionOrder =
      (clean(left.action) === 'permanent_move' ? 0 : 1) -
      (clean(right.action) === 'permanent_move' ? 0 : 1);
    if (actionOrder) return actionOrder;
    if (clean(left.action) === 'permanent_move') {
      return permanentLineage(left).localeCompare(permanentLineage(right)) ||
        permanentCutover(left).localeCompare(permanentCutover(right)) ||
        changeOrderValue(left) - changeOrderValue(right);
    }
    return changeOrderValue(left) - changeOrderValue(right);
  }).forEach((row) => {
    if (row.action === 'permanent_move' && row.event) {
      if (!effectivePermanentIds.has(clean(row.__id || row.id))) return;
      const lineage = permanentLineage(row);
      const cutoverDate = permanentCutover(row);
      const anchorDate = permanentAnchor(row);
      const intervalWeeks = safeFrequencyWeeks(row.frequencyWeeks || row.event.frequencyWeeks || row.intervalWeeks);
      const nextPermanent = permanent
        .filter((other) =>
          other.__id !== row.__id &&
          permanentLineage(other) === lineage &&
          permanentCutover(other) > cutoverDate
        )
        .sort((left, right) =>
          permanentCutover(left).localeCompare(permanentCutover(right))
        )[0];
      const sourceSeries = activeFixedByLineage.get(lineage) || {};
      const sourceEnd = dateKey(sourceSeries.recurrenceEndDate || sourceSeries.endDate);
      const storedEnd = dateKey(row.recurrenceEndDate || row.endDate || row.event.recurrenceEndDate || row.event.endDate);
      const rowEnd = sourceEnd && storedEnd
        ? [sourceEnd, storedEnd].sort()[0]
        : (sourceEnd || storedEnd || endDate);
      const finalDate = nextPermanent
        ? [rowEnd, addDays(permanentCutover(nextPermanent), -1)].sort()[0]
        : rowEnd;
      for (let key = anchorDate; key && key <= endDate && key <= finalDate; key = addDays(key, intervalWeeks * 7)) {
        if (key < startDate) continue;
        const storedPending = (row.pendingDates || []).includes(key);
        const stepDays = intervalWeeks * 7;
        const matchingException = overlay.find((change) => {
          if (!['single_move', 'lesson_status', 'cancel'].includes(clean(change.action))) return false;
          const changeLineage = clean(change.sourceCourseId || change.event && (change.event.fixedCourseId || change.event.seriesId));
          const exceptionDate = dateKey(change.sourceDate);
          if (changeLineage !== lineage || !exceptionDate || exceptionDate < cutoverDate) return false;
          const deltaDays = Math.round(
            (new Date(`${exceptionDate}T12:00:00+08:00`).getTime() -
              new Date(`${cutoverDate}T12:00:00+08:00`).getTime()) / 86400000
          );
          return deltaDays >= 0 && deltaDays % stepDays === 0 && addDays(anchorDate, deltaDays) === key;
        });
        if (matchingException && ['single_move', 'cancel'].includes(clean(matchingException.action))) {
          // 單次調課稍後仍會加入它自己的 target event；這裡只抑制對應的新固定 occurrence。
          if (clean(matchingException.action) === 'cancel') handledPermanentExceptions.add(matchingException.__id);
          continue;
        }
        const occurrenceId = `${row.__id}@${key}`;
        const occurrence = Object.assign({}, row.event, {
          id: occurrenceId,
          fixedCourseId: lineage,
          seriesId: lineage,
          frequencyWeeks: intervalWeeks,
          date: key,
          portalChangeId: row.__id
        });
        const inheritedStatus = normalizeScheduleStatus(
          (permanentStatusById.get(clean(row.__id || row.id)) || {})[key]
        );
        if (inheritedStatus === 'cancelled') continue;
        if (inheritedStatus !== 'scheduled') occurrence.status = inheritedStatus;
        let matchedLessonStatus = false;
        if (matchingException && clean(matchingException.action) === 'lesson_status') {
          occurrence.status = normalizeScheduleStatus(matchingException.event && matchingException.event.status);
          occurrence.paymentStatus = clean(matchingException.event && matchingException.event.paymentStatus);
          occurrence.teacherPayable = matchingException.event && matchingException.event.teacherPayable === true;
          handledPermanentExceptions.add(matchingException.__id);
          matchedLessonStatus = true;
        }
        if (!matchedLessonStatus && removedOccurrence(occurrence, key)) continue;
        const roomId = clean((row.roomOverrides || {})[key] || row.event.roomId);
        const candidate = Object.assign(occurrence, {
          roomId,
          portalAction: row.action,
          __id: occurrenceId
        });
        const candidateResources = eventSharedResourceIds(candidate, maps);
        const dynamicConflict = !storedPending && eventBlocksResource(candidate) && base.find((other) =>
          eventDate(other) === key &&
          eventBlocksResource(other) &&
          overlaps(eventStart(candidate), eventEnd(candidate), eventStart(other), eventEnd(other)) &&
          (
            eventRoomId(other) === roomId ||
            eventTeacherId(other) === eventTeacherId(candidate) ||
            eventStudentIds(other).some((studentId) => eventStudentIds(candidate).includes(studentId)) ||
            sharedResourceConflict(
              [Object.assign({}, resourceEvent(other, maps, recurringLineages), {
                resourceIds: eventSharedResourceIds(other, maps)
              })],
              candidateResources
            )
          )
        );
        if (storedPending || dynamicConflict) {
          base.push(Object.assign({}, candidate, {
            roomId: '',
            requestedRoomId: roomId,
            status: 'pending_conflict',
            pendingReason: storedPending ? '建立永久調課時已有衝突' : '目前課表已有衝突，請重新安排'
          }));
        } else {
          base.push(candidate);
        }
      }
    } else if (
      !handledPermanentExceptions.has(row.__id) &&
      row.event &&
      eventDate(row.event) >= startDate &&
      eventDate(row.event) <= endDate
    ) {
      const target = Object.assign({
        __id: row.__id,
        portalAction: clean(row.action),
        portalChangeId: row.__id
      }, row.event);
      // 後續再次調課時，以前一次 overlay event id 精準移除舊位置。
      if (!removed.has(`${sourceId(target)}|${eventDate(target)}`) || row.action === 'lesson_status') {
        base.push(target);
      }
    }
  });
  const validBase = base.map((row) => applyStudentSuspensions(row, suspensions)).filter((row) =>
    row &&
    eventDate(row) >= startDate &&
    eventDate(row) <= endDate &&
    validPortalTime(eventStart(row)) &&
    validPortalTime(eventEnd(row)) &&
    timeMinutes(eventEnd(row)) > timeMinutes(eventStart(row))
  );
  const resourceEvents = validBase.map((row) => resourceEvent(row, maps, recurringLineages));
  return {
    rooms,
    subjects,
    students,
    teachers,
    fixedCourses: activeFixedRows,
    temporaryCourses: temporary.filter((row) => !livePortalSource(row)),
    scheduleChanges: overlay,
    suspensions,
    maps,
    resourceEvents,
    resourceConflicts: scheduleResourceConflicts(resourceEvents),
    events: validBase.map((row) => publicEvent(row, maps, ownTeacherId, recurringLineages))
  };
}

async function teacherPortalData(data) {
  const session = await requireSession(data, ['teacher']);
  const start = dateKey(data.weekStart);
  if (!start) throw new HttpsError('invalid-argument', '週起始日期格式錯誤。');
  const end = addDays(start, 6);
  const month = clean(data.month).match(/^\d{4}-\d{2}$/) ? clean(data.month) : start.slice(0, 7);
  if (data.includePayroll === true && month < TEACHER_PAYROLL_MIN_MONTH) {
    throw new HttpsError('failed-precondition', '老師薪資查詢僅開放民國 115 年 7 月起的資料。');
  }
  const [bundle, roomSettingsSnapshot] = await Promise.all([
    scheduleBundle(start, end, session.teacherId),
    db.collection('coursePortalRoomSettings').get()
  ]);
  const roomSettingsMap = {};
  roomSettingsSnapshot.docs.forEach((doc) => { roomSettingsMap[doc.id] = doc.data() || {}; });
  const teacher = bundle.maps.teachers[session.teacherId];
  if (!teacher) throw new HttpsError('not-found', '找不到這個老師帳號的資料。');
  const ownEvents = bundle.events.filter((row) => row.teacherId === session.teacherId);
  const stoppedStudentIds = new Set((bundle.suspensions || [])
    .filter((row) => clean(row.teacherId) === session.teacherId)
    .map((row) => clean(row.studentId))
    .filter(Boolean));
  const studentIds = [...new Set(
    [...bundle.fixedCourses, ...bundle.temporaryCourses]
      .filter((row) => eventTeacherId(row) === session.teacherId)
      .flatMap(eventStudentIds)
      .concat(ownEvents.flatMap((row) => row.studentIds))
  )].filter((studentId) => !stoppedStudentIds.has(studentId));
  const roster = studentIds.map((id) => {
    const student = bundle.maps.students[id] || {};
    const phone = normalizePhone(sourcePhone(student));
    return {
      id,
      name: clean(student.name),
      phone,
      phoneLast4: phone.slice(-4),
      teacherName: clean(teacher.name)
    };
  }).filter((row) => row.name);
  const includePayroll = data.includePayroll === true;
  const [payroll, adjustments, portalAdjustmentsSnap] = includePayroll
    ? await Promise.all([
      mirrorRowsByField('teacherPayroll', 'teacherId', session.teacherId),
      mirrorRowsByField('teacherAdjustments', 'teacherId', session.teacherId),
      db.collection('coursePortalTeacherAdjustments').where('teacherId','==',session.teacherId).get()
    ])
    : [[], [], { docs: [] }];
  const portalAdjustments=portalAdjustmentsSnap.docs.map(doc=>Object.assign({__id:doc.id},jsonValue(doc.data())||{}));
  const result = {
    ok: true,
    teacher: {
      id: session.teacherId,
      name: clean(teacher.name),
      phoneLast4: normalizePhone(sourcePhone(teacher)).slice(-4),
      subjectIds: firstArray(teacher, ['subjectIds', 'subjects'])
    },
    week: { start, end },
    hours: { start: 10, end: 21, closedWeekday: 1 },
    rooms: bundle.rooms.filter(sourceActive).map((room) => ({
      id: sourceId(room),
      name: rentalRoomProfile(room, roomSettingsMap[sourceId(room)] || {}).publicName,
      equipmentLabel: roomEquipmentLabel(room, roomSettingsMap[sourceId(room)] || {}),
      rentalFee: Number(room.rentalFee || room.price || 0),
      allowedSubjectIds: firstArray(roomSettingsMap[sourceId(room)] || {}, ['allowedSubjectIds'])
        .concat(firstArray(room, ['allowedSubjectIds', 'subjectIds']))
    })),
    subjects: bundle.subjects.map((subject) => ({ id: sourceId(subject), name: clean(subject.name) })),
    events: bundle.events,
    roster
  };
  if (includePayroll) {
    result.payroll = payroll.filter((row) => clean(row.month || row.payrollMonth || eventDate(row).slice(0, 7)) === month);
    result.adjustments = adjustments.concat(portalAdjustments).filter((row) => clean(row.month || row.payrollMonth || eventDate(row).slice(0, 7)) === month);
  }
  return result;
}

async function teacherOwnsStudent(teacherId, studentId) {
  const [fixedCourses, temporaryCourses] = await Promise.all([
    mirrorRows('fixedCourses'),
    mirrorRows('temporaryCourses')
  ]);
  return [...fixedCourses, ...temporaryCourses].some((row) =>
    eventTeacherId(row) === clean(teacherId) &&
    eventStudentIds(row).includes(clean(studentId))
  );
}

function tuitionOutstandingAmount(row) {
  const expected = Number(
    row.expectedAmount ||
    row.tuitionAmount ||
    row.courseAmount ||
    row.feeAmount ||
    row.amount ||
    0
  );
  const paid = Number(
    row.paidAmount ||
    row.receivedAmount ||
    row.paid ||
    row.received ||
    0
  );
  return Math.max(0, expected - paid);
}

async function teacherUpdateStudent(data) {
  const session = await requireSession(data, ['teacher']);
  const studentId = clean(data.studentId);
  const name = clean(data.name);
  const phone = normalizePhone(data.phone);
  assertInput(studentId, '學生');
  assertInput(name, '學生姓名');
  assertInput(phone, '學生電話');
  if (!/^\d{8,15}$/.test(phone)) {
    throw new HttpsError('invalid-argument', '學生電話格式不正確。');
  }
  if (!(await teacherOwnsStudent(session.teacherId, studentId))) {
    throw new HttpsError('permission-denied', '只能修改目前由您授課的學生資料。');
  }
  const students = await mirrorRows('students');
  if (!students.some((row) => sourceId(row) === studentId)) {
    throw new HttpsError('not-found', '找不到這位學生。');
  }
  const bindingSnapshot = await db.collection('coursePortalStudentBindings')
    .where('studentId', '==', studentId)
    .get();
  const batch = db.batch();
  batch.set(db.collection('coursePortalStudentProfiles').doc(studentId), {
    studentId,
    name,
    phone,
    active: true,
    updatedByTeacherId: session.teacherId,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtText: nowText()
  }, { merge: true });
  bindingSnapshot.docs.forEach((doc) => {
    batch.set(doc.ref, {
      name,
      phoneHash: hash(phone),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  await batch.commit();
  return {
    ok: true,
    studentId,
    name,
    phone,
    message: '學生姓名與電話已同步更新。'
  };
}

async function teacherStopStudent(data) {
  const session = await requireSession(data, ['teacher']);
  const studentId = clean(data.studentId);
  assertInput(studentId, '學生');
  if (data.confirmed !== true) {
    throw new HttpsError('failed-precondition', '請先完成停課確認。');
  }
  if (!(await teacherOwnsStudent(session.teacherId, studentId))) {
    throw new HttpsError('permission-denied', '只能辦理由您授課的學生停課。');
  }
  const [students, teachers, periods] = await Promise.all([
    mirrorRows('students'),
    mirrorRows('teachers'),
    mirrorRowsByField('tuitionPeriods', 'studentId', studentId)
  ]);
  const student = students.find((row) => sourceId(row) === studentId) || {};
  const teacher = teachers.find((row) => sourceId(row) === session.teacherId) || {};
  if (!sourceId(student)) throw new HttpsError('not-found', '找不到這位學生。');
  const relatedPeriods = periods.filter((row) =>
    !eventTeacherId(row) || eventTeacherId(row) === session.teacherId
  );
  const unpaidAmount = relatedPeriods.reduce((sum, row) => sum + tuitionOutstandingAmount(row), 0);
  const suspensionId = hash(`teacher-stop|${session.teacherId}|${studentId}`);
  const suspensionRef = db.collection('coursePortalStudentSuspensions').doc(suspensionId);
  const existing = await suspensionRef.get();
  if (existing.exists && clean(existing.data().status) === 'active') {
    return {
      ok: true,
      suspensionId,
      unpaidAmount: Number(existing.data().unpaidAmountAtStop || unpaidAmount),
      message: '這位學生已完成停課登記。'
    };
  }
  const batch = db.batch();
  batch.set(suspensionRef, {
    suspensionId,
    status: 'active',
    studentId,
    studentName: clean(student.name),
    teacherId: session.teacherId,
    teacherName: clean(teacher.name),
    effectiveDate: currentTaipeiDay(),
    unpaidAmountAtStop: unpaidAmount,
    requestedBy: 'teacher',
    requestedAt: FieldValue.serverTimestamp(),
    requestedAtText: nowText(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  batch.set(scheduleVersionRef(), {
    version: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'teacher-student-stop'
  }, { merge: true });
  await batch.commit();
  return {
    ok: true,
    suspensionId,
    unpaidAmount,
    message: unpaidAmount > 0
      ? '停課已完成，未繳學費已送到管理者專用區。'
      : '停課已完成，目前沒有未繳學費。'
  };
}

async function teacherAvailability(data) {
  const session = await requireSession(data, ['teacher']);
  const requestedStartDate = dateKey(data.startDate || data.date);
  if (!requestedStartDate) throw new HttpsError('invalid-argument', '開始日期格式錯誤。');
  const startDate = requestedStartDate < currentTaipeiDay() ? currentTaipeiDay() : requestedStartDate;
  const exactTarget = data.exactTarget === true;
  const exactDate = exactTarget ? dateKey(data.date || data.startDate) : '';
  const exactStartTime = exactTarget ? clean(data.startTime).slice(0, 5) : '';
  if (exactTarget && (!exactDate || !validPortalTime(exactStartTime, true) || publicRentalSlotIsPast(exactDate, exactStartTime))) {
    throw new HttpsError('invalid-argument', '請選擇尚未開始的 30 分鐘時段。');
  }
  const days = exactTarget ? 1 : Math.min(28, Math.max(7, Number(data.days || 14)));
  const endDate = exactTarget ? exactDate : addDays(startDate, days - 1);
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
  let source = bundle.resourceEvents.find((event) =>
    event.teacherId === session.teacherId &&
    event.date === sourceDate &&
    (
      event.id === sourceEventId ||
      event.sourceId === sourceEventId ||
      event.fixedCourseId === sourceCourseId ||
      event.seriesId === sourceCourseId
    )
  );
  if (!source && sourceDate && (sourceDate < startDate || sourceDate > endDate)) {
    const sourceBundle = await scheduleBundle(sourceDate, sourceDate, session.teacherId);
    source = sourceBundle.resourceEvents.find((event) =>
      event.teacherId === session.teacherId &&
      (
        event.id === sourceEventId ||
        event.sourceId === sourceEventId ||
        event.fixedCourseId === sourceCourseId ||
        event.seriesId === sourceCourseId
      )
    );
  }
  if ((sourceEventId || sourceCourseId) && !source) {
    throw new HttpsError('not-found', '找不到可調動的原課程，請重新整理課表。');
  }
  if (source && isRoomRentalEvent(source)) {
    throw new HttpsError('failed-precondition', '教室租用不是課程，不能從老師調課功能移動。');
  }
  if (source && normalizeScheduleStatus(source.status) !== 'scheduled') {
    throw new HttpsError('failed-precondition', '請假、曠課或已取消的課程不能再調動。');
  }
  if (source && publicRentalSlotIsPast(source.date, source.startTime)) {
    throw new HttpsError('failed-precondition', '已開始或已結束的課程不能再調課。');
  }
  const sourceStartTime = source ? source.startTime : clean(data.sourceStartTime || data.startTime).slice(0, 5);
  const sourceEndTime = source ? source.endTime : clean(data.sourceEndTime || data.endTime).slice(0, 5);
  const duration = source
    ? assertPortalInterval(sourceStartTime, sourceEndTime)
    : Math.min(300, Math.max(30, Number(data.durationMinutes || 60)));
  if (!Number.isFinite(duration) || duration % 30 !== 0) {
    throw new HttpsError('invalid-argument', '課程長度必須以 30 分鐘為單位。');
  }
  const subjectId = source ? source.subjectId : clean(data.subjectId);
  const targetStudentIds = source
    ? source.studentIds
    : [...new Set(firstArray(data, ['studentIds']).concat(clean(data.studentId) ? [clean(data.studentId)] : []))];
  if (!subjectId) throw new HttpsError('invalid-argument', '請先選擇課程科目。');
  if (!bundle.maps.subjects[subjectId] || !sourceActive(bundle.maps.subjects[subjectId])) {
    throw new HttpsError('failed-precondition', '這個授課科目已停用或不存在。');
  }
  if (!targetStudentIds.length) throw new HttpsError('invalid-argument', '請先選擇學生。');
  const compatibleRooms = bundle.rooms.filter(sourceActive).filter((room) =>
    roomKind(room, roomSettingsMap[sourceId(room)] || {}) === 'normal' &&
    roomTeacherSchedulable(room, roomSettingsMap[sourceId(room)] || {}) &&
    roomSupportsSubject(room, subjectId, bundle, roomSettingsMap[sourceId(room)] || {})
  );
  const slots = [];
  const dates = exactTarget
    ? [exactDate]
    : Array.from({ length: days }, (_, offset) => addDays(startDate, offset));
  for (const date of dates) {
    const window = businessWindow(policy, date);
    if (window.closed) continue;
    const candidateMinutes = exactTarget
      ? [timeMinutes(exactStartTime)]
      : Array.from(
        { length: Math.max(0, Math.floor((window.endMinutes - duration - window.startMinutes) / 30) + 1) },
        (_, index) => window.startMinutes + index * 30
      );
    for (const minute of candidateMinutes) {
      if (minute < window.startMinutes || minute + duration > window.endMinutes) continue;
      const slotStart = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const slotEndMinute = minute + duration;
      const slotEnd = `${String(Math.floor(slotEndMinute / 60)).padStart(2, '0')}:${String(slotEndMinute % 60).padStart(2, '0')}`;
      if (publicRentalSlotIsPast(date, slotStart)) continue;
      const blockers = bundle.resourceEvents.filter((event) => {
        const sourceMatch = event.date === sourceDate && (
          event.id === sourceEventId || event.sourceId === sourceEventId ||
          event.fixedCourseId === sourceCourseId || event.seriesId === sourceCourseId
        );
        return event.date === date &&
          eventBlocksResource(event) &&
          !sourceMatch &&
          overlaps(slotStart, slotEnd, event.startTime, event.endTime);
      });
      if (sharedResourceConflict(blockers, requestedSubjectResourceIds(subjectId, bundle))) continue;
      if (
        blockers.some((event) =>
          event.teacherId === session.teacherId ||
          event.studentIds.some((studentId) => targetStudentIds.includes(studentId))
        )
      ) continue;
      const rooms = compatibleRooms.filter((room) =>
        roomAllowsInterval(
          room,
          roomSettingsMap[sourceId(room)] || {},
          date,
          slotStart,
          slotEnd,
          subjectId,
          'schedule'
        ) &&
        !blockers.some((event) => event.roomId === sourceId(room))
      ).map((room) => ({
        id: sourceId(room),
        name: rentalRoomProfile(room, roomSettingsMap[sourceId(room)] || {}).publicName,
        equipmentLabel: roomEquipmentLabel(room, roomSettingsMap[sourceId(room)] || {}),
        requiresGuzhengMove: roomRequiresGuzhengMove(room, subjectId, bundle)
      }));
      if (rooms.length) slots.push({ date, startTime: slotStart, endTime: slotEnd, rooms });
    }
  }
  return {
    ok: true,
    startDate,
    endDate,
    durationMinutes: duration,
    source: source ? publicEvent(source, bundle.maps, session.teacherId) : null,
    slots
  };
}

async function teacherSlotOptions(data) {
  const session = await requireSession(data, ['teacher']);
  const targetDate = dateKey(data.date || data.targetDate);
  const targetStartTime = clean(data.startTime || data.targetStartTime).slice(0, 5);
  if (!targetDate || !validPortalTime(targetStartTime, true)) {
    throw new HttpsError('invalid-argument', '請選擇有效的日期與 30 分鐘時段。');
  }
  if (publicRentalSlotIsPast(targetDate, targetStartTime)) {
    throw new HttpsError('failed-precondition', '不能把課程調到已經過去的時間。');
  }
  const today = currentTaipeiDay();
  const candidateEnd = addDays(today, 28);
  const [candidateBundle, policy, roomSettingsSnapshot] = await Promise.all([
    scheduleBundle(today, candidateEnd, session.teacherId),
    rentalPolicySettings(),
    db.collection('coursePortalRoomSettings').get()
  ]);
  const targetBundle = targetDate >= today && targetDate <= candidateEnd
    ? candidateBundle
    : await scheduleBundle(targetDate, targetDate, session.teacherId);
  const roomSettingsMap = {};
  roomSettingsSnapshot.docs.forEach((doc) => { roomSettingsMap[doc.id] = doc.data() || {}; });
  const window = businessWindow(policy, targetDate);
  if (window.closed) throw new HttpsError('failed-precondition', '這一天公休，不能調入課程。');
  const seen = new Set();
  const candidates = candidateBundle.resourceEvents.filter((event) => {
    const key = `${event.id}|${event.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return event.teacherId === session.teacherId &&
      normalizeScheduleStatus(event.status) === 'scheduled' &&
      !isRoomRentalEvent(event) &&
      event.studentIds.length > 0 &&
      Boolean(event.subjectId) &&
      !publicRentalSlotIsPast(event.date, event.startTime);
  }).map((source) => {
    const duration = timeMinutes(source.endTime) - timeMinutes(source.startTime);
    if (duration < 30 || duration > 300 || duration % 30 !== 0) return null;
    const targetEndMinute = timeMinutes(targetStartTime) + duration;
    const targetEndTime = String(Math.floor(targetEndMinute / 60)).padStart(2, '0') + ':' +
      String(targetEndMinute % 60).padStart(2, '0');
    if (timeMinutes(targetStartTime) < window.startMinutes || targetEndMinute > window.endMinutes) return null;
    if (source.date === targetDate && source.startTime === targetStartTime) return null;
    const sourceMatch = (event) => event.date === source.date && (
      event.id === source.id ||
      event.sourceId === source.sourceId ||
      (source.fixedCourseId && event.fixedCourseId === source.fixedCourseId)
    );
    const blockers = targetBundle.resourceEvents.filter((event) =>
      event.date === targetDate &&
      eventBlocksResource(event) &&
      !sourceMatch(event) &&
      overlaps(targetStartTime, targetEndTime, event.startTime, event.endTime)
    );
    if (sharedResourceConflict(blockers, requestedSubjectResourceIds(source.subjectId, targetBundle))) return null;
    if (
      blockers.some((event) =>
        event.teacherId === session.teacherId ||
        event.studentIds.some((studentId) => source.studentIds.includes(studentId))
      )
    ) return null;
    const rooms = targetBundle.rooms.filter(sourceActive).filter((room) => {
      const id = sourceId(room);
      const setting = roomSettingsMap[id] || {};
      return roomKind(room, setting) === 'normal' &&
        roomTeacherSchedulable(room, setting) &&
        roomSupportsSubject(room, source.subjectId, targetBundle, setting) &&
        roomAllowsInterval(room, setting, targetDate, targetStartTime, targetEndTime, source.subjectId, 'schedule') &&
        !blockers.some((event) => event.roomId === id);
    }).map((room) => ({
      id: sourceId(room),
      name: rentalRoomProfile(room, roomSettingsMap[sourceId(room)] || {}).publicName,
      equipmentLabel: roomEquipmentLabel(room, roomSettingsMap[sourceId(room)] || {}),
      requiresGuzhengMove: roomRequiresGuzhengMove(room, source.subjectId, targetBundle)
    }));
    if (!rooms.length) return null;
    const publicSource = publicEvent(source, candidateBundle.maps, session.teacherId);
    return Object.assign(publicSource, {
      durationMinutes: duration,
      targetEndTime,
      rooms
    });
  }).filter(Boolean).slice(0, 120);
  const rooms = new Map();
  candidates.forEach((candidate) => candidate.rooms.forEach((room) => rooms.set(room.id, room)));
  return {
    ok: true,
    targetDate,
    targetStartTime,
    rooms: [...rooms.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant')),
    candidateLessons: candidates
  };
}

async function studentPortalData(data) {
  const session = await requireSession(data, ['student']);
  const sessionBindings = await activeStudentBindingsForSession(session);
  const currentIds = [...new Set(sessionBindings.map((row) => clean(row.studentId)).filter(Boolean))];
  const requested = clean(data.studentId);
  if (requested && !currentIds.includes(requested)) throw new HttpsError('permission-denied', '沒有這位學生的查看權限。');
  const studentIds = requested ? [requested] : currentIds;
  const today = currentTaipeiDay();
  const [students, periodsByStudent, attendanceByStudent, events, teachers, subjects] = await Promise.all([
    mirrorRows('students'),
    Promise.all(studentIds.map((id) => mirrorRowsByField('tuitionPeriods', 'studentId', id))),
    Promise.all(studentIds.map((id) => mirrorRowsByField('attendance', 'studentId', id))),
    mirrorRowsByDateRange('events', today, addDays(today, 120)),
    mirrorRows('teachers'),
    mirrorRows('subjects')
  ]);
  const uniqueRows = (groups) => [...new Map(
    groups.flat().map((row) => [sourceId(row), row])
  ).values()];
  const periods = uniqueRows(periodsByStudent);
  const attendance = uniqueRows(attendanceByStudent);
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
      eventDate(row) >= today &&
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
  const requestedDuration = Number(data.durationMinutes == null ? 60 : data.durationMinutes);
  if (!Number.isFinite(requestedDuration) || requestedDuration < 30 || requestedDuration % 30 !== 0) {
    throw new HttpsError('invalid-argument', '租用時間必須以 30 分鐘為單位。');
  }
  const duration = Math.min(policy.maxDurationMinutes, requestedDuration);
  const startMinutes = timeMinutes(startTime);
  const endMinutes = startMinutes + duration;
  const endTime = String(Math.floor(endMinutes / 60)).padStart(2, '0') + ':' + String(endMinutes % 60).padStart(2, '0');
  if (!date || !validPortalTime(startTime, true)) throw new HttpsError('invalid-argument', '請選擇 30 分鐘整點的日期與時間。');
  if (publicRentalSlotIsPast(date, startTime)) {
    throw new HttpsError('failed-precondition', '一般租用只能預約尚未開始的時段。');
  }
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
  const recordingSelection = recordingRentalSelection({
    useType: selectedUse.id,
    recordingUsage: data.recordingUsage
  });
  const settingsMap = {};
  roomSettings.docs.forEach((doc) => { settingsMap[doc.id] = doc.data() || {}; });
  const discountRequested = data.studentDiscountRequested === true ||
    clean(data.studentDiscountRequested).toLowerCase() === 'true';
  const studentRate = discountRequested &&
    session.role === 'student' &&
    (await activeStudentIdsForSession(session)).length > 0;
  const overlappingEvents = bundle.resourceEvents.filter((event) =>
    eventBlocksResource(event) && event.date === date &&
    overlaps(startTime, endTime, event.startTime, event.endTime)
  );
  const sharedEquipmentBusy = sharedResourceConflict(overlappingEvents, requestedRentalResourceIds(data));
  const rooms = bundle.rooms.filter(sourceActive).map((room) => {
    const id = sourceId(room);
    const setting = settingsMap[id] || {};
    const blocked = overlappingEvents.some((event) => event.roomId === id);
    const profile = rentalRoomProfile(room, setting);
    const rentable = roomRentable(room, setting);
    const categoryAllowed = rentalUseAllowsRoom(useOptions, data.useType, id, room, setting);
    const preferenceAllowed = rentalPreferenceAllowsRoom(room, setting, data);
    const policyAllowed = roomAllowsInterval(room, setting, date, startTime, endTime, '', 'rental');
    const baseFee = effectiveRentalFee(room, setting, selectedUse, recordingSelection);
    const available = !blocked && !sharedEquipmentBusy && rentable && categoryAllowed && preferenceAllowed && policyAllowed;
    const equipmentLabel = roomEquipmentLabel(room, setting);
    return {
      id,
      name: profile.publicName,
      kind: roomKind(room, setting),
      available,
      reason: sharedEquipmentBusy
        ? '古箏在這個時段已被使用'
        : (blocked
        ? '時段已被使用'
        : (!rentable
          ? '不開放租用'
          : (!categoryAllowed
            ? '不屬於這個用途'
            : (!preferenceAllowed
              ? '已依設備條件排除'
              : (!policyAllowed ? '這個時段不開放租用' : ''))))),
      matchLevel: 'best',
      capacity: profile.capacity,
      equipment: profile.equipment,
      equipmentLabel,
      unitFee: baseFee,
      price: baseFee == null
        ? null
        : rentalAmount(baseFee, duration, studentRate ? policy.studentDiscountRate : 1),
      priceRangeText: selectedUse.id === 'recording' ? 'NT$100–300／小時' : '',
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
    recordingUsageOptions: selectedUse.id === 'recording'
      ? RECORDING_RENTAL_OPTIONS.map((row) => Object.assign({}, row))
      : [],
    studentDiscountRate: policy.studentDiscountRate,
    rooms: rooms.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  };
}

async function rentalDayBoard(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const date = dateKey(data.date);
  if (!date) throw new HttpsError('invalid-argument', '請選擇日期。');
  const policy = await rentalPolicySettings();
  const requestedDuration = Number(data.durationMinutes == null ? 60 : data.durationMinutes);
  if (!Number.isFinite(requestedDuration) || requestedDuration < 30 || requestedDuration % 30 !== 0) {
    throw new HttpsError('invalid-argument', '租用時間必須以 30 分鐘為單位。');
  }
  const duration = Math.min(policy.maxDurationMinutes, requestedDuration);
  const window = businessWindow(policy, date);
  const bundle = await scheduleBundle(date, date, session.role === 'teacher' ? session.teacherId : '');
  const roomSettings = await db.collection('coursePortalRoomSettings').get();
  const useOptions = await rentalUseOptions(bundle.rooms);
  const selectedUseType = useOptions.some((row) => row.id === clean(data.useType))
    ? clean(data.useType)
    : clean(useOptions[0] && useOptions[0].id);
  const effectiveData = Object.assign({}, data, { useType: selectedUseType });
  const settingsMap = {};
  roomSettings.docs.forEach((doc) => { settingsMap[doc.id] = doc.data() || {}; });
  const slots = [];
  const dayPast = date < currentTaipeiDay();
  if (!window.closed) {
    for (let minute = window.startMinutes; minute + duration <= window.endMinutes; minute += 30) {
      const startTime = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
      const endMinute = minute + duration;
      const endTime = String(Math.floor(endMinute / 60)).padStart(2, '0') + ':' + String(endMinute % 60).padStart(2, '0');
      const past = publicRentalSlotIsPast(date, startTime);
      if (past) continue;
      const overlappingEvents = bundle.resourceEvents.filter((event) =>
        eventBlocksResource(event) && event.date === date &&
        overlaps(startTime, endTime, event.startTime, event.endTime)
      );
      const sharedEquipmentBusy = sharedResourceConflict(
        overlappingEvents,
        requestedRentalResourceIds(effectiveData)
      );
      const availableRooms = bundle.rooms.filter(sourceActive).filter((room) => {
        const id = sourceId(room);
        const setting = settingsMap[id] || {};
        if (
          !roomRentable(room, setting) ||
          !rentalUseAllowsRoom(useOptions, selectedUseType, id, room, setting) ||
          !rentalPreferenceAllowsRoom(room, setting, effectiveData) ||
          !roomAllowsInterval(room, setting, date, startTime, endTime, '', 'rental')
        ) return false;
        return !sharedEquipmentBusy && !overlappingEvents.some((event) => event.roomId === id);
      }).map((room) => ({ id: sourceId(room), name: rentalRoomProfile(room, settingsMap[sourceId(room)] || {}).publicName }));
      slots.push({ startTime, endTime, past, availableCount: availableRooms.length, rooms: availableRooms.slice(0, 8) });
    }
  }
  return { ok: true, date, closed: window.closed, past: dayPast, role: session.role, selectedUseType, useOptions, slots };
}

async function rentalWeekBoard(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const displayNamePromise = rentalSessionDisplayName(session);
  const requestedStartDate = dateKey(data.startDate || data.date);
  if (!requestedStartDate) throw new HttpsError('invalid-argument', '請選擇週起始日期。');
  const startDate = requestedStartDate < currentTaipeiDay() ? currentTaipeiDay() : requestedStartDate;
  const endDate = addDays(startDate, 6);
  const policy = await rentalPolicySettings();
  const requestedDuration = Number(data.durationMinutes == null ? 60 : data.durationMinutes);
  if (!Number.isFinite(requestedDuration) || requestedDuration < 30 || requestedDuration % 30 !== 0) {
    throw new HttpsError('invalid-argument', '租用時間必須以 30 分鐘為單位。');
  }
  const duration = Math.min(policy.maxDurationMinutes, requestedDuration);
  const bundle = await scheduleBundle(startDate, endDate, session.role === 'teacher' ? session.teacherId : '');
  const roomSettings = await db.collection('coursePortalRoomSettings').get();
  const useOptions = await rentalUseOptions(bundle.rooms);
  const selectedUseType = useOptions.some((row) => row.id === clean(data.useType))
    ? clean(data.useType)
    : clean(useOptions[0] && useOptions[0].id);
  const effectiveData = Object.assign({}, data, { useType: selectedUseType });
  const settingsMap = {};
  roomSettings.docs.forEach((doc) => { settingsMap[doc.id] = doc.data() || {}; });
  const days = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(startDate, offset);
    const window = businessWindow(policy, date);
    const dayPast = date < currentTaipeiDay();
    const slots = [];
    if (!window.closed) {
      for (let minute = window.startMinutes; minute + duration <= window.endMinutes; minute += 30) {
        const startTime = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
        const endMinute = minute + duration;
        const endTime = String(Math.floor(endMinute / 60)).padStart(2, '0') + ':' + String(endMinute % 60).padStart(2, '0');
        const past = publicRentalSlotIsPast(date, startTime);
        if (past) continue;
        const overlappingEvents = bundle.resourceEvents.filter((event) =>
          eventBlocksResource(event) && event.date === date &&
          overlaps(startTime, endTime, event.startTime, event.endTime)
        );
        const sharedEquipmentBusy = sharedResourceConflict(
          overlappingEvents,
          requestedRentalResourceIds(effectiveData)
        );
        const rooms = bundle.rooms.filter(sourceActive).filter((room) => {
          const id = sourceId(room);
          const setting = settingsMap[id] || {};
          if (
            !roomRentable(room, setting) ||
            !rentalUseAllowsRoom(useOptions, selectedUseType, id, room, setting) ||
            !rentalPreferenceAllowsRoom(room, setting, effectiveData) ||
            !roomAllowsInterval(room, setting, date, startTime, endTime, '', 'rental')
          ) return false;
          return !sharedEquipmentBusy && !overlappingEvents.some((event) => event.roomId === id);
        }).map((room) => ({ id: sourceId(room), name: rentalRoomProfile(room, settingsMap[sourceId(room)] || {}).publicName }));
        slots.push({ startTime, endTime, past, availableCount: rooms.length, rooms: rooms.slice(0, 8) });
      }
    }
    days.push({
      date,
      closed: window.closed,
      past: dayPast,
      availableSlotCount: slots.filter((slot) => !slot.past && slot.availableCount > 0).length,
      slots
    });
  }
  return {
    ok: true,
    startDate,
    endDate,
    role: session.role,
    displayName: await displayNamePromise,
    durationMinutes: duration,
    selectedUseType,
    useOptions,
    businessHours: policy.businessHours,
    days
  };
}

async function createRoomBooking(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const recordingSelection = recordingRentalSelection(data, true);
  const expectedVersion = await readScheduleVersion();
  const availability = await rentalAvailability(data);
  if (publicRentalSlotIsPast(availability.date, availability.startTime)) {
    throw new HttpsError('failed-precondition', '只能預約尚未開始的時段。');
  }
  const room = availability.rooms.find((item) => item.id === clean(data.roomId));
  if (!room || !room.available) throw new HttpsError('failed-precondition', room && room.reason || '這間教室目前不能預約。');
  const id = db.collection('coursePortalRoomBookings').doc().id;
  // 學生身分只用來判斷折扣；租用本身不等於任何一位綁定學生正在上課。
  // 否則家長綁了多位子女時，一筆租用會錯誤阻擋所有子女的課程。
  const studentIds = [];
  const ownerKey = sessionOwnerKey(session);
  if (!ownerKey) throw new HttpsError('unauthenticated', '登入資料不完整，請重新登入。');
  const locks = bookingLockRows(availability.date, room.id, availability.startTime, availability.endTime)
    .concat(sharedEquipmentLockRows(
      availability.date,
      requestedRentalResourceIds(data),
      availability.startTime,
      availability.endTime
    ));
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
    recordingUsage: clean(recordingSelection && recordingSelection.id),
    recordingUsageName: clean(recordingSelection && recordingSelection.name),
    pianoType: clean(data.pianoType).toLowerCase() ||
      (flagTrue(data.excludeDigitalPiano) ? 'exclude_digital' : 'any'),
    excludeDigitalPiano: flagTrue(data.excludeDigitalPiano),
    allowGuzhengMove: flagTrue(data.allowGuzhengMove),
    drumType: clean(data.drumType),
    role: session.role,
    teacherId: clean(session.teacherId),
    renterId: clean(session.renterId),
    studentIds,
    studentDiscountRequested: room.priceType === '柚子學生半價',
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
  const versionRef = scheduleVersionRef();
  await db.runTransaction(async (tx) => {
    if (publicRentalSlotIsPast(availability.date, availability.startTime)) {
      throw new HttpsError('failed-precondition', '這個時段已經開始，請重新選擇。');
    }
    const lockRefs = locks.map((row) => db.collection('coursePortalRoomLocks').doc(row.id));
    const [versionSnapshot, ...lockSnapshots] = await Promise.all([
      tx.get(versionRef),
      ...lockRefs.map((ref) => tx.get(ref))
    ]);
    assertScheduleWritable(versionSnapshot);
    const currentVersion = Number(versionSnapshot.exists && versionSnapshot.data().version || 0);
    if (currentVersion !== expectedVersion) {
      throw new HttpsError('aborted', '課表剛剛有更新，請重新確認可租教室。');
    }
    const activeLocks = lockSnapshots.filter((snapshot) => snapshot.exists && snapshot.data().active !== false);
    const lockBookings = [];
    for (const lockSnapshot of activeLocks) {
      const lock = lockSnapshot.data() || {};
      lockBookings.push({
        lockSnapshot,
        bookingSnapshot: clean(lock.bookingId)
          ? await tx.get(db.collection('coursePortalRoomBookings').doc(clean(lock.bookingId)))
          : null
      });
    }
    const staleLocks = [];
    lockBookings.forEach(({ lockSnapshot, bookingSnapshot }) => {
      const lock = lockSnapshot.data() || {};
      const prior = bookingSnapshot && bookingSnapshot.exists ? bookingSnapshot.data() || {} : null;
      const expired = asMillis(lock.endAt) && asMillis(lock.endAt) <= Date.now();
      const inactive = !prior || prior.active === false || clean(prior.status) === 'cancelled';
      if (expired || inactive) staleLocks.push(lockSnapshot.ref);
      else {
        throw new HttpsError('already-exists', '這個時段剛剛已被其他人預約，請重新選擇。');
      }
    });
    staleLocks.forEach((ref) => tx.delete(ref));
    tx.set(bookingRef, booking);
    tx.set(changeRef, { action: 'room_booking', active: true, event: booking, createdAt: FieldValue.serverTimestamp() });
    lockRefs.forEach((ref, index) => tx.set(ref, {
      active: true,
      bookingId: id,
      date: availability.date,
      roomId: locks[index].roomId,
      resourceId: locks[index].resourceId,
      slot: locks[index].slot,
      endAt: Timestamp.fromMillis(taipeiDateTimeMillis(availability.date, availability.endTime)),
      createdAt: FieldValue.serverTimestamp()
    }));
    tx.set(versionRef, {
      version: currentVersion + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: sessionOwnerKey(session)
    }, { merge: true });
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
        booking.recordingUsageName ? `錄音室使用方式：${booking.recordingUsageName}` : '',
        `時間：${booking.startTime}～${booking.endTime}`,
        `如不使用，可在結束前進入租用頁取消：${PORTAL_BASE}/room-booking.html`
      ].filter(Boolean).join('\n'),
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
      recordingUsage: clean(row.recordingUsage),
      recordingUsageName: clean(row.recordingUsageName),
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
  const versionRef = scheduleVersionRef();
  await db.runTransaction(async (tx) => {
    const [snapshot, versionSnapshot] = await Promise.all([tx.get(bookingRef), tx.get(versionRef)]);
    assertScheduleWritable(versionSnapshot);
    if (!snapshot.exists) throw new HttpsError('not-found', '找不到這筆租用紀錄。');
    const booking = snapshot.data() || {};
    const sameOwner =
      (clean(booking.ownerKey) && clean(booking.ownerKey) === sessionOwnerKey(session)) ||
      (clean(booking.lineUserId) && clean(booking.lineUserId) === clean(session.lineUserId)) ||
      (clean(booking.authAccountId) && clean(booking.authAccountId) === clean(session.authAccountId));
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
    const currentVersion = Number(versionSnapshot.exists && versionSnapshot.data().version || 0);
    tx.set(versionRef, {
      version: currentVersion + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: sessionOwnerKey(session)
    }, { merge: true });
  });
  await db.collection('notificationQueue').doc(`course-portal-booking-${bookingId}-reminder`).set({
    status: '已取消',
    active: false,
    cancelledAt: FieldValue.serverTimestamp(),
    cancelledAtText: nowText()
  }, { merge: true }).catch((error) => {
    // 租用取消已在交易中完成；提醒佇列屬次要資料，失敗不能讓使用者誤以為沒取消。
    console.error('[course portal rental reminder cancellation failed]', bookingId, error);
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
    const versionRef = scheduleVersionRef();
    const expectedVersion = await readScheduleVersion();
    const [previewSnapshot, activeChangesSnapshot] = await Promise.all([
      ref.get(),
      db.collection('coursePortalScheduleChanges').where('active', '==', true).get()
    ]);
    const preview = previewSnapshot.exists ? previewSnapshot.data() || {} : null;
    if (!preview || clean(preview.createdByTeacherId) !== clean(session.teacherId)) {
      throw new HttpsError('permission-denied', '只能取消自己新增的課程。');
    }
    if (!['extra_lesson', 'teacher_gift'].includes(clean(preview.action))) {
      throw new HttpsError(
        'failed-precondition',
        '為避免原教室已被租用或排入其他課程，調課、請假與固定變更不能直接復原；請重新安排，或由管理者確認後處理。'
      );
    }
    const dependencyIds = new Set([
      clean(preview.event && preview.event.id),
      clean(preview.sourceCourseId),
      clean(preview.id),
      portalChangeId
    ].filter(Boolean));
    const dependent = activeChangesSnapshot.docs.find((doc) => {
      if (doc.id === portalChangeId) return false;
      const row = doc.data() || {};
      return dependencyIds.has(clean(row.sourceEventId)) ||
        dependencyIds.has(clean(row.sourceCourseId));
    });
    if (dependent) {
      throw new HttpsError('failed-precondition', '這堂新增課後面還有調課或固定變更，請先由管理者處理後續安排。');
    }
    await db.runTransaction(async (tx) => {
      const [snapshot, versionSnapshot] = await Promise.all([tx.get(ref), tx.get(versionRef)]);
      assertScheduleWritable(versionSnapshot);
      const row = snapshot.exists ? snapshot.data() || {} : null;
      if (!row || row.active === false || clean(row.createdByTeacherId) !== clean(session.teacherId)) {
        throw new HttpsError('permission-denied', '只能取消自己新增或調整的課程。');
      }
      if (!['extra_lesson', 'teacher_gift'].includes(clean(row.action))) {
        throw new HttpsError(
          'failed-precondition',
          '為避免原教室已被租用或排入其他課程，調課、請假與固定變更不能直接復原；請重新安排，或由管理者確認後處理。'
        );
      }
      if (row.event && publicRentalSlotIsPast(row.event.date, row.event.startTime)) {
        throw new HttpsError('failed-precondition', '已經開始或結束的課程不能再取消安排。');
      }
      const currentVersion = Number(versionSnapshot.exists && versionSnapshot.data().version || 0);
      if (currentVersion !== expectedVersion) {
        throw new HttpsError('aborted', '課表剛剛有更新，請重新整理後再取消。');
      }
      tx.set(ref, {
        active: false,
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledAtText: nowText(),
        cancelledByTeacherId: session.teacherId
      }, { merge: true });
      tx.set(versionRef, {
        version: currentVersion + 1,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: session.teacherId
      }, { merge: true });
    });
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
  const expectedVersion = await readScheduleVersion();
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
  if (isRoomRentalEvent(source)) {
    throw new HttpsError('failed-precondition', '教室租用不是學生課程，不能標示請假或曠課。');
  }
  if (source.studentIds.length > 1) {
    throw new HttpsError('failed-precondition', '團體課需逐位記錄學生狀態，不能用整堂請假／曠課，以免誤釋出仍在上課的教室。');
  }
  if (state === 'absent' && normalizeScheduleStatus(source.status) === 'leave') {
    throw new HttpsError(
      'failed-precondition',
      '請假後教室可能已重新排入其他使用，不能直接改回曠課；請由管理者確認空間後處理。'
    );
  }
  if (['attended', 'cancelled'].includes(normalizeScheduleStatus(source.status))) {
    throw new HttpsError('failed-precondition', '已簽到或已取消的課程不能再改成請假或曠課。');
  }

  const lineage = clean(source.fixedCourseId || sourceCourseId || source.sourceId || sourceEventId);
  const id = `lesson-status-${hash([
    session.teacherId,
    lineage,
    sourceDate
  ].join('|'))}`;
  const changeRef = db.collection('coursePortalScheduleChanges').doc(id);
  const activeChanges = await scheduleChangeDocsByDateRange(sourceDate, sourceDate);
  const priorStatusRefs = activeChanges.filter((doc) => {
    const row = doc.data() || {};
    return doc.id !== id &&
      clean(row.action) === 'lesson_status' &&
      clean(row.createdByTeacherId) === clean(session.teacherId) &&
      dateKey(row.sourceDate) === sourceDate &&
      (
        clean(row.sourceCourseId) === lineage ||
        clean(row.sourceEventId) === clean(source.sourceId || sourceEventId)
      );
  }).map((doc) => doc.ref);
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
  const changePayload = {
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
  };
  const versionRef = scheduleVersionRef();
  await db.runTransaction(async (tx) => {
    const [versionSnapshot, changeSnapshot, ...priorSnapshots] = await Promise.all([
      tx.get(versionRef),
      tx.get(changeRef),
      ...priorStatusRefs.map((ref) => tx.get(ref))
    ]);
    assertScheduleWritable(versionSnapshot);
    const currentVersion = Number(versionSnapshot.exists && versionSnapshot.data().version || 0);
    if (currentVersion !== expectedVersion) {
      throw new HttpsError('aborted', '課表剛剛有更新，已停止這次操作；請重新整理後再確認。');
    }
    priorSnapshots.forEach((snapshot) => {
      if (snapshot.exists && snapshot.data().active !== false) {
        tx.set(snapshot.ref, {
          active: false,
          supersededBy: id,
          supersededAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }
    });
    tx.set(changeRef, Object.assign({}, changePayload, {
      createdAt: changeSnapshot.exists
        ? (changeSnapshot.data().createdAt || FieldValue.serverTimestamp())
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }));
    tx.set(versionRef, {
      version: currentVersion + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: session.teacherId
    }, { merge: true });
  });
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
  if (!date || !roomId) {
    throw new HttpsError('invalid-argument', '請完整選擇日期、時間與教室。');
  }
  assertPortalInterval(startTime, endTime);
  if (publicRentalSlotIsPast(date, startTime)) {
    throw new HttpsError('failed-precondition', '不能新增或調課到已經過去的時間。');
  }
  const expectedVersion = await readScheduleVersion();
  const operationId = clean(data.operationId) || randomToken(18);
  const id = `teacher-${hash(`${session.teacherId}|${operationId}`)}`;
  const changeRef = db.collection('coursePortalScheduleChanges').doc(id);
  const existing = await changeRef.get();
  if (existing.exists && clean(existing.data().createdByTeacherId) === clean(session.teacherId)) {
    const prior = existing.data() || {};
    return {
      ok: true,
      duplicate: true,
      id,
      event: jsonValue(prior.event),
      pendingDates: jsonValue(prior.pendingDates || []),
      message: '這次操作已經完成，不會重複建立。'
    };
  }

  const [policy, bundle, roomSettingsSnapshot] = await Promise.all([
    rentalPolicySettings(),
    scheduleBundle(date, date, session.teacherId),
    db.collection('coursePortalRoomSettings').get()
  ]);
  const window = businessWindow(policy, date);
  if (window.closed) throw new HttpsError('failed-precondition', '這一天公休，不能安排課程。');
  if (timeMinutes(startTime) < window.startMinutes || timeMinutes(endTime) > window.endMinutes) {
    throw new HttpsError('failed-precondition', '所選時間不在營業時間內。');
  }
  const roomSettingsMap = {};
  roomSettingsSnapshot.docs.forEach((doc) => { roomSettingsMap[doc.id] = doc.data() || {}; });
  const sourceEventId = clean(data.sourceEventId);
  const requestedSourceCourseId = clean(data.sourceCourseId);
  const sourceDate = dateKey(data.sourceDate);
  const moving = action === 'single_move' || action === 'permanent_move';
  let source = null;
  let sourceBundle = null;
  let sourceSeries = null;
  if (moving) {
    if (!sourceDate || (!sourceEventId && !requestedSourceCourseId)) {
      throw new HttpsError('invalid-argument', '缺少要調動的原課程。');
    }
    sourceBundle = sourceDate === date ? bundle : await scheduleBundle(sourceDate, sourceDate, session.teacherId);
    source = sourceBundle.resourceEvents.find((event) =>
      event.teacherId === session.teacherId &&
      event.date === sourceDate &&
      (
        event.id === sourceEventId ||
        event.sourceId === sourceEventId ||
        event.fixedCourseId === requestedSourceCourseId ||
        event.seriesId === requestedSourceCourseId
      )
    );
    if (!source) throw new HttpsError('not-found', '找不到這堂原課程，請重新整理後再試。');
    if (isRoomRentalEvent(source)) {
      throw new HttpsError('failed-precondition', '教室租用不能用課程調課功能移動，請到租用入口取消後重新預約。');
    }
    if (normalizeScheduleStatus(source.status) !== 'scheduled') {
      throw new HttpsError('failed-precondition', '請假、曠課或已取消的課程不能再調動。');
    }
    if (publicRentalSlotIsPast(source.date, source.startTime)) {
      throw new HttpsError('failed-precondition', '已經開始或結束的課程不能再調動。');
    }
    sourceSeries = sourceBundle.fixedCourses.find((row) =>
      sourceId(row) === clean(source.fixedCourseId || source.seriesId || requestedSourceCourseId)
    ) || (sourceBundle.scheduleChanges.find((row) =>
      clean(row.__id) === clean(source.portalChangeId) ||
      clean(row.sourceCourseId) === clean(source.fixedCourseId || source.seriesId)
    ) || {}).event || null;
    if (action === 'permanent_move' && (!source.recurring || !sourceSeries || !sourceActive(sourceSeries))) {
      throw new HttpsError('failed-precondition', '這堂不是仍有效的固定課，不能套用「之後固定調課」；請改用只調這一次。');
    }
    if (action === 'permanent_move' && clean(source.portalAction) === 'single_move') {
      throw new HttpsError('failed-precondition', '這堂已是單次調課結果；請從尚未調整的固定課堂次開始設定之後固定調課。');
    }
  }

  const studentIds = moving
    ? source.studentIds
    : [...new Set(firstArray(data, ['studentIds']).concat(clean(data.studentId) ? [clean(data.studentId)] : []))];
  const subjectId = moving ? source.subjectId : clean(data.subjectId);
  if (!studentIds.length || !subjectId) {
    throw new HttpsError('invalid-argument', '請完整選擇學生與課程科目。');
  }
  if (!bundle.maps.subjects[subjectId] || !sourceActive(bundle.maps.subjects[subjectId])) {
    throw new HttpsError('failed-precondition', '這個授課科目已停用或不存在。');
  }
  if (!moving) {
    const temporaryForTeacher = await mirrorRowsByField('temporaryCourses', 'teacherId', session.teacherId);
    const ownStudentIds = new Set(
      [...bundle.fixedCourses, ...temporaryForTeacher]
        .filter((row) => eventTeacherId(row) === session.teacherId && sourceActive(row))
        .flatMap(eventStudentIds)
        .map(clean)
        .filter(Boolean)
    );
    if (!studentIds.every((studentId) => ownStudentIds.has(studentId))) {
      throw new HttpsError('permission-denied', '老師只能操作目前仍在自己名單中的學生。');
    }
  }
  const teacher = bundle.maps.teachers[session.teacherId] || {};
  const teacherSubjects = firstArray(teacher, ['subjectIds', 'subjects']);
  if (teacherSubjects.length && !teacherSubjects.includes(subjectId)) {
    throw new HttpsError('permission-denied', '這個科目不在老師可授課的項目中。');
  }

  const selectedRoom = bundle.rooms.find((room) => sourceId(room) === roomId);
  const selectedRoomSetting = roomSettingsMap[roomId] || {};
  if (
    !selectedRoom ||
    !sourceActive(selectedRoom) ||
    roomKind(selectedRoom, selectedRoomSetting) !== 'normal' ||
    !roomTeacherSchedulable(selectedRoom, selectedRoomSetting)
  ) {
    throw new HttpsError('failed-precondition', '這個教室不開放老師排課。');
  }
  if (!roomSupportsSubject(selectedRoom, subjectId, bundle, selectedRoomSetting)) {
    throw new HttpsError('failed-precondition', '這個教室不適合所選樂器，請改選其他教室。');
  }
  if (roomRequiresGuzhengMove(selectedRoom, subjectId, bundle) && !flagTrue(data.allowGuzhengMove)) {
    throw new HttpsError('failed-precondition', 'KAWAI 教室沒有固定放置古箏；請確認願意自行從展演空間搬運後再儲存。');
  }
  if (!roomAllowsInterval(selectedRoom, selectedRoomSetting, date, startTime, endTime, subjectId, 'schedule')) {
    throw new HttpsError('failed-precondition', '這個教室在所選時段不開放這項課程。');
  }

  const lineage = moving
    ? clean(source.fixedCourseId || source.seriesId || requestedSourceCourseId || source.id)
    : '';
  const ignoredSource = (event) => Boolean(source) && event.date === source.date && (
    event.id === source.id ||
    event.sourceId === source.sourceId ||
    (lineage && (event.fixedCourseId === lineage || event.seriesId === lineage))
  );
  const requestedResourceIds = requestedSubjectResourceIds(subjectId, bundle);
  const conflict = bundle.resourceEvents.find((event) =>
    event.date === date &&
    eventBlocksResource(event) &&
    !ignoredSource(event) &&
    overlaps(startTime, endTime, event.startTime, event.endTime) &&
    (
      event.roomId === roomId ||
      event.teacherId === session.teacherId ||
      event.studentIds.some((studentId) => studentIds.includes(studentId)) ||
      sharedResourceConflict([event], requestedResourceIds)
    )
  );
  if (conflict) {
    const studentConflict = conflict.studentIds.find((studentId) => studentIds.includes(studentId));
    const studentName = studentConflict && clean(bundle.maps.students[studentConflict] && bundle.maps.students[studentConflict].name);
    throw new HttpsError(
      'already-exists',
      sharedResourceConflict([conflict], requestedResourceIds)
        ? '古箏在這個時段已被其他課程或租用使用。'
        : (conflict.roomId === roomId
        ? `「${clean(selectedRoom.name) || '所選教室'}」在這個時段已被使用。`
        : (conflict.teacherId === session.teacherId
          ? '老師在這個時段已有課程。'
          : `${studentName || '所選學生'}在這個時段已有課程。`))
    );
  }

  const event = {
    id: randomToken(12),
    date,
    startTime,
    endTime,
    roomId,
    teacherId: session.teacherId,
    studentId: studentIds[0],
    studentIds,
    subjectId,
    fixedCourseId: moving ? lineage : '',
    seriesId: action === 'permanent_move' ? lineage : '',
    recurring: action === 'permanent_move',
    type: action === 'permanent_move' ? 'fixed' : 'single',
    portalAction: action,
    specialLesson: action === 'teacher_gift',
    status: 'scheduled',
    paymentStatus: action === 'teacher_gift' ? 'teacher_gift_no_charge' : clean(data.paymentStatus || 'not_applicable'),
    teacherPayable: action !== 'teacher_gift',
    note: clean(data.note)
  };
  const roomOverrides = {};
  const requestedRoomOverrides = data.roomOverrides && typeof data.roomOverrides === 'object'
    ? data.roomOverrides
    : {};
  const pendingDates = [];
  const permanentConflicts = [];
  let supersededPermanentRefs = [];
  let validatedThrough = '';
  let frequencyWeeks = safeFrequencyWeeks(sourceSeries && (sourceSeries.frequencyWeeks || sourceSeries.intervalWeeks));
  let recurrenceEndDate = dateKey(sourceSeries && (sourceSeries.recurrenceEndDate || sourceSeries.endDate));
  if (action === 'permanent_move') {
    const activeChangeSnapshot = await db.collection('coursePortalScheduleChanges').where('active', '==', true).get();
    supersededPermanentRefs = activeChangeSnapshot.docs.filter((doc) => {
      const row = doc.data() || {};
      return clean(row.action) === 'permanent_move' &&
        permanentLineage(row) === lineage &&
        permanentCutover(row) === sourceDate;
    }).map((doc) => doc.ref);
    const futureException = activeChangeSnapshot.docs.find((doc) => {
      const row = doc.data() || {};
      const rowLineage = permanentLineage(row);
      const rowCutover = permanentCutover(row);
      if (
        clean(row.action) === 'permanent_move' &&
        rowLineage === lineage &&
        rowCutover === sourceDate
      ) return false;
      if (doc.id === clean(source.portalChangeId) && rowCutover < sourceDate) return false;
      return rowLineage === lineage &&
        rowCutover >= sourceDate &&
        ['single_move', 'lesson_status', 'cancel', 'permanent_move'].includes(clean(row.action));
    });
    if (futureException) {
      throw new HttpsError(
        'failed-precondition',
        '這門固定課在之後已有單次調課、請假／曠課或其他固定變更；為避免同一週重複上課，請先由管理者整理未來例外。'
      );
    }
    const latestAnchorDate = addDays(sourceDate, frequencyWeeks * 7 - 1);
    if (date < sourceDate || date > latestAnchorDate) {
      throw new HttpsError(
        'failed-precondition',
        `新的固定時段必須落在原堂 ${sourceDate} 到 ${latestAnchorDate} 之間，避免中間課程重複或漏排。`
      );
    }
    if (recurrenceEndDate && date > recurrenceEndDate) {
      throw new HttpsError('failed-precondition', '新的固定時段已超過這門固定課的結束日期。');
    }
    const maximumFullValidationEnd = addDays(date, 3650);
    const horizonEnd = recurrenceEndDate && recurrenceEndDate <= maximumFullValidationEnd
      ? recurrenceEndDate
      : addDays(date, 364);
    validatedThrough = horizonEnd;
    const future = await scheduleBundle(date, horizonEnd, session.teacherId);
    for (let occurrence = date; occurrence <= horizonEnd; occurrence = addDays(occurrence, frequencyWeeks * 7)) {
      const blockers = future.resourceEvents.filter((row) => {
        const sourceMatch = lineage &&
          (row.fixedCourseId === lineage || row.seriesId === lineage) &&
          !['single_move', 'extra_lesson', 'teacher_gift', 'lesson_status'].includes(clean(row.portalAction));
        return eventBlocksResource(row) &&
          !sourceMatch &&
          row.date === occurrence &&
          overlaps(startTime, endTime, row.startTime, row.endTime);
      });
      const teacherOrStudentBusy = blockers.some((row) =>
        row.teacherId === session.teacherId ||
        row.studentIds.some((studentId) => studentIds.includes(studentId))
      );
      const sharedEquipmentBusy = sharedResourceConflict(blockers, requestedResourceIds);
      const roomBusy = blockers.some((row) => row.roomId === roomId);
      const policyBlocked = !roomAllowsInterval(
        selectedRoom,
        selectedRoomSetting,
        occurrence,
        startTime,
        endTime,
        subjectId,
        'schedule'
      );
      if (!teacherOrStudentBusy && !sharedEquipmentBusy && !roomBusy && !policyBlocked) continue;
      const alternatives = teacherOrStudentBusy || sharedEquipmentBusy
        ? []
        : future.rooms.filter(sourceActive).filter((room) => {
          const alternativeId = sourceId(room);
          const setting = roomSettingsMap[alternativeId] || {};
          return roomKind(room, setting) === 'normal' &&
            roomTeacherSchedulable(room, setting) &&
            roomSupportsSubject(room, subjectId, future, setting) &&
            roomAllowsInterval(room, setting, occurrence, startTime, endTime, subjectId, 'schedule') &&
            !blockers.some((row) => row.roomId === alternativeId);
        }).map((room) => ({
          id: sourceId(room),
          name: rentalRoomProfile(room, roomSettingsMap[sourceId(room)] || {}).publicName,
          equipmentLabel: roomEquipmentLabel(room, roomSettingsMap[sourceId(room)] || {}),
          requiresGuzhengMove: roomRequiresGuzhengMove(room, subjectId, future)
        }));
      const requestedOverrideId = clean(requestedRoomOverrides[occurrence]);
      if (requestedOverrideId) {
        const requestedAlternative = alternatives.find((room) => room.id === requestedOverrideId);
        if (!requestedAlternative) {
          throw new HttpsError('failed-precondition', `${occurrence} 選擇的替代教室已不可用，請重新確認。`);
        }
        if (requestedAlternative.requiresGuzhengMove && !flagTrue(data.allowGuzhengMove)) {
          throw new HttpsError('failed-precondition', `${occurrence} 選擇 KAWAI 教室時，需先確認願意自行搬運古箏。`);
        }
        roomOverrides[occurrence] = requestedOverrideId;
        continue;
      }
      permanentConflicts.push({
        date: occurrence,
        reason: teacherOrStudentBusy
          ? '老師或學生已有課程'
          : (sharedEquipmentBusy
            ? '古箏已被使用'
            : (policyBlocked ? '教室時段不開放' : '教室已被使用')),
        alternativeRooms: alternatives
      });
    }
    if (permanentConflicts.length && data.confirmPermanentConflicts !== true) {
      return {
        ok: false,
        requiresConfirmation: true,
        operationId,
        conflicts: permanentConflicts,
        message: `後續有 ${permanentConflicts.length} 個日期發生衝突；確認後這些日期會保留為待補排，不會自動換教室。`
      };
    }
    permanentConflicts.forEach((row) => pendingDates.push(row.date));
    event.frequencyWeeks = frequencyWeeks;
    event.recurrenceEndDate = recurrenceEndDate;
  }
  const changePayload = {
    id,
    operationId,
    action,
    active: true,
    sourceEventId: source ? source.id : '',
    sourceDate,
    sourceCourseId: lineage,
    effectiveDate: action === 'permanent_move' ? sourceDate : '',
    cutoverDate: action === 'permanent_move' ? sourceDate : '',
    anchorDate: action === 'permanent_move' ? date : '',
    frequencyWeeks,
    recurrenceEndDate,
    validatedThrough,
    event,
    roomOverrides,
    pendingDates,
    permanentConflicts,
    createdByTeacherId: session.teacherId,
    createdAt: FieldValue.serverTimestamp(),
    createdAtText: nowText()
  };

  const lockRows = bookingLockRows(date, roomId, startTime, endTime)
    .concat(sharedEquipmentLockRows(date, requestedResourceIds, startTime, endTime));
  const versionRef = scheduleVersionRef();
  const transactionResult = await db.runTransaction(async (tx) => {
    if (publicRentalSlotIsPast(date, startTime)) {
      throw new HttpsError('failed-precondition', '這個時段已經開始，請重新選擇。');
    }
    const snapshots = await Promise.all([
      tx.get(versionRef),
      tx.get(changeRef),
      ...lockRows.map((row) => tx.get(db.collection('coursePortalRoomLocks').doc(row.id))),
      ...supersededPermanentRefs.map((ref) => tx.get(ref))
    ]);
    const [versionSnapshot, changeSnapshot] = snapshots;
    const lockSnapshots = snapshots.slice(2, 2 + lockRows.length);
    const supersededPermanentSnapshots = snapshots.slice(2 + lockRows.length);
    assertScheduleWritable(versionSnapshot);
    if (changeSnapshot.exists) {
      return { duplicate: true, change: jsonValue(changeSnapshot.data()) || {} };
    }
    const currentVersion = Number(versionSnapshot.exists && versionSnapshot.data().version || 0);
    if (currentVersion !== expectedVersion) {
      throw new HttpsError('aborted', '課表剛剛有更新，已停止這次操作；請重新確認空位。');
    }
    const activeLocks = lockSnapshots.filter((snapshot) => snapshot.exists && snapshot.data().active !== false);
    const bookingSnapshots = [];
    for (const lockSnapshot of activeLocks) {
      const lock = lockSnapshot.data() || {};
      if (clean(lock.bookingId)) {
        bookingSnapshots.push({
          lockSnapshot,
          snapshot: await tx.get(db.collection('coursePortalRoomBookings').doc(clean(lock.bookingId)))
        });
      } else {
        bookingSnapshots.push({ lockSnapshot, snapshot: null });
      }
    }
    const staleLocks = [];
    bookingSnapshots.forEach(({ lockSnapshot, snapshot }) => {
      const lock = lockSnapshot.data() || {};
      const booking = snapshot && snapshot.exists ? snapshot.data() || {} : null;
      const expired = asMillis(lock.endAt) && asMillis(lock.endAt) <= Date.now();
      const inactive = !booking || booking.active === false || clean(booking.status) === 'cancelled';
      if (expired || inactive) staleLocks.push(lockSnapshot.ref);
      else throw new HttpsError('already-exists', '這個教室時段剛剛已被租用，請重新選擇。');
    });
    staleLocks.forEach((ref) => tx.delete(ref));
    supersededPermanentSnapshots.forEach((snapshot) => {
      if (!snapshot.exists || snapshot.data().active === false) return;
      tx.set(snapshot.ref, {
        active: false,
        supersededBy: id,
        supersededAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
    tx.set(changeRef, changePayload);
    tx.set(versionRef, {
      version: currentVersion + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: session.teacherId
    }, { merge: true });
    return { duplicate: false };
  });
  if (transactionResult && transactionResult.duplicate) {
    const prior = transactionResult.change || {};
    return {
      ok: true,
      duplicate: true,
      id,
      event: prior.event || {},
      roomOverrides: prior.roomOverrides || {},
      pendingDates: prior.pendingDates || [],
      operationId,
      message: '這次操作已經完成，不會重複建立。'
    };
  }
  return {
    ok: true,
    id,
    event,
    roomOverrides,
    pendingDates,
    operationId,
    message: pendingDates.length
      ? `永久調課已建立；${pendingDates.length} 個衝突日期已保留為待補排，沒有自動更換教室。`
      : (action === 'permanent_move' ? '永久調課已建立。' : '課程已儲存。')
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
  if(isRoomRentalEvent(event))throw new HttpsError('failed-precondition','教室租用不是學生課程，不能補簽到。');
  if(!['scheduled','absent'].includes(normalizeScheduleStatus(event.status)))throw new HttpsError('failed-precondition','請假、已簽到或已取消的課程不能補簽到。');
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

async function adminScheduleConflictAudit(data) {
  const startDate = dateKey(data && data.startDate) || currentTaipeiDay();
  const days = Math.min(120, Math.max(1, Number(data && data.days || 35)));
  const endDate = addDays(startDate, days - 1);
  const bundle = await scheduleBundle(startDate, endDate, '');
  return {
    ok: true,
    startDate,
    endDate,
    conflictCount: bundle.resourceConflicts.length,
    conflicts: bundle.resourceConflicts
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
      rentalUseTypes: items.filter((item) =>
        item.active !== false && item.roomIds.includes(id)
      ).map((item) => item.id),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtText: nowText()
    }, { merge: true });
  });
  batch.set(scheduleVersionRef(), {
    version: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'admin-rental-settings'
  }, { merge: true });
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
  const policies = {};
  const policyInput = data.policies && typeof data.policies === 'object' ? data.policies : {};
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach((day) => {
    const dayInput = policyInput[day] && typeof policyInput[day] === 'object' ? policyInput[day] : {};
    policies[day] = {};
    Object.keys(dayInput).forEach((time) => {
      if (!validPortalTime(time, true)) return;
      const slot = dayInput[time] || {};
      policies[day][time] = {
        blockSchedule: slot.blockSchedule === true,
        blockRental: slot.blockRental === true,
        subjectIds: Array.isArray(slot.subjectIds) ? slot.subjectIds.map(clean).filter(Boolean) : []
      };
    });
  });
  const active = data.active !== false;
  const setting = {
    roomRulesVersion: 1,
    active,
    pianoType,
    rentalEquipment: equipment,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtText: nowText()
  };
  if (data.publicName !== undefined) setting.publicName = clean(data.publicName);
  if (data.note !== undefined) setting.note = clean(data.note);
  if (data.rentalFee !== undefined) setting.rentalFee = Math.max(0, Number(data.rentalFee || 0));
  if (data.capacity !== undefined) setting.capacity = Math.max(1, Number(data.capacity || 1));
  if (data.allowedSubjectIds !== undefined) {
    setting.allowedSubjectIds = Array.isArray(data.allowedSubjectIds)
      ? data.allowedSubjectIds.map(clean).filter(Boolean)
      : [];
  }
  if (data.rentalUseTypes !== undefined || data.useTypes !== undefined) {
    const publicUseTypes = new Set(RENTAL_USE_OPTIONS.map((row) => row.id));
    setting.rentalUseTypes = [...new Set(
      firstArray(data, ['rentalUseTypes', 'useTypes'])
        .map((value) => ['guitar', 'teaching'].includes(clean(value)) ? 'other' : clean(value))
        .filter((value) => publicUseTypes.has(value))
    )];
  }
  if (data.policies !== undefined) setting.policies = policies;
  setting.rentable = active && data.rentable !== false;
  setting.teacherSchedulable = active && data.teacherSchedulable !== false;
  const batch = db.batch();
  batch.set(db.collection('coursePortalRoomSettings').doc(roomId), setting, { merge: true });
  batch.set(scheduleVersionRef(), {
    version: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'admin-room-equipment'
  }, { merge: true });
  await batch.commit();
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

async function adminRoomBookings() {
  const snapshot = await db.collection('coursePortalRoomBookings').get();
  const bookings = snapshot.docs.map((doc) => {
    const row = jsonValue(doc.data()) || {};
    return {
      id: doc.id,
      date: dateKey(row.date),
      startTime: eventStart(row),
      endTime: eventEnd(row),
      durationMinutes: Math.max(30, Number(row.durationMinutes || row.duration ||
        (timeMinutes(eventEnd(row)) - timeMinutes(eventStart(row))) || 60)),
      roomId: clean(row.roomId),
      roomName: clean(row.roomName),
      useType: clean(row.useType),
      useName: clean(row.useName),
      recordingUsage: clean(row.recordingUsage),
      recordingUsageName: clean(row.recordingUsageName),
      purpose: clean(row.purpose),
      amount: Number(row.amount || row.rentalFee || 0),
      status: clean(row.status || (row.active === false ? 'cancelled' : 'confirmed')),
      active: row.active !== false,
      source: 'course-portal'
    };
  }).filter((row) => row.date && row.startTime && row.roomId);
  return { ok: true, bookings, updatedAt: new Date().toISOString() };
}

async function adminData() {
  const [teachers, students, renters, teacherRows, studentRows, renterRows, sessions, suspensionSnapshot] = await Promise.all([
    db.collection('coursePortalTeacherBindings').get(),
    db.collection('coursePortalStudentBindings').get(),
    db.collection('coursePortalRenterBindings').get(),
    mirrorRows('teachers'),
    mirrorRows('students'),
    db.collection('coursePortalRenters').get(),
    db.collection('coursePortalSessions').get(),
    db.collection('coursePortalStudentSuspensions').where('status', '==', 'active').get()
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
  const suspensionRows = suspensionSnapshot.docs.map((doc) => Object.assign({
    id: doc.id
  }, jsonValue(doc.data()) || {}));
  const suspensionStudentIds = [...new Set(suspensionRows.map((row) => clean(row.studentId)).filter(Boolean))];
  const periodGroups = await Promise.all(suspensionStudentIds.map((studentId) =>
    mirrorRowsByField('tuitionPeriods', 'studentId', studentId)
  ));
  const periodsByStudent = new Map(suspensionStudentIds.map((studentId, index) => [
    studentId,
    periodGroups[index] || []
  ]));
  const unpaidSuspensions = suspensionRows.map((row) => {
    const studentId = clean(row.studentId);
    const teacherId = clean(row.teacherId);
    const periods = periodsByStudent.get(studentId) || [];
    const relatedPeriods = periods.filter((period) =>
      !eventTeacherId(period) || eventTeacherId(period) === teacherId
    );
    const currentUnpaidAmount = relatedPeriods.length
      ? relatedPeriods.reduce((sum, period) => sum + tuitionOutstandingAmount(period), 0)
      : Number(row.unpaidAmountAtStop || 0);
    return {
      id: clean(row.id),
      studentId,
      studentName: clean(studentMap[studentId] && studentMap[studentId].name) || clean(row.studentName),
      teacherId,
      teacherName: clean(teacherMap[teacherId] && teacherMap[teacherId].name) || clean(row.teacherName),
      effectiveDate: dateKey(row.effectiveDate),
      requestedAtText: clean(row.requestedAtText),
      unpaidAmountAtStop: Number(row.unpaidAmountAtStop || 0),
      currentUnpaidAmount,
      paymentStatus: clean(row.paymentStatus || 'pending')
    };
  }).filter((row) => row.paymentStatus !== 'settled' && row.currentUnpaidAmount > 0);
  return {
    ok: true,
    bindings: [...map(teachers), ...map(students), ...map(renters)],
    unpaidSuspensions
  };
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
  if (!['revoke', 'restore', 'delete'].includes(action)) {
    throw new HttpsError('invalid-argument', '不支援的帳號操作。');
  }
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

async function adminSuspensionAction(data) {
  const id = clean(data.id);
  const action = clean(data.action);
  if (!id || action !== 'settle') {
    throw new HttpsError('invalid-argument', '停課學費簽核資料不完整。');
  }
  const ref = db.collection('coursePortalStudentSuspensions').doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists || clean(snapshot.data().status) !== 'active') {
    throw new HttpsError('not-found', '找不到這筆停課資料。');
  }
  await ref.set({
    paymentStatus: 'settled',
    settledAt: FieldValue.serverTimestamp(),
    settledAtText: nowText(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true, id, message: '已確認學費繳清。' };
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
  const [changes, bookings, roomSettings, studentProfiles, suspensions] = await Promise.all([
    db.collection('coursePortalScheduleChanges').where('active', '==', true).get(),
    db.collection('coursePortalRoomBookings').where('active', '==', true).get(),
    db.collection('coursePortalRoomSettings').get(),
    db.collection('coursePortalStudentProfiles').get(),
    db.collection('coursePortalStudentSuspensions').where('status', '==', 'active').get()
  ]);
  const roomSettingsMap = new Map(roomSettings.docs.map((doc) => [doc.id, jsonValue(doc.data()) || {}]));
  const studentProfileMap = new Map(studentProfiles.docs.map((doc) => [doc.id, jsonValue(doc.data()) || {}]));
  if (Array.isArray(payload.students)) {
    payload.students = payload.students.map((student) => {
      const profile = studentProfileMap.get(sourceId(student));
      if (!profile || profile.active === false) return student;
      const merged = Object.assign({}, student);
      if (clean(profile.name)) merged.name = clean(profile.name);
      if (normalizePhone(profile.phone)) merged.phone = normalizePhone(profile.phone);
      return merged;
    });
  }
  if (Array.isArray(payload.rooms)) {
    payload.rooms = payload.rooms.map((room) => {
      const setting = roomSettingsMap.get(sourceId(room));
      if (!setting) return room;
      const merged = Object.assign({}, room);
      if (clean(setting.publicName)) {
        merged.name = clean(setting.publicName);
        merged.publicName = clean(setting.publicName);
      }
      [
        'note',
        'rentalFee',
        'capacity',
        'active',
        'rentable',
        'teacherSchedulable',
        'allowedSubjectIds',
        'rentalUseTypes',
        'rentalEquipment',
        'pianoType',
        'kind',
        'roomKind',
        'policies',
        'roomRulesVersion'
      ].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(setting, key)) merged[key] = setting[key];
      });
      return merged;
    });
  }
  const changeRows = changes.docs.map((doc) => Object.assign({ id: doc.id }, jsonValue(doc.data()) || {}));
  const removed = new Set(changeRows.filter((row) =>
    ['single_move', 'cancel', 'lesson_status'].includes(clean(row.action))
  )
    .flatMap((row) => [
      `${clean(row.sourceEventId)}|${dateKey(row.sourceDate)}`,
      `${clean(row.sourceCourseId)}|${dateKey(row.sourceDate)}`
    ]));
  if (Array.isArray(payload.events)) {
    payload.events = payload.events.filter((row) =>
      !removed.has(`${sourceId(row)}|${eventDate(row)}`) &&
      !removed.has(`${clean(row.fixedCourseId || row.sourceCourseId || row.courseId || row.scheduleId)}|${eventDate(row)}`)
    );
  }
  payload.fixedCourses = Array.isArray(payload.fixedCourses) ? payload.fixedCourses : [];
  changeRows.filter((row) =>
    ['single_move', 'cancel', 'lesson_status'].includes(clean(row.action))
  ).forEach((row) => {
    const course = payload.fixedCourses.find((item) =>
      sourceId(item) === clean(row.sourceCourseId || row.sourceEventId)
    );
    if (!course || !dateKey(row.sourceDate)) return;
    const status = row.action === 'lesson_status'
      ? normalizeScheduleStatus(row.event && row.event.status)
      : 'cancelled';
    course.statusByDate = Object.assign({}, course.statusByDate || {}, {
      [dateKey(row.sourceDate)]: { status, source: 'course-portal' }
    });
  });
  payload.temporaryCourses = Array.isArray(payload.temporaryCourses) ? payload.temporaryCourses : [];
  const permanentGroups = new Map();
  effectivePermanentChanges(changeRows).forEach((row) => {
    const lineage = permanentLineage(row);
    if (!lineage) return;
    if (!permanentGroups.has(lineage)) permanentGroups.set(lineage, []);
    permanentGroups.get(lineage).push(row);
  });
  permanentGroups.forEach((rows, lineage) => {
    const course = payload.fixedCourses.find((item) => sourceId(item) === lineage);
    // 底層固定課已停用或不存在時，不再把舊 portal 變更復活成無期限幽靈課程。
    if (!course || !sourceActive(course)) return;
    const originalEndDate = dateKey(course.recurrenceEndDate || course.endDate);
    const courseTemplate = Object.assign({}, course, {
      statusByDate: Object.assign({}, course.statusByDate || course.exceptions || {})
    });
    let activeStatusByDate = Object.assign({}, courseTemplate.statusByDate);
    const ordered = rows.map((row) => Object.assign({}, row, {
      __cutoverDate: dateKey(row.cutoverDate || row.sourceDate || row.effectiveDate),
      __anchorDate: dateKey(row.anchorDate || eventDate(row.event) || row.effectiveDate)
    })).filter((row) =>
      row.__cutoverDate &&
      row.__anchorDate &&
      (!originalEndDate || row.__cutoverDate <= originalEndDate)
    ).sort((left, right) => left.__cutoverDate.localeCompare(right.__cutoverDate));
    if (!ordered.length) return;
    course.recurrenceEndDate = addDays(ordered[0].__cutoverDate, -1);
    course.endDate = addDays(ordered[0].__cutoverDate, -1);
    ordered.forEach((row, index) => {
      const nextCutover = ordered[index + 1] && ordered[index + 1].__cutoverDate;
      const storedEnd = dateKey(row.recurrenceEndDate || row.event.recurrenceEndDate || originalEndDate);
      const endCandidates = [
        originalEndDate,
        storedEnd,
        nextCutover ? addDays(nextCutover, -1) : ''
      ].filter(Boolean).sort();
      const segmentEnd = endCandidates[0] || '';
      if (segmentEnd && row.__anchorDate > segmentEnd) return;
      const frequencyWeeks = safeFrequencyWeeks(row.frequencyWeeks || row.event.frequencyWeeks);
      activeStatusByDate = translateRecurringStatusMap(
        activeStatusByDate,
        row.__cutoverDate,
        row.__anchorDate,
        frequencyWeeks
      );
      const statusByDate = Object.assign({}, activeStatusByDate);
      (row.pendingDates || []).forEach((key) => {
        statusByDate[key] = { status: 'pending_conflict', source: 'course-portal-pending' };
      });
      Object.keys(row.roomOverrides || {}).forEach((key) => {
        statusByDate[key] = { status: 'cancelled', source: 'course-portal-room-override' };
      });
      payload.fixedCourses.push(Object.assign({}, courseTemplate, row.event, {
        id: row.id,
        startDate: row.__anchorDate,
        date: row.__anchorDate,
        start: eventStart(row.event),
        duration: Math.max(30, timeMinutes(eventEnd(row.event)) - timeMinutes(eventStart(row.event))),
        type: 'fixed',
        recurring: true,
        frequencyWeeks,
        recurrenceEndDate: segmentEnd,
        endDate: segmentEnd,
        statusByDate,
        source: 'course-portal',
        portalAction: 'permanent_move',
        cutoverDate: row.__cutoverDate,
        anchorDate: row.__anchorDate
      }));
      Object.keys(row.roomOverrides || {}).forEach((key) => {
        payload.temporaryCourses.push(Object.assign({}, row.event, {
          id: `${row.id}-room-${key}`,
          date: key,
          start: eventStart(row.event),
          duration: Math.max(30, timeMinutes(eventEnd(row.event)) - timeMinutes(eventStart(row.event))),
          roomId: row.roomOverrides[key],
          type: 'temporary',
          source: 'course-portal',
          portalAction: 'permanent_room_exception'
        }));
      });
    });
  });
  changeRows.filter((row) => row.event && !['room_booking', 'permanent_move'].includes(row.action)).forEach((row) => {
    payload.temporaryCourses.push(Object.assign({}, row.event, {
      id: row.id,
      start: eventStart(row.event),
      duration: Math.max(30, timeMinutes(eventEnd(row.event)) - timeMinutes(eventStart(row.event))),
      type: 'single',
      specialLesson: clean(row.action) === 'teacher_gift',
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
    roomSettings: roomSettings.size,
    studentProfiles: studentProfiles.size,
    studentSuspensions: suspensions.size,
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
  exportsObject.coursePortalStudentPhoneAccess = callable(studentPhoneAccess);
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
  exportsObject.coursePortalTeacherSlotOptions = callable(teacherSlotOptions, { timeoutSeconds: 180, memory: '1GiB' });
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
  exportsObject.coursePortalTeacherUpdateStudent = callable(teacherUpdateStudent, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherStopStudent = callable(teacherStopStudent, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherBonusRequest = callable(teacherBonusRequest, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalRentalUseSettings = callable(publicRentalSettings);
  exportsObject.coursePortalAdminRentalSettingsData = callable(async (data, request) => {
    assertAdminPin(request);
    return adminRentalSettingsData();
  }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalAdminScheduleConflictAudit = callable(async (data, request) => {
    assertAdminPin(request);
    return adminScheduleConflictAudit(data);
  }, { secrets: [ADMIN_PIN], timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalAdminSaveRentalSettings = callable(async (data,request)=>{assertAdminPin(request);return adminSaveRentalSettings(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminSaveRoomEquipment = callable(async (data,request)=>{assertAdminPin(request);return adminSaveRoomEquipment(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminRoomBookings = callable(async (data,request)=>{assertAdminPin(request);return adminRoomBookings();},{secrets:[ADMIN_PIN]});
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
  exportsObject.coursePortalAdminSuspensionAction = callable(async (data, request) => {
    assertAdminPin(request);
    return adminSuspensionAction(data);
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
