'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const crypto = require('crypto');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');


// 2026-06-03：允許 GitHub Pages / Firebase Hosting 呼叫 Callable Functions。
// 這是老師端「公司官網詢價」從前端呼叫 Firebase Function 的必要設定。
const HTTPS_CALLABLE_OPTIONS = {
  region: 'us-central1',
  invoker: 'public',
  cors: [
    'https://denny700808.github.io',
    'https://youzi-c1b74.web.app',
    'https://youzi-c1b74.firebaseapp.com',
    'http://localhost:5000',
    'http://localhost:5001',
    'http://127.0.0.1:5000',
    'http://127.0.0.1:5001',
  ],
};

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
    // EasyStore 商品多時，原本只掃 8 頁會漏掉後面商品。
    // 這裡提高到 60 頁，最多約掃 3000 筆。
    maxPages: 60,
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


function decodeHtml(value) {
  return clean(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCharCode(Number(n)); } catch (err) { return _; }
    });
}

function stripHtml(value) {
  return decodeHtml(String(value == null ? '' : value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function absUrl(url) {
  const cfg = config();
  const base = cfg.storeUrl;
  let u = decodeHtml(clean(url));
  if (!u) return '';
  if (/^\/\//.test(u)) return `https:${u}`;
  if (/^https?:\/\//i.test(u)) return u;
  if (u[0] === '/') return `${base}${u}`;
  return `${base}/${u}`;
}

function removeQueryNoise(url) {
  const u = clean(url);
  if (!u) return '';
  try {
    const obj = new URL(u);
    obj.searchParams.delete('srsltid');
    obj.searchParams.delete('utm_source');
    obj.searchParams.delete('utm_medium');
    obj.searchParams.delete('utm_campaign');
    return obj.toString();
  } catch (err) {
    return u.split('?')[0];
  }
}

async function fetchTextUrl(url) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 YouziMusicWebsiteQuoteBot/1.0',
    },
  });
  const text = await res.text();
  return { url, ok: res.status >= 200 && res.status < 300, status: res.status, text };
}

function htmlAttr(html, patterns) {
  for (const re of patterns) {
    const m = String(html || '').match(re);
    if (m && clean(m[1])) return decodeHtml(m[1]);
  }
  return '';
}

function parseProductFromHtml(html, url) {
  const raw = String(html || '');
  let name = htmlAttr(raw, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]);
  name = stripHtml(name).replace(/\s*[|｜-]\s*柚子樂器.*$/i, '').trim();

  let imageUrl = htmlAttr(raw, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<img[^>]+src=["']([^"']+)["'][^>]*(?:product|商品|image)/i,
  ]);
  imageUrl = absUrl(imageUrl);

  let price = htmlAttr(raw, [
    /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']product:price:amount["']/i,
  ]);
  if (!price) {
    const text = stripHtml(raw);
    const pm = text.match(/(?:NT\$|NTD|\$)\s*([0-9][0-9,]*(?:\.\d+)?)/i);
    if (pm) price = pm[1];
  }

  const visibleText = stripHtml(raw).slice(0, 2000);
  let stockStatus = '';
  if (/售完|缺貨|已售完|Sold\s*Out/i.test(visibleText)) stockStatus = '缺貨 / 售完';
  else if (/加入購物車|Add\s*to\s*cart/i.test(visibleText)) stockStatus = '可加入購物車';

  const cleanUrl = removeQueryNoise(absUrl(url));
  const slug = cleanUrl.split('/products/')[1] || '';
  return {
    productId: clean(slug.split(/[?#]/)[0] || cleanUrl),
    name: name || decodeURIComponent(clean(slug)).replace(/[-_]/g, ' ') || '官網商品',
    brand: '',
    category: '',
    imageUrl,
    price,
    priceText: moneyText(price),
    marketPrice: price,
    marketPriceText: moneyText(price),
    stockStatus,
    variantSummary: '',
    summary: '',
    note: visibleText.slice(0, 300),
    url: cleanUrl,
    websiteSource: '公司官網公開頁面',
    updatedAt: new Date().toISOString(),
  };
}

function productLinksFromHtml(html, keyword, options = {}) {
  const raw = String(html || '');
  const tokens = searchTokens(keyword);
  const out = [];
  const seen = new Set();
  const re = /href=["']([^"']*\/products\/[^"'#?]+[^"']*)["']/gi;
  let m;
  while ((m = re.exec(raw))) {
    const link = removeQueryNoise(absUrl(m[1]));
    if (!link || seen.has(link)) continue;
    const start = Math.max(0, m.index - 900);
    const end = Math.min(raw.length, m.index + 1200);
    const nearby = stripHtml(raw.slice(start, end));
    const norm = normalizeSearchText(`${link} ${nearby}`);
    const matched = options.takeAll || !tokens.length || tokens.some((t) => norm.includes(t));
    if (!matched) continue;
    seen.add(link);
    out.push({ url: link, nearby });
  }
  return out;
}

async function searchPublicWebsiteProducts(keyword, limit) {
  const cfg = config();
  const base = cfg.storeUrl;
  const kw = clean(keyword);
  const tokens = searchTokens(kw);
  const searchUrls = [
    `${base}/search?q=${encodeURIComponent(kw)}`,
    `${base}/search?type=product&q=${encodeURIComponent(kw)}`,
    `${base}/collections/all?q=${encodeURIComponent(kw)}`,
    `${base}/collections/all?search=${encodeURIComponent(kw)}`,
  ];
  const collectionPages = [];
  for (let p = 1; p <= 12; p++) collectionPages.push(`${base}/collections/all${p > 1 ? `?page=${p}` : ''}`);

  const links = [];
  const seenLinks = new Set();
  const attempts = [];
  const addLinks = (items) => {
    for (const item of items) {
      const u = removeQueryNoise(item.url);
      if (!u || seenLinks.has(u)) continue;
      seenLinks.add(u);
      links.push(item);
      if (links.length >= Math.max(limit * 4, 20)) break;
    }
  };

  for (const url of searchUrls) {
    try {
      const res = await fetchTextUrl(url);
      attempts.push({ url, status: res.status, ok: res.ok, links: 0, mode: 'public-search' });
      if (!res.ok) continue;
      const got = productLinksFromHtml(res.text, kw, { takeAll: true });
      attempts[attempts.length - 1].links = got.length;
      addLinks(got);
      if (links.length >= limit) break;
    } catch (err) {
      attempts.push({ url, status: 0, ok: false, error: String(err && err.message || err), mode: 'public-search' });
    }
  }

  if (links.length < limit) {
    for (const url of collectionPages) {
      try {
        const res = await fetchTextUrl(url);
        attempts.push({ url, status: res.status, ok: res.ok, links: 0, mode: 'public-collection' });
        if (!res.ok) continue;
        const got = productLinksFromHtml(res.text, kw, { takeAll: false });
        attempts[attempts.length - 1].links = got.length;
        addLinks(got);
        if (links.length >= Math.max(limit * 2, 12)) break;
        // 若該頁完全沒有商品連結，通常代表已超過最後一頁。
        if (!productLinksFromHtml(res.text, '', { takeAll: true }).length && url.includes('?page=')) break;
      } catch (err) {
        attempts.push({ url, status: 0, ok: false, error: String(err && err.message || err), mode: 'public-collection' });
      }
    }
  }

  const rows = [];
  const seenRows = new Set();
  for (const item of links) {
    if (rows.length >= limit) break;
    try {
      const page = await fetchTextUrl(item.url);
      attempts.push({ url: item.url, status: page.status, ok: page.ok, mode: 'public-product' });
      if (!page.ok) continue;
      const row = parseProductFromHtml(page.text, item.url);
      const norm = normalizeSearchText(`${row.name} ${row.note} ${row.url} ${item.nearby}`);
      if (tokens.length && !tokens.some((t) => norm.includes(t))) continue;
      const key = clean(row.url || row.productId || row.name);
      if (!key || seenRows.has(key)) continue;
      seenRows.add(key);
      rows.push(row);
    } catch (err) {
      attempts.push({ url: item.url, status: 0, ok: false, error: String(err && err.message || err), mode: 'public-product' });
    }
  }

  return { rows, attempts, linkCount: links.length };
}

function mergeRowsUnique(primaryRows, extraRows, limit) {
  const rows = [];
  const seen = new Set();
  const add = (row) => {
    if (!row) return;
    const key = clean(row.productId || row.url || row.name).toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };
  (primaryRows || []).forEach(add);
  (extraRows || []).forEach(add);
  return rows.slice(0, limit);
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

exports.searchTeacherWebsiteGoods = onCall(Object.assign({}, HTTPS_CALLABLE_OPTIONS, { timeoutSeconds: 180, memory: '1GiB' }), async (request) => {
  const data = request.data || {};
  const keyword = clean(data.keyword || '');
  if (!keyword) return { ok: true, rows: [], list: [], message: '請輸入搜尋關鍵字。' };

  const cfg = config();
  const limit = Math.max(1, Math.min(Number(data.limit || cfg.defaultSearchLimit || 12) || 12, 50));
  const fetchLimit = Math.max(10, Math.min(Number(data.fetchLimit || cfg.fetchLimit || 50) || 50, 100));
  const maxPages = Math.max(1, Math.min(Number(data.maxPages || cfg.maxPages || 60) || 60, 100));
  const tokens = searchTokens(keyword);
  const rows = [];
  const seen = new Set();
  const attempts = [];
  let connected = false;
  let hasProducts = false;
  let rawProductCount = 0;

  // 第一層：正式 EasyStore API。這會拿到比較乾淨的價格、圖片與商品資料。
  for (let page = 1; page <= maxPages; page++) {
    const pageRes = await fetchProductsPage(page, fetchLimit);
    attempts.push({
      url: pageRes.url,
      status: pageRes.status,
      isJson: pageRes.ok,
      count: pageRes.count,
      preview: pageRes.preview,
      error: pageRes.error || '',
      mode: 'easystore-api',
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

  // 第二層：公開官網頁面備援。
  // 有些商品在公開官網看得到，但 API 權限、分頁或商品欄位沒有回來；這時改掃官網公開頁。
  let publicRows = [];
  let publicDebug = null;
  if (rows.length < limit) {
    try {
      const publicRes = await searchPublicWebsiteProducts(keyword, limit - rows.length);
      publicRows = publicRes.rows || [];
      publicDebug = {
        rows: publicRows.length,
        linkCount: publicRes.linkCount || 0,
        attempts: (publicRes.attempts || []).slice(0, 30),
      };
    } catch (err) {
      publicDebug = { rows: 0, error: String(err && err.message || err) };
    }
  }

  const finalRows = mergeRowsUnique(rows, publicRows, limit);
  try { await cacheRows(finalRows); } catch (err) { console.warn('websiteProducts cache failed:', err); }

  let message = '已完成官網商品搜尋。';
  if (!finalRows.length) {
    if (hasProducts) message = 'API 已讀到商品，但目前關鍵字沒有命中；公開官網備援也沒有找到。';
    else if (connected) message = 'API 有回應，但目前沒有讀到商品列表；公開官網備援也沒有找到。';
    else message = '目前無法連到 EasyStore API；公開官網備援也沒有找到。';
  }

  return {
    ok: true,
    rows: finalRows,
    list: finalRows,
    source: finalRows.length && rows.length === 0 ? '公司官網公開頁面備援' : 'Firebase Function / EasyStore API + 官網公開頁面備援',
    message,
    debug: {
      connected,
      hasProducts,
      totalRows: finalRows.length,
      apiMatchedRows: rows.length,
      publicMatchedRows: publicRows.length,
      rawProductCount,
      endpoint: '/api/3.0/products.json',
      tokens,
      attempts,
      publicDebug,
    },
  };
});


/* =========================================================
 * LINE 綁定 Webhook 2026-06-09 / 2026-06-09b
 * ---------------------------------------------------------
 * 核心規則：
 * 1) LINE 事件只能可靠知道「實際發訊息的 LINE source.userId」。
 * 2) 主管 / 員工身份必須由 Firestore 帳號資料判斷，不能只相信文字裡的 Email。
 * 3) 一支 LINE 只能綁一種身份；主管 LINE 不可拿去綁員工 Email。
 *
 * 支援指令：
 * - 柚子主管綁定 admin@example.com  → 只綁主管 / 管理者通知收件人
 * - 柚子員工綁定 user@example.com   → 只綁員工 / 工讀 / 外聘老師
 *
 * 安全規則：舊指令「柚子綁定 email」已停用，避免主管手機誤綁員工。
 * ========================================================= */
function lineReplyToken(row = {}) {
  return clean(row.replyToken || row.reply_token || '');
}

function lineSourceUserId(event = {}) {
  const source = event.source || {};
  return clean(source.userId || source.user_id || '');
}

function lineEventText(event = {}) {
  const msg = event.message || {};
  if (msg.type !== 'text') return '';
  return clean(msg.text || '');
}

function lowerLineText(value) {
  return clean(value).toLowerCase();
}

function truthyLineValue(value) {
  const s = lowerLineText(value);
  return value === true || value === 1 || ['1', 'true', 'yes', 'y', 'on', '是', '啟用', '開啟', 'active', 'enabled'].includes(s);
}

function lineEmailOf(data = {}) {
  return lowerLineText(data.email || data.Email || data['Email'] || data.loginAccount || data['登入帳號']);
}

function lineNameOf(data = {}) {
  return clean(data.name || data['姓名'] || data.displayName || data.lineDisplayName || data['LINE 顯示名稱'] || data.email || data.loginAccount || '');
}

function lineAccountIdOf(data = {}, docId = '') {
  return clean(data.employeeId || data.adminId || data.managerId || data.userId || data.id || data['員工ID'] || data['管理者代碼'] || docId);
}

function lineUserIdOfRecord(data = {}) {
  return clean(data.lineUserId || data['LINE User ID'] || data.targetLineUserId || data.toLineUserId || '');
}

function isManagerLineAccount(data = {}, collection = '', docId = '') {
  if (collection === 'admins') return true;
  const role = lowerLineText(data.role || data['角色']);
  const identity = lowerLineText(data.identityType || data.identityLabel || data['身分類型'] || data['身份類型']);
  const id = lineAccountIdOf(data, docId);
  if (id === 'PRIMARY_MANAGER_LINE' || docId === 'PRIMARY_MANAGER_LINE') return true;
  if (['admin', 'manager', '主管', '管理者'].includes(role)) return true;
  if (['admin', 'manager', '主管', '管理者', '主管收件人'].includes(identity)) return true;
  return truthyLineValue(data.showSettingsZone || data.canViewSettings || data.isManagerAccount || data['管理區權限'] || data['管理權限'] || data['可看設定區']);
}

function makeLineAccount(doc, collection) {
  const data = (doc && typeof doc.data === 'function') ? (doc.data() || {}) : (doc || {});
  const docId = clean(doc && doc.id ? doc.id : data.__id);
  const kind = isManagerLineAccount(data, collection, docId) ? 'manager' : 'employee';
  return {
    ref: doc && doc.ref ? doc.ref : null,
    collection,
    docId,
    id: lineAccountIdOf(data, docId),
    email: lineEmailOf(data),
    name: lineNameOf(data),
    lineUserId: lineUserIdOfRecord(data),
    kind,
    data,
  };
}

function sameLineAccount(a, b) {
  return a && b && a.collection === b.collection && clean(a.docId) === clean(b.docId);
}

function describeLineAccount(account) {
  if (!account) return '未知帳號';
  const role = account.kind === 'manager' ? '主管/管理者' : '員工';
  const name = clean(account.name || account.email || account.id || account.docId || '未命名');
  const email = clean(account.email);
  return `${role}「${name}${email ? ' / ' + email : ''}」`;
}

function verifyLineSignature(req) {
  const secret = clean(process.env.LINE_CHANNEL_SECRET || process.env.LINE_BOT_CHANNEL_SECRET || process.env.LINE_SECRET || '');
  if (!secret) return true; // 未設定 secret 時不阻擋，但正式環境建議設定。
  const sig = clean(req.get('x-line-signature') || req.get('X-Line-Signature') || '');
  if (!sig || !req.rawBody) return false;
  const digest = crypto.createHmac('sha256', secret).update(req.rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest));
  } catch (err) {
    return false;
  }
}

async function replyLineMessage(replyToken, text) {
  const token = await getLineAccessToken();
  if (!replyToken || !token) return false;
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: String(text || '').slice(0, 4900) }] }),
  });
  return res.ok;
}

