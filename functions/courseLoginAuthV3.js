'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { bindingIdentity, bindingIdentityPatch, decideLineLoginBinding } = require('./courseLoginPolicy');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;
const REGION = 'us-central1';
const PORTAL_BASE = String(process.env.PUBLIC_WEB_BASE_URL || 'https://danny700808.github.io/play-card').replace(/\/$/, '');
const LINE_LOGIN_CHANNEL_ID = String(process.env.LINE_LOGIN_CHANNEL_ID || '2010902226').trim();
const LINE_LOGIN_CALLBACK_URL = String(process.env.LINE_LOGIN_CALLBACK_URL || 'https://us-central1-youzi-c1b74.cloudfunctions.net/coursePortalLineLoginCallback').trim();
const LINE_LOGIN_CHANNEL_SECRET = defineSecret('LINE_LOGIN_CHANNEL_SECRET');
const LINE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const LINE_SETUP_TTL_MS = 20 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 10 * 60 * 1000;
const CALLBACK_WAIT_MS = 20 * 1000;
const ALLOWED_ORIGINS = [
  'https://danny700808.github.io',
  'https://www.mingtinghuang.com',
  'https://mingtinghuang.com',
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i
];

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function asMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function validType(value) {
  const type = clean(value).toLowerCase();
  return ['teacher', 'student', 'renter'].includes(type) ? type : '';
}

function bindingCollection(type) {
  if (type === 'teacher') return 'coursePortalTeacherBindings';
  if (type === 'student') return 'coursePortalStudentBindings';
  return 'coursePortalRenterBindings';
}

function lineAccountId(type, lineUserId) {
  return hash(`line-account|${clean(type)}|${clean(lineUserId)}`);
}

