const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('teacher-course-portal-v8.js', 'utf8');
function fixture() {
  const calls = [], sheets = [];
  const c = {
    data: { roster: [{ id: 's1', name: '學生甲' }, { id: 's2', name: '學生乙' }] },
    clean: v => String(v || ''), escapeHtml: v => v,
    weekStart: '2026-10-05', token: 'test', availabilityRequestId: 0,
    planner: null, operationId: () => 'operation-1',
    activateTab: tab => calls.push(['tab', tab]),
    cancelPlanner: () => { c.planner = null; calls.push(['cancel']); },
    allowedSubjects: () => [{ id: 'piano', name: '鋼琴' }],
    studentNamesByIds: () => ['學生甲'],
    showQuick: (title, subtitle, html, context) => sheets.push({ title, context }),
    preferredAddDuration: x => x.durationMinutes || 60,
    closeQuick: () => {}, setProgress: () => {}, setFlowBanner: () => {},
    todayKey: () => '2026-09-17', courseSlotIsPast: () => false,
    subjectNameById: () => '鋼琴', renderWeek: () => calls.push(['render']),
    invoke: async (name, payload) => { calls.push([name, payload]); return { slots: [{ date: '2026-10-05', startTime: '15:00', rooms: [{ id: 'r1' }] }] }; },
    toast: message => { throw Error(message); }
  };
  vm.createContext(c);
  for (const [start, end] of [['  function rosterStudent(', '  function openStudentEdit('], ['  function beginAddFlow(', '  function showPlannerRoomChoices(']]) {
    vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), c);
  }
  return { c, calls, sheets };
}
test('roster shortcut opens the same add flow with only the chosen student and keeps the viewed week', () => {
  const { c, calls, sheets } = fixture();
  c.startRosterAdd('s1');
  assert.deepEqual(calls, [['tab', 'schedule'], ['cancel']]);
  assert.equal(c.weekStart, '2026-10-05');
  assert.equal(sheets[0].title, '選擇上課樂器');
  assert.deepEqual(Array.from(sheets[0].context.studentIds), ['s1']);
  assert.equal(sheets[0].context.target, null);
  assert.equal(sheets[0].context.action, 'extra_lesson');
});
test('unknown student cannot start an add operation', () => {
  const { c, calls, sheets } = fixture(); c.startRosterAdd('missing');
  assert.equal(calls.length, 0); assert.equal(sheets.length, 0);
});
test('subject and duration choices lead to existing availability search without creating a lesson', async () => {
  const { c, calls, sheets } = fixture(); c.startRosterAdd('s1');
  c.beginAddFlow('extra_lesson', { ...sheets[0].context, subjectId: 'piano' });
  assert.equal(sheets[1].title, '增加一堂課・上課時長');
  await c.searchAddAvailability({ ...sheets[1].context, durationMinutes: 60, durationChosen: true });
  const requests = calls.filter(([name]) => name.startsWith('coursePortal'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], 'coursePortalTeacherAvailability');
  assert.equal(requests[0][1].startDate, '2026-10-05');
  assert.equal(requests[0][1].exactTarget, false);
  assert.deepEqual(Array.from(requests[0][1].studentIds), ['s1']);
  assert.equal(c.planner.slots[0].date, '2026-10-05');
  assert.equal(c.planner.operationId, 'operation-1');
});
