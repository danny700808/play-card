'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const manager = { id: 'ADMIN-1', email: 'manager@example.test', role: 'admin' };
const claims = { manager: true, employee: true, employeeId: manager.id, email: manager.email };

function fixture(options = {}) {
  const values = new Map(Object.entries({ employeeUser: JSON.stringify(manager), employeeUserId: manager.id, employeeSecureAuthVersion: '1' }));
  const redirects = [], timers = new Set();
  let signOuts = 0, unsubscribes = 0;
  const user = { uid: 'firebase-1', email: manager.email, getIdTokenResult: async () => ({ claims }) };
  const auth = {
    currentUser: options.slow ? null : user,
    onAuthStateChanged(callback) { if (!options.slow) queueMicrotask(() => callback(auth.currentUser)); return () => { unsubscribes++; }; },
    async signOut() { signOuts++; auth.currentUser = null; }
  };
  const runtime = {
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { pathname: '/play-card/portal.html', hash: '#overview', replace: value => redirects.push(value) },
    firebase: { apps: [{}], auth: () => auth },
    setTimeout(callback) { timers.add(callback); return callback; },
    clearTimeout(callback) { timers.delete(callback); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'manager-auth.js'), 'utf8'), { window: runtime });
  return { runtime, api: runtime.YZManagerAuth, user, auth, values, redirects, timers,
    signOuts: () => signOuts, unsubscribes: () => unsubscribes,
    expireWait() { for (const timer of [...timers]) timer(); }
  };
}

test('slow auth restoration preserves the shared login and a later retry succeeds', async () => {
  const f = fixture({ slow: true });
  const pending = f.api.requireManager();
  f.expireWait();
  await assert.rejects(pending, error => error.code === 'auth/restore-timeout');
  assert.equal(f.values.get('employeeUserId'), manager.id);
  assert.deepEqual(f.redirects, []);
  assert.equal(f.unsubscribes(), 1);
  f.auth.currentUser = f.user;
  f.auth.onAuthStateChanged = callback => { callback(f.user); return () => {}; };
  assert.equal((await f.api.requireManager()).id, manager.id);
});

test('a network error during token refresh preserves login and is retryable', async () => {
  const f = fixture();
  f.user.getIdTokenResult = async () => { throw Object.assign(new Error('offline'), { code: 'auth/network-request-failed' }); };
  await assert.rejects(f.api.requireManager());
  assert.deepEqual(f.redirects, []);
  assert.equal(f.values.get('employeeSecureAuthVersion'), '1');
  f.user.getIdTokenResult = async () => ({ claims });
  assert.equal((await f.api.requireManager()).id, manager.id);
});

test('an unloaded SDK or unavailable browser storage cannot clear the shared login', async () => {
  const f = fixture();
  f.runtime.firebase = null;
  await assert.rejects(f.api.requireManager());
  assert.deepEqual(f.redirects, []);
  assert.equal(f.values.get('employeeUserId'), manager.id);
  f.runtime.firebase = { apps: [{}], auth: () => f.auth };
  f.runtime.localStorage.setItem = () => { throw new Error('storage unavailable'); };
  await assert.rejects(f.api.requireManager());
  assert.deepEqual(f.redirects, []);
  assert.equal(f.values.get('employeeUserId'), manager.id);
});

test('a confirmed missing or revoked login still requires authentication', async () => {
  for (const missing of [true, false]) {
    const f = fixture();
    if (missing) f.auth.currentUser = null;
    else f.user.getIdTokenResult = async () => { throw Object.assign(new Error('revoked'), { code: 'auth/user-token-expired' }); };
    await assert.rejects(f.api.requireManager({ next: 'portal.html#overview' }));
    assert.equal(f.values.has('employeeUser'), false);
    assert.equal(f.redirects[0], 'login.html?next=portal.html%23overview');
    assert.equal(f.signOuts(), 0);
  }
});

test('a permission denial never grants manager access or logs out the other tabs', async () => {
  const f = fixture();
  f.user.getIdTokenResult = async () => ({ claims: { employee: true, role: 'staff', email: manager.email } });
  await assert.rejects(f.api.requireManager(), /沒有管理者權限/);
  assert.deepEqual(f.redirects, []);
  assert.equal(f.values.get('employeeUserId'), manager.id);
});

