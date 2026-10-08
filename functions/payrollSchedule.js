'use strict';
// A teaching month and its payment batch are distinct. All cutoffs use Taipei.
const clean = v => String(v == null ? '' : v).trim();
function shiftMonth(month, n) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Invalid payroll month');
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
function taipeiTimestamp(value) {
  if (!value) return '';
  let date;
  if (typeof value.toDate === 'function') date = value.toDate();
  else if (typeof value === 'object' && (value.seconds != null || value._seconds != null)) date = new Date(Number(value.seconds ?? value._seconds) * 1000);
  else if (value instanceof Date) date = value;
  else {
    const s = clean(value);
    // Historical nowText() values explicitly represent Taiwan local time.
    const local = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    date = new Date(local ? `${local[1]}-${local[2]}-${local[3]}T${local[4] === '24' ? '00' : local[4]}:${local[5]}:${local[6] || '00'}+08:00` : s);
  }
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}
function schedule(row) {
  const lessonDate = clean(row.lessonDate || row.date), lessonMonth = lessonDate.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(lessonMonth)) return {payoutNeedsReview: true, payoutLabel: '發放日期待核對'};
  const nominalMonth = shiftMonth(lessonMonth, 1);
  const native = ['teacher-late-attendance','teacher-attendance'].includes(row.source);
  const timestamp = native || row.type === 'late_attendance_fee' ? taipeiTimestamp(row.attendanceSignedAt || row.createdAt || row.createdAtText) : '';
  const late = row.source === 'teacher-late-attendance' || row.type === 'late_attendance_fee' || (native && timestamp.slice(0,10) > lessonDate);
  const signedAt = late ? timestamp : '';
  if (late && !signedAt) return {payoutNeedsReview: true, payoutLabel: '補簽時間待核對，尚未列入發放'};
  let paymentMonth = nominalMonth;
  if (late) {
    const eligibleMonth = Number(signedAt.slice(8, 10)) >= 10 ? shiftMonth(signedAt.slice(0, 7), 1) : signedAt.slice(0, 7);
    if (eligibleMonth > paymentMonth) paymentMonth = eligibleMonth;
  }
  const deferred = paymentMonth > nominalMonth, expectedPayDate = paymentMonth + '-10';
  return {lessonDate, attendanceSignedAt: signedAt, expectedPayDate,
    payoutBatchMonth: shiftMonth(paymentMonth, -1), payoutDeferred: deferred,
    payoutLabel: `${late ? '補簽：' + signedAt + '｜' : ''}預計發放：${expectedPayDate}${deferred ? '｜超過本期截止，順延下期' : ''}`};
}
function withSchedule(row) { return {...row, ...schedule(row)}; }
function active(row) { return row.active !== false && row.sourceActive !== false && !['cancelled', 'superseded'].includes(row.status); }
function batchRows(rows, month) { return rows.filter(r => active(r) && !r.payoutNeedsReview && r.payoutBatchMonth === month); }
module.exports = {shiftMonth, taipeiTimestamp, schedule, withSchedule, batchRows};
