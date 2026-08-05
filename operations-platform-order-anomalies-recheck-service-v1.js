(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./operations-platform-order-anomalies-utils-v1.js'),require('./operations-platform-order-anomalies-diagnostics-v1.js'),require('./operations-platform-order-anomalies-recheck-support-v1.js'),require('./operations-platform-order-anomalies-recheck-one-v1.js'));
  else root.OperationsPlatformOrderAnomaliesRecheckServiceV1=factory(root.OperationsPlatformOrderAnomaliesUtilsV1,root.OperationsPlatformOrderAnomaliesDiagnosticsV1,root.OperationsPlatformOrderAnomaliesRecheckSupportV1,root.OperationsPlatformOrderAnomaliesRecheckOneV1);
})(typeof window!=='undefined'?window:globalThis,function(utils,diagnostics,support,recheckOne){
  'use strict';
  if(!utils||!diagnostics||!support||!recheckOne)throw new Error('平台訂單異常服務程式載入順序不正確');
  const VERSION=utils.VERSION,COLLECTIONS=support.COLLECTIONS;
  const {clean}=utils;
  const {buildProductMap}=diagnostics;
  const {stateObject,database,fetchProducts,readRecheckSettings,userLabel,serverTimestamp}=support;
  const {recheckOrderWithContext}=recheckOne;
  async function createRunContext() {
    const state = stateObject();
    const db = database();
    if (!state || !db) throw new Error('營運中心尚未完成 Firebase 初始化。');
    const products = await fetchProducts(db);
    return {
      state: state,
      db: db,
      actor: userLabel(state),
      products: products,
      productMap: buildProductMap(products),
      settings: await readRecheckSettings(db)
    };
  }

  async function writeRunRecords(context, results, source) {
    const changedProductIds = Array.from(new Set(results.filter(function (result) {
      return clean(result && result.status) === 'applied';
    }).map(function (result) {
      return clean(result && result.productId);
    }).filter(Boolean)));
    if (changedProductIds.length) {
      const syncRef = context.db.collection(COLLECTIONS.syncRequests).doc();
      await syncRef.set({
        requestId: syncRef.id,
        status: 'pending',
        reason: 'platform-order-anomaly-recheck',
        productIds: changedProductIds,
        requestedAt: serverTimestamp(),
        requestedBy: context.actor,
        source: source || 'operations-platform-order-anomalies-v1',
        version: VERSION
      });
    }
    const counts = summarizeResults(results);
    const auditRef = context.db.collection(COLLECTIONS.audit).doc();
    await auditRef.set({
      action: '重新檢查平台訂單異常',
      entityType: 'platformOrder',
      entityId: source || 'bulk',
      summary: '已解決 ' + counts.resolved + '、仍需修正 ' + counts.unresolved + '、失敗 ' + counts.errors,
      detail: counts,
      createdAt: serverTimestamp(),
      createdBy: context.actor,
      version: VERSION
    });
    return counts;
  }

  function summarizeResults(results) {
    const summary = { total: 0, resolved: 0, applied: 0, alreadyApplied: 0, unresolved: 0, skipped: 0, errors: 0 };
    (results || []).forEach(function (result) {
      summary.total += 1;
      const status = clean(result && result.status);
      if (status === 'applied') { summary.resolved += 1; summary.applied += 1; }
      else if (status === 'already-applied') { summary.resolved += 1; summary.alreadyApplied += 1; }
      else if (['dry-run', 'resolved-no-stock', 'resolved-not-sale'].includes(status)) summary.resolved += 1;
      else if (status === 'unresolved') summary.unresolved += 1;
      else if (status === 'error') summary.errors += 1;
      else summary.skipped += 1;
    });
    return summary;
  }

  async function safeMarkProcessingError(context, orderId, error) {
    const message = clean(error && (error.message || error)).slice(0, 800) || '重新檢查失敗';
    try {
      await context.db.collection(COLLECTIONS.orders).doc(orderId).set({
        processingStatus: 'error',
        processingError: message,
        anomalyReasonCode: 'error',
        anomalyReasonText: message,
        anomalySuggestedFix: '請依錯誤內容確認商品 SKU、庫存與商品主檔後再重新檢查。',
        anomalyLastCheckedAt: serverTimestamp(),
        anomalyLastCheckedBy: context.actor,
        updatedAt: serverTimestamp(),
        updatedBy: context.actor,
        version: VERSION
      }, { merge: true });
    } catch (_) {
      // 保留原始錯誤；網路中斷時不再用第二個錯誤覆蓋。
    }
    return { status: 'error', orderId: orderId, error: message };
  }

  async function recheckOrders(orderIds, options) {
    const uniqueIds = Array.from(new Set((orderIds || []).map(clean).filter(Boolean)));
    if (!uniqueIds.length) return { results: [], summary: summarizeResults([]) };
    const context = await createRunContext();
    const results = [];
    for (let index = 0; index < uniqueIds.length; index += 1) {
      const orderId = uniqueIds[index];
      if (options && typeof options.onProgress === 'function') {
        options.onProgress(index, uniqueIds.length, orderId);
      }
      try {
        results.push(await recheckOrderWithContext(orderId, context));
      } catch (error) {
        results.push(await safeMarkProcessingError(context, orderId, error));
      }
    }
    const summary = await writeRunRecords(context, results, options && options.source);
    return { results: results, summary: summary };
  }

  return {recheckOrders:recheckOrders,summarizeResults:summarizeResults};
});
