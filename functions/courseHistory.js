'use strict';
const MIN_DATE = '2026-07-21';
const date = value => String(value || '').slice(0, 10);
function selectHistoryPeriods(periods, fromDate) {
  const groups = new Map();
  for (const row of periods) {
    const key = `${row.studentId}|${row.subjectId}|${row.teacherId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const result = [];
  for (const rows of groups.values()) {
    rows.sort((a, b) => date(a.startDate).localeCompare(date(b.startDate)) || a.periodNo - b.periodNo);
    if (fromDate) {
      // Include the period containing the selected day, then every later period.
      let first = rows.findIndex(row => date(row.startDate) > fromDate);
      first = first < 0 ? rows.length - 1 : Math.max(0, first - 1);
      result.push(...rows.filter((row, index) => row.outstandingAmount > 0 || index >= first));
    } else {
      const paid = rows.filter(row => row.outstandingAmount <= 0).slice(-2);
      result.push(...rows.filter(row => row.outstandingAmount > 0 || paid.includes(row)));
    }
  }
  return result.sort((a, b) => date(b.startDate).localeCompare(date(a.startDate)) || b.periodNo - a.periodNo);
}
function rentalRateForRole(role, mode, studentRequested, studentEligible, studentRate) {
  if (role === 'teacher') return mode === 'teacher' ? { rate: .5, label: '老師本人半價' } : { rate: 1, label: '一般價格' };
  return role === 'student' && studentRequested && studentEligible
    ? { rate: studentRate, label: '柚子學生半價' } : { rate: 1, label: '一般價格' };
}
module.exports = { MIN_DATE, selectHistoryPeriods, rentalRateForRole };
