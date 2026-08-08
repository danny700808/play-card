'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const configSource = read('config.js');
const portalSource = read('course-portal.html');
const rentalSource = read('room-booking-v2.js');
const commonSource = read('course-portal-common.js');
const teacherSource = read('teacher-course-portal-v8.js');
const studentSource = read('student-course-portal.html');

new vm.Script(configSource, { filename: 'config.js' });
new vm.Script(rentalSource, { filename: 'room-booking-v2.js' });

assert(read('index.html').includes('href="course-portal.html?method=line" id="lineGateway"'));
assert(!read('index.html').includes('auto=1'));
assert(!portalSource.includes('const shouldAuto'));
assert(!portalSource.includes("params.get('auto')"));
assert(portalSource.includes('await startLineLogin(role, button)'));
assert(portalSource.includes("pendingFlow = 'line-registration'"));
assert(portalSource.includes('(async function ()'));
assert(portalSource.includes("await P.call('coursePortalExchangeAccess'"));
assert(portalSource.indexOf('if (accessToken)') < portalSource.indexOf("if (requestedMethod === 'line'"));
const centralExchange = portalSource.slice(
  portalSource.indexOf('async function exchangeCentralAccess'),
  portalSource.indexOf('async function startLineLogin')
);
assert(centralExchange.indexOf("P.call('coursePortalExchangeAccess'") < centralExchange.indexOf("setUrl({ method:'line', role:role.id })"));
assert(!configSource.includes('__YOUZI_CENTRAL_ACCESS_EXCHANGE'));
assert(!configSource.includes('installRolePageRecovery'));
assert(commonSource.includes('function invalidateSession(role, error)'));
assert(commonSource.includes("params.set('reason', 'session-expired')"));
assert(teacherSource.includes("PortalAuth.invalidateSession('teacher', error)"));
assert(studentSource.includes("P.invalidateSession('student', error)"));

function storage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] || null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); }
  };
}

function runConfig(localStorage, sessionStorage, locationOverrides) {
  const location = Object.assign({
    href: 'https://example.test/index.html',
    pathname: '/index.html',
    search: '',
    replaced: '',
    replace(url) { this.replaced = String(url); }
  }, locationOverrides || {});
  const window = {
    location,
    localStorage,
    sessionStorage,
    setTimeout() {}
  };
  const context = vm.createContext({ window, URL, URLSearchParams });
  new vm.Script(configSource, { filename: 'config.js' }).runInContext(context);
  return window;
}

const local = storage({
  'youzi.coursePortal.lastRole.v2': 'teacher',
  'youzi.coursePortal.teacher.session.v1': 'old-teacher',
  'youzi.coursePortal.entryIntent.v2': '{"role":"teacher"}',
  'youzi.coursePortal.dataCache.v2.teacher': 'old-cache',
  employeeUser: 'keep-manager',
  'youzi.business.record': 'keep-business'
});
const session = storage({
  'youzi.coursePortal.student.session.v1': 'old-student',
  'youzi.coursePortal.renter.session.v1': 'old-renter'
});
const firstWindow = runConfig(local, session);

[
  'youzi.coursePortal.lastRole.v2',
  'youzi.coursePortal.teacher.session.v1',
  'youzi.coursePortal.entryIntent.v2',
  'youzi.coursePortal.dataCache.v2.teacher'
].forEach((key) => assert.strictEqual(local.getItem(key), null, `${key} was not migrated`));
assert.strictEqual(session.getItem('youzi.coursePortal.student.session.v1'), null);
assert.strictEqual(session.getItem('youzi.coursePortal.renter.session.v1'), null);
assert.strictEqual(local.getItem('employeeUser'), 'keep-manager');
assert.strictEqual(local.getItem('youzi.business.record'), 'keep-business');
assert.strictEqual(local.getItem('youzi.coursePortal.authStateMigration.20260805.v1'), 'done');

