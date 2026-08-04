(function (global) {
  'use strict';

  if (global.__YZ_RENTAL_ADMIN_ENHANCEMENTS_V1__) return;
  global.__YZ_RENTAL_ADMIN_ENHANCEMENTS_V1__ = true;

  const R = global.YZRental;
  const ACTIVE_STATUSES = new Set(['租賃中', '租用中', '已成立', 'active', '待配送 / 待安裝', '到期提醒中']);
  const TAB_LABELS = {
    all: '全部案件',
    new: '待確認申請',
    sign: '待客人補資料',
    payment: '待付款確認',
    active: '租用中',
    renewal: '續約待處理',
    return: '退租待處理',
    returned: '已退租',
    cancelled: '已取消／封存'
  };

  let countTimer = 0;
  let activationBusy = false;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function installStyles() {
    if (document.getElementById('rentalAdminEnhancementStyles')) return;
    const style = document.createElement('style');
    style.id = 'rentalAdminEnhancementStyles';
    style.textContent = '' +
      '.tab .rental-tab-count{display:inline-grid;place-items:center;min-width:20px;height:20px;margin-left:5px;padding:0 6px;border-radius:999px;background:rgba(24,49,74,.10);color:#18314a;font-size:11px;font-weight:950;line-height:1}' +
      '.tab.active .rental-tab-count{background:rgba(255,255,255,.24);color:#fff}' +
      '.tab.todo:not(.active) .rental-tab-count{background:rgba(180,35,24,.12);color:#b42318}' +
      '.rental-progress-actions .btn{min-width:110px}';
    document.head.appendChild(style);
  }

  function rentalRows() {
    try {
      if (typeof applications === 'undefined' || typeof contracts === 'undefined') return [];
      return [
        ...applications.map(function (row) { return Object.assign({ kind: 'application' }, row); }),
        ...contracts.map(function (row) { return Object.assign({ kind: 'contract' }, row); })
      ];
    } catch (error) {
      console.warn('rental tab rows unavailable:', error);
      return [];
    }
  }

  function countForFilter(filterName, rows) {
    try {
      if (typeof passFilter !== 'function' || typeof filter === 'undefined') return 0;
      const previous = filter;
      filter = filterName;
      const count = rows.filter(function (row) { return passFilter(row); }).length;
      filter = previous;
      return count;
    } catch (error) {
      console.warn('rental tab count failed:', filterName, error);
      return 0;
    }
  }

  function updateTabCounts() {
    countTimer = 0;
    const rows = rentalRows();
    document.querySelectorAll('.tabs .tab[data-filter]').forEach(function (button) {
      const key = clean(button.dataset.filter);
      if (!Object.prototype.hasOwnProperty.call(TAB_LABELS, key)) return;
      const count = countForFilter(key, rows);
      button.setAttribute('aria-label', TAB_LABELS[key] + '，' + count + ' 筆');
      button.replaceChildren(document.createTextNode(TAB_LABELS[key] + ' '));
      const badge = document.createElement('span');
      badge.className = 'rental-tab-count';
      badge.textContent = String(count);
      button.appendChild(badge);
    });
  }

  function scheduleTabCounts(delay) {
    clearTimeout(countTimer);
    countTimer = global.setTimeout(updateTabCounts, Number(delay) || 60);
  }

  function ensureProgressMask() {
    let mask = document.getElementById('rentalProgressMask');
    if (!mask) {
      mask = document.createElement('div');
      mask.id = 'rentalProgressMask';
      mask.className = 'rental-progress-mask';
      mask.innerHTML = '<div class="rental-progress-box">' +
        '<div class="rental-progress-title" id="rentalProgressTitle">確認租用成立</div>' +
        '<div class="rental-progress-text" id="rentalProgressText">正在檢查紙本、收款與租期資料...</div>' +
        '<div class="rental-progress-bar"><div class="rental-progress-fill" id="rentalProgressFill" style="width:6%"></div></div>' +
        '<div class="rental-progress-actions" id="rentalProgressActions" style="display:none">' +
          '<button class="btn secondary" type="button" data-rental-progress-close>關閉</button>' +
        '</div>' +
      '</div>';
      document.body.appendChild(mask);
    }
    const title = document.getElementById('rentalProgressTitle');
    const text = document.getElementById('rentalProgressText');
    const fill = document.getElementById('rentalProgressFill');
    const actions = document.getElementById('rentalProgressActions');
    if (title) title.textContent = '確認租用成立';
    if (text) text.textContent = '正在檢查紙本、收款與租期資料...';
    if (fill) fill.style.width = '6%';
    if (actions) actions.style.display = 'none';
    return mask;
  }

  function finishProgress(text, success) {
    const title = document.getElementById('rentalProgressTitle');
    const message = document.getElementById('rentalProgressText');
    const fill = document.getElementById('rentalProgressFill');
    const actions = document.getElementById('rentalProgressActions');
    if (title) title.textContent = success ? '租用成立完成' : '租用尚未成立';
    if (message) message.textContent = text || (success ? '完成。' : '請依畫面提示確認資料。');
    if (fill) fill.style.width = success ? '100%' : '0%';
    if (actions) actions.style.display = 'flex';
  }

  async function contractIsActive() {
    try {
      if (!R || typeof R.get !== 'function') return false;
      const id = clean(R.val && R.val('contractId'));
      if (!id) return false;
      const row = await R.get('rentalContracts', id);
      return !!(row && ACTIVE_STATUSES.has(clean(row.status)));
    } catch (_) {
      return false;
    }
  }

  async function activatePaperRental(button) {
    if (activationBusy) return;
    activationBusy = true;
    const originalText = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = '正在檢查並準備成立...';
    ensureProgressMask();

    try {
      if (typeof global.markDelivered !== 'function') {
        throw new Error('確認租用成立功能尚未載入，請完全重新整理頁面後再試。');
      }

      await Promise.resolve(global.markDelivered());

      const active = await contractIsActive();
      const actions = document.getElementById('rentalProgressActions');
      const progressStillPending = !actions || actions.style.display === 'none';
      if (active) {
        if (progressStillPending) finishProgress('已確認收款，案件已移至「租用中」。', true);
        scheduleTabCounts(80);
      } else if (progressStillPending) {
        finishProgress('這次操作沒有完成。若剛才取消確認，請關閉後重按；若有缺少資料，請依系統提示補齊後再成立。', false);
      }
    } catch (error) {
      finishProgress(error && error.message ? error.message : String(error), false);
      if (R && typeof R.toast === 'function') R.toast(error && error.message ? error.message : String(error), false);
    } finally {
      activationBusy = false;
      if (document.contains(button)) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = originalText;
      }
    }
  }

  document.addEventListener('click', function (event) {
    const close = event.target && event.target.closest ? event.target.closest('[data-rental-progress-close]') : null;
    if (close) {
      event.preventDefault();
      const mask = document.getElementById('rentalProgressMask');
      if (mask) mask.remove();
      return;
    }

    const activate = event.target && event.target.closest
      ? event.target.closest('[data-paper-activate-rental]')
      : null;
    if (!activate) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    activatePaperRental(activate);
  }, true);

  function observeUpdates() {
    const observer = new MutationObserver(function () { scheduleTabCounts(30); });
    const stats = document.getElementById('stats');
    const list = document.getElementById('list');
    if (stats) observer.observe(stats, { childList: true, subtree: true, characterData: true });
    if (list) observer.observe(list, { childList: true, subtree: true });
  }

  installStyles();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      observeUpdates();
      scheduleTabCounts(250);
    }, { once: true });
  } else {
    observeUpdates();
    scheduleTabCounts(250);
  }
  global.addEventListener('pageshow', function () { scheduleTabCounts(180); });
  global.setInterval(function () { scheduleTabCounts(0); }, 4000);
})(window);
