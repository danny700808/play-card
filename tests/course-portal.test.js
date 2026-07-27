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
