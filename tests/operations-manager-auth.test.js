'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const Auth = require('../operations-manager-auth.js');
const EasyStoreAuth = require('../functions/easystoreCatalogSync.js');

function memoryStorage(values) {
  const rows = new Map(Object.entries(values || {}));
  return {
    getItem(key) { return rows.has(key) ? rows.get(key) : null; },
    setItem(key, value) { rows.set(key, String(value)); },
    removeItem(key) { rows.delete(key); },
    has(key) { return rows.has(key); }
  };
}

test('EasyStore sync accepts the same manager claims as the operations auth bridge', () => {
  const accepted = [
    { manager: true },
    { admin: true },
    { owner: true },
    { role: 'manager' },
    { role: '管理者' },
    { email: 'danny700808@gmail.com' }
  ];
  accepted.forEach((claims) => {
    assert.equal(Auth.claimsAllowManager(claims, {}), true);
    assert.equal(EasyStoreAuth.managerClaimsAllowed(claims), true);
    assert.equal(EasyStoreAuth.isAllowedCaller({ auth: { token: claims } }), true);
  });

  const staff = { employee: true, role: 'staff', email: 'staff@example.com' };
  assert.equal(Auth.claimsAllowManager(staff, {}), false);
  assert.equal(EasyStoreAuth.managerClaimsAllowed(staff), false);
  assert.equal(EasyStoreAuth.isAllowedCaller({ auth: { token: staff } }), false);
  assert.equal(EasyStoreAuth.isAllowedCaller({}), false);
});

test('operations auth waits for Firebase restore and force-refreshes claims', async () => {
  let forced = null;
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

  assert.equal(result.ok, true);
  assert.equal(forced, true);
});

test('missing Firebase session requests one safe login redirect back to products', async () => {
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
    location: {
      pathname: '/play-card/portal.html',
      replace(value) { redirects.push(value); }
    }
  };

  assert.equal(await Auth.redirectToLoginOnce(runtime, auth, 1000), true);
  assert.deepEqual(redirects, ['login.html?next=portal.html%23products']);
  assert.equal(signOutCount, 1);
  assert.equal(localStorage.has('employeeUser'), false);
  assert.equal(localStorage.has('employeeSecureAuthVersion'), false);
  assert.equal(localStorage.has('employeeSavedLogin'), true);
  assert.equal(await Auth.redirectToLoginOnce(runtime, auth, 2000), false);
});

test('both operations entries load auth before the protected sync code', () => {
  for (const file of ['portal.html', 'operations-hub.html']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const authIndex = source.indexOf('operations-manager-auth.js?v=');
    const operationsIndex = source.indexOf('operations-phase1.js?v=');
    assert.ok(authIndex >= 0, `${file} must load operations manager auth`);
    assert.ok(operationsIndex > authIndex, `${file} must load manager auth before operations code`);
  }

  const login = fs.readFileSync(path.join(root, 'login.html'), 'utf8');
  assert.match(login, /'portal\.html#products'/);
  assert.match(login, /'operations-hub\.html#products'/);
  assert.match(login, /return loginReturnPages\.has\(value\) \? value : '';/);
});

test('EasyStore sync refreshes manager auth before opening the callable', () => {
  const source = fs.readFileSync(path.join(root, 'operations-phase1.js'), 'utf8');
  const authSource = fs.readFileSync(path.join(root, 'operations-manager-auth.js'), 'utf8');
  const start = source.indexOf('async function syncEasyStoreApi()');
  const end = source.indexOf('function limitText', start);
  const body = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(body.indexOf('await requireEasyStoreManagerAuth()') < body.indexOf("httpsCallable('syncEasyStoreCatalog'"));
  assert.match(authSource, /getIdTokenResult\(true\)/);
});
