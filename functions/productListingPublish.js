'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

const EASYSTORE_ACCESS_TOKEN = defineSecret('EASYSTORE_ACCESS_TOKEN');
const REGION = 'us-central1';
const EASY_STORE_URL = 'https://www.mingtinghuang.com';
const EASY_STORE_API_BASE = '/api/3.0';
const PRODUCT_COLLECTION = 'opsInternalProducts';
const LISTING_CASE_COLLECTION = 'opsProductListingCases';
const JOB_COLLECTION = 'opsSyncJobs';
const PLATFORM_QUEUE_COLLECTION = 'opsProductListingQueue';
const REQUEST_TIMEOUT_MS = 60 * 1000;
const PUBLISH_LOCK_MS = 15 * 60 * 1000;
const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeSku(value) {
  return clean(value).replace(/^'+/, '').replace(/\u00a0/g, ' ').toUpperCase();
}

function numberOrNull(value) {
  if (value === null || value === undefined || clean(value) === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeHttpUrl(value) {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch (_) {
    return '';
  }
}

function normalizeUrls(value, limit = 9) {
  const result = [];
  const rows = Array.isArray(value) ? value : clean(value).split(/[\n|]+/);
  rows.forEach((row) => {
    const url = safeHttpUrl(row);
    if (url && !result.includes(url)) result.push(url);
  });
  return result.slice(0, limit);
}

function escapeHtml(value) {
  return clean(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function productDescriptionToSafeHtml(value) {
  const lines = clean(value).replace(/\r/g, '').split('\n');
  const parts = [];
  let listOpen = false;
  function closeList() {
    if (listOpen) {
      parts.push('</ul>');
      listOpen = false;
    }
  }
  lines.forEach((rawLine) => {
    const line = clean(rawLine);
    if (!line) {
      closeList();
      return;
    }
    if (/^(商品特色|商品規格|包裝內容|適用對象|使用方式|注意事項)[：:]?$/.test(line)) {
      closeList();
      parts.push(`<h3>${escapeHtml(line.replace(/[：:]$/, ''))}</h3>`);
      return;
    }
    const item = line.match(/^(?:\d+[.、]|[-•●])\s*(.+)$/);
    if (item) {
      if (!listOpen) {
        parts.push('<ul>');
        listOpen = true;
      }
      parts.push(`<li>${escapeHtml(item[1])}</li>`);
      return;
    }
    closeList();
    parts.push(`<p>${escapeHtml(line)}</p>`);
  });
  closeList();
  return parts.join('');
}

function isAllowedManager(request) {
  const auth = request && request.auth;
  const token = auth && auth.token ? auth.token : {};
  const role = clean(token.role || token.userRole || token.permissionRole).toLowerCase();
  const email = clean(token.email || (auth && auth.email)).toLowerCase();
  return Boolean(auth && (
    token.admin === true || token.manager === true || token.owner === true ||
    ['admin', 'manager', 'owner', '主管', '管理者'].includes(role) || ADMIN_EMAILS.has(email)
  ));
}

function listingName(product, listingCase) {
  return clean(listingCase.researchedProductName || listingCase.productName || product.internalName || product.originalName || product.onlineName || product.name);
}

function listingDescription(listingCase) {
  return clean(listingCase.productDescription || listingCase.commonProductDescription) || [
    clean(listingCase.shortDescription), clean(listingCase.featureList), clean(listingCase.specificationText)
  ].filter(Boolean).join('\n\n');
}

function buildListingSnapshot(productId, product, listingCase) {
  const enabled = listingCase.enabledPlatforms && typeof listingCase.enabledPlatforms === 'object'
    ? listingCase.enabledPlatforms : { easyStoreShopee: true, momo: true, coupang: true };
  const description = listingDescription(listingCase);
  const images = normalizeUrls(listingCase.listingImageUrls, 9);
  const snapshot = {
    productId: clean(productId),
    sku: normalizeSku(product.internalSku || product.sku || listingCase.productSku),
    title: listingName(product, listingCase).slice(0, 255),
    description,
    bodyHtml: productDescriptionToSafeHtml(description),
    images,
    brand: clean(listingCase.brand || product.brand),
    model: clean(listingCase.model || product.model),
    barcode: clean(listingCase.barcode || product.barcode),
    stock: Math.max(0, Math.round(numberOrNull(product.currentStock) || 0)),
    costPrice: numberOrNull(product.latestPurchaseCost || product.averageCost),
    storePrice: numberOrNull(product.storePrice || product.originalSalePrice),
    easyStorePrice: numberOrNull(product.easyStorePrice != null ? product.easyStorePrice : listingCase.priceSnapshot && listingCase.priceSnapshot.easyStore),
    momoPrice: numberOrNull(product.momoPrice != null ? product.momoPrice : listingCase.priceSnapshot && listingCase.priceSnapshot.momo),
    coupangPrice: numberOrNull(product.coupangPrice != null ? product.coupangPrice : listingCase.priceSnapshot && listingCase.priceSnapshot.coupang),
    packageLengthCm: numberOrNull(listingCase.packageLengthCm),
    packageWidthCm: numberOrNull(listingCase.packageWidthCm),
    packageHeightCm: numberOrNull(listingCase.packageHeightCm),
    packageWeightKg: numberOrNull(listingCase.packageWeightKg),
    shippingDecision: clean(listingCase.shippingDecision),
    shopeeTitle: clean(listingCase.shopeeTitle) || listingName(product, listingCase),
    shopeeCategoryPath: clean(listingCase.shopeeCategoryPath),
    momoGoodsName: clean(listingCase.momoGoodsName) || listingName(product, listingCase),
    momoSlogan: clean(listingCase.momoSlogan),
    momoCategoryCode: clean(listingCase.momoCategoryCode),
    coupangTitle: clean(listingCase.coupangTitle) || listingName(product, listingCase),
    coupangCategoryCode: clean(listingCase.coupangCategoryCode),
    enabledEasyStoreShopee: enabled.easyStoreShopee !== false,
    enabledMomo: enabled.momo !== false,
    enabledCoupang: enabled.coupang !== false
  };
  return snapshot;
}

function compactObject(value) {
  if (Array.isArray(value)) return value.map(compactObject);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  Object.entries(value).forEach(([key, item]) => {
    if (item === undefined) return;
    result[key] = compactObject(item);
  });
  return result;
}

function buildEasyStoreProductBody(snapshot, includeVariant = true) {
  const product = {
    title: snapshot.title,
    description: snapshot.description,
    body_html: snapshot.bodyHtml,
    inventory_management: 'easystore',
    taxable: true,
    shipping_required: true,
    published_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    images: snapshot.images.map((url) => ({ url }))
  };
  if (includeVariant) {
    const variant = {
      sku: snapshot.sku,
      barcode: snapshot.barcode || null,
      price: snapshot.easyStorePrice,
      inventory_quantity: snapshot.stock,
      width: snapshot.packageWidthCm,
      height: snapshot.packageHeightCm,
      length: snapshot.packageLengthCm,
      weight: snapshot.packageWeightKg,
      weight_unit: 'kg',
      inventory_policy: false,
      taxable: true,
      is_enabled: true
    };
    if (snapshot.storePrice != null && snapshot.storePrice > snapshot.easyStorePrice) variant.compare_at_price = snapshot.storePrice;
    if (snapshot.costPrice != null) variant.cost_price = snapshot.costPrice;
    product.variants = [variant];
  }
  return compactObject({ product });
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
    if (payload.data.product && typeof payload.data.product === 'object') return [payload.data.product];
  }
  if (payload.product && typeof payload.product === 'object') return [payload.product];
  return [];
}

function productVariants(product) {
  if (!product || typeof product !== 'object') return [];
  for (const key of ['variants', 'product_variants', 'productVariants', 'items']) {
    if (Array.isArray(product[key])) return product[key];
  }
  if (product.sku || product.code || product.product_code) return [product];
  return [];
}

function productIdOf(product) {
  return clean(product && (product.id || product.product_id || product.productId));
}

function variantIdOf(variant) {
  return clean(variant && (variant.id || variant.variant_id || variant.variantId));
}

function exactEasyStoreMatches(payload, sku) {
  const normalizedSku = normalizeSku(sku);
  const matches = [];
  extractProducts(payload).forEach((product) => {
    productVariants(product).forEach((variant) => {
      if (normalizeSku(variant && (variant.sku || variant.code || variant.product_code)) === normalizedSku) {
        matches.push({ product, variant, productId: productIdOf(product), variantId: variantIdOf(variant) });
      }
    });
  });
  return matches.filter((row) => row.productId && row.variantId);
}

async function easyStoreRequest(path, token, options = {}, attempt = 0) {
  const url = `${EASY_STORE_URL}${EASY_STORE_API_BASE}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'EasyStore-Access-Token': token,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if ((options.method || 'GET') !== 'POST' && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (2 ** attempt)));
      return easyStoreRequest(path, token, options, attempt + 1);
    }
    throw new Error(`EasyStore 連線失敗：${clean(error && error.message) || '未知錯誤'}`);
  }
  const text = await response.text();
  if ((options.method || 'GET') !== 'POST' && [408, 425, 429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 800 * (2 ** attempt)));
    return easyStoreRequest(path, token, options, attempt + 1);
  }
  if (!response.ok) {
    const error = new Error(`EasyStore HTTP ${response.status}：${text.slice(0, 700)}`);
    error.status = response.status;
    throw error;
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`EasyStore 回傳格式不正確：${text.slice(0, 300)}`);
  }
}

async function findEasyStoreMappingBySku(snapshot, token) {
  const params = new URLSearchParams({ skus: snapshot.sku, limit: '100' });
  const payload = await easyStoreRequest(`/products.json?${params.toString()}`, token);
  const matches = exactEasyStoreMatches(payload, snapshot.sku);
  if (matches.length > 1) throw new Error(`EasyStore 找到 ${matches.length} 筆相同 SKU，為避免更新錯商品已停止。`);
  return matches[0] || null;
}

async function findEasyStoreMappingInProduct(snapshot, token, productId) {
  if (!productId) return null;
  let payload;
  try {
    payload = await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token);
  } catch (error) {
    if (error && error.status === 404) return null;
    throw error;
  }
  const matches = exactEasyStoreMatches(payload, snapshot.sku);
  if (matches.length > 1) throw new Error(`EasyStore 商品 ${productId} 內找到 ${matches.length} 個相同 SKU，為避免更新錯規格已停止。`);
  return matches[0] || null;
}

async function upsertEasyStoreProduct(snapshot, product, token) {
  const mappings = product.platformMappings && typeof product.platformMappings === 'object' ? product.platformMappings : {};
  const mapped = mappings.easyStore && typeof mappings.easyStore === 'object' ? mappings.easyStore : {};
  const mappedProductId = clean(mapped.productId || product.sourceProductId);
  let productId = '';
  let variantIds = [];
  let existing = await findEasyStoreMappingInProduct(snapshot, token, mappedProductId);
  if (!existing) existing = await findEasyStoreMappingBySku(snapshot, token);
  if (existing) {
    productId = existing.productId;
    variantIds = [existing.variantId];
  }
  let action = 'updated';
  if (!productId) {
    action = 'created';
    let createdPayload;
    try {
      createdPayload = await easyStoreRequest('/products.json', token, { method: 'POST', body: buildEasyStoreProductBody(snapshot, true) });
    } catch (error) {
      // POST 可能已成功但回應在途中斷線；先以完全相同 SKU 回查，絕不盲目重送造成重複商品。
      const recovered = await findEasyStoreMappingBySku(snapshot, token).catch(() => null);
      if (!recovered) throw error;
      return { action: 'created', productId: recovered.productId, variantIds: [recovered.variantId], recoveredAfterUncertainResponse: true };
    }
    const createdProduct = extractProducts(createdPayload)[0] || (createdPayload && createdPayload.product) || createdPayload;
    productId = productIdOf(createdProduct);
    variantIds = productVariants(createdProduct).map(variantIdOf).filter(Boolean);
    if (!productId || !variantIds.length) {
      const resolved = await findEasyStoreMappingBySku(snapshot, token);
      if (!resolved) throw new Error('EasyStore 已接受建立商品，但尚未回傳可追蹤的商品／規格編號。請到 EasyStore 後台確認。');
      productId = resolved.productId;
      variantIds = [resolved.variantId];
    }
  } else {
    await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token, {
      method: 'PUT', body: buildEasyStoreProductBody(snapshot, false)
    });
    if (!variantIds.length) throw new Error('EasyStore 商品已存在，但缺少規格編號，為避免改錯商品已停止。');
    const variantTemplate = buildEasyStoreProductBody(snapshot, true).product.variants[0];
    await easyStoreRequest(`/products/${encodeURIComponent(productId)}/variants.json`, token, {
      method: 'PUT', body: { variants: variantIds.map((id) => ({ id, ...variantTemplate })) }
    });
  }
  return { action, productId, variantIds };
}

function easyStoreMissingFields(snapshot) {
  const missing = [];
  if (!snapshot.sku) missing.push('SKU');
  if (!snapshot.title) missing.push('商品名稱');
  if (!snapshot.description) missing.push('完整商品介紹');
  if (!snapshot.images.length) missing.push('上架圖片');
  if (snapshot.easyStorePrice == null) missing.push('EasyStore 售價');
  return missing;
}

function momoMissingFields(snapshot) {
  const missing = [];
  if (!snapshot.sku) missing.push('SKU');
  if (!snapshot.momoGoodsName) missing.push('MOMO 商品名稱');
  if (!snapshot.description) missing.push('完整商品介紹');
  if (!snapshot.images.length) missing.push('上架圖片');
  if (!snapshot.momoCategoryCode) missing.push('MOMO 分類');
  if (snapshot.momoPrice == null) missing.push('MOMO 售價');
  return missing;
}

function coupangMissingFields(snapshot) {
  const missing = [];
  if (!snapshot.sku) missing.push('SKU');
  if (!snapshot.coupangTitle) missing.push('酷澎標題');
  if (!snapshot.description) missing.push('完整商品介紹');
  if (!snapshot.images.length) missing.push('上架圖片');
  if (!snapshot.coupangCategoryCode) missing.push('酷澎分類');
  if (snapshot.coupangPrice == null) missing.push('酷澎售價');
  return missing;
}

async function queueFixedIpPlatform(db, jobId, platform, snapshot, missingFields) {
  if (missingFields.length) {
    return { status: 'missing-fields', message: `請先補：${missingFields.join('、')}`, missingFields };
  }
  const queueRef = db.collection(PLATFORM_QUEUE_COLLECTION).doc(`${snapshot.productId}_${platform.toLowerCase()}`);
  await queueRef.set({
    jobId, productId: snapshot.productId, sku: snapshot.sku, platform,
    status: 'awaiting-store-agent', payload: snapshot,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: '全通路營運中心', schemaVersion: 1
  }, { merge: true });
  return {
    status: 'awaiting-store-agent',
    message: `${platform} 已排入店內固定 IP 電腦的新品上架佇列。`,
    queueId: queueRef.id
  };
}

async function acquirePublishLock(db, caseRef, jobId, createdBy) {
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(caseRef);
    if (!snapshot.exists) throw new HttpsError('failed-precondition', '請先儲存商品上架資料。');
    const data = snapshot.data() || {};
    const lock = data.publishLock && typeof data.publishLock === 'object' ? data.publishLock : {};
    const expiresAt = lock.expiresAt && typeof lock.expiresAt.toMillis === 'function' ? lock.expiresAt.toMillis() : 0;
    if (lock.status === 'running' && expiresAt > now) {
      throw new HttpsError('already-exists', '這件商品正在上架，請等待目前工作完成，不要重複送出。');
    }
    transaction.set(caseRef, {
      publishLock: {
        status: 'running', jobId, createdBy,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(now + PUBLISH_LOCK_MS)
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function releasePublishLock(caseRef, jobId, status) {
  await caseRef.set({
    publishLock: {
      status: clean(status) || 'finished', jobId,
      expiresAt: admin.firestore.Timestamp.fromMillis(0),
      finishedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

function overallPublishStatus(platforms) {
  const states = Object.values(platforms).map((row) => clean(row && row.status));
  if (states.some((status) => status === 'failed')) return 'partial-failed';
  if (states.some((status) => status === 'missing-fields')) return 'needs-input';
  if (states.some((status) => ['awaiting-store-agent', 'waiting-easystore-sync', 'action-required'].includes(status))) return 'submitted';
  return states.length ? 'completed' : 'no-platform';
}

function registerProductListingPublish(target) {
  target.publishProductListingCase = onCall({
    region: REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [EASYSTORE_ACCESS_TOKEN],
    enforceAppCheck: false
  }, async (request) => {
    if (!isAllowedManager(request)) throw new HttpsError('permission-denied', '請先使用管理者帳號登入。');
    const productId = clean(request && request.data && request.data.productId);
    if (!productId || productId.length > 200 || productId.includes('/')) throw new HttpsError('invalid-argument', '商品 ID 格式不正確。');
    const db = admin.firestore();
    const productRef = db.collection(PRODUCT_COLLECTION).doc(productId);
    const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(productId);
    const [productSnap, caseSnap] = await Promise.all([productRef.get(), caseRef.get()]);
    if (!productSnap.exists) throw new HttpsError('not-found', '找不到中央商品主檔。');
    if (!caseSnap.exists) throw new HttpsError('failed-precondition', '請先儲存商品上架資料。');
    const product = productSnap.data() || {};
    const listingCase = caseSnap.data() || {};
    const snapshot = buildListingSnapshot(productId, product, listingCase);
    if (!snapshot.enabledEasyStoreShopee && !snapshot.enabledMomo && !snapshot.enabledCoupang) {
      throw new HttpsError('failed-precondition', '請至少勾選一個要上架的平台。');
    }
    const jobRef = db.collection(JOB_COLLECTION).doc();
    const jobId = jobRef.id;
    const createdBy = clean(request.auth && request.auth.token && request.auth.token.email) || '管理者';
    const platforms = {};
    let lockStatus = 'failed';
    await acquirePublishLock(db, caseRef, jobId, createdBy);
    try {
      await jobRef.set({
        jobNo: `PUB-${Date.now()}`, type: 'productListingPublish', status: 'running', dryRun: false,
        productId, productSku: snapshot.sku, productName: snapshot.title,
        createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(), schemaVersion: 1
      });

      if (snapshot.enabledEasyStoreShopee) {
        const missing = easyStoreMissingFields(snapshot);
        if (missing.length) {
          platforms.easyStore = { status: 'missing-fields', message: `EasyStore 請先補：${missing.join('、')}`, missingFields: missing };
          platforms.shopee = { status: 'waiting-easystore', message: '需先完成 EasyStore 商品。' };
        } else {
          try {
            const token = clean(EASYSTORE_ACCESS_TOKEN.value());
            if (!token) throw new Error('尚未設定 EASYSTORE_ACCESS_TOKEN。');
            const result = await upsertEasyStoreProduct(snapshot, product, token);
            const previousMappings = product.platformMappings && typeof product.platformMappings === 'object' ? product.platformMappings : {};
            await productRef.set({
              sourceCollection: 'EasyStore API', sourceProductId: result.productId, sourceVariantId: result.variantIds[0] || '',
              onlineName: snapshot.title, onlinePrice: snapshot.easyStorePrice,
              imageUrl: snapshot.images[0] || '', imageUrls: snapshot.images,
              easyStoreMatched: true, easyStoreMatchStatus: 'matched',
              platformMappings: {
                ...previousMappings,
                easyStore: { ...(previousMappings.easyStore || {}), productId: result.productId, variantIds: result.variantIds }
              },
              easyStoreSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '商品上架'
            }, { merge: true });
            platforms.easyStore = {
              status: result.action === 'created' ? 'created' : 'updated',
              message: result.action === 'created' ? 'EasyStore 商品已建立。' : 'EasyStore 商品已更新。',
              productId: result.productId, variantIds: result.variantIds
            };
            platforms.shopee = snapshot.shopeeCategoryPath
              ? { status: 'waiting-easystore-sync', message: `請在 EasyStore 發佈到蝦皮並確認分類：${snapshot.shopeeCategoryPath}` }
              : { status: 'action-required', message: '請在 EasyStore 發佈到蝦皮時選擇蝦皮分類與必要屬性。' };
          } catch (error) {
            platforms.easyStore = { status: 'failed', message: clean(error && error.message).slice(0, 800) || 'EasyStore 上架失敗。' };
            platforms.shopee = { status: 'waiting-easystore', message: 'EasyStore 尚未完成，因此尚未送往蝦皮。' };
          }
        }
      }

      if (snapshot.enabledMomo) platforms.momo = await queueFixedIpPlatform(db, jobId, 'MOMO', snapshot, momoMissingFields(snapshot));
      if (snapshot.enabledCoupang) platforms.coupang = await queueFixedIpPlatform(db, jobId, 'Coupang', snapshot, coupangMissingFields(snapshot));
      const status = overallPublishStatus(platforms);
      await Promise.all([
        jobRef.set({ status, platforms, updatedAt: admin.firestore.FieldValue.serverTimestamp(), finishedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }),
        caseRef.set({
          caseStatus: status === 'completed' ? 'published' : 'submitted',
          publishState: { jobId, status, platforms, submittedAt: admin.firestore.FieldValue.serverTimestamp(), submittedBy: createdBy },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '商品上架', schemaVersion: 7
        }, { merge: true }),
        db.collection('opsAuditLogs').add({
          action: '確認商品上架', entityType: 'productListingPublish', entityId: jobId,
          summary: `${snapshot.sku || productId}｜${snapshot.title}｜${status}`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy,
          version: '2026.08.11-product-listing-publish-v1'
        })
      ]);
      lockStatus = status;
      return { ok: !Object.values(platforms).some((row) => row.status === 'failed'), productId, jobId, status, platforms };
    } catch (error) {
      lockStatus = 'failed';
      await jobRef.set({
        status: 'failed', error: clean(error && error.message).slice(0, 800) || '商品上架工作未完成。',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(), finishedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(() => null);
      throw error;
    } finally {
      try {
        await releasePublishLock(caseRef, jobId, lockStatus);
      } catch (error) {
        console.error('Unable to release product listing publish lock', { productId, jobId, message: clean(error && error.message) });
      }
    }
  });
}

module.exports = {
  registerProductListingPublish,
  _test: {
    normalizeSku,
    productDescriptionToSafeHtml,
    buildListingSnapshot,
    buildEasyStoreProductBody,
    exactEasyStoreMatches,
    easyStoreMissingFields,
    momoMissingFields,
    coupangMissingFields,
    overallPublishStatus
  }
};
