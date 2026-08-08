'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const Auth = require('../line-binding-admin.js');

function memoryStorage(values) {
  const rows = new Map(Object.entries(values || {}));
  return {
    getItem(key) { return rows.has(key) ? rows.get(key) : null; },
    setItem(key, value) { rows.set(key, String(value)); },
    removeItem(key) { rows.delete(key); },
    has(key) { return rows.has(key); }
  };
}

test('manager claims match the protected backend policy', () => {
  assert.equal(Auth.claimsAllowManager({ manager: true }, {}), true);
  assert.equal(Auth.claimsAllowManager({ role: 'owner' }, {}), true);
  assert.equal(Auth.claimsAllowManager({ email: 'danny700808@gmail.com' }, {}), true);
  assert.equal(Auth.claimsAllowManager({ employee: true, role: 'staff' }, { email: 'staff@example.com' }), false);

  assert.equal(Auth.localManagerAllowed({ showSettingsZone: true, role: 'staff' }), true);
  assert.equal(Auth.localManagerAllowed({ showSettingsZone: '是', role: 'staff' }), true);
  assert.equal(Auth.localManagerAllowed({ role: 'manager' }), true);
  assert.equal(Auth.localManagerAllowed({ role: 'staff' }), false);
});

test('auth bridge waits for restore and force-refreshes manager claims', async () => {
  let forced = null;
  let unsubscribed = false;
  const firebaseUser = {
    email: 'admin@example.com',
    async getIdTokenResult(forceRefresh) {
      forced = forceRefresh;
      return { claims: { email: 'admin@example.com', manager: true, employeeId: 'ADMIN-1' } };
    }
  };
  const auth = {
    currentUser: firebaseUser,
    onAuthStateChanged(callback) {
      queueMicrotask(() => callback(firebaseUser));
      return () => { unsubscribed = true; };
    }
  };
  const runtime = {
    firebase: { auth: () => auth },
    setTimeout,
    clearTimeout
  };

  const result = await Auth.ensureManagerAuth(runtime, {
    id: 'ADMIN-1',
    employeeId: 'ADMIN-1',
    email: 'admin@example.com',
    role: 'admin',
    showSettingsZone: true
  }, { timeoutMs: 1000 });

  assert.equal(result.ok, true);
  assert.equal(forced, true);
  assert.equal(unsubscribed, true);
});

test('missing Firebase session requests reauthentication without calling the backend', async () => {
  const auth = {
    currentUser: null,
    onAuthStateChanged(callback) {
      queueMicrotask(() => callback(null));
      return () => {};
    }
  };
  const result = await Auth.ensureManagerAuth({
    firebase: { auth: () => auth },
    setTimeout,
    clearTimeout
  }, {
    email: 'admin@example.com',
    role: 'admin',
    showSettingsZone: true
  }, { timeoutMs: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reauth, true);
  assert.equal(result.reason, 'firebase-session-missing');
});

test('local and Firebase manager identities must not disagree', async () => {
  const firebaseUser = {
    email: 'other-admin@example.com',
    async getIdTokenResult() {
      return { claims: { email: 'other-admin@example.com', manager: true, employeeId: 'ADMIN-2' } };
    }
  };
  const auth = {
    currentUser: firebaseUser,
    onAuthStateChanged(callback) {
      queueMicrotask(() => callback(firebaseUser));
      return () => {};
    }
  };
  const result = await Auth.ensureManagerAuth({
    firebase: { auth: () => auth },
    setTimeout,
    clearTimeout
  }, {
    employeeId: 'ADMIN-1',
    email: 'admin@example.com',
    role: 'admin',
    showSettingsZone: true
  }, { timeoutMs: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.reauth, true);
  assert.equal(result.reason, 'manager-claim-mismatch');
});

test('expired split auth clears shell state and redirects automatically only once', async () => {
  const localStorage = memoryStorage({
    employeeUser: '{"role":"admin"}',
    employeeUserId: 'ADMIN-1',
    employeeSecureAuthVersion: '1',
    employeePortalMode: 'settings',
    employeeSavedLogin: '{"email":"admin@example.com"}'
  });
  const sessionStorage = memoryStorage();
  const redirects = [];
  let signOutCount = 0;
  const auth = {
    currentUser: { uid: 'firebase-user' },
    async signOut() { signOutCount += 1; }
  };
  const runtime = {
    localStorage,
    sessionStorage,
    location: { replace(value) { redirects.push(value); } }
  };

  assert.equal(await Auth.redirectToLoginOnce(runtime, auth, 1000), true);
  assert.deepEqual(redirects, ['login.html?next=line-binding-admin.html']);
  assert.equal(signOutCount, 1);
  assert.equal(localStorage.has('employeeUser'), false);
  assert.equal(localStorage.has('employeeUserId'), false);
  assert.equal(localStorage.has('employeeSecureAuthVersion'), false);
  assert.equal(localStorage.has('employeePortalMode'), false);
  assert.equal(localStorage.has('employeeSavedLogin'), true);

  assert.equal(await Auth.redirectToLoginOnce(runtime, auth, 2000), false);
  assert.equal(redirects.length, 1);
  assert.equal(signOutCount, 1);
});

test('normal manager login accepts only the allowlisted local return page', () => {
  const source = fs.readFileSync(path.join(root, 'login.html'), 'utf8');
  assert.match(source, /const loginReturnPages = new Set\(\[[\s\S]*'line-binding-admin\.html'[\s\S]*\]\);/);
  assert.match(source, /\^\[a-z0-9\._-\]\+\\\.html/);
  assert.match(source, /const page = value\.split\(\/\[\?\#\]\//);
  assert.match(source, /return loginReturnPages\.has\(page\) \? value : '';/);
  assert.doesNotMatch(source, /window\.location\.replace\(new URLSearchParams[^)]*next/);
});