function parseLineBindCommand(text) {
  const raw = clean(text).replace(/\s+/g, ' ');

  // 舊指令停用：它沒有明確身份，容易造成主管手機誤綁員工。
  const legacy = raw.match(/^柚子綁定\s+([^\s]+@[^\s]+)$/i);
  if (legacy) {
    return {
      legacyCommand: true,
      email: clean(legacy[1]).toLowerCase(),
    };
  }

  const m = raw.match(/^柚子(主管|員工)綁定\s+([^\s]+@[^\s]+)$/i);
  if (!m) {
    if (/^柚子.*綁定/i.test(raw) || raw.includes('綁定')) {
      return { invalidBindCommand: true };
    }
    return null;
  }
  const kindWord = clean(m[1]);
  return {
    requestedKind: kindWord === '主管' ? 'manager' : 'employee',
    email: clean(m[2]).toLowerCase(),
  };
}

async function getCollectionRowsForLine(collection, limit = 1000) {
  const snap = await db.collection(collection).limit(limit).get();
  const rows = [];
  snap.forEach((doc) => rows.push(makeLineAccount(doc, collection)));
  return rows;
}

async function findLineAccountsByEmail(email) {
  const targetEmail = lowerLineText(email);
  const rows = [];
  const seen = new Set();
  const add = (account) => {
    if (!account || !account.docId) return;
    const key = `${account.collection}/${account.docId}`;
    if (seen.has(key)) return;
    if (account.email !== targetEmail) return;
    seen.add(key);
    rows.push(account);
  };

  // 先用索引查，再掃描備援，避免 Email 大小寫或欄位名稱不同找不到。
  const queryDefs = [
    ['admins', 'email'], ['admins', 'loginAccount'], ['admins', 'Email'],
    ['employees', 'email'], ['employees', 'Email'],
  ];
  for (const [collection, field] of queryDefs) {
    try {
      const snap = await db.collection(collection).where(field, '==', targetEmail).limit(10).get();
      snap.forEach((doc) => add(makeLineAccount(doc, collection)));
    } catch (err) {
      // Firestore 欄位不存在或索引問題時，下面還有掃描備援。
    }
  }

  for (const collection of ['admins', 'employees']) {
    try {
      const all = await getCollectionRowsForLine(collection, 1000);
      all.forEach(add);
    } catch (err) {
      // ignore collection not existing
    }
  }

  rows.sort((a, b) => {
    if (a.kind === 'manager' && b.kind !== 'manager') return -1;
    if (a.kind !== 'manager' && b.kind === 'manager') return 1;
    return clean(a.name).localeCompare(clean(b.name), 'zh-Hant');
  });
  return rows;
}

