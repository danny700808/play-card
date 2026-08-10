'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const REGION = 'us-central1';
const DEFAULT_MODEL = 'gpt-5.4-mini';
const PRODUCT_COLLECTION = 'opsInternalProducts';
const LISTING_CASE_COLLECTION = 'opsProductListingCases';
const LOCK_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 240 * 1000;
const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);

const RESEARCH_STRING_FIELDS = [
  'brand', 'model', 'barcode', 'alternateNames', 'searchKeywords',
  'sellingPoints', 'specificationText', 'includedItems', 'material', 'color',
  'countryOfOrigin', 'warrantyInfo', 'commonProductDescription',
  'shopeeCategoryPath', 'momoCategoryCode', 'coupangCategoryCode'
];

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function normalizeSku(value) {
  return clean(value).replace(/^'+/, '').replace(/\u00a0/g, ' ').toUpperCase();
}

function numberOrNull(value) {
  if (value === null || value === undefined || clean(value) === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000;
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
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

function pushUrl(list, value) {
  if (Array.isArray(value)) {
    value.forEach((item) => pushUrl(list, item));
    return;
  }
  if (value && typeof value === 'object') {
    ['url', 'imageUrl', 'image_url', 'src', 'href'].forEach((key) => {
      if (value[key]) pushUrl(list, value[key]);
    });
    return;
  }
  const url = safeHttpUrl(value);
  if (url && !list.includes(url)) list.push(url);
}

function collectProductImages(product) {
  const images = [];
  [
    product.imageUrl, product.imageUrls, product.parentImageUrls,
    product.variantImageUrls, product.images, product.photos
  ].forEach((value) => pushUrl(images, value));
  return images.slice(0, 4);
}

function isAllowedManager(request) {
  const auth = request && request.auth;
  const token = auth && auth.token ? auth.token : {};
  const email = normalizeEmail(token.email || (auth && auth.email));
  const role = clean(token.role || token.userRole || token.permissionRole).toLowerCase();
  return !!(
    auth && (
      token.admin === true || token.manager === true || token.owner === true ||
      ['admin', 'manager', 'owner', '主管', '管理者'].includes(role) ||
      ADMIN_EMAILS.has(email)
    )
  );
}

function productValue(product, keys) {
  for (const key of keys) {
    if (product && product[key] !== undefined && product[key] !== null && clean(product[key])) {
      return clean(product[key]);
    }
  }
  return '';
}

function buildProductContext(productId, product, listingCase) {
  const source = listingCase || {};
  const name = productValue(product, ['internalName', 'originalName', 'name', 'onlineName']);
  const imageUrls = collectProductImages(product);
  pushUrl(imageUrls, source.productImageUrl);
  pushUrl(imageUrls, source.productImageUrls);
  return {
    productId: clean(productId),
    sku: normalizeSku(productValue(product, ['internalSku', 'sku', 'code', 'productCode'])),
    name,
    onlineName: productValue(product, ['onlineName']),
    brand: clean(source.brand) || productValue(product, ['brand']),
    model: clean(source.model) || productValue(product, ['model', 'modelNo']),
    barcode: clean(source.barcode) || productValue(product, ['barcode', 'ean', 'gtin']),
    category: productValue(product, ['category']),
    variantName: productValue(product, ['variantName']),
    productUrl: safeHttpUrl(product.onlineUrl || product.url || product.productUrl),
    imageUrls: imageUrls.slice(0, 4)
  };
}

function fingerprintProduct(context) {
  const stable = JSON.stringify({
    sku: context.sku,
    name: context.name,
    onlineName: context.onlineName,
    brand: context.brand,
    model: context.model,
    barcode: context.barcode,
    category: context.category,
    variantName: context.variantName,
    productUrl: context.productUrl,
    imageUrls: context.imageUrls
  });
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function productResearchSchema() {
  const nullableText = { type: ['string', 'null'] };
  const nullableNumber = { type: ['number', 'null'] };
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'identifiedProductName', 'brand', 'model', 'barcode', 'alternateNames',
      'searchKeywords', 'sellingPoints', 'specificationText', 'includedItems',
      'material', 'color', 'countryOfOrigin', 'warrantyInfo',
      'commonProductDescription', 'shopeeCategoryPath', 'momoCategoryCode',
      'coupangCategoryCode', 'shippingDecision', 'packageLengthCm',
      'packageWidthCm', 'packageHeightCm', 'packageWeightKg',
      'packageMeasurementMode', 'packageResearchSourceUrl', 'packageResearchNote',
      'productResearchSourceUrls', 'confidence', 'missingFields',
      'imageEvidenceUsed', 'researchSummary'
    ],
    properties: {
      identifiedProductName: nullableText,
      brand: nullableText,
      model: nullableText,
      barcode: nullableText,
      alternateNames: nullableText,
      searchKeywords: nullableText,
      sellingPoints: nullableText,
      specificationText: nullableText,
      includedItems: nullableText,
      material: nullableText,
      color: nullableText,
      countryOfOrigin: nullableText,
      warrantyInfo: nullableText,
      commonProductDescription: nullableText,
      shopeeCategoryPath: nullableText,
      momoCategoryCode: nullableText,
      coupangCategoryCode: nullableText,
      shippingDecision: { type: ['string', 'null'], enum: ['convenience', 'home', 'freight', null] },
      packageLengthCm: nullableNumber,
      packageWidthCm: nullableNumber,
      packageHeightCm: nullableNumber,
      packageWeightKg: nullableNumber,
      packageMeasurementMode: { type: 'string', enum: ['verified', 'estimated', 'not_found'] },
      packageResearchSourceUrl: nullableText,
      packageResearchNote: nullableText,
      productResearchSourceUrls: { type: 'array', items: { type: 'string' }, maxItems: 10 },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      missingFields: { type: 'array', items: { type: 'string' }, maxItems: 30 },
      imageEvidenceUsed: { type: 'boolean' },
      researchSummary: { type: 'string' }
    }
  };
}

function researchPrompt(context) {
  return [
    '你是台灣樂器行的商品資料研究員。請使用網路搜尋與提供的商品圖片，辨識並研究這一個商品。',
    '只研究能與商品名稱、品牌、型號、條碼或圖片明確對應的同一商品；若可能是不同版本，該欄位請回傳 null，不可猜測。',
    '資料來源優先順序：品牌官網、原廠型錄／說明書、台灣官方代理商、可信賴的大型零售商或平台商品頁。',
    '所有商品文案使用繁體中文，內容需可共用於 EasyStore、蝦皮、MOMO、Coupang／酷澎，不可誇大或虛構。',
    '完整規格 specificationText 請一行一項，格式為「欄位：內容」。sellingPoints 與 searchKeywords 也請使用清楚的換行或頓號。',
    '蝦皮、MOMO、酷澎分類只能提供建議的分類路徑或名稱；查不到正式分類代碼時，不要杜撰代碼。',
    '包裝尺寸必須優先尋找外箱／包裝長寬高與毛重，不要把商品本體尺寸冒充包裝尺寸。',
    '若是明顯可超商寄送的小型商品，但找不到官方包裝尺寸，可用保守估算並將 packageMeasurementMode 設為 estimated；大型樂器不可估成小包裹。',
    '判斷 convenience 時，請查詢蝦皮台灣目前可用物流的材積與重量限制，並在 packageResearchNote 簡述判斷依據；若無法確認就不要把大型商品判成可超商。',
    'shippingDecision 僅能是 convenience（可超商）、home（一般宅配）或 freight（大型／新竹物流）。這只是 AI 建議，人工決定會優先。',
    'productResearchSourceUrls 只能列出你實際搜尋並採用的完整網址。查不到的欄位全部列入 missingFields。',
    '',
    `內部商品 ID：${context.productId || '未提供'}`,
    `內部 SKU：${context.sku || '未提供'}`,
    `商品名稱：${context.name || '未提供'}`,
    `EasyStore 名稱：${context.onlineName || '未提供'}`,
    `品牌：${context.brand || '未提供'}`,
    `型號：${context.model || '未提供'}`,
    `條碼／GTIN：${context.barcode || '未提供'}`,
    `既有分類：${context.category || '未提供'}`,
    `規格名稱：${context.variantName || '未提供'}`,
    `EasyStore 商品網址：${context.productUrl || '未提供'}`
  ].join('\n');
}

function buildOpenAIRequest(context, model, includeImages) {
  const content = [{ type: 'input_text', text: researchPrompt(context) }];
  if (includeImages) {
    context.imageUrls.forEach((url) => {
      content.push({ type: 'input_image', image_url: url, detail: 'low' });
    });
  }
  return {
    model,
    store: false,
    tools: [{ type: 'web_search' }],
    include: ['web_search_call.action.sources'],
    input: [{ role: 'user', content }],
    text: {
      format: {
        type: 'json_schema',
        name: 'product_listing_research',
        strict: true,
        schema: productResearchSchema()
      }
    }
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function openAIErrorMessage(status, body) {
  const source = body && typeof body === 'object' ? body : {};
  const message = clean(source.error && source.error.message) || clean(source.message);
  if (status === 401 || status === 403) return 'OpenAI API 金鑰無效或沒有使用權限。';
  if (status === 429) return 'OpenAI 目前已達用量或速率限制，請稍後再試。';
  if (status >= 500) return 'OpenAI 服務暫時無法使用，請稍後再試。';
  return message ? `OpenAI 研究失敗：${message.slice(0, 300)}` : `OpenAI 研究失敗（HTTP ${status}）。`;
}

async function callOpenAI(apiKey, context, model, includeImages) {
  const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(buildOpenAIRequest(context, model, includeImages))
  }, REQUEST_TIMEOUT_MS);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(openAIErrorMessage(response.status, body));
    error.status = response.status;
    error.rawBody = body;
    throw error;
  }
  return body;
}

function responseOutputText(response) {
  const direct = clean(response && response.output_text);
  if (direct) return direct;
  const output = Array.isArray(response && response.output) ? response.output : [];
  for (const item of output) {
    const content = Array.isArray(item && item.content) ? item.content : [];
    for (const part of content) {
      if (part && part.type === 'output_text' && clean(part.text)) return clean(part.text);
    }
  }
  return '';
}

function collectResponseSourceUrls(response) {
  const urls = [];
  const seen = new Set();
  function visit(value, depth) {
    if (!value || depth > 8) return;
    if (typeof value === 'string') return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value.type === 'url_citation' || value.type === 'web_search_result' || value.type === 'source') {
      pushUrl(urls, value.url || value.href);
    }
    if (value.sources) visit(value.sources, depth + 1);
    if (value.annotations) visit(value.annotations, depth + 1);
    if (value.output) visit(value.output, depth + 1);
    if (value.content) visit(value.content, depth + 1);
    if (value.action) visit(value.action, depth + 1);
  }
  visit(response, 0);
  return urls.slice(0, 10);
}

