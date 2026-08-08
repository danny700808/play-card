(function (global) {
  'use strict';

  const config = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
  if (!global.firebase || !config) throw new Error('Firebase 尚未載入。');
  if (!global.firebase.apps.length) global.firebase.initializeApp(config);
  const functions = global.firebase.app().functions('us-central1');
  const PortalAuth = global.CoursePortal;
  const TeacherDailyReminder = global.YZTeacherDailyReminder;

  const SESSION_KEY = 'youzi.coursePortal.teacher.session.v1';
  const TEACHER_MORE_AUTH_CACHE_KEY = 'youzi.teacherMore.authorization.v4';
  const CACHE_PREFIX = 'youzi.teacherCourseApp.v8.';
  const CACHE_TTL = 90 * 1000;
  const TEACHER_UTILITY_STATUS_TTL = 2 * 60 * 1000;
  const PAYROLL_MIN_MONTH = '2026-07';
  const TAIPEI_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const bindView = document.getElementById('bindView');
  const appView = document.getElementById('appView');
  const logoutBtn = document.getElementById('logoutBtn');
  const teacherPortalNav = document.getElementById('teacherPortalNav');
  const teacherLoginHeader = document.getElementById('teacherLoginHeader');

  let token = '';
  let weekStart = monday();
  let payrollMonth = monthKey() < PAYROLL_MIN_MONTH ? PAYROLL_MIN_MONTH : monthKey();
  let activeTab = 'schedule';
  let data = emptyData();
  let rosterQuery = '';
  let quickContext = null;
  let planner = null;
  let availabilityRequestId = 0;
  let weekSnapTimer = 0;
  let teacherUtilityStatusLoaded = false;
  let teacherUtilityStatusLoadedAt = 0;
  let teacherUtilityStatusLoading = false;
  let teacherUtilityResult = null;
  let teacherUtilityRequestId = 0;

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

  function inferredEquipmentLabel(name) {
    name = clean(name);
    if (/展演|團練/.test(name)) return '電鋼琴';
    if (/yamaha.*平台|平台.*yamaha|5號鋼琴|五號鋼琴/i.test(name)) return '平台鋼琴';
    if (/kawai|卡哇伊|yamaha.*直立|直立.*yamaha/i.test(name)) return '直立鋼琴';
    return '';
  }

  function roomOptionLabel(room) {
    const equipment = clean(room && room.equipmentLabel) || inferredEquipmentLabel(room && room.name);
    return equipment ? `${clean(room.name)}（${equipment}）` : clean(room && room.name);
  }

  function roomChoiceNote(room, fallback) {
    return room && room.requiresGuzhengMove
      ? '可使用，但需自行從展演空間搬運古箏'
      : (fallback || '這間教室目前可使用');
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
    return todayKey().slice(0, 7);
  }

  function todayKey() {
    const parts = TAIPEI_DATE_FORMATTER.formatToParts(new Date()).reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function monday(value) {
    const date = new Date(`${value || todayKey()}T12:00:00`);
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

  function isPastSlot(date, startTime) {
    const value = Date.parse(`${clean(date)}T${clean(startTime).slice(0, 5)}:00+08:00`);
    return !Number.isFinite(value) || value <= Date.now();
  }

  function operationId() {
    const bytes = new Uint32Array(2);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(bytes);
    else {
      bytes[0] = Math.floor(Math.random() * 0xffffffff);
      bytes[1] = Math.floor(Math.random() * 0xffffffff);
    }
    return `${Date.now().toString(36)}-${bytes[0].toString(36)}${bytes[1].toString(36)}`;
  }

  function eventKey(event) {
    return `${clean(event && event.date)}|${clean(event && event.startTime).slice(0, 5)}`;
  }

  function allowedSubjects() {
    const ids = new Set((data.teacher && data.teacher.subjectIds || []).map(clean).filter(Boolean));
    return ids.size ? data.subjects.filter((row) => ids.has(clean(row.id))) : data.subjects.slice();
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
    else {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(TEACHER_MORE_AUTH_CACHE_KEY);
      try {
        const user = JSON.parse(localStorage.getItem('employeeUser') || 'null');
        if (user && user.portalSessionBridge === true) {
          localStorage.removeItem('employeeUser');
          localStorage.removeItem('employeeUserId');
        }
      } catch (_) {}
      teacherUtilityStatusLoaded = false;
      teacherUtilityStatusLoadedAt = 0;
      teacherUtilityStatusLoading = false;
      teacherUtilityResult = null;
      teacherUtilityRequestId += 1;
    }
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
    document.getElementById('sessionLoading').classList.add('hidden');
    teacherPortalNav.classList.toggle('hidden', !active);
    teacherLoginHeader.classList.toggle('hidden', active);
  }

  function mergeData(next) {
    data = Object.assign({}, data, next || {});
    ['rooms','subjects','events','roster','payroll','adjustments'].forEach((key) => {
      if (!Array.isArray(data[key])) data[key] = [];
    });
    if (!data.teacher) data.teacher = {};
    if (!data.hours) data.hours = { start: 10, end: 21 };
  }

  function teacherRawName() {
    return clean(data.teacher && (data.teacher.name || data.teacher.teacherName));
  }

  function saveTeacherUtilityAuthorization(result) {
    const user = Object.assign({}, result && result.user || {}, {
      portalSessionBridge: true,
      portalSessionValidatedAt: Date.now()
    });
    const employeeId = clean(user.employeeId || user.id);
    if (!employeeId) return;
    localStorage.setItem('employeeUser', JSON.stringify(user));
    localStorage.setItem('employeeUserId', employeeId);
    localStorage.setItem(TEACHER_MORE_AUTH_CACHE_KEY, JSON.stringify({
      employeeId,
      tokenFingerprint: tokenFingerprint(token),
      validatedAt: Date.now(),
      profileComplete: result.profileComplete === true,
      missingProfileFields: Array.isArray(result.missingProfileFields) ? result.missingProfileFields : []
    }));
  }

  function count(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function setPendingBadge(id, value, bangOnly) {
    const badge = document.getElementById(id);
    if (!badge) return;
    const amount = count(value);
    badge.classList.toggle('hidden', amount <= 0);
    badge.setAttribute('aria-hidden', amount > 0 ? 'false' : 'true');
    badge.textContent = bangOnly ? '!' : (amount > 99 ? '99+' : String(amount || '!'));
  }

  function pendingState(result) {
    const summary = result && result.pendingSummary || {};
    const user = result && result.user || {};
    const employeeId = clean(result && result.employeeId || user.employeeId || user.id);
    const missing = Array.isArray(result && result.missingProfileFields) ? result.missingProfileFields : [];
    const profileCount = summary.profileCount == null
      ? (result && result.profileComplete === true ? 0 : (missing.length ? 1 : 0))
      : count(summary.profileCount);
    const contractCount = count(summary.contractCount);
    const taskCount = count(summary.taskCount);
    const announcementCount = count(summary.announcementCount);
    const goodsCount = count(summary.goodsCount);
    const goodsAttentionCount = count(summary.goodsAttentionCount);
    const announcementsUnseen = Boolean(TeacherDailyReminder && TeacherDailyReminder.isRevisionUnseen(
      global.localStorage,
      employeeId,
      'announcements',
      summary.announcementRevision,
      announcementCount
    ));
    const goodsUnseen = Boolean(TeacherDailyReminder && TeacherDailyReminder.isRevisionUnseen(
      global.localStorage,
      employeeId,
      'goods',
      summary.goodsRevision,
      goodsCount
    ));
    const goodsAttentionUnseen = Boolean(TeacherDailyReminder && TeacherDailyReminder.isRevisionUnseen(
      global.localStorage,
      employeeId,
      'goods-attention',
      summary.goodsAttentionRevision,
      goodsAttentionCount
    ));
    const items = [];
    if (profileCount) items.push({ kind: 'profile', text: '基本資料尚未完成' });
    if (contractCount) items.push({ kind: 'contracts', text: `有 ${contractCount} 份合約待查看或簽署` });
    if (announcementCount) items.push({
      kind: 'announcements',
      text: announcementsUnseen
        ? `有 ${announcementCount} 則新公告或待回覆公告`
        : `仍有 ${announcementCount} 則公告待查看或回覆`
    });
    if (taskCount) items.push({ kind: 'tasks', text: `有 ${taskCount} 項協助事項待處理` });
    if (goodsAttentionUnseen) items.push({ kind: 'goods-attention', text: `有 ${goodsAttentionCount} 筆詢價更新可以查看` });
    if (goodsUnseen) items.push({ kind: 'goods', text: '有商品更新可以查看' });
    return {
      employeeId,
      summary,
      available: summary.available !== false,
      profileCount,
      contractCount,
      taskCount,
      announcementCount,
      goodsBadgeCount: goodsAttentionUnseen ? goodsAttentionCount : (goodsUnseen ? 1 : 0),
      items
    };
  }

  function overlayIsOpen(id) {
    const node = document.getElementById(id);
    return Boolean(node && !node.classList.contains('hidden'));
  }

  function syncTeacherOverlayScrollLock() {
    const locked = ['teacherDailyReminderBackdrop','teacherMoreBackdrop','teacherQuickBackdrop']
      .some(overlayIsOpen);
    document.body.classList.toggle('teacher-more-open', locked);
  }

  function closeDailyReminder() {
    const dialog = document.getElementById('teacherDailyReminderBackdrop');
    if (!dialog) return;
    dialog.classList.add('hidden');
    dialog.setAttribute('aria-hidden', 'true');
    syncTeacherOverlayScrollLock();
  }

  function showDailyReminder(state) {
    if (!state.available || !state.items.length || !TeacherDailyReminder || !TeacherDailyReminder.shouldShowDaily(
      global.localStorage,
      state.employeeId,
      state.items.length,
      undefined,
      state.available
    )) return;
    const list = document.getElementById('teacherDailyReminderList');
    const dialog = document.getElementById('teacherDailyReminderBackdrop');
    if (!list || !dialog) return;
    TeacherDailyReminder.markDailyShown(global.localStorage, state.employeeId);
    list.replaceChildren(...state.items.map((item) => {
      const row = document.createElement('li');
      row.textContent = item.text;
      row.dataset.pendingKind = item.kind;
      return row;
    }));
    dialog.classList.remove('hidden');
    dialog.setAttribute('aria-hidden', 'false');
    syncTeacherOverlayScrollLock();
    requestAnimationFrame(() => document.getElementById('teacherDailyReminderConfirm').focus());
  }

  function renderTeacherUtilityStatus(result, error, options) {
    const hint = document.getElementById('teacherProfileLinkHint');
    ['teacherProfileBadge','teacherContractBadge','teacherAnnouncementBadge','teacherTaskBadge','teacherGoodsBadge','teacherMoreBadge']
      .forEach((id) => setPendingBadge(id, 0, true));
    if (error) {
      teacherUtilityResult = null;
      setPendingBadge('teacherProfileBadge', 1, true);
      setPendingBadge('teacherMoreBadge', 1, true);
      if (hint) hint.textContent = '資料狀態暫時無法確認';
      return;
    }
    teacherUtilityResult = result || null;
    const state = pendingState(result || {});
    setPendingBadge('teacherProfileBadge', state.profileCount, true);
    setPendingBadge('teacherContractBadge', state.contractCount, false);
    setPendingBadge('teacherAnnouncementBadge', state.announcementCount, false);
    setPendingBadge('teacherTaskBadge', state.taskCount, false);
    setPendingBadge('teacherGoodsBadge', state.goodsBadgeCount, state.goodsBadgeCount === 1);
    setPendingBadge('teacherMoreBadge', state.items.length, true);
    if (hint) hint.textContent = state.profileCount ? '資料尚未完成，請前往填寫' : '基本資料與登入方式';
    if (!(options && options.suppressDaily)) showDailyReminder(state);
  }

  function markTeacherRevisionSeen(kind) {
    if (!teacherUtilityResult || !TeacherDailyReminder) return;
    const state = pendingState(teacherUtilityResult);
    const summary = state.summary || {};
    if (kind === 'goods') {
      TeacherDailyReminder.markRevisionSeen(
        global.localStorage,
        state.employeeId,
        'goods',
        summary.goodsRevision,
        summary.goodsCount
      );
      TeacherDailyReminder.markRevisionSeen(
        global.localStorage,
        state.employeeId,
        'goods-attention',
        summary.goodsAttentionRevision,
        summary.goodsAttentionCount
      );
    } else {
      TeacherDailyReminder.markRevisionSeen(
        global.localStorage,
        state.employeeId,
        'announcements',
        summary.announcementRevision,
        summary.announcementCount
      );
    }
    renderTeacherUtilityStatus(teacherUtilityResult, null, { suppressDaily: true });
  }

  async function refreshTeacherUtilityStatus(force) {
    const fresh = teacherUtilityStatusLoaded && Date.now() - teacherUtilityStatusLoadedAt < TEACHER_UTILITY_STATUS_TTL;
    if (!token || teacherUtilityStatusLoading || (fresh && !force)) return;
    teacherUtilityStatusLoading = true;
    const requestId = ++teacherUtilityRequestId;
    try {
      const result = await invoke('coursePortalTeacherUtilitySession', { sessionToken: token });
      if (requestId !== teacherUtilityRequestId) return;
      const pendingSummaryAvailable = !(result && result.pendingSummary && result.pendingSummary.available === false);
      teacherUtilityStatusLoaded = pendingSummaryAvailable;
      teacherUtilityStatusLoadedAt = pendingSummaryAvailable ? Date.now() : 0;
      saveTeacherUtilityAuthorization(result);
      renderTeacherUtilityStatus(result, null);
    } catch (error) {
      if (requestId !== teacherUtilityRequestId) return;
      teacherUtilityStatusLoaded = false;
      teacherUtilityStatusLoadedAt = 0;
      renderTeacherUtilityStatus(null, error);
    } finally {
      if (requestId === teacherUtilityRequestId) teacherUtilityStatusLoading = false;
    }
  }

  function updateWeekViewport() {
    const grid = document.getElementById('weekGrid');
    const scroll = grid && grid.parentElement;
    const mobile = global.matchMedia && global.matchMedia('(max-width: 760px)').matches;
    if (!grid || !scroll || !mobile) {
      if (grid) {
        grid.style.removeProperty('--teacher-day-width');
        grid.style.removeProperty('--teacher-time-column');
      }
      return;
    }
    const stickyWidth = global.matchMedia('(max-width: 520px)').matches ? 48 : 58;
    const dayWidth = Math.max(1, scroll.clientWidth - stickyWidth) / 2;
    grid.style.setProperty('--teacher-time-column', `${stickyWidth}px`);
    grid.style.setProperty('--teacher-day-width', `${dayWidth}px`);
  }

  function snapWeekScrollToGroup() {
    const grid = document.getElementById('weekGrid');
    const scroll = grid && grid.parentElement;
    const mobile = global.matchMedia && global.matchMedia('(max-width: 760px)').matches;
    const dayWidth = Number.parseFloat(grid && grid.style.getPropertyValue('--teacher-day-width'));
    if (!grid || !scroll || !mobile || !Number.isFinite(dayWidth) || dayWidth <= 0) return;
    const maxScroll = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
    const targets = [0, dayWidth * 2, dayWidth * 4, maxScroll]
      .map((value) => Math.min(maxScroll, Math.max(0, value)))
      .filter((value, index, rows) => index === 0 || Math.abs(value - rows[index - 1]) > 1);
    const target = targets.reduce((nearest, value) => (
      Math.abs(value - scroll.scrollLeft) < Math.abs(nearest - scroll.scrollLeft) ? value : nearest
    ), targets[0] || 0);
    if (Math.abs(target - scroll.scrollLeft) > 1) {
      scroll.scrollTo({ left: target, behavior: 'smooth' });
    }
  }

  function scheduleWeekGroupSnap() {
    global.clearTimeout(weekSnapTimer);
    weekSnapTimer = global.setTimeout(snapWeekScrollToGroup, 140);
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
    const status = clean(event.status).toLowerCase();
    const stateLabel = status === 'leave'
      ? '請假'
      : (status === 'absent'
        ? '曠課'
        : (['attended', 'checked_in', 'present'].includes(status)
          ? '已簽到'
          : (status === 'cancelled'
            ? '已取消'
            : (status === 'pending_conflict' ? '待補排' : ''))));
    const details = [
      event.subjectName,
      event.roomName,
      stateLabel,
      status === 'pending_conflict' ? event.pendingReason : ''
    ].filter(Boolean).join('・');
    const portalAction = clean(event.portalAction);
    const eventType = clean(event.type).toLowerCase();
    const visualType = (
      ['rental', 'room_rental'].includes(eventType) || ['rental', 'room_booking'].includes(portalAction)
        ? 'rental'
        : (event.specialLesson || portalAction === 'teacher_gift' || eventType === 'teacher_gift'
        ? 'gift'
        : (portalAction === 'extra_lesson' || eventType === 'temporary' || eventType === 'extra'
          ? 'extra'
          : (portalAction === 'single_move' || portalAction === 'permanent_move' || eventType === 'single'
            ? 'single'
            : (eventType === 'trial' || eventType === 'trial_lesson' ? 'trial' : 'fixed'))))
    );
    const classes = [
      'lesson',
      visualType,
      status === 'leave' ? 'leave' : '',
      status === 'absent' ? 'absent' : '',
      ['attended', 'checked_in', 'present'].includes(status) ? 'attended' : '',
      status === 'cancelled' ? 'cancelled' : '',
      status === 'pending_conflict' ? 'pending-conflict' : '',
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

  function lessonDurationMinutes(row, fallback) {
    const duration = timeMinutes(row && row.endTime) - timeMinutes(row && row.startTime);
    return duration >= 30 && duration <= 300 && duration % 30 === 0
      ? duration
      : (Number(fallback) || 60);
  }

  function plannerDurationMinutes() {
    const duration = Number(planner && planner.durationMinutes);
    return duration >= 30 && duration <= 300 && duration % 30 === 0
      ? duration
      : lessonDurationMinutes(planner && planner.source, 60);
  }

  function plannerSourceMatches(event) {
    const source = planner && planner.mode === 'move' && planner.source;
    if (!source || clean(event && event.date) !== clean(source.date)) return false;
    const sourceIds = [source.id, source.sourceId, source.fixedCourseId, source.seriesId].map(clean).filter(Boolean);
    const eventIds = [event.id, event.sourceId, event.fixedCourseId, event.seriesId].map(clean).filter(Boolean);
    return sourceIds.some((id) => eventIds.includes(id));
  }

  function eventBlocksPlannerGap(event) {
    const status = clean(event && event.status).toLowerCase();
    return !['leave', 'cancelled', 'pending_conflict'].includes(status);
  }

  function continuousTeacherGapMinutes(events, date, startTime, scheduleEndMinute) {
    const startMinute = timeMinutes(startTime);
    let nextBlockMinute = scheduleEndMinute;
    (events || []).forEach((event) => {
      if (
        clean(event.date) !== clean(date) ||
        !eventBlocksPlannerGap(event) ||
        plannerSourceMatches(event) ||
        timeMinutes(event.endTime) <= startMinute
      ) return;
      const eventStartMinute = timeMinutes(event.startTime);
      nextBlockMinute = Math.min(nextBlockMinute, eventStartMinute <= startMinute ? startMinute : eventStartMinute);
    });
    return Math.max(0, Math.floor((nextBlockMinute - startMinute) / 30) * 30);
  }

  function preferredAddDuration(context) {
    return 60;
  }

  function renderWeek() {
    const grid = document.getElementById('weekGrid');
    const scroll = grid.parentElement;
    const priorWeek = grid.dataset.week || '';
    const priorScrollLeft = scroll.scrollLeft;
    const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const events = uniqueEvents((data.events || []).filter((event) => event.own));
    const startHour = Number(data.hours.start || 10);
    const endHour = Number(data.hours.end || 21);
    const scheduleStart = startHour * 60;
    const scheduleEnd = endHour * 60;
    const requiredMinutes = planner ? plannerDurationMinutes() : 0;
    const plannerSlots = new Map((planner && planner.slots || []).map((slot) => [
      `${slot.date}|${slot.startTime}`,
      slot
    ]));
    let html = '<div class="week-cell head week-corner" style="grid-column:1;grid-row:1"></div>';

    days.forEach((day, dayIndex) => {
      const groupStart = dayIndex % 2 === 0 ? ' week-day-group-start' : '';
      html += `<div class="week-cell head week-day-head${groupStart}" data-day-head="${escapeHtml(day)}" data-day-group="${Math.floor(dayIndex / 2)}" style="grid-column:${dayIndex + 2};grid-row:1">${escapeHtml(dayLabel(day))}</div>`;
    });

    for (let minute = startHour * 60, slotIndex = 0; minute < endHour * 60; minute += 30, slotIndex += 1) {
      const slotStart = timeText(minute);
      const slotEnd = timeText(minute + 30);
      const gridRow = slotIndex + 2;
      html += `<div class="week-cell time" style="grid-column:1;grid-row:${gridRow}">${minute % 60 === 0 ? slotStart : ''}</div>`;
      days.forEach((day, dayIndex) => {
        const rows = uniqueEvents(events.filter((event) => event.date === day && event.startTime < slotEnd && slotStart < event.endTime));
        const available = plannerSlots.get(`${day}|${slotStart}`);
        const past = isPastSlot(day, slotStart);
        html += `<div class="week-cell" style="grid-column:${dayIndex + 2};grid-row:${gridRow}">`;
        if (!rows.length && new Date(`${day}T12:00:00`).getDay() !== 1 && !past) {
          if (available) {
            html += `<button class="empty-slot available-target" type="button" data-flow-target="${day}|${slotStart}" aria-label="${escapeHtml(`${day} ${slotStart} 可排入連續 ${requiredMinutes} 分鐘`)}"><span>可調入</span><small>${requiredMinutes} 分鐘</small></button>`;
          } else if (planner) {
            const gapMinutes = continuousTeacherGapMinutes(events, day, slotStart, scheduleEnd);
            const shortGap = gapMinutes >= 30 && gapMinutes < requiredMinutes;
            const label = shortGap ? '時段不足' : '不可排入';
            const detail = shortGap ? `僅 ${gapMinutes} 分鐘` : '已有衝突';
            const message = shortGap
              ? `這裡只有 ${gapMinutes} 分鐘空檔，這堂課需要連續 ${requiredMinutes} 分鐘，不能排入。`
              : `這個位置無法連續保留 ${requiredMinutes} 分鐘，請選擇綠色的「可調入」時段。`;
            html += `<button class="empty-slot unavailable-target" type="button" data-unavailable-target="${day}|${slotStart}" data-unavailable-message="${escapeHtml(message)}" aria-disabled="true"><span>${label}</span><small>${detail}</small></button>`;
          } else {
            html += `<button class="empty-slot" type="button" data-empty="${day}|${slotStart}|${slotEnd}" aria-label="${escapeHtml(`${day} ${slotStart} 查詢空教室`)}"></button>`;
          }
        } else if (!rows.length && new Date(`${day}T12:00:00`).getDay() === 1) {
          html += '<span class="closed-slot">公休</span>';
        }
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
    grid.dataset.week = weekStart;
    requestAnimationFrame(() => {
      updateWeekViewport();
      if (priorWeek === weekStart) {
        scroll.scrollLeft = priorScrollLeft;
        return;
      }
      const todayIndex = days.indexOf(todayKey());
      if (!priorWeek && todayIndex >= 0) {
        const groupIndex = Math.floor(todayIndex / 2);
        const groupHead = grid.querySelector(`.week-day-head[data-day-group="${groupIndex}"]`);
        const timeColumn = grid.querySelector('.week-corner');
        const target = groupHead
          ? groupHead.offsetLeft - (timeColumn ? timeColumn.offsetWidth : 0)
          : 0;
        const maxScroll = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
        scroll.scrollLeft = Math.min(maxScroll, Math.max(0, target));
        return;
      }
      scroll.scrollLeft = 0;
    });
  }

  function renderRoster() {
    const query = clean(rosterQuery).toLocaleLowerCase('zh-Hant');
    const teacherName = teacherRawName();
    const rows = data.roster.filter((student) => {
      if (!query) return true;
      const studentName = clean(student && student.name).toLocaleLowerCase('zh-Hant');
      const rowTeacherName = clean(student && student.teacherName || teacherName).toLocaleLowerCase('zh-Hant');
      const normalizedTeacherName = rowTeacherName.replace(/老師$/, '');
      return studentName.includes(query)
        || rowTeacherName.includes(query)
        || normalizedTeacherName.includes(query);
    });
    document.getElementById('rosterBadge').textContent = query
      ? `${rows.length}/${data.roster.length} 位`
      : `${data.roster.length} 位`;
    if (!rows.length) {
      document.getElementById('rosterList').innerHTML = query
        ? `<p class="muted teacher-roster-empty">找不到符合「${escapeHtml(rosterQuery)}」的學生或老師。</p>`
        : '<p class="muted teacher-roster-empty">目前沒有可顯示的學生。</p>';
      return;
    }
    document.getElementById('rosterList').innerHTML = rows.map((student) => {
      const rowTeacherName = clean(student && student.teacherName || teacherName);
      const detail = [
        rowTeacherName ? `授課老師 ${rowTeacherName}` : '',
        `手機末四碼 ${clean(student.phoneLast4) || '未提供'}`
      ].filter(Boolean).join('・');
      return `<article class="list-row teacher-roster-row"><strong>${escapeHtml(student.name)}</strong><span>${escapeHtml(detail)}</span><span class="teacher-roster-actions"><button class="btn soft" type="button" data-student-action="${escapeHtml(student.id)}">增加課程</button><button class="btn" type="button" data-edit-student="${escapeHtml(student.id)}">修改資料</button><button class="btn" type="button" data-bonus-student="${escapeHtml(student.id)}" data-bonus-name="${escapeHtml(student.name)}">教材／商品</button><button class="btn danger" type="button" data-stop-student="${escapeHtml(student.id)}">停課</button></span></article>`;
    }).join('');
  }

  function rosterStudent(studentId) {
    return data.roster.find((row) => clean(row.id) === clean(studentId)) || null;
  }

  function openStudentEdit(studentId) {
    const student = rosterStudent(studentId);
    if (!student) return;
    const form = document.getElementById('studentEditForm');
    form.elements.studentId.value = student.id;
    form.elements.name.value = student.name || '';
    form.elements.phone.value = student.phone || '';
    document.getElementById('studentEditModal').classList.remove('hidden');
    requestAnimationFrame(() => form.elements.name.focus());
  }

  function closeStudentEdit() {
    document.getElementById('studentEditModal').classList.add('hidden');
  }

  function openStudentStop(studentId) {
    const student = rosterStudent(studentId);
    if (!student) return;
    const button = document.getElementById('confirmStudentStop');
    button.dataset.studentId = student.id;
    document.getElementById('stopStudentName').textContent = student.name || '這位學生';
    document.getElementById('studentStopModal').classList.remove('hidden');
  }

  function closeStudentStop() {
    const button = document.getElementById('confirmStudentStop');
    delete button.dataset.studentId;
    document.getElementById('studentStopModal').classList.add('hidden');
  }

  function renderPayroll() {
    const rows = data.payroll || [];
    const adjustments = data.adjustments || [];
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
    })).concat(adjustments.map((row) => {
      const type = clean(valueOf(row, ['type'], 'adjustment')).toLowerCase();
      const rawAmount = Number(valueOf(row, ['amount'], 0));
      const deduction = ['deduction', 'penalty', 'late_attendance_fee', 'attendance_cancellation_fee']
        .includes(type);
      return {
        kind: 'adjustment',
        date: valueOf(row, ['date','month'], payrollMonth),
        name: valueOf(row, ['note','reason'], '獎勵／扣款'),
        subject: type === 'reward' ? '獎勵' : (deduction ? '扣款' : valueOf(row, ['type'], '調整')),
        collected: 0,
        rate: '—',
        amount: deduction ? -Math.abs(rawAmount) : rawAmount
      };
    })).sort((a, b) => `${a.date}|${a.name}`.localeCompare(`${b.date}|${b.name}`, 'zh-Hant'));
    const groups = new Map();
    items.forEach((item) => {
      const key = item.date || '日期未提供';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    document.getElementById('payrollList').innerHTML = [...groups.entries()].map(([date, dayRows]) => `<section class="payroll-day"><h3>${escapeHtml(date)}</h3>${dayRows.map((row) => `<article class="list-row payroll-row"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.subject || (row.kind === 'lesson' ? '課堂' : '調整'))}</span><span>${row.kind === 'lesson' ? `收費 ${money(row.collected)}・分成 ${escapeHtml(row.rate)}` : '獎勵／扣款'}</span><strong>老師所得 ${money(row.amount)}</strong><span class="badge ${row.kind === 'adjustment' ? 'warn' : ''}">${row.kind === 'lesson' ? '課堂' : '調整'}</span></article>`).join('')}</section>`).join('') || '<p class="muted">這個月份目前沒有薪資資料。</p>';
  }

  function renderAll() {
    renderWeek();
    renderRoster();
    renderPayroll();
    showBound(true);
  }

  async function fetchData(force) {
    const request = {
      sessionToken: token,
      weekStart,
      month: payrollMonth,
      includePayroll: activeTab === 'payroll'
    };
    const cached = !force ? readCache(weekStart, payrollMonth) : null;
    if (cached) {
      mergeData(cached);
      renderAll();
      invoke('coursePortalTeacherData', request).then((fresh) => {
        mergeData(fresh);
        writeCache(weekStart, payrollMonth, data);
        renderAll();
      }).catch((error) => {
        if (PortalAuth && typeof PortalAuth.isSessionAuthError === 'function' && PortalAuth.isSessionAuthError(error)) {
          PortalAuth.invalidateSession('teacher', error);
        }
      });
      return;
    }
    const result = await invoke('coursePortalTeacherData', request);
    mergeData(result);
    writeCache(weekStart, payrollMonth, data);
    renderAll();
  }

  async function load(force) {
    try {
      await fetchData(Boolean(force));
      refreshTeacherUtilityStatus(false);
    } catch (error) {
      if (PortalAuth && typeof PortalAuth.isSessionAuthError === 'function' && PortalAuth.isSessionAuthError(error)) {
        if (PortalAuth && typeof PortalAuth.invalidateSession === 'function') {
          PortalAuth.invalidateSession('teacher', error);
          return;
        }
        setSession(''); token = ''; showBound(false);
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
    if (activeTab === 'schedule') requestAnimationFrame(updateWeekViewport);
  }

  function openMore() {
    refreshTeacherUtilityStatus(false);
    const node = document.getElementById('teacherMoreBackdrop');
    node.classList.remove('hidden');
    node.setAttribute('aria-hidden', 'false');
    syncTeacherOverlayScrollLock();
  }

  function closeMore() {
    const node = document.getElementById('teacherMoreBackdrop');
    node.classList.add('hidden');
    node.setAttribute('aria-hidden', 'true');
    syncTeacherOverlayScrollLock();
  }

  function closeQuick() {
    if (quickContext && quickContext.type === 'target-search') availabilityRequestId += 1;
    const node = document.getElementById('teacherQuickBackdrop');
    node.classList.add('hidden');
    node.setAttribute('aria-hidden', 'true');
    syncTeacherOverlayScrollLock();
    quickContext = null;
  }

  function showQuick(title, subtitle, html, context) {
    quickContext = context || null;
    document.getElementById('teacherQuickTitle').textContent = clean(title) || '選擇操作';
    document.getElementById('teacherQuickSubtitle').textContent = clean(subtitle);
    document.getElementById('teacherQuickActions').innerHTML = html;
    const node = document.getElementById('teacherQuickBackdrop');
    node.classList.remove('hidden');
    node.setAttribute('aria-hidden', 'false');
    syncTeacherOverlayScrollLock();
  }

  function setFlowBanner(title, detail) {
    const banner = document.getElementById('teacherFlowBanner');
    banner.classList.remove('hidden');
    document.getElementById('teacherFlowTitle').textContent = clean(title);
    document.getElementById('teacherFlowDetail').textContent = clean(detail);
  }

  function setProgress(active, title, detail) {
    if (active) setFlowBanner(title || '正在確認課表', detail || '最後檢查老師、學生、教室與租用衝突…');
    document.getElementById('teacherOperationProgress').classList.toggle('hidden', !active);
  }

  function cancelPlanner(closeSheet) {
    availabilityRequestId += 1;
    planner = null;
    setProgress(false);
    document.getElementById('teacherFlowBanner').classList.add('hidden');
    if (closeSheet) closeQuick();
    renderWeek();
  }

  function lessonActionDefaults(row, action) {
    return {
      action,
      sourceEventId: row.sourceId || row.id,
      sourceCourseId: row.fixedCourseId || row.sourceId || row.id,
      sourceDate: row.date,
      studentId: (row.studentIds || [])[0] || '',
      subjectId: row.subjectId,
      roomId: row.roomId,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      portalAction: row.portalAction,
      portalChangeId: row.portalChangeId
    };
  }

  function lessonSummary(row) {
    return `${dayLabel(row.date)} ${row.startTime}～${row.endTime}・${(row.studentNames || []).join('、') || '未指定學生'}・${row.subjectName || '未指定科目'}`;
  }

  function choiceSummary(title, details, note) {
    return `<div class="teacher-choice-summary"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(details)}</span>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`;
  }

  function quickActionRow(left, right) {
    if (!left && !right) return '';
    return `<div class="teacher-quick-row">${left || '<span class="teacher-quick-placeholder" aria-hidden="true"></span>'}${right || '<span class="teacher-quick-placeholder" aria-hidden="true"></span>'}</div>`;
  }

  function unavailableQuickAction(label) {
    return `<button type="button" disabled data-quick-unavailable>${escapeHtml(label)}</button>`;
  }

  function openQuickForLesson(row) {
    const eventType = clean(row && row.type).toLowerCase();
    const portalAction = clean(row && row.portalAction).toLowerCase();
    const isRental = ['rental', 'room_rental'].includes(eventType) ||
      ['rental', 'room_booking'].includes(portalAction);
    if (isRental) {
      showQuick(
        '教室租用',
        `${dayLabel(row.date)} ${row.startTime}～${row.endTime}`,
        `${choiceSummary(
          row.roomName || '已租用教室',
          '這是租用紀錄，不會列入學生課程。',
          '若要更換時間或教室，請先到租用入口取消，再重新預約。'
        )}<a href="room-booking.html?from=teacher">前往教室租用入口</a>`,
        { type: 'rental', row }
      );
      return;
    }
    const status = clean(row.status || 'scheduled').toLowerCase();
    const today = todayKey();
    const pastDate = row.date < today;
    const sameDay = row.date === today;
    const started = sameDay && isPastSlot(row.date, row.startTime);
    const futureOrToday = row.date >= today;
    const singleStudent = (row.studentIds || []).length <= 1;
    const movable = !isPastSlot(row.date, row.startTime) && status === 'scheduled';
    const attended = ['attended', 'checked_in', 'present'].includes(status);
    const canNormalAttendance = sameDay && status === 'scheduled';
    const canLateAttendance = pastDate && ['scheduled', 'absent'].includes(status);
    const cancellationPending = clean(row.attendanceCancellationStatus) === 'pending';
    const canLeave = futureOrToday && singleStudent && status === 'scheduled';
    const canAbsent = started && singleStudent && status === 'scheduled';
    const canAddFromLesson = !pastDate;
    const giftLesson = row.specialLesson === true ||
      clean(row.portalAction) === 'teacher_gift' ||
      clean(row.type) === 'teacher_gift';
    const canContactBook = attended || started;
    const waitingForFuture = row.date > today && status === 'scheduled';
    const attendanceAction = attended
      ? '<div class="teacher-quick-status">✓ 已完成簽到</div>'
      : (canNormalAttendance
        ? '<button type="button" data-quick-attendance>老師簽到</button>'
        : (canLateAttendance
          ? `<button type="button" data-quick-late>${giftLesson ? '補簽到（贈送課程不收行政費）' : '補簽到'}</button>`
          : (waitingForFuture
            ? '<button type="button" disabled data-quick-attendance-wait>老師簽到</button>'
            : unavailableQuickAction('老師簽到'))));
    const leaveAction = canLeave
      ? '<button type="button" data-quick-state="leave">學生請假</button>'
      : unavailableQuickAction('學生請假');
    const cancelAttendanceAction = attended && !cancellationPending
      ? `<button type="button" data-quick-cancel-attendance>${sameDay ? '取消簽到' : '申請取消簽到'}</button>`
      : (cancellationPending ? '<div class="teacher-quick-status">等待主管確認</div>' : '');
    const singleMoveAction = movable
      ? '<button type="button" data-quick-action="single_move">只調這一次</button>'
      : unavailableQuickAction('只調這一次');
    const cancelAddedAction = !pastDate && row.portalChangeId && ['extra_lesson', 'teacher_gift'].includes(clean(row.portalAction))
      ? '<button type="button" data-quick-state="cancel_change">取消此次新增</button>'
      : '';
    const permanentMoveAction = cancelAddedAction || (movable && row.recurring === true
      ? '<button type="button" data-quick-action="permanent_move">之後固定改到新時段</button>'
      : unavailableQuickAction('之後固定改到新時段'));
    const extraLessonAction = canAddFromLesson
      ? '<button type="button" data-quick-action="extra_lesson">增加一堂課</button>'
      : unavailableQuickAction('增加一堂課');
    const giftLessonAction = canAddFromLesson
      ? '<button type="button" data-quick-action="teacher_gift">免費贈送一堂</button>'
      : unavailableQuickAction('免費贈送一堂');
    const contactBookAction = canContactBook
      ? '<button type="button" data-quick-contact-book>寫課堂聯絡簿</button>'
      : unavailableQuickAction('寫課堂聯絡簿');
    const absentAction = canAbsent
      ? '<button type="button" data-quick-state="absent">標示曠課</button>'
      : unavailableQuickAction('標示曠課');
    showQuick(
      (row.studentNames || []).join('、') || '這堂課',
      `${dayLabel(row.date)} ${row.startTime}～${row.endTime}`,
      `
      ${quickActionRow(attendanceAction, attended ? cancelAttendanceAction : leaveAction)}
      ${cancellationPending ? '<div class="notice">取消簽到已送出，正在等待主管確認；目前紀錄仍維持已簽到。</div>' : ''}
      ${quickActionRow(singleMoveAction, permanentMoveAction)}
      ${quickActionRow(extraLessonAction, giftLessonAction)}
      ${quickActionRow(contactBookAction, absentAction)}
    `,
      { type: 'lesson', row }
    );
  }

  function openContactBook(row) {
    const students = (row.studentIds || []).map((id, index) => ({ id: clean(id), name: clean((row.studentNames || [])[index]) || '學生' }));
    const audience = students.length > 1
      ? `<div class="field"><label>發送對象</label><select id="contactBookStudent"><option value="">本堂全部學生家長</option>${students.map((student) => `<option value="${escapeHtml(student.id)}">只給 ${escapeHtml(student.name)} 的家長</option>`).join('')}</select></div>`
      : '<p class="muted">此內容只會給這位學生已綁定的家長查看。</p>';
    showQuick('課堂聯絡簿', `${dayLabel(row.date)} ${row.startTime}～${row.endTime}`, `
      <div class="stack contact-book-composer">
        ${audience}
        <div class="field"><label>內容</label><textarea id="contactBookText" rows="5" placeholder="例如：今天練習內容、回家練習提醒…"></textarea></div>
        <div class="field"><label>照片／圖片（可多選）</label><input id="contactBookImages" type="file" accept="image/jpeg,image/png,image/webp" multiple><small class="muted">最多 ${8} 張，每張 3 MB；只會讓對應家長在聯絡簿中查看。</small></div>
        <button class="primary" type="button" data-submit-contact-book>送出給家長</button>
      </div>`, { type: 'contact-book', row });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('照片讀取失敗，請重新選擇。'));
      reader.readAsDataURL(file);
    });
  }

  async function submitContactBook(row, button) {
    const input = document.getElementById('contactBookImages');
    const files = [...((input && input.files) || [])];
    if (files.length > 8) throw new Error('一次最多可附 8 張照片。');
    const images = await Promise.all(files.map(async (file) => {
      if (!/^image\/(jpeg|png|webp)$/i.test(clean(file.type)) || file.size > 3 * 1024 * 1024) {
        throw new Error('請使用 JPEG、PNG 或 WEBP，且每張照片需小於 3 MB。');
      }
      return { name: clean(file.name), dataUrl: await readFileAsDataUrl(file) };
    }));
    const selected = document.getElementById('contactBookStudent');
    loading(button, true, '送出中…');
    try {
      const result = await invoke('coursePortalTeacherSubmitContactBookPost', {
        sessionToken: token, sourceDate: row.date, sourceEventId: row.sourceId || row.id,
        sourceCourseId: row.fixedCourseId || row.courseId, portalChangeId: row.portalChangeId || '',
        studentId: selected ? selected.value : clean((row.studentIds || [])[0]),
        text: clean(document.getElementById('contactBookText').value), images
      });
      toast(result.message || '課堂聯絡簿已送出。');
      closeQuick();
    } finally { loading(button, false); }
  }

  async function openQuickForEmpty(date, startTime) {
    const endTime = timeText(timeMinutes(startTime) + 60);
    const defaultAddDuration = 60;
    const teacherGapMinutes = continuousTeacherGapMinutes(
      uniqueEvents((data.events || []).filter((event) => event.own)),
      date,
      startTime,
      Number(data.hours.end || 21) * 60
    );
    const defaultAddFits = teacherGapMinutes >= defaultAddDuration;
    if (isPastSlot(date, startTime)) {
      toast('不能安排到已經過去的時間。', 'error');
      return;
    }
    const requestId = ++availabilityRequestId;
    showQuick(
      '正在確認這個時段',
      `${dayLabel(date)} ${startTime}～${endTime}`,
      choiceSummary('搜尋可用教室', '正在排除既有課程、租用、老師與學生衝突…', '這裡不會把老師沒有課直接當成教室有空。'),
      { type: 'target-search', date, startTime, endTime, requestId }
    );
    try {
      const result = await invoke('coursePortalTeacherSlotOptions', {
        sessionToken: token,
        date,
        startTime
      });
      if (requestId !== availabilityRequestId) return;
      const context = { type: 'target-home', date, startTime, endTime, result };
      const candidateCount = (result.candidateLessons || []).length;
      const shortGap = teacherGapMinutes >= 30 && !defaultAddFits;
      showQuick(
        '安排這個時段',
        `${dayLabel(date)} ${startTime} 開始`,
        `${choiceSummary(
          shortGap ? `只有 ${teacherGapMinutes} 分鐘空檔` : '即時空位已確認',
          shortGap
            ? `直接新增的課程需要 ${defaultAddDuration} 分鐘，這裡不能加課。`
            : (candidateCount ? `有 ${candidateCount} 堂未來課程符合這個開始時間。` : '目前沒有可直接調入的既有課程。'),
          shortGap ? '若有符合這段長度的既有課程，仍可從下方選擇調課。' : '選擇後，儲存前仍會再檢查一次。'
        )}
        ${candidateCount ? '<button class="primary" type="button" data-target-browse>把現有課調到這裡</button>' : ''}
        ${defaultAddFits ? '<button type="button" data-target-add="extra_lesson">在這裡增加一堂課</button>' : ''}
        ${defaultAddFits ? '<button type="button" data-target-add="teacher_gift">在這裡免費贈送一堂</button>' : ''}
        <a href="room-booking.html?from=teacher&amp;use=other&amp;date=${encodeURIComponent(date)}&amp;start=${encodeURIComponent(startTime)}&amp;duration=${teacherGapMinutes >= 60 ? 60 : 30}">租用這個時段的教室</a>`,
        context
      );
    } catch (error) {
      if (requestId !== availabilityRequestId) return;
      showQuick(
        '目前無法查詢',
        `${dayLabel(date)} ${startTime}～${endTime}`,
        `${choiceSummary('沒有完成空位確認', error.message || '請稍後再試。', '沒有確認成功前不會建立課程。')}<button type="button" data-retry-target>重新查詢</button>`,
        { type: 'target-error', date, startTime, endTime }
      );
    }
  }

  async function updateLessonState(row, state, button, note) {
    const messages = {
      leave: '確定標示學生請假？這個教室時段會釋出。',
      absent: '確定標示曠課？本堂未完成簽到，不會列入老師薪資。',
      cancel_change: '確定取消這次由老師新增、贈送或調整的安排？'
    };
    if (!row || !confirm(messages[state])) return;
    loading(button, true, '處理中…');
    try {
      const result = await invoke('coursePortalTeacherLessonState', {
        sessionToken: token,
        state,
        sourceEventId: row.sourceId || row.id,
        sourceCourseId: row.fixedCourseId || row.sourceId || row.id,
        sourceDate: row.date,
        portalChangeId: row.portalChangeId,
        note: clean(note)
      });
      closeQuick();
      cancelPlanner(false);
      clearCache();
      toast(result.message || '課程狀態已更新。');
      await load(true);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      loading(button, false);
    }
  }

  async function updateLateAttendance(row, button) {
    if (!row) return;
    const giftLesson = row.specialLesson === true ||
      clean(row.portalAction) === 'teacher_gift' ||
      clean(row.type) === 'teacher_gift';
    const confirmation = giftLesson
      ? '確定補簽這堂贈送課程？本次不收行政處理費。'
      : '補簽到會收取行政處理費 NT$50，並直接列入本月薪資扣款。確定要補簽到嗎？';
    if (!confirm(confirmation)) return;
    loading(button, true, '補簽中…');
    try {
      const result = await invoke('coursePortalTeacherLateAttendance', {
        sessionToken: token,
        sourceEventId: row.sourceId || row.id,
        sourceCourseId: row.fixedCourseId || row.sourceId || row.id,
        sourceDate: row.date
      });
      closeQuick();
      clearCache();
      toast(result.message || '補簽到已完成。');
      await load(true);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      loading(button, false);
    }
  }

  async function updateAttendance(row, button) {
    if (!row) return;
    if (!confirm('確定完成這堂課的當日簽到？若當天發現誤簽，可以直接取消；隔天後則需主管核准。')) return;
    loading(button, true, '簽到中…');
    try {
      const result = await invoke('coursePortalTeacherAttendance', {
        sessionToken: token,
        sourceEventId: row.sourceId || row.id,
        sourceCourseId: row.fixedCourseId || row.sourceId || row.id,
        sourceDate: row.date,
        portalChangeId: row.portalChangeId
      });
      closeQuick();
      clearCache();
      toast(result.message || '簽到已完成。');
      await load(true);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      loading(button, false);
    }
  }

  async function requestAttendanceCancellation(row, button) {
    if (!row) return;
    const sameDay = row.date === todayKey();
    if (sameDay) {
      if (!confirm('確定取消這堂課的當日簽到？取消後不計堂數，家長端會恢復為未使用。')) return;
      loading(button, true, '取消中…');
      try {
        const result = await invoke('coursePortalTeacherAttendanceCancellationRequest', {
          sessionToken: token,
          sourceEventId: row.sourceId || row.id,
          sourceCourseId: row.fixedCourseId || row.sourceId || row.id,
          sourceDate: row.date,
          portalChangeId: row.portalChangeId,
          reason: '老師當日誤簽到'
        });
        closeQuick();
        clearCache();
        toast(result.message || '當日簽到已取消。');
        await load(true);
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        loading(button, false);
      }
      return;
    }
    const reason = prompt(
      '請輸入取消簽到原因。送出後必須由主管核准，核准時會扣除行政處理費 NT$50：',
      '老師誤簽到'
    );
    if (reason === null) return;
    if (!clean(reason)) {
      toast('請填寫取消簽到原因。', 'error');
      return;
    }
    if (!confirm('確定送出取消簽到申請？主管核准前，這堂課仍維持已簽到。')) return;
    loading(button, true, '送出中…');
    try {
      const result = await invoke('coursePortalTeacherAttendanceCancellationRequest', {
        sessionToken: token,
        sourceEventId: row.sourceId || row.id,
        sourceCourseId: row.fixedCourseId || row.sourceId || row.id,
        sourceDate: row.date,
        portalChangeId: row.portalChangeId,
        reason
      });
      closeQuick();
      clearCache();
      toast(result.message || '取消簽到申請已送出。');
      await load(true);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      loading(button, false);
    }
  }

  function prefillEmployee() {
    let employee = null;
    try { employee = JSON.parse(localStorage.getItem('employeeUser') || 'null'); } catch (_) {}
    if (!employee) return;
    const identity = clean(employee.identityType).toLowerCase();
    if (identity && identity !== 'external') return;
    document.querySelectorAll('[data-regular-auth-form],[data-line-setup-form]').forEach((form) => {
      if (form.elements.name) form.elements.name.value = form.elements.name.value || employee.name || employee.displayName || '';
      if (form.elements.phone) form.elements.phone.value = form.elements.phone.value || employee.phone || employee.mobile || employee.tel || '';
      if (form.elements.email) form.elements.email.value = form.elements.email.value || employee.email || employee.loginEmail || '';
    });
  }

  async function exchangeAccess() {
    const params = new URLSearchParams(location.search);
    const access = clean(params.get('access'));
    if (!access) return getSession();
    const result = await invoke('coursePortalExchangeAccess', { accessToken: access });
    if (result.role !== 'teacher') throw new Error('這個登入連結不屬於老師入口。');
    setSession(result.sessionToken);
    if (result.reminderReady === false) {
      toast('LINE 登入成功；請將柚子樂器官方帳號加入好友，才能收到提醒。', 'error');
    }
    params.delete('access');
    history.replaceState({}, '', `${location.pathname}${params.toString() ? `?${params}` : ''}`);
    return result.sessionToken;
  }

  function studentNamesByIds(ids) {
    const names = new Map(data.roster.map((row) => [clean(row.id), clean(row.name)]));
    return (ids || []).map((id) => names.get(clean(id))).filter(Boolean);
  }

  function subjectNameById(id) {
    const row = data.subjects.find((subject) => clean(subject.id) === clean(id));
    return clean(row && row.name) || '未指定科目';
  }

  function roomNameById(id, rooms) {
    const row = (rooms || data.rooms).find((room) => clean(room.id) === clean(id));
    return row ? roomOptionLabel(row) : '未指定教室';
  }

  async function startSourceMove(row, action) {
    if (!row || isPastSlot(row.date, row.startTime)) {
      toast('已開始或已結束的課程不能再調課。', 'error');
      return;
    }
    const requestId = ++availabilityRequestId;
    planner = {
      mode: 'move',
      action,
      source: row,
      slots: [],
      durationMinutes: lessonDurationMinutes(row, 60),
      operationId: operationId(),
      requestId
    };
    closeQuick();
    activateTab('schedule');
    setFlowBanner(
      action === 'permanent_move' ? '選擇新的固定時段' : '選擇這一次的新時段',
      `${lessonSummary(row)}；本堂需要連續 ${planner.durationMinutes} 分鐘，正在找完整空位。`
    );
    setProgress(true, '正在搜尋可用位置', '排除老師、每位學生、教室、設備、政策與既有租用…');
    renderWeek();
    try {
      const result = await invoke('coursePortalTeacherAvailability', Object.assign({
        sessionToken: token,
        startDate: weekStart < todayKey() ? todayKey() : weekStart,
        days: 14
      }, lessonActionDefaults(row, action), {
        sourceStartTime: row.startTime,
        sourceEndTime: row.endTime
      }));
      if (!planner || planner.requestId !== requestId || requestId !== availabilityRequestId) return;
      planner.durationMinutes = Number(result.durationMinutes) || planner.durationMinutes;
      planner.slots = (result.slots || []).filter((slot) =>
        !isPastSlot(slot.date, slot.startTime) && Array.isArray(slot.rooms) && slot.rooms.length
      );
      setProgress(false);
      setFlowBanner(
        action === 'permanent_move' ? '選擇新的固定時段' : '選擇這一次的新時段',
        planner.slots.length
          ? `本堂需要連續 ${planner.durationMinutes} 分鐘；只有綠色「可調入・${planner.durationMinutes} 分鐘」能選，時段不足會標紅。`
          : '未來兩週沒有完整可用的位置。'
      );
      renderWeek();
      if (!planner.slots.length) {
        showQuick(
          '目前沒有可用位置',
          lessonSummary(row),
          `${choiceSummary('未來兩週沒有完整空位', '已檢查老師、學生、設備、教室與租用。', '可以取消後改從其他星期重新查看。')}<button type="button" data-cancel-flow>返回課表</button>`,
          { type: 'no-slots' }
        );
      }
    } catch (error) {
      if (!planner || planner.requestId !== requestId || requestId !== availabilityRequestId) return;
      setProgress(false);
      toast(error.message, 'error');
      cancelPlanner(false);
    }
  }

  function beginAddFlow(action, options) {
    const context = Object.assign({
      type: 'add-setup',
      action,
      studentIds: [],
      subjectId: '',
      target: null,
      operationId: operationId()
    }, options || {});
    context.studentIds = [...new Set((context.studentIds || []).map(clean).filter(Boolean))];
    if (!context.studentIds.length) {
      const rows = data.roster.map((student) => `<button type="button" data-add-student="${escapeHtml(student.id)}"><b>${escapeHtml(student.name)}</b><span>選擇這位學生</span></button>`).join('');
      showQuick(
        action === 'teacher_gift' ? '選擇贈課學生' : '選擇學生',
        context.target ? `${dayLabel(context.target.date)} ${context.target.startTime} 開始` : '先選學生，再找可用位置',
        `<div class="teacher-choice-list">${rows || '<div class="teacher-choice-summary"><strong>目前沒有學生</strong></div>'}</div>`,
        context
      );
      return;
    }
    if (!context.subjectId) {
      const rows = allowedSubjects().map((subject) => `<button type="button" data-add-subject="${escapeHtml(subject.id)}"><b>${escapeHtml(subject.name)}</b><span>搜尋適合這項樂器的教室</span></button>`).join('');
      showQuick(
        '選擇上課樂器',
        studentNamesByIds(context.studentIds).join('、'),
        `<div class="teacher-choice-list">${rows || '<div class="teacher-choice-summary"><strong>老師沒有可選的授課科目</strong></div>'}</div>`,
        context
      );
      return;
    }
    searchAddAvailability(context);
  }

  async function searchAddAvailability(context) {
    const requestId = ++availabilityRequestId;
    const target = context.target;
    const durationMinutes = preferredAddDuration(context);
    context.durationMinutes = durationMinutes;
    planner = {
      mode: 'add',
      action: context.action,
      studentIds: context.studentIds,
      subjectId: context.subjectId,
      slots: [],
      durationMinutes,
      operationId: context.operationId,
      requestId
    };
    closeQuick();
    activateTab('schedule');
    setProgress(
      true,
      context.action === 'teacher_gift' ? '正在搜尋贈課位置' : '正在搜尋加課位置',
      '排除老師、學生、教室、設備、政策與既有租用…'
    );
    try {
      const payload = {
        sessionToken: token,
        startDate: target ? target.date : (weekStart < todayKey() ? todayKey() : weekStart),
        days: target ? 7 : 14,
        exactTarget: Boolean(target),
        date: target && target.date,
        startTime: target && target.startTime,
        durationMinutes,
        studentIds: context.studentIds,
        subjectId: context.subjectId
      };
      const result = await invoke('coursePortalTeacherAvailability', payload);
      if (!planner || planner.requestId !== requestId || requestId !== availabilityRequestId) return;
      planner.durationMinutes = Number(result.durationMinutes) || durationMinutes;
      planner.slots = (result.slots || []).filter((slot) =>
        !isPastSlot(slot.date, slot.startTime) && Array.isArray(slot.rooms) && slot.rooms.length
      );
      setProgress(false);
      if (target) {
        const slot = planner.slots.find((row) => row.date === target.date && row.startTime === target.startTime);
        if (!slot) {
          cancelPlanner(false);
          showQuick(
            '這個時段沒有適合教室',
            `${dayLabel(target.date)} ${target.startTime} 開始`,
            `${choiceSummary('無法安排這堂課', '老師、學生、教室、設備或租用其中至少一項有衝突。', '可以返回課表改選其他時間。')}<button type="button" data-cancel-flow>返回課表</button>`,
            { type: 'no-add-target' }
          );
          return;
        }
        showPlannerRoomChoices(slot);
        return;
      }
      setFlowBanner(
        context.action === 'teacher_gift' ? '選擇免費贈課時間' : '選擇增加課程時間',
        planner.slots.length
          ? `${studentNamesByIds(context.studentIds).join('、')}・${subjectNameById(context.subjectId)}需要連續 ${planner.durationMinutes} 分鐘；只有綠色「可調入」能選。`
          : '未來兩週沒有完整可用的位置。'
      );
      renderWeek();
      if (!planner.slots.length) {
        showQuick(
          '目前沒有可用位置',
          `${studentNamesByIds(context.studentIds).join('、')}・${subjectNameById(context.subjectId)}`,
          `${choiceSummary('未來兩週沒有完整空位', '已檢查老師、學生、設備、教室與租用。')}<button type="button" data-cancel-flow>返回課表</button>`,
          { type: 'no-add-slots' }
        );
      }
    } catch (error) {
      if (requestId !== availabilityRequestId) return;
      setProgress(false);
      cancelPlanner(false);
      toast(error.message, 'error');
    }
  }

  function showPlannerRoomChoices(slot) {
    if (!planner) return;
    const rows = (slot.rooms || []).map((room) => `<button type="button" data-planner-room="${escapeHtml(room.id)}"><b>${escapeHtml(roomOptionLabel(room))}</b><span>${escapeHtml(roomChoiceNote(room))}</span></button>`).join('');
    showQuick(
      '選擇教室',
      `${dayLabel(slot.date)} ${slot.startTime}～${slot.endTime}`,
      `${choiceSummary(
        planner.mode === 'move' ? '調到這個位置' : (planner.action === 'teacher_gift' ? '免費贈課' : '增加一堂課'),
        planner.mode === 'move' ? lessonSummary(planner.source) : `${studentNamesByIds(planner.studentIds).join('、')}・${subjectNameById(planner.subjectId)}`,
        '以下教室已通過目前空位與樂器條件檢查。'
      )}<div class="teacher-choice-list">${rows}</div>`,
      { type: 'planner-rooms', slot }
    );
  }

  function renderTargetRoomChoices(context) {
    const result = context.result || {};
    const rows = (result.rooms || []).map((room) => {
      const count = (result.candidateLessons || []).filter((lesson) =>
        (lesson.rooms || []).some((candidateRoom) => clean(candidateRoom.id) === clean(room.id))
      ).length;
      return `<button type="button" data-target-room="${escapeHtml(room.id)}"><b>${escapeHtml(roomOptionLabel(room))}</b><span>${count} 堂課符合這個教室與時段</span></button>`;
    }).join('');
    showQuick(
      '先選教室',
      `${dayLabel(context.date)} ${context.startTime} 開始`,
      `${choiceSummary('把哪一堂課調過來？', '先選這個時間要使用的教室，再選學生課程。')}<div class="teacher-choice-list">${rows || '<div class="teacher-choice-summary"><strong>沒有可用教室</strong></div>'}</div>`,
      Object.assign({}, context, { type: 'target-rooms' })
    );
  }

  function renderTargetCandidates(context, roomId) {
    const candidates = (context.result.candidateLessons || []).filter((lesson) =>
      (lesson.rooms || []).some((room) => clean(room.id) === clean(roomId))
    );
    const rows = candidates.map((lesson, index) => `<button type="button" data-target-candidate="${index}"><b>${escapeHtml((lesson.studentNames || []).join('、') || '未指定學生')}・${escapeHtml(lesson.subjectName || '未指定科目')}</b><span>原課程：${escapeHtml(dayLabel(lesson.date))} ${escapeHtml(lesson.startTime)}～${escapeHtml(lesson.endTime)}</span></button>`).join('');
    showQuick(
      '選擇要調過來的課',
      `${dayLabel(context.date)} ${context.startTime}・${roomNameById(roomId, context.result.rooms)}`,
      `<div class="teacher-choice-list">${rows || '<div class="teacher-choice-summary"><strong>沒有符合的課程</strong></div>'}</div>`,
      Object.assign({}, context, { type: 'target-candidates', roomId, candidates })
    );
  }

  function renderTargetMoveActions(context, candidate) {
    const recurring = candidate.permanentMoveAllowed === true;
    showQuick(
      '選擇調課方式',
      `${dayLabel(context.date)} ${context.startTime}・${roomNameById(context.roomId, context.result.rooms)}`,
      `${choiceSummary(
        (candidate.studentNames || []).join('、') || '這堂課',
        `原課程：${dayLabel(candidate.date)} ${candidate.startTime}～${candidate.endTime}`,
        `新位置將使用 ${roomNameById(context.roomId, context.result.rooms)}。`
      )}
      <button class="primary" type="button" data-target-move-action="single_move">只調這一次</button>
      ${recurring ? '<button type="button" data-target-move-action="permanent_move">之後固定改到這裡</button>' : ''}`,
      Object.assign({}, context, { type: 'target-action', candidate })
    );
  }

  function actionPayloadForRoom(roomId, slot) {
    if (!planner) return null;
    const base = {
      sessionToken: token,
      action: planner.action,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      roomId,
      durationMinutes: planner.durationMinutes,
      operationId: planner.operationId
    };
    return planner.mode === 'move'
      ? Object.assign({}, lessonActionDefaults(planner.source, planner.action), base)
      : Object.assign(base, {
        studentIds: planner.studentIds,
        subjectId: planner.subjectId
      });
  }

  function showActionConfirmation(payload, summary) {
    const moveConfirmation = summary.requiresGuzhengMove
      ? '<label class="teacher-move-confirm"><input type="checkbox" data-guzheng-move-confirm><span><b>我願意自行搬運古箏</b><small>古箏原則上放在展演空間；使用 KAWAI 教室時需自行搬入與歸位。</small></span></label>'
      : '';
    showQuick(
      '最後確認',
      '送出前會再檢查一次所有衝突',
      `${choiceSummary(summary.title, summary.details, summary.note || '若有人剛剛占用同一資源，系統會停止並請您重新選擇。')}${moveConfirmation}<button class="primary" type="button" data-save-action>確認並儲存</button><button type="button" data-cancel-flow>取消</button>`,
      { type: 'confirm-action', payload, requiresGuzhengMove: Boolean(summary.requiresGuzhengMove) }
    );
  }

  async function submitTeacherAction(payload, button) {
    loading(button, true, '正在做最後檢查…');
    setProgress(true, '正在儲存課程', '再次檢查老師、每位學生、教室、設備、政策與租用衝突…');
    try {
      const result = await invoke('coursePortalTeacherAction', payload);
      if (result.requiresConfirmation) {
        setProgress(false);
        payload.operationId = result.operationId || payload.operationId;
        const conflicts = (result.conflicts || []).slice(0, 30);
        const rows = conflicts.map((row) => {
          const alternatives = row.alternativeRooms || [];
          const options = alternatives.map((room) => `<option value="${escapeHtml(room.id)}" data-guzheng-move="${room.requiresGuzhengMove ? 'true' : 'false'}">${escapeHtml(roomOptionLabel(room))}${room.requiresGuzhengMove ? '（需自行搬古箏）' : ''}</option>`).join('');
          return `<div class="teacher-choice-summary"><strong>${escapeHtml(dayLabel(row.date))}</strong><span>${escapeHtml(row.reason || '時段衝突')}</span>${alternatives.length ? `<label><small>這一天可改用：</small><select data-conflict-override="${escapeHtml(row.date)}"><option value="">暫時不指定，之後補排</option>${options}</select></label>` : '<small>老師或學生已有課，換教室也無法解決；這一天會待補排。</small>'}</div>`;
        }).join('');
        const hasMoveAlternative = conflicts.some((row) =>
          (row.alternativeRooms || []).some((room) => room.requiresGuzhengMove)
        );
        const moveConfirmation = hasMoveAlternative
          ? '<label class="teacher-move-confirm"><input type="checkbox" data-permanent-guzheng-move-confirm><span><b>若選 KAWAI，我願意自行搬運古箏</b><small>只有實際選到 KAWAI 的日期才會套用。</small></span></label>'
          : '';
        showQuick(
          '固定課後續日期有衝突',
          result.message || '請確認如何處理',
          `<div class="teacher-choice-list">${rows}</div>${moveConfirmation}<button class="primary" type="button" data-confirm-permanent>套用已選教室，其餘日期待補排</button><button type="button" data-cancel-flow>返回課表</button>`,
          { type: 'permanent-conflicts', payload }
        );
        return;
      }
      clearCache();
      toast(result.message || '課程已儲存。');
      cancelPlanner(true);
      await load(true);
    } catch (error) {
      setProgress(false);
      toast(error.message, 'error');
      if (/剛剛有更新|重新確認|已被使用|已有課程|已被租用/.test(error.message || '')) {
        cancelPlanner(false);
        showQuick(
          '空位剛剛有變動',
          '沒有建立任何重複課程',
          `${choiceSummary('已安全停止這次操作', error.message, '請回到課表重新選擇，系統會讀取最新狀態。')}<button type="button" data-cancel-flow>重新查看課表</button>`,
          { type: 'stale-action' }
        );
      }
    } finally {
      loading(button, false);
    }
  }

  if (global.CoursePortal) global.CoursePortal.installAuth({ role: 'teacher', authViewId: 'bindView' });

  document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  document.getElementById('teacherHomeBtn').addEventListener('click', () => {
    closeDailyReminder();
    closeMore();
    closeQuick();
    activateTab('schedule');
  });
  document.getElementById('prevWeek').addEventListener('click', () => { weekStart = addDays(weekStart, -7); load(true); });
  document.getElementById('nextWeek').addEventListener('click', () => { weekStart = addDays(weekStart, 7); load(true); });
  document.getElementById('rosterSearch').addEventListener('input', (event) => {
    rosterQuery = clean(event.target.value);
    renderRoster();
  });
  const weekViewport = document.querySelector('[data-two-day-viewport]');
  weekViewport.addEventListener('scroll', scheduleWeekGroupSnap, { passive: true });
  weekViewport.addEventListener('scrollend', snapWeekScrollToGroup);
  global.addEventListener('resize', () => requestAnimationFrame(updateWeekViewport));
  document.getElementById('loadPayroll').addEventListener('click', () => {
    const selected = document.getElementById('payrollMonth').value || monthKey();
    if (selected < PAYROLL_MIN_MONTH) {
      document.getElementById('payrollMonth').value = PAYROLL_MIN_MONTH;
      toast('薪資查詢僅開放民國 115 年 7 月起的資料。', 'error');
      return;
    }
    payrollMonth = selected;
    load(true);
  });
  document.getElementById('teacherMoreBtn').addEventListener('click', openMore);
  document.getElementById('teacherDailyReminderConfirm').addEventListener('click', closeDailyReminder);
  document.querySelectorAll('[data-teacher-seen-kind]').forEach((link) => {
    link.addEventListener('click', () => markTeacherRevisionSeen(link.dataset.teacherSeenKind));
  });
  document.getElementById('closeTeacherMore').addEventListener('click', closeMore);
  document.getElementById('teacherMoreBackdrop').addEventListener('click', (event) => { if (event.target.id === 'teacherMoreBackdrop') closeMore(); });
  document.getElementById('closeTeacherQuick').addEventListener('click', closeQuick);
  document.getElementById('teacherQuickBackdrop').addEventListener('click', (event) => {
    if (event.target.id === 'teacherQuickBackdrop') closeQuick();
  });
  document.getElementById('cancelTeacherFlow').addEventListener('click', () => cancelPlanner(true));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDailyReminder();
      closeMore();
      closeQuick();
      closeStudentEdit();
      closeStudentStop();
    }
  });

  document.getElementById('weekGrid').addEventListener('click', (event) => {
    const target = event.target.closest('[data-flow-target]');
    const unavailableTarget = event.target.closest('[data-unavailable-target]');
    const empty = event.target.closest('[data-empty]');
    const lesson = event.target.closest('[data-event]');
    if (unavailableTarget && planner) {
      toast(unavailableTarget.dataset.unavailableMessage || `這個位置無法連續保留 ${plannerDurationMinutes()} 分鐘。`, 'error');
      return;
    }
    if (target && planner) {
      const parts = target.dataset.flowTarget.split('|');
      const slot = (planner.slots || []).find((row) => row.date === parts[0] && row.startTime === parts[1]);
      if (slot) showPlannerRoomChoices(slot);
      return;
    }
    if (empty) {
      const parts = empty.dataset.empty.split('|');
      openQuickForEmpty(parts[0], parts[1]);
      return;
    }
    if (lesson) {
      const row = (data.events || []).find((item) => item.id === lesson.dataset.event);
      if (row) openQuickForLesson(row);
    }
  });

  document.getElementById('teacherQuickActions').addEventListener('click', async (event) => {
    const context = quickContext;
    const actionButton = event.target.closest('[data-quick-action]');
    const stateButton = event.target.closest('[data-quick-state]');
    const attendanceButton = event.target.closest('[data-quick-attendance]');
    const lateButton = event.target.closest('[data-quick-late]');
    const cancelAttendanceButton = event.target.closest('[data-quick-cancel-attendance]');
    const contactBookButton = event.target.closest('[data-quick-contact-book]');
    const submitContactBookButton = event.target.closest('[data-submit-contact-book]');
    const targetBrowse = event.target.closest('[data-target-browse]');
    const targetRoom = event.target.closest('[data-target-room]');
    const targetCandidate = event.target.closest('[data-target-candidate]');
    const targetMoveAction = event.target.closest('[data-target-move-action]');
    const targetAdd = event.target.closest('[data-target-add]');
    const retryTarget = event.target.closest('[data-retry-target]');
    const addStudent = event.target.closest('[data-add-student]');
    const addSubject = event.target.closest('[data-add-subject]');
    const plannerRoom = event.target.closest('[data-planner-room]');
    const saveAction = event.target.closest('[data-save-action]');
    const confirmPermanent = event.target.closest('[data-confirm-permanent]');
    const cancelFlow = event.target.closest('[data-cancel-flow]');
    if (!context) return;
    if (contactBookButton && context.type === 'lesson') {
      openContactBook(context.row);
      return;
    }
    if (submitContactBookButton && context.type === 'contact-book') {
      try { await submitContactBook(context.row, submitContactBookButton); }
      catch (error) { toast(error.message || '課堂聯絡簿送出失敗。', 'error'); }
      return;
    }
    if (actionButton) {
      const action = actionButton.dataset.quickAction;
      if (context.type !== 'lesson') return;
      if (action === 'single_move' || action === 'permanent_move') {
        await startSourceMove(context.row, action);
      } else {
        beginAddFlow(action, {
          studentIds: context.row.studentIds || [],
          subjectId: context.row.subjectId || ''
        });
      }
      return;
    }
    if (stateButton && context.type === 'lesson') {
      await updateLessonState(context.row, stateButton.dataset.quickState, stateButton, '');
      return;
    }
    if (lateButton && context.type === 'lesson') {
      await updateLateAttendance(context.row, lateButton);
      return;
    }
    if (attendanceButton && context.type === 'lesson') {
      await updateAttendance(context.row, attendanceButton);
      return;
    }
    if (cancelAttendanceButton && context.type === 'lesson') {
      await requestAttendanceCancellation(context.row, cancelAttendanceButton);
      return;
    }
    if (targetBrowse && context.result) {
      renderTargetRoomChoices(context);
      return;
    }
    if (targetRoom && context.result) {
      renderTargetCandidates(context, targetRoom.dataset.targetRoom);
      return;
    }
    if (targetCandidate && Array.isArray(context.candidates)) {
      const candidate = context.candidates[Number(targetCandidate.dataset.targetCandidate)];
      if (candidate) renderTargetMoveActions(context, candidate);
      return;
    }
    if (targetMoveAction && context.candidate) {
      const action = targetMoveAction.dataset.targetMoveAction;
      const targetRoomChoice = (context.candidate.rooms || []).find((room) => clean(room.id) === clean(context.roomId));
      const payload = Object.assign({}, lessonActionDefaults(context.candidate, action), {
        sessionToken: token,
        action,
        date: context.date,
        startTime: context.startTime,
        endTime: context.candidate.targetEndTime,
        roomId: context.roomId,
        durationMinutes: context.candidate.durationMinutes,
        operationId: operationId()
      });
      showActionConfirmation(payload, {
        title: action === 'permanent_move' ? '之後固定調課' : '只調這一次',
        details: `${(context.candidate.studentNames || []).join('、')}・${dayLabel(context.date)} ${context.startTime}～${context.candidate.targetEndTime}・${roomNameById(context.roomId, context.result.rooms)}`,
        requiresGuzhengMove: Boolean(targetRoomChoice && targetRoomChoice.requiresGuzhengMove)
      });
      return;
    }
    if (targetAdd) {
      beginAddFlow(targetAdd.dataset.targetAdd, {
        target: {
          date: context.date,
          startTime: context.startTime,
          endTime: context.endTime
        }
      });
      return;
    }
    if (retryTarget) {
      await openQuickForEmpty(context.date, context.startTime);
      return;
    }
    if (addStudent && context.type === 'add-setup') {
      beginAddFlow(context.action, Object.assign({}, context, {
        studentIds: [addStudent.dataset.addStudent]
      }));
      return;
    }
    if (addSubject && context.type === 'add-setup') {
      beginAddFlow(context.action, Object.assign({}, context, {
        subjectId: addSubject.dataset.addSubject
      }));
      return;
    }
    if (plannerRoom && context.slot && planner) {
      const roomId = plannerRoom.dataset.plannerRoom;
      const roomChoice = (context.slot.rooms || []).find((room) => clean(room.id) === clean(roomId));
      const payload = actionPayloadForRoom(roomId, context.slot);
      if (!payload) return;
      showActionConfirmation(payload, {
        title: planner.mode === 'move'
          ? (planner.action === 'permanent_move' ? '之後固定調課' : '只調這一次')
          : (planner.action === 'teacher_gift' ? '免費贈送一堂' : '增加一堂課'),
        details: `${planner.mode === 'move' ? (planner.source.studentNames || []).join('、') : studentNamesByIds(planner.studentIds).join('、')}・${dayLabel(context.slot.date)} ${context.slot.startTime}～${context.slot.endTime}・${roomNameById(roomId, context.slot.rooms)}`,
        requiresGuzhengMove: Boolean(roomChoice && roomChoice.requiresGuzhengMove)
      });
      return;
    }
    if (saveAction && context.payload) {
      if (context.requiresGuzhengMove) {
        const accepted = document.querySelector('[data-guzheng-move-confirm]');
        if (!accepted || !accepted.checked) {
          toast('請先確認願意自行搬運古箏。', 'error');
          return;
        }
        context.payload.allowGuzhengMove = true;
      }
      await submitTeacherAction(context.payload, saveAction);
      return;
    }
    if (confirmPermanent && context.payload) {
      const roomOverrides = {};
      document.querySelectorAll('[data-conflict-override]').forEach((select) => {
        if (select.value) roomOverrides[select.dataset.conflictOverride] = select.value;
      });
      const selectedMoveRoom = [...document.querySelectorAll('[data-conflict-override]')].some((select) => {
        const option = select.options[select.selectedIndex];
        return select.value && option && option.dataset.guzhengMove === 'true';
      });
      if (selectedMoveRoom) {
        const accepted = document.querySelector('[data-permanent-guzheng-move-confirm]');
        if (!accepted || !accepted.checked) {
          toast('有日期選到 KAWAI 教室，請先確認願意自行搬運古箏。', 'error');
          return;
        }
        context.payload.allowGuzhengMove = true;
      }
      await submitTeacherAction(Object.assign({}, context.payload, {
        roomOverrides,
        confirmPermanentConflicts: true
      }), confirmPermanent);
      return;
    }
    if (cancelFlow) {
      cancelPlanner(true);
    }
  });

  document.getElementById('rosterList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-student-action]');
    if (button) beginAddFlow('extra_lesson', { studentIds: [button.dataset.studentAction] });
    const edit = event.target.closest('[data-edit-student]');
    if (edit) openStudentEdit(edit.dataset.editStudent);
    const stop = event.target.closest('[data-stop-student]');
    if (stop) openStudentStop(stop.dataset.stopStudent);
    const bonus=event.target.closest('[data-bonus-student]');
    if(bonus){const form=document.getElementById('bonusRequestForm');form.elements.studentId.value=bonus.dataset.bonusStudent;form.elements.studentName.value=bonus.dataset.bonusName;document.getElementById('bonusStudentName').value=bonus.dataset.bonusName;document.getElementById('bonusRequestModal').classList.remove('hidden');}
  });
  document.getElementById('closeStudentEdit').addEventListener('click', closeStudentEdit);
  document.getElementById('studentEditModal').addEventListener('click', (event) => {
    if (event.target.id === 'studentEditModal') closeStudentEdit();
  });
  document.getElementById('studentEditForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    loading(button, true, '同步中…');
    try {
      const form = event.currentTarget;
      const result = await invoke('coursePortalTeacherUpdateStudent', {
        sessionToken: token,
        studentId: form.elements.studentId.value,
        name: form.elements.name.value,
        phone: form.elements.phone.value
      });
      clearCache();
      closeStudentEdit();
      toast(result.message || '學生資料已同步更新。');
      await load(true);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      loading(button, false);
    }
  });
  document.getElementById('closeStudentStop').addEventListener('click', closeStudentStop);
  document.getElementById('studentStopModal').addEventListener('click', (event) => {
    if (event.target.id === 'studentStopModal') closeStudentStop();
  });
  document.getElementById('confirmStudentStop').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const studentId = clean(button.dataset.studentId);
    if (!studentId) return;
    loading(button, true, '停課處理中…');
    try {
      const result = await invoke('coursePortalTeacherStopStudent', {
        sessionToken: token,
        studentId,
        confirmed: true
      });
      clearCache();
      closeStudentStop();
      toast(result.message || '停課已完成。');
      await load(true);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      loading(button, false);
    }
  });
  document.getElementById('closeBonusRequest').addEventListener('click',()=>document.getElementById('bonusRequestModal').classList.add('hidden'));
  document.getElementById('bonusRequestForm').addEventListener('submit',async(event)=>{event.preventDefault();const button=event.submitter;loading(button,true,'送出中…');try{const form=event.currentTarget;let photoData='';const file=document.getElementById('bonusPhoto').files[0];if(file){photoData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=reject;reader.readAsDataURL(file);});}const result=await invoke('coursePortalTeacherBonusRequest',{sessionToken:token,studentId:form.elements.studentId.value,studentName:form.elements.studentName.value,description:form.elements.description.value,photoData});document.getElementById('bonusRequestModal').classList.add('hidden');form.reset();toast(result.message||'申請已送出。');}catch(error){toast(error.message,'error');}finally{loading(button,false);}});

  logoutBtn.addEventListener('click', () => {
    setSession('');
    location.replace('course-portal.html?method=line&role=teacher');
  });
  document.getElementById('payrollMonth').min = PAYROLL_MIN_MONTH;
  document.getElementById('payrollMonth').value = payrollMonth;

  (async function init() {
    prefillEmployee();
    try {
      token = await exchangeAccess();
      if (token) await load(false);
      else if (PortalAuth && typeof PortalAuth.invalidateSession === 'function') {
        PortalAuth.invalidateSession('teacher', new Error('請先登入老師入口。'));
      } else showBound(false);
    } catch (error) {
      if (PortalAuth && typeof PortalAuth.isSessionAuthError === 'function' && PortalAuth.isSessionAuthError(error)) {
        PortalAuth.invalidateSession('teacher', error);
      } else {
        toast(error.message, 'error');
        showBound(false);
      }
    }
  })();
})(window);
