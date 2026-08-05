(function (global) {
  'use strict';

  const P = global.CoursePortal;
  if (!P) throw new Error('課務管理元件尚未載入。');

  const manager = typeof global.requireLogin === 'function' ? global.requireLogin() : null;
  if (!manager) return;
  const managerAllowed = typeof global.hasSettingsZoneAccess === 'function'
    ? global.hasSettingsZoneAccess(manager)
    : Boolean(manager.showSettingsZone || String(manager.role || '').toLowerCase() === 'admin');
  if (!managerAllowed) {
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

  function waitForAuth() {
    return new Promise((resolve) => {
      if (!global.firebase || typeof global.firebase.auth !== 'function') {
        resolve();
        return;
      }
      const auth = global.firebase.auth();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const unsubscribe = auth.onAuthStateChanged(() => {
        try { unsubscribe(); } catch (_) {}
        finish();
      }, finish);
      global.setTimeout(finish, 6000);
    });
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
      ['有效來源', summary.activeSources || 0, '目前可登入或接收提醒'],
      ['需整理', summary.staleSources || 0, `${summary.attentionAccounts || 0} 個帳號`, 'attention'],
      ['多身分帳號', summary.multiIdentityAccounts || 0, '同一 LINE 綁定多人或多系統']
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
      <div class="line-source-row ${source.stale ? 'stale' : ''}">
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
          ${source.staleReason ? `<small>${escapeHtml(source.staleReason)}</small>` : ''}
        </div>
      </div>`;
  }

  function groupHtml(row, index) {
    const chips = [
      `<span class="line-chip good">${Number(row.activeSourceCount || 0)} 個有效來源</span>`,
      `<span class="line-chip">${Number(row.sourceCount || 0)} 筆資料</span>`
    ];
    if (row.multiIdentity) chips.push(`<span class="line-chip warn">${Number((row.identities || []).length)} 個身分</span>`);
    if (row.mixedSystems) chips.push(`<span class="line-chip warn">跨 ${(row.systems || []).length} 套系統</span>`);
    if (row.staleSourceCount) chips.push(`<span class="line-chip bad">${Number(row.staleSourceCount)} 筆需整理</span>`);

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
            <button class="line-revoke-btn" type="button" data-line-action="revoke_all" data-index="${index}">完全解除 LINE</button>
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
      await waitForAuth();
      const result = await P.call('coursePortalAdminUnifiedLineData', {});
      if (!result || result.ok !== true) throw new Error(result && result.message || 'LINE 綁定資料讀取失敗。');
      state.rows = Array.isArray(result.rows) ? result.rows : [];
      state.summary = result.summary || {};
      render();
    } catch (error) {
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
      const result = await P.call('coursePortalAdminUnifiedLineAction', {
        action,
        lineUserId: row.lineUserId,
        confirmText
      });
      if (!result || result.ok !== true) throw new Error(result && result.message || '操作未完成。');
      P.toast(result.message || '處理完成。');
      await loadData({ silent: true });
    } catch (error) {
      P.toast(error.message || String(error), 'error');
      setStatus(error.message || String(error), true);
    } finally {
      hideMask();
      P.loading(button, false);
    }
  }

  async function cleanupAll(button) {
    if (!global.confirm('整理全部 LINE 帳號中的散落、重複或失效資料？\n\n有效綁定會保留；沒有有效身分的殘留資料會被解除。')) return;
    P.loading(button, true, '整理中…');
    showMask('正在整理全部 LINE 殘留', '資料量較多時可能需要一些時間，請不要關閉頁面。');
    try {
      const result = await P.call('coursePortalAdminUnifiedLineAction', { action: 'cleanup_all' });
      if (!result || result.ok !== true) throw new Error(result && result.message || '整理未完成。');
      P.toast(result.message || '整理完成。');
      await loadData({ silent: true });
    } catch (error) {
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
})(window);
