const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'teacher-course-portal-v8.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'functions/coursePortal.js'), 'utf8');

function addFlow(subjectIds) {
  const calls = [];
  const context = { clean: v => String(v || '').trim(), operationId: () => 'test-operation',
    data: { roster: [{ id: 'student', subjectIds: ['jazz-drums'] }] },
    allowedSubjects: () => subjectIds.map(id => ({ id, name: id })),
    toast: (...args) => calls.push(['error', ...args]),
    showQuick: (...args) => calls.push(['dialog', ...args]),
    studentNamesByIds: () => ['Test student'],
    searchAddAvailability: data => calls.push(['search', data]) };
  vm.createContext(context);
  vm.runInContext(frontend.slice(frontend.indexOf('  function beginAddFlow('), frontend.indexOf('  async function searchAddAvailability(')), context);
  return { context, calls };
}

test('mobile lesson shortcut rejects a stale subject before choosing duration or time', () => {
  const { context, calls } = addFlow(['drum-alias']);
  context.beginAddFlow('extra_lesson', { studentIds: ['student'], subjectId: 'jazz-drums' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'error');
  assert.match(calls[0][1], /科目對應/);
});

test('mapped jazz-drums lesson continues with the same student, subject and duration', () => {
  const { context, calls } = addFlow(['jazz-drums']);
  context.beginAddFlow('extra_lesson', { studentIds: ['student'], subjectId: 'jazz-drums', durationChosen: true, durationMinutes: 60 });
  assert.equal(calls[0][0], 'search');
  assert.equal(calls[0][1].subjectId, 'jazz-drums');
  assert.equal(calls[0][1].durationMinutes, 60);
});

function availability(subjectIds) {
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const context = { HttpsError, requireSession: async () => ({ teacherId: 'teacher' }),
    clean: v => String(v || '').trim(), dateKey: v => v || '', assertPortalAdvanceDate() {},
    currentTaipeiDay: () => '2026-11-14', portalMaximumAdvanceDate: () => '2026-12-14',
    addDays: d => d, courseDateIsPast: () => false, validPortalTime: () => true,
    scheduleBundle: async () => ({ maps: { subjects: { 'jazz-drums': { active: true } }, teachers: { teacher: { subjectIds } } }, resourceEvents: [], rooms: [] }),
    rentalPolicySettings: async () => ({}), db: { collection: () => ({ get: async () => ({ docs: [] }) }) },
    irregularRestoreMode: async () => null, followupLessonSource: () => null,
    firstArray: (row, keys) => keys.map(k => row[k]).find(Array.isArray) || [],
    sourceActive: row => row.active !== false,
    require: () => ({ read: async () => [], assertOpen: async () => {} }),
    businessWindow: () => ({ closed: true }) };
  vm.createContext(context);
  const start = backend.indexOf('async function teacherAvailability(');
  const end = backend.indexOf('\nasync function ', start + 1);
  vm.runInContext(backend.slice(start, end), context);
  return context.teacherAvailability;
}

test('availability rejects non-teachable subject before offering slots', async () => {
  await assert.rejects(availability(['drum-alias'])({ startDate: '2026-11-14', action: 'extra_lesson', subjectId: 'jazz-drums', studentIds: ['student'] }), error => error.code === 'permission-denied');
});

test('availability accepts corrected subject and retains empty-list legacy semantics', async () => {
  for (const subjects of [['jazz-drums'], []]) {
    const result = await availability(subjects)({ startDate: '2026-11-14', action: 'extra_lesson', subjectId: 'jazz-drums', studentIds: ['student'] });
    assert.equal(result.ok, true);
  }
});
