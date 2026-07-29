(function (global) {
  'use strict';

  var DB_NAME = 'youzi-course-scheduler';
  var STORE_NAME = 'formalSnapshots';
  var WORKSPACE_KEY = 'workspace';
  var LATEST_KEY = 'latest';
  var LEGACY_KEYS = [
    'youzi.courseScheduler.formalCache.v1',
    'youzi.courseScheduler.sandbox.v1'
  ];
  var PIN_KEYS = [
    'youzi.injiaoyun.preview.pin',
    'youzi.injiaoyun.manualSyncPin.v1',
    'youzi.injiaoyun.sync.pin',
    'injiaoyunMigrationPin'
  ];

  var state = null;
  var sourceName = '';
  var diagnostics = [];
  var currentPage = 'calendar';
  var currentDate = dateKey(new Date());
  var toastTimer = 0;

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value == null ? '' : value).trim(); }
  function numberOf(value) { var parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function array(value) { return Array.isArray(value) ? value : []; }
  function pad(value) { return String(value).padStart(2, '0'); }
  function dateKey(value) {
    var date = value instanceof Date ? value : new Date(clean(value).slice(0, 10) + 'T12:00:00');
    if (!Number.isFinite(date.getTime())) return '';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
  function shiftDate(key, days) {
    var date = new Date(key + 'T12:00:00');
    date.setDate(date.getDate() + Number(days || 0));
    return dateKey(date);
  }
  function weekdayName(key) {
    return ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][new Date(key + 'T12:00:00').getDay()];
  }
  function timeToMinutes(value) {
    var parts = clean(value || '00:00').split(':');
    return numberOf(parts[0]) * 60 + numberOf(parts[1]);
  }
  function minutesToTime(value) { return pad(Math.floor(value / 60)) + ':' + pad(value % 60); }
  function money(value) { return 'NT$ ' + Math.round(numberOf(value)).toLocaleString('zh-TW'); }
  function esc(value) {
    return clean(value).replace(/[&<>'"]/g, function (ch) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];
    });
  }
  function byId(rows, id) { return array(rows).find(function (row) { return clean(row && row.id) === clean(id); }) || {}; }
  function sum(rows, getter) { return array(rows).reduce(function (total, row) { return total + numberOf(getter(row)); }, 0); }

  function setStatus(title, text, kind) {
    $('statusTitle').textContent = title;
    $('statusText').textContent = text;
    $('statusPanel').classList.toggle('ready', kind === 'ready');
    $('statusPanel').classList.toggle('error', kind === 'error');
  }

  function setSource(name, error) {
    sourceName = name || '';
    $('sourceBadge').textContent = name || '尚未載入';
    $('sourceBadge').classList.toggle('ready', Boolean(name) && !error);
    $('sourceBadge').classList.toggle('error', Boolean(error));
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('show');
    toastTimer = setTimeout(function () { $('toast').classList.remove('show'); }, 2800);
  }

  function demoState(candidate) {
    var names = array(candidate && candidate.students).map(function (row) { return clean(row.name); });
    var demoCount = names.filter(function (name) { return /^示範學生\s*[A-F]$/i.test(name); }).length;
    return demoCount >= 2 && !clean(candidate && candidate.dataMeta && candidate.dataMeta.runId);
  }

  function validState(candidate) {
    if (!candidate || Number(candidate.version) !== 3 || demoState(candidate)) return false;
    var keys = ['rooms','students','teachers','subjects','feePlans','tuitionPeriods','events','recurringRules','fixedCourses','temporaryCourses','roomRentals'];
    return keys.some(function (key) { return array(candidate[key]).length > 0; }) || Boolean(clean(candidate.dataMeta && candidate.dataMeta.runId));
  }

  function normalizeState(candidate) {
    var next = clone(candidate || {});
    next.version = 3;
    ['rooms','students','teachers','subjects','feePlans','tuitionPeriods','events','recurringRules','fixedCourses','temporaryCourses','roomRentals','attendance','teacherPayroll','teacherAdjustments','leaveReasons'].forEach(function (key) {
      if (!Array.isArray(next[key])) next[key] = [];
    });
    if (!next.settings || typeof next.settings !== 'object') next.settings = {};
    next.settings.startHour = Math.max(6, Math.min(22, numberOf(next.settings.startHour) || 9));
    next.settings.endHour = Math.max(next.settings.startHour + 1, Math.min(24, numberOf(next.settings.endHour) || 22));
    next.settings.interval = 30;
    next.currentDate = dateKey(next.currentDate) || currentDate;
    next.readOnly = false;
    next.dataMode = 'workspace';
    next.clipboard = null;
    if (!next.sandboxMeta || typeof next.sandboxMeta !== 'object') next.sandboxMeta = {};
    next.sandboxMeta.updatedAt = new Date().toISOString();
    return next;
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { resolve(null); return; }
      var request = global.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB 無法開啟')); };
    });
  }

  async function readDatabase() {
    var db = await openDatabase();
    if (!db) return { workspace: null, latest: null };
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readonly');
      var store = tx.objectStore(STORE_NAME);
      var workspaceRequest = store.get(WORKSPACE_KEY);
      var latestRequest = store.get(LATEST_KEY);
      tx.oncomplete = function () {
        var result = { workspace: workspaceRequest.result || null, latest: latestRequest.result || null };
        db.close();
        resolve(result);
      };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB 讀取失敗')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB 讀取中止')); };
    });
  }

  async function writeDatabase(latest, workspace) {
    var db = await openDatabase();
    if (!db) throw new Error('瀏覽器不支援本機課務資料庫');
    await new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      if (latest) store.put(latest, LATEST_KEY);
      if (workspace) store.put(workspace, WORKSPACE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error || new Error('課務資料儲存失敗')); };
      tx.onabort = function () { reject(tx.error || new Error('課務資料儲存中止')); };
    });
    db.close();
  }

  function readLegacyState() {
    for (var index = 0; index < LEGACY_KEYS.length; index += 1) {
      try {
        var parsed = JSON.parse(global.localStorage.getItem(LEGACY_KEYS[index]) || 'null');
        diagnostics.push(LEGACY_KEYS[index] + ': ' + (validState(parsed) ? '有效' : parsed ? '無效或示範資料' : '沒有'));
        if (validState(parsed)) return parsed;
      } catch (_) {
        diagnostics.push(LEGACY_KEYS[index] + ': 解析失敗');
      }
    }
    return null;
  }

  function readStoredPin() {
    for (var index = 0; index < PIN_KEYS.length; index += 1) {
      try {
        var pin = clean(global.localStorage.getItem(PIN_KEYS[index]));
        if (pin) return pin;
      } catch (_) {}
    }
    return '';
  }

  function storePin(pin) {
    try { global.localStorage.setItem(PIN_KEYS[0], clean(pin)); } catch (_) {}
  }

  async function loadMirror(pin) {
    if (!global.YouziCoursePreviewData || typeof global.YouziCoursePreviewData.load !== 'function') {
      throw new Error('音教雲鏡像元件尚未載入');
    }
    setStatus('正在讀取音教雲已同步鏡像', '不重新同步舊系統，只讀取雲端已保存的正式資料。', '');
    var loaded = await global.YouziCoursePreviewData.load({ manualSyncPin: pin, anchorDate: currentDate });
    if (!validState(loaded)) throw new Error('鏡像已讀取，但沒有可用的正式課務資料');
    var latest = clone(loaded);
    latest.readOnly = true;
    latest.dataMode = 'latest';
    var workspace = normalizeState(loaded);
    await writeDatabase(latest, workspace);
    storePin(pin);
    diagnostics.push('音教雲鏡像: 成功，教室 ' + workspace.rooms.length + '、學生 ' + workspace.students.length + '、事件 ' + workspace.events.length);
    return workspace;
  }

  async function resolveData(forceMirror, explicitPin) {
    diagnostics = [];
    $('recoveryPanel').classList.add('hidden');
    setSource('讀取中', false);
    setStatus('正在尋找正式課務資料', '依序檢查 workspace、latest、舊正式快取與音教雲已同步鏡像。', '');

    if (!forceMirror) {
      try {
        var saved = await readDatabase();
        diagnostics.push('workspace: ' + (validState(saved.workspace) ? '有效' : saved.workspace ? '無效或示範資料' : '沒有'));
        diagnostics.push('latest: ' + (validState(saved.latest) ? '有效' : saved.latest ? '無效或示範資料' : '沒有'));
        if (validState(saved.workspace)) return useResolvedState(saved.workspace, 'workspace');
        if (validState(saved.latest)) {
          var clonedWorkspace = normalizeState(saved.latest);
          await writeDatabase(saved.latest, clonedWorkspace);
          return useResolvedState(clonedWorkspace, 'latest → workspace');
        }
      } catch (error) {
        diagnostics.push('IndexedDB: ' + clean(error && error.message || error));
      }

      var legacy = readLegacyState();
      if (legacy) {
        var legacyWorkspace = normalizeState(legacy);
        await writeDatabase(legacy, legacyWorkspace);
        return useResolvedState(legacyWorkspace, '舊正式快取 → workspace');
      }
    }

    var pin = clean(explicitPin) || readStoredPin();
    diagnostics.push('已保存同步密碼: ' + (pin ? '有' : '沒有'));
    if (pin) {
      try {
        return useResolvedState(await loadMirror(pin), '音教雲已同步鏡像');
      } catch (mirrorError) {
        diagnostics.push('鏡像讀取: ' + clean(mirrorError && mirrorError.message || mirrorError));
      }
    }

    state = null;
    setSource('沒有正式資料', true);
    setStatus('沒有找到正式課務資料', '請輸入同步密碼讀取音教雲已同步鏡像；系統不會顯示示範學生。', 'error');
    $('diagnosticText').textContent = diagnostics.join('\n');
    $('recoveryPanel').classList.remove('hidden');
    renderAll();
    return null;
  }

  function useResolvedState(candidate, source) {
    state = normalizeState(candidate);
    sourceName = source;
    currentDate = dateKey(state.currentDate) || currentDate;
    setSource(source, false);
    setStatus('正式課務資料已載入', '教室 ' + state.rooms.length + ' 間、學生 ' + state.students.length + ' 位、課程事件 ' + state.events.length + ' 筆。', 'ready');
    $('recoveryPanel').classList.add('hidden');
    $('diagnosticText').textContent = diagnostics.join('\n');
    renderAll();
    return state;
  }

  function normalizedStatus(status) {
    var value = clean(status).toLowerCase();
    if (['cancel','cancelled','canceled','inactive','取消','註銷','停課'].indexOf(value) >= 0) return 'cancelled';
    if (['leave','請假','已請假'].indexOf(value) >= 0) return 'leave';
    if (['absent','曠課','缺席'].indexOf(value) >= 0) return 'absent';
    if (['attended','checkin','checked-in','簽到','已簽到'].indexOf(value) >= 0) return 'attended';
    return 'scheduled';
  }

  function recurringOccurs(rule, targetDate) {
    if (!rule || rule.active === false) return false;
    var start = dateKey(rule.startDate || rule.date);
    var end = dateKey(rule.endDate);
    if (!start || targetDate < start || (end && targetDate > end)) return false;
    var startDate = new Date(start + 'T12:00:00');
    var target = new Date(targetDate + 'T12:00:00');
    if (startDate.getDay() !== target.getDay()) return false;
    var weeks = Math.floor((target - startDate) / 604800000);
    return weeks >= 0 && weeks % Math.max(1, numberOf(rule.intervalWeeks) || 1) === 0;
  }

  function eventsForDate(targetDate) {
    if (!state) return [];
    var stored = array(state.events).filter(function (event) {
      return dateKey(event.date) === targetDate && normalizedStatus(event.status) !== 'cancelled';
    });
    var overrides = new Set(stored.map(function (event) { return clean(event.recurrenceKey); }).filter(Boolean));
    var recurring = array(state.recurringRules).filter(function (rule) {
      return recurringOccurs(rule, targetDate) && !overrides.has(clean(rule.id) + '@' + targetDate);
    }).map(function (rule) {
      return Object.assign({}, rule, {
        id: 'rec_' + clean(rule.id) + '@' + targetDate,
        recurrenceKey: clean(rule.id) + '@' + targetDate,
        date: targetDate,
        type: clean(rule.type) || 'fixed',
        status: 'scheduled'
      });
    });
    var rentals = array(state.roomRentals).filter(function (row) {
      return dateKey(row.date) === targetDate && normalizedStatus(row.status) !== 'cancelled';
    }).map(function (row, index) {
      return Object.assign({ id: 'rental_' + index, type: 'rental', duration: 60, status: 'scheduled' }, row, { date: targetDate });
    });
    var seen = new Map();
    stored.concat(recurring, rentals).forEach(function (event) {
      var key = [event.date,event.roomId,event.start,numberOf(event.duration),(event.studentIds || []).join(','),event.clientName].join('|');
      if (!seen.has(key) || !event.recurrenceKey) seen.set(key, event);
    });
    return Array.from(seen.values()).sort(function (left, right) {
      return timeToMinutes(left.start) - timeToMinutes(right.start);
    });
  }

  function eventTypeClass(event) {
    var status = normalizedStatus(event.status);
    if (status === 'leave' || status === 'absent') return 'leave';
    var type = clean(event.type).toLowerCase();
    if (type === 'rental') return 'rental';
    if (type === 'trial') return 'trial';
    if (type === 'single' || type === 'temporary' || type === 'reschedule') return 'single';
    return 'fixed';
  }

  function eventName(event) {
    if (clean(event.type) === 'rental') return clean(event.clientName) || '教室租用';
    var names = array(event.studentIds).map(function (id) { return clean(byId(state.students, id).name); }).filter(Boolean);
    return names.join('、') || clean(event.clientName) || '未指定學生';
  }

  function metric(label, value, note) {
    return '<article class="metric card"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong><small>' + esc(note) + '</small></article>';
  }

  function renderCalendar() {
    $('dateInput').value = currentDate;
    $('dateLabel').textContent = currentDate.replace(/-/g, '/') + ' ' + weekdayName(currentDate);
    if (!state) {
      $('calendarMetrics').innerHTML = metric('今日課程','—','等待正式資料') + metric('已簽到','—','等待正式資料') + metric('教室使用','—','等待正式資料') + metric('待處理','—','等待正式資料');
      $('scheduleGrid').innerHTML = '';
      $('scheduleEmpty').textContent = '尚未載入正式資料。請在上方輸入同步密碼讀取已同步鏡像。';
      $('scheduleEmpty').classList.remove('hidden');
      return;
    }

    var rooms = array(state.rooms).filter(function (row) { return row.active !== false; }).sort(function (a, b) { return numberOf(a.sort) - numberOf(b.sort); });
    var events = eventsForDate(currentDate);
    var attended = events.filter(function (event) { return normalizedStatus(event.status) === 'attended'; }).length;
    var usedRooms = new Set(events.map(function (event) { return clean(event.roomId); }).filter(Boolean)).size;
    var warnings = events.filter(function (event) { var status = normalizedStatus(event.status); return status === 'leave' || status === 'absent'; }).length;
    $('calendarMetrics').innerHTML = metric('今日課程',events.filter(function (event) { return clean(event.type) !== 'rental'; }).length,'不含教室租用') + metric('已簽到',attended,'依正式狀態') + metric('教室使用',usedRooms + ' / ' + rooms.length,'有安排／啟用') + metric('待處理',warnings,'請假或曠課');

    if (!rooms.length) {
      $('scheduleGrid').innerHTML = '';
      $('scheduleEmpty').textContent = '正式資料已載入，但目前沒有教室資料。請檢查音教雲鏡像內容。';
      $('scheduleEmpty').classList.remove('hidden');
      return;
    }
    $('scheduleEmpty').classList.add('hidden');

    var startHour = Math.max(6, Math.min(22, numberOf(state.settings.startHour) || 9));
    var endHour = Math.max(startHour + 1, Math.min(24, numberOf(state.settings.endHour) || 22));
    var slotCount = (endHour - startHour) * 2;
    var html = '<div class="grid-corner" style="grid-column:1;grid-row:1">時間</div>';
    rooms.forEach(function (room, index) {
      html += '<div class="room-head" style="grid-column:' + (index + 2) + ';grid-row:1">' + esc(room.publicName || room.name || ('教室 ' + (index + 1))) + '</div>';
    });
    for (var slot = 0; slot < slotCount; slot += 1) {
      var minute = startHour * 60 + slot * 30;
      var row = slot + 2;
      var hourClass = slot % 2 === 0 ? ' hour' : '';
      html += '<div class="time-label' + hourClass + '" style="grid-column:1;grid-row:' + row + '">' + (slot % 2 === 0 ? minutesToTime(minute) : '') + '</div>';
      rooms.forEach(function (room, roomIndex) {
        html += '<button class="slot' + hourClass + '" type="button" data-room="' + esc(room.id) + '" data-time="' + minutesToTime(minute) + '" style="grid-column:' + (roomIndex + 2) + ';grid-row:' + row + '"></button>';
      });
    }
    events.forEach(function (event) {
      var roomIndex = rooms.findIndex(function (room) { return clean(room.id) === clean(event.roomId); });
      var start = timeToMinutes(event.start);
      if (roomIndex < 0 || start < startHour * 60 || start >= endHour * 60) return;
      var startSlot = Math.floor((start - startHour * 60) / 30);
      var span = Math.max(1, Math.ceil((numberOf(event.duration) || 60) / 30));
      var teacher = clean(byId(state.teachers, event.teacherId).name);
      var subject = clean(byId(state.subjects, event.subjectId).name);
      html += '<button class="course-event ' + eventTypeClass(event) + '" type="button" title="' + esc([eventName(event),subject,teacher,event.start].filter(Boolean).join('・')) + '" style="grid-column:' + (roomIndex + 2) + ';grid-row:' + (startSlot + 2) + ' / span ' + Math.min(span, slotCount - startSlot) + '"><time>' + esc(event.start) + '</time><b>' + esc(eventName(event)) + '</b><span>' + esc([subject,teacher].filter(Boolean).join('・')) + '</span></button>';
    });
    $('scheduleGrid').style.gridTemplateColumns = '66px repeat(' + rooms.length + ',minmax(140px,1fr))';
    $('scheduleGrid').style.gridTemplateRows = '58px repeat(' + slotCount + ',var(--slot))';
    $('scheduleGrid').innerHTML = html;
  }

  function latestPeriod(studentId) {
    return array(state && state.tuitionPeriods).filter(function (row) { return clean(row.studentId) === clean(studentId); }).sort(function (a, b) {
      return clean(b.startDate).localeCompare(clean(a.startDate)) || numberOf(b.periodNo) - numberOf(a.periodNo);
    })[0] || {};
  }

  function periodPaid(period) {
    return sum(period.transactions, function (row) { return clean(row.type) === 'refund' ? -numberOf(row.amount) : numberOf(row.amount); });
  }

  function periodRemaining(period) { return Math.max(0, numberOf(period.lessonCount) - numberOf(period.voidedLessonCount) - numberOf(period.usedCount)); }

  function nextEvent(studentId) {
    if (!state) return {};
    var now = currentDate;
    return array(state.events).filter(function (event) {
      return dateKey(event.date) >= now && array(event.studentIds).indexOf(studentId) >= 0 && normalizedStatus(event.status) !== 'cancelled';
    }).sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); })[0] || {};
  }

  function renderStudents() {
    if (!state) {
      $('studentMetrics').innerHTML = metric('學生總數','—','等待正式資料') + metric('學費期別','—','等待正式資料') + metric('有排課學生','—','等待正式資料') + metric('資料來源','—','尚未載入');
      $('studentRows').innerHTML = '<tr><td colspan="6">尚未載入正式資料。</td></tr>';
      return;
    }
    var search = clean($('studentSearch').value).toLowerCase();
    var rows = array(state.students).filter(function (student) {
      var period = latestPeriod(student.id);
      var hay = [student.name,student.phone,byId(state.subjects,period.subjectId).name,byId(state.teachers,period.teacherId).name].join(' ').toLowerCase();
      return !search || hay.indexOf(search) >= 0;
    }).sort(function (a, b) { return clean(a.name).localeCompare(clean(b.name),'zh-Hant'); });
    var scheduledStudents = new Set(array(state.events).flatMap(function (event) { return array(event.studentIds); })).size;
    $('studentMetrics').innerHTML = metric('學生總數',state.students.length,'含停課資料') + metric('學費期別',state.tuitionPeriods.length,'正式期別紀錄') + metric('有排課學生',scheduledStudents,'事件中可辨識') + metric('資料來源',sourceName,'目前工作資料');
    $('studentRows').innerHTML = rows.map(function (student) {
      var period = latestPeriod(student.id);
      var subject = byId(state.subjects, period.subjectId);
      var teacher = byId(state.teachers, period.teacherId);
      var event = nextEvent(student.id);
      var expected = numberOf(period.expectedAmount) - numberOf(period.discount);
      var paid = periodPaid(period);
      return '<tr><td><b>' + esc(student.name) + '</b><small>' + (student.active === false ? '已停課' : '上課中') + '</small></td><td>' + esc(student.phone || '未填') + '</td><td>' + esc(subject.name || '尚無期別') + '<small>' + esc(teacher.name || '未指定老師') + '</small></td><td>' + (period.id ? esc(numberOf(period.usedCount) + ' / ' + numberOf(period.lessonCount) + '，剩 ' + periodRemaining(period)) : '—') + '</td><td>' + (period.id ? esc(money(paid) + ' / ' + money(expected)) + '<small>' + (paid < expected ? '尚欠 ' + esc(money(expected - paid)) : '已繳清') + '</small>' : '—') + '</td><td>' + (event.id ? esc(event.date + ' ' + event.start) : '尚未排課') + '</td></tr>';
    }).join('') || '<tr><td colspan="6">沒有符合條件的學生。</td></tr>';
  }

  function renderTeachers() {
    if (!state) {
      $('teacherMetrics').innerHTML = metric('老師總數','—','等待正式資料') + metric('本月堂數','—','等待正式資料') + metric('本月薪資','—','等待正式資料') + metric('資料來源','—','尚未載入');
      $('teacherList').innerHTML = '<div class="teacher-row">尚未載入正式資料。</div>';
      return;
    }
    var search = clean($('teacherSearch').value).toLowerCase();
    var month = currentDate.slice(0, 7);
    var payroll = array(state.teacherPayroll).filter(function (row) { return clean(row.date).slice(0, 7) === month; });
    var adjustments = array(state.teacherAdjustments).filter(function (row) { return clean(row.date).slice(0, 7) === month; });
    var rows = array(state.teachers).filter(function (teacher) {
      var subjects = array(teacher.subjectIds).map(function (id) { return byId(state.subjects,id).name; }).join(' ');
      return !search || (teacher.name + ' ' + teacher.phone + ' ' + subjects).toLowerCase().indexOf(search) >= 0;
    }).sort(function (a, b) { return clean(a.name).localeCompare(clean(b.name),'zh-Hant'); });
    var totalPay = sum(payroll,function(row){return row.teacherAmount;}) + sum(adjustments,function(row){return clean(row.type)==='deduction'?-numberOf(row.amount):numberOf(row.amount);});
    $('teacherMetrics').innerHTML = metric('老師總數',state.teachers.length,'啟用 ' + state.teachers.filter(function(row){return row.active!==false;}).length) + metric('本月堂數',payroll.length,'只計薪資紀錄') + metric('本月薪資',money(totalPay),'含獎勵與扣薪') + metric('資料來源',sourceName,'目前工作資料');
    $('teacherList').innerHTML = '<div class="teacher-row head"><span>老師</span><span>教授科目</span><span>狀態</span><span>本月堂數</span><span>本月薪資</span></div>' + rows.map(function (teacher) {
      var completed = payroll.filter(function (row) { return clean(row.teacherId) === clean(teacher.id); });
      var teacherAdjustments = adjustments.filter(function (row) { return clean(row.teacherId) === clean(teacher.id); });
      var pay = sum(completed,function(row){return row.teacherAmount;}) + sum(teacherAdjustments,function(row){return clean(row.type)==='deduction'?-numberOf(row.amount):numberOf(row.amount);});
      var subjects = array(teacher.subjectIds).map(function (id) { return byId(state.subjects,id).name; }).filter(Boolean).join('、');
      return '<div class="teacher-row"><span><b>' + esc(teacher.name) + '</b><small>' + esc(teacher.phone || '未填電話') + '</small></span><span>' + esc(subjects || '尚未設定') + '</span><span>' + (teacher.active === false ? '停用' : '啟用') + '</span><span>' + completed.length + ' 堂</span><span>' + esc(money(pay)) + '</span></div>';
    }).join('');
  }

  function renderSettings() {
    if (!state) {
      $('roomSettings').innerHTML = '<p>尚未載入正式資料。</p>';
      $('subjectSettings').innerHTML = '<p>尚未載入正式資料。</p>';
      $('dataSettings').innerHTML = '<p>尚未載入正式資料。</p>';
      return;
    }
    $('roomSettings').innerHTML = '<div class="settings-list">' + array(state.rooms).sort(function(a,b){return numberOf(a.sort)-numberOf(b.sort);}).map(function (room) { return '<div class="settings-item"><b>' + esc(room.name) + '</b><small>' + (room.active === false ? '停用' : '啟用') + '</small></div>'; }).join('') + '</div>';
    $('subjectSettings').innerHTML = '<div class="settings-list">' + array(state.subjects).sort(function(a,b){return numberOf(a.sort)-numberOf(b.sort);}).map(function (subject) { return '<div class="settings-item"><b>' + esc(subject.name) + '</b><small>' + (subject.active === false ? '停用' : '啟用') + '</small></div>'; }).join('') + '</div>';
    var meta = state.dataMeta || {};
    $('dataSettings').innerHTML = '<div class="settings-list"><div class="settings-item"><b>來源</b><small>' + esc(sourceName) + '</small></div><div class="settings-item"><b>Run ID</b><small>' + esc(meta.runId || '未提供') + '</small></div><div class="settings-item"><b>載入時間</b><small>' + esc(meta.loadedAt || state.sandboxMeta && state.sandboxMeta.updatedAt || '未提供') + '</small></div><div class="settings-item"><b>事件範圍</b><small>' + esc([meta.rangeStart,meta.rangeEnd].filter(Boolean).join(' ～ ') || '未提供') + '</small></div></div>';
  }

  function renderAll() {
    renderCalendar();
    renderStudents();
    renderTeachers();
    renderSettings();
    populateCourseForm();
  }

  function switchPage(page) {
    currentPage = ['calendar','students','teachers','settings'].indexOf(page) >= 0 ? page : 'calendar';
    var titles = {
      calendar:['課程日表','教室為欄、30 分鐘為一格。'],
      students:['學生與學費','查看學生期別、堂數與付款狀態。'],
      teachers:['老師薪資','查看每月完成堂數與老師拆帳。'],
      settings:['系統設定','確認教室、科目與資料來源。']
    };
    $('pageTitle').textContent = titles[currentPage][0];
    $('pageSubtitle').textContent = titles[currentPage][1];
    Array.prototype.forEach.call(document.querySelectorAll('.page'), function (node) { node.classList.toggle('active', node.id === currentPage + 'Page'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-page]'), function (node) { node.classList.toggle('active', node.dataset.page === currentPage); });
    $('newCourseButton').classList.toggle('hidden', currentPage !== 'calendar');
    if (global.location.hash !== '#' + currentPage) history.replaceState(null, '', '#' + currentPage);
  }

  function populateCourseForm() {
    if (!state) return;
    function options(rows, placeholder, label) {
      return '<option value="">' + esc(placeholder) + '</option>' + array(rows).filter(function(row){return row.active!==false;}).map(function (row) { return '<option value="' + esc(row.id) + '">' + esc(label(row)) + '</option>'; }).join('');
    }
    $('courseRoom').innerHTML = options(state.rooms,'請選擇教室',function(row){return row.name;});
    $('courseStudent').innerHTML = options(state.students,'可不指定學生',function(row){return row.name + (row.phone ? '・' + row.phone : '');});
    $('courseTeacher').innerHTML = options(state.teachers,'可不指定老師',function(row){return row.name;});
    $('courseSubject').innerHTML = options(state.subjects,'可不指定科目',function(row){return row.name;});
  }

  function openCourseModal(roomId, start) {
    if (!state) { toast('請先載入正式課務資料'); return; }
    $('courseDate').value = currentDate;
    $('courseStart').value = start || '10:00';
    $('courseRoom').value = roomId || '';
    $('courseDuration').value = '60';
    $('courseType').value = 'single';
    $('courseStudent').value = '';
    $('courseTeacher').value = '';
    $('courseSubject').value = '';
    $('courseNote').value = '';
    $('courseModal').classList.remove('hidden');
  }

  function closeCourseModal() { $('courseModal').classList.add('hidden'); }

  async function saveCourse(event) {
    event.preventDefault();
    if (!state) return;
    var roomId = clean($('courseRoom').value);
    var date = dateKey($('courseDate').value);
    var start = clean($('courseStart').value);
    if (!roomId || !date || !start) { toast('請填寫日期、時間與教室'); return; }
    var studentId = clean($('courseStudent').value);
    state.events.push({
      id:'fresh_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7),
      date:date,
      roomId:roomId,
      start:start,
      duration:numberOf($('courseDuration').value) || 60,
      type:clean($('courseType').value) || 'single',
      frequency:'once',
      studentIds:studentId ? [studentId] : [],
      teacherId:clean($('courseTeacher').value),
      subjectId:clean($('courseSubject').value),
      tuitionPeriodId:'',
      clientName:'',
      rentalFee:0,
      status:'scheduled',
      note:clean($('courseNote').value),
      readOnly:false,
      source:'fresh-course-center'
    });
    state.currentDate = date;
    currentDate = date;
    state.sandboxMeta.updatedAt = new Date().toISOString();
    await writeDatabase(null, state);
    closeCourseModal();
    renderAll();
    toast('排課已儲存到 workspace');
  }

  function bindEvents() {
    global.addEventListener('hashchange', function () { switchPage(clean(global.location.hash).replace(/^#/, '') || 'calendar'); });
    $('todayButton').addEventListener('click', function () { currentDate = dateKey(new Date()); renderAll(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-day]'), function (button) {
      button.addEventListener('click', function () { currentDate = shiftDate(currentDate, numberOf(button.dataset.day)); renderAll(); });
    });
    $('dateInput').addEventListener('change', function () { currentDate = dateKey(this.value) || currentDate; renderAll(); });
    $('studentSearch').addEventListener('input', renderStudents);
    $('teacherSearch').addEventListener('input', renderTeachers);
    $('reloadButton').addEventListener('click', function () { resolveData(false); });
    $('mirrorLoadButton').addEventListener('click', function () {
      var pin = readStoredPin();
      if (!pin) {
        $('recoveryPanel').classList.remove('hidden');
        $('recoveryPin').focus();
        return;
      }
      resolveData(true, pin);
    });
    $('recoveryForm').addEventListener('submit', function (event) {
      event.preventDefault();
      resolveData(true, $('recoveryPin').value);
    });
    ['newCourseButton','calendarNewButton'].forEach(function (id) { $(id).addEventListener('click', function () { openCourseModal('', '10:00'); }); });
    $('scheduleGrid').addEventListener('click', function (event) {
      var slot = event.target.closest('[data-room][data-time]');
      if (slot) openCourseModal(slot.dataset.room, slot.dataset.time);
    });
    $('courseModalClose').addEventListener('click', closeCourseModal);
    $('courseCancel').addEventListener('click', closeCourseModal);
    $('courseModal').addEventListener('click', function (event) { if (event.target === $('courseModal')) closeCourseModal(); });
    $('courseForm').addEventListener('submit', saveCourse);
  }

  async function start() {
    bindEvents();
    switchPage(clean(global.location.hash).replace(/^#/, '') || 'calendar');
    renderAll();
    try {
      if (global.navigator && global.navigator.storage && typeof global.navigator.storage.persist === 'function') global.navigator.storage.persist().catch(function () {});
    } catch (_) {}
    await resolveData(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
