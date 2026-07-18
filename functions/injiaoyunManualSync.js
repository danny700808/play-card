'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { GoogleAuth } = require('google-auth-library');
const crypto = require('crypto');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const FUNCTION_REGION = 'us-central1';
const RUN_REGION = 'asia-east1';
const RUN_JOB_NAME = 'injiaoyun-cloud-sync';
const REQUEST_TTL_MS = 15 * 60 * 1000;
const MIN_REQUEST_INTERVAL_MS = 90 * 1000;
const VERSION = '2026.07.18-v1.4-injiaoyun-manual-trigger';
const MANUAL_SYNC_PIN = defineSecret('INJIAOYUN_MANUAL_SYNC_PIN');
const SETTINGS_REF = db.collection('opsSettings').doc('injiaoyunCloudSync');
const REQUEST_REF = db.collection('opsAutomationRequests').doc('injiaoyunManual');
const ALLOWED_ORIGINS = new Set([
  'https://danny700808.github.io',
  'https://www.mingtinghuang.com',
  'https://mingtinghuang.com'
]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function requestOrigin(request) {
  const headers = request && request.rawRequest && request.rawRequest.headers || {};
  const direct = clean(headers.origin).toLowerCase();
  if (direct) return direct.replace(/\/$/, '');
  const referer = clean(headers.referer || headers.referrer);
  if (!referer) return '';
  try { return new URL(referer).origin.toLowerCase().replace(/\/$/, ''); }
  catch (_) { return ''; }
}

function assertAllowedCaller(request) {
  const source = clean(request && request.data && request.data.source).toLowerCase();
  const origin = requestOrigin(request);
  if (source === 'operations-hub' && ALLOWED_ORIGINS.has(origin)) return origin;
  throw new HttpsError('permission-denied', '只允許從全通路營運中心執行音教雲手動同步。');
}

function secureEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left), 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(String(right), 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function assertManualSyncPin(request) {
  const expected = clean(MANUAL_SYNC_PIN.value());
  const provided = clean(request && request.data && request.data.manualSyncPin);
  if (expected.length < 12) {
    throw new HttpsError('failed-precondition', '尚未在 Secret Manager 設定音教雲手動同步密碼。');
  }
  if (!provided || !secureEqual(provided, expected)) {
    throw new HttpsError('permission-denied', '手動同步密碼不正確。');
  }
}

function taipeiDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function newRequestId() {
  return `manual_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function safeLabel(value) {
  return clean(value).replace(/[\r\n\t]/g, ' ').slice(0, 120) || '營運中心管理者';
}

async function reserveManualRequest(request, origin) {
  const now = Timestamp.now();
  const nowMs = now.toMillis();
  const requestId = newRequestId();
  const requestedBy = safeLabel(request && request.data && request.data.requestedBy);
  const requestedEndDateKey = taipeiDateKey();

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(REQUEST_REF);
    const current = snapshot.exists ? snapshot.data() || {} : {};
    const currentStatus = clean(current.status).toLowerCase();
    const currentExpiry = timestampMillis(current.expiresAt);
    const currentRequestedAt = timestampMillis(current.requestedAt);

    if (['pending', 'running'].includes(currentStatus) && currentExpiry > nowMs) {
      return {
        created: false,
        status: 'already-running',
        requestId: clean(current.requestId),
        requestedEndDateKey: clean(current.requestedEndDateKey) || requestedEndDateKey
      };
    }

    if (currentRequestedAt && nowMs - currentRequestedAt < MIN_REQUEST_INTERVAL_MS && currentStatus !== 'error') {
      return {
        created: false,
        status: 'cooldown',
        requestId: clean(current.requestId),
        requestedEndDateKey: clean(current.requestedEndDateKey) || requestedEndDateKey,
        retryAfterSeconds: Math.max(1, Math.ceil((MIN_REQUEST_INTERVAL_MS - (nowMs - currentRequestedAt)) / 1000))
      };
    }

    transaction.set(REQUEST_REF, {
      requestId,
      status: 'pending',
      source: 'operations-hub',
      requestedAt: now,
      requestedBy,
      requestedOrigin: origin,
      requestedEndDateKey,
      expiresAt: Timestamp.fromMillis(nowMs + REQUEST_TTL_MS),
      lastError: '',
      version: VERSION
    });

    return { created: true, status: 'accepted', requestId, requestedEndDateKey };
  });
}

function cloudRunJobUrl() {
  const projectId = clean(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId || 'youzi-c1b74');
  return `https://run.googleapis.com/v2/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(RUN_REGION)}/jobs/${encodeURIComponent(RUN_JOB_NAME)}:run`;
}

async function invokeCloudRunJob() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const response = await client.request({
    url: cloudRunJobUrl(),
    method: 'POST',
    data: {}
  });
  return response && response.data || {};
}

function cloudErrorMessage(error) {
  const responseData = error && error.response && error.response.data;
  const nested = responseData && responseData.error && responseData.error.message;
  return clean(nested || error && error.message || error).slice(0, 1000) || '無法啟動 Cloud Run 音教雲同步工作。';
}

function registerInjiaoyunManualSync(exportsObject) {
  exportsObject.runInjiaoyunSyncNow = onCall({
    region: FUNCTION_REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
    cors: Array.from(ALLOWED_ORIGINS),
    secrets: [MANUAL_SYNC_PIN]
  }, async (request) => {
    const origin = assertAllowedCaller(request);
    assertManualSyncPin(request);
    const reservation = await reserveManualRequest(request, origin);
    if (!reservation.created) {
      return {
        ok: true,
        status: reservation.status,
        requestId: reservation.requestId,
        requestedEndDateKey: reservation.requestedEndDateKey,
        retryAfterSeconds: reservation.retryAfterSeconds || 0,
        message: reservation.status === 'already-running'
          ? '音教雲同步已在排隊或執行中。'
          : `剛剛已提出同步，請約 ${reservation.retryAfterSeconds || 1} 秒後再試。`
      };
    }

    await SETTINGS_REF.set({
      enabled: true,
      status: 'queued',
      manualRequestId: reservation.requestId,
      manualRequestedAt: FieldValue.serverTimestamp(),
      manualRequestedBy: safeLabel(request && request.data && request.data.requestedBy),
      requestedEndDateKey: reservation.requestedEndDateKey,
      lastError: '',
      version: VERSION
    }, { merge: true });

    try {
      const operation = await invokeCloudRunJob();
      await REQUEST_REF.set({
        operationName: clean(operation.name),
        acceptedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      return {
        ok: true,
        status: 'accepted',
        requestId: reservation.requestId,
        requestedEndDateKey: reservation.requestedEndDateKey,
        operationName: clean(operation.name),
        message: `已啟動音教雲同步，資料會更新到 ${reservation.requestedEndDateKey}。`
      };
    } catch (error) {
      const message = cloudErrorMessage(error);
      console.error('[runInjiaoyunSyncNow]', {
        message,
        code: clean(error && error.code),
        status: Number(error && error.response && error.response.status) || 0
      });
      await Promise.all([
        REQUEST_REF.set({
          status: 'error',
          lastError: message,
          failedAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromMillis(0)
        }, { merge: true }),
        SETTINGS_REF.set({
          enabled: true,
          status: 'error',
          lastFailedAt: FieldValue.serverTimestamp(),
          lastError: `無法啟動手動同步：${message}`.slice(0, 1000),
          version: VERSION
        }, { merge: true })
      ]);
      throw new HttpsError('failed-precondition', `音教雲手動同步無法啟動：${message}`);
    }
  });
}

module.exports = {
  registerInjiaoyunManualSync,
  taipeiDateKey
};
