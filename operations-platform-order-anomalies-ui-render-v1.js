(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./operations-platform-order-anomalies-utils-v1.js'),require('./operations-platform-order-anomalies-diagnostics-v1.js'));
  else root.OperationsPlatformOrderAnomaliesUiRenderV1=factory(root.OperationsPlatformOrderAnomaliesUtilsV1,root.OperationsPlatformOrderAnomaliesDiagnosticsV1);
})(typeof window!=='undefined'?window:globalThis,function(utils,diagnostics){
  'use strict';
  if(!utils||!diagnostics)throw new Error('平台訂單異常顯示程式載入順序不正確');
  const {clean,normalizeSku,escapeHtml,attr,dateTimeText,formatNumber}=utils;
  const {buildProductMap,classifyOrder,platformOrderGroupKey,orderIdOf,orderStatus,automaticRecheckEligible,attentionRows,issueInfo}=diagnostics;
  function productMapFromState(state) {
    const products = (state && state.internalProducts || []).map(function (product) {
      return { id: product.docId, docId: product.docId, raw: product };
    });
    return buildProductMap(products);
  }

  function issueBadgeLabel(status) {
    const map = {
      'missing-sku': '缺少 SKU',
      'unmatched-sku': 'SKU 找不到',
      'duplicate-sku': 'SKU 重複',
      error: '處理失敗',
      'missing-from-platform-review': '平台漏回傳待複核',
      'reversal-error': '取消回補失敗',
      'manual-return-review': '退貨待處理'
    };
    return map[status] || status || '待處理';
  }

  function renderIssueItem(order, productMap) {
    const info = issueInfo(order, productMap);
    const id = orderIdOf(order);
    const status = orderStatus(order);
    const sku = normalizeSku(order && order.sku);
    const groupKey = platformOrderGroupKey(order);
    const recheckButton = info.canRecheck
      ? '<button type="button" class="ops-button small ' + (info.readyNow ? 'primary' : 'ghost') + '" data-poa-action="recheck-one" data-id="' + attr(id) + '">' + (info.readyNow ? '重新檢查並完成' : '重新檢查此筆') + '</button>'
      : '';
    const searchButton = ['missing-sku', 'unmatched-sku', 'duplicate-sku', 'error', 'reversal-error'].includes(status)
      ? '<button type="button" class="ops-button small ghost" data-poa-action="open-product" data-id="' + attr(id) + '" data-search="' + attr(info.searchTerm) + '">前往商品資訊</button>'
      : '';
    const detailButton = groupKey
      ? '<button type="button" class="ops-button small ghost" data-action="platform-order-detail" data-key="' + attr(groupKey) + '">查看訂單</button>'
      : '';
    const copyButton = sku
      ? '<button type="button" class="ops-button small ghost" data-poa-action="copy-sku" data-sku="' + attr(sku) + '">複製 SKU</button>'
      : '';
    return '<article class="ops-poa-item ' + attr(info.severity) + '">' +
      '<div class="ops-poa-item-head"><div><b>' + escapeHtml(info.title) + '</b><small>' + escapeHtml((order.platform || '平台') + '｜訂單 ' + (order.externalOrderNo || order.externalOrderId || id || '未提供') + '｜' + dateTimeText(order.orderedAt || order.lastSeenAt)) + '</small></div>' +
      '<div class="ops-poa-badges"><span class="ops-poa-badge ' + attr(info.severity) + '">' + escapeHtml(issueBadgeLabel(status)) + '</span>' +
      (sku ? '<span class="ops-poa-badge">SKU ' + escapeHtml(sku) + '</span>' : '') +
      (info.readyNow ? '<span class="ops-poa-badge ready">目前已可配對</span>' : '') + '</div></div>' +
      '<div class="ops-poa-reason"><strong>發生原因</strong>' + escapeHtml(info.reason) + '</div>' +
      '<div class="ops-poa-fix"><strong>建議修正方式</strong>' + escapeHtml(info.fix) + '</div>' +
      '<div class="ops-poa-meta"><span>商品：' + escapeHtml(order.productName || '未提供') + '</span><span>規格：' + escapeHtml(order.variantName || '未提供') + '</span><span>數量：' + formatNumber(order.quantity) + '</span></div>' +
      '<div class="ops-poa-item-actions">' + recheckButton + searchButton + copyButton + detailButton + '</div>' +
      '</article>';
  }

  function panelHtml(rows, productMap, lastRunMessage, lastRunKind) {
    const counts = rows.reduce(function (all, row) {
      const status = orderStatus(row);
      all[status] = Number(all[status] || 0) + 1;
      return all;
    }, {});
    const automatic = rows.filter(automaticRecheckEligible);
    const ready = automatic.filter(function (row) { return classifyOrder(row, productMap).status === 'matched'; });
    const visibleRows = rows.slice(0, 200);
    const items = visibleRows.length
      ? visibleRows.map(function (row) { return renderIssueItem(row, productMap); }).join('')
      : '<div class="ops-poa-empty"><b>目前沒有待處理的平台訂單異常</b><br><span>已符合條件的資料會自動從這裡移除，歷史處理紀錄仍保留在訂單與庫存異動中。</span></div>';
    const statusHtml = lastRunMessage
      ? '<div class="ops-poa-status show ' + attr(lastRunKind || 'info') + '" id="opsPoaRunStatus">' + escapeHtml(lastRunMessage) + '</div>'
      : '<div class="ops-poa-status" id="opsPoaRunStatus"></div>';
    return '<section class="ops-card ops-poa-card" id="opsPlatformOrderAnomalyPanel">' +
      '<div class="ops-poa-head"><div><h2>平台訂單異常與修正</h2><p>這裡會直接寫出異常原因和修正方式。修正商品編號後按重新檢查；系統會先確認沒有扣過庫存，才安全補扣一次並把已解決項目移出清單。</p></div>' +
      '<div class="ops-poa-actions"><button type="button" class="ops-button primary" data-poa-action="recheck-all" ' + (automatic.length ? '' : 'disabled') + '>重新檢查可處理項目</button><button type="button" class="ops-button ghost" data-poa-action="refresh">重新讀取</button></div></div>' +
      '<div class="ops-poa-summary"><span class="ops-poa-chip danger">待確認 ' + formatNumber(rows.length) + ' 筆</span>' +
      '<span class="ops-poa-chip">缺少 SKU ' + formatNumber(counts['missing-sku'] || 0) + '</span>' +
      '<span class="ops-poa-chip">找不到 SKU ' + formatNumber(counts['unmatched-sku'] || 0) + '</span>' +
      '<span class="ops-poa-chip">SKU 重複 ' + formatNumber(counts['duplicate-sku'] || 0) + '</span>' +
      '<span class="ops-poa-chip warning">其他需人工確認 ' + formatNumber(rows.length - Number(counts['missing-sku'] || 0) - Number(counts['unmatched-sku'] || 0) - Number(counts['duplicate-sku'] || 0) - Number(counts.error || 0)) + '</span>' +
      (ready.length ? '<span class="ops-poa-chip ready">目前可直接完成 ' + formatNumber(ready.length) + ' 筆</span>' : '') + '</div>' +
      statusHtml + '<div class="ops-poa-list">' + items + '</div>' +
      (rows.length > visibleRows.length ? '<div class="ops-poa-more">為避免頁面過長，目前顯示前 ' + visibleRows.length + ' 筆；請先處理後重新讀取。</div>' : '') +
      '</section>';
  }

  return {productMapFromState:productMapFromState,panelHtml:panelHtml};
});
