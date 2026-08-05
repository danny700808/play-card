(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./operations-platform-order-anomalies-utils-v1.js'),require('./operations-platform-order-anomalies-diagnostics-v1.js'),require('./operations-platform-order-anomalies-recheck-service-v1.js'),require('./operations-platform-order-anomalies-ui-styles-v1.js'),require('./operations-platform-order-anomalies-ui-render-v1.js'),globalThis);
  else {const api=factory(root.OperationsPlatformOrderAnomaliesUtilsV1,root.OperationsPlatformOrderAnomaliesDiagnosticsV1,root.OperationsPlatformOrderAnomaliesRecheckServiceV1,root.OperationsPlatformOrderAnomaliesUiStylesV1,root.OperationsPlatformOrderAnomaliesUiRenderV1,root);root.OperationsPlatformOrderAnomaliesUiMainV1=api;api.start();}
})(typeof window!=='undefined'?window:globalThis,function(utils,diagnostics,recheckService,styles,rendering,global){
  'use strict';
  if(!utils||!diagnostics||!recheckService||!styles||!rendering)throw new Error('平台訂單異常介面程式載入順序不正確');
  const {clean,normalizeSku,escapeHtml}=utils;
  const {orderIdOf,automaticRecheckEligible,attentionRows,issueInfo}=diagnostics;
  const {recheckOrders}=recheckService;
  const {ensureStyles}=styles;
  const {productMapFromState,panelHtml}=rendering;
  let observer=null,started=false,busy=false,enhanceTimer=null,lastRunMessage='',lastRunKind='';
  function stateObject(){return global.OperationsCenterV1&&global.OperationsCenterV1.state||null;}
  function currentView() {
    return clean((global.location && global.location.hash || '#overview').replace(/^#/, '').split('?')[0]) || 'overview';
  }

  function scheduleEnhance(delay) {
    if (enhanceTimer) global.clearTimeout(enhanceTimer);
    enhanceTimer = global.setTimeout(function () {
      enhanceTimer = null;
      enhance();
    }, delay == null ? 40 : delay);
  }

  function enhance() {
    if (!global.document || currentView() !== 'sync') return;
    const state = stateObject();
    const content = global.document.getElementById('opsContent');
    if (!state || !content || !state.db) return;
    if (content.querySelector('#opsPlatformOrderAnomalyPanel')) return;
    const controlCard = content.querySelector('.ops-platform-control-card');
    if (!controlCard) return;
    const rows = attentionRows(state.platformOrders || []);
    const productMap = productMapFromState(state);
    const wrapper = global.document.createElement('div');
    wrapper.innerHTML = panelHtml(rows, productMap, lastRunMessage, lastRunKind);
    const panel = wrapper.firstElementChild;
    controlCard.insertAdjacentElement('afterend', panel);
  }

  function setRunStatus(message, kind) {
    lastRunMessage = clean(message);
    lastRunKind = clean(kind) || 'info';
    const element = global.document && global.document.getElementById('opsPoaRunStatus');
    if (!element) return;
    element.textContent = lastRunMessage;
    element.className = 'ops-poa-status show ' + lastRunKind;
  }

  function toast(title, message, type) {
    if (!global.document) return;
    const stack = global.document.getElementById('opsToastStack');
    if (!stack) {
      if (type === 'error' && global.alert) global.alert(title + '\n' + message);
      return;
    }
    const item = global.document.createElement('div');
    item.className = 'ops-toast ' + (type || 'info');
    item.innerHTML = '<b>' + escapeHtml(title) + '</b><span>' + escapeHtml(message) + '</span>';
    stack.appendChild(item);
    global.setTimeout(function () {
      item.classList.add('leaving');
      global.setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 350);
    }, 5200);
  }

  async function reloadAndEnhance() {
    const api = global.OperationsCenterV1;
    if (api && typeof api.reload === 'function') await api.reload();
    const existing = global.document && global.document.getElementById('opsPlatformOrderAnomalyPanel');
    if (existing) existing.remove();
    scheduleEnhance(80);
  }

  async function runRecheck(ids, source) {
    if (busy) return;
    busy = true;
    setRunStatus('正在讀取最新商品主檔並重新檢查，請勿重複按鈕或關閉頁面…', 'info');
    try {
      const output = await recheckOrders(ids, {
        source: source,
        onProgress: function (index, total) {
          setRunStatus('重新檢查中：' + (index + 1) + ' / ' + total + '。每筆都會先確認是否已扣庫存。', 'info');
        }
      });
      const summary = output.summary;
      const message = '已解決 ' + summary.resolved + ' 筆（本次補扣 ' + summary.applied + '、已扣過 ' + summary.alreadyApplied + '）；仍需修正 ' + summary.unresolved + ' 筆；失敗 ' + summary.errors + ' 筆。';
      lastRunMessage = message;
      lastRunKind = summary.errors ? 'warning' : (summary.resolved ? 'success' : 'warning');
      toast('平台訂單異常重新檢查完成', message, summary.errors ? 'warning' : 'success');
      await reloadAndEnhance();
    } catch (error) {
      const message = clean(error && (error.message || error)) || '重新檢查失敗';
      setRunStatus('重新檢查失敗：' + message, 'error');
      toast('無法重新檢查', message, 'error');
    } finally {
      busy = false;
    }
  }

  function openProductForOrder(order, search) {
    const state = stateObject();
    if (!state) return;
    const info = issueInfo(order, productMapFromState(state));
    state.productSearch = clean(search) || info.searchTerm || normalizeSku(order && order.sku) || clean(order && order.productName);
    state.productFilter = 'all';
    state.productSeries = 'all';
    state.productVisible = 48;
    if (global.location) global.location.hash = '#products';
  }

  async function copySku(value) {
    const sku = normalizeSku(value);
    if (!sku) return;
    try {
      if (global.navigator && global.navigator.clipboard) await global.navigator.clipboard.writeText(sku);
      else throw new Error('clipboard unavailable');
      toast('SKU 已複製', sku, 'success');
    } catch (_) {
      if (global.prompt) global.prompt('請複製 SKU', sku);
    }
  }

  function handleClick(event) {
    const overviewButton = event.target && event.target.closest && event.target.closest('[data-action="overview-order-errors"]');
    if (overviewButton) {
      lastRunMessage = '';
      lastRunKind = '';
      scheduleEnhance(120);
      return;
    }
    const button = event.target && event.target.closest && event.target.closest('[data-poa-action]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = clean(button.dataset.poaAction);
    const state = stateObject();
    if (!state) return;
    const rows = attentionRows(state.platformOrders || []);
    if (action === 'refresh') {
      lastRunMessage = '正在重新讀取最新訂單與商品資料…';
      lastRunKind = 'info';
      reloadAndEnhance().catch(function (error) {
        setRunStatus('重新讀取失敗：' + clean(error.message || error), 'error');
      });
      return;
    }
    if (action === 'recheck-all') {
      const ids = rows.filter(automaticRecheckEligible).map(orderIdOf).filter(Boolean);
      if (!ids.length) {
        toast('目前沒有可自動重新檢查的項目', '退貨與取消回補類異常需要依畫面說明人工確認。', 'warning');
        return;
      }
      if (global.confirm && !global.confirm('確認重新檢查 ' + ids.length + ' 筆平台訂單異常？\n\n系統會先確認 SKU 唯一、訂單有效，而且以前沒有扣過庫存；只有全部符合才會安全補扣一次。')) return;
      runRecheck(ids, 'bulk-platform-order-anomaly-recheck');
      return;
    }
    if (action === 'recheck-one') {
      const id = clean(button.dataset.id);
      if (!id) return;
      runRecheck([id], 'single-platform-order-anomaly-recheck:' + id);
      return;
    }
    if (action === 'open-product') {
      const id = clean(button.dataset.id);
      const order = rows.find(function (row) { return orderIdOf(row) === id; });
      if (order) openProductForOrder(order, button.dataset.search);
      return;
    }
    if (action === 'copy-sku') {
      copySku(button.dataset.sku);
    }
  }

  function start() {
    if (started || !global.document) return;
    started = true;
    ensureStyles();
    global.document.addEventListener('click', handleClick, true);
    global.addEventListener('hashchange', function () { scheduleEnhance(80); });
    const beginObserve = function () {
      const content = global.document.getElementById('opsContent');
      if (!content) {
        global.setTimeout(beginObserve, 120);
        return;
      }
      observer = new MutationObserver(function () { scheduleEnhance(45); });
      observer.observe(content, { childList: true, subtree: false });
      scheduleEnhance(60);
    };
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', beginObserve, { once: true });
    else beginObserve();
  }
  return {start:start};
});
