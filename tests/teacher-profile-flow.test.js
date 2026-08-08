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
  assert.match(page, /id="profileIdentityFiles"[^>]*type="file"/);
  assert.match(page, /for="profileIdentityFiles">拍照或選擇照片</);
  assert.match(page, /id="profileIdentityFiles"[^>]*accept="image\/\*,\.jpg,\.jpeg,\.png,\.webp,\.heic,\.heif"[^>]*multiple/);
  assert.doesNotMatch(page, /profileIdentityCamera|capture="environment"|>直接拍照<|>選擇照片</);
  assert.match(page, /id="profileBirthDate"[^>]*type="hidden"/);
  assert.match(page, /id="profileBirthYear"/);
  assert.match(page, /id="profileBirthMonth"/);
  assert.match(page, /id="profileBirthDay"/);
  assert.match(page, /id="profileHouseholdAddress"/);
  assert.match(page, /id="profileMailingAddress"/);
  assert.match(page, /id="profileTeachingList"/);
  assert.match(runtime, /teaching-level/);
  assert.match(runtime, /Object\.freeze\(\['初學', '入門', '普通', '良好', '專業', '專精'\]\)/);
  assert.match(runtime, /const BIRTH_MIN_YEAR = 1900/);
  assert.match(runtime, /function fillBirthOptions\(\)/);
  assert.match(runtime, /function refreshBirthDays\(\)/);
  assert.match(runtime, /function updateBirthDateValue\(\)/);
  assert.match(runtime, /function setBirthDateValue\(value\)/);
  assert.match(runtime, /document\.createElement\('select'\)/);
  assert.match(runtime, /請選擇程度/);
  assert.match(runtime, /source\.proficiency\) \|\| '普通'/);
  assert.doesNotMatch(runtime, /level\.placeholder\s*=|例如：初階～進階/);
  assert.match(page, /teacher-profile\.js\?v=20260808-mobile-profile-v2/);
  assert.match(page, /LINE/);
  assert.match(page, /Email/);
  assert.match(page, /profile-title-row[\s\S]*profileLineStatus[\s\S]*profileEmailStatus/);
  assert.doesNotMatch(page, /id="profileStatusCard"|資料填寫中|id="profileLoginCard"|<h2>登入方式<\/h2>/);
  assert.doesNotMatch(page, /可先儲存目前內容，下次再繼續|這不代表個人資料是否完成|姓名、電話與 Email 會同步/);
  assert.doesNotMatch(page, /查看契約並簽名|確認送出契約|contract\.html/);
  assert.doesNotMatch(runtime, /external-teacher-onboarding|showContractStep|go\(4\)/);
  assert.match(runtime, /coursePortalTeacherSaveProfileDraft/);
  assert.match(runtime, /僅供柚子樂器外聘教師資料建檔使用/);
  assert.match(runtime, /pendingIdentityFiles/);
  assert.match(runtime, /送出修改供管理者確認/);
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
  assert.match(save, /patch\.status = submitForReview[\s\S]*'pending_review'/);
  assert.doesNotMatch(save, /currentConfirmed\s*\?[\s\S]{0,120}existing\.status/);
  assert.match(save, /profileReviewStatus:\s*patch\.status/);
  assert.match(save, /if \(!employeeConfirmed\)/);
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
  assert.match(resolver, /employeeAlreadyEstablished\s*=\s*canonicalExisting\.active === true/);
  assert.match(resolver, /maySyncProfileIntoEmployee\s*=\s*!employeeAlreadyEstablished \|\| currentProfileConfirmed/);
  assert.match(resolver, /if \(maySyncProfileIntoEmployee\)/);
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

test('contract page is blocked until the canonical personal profile is complete', () => {
  const page = read('contract.html');
  const runtime = read('teacher-contract.js');
  assert.match(page, /id="contractProfileRequired"[\s\S]*請先完成基本資料/);
  assert.match(page, /id="contractOpenProfile"[^>]*>前往我的資料</);
  assert.match(runtime, /if \(!result\.profileComplete\)/);
  assert.match(runtime, /teacher-profile\.html/);
  assert.match(runtime, /coursePortalTeacherContractSession/);
  assert.doesNotMatch(page, /id="teacherName"|id="teacherEmail"|id="teacherIdNumber"|id="teacherAddress"|id="teacherCourse"/);
  assert.doesNotMatch(page, /firebase-client\.js|teacher-more-auth-bridge\.js/);
  new vm.Script(runtime, { filename: 'teacher-contract.js' });
});

