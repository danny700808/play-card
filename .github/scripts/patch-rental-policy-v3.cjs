'use strict';
const fs = require('fs');

const backendPath = 'functions/coursePortal.js';
let source = fs.readFileSync(backendPath, 'utf8');

function replaceRequired(pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error('Unable to patch ' + label);
  source = next;
}

const helperBlock = String.raw`const RENTAL_USE_OPTIONS = Object.freeze([
  { id: 'piano', name: '彈鋼琴', icon: '🎹', roomIds: [] },
  { id: 'drums', name: '練鼓', icon: '🥁', roomIds: [] },
  { id: 'band', name: '團練', icon: '🎸', roomIds: [] },
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
  if (typeof setting.rentable === 'boolean') return setting.rentable;
  return roomKind(room, setting) === 'normal';
}

function roomTeacherSchedulable(room, setting = {}) {
  if (typeof setting.teacherSchedulable === 'boolean') return setting.teacherSchedulable;
  return true;
}

function effectiveRoomFee(room, setting = {}) {
  if (setting.rentalFee !== undefined && setting.rentalFee !== null && setting.rentalFee !== '') {
    return Math.max(0, Number(setting.rentalFee) || 0);
  }
  return defaultRoomFee(room);
}

function defaultRentalUseOptions(rooms) {
  const normal = (rooms || []).filter((room) => roomKind(room) === 'normal');
  const ids = (pattern) => normal.filter((room) => pattern.test(clean(room.name))).map(sourceId);
  return [
    { id: 'piano', name: '彈鋼琴', icon: '🎹', roomIds: ids(/鋼琴|平台|琴房|piano|yamaha|kawai/i), active: true },
    { id: 'drums', name: '練鼓', icon: '🥁', roomIds: ids(/鼓|展演|團練/), active: true },
    { id: 'band', name: '團練', icon: '🎸', roomIds: ids(/展演|團練/), active: true },
    { id: 'other', name: '其他用途', icon: '🎵', roomIds: normal.map(sourceId), active: true }
  ];
}

async function rentalUseOptions(rooms = []) {
  const snap = await db.collection('coursePortalSettings').doc('rentalUses').get();
  const defaults = defaultRentalUseOptions(rooms);
  const rows = snap.exists && Array.isArray(snap.data().items) ? snap.data().items : defaults;
  return rows.map((row, index) => ({
    id: clean(row.id) || ('use-' + (index + 1)),
    name: clean(row.name) || ('用途 ' + (index + 1)),
    icon: clean(row.icon) || (defaults[index] && defaults[index].icon) || '🎵',
    roomIds: Array.isArray(row.roomIds) ? row.roomIds.map(clean).filter(Boolean) : [],
    active: row.active !== false
  })).filter((row) => row.active);
}

function rentalUseAllowsRoom(options, useType, roomId) {
  const selected = (options || []).find((row) => row.id === clean(useType));
  return Boolean(selected && selected.roomIds.includes(clean(roomId)));
}

async function rentalPolicySettings() {
  const snap = await db.collection('coursePortalSettings').doc('rentalPolicy').get();
  const raw = snap.exists ? snap.data() || {} : {};
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
}`;

