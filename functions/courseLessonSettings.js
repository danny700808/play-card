'use strict';
function lessonMatches(row, setting) {
  const date = String(row.date || row.startDate || '').slice(0, 10);
  if (date !== setting.date) return false;
  const ids = [row.id, row.__id, row.sourceId, row.sourceCourseId, row.courseId, row.fixedCourseId, row.seriesId, row.portalChangeId, row.portalBookingId].filter(Boolean);
  return ids.some(value => (setting.eventIds || []).includes(value)) && (!setting.teacherId || row.teacherId === setting.teacherId);
}
function applyLessonSettings(rows, settings) {
  return rows.map(row => {
    const matching = settings.filter(setting => lessonMatches(row, setting));
    return Object.assign({}, row, ...matching.map(setting => setting.fields || {}));
  });
}
module.exports = { lessonMatches, applyLessonSettings };