function parseResearchResponse(response) {
  const text = responseOutputText(response);
  if (!text) throw new Error('OpenAI 沒有回傳可使用的商品資料。');
  let result;
  try {
    result = JSON.parse(text);
  } catch (_) {
    throw new Error('OpenAI 回傳格式不完整，請重新研究。');
  }
  const citedUrls = collectResponseSourceUrls(response);
  const modelUrls = [];
  pushUrl(modelUrls, result.productResearchSourceUrls);
  const sourceUrls = [];
  citedUrls.concat(modelUrls).forEach((url) => {
    url = safeHttpUrl(url);
    if (url && !sourceUrls.includes(url)) sourceUrls.push(url);
  });
  result.productResearchSourceUrls = sourceUrls.slice(0, 10);
  result.packageResearchSourceUrl = safeHttpUrl(result.packageResearchSourceUrl);
  return result;
}

function mergeSourceUrls(existing, researched) {
  const result = [];
  (Array.isArray(existing) ? existing : []).concat(Array.isArray(researched) ? researched : []).forEach((value) => {
    const url = safeHttpUrl(value);
    if (url && !result.includes(url)) result.push(url);
  });
  return result.slice(0, 10);
}

function fillBlank(update, existing, key, value, filledFields, preservedFields) {
  if (clean(existing[key])) {
    if (clean(value)) preservedFields.push(key);
    return;
  }
  const normalized = clean(value);
  if (!normalized) return;
  update[key] = normalized;
  filledFields.push(key);
}

