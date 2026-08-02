'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

const REGION = 'us-central1';
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 8;
const PASSWORD_FIELDS = ['password', 'loginPassword', '密碼', '登入密碼'];

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function truthy(value) {
  const normalized = lower(value);
  return value === true || ['是', 'yes', 'true', '1', '啟用', 'enabled', 'active'].includes(normalized);
}

function requestIp(request) {
  const forwarded = clean(request && request.rawRequest && request.rawRequest.headers && request.rawRequest.headers['x-forwarded-for']);
  return clean(forwarded.split(',')[0] || (request && request.rawRequest && request.rawRequest.ip) || 'unknown');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function rateRef(db, purpose, email, request) {
  return db.collection('employeeAuthRateLimits').doc(sha256(`${purpose}|${lower(email)}|${requestIp(request)}`));
}

async function assertRateLimit(db, purpose, email, request) {
  const ref = rateRef(db, purpose, email, request);
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const row = snapshot.exists ? (snapshot.data() || {}) : {};
    const windowStartedAt = Number(row.windowStartedAt || 0);
    const activeWindow = windowStartedAt && now - windowStartedAt < RATE_WINDOW_MS;
    const failures = activeWindow ? Number(row.failures || 0) : 0;
    if (failures >= MAX_FAILED_ATTEMPTS) {
      throw new HttpsError('resource-exhausted', '登入嘗試次數過多，請 15 分鐘後再試。');
    }
    transaction.set(ref, {
      purpose,
      emailHash: sha256(lower(email)),
      windowStartedAt: activeWindow ? windowStartedAt : now,
      failures,
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  return ref;
}

async function recordFailure(ref) {
  await ref.set({
    failures: admin.firestore.FieldValue.increment(1),
    lastFailureAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function clearFailures(ref) {
  await ref.set({
    failures: 0,
    windowStartedAt: Date.now(),
    lastSuccessAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function queryFirst(db, collection, field, value) {
  const snapshot = await db.collection(collection).where(field, '==', value).limit(1).get();
  if (snapshot.empty) return null;
  const document = snapshot.docs[0];
  return { collection, id: document.id, ref: document.ref, data: document.data() || {} };
}

async function findAccount(db, email) {
  const account = lower(email);
  const lookups = [
    ['admins', 'email'],
    ['admins', 'loginAccount'],
    ['employees', 'email'],
    ['employees', 'Email'],
    ['employees', 'mail'],
    ['employees', 'loginEmail']
  ];
  for (const [collection, field] of lookups) {
    const found = await queryFirst(db, collection, field, account);
    if (found) return found;
  }
  return null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$16384$8$1$${salt}$${derived}`;
}

function verifyHash(password, encoded) {
  const parts = clean(encoded).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expected = Buffer.from(parts[5], 'hex');
  if (!N || !r || !p || !salt || !expected.length) return false;
  const actual = crypto.scryptSync(String(password), salt, expected.length, { N, r, p });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function legacyPassword(row) {
  for (const field of PASSWORD_FIELDS) {
    if (row[field] != null && String(row[field]) !== '') return String(row[field]);
  }
  return '';
}

function verifyPassword(password, row) {
  if (clean(row.passwordHash)) return { ok: verifyHash(password, row.passwordHash), migrate: false };
  const legacy = legacyPassword(row);
  if (!legacy) return { ok: false, migrate: false };
  const left = Buffer.from(String(password));
  const right = Buffer.from(legacy);
  return {
    ok: left.length === right.length && crypto.timingSafeEqual(left, right),
    migrate: true
  };
}

function accountStatus(row) {
  return lower(row.accountStatus || row.status || row['帳號狀態'] || 'active');
}

function isManager(row, collection) {
  const role = lower(row.role || row['角色']);
  return collection === 'admins' || ['admin', 'manager', '主管', '管理者'].includes(role) ||
    truthy(row.showSettingsZone || row['是否顯示設定區'] || row['可看設定區'] || row.canViewSettings || row.isAdmin || row.isManager);
}

function normalizeUser(account) {
  const row = account.data || {};
  const manager = isManager(row, account.collection);
  const identity = manager ? 'admin' : (lower(row.identityType || row['身分類型']) || (truthy(row.isPartTime || row['是否工讀生']) ? 'parttime' : 'staff'));
  const id = clean(row.employeeId || row.adminId || row.managerId || row['員工ID'] || row['管理者代碼'] || account.id);
  return {
    id,
    employeeId: clean(row.employeeId || row['員工ID'] || id),
    name: clean(row.name || row['姓名'] || '使用者'),
    email: lower(row.email || row.loginAccount || row.Email || row['登入帳號']),
    role: manager ? 'admin' : (lower(row.role || row['角色']) || 'staff'),
    identityType: identity,
    identityLabel: manager ? '管理者' : (identity === 'parttime' ? '工讀生' : (identity === 'external' ? '外聘老師' : '專職員工')),
    isPartTime: identity === 'parttime',
    isExternalTeacher: identity === 'external',
    isManagerAccount: manager,
    showSettingsZone: manager || truthy(row.showSettingsZone || row['是否顯示設定區'] || row['可看設定區']),
    showApprovalZone: manager || truthy(row.showApprovalZone || row['可看審核區']),
    canManageLeavePolicy: manager || truthy(row.canManageLeavePolicy || row['可操作假勤制度']),
    passwordResetRequired: row.passwordResetRequired === true,
    lineUserId: clean(row.lineUserId || row['LINE User ID']),
    lineNotifyEnabled: truthy(row.lineNotifyEnabled || row['LINE 通知啟用'])
  };
}

function authUid(account) {
  return `employee-${sha256(`${account.collection}|${account.id}`).slice(0, 40)}`;
}

async function ensureFirebaseAuthUser(account, email, password, user, manager) {
  const auth = admin.auth();
  let authUser;
  try {
    authUser = await auth.getUserByEmail(email);
    const update = { password: String(password) };
    if (clean(user && user.name)) update.displayName = clean(user.name);
    authUser = await auth.updateUser(authUser.uid, update);
  } catch (error) {
    if (!error || error.code !== 'auth/user-not-found') throw error;
    const create = {
      uid: authUid(account),
      email,
      password: String(password),
      emailVerified: false
    };
    if (clean(user && user.name)) create.displayName = clean(user.name);
    authUser = await auth.createUser(create);
  }
  const claims = Object.assign({}, authUser.customClaims || {}, {
    employee: true,
    manager,
    role: manager ? 'admin' : user.role,
    employeeId: user.employeeId,
    identityType: user.identityType,
    sourceCollection: account.collection
  });
  await auth.setCustomUserClaims(authUser.uid, claims);
  return authUser.uid;
}

async function updateFirebaseAuthPassword(email, password) {
  try {
    const auth = admin.auth();
    const authUser = await auth.getUserByEmail(email);
    await auth.updateUser(authUser.uid, { password: String(password) });
  } catch (error) {
    if (error && error.code === 'auth/user-not-found') return;
    throw error;
  }
}

function validateNewPassword(value) {
  const password = String(value || '');
  return password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

function passwordDeletePatch(passwordHash) {
  const patch = {
    passwordHash,
    passwordHashVersion: 1,
    passwordUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  PASSWORD_FIELDS.forEach((field) => { patch[field] = admin.firestore.FieldValue.delete(); });
  return patch;
}

function previousPasswordPatch(row) {
  const fields = PASSWORD_FIELDS.concat([
    'passwordHash',
    'passwordHashVersion',
    'passwordUpdatedAt',
    'passwordResetRequired',
    'passwordResetRequestedAt',
    'passwordResetRequestId',
    'passwordResetDeliveredAt'
  ]);
  const patch = {};
  fields.forEach((field) => {
    patch[field] = Object.prototype.hasOwnProperty.call(row, field)
      ? row[field]
      : admin.firestore.FieldValue.delete();
  });
  return patch;
}

async function authenticate(db, email, password, request, purpose) {
  const rate = await assertRateLimit(db, purpose, email, request);
  const account = await findAccount(db, email);
  if (!account) {
    await recordFailure(rate);
    return { ok: false, message: '帳號或密碼錯誤，請重新輸入。' };
  }
  const status = accountStatus(account.data);
  if (status === 'pending' || status === '待審核') {
    await recordFailure(rate);
    return { ok: false, message: '此帳號尚未通過主管審核。' };
  }
  if (status && !['active', 'enabled', '啟用', '是'].includes(status)) {
    await recordFailure(rate);
    return { ok: false, message: '此帳號目前無法登入。' };
  }
  const verified = verifyPassword(password, account.data);
  if (!verified.ok) {
    await recordFailure(rate);
    return { ok: false, message: '帳號或密碼錯誤，請重新輸入。' };
  }
  await clearFailures(rate);
  return { ok: true, account, migrate: verified.migrate };
}

function registerEmployeeAuth(exportsObject, helpers = {}) {
  const db = admin.firestore();

  exportsObject.employeeSecureLogin = onCall({ region: REGION, timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
    const data = (request && request.data) || {};
    const email = lower(data.email || data.account);
    const password = String(data.password || '');
    if (!email || !password) return { ok: false, message: '請輸入帳號與密碼。' };
    const result = await authenticate(db, email, password, request, 'login');
    if (!result.ok) return result;
    const { account } = result;
    if (result.migrate) {
      await account.ref.set(passwordDeletePatch(hashPassword(password)), { merge: true });
    }
    const user = normalizeUser(account);
    const manager = isManager(account.data, account.collection);
    await account.ref.set({ lastLoginAt: admin.firestore.FieldValue.serverTimestamp(), lastLoginSource: 'employeeSecureLogin' }, { merge: true });
    await ensureFirebaseAuthUser(account, email, password, user, manager);
    return {
      ok: true,
      message: manager ? '管理者登入成功' : '登入成功',
      user,
      authMode: 'email-password',
      authEmail: email,
      passwordMigrated: result.migrate
    };
  });

  exportsObject.employeeChangePassword = onCall({ region: REGION, timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
    const data = (request && request.data) || {};
    const email = lower(data.email);
    const oldPassword = String(data.oldPassword || '');
    const newPassword = String(data.newPassword || '');
    if (newPassword !== String(data.confirmPassword || '')) return { ok: false, message: '兩次新密碼不一致。' };
    if (!validateNewPassword(newPassword)) return { ok: false, message: '新密碼至少 8 碼，並包含英文大寫、小寫與數字。' };
    const result = await authenticate(db, email, oldPassword, request, 'change-password');
    if (!result.ok) return result;
    await result.account.ref.set(Object.assign(passwordDeletePatch(hashPassword(newPassword)), {
      passwordResetRequired: false,
      passwordResetRequestId: admin.firestore.FieldValue.delete(),
      passwordResetCompletedAt: admin.firestore.FieldValue.serverTimestamp()
    }), { merge: true });
    await updateFirebaseAuthPassword(email, newPassword);
    return { ok: true, message: '密碼已更新，請使用新密碼登入。' };
  });

  exportsObject.employeeForgotPassword = onCall({ region: REGION, timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
    const data = (request && request.data) || {};
    const email = lower(data.email);
    if (!email) return { ok: false, message: '請先輸入 Email。' };
    const rate = await assertRateLimit(db, 'forgot-password', email, request);
    await recordFailure(rate);
    const account = await findAccount(db, email);
    if (!account) {
      return { ok: true, message: '如果帳號存在，暫時密碼會寄到該信箱。' };
    }
    if (typeof helpers.sendEmail !== 'function') throw new HttpsError('failed-precondition', '寄信服務尚未設定。');
    const temporaryPassword = `Yz${crypto.randomBytes(5).toString('hex')}A1`;
    const resetRequestId = crypto.randomBytes(12).toString('hex');
    const rollbackPatch = previousPasswordPatch(account.data);
    await account.ref.set(Object.assign(passwordDeletePatch(hashPassword(temporaryPassword)), {
      passwordResetRequired: true,
      passwordResetRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
      passwordResetRequestId: resetRequestId
    }), { merge: true });
    try {
      await helpers.sendEmail({
        channel: 'email',
        targetEmail: email,
        title: '柚子樂器系統暫時密碼',
        body: `您的暫時密碼是：${temporaryPassword}\n\n登入後請立即修改密碼。`
      });
    } catch (error) {
      console.error('[employeeForgotPassword email failed]', error);
      try {
        await db.runTransaction(async (transaction) => {
          const latest = await transaction.get(account.ref);
          if (!latest.exists || clean((latest.data() || {}).passwordResetRequestId) !== resetRequestId) return;
          transaction.set(account.ref, rollbackPatch, { merge: true });
        });
      } catch (rollbackError) {
        console.error('[employeeForgotPassword rollback failed]', rollbackError);
      }
      throw new HttpsError('internal', '暫時密碼寄送失敗，請稍後再試或聯絡管理者。');
    }
    await account.ref.set({
      passwordResetRequestId: admin.firestore.FieldValue.delete(),
      passwordResetDeliveredAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { ok: true, message: '暫時密碼已寄到您的 Email。' };
  });
}

module.exports = { registerEmployeeAuth };
