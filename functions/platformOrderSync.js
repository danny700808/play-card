'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

const EASYSTORE_ACCESS_TOKEN = defineSecret('EASYSTORE_ACCESS_TOKEN');
const MOMO_API_TOKEN = defineSecret('MOMO_API_TOKEN');
const COUPANG_VENDOR_ID = defineSecret('COUPANG_VENDOR_ID');
const COUPANG_ACCESS_KEY = defineSecret('COUPANG_ACCESS_KEY');
const COUPANG_SECRET_KEY = defineSecret('COUPANG_SECRET_KEY');

const REGION = 'us-central1';
const TIME_ZONE = 'Asia/Taipei';
const EASYSTORE_URL = 'https://www.mingtinghuang.com';
const EASYSTORE_API_BASE = '/api/3.0';
const MOMO_ORDER_URL = 'https://api3p.momo.com.tw/VendorApi/OrderQuery';
const MOMO_PRODUCT_URL = 'https://api3p.momo.com.tw/VendorApi/GoodsQueryByMethod';
const MOMO_STOCK_URL = 'https://api3p.momo.com.tw/VendorApi/GoodsStockModify';
const COUPANG_HOST = 'https://api-gateway.coupang.com';
const VERSION = '2026.07.14-platform-order-normal-deduct-v4';
const LOCK_MS = 20 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 4;
const DEFAULT_NET_RATE = 0.87;
const ORDER_COLLECTION = 'opsPlatformOrders';
const RUN_COLLECTION = 'opsPlatformSyncRuns';
const PRODUCT_COLLECTION = 'opsInternalProducts';
const INVENTORY_COLLECTION = 'opsInventoryTransactions';
const SETTINGS_COLLECTION = 'opsSettings';
const RUNTIME_DOC = 'platformOrderSyncRuntime';
const SETTINGS_DOC = 'platformOrderSync';
const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);

function clean(value) {
  return String(value == null ? '' : value).trim();
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

function deepValue(object, path) {
  let cursor = object;
  for (const part of path) {
    if (!cursor || typeof cursor !== 'object') return '';
    cursor = cursor[part];
  }
  return cursor;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractOrders(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['orders', 'data', 'items', 'results', 'result', 'list', 'listOrder']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.data && typeof payload.data === 'object') {
    for (const key of ['orders', 'items', 'results', 'result', 'list', 'listOrder']) {
      if (Array.isArray(payload.data[key])) return payload.data[key];
    }
  }
  return [];
}

function extractLineItems(order) {
  if (!order || typeof order !== 'object') return [];
  for (const key of ['line_items', 'lineItems', 'items', 'orderItems', 'listItem', 'details', 'products']) {
    if (Array.isArray(order[key])) return order[key];
  }
  return [];
}

function stableId(value, length = 40) {
  return crypto.createHash('sha256').update(clean(value)).digest('hex').slice(0, length);
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof value.toDate === 'function') return value.toDate();
  const raw = clean(value);
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + '+08:00' : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDay(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTaiwanDayForCoupang(date) {
  return `${isoDay(date)}+08:00`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}, label = 'API', retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      let data = {};
      if (text.trim()) {
        try {
          data = JSON.parse(text);
        } catch (_) {
          throw new Error(`${label} HTTP ${response.status} 回傳不是 JSON：${text.slice(0, 600)}`);
        }
      }
      if (!response.ok) {
        const message = clean(data.errorMessage || data.message || text).slice(0, 800);
        throw new Error(`${label} HTTP ${response.status}：${message}`);
      }
      if (data && clean(data.errorMessage)) throw new Error(`${label}：${clean(data.errorMessage).slice(0, 800)}`);
      return data;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await sleep(Math.min(8000, 800 * (2 ** attempt)));
    }
  }
  throw lastError || new Error(`${label} 無法連線`);
}

const RETURN_REVIEW_KEYWORDS = [
  '退貨', '退款', '已退貨', '已退款', '退訂',
  'refund', 'refunded', 'return', 'returned', 'restocked'
];

const CANCELLED_ORDER_KEYWORDS = [
  '取消', '客戶取消', '買家取消', '賣家取消', '已取消', '取消完成',
  '作廢', '已作廢', '無效', '未成立', '交易失敗', '付款失敗', '未付款', '付款逾期', '逾期未付',
  'cancel', 'canceled', 'cancelled', 'cancellation', 'void', 'voided',
  'failed', 'failure', 'expired', 'unpaid', 'payment failed'
];

function orderLifecycle(line) {
  const text = [line.orderStatus, line.paymentStatus, line.note]
    .map((value) => clean(value).toLowerCase()).join(' ');
  if (RETURN_REVIEW_KEYWORDS.some((keyword) => text.includes(keyword))) return 'return-review';
  if (CANCELLED_ORDER_KEYWORDS.some((keyword) => text.includes(keyword))) return 'cancelled';
  const quantity = Math.round(Number(line.quantity || 0));
  const gross = Number(line.grossAmount || 0);
  if ((!Number.isFinite(quantity) || quantity <= 0) && (!Number.isFinite(gross) || gross <= 0)) return 'cancelled';
  return 'active';
}

function isFreightLine(line) {
  if (line.platform !== 'MOMO') return false;
  const text = [line.sku, line.productName, line.variantName, line.note].map((value) => clean(value).toLowerCase()).join(' ');
  return ['運費', '物流費', '配送費', '宅配費', '超取費', 'shipping', 'freight', 'delivery fee']
    .some((keyword) => text.includes(keyword));
}

function validLine(line) {
  const quantity = Math.round(Number(line.quantity || 0));
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (orderLifecycle(line) !== 'active' || isFreightLine(line)) return false;
  return true;
}

function lineKey(line) {
  return stableId([
    line.platform,
    line.externalOrderId || line.externalOrderNo,
    line.externalLineId || line.sku || 'line'
  ].join('|'));
}

function normalizeLine(base) {
  const quantity = Math.max(0, Math.round(Number(base.quantity || 0)));
  const unitPrice = Math.max(0, Number(base.unitPrice || 0));
  const grossAmount = Math.max(0, Number(base.grossAmount != null ? base.grossAmount : unitPrice * quantity));
  const orderedAt = parseDate(base.orderedAt) || new Date();
  const line = {
    platform: clean(base.platform),
    externalOrderId: clean(base.externalOrderId || base.externalOrderNo),
    externalOrderNo: clean(base.externalOrderNo || base.externalOrderId),
    externalLineId: clean(base.externalLineId),
    orderedAt,
    statusUpdatedAt: parseDate(base.statusUpdatedAt) || null,
    sku: normalizeSku(base.sku),
    productName: clean(base.productName),
    variantName: clean(base.variantName),
    quantity,
    unitPrice,
    grossAmount,
    currency: clean(base.currency) || 'TWD',
    orderStatus: clean(base.orderStatus),
    paymentStatus: clean(base.paymentStatus),
    customerName: clean(base.customerName),
    note: clean(base.note),
    platformIds: base.platformIds && typeof base.platformIds === 'object' ? base.platformIds : {}
  };
  line.lifecycle = isFreightLine(line) ? 'freight' : orderLifecycle(line);
  line.validSale = validLine(line);
  line.id = lineKey(line);
  return line;
}

