'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const DEFAULT_STORE_URL = 'https://www.mingtinghuang.com/';
const DEFAULT_API_BASE_PATH = '/api/3.0';

// 從舊 GS 的 tgWebsiteQuoteConfig_ 搬過來。
// 正式環境建議改用 functions/.env 或 Secret Manager 設定 EASYSTORE_ACCESS_TOKEN。
const LEGACY_EASYSTORE_ACCESS_TOKEN = '380c01a21086de6cb53d72fac31ddb2e';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function baseUrl(url) {
  let s = clean(url || DEFAULT_STORE_URL);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, '');
}

function config() {
  return {
    storeUrl: baseUrl(process.env.EASYSTORE_STORE_URL || DEFAULT_STORE_URL),
    apiBasePath: clean(process.env.EASYSTORE_API_BASE_PATH || DEFAULT_API_BASE_PATH) || DEFAULT_API_BASE_PATH,
    accessToken: clean(process.env.EASYSTORE_ACCESS_TOKEN || LEGACY_EASYSTORE_ACCESS_TOKEN),
    defaultSearchLimit: 12,
    maxPages: 8,
    fetchLimit: 50,
  };
}

function headers() {
  const cfg = config();
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.accessToken}`,
    'EasyStore-Access-Token': cfg.accessToken,
  };
}

function arrayFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const keys = ['data', 'products', 'items', 'results'];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function moneyText(value) {
  const s = clean(value);
  if (!s) return '';
  const n = Number(String(s).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return s;
  return `NT$ ${Math.round(n).toLocaleString('zh-TW')}`;
}

function imageFromProduct(o = {}) {
  if (clean(o.image_url)) return clean(o.image_url);
  if (clean(o.imageUrl)) return clean(o.imageUrl);
  if (clean(o.image)) return clean(o.image);
  if (Array.isArray(o.images) && o.images.length) {
    const first = o.images[0] || {};
    return clean(first.src || first.url || first.image_url || first.imageUrl || '');
  }
  if (o.featured_image) {
    if (typeof o.featured_image === 'string') return clean(o.featured_image);
    return clean(o.featured_image.src || o.featured_image.url || '');
  }
  return '';
}

function priceFromProduct(o = {}) {
  const keys = ['price', 'selling_price', 'display_price', 'min_price', 'max_price'];
  for (const key of keys) {
    const v = clean(o[key]);
    if (v) return v;
  }
  if (Array.isArray(o.variants) && o.variants.length) {
    const v0 = o.variants[0] || {};
    return clean(v0.price || v0.selling_price || v0.display_price || '');
  }
  return '';
}

function variantSummary(o = {}) {
  const out = [];
  if (Array.isArray(o.variants)) {
    for (let i = 0; i < o.variants.length && i < 3; i++) {
      const v = o.variants[i] || {};
      const name = clean(v.name || v.title || v.option1 || v.sku || '');
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out.join(' / ');
}

function productUrl(o = {}) {
  const cfg = config();
  const base = cfg.storeUrl;
  let link = clean(o.url || o.permalink || o.product_url || '');
  const handle = clean(o.handle || o.slug || '');
  if (!link && handle) link = `${base}/products/${handle}`;
  if (link && !/^https?:\/\//i.test(link)) link = `${base}/${link.replace(/^\/+/, '')}`;
  return link;
}

function rowFromProduct(o = {}) {
  const price = priceFromProduct(o);
  const compare = clean(o.compare_at_price || o.market_price || o.original_price || '');
  const note = clean(o.summary || o.description || o.short_description || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    productId: clean(o.id || o.product_id || o.uuid || o.handle || o.slug || ''),
    name: clean(o.name || o.title || o.product_name || '未命名商品'),
    brand: clean(o.brand || o.vendor || ''),
    category: clean(o.category || o.product_type || ''),
    imageUrl: imageFromProduct(o),
    price,
    priceText: moneyText(price),
    marketPrice: compare || price,
    marketPriceText: moneyText(compare || price),
    stockStatus: clean(o.inventory_status || o.availability || o.stock_status || ''),
    variantSummary: variantSummary(o),
    summary: clean(o.summary || ''),
    note,
    url: productUrl(o),
    websiteSource: 'EasyStore 官網',
    updatedAt: new Date().toISOString(),
  };
}

function normalizeSearchText(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\s\-_/|,，。．.：:；;、()（）\[\]【】{}]+/g, ' ')
    .trim();
}

function searchTokens(keyword) {
  const raw = clean(keyword);
  const map = {
    卡西歐: ['casio', '卡西歐'],
    山葉: ['yamaha', '山葉', '雅馬哈'],
    雅馬哈: ['yamaha', '山葉', '雅馬哈'],
    羅蘭: ['roland', '羅蘭'],
    河合: ['kawai', '河合'],
    芬達: ['fender', '芬達'],
    伊利克斯: ['elixir', '伊利克斯'],
    伊利克: ['elixir', '伊利克'],
    達達里奧: ['daddario', "d'addario", '達達里奧'],
    亞瑪哈: ['yamaha', '亞瑪哈'],
  };
  const out = [];
  const add = (v) => {
    const x = normalizeSearchText(v);
    if (x && !out.includes(x)) out.push(x);
  };
  add(raw);
  const rawNoSpace = raw.replace(/\s+/g, '');
  if (rawNoSpace !== raw) add(rawNoSpace);
  Object.keys(map).forEach((key) => {
    if (raw.includes(key) || key.includes(raw)) map[key].forEach(add);
  });
  const low = raw.toLowerCase();
  if (low.includes('casio')) add('卡西歐');
  if (low.includes('yamaha')) { add('山葉'); add('雅馬哈'); add('亞瑪哈'); }
  if (low.includes('roland')) add('羅蘭');
  if (low.includes('kawai')) add('河合');
  if (low.includes('fender')) add('芬達');
  if (low.includes('elixir')) { add('伊利克斯'); add('伊利克'); }
  return out;
}

function deepText(obj, depth = 0) {
  if (obj == null || depth > 4) return '';
  if (['string', 'number', 'boolean'].includes(typeof obj)) return String(obj);
  if (Array.isArray(obj)) return obj.map((v) => deepText(v, depth + 1)).join(' ');
  if (typeof obj === 'object') {
    const parts = [];
    Object.keys(obj).forEach((key) => {
      if (/image|url|src/i.test(key)) return;
      parts.push(key);
      parts.push(deepText(obj[key], depth + 1));
    });
    return parts.join(' ');
  }
  return '';
}

function haystack(rawProduct, row) {
  const mapped = [
    row.name,
    row.brand,
    row.category,
    row.note,
    row.summary,
    row.variantSummary,
    row.productId,
    row.stockStatus,
  ].join(' ');
  return normalizeSearchText(`${mapped} ${deepText(rawProduct)}`);
}

function matches(rawProduct, row, tokens) {
  if (!tokens || !tokens.length) return true;
  const hay = haystack(rawProduct, row);
  return tokens.some((token) => hay.includes(token));
}

async function fetchProductsPage(page, fetchLimit) {
  const cfg = config();
  if (!cfg.accessToken) throw new HttpsError('failed-precondition', '缺少 EasyStore Access Token。');
  const baseApi = `${cfg.storeUrl}${cfg.apiBasePath}`;
  const url = `${baseApi}/products.json?limit=${encodeURIComponent(String(fetchLimit || 50))}&page=${encodeURIComponent(String(page || 1))}&visibility=published`;
  const res = await fetch(url, { method: 'GET', headers: headers() });
  const status = res.status;
  const body = await res.text();
  const preview = body.substring(0, 180).replace(/\s+/g, ' ').trim();
  if (status < 200 || status >= 300) {
    return { url, ok: false, status, count: 0, products: [], preview, error: `HTTP ${status}` };
  }
  if (!/^\s*[\{\[]/.test(body)) {
    return { url, ok: false, status, count: 0, products: [], preview, error: '回傳不是 JSON' };
  }
  const payload = body ? JSON.parse(body) : {};
  const products = arrayFromPayload(payload);
  return {
    url,
    ok: true,
    status,
    count: products.length,
    products,
    preview,
    totalCount: Number(payload.total_count || 0) || 0,
    pageCount: Number(payload.page_count || 0) || 0,
  };
}

async function cacheRows(rows) {
  if (!rows || !rows.length) return;
  const batch = db.batch();
  rows.slice(0, 100).forEach((row) => {
    const id = clean(row.productId || row.url || row.name).replace(/[\/#?\[\]]/g, '_').slice(0, 120) || db.collection('websiteProducts').doc().id;
    const ref = db.collection('websiteProducts').doc(id);
    batch.set(ref, Object.assign({}, row, {
      searchableText: normalizeSearchText([row.name, row.brand, row.category, row.note, row.variantSummary, row.productId].join(' ')),
      source: 'EasyStore',
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
    }), { merge: true });
  });
  await batch.commit();
}

exports.searchTeacherWebsiteGoods = onCall({ timeoutSeconds: 60, memory: '512MiB' }, async (request) => {
  const data = request.data || {};
  const keyword = clean(data.keyword || '');
  if (!keyword) return { ok: true, rows: [], list: [], message: '請輸入搜尋關鍵字。' };

  const cfg = config();
  const limit = Math.max(1, Math.min(Number(data.limit || cfg.defaultSearchLimit || 12) || 12, 50));
  const fetchLimit = Math.max(10, Math.min(Number(data.fetchLimit || cfg.fetchLimit || 50) || 50, 100));
  const maxPages = Math.max(1, Math.min(Number(data.maxPages || cfg.maxPages || 8) || 8, 20));
  const tokens = searchTokens(keyword);
  const rows = [];
  const seen = new Set();
  const attempts = [];
  let connected = false;
  let hasProducts = false;
  let rawProductCount = 0;

  for (let page = 1; page <= maxPages; page++) {
    const pageRes = await fetchProductsPage(page, fetchLimit);
    attempts.push({
      url: pageRes.url,
      status: pageRes.status,
      isJson: pageRes.ok,
      count: pageRes.count,
      preview: pageRes.preview,
      error: pageRes.error || '',
    });
    if (pageRes.status >= 200 && pageRes.status < 300) connected = true;
    if (!pageRes.ok) {
      if (page === 1) break;
      continue;
    }
    rawProductCount += pageRes.count;
    if (pageRes.count > 0) hasProducts = true;

    for (let i = 0; i < pageRes.products.length; i++) {
      const raw = pageRes.products[i];
      const row = rowFromProduct(raw);
      if (!matches(raw, row, tokens)) continue;
      const key = clean(row.productId || row.url || row.name) || `ROW_${page}_${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      if (rows.length >= limit) break;
    }
    if (rows.length >= limit) break;
    if (pageRes.count < fetchLimit) break;
  }

  const finalRows = rows.slice(0, limit);
  try { await cacheRows(finalRows); } catch (err) { console.warn('websiteProducts cache failed:', err); }

  return {
    ok: true,
    rows: finalRows,
    list: finalRows,
    source: 'Firebase Function / EasyStore API',
    message: finalRows.length ? '已完成官網商品搜尋。' : (hasProducts ? 'API 已讀到商品，但目前關鍵字沒有命中。' : 'API 有回應，但目前沒有讀到商品列表。'),
    debug: {
      connected,
      hasProducts,
      totalRows: finalRows.length,
      rawProductCount,
      endpoint: '/api/3.0/products.json',
      tokens,
      attempts,
    },
  };
});