function buildResearchUpdate(existingCase, result, meta) {
  const existing = existingCase || {};
  const update = {};
  const filledFields = [];
  const preservedFields = [];
  fillBlank(update, existing, 'researchedProductName', result.identifiedProductName, filledFields, preservedFields);
  RESEARCH_STRING_FIELDS.forEach((key) => fillBlank(update, existing, key, result[key], filledFields, preservedFields));

  const sourceUrls = mergeSourceUrls(existing.productResearchSourceUrls, result.productResearchSourceUrls);
  if (sourceUrls.length) update.productResearchSourceUrls = sourceUrls;

  const manualPackage = clean(existing.packageResearchStatus) === 'manual' || clean(existing.packageMeasurementMode) === 'measured';
  if (manualPackage) {
    preservedFields.push('shippingDecision', 'packageDimensions');
  } else {
    const decision = ['convenience', 'home', 'freight'].includes(clean(result.shippingDecision)) ? clean(result.shippingDecision) : '';
    if (!clean(existing.shippingDecision) && decision) {
      update.shippingDecision = decision;
      filledFields.push('shippingDecision');
    } else if (clean(existing.shippingDecision) && decision) {
      preservedFields.push('shippingDecision');
    }

    const dimensionMap = {
      packageLengthCm: numberOrNull(result.packageLengthCm),
      packageWidthCm: numberOrNull(result.packageWidthCm),
      packageHeightCm: numberOrNull(result.packageHeightCm),
      packageWeightKg: numberOrNull(result.packageWeightKg)
    };
    Object.entries(dimensionMap).forEach(([key, value]) => {
      if (numberOrNull(existing[key]) !== null) {
        if (value !== null) preservedFields.push(key);
      } else if (value !== null) {
        update[key] = value;
        filledFields.push(key);
      }
    });

    const finalDecision = clean(existing.shippingDecision) || clean(update.shippingDecision);
    const finalDimensions = {
      packageLengthCm: numberOrNull(existing.packageLengthCm) || numberOrNull(update.packageLengthCm),
      packageWidthCm: numberOrNull(existing.packageWidthCm) || numberOrNull(update.packageWidthCm),
      packageHeightCm: numberOrNull(existing.packageHeightCm) || numberOrNull(update.packageHeightCm),
      packageWeightKg: numberOrNull(existing.packageWeightKg) || numberOrNull(update.packageWeightKg)
    };
    const hasAnyDimension = Object.values(finalDimensions).some((value) => value !== null);
    if (finalDecision === 'convenience' && !hasAnyDimension) {
      Object.assign(update, { packageLengthCm: 40, packageWidthCm: 30, packageHeightCm: 10, packageWeightKg: 1 });
      filledFields.push('packageLengthCm', 'packageWidthCm', 'packageHeightCm', 'packageWeightKg');
    }

    const measurementMode = clean(result.packageMeasurementMode);
    const finalHasAllDimensions = ['packageLengthCm', 'packageWidthCm', 'packageHeightCm', 'packageWeightKg']
      .every((key) => numberOrNull(existing[key]) !== null || numberOrNull(update[key]) !== null);
    if (!clean(existing.packageMeasurementMode) && finalHasAllDimensions) {
      update.packageMeasurementMode = measurementMode === 'verified' ? 'provided' : 'estimated';
    }
    const packageSource = safeHttpUrl(result.packageResearchSourceUrl);
    if (!safeHttpUrl(existing.packageResearchSourceUrl) && packageSource) update.packageResearchSourceUrl = packageSource;
    if (!clean(existing.packageResearchNote) && clean(result.packageResearchNote)) update.packageResearchNote = clean(result.packageResearchNote);
    if (!clean(existing.packageResearchStatus) || clean(existing.packageResearchStatus) === 'not-searched') {
      update.packageResearchStatus = finalHasAllDimensions && packageSource ? 'found' : 'not-found';
    }
  }

  const merged = { ...existing, ...update };
  const ready = !!(
    sourceUrls.length && clean(merged.specificationText) &&
    clean(merged.searchKeywords) && clean(merged.commonProductDescription)
  );
  update.productResearchStatus = ready ? 'researched' : 'partial';
  if (!['published', 'archived'].includes(clean(existing.caseStatus))) update.caseStatus = ready ? 'ready' : 'draft';
  update.productResearchUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
  update.aiResearch = {
    status: 'completed',
    requestId: meta.requestId,
    responseId: clean(meta.responseId),
    model: meta.model,
    confidence: ['high', 'medium', 'low'].includes(clean(result.confidence)) ? clean(result.confidence) : 'low',
    imageEvidenceUsed: result.imageEvidenceUsed === true && meta.imageCount > 0,
    imageCount: meta.imageCount,
    inputFingerprint: meta.inputFingerprint,
    researchSummary: clean(result.researchSummary),
    missingFields: (Array.isArray(result.missingFields) ? result.missingFields : []).map(clean).filter(Boolean).slice(0, 30),
    filledFields: Array.from(new Set(filledFields)),
    preservedManualFields: Array.from(new Set(preservedFields)),
    completedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  update.updatedBy = 'OpenAI 自動研究';
  update.schemaVersion = 2;
  return { update, ready, filledFields: update.aiResearch.filledFields };
}

function shouldRetryWithoutImages(error) {
  if (!error || !error.status || ![400, 422].includes(Number(error.status))) return false;
  const text = clean(error.message).toLowerCase();
  return /image|圖片|download|fetch|url/.test(text);
}

async function researchWithOpenAI(apiKey, context, model) {
  let response;
  let imageCount = context.imageUrls.length;
  try {
    response = await callOpenAI(apiKey, context, model, imageCount > 0);
  } catch (error) {
    if (!imageCount || !shouldRetryWithoutImages(error)) throw error;
    console.warn('Product AI research image input failed; retrying with text only.', error.message);
    response = await callOpenAI(apiKey, context, model, false);
    imageCount = 0;
  }
  return { response, result: parseResearchResponse(response), imageCount };
}

function registerProductAiResearch(target) {
  target.researchProductListingCase = onCall({
    region: REGION,
    timeoutSeconds: 300,
    memory: '1GiB',
    secrets: [OPENAI_API_KEY],
    enforceAppCheck: false
  }, async (request) => {
    if (!isAllowedManager(request)) throw new HttpsError('permission-denied', '請先使用管理者帳號登入。');
    const productId = clean(request && request.data && request.data.productId);
    const force = request && request.data && request.data.force === true;
    if (!productId || productId.length > 200 || productId.includes('/')) {
      throw new HttpsError('invalid-argument', '商品 ID 格式不正確。');
    }

    const db = admin.firestore();
    const productRef = db.collection(PRODUCT_COLLECTION).doc(productId);
    const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(productId);
    const [productSnap, caseSnap] = await Promise.all([productRef.get(), caseRef.get()]);
    if (!productSnap.exists) throw new HttpsError('not-found', '找不到中央商品主檔。');
    const existingCase = caseSnap.exists ? caseSnap.data() || {} : {};
    const context = buildProductContext(productId, productSnap.data() || {}, existingCase);
    if (!context.name && !context.brand && !context.model && !context.imageUrls.length) {
      throw new HttpsError('failed-precondition', '商品名稱、品牌、型號與圖片都不足，無法進行研究。');
    }
    const inputFingerprint = fingerprintProduct(context);
    const existingAi = existingCase.aiResearch && typeof existingCase.aiResearch === 'object' ? existingCase.aiResearch : {};
    if (!force && clean(existingAi.status) === 'completed' && clean(existingAi.inputFingerprint) === inputFingerprint) {
      return { ok: true, status: 'completed', cached: true, productId, aiResearch: existingAi };
    }

    const requestId = `AI-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const lockResult = await db.runTransaction(async (transaction) => {
      const latestSnap = await transaction.get(caseRef);
      const latest = latestSnap.exists ? latestSnap.data() || {} : {};
      const latestAi = latest.aiResearch && typeof latest.aiResearch === 'object' ? latest.aiResearch : {};
      const runningAt = timestampMillis(latestAi.startedAt);
      if (clean(latestAi.status) === 'running' && runningAt && Date.now() - runningAt < LOCK_TTL_MS) {
        return { acquired: false, requestId: clean(latestAi.requestId) };
      }
      const seed = {
        productId,
        productSku: context.sku,
        productName: context.name,
        productImageUrl: context.imageUrls[0] || '',
        caseStatus: ['published', 'archived'].includes(clean(latest.caseStatus)) ? clean(latest.caseStatus) : 'researching',
        aiResearch: {
          status: 'running',
          requestId,
          model: clean(process.env.OPENAI_PRODUCT_RESEARCH_MODEL) || DEFAULT_MODEL,
          inputFingerprint,
          imageCount: context.imageUrls.length,
          startedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'OpenAI 自動研究',
        schemaVersion: 2
      };
      if (!latestSnap.exists) {
        seed.createdAt = admin.firestore.FieldValue.serverTimestamp();
        seed.createdBy = 'OpenAI 自動研究';
      }
      transaction.set(caseRef, seed, { merge: true });
      return { acquired: true, requestId };
    });
    if (!lockResult.acquired) {
      return { ok: true, status: 'running', productId, requestId: lockResult.requestId };
    }

    const model = clean(process.env.OPENAI_PRODUCT_RESEARCH_MODEL) || DEFAULT_MODEL;
    try {
      let apiKey = '';
      try { apiKey = clean(OPENAI_API_KEY.value()); } catch (_) { apiKey = clean(process.env.OPENAI_API_KEY); }
      if (!apiKey || apiKey === 'OPENAI_API_KEY_NOT_CONFIGURED') {
        throw new Error('OpenAI API 尚未設定，請先設定 Firebase Secret：OPENAI_API_KEY。');
      }
      const researched = await researchWithOpenAI(apiKey, context, model);
      const latestCaseSnap = await caseRef.get();
      const latestCase = latestCaseSnap.exists ? latestCaseSnap.data() || {} : {};
      const latestAi = latestCase.aiResearch && typeof latestCase.aiResearch === 'object' ? latestCase.aiResearch : {};
      if (clean(latestAi.requestId) !== requestId) {
        return { ok: true, status: clean(latestAi.status) || 'superseded', productId, requestId, superseded: true };
      }
      const merged = buildResearchUpdate(latestCase, researched.result, {
        requestId,
        responseId: researched.response && researched.response.id,
        model,
        imageCount: researched.imageCount,
        inputFingerprint
      });
      await caseRef.set(merged.update, { merge: true });
      await db.collection('opsAuditLogs').add({
        action: 'OpenAI 自動研究商品',
        entityType: 'productListingCase',
        entityId: productId,
        summary: `${context.sku || productId}｜${context.name || '未命名商品'}｜補入 ${merged.filledFields.length} 個欄位`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: normalizeEmail(request.auth && request.auth.token && request.auth.token.email) || '管理者',
        version: '2026.08.11-product-ai-v1'
      });
      return {
        ok: true,
        status: 'completed',
        productId,
        requestId,
        model,
        ready: merged.ready,
        imageCount: researched.imageCount,
        filledFields: merged.filledFields,
        sourceCount: merged.update.productResearchSourceUrls ? merged.update.productResearchSourceUrls.length : 0,
        confidence: merged.update.aiResearch.confidence
      };
    } catch (error) {
      const message = clean(error && error.message) || 'OpenAI 商品研究失敗。';
      console.error('researchProductListingCase failed:', error);
      await caseRef.set({
        caseStatus: ['published', 'archived'].includes(clean(existingCase.caseStatus)) ? clean(existingCase.caseStatus) : 'draft',
        aiResearch: {
          status: 'failed',
          requestId,
          model,
          inputFingerprint,
          error: message.slice(0, 500),
          failedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'OpenAI 自動研究'
      }, { merge: true }).catch(() => {});
      if (error instanceof HttpsError) throw error;
      if (/尚未設定/.test(message)) throw new HttpsError('failed-precondition', message);
      if (/用量|速率限制/.test(message)) throw new HttpsError('resource-exhausted', message);
      throw new HttpsError('internal', message);
    }
  });
}

module.exports = {
  registerProductAiResearch,
  buildProductContext,
  fingerprintProduct,
  productResearchSchema,
  buildOpenAIRequest,
  responseOutputText,
  collectResponseSourceUrls,
  parseResearchResponse,
  buildResearchUpdate,
  isAllowedManager,
  DEFAULT_MODEL
};