async function fetchEasyStoreOrders(start, end, token) {
  if (!clean(token)) throw new Error('EasyStore Access Token 尚未設定');
  const lines = [];
  const seen = new Set();
  for (let page = 1; page <= 50; page += 1) {
    const params = new URLSearchParams({
      page: String(page),
      limit: '100',
      created_at_min: start.toISOString(),
      created_at_max: end.toISOString()
    });
    const url = `${EASYSTORE_URL}${EASYSTORE_API_BASE}/orders.json?${params.toString()}`;
    const payload = await fetchJson(url, {
      method: 'GET',
      headers: {
        'EasyStore-Access-Token': token,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    }, 'EasyStore 訂單');
    const orders = extractOrders(payload);
    if (!orders.length) break;
    let added = 0;
    for (const order of orders) {
      const orderId = clean(firstValue(order, ['id', 'order_id', 'number', 'order_number', 'name']));
      if (!orderId || seen.has(orderId)) continue;
      seen.add(orderId);
      added += 1;
      const orderNo = clean(firstValue(order, ['number', 'order_number', 'name', 'ref', 'reference'])) || orderId;
      const orderedAt = firstValue(order, ['created_at', 'created_on', 'createdAt', 'order_date', 'date', 'updated_at']);
      const orderStatus = firstValue(order, ['status', 'order_status', 'fulfillment_status']);
      const paymentStatus = firstValue(order, ['financial_status', 'payment_status', 'paid_status']);
      const customerName = clean([
        deepValue(order, ['customer', 'first_name']),
        deepValue(order, ['customer', 'last_name'])
      ].filter(Boolean).join(' ')) || clean(firstValue(order, ['customer_name', 'buyer_name']));
      const items = extractLineItems(order);
      items.forEach((item, index) => {
        const product = item.product && typeof item.product === 'object' ? item.product : {};
        const variant = item.variant && typeof item.variant === 'object' ? item.variant : {};
        const quantity = numberOrNull(firstValue(item, ['quantity', 'qty', 'fulfillable_quantity'])) || 0;
        const unitPrice = numberOrNull(firstValue(item, ['price', 'unit_price', 'selling_price', 'final_price'])) || 0;
        const subtotal = numberOrNull(firstValue(item, ['subtotal', 'total', 'line_price', 'total_price']));
        lines.push(normalizeLine({
          platform: 'EasyStore',
          externalOrderId: orderId,
          externalOrderNo: orderNo,
          externalLineId: firstValue(item, ['id', 'line_item_id', 'item_id']) || `${index + 1}`,
          orderedAt,
          sku: firstValue(item, ['sku', 'code', 'product_sku', 'variant_sku']) || firstValue(variant, ['sku', 'code']) || firstValue(product, ['sku', 'code']),
          productName: firstValue(item, ['title', 'name', 'product_title', 'product_name']) || firstValue(product, ['title', 'name']),
          variantName: firstValue(item, ['variant_title', 'variant_name', 'option', 'option_name']) || firstValue(variant, ['title', 'name']),
          quantity,
          unitPrice,
          grossAmount: subtotal == null ? quantity * unitPrice : subtotal,
          currency: firstValue(order, ['currency', 'currency_code']) || 'TWD',
          orderStatus,
          paymentStatus,
          customerName,
          platformIds: {
            productId: clean(firstValue(item, ['product_id', 'productId']) || firstValue(product, ['id', 'product_id'])),
            variantId: clean(firstValue(item, ['variant_id', 'variantId']) || firstValue(variant, ['id', 'variant_id']))
          }
        }));
      });
    }
    if (orders.length < 100 || added === 0) break;
    await sleep(120);
  }
  return lines;
}

function momoHeaders(token) {
  return {
    Authorization: `Bearer ${clean(token).replace(/^Bearer\s+/i, '')}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  };
}

async function momoPost(url, token, body, label) {
  if (!clean(token)) throw new Error('MOMO API Token 尚未設定');
  return fetchJson(url, {
    method: 'POST',
    headers: momoHeaders(token),
    body: JSON.stringify(body)
  }, label || 'MOMO API');
}

async function fetchMomoOrders(start, end, token) {
  const lines = [];
  for (let page = 1; page <= 30; page += 1) {
    const body = {
      queryDateType: 'OrderDate',
      fromDate: isoDay(start),
      toDate: isoDay(end),
      deliveryType: 'All',
      storeDeliveryType: 'All',
      orderStatus: 'All',
      pageIndex: page,
      maxPerPage: 100
    };
    const payload = await momoPost(MOMO_ORDER_URL, token, body, 'MOMO 訂單');
    const orders = extractOrders(payload);
    if (!orders.length) break;
    for (const order of orders) {
      const orderId = clean(firstValue(order, ['orderNo', 'orderCode', 'orderId', 'id']));
      let items = extractLineItems(order);
      if (!items.length && ['goodsNo', 'goodsCode', 'goodsdtCode', 'entpGoodsNo', 'goodsName'].some((key) => order[key] !== undefined)) items = [order];
      items.forEach((item, index) => {
        const quantity = numberOrNull(firstValue(item, ['quantity', 'qty', 'orderQty', 'salesQty'])) || 0;
        const subtotal = numberOrNull(firstValue(item, ['orderAmount', 'totalPrice', 'subtotal', 'amount']));
        const unitPrice = numberOrNull(firstValue(item, ['price', 'salePrice', 'unitPrice'])) || (quantity > 0 && subtotal != null ? subtotal / quantity : 0);
        const goodsCode = clean(firstValue(item, ['goodsNo', 'goodsCode', 'productCode']));
        const goodsdtCode = clean(firstValue(item, ['goodsdtCode']));
        const entpGoodsNo = clean(firstValue(item, ['entpGoodsNo', 'sku']));
        lines.push(normalizeLine({
          platform: 'MOMO',
          externalOrderId: orderId,
          externalOrderNo: orderId,
          externalLineId: firstValue(item, ['orderSeq', 'orderDtlNo', 'lineId']) || `${goodsCode}|${goodsdtCode}|${index + 1}`,
          orderedAt: firstValue(item, ['orderDate', 'lastProcDate', 'planShipDate', 'shipDate']) || firstValue(order, ['orderDate', 'orderTime', 'createdAt', 'date']),
          sku: entpGoodsNo || (goodsCode && goodsdtCode ? `${goodsCode}-${goodsdtCode}` : goodsCode || goodsdtCode),
          productName: firstValue(item, ['goodsName', 'productName', 'name']),
          variantName: [firstValue(item, ['goodsInfo1', 'goodsdtInfo', 'optionName', 'specName']), firstValue(item, ['goodsInfo2'])].filter(Boolean).join(' / '),
          quantity,
          unitPrice,
          grossAmount: subtotal == null ? quantity * unitPrice : subtotal,
          currency: 'TWD',
          orderStatus: firstValue(item, ['itemStatus', 'shipStatus']) || firstValue(order, ['orderStatus', 'status']),
          paymentStatus: '',
          customerName: firstValue(item, ['customerName', 'receiverName']) || firstValue(order, ['customerName', 'buyerName', 'memberName']),
          note: firstValue(item, ['customerDeliveryMessage', 'storeReturnMessage', 'returnReason']),
          platformIds: { goodsCode, goodsdtCode, entpGoodsNo }
        }));
      });
    }
    if (orders.length < 100) break;
    await sleep(120);
  }
  return lines;
}

function coupangSignedDate() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').slice(2);
}

function coupangAuth(method, path, query, accessKey, secretKey) {
  const signedDate = coupangSignedDate();
  const message = signedDate + method.toUpperCase() + path + (query || '');
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`;
}

async function coupangRequest(config, method, path, queryParams, body, label) {
  const params = new URLSearchParams();
  Object.entries(queryParams || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
  });
  const query = params.toString();
  const url = COUPANG_HOST + path + (query ? `?${query}` : '');
  return fetchJson(url, {
    method,
    headers: {
      Authorization: coupangAuth(method, path, query, config.accessKey, config.secretKey),
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
      'X-EXTENDED-TIMEOUT': '90000',
      'X-MARKET': 'TW',
      'X-Requested-By': config.vendorId
    },
    body: body == null ? undefined : JSON.stringify(body)
  }, label || 'Coupang API');
}

function coupangOrders(payload) {
  if (Array.isArray(payload)) return { rows: payload, nextToken: '' };
  if (!payload || typeof payload !== 'object') return { rows: [], nextToken: '' };
  const data = payload.data;
  if (Array.isArray(data)) return { rows: data, nextToken: clean(payload.nextToken || payload.nextPageToken) };
  if (data && typeof data === 'object') {
    for (const key of ['orders', 'items', 'results']) {
      if (Array.isArray(data[key])) return { rows: data[key], nextToken: clean(data.nextToken || payload.nextToken) };
    }
  }
  return { rows: extractOrders(payload), nextToken: clean(payload.nextToken) };
}

async function fetchCoupangOrders(start, end, config) {
  if (![config.vendorId, config.accessKey, config.secretKey].every(clean)) throw new Error('Coupang API 憑證尚未設定完整');
  const statuses = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY', 'NONE_TRACKING'];
  const path = `/v2/providers/openapi/apis/api/v5/vendors/${encodeURIComponent(config.vendorId)}/ordersheets`;
  const all = [];
  const seen = new Set();
  for (const status of statuses) {
    let nextToken = '';
    for (let page = 1; page <= 30; page += 1) {
      const payload = await coupangRequest(config, 'GET', path, {
        createdAtFrom: formatTaiwanDayForCoupang(start),
        createdAtTo: formatTaiwanDayForCoupang(end),
        status,
        isCod: '',
        maxPerPage: 50,
        nextToken
      }, null, 'Coupang 訂單');
      const parsed = coupangOrders(payload);
      if (!parsed.rows.length) break;
      for (const order of parsed.rows) {
        const marker = clean(firstValue(order, ['shipmentBoxId', 'orderId', 'id'])) || stableId(JSON.stringify(order), 24);
        if (seen.has(marker)) continue;
        seen.add(marker);
        all.push(order);
      }
      if (!parsed.nextToken || parsed.nextToken === nextToken) break;
      nextToken = parsed.nextToken;
      await sleep(120);
    }
  }
  const lines = [];
  for (const order of all) {
    const orderId = clean(firstValue(order, ['orderId', 'id']) || firstValue(order, ['shipmentBoxId']));
    const shipmentBoxId = clean(firstValue(order, ['shipmentBoxId']));
    const items = Array.isArray(order.orderItems) ? order.orderItems : extractLineItems(order);
    items.forEach((item, index) => {
      const quantity = numberOrNull(firstValue(item, ['shippingCount', 'quantity', 'qty'])) || 0;
      const unitPrice = numberOrNull(firstValue(item, ['salesPrice', 'salePrice', 'price'])) || 0;
      const subtotal = numberOrNull(firstValue(item, ['orderPrice', 'totalPrice', 'subtotal']));
      const vendorItemId = clean(firstValue(item, ['vendorItemId', 'vendoritemid']));
      lines.push(normalizeLine({
        platform: 'Coupang',
        externalOrderId: orderId || shipmentBoxId,
        externalOrderNo: orderId || shipmentBoxId,
        externalLineId: vendorItemId || `${index + 1}`,
        orderedAt: firstValue(order, ['paidAt', 'orderedAt', 'createdAt', 'order_date']),
        sku: firstValue(item, ['externalVendorSkuCode', 'externalVendorSku', 'externalVendorSKU', 'sellerProductItemCode', 'sellerProductCode']) || vendorItemId,
        productName: firstValue(item, ['sellerProductName', 'vendorItemName', 'productName', 'name']),
        variantName: firstValue(item, ['sellerProductItemName', 'vendorItemPackageName', 'itemName', 'optionName']),
        quantity,
        unitPrice,
        grossAmount: subtotal == null ? quantity * unitPrice : subtotal,
        currency: 'TWD',
        orderStatus: firstValue(order, ['status', 'order_status']),
        paymentStatus: firstValue(order, ['status']),
        customerName: deepValue(order, ['orderer', 'name']) || deepValue(order, ['receiver', 'name']),
        platformIds: { vendorItemId, shipmentBoxId }
      }));
    });
  }
  return lines;
}

function normalizeCostLayers(value) {
  return asArray(value).map((layer, index) => {
    const quantity = Math.max(0, Number(firstValue(layer || {}, ['qtyRemaining', 'remainingQty', 'qty', 'quantity']) || 0));
    const unitCost = numberOrNull(firstValue(layer || {}, ['unitCost', 'cost', 'purchasePrice']));
    return {
      layerId: clean(firstValue(layer || {}, ['layerId', 'id'])) || `L${index}`,
      qtyRemaining: quantity,
      originalQty: Math.max(quantity, Number(firstValue(layer || {}, ['originalQty', 'qty', 'quantity']) || quantity)),
      unitCost,
      costKnown: layer && layer.costKnown !== false && unitCost != null,
      receivedAt: firstValue(layer || {}, ['receivedAt', 'date', 'createdAt']) || '1970-01-01T00:00:00.000Z',
      referenceType: clean(firstValue(layer || {}, ['referenceType', 'source'])) || 'unknown',
      referenceId: clean(firstValue(layer || {}, ['referenceId', 'sourceId']))
    };
  }).filter((layer) => layer.qtyRemaining > 0).sort((a, b) => {
    const da = parseDate(a.receivedAt) || new Date(0);
    const db = parseDate(b.receivedAt) || new Date(0);
    return da - db;
  });
}

function materializeCostLayers(raw) {
  const current = Math.max(0, Number(raw.currentStock || 0));
  const layers = normalizeCostLayers(raw.costLayers);
  let tracked = layers.reduce((total, layer) => total + layer.qtyRemaining, 0);
  if (tracked < current) {
    const fallback = numberOrNull(firstValue(raw, ['averageCost', 'latestPurchaseCost', 'purchasePrice']));
    layers.push({
      layerId: `fallback_${stableId(`${current}|${fallback}`, 16)}`,
      qtyRemaining: current - tracked,
      originalQty: current - tracked,
      unitCost: fallback,
      costKnown: fallback != null,
      receivedAt: '1970-01-01T00:00:00.000Z',
      referenceType: 'fallback',
      referenceId: 'LEGACY'
    });
    tracked = current;
  }
  if (tracked > current) {
    let extra = tracked - current;
    for (let index = layers.length - 1; index >= 0 && extra > 0; index -= 1) {
      const take = Math.min(extra, layers[index].qtyRemaining);
      layers[index].qtyRemaining -= take;
      extra -= take;
    }
  }
  return layers.filter((layer) => layer.qtyRemaining > 0);
}

function consumeFifoAllowNegative(raw, quantity) {
  const before = Number(raw.currentStock || 0);
  const positiveAvailable = Math.max(0, before);
  const requested = Math.max(0, Math.round(Number(quantity || 0)));
  const costableQuantity = Math.min(requested, positiveAvailable);
  const layers = materializeCostLayers(raw);
  let remaining = costableQuantity;
  let costTotal = 0;
  let unknownCostQty = Math.max(0, requested - costableQuantity);
  const breakdown = [];
  for (const layer of layers) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, layer.qtyRemaining);
    if (take <= 0) continue;
    if (layer.unitCost == null) unknownCostQty += take;
    else costTotal += take * layer.unitCost;
    breakdown.push({ layerId: layer.layerId, qty: take, unitCost: layer.unitCost, referenceId: layer.referenceId });
    layer.qtyRemaining -= take;
    remaining -= take;
  }
  if (remaining > 0) unknownCostQty += remaining;
  const left = before - requested <= 0 ? [] : layers.filter((layer) => layer.qtyRemaining > 0);
  const knownValue = left.reduce((total, layer) => total + (layer.unitCost == null ? 0 : layer.qtyRemaining * layer.unitCost), 0);
  const knownQty = left.reduce((total, layer) => total + (layer.unitCost == null ? 0 : layer.qtyRemaining), 0);
  const totalQty = left.reduce((total, layer) => total + layer.qtyRemaining, 0);
  return {
    before,
    after: before - requested,
    costTotal,
    unknownCostQty,
    breakdown,
    layers: left,
    averageCost: totalQty > 0 && knownQty === totalQty ? knownValue / totalQty : null,
    inventoryValue: knownValue,
    costIncomplete: unknownCostQty > 0 || totalQty > knownQty
  };
}

