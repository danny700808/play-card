(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.OperationsPlatformOrderAnomaliesUtilsV1=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const VERSION='2026.08.05-platform-order-anomaly-recheck-v1';
  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function lower(value) {
    return clean(value).toLowerCase();
  }

  function normalizeSku(value) {
    return clean(value)
      .replace(/^'+/, '')
      .replace(/\u00a0/g, ' ')
      .trim()
      .toUpperCase();
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || clean(value) === '') return null;
    if (typeof value === 'object') {
      if (value.units !== undefined) {
        const units = Number(value.units);
        const nanos = Number(value.nanos || 0);
        if (Number.isFinite(units) && Number.isFinite(nanos)) return units + nanos / 1000000000;
      }
      for (const key of ['amount', 'value', 'price', 'total', 'quantity']) {
        if (value[key] !== undefined) return numberOrNull(value[key]);
      }
    }
    const parsed = Number(String(value).replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function firstValue(object, keys) {
    if (!object || typeof object !== 'object') return '';
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(object, key) && clean(object[key]) !== '') return object[key];
    }
    return '';
  }

  function escapeHtml(value) {
    return clean(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function attr(value) {
    return escapeHtml(value);
  }

  function hashText(value) {
    const text = clean(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function dateFrom(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === 'function') {
      const converted = value.toDate();
      return Number.isNaN(converted.getTime()) ? null : converted;
    }
    if (value.seconds != null) {
      const converted = new Date(Number(value.seconds) * 1000);
      return Number.isNaN(converted.getTime()) ? null : converted;
    }
    const converted = new Date(value);
    return Number.isNaN(converted.getTime()) ? null : converted;
  }

  function dateTimeText(value) {
    const date = dateFrom(value);
    if (!date) return '尚無時間';
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }

  function money(value) {
    const number = Number(value || 0);
    return 'NT$ ' + number.toLocaleString('zh-TW', {
      minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
      maximumFractionDigits: 2
    });
  }

  function formatNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toLocaleString('zh-TW') : '0';
  }

  function productIdOf(product) {
    return clean(product && (product.id || product.docId || product.__id));
  }

  function productSkuOf(product) {
    const raw = product && product.raw && typeof product.raw === 'object' ? product.raw : product || {};
    return normalizeSku(firstValue(raw, ['internalSku', 'sku', 'code', 'productCode', '商品編號']));
  }

  function productNameOf(product) {
    const raw = product && product.raw && typeof product.raw === 'object' ? product.raw : product || {};
    return clean(firstValue(raw, ['internalName', 'originalName', 'name', 'productName', '商品名稱'])) || productIdOf(product) || '未命名商品';
  }

  return {VERSION:VERSION,clean:clean,lower:lower,normalizeSku:normalizeSku,numberOrNull:numberOrNull,firstValue:firstValue,escapeHtml:escapeHtml,attr:attr,hashText:hashText,dateFrom:dateFrom,dateTimeText:dateTimeText,money:money,formatNumber:formatNumber,productIdOf:productIdOf,productSkuOf:productSkuOf,productNameOf:productNameOf};
});
