'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startInjiaoyunCloudSync } = require('../functions/injiaoyunManualSync');
const mirror = require('../functions/injiaoyunEducationMirror');
const { LEGACY_SYNC_DISABLED } = require('../functions/legacyCourseCutover');

test('cutover rejects every legacy job/import entry before reading or writing data', async () => {
  assert.equal(LEGACY_SYNC_DISABLED, true);
  for (const call of [
    () => startInjiaoyunCloudSync({}),
    () => mirror.runAuditForRange('2026-09-01', '2026-09-13'),
    () => mirror.syncLatestMirror(),
    () => mirror.syncRecentMirror('2026-09-01', '2026-09-13'),
    () => mirror.syncOperationsTeacherPayrollRange({})
  ]) await assert.rejects(call, { code: 'failed-precondition' });
});

test('legacy events cannot inspect or overwrite records after cutover', async () => {
  const endpoints = {};
  mirror.registerInjiaoyunEducationMirror(endpoints);
  const event = { get data() { throw new Error('must not consume legacy event'); } };
  for (const name of ['applyInjiaoyunEducationMirrorOnOperationsSuccess', 'applyInjiaoyunEducationMirrorOnMigration', 'applyInjiaoyunEducationMirrorOnAudit']) {
    await endpoints[name].run(event);
  }
  await assert.rejects(() => endpoints.syncInjiaoyunEducationMirrorNow.run({}), { code: 'failed-precondition' });
  assert.equal(typeof endpoints.loadInjiaoyunEducationMirror, 'function');
});
