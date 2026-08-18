'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const shopeeTaxonomy = require('./shopeeMusicTaxonomy');

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
const SHOPEE_AUTOFILL_SCHEMA_VERSION = 4;
const SELLER_LARGE_HOME_FEE_TWD = 100;
const PLATFORM_QUEUE_PENDING_STATUSES = new Set(['awaiting-store-agent', 'processing']);
const PLATFORM_QUEUE_COMPLETED_STATUSES = new Set(['completed', 'created', 'updated', 'published', 'success']);
const SHOP_ASSET_BASE_URL = clean(process.env.YOUZI_HOSTING_URL || 'https://youzi-c1b74.web.app').replace(/\/$/, '');
const STORE_PROMO_IMAGE_URL = `${SHOP_ASSET_BASE_URL}/product-listing-store-promo.png`;
const DESCRIPTION_PROMO_IMAGE_URLS = [
  `${SHOP_ASSET_BASE_URL}/product-listing-description-promo-1.jpg`,
  `${SHOP_ASSET_BASE_URL}/product-listing-description-promo-2.jpg`
];
const MOMO_THIRD_PARTY_DELIVERY = {
  method: 'third-party', locationCode: '000001', locationLabel: '台中市圓環東路347號', carrier: '新竹物流'
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeSku(value) {
  return clean(value).replace(/^'+/, '').replace(/\u00a0/g, ' ').toUpperCase();
}

function normalizeListingDecision(value) {
  const decision = clean(value).toLowerCase();
  return ['auto', 'new', 'existing'].includes(decision) ? decision : 'auto';
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

function normalizeShopeeAttributes(value) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  return rows.map((row) => {
    const label = clean(row && row.label).slice(0, 120);
    const fieldValue = clean(row && row.value).slice(0, 300);
    const confidence = ['high', 'medium', 'low'].includes(clean(row && row.confidence))
      ? clean(row.confidence) : 'low';
    if (!label || !fieldValue) return null;
    const key = label.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    return { label, value: fieldValue, confidence, note: clean(row && row.note).slice(0, 500) };
  }).filter(Boolean).slice(0, 30);
}

function canonicalShopeeCategorySegment(value) {
  return shopeeTaxonomy.canonicalSegment(value);
}

function shopeeCategorySegments(value, evidence) {
  return shopeeTaxonomy.normalizeMusicCategoryPath(value, evidence);
}

function applyShopeeAttributeTemplate(value, evidence, categoryPath) {
  const researched = normalizeShopeeAttributes(value);
  const template = shopeeTaxonomy.templateAttributeRows(evidence, categoryPath);
  if (!template.length) return researched;
  const allowed = new Map(template.map((row) => [clean(row.label).toLowerCase(), row]));
  const result = researched.filter((row) => allowed.has(clean(row.label).toLowerCase()));
  const existing = new Set(result.map((row) => clean(row.label).toLowerCase()));
  template.forEach((field) => {
    const key = clean(field.label).toLowerCase();
    if (existing.has(key) || !clean(field.defaultValue)) return;
    result.push({
      label: field.label,
      value: clean(field.defaultValue),
      confidence: 'high',
      note: clean(field.research) || '分類模板固定值'
    });
    existing.add(key);
  });
  return result.slice(0, 30);
}

function hsinchuSizeBand(totalCm) {
  const total = numberOrNull(totalCm);
  if (total === null || total <= 0 || total > 210) return '';
  if (total <= 60) return 'S60';
  if (total <= 90) return 'S90';
  if (total <= 120) return 'S120';
  if (total <= 140) return 'S150';
  if (total <= 160) return 'S160';
  if (total <= 170) return 'S170';
  if (total <= 180) return 'S180';
  if (total <= 190) return 'S190';
  if (total <= 200) return 'S200';
  return 'S210';
}

function buildShopeeLogistics(snapshot) {
  const dimensions = [snapshot.packageLengthCm, snapshot.packageWidthCm, snapshot.packageHeightCm].map(numberOrNull);
  const hasCompletePackage = dimensions.every((value) => value !== null && value > 0);
  const totalCm = hasCompletePackage ? dimensions.reduce((sum, value) => sum + value, 0) : 0;
  const longestCm = hasCompletePackage ? Math.max(...dimensions) : 0;
  const weightKg = numberOrNull(snapshot.packageWeightKg);
  const hasValidWeight = weightKg !== null && weightKg > 0;
  const decision = clean(snapshot.shippingDecision);
  const hsinchuBand = hasCompletePackage && longestCm <= 150 && totalCm <= 210
    && hasValidWeight && weightKg <= 20 ? hsinchuSizeBand(totalCm) : '';
  const canVerifyConvenience = hasCompletePackage && hasValidWeight;
  const convenienceFits = canVerifyConvenience && longestCm <= 45 && totalCm <= 105 && weightKg <= 5;
  const convenience = decision === 'convenience' && convenienceFits;
  const freight = decision === 'freight';
  const methods = [
    { label: '黑貓宅急便', enabled: false },
    { label: '蝦皮店到店 - 隔日到貨', enabled: false },
    { label: '蝦皮店到店', enabled: convenience },
    { label: '7-ELEVEN', enabled: convenience },
    { label: '新竹物流', enabled: Boolean(freight && hsinchuBand), option: freight ? hsinchuBand : '' },
    { label: '全家', enabled: convenience },
    {
      label: '賣家宅配：大型/超重物品運送',
      enabled: freight,
      feeTwd: freight ? SELLER_LARGE_HOME_FEE_TWD : null
    },
    { label: '嘉里快遞', enabled: false },
    { label: '店到家宅配', enabled: false }
  ];
  return {
    decision,
    packageTotalCm: hasCompletePackage ? Math.round(totalCm * 100) / 100 : null,
    methods: methods.map((row) => ({
      label: row.label,
      enabled: row.enabled === true,
      option: clean(row.option),
      feeTwd: numberOrNull(row.feeTwd),
      sellerPays: false
    })),
    requiresConfirmation: !hasCompletePackage || !hasValidWeight || !decision || decision === 'home'
      || (decision === 'freight' && !hsinchuBand)
      || (decision === 'convenience' && !convenienceFits)
  };
}

function buildShopeeAutofillPayload(snapshot, easyStoreResult) {
  const easyStoreProductId = clean(easyStoreResult && easyStoreResult.productId);
  const now = Date.now();
  const addVariant = clean(snapshot.listingMode) === 'add-variant';
  return {
    schemaVersion: SHOPEE_AUTOFILL_SCHEMA_VERSION,
    nonce: crypto.randomBytes(16).toString('hex'),
    createdAt: now,
    expiresAt: now + 30 * 60 * 1000,
    productId: snapshot.productId,
    easyStoreProductId,
    easyStoreUrl: easyStoreProductId ? `https://admin.easystore.co/products/${encodeURIComponent(easyStoreProductId)}` : 'https://admin.easystore.co/',
    sku: snapshot.sku,
    title: snapshot.shopeeTitle,
    publishMode: addVariant ? 'add-variant-to-existing' : 'auto',
    variantGroup: addVariant ? {
      parentProductId: snapshot.variantParentProductId,
      parentSku: snapshot.variantParentSku,
      parentName: snapshot.variantParentName,
      attributeName: snapshot.variantAttributeName,
      parentAttributeValue: snapshot.variantParentAttributeValue,
      attributeValue: snapshot.variantAttributeValue
    } : null,
    listingPolicy: {
      decision: addVariant ? 'existing' : normalizeListingDecision(snapshot.shopeeListingDecision),
      matchKey: 'sku',
      allowCreate: !addVariant && normalizeListingDecision(snapshot.shopeeListingDecision) === 'new',
      existingListingIds: Array.isArray(snapshot.shopeeExistingListingIds)
        ? snapshot.shopeeExistingListingIds.map(clean).filter(Boolean).slice(0, 20)
        : [],
      onZero: addVariant ? 'block-missing-parent' : 'create-only-if-confirmed',
      onOne: addVariant ? 'append-variant' : 'update',
      onMultiple: 'block'
    },
    categoryPath: shopeeCategorySegments(snapshot.shopeeCategoryPath, snapshot),
    brand: snapshot.shopeeBrand || snapshot.brand,
    attributes: normalizeShopeeAttributes(snapshot.shopeeAttributeValues),
    package: {
      lengthCm: snapshot.packageLengthCm,
      widthCm: snapshot.packageWidthCm,
      heightCm: snapshot.packageHeightCm,
      weightKg: snapshot.packageWeightKg
    },
    logistics: buildShopeeLogistics(snapshot),
    preorder: { enabled: false, days: 1 },
    guard: {
      brand: snapshot.brand,
      model: snapshot.model,
      color: snapshot.color,
      identityStatus: snapshot.identityStatus
    }
  };
}

function identityAllowsShopeeAutofill(status, manualConfirmed) {
  return manualConfirmed === true || ['confirmed', 'possible'].includes(clean(status));
}

function summarizePlatformsForStorage(platforms) {
  const summary = {};
  Object.entries(platforms && typeof platforms === 'object' ? platforms : {}).forEach(([platform, raw]) => {
    if (!raw || typeof raw !== 'object') return;
    const key = clean(platform).slice(0, 60);
    if (!key) return;
    const row = {
      status: clean(raw.status).slice(0, 80),
      message: clean(raw.message).slice(0, 800)
    };
    if (Array.isArray(raw.missingFields)) {
      row.missingFields = raw.missingFields.map((value) => clean(value).slice(0, 160)).filter(Boolean).slice(0, 30);
    }
    if (clean(raw.queueId)) row.queueId = clean(raw.queueId).slice(0, 200);
    summary[key] = row;
  });
  return summary;
}

function platformListingStatusFromPublish(previous, platforms) {
  const current = previous && typeof previous === 'object' ? previous : {};
  const next = { ...current };
  const statusMap = {
    created: 'active', updated: 'active', completed: 'active', 'already-completed': 'mapped',
    'waiting-easystore-sync': 'queued', 'awaiting-store-agent': 'queued', 'already-queued': 'queued', submitted: 'queued',
    'action-required': 'error', 'missing-fields': 'error', 'waiting-easystore': 'error', failed: 'error'
  };
  Object.entries(platforms && typeof platforms === 'object' ? platforms : {}).forEach(([platform, raw]) => {
    if (!raw || typeof raw !== 'object') return;
    const old = current[platform] && typeof current[platform] === 'object' ? current[platform] : {};
    next[platform] = {
      ...old,
      status: statusMap[clean(raw.status)] || clean(old.status) || 'unknown',
      listingId: clean(raw.productId || raw.listingId || old.listingId),
      note: clean(raw.message).slice(0, 800),
      lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastCheckedBy: '商品上架工作'
    };
  });
  return next;
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

function appendShopDescriptionPromos(html) {
  let result = clean(html);
  DESCRIPTION_PROMO_IMAGE_URLS.forEach((url) => {
    if (!result.includes(url)) result += `<p><img src="${url}" alt="柚子樂器門市與服務資訊" style="max-width:100%;height:auto"></p>`;
  });
  return result;
}

function listingImageAllocation(value) {
  const productImages = normalizeUrls(value, 30)
    .filter((url) => url !== STORE_PROMO_IMAGE_URL && !DESCRIPTION_PROMO_IMAGE_URLS.includes(url))
    .slice(0, 12);
  const galleryImages = productImages.slice(0, 6);
  if (galleryImages.length) galleryImages.push(STORE_PROMO_IMAGE_URL);
  return {
    productImages,
    galleryImages,
    descriptionImages: productImages.slice(6)
  };
}

function appendShopDescriptionImages(html, imageUrls) {
  let result = clean(html);
  DESCRIPTION_PROMO_IMAGE_URLS.forEach((url) => {
    const block = `<p><img src="${url}" alt="柚子樂器門市與服務資訊" style="max-width:100%;height:auto"></p>`;
    result = result.split(block).join('');
  });
  normalizeUrls(imageUrls, 12).forEach((url) => {
    if (!result.includes(url)) result += `<p><img src="${url}" alt="商品介紹圖片" style="max-width:100%;height:auto"></p>`;
  });
  return appendShopDescriptionPromos(result);
}

function buildListingSnapshot(productId, product, listingCase, variantParentProduct = null) {
  const enabled = listingCase.enabledPlatforms && typeof listingCase.enabledPlatforms === 'object'
    ? listingCase.enabledPlatforms : { easyStoreShopee: true, momo: true, coupang: true };
  const listingMode = clean(listingCase.listingMode) === 'add-variant' ? 'add-variant' : 'independent';
  const parentProduct = variantParentProduct && typeof variantParentProduct === 'object' ? variantParentProduct : {};
  const parentPlatformMappings = parentProduct.platformMappings && typeof parentProduct.platformMappings === 'object'
    ? parentProduct.platformMappings : {};
  const parentPlatformListingStatus = parentProduct.platformListingStatus && typeof parentProduct.platformListingStatus === 'object'
    ? parentProduct.platformListingStatus : {};
  const listingIdentityProduct = listingMode === 'add-variant' ? { platformMappings: parentPlatformMappings, platformListingStatus: parentPlatformListingStatus } : product;
  const shopeeExistingListingIds = platformListingIds(listingIdentityProduct, 'shopee');
  const description = listingDescription(listingCase);
  const imageAllocation = listingImageAllocation(listingCase.listingImageUrls);
  const images = imageAllocation.galleryImages;
  const descriptionHtml = appendShopDescriptionImages(productDescriptionToSafeHtml(description), imageAllocation.descriptionImages);
  const snapshot = {
    productId: clean(productId),
    listingMode,
    variantParentProductId: listingMode === 'add-variant' ? clean(listingCase.variantParentProductId) : '',
    variantParentSku: listingMode === 'add-variant' ? normalizeSku(parentProduct.internalSku || parentProduct.sku || listingCase.variantParentSku) : '',
    variantParentName: listingMode === 'add-variant' ? clean(parentProduct.internalName || parentProduct.originalName || parentProduct.name || listingCase.variantParentName) : '',
    variantAttributeName: listingMode === 'add-variant' ? clean(listingCase.variantAttributeName) : '',
    variantParentAttributeValue: listingMode === 'add-variant' ? clean(listingCase.variantParentAttributeValue) : '',
    variantAttributeValue: listingMode === 'add-variant' ? clean(listingCase.variantAttributeValue) : '',
    variantParentPlatformMappings: listingMode === 'add-variant' ? parentPlatformMappings : {},
    variantParentPlatformListingStatus: listingMode === 'add-variant' ? parentPlatformListingStatus : {},
    variantParentEasyStoreProductId: listingMode === 'add-variant' ? clean(platformListingIds(listingIdentityProduct, 'easyStore')[0]) : '',
    sku: normalizeSku(product.internalSku || product.sku || listingCase.productSku),
    title: listingName(product, listingCase).slice(0, 255),
    description,
    bodyHtml: descriptionHtml,
    images,
    productImageUrls: imageAllocation.productImages,
    descriptionImageUrls: imageAllocation.descriptionImages,
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
    momoDelivery: MOMO_THIRD_PARTY_DELIVERY,
    momoCatalogPolicy: { maximumListings: 1000, targetListings: 990, reservedSlots: 10, zeroStockAction: 'unpublish', violationRecovery: 'republish-only-when-stock-positive' },
    regulatoryPolicy: { ncc: 'fill-only-when-verified', neverFabricateCertification: true },
    imagePolicy: { sourceImageMaximum: 12, galleryMaximum: 7, galleryProductMaximum: 6, overflowToDescription: true, mainImageTemplate: 'youzi-green-template', fixedStorePromoLast: true, fixedDescriptionPromosLast: true, localizedTraditionalChinese: true },
    shopeeTitle: clean(listingCase.shopeeTitle) || listingName(product, listingCase),
    shopeeDescription: clean(listingCase.shopeeDescription) || description,
    shopeeRequiredNotes: clean(listingCase.shopeeRequiredNotes),
    shopeeListingDecision: shopeeExistingListingIds.length
      ? 'existing'
      : normalizeListingDecision(listingCase.shopeeListingDecision),
    shopeeExistingListingIds,
    shopeeCategoryPath: clean(listingCase.shopeeCategoryPath),
    shopeeBrand: clean(listingCase.shopeeBrand) || clean(listingCase.brand || product.brand),
    shopeeAttributeValues: normalizeShopeeAttributes(listingCase.shopeeAttributeValues),
    identityStatus: clean(listingCase.identityStatus),
    identityManualConfirmed: listingCase.identityManualConfirmed === true,
    identityManualConfirmedAt: listingCase.identityManualConfirmedAt || null,
    identityManualConfirmedBy: clean(listingCase.identityManualConfirmedBy),
    identityManualConfirmationNote: clean(listingCase.identityManualConfirmationNote),
    color: clean(listingCase.color || product.color),
    momoGoodsName: clean(listingCase.momoGoodsName) || listingName(product, listingCase),
    momoSlogan: clean(listingCase.momoSlogan),
    momoHtml: appendShopDescriptionImages(clean(listingCase.momoHtml) || productDescriptionToSafeHtml(description), imageAllocation.descriptionImages),
    momoCategoryCode: clean(listingCase.momoCategoryCode),
    coupangTitle: clean(listingCase.coupangTitle) || listingName(product, listingCase),
    coupangDescriptionHtml: appendShopDescriptionImages(clean(listingCase.coupangDescriptionHtml) || productDescriptionToSafeHtml(description), imageAllocation.descriptionImages),
    coupangCategoryCode: clean(listingCase.coupangCategoryCode),
    enabledEasyStoreShopee: enabled.easyStoreShopee !== false,
    enabledMomo: enabled.momo !== false,
    enabledCoupang: enabled.coupang !== false
  };
  snapshot.category = clean(listingCase.category || product.category);
  snapshot.shopeeCategoryPath = shopeeTaxonomy.formatCategoryPath(snapshot.shopeeCategoryPath, snapshot);
  snapshot.shopeeAttributeValues = applyShopeeAttributeTemplate(
    snapshot.shopeeAttributeValues,
    snapshot,
    snapshot.shopeeCategoryPath
  );
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

function platformListingIds(product, platform) {
  const mappings = product && product.platformMappings && typeof product.platformMappings === 'object'
    ? product.platformMappings : {};
  const key = clean(platform).toLowerCase();
  const mappingKey = key === 'easystore' ? 'easyStore' : key;
  const mapping = mappings[mappingKey] && typeof mappings[mappingKey] === 'object' ? mappings[mappingKey] : {};
  const statuses = product && product.platformListingStatus && typeof product.platformListingStatus === 'object' ? product.platformListingStatus : {};
  const status = statuses[mappingKey] && typeof statuses[mappingKey] === 'object' ? statuses[mappingKey] : {};
  const manualListingId = clean(status.listingId || status.externalId);
  let candidates = [];
  if (key === 'shopee') {
    candidates = [mapping.itemIds, mapping.itemId, mapping.channelProductIds, mapping.channelProductId, mapping.productIds, mapping.productId, manualListingId];
  } else if (key === 'momo') {
    const goodsCodes = (Array.isArray(mapping.goodsCodes) ? mapping.goodsCodes : [mapping.goodsCode]).map(clean).filter(Boolean);
    const goodsdtCodes = (Array.isArray(mapping.goodsdtCodes) ? mapping.goodsdtCodes : [mapping.goodsdtCode]).map(clean).filter(Boolean);
    const entpGoodsNos = (Array.isArray(mapping.entpGoodsNos) ? mapping.entpGoodsNos : [mapping.entpGoodsNo]).map(clean).filter(Boolean);
    if (goodsCodes.length && goodsCodes.length === goodsdtCodes.length) {
      candidates = goodsCodes.map((goodsCode, index) => `${goodsCode}|${goodsdtCodes[index]}`);
    } else if (entpGoodsNos.length) candidates = entpGoodsNos;
    else candidates = goodsdtCodes.length ? goodsdtCodes : goodsCodes;
    if (manualListingId) candidates.push(manualListingId);
  } else if (key === 'coupang') {
    candidates = [mapping.vendorItemIds, mapping.vendorItemId, mapping.sellerProductIds, mapping.sellerProductId, manualListingId];
  } else if (key === 'easystore') {
    candidates = [mapping.productId, product && product.sourceProductId, manualListingId];
  }
  const ids = [];
  candidates.forEach((value) => {
    const rows = Array.isArray(value) ? value : [value];
    rows.forEach((row) => {
      const id = clean(row);
      if (id && !ids.includes(id)) ids.push(id);
    });
  });
  return ids.slice(0, 50);
}

function platformQueueFingerprint(platform, snapshot) {
  const key = clean(platform).toLowerCase();
  const platformFields = key === 'momo'
    ? [snapshot.momoGoodsName, snapshot.momoSlogan, snapshot.momoCategoryCode, snapshot.momoPrice, snapshot.momoHtml]
    : [snapshot.coupangTitle, snapshot.coupangCategoryCode, snapshot.coupangPrice, snapshot.coupangDescriptionHtml];
  return crypto.createHash('sha256').update(JSON.stringify({
    platform: key,
    productId: snapshot.productId,
    sku: snapshot.sku,
    listingMode: snapshot.listingMode,
    variantGroup: [snapshot.variantParentProductId, snapshot.variantParentSku, snapshot.variantAttributeName, snapshot.variantParentAttributeValue, snapshot.variantAttributeValue],
    parentPlatformListingIds: platformListingIds({ platformMappings: snapshot.variantParentPlatformMappings, platformListingStatus: snapshot.variantParentPlatformListingStatus }, key),
    title: snapshot.title,
    description: snapshot.description,
    images: snapshot.images,
    stock: snapshot.stock,
    package: [snapshot.packageLengthCm, snapshot.packageWidthCm, snapshot.packageHeightCm, snapshot.packageWeightKg],
    platformFields
  })).digest('hex');
}

function buildPlatformQueuePolicy(product, platform, snapshot) {
  const addVariant = clean(snapshot && snapshot.listingMode) === 'add-variant';
  const identityProduct = addVariant
    ? {
      platformMappings: snapshot.variantParentPlatformMappings && typeof snapshot.variantParentPlatformMappings === 'object' ? snapshot.variantParentPlatformMappings : {},
      platformListingStatus: snapshot.variantParentPlatformListingStatus && typeof snapshot.variantParentPlatformListingStatus === 'object' ? snapshot.variantParentPlatformListingStatus : {}
    }
    : product;
  const existingListingIds = platformListingIds(identityProduct, platform);
  if (addVariant) {
    return {
      mode: existingListingIds.length > 1 ? 'block-duplicate-parent' : existingListingIds.length ? 'add-variant-to-existing' : 'block-missing-parent',
      matchKey: 'parent-listing-id+sku', sku: snapshot.sku, existingListingIds,
      parentProductId: clean(snapshot.variantParentProductId), parentSku: clean(snapshot.variantParentSku),
      variantAttributeName: clean(snapshot.variantAttributeName), variantParentAttributeValue: clean(snapshot.variantParentAttributeValue), variantAttributeValue: clean(snapshot.variantAttributeValue),
      onZero: 'block', onOne: 'append-variant', onMultiple: 'block', onUncertain: 'block'
    };
  }
  return {
    mode: existingListingIds.length > 1 ? 'block-duplicate' : existingListingIds.length ? 'update-existing' : 'upsert-by-exact-sku',
    matchKey: 'sku',
    sku: snapshot.sku,
    existingListingIds,
    onZero: 'create',
    onOne: 'update',
    onMultiple: 'block',
    onUncertain: 'block'
  };
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

async function recoverEasyStoreCreateBySku(snapshot, token) {
  let lastError = null;
  for (const delayMs of [1200, 2500, 5000, 10000]) {
    await wait(delayMs);
    try {
      const recovered = await findEasyStoreMappingBySku(snapshot, token);
      if (recovered) return recovered;
    } catch (error) {
      lastError = error;
      if (/找到 \d+ 筆相同 SKU/.test(clean(error && error.message))) throw error;
    }
  }
  if (lastError && /找到 \d+ 筆相同 SKU/.test(clean(lastError && lastError.message))) throw lastError;
  return null;
}

async function addEasyStoreVariant(snapshot, token) {
  const productId = clean(snapshot.variantParentEasyStoreProductId);
  if (!productId) throw new Error('父商品缺少 EasyStore productId；為避免建立重複商品已停止。');
  if (!clean(snapshot.variantAttributeName) || !clean(snapshot.variantParentAttributeValue) || !clean(snapshot.variantAttributeValue)) throw new Error('請先填寫細項名稱、父商品細項值與新細項值。');
  const globalMatch = await findEasyStoreMappingBySku(snapshot, token);
  if (globalMatch && globalMatch.productId !== productId) {
    throw new Error(`SKU ${snapshot.sku} 已存在於另一個 EasyStore 商品，為避免移錯商品已停止。`);
  }
  const variantTemplate = {
    ...buildEasyStoreProductBody(snapshot, true).product.variants[0],
    name: snapshot.variantAttributeValue
  };
  if (globalMatch) {
    await easyStoreRequest(`/products/${encodeURIComponent(productId)}/variants.json`, token, {
      method: 'PUT', body: { variants: [{ id: globalMatch.variantId, ...variantTemplate }] }
    });
    return { action: 'variant-updated', productId, variantIds: [globalMatch.variantId] };
  }

  const beforePayload = await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token);
  const beforeProduct = extractProducts(beforePayload)[0] || beforePayload.product || beforePayload;
  const beforeVariants = productVariants(beforeProduct);
  const beforeIds = new Set(beforeVariants.map(variantIdOf).filter(Boolean));
  const variantTypes = Array.isArray(beforeProduct.variant_types) ? beforeProduct.variant_types : [];
  if (variantTypes.length > 1) throw new Error('父商品目前有兩種以上的細項欄位；一個新 SKU 無法安全判定完整組合，請先人工整理父商品。');
  if (variantTypes.length === 1 && clean(variantTypes[0].name).toLowerCase() !== clean(snapshot.variantAttributeName).toLowerCase()) {
    throw new Error(`父商品既有細項是「${clean(variantTypes[0].name)}」，與這次的「${snapshot.variantAttributeName}」不同；為避免改壞既有細項已停止。`);
  }
  if (!variantTypes.length && beforeVariants.length !== 1) throw new Error('父商品沒有細項名稱，但已有多個規格；無法安全判定舊 SKU，請先人工整理。');
  const optionValues = variantTypes.length
    ? [snapshot.variantAttributeValue]
    : [snapshot.variantParentAttributeValue, snapshot.variantAttributeValue];
  let optionError = null;
  try {
    await easyStoreRequest(`/products/${encodeURIComponent(productId)}/options.json`, token, {
      method: 'POST', body: { option_type: snapshot.variantAttributeName, option_values: optionValues }
    });
  } catch (error) {
    // POST 回應可能中途斷線；不盲目重送，改用前後 variant id 差異確認是否已建立。
    optionError = error;
  }
  const afterPayload = await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token);
  const afterProduct = extractProducts(afterPayload)[0] || afterPayload.product || afterPayload;
  const newVariantIds = productVariants(afterProduct).map(variantIdOf).filter((id) => id && !beforeIds.has(id));
  const recovered = exactEasyStoreMatches(afterPayload, snapshot.sku)[0] || null;
  const variantId = recovered && recovered.variantId || (newVariantIds.length === 1 ? newVariantIds[0] : '');
  if (!variantId) {
    if (optionError) throw optionError;
    throw new Error(`EasyStore 已新增「${snapshot.variantAttributeValue}」選項，但產生 ${newVariantIds.length} 個新規格，無法安全判定哪一個屬於 SKU ${snapshot.sku}；請人工確認後再繼續。`);
  }
  await easyStoreRequest(`/products/${encodeURIComponent(productId)}/variants.json`, token, {
    method: 'PUT', body: { variants: [{ id: variantId, ...variantTemplate }] }
  });
  let imageWarning = '';
  const existingImages = Array.isArray(beforeProduct.images) ? beforeProduct.images : [];
  const existingImageUrls = new Set(existingImages.map((row) => safeHttpUrl(row && (row.url || row.src))).filter(Boolean));
  const availableImageSlots = Math.max(0, 9 - existingImages.length);
  const newImages = (snapshot.images || []).filter((url) => !existingImageUrls.has(safeHttpUrl(url))).slice(0, availableImageSlots);
  if (newImages.length) {
    try {
      await easyStoreRequest(`/products/${encodeURIComponent(productId)}/images.json`, token, { method: 'POST', body: { images: newImages } });
    } catch (error) {
      imageWarning = `；細項已建立，但圖片未能加入父商品：${clean(error && error.message).slice(0, 240)}`;
    }
  }
  return { action: 'variant-created', productId, variantIds: [variantId], recoveredAfterUncertainResponse: Boolean(optionError), imageWarning };
}

async function upsertEasyStoreProduct(snapshot, product, token) {
  if (snapshot.listingMode === 'add-variant') return addEasyStoreVariant(snapshot, token);
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
      // POST 可能已成功但回應在途中斷線；等待 EasyStore 完成索引，再以完全相同 SKU 回查。
      // 不在同一個不確定回應後盲目重送 POST，避免建立重複商品。
      let recovered = null;
      try {
        recovered = await recoverEasyStoreCreateBySku(snapshot, token);
      } catch (recoveryError) {
        if (/找到 \d+ 筆相同 SKU/.test(clean(recoveryError && recoveryError.message))) throw recoveryError;
        throw error;
      }
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
  if (snapshot.listingMode === 'add-variant' && !snapshot.variantParentEasyStoreProductId) missing.push('父商品 EasyStore 編號');
  if (snapshot.listingMode === 'add-variant' && (!snapshot.variantAttributeName || !snapshot.variantParentAttributeValue || !snapshot.variantAttributeValue)) missing.push('細項名稱、父商品細項值與新細項值');
  if (!snapshot.sku) missing.push('SKU');
  if (!snapshot.title) missing.push('商品名稱');
  if (!snapshot.description) missing.push('完整商品介紹');
  if (!snapshot.images.length) missing.push('上架圖片');
  if (snapshot.easyStorePrice == null) missing.push('EasyStore 售價');
  const template = shopeeTaxonomy.templateAttributeRows(snapshot, snapshot.shopeeCategoryPath);
  const attributes = new Map(normalizeShopeeAttributes(snapshot.shopeeAttributeValues)
    .map((row) => [clean(row.label).toLowerCase(), row]));
  template.filter((field) => field.manualConfirmation === true).forEach((field) => {
    const row = attributes.get(clean(field.label).toLowerCase());
    if (!row || row.confidence !== 'high') missing.push(`蝦皮屬性 ${field.label}`);
  });
  return missing;
}

function momoMissingFields(snapshot) {
  const missing = [];
  if (!snapshot.sku) missing.push('SKU');
  if (!snapshot.momoGoodsName) missing.push('MOMO 商品名稱');
  if (!snapshot.description) missing.push('完整商品介紹');
  if (!snapshot.images.length) missing.push('上架圖片');
  if (snapshot.momoPrice == null) missing.push('MOMO 售價');
  return missing;
}

function coupangMissingFields(snapshot) {
  const missing = [];
  if (!snapshot.sku) missing.push('SKU');
  if (!snapshot.coupangTitle) missing.push('酷澎標題');
  if (!snapshot.description) missing.push('完整商品介紹');
  if (!snapshot.images.length) missing.push('上架圖片');
  if (snapshot.coupangPrice == null) missing.push('酷澎售價');
  return missing;
}

function platformCategoryResolution(platform, snapshot, product) {
  const key = clean(platform).toLowerCase();
  const code = key === 'momo' ? clean(snapshot.momoCategoryCode) : clean(snapshot.coupangCategoryCode);
  const productHint = clean(snapshot.shopeeCategoryPath || product.category || snapshot.title || snapshot.description).slice(0, 420);
  const hint = `限定根分類：樂器／樂器配件；商品判斷：${productHint}`.slice(0, 500);
  const constraint = {
    scope: 'music-instruments-only',
    allowedRootNames: ['樂器', '樂器配件'],
    selectionRule: '只可在樂器或樂器配件分類樹內，選擇最接近商品本質的有效葉分類。'
  };
  return code
    ? { mode: 'provided', code, hint, source: 'listing-case', ...constraint }
    : { mode: 'auto', code: '', hint, source: 'official-platform-recommendation', ...constraint };
}

async function queueFixedIpPlatform(db, jobId, platform, snapshot, product, missingFields) {
  if (missingFields.length) {
    return { status: 'missing-fields', message: `請先補：${missingFields.join('、')}`, missingFields };
  }
  const queueRef = db.collection(PLATFORM_QUEUE_COLLECTION).doc(`${snapshot.productId}_${platform.toLowerCase()}`);
  const listingPolicy = buildPlatformQueuePolicy(product, platform, snapshot);
  const categoryResolution = platformCategoryResolution(platform, snapshot, product);
  if (listingPolicy.mode === 'block-duplicate' || listingPolicy.mode === 'block-duplicate-parent') {
    return {
      status: 'action-required',
      message: `${platform} 已對到 ${listingPolicy.existingListingIds.length} 個可能的${listingPolicy.mode === 'block-duplicate-parent' ? '父商品' : '相同 SKU 商品'}，為避免更新錯商品已停止。`
    };
  }
  if (listingPolicy.mode === 'block-missing-parent') {
    return { status: 'action-required', message: `${platform} 尚未找到父商品的平台編號；請先確認父商品已上架，再加入新細項。` };
  }
  const fingerprint = platformQueueFingerprint(platform, snapshot);
  let reusedStatus = '';
  await db.runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(queueRef);
    const existing = existingSnapshot.exists ? existingSnapshot.data() || {} : {};
    const sameIdentity = normalizeSku(existing.sku) === snapshot.sku
      && clean(existing.productId) === snapshot.productId;
    const sameFingerprint = clean(existing.fingerprint) === fingerprint;
    const existingStatus = clean(existing.status).toLowerCase();
    if (sameIdentity && sameFingerprint && PLATFORM_QUEUE_PENDING_STATUSES.has(existingStatus)) {
      reusedStatus = 'already-queued';
      return;
    }
    if (sameIdentity && sameFingerprint && PLATFORM_QUEUE_COMPLETED_STATUSES.has(existingStatus)) {
      reusedStatus = 'already-completed';
      return;
    }
    transaction.set(queueRef, {
      jobId, productId: snapshot.productId, sku: snapshot.sku, platform,
      status: 'awaiting-store-agent', payload: { ...snapshot, categoryResolution }, listingPolicy, fingerprint,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: '全通路營運中心', schemaVersion: 2
    }, { merge: true });
  });
  if (reusedStatus === 'already-queued') {
    return {
      status: 'already-queued',
      message: `${platform} 相同 SKU 的工作已在處理中，本次不會再排第二筆。`,
      queueId: queueRef.id
    };
  }
  if (reusedStatus === 'already-completed') {
    return {
      status: 'already-completed',
      message: `${platform} 相同版本已處理完成，本次不會重複建立。`,
      queueId: queueRef.id
    };
  }
  const categoryPrefix = categoryResolution.mode === 'auto' ? `${platform} 會先限定在樂器／樂器配件內，依商品名稱、內容與官方類別推薦自動判斷最接近分類；` : '';
  const message = categoryPrefix + (listingPolicy.mode === 'add-variant-to-existing'
    ? `${platform} 將把 SKU ${snapshot.sku} 加入指定的既有商品，子編號的庫存與價格仍獨立。`
    : listingPolicy.existingListingIds.length
    ? `${platform} 已找到既有平台編號，將更新原商品，不會建立第二筆。`
    : `${platform} 將先用完全相同 SKU 查詢：唯一一筆就更新、零筆才建立、多筆或不確定就停止。`);
  return {
    status: 'awaiting-store-agent',
    message,
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
  if (states.some((status) => ['awaiting-store-agent', 'waiting-easystore-sync', 'action-required', 'already-queued'].includes(status))) return 'submitted';
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
    let variantParentProduct = null;
    if (clean(listingCase.listingMode) === 'add-variant') {
      const parentId = clean(listingCase.variantParentProductId);
      if (!parentId || parentId === productId || parentId.includes('/')) throw new HttpsError('failed-precondition', '請選擇另一個有效的父商品。');
      const parentSnap = await db.collection(PRODUCT_COLLECTION).doc(parentId).get();
      if (!parentSnap.exists) throw new HttpsError('failed-precondition', '選定的父商品已不存在，請重新選擇。');
      variantParentProduct = parentSnap.data() || {};
    }
    const snapshot = buildListingSnapshot(productId, product, listingCase, variantParentProduct);
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
              variantGroup: snapshot.listingMode === 'add-variant' ? {
                parentProductId: snapshot.variantParentProductId, parentSku: snapshot.variantParentSku,
                parentName: snapshot.variantParentName, attributeName: snapshot.variantAttributeName,
                parentAttributeValue: snapshot.variantParentAttributeValue, attributeValue: snapshot.variantAttributeValue
              } : null,
              easyStoreSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '商品上架'
            }, { merge: true });
            platforms.easyStore = {
              status: result.action === 'created' ? 'created' : 'updated',
              message: (result.action === 'variant-created' ? 'EasyStore 已在既有商品中建立新細項。' : result.action === 'variant-updated' ? 'EasyStore 既有細項已更新。' : result.action === 'created' ? 'EasyStore 商品已建立。' : 'EasyStore 商品已更新。')+(result.imageWarning||''),
              productId: result.productId, variantIds: result.variantIds
            };
            const autofillPayload = buildShopeeAutofillPayload(snapshot, result);
            const identityAllowsAutofill = identityAllowsShopeeAutofill(
              snapshot.identityStatus,
              snapshot.identityManualConfirmed
            );
            platforms.shopee = snapshot.shopeeCategoryPath && identityAllowsAutofill
              ? {
                status: 'waiting-easystore-sync',
                message: `EasyStore 商品已完成；可啟動蝦皮助手自動填寫：${snapshot.shopeeCategoryPath}`,
                autofillPayload
              }
              : {
                status: 'action-required',
                message: !snapshot.shopeeCategoryPath
                  ? '請先完成蝦皮分類，再啟動自動填寫。'
                  : '商品型號或顏色尚未確認，請先核對後再送到蝦皮。'
              };
          } catch (error) {
            platforms.easyStore = { status: 'failed', message: clean(error && error.message).slice(0, 800) || 'EasyStore 上架失敗。' };
            platforms.shopee = { status: 'waiting-easystore', message: 'EasyStore 尚未完成，因此尚未送往蝦皮。' };
          }
        }
      }

      if (snapshot.enabledMomo) platforms.momo = await queueFixedIpPlatform(db, jobId, 'MOMO', snapshot, product, momoMissingFields(snapshot));
      if (snapshot.enabledCoupang) platforms.coupang = await queueFixedIpPlatform(db, jobId, 'Coupang', snapshot, product, coupangMissingFields(snapshot));
      const status = overallPublishStatus(platforms);
      const platformsForStorage = summarizePlatformsForStorage(platforms);
      const platformListingStatus = platformListingStatusFromPublish(product.platformListingStatus, platforms);
      await Promise.all([
        jobRef.set({ status, platforms: platformsForStorage, updatedAt: admin.firestore.FieldValue.serverTimestamp(), finishedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }),
        caseRef.set({
          caseStatus: status === 'completed' ? 'published' : 'submitted',
          shopeeCategoryPath: snapshot.shopeeCategoryPath,
          shopeeAttributeValues: snapshot.shopeeAttributeValues,
          publishState: { jobId, status, platforms: platformsForStorage, submittedAt: admin.firestore.FieldValue.serverTimestamp(), submittedBy: createdBy },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '商品上架', schemaVersion: 8
        }, { merge: true }),
        productRef.set({
          platformListingStatus,
          platformListingStatusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '商品上架工作'
        }, { merge: true }),
        db.collection('opsAuditLogs').add({
          action: '確認商品上架', entityType: 'productListingPublish', entityId: jobId,
          summary: `${snapshot.sku || productId}｜${snapshot.title}｜${status}`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy,
          version: '2026.08.13-shopee-taxonomy-v5'
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
    normalizeShopeeAttributes,
    applyShopeeAttributeTemplate,
    canonicalShopeeCategorySegment,
    shopeeCategorySegments,
    hsinchuSizeBand,
    buildShopeeLogistics,
    buildShopeeAutofillPayload,
    normalizeListingDecision,
    platformListingIds,
    platformQueueFingerprint,
    buildPlatformQueuePolicy,
    identityAllowsShopeeAutofill,
    summarizePlatformsForStorage,
    platformListingStatusFromPublish,
    appendShopDescriptionPromos,
    appendShopDescriptionImages,
    listingImageAllocation,
    exactEasyStoreMatches,
    easyStoreMissingFields,
    momoMissingFields,
    coupangMissingFields,
    platformCategoryResolution,
    overallPublishStatus
  }
};
