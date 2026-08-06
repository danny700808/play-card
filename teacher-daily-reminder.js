(function (global) {
  'use strict';

  const DAILY_PREFIX = 'youzi.teacherPortal.dailyReminder.v1.';
  const SEEN_PREFIX = 'youzi.teacherPortal.seenRevision.v1.';
  const memory = Object.create(null);

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function safePart(value) {
    return encodeURIComponent(clean(value) || 'unknown');
  }

  function taipeiDateKey(value) {
    const date = value instanceof Date ? value : new Date(value == null ? Date.now() : value);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }

  function dailyKey(employeeId) {
    return DAILY_PREFIX + safePart(employeeId);
  }

  function revisionKey(employeeId, kind) {
    return SEEN_PREFIX + safePart(employeeId) + '.' + safePart(kind);
  }

  function read(storage, key) {
    try {
      const value = storage && storage.getItem(key);
      if (value != null) return clean(value);
    } catch (_) {}
    return clean(memory[key]);
  }

  function write(storage, key, value) {
    const text = clean(value);
    memory[key] = text;
    try {
      if (storage) storage.setItem(key, text);
    } catch (_) {}
    return text;
  }

  function shouldShowDaily(storage, employeeId, itemCount, now, available) {
    if (available === false || !clean(employeeId) || Number(itemCount || 0) <= 0) return false;
    const today = taipeiDateKey(now);
    return read(storage, dailyKey(employeeId)) !== today;
  }

  function markDailyShown(storage, employeeId, now) {
    if (!clean(employeeId)) return '';
    return write(storage, dailyKey(employeeId), taipeiDateKey(now));
  }

  function isRevisionUnseen(storage, employeeId, kind, revision, availableCount) {
    if (!clean(employeeId) || Number(availableCount || 0) <= 0) return false;
    const current = clean(revision) || ('count:' + Number(availableCount || 0));
    return read(storage, revisionKey(employeeId, kind)) !== current;
  }

  function markRevisionSeen(storage, employeeId, kind, revision, availableCount) {
    if (!clean(employeeId)) return '';
    const current = clean(revision) || ('count:' + Number(availableCount || 0));
    return write(storage, revisionKey(employeeId, kind), current);
  }

  global.YZTeacherDailyReminder = Object.freeze({
    taipeiDateKey,
    dailyKey,
    revisionKey,
    shouldShowDaily,
    markDailyShown,
    isRevisionUnseen,
    markRevisionSeen
  });
})(window);
