(function (global) {
  'use strict';

  if (global.YZManagerAuth) return;

  const MANAGER_ROLES = new Set(['admin', 'manager', 'owner', '主管', '管理者']);
  const BOOTSTRAP_MANAGER_EMAILS = new Set(['danny700808@gmail.com']);

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function lower(value) {
    return clean(value).toLowerCase();
  }

  function readLocalUser() {
    try { return JSON.parse(global.localStorage.getItem('employeeUser') || 'null'); } catch (_) { return null; }
  }

  function managerClaims(claims) {
    const token = claims || {};
    const role = lower(token.role || token.userRole || token.permissionRole);
    return token.admin === true || token.manager === true || token.owner === true || MANAGER_ROLES.has(role) ||
      BOOTSTRAP_MANAGER_EMAILS.has(lower(token.email));
  }

  function safeNext(value) {
    const fallback = `${clean(global.location && global.location.pathname).split('/').pop() || 'portal.html'}${clean(global.location && global.location.search)}`;
    const raw = clean(value || fallback).replace(/^\/+/, '');
    return /^[a-z0-9._-]+\.html(?:\?[^#]*)?(?:#.*)?$/i.test(raw) ? raw : 'portal.html';
  }

  function loginUrl(next) {
    return `login.html?next=${encodeURIComponent(safeNext(next))}`;
  }

  function clearManagerShell() {
    ['employeeUser', 'employeeUserId', 'employeeSecureAuthVersion', 'employeePortalMode'].forEach((key) => {
      try { global.localStorage.removeItem(key); } catch (_) {}
    });
  }

  function initializeFirebase() {
    if (!global.firebase || typeof global.firebase.auth !== 'function') {
      throw new Error('安全登入元件尚未載入，請重新整理後再試。');
    }
    const config = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if (!global.firebase.apps.length) {
      if (!config) throw new Error('Firebase 登入設定不完整。');
      global.firebase.initializeApp(config);
    }
    return global.firebase.auth();
  }

  function waitForAuth(auth, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe = null;
      let timer = null;
      const finish = (user, error) => {
        if (settled) return;
        settled = true;
        if (timer) global.clearTimeout(timer);
        try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (_) {}
        if (error) reject(error);
        else resolve(user || null);
      };
      try {
        unsubscribe = auth.onAuthStateChanged(
          (user) => finish(user, null),
          (error) => finish(null, error)
        );
        if (settled) {
          try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (_) {}
          unsubscribe = null;
        } else {
          timer = global.setTimeout(() => finish(auth.currentUser, null), Math.max(1000, Number(timeoutMs || 8000)));
        }
      } catch (error) {
        finish(null, error);
      }
    });
  }

  function claimUser(firebaseUser, claims, local) {
    const token = claims || {};
    const employeeId = clean(token.employeeId || local && (local.employeeId || local.id) || firebaseUser.uid);
    const email = lower(token.email || firebaseUser.email || local && local.email);
    return Object.assign({}, local && local.portalSessionBridge !== true ? local : {}, {
      id: employeeId,
      employeeId,
      name: clean(token.name || firebaseUser.displayName || local && local.name || email || '管理者'),
      email,
      role: 'admin',
      identityType: 'admin',
      identityLabel: '管理者',
      isManagerAccount: true,
      showSettingsZone: true,
      portalSessionBridge: false
    });
  }

  async function requireManager(options) {
    const settings = options || {};
    let auth;
    try {
      auth = initializeFirebase();
      const firebaseUser = await waitForAuth(auth, settings.timeoutMs);
      if (!firebaseUser) throw new Error('管理者安全登入已失效。');
      const result = await firebaseUser.getIdTokenResult(true);
      const claims = result && result.claims || {};
      if (!managerClaims(claims)) throw new Error('目前登入的帳號沒有管理者權限。');

      const local = readLocalUser();
      const localEmail = lower(local && local.email);
      const authEmail = lower(claims.email || firebaseUser.email);
      const localId = clean(local && (local.employeeId || local.id));
      const claimId = clean(claims.employeeId);
      const localIsManager = local && local.portalSessionBridge !== true && (
        local.showSettingsZone === true || local.isManagerAccount === true || MANAGER_ROLES.has(lower(local.role))
      );
      const sameIdentity = (!localEmail || !authEmail || localEmail === authEmail) && (!localId || !claimId || localId === claimId);
      const manager = claimUser(firebaseUser, claims, localIsManager && sameIdentity ? local : null);
      global.localStorage.setItem('employeeUser', JSON.stringify(manager));
      global.localStorage.setItem('employeeUserId', manager.employeeId);
      global.localStorage.setItem('employeeSecureAuthVersion', '1');
      return manager;
    } catch (error) {
      clearManagerShell();
      if (settings.redirect !== false && global.location && typeof global.location.replace === 'function') {
        global.location.replace(loginUrl(settings.next));
      }
      throw error;
    }
  }

  global.YZManagerAuth = Object.freeze({ requireManager, managerClaims, safeNext, loginUrl });
})(window);