async function readSettings(db) {
  const snap = await db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC).get();
  const raw = snap.exists ? snap.data() || {} : {};
  return {
    enabled: raw.enabled !== false,
    applyInventory: raw.applyInventory !== false,
    officialInventoryStartAt: parseDate(raw.officialInventoryStartAt),
    lookbackDays: Math.min(30, Math.max(1, Number(raw.lookbackDays || DEFAULT_LOOKBACK_DAYS))),
    estimatedNetRate: Math.min(1, Math.max(0, Number(raw.estimatedNetRate || DEFAULT_NET_RATE))),
    initializeBaselineOnFirstRun: raw.initializeBaselineOnFirstRun !== false,
    missingBeforeReverse: Math.min(5, Math.max(1, Number(raw.missingBeforeReverse || 2))),
    platforms: {
      EasyStore: !(raw.platforms && raw.platforms.EasyStore === false),
      MOMO: !(raw.platforms && raw.platforms.MOMO === false),
      Coupang: !(raw.platforms && raw.platforms.Coupang === false)
    }
  };
}

async function ensureOfficialInventoryMode(db) {
  const ref = db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const raw = snap.exists ? snap.data() || {} : {};
    const patch = {};
    if (raw.applyInventory !== true) patch.applyInventory = true;
    if (raw.backfillUnappliedValidOrders !== true) patch.backfillUnappliedValidOrders = true;
    if (!parseDate(raw.officialInventoryStartAt)) {
      patch.officialInventoryStartAt = admin.firestore.FieldValue.serverTimestamp();
    }
    if (Object.keys(patch).length) {
      patch.officialInventoryModeEnabledAt = admin.firestore.FieldValue.serverTimestamp();
      patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      patch.updatedBy = 'platform-order-sync-normal-deduct-migration';
      patch.version = VERSION;
      transaction.set(ref, patch, { merge: true });
    }
    return true;
  });
}

async function acquireLock(db, trigger) {
  const ref = db.collection(SETTINGS_COLLECTION).doc(RUNTIME_DOC);
  const now = Date.now();
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const row = snap.exists ? snap.data() || {} : {};
    const lockedUntil = row.lockedUntil && typeof row.lockedUntil.toMillis === 'function' ? row.lockedUntil.toMillis() : Number(row.lockedUntilMs || 0);
    if (lockedUntil > now) throw new Error('平台訂單同步正在執行，請稍後再試。');
    const runId = `RUN-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${stableId(`${now}|${trigger}`, 6)}`;
    transaction.set(ref, {
      lockedUntil: admin.firestore.Timestamp.fromMillis(now + LOCK_MS),
      lockedUntilMs: now + LOCK_MS,
      currentRunId: runId,
      currentTrigger: trigger,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      version: VERSION
    }, { merge: true });
    return { ref, runId };
  });
}

async function releaseLock(lock, result) {
  await lock.ref.set({
    lockedUntil: admin.firestore.Timestamp.fromMillis(0),
    lockedUntilMs: 0,
    currentRunId: admin.firestore.FieldValue.delete(),
    lastRunId: lock.runId,
    lastStatus: result.status,
    lastSummary: result.summary || {},
    lastFinishedAt: admin.firestore.FieldValue.serverTimestamp(),
    version: VERSION
  }, { merge: true });
}

async function loadProducts(db) {
  const snap = await db.collection(PRODUCT_COLLECTION).get();
  const products = [];
  snap.forEach((doc) => {
    const raw = doc.data() || {};
    if (raw.enabled === false) return;
    products.push({ id: doc.id, ref: doc.ref, raw, sku: normalizeSku(raw.internalSku || raw.sku || raw.code || raw.productCode) });
  });
  return products;
}

function buildProductMap(products) {
  const map = new Map();
  for (const product of products) {
    if (!product.sku) continue;
    if (!map.has(product.sku)) map.set(product.sku, []);
    map.get(product.sku).push(product);
  }
  return map;
}

function platformMappingPatch(line) {
  if (line.platform === 'EasyStore') {
    const productId = clean(line.platformIds.productId);
    const variantIds = [clean(line.platformIds.variantId)].filter(Boolean);
    if (!productId && !variantIds.length) return {};
    const value = {};
    if (productId) value.productId = productId;
    if (variantIds.length) value.variantIds = variantIds;
    return { easyStore: value };
  }
  if (line.platform === 'MOMO') {
    const value = {};
    const goodsCode = clean(line.platformIds.goodsCode);
    const goodsdtCode = clean(line.platformIds.goodsdtCode);
    const entpGoodsNo = clean(line.platformIds.entpGoodsNo);
    if (goodsCode) value.goodsCode = goodsCode;
    if (goodsdtCode) value.goodsdtCode = goodsdtCode;
    if (entpGoodsNo) value.entpGoodsNo = entpGoodsNo;
    return Object.keys(value).length ? { momo: value } : {};
  }
  if (line.platform === 'Coupang') {
    return {
      coupang: {
        vendorItemIds: [clean(line.platformIds.vendorItemId)].filter(Boolean)
      }
    };
  }
  return {};
}

function mergePlatformMappings(existing, patch) {
  const result = Object.assign({}, existing || {});
  for (const [platform, value] of Object.entries(patch || {})) {
    const old = result[platform] && typeof result[platform] === 'object' ? result[platform] : {};
    const merged = Object.assign({}, old, value);
    if (platform === 'easyStore') {
      merged.variantIds = [...new Set([...(asArray(old.variantIds)), ...(asArray(value.variantIds))].map(clean).filter(Boolean))];
    }
    if (platform === 'coupang') {
      merged.vendorItemIds = [...new Set([...(asArray(old.vendorItemIds)), ...(asArray(value.vendorItemIds))].map(clean).filter(Boolean))];
    }
    result[platform] = merged;
  }
  return result;
}

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function productFallbackUnitCost(raw) {
  return numberOrNull(firstValue(raw || {}, ['averageCost', 'latestPurchaseCost', 'purchasePrice', 'cost']));
}

function orderCostSnapshot(existing, inventoryRow, productRaw, quantity) {
  const qty = Math.max(0, Number(quantity || 0));
  const existingCost = hasOwn(existing, 'costTotal') && Number.isFinite(Number(existing.costTotal)) ? Number(existing.costTotal || 0) : null;
  const inventoryCost = inventoryRow && hasOwn(inventoryRow, 'costTotal') && Number.isFinite(Number(inventoryRow.costTotal)) ? Number(inventoryRow.costTotal || 0) : null;
  if (existingCost != null && existingCost > 0) {
    return { costTotal: existingCost, estimated: existing.costEstimated === true, source: clean(existing.costSource) || 'order' };
  }
  if (inventoryCost != null && inventoryCost > 0) {
    return { costTotal: inventoryCost, estimated: false, source: 'inventory-transaction' };
  }
  const unit = productFallbackUnitCost(productRaw);
  if (unit != null && qty > 0 && (existingCost == null || existingCost <= 0 || Number(existing.unknownCostQty || 0) > 0 || clean(existing.costSource) === 'unknown')) {
    return { costTotal: unit * qty, estimated: true, source: 'current-product-estimate' };
  }
  if (existingCost != null) return { costTotal: existingCost, estimated: existing.costEstimated === true, source: clean(existing.costSource) || 'order' };
  if (inventoryCost != null) return { costTotal: inventoryCost, estimated: false, source: 'inventory-transaction' };
  if (unit != null && qty > 0) return { costTotal: unit * qty, estimated: true, source: 'current-product-estimate' };
  return { costTotal: 0, estimated: true, source: 'unknown' };
}

