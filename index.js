'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

// 2026-06-03 CORS 修正：
// 前端目前從 GitHub Pages 呼叫 Firebase Callable Function。
// 若沒有明確允許來源，瀏覽器會在 OPTIONS preflight 階段擋下請求，
// Console 會出現 No 'Access-Control-Allow-Origin' / net::ERR_FAILED。
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

exports.searchTeacherWebsiteGoods = onCall(Object.assign({}, HTTPS_CALLABLE_OPTIONS, { timeoutSeconds: 60, memory: '512MiB' }), async (request) => {
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
