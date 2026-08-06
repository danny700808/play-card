(function (global) {
  'use strict';

  const TEACHER_PORTAL_SESSION_KEY = 'youzi.coursePortal.teacher.session.v1';
  const LEGACY_USER_KEY = 'employeeUser';
  const LEGACY_USER_ID_KEY = 'employeeUserId';
  const AUTH_CACHE_KEY = 'youzi.teacherMore.authorization.v3';
  const AUTH_CACHE_TTL_MS = 30 * 60 * 1000;
  const FUNCTIONS_COMPAT_URL = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions-compat.js';
  const ALLOWED_RETURN_PAGES = new Set([
    'profile.html',
    'contract.html',
    'announcements.html',
    'task.html',
    'teacher-goods.html',
    'forms-hub.html'
  ]);
  let bootstrapPromise = null;

  function readStorage(key) {
    try {
      return String(global.localStorage.getItem(key) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function readEmployeeUser() {
    try {
      return JSON.parse(readStorage(LEGACY_USER_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  function tokenFingerprint(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function hasLegacyEmployeeUser() {
    const user = readEmployeeUser();
    return Boolean(user && (user.id || user.employeeId || user.email));
  }

  function hasTeacherPortalSession() {
    return Boolean(readStorage(TEACHER_PORTAL_SESSION_KEY));
  }

  function hasFreshPortalAuthorization() {
    const user = readEmployeeUser();
    const token = readStorage(TEACHER_PORTAL_SESSION_KEY);
    if (!user || user.portalSessionBridge !== true || !token) return false;
    try {
      const cache = JSON.parse(readStorage(AUTH_CACHE_KEY) || 'null');
      return Boolean(
        cache &&
        cache.tokenFingerprint === tokenFingerprint(token) &&
        cache.employeeId === String(user.employeeId || user.id || '') &&
        Number(cache.validatedAt || 0) + AUTH_CACHE_TTL_MS > Date.now()
      );
    } catch (_) {
      return false;
    }
  }

  function currentPage() {
    const page = String(global.location && global.location.pathname || '')
      .split('/')
      .pop()
      .toLowerCase();
    return ALLOWED_RETURN_PAGES.has(page) ? page : '';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    });
  }

  function boundaryHtml(title, state, detail) {
    const busy = state === 'loading';
    const heading = busy ? `正在確認${title}` : `${title}暫時無法開啟`;
    const note = busy
      ? '正在用目前的老師 LINE／Email 登入確認員工編號，完成後會自動開啟。'
      : detail;
    return [
      '<section class="teacher-more-auth-boundary" role="status" aria-live="polite">',
      '<div class="teacher-more-auth-boundary-mark" aria-hidden="true">師</div>',
      `<h1>${escapeHtml(heading)}</h1>`,
      `<p>${escapeHtml(note)}</p>`,
      busy ? '<p class="teacher-more-auth-boundary-note">不需要重新輸入舊系統帳號。</p>' : '',
      busy ? '' : '<div class="teacher-more-auth-boundary-actions"><a href="teacher-course-portal.html">返回老師課務</a><button class="secondary" type="button" data-teacher-auth-retry>重新確認</button></div>',
      '</section>'
    ].join('');
  }

  function loadFunctionsCompat() {
    if (global.firebase && global.firebase.functions) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const existing = document.querySelector('script[data-teacher-functions-compat]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = FUNCTIONS_COMPAT_URL;
      script.async = true;
      script.setAttribute('data-teacher-functions-compat', '');
      script.onload = resolve;
      script.onerror = function () { reject(new Error('登入驗證元件載入失敗，請確認網路後重試。')); };
      document.head.appendChild(script);
    });
  }

  async function invokeUtilitySession() {
    const token = readStorage(TEACHER_PORTAL_SESSION_KEY);
    if (!token) throw new Error('老師登入已失效，請返回老師課務重新登入。');
    await loadFunctionsCompat();
    const config = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if (!global.firebase || !config) throw new Error('Firebase 尚未載入，請重新整理後再試。');
    if (!global.firebase.apps.length) global.firebase.initializeApp(config);
    try {
      const response = await global.firebase.app().functions('us-central1')
        .httpsCallable('coursePortalTeacherUtilitySession')({ sessionToken: token });
      return response && response.data || {};
    } catch (error) {
      throw new Error(String(error && (error.details || error.message) || '老師資料確認失敗。').replace(/^FirebaseError:\s*/i, ''));
    }
  }

  function saveAuthorizedUser(result) {
    const token = readStorage(TEACHER_PORTAL_SESSION_KEY);
    const user = Object.assign({}, result && result.user || {}, {
      portalSessionBridge: true,
      portalSessionValidatedAt: Date.now()
    });
    const employeeId = String(user.employeeId || user.id || '').trim();
    if (!employeeId) throw new Error('老師資料缺少員工編號，請聯絡管理者。');
    global.localStorage.setItem(LEGACY_USER_KEY, JSON.stringify(user));
    global.localStorage.setItem(LEGACY_USER_ID_KEY, employeeId);
    global.localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
      employeeId,
      tokenFingerprint: tokenFingerprint(token),
      validatedAt: Date.now(),
      profileComplete: result.profileComplete === true,
      missingProfileFields: Array.isArray(result.missingProfileFields) ? result.missingProfileFields : []
    }));
  }

  function clearPortalBridge() {
    const user = readEmployeeUser();
    try {
      global.localStorage.removeItem(AUTH_CACHE_KEY);
      global.localStorage.removeItem(TEACHER_PORTAL_SESSION_KEY);
      if (user && user.portalSessionBridge === true) {
        global.localStorage.removeItem(LEGACY_USER_KEY);
        global.localStorage.removeItem(LEGACY_USER_ID_KEY);
      }
    } catch (_) {}
  }

  function startBootstrap(root, title) {
    if (!bootstrapPromise) {
      bootstrapPromise = invokeUtilitySession()
        .then(function (result) {
          if (!result || result.ok === false || !result.user) throw new Error('老師資料確認結果不完整。');
          saveAuthorizedUser(result);
          global.location.reload();
        })
        .catch(function (error) {
          bootstrapPromise = null;
          root.innerHTML = boundaryHtml(title, 'error', error.message || '老師資料確認失敗。');
          const retry = root.querySelector('[data-teacher-auth-retry]');
          if (retry) retry.addEventListener('click', function () {
            root.innerHTML = boundaryHtml(title, 'loading', '');
            startBootstrap(root, title);
          });
        });
    }
    return bootstrapPromise;
  }

  function blockIfPortalOnly(options) {
    options = options || {};
    const token = readStorage(TEACHER_PORTAL_SESSION_KEY);
    if (!token) {
      const user = readEmployeeUser();
      if (user && user.portalSessionBridge === true) clearPortalBridge();
      return false;
    }
    if (hasFreshPortalAuthorization()) return false;

    const root = document.querySelector('[data-teacher-utility-root]');
    if (!root) return true;
    const title = String(options.title || '這項老師功能').trim();
    document.body.classList.add('teacher-portal-session-only');
    root.innerHTML = boundaryHtml(title, 'loading', '');
    startBootstrap(root, title);
    return true;
  }

  global.YZTeacherMoreAuth = Object.freeze({
    blockIfPortalOnly,
    clearPortalBridge,
    hasLegacyEmployeeUser,
    hasTeacherPortalSession,
    hasFreshPortalAuthorization,
    currentPage
  });
})(window);