function summarizeCostLayers(layers) {
  const usable = asArray(layers).filter((layer) => Number(layer.qtyRemaining || 0) > 0);
  const totalQty = usable.reduce((total, layer) => total + Number(layer.qtyRemaining || 0), 0);
  const knownQty = usable.reduce((total, layer) => total + (layer.unitCost == null ? 0 : Number(layer.qtyRemaining || 0)), 0);
  const knownValue = usable.reduce((total, layer) => total + (layer.unitCost == null ? 0 : Number(layer.qtyRemaining || 0) * Number(layer.unitCost || 0)), 0);
  return {
    layers: usable,
    averageCost: totalQty > 0 && knownQty === totalQty ? knownValue / totalQty : null,
    inventoryValue: knownValue,
    costIncomplete: totalQty > knownQty
  };
}

async function reverseCancelledOrder(db, line, productMap, settings, runId, reason) {
  const orderRef = db.collection(ORDER_COLLECTION).doc(line.id);
  const preSnap = await orderRef.get();
  const pre = preSnap.exists ? preSnap.data() || {} : {};
  if (pre.reversalApplied === true || pre.inventoryReversed === true) {
    await orderRef.set({
      ...line,
      orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
      statusUpdatedAt: line.statusUpdatedAt ? admin.firestore.Timestamp.fromDate(line.statusUpdatedAt) : null,
      processingStatus: 'inventory-reversed',
      inventoryApplied: false,
      reversalApplied: true,
      reversalReason: clean(reason) || clean(pre.reversalReason),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      syncRunId: runId,
      version: VERSION
    }, { merge: true });
    return { status: 'already-reversed', lineId: line.id, productId: clean(pre.productId) };
  }
  if (pre.inventoryApplied !== true) {
    await orderRef.set({
      ...line,
      orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
      statusUpdatedAt: line.statusUpdatedAt ? admin.firestore.Timestamp.fromDate(line.statusUpdatedAt) : null,
      processingStatus: 'ignored-cancelled',
      inventoryApplied: false,
      cancellationReason: clean(reason),
      missingFromPlatformCount: 0,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      firstSeenAt: pre.firstSeenAt || admin.firestore.FieldValue.serverTimestamp(),
      syncRunId: runId,
      version: VERSION
    }, { merge: true });
    return { status: 'cancelled-ignored', lineId: line.id };
  }

  const matchedBySku = line.sku ? (productMap.get(line.sku) || []) : [];
  const productId = clean(pre.productId) || (matchedBySku.length === 1 ? matchedBySku[0].id : '');
  if (!productId) {
    await orderRef.set({
      ...line,
      orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
      processingStatus: 'reversal-error',
      processingError: '訂單已取消，但找不到原中央商品，無法自動回補庫存。',
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      syncRunId: runId,
      version: VERSION
    }, { merge: true });
    return { status: 'reversal-error', lineId: line.id };
  }

  const productRef = db.collection(PRODUCT_COLLECTION).doc(productId);
  const originalInventoryRef = db.collection(INVENTORY_COLLECTION).doc(`online_${line.id}`);
  const reversalInventoryRef = db.collection(INVENTORY_COLLECTION).doc(`online_reversal_${line.id}`);
  return db.runTransaction(async (transaction) => {
    const [orderSnap, productSnap, originalInventorySnap] = await Promise.all([
      transaction.get(orderRef), transaction.get(productRef), transaction.get(originalInventoryRef)
    ]);
    const existing = orderSnap.exists ? orderSnap.data() || {} : {};
    if (existing.reversalApplied === true || existing.inventoryReversed === true) {
      return { status: 'already-reversed', lineId: line.id, productId };
    }
    if (existing.inventoryApplied !== true) {
      transaction.set(orderRef, {
        ...line,
        orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
        processingStatus: 'ignored-cancelled',
        inventoryApplied: false,
        cancellationReason: clean(reason),
        missingFromPlatformCount: 0,
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        syncRunId: runId,
        version: VERSION
      }, { merge: true });
      return { status: 'cancelled-ignored', lineId: line.id };
    }
    if (!productSnap.exists) throw new Error(`取消訂單回補失敗，中央商品不存在：${productId}`);
    const raw = productSnap.data() || {};
    const quantity = Math.max(0, Math.round(Number(existing.quantity || line.quantity || 0)));
    const before = Number(raw.currentStock || 0);
    const after = before + quantity;
    const originalInventory = originalInventorySnap.exists ? originalInventorySnap.data() || {} : {};
    const cost = orderCostSnapshot(existing, originalInventory, raw, quantity);
    const unitCost = quantity > 0 && Number.isFinite(cost.costTotal) ? cost.costTotal / quantity : null;
    const layers = materializeCostLayers(raw);
    const positiveRestored = Math.max(0, after) - Math.max(0, before);
    if (positiveRestored > 0) {
      layers.push({
        layerId: `REV-${line.id}`,
        qtyRemaining: positiveRestored,
        originalQty: positiveRestored,
        unitCost,
        costKnown: unitCost != null,
        receivedAt: existing.orderedAt || line.orderedAt || new Date(),
        referenceType: 'onlineCancellationReversal',
        referenceId: clean(line.externalOrderNo || existing.externalOrderNo)
      });
    }
    const layerSummary = summarizeCostLayers(layers);
    transaction.set(productRef, {
      currentStock: after,
      costLayers: layerSummary.layers,
      averageCost: layerSummary.averageCost,
      inventoryValue: layerSummary.inventoryValue,
      costIncomplete: layerSummary.costIncomplete,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'platform-order-reconcile',
      version: VERSION
    }, { merge: true });
    transaction.set(orderRef, {
      ...line,
      orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
      statusUpdatedAt: line.statusUpdatedAt ? admin.firestore.Timestamp.fromDate(line.statusUpdatedAt) : null,
      productId,
      inventoryApplied: false,
      inventoryReversed: true,
      reversalApplied: true,
      reversalReason: clean(reason),
      reversalQuantity: quantity,
      reversalCostTotal: cost.costTotal,
      reversalCostEstimated: cost.estimated,
      inventoryBeforeReversal: before,
      inventoryAfterReversal: after,
      processingStatus: 'inventory-reversed',
      processingError: '',
      missingFromPlatformCount: 0,
      reversedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      syncRunId: runId,
      version: VERSION
    }, { merge: true });
    transaction.set(reversalInventoryRef, {
      type: 'onlineCancellationReversal',
      platform: clean(line.platform || existing.platform),
      productId,
      productName: clean(raw.internalName || raw.originalName || line.productName || existing.productName),
      sku: normalizeSku(line.sku || existing.sku),
      qtyChange: quantity,
      beforeStock: before,
      afterStock: after,
      unitCost,
      costTotal: cost.costTotal,
      costEstimated: cost.estimated,
      costMethod: 'ORIGINAL_ORDER_OR_ESTIMATE',
      referenceType: 'platformOrderCancellation',
      referenceId: clean(line.externalOrderNo || existing.externalOrderNo),
      orderLineId: line.id,
      note: clean(reason) || '平台訂單取消／未付款，自動回補庫存',
      occurredAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'platform-order-reconcile',
      version: VERSION
    }, { merge: true });
    return { status: 'reversed', lineId: line.id, productId, before, after };
  });
}

