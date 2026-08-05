'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const client = fs.readFileSync('firebase-client.js', 'utf8');
const employeePage = fs.readFileSync('temporary-attendance.html', 'utf8');
const adminPage = fs.readFileSync('temporary-attendance-admin.html', 'utf8');
const auditPage = fs.readFileSync('attendance-flow-check.html', 'utf8');

function inlineScriptContaining(html, needle) {
  const scripts = Array.from(html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi), match => match[1]);
  const script = scripts.find(source => source.includes(needle));
  assert.ok(script, `inline script containing ${needle} should exist`);
  return script;
}

test('employee page opens leave-covered time for a separate temporary attendance request', () => {
  assert.match(employeePage, /leaveRequestBlocks/);
  assert.match(employeePage, /subtractMinuteRanges\(st,en,leaveRequests\)/);
  assert.match(employeePage, /請假與臨時出勤是兩筆獨立紀錄/);
  assert.match(employeePage, /leaveRequestIds/);
  assert.doesNotMatch(employeePage, /全天核准請假，因此不開放臨時出勤申請/);
  assert.doesNotMatch(employeePage, /overlapsApprovedLeave/);
});

test('leave range subtraction works for pending, approved, and rejected history', () => {
  const context = vm.createContext({ console });
  new vm.Script(inlineScriptContaining(employeePage, 'normalizeLeaveRequestBlocks')).runInContext(context);

  const fullDay = vm.runInContext("normalizeLeaveRequestBlocks({leaveRequestBlocks:[{requestId:'L1',status:'待審核',reason:'事假',start:0,end:1440,allDay:true}]})", context);
  assert.equal(fullDay.length, 1);
  assert.equal(fullDay[0].status, '待審核');
  assert.deepEqual(Array.from(vm.runInContext('subtractMinuteRanges(540,1020,' + JSON.stringify(fullDay) + ')', context)), []);

  const rejectedPartial = vm.runInContext("normalizeLeaveRequestBlocks({leaveRequestBlocks:[{requestId:'L2',status:'已駁回',start:540,end:720}]})", context);
  assert.equal(rejectedPartial[0].status, '已駁回');
  const remaining = vm.runInContext('subtractMinuteRanges(540,1020,' + JSON.stringify(rejectedPartial) + ')', context);
  assert.deepEqual(Array.from(remaining, row => Array.from(row)), [[720, 1020]]);
});

test('backend keeps leave, normal attendance, and temporary attendance independent', () => {
  assert.match(client, /leaveRequestBlocks:requested/);
  assert.match(client, /assignRecords\(schedules,records\.filter\(r=>!isIndependentTemporaryClock\(r\)\)\)/);
  assert.match(client, /if\(isIndependentTemporaryClock\(r\)\).*scheduleLinked:false/);
  assert.match(client, /if\(approve\)for\(const d of Array\.from\(new Set\(leave\.segments\.map\(s=>s\.date\)\)\)\) await reconcileAttendance/);
  assert.match(client, /uncoveredOverlap.*intervalCoveredByBlocks\(piece\[0\],piece\[1\],leaveBlocks\)/s);
  assert.match(client, /temporaryBlockCoversPunch/);
  assert.match(client, /automaticMissingSuppressed/);
});

test('manager and audit screens explain and display the independent records', () => {
  assert.match(adminPage, /同時有另一筆請假紀錄；請假與臨時出勤各自保留、各自審核/);
  assert.match(auditPage, /id="temporaryRows"/);
  assert.match(auditPage, /rejectedLeaves/);
  assert.match(auditPage, /獨立臨時出勤紀錄/);
  for (const page of [employeePage, adminPage, auditPage, fs.readFileSync('leave.html', 'utf8'), fs.readFileSync('clock.html', 'utf8')]) {
    assert.match(page, /firebase-client\.js\?v=20260805-attendance-independent-v2/);
  }
});