replaceRequired(
  /const RENTAL_USE_OPTIONS = Object\.freeze\(\[[\s\S]*?function rentalUseAllowsRoom\(options,useType,roomId\)\{[\s\S]*?\n\}/,
  helperBlock,
  'rental helpers'
);

const rentalAvailability = String.raw`async function rentalAvailability(data) {
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
    const baseFee = effectiveRoomFee(room, setting);
    const available = !blocked && rentable && categoryAllowed;
    return {
      id,
      name: profile.publicName,
      kind: roomKind(room, setting),
      available,
      reason: blocked ? '時段已被使用' : (!rentable ? '不開放租用' : (!categoryAllowed ? '不屬於這個用途' : '')),
      matchLevel: 'best',
      capacity: profile.capacity,
      equipment: profile.equipment,
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
}`;

replaceRequired(
  /async function rentalAvailability\(data\) \{[\s\S]*?\n\}\n\nasync function rentalDayBoard/,
  rentalAvailability + '\n\nasync function rentalDayBoard',
  'rental availability'
);

const rentalDayBoard = String.raw`async function rentalDayBoard(data) {
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
        if (!roomRentable(room, setting) || !rentalUseAllowsRoom(useOptions, data.useType, id)) return false;
        return !bundle.events.some((event) =>
          eventBlocksResource(event) && event.roomId === id && event.date === date &&
          overlaps(startTime, endTime, event.startTime, event.endTime)
        );
      }).map((room) => ({ id: sourceId(room), name: rentalRoomProfile(room, settingsMap[sourceId(room)] || {}).publicName }));
      slots.push({ startTime, endTime, availableCount: availableRooms.length, rooms: availableRooms.slice(0, 8) });
    }
  }
  return { ok: true, date, closed: window.closed, role: session.role, useOptions, slots };
}`;

replaceRequired(
  /async function rentalDayBoard\(data\) \{[\s\S]*?\n\}\n\nasync function rentalWeekBoard/,
  rentalDayBoard + '\n\nasync function rentalWeekBoard',
  'rental day board'
);

const rentalWeekBoard = String.raw`async function rentalWeekBoard(data) {
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
          if (!roomRentable(room, setting) || !rentalUseAllowsRoom(useOptions, data.useType, id)) return false;
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
}`;

replaceRequired(
  /async function rentalWeekBoard\(data\) \{[\s\S]*?\n\}\n\nasync function createRoomBooking/,
  rentalWeekBoard + '\n\nasync function createRoomBooking',
  'rental week board'
);

const createRoomBooking = String.raw`async function createRoomBooking(data) {
  const session = await requireSession(data, ['student', 'renter', 'teacher']);
  const availability = await rentalAvailability(data);
  if (taipeiDateTimeMillis(availability.date, availability.startTime) <= Date.now()) {
    throw new HttpsError('failed-precondition', '只能預約尚未開始的時段。');
  }
  const room = availability.rooms.find((item) => item.id === clean(data.roomId));
  if (!room || !room.available) throw new HttpsError('failed-precondition', room && room.reason || '這間教室目前不能預約。');
  const id = db.collection('coursePortalRoomBookings').doc().id;
  const studentIds = session.role === 'student' ? await activeStudentIdsForLine(session.lineUserId) : [];
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
    role: session.role,
    teacherId: clean(session.teacherId),
    renterId: clean(session.renterId),
    studentIds,
    studentDiscountRequested: data.studentDiscountRequested === true || clean(data.studentDiscountRequested).toLowerCase() === 'true',
    lineUserId: session.lineUserId,
    amount: room.price,
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
  return { ok: true, booking: jsonValue(booking) };
}`;

replaceRequired(
  /async function createRoomBooking\(data\) \{[\s\S]*?\n\}\n\nasync function rentalMyBookings/,
  createRoomBooking + '\n\nasync function rentalMyBookings',
  'create room booking'
);

replaceRequired(
  /tx\.set\(changeRef, \{\n      active: false,[\s\S]*?\n    \}, \{ merge: true \}\);/,
  `tx.set(changeRef, {
      active: false,
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: session.role
    }, { merge: true });
    (Array.isArray(booking.lockIds) ? booking.lockIds : []).forEach((lockId) => {
      tx.delete(db.collection('coursePortalRoomLocks').doc(clean(lockId)));
    });`,
  'cancel booking locks'
);

replaceRequired(
  "  if (weekday(date) === 2) throw new HttpsError('failed-precondition', '星期二為公休日。');\n  const bundle = await scheduleBundle(date, date, session.teacherId);",
  `  const policy = await rentalPolicySettings();
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
  }`,
  'teacher action business hours'
);

replaceRequired(
  /const compatibleRooms = future\.rooms\.filter\(sourceActive\)\.filter\(\(room\) =>\n      roomSupportsSubject\(room, event\.subjectId, future\)\n    \);/,
  `const compatibleRooms = future.rooms.filter(sourceActive).filter((room) =>
      roomKind(room, roomSettingsMap[sourceId(room)] || {}) === 'normal' &&
      roomTeacherSchedulable(room, roomSettingsMap[sourceId(room)] || {}) &&
      roomSupportsSubject(room, event.subjectId, future)
    );`,
  'permanent move alternatives'
);

replaceRequired(
  "  const bundle = await scheduleBundle(startDate, endDate, session.teacherId);\n  const compatibleRooms = bundle.rooms.filter(sourceActive).filter((room) =>\n    roomSupportsSubject(room, subjectId, bundle)\n  );",
  `  const [bundle, policy, roomSettingsSnapshot] = await Promise.all([
    scheduleBundle(startDate, endDate, session.teacherId),
    rentalPolicySettings(),
    db.collection('coursePortalRoomSettings').get()
  ]);
  const roomSettingsMap = {};
  roomSettingsSnapshot.docs.forEach((doc) => { roomSettingsMap[doc.id] = doc.data() || {}; });
  const compatibleRooms = bundle.rooms.filter(sourceActive).filter((room) =>
    roomKind(room, roomSettingsMap[sourceId(room)] || {}) === 'normal' &&
    roomTeacherSchedulable(room, roomSettingsMap[sourceId(room)] || {}) &&
    roomSupportsSubject(room, subjectId, bundle)
  );`,
  'teacher availability rooms'
);

replaceRequired(
  /    if \(weekday\(date\) === 2\) continue;\n    for \(let minute = 600; minute \+ duration <= 1260; minute \+= 30\) \{/,
  `    const window = businessWindow(policy, date);
    if (window.closed) continue;
    for (let minute = window.startMinutes; minute + duration <= window.endMinutes; minute += 30) {`,
  'teacher availability hours'
);

replaceRequired(
  "    hours: { start: 10, end: 21, closedWeekday: 2 },",
  "    hours: { start: 10, end: 21, closedWeekday: 1 },",
  'teacher portal closed weekday'
);

const adminFunctions = String.raw`async function publicRentalSettings() {
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
    roomIds: (Array.isArray(row.roomIds) ? row.roomIds : []).map(clean).filter((id) => allowed.has(id)),
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
    items,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtText: nowText()
  }, { merge: true });
  batch.set(db.collection('coursePortalSettings').doc('rentalPolicy'), {
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
      kind: ['normal', 'video', 'holding'].includes(clean(row.kind)) ? clean(row.kind) : 'normal',
      rentalFee: Math.max(0, Number(row.rentalFee || 0)),
      rentable: row.rentable === true,
      teacherSchedulable: row.teacherSchedulable !== false,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtText: nowText()
    }, { merge: true });
  });
  await batch.commit();
  return adminRentalSettingsData();
}`;

replaceRequired(
  /async function publicRentalSettings\(\)\{[\s\S]*?\nasync function adminSaveRentalSettings\(data\)\{[\s\S]*?\n\}/,
  adminFunctions,
  'admin rental settings'
);

replaceRequired(
  "  exportsObject.coursePortalRentalUseSettings = callable(publicRentalSettings);",
  `  exportsObject.coursePortalRentalUseSettings = callable(publicRentalSettings);
  exportsObject.coursePortalAdminRentalSettingsData = callable(async (data, request) => {
    assertAdminPin(request);
    return adminRentalSettingsData();
  }, { secrets: [ADMIN_PIN] });`,
  'admin rental settings export'
);

fs.writeFileSync(backendPath, source);
console.log('Rental policy v3 installed.');