async function findLineAccountsByLineUserId(lineUserId) {
  const target = clean(lineUserId);
  if (!target) return [];
  const rows = [];
  const seen = new Set();
  const add = (account) => {
    if (!account || !account.docId) return;
    const key = `${account.collection}/${account.docId}`;
    if (seen.has(key)) return;
    if (clean(account.lineUserId) !== target) return;
    seen.add(key);
    rows.push(account);
  };
  for (const collection of ['admins', 'employees']) {
    try {
      const all = await getCollectionRowsForLine(collection, 1000);
      all.forEach(add);
    } catch (err) {
      // ignore collection not existing
    }
  }
  rows.sort((a, b) => {
    if (a.kind === 'manager' && b.kind !== 'manager') return -1;
    if (a.kind !== 'manager' && b.kind === 'manager') return 1;
    return clean(a.name).localeCompare(clean(b.name), 'zh-Hant');
  });
  return rows;
}

async function findTargetAccountForLineBind(email, requestedKind) {
  const matches = await findLineAccountsByEmail(email);
  if (!matches.length) return { ok: false, reason: 'not_found', matches: [] };
  if (requestedKind === 'manager') {
    const managers = matches.filter((x) => x.kind === 'manager');
    if (!managers.length) return { ok: false, reason: 'not_manager', matches };
    return { ok: true, target: managers[0], matches };
  }
  if (requestedKind === 'employee') {
    const employees = matches.filter((x) => x.kind === 'employee');
    if (!employees.length) return { ok: false, reason: 'not_employee', matches };
    return { ok: true, target: employees[0], matches };
  }

  // 沒指定時：Email 若屬於 admins / manager，就當主管；否則才當員工。
  const manager = matches.find((x) => x.kind === 'manager');
  if (manager) return { ok: true, target: manager, matches };
  return { ok: true, target: matches[0], matches };
}

