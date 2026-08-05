(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.YouziLineBindingAdminAuth = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);
  const RETURN_TARGET = 'line-binding-admin.html';
  const LOGIN_URL = `login.html?next=${encodeURIComponent(RETURN_TARGET)}`;
  const REDIRECT_KEY = 'youzi.lineBindingAdmin.authRedirect.v1';
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
      return { ok: false, reauth: true, auth, reason: 'firebase-session-missing', message: '管理者登入已失效，需要重新登入。' };
    }
    if (typeof user.getIdTokenResult !== 'function') {
      return { ok: false, reauth: false, auth, reason: 'token-api-missing', message: '無法確認管理者權限，請重新整理後再試。' };
    }

    let tokenResult;
    try {
      // true 會向 Firebase 強制更新 ID token，並取得最新的管理者 claims。
      tokenResult = await user.getIdTokenResult(true);
    } catch (error) {
      return {
        ok: false,
        reauth: tokenFailureNeedsLogin(error),
        auth,
        reason: tokenFailureNeedsLogin(error) ? 'firebase-session-expired' : 'token-refresh-failed',
        message: tokenFailureNeedsLogin(error)
          ? '管理者登入已過期，需要重新登入。'
          : (error.message || '目前無法確認管理者權限，請檢查網路後再試。')
      };
    }

    const claims = tokenResult && tokenResult.claims || {};
    if (!claimsAllowManager(claims, user) || !sameManagerIdentity(manager, user, claims)) {
      return { ok: false, reauth: true, auth, reason: 'manager-claim-mismatch', message: '目前的安全登入與管理者身分不一致，請重新登入。' };
    }
    return { ok: true, auth, user, claims };
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

  function hasRecentRedirect(runtime, now) {
    const startedAt = redirectMarker(runtime);
    const current = Number(now || Date.now());
    const recent = startedAt > 0 && current - startedAt >= 0 && current - startedAt < REDIRECT_WINDOW_MS;
    if (!recent) clearRedirectMarker(runtime);
    return recent;
  }

  function clearRedirectMarker(runtime) {
    for (const storage of [runtime && runtime.sessionStorage, runtime && runtime.localStorage]) {
      try { if (storage) storage.removeItem(REDIRECT_KEY); } catch (_) {}
    }
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
    if (global.location && typeof global.location.replace === 'function') global.location.replace(LOGIN_URL);
    return true;
  }

  return {
    LOGIN_URL,
    RETURN_TARGET,
    REDIRECT_KEY,
    localManagerAllowed,
    claimsAllowManager,
    sameManagerIdentity,
    waitForAuth,
    ensureManagerAuth,
    clearLocalShellAuth,
    hasRecentRedirect,
    clearRedirectMarker,
    redirectToLoginOnce
  };
});

