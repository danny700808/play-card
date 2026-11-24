const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const sharp = require('../functions/node_modules/sharp');
const { makeActions } = require('../functions/parttimeOnboarding');

function fixture() {
  let next = 0;
  const records = new Map();
  const snap = ref => ({ id: ref.id, ref, exists: records.has(ref.key), data: () => records.get(ref.key) });
  const doc = (name, id = String(++next).padStart(20, '0')) => {
    const ref = { id, key: name + '/' + id, get: async () => snap(ref) };
    return ref;
  };
  const db = {
    collection(name) {
      const query = (field, expected) => ({
        get: async () => {
          const docs = [...records.keys()].filter(key => key.startsWith(name + '/') &&
            records.get(key)[field] === expected).map(key => snap(doc(name, key.split('/')[1])));
          return { docs, forEach: callback => docs.forEach(callback) };
        },
        limit() { return this; },
        select() { return this; }
      });
      return { doc: id => doc(name, id), where: (field, _, value) => query(field, value) };
    },
    batch() {
      const writes = [];
      return {
        set(ref, value, options) {
          writes.push(() => records.set(ref.key, options?.merge ? { ...records.get(ref.key), ...value } : value));
        },
        async commit() { writes.forEach(write => write()); }
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const tx = {
        get: ref => ref.get(),
        set: (ref, value) => writes.push(() => records.set(ref.key, value)),
        create: (ref, value) => writes.push(() => records.set(ref.key, value)),
        update: (ref, value) => writes.push(() => records.set(ref.key, { ...records.get(ref.key), ...value })),
        delete: ref => writes.push(() => records.delete(ref.key))
      };
      await callback(tx);
      writes.forEach(write => write());
    }
  };
  const handle = makeActions(db, { serverTimestamp: Date.now }, async () => null);
  const call = (action, payload = {}, auth) => handle({ ...payload, action }, { auth });
  return { db, records, call };
}

const basic = { name: '測試', email: 'onboarding@example.test', birthDate: '2001-01-01',
  mobilePhone: '0000000000', householdAddress: '測試', contactAddress: '測試',
  emergencyContact: '測試', emergencyPhone: '0000000000' };
const employee = id => ({ token: { employee: true, employeeId: id } });
const manager = { token: { employee: true, employeeId: 'manager', manager: true } };

test('basic data can enter parttime review after email verification without storing any identity details', async () => {
  const { records, call } = fixture();
  const result = await call('register', { ...basic, idNumber: 'discard', role: 'admin', notificationPreference: 'both' });
  assert.equal(result.deferredIdentity, true);
  assert.match(result.employeeBindText, /^柚子人員綁定 EMP-[0-9A-F]{8}$/);
  const [key, row] = [...records.entries()].find(([key]) => key.startsWith('registrationApplications/'));
  assert.equal(row.idNumber, undefined);
  assert.equal(row.role, undefined);
  assert.equal(row.applicationStatus, 'waiting_verification');
  const queue = [...records.values()].find(value => value.channel === 'email');
  const url = new URL(queue.body.split('\n').at(-1));
  const data = Object.fromEntries(url.searchParams);
  await assert.rejects(call('verifyEmail', { ...data, token: 'a'.repeat(48) }), { code: 'invalid-argument' });
  await call('verifyEmail', data);
  assert.equal(records.get(key).applicationStatus, 'pending_setup');
  assert.equal(records.get(key).emailBindStatus, 'bound');
  await assert.rejects(call('register', basic), { code: 'already-exists' });
});

test('signed-in employee can supplement privately and manager can return or verify without changing pay', async () => {
  const { records, call } = fixture();
  records.set('employees/pt', { name: '測試', identityType: 'parttime', accountStatus: 'active',
    parttimeIdentityDeferred: true, identityVerificationStatus: 'missing', hourlyRate: 200 });
  const image = (await sharp({ create: { width: 64, height: 48, channels: 3, background: '#e0daca' } }).jpeg().toBuffer()).toString('base64');
  const doc = { idNumber: 'A000000000', identityDocumentType: 'national_id', consent: true, image };
  assert.deepEqual(await call('status', {}, employee('pt')), { ok: true, status: 'missing', note: '' });
  await assert.rejects(call('submit', doc, employee('other')), { code: 'permission-denied' });
  await call('submit', { ...doc, id: 'other' }, employee('pt'));
  assert.equal((await call('status', {}, employee('pt'))).status, 'submitted');
  await assert.rejects(call('detail', { id: 'pt' }, employee('pt')), { code: 'permission-denied' });
  assert.deepEqual((await call('list', {}, manager)).rows, [{ id: 'pt', name: '測試' }]);
  assert.equal((await call('detail', { id: 'pt' }, manager)).image, image);
  await assert.rejects(call('submit', doc, employee('pt')), { code: 'failed-precondition' });
  await call('return', { id: 'pt', note: '重拍' }, manager);
  assert.equal((await call('status', {}, employee('pt'))).note, '重拍');
  await call('submit', doc, employee('pt'));
  await call('approve', { id: 'pt' }, manager);
  assert.equal((await call('status', {}, employee('pt'))).status, 'verified');
  assert.equal(records.get('employees/pt').hourlyRate, 200);
  assert.equal(records.get('employees/pt').idNumber, doc.idNumber);
});

test('only a deferred parttime application bypasses evidence at initial manager setup', () => {
  const window = { YZFirebase: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../onboarding-workflow.js'), 'utf8'), { window });
  const draft = { identityType: 'parttime', startDate: '2026-11-24', hourlyRate: 200, averageSalary: 4000,
    salaryEffectiveDate: '2026-11-24', laborStatus: '未投保', healthStatus: '未投保', scheduleMode: 'none' };
  const app = { parttimeIdentityDeferred: true, notificationPreference: 'email', emailBindStatus: 'bound' };
  const missing = window.YZOnboarding.onboardingMissing;
  assert.equal(missing(app, draft).length, 0);
  assert.match(missing({ ...app, emailBindStatus: 'pending' }, draft).join(), /Email/);
  assert.match(missing({ ...app, parttimeIdentityDeferred: false }, draft).join(), /缺少證件/);
  assert.match(missing(app, { ...draft, identityType: 'staff' }).join(), /缺少證件/);
  assert.match(missing(app, { ...draft, hourlyRate: 0 }).join(), /時薪/);
});

test('manager approval creates salary and leaves the evidence marked missing on the active employee', async () => {
  const { db, records, call } = fixture();
  await call('register', { ...basic, notificationPreference: 'email' });
  const queue = [...records.values()].find(value => value.channel === 'email');
  const link = new URL(queue.body.split('\n').at(-1));
  await call('verifyEmail', Object.fromEntries(link.searchParams));
  const window = {
    YZFirebase: { init: () => db },
    firebase: { firestore: { FieldValue: { serverTimestamp: Date.now, arrayUnion: value => value } } },
    location: { href: 'https://example.test/registration-approval.html' },
    localStorage: { getItem: () => JSON.stringify({ id: 'manager' }) },
    crypto: require('node:crypto').webcrypto
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../onboarding-workflow.js'), 'utf8'), { window, URL });
  const result = await window.YZFirebase.handleApi('approveRegistrationOnboarding', {
    applicationId: link.searchParams.get('applicationId'),
    onboardingDraft: { identityType: 'parttime', startDate: '2026-11-24', hourlyRate: 200, averageSalary: 4000,
      salaryEffectiveDate: '2026-11-24', laborStatus: '未投保', healthStatus: '未投保', scheduleMode: 'none' }
  });
  assert.equal(result.ok, true);
  assert.equal(records.get('employees/' + result.employeeId).accountStatus, 'active');
  assert.equal(records.get('employees/' + result.employeeId).identityDocumentVerified, false);
  assert.equal(records.get('employeeSalaryConfigs/' + result.employeeId).hourlyRate, 200);
  assert.equal((await call('status', {}, employee(result.employeeId))).status, 'missing');
});
