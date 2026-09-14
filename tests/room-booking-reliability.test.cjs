'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { BookingOperations, SCHEDULE_CHANGED, recheckSchedule, rememberSource } = require('../functions/coursePortalReliability');
const { publicBooking } = require('../functions/coursePortalReliability');
const recovery = require('../room-booking-recovery');
const { bookingPage, compare } = require('../functions/roomBookingPages');
class HttpsError extends Error { constructor(code, message, details) { super(message); Object.assign(this, { code, details }); } }
function database() {
  const rows = new Map(); let serial = Promise.resolve();
  const ref = path => ({ path, id: path.split('/').at(-1), async get() { return { id: this.id, exists: rows.has(path), data: () => structuredClone(rows.get(path)), ref: this }; } });
  return { rows, collection: name => ({ doc: id => ref(name + '/' + id) }),
    runTransaction(fn) {
      const run = serial.then(async () => {
        const writes = [];
        const value = await fn({ get: r => r.get(), set(r, data, opts) { writes.push(() => rows.set(r.path, { ...(opts?.merge ? rows.get(r.path) : {}), ...structuredClone(data) })); } });
        writes.forEach(write => write()); return value;
      }); serial = run.catch(() => {}); return run;
    }
  };
}
function operations(db) { return new BookingOperations({ db, HttpsError, hash: s => crypto.createHash('sha256').update(s).digest('hex'), randomToken: () => crypto.randomUUID(), FieldValue: { serverTimestamp: () => 1 }, sessionOwnerKey: s => s.authAccountId }); }
const session = { role: 'teacher', authAccountId: 'owner-a' };
const request = { operationId: 'one-operation-123456', roomId: 'room', date: '2026-10-01', startTime: '13:00', durationMinutes: 60 };
test('same operation has one lease; committed response is recoverable and isolated by owner', async () => {
  const db = database(), store = operations(db);
  const claims = await Promise.all([store.claim(session, request), store.claim(session, request)]);
  assert.equal(claims.filter(c => c.operation).length, 1);
  const op = claims.find(c => c.operation).operation;
  await db.runTransaction(async tx => {
    store.assertLease(op, await tx.get(op.ref));
    tx.set(db.collection('coursePortalRoomBookings').doc(op.bookingId), { ...request, amount: 100, active: true, clientPhone: 'private' });
    tx.set(op.ref, { status: 'confirmed', bookingId: op.bookingId }, { merge: true });
  });
  await store.fail(op, new HttpsError('failed-precondition', 'late error after commit'));
  const confirmed = await store.read(session, request.operationId);
  assert.equal(confirmed.state, 'confirmed'); assert.equal(confirmed.booking.amount, 100);
  assert.equal(confirmed.booking.clientPhone, undefined);
  assert.equal((await store.claim(session, request)).result.booking.id, op.bookingId);
  assert.equal((await store.read({ ...session, authAccountId: 'owner-b' }, request.operationId)).state, 'pending');
  await assert.rejects(store.claim(session, { ...request, roomId: 'different' }), { code: 'already-exists' });
});
test('expired lease fences old worker; ambiguous failure stays pending; definitive rejection is retained', async () => {
  const db = database(), store = operations(db);
  const first = (await store.claim(session, request)).operation;
  await store.fail(first, new HttpsError('unavailable', 'timeout'));
  assert.equal((await store.read(session, request.operationId)).retryAllowed, false);
  db.rows.get(first.ref.path).leaseUntil = 0;
  const next = (await store.claim(session, request)).operation;
  assert.equal(next.bookingId, first.bookingId);
  assert.throws(() => store.assertLease(first, { exists: true, data: () => db.rows.get(first.ref.path) }), { code: 'aborted' });
  await store.fail(first, new HttpsError('invalid-argument', 'stale worker'));
  assert.equal((await store.read(session, request.operationId)).state, 'pending');
  await store.fail(next, new HttpsError('already-exists', 'occupied'));
  assert.equal((await store.read(session, request.operationId)).message, 'occupied');
});
test('unrelated version change rechecks; source mutation and real conflicts stop', async () => {
  let attempts = 0;
  const result = await recheckSchedule(async ctx => {
    rememberSource(ctx, { id: 'lesson', start: '13:00' }, HttpsError);
    if (++attempts < 3) throw new HttpsError('aborted', 'version', { reason: SCHEDULE_CHANGED });
    return 'saved';
  }, { pause: async () => {} });
  assert.equal(result, 'saved'); assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(recheckSchedule(async ctx => {
    rememberSource(ctx, { start: ++attempts === 1 ? '13:00' : '14:00' }, HttpsError);
    throw new HttpsError('aborted', 'version', { reason: SCHEDULE_CHANGED });
  }, { pause: async () => {} }), { code: 'failed-precondition' });
  attempts = 0;
  await assert.rejects(recheckSchedule(async () => { attempts++; throw new HttpsError('already-exists', 'occupied'); }), { code: 'already-exists' });
  assert.equal(attempts, 1);
});
function browserFixture(call, values = new Map()) {
  const states = [], tasks = [];
  const options = { call, key: 'pending', storage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }, newId: () => request.operationId,
    onState: s => states.push(s), schedule: fn => { tasks.push(fn); return tasks.length; }, cancel() {} };
  return { client: recovery.create(options), options, states, values, tasks };
}
test('lost booking response survives reload and is queried without creating a duplicate', async () => {
  let sends = 0;
  const b = browserFixture(async name => { if (name === 'coursePortalCreateRoomBooking') { sends++; throw new Error('response lost'); } return { state: 'confirmed', booking: { id: 'saved' } }; });
  await b.client.submit(request);
  assert.equal(b.client.hasPending(), true); assert(b.values.has('pending'));
  b.client.stop();
  const reopened = recovery.create(b.options);
  await reopened.check(); assert.equal(sends, 1); assert.equal(reopened.hasPending(), false);
  assert.equal(b.states.at(-1).booking.id, 'saved');
});
test('retry uses identical durable request; storage failure prevents any write', async () => {
  const sent = [];
  const b = browserFixture(async (name, payload) => {
    if (name === 'coursePortalRoomBookingOperation') return { state: 'pending', retryAllowed: true };
    sent.push(structuredClone(payload));
    if (sent.length === 1) throw new Error('offline');
    return { state: 'confirmed', booking: { id: 'saved' } };
  });
  await b.client.submit(request); await b.client.submit({ ...request, roomId: 'other' });
  assert.deepEqual(sent[0], sent[1]);
  const denied = recovery.create({ ...b.options, storage: { getItem() { return null; }, setItem() { throw new Error('storage denied'); } } });
  await assert.rejects(denied.submit(request), /storage denied/); assert.equal(sent.length, 2);
});
test('pagination is bounded, owner-scoped and stable across overlapping identity queries', async () => {
  const docs = Array.from({ length: 70 }, (_, n) => ({ id: String(n).padStart(3, '0'), data: () => ({ date: '2026-10-01', startTime: '13:00', active: true, ownerKey: n < 60 ? 'a' : 'b', lineUserId: n < 60 ? 'line-a' : 'line-b' }) }));
  let reads = 0;
  const db = { collection() { let filters = [], after, sign = 1, limit;
    return { where(f, op, v) { filters.push(d => op === '==' ? d.data()[f] === v : d.data()[f] >= v); return this; }, orderBy(f, dir) { sign = dir === 'desc' ? -1 : 1; return this; }, startAfter(...v) { after = v; return this; }, limit(n) { assert.equal(n, 26); limit = n; return this; }, async get() { reads++; return { docs: docs.filter(d => filters.every(f => f(d))).sort((a, b) => compare([a.data().date, a.data().startTime, a.id], [b.data().date, b.data().startTime, b.id]) * sign).filter(d => !after || compare([d.data().date, d.data().startTime, d.id], after) * sign > 0).slice(0, limit) }; } };
  } };
  for (const view of ['all', 'upcoming']) {
    const ids = []; let cursor;
    do { const page = await bookingPage({ db, identities: [['ownerKey', 'a'], ['lineUserId', 'line-a']], documentId: '__name__', view, cursor, today: '2026-09-14', HttpsError }); ids.push(...page.docs.map(d => d.id)); cursor = page.nextCursor; } while (cursor);
    assert.equal(ids.length, 60); assert.equal(new Set(ids).size, 60); assert(!ids.includes('060'));
  }
  assert.equal(reads, 12);
});
test('late rental board success and failure cannot replace newer results', async () => {
  const source = fs.readFileSync('room-booking-v2.js', 'utf8').replace(/\r\n/g, '\n');
  const a = source.indexOf('  async function loadBoard()'), b = source.indexOf('  function renderRooms()', a);
  const calls = [], nodes = new Map(), toasts = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', classList: { add() {} } }); return nodes.get(id); };
  const ctx = { boardRequestId: 0, roomRequestId: 0, pendingStart: '', selectedStart: '', selectedRoom: {}, roomData: {}, boardData: null, token: '', weekStart: '', selectedUse: '', durationMinutes: 60, role: '', selectedStudentId: '', selectedDate: '', studentOptions: [], studentDiscountEligible: false,
    P: { call: () => new Promise((resolve, reject) => calls.push({ resolve, reject })), toast: m => toasts.push(m) }, document: { getElementById: node }, preferencePayload: () => ({}), closeConfirm() {}, isAuthError: () => false, updateStudentRentalNavigation() {}, renderWelcomeName() {}, renderUses() {}, renderDates() {}, renderSlots() {}, renderRateChoice() {}, todayKey: () => '2026-09-14' };
  vm.runInNewContext(source.slice(a, b), ctx);
  const first = ctx.loadBoard(), second = ctx.loadBoard();
  const newest = { marker: 'new', days: [] }; calls[1].resolve(newest); await second;
  calls[0].resolve({ marker: 'old', days: [] }); await first; assert.equal(ctx.boardData.marker, 'new');
  const third = ctx.loadBoard(), fourth = ctx.loadBoard(); calls[3].resolve(newest); await fourth;
  const html = node('rentalBoard').innerHTML; calls[2].reject(new Error('old error')); await third;
  assert.equal(toasts.length, 0); assert.equal(node('rentalBoard').innerHTML, html);
});