function portalEntryUrl(params = {}) {
  const url = new URL(`${PORTAL_BASE}/course-portal.html`);
  Object.entries(params).forEach(([key, value]) => {
    const text = clean(value);
    if (text) url.searchParams.set(key, text);
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
    // normal：好友選項留在同一個同意畫面，不再多跳一個加入好友頁。
    bot_prompt: 'normal'
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}

async function startLineLogin(data) {
  const type = validType(data && data.type);
  if (!type) throw new HttpsError('invalid-argument', '不支援的入口類型。');

  const state = randomToken(32);
  const expiresAt = Timestamp.fromMillis(Date.now() + LINE_OAUTH_STATE_TTL_MS);
  await db.collection('coursePortalLineOAuthStates').doc(hash(state)).set({
    type,
    linkAnother: type === 'student' && data && data.linkAnother === true,
    stateHint: state.slice(-6),
    status: 'pending',
    flowVersion: 3,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt
  });

  return {
    ok: true,
    authorizationUrl: lineAuthorizationUrl(state),
    expiresAt: expiresAt.toDate().toISOString()
  };
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
    console.error('[course login v3 token exchange failed]', response.status, payload.error || payload.error_description || '');
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
  return snapshot.docs.map((doc) => Object.assign({
    __id: doc.id,
    __ref: doc.ref
  }, doc.data() || {}));
}

async function refreshBindingProfiles(bindings, profile, type) {
  if (!bindings.length) return bindings;

  const batch = db.batch();
  bindings.forEach((binding) => {
    const update = {
      type,
      lineDisplayName: profile.lineDisplayName,
      linePictureUrl: profile.linePictureUrl,
      lineFriendFlag: profile.lineFriendFlag,
      lineProfileCheckedAt: FieldValue.serverTimestamp(),
      authAccountId: lineAccountId(type, profile.lineUserId)
    };
    Object.assign(update, bindingIdentityPatch(type, binding));
    batch.set(binding.__ref, update, { merge: true });
  });
  await batch.commit();
  return bindings;
}

async function issueAccessToken({ type, profile, binding }) {
  const raw = randomToken(32);
  const expiresAt = Timestamp.fromMillis(Date.now() + ACCESS_TOKEN_TTL_MS);
  const identityId = bindingIdentity(type, binding);
  const targetId = type === 'renter' ? '' : identityId;
  const renterId = type === 'renter' ? identityId : '';

  await db.collection('coursePortalAccessTokens').doc(hash(raw)).set({
    type,
    lineUserId: profile.lineUserId,
    authAccountId: lineAccountId(type, profile.lineUserId),
    targetId,
    renterId,
    authMethod: 'line-oauth-v3',
    lineFriendFlag: profile.lineFriendFlag,
    status: 'active',
    flowVersion: 3,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt
  });
  return raw;
}

async function issueSetupToken(type, profile) {
  const raw = randomToken(36);
  const expiresAt = Timestamp.fromMillis(Date.now() + LINE_SETUP_TTL_MS);
  await db.collection('coursePortalLineSetupTokens').doc(hash(raw)).set({
    type,
    lineUserId: profile.lineUserId,
    lineDisplayName: profile.lineDisplayName,
    linePictureUrl: profile.linePictureUrl,
    lineFriendFlag: profile.lineFriendFlag,
    status: 'pending',
    flowVersion: 3,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt
  });
  return raw;
}

async function waitForRedirect(stateRef, timeoutMs = CALLBACK_WAIT_MS) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || CALLBACK_WAIT_MS);
  while (Date.now() < deadline) {
    const snapshot = await stateRef.get();
    const row = snapshot.exists ? snapshot.data() || {} : null;
    if (!row) return '';

    const redirectUrl = clean(row.redirectUrl);
    if (redirectUrl) return redirectUrl;

    const status = clean(row.status);
    if (['error', 'cancelled', 'blocked'].includes(status)) {
      throw new Error(clean(row.error) || 'LINE 登入未完成，請重新操作。');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return '';
}

function redirectError(res, type, message) {
  res.redirect(302, portalEntryUrl({
    method: 'line',
    role: validType(type),
    lineError: message || 'LINE 登入未完成，請重新操作。'
  }));
}

async function lineLoginCallback(req, res) {
  res.set('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'GET') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const state = lineQueryValue(req, 'state');
  const code = lineQueryValue(req, 'code');
  const providerError = lineQueryValue(req, 'error');
  const stateRef = state
    ? db.collection('coursePortalLineOAuthStates').doc(hash(state))
    : null;
  let type = '';
  let ownsProcessing = false;

  try {
    if (!stateRef) throw new Error('LINE 登入狀態不完整，請重新操作。');

    let stateRow = null;
    let replayUrl = '';
    let waitForProcessing = false;
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(stateRef);
      const row = snapshot.exists ? snapshot.data() || {} : null;
      type = validType(row && row.type);
      if (!row || !type || asMillis(row.expiresAt) < Date.now()) {
        throw new Error('LINE 登入連結已失效，請回到入口重新登入。');
      }

      const status = clean(row.status);
      if (clean(row.redirectUrl)) {
        stateRow = row;
        replayUrl = clean(row.redirectUrl);
        return;
      }
      if (status === 'processing') {
        stateRow = row;
        waitForProcessing = true;
        return;
      }
      if (status !== 'pending') {
        throw new Error(clean(row.error) || 'LINE 登入連結已失效，請回到入口重新登入。');
      }

      stateRow = row;
      ownsProcessing = true;
      tx.set(stateRef, {
        status: 'processing',
        processingAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
    });

    if (replayUrl) {
      res.redirect(302, replayUrl);
      return;
    }
    if (waitForProcessing) {
      const completedUrl = await waitForRedirect(stateRef);
      if (!completedUrl) throw new Error('LINE 登入仍在處理中，請直接回到入口再試一次。');
      res.redirect(302, completedUrl);
      return;
    }
    if (!stateRow) throw new Error('LINE 登入狀態不完整，請重新操作。');

    if (providerError || !code) {
      const message = providerError ? '您已取消 LINE 登入。' : 'LINE 沒有回傳登入授權，請重新操作。';
      const redirectUrl = portalEntryUrl({ method: 'line', role: type, lineError: message });
      await stateRef.set({
        status: 'cancelled',
        error: message,
        redirectUrl,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      res.redirect(302, redirectUrl);
      return;
    }

    const token = await exchangeLineAuthorizationCode(code);
    const profile = await lineLoginProfile(token.access_token);
    const allBindings = await refreshBindingProfiles(
      await bindingsForLine(type, profile.lineUserId),
      profile,
      type
    );
    const decision = decideLineLoginBinding(type, allBindings);

    if (['pending', 'blocked', 'conflict'].includes(decision.action)) {
      const message = decision.action === 'pending'
        ? '這個身分已完成註冊，正在等待管理者核准；核准後再重新登入即可。'
        : (decision.action === 'conflict'
          ? '這個 LINE 在同一身分下有多筆有效資料，系統已停止自動選擇。請聯絡柚子樂器協助確認。'
          : '這個入口帳號目前已停用，請聯絡柚子樂器協助恢復。');
      const redirectUrl = portalEntryUrl({ method: 'line', role: type, lineError: message });
      await stateRef.set({
        status: decision.action === 'pending' ? 'awaiting-approval' : 'blocked',
        error: message,
        lineUserId: profile.lineUserId,
        redirectUrl,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });
      res.redirect(302, redirectUrl);
      return;
    }

    let redirectUrl = '';
    if (decision.action === 'login' && stateRow.linkAnother !== true) {
      const accessToken = await issueAccessToken({
        type,
        profile,
        binding: decision.binding
      });
      redirectUrl = portalEntryUrl({
        method: 'line',
        role: type,
        access: accessToken
      });
    } else {
      const setupToken = await issueSetupToken(type, profile);
      redirectUrl = portalEntryUrl({
        method: 'line',
        role: type,
        lineSetup: setupToken
      });
    }

    await stateRef.set({
      status: 'used',
      lineUserId: profile.lineUserId,
      lineFriendFlag: profile.lineFriendFlag,
      setupRequired: !(decision.action === 'login' && stateRow.linkAnother !== true),
      redirectUrl,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    res.redirect(302, redirectUrl);
  } catch (error) {
    const message = clean(error && error.message) || 'LINE 登入未完成，請重新操作。';
    console.error('[course login v3 callback failed]', message);

    if (stateRef) {
      try {
        const latest = await stateRef.get();
        const latestRow = latest.exists ? latest.data() || {} : {};
        const latestStatus = clean(latestRow.status);
        if (clean(latestRow.redirectUrl)) {
          res.redirect(302, clean(latestRow.redirectUrl));
          return;
        }
        if (ownsProcessing || !['used', 'blocked', 'cancelled', 'processing'].includes(latestStatus)) {
          await stateRef.set({
            status: 'error',
            error: message.slice(0, 300),
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true });
        }
      } catch (stateError) {
        console.error('[course login v3 state recovery failed]', clean(stateError && stateError.message));
      }
    }
    redirectError(res, type, message);
  }
}

function registerCourseLoginAuthV3(exportsObject) {
  exportsObject.coursePortalStartLineLogin = onCall({
    region: REGION,
    cors: ALLOWED_ORIGINS,
    timeoutSeconds: 60,
    memory: '256MiB'
  }, async (request) => startLineLogin(request && request.data || {}));

  exportsObject.coursePortalLineLoginCallback = onRequest({
    region: REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: [LINE_LOGIN_CHANNEL_SECRET]
  }, lineLoginCallback);
}

module.exports = {
  registerCourseLoginAuthV3
};