async function validateLineCanBindToTarget(lineUserId, target) {
  const existing = await findLineAccountsByLineUserId(lineUserId);
  const same = existing.filter((x) => sameLineAccount(x, target));
  const others = existing.filter((x) => !sameLineAccount(x, target));
  const otherManagers = others.filter((x) => x.kind === 'manager');
  const otherEmployees = others.filter((x) => x.kind === 'employee');

  if (target.kind === 'employee') {
    if (otherManagers.length) {
      return {
        ok: false,
        message: `綁定已擋下：這支 LINE 已被設定為${describeLineAccount(otherManagers[0])}，不能再綁員工 Email。請員工用自己的手機 LINE 綁定。`,
      };
    }
    if (otherEmployees.length) {
      return {
        ok: false,
        message: `綁定已擋下：這支 LINE 已綁在${describeLineAccount(otherEmployees[0])}，不能再綁另一位員工。若綁錯，請先到員工管理清除原本的 LINE 綁定。`,
      };
    }
    const targetOldLine = clean(target.lineUserId);
    if (targetOldLine && targetOldLine !== clean(lineUserId)) {
      return {
        ok: false,
        message: `綁定已擋下：${describeLineAccount(target)} 已綁定另一支 LINE。請先到員工管理按「清除此員工 LINE 綁定」後，再由本人手機重新綁定。`,
      };
    }
  }

  if (target.kind === 'manager') {
    if (otherEmployees.length) {
      return {
        ok: false,
        message: `綁定已擋下：這支 LINE 目前綁在${describeLineAccount(otherEmployees[0])}，不能直接改成主管通知帳號。請先清除原本員工 LINE 綁定。`,
      };
    }
  }

  return { ok: true, existing, same };
}

