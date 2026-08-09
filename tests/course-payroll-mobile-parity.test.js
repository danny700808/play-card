'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'course-scheduler-data.js'), 'utf8');
const sequence = [];
const firebase = {
  apps: [],
  initializeApp() { this.apps.push({}); },
  app() {
    return {
      functions() {
        return {
          httpsCallable(name) {
            return async (payload) => {
              sequence.push(`call:${name}`);
              assert.strictEqual(payload.scope, 'teacher-payroll-month');
              assert.strictEqual(payload.month, '2026-07');
              return {
                data: {
                  ok: true,
                  runId: 'payroll-cloud-current',
                  loadedAt: '2026-08-09T00:00:00.000Z',
                  teacherPayroll: [{
                    id: 'payroll-current',
                    teacherId: 'teacher-1',
                    teacherName: '測試老師',
                    studentId: 'student-1',
                    date: '2026-07-31',
                    teacherAmount: 900
                  }],
                  teacherAdjustments: []
                }
              };
            };
          }
        };
      }
    };
  }
};

const context = {
  APP_CONFIG: { FIREBASE_CONFIG: { projectId: 'youzi-test' } },
  firebase,
  getUser() { return { id: 'manager-1', role: 'manager' }; },
  YouziOperationsManagerAuth: {
    async ensureManagerAuth(runtime, manager) {
      sequence.push('auth');
      assert.strictEqual(runtime.APP_CONFIG.FIREBASE_CONFIG.projectId, 'youzi-test');
      assert.strictEqual(manager.id, 'manager-1');
      await Promise.resolve();
      return { ok: true };
    }
  },
  console,
  Date,
  Map,
  Set,
  Promise,
  setTimeout,
  clearTimeout
};
context.window = context;
context.globalThis = context;

vm.runInNewContext(source, context, { filename: 'course-scheduler-data.js' });

(async () => {
  const result = await context.YouziCoursePreviewData.loadTeacherPayrollMonth({
    month: '2026-07',
    manualSyncPin: 'legacy-pin-must-not-run-first'
  });
  assert.deepStrictEqual(sequence, ['auth', 'call:loadInjiaoyunEducationMirrorAuto']);
  assert.strictEqual(result.runId, 'payroll-cloud-current');
  assert.strictEqual(result.teacherPayroll.length, 1);
  assert.strictEqual(result.teacherPayroll[0].teacherAmount, 900);

  sequence.length = 0;
  context.YouziOperationsManagerAuth.ensureManagerAuth = async () => {
    sequence.push('auth-rejected');
    return { ok: false, message: '安全登入尚未恢復' };
  };
  await assert.rejects(
    context.YouziCoursePreviewData.loadTeacherPayrollMonth({
      month: '2026-07',
      manualSyncPin: 'legacy-pin-must-not-hide-the-error'
    }),
    /安全登入尚未恢復/
  );
  assert.deepStrictEqual(sequence, ['auth-rejected']);
  console.log('mobile and desktop teacher payroll cloud parity test passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
