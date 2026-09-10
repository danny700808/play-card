const { recipientFields, notificationRecipientKey } = require('./portalNotificationPolicy');
const { applyLessonSettings } = require('./courseLessonSettings');
'use strict';

const { canonicalStudentId, projectCourseGroups } = require('./courseGroups');
const { MIN_DATE: COURSE_HISTORY_MIN_DATE, selectHistoryPeriods, rentalRateForRole } = require('./courseHistory');

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { withPortalReads, memoPortalRead } = require('./portalReadContext');
const path = require('path');
const sharp = require('sharp');
const { cents, validateTransaction } = require('./courseTuitionLedger');
const {
  isStudentHistoryDateVisible,
  normalizePhone,
  phoneMatches,
  normalizeScheduleStatus,
  courseSourceIds
} = require('./coursePortalUtils');
const { bindingIdentity, bindingIdentityPatch, decideLineLoginBinding, isRecoverableUnboundBinding } = require('./courseLoginPolicy');
const {
  FEE_PLAN_COLLECTION,
  SUBJECT_CATALOG_COLLECTION,
  TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION,
  catalogSubjectId,
  feePlanConfigured,
  feePlanId,
  managerAssignmentPatch,
  mergeFeePlanRows,
  mergeSubjectRows,
  mergeTeacherRows,
  normalizedSubjectName,
  prepareTeachingAbilitySubjects,
  profileAssignmentPatch
} = require('./courseSubjectCatalog');
const {
  profileChangeRows,
  profileDraftSnapshot
} = require('./teacherProfileChanges');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;
const REGION = 'us-central1';
const TAIPEI = 'Asia/Taipei';
const ADMIN_PIN = defineSecret('INJIAOYUN_MANUAL_SYNC_PIN');
const LINE_LOGIN_CHANNEL_SECRET = defineSecret('LINE_LOGIN_CHANNEL_SECRET');
const LINE_LOGIN_CHANNEL_ID = String(process.env.LINE_LOGIN_CHANNEL_ID || '2010902226').trim();
const LINE_LOGIN_CALLBACK_URL = String(process.env.LINE_LOGIN_CALLBACK_URL || 'https://us-central1-youzi-c1b74.cloudfunctions.net/coursePortalLineLoginCallback').trim();
const PORTAL_BASE = String(process.env.PUBLIC_WEB_BASE_URL || 'https://danny700808.github.io/play-card').replace(/\/$/, '');
const EMAIL_OTP_TTL_MS = 300 * 1000;
const EMAIL_OTP_MAX_ATTEMPTS = 5;
const LINE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const LINE_SETUP_TTL_MS = 20 * 60 * 1000;
const PORTAL_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TEACHER_PAYROLL_MIN_MONTH = '2026-07';
const TUITION_PAYMENT_BANK = Object.freeze({
  bankName: '台新國際商業銀行',
  bankCode: '812',
  branchName: '敦南分行',
  branchCode: '0023',
  accountName: '黃銘廷',
  accountNumber: '28881010149129'
});
const TUITION_PAYMENT_REQUESTS = 'coursePortalTuitionPaymentRequests';
const TUITION_PERIODS = 'coursePortalTuitionPeriods';
const TUITION_TRANSACTIONS = 'coursePortalTuitionPaymentTransactions';
const TUITION_SYSTEM_PERIODS = 'coursePortalTuitionSystemPeriods';
const TUITION_RECEIPTS = 'coursePortalTuitionReceipts';
const TUITION_RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
const TUITION_RECEIPT_TEMPLATE = path.join(__dirname, 'assets', 'tuition-receipt-blank.png');
const TUITION_RECEIPT_FONT = require.resolve(
  '@expo-google-fonts/noto-sans-tc/700Bold/NotoSansTC_700Bold.ttf'
);
const ATTENDANCE_RECORDS = 'coursePortalAttendanceRecords';
const ATTENDANCE_CANCELLATIONS = 'coursePortalAttendanceCancellationRequests';
const ATTENDANCE_PAYROLL = 'coursePortalTeacherAttendancePayroll';
const ATTENDANCE_ADMIN_FEE = 50;
const PORTAL_MAX_ADVANCE_MONTHS = 2;
const CONTACT_BOOK_POSTS = 'coursePortalLessonContactPosts';
const CONTACT_BOOK_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const CONTACT_BOOK_IMAGE_MAX_COUNT = 8;
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

function addMonths(key, amount) {
  const value = dateKey(key);
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  const targetMonth = month - 1 + Number(amount || 0);
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return [
    targetYear,
    String(normalizedMonth + 1).padStart(2, '0'),
    String(Math.min(day, lastDay)).padStart(2, '0')
  ].join('-');
}

function portalMaximumAdvanceDate() {
  return addMonths(currentTaipeiDay(), PORTAL_MAX_ADVANCE_MONTHS);
}

function assertPortalAdvanceDate(date, label = '日期') {
  const value = dateKey(date);
  const maximum = portalMaximumAdvanceDate();
  if (!value) throw new HttpsError('invalid-argument', `${label}格式錯誤。`);
  if (value > maximum) {
    throw new HttpsError(
      'failed-precondition',
      `${label}最多只能選擇到 ${maximum}（操作日起兩個月內）。`
    );
  }
  return value;
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

async function mergeStudentProfileOverrides(rows, selectedIds) {
  const collection = db.collection('coursePortalStudentProfiles');
  const snapshot = Array.isArray(selectedIds)
    ? {docs: (await Promise.all(selectedIds.map(id => collection.doc(id).get()))).filter(doc => doc.exists)}
    : await collection.get();
  const overrides = new Map(snapshot.docs.map((doc) => [doc.id, doc.data() || {}]));
  const allRows = rows.slice();
  const known = new Set(rows.map(sourceId));
  overrides.forEach((profile, id) => {
    if (!known.has(id) && profile.managerCreated === true && clean(profile.name)) allRows.push({ id });
  });
  return allRows.map((row) => {
    const override = overrides.get(sourceId(row));
    if (!override || override.active === false) return row;
    const next = Object.assign({}, row);
    const name = clean(override.name);
    const phone = normalizePhone(override.phone);
    if (name) { next.identityName = row.identityName || row.name; next.name = name; }
    if (phone || override.managerCreated === true) next.phone = phone;
    if (typeof override.studentActive === 'boolean') next.active = override.studentActive;
    if (typeof override.managerNote === 'string') next.note = override.managerNote;
    return next;
  });
}

function transactionAmount(row) {
  return Math.max(0, Number(row && (row.amount || row.paidAmount || row.receivedAmount) || 0));
}

function tuitionBasePaidAmount(row) {
  const explicit = firstFiniteNumber(row, ['paidAmount', 'receivedAmount', 'paid', 'received']);
  if (explicit !== null) return Math.max(0, explicit);
  const seen = new Set();
  return Math.max(0, (Array.isArray(row && row.transactions) ? row.transactions : []).reduce((sum, tx) => {
    if (!tx || tx.active === false || (tx.status && tx.status !== 'confirmed')) return sum;
    const id = clean(tx.id);
    if (id && seen.has(id)) return sum;
    if (id) seen.add(id);
    return sum + (tx.type === 'refund' ? -1 : 1) * transactionAmount(tx);
  }, 0));
}

function mergePortalTuitionRows(rows, portalDocs, transactionDocs, receiptDocs = []) {
  const merged = new Map((rows || []).map((row) => [sourceId(row), Object.assign({}, row)]).filter(([id]) => id));
  (portalDocs || []).forEach((doc) => {
    const source = jsonValue(typeof doc.data === 'function' ? doc.data() : doc) || {};
    if (source.active === false) return;
    const id = sourceId(source) || clean(doc.id);
    if (!id) return;
    merged.set(id, Object.assign({ __id: id }, merged.get(id) || {}, source, { id }));
  });
  const overlays = new Map();
  (transactionDocs || []).forEach((doc) => {
    const source = jsonValue(typeof doc.data === 'function' ? doc.data() : doc) || {};
    if (source.active === false || clean(source.status) !== 'confirmed') return;
    const periodId = clean(source.periodId);
    if (!periodId) return;
    if (!overlays.has(periodId)) overlays.set(periodId, []);
    overlays.get(periodId).push(Object.assign({ id: clean(source.id || doc.id) }, source));
  });
  overlays.forEach((transactions, periodId) => {
    const period = merged.get(periodId);
    if (!period) return;
    const existing = Array.isArray(period.transactions) ? period.transactions.slice() : [];
    const existingIds = new Set(existing.map((row) => clean(row && row.id)).filter(Boolean));
    const additions = transactions.filter((row) => !existingIds.has(clean(row.id)));
    const paidAmount = tuitionBasePaidAmount(period) + additions.reduce((sum, row) => sum + (row.type === 'refund' ? 0 : transactionAmount(row)), 0);
    merged.set(periodId, Object.assign({}, period, {
      paidAmount,
      receivedAmount: paidAmount,
      transactions: existing.concat(additions)
    }));
  });
  const receiptsByPeriod = new Map();
  (receiptDocs || []).forEach((doc) => {
    const source = jsonValue(typeof doc.data === 'function' ? doc.data() : doc) || {};
    if (source.active === false || clean(source.status) !== 'issued' || !clean(source.imageUrl)) return;
    const periodId = clean(source.periodId);
    if (!periodId) return;
    if (!receiptsByPeriod.has(periodId)) receiptsByPeriod.set(periodId, []);
    receiptsByPeriod.get(periodId).push(Object.assign({ id: clean(source.id || doc.id) }, source));
  });
  receiptsByPeriod.forEach((receipts, periodId) => {
    const period = merged.get(periodId);
    if (!period) return;
    const transactions = (Array.isArray(period.transactions) ? period.transactions : []).map((row, index) => {
      if (clean(row && row.type) === 'refund') return row;
      const transactionId = clean(row && row.id);
      const date = dateKey(row && (row.date || row.created));
      const amount = transactionAmount(row);
      const method = clean(row && (row.method || row.payType || row.paymentMethod));
      const receipt = receipts.find((item) =>
        (transactionId && clean(item.transactionId) === transactionId) ||
        (
          Number(item.transactionIndex) === index &&
          dateKey(item.paymentDate) === date &&
          Number(item.amount || 0) === amount &&
          (clean(item.method) === method || !method || clean(item.method) === '既有繳費')
        )
      );
      if (!receipt) return row;
      return Object.assign({}, row, {
        receiptId: clean(receipt.id),
        receiptNo: clean(receipt.receiptNo),
        receiptImageUrl: clean(receipt.imageUrl)
      });
    });
    merged.set(periodId, Object.assign({}, period, { transactions }));
  });
  return [...merged.values()];
}

async function portalTuitionDocuments(studentId = '') {
  const periodCollection = db.collection(TUITION_PERIODS);
  const transactionCollection = db.collection(TUITION_TRANSACTIONS);
  const receiptCollection = db.collection(TUITION_RECEIPTS);
  const normalizedStudentId = clean(studentId);
  const [periods, transactions, receipts] = await Promise.all([
    normalizedStudentId
      ? periodCollection.where('studentId', '==', normalizedStudentId).get()
      : periodCollection.get(),
    normalizedStudentId
      ? transactionCollection.where('studentId', '==', normalizedStudentId).get()
      : transactionCollection.get(),
    normalizedStudentId
      ? receiptCollection.where('studentId', '==', normalizedStudentId).get()
      : receiptCollection.get()
  ]);
  return { periods: periods.docs, transactions: transactions.docs, receipts: receipts.docs };
}

function firstArray(row, keys) {
  for (const key of keys) {
    if (Array.isArray(row && row[key])) return row[key].map(clean).filter(Boolean);
  }
  return [];
}

async function readCourseGroups() {
  return memoPortalRead('groups:' + JSON.stringify([]), () => readCourseGroupsUncached());
}

async function readCourseGroupsUncached() {
  const snapshot = await db.collection('coursePortalStudentGroups').get();
  return snapshot.docs.map(doc => Object.assign({ id: doc.id }, jsonValue(doc.data()) || {})).filter(row => row.active !== false);
}

async function mirrorRows(type) {
  return memoPortalRead('mirror:' + JSON.stringify([type]), () => mirrorRowsUncached(type));
}

async function mirrorRowsUncached(type) {
  const snapshot = await db.collection(MIRROR[type]).where('sourceActive', '==', true).get();
  let rows = snapshot.docs
    .map((doc) => Object.assign({ __id: doc.id }, jsonValue((doc.data() || {}).source) || {}))
    .filter(Boolean);
  if (type === 'fixedCourses') {
    const created = await db.collection('coursePortalFixedCourses').get();
    rows = rows.concat(created.docs.map(doc => Object.assign({ id: doc.id }, jsonValue(doc.data()) || {})));
  }
  if (type === 'subjects') {
    const catalog = await db.collection(SUBJECT_CATALOG_COLLECTION).get();
    rows = mergeSubjectRows(rows, catalog.docs);
  }
  if (type === 'feePlans') {
    const portalPlans = await db.collection(FEE_PLAN_COLLECTION).get();
    rows = mergeFeePlanRows(rows, portalPlans.docs);
  }
  if (type === 'teachers') {
    const assignments = await db.collection(TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION).get();
    rows = mergeTeacherRows(rows, assignments.docs);
  }
  if (type === 'students') rows = await mergeStudentProfileOverrides(rows);
  if (type === 'tuitionPeriods') {
    const portal = await portalTuitionDocuments();
    rows = mergePortalTuitionRows(rows, portal.periods, portal.transactions, portal.receipts);
  }
  return projectCourseGroups(type, rows, await readCourseGroups());
}

// Fetch only the identities needed by a teacher view; never scan all profiles.
async function mirrorProfilesByIds(type, values) {
  if (!['students', 'teachers'].includes(type)) throw new Error('Unsupported profile type');
  const ids = [...new Set(values.map(clean).filter(Boolean))];
  if (!ids.length) return [];
  return memoPortalRead('profiles:' + JSON.stringify([type, ids.slice().sort()]), async () => {
    const collection = db.collection(MIRROR[type]);
    const chunks = [];
    for (let offset = 0; offset < ids.length; offset += 30) chunks.push(ids.slice(offset, offset + 30));
    const snapshots = await Promise.all(chunks.map(chunk => collection.where('source.id', 'in', chunk).get()));
    const rows = snapshots.flatMap(snapshot => snapshot.docs)
      .filter(doc => (doc.data() || {}).sourceActive !== false)
      .map(doc => Object.assign({__id:doc.id}, jsonValue((doc.data() || {}).source) || {}));
    // Older rows may have only the document id, while native profiles may have no mirror row.
    const found = new Set(rows.map(sourceId));
    const missing = ids.filter(id => !found.has(id));
    const legacy = await Promise.all(missing.map(id => collection.doc(id).get()));
    legacy.filter(doc => doc.exists && (doc.data() || {}).sourceActive !== false).forEach(doc => {
      rows.push(Object.assign({__id:doc.id}, jsonValue((doc.data() || {}).source) || {}));
    });
    let merged = rows;
    if (type === 'students') merged = await mergeStudentProfileOverrides(rows, ids);
    else {
      const assignments = await Promise.all(ids.map(id => db.collection(TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION).doc(id).get()));
      merged = mergeTeacherRows(rows, assignments.filter(doc => doc.exists));
    }
    return projectCourseGroups(type, merged, await readCourseGroups()).filter(row => ids.includes(sourceId(row)));
  });
}

async function mirrorRowsIncludingInactive(type) {
  return memoPortalRead('mirror-inactive:' + JSON.stringify([type]), () => mirrorRowsIncludingInactiveUncached(type));
}

async function mirrorRowsIncludingInactiveUncached(type) {
  const snapshot = await db.collection(MIRROR[type]).get();
  let rows = snapshot.docs
    .map((doc) => Object.assign({
      __id: doc.id,
      __mirrorActive: (doc.data() || {}).sourceActive !== false
    }, jsonValue((doc.data() || {}).source) || {}))
    .filter(Boolean);
  if (type === 'subjects') {
    const catalog = await db.collection(SUBJECT_CATALOG_COLLECTION).get();
    rows = mergeSubjectRows(rows, catalog.docs, { includePending: true });
  }
  if (type === 'feePlans') {
    const portalPlans = await db.collection(FEE_PLAN_COLLECTION).get();
    rows = mergeFeePlanRows(rows, portalPlans.docs, { includeInactive: true });
  }
  if (type === 'teachers') {
    const assignments = await db.collection(TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION).get();
    rows = mergeTeacherRows(rows, assignments.docs);
  }
  if (type === 'students') rows = await mergeStudentProfileOverrides(rows);
  return projectCourseGroups(type, rows, await readCourseGroups(), { includeAliases: true });
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
    return projectCourseGroups(type, [...rows.values()], await readCourseGroups());
  } catch (error) {
    console.warn('[course portal date range fallback]', type, clean(error && error.message));
    const snapshot = includeInactive
      ? await db.collection(MIRROR[type]).get()
      : await db.collection(MIRROR[type]).where('sourceActive', '==', true).get();
    const fallbackRows = snapshot.docs.map((doc) => {
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
    return projectCourseGroups(type, fallbackRows, await readCourseGroups());
  }
}

async function mirrorRowsByField(type, field, value) {
  const groups = await readCourseGroups();
  if (field === 'studentId') value = canonicalStudentId(clean(value), groups);
  const collection = db.collection(MIRROR[type]);
  let rows;
  try {
    const snapshot = await collection
      .where('sourceActive', '==', true)
      .where(`source.${field}`, '==', clean(value))
      .get();
    rows = snapshot.docs
      .map((doc) => Object.assign({ __id: doc.id }, jsonValue((doc.data() || {}).source) || {}));
  } catch (error) {
    console.warn('[course portal field query fallback]', type, field, clean(error && error.message));
    const snapshot = await collection.where('sourceActive', '==', true).get();
    rows = snapshot.docs
      .map((doc) => Object.assign({ __id: doc.id }, jsonValue((doc.data() || {}).source) || {}))
      .filter((row) => clean(row[field]) === clean(value));
  }
  if (type === 'tuitionPeriods') {
    const portal = await portalTuitionDocuments(field === 'studentId' ? value : '');
    rows = mergePortalTuitionRows(rows, portal.periods, portal.transactions, portal.receipts)
      .filter((row) => clean(row[field]) === clean(value));
  }
  return projectCourseGroups(type, rows, groups);
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
  const rows = type === 'students' ? await mirrorRowsIncludingInactive(type) : await mirrorRows(type);
  const wantedName = normalizeName(name);
  const matches = rows.filter((row) =>
    sourceActive(row) &&
    [row.identityName, row.name || row.teacherName || row.studentName].some(value => normalizeName(value) === wantedName) &&
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
  if (email && !validEmail(email)) {
    throw new HttpsError('invalid-argument', 'Email 格式不正確。');
  }

  if (type === 'teacher') {
    const teacher = await findPerson('teachers', name, phone);
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
    existingEmailVerified = renter.emailVerified === true;
  }
  return { type, targetId: '', renterId, name, phone, email, relationship: '', existingEmailVerified };
}

function bindingCollection(type) {
  if (type === 'teacher') return 'coursePortalTeacherBindings';
  if (type === 'student') return 'coursePortalStudentBindings';
  return 'coursePortalRenterBindings';
}

function bindingNeedsManagerApproval(type) {
  return type === 'teacher' || type === 'student';
}

function bindingStatusLabel(status) {
  const value = clean(status);
  if (value === 'pending') return '等待主管確認';
  if (value === 'rejected') return '主管已拒絕';
  if (value === 'revoked') return '已停用';
  return '使用中';
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

function lineAccountId(type, lineUserId) {
  return hash(`line-account|${clean(type)}|${clean(lineUserId)}`);
}

async function resolveRegularIdentity(identity) {
  const type = clean(identity.type);
  const targetField = identityTargetField(type);
  const targetId = identityTargetId(identity);
  const fallbackAuthAccountId = regularAccountId(type, identity.email);
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
    )
  );
  if (sameAccount.some((row) => clean(row.status) === 'revoked' && row.revokedReason !== 'peer-unbound')) {
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

async function prepareLineRegistrationIdentity(data, type) {
  const setupToken = clean(data.setupToken);
  if (!setupToken) {
    throw new HttpsError('invalid-argument', 'LINE 登入資料已遺失，請重新登入。');
  }
  const lineSetupId = hash(setupToken);
  const setupSnapshot = await db.collection('coursePortalLineSetupTokens').doc(lineSetupId).get();
  const setup = setupSnapshot.exists ? setupSnapshot.data() || {} : null;
  if (
    !setup ||
    clean(setup.status) !== 'pending' ||
    asMillis(setup.expiresAt) < Date.now() ||
    clean(setup.type) !== type ||
    !clean(setup.lineUserId)
  ) {
    throw new HttpsError('permission-denied', 'LINE 登入資料已失效，請重新登入。');
  }
  const identity = await prepareBindingIdentity(Object.assign({}, data, { type }));
  if (!validEmail(identity.email)) {
    throw new HttpsError('invalid-argument', '請填寫 Email 並完成四碼驗證。');
  }
  return Object.assign(identity, {
    lineSetupId,
    lineUserId: clean(setup.lineUserId)
  });
}

async function sendEmailOtp(data, helpers = {}) {
  const requestedPurpose = clean(data.purpose).toLowerCase();
  const purpose = ['account', 'login', 'line-registration'].includes(requestedPurpose)
    ? requestedPurpose
    : 'bind';
  const type = clean(data.type).toLowerCase();
  if (!['teacher', 'student', 'renter'].includes(type)) {
    throw new HttpsError('invalid-argument', '不支援的入口類型。');
  }

  const email = normalizeEmail(data.email);
  assertInput(email, 'Email');
  if (!validEmail(email)) throw new HttpsError('invalid-argument', 'Email 格式不正確。');
  await consumeRateLimit(`email-otp-${purpose}-${type}`, email);

  let identity = null;
  if (purpose === 'line-registration') {
    identity = await prepareLineRegistrationIdentity(data, type);
  } else if (purpose === 'account' || purpose === 'bind') {
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
    payload.lineSetupId = clean(identity.lineSetupId);
  } else {
    payload.decoy = true;
  }
  const ref = db.collection('coursePortalEmailOtps').doc(hash(challenge));
  await ref.set(payload);
  let recoveryRef = null;
  let recoveryUrl = '';
  if (identity && purpose === 'line-registration') {
    const recoveryToken = randomToken(36);
    recoveryRef = db.collection('coursePortalOtpRecovery').doc(hash(recoveryToken));
    await recoveryRef.set({ kind: 'email-link', challengeToken: challenge, type,
      lineUserId: payload.lineUserId, expiresAt, createdAt: FieldValue.serverTimestamp() });
    recoveryUrl = `${centralPortalUrl({ role: type })}#resume=${encodeURIComponent(recoveryToken)}`;
  }

  if (identity && typeof helpers.sendEmail !== 'function') {
    await ref.delete().catch(() => {});
    if (recoveryRef) await recoveryRef.delete().catch(() => {});
    throw new HttpsError('internal', '驗證信服務尚未啟用，請使用 LINE 快速登入或聯絡管理者。');
  }
  if (identity) {
    try {
      await helpers.sendEmail({
        channel: 'email',
        targetEmail: email,
        title: `柚子樂器${['bind', 'line-registration'].includes(purpose) ? '首次驗證' : '登入'}驗證碼`,
        body: [
          `您的四碼驗證碼是：${code}`,
          '',
          '驗證碼 300 秒內有效，最多可輸入 5 次。',
          ...(recoveryUrl ? ['', '返回驗證頁面：', recoveryUrl,
            '若原畫面已關閉，請由此返回輸入四碼。有效期限不會重新計算，請勿轉寄驗證信。', ''] : []),
          '若不是您本人操作，請忽略這封信，也不要把驗證碼告訴任何人。'
        ].join('\n')
      });
    } catch (error) {
      await ref.delete().catch(() => {});
      if (recoveryRef) await recoveryRef.delete().catch(() => {});
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
  const bindings = [...new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((doc) => [
    doc.id,
    Object.assign({ __id: doc.id, __ref: doc.ref }, doc.data() || {})
  ])).values()];
  const groups = await readCourseGroups();
  return bindings.filter(row => !(session.revokedStudentIds || []).includes(clean(row.studentId))).map(row => ({ ...row, legacyStudentId: row.studentId, studentId: canonicalStudentId(clean(row.studentId), groups) }));
}

async function activeStudentIdsForSession(session) {
  const bindings = await activeStudentBindingsForSession(session);
  const studentIds = [...new Set(bindings.map((row) => clean(row.studentId)).filter(Boolean))];
  if (!studentIds.length) return [];
  const today = currentTaipeiDay();
  const [students, fixedCourses, temporaryCourses, events, suspensions] = await Promise.all([
    mirrorRowsIncludingInactive('students'),
    mirrorRows('fixedCourses'),
    mirrorRows('temporaryCourses'),
    scheduleBundle(today, addDays(today, 120), '').then(bundle => bundle.resourceEvents),
    reconcileStudentSuspensionsForNewSchedules(studentIds)
  ]);
  const active = activeLearningStudentIds(
    students,
    [...fixedCourses, ...temporaryCourses],
    events,
    suspensions
  );
  return studentIds.filter((studentId) => active.has(studentId));
}

function sessionOwnerKey(session) {
  const authAccountId = clean(session && session.authAccountId);
  const lineUserId = clean(session && session.lineUserId);
  if (authAccountId) return `account:${authAccountId}`;
  if (lineUserId) return `line:${lineUserId}`;
  return '';
}

async function authorizedBindingsForSession(session) {
  const role = clean(session && session.role);
  if (!['teacher', 'student', 'renter'].includes(role)) return [];
  if (role === 'student') return activeStudentBindingsForSession(session);
  const collection = db.collection(bindingCollection(role));
  const queries = [];
  if (clean(session.lineUserId)) {
    queries.push(collection.where('lineUserId', '==', clean(session.lineUserId)).get());
  }
  if (clean(session.authAccountId)) {
    queries.push(collection.where('authAccountId', '==', clean(session.authAccountId)).get());
  }
  const targetField = role === 'teacher' ? 'teacherId' : 'renterId';
  const targetId = clean(session[targetField]);
  if (!queries.length && targetId) {
    queries.push(collection.where(targetField, '==', targetId).get());
  }
  const snapshots = await Promise.all(queries);
  return [...new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((doc) => [
    doc.id,
    Object.assign({ __id: doc.id, __ref: doc.ref }, doc.data() || {})
  ])).values()].filter((row) =>
    clean(row.status) === 'active' &&
    (!targetId || clean(row[targetField]) === targetId)
  );
}

async function touchAuthorizedBindings(session) {
  const bindings = await authorizedBindingsForSession(session);
  if (!bindings.length) return false;
  const batch = db.batch();
  bindings.forEach((row) => batch.set(row.__ref, {
    lastLoginAt: FieldValue.serverTimestamp(),
    lastLoginAtText: nowText(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true }));
  await batch.commit();
  return true;
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
  const sessionRef = db.collection('coursePortalSessions').doc(hash(session));
  await sessionRef.set(sessionPayload);
  if (!(await touchAuthorizedBindings(sessionPayload))) {
    await sessionRef.delete().catch(() => {});
    throw new HttpsError('permission-denied', '這個登入權限已停用或尚未核准，請聯絡柚子樂器。');
  }
  if (type === 'teacher') {
    const historyRef = db.collection('coursePortalTeacherLoginHistory').doc(clean(targetId));
    await db.runTransaction(async tx => {
      const previous = await tx.get(historyRef);
      tx.set(sessionRef, { previousLoginAtText: clean(previous.exists && previous.data().lastLoginAtText), loginAtText: nowText() }, { merge: true });
      tx.set(historyRef, { lastLoginAtText: nowText(), lastLoginAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  }
  await queueSessionSecurityNotice(hash(session), sessionPayload);
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
  if (['revoked', 'rejected'].includes(clean(previous.status)) && !(type === 'student' && previous.revokedReason === 'peer-unbound')) {
    throw new HttpsError('permission-denied', '這個入口帳號目前已停用，請聯絡柚子樂器協助恢復。');
  }
  const approved = true; // Existing identity was matched and Email OTP verified.
  const nextStatus = approved ? 'active' : 'pending';

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
    status: nextStatus,
    approvalStatus: approved ? 'approved' : 'pending',
    approvalRequestedAt: approved ? (previous.approvalRequestedAt || null) : FieldValue.serverTimestamp(),
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
  if (!approved) {
    await queueBindingApprovalNotices(Object.assign({}, previous, payload, {
      id: bindingId,
      targetId,
      renterId
    }));
    return {
      ok: true,
      purpose: 'account',
      role: type,
      pendingApproval: true,
      message: '資料已送出，主管確認後即可登入；請稍後重新開啟入口。'
    };
  }

  if (type === 'student' && clean(previous.status) !== 'active') await queueDirectLineBindingNotice({ ...previous, ...payload, id: bindingId });
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
  void data;
  throw new HttpsError(
    'failed-precondition',
    '學生／家長姓名與電話直接登入已停用；所有新註冊都必須填寫 Email 並完成四碼驗證。'
  );
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
    if (!row || row.status !== 'pending' || asMillis(row.expiresAt) <= Date.now()) {
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
  if (source.purpose === 'line-registration') {
    return completeVerifiedLineRegistration(source);
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

function centralPortalUrl(params = {}) {
  const url = new URL(`${PORTAL_BASE}/course-portal.html`);
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
    bot_prompt: 'normal'
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}

// The email link resumes the original challenge without creating a session.
// The original four-digit code and deadline still apply.
async function readOtpRecovery(token, kind) {
  if (!clean(token) || clean(token).length > 200) throw new HttpsError('invalid-argument', '返回連結不完整，請重新申請驗證碼。');
  const snapshot = await db.collection('coursePortalOtpRecovery').doc(hash(clean(token))).get();
  const recovery = snapshot.exists ? snapshot.data() : null;
  if (!recovery || recovery.kind !== kind || asMillis(recovery.expiresAt) <= Date.now()) {
    throw new HttpsError('deadline-exceeded', '返回連結已失效，請重新申請驗證碼。');
  }
  const otpSnapshot = await db.collection('coursePortalEmailOtps').doc(hash(recovery.challengeToken)).get();
  const otp = otpSnapshot.exists ? otpSnapshot.data() : null;
  if (!otp || otp.status !== 'pending' || otp.purpose !== 'line-registration' ||
      asMillis(otp.expiresAt) <= Date.now() || Number(otp.attempts || 0) >= EMAIL_OTP_MAX_ATTEMPTS ||
      otp.type !== recovery.type || !otp.lineUserId || otp.lineUserId !== recovery.lineUserId) {
    throw new HttpsError('deadline-exceeded', '驗證碼已失效，請重新申請。');
  }
  const setupSnapshot = await db.collection('coursePortalLineSetupTokens').doc(clean(otp.lineSetupId)).get();
  const setup = setupSnapshot.exists ? setupSnapshot.data() : null;
  if (!setup || setup.status !== 'pending' || setup.lineUserId !== otp.lineUserId ||
      setup.type !== otp.type || asMillis(setup.expiresAt) <= Date.now()) {
    throw new HttpsError('permission-denied', 'LINE 綁定已失效，請重新登入。');
  }
  return { recovery, otp };
}

async function completeOtpRecovery(recoveryToken, profile) {
  const { recovery, otp } = await readOtpRecovery(recoveryToken, 'email-link');
  if (!profile || profile.lineUserId !== otp.lineUserId) {
    throw new HttpsError('permission-denied', '請使用最初申請綁定的同一個 LINE 帳號，再從信件返回。');
  }
  const verifiedToken = randomToken(36);
  await db.collection('coursePortalOtpRecovery').doc(hash(verifiedToken)).set({
    kind: 'line-verified', challengeToken: recovery.challengeToken,
    type: otp.type, lineUserId: otp.lineUserId, expiresAt: otp.expiresAt,
    createdAt: FieldValue.serverTimestamp()
  });
  return { type: otp.type, verifiedToken };
}

async function resumeEmailOtp(data) {
  const { recovery, otp } = await readOtpRecovery(data.resumeToken, 'email-link');
  return { ok: true, type: otp.type, challengeToken: recovery.challengeToken,
    maskedEmail: maskedEmail(otp.email),
    expiresInSeconds: Math.max(0, Math.floor((asMillis(otp.expiresAt) - Date.now()) / 1000)) };
}

async function startLineLogin(data) {
  const type = clean(data.type).toLowerCase();
  if (!['teacher', 'student', 'renter'].includes(type)) {
    throw new HttpsError('invalid-argument', '不支援的入口類型。');
  }
  const recovery = data.resumeLink ? await readOtpRecovery(data.resumeLink, 'email-link') : null;
  if (recovery && recovery.otp.type !== type) throw new HttpsError('permission-denied', '返回連結的身分不符。');
  const state = randomToken(32);
  const expiresAt = recovery ? recovery.otp.expiresAt : Timestamp.fromMillis(Date.now() + LINE_OAUTH_STATE_TTL_MS);
  await db.collection('coursePortalLineOAuthStates').doc(hash(state)).set({
    type,
    linkAnother: type === 'student' && data.linkAnother === true,
    ...(recovery ? { otpRecoveryToken: clean(data.resumeLink) } : {}),
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

// 舊的姓名／電話直接入口只保留相容函式名稱，實際已全面停用。
// 所有角色的新註冊都必須先完成 Email 四碼驗證。
async function directRegularAccess(data) {
  void data;
  throw new HttpsError(
    'failed-precondition',
    '一般直接登入已停用；所有新註冊都必須填寫 Email 並完成四碼驗證。'
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

async function refreshLineBindingProfile(bindings, profile, loginType) {
  if (!bindings.length) return;
  const batch = db.batch();
  bindings.forEach((binding) => {
    const update = {
      lineDisplayName: profile.lineDisplayName,
      linePictureUrl: profile.linePictureUrl,
      lineFriendFlag: profile.lineFriendFlag,
      lineProfileCheckedAt: FieldValue.serverTimestamp()
    };
    const type = clean(binding.type) || clean(loginType);
    if (['teacher', 'student', 'renter'].includes(type)) {
      update.authAccountId = lineAccountId(type, profile.lineUserId);
    }
    Object.assign(update, bindingIdentityPatch(type, binding));
    batch.set(binding.__ref, update, { merge: true });
  });
  await batch.commit();
}

function redirectLineLoginError(res, type, message) {
  const safeType = ['teacher', 'student', 'renter'].includes(type) ? type : '';
  const target = centralPortalUrl({
    method: 'line',
    role: safeType,
    lineError: message || 'LINE 登入未完成，請重新操作。'
  });
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
    if (stateRow.otpRecoveryToken) {
      const resumed = await completeOtpRecovery(stateRow.otpRecoveryToken, profile);
      await stateRef.set({ status: 'used', completedAt: FieldValue.serverTimestamp() }, { merge: true });
      res.redirect(302, `${centralPortalUrl({ role: resumed.type })}#resumeVerified=${encodeURIComponent(resumed.verifiedToken)}`);
      return;
    }
    const allBindings = await bindingsForLine(type, profile.lineUserId);
    await refreshLineBindingProfile(allBindings, profile, type);
    const decision = decideLineLoginBinding(type, allBindings);
    if (['pending', 'blocked', 'conflict'].includes(decision.action)) {
      const message = decision.action === 'pending'
        ? '這個身分已完成註冊，正在等待管理者核准；核准後再重新登入即可。'
        : (decision.action === 'conflict'
          ? '這個 LINE 在同一身分下有多筆有效資料，系統已停止自動選擇。請聯絡柚子樂器協助確認。'
          : '這個入口帳號目前已停用，請聯絡柚子樂器協助恢復。');
      await stateRef.set({
        status: decision.action === 'pending' ? 'awaiting-approval' : 'blocked',
        error: message,
        lineUserId: profile.lineUserId,
        completedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      redirectLineLoginError(res, type, message);
      return;
    }
    if (decision.action === 'login' && stateRow.linkAnother !== true) {
      const binding = decision.binding;
      const identityId = bindingIdentity(type, binding);
      const accessToken = await issueAccessToken({
        type,
        lineUserId: profile.lineUserId,
        authAccountId: lineAccountId(type, profile.lineUserId),
        targetId: type === 'renter' ? '' : identityId,
        renterId: type === 'renter' ? identityId : '',
        authMethod: 'line-oauth',
        lineFriendFlag: profile.lineFriendFlag
      });
      await stateRef.set({
        status: 'used',
        lineUserId: profile.lineUserId,
        lineFriendFlag: profile.lineFriendFlag,
        completedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      res.redirect(302, centralPortalUrl({ method: 'line', role: type, access: accessToken }));
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
    res.redirect(302, centralPortalUrl({ method: 'line', role: type, lineSetup: setupToken }));
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

async function completeVerifiedLineRegistration(data) {
  const lineSetupId = clean(data.lineSetupId);
  const requestedType = clean(data.type).toLowerCase();
  if (!lineSetupId || !validEmail(data.email)) {
    throw new HttpsError('failed-precondition', '請先完成 Email 四碼驗證，再建立 LINE 帳號。');
  }
  const setupRef = db.collection('coursePortalLineSetupTokens').doc(lineSetupId);
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
  if (normalizeEmail(identity.email) !== normalizeEmail(data.email)) {
    throw new HttpsError('permission-denied', 'Email 驗證資料不一致，請重新取得四碼驗證碼。');
  }
  // LINE 帳號鍵仍由 LINE 使用者身分產生；Email 四碼負責確認首次註冊者
  // 能實際使用所填信箱，兩項都完成後才建立帳號。
  await consumeRateLimit(`line-oauth-setup-${type}`, identity.phone);
  const lineUserId = clean(setup.lineUserId);
  const authAccountId = lineAccountId(type, lineUserId);
  const targetId = clean(identity.targetId);
  const renterId = clean(identity.renterId);
  const conflictField = type === 'teacher' ? 'teacherId' : (type === 'renter' ? 'renterId' : '');
  if (conflictField) {
    const conflicts = await db.collection(bindingCollection(type))
      .where(conflictField, '==', type === 'teacher' ? targetId : renterId)
      .get();
    const conflictRows = conflicts.docs.map((doc) => doc.data() || {});
    if (conflictRows.some((row) =>
      ['revoked', 'rejected'].includes(clean(row.status)) &&
      !isRecoverableUnboundBinding(row)
    )) {
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
  const previous = previousBinding.exists ? previousBinding.data() || {} : {};
  if (
    ['revoked', 'rejected'].includes(clean(previous.status)) &&
    !isRecoverableUnboundBinding(previous) && previous.revokedReason !== 'peer-unbound'
  ) {
    throw new HttpsError('permission-denied', '這個入口帳號目前已停用，請聯絡柚子樂器協助恢復。');
  }
  // LINE 已完成平台身分驗證，並且姓名、電話仍需與校務資料吻合，
  // 因此綁定後直接啟用，不再增加主管逐筆核准。
  const payload = {
    type,
    lineUserId,
    lineDisplayName: clean(setup.lineDisplayName),
    linePictureUrl: clean(setup.linePictureUrl),
    lineFriendFlag: setup.lineFriendFlag === true,
    lineVerified: true,
    authAccountId,
    authProvider: 'line-login+email-otp',
    name: clean(identity.name),
    phoneHash: hash(normalizePhone(identity.phone)),
    status: 'active',
    approvalStatus: 'approved',
    lineBindStatus: 'bound',
    lineLinkStatus: 'linked',
    globalLineRevokedAt: null,
    globalLineRevokedBy: '',
    globalLineRevokedReason: '',
    unboundAt: null,
    revokedAt: null,
    rejectedAt: null,
    approvalRequestedAt: previous.approvalRequestedAt || null,
    approvedAt: FieldValue.serverTimestamp(),
    approvedAtText: nowText(),
    approvalSource: 'line-self-service',
    updatedAt: FieldValue.serverTimestamp(),
    boundAt: previous.boundAt || FieldValue.serverTimestamp(),
    reminderLastLesson: false,
    reminderPayment: true
  };
  payload.email = normalizeEmail(identity.email);
  payload.emailNormalized = normalizeEmail(identity.email);
  payload.emailVerified = true;
  payload.emailVerifiedAt = FieldValue.serverTimestamp();
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
      const renterProfile = {
        renterId,
        name: clean(identity.name),
        phone: normalizePhone(identity.phone),
        email: normalizeEmail(identity.email),
        emailNormalized: normalizeEmail(identity.email),
        emailVerified: true,
        emailVerifiedAt: FieldValue.serverTimestamp(),
        source: 'line-login-registration',
        active: true,
        updatedAt: FieldValue.serverTimestamp(),
        createdAtText: nowText()
      };
      tx.set(db.collection('coursePortalRenters').doc(renterId), renterProfile, { merge: true });
    }
    tx.set(bindingRef, payload, { merge: true });
    tx.set(setupRef, {
      status: 'used',
      targetId,
      renterId,
      usedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  await queueDirectLineBindingNotice(Object.assign({}, previous, payload, {
    id: bindingId,
    targetId,
    renterId
  }));

  const issued = await issueSession({
    type,
    lineUserId,
    authAccountId,
    targetId,
    renterId,
    authMethod: 'line-oauth+email-otp-registration'
  });
  return {
    ok: true,
    role: type,
    sessionToken: issued.sessionToken,
    expiresAt: issued.expiresAt.toDate().toISOString(),
    reminderReady: setup.lineFriendFlag === true
  };
}

async function completeLineRegistration(data) {
  void data;
  throw new HttpsError(
    'failed-precondition',
    '第一次使用 LINE 註冊時，必須先填寫 Email 並完成四碼驗證。'
  );
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
      authAccountId: lineAccountId(type, lineUserId),
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
  const previousBind = await bindRef.get();
  const previousBinding = previousBind.exists ? previousBind.data() || {} : {};
  if (
    ['revoked', 'rejected'].includes(clean(previousBinding.status)) &&
    !isRecoverableUnboundBinding(previousBinding)
  ) {
    await reply(replyToken, '這個入口帳號目前已停用，請聯絡柚子樂器協助恢復。');
    return true;
  }
  const payload = {
    type,
    lineUserId,
    authAccountId: lineAccountId(type, lineUserId),
    lineDisplayName: clean(profile.displayName),
    email: normalizeEmail(row.email),
    emailNormalized: normalizeEmail(row.email),
    emailVerified: row.emailVerified === true,
    emailVerifiedAt: row.emailVerified === true ? FieldValue.serverTimestamp() : null,
    status: 'active',
    approvalStatus: 'approved',
    lineBindStatus: 'bound',
    lineLinkStatus: 'linked',
    globalLineRevokedAt: null,
    globalLineRevokedBy: '',
    globalLineRevokedReason: '',
    unboundAt: null,
    revokedAt: null,
    rejectedAt: null,
    approvalRequestedAt: previousBinding.approvalRequestedAt || null,
    approvedAt: FieldValue.serverTimestamp(),
    approvedAtText: nowText(),
    approvalSource: 'line-self-service',
    updatedAt: FieldValue.serverTimestamp(),
    boundAt: FieldValue.serverTimestamp(),
    reminderLastLesson: false,
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
  await queueDirectLineBindingNotice(Object.assign({}, previousBinding, payload, {
    id: bindId,
    targetId: clean(row.targetId),
    renterId: clean(row.renterId)
  }));

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
  const authorizedBindings = await authorizedBindingsForSession(session);
  if (!authorizedBindings.length) {
    await ref.set({
      status: 'revoked',
      revokedAt: FieldValue.serverTimestamp(),
      revokedReason: 'binding-not-active'
    }, { merge: true });
    throw new HttpsError('permission-denied', '這個登入權限已停用或解除，請重新登入或聯絡柚子樂器。');
  }
  const update = { lastUsedAt: FieldValue.serverTimestamp() };
  if (session.sliding !== false) {
    update.expiresAt = Timestamp.fromMillis(Date.now() + PORTAL_SESSION_TTL_MS);
  }
  await ref.set(update, { merge: true });
  return session;
}

function employeePhone(row) {
  return normalizePhone(row && (
    row.mobilePhone || row.mobile || row.phone || row.tel || row.telephone || row.contactPhone
  ));
}

function employeeEmail(row) {
  return normalizeEmail(row && (row.email || row.Email || row.loginEmail || row.contactEmail));
}

function isExternalTeacherEmployee(row) {
  const identity = clean(row && (row.identityType || row.employeeType || row.identityLabel || row.role)).toLowerCase();
  return row && (
    row.isExternalTeacher === true ||
    identity === 'external' ||
    identity === 'externalteacher' ||
    /外聘/.test(clean(row.identityLabel || row.roleLabel))
  );
}

function externalTeacherProfileMissingFields(row) {
  const source = row || {};
  const teaching = Array.isArray(source.teachingAbilities)
    ? source.teachingAbilities.filter((item) => clean(item && (item.item || item.name || item.subject)))
    : clean(source.teachingItems || source.teachingItemsText);
  const contactMethod = clean(
    source.lineUserId || source.lineUid || source.lineId || source.LINEUserId
  ) || employeeEmail(source);
  const identityDocument = clean(source.identityDocumentUrl) ||
    (Array.isArray(source.identityUrls) && source.identityUrls.length) ||
    (Array.isArray(source.identityFiles) && source.identityFiles.some((file) => clean(
      typeof file === 'string' ? file : file && (file.storagePath || file.downloadUrl || file.url)
    )));
  return [
    ['name', '姓名', clean(source.name || source.displayName || source.employeeName)],
    ['mobilePhone', '行動電話', employeePhone(source)],
    ['contactMethod', 'LINE 或 Email', contactMethod],
    ['idNumber', '身分證字號', clean(source.idNumber)],
    ['birthDate', '出生年月日', clean(source.birthDate)],
    ['householdAddress', '戶籍地址', clean(source.householdAddress)],
    ['mailingAddress', '通訊地址', clean(source.mailingAddress || source.contactAddress)],
    ['emergencyContact', '緊急聯絡人', clean(source.emergencyContact)],
    ['emergencyPhone', '緊急聯絡人電話', normalizePhone(source.emergencyPhone || source.emergencyContactPhone)],
    ['teachingAbilities', '授課項目', teaching],
    ['identityDocument', '身分證明文件', identityDocument],
    ['bankAccountName', '台新國際商業銀行戶名', clean(source.bankAccountName)],
    ['bankAccountNumber', '台新國際商業銀行帳號', /^[0-9]+$/.test(clean(source.bankAccountNumber))]
  ].filter((item) => !item[2]).map((item) => ({ key: item[0], label: item[1] }));
}

const TEACHER_UTILITY_IDENTITY_URL_LIMIT = 4;
const TEACHER_PORTAL_PROFILE_VERSION = 2;
const TEACHER_PORTAL_PROFILE_SOURCE = 'course-portal-fresh-external-teacher-v2';
const TEACHER_PROFILE_DRAFTS = 'teacherProfileDrafts';
const TEACHER_PROFILE_CHANGE_DRAFTS = 'teacherProfileChangeDrafts';

function teacherPortalProfileId(teacherId) {
  return `EXTP_${hash(`course-portal-profile-v${TEACHER_PORTAL_PROFILE_VERSION}:${teacherId}`).slice(0, 24)}`;
}

function teacherPortalProfileUrl() {
  return `${PORTAL_BASE}/teacher-profile.html`;
}

function teacherPortalProfileStatusIsConfirmed(row) {
  const status = clean(row && (
    row.status || row.contractStatus || row.profileStatus || row.externalTeacherStatus
  )).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  return [
    'active', 'confirmed', 'contract_effective', 'approved',
    '已確認', '已核准', '已生效', '契約生效', '管理端已確認，契約生效'
  ].includes(status);
}

function teacherPortalProfileIsCurrent(row, teacherId, profileId) {
  const source = row || {};
  return Number(source.portalProfileVersion || 0) === TEACHER_PORTAL_PROFILE_VERSION &&
    clean(source.portalProfileSource || source.source) === TEACHER_PORTAL_PROFILE_SOURCE &&
    clean(source.coursePortalTeacherId) === clean(teacherId) &&
    clean(source.__id || source.id || source.teacherId) === clean(profileId);
}

function teacherUtilityFirstText(sources, fields) {
  for (const source of sources || []) {
    for (const field of fields || []) {
      const value = clean(source && source[field]);
      if (value) return value;
    }
  }
  return '';
}

function teacherUtilityTeachingAbilities(sources) {
  for (const source of sources || []) {
    const abilities = Array.isArray(source && source.teachingAbilities)
      ? source.teachingAbilities.map((item) => {
        if (typeof item === 'string') return { item: clean(item) };
        const name = clean(item && (item.item || item.name || item.subject));
        const level = clean(item && (item.level || item.degree || item.proficiency));
        return name ? { item: name, level } : null;
      }).filter(Boolean)
      : [];
    if (abilities.length) return abilities;
    const text = clean(source && (source.teachingItemsText || source.teachingItems));
    if (text) {
      return text.split(/[、,，\n]+/u).map(clean).filter(Boolean).map((item) => ({ item, level: '' }));
    }
  }
  return [];
}

function teacherUtilityHttpsUrl(value) {
  const url = clean(typeof value === 'string'
    ? value
    : value && (value.downloadUrl || value.url || value.secureUrl || value.publicUrl));
  return /^https:\/\//i.test(url) ? url : '';
}

function teacherUtilityIdentityUrls(sources) {
  const urls = [];
  function add(value) {
    const url = teacherUtilityHttpsUrl(value);
    if (url && !urls.includes(url) && urls.length < TEACHER_UTILITY_IDENTITY_URL_LIMIT) urls.push(url);
  }
  (sources || []).forEach((source) => {
    if (!source) return;
    ['identityUrls', 'identityFiles', 'identityDocumentUrls'].forEach((field) => {
      if (Array.isArray(source[field])) source[field].forEach(add);
    });
    add(source.identityDocumentUrl);
  });
  return urls;
}

function teacherUtilityMaskedId(value) {
  const id = clean(value).toUpperCase();
  if (!id) return '';
  if (/[*•]/u.test(id)) return id;
  if (id.length <= 5) return '*'.repeat(id.length);
  return `${id.slice(0, 1)}*****${id.slice(-4)}`;
}

function teacherUtilityProfileBundle(options) {
  const source = options || {};
  const employee = source.employee || {};
  const externalProfile = source.externalProfile || {};
  const privateProfile = source.privateProfile || {};
  // The current profile is authoritative personal data.  Contracts are immutable
  // legal snapshots and must not silently refill or overwrite the profile.
  // The current teacher profile is the only self-service personal-data source.
  // Employee and contract records may contain an older person's test data and
  // therefore must never refill a fresh profile merely because an ID was reused.
  const personalSources = [privateProfile, externalProfile];
  const lineSources = (source.bindings || []).concat([externalProfile, employee]);
  const teachingAbilities = teacherUtilityTeachingAbilities(personalSources);
  const teachingItemsText = teachingAbilities.map((item) => clean(item.item)).filter(Boolean).join('、');
  const identityUrls = teacherUtilityIdentityUrls([privateProfile, externalProfile, employee]);
  const identityFilesSource = Array.isArray(privateProfile.identityFiles)
    ? privateProfile.identityFiles
    : (Array.isArray(externalProfile.identityFiles) ? externalProfile.identityFiles : []);
  const identityFiles = identityFilesSource
    .filter((file) => clean(
      typeof file === 'string' ? file : file && (file.storagePath || file.downloadUrl || file.url)
    ));
  const rawIdNumber = teacherUtilityFirstText(personalSources, ['idNumber', 'identityNumber']);
  const storedMaskedId = teacherUtilityFirstText(personalSources, ['idNumberMasked']);
  const statusSources = [externalProfile, employee];
  const profile = {
    employeeId: clean(source.employeeId),
    name: teacherUtilityFirstText(personalSources, ['name', 'teacherName', 'displayName', 'employeeName']),
    email: normalizeEmail(teacherUtilityFirstText(personalSources, ['email', 'Email', 'loginEmail', 'contactEmail'])),
    mobilePhone: normalizePhone(teacherUtilityFirstText(personalSources, [
      'mobilePhone', 'mobile', 'phone', 'tel', 'telephone', 'contactPhone'
    ])),
    bankName: '台新國際商業銀行',
    bankAccountName: teacherUtilityFirstText(personalSources, ['bankAccountName']),
    bankAccountNumber: teacherUtilityFirstText(personalSources, ['bankAccountNumber']),
    birthDate: teacherUtilityFirstText(personalSources, ['birthDate']),
    idNumberMasked: teacherUtilityMaskedId(rawIdNumber || storedMaskedId),
    householdAddress: teacherUtilityFirstText(personalSources, ['householdAddress']),
    mailingAddress: teacherUtilityFirstText(personalSources, ['mailingAddress', 'contactAddress']),
    emergencyContact: teacherUtilityFirstText(personalSources, ['emergencyContact']),
    emergencyPhone: normalizePhone(teacherUtilityFirstText(personalSources, [
      'emergencyPhone', 'emergencyContactPhone'
    ])),
    teachingAbilities,
    teachingItemsText,
    teachingItems: teachingItemsText,
    identityUrls,
    identityDocumentUrl: identityUrls[0] || '',
    identityFileCount: Math.max(identityUrls.length, identityFiles.length),
    identityDocumentUploaded: identityUrls.length > 0 || identityFiles.length > 0,
    status: teacherUtilityFirstText(statusSources, ['status', 'profileStatus', 'externalTeacherStatus']),
    profileStatus: teacherUtilityFirstText([externalProfile], ['profileStatus', 'status']),
    progressStatus: teacherUtilityFirstText(statusSources, ['progressStatus']),
    identityPhotoStatus: teacherUtilityFirstText([externalProfile, employee], ['identityPhotoStatus']),
    identityVerificationStatus: teacherUtilityFirstText(
      [externalProfile, employee],
      ['identityVerificationStatus']
    ),
    identityDocumentVerified: [externalProfile, employee]
      .some((row) => row && row.identityDocumentVerified === true),
    onboardingUrl: teacherPortalProfileUrl(),
    lineUserId: teacherUtilityFirstText(lineSources, ['lineUserId', 'lineUid', 'lineId', 'LINEUserId']) || clean(source.sessionLineUserId),
    lineDisplayName: teacherUtilityFirstText(lineSources, ['lineDisplayName']),
    lineBindStatus: teacherUtilityFirstText(lineSources, ['lineBindStatus']),
    lineNotifyEnabled: Boolean(
      teacherUtilityFirstText(lineSources, ['lineUserId', 'lineUid', 'lineId', 'LINEUserId']) || clean(source.sessionLineUserId)
    ),
    bindingMethod: teacherUtilityFirstText(lineSources, ['bindingMethod']),
    externalTeacherProfileId: clean(externalProfile.__id)
  };
  const completenessSource = Object.assign({}, profile, {
    idNumber: rawIdNumber,
    lineUserId: profile.lineUserId
  });
  return { profile, completenessSource };
}

async function resolveTeacherUtilityEmployee(session) {
  const teacherId = clean(session && session.teacherId);
  if (!teacherId) throw new HttpsError('failed-precondition', '老師登入資料缺少老師編號，請重新登入。');
  const bindings = await authorizedBindingsForSession(session);
  if (!bindings.length) throw new HttpsError('permission-denied', '老師登入綁定已停用，請重新登入。');
  const managerLinkedEmployeeIds = [...new Set(bindings.filter((row) => row.linkedByManagerAt || row.linkedByManager)
    .map((row) => clean(row.personMasterId || row.canonicalEmployeeId)).filter(Boolean))];
  if (managerLinkedEmployeeIds.length > 1) {
    throw new HttpsError('failed-precondition', '這位老師被管理者連到多個人員主檔，請先到人員資料整理中心修正。');
  }
  const canonicalEmployeeId = managerLinkedEmployeeIds[0] || `EXT_${hash(`course-teacher:${teacherId}`).slice(0, 16)}`;
  const profileId = teacherPortalProfileId(teacherId);
  const canonicalRef = db.collection('employees').doc(canonicalEmployeeId);
  const profileRef = db.collection('externalTeacherProfiles').doc(profileId);
  const privateProfileRef = db.collection('teacherPrivateProfiles').doc(profileId);
  const legacyContractRef = db.collection('externalTeacherContracts').doc(profileId);
  const [canonicalSnapshot, profileSnapshot, privateProfileSnapshot, legacyContractSnapshot] = await Promise.all([
    canonicalRef.get(),
    profileRef.get(),
    privateProfileRef.get(),
    legacyContractRef.get()
  ]);
  const canonicalExisting = canonicalSnapshot.exists ? jsonValue(canonicalSnapshot.data() || {}) : {};
  const explicitlyLinkedByManager = managerLinkedEmployeeIds[0] === canonicalEmployeeId;
  if (canonicalSnapshot.exists && !isExternalTeacherEmployee(canonicalExisting) && !explicitlyLinkedByManager) {
    throw new HttpsError('failed-precondition', '外聘老師主檔編號發生衝突，請聯絡管理者。');
  }
  const existingProfile = profileSnapshot.exists
    ? Object.assign({ __id: profileSnapshot.id, __ref: profileRef }, jsonValue(profileSnapshot.data() || {}))
    : null;
  const existingPrivateProfile = privateProfileSnapshot.exists
    ? Object.assign({ __id: privateProfileSnapshot.id, __ref: privateProfileRef }, jsonValue(privateProfileSnapshot.data() || {}))
    : {};
  if (existingProfile && !teacherPortalProfileIsCurrent(existingProfile, teacherId, profileId)) {
    throw new HttpsError('failed-precondition', '老師資料編號發生衝突，請聯絡管理者。');
  }
  const legacyContract = legacyContractSnapshot.exists
    ? Object.assign({ __id: legacyContractSnapshot.id, __ref: legacyContractRef }, jsonValue(legacyContractSnapshot.data() || {}))
    : null;
  const legacyContractStatus = clean(legacyContract && (
    legacyContract.contractStatus || legacyContract.status || legacyContract.profileStatus
  )).toLowerCase();
  const disposableLegacyContract = Boolean(
    legacyContract &&
    teacherPortalProfileIsCurrent(legacyContract, teacherId, profileId) &&
    ['waiting_profile', 'profile_draft', 'pending_profile', ''].includes(legacyContractStatus) &&
    !clean(legacyContract.signatureUrl || legacyContract.signatureDataUrl || legacyContract.contractHtmlUrl ||
      legacyContract.signedAt || legacyContract.confirmedAt || legacyContract.approvedAt)
  );

  const lineUserId = clean(
    session.lineUserId || bindings.map((row) => row.lineUserId).find(clean)
  );
  const authenticatedEmail = bindings.map(employeeEmail).find(clean) || '';
  const authMethod = clean(session.authMethod).toLowerCase();
  const bindingMethod = lineUserId ? 'line' : 'email';
  const freshSeed = {
    id: profileId,
    teacherId: profileId,
    profileId,
    employeeId: canonicalEmployeeId,
    externalTeacherEmployeeId: canonicalEmployeeId,
    employeeRef: `employees/${canonicalEmployeeId}`,
    coursePortalTeacherId: teacherId,
    portalProfileVersion: TEACHER_PORTAL_PROFILE_VERSION,
    portalProfileSource: TEACHER_PORTAL_PROFILE_SOURCE,
    source: TEACHER_PORTAL_PROFILE_SOURCE,
    onboardingUrl: teacherPortalProfileUrl(),
    bindingMethod,
    bindingMethodLabel: bindingMethod === 'line' ? '只用 LINE' : '只用 Email',
    lineUserId,
    lineBindStatus: lineUserId ? 'bound' : 'pending',
    emailBindStatus: authMethod === 'email' || (!lineUserId && authenticatedEmail) ? 'bound' : 'pending',
    status: 'profile_draft',
    profileStatus: 'profile_draft',
    progressStatus: '等待老師填寫全新資料',
    active: true,
    updatedAt: FieldValue.serverTimestamp()
  };
  if (!existingProfile) freshSeed.createdAt = FieldValue.serverTimestamp();
  const batch = db.batch();
  if (!existingProfile) batch.set(profileRef, freshSeed, { merge: false });
  else batch.set(profileRef, {
    employeeId: canonicalEmployeeId,
    externalTeacherEmployeeId: canonicalEmployeeId,
    employeeRef: `employees/${canonicalEmployeeId}`,
    coursePortalTeacherId: teacherId,
    portalProfileVersion: TEACHER_PORTAL_PROFILE_VERSION,
    portalProfileSource: TEACHER_PORTAL_PROFILE_SOURCE,
    onboardingUrl: teacherPortalProfileUrl(),
    lineUserId,
    lineBindStatus: lineUserId ? 'bound' : clean(existingProfile.lineBindStatus || 'pending'),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  const privateSeed = {
    profileId,
    employeeId: canonicalEmployeeId,
    coursePortalTeacherId: teacherId,
    portalProfileVersion: TEACHER_PORTAL_PROFILE_VERSION,
    portalProfileSource: TEACHER_PORTAL_PROFILE_SOURCE,
    updatedAt: FieldValue.serverTimestamp()
  };
  // Move raw ID data and attachment references out of the client-readable legacy
  // profile.  The private collection is server-only under the default Firestore deny.
  if (!clean(existingPrivateProfile.idNumber) && clean(existingProfile && existingProfile.idNumber)) {
    privateSeed.idNumber = clean(existingProfile.idNumber);
  }
  if (!Array.isArray(existingPrivateProfile.identityFiles) && Array.isArray(existingProfile && existingProfile.identityFiles)) {
    privateSeed.identityFiles = existingProfile.identityFiles;
  }
  if (!Array.isArray(existingPrivateProfile.identityUrls) && Array.isArray(existingProfile && existingProfile.identityUrls)) {
    privateSeed.identityUrls = existingProfile.identityUrls;
  }
  batch.set(privateProfileRef, privateSeed, { merge: true });
  if (existingProfile && (
    clean(existingProfile.idNumber) || clean(existingProfile.identityNumber) ||
    Array.isArray(existingProfile.identityFiles) || Array.isArray(existingProfile.identityUrls)
  )) {
    batch.set(profileRef, {
      idNumber: FieldValue.delete(),
      identityNumber: FieldValue.delete(),
      identityFiles: FieldValue.delete(),
      identityUrls: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }
  // Version 2 briefly created an empty contract shell whenever the profile was
  // opened.  Only that exact unsigned shell may be removed; real contracts remain.
  if (disposableLegacyContract) batch.delete(legacyContractRef);
  bindings.forEach((row) => {
    const patch = {
      employeeId: canonicalEmployeeId,
      externalTeacherEmployeeId: canonicalEmployeeId,
      legacyTeacherId: teacherId,
      employeeRef: `employees/${canonicalEmployeeId}`,
      externalTeacherProfileId: profileId,
      portalProfileVersion: TEACHER_PORTAL_PROFILE_VERSION,
      portalProfileSource: TEACHER_PORTAL_PROFILE_SOURCE,
      linkedAt: row.linkedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    if (disposableLegacyContract && clean(row.currentExternalContractId) === profileId) {
      patch.currentExternalContractId = FieldValue.delete();
    }
    if (disposableLegacyContract && clean(row.externalTeacherContractId) === profileId) {
      patch.externalTeacherContractId = FieldValue.delete();
    }
    batch.set(row.__ref, patch, { merge: true });
  });
  // The employee master is the canonical person record.  Create it as soon as a
  // teacher has authenticated, even while the profile is still a draft.  Older
  // code deleted this row until the profile was "confirmed", which made the
  // teacher see saved data while Employee Management showed zero people.
  const seedSources = [existingPrivateProfile, existingProfile];
  const employeeSeed = {
    id: canonicalEmployeeId,
    employeeId: canonicalEmployeeId,
    identityType: clean(canonicalExisting.identityType || 'external'),
    identityLabel: clean(canonicalExisting.identityLabel || (canonicalExisting.identityType ? '' : '外聘老師')),
    employeeType: clean(canonicalExisting.employeeType || canonicalExisting.identityType || 'external'),
    role: clean(canonicalExisting.role || 'externalTeacher'),
    roles: [...new Set([].concat(Array.isArray(canonicalExisting.roles) ? canonicalExisting.roles : [], ['externalTeacher']).map(clean).filter(Boolean))],
    isExternalTeacher: true,
    active: canonicalExisting.active === true,
    accountStatus: clean(canonicalExisting.accountStatus || 'profile_draft'),
    employmentStatus: clean(canonicalExisting.employmentStatus || 'profile_draft'),
    hiddenFromActiveLists: canonicalExisting.hiddenFromActiveLists === true,
    source: 'course-portal-canonical-external-teacher',
    coursePortalTeacherCanonical: true,
    coursePortalTeacherId: teacherId,
    externalTeacherProfileId: profileId,
    portalProfileVersion: TEACHER_PORTAL_PROFILE_VERSION,
    portalProfileSource: TEACHER_PORTAL_PROFILE_SOURCE,
    personLifecycleStatus: clean(canonicalExisting.personLifecycleStatus || 'profile_draft'),
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: canonicalExisting.createdAt || FieldValue.serverTimestamp()
  };
  const seedName = teacherUtilityFirstText(seedSources, ['name', 'targetName', 'teacherName', 'displayName', 'employeeName']);
  const seedEmail = normalizeEmail(teacherUtilityFirstText(seedSources, ['email', 'Email', 'loginEmail', 'contactEmail']));
  const seedPhone = normalizePhone(teacherUtilityFirstText(seedSources, ['mobilePhone', 'mobile', 'phone', 'tel', 'telephone']));
  const currentProfileConfirmed = teacherPortalProfileStatusIsConfirmed(existingProfile);
  const employeeAlreadyEstablished = canonicalExisting.active === true;
  const maySyncProfileIntoEmployee = !employeeAlreadyEstablished || currentProfileConfirmed;
  if (maySyncProfileIntoEmployee) {
    if (seedName) employeeSeed.name = employeeSeed.displayName = seedName;
    else if (!currentProfileConfirmed) {
      employeeSeed.name = FieldValue.delete();
      employeeSeed.displayName = FieldValue.delete();
    }
    if (seedEmail) employeeSeed.email = seedEmail;
    else if (!currentProfileConfirmed) employeeSeed.email = FieldValue.delete();
    if (seedPhone) employeeSeed.mobile = employeeSeed.mobilePhone = seedPhone;
    else if (!currentProfileConfirmed) {
      employeeSeed.mobile = FieldValue.delete();
      employeeSeed.mobilePhone = FieldValue.delete();
      employeeSeed.phone = FieldValue.delete();
    }
  }
  batch.set(canonicalRef, employeeSeed, { merge: true });
  await batch.commit();

  const [profileReload, privateProfileReload, employeeReload] = await Promise.all([
    profileRef.get(),
    privateProfileRef.get(),
    canonicalRef.get()
  ]);
  const externalProfile = Object.assign(
    { __id: profileId, __ref: profileRef },
    profileReload.exists ? jsonValue(profileReload.data() || {}) : {}
  );
  const privateProfile = Object.assign(
    { __id: profileId, __ref: privateProfileRef },
    privateProfileReload.exists ? jsonValue(privateProfileReload.data() || {}) : {}
  );
  const confirmed = teacherPortalProfileStatusIsConfirmed(externalProfile);
  const employee = employeeReload.exists
    ? Object.assign(
      { __id: canonicalEmployeeId, __ref: canonicalRef },
      jsonValue(employeeReload.data() || {}),
      { employeeId: canonicalEmployeeId }
    )
    : {};
  const profileBundle = teacherUtilityProfileBundle({
    employeeId: canonicalEmployeeId,
    employee,
    externalProfile,
    privateProfile,
    bindings,
    sessionLineUserId: lineUserId
  });
  const merged = profileBundle.completenessSource;
  const missingProfileFields = externalTeacherProfileMissingFields(merged);
  const displayName = clean(merged.name || employee.name || employee.displayName) || '外聘老師';
  return {
    employeeId: canonicalEmployeeId,
    user: {
      id: canonicalEmployeeId,
      employeeId: canonicalEmployeeId,
      name: displayName,
      displayName,
      email: employeeEmail(merged),
      phone: employeePhone(merged),
      mobilePhone: employeePhone(merged),
      identityType: 'external',
      identityLabel: '外聘老師',
      employeeType: 'external',
      role: 'externalTeacher',
      isExternalTeacher: true,
      lineUserId: clean(merged.lineUserId || session.lineUserId),
      lineNotifyEnabled: Boolean(clean(merged.lineUserId || session.lineUserId)),
      accountStatus: clean(employee.accountStatus || (confirmed ? 'active' : 'pending_profile')),
      employmentStatus: clean(employee.employmentStatus || (confirmed ? 'active' : 'pending_profile')),
      legacyTeacherId: teacherId,
      coursePortalTeacherId: teacherId,
      externalTeacherProfileId: profileId,
      portalProfileId: profileId,
      portalProfileVersion: TEACHER_PORTAL_PROFILE_VERSION,
      portalProfileSource: TEACHER_PORTAL_PROFILE_SOURCE,
      portalSessionBridge: true,
      coursePortalTeacherCanonical: true,
      managerLinkedPerson: explicitlyLinkedByManager,
      employeeRecordCreated: employeeReload.exists
    },
    profile: profileBundle.profile,
    profileComplete: missingProfileFields.length === 0,
    missingProfileFields
  };
}
function teacherUtilityBoolean(value) {
  if (value === true) return true;
  return ['true', '1', 'yes', '是', '啟用', 'enabled', 'active', '上架', '已發布', '發布']
    .includes(clean(value).toLowerCase());
}

function teacherUtilityFalse(value) {
  if (value === false) return true;
  return ['false', '0', 'no', '否', '停用', 'disabled', 'inactive', '下架']
    .includes(clean(value).toLowerCase());
}

function teacherUtilityStatus(value) {
  return clean(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function teacherUtilityDeleted(row) {
  const source = row || {};
  return teacherUtilityBoolean(source.deleted || source.isDeleted) ||
    teacherUtilityFalse(source.active);
}

function teacherUtilityIdentity(resolved, session) {
  const user = resolved && resolved.user || {};
  const ids = [
    resolved && resolved.employeeId,
    user.id,
    user.employeeId,
    user.legacyTeacherId,
    session && session.teacherId
  ].map(clean).filter(Boolean);
  const emails = [user.email].map(normalizeEmail).filter(Boolean);
  return {
    ids: new Set(ids),
    emails: new Set(emails)
  };
}

function teacherUtilityRowMatches(row, identity, idFields, emailFields) {
  const source = row || {};
  const ids = (idFields || []).flatMap((field) => {
    const value = source[field];
    return Array.isArray(value) ? value : [value];
  }).map(clean).filter(Boolean);
  if (ids.some((value) => identity.ids.has(value))) return true;
  const emails = (emailFields || []).flatMap((field) => {
    const value = source[field];
    return Array.isArray(value) ? value : [value];
  }).map(normalizeEmail).filter(Boolean);
  return emails.some((value) => identity.emails.has(value));
}

function teacherUtilityContractMatchesProfile(row, resolved) {
  const user = resolved && resolved.user || {};
  const source = row || {};
  const version = Number(user.portalProfileVersion || 0);
  if (version !== TEACHER_PORTAL_PROFILE_VERSION) return true;
  const expectedProfileId = clean(user.portalProfileId || user.externalTeacherProfileId);
  const rowProfileId = clean(
    source.portalProfileId || source.externalTeacherProfileId || source.profileId
  );
  const rowProfileVersion = Number(source.portalProfileVersion || 0);
  const canBindUnscoped = clean(source.assignmentProfilePolicy) === 'canonical-profile-or-protected-person-v1';
  if (!expectedProfileId) return false;
  if (rowProfileId && rowProfileId !== expectedProfileId) return false;
  if (rowProfileVersion && rowProfileVersion !== version) return false;
  if (!rowProfileId || !rowProfileVersion) return canBindUnscoped;
  return true;
}

function teacherUtilityContractPending(row) {
  if (teacherUtilityDeleted(row)) return false;
  const status = teacherUtilityStatus(row && (
    row.status || row.assignmentStatus || row.contractStatus || row.statusLabel
  ));
  return ![
    'signed', 'submitted_pending_admin', 'active', 'confirmed', 'contract_effective',
    'archived', 'cancelled', 'canceled', 'completed', 'complete', 'done',
    'deleted', 'inactive', 'disabled', '已簽署', '已封存', '已取消', '取消', '已完成',
    '完成', '已結案', '已停用', '停用', '刪除', '作廢'
  ].includes(status);
}

function teacherUtilityTaskPending(row) {
  if (teacherUtilityDeleted(row)) return false;
  const status = teacherUtilityStatus(row && (row.status || row.taskStatus || row.statusLabel));
  return ![
    'completed', 'complete', 'done', 'approved', 'archived', 'cancelled', 'canceled', 'inactive', 'disabled',
    'deleted', 'closed', '已完成', '完成', '已核准', '核准', '已處理', '已結案',
    '已封存', '已取消', '取消', '已停用', '停用', '已刪除', '刪除', '作廢'
  ].includes(status);
}

function teacherUtilityCanonicalWorkRow(row) {
  const source = row || {};
  return clean(source.systemVersion) === 'external-teacher-work-v2' ||
    clean(source.source) === 'firestore-canonical-external-teacher-work';
}

function teacherUtilityTaskMatches(row, identity) {
  const source = row || {};
  if (clean(source.assigneeMode) === 'all_external') {
    const snapshotIds = [...new Set((Array.isArray(source.assigneeIds) ? source.assigneeIds : [])
      .map(clean).filter(Boolean))];
    if (!snapshotIds.length) return true;
    return snapshotIds.some((value) => identity.ids.has(value));
  }
  return teacherUtilityRowMatches(
    source,
    identity,
    ['assigneeId', 'employeeId', 'teacherId', 'userId', 'assigneeIds'],
    ['assigneeEmail', 'email', 'teacherEmail']
  );
}

function teacherUtilityPublishedAnnouncement(row) {
  const source = row || {};
  if (teacherUtilityDeleted(source)) return false;
  const status = teacherUtilityStatus(source.status || source.publishStatus);
  if (['draft', 'unpublished', 'archived', 'deleted', 'inactive', 'disabled', 'cancelled', 'canceled',
    '草稿', '未發布', '已下架', '下架', '已封存', '已刪除', '已停用', '已取消'
  ].includes(status)) return false;
  return teacherUtilityBoolean(source.published) || teacherUtilityBoolean(source.enabled) ||
    status === 'published';
}

function teacherUtilityArray(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value).split(/[,\s、，]+/u).map(clean).filter(Boolean);
}

function teacherUtilityAnnouncementMatches(row, identity) {
  const source = row || {};
  const targetIds = [
    source.targetEmployeeIds, source.employeeIds, source.targetTeacherIds, source.teacherIds
  ].flatMap(teacherUtilityArray);
  if (targetIds.length && !targetIds.some((value) => identity.ids.has(value))) return false;
  const targetEmails = [source.targetEmails, source.employeeEmails]
    .flatMap(teacherUtilityArray)
    .map(normalizeEmail)
    .filter(Boolean);
  if (targetEmails.length && !targetEmails.some((value) => identity.emails.has(value))) return false;
  const audience = teacherUtilityArray(
    source.audience || source.audiences || source.targetAudience || source.targetRole
  ).map((value) => teacherUtilityStatus(value));
  if (!audience.length) return true;
  return audience.some((value) => [
    'all', '全部', '全部對象', 'external', 'externalteacher', 'teacher', '外聘', '外聘老師', '老師'
  ].includes(value));
}

function teacherUtilityGoodsActive(row) {
  const source = row || {};
  if (teacherUtilityDeleted(source)) return false;
  if (source.enabled !== undefined && source.enabled !== null && source.enabled !== '') {
    return !teacherUtilityFalse(source.enabled);
  }
  const status = teacherUtilityStatus(source.status || source.stockStatus);
  return !['disabled', 'inactive', 'archived', 'deleted', '已下架', '下架', '已封存', '已刪除']
    .includes(status);
}

function teacherUtilityInquiryActive(row) {
  if (teacherUtilityDeleted(row)) return false;
  const status = teacherUtilityStatus(row && (row.status || row.replyStatus));
  return ![
    'completed', 'complete', 'done', 'closed', 'archived', 'cancelled', 'canceled', 'deleted',
    'inactive', 'disabled', '已完成', '完成', '已結案', '已取消', '取消',
    '已刪除', '刪除', '已封存', '已停用', '停用'
  ].includes(status);
}

function teacherUtilityInquiryNeedsAttention(row) {
  if (!teacherUtilityInquiryActive(row)) return false;
  const status = teacherUtilityStatus(row && (row.status || row.replyStatus));
  const waitingStatuses = [
    '', 'pending', 'waiting', 'waitingreply', '待處理', '等待回覆', '詢價中', '處理中'
  ];
  if (waitingStatuses.includes(status)) return false;
  return Boolean(
    status || clean(row && (
      row.replySummary || row.replyNote || row.replyStock || row.replyTeacherPrice || row.repliedAt
    ))
  );
}

function teacherUtilityRevision(namespace, rows, fields) {
  const tokens = (rows || []).map((row) => {
    const values = (fields || []).map((field) => {
      const value = typeof field === 'function' ? field(row) : row && row[field];
      if (Array.isArray(value)) return value.map(clean).sort().join(',');
      return asMillis(value) || clean(value);
    });
    return [clean(row && (row.__id || row.id)), ...values].join('|');
  }).sort();
  return tokens.length ? hash(`${namespace}:${JSON.stringify(tokens)}`).slice(0, 24) : '';
}

const TEACHER_UTILITY_GLOBAL_LIMIT = 500;
const TEACHER_UTILITY_PERSON_LIMIT = 250;
const TEACHER_UTILITY_IN_QUERY_LIMIT = 10;

function teacherUtilityChunks(values, size = TEACHER_UTILITY_IN_QUERY_LIMIT) {
  const rows = [...new Set((values || []).map(clean).filter(Boolean))];
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function teacherUtilityCollectQueries(collectionName, queries) {
  const results = await Promise.allSettled((queries || []).map((query) => query.get()));
  const rows = new Map();
  results.filter((result) => result.status === 'fulfilled').forEach((result) => {
    result.value.docs.forEach((doc) => {
      rows.set(doc.id, Object.assign({ __id: doc.id }, doc.data() || {}));
    });
  });
  const available = results.every((result) => result.status === 'fulfilled');
  if (!available) console.warn('[teacher utility collection unavailable]', collectionName);
  return { rows: [...rows.values()], available };
}

function teacherUtilityBoundedRows(collectionName) {
  return teacherUtilityCollectQueries(collectionName, [
    db.collection(collectionName).limit(TEACHER_UTILITY_GLOBAL_LIMIT)
  ]);
}

function teacherUtilityMatchedRows(collectionName, identity, idFields, emailFields) {
  const collection = db.collection(collectionName);
  const queries = [];
  teacherUtilityChunks([...identity.ids]).forEach((values) => {
    (idFields || []).forEach((field) => {
      queries.push(collection.where(field, 'in', values).limit(TEACHER_UTILITY_PERSON_LIMIT));
    });
  });
  teacherUtilityChunks([...identity.emails]).forEach((values) => {
    (emailFields || []).forEach((field) => {
      queries.push(collection.where(field, 'in', values).limit(TEACHER_UTILITY_PERSON_LIMIT));
    });
  });
  if (!queries.length) return Promise.resolve({ rows: [], available: true });
  return teacherUtilityCollectQueries(collectionName, queries);
}

async function teacherUtilityPendingSummary(resolved, session) {
  const identity = teacherUtilityIdentity(resolved, session);
  const collectionNames = {
    contracts: 'teacherContractAssignments',
    announcements: 'externalTeacherAnnouncementsV2',
    announcementViews: 'externalTeacherAnnouncementViewsV2',
    tasks: 'externalTeacherTasksV2',
    taskResponses: 'externalTeacherTaskResponsesV2',
    goods: 'teacherGoods',
    goodsAttention: 'teacherGoodsInquiry'
  };
  const [contractResult, announcementResult, taskResult, goodsResult, inquiryResult, announcementViewResult, taskResponseResult] = await Promise.all([
    teacherUtilityMatchedRows(
      collectionNames.contracts,
      identity,
      ['teacherId', 'employeeId', 'externalTeacherEmployeeId'],
      ['email', 'teacherEmail']
    ),
    teacherUtilityBoundedRows(collectionNames.announcements),
    teacherUtilityBoundedRows(collectionNames.tasks),
    teacherUtilityBoundedRows(collectionNames.goods),
    teacherUtilityMatchedRows(
      collectionNames.goodsAttention,
      identity,
      ['teacherId', 'userId', 'employeeId'],
      ['email', 'teacherEmail']
    ),
    teacherUtilityMatchedRows(collectionNames.announcementViews, identity, ['employeeId', 'teacherId'], []),
    teacherUtilityMatchedRows(collectionNames.taskResponses, identity, ['employeeId', 'teacherId'], [])
  ]);
  const unavailableCollections = Object.entries({
    contracts: contractResult,
    announcements: announcementResult,
    tasks: taskResult,
    goods: goodsResult,
    goodsAttention: inquiryResult,
    announcementViews: announcementViewResult,
    taskResponses: taskResponseResult
  }).filter(([, result]) => !result.available).map(([name]) => name);
  if (unavailableCollections.length) {
    console.warn('[teacher utility pending summary unavailable]', unavailableCollections.join(','));
  }

  const contracts = contractResult.rows.filter((row) =>
    teacherUtilityRowMatches(
      row,
      identity,
      ['teacherId', 'employeeId', 'externalTeacherEmployeeId', 'userId'],
      ['email', 'teacherEmail']
    ) && teacherUtilityContractMatchesProfile(row, resolved) && teacherUtilityContractPending(row)
  );
  const announcementViews = new Map(announcementViewResult.rows.map((row) => [clean(row.announcementId), row]));
  const taskResponses = new Map(taskResponseResult.rows.map((row) => [clean(row.taskId), row]));
  const announcements = announcementResult.rows.filter((row) => {
    if (!teacherUtilityCanonicalWorkRow(row) || !teacherUtilityPublishedAnnouncement(row) || !teacherUtilityAnnouncementMatches(row, identity)) return false;
    const view = announcementViews.get(clean(row.__id || row.id || row.announcementId)) || {};
    return !view.readAt || (row.requireReply === true && !clean(view.replyText));
  });
  const tasks = taskResult.rows.filter((row) => {
    if (!teacherUtilityCanonicalWorkRow(row) || !teacherUtilityTaskMatches(row, identity) || !teacherUtilityTaskPending(row)) return false;
    const response = taskResponses.get(clean(row.__id || row.id || row.taskId)) || {};
    return teacherUtilityTaskPending(response);
  });
  const goods = goodsResult.rows.filter(teacherUtilityGoodsActive);
  const inquiries = inquiryResult.rows.filter((row) =>
    teacherUtilityRowMatches(
      row,
      identity,
      ['teacherId', 'userId', 'employeeId'],
      ['email', 'teacherEmail']
    ) && teacherUtilityInquiryNeedsAttention(row)
  );
  const announcementRevision = teacherUtilityRevision('teacher-announcements', announcements, [
    'updatedAt', 'updatedAtText', 'createdAt', 'createdAtText', 'publishDate', 'title', 'audience',
    'published', 'requireReply', 'replyDeadline'
  ]);
  const goodsRevision = teacherUtilityRevision('teacher-goods', goods, [
    'updatedAt', 'updatedAtText', 'createdAt', 'createdAtText', 'name', 'itemName', 'enabled', 'status',
    'teacherPrice', 'stockStatus'
  ]);
  const goodsAttentionRevision = teacherUtilityRevision('teacher-goods-attention', inquiries, [
    'updatedAt', 'updatedAtText', 'createdAt', 'createdAtText', 'status', 'replyStatus',
    'replySummary', 'replyNote', 'replyStock', 'replyTeacherPrice', 'repliedAt'
  ]);
  const profileCount = resolved && resolved.profileComplete ? 0 : 1;
  const summary = {
    profileCount,
    contractCount: contracts.length,
    announcementCount: announcements.length,
    announcementRevision,
    taskCount: tasks.length,
    goodsCount: goods.length,
    goodsAttentionCount: inquiries.length,
    goodsRevision,
    goodsAttentionRevision,
    announcementCountMode: 'pending-unread-or-reply',
    goodsCountMode: 'active-offers',
    goodsAttentionCountMode: 'own-replied-active-inquiries',
    available: unavailableCollections.length === 0,
    unavailableSections: unavailableCollections
  };
  summary.totalCount = summary.profileCount + summary.contractCount + summary.announcementCount +
    summary.taskCount + summary.goodsCount + summary.goodsAttentionCount;
  return summary;
}

function teacherUtilityDraftText(data, key, maxLength) {
  if (!Object.prototype.hasOwnProperty.call(data || {}, key)) return undefined;
  const value = clean(data[key]);
  if (value.length > maxLength) {
    throw new HttpsError('invalid-argument', `${key} 內容過長，請縮短後再儲存。`);
  }
  return value;
}

function teacherUtilityDraftAbilities(value) {
  if (!Array.isArray(value)) return undefined;
  if (value.length > 20) throw new HttpsError('invalid-argument', '授課項目最多 20 筆。');
  return value.map((row) => {
    const subjectId = clean(row && (row.subjectId || row.id)).slice(0, 120);
    const item = clean(row && (row.item || row.name || row.subject)).slice(0, 80);
    const level = clean(row && row.level).slice(0, 30);
    return item ? { subjectId, item, level } : null;
  }).filter(Boolean);
}

function teacherUtilityIdentityImage(value) {
  const row = value || {};
  const raw = clean(row.dataUrl);
  const match = raw.match(/^data:(image\/jpeg);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw new HttpsError('invalid-argument', '身分證照片格式不正確，請重新選擇圖片。');
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) {
    throw new HttpsError('invalid-argument', '每張身分證照片需小於 4 MB。');
  }
  return {
    buffer,
    contentType: match[1].toLowerCase(),
    fileName: clean(row.fileName).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100) || 'identity.jpg',
    watermarkApplied: row.watermarkApplied === true
  };
}

function teacherUtilityPublicProfile(source) {
  const row = source || {};
  return {
    name: clean(row.name),
    mobilePhone: normalizePhone(row.mobilePhone || row.mobile || row.phone),
    email: normalizeEmail(row.email),
    birthDate: clean(row.birthDate),
    householdAddress: clean(row.householdAddress),
    mailingAddress: clean(row.mailingAddress || row.contactAddress),
    emergencyContact: clean(row.emergencyContact),
    emergencyPhone: normalizePhone(row.emergencyPhone || row.emergencyContactPhone),
    teachingAbilities: teacherUtilityDraftAbilities(row.teachingAbilities) || [],
    idNumberMasked: clean(row.idNumberMasked),
    identityFileCount: Math.max(0, Number(row.identityFileCount || 0))
  };
}

function teacherUtilityPrivateProfile(source) {
  const row = source || {};
  return {
    bankName: '台新國際商業銀行',
    bankAccountName: clean(row.bankAccountName),
    bankAccountNumber: clean(row.bankAccountNumber),
    idNumber: clean(row.idNumber || row.identityNumber),
    identityFiles: Array.isArray(row.identityFiles) ? row.identityFiles : []
  };
}

function teacherUtilityDraftProfileForDisplay(resolved, draftRow) {
  const result = Object.assign({}, resolved || {});
  const draft = draftRow || {};
  if (!draft.publicProfile || typeof draft.publicProfile !== 'object') return result;
  const official = result.profile || {};
  const proposed = draft.publicProfile || {};
  const privateDraft = draft.privateProfile || {};
  result.profile = Object.assign({}, official, proposed, {
    bankAccountName: clean(privateDraft.bankAccountName || official.bankAccountName),
    bankAccountNumber: clean(privateDraft.bankAccountNumber || official.bankAccountNumber),
    idNumberMasked: clean(proposed.idNumberMasked || official.idNumberMasked),
    identityFileCount: Math.max(
      Number(official.identityFileCount || 0),
      Array.isArray(privateDraft.identityFiles) ? privateDraft.identityFiles.length : 0
    ),
    profileChangeStatus: clean(draft.status),
    profileChangeRequestId: clean(draft.requestId),
    profileRevisionReason: clean(draft.revisionReason)
  });
  result.profileChangePending = clean(draft.status) === 'pending_review';
  result.profileChangeRequestId = clean(draft.requestId);
  result.profileRevisionReason = clean(draft.revisionReason);
  return result;
}

async function teacherUtilityResolvedWithDraft(resolved) {
  const profileId = clean(resolved && resolved.user && resolved.user.portalProfileId);
  if (!profileId) return resolved;
  const snapshot = await db.collection(TEACHER_PROFILE_DRAFTS).doc(profileId).get();
  return snapshot.exists
    ? teacherUtilityDraftProfileForDisplay(resolved, jsonValue(snapshot.data() || {}))
    : resolved;
}

async function teacherUtilitySaveProfileDraft(data) {
  const session = await requireSession(data, ['teacher']);
  const resolved = await resolveTeacherUtilityEmployee(session);
  const profileId = clean(resolved && resolved.user && resolved.user.portalProfileId);
  if (!profileId) throw new HttpsError('failed-precondition', '找不到老師個人資料編號。');
  const employeeId = clean(resolved.employeeId);
  const profileRef = db.collection('externalTeacherProfiles').doc(profileId);
  const privateProfileRef = db.collection('teacherPrivateProfiles').doc(profileId);
  const employeeRef = db.collection('employees').doc(employeeId);
  const draftRef = db.collection(TEACHER_PROFILE_DRAFTS).doc(profileId);
  const assignmentRef = db.collection(TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION).doc(clean(session.teacherId));
  const [profileSnapshot, privateProfileSnapshot, employeeSnapshot, draftSnapshot, assignmentSnapshot] = await Promise.all([
    profileRef.get(),
    privateProfileRef.get(),
    employeeRef.get(),
    draftRef.get(),
    assignmentRef.get()
  ]);
  if (!profileSnapshot.exists) throw new HttpsError('not-found', '找不到老師個人資料。');
  const existing = jsonValue(profileSnapshot.data() || {});
  const existingPrivate = privateProfileSnapshot.exists ? jsonValue(privateProfileSnapshot.data() || {}) : {};
  const employeeExisting = employeeSnapshot.exists ? employeeSnapshot.data() || {} : {};
  const existingDraft = draftSnapshot.exists ? jsonValue(draftSnapshot.data() || {}) : {};
  if (!teacherPortalProfileIsCurrent(Object.assign({ __id: profileId }, existing), session.teacherId, profileId)) {
    throw new HttpsError('permission-denied', '這筆個人資料不屬於目前登入的老師。');
  }
  if (clean(existingDraft.status) === 'pending_review') {
    throw new HttpsError('failed-precondition', '這次修改已送出主管確認；請等待處理後再繼續修改。');
  }

  const currentConfirmed = teacherPortalProfileStatusIsConfirmed(existing);
  const employeeConfirmed = employeeExisting.active === true ||
    teacherPortalProfileStatusIsConfirmed(employeeExisting) || currentConfirmed;
  const officialSnapshot = profileDraftSnapshot(existing, existingPrivate);
  const publicDraft = Object.assign(
    {},
    teacherUtilityPublicProfile(existing),
    existingDraft.publicProfile && typeof existingDraft.publicProfile === 'object'
      ? existingDraft.publicProfile
      : {}
  );
  const privateDraft = Object.assign(
    {},
    teacherUtilityPrivateProfile(existingPrivate),
    existingDraft.privateProfile && typeof existingDraft.privateProfile === 'object'
      ? existingDraft.privateProfile
      : {}
  );

  const textFields = [
    ['name', 80], ['mobilePhone', 30], ['email', 160],
    ['birthDate', 20], ['householdAddress', 240], ['mailingAddress', 240],
    ['emergencyContact', 80], ['emergencyPhone', 30]
  ];
  textFields.forEach(([key, maxLength]) => {
    const value = teacherUtilityDraftText(data, key, maxLength);
    if (value === undefined) return;
    publicDraft[key] = key === 'email' ? normalizeEmail(value) : value;
  });
  if (Object.hasOwn(data, 'bankAccountNumber') || Object.hasOwn(data, 'bankAccountName')) {
    const account = String(data.bankAccountNumber == null ? privateDraft.bankAccountNumber || '' : data.bankAccountNumber);
    const name = clean(data.bankAccountName == null ? privateDraft.bankAccountName : data.bankAccountName);
    if (account && !/^[0-9]{1,30}$/.test(account)) throw new HttpsError('invalid-argument', '銀行帳號只接受數字，不可含空格或符號。');
    if ((account || name) && (account !== privateDraft.bankAccountNumber || name !== privateDraft.bankAccountName) && data.bankConfirmed !== true) throw new HttpsError('failed-precondition', '請再次核對戶名及帳號。');
    privateDraft.bankName = '台新國際商業銀行';
    privateDraft.bankAccountName = name;
    privateDraft.bankAccountNumber = account;
  }
  publicDraft.mobilePhone = normalizePhone(publicDraft.mobilePhone);
  publicDraft.emergencyPhone = normalizePhone(publicDraft.emergencyPhone);
  if (Object.prototype.hasOwnProperty.call(data || {}, 'idNumber')) {
    privateDraft.idNumber = clean(data.idNumber).toUpperCase().replace(/\s+/g, '');
    if (privateDraft.idNumber && !/^[A-Z0-9-]{6,30}$/.test(privateDraft.idNumber)) {
      throw new HttpsError('invalid-argument', '身分證字號格式不正確。');
    }
    publicDraft.idNumberMasked = teacherUtilityMaskedId(privateDraft.idNumber);
  }
  if (publicDraft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicDraft.email)) {
    throw new HttpsError('invalid-argument', 'Email 格式不正確。');
  }
  let teachingAbilities = teacherUtilityDraftAbilities(data && data.teachingAbilities);
  let subjectPlan = null;
  if (teachingAbilities !== undefined) {
    subjectPlan = await prepareTeachingAbilitySubjects({
      db,
      FieldValue,
      abilities: teachingAbilities,
      approveNew: false,
      profileId,
      teacherId: clean(session.teacherId),
      employeeId,
      source: 'teacher-profile-subject-suggestion',
      nowText: nowText()
    });
    teachingAbilities = subjectPlan.abilities;
    publicDraft.teachingAbilities = teachingAbilities;
  }

  const incomingImages = Array.isArray(data && data.identityImages) ? data.identityImages : [];
  if (incomingImages.length > 2) throw new HttpsError('invalid-argument', '一次最多上傳 2 張身分證照片。');
  const savedImages = [];
  for (let index = 0; index < incomingImages.length; index += 1) {
    const image = teacherUtilityIdentityImage(incomingImages[index]);
    const storagePath = `teacher-private-profiles/${profileId}/identity/${Date.now()}-${index}-${randomToken(8)}.jpg`;
    await admin.storage().bucket().file(storagePath).save(image.buffer, {
      resumable: false,
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'private, no-store, max-age=0'
      }
    });
    savedImages.push({
      storagePath,
      fileName: image.fileName.replace(/\.[^.]+$/, '') + '.jpg',
      contentType: 'image/jpeg',
      size: image.buffer.length,
      watermarkApplied: image.watermarkApplied,
      uploadedAtText: nowText()
    });
  }
  if (savedImages.length) {
    const existingFiles = Array.isArray(privateDraft.identityFiles) ? privateDraft.identityFiles : [];
    privateDraft.identityFiles = existingFiles.concat(savedImages).slice(-4);
  }
  publicDraft.identityFileCount = Array.isArray(privateDraft.identityFiles) ? privateDraft.identityFiles.length : 0;

  const preview = Object.assign({}, existing, existingPrivate, publicDraft, privateDraft, {
    lineUserId: clean(existing.lineUserId || session.lineUserId),
    identityFiles: privateDraft.identityFiles || []
  });
  const missing = externalTeacherProfileMissingFields(preview);
  const complete = missing.length === 0;
  const submitForReview = data && data.submitForReview === true;
  if (submitForReview && !complete) {
    throw new HttpsError('failed-precondition', `資料尚缺 ${missing.map((row) => row.label).join('、')}，請補齊後再送出。`);
  }
  if (employeeSnapshot.exists && !isExternalTeacherEmployee(employeeExisting)) {
    const managerLinked = resolved && resolved.user && resolved.user.managerLinkedPerson === true;
    if (!managerLinked) throw new HttpsError('failed-precondition', '外聘老師主檔編號發生衝突，請聯絡管理者。');
  }

  const assignmentPatch = subjectPlan ? profileAssignmentPatch(
    assignmentSnapshot.exists ? assignmentSnapshot.data() || {} : {},
    subjectPlan.allSubjectIds,
    {
      teacherId: clean(session.teacherId),
      employeeId,
      profileId,
      activeProfileSubjectIds: subjectPlan.subjectIds,
      source: 'teacher-self-declared-profile',
      nowText: nowText()
    },
    FieldValue
  ) : null;

  const currentStatus = clean(existing.profileStatus || existing.status).toLowerCase();
  const initialStatus = submitForReview
    ? 'pending_review'
    : (['pending_review', 'needs_revision'].includes(currentStatus) ? currentStatus : 'profile_draft');
  const nextPersonStatus = employeeConfirmed ? 'active' :
    (initialStatus === 'pending_review' ? 'pending_review' : (initialStatus === 'needs_revision' ? 'needs_revision' : 'profile_draft'));
  const employeePatch = {
    id: employeeId,
    employeeId,
    identityType: clean(employeeExisting.identityType || 'external'),
    identityLabel: clean(employeeExisting.identityLabel || (employeeExisting.identityType ? '' : '外聘老師')),
    employeeType: clean(employeeExisting.employeeType || employeeExisting.identityType || 'external'),
    role: clean(employeeExisting.role || 'externalTeacher'),
    roles: [...new Set([].concat(Array.isArray(employeeExisting.roles) ? employeeExisting.roles : [], ['externalTeacher']).map(clean).filter(Boolean))],
    isExternalTeacher: true,
    active: employeeConfirmed,
    accountStatus: employeeConfirmed ? clean(employeeExisting.accountStatus || 'active') : (nextPersonStatus === 'needs_revision' ? 'profile_draft' : nextPersonStatus),
    employmentStatus: employeeConfirmed ? clean(employeeExisting.employmentStatus || 'active') : (nextPersonStatus === 'needs_revision' ? 'profile_draft' : nextPersonStatus),
    hiddenFromActiveLists: employeeExisting.hiddenFromActiveLists === true,
    personLifecycleStatus: nextPersonStatus,
    profileReviewStatus: employeeConfirmed ? clean(employeeExisting.profileReviewStatus || 'approved') : initialStatus,
    source: 'course-portal-canonical-external-teacher',
    coursePortalTeacherCanonical: true,
    coursePortalTeacherId: clean(session.teacherId),
    externalTeacherProfileId: profileId,
    portalProfileVersion: TEACHER_PORTAL_PROFILE_VERSION,
    portalProfileSource: TEACHER_PORTAL_PROFILE_SOURCE,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: employeeExisting.createdAt || FieldValue.serverTimestamp()
  };
  if (subjectPlan) {
    employeePatch.teachingAbilities = teachingAbilities;
    employeePatch.teachingItems = teachingAbilities.map((row) => row.item).join('、');
    employeePatch.subjectIds = assignmentPatch ? assignmentPatch.effectiveSubjectIds : subjectPlan.subjectIds;
  }

  const saveBatch = db.batch();
  if (subjectPlan) {
    subjectPlan.catalogWrites.forEach((write) => {
      saveBatch.set(db.collection(SUBJECT_CATALOG_COLLECTION).doc(write.id), write.patch, { merge: true });
    });
    if (assignmentPatch) saveBatch.set(assignmentRef, assignmentPatch, { merge: true });
    saveBatch.set(profileRef, {
      teachingAbilities,
      teachingItems: teachingAbilities.map((row) => row.item).join('、'),
      teachingItemsText: teachingAbilities.map((row) => row.item).join('、'),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  if (employeeConfirmed) {
    const baselineProfile = existingDraft.baselineProfile && typeof existingDraft.baselineProfile === 'object'
      ? existingDraft.baselineProfile
      : officialSnapshot;
    const draftRow = {
      profileId,
      employeeId,
      teacherId: clean(session.teacherId),
      publicProfile: publicDraft,
      privateProfile: privateDraft,
      baselineProfile,
      status: 'draft',
      revisionReason: FieldValue.delete(),
      source: 'teacher-course-portal-profile-change-v2',
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtText: nowText(),
      createdAt: existingDraft.createdAt || FieldValue.serverTimestamp()
    };
    if (submitForReview) {
      const afterSnapshot = profileDraftSnapshot(publicDraft, privateDraft);
      const changes = profileChangeRows(baselineProfile, afterSnapshot);
      if (!changes.length) throw new HttpsError('failed-precondition', '目前資料沒有任何修改，不需要重新送出。');
      const requestRef = db.collection('profileChangeRequests').doc();
      const submittedDraftRef = db.collection(TEACHER_PROFILE_CHANGE_DRAFTS).doc(requestRef.id);
      const requestRow = {
        requestId: requestRef.id,
        profileId,
        employeeId,
        teacherId: clean(session.teacherId),
        name: clean(publicDraft.name || existing.name),
        status: '待審核',
        approvalStatus: 'pending',
        changes,
        changeCount: changes.length,
        subjectChangesAlreadyEffective: changes.some((row) => row.key === 'teachingAbilities'),
        source: 'teacher-course-portal-profile-change-v2',
        createdAt: FieldValue.serverTimestamp(),
        createdAtText: nowText(),
        updatedAt: FieldValue.serverTimestamp()
      };
      saveBatch.set(requestRef, requestRow);
      const submittedDraftRow = Object.assign({}, draftRow, {
        requestId: requestRef.id,
        status: 'pending_review',
        submittedAt: FieldValue.serverTimestamp(),
        submittedAtText: nowText()
      });
      // The editable draft uses a delete sentinel to clear a previous return
      // reason. A new immutable review snapshot cannot contain that sentinel.
      delete submittedDraftRow.revisionReason;
      saveBatch.set(submittedDraftRef, submittedDraftRow);
      draftRow.requestId = requestRef.id;
      draftRow.status = 'pending_review';
      draftRow.submittedAt = FieldValue.serverTimestamp();
      draftRow.submittedAtText = nowText();
      employeePatch.pendingProfileChangeRequestId = requestRef.id;
      employeePatch.profileChangeStatus = 'pending_review';
      employeePatch.profileChangeSubmittedAt = FieldValue.serverTimestamp();
    } else {
      employeePatch.profileChangeStatus = 'draft';
    }
    saveBatch.set(draftRef, draftRow, { merge: true });
    saveBatch.set(profileRef, {
      profileChangeStatus: submitForReview ? 'pending_review' : 'draft',
      pendingProfileChangeRequestId: submitForReview ? draftRow.requestId : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  } else {
    const initialPatch = Object.assign({}, publicDraft, {
      mobile: publicDraft.mobilePhone,
      phone: publicDraft.mobilePhone,
      teachingItems: publicDraft.teachingAbilities.map((row) => row.item).join('、'),
      teachingItemsText: publicDraft.teachingAbilities.map((row) => row.item).join('、'),
      identityPhotoStatus: publicDraft.identityFileCount ? 'uploaded' : clean(existing.identityPhotoStatus),
      status: initialStatus,
      profileStatus: initialStatus,
      progressStatus: initialStatus === 'pending_review' ? '等待管理者確認' :
        (initialStatus === 'needs_revision' ? '管理者退回補件' : '資料填寫中'),
      profileCompletedAt: complete ? (existing.profileCompletedAt || FieldValue.serverTimestamp()) : FieldValue.delete(),
      profileSubmittedAt: submitForReview ? FieldValue.serverTimestamp() : existing.profileSubmittedAt || FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtText: nowText(),
      lastSavedFrom: 'teacher-course-portal-profile-v2',
      idNumber: FieldValue.delete(),
      identityNumber: FieldValue.delete(),
      identityFiles: FieldValue.delete(),
      identityUrls: FieldValue.delete()
    });
    const initialPrivatePatch = Object.assign({}, privateDraft, {
      profileId,
      employeeId,
      coursePortalTeacherId: clean(session.teacherId),
      portalProfileVersion: TEACHER_PORTAL_PROFILE_VERSION,
      portalProfileSource: TEACHER_PORTAL_PROFILE_SOURCE,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtText: nowText()
    });
    saveBatch.set(profileRef, initialPatch, { merge: true });
    saveBatch.set(privateProfileRef, initialPrivatePatch, { merge: true });
    if (initialStatus === 'pending_review') employeePatch.profileReviewSubmittedAt = FieldValue.serverTimestamp();
  }

  if (!employeeConfirmed) {
    employeePatch.name = clean(publicDraft.name);
    employeePatch.displayName = clean(publicDraft.name);
    employeePatch.mobile = employeePhone(preview);
    employeePatch.mobilePhone = employeePhone(preview);
    employeePatch.email = employeeEmail(preview);
  }
  saveBatch.set(employeeRef, employeePatch, { merge: true });
  await saveBatch.commit();

  const refreshed = await teacherUtilityResolvedWithDraft(await resolveTeacherUtilityEmployee(session));
  return Object.assign({
    ok: true,
    savedAt: Date.now(),
    savedIdentityCount: savedImages.length,
    submittedForReview: submitForReview
  }, refreshed);
}

async function teacherUtilitySession(data) {
  const session = await requireSession(data, ['teacher']);
  const resolved = await teacherUtilityResolvedWithDraft(await resolveTeacherUtilityEmployee(session));
  const [pendingSummary, subjects] = await Promise.all([
    teacherUtilityPendingSummary(resolved, session),
    mirrorRows('subjects')
  ]);
  const subjectCatalog = subjects.filter((row) => row.active !== false).map((row) => ({
    id: sourceId(row),
    name: clean(row.name),
    sort: Number(row.sort || 0)
  })).filter((row) => row.id && row.name).sort((left, right) =>
    Number(left.sort || 0) - Number(right.sort || 0) || left.name.localeCompare(right.name, 'zh-TW')
  );
  return Object.assign({ ok: true, validatedAt: Date.now(), pendingSummary, subjectCatalog }, resolved);
}

const TEACHER_CONTRACT_SIGNABLE_STATUSES = new Set([
  '', 'pending', 'waiting_contract', 'needs_revision', 'overdue_unsigned'
]);
const TEACHER_CONTRACT_REVIEW_STATUSES = new Set(['signed', 'submitted_pending_admin']);
const TEACHER_CONTRACT_ACTIVE_STATUSES = new Set(['active', 'confirmed', 'contract_effective']);

function teacherContractStatus(row) {
  return clean(row && (row.status || row.assignmentStatus || row.contractStatus))
    .normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function teacherContractBelongsToCurrentProfile(row, resolved, session) {
  const source = row || {};
  const user = resolved && resolved.user || {};
  const profileId = clean(user.portalProfileId || user.externalTeacherProfileId);
  const profileVersion = Number(user.portalProfileVersion || 0);
  if (!profileId || profileVersion !== TEACHER_PORTAL_PROFILE_VERSION) return false;
  // 管理者可以在老師第一次開啟個人資料前先發布年度合約。這種舊指派尚未有
  // profileId/version，但仍須以受保護的 employee/teacher ID 精準命中本人；
  // 一旦指派已綁定 profile，則不允許跨 profile 或跨版本沿用。
  const assignedProfileId = clean(source.portalProfileId || source.externalTeacherProfileId);
  const assignedProfileVersion = Number(source.portalProfileVersion || 0);
  const canBindUnscoped = clean(source.assignmentProfilePolicy) === 'canonical-profile-or-protected-person-v1';
  if (assignedProfileId && assignedProfileId !== profileId) return false;
  if (assignedProfileVersion && assignedProfileVersion !== profileVersion) return false;
  if ((!assignedProfileId || !assignedProfileVersion) && !canBindUnscoped) return false;
  const expectedIds = new Set([
    clean(resolved && resolved.employeeId),
    clean(user.employeeId),
    clean(user.legacyTeacherId),
    clean(session && session.teacherId)
  ].filter(Boolean));
  const rowIds = [source.teacherId, source.employeeId, source.externalTeacherEmployeeId]
    .map(clean).filter(Boolean);
  return rowIds.some((value) => expectedIds.has(value));
}

async function teacherContractAssignmentRows(resolved, session) {
  const user = resolved && resolved.user || {};
  const profileId = clean(user.portalProfileId || user.externalTeacherProfileId);
  const employeeId = clean(resolved && resolved.employeeId);
  const teacherId = clean(session && session.teacherId);
  const collection = db.collection('teacherContractAssignments');
  const queries = [
    profileId ? collection.where('portalProfileId', '==', profileId).limit(80).get() : null,
    profileId ? collection.where('externalTeacherProfileId', '==', profileId).limit(80).get() : null,
    employeeId ? collection.where('employeeId', '==', employeeId).limit(80).get() : null,
    employeeId ? collection.where('teacherId', '==', employeeId).limit(80).get() : null,
    teacherId ? collection.where('teacherId', '==', teacherId).limit(80).get() : null
  ].filter(Boolean);
  const settled = await Promise.allSettled(queries);
  const rows = new Map();
  settled.filter((result) => result.status === 'fulfilled').forEach((result) => {
    result.value.docs.forEach((doc) => rows.set(doc.id, Object.assign({
      __id: doc.id,
      assignmentId: doc.id
    }, jsonValue(doc.data() || {}))));
  });
  if (settled.length && settled.every((result) => result.status === 'rejected')) {
    throw new HttpsError('unavailable', '合約資料暫時無法讀取，請稍後再試。');
  }
  return [...rows.values()].filter((row) =>
    teacherContractBelongsToCurrentProfile(row, resolved, session) &&
    !['archived', 'cancelled', 'canceled', 'deleted', 'void'].includes(teacherContractStatus(row))
  ).sort((left, right) =>
    clean(right.year).localeCompare(clean(left.year)) ||
    asMillis(right.publishedAt || right.updatedAt) - asMillis(left.publishedAt || left.updatedAt)
  ).slice(0, 50);
}

async function teacherContractPrivateSnapshots(rows) {
  const pairs = await Promise.all((rows || []).map(async (row) => {
    const id = clean(row.assignmentId || row.__id);
    if (!id) return [id, {}];
    const snapshot = await db.collection('teacherContractPrivateSnapshots').doc(id).get();
    return [id, snapshot.exists ? jsonValue(snapshot.data() || {}) : {}];
  }));
  return new Map(pairs);
}

function teacherContractProfileData(resolved, privateProfile) {
  const profile = resolved && resolved.profile || {};
  const teachingAbilities = Array.isArray(profile.teachingAbilities)
    ? profile.teachingAbilities.map((item) => ({
      item: clean(item && (item.item || item.name || item.subject)),
      level: clean(item && (item.level || item.degree || item.proficiency))
    })).filter((item) => item.item)
    : [];
  const teachingItemsText = teachingAbilities.map((item) =>
    item.level ? `${item.item}（${item.level}）` : item.item
  ).join('、');
  return {
    name: clean(profile.name),
    email: normalizeEmail(profile.email),
    mobilePhone: normalizePhone(profile.mobilePhone),
    birthDate: clean(profile.birthDate),
    idNumber: clean(privateProfile && (privateProfile.idNumber || privateProfile.identityNumber)),
    idNumberMasked: clean(profile.idNumberMasked),
    householdAddress: clean(profile.householdAddress),
    mailingAddress: clean(profile.mailingAddress),
    contractAddress: clean(profile.householdAddress || profile.mailingAddress),
    emergencyContact: clean(profile.emergencyContact),
    emergencyPhone: normalizePhone(profile.emergencyPhone),
    teachingAbilities,
    teachingItemsText
  };
}

function teacherContractPublicRow(row, privateSnapshot, currentProfileData) {
  const source = row || {};
  const privateRow = privateSnapshot || {};
  const signedProfile = privateRow.profileSnapshot && typeof privateRow.profileSnapshot === 'object'
    ? privateRow.profileSnapshot
    : null;
  const personalData = signedProfile || currentProfileData || {};
  return {
    assignmentId: clean(source.assignmentId || source.__id),
    contractId: clean(source.contractId || source.templateId),
    templateId: clean(source.templateId || source.contractId),
    year: clean(source.year),
    version: clean(source.version),
    contractName: clean(source.contractName || source.title || '外聘老師年度契約'),
    status: teacherContractStatus(source),
    statusLabel: clean(source.statusLabel || source.progressStatus),
    progressStatus: clean(source.progressStatus),
    revisionReason: clean(source.revisionReason),
    publishedAtText: clean(source.publishedAtText),
    submittedAtText: clean(source.submittedAtText || source.signedAtText),
    confirmedAtText: clean(source.confirmedAtText),
    contractSnapshot: source.contractSnapshot || source.signedSnapshot || {},
    personalData,
    signDate: clean(privateRow.signDate || source.signDate),
    signatureDataUrl: clean(privateRow.signatureDataUrl || source.signatureDataUrl || source.signatureUrl)
  };
}

async function teacherContractSession(data) {
  const session = await requireSession(data, ['teacher']);
  const resolved = await resolveTeacherUtilityEmployee(session);
  const profileId = clean(resolved && resolved.user && resolved.user.portalProfileId);
  const privateProfileSnapshot = profileId
    ? await db.collection('teacherPrivateProfiles').doc(profileId).get()
    : null;
  const privateProfile = privateProfileSnapshot && privateProfileSnapshot.exists
    ? jsonValue(privateProfileSnapshot.data() || {})
    : {};
  const profileData = teacherContractProfileData(resolved, privateProfile);
  const rows = await teacherContractAssignmentRows(resolved, session);
  const privateRows = await teacherContractPrivateSnapshots(rows);
  const history = rows.map((row) => teacherContractPublicRow(
    row,
    privateRows.get(clean(row.assignmentId || row.__id)),
    profileData
  ));
  const signable = history.filter((row) => TEACHER_CONTRACT_SIGNABLE_STATUSES.has(row.status));
  const waitingApproval = history.filter((row) => TEACHER_CONTRACT_REVIEW_STATUSES.has(row.status));
  const active = history.filter((row) => TEACHER_CONTRACT_ACTIVE_STATUSES.has(row.status));
  return {
    ok: true,
    profileComplete: resolved.profileComplete === true,
    missingProfileFields: resolved.missingProfileFields || [],
    profileData,
    pendingAssignments: signable,
    waitingApprovalRecords: waitingApproval,
    activeRecords: active,
    history
  };
}

function teacherContractSignature(value) {
  const raw = clean(value);
  const match = raw.match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw new HttpsError('invalid-argument', '簽名格式不正確，請清除後重新簽名。');
  const bytes = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  if (bytes.length < 150 || bytes.length > 700 * 1024) {
    throw new HttpsError('invalid-argument', '簽名內容不完整或檔案過大，請重新簽名。');
  }
  return raw;
}

async function teacherSubmitContract(data) {
  const session = await requireSession(data, ['teacher']);
  const resolved = await resolveTeacherUtilityEmployee(session);
  if (resolved.profileComplete !== true) {
    throw new HttpsError('failed-precondition', '請先完成基本資料，再進行合約簽署。');
  }
  const assignmentId = clean(data && data.assignmentId);
  if (!assignmentId) throw new HttpsError('invalid-argument', '請先選擇要簽署的合約。');
  const signatureDataUrl = teacherContractSignature(data && data.signatureDataUrl);
  const rows = await teacherContractAssignmentRows(resolved, session);
  const assignment = rows.find((row) => clean(row.assignmentId || row.__id) === assignmentId);
  if (!assignment) throw new HttpsError('permission-denied', '這筆合約不屬於目前登入的老師。');
  if (!TEACHER_CONTRACT_SIGNABLE_STATUSES.has(teacherContractStatus(assignment))) {
    throw new HttpsError('failed-precondition', '這筆合約目前不能重複送出，請重新整理。');
  }
  const profileId = clean(resolved.user && resolved.user.portalProfileId);
  const privateProfileSnapshot = await db.collection('teacherPrivateProfiles').doc(profileId).get();
  const profileData = teacherContractProfileData(
    resolved,
    privateProfileSnapshot.exists ? jsonValue(privateProfileSnapshot.data() || {}) : {}
  );
  const missing = externalTeacherProfileMissingFields(Object.assign({}, profileData, {
    lineUserId: clean(resolved.profile && resolved.profile.lineUserId),
    identityFiles: resolved.profile && resolved.profile.identityDocumentUploaded
      ? [{ storagePath: 'server-verified-private-file' }]
      : []
  }));
  if (missing.length) {
    throw new HttpsError('failed-precondition', '基本資料剛剛有變動，請先回到「我的資料」補齊後再簽署。');
  }
  const signDate = currentTaipeiDay();
  const signDateObject = new Date(`${signDate}T12:00:00+08:00`);
  const signRocYear = String(signDateObject.getFullYear() - 1911);
  const signMonth = String(signDateObject.getMonth() + 1);
  const signDay = String(signDateObject.getDate());
  const assignmentRef = db.collection('teacherContractAssignments').doc(assignmentId);
  const privateRef = db.collection('teacherContractPrivateSnapshots').doc(assignmentId);
  const logRef = db.collection('teacherContractLogs').doc(assignmentId);
  await db.runTransaction(async (transaction) => {
    const latestSnapshot = await transaction.get(assignmentRef);
    if (!latestSnapshot.exists) throw new HttpsError('not-found', '找不到這筆合約，請重新整理。');
    const latest = latestSnapshot.data() || {};
    if (!teacherContractBelongsToCurrentProfile(latest, resolved, session)) {
      throw new HttpsError('permission-denied', '這筆合約不屬於目前登入的老師。');
    }
    if (!TEACHER_CONTRACT_SIGNABLE_STATUSES.has(teacherContractStatus(latest))) {
      throw new HttpsError('failed-precondition', '這筆合約已經送出，請勿重複簽署。');
    }
    const common = {
      assignmentId,
      employeeId: clean(resolved.employeeId),
      externalTeacherEmployeeId: clean(resolved.employeeId),
      teacherId: clean(latest.teacherId || resolved.employeeId),
      portalProfileId: profileId,
      externalTeacherProfileId: profileId,
      portalProfileVersion: TEACHER_PORTAL_PROFILE_VERSION,
      status: 'submitted_pending_admin',
      statusLabel: '等待主管確認',
      progressStatus: '老師已簽署，等待主管確認',
      teacherName: profileData.name,
      email: profileData.email,
      mobilePhone: profileData.mobilePhone,
      idNumberMasked: teacherUtilityMaskedId(profileData.idNumber),
      teachingItemsText: profileData.teachingItemsText,
      signatureRecorded: true,
      signDate,
      signRocYear,
      signMonth,
      signDay,
      submittedAt: FieldValue.serverTimestamp(),
      submittedAtText: nowText(),
      signedAt: FieldValue.serverTimestamp(),
      signedAtText: nowText(),
      updatedAt: FieldValue.serverTimestamp()
    };
    transaction.set(assignmentRef, common, { merge: true });
    transaction.set(privateRef, Object.assign({}, common, {
      profileSnapshot: profileData,
      signatureDataUrl,
      contractSnapshot: latest.contractSnapshot || latest.signedSnapshot || {}
    }), { merge: true });
    transaction.set(logRef, Object.assign({}, common, {
      recordId: assignmentId,
      contractId: clean(latest.contractId || latest.templateId),
      contractName: clean(latest.contractName || latest.title),
      year: clean(latest.year),
      source: 'course-portal-teacher-contract'
    }), { merge: true });
  });
  return {
    ok: true,
    status: 'submitted_pending_admin',
    message: '合約已送出，等待主管確認。主管確認後才會正式生效。'
  };
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

async function rentalStudentOptions(session) {
  if (clean(session && session.role) !== 'student') return [];
  const bindings = await activeStudentBindingsForSession(session);
  const studentIds = [...new Set([
    ...(Array.isArray(session && session.studentIds) ? session.studentIds : []),
    ...bindings.map((row) => row.studentId)
  ].map(clean).filter(Boolean))];
  if (!studentIds.length) return [];
  const students = await mirrorRows('students');
  const studentMap = indexById(students);
  return studentIds.map((studentId) => {
    const binding = bindings.find((row) => clean(row.studentId) === studentId) || {};
    const student = studentMap[studentId] || {};
    return {
      id: studentId,
      name: safeRentalDisplayName(
        binding.name || binding.displayName || student.name || student.displayName || student.studentName
      ) || '學生',
      phone: normalizePhone(sourcePhone(student) || binding.phone)
    };
  }).sort((left, right) => clean(left.name).localeCompare(clean(right.name), 'zh-Hant'));
}

async function rentalSessionIdentity(session, requestedStudentId) {
  const role = clean(session && session.role);
  const displayNamePromise = rentalSessionDisplayName(session);
  const studentOptions = await rentalStudentOptions(session);
  const requestedId = clean(requestedStudentId);
  if (role === 'student' && requestedId && !studentOptions.some((row) => row.id === requestedId)) {
    throw new HttpsError('permission-denied', '沒有這位學生的教室租用權限。');
  }
  if (role === 'student' && studentOptions.length > 1 && !requestedId) {
    return {
      role,
      displayName: await displayNamePromise,
      clientName: '',
      clientPhone: '',
      studentId: '',
      studentOptions,
      requiresStudentSelection: true
    };
  }
  if (role === 'student') {
    const selected = studentOptions.find((row) => row.id === requestedId) || studentOptions[0] || {};
    return {
      role,
      displayName: await displayNamePromise,
      clientName: safeRentalDisplayName(selected.name) || await displayNamePromise,
      clientPhone: normalizePhone(selected.phone),
      studentId: clean(selected.id),
      studentOptions,
      requiresStudentSelection: false
    };
  }

  let clientPhone = '';
  if (role === 'renter' && clean(session && session.renterId)) {
    const renterSnapshot = await db.collection('coursePortalRenters').doc(clean(session.renterId)).get();
    const renter = renterSnapshot.exists ? renterSnapshot.data() || {} : {};
    clientPhone = normalizePhone(sourcePhone(renter));
  } else if (role === 'teacher' && clean(session && session.teacherId)) {
    const teachers = await mirrorRows('teachers');
    const teacher = teachers.find((row) => sourceId(row) === clean(session.teacherId)) || {};
    clientPhone = normalizePhone(sourcePhone(teacher));
  }
  const displayName = await displayNamePromise;
  return {
    role,
    displayName,
    clientName: displayName,
    clientPhone,
    studentId: '',
    studentOptions: [],
    requiresStudentSelection: false
  };
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

function assertTeacherMoveDuration(targetDuration, source) {
  const sourceDuration = assertPortalInterval(
    clean(source && source.startTime).slice(0, 5),
    clean(source && source.endTime).slice(0, 5)
  );
  if (Number(targetDuration) !== sourceDuration) {
    throw new HttpsError(
      'failed-precondition',
      `原課程是 ${sourceDuration} 分鐘，必須選擇可連續使用 ${sourceDuration} 分鐘的時段，不能只排 ${Number(targetDuration) || 0} 分鐘。`
    );
  }
  return sourceDuration;
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

function sameTeachingCourse(left, right) {
  if (!left || !right || isRoomRentalEvent(left) || isRoomRentalEvent(right)) return false;
  const ids = row => [...new Set(eventStudentIds(row))].sort().join('|');
  return Boolean(ids(left)) && ids(left) === ids(right) && eventTeacherId(left) === eventTeacherId(right) && eventSubjectId(left) === eventSubjectId(right);
}
function replacedTeachingOccurrence(row, changes, overlay) {
  if (normalizeScheduleStatus(row.status) === 'attended') return false;
  const winner = changes.filter(change => change.replaceMatchingCourse === true && eventDate(row) >= permanentCutover(change) && sameTeachingCourse(row, change.event))
    .sort((a,b) => permanentCutover(b).localeCompare(permanentCutover(a)) || changeOrderValue(b)-changeOrderValue(a))[0];
  if (!winner || clean(row.portalChangeId) === clean(winner.__id || winner.id)) return false;
  const owner = overlay.find(change => clean(change.__id || change.id) === clean(row.portalChangeId));
  return !owner || changeOrderValue(owner) <= changeOrderValue(winner);
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

function courseDateIsPast(date) { return !dateKey(date) || dateKey(date) < currentTaipeiDay(); }

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
    studentPaymentIds: firstArray(row, ['studentPaymentIds', 'tuitionPeriodIds', 'paymentIds']),
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
    studentPaymentIds: isOwn ? resource.studentPaymentIds : [],
    studentNames: isOwn ? resource.studentIds.map((id) => clean(maps.students[id] && maps.students[id].name)).filter(Boolean) : [],
    subjectId: resource.subjectId,
    subjectName: clean(maps.subjects[resource.subjectId] && maps.subjects[resource.subjectId].name),
    status: resource.status,
    type: resource.type,
    portalAction: resource.portalAction,
    portalChangeId: resource.portalChangeId,
    requestedRoomId: resource.requestedRoomId,
    pendingReason: resource.pendingReason,
    tuitionPeriodId: isOwn ? clean(row.tuitionPeriodId || row.periodId || row.studentPayment) : '',
    tuitionAmount: isOwn ? Number(row.tuitionAmount || row.courseAmount || row.feeAmount || row.expectedAmount || 0) : 0,
    teacherAmount: isOwn ? Number(row.teacherAmount || row.teacherPay || row.payAmount || row.specialTeacherPay || 0) : 0,
    teacherRate: isOwn ? clean(row.teacherRate || row.shareRate || row.allotRate || row.percentage) : '',
    specialLessonPrice: isOwn ? Number(row.specialLessonPrice || row.tuitionAmount || row.courseAmount || 0) : 0,
    specialTeacherPay: isOwn ? Number(row.specialTeacherPay || row.teacherAmount || row.teacherPay || 0) : 0,
    teacherPayAdjustment: isOwn ? Number(row.teacherPayAdjustment || 0) : 0,
    teacherPayAdjustmentReason: isOwn ? clean(row.teacherPayAdjustmentReason) : '',
    teacherPayable: isOwn ? row.teacherPayable !== false : false,
    specialLesson: isOwn && (row.specialLesson === true || clean(row.portalAction) === 'teacher_gift'),
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

async function reconcileStudentSuspensionsForNewSchedules(studentIds) {
  const wanted = new Set((studentIds || []).map(clean).filter(Boolean));
  if (!wanted.size) return activeStudentSuspensions();
  const suspensions = await activeStudentSuspensions();
  if (!suspensions.some(row => wanted.has(clean(row.studentId)))) return suspensions;
  const [fixedCourses, temporaryCourses, changeSnapshot] = await Promise.all([
    mirrorRows('fixedCourses'),
    mirrorRows('temporaryCourses'),
    db.collection('coursePortalScheduleChanges').where('active', '==', true).get()
  ]);
  const changes = changeSnapshot.docs.map((doc) => Object.assign({
    __id: doc.id,
    __createdAtMillis: asMillis((doc.data() || {}).createdAt)
  }, jsonValue(doc.data()) || {}));
  const reactivated = [];
  suspensions.filter((row) => wanted.has(clean(row.studentId))).forEach((suspension) => {
    const studentId = clean(suspension.studentId);
    const teacherId = clean(suspension.teacherId);
    const atStop = new Set((suspension.courseIdsAtStop || []).map(clean).filter(Boolean));
    const stoppedAt = asMillis(suspension.requestedAt);
    const hasNewMirrorCourse = [...fixedCourses, ...temporaryCourses].some((course) => {
      if (eventTeacherId(course) !== teacherId || !eventStudentIds(course).includes(studentId) || (suspension.subjectId && eventSubjectId(course) !== suspension.subjectId)) return false;
      const courseIds = courseSourceIds(course).concat(sourceId(course)).map(clean).filter(Boolean);
      if (atStop.size) return courseIds.some((id) => !atStop.has(id));
      const courseUpdatedAt = asMillis(
        course.createdAt || course.updatedAt || course.createdDate || course.updatedDate
      );
      return Boolean(stoppedAt && courseUpdatedAt > stoppedAt);
    });
    const hasNewPortalCourse = changes.some((change) =>
      ['extra_lesson', 'teacher_gift'].includes(clean(change.action)) &&
      eventTeacherId(change.event || change) === teacherId &&
      (!suspension.subjectId || eventSubjectId(change.event || change) === suspension.subjectId) &&
      eventStudentIds(change.event || change).includes(studentId) &&
      (!stoppedAt || Number(change.__createdAtMillis || 0) > stoppedAt)
    );
    if (hasNewMirrorCourse || hasNewPortalCourse) reactivated.push(suspension);
  });
  if (reactivated.length) {
    const batch = db.batch();
    reactivated.forEach((row) => batch.set(
      db.collection('coursePortalStudentSuspensions').doc(clean(row.id || row.suspensionId)),
      {
        status: 'reactivated',
        reactivatedAt: FieldValue.serverTimestamp(),
        reactivatedAtText: nowText(),
        reactivatedReason: 'new-schedule-detected',
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    ));
    batch.set(scheduleVersionRef(), {
      version: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'student-auto-reactivation'
    }, { merge: true });
    await batch.commit();
  }
  const reactivatedIds = new Set(reactivated.map((row) => clean(row.id || row.suspensionId)));
  return suspensions.filter((row) => !reactivatedIds.has(clean(row.id || row.suspensionId)));
}

function activeLearningStudentIds(studentRows, courseRows, eventRows, suspensions) {
  const activeStudents = new Set((studentRows || [])
    .filter((row) => row.__mirrorActive !== false && sourceActive(row))
    .map(sourceId)
    .filter(Boolean));
  const available = new Set();
  [...(courseRows || []), ...(eventRows || [])].forEach((course) => {
    const teacherId = eventTeacherId(course);
    eventStudentIds(course).forEach((studentId) => {
      if (!activeStudents.has(studentId)) return;
      const blocked = (suspensions || []).some((suspension) =>
        clean(suspension.studentId) === studentId &&
        clean(suspension.teacherId) === teacherId &&
        (!suspension.subjectId || clean(suspension.subjectId) === eventSubjectId(course))
      );
      if (!blocked) available.add(studentId);
    });
  });
  return available;
}

function suspensionAppliesToEvent(suspension, row) {
  const effectiveDate = dateKey(
    suspension.effectiveDate ||
    suspension.stopDate ||
    suspension.requestedAtText
  );
  return (!clean(suspension.subjectId) || clean(suspension.subjectId) === eventSubjectId(row)) && clean(suspension.teacherId) === eventTeacherId(row) &&
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

function verifiedScheduleDates(settings) {
  const quality = settings.dataQuality || {};
  return new Set([settings.auditCoveredDates, quality.auditCoveredDates, quality.futureScheduleCoveredDates]
    .flatMap(value => Array.isArray(value) ? value : []).map(dateKey).filter(Boolean));
}

function irregularPlaceholder(row, modes) {
  if (['attended','absent'].includes(normalizeScheduleStatus(row.status))) return false;
  if (['single_move','extra_lesson','teacher_gift'].includes(clean(row.portalAction || row.action))) return false;
  if (!['fixed','permanent_move'].includes(clean(row.type)) && clean(row.portalAction) !== 'permanent_move') return false;
  const ids = eventStudentIds(row).slice().sort().join('|');
  return modes.some(mode => mode.enabled !== false && eventTeacherId(row) === mode.teacherId &&
    eventSubjectId(row) === mode.subjectId && ids === mode.studentIds.slice().sort().join('|') &&
    [...(mode.intervals || []), mode].some(interval => eventDate(row) >= interval.effectiveDate && (!interval.resumedFrom || eventDate(row) < interval.resumedFrom)));
}
async function irregularRestoreMode(data, session) {
  if (!clean(data.irregularId)) return null;
  if (clean(data.action) !== 'permanent_move') throw new HttpsError('invalid-argument','請使用恢復固定排課。');
  const doc = await db.collection('coursePortalIrregularCourses').doc(clean(data.irregularId)).get();
  const mode = doc.exists && doc.data();
  if (!mode || mode.teacherId !== session.teacherId || mode.enabled === false || mode.resumedFrom) throw new HttpsError('permission-denied','這筆不定時課程已變更或不屬於您。');
  return {...jsonValue(mode), id:doc.id};
}
function irregularSource(mode, day) {
  return {...mode.source, date:day, status:'scheduled', irregularId:mode.id};
}
async function teacherSetIrregular(data) {
  const session = await requireSession(data,['teacher']);
  const day = dateKey(data.sourceDate);
  if (!day) throw new HttpsError('invalid-argument','請選擇課程。');
  const version = await readScheduleVersion();
  const bundle = await scheduleBundle(day,day,session.teacherId);
  const source = bundle.resourceEvents.find(row => row.teacherId === session.teacherId &&
    [row.id,row.sourceId].includes(clean(data.sourceEventId)));
  if (!source || isRoomRentalEvent(source) || !source.studentIds.length) throw new HttpsError('permission-denied','找不到您授課的課程。');
  const key = hash([session.teacherId,source.subjectId,...source.studentIds.slice().sort()].join('|'));
  const ref = db.collection('coursePortalIrregularCourses').doc(key);
  await db.runTransaction(async tx => {
    const [state, previous] = await Promise.all([tx.get(scheduleVersionRef()), tx.get(ref)]);
    const prior = previous.exists ? previous.data() : {};
    if (prior.enabled && !prior.resumedFrom) return;
    const intervals = [...(prior.intervals || []), ...(prior.resumedFrom ? [{effectiveDate:prior.effectiveDate,resumedFrom:prior.resumedFrom}] : [])];
    assertScheduleWritable(state);
    if (Number(state.data().version || 0) !== version) throw new HttpsError('aborted','課表剛更新，請重新操作。');
    tx.set(ref,{teacherId:session.teacherId,subjectId:source.subjectId,studentIds:source.studentIds,
      source:jsonValue(source),effectiveDate:currentTaipeiDay(),resumedFrom:'',enabled:true,intervals,
      updatedAt:FieldValue.serverTimestamp()},{merge:true});
    tx.set(scheduleVersionRef(),{version:version+1,updatedAt:FieldValue.serverTimestamp(),updatedBy:session.teacherId},{merge:true});
  });
  return {ok:true,message:'已設為不定時，已約定的單堂課與過去紀錄保留。'};
}

async function historyStudentEvents(studentId, startDate, endDate) {
  const groups = await readCourseGroups();
  const group = groups.find(row => row.active !== false && row.id === studentId);
  const ids = [...new Set([studentId, ...(group && group.memberIds || [])])];
  let snapshots;
  try {
    snapshots = await Promise.all(ids.flatMap(id => [
      db.collection(MIRROR.events).where('source.studentIds', 'array-contains', id)
        .where('source.date', '>=', startDate).where('source.date', '<=', endDate).get(),
      db.collection(MIRROR.events).where('source.studentId', '==', id)
        .where('source.date', '>=', startDate).where('source.date', '<=', endDate).get()
    ]));
  } catch (error) {
    if (![9, 'failed-precondition'].includes(error.code)) throw error;
    const rows = await mirrorRowsByDateRange('events', startDate, endDate, { includeInactive: true });
    return rows.filter(row => eventStudentIds(row).includes(studentId));
  }
  const rows = new Map();
  for (const snapshot of snapshots) for (const doc of snapshot.docs) {
    const envelope = doc.data(), source = jsonValue(envelope.source) || {};
    if (eventDate(source) < startDate || eventDate(source) > endDate) continue;
    rows.set(doc.id, {...source, __id:doc.id, __mirrorActive:envelope.sourceActive !== false,
      __mirrorUpdatedAt:asMillis(envelope.sourceUpdatedAt || envelope.updatedAt)});
  }
  return projectCourseGroups('events', [...rows.values()], groups);
}

async function scheduleBundle(startDate, endDate, ownTeacherId, options = {}) {
  const teacherHome = options.teacherHome === true && Boolean(ownTeacherId);
  const irregularSnapshot = await db.collection('coursePortalIrregularCourses').where('enabled','==',true).get();
  const irregularModes = irregularSnapshot.docs.map(doc => ({...jsonValue(doc.data()),id:doc.id}));
  const historyStudentId = clean(options.historyStudentId);
  const historyCourses = rows => historyStudentId ? rows.filter(row => eventStudentIds(row).includes(historyStudentId)) : rows;
  const [rooms, subjects, students, teachers, events, fixed, temporary, rentals, changes, suspensions, mirrorSettingsSnapshot] = await Promise.all([
    mirrorRows('rooms'),
    mirrorRows('subjects'),
    teacherHome ? Promise.resolve([]) : mirrorRows('students'),
    teacherHome ? mirrorProfilesByIds('teachers', [ownTeacherId]) : mirrorRows('teachers'),
    historyStudentId ? historyStudentEvents(historyStudentId, startDate, endDate) : mirrorRowsByDateRange('events', startDate, endDate, { includeInactive: true }),
    mirrorRows('fixedCourses').then(historyCourses),
    mirrorRowsByDateRange('temporaryCourses', startDate, endDate).then(historyCourses),
    historyStudentId ? Promise.resolve([]) : mirrorRowsByDateRange('roomRentals', startDate, endDate),
    scheduleChangeDocsByDateRange(startDate, endDate),
    activeStudentSuspensions(),
    db.collection('opsSettings').doc('injiaoyunEducationMirror').get()
  ]);
  const maps = {
    rooms: indexById(rooms),
    subjects: indexById(subjects),
    students: indexById(students),
    teachers: indexById(teachers)
  };
  const ownProfileIds = teacherHome ? [...new Set([
    ...fixed, ...temporary, ...events,
    ...changes.map(doc => (doc.data() || {}).event).filter(Boolean),
    ...irregularModes
  ].filter(row => eventTeacherId(row) === ownTeacherId).flatMap(eventStudentIds))] : [];
  const ownProfiles = teacherHome ? await mirrorProfilesByIds('students', ownProfileIds) : null;
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
  // A verified day (including an empty day) is authoritative. Old master
  // recurrence must not invent extra occurrences after the daily import.
  const mirrorSettings = mirrorSettingsSnapshot.exists ? mirrorSettingsSnapshot.data() || {} : {};
  const coveredDates = verifiedScheduleDates(mirrorSettings);
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
      if (coveredDates.has(key)) continue;
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
    return row.replaceMatchingCourse === true || activeFixedByLineage.has(lineage);
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
    !irregularPlaceholder(row, irregularModes) &&
    !replacedTeachingOccurrence(row, permanent, overlay) &&
    !removedOccurrence(row, eventDate(row)) &&
    !permanent.some((change) =>
      normalizeScheduleStatus(row.status) !== 'attended' && permanentMatchesOccurrence(change, row) &&
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
          if (row.replaceMatchingCourse && changeOrderValue(change) <= changeOrderValue(row)) return false;
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
        const inheritedStatus = row.replaceMatchingCourse ? 'scheduled' : normalizeScheduleStatus(
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
        if (irregularPlaceholder(candidate, irregularModes)) continue;
        const candidateResources = eventSharedResourceIds(candidate, maps);
        const dynamicConflict = !storedPending && eventBlocksResource(candidate) && base.find((other) =>
          !replacedTeachingOccurrence(other, permanent, overlay) &&
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
  const lessonSettings = await db.collection('coursePortalLessonSettings').get();
  const configuredBase = applyLessonSettings(base.filter(row => !replacedTeachingOccurrence(row, permanent, overlay)), lessonSettings.docs.map(doc => doc.data()));
  const validBase = configuredBase.filter(row => !irregularPlaceholder(row, irregularModes)).map((row) => applyStudentSuspensions(row, suspensions)).filter((row) =>
    row &&
    eventDate(row) >= startDate &&
    eventDate(row) <= endDate &&
    validPortalTime(eventStart(row)) &&
    validPortalTime(eventEnd(row)) &&
    timeMinutes(eventEnd(row)) > timeMinutes(eventStart(row))
  );
  if (ownProfiles) {
    students.push(...await ownProfiles);
    maps.students = indexById(students);
  }
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
    irregularModes,
    resourceConflicts: historyStudentId || teacherHome ? [] : scheduleResourceConflicts(resourceEvents),
    events: historyStudentId ? [] : validBase.filter(row => !teacherHome || eventTeacherId(row) === ownTeacherId).map((row) => publicEvent(row, maps, ownTeacherId, recurringLineages))
  };
}

async function teacherPortalData(data) {
  const session = await requireSession(data, ['teacher']);
  const start = dateKey(data.weekStart);
  if (!start) throw new HttpsError('invalid-argument', '週起始日期格式錯誤。');
  const end = addDays(start, 6);
  const month = clean(data.month).match(/^\d{4}-\d{2}$/) ? clean(data.month) : start.slice(0, 7);
  if ((data.includePayroll === true || data.payrollOnly === true) && month < TEACHER_PAYROLL_MIN_MONTH) {
    throw new HttpsError('failed-precondition', '老師薪資查詢僅開放民國 115 年 7 月起的資料。');
  }
  if (data.payrollOnly === true) {
    const monthly = await teacherPayrollMonthData(month);
    return {ok:true, payroll:monthly.teacherPayroll.filter(row => eventTeacherId(row) === session.teacherId),
      adjustments:monthly.teacherAdjustments.filter(row => eventTeacherId(row) === session.teacherId)};
  }
  const [bundle, roomSettingsSnapshot, attendanceCancellationSnapshot] = await Promise.all([
    scheduleBundle(start, end, session.teacherId, {teacherHome:true}),
    db.collection('coursePortalRoomSettings').get(),
    db.collection(ATTENDANCE_CANCELLATIONS).where('teacherId', '==', session.teacherId).get()
  ]);
  const roomSettingsMap = {};
  roomSettingsSnapshot.docs.forEach((doc) => { roomSettingsMap[doc.id] = doc.data() || {}; });
  const teacher = bundle.maps.teachers[session.teacherId];
  if (!teacher) throw new HttpsError('not-found', '找不到這個老師帳號的資料。');
  const cancellationRows = attendanceCancellationSnapshot.docs.map((doc) =>
    Object.assign({ id: doc.id }, jsonValue(doc.data()) || {})
  );
  const ownEvents = bundle.events.filter((row) => row.teacherId === session.teacherId).map((row) => {
    const request = cancellationRows.find((item) =>
      dateKey(item.date) === row.date &&
      (
        clean(item.eventId) === clean(row.sourceId || row.id) ||
        clean(item.courseId) === clean(row.fixedCourseId || row.sourceId || row.id)
      )
    );
    return Object.assign({}, row, {
      attendanceCancellationStatus: clean(request && request.status),
      attendanceCancellationId: clean(request && request.id)
    });
  });
  const stoppedStudentIds = new Set((bundle.suspensions || [])
    .filter((row) => clean(row.teacherId) === session.teacherId)
    .map((row) => clean(row.studentId))
    .filter(Boolean));
  const studentIds = [...new Set(
    [...bundle.fixedCourses, ...bundle.temporaryCourses]
      .filter((row) => eventTeacherId(row) === session.teacherId)
      .flatMap(eventStudentIds)
      .concat(ownEvents.flatMap((row) => row.studentIds))
  )].filter((studentId) => !stoppedStudentIds.has(studentId) || [...bundle.fixedCourses,...bundle.temporaryCourses].some(course => eventTeacherId(course) === session.teacherId && eventStudentIds(course).includes(studentId) && !(bundle.suspensions||[]).some(stop => stop.studentId===studentId && stop.teacherId===session.teacherId && (!stop.subjectId || stop.subjectId===eventSubjectId(course)))));
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
  const [payroll, adjustments, portalAdjustmentsSnap, portalPayrollSnap, payrollAttendance] = includePayroll
    ? await Promise.all([
      mirrorRowsByField('teacherPayroll', 'teacherId', session.teacherId),
      mirrorRowsByField('teacherAdjustments', 'teacherId', session.teacherId),
      db.collection('coursePortalTeacherAdjustments').where('teacherId','==',session.teacherId).get(),
      db.collection(ATTENDANCE_PAYROLL).where('teacherId', '==', session.teacherId).get(),
      mirrorRowsByField('attendance', 'teacherId', session.teacherId)
    ])
    : [[], [], { docs: [] }, { docs: [] }, []];
  const portalAdjustments=portalAdjustmentsSnap.docs.map(doc=>Object.assign({__id:doc.id},jsonValue(doc.data())||{}));
  const portalPayroll = portalPayrollSnap.docs
    .map((doc) => Object.assign({ __id: doc.id }, jsonValue(doc.data()) || {}));
  const result = {
    ok: true,
    loginNotice: { previousLoginAtText: clean(session.previousLoginAtText), loginAtText: clean(session.loginAtText) },
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
    events: ownEvents,
    irregularCourses: bundle.irregularModes.filter(row => row.teacherId === session.teacherId && (!row.resumedFrom || row.resumedFrom > currentTaipeiDay())),
    roster
  };
  if (includePayroll) {
    const approvedCancellations = cancellationRows.filter((row) => clean(row.status) === 'approved');
    result.payroll = mergeTeacherPayrollRows(
      enrichTeacherPayrollRows(payroll, payrollAttendance),
      portalPayroll,
      approvedCancellations.concat(portalPayroll.filter((row) => row.active === false))
    )
      .filter((row) => clean(row.month || row.payrollMonth || eventDate(row).slice(0, 7)) === month);
    result.adjustments = mergeTeacherAdjustmentRows(adjustments, portalAdjustments)
      .filter((row) => clean(row.month || row.payrollMonth || eventDate(row).slice(0, 7)) === month);
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
  const expected = tuitionNetExpectedAmount(row);
  const paid = tuitionBasePaidAmount(row);
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
  const effectiveDate = dateKey(data.effectiveDate);
  if (!effectiveDate || effectiveDate < currentTaipeiDay()) throw new HttpsError('invalid-argument', '請從今天或未來的課堂選擇停課起點。');
  assertPortalAdvanceDate(effectiveDate, '停課日期');
  const studentId = clean(data.studentId);
  assertInput(studentId, '學生');
  if (data.confirmed !== true) {
    throw new HttpsError('failed-precondition', '請先完成停課確認。');
  }
  if (!(await teacherOwnsStudent(session.teacherId, studentId))) {
    throw new HttpsError('permission-denied', '只能辦理由您授課的學生停課。');
  }
  const [students, teachers, periods, fixedCourses, temporaryCourses] = await Promise.all([
    mirrorRows('students'),
    mirrorRows('teachers'),
    mirrorRowsByField('tuitionPeriods', 'studentId', studentId),
    mirrorRows('fixedCourses'),
    mirrorRows('temporaryCourses')
  ]);
  const student = students.find((row) => sourceId(row) === studentId) || {};
  const teacher = teachers.find((row) => sourceId(row) === session.teacherId) || {};
  if (!sourceId(student)) throw new HttpsError('not-found', '找不到這位學生。');
  const ownCourses = [...fixedCourses, ...temporaryCourses].filter(row => eventTeacherId(row) === session.teacherId && eventStudentIds(row).includes(studentId));
  const subjects = [...new Set(ownCourses.map(eventSubjectId).filter(Boolean))];
  const subjectId = clean(data.subjectId) || (subjects.length === 1 ? subjects[0] : '');
  if (!subjectId || !subjects.includes(subjectId)) throw new HttpsError('invalid-argument','請從要停課的科目重新選擇課堂，再辦理停課。');
  const relatedPeriods = periods.filter(row => eventSubjectId(row) === subjectId && (!eventTeacherId(row) || eventTeacherId(row) === session.teacherId));
  const unpaidAmount = relatedPeriods.reduce((sum, row) => sum + tuitionOutstandingAmount(row), 0);
  const courseIdsAtStop = [...new Set(
    [...fixedCourses, ...temporaryCourses]
      .filter((row) =>
        eventTeacherId(row) === session.teacherId && eventSubjectId(row) === subjectId &&
        eventStudentIds(row).includes(studentId)
      )
      .flatMap((row) => courseSourceIds(row).concat(sourceId(row)))
      .map(clean)
      .filter(Boolean)
  )];
  const suspensionId = hash(`teacher-stop|${session.teacherId}|${studentId}|${subjectId}`);
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
    subjectId,
    receivableTrackingVersion: 'teacher-stop-v1',
    receivablePeriodsAtStop: [...new Map([...(existing.exists && existing.data().receivablePeriodsAtStop || []), ...relatedPeriods.filter(row => tuitionOutstandingAmount(row) > 0).map(row => ({id:sourceId(row),subjectId:eventSubjectId(row),teacherId:eventTeacherId(row),periodNo:Number(row.periodNo||0),outstandingAmount:tuitionOutstandingAmount(row)}))].map(row=>[row.id,row])).values()],
    paymentStatus: 'pending',
    status: 'active',
    studentId,
    studentName: clean(student.name),
    teacherId: session.teacherId,
    teacherName: clean(teacher.name),
    effectiveDate,
    courseIdsAtStop,
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
  assertPortalAdvanceDate(requestedStartDate, '課程日期');
  const startDate = requestedStartDate < currentTaipeiDay() ? currentTaipeiDay() : requestedStartDate;
  const exactTarget = data.exactTarget === true;
  const exactDate = exactTarget ? dateKey(data.date || data.startDate) : '';
  const exactStartTime = exactTarget ? clean(data.startTime).slice(0, 5) : '';
  if (exactTarget && (!exactDate || !validPortalTime(exactStartTime, true) || courseDateIsPast(exactDate))) {
    throw new HttpsError('invalid-argument', '請選擇今天或之後的 30 分鐘時段。');
  }
  if (exactTarget) assertPortalAdvanceDate(exactDate, '課程日期');
  const days = exactTarget ? 1 : Math.min(28, Math.max(7, Number(data.days || 14)));
  const endDate = exactTarget
    ? exactDate
    : [addDays(startDate, days - 1), portalMaximumAdvanceDate()].sort()[0];
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
  const restoreMode = await irregularRestoreMode(data, session);
  let source = restoreMode ? irregularSource(restoreMode, sourceDate) : bundle.resourceEvents.find((event) =>
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
  if (source && courseDateIsPast(source.date)) {
    throw new HttpsError('failed-precondition', '今天以前的課程不能再調課。');
  }
  const sourceStartTime = source ? source.startTime : clean(data.sourceStartTime || data.startTime).slice(0, 5);
  const sourceEndTime = source ? source.endTime : clean(data.sourceEndTime || data.endTime).slice(0, 5);
  const requestedDuration = Number(data.durationMinutes || 60);
  const duration = source
    ? assertPortalInterval(sourceStartTime, sourceEndTime)
    : requestedDuration;
  if (!Number.isFinite(duration) || duration % 30 !== 0) {
    throw new HttpsError('invalid-argument', '課程長度必須以 30 分鐘為單位。');
  }
  if (duration < 30 || duration > 300) {
    throw new HttpsError('invalid-argument', '課程長度必須介於 30 分鐘至 5 小時。');
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
  let permanentMinimumDate = '';
  let permanentMaximumDate = '';
  if (source && clean(data.action) === 'permanent_move') permanentMinimumDate = currentTaipeiDay();
  const dates = (exactTarget
    ? [exactDate]
    : Array.from(
      { length: Math.max(0, Math.round((Date.parse(`${endDate}T12:00:00+08:00`) - Date.parse(`${startDate}T12:00:00+08:00`)) / 86400000) + 1) },
      (_, offset) => addDays(startDate, offset)
    )).filter((date) =>
    (!permanentMinimumDate || date >= permanentMinimumDate) &&
    (!permanentMaximumDate || date <= permanentMaximumDate)
  );
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
      if (courseDateIsPast(date)) continue;
      const blockers = bundle.resourceEvents.filter((event) => {
        const sourceMatch = (clean(data.action) === 'permanent_move' && normalizeScheduleStatus(event.status) !== 'attended' && sameTeachingCourse(event, source)) || event.date === sourceDate && (
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
  if (courseDateIsPast(targetDate)) {
    throw new HttpsError('failed-precondition', '不可選擇今天以前的日期。');
  }
  assertPortalAdvanceDate(targetDate, '調課日期');
  if (data.roomsOnly === true) {
    const duration = Number(data.durationMinutes || 60);
    if (![30, 60, 90].includes(duration) || timeMinutes(targetStartTime) + duration > 1440) throw new HttpsError('invalid-argument', '請選擇有效的上課長度。');
    const endMinute = timeMinutes(targetStartTime) + duration;
    const endTime = String(Math.floor(endMinute / 60)).padStart(2, '0') + ':' + String(endMinute % 60).padStart(2, '0');
    const dates = Array.from({length:data.weekly === true ? 8 : 1}, (_, i) => addDays(targetDate, i * 7)).filter(day => day <= portalMaximumAdvanceDate());
    const [bundle, policy, settings] = await Promise.all([scheduleBundle(targetDate, dates[dates.length - 1], session.teacherId), rentalPolicySettings(), db.collection('coursePortalRoomSettings').get()]);
    const settingMap = Object.fromEntries(settings.docs.map(doc => [doc.id, doc.data() || {}]));
    const rooms = bundle.rooms.filter(sourceActive).filter(room => roomKind(room, settingMap[sourceId(room)] || {}) === 'normal' && roomTeacherSchedulable(room, settingMap[sourceId(room)] || {})).map(room => {
      const id = sourceId(room), setting = settingMap[id] || {};
      const checks = dates.map(date => {
        const window = businessWindow(policy, date);
        const allowed = bundle.subjects.filter(sourceActive).some(subject => roomSupportsSubject(room, sourceId(subject), bundle, setting) && roomAllowsInterval(room, setting, date, targetStartTime, endTime, sourceId(subject), 'schedule'));
        const available = !window.closed && timeMinutes(targetStartTime) >= window.startMinutes && endMinute <= window.endMinutes && allowed && !bundle.resourceEvents.some(event => event.date === date && event.roomId === id && eventBlocksResource(event) && overlaps(targetStartTime, endTime, event.startTime, event.endTime));
        return {date, available};
      });
      return {id, name:rentalRoomProfile(room, setting).publicName, checks};
    }).sort((a,b) => Number(b.checks[0].available)-Number(a.checks[0].available) || a.name.localeCompare(b.name,'zh-Hant'));
    return {ok:true, targetDate, targetStartTime, endTime, dates, rooms};
  }
  const today = currentTaipeiDay();
  const candidateStart = [today, addDays(targetDate, -7)].sort()[1];
  const candidateEnd = [addDays(candidateStart, 13), portalMaximumAdvanceDate()].sort()[0];
  const [candidateBundle, policy, roomSettingsSnapshot, activeChangeSnapshot] = await Promise.all([
    scheduleBundle(candidateStart, candidateEnd, session.teacherId),
    rentalPolicySettings(),
    db.collection('coursePortalRoomSettings').get(),
    db.collection('coursePortalScheduleChanges').where('active', '==', true).get()
  ]);
  const targetBundle = targetDate >= candidateStart && targetDate <= candidateEnd
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
      !courseDateIsPast(event.date);
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
    const lineage = clean(source.fixedCourseId || source.seriesId || source.sourceId || source.id);
    const frequencyWeeks = safeFrequencyWeeks(source.frequencyWeeks || source.intervalWeeks);
    const permanentMaximumDate = addDays(source.date, frequencyWeeks * 7 - 1);
    const futureException = activeChangeSnapshot.docs.some((doc) => {
      const row = doc.data() || {};
      if (
        clean(row.action) === 'permanent_move' &&
        permanentLineage(row) === lineage &&
        permanentCutover(row) === source.date
      ) return false;
      if (doc.id === clean(source.portalChangeId) && permanentCutover(row) < source.date) return false;
      return permanentLineage(row) === lineage &&
        permanentCutover(row) >= source.date &&
        ['single_move', 'lesson_status', 'cancel', 'permanent_move'].includes(clean(row.action));
    });
    const permanentMoveAllowed = true;
    return Object.assign(publicSource, {
      durationMinutes: duration,
      targetEndTime,
      permanentMoveAllowed,
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

function tuitionExpectedAmount(row) {
  return Math.max(0, Number(row && (
    row.expectedAmount ||
    row.tuitionAmount ||
    row.courseAmount ||
    row.feeAmount ||
    row.amount
  ) || 0));
}

function tuitionNetExpectedAmount(row) {
  const expected = tuitionExpectedAmount(row);
  const discount = Math.max(0, firstFiniteNumber(row, ['discount', 'discountAmount']) || 0);
  let discountType = clean(row && (row.discountType || row.planSnapshot && row.planSnapshot.discountType)).toLowerCase();
  if (!['ratio', 'amount'].includes(discountType)) {
    discountType = discount > 0 && discount <= 1 ? 'ratio' : 'amount';
  }
  const discountAmount = discountType === 'ratio'
    ? expected * Math.min(1, discount)
    : discount;
  return Math.max(0, expected - discountAmount);
}

function tuitionLessonCount(row) {
  return Math.max(1, Number(row && (row.lessonCount || row.totalLessons) || 4));
}

function tuitionUsedCount(row) {
  return Math.max(0, Number(row && (row.usedCount || row.attendedCount) || 0)) + Math.max(0, Number(row && row.voidedLessonCount || 0));
}

function tuitionPeriodNumber(row) {
  return Math.max(0, Number(row && (row.periodNo || row.period) || 0));
}

function firstFiniteNumber(row, fields) {
  for (const field of fields) {
    if (!row || !Object.prototype.hasOwnProperty.call(row, field)) continue;
    if (row[field] === '' || row[field] == null) continue;
    const value = Number(clean(row[field]).replace(/%$/, ''));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function roundPayrollMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new HttpsError('failed-precondition', '課程薪資金額格式錯誤，已停止簽到以避免寫入錯誤薪資。');
  }
  return Math.round(amount + Number.EPSILON);
}

function normalizeTeacherShareRatio(value) {
  const text = clean(value).replace(/%$/, '');
  const raw = Number(text);
  if (!text || !Number.isFinite(raw) || raw < 0 || raw > 100) {
    throw new HttpsError(
      'failed-precondition',
      '老師分成比例必須介於 0～100%；已停止簽到以避免寫入錯誤薪資。'
    );
  }
  return raw <= 1 ? raw : raw / 100;
}

function tuitionPeriodAvailable(row) {
  const status = clean(row && row.status).toLowerCase();
  if (row && row.active === false) return false;
  if (['cancelled', 'canceled', 'void', 'voided', 'refunded', '取消', '作廢', '退款'].includes(status)) return false;
  return tuitionUsedCount(row) < tuitionLessonCount(row);
}

function tuitionPeriodUsableIdentity(row) {
  const status = clean(row && row.status).toLowerCase();
  if (row && row.active === false) return false;
  return !['cancelled', 'canceled', 'void', 'voided', 'refunded', '取消', '作廢', '退款']
    .includes(status);
}

function attendancePeriodMatches(row, event, studentId, sourceDate, options = {}) {
  const wantedStudentId = clean(studentId);
  const wantedSubjectId = eventSubjectId(event || {});
  const wantedTeacherId = eventTeacherId(event || {});
  const lessonDate = dateKey(sourceDate || eventDate(event || {}));
  if (!tuitionPeriodUsableIdentity(row) || clean(row && row.studentId) !== wantedStudentId) return false;
  if (wantedSubjectId && clean(row.subjectId) && clean(row.subjectId) !== wantedSubjectId) return false;
  if (wantedTeacherId && eventTeacherId(row) && eventTeacherId(row) !== wantedTeacherId) return false;
  if (options.ignoreDate !== true) {
    const startDate = dateKey(row.startDate || row.paymentDate);
    const expiryDate = dateKey(row.expiryDate || row.endDate);
    if (lessonDate && startDate && startDate > lessonDate) return false;
    if (lessonDate && expiryDate && expiryDate < lessonDate) return false;
  }
  return true;
}

function newestAttendancePeriod(rows) {
  return (rows || []).slice().sort((left, right) =>
    tuitionPeriodNumber(right) - tuitionPeriodNumber(left) ||
    dateKey(right.startDate || right.paymentDate).localeCompare(dateKey(left.startDate || left.paymentDate)) ||
    sourceId(left).localeCompare(sourceId(right))
  )[0] || null;
}

function attendancePeriodCandidate(periods, event, studentId, sourceDate) {
  const wantedStudentId = clean(studentId);
  const matching = (periods || []).filter((row) => {
    return attendancePeriodMatches(row, event, wantedStudentId, sourceDate) && tuitionPeriodAvailable(row);
  });
  if (!matching.length) return null;

  const normalizedPeriodIds = (ids) => {
    const output = new Set();
    (ids || []).map(clean).filter(Boolean).forEach((id) => {
      output.add(id);
      output.add(id.replace(/^period_/, ''));
      output.add(`period_${id.replace(/^period_/, '')}`);
    });
    return output;
  };
  const rowsMatchingIds = (ids) => {
    const normalizedIds = normalizedPeriodIds(ids);
    if (!normalizedIds.size) return [];
    return matching.filter((row) =>
      normalizedIds.has(sourceId(row)) ||
      normalizedIds.has(clean(row.sourcePaymentId))
    );
  };

  const explicitByStudent = event && event.tuitionPeriodIds && typeof event.tuitionPeriodIds === 'object'
    ? clean(event.tuitionPeriodIds[wantedStudentId])
    : '';
  // tuitionPeriodIds[studentId] 是逐生保存的單一期別，可直接優先；固定課舊欄位則可能同時
  // 帶著多個歷史付款編號，仍須從其中挑選日期／期數最新且可用的期別。
  const explicitByStudentRow = newestAttendancePeriod(rowsMatchingIds([explicitByStudent]));
  if (explicitByStudentRow) return explicitByStudentRow;
  const explicitIds = [
    clean(event && (event.tuitionPeriodId || event.periodId || event.studentPayment)),
    ...firstArray(event || {}, ['studentPaymentIds', 'paymentIds'])
  ].filter(Boolean);
  const explicit = newestAttendancePeriod(rowsMatchingIds(explicitIds));
  if (explicit) return explicit;

  return newestAttendancePeriod(matching);
}

function explicitTeacherSplitFromPayroll(row) {
  const source = row || {};
  const splitType = clean(source.splitType || source.teacherSplitType || source.shareType).toLowerCase();
  let splitValue = firstFiniteNumber(source, ['splitValue']);
  if (splitType === 'fixed') {
    if (splitValue == null) {
      splitValue = firstFiniteNumber(source, ['hourlyFee', 'fixedTeacherAmount', 'teacherAmount']);
    }
    if (!Number.isFinite(splitValue) || splitValue < 0) return null;
    return { splitType: 'fixed', splitValue: roundPayrollMoney(splitValue) };
  }
  if (splitType === 'ratio') {
    if (splitValue == null) {
      splitValue = firstFiniteNumber(source, ['allotRate', 'shareRate', 'teacherShare', 'allot']);
    }
    try {
      return { splitType: 'ratio', splitValue: normalizeTeacherShareRatio(splitValue) };
    } catch (error) {
      return null;
    }
  }
  return null;
}

function explicitNoPerLessonTeacherPayPlan(row) {
  const source = row || {};
  const splitType = clean(source.splitType || source.teacherSplitType || source.shareType).toLowerCase();
  const splitValue = firstFiniteNumber(source, [
    'splitValue', 'allotRate', 'shareRate', 'teacherShare', 'allot',
    'hourlyFee', 'fixedTeacherAmount', 'teacherAmount'
  ]);
  // 舊資料的「專職 0」只是拆帳設定的一種名稱，不代表另一種老師身分。
  // 只要方案明確保存 none + 0，就視為有效的零元拆帳並原樣延續。
  return splitType === 'none' && Number.isFinite(splitValue) && splitValue === 0;
}

function teacherPayrollSplitRows(payrollRows) {
  const output = [];
  (payrollRows || []).forEach((row) => {
    if (row && row.__teacherSplitAtom === true) {
      output.push(row);
      return;
    }
    const students = row && row.payrollCalculation && Array.isArray(row.payrollCalculation.students)
      ? row.payrollCalculation.students
      : [];
    if (!students.length) {
      output.push(Object.assign({}, row, {
        __teacherSplitAtom: true,
        sourcePayrollId: sourceId(row)
      }));
      return;
    }
    students.forEach((student, index) => {
      const inputs = student && student.inputs || {};
      const outputs = student && student.outputs || {};
      const studentId = clean(student && student.studentId);
      const tuitionPeriodIds = row && row.tuitionPeriodIds ||
        row && row.payrollCalculation && row.payrollCalculation.inputs &&
          row.payrollCalculation.inputs.tuitionPeriodIds || {};
      output.push(Object.assign({}, row, {
        __teacherSplitAtom: true,
        sourcePayrollId: sourceId(row),
        id: `${sourceId(row)}-student-${studentId || index + 1}`,
        studentId,
        studentIds: studentId ? [studentId] : [],
        periodId: clean(student && student.periodId || tuitionPeriodIds && tuitionPeriodIds[studentId]),
        sourcePaymentId: clean(inputs.sourcePaymentId),
        courseId: clean(
          row.courseId ||
          row.payrollCalculation.inputs && row.payrollCalculation.inputs.courseId
        ),
        subjectId: clean(
          row.subjectId ||
          row.payrollCalculation.inputs && row.payrollCalculation.inputs.subjectId
        ),
        splitType: clean(outputs.splitType),
        splitValue: outputs.splitValue,
        allotRate: clean(outputs.splitType) === 'ratio' ? outputs.normalizedRatio || outputs.splitValue : 0,
        hourlyFee: clean(outputs.splitType) === 'fixed' ? outputs.splitValue : 0,
        teacherAmount: outputs.teacherAmount
      }));
    });
  });
  return output;
}

function normalizedTuitionLinkIds(values) {
  const output = new Set();
  (values || []).map(clean).filter(Boolean).forEach((id) => {
    const bare = id.replace(/^period_/, '');
    output.add(id);
    output.add(bare);
    output.add(`period_${bare}`);
  });
  return output;
}

function historicalTeacherSplitCandidate(payrollRows, event, studentId, period, sourceDate) {
  const wantedTeacherId = eventTeacherId(event || {});
  const wantedStudentId = clean(studentId);
  const wantedPeriodIds = normalizedTuitionLinkIds([
    sourceId(period || {}),
    period && period.sourcePaymentId,
    period && period.paymentId,
    period && period.tuitionPeriodId
  ]);
  const cutoff = dateKey(sourceDate || eventDate(event || {}));
  if (!wantedTeacherId || !wantedStudentId || !cutoff) return null;

  return teacherPayrollSplitRows(payrollRows).map((row) => {
    if (!row || row.active === false || eventTeacherId(row) !== wantedTeacherId) return null;
    const payrollInputs = row.payrollCalculation && row.payrollCalculation.inputs || {};
    const payrollKind = clean(
      row.portalAction || row.action || row.type ||
      payrollInputs.portalAction || payrollInputs.action || payrollInputs.type
    ).toLowerCase();
    if (
      row.specialLesson === true ||
      payrollInputs.specialLesson === true ||
      row.teacherPayable === false ||
      payrollInputs.teacherPayable === false ||
      payrollInputs.payrollExcluded === true ||
      ['teacher_gift', 'gift', 'free_gift', 'special_lesson'].includes(payrollKind)
    ) return null;
    if (!teacherPayrollStudentIds(row).includes(wantedStudentId)) return null;
    const rowDate = eventDate(row || {});
    if (!rowDate || rowDate >= cutoff) return null;
    const status = clean(row.status).toLowerCase();
    if (['cancelled', 'canceled', 'void', 'voided', 'rejected'].includes(status)) return null;
    const split = explicitTeacherSplitFromPayroll(row);
    if (!split) return null;

    const rowTuitionPeriodIds = row.tuitionPeriodIds && typeof row.tuitionPeriodIds === 'object'
      ? row.tuitionPeriodIds
      : {};
    const payrollTuitionPeriodIds = payrollInputs.tuitionPeriodIds &&
      typeof payrollInputs.tuitionPeriodIds === 'object'
      ? payrollInputs.tuitionPeriodIds
      : {};
    const rowPeriodIds = normalizedTuitionLinkIds([
      row.periodId,
      row.sourcePaymentId,
      row.paymentId,
      row.tuitionPeriodId,
      rowTuitionPeriodIds[wantedStudentId],
      payrollInputs.periodId,
      payrollInputs.sourcePaymentId,
      payrollInputs.paymentId,
      payrollInputs.tuitionPeriodId,
      payrollTuitionPeriodIds[wantedStudentId]
    ]);
    const periodMatch = [...rowPeriodIds].some((id) => wantedPeriodIds.has(id));
    // 舊資料的一次性／特殊課不一定有 specialLesson 標記，卻可能與正式課共用老師、學生、
    // 科目甚至固定課 ID。只有能精準連回目前學費期別／付款的歷史薪資，才可複製拆帳。
    if (!periodMatch) return null;

    return Object.assign({}, split, {
      matchedBy: 'period',
      matchRank: 4,
      payrollId: clean(row.sourcePayrollId) || sourceId(row),
      payrollDate: rowDate,
      payrollMoment: clean(row.occurredAt || row.attendedAt || row.startedAt || rowDate)
    });
  }).filter(Boolean).sort((left, right) =>
    right.matchRank - left.matchRank ||
    right.payrollMoment.localeCompare(left.payrollMoment) ||
    right.payrollId.localeCompare(left.payrollId)
  )[0] || null;
}

function periodWithHistoricalTeacherSplit(period, payrollRows, event, studentId, sourceDate) {
  const planSnapshot = jsonValue(period && period.planSnapshot || {});
  if (
    explicitTeacherSplitFromPayroll(planSnapshot) ||
    explicitNoPerLessonTeacherPayPlan(planSnapshot)
  ) return period;
  const historical = historicalTeacherSplitCandidate(
    payrollRows,
    event,
    studentId,
    period,
    sourceDate
  );
  if (!historical) return period;
  return Object.assign({}, period, {
    planSnapshot: Object.assign({}, planSnapshot, {
      splitType: historical.splitType,
      splitValue: historical.splitValue,
      splitSource: 'historical-teacher-payroll',
      historicalTeacherPayrollId: historical.payrollId,
      historicalTeacherPayrollDate: historical.payrollDate,
      historicalTeacherPayrollMatch: historical.matchedBy
    })
  });
}

function attendancePeriodPayroll(studentId, period) {
  const periodId = sourceId(period);
  const planSnapshot = jsonValue(period && period.planSnapshot || {});
  if (!periodId || !planSnapshot || typeof planSnapshot !== 'object' || !Object.keys(planSnapshot).length) {
    throw new HttpsError(
      'failed-precondition',
      '找不到這位學生課程的收費方案快照，已停止簽到；請先確認學費期別與老師拆帳設定。'
    );
  }
  const lessonCount = firstFiniteNumber(period, ['lessonCount', 'totalLessons']);
  const expectedAmount = firstFiniteNumber(period, [
    'expectedAmount', 'tuitionAmount', 'courseAmount', 'feeAmount', 'amount'
  ]);
  const planAmount = firstFiniteNumber(planSnapshot, ['amount', 'expectedAmount', 'tuitionAmount']);
  const totalAmount = expectedAmount != null && expectedAmount > 0 ? expectedAmount : planAmount;
  const discount = Math.max(0, firstFiniteNumber(period, ['discount', 'discountAmount']) || 0);
  if (!Number.isFinite(lessonCount) || lessonCount <= 0 || !Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new HttpsError(
      'failed-precondition',
      '這位學生的學費總額或課堂數未設定，已停止簽到以避免產生 NT$0 老師薪資。'
    );
  }
  let discountType = clean(period.discountType || planSnapshot.discountType).toLowerCase();
  if (!['ratio', 'amount'].includes(discountType)) {
    discountType = discount > 0 && discount <= 1 ? 'ratio' : 'amount';
  }
  const explicitTeacherPayBasis = clean(
    period.teacherPayBasis || planSnapshot.teacherPayBasis
  ).toLowerCase();
  const payByDiscountKnown = typeof period.payByDiscount === 'boolean' ||
    typeof planSnapshot.payByDiscount === 'boolean';
  const payByDiscount = typeof period.payByDiscount === 'boolean'
    ? period.payByDiscount
    : planSnapshot.payByDiscount === true;
  if (
    discount > 0 &&
    discount <= 1 &&
    !['gross', 'net'].includes(explicitTeacherPayBasis) &&
    !payByDiscountKnown
  ) {
    throw new HttpsError(
      'failed-precondition',
      '這個舊期別有折扣，但沒有保存老師按原價或折扣後金額計薪；已停止簽到，請先確認薪資基準。'
    );
  }
  const teacherPayBasis = ['gross', 'net'].includes(explicitTeacherPayBasis)
    ? explicitTeacherPayBasis
    : (payByDiscountKnown ? (payByDiscount ? 'net' : 'gross') : 'net');
  const discountAmount = discountType === 'ratio'
    ? totalAmount * Math.min(1, discount)
    : discount;
  const netTuition = Math.max(0, totalAmount - discountAmount);
  const teacherPayTuition = teacherPayBasis === 'gross' ? totalAmount : netTuition;
  const grossLessonPrice = roundPayrollMoney(totalAmount / lessonCount);
  const netLessonPrice = roundPayrollMoney(netTuition / lessonCount);
  const teacherPayLessonPrice = roundPayrollMoney(teacherPayTuition / lessonCount);
  if (teacherPayLessonPrice <= 0) {
    throw new HttpsError('failed-precondition', '本堂學費計算為 NT$0，已停止簽到；請先修正學費期別。');
  }

  const splitType = clean(
    planSnapshot.splitType || planSnapshot.teacherSplitType || planSnapshot.shareType
  ).toLowerCase();
  const noPerLessonTeacherPay = explicitNoPerLessonTeacherPayPlan(planSnapshot);
  let splitValue = firstFiniteNumber(planSnapshot, ['splitValue']);
  let normalizedRatio = 0;
  let teacherAmount = 0;
  if (splitType === 'ratio') {
    if (splitValue == null) {
      splitValue = firstFiniteNumber(planSnapshot, ['allotRate', 'shareRate', 'teacherShare', 'allot']);
    }
    normalizedRatio = normalizeTeacherShareRatio(splitValue);
    teacherAmount = roundPayrollMoney(teacherPayLessonPrice * normalizedRatio);
  } else if (splitType === 'fixed') {
    if (splitValue == null) {
      splitValue = firstFiniteNumber(planSnapshot, ['hourlyFee', 'fixedTeacherAmount', 'teacherAmount']);
    }
    if (!Number.isFinite(splitValue) || splitValue < 0) {
      throw new HttpsError(
        'failed-precondition',
        '老師每堂固定薪資不可小於 0，已停止簽到。'
      );
    }
    teacherAmount = roundPayrollMoney(splitValue);
  } else if (noPerLessonTeacherPay) {
    splitValue = 0;
    teacherAmount = 0;
  } else {
    throw new HttpsError(
      'failed-precondition',
      '這個收費方案尚未設定「比例」或「每堂固定金額」的老師拆帳，已停止簽到。'
    );
  }
  if (teacherAmount < 0) {
    throw new HttpsError('failed-precondition', '老師本堂薪資不可小於 NT$0，已停止簽到。');
  }
  return {
    studentId: clean(studentId),
    periodId,
    inputs: {
      periodNo: tuitionPeriodNumber(period),
      planId: clean(period.planId || planSnapshot.id),
      startDate: dateKey(period.startDate || period.paymentDate),
      expiryDate: dateKey(period.expiryDate || period.endDate),
      lessonCount,
      usedCount: tuitionUsedCount(period),
      expectedAmount: totalAmount,
      discount,
      discountType,
      discountAmount,
      netTuition,
      teacherPayBasis,
      teacherPayTuition,
      teacherPayable: true,
      payrollExcluded: false,
      payrollExclusionReason: '',
      planSnapshot
    },
    outputs: {
      // 簽到只認列課程與薪資；真正的實收由獨立付款交易記錄。
      lessonPrice: netLessonPrice,
      collectedAmount: 0,
      grossLessonPrice,
      netLessonPrice,
      teacherPayLessonPrice,
      splitType,
      splitValue: splitType === 'ratio' ? normalizedRatio : roundPayrollMoney(splitValue),
      sourceSplitValue: splitValue,
      normalizedRatio,
      baseTeacherAmount: teacherAmount,
      teacherAmount,
      schoolShare: roundPayrollMoney(netLessonPrice - teacherAmount),
      teacherPayable: true,
      payrollExcluded: false,
      payrollExclusionReason: ''
    }
  };
}

function attendancePayrollCalculation(event, periodRows, sourceDate) {
  const specialLesson = event && (
    event.specialLesson === true ||
    clean(event.portalAction) === 'teacher_gift' ||
    clean(event.type) === 'teacher_gift'
  );
  if (specialLesson) {
    const unpaidTeacherGift = clean(event.portalAction) === 'teacher_gift' ||
      clean(event.type) === 'teacher_gift' ||
      event.teacherPayable === false;
    const lessonPrice = roundPayrollMoney(firstFiniteNumber(event, [
      'specialLessonPrice', 'tuitionAmount', 'courseAmount'
    ]) || 0);
    const configuredTeacherAmount = roundPayrollMoney(firstFiniteNumber(event, [
      'specialTeacherPay', 'teacherAmount', 'teacherPay'
    ]) || 0);
    const baseTeacherAmount = unpaidTeacherGift ? 0 : configuredTeacherAmount;
    if (!unpaidTeacherGift && baseTeacherAmount <= 0) {
      throw new HttpsError(
        'failed-precondition',
        '贈送／特殊課程尚未設定老師薪資，已停止簽到以避免產生 NT$0 薪資。'
      );
    }
    const teacherPayAdjustment = firstFiniteNumber(event, ['teacherPayAdjustment']) || 0;
    const teacherAmount = unpaidTeacherGift
      ? 0
      : Math.max(0, roundPayrollMoney(baseTeacherAmount + teacherPayAdjustment));
    const studentIds = [...new Set(eventStudentIds(event).map(clean).filter(Boolean))];
    const rate = unpaidTeacherGift ? '老師免費贈課' : `特殊課固定 NT$${baseTeacherAmount}`;
    return {
      tuitionAmount: 0,
      lessonPrice,
      collectedAmount: 0,
      baseTeacherAmount,
      teacherPayAdjustment,
      teacherPayAdjustmentReason: clean(event.teacherPayAdjustmentReason),
      teacherAmount,
      schoolShare: 0,
      rate,
      splitType: unpaidTeacherGift ? 'none' : 'fixed',
      splitValue: baseTeacherAmount,
      allotRate: 0,
      hourlyFee: baseTeacherAmount,
      teacherPayable: !unpaidTeacherGift,
      payrollExcluded: unpaidTeacherGift,
      payrollExclusionReason: unpaidTeacherGift ? 'teacher_gift_no_pay' : '',
      periodId: '',
      planSnapshot: {},
      payrollCalculation: {
        version: 'attendance-period-payroll-v1',
        inputs: {
          date: dateKey(sourceDate || eventDate(event)),
          eventId: sourceId(event),
          courseId: clean(event.fixedCourseId || event.sourceCourseId),
          teacherId: eventTeacherId(event),
          subjectId: eventSubjectId(event),
          specialLesson: true,
          teacherPayable: !unpaidTeacherGift,
          payrollExcluded: unpaidTeacherGift,
          specialLessonPrice: lessonPrice,
          specialTeacherPay: baseTeacherAmount,
          teacherPayAdjustment,
          teacherPayAdjustmentReason: clean(event.teacherPayAdjustmentReason)
        },
        students: studentIds.map((studentId) => ({ studentId, periodId: '', specialLesson: true })),
        outputs: {
          lessonPrice,
          collectedAmount: 0,
          baseTeacherAmount,
          teacherAmount,
          schoolShare: 0,
          rate
        }
      }
    };
  }
  const students = (periodRows || []).map((row) =>
    attendancePeriodPayroll(row.studentId, row.period)
  );
  const expectedStudentIds = [...new Set(eventStudentIds(event || {}).map(clean).filter(Boolean))];
  if (!students.length || students.length !== expectedStudentIds.length) {
    throw new HttpsError(
      'failed-precondition',
      '部分學生找不到可用的學費期別，已停止簽到以避免漏扣堂數或漏算老師薪資。'
    );
  }
  const resolvedStudentIds = new Set(students.map((row) => row.studentId));
  if (expectedStudentIds.some((studentId) => !resolvedStudentIds.has(studentId))) {
    throw new HttpsError('failed-precondition', '學生期別配對不完整，已停止簽到。');
  }
  const lessonPrice = roundPayrollMoney(students.reduce((sum, row) => sum + row.outputs.lessonPrice, 0));
  const collectedAmount = roundPayrollMoney(students.reduce(
    (sum, row) => sum + row.outputs.collectedAmount,
    0
  ));
  const baseTeacherAmount = roundPayrollMoney(students.reduce(
    (sum, row) => sum + row.outputs.baseTeacherAmount,
    0
  ));
  const teacherPayAdjustment = firstFiniteNumber(event || {}, ['teacherPayAdjustment']) || 0;
  const teacherAmount = Math.max(0, roundPayrollMoney(baseTeacherAmount + teacherPayAdjustment));
  const teacherPayable = students.some((row) => row.outputs.teacherPayable !== false);
  const payrollExcluded = students.every((row) => row.outputs.payrollExcluded === true);
  // 這是本堂課的分潤，並非已收到的現金。
  const schoolShare = roundPayrollMoney(lessonPrice - teacherAmount);
  const signatures = [...new Set(students.map((row) => [
    row.outputs.splitType,
    row.outputs.splitValue
  ].join(':')))];
  const common = signatures.length === 1 ? students[0].outputs : null;
  const rate = !common
    ? '依各學生方案'
    : common.splitType === 'ratio'
      ? `${roundPayrollMoney(common.normalizedRatio * 100)}%`
      : common.splitType === 'fixed'
        ? `每堂固定 NT$${roundPayrollMoney(common.splitValue)}`
        : '每堂 NT$0';
  return {
    tuitionAmount: lessonPrice,
    lessonPrice,
    collectedAmount,
    baseTeacherAmount,
    teacherPayAdjustment,
    teacherPayAdjustmentReason: clean(event && event.teacherPayAdjustmentReason),
    teacherAmount,
    schoolShare,
    rate,
    teacherPayable,
    payrollExcluded,
    payrollExclusionReason: payrollExcluded ? 'full_time_plan_no_per_lesson_split' : '',
    splitType: common ? common.splitType : 'mixed',
    splitValue: common ? common.splitValue : 0,
    allotRate: common && common.splitType === 'ratio' ? common.normalizedRatio : 0,
    hourlyFee: common && common.splitType === 'fixed' ? common.splitValue : 0,
    periodId: students.length === 1 ? students[0].periodId : '',
    planSnapshot: students.length === 1 ? students[0].inputs.planSnapshot : {},
    payrollCalculation: {
      version: 'attendance-period-payroll-v1',
      inputs: {
        date: dateKey(sourceDate || eventDate(event || {})),
        eventId: sourceId(event || {}),
        courseId: clean(event && (event.fixedCourseId || event.sourceCourseId)),
        teacherId: eventTeacherId(event || {}),
        subjectId: eventSubjectId(event || {}),
        teacherPayable,
        payrollExcluded,
        payrollExclusionReason: payrollExcluded ? 'full_time_plan_no_per_lesson_split' : '',
        teacherPayAdjustment,
        teacherPayAdjustmentReason: clean(event && event.teacherPayAdjustmentReason)
      },
      students,
      outputs: {
        lessonPrice,
        collectedAmount,
        baseTeacherAmount,
        teacherAmount,
        schoolShare,
        rate
      }
    }
  };
}

function tuitionPaymentRequestId(sourcePeriod, studentId, nextPeriodNo) {
  return hash([
    'tuition-payment-request',
    clean(studentId),
    tuitionCourseKey(sourcePeriod),
    sourceId(sourcePeriod),
    Number(nextPeriodNo || 0)
  ].join('|'));
}

function attendanceRolloverSourcePeriod({ periods, event, studentId, sourceDate }) {
  const normalizedStudentId = clean(studentId);
  const lessonDate = dateKey(sourceDate || eventDate(event || {}));
  if (!normalizedStudentId || !lessonDate) return null;
  if (attendancePeriodCandidate(periods, event, normalizedStudentId, lessonDate)) return null;

  const looselyMatching = (periods || []).filter((row) =>
    attendancePeriodMatches(row, event, normalizedStudentId, lessonDate, { ignoreDate: true })
  );
  const wantedSubjectId = eventSubjectId(event || {});
  const wantedTeacherId = eventTeacherId(event || {});
  const sameCourse = looselyMatching.filter((row) =>
    wantedSubjectId && clean(row.subjectId) === wantedSubjectId &&
    wantedTeacherId && eventTeacherId(row) === wantedTeacherId
  );
  if (!sameCourse.length) {
    const ambiguousCompleted = looselyMatching.some((row) =>
      attendancePeriodMatches(row, event, normalizedStudentId, lessonDate) &&
      tuitionUsedCount(row) >= tuitionLessonCount(row)
    );
    if (ambiguousCompleted) {
      throw new HttpsError(
        'failed-precondition',
        '上一期沒有完整保存科目或老師編號，系統不會猜測跨科或跨師收費；請先由管理者確認期別資料。'
      );
    }
    return null;
  }
  const applicable = sameCourse.filter((row) =>
    attendancePeriodMatches(row, event, normalizedStudentId, lessonDate)
  );
  const completed = newestAttendancePeriod(applicable);
  if (!completed || tuitionUsedCount(completed) < tuitionLessonCount(completed)) return null;

  // 若已有更新期別（例如已先收下期學費但開課日在未來），不可另外自動複製一期。
  const newestSameCourse = newestAttendancePeriod(sameCourse);
  if (newestSameCourse && sourceId(newestSameCourse) !== sourceId(completed)) return null;

  return completed;
}

function attendanceHistoricalSplitSource(periods, event, studentId, sourceDate, allowRollover) {
  const existingPeriod = attendancePeriodCandidate(periods, event, studentId, sourceDate);
  if (existingPeriod) {
    const existingPlan = existingPeriod && existingPeriod.planSnapshot || {};
    return explicitTeacherSplitFromPayroll(existingPlan) || explicitNoPerLessonTeacherPayPlan(existingPlan)
      ? null
      : existingPeriod;
  }
  if (allowRollover !== true) return null;
  const rolloverSource = attendanceRolloverSourcePeriod({
    periods,
    event,
    studentId,
    sourceDate
  });
  return rolloverSource &&
    !explicitTeacherSplitFromPayroll(rolloverSource.planSnapshot || {}) &&
    !explicitNoPerLessonTeacherPayPlan(rolloverSource.planSnapshot || {})
    ? rolloverSource
    : null;
}

function buildAttendanceTuitionRollover({ periods, event, studentId, sourceDate }) {
  const normalizedStudentId = clean(studentId);
  const lessonDate = dateKey(sourceDate || eventDate(event || {}));
  const completed = attendanceRolloverSourcePeriod({ periods, event, studentId, sourceDate });
  if (!completed) return null;

  const sourcePeriodId = sourceId(completed);
  const currentPeriodNo = tuitionPeriodNumber(completed);
  if (!sourcePeriodId || currentPeriodNo <= 0) {
    throw new HttpsError(
      'failed-precondition',
      '上一期的期別編號或期數不完整，無法安全自動延續；請先由管理者確認期別資料。'
    );
  }
  const payroll = attendancePeriodPayroll(normalizedStudentId, completed);
  const planSnapshot = jsonValue(payroll.inputs.planSnapshot || {});
  const planId = clean(completed.planId || planSnapshot.id);
  if (!planId) {
    throw new HttpsError(
      'failed-precondition',
      '上一期沒有保存收費方案編號，無法安全自動延續；請先由管理者確認方案與拆帳資料。'
    );
  }

  const nextPeriodNo = currentPeriodNo + 1;
  const currentSystemPeriodNo = Math.max(1, Number(completed.systemPeriodNo || 1));
  const nextSystemPeriodNo = currentSystemPeriodNo + 1;
  const paymentRequestId = tuitionPaymentRequestId(completed, normalizedStudentId, nextPeriodNo);
  const periodId = `portal-period-${paymentRequestId}`;
  const studentIds = eventStudentIds(event || {});
  const studentIndex = studentIds.indexOf(normalizedStudentId);
  const studentName = clean(
    event && Array.isArray(event.studentNames) && event.studentNames[studentIndex] ||
    completed.studentName
  );
  const subjectId = clean(eventSubjectId(event || {}) || completed.subjectId);
  const teacherId = clean(eventTeacherId(event || {}) || completed.teacherId);
  const subjectName = clean(event && event.subjectName || completed.subjectName || completed.subject);
  const teacherName = clean(event && event.teacherName || completed.teacherName);
  const discount = Number(payroll.inputs.discount || 0);
  const discountType = clean(payroll.inputs.discountType);
  const teacherPayBasis = clean(payroll.inputs.teacherPayBasis);
  const payByDiscount = teacherPayBasis === 'net';
  const expectedAmount = Number(payroll.inputs.expectedAmount || 0);
  const payableAmount = Number(payroll.inputs.netTuition || 0);
  const lessonCount = Number(payroll.inputs.lessonCount || 0);
  const period = {
    id: periodId,
    active: true,
    source: 'teacher-attendance-auto-renewal',
    studentId: normalizedStudentId,
    studentName,
    subjectId,
    subjectName,
    teacherId,
    teacherName,
    sourcePeriodId,
    planId,
    planSnapshot,
    periodNo: nextPeriodNo,
    systemPeriodNo: nextSystemPeriodNo,
    startDate: lessonDate,
    lessonCount,
    usedCount: 0,
    expectedAmount,
    paidAmount: 0,
    discount,
    discountType,
    teacherPayBasis,
    payByDiscount,
    status: 'active',
    paymentStatus: 'payment_due',
    paymentRequestId
  };
  const paymentRequest = {
    id: paymentRequestId,
    active: true,
    status: 'payment_due',
    studentId: normalizedStudentId,
    studentName,
    subjectId,
    subjectName,
    teacherId,
    teacherName,
    sourcePeriodId,
    targetPeriodId: periodId,
    currentPeriodNo,
    nextPeriodNo,
    currentSystemPeriodNo,
    nextSystemPeriodNo,
    triggerLessonCount: tuitionLessonCount(completed),
    lessonCount,
    expectedAmount: payableAmount,
    grossExpectedAmount: expectedAmount,
    confirmedAmount: 0,
    remainingAmount: payableAmount,
    discount,
    discountType,
    teacherPayBasis,
    payByDiscount,
    planId,
    planSnapshot,
    createdAtText: nowText(),
    trigger: 'attendance-auto-renewal'
  };
  return {
    studentId: normalizedStudentId,
    source: completed,
    period,
    paymentRequest
  };
}

function canonicalFingerprintValue(value) {
  if (Array.isArray(value)) return value.map(canonicalFingerprintValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((output, key) => {
      output[key] = canonicalFingerprintValue(value[key]);
      return output;
    }, {});
  }
  return value;
}

function financialFingerprint(value) {
  return hash(JSON.stringify(canonicalFingerprintValue(jsonValue(value) || {})));
}

function attendancePeriodFinancialFingerprint(studentId, period) {
  const payroll = attendancePeriodPayroll(clean(studentId), period || {});
  const planSnapshot = jsonValue(payroll.inputs.planSnapshot || {});
  const explicitPayByDiscount = typeof period.payByDiscount === 'boolean'
    ? period.payByDiscount
    : typeof planSnapshot.payByDiscount === 'boolean'
      ? planSnapshot.payByDiscount
      : payroll.inputs.teacherPayBasis === 'net';
  return financialFingerprint({
    lessonCount: Number(payroll.inputs.lessonCount),
    grossExpectedAmount: Number(payroll.inputs.expectedAmount),
    discount: Number(payroll.inputs.discount),
    discountType: clean(payroll.inputs.discountType),
    discountAmount: Number(payroll.inputs.discountAmount),
    netExpectedAmount: Number(payroll.inputs.netTuition),
    teacherPayBasis: clean(payroll.inputs.teacherPayBasis),
    payByDiscount: explicitPayByDiscount,
    teacherPayTuition: Number(payroll.inputs.teacherPayTuition),
    planId: clean(payroll.inputs.planId),
    planSnapshot,
    payroll: {
      grossLessonPrice: Number(payroll.outputs.grossLessonPrice),
      netLessonPrice: Number(payroll.outputs.netLessonPrice),
      teacherPayLessonPrice: Number(payroll.outputs.teacherPayLessonPrice),
      splitType: clean(payroll.outputs.splitType),
      splitValue: Number(payroll.outputs.splitValue),
      sourceSplitValue: Number(payroll.outputs.sourceSplitValue),
      normalizedRatio: Number(payroll.outputs.normalizedRatio),
      baseTeacherAmount: Number(payroll.outputs.baseTeacherAmount),
      teacherAmount: Number(payroll.outputs.teacherAmount),
      schoolShare: Number(payroll.outputs.schoolShare)
    }
  });
}

function assertAttendanceRolloverPeriod(existing, expected) {
  const same = clean(existing && existing.studentId) === clean(expected && expected.studentId) &&
    clean(existing && existing.subjectId) === clean(expected && expected.subjectId) &&
    clean(existing && existing.teacherId) === clean(expected && expected.teacherId) &&
    clean(existing && existing.sourcePeriodId) === clean(expected && expected.sourcePeriodId) &&
    clean(existing && existing.paymentRequestId) === clean(expected && expected.paymentRequestId) &&
    tuitionPeriodNumber(existing) === tuitionPeriodNumber(expected) &&
    Number(existing && existing.systemPeriodNo || 0) === Number(expected && expected.systemPeriodNo || 0) &&
    attendancePeriodFinancialFingerprint(clean(expected && expected.studentId), existing) ===
      attendancePeriodFinancialFingerprint(clean(expected && expected.studentId), expected);
  if (!same || !tuitionPeriodAvailable(existing)) {
    throw new HttpsError(
      'aborted',
      '下一期學費資料剛剛已被其他裝置更新；請重新整理後再簽到，避免重複建期或計薪。'
    );
  }
}

function paymentRequestHasValue(row, key) {
  return Boolean(row && Object.prototype.hasOwnProperty.call(row, key) && row[key] !== '' && row[key] != null);
}

function paymentRequestFinancialFieldsCompatible(existing, expected) {
  const numberFields = [
    'lessonCount', 'expectedAmount', 'grossExpectedAmount', 'discount',
    'remainingAmount', 'triggerLessonCount',
    'currentPeriodNo', 'nextPeriodNo', 'currentSystemPeriodNo', 'nextSystemPeriodNo'
  ];
  if (numberFields.some((key) =>
    paymentRequestHasValue(existing, key) && Number(existing[key]) !== Number(expected[key])
  )) return false;
  const textFields = ['discountType', 'teacherPayBasis', 'planId'];
  if (textFields.some((key) =>
    paymentRequestHasValue(existing, key) && clean(existing[key]) !== clean(expected[key])
  )) return false;
  if (
    paymentRequestHasValue(existing, 'payByDiscount') &&
    existing.payByDiscount !== expected.payByDiscount
  ) return false;
  const existingPlan = jsonValue(existing && existing.planSnapshot || {});
  if (
    existingPlan && Object.keys(existingPlan).length &&
    financialFingerprint(existingPlan) !== financialFingerprint(expected && expected.planSnapshot || {})
  ) return false;
  return true;
}

function assertAttendanceRolloverPaymentRequest(existing, expected, periodId) {
  const targetPeriodId = clean(existing && (existing.targetPeriodId || existing.formalPeriodId));
  const identityMatches = clean(existing && existing.studentId) === clean(expected && expected.studentId) &&
    clean(existing && existing.subjectId) === clean(expected && expected.subjectId) &&
    clean(existing && existing.teacherId) === clean(expected && expected.teacherId) &&
    clean(existing && existing.sourcePeriodId) === clean(expected && expected.sourcePeriodId) &&
    Number(existing && existing.nextPeriodNo || 0) === Number(expected && expected.nextPeriodNo || 0);
  const unsubmitted = existing && existing.active !== false &&
    clean(existing.status) === 'payment_due' &&
    Number(existing.confirmedAmount || 0) === 0 &&
    Number(existing.submissionRevision || 0) === 0 &&
    !clean(existing.paymentMethod) &&
    !existing.submittedAt &&
    !clean(existing.submittedAtText) &&
    !clean(existing.formalPeriodId) &&
    !existing.confirmedAt &&
    !clean(existing.confirmedAtText) &&
    !clean(existing.paymentDate) &&
    !clean(existing.transferDate) &&
    !clean(existing.transferLast5) &&
    !clean(existing.receiptStoragePath) &&
    !clean(existing.receiptContentType) &&
    !Number(existing.receiptBytes || 0);
  const safe = identityMatches && unsubmitted &&
    (!targetPeriodId || targetPeriodId === clean(periodId)) &&
    paymentRequestFinancialFieldsCompatible(existing, expected);
  if (!safe) {
    throw new HttpsError(
      'aborted',
      '下一期繳費資料已取消、送出或被其他裝置更新；請重新整理並由管理者確認後再簽到。'
    );
  }
}

function tuitionCourseKey(row) {
  const subjectId = clean(row && row.subjectId);
  const subjectName = clean(row && (row.subjectName || row.courseName || row.subject));
  if (subjectId) return subjectId;
  if (subjectName) return `subject-name:${subjectName}`;
  return `period:${sourceId(row)}`;
}

async function assignNewSystemPeriodNumbers(periods) {
  const rows = (periods || []).map((row) => Object.assign({}, row));
  if (!rows.length) return rows;
  const studentIds = [...new Set(rows.map(row => clean(row.studentId)).filter(Boolean))];
  const snapshots = await Promise.all(studentIds.map(id => db.collection(TUITION_SYSTEM_PERIODS).where('studentId', '==', id).get()));
  const snapshot = { docs: snapshots.flatMap(item => item.docs) };
  const existing = new Map(snapshot.docs.map((doc) => {
    const row = doc.data() || {};
    return [clean(row.periodId || doc.id), Object.assign({ id: doc.id }, row)];
  }));
  const groups = new Map();
  rows.forEach((row) => {
    const periodId = sourceId(row);
    const studentId = clean(row.studentId);
    if (!periodId || !studentId) return;
    const key = `${studentId}|${tuitionCourseKey(row)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  const writes = [];
  groups.forEach((groupRows, groupKey) => {
    const ordered = groupRows.slice().sort((left, right) =>
      tuitionPeriodNumber(left) - tuitionPeriodNumber(right) ||
      sourceId(left).localeCompare(sourceId(right))
    );
    ordered.forEach((row) => {
      const periodId = sourceId(row);
      const embeddedSystemPeriodNo = Math.max(0, Number(row.systemPeriodNo || 0));
      if (!periodId || !embeddedSystemPeriodNo || existing.has(periodId)) return;
      const assignment = {
        id: hash(`new-system-period|${periodId}`),
        periodId,
        studentId: clean(row.studentId),
        courseKey: tuitionCourseKey(row),
        groupKey,
        legacyPeriodNo: tuitionPeriodNumber(row),
        systemPeriodNo: embeddedSystemPeriodNo,
        createdAtText: nowText()
      };
      existing.set(periodId, assignment);
      writes.push(assignment);
    });
    const assigned = [...existing.values()].filter((row) =>
      clean(row.groupKey) === groupKey ||
      (
        clean(row.studentId) === clean(ordered[0] && ordered[0].studentId) &&
        clean(row.courseKey) === tuitionCourseKey(ordered[0] || {})
      )
    );
    const maxSystemNo = assigned.reduce((max, row) =>
      Math.max(max, Number(row.systemPeriodNo || 0)), 0);
    const maxLegacyPeriodNo = assigned.reduce((max, row) =>
      Math.max(max, Number(row.legacyPeriodNo || 0)), 0);
    const candidates = assigned.length
      ? ordered.filter((row) =>
        !existing.has(sourceId(row)) &&
        tuitionPeriodNumber(row) >= maxLegacyPeriodNo
      )
      : ordered.slice(-2);
    let nextSystemNo = maxSystemNo;
    candidates.forEach((row) => {
      const periodId = sourceId(row);
      if (existing.has(periodId)) return;
      nextSystemNo += 1;
      const assignment = {
        id: hash(`new-system-period|${periodId}`),
        periodId,
        studentId: clean(row.studentId),
        courseKey: tuitionCourseKey(row),
        groupKey,
        legacyPeriodNo: tuitionPeriodNumber(row),
        systemPeriodNo: nextSystemNo,
        createdAtText: nowText()
      };
      existing.set(periodId, assignment);
      writes.push(assignment);
    });
  });
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    writes.slice(offset, offset + 400).forEach((row) => {
      batch.set(db.collection(TUITION_SYSTEM_PERIODS).doc(row.id), Object.assign({}, row, {
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }), { merge: true });
    });
    await batch.commit();
  }
  return rows.map((row) => Object.assign({}, row, {
    systemPeriodNo: Number(existing.get(sourceId(row)) && existing.get(sourceId(row)).systemPeriodNo || 0)
  }));
}

function buildTuitionPaymentCandidates({ periods, students, subjects, teachers, studentIds }) {
  const allowed = new Set((studentIds || []).map(clean).filter(Boolean));
  const studentMap = indexById(students || []);
  const subjectMap = indexById(subjects || []);
  const teacherMap = indexById(teachers || []);
  const groups = new Map();
  (periods || []).forEach((period) => {
    const studentId = clean(period.studentId);
    if (!studentId || (allowed.size && !allowed.has(studentId))) return;
    const key = `${studentId}|${tuitionCourseKey(period)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(period);
  });
  const candidates = [];
  groups.forEach((rows) => {
    const ordered = rows.slice().sort((left, right) =>
      tuitionPeriodNumber(left) - tuitionPeriodNumber(right) ||
      sourceId(left).localeCompare(sourceId(right))
    );
    const completed = ordered.filter((row) =>
      tuitionUsedCount(row) >= tuitionLessonCount(row) &&
      tuitionPeriodNumber(row) > 0
    ).pop();
    if (!completed) return;
    const currentPeriodNo = tuitionPeriodNumber(completed);
    const existingNext = ordered.find((row) => tuitionPeriodNumber(row) > currentPeriodNo);
    if (existingNext && tuitionOutstandingAmount(existingNext) <= 0) return;
    const source = existingNext || completed;
    const amount = existingNext ? tuitionOutstandingAmount(existingNext) : tuitionNetExpectedAmount(completed);
    if (amount <= 0) return;
    const grossExpectedAmount = tuitionExpectedAmount(source);
    const discount = Math.max(0, firstFiniteNumber(source, ['discount', 'discountAmount']) || 0);
    let discountType = clean(source.discountType || source.planSnapshot && source.planSnapshot.discountType).toLowerCase();
    if (!['ratio', 'amount'].includes(discountType)) {
      discountType = discount > 0 && discount <= 1 ? 'ratio' : 'amount';
    }
    const teacherPayBasis = clean(source.teacherPayBasis || source.planSnapshot && source.planSnapshot.teacherPayBasis);
    const payByDiscount = typeof source.payByDiscount === 'boolean'
      ? source.payByDiscount
      : source.planSnapshot && typeof source.planSnapshot.payByDiscount === 'boolean'
        ? source.planSnapshot.payByDiscount
        : teacherPayBasis !== 'gross';
    const studentId = clean(completed.studentId);
    const subjectId = clean(source.subjectId || completed.subjectId);
    const teacherId = clean(source.teacherId || completed.teacherId);
    const nextPeriodNo = existingNext ? tuitionPeriodNumber(existingNext) : currentPeriodNo + 1;
    const currentSystemPeriodNo = Math.max(1, Number(completed.systemPeriodNo || 1));
    const nextSystemPeriodNo = existingNext
      ? Math.max(currentSystemPeriodNo + 1, Number(existingNext.systemPeriodNo || 0))
      : currentSystemPeriodNo + 1;
    const targetPeriodId = existingNext ? sourceId(existingNext) : '';
    const sourcePeriodId = sourceId(completed);
    const id = tuitionPaymentRequestId(completed, studentId, nextPeriodNo);
    candidates.push({
      id,
      active: true,
      status: 'payment_due',
      studentId,
      studentName: clean(studentMap[studentId] && studentMap[studentId].name),
      subjectId,
      subjectName: clean(
        subjectMap[subjectId] && subjectMap[subjectId].name ||
        source.subjectName || completed.subjectName || source.subject || completed.subject
      ),
      teacherId,
      teacherName: clean(teacherMap[teacherId] && teacherMap[teacherId].name),
      sourcePeriodId,
      targetPeriodId,
      currentPeriodNo,
      nextPeriodNo,
      currentSystemPeriodNo,
      nextSystemPeriodNo,
      triggerLessonCount: tuitionLessonCount(completed),
      lessonCount: tuitionLessonCount(source),
      expectedAmount: amount,
      grossExpectedAmount,
      discount,
      discountType,
      teacherPayBasis,
      payByDiscount,
      planId: clean(source.planId || completed.planId),
      planSnapshot: jsonValue(source.planSnapshot || completed.planSnapshot || {}),
      createdAtText: nowText(),
      trigger: 'completed-period'
    });
  });
  return candidates;
}

async function ensureTuitionPaymentRequests(options) {
  const candidates = buildTuitionPaymentCandidates(options || {});
  const existingRows = await tuitionPaymentRequestsForStudents(options && options.studentIds || []);
  candidates.forEach((candidate) => {
    const prior = existingRows.find((row) =>
      clean(row.studentId) === clean(candidate.studentId) &&
      clean(row.sourcePeriodId) === clean(candidate.sourcePeriodId) &&
      Number(row.nextPeriodNo || 0) === Number(candidate.nextPeriodNo || 0) &&
      clean(row.status) !== 'cancelled'
    );
    if (prior) candidate.id = clean(prior.id);
  });
  for (let offset = 0; offset < candidates.length; offset += 25) {
    await Promise.all(candidates.slice(offset, offset + 25).map(async (candidate) => {
      const ref = db.collection(TUITION_PAYMENT_REQUESTS).doc(candidate.id);
      const known = existingRows.find(row => clean(row.id) === candidate.id);
      const snapshot = known ? { exists: true, data: () => known } : await ref.get();
      if (snapshot.exists) {
        const previous = snapshot.data() || {};
        const preserve = {};
        [
          'paymentMethod', 'transferDate', 'transferLast5', 'receiptStoragePath',
          'receiptContentType', 'receiptBytes', 'submittedAt', 'submittedAtText',
          'submissionRevision', 'reviewNote', 'confirmedAmount', 'remainingAmount',
          'confirmedAt', 'confirmedAtText', 'formalPeriodId', 'paymentDate',
          'expectedAmount'
        ].forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(previous, key)) preserve[key] = previous[key];
        });
        const updated = Object.assign({}, candidate, preserve, {
          active: previous.active !== false,
          status: clean(previous.status) || candidate.status,
          createdAtText: clean(previous.createdAtText) || candidate.createdAtText
        });
        const changed = Object.keys(updated).some(key => JSON.stringify(updated[key]) !== JSON.stringify(previous[key]));
        if (changed) await ref.set(Object.assign(updated, { updatedAt: FieldValue.serverTimestamp() }), { merge: true });
        return;
      }
      await ref.set(Object.assign({}, candidate, {
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }));
    }));
  }
  const candidateIds = new Set(candidates.map((row) => row.id));
  const periodMap = new Map((options && options.periods || []).map((row) => [sourceId(row), row]));
  await Promise.all(existingRows.filter((row) => {
    if (candidateIds.has(clean(row.id)) || row.active === false) return false;
    if (!['payment_due', 'needs_resubmission'].includes(clean(row.status))) return false;
    const target = periodMap.get(clean(row.targetPeriodId)) ||
      [...periodMap.values()].find((period) =>
        clean(period.studentId) === clean(row.studentId) &&
        tuitionPeriodNumber(period) === Number(row.nextPeriodNo || 0) &&
        (!clean(row.subjectId) || clean(period.subjectId) === clean(row.subjectId))
      );
    return Boolean(target && tuitionOutstandingAmount(target) <= 0);
  }).map((row) => db.collection(TUITION_PAYMENT_REQUESTS).doc(clean(row.id)).set({
    active: false,
    status: 'externally_settled',
    settledAtText: nowText(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })));
  return candidates.map((row) => row.id);
}

async function tuitionPaymentRequestsForStudents(studentIds) {
  const snapshots = await Promise.all((studentIds || []).map((studentId) =>
    db.collection(TUITION_PAYMENT_REQUESTS).where('studentId', '==', clean(studentId)).get()
  ));
  return snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => Object.assign({
    id: doc.id
  }, jsonValue(doc.data()) || {})));
}

function publicTuitionPaymentRequest(row) {
  return {
    id: clean(row.id),
    studentId: clean(row.studentId),
    studentName: clean(row.studentName),
    subjectId: clean(row.subjectId),
    subjectName: clean(row.subjectName),
    teacherName: clean(row.teacherName),
    currentPeriodNo: Number(row.currentPeriodNo || 0),
    nextPeriodNo: Number(row.nextPeriodNo || 0),
    currentSystemPeriodNo: Number(row.currentSystemPeriodNo || 0),
    nextSystemPeriodNo: Number(row.nextSystemPeriodNo || 0),
    sourcePeriodId: clean(row.sourcePeriodId),
    targetPeriodId: clean(row.targetPeriodId),
    lessonCount: Number(row.lessonCount || 4),
    expectedAmount: Number(row.expectedAmount || 0),
    confirmedAmount: Number(row.confirmedAmount || 0),
    remainingAmount: Math.max(0, Number(
      row.remainingAmount != null
        ? row.remainingAmount
        : Number(row.expectedAmount || 0) - Number(row.confirmedAmount || 0)
    )),
    paymentMethod: clean(row.paymentMethod),
    status: clean(row.status || 'payment_due'),
    transferDate: dateKey(row.transferDate),
    transferLast5: clean(row.transferLast5).slice(-5),
    submittedAtText: clean(row.submittedAtText),
    confirmedAtText: clean(row.confirmedAtText),
    reviewNote: clean(row.reviewNote)
  };
}

function newSystemTuitionPeriodLabel(row, which) {
  const field = which === 'current' ? 'currentSystemPeriodNo' : 'nextSystemPeriodNo';
  const value = Math.max(0, Number(row && row[field] || 0));
  if (value) return `新系統第 ${value} 期`;
  return which === 'current' ? '新系統本期' : '新系統下一期';
}

function parseTuitionReceipt(dataUrl) {
  const value = clean(dataUrl);
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw new HttpsError('invalid-argument', '匯款截圖格式不正確，請重新選擇圖片。');
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > TUITION_RECEIPT_MAX_BYTES) {
    throw new HttpsError('invalid-argument', '匯款截圖需小於 4 MB，請重新拍攝或縮小圖片。');
  }
  return { contentType: match[1].toLowerCase(), buffer };
}

async function portalRecipientForSession(session) {
  const rows = await authorizedBindingsForSession(session);
  const binding = rows.find(row => session.lineUserId && row.lineUserId === session.lineUserId) || rows[0] || {};
  return recipientFields({ ...binding, lineUserId: clean(session.lineUserId || binding.lineUserId) });
}

async function queueCoursePortalNotice(id, payload) {
  const ref = db.collection('notificationQueue').doc(clean(id) || randomToken(16));
  try {
    await ref.create(Object.assign({
      queueId: ref.id,
      channel: 'line',
      status: '待發送',
      createdAt: FieldValue.serverTimestamp(),
      createdAtText: nowText(),
      source: 'course-portal',
      emailFallbackEnabled: true
    }, payload || {}));
  } catch (error) {
    const code = clean(error && error.code).toLowerCase();
    if (code !== '6' && !/already[-_ ]?exists/.test(code)) throw error;
  }
  return ref.id;
}

async function queueBindingApprovalNotices() { /* Notifications disabled by owner, 2026-09-09. */ }

async function queueDirectLineBindingNotice(binding) {
  if (binding.type !== 'student' || !clean(binding.studentId)) return;
  const existing = await db.collection('coursePortalStudentBindings').where('studentId', '==', clean(binding.studentId)).get();
  const seen = new Set();
  for (const doc of existing.docs) {
    const row = doc.data() || {};
    const key = notificationRecipientKey(row);
    if (doc.id === binding.id || row.status !== 'active' || !key || seen.has(key) || key === notificationRecipientKey(binding)) continue;
    seen.add(key);
    await queueCoursePortalNotice(`course-binding-added-${binding.id}-${hash(String(binding.boundAt && binding.boundAt.seconds || Date.now()))}-${hash(key)}`, {
      ...recipientFields(row), eventCode: 'course_portal_family_binding_added', studentId: binding.studentId,
      title: '新增綁定帳號通知', body: [
        `${clean(binding.name) || '學生'}的學生資料新增了一個綁定帳號。`,
        `與學生關係：${clean(binding.relationship) || '本人'}`,
        binding.lineDisplayName ? `LINE 顯示名稱：${clean(binding.lineDisplayName)}` : '登入方式：Email',
        '若您不認識此使用者，請至入口的「綁定帳號管理」查看及處理。若有疑問，請聯絡柚子樂器官方 LINE。',
        `${PORTAL_BASE}/student-course-portal.html`
      ].join('\n')
    });
  }
}

async function queueBindingDecisionNotice() { /* Notifications disabled by owner, 2026-09-09. */ }

async function queueSessionSecurityNotice() { /* Notifications disabled by owner, 2026-09-09. */ }

async function queueStudentTuitionNotice(requestRow, title, body, eventCode, options = {}) {
  const snapshot = await db.collection('coursePortalStudentBindings')
    .where('studentId', '==', clean(requestRow.studentId))
    .get();
  const recipientSeen = new Set();
  const targets = snapshot.docs.filter((doc) => {
    const row = doc.data() || {};
    const key = notificationRecipientKey(row);
    if (recipientSeen.has(key)) return false;
    if (clean(row.status) === 'active') recipientSeen.add(key);
    return clean(row.status) === 'active' &&
      notificationRecipientKey(row) &&
      (options.forceBoundDelivery === true || row.reminderPayment !== false);
  });
  await Promise.all(targets.map((doc) => {
    const row = doc.data() || {};
    return queueCoursePortalNotice(
      `course-tuition-${clean(requestRow.id)}-${clean(eventCode)}-${doc.id}`,
      {
        eventCode: clean(eventCode),
        ...recipientFields(row),
        targetName: clean(requestRow.studentName) || '學生／家長',
        title,
        body,
        text: body,
        message: body,
        studentId: clean(requestRow.studentId),
        tuitionPaymentRequestId: clean(requestRow.id),
        tuitionReceiptId: clean(options.receiptId),
        lineImageUrl: clean(options.imageUrl),
        linePreviewImageUrl: clean(options.imageUrl)
      }
    );
  }));
  return targets.length;
}

async function studentSubmitTuitionPayment(data) {
  const session = await requireSession(data, ['student']);
  const requestId = clean(data.requestId);
  const paymentMethod = clean(data.paymentMethod);
  if (!requestId || !['bank_transfer', 'onsite'].includes(paymentMethod)) {
    throw new HttpsError('invalid-argument', '請選擇正確的繳費方式。');
  }
  const sessionBindings = await activeStudentBindingsForSession(session);
  const allowed = new Set(sessionBindings.map((row) => clean(row.studentId)).filter(Boolean));
  const ref = db.collection(TUITION_PAYMENT_REQUESTS).doc(requestId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError('not-found', '找不到這筆下一期學費。');
  const requestRow = Object.assign({ id: snapshot.id }, snapshot.data() || {});
  if (!allowed.has(clean(requestRow.studentId))) {
    throw new HttpsError('permission-denied', '沒有這筆學費的操作權限。');
  }
  if (!['payment_due', 'needs_resubmission'].includes(clean(requestRow.status))) {
    throw new HttpsError('failed-precondition', '這筆學費已經送出或完成，不能重複送出。');
  }

  const revision = Math.max(0, Number(requestRow.submissionRevision || 0)) + 1;
  const oldReceiptStoragePath = clean(requestRow.receiptStoragePath);
  let uploadedReceiptStoragePath = '';
  const update = {
    paymentMethod,
    status: paymentMethod === 'bank_transfer' ? 'pending_review' : 'onsite_pending',
    submittedAt: FieldValue.serverTimestamp(),
    submittedAtText: nowText(),
    submissionRevision: revision,
    reviewNote: '',
    updatedAt: FieldValue.serverTimestamp()
  };
  if (paymentMethod === 'bank_transfer') {
    const transferDate = dateKey(data.transferDate);
    const transferLast5 = clean(data.transferLast5).replace(/\D/g, '').slice(-5);
    if (!transferDate) throw new HttpsError('invalid-argument', '請填寫匯款日期。');
    if (transferDate > currentTaipeiDay()) {
      throw new HttpsError('invalid-argument', '匯款日期不能晚於今天，請確認後重新送出。');
    }
    if (transferLast5.length !== 5) throw new HttpsError('invalid-argument', '請填寫匯款帳號末五碼。');
    const receipt = parseTuitionReceipt(data.receiptDataUrl);
    const storagePath = [
      'course-portal/tuition-payments',
      clean(requestRow.studentId),
      requestId,
      `receipt-${revision}-${randomToken(6)}`
    ].join('/');
    uploadedReceiptStoragePath = storagePath;
    await admin.storage().bucket().file(storagePath).save(receipt.buffer, {
      resumable: false,
      metadata: {
        contentType: receipt.contentType,
        cacheControl: 'private, no-store, max-age=0',
        metadata: {
          studentId: clean(requestRow.studentId),
          tuitionPaymentRequestId: requestId
        }
      }
    });
    Object.assign(update, {
      transferDate,
      transferLast5,
      receiptStoragePath: storagePath,
      receiptContentType: receipt.contentType,
      receiptBytes: receipt.buffer.length
    });
  } else {
    Object.assign(update, {
      transferDate: '',
      transferLast5: '',
      receiptStoragePath: FieldValue.delete(),
      receiptContentType: FieldValue.delete(),
      receiptBytes: FieldValue.delete()
    });
  }
  try {
    await db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      const currentStatus = clean(current.exists && current.data().status);
      if (!current.exists || !['payment_due', 'needs_resubmission'].includes(currentStatus)) {
        throw new HttpsError('failed-precondition', '這筆學費剛剛已經送出或完成，請重新整理。');
      }
      tx.set(ref, update, { merge: true });
    });
  } catch (error) {
    if (uploadedReceiptStoragePath) {
      await admin.storage().bucket().file(uploadedReceiptStoragePath).delete({ ignoreNotFound: true }).catch(() => null);
    }
    throw error;
  }
  if (oldReceiptStoragePath && oldReceiptStoragePath !== uploadedReceiptStoragePath) {
    await admin.storage().bucket().file(oldReceiptStoragePath).delete({ ignoreNotFound: true }).catch(() => null);
  }
  const methodText = paymentMethod === 'bank_transfer' ? '轉帳繳費' : '現場繳費';
  const adminBody = [
    '學生下一期學費已送出，請進入後台確認。',
    '',
    `學生：${clean(requestRow.studentName) || clean(requestRow.studentId)}`,
    `課程：${clean(requestRow.subjectName) || '未提供'}`,
    `期別：${newSystemTuitionPeriodLabel(requestRow, 'next')}`,
    `金額：NT$${Number(requestRow.expectedAmount || 0).toLocaleString('zh-TW')}`,
    `方式：${methodText}`,
    paymentMethod === 'bank_transfer' ? `匯款末五碼：${clean(update.transferLast5)}` : '',
    '',
    `${PORTAL_BASE}/course-portal-admin.html`
  ].filter((line) => line !== '').join('\n');
  await queueCoursePortalNotice(
    `course-tuition-manager-${requestId}-${revision}`,
    {
      eventCode: 'tuition_payment_submitted',
      target: 'admin',
      targetRole: 'admin',
      targetEmployeeId: 'PRIMARY_MANAGER_LINE',
      targetName: '柚子樂器主管',
      title: '學生學費待確認',
      body: adminBody,
      text: adminBody,
      message: adminBody,
      studentId: clean(requestRow.studentId),
      tuitionPaymentRequestId: requestId
    }
  );
  return {
    ok: true,
    requestId,
    status: update.status,
    message: paymentMethod === 'bank_transfer'
      ? '匯款資料已送出，待主管確認入帳。'
      : '已登記現場繳費，實際收款後由主管確認。'
  };
}

async function portalAttendanceForStudents(studentIds) {
  const snapshots = await Promise.all((studentIds || []).map((studentId) =>
    db.collection(ATTENDANCE_RECORDS).where('studentId', '==', clean(studentId)).get()
  ));
  return snapshots.flatMap((snapshot) => snapshot.docs.map((doc) =>
    Object.assign({ __id: doc.id }, jsonValue(doc.data()) || {})
  ));
}

function attendanceRowsMatch(left, right) {
  if (clean(left.studentId) !== clean(right.studentId)) return false;
  if (eventDate(left) !== eventDate(right)) return false;
  if (eventTeacherId(left) && eventTeacherId(right) && eventTeacherId(left) !== eventTeacherId(right)) return false;
  const leftEvent = clean(left.eventId || left.sourceEventId);
  const rightEvent = clean(right.eventId || right.sourceEventId);
  if (leftEvent && rightEvent && leftEvent === rightEvent) return true;
  const leftCourse = clean(left.courseId || left.fixedCourseId || left.sourceCourseId);
  const rightCourse = clean(right.courseId || right.fixedCourseId || right.sourceCourseId);
  if (leftCourse && rightCourse) return leftCourse === rightCourse;
  // 缺少可驗證事件／課程編號時不可只靠「同學生同一天」猜測，避免誤刪同日第二堂。
  return false;
}

function mergePortalAttendanceRows(mirrorAttendance, portalAttendance) {
  const cancellations = (portalAttendance || []).filter((row) =>
    clean(row.status) === 'cancelled' || row.active === false
  );
  const retainedMirror = (mirrorAttendance || []).filter((row) =>
    !cancellations.some((cancelled) => attendanceRowsMatch(row, cancelled))
  );
  const activePortal = (portalAttendance || []).filter((row) =>
    row.active !== false && ['attended', 'absent'].includes(normalizeScheduleStatus(row.status))
  );
  const merged = retainedMirror.slice();
  activePortal.forEach((row) => {
    if (!merged.some((existing) => attendanceRowsMatch(existing, row))) merged.push(row);
  });
  return merged;
}

function teacherPayrollCourseId(row) {
  return clean(row && (
    row.courseId || row.fixedCourseId || row.sourceCourseId || row.seriesId || row.scheduleId
  ));
}

function teacherPayrollStudentIds(row) {
  return [...new Set(
    eventStudentIds(row || {}).concat(clean(row && row.studentId)).map(clean).filter(Boolean)
  )];
}

function teacherPayrollMinute(row) {
  const explicit = clean(row && (
    row.occurredAt || row.attendedAt || row.startedAt || row.startAt
  ));
  if (explicit) {
    const parsed = Date.parse(explicit);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 60000);
  }
  const date = eventDate(row || {});
  const time = eventStart(row || {});
  if (!date || !time) return null;
  const parsed = Date.parse(`${date}T${time}:00+08:00`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 60000) : null;
}

function enrichTeacherPayrollRows(payrollRows, attendanceRows) {
  const attendanceById = new Map();
  (attendanceRows || []).forEach((row) => {
    [sourceId(row), clean(row && row.id), clean(row && row.sourceId)]
      .filter(Boolean)
      .forEach((id) => attendanceById.set(id, row));
  });
  return (payrollRows || []).map((row) => {
    const attendance = [sourceId(row), clean(row && row.id), clean(row && row.sourceId)]
      .map((id) => attendanceById.get(id))
      .find(Boolean);
    if (!attendance) return row;
    const merged = Object.assign({}, row);
    if (!teacherPayrollStudentIds(merged).length) {
      const attendanceStudentIds = eventStudentIds(attendance || {});
      if (attendanceStudentIds.length === 1) merged.studentId = attendanceStudentIds[0];
    }
    if (!teacherPayrollCourseId(merged)) {
      merged.courseId = clean(attendance.courseId || attendance.fixedCourseId || attendance.sourceCourseId);
    }
    if (!clean(merged.subjectId)) merged.subjectId = eventSubjectId(attendance);
    if (!clean(merged.periodId)) merged.periodId = clean(attendance.periodId || attendance.studentPayment);
    return merged;
  });
}

function teacherPayrollMatchesCancellation(row, request) {
  if (eventDate(row || {}) !== dateKey(request && request.date)) return false;
  const requestTeacherId = eventTeacherId(request || {});
  if (!requestTeacherId || eventTeacherId(row || {}) !== requestTeacherId) return false;
  const requestStudentIds = teacherPayrollStudentIds(request);
  const payrollStudentIds = teacherPayrollStudentIds(row);
  if (
    !requestStudentIds.length ||
    !payrollStudentIds.length ||
    !payrollStudentIds.some((studentId) => requestStudentIds.includes(studentId))
  ) return false;

  const payrollOperationIds = [row && row.operationId, row && row.id, row && row.__id]
    .map(clean).filter(Boolean);
  const requestOperationId = clean(request && request.operationId);
  const exactOperation = Boolean(
    requestOperationId && payrollOperationIds.includes(requestOperationId)
  );
  const payrollEventIds = [row && row.eventId, row && row.sourceEventId]
    .map(clean).filter(Boolean);
  const requestEventIds = [request && request.eventId, request && request.sourceEventId]
    .map(clean).filter(Boolean);
  const exactEvent = payrollEventIds.some((id) => requestEventIds.includes(id));
  const payrollCourseId = teacherPayrollCourseId(row);
  const requestCourseId = clean(request && (
    request.courseId || request.fixedCourseId || request.sourceCourseId
  ));
  const exactCourse = Boolean(
    payrollCourseId && requestCourseId && payrollCourseId === requestCourseId
  );
  if (!exactOperation && !exactEvent && !exactCourse) return false;

  const payrollMinute = teacherPayrollMinute(row);
  const requestMinute = teacherPayrollMinute(request);
  if (payrollMinute != null && requestMinute != null && payrollMinute !== requestMinute) return false;
  // 只有 operationId 可視為完整唯一鍵；其餘事件／課程匹配都必須同時核對上課時間，
  // 避免同一固定課在同一天加課兩次時整批刪除薪資。
  if (!exactOperation && (payrollMinute == null || requestMinute == null)) return false;
  return true;
}

function teacherPayrollRowsMatch(mirrorRow, portalRow, studentId) {
  if (clean(mirrorRow && mirrorRow.teacherId) !== clean(portalRow && portalRow.teacherId)) return false;
  if (eventDate(mirrorRow || {}) !== eventDate(portalRow || {})) return false;
  const wantedStudentId = clean(studentId);
  if (wantedStudentId && !teacherPayrollStudentIds(mirrorRow).includes(wantedStudentId)) return false;
  const mirrorCourseId = teacherPayrollCourseId(mirrorRow);
  const portalCourseId = teacherPayrollCourseId(portalRow);
  if (mirrorCourseId && portalCourseId && mirrorCourseId !== portalCourseId) return false;
  const mirrorEventIds = [mirrorRow.id, mirrorRow.eventId, mirrorRow.sourceEventId].map(clean).filter(Boolean);
  const portalEventIds = [portalRow.id, portalRow.eventId, portalRow.sourceEventId].map(clean).filter(Boolean);
  const exactEvent = mirrorEventIds.some((id) => portalEventIds.includes(id));
  const mirrorMinute = teacherPayrollMinute(mirrorRow);
  const portalMinute = teacherPayrollMinute(portalRow);
  if (mirrorMinute != null && portalMinute != null && mirrorMinute !== portalMinute) return false;
  if (exactEvent) return true;
  if (mirrorCourseId && portalCourseId) {
    // 有時間時必須同分鐘；舊資料任一側缺時間時才以「同老師、日、學生、課程」做相容配對。
    return mirrorMinute == null || portalMinute == null || mirrorMinute === portalMinute;
  }
  if (mirrorMinute != null && portalMinute != null && mirrorMinute === portalMinute) return true;
  // 舊營運來源有一段期間只保存每天中午的佔位時間；若又缺課程編號，就保留兩列供人工稽核，不能猜測刪除。
  return false;
}

function mergeTeacherPayrollRows(mirrorPayroll, portalPayroll, approvedCancellations = []) {
  const cancellations = (approvedCancellations || []).filter((row) =>
    clean(row && row.status) === 'approved' ||
    clean(row && row.status) === 'cancelled' ||
    row && row.active === false
  );
  const retainedMirror = (mirrorPayroll || []).filter((row) =>
    !cancellations.some((request) => teacherPayrollMatchesCancellation(row, request))
  );
  // 新版快照列是正式來源；已部署過的舊版正薪資雖尚無 payrollCalculation.version，
  // 也必須保留並用相同強識別消除鏡像重複。只有舊版 NT$0 暫存列不可蓋掉鏡像。
  const canonicalPortal = (portalPayroll || []).filter((row) =>
    row &&
    row.active !== false &&
    normalizeScheduleStatus(row.status) === 'attended' &&
    (
      clean(row.payrollCalculation && row.payrollCalculation.version) ||
      Number(row.teacherAmount || 0) > 0
    )
  );
  const mirrorAtoms = [];
  retainedMirror.forEach((row, rowIndex) => {
    teacherPayrollStudentIds(row).forEach((studentId) => {
      mirrorAtoms.push({ rowIndex, studentId, consumed: false });
    });
  });
  canonicalPortal.forEach((portalRow) => {
    const studentIds = teacherPayrollStudentIds(portalRow);
    for (const studentId of studentIds) {
      const atom = mirrorAtoms.find((candidate) =>
        !candidate.consumed &&
        candidate.studentId === studentId &&
        teacherPayrollRowsMatch(retainedMirror[candidate.rowIndex], portalRow, studentId)
      );
      if (atom) atom.consumed = true;
    }
    if (!studentIds.length) {
      const portalEventId = clean(portalRow.eventId || portalRow.sourceEventId);
      const rowIndex = portalEventId
        ? retainedMirror.findIndex((mirrorRow) =>
          [mirrorRow.id, mirrorRow.eventId, mirrorRow.sourceEventId]
            .map(clean).includes(portalEventId)
        )
        : -1;
      if (rowIndex >= 0) mirrorAtoms.push({ rowIndex, studentId: '', consumed: true });
    }
  });
  const consumedRows = new Set(mirrorAtoms.filter((atom) => atom.consumed).map((atom) => atom.rowIndex));
  const unconsumedRows = retainedMirror.filter((row, rowIndex) => !consumedRows.has(rowIndex));
  return unconsumedRows.concat(canonicalPortal);
}

function mergeTeacherAdjustmentRows(mirrorAdjustments, portalAdjustments) {
  const merged = new Map();
  (mirrorAdjustments || []).concat(portalAdjustments || []).forEach((row, index) => {
    if (!row || row.active === false) return;
    const id = clean(row.id || row.__id || row.sourceId) || [
      clean(row.teacherId),
      clean(row.month || row.payrollMonth),
      eventDate(row),
      clean(row.type),
      Number(row.amount || 0),
      index
    ].join('|');
    merged.set(id, row);
  });
  return [...merged.values()];
}

function teacherPayrollMonthBounds(value) {
  const month = clean(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new HttpsError('invalid-argument', '薪資月份格式不正確。');
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
  const startDate = `${month}-01`;
  return { month, startDate, endDate: addDays(`${next}-01`, -1) };
}

async function portalRowsByDateRange(collectionName, startDate, endDate) {
  const collection = db.collection(collectionName);
  let documents = [];
  try {
    const snapshot = await collection
      .where('date', '>=', startDate)
      .where('date', '<=', endDate)
      .get();
    documents = snapshot.docs;
  } catch (error) {
    console.warn('[course portal payroll month fallback]', collectionName, clean(error && error.message));
    documents = (await collection.get()).docs;
  }
  return documents.map((doc) => Object.assign({ __id: doc.id }, jsonValue(doc.data()) || {}))
    .filter((row) => {
      const key = eventDate(row || {});
      return key >= startDate && key <= endDate;
    });
}

async function teacherPayrollMonthData(monthValue) {
  const bounds = teacherPayrollMonthBounds(monthValue);
  const [
    mirrorPayroll,
    mirrorAdjustments,
    mirrorAttendance,
    portalPayroll,
    portalAdjustments,
    cancellationRows
  ] = await Promise.all([
    mirrorRowsByDateRange('teacherPayroll', bounds.startDate, bounds.endDate),
    mirrorRowsByDateRange('teacherAdjustments', bounds.startDate, bounds.endDate),
    mirrorRowsByDateRange('attendance', bounds.startDate, bounds.endDate),
    portalRowsByDateRange(ATTENDANCE_PAYROLL, bounds.startDate, bounds.endDate),
    portalRowsByDateRange('coursePortalTeacherAdjustments', bounds.startDate, bounds.endDate),
    portalRowsByDateRange(ATTENDANCE_CANCELLATIONS, bounds.startDate, bounds.endDate)
  ]);
  const approvedCancellations = cancellationRows.filter((row) => clean(row.status) === 'approved');
  const teacherPayroll = mergeTeacherPayrollRows(
    enrichTeacherPayrollRows(mirrorPayroll, mirrorAttendance),
    portalPayroll,
    approvedCancellations.concat(portalPayroll.filter((row) => row.active === false))
  ).filter((row) => eventDate(row || {}).slice(0, 7) === bounds.month);
  const teacherAdjustments = mergeTeacherAdjustmentRows(
    mirrorAdjustments,
    portalAdjustments
  ).filter((row) => eventDate(row || {}).slice(0, 7) === bounds.month);
  return {
    ok: true,
    scope: 'teacher-payroll-month',
    month: bounds.month,
    teacherPayroll,
    teacherAdjustments,
    counts: {
      teacherPayroll: teacherPayroll.length,
      teacherAdjustments: teacherAdjustments.length
    },
    loadedAt: new Date().toISOString()
  };
}

function applyPortalAttendanceToPeriods(periods, mirrorAttendance, portalAttendance) {
  const rows = (periods || []).map((row) => Object.assign({}, row));
  const activePortal = (portalAttendance || []).filter((row) =>
    row.active !== false &&
    ['attended', 'absent'].includes(normalizeScheduleStatus(row.status)) &&
    row.deducted !== false &&
    clean(row.periodId) &&
    !(mirrorAttendance || []).some((existing) => attendanceRowsMatch(existing, row))
  );
  const additions = activePortal.reduce((map, row) => {
    const periodId = clean(row.periodId);
    map[periodId] = Number(map[periodId] || 0) + 1;
    return map;
  }, {});
  const approvedCancellations = (portalAttendance || []).filter((row) =>
    (clean(row.status) === 'cancelled' || row.active === false) &&
    ['attendance-cancellation-approved', 'teacher-same-day-attendance-cancellation']
      .includes(clean(row.source))
  );
  const restorations = approvedCancellations.reduce((map, row) => {
    const matched = (mirrorAttendance || []).find((existing) => attendanceRowsMatch(existing, row));
    // 鏡像尚未包含這次 portal 簽到時，usedCount 本來就沒有加 1；此時不可再多還一堂。
    if (!matched) return map;
    const originalPeriodId = clean(row.periodId || matched && (matched.periodId || matched.studentPayment));
    // 取消哪一期的簽到，就只還到同一期；不可因後來新增期別而把堂數挪到最新一期。
    if (originalPeriodId && rows.some((period) => sourceId(period) === originalPeriodId)) {
      map[originalPeriodId] = Number(map[originalPeriodId] || 0) + 1;
    }
    return map;
  }, {});
  return rows.map((row) => {
    const extra = Number(additions[sourceId(row)] || 0);
    const restored = Number(restorations[sourceId(row)] || 0);
    if (!extra && !restored) return row;
    const beforeRestore = Math.max(0, Number(row.usedCount || row.attendedCount || 0) + extra);
    const usedReduction = Math.min(beforeRestore, restored);
    const extraLessonCredit = Math.max(0, restored - usedReduction);
    const usedCount = beforeRestore - usedReduction;
    const lessonCount = Math.max(1, Number(row.lessonCount || row.totalLessons || 4)) + extraLessonCredit;
    return Object.assign({}, row, {
      usedCount,
      attendedCount: usedCount,
      lessonCount,
      totalLessons: lessonCount,
      portalAttendanceCount: extra,
      portalAttendanceCancelledCount: restored,
      portalRestoredCreditCount: restored,
      portalExtraLessonCreditCount: extraLessonCredit
    });
  });
}

async function studentTemporaryCourses(studentId) {
  const groups = await readCourseGroups();
  const group = groups.find(row => row.active !== false && row.id === studentId);
  const ids = [...new Set([studentId, ...(group && group.memberIds || [])])];
  const snapshots = await Promise.all(ids.flatMap(id => [
    db.collection(MIRROR.temporaryCourses).where('source.studentIds', 'array-contains', id).get(),
    db.collection(MIRROR.temporaryCourses).where('source.studentId', '==', id).get()
  ]));
  const rows = new Map();
  for (const snapshot of snapshots) for (const doc of snapshot.docs) {
    const envelope = doc.data() || {};
    if (envelope.sourceActive !== true) continue;
    rows.set(doc.id, { __id: doc.id, ...jsonValue(envelope.source || {}) });
  }
  return projectCourseGroups('temporaryCourses', [...rows.values()], groups);
}

async function historyEventsForStudent(studentId, startDate, endDate) {
  const [events, changeDocs, groups] = await Promise.all([
    historyStudentEvents(studentId,startDate,endDate),scheduleChangeDocsByDateRange(startDate,endDate),readCourseGroups()
  ]);
  const changes = changeDocs.map(doc => ({...jsonValue(doc.data()),id:doc.id})).filter(row => row.active !== false && row.event);
  const changedEvents = projectCourseGroups('events',changes.map(row => ({...row.event,
    id:row.id,teacherId:eventTeacherId(row.event) || row.createdByTeacherId,
    date:eventDate(row.event) || row.sourceDate})),groups)
    .filter(row => eventStudentIds(row).includes(studentId) && eventDate(row)>=startDate && eventDate(row)<=endDate);
  return {fixedCourses:[],temporaryCourses:[],resourceEvents:[...events.filter(row => row.__mirrorActive !== false),...changedEvents]
    .map(row => ({...row,startTime:eventStart(row)}))};
}

async function historyAttendanceForPeriods(periods, studentId, fromDate) {
  const candidates = selectHistoryPeriods(periods.map(row => ({...row,
    studentId,subjectId:eventSubjectId(row),teacherId:eventTeacherId(row),
    outstandingAmount:tuitionOutstandingAmount(row),
    // Read the boundary period before deciding whether its last lesson reaches the cutoff.
    endDate:dateKey(row.expiryDate || row.endDate) || (dateKey(row.startDate) <= COURSE_HISTORY_MIN_DATE ? COURSE_HISTORY_MIN_DATE : '')
  })), fromDate);
  const ids = [...new Set(candidates.flatMap(row => [sourceId(row),clean(row.sourcePaymentId),sourceId(row).replace(/^period_/, '')]).filter(Boolean))];
  const requests = [];
  for (let i=0;i<ids.length;i+=30) for (const field of ['periodId','sourcePaymentId','studentPayment']) requests.push(
    db.collection(MIRROR.attendance).where('source.'+field,'in',ids.slice(i,i+30)).get());
  const snapshots = await Promise.all(requests), rows = new Map();
  for (const snap of snapshots) for (const doc of snap.docs) {
    const envelope = doc.data(), source = jsonValue(envelope.source) || {};
    if (envelope.sourceActive === false || source.studentId !== studentId) continue;
    rows.set(doc.id,{__id:doc.id,...source});
  }
  return projectCourseGroups('attendance',[...rows.values()],await readCourseGroups());
}

async function courseLessonHistory(data) {
  const session = await requireSession(data, ['teacher', 'student']);
  const studentId = canonicalStudentId(clean(data.studentId), await readCourseGroups());
  if (!studentId) throw new HttpsError('invalid-argument', '請選擇學生。');
  const ownedPeriods = await mirrorRowsByField('tuitionPeriods', 'studentId', studentId);
  if (session.role === 'teacher') {
    if (!ownedPeriods.some(row => eventTeacherId(row) === session.teacherId) && !(await teacherOwnsStudent(session.teacherId, studentId))) {
      throw new HttpsError('permission-denied', '只能查看自己授課的學生。');
    }
  } else {
    const bindings = await activeStudentBindingsForSession(session);
    if (!bindings.some(row => clean(row.studentId) === studentId)) throw new HttpsError('permission-denied', '沒有這位學生的查看權限。');
  }
  const fromDate = dateKey(data.fromDate);
  if (data.fromDate && (!fromDate || fromDate < COURSE_HISTORY_MIN_DATE)) {
    throw new HttpsError('failed-precondition', '新系統未承接此日期之前的資料，請至實體上課證查詢。');
  }
  const today = currentTaipeiDay();
  if (fromDate > today) throw new HttpsError('invalid-argument', '請選擇今天或之前的日期。');
  const candidates = selectHistoryPeriods(ownedPeriods.map(row => ({ ...row, outstandingAmount: tuitionOutstandingAmount(row) })), fromDate);
  const earliest = candidates.map(row => dateKey(row.startDate || row.beginDate)).filter(Boolean).sort()[0];
  const eventFrom = !earliest || candidates.some(row => !dateKey(row.startDate || row.beginDate)) || earliest < COURSE_HISTORY_MIN_DATE ? COURSE_HISTORY_MIN_DATE : earliest;
  const [rawPeriods, mirrorAttendance, portalAttendance, subjects, teachers, bundle, historyFixedCourses, historyTemporaryCourses] = await Promise.all([
    Promise.resolve(ownedPeriods),
    historyAttendanceForPeriods(ownedPeriods, studentId, fromDate),
    portalAttendanceForStudents([studentId]), mirrorRows('subjects'), mirrorRows('teachers'),
    historyEventsForStudent(studentId, eventFrom, today),
    mirrorRows('fixedCourses'), studentTemporaryCourses(studentId)
  ]);
  const courses = [...historyFixedCourses, ...historyTemporaryCourses, ...bundle.fixedCourses, ...bundle.temporaryCourses];
  const allAttendance = mergePortalAttendanceRows(mirrorAttendance, portalAttendance);
  const historyRelatedRows = [...courses, ...bundle.resourceEvents, ...allAttendance].filter(item => eventStudentIds(item).includes(studentId));
  const numberedHistoryPeriods = await assignNewSystemPeriodNumbers(applyPortalAttendanceToPeriods(rawPeriods, mirrorAttendance, portalAttendance));
  const periods = numberedHistoryPeriods.map(row => {
    const id = sourceId(row);
    const periodAliases = new Set([id, clean(row.sourcePaymentId), id.replace(/^period_/, '')].filter(Boolean));
    const linked = allAttendance.filter(item => periodAliases.has(clean(item.periodId || item.studentPayment)));
    const course = courses.find(item => courseSourceIds(item).includes(clean(row.sourceCourseId || row.courseId || row.fixedCourseId))) || courses.find(item => firstArray(item, ['studentPaymentIds', 'tuitionPeriodIds', 'paymentIds']).some(payment => periodAliases.has(clean(payment)))) || {};
    const subjectId = eventSubjectId(row) || eventSubjectId(linked[0] || {}) || eventSubjectId(course);
    const related = historyRelatedRows.filter(item => eventSubjectId(item) === subjectId);
    const teacherCandidates = [...new Set(related.map(eventTeacherId).filter(Boolean))];
    const teacherId = eventTeacherId(row) || eventTeacherId(linked[0] || {}) || eventTeacherId(course) || (teacherCandidates.length === 1 ? teacherCandidates[0] : '');
    const dates = linked.map(eventDate).filter(Boolean).sort();
    const startDate = dateKey(row.startDate || row.beginDate) || dates[0] || '';
    return { id, studentId, teacherId, subjectId, startDate,
      hasCutoffEvidence: linked.some(item => eventDate(item) >= COURSE_HISTORY_MIN_DATE) || related.some(item => eventDate(item) >= COURSE_HISTORY_MIN_DATE && (!teacherId || eventTeacherId(item) === teacherId)),
      endDate: dateKey(row.expiryDate || row.endDate) || (Number(row.usedCount || row.attendedCount || 0) >= Number(row.lessonCount || row.totalLessons || 4) ? dates[dates.length - 1] || '' : ''),
      periodNo: Number(row.periodNo || row.period || 0), systemPeriodNo: Number(row.systemPeriodNo || 0),
      subjectName: clean((subjects.find(item => sourceId(item) === subjectId) || {}).name) || '課程',
      teacherName: clean((teachers.find(item => sourceId(item) === teacherId) || {}).name),
      lessonCount: Number(row.lessonCount || row.totalLessons || 4), usedCount: Number(row.usedCount || row.attendedCount || 0),
      expectedAmount: tuitionNetExpectedAmount(row), paidAmount: tuitionBasePaidAmount(row),
      outstandingAmount: tuitionOutstandingAmount(row),
      partialHistory: Boolean(startDate && startDate < COURSE_HISTORY_MIN_DATE && linked.filter(item => normalizeScheduleStatus(item.status || item.type) === 'attended').length < Number(row.usedCount || row.attendedCount || 0)),
      transactions: (Array.isArray(row.transactions) ? row.transactions : []).filter(item => item.active !== false && (!item.status || item.status === 'confirmed')).map(item => ({
        date: dateKey(item.paidAtText || item.confirmedAtText || item.date || item.receivedAtText || item.paymentDate || item.createdAtText), type: clean(item.type), amount: Number(item.amount || 0)
      }))
    };
  }).filter(row => session.role !== 'teacher' || row.teacherId === session.teacherId);
  const lessons = allAttendance.filter(row => eventDate(row) && eventDate(row) <= today).map(row => ({
    id: sourceId(row), periodId: (periods.find(period => period.id === clean(row.periodId || row.studentPayment) || period.id.replace(/^period_/, '') === clean(row.periodId || row.studentPayment)) || {}).id || clean(row.periodId || row.studentPayment), date: eventDate(row), startTime: eventStart(row),
    subjectId: eventSubjectId(row), teacherId: eventTeacherId(row), status: normalizeScheduleStatus(row.status || row.type), late: row.late === true,
    deducted: row.deducted !== false && !['leave','cancelled'].includes(normalizeScheduleStatus(row.status || row.type))
  }));
  for (const event of bundle.resourceEvents.filter(row => eventStudentIds(row).includes(studentId))) {
    const status = normalizeScheduleStatus(event.status);
    if (!['leave', 'absent'].includes(status)) continue;
    if (lessons.some(row => row.date === event.date && row.teacherId === event.teacherId && row.subjectId === event.subjectId && (!row.startTime || row.startTime === event.startTime))) continue;
    const matching = periods.filter(row => row.teacherId === event.teacherId && row.subjectId === event.subjectId && row.startDate && row.startDate <= event.date)
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.periodNo - a.periodNo);
    const periodId = clean(event.tuitionPeriodId) || (matching[0] || {}).id || '';
    lessons.push({ id: event.id, periodId, date: event.date, startTime: event.startTime, teacherId: event.teacherId, subjectId: event.subjectId, status, deducted: status === 'absent' });
  }
  const correctionSnapshot = await db.collection('coursePortalAttendanceCorrections').where('studentId', '==', studentId).get();
  const corrections = correctionSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  for (const slot of corrections) {
    for (let i = lessons.length - 1; i >= 0; i--) if (lessons[i].id === slot.originalAttendanceId || lessons[i].id === slot.replacementAttendanceId) lessons.splice(i, 1);
    lessons.push({ id: slot.id, periodId: slot.periodId, slotNo: slot.slotNo,
      date: slot.status === 'filled' ? slot.replacementDate : slot.originalDate,
      originalDate: slot.originalDate, correction: true, status: slot.status === 'filled' ? 'attended' : 'correction_pending',
      deducted: slot.status === 'filled' });
  }
  const selected = selectHistoryPeriods(periods, fromDate);
  for (const slot of corrections.filter(row => row.status === 'pending')) {
    const period = periods.find(row => row.id === slot.periodId);
    if (period && !selected.includes(period)) selected.push(period);
  }
  let tuitionPayment;
  if (session.role === 'student' && data.includeTuitionPayment === true) {
    const students = await mirrorRowsIncludingInactive('students');
    const learning = activeLearningStudentIds(students, courses, bundle.resourceEvents, await activeStudentSuspensions());
    if (learning.has(studentId)) await ensureTuitionPaymentRequests({ periods: numberedHistoryPeriods, students, subjects, teachers, studentIds: [studentId] });
    tuitionPayment = { bank: TUITION_PAYMENT_BANK, requests: (learning.has(studentId) ? await tuitionPaymentRequestsForStudents([studentId]) : [])
      .filter(row => row.active !== false && clean(row.status) !== 'cancelled').map(publicTuitionPaymentRequest) };
  }
  return { ok: true, minDate: COURSE_HISTORY_MIN_DATE, fromDate, periods: selected, ...(tuitionPayment ? { tuitionPayment } : {}),
    subjects: [...new Map(periods.map(row => [row.subjectId, { id: row.subjectId, name: row.subjectName }])).values()],
    lessons: lessons.filter(row => selected.some(period => period.id === row.periodId))
      .sort((a, b) => `${a.date}|${a.startTime}`.localeCompare(`${b.date}|${b.startTime}`)) };
}

function nextStudentLessons(events, allowed, now = Date.now()) {
  const counts = new Map();
  return events.filter(row =>
    eventStudentIds(row).some(id => allowed.has(id)) &&
    !['cancelled', 'leave', 'absent', 'attended', 'checked_in', 'present'].includes(normalizeScheduleStatus(row.status)) &&
    taipeiDateTimeMillis(eventDate(row), eventStart(row)) >= now
  ).sort((a,b) => `${eventDate(a)}|${eventStart(a)}`.localeCompare(`${eventDate(b)}|${eventStart(b)}`))
    .filter(row => {
      const ids = eventStudentIds(row).filter(id => allowed.has(id));
      const include = ids.some(id => (counts.get(id) || 0) < 2);
      if (include) ids.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
      return include;
    });
}

async function studentPortalOverview(data) {
  const session = await requireSession(data, ['student']);
  const bindings = await activeStudentBindingsForSession(session);
  const ids = [...new Set(bindings.map(row => clean(row.studentId)).filter(Boolean))];
  const selected = canonicalStudentId(clean(data.studentId), await readCourseGroups()) || ids[0];
  if (!selected || !ids.includes(selected)) throw new HttpsError('permission-denied', '沒有這位學生的查看權限。');
  const today = currentTaipeiDay();
  const [students, suspensions] = await Promise.all([
    mirrorRowsIncludingInactive('students'), reconcileStudentSuspensionsForNewSchedules([selected])
  ]);
  let bundle = await scheduleBundle(today, addDays(today, 60), '', { historyStudentId: selected });
  const allowed = new Set([selected]);
  let next = nextStudentLessons(bundle.resourceEvents, allowed);
  // Sparse or irregular schedules can still have a second lesson beyond two months.
  if (next.length < 2) {
    const later = await scheduleBundle(addDays(today, 61), addDays(today, 120), '', { historyStudentId: selected });
    next = nextStudentLessons([...bundle.resourceEvents, ...later.resourceEvents], allowed);
    bundle = { ...bundle, temporaryCourses: [...bundle.temporaryCourses, ...later.temporaryCourses] };
  }
  const learning = activeLearningStudentIds(students, [...bundle.fixedCourses, ...bundle.temporaryCourses], next, suspensions);
  const maps = bundle.maps;
  const courseTeachers = [...bundle.fixedCourses, ...bundle.temporaryCourses].filter(row => eventStudentIds(row).includes(selected))
    .map(row => maps.teachers[eventTeacherId(row)]).filter(Boolean);
  return {
    ok: true, selectedStudentId: selected,
    students: ids.map(id => {
      const row = students.find(item => sourceId(item) === id) || {};
      return { id, name: clean(row.name || (bindings.find(item => item.studentId === id) || {}).name) || '學生',
        accessStatus: id !== selected || learning.has(id) ? 'active' : 'history_and_rental',
        accessMessage: '目前沒有進行中的課程；仍可查看過去上課紀錄，也可以使用教室租用。' };
    }),
    bindings: bindings.map(row => ({ studentId: row.studentId, reminderPayment: row.reminderPayment !== false,
      reminderContactBook: row.reminderContactBook !== false })),
    teachers: [...new Map(courseTeachers.map(row => [sourceId(row), { teacherId: sourceId(row), teacherName: clean(row.name) }])).values()],
    upcoming: next.map(row => ({ id: sourceId(row), date: eventDate(row), startTime: eventStart(row), endTime: eventEnd(row),
      studentIds: eventStudentIds(row), teacherId: eventTeacherId(row),
      teacherName: clean((maps.teachers[eventTeacherId(row)] || {}).name), subjectName: clean((maps.subjects[eventSubjectId(row)] || {}).name) })),
    periods: [], attendance: [], contactBook: [], tuitionPayment: { requests: [] }
  };
}

async function studentPortalContact(data) {
  const session = await requireSession(data, ['student']);
  const studentId = canonicalStudentId(clean(data.studentId), await readCourseGroups());
  const bindings = await activeStudentBindingsForSession(session);
  if (!bindings.some(row => row.studentId === studentId)) throw new HttpsError('permission-denied', '沒有這位學生的查看權限。');
  const today = currentTaipeiDay();
  const from = dateKey(data.fromDate) || [COURSE_HISTORY_MIN_DATE, addDays(today, -60)].sort().pop();
  const until = dateKey(data.untilDate) || today;
  if (from < COURSE_HISTORY_MIN_DATE || from > until || until > today) throw new HttpsError('invalid-argument', '請選擇有效的查詢日期。');
  const snap = await db.collection(CONTACT_BOOK_POSTS).where('studentId', '==', studentId)
    .where('date', '>=', from).where('date', '<=', until).get();
  return { ok: true, fromDate: from, untilDate: until, contactBook: snap.docs
    .map(doc => ({ ...doc.data(), id: doc.id })).filter(row => row.active === true)
    .map(row => ({ id: row.id, studentId, date: dateKey(row.date), teacherName: clean(row.teacherName) || '老師',
      subjectName: clean(row.subjectName) || '課程', text: clean(row.text), createdAtText: clean(row.createdAtText),
      images: (row.images || []).map((image, index) => ({ id: String(index), name: clean(image.name) || `照片 ${index + 1}` })) }))
    .sort((a,b) => `${b.date}|${b.createdAtText}`.localeCompare(`${a.date}|${a.createdAtText}`)) };
}

async function studentPortalData(data) {
  if (data.section === 'overview') return studentPortalOverview(data);
  if (data.section === 'contact') return studentPortalContact(data);
  const session = await requireSession(data, ['student']);
  const sessionBindings = await activeStudentBindingsForSession(session);
  const currentIds = [...new Set(sessionBindings.map((row) => clean(row.studentId)).filter(Boolean))];
  const requested = canonicalStudentId(clean(data.studentId), await readCourseGroups());
  if (requested && !currentIds.includes(requested)) throw new HttpsError('permission-denied', '沒有這位學生的查看權限。');
  const studentIds = currentIds;
  const today = currentTaipeiDay();
  const [students, events, teachers, subjects, fixedCourses, temporaryCourses, suspensions] = await Promise.all([
    mirrorRowsIncludingInactive('students'),
    scheduleBundle(today, addDays(today, 120), '').then(bundle => bundle.resourceEvents),
    mirrorRows('teachers'),
    mirrorRows('subjects'),
    mirrorRows('fixedCourses'),
    mirrorRows('temporaryCourses'),
    reconcileStudentSuspensionsForNewSchedules(studentIds)
  ]);
  const currentStudentRows = students.filter((row) => studentIds.includes(sourceId(row)));
  const learningIds = activeLearningStudentIds(
    currentStudentRows,
    [...fixedCourses, ...temporaryCourses],
    events,
    suspensions
  );
  const activeStudentIds = studentIds.filter((id) => learningIds.has(id));
  const [periodsByStudent, attendanceByStudent, portalAttendance] = await Promise.all([
    Promise.all(activeStudentIds.map((id) => mirrorRowsByField('tuitionPeriods', 'studentId', id))),
    Promise.all(studentIds.map((id) => mirrorRowsByField('attendance', 'studentId', id))),
    portalAttendanceForStudents(studentIds)
  ]);
  const uniqueRows = (groups) => [...new Map(
    groups.flat().map((row) => [sourceId(row), row])
  ).values()];
  const mirrorPeriods = uniqueRows(periodsByStudent);
  const mirrorAttendance = uniqueRows(attendanceByStudent);
  const activeMirrorAttendance = mirrorAttendance.filter((row) =>
    activeStudentIds.includes(clean(row.studentId))
  );
  const activePortalAttendance = portalAttendance.filter((row) =>
    activeStudentIds.includes(clean(row.studentId))
  );
  const adjustedPeriods = applyPortalAttendanceToPeriods(
    mirrorPeriods,
    activeMirrorAttendance,
    activePortalAttendance
  );
  const periods = await assignNewSystemPeriodNumbers(adjustedPeriods);
  const attendance = mergePortalAttendanceRows(mirrorAttendance, portalAttendance);
  const maps = { teachers: indexById(teachers), subjects: indexById(subjects) };
  const allowed = new Set(activeStudentIds);
  const studentMap = indexById(students);
  const selectedStudents = studentIds.map((id) => {
    const row = studentMap[id] || {};
    const binding = sessionBindings.find((item) => clean(item.studentId) === id) || {};
    return {
      id,
      name: clean(row.name || binding.name) || '學生',
      phoneLast4: normalizePhone(sourcePhone(row)).slice(-4),
      accessStatus: allowed.has(id) ? 'active' : 'history_and_rental',
      accessMessage: allowed.has(id)
      ? ''
      : '目前沒有進行中的課程；仍可查看過去課表與上課紀錄，也可以使用教室租用。未來課程、堂數、學費與在籍優惠暫時關閉。'
    };
  });
  const courseById = new Map();
  [...fixedCourses, ...temporaryCourses].forEach((course) => {
    [...courseSourceIds(course), sourceId(course)].map(clean).filter(Boolean)
      .forEach((id) => courseById.set(id, course));
  });
  await ensureTuitionPaymentRequests({
    periods,
    students,
    subjects,
    teachers,
    studentIds: activeStudentIds
  });
  const paymentRequests = await tuitionPaymentRequestsForStudents(activeStudentIds);
  const contactSnapshots = await Promise.all(studentIds.map((id) =>
    db.collection(CONTACT_BOOK_POSTS).where('studentId', '==', id).where('active', '==', true).get()
  ));
  const publicContactPosts = contactSnapshots.flatMap((snapshot) => snapshot.docs.map((doc) => {
    const row = doc.data() || {};
    return {
      id: doc.id,
      studentId: clean(row.studentId),
      teacherName: clean(row.teacherName) || '老師',
      subjectName: clean(row.subjectName) || '課程',
      date: dateKey(row.date),
      startTime: clean(row.startTime),
      text: clean(row.text),
      createdAtText: clean(row.createdAtText),
      images: (row.images || []).map((image, index) => ({ id: String(index), name: clean(image.name) || `照片 ${index + 1}` }))
    };
  })).sort((left, right) => `${right.date}|${right.createdAtText}`.localeCompare(`${left.date}|${left.createdAtText}`));
  const publicPeriods = [];
  const periodCounts = new Map();
  periods.filter((row) => allowed.has(clean(row.studentId))).sort((left, right) =>
    Number(right.periodNo || right.period || 0) - Number(left.periodNo || left.period || 0)
  ).forEach((row) => {
    const id = `${clean(row.studentId)}|${clean(row.subjectId)}`;
    const count = periodCounts.get(id) || 0;
    const unpaid = tuitionOutstandingAmount(row) > 0;
    if (unpaid || count < 2) publicPeriods.push(row);
    if (!unpaid) periodCounts.set(id, count + 1);
  });
  return {
    ok: true,
    students: selectedStudents,
    bindings: sessionBindings.map((row) => {
      return {
        studentId: clean(row.studentId),
        relationship: clean(row.relationship),
        reminderLastLesson: row.reminderLastLesson !== false,
        reminderPayment: row.reminderPayment !== false,
        reminderContactBook: row.reminderContactBook !== false
      };
    }),
    // 每科目保留全部欠費及最近兩期已繳清；完整期別查詢由共用課程紀錄提供。
    periods: publicPeriods.map((row) => {
      const course = courseById.get(clean(row.sourceCourseId || row.courseId || row.fixedCourseId)) ||
        [...fixedCourses, ...temporaryCourses].filter((candidate) =>
          eventStudentIds(candidate).includes(clean(row.studentId)) &&
          (!clean(row.subjectId) || eventSubjectId(candidate) === clean(row.subjectId))
        ).sort((left, right) =>
          eventDate(right).localeCompare(eventDate(left)) ||
          eventStart(right).localeCompare(eventStart(left))
        )[0] || {};
      const linkedAttendance = attendance.find((item) => clean(item.periodId) === sourceId(row)) || {};
      const teacherId = clean(row.teacherId || row.instructorId || eventTeacherId(row) || eventTeacherId(course) || eventTeacherId(linkedAttendance));
      const namedTeacher = clean(row.teacherName || row.instructorName || course.teacherName || linkedAttendance.teacherName);
      const teacher = maps.teachers[teacherId] || teachers.find((item) =>
        namedTeacher && normalizeName(item.name || item.teacherName) === normalizeName(namedTeacher)
      ) || {};
      return {
        id: sourceId(row),
        studentId: clean(row.studentId),
        periodNo: Number(row.periodNo || row.period || 0),
        systemPeriodNo: Number(row.systemPeriodNo || 0),
        subjectId: clean(row.subjectId),
        subjectName: clean(maps.subjects[clean(row.subjectId)] && maps.subjects[clean(row.subjectId)].name),
        teacherId: teacherId || sourceId(teacher),
        teacherName: clean(teacher.name || teacher.teacherName || namedTeacher),
        teacherPhone: normalizePhone(sourcePhone(teacher)),
        lessonCount: Number(row.lessonCount || row.totalLessons || 4),
        usedCount: Number(row.usedCount || row.attendedCount || 0),
        restoredCreditCount: Number(row.portalRestoredCreditCount || 0),
        extraLessonCreditCount: Number(row.portalExtraLessonCreditCount || 0),
        expectedAmount: Number(row.expectedAmount || row.amount || 0),
        paidAmount: tuitionBasePaidAmount(row),
        status: clean(row.status),
        transactions: jsonValue(row.transactions || [])
      };
    }),
    tuitionPayment: {
      bank: TUITION_PAYMENT_BANK,
      requests: paymentRequests
        .filter((row) =>
          allowed.has(clean(row.studentId)) &&
          row.active !== false &&
          clean(row.status) !== 'cancelled'
        )
        .map(publicTuitionPaymentRequest)
    },
    attendance: attendance
      .filter((row) =>
        studentIds.includes(clean(row.studentId)) &&
        isStudentHistoryDateVisible(eventDate(row)) &&
        eventDate(row) <= today
      )
      .sort((left, right) => eventDate(left).localeCompare(eventDate(right)))
      .map((row) => {
        const course = courseById.get(clean(
          row.sourceCourseId || row.courseId || row.fixedCourseId
        )) || {};
        const teacherId = eventTeacherId(row) || eventTeacherId(course);
        const subjectId = eventSubjectId(row) || eventSubjectId(course);
        return {
          id: sourceId(row),
          studentId: clean(row.studentId),
          periodId: clean(row.periodId),
          date: eventDate(row),
          startTime: eventStart(row) || eventStart(course),
          endTime: eventEnd(row) || eventEnd(course),
          status: clean(row.status || row.type),
          source: clean(row.source),
          late: row.late === true,
          lateFeeCharged: row.lateFeeCharged === true,
          originalLessonDate: dateKey(row.originalLessonDate),
          attendanceRecordedAtText: clean(row.attendanceRecordedAtText || row.createdAtText),
          subjectName: clean(row.subjectName) ||
            clean(maps.subjects[subjectId] && maps.subjects[subjectId].name),
          teacherName: clean(row.teacherName) ||
            clean(maps.teachers[teacherId] && maps.teachers[teacherId].name)
        };
      }),
    attendanceCancellations: activePortalAttendance.filter((row) =>
      isStudentHistoryDateVisible(eventDate(row)) &&
      clean(row.source) === 'attendance-cancellation-approved' &&
      (clean(row.status) === 'cancelled' || row.active === false)
    ).map((row) => ({
      id: clean(row.__id || row.id),
      studentId: clean(row.studentId),
      date: eventDate(row),
      subjectId: clean(row.subjectId),
      teacherId: clean(row.teacherId),
      cancelledAtText: clean(row.cancelledAtText),
      note: '原格簽到已更正，保留待補登，後續格位不變'
    })),
    contactBook: publicContactPosts.filter((row) => isStudentHistoryDateVisible(row.date)),
    upcoming: nextStudentLessons(events, allowed).map((row) => ({
      id: sourceId(row),
      date: eventDate(row),
      startTime: eventStart(row),
      endTime: eventEnd(row),
      studentIds: eventStudentIds(row),
      subjectName: clean(maps.subjects[eventSubjectId(row)] && maps.subjects[eventSubjectId(row)].name),
      teacherName: clean(maps.teachers[eventTeacherId(row)] && maps.teachers[eventTeacherId(row)].name),
      teacherId: eventTeacherId(row),
      teacherPhone: normalizePhone(sourcePhone(maps.teachers[eventTeacherId(row)] || {})),
      status: clean(row.status)
    }))
  };
}


async function studentBindingAccounts(data) {
  const session = await requireSession(data, ['student']);
  const owned = await activeStudentBindingsForSession(session);
  const studentId = clean(data.studentId);
  const owners = owned.filter(row => row.studentId === studentId);
  if (!owners.length) throw new HttpsError('permission-denied', '沒有這位學生的綁定管理權限。');
  const snapshot = await db.collection('coursePortalStudentBindings').where('studentId', '==', studentId).where('status', '==', 'active').get();
  const selfRemoval = data.action === 'remove-self';
  if (data.action !== 'remove' && !selfRemoval) return { accounts: snapshot.docs.map(doc => {
    const row = doc.data();
    return { id: doc.id, name: clean(row.lineDisplayName) || (row.email ? maskedEmail(row.email) : '已綁定使用者'),
      nameSource: clean(row.lineDisplayName) ? 'LINE 名稱' : row.email ? 'Email' : '帳號名稱',
      relationship: clean(row.relationship) || '本人', mine: owners.some(own => own.__id === doc.id) };
  }) };
  const target = snapshot.docs.find(doc => doc.id === (selfRemoval ? owners[0].__id : clean(data.bindingId)));
  if (!target || (!selfRemoval && owners.some(row => row.__id === target.id))) throw new HttpsError('invalid-argument', '請選擇其他有效的綁定帳號。');
  if (data.confirmed !== true) throw new HttpsError('failed-precondition', '請再次確認解除綁定。');
  const row = target.data();
  const peers = snapshot.docs.filter(doc => (selfRemoval && owners.some(own => own.__id === doc.id)) || doc.id === target.id ||
    (row.lineUserId && doc.data().lineUserId === row.lineUserId) ||
    (row.authAccountId && doc.data().authAccountId === row.authAccountId));
  await db.runTransaction(async tx => {
    const checks = await Promise.all([...owners.map(own => tx.get(own.__ref)), ...peers.map(peer => tx.get(peer.ref))]);
    if (!checks.slice(0, owners.length).some(doc => doc.exists && doc.data().status === 'active')) throw new HttpsError('permission-denied', '您的權限已異動，請重新登入。');
    peers.forEach(peer => tx.set(peer.ref, { status: 'revoked', approvalStatus: 'revoked', revokedReason: selfRemoval ? 'self-unbound' : 'peer-unbound',
      revokedByBindingId: owners[0].__id, revokedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
  });
  // Existing sessions cannot regain this student merely because a fresh binding is later created.
  const sessionQueries = [];
  if (row.lineUserId) sessionQueries.push(db.collection('coursePortalSessions').where('lineUserId', '==', row.lineUserId).get());
  if (row.authAccountId) sessionQueries.push(db.collection('coursePortalSessions').where('authAccountId', '==', row.authAccountId).get());
  const sessions = await Promise.all(sessionQueries);
  for (const old of new Map(sessions.flatMap(result => result.docs).map(doc => [doc.id, doc])).values()) {
    if (old.data().role === 'student') await old.ref.set({ revokedStudentIds: FieldValue.arrayUnion(studentId) }, { merge: true });
  }
  if (selfRemoval) {
    const pending = await db.collection('notificationQueue').where('studentId', '==', studentId).get();
    const recipients = peers.map(peer => recipientFields(peer.data()));
    for (const notice of pending.docs) {
      await db.runTransaction(async tx => {
        const latest = await tx.get(notice.ref);
        if (!latest.exists) return;
        const value = latest.data();
        if (!['待發送', 'pending', 'failed', '發送失敗'].includes(clean(value.status))) return;
        if (!recipients.some(recipient =>
          recipient.targetLineUserId && recipient.targetLineUserId === value.targetLineUserId ||
          recipient.targetEmail && recipient.targetEmail.toLowerCase() === clean(value.targetEmail).toLowerCase())) return;
        tx.set(notice.ref, {status:'已取消', cancelReason:'使用者已解除此學生的綁定', updatedAt:FieldValue.serverTimestamp()}, {merge:true});
      });
    }
  }
  if (!selfRemoval) await queueCoursePortalNotice(`binding-removed-${target.id}-${randomToken(8)}`, { ...recipientFields(row),
    title: '學生資料存取權限異動', eventCode: 'student_binding_removed', studentId,
    body: `您與${clean(row.name) || '學生'}的帳號綁定已由另一位已綁定使用者解除，目前無法查看該學生的資料。\n若有疑問，請聯絡柚子樂器官方 LINE，我們會協助確認。`
  });
  return { ok: true };
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
    reminderLastLesson: false,
    reminderPayment: data.reminderPayment !== false,
    ...(Object.hasOwn(data, 'reminderContactBook') ? {reminderContactBook:data.reminderContactBook !== false} : {}),
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
  if (requestedDuration > policy.maxDurationMinutes) {
    throw new HttpsError(
      'invalid-argument',
      `單次租用最長為 ${Math.round(policy.maxDurationMinutes / 60 * 10) / 10} 小時，請重新選擇租用時間。`
    );
  }
  const duration = requestedDuration;
  const startMinutes = timeMinutes(startTime);
  const endMinutes = startMinutes + duration;
  const endTime = String(Math.floor(endMinutes / 60)).padStart(2, '0') + ':' + String(endMinutes % 60).padStart(2, '0');
  if (!date || !validPortalTime(startTime, true)) throw new HttpsError('invalid-argument', '請選擇 30 分鐘整點的日期與時間。');
  assertPortalAdvanceDate(date, '租用日期');
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
  const rentalRate = rentalRateForRole(session.role, clean(data.rentalMode), discountRequested, studentRate, policy.studentDiscountRate);
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
        : rentalAmount(baseFee, duration, rentalRate.rate),
      priceRangeText: selectedUse.id === 'recording' ? 'NT$100–300／小時' : '',
      priceType: rentalRate.label
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
  assertPortalAdvanceDate(date, '租用日期');
  const policy = await rentalPolicySettings();
  const requestedDuration = Number(data.durationMinutes == null ? 60 : data.durationMinutes);
  if (!Number.isFinite(requestedDuration) || requestedDuration < 30 || requestedDuration % 30 !== 0) {
    throw new HttpsError('invalid-argument', '租用時間必須以 30 分鐘為單位。');
  }
  if (requestedDuration > policy.maxDurationMinutes) {
    throw new HttpsError('invalid-argument', '單次租用最長為 5 小時，請重新選擇租用時間。');
  }
  const duration = requestedDuration;
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
  const identityPromise = rentalSessionIdentity(session);
  const studentDiscountEligiblePromise = session.role === 'student'
    ? activeStudentIdsForSession(session).then((ids) => ids.length > 0)
    : Promise.resolve(false);
  const requestedStartDate = dateKey(data.startDate || data.date);
  if (!requestedStartDate) throw new HttpsError('invalid-argument', '請選擇週起始日期。');
  assertPortalAdvanceDate(requestedStartDate, '租用日期');
  const startDate = requestedStartDate < currentTaipeiDay() ? currentTaipeiDay() : requestedStartDate;
  const endDate = [addDays(startDate, 6), portalMaximumAdvanceDate()].sort()[0];
  const policy = await rentalPolicySettings();
  const requestedDuration = Number(data.durationMinutes == null ? 60 : data.durationMinutes);
  if (!Number.isFinite(requestedDuration) || requestedDuration < 30 || requestedDuration % 30 !== 0) {
    throw new HttpsError('invalid-argument', '租用時間必須以 30 分鐘為單位。');
  }
  if (requestedDuration > policy.maxDurationMinutes) {
    throw new HttpsError('invalid-argument', '單次租用最長為 5 小時，請重新選擇租用時間。');
  }
  const duration = requestedDuration;
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
  const dayCount = Math.max(
    1,
    Math.round(
      (Date.parse(`${endDate}T12:00:00+08:00`) - Date.parse(`${startDate}T12:00:00+08:00`)) /
      86400000
    ) + 1
  );
  for (let offset = 0; offset < dayCount; offset += 1) {
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
  const identity = await identityPromise;
  return {
    ok: true,
    startDate,
    endDate,
    role: session.role,
    studentDiscountEligible: await studentDiscountEligiblePromise,
    displayName: identity.displayName,
    studentOptions: identity.studentOptions,
    requiresStudentSelection: identity.requiresStudentSelection,
    durationMinutes: duration,
    selectedUseType,
    useOptions,
    businessHours: policy.businessHours,
    days
  };
}

async function createRoomBooking(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const identityPromise = rentalSessionIdentity(session, data.studentId);
  const recordingSelection = recordingRentalSelection(data, true);
  const expectedVersion = await readScheduleVersion();
  const availability = await rentalAvailability(data);
  if (publicRentalSlotIsPast(availability.date, availability.startTime)) {
    throw new HttpsError('failed-precondition', '只能預約尚未開始的時段。');
  }
  const room = availability.rooms.find((item) => item.id === clean(data.roomId));
  if (!room || !room.available) throw new HttpsError('failed-precondition', room && room.reason || '這間教室目前不能預約。');
  const id = db.collection('coursePortalRoomBookings').doc().id;
  const identity = await identityPromise;
  if (session.role === 'teacher' && clean(data.rentalMode) === 'general') {
    identity.clientName = clean(data.clientName).slice(0, 100);
    if (!identity.clientName) throw new HttpsError('invalid-argument', '請填寫實際租用人姓名。');
  }
  if (!identity.clientName) {
    throw new HttpsError(
      'invalid-argument',
      session.role === 'student' ? '請選擇本次使用教室的學生。' : '登入資料缺少租用人姓名，請重新登入。'
    );
  }
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
    rentalStudentId: identity.studentId,
    clientName: identity.clientName,
    clientPhone: identity.clientPhone,
    studentDiscountRequested: room.priceType === '柚子學生半價',
    rentalMode: session.role === 'teacher' ? (clean(data.rentalMode) === 'teacher' ? 'teacher' : 'general') : session.role,
    ownerKey,
    lineUserId: clean(session.lineUserId),
    authAccountId: clean(session.authAccountId),
    amount: room.price,
    recommendedPeople: Number(room.capacity || 0),
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
        throw new HttpsError(
          'already-exists',
          '這個時段剛剛已被其他人預約，空位資料已經更新，請重新選擇時段或教室。'
        );
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
  const rentalRecipient = await portalRecipientForSession(session);
  await db.collection('coursePortalRoomBookings').doc(id).set({ notificationEmail: rentalRecipient.targetEmail }, { merge: true });
  const reminderAt = Math.max(Date.now(), taipeiDateTimeMillis(booking.date, booking.startTime) - 60 * 60 * 1000);
  if (notificationRecipientKey(rentalRecipient)) {
    await db.collection('notificationQueue').doc(`course-portal-booking-${id}-reminder`).set({
      queueId: `course-portal-booking-${id}-reminder`,
      ...rentalRecipient,
      title: '教室租用提醒',
      body: [
        `您預約的「${booking.roomName}」將於 ${booking.date} ${booking.startTime} 開始。`,
        `用途：${booking.useName || '教室租用'}`,
        booking.recordingUsageName ? `錄音室使用方式：${booking.recordingUsageName}` : '',
        `時間：${booking.startTime}～${booking.endTime}`,
        `如不使用，請在租用開始前進入租用頁取消：${PORTAL_BASE}/room-booking.html`
      ].filter(Boolean).join('\n'),
      message: [
        `教室租用提醒`,
        `您預約的「${booking.roomName}」將於 ${booking.date} ${booking.startTime} 開始。`,
        `時間：${booking.startTime}～${booking.endTime}`,
        `如不使用，請在租用開始前進入租用頁取消：${PORTAL_BASE}/room-booking.html`
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
      clientName: safeRentalDisplayName(row.clientName),
      clientPhone: normalizePhone(row.clientPhone),
      rentalStudentId: clean(row.rentalStudentId),
      useType: clean(row.useType),
      useName: clean(row.useName),
      recordingUsage: clean(row.recordingUsage),
      recordingUsageName: clean(row.recordingUsageName),
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
    if (taipeiDateTimeMillis(booking.date, booking.startTime) <= Date.now()) {
      throw new HttpsError('failed-precondition', '租用時間已經開始，無法再自行取消。');
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

function teacherEventMatchesRequest(event, teacherId, sourceDate, sourceEventId, sourceCourseId, portalChangeId) {
  const wantedEventId = clean(sourceEventId);
  const wantedCourseId = clean(sourceCourseId);
  const wantedPortalChangeId = clean(portalChangeId);
  if (!wantedEventId && !wantedCourseId && !wantedPortalChangeId) return false;
  if (
    clean(event && event.teacherId) !== clean(teacherId) ||
    eventDate(event || {}) !== dateKey(sourceDate)
  ) return false;
  if (
    wantedEventId &&
    ![event && event.id, event && event.sourceId].map(clean).includes(wantedEventId)
  ) return false;
  if (
    wantedCourseId &&
    ![event && event.fixedCourseId, event && event.seriesId,
      !clean(event && (event.fixedCourseId || event.seriesId)) && event && event.sourceId,
      !clean(event && (event.fixedCourseId || event.seriesId)) && event && event.id].map(clean).includes(wantedCourseId)
  ) return false;
  if (wantedPortalChangeId && clean(event && event.portalChangeId) !== wantedPortalChangeId) return false;
  return true;
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
      if (!dateKey(row.event && row.event.date) || dateKey(row.event.date) < currentTaipeiDay()) {
        throw new HttpsError('failed-precondition', '不可取消今天以前的課程安排。');
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
  let source = bundle.events.find((event) => teacherEventMatchesRequest(
    event,
    session.teacherId,
    sourceDate,
    sourceEventId,
    sourceCourseId,
    portalChangeId
  ));
  if (!source) source = (await teacherAttendanceEvent(session, data)).event;
  if (!source) throw new HttpsError('not-found', '找不到這堂課，請重新整理後再試。');
  if (isRoomRentalEvent(source)) {
    throw new HttpsError('failed-precondition', '教室租用不是學生課程，不能標示請假或曠課。');
  }
  if (source.studentIds.length > 1) {
    throw new HttpsError('failed-precondition', '團體課需逐位記錄學生狀態，不能用整堂請假／曠課，以免誤釋出仍在上課的教室。');
  }
  const today = currentTaipeiDay();
  if (sourceDate < today) {
    throw new HttpsError('failed-precondition', '這堂課已經超過當天，只能查看或使用補簽到。');
  }
  if (state === 'absent' && (
    sourceDate !== today ||
    taipeiDateTimeMillis(sourceDate, source.startTime) > Date.now()
  )) {
    throw new HttpsError('failed-precondition', '課程開始時間到達後才能標示曠課。');
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
    paymentStatus: state === 'absent' ? 'student_absent_no_pay' : 'student_leave',
    teacherPayable: false,
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
  const absenceOperationId = attendanceOperationId(session.teacherId, sourceDate, source, { sourceEventId, sourceCourseId });
  const absenceRef = db.collection(ATTENDANCE_RECORDS).doc(hash([absenceOperationId, source.studentIds[0]].join('|')));
  const existingAbsence = await absenceRef.get();
  if (state === 'absent' && existingAbsence.exists && existingAbsence.data().active !== false && existingAbsence.data().status === 'absent') {
    return { ok:true, id, state, message:'已標示曠課，未重複扣堂。' };
  }
  const absencePeriods = state === 'absent' ? await attendancePeriodsForEvent(source, sourceDate, { allowRollover:true }) : { rows:[], rollovers:[] };
  const absencePeriod = absencePeriods.rows[0] && absencePeriods.rows[0].period;
  if (absencePeriod) {
    changePayload.event.tuitionPeriodId = sourceId(absencePeriod);
    changePayload.event.studentLessonDeducted = true;
  }
  const absenceRolloverRefs = absencePeriods.rollovers.flatMap(row => [db.collection(TUITION_PERIODS).doc(row.period.id), db.collection(TUITION_PAYMENT_REQUESTS).doc(row.paymentRequest.id)]);
  const versionRef = scheduleVersionRef();
  await db.runTransaction(async (tx) => {
    const [versionSnapshot, changeSnapshot, ...priorSnapshots] = await Promise.all([
      tx.get(versionRef),
      tx.get(changeRef),
      ...priorStatusRefs.map((ref) => tx.get(ref))
    ]);
    const absenceSnapshot = await tx.get(absenceRef);
    const rolloverSnapshots = await Promise.all(absenceRolloverRefs.map(ref => tx.get(ref)));
    assertScheduleWritable(versionSnapshot);
    const currentVersion = Number(versionSnapshot.exists && versionSnapshot.data().version || 0);
    if (currentVersion !== expectedVersion) {
      throw new HttpsError('aborted', '課表剛剛有更新，已停止這次操作；請重新整理後再確認。');
    }
    if (absenceSnapshot.exists && absenceSnapshot.data().status === 'attended' && absenceSnapshot.data().active !== false) {
      throw new HttpsError('already-exists', '這堂課已完成簽到，請重新整理。');
    }
    absencePeriods.rollovers.forEach((row, index) => {
      if (rolloverSnapshots[index * 2].exists) assertAttendanceRolloverPeriod(rolloverSnapshots[index * 2].data(), row.period);
      else tx.set(absenceRolloverRefs[index * 2], { ...row.period, createdAt:FieldValue.serverTimestamp() });
      if (rolloverSnapshots[index * 2 + 1].exists) assertAttendanceRolloverPaymentRequest(rolloverSnapshots[index * 2 + 1].data(), row.paymentRequest, row.period.id);
      else tx.set(absenceRolloverRefs[index * 2 + 1], { ...row.paymentRequest, createdAt:FieldValue.serverTimestamp() });
    });
    if (state === 'absent') tx.set(absenceRef, {
      id:absenceRef.id, operationId:absenceOperationId, active:true, status:'absent', source:'teacher-absence',
      teacherId:session.teacherId, studentId:source.studentIds[0], studentIds:source.studentIds, subjectId:source.subjectId,
      periodId:sourceId(absencePeriod), eventId:clean(source.sourceId || sourceEventId || source.id),
      courseId:clean(source.fixedCourseId || sourceCourseId), date:sourceDate, startTime:source.startTime,
      deducted:true, teacherPayable:false, createdAt:FieldValue.serverTimestamp(), createdAtText:nowText()
    });
    else if (absenceSnapshot.exists && absenceSnapshot.data().status === 'absent') tx.set(absenceRef, { active:false, deducted:false, updatedAt:FieldValue.serverTimestamp() }, { merge:true });
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
    message: state === 'absent' ? '已標示曠課並扣一堂；未完成簽到，不列入老師薪資。' : '已標示請假，不扣堂，該教室時段已釋出。'
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
  const targetDuration = assertPortalInterval(startTime, endTime);
  if (courseDateIsPast(date)) {
    throw new HttpsError('failed-precondition', '不可選擇今天以前的日期。');
  }
  assertPortalAdvanceDate(date, '課程日期');
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

  const restoreMode = await irregularRestoreMode(data, session);
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
    source = restoreMode ? irregularSource(restoreMode, sourceDate) : sourceBundle.resourceEvents.find((event) =>
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
    if (courseDateIsPast(source.date)) {
      throw new HttpsError('failed-precondition', '今天以前的課程不能再調動。');
    }
    sourceSeries = sourceBundle.fixedCourses.find((row) =>
      sourceId(row) === clean(source.fixedCourseId || source.seriesId || requestedSourceCourseId)
    ) || (sourceBundle.scheduleChanges.find((row) =>
      clean(row.__id) === clean(source.portalChangeId) ||
      clean(row.sourceCourseId) === clean(source.fixedCourseId || source.seriesId)
    ) || {}).event || null;
    assertTeacherMoveDuration(targetDuration, source);
  } else if (data.durationMinutes != null) {
    const declaredDuration = Number(data.durationMinutes);
    if (
      !Number.isFinite(declaredDuration) ||
      declaredDuration < 30 ||
      declaredDuration > 300 ||
      declaredDuration % 30 !== 0 ||
      declaredDuration !== targetDuration
    ) {
      throw new HttpsError('failed-precondition', '加課時段與課程長度不一致，請重新選擇完整空位。');
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
  const ignoredSource = (event) => Boolean(source) && ((action === 'permanent_move' && event.date >= date && normalizeScheduleStatus(event.status) !== 'attended' && sameTeachingCourse(event, source)) || event.date === source.date && (
    event.id === source.id ||
    event.sourceId === source.sourceId ||
    (lineage && (event.fixedCourseId === lineage || event.seriesId === lineage))
  ));
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
    durationMinutes: targetDuration,
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
        permanentCutover(row) === date;
    }).map((doc) => doc.ref);
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
        const sourceMatch = sameTeachingCourse(row, source);
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
    effectiveDate: action === 'permanent_move' ? date : '',
    cutoverDate: action === 'permanent_move' ? date : '',
    anchorDate: action === 'permanent_move' ? date : '',
    replaceMatchingCourse: action === 'permanent_move',
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
    if (courseDateIsPast(date)) {
      throw new HttpsError('failed-precondition', '不可選擇今天以前的日期。');
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
    if (restoreMode) tx.update(db.collection('coursePortalIrregularCourses').doc(restoreMode.id), {resumedFrom:date,resumeChangeId:id,updatedAt:FieldValue.serverTimestamp()});
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

function attendanceLineage(event, data = {}) {
  return clean(
    event && (event.fixedCourseId || event.sourceId || event.id) ||
    data.sourceCourseId ||
    data.sourceEventId
  );
}

function attendanceOperationId(teacherId, sourceDate, event, data = {}) {
  return hash([
    'teacher-attendance',
    clean(teacherId),
    dateKey(sourceDate),
    attendanceLineage(event, data)
  ].join('|'));
}

function attendanceLessonLockId(sourceDate, event, data = {}) {
  return hash([
    'teacher-attendance-lesson',
    dateKey(sourceDate),
    attendanceLineage(event, data)
  ].join('|'));
}

function canReinstateSameDayTeacherCancellation(sourceDate, operationId, cancellation, lessonLock, today = currentTaipeiDay()) {
  const cancellationId = clean(cancellation && cancellation.id);
  return dateKey(sourceDate) === dateKey(today) &&
    clean(cancellation && cancellation.status) === 'approved' &&
    clean(cancellation && cancellation.approvalMode) === 'same_day_teacher' &&
    dateKey(cancellation && cancellation.date) === dateKey(sourceDate) &&
    clean(cancellation && cancellation.operationId) === clean(operationId) &&
    clean(lessonLock && lessonLock.status) === 'cancelled' &&
    clean(lessonLock && lessonLock.operationId) === clean(operationId) &&
    (!clean(lessonLock && lessonLock.cancellationRequestId) ||
      !cancellationId ||
      clean(lessonLock && lessonLock.cancellationRequestId) === cancellationId);
}

async function teacherAttendanceEvent(session, data) {
  const sourceDate = dateKey(data.sourceDate);
  const sourceEventId = clean(data.sourceEventId);
  const sourceCourseId = clean(data.sourceCourseId);
  const portalChangeId = clean(data.portalChangeId);
  if (!sourceDate || (!sourceEventId && !sourceCourseId)) {
    throw new HttpsError('invalid-argument', '缺少要處理的課程。');
  }
  const bundle = await scheduleBundle(sourceDate, sourceDate, session.teacherId);
  let event = bundle.events.find((row) => teacherEventMatchesRequest(
    row,
    session.teacherId,
    sourceDate,
    sourceEventId,
    sourceCourseId,
    portalChangeId
  ));
  if (!event && sourceEventId) {
    // A successful status write changes the visible event ID. Resolve a retry
    // only through this teacher/date's persisted source-event alias.
    const aliasIds = new Set((bundle.scheduleChanges || []).filter(change =>
      clean(change.sourceEventId) === sourceEventId && dateKey(change.sourceDate) === sourceDate &&
      clean(change.event && change.event.teacherId) === clean(session.teacherId)
    ).map(change => clean(change.id || change.__id)));
    const aliases = bundle.events.filter(row => clean(row.teacherId) === clean(session.teacherId) && eventDate(row) === sourceDate &&
      (aliasIds.has(clean(row.portalChangeId)) || clean(row.fixedCourseId) === sourceEventId));
    if (aliases.length === 1) event = aliases[0];
  }
  if (!event) throw new HttpsError('not-found', '找不到這堂課。');
  if (isRoomRentalEvent(event)) {
    throw new HttpsError('failed-precondition', '教室租用不是學生課程，不能處理學生簽到。');
  }
  if (!(event.studentIds || []).length) {
    throw new HttpsError('failed-precondition', '這堂課沒有學生，不能簽到。');
  }
  return { sourceDate, sourceEventId, sourceCourseId, event };
}

async function attendancePeriodsForEvent(event, sourceDate, options = {}) {
  const studentIds = [...new Set(eventStudentIds(event).map(clean).filter(Boolean))];
  const baseGroups = await Promise.all(studentIds.map(async (studentId) => {
    const [periods, mirrorAttendance, portalAttendanceSnapshot] = await Promise.all([
      mirrorRowsByField('tuitionPeriods', 'studentId', studentId),
      mirrorRowsByField('attendance', 'studentId', studentId),
      db.collection(ATTENDANCE_RECORDS).where('studentId', '==', studentId).get()
    ]);
    const portalAttendance = portalAttendanceSnapshot.docs.map((doc) =>
      Object.assign({ __id: doc.id }, jsonValue(doc.data()) || {})
    );
    const correctionsSnapshot = await db.collection('coursePortalAttendanceCorrections').where('studentId', '==', studentId).get();
    const pendingSlots = correctionsSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(row => row.status === 'pending');
    const selectedId = clean((options.correctionIds || {})[studentId]);
    const correction = pendingSlots.find(row => row.id === selectedId && row.teacherId === eventTeacherId(event) && row.subjectId === eventSubjectId(event));
    if (selectedId && !correction) throw new HttpsError('failed-precondition', '補回格位已使用或不屬於這堂課，請重新整理。');
    const adjustedPeriods = applyPortalAttendanceToPeriods(periods, mirrorAttendance, portalAttendance).map(period => ({ ...period,
      usedCount: Number(period.usedCount || 0) + pendingSlots.filter(slot => slot.periodId === sourceId(period) && slot.id !== selectedId).length }));
    // mirror 舊期別不會內嵌新系統期數；先讀取／建立持久 mapping，不可每次都假設上期是第 1 期。
    const effectivePeriods = options.allowRollover === true
      ? await assignNewSystemPeriodNumbers(adjustedPeriods)
      : adjustedPeriods;
    const historicalSplitSource = options.allowRollover === true
      ? attendanceHistoricalSplitSource(
        effectivePeriods,
        event,
        studentId,
        sourceDate,
        options.allowRollover
      )
      : null;
    const priorAbsence = portalAttendance.find(row => row.active !== false && row.status === 'absent' &&
      eventDate(row) === sourceDate && eventTeacherId(row) === eventTeacherId(event) &&
      eventSubjectId(row) === eventSubjectId(event) && clean(row.courseId) === clean(event.fixedCourseId || event.sourceId));
    return { studentId, mirrorAttendance, effectivePeriods, historicalSplitSource, priorAbsence, correction };
  }));
  const needsHistoricalPayroll = baseGroups.some((group) => Boolean(group.historicalSplitSource));
  const teacherId = eventTeacherId(event || {});
  const [mirrorTeacherPayroll, portalTeacherPayrollSnapshot] = needsHistoricalPayroll && teacherId
    ? await Promise.all([
      mirrorRowsByField('teacherPayroll', 'teacherId', teacherId),
      db.collection(ATTENDANCE_PAYROLL).where('teacherId', '==', teacherId).get()
    ])
    : [[], { docs: [] }];
  const portalTeacherPayroll = portalTeacherPayrollSnapshot.docs.map((doc) =>
    Object.assign({ __id: doc.id }, jsonValue(doc.data()) || {})
  );
  const groups = baseGroups.map(({
    studentId,
    mirrorAttendance,
    effectivePeriods,
    historicalSplitSource,
    priorAbsence, correction
  }) => {
    const historicalPayroll = teacherPayrollSplitRows(
      enrichTeacherPayrollRows(mirrorTeacherPayroll, mirrorAttendance).concat(portalTeacherPayroll)
    );
    const historicalSourceId = sourceId(historicalSplitSource || {});
    const payrollReadyPeriods = historicalSplitSource
      ? effectivePeriods.map((period) => (
        period === historicalSplitSource || historicalSourceId && sourceId(period) === historicalSourceId
          ? periodWithHistoricalTeacherSplit(period, historicalPayroll, event, studentId, sourceDate)
          : period
      ))
      : effectivePeriods;
    const existingPeriod = (correction && payrollReadyPeriods.find(row => sourceId(row) === correction.periodId)) || (priorAbsence && payrollReadyPeriods.find(row => sourceId(row) === clean(priorAbsence.periodId))) ||
      attendancePeriodCandidate(payrollReadyPeriods, event, studentId, sourceDate);
    const rollover = !existingPeriod && options.allowRollover === true
      ? buildAttendanceTuitionRollover({
        periods: payrollReadyPeriods,
        event,
        studentId,
        sourceDate
      })
      : null;
    return {
      studentId,
      period: existingPeriod || rollover && rollover.period,
      rollover
    };
  });
  const missing = groups.filter((row) => !row.period);
  if (missing.length && options.allowMissing !== true) {
    throw new HttpsError(
      'failed-precondition',
      `找不到 ${missing.length} 位學生在本堂課適用且尚有堂數的學費期別；已停止簽到，請先確認期別資料。`
    );
  }
  const rows = groups.filter((row) => row.period);
  return {
    rows,
    rollovers: groups.map((row) => row.rollover).filter(Boolean),
    byStudent: rows.reduce((map, row) => {
      map[row.studentId] = row.period;
      return map;
    }, {})
  };
}

function attendanceChangePayload(event, sourceDate, sourceEventId, sourceCourseId, teacherId, status, note) {
  const lineage = attendanceLineage(event, { sourceEventId, sourceCourseId });
  const id = `lesson-status-${hash([teacherId, lineage, sourceDate].join('|'))}`;
  return {
    id,
    action: 'lesson_status',
    active: true,
    sourceEventId: clean(event.sourceId || sourceEventId || event.id),
    sourceCourseId: clean(event.fixedCourseId || sourceCourseId || lineage),
    sourceDate,
    event: {
      id: randomToken(12),
      date: sourceDate,
      startTime: event.startTime,
      endTime: event.endTime,
      roomId: event.roomId,
      teacherId,
      studentId: (event.studentIds || [])[0] || '',
      studentIds: event.studentIds || [],
      subjectId: event.subjectId,
      fixedCourseId: clean(event.fixedCourseId || sourceCourseId || lineage),
      tuitionPeriodId: clean(event.tuitionPeriodId),
      type: event.type || 'lesson',
      status,
      paymentStatus: clean(event.paymentStatus),
      teacherPayAdjustment: Number(event.teacherPayAdjustment || 0),
      teacherPayAdjustmentReason: clean(event.teacherPayAdjustmentReason),
      specialLesson: event.specialLesson === true,
      specialLessonPrice: Number(event.specialLessonPrice || 0),
      specialTeacherPay: Number(event.specialTeacherPay || 0),
      teacherPayable: status === 'attended',
      note: clean(note)
    },
    createdByTeacherId: teacherId,
    createdAt: FieldValue.serverTimestamp(),
    createdAtText: nowText(),
    updatedAt: FieldValue.serverTimestamp()
  };
}

async function applyTeacherAttendance(data, late, managerSession = null) {
  const session = managerSession || await requireSession(data, ['teacher']);
  const resolved = await teacherAttendanceEvent(session, data);
  const { sourceDate, sourceEventId, sourceCourseId, event } = resolved;
  const today = currentTaipeiDay();
  if (!managerSession && sourceDate < today) throw new HttpsError('failed-precondition', '已超過當天晚上 12 點，請聯絡管理者協助更正紀錄。');
  if (!managerSession && late && sourceDate >= today) {
    throw new HttpsError('failed-precondition', '當日課程請在晚上 12 點前使用正常簽到；隔日後才會顯示補簽到。');
  }
  if (!managerSession && !late && sourceDate !== today) {
    throw new HttpsError('failed-precondition', sourceDate < today
      ? '這堂課已超過當日晚上 12 點，請改用補簽到。'
      : '尚未到上課日期，不能提前簽到。');
  }
  if (managerSession && sourceDate > today) throw new HttpsError('failed-precondition', '尚未到上課日期，不能提前簽到。');
  const earlyAttendance = !late && taipeiDateTimeMillis(sourceDate, event.startTime) > Date.now();
  const normalized = normalizeScheduleStatus(event.status);
  if (managerSession && normalized === 'attended') return { ok: true, duplicate: true };
  const allowedStatuses = managerSession ? ['scheduled', 'absent', 'leave'] : late ? ['scheduled', 'absent'] : ['scheduled'];
  if (!allowedStatuses.includes(normalized)) {
    throw new HttpsError('failed-precondition', '請假、已簽到或已取消的課程不能再次簽到。');
  }
  const operationId = attendanceOperationId(session.teacherId, sourceDate, event, data);
  const expectedVersion = await readScheduleVersion();
  const giftLesson = event.specialLesson === true ||
    clean(event.portalAction) === 'teacher_gift' ||
    clean(event.type) === 'teacher_gift';
  const chargeLateFee = !managerSession && late && !giftLesson;
  const statusRef = db.collection('coursePortalScheduleChanges')
    .doc(`lesson-status-${hash([session.teacherId, attendanceLineage(event, data), sourceDate].join('|'))}`);
  const lateRef = db.collection('coursePortalLateAttendance').doc(operationId);
  const adjustmentRef = db.collection('coursePortalTeacherAdjustments').doc(`attendance-fee-${operationId}`);
  const payrollRef = db.collection(ATTENDANCE_PAYROLL).doc(operationId);
  const priorCancellationRef = db.collection(ATTENDANCE_CANCELLATIONS)
    .doc(hash(['attendance-cancellation', operationId].join('|')));
  const lessonLockRef = db.collection('coursePortalAttendanceLessonLocks')
    .doc(attendanceLessonLockId(sourceDate, event, { sourceEventId, sourceCourseId }));
  const versionRef = scheduleVersionRef();
  const periodResolution = await attendancePeriodsForEvent(event, sourceDate, {
    allowMissing: giftLesson,
    correctionIds: data.correctionIds || {},
    allowRollover: !giftLesson
  });
  const correctionRefs = Object.entries(data.correctionIds || {}).map(([studentId, id]) => ({ studentId, ref: db.collection('coursePortalAttendanceCorrections').doc(clean(id)) }));
  const payrollCalculation = attendancePayrollCalculation(event, periodResolution.rows, sourceDate);
  const periodIds = Object.keys(periodResolution.byStudent).reduce((map, studentId) => {
    map[studentId] = sourceId(periodResolution.byStudent[studentId]);
    return map;
  }, {});
  const attendanceRows = eventStudentIds(event).map((studentId) => ({
    id: hash([operationId, studentId].join('|')),
    studentId: clean(studentId)
  }));
  const attendanceRefs = attendanceRows.map((row) => db.collection(ATTENDANCE_RECORDS).doc(row.id));
  const tuitionRollovers = periodResolution.rollovers || [];
  const rolloverPeriodRefs = tuitionRollovers.map((row) =>
    db.collection(TUITION_PERIODS).doc(clean(row.period.id))
  );
  const rolloverPaymentRefs = tuitionRollovers.map((row) =>
    db.collection(TUITION_PAYMENT_REQUESTS).doc(clean(row.paymentRequest.id))
  );
  const changePayload = attendanceChangePayload(
    event,
    sourceDate,
    sourceEventId,
    sourceCourseId,
    session.teacherId,
    'attended',
    late ? '老師補簽到' : '老師當日簽到'
  );
  changePayload.event.tuitionPeriodId = giftLesson ? '' : clean(periodIds[attendanceRows[0] && attendanceRows[0].studentId]);
  changePayload.event.tuitionPeriodIds = giftLesson ? {} : Object.assign({}, periodIds);
  changePayload.event.teacherPayable = payrollCalculation.teacherPayable !== false;
  await db.runTransaction(async (tx) => {
    const snapshots = await Promise.all([
      tx.get(versionRef),
      tx.get(statusRef),
      tx.get(lateRef),
      tx.get(payrollRef),
      tx.get(priorCancellationRef),
      tx.get(lessonLockRef),
      ...attendanceRefs.map((ref) => tx.get(ref)),
      ...rolloverPeriodRefs.map((ref) => tx.get(ref)),
      ...rolloverPaymentRefs.map((ref) => tx.get(ref)),
      ...correctionRefs.map(item => tx.get(item.ref))
    ]);
    const correctionSnapshots = correctionRefs.length ? snapshots.slice(-correctionRefs.length) : [];
    correctionRefs.forEach((item, index) => {
      const slot = correctionSnapshots[index].exists ? correctionSnapshots[index].data() : null;
      if (!slot || slot.status !== 'pending' || slot.studentId !== item.studentId || slot.teacherId !== session.teacherId || slot.subjectId !== eventSubjectId(event) || !eventStudentIds(event).includes(item.studentId) || slot.periodId !== periodIds[item.studentId]) throw new HttpsError('failed-precondition', '補回格位已異動，請重新整理。');
    });
    const attendanceOffset = 6;
    const rolloverPeriodOffset = attendanceOffset + attendanceRefs.length;
    const rolloverPaymentOffset = rolloverPeriodOffset + rolloverPeriodRefs.length;
    const versionSnapshot = snapshots[0];
    assertScheduleWritable(versionSnapshot);
    const currentVersion = Number(versionSnapshot.exists && versionSnapshot.data().version || 0);
    if (currentVersion !== expectedVersion) {
      throw new HttpsError(
        'aborted',
        '這堂課剛剛已在其他裝置更新。為避免覆蓋資料，請重新整理後再操作。'
      );
    }
    const existingCancellation = snapshots[4].exists ? Object.assign({ id: priorCancellationRef.id }, snapshots[4].data() || {}) : {};
    const existingLessonLock = snapshots[5].exists ? snapshots[5].data() || {} : {};
    const sameDayReinstatement = Boolean(managerSession && (clean(existingCancellation.status) === 'approved' || clean(existingLessonLock.status) === 'cancelled')) || !late && canReinstateSameDayTeacherCancellation(
      sourceDate,
      operationId,
      existingCancellation,
      existingLessonLock,
      today
    );
    if (clean(existingCancellation.status) === 'approved' && !sameDayReinstatement) {
      throw new HttpsError(
        'failed-precondition',
        '這堂課的取消簽到已經核准；如需恢復，請先由管理者處理，避免重複計薪。'
      );
    }
    if (clean(existingLessonLock.status) === 'cancelled' && !sameDayReinstatement) {
      throw new HttpsError(
        'failed-precondition',
        '這堂課的簽到已取消並鎖定；請先由管理者恢復後才能重新簽到，改派老師也不能重複計薪。'
      );
    }
    if (
      existingLessonLock.active !== false &&
      clean(existingLessonLock.status) === 'attended' &&
      clean(existingLessonLock.operationId) !== operationId
    ) {
      throw new HttpsError('already-exists', '這堂課已由另一位老師完成簽到，不會重複建立薪資。');
    }
    const existingAttendance = snapshots.slice(attendanceOffset, rolloverPeriodOffset).some((snapshot) =>
      snapshot.exists && clean(snapshot.data().status) === 'attended'
    );
    if (existingAttendance) throw new HttpsError('already-exists', '這堂課已經完成簽到。');
    const existingPayroll = snapshots[3].exists ? snapshots[3].data() || {} : {};
    if (clean(existingPayroll.status) === 'attended' && existingPayroll.active !== false) {
      throw new HttpsError('already-exists', '這堂課的薪資已經記錄，不會重複建立。');
    }
    const existingStatus = snapshots[1].exists ? snapshots[1].data() || {} : {};
    if (normalizeScheduleStatus(existingStatus.event && existingStatus.event.status) === 'attended') {
      throw new HttpsError('already-exists', '這堂課已經完成簽到。');
    }
    tuitionRollovers.forEach((rollover, index) => {
      const periodSnapshot = snapshots[rolloverPeriodOffset + index];
      const paymentSnapshot = snapshots[rolloverPaymentOffset + index];
      if (periodSnapshot.exists) {
        assertAttendanceRolloverPeriod(periodSnapshot.data() || {}, rollover.period);
      } else {
        tx.set(rolloverPeriodRefs[index], Object.assign({}, rollover.period, {
          createdAt: FieldValue.serverTimestamp(),
          createdAtText: nowText(),
          updatedAt: FieldValue.serverTimestamp()
        }));
      }
      if (paymentSnapshot.exists) {
        const existingPayment = paymentSnapshot.data() || {};
        assertAttendanceRolloverPaymentRequest(
          existingPayment,
          rollover.paymentRequest,
          rollover.period.id
        );
        // 只有尚未送出的同一筆 payment_due 可補齊快照；已送出或部分入帳一律 fail closed。
        tx.set(rolloverPaymentRefs[index], Object.assign({}, rollover.paymentRequest, {
          updatedAt: FieldValue.serverTimestamp()
        }), { merge: true });
      } else {
        tx.set(rolloverPaymentRefs[index], Object.assign({}, rollover.paymentRequest, {
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        }));
      }
    });
    correctionRefs.forEach(item => tx.set(item.ref, { status: 'filled', replacementDate: sourceDate,
      replacementOperationId: operationId, replacementAttendanceId: hash([operationId, item.studentId].join('|')),
      filledAt: FieldValue.serverTimestamp() }, { merge: true }));
    attendanceRows.forEach((row, index) => tx.set(attendanceRefs[index], Object.assign({
      id: row.id,
      operationId,
      active: true,
      status: 'attended',
      source: late ? 'teacher-late-attendance' : 'teacher-attendance',
      teacherId: session.teacherId,
      studentId: row.studentId,
      studentIds: event.studentIds || [],
      subjectId: clean(event.subjectId),
      periodId: giftLesson ? '' : clean(periodIds[row.studentId]),
      eventId: clean(event.sourceId || sourceEventId || event.id),
      courseId: clean(event.fixedCourseId || sourceCourseId),
      date: sourceDate,
      correctionId: clean((data.correctionIds || {})[row.studentId]),
      deducted: !giftLesson,
      late: late === true,
      earlyAttendance,
      lateFeeCharged: chargeLateFee,
      originalLessonDate: sourceDate,
      attendanceRecordedAtText: nowText(),
      createdAt: FieldValue.serverTimestamp(),
      createdAtText: nowText(),
      updatedAt: FieldValue.serverTimestamp()
    }, sameDayReinstatement ? {
      cancellationRequestId: '',
      cancelledAt: null,
      cancelledAtText: '',
      reinstatedAt: FieldValue.serverTimestamp(),
      reinstatedAtText: nowText()
    } : {}), { merge: true }));
    tx.set(statusRef, changePayload, { merge: true });
    tx.set(lessonLockRef, Object.assign({
      id: lessonLockRef.id,
      operationId,
      active: true,
      status: 'attended',
      date: sourceDate,
      eventId: clean(event.sourceId || sourceEventId || event.id),
      courseId: clean(event.fixedCourseId || sourceCourseId),
      teacherId: session.teacherId,
      updatedAt: FieldValue.serverTimestamp()
    }, sameDayReinstatement ? {
      cancellationRequestId: ''
    } : {}), { merge: true });
    tx.set(payrollRef, Object.assign({
      id: operationId,
      operationId,
      active: true,
      status: 'attended',
      source: late ? 'teacher-late-attendance' : 'teacher-attendance',
      teacherId: session.teacherId,
      studentIds: event.studentIds || [],
      studentId: clean((event.studentIds || [])[0]),
      studentName: clean((event.studentNames || []).join('、')),
      subjectId: clean(event.subjectId),
      subjectName: clean(event.subjectName),
      date: sourceDate,
      month: sourceDate.slice(0, 7),
      eventId: clean(event.sourceId || sourceEventId || event.id),
      courseId: clean(event.fixedCourseId || sourceCourseId),
      occurredAt: `${sourceDate}T${clean(event.startTime || '00:00')}:00+08:00`,
      earlyAttendance,
      tuitionPeriodIds: Object.assign({}, periodIds),
      createdAt: FieldValue.serverTimestamp(),
      createdAtText: nowText(),
      updatedAt: FieldValue.serverTimestamp()
    }, payrollCalculation, sameDayReinstatement ? {
      cancellationRequestId: '',
      cancelledAt: null,
      reinstatedAt: FieldValue.serverTimestamp(),
      reinstatedAtText: nowText()
    } : {}), { merge: true });
    if (sameDayReinstatement) {
      tx.set(priorCancellationRef, {
        active: false,
        status: 'reinstated',
        lastAction: 'reinstated',
        lastActionAt: FieldValue.serverTimestamp(),
        lastActionAtText: nowText(),
        reinstatedAt: FieldValue.serverTimestamp(),
        reinstatedAtText: nowText(),
        reinstatedByTeacherId: session.teacherId,
        cancellationCount: Math.max(1, Number(existingCancellation.cancellationCount || 0)),
        reinstatementCount: Number(existingCancellation.reinstatementCount || 0) + 1,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }
    if (late) {
      if (snapshots[2].exists && clean(snapshots[2].data().status) === 'approved') {
        throw new HttpsError('already-exists', '這堂課已經補簽到。');
      }
      tx.set(lateRef, {
        id: operationId,
        teacherId: session.teacherId,
        date: sourceDate,
        eventId: sourceEventId,
        courseId: sourceCourseId,
        studentIds: event.studentIds || [],
        status: 'approved',
        administrationFee: chargeLateFee ? ATTENDANCE_ADMIN_FEE : 0,
        giftLesson,
        createdAt: FieldValue.serverTimestamp(),
        createdAtText: nowText()
      }, { merge: true });
      if (chargeLateFee) {
        tx.set(adjustmentRef, {
          id: adjustmentRef.id,
          teacherId: session.teacherId,
          month: currentTaipeiDay().slice(0, 7),
          date: currentTaipeiDay(),
          type: 'late_attendance_fee',
          amount: -ATTENDANCE_ADMIN_FEE,
          note: `補簽到行政處理費 NT$${ATTENDANCE_ADMIN_FEE}`,
          source: 'teacher-portal',
          createdAt: FieldValue.serverTimestamp(),
          createdAtText: nowText()
        }, { merge: true });
      }
    }
    tx.set(versionRef, {
      version: currentVersion + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: session.teacherId
    }, { merge: true });
  });
  return {
    ok: true,
    operationId,
    message: late
      ? (chargeLateFee
        ? `補簽到已完成，並已在本月薪資扣除行政處理費 NT$${ATTENDANCE_ADMIN_FEE}。`
        : '贈送課程補簽到已完成，本次不收行政處理費。')
      : '簽到已完成；今天晚上 12 點前可直接取消或取消後重新簽到，跨日後則必須送主管處理。'
  };
}

async function adminSaveLessonSettings(data) {
  const date = dateKey(data.date), expectedVersion = await readScheduleVersion();
  if (!date || !clean(data.sourceEventId)) throw new HttpsError('invalid-argument', '缺少課程資料。');
  const bundle = await scheduleBundle(date, date, clean(data.teacherId));
  const event = bundle.resourceEvents.find(row => [row.id, row.sourceId, row.portalChangeId, row.fixedCourseId, row.seriesId].includes(clean(data.sourceEventId)) || clean(data.sourceCourseId) && row.fixedCourseId === clean(data.sourceCourseId));
  if (!event) throw new HttpsError('not-found', '找不到課程，請重新載入。');
  const eventIds = [...new Set([event.id, event.sourceId, event.fixedCourseId, event.seriesId, event.portalChangeId, clean(data.sourceEventId)].filter(Boolean))];
  const id = hash([date, event.fixedCourseId || event.sourceId || event.id].join('|'));
  const ref = db.collection('coursePortalLessonSettings').doc(id), fields = {};
  let payroll = null, rentalUpdate = null;
  if (data.kind === 'teacherPay') {
    if (!event.teacherId || event.type === 'rental') throw new HttpsError('invalid-argument', '這不是老師課程。');
    const amount = Number(data.amount), reason = clean(data.reason).slice(0, 200);
    if (!Number.isFinite(amount) || Math.abs(amount) > 1000000 || !Number.isInteger(amount) || amount !== 0 && !reason) throw new HttpsError('invalid-argument', '請填寫有效金額與原因。');
    fields.teacherPayAdjustment = amount; fields.teacherPayAdjustmentReason = reason;
    if (event.status === 'attended') {
      const month = await teacherPayrollMonthData(date.slice(0,7));
      const matches = month.teacherPayroll.filter(row => row.active !== false && dateKey(row.date) === date && clean(row.teacherId) === event.teacherId && (eventStudentIds(row).some(id => event.studentIds.includes(id)) || eventIds.includes(clean(row.eventId || row.sourceEventId))));
      if (matches.length !== 1) throw new HttpsError('failed-precondition', '無法唯一對應本堂薪資，請先核對薪資明細。');
      const prior = matches[0], base = Number(prior.baseTeacherAmount ?? (Number(prior.teacherAmount || 0) - Number(prior.teacherPayAdjustment || 0)));
      payroll = { ...prior, id: sourceId(prior), status: 'attended', payrollCalculation: { ...(prior.payrollCalculation || {}), version: 'manager-lesson-adjustment-v1' }, baseTeacherAmount: base, teacherPayAdjustment: amount, teacherPayAdjustmentReason: reason, teacherAmount: Math.max(0, base + amount), updatedAt: FieldValue.serverTimestamp() };
    }
  } else if (data.kind === 'rentalDetails') {
    if (event.type !== 'rental' && event.portalAction !== 'room_booking') throw new HttpsError('invalid-argument', '這不是租用紀錄。');
    const raw = data.event || {};
    if (dateKey(raw.date) !== date || clean(raw.start || raw.startTime) !== event.startTime || clean(raw.roomId) !== event.roomId || Number(raw.duration || raw.durationMinutes) !== timeMinutes(event.endTime)-timeMinutes(event.startTime)) throw new HttpsError('failed-precondition', '線上租用在此只能修改金額與聯絡資料；變更時段請至租用管理。');
    try { cents(raw.rentalFee); } catch(error) { throw new HttpsError('invalid-argument',error.message); }
    fields.clientName = clean(raw.clientName); fields.clientPhone = clean(raw.clientPhone); fields.rentalFee = Number(raw.rentalFee); fields.rentalPaymentStatus = clean(raw.rentalPaymentStatus); fields.note = clean(raw.note).slice(0,2000);
    if (!fields.clientName) throw new HttpsError('invalid-argument','請填寫租用者。');
    rentalUpdate = {bookingId:clean(data.bookingId),amount:fields.rentalFee,paymentStatus:fields.rentalPaymentStatus,clientName:fields.clientName,clientPhone:fields.clientPhone,note:fields.note};
    if (!rentalUpdate.bookingId) throw new HttpsError('invalid-argument','缺少線上租用識別碼。');
  } else if (data.kind === 'rentalStatus') {
    if (event.type !== 'rental' && event.portalAction !== 'room_booking') throw new HttpsError('invalid-argument', '這不是租用紀錄。');
    if (!['attended','scheduled'].includes(clean(data.status))) throw new HttpsError('invalid-argument', '租用簽退狀態無效。');
    if (data.status === 'attended' && date > currentTaipeiDay()) throw new HttpsError('failed-precondition', '尚未到租用日期。');
    fields.status = data.status;
  } else throw new HttpsError('invalid-argument', '不支援的設定。');
  await db.runTransaction(async tx => {
    const version = await tx.get(scheduleVersionRef()), prior = await tx.get(ref);
    const bookingRef = rentalUpdate ? db.collection('coursePortalRoomBookings').doc(rentalUpdate.bookingId) : null;
    const booking = bookingRef ? await tx.get(bookingRef) : null;
    if (booking && (!booking.exists || booking.data().active === false || !eventIds.includes(rentalUpdate.bookingId) && !eventIds.includes('rental-'+rentalUpdate.bookingId))) throw new HttpsError('failed-precondition','租用資料已變更，請重新載入。');
    assertScheduleWritable(version);
    if (Number(version.data()?.version || 0) !== expectedVersion) throw new HttpsError('aborted', '資料剛剛已更新，請重新載入後再試。');
    tx.set(ref, { id, date, teacherId: event.teacherId, eventIds: [...new Set([...(prior.data()?.eventIds || []), ...eventIds])], fields: { ...(prior.data()?.fields || {}), ...fields }, updatedAt: FieldValue.serverTimestamp() });
    if (bookingRef) {
      const update = {...rentalUpdate,updatedAt:FieldValue.serverTimestamp()};delete update.bookingId;tx.set(bookingRef,update,{merge:true});
      tx.set(db.collection('coursePortalScheduleChanges').doc('rental-'+rentalUpdate.bookingId),{event:{clientName:fields.clientName,clientPhone:fields.clientPhone,rentalFee:fields.rentalFee,paymentStatus:fields.rentalPaymentStatus,note:fields.note},updatedAt:FieldValue.serverTimestamp()},{merge:true});
    }
    if (payroll) tx.set(db.collection(ATTENDANCE_PAYROLL).doc(payroll.id), payroll, { merge: true });
    tx.set(scheduleVersionRef(), { version: expectedVersion + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'manager-lesson-settings' }, { merge: true });
  });
  return { ok: true, id };
}

async function adminVoidLessonSlot(data) {
  const periodId = clean(data.periodId), slotNo = Number(data.slotNo), expectedVersion = await readScheduleVersion();
  const periods = await mirrorRows('tuitionPeriods'), period = periods.find(row => sourceId(row) === periodId);
  if (!period || !Number.isInteger(slotNo) || slotNo < 1 || slotNo > tuitionLessonCount(period)) throw new HttpsError('invalid-argument', '期別或堂數無效。');
  const [mirrorAttendance, portalAttendance] = await Promise.all([mirrorRowsByField('attendance','studentId',period.studentId),db.collection(ATTENDANCE_RECORDS).where('studentId','==',period.studentId).get()]);
  const effective = applyPortalAttendanceToPeriods([period],mirrorAttendance,portalAttendance.docs.map(doc => doc.data()))[0];
  const adjustments = Array.isArray(period.lessonAdjustments) ? period.lessonAdjustments : [];
  if (adjustments.some(row => Number(row.slotNo) === slotNo)) return {ok:true,duplicate:true};
  if (slotNo <= Number(effective.usedCount || 0)) throw new HttpsError('failed-precondition', '這堂已有簽到，請先取消簽到，再作廢堂數。');
  if (tuitionUsedCount(effective) >= tuitionLessonCount(period)) throw new HttpsError('failed-precondition', '本期已無剩餘堂數。');
  await db.runTransaction(async tx => {
    const version = await tx.get(scheduleVersionRef());
    assertScheduleWritable(version);
    if (Number(version.data()?.version || 0) !== expectedVersion) throw new HttpsError('aborted', '期別剛剛已更新，請重新載入。');
    tx.set(db.collection(TUITION_PERIODS).doc(periodId), {id:periodId,studentId:period.studentId,active:true,lessonAdjustments:adjustments.concat([{id:periodId+'-void-'+slotNo,slotNo,type:'void',date:currentTaipeiDay(),amount:0}]),voidedLessonCount:Number(period.voidedLessonCount||0)+1,updatedAt:FieldValue.serverTimestamp()},{merge:true});
    tx.set(scheduleVersionRef(),{version:expectedVersion+1,updatedAt:FieldValue.serverTimestamp()},{merge:true});
  });
  return {ok:true};
}

async function adminSaveLeaveReason(data) {
  const id = clean(data.id), name = clean(data.name);
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(id) || !name) throw new HttpsError('invalid-argument', '請填寫請假原因。');
  const ref = db.collection('coursePortalSettings').doc('managerConfiguration');
  await db.runTransaction(async tx => {
    const version = await tx.get(scheduleVersionRef()), snapshot = await tx.get(ref);
    assertScheduleWritable(version);
    const rows = snapshot.data()?.leaveReasons || [{id:'leave_0',name:'生病',sort:1,active:true},{id:'leave_1',name:'出遊',sort:2,active:true},{id:'leave_2',name:'其他',sort:3,active:true}];
    const next = rows.filter(row => row.id !== id).concat([{id,name,sort:Number(data.sort)||0,active:data.active !== false}]);
    tx.set(ref,{leaveReasons:next,updatedAt:FieldValue.serverTimestamp()},{merge:true});
    tx.set(scheduleVersionRef(),{version:Number(version.data()?.version||0)+1,updatedAt:FieldValue.serverTimestamp()},{merge:true});
  });
  return {ok:true};
}

async function adminSaveSchedule(data) {
  const raw = data.event || {}, operationId = clean(data.operationId), mode = clean(data.mode || 'save');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(operationId) || !['save', 'delete'].includes(mode)) throw new HttpsError('invalid-argument', '排課操作識別碼無效。');
  const date = dateKey(raw.date), startTime = clean(raw.start || raw.startTime), duration = Number(raw.duration || raw.durationMinutes);
  if (!date || !Number.isInteger(duration) || duration < 1 || duration > 1440) throw new HttpsError('invalid-argument', '排課日期或長度無效。');
  const endMinutes = timeMinutes(startTime) + duration;
  const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  assertPortalInterval(startTime, endTime);
  const roomId = clean(raw.roomId), teacherId = clean(raw.teacherId), subjectId = clean(raw.subjectId), type = clean(raw.type);
  if (!['fixed', 'single', 'trial', 'rental'].includes(type)) throw new HttpsError('invalid-argument', '課程類型無效。');
  const groups = await readCourseGroups();
  const studentIds = [...new Set((Array.isArray(raw.studentIds) ? raw.studentIds : []).map(value => canonicalStudentId(clean(value), groups)).filter(Boolean))];
  if (['fixed', 'single'].includes(type) && (!studentIds.length || !teacherId || !subjectId)) throw new HttpsError('invalid-argument', '學生、老師和科目不可空白。');
  if (type === 'trial' && (!clean(raw.trialName) || !teacherId || !subjectId)) throw new HttpsError('invalid-argument', '體驗課資料不完整。');
  if (type === 'rental' && !clean(raw.clientName)) throw new HttpsError('invalid-argument', '請填寫租用者。');
  const expectedVersion = await readScheduleVersion();
  const recurring = !clean(data.sourceEventId) && !clean(data.sourceCourseId) && type === 'fixed' && ['weekly','biweekly'].includes(clean(raw.frequency));
  const requestHash = hash(JSON.stringify({ event: raw, mode, sourceEventId: clean(data.sourceEventId), sourceCourseId: clean(data.sourceCourseId), sourceDate: clean(data.sourceDate), repeatUntil: clean(data.repeatUntil) }));
  const id = `manager-${operationId}`;
  const target = db.collection(recurring ? 'coursePortalFixedCourses' : 'coursePortalScheduleChanges').doc(id);
  const previous = await target.get();
  if (previous.exists) {
    if (previous.data().requestHash !== requestHash) throw new HttpsError('already-exists', '操作編號已使用，請重新開啟排課視窗。');
    return { ok: true, duplicate: true, id, event: previous.data().event || previous.data() };
  }
  const recurrenceEndDate = dateKey(data.repeatUntil);
  if (recurrenceEndDate && recurrenceEndDate < date) throw new HttpsError('invalid-argument', '結束日期不可早於開始日期。');
  const through = recurring ? (recurrenceEndDate && recurrenceEndDate < addDays(date, 180) ? recurrenceEndDate : addDays(date, 180)) : date;
  const [bundle, roomSettings, policy, changes] = await Promise.all([scheduleBundle(date, through, teacherId), db.collection('coursePortalRoomSettings').doc(roomId).get(), rentalPolicySettings(), db.collection('coursePortalScheduleChanges').where('active','==',true).get()]);
  let original = null;
  if (clean(data.sourceEventId) || clean(data.sourceCourseId)) {
    const sourceDate = dateKey(data.sourceDate) || date;
    const sourceBundle = sourceDate >= date && sourceDate <= through ? bundle : await scheduleBundle(sourceDate, sourceDate, teacherId);
    original = sourceBundle.resourceEvents.find(row => row.date === sourceDate && [row.id,row.sourceId].map(clean).includes(clean(data.sourceEventId)));
    if (!original && clean(data.sourceCourseId)) {
      const matches = sourceBundle.resourceEvents.filter(row => row.date === sourceDate && clean(row.fixedCourseId || row.seriesId) === clean(data.sourceCourseId));
      if (matches.length === 1) original = matches[0];
    }
    if (!original) throw new HttpsError('not-found', '找不到原課程，請重新載入。');
    if (normalizeScheduleStatus(original.status) === 'attended') throw new HttpsError('failed-precondition', '已簽到課程請先取消簽到，再修改排課。');
    if (clean(original.portalAction) === 'room_booking') throw new HttpsError('failed-precondition', '線上租用請使用租用紀錄的管理功能。');
  } else if (mode === 'delete') throw new HttpsError('invalid-argument', '刪除課程必須指定原課程。');
  const selectedRoom = bundle.rooms.find(row => sourceId(row) === roomId), setting = roomSettings.exists ? roomSettings.data() : {};
  if (!selectedRoom || !sourceActive(selectedRoom)) throw new HttpsError('failed-precondition', '教室不存在或已停用。');
  if (type !== 'rental' && (!bundle.maps.teachers[teacherId] || !sourceActive(bundle.maps.teachers[teacherId]) || !bundle.maps.subjects[subjectId])) throw new HttpsError('failed-precondition', '老師或科目已停用。');
  if (studentIds.some(id => !bundle.maps.students[id])) throw new HttpsError('failed-precondition', '學生資料不存在。');
  const teacherSubjects = firstArray(bundle.maps.teachers[teacherId] || {}, ['subjectIds']);
  if (type !== 'rental' && teacherSubjects.length && !teacherSubjects.includes(subjectId)) throw new HttpsError('failed-precondition', '老師沒有此科目的授課設定。');
  if (type !== 'rental' && !roomSupportsSubject(selectedRoom, subjectId, bundle, setting)) throw new HttpsError('failed-precondition', '教室不適合所選科目。');
  const resourceIds = requestedSubjectResourceIds(subjectId, bundle);
  if (mode !== 'delete') for (let day = date; day <= through; day = addDays(day, recurring ? (raw.frequency === 'biweekly' ? 14 : 7) : 10000)) {
    const window = businessWindow(policy, day);
    if (window.closed || timeMinutes(startTime) < window.startMinutes || endMinutes > window.endMinutes) throw new HttpsError('failed-precondition', `${day} 不在開放排課時段內。`);
    if (!roomAllowsInterval(selectedRoom, setting, day, startTime, endTime, subjectId, type === 'rental' ? 'rental' : 'schedule')) throw new HttpsError('failed-precondition', `${day} 教室時段規則不允許此安排。`);
    const conflict = bundle.resourceEvents.find(row => row.date === day && eventBlocksResource(row) && (!original || row.id !== original.id) && overlaps(startTime,endTime,row.startTime,row.endTime) && (row.roomId === roomId || teacherId && row.teacherId === teacherId || (row.studentIds || []).some(id => studentIds.includes(id)) || sharedResourceConflict([row],resourceIds)));
    if (conflict) throw new HttpsError('already-exists', `${day} 的教室、老師、學生或共用樂器已被占用。`);
  }
  const event = { id, date, startTime, endTime, durationMinutes: duration, roomId, teacherId, subjectId, studentIds,
    studentId: studentIds[0] || '', studentNames: studentIds.map(id => clean(bundle.maps.students[id]?.name)),
    type, status: mode === 'delete' ? 'cancelled' : 'scheduled', tuitionPeriodId: clean(raw.tuitionPeriodId),
    specialLesson: raw.specialLesson === true, specialLessonPrice: Number(raw.specialLessonPrice || 0), specialTeacherPay: Number(raw.specialTeacherPay || 0),
    clientName: clean(raw.clientName), clientPhone: clean(raw.clientPhone), rentalFee: Number(raw.rentalFee || 0), rentalPaymentStatus: clean(raw.rentalPaymentStatus),
    trialName: clean(raw.trialName), trialPhone: clean(raw.trialPhone), trialFee: Number(raw.trialFee || 0),
    note: clean(raw.note).slice(0,2000), source: 'manager-cloud', active: mode !== 'delete' };
  for (const key of ['specialLessonPrice','specialTeacherPay','rentalFee','trialFee']) { try { cents(event[key]); } catch(error) { throw new HttpsError('invalid-argument',error.message); } }
  const lineage = original ? attendanceLineage(original, {}) : '';
  const superseded = original ? changes.docs.filter(doc => ['single_move','lesson_status','cancel','extra_lesson'].includes(doc.data().action) && (doc.id === clean(original.portalChangeId) || clean(doc.data().sourceCourseId) === lineage && dateKey(doc.data().sourceDate) === original.date)) : [];
  const payload = recurring ? { ...event, frequencyWeeks: raw.frequency === 'biweekly' ? 2 : 1, recurrenceEndDate, startDate: date }
    : { id, operationId, action: mode === 'delete' ? 'cancel' : original ? 'single_move' : 'extra_lesson', active: true,
      sourceEventId: original ? clean(original.sourceId || original.id) : '', sourceCourseId: lineage, sourceDate: original?.date || '',
      event: { ...event, fixedCourseId: lineage }, createdByTeacherId: teacherId, approvedByManager: true, createdAtText: nowText() };
  await db.runTransaction(async tx => {
    const version = await tx.get(scheduleVersionRef()), existing = await tx.get(target);
    assertScheduleWritable(version);
    if (existing.exists) {
      if (existing.data().requestHash !== requestHash) throw new HttpsError('already-exists', '操作編號已使用。');
      return;
    }
    if (Number(version.data()?.version || 0) !== expectedVersion) throw new HttpsError('aborted', '課表剛剛已更新，請重新載入後再確認空位。');
    for (const doc of superseded) tx.set(doc.ref,{active:false,supersededBy:id,updatedAt:FieldValue.serverTimestamp()},{merge:true});
    tx.create(target,{...payload,requestHash,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
    tx.set(scheduleVersionRef(),{version:expectedVersion+1,updatedAt:FieldValue.serverTimestamp(),updatedBy:'manager-schedule'},{merge:true});
  });
  return { ok:true,id,event };
}

async function adminSetAttendance(data) {
  const teacherId = clean(data.teacherId), status = clean(data.status);
  if (!teacherId || !['attended', 'scheduled', 'leave', 'absent'].includes(status)) throw new HttpsError('invalid-argument', '請選擇有效的老師與課程狀態。');
  // This session is constructed only behind the manager-authenticated callable.
  const session = { role: 'teacher', teacherId };
  if (status === 'attended') return applyTeacherAttendance(data, false, session);
  const expectedVersion = await readScheduleVersion();
  const { event, sourceDate, sourceEventId, sourceCourseId } = await teacherAttendanceEvent(session, data);
  const operationId = attendanceOperationId(teacherId, sourceDate, event, data);
  const change = attendanceChangePayload(event, sourceDate, sourceEventId, sourceCourseId, teacherId, status, clean(data.note) || '管理者更新課程狀態');
  change.approvedByManager = true;
  change.event.reasonId = clean(data.reasonId);
  const versionRef = scheduleVersionRef();
  const cancellationRef = db.collection(ATTENDANCE_CANCELLATIONS).doc(hash(['attendance-cancellation', operationId].join('|')));
  const payrollRef = db.collection(ATTENDANCE_PAYROLL).doc(operationId);
  const lessonLockRef = db.collection('coursePortalAttendanceLessonLocks').doc(attendanceLessonLockId(sourceDate, event, data));
  const students = eventStudentIds(event);
  const refs = students.map(studentId => db.collection(ATTENDANCE_RECORDS).doc(hash([operationId, studentId].join('|'))));
  const mirrorAttendance = await mirrorRowsByDateRange('attendance', sourceDate, sourceDate);
  const originalByStudent = students.map(studentId => mirrorAttendance.find(row => attendanceRowsMatch(row, { studentId, teacherId, date: sourceDate, eventId: clean(event.sourceId || sourceEventId || event.id), courseId: attendanceLineage(event, data) })));
  await db.runTransaction(async tx => {
    const version = await tx.get(versionRef);
    assertScheduleWritable(version);
    if (Number(version.data()?.version || 0) !== expectedVersion) throw new HttpsError('aborted', '課程已由其他裝置更新，請重新載入。');
    const prior = [];
    for (const ref of refs) prior.push(await tx.get(ref));
    const hadAttendance = prior.some(row => row.exists && row.data().status === 'attended') || originalByStudent.some(row => row && normalizeScheduleStatus(row.status) === 'attended');
    refs.forEach((ref, index) => { if (!prior[index].exists && !originalByStudent[index]) return; tx.set(ref, {
      id: ref.id, operationId, active: false, status: 'cancelled', source: 'attendance-cancellation-approved',
      teacherId, studentId: students[index], studentIds: students, subjectId: clean(event.subjectId),
      eventId: clean(event.sourceId || sourceEventId || event.id), courseId: attendanceLineage(event, data), date: sourceDate,
      periodId: clean(prior[index].data()?.periodId || originalByStudent[index]?.periodId || event.tuitionPeriodIds?.[students[index]] || event.tuitionPeriodId),
      deducted: false, cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    }, { merge: true }); });
    tx.set(db.collection('coursePortalScheduleChanges').doc(change.id), change, { merge: true });
    const cancellation = { id: cancellationRef.id, operationId, active: true, status: 'approved', teacherId,
      studentIds: students, eventId: clean(event.sourceId || sourceEventId || event.id), courseId: attendanceLineage(event, data),
      subjectId: clean(event.subjectId), date: sourceDate, startTime: event.startTime, endTime: event.endTime,
      reason: clean(data.note) || '管理者直接更新', approvedByManager: true, updatedAt: FieldValue.serverTimestamp() };
    if (hadAttendance) {
    tx.set(cancellationRef, cancellation, { merge: true });
    tx.set(payrollRef, { ...cancellation, id: operationId, active: false, status: 'cancelled' }, { merge: true });
    tx.set(lessonLockRef, { operationId, teacherId, date: sourceDate, active: true, status: 'cancelled', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    tx.set(versionRef, { version: expectedVersion + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'manager-attendance' }, { merge: true });
  });
  return { ok: true, operationId, status };
}

async function teacherAttendance(data) {
  return applyTeacherAttendance(data, false);
}

async function teacherLateAttendance(data) {
  return applyTeacherAttendance(data, true);
}

async function cancelTeacherAttendanceSameDay(session, resolved, reason) {
  const { sourceDate, sourceEventId, sourceCourseId, event } = resolved;
  if (sourceDate !== currentTaipeiDay()) {
    throw new HttpsError('failed-precondition', '只有當天簽到可以直接取消。');
  }
  const operationId = attendanceOperationId(session.teacherId, sourceDate, event, {
    sourceEventId,
    sourceCourseId
  });
  const requestId = hash(['attendance-cancellation', operationId].join('|'));
  const requestRef = db.collection(ATTENDANCE_CANCELLATIONS).doc(requestId);
  const attendanceSnapshot = await db.collection(ATTENDANCE_RECORDS)
    .where('operationId', '==', operationId)
    .get();
  const attendanceRefs = attendanceSnapshot.docs.map((doc) => doc.ref);
  const lineage = attendanceLineage(event, { sourceEventId, sourceCourseId });
  const statusRef = db.collection('coursePortalScheduleChanges')
    .doc(`lesson-status-${hash([session.teacherId, lineage, sourceDate].join('|'))}`);
  const payrollRef = db.collection(ATTENDANCE_PAYROLL).doc(operationId);
  const lessonLockRef = db.collection('coursePortalAttendanceLessonLocks')
    .doc(attendanceLessonLockId(sourceDate, event, { sourceEventId, sourceCourseId }));
  const versionRef = scheduleVersionRef();
  const expectedVersion = await readScheduleVersion();
  const filledSlots = await db.collection('coursePortalAttendanceCorrections').where('replacementOperationId', '==', operationId).get();
  await db.runTransaction(async (tx) => {
    const snapshots = await Promise.all([
      tx.get(versionRef),
      tx.get(requestRef),
      tx.get(statusRef),
      tx.get(payrollRef),
      tx.get(lessonLockRef),
      ...attendanceRefs.map((ref) => tx.get(ref)),
      ...filledSlots.docs.map(doc => tx.get(doc.ref))
    ]);
    const versionSnapshot = snapshots[0];
    assertScheduleWritable(versionSnapshot);
    const currentVersion = Number(versionSnapshot.exists && versionSnapshot.data().version || 0);
    if (currentVersion !== expectedVersion) {
      throw new HttpsError(
        'aborted',
        '這堂課剛剛已在其他裝置更新。為避免覆蓋資料，請重新整理後再操作。'
      );
    }
    const existingRequest = snapshots[1].exists ? snapshots[1].data() || {} : {};
    if (clean(existingRequest.status) === 'approved') return;
    const currentStatus = snapshots[2].exists ? snapshots[2].data() || {} : {};
    if (normalizeScheduleStatus(currentStatus.event && currentStatus.event.status) !== 'attended') {
      throw new HttpsError('failed-precondition', '這堂課目前不是已簽到狀態，請重新整理。');
    }
    filledSlots.docs.forEach(slot => tx.set(slot.ref, { status: 'pending', replacementDate: '', replacementOperationId: '', replacementAttendanceId: '' }, { merge: true }));
    attendanceRefs.forEach((ref, index) => {
      const prior = snapshots[5 + index].exists ? snapshots[5 + index].data() || {} : {};
      tx.set(ref, {
        active: false,
        status: 'cancelled',
        source: 'teacher-same-day-attendance-cancellation',
        cancellationRequestId: requestId,
        periodId: clean(prior.periodId),
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledAtText: nowText(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
    tx.set(statusRef, attendanceChangePayload(
      event,
      sourceDate,
      sourceEventId,
      sourceCourseId,
      session.teacherId,
      'scheduled',
      '老師當日取消誤簽到'
    ), { merge: true });
    tx.set(payrollRef, {
      active: false,
      status: 'cancelled',
      cancellationRequestId: requestId,
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(lessonLockRef, {
      // 保留跨老師共用的取消 tombstone；未提供管理者恢復流程前，不可讓改派老師繞過重簽鎖。
      active: true,
      status: 'cancelled',
      operationId,
      cancellationRequestId: requestId,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(requestRef, {
      id: requestId,
      operationId,
      active: true,
      status: 'approved',
      approvalMode: 'same_day_teacher',
      teacherId: session.teacherId,
      teacherName: clean(event.teacherName),
      studentIds: event.studentIds || [],
      studentNames: event.studentNames || [],
      subjectId: clean(event.subjectId),
      subjectName: clean(event.subjectName),
      date: sourceDate,
      startTime: clean(event.startTime),
      endTime: clean(event.endTime),
      eventId: clean(event.sourceId || sourceEventId || event.id),
      courseId: clean(event.fixedCourseId || sourceCourseId),
      attendanceRecordIds: attendanceRefs.map((ref) => ref.id),
      reason: clean(reason) || '老師當日誤簽到',
      administrationFee: 0,
      cancellationCount: Number(existingRequest.cancellationCount || 0) + 1,
      lastAction: 'cancelled',
      lastActionAt: FieldValue.serverTimestamp(),
      lastActionAtText: nowText(),
      requestedAt: FieldValue.serverTimestamp(),
      requestedAtText: nowText(),
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedAtText: nowText(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(versionRef, {
      version: currentVersion + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: session.teacherId
    }, { merge: true });
  });
  return {
    ok: true,
    requestId,
    status: 'approved',
    sameDay: true,
    message: '當日簽到已取消；今天晚上 12 點前仍可重新簽到，本次不收行政處理費。'
  };
}

async function teacherAttendanceCancellationRequest(data) {
  const session = await requireSession(data, ['teacher']);
  const reason = clean(data.reason);
  const resolved = await teacherAttendanceEvent(session, data);
  const { sourceDate, sourceEventId, sourceCourseId, event } = resolved;
  if (normalizeScheduleStatus(event.status) !== 'attended') {
    throw new HttpsError('failed-precondition', '只有已簽到的課程可以申請取消簽到。');
  }
  if (sourceDate === currentTaipeiDay()) {
    return cancelTeacherAttendanceSameDay(session, resolved, reason);
  }
  if (!reason) throw new HttpsError('invalid-argument', '請填寫取消簽到原因。');
  const operationId = attendanceOperationId(session.teacherId, sourceDate, event, data);
  const requestId = hash(['attendance-cancellation', operationId].join('|'));
  const requestRef = db.collection(ATTENDANCE_CANCELLATIONS).doc(requestId);
  const attendanceSnapshot = await db.collection(ATTENDANCE_RECORDS)
    .where('operationId', '==', operationId)
    .get();
  const existing = await requestRef.get();
  if (existing.exists && ['pending', 'approved'].includes(clean(existing.data().status))) {
    throw new HttpsError('already-exists', clean(existing.data().status) === 'pending'
      ? '取消簽到申請已送出，正在等待主管確認。'
      : '這堂課的取消簽到已經完成。');
  }
  const payload = {
    id: requestId,
    operationId,
    active: true,
    status: 'pending',
    approvalMode: 'manager_review',
    teacherId: session.teacherId,
    teacherName: clean(event.teacherName),
    studentIds: event.studentIds || [],
    studentNames: event.studentNames || [],
    subjectId: clean(event.subjectId),
    subjectName: clean(event.subjectName),
    date: sourceDate,
    startTime: clean(event.startTime),
    endTime: clean(event.endTime),
    roomId: clean(event.roomId),
    type: clean(event.type || 'lesson'),
    eventId: clean(event.sourceId || sourceEventId || event.id),
    courseId: clean(event.fixedCourseId || sourceCourseId),
    portalChangeId: clean(event.portalChangeId),
    attendanceRecordIds: attendanceSnapshot.docs.map((doc) => doc.id),
    reason,
    administrationFee: ATTENDANCE_ADMIN_FEE,
    lastAction: 'pending_review',
    lastActionAt: FieldValue.serverTimestamp(),
    lastActionAtText: nowText(),
    requestedAt: FieldValue.serverTimestamp(),
    requestedAtText: nowText(),
    updatedAt: FieldValue.serverTimestamp()
  };
  await requestRef.set(payload, { merge: true });
  const body = [
    '老師提出取消簽到申請，請主管確認。',
    '',
    `老師：${clean(event.teacherName) || session.teacherId}`,
    `學生：${clean((event.studentNames || []).join('、')) || '未提供'}`,
    `課程：${clean(event.subjectName) || '未提供'}`,
    `時間：${sourceDate} ${clean(event.startTime)}～${clean(event.endTime)}`,
    `原因：${reason}`,
    `核准後將扣除行政處理費 NT$${ATTENDANCE_ADMIN_FEE}。`,
    '',
    `${PORTAL_BASE}/course-portal-admin.html`
  ].join('\n');
  await queueCoursePortalNotice(`attendance-cancel-manager-${requestId}`, {
    eventCode: 'attendance_cancellation_pending',
    target: 'admin',
    targetRole: 'admin',
    targetEmployeeId: 'PRIMARY_MANAGER_LINE',
    targetName: '柚子樂器主管',
    title: '取消簽到待確認',
    body,
    text: body,
    message: body,
    attendanceCancellationId: requestId
  });
  return {
    ok: true,
    requestId,
    status: 'pending',
    message: `取消簽到申請已送出；主管核准後才會生效，並扣除行政處理費 NT$${ATTENDANCE_ADMIN_FEE}。`
  };
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

function normalizeAdminTeacherAdjustment(data, teacher) {
  const teacherId = clean(data && data.teacherId);
  const requestId = clean(data && data.requestId);
  const date = dateKey(data && data.date);
  const type = clean(data && data.type).toLowerCase();
  const amountValue = Number(data && data.amount);
  const note = clean(data && data.note);
  if (!teacherId || !teacher || sourceId(teacher) !== teacherId) {
    throw new HttpsError('not-found', '找不到指定的老師。');
  }
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(requestId)) {
    throw new HttpsError('invalid-argument', '本次操作識別碼格式不正確，請重新開啟視窗後再試。');
  }
  if (!date) throw new HttpsError('invalid-argument', '請選擇正確的獎勵／扣薪日期。');
  if (!['reward', 'deduction'].includes(type)) {
    throw new HttpsError('invalid-argument', '異動類型只能選擇獎勵或扣薪。');
  }
  if (!Number.isFinite(amountValue) || amountValue <= 0 || amountValue > 1000000 || !Number.isInteger(amountValue)) {
    throw new HttpsError('invalid-argument', '金額必須是 1～1,000,000 元的整數。');
  }
  if (note.length < 2 || note.length > 200) {
    throw new HttpsError('invalid-argument', '請填寫 2～200 字的獎勵／扣薪原因。');
  }
  return {
    id: `manual-${hash(requestId).slice(0, 32)}`,
    requestId,
    teacherId,
    teacherName: clean(teacher.name || teacher.teacherName),
    month: date.slice(0, 7),
    date,
    type,
    amount: amountValue,
    note,
    source: 'admin-manual',
    active: true
  };
}

async function adminSaveTeacherAdjustment(data) {
  const teacherId = clean(data && data.teacherId);
  const teachers = await mirrorRowsIncludingInactive('teachers');
  const teacher = teachers.find((row) => sourceId(row) === teacherId);
  const adjustment = normalizeAdminTeacherAdjustment(data, teacher);
  const ref = db.collection('coursePortalTeacherAdjustments').doc(adjustment.id);
  let duplicate = false;
  const createdAtText = nowText();
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      const existing = snapshot.data() || {};
      const sameRequest = ['requestId', 'teacherId', 'date', 'type', 'note'].every((key) =>
        clean(existing[key]) === clean(adjustment[key])
      ) && Number(existing.amount || 0) === adjustment.amount;
      if (!sameRequest) throw new HttpsError('already-exists', '這個操作識別碼已被其他薪資異動使用。');
      duplicate = true;
      return;
    }
    tx.set(ref, Object.assign({}, adjustment, {
      createdAt: FieldValue.serverTimestamp(),
      createdAtText,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'course-scheduler-admin'
    }));
  });
  return {
    ok: true,
    duplicate,
    adjustment: Object.assign({}, adjustment, { createdAtText }),
    message: duplicate ? '這筆薪資異動先前已儲存，未重複新增。' : '老師薪資異動已儲存。'
  };
}

async function adminSaveStudent(data) {
  const id = clean(data.id), name = clean(data.name);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id) || !name || name.length > 100) throw new HttpsError('invalid-argument', '請填寫有效的學生資料。');
  const row = { id, name, phone: normalizePhone(data.phone), studentActive: data.active !== false, managerNote: clean(data.note).slice(0, 2000), managerCreated: true, active: true };
  await db.runTransaction(async tx => {
    const versionRef = scheduleVersionRef(), version = await tx.get(versionRef);
    assertScheduleWritable(version);
    tx.set(db.collection('coursePortalStudentProfiles').doc(id), Object.assign({}, row, { updatedAt: FieldValue.serverTimestamp(), updatedBy: 'manager' }), { merge: true });
    tx.set(versionRef, { version: Number(version.exists && version.data().version || 0) + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'manager-student' }, { merge: true });
  });
  return { ok: true, student: { id, name, phone: row.phone, active: row.studentActive, note: row.managerNote } };
}

async function adminSaveTuitionPeriods(data) {
  const input = Array.isArray(data.periods) ? data.periods : [];
  const operationId = clean(data.operationId);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(operationId) || !input.length || input.length > 24) throw new HttpsError('invalid-argument', '期別儲存資料不完整。');
  const students = new Set((await mirrorRows('students')).map(sourceId));
  const ids = new Set();
  const rows = input.map(raw => {
    const id = clean(raw.id);
    if (!/^[A-Za-z0-9_-]{1,180}$/.test(id) || ids.has(id) || !students.has(clean(raw.studentId))) throw new HttpsError('invalid-argument', '學生或期別識別碼無效。');
    ids.add(id);
    const lessonCount = Number(raw.lessonCount);
    if (!Number.isInteger(lessonCount) || lessonCount < 1 || lessonCount > 1000 || !Number.isInteger(Number(raw.periodNo)) || Number(raw.periodNo) < 1 || !dateKey(raw.startDate)) throw new HttpsError('invalid-argument', '請填寫有效的期數、堂數及開始日期。');
    try { cents(raw.expectedAmount); cents(raw.discount || 0); } catch(error) { throw new HttpsError('invalid-argument', error.message); }
    const plan = raw.planSnapshot || {};
    if (!['ratio', 'fixed', 'none'].includes(clean(plan.splitType)) || !Number.isFinite(Number(plan.splitValue || 0)) || Number(plan.splitValue || 0) < 0) throw new HttpsError('invalid-argument', '請設定老師拆帳方式。');
    const snapshot = {
      id: clean(plan.id || raw.planId), name: clean(plan.name), amount: Number(raw.expectedAmount), lessonCount,
      splitType: clean(plan.splitType), splitValue: Number(plan.splitValue || 0),
      leaveNoDeduct: plan.leaveNoDeduct !== false, expiryDays: Number(plan.expiryDays || 0), discountType: clean(plan.discountType),
      payByDiscount: typeof plan.payByDiscount === 'boolean' ? plan.payByDiscount : null, teacherPayBasis: clean(plan.teacherPayBasis), splitSource: clean(plan.splitSource) || 'manager'
    };
    const row = { id, studentId: clean(raw.studentId), teacherId: clean(raw.teacherId), subjectId: clean(raw.subjectId), planId: clean(raw.planId), periodNo: Number(raw.periodNo), startDate: dateKey(raw.startDate), expiryDate: dateKey(raw.expiryDate), lessonCount, expectedAmount: Number(raw.expectedAmount), discount: Number(raw.discount || 0), discountType: clean(raw.discountType || plan.discountType), note: clean(raw.note).slice(0, 2000), planSnapshot: snapshot, active: true };
    const payments = data.edit === true ? [] : (Array.isArray(raw.transactions) ? raw.transactions : []).map(item => ({ id: clean(item.id), type: 'payment', amount: Number(item.amount), date: dateKey(item.date), method: clean(item.method), note: clean(item.note) }));
    if (payments.length > 1) throw new HttpsError('invalid-argument', '每一期只能分配一筆本次收款。');
    payments.forEach(payment => { try { validateTransaction({ transactions: [] }, payment); } catch(error) { throw new HttpsError('invalid-argument', error.message); } });
    return { row, payments };
  });
  const versionRef = scheduleVersionRef();
  return db.runTransaction(async tx => {
    const refs = rows.map(item => db.collection(TUITION_PERIODS).doc(item.row.id));
    const studentIds = [...new Set(rows.map(item => item.row.studentId))];
    // Start and read the transaction sequentially. Parallel query streams can
    // outlive a conflicted transaction and reject outside its retry handler.
    const version = await tx.get(versionRef);
    const mirror = await tx.get(db.collection(MIRROR.tuitionPeriods).where('source.studentId', 'in', studentIds));
    const portalPeers = await tx.get(db.collection(TUITION_PERIODS).where('studentId', 'in', studentIds));
    const existing = [];
    for (const ref of refs) existing.push(await tx.get(ref));
    assertScheduleWritable(version);
    const bases = new Map(mirror.docs.map(doc => [sourceId(doc.data().source), doc.data().source]));
    const peers = [...bases.values(), ...portalPeers.docs.map(doc => doc.data())];
    const result = rows.map((item, index) => {
      const prior = existing[index].exists ? existing[index].data() : bases.get(item.row.id);
      if (data.edit !== true && prior) {
        if (prior.creationOperationId !== operationId) throw new HttpsError('already-exists', '期別已存在，請重新載入。');
        return { id: item.row.id, duplicate: true };
      }
      if (data.edit === true && (!prior || clean(prior.studentId) !== item.row.studentId)) throw new HttpsError('failed-precondition', '原期別不存在或學生已變更。');
      if (data.edit === true) item.row.periodNo = Number(prior.periodNo);
      else if (peers.some(peer => clean(peer.studentId) === item.row.studentId && Number(peer.periodNo) === item.row.periodNo)) throw new HttpsError('aborted', '其他裝置已建立這一期，請重新載入後再操作。');
      peers.push(item.row);
      const record = Object.assign({}, item.row, prior ? {} : { usedCount: 0, status: 'active', transactions: [], paidAmount: 0, creationOperationId: operationId });
      tx.set(refs[index], Object.assign(record, { updatedAt: FieldValue.serverTimestamp() }), { merge: true });
      item.payments.forEach(payment => tx.create(db.collection(TUITION_TRANSACTIONS).doc(payment.id), Object.assign({}, payment, { periodId: item.row.id, studentId: item.row.studentId, active: true, status: 'confirmed', source: 'manager-ledger', createdAt: FieldValue.serverTimestamp() })));
      return { id: item.row.id, duplicate: false };
    });
    tx.set(versionRef, { version: Number(version.exists && version.data().version || 0) + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'manager-tuition' }, { merge: true });
    return { ok: true, periods: result };
  });
}

async function adminRecordTuitionTransaction(data) {
  const periodId = clean(data.periodId);
  const groups = await readCourseGroups();
  if (groups.some(group => (group.hiddenPeriodIds || []).includes(periodId))) throw new HttpsError('failed-precondition', '此期別已合併為團體班，請重新載入後在團體班期別收退款。');
  const incoming = {
    id: clean(data.id), type: clean(data.type), amount: Number(data.amount),
    date: dateKey(data.date), method: clean(data.method).slice(0, 80), note: clean(data.note).slice(0, 2000)
  };
  if (!periodId || periodId.includes('/') || periodId.length > 180 || !incoming.date) throw new HttpsError('invalid-argument', '缺少有效的期別或日期。');
  try { validateTransaction({ transactions: [{ ...incoming }] }, incoming); } catch (error) { throw new HttpsError('invalid-argument', error.message); }
  const periodRef = db.collection(TUITION_PERIODS).doc(periodId);
  const transactionRef = db.collection(TUITION_TRANSACTIONS).doc(incoming.id);
  const lockRef = db.collection('coursePortalTuitionLedgerLocks').doc(periodId);
  const versionRef = scheduleVersionRef();
  return db.runTransaction(async tx => {
    const version = await tx.get(versionRef);
    const lock = await tx.get(lockRef);
    const mirror = await tx.get(db.collection(MIRROR.tuitionPeriods).where('source.id', '==', periodId));
    const portal = await tx.get(periodRef);
    const transactions = await tx.get(db.collection(TUITION_TRANSACTIONS).where('periodId', '==', periodId));
    const existing = await tx.get(transactionRef);
    assertScheduleWritable(version);
    if (existing.exists && clean(existing.data().periodId) !== periodId) throw new HttpsError('already-exists', '交易識別碼已存在。');
    const bases = mirror.docs.filter(doc => doc.data().sourceActive !== false).map(doc => doc.data().source || {});
    const period = mergePortalTuitionRows(bases, portal.exists ? [portal] : [], transactions.docs).find(row => sourceId(row) === periodId);
    if (!period || period.active === false) throw new HttpsError('not-found', '找不到有效的學費期別。');
    let checked;
    try { checked = validateTransaction(period, incoming); } catch (error) { throw new HttpsError('failed-precondition', error.message); }
    if (checked.duplicate) return { ok: true, duplicate: true, transaction: existing.exists ? jsonValue(existing.data()) : incoming };
    const record = Object.assign({}, incoming, { periodId, studentId: clean(period.studentId), status: 'confirmed', active: true, source: 'manager-ledger' });
    tx.create(transactionRef, Object.assign({}, record, { createdAt: FieldValue.serverTimestamp() }));
    tx.set(lockRef, { revision: Number(lock.exists && lock.data().revision || 0) + 1, updatedAt: FieldValue.serverTimestamp() });
    tx.set(versionRef, { version: Number(version.exists && version.data().version || 0) + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'manager-ledger' }, { merge: true });
    return { ok: true, transaction: record };
  });
}

async function adminSaveTeacherSubjects(data) {
  const teacherId = clean(data && data.teacherId);
  const selectedSubjectIds = [...new Set(
    (Array.isArray(data && data.subjectIds) ? data.subjectIds : []).map(clean).filter(Boolean)
  )];
  if (!teacherId) throw new HttpsError('invalid-argument', '缺少老師資料。');
  const [teachers, subjects] = await Promise.all([
    mirrorRowsIncludingInactive('teachers'),
    mirrorRows('subjects')
  ]);
  const teacher = teachers.find((row) => sourceId(row) === teacherId);
  const profile = data && data.profile;
  if (!teacher && !profile) throw new HttpsError('not-found', '找不到指定的老師。');
  if (teacherId.includes('/') || teacherId.length > 160) throw new HttpsError('invalid-argument', '老師識別碼格式錯誤。');
  let managerProfile;
  if (profile) {
    const name = clean(profile.name);
    if (!name || name.length > 80) throw new HttpsError('invalid-argument', '請填寫有效的老師姓名。');
    managerProfile = { name, phone: normalizePhone(profile.phone), active: profile.active !== false, note: clean(profile.note).slice(0, 2000) };
  }
  const activeSubjectIds = new Set(subjects.filter((row) => row.active !== false)
    .map(sourceId).filter(Boolean));
  const unknown = selectedSubjectIds.filter((id) => !activeSubjectIds.has(id));
  if (unknown.length) {
    throw new HttpsError('failed-precondition', '部分授課科目不存在或已停用，請先確認共用科目清單。');
  }
  const assignmentRef = db.collection(TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION).doc(teacherId);
  const versionRef = scheduleVersionRef();
  let savedPatch = null;
  await db.runTransaction(async (tx) => {
    const [assignmentSnapshot, versionSnapshot] = await Promise.all([
      tx.get(assignmentRef),
      tx.get(versionRef)
    ]);
    const existing = assignmentSnapshot.exists ? assignmentSnapshot.data() || {} : {};
    savedPatch = managerAssignmentPatch(existing, selectedSubjectIds, {
      teacherId,
      employeeId: clean(teacher && (teacher.employeeId || teacher.personMasterId)),
      nowText: nowText()
    }, FieldValue);
    tx.set(assignmentRef, Object.assign({}, savedPatch, managerProfile ? { managerProfile } : {}, {
      updatedBy: 'course-scheduler-manager'
    }), { merge: true });
    tx.set(versionRef, {
      version: Number(versionSnapshot.exists && versionSnapshot.data().version || 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'admin-teacher-subjects'
    }, { merge: true });
  });
  return {
    ok: true,
    teacherId,
    subjectIds: savedPatch.effectiveSubjectIds,
    teacher: Object.assign({}, teacher || { id: teacherId }, managerProfile || {}, { subjectIds: savedPatch.effectiveSubjectIds }),
    message: '老師可教授科目已同步。'
  };
}

function adminMutationResultRow(row) {
  const result = Object.assign({}, row || {});
  ['createdAt', 'updatedAt', 'approvedAt'].forEach((key) => delete result[key]);
  return result;
}

async function adminSaveSubjectCatalog(data) {
  const name = clean(data && data.name).normalize('NFKC');
  if (!name || name.length > 80) throw new HttpsError('invalid-argument', '科目名稱需為 1～80 個字。');
  const requestedId = clean(data && data.id);
  const [subjects, feePlans] = await Promise.all([
    mirrorRowsIncludingInactive('subjects'),
    mirrorRowsIncludingInactive('feePlans')
  ]);
  const current = requestedId ? subjects.find((row) => sourceId(row) === requestedId) : null;
  const normalizedName = normalizedSubjectName(name);
  const duplicate = subjects.find((row) =>
    normalizedSubjectName(row.name) === normalizedName && (!current || sourceId(row) !== sourceId(current))
  );
  if (current && duplicate) throw new HttpsError('already-exists', '已有相同名稱的科目，請直接使用既有項目。');
  const id = sourceId(current || duplicate) || catalogSubjectId(name);
  if (!id) throw new HttpsError('invalid-argument', '科目資料不完整。');
  const hasConfiguredPlan = feePlans.some((row) =>
    clean(row.subjectId) === id && feePlanConfigured(row)
  );
  const requestedActive = data && data.active !== false;
  const active = requestedActive;
  const approvalStatus = active ? 'active' : 'inactive';
  const subject = {
    id,
    subjectId: id,
    name,
    normalizedName,
    sort: Number.isFinite(Number(data && data.sort)) ? Number(data.sort) : Number(current && current.sort || 0),
    active,
    approvalStatus,
    status: approvalStatus,
    pricingStatus: hasConfiguredPlan ? 'configured' : 'unconfigured',
    source: 'course-scheduler-manager',
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtText: nowText()
  };
  if (active) {
    subject.approvedBy = 'course-scheduler-manager';
    subject.approvedAt = FieldValue.serverTimestamp();
  }
  const batch = db.batch();
  batch.set(db.collection(SUBJECT_CATALOG_COLLECTION).doc(id), subject, { merge: true });
  batch.set(scheduleVersionRef(), {
    version: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'admin-subject-catalog'
  }, { merge: true });
  await batch.commit();
  return {
    ok: true,
    subject: adminMutationResultRow(subject),
    needsFeePlan: !hasConfiguredPlan,
    message: hasConfiguredPlan
      ? (duplicate ? '已沿用既有科目。' : '共用科目已同步。')
      : '共用科目已儲存；目前尚未設定收費，需要時再新增即可。'
  };
}

function normalizeAdminFeePlan(data, existing = {}) {
  const name = clean(data && data.name).normalize('NFKC');
  const subjectId = clean(data && data.subjectId);
  const amount = Number(data && data.amount);
  const lessonCount = Number(data && data.lessonCount);
  const splitType = clean(data && data.splitType).toLowerCase();
  let splitValue = Number(data && data.splitValue);
  if (!name || name.length > 80) throw new HttpsError('invalid-argument', '方案名稱需為 1～80 個字。');
  if (!subjectId) throw new HttpsError('invalid-argument', '請選擇科目。');
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpsError('invalid-argument', '請填寫大於 0 的正式收費金額。');
  if (!Number.isInteger(lessonCount) || lessonCount <= 0 || lessonCount > 100) {
    throw new HttpsError('invalid-argument', '每期堂數需為 1～100 堂。');
  }
  if (!['ratio', 'fixed', 'none'].includes(splitType)) {
    throw new HttpsError('invalid-argument', '請選擇老師拆帳方式。');
  }
  if (splitType === 'none') splitValue = 0;
  if (splitType === 'ratio' && (!Number.isFinite(splitValue) || splitValue < 0 || splitValue > 100)) {
    throw new HttpsError('invalid-argument', '老師拆帳比例需介於 0～100%。');
  }
  if (splitType === 'fixed' && (!Number.isFinite(splitValue) || splitValue < 0)) {
    throw new HttpsError('invalid-argument', '每堂固定老師薪資不可小於 0。');
  }
  const id = clean(data && data.id) || feePlanId(subjectId, name);
  if (!id) throw new HttpsError('invalid-argument', '收費方案資料不完整。');
  return {
    id,
    subjectId,
    name,
    sort: Number.isFinite(Number(data && data.sort)) ? Number(data.sort) : Number(existing.sort || 0),
    amount,
    lessonCount,
    splitType,
    splitValue,
    zeroTeacherPayConfirmed: splitValue === 0,
    leaveNoDeduct: data && data.leaveNoDeduct !== false,
    expiryDays: Math.max(0, Math.round(Number(data && data.expiryDays) || 0)),
    active: data && data.active !== false,
    listed: data && data.listed !== false,
    source: 'course-scheduler-manager',
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtText: nowText()
  };
}

async function adminSaveFeePlan(data) {
  const requestedId = clean(data && data.id);
  const [subjects, feePlans] = await Promise.all([
    mirrorRowsIncludingInactive('subjects'),
    mirrorRowsIncludingInactive('feePlans')
  ]);
  const existing = requestedId ? feePlans.find((row) => sourceId(row) === requestedId) || {} : {};
  const plan = normalizeAdminFeePlan(data, existing);
  const subject = subjects.find((row) => sourceId(row) === plan.subjectId);
  if (!subject) throw new HttpsError('not-found', '找不到指定科目，請重新整理後再試。');
  const subjectHasConfiguredPlan = feePlans
    .filter((row) => sourceId(row) !== plan.id)
    .concat([plan])
    .some((row) => clean(row.subjectId) === plan.subjectId && feePlanConfigured(row));
  const catalogRef = db.collection(SUBJECT_CATALOG_COLLECTION).doc(plan.subjectId);
  const catalogSnapshot = await catalogRef.get();
  const catalogExisting = catalogSnapshot.exists ? catalogSnapshot.data() || {} : {};
  const batch = db.batch();
  const planWrite = Object.assign({}, plan);
  if (!existing.id) planWrite.createdAt = FieldValue.serverTimestamp();
  batch.set(db.collection(FEE_PLAN_COLLECTION).doc(plan.id), planWrite, { merge: true });
  const subjectPatch = {
    id: plan.subjectId,
    subjectId: plan.subjectId,
    name: clean(subject.name),
    normalizedName: normalizedSubjectName(subject.name),
    sort: Number(subject.sort || catalogExisting.sort || 0),
    approvalStatus: subject.active === false ? 'inactive' : 'active',
    status: subject.active === false ? 'inactive' : 'active',
    pricingStatus: subjectHasConfiguredPlan ? 'configured' : 'unconfigured',
    active: subject.active !== false,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtText: nowText(),
    source: clean(catalogExisting.source) || 'course-scheduler-manager'
  };
  if (subject.active !== false) {
    subjectPatch.approvedBy = 'course-scheduler-manager';
    subjectPatch.approvedAt = FieldValue.serverTimestamp();
  }
  batch.set(catalogRef, subjectPatch, { merge: true });
  batch.set(scheduleVersionRef(), {
    version: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'admin-fee-plan'
  }, { merge: true });
  await batch.commit();
  return {
    ok: true,
    feePlan: adminMutationResultRow(plan),
    subject: adminMutationResultRow(subjectPatch),
    activatedTeacherIds: [],
    message: subjectHasConfiguredPlan
      ? '收費方案已儲存。老師可教科目不受影響。'
      : '收費方案已停用；共用科目與老師授課能力仍保留。'
  };
}

function replaceAssignmentSubject(existing, sourceSubjectId, targetSubjectId) {
  const replace = (values) => [...new Set((values || []).map(clean).filter(Boolean).map((id) =>
    id === sourceSubjectId ? targetSubjectId : id
  ))];
  const profileSubjectIds = replace(existing.profileSubjectIds);
  const managerAddedSubjectIds = replace(existing.managerAddedSubjectIds);
  const managerExcludedSubjectIds = replace(existing.managerExcludedSubjectIds);
  const excluded = new Set(managerExcludedSubjectIds);
  const effectiveSubjectIds = [...new Set(
    profileSubjectIds.concat(managerAddedSubjectIds).filter((id) => !excluded.has(id))
  )];
  return { profileSubjectIds, managerAddedSubjectIds, managerExcludedSubjectIds, effectiveSubjectIds };
}

async function adminMapSubjectSuggestion(data) {
  const suggestionId = clean(data && data.suggestionId);
  const targetSubjectId = clean(data && data.targetSubjectId);
  if (!suggestionId || !targetSubjectId || suggestionId === targetSubjectId) {
    throw new HttpsError('invalid-argument', '請選擇要對應的既有科目。');
  }
  const [suggestionSnapshot, subjects, assignments] = await Promise.all([
    db.collection(SUBJECT_CATALOG_COLLECTION).doc(suggestionId).get(),
    mirrorRows('subjects'),
    db.collection(TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION)
      .where('profileSubjectIds', 'array-contains', suggestionId).get()
  ]);
  if (!suggestionSnapshot.exists) throw new HttpsError('not-found', '找不到待處理的授課項目。');
  const target = subjects.find((row) => sourceId(row) === targetSubjectId && row.active !== false);
  if (!target) {
    throw new HttpsError('failed-precondition', '目標科目不存在或已停用，不能進行對應。');
  }
  const batch = db.batch();
  batch.set(suggestionSnapshot.ref, {
    approvalStatus: 'mapped',
    status: 'mapped',
    active: false,
    mappedToSubjectId: targetSubjectId,
    mappedToSubjectName: clean(target.name),
    mappedAt: FieldValue.serverTimestamp(),
    mappedBy: 'course-scheduler-manager',
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtText: nowText()
  }, { merge: true });
  const teacherIds = [];
  assignments.docs.forEach((doc) => {
    const row = doc.data() || {};
    teacherIds.push(clean(row.teacherId) || doc.id);
    batch.set(doc.ref, Object.assign({}, replaceAssignmentSubject(row, suggestionId, targetSubjectId), {
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtText: nowText(),
      updatedBy: 'subject-suggestion-mapping'
    }), { merge: true });
  });
  batch.set(scheduleVersionRef(), {
    version: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: 'admin-subject-mapping'
  }, { merge: true });
  await batch.commit();
  return {
    ok: true,
    suggestionId,
    targetSubjectId,
    targetSubjectName: clean(target.name),
    teacherIds,
    message: `已對應到「${clean(target.name)}」。`
  };
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
        teacherSchedulable: roomTeacherSchedulable(room, setting),
        capacity: rentalRoomProfile(room, setting).capacity
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
      capacity: Math.max(1, Number(row.capacity || 1)),
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

function managerAuthenticated(request) {
  const token = request && request.auth && request.auth.token || {};
  return token.manager === true || clean(token.role).toLowerCase() === 'admin';
}

function assertAdminPin(request) {
  if (managerAuthenticated(request)) return;
  const value = clean(request && request.data && request.data.adminPin);
  let expected = '';
  try { expected = clean(ADMIN_PIN.value()); } catch (_) { expected = clean(process.env.INJIAOYUN_MANUAL_SYNC_PIN); }
  if (!expected || !safeEqual(value, expected)) throw new HttpsError('permission-denied', '管理者登入狀態已失效，請重新登入。');
}

async function adminRentalIdentityResolver() {
  const [teachers, students, renters, teacherBindings, studentBindings, renterBindings] = await Promise.all([
    mirrorRows('teachers'),
    mirrorRows('students'),
    db.collection('coursePortalRenters').get(),
    db.collection('coursePortalTeacherBindings').get(),
    db.collection('coursePortalStudentBindings').get(),
    db.collection('coursePortalRenterBindings').get()
  ]);
  const teacherMap = indexById(teachers);
  const studentMap = indexById(students);
  const renterMap = {};
  renters.docs.forEach((doc) => { renterMap[doc.id] = doc.data() || {}; });
  const identities = new Map();
  const add = (key, identity) => {
    if (!key || identities.has(key) || (!identity.name && !identity.phone)) return;
    identities.set(key, identity);
  };
  const addBinding = (role, doc) => {
    const row = doc.data() || {};
    if (clean(row.status) !== 'active') return;
    const targetId = role === 'teacher'
      ? clean(row.teacherId)
      : (role === 'student' ? clean(row.studentId) : clean(row.renterId));
    const profile = role === 'teacher'
      ? teacherMap[targetId] || {}
      : (role === 'student' ? studentMap[targetId] || {} : renterMap[targetId] || {});
    const identity = {
      name: safeRentalDisplayName(row.name || row.displayName || profile.name || profile.displayName || row.lineDisplayName),
      phone: normalizePhone(sourcePhone(profile) || row.phone),
      studentId: role === 'student' ? targetId : ''
    };
    add(`${role}:target:${targetId}`, identity);
    add(`${role}:account:${clean(row.authAccountId)}`, identity);
    add(`${role}:line:${clean(row.lineUserId)}`, identity);
  };
  teacherBindings.docs.forEach((doc) => addBinding('teacher', doc));
  studentBindings.docs.forEach((doc) => addBinding('student', doc));
  renterBindings.docs.forEach((doc) => addBinding('renter', doc));

  return (row) => {
    const role = clean(row.role);
    const targetId = role === 'teacher'
      ? clean(row.teacherId)
      : (role === 'student' ? clean(row.rentalStudentId) : clean(row.renterId));
    const ownerKey = clean(row.ownerKey);
    const keys = [
      targetId ? `${role}:target:${targetId}` : '',
      ownerKey ? `${role}:${ownerKey}` : '',
      clean(row.authAccountId) ? `${role}:account:${clean(row.authAccountId)}` : '',
      clean(row.lineUserId) ? `${role}:line:${clean(row.lineUserId)}` : ''
    ].filter(Boolean);
    const fallback = keys.map((key) => identities.get(key)).find(Boolean) || {};
    return {
      name: safeRentalDisplayName(row.clientName || row.renterName || fallback.name),
      phone: normalizePhone(row.clientPhone || fallback.phone),
      studentId: clean(row.rentalStudentId || fallback.studentId)
    };
  };
}

async function adminRoomBookings() {
  const [snapshot, resolveIdentity] = await Promise.all([
    db.collection('coursePortalRoomBookings').get(),
    adminRentalIdentityResolver()
  ]);
  const bookings = snapshot.docs.map((doc) => {
    const row = jsonValue(doc.data()) || {};
    const identity = resolveIdentity(row);
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
      clientName: identity.name,
      clientPhone: identity.phone,
      role: clean(row.role),
      rentalStudentId: identity.studentId,
      amount: Number(row.amount || row.rentalFee || 0),
      paymentStatus: clean(row.paymentStatus),
      priceType: clean(row.priceType),
      status: clean(row.status || (row.active === false ? 'cancelled' : 'confirmed')),
      active: row.active !== false,
      createdAtText: clean(row.createdAtText),
      cancelledAtText: clean(row.cancelledAtText),
      cancellationReason: clean(row.cancellationReason),
      source: 'course-portal'
    };
  }).filter((row) => row.date && row.startTime && row.roomId);
  return { ok: true, bookings, updatedAt: new Date().toISOString() };
}

async function adminCancelRoomBooking(data) {
  const bookingId = clean(data.bookingId);
  const reason = clean(data.reason).slice(0, 200);
  if (!bookingId) throw new HttpsError('invalid-argument', '缺少租用紀錄。');
  const bookingRef = db.collection('coursePortalRoomBookings').doc(bookingId);
  const changeRef = db.collection('coursePortalScheduleChanges').doc(`rental-${bookingId}`);
  const versionRef = scheduleVersionRef();
  const lockSnapshot = await db.collection('coursePortalRoomLocks').where('bookingId', '==', bookingId).get();
  let cancelledBooking = null;
  await db.runTransaction(async (tx) => {
    const [bookingSnapshot, versionSnapshot] = await Promise.all([
      tx.get(bookingRef),
      tx.get(versionRef)
    ]);
    assertScheduleWritable(versionSnapshot);
    if (!bookingSnapshot.exists) throw new HttpsError('not-found', '找不到這筆租用紀錄。');
    const booking = bookingSnapshot.data() || {};
    if (booking.active === false || clean(booking.status) === 'cancelled') {
      throw new HttpsError('failed-precondition', '這筆租用已經取消。');
    }
    cancelledBooking = booking;
    const cancellation = {
      active: false,
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledAtText: nowText(),
      cancelledBy: 'admin',
      cancellationReason: reason || '管理者強制取消',
      updatedAt: FieldValue.serverTimestamp()
    };
    tx.set(bookingRef, cancellation, { merge: true });
    tx.set(changeRef, cancellation, { merge: true });
    const lockRefs = new Map();
    (Array.isArray(booking.lockIds) ? booking.lockIds : []).map(clean).filter(Boolean).forEach((lockId) => {
      const ref = db.collection('coursePortalRoomLocks').doc(lockId);
      lockRefs.set(ref.path, ref);
    });
    lockSnapshot.docs.forEach((doc) => lockRefs.set(doc.ref.path, doc.ref));
    lockRefs.forEach((ref) => tx.delete(ref));
    const currentVersion = Number(versionSnapshot.exists && versionSnapshot.data().version || 0);
    tx.set(versionRef, {
      version: currentVersion + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'admin-room-booking-cancel'
    }, { merge: true });
  });

  await db.collection('notificationQueue').doc(`course-portal-booking-${bookingId}-reminder`).set({
    status: '已取消',
    active: false,
    cancelledAt: FieldValue.serverTimestamp(),
    cancelledAtText: nowText()
  }, { merge: true }).catch((error) => {
    console.error('[course portal admin rental reminder cancellation failed]', bookingId, error);
  });
  if (cancelledBooking && (clean(cancelledBooking.lineUserId) || clean(cancelledBooking.notificationEmail))) {
    const cancellationText = [
      '很抱歉，因以下原因，需取消您的教室預約。',
      `教室：${clean(cancelledBooking.roomName) || '教室'}`,
      `時間：${dateKey(cancelledBooking.date)} ${eventStart(cancelledBooking)}～${eventEnd(cancelledBooking)}`,
      reason ? `原因：${reason}` : '原因：特殊情況調整',
      '此筆預約已取消。若您仍有租用需求，請至租用頁面選擇其他適合的時段，重新填寫預約。',
      `${PORTAL_BASE}/room-booking.html`,
      '造成不便，敬請見諒。如需協助，歡迎聯絡柚子樂器。'
    ].filter(Boolean).join('\n');
    await db.collection('notificationQueue').doc(`course-portal-booking-${bookingId}-admin-cancel`).set({
      queueId: `course-portal-booking-${bookingId}-admin-cancel`,
      channel: 'line',
      ...recipientFields({ ...cancelledBooking, email: cancelledBooking.notificationEmail }),
      title: '教室租用取消通知',
      body: cancellationText,
      message: cancellationText,
      bookingId,
      source: 'course-portal-admin-cancellation',
      status: '待發送',
      scheduledAt: Timestamp.fromMillis(Date.now()),
      createdAt: FieldValue.serverTimestamp(),
      createdAtText: nowText()
    }, { merge: true }).catch((error) => {
      console.error('[course portal admin rental cancellation notice failed]', bookingId, error);
    });
  }
  return { ok: true, bookingId, status: 'cancelled', message: '租用已強制取消，教室時段已釋放。' };
}

function adminTuitionPaymentRow(doc) {
  const source = doc.data ? doc.data() || {} : doc || {};
  return {
    id: clean(source.id || doc.id),
    studentId: clean(source.studentId),
    studentName: clean(source.studentName),
    subjectName: clean(source.subjectName),
    teacherName: clean(source.teacherName),
    nextPeriodNo: Number(source.nextPeriodNo || 0),
    nextSystemPeriodNo: Number(source.nextSystemPeriodNo || 0),
    lessonCount: Number(source.lessonCount || 4),
    expectedAmount: Number(source.expectedAmount || 0),
    confirmedAmount: Number(source.confirmedAmount || 0),
    remainingAmount: Math.max(0, Number(
      source.remainingAmount != null
        ? source.remainingAmount
        : Number(source.expectedAmount || 0) - Number(source.confirmedAmount || 0)
    )),
    paymentMethod: clean(source.paymentMethod),
    status: clean(source.status),
    transferDate: dateKey(source.transferDate),
    transferLast5: clean(source.transferLast5).slice(-5),
    submittedAtText: clean(source.submittedAtText),
    reviewNote: clean(source.reviewNote),
    hasReceipt: Boolean(clean(source.receiptStoragePath)),
    submissionRevision: Number(source.submissionRevision || 0)
  };
}

async function adminTuitionPaymentScreenshot(data) {
  const id = clean(data.id);
  if (!id) throw new HttpsError('invalid-argument', '缺少學費付款資料。');
  const snapshot = await db.collection(TUITION_PAYMENT_REQUESTS).doc(id).get();
  if (!snapshot.exists) throw new HttpsError('not-found', '找不到這筆學費付款資料。');
  const row = snapshot.data() || {};
  const storagePath = clean(row.receiptStoragePath);
  if (!storagePath) throw new HttpsError('not-found', '這筆資料沒有匯款截圖。');
  const [buffer] = await admin.storage().bucket().file(storagePath).download();
  if (!buffer.length || buffer.length > TUITION_RECEIPT_MAX_BYTES) {
    throw new HttpsError('failed-precondition', '匯款截圖大小異常，請請學生重新上傳。');
  }
  const contentType = clean(row.receiptContentType) || 'image/jpeg';
  return {
    ok: true,
    id,
    contentType,
    dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`
  };
}

function escapeReceiptText(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function receiptTextLayer(value, fontSize) {
  return sharp({
    text: {
      text: `<span foreground="#343a30">${escapeReceiptText(value)}</span>`,
      font: `Noto Sans TC ${fontSize}`,
      fontfile: TUITION_RECEIPT_FONT,
      dpi: 96,
      rgba: true
    }
  }).png().toBuffer({ resolveWithObject: true });
}

async function renderTuitionReceiptPng(receipt) {
  const parts = (dateKey(receipt.paymentDate) || currentTaipeiDay()).split('-');
  const amount = Math.max(0, Number(receipt.amount || 0)).toLocaleString('zh-TW');
  const specs = [
    { value: parts[0] || '', fontSize: 26, centerX: 263, top: 259 },
    { value: parts[1] || '', fontSize: 26, centerX: 434, top: 259 },
    { value: parts[2] || '', fontSize: 26, centerX: 607, top: 259 },
    { value: receipt.studentName || '學生', fontSize: 29, centerX: 457, top: 366 },
    { value: amount, fontSize: 31, centerX: 433, top: 474 }
  ];
  const layers = await Promise.all(specs.map((spec) => receiptTextLayer(spec.value, spec.fontSize)));
  return sharp(TUITION_RECEIPT_TEMPLATE)
    .composite(layers.map((layer, index) => ({
      input: layer.data,
      left: Math.max(0, Math.round(specs[index].centerX - layer.info.width / 2)),
      top: specs[index].top
    })))
    .png({ compressionLevel: 9, quality: 100 })
    .toBuffer();
}

async function saveTuitionReceiptImage(receiptId, buffer) {
  const storagePath = `course-portal/tuition-receipts/${clean(receiptId)}.png`;
  const downloadToken = crypto.randomUUID();
  const bucket = admin.storage().bucket();
  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType: 'image/png',
      cacheControl: 'private, max-age=0, no-transform',
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        tuitionReceiptId: clean(receiptId)
      }
    }
  });
  const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(downloadToken)}`;
  return { storagePath, downloadToken, imageUrl };
}

function adminTuitionReceiptRow(doc) {
  const source = doc.data ? doc.data() || {} : doc || {};
  return {
    id: clean(source.id || doc.id),
    receiptNo: clean(source.receiptNo),
    studentId: clean(source.studentId),
    studentName: clean(source.studentName),
    paymentDate: dateKey(source.paymentDate),
    amount: Number(source.amount || 0),
    method: clean(source.method),
    imageUrl: clean(source.imageUrl),
    renderStatus: clean(source.renderStatus),
    lineDeliveryStatus: clean(source.lineDeliveryStatus),
    lineRecipientCount: Number(source.lineRecipientCount || 0),
    createdAtText: clean(source.createdAtText)
  };
}

async function adminEnsureTuitionReceipt(data) {
  const periodId = clean(data.periodId);
  if (!periodId) throw new HttpsError('invalid-argument', '缺少學費期別資料。');
  const periods = await mirrorRows('tuitionPeriods');
  const period = periods.find((row) => sourceId(row) === periodId);
  if (!period) throw new HttpsError('not-found', '找不到這筆學費期別。');
  const transactions = Array.isArray(period.transactions) ? period.transactions : [];
  const requestedId = clean(data.transactionId);
  const requestedIndex = Number.isInteger(Number(data.transactionIndex)) ? Number(data.transactionIndex) : -1;
  let transactionIndex = transactions.findIndex((row) => requestedId && clean(row && row.id) === requestedId);
  if (transactionIndex < 0 && requestedIndex >= 0 && requestedIndex < transactions.length) transactionIndex = requestedIndex;
  if (transactionIndex < 0) {
    const requestedDate = dateKey(data.paymentDate);
    const requestedAmount = Math.max(0, Number(data.amount || 0));
    const requestedMethod = clean(data.method);
    transactionIndex = transactions.findIndex((row) =>
      clean(row && row.type) !== 'refund' &&
      dateKey(row && (row.date || row.created)) === requestedDate &&
      transactionAmount(row) === requestedAmount &&
      clean(row && (row.method || row.payType || row.paymentMethod)) === requestedMethod
    );
  }
  const transaction = transactions[transactionIndex];
  if (!transaction || clean(transaction.type) === 'refund') {
    throw new HttpsError('not-found', '找不到可開立收據的收費紀錄。');
  }
  const amount = transactionAmount(transaction);
  if (!amount) throw new HttpsError('failed-precondition', '這筆收費金額為 0，無法開立收據。');
  const studentId = clean(period.studentId);
  const students = await mirrorRows('students');
  const student = students.find((row) => sourceId(row) === studentId) || {};
  const paymentDate = dateKey(transaction.date || transaction.created || period.startDate) || currentTaipeiDay();
  const method = clean(transaction.method || transaction.payType || transaction.paymentMethod) || '既有繳費';
  const actualTransactionId = clean(transaction.id);
  const identity = `${periodId}|${actualTransactionId}|${transactionIndex}|${paymentDate}|${amount}|${method}`;
  const receiptId = `tuition-receipt-history-${hash(identity).slice(0, 24)}`;
  const receiptNo = `RCT-${paymentDate.replace(/-/g, '')}-${hash(identity).slice(0, 6).toUpperCase()}`;
  const receiptRef = db.collection(TUITION_RECEIPTS).doc(receiptId);
  const existing = await receiptRef.get();
  const existingRow = existing.exists ? existing.data() || {} : {};
  if (clean(existingRow.imageUrl)) {
    return {
      ok: true,
      receiptId,
      receiptNo: clean(existingRow.receiptNo) || receiptNo,
      receiptImageUrl: clean(existingRow.imageUrl),
      created: false
    };
  }
  await receiptRef.set({
    id: receiptId,
    receiptNo,
    active: true,
    source: 'historical-admin-backfill',
    status: 'issued',
    renderStatus: 'pending',
    studentId,
    studentName: clean(student.name) || clean(period.studentName) || '學生',
    subjectId: clean(period.subjectId),
    periodId,
    transactionId: actualTransactionId,
    transactionIndex,
    paymentDate,
    amount,
    method,
    printWidthCm: 15,
    printHeightCm: 10,
    lineDeliveryStatus: 'historical_not_sent',
    createdAt: existing.exists ? (existingRow.createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
    createdAtText: clean(existingRow.createdAtText) || nowText(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  try {
    const receiptBuffer = await renderTuitionReceiptPng({
      paymentDate,
      studentName: clean(student.name) || clean(period.studentName) || '學生',
      amount
    });
    const savedReceipt = await saveTuitionReceiptImage(receiptId, receiptBuffer);
    await receiptRef.set({
      renderStatus: 'ready',
      imageUrl: savedReceipt.imageUrl,
      imageStoragePath: savedReceipt.storagePath,
      imageContentType: 'image/png',
      imageBytes: receiptBuffer.length,
      renderedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return {
      ok: true,
      receiptId,
      receiptNo,
      receiptImageUrl: savedReceipt.imageUrl,
      created: true
    };
  } catch (error) {
    const message = clean(error && error.message) || '收據圖片產生失敗';
    await receiptRef.set({
      renderStatus: 'failed',
      renderError: message.slice(0, 500),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    throw new HttpsError('internal', `收據建立失敗：${message}`);
  }
}

async function adminTuitionPaymentAction(data) {
  const id = clean(data.id);
  const action = clean(data.action);
  if (!id || !['confirm', 'reject'].includes(action)) {
    throw new HttpsError('invalid-argument', '學費付款簽核資料不完整。');
  }
  const requestRef = db.collection(TUITION_PAYMENT_REQUESTS).doc(id);
  const preview = await requestRef.get();
  if (!preview.exists) throw new HttpsError('not-found', '找不到這筆學費付款資料。');
  const previewRow = Object.assign({ id: preview.id }, preview.data() || {});
  if (!['pending_review', 'onsite_pending'].includes(clean(previewRow.status))) {
    throw new HttpsError('failed-precondition', '這筆學費目前不是等待主管確認的狀態。');
  }
  if (action === 'reject') {
    const reviewNote = clean(data.reviewNote) || '匯款資料無法確認，請重新上傳清楚的付款資料。';
    await requestRef.set({
      status: 'needs_resubmission',
      reviewNote,
      rejectedAt: FieldValue.serverTimestamp(),
      rejectedAtText: nowText(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    const body = [
      `${clean(previewRow.studentName) || '同學'}您好，您送出的${newSystemTuitionPeriodLabel(previewRow, 'next')}學費資料需要重新確認。`,
      `原因：${reviewNote}`,
      `請重新進入學生入口上傳：${PORTAL_BASE}/student-course-portal.html?studentId=${encodeURIComponent(clean(previewRow.studentId))}`
    ].join('\n');
    await queueStudentTuitionNotice(previewRow, '學費資料請重新上傳', body, `rejected-${Number(previewRow.submissionRevision || 0)}`, { forceBoundDelivery: true });
    return { ok: true, id, status: 'needs_resubmission', message: '已退回學生重新上傳。' };
  }

  const priorConfirmed = Math.max(0, Number(previewRow.confirmedAmount || 0));
  const remainingBefore = Math.max(0, Number(previewRow.expectedAmount || 0) - priorConfirmed);
  const confirmedAmount = Math.max(0, Number(data.confirmedAmount || remainingBefore || 0));
  if (!confirmedAmount) throw new HttpsError('invalid-argument', '請輸入實際收到的學費金額。');
  if (confirmedAmount > remainingBefore) {
    throw new HttpsError('invalid-argument', `本次金額不可超過尚未繳清的 NT$${remainingBefore.toLocaleString('zh-TW')}。`);
  }
  const paymentMethod = clean(previewRow.paymentMethod);
  if (!['bank_transfer', 'onsite'].includes(paymentMethod)) {
    throw new HttpsError('failed-precondition', '這筆資料沒有正確的付款方式。');
  }
  const targetPeriodId = clean(previewRow.targetPeriodId);
  const formalPeriodId = targetPeriodId || `portal-period-${id}`;
  const periodRef = db.collection(TUITION_PERIODS).doc(formalPeriodId);
  const transactionRevision = Math.max(1, Number(previewRow.submissionRevision || 1));
  const transactionRef = db.collection(TUITION_TRANSACTIONS).doc(`portal-payment-${id}-${transactionRevision}`);
  const paymentDate = paymentMethod === 'bank_transfer'
    ? (dateKey(previewRow.transferDate) || currentTaipeiDay())
    : currentTaipeiDay();
  const receiptId = `tuition-receipt-${transactionRef.id}`;
  const receiptRef = db.collection(TUITION_RECEIPTS).doc(receiptId);
  const receiptNo = `RCT-${paymentDate.replace(/-/g, '')}-${hash(transactionRef.id).slice(0, 6).toUpperCase()}`;
  await db.runTransaction(async (tx) => {
    const [requestSnapshot, periodSnapshot, transactionSnapshot] = await Promise.all([
      tx.get(requestRef),
      tx.get(periodRef),
      tx.get(transactionRef)
    ]);
    const requestRow = requestSnapshot.exists ? requestSnapshot.data() || {} : null;
    if (!requestRow || !['pending_review', 'onsite_pending'].includes(clean(requestRow.status))) {
      throw new HttpsError('failed-precondition', '這筆學費已被其他人處理，請重新整理。');
    }
    const currentConfirmed = Math.max(0, Number(requestRow.confirmedAmount || 0));
    const currentRemaining = Math.max(0, Number(requestRow.expectedAmount || 0) - currentConfirmed);
    if (confirmedAmount > currentRemaining) {
      throw new HttpsError('failed-precondition', '這筆學費剛剛已由其他裝置更新，請重新整理後再確認。');
    }
    const cumulativeConfirmed = currentConfirmed + confirmedAmount;
    const remainingAmount = Math.max(0, Number(requestRow.expectedAmount || 0) - cumulativeConfirmed);
    if (!targetPeriodId && !periodSnapshot.exists) {
      tx.set(periodRef, {
        id: formalPeriodId,
        active: true,
        source: 'course-portal',
        studentId: clean(requestRow.studentId),
        subjectId: clean(requestRow.subjectId),
        teacherId: clean(requestRow.teacherId),
        sourcePeriodId: clean(requestRow.sourcePeriodId),
        planId: clean(requestRow.planId),
        planSnapshot: jsonValue(requestRow.planSnapshot || {}),
        periodNo: Number(requestRow.nextPeriodNo || 0),
        systemPeriodNo: Number(requestRow.nextSystemPeriodNo || 0),
        lessonCount: Number(requestRow.lessonCount || 4),
        usedCount: 0,
        expectedAmount: Number(requestRow.grossExpectedAmount || requestRow.expectedAmount || confirmedAmount),
        paidAmount: 0,
        discount: Math.max(0, Number(requestRow.discount || 0)),
        discountType: clean(requestRow.discountType),
        teacherPayBasis: clean(requestRow.teacherPayBasis),
        payByDiscount: typeof requestRow.payByDiscount === 'boolean'
          ? requestRow.payByDiscount
          : clean(requestRow.teacherPayBasis) !== 'gross',
        status: 'active',
        paymentRequestId: id,
        createdAt: FieldValue.serverTimestamp(),
        createdAtText: nowText(),
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    if (!transactionSnapshot.exists) {
      tx.set(transactionRef, {
        id: transactionRef.id,
        active: true,
        status: 'confirmed',
        source: 'course-portal',
        type: 'payment',
        studentId: clean(requestRow.studentId),
        periodId: formalPeriodId,
        paymentRequestId: id,
        receiptId,
        receiptNo,
        date: paymentDate,
        amount: confirmedAmount,
        method: paymentMethod === 'bank_transfer' ? '轉帳' : '現場繳費',
        transferLast5: clean(requestRow.transferLast5).slice(-5),
        confirmedAt: FieldValue.serverTimestamp(),
        confirmedAtText: nowText(),
        createdAt: FieldValue.serverTimestamp()
      });
    }
    tx.set(receiptRef, {
      id: receiptId,
      receiptNo,
      active: true,
      source: 'course-portal',
      status: 'issued',
      renderStatus: 'pending',
      studentId: clean(requestRow.studentId),
      studentName: clean(requestRow.studentName) || clean(previewRow.studentName) || '學生',
      subjectId: clean(requestRow.subjectId),
      subjectName: clean(requestRow.subjectName),
      periodId: formalPeriodId,
      paymentRequestId: id,
      transactionId: transactionRef.id,
      paymentDate,
      amount: confirmedAmount,
      method: paymentMethod === 'bank_transfer' ? '轉帳' : '現場繳費',
      printWidthCm: 15,
      printHeightCm: 10,
      lineDeliveryStatus: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      createdAtText: nowText(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(requestRef, {
      status: remainingAmount > 0 ? 'payment_due' : 'confirmed',
      confirmedAmount: cumulativeConfirmed,
      remainingAmount,
      formalPeriodId,
      paymentDate,
      confirmedAt: FieldValue.serverTimestamp(),
      confirmedAtText: nowText(),
      reviewNote: '',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
  const methodText = paymentMethod === 'bank_transfer' ? '轉帳' : '現場繳費';
  const confirmedRow = Object.assign({}, previewRow, {
    id,
    confirmedAmount: priorConfirmed + confirmedAmount,
    remainingAmount: Math.max(0, remainingBefore - confirmedAmount),
    formalPeriodId,
    status: remainingBefore - confirmedAmount > 0 ? 'payment_due' : 'confirmed'
  });
  const remainingAmount = Math.max(0, remainingBefore - confirmedAmount);
  let receiptImageUrl = '';
  let receiptRenderError = '';
  try {
    const receiptBuffer = await renderTuitionReceiptPng({
      paymentDate,
      studentName: clean(previewRow.studentName) || '學生',
      amount: confirmedAmount
    });
    const savedReceipt = await saveTuitionReceiptImage(receiptId, receiptBuffer);
    receiptImageUrl = savedReceipt.imageUrl;
    await Promise.all([
      receiptRef.set({
        renderStatus: 'ready',
        imageUrl: receiptImageUrl,
        imageStoragePath: savedReceipt.storagePath,
        imageContentType: 'image/png',
        imageBytes: receiptBuffer.length,
        renderedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true }),
      transactionRef.set({
        receiptId,
        receiptNo,
        receiptImageUrl,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true }),
      requestRef.set({
        latestReceiptId: receiptId,
        latestReceiptNo: receiptNo,
        latestReceiptImageUrl: receiptImageUrl,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true })
    ]);
  } catch (error) {
    receiptRenderError = clean(error && error.message) || '收據圖片產生失敗';
    console.error('[tuition receipt render failed]', receiptId, error);
    await receiptRef.set({
      renderStatus: 'failed',
      renderError: receiptRenderError.slice(0, 500),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }
  const body = [
    `${clean(previewRow.studentName) || '同學'}您好，已收到學費 NT$${confirmedAmount.toLocaleString('zh-TW')}。`,
    `課程：${clean(previewRow.subjectName) || '課程'}・${newSystemTuitionPeriodLabel(previewRow, 'next')}`,
    `付款方式：${paymentMethod === 'bank_transfer' ? '轉帳' : '現場繳費'}`,
    remainingAmount > 0 ? `尚未繳清：NT$${remainingAmount.toLocaleString('zh-TW')}` : '本期學費已繳清。',
    receiptImageUrl ? '收據如附圖，請留存。' : '收據已建立，如需補印請聯絡柚子樂器。',
    '謝謝您。'
  ].join('\n');
  const lineRecipientCount = await queueStudentTuitionNotice(
    confirmedRow,
    remainingAmount > 0 ? '學費已部分入帳' : '下一期學費已確認',
    body,
    `confirmed-${Number(previewRow.submissionRevision || 0)}`,
    {
      forceBoundDelivery: true,
      receiptId,
      imageUrl: receiptImageUrl
    }
  );
  await receiptRef.set({
    lineDeliveryStatus: lineRecipientCount > 0 ? 'queued' : 'not_bound',
    lineRecipientCount,
    lineQueuedAt: lineRecipientCount > 0 ? FieldValue.serverTimestamp() : null,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return {
    ok: true,
    id,
    status: remainingAmount > 0 ? 'payment_due' : 'confirmed',
    formalPeriodId,
    remainingAmount,
    receiptId,
    receiptNo,
    receiptImageUrl,
    receiptRenderError,
    lineRecipientCount,
    message: remainingAmount > 0
      ? `已確認本次收款，尚餘 NT$${remainingAmount.toLocaleString('zh-TW')}。`
      : '已確認收款並建立正式下一期學費紀錄。'
  };
}

async function queueTeacherAttendanceDecision(requestRow, approved, reviewNote) {
  const snapshot = await db.collection('coursePortalTeacherBindings')
    .where('teacherId', '==', clean(requestRow.teacherId))
    .get();
  const body = approved
    ? [
      `您在 ${clean(requestRow.date)} 的取消簽到申請已核准。`,
      `學生：${clean((requestRow.studentNames || []).join('、')) || '未提供'}`,
      ...(requestRow.correctionSlots || []).map(slot => `${slot.studentName}：第 ${slot.periodNo} 期第 ${slot.slotNo} 格，原日期 ${slot.originalDate}`),
      '請將實體上課證原格內錯誤的日期及章記更正清除，保留該格供補登使用，後面的格子不要移動。',
      '例如後來於 9/2 補上這堂課，請將 9/2 填在原本錯誤日期的同一格並簽章。電腦簽到時請選擇補回原格，勿在其他格重複登記。',
      `行政處理費：NT$${ATTENDANCE_ADMIN_FEE}，已列入薪資扣款。`,
      '若更正操作遇到問題，請聯絡柚子樂器。'
    ].join('\n')
    : [
      `您在 ${clean(requestRow.date)} 的取消簽到申請未通過，原簽到紀錄維持不變。`,
      reviewNote ? `主管說明：${clean(reviewNote)}` : ''
    ].filter(Boolean).join('\n');
  await Promise.all(snapshot.docs.filter((doc) => {
    const row = doc.data() || {};
    return clean(row.status) === 'active' && notificationRecipientKey(row);
  }).map((doc) => queueCoursePortalNotice(
    `attendance-cancel-teacher-${clean(requestRow.id)}-${approved ? 'approved' : 'rejected'}-${doc.id}`,
    {
      eventCode: approved ? 'attendance_cancellation_approved' : 'attendance_cancellation_rejected',
      ...recipientFields(doc.data()),
      targetName: clean(requestRow.teacherName) || '老師',
      title: approved ? '取消簽到已核准' : '取消簽到未通過',
      body,
      text: body,
      message: body,
      attendanceCancellationId: clean(requestRow.id)
    }
  )));
}


async function attendanceCorrectionSlots(requestRow) {
  const slots = [];
  for (const studentId of requestRow.studentIds || []) {
    const [mirrorAttendance, portalAttendance, rawPeriods] = await Promise.all([
      mirrorRowsByField('attendance', 'studentId', studentId), portalAttendanceForStudents([studentId]),
      mirrorRowsByField('tuitionPeriods', 'studentId', studentId)
    ]);
    const records = mergePortalAttendanceRows(mirrorAttendance, portalAttendance);
    const original = records.find(row => eventDate(row) === requestRow.date &&
      eventTeacherId(row) === requestRow.teacherId && eventSubjectId(row) === requestRow.subjectId &&
      (!eventStart(row) || eventStart(row) === requestRow.startTime));
    const periodId = clean(original && (original.periodId || original.studentPayment));
    const periods = await assignNewSystemPeriodNumbers(rawPeriods);
    const period = periods.find(row => sourceId(row) === periodId || sourceId(row).replace(/^period_/, '') === periodId);
    if (!original || !period) throw new HttpsError('failed-precondition', '找不到原簽到對應的期別與格位，請先核對原始課程紀錄。');
    const ordered = records.filter(row => clean(row.periodId || row.studentPayment) === periodId &&
      ['attended', 'absent'].includes(normalizeScheduleStatus(row.status || row.type)))
      .sort((a,b) => `${eventDate(a)}|${eventStart(a)}`.localeCompare(`${eventDate(b)}|${eventStart(b)}`));
    const existing = await db.collection('coursePortalAttendanceCorrections').where('studentId', '==', studentId).get();
    const reserved = existing.docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(row => row.periodId === sourceId(period));
    const reused = reserved.find(slot => slot.replacementAttendanceId === sourceId(original));
    const index = ordered.indexOf(original);
    const occupied = new Set(reserved.map(slot => slot.slotNo));
    let cursor = 1;
    let inferredSlot = 0;
    for (const record of ordered) {
      if (reserved.some(slot => slot.replacementAttendanceId === sourceId(record))) continue;
      while (occupied.has(cursor)) cursor++;
      if (record === original) inferredSlot = cursor;
      occupied.add(cursor++);
    }
    const slotNo = reused ? reused.slotNo : Number(original.slotNo || original.lessonNo || inferredSlot);
    if (index < 0 || slotNo < 1 || slotNo > Number(period.lessonCount || 4)) throw new HttpsError('failed-precondition', '原格位資料不足，請先核對實體上課證。');
    slots.push({ id: reused ? reused.id : `${requestRow.id}-${studentId}`, cancellationId: requestRow.id, studentId,
      studentName: clean((requestRow.studentNames || [])[(requestRow.studentIds || []).indexOf(studentId)]),
      teacherId: requestRow.teacherId, subjectId: requestRow.subjectId, periodId: sourceId(period),
      periodNo: Number(period.systemPeriodNo || period.periodNo || 0), slotNo, originalDate: requestRow.date,
      originalStartTime: requestRow.startTime, originalAttendanceId: sourceId(original), replacementDate: '', replacementOperationId: '', replacementAttendanceId: '', status: 'pending' });
  }
  return slots;
}

async function teacherAttendanceCorrectionOptions(data) {
  const session = await requireSession(data, ['teacher']);
  const { event } = await teacherAttendanceEvent(session, data);
  const snapshot = await db.collection('coursePortalAttendanceCorrections').where('teacherId', '==', session.teacherId).get();
  return { corrections: snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(row =>
    row.status === 'pending' && row.subjectId === eventSubjectId(event) && eventStudentIds(event).includes(row.studentId)) };
}

async function adminAttendanceCancellationAction(data) {
  const id = clean(data.id);
  const action = clean(data.action);
  const reviewNote = clean(data.reviewNote);
  if (!id || !['approve', 'reject'].includes(action)) {
    throw new HttpsError('invalid-argument', '取消簽到審核資料不完整。');
  }
  const requestRef = db.collection(ATTENDANCE_CANCELLATIONS).doc(id);
  const preview = await requestRef.get();
  if (!preview.exists) throw new HttpsError('not-found', '找不到這筆取消簽到申請。');
  const requestRow = Object.assign({ id }, preview.data() || {});
  if (clean(requestRow.status) !== 'pending') {
    throw new HttpsError('failed-precondition', '這筆申請已經處理完成。');
  }
  if (action === 'reject') {
    let rejectedRow = requestRow;
    await db.runTransaction(async (tx) => {
      const currentSnapshot = await tx.get(requestRef);
      const current = currentSnapshot.exists ? currentSnapshot.data() || {} : null;
      if (!current || clean(current.status) !== 'pending') {
        throw new HttpsError('failed-precondition', '這筆申請已經處理完成。');
      }
      rejectedRow = Object.assign({ id }, current);
      tx.set(requestRef, {
        active: false,
        status: 'rejected',
        lastAction: 'rejected',
        lastActionAt: FieldValue.serverTimestamp(),
        lastActionAtText: nowText(),
        reviewNote,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedAtText: nowText(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
    await queueTeacherAttendanceDecision(rejectedRow, false, reviewNote);
    return { ok: true, id, status: 'rejected', message: '已拒絕取消簽到，原紀錄維持不變。' };
  }

  const correctionSlots = await attendanceCorrectionSlots({ ...requestRow, id });
  const lineage = clean(requestRow.courseId || requestRow.eventId);
  const statusRef = db.collection('coursePortalScheduleChanges')
    .doc(`lesson-status-${hash([requestRow.teacherId, lineage, requestRow.date].join('|'))}`);
  const payrollRef = db.collection(ATTENDANCE_PAYROLL).doc(clean(requestRow.operationId));
  const adjustmentRef = db.collection('coursePortalTeacherAdjustments').doc(`attendance-cancel-fee-${id}`);
  const lessonLockRef = db.collection('coursePortalAttendanceLessonLocks')
    .doc(attendanceLessonLockId(requestRow.date, {
      fixedCourseId: lineage,
      sourceId: requestRow.eventId
    }, {
      sourceCourseId: requestRow.courseId,
      sourceEventId: requestRow.eventId
    }));
  const versionRef = scheduleVersionRef();
  const attendanceRecordIds = [...new Set(
    (requestRow.attendanceRecordIds || [])
      .concat((requestRow.studentIds || []).map((studentId) =>
        hash([clean(requestRow.operationId), clean(studentId)].join('|'))
      ))
      .map(clean)
      .filter(Boolean)
  )];
  const attendanceRefs = attendanceRecordIds.map((recordId) =>
    db.collection(ATTENDANCE_RECORDS).doc(recordId)
  );
  await db.runTransaction(async (tx) => {
    const snapshots = await Promise.all([
      tx.get(requestRef),
      tx.get(versionRef),
      tx.get(statusRef),
      tx.get(payrollRef),
      tx.get(adjustmentRef),
      tx.get(lessonLockRef),
      ...attendanceRefs.map((ref) => tx.get(ref))
    ]);
    const current = snapshots[0].exists ? snapshots[0].data() || {} : null;
    if (!current || clean(current.status) !== 'pending') {
      throw new HttpsError('failed-precondition', '這筆申請已經處理完成。');
    }
    const versionSnapshot = snapshots[1];
    assertScheduleWritable(versionSnapshot);
    correctionSlots.forEach(slot => tx.set(db.collection('coursePortalAttendanceCorrections').doc(slot.id), { ...slot, createdAt: FieldValue.serverTimestamp() }));
    attendanceRefs.forEach((ref, index) => {
      const studentId = clean((requestRow.studentIds || []).find((candidate) =>
        hash([clean(requestRow.operationId), clean(candidate)].join('|')) === ref.id
      ) || (requestRow.studentIds || [])[index]);
      tx.set(ref, {
        id: ref.id,
        operationId: clean(requestRow.operationId),
        active: false,
        status: 'cancelled',
        source: 'attendance-cancellation-approved',
        teacherId: clean(requestRow.teacherId),
        studentId,
        periodId: clean((correctionSlots.find(slot => slot.studentId === studentId) || {}).periodId),
        studentIds: requestRow.studentIds || [],
        subjectId: clean(requestRow.subjectId),
        eventId: clean(requestRow.eventId),
        courseId: clean(requestRow.courseId),
        date: clean(requestRow.date),
        cancellationRequestId: id,
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledAtText: nowText(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });
    tx.set(statusRef, {
      id: statusRef.id,
      action: 'lesson_status',
      active: true,
      sourceEventId: clean(requestRow.eventId),
      sourceCourseId: lineage,
      sourceDate: clean(requestRow.date),
      event: {
        id: randomToken(12),
        date: clean(requestRow.date),
        startTime: clean(requestRow.startTime),
        endTime: clean(requestRow.endTime),
        roomId: clean(requestRow.roomId),
        teacherId: clean(requestRow.teacherId),
        studentId: clean((requestRow.studentIds || [])[0]),
        studentIds: requestRow.studentIds || [],
        subjectId: clean(requestRow.subjectId),
        fixedCourseId: lineage,
        type: clean(requestRow.type || 'lesson'),
        status: 'scheduled',
        paymentStatus: 'attendance_cancelled',
        teacherPayable: false,
        note: `主管核准取消簽到：${clean(requestRow.reason)}`
      },
      createdByTeacherId: clean(requestRow.teacherId),
      approvedByManager: true,
      attendanceCancellationId: id,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtText: nowText()
    }, { merge: true });
    tx.set(payrollRef, {
      active: false,
      status: 'cancelled',
      cancellationRequestId: id,
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(lessonLockRef, {
      // 主管核准後留下跨老師共用的取消 tombstone，直到未來明確的管理者恢復動作解除。
      active: true,
      status: 'cancelled',
      operationId: clean(requestRow.operationId),
      cancellationRequestId: id,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(adjustmentRef, {
      id: adjustmentRef.id,
      teacherId: clean(requestRow.teacherId),
      month: currentTaipeiDay().slice(0, 7),
      date: currentTaipeiDay(),
      type: 'attendance_cancellation_fee',
      amount: -ATTENDANCE_ADMIN_FEE,
      note: `取消簽到行政處理費 NT$${ATTENDANCE_ADMIN_FEE}`,
      source: 'attendance-cancellation-approved',
      requestId: id,
      createdAt: FieldValue.serverTimestamp(),
      createdAtText: nowText()
    }, { merge: true });
    tx.set(requestRef, {
      active: true,
      status: 'approved',
      lastAction: 'cancelled',
      lastActionAt: FieldValue.serverTimestamp(),
      lastActionAtText: nowText(),
      reviewNote,
      administrationFee: ATTENDANCE_ADMIN_FEE,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedAtText: nowText(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    const currentVersion = Number(versionSnapshot.exists && versionSnapshot.data().version || 0);
    tx.set(versionRef, {
      version: currentVersion + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'attendance-cancellation-approved'
    }, { merge: true });
  });
  await queueTeacherAttendanceDecision({ ...requestRow, correctionSlots }, true, reviewNote);
  for (const slot of correctionSlots) {
    const bindings = await db.collection('coursePortalStudentBindings').where('studentId', '==', slot.studentId).where('status', '==', 'active').get();
    const seen = new Set();
    for (const doc of bindings.docs) {
      const binding = doc.data(); const key = notificationRecipientKey(binding);
      if (!key || seen.has(key)) continue; seen.add(key);
      await queueCoursePortalNotice(`attendance-corrected-${slot.id}-${hash(key)}`, { ...recipientFields(binding), title: '課程紀錄更正通知',
        body: `您好，${slot.studentName || binding.name || '學生'}的${clean(requestRow.subjectName) || '課程'}第 ${slot.periodNo} 期第 ${slot.slotNo} 格，原登記「${slot.originalDate}」的上課紀錄經確認需要更正，該堂課的上課權益不受影響，請您放心。\n\n老師會協助更正實體上課證，並於實際補上課程後，將正確日期填回原格，讓上課證與系統紀錄一致。後續格位維持不變，也不會重複扣除堂數。\n\n這部分由老師處理即可，您無需自行修改。若有任何疑問，歡迎聯絡柚子樂器官方 LINE，我們會協助確認，謝謝您的理解。\n${PORTAL_BASE}/student-course-portal.html`
      });
    }
  }
  return {
    ok: true,
    id,
    status: 'approved',
    message: `取消簽到已核准，並已在老師薪資扣除行政處理費 NT$${ATTENDANCE_ADMIN_FEE}。`
  };
}

async function adminData() {
  const [teachers, students, renters, teacherRows, studentRows, renterRows, sessions, suspensionSnapshot, tuitionPaymentSnapshot, tuitionReceiptSnapshot, attendanceCancellationSnapshot] = await Promise.all([
    db.collection('coursePortalTeacherBindings').get(),
    db.collection('coursePortalStudentBindings').get(),
    db.collection('coursePortalRenterBindings').get(),
    mirrorRows('teachers'),
    mirrorRows('students'),
    db.collection('coursePortalRenters').get(),
    db.collection('coursePortalSessions').get(),
    db.collection('coursePortalStudentSuspensions').where('status', '==', 'active').get(),
    db.collection(TUITION_PAYMENT_REQUESTS).where('status', 'in', ['pending_review', 'onsite_pending']).get(),
    db.collection(TUITION_RECEIPTS).get(),
    db.collection(ATTENDANCE_CANCELLATIONS).orderBy('requestedAt', 'desc').limit(200).get()
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
      lineUserIdMasked: clean(row.lineUserId)
        ? `${clean(row.lineUserId).slice(0, 6)}…${clean(row.lineUserId).slice(-4)}`
        : '',
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
      approvalRequestedAt: jsonValue(row.approvalRequestedAt),
      approvedAt: jsonValue(row.approvedAt),
      lastLoginAt: jsonValue(row.lastLoginAt),
      lastLoginAtText: clean(row.lastLoginAtText),
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
  const tuitionPayments = tuitionPaymentSnapshot.docs
    .filter((doc) => ['pending_review', 'onsite_pending'].includes(clean((doc.data() || {}).status)))
    .sort((left, right) => asMillis((right.data() || {}).submittedAt) - asMillis((left.data() || {}).submittedAt))
    .map(adminTuitionPaymentRow);
  const tuitionReceipts = tuitionReceiptSnapshot.docs
    .filter((doc) => (doc.data() || {}).active !== false)
    .sort((left, right) => {
      const leftRow = left.data() || {};
      const rightRow = right.data() || {};
      return dateKey(rightRow.paymentDate).localeCompare(dateKey(leftRow.paymentDate)) ||
        asMillis(rightRow.createdAt) - asMillis(leftRow.createdAt);
    })
    .map(adminTuitionReceiptRow);
  const attendanceCancellationRows = attendanceCancellationSnapshot.docs
    .map((doc) => Object.assign({ id: doc.id }, jsonValue(doc.data()) || {}))
    .sort((left, right) =>
      asMillis(right.updatedAt || right.requestedAt) - asMillis(left.updatedAt || left.requestedAt)
    )
    .map((row) => Object.assign({}, row, {
      teacherName: clean(row.teacherName) ||
        clean(teacherMap[clean(row.teacherId)] && teacherMap[clean(row.teacherId)].name),
      studentNames: Array.isArray(row.studentNames) && row.studentNames.length
        ? row.studentNames
        : (row.studentIds || []).map((studentId) =>
          clean(studentMap[clean(studentId)] && studentMap[clean(studentId)].name)
        ).filter(Boolean)
    }));
  const attendanceCancellations = attendanceCancellationRows
    .filter((row) => clean(row.status) === 'pending');
  const attendanceCancellationHistory = attendanceCancellationRows
    .filter((row) => clean(row.status) !== 'pending')
    .slice(0, 100);
  return {
    ok: true,
    bindings: [...map(teachers), ...map(students), ...map(renters)],
    unpaidSuspensions,
    tuitionPayments,
    tuitionReceipts,
    attendanceCancellations,
    attendanceCancellationHistory
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
  if (!['approve', 'reject', 'revoke', 'restore', 'force_logout', 'delete'].includes(action)) {
    throw new HttpsError('invalid-argument', '不支援的帳號操作。');
  }
  const bindingRef = db.collection(bindingCollection(type)).doc(id);
  const bindingSnapshot = await bindingRef.get();
  if (!bindingSnapshot.exists) throw new HttpsError('not-found', '找不到這筆登入資料。');
  const row = Object.assign({ id, type }, bindingSnapshot.data() || {});
  const lineUserId = clean(row.lineUserId);
  const authAccountId = clean(row.authAccountId);
  const sessionSnapshots = await Promise.all([
    lineUserId
      ? db.collection('coursePortalSessions').where('lineUserId', '==', lineUserId).get()
      : Promise.resolve({ docs: [] }),
    authAccountId
      ? db.collection('coursePortalSessions').where('authAccountId', '==', authAccountId).get()
      : Promise.resolve({ docs: [] })
  ]);
  const sessionOperations = sessionSnapshots.flatMap((snapshot) => snapshot.docs).map((doc) => ({
    action: 'set',
    ref: doc.ref,
    data: {
      status: 'revoked',
      revokedAt: FieldValue.serverTimestamp(),
      revokedReason: `admin-${action}`
    }
  }));

  if (action === 'approve' || action === 'restore') {
    await bindingRef.set({
      status: 'active',
      approvalStatus: 'approved',
      approvedAt: FieldValue.serverTimestamp(),
      approvedAtText: nowText(),
      rejectedAt: null,
      revokedAt: null,
      lineBindStatus: 'bound',
      lineLinkStatus: 'linked',
      globalLineRevokedAt: null,
      globalLineRevokedBy: '',
      globalLineRevokedReason: '',
      unboundAt: null,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    if (action === 'approve') await queueBindingDecisionNotice(row, true);
    return { ok: true, status: 'active', message: action === 'approve' ? '綁定已核准。' : '帳號已恢復。' };
  }

  if (action === 'reject' || action === 'revoke') {
    const status = action === 'reject' ? 'rejected' : 'revoked';
    await bindingRef.set({
      status,
      approvalStatus: action === 'reject' ? 'rejected' : clean(row.approvalStatus),
      rejectedAt: action === 'reject' ? FieldValue.serverTimestamp() : null,
      rejectedAtText: action === 'reject' ? nowText() : '',
      revokedAt: action === 'revoke' ? FieldValue.serverTimestamp() : null,
      globalLineRevokedAt: null,
      globalLineRevokedBy: '',
      globalLineRevokedReason: '',
      unboundAt: null,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    // 學生／家長的同一個 LINE 可能仍綁定其他孩子；資料權限每次都會重新
    // 依有效綁定判斷，因此單筆停用不強制登出其他孩子。
    if (type !== 'student') await commitOperations(sessionOperations);
    if (action === 'reject') await queueBindingDecisionNotice(row, false);
    return { ok: true, status, message: action === 'reject' ? '綁定申請已拒絕。' : '帳號已停用。' };
  }

  if (action === 'force_logout') {
    await commitOperations(sessionOperations);
    return { ok: true, status: clean(row.status), message: '所有已登入裝置已登出。' };
  }

  if (action === 'delete') {
    const collections = [
      'coursePortalSessions',
      'coursePortalAccessTokens',
      'coursePortalEmailOtps',
      'coursePortalOtpRecovery',
      'coursePortalBindCodes',
      'coursePortalLineLoginCodes',
      'coursePortalLineOAuthStates',
      'coursePortalLineSetupTokens'
    ];
    const siblingSnapshots = await Promise.all(
      ['teacher', 'student', 'renter'].map((role) => db.collection(bindingCollection(role)).get())
    );
    const siblings = siblingSnapshots.flatMap((snapshot) => snapshot.docs).filter((doc) =>
      !(doc.ref.path === bindingRef.path) &&
      (
        (lineUserId && clean(doc.data().lineUserId) === lineUserId) ||
        (authAccountId && clean(doc.data().authAccountId) === authAccountId)
      )
    );
    const identityStillUsed = siblings.length > 0;
    const lineSnapshots = lineUserId && !identityStillUsed
      ? await Promise.all(collections.map((name) => db.collection(name).where('lineUserId', '==', lineUserId).get()))
      : [];
    const accountSnapshots = authAccountId && !identityStillUsed
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
    if (email && !identityStillUsed) {
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
      retainedBusinessHistory: true,
      retainedOtherBindings: identityStillUsed
    };
  }
  throw new HttpsError('invalid-argument', '不支援的帳號操作。');
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

function teacherReminderDate(value) {
  const date = dateKey(value);
  if (!date) return '';
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${day}日`;
}

function teacherReminderLessonType(row) {
  const action = clean(row.portalAction);
  if (action === 'teacher_gift') return '贈送課程';
  if (action === 'teacher_add') return '增加課程';
  if (['single_move', 'permanent_move', 'permanent_room_exception'].includes(action)) return '調課課程';
  return '固定課程';
}

function teacherReminderLessonLine(row, maps) {
  const studentNames = eventStudentIds(row)
    .map((studentId) => clean(maps.students[studentId] && maps.students[studentId].name))
    .filter(Boolean)
    .join('、') || '學生';
  const subjectName = clean(maps.subjects[eventSubjectId(row)] && maps.subjects[eventSubjectId(row)].name) ||
    clean(row.subjectName) || '課程';
  return `${teacherReminderDate(eventDate(row))} ${eventStart(row)}～${eventEnd(row)}　${studentNames}｜${subjectName}｜${teacherReminderLessonType(row)}`;
}

async function teacherDailyWorkIdentity(teacherId, binding = {}) {
  const direct = await db.collection('employees').doc(clean(teacherId)).get();
  let doc = direct.exists ? direct : null;
  if (!doc) {
    const matched = await db.collection('employees').where('coursePortalTeacherId', '==', clean(teacherId)).limit(2).get();
    doc = matched.empty ? null : matched.docs[0];
  }
  if (!doc) return {
    employeeId: clean(binding.employeeId || binding.personMasterId || binding.canonicalEmployeeId),
    teacherId: clean(teacherId),
    email: normalizeEmail(binding.email || binding.teacherEmail),
    external: true,
    name: clean(binding.targetName || binding.teacherName || binding.name || '外聘老師')
  };
  const row = doc.data() || {};
  return {
    employeeId: clean(row.employeeId || doc.id),
    teacherId: clean(teacherId),
    email: normalizeEmail(row.email || row.Email || row.loginEmail),
    external: true,
    name: clean(row.name || row.displayName || '外聘老師')
  };
}

async function dailyTeacherCourseReminders(pushLineMessage, teacherWorkPendingCounts) {
  const today = currentTaipeiDay();
  if (weekday(today) === 1) return;
  const yesterday = addDays(today, -1);
  const [bindings, bundle] = await Promise.all([
    db.collection('coursePortalTeacherBindings').where('status', '==', 'active').get(),
    scheduleBundle(yesterday, today, '')
  ]);
  const targets = [...new Map(bindings.docs.map((doc) => {
    const row = doc.data() || {};
    const key = `${clean(row.teacherId)}|${notificationRecipientKey(row)}`;
    return [key, Object.assign({ id: doc.id }, row)];
  }).filter(([key, row]) =>
    key !== '|' && clean(row.teacherId) && notificationRecipientKey(row)
  )).values()];
  for (const binding of targets) {
    const teacherId = clean(binding.teacherId);
    const rows = bundle.resourceEvents.filter((row) =>
      eventTeacherId(row) === teacherId &&
      !['cancelled', 'pending_conflict'].includes(normalizeScheduleStatus(row.status))
    );
    const todayRows = rows.filter((row) => eventDate(row) === today)
      .sort((left, right) => eventStart(left).localeCompare(eventStart(right)));
    const unfinished = rows.filter((row) =>
      eventDate(row) === yesterday &&
      normalizeScheduleStatus(row.status) === 'scheduled'
    ).sort((left, right) => eventStart(left).localeCompare(eventStart(right)));
    const parts = todayRows.length ? [
      '【今日課程】',
      todayRows.map((row) => teacherReminderLessonLine(row, bundle.maps)).join('\n')
    ] : [];
    if (unfinished.length) {
      parts.push(
        '',
        '【昨日未完成紀錄】',
        unfinished.map((row) => teacherReminderLessonLine(row, bundle.maps)).join('\n'),
        unfinished.length === 1
          ? '此課程昨日未完成簽到，因此尚未記錄堂數。若當天沒有上課，請下次記得主動登記請假；若有上課，請聯絡管理者協助核對及補登。'
          : '以上課程昨日未完成簽到，因此尚未記錄堂數。若當天沒有上課，請下次記得主動登記請假；若有上課，請聯絡管理者協助核對及補登。'
      );
    }
    if (typeof teacherWorkPendingCounts === 'function') {
      try {
        const identity = await teacherDailyWorkIdentity(teacherId, binding);
        const pending = await teacherWorkPendingCounts(identity);
        if (Number(pending && pending.announcementCount || 0) || Number(pending && pending.taskCount || 0)) {
          parts.push('', '【系統待辦】');
          if (Number(pending.announcementCount || 0)) parts.push(`有 ${Number(pending.announcementCount)} 則新公告或待回覆公告`);
          if (Number(pending.taskCount || 0)) parts.push(`有 ${Number(pending.taskCount)} 項協助事項尚未完成`);
          parts.push(`查看：${PORTAL_BASE}/teacher-course-portal.html`);
        }
      } catch (error) {
        console.warn('[teacher daily work reminder unavailable]', teacherId, clean(error && error.message));
      }
    }
    if (!parts.length) continue;
    const body = parts.join('\n').trim();
    await queueCoursePortalNotice(`teacher-daily-${hash(`${today}|${teacherId}|${notificationRecipientKey(binding)}`)}`, {
      ...recipientFields(binding), teacherId, eventCode: 'teacher_daily_courses', body
    });
  }
}

async function dailyStudentReminders() {
  const today = currentTaipeiDay();
  const [bindings, bundle] = await Promise.all([
    db.collection('coursePortalStudentBindings').where('status', '==', 'active').get(),
    scheduleBundle(today, today, '')
  ]);
  const lessons = (bundle.resourceEvents || []).filter(row => eventDate(row) === today &&
    !['cancelled', 'leave', 'absent'].includes(normalizeScheduleStatus(row.status)) && row.active !== false);
  const studentIds = [...new Set(lessons.flatMap(eventStudentIds))];
  if (!studentIds.length) return;
  const periods = await assignNewSystemPeriodNumbers(await mirrorRows('tuitionPeriods'));
  await ensureTuitionPaymentRequests({ periods, studentIds,
    students: Object.values(bundle.maps.students), subjects: Object.values(bundle.maps.subjects), teachers: Object.values(bundle.maps.teachers) });
  const paymentSnapshot = await db.collection(TUITION_PAYMENT_REQUESTS).where('status', '==', 'payment_due').get();
  const due = paymentSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(row => row.active !== false);
  for (const doc of bindings.docs) {
    const binding = doc.data() || {};
    if (binding.reminderPayment === false || !notificationRecipientKey(binding)) continue;
    const studentId = clean(binding.studentId);
    const requests = due.filter(row => clean(row.studentId) === studentId && lessons.some(lesson =>
      eventStudentIds(lesson).includes(studentId) && (!row.subjectId || eventSubjectId(lesson) === row.subjectId)));
    const amount = requests.reduce((sum, row) => sum + Math.max(0, Number(row.remainingAmount == null
      ? Number(row.expectedAmount || 0) - Number(row.confirmedAmount || 0) : row.remainingAmount)), 0);
    if (!amount) continue;
    const name = clean(requests[0].studentName) || '學生';
    await queueCoursePortalNotice(`tuition-day-${hash(`${today}|${studentId}|${notificationRecipientKey(binding)}`)}`, {
      ...recipientFields(binding), studentId, eventCode: 'tuition_due_on_lesson_day', title: '學費溫馨提醒',
      body: `${name}本期尚有學費 NT$${amount.toLocaleString('zh-TW')} 未繳。\n您可以利用網路轉帳或於現場繳費，詳細資訊請至學生／家長入口查看，謝謝您。\n${PORTAL_BASE}/student-course-portal.html?studentId=${encodeURIComponent(studentId)}`
    });
  }
}

async function appendCoursePortalData(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const irregularSnapshot = await db.collection('coursePortalIrregularCourses').where('enabled','==',true).get();
  const trackedStops = await db.collection('coursePortalStudentSuspensions').where('receivableTrackingVersion','==','teacher-stop-v1').get();
  payload.stoppedCourseReceivables = trackedStops.docs.map(doc => ({...jsonValue(doc.data()),id:doc.id}));
  payload.irregularCourses = irregularSnapshot.docs.map(doc => ({...jsonValue(doc.data()),id:doc.id}));
  const groups = await readCourseGroups();
  const lessonSettings = await db.collection('coursePortalLessonSettings').get();
  payload.lessonSettings = lessonSettings.docs.map(doc => jsonValue(doc.data()));
  const managerConfiguration = await db.collection('coursePortalSettings').doc('managerConfiguration').get();
  if (managerConfiguration.exists && Array.isArray(managerConfiguration.data().leaveReasons)) payload.leaveReasons = managerConfiguration.data().leaveReasons;
  const managerFixed = await db.collection('coursePortalFixedCourses').get();
  payload.fixedCourses = (payload.fixedCourses || []).concat(managerFixed.docs.map(doc => Object.assign({ id: doc.id }, jsonValue(doc.data()) || {})));
  for (const type of ['students', 'tuitionPeriods', 'attendance', 'teacherPayroll', 'events', 'fixedCourses', 'temporaryCourses']) {
    if (Array.isArray(payload[type])) payload[type] = projectCourseGroups(type, payload[type], groups);
  }
  const [
    changes,
    bookings,
    roomSettings,
    studentProfiles,
    suspensions,
    portalPeriods,
    portalTransactions,
    portalReceipts,
    portalAttendanceSnapshot,
    portalPayrollSnapshot,
    portalAdjustmentsSnapshot,
    approvedCancellationSnapshot,
    subjectCatalogSnapshot,
    teacherSubjectAssignmentsSnapshot,
    portalFeePlansSnapshot
  ] = await Promise.all([
    db.collection('coursePortalScheduleChanges').where('active', '==', true).get(),
    db.collection('coursePortalRoomBookings').where('active', '==', true).get(),
    db.collection('coursePortalRoomSettings').get(),
    db.collection('coursePortalStudentProfiles').get(),
    db.collection('coursePortalStudentSuspensions').where('status', '==', 'active').get(),
    db.collection(TUITION_PERIODS).get(),
    db.collection(TUITION_TRANSACTIONS).get(),
    db.collection(TUITION_RECEIPTS).get(),
    db.collection(ATTENDANCE_RECORDS).get(),
    db.collection(ATTENDANCE_PAYROLL).get(),
    db.collection('coursePortalTeacherAdjustments').get(),
    db.collection(ATTENDANCE_CANCELLATIONS).where('status', '==', 'approved').get(),
    db.collection(SUBJECT_CATALOG_COLLECTION).get(),
    db.collection(TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION).get(),
    db.collection(FEE_PLAN_COLLECTION).get()
  ]);
  const roomSettingsMap = new Map(roomSettings.docs.map((doc) => [doc.id, jsonValue(doc.data()) || {}]));
  const studentProfileMap = new Map(studentProfiles.docs.map((doc) => [doc.id, jsonValue(doc.data()) || {}]));
  payload.subjects = mergeSubjectRows(
    Array.isArray(payload.subjects) ? payload.subjects : [],
    subjectCatalogSnapshot.docs,
    { includePending: true }
  );
  payload.feePlans = mergeFeePlanRows(
    Array.isArray(payload.feePlans) ? payload.feePlans : [],
    portalFeePlansSnapshot.docs,
    { includeInactive: true }
  );
  const configuredSubjectIds = new Set(
    payload.feePlans.filter(feePlanConfigured).map((row) => clean(row.subjectId)).filter(Boolean)
  );
  payload.subjects = payload.subjects.map((row) => {
    const configured = configuredSubjectIds.has(sourceId(row));
    return Object.assign({}, row, {
      pricingStatus: configured ? 'configured' : 'unconfigured'
    });
  });
  payload.teachers = mergeTeacherRows(
    Array.isArray(payload.teachers) ? payload.teachers : [],
    teacherSubjectAssignmentsSnapshot.docs
  );
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
  if (Array.isArray(payload.students)) payload.students = await mergeStudentProfileOverrides(payload.students);
  const mirrorAttendance = Array.isArray(payload.attendance) ? payload.attendance : [];
  const portalAttendanceRows = portalAttendanceSnapshot.docs.map((doc) =>
    Object.assign({ __id: doc.id }, jsonValue(doc.data()) || {})
  );
  payload.attendance = mergePortalAttendanceRows(mirrorAttendance, portalAttendanceRows);
  if (Array.isArray(payload.tuitionPeriods)) {
    payload.tuitionPeriods = applyPortalAttendanceToPeriods(mergePortalTuitionRows(
      payload.tuitionPeriods,
      portalPeriods.docs,
      portalTransactions.docs,
      portalReceipts.docs
    ), mirrorAttendance, portalAttendanceRows);
  }
  const portalPayrollRows = portalPayrollSnapshot.docs.map((doc) =>
    Object.assign({ __id: doc.id }, jsonValue(doc.data()) || {})
  );
  const approvedCancellations = approvedCancellationSnapshot.docs.map((doc) =>
    Object.assign({ id: doc.id }, jsonValue(doc.data()) || {})
  );
  payload.teacherPayroll = mergeTeacherPayrollRows(
    enrichTeacherPayrollRows(Array.isArray(payload.teacherPayroll) ? payload.teacherPayroll : [], mirrorAttendance),
    portalPayrollRows,
    approvedCancellations.concat(portalPayrollRows.filter((row) => row.active === false))
  );
  payload.teacherAdjustments = mergeTeacherAdjustmentRows(
    Array.isArray(payload.teacherAdjustments) ? payload.teacherAdjustments : [],
    portalAdjustmentsSnapshot.docs.map((doc) =>
      Object.assign({ __id: doc.id }, jsonValue(doc.data()) || {})
    )
  );
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
    if (row.replaceMatchingCourse === true) return;
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
      sourceId: sourceId(row.event),
      portalChangeId: row.id,
      start: eventStart(row.event),
      duration: Math.max(30, timeMinutes(eventEnd(row.event)) - timeMinutes(eventStart(row.event))),
      type: ['rental','trial'].includes(clean(row.event.type)) ? clean(row.event.type) : 'single',
      specialLesson: row.event.specialLesson === true || clean(row.action) === 'teacher_gift',
      portalAction: row.action,
      source: 'course-portal'
    }));
  });
  const replacements = effectivePermanentChanges(changeRows).filter(row => row.replaceMatchingCourse === true);
  replacements.forEach(row => {
    const statusByDate = {};
    (row.pendingDates || []).forEach(day => { statusByDate[day] = { status: 'pending_conflict' }; });
    Object.keys(row.roomOverrides || {}).forEach(day => {
      statusByDate[day] = { status: 'cancelled' };
      payload.temporaryCourses.push(Object.assign({}, row.event, { id: `${row.id}-room-${day}`, portalChangeId: row.id,
        date: day, roomId: row.roomOverrides[day], start: eventStart(row.event), type: 'single',
        duration: timeMinutes(eventEnd(row.event)) - timeMinutes(eventStart(row.event)), source: 'course-portal' }));
    });
    payload.fixedCourses.push(Object.assign({}, row.event, { id: row.id, portalChangeId: row.id,
      date: permanentAnchor(row), startDate: permanentAnchor(row), start: eventStart(row.event),
      duration: timeMinutes(eventEnd(row.event)) - timeMinutes(eventStart(row.event)),
      frequencyWeeks: safeFrequencyWeeks(row.frequencyWeeks), type: 'fixed', recurring: true,
      recurrenceEndDate: row.recurrenceEndDate || '', endDate: row.recurrenceEndDate || '', statusByDate,
      source: 'course-portal', portalAction: 'permanent_move' }));
  });
  payload.events = (payload.events || []).filter(row => !replacedTeachingOccurrence(row, replacements, changeRows));
  payload.temporaryCourses = payload.temporaryCourses.filter(row => !replacedTeachingOccurrence(row, replacements, changeRows));
  payload.fixedCourses = payload.fixedCourses.map(course => {
    const cutoff = replacements.filter(row => sameTeachingCourse(course, row.event) &&
      replacedTeachingOccurrence(Object.assign({}, course, { date: permanentCutover(row) }), [row], changeRows))
      .map(permanentCutover).sort()[0];
    if (!cutoff) return course;
    const stop = addDays(cutoff, -1), existing = dateKey(course.recurrenceEndDate || course.endDate);
    const end = existing && existing < stop ? existing : stop;
    if (dateKey(course.startDate || course.date) > end) return null;
    return Object.assign({}, course, { recurrenceEndDate: end, endDate: end });
  }).filter(Boolean);
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
    attendance: portalAttendanceSnapshot.size,
    teacherPayroll: portalPayrollSnapshot.size,
    teacherAdjustments: portalAdjustmentsSnapshot.size,
    subjectCatalog: subjectCatalogSnapshot.size,
    teacherSubjectAssignments: teacherSubjectAssignmentsSnapshot.size,
    portalFeePlans: portalFeePlansSnapshot.size,
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
  exportsObject.coursePortalDirectRegularAccess = callable(directRegularAccess);
  exportsObject.coursePortalSendEmailOtp = callable((data) => sendEmailOtp(data, {
    sendEmail: helpers.sendEmail
  }));
  exportsObject.coursePortalVerifyEmailOtp = callable(verifyEmailOtp);
  exportsObject.coursePortalResumeEmailOtp = callable(resumeEmailOtp);
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
  exportsObject.coursePortalTeacherData = callable(withPortalReads(teacherPortalData), { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherDataTaiwan = callable(withPortalReads(teacherPortalData), { region: 'asia-east1', timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherUtilitySession = callable(teacherUtilitySession, { timeoutSeconds: 120, memory: '512MiB' });
  exportsObject.coursePortalTeacherSaveProfileDraft = callable(teacherUtilitySaveProfileDraft, { timeoutSeconds: 120, memory: '512MiB' });
  exportsObject.coursePortalTeacherContractSession = callable(teacherContractSession, { timeoutSeconds: 120, memory: '512MiB' });
  exportsObject.coursePortalTeacherSubmitContract = callable(teacherSubmitContract, { timeoutSeconds: 120, memory: '512MiB' });
  exportsObject.coursePortalTeacherAvailability = callable(teacherAvailability, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherAvailabilityTaiwan = callable(teacherAvailability, { region: 'asia-east1', timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherSlotOptions = callable(teacherSlotOptions, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherSlotOptionsTaiwan = callable(teacherSlotOptions, { region: 'asia-east1', timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalStudentData = callable(withPortalReads(studentPortalData), { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalStudentDataTaiwan = callable(withPortalReads(studentPortalData), { region: 'asia-east1', timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalLessonHistory = callable(withPortalReads(courseLessonHistory), { timeoutSeconds: 180, memory: '1GiB', concurrency: 1 });
  exportsObject.coursePortalLessonHistoryTaiwan = callable(withPortalReads(courseLessonHistory), { region: 'asia-east1', timeoutSeconds: 180, memory: '1GiB', concurrency: 1 });
  exportsObject.coursePortalStudentContactBookImage = callable(studentContactBookImage, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalStudentSubmitTuitionPayment = callable(studentSubmitTuitionPayment, {
    timeoutSeconds: 180,
    memory: '1GiB'
  });
  exportsObject.coursePortalRentalDayBoard = callable(rentalDayBoard, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalRentalWeekBoard = callable(rentalWeekBoard, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalRentalWeekBoardTaiwan = callable(rentalWeekBoard, { region: 'asia-east1', timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalRentalAvailability = callable(rentalAvailability, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalRentalAvailabilityTaiwan = callable(rentalAvailability, { region: 'asia-east1', timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalCreateRoomBooking = callable(createRoomBooking, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalRentalMyBookings = callable(rentalMyBookings);
  exportsObject.coursePortalCancelRoomBooking = callable(cancelRoomBooking);
  exportsObject.coursePortalTeacherSetIrregular = callable(teacherSetIrregular, {timeoutSeconds:180,memory:'1GiB'});
  exportsObject.coursePortalTeacherAction = callable(teacherAction, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherLessonState = callable(teacherLessonState, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherAttendanceCorrectionOptions = callable(teacherAttendanceCorrectionOptions);
  exportsObject.coursePortalTeacherAttendance = callable(teacherAttendance, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherLateAttendance = callable(teacherLateAttendance, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherAttendanceCancellationRequest = callable(teacherAttendanceCancellationRequest, { timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalTeacherSubmitContactBookPost = callable(teacherSubmitContactBookPost, { timeoutSeconds: 180, memory: '1GiB' });
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
  exportsObject.coursePortalAdminRecordTuitionTransaction = callable(async (data,request)=>{assertAdminPin(request);return adminRecordTuitionTransaction(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminVoidLessonSlot = callable(async (data, request) => { assertAdminPin(request); return adminVoidLessonSlot(data); }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalAdminSaveLessonSettings = callable(async (data, request) => { assertAdminPin(request); return adminSaveLessonSettings(data); }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalAdminSaveLeaveReason = callable(async (data, request) => { assertAdminPin(request); return adminSaveLeaveReason(data); }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalAdminSaveSchedule = callable(async (data, request) => { assertAdminPin(request); return adminSaveSchedule(data); }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalAdminSetAttendance = callable(async (data, request) => { assertAdminPin(request); return adminSetAttendance(data); }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalAdminSaveStudent = callable(async (data,request)=>{assertAdminPin(request);return adminSaveStudent(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminSaveTuitionPeriods = callable(async (data,request)=>{assertAdminPin(request);return adminSaveTuitionPeriods(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminSaveTeacherSubjects = callable(async (data,request)=>{assertAdminPin(request);return adminSaveTeacherSubjects(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminSaveSubjectCatalog = callable(async (data,request)=>{assertAdminPin(request);return adminSaveSubjectCatalog(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminSaveFeePlan = callable(async (data,request)=>{assertAdminPin(request);return adminSaveFeePlan(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminMapSubjectSuggestion = callable(async (data,request)=>{assertAdminPin(request);return adminMapSubjectSuggestion(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminSaveTeacherAdjustment = callable(async (data,request)=>{assertAdminPin(request);return adminSaveTeacherAdjustment(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminRoomBookings = callable(async (data,request)=>{assertAdminPin(request);return adminRoomBookings();},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminCancelRoomBooking = callable(async (data,request)=>{assertAdminPin(request);return adminCancelRoomBooking(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminBonusRequests = callable(async (data,request)=>{assertAdminPin(request);return adminBonusRequests();},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalAdminApproveBonus = callable(async (data,request)=>{assertAdminPin(request);return adminApproveBonus(data);},{secrets:[ADMIN_PIN]});
  exportsObject.coursePortalStudentBindingAccounts = callable(studentBindingAccounts);
  exportsObject.coursePortalUpdateStudentReminder = callable(updateStudentReminder);
  exportsObject.coursePortalAdminData = callable(async (data, request) => {
    assertAdminPin(request);
    return adminData();
  }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalAdminBindingAction = callable(async (data, request) => {
    assertAdminPin(request);
    return adminBindingAction(data);
  }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalAdminAttendanceCancellationAction = callable(async (data, request) => {
    assertAdminPin(request);
    return adminAttendanceCancellationAction(data);
  }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalAdminSuspensionAction = callable(async (data, request) => {
    assertAdminPin(request);
    return adminSuspensionAction(data);
  }, { secrets: [ADMIN_PIN] });
  exportsObject.coursePortalAdminTuitionPaymentAction = callable(async (data, request) => {
    assertAdminPin(request);
    return adminTuitionPaymentAction(data);
  }, { secrets: [ADMIN_PIN], timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalAdminEnsureTuitionReceipt = callable(async (data, request) => {
    assertAdminPin(request);
    return adminEnsureTuitionReceipt(data);
  }, { secrets: [ADMIN_PIN], timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalAdminTuitionPaymentScreenshot = callable(async (data, request) => {
    assertAdminPin(request);
    return adminTuitionPaymentScreenshot(data);
  }, { secrets: [ADMIN_PIN], timeoutSeconds: 180, memory: '1GiB' });
  exportsObject.coursePortalStudentReminderDaily = onSchedule({
    schedule: '0 9 * * *',
    timeZone: TAIPEI,
    region: REGION,
    timeoutSeconds: 180,
    memory: '512MiB'
  }, async () => dailyStudentReminders(helpers.pushLineMessage));
  exportsObject.coursePortalTeacherDailyReminder = onSchedule({
    schedule: '0 9 * * 0,2-6',
    timeZone: TAIPEI,
    region: REGION,
    timeoutSeconds: 180,
    memory: '512MiB'
  }, async () => dailyTeacherCourseReminders(helpers.pushLineMessage, helpers.teacherWorkPendingCounts));
}

module.exports = {
  appendCoursePortalData,
  handleCoursePortalLineEvent,
  normalizePhone,
  phoneMatches,
  registerCoursePortal,
  requireSession,
  resolveTeacherUtilityEmployee,
  teacherPayrollMonthData
};
function parseContactBookImages(values) {
  const images = Array.isArray(values) ? values : [];
  if (images.length > CONTACT_BOOK_IMAGE_MAX_COUNT) {
    throw new HttpsError('invalid-argument', `一次最多可附 ${CONTACT_BOOK_IMAGE_MAX_COUNT} 張照片。`);
  }
  return images.map((value, index) => {
    const parsed = parseTuitionReceipt(value && value.dataUrl);
    if (parsed.buffer.length > CONTACT_BOOK_IMAGE_MAX_BYTES) {
      throw new HttpsError('invalid-argument', `第 ${index + 1} 張照片需小於 3 MB。`);
    }
    return { name: clean(value && value.name).slice(0, 100), contentType: parsed.contentType, buffer: parsed.buffer };
  });
}

async function queueStudentContactBookNotices(studentIds, postId) {
  for (const studentId of [...new Set(studentIds)]) {
    const snapshot = await db.collection('coursePortalStudentBindings').where('studentId', '==', studentId).get();
    const targets = new Map();
    snapshot.docs.forEach(doc => {
      const row = doc.data() || {};
      if (row.status === 'active' && notificationRecipientKey(row) && row.reminderContactBook !== false) targets.set(notificationRecipientKey(row), row);
    });
    for (const [key, binding] of targets) await queueCoursePortalNotice(`course-contact-book-${postId}-${studentId}-${hash(key)}`, {
      ...recipientFields(binding), eventCode: 'contact_book_posted', studentId,
      title: '課堂聯絡簿更新', body: `老師已更新${clean(binding.name) || '學生'}的課堂聯絡簿，請至學生／家長入口查看。\n${PORTAL_BASE}/student-course-portal.html`
    });
  }
}

async function teacherSubmitContactBookPost(data) {
  const session = await requireSession(data, ['teacher']);
  const text = clean(data.text);
  const resolved = await teacherAttendanceEvent(session, data);
  const event = resolved.event;
  const availableIds = (event.studentIds || []).map(clean).filter(Boolean);
  const requested = clean(data.studentId);
  const studentIds = requested ? [requested] : availableIds;
  if (!studentIds.length || studentIds.some((id) => !availableIds.includes(id))) {
    throw new HttpsError('permission-denied', '這位學生不在本堂課中。');
  }
  const images = parseContactBookImages(data.images);
  if (!text && !images.length) throw new HttpsError('invalid-argument', '請輸入聯絡簿內容或附上照片。');
  const postId = randomToken(12);
  const imageRows = await Promise.all(images.map(async (image, index) => {
    const path = `course-portal/contact-book/${postId}/${index}-${randomToken(5)}`;
    await admin.storage().bucket().file(path).save(image.buffer, {
      resumable: false,
      metadata: { contentType: image.contentType, cacheControl: 'private, no-store, max-age=0' }
    });
    return { name: image.name || `照片 ${index + 1}`, storagePath: path, contentType: image.contentType, bytes: image.buffer.length };
  }));
  const rows = await Promise.all(studentIds.map(async (studentId) => {
    const ref = db.collection(CONTACT_BOOK_POSTS).doc(`${postId}-${studentId}`);
    await ref.set({
      id: ref.id, postId, active: true, studentId, teacherId: session.teacherId,
      teacherName: clean(event.teacherName), subjectName: clean(event.subjectName), subjectId: clean(event.subjectId),
      date: resolved.sourceDate, startTime: clean(event.startTime), eventId: clean(event.sourceId || resolved.sourceEventId || event.id),
      courseId: clean(event.fixedCourseId || resolved.sourceCourseId), text, images: imageRows,
      createdAt: FieldValue.serverTimestamp(), createdAtText: nowText(), updatedAt: FieldValue.serverTimestamp()
    });
    return ref.id;
  }));
  await queueStudentContactBookNotices(studentIds, postId);
  return { ok: true, ids: rows, message: '課堂聯絡簿已儲存，將依家長的提醒設定發送通知。' };
}

async function studentContactBookImage(data) {
  const session = await requireSession(data, ['student']);
  const id = clean(data.postId);
  const imageIndex = Number(data.imageIndex);
  const allowed = new Set(await activeStudentIdsForSession(session));
  const snapshot = await db.collection(CONTACT_BOOK_POSTS).doc(id).get();
  if (!snapshot.exists || !allowed.has(clean(snapshot.data().studentId))) throw new HttpsError('permission-denied', '沒有這張照片的查看權限。');
  const image = (snapshot.data().images || [])[imageIndex];
  if (!image || !clean(image.storagePath)) throw new HttpsError('not-found', '找不到這張照片。');
  const [buffer] = await admin.storage().bucket().file(clean(image.storagePath)).download();
  if (!buffer.length || buffer.length > CONTACT_BOOK_IMAGE_MAX_BYTES) throw new HttpsError('failed-precondition', '照片資料異常。');
  return { ok: true, contentType: clean(image.contentType) || 'image/jpeg', dataUrl: `data:${clean(image.contentType) || 'image/jpeg'};base64,${buffer.toString('base64')}` };
}
