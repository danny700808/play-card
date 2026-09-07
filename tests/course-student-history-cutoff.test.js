'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isStudentHistoryDateVisible } = require('../functions/coursePortalUtils');

test('student lesson history starts inclusively at the verified migration date', () => {
  assert.equal(isStudentHistoryDateVisible('2026-07-20'), false);
  assert.equal(isStudentHistoryDateVisible('2026-07-21'), true);
  assert.equal(isStudentHistoryDateVisible('2026-09-30'), true);
  assert.equal(isStudentHistoryDateVisible('2027-01-01'), true);
  assert.equal(isStudentHistoryDateVisible(''), false);
  assert.equal(isStudentHistoryDateVisible(undefined), false);
});
