'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('teacher profile is a stable standalone page, not a profile-and-contract wizard', () => {
  const portal = read('teacher-course-portal.html');
  const page = read('teacher-profile.html');
  const runtime = read('teacher-profile.js');

  assert.match(portal, /href="teacher-profile\.html"[^>]*id="teacherProfileLink"/);
  assert.doesNotMatch(portal, /href="profile\.html"[^>]*id="teacherProfileLink"/);
  assert.match(page, /id="teacherProfileForm"/);
  assert.match(page, /id="profileSaveBtn"[^>]*>儲存，下次繼續</);
  assert.match(page, /id="profileSubmitBtn"[^>]*>送出管理者確認</);
  assert.match(page, /可先儲存目前內容，下次再繼續/);
  assert.match(page, /id="profileIdentityFiles"[^>]*type="file"/);
  assert.match(page, /id="profileBirthDate"/);
  assert.match(page, /id="profileHouseholdAddress"/);
  assert.match(page, /id="profileMailingAddress"/);
  assert.match(page, /id="profileTeachingList"/);
  assert.match(runtime, /teaching-level/);
  assert.match(page, /LINE/);
  assert.match(page, /Email/);
  assert.doesNotMatch(page, /查看契約並簽名|確認送出契約|contract\.html/);
  assert.doesNotMatch(runtime, /external-teacher-onboarding|showContractStep|go\(4\)/);
  assert.match(runtime, /coursePortalTeacherSaveProfileDraft/);
  assert.match(runtime, /僅供柚子樂器外聘教師資料建檔使用/);
  assert.doesNotMatch(runtime, /localStorage\.setItem\([^)]*(?:profile|draft|idNumber)/i);
  new vm.Script(runtime, { filename: 'teacher-profile.js' });
});

test('profile API stores a server draft without creating or navigating to a contract', () => {
  const backend = read('functions/coursePortal.js');
  const resolverStart = backend.indexOf('async function resolveTeacherUtilityEmployee(session)');
  const resolverEnd = backend.indexOf('function teacherUtilityBoolean', resolverStart);
  const resolver = backend.slice(resolverStart, resolverEnd);
  const saveStart = backend.indexOf('async function teacherUtilitySaveProfileDraft(data)');
  const saveEnd = backend.indexOf('async function teacherUtilitySession(data)', saveStart);
  const save = backend.slice(saveStart, saveEnd);

  assert.ok(resolverStart >= 0 && resolverEnd > resolverStart);
  assert.doesNotMatch(resolver, /batch\.set\(contractRef|currentExternalContractId:\s*profileId|externalTeacherContractId:\s*profileId/);
  assert.match(resolver, /disposableLegacyContract/);
  assert.match(resolver, /batch\.delete\(legacyContractRef\)/);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.match(save, /profile_draft/);
  assert.match(save, /pending_review/);
  assert.match(save, /submitForReview/);
  assert.match(save, /teacher-private-profiles\/\$\{profileId\}\/identity/);
  assert.match(save, /db\.collection\('teacherPrivateProfiles'\)\.doc\(profileId\)/);
  assert.match(save, /idNumber:\s*FieldValue\.delete\(\)/);
  assert.match(save, /saveBatch\.set\(privateProfileRef, privatePatch/);
  assert.match(save, /db\.collection\('employees'\)\.doc\(employeeId\)/);
  assert.doesNotMatch(save, /externalTeacherContracts|teacherContractAssignments|waiting_contract|pendingContract/);
  assert.match(backend, /coursePortalTeacherSaveProfileDraft\s*=\s*callable\(teacherUtilitySaveProfileDraft/);
});

test('employee master exists from first login and remains separate from annual contracts', () => {
  const backend = read('functions/coursePortal.js');
  const resolverStart = backend.indexOf('async function resolveTeacherUtilityEmployee(session)');
  const resolverEnd = backend.indexOf('function teacherUtilityBoolean', resolverStart);
  const resolver = backend.slice(resolverStart, resolverEnd);
  assert.match(resolver, /batch\.set\(canonicalRef, employeeSeed/);
  assert.doesNotMatch(resolver, /batch\.delete\(canonicalRef\)/);
  assert.match(resolver, /accountStatus:\s*clean\(canonicalExisting\.accountStatus \|\| 'profile_draft'\)/);
});

test('old fresh onboarding links leave before rendering the obsolete wizard', () => {
  const onboarding = read('external-teacher-onboarding.html');
  const head = onboarding.slice(0, onboarding.indexOf('<style>'));
  assert.match(head, /p\.get\('fresh'\)===\s*'1'/);
  assert.match(head, /youzi\.coursePortal\.teacher\.session\.v1/);
  assert.match(head, /location\.replace\('teacher-profile\.html'\)/);
});

test('new identity files use a server-only private prefix', () => {
  const storageRules = read('storage.rules');
  assert.doesNotMatch(storageRules, /match \/teacher-private-profiles\/[\s\S]*allow read:\s*if true/);
  assert.match(storageRules, /match \/\{allPaths=\*\*\}[\s\S]*allow read, write:\s*if false/);
});

test('manager reset is distinct from LINE unlink and refuses formal teacher history', () => {
  const page = read('line-binding-admin.js');
  const backend = read('functions/unifiedLineBindingAdmin.js');
  assert.match(page, /reset_test_teacher/);
  assert.match(page, /重設測試老師/);
  assert.match(backend, /async function resetTestTeacher\(lineUserId, request\)/);
  assert.match(backend, /已有合約、薪資或出勤正式紀錄/);
  assert.match(backend, /formalExternalContract/);
  assert.match(backend, /coursePortalTeacherAttendancePayroll/);
  assert.match(backend, /confirmText\) !== '重設'/);
});
