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
    return clean(global.sessionStorage.getItem(sessionKey(role))) ||
      clean(global.localStorage.getItem(sessionKey(role)));
  }

  function setSession(role, token, options) {
    const key = sessionKey(role);
    const value = clean(token);
    if (!value) {
      global.localStorage.removeItem(key);
      global.sessionStorage.removeItem(key);
      return;
    }
    if (options && options.temporary === true) {
      global.localStorage.removeItem(key);
      global.sessionStorage.setItem(key, value);
      return;
    }
    global.sessionStorage.removeItem(key);
    global.localStorage.setItem(key, value);
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
    toast('LINE 文字已複製，請貼到柚子樂器官方 LINE。');
  }

  function finishSessionResolution() {
    document.body.classList.remove('portal-session-resolving');
    const loadingView = document.getElementById('sessionLoading');
    if (loadingView) loadingView.classList.add('hidden');
    const overlay = document.getElementById('portalSessionResolving');
    if (overlay) overlay.remove();
  }

  function beginSessionResolution() {
    const bindView = document.querySelector('[data-auth-view]') ||
      document.getElementById('bindView') ||
      document.getElementById('publicBindView');
    const appView = document.querySelector('[data-app-view]') ||
      document.getElementById('appView') ||
      document.getElementById('bookingView');
    if (!bindView || !appView) return;
    bindView.classList.add('hidden');
    appView.classList.add('hidden');
    document.body.classList.add('portal-session-resolving');
    const loadingView = document.getElementById('sessionLoading');
    if (loadingView) loadingView.classList.remove('hidden');
    let overlay = document.getElementById('portalSessionResolving');
    if (!loadingView && !overlay) {
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
      setSession(role, '');
      params.delete('access');
      const suffix = params.toString();
      global.history.replaceState({}, '', `${global.location.pathname}${suffix ? `?${suffix}` : ''}`);
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

  function renderLineAction(box, result, heading) {
    if (!box) return;
    const text = clean(result.loginText || result.bindText);
    box.classList.remove('hidden');
    box.innerHTML = [
      `<strong>${escapeHtml(heading || '請到官方 LINE 完成確認：')}</strong>`,
      `<code>${escapeHtml(text)}</code>`,
      '<div class="grid two">',
      '<button class="btn soft" type="button" data-copy-auth-text>複製文字</button>',
      `<a class="btn primary" href="${escapeHtml(result.lineUrl)}">開啟官方 LINE</a>`,
      '</div>',
      '<small>把整段文字送出後，請開啟官方 LINE 回覆的登入連結。</small>'
    ].join('');
    const copyButton = box.querySelector('[data-copy-auth-text]');
    if (copyButton) copyButton.addEventListener('click', () => copyText(text, copyButton));
  }

  function installAuth(options) {
    options = options || {};
    const role = clean(options.role);
    const authView = document.querySelector('[data-auth-view]') ||
      document.getElementById(options.authViewId || 'bindView');
    if (!authView || !['teacher', 'student', 'renter'].includes(role)) return;
    if (authView.dataset.authInstalled === 'true') return;
    authView.dataset.authInstalled = 'true';

    const loginForm = authView.querySelector('[data-email-login-form]');
    const firstUsePanel = authView.querySelector('[data-first-use-panel]');
    const firstUseForm = authView.querySelector('[data-first-use-form]');
    const renterContactForm = authView.querySelector('[data-renter-contact-form]');
    const otpPanel = authView.querySelector('[data-otp-panel]');
    const lineResult = authView.querySelector('[data-line-login-result]');
    const bindResult = authView.querySelector('[data-bind-result]');
    let countdownTimer = 0;
    let pendingChallenge = '';
    let pendingPurpose = '';

    function showFirstUse(active) {
      if (firstUsePanel) firstUsePanel.classList.toggle('hidden', !active);
      const button = authView.querySelector('[data-show-first-use]');
      if (button) button.setAttribute('aria-expanded', active ? 'true' : 'false');
    }

    function renderOtp(result, purpose) {
      if (!otpPanel) return;
      pendingChallenge = clean(result.challengeToken);
      pendingPurpose = purpose;
      let seconds = Number(result.expiresInSeconds || 180);
      otpPanel.classList.remove('hidden');
      otpPanel.innerHTML = [
        '<form class="stack auth-otp-form">',
        `<div class="field"><label>輸入寄到 ${escapeHtml(result.maskedEmail || '您的 Email')} 的四碼驗證碼</label>`,
        '<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4}" maxlength="4" placeholder="0000" required></div>',
        '<div class="auth-otp-meta">有效時間：<strong data-otp-countdown>180 秒</strong></div>',
        '<button class="btn primary" type="submit">確認驗證碼</button>',
        '</form>'
      ].join('');
      const countdown = otpPanel.querySelector('[data-otp-countdown]');
      clearInterval(countdownTimer);
      const tick = () => {
        if (countdown) countdown.textContent = seconds > 0 ? `${seconds} 秒` : '已失效，請重新寄送';
        const submit = otpPanel.querySelector('button[type="submit"]');
        if (submit) submit.disabled = seconds <= 0;
        seconds -= 1;
        if (seconds < 0) clearInterval(countdownTimer);
      };
      tick();
      countdownTimer = setInterval(tick, 1000);
      otpPanel.querySelector('input[name="code"]').focus();
      otpPanel.querySelector('form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = event.submitter;
        loading(button, true, '驗證中…');
        try {
          const verified = await call('coursePortalVerifyEmailOtp', {
            challengeToken: pendingChallenge,
            code: event.currentTarget.elements.code.value
          });
          clearInterval(countdownTimer);
          if (pendingPurpose === 'login') {
            if (verified.role !== role || !verified.sessionToken) throw new Error('登入資料不完整，請重新操作。');
            setSession(role, verified.sessionToken);
            toast('驗證成功，正在開啟。');
            global.location.reload();
            return;
          }
          otpPanel.classList.add('hidden');
          renderLineAction(bindResult, verified, 'Email 已驗證，最後到官方 LINE 完成一次綁定：');
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          loading(button, false);
        }
      });
    }

    async function requestOtp(form, purpose, button) {
      loading(button, true, '寄送中…');
      try {
        const fields = Object.fromEntries(new FormData(form).entries());
        const result = await call('coursePortalSendEmailOtp', Object.assign({ type: role, purpose }, fields));
        renderOtp(result, purpose);
        toast(result.message || '四碼驗證碼已寄出。');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        loading(button, false);
      }
    }

    const lineButton = authView.querySelector('[data-line-login]');
    if (lineButton) lineButton.addEventListener('click', async () => {
      loading(lineButton, true, '產生中…');
      try {
        const result = await call('coursePortalStartLineLogin', { type: role });
        renderLineAction(lineResult, result, '請用已綁定的 LINE 傳送這段快速登入文字：');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        loading(lineButton, false);
      }
    });
    if (loginForm) loginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      requestOtp(event.currentTarget, 'login', event.submitter);
    });
    if (firstUseForm) firstUseForm.addEventListener('submit', (event) => {
      event.preventDefault();
      requestOtp(event.currentTarget, 'bind', event.submitter);
    });
    if (renterContactForm && role === 'renter') {
      renterContactForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = event.submitter;
        loading(button, true, '登入中…');
        try {
          const fields = Object.fromEntries(new FormData(event.currentTarget).entries());
          const result = await call('coursePortalRenterContactLogin', fields);
          if (!result.sessionToken) throw new Error('登入資料不完整，請重新操作。');
          setSession('renter', result.sessionToken, { temporary: true });
          toast('登入成功，正在開啟租用頁。');
          global.location.reload();
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          loading(button, false);
        }
      });
    }
    const firstUseButton = authView.querySelector('[data-show-first-use]');
    if (firstUseButton) firstUseButton.addEventListener('click', () => {
      showFirstUse(firstUsePanel ? firstUsePanel.classList.contains('hidden') : false);
    });
    showFirstUse(false);
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
    installAuth,
    startBinding,
    toast
  };
})(window);
