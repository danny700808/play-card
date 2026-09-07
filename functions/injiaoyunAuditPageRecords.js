'use strict';

function mergeAuditPageRecords(rawRows, candidateRows, captures, run, { dateKey, timeKey }) {
  const id = value => String(value && typeof value === 'object' ? value._id || value.id || '' : value || '');
  const raws = new Map(rawRows.map(row => [`${row.sourceType}|${row.sourceId}`, row]));
  const candidates = new Map(candidateRows.map(row => [`${row.sourceType}|${row.sourceId}|${row.dateKey}`, row]));
  for (const capture of captures) {
    const path = String(capture.urlPath || '');
    const endpoint = path.match(/\/(fixCourses|tempCourses|rentSpaces|leaves)\/one\/day(?:\?|$)/);
    if (!endpoint || !capture.record || capture.responseStatus !== 200) continue;
    const kind = { fixCourses: 'fixed-course', tempCourses: 'adjusted-course', rentSpaces: 'rental', leaves: 'leave' }[endpoint[1]];
    const raw = capture.record;
    const sourceId = id(raw);
    if (!sourceId) continue;
    const key = `${kind}|${sourceId}`;
    const previous = raws.get(key)?.raw || {};
    const merged = { ...previous, ...raw };
    for (const field of ['checkins', 'leaves', 'checkinLeaves', 'studentPayments']) {
      if (Array.isArray(previous[field]) || Array.isArray(raw[field])) {
        merged[field] = [...new Map([...(previous[field] || []), ...(raw[field] || [])].map(item => [id(item) || JSON.stringify(item), item])).values()];
      }
    }
    raws.set(key, { sourceType: kind, sourceId, raw: merged, relevantToRange: true });
    // Response completion can lag behind date navigation. Use the record's actual
    // date, never the mutable capture.requestedDate, for individual sessions.
    if (kind === 'fixed-course') continue;
    const date = dateKey(kind === 'leave' ? raw.date : raw.startDate);
    if (!date || date < run.startDate || date > run.endDate) continue;
    const students = Array.isArray(raw.students) ? raw.students : [raw.student].filter(Boolean);
    candidates.set(`${key}|${date}`, {
      sourceType: kind, sourceId, dateKey: date,
      startsAt: timeKey(raw.startsAt), endsAt: timeKey(raw.endsAt),
      roomId: id(raw.room), roomName: raw.room?.name || '',
      teacherId: id(raw.teacher), teacherName: raw.teacher?.name || '',
      subjectId: id(raw.subject), subjectName: raw.subject?.name || '',
      studentIds: students.map(id), studentNames: students.map(student => student.name || '').join('、'),
      clientName: raw.client?.name || '', cancel: raw.cancel === true,
      alreadyCheckin: raw.alreadyCheckin === true
    });
  }
  return { rawRows: [...raws.values()], candidateRows: [...candidates.values()] };
}

module.exports = { mergeAuditPageRecords };
