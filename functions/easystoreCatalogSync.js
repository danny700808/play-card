'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

const EASYSTORE_ACCESS_TOKEN = defineSecret('EASYSTORE_ACCESS_TOKEN');
const STORE_URL = 'https://www.mingtinghuang.com';
const API_BASE_PATH = '/api/3.0';
const REGION = 'us-central1';
const SYNC_LOCK_MS = 15 * 60 * 1000;
const MIN_SYNC_INTERVAL_MS = 60 * 1000;

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
  const parsed = Number(String(value).replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function absoluteUrl(value) {
  const raw = clean(value);
  if (!raw) return '';
  try {
    return new URL(raw, STORE_URL).href;
  } catch (_) {
    return '';
  }
}

function stableId(value) {
  return crypto.createHash('sha256').update(clean(value)).digest('hex').slice(0, 40);
}

function pushImage(list, value) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((item) => pushImage(list, item));
    return;
  }
  if (typeof value === 'object') {
    [
      'src', 'url', 'imageUrl', 'image_url', 'original', 'original_url',
      'large', 'medium', 'small', 'secure_url', 'downloadURL', 'public_url'
    ].forEach((key) => {
      if (value[key]) pushImage(list, value[key]);
    });
    [
      'images', 'photos', 'media', 'gallery', 'imageUrls', 'image_urls',
      'additionalImages', 'additional_images'
    ].forEach((key) => {
      if (value[key]) pushImage(list, value[key]);
    });
    return;
  }
  const url = absoluteUrl(value);
  if (url && !list.includes(url)) list.push(url);
}

function collectImages(object) {
  const images = [];
  if (!object || typeof object !== 'object') return images;
  [
    'image', 'imageUrl', 'image_url', 'featuredImage', 'featured_image',
    'mainImage', 'main_image', 'thumbnail', 'picture', 'photo', 'images',
    'photos', 'media', 'gallery', 'imageUrls', 'image_urls',
    'additionalImages', 'additional_images'
  ].forEach((key) => pushImage(images, object[key]));
  return images;
}

function extractProducts(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['products', 'data', 'items', 'results']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.data && typeof payload.data === 'object') {
    for (const key of ['products', 'items', 'results']) {
      if (Array.isArray(payload.data[key])) return payload.data[key];
    }
  }
  return [];
}

function productVariants(product) {
  const candidates = [
    product.variants,
    product.product_variants,
    product.productVariants,
    product.skus,
    product.items
  ];
  for (const value of candidates) {
    if (Array.isArray(value) && value.length) return value;
  }
  if (product.sku || product.code || product.product_code) return [product];
  return [];
}

function productName(product) {
  return clean(product.title || product.name || product.product_title || product.productName);
}

function productLink(product) {
  const direct = absoluteUrl(
    product.url || product.product_url || product.permalink ||
    product.handle_url || product.online_url
  );
  if (direct) return direct;
  const handle = clean(product.handle || product.slug);
  return handle ? `${STORE_URL.replace(/\/$/, '')}/products/${encodeURIComponent(handle)}` : '';
}

function rowSku(variant, product) {
  return normalizeSku(
    variant.sku || variant.code || variant.product_code || variant.productCode ||
    product.sku || product.code || product.product_code || product.productCode
  );
}

function rowPrice(variant, product) {
  return numberOrNull(
    variant.price ?? variant.sale_price ?? variant.salePrice ?? variant.regular_price ??
    product.price ?? product.sale_price ?? product.salePrice ?? product.regular_price
  );
}

function rowVariantName(variant) {
  return clean(
    variant.title || variant.name || variant.option_name || variant.optionName ||
    variant.variant_title || variant.variantTitle || variant.display_name
  );
}

