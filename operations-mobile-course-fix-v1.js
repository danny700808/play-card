(function (global) {
  'use strict';

  var DB_NAME = 'youzi-course-scheduler';
  var STORE_NAME = 'formalSnapshots';
  var WORKSPACE_KEY = 'workspace';
  var FORMAL_KEY = 'latest';
  var snapshot = null;
  var readPending = null;
  var renderPending = false;
  var observer = null;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function numberOf(value) { var parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function esc(value) { return clean(value).replace(/[&<>'"]/g, function (ch) { return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]; }); }
  function pad(value) { return String(value).padStart(2, '0'); }
  function dateKey(value) {
    var date = value instanceof Date ? value : new Date(clean(value).slice(0, 10) + 'T12:00:00');
    if (!Number.isFinite(date.getTime())) return '';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
  function timeToMinutes(value) { var parts = clean(value || '00:00').split(':'); return numberOf(parts[0]) * 60 + numberOf(parts[1]); }
  function minutesToTime(value) { return pad(Math.floor(value / 60)) + ':' + pad(value % 60); }
  function currentView() { return String(global.location.hash || '#overview').replace(/^#/, '').split('?')[0] || 'overview'; }
  function mobileOverview() {
    var mobile = global.matchMedia ? global.matchMedia('(max-width: 820px)').matches : global.innerWidth <= 820;
    return mobile && currentView() === 'overview';
  }
  function selectedDate() {
    var state = global.OperationsCenterV1 && global.OperationsCenterV1.state || {};
    return dateKey(state.overviewDate) || dateKey(new Date());
  }
  function hasRows(source, key) {
    return Boolean(source && Array.isArray(source[key]) && source[key].length);
  }
  function hasScheduleData(source) {
    return ['events', 'recurringRules', 'fixedCourses', 'temporaryCourses', 'roomRentals']
      .some(function (key) { return hasRows(source, key); });
  }
  function meaningful(source) {
    if (!source || Number(source.version) !== 3) return false;
    return hasRows(source, 'rooms') && hasScheduleData(source);
  }
  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { resolve(null); return; }
      var request = global.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
    });
  }
  function readSnapshot() {
    if (readPending) return readPending;
    readPending = openDatabase().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve, reject) {
        var transaction = db.transaction(STORE_NAME, 'readonly');
        var store = transaction.objectStore(STORE_NAME);
        var workspaceRequest = store.get(WORKSPACE_KEY);
        var formalRequest = store.get(FORMAL_KEY);
        transaction.oncomplete = function () {
          var workspace = workspaceRequest.result || null;
          var formal = formalRequest.result || null;
          db.close();
          resolve(meaningful(workspace) ? workspace : (meaningful(formal) ? formal : null));
        };
        transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB read failed')); };
        transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB read aborted')); };
      });
    }).catch(function () { return null; }).then(function (value) {
      readPending = null;
      snapshot = value;
      return value;
    });
    return readPending;
  }
  function byId(rows, id) {
    return (rows || []).find(function (row) { return clean(row && row.id) === clean(id); }) || {};
  }
  function normalizedStatus(status) {
    var value = clean(status).toLowerCase();
    if (['cancel','cancelled','canceled','voided','inactive','取消','註銷','停課'].indexOf(value) >= 0) return 'cancelled';
    if (['leave','請假','已請假'].indexOf(value) >= 0) return 'leave';
    return value || 'scheduled';
  }
  function ruleOccurs(rule, targetDate) {
    var start = dateKey(rule.startDate), end = dateKey(rule.endDate);
    if (!start || targetDate < start || (end && targetDate > end) || rule.active === false) return false;
    var startDate = new Date(start + 'T12:00:00'), target = new Date(targetDate + 'T12:00:00');
    if (startDate.getDay() !== target.getDay()) return false;
    var weeks = Math.floor((target - startDate) / 604800000);
    return weeks >= 0 && weeks % Math.max(1, numberOf(rule.intervalWeeks) || 1) === 0;
  }
  function eventsForDate(targetDate) {
    if (!snapshot) return [];
    var stored = (snapshot.events || []).filter(function (row) {
      return dateKey(row.date) === targetDate && normalizedStatus(row.status) !== 'cancelled';
    });
    var overrideKeys = new Set(stored.map(function (row) { return clean(row.recurrenceKey); }).filter(Boolean));
    var recurring = (snapshot.recurringRules || []).filter(function (rule) {
      return ruleOccurs(rule, targetDate) && !overrideKeys.has(clean(rule.id) + '@' + targetDate);
    }).map(function (rule) {
      return Object.assign({}, rule, {
        id: 'rec_' + clean(rule.id) + '@' + targetDate,
        recurrenceKey: clean(rule.id) + '@' + targetDate,
        date: targetDate,
        type: rule.type || 'fixed',
        status: 'scheduled'
      });
    });
    var seen = new Map();
    stored.concat(recurring).forEach(function (row, index) {
      var key = [row.date,row.roomId,row.start,numberOf(row.duration),(row.studentIds || []).slice().sort().join(','),clean(row.clientName)].join('|');
      var score = row.recurrenceKey ? 1 : 10;
      if (normalizedStatus(row.status) !== 'scheduled') score += 4;
      if (!seen.has(key) || seen.get(key).score <= score) seen.set(key, { row: row, score: score, index: index });
    });
    return Array.from(seen.values()).map(function (item) { return item.row; }).sort(function (left, right) {
      return timeToMinutes(left.start) - timeToMinutes(right.start);
    });
  }
  function eventName(event) {
    if (clean(event.type) === 'rental') return clean(event.clientName) || '租用';
    var names = (event.studentIds || []).map(function (id) { return clean(byId(snapshot && snapshot.students, id).name); }).filter(Boolean);
    return names.join('、') || clean(event.clientName) || '課程';
  }
  function eventClass(event) {
    var type = clean(event.type).toLowerCase(), status = normalizedStatus(event.status);
    if (status === 'leave') return ' leave';
    if (type === 'rental') return ' rental';
    if (type === 'trial') return ' trial';
    if (type === 'single' || type === 'temporary' || type === 'reschedule' || event.movedFrom) return ' move';
    return '';
  }
  function roomLabel(room, index) {
    var label = clean(room.publicName || room.shortName || room.name) || ('教室' + (index + 1));
    label = label
      .replace(/YAMAHA/gi, 'Y')
      .replace(/KAWAI/gi, 'K')
      .replace(/平台鋼琴教室/g, '平台')
      .replace(/直立鋼琴教室/g, '直立')
      .replace(/展演空間/g, '展演')
      .replace(/團練室/g, '團練')
      .replace(/傳統鼓/g, '鼓')
      .replace(/電子鼓/g, '電鼓')
      .replace(/[（(].*?[）)]/g, '')
      .replace(/教室/g, '')
      .replace(/空間/g, '')
      .trim();
    return label.length > 5 ? label.slice(0, 5) : label;
  }
  function loadingCardHtml() {
    return '<section class="ops-card ops-mobile-course-fix-card"><div class="ops-card-head"><div><h2>今日課表</h2><p>正在還原完整課程資料</p></div><button type="button" class="ops-approved-link-button" data-nav="course-calendar">完整課表</button></div><div class="ops-mobile-course-empty">系統正在從雲端已同步資料還原課表；不需要再按音教雲同步。</div></section>';
  }
  function scheduleCardHtml() {
    if (!meaningful(snapshot)) return loadingCardHtml();
    var targetDate = selectedDate();
    var rooms = snapshot.rooms.filter(function (room) { return room.active !== false; }).sort(function (a, b) { return numberOf(a.sort) - numberOf(b.sort); });
    var settings = snapshot.settings || {};
    var startHour = Math.max(0, Math.min(23, numberOf(settings.startHour) || 10));
    var endHour = Math.max(startHour + 1, Math.min(24, numberOf(settings.endHour) || 22));
    var slotCount = (endHour - startHour) * 2;
    var events = eventsForDate(targetDate);
    var html = '<section class="ops-card ops-mobile-course-fix-card"><div class="ops-card-head"><div><h2>今日課表</h2><p>' + esc(targetDate.replace(/-/g, '/')) + '・全部 ' + rooms.length + ' 間教室同時顯示</p></div><button type="button" class="ops-approved-link-button" data-nav="course-calendar">完整課表</button></div>';
    html += '<div class="ops-mobile-course-wrap"><div class="ops-mobile-course-grid" style="--room-count:' + rooms.length + ';--slot-count:' + slotCount + '">';
    html += '<div class="ops-mobile-course-corner" style="grid-column:1;grid-row:1">時間</div>';
    rooms.forEach(function (room, index) {
      html += '<div class="ops-mobile-course-room" title="' + esc(room.name) + '" style="grid-column:' + (index + 2) + ';grid-row:1">' + esc(roomLabel(room, index)) + '</div>';
    });
    for (var slot = 0; slot < slotCount; slot += 1) {
      var row = slot + 2, minute = startHour * 60 + slot * 30, half = slot % 2 ? ' half' : '';
      html += '<div class="ops-mobile-course-time' + half + '" style="grid-column:1;grid-row:' + row + '">' + (slot % 2 ? '' : minutesToTime(minute)) + '</div>';
      rooms.forEach(function (_, roomIndex) {
        html += '<div class="ops-mobile-course-cell' + half + '" style="grid-column:' + (roomIndex + 2) + ';grid-row:' + row + '"></div>';
      });
    }
    events.forEach(function (event) {
      var roomIndex = rooms.findIndex(function (room) { return clean(room.id) === clean(event.roomId); });
      var start = timeToMinutes(event.start);
      if (roomIndex < 0 || start < startHour * 60 || start >= endHour * 60) return;
      var startSlot = Math.floor((start - startHour * 60) / 30);
      var span = Math.max(1, Math.ceil((numberOf(event.duration) || 60) / 30));
      var teacher = clean(byId(snapshot.teachers, event.teacherId).name);
      var subject = clean(byId(snapshot.subjects, event.subjectId).name);
      var title = [eventName(event), subject, teacher, clean(event.start)].filter(Boolean).join('・');
      html += '<button type="button" class="ops-mobile-course-event' + eventClass(event) + '" data-nav="course-calendar" title="' + esc(title) + '" style="grid-column:' + (roomIndex + 2) + ';grid-row:' + (startSlot + 2) + ' / span ' + Math.min(span, slotCount - startSlot) + '"><b>' + esc(eventName(event)) + '</b></button>';
    });
    html += '</div></div></section>';
    return html;
  }
  function render() {
    renderPending = false;
    if (!mobileOverview()) return;
    var content = document.getElementById('opsContent');
    if (!content || content.querySelector('.ops-loading')) return;
    var original = content.querySelector('.ops-approved-schedule-card');
    var current = content.querySelector('.ops-mobile-course-fix-card');
    if (current) current.outerHTML = scheduleCardHtml();
    else if (original) original.outerHTML = scheduleCardHtml();
  }
  function scheduleRender(refreshData) {
    if (refreshData) {
      snapshot = null;
      readPending = null;
      readSnapshot().then(function () { scheduleRender(false); });
    }
    if (renderPending) return;
    renderPending = true;
    global.requestAnimationFrame(render);
  }
  function acceptSnapshot(value) {
    if (meaningful(value)) {
      snapshot = value;
      readPending = null;
      scheduleRender(false);
      return true;
    }
    return false;
  }
  function start() {
    observer = new MutationObserver(function () { scheduleRender(false); });
    observer.observe(document.body, { childList: true, subtree: true });
    global.addEventListener('hashchange', function () { scheduleRender(currentView() === 'overview'); });
    global.addEventListener('focus', function () { if (mobileOverview()) scheduleRender(true); });
    global.addEventListener('pageshow', function () { if (mobileOverview()) scheduleRender(true); });
    global.addEventListener('youzi-course-auto-data-ready', function (event) {
      if (!acceptSnapshot(event && event.detail && event.detail.snapshot)) scheduleRender(true);
    });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && mobileOverview()) scheduleRender(true); });
    readSnapshot().then(function (value) {
      scheduleRender(false);
      if (!meaningful(value) && global.YouziCourseAutoData && typeof global.YouziCourseAutoData.ensure === 'function') {
        global.YouziCourseAutoData.ensure().then(function (result) {
          if (!acceptSnapshot(result && result.snapshot)) scheduleRender(true);
        }).catch(function () { scheduleRender(false); });
      }
    });
    if (global.YouziCourseAutoDataReady && typeof global.YouziCourseAutoDataReady.then === 'function') {
      global.YouziCourseAutoDataReady.then(function (result) {
        if (!acceptSnapshot(result && result.snapshot)) scheduleRender(true);
      }).catch(function () { scheduleRender(false); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
