(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.YouziOperationsManagerAuth = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);
  const REDIRECT_KEY = 'youzi.operations.managerAuthRedirect.v1';
  const REDIRECT_WINDOW_MS = 10 * 60 * 1000;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function lower(value) {
    return clean(value).toLowerCase();
  }

  function truthy(value) {
    return value === true || ['1', 'true', 'yes', '是', 'enabled', 'active'].includes(lower(value));
  }

  function localManagerAllowed(user) {
    const role = lower(user && user.role);
    return Boolean(user && (
      truthy(user.showSettingsZone) ||
      truthy(user.isManagerAccount) ||
      ['admin', 'manager', 'owner', '主管', '管理者'].includes(role)
    ));
  }

  function claimsAllowManager(claims, user) {
    const token = claims || {};
    const role = lower(token.role || token.userRole || token.permissionRole);
    const email = lower(token.email || user && user.email);
    return token.admin === true || token.manager === true || token.owner === true ||
      ['admin', 'manager', 'owner', '主管', '管理者'].includes(role) ||
      ADMIN_EMAILS.has(email);
  }

  function sameManagerIdentity(manager, firebaseUser, claims) {
    const localEmail = lower(manager && manager.email);
    const authEmail = lower(claims && claims.email || firebaseUser && firebaseUser.email);
    if (localEmail && authEmail && localEmail !== authEmail) return false;

    const localId = clean(manager && (manager.employeeId || manager.id));
    const authId = clean(claims && claims.employeeId);
    return !(localId && authId && localId !== authId);
  }

  function waitForAuth(auth, timeoutMs, timers) {
    const clock = timers || globalThis;
    const waitMs = Math.max(1000, Number(timeoutMs || 8000));
    return new Promise((resolve, reject) => {
      if (!auth || typeof auth.onAuthStateChanged !== 'function') {
        resolve(null);
        return;
      }
      let settled = false;
      let unsubscribe = null;
      let timer = null;
      const finish = (user, error) => {
        if (settled) return;
        settled = true;
        if (timer) clock.clearTimeout(timer);
        try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (_) {}
        if (error) reject(error);
        else resolve(user || null);
      };
      try {
        unsubscribe = auth.onAuthStateChanged(
          (user) => finish(user || null),
          (error) => finish(null, error)
        );
      } catch (error) {
        finish(null, error);
        return;
      }
      if (settled) {
        try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (_) {}
      } else {
        timer = clock.setTimeout(() => finish(auth.currentUser || null), waitMs);
      }
    });
  }

  function tokenFailureNeedsLogin(error) {
    const code = lower(error && error.code);
    return [
      'auth/id-token-expired',
      'auth/invalid-user-token',
      'auth/user-disabled',
      'auth/user-not-found',
      'auth/user-token-expired',
      'auth/requires-recent-login'
    ].some((value) => code.includes(value));
  }

  async function ensureManagerAuth(runtime, manager, options) {
    const global = runtime || {};
    if (!localManagerAllowed(manager)) {
      return { ok: false, reauth: true, reason: 'local-manager-missing', message: '請先使用管理者帳號登入。' };
    }
    if (!global.firebase || typeof global.firebase.auth !== 'function') {
      return { ok: false, reauth: false, reason: 'firebase-unavailable', message: '安全登入元件尚未載入，請重新整理後再試。' };
    }

    let auth;
    try {
      auth = global.firebase.auth();
    } catch (error) {
      return { ok: false, reauth: false, reason: 'firebase-unavailable', message: error.message || '無法啟用安全登入。' };
    }

    let user;
    try {
      user = await waitForAuth(auth, options && options.timeoutMs, global);
    } catch (error) {
      return { ok: false, reauth: false, reason: 'auth-restore-failed', message: error.message || '無法恢復登入狀態。' };
    }
    if (!user) {
      return { ok: false, reauth: true, auth, reason: 'firebase-session-missing', message: '管理者安全登入已失效，需要重新登入。' };
    }
    if (typeof user.getIdTokenResult !== 'function') {
      return { ok: false, reauth: false, auth, reason: 'token-api-missing', message: '無法確認管理者權限，請重新整理後再試。' };
    }

    let tokenResult;
    try {
      tokenResult = await user.getIdTokenResult(true);
    } catch (error) {
      const reauth = tokenFailureNeedsLogin(error);
      return {
        ok: false,
        reauth,
        auth,
        reason: reauth ? 'firebase-session-expired' : 'token-refresh-failed',
        message: reauth
          ? '管理者安全登入已過期，需要重新登入。'
          : (error.message || '目前無法確認管理者權限，請檢查網路後再試。')
      };
    }

    const claims = tokenResult && tokenResult.claims || {};
    if (!claimsAllowManager(claims, user) || !sameManagerIdentity(manager, user, claims)) {
      return { ok: false, reauth: true, auth, reason: 'manager-claim-mismatch', message: '目前的安全登入與管理者身分不一致，請重新登入。' };
    }
    return { ok: true, auth, user, claims };
  }

  function returnTarget(runtime) {
    const pathname = clean(runtime && runtime.location && runtime.location.pathname);
    const page = lower(pathname.split('/').pop());
    return `${page === 'operations-hub.html' ? 'operations-hub.html' : 'portal.html'}#products`;
  }

  function loginUrl(runtime) {
    return `login.html?next=${encodeURIComponent(returnTarget(runtime))}`;
  }

  function clearLocalShellAuth(runtime) {
    const storage = runtime && runtime.localStorage;
    if (!storage) return;
    ['employeeUser', 'employeeUserId', 'employeeSecureAuthVersion', 'employeePortalMode'].forEach((key) => {
      try { storage.removeItem(key); } catch (_) {}
    });
  }

  function redirectMarker(runtime) {
    for (const storage of [runtime && runtime.sessionStorage, runtime && runtime.localStorage]) {
      if (!storage) continue;
      try {
        const value = Number(storage.getItem(REDIRECT_KEY) || 0);
        if (value > 0) return value;
      } catch (_) {}
    }
    return 0;
  }

  function clearRedirectMarker(runtime) {
    for (const storage of [runtime && runtime.sessionStorage, runtime && runtime.localStorage]) {
      try { if (storage) storage.removeItem(REDIRECT_KEY); } catch (_) {}
    }
  }

  function hasRecentRedirect(runtime, now) {
    const startedAt = redirectMarker(runtime);
    const current = Number(now || Date.now());
    const recent = startedAt > 0 && current - startedAt >= 0 && current - startedAt < REDIRECT_WINDOW_MS;
    if (!recent) clearRedirectMarker(runtime);
    return recent;
  }

  async function redirectToLoginOnce(runtime, auth, now) {
    const global = runtime || {};
    if (hasRecentRedirect(global, now)) return false;
    const value = String(Number(now || Date.now()));
    let markerSaved = false;
    try {
      if (global.sessionStorage) {
        global.sessionStorage.setItem(REDIRECT_KEY, value);
        markerSaved = true;
      }
    } catch (_) {}
    if (!markerSaved) {
      try { if (global.localStorage) global.localStorage.setItem(REDIRECT_KEY, value); } catch (_) {}
    }
    clearLocalShellAuth(global);
    try {
      if (auth && auth.currentUser && typeof auth.signOut === 'function') await auth.signOut();
    } catch (_) {}
    if (global.location && typeof global.location.replace === 'function') global.location.replace(loginUrl(global));
    return true;
  }

  return {
    REDIRECT_KEY,
    localManagerAllowed,
    claimsAllowManager,
    sameManagerIdentity,
    waitForAuth,
    ensureManagerAuth,
    returnTarget,
    loginUrl,
    clearLocalShellAuth,
    clearRedirectMarker,
    redirectToLoginOnce
  };
});