local.setItem('youzi.coursePortal.teacher.session.v1', 'new-explicit-session');
firstWindow.YouziCoursePortalEntry.rememberRole('teacher');
runConfig(local, session);
assert.strictEqual(local.getItem('youzi.coursePortal.teacher.session.v1'), 'new-explicit-session');
assert.strictEqual(local.getItem('youzi.coursePortal.lastRole.v2'), 'teacher');

// A newly loaded tab must still clear its own stale sessionStorage even when another
// tab already wrote the shared localStorage migration marker.
const migratedLocal = storage({
  'youzi.coursePortal.authStateMigration.20260805.v1': 'done',
  employeeUser: 'keep-manager'
});
const staleOtherTab = storage({
  'youzi.coursePortal.teacher.session.v1': 'stale-tab-session'
});
runConfig(migratedLocal, staleOtherTab);
assert.strictEqual(staleOtherTab.getItem('youzi.coursePortal.teacher.session.v1'), null);
assert.strictEqual(staleOtherTab.getItem('youzi.coursePortal.authStateMigration.20260805.v1'), 'done');
assert.strictEqual(migratedLocal.getItem('employeeUser'), 'keep-manager');

const noFromRoom = runConfig(local, session, {
  href: 'https://example.test/room-booking.html',
  pathname: '/room-booking.html',
  search: ''
});
assert.strictEqual(
  noFromRoom.location.replaced,
  'course-portal.html?method=line&role=renter&reason=login-required',
  'room booking without from must not borrow the teacher session'
);
const explicitTeacherRoom = runConfig(local, session, {
  href: 'https://example.test/room-booking.html?from=teacher',
  pathname: '/room-booking.html',
  search: '?from=teacher'
});
assert.strictEqual(explicitTeacherRoom.location.replaced, '', 'valid explicit teacher rental session should remain usable');

const resolver = rentalSource.slice(
  rentalSource.indexOf('function requestedRoomRole()'),
  rentalSource.indexOf('function renderUses(')
);
assert(resolver.includes("return requested === 'teacher' || requested === 'student' ? requested : 'renter'"));
assert(resolver.includes('const currentToken = P.getSession(requested)'));
assert(!resolver.includes("P.getSession('student')"));
assert(!resolver.includes("P.getSession('teacher')"));
assert(rentalSource.includes("P.invalidateSession(saved.role, error)"));
assert(rentalSource.includes("redirectToRoleLogin(requestedRoomRole(), null, 'login-required')"));
assert(rentalSource.includes("P.invalidateSession(requested, error)"));
assert(!rentalSource.includes('P.installAuth('));
assert(!rentalSource.includes('showBooking(false)'));

const commonWindow = {
  APP_CONFIG: { FIREBASE_CONFIG: { projectId: 'test' } },
  firebase: {
    apps: [{}],
    initializeApp() {},
    app() { return { functions() { return {}; } }; }
  },
  localStorage: storage(),
  sessionStorage: storage(),
  location: { search: '', replace() {} },
  document: {
    getElementById() { return null; },
    createElement() { return {}; },
    head: { appendChild() {} }
  }
};
vm.runInNewContext(commonSource, {
  window: commonWindow,
  document: commonWindow.document,
  URLSearchParams,
  Intl,
  Date,
  setInterval,
  clearInterval,
  setTimeout,
  CustomEvent: function CustomEvent() {}
});
assert.strictEqual(commonWindow.CoursePortal.isSessionAuthError({ code: 'functions/unauthenticated', message: '請先登入。' }), true);
assert.strictEqual(commonWindow.CoursePortal.isSessionAuthError({ code: 'functions/permission-denied', message: '沒有這位學生的查看權限。' }), false);

['teacher-course-portal.html', 'student-course-portal.html', 'room-booking.html'].forEach((file) => {
  const html = read(file);
  assert(html.includes('config.js?v=20260805-auth-route-cleanup-v1'), `${file} config cache key is stale`);
  assert(html.includes('course-portal-common.js?v=20260805-auth-route-cleanup-v1'), `${file} common cache key is stale`);
});
assert(
  read('teacher-course-portal.html').includes('teacher-course-portal-v8.js?v=20260808-early-attendance-v1'),
  'teacher app cache key is stale'
);

console.log('course login routing tests passed');
