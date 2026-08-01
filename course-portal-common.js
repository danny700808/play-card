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
    const previous = getSession(role);
    if (previous !== value) clearDataCache();
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
    return /^coursePortal(Teacher|Renter|Room).*Data$/.test(name);
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
    else if (/Action|State|Booking|Binding|Exchange|StartBinding|Registration|PhoneAccess|UpdateStudent|StopStudent|Suspension|Submit|Payment|Reminder|Attendance/.test(name)) clearDataCache();
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
      if (result.reminderReady === false) {
        toast('LINE 登入成功；請將柚子樂器官方帳號加入好友，才能收到課程與租用提醒。', 'error');
      }
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

  function installAuth(options) {
    options = options || {};
    const role = clean(options.role);
    const authView = document.querySelector('[data-auth-view]') ||
      document.getElementById(options.authViewId || 'bindView');
    if (!authView || !['teacher', 'student', 'renter'].includes(role)) return;
    if (authView.dataset.authInstalled === 'true') return;
    authView.dataset.authInstalled = 'true';

    const choiceList = authView.querySelector('[data-auth-choice-list]');
    const regularForm = authView.querySelector('[data-regular-auth-form]');
    const lineSetupPanel = authView.querySelector('[data-line-setup-panel]');
    const lineSetupForm = authView.querySelector('[data-line-setup-form]');
    const otpPanel = authView.querySelector('[data-otp-panel]');
    const authParams = new URLSearchParams(global.location.search);
    const lineSetupToken = clean(authParams.get('lineSetup'));
    const lineError = clean(authParams.get('lineError'));
    let countdownTimer = 0;
    let pendingChallenge = '';
    let pendingOtpFlow = 'regular';

    function removeAuthQuery(name) {
      const params = new URLSearchParams(global.location.search);
      params.delete(name);
      const suffix = params.toString();
      global.history.replaceState({}, '', `${global.location.pathname}${suffix ? `?${suffix}` : ''}`);
    }

    function renderOtp(result, flow) {
      if (!otpPanel) return;
      pendingOtpFlow = flow === 'line-registration' ? 'line-registration' : 'regular';
      pendingChallenge = clean(result.challengeToken);
      let seconds = Number(result.expiresInSeconds || 180);
      if (pendingOtpFlow === 'line-registration' && lineSetupPanel) lineSetupPanel.classList.add('hidden');
      otpPanel.classList.remove('hidden');
      otpPanel.innerHTML = [
        '<form class="stack auth-otp-form">',
        '<div class="auth-otp-heading"><strong>請查看您的 Email</strong><span>輸入四碼後就會直接進入，不會再要求其他步驟。</span></div>',
        `<div class="field"><label>寄到 ${escapeHtml(result.maskedEmail || '您的 Email')} 的四碼驗證碼</label>`,
        '<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4}" maxlength="4" placeholder="0000" required></div>',
        '<div class="auth-otp-meta">有效時間：<strong data-otp-countdown>180 秒</strong></div>',
        '<div class="grid two"><button class="btn primary" type="submit">確認並登入</button>',
        '<button class="btn soft" type="button" data-otp-back>返回修改資料</button></div>',
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
      const backButton = otpPanel.querySelector('[data-otp-back]');
      if (backButton) backButton.addEventListener('click', () => {
        clearInterval(countdownTimer);
        otpPanel.classList.add('hidden');
        if (pendingOtpFlow === 'line-registration') {
          if (lineSetupPanel) lineSetupPanel.classList.remove('hidden');
          const emailInput = lineSetupForm && lineSetupForm.querySelector('input[name="email"]');
          if (emailInput) emailInput.focus();
          return;
        }
        const emailInput = regularForm && regularForm.querySelector('input[name="email"]');
        if (emailInput) emailInput.focus();
      });
      otpPanel.querySelector('input[name="code"]').focus();
      otpPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
          if (verified.pendingApproval) {
            pendingChallenge = '';
            otpPanel.classList.add('hidden');
            if (pendingOtpFlow === 'line-registration') removeAuthQuery('lineSetup');
            toast(verified.message || '申請已送出，請等待主管確認。');
            return;
          }
          if (verified.role !== role || !verified.sessionToken) throw new Error('登入資料不完整，請重新操作。');
          setSession(role, verified.sessionToken);
          if (pendingOtpFlow === 'line-registration') {
            authView.dataset.addStudent = 'false';
            removeAuthQuery('lineSetup');
          }
          toast('驗證成功，正在開啟。');
          global.location.reload();
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          loading(button, false);
        }
      });
    }

    async function requestRegularOtp(form, button) {
      loading(button, true, '確認中…');
      try {
        const fields = Object.fromEntries(new FormData(form).entries());
        const result = await call('coursePortalSendEmailOtp', Object.assign({
          type: role,
          purpose: 'account'
        }, fields));
        if (!result.challengeToken) throw new Error('驗證碼寄送失敗，請稍後再試。');
        renderOtp(result, 'regular');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        loading(button, false);
      }
    }

    const lineButton = authView.querySelector('[data-line-login]');
    if (lineButton) lineButton.addEventListener('click', async () => {
      loading(lineButton, true, '正在前往 LINE…');
      try {
        const result = await call('coursePortalStartLineLogin', {
          type: role,
          linkAnother: role === 'student' && authView.dataset.addStudent === 'true'
        });
        if (!result.authorizationUrl) throw new Error('LINE 登入網址建立失敗，請稍後再試。');
        global.location.assign(result.authorizationUrl);
      } catch (error) {
        toast(error.message, 'error');
        loading(lineButton, false);
      } finally {
        if (document.visibilityState === 'visible') loading(lineButton, false);
      }
    });
    if (regularForm) regularForm.addEventListener('submit', (event) => {
      event.preventDefault();
      requestRegularOtp(event.currentTarget, event.submitter);
    });
    if (lineSetupForm) lineSetupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.submitter;
      loading(button, true, '正在完成…');
      try {
        const fields = Object.fromEntries(new FormData(event.currentTarget).entries());
        const result = await call('coursePortalSendEmailOtp', Object.assign({
          type: role,
          purpose: 'line-registration',
          setupToken: lineSetupToken
        }, fields));
        if (!result.challengeToken) throw new Error('驗證碼寄送失敗，請稍後再試。');
        renderOtp(result, 'line-registration');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        loading(button, false);
      }
    });
    if (lineError) {
      toast(lineError, 'error');
      removeAuthQuery('lineError');
    }
    if (choiceList) choiceList.classList.toggle('hidden', Boolean(lineSetupToken));
    if (lineSetupPanel) lineSetupPanel.classList.toggle('hidden', !lineSetupToken);
    if (lineSetupToken && lineSetupForm) {
      const firstInput = lineSetupForm.querySelector('input');
      if (firstInput) setTimeout(() => firstInput.focus(), 100);
    }
  }

  function installPortalRuntimeStyle() {
    if (document.getElementById('coursePortalRuntimeStyle')) return;
    const style = document.createElement('style');
    style.id = 'coursePortalRuntimeStyle';
    style.textContent = `
      .portal-session-card{max-width:540px;margin:7vh auto 0;display:flex;align-items:center;gap:14px}
      .portal-session-card p{margin:3px 0 0;color:var(--muted)}
      .portal-session-spinner{width:28px;height:28px;flex:0 0 auto;border:3px solid #cce6db;border-right-color:var(--green);border-radius:50%;animation:spin .7s linear infinite}
    `;
    document.head.appendChild(style);
  }

  installPortalRuntimeStyle();

  global.CoursePortal = {
    addDays,
    call,
    clean,
    escapeHtml,
    exchangeAccess,
    getSession,
    loading,
    monday,
    money,
    setSession,
    installAuth,
    toast
  };
})(window);
