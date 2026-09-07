'use strict';
const id = row => String(row && (row.id || row.__id) || '');
function canonicalStudentId(value, groups) {
  const found = (groups || []).find(group => group.active !== false && (group.memberIds || []).includes(value));
  return found ? found.id : value;
}
function projectCourseGroups(type, input, groups, options = {}) {
  let rows = (input || []).map(row => ({ ...row }));
  for (const group of groups || []) {
    if (group.active === false) continue;
    const members = new Set(group.memberIds || []), aliases = group.attendanceAliases || {};
    const inRange = row => !row.date || row.date >= group.startDate;
    if (type === 'students') {
      rows = rows.filter(row => options.includeAliases || !members.has(id(row)) || id(row) === group.id)
        .map(row => id(row) === group.id ? { ...row, identityName: row.identityName || row.name, name: group.name, memberIds: [...members], memberNames: group.memberNames || [] } : row);
    } else if (type === 'tuitionPeriods') {
      const hidden = new Set(group.hiddenPeriodIds || []);
      rows = rows.filter(row => !hidden.has(id(row)));
    } else if (type === 'attendance') {
      rows = rows.filter(row => !inRange(row) || !aliases[id(row)] || aliases[id(row)] === id(row));
    } else if (type === 'teacherPayroll') {
      const byId = new Map(rows.map(row => [id(row), row]));
      const removed = new Set();
      for (const row of rows) {
        if (!inRange(row) || !aliases[id(row)] || aliases[id(row)] === id(row)) continue;
        const primary = byId.get(aliases[id(row)]);
        // Do not silently discard an unmatched salary record.
        if (!primary || primary.groupId === group.id) continue;
        for (const key of ['teacherAmount', 'baseTeacherAmount', 'lessonPrice', 'tuitionAmount', 'schoolShare']) {
          if (row[key] != null || primary[key] != null) primary[key] = Number(primary[key] || 0) + Number(row[key] || 0);
        }
        primary.groupId = group.id; primary.studentName = group.name; primary.studentId = group.id;
        primary.componentPayrollIds = [id(primary), id(row)];
        removed.add(id(row));
      }
      rows = rows.filter(row => !removed.has(id(row)));
    } else if (['events', 'fixedCourses', 'temporaryCourses'].includes(type)) {
      rows = rows.map(row => {
        if (type !== 'fixedCourses' && !inRange(row)) return row;
        const courseIds = [row.id, row.sourceCourseId, row.courseId, row.fixedCourseId, row.seriesId];
        const explicit = (row.studentIds || []).filter(value => members.has(value));
        if (explicit.length < 2 && !courseIds.some(value => (group.sourceCourseIds || []).includes(value))) return row;
        return { ...row, studentIds: [...new Set((row.studentIds || []).map(value => members.has(value) ? group.id : value))],
          studentNames: [group.name], studentName: group.name, groupId: group.id };
      });
    }
  }
  return rows;
}
module.exports = { canonicalStudentId, projectCourseGroups };