async function applyOrderLine(db, line, productMap, settings, runId) {
  const orderRef = db.collection(ORDER_COLLECTION).doc(line.id);
  const lifecycle = line.lifecycle || orderLifecycle(line);
  if (lifecycle === 'freight') {
    const existingSnap = await orderRef.get();
    const existing = existingSnap.exists ? existingSnap.data() || {} : {};
    await orderRef.set({
      ...line,
      orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
      processingStatus: 'ignored-freight',
      inventoryApplied: existing.inventoryApplied === true,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      firstSeenAt: existing.firstSeenAt || admin.firestore.FieldValue.serverTimestamp(),
      syncRunId: runId,
      version: VERSION
    }, { merge: true });
    return { status: 'ignored', lineId: line.id };
  }
  if (lifecycle === 'return-review') {
    const existingSnap = await orderRef.get();
    const existing = existingSnap.exists ? existingSnap.data() || {} : {};
    await orderRef.set({
      ...line,
      orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
      statusUpdatedAt: line.statusUpdatedAt ? admin.firestore.Timestamp.fromDate(line.statusUpdatedAt) : null,
      processingStatus: existing.inventoryApplied === true ? 'manual-return-review' : 'ignored-return',
      inventoryApplied: existing.inventoryApplied === true,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      firstSeenAt: existing.firstSeenAt || admin.firestore.FieldValue.serverTimestamp(),
      syncRunId: runId,
      version: VERSION
    }, { merge: true });
    return { status: existing.inventoryApplied === true ? 'return-review' : 'ignored', lineId: line.id, productId: clean(existing.productId) };
  }
  if (lifecycle === 'cancelled' || !line.validSale) {
    return reverseCancelledOrder(db, line, productMap, settings, runId, clean(line.orderStatus || line.paymentStatus || line.note) || '平台顯示取消／未付款');
  }
  if (!line.sku) {
    await orderRef.set({
      ...line,
      orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
      processingStatus: 'missing-sku',
      inventoryApplied: false,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      firstSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      syncRunId: runId,
      version: VERSION
    }, { merge: true });
    return { status: 'missing-sku', lineId: line.id };
  }
  const matches = productMap.get(line.sku) || [];
  if (matches.length !== 1) {
    await orderRef.set({
      ...line,
      orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
      processingStatus: matches.length > 1 ? 'duplicate-sku' : 'unmatched-sku',
      inventoryApplied: false,
      matchCount: matches.length,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      firstSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      syncRunId: runId,
      version: VERSION
    }, { merge: true });
    return { status: matches.length > 1 ? 'duplicate-sku' : 'unmatched-sku', lineId: line.id };
  }
  const product = matches[0];
  const inventoryRef = db.collection(INVENTORY_COLLECTION).doc(`online_${line.id}`);
  const grossAmount = Math.max(0, Number(line.grossAmount || (line.unitPrice * line.quantity) || 0));
  const estimatedNetAmount = Math.round(grossAmount * settings.estimatedNetRate);
  return db.runTransaction(async (transaction) => {
    const [orderSnap, productSnap, inventorySnap] = await Promise.all([
      transaction.get(orderRef), transaction.get(product.ref), transaction.get(inventoryRef)
    ]);
    const existing = orderSnap.exists ? orderSnap.data() || {} : {};
    const raw = productSnap.exists ? productSnap.data() || {} : {};
    const previousInventory = inventorySnap.exists ? inventorySnap.data() || {} : {};
    // 所有目前仍有效、且尚未扣過中央庫存的訂單，都按正式訂單扣庫存。
    // order document 的 inventoryApplied 是冪等鎖：同一筆訂單再次同步不會重複扣除。
    const applyInventoryNow = settings.applyInventory;
    if (existing.inventoryApplied === true && existing.reversalApplied !== true && existing.inventoryReversed !== true) {
      const cost = orderCostSnapshot(existing, previousInventory, raw, line.quantity);
      transaction.set(orderRef, {
        ...line,
        grossAmount,
        orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
        statusUpdatedAt: line.statusUpdatedAt ? admin.firestore.Timestamp.fromDate(line.statusUpdatedAt) : null,
        estimatedNetRate: settings.estimatedNetRate,
        estimatedNetAmount,
        costTotal: cost.costTotal,
        costEstimated: cost.estimated,
        costSource: cost.source,
        estimatedProfit: estimatedNetAmount - cost.costTotal,
        inventoryApplied: true,
        inventoryReversed: false,
        reversalApplied: false,
        processingStatus: 'inventory-applied',
        processingError: '',
        missingFromPlatformCount: 0,
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        financialUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        syncRunId: runId,
        version: VERSION
      }, { merge: true });
      return { status: 'already-applied', lineId: line.id, productId: product.id };
    }
    if (!productSnap.exists) throw new Error(`中央商品不存在：${line.sku}`);
    const fifo = consumeFifoAllowNegative(raw, line.quantity);
    const fallbackUnitCost = productFallbackUnitCost(raw);
    const estimatedQty = fallbackUnitCost != null ? Math.max(0, Number(fifo.unknownCostQty || 0)) : 0;
    const effectiveCostTotal = Number(fifo.costTotal || 0) + estimatedQty * Number(fallbackUnitCost || 0);
    const costEstimated = estimatedQty > 0;
    const remainingUnknownCostQty = Math.max(0, Number(fifo.unknownCostQty || 0) - estimatedQty);
    const platformMappings = mergePlatformMappings(raw.platformMappings, platformMappingPatch(line));
    const estimatedProfit = estimatedNetAmount - effectiveCostTotal;
    const productPatch = {
      platformMappings,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'platform-order-sync',
      version: VERSION
    };
    if (applyInventoryNow) {
      productPatch.currentStock = fifo.after;
      productPatch.costLayers = fifo.layers;
      productPatch.averageCost = fifo.averageCost;
      productPatch.inventoryValue = fifo.inventoryValue;
      productPatch.costIncomplete = fifo.costIncomplete;
    }
    transaction.set(product.ref, productPatch, { merge: true });
    transaction.set(orderRef, {
      ...line,
      grossAmount,
      orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
      statusUpdatedAt: line.statusUpdatedAt ? admin.firestore.Timestamp.fromDate(line.statusUpdatedAt) : null,
      productId: product.id,
      matchStatus: 'matched',
      processingStatus: applyInventoryNow ? 'inventory-applied' : 'dry-run',
      inventoryApplied: applyInventoryNow,
      inventoryReversed: false,
      reversalApplied: false,
      reversalReason: '',
      inventoryBefore: fifo.before,
      inventoryAfter: applyInventoryNow ? fifo.after : fifo.before,
      costTotal: effectiveCostTotal,
      costEstimated,
      costSource: costEstimated ? 'fifo+current-product-estimate' : 'fifo',
      unknownCostQty: remainingUnknownCostQty,
      estimatedNetRate: settings.estimatedNetRate,
      estimatedNetAmount,
      estimatedProfit,
      missingFromPlatformCount: 0,
      firstSeenAt: existing.firstSeenAt || admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      inventoryAppliedAt: applyInventoryNow ? admin.firestore.FieldValue.serverTimestamp() : null,
      financialUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      syncRunId: runId,
      version: VERSION
    }, { merge: true });
    if (applyInventoryNow) {
      transaction.set(inventoryRef, {
        type: 'onlineSale',
        platform: line.platform,
        productId: product.id,
        productName: clean(raw.internalName || raw.originalName || line.productName),
        sku: line.sku,
        qtyChange: -line.quantity,
        beforeStock: fifo.before,
        afterStock: fifo.after,
        unitCost: line.quantity > 0 ? effectiveCostTotal / line.quantity : null,
        costTotal: effectiveCostTotal,
        unknownCostQty: remainingUnknownCostQty,
        costMethod: costEstimated ? 'FIFO_OR_CURRENT_COST_ESTIMATE' : 'FIFO',
        fifoBreakdown: fifo.breakdown,
        referenceType: 'platformOrder',
        referenceId: line.externalOrderNo,
        orderLineId: line.id,
        note: `${line.platform} 網路訂單`,
        occurredAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: 'platform-order-sync',
        version: VERSION
      }, { merge: true });
    }
    return {
      status: applyInventoryNow ? 'applied' : 'dry-run',
      lineId: line.id,
      productId: product.id,
      before: fifo.before,
      after: applyInventoryNow ? fifo.after : fifo.before
    };
  });
}

async function reconcileMissingPlatformOrders(db, lines, platformFetch, queryFrom, queryTo, productMap, settings, runId) {
  const from = parseDate(queryFrom);
  const to = parseDate(queryTo);
  const output = { reviewed: 0, reversed: 0, errors: 0, changedProductIds: new Set() };
  if (!from || !to) return output;
  const observed = new Map();
  lines.forEach((line) => {
    if (!observed.has(line.platform)) observed.set(line.platform, new Set());
    observed.get(line.platform).add(line.id);
  });
  for (const platform of ['EasyStore', 'MOMO', 'Coupang']) {
    const fetchInfo = platformFetch && platformFetch[platform] || {};
    if (clean(fetchInfo.status).toLowerCase() !== 'success') continue;
    const seen = observed.get(platform) || new Set();
    const snap = await db.collection(ORDER_COLLECTION).where('platform', '==', platform).get();
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      const row = doc.data() || {};
      const orderedAt = parseDate(row.orderedAt);
      if (!orderedAt || orderedAt < from || orderedAt > to) continue;
      if (row.inventoryApplied !== true || row.reversalApplied === true || row.inventoryReversed === true) continue;
      if (clean(row.processingStatus) === 'manual-return-review') continue;
      const count = Math.max(0, Number(row.missingFromPlatformCount || 0)) + 1;
      if (count < settings.missingBeforeReverse) {
        await doc.ref.set({
          processingStatus: 'missing-from-platform-review',
          missingFromPlatformCount: count,
          missingFromPlatformAt: admin.firestore.FieldValue.serverTimestamp(),
          processingError: `平台成功同步但本次未再讀到此訂單；連續 ${settings.missingBeforeReverse} 次未出現才自動回補庫存。`,
          syncRunId: runId,
          version: VERSION
        }, { merge: true });
        output.reviewed += 1;
        continue;
      }
      try {
        const synthetic = normalizeLine({
          ...row,
          orderedAt,
          orderStatus: clean(row.orderStatus) || 'missing-from-platform',
          note: `連續 ${count} 次平台成功同步未再出現`,
        });
        synthetic.id = doc.id;
        synthetic.lifecycle = 'cancelled';
        synthetic.validSale = false;
        const result = await reverseCancelledOrder(db, synthetic, productMap, settings, runId, `連續 ${count} 次平台成功同步未再出現，視為未成交／取消`);
        if (result.status === 'reversed') {
          output.reversed += 1;
          if (result.productId) output.changedProductIds.add(result.productId);
        } else if (result.status === 'reversal-error') output.errors += 1;
      } catch (error) {
        output.errors += 1;
        await doc.ref.set({
          processingStatus: 'reversal-error',
          processingError: clean(error.message || error).slice(0, 800),
          syncRunId: runId,
          version: VERSION
        }, { merge: true });
      }
    }
  }
  return output;
}

function productTargetStock(product) {
  return Math.max(0, Math.round(Number(product.raw.currentStock || 0)));
}

function inventorySyncState(product) {
  return product.raw.platformInventorySync && typeof product.raw.platformInventorySync === 'object'
    ? product.raw.platformInventorySync
    : {};
}

async function updateProductPlatformState(product, platform, result, targetStock) {
  const current = inventorySyncState(product);
  const next = Object.assign({}, current);
  next[platform] = Object.assign({}, current[platform] || {}, result, {
    targetStock,
    lastAttemptAt: admin.firestore.FieldValue.serverTimestamp()
  });
  if (result.status === 'success' || result.status === 'same' || result.status === 'baseline') {
    next[platform].lastSyncedStock = targetStock;
    next[platform].lastSucceededAt = admin.firestore.FieldValue.serverTimestamp();
  }
  next.lastTargetStock = targetStock;
  next.lastUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
  await product.ref.set({ platformInventorySync: next }, { merge: true });
  product.raw.platformInventorySync = next;
}

