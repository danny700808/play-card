const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const policy = require('../functions/portalNotificationPolicy');
const source = fs.readFileSync('functions/coursePortal.js', 'utf8');
function extract(name) { const a = source.indexOf(`async function ${name}(`); return source.slice(a, source.indexOf('\n}', a) + 2); }
test('LINE priority, Email-only, and explicit failure fallback do not duplicate uncertain deliveries', () => {
  assert.equal(policy.recipientFields({ lineUserId: 'U1', email: 'a@example.test' }).channel, 'line');
  assert.equal(policy.recipientFields({ email: 'a@example.test' }).channel, 'email');
  const row = { ...policy.recipientFields({ lineUserId: 'U1', email: 'a@example.test' }), body: '內容', lineImageUrl: 'https://example.test/receipt.png' };
  assert.equal(policy.fallbackEmail(row, new Error('timeout')), null);
  const result = policy.fallbackEmail(row, { lineRejected: true });
  assert.equal(result.channel, 'email');
  assert.match(result.body, /本次 LINE 通知未能成功送達/);
  assert.match(result.body, /receipt.png/);
  assert.equal(result.emailFallbackEnabled, false);
});
async function tuitionRun({ events = [], bindings = [{ studentId: 's', email: 'parent@example.test', reminderPayment: true }], requests = [] }) {
  const queued = [];
  const ctx = { ...policy, clean: v => String(v || ''), currentTaipeiDay: () => '2026-09-12',
    eventDate: row => row.date, eventSubjectId: row => row.subjectId, eventStudentIds: row => row.studentIds,
    normalizeScheduleStatus: v => v, hash: v => v, PORTAL_BASE: 'https://example.test', TUITION_PAYMENT_REQUESTS: 'requests',
    scheduleBundle: async () => ({ resourceEvents: events, maps: { students: {}, subjects: {}, teachers: {} } }),
    mirrorRows: async () => [], assignNewSystemPeriodNumbers: async rows => rows, ensureTuitionPaymentRequests: async () => {},
    queueCoursePortalNotice: async (id, row) => queued.push({ id, ...row }),
    db: { collection: name => ({ where() { return this; }, async get() { return { docs: (name === 'requests' ? requests : bindings).map((row, n) => ({ id: String(n), data: () => row })) }; } }) }
  };
  vm.runInNewContext(extract('dailyStudentReminders'), ctx);
  await ctx.dailyStudentReminders(); return queued;
}
test('tuition notice requires actual lesson, unpaid balance and opt-in; amount reflects partial payment', async () => {
  const lesson = { date: '2026-09-12', studentIds: ['s'], subjectId: 'piano', status: 'scheduled' };
  const due = { studentId: 's', studentName: '測試學生', subjectId: 'piano', expectedAmount: 3000, confirmedAmount: 1000 };
  assert.equal((await tuitionRun({ requests: [due] })).length, 0);
  assert.equal((await tuitionRun({ events: [{ ...lesson, status: 'leave' }], requests: [due] })).length, 0);
  assert.equal((await tuitionRun({ events: [lesson], requests: [{ ...due, confirmedAmount: 3000 }] })).length, 0);
  assert.equal((await tuitionRun({ events: [lesson], requests: [due], bindings: [{ studentId: 's', email: 'a@b.test', reminderPayment: false }] })).length, 0);
  const notices = await tuitionRun({ events: [lesson], requests: [due] });
  assert.equal(notices.length, 1); assert.match(notices[0].body, /2,000/); assert.doesNotMatch(notices[0].body, /今天|上課時間|最後一堂/);
  assert.equal(notices[0].channel, 'email');
});
test('all login security notices remain silent', async () => {
  const context = {}; vm.runInNewContext(extract('queueSessionSecurityNotice'), context);
  for (const role of ['teacher', 'student', 'renter']) await context.queueSessionSecurityNotice('id', { role });
});
test('historical correction reserves the original grid position rather than a new term', async () => {
  const records = ['2026-08-01','2026-08-08','2026-08-15','2026-08-22'].map((date,n) => ({id:`a${n}`,date,studentId:'s',teacherId:'t',subjectId:'p',periodId:'term',status:'attended'}));
  const context={clean:v=>String(v||''),mirrorRowsByField:async type=>type==='attendance'?records:[{id:'term',systemPeriodNo:1,lessonCount:4}],
    portalAttendanceForStudents:async()=>[],assignNewSystemPeriodNumbers:async rows=>rows,mergePortalAttendanceRows:rows=>rows,
    eventDate:r=>r.date,eventTeacherId:r=>r.teacherId,eventSubjectId:r=>r.subjectId,eventStart:()=>'',sourceId:r=>r.id,
    normalizeScheduleStatus:v=>v,HttpsError:Error,db:{collection:()=>({where(){return this},get:async()=>({docs:[]})})}};
  vm.runInNewContext(extract('attendanceCorrectionSlots'),context);
  const slots=await context.attendanceCorrectionSlots({id:'cancel',studentIds:['s'],studentNames:['測試'],teacherId:'t',subjectId:'p',date:'2026-08-01'});
  assert.equal(slots[0].periodId,'term');assert.equal(slots[0].slotNo,1);assert.equal(slots[0].originalDate,'2026-08-01');
});
