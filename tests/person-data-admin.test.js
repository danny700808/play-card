'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const backend = require('../functions/personDataAdmin');
const helpers = backend.__test;
const spec = (collection) => helpers.SOURCE_SPECS.find((row) => row.collection === collection);
const record = (collection, docId, row) => ({ spec: spec(collection), docId, row: row || {}, ref: { path: `${collection}/${docId}` } });

test('person inventory groups only by explicit stable IDs, never by matching email', () => {
  const groups = helpers.buildGroups([
    record('employees', 'E1', { employeeId: 'E1', email: 'shared@example.com' }),
    record('externalTeacherProfiles', 'P1', { employeeId: 'E1', email: 'shared@example.com' }),
    record('employees', 'E2', { employeeId: 'E2', email: 'shared@example.com' })
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.employeeIds.includes('E1')).sourceCount, 2);
  assert.equal(groups.find((group) => group.employeeIds.includes('E2')).sourceCount, 1);
});

test('binding explicitly connects teacher identity to the same employee master', () => {
  const groups = helpers.buildGroups([
    record('employees', 'E1', { employeeId: 'E1', accountStatus: 'profile_draft' }),
    record('coursePortalTeacherBindings', 'B1', { employeeId: 'E1', teacherId: 'T1', status: 'active' }),
    record('teacherPrivateProfiles', 'P1', { employeeId: 'E1', coursePortalTeacherId: 'T1' })
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].employeeIds, ['E1']);
  assert.deepEqual(groups[0].teacherIds, ['T1']);
});

test('manager-linked legacy master remains history under one canonical person', () => {
  const groups = helpers.buildGroups([
    record('employees', 'E1', { employeeId: 'E1', accountStatus: 'active' }),
    record('employees', 'OLD', { employeeId: 'OLD', personMasterId: 'E1', mergedIntoEmployeeId: 'E1', accountStatus: 'archived' }),
    record('externalTeacherProfiles', 'P1', { employeeId: 'OLD', personMasterId: 'E1' })
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].canonicalEmployeeIds, ['E1']);
  assert.equal(groups[0].masterCount, 1);
  assert.equal(groups[0].historicalMasterCount, 1);
  assert.equal(groups[0].needsReview, false);
});

test('formal contract, payroll or attendance blocks permanent deletion', () => {
  const signed = helpers.buildGroups([
    record('employees', 'E1', { employeeId: 'E1', accountStatus: 'profile_draft', active: false }),
    record('externalTeacherContracts', 'C1', { employeeId: 'E1', status: 'signed', signedAt: '2026-01-01' })
  ])[0];
  assert.equal(signed.formalCount, 1);
  assert.equal(signed.safelyDeletable, false);

  const attendance = helpers.buildGroups([
    record('employees', 'E2', { employeeId: 'E2', accountStatus: 'archived', active: false }),
    record('clockRecords', 'CLK1', { employeeId: 'E2' })
  ])[0];
  assert.equal(attendance.formalCount, 1);
  assert.equal(attendance.safelyDeletable, false);
});

test('draft test person without formal history is deletable but active person is not', () => {
  const draft = helpers.buildGroups([
    record('employees', 'E1', { employeeId: 'E1', accountStatus: 'profile_draft', active: false }),
    record('externalTeacherProfiles', 'P1', { employeeId: 'E1', status: 'profile_draft' }),
    record('teacherPrivateProfiles', 'P1', { employeeId: 'E1' })
  ])[0];
  assert.equal(draft.safelyDeletable, true);

  const active = helpers.buildGroups([
    record('employees', 'E2', { employeeId: 'E2', accountStatus: 'active', employmentStatus: 'active', active: true })
  ])[0];
  assert.equal(active.safelyDeletable, false);
});

test('manager cannot approve an incomplete teacher profile', () => {
  const group = helpers.buildGroups([
    record('employees', 'E1', { employeeId: 'E1', accountStatus: 'pending_review', active: false }),
    record('externalTeacherProfiles', 'P1', {
      employeeId: 'E1', portalProfileVersion: 2, name: '林老師', mobilePhone: '0912345678',
      email: 'teacher@example.com', teachingAbilities: [{ item: '鋼琴', level: '進階' }]
    }),
    record('teacherPrivateProfiles', 'P1', { employeeId: 'E1', profileId: 'P1' })
  ])[0];
  const profile = group.rows.find((row) => row.spec.collection === 'externalTeacherProfiles');
  const readiness = helpers.profileReadiness(group, profile);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.includes('身分證字號'));
  assert.ok(readiness.missing.includes('戶籍地址'));
});

test('manager page exposes safe actions and login allowlist', () => {
  const page = fs.readFileSync(path.join(root, 'person-data-admin.html'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'person-data-admin.js'), 'utf8');
  const login = fs.readFileSync(path.join(root, 'login.html'), 'utf8');
  const employeeAdmin = fs.readFileSync(path.join(root, 'employee-admin.html'), 'utf8');
  assert.match(page, /人員資料整理/);
  assert.match(runtime, /approve-profile/);
  assert.match(runtime, /return-profile/);
  assert.match(runtime, /unlink-line/);
  assert.match(runtime, /delete-test/);
  assert.match(login, /'person-data-admin\.html'/);
  assert.match(employeeAdmin, /person-data-admin\.html/);
});

test('approved teacher profile changes stay pending until manager copies them to the employee master', () => {
  const source = fs.readFileSync(path.join(root, 'functions/personDataAdmin.js'), 'utf8');
  const approveStart = source.indexOf('async function approveProfile(group, request)');
  const returnStart = source.indexOf('async function returnProfile(group, request, reason)', approveStart);
  const archiveStart = source.indexOf('async function archiveGroup(group, request, reason)', returnStart);
  const approve = source.slice(approveStart, returnStart);
  const returned = source.slice(returnStart, archiveStart);
  assert.match(approve, /name:\s*rowName\(profileRow\)/);
  assert.match(approve, /mobilePhone:\s*rowPhone\(profileRow\)/);
  assert.match(approve, /email:\s*rowEmail\(profileRow\)/);
  assert.match(approve, /teachingAbilities/);
  assert.match(approve, /profileReviewStatus:\s*'approved'/);
  assert.match(returned, /establishedTeacher\s*=\s*activeEmployee\(existingEmployee\)/);
  assert.match(returned, /active:\s*establishedTeacher\s*\?\s*true\s*:\s*false/);
  assert.match(returned, /profileReviewStatus:\s*'needs_revision'/);
});

test('attendance flow refuses schedules when employee master is absent or inactive', () => {
  const runtime = fs.readFileSync(path.join(root, 'firebase-client.js'), 'utf8');
  const start = runtime.lastIndexOf('async function activeEmployeeMaster');
  const end = runtime.indexOf('function chooseEffectiveSchedule', start);
  const source = runtime.slice(start, end);
  assert.match(source, /collection\('employees'\)/);
  assert.match(source, /if\(!employee\)return\{ok:true/);
  assert.match(source, /不會讀取舊班表/);
  assert.match(source, /profile_draft/);
  assert.match(source, /archived/);
});