test('contract imports profile data and requires manager approval before activation', () => {
  const backend = read('functions/coursePortal.js');
  const manager = read('functions/personDataAdmin.js');
  const adminPage = read('external-teacher-admin.html');
  const start = backend.indexOf('async function teacherSubmitContract(data)');
  const end = backend.indexOf('function safeRentalDisplayName', start);
  const submit = backend.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(submit, /if \(resolved\.profileComplete !== true\)/);
  assert.match(submit, /請先完成基本資料，再進行合約簽署/);
  assert.match(submit, /teacherContractProfileData\(\s*resolved/);
  assert.match(submit, /teacherContractPrivateSnapshots/);
  assert.match(submit, /profileSnapshot:\s*profileData/);
  assert.match(submit, /status:\s*'submitted_pending_admin'/);
  assert.match(submit, /等待主管確認/);
  assert.doesNotMatch(submit, /status:\s*'active'/);
  assert.match(backend, /coursePortalTeacherContractSession\s*=\s*callable\(teacherContractSession/);
  assert.match(backend, /coursePortalTeacherSubmitContract\s*=\s*callable\(teacherSubmitContract/);
  assert.match(manager, /personDataAdminContractAction/);
  assert.match(manager, /personDataAdminContractDetail/);
  assert.match(manager, /status:\s*'active'[\s\S]*主管已確認，契約生效/);
  assert.match(manager, /status:\s*'needs_revision'[\s\S]*等待老師重新簽署/);
  assert.doesNotMatch(manager.slice(manager.indexOf('async function personDataContractAction')), /profileStatus:\s*'active'/);
  assert.match(adminPage, /personDataAdminContractInventory/);
  assert.match(adminPage, /personDataAdminContractAction/);
  assert.match(adminPage, /personDataAdminContractDetail/);
  assert.match(adminPage, /openAssignmentPreview/);
});

test('a contract published before the first profile visit can bind only by the same protected person id', () => {
  const backend = read('functions/coursePortal.js');
  const summaryStart = backend.indexOf('function teacherUtilityContractMatchesProfile');
  const summaryEnd = backend.indexOf('function teacherUtilityContractPending', summaryStart);
  const summaryMatch = backend.slice(summaryStart, summaryEnd);
  const start = backend.indexOf('function teacherContractBelongsToCurrentProfile');
  const end = backend.indexOf('async function teacherContractAssignmentRows', start);
  const belongs = backend.slice(start, end);
  assert.match(summaryMatch, /if \(rowProfileId && rowProfileId !== expectedProfileId\) return false/);
  assert.match(summaryMatch, /if \(rowProfileVersion && rowProfileVersion !== version\) return false/);
  assert.match(summaryMatch, /assignmentProfilePolicy/);
  assert.match(summaryMatch, /if \(!rowProfileId \|\| !rowProfileVersion\) return canBindUnscoped/);
  assert.match(belongs, /if \(assignedProfileId && assignedProfileId !== profileId\) return false/);
  assert.match(belongs, /if \(assignedProfileVersion && assignedProfileVersion !== profileVersion\) return false/);
  assert.match(belongs, /assignmentProfilePolicy/);
  assert.match(read('firebase-client.js'), /assignmentProfilePolicy:'canonical-profile-or-protected-person-v1'/);
  assert.match(belongs, /rowIds\.some\(\(value\) => expectedIds\.has\(value\)\)/);
  assert.doesNotMatch(belongs, /assignedProfileId\) !== profileId/);
});

test('all manager contract links use the current annual contract manager', () => {
  const hub = read('teacher-hub.html');
  const review = read('external-teacher-admin.html');
  const publisher = read('contract-admin.html');
  const legacy = read('external-teacher-contract-admin.html');
  const login = read('login.html');
  assert.match(hub, /href="contract-admin\.html"/);
  assert.match(review, /href="contract-admin\.html"/);
  assert.doesNotMatch(hub, /href="external-teacher-contract-admin\.html/);
  assert.doesNotMatch(review, /href="external-teacher-contract-admin\.html/);
  assert.match(legacy, /location\.replace\(['"]contract-admin\.html['"]\)/);
  assert.match(publisher, /await waitForManagerAuth\(\)/);
  assert.match(publisher, /getIdTokenResult\(true\)/);
  assert.match(login, /'contract-admin\.html'/);
  const rules = read('firestore.rules');
  assert.match(rules, /match \/teacherContractAssignments\/\{document=\*\*\} \{ allow read, write: if isManagerAuth\(\); \}/);
  assert.match(rules, /match \/teacherContractPrivateSnapshots\/\{document=\*\*\} \{ allow read, write: if false; \}/);
});