test('a delayed failure from an old account cannot erase a newer login', async () => {
  const f = fixture();
  let rejectToken;
  f.user.getIdTokenResult = () => new Promise((_, reject) => { rejectToken = reject; });
  const pending = f.api.requireManager();
  await new Promise(resolve => setImmediate(resolve));
  f.auth.currentUser = { uid: 'firebase-2' };
  f.values.set('employeeUserId', 'ADMIN-2');
  f.values.set('employeeUser', JSON.stringify({ id: 'ADMIN-2', role: 'admin' }));
  rejectToken(Object.assign(new Error('old token revoked'), { code: 'auth/user-token-expired' }));
  await assert.rejects(pending);
  assert.deepEqual(f.redirects, []);
  assert.equal(f.values.get('employeeUserId'), 'ADMIN-2');
  assert.equal(f.signOuts(), 0);
});

test('an account switch during verification cannot write the old identity back', async () => {
  const f = fixture();
  f.user.getIdTokenResult = async () => { f.auth.currentUser = { uid: 'firebase-2' }; return { claims }; };
  await assert.rejects(f.api.requireManager(), error => error.code === 'auth/session-changed');
  assert.deepEqual(f.redirects, []);
});

test('concurrent manager checks accept the same verified identity', async () => {
  const f = fixture();
  const results = await Promise.all([f.api.requireManager(), f.api.requireManager(), f.api.requireManager()]);
  assert.equal(results.length, 3);
  assert.ok(results.every(result => result.id === manager.id));
  assert.deepEqual(f.redirects, []);
});

test('an old open form cannot run under a newly selected account', async () => {
  const f = fixture();
  await assert.rejects(f.api.requireManagerSession({ expectedManager: { ...manager, id: 'OLD-ADMIN' } }), error => error.code === 'auth/session-changed');
  assert.deepEqual(f.redirects, []);
  assert.equal(f.values.get('employeeUserId'), manager.id);
});

test('a remembered teacher session cannot replace an active manager login', () => {
  const f = fixture();
  f.values.set('youzi.coursePortal.teacher.session.v1', 'teacher-session');
  vm.runInNewContext(fs.readFileSync(path.join(root, 'teacher-more-auth-bridge.js'), 'utf8'), { window: f.runtime, URLSearchParams });
  assert.equal(f.runtime.YZTeacherMoreAuth.blockIfPortalOnly(), false);
  assert.equal(f.values.get('employeeUserId'), manager.id);
});

for (const file of ['operations-manager-auth.js', 'line-binding-admin.js']) {
  const bridge = require(path.join(root, file));
  test(`${file}: slow restoration is not a logout`, async () => {
    const f = fixture({ slow: true });
    const pending = bridge.ensureManagerAuth(f.runtime, manager);
    f.expireWait();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.reauth, false);
    assert.equal(f.values.get('employeeUserId'), manager.id);
  });
  test(`${file}: stale tab identity blocks access without logging out the active account`, async () => {
    const f = fixture();
    const result = await bridge.ensureManagerAuth(f.runtime, { ...manager, id: 'OLD-ADMIN' });
    assert.equal(result.ok, false);
    assert.equal(result.reauth, false);
    assert.equal(f.signOuts(), 0);
  });
  test(`${file}: automatic redirect does not sign out all browser tabs`, async () => {
    const f = fixture();
    await bridge.redirectToLoginOnce(f.runtime, f.auth);
    assert.equal(f.signOuts(), 0);
    assert.equal(f.values.get('employeeUserId'), manager.id);
  });
  test(`${file}: an obsolete redirect cannot clear a login completed in another tab`, async () => {
    const f = fixture();
    f.auth.currentUser = null;
    const result = await bridge.ensureManagerAuth(f.runtime, manager);
    assert.equal(result.reauth, true);
    f.values.set('employeeUser', JSON.stringify({ id: 'ADMIN-2', role: 'admin' }));
    f.values.set('employeeUserId', 'ADMIN-2');
    assert.equal(await bridge.redirectToLoginOnce(f.runtime, f.auth, undefined, result.session), false);
    assert.deepEqual(f.redirects, []);
    assert.equal(f.values.get('employeeUserId'), 'ADMIN-2');
  });
}