(function (global) {
  'use strict';

  if (!global || !global.document) return;

  const P = global.CoursePortal;
  if (!P) throw new Error('課務管理元件尚未載入。');

  const AdminAuth = global.YouziLineBindingAdminAuth;
  if (!AdminAuth) throw new Error('管理者安全驗證元件尚未載入。');

  const manager = typeof global.getUser === 'function' ? global.getUser() : (() => {
    try { return JSON.parse(global.localStorage.getItem('employeeUser') || 'null'); } catch (_) { return null; }
  })();
  if (manager && !AdminAuth.localManagerAllowed(manager)) {
    global.location.replace('dashboard.html');
    return;
  }

  const state = {
    rows: [],
    summary: {},
    filter: 'all',
    search: '',
    loading: false
  };

  const listNode = document.getElementById('lineBindingList');
  const statusNode = document.getElementById('lineAdminStatus');
  const summaryNode = document.getElementById('lineSummary');
  const searchNode = document.getElementById('lineBindingSearch');
  const maskNode = document.getElementById('lineAdminMask');
  const progressTitle = document.getElementById('lineAdminProgressTitle');
  const progressText = document.getElementById('lineAdminProgressText');

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function escapeHtml(value) {
    return P.escapeHtml(value);
  }

  function showMask(title, text) {
    progressTitle.textContent = title || '正在處理';
    progressText.textContent = text || '請稍候，不要重複按下按鈕。';
    maskNode.classList.remove('hidden');
  }

  function hideMask() {
    maskNode.classList.add('hidden');
  }

  function setStatus(text, bad) {
    statusNode.textContent = text || '';
    statusNode.classList.toggle('bad', Boolean(bad));
  }

  function authError(message, code) {
    const error = new Error(message || '無法確認管理者登入狀態。');
    error.code = code || 'line-admin/auth-unavailable';
    return error;
  }

  async function requireManagerFirebaseSession() {
    const result = await AdminAuth.ensureManagerAuth(global, manager, { timeoutMs: 8000 });
    if (result.ok) return result;
    if (result.reauth) {
      const redirected = await AdminAuth.redirectToLoginOnce(global, result.auth);
      throw authError(
        redirected ? '登入狀態已失效，正在返回管理者登入頁。' : result.message,
        redirected ? 'line-admin/auth-redirecting' : 'line-admin/auth-required'
      );
    }
    throw authError(result.message, 'line-admin/auth-unavailable');
  }

  function backendAuthError(error) {
    const value = `${clean(error && error.code)} ${clean(error && error.message)}`.toLowerCase();
    return value.includes('permission-denied') || value.includes('unauthenticated') || value.includes('請先使用管理者帳號登入');
  }

  function showLoginRequired(message) {
    const text = clean(message) || '管理者登入已失效，請重新登入。';
    listNode.innerHTML = `
      <div class="line-empty">
        <p>${escapeHtml(text)}</p>
        <a class="btn soft" href="${AdminAuth.LOGIN_URL}">重新登入管理者帳號</a>
      </div>`;
    setStatus(text, false);
  }

  async function handleAuthError(error) {
    if (backendAuthError(error)) {
      let auth = null;
      try { auth = global.firebase && typeof global.firebase.auth === 'function' ? global.firebase.auth() : null; } catch (_) {}
      const redirected = await AdminAuth.redirectToLoginOnce(global, auth);
      if (!redirected) showLoginRequired('登入已重新驗證，但尚未取得管理者權限。請確認使用的是管理者帳號。');
      return true;
    }
    const code = clean(error && error.code);
    if (code === 'line-admin/auth-redirecting') {
      setStatus(error.message, false);
      return true;
    }
    if (code === 'line-admin/auth-required' || code === 'line-admin/auth-unavailable') {
      showLoginRequired(error.message);
      return true;
    }
    return false;
  }

  function kindsMatch(row, filter) {
    const kinds = Array.isArray(row.kinds) ? row.kinds : [];
    if (filter === 'employee') return kinds.some((kind) => ['employee', 'manager', 'external'].includes(kind));
    if (filter === 'course') return kinds.some((kind) => ['teacher', 'student', 'renter'].includes(kind));
    if (filter === 'rental') return kinds.includes('equipment-rental');
    if (filter === 'attention') return row.needsAttention;
    if (filter === 'multi') return row.multiIdentity;
    return true;
  }

  function searchableText(row) {
    const sources = Array.isArray(row.sources) ? row.sources : [];
    return [
      row.lineDisplayName,
      row.lineUserIdMasked,
      ...(row.systems || []),
      ...(row.kinds || []),
      ...sources.flatMap((source) => [
        source.label,
        source.system,
        source.identityName,
        source.identityId,
        source.status,
        source.staleReason,
        source.collection
      ])
    ].join(' ').toLowerCase();
  }

  function visibleRows() {
    const term = state.search.toLowerCase();
    return state.rows.filter((row) => {
      if (!kindsMatch(row, state.filter)) return false;
      return !term || searchableText(row).includes(term);
    });
  }

  function renderSummary() {
    const summary = state.summary || {};
    const cards = [
      ['LINE 帳號', summary.lineAccounts || 0, `共 ${summary.sourceRecords || 0} 筆來源`],
      ['有效身分', summary.activeSources || 0, '鏡像與歷史資料不重複計算'],
      ['需處理帳號', summary.attentionAccounts || 0, `${summary.staleSources || 0} 筆可整理・${summary.manualReviewSources || 0} 筆人工確認`, 'attention'],
      ['同角色衝突', summary.multiIdentityAccounts || 0, '同一角色連到不同有效身分']
    ];
    summaryNode.innerHTML = cards.map((card) => `
      <div class="line-summary-card ${card[3] || ''}">
        <span>${escapeHtml(card[0])}</span>
        <b>${Number(card[1]).toLocaleString('zh-TW')}</b>
        <small>${escapeHtml(card[2])}</small>
      </div>`).join('');
  }

  function sourceHtml(source) {
    const name = clean(source.identityName) || '未設定姓名';
    const id = clean(source.identityId) || '未設定編號';
    return `
      <div class="line-source-row ${source.stale ? 'stale' : ''} ${source.manualReview ? 'manual-review' : ''}">
        <div class="line-source-main">
          <strong>${escapeHtml(source.label || source.system || 'LINE 綁定')}</strong>
          <small>${escapeHtml(source.system || '')}</small>
        </div>
        <div class="line-source-cell">
          <b>${escapeHtml(name)}</b>
          <small>${escapeHtml(id)}</small>
        </div>
        <div class="line-source-cell">
          <b>${escapeHtml(source.collection || '')}</b>
          <small>${escapeHtml(source.sourceId || '')}</small>
        </div>
        <div class="line-source-cell">
          <span class="line-source-state">${escapeHtml(source.status || (source.active ? '使用中' : '未啟用'))}</span>
          ${source.conflictReason || source.staleReason ? `<small>${escapeHtml(source.conflictReason || source.staleReason)}</small>` : ''}
        </div>
      </div>`;
  }

  function groupHtml(row, index) {
    const chips = [
      `<span class="line-chip good">${Number(row.activeSourceCount || 0)} 個有效身分</span>`,
      `<span class="line-chip">${Number(row.sourceCount || 0)} 筆資料</span>`
    ];
    if (row.multiIdentity) chips.push('<span class="line-chip warn">同角色身分衝突</span>');
    if (row.mixedSystems) chips.push(`<span class="line-chip">跨 ${(row.systems || []).length} 套資料來源</span>`);
    if (row.staleSourceCount) chips.push(`<span class="line-chip bad">${Number(row.staleSourceCount)} 筆需整理</span>`);
    if (row.manualReviewSourceCount) chips.push(`<span class="line-chip warn">${Number(row.manualReviewSourceCount)} 筆人工確認</span>`);
    if (row.lineIdConflict) chips.push('<span class="line-chip bad">LINE 欄位衝突・禁止完全解除</span>');

    return `
      <article class="line-binding-group ${row.needsAttention ? 'needs-attention' : ''}">
        <header class="line-binding-group-head">
          <div class="line-binding-title">
            <strong>${escapeHtml(row.lineDisplayName || '未取得 LINE 名稱')}</strong>
            <small>${escapeHtml(row.lineUserIdMasked || '')}</small>
            <div class="line-binding-badges">${chips.join('')}</div>
          </div>
          <div class="line-group-actions">
            <button class="line-cleanup-btn" type="button" data-line-action="cleanup_line" data-index="${index}" ${row.staleSourceCount ? '' : 'disabled'}>整理殘留</button>
            <button class="line-revoke-btn" type="button" data-line-action="revoke_all" data-index="${index}" ${row.lineIdConflict ? 'disabled title="同一筆資料含不同 LINE 帳號，請先人工確認"' : ''}>完全解除 LINE</button>
          </div>
        </header>
        <div class="line-source-list">${(row.sources || []).map(sourceHtml).join('')}</div>
      </article>`;
  }

  function render() {
    renderSummary();
    const rows = visibleRows();
    listNode.innerHTML = rows.length
      ? rows.map((row) => groupHtml(row, state.rows.indexOf(row))).join('')
      : '<div class="line-empty">目前沒有符合條件的 LINE 綁定。</div>';
    setStatus(`顯示 ${rows.length} 個 LINE 帳號；資料由課務、員工、外聘老師與租賃系統即時彙整。`, false);
  }

  async function loadData(options) {
    if (state.loading) return;
    state.loading = true;
    const showProgress = !(options && options.silent);
    if (showProgress) showMask('正在掃描 LINE 綁定', '正在讀取課務、員工、外聘老師與租賃資料。');
    setStatus('正在掃描所有 LINE 綁定來源…', false);
    try {
      await requireManagerFirebaseSession();
      const result = await P.call('coursePortalAdminUnifiedLineData', {});
      if (!result || result.ok !== true) throw new Error(result && result.message || 'LINE 綁定資料讀取失敗。');
      AdminAuth.clearRedirectMarker(global);
      state.rows = Array.isArray(result.rows) ? result.rows : [];
      state.summary = result.summary || {};
      render();
    } catch (error) {
      if (await handleAuthError(error)) return;
      listNode.innerHTML = '<div class="line-empty">無法讀取 LINE 綁定資料，請確認管理者登入狀態後再試。</div>';
      setStatus(error.message || String(error), true);
      P.toast(error.message || String(error), 'error');
    } finally {
      state.loading = false;
      if (showProgress) hideMask();
    }
  }

  async function performAction(action, row, button) {
    let confirmText = '';
    if (action === 'cleanup_line') {
      if (!global.confirm(`整理「${row.lineDisplayName}」的散落、重複或失效資料？\n\n有效綁定會保留。`)) return;
    } else if (action === 'revoke_all') {
      const typed = global.prompt(
        `確定要完全解除「${row.lineDisplayName}」的 LINE 嗎？\n\n` +
        `這會斷開 ${(row.sourceCount || 0)} 筆課務、員工、外聘或租賃來源，並取消尚未送出的通知。\n` +
        `課程、薪資、打卡、租賃與帳務歷史不會刪除。\n\n` +
        `請輸入「解除」確認：`
      );
      if (typed !== '解除') {
        P.toast('未輸入「解除」，操作已取消。');
        return;
      }
      confirmText = typed;
    }

    P.loading(button, true, action === 'revoke_all' ? '解除中…' : '整理中…');
    showMask(action === 'revoke_all' ? '正在完全解除 LINE' : '正在整理 LINE 資料', '系統正在同步處理所有來源與尚未送出的通知。');
    try {
      await requireManagerFirebaseSession();
      const result = await P.call('coursePortalAdminUnifiedLineAction', {
        action,
        lineUserId: row.lineUserId,
        confirmText
      });
      if (!result || result.ok !== true) throw new Error(result && result.message || '操作未完成。');
      P.toast(result.message || '處理完成。');
      await loadData({ silent: true });
    } catch (error) {
      if (await handleAuthError(error)) return;
      P.toast(error.message || String(error), 'error');
      setStatus(error.message || String(error), true);
    } finally {
      hideMask();
      P.loading(button, false);
    }
  }

  async function cleanupAll(button) {
    if (!global.confirm('整理全部 LINE 帳號中的散落、重複或失效資料？\n\n有效綁定與業務歷史會保留；欄位衝突只會標示供人工確認。')) return;
    P.loading(button, true, '整理中…');
    showMask('正在整理全部 LINE 殘留', '資料量較多時可能需要一些時間，請不要關閉頁面。');
    try {
      await requireManagerFirebaseSession();
      const result = await P.call('coursePortalAdminUnifiedLineAction', { action: 'cleanup_all' });
      if (!result || (result.ok !== true && result.partial !== true)) throw new Error(result && result.message || '整理未完成。');
      P.toast(result.message || '整理完成。', result.partial ? 'error' : '');
      await loadData({ silent: true });
      if (result.partial) setStatus(result.message || '部分帳號尚未完成整理，可重新執行以繼續。', true);
    } catch (error) {
      if (await handleAuthError(error)) return;
      P.toast(error.message || String(error), 'error');
      setStatus(error.message || String(error), true);
    } finally {
      hideMask();
      P.loading(button, false);
    }
  }

  let searchTimer = 0;
  searchNode.addEventListener('input', () => {
    global.clearTimeout(searchTimer);
    searchTimer = global.setTimeout(() => {
      state.search = clean(searchNode.value);
      render();
    }, 180);
  });

  document.getElementById('lineFilterTabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter || 'all';
    document.querySelectorAll('#lineFilterTabs button').forEach((node) => node.classList.toggle('active', node === button));
    render();
  });

  listNode.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-line-action]');
    if (!button || button.disabled) return;
    const index = Number(button.dataset.index);
    const row = state.rows[index];
    if (!row) return;
    performAction(button.dataset.lineAction, row, button);
  });

  document.getElementById('reloadLineBindings').addEventListener('click', () => loadData());
  document.getElementById('cleanupAllLineBindings').addEventListener('click', (event) => cleanupAll(event.currentTarget));

  loadData();
})(typeof window !== 'undefined' ? window : globalThis);
