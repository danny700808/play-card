(function (global) {
  'use strict';

  const config = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
  if (!global.firebase || !config) throw new Error('Firebase 尚未載入。');
  if (!global.firebase.apps.length) global.firebase.initializeApp(config);
  const functions = global.firebase.app().functions('us-central1');

  const SESSION_KEY = 'youzi.coursePortal.teacher.session.v1';
  const CACHE_PREFIX = 'youzi.teacherCourseApp.v8.';
  const CACHE_TTL = 90 * 1000;

  const bindView = document.getElementById('bindView');
  const appView = document.getElementById('appView');
  const logoutBtn = document.getElementById('logoutBtn');

  let token = '';
  let weekStart = monday();
  let payrollMonth = monthKey();
  let activeTab = 'schedule';
  let data = emptyData();

  function emptyData() {
    return {
      teacher: {},
      week: {},
      hours: { start: 10, end: 21 },
      rooms: [],
      subjects: [],
      events: [],
      roster: [],
      payroll: [],
      adjustments: []
    };
  }

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function escapeHtml(value) {
    return clean(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: 'TWD',
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  function monthKey() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function monday(value) {
    const date = value ? new Date(`${value}T12:00:00`) : new Date();
    const day = date.getDay();
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function addDays(value, amount) {
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() + Number(amount || 0));
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function dayLabel(key) {
    const date = new Date(`${key}T12:00:00`);
    return `${date.getMonth() + 1}/${date.getDate()}（${'日一二三四五六'[date.getDay()]}）`;
  }

  function timeMinutes(value) {
    const parts = clean(value || '00:00').split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }

  function timeText(value) {
    value = ((Number(value) % 1440) + 1440) % 1440;
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function tokenFingerprint(value) {
    const text = clean(value || 'public');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function cacheKey(week, month) {
    return `${CACHE_PREFIX}${tokenFingerprint(token)}.${week}.${month}`;
  }

  function clearCache() {
    try {
      Object.keys(localStorage).forEach((key) => {
        if (key.indexOf(CACHE_PREFIX) === 0) localStorage.removeItem(key);
      });
    } catch (_) {}
  }

  function readCache(week, month) {
    try {
      const row = JSON.parse(localStorage.getItem(cacheKey(week, month)) || 'null');
      if (!row || !row.savedAt || Date.now() - row.savedAt > CACHE_TTL) return null;
      return row.value || null;
    } catch (_) {
      return null;
    }
  }

  function writeCache(week, month, value) {
    try {
      localStorage.setItem(cacheKey(week, month), JSON.stringify({ savedAt: Date.now(), value }));
    } catch (_) {}
  }

  function setSession(value) {
    const prior = clean(localStorage.getItem(SESSION_KEY));
    const next = clean(value);
    if (next) localStorage.setItem(SESSION_KEY, next);
    else localStorage.removeItem(SESSION_KEY);
    if (prior !== next) clearCache();
  }

  function getSession() {
    return clean(localStorage.getItem(SESSION_KEY));
  }

  async function invoke(name, payload) {
    try {
      const result = await functions.httpsCallable(name)(payload || {});
      return result && result.data || {};
    } catch (error) {
      const message = clean(error && (error.details || error.message) || '連線失敗，請稍後再試。').replace(/^FirebaseError:\s*/i, '');
      throw new Error(message);
    }
  }

  function toast(message, type) {
    let node = document.getElementById('portalToast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'portalToast';
      node.className = 'portal-toast';
      document.body.appendChild(node);
    }
    node.className = `portal-toast show ${type || ''}`;
    node.textContent = clean(message);
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 4200);
  }

  function loading(button, active, label) {
    if (!button) return;
    if (active) {
      if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.classList.add('is-loading');
      button.textContent = label || '處理中…';
    } else {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.textContent = button.dataset.originalText || button.textContent;
      delete button.dataset.originalText;
    }
  }

  function showBound(active) {
    bindView.classList.toggle('hidden', active);
    appView.classList.toggle('hidden', !active);
    logoutBtn.classList.toggle('hidden', !active);
  }

  function mergeData(next) {
    data = Object.assign({}, data, next || {});
    ['rooms','subjects','events','roster','payroll','adjustments'].forEach((key) => {
      if (!Array.isArray(data[key])) data[key] = [];
    });
    if (!data.teacher) data.teacher = {};
    if (!data.hours) data.hours = { start: 10, end: 21 };
  }

  function uniqueEvents(rows) {
    const found = new Map();
    (rows || []).forEach((event) => {
      const key = [event.id, event.startTime, event.endTime, event.roomId, (event.studentIds || []).slice().sort().join(',')].join('|');
      if (!found.has(key)) found.set(key, event);
    });
    return [...found.values()];
  }

  function lessonCard(event, conflict) {
    const studentNames = event.studentNames || [];
    const names = studentNames.join('、') || '未指定學生';
    const groupLabel = studentNames.length > 2 ? '團體課' : (studentNames.length === 2 ? '雙人課' : '');
    const stateLabel = event.status === 'leave' ? '請假' : (event.status === 'absent' ? '曠課' : '');
    const details = [event.subjectName, event.roomName, stateLabel].filter(Boolean).join('・');
    const classes = [
      'lesson',
      event.type === 'teacher_gift' ? 'gift' : '',
      event.status === 'leave' ? 'leave' : '',
      event.status === 'absent' ? 'absent' : '',
      groupLabel ? 'group-lesson' : '',
      conflict ? 'conflict-lesson' : ''
    ].filter(Boolean).join(' ');
    return `<button class="${classes}" type="button" data-event="${escapeHtml(event.id)}"><span class="lesson-time">${escapeHtml(event.startTime)}～${escapeHtml(event.endTime)}${groupLabel ? `<em>${groupLabel}</em>` : ''}</span><strong>${escapeHtml(names)}</strong><small>${escapeHtml(details)}</small></button>`;
  }

  function overlapGroups(rows) {
    const sorted = uniqueEvents(rows).slice().sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)) || String(a.endTime).localeCompare(String(b.endTime)));
    const groups = [];
    sorted.forEach((event) => {
      const last = groups[groups.length - 1];
      if (!last || event.startTime >= last.endTime) groups.push({ events: [event], startTime: event.startTime, endTime: event.endTime });
      else {
        last.events.push(event);
        if (event.endTime > last.endTime) last.endTime = event.endTime;
      }
    });
    return groups;
  }

  function renderWeek() {
    const grid = document.getElementById('weekGrid');
    const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const events = uniqueEvents((data.events || []).filter((event) => event.own));
    const startHour = Number(data.hours.start || 10);
    const endHour = Number(data.hours.end || 21);
    const scheduleStart = startHour * 60;
    let html = '<div class="week-cell head week-corner" style="grid-column:1;grid-row:1"></div>';

    days.forEach((day, dayIndex) => {
      html += `<div class="week-cell head" style="grid-column:${dayIndex + 2};grid-row:1">${escapeHtml(dayLabel(day))}</div>`;
    });

    for (let minute = startHour * 60, slotIndex = 0; minute < endHour * 60; minute += 30, slotIndex += 1) {
      const slotStart = timeText(minute);
      const slotEnd = timeText(minute + 30);
      const gridRow = slotIndex + 2;
      html += `<div class="week-cell time" style="grid-column:1;grid-row:${gridRow}">${slotStart}</div>`;
      days.forEach((day, dayIndex) => {
        const rows = uniqueEvents(events.filter((event) => event.date === day && event.startTime < slotEnd && slotStart < event.endTime));
        html += `<div class="week-cell" style="grid-column:${dayIndex + 2};grid-row:${gridRow}">`;
        if (!rows.length && new Date(`${day}T12:00:00`).getDay() !== 2) html += `<button class="empty-slot" type="button" data-empty="${day}|${slotStart}|${slotEnd}">空堂</button>`;
        else if (!rows.length) html += '<span class="closed-slot">公休</span>';
        html += '</div>';
      });
    }

    days.forEach((day, dayIndex) => {
      overlapGroups(events.filter((event) => event.date === day)).forEach((group) => {
        const startMinute = timeMinutes(group.startTime);
        const endMinute = timeMinutes(group.endTime);
        const rowStart = 2 + Math.max(0, Math.floor((startMinute - scheduleStart) / 30));
        const rowSpan = Math.max(1, Math.ceil((endMinute - Math.max(startMinute, scheduleStart)) / 30));
        const placement = `grid-column:${dayIndex + 2};grid-row:${rowStart}/span ${rowSpan}`;
        if (group.events.length === 1) html += `<div class="lesson-placement" style="${placement}">${lessonCard(group.events[0], false)}</div>`;
        else {
          html += `<div class="lesson-placement lesson-overlap-placement" style="${placement}"><div class="overlap-note">⚠ 同時${group.events.length}堂</div><div class="lesson-cluster conflict">`;
          group.events.forEach((event) => { html += lessonCard(event, true); });
          html += '</div></div>';
        }
      });
    });

    grid.innerHTML = html;
    document.getElementById('weekRange').textContent = `${days[0]} ～ ${days[6]}`;
    document.getElementById('lessonCount').textContent = events.length;
  }

  function renderRoster() {
    document.getElementById('studentCount').textContent = data.roster.length;
    document.getElementById('rosterBadge').textContent = `${data.roster.length} 位`;
    document.getElementById('rosterList').innerHTML = data.roster.length ? data.roster.map((student) => `<article class="list-row teacher-roster-row"><strong>${escapeHtml(student.name)}</strong><span>手機末四碼 ${escapeHtml(student.phoneLast4 || '未提供')}</span><span><button class="btn soft" type="button" data-student-action="${escapeHtml(student.id)}">增加課程</button> <button class="btn" type="button" data-bonus-student="${escapeHtml(student.id)}" data-bonus-name="${escapeHtml(student.name)}">教材／商品</button></span></article>`).join('') : '<p class="muted">目前沒有可顯示的學生。</p>';
  }

  function renderPayroll() {
    const rows = data.payroll || [];
    const adjustments = data.adjustments || [];
    document.getElementById('payrollCount').textContent = rows.length + adjustments.length;
    const valueOf = (row, keys, fallback = '') => {
      for (const key of keys) if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
      return fallback;
    };
    const items = rows.map((row) => ({
      kind: 'lesson',
      date: valueOf(row, ['date','courseDate','lessonDate'], payrollMonth),
      name: valueOf(row, ['studentName','subjectName'], '課堂'),
      subject: valueOf(row, ['subjectName','courseName']),
      collected: Number(valueOf(row, ['tuitionAmount','courseAmount','feeAmount','receivedAmount','expectedAmount'], 0)),
      rate: valueOf(row, ['rate','shareRate','allotRate','percentage'], '依方案'),
      amount: Number(valueOf(row, ['teacherAmount','amount','payAmount'], 0))
    })).concat(adjustments.map((row) => ({
      kind: 'adjustment',
      date: valueOf(row, ['date','month'], payrollMonth),
      name: valueOf(row, ['note','reason'], '獎勵／扣款'),
      subject: valueOf(row, ['type'], '調整'),
      collected: 0,
      rate: '—',
      amount: Number(valueOf(row, ['amount'], 0))
    }))).sort((a, b) => `${a.date}|${a.name}`.localeCompare(`${b.date}|${b.name}`, 'zh-Hant'));
    const groups = new Map();
    items.forEach((item) => {
      const key = item.date || '日期未提供';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    document.getElementById('payrollList').innerHTML = [...groups.entries()].map(([date, dayRows]) => `<section class="payroll-day"><h3>${escapeHtml(date)}</h3>${dayRows.map((row) => `<article class="list-row payroll-row"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.subject || (row.kind === 'lesson' ? '課堂' : '調整'))}</span><span>${row.kind === 'lesson' ? `收費 ${money(row.collected)}・分成 ${escapeHtml(row.rate)}` : '獎勵／扣款'}</span><strong>老師所得 ${money(row.amount)}</strong><span class="badge ${row.kind === 'adjustment' ? 'warn' : ''}">${row.kind === 'lesson' ? '課堂' : '調整'}</span></article>`).join('')}</section>`).join('') || '<p class="muted">這個月份目前沒有薪資資料。</p>';
  }

  function renderAll() {
    document.getElementById('teacherName').textContent = data.teacher.name || '老師';
    renderWeek();
    renderRoster();
    renderPayroll();
    showBound(true);
  }

  async function fetchData(force) {
    const cached = !force ? readCache(weekStart, payrollMonth) : null;
    if (cached) {
      mergeData(cached);
      renderAll();
      invoke('coursePortalTeacherData', { sessionToken: token, weekStart, month: payrollMonth }).then((fresh) => {
        mergeData(fresh);
        writeCache(weekStart, payrollMonth, fresh);
        renderAll();
      }).catch(() => {});
      return;
    }
    const result = await invoke('coursePortalTeacherData', { sessionToken: token, weekStart, month: payrollMonth });
    mergeData(result);
    writeCache(weekStart, payrollMonth, result);
    renderAll();
  }

  async function load(force) {
    try {
      await fetchData(Boolean(force));
    } catch (error) {
      if (/登入|綁定|權限|到期/.test(error.message || '')) {
        setSession('');
        token = '';
        showBound(false);
      }
      toast(error.message || '讀取失敗', 'error');
    }
  }

  function activateTab(tab) {
    activeTab = ['schedule','students','payroll'].includes(tab) ? tab : 'schedule';
    document.querySelectorAll('[data-tab]').forEach((node) => node.classList.toggle('active', node.dataset.tab === activeTab));
    document.querySelectorAll('[data-panel]').forEach((node) => node.classList.toggle('hidden', node.dataset.panel !== activeTab));
    const panel = document.querySelector(`[data-panel="${activeTab}"]`);
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openMore() {
    const node = document.getElementById('teacherMoreBackdrop');
    node.classList.remove('hidden');
    node.setAttribute('aria-hidden', 'false');
    document.body.classList.add('teacher-more-open');
  }

  function closeMore() {
    const node = document.getElementById('teacherMoreBackdrop');
    node.classList.add('hidden');
    node.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('teacher-more-open');
  }

  function prefillEmployee() {
    let employee = null;
    try { employee = JSON.parse(localStorage.getItem('employeeUser') || 'null'); } catch (_) {}
    if (!employee) return;
    const identity = clean(employee.identityType).toLowerCase();
    if (identity && identity !== 'external') return;
    const form = document.getElementById('bindForm');
    form.elements.name.value = form.elements.name.value || employee.name || employee.displayName || '';
    form.elements.phone.value = form.elements.phone.value || employee.phone || employee.mobile || employee.tel || '';
    document.getElementById('employeeLoginBridge').classList.add('employee-recognized');
  }

  async function exchangeAccess() {
    const params = new URLSearchParams(location.search);
    const access = clean(params.get('access'));
    if (!access) return getSession();
    const result = await invoke('coursePortalExchangeAccess', { accessToken: access });
    if (result.role !== 'teacher') throw new Error('這個登入連結不屬於老師入口。');
    setSession(result.sessionToken);
    params.delete('access');
    history.replaceState({}, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
    return result.sessionToken;
  }

  async function startBinding(form, button) {
    loading(button, true, '產生中…');
    try {
      const fields = Object.fromEntries(new FormData(form).entries());
      const result = await invoke('coursePortalStartBinding', Object.assign({ type: 'teacher' }, fields));
      const box = document.querySelector('[data-bind-result]');
      box.classList.remove('hidden');
      box.innerHTML = `<strong>請把下面整段文字傳給柚子樂器官方 LINE：</strong><code>${escapeHtml(result.bindText)}</code><div class="grid two"><button class="btn soft" type="button" id="copyBindText">複製綁定文字</button><a class="btn primary" href="${escapeHtml(result.lineUrl)}">開啟官方 LINE</a></div><small>貼上送出後，開啟官方 LINE 回覆的登入連結。本連結有效 20 分鐘。</small>`;
      document.getElementById('copyBindText').addEventListener('click', async (event) => {
        try {
          await navigator.clipboard.writeText(result.bindText);
          event.currentTarget.textContent = '已複製';
        } catch (_) {
          toast('請長按綁定文字後複製。');
        }
      });
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      loading(button, false);
    }
  }

  function sourceRow() {
    const form = document.getElementById('actionForm');
    const id = form.elements.sourceEventId.value || document.getElementById('actionSourceLesson').value;
    return (data.events || []).find((row) => row.id === id || row.sourceId === id) || null;
  }

  function syncActionMode() {
    const form = document.getElementById('actionForm');
    const action = form.elements.action.value;
    const moving = action === 'single_move' || action === 'permanent_move';
    document.getElementById('sourceLessonField').classList.toggle('hidden', !moving || Boolean(form.elements.sourceEventId.value));
    document.getElementById('quickAvailability').classList.toggle('hidden', !moving || !sourceRow());
    document.getElementById('giftNotice').classList.toggle('hidden', action !== 'teacher_gift');
  }

  function fillAction(options) {
    document.getElementById('actionStudent').innerHTML = data.roster.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join('');
    document.getElementById('actionSubject').innerHTML = data.subjects.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join('');
    document.getElementById('actionRoom').innerHTML = data.rooms.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join('');
    const sourceRows = uniqueEvents((data.events || []).filter((row) => row.own)).sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
    document.getElementById('actionSourceLesson').innerHTML = '<option value="">請選擇要移動的課程</option>' + sourceRows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(`${row.date} ${row.startTime} ${(row.studentNames || []).join('、')}`)}</option>`).join('');
    const form = document.getElementById('actionForm');
    form.reset();
    Object.entries(options || {}).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
    form.dataset.vacancyDate = options && options.vacancyDate || '';
    form.dataset.vacancyStart = options && options.vacancyStart || '';
    form.dataset.portalAction = options && options.portalAction || '';
    form.dataset.portalChangeId = options && options.portalChangeId || '';
    document.getElementById('lessonStateActions').classList.toggle('hidden', !form.elements.sourceEventId.value);
    document.getElementById('cancelPortalLesson').classList.toggle('hidden', !form.dataset.portalChangeId);
    syncActionMode();
    document.getElementById('actionModal').classList.remove('hidden');
    if (form.elements.sourceEventId.value) loadAvailability();
  }

  function applySource(row) {
    if (!row) return;
    const form = document.getElementById('actionForm');
    form.elements.sourceEventId.value = row.sourceId || row.id;
    form.elements.sourceCourseId.value = row.fixedCourseId || row.sourceId || row.id;
    form.elements.sourceDate.value = row.date;
    form.dataset.portalAction = row.portalAction || '';
    form.dataset.portalChangeId = row.portalChangeId || '';
    form.elements.studentId.value = (row.studentIds || [])[0] || '';
    form.elements.subjectId.value = row.subjectId || '';
    document.getElementById('lessonStateActions').classList.remove('hidden');
    document.getElementById('cancelPortalLesson').classList.toggle('hidden', !form.dataset.portalChangeId);
  }

  async function loadAvailability() {
    const row = sourceRow();
    const form = document.getElementById('actionForm');
    if (!row || !['single_move','permanent_move'].includes(form.elements.action.value)) return;
    const node = document.getElementById('availabilitySuggestions');
    node.innerHTML = '<p class="muted">正在找未來兩週可用的位置…</p>';
    document.getElementById('quickAvailability').classList.remove('hidden');
    try {
      const result = await invoke('coursePortalTeacherAvailability', {
        sessionToken: token,
        startDate: weekStart,
        days: 14,
        sourceEventId: row.sourceId || row.id,
        sourceCourseId: row.fixedCourseId || row.sourceId || row.id,
        sourceDate: row.date,
        sourceStartTime: row.startTime,
        sourceEndTime: row.endTime,
        subjectId: row.subjectId
      });
      const slots = (result.slots || []).filter((slot) => slot.rooms && slot.rooms.length).slice(0, 30);
      node.innerHTML = slots.map((slot) => `<button class="availability-option" type="button" data-available-date="${escapeHtml(slot.date)}" data-available-start="${escapeHtml(slot.startTime)}" data-available-end="${escapeHtml(slot.endTime)}" data-available-room="${escapeHtml(slot.rooms[0].id)}"><strong>${escapeHtml(dayLabel(slot.date))}　${escapeHtml(slot.startTime)}～${escapeHtml(slot.endTime)}</strong><span>${escapeHtml(slot.rooms.map((room) => room.name).join('、'))}</span></button>`).join('') || '<div class="notice">未來兩週沒有完整可用時段。</div>';
    } catch (error) {
      node.innerHTML = '<div class="notice">目前無法讀取空位。</div>';
      toast(error.message, 'error');
    }
  }

  document.getElementById('bindForm').addEventListener('submit', (event) => {
    event.preventDefault();
    startBinding(event.currentTarget, event.submitter);
  });

  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  document.getElementById('prevWeek').addEventListener('click', () => { weekStart = addDays(weekStart, -7); load(true); });
  document.getElementById('nextWeek').addEventListener('click', () => { weekStart = addDays(weekStart, 7); load(true); });
  document.getElementById('thisWeek').addEventListener('click', () => { weekStart = monday(); load(true); });
  document.getElementById('loadPayroll').addEventListener('click', () => { payrollMonth = document.getElementById('payrollMonth').value || monthKey(); load(true); });
  document.getElementById('teacherMoreBtn').addEventListener('click', openMore);
  document.getElementById('closeTeacherMore').addEventListener('click', closeMore);
  document.getElementById('teacherMoreBackdrop').addEventListener('click', (event) => { if (event.target.id === 'teacherMoreBackdrop') closeMore(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMore(); });

  document.getElementById('weekGrid').addEventListener('click', (event) => {
    const empty = event.target.closest('[data-empty]');
    const lesson = event.target.closest('[data-event]');
    if (empty) {
      const parts = empty.dataset.empty.split('|');
      fillAction({ action: 'extra_lesson', date: parts[0], startTime: parts[1], endTime: parts[2] });
    }
    if (lesson) {
      const row = (data.events || []).find((item) => item.id === lesson.dataset.event);
      if (row) fillAction({
        action: 'single_move', sourceEventId: row.sourceId || row.id, sourceCourseId: row.fixedCourseId || row.sourceId || row.id, sourceDate: row.date,
        studentId: (row.studentIds || [])[0] || '', subjectId: row.subjectId, roomId: row.roomId,
        date: row.date, startTime: row.startTime, endTime: row.endTime,
        portalAction: row.portalAction, portalChangeId: row.portalChangeId
      });
    }
  });

  document.getElementById('rosterList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-student-action]');
    if (button) fillAction({ action: 'extra_lesson', studentId: button.dataset.studentAction, date: weekStart, startTime: '10:00', endTime: '11:00' });
    const bonus=event.target.closest('[data-bonus-student]');
    if(bonus){const form=document.getElementById('bonusRequestForm');form.elements.studentId.value=bonus.dataset.bonusStudent;form.elements.studentName.value=bonus.dataset.bonusName;document.getElementById('bonusStudentName').value=bonus.dataset.bonusName;document.getElementById('bonusRequestModal').classList.remove('hidden');}
  });
  document.getElementById('closeBonusRequest').addEventListener('click',()=>document.getElementById('bonusRequestModal').classList.add('hidden'));
  document.getElementById('bonusRequestForm').addEventListener('submit',async(event)=>{event.preventDefault();const button=event.submitter;loading(button,true,'送出中…');try{const form=event.currentTarget;let photoData='';const file=document.getElementById('bonusPhoto').files[0];if(file){photoData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=reject;reader.readAsDataURL(file);});}const result=await invoke('coursePortalTeacherBonusRequest',{sessionToken:token,studentId:form.elements.studentId.value,studentName:form.elements.studentName.value,description:form.elements.description.value,photoData});document.getElementById('bonusRequestModal').classList.add('hidden');form.reset();toast(result.message||'申請已送出。');}catch(error){toast(error.message,'error');}finally{loading(button,false);}});

  document.getElementById('actionType').addEventListener('change', () => { syncActionMode(); loadAvailability(); });
  document.getElementById('actionSourceLesson').addEventListener('change', (event) => { applySource((data.events || []).find((item) => item.id === event.target.value)); syncActionMode(); loadAvailability(); });
  document.getElementById('reloadAvailability').addEventListener('click', loadAvailability);
  document.getElementById('availabilitySuggestions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-available-date]');
    if (!button) return;
    const form = document.getElementById('actionForm');
    form.elements.date.value = button.dataset.availableDate;
    form.elements.startTime.value = button.dataset.availableStart;
    form.elements.endTime.value = button.dataset.availableEnd;
    form.elements.roomId.value = button.dataset.availableRoom;
    document.querySelectorAll('.availability-option').forEach((node) => node.classList.toggle('selected', node === button));
  });

  document.getElementById('closeModal').addEventListener('click', () => document.getElementById('actionModal').classList.add('hidden'));
  document.getElementById('actionForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    loading(button, true, '檢查教室並儲存…');
    try {
      const result = await invoke('coursePortalTeacherAction', Object.assign({ sessionToken: token }, Object.fromEntries(new FormData(event.currentTarget).entries())));
      document.getElementById('actionModal').classList.add('hidden');
      clearCache();
      toast(result.message || '課程已儲存。');
      await load(true);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      loading(button, false);
    }
  });

  document.getElementById('lessonStateActions').addEventListener('click', async (event) => {
    const lateButton=event.target.closest('[data-late-attendance]');
    if(lateButton){
      const form=document.getElementById('actionForm');
      if(!confirm('補簽到會收取行政處理費 NT$50，並直接列入本月薪資扣款。確定要補簽到嗎？'))return;
      loading(lateButton,true,'補簽中…');
      try{
        const result=await invoke('coursePortalTeacherLateAttendance',{sessionToken:token,sourceEventId:form.elements.sourceEventId.value,sourceCourseId:form.elements.sourceCourseId.value,sourceDate:form.elements.sourceDate.value});
        document.getElementById('actionModal').classList.add('hidden');
        clearCache();
        toast(result.message||'補簽到已完成。');
        await load(true);
      }catch(error){toast(error.message,'error');}
      finally{loading(lateButton,false);}
      return;
    }
    const button = event.target.closest('[data-lesson-state]');
    if (!button) return;
    const state = button.dataset.lessonState;
    const messages = {
      leave: '確定標示學生請假？這個教室時段會釋出。',
      absent: '確定標示曠課？本堂仍會列入老師薪資。',
      cancel_change: '確定取消這次由老師新增、贈送或調整的安排？'
    };
    if (!confirm(messages[state])) return;
    const form = document.getElementById('actionForm');
    loading(button, true, '處理中…');
    try {
      const result = await invoke('coursePortalTeacherLessonState', {
        sessionToken: token,
        state,
        sourceEventId: form.elements.sourceEventId.value,
        sourceCourseId: form.elements.sourceCourseId.value,
        sourceDate: form.elements.sourceDate.value,
        portalChangeId: form.dataset.portalChangeId,
        note: form.elements.note.value
      });
      document.getElementById('actionModal').classList.add('hidden');
      clearCache();
      toast(result.message || '課程狀態已更新。');
      await load(true);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      loading(button, false);
    }
  });

  logoutBtn.addEventListener('click', () => { setSession(''); location.reload(); });
  document.getElementById('payrollMonth').value = payrollMonth;

  (async function init() {
    prefillEmployee();
    try {
      token = await exchangeAccess();
      if (token) await load(false);
      else showBound(false);
    } catch (error) {
      toast(error.message, 'error');
      showBound(false);
    }
  })();
})(window);
