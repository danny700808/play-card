(function (global) {
  'use strict';

  const config = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
  if (!global.firebase || !config) throw new Error('Firebase 尚未載入。');
  if (!global.firebase.apps.length) global.firebase.initializeApp(config);
  const functions = global.firebase.app().functions('us-central1');
  const CACHE_PREFIX = 'youzi.coursePortal.dataCache.v2.';
  const CACHE_TTL = 90 * 1000;

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

  function monday(value) {
    const date = value ? new Date(`${value}T12:00:00`) : new Date();
    const day = date.getDay();
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function addDays(value, amount) {
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() + Number(amount || 0));
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function sessionKey(role) {
    return `youzi.coursePortal.${role}.session.v1`;
  }

  function getSession(role) {
    return clean(global.localStorage.getItem(sessionKey(role)));
  }

  function setSession(role, token) {
    if (token) global.localStorage.setItem(sessionKey(role), clean(token));
    else global.localStorage.removeItem(sessionKey(role));
  }

  function cacheKey(name, data) {
    const safe = Object.assign({}, data || {});
    delete safe.sessionToken;
    delete safe.manualSyncPin;
    return CACHE_PREFIX + name + '.' + encodeURIComponent(JSON.stringify(safe));
  }

  function isCacheableCall(name) {
    return /^coursePortal(Teacher|Student|Renter|Room).*Data$/.test(name);
  }

  function clearDataCache() {
    try {
      Object.keys(global.localStorage).forEach((key) => {
        if (key.indexOf(CACHE_PREFIX) === 0) global.localStorage.removeItem(key);
      });
    } catch (_) {}
  }

  function readDataCache(name, data) {
    try {
      const row = JSON.parse(global.localStorage.getItem(cacheKey(name, data)) || 'null');
      if (!row || !row.savedAt || Date.now() - row.savedAt > CACHE_TTL) return null;
      return row.value || null;
    } catch (_) { return null; }
  }

  function writeDataCache(name, data, value) {
    try {
      global.localStorage.setItem(cacheKey(name, data), JSON.stringify({ savedAt: Date.now(), value }));
    } catch (_) {}
  }

  async function invoke(name, data) {
    try {
      const result = await functions.httpsCallable(name)(data || {});
      return result && result.data || {};
    } catch (error) {
      const message = clean(
        error && error.details ||
        error && error.message ||
        '連線失敗，請稍後再試。'
      ).replace(/^FirebaseError:\s*/i, '');
      throw new Error(message);
    }
  }

  async function call(name, data) {
    const cacheable = isCacheableCall(name);
    const cached = cacheable ? readDataCache(name, data) : null;
    if (cached) {
      invoke(name, data).then((fresh) => {
        writeDataCache(name, data, fresh);
        global.dispatchEvent(new CustomEvent('youzi-course-portal-data-refreshed', { detail: { name, data: fresh } }));
      }).catch(() => {});
      return cached;
    }
    const result = await invoke(name, data);
    if (cacheable) writeDataCache(name, data, result);
    else if (/Action|State|Booking|Binding|Exchange|StartBinding/.test(name)) clearDataCache();
    return result;
  }

  function loading(button, active, label) {
    if (!button) return;
    if (active) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.classList.add('is-loading');
      button.textContent = label || '處理中…';
    } else {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.textContent = button.dataset.originalText || button.textContent;
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

  async function copyText(value, button) {
    const text = clean(value);
    if (!text) return;
    try {
      await global.navigator.clipboard.writeText(text);
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    if (button) {
      const original = button.textContent;
      button.textContent = '已複製';
      setTimeout(() => { button.textContent = original; }, 1800);
    }
    toast('綁定文字已複製，請貼到柚子樂器官方 LINE。');
  }

  function finishSessionResolution() {
    document.body.classList.remove('portal-session-resolving');
    const overlay = document.getElementById('portalSessionResolving');
    if (overlay) overlay.remove();
  }

  function beginSessionResolution() {
    const bindView = document.getElementById('bindView');
    const appView = document.getElementById('appView');
    if (!bindView || !appView) return;
    bindView.classList.add('hidden');
    document.body.classList.add('portal-session-resolving');
    let overlay = document.getElementById('portalSessionResolving');
    if (!overlay) {
      overlay = document.createElement('section');
      overlay.id = 'portalSessionResolving';
      overlay.className = 'card portal-session-card';
      overlay.innerHTML = '<span class="portal-session-spinner"></span><div><strong>正在開啟課務資料</strong><p>登入連結驗證完成後會直接進入，不需要再輸入姓名與電話。</p></div>';
      const shell = document.querySelector('.portal-shell');
      if (shell) shell.appendChild(overlay);
    }
    const observer = new MutationObserver(() => {
      if (!appView.classList.contains('hidden') || !bindView.classList.contains('hidden')) {
        observer.disconnect();
        finishSessionResolution();
      }
    });
    observer.observe(bindView, { attributes: true, attributeFilter: ['class'] });
    observer.observe(appView, { attributes: true, attributeFilter: ['class'] });
    setTimeout(() => { observer.disconnect(); finishSessionResolution(); }, 15000);
  }

  async function exchangeAccess(role) {
    const params = new URLSearchParams(global.location.search);
    const access = clean(params.get('access'));
    const savedSession = getSession(role);
    if (access || savedSession) beginSessionResolution();
    if (!access) return savedSession;
    try {
      const result = await call('coursePortalExchangeAccess', { accessToken: access });
      if (result.role !== role) throw new Error('這個登入連結不屬於目前入口。');
      setSession(role, result.sessionToken);
      params.delete('access');
      const suffix = params.toString();
      global.history.replaceState({}, '', `${global.location.pathname}${suffix ? `?${suffix}` : ''}`);
      return result.sessionToken;
    } catch (error) {
      finishSessionResolution();
      throw error;
    }
  }

  async function startBinding(type, form) {
    const fields = Object.fromEntries(new FormData(form).entries());
    const result = await call('coursePortalStartBinding', Object.assign({ type }, fields));
    const box = form.parentElement.querySelector('[data-bind-result]');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = [
        '<strong>請把下面整段文字傳給柚子樂器官方 LINE：</strong>',
        `<code>${escapeHtml(result.bindText)}</code>`,
        '<div class="grid two">',
        '<button class="btn soft" type="button" data-copy-bind>複製綁定文字</button>',
        `<a class="btn primary" href="${escapeHtml(result.lineUrl)}">開啟官方 LINE</a>`,
        '</div>',
        '<small>貼上送出後，請開啟官方 LINE 回覆的登入連結。本連結有效 20 分鐘。</small>'
      ].join('');
      const copyButton = box.querySelector('[data-copy-bind]');
      if (copyButton) copyButton.addEventListener('click', () => copyText(result.bindText, copyButton));
    }
    return result;
  }

  function installPortalRuntimeStyle() {
    if (document.getElementById('coursePortalRuntimeStyle')) return;
    const style = document.createElement('style');
    style.id = 'coursePortalRuntimeStyle';
    style.textContent = `
      .portal-session-card{max-width:540px;margin:7vh auto 0;display:flex;align-items:center;gap:14px}
      .portal-session-card p{margin:3px 0 0;color:var(--muted)}
      .portal-session-spinner{width:28px;height:28px;flex:0 0 auto;border:3px solid #cce6db;border-right-color:var(--green);border-radius:50%;animation:spin .7s linear infinite}
      .teacher-quick-card{margin-bottom:12px;padding:10px}
      .teacher-quick-card h2{margin:0 0 7px;font-size:14px}
      .teacher-quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
      .teacher-quick-grid .btn{min-height:50px;padding:7px 4px;font-size:11px;line-height:1.25}
      .teacher-quick-grid .btn b{display:block;font-size:13px}
      @media(max-width:760px){
        body.teacher-approved-mobile .portal-shell{width:100%;max-width:440px;padding:8px 8px calc(76px + env(safe-area-inset-bottom))}
        body.teacher-approved-mobile .portal-head{margin-bottom:7px}
        body.teacher-approved-mobile .portal-head h1{font-size:17px}
        body.teacher-approved-mobile .portal-head p{font-size:11px;margin-top:1px}
        body.teacher-approved-mobile .brand-mark{width:34px;height:34px;border-radius:10px}
        body.teacher-approved-mobile .card{padding:9px;border-radius:11px;box-shadow:none}
        body.teacher-approved-mobile .summary-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin-bottom:7px}
        body.teacher-approved-mobile .summary{padding:7px 6px;border-radius:11px;min-width:0}
        body.teacher-approved-mobile .summary span{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        body.teacher-approved-mobile .summary strong{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        body.teacher-approved-mobile #appView>.tabs{position:fixed;left:50%;bottom:0;z-index:30;width:min(440px,100%);transform:translateX(-50%);display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:0;padding:7px 8px calc(7px + env(safe-area-inset-bottom));border-top:1px solid var(--line);background:rgba(244,247,243,.96);backdrop-filter:blur(12px)}
        body.teacher-approved-mobile #appView>.tabs .btn{min-height:38px;padding:5px 3px;font-size:11px;white-space:normal;text-align:center}
        body.teacher-approved-mobile .mobile-day-tabs{display:none!important}
        body.teacher-approved-mobile .week-grid,body.teacher-approved-mobile .week-grid.mobile-day{min-width:840px;grid-template-columns:58px repeat(7,1fr)}
        body.teacher-approved-mobile .week-scroll{overflow-x:auto;overscroll-behavior-inline:contain;touch-action:pan-x pan-y pinch-zoom}
        body.teacher-approved-mobile .section-title h2{font-size:14px}
        body.teacher-approved-mobile .section-title p,body.teacher-approved-mobile .muted{font-size:11px}
      }
    `;
    document.head.appendChild(style);
  }

  function installTeacherApprovedLayout() {
    if (!/teacher-course-portal\.html$/i.test(global.location.pathname)) return;
    document.body.classList.add('teacher-approved-mobile');
    const nativeMatchMedia = global.matchMedia && global.matchMedia.bind(global);
    if (nativeMatchMedia && !global.__YOUZI_TEACHER_WEEK_MEDIA_FIXED__) {
      global.__YOUZI_TEACHER_WEEK_MEDIA_FIXED__ = true;
      global.matchMedia = function (query) {
        if (String(query).replace(/\s/g, '') === '(max-width:760px)') {
          return { matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
        }
        return nativeMatchMedia(query);
      };
    }
    const appView = document.getElementById('appView');
    if (!appView || document.getElementById('teacherQuickHome')) return;
    const tabs = appView.querySelector('.tabs');
    const quick = document.createElement('section');
    quick.id = 'teacherQuickHome';
    quick.className = 'card teacher-quick-card';
    quick.innerHTML = '<h2>常用功能</h2><div class="teacher-quick-grid">' +
      '<button class="btn primary" type="button" data-teacher-quick="schedule"><b>1</b>本週課表</button>' +
      '<button class="btn primary" type="button" data-teacher-quick="students"><b>2</b>我的學生</button>' +
      '<button class="btn primary" type="button" data-teacher-quick="payroll"><b>3</b>薪資查詢</button>' +
      '<button class="btn" type="button" data-teacher-quick="extra"><b>4</b>增加課程</button>' +
      '<button class="btn" type="button" data-teacher-quick="move"><b>5</b>老師調課</button>' +
      '<a class="btn" href="room-booking.html?from=teacher"><b>6</b>租用教室</a>' +
      '</div>';
    appView.insertBefore(quick, tabs || appView.firstChild);
    quick.addEventListener('click', (event) => {
      const button = event.target.closest('[data-teacher-quick]');
      if (!button) return;
      const target = ['students','payroll'].includes(button.dataset.teacherQuick) ? button.dataset.teacherQuick : 'schedule';
      const tab = appView.querySelector(`[data-tab="${target}"]`);
      if (tab) tab.click();
      const panel = appView.querySelector(`[data-panel="${target}"]`);
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (button.dataset.teacherQuick === 'extra') toast('請在課表點空堂，即可選學生增加一堂。');
      if (button.dataset.teacherQuick === 'move') toast('請點原課程，即可選擇單次調課或永久調課。');
    });
  }

  installPortalRuntimeStyle();
  installTeacherApprovedLayout();

  global.CoursePortal = {
    addDays,
    call,
    clean,
    copyText,
    escapeHtml,
    exchangeAccess,
    getSession,
    loading,
    monday,
    money,
    setSession,
    startBinding,
    toast
  };
})(window);