async function logLineBinding(type, payload = {}) {
  try {
    await db.collection('lineBindLogs').add(Object.assign({}, payload, {
      type,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtText: new Date().toISOString(),
      source: 'line-webhook-strict-role-bind',
    }));
  } catch (err) {
    console.warn('[lineBindLogs failed]', err);
  }
}

async function bindManagerLineAccount(target, lineUserId, email, event) {
  const name = clean(target.name || email || '柚子樂器主要管理者');
  const nowText = new Date().toISOString();
  const managerRow = {
    employeeId: 'PRIMARY_MANAGER_LINE',
    id: 'PRIMARY_MANAGER_LINE',
    name,
    email,
    role: 'manager',
    identityType: 'manager',
    identityLabel: '主管收件人',
    showSettingsZone: true,
    isPrimaryManagerLineRecipient: true,
    hiddenFromActiveLists: true,
    accountStatus: 'active',
    employmentStatus: 'active',
    lineUserId,
    'LINE User ID': lineUserId,
    lineNotifyEnabled: true,
    'LINE 通知啟用': true,
    lineBindingRole: 'manager',
    lineBoundAt: admin.firestore.FieldValue.serverTimestamp(),
    lineBoundAtText: nowText,
    lineBindEmail: email,
    lineBindSource: clean((event.source || {}).type || 'user'),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText,
    source: 'line-webhook-manager-bind',
  };
  await db.collection('employees').doc('PRIMARY_MANAGER_LINE').set(managerRow, { merge: true });

  if (target.ref && target.collection === 'admins') {
    await target.ref.set({
      lineUserId,
      'LINE User ID': lineUserId,
      lineNotifyEnabled: true,
      'LINE 通知啟用': true,
      lineBindingRole: 'manager',
      lineBoundAt: admin.firestore.FieldValue.serverTimestamp(),
      lineBoundAtText: nowText,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: nowText,
      source: 'line-webhook-admin-bind',
    }, { merge: true });
  }

  await logLineBinding('manager_bind', {
    accountCollection: target.collection,
    accountDocId: target.docId,
    employeeId: 'PRIMARY_MANAGER_LINE',
    name,
    email,
    lineUserId,
    eventType: clean(event.type || ''),
  });

  return { ok: true, kind: 'manager', name, email };
}

