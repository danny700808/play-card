'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const work = require(path.join(root, 'functions', 'externalTeacherWork.js'));

test('external teacher V2 uses collections that cannot collide with legacy staff work', () => {
  assert.deepEqual(work.COLLECTIONS, {
    announcements: 'externalTeacherAnnouncementsV2',
    announcementViews: 'externalTeacherAnnouncementViewsV2',
    tasks: 'externalTeacherTasksV2',
    taskResponses: 'externalTeacherTaskResponsesV2'
  });
  const source = fs.readFileSync(path.join(root, 'functions', 'externalTeacherWork.js'), 'utf8');
  assert.doesNotMatch(source, /db\.collection\('(announcements|announcementViews|tasks|taskResponses)'\)/);
  assert.match(source, /audience:\s*\['external'\]/);
  assert.match(source, /previousSnapshotIds/);
  assert.match(source, /repliesByAnnouncement/);
});

test('profile drafts remain visible but terminal and replaced people do not', () => {
  assert.equal(work.inactiveEmployee({
    active: false,
    identityType: 'external',
    personLifecycleStatus: 'profile_draft'
  }), false);
  assert.equal(work.inactiveEmployee({
    active: false,
    identityType: 'external',
    personLifecycleStatus: 'pending_review'
  }), false);
  assert.equal(work.employeeStatusLabel({ personLifecycleStatus: 'profile_draft' }), '資料填寫中');
  assert.equal(work.employeeStatusLabel({ personLifecycleStatus: 'pending_review' }), '待管理者確認');
  assert.equal(work.employeeStatusLabel({ personLifecycleStatus: 'active' }), '資料未齊全');
  assert.equal(work.employeeStatusLabel({ name: '林老師', personLifecycleStatus: 'active' }), '合作中');
  assert.equal(work.inactiveEmployee({ active: false, personLifecycleStatus: 'inactive' }), true);
  assert.equal(work.inactiveEmployee({ active: true, coursePortalTeacherCanonicalReplaced: true }), true);
});

test('only current employee or Course Portal LINE bindings may feed V2 notifications', () => {
  assert.equal(work.canonicalEmployeeBinding({
    targetCollection: 'employees',
    employeeId: 'EMP-001',
    lineUserId: 'U-NEW',
    status: 'bound',
    source: 'profile-ensure-bind-code'
  }), true);
  assert.equal(work.canonicalEmployeeBinding({
    targetCollection: 'externalTeacherContracts',
    employeeId: 'EMP-001',
    externalTeacherContractId: 'EXT-OLD',
    lineUserId: 'U-OLD',
    status: 'bound'
  }), false);
  assert.equal(work.canonicalEmployeeBinding({
    targetCollection: 'employees',
    employeeId: 'EMP-001',
    externalTeacherContractId: 'EXT-OLD',
    lineUserId: 'U-OLD',
    status: 'bound',
    source: 'external-teacher-renewal-binding'
  }), false);
});

test('all-external work matches teachers but never internal staff', () => {
  const row = { assigneeMode: 'all_external', assigneeIds: ['EMP-T'] };
  assert.equal(work.taskMatchesIdentity(row, { external: true, employeeId: 'EMP-T' }), true);
  assert.equal(work.taskMatchesIdentity(row, { external: true, employeeId: 'EMP-LATER' }), false);
  assert.equal(work.taskMatchesIdentity(row, { external: false, employeeId: 'EMP-S' }), false);
});

test('new LINE runtime never falls back to a retired token or unsigned webhook', () => {
  const source = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
  const tokenStart = source.indexOf('async function resolveLineAccessToken()');
  const tokenEnd = source.indexOf('async function getLineAccessToken()', tokenStart);
  const tokenFlow = source.slice(tokenStart, tokenEnd);
  assert.match(tokenFlow, /process\.env\.LINE_CHANNEL_ACCESS_TOKEN/);
  assert.doesNotMatch(tokenFlow, /systemSettings|LINE_MESSAGING_ACCESS_TOKEN|LINE_BOT_CHANNEL_ACCESS_TOKEN/);
  assert.match(source, /createHmac\('sha256', secret\)\.update\(rawBody\)/);
  assert.match(source, /if \(!validLineWebhookSignature\(req\)\)/);

  const onboardingSource = fs.readFileSync(
    path.join(root, 'functions', 'externalTeacherOnboarding.js'),
    'utf8'
  );
  const onboardingTokenStart = onboardingSource.indexOf('async function getLineAccessToken()');
  const onboardingTokenEnd = onboardingSource.indexOf('function normalizeTeachingText', onboardingTokenStart);
  const onboardingTokenFlow = onboardingSource.slice(onboardingTokenStart, onboardingTokenEnd);
  assert.match(onboardingTokenFlow, /process\.env\.LINE_CHANNEL_ACCESS_TOKEN/);
  assert.doesNotMatch(
    onboardingTokenFlow,
    /systemSettings|LINE_MESSAGING_ACCESS_TOKEN|LINE_ACCESS_TOKEN|LINE_BOT_CHANNEL_ACCESS_TOKEN/
  );
});