test('booking, operation, locks and notification outbox commit atomically; notice failure is recoverable', async () => {
  const source = fs.readFileSync('functions/coursePortal.js', 'utf8').replace(/\r\n/g, '\n');
  const extract = name => { const a = source.indexOf('async function ' + name + '('); return source.slice(a, source.indexOf('\n}', a) + 2); };
  const db = database(), store = operations(db), op = (await store.claim(session, request)).operation;
  const versionRef = db.collection('version').doc('current');
  const ctx = { db, HttpsError, SCHEDULE_CHANGED, publicBooking,
    clean: v => String(v || ''), flagTrue: v => v === true, recordingRentalSelection: () => null,
    readScheduleVersion: async () => 0, assertScheduleWritable() {}, scheduleVersionRef: () => versionRef,
    rentalAvailability: async () => ({ date: request.date, startTime: '13:00', endTime: '14:00', rooms: [{ id: 'room', name: 'Test Room', available: true, price: 100, unitFee: 100, priceType: 'general' }], useOptions: [] }),
    rentalSessionIdentity: async () => ({ clientName: 'Test', clientPhone: '', studentId: '' }), publicRentalSlotIsPast: () => false,
    sessionOwnerKey: s => s.authAccountId, bookingLockRows: () => [{ id: 'lock', roomId: 'room', slot: '13:00', resourceId: '' }],
    sharedEquipmentLockRows: () => [], requestedRentalResourceIds: () => [], FieldValue: { serverTimestamp: () => 1 }, Timestamp: { fromMillis: n => n },
    nowText: () => '', taipeiDateTimeMillis: () => Date.now() + 3600000, bookingOperationStore: () => store,
    portalRecipientForSession: async () => { throw new Error('notification lookup temporarily unavailable'); }, notificationRecipientKey: r => r.targetEmail,
    PORTAL_BASE: 'https://example.test'
  };
  vm.runInNewContext(extract('createRoomBookingAttempt') + '\n' + extract('deliverRoomBookingNotice'), ctx);
  const result = await ctx.createRoomBookingAttempt(request, session, op);
  assert.equal(result.state, 'confirmed'); assert.equal(db.rows.get(versionRef.path).version, 1);
  assert.equal(db.rows.get('coursePortalRoomLocks/lock').bookingId, op.bookingId);
  assert.equal((await store.read(session, request.operationId)).state, 'confirmed');
  await assert.rejects(ctx.deliverRoomBookingNotice(op.bookingId), /temporarily unavailable/);
  assert.equal(db.rows.get('coursePortalBookingNotices/' + op.bookingId).status, 'pending');
  ctx.portalRecipientForSession = async () => ({ targetEmail: 'recipient@example.test', channel: 'email' });
  await ctx.deliverRoomBookingNotice(op.bookingId);
  const queued = db.rows.get('notificationQueue/course-portal-booking-' + op.bookingId + '-reminder');
  assert.equal(queued.bookingId, op.bookingId);
  await ctx.deliverRoomBookingNotice(op.bookingId);
  assert.equal([...db.rows.keys()].filter(k => k.startsWith('notificationQueue/')).length, 1);
  assert.equal(db.rows.get('coursePortalBookingNotices/' + op.bookingId).status, 'done');
});
