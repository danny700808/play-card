(function (global) {
  'use strict';

  if (global.__YOUZI_SIMPLE_FULL_COURSE_V2__) return;
  global.__YOUZI_SIMPLE_FULL_COURSE_V2__ = true;

  var VERSION = '20260729-simple-full-v2';
  var DB_NAME = 'youzi-course-scheduler';
  var STORE_NAME = 'formalSnapshots';
  var FORMAL_KEY = 'latest';
  var WORKSPACE_KEY = 'workspace';
  var CACHE_KEY = 'youzi.courseScheduler.formalCache.v1';
  var HASH = 'course-calendar';
  var snapshot = null;
  var loading = null;
  var selectedDate = '';
  var queued = false;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function numberOf(value) { var n = Number(value); return Number.isFinite(n) ? n : 0; }
  function esc(value) { return clean(value).replace(/[&<>"']/g, function (ch) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; }); }
  function pad(value) { return String(value).padStart(2, '0'); }
  function dateKey(value) {
    var date = value instanceof Date ? value : new Date(clean(value).slice(0, 10) + 'T12:00:00');
    if (!Number.isFinite(date.getTime())) return '';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
  function todayKey() { return dateKey(new Date()); }
  function shiftDate(key, days) { var d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + Number(days || 0)); return dateKey(d); }
  function timeToMinutes(value) { var parts = clean(value || '00:00').split(':'); return numberOf(parts[0]) * 60 + numberOf(parts[1]); }
  function minutesToTime(value) { return pad(Math.floor(value / 60)) + ':' + pad(value % 60); }
  function currentHash() { return clean(global.location.hash || '#overview').replace(/^#/, '').split('?')[0] || 'overview'; }
  function isCalendar() { return currentHash() === HASH; }
  function hasRows(source, key) { return Boolean(source && Array.isArray(source[key]) && source[key].length); }
  function meaningful(source) {
    if (!source || Number(source.version) !== 3) return false;
    return hasRows(source, 'rooms') && ['events','recurringRules','fixedCourses','temporaryCourses','roomRentals'].some(function (key) { return hasRows(source, key); });
  }
  function byId(rows, id) { return (rows || []).find(function (row) { return clean(row && row.id) === clean(id); }) || {}; }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { resolve(null); return; }
      var request = global.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () { var db = request.result; if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
    });
  }

  async function readSnapshot() {
    var db = await openDatabase();
    if (db) {
      var result = await new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var workspaceRequest = store.get(WORKSPACE_KEY);
        var formalRequest = store.get(FORMAL_KEY);
        tx.oncomplete = function () {
          var workspace = workspaceRequest.result || null;
          var formal = formalRequest.result || null;
          db.close();
          resolve(meaningful(workspace) ? workspace : (meaningful(formal) ? formal : null));
        };
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB read failed')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB read aborted')); };
      }).catch(function () { return null; });
      if (meaningful(result)) return result;
    }
    try {
      var cached = JSON.parse(global.localStorage.getItem(CACHE_KEY) || 'null');
      return meaningful(cached) ? cached : null;
    } catch (_) { return null; }
  }

  function loadSnapshot(force) {
    if (loading && !force) return loading;
    loading = readSnapshot().then(function (value) {
      snapshot = value;
      loading = null;
      return value;
    });
    return loading;
  }

  function ruleOccurs(rule, targetDate) {
    var start = dateKey(rule.startDate), end = dateKey(rule.endDate);
    if (!start || targetDate < start || (end && targetDate > end) || rule.active === false) return false;
    var startDate = new Date(start + 'T12:00:00'), target = new Date(targetDate + 'T12:00:00');
    if (startDate.getDay() !== target.getDay()) return false;
    var weeks = Math.floor((target - startDate) / 604800000);
    return weeks >= 0 && weeks % Math.max(1, numberOf(rule.intervalWeeks) || 1) === 0;
  }

  function normalizedStatus(value) {
    value = clean(value).toLowerCase();
    if (['cancel','cancelled','canceled','voided','inactive','取消','停課','註銷'].indexOf(value) >= 0) return 'cancelled';
    if (['leave','請假','已請假'].indexOf(value) >= 0) return 'leave';
    if (['absent','曠課','缺席'].indexOf(value) >= 0) return 'absent';
    if (['attended','checkin','checked-in','已簽到','簽到'].indexOf(value) >= 0) return 'attended';
    return 'scheduled';
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
      return Object.assign({}, rule, { id: 'rec_' + clean(rule.id) + '@' + targetDate, recurrenceKey: clean(rule.id) + '@' + targetDate, date: targetDate, type: rule.type || 'fixed', status: 'scheduled' });
    });
    return stored.concat(recurring).sort(function (a, b) { return timeToMinutes(a.start) - timeToMinutes(b.start); });
  }

  function eventName(event) {
    if (clean(event.type) === 'rental') return clean(event.clientName) || '教室租用';
    var names = (event.studentIds || []).map(function (id) { return clean(byId(snapshot && snapshot.students, id).name); }).filter(Boolean);
    return names.join('、') || clean(event.clientName) || clean(byId(snapshot && snapshot.subjects, event.subjectId).name) || '課程';
  }

  function eventClass(event) {
    var type = clean(event.type).toLowerCase(), status = normalizedStatus(event.status);
    if (status === 'leave' || status === 'absent') return ' leave';
    if (type === 'rental') return ' rental';
    if (type === 'trial') return ' trial';
    if (type === 'single' || type === 'temporary' || type === 'reschedule' || event.movedFrom) return ' move';
    return '';
  }

  function roomLabel(room, index) {
    var label = clean(room.publicName || room.shortName || room.name) || ('教室 ' + (index + 1));
    return label.replace(/YAMAHA/gi, 'Y').replace(/KAWAI/gi, 'K').replace(/平台鋼琴教室/g, '平台').replace(/直立鋼琴教室/g, '直立').replace(/教室/g, '').trim() || label;
  }

  function installStyle() {
    if (global.document.getElementById('opsSimpleFullCourseStyleV2')) return;
    var style = global.document.createElement('style');
    style.id = 'opsSimpleFullCourseStyleV2';
    style.textContent = [
      '#opsSimpleFullCourse{min-height:calc(100dvh - 88px);padding:12px;color:#173f34}',
      '#opsSimpleFullCourse *{box-sizing:border-box}',
      '#opsSimpleFullCourse .full-head{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:9px;align-items:center;padding:12px;border-radius:16px;background:#153f36;color:#fff}',
      '#opsSimpleFullCourse .full-head b{font-size:19px;margin-right:auto}',
      '#opsSimpleFullCourse .full-head button,#opsSimpleFullCourse .full-head input{min-height:42px;border:1px solid #c7dbd4;border-radius:10px;background:#fff;color:#173f34;font-weight:800;padding:8px 12px}',
      '#opsSimpleFullCourse .full-note{margin:12px 0;padding:12px 14px;border:1px solid #cfe0da;border-radius:14px;background:#fff;color:#647b74;font-size:12px;line-height:1.6}',
      '#opsSimpleFullCourse .full-wrap{width:100%;overflow:auto;-webkit-overflow-scrolling:touch;border:1px solid #cfe0da;border-radius:16px;background:#fff}',
      '#opsSimpleFullCourse .full-grid{--slot-height:38px;display:grid;position:relative;min-width:max(980px,100%);grid-template-columns:62px repeat(var(--room-count),minmax(86px,1fr));grid-template-rows:48px repeat(var(--slot-count),var(--slot-height))}',
      '#opsSimpleFullCourse .corner,#opsSimpleFullCourse .room,#opsSimpleFullCourse .time,#opsSimpleFullCourse .cell{border-right:1px solid #d7e3df;border-bottom:1px solid #d7e3df}',
      '#opsSimpleFullCourse .corner,#opsSimpleFullCourse .room{display:grid;place-items:center;padding:4px;background:#edf6f2;font-size:11px;font-weight:800;text-align:center}',
      '#opsSimpleFullCourse .time{display:grid;place-items:start center;padding-top:5px;background:#f8fbfa;color:#71847e;font-size:10px}',
      '#opsSimpleFullCourse .half{border-bottom-style:dashed}',
      '#opsSimpleFullCourse .event{z-index:3;margin:2px;padding:5px 4px;border:0;border-radius:7px;background:#1e7a5d;color:#fff;text-align:left;overflow:hidden}',
      '#opsSimpleFullCourse .event b{display:block;font-size:12px;line-height:1.15}',
      '#opsSimpleFullCourse .event span{display:block;margin-top:3px;font-size:9px;opacity:.9}',
      '#opsSimpleFullCourse .event.move{background:#5d9b88}.event.rental{background:#c87d83}.event.trial{background:#c9953e}.event.leave{background:#8ea9bd;opacity:.75}',
      '#opsSimpleFullCourse .empty{display:grid;place-items:center;min-height:520px;padding:24px;text-align:center;border:1px solid #cfe0da;border-radius:16px;background:#fff}',
      '@media(max-width:640px){#opsSimpleFullCourse{padding:8px}#opsSimpleFullCourse .full-head{align-items:stretch}#opsSimpleFullCourse .full-head b{width:100%}#opsSimpleFullCourse .full-head button,#opsSimpleFullCourse .full-head input{flex:1;min-width:72px}}'
    ].join('');
    global.document.head.appendChild(style);
  }

  function dateFromOperations() {
    var state = global.OperationsCenterV1 && global.OperationsCenterV1.state || {};
    return dateKey(state.overviewDate) || selectedDate || todayKey();
  }

  function gridHtml() {
    if (!meaningful(snapshot)) return '<section class="empty"><div><b>正在讀取已保存的課表</b><p>完整課表直接讀取本機課務資料庫，不需要先開啟營運總覽，也不會自動同步音教雲。</p></div></section>';
    var date = selectedDate || dateFromOperations();
    var rooms = (snapshot.rooms || []).filter(function (room) { return room.active !== false; }).sort(function (a, b) { return numberOf(a.sort) - numberOf(b.sort); });
    var settings = snapshot.settings || {};
    var startHour = Math.max(0, Math.min(23, numberOf(settings.startHour) || 8));
    var endHour = Math.max(startHour + 1, Math.min(24, numberOf(settings.endHour) || 22));
    var slotCount = (endHour - startHour) * 2;
    var events = eventsForDate(date);
    var html = '<div class="full-wrap"><div class="full-grid" style="--room-count:' + rooms.length + ';--slot-count:' + slotCount + '">';
    html += '<div class="corner" style="grid-column:1;grid-row:1">時間</div>';
    rooms.forEach(function (room, index) { html += '<div class="room" style="grid-column:' + (index + 2) + ';grid-row:1">' + esc(roomLabel(room, index)) + '</div>'; });
    for (var slot = 0; slot < slotCount; slot += 1) {
      var row = slot + 2, minute = startHour * 60 + slot * 30, half = slot % 2 ? ' half' : '';
      html += '<div class="time' + half + '" style="grid-column:1;grid-row:' + row + '">' + (slot % 2 ? '' : minutesToTime(minute)) + '</div>';
      rooms.forEach(function (_, roomIndex) { html += '<div class="cell' + half + '" style="grid-column:' + (roomIndex + 2) + ';grid-row:' + row + '"></div>'; });
    }
    events.forEach(function (event) {
      var roomIndex = rooms.findIndex(function (room) { return clean(room.id) === clean(event.roomId); });
      var start = timeToMinutes(event.start);
      if (roomIndex < 0 || start < startHour * 60 || start >= endHour * 60) return;
      var startSlot = Math.floor((start - startHour * 60) / 30);
      var span = Math.max(1, Math.ceil((numberOf(event.duration) || 60) / 30));
      var teacher = clean(byId(snapshot.teachers, event.teacherId).name);
      var subject = clean(byId(snapshot.subjects, event.subjectId).name);
      html += '<button type="button" class="event' + eventClass(event) + '" style="grid-column:' + (roomIndex + 2) + ';grid-row:' + (startSlot + 2) + ' / span ' + Math.min(span, slotCount - startSlot) + '"><b>' + esc(eventName(event)) + '</b><span>' + esc([subject, teacher, clean(event.start)].filter(Boolean).join(' · ')) + '</span></button>';
    });
    return html + '</div></div>';
  }

  function shellHtml() {
    var date = selectedDate || dateFromOperations();
    return '<header class="full-head"><b>完整課表</b><button type="button" data-full-step="-1">‹ 前一天</button><input type="date" data-full-date value="' + esc(date) + '"><button type="button" data-full-step="1">後一天 ›</button><button type="button" data-full-today>今天</button><button type="button" data-full-home>返回營運總覽</button></header>'
      + '<div class="full-note">目前顯示上次成功保存的課表。只有你主動按「更新音教雲最新資料」且更新成功後，本機資料庫才會換成新資料；更新失敗時舊課表會繼續保留。</div>'
      + gridHtml();
  }

  function render() {
    queued = false;
    if (!isCalendar()) return;
    installStyle();
    var host = global.document.getElementById('opsCoursePersistentHost');
    if (!host) return;
    host.hidden = false;
    host.querySelectorAll('.ops-course-workspace').forEach(function (node) { node.remove(); });
    var root = host.querySelector('#opsSimpleFullCourse');
    if (!root) { root = global.document.createElement('div'); root.id = 'opsSimpleFullCourse'; host.appendChild(root); }
    root.dataset.version = VERSION;
    root.innerHTML = shellHtml();
    var dateInput = root.querySelector('[data-full-date]');
    if (dateInput) dateInput.addEventListener('change', function () { selectedDate = dateKey(dateInput.value) || todayKey(); queueRender(); });
    root.querySelectorAll('[data-full-step]').forEach(function (button) { button.addEventListener('click', function () { selectedDate = shiftDate(selectedDate || dateFromOperations(), numberOf(button.dataset.fullStep)); queueRender(); }); });
    var today = root.querySelector('[data-full-today]'); if (today) today.addEventListener('click', function () { selectedDate = todayKey(); queueRender(); });
    var home = root.querySelector('[data-full-home]'); if (home) home.addEventListener('click', function () { global.location.hash = 'overview'; });
  }

  function queueRender() { if (queued) return; queued = true; global.requestAnimationFrame(render); }

  function refreshData() {
    loadSnapshot(true).then(function () { if (isCalendar()) queueRender(); });
  }

  function start() {
    installStyle();
    selectedDate = dateFromOperations();
    loadSnapshot(false).then(function () { if (isCalendar()) queueRender(); });
    global.addEventListener('hashchange', function () { if (isCalendar()) { selectedDate = dateFromOperations(); refreshData(); } });
    global.addEventListener('pageshow', function () { if (isCalendar()) refreshData(); });
    global.addEventListener('focus', function () { if (isCalendar()) refreshData(); });
    global.addEventListener('youzi-course-auto-data-ready', function (event) {
      if (meaningful(event && event.detail && event.detail.snapshot)) snapshot = event.detail.snapshot;
      else refreshData();
      if (isCalendar()) queueRender();
    });
    global.addEventListener('storage', function (event) { if (event.key === CACHE_KEY && isCalendar()) refreshData(); });
    if (isCalendar()) queueRender();
  }

  global.YouziSimpleFullCourse = { refresh: refreshData };
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start); else start();
})(window);
