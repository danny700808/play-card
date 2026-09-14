'use strict';

const SCHEDULE_CHANGED = 'schedule-version-changed';
const LEASE_MS = 240000; // Longer than the 180-second callable, including commit grace.

async function recheckSchedule(run, options = {}) {
  const attempts = options.attempts || 4;
  const pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const context = {};
  for (let attempt = 0; ; attempt++) {
    try { return await run(context); }
    catch (error) {
      // Sync locks, changed source lessons and actual conflicts must never be retried blindly.
      if (error?.details?.reason !== SCHEDULE_CHANGED || attempt + 1 >= attempts) throw error;
      await pause(40 * (attempt + 1));
    }
  }
}

function rememberSource(context, source, HttpsError) {
  const snapshot = JSON.stringify(source);
  if (context.source !== undefined && context.source !== snapshot) {
    throw new HttpsError('failed-precondition', '原課程已被其他裝置修改，已保留您填寫的內容；請重新確認原課程。');
  }
  context.source = snapshot;
}

function bookingRequest(data) {
  const result = {};
  for (const key of ['roomId', 'date', 'startTime', 'useType', 'recordingUsage', 'studentId',
    'rentalMode', 'clientName', 'purpose', 'pianoType', 'drumType']) result[key] = String(data[key] ?? '').trim();
  result.durationMinutes = Number(data.durationMinutes ?? 60);
  for (const key of ['studentDiscountRequested', 'excludeDigitalPiano', 'allowGuzhengMove']) {
    result[key] = data[key] === true || String(data[key]).toLowerCase() === 'true';
  }
  return result;
}

function publicBooking(row) {
  const value = {};
  for (const key of ['id', 'date', 'startTime', 'endTime', 'roomId', 'roomName', 'useName',
    'amount', 'paymentStatus', 'status', 'active']) value[key] = row[key] ?? '';
  return value;
}

class BookingOperations {
  constructor(options) { Object.assign(this, options); }

  reference(session, operationId) {
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(operationId || '')) {
      throw new this.HttpsError('invalid-argument', '預約識別碼無效，請重新開啟確認畫面。');
    }
    const owner = this.sessionOwnerKey(session);
    if (!owner) throw new this.HttpsError('unauthenticated', '登入資料不完整，請重新登入。');
    const id = this.hash([session.role, owner, operationId].join('|'));
    return this.db.collection('coursePortalBookingOperations').doc(id);
  }

  async response(ref, operationId, row) {
    if (row?.status === 'confirmed') {
      const snapshot = await this.db.collection('coursePortalRoomBookings').doc(row.bookingId).get();
      if (!snapshot.exists) throw new this.HttpsError('unavailable', '正在核對預約紀錄，請稍後再試。');
      return { ok: true, state: 'confirmed', operationId, booking: publicBooking({ ...snapshot.data(), id: snapshot.id }) };
    }
    if (row?.status === 'failed') return { ok: false, state: 'failed', operationId, message: row.message };
    return { ok: true, state: 'pending', operationId, retryAllowed: !row || Number(row.leaseUntil || 0) <= Date.now(), retryAfterMs: 3000 };
  }

  async read(session, operationId) {
    const ref = this.reference(session, operationId);
    const snapshot = await ref.get();
    return this.response(ref, operationId, snapshot.exists ? snapshot.data() : null);
  }

  async claim(session, data) {
    const operationId = data.operationId;
    const ref = this.reference(session, operationId);
    const requestHash = this.hash(JSON.stringify(bookingRequest(data)));
    const leaseToken = this.randomToken(18);
    const result = await this.db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const prior = snapshot.exists ? snapshot.data() : null;
      if (prior && prior.requestHash !== requestHash) {
        throw new this.HttpsError('already-exists', '這次預約內容已變更，請先確認上一筆預約結果。');
      }
      if (prior && (['confirmed', 'failed'].includes(prior.status) || Number(prior.leaseUntil) > Date.now())) return { prior };
      tx.set(ref, {
        requestHash, status: 'pending', bookingId: 'operation-' + ref.id,
        leaseToken, leaseUntil: Date.now() + LEASE_MS,
        updatedAt: this.FieldValue.serverTimestamp()
      }, { merge: true });
      return { operation: { ref, operationId, leaseToken, bookingId: 'operation-' + ref.id } };
    });
    return result.operation ? result : { result: await this.response(ref, operationId, result.prior) };
  }

  assertLease(operation, snapshot) {
    if (!snapshot.exists || snapshot.data().status !== 'pending' || snapshot.data().leaseToken !== operation.leaseToken) {
      throw new this.HttpsError('aborted', '正在確認同一次預約，請稍候。');
    }
  }

  async fail(operation, error) {
    const definite = ['invalid-argument', 'failed-precondition', 'already-exists', 'permission-denied', 'not-found'].includes(error.code);
    await this.db.runTransaction(async tx => {
      const snapshot = await tx.get(operation.ref);
      if (!snapshot.exists || snapshot.data().status !== 'pending' || snapshot.data().leaseToken !== operation.leaseToken) return;
      if (definite) tx.set(operation.ref, { status: 'failed', message: error.message, updatedAt: this.FieldValue.serverTimestamp() }, { merge: true });
      // An ambiguous database/network failure stays pending until its lease expires.
    });
  }
}

module.exports = { SCHEDULE_CHANGED, recheckSchedule, rememberSource, bookingRequest, publicBooking, BookingOperations };
