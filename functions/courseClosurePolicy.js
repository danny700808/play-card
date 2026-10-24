'use strict';

const COLLECTION = 'courseClassClosures';
const clean = value => String(value == null ? '' : value).trim();
const reminderCodes = new Set(['teacher_daily_courses', 'teacher_evening_attendance']);
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function datesBetween(start, end) {
  if (!validDate(start) || !validDate(end) || end < start || (Date.parse(end)-Date.parse(start))/86400000 > 30) throw new Error('請選擇有效日期，單次最多設定 31 天。');
  const dates = [];
  for (let day = Date.parse(start); day <= Date.parse(end); day += 86400000) dates.push(new Date(day).toISOString().slice(0, 10));
  return dates;
}
async function closedDates(db, dates) {
  const keys = [...new Set(dates.filter(validDate))];
  const docs = await Promise.all(keys.map(date => db.collection(COLLECTION).doc(date).get()));
  return new Set(keys.filter((date, i) => docs[i].data()?.active === true));
}
function reminderDates(row) {
  if (!reminderCodes.has(row.eventCode)) return [];
  if (Array.isArray(row.reminderSections)) return [...new Set([row.noticeDate, ...row.reminderSections.map(s => s.date)].filter(validDate))];
  // Older queued reminders lack date metadata. Derive the same Taipei days
  // as the existing scheduler, including Tuesday's Sunday follow-up.
  const timestamp = row.createdAt?.toDate?.() || (row.createdAt?.seconds ? new Date(row.createdAt.seconds*1000) : new Date(row.createdAtText || Date.now()));
  const day = validDate(row.noticeDate) ? row.noticeDate : new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(Number.isFinite(+timestamp) ? timestamp : new Date());
  const prior = new Date(Date.parse(day) - (new Date(day).getUTCDay() === 2 ? 2 : 1)*86400000).toISOString().slice(0,10);
  return row.eventCode === 'teacher_evening_attendance' ? [day] : [day, prior];
}
function filterReminder(row, closed) {
  if (!reminderCodes.has(row.eventCode)) return {row, cancelled:false};
  const dates = reminderDates(row);
  if (!dates.some(date => closed.has(date))) return {row, cancelled:false};
  if (closed.has(row.noticeDate || dates[0]) || !Array.isArray(row.reminderSections)) return {row, cancelled:true};
  const sections = row.reminderSections.filter(section => !closed.has(section.date));
  if (!sections.length) return {row, cancelled:true};
  return {cancelled:false,row:{...row,reminderSections:sections,body:[...sections.map(s => s.body),row.reminderFooter].filter(Boolean).join('\n\n')}};
}
async function prepareReminder(db, row) {
  if(row.source==='course-portal-room-booking' && row.bookingId){
    const booking=(await db.collection('coursePortalRoomBookings').doc(row.bookingId).get()).data();
    if(!booking || booking.active===false || booking.status==='cancelled')return {row,cancelled:true};
    return {row,cancelled:(await closedDates(db,[booking.date])).has(booking.date)};
  }
  const dates = reminderDates(row);
  return dates.length ? filterReminder(row, await closedDates(db, dates)) : {row,cancelled:false};
}
module.exports = {COLLECTION, validDate, datesBetween, closedDates, reminderDates, filterReminder, prepareReminder};