async function bindEmployeeLineAccount(target, lineUserId, email, event) {
  if (!target.ref) throw new Error('找不到可更新的員工文件');
  const nowText = new Date().toISOString();
  await target.ref.set({
    lineUserId,
    'LINE User ID': lineUserId,
    lineNotifyEnabled: true,
    'LINE 通知啟用': true,
    lineBindingRole: 'employee',
    lineBoundAt: admin.firestore.FieldValue.serverTimestamp(),
    lineBoundAtText: nowText,
    lineBindEmail: email,
    lineBindSource: clean((event.source || {}).type || 'user'),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText,
    source: 'line-webhook-employee-bind',
  }, { merge: true });

  await logLineBinding('employee_bind', {
    accountCollection: target.collection,
    accountDocId: target.docId,
    employeeId: target.id,
    name: target.name,
    email,
    lineUserId,
    eventType: clean(event.type || ''),
  });

  return { ok: true, kind: 'employee', name: target.name, email };
}

async function handleLineBindEvent(event) {
  const text = lineEventText(event);
  const command = parseLineBindCommand(text);
  if (!command) return { handled: false };

  const replyToken = lineReplyToken(event);
  if (command.legacyCommand) {
    await replyLineMessage(replyToken, `舊綁定指令已停用，避免誤綁。
員工請輸入：柚子員工綁定 ${command.email}
主管請輸入：柚子主管綁定 主管Email`);
    await logLineBinding('blocked_legacy_bind_command', {
      email: command.email,
      reason: 'legacy_command_disabled',
    });
    return { handled: true, ok: false, blocked: true, reason: 'legacy_command_disabled', email: command.email };
  }
  if (command.invalidBindCommand) {
    await replyLineMessage(replyToken, '綁定格式錯誤。
員工請輸入：柚子員工綁定 your@email.com
主管請輸入：柚子主管綁定 manager@email.com');
    return { handled: true, ok: false, reason: 'invalid_bind_format' };
  }

  const lineUserId = lineSourceUserId(event);
  if (!lineUserId) {
    await replyLineMessage(replyToken, '綁定失敗：系統沒有取得你的 LINE User ID。請確認你是在柚子樂器官方 LINE 內直接傳送綁定文字。');
    return { handled: true, ok: false, reason: 'missing_line_user_id' };
  }

  const targetResult = await findTargetAccountForLineBind(command.email, command.requestedKind);
  if (!targetResult.ok) {
    let msg = `綁定失敗：找不到 ${command.email} 對應的帳號資料。請確認 Email 是否和員工系統資料完全相同。`;
    if (targetResult.reason === 'not_manager') msg = `綁定失敗：${command.email} 不是主管/管理者帳號，不能用「柚子主管綁定」。`;
    if (targetResult.reason === 'not_employee') msg = `綁定失敗：${command.email} 不是員工帳號，不能用「柚子員工綁定」。`;
    await replyLineMessage(replyToken, msg);
    return { handled: true, ok: false, reason: targetResult.reason, email: command.email };
  }

  const target = targetResult.target;
  const allowed = await validateLineCanBindToTarget(lineUserId, target);
  if (!allowed.ok) {
    await replyLineMessage(replyToken, allowed.message);
    await logLineBinding('blocked_bind', {
      email: command.email,
      requestedKind: command.requestedKind,
      targetKind: target.kind,
      targetCollection: target.collection,
      targetDocId: target.docId,
      targetName: target.name,
      lineUserId,
      reason: allowed.message,
    });
    return { handled: true, ok: false, blocked: true, reason: allowed.message, email: command.email, targetKind: target.kind };
  }

  const result = target.kind === 'manager'
    ? await bindManagerLineAccount(target, lineUserId, command.email, event)
    : await bindEmployeeLineAccount(target, lineUserId, command.email, event);

  if (result.kind === 'manager') {
    await replyLineMessage(replyToken, `主管 LINE 綁定成功：${result.name}\n之後主管通知會優先送到這支 LINE。`);
  } else {
    await replyLineMessage(replyToken, `員工 LINE 綁定成功：${result.name || result.email}\n之後個人通知會送到這支 LINE。`);
  }
  return { handled: true, ok: true, kind: result.kind, email: command.email };
}

exports.lineWebhook = onRequest({ region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('LINE webhook is ready. Strict role binding is active.');
    return;
  }
  if (!verifyLineSignature(req)) {
    res.status(403).send('Invalid LINE signature');
    return;
  }
  const body = req.body || {};
  const events = Array.isArray(body.events) ? body.events : [];
  const results = [];
  for (const event of events) {
    try {
      results.push(await handleLineBindEvent(event));
    } catch (err) {
      console.error('[lineWebhook failed]', err);
      const replyToken = lineReplyToken(event);
      await replyLineMessage(replyToken, '綁定處理失敗：系統暫時無法完成綁定，請稍後再試或通知管理者。');
      results.push({ handled: true, ok: false, error: err && err.message ? err.message : String(err) });
    }
  }
  res.status(200).json({ ok: true, results });
});


