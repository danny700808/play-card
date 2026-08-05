(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./operations-platform-order-anomalies-utils-v1.js'));
  else root.OperationsPlatformOrderAnomaliesDiagnosticsV1=factory(root.OperationsPlatformOrderAnomaliesUtilsV1);
})(typeof window!=='undefined'?window:globalThis,function(utils){
  'use strict';
  if(!utils)throw new Error('平台訂單異常工具程式尚未載入');
  const {clean,normalizeSku,dateFrom,formatNumber,productSkuOf,productNameOf}=utils;
  const ATTENTION_STATUSES=new Set(['missing-sku','unmatched-sku','duplicate-sku','error','missing-from-platform-review','reversal-error','manual-return-review']);
  const AUTOMATIC_RECHECK_STATUSES=new Set(['missing-sku','unmatched-sku','duplicate-sku','error']);
  function buildProductMap(products) {
    const map = new Map();
    (products || []).forEach(function (product) {
      const raw = product && product.raw && typeof product.raw === 'object' ? product.raw : product || {};
      if (raw.enabled === false) return;
      const sku = productSkuOf(product);
      if (!sku) return;
      if (!map.has(sku)) map.set(sku, []);
      map.get(sku).push(product);
    });
    return map;
  }

  function classifyOrder(order, productMap) {
    const sku = normalizeSku(order && order.sku);
    if (!sku) return { status: 'missing-sku', sku: '', matches: [] };
    const matches = productMap && productMap.get(sku) || [];
    if (!matches.length) return { status: 'unmatched-sku', sku: sku, matches: [] };
    if (matches.length > 1) return { status: 'duplicate-sku', sku: sku, matches: matches };
    return { status: 'matched', sku: sku, matches: matches, product: matches[0] };
  }

  function platformOrderGroupKey(order) {
    return clean(order && order.platform) + '|' + clean(order && (order.externalOrderNo || order.externalOrderId || order.id || order.__id));
  }

  function orderIdOf(order) {
    return clean(order && (order.id || order.__id));
  }

  function orderStatus(order) {
    return clean(order && order.processingStatus);
  }

  function orderNeedsAttention(order) {
    return !!order && ATTENTION_STATUSES.has(orderStatus(order));
  }

  function automaticRecheckEligible(order) {
    return !!order && AUTOMATIC_RECHECK_STATUSES.has(orderStatus(order));
  }

  function attentionRows(rows) {
    return (rows || []).filter(orderNeedsAttention).sort(function (a, b) {
      const priority = {
        'missing-sku': 1,
        'unmatched-sku': 2,
        'duplicate-sku': 3,
        error: 4,
        'reversal-error': 5,
        'missing-from-platform-review': 6,
        'manual-return-review': 7
      };
      const statusCompare = Number(priority[orderStatus(a)] || 99) - Number(priority[orderStatus(b)] || 99);
      if (statusCompare) return statusCompare;
      return Number(dateFrom(b && (b.orderedAt || b.lastSeenAt)) || 0) - Number(dateFrom(a && (a.orderedAt || a.lastSeenAt)) || 0);
    });
  }

  function issueInfo(order, productMap) {
    const status = orderStatus(order);
    const sku = normalizeSku(order && order.sku);
    const current = classifyOrder(order, productMap || new Map());
    const processingError = clean(order && order.processingError);
    const platform = clean(order && order.platform) || '平台';
    const productName = clean(order && order.productName) || '未命名商品';
    const base = {
      code: status,
      severity: status === 'manual-return-review' || status === 'missing-from-platform-review' ? 'warning' : 'danger',
      title: '平台訂單需要確認',
      reason: processingError || '這筆訂單尚未完成處理。',
      fix: '請查看訂單內容後再處理。',
      searchTerm: productName,
      canRecheck: automaticRecheckEligible(order),
      readyNow: current.status === 'matched',
      currentStatus: current.status,
      matches: current.matches || []
    };

    if (status === 'missing-sku') {
      base.title = '平台訂單沒有商品編號';
      base.reason = platform + ' 回傳的這筆商品明細沒有 SKU／商品編號，因此系統無法判斷要扣哪一個中央商品。';
      base.fix = '請先到 ' + platform + ' 的商品或規格資料補上 SKU，再執行「立即同步」取得新資料，最後回來按「重新檢查」。商品名稱只能當提示，系統不會用相似名稱猜測扣庫存。';
      base.searchTerm = productName;
      base.readyNow = false;
    } else if (status === 'unmatched-sku') {
      base.title = '中央商品主檔找不到相同 SKU';
      base.reason = '訂單帶入 SKU「' + (sku || '空白') + '」，但目前中央商品主檔沒有完全相同且啟用中的商品。';
      base.fix = '到「商品資訊」找到正確商品，把 SKU 改成「' + (sku || '訂單上的編號') + '」並儲存；回來按「重新檢查」。前後空白會忽略，英文字母不分大小寫。';
      base.searchTerm = productName || sku;
      if (current.status === 'matched') {
        base.severity = 'ready';
        base.reason = '最新商品主檔現在已找到唯一對應：' + productNameOf(current.product) + '（SKU ' + sku + '）。';
        base.fix = '可以直接按「重新檢查此筆」；系統會確認未扣過庫存後，只安全補扣一次。';
      }
    } else if (status === 'duplicate-sku') {
      const names = (current.matches || []).slice(0, 4).map(productNameOf).join('、');
      base.title = '同一個 SKU 對到多筆中央商品';
      base.reason = 'SKU「' + (sku || '空白') + '」目前對到 ' + formatNumber((current.matches || []).length || Number(order && order.matchCount || 0)) + ' 筆商品' + (names ? '：' + names : '') + '，系統不能自行選一筆扣庫存。';
      base.fix = '到「商品資訊」搜尋 SKU「' + sku + '」，只保留一筆正確商品使用這個編號；其他商品改成不同 SKU，再回來重新檢查。';
      base.searchTerm = sku || productName;
      if (current.status === 'matched') {
        base.severity = 'ready';
        base.reason = '最新商品主檔現在只剩一筆對應：' + productNameOf(current.product) + '（SKU ' + sku + '）。';
        base.fix = '重複編號已排除，可以直接按「重新檢查此筆」。';
      }
    } else if (status === 'error') {
      base.title = '上次訂單處理失敗';
      base.reason = processingError || '上一次同步在配對或扣庫存時發生未分類錯誤。';
      base.fix = sku
        ? '先確認中央商品只有一筆使用 SKU「' + sku + '」，再按「重新檢查」。若仍失敗，下方會保留最新錯誤訊息。'
        : '這筆訂單沒有 SKU；請先到平台補上商品編號並重新同步。';
      base.searchTerm = sku || productName;
      if (current.status === 'matched') {
        base.severity = 'ready';
        base.fix = '目前 SKU 已可唯一配對，可以重新執行安全處理。';
      }
    } else if (status === 'missing-from-platform-review') {
      base.title = '平台這次沒有再回傳此訂單';
      base.reason = processingError || '平台同步成功，但本次查詢結果沒有出現這張曾經扣過庫存的訂單。';
      base.fix = '先到平台確認訂單是否真的取消。這類異常不是改 SKU；系統會等連續同步確認後才自動回補，避免平台暫時漏抓造成誤加庫存。';
      base.canRecheck = false;
      base.searchTerm = clean(order && order.externalOrderNo);
    } else if (status === 'reversal-error') {
      base.title = '取消訂單的庫存回補失敗';
      base.reason = processingError || '訂單已取消，但系統找不到原中央商品或回補交易未完成。';
      base.fix = '確認原商品主檔仍存在、SKU 唯一，並核對這筆訂單是否曾手動調整庫存；完成後執行「立即同步」。不要先自行加庫存，以免重複回補。';
      base.canRecheck = false;
      base.searchTerm = sku || productName;
    } else if (status === 'manual-return-review') {
      base.title = '退貨／退款需要人工確認';
      base.reason = '平台顯示退貨或退款，而且商品可能已經出庫。系統不能猜商品是否真的退回、是否可恢復正常庫存。';
      base.fix = '按「查看訂單」，再使用訂單內的「處理退貨」，選擇尚未收到、恢復正常庫存、瑕疵品、待檢查、報廢或退回供應商。';
      base.canRecheck = false;
      base.searchTerm = clean(order && order.externalOrderNo);
    }

    return base;
  }

  return {buildProductMap:buildProductMap,classifyOrder:classifyOrder,platformOrderGroupKey:platformOrderGroupKey,orderIdOf:orderIdOf,orderStatus:orderStatus,automaticRecheckEligible:automaticRecheckEligible,attentionRows:attentionRows,issueInfo:issueInfo};
});