test('production workflow deploys the V2 work endpoint and only the canonical LINE token', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'deploy-course-portal-auth.yml'),
    'utf8'
  );
  assert.match(workflow, /functions:externalTeacherWork/);
  assert.match(workflow, /functions:sendNotificationQueueOnCreate/);
  assert.match(workflow, /functions:flushNotificationQueue/);
  assert.match(workflow, /LINE_CHANNEL_ACCESS_TOKEN:\s*\$\{\{ secrets\.LINE_CHANNEL_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /LINE_CHANNEL_SECRET:\s*\$\{\{ secrets\.LINE_CHANNEL_SECRET \}\}/);
  assert.match(workflow, /functions:secrets:access LINE_CHANNEL_SECRET/);
  assert.match(workflow, /functions:secrets:set LINE_CHANNEL_SECRET/);
  assert.doesNotMatch(workflow, /\bLINE_MESSAGING_ACCESS_TOKEN\b|\bLINE_ACCESS_TOKEN\b/);
});

function loadManagerAuth(options = {}) {
  const source = fs.readFileSync(path.join(root, 'manager-auth.js'), 'utf8');
  const values = new Map(Object.entries(options.storage || {}));
  const redirects = [];
  const firebaseUser = options.firebaseUser === undefined ? {
    uid: 'firebase-manager',
    email: 'manager@example.com',
    displayName: '主管',
    async getIdTokenResult() {
      return { claims: { manager: true, employeeId: 'ADMIN-1', email: 'manager@example.com' } };
    }
  } : options.firebaseUser;
  const auth = {
    currentUser: firebaseUser,
    onAuthStateChanged(success) {
      success(firebaseUser);
      return () => {};
    }
  };
  const window = {
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    },
    location: {
      pathname: '/announcement-admin.html',
      search: '?audience=external&source=teacher-hub',
      replace(value) { redirects.push(value); }
    },
    APP_CONFIG: { FIREBASE_CONFIG: { projectId: 'fixture' } },
    firebase: {
      apps: [{}],
      auth() { return auth; },
      initializeApp() {}
    },
    setTimeout,
    clearTimeout
  };
  const context = vm.createContext({ window, Set, String, JSON, Math, Promise });
  new vm.Script(source, { filename: 'manager-auth.js' }).runInContext(context);
  return { auth: window.YZManagerAuth, values, redirects };
}

test('manager subpages restore Firebase auth without sending an active manager to LINE login', async () => {
  const runtime = loadManagerAuth({
    storage: {
      employeeUser: JSON.stringify({ id: 'ADMIN-1', email: 'manager@example.com', role: 'admin', showSettingsZone: true })
    }
  });
  const manager = await runtime.auth.requireManager({ next: 'announcement-admin.html?audience=external&source=teacher-hub' });
  assert.equal(manager.employeeId, 'ADMIN-1');
  assert.equal(runtime.values.get('employeeSecureAuthVersion'), '1');
  assert.deepEqual(runtime.redirects, []);
});

test('an actually expired manager session returns to password login and keeps the requested page', async () => {
  const runtime = loadManagerAuth({
    firebaseUser: null,
    storage: {
      employeeUser: JSON.stringify({ employeeId: 'EXT-DRAFT', portalSessionBridge: true }),
      employeeUserId: 'EXT-DRAFT'
    }
  });
  await assert.rejects(
    () => runtime.auth.requireManager({ next: 'task.html?mode=admin&identity=external&source=teacher-hub' }),
    /管理者安全登入已失效/
  );
  assert.equal(runtime.values.has('employeeUser'), false);
  assert.equal(runtime.redirects.length, 1);
  assert.match(runtime.redirects[0], /^login\.html\?next=/);
  assert.match(decodeURIComponent(runtime.redirects[0]), /task\.html\?mode=admin&identity=external&source=teacher-hub/);
});
