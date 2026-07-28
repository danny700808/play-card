'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const { normalizePhone, phoneMatches } = require('../functions/coursePortalUtils');

assert.strictEqual(normalizePhone('+886 912-345-678'), '0912345678');
assert.strictEqual(normalizePhone('0912 345 678'), '0912345678');
assert.strictEqual(phoneMatches('+886912345678', '0912345678'), true);
assert.strictEqual(phoneMatches('0912345678', '0987654321'), false);

const pages = [
  'teacher-course-portal.html',
  'student-course-portal.html',
  'room-booking.html',
  'course-portal-admin.html'
];

const portalLanding = fs.readFileSync(path.join(root, 'course-portal.html'), 'utf8');
const portalRoutes = [
  'student-course-portal.html',
  'teacher-course-portal.html',
  'room-booking.html'
];
portalRoutes.forEach((route) => {
  const occurrences = portalLanding.split(`href="${route}"`).length - 1;
  assert.strictEqual(occurrences, 1, `入口首頁的 ${route} 必須且只能出現一次`);
});
assert.strictEqual(
  (portalLanding.match(/class="card stack"/g) || []).length,
  3,
  '入口首頁必須維持三個獨立入口'
);

const commonSource = fs.readFileSync(path.join(root, 'course-portal-common.js'), 'utf8');
assert(commonSource.trimStart().startsWith('(function'), 'course-portal-common.js 不是可執行的 JavaScript');
new vm.Script(commonSource, { filename: 'course-portal-common.js' });

for (const file of pages) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert(html.trimStart().toLowerCase().startsWith('<!doctype html>'), `${file} 不是 HTML 文件`);
  assert(html.includes('course-portal-common.js'), `${file} 未載入共用入口程式`);
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((code) => code.trim());
  inlineScripts.forEach((code, index) => {
    new vm.Script(code, { filename: `${file}:inline-${index + 1}` });
  });
}

const teacherPortal = fs.readFileSync(path.join(root, 'teacher-course-portal.html'), 'utf8');
assert(teacherPortal.includes('value="single_move"'), '老師入口缺少單次調課');
assert(teacherPortal.includes('value="permanent_move"'), '老師入口缺少永久調課');
assert(!portalLanding.includes('老師調課入口'), '老師調課不可誤拆成第四個入口');

const schedulerHtml = fs.readFileSync(path.join(root, 'course-scheduler.html'), 'utf8');
const schedulerSource = fs.readFileSync(path.join(root, 'course-scheduler.js'), 'utf8');
assert(schedulerHtml.includes('id="dataModePanel"'), '排課頁缺少資料同步面板');
assert(schedulerHtml.includes('id="syncInjiaoyunBtn"'), '排課頁缺少單一同步按鈕');
assert(!schedulerHtml.includes('sandboxLogBtn'), '不應保留測試紀錄按鈕');
assert(!schedulerHtml.includes('undoSandboxBtn'), '不應保留測試復原按鈕');
assert(!schedulerHtml.includes('resetSandboxBtn'), '不應保留測試重設按鈕');
assert(!schedulerHtml.includes('loadMigratedDataBtn'), '不應保留另外載入資料按鈕');
assert(schedulerSource.includes("var WORKSPACE_DB_KEY='workspace'"), '操作資料未使用 IndexedDB 工作區');
assert(schedulerSource.includes('storeWorkspaceDatabase(state)'), '操作後未自動儲存工作區');
assert(schedulerSource.includes('workspaceFromFormal'), '同步後未由最新音教雲資料重建工作區');

const backend = fs.readFileSync(path.join(root, 'functions/coursePortal.js'), 'utf8');
[
  'coursePortalStartBinding',
  'coursePortalExchangeAccess',
  'coursePortalTeacherData',
  'coursePortalStudentData',
  'coursePortalRentalAvailability',
  'coursePortalCreateRoomBooking',
  'coursePortalRentalMyBookings',
  'coursePortalCancelRoomBooking',
  'coursePortalTeacherAction',
  'coursePortalTeacherLessonState',
  'coursePortalUpdateStudentReminder',
  'coursePortalAdminBindingAction',
  'coursePortalStudentReminderDaily'
].forEach((name) => assert(backend.includes(name), `缺少後端函式 ${name}`));
assert(backend.includes("where('lineUserId', '==', session.lineUserId)"), '租用紀錄未限制為目前 LINE 使用者');
assert(backend.includes('只能取消自己預約的教室'), '取消租用缺少本人權限檢查');

const portalCss = fs.readFileSync(path.join(root, 'course-portal.css'), 'utf8');
assert(portalCss.includes('@media (max-width: 760px)'), '外部入口缺少手機版樣式');
const internalMobileCss = fs.readFileSync(path.join(root, 'internal-mobile.css'), 'utf8');
assert(internalMobileCss.includes('@media (max-width: 780px)'), '內部系統缺少手機版斷點');
assert(internalMobileCss.includes('body.yz-internal-theme'), '內部手機樣式未限制在內部主題');

const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
assert(rules.includes('match /coursePortalSessions/{document=**} { allow read, write: if false; }'));
assert(rules.includes('match /coursePortalStudentBindings/{document=**} { allow read, write: if false; }'));

console.log('course portal tests passed');