function buildCatalog(products) {
  const rows = [];
  const countsBySku = new Map();

  products.forEach((product) => {
    const parentImages = collectImages(product);
    const variants = productVariants(product);
    const pName = productName(product);
    const pId = clean(product.id || product.product_id || product.productId || product._id);
    const pUrl = productLink(product);

    variants.forEach((variant) => {
      const sku = rowSku(variant, product);
      if (!sku) return;
      const variantImages = collectImages(variant);
      const imageUrls = [];
      [...parentImages, ...variantImages].forEach((url) => {
        if (url && !imageUrls.includes(url)) imageUrls.push(url);
      });

      const row = {
        sku,
        productId: pId,
        variantId: clean(variant.id || variant.variant_id || variant.variantId || variant._id),
        productName: pName,
        variantName: rowVariantName(variant),
        price: rowPrice(variant, product),
        productUrl: pUrl,
        parentImageUrls: parentImages.slice(0, 8),
        variantImageUrls: variantImages.slice(0, 8),
        imageUrls: imageUrls.slice(0, 8)
      };
      rows.push(row);
      countsBySku.set(sku, (countsBySku.get(sku) || 0) + 1);
    });
  });

  const duplicateSkus = new Set(
    [...countsBySku.entries()].filter(([, count]) => count > 1).map(([sku]) => sku)
  );

  return { rows, duplicateSkus };
}

function isAllowedCaller(request) {
  if (request.auth && request.auth.uid) return true;
  const rawOrigin = clean(
    request.rawRequest &&
    (request.rawRequest.headers.origin || request.rawRequest.headers.referer)
  );
  if (!rawOrigin) return false;
  try {
    const url = new URL(rawOrigin);
    const host = url.hostname.toLowerCase();
    return host === 'danny700808.github.io' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.web.app') ||
      host.endsWith('.firebaseapp.com');
  } catch (_) {
    return false;
  }
}

async function apiRequest(url, token, attempt = 0) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'EasyStore-Access-Token': token,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  });

  const text = await response.text();
  if (response.status === 429 && attempt < 5) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30000, 1000 * (2 ** attempt));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return apiRequest(url, token, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`EasyStore HTTP ${response.status}: ${text.slice(0, 800)}`);
  }

  let payload = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new Error(`EasyStore 回傳不是 JSON：${text.slice(0, 800)}`);
    }
  }

  return {
    payload,
    rateRemaining: numberOrNull(response.headers.get('x-ratelimit-remaining')),
    rateLimit: numberOrNull(response.headers.get('x-ratelimit-limit'))
  };
}

async function fetchAllProducts(token) {
  const products = [];
  const seen = new Set();
  let lastRateRemaining = null;
  let lastRateLimit = null;

  for (let page = 1; page <= 500; page += 1) {
    const url = `${STORE_URL.replace(/\/$/, '')}${API_BASE_PATH}/products.json?page=${page}&limit=100`;
    const result = await apiRequest(url, token);
    lastRateRemaining = result.rateRemaining;
    lastRateLimit = result.rateLimit;
    const pageProducts = extractProducts(result.payload);
    if (!pageProducts.length) break;

    let fresh = 0;
    pageProducts.forEach((product) => {
      const id = clean(
        product.id || product.product_id || product.productId || product._id ||
        `${productName(product)}|${JSON.stringify(product).slice(0, 160)}`
      );
      if (seen.has(id)) return;
      seen.add(id);
      products.push(product);
      fresh += 1;
    });

    if (!fresh || pageProducts.length < 100) break;
    if (lastRateRemaining !== null && lastRateRemaining <= 2) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }

  return { products, rateRemaining: lastRateRemaining, rateLimit: lastRateLimit };
}

function fieldChanged(oldValue, newValue) {
  if (Array.isArray(oldValue) || Array.isArray(newValue)) {
    return JSON.stringify(oldValue || []) !== JSON.stringify(newValue || []);
  }
  return oldValue !== newValue;
}

function hasAnyChange(existing, update) {
  return Object.keys(update).some((key) => fieldChanged(existing[key], update[key]));
}