/* =========================================================
 * LINE / Email 通知佇列發送器 2026-06-03
 * ---------------------------------------------------------
 * 前端會把通知寫入 Firestore：notificationQueue/{queueId}
 * 這裡負責真的送出：
 * - channel = line  → LINE Messaging API push message
 * - channel = email → SendGrid（有設定 SENDGRID_API_KEY 時）
 *
 * LINE Token 建議放 functions/.env：
 * LINE_CHANNEL_ACCESS_TOKEN=你的 LINE Messaging API Channel access token
 *
 * 也支援暫時放 Firestore systemSettings：
 * key/value 其中 key 為「LINE Channel Access Token」或「LINE_CHANNEL_ACCESS_TOKEN」
 * ========================================================= */

const QUEUE_COLLECTION = 'notificationQueue';
const SENT_STATUSES = new Set(['sent', '已發送', '已送出', 'done', 'completed', 'success']);
const SENDING_STATUSES = new Set(['sending', '發送中']);
const PENDING_STATUSES = new Set(['pending', '待發送', 'queued', 'queue', '待處理', 'retry']);

function safeId(value) {
  return clean(value).replace(/[\/#?\[\]]/g, '_').slice(0, 180) || db.collection('_ids').doc().id;
}

function asText(value) {
  if (value == null) return '';
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch (err) { return String(value); }
  }
  return String(value);
}

function queueStatus(row = {}) {
  return clean(row.status || row['狀態'] || '待發送');
}

function isPendingQueue(row = {}) {
  const status = queueStatus(row);
  if (SENT_STATUSES.has(status) || SENDING_STATUSES.has(status)) return false;
  return !status || PENDING_STATUSES.has(status) || /^fail|失敗|error/i.test(status);
}

function queueChannel(row = {}) {
  return clean(row.channel || row.type || row.notifyType || row['發送方式']).toLowerCase();
}

function queueTargetLineUserId(row = {}) {
  return clean(row.targetLineUserId || row.lineUserId || row.toLineUserId || row['LINE User ID']);
}

function queueTargetEmail(row = {}) {
  return clean(row.targetEmail || row.email || row.toEmail || row['Email']).toLowerCase();
}

function queueTitle(row = {}) {
  return clean(row.title || row.subject || row.eventName || '柚子樂器通知');
}

function queueBody(row = {}) {
  const body = clean(row.body || row.message || row.content || row.text || row['訊息內容']);
  if (body) return body;
  const title = queueTitle(row);
  return title || '您有一則新的通知。';
}

async function getSystemSettingValue(names) {
  const wanted = (Array.isArray(names) ? names : [names]).map(clean).filter(Boolean);
  for (const name of wanted) {
    try {
      const snap = await db.collection('systemSettings').doc(name).get();
      if (snap.exists) {
        const data = snap.data() || {};
        const value = clean(data.value || data.token || data.accessToken || data.secret || data.text);
        if (value) return value;
      }
    } catch (err) {
      // ignore and try list scan below
    }
  }
  try {
    const snap = await db.collection('systemSettings').limit(200).get();
    let found = '';
    snap.forEach((doc) => {
      if (found) return;
      const data = doc.data() || {};
      const key = clean(data.key || data.name || doc.id);
      if (wanted.includes(key)) found = clean(data.value || data.token || data.accessToken || data.secret || data.text);
    });
    return found;
  } catch (err) {
    return '';
  }
}

async function getLineAccessToken() {
  const token = clean(
    process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    process.env.LINE_MESSAGING_ACCESS_TOKEN ||
    process.env.LINE_ACCESS_TOKEN ||
    process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN ||
    ''
  );
  if (token) return token;
  return await getSystemSettingValue([
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LINE Channel Access Token',
    'LINE Messaging API Token',
    'LINE Access Token',
    'LINE Bot Access Token',
    'LINE_TOKEN'
  ]);
}

async function sendLinePush(row) {
  const to = queueTargetLineUserId(row);
  if (!to) throw new Error('缺少 LINE User ID，無法發送 LINE。');
  const token = await getLineAccessToken();
  if (!token) throw new Error('缺少 LINE_CHANNEL_ACCESS_TOKEN，尚未設定 LINE Messaging API Channel access token。');

  const title = queueTitle(row);
  const body = queueBody(row);
  const text = title && body && title !== body ? `${title}\n${body}` : (body || title || '柚子樂器通知');
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text: text.slice(0, 4900) }],
    }),
  });
  const responseText = await res.text();
  if (!res.ok) {
    throw new Error(`LINE API ${res.status}：${responseText.slice(0, 500)}`);
  }
  return { provider: 'line-messaging-api', responseStatus: res.status, responseText: responseText.slice(0, 500) };
}

