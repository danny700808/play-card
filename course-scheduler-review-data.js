(function () {
  'use strict';
  var cache = null;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function slug(value) { return clean(value).replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'; }
  function minutes(value) { var parts = clean(value).split(':'); return Number(parts[0]) * 60 + Number(parts[1] || 0); }
  function parseCSV(text) {
    var rows = [], row = [], field = '', quoted = false, i, char;
    for (i = 0; i < text.length; i += 1) {
      char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
      else field += char;
    }
    if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
    return rows.filter(function (entry) { return entry.length > 1 || entry[0]; });
  }
  function build(rows) {
    var header = rows.shift(), records = rows.map(function (cells) {
      var record = {}; header.forEach(function (key, index) { record[key] = clean(cells[index]); }); return record;
    });
    var visibleRecords = records.filter(function (record) { return clean(record['是否顯示']) === '是'; });
    var rooms = [], subjects = [], teachers = [], students = [], roomMap = {}, subjectMap = {}, teacherMap = {}, studentMap = {}, periodMap = {};
    function ensureRoom(record) { var key = clean(record['教室ID']) || slug(record['教室']); if (!roomMap[key]) { roomMap[key] = { id: key, name: clean(record['教室']) || '未指定教室', note: '', rentable: false, blockedSlots: {} }; rooms.push(roomMap[key]); } return roomMap[key]; }
    function ensureSubject(name) { var key = slug(name || '未指定科目'); if (!subjectMap[key]) { subjectMap[key] = { id: key, name: clean(name) || '未指定科目', active: true }; subjects.push(subjectMap[key]); } return subjectMap[key]; }
    function ensureTeacher(name) { var key = slug(name || '未指定老師'); if (!teacherMap[key]) { teacherMap[key] = { id: key, name: clean(name) || '未指定老師', phone: '', subjectIds: [], active: true }; teachers.push(teacherMap[key]); } return teacherMap[key]; }
    function ensureStudent(name) { var key = slug(name); if (!studentMap[key]) { studentMap[key] = { id: key, name: clean(name), phone: '', active: true, notes: '7/12～7/15 核對版：僅保留課表必要資料。' }; students.push(studentMap[key]); } return studentMap[key]; }
    records.forEach(function (record) {
      if (clean(record['類型']).indexOf('租用') < 0 && clean(record['學生'])) ensureStudent(record['學生']);
    });
    var events = visibleRecords.map(function (record, index) {
      var room = ensureRoom(record), subject = ensureSubject(record['科目']), teacher = ensureTeacher(record['老師']);
      if (teacher.subjectIds.indexOf(subject.id) < 0) teacher.subjectIds.push(subject.id);
      var isRental = clean(record['類型']).indexOf('租用') >= 0, student = isRental ? null : ensureStudent(record['學生']);
      var periodId = '';
      if (student) { periodId = 'review_period_' + student.id + '_' + subject.id; periodMap[periodId] = periodMap[periodId] || { id: periodId, studentId: student.id, subjectId: subject.id, teacherId: teacher.id, planId: 'review_plan_' + subject.id, periodNo: 1, startDate: '2026-07-12', lessonCount: 4, usedCount: 0, expectedAmount: 0, paidAmount: 0, status: 'active' }; }
      var eventType = isRental ? 'rental' : clean(record['類型']).indexOf('固定') >= 0 ? 'fixed' : 'single';
      return { id: 'review_' + index + '_' + slug(record['來源ID']), seriesId: '', date: record['日期'], roomId: room.id, start: record['開始'], duration: Math.max(30, minutes(record['結束']) - minutes(record['開始'])), type: eventType, frequency: 'once', studentIds: student ? [student.id] : [], teacherId: teacher.id, subjectId: subject.id, tuitionPeriodId: periodId, clientName: isRental ? clean(record['學生']) : '', rentalFee: 0, note: '來源 ' + clean(record['來源ID']) + '；' + clean(record['選取說明']), status: clean(record['簽到']).indexOf('是') === 0 ? 'attended' : 'scheduled', sourceId: clean(record['來源ID']), selection: clean(record['選取說明']) };
    });
    var sourceStatsByDate = {};
    records.forEach(function (record) {
      var date = clean(record['日期']), stats = sourceStatsByDate[date] || { studentRecords: 0, leaveRecords: 0, fixedRecords: 0, temporaryRecords: 0, rentalRecords: 0, visibleRecords: 0, hiddenRecords: 0, unresolvedRecords: 0 };
      var type = clean(record['類型']), judgment = clean(record['判定']);
      if (type.indexOf('租用') < 0 && clean(record['學生'])) stats.studentRecords += 1;
      if (judgment.indexOf('請假') >= 0) stats.leaveRecords += 1;
      if (type.indexOf('固定') >= 0) stats.fixedRecords += 1;
      if (type.indexOf('調課') >= 0) stats.temporaryRecords += 1;
      if (type.indexOf('租用') >= 0) stats.rentalRecords += 1;
      if (clean(record['是否顯示']) === '是') stats.visibleRecords += 1; else stats.hiddenRecords += 1;
      if (judgment.indexOf('人工核對') >= 0 || judgment.indexOf('缺失') >= 0) stats.unresolvedRecords += 1;
      sourceStatsByDate[date] = stats;
    });
    var feePlans = subjects.map(function (subject) { return { id: 'review_plan_' + subject.id, subjectId: subject.id, name: '核對用期別', amount: 0, lessonCount: 4, teacherShare: 0, active: true }; });
    return { readOnly: true, dataMode: 'review', currentDate: '2026-07-12', settings: { startHour: 10, endHour: 21, interval: 30, defaultLessons: 4 }, rooms: rooms, subjects: subjects, teachers: teachers, students: students, feePlans: feePlans, tuitionPeriods: Object.keys(periodMap).map(function (key) { return periodMap[key]; }), leaveReasons: [], events: events, dataMeta: { reviewRange: '2026-07-12 ～ 2026-07-15', selectionRule: '原始候選全部保留於核對 CSV；畫面僅顯示是否顯示為「是」的最後有效來源。請假釋放原固定課時段，綠色調課或紅色租用可佔用釋放後的格子；租用不扣堂。', sourceStatsByDate: sourceStatsByDate, dataQuality: { visibleEventCount: events.length, sourceRecordCount: records.length, excludedLeaveCount: records.filter(function (record) { return clean(record['判定']).indexOf('請假') >= 0; }).length, unresolvedTimeRecords: records.filter(function (record) { return clean(record['判定']).indexOf('人工核對') >= 0 || clean(record['判定']).indexOf('缺失') >= 0; }).length } } };
  }
  window.YouziCourseReviewData = { load: function () { if (cache) return Promise.resolve(clone(cache)); return fetch('course-scheduler-review-0712-0715.csv?v=20260724').then(function (response) { if (!response.ok) throw new Error('找不到 7/12～7/15 核對 CSV（HTTP ' + response.status + '）'); return response.text(); }).then(function (text) { cache = build(parseCSV(text.replace(/^\uFEFF/, ''))); return clone(cache); }); } };
}());
