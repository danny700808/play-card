(function(root,factory){
'use strict';
if(typeof module==='object'&&module.exports)module.exports=factory(require('./operations-platform-order-anomalies-utils-v1.js'),require('./operations-platform-order-anomalies-diagnostics-v1.js'),require('./operations-platform-order-anomalies-inventory-v1.js'),require('./operations-platform-order-anomalies-recheck-support-v1.js'));
else root.OperationsPlatformOrderAnomaliesRecheckOneV1=factory(root.OperationsPlatformOrderAnomaliesUtilsV1,root.OperationsPlatformOrderAnomaliesDiagnosticsV1,root.OperationsPlatformOrderAnomaliesInventoryV1,root.OperationsPlatformOrderAnomaliesRecheckSupportV1);
})(typeof window!=='undefined'?window:globalThis,function(utils,diagnostics,inventory,support){
'use strict';
if(!utils||!diagnostics||!inventory||!support)throw new Error('平台訂單異常重新檢查程式載入順序不正確');
const VERSION=utils.VERSION,COLLECTIONS=support.COLLECTIONS;
const {clean,normalizeSku,productIdOf,productSkuOf,productNameOf}=utils;
const {classifyOrder}=diagnostics;
const {consumeFifoAllowNegative,productFallbackUnitCost,platformMappingPatch,mergePlatformMappings,orderLifecycle,orderSkipsInventory,orderHasFulfillmentEvidence,orderCanApplyInventory}=inventory;
const {serverTimestamp,markUnresolved,unresolvedPatch,existingInventoryLooksApplied}=support;
async function recheckOrderWithContext(orderId, context) {
const db = context.db;
const actor = context.actor;
const settings = context.settings;
const productMap = context.productMap;
const orderRef = db.collection(COLLECTIONS.orders).doc(orderId);
const freshOrderSnapshot = await orderRef.get();
if (!freshOrderSnapshot.exists) return { status: 'missing-order', orderId: orderId };
const freshOrder = Object.assign({ id: freshOrderSnapshot.id }, freshOrderSnapshot.data() || {});
const classification = classifyOrder(freshOrder, productMap);
if (classification.status === 'missing-sku') {
return markUnresolved(
db,
orderId,
'missing-sku',
'平台訂單沒有帶 SKU／商品編號，無法自動判斷中央商品。',
'請先到平台商品或規格補上 SKU，執行立即同步後再重新檢查。',
0,
actor
);
}
if (classification.status === 'unmatched-sku') {
return markUnresolved(
db,
orderId,
'unmatched-sku',
'中央商品主檔找不到 SKU「' + classification.sku + '」。',
'請把正確中央商品的 SKU 改成完全相同後再重新檢查。',
0,
actor
);
}
if (classification.status === 'duplicate-sku') {
return markUnresolved(
db,
orderId,
'duplicate-sku',
'SKU「' + classification.sku + '」同時對到 ' + classification.matches.length + ' 筆中央商品。',
'請只保留一筆商品使用此 SKU，其他商品改成不同編號。',
classification.matches.length,
actor
);
}
const product = classification.product;
const productId = productIdOf(product);
if (!productId) throw new Error('找不到中央商品文件 ID。');
const productRef = db.collection(COLLECTIONS.products).doc(productId);
const inventoryRef = db.collection(COLLECTIONS.inventory).doc('online_' + orderId);
const queueRef = db.collection(COLLECTIONS.inventoryQueue).doc(productId);
return db.runTransaction(async function (transaction) {
const snapshots = await Promise.all([
transaction.get(orderRef),
transaction.get(productRef),
transaction.get(inventoryRef)
]);
const orderSnapshot = snapshots[0];
const productSnapshot = snapshots[1];
const inventorySnapshot = snapshots[2];
if (!orderSnapshot.exists) return { status: 'missing-order', orderId: orderId };
if (!productSnapshot.exists) throw new Error('配對到的中央商品已不存在，請重新整理後再試。');
const order = Object.assign({ id: orderSnapshot.id }, orderSnapshot.data() || {});
const productRaw = productSnapshot.data() || {};
const inventoryRaw = inventorySnapshot.exists ? inventorySnapshot.data() || {} : {};
const currentOrderSku = normalizeSku(order.sku);
const currentProductSku = productSkuOf(productRaw);
if (currentOrderSku !== classification.sku) {
throw new Error('重新檢查期間訂單 SKU 已變更，請重新整理後再執行。');
}
if (currentProductSku !== classification.sku) {
throw new Error('重新檢查期間商品 SKU 已變更，請重新整理後再執行。');
}
const alreadyApplied = order.inventoryApplied === true && order.reversalApplied !== true && order.inventoryReversed !== true;
const inventoryAlreadyExists = inventorySnapshot.exists && existingInventoryLooksApplied(inventoryRaw);
const baseResolvedPatch = {
productId: productId,
matchStatus: 'matched',
matchCount: 1,
processingError: '',
anomalyReasonCode: '',
anomalyReasonText: '',
anomalySuggestedFix: '',
anomalyResolvedAt: serverTimestamp(),
anomalyResolvedBy: actor,
anomalyResolution: alreadyApplied || inventoryAlreadyExists ? 'already-applied' : 'sku-rechecked',
anomalyLastCheckedAt: serverTimestamp(),
anomalyLastCheckedBy: actor,
updatedAt: serverTimestamp(),
updatedBy: actor,
version: VERSION
};
if (alreadyApplied || inventoryAlreadyExists) {
transaction.set(orderRef, Object.assign({}, baseResolvedPatch, {
inventoryApplied: true,
inventoryReversed: false,
reversalApplied: false,
processingStatus: 'inventory-applied'
}), { merge: true });
return { status: 'already-applied', orderId: orderId, productId: productId };
}
if (orderSkipsInventory(order)) {
transaction.set(orderRef, Object.assign({}, baseResolvedPatch, {
inventoryApplied: order.inventoryApplied === true,
processingStatus: 'historical-import-no-stock'
}), { merge: true });
return { status: 'resolved-no-stock', orderId: orderId, productId: productId };
}
if (!orderCanApplyInventory(order)) {
const lifecycle = orderLifecycle(order);
if (lifecycle === 'return-candidate' && orderHasFulfillmentEvidence(order)) {
const returnReason = '平台顯示退貨或退款，而且訂單已有出貨／配送證據，不能直接當成未成交取消。';
const returnFix = '請按「查看訂單」並使用「處理退貨」，確認商品是否收到及要恢復正常庫存、轉瑕疵品、待檢查、報廢或退回供應商。';
transaction.set(orderRef, Object.assign({}, unresolvedPatch(
'manual-return-review',
returnReason,
returnFix,
1,
actor
), {
productId: productId,
matchStatus: 'matched'
}), { merge: true });
return { status: 'unresolved', orderId: orderId, productId: productId, issueStatus: 'manual-return-review', reason: returnReason };
}
transaction.set(orderRef, Object.assign({}, baseResolvedPatch, {
inventoryApplied: false,
processingStatus: 'ignored-cancelled'
}), { merge: true });
return { status: 'resolved-not-sale', orderId: orderId, productId: productId };
}
const quantity = Math.max(0, Math.round(Number(order.quantity || 0)));
if (!quantity) throw new Error('訂單數量不是正整數，不能自動扣庫存。');
const grossAmount = Math.max(0, Number(order.grossAmount || (Number(order.unitPrice || 0) * quantity) || 0));
const estimatedNetAmount = Math.round(grossAmount * settings.estimatedNetRate);
const fifo = consumeFifoAllowNegative(productRaw, quantity);
const fallbackUnitCost = productFallbackUnitCost(productRaw);
const estimatedQty = fallbackUnitCost != null ? Math.max(0, Number(fifo.unknownCostQty || 0)) : 0;
const effectiveCostTotal = Number(fifo.costTotal || 0) + estimatedQty * Number(fallbackUnitCost || 0);
const remainingUnknownCostQty = Math.max(0, Number(fifo.unknownCostQty || 0) - estimatedQty);
const costEstimated = estimatedQty > 0;
const estimatedProfit = estimatedNetAmount - effectiveCostTotal;
const mappings = mergePlatformMappings(productRaw.platformMappings, platformMappingPatch(order));
const productPatch = {
platformMappings: mappings,
updatedAt: serverTimestamp(),
updatedBy: actor,
version: VERSION
};
if (settings.applyInventory) {
productPatch.currentStock = fifo.after;
productPatch.costLayers = fifo.layers;
productPatch.averageCost = fifo.averageCost;
productPatch.inventoryValue = fifo.inventoryValue;
productPatch.costIncomplete = fifo.costIncomplete;
}
transaction.set(productRef, productPatch, { merge: true });
transaction.set(orderRef, Object.assign({}, baseResolvedPatch, {
sku: classification.sku,
grossAmount: grossAmount,
estimatedNetRate: settings.estimatedNetRate,
estimatedNetAmount: estimatedNetAmount,
estimatedProfit: estimatedProfit,
costTotal: effectiveCostTotal,
costEstimated: costEstimated,
costSource: costEstimated ? 'fifo+current-product-estimate' : 'fifo',
unknownCostQty: remainingUnknownCostQty,
inventoryApplied: settings.applyInventory,
inventoryReversed: false,
reversalApplied: false,
reversalReason: '',
inventoryBefore: fifo.before,
inventoryAfter: settings.applyInventory ? fifo.after : fifo.before,
processingStatus: settings.applyInventory ? 'inventory-applied' : 'dry-run',
inventoryAppliedAt: settings.applyInventory ? serverTimestamp() : null,
financialUpdatedAt: serverTimestamp(),
lastSeenAt: serverTimestamp()
}), { merge: true });
if (settings.applyInventory) {
transaction.set(inventoryRef, {
type: 'onlineSale',
platform: clean(order.platform),
productId: productId,
productName: productNameOf(productRaw) || clean(order.productName),
sku: classification.sku,
qtyChange: -quantity,
beforeStock: fifo.before,
afterStock: fifo.after,
unitCost: quantity > 0 ? effectiveCostTotal / quantity : null,
costTotal: effectiveCostTotal,
unknownCostQty: remainingUnknownCostQty,
costMethod: costEstimated ? 'FIFO_OR_CURRENT_COST_ESTIMATE' : 'FIFO',
fifoBreakdown: fifo.breakdown,
referenceType: 'platformOrder',
referenceId: clean(order.externalOrderNo || order.externalOrderId || orderId),
orderLineId: orderId,
note: clean(order.platform) + ' 網路訂單｜SKU 修正後重新檢查',
occurredAt: order.orderedAt || serverTimestamp(),
createdAt: serverTimestamp(),
createdBy: actor,
version: VERSION
}, { merge: true });
transaction.set(queueRef, {
productId: productId,
sku: classification.sku,
productName: productNameOf(productRaw),
targetStock: Math.max(0, fifo.after),
status: 'pending',
reason: 'platformOrderAnomalyRecheck',
updatedAt: serverTimestamp(),
updatedBy: actor,
version: VERSION
}, { merge: true });
}
return {
status: settings.applyInventory ? 'applied' : 'dry-run',
orderId: orderId,
productId: productId,
before: fifo.before,
after: settings.applyInventory ? fifo.after : fifo.before,
quantity: quantity
};
});
}
return {recheckOrderWithContext:recheckOrderWithContext};
});