async function easyStoreUpdateProduct(product, targetStock, token) {
  const mapping = product.raw.platformMappings && product.raw.platformMappings.easyStore || {};
  const productId = clean(mapping.productId || product.raw.sourceProductId);
  const variantIds = [...new Set([...(asArray(mapping.variantIds)), clean(product.raw.sourceVariantId)].map(clean).filter(Boolean))];
  if (!productId || !variantIds.length) return { status: 'unmapped', message: '缺少 EasyStore productId／variantId' };
  const url = `${EASYSTORE_URL}${EASYSTORE_API_BASE}/products/${encodeURIComponent(productId)}/variants.json`;
  await fetchJson(url, {
    method: 'PUT',
    headers: {
      'EasyStore-Access-Token': token,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ variants: variantIds.map((id) => ({ id, inventory_quantity: targetStock })) })
  }, 'EasyStore 庫存');
  return { status: 'success', message: `已同步 ${variantIds.length} 個規格`, mapping: { productId, variantIds } };
}

async function fetchMomoProducts(token) {
  const rows = [];
  for (let page = 1; page <= 100; page += 1) {
    const payload = await momoPost(MOMO_PRODUCT_URL, token, {
      queryMethod: 'Stock',
      saleStatus: 'All',
      pageIndex: page,
      maxPerPage: 10000
    }, 'MOMO 商品');
    const result = asArray(payload.result);
    if (!result.length) break;
    for (const product of result) {
      const goodsCode = clean(product.goodsCode);
      const goodsName = clean(product.goodsName);
      for (const item of asArray(product.listGoodsdt)) {
        rows.push({
          goodsCode,
          goodsdtCode: clean(item.goodsdtCode),
          entpGoodsNo: normalizeSku(item.entpGoodsNo),
          goodsName,
          quantity: numberOrNull(item.quantity),
          goodsdtInfo: clean(item.goodsdtInfo)
        });
      }
    }
    const total = Number(payload.totalGoods || 0);
    if (result.length < 10000 || (total && page * 10000 >= total)) break;
    await sleep(150);
  }
  return rows;
}

function buildMomoMaps(rows) {
  const byEntp = new Map();
  const byGoods = new Map();
  const byCombo = new Map();
  const push = (map, key, row) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  };
  rows.forEach((row) => {
    push(byEntp, normalizeSku(row.entpGoodsNo), row);
    push(byGoods, normalizeSku(row.goodsCode), row);
    push(byCombo, normalizeSku(`${row.goodsCode}-${row.goodsdtCode}`), row);
    push(byCombo, normalizeSku(`${row.goodsCode}|${row.goodsdtCode}`), row);
  });
  return { byEntp, byGoods, byCombo };
}

