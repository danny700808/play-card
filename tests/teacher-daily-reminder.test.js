'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'teacher-daily-reminder.js'), 'utf8');

function loadReminder() {
  const window = {};
  const context = vm.createContext({
    window,
    Date,
    Intl,
    Number,
    Object,
    String,
    encodeURIComponent
  });
  new vm.Script(source, { filename: 'teacher-daily-reminder.js' }).runInContext(context);
  return window.YZTeacherDailyReminder;
}

function storage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    }
  };
}

test('daily reminder uses the Taipei calendar day', () => {
  const reminder = loadReminder();

  assert.equal(reminder.taipeiDateKey('2026-08-05T15:59:59.000Z'), '2026-08-05');
  assert.equal(reminder.taipeiDateKey('2026-08-05T16:00:00.000Z'), '2026-08-06');
});

test('the same teacher sees one reminder per Taipei day even after the session token changes', () => {
  const reminder = loadReminder();
  const localStorage = storage();
  const employeeId = 'EMP-007';
  const firstToken = 'teacher-session-a';
  const renewedToken = 'teacher-session-b';
  const now = '2026-08-06T02:00:00.000Z';

  assert.notEqual(firstToken, renewedToken, 'test setup must actually renew the token');
  assert.equal(reminder.shouldShowDaily(localStorage, employeeId, 3, now), true);
  reminder.markDailyShown(localStorage, employeeId, now);
  assert.equal(reminder.shouldShowDaily(localStorage, employeeId, 3, now), false);
  assert.equal(reminder.dailyKey(employeeId).includes(firstToken), false);
  assert.equal(reminder.dailyKey(employeeId).includes(renewedToken), false);
});

test('daily reminder state is separated by employee id and resets the next day', () => {
  const reminder = loadReminder();
  const localStorage = storage();
  const today = '2026-08-06T08:00:00.000Z';
  const tomorrow = '2026-08-07T08:00:00.000Z';

  reminder.markDailyShown(localStorage, 'EMP-A', today);
  assert.equal(reminder.shouldShowDaily(localStorage, 'EMP-A', 1, today), false);
  assert.equal(reminder.shouldShowDaily(localStorage, 'EMP-B', 1, today), true);
  assert.equal(reminder.shouldShowDaily(localStorage, 'EMP-A', 1, tomorrow), true);
  assert.equal(reminder.shouldShowDaily(localStorage, 'EMP-A', 0, tomorrow), false);
});

test('an incomplete pending summary cannot consume the daily reminder', () => {
  const reminder = loadReminder();
  const localStorage = storage();
  const now = '2026-08-06T08:00:00.000Z';

  assert.equal(reminder.shouldShowDaily(localStorage, 'EMP-PARTIAL', 3, now, false), false);
  assert.equal(reminder.shouldShowDaily(localStorage, 'EMP-PARTIAL', 3, now, true), true);
});

test('storage exceptions fall back to in-memory state without showing twice', () => {
  const reminder = loadReminder();
  const brokenStorage = {
    getItem() {
      throw new Error('storage blocked');
    },
    setItem() {
      throw new Error('storage blocked');
    }
  };
  const now = '2026-08-06T08:00:00.000Z';

  assert.doesNotThrow(() => reminder.shouldShowDaily(brokenStorage, 'EMP-BLOCKED', 2, now));
  assert.equal(reminder.shouldShowDaily(brokenStorage, 'EMP-BLOCKED', 2, now), true);
  assert.doesNotThrow(() => reminder.markDailyShown(brokenStorage, 'EMP-BLOCKED', now));
  assert.equal(reminder.shouldShowDaily(brokenStorage, 'EMP-BLOCKED', 2, now), false);
});

test('announcement and goods revisions are tracked independently for each teacher', () => {
  const reminder = loadReminder();
  const localStorage = storage();

  assert.equal(reminder.isRevisionUnseen(localStorage, 'EMP-A', 'announcements', 'rev-1', 2), true);
  reminder.markRevisionSeen(localStorage, 'EMP-A', 'announcements', 'rev-1', 2);
  assert.equal(reminder.isRevisionUnseen(localStorage, 'EMP-A', 'announcements', 'rev-1', 2), false);
  assert.equal(reminder.isRevisionUnseen(localStorage, 'EMP-A', 'goods', 'rev-1', 2), true);
  assert.equal(reminder.isRevisionUnseen(localStorage, 'EMP-B', 'announcements', 'rev-1', 2), true);
  assert.equal(reminder.isRevisionUnseen(localStorage, 'EMP-A', 'announcements', 'rev-2', 2), true);
  assert.equal(reminder.isRevisionUnseen(localStorage, 'EMP-A', 'announcements', 'rev-2', 0), false);
});

test('goods and inquiry reply revisions do not overwrite each other', () => {
  const reminder = loadReminder();
  const localStorage = storage();

  reminder.markRevisionSeen(localStorage, 'EMP-A', 'goods', 'goods-rev-1', 5);
  reminder.markRevisionSeen(localStorage, 'EMP-A', 'goods-attention', 'reply-rev-1', 1);
  assert.equal(reminder.isRevisionUnseen(localStorage, 'EMP-A', 'goods', 'goods-rev-1', 5), false);
  assert.equal(reminder.isRevisionUnseen(localStorage, 'EMP-A', 'goods-attention', 'reply-rev-1', 1), false);
  assert.equal(reminder.isRevisionUnseen(localStorage, 'EMP-A', 'goods-attention', 'reply-rev-2', 1), true);
  assert.equal(reminder.isRevisionUnseen(localStorage, 'EMP-A', 'goods', 'goods-rev-1', 5), false);
});