async function sendEmailViaSendGrid(row) {
  const to = queueTargetEmail(row);
  if (!to) throw new Error('缺少 Email，無法發送 Email。');
  const apiKey = clean(process.env.SENDGRID_API_KEY || '');
  const from = clean(process.env.SENDGRID_FROM_EMAIL || process.env.MAIL_FROM || '');
  const fromName = clean(process.env.SENDGRID_FROM_NAME || '柚子樂器');
  if (!apiKey || !from) throw new Error('Email 尚未設定 SENDGRID_API_KEY / SENDGRID_FROM_EMAIL。');

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to, name: clean(row.targetName) || undefined }] }],
      from: { email: from, name: fromName },
      subject: queueTitle(row),
      content: [{ type: 'text/plain', value: queueBody(row) }],
    }),
  });
  const responseText = await res.text();
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`SendGrid API ${res.status}：${responseText.slice(0, 500)}`);
  }
  return { provider: 'sendgrid', responseStatus: res.status, responseText: responseText.slice(0, 500) };
}

async function markQueue(docRef, data) {
  await docRef.set(Object.assign({}, data, {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }), { merge: true });
}

async function appendNotificationLog(queueId, data) {
  const id = `${safeId(queueId)}_${Date.now()}`;
  await db.collection('notificationLogs').doc(id).set(Object.assign({
    logId: id,
    queueId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, data || {}), { merge: true });
}

async function processNotificationQueueDoc(docRef, row, options = {}) {
  row = row || {};
  const queueId = clean(row.queueId || docRef.id);
  const channel = queueChannel(row);
  if (!isPendingQueue(row)) return { ok: true, skipped: true, reason: `狀態不是待發送：${queueStatus(row)}` };
  if (!['line', 'email'].includes(channel)) {
    await markQueue(docRef, { status: '發送失敗', lastError: `不支援的發送方式：${channel || '(空白)'}` });
    return { ok: false, skipped: true, reason: 'unsupported-channel' };
  }

  await markQueue(docRef, {
    queueId,
    status: '發送中',
    sendStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    attemptCount: admin.firestore.FieldValue.increment(1),
    processor: options.processor || 'cloud-function',
  });

  try {
    const result = channel === 'line' ? await sendLinePush(row) : await sendEmailViaSendGrid(row);
    await markQueue(docRef, {
      status: '已發送',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      sentAtText: new Date().toISOString(),
      provider: result.provider,
      responseStatus: result.responseStatus,
      responseText: result.responseText || '',
      lastError: '',
    });
    await appendNotificationLog(queueId, {
      status: '已發送',
      channel,
      provider: result.provider,
      targetEmployeeId: clean(row.targetEmployeeId),
      targetName: clean(row.targetName),
      targetEmail: queueTargetEmail(row),
      targetLineUserId: queueTargetLineUserId(row),
      title: queueTitle(row),
      body: queueBody(row),
    });
    return { ok: true, sent: true, channel, queueId };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await markQueue(docRef, {
      status: '發送失敗',
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      failedAtText: new Date().toISOString(),
      lastError: msg,
    });
    await appendNotificationLog(queueId, {
      status: '發送失敗',
      channel,
      error: msg,
      targetEmployeeId: clean(row.targetEmployeeId),
      targetName: clean(row.targetName),
      targetEmail: queueTargetEmail(row),
      targetLineUserId: queueTargetLineUserId(row),
      title: queueTitle(row),
      body: queueBody(row),
    });
    console.error('[notificationQueue send failed]', queueId, msg);
    return { ok: false, error: msg, channel, queueId };
  }
}

exports.sendNotificationQueueOnCreate = onDocumentCreated(`${QUEUE_COLLECTION}/{queueId}`, async (event) => {
  const snap = event.data;
  if (!snap) return null;
  return await processNotificationQueueDoc(snap.ref, snap.data() || {}, { processor: 'onCreate' });
});

exports.flushNotificationQueue = onSchedule({ schedule: 'every 5 minutes', timeoutSeconds: 120, memory: '512MiB' }, async () => {
  const snap = await db.collection(QUEUE_COLLECTION).where('status', 'in', ['待發送', 'pending', 'queued', 'retry']).limit(50).get();
  const results = [];
  for (const doc of snap.docs) {
    results.push(await processNotificationQueueDoc(doc.ref, doc.data() || {}, { processor: 'scheduler' }));
  }
  return results;
});

exports.processNotificationQueueNow = onCall(Object.assign({}, HTTPS_CALLABLE_OPTIONS, { timeoutSeconds: 120, memory: '512MiB' }), async (request) => {
  const data = request.data || {};
  const queueId = clean(data.queueId || '');
  const limit = Math.max(1, Math.min(Number(data.limit || 20) || 20, 50));
  if (queueId) {
    const ref = db.collection(QUEUE_COLLECTION).doc(queueId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, message: '找不到通知佇列資料。' };
    const result = await processNotificationQueueDoc(ref, snap.data() || {}, { processor: 'callable' });
    return Object.assign({ ok: result.ok !== false }, result);
  }
  const snap = await db.collection(QUEUE_COLLECTION).where('status', 'in', ['待發送', 'pending', 'queued', 'retry']).limit(limit).get();
  const results = [];
  for (const doc of snap.docs) {
    results.push(await processNotificationQueueDoc(doc.ref, doc.data() || {}, { processor: 'callable' }));
  }
  return { ok: true, count: results.length, results };
});
