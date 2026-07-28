'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sandbox = {
  window: {},
  console,
  Map,
  Set,
  Date,
  JSON,
  Math,
  Number,
  String,
  Array,
  Object,
  Intl
};
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(root, 'course-scheduler-data.js'), 'utf8'),
  sandbox,
  { filename: 'course-scheduler-data.js' }
);

const periods = Array.from({ length: 4270 }, (_, index) => ({
  id: `period_${index}`,
  sourcePaymentId: `source_${index}`,
  studentId: `student_${index % 662}`,
  subjectId: `subject_${index % 17}`,
  periodNo: index + 1,
  lessonCount: 4,
  expectedAmount: 2800,
  transactions: []
}));
const attendance = Array.from({ length: 15298 }, (_, index) => ({
  id: `attendance_${index}`,
  periodId: `period_${index % periods.length}`,
  studentId: `student_${index % 662}`,
  date: `2026-07-${String(1 + (index % 27)).padStart(2, '0')}`,
  status: 'attended',
  deducted: true
}));
const events = Array.from({ length: 27008 }, (_, index) => ({
  id: `event_${index}`,
  sourceCourseId: `course_${index}`,
  date: `2026-07-${String(1 + (index % 27)).padStart(2, '0')}`,
  roomId: `room_${index % 11}`,
  start: `${String(8 + (index % 13)).padStart(2, '0')}:00`,
  duration: 60,
  type: 'fixed',
  studentIds: [`student_${index % 662}`],
  teacherId: `teacher_${index % 33}`,
  subjectId: `subject_${index % 17}`
}));
const payload = {
  runId: 'performance-test',
  rooms: Array.from({ length: 11 }, (_, index) => ({ id: `room_${index}`, name: `教室 ${index}` })),
  subjects: Array.from({ length: 17 }, (_, index) => ({ id: `subject_${index}`, name: `科目 ${index}` })),
  students: Array.from({ length: 662 }, (_, index) => ({ id: `student_${index}`, name: `學生 ${index}` })),
  teachers: Array.from({ length: 33 }, (_, index) => ({ id: `teacher_${index}`, name: `老師 ${index}` })),
  tuitionPeriods: periods,
  attendance,
  events,
  dataQuality: {
    auditCoveredDates: Array.from(
      { length: 27 },
      (_, index) => `2026-07-${String(index + 1).padStart(2, '0')}`
    )
  }
};

const startedAt = Date.now();
const state = sandbox.window.YouziCoursePreviewData.buildState(payload, '2026-07-27');
const elapsedMs = Date.now() - startedAt;

assert.strictEqual(state.tuitionPeriods.length, periods.length);
assert.strictEqual(state.attendance.length, attendance.length);
assert.strictEqual(state.events.length, events.length);
assert(elapsedMs < 5000, `大量資料轉換耗時 ${elapsedMs}ms，超過 5 秒穩定性門檻`);

console.log(`course scheduler performance test passed (${elapsedMs}ms)`);
