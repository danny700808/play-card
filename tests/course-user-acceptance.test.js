'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const period = { id: 'p1', studentId: 'group1', subjectId: 'guitar', teacherId: 'teacher1', periodNo: 1, lessonCount: 4, expectedAmount: 3600, usedCount: 4, transactions: [], planSnapshot: { splitType: 'ratio', splitValue: 0.6 } };
  const state = { tuitionPeriods: [period], events: [], recurringRules: [], teacherPayroll: [], students: [{ id: 'group1', name: '林青妤、林哲璿' }] };
  let seq = 0;
  const context = {
    state, Set, Map, Math, Array, Object, Number,
    numberOf: value => Number(value) || 0, clean: value => String(value ?? '').trim(), clone: structuredClone,
    periodById: id => state.tuitionPeriods.find(row => row.id === id) || {}, latestPeriod: () => period,
    uid: () => 'created'+(++seq), feeById: () => period.planSnapshot, isSandbox: () => true,
    periodNetExpectedAmount: row => row.expectedAmount, teacherShareRatio: value => Number(value),
    eventDisplayName: () => '林青妤－林哲璿', subjectById: () => ({ name: '木吉他' }),
    studentById: id => state.students.find(row => row.id === id) || {}, normalizedStatus: value => value
  };
  vm.createContext(context);
  for (const name of ['money', 'eventStudentNames', 'nextPeriodNumber', 'ensureAttendancePeriod', 'syncSandboxPayroll', 'splitText']) {
    const start = code.indexOf('  function '+name+'(');
    assert(start >= 0, name);
    const next = code.slice(start+3).search(/\n  (?:async )?function /);
    vm.runInContext(code.slice(start, start+3+next), context);
  }
  return { context, state, period };
}
for (const file of ['operations-course-inline-runtime.js', 'course-scheduler.js']) {
  test(file+': unpaid attendance creates one next period and retains group price/split', () => {
    const { context, state } = fixture(file);
    const event = { id: 'event5', studentIds: ['group1'], tuitionPeriodId: 'p1', date: '2026-09-07', teacherId: 'teacher1', subjectId: 'guitar', start: '16:30' };
    const result = context.ensureAttendancePeriod(event, 'group1');
    assert.equal(state.tuitionPeriods.length, 2);
    assert.equal(result.period.lessonCount, 4); assert.equal(result.period.expectedAmount, 3600);
    assert.equal(result.period.transactions.length, 0); assert.equal(result.period.planSnapshot.splitValue, 0.6);
    context.syncSandboxPayroll(event, 'attended');
    assert.equal(state.teacherPayroll[0].teacherAmount, 540);
    assert.equal(state.teacherPayroll[0].collectedAmount, 0);
    context.ensureAttendancePeriod(event, 'group1', { periodId: result.period.id, deducted: true });
    context.syncSandboxPayroll(event, 'attended');
    assert.equal(state.tuitionPeriods.length, 2); assert.equal(state.teacherPayroll.length, 1);
  });
  test(file+': continuation skips existing full periods even when all periods are unpaid', () => {
    const { context, state, period } = fixture(file);
    state.tuitionPeriods.push({ ...structuredClone(period), id: 'p2', periodNo: 2 });
    const next = context.ensureAttendancePeriod({ id: 'event9', date: '2026-09-07', tuitionPeriodId: 'p1' }, 'group1');
    assert.equal(next.period.periodNo, 3); assert.equal(next.period.usedCount, 0);
    assert.equal(state.tuitionPeriods.length, 3);
  });
  test(file+': group display deduplicates explicit separators without splitting concatenated names', () => {
    const { context } = fixture(file);
    assert.equal(context.eventStudentNames({ studentIds: ['group1'], studentNames: ['林青妤、林哲璿', '林青妤', '林哲璿'] }).join('－'), '林青妤－林哲璿');
    assert.equal(context.eventStudentNames({ studentNames: ['廖揚聲江淑敏'] }).join('－'), '廖揚聲江淑敏');
  });
  test(file+': zero amounts and explicit zero teacher split are distinguishable from missing configuration', () => {
    const { context } = fixture(file);
    assert.equal(context.money(-0), '$0'); assert.equal(context.money(-0.1), '$0');
    assert.equal(context.splitText({ splitType: 'fixed', hourlyFee: 0 }), '$0');
    assert.equal(context.splitText({}), '未設定');
  });
}