async function commitOperations(operations, chunkSize = 400) {
  let written = 0;
  for (let i = 0; i < operations.length; i += chunkSize) {
    const batch = admin.firestore().batch();
    operations.slice(i, i + chunkSize).forEach((operation) => {
      batch.set(operation.ref, operation.data, { merge: true });
    });
    await batch.commit();
    written += Math.min(chunkSize, operations.length - i);
  }
  return written;
}

async function acquireLock(db, force) {
  const ref = db.collection('opsSettings').doc('easyStoreCatalogSyncLock');
  const now = Date.now();
  let cached = null;

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? snapshot.data() || {} : {};
    const expiresAt = data.expiresAt && typeof data.expiresAt.toMillis === 'function'
      ? data.expiresAt.toMillis()
      : 0;
    const completedAt = data.completedAt && typeof data.completedAt.toMillis === 'function'
      ? data.completedAt.toMillis()
      : 0;

    if (data.status === 'running' && expiresAt > now) {
      throw new HttpsError('already-exists', 'EasyStore 同步正在執行，請稍後再試。');
    }

    if (!force && completedAt && now - completedAt < MIN_SYNC_INTERVAL_MS) {
      cached = data.lastResult || null;
      return;
    }

    transaction.set(ref, {
      status: 'running',
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(now + SYNC_LOCK_MS),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  return { ref, cached };
}

async function saveCatalogRows(db, rows, runId) {
  const operations = rows.map((row) => {
    const id = stableId(`${row.sku}|${row.productId}|${row.variantId}`);
    return {
      ref: db.collection('opsEasyStoreCatalog').doc(id),
      data: {
        ...row,
        source: 'EasyStore API',
        syncRunId: runId,
        syncedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    };
  });
  return commitOperations(operations);
}

async function matchCentralProducts(db, catalogRows, duplicateSkus) {
  const grouped = new Map();
  catalogRows.forEach((row) => {
    if (!grouped.has(row.sku)) grouped.set(row.sku, []);
    grouped.get(row.sku).push(row);
  });

  const centralSnapshot = await db.collection('opsInternalProducts').get();
  const operations = [];
  let matchedCount = 0;
  let imageMatchedCount = 0;
  let duplicateMatchCount = 0;
  let unmatchedCount = 0;

  centralSnapshot.docs.forEach((document) => {
    const existing = document.data() || {};
    const sku = normalizeSku(
      existing.internalSku || existing.sku || existing.code || existing.productCode
    );
    if (!sku) return;

    const rows = grouped.get(sku) || [];
    let update;

    if (rows.length === 1 && !duplicateSkus.has(sku)) {
      const row = rows[0];
      matchedCount += 1;
      if (row.imageUrls.length) imageMatchedCount += 1;
      update = {
        easyStoreMatched: true,
        easyStoreMatchStatus: 'matched',
        sourceCollection: 'EasyStore API',
        sourceProductId: row.productId,
        sourceVariantId: row.variantId,
        onlineName: row.productName,
        variantName: row.variantName,
        onlinePrice: row.price,
        onlineUrl: row.productUrl,
        imageUrl: row.imageUrls[0] || '',
        imageUrls: row.imageUrls,
        parentImageUrls: row.parentImageUrls || [],
        variantImageUrls: row.variantImageUrls || [],
        easyStoreSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
    } else if (rows.length > 1 || duplicateSkus.has(sku)) {
      duplicateMatchCount += 1;
      update = {
        easyStoreMatched: false,
        easyStoreMatchStatus: 'duplicate-sku',
        easyStoreMatchCount: rows.length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
    } else {
      unmatchedCount += 1;
      if (existing.sourceCollection === 'EasyStore API' || existing.easyStoreMatched) {
        update = {
          easyStoreMatched: false,
          easyStoreMatchStatus: 'unmatched',
          sourceCollection: admin.firestore.FieldValue.delete(),
          sourceProductId: admin.firestore.FieldValue.delete(),
          sourceVariantId: admin.firestore.FieldValue.delete(),
          onlineName: admin.firestore.FieldValue.delete(),
          variantName: admin.firestore.FieldValue.delete(),
          onlinePrice: admin.firestore.FieldValue.delete(),
          onlineUrl: admin.firestore.FieldValue.delete(),
          imageUrl: admin.firestore.FieldValue.delete(),
          imageUrls: admin.firestore.FieldValue.delete(),
          parentImageUrls: admin.firestore.FieldValue.delete(),
          variantImageUrls: admin.firestore.FieldValue.delete(),
          easyStoreSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
      } else {
        return;
      }
    }

    if (hasAnyChange(existing, update)) {
      operations.push({ ref: document.ref, data: update });
    }
  });

  const written = await commitOperations(operations);
  return {
    centralCount: centralSnapshot.size,
    matchedCount,
    imageMatchedCount,
    duplicateMatchCount,
    unmatchedCount,
    centralWritten: written
  };
}

function registerEasyStoreCatalogSync(exportsObject) {
  exportsObject.syncEasyStoreCatalog = onCall({
    region: REGION,
    timeoutSeconds: 1800,
    memory: '1GiB',
    maxInstances: 1,
    secrets: [EASYSTORE_ACCESS_TOKEN]
  }, async (request) => {
    if (!isAllowedCaller(request)) {
      throw new HttpsError('permission-denied', '此同步功能只允許從管理網站執行。');
    }

    const token = clean(EASYSTORE_ACCESS_TOKEN.value());
    if (!token) {
      throw new HttpsError('failed-precondition', '尚未設定 EASYSTORE_ACCESS_TOKEN。');
    }

    if (!admin.apps.length) admin.initializeApp();
    const db = admin.firestore();
    const force = Boolean(request.data && request.data.force);
    const lock = await acquireLock(db, force);
    if (lock.cached) return { ...lock.cached, cached: true };

    const runId = `ES-${Date.now()}`;
    const startedAt = admin.firestore.Timestamp.now();

    try {
      const fetched = await fetchAllProducts(token);
      const built = buildCatalog(fetched.products);
      const catalogWritten = await saveCatalogRows(db, built.rows, runId);
      const matching = await matchCentralProducts(db, built.rows, built.duplicateSkus);
      const completedAt = admin.firestore.Timestamp.now();

      const result = {
        ok: true,
        runId,
        source: 'EasyStore API',
        productCount: fetched.products.length,
        variantCount: built.rows.length,
        uniqueSkuCount: new Set(built.rows.map((row) => row.sku)).size,
        duplicateApiSkuCount: built.duplicateSkus.size,
        catalogWritten,
        ...matching,
        unmatchedApiSkuCount: Math.max(
          0,
          new Set(built.rows.map((row) => row.sku)).size - matching.matchedCount
        ),
        rateRemaining: fetched.rateRemaining,
        rateLimit: fetched.rateLimit,
        startedAt: startedAt.toDate().toISOString(),
        completedAt: completedAt.toDate().toISOString()
      };

      await db.collection('opsSettings').doc('easyStoreCatalogSync').set({
        ...result,
        startedAt,
        completedAt,
        updatedAt: completedAt
      }, { merge: true });

      await db.collection('opsSyncLogs').add({
        ...result,
        startedAt,
        completedAt,
        createdAt: completedAt,
        type: 'easyStoreCatalog'
      });

      await lock.ref.set({
        status: 'completed',
        completedAt,
        expiresAt: admin.firestore.Timestamp.fromMillis(0),
        lastResult: result,
        updatedAt: completedAt
      }, { merge: true });

      return result;
    } catch (error) {
      const message = clean(error && error.message ? error.message : error) || 'EasyStore 同步失敗';
      console.error('syncEasyStoreCatalog failed:', error);
      await db.collection('opsSyncLogs').add({
        type: 'easyStoreCatalog',
        ok: false,
        runId,
        error: message,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});
      await lock.ref.set({
        status: 'failed',
        error: message,
        expiresAt: admin.firestore.Timestamp.fromMillis(0),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(() => {});
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', message);
    }
  });
}

module.exports = { registerEasyStoreCatalogSync };
