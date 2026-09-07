'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertAuditCoverage } = require('../functions/injiaoyunAuditCoverage');
const dates = ['2026-07-21', '2026-07-22'];
const valid = () => ({ startDate: dates[0], endDate: dates[1], daySnapshotCount: 2, pageRawRecordCount: 812, daily: Object.fromEntries(dates.map(date => [date, { displayedDateMatched: true }])) });
test('accepts completely verified dates', () => assert.doesNotThrow(() => assertAuditCoverage(valid(), dates)));
test('rejects failed and missing date evidence before overwriting', () => {
  for (const value of [false, undefined, 'true']) {
    const run = valid(); run.daily[dates[0]].displayedDateMatched = value;
    assert.throws(() => assertAuditCoverage(run, dates), /未成功定位/);
  }
});
test('rejects truncated ranges, missing snapshots and capped records', () => {
  assert.throws(() => assertAuditCoverage(valid(), [dates[0]]), /範圍不完整/);
  assert.throws(() => assertAuditCoverage({ ...valid(), daySnapshotCount: 1 }, dates), /畫面筆數/);
  assert.throws(() => assertAuditCoverage({ ...valid(), pageRawRecordCount: 5000 }, dates), /擷取上限/);
});
test('actual schedule loader rejects a successful but mismatched run before reading candidates', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  let candidateReads = 0;
  const run = { ...valid(), status: 'success' };
  run.daily[dates[0]].displayedDateMatched = false;
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => run, ref: { collection: () => { candidateReads++; throw new Error('unexpected candidate access'); } } }) }) }) };
  const sandbox = { module: { exports: {} }, exports: {}, console, Buffer, Intl, Date, require: (name) => {
    if (name === 'firebase-admin') return { apps: [{}], firestore: () => db };
    if (name === 'firebase-functions/v2/https') return { onCall: () => {}, HttpsError: Error };
    if (name === 'firebase-functions/params') return { defineSecret: () => ({ value: () => '' }) };
    if (name === './injiaoyunAuditCoverage') return { assertAuditCoverage };
    if (name === './injiaoyunAuditPageRecords') return require('../functions/injiaoyunAuditPageRecords');
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../functions/injiaoyunEducationPreview'), 'utf8'), sandbox);
  await assert.rejects(sandbox.module.exports.latestAuditSchedule('bad-run'), /未成功定位/);
  assert.equal(candidateReads, 0);
  assert.equal(sandbox.module.exports.timeKey('14.5'), '14:30');
  assert.equal(sandbox.module.exports.timeKey('9.25'), '09:15');
  assert.equal(sandbox.module.exports.timeKey('2026-07-21'), '');
  assert.equal(sandbox.module.exports.frequencyWeeks('twoWeek'),2);
  assert.equal(sandbox.module.exports.frequencyWeeks('oneWeek'),1);
  assert.equal(sandbox.module.exports.fixedCourseFallbackAllowed({end:false,endDate:'2026-08-04'},'2026-07-21',''),true);
  assert.equal(sandbox.module.exports.fixedCourseFallbackAllowed({end:false,endDate:'2026-08-04'},'2026-08-04',''),false);
  assert.equal(sandbox.module.exports.fixedCourseFallbackAllowed({end:false},'2026-07-21',''),false);
});
