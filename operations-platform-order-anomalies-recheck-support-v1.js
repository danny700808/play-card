(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./operations-platform-order-anomalies-utils-v1.js'),require('./operations-platform-order-anomalies-diagnostics-v1.js'),globalThis);
  else root.OperationsPlatformOrderAnomaliesRecheckSupportV1=factory(root.OperationsPlatformOrderAnomaliesUtilsV1,root.OperationsPlatformOrderAnomaliesDiagnosticsV1,root);
})(typeof window!=='undefined'?window:globalThis,function(utils,diagnostics,global){
  'use strict';
  if(!utils||!diagnostics)throw new Error('平台訂單異常基礎程式尚未載入');
  const VERSION=utils.VERSION;
  const {clean}=utils;
  const {buildProductMap}=diagnostics;
  const COLLECTIONS={products:'opsInternalProducts',inventory:'opsInventoryTransactions',orders:'opsPlatformOrders',settings:'opsSettings',syncRequests:'opsPlatformSyncRequests',inventoryQueue:'opsPlatformInventoryQueue',audit:'opsAuditLogs'};
  function userLabel(state) {
    const user = state && state.user || {};
    return clean(user.name || user.displayName || user.email || user.uid) || '營運中心管理者';
  }

  function serverTimestamp() {
    if (!global.firebase || !global.firebase.firestore || !global.firebase.firestore.FieldValue) return new Date();
    return global.firebase.firestore.FieldValue.serverTimestamp();
  }

  function stateObject() {
    return global.OperationsCenterV1 && global.OperationsCenterV1.state || null;
  }

  function database() {
    const state = stateObject();
    return state && state.db || null;
  }

  async function fetchProducts(db) {
    const snapshot = await db.collection(COLLECTIONS.products).get();
    return snapshot.docs.map(function (doc) {
      return { id: doc.id, docId: doc.id, ref: doc.ref, raw: doc.data() || {} };
    }).filter(function (product) {
      return product.raw.enabled !== false;
    });
  }

  async function readRecheckSettings(db) {
    const snapshot = await db.collection(COLLECTIONS.settings).doc('platformOrderSync').get();
    const raw = snapshot.exists ? snapshot.data() || {} : {};
    return {
      applyInventory: raw.applyInventory !== false,
      estimatedNetRate: Math.min(1, Math.max(0, Number(raw.estimatedNetRate || 0.87)))
    };
  }

  function unresolvedPatch(status, reason, fix, matchCount, actor) {
    return {
      processingStatus: status,
      inventoryApplied: false,
      matchCount: Number(matchCount || 0),
      processingError: reason,
      anomalyReasonCode: status,
      anomalyReasonText: reason,
      anomalySuggestedFix: fix,
      anomalyLastCheckedAt: serverTimestamp(),
      anomalyLastCheckedBy: actor,
      updatedAt: serverTimestamp(),
      updatedBy: actor,
      version: VERSION
    };
  }

  async function markUnresolved(db, orderId, status, reason, fix, matchCount, actor) {
    await db.collection(COLLECTIONS.orders).doc(orderId).set(
      unresolvedPatch(status, reason, fix, matchCount, actor),
      { merge: true }
    );
    return { status: 'unresolved', orderId: orderId, issueStatus: status, reason: reason };
  }

  function existingInventoryLooksApplied(raw) {
    if (!raw || typeof raw !== 'object') return false;
    if (clean(raw.type) !== 'onlineSale') return false;
    return Number(raw.qtyChange || 0) < 0 || Number(raw.afterStock) < Number(raw.beforeStock);
  }

  return {VERSION:VERSION,COLLECTIONS:COLLECTIONS,userLabel:userLabel,serverTimestamp:serverTimestamp,stateObject:stateObject,database:database,fetchProducts:fetchProducts,readRecheckSettings:readRecheckSettings,unresolvedPatch:unresolvedPatch,markUnresolved:markUnresolved,existingInventoryLooksApplied:existingInventoryLooksApplied};
});
