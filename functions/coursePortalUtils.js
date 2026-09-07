'use strict';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizePhone(value) {
  let digits = clean(value).replace(/\D/g, '');
  if (digits.startsWith('886')) digits = `0${digits.slice(3)}`;
  return digits;
}

function phoneMatches(left, right) {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  return Boolean(a && b && (a === b || a.slice(-9) === b.slice(-9)));
}

function normalizeScheduleStatus(value) {
  const source = value && typeof value === 'object'
    ? value.status || value.state || value.type || value.value
    : value;
  const status = clean(source).toLowerCase();
  if (['leave', 'sleave', 'tleave', '請假', '已請假'].includes(status)) return 'leave';
  if (['absent', 'absence', 'skip', '曠課', '缺席'].includes(status)) return 'absent';
  if (['cancel', 'cancelled', 'canceled', 'inactive', '註銷', '作廢', '取消', '已取消', '停課'].includes(status)) {
    return 'cancelled';
  }
  if (['attended', 'checkin', 'checked-in', '已簽到', '簽到'].includes(status)) return 'attended';
  return status || 'scheduled';
}

function courseSourceIds(row) {
  const source = row || {};
  return [...new Set([
    source.id,
    source.sourceId,
    source._id,
    source.__id,
    source.sourceCourseId,
    source.fixedCourseId,
    source.seriesId,
    source.courseId,
    source.scheduleId
  ].map(clean).filter(Boolean))];
}

// The verified migration begins here. Keep older records for accounting,
// but do not expose unverified lesson history in the student portal.
function isStudentHistoryDateVisible(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) && date >= '2026-07-21';
}

module.exports = {
  isStudentHistoryDateVisible,
  normalizePhone,
  phoneMatches,
  normalizeScheduleStatus,
  courseSourceIds
};