function resolveMomoProduct(product, maps) {
  const existing = product.raw.platformMappings && product.raw.platformMappings.momo || {};
  if (clean(existing.goodsCode) && clean(existing.goodsdtCode)) {
    return [{
      goodsCode: clean(existing.goodsCode),
      goodsdtCode: clean(existing.goodsdtCode),
      entpGoodsNo: normalizeSku(existing.entpGoodsNo || product.sku),
      quantity: null
    }];
  }
  let candidates = maps.byEntp.get(product.sku) || [];
  if (!candidates.length) candidates = maps.byCombo.get(product.sku) || [];
  if (!candidates.length) candidates = maps.byGoods.get(product.sku) || [];
  const unique = [];
  const seen = new Set();
  candidates.forEach((row) => {
    const key = `${row.goodsCode}|${row.goodsdtCode}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(row);
    }
  });
  return unique;
}

async function syncMomoProducts(products, token) {
  if (!products.length) return new Map();
  const platformRows = await fetchMomoProducts(token);
  const maps = buildMomoMaps(platformRows);
  const updates = [];
  const resultMap = new Map();
  for (const product of products) {
    const targetStock = productTargetStock(product);
    const matches = resolveMomoProduct(product, maps);
    if (!matches.length) {
      resultMap.set(product.id, { status: 'unmapped', message: '找不到 MOMO 對應商品' });
      continue;
    }
    if (matches.length > 1) {
      resultMap.set(product.id, { status: 'duplicate', message: `MOMO 對到 ${matches.length} 個規格` });
      continue;
    }
    const match = matches[0];
    if (match.quantity != null && Number(match.quantity) === targetStock) {
      resultMap.set(product.id, { status: 'same', message: '平台庫存已相同', mapping: match });
      continue;
    }
    updates.push({ product, targetStock, match });
  }
  for (let index = 0; index < updates.length; index += 100) {
    const batch = updates.slice(index, index + 100);
    const payload = await momoPost(MOMO_STOCK_URL, token, {
      listGoodsStockModify: batch.map((row) => ({
        goodsCode: row.match.goodsCode,
        goodsdtCode: row.match.goodsdtCode,
        quantity: row.targetStock
      }))
    }, 'MOMO 庫存');
    const responseMap = new Map(asArray(payload.result).map((row) => [`${clean(row.goodsCode)}|${clean(row.goodsdtCode)}`, row]));
    for (const row of batch) {
      const response = responseMap.get(`${row.match.goodsCode}|${row.match.goodsdtCode}`);
      const ok = response && response.success === true;
      resultMap.set(row.product.id, ok
        ? { status: 'success', message: 'MOMO 庫存更新成功', mapping: row.match }
        : { status: 'error', message: clean(response && response.errorMessage) || 'MOMO 未回傳成功' });
    }
    await sleep(150);
  }
  return resultMap;
}

function recursiveValues(object, key, output = []) {
  if (Array.isArray(object)) {
    object.forEach((item) => recursiveValues(item, key, output));
    return output;
  }
  if (!object || typeof object !== 'object') return output;
  Object.entries(object).forEach(([childKey, value]) => {
    if (childKey === key) output.push(value);
    recursiveValues(value, key, output);
  });
  return output;
}

function collectCoupangItemMappings(object, output = []) {
  if (Array.isArray(object)) {
    object.forEach((item) => collectCoupangItemMappings(item, output));
    return output;
  }
  if (!object || typeof object !== 'object') return output;
  const vendorItemId = clean(object.vendorItemId || object.vendoritemid);
  if (vendorItemId) {
    output.push({
      vendorItemId,
      externalVendorSku: normalizeSku(object.externalVendorSku || object.externalVendorSKU || object.externalVendorSkuCode || object.sellerProductCode || object.sellerProductItemCode)
    });
  }
  Object.values(object).forEach((value) => collectCoupangItemMappings(value, output));
  return output;
}

async function resolveCoupangItems(product, config) {
  const existing = product.raw.platformMappings && product.raw.platformMappings.coupang || {};
  const existingIds = [...new Set(asArray(existing.vendorItemIds).map(clean).filter(Boolean))];
  if (existingIds.length) return existingIds;
  const path = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/external-vendor-sku-codes/${encodeURIComponent(product.sku)}`;
  const summary = await coupangRequest(config, 'GET', path, {}, null, 'Coupang SKU 查詢');
  const summaryMappings = collectCoupangItemMappings(summary);
  let vendorIds = [...new Set(summaryMappings.filter((row) => !row.externalVendorSku || row.externalVendorSku === product.sku).map((row) => row.vendorItemId))];
  if (vendorIds.length) return vendorIds;
  const sellerIds = [...new Set(recursiveValues(summary, 'sellerProductId').map(clean).filter(Boolean))];
  for (const sellerId of sellerIds) {
    const detailPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${encodeURIComponent(sellerId)}`;
    const detail = await coupangRequest(config, 'GET', detailPath, {}, null, 'Coupang 商品查詢');
    const mappings = collectCoupangItemMappings(detail);
    const exact = mappings.filter((row) => row.externalVendorSku === product.sku);
    const selected = exact.length ? exact : (mappings.length === 1 ? mappings : []);
    vendorIds = [...new Set([...vendorIds, ...selected.map((row) => row.vendorItemId)])];
  }
  return vendorIds;
}

async function syncCoupangProduct(product, targetStock, config) {
  const vendorItemIds = await resolveCoupangItems(product, config);
  if (!vendorItemIds.length) return { status: 'unmapped', message: '找不到 Coupang vendorItemId' };
  const messages = [];
  for (const vendorItemId of vendorItemIds) {
    const inventoryPath = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${encodeURIComponent(vendorItemId)}/inventories`;
    const currentPayload = await coupangRequest(config, 'GET', inventoryPath, {}, null, 'Coupang 庫存查詢');
    const current = numberOrNull(deepValue(currentPayload, ['data', 'amountInStock'])) ?? numberOrNull(firstValue(currentPayload.data || {}, ['quantity', 'stockQuantity', 'availableStock', 'inventoryQuantity']));
    if (current === targetStock) {
      messages.push(`${vendorItemId}:已相同`);
      continue;
    }
    const updatePath = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${encodeURIComponent(vendorItemId)}/quantities/${targetStock}`;
    await coupangRequest(config, 'PUT', updatePath, {}, null, 'Coupang 庫存更新');
    messages.push(`${vendorItemId}:${current == null ? '?' : current}→${targetStock}`);
    await sleep(80);
  }
  return { status: messages.every((message) => message.includes('已相同')) ? 'same' : 'success', message: messages.join('；').slice(0, 600), mapping: { vendorItemIds } };
}

async function syncCandidateProducts(db, products, changedProductIds, settings, credentials, runtime) {
  const baselineCompleted = runtime.baselineCompleted === true;
  const baselineAt = parseDate(runtime.baselineCompletedAt);
  const candidates = [];
  for (const product of products) {
    if (!product.sku) continue;
    const target = productTargetStock(product);
    const state = inventorySyncState(product);
    const hasPlatformHistory = Object.entries(settings.platforms).some(([platform, enabled]) =>
      enabled && state[platform] && typeof state[platform] === 'object'
    );
    const needsPlatform = Object.entries(settings.platforms).some(([platform, enabled]) => {
      if (!enabled) return false;
      const platformState = state[platform];
      if (!platformState || typeof platformState !== 'object') return hasPlatformHistory;
      const last = platformState.lastSyncedStock;
      if (last === undefined || last === null || last === '') return true;
      return Number(last) !== target;
    });
    const updatedAt = parseDate(product.raw.updatedAt);
    const changedAfterBaseline = baselineCompleted && baselineAt && updatedAt && updatedAt > baselineAt;
    if (changedProductIds.has(product.id) || needsPlatform || (!hasPlatformHistory && changedAfterBaseline)) candidates.push(product);
  }
  const summary = {
    candidates: candidates.length,
    baseline: baselineCompleted ? 0 : Math.max(0, products.length - candidates.length),
    EasyStore: { success: 0, same: 0, error: 0, unmapped: 0 },
    MOMO: { success: 0, same: 0, error: 0, unmapped: 0 },
    Coupang: { success: 0, same: 0, error: 0, unmapped: 0 }
  };
  if (!candidates.length) return summary;

  if (settings.platforms.EasyStore) {
    for (const product of candidates) {
      const target = productTargetStock(product);
      let result;
      try {
        result = await easyStoreUpdateProduct(product, target, credentials.easyStoreToken);
      } catch (error) {
        result = { status: 'error', message: clean(error.message).slice(0, 600) };
      }
      const bucket = result.status === 'unmapped' ? 'unmapped' : (result.status === 'same' ? 'same' : (result.status === 'success' ? 'success' : 'error'));
      summary.EasyStore[bucket] += 1;
      await updateProductPlatformState(product, 'EasyStore', result, target);
      if (result.mapping) {
        const mappings = mergePlatformMappings(product.raw.platformMappings, { easyStore: result.mapping });
        await product.ref.set({ platformMappings: mappings }, { merge: true });
        product.raw.platformMappings = mappings;
      }
    }
  }

  if (settings.platforms.MOMO) {
    let results;
    try {
      results = await syncMomoProducts(candidates, credentials.momoToken);
    } catch (error) {
      results = new Map(candidates.map((product) => [product.id, { status: 'error', message: clean(error.message).slice(0, 600) }]));
    }
    for (const product of candidates) {
      const target = productTargetStock(product);
      const result = results.get(product.id) || { status: 'error', message: 'MOMO 無同步結果' };
      const bucket = result.status === 'unmapped' || result.status === 'duplicate' ? 'unmapped' : (result.status === 'same' ? 'same' : (result.status === 'success' ? 'success' : 'error'));
      summary.MOMO[bucket] += 1;
      await updateProductPlatformState(product, 'MOMO', result, target);
      if (result.mapping) {
        const mappings = mergePlatformMappings(product.raw.platformMappings, { momo: result.mapping });
        await product.ref.set({ platformMappings: mappings }, { merge: true });
        product.raw.platformMappings = mappings;
      }
    }
  }

  if (settings.platforms.Coupang) {
    const config = {
      vendorId: credentials.coupangVendorId,
      accessKey: credentials.coupangAccessKey,
      secretKey: credentials.coupangSecretKey
    };
    for (const product of candidates) {
      const target = productTargetStock(product);
      let result;
      try {
        result = await syncCoupangProduct(product, target, config);
      } catch (error) {
        result = { status: 'error', message: clean(error.message).slice(0, 600) };
      }
      const bucket = result.status === 'unmapped' ? 'unmapped' : (result.status === 'same' ? 'same' : (result.status === 'success' ? 'success' : 'error'));
      summary.Coupang[bucket] += 1;
      await updateProductPlatformState(product, 'Coupang', result, target);
      if (result.mapping) {
        const mappings = mergePlatformMappings(product.raw.platformMappings, { coupang: result.mapping });
        await product.ref.set({ platformMappings: mappings }, { merge: true });
        product.raw.platformMappings = mappings;
      }
      await sleep(80);
    }
  }
  return summary;
}

async function fetchAllPlatformLines(settings, credentials, start, end) {
  const result = { lines: [], platforms: {} };
  const tasks = [];
  if (settings.platforms.EasyStore) {
    tasks.push((async () => {
      try {
        const lines = await fetchEasyStoreOrders(start, end, credentials.easyStoreToken);
        result.lines.push(...lines);
        result.platforms.EasyStore = { status: 'success', lines: lines.length };
      } catch (error) {
        result.platforms.EasyStore = { status: 'error', error: clean(error.message).slice(0, 800), lines: 0 };
      }
    })());
  }
  if (settings.platforms.MOMO) {
    tasks.push((async () => {
      try {
        const lines = await fetchMomoOrders(start, end, credentials.momoToken);
        result.lines.push(...lines);
        result.platforms.MOMO = { status: 'success', lines: lines.length };
      } catch (error) {
        result.platforms.MOMO = { status: 'error', error: clean(error.message).slice(0, 800), lines: 0 };
      }
    })());
  }
  if (settings.platforms.Coupang) {
    tasks.push((async () => {
      try {
        const lines = await fetchCoupangOrders(start, end, {
          vendorId: credentials.coupangVendorId,
          accessKey: credentials.coupangAccessKey,
          secretKey: credentials.coupangSecretKey
        });
        result.lines.push(...lines);
        result.platforms.Coupang = { status: 'success', lines: lines.length };
      } catch (error) {
        result.platforms.Coupang = { status: 'error', error: clean(error.message).slice(0, 800), lines: 0 };
      }
    })());
  }
  await Promise.all(tasks);
  const unique = new Map();
  result.lines.forEach((line) => unique.set(line.id, line));
  result.lines = [...unique.values()];
  return result;
}

async function runPlatformOrderSync(trigger) {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const lock = await acquireLock(db, trigger);
  const runRef = db.collection(RUN_COLLECTION).doc(lock.runId);
  const startedAt = new Date();
  let finalResult = { status: 'failed', summary: {} };
  await runRef.set({
    runId: lock.runId,
    trigger,
    status: 'running',
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    version: VERSION
  });
  try {
    await ensureOfficialInventoryMode(db);
    const settings = await readSettings(db);
    if (!settings.enabled) {
      finalResult = { status: 'disabled', summary: { message: '平台訂單同步已停用' } };
      await runRef.set({ status: 'disabled', finishedAt: admin.firestore.FieldValue.serverTimestamp(), settings }, { merge: true });
      return finalResult;
    }
    const credentials = {
      easyStoreToken: EASYSTORE_ACCESS_TOKEN.value(),
      momoToken: MOMO_API_TOKEN.value(),
      coupangVendorId: COUPANG_VENDOR_ID.value(),
      coupangAccessKey: COUPANG_ACCESS_KEY.value(),
      coupangSecretKey: COUPANG_SECRET_KEY.value()
    };
    const end = new Date();
    const start = new Date(end.getTime() - settings.lookbackDays * 24 * 60 * 60 * 1000);
    const products = await loadProducts(db);
    const productMap = buildProductMap(products);
    const fetched = await fetchAllPlatformLines(settings, credentials, start, end);
    const processing = { applied: 0, alreadyApplied: 0, historical: 0, reversed: 0, returnReview: 0, ignored: 0, unmatched: 0, missingSku: 0, dryRun: 0, errors: 0 };
    const changedProductIds = new Set();
    for (const line of fetched.lines) {
      try {
        const result = await applyOrderLine(db, line, productMap, settings, lock.runId);
        if (result.productId && (result.status === 'applied' || result.status === 'reversed')) changedProductIds.add(result.productId);
        if (result.status === 'applied') processing.applied += 1;
        else if (result.status === 'already-applied') processing.alreadyApplied += 1;
        else if (result.status === 'historical') processing.historical += 1;
        else if (result.status === 'reversed') processing.reversed += 1;
        else if (result.status === 'return-review') processing.returnReview += 1;
        else if (result.status === 'ignored' || result.status === 'cancelled-ignored' || result.status === 'already-reversed') processing.ignored += 1;
        else if (result.status === 'missing-sku') processing.missingSku += 1;
        else if (result.status === 'unmatched-sku' || result.status === 'duplicate-sku') processing.unmatched += 1;
        else if (result.status === 'dry-run') processing.dryRun += 1;
      } catch (error) {
        processing.errors += 1;
        await db.collection(ORDER_COLLECTION).doc(line.id).set({
          ...line,
          orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
          processingStatus: 'error',
          processingError: clean(error.message).slice(0, 800),
          inventoryApplied: false,
          lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
          syncRunId: lock.runId,
          version: VERSION
        }, { merge: true });
      }
    }
    const reconciliation = await reconcileMissingPlatformOrders(db, fetched.lines, fetched.platforms, start.toISOString(), end.toISOString(), productMap, settings, lock.runId);
    reconciliation.changedProductIds.forEach((id) => changedProductIds.add(id));
    processing.reversed += reconciliation.reversed;
    processing.errors += reconciliation.errors;
    const refreshedProducts = await loadProducts(db);
    const runtimeSnap = await lock.ref.get();
    const runtime = runtimeSnap.exists ? runtimeSnap.data() || {} : {};
    const inventorySync = settings.applyInventory
      ? await syncCandidateProducts(db, refreshedProducts, changedProductIds, settings, credentials, runtime)
      : { skipped: true, reason: 'applyInventory=false' };
    await lock.ref.set({ baselineCompleted: true, baselineCompletedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    const platformErrors = Object.values(fetched.platforms).filter((row) => row.status === 'error').length;
    const status = processing.errors || platformErrors ? 'completed-with-errors' : 'completed';
    const summary = {
      queryFrom: start.toISOString(),
      queryTo: end.toISOString(),
      fetchedLines: fetched.lines.length,
      platformFetch: fetched.platforms,
      processing,
      reconciliation: { reviewed: reconciliation.reviewed, reversed: reconciliation.reversed, errors: reconciliation.errors },
      changedProducts: changedProductIds.size,
      inventorySync,
      estimatedNetRate: settings.estimatedNetRate,
      applyInventory: settings.applyInventory,
      durationSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000)
    };
    await runRef.set({
      status,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      summary,
      settings,
      version: VERSION
    }, { merge: true });
    await db.collection('opsSyncJobs').doc(lock.runId).set({
      jobNo: lock.runId,
      type: 'platformOrderInventorySync',
      status,
      platforms: Object.keys(settings.platforms).filter((platform) => settings.platforms[platform]),
      productCount: changedProductIds.size,
      orderLineCount: fetched.lines.length,
      note: `訂單 ${fetched.lines.length} 筆；本次正式扣庫存 ${processing.applied} 筆；取消回補 ${processing.reversed} 筆；異常 ${processing.errors + platformErrors} 筆`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: trigger,
      version: VERSION
    }, { merge: true });
    finalResult = { status, summary };
    return finalResult;
  } catch (error) {
    const message = clean(error.message || error).slice(0, 1200);
    await runRef.set({
      status: 'failed',
      error: message,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      version: VERSION
    }, { merge: true });
    finalResult = { status: 'failed', summary: { error: message } };
    throw error;
  } finally {
    await releaseLock(lock, finalResult).catch((error) => console.error('release platform sync lock failed', error));
  }
}

async function assertAdmin(request) {
  if (!request.auth || !request.auth.uid) throw new HttpsError('unauthenticated', '請先登入 Firebase 管理者帳號。');
  const email = clean(request.auth.token && request.auth.token.email).toLowerCase();
  if (ADMIN_EMAILS.has(email)) return;
  const db = admin.firestore();
  const adminSnap = await db.collection('admins').doc(request.auth.uid).get();
  if (adminSnap.exists && adminSnap.data().enabled !== false) return;
  throw new HttpsError('permission-denied', '只有管理者可以執行平台同步。');
}

function requestOrigin(request) {
  const headers = request && request.rawRequest && request.rawRequest.headers || {};
  const direct = clean(headers.origin).toLowerCase();
  if (direct) return direct.replace(/\/$/, '');
  const referer = clean(headers.referer || headers.referrer);
  if (!referer) return '';
  try { return new URL(referer).origin.toLowerCase().replace(/\/$/, ''); }
  catch (_) { return ''; }
}

function assertSafeDryRunCaller(request) {
  const source = clean(request && request.data && request.data.source).toLowerCase();
  const origin = requestOrigin(request);
  const allowedOrigins = new Set([
    'https://danny700808.github.io',
    'https://www.mingtinghuang.com',
    'https://mingtinghuang.com'
  ]);
  if (source === 'operations-hub' && allowedOrigins.has(origin)) return;
  throw new HttpsError('permission-denied', '目前只允許從全通路營運中心執行安全測試同步。');
}


function agentRawBody(req) {
  if (req && req.rawBody) return Buffer.from(req.rawBody);
  return Buffer.from(JSON.stringify((req && req.body) || {}), 'utf8');
}

function verifyLocalAgentRequest(req) {
  const timestamp = clean(req && req.headers && req.headers['x-youzi-timestamp']);
  const signature = clean(req && req.headers && req.headers['x-youzi-signature']).toLowerCase();
  const seconds = Number(timestamp || 0);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 10 * 60) {
    throw new Error('本機同步驗證時間已失效。');
  }
  const secret = clean(COUPANG_SECRET_KEY.value());
  if (!secret) throw new Error('Coupang Secret Key 尚未設定。');
  const body = agentRawBody(req);
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('本機同步驗證失敗。');
}

function inventoryTargetsForProducts(products, productIds) {
  const wanted = productIds instanceof Set ? productIds : new Set(productIds || []);
  return products
    .filter((product) => wanted.has(product.id) && product.sku)
    .map((product) => ({
      productId: product.id,
      sku: product.sku,
      targetStock: Math.round(Number(product.raw.currentStock || 0)),
      productName: clean(product.raw.internalName || product.raw.originalName || product.raw.name || ''),
    }));
}

async function runPlatformOrderSyncFromAgent(payload) {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const trigger = clean(payload && payload.trigger) || 'local-agent';
  const lock = await acquireLock(db, trigger);
  const runRef = db.collection(RUN_COLLECTION).doc(lock.runId);
  const startedAt = new Date();
  let finalResult = { status: 'failed', summary: {} };
  await runRef.set({
    runId: lock.runId,
    trigger,
    status: 'running',
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: 'store-windows-agent',
    version: VERSION,
  });
  try {
    await ensureOfficialInventoryMode(db);
    const settings = await readSettings(db);
    if (!settings.enabled) {
      finalResult = { status: 'disabled', summary: { message: '平台訂單同步已停用' } };
      await runRef.set({ status: 'disabled', finishedAt: admin.firestore.FieldValue.serverTimestamp(), settings }, { merge: true });
      return { ...finalResult, applyInventory: settings.applyInventory, inventoryTargets: [] };
    }
    const rawLines = Array.isArray(payload && payload.lines) ? payload.lines : [];
    const unique = new Map();
    rawLines.forEach((row) => {
      const line = normalizeLine(row || {});
      unique.set(line.id, line);
    });
    const lines = [...unique.values()];
    const products = await loadProducts(db);
    const productMap = buildProductMap(products);
    const processing = { applied: 0, alreadyApplied: 0, historical: 0, reversed: 0, returnReview: 0, ignored: 0, unmatched: 0, missingSku: 0, dryRun: 0, errors: 0 };
    const changedProductIds = new Set();
    for (const line of lines) {
      try {
        const result = await applyOrderLine(db, line, productMap, settings, lock.runId);
        if (result.productId && (result.status === 'applied' || result.status === 'reversed')) changedProductIds.add(result.productId);
        if (result.status === 'applied') processing.applied += 1;
        else if (result.status === 'already-applied') processing.alreadyApplied += 1;
        else if (result.status === 'historical') processing.historical += 1;
        else if (result.status === 'reversed') processing.reversed += 1;
        else if (result.status === 'return-review') processing.returnReview += 1;
        else if (result.status === 'ignored' || result.status === 'cancelled-ignored' || result.status === 'already-reversed') processing.ignored += 1;
        else if (result.status === 'missing-sku') processing.missingSku += 1;
        else if (result.status === 'unmatched-sku' || result.status === 'duplicate-sku') processing.unmatched += 1;
        else if (result.status === 'dry-run') processing.dryRun += 1;
      } catch (error) {
        processing.errors += 1;
        await db.collection(ORDER_COLLECTION).doc(line.id).set({
          ...line,
          orderedAt: admin.firestore.Timestamp.fromDate(line.orderedAt),
          processingStatus: 'error',
          processingError: clean(error.message).slice(0, 800),
          inventoryApplied: false,
          lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
          syncRunId: lock.runId,
          version: VERSION,
        }, { merge: true });
      }
    }
    const queryFrom = clean(payload && payload.queryFrom);
    const queryTo = clean(payload && payload.queryTo);
    const platformFetch = payload && payload.platformFetch && typeof payload.platformFetch === 'object' ? payload.platformFetch : {};
    const reconciliation = await reconcileMissingPlatformOrders(db, lines, platformFetch, queryFrom, queryTo, productMap, settings, lock.runId);
    reconciliation.changedProductIds.forEach((id) => changedProductIds.add(id));
    processing.reversed += reconciliation.reversed;
    processing.errors += reconciliation.errors;
    const refreshedProducts = await loadProducts(db);
    const inventoryTargets = settings.applyInventory
      ? inventoryTargetsForProducts(refreshedProducts, changedProductIds)
      : [];
    const status = processing.errors ? 'completed-with-errors' : 'completed';
    const summary = {
      queryFrom,
      queryTo,
      fetchedLines: lines.length,
      platformFetch,
      processing,
      reconciliation: { reviewed: reconciliation.reviewed, reversed: reconciliation.reversed, errors: reconciliation.errors },
      changedProducts: changedProductIds.size,
      applyInventory: settings.applyInventory,
      executionMode: 'store-windows-agent',
      durationSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
    };
    await runRef.set({
      status,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      summary,
      settings,
      source: 'store-windows-agent',
      version: VERSION,
    }, { merge: true });
    await db.collection('opsSyncJobs').doc(lock.runId).set({
      jobNo: lock.runId,
      type: 'platformOrderInventorySync',
      status,
      platforms: Object.keys(platformFetch),
      productCount: changedProductIds.size,
      orderLineCount: lines.length,
      note: `本機代理讀取訂單 ${lines.length} 筆；本次正式扣庫存 ${processing.applied} 筆；取消回補 ${processing.reversed} 筆；異常 ${processing.errors} 筆`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: trigger,
      source: 'store-windows-agent',
      version: VERSION,
    }, { merge: true });
    finalResult = { status, summary };
    return { status, summary, applyInventory: settings.applyInventory, inventoryTargets, runId: lock.runId };
  } catch (error) {
    const message = clean(error.message || error).slice(0, 1200);
    await runRef.set({ status: 'failed', error: message, finishedAt: admin.firestore.FieldValue.serverTimestamp(), version: VERSION }, { merge: true });
    finalResult = { status: 'failed', summary: { error: message } };
    throw error;
  } finally {
    await releaseLock(lock, finalResult).catch((error) => console.error('release local-agent sync lock failed', error));
  }
}

function registerPlatformOrderSync(target) {
  const cloudSecrets = [EASYSTORE_ACCESS_TOKEN, MOMO_API_TOKEN, COUPANG_VENDOR_ID, COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY];

  // 保留原函式名稱只是為了相容既有部署。真正排程由店內 Windows 電腦在 14:00、20:30 執行。
  // Google Cloud 不再呼叫受固定 IP 限制的平台 API。
  target.platformOrderSyncDaily = onSchedule({
    schedule: '0 0 1 1 *',
    timeZone: TIME_ZONE,
    region: REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
  }, async () => {
    console.log('platformOrderSyncDaily compatibility check only: executionMode=store-windows-agent-14:00-20:30');
  });

  target.syncPlatformOrdersNow = onCall({
    region: REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
  }, async () => ({
    ok: false,
    status: 'local-agent-required',
    message: 'MOMO 與 Coupang 限制固定 IP，請使用全通路營運中心的「立即同步」，或由店內電腦每天 14:00、20:30 自動執行。',
  }));

  target.platformOrderAgentBridge = onRequest({
    region: REGION,
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [COUPANG_SECRET_KEY],
    cors: false,
  }, async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, message: 'Method Not Allowed' });
      return;
    }
    try {
      verifyLocalAgentRequest(req);
      const result = await runPlatformOrderSyncFromAgent(req.body || {});
      res.status(200).json({ ok: true, ...result });
    } catch (error) {
      console.error('[platformOrderAgentBridge]', error);
      res.status(401).json({ ok: false, message: clean(error.message || error).slice(0, 1000) });
    }
  });
}

module.exports = {
  registerPlatformOrderSync,
  _test: {
    normalizeLine,
    validLine,
    orderLifecycle,
    normalizeSku,
    consumeFifoAllowNegative,
    extractOrders,
    extractLineItems
  }
};
