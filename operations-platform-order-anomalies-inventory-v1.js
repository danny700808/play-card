(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./operations-platform-order-anomalies-utils-v1.js'));
  else root.OperationsPlatformOrderAnomaliesInventoryV1=factory(root.OperationsPlatformOrderAnomaliesUtilsV1);
})(typeof window!=='undefined'?window:globalThis,function(utils){
  'use strict';
  if(!utils)throw new Error('平台訂單異常工具程式尚未載入');
  const {clean,lower,numberOrNull,firstValue,hashText,dateFrom}=utils;
  const RETURN_KEYWORDS=['退貨','退款','已退貨','已退款','return','returned','refund','refunded'];
  const CANCEL_KEYWORDS=['取消','已取消','作廢','已作廢','無效','未成立','交易失敗','付款失敗','付款逾期','逾期未付','cancel','canceled','cancelled','void','voided','failed','expired','payment failed'];
  const FULFILLMENT_KEYWORDS=['出貨確認','已出貨','出貨完成','配送中','配送結束','已配送','送達','已送達','已收貨','已簽收','shipped','shipping','departure','delivering','delivered','final_delivery','final delivery','delivery completed'];
  function normalizeCostLayers(value) {
    const rows = Array.isArray(value) ? value : [];
    return rows.map(function (layer, index) {
      const quantity = numberOrNull(firstValue(layer || {}, ['qtyRemaining', 'remainingQty', 'qty', 'quantity']));
      const unitCost = numberOrNull(firstValue(layer || {}, ['unitCost', 'cost', 'purchasePrice']));
      return {
        layerId: clean(firstValue(layer || {}, ['layerId', 'id'])) || ('L' + index),
        qtyRemaining: quantity == null ? 0 : Math.max(0, Number(quantity)),
        originalQty: numberOrNull(firstValue(layer || {}, ['originalQty', 'qty', 'quantity'])) || Math.max(0, Number(quantity || 0)),
        unitCost: unitCost,
        costKnown: layer && layer.costKnown !== false && unitCost != null,
        receivedAt: firstValue(layer || {}, ['receivedAt', 'date', 'createdAt']) || '',
        referenceType: clean(firstValue(layer || {}, ['referenceType', 'source'])) || 'unknown',
        referenceId: clean(firstValue(layer || {}, ['referenceId', 'sourceId']))
      };
    }).filter(function (layer) {
      return layer.qtyRemaining > 0;
    }).sort(function (a, b) {
      return Number(dateFrom(a.receivedAt) || 0) - Number(dateFrom(b.receivedAt) || 0);
    });
  }

  function productFallbackUnitCost(raw) {
    return numberOrNull(firstValue(raw || {}, ['averageCost', 'latestPurchaseCost', 'purchasePrice', 'cost']));
  }

  function materializeCostLayers(raw) {
    raw = raw || {};
    const target = Math.max(0, Number(raw.currentStock || 0));
    let layers = normalizeCostLayers(raw.costLayers);
    let total = layers.reduce(function (sum, layer) { return sum + Number(layer.qtyRemaining || 0); }, 0);
    if (total < target) {
      const fallback = productFallbackUnitCost(raw);
      layers.push({
        layerId: 'fallback_' + hashText(String(target) + '_' + String(fallback)),
        qtyRemaining: target - total,
        originalQty: target - total,
        unitCost: fallback,
        costKnown: fallback != null,
        receivedAt: '1970-01-01T00:00:00.000Z',
        referenceType: 'fallback',
        referenceId: 'LEGACY'
      });
      total = target;
    }
    if (total > target) {
      let extra = total - target;
      for (let index = layers.length - 1; index >= 0 && extra > 0; index -= 1) {
        const take = Math.min(extra, layers[index].qtyRemaining);
        layers[index].qtyRemaining -= take;
        extra -= take;
      }
      layers = layers.filter(function (layer) { return layer.qtyRemaining > 0; });
    }
    return layers;
  }

  function consumeFifoAllowNegative(raw, quantity) {
    const before = Number(raw && raw.currentStock || 0);
    const positiveAvailable = Math.max(0, before);
    const requested = Math.max(0, Math.round(Number(quantity || 0)));
    const costableQuantity = Math.min(requested, positiveAvailable);
    const layers = materializeCostLayers(raw || {});
    let remaining = costableQuantity;
    let costTotal = 0;
    let unknownCostQty = Math.max(0, requested - costableQuantity);
    const breakdown = [];
    for (const layer of layers) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(layer.qtyRemaining || 0));
      if (take <= 0) continue;
      if (layer.unitCost == null) unknownCostQty += take;
      else costTotal += take * Number(layer.unitCost || 0);
      breakdown.push({ layerId: layer.layerId, qty: take, unitCost: layer.unitCost, referenceId: layer.referenceId });
      layer.qtyRemaining -= take;
      remaining -= take;
    }
    if (remaining > 0) unknownCostQty += remaining;
    const after = before - requested;
    const left = after <= 0 ? [] : layers.filter(function (layer) { return Number(layer.qtyRemaining || 0) > 0; });
    const totalQty = left.reduce(function (sum, layer) { return sum + Number(layer.qtyRemaining || 0); }, 0);
    const knownQty = left.reduce(function (sum, layer) { return sum + (layer.unitCost == null ? 0 : Number(layer.qtyRemaining || 0)); }, 0);
    const knownValue = left.reduce(function (sum, layer) {
      return sum + (layer.unitCost == null ? 0 : Number(layer.qtyRemaining || 0) * Number(layer.unitCost || 0));
    }, 0);
    return {
      before: before,
      after: after,
      costTotal: costTotal,
      unknownCostQty: unknownCostQty,
      breakdown: breakdown,
      layers: left,
      averageCost: totalQty > 0 && knownQty === totalQty ? knownValue / totalQty : null,
      inventoryValue: knownValue,
      costIncomplete: unknownCostQty > 0 || totalQty > knownQty
    };
  }

  function platformMappingPatch(order) {
    const ids = order && order.platformIds && typeof order.platformIds === 'object' ? order.platformIds : {};
    const platform = clean(order && order.platform);
    if (platform === 'EasyStore') {
      const productId = clean(ids.productId);
      const variantIds = [clean(ids.variantId)].filter(Boolean);
      if (!productId && !variantIds.length) return {};
      const value = {};
      if (productId) value.productId = productId;
      if (variantIds.length) value.variantIds = variantIds;
      return { easyStore: value };
    }
    if (platform === 'MOMO') {
      const value = {};
      ['goodsCode', 'goodsdtCode', 'entpGoodsNo'].forEach(function (key) {
        const item = clean(ids[key]);
        if (item) value[key] = item;
      });
      return Object.keys(value).length ? { momo: value } : {};
    }
    if (platform === 'Coupang') {
      const vendorItemId = clean(ids.vendorItemId);
      return vendorItemId ? { coupang: { vendorItemIds: [vendorItemId] } } : {};
    }
    return {};
  }

  function mergePlatformMappings(existing, patch) {
    const result = Object.assign({}, existing || {});
    Object.keys(patch || {}).forEach(function (platform) {
      const oldValue = result[platform] && typeof result[platform] === 'object' ? result[platform] : {};
      const newValue = patch[platform] && typeof patch[platform] === 'object' ? patch[platform] : {};
      const merged = Object.assign({}, oldValue, newValue);
      if (platform === 'easyStore') {
        merged.variantIds = Array.from(new Set([].concat(oldValue.variantIds || [], newValue.variantIds || []).map(clean).filter(Boolean)));
      }
      if (platform === 'coupang') {
        merged.vendorItemIds = Array.from(new Set([].concat(oldValue.vendorItemIds || [], newValue.vendorItemIds || []).map(clean).filter(Boolean)));
      }
      result[platform] = merged;
    });
    return result;
  }

  function orderLifecycle(order) {
    const declared = lower(order && order.lifecycle);
    if (declared) return declared;
    const text = lower([order && order.orderStatus, order && order.paymentStatus, order && order.note].map(clean).join(' '));
    if (RETURN_KEYWORDS.some(function (keyword) { return text.includes(keyword); })) return 'return-candidate';
    if (CANCEL_KEYWORDS.some(function (keyword) { return text.includes(keyword); })) return 'cancelled';
    return 'active';
  }

  function orderSkipsInventory(order) {
    return !!order && (order.historicalImport === true || order.inventorySkipped === true || lower(order.inventoryEffect) === 'none');
  }

  function orderHasFulfillmentEvidence(order) {
    if (!order) return false;
    if (dateFrom(order.shippedAt) || dateFrom(order.completedAt)) return true;
    const text = lower([order.orderStatus, order.paymentStatus, order.note].map(clean).join(' '));
    return FULFILLMENT_KEYWORDS.some(function (keyword) { return text.includes(keyword); });
  }

  function orderCanApplyInventory(order) {
    if (!order) return false;
    if (orderSkipsInventory(order)) return false;
    if (order.validSale === false) return false;
    const lifecycle = orderLifecycle(order);
    if (lifecycle && lifecycle !== 'active') return false;
    const quantity = Math.round(Number(order.quantity || 0));
    return Number.isFinite(quantity) && quantity > 0;
  }

  return {normalizeCostLayers:normalizeCostLayers,productFallbackUnitCost:productFallbackUnitCost,materializeCostLayers:materializeCostLayers,consumeFifoAllowNegative:consumeFifoAllowNegative,platformMappingPatch:platformMappingPatch,mergePlatformMappings:mergePlatformMappings,orderLifecycle:orderLifecycle,orderSkipsInventory:orderSkipsInventory,orderHasFulfillmentEvidence:orderHasFulfillmentEvidence,orderCanApplyInventory:orderCanApplyInventory};
});
