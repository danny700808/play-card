'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const REGION = 'us-central1';
const DEFAULT_MODEL = 'gpt-5.6-sol';
const DEFAULT_IMAGE_WORKFLOW_MODEL = 'gpt-5.6';
const PRODUCT_COLLECTION = 'opsInternalProducts';
const LISTING_CASE_COLLECTION = 'opsProductListingCases';
const LOCK_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 480 * 1000;
const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);

const RESEARCH_STRING_FIELDS = [
  'brand', 'model', 'barcode', 'alternateNames', 'searchKeywords',
  'sellingPoints', 'specificationText', 'includedItems', 'material', 'color',
  'countryOfOrigin', 'warrantyInfo', 'commonProductDescription',
  'identityEvidence', 'identityConflictSummary', 'shortDescription',
  'featureList', 'faqText', 'easyStoreHtml',
  'shopeeTitle', 'shopeeDescription', 'shopeeRequiredNotes',
  'momoGoodsName', 'momoSlogan', 'momoHtml', 'momoRequiredNotes',
  'coupangTitle', 'coupangDescriptionHtml', 'coupangRequiredNotes',
  'imagePlan', 'shopeeCategoryPath', 'momoCategoryCode', 'coupangCategoryCode'
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

function sanitizeSafeProductHtml(value) {
  const source = clean(value)
    .replace(/<\s*(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  return source.replace(/<[^>]*>/g, (tag) => {
    const match = tag.match(/^<\s*(\/?)\s*(h2|h3|p|ul|li|strong|br)\b[^>]*>$/i);
    if (!match) return '';
    const closing = match[1] === '/';
    const name = match[2].toLowerCase();
    if (name === 'br') return '<br>';
    return closing ? `</${name}>` : `<${name}>`;
  }).trim();
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

function pushUrlRows(list, value) {
  if (typeof value === 'string' && /[\n|]/.test(value)) {
    value.split(/[\n|]+/).forEach((row) => pushUrl(list, row));
    return;
  }
  pushUrl(list, value);
}

function collectProductImages(product) {
  const images = [];
  [
    product.imageUrl, product.imageUrls, product.parentImageUrls,
    product.variantImageUrls, product.images, product.photos
  ].forEach((value) => pushUrl(images, value));
  return images.slice(0, 8);
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
  [source.productImageUrl, source.productImageUrls, source.referenceImageUrls, source.listingImageUrls]
    .forEach((value) => pushUrlRows(imageUrls, value));
  const referenceUrls = [];
  [source.referenceUrls, source.supplierReferenceUrls, source.productResearchSourceUrls,
    product.onlineUrl, product.url, product.productUrl]
    .forEach((value) => pushUrlRows(referenceUrls, value));
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
    productUrl: referenceUrls[0] || '',
    referenceUrls: referenceUrls.slice(0, 15),
    sourceProductDescription: clean(source.sourceProductDescription),
    researchInstructions: clean(source.researchInstructions),
    imageUrls: imageUrls.slice(0, 8)
  };
}

function fingerprintProduct(context) {
  const stable = JSON.stringify({
    name: context.name,
    onlineName: context.onlineName,
    brand: context.brand,
    model: context.model,
    barcode: context.barcode,
    category: context.category,
    variantName: context.variantName,
    referenceUrls: context.referenceUrls,
    sourceProductDescription: context.sourceProductDescription,
    researchInstructions: context.researchInstructions,
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
      'identityStatus', 'identifiedProductName', 'identityEvidence',
      'identityConflictSummary', 'brand', 'model', 'barcode', 'alternateNames',
      'searchKeywords', 'sellingPoints', 'specificationText', 'includedItems',
      'material', 'color', 'countryOfOrigin', 'warrantyInfo',
      'shortDescription', 'commonProductDescription', 'featureList', 'faqText',
      'easyStoreHtml', 'shopeeTitle', 'shopeeDescription', 'shopeeRequiredNotes',
      'momoGoodsName', 'momoSlogan', 'momoHtml', 'momoRequiredNotes',
      'coupangTitle', 'coupangDescriptionHtml', 'coupangRequiredNotes',
      'imagePlan', 'shopeeCategoryPath', 'momoCategoryCode', 'coupangCategoryCode',
      'shippingDecision', 'packageLengthCm',
      'packageWidthCm', 'packageHeightCm', 'packageWeightKg',
      'packageMeasurementMode', 'packageResearchSourceUrl', 'packageResearchNote',
      'productResearchSourceUrls', 'fieldEvidence', 'sourceConflicts',
      'confidence', 'missingFields',
      'imageEvidenceUsed', 'researchSummary'
    ],
    properties: {
      identityStatus: { type: 'string', enum: ['confirmed', 'possible', 'conflict', 'not_found'] },
      identifiedProductName: nullableText,
      identityEvidence: nullableText,
      identityConflictSummary: nullableText,
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
      shortDescription: nullableText,
      commonProductDescription: nullableText,
      featureList: nullableText,
      faqText: nullableText,
      easyStoreHtml: nullableText,
      shopeeTitle: nullableText,
      shopeeDescription: nullableText,
      shopeeRequiredNotes: nullableText,
      momoGoodsName: nullableText,
      momoSlogan: nullableText,
      momoHtml: nullableText,
      momoRequiredNotes: nullableText,
      coupangTitle: nullableText,
      coupangDescriptionHtml: nullableText,
      coupangRequiredNotes: nullableText,
      imagePlan: nullableText,
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
      productResearchSourceUrls: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      fieldEvidence: {
        type: 'array', maxItems: 60,
        items: {
          type: 'object', additionalProperties: false,
          required: ['field', 'sourceUrl', 'note', 'confidence'],
          properties: {
            field: { type: 'string' }, sourceUrl: nullableText, note: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
          }
        }
      },
      sourceConflicts: {
        type: 'array', maxItems: 20,
        items: {
          type: 'object', additionalProperties: false,
          required: ['field', 'values', 'note'],
          properties: {
            field: { type: 'string' }, values: { type: 'array', items: { type: 'string' }, maxItems: 10 },
            note: { type: 'string' }
          }
        }
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      missingFields: { type: 'array', items: { type: 'string' }, maxItems: 30 },
      imageEvidenceUsed: { type: 'boolean' },
      researchSummary: { type: 'string' }
    }
  };
}

function researchPrompt(context) {
  const referenceUrls = (context.referenceUrls || []).length
    ? context.referenceUrls.map((url, index) => `${index + 1}. ${url}`).join('\n')
    : '未提供';
  return [
    '你是台灣樂器行的資深商品研究與電商上架編輯。這是完整研究，不是快速搜尋。請主動多次使用網路搜尋，完成下列四個階段後才輸出。',
    '階段一｜精確辨識：以使用者提供的商品名稱、參考網址與圖片作為辨識種子；內部 SKU 故意不提供，也絕對不可拿 SKU 當品牌、型號或搜尋依據。',
    '階段二｜來源查證：先打開使用者提供的網址，再找品牌官網、原廠型錄／說明書、台灣官方代理商；不足時才用大型零售商或平台頁交叉比對。',
    '階段三｜版本防呆：只合併完全相同品牌、型號、尺寸／年份／版本的資料。若 L10、L10E 或其他版本不同，必須列入 sourceConflicts，不可混用。',
    '階段四｜上架編輯：根據已確認事實，產生繁體中文共用內容以及 EasyStore、蝦皮、MOMO、Coupang／酷澎需要的專用內容。',
    'identityStatus：至少有型號或清楚圖片且官方／兩個獨立來源吻合才可 confirmed；只有部分吻合用 possible；資料互相矛盾用 conflict；完全找不到用 not_found。',
    '如果參考網址是淘寶／供應商頁，可讀取其中的圖片與簡體中文作為辨識線索，但文案要重新整理成自然的繁體中文；不得逐字抄襲，也不得把未查證廣告詞寫成事實。',
    '所有可驗證欄位都要在 fieldEvidence 留下欄位、採用來源網址與簡短依據。找不到的欄位回傳 null 並列入 missingFields，不可猜條碼、認證、產地、保固或尺寸。',
    '完整規格 specificationText 一行一項，格式為「欄位：內容」。featureList 請整理 6～10 點有來源支持的特色；不足 6 點就誠實少寫。FAQ 只回答可由來源支持的常見問題。',
    'EasyStore、MOMO 的 HTML，以及作為 Coupang 轉接來源的格式化內容，都只使用安全的 h2、h3、p、ul、li、strong、br 標籤，不放屬性、script、style、iframe 或外部追蹤碼。蝦皮描述請純文字，不用 HTML。',
    '平台分類只能提供實際查到或合理建議的分類路徑／名稱；未查到正式分類代碼時，不可杜撰代碼，並在對應 requiredNotes 說明待人工選擇。',
    'imagePlan 是圖片製作與編排指示（主圖、規格圖、特色圖、內容物圖等），不是聲稱圖片已經生成；不得假設使用者有未提供的授權素材。',
    '包裝尺寸必須優先尋找外箱／包裝長寬高與毛重，不要把商品本體尺寸冒充包裝尺寸。',
    '若是明顯可超商寄送的小型商品，但找不到官方包裝尺寸，可用保守估算並將 packageMeasurementMode 設為 estimated；大型樂器不可估成小包裹。',
    '判斷 convenience 時，請查詢蝦皮台灣目前可用物流的材積與重量限制，並在 packageResearchNote 簡述判斷依據；若無法確認就不要把大型商品判成可超商。',
    'shippingDecision 僅能是 convenience（可超商）、home（一般宅配）或 freight（大型／新竹物流）。這只是 AI 建議，人工決定會優先。',
    'productResearchSourceUrls 只能列出你實際開啟、搜尋並採用的完整網址，最多 20 個。',
    '',
    `商品名稱：${context.name || '未提供'}`,
    `EasyStore 名稱：${context.onlineName || '未提供'}`,
    `品牌：${context.brand || '未提供'}`,
    `型號：${context.model || '未提供'}`,
    `條碼／GTIN：${context.barcode || '未提供'}`,
    `既有分類：${context.category || '未提供'}`,
    `規格名稱：${context.variantName || '未提供'}`,
    `使用者提供的商品說明：${context.sourceProductDescription || '未提供'}`,
    `店家補充研究要求：${context.researchInstructions || '未提供'}`,
    '使用者提供／既有參考網址（請優先逐一打開）：',
    referenceUrls
  ].join('\n');
}

function buildOpenAIRequest(context, model, includeImages) {
  const content = [{ type: 'input_text', text: researchPrompt(context) }];
  if (includeImages) {
    context.imageUrls.forEach((url) => {
      content.push({ type: 'input_image', image_url: url, detail: 'high' });
    });
  }
  return {
    model,
    store: false,
    reasoning: { effort: 'high' },
    max_output_tokens: 20000,
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

function buildOpenAIImageRequest(context, listingCase, imageUrls, model) {
  const source = listingCase || {};
  const content = [{
    type: 'input_text',
    text: [
      '請根據提供的真實商品參考照片，製作一張全新的正方形電商商品介紹圖。',
      '這是待人工審核的候選圖，不可變造商品外觀、配件數量、品牌、型號、材質或功能，也不可加入來源未證實的規格。',
      '不要複製供應商或淘寶原圖的版面；重新設計乾淨、專業、適合台灣樂器行的視覺。',
      '商品本體必須是主角，背景簡潔，保留足夠留白。若加入文字，只能使用自然繁體中文，最多三個很短且已確認的重點；文字不確定時寧可不放。',
      '不要加入價格、折扣、平台標誌、QR code、聯絡方式、浮水印或虛構認證。',
      `確認商品：${clean(source.researchedProductName) || context.name || '未命名商品'}`,
      `已確認短介紹：${clean(source.shortDescription) || '未提供'}`,
      `已確認特色：${clean(source.featureList) || clean(source.sellingPoints) || '未提供'}`,
      `圖片規劃：${clean(source.imagePlan) || '白底或簡潔情境的商品介紹圖'}`,
      `店家補充製圖要求：${clean(source.imageGenerationInstructions) || '未提供'}`
    ].join('\n')
  }];
  imageUrls.slice(0, 4).forEach((url) => {
    content.push({ type: 'input_image', image_url: url, detail: 'high' });
  });
  return {
    model: model || DEFAULT_IMAGE_WORKFLOW_MODEL,
    store: false,
    input: [{ role: 'user', content }],
    tools: [{ type: 'image_generation', action: 'edit' }]
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

async function callOpenAIImage(apiKey, context, listingCase, imageUrls, model) {
  const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(buildOpenAIImageRequest(context, listingCase, imageUrls, model))
  }, REQUEST_TIMEOUT_MS);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(openAIErrorMessage(response.status, body).replace('OpenAI 研究失敗', 'OpenAI 製圖失敗'));
    error.status = response.status;
    error.rawBody = body;
    throw error;
  }
  return body;
}

function responseGeneratedImageBase64(response) {
  const output = Array.isArray(response && response.output) ? response.output : [];
  for (const item of output) {
    if (item && item.type === 'image_generation_call' && clean(item.result)) return clean(item.result);
  }
  return '';
}

function firebaseDownloadUrl(bucketName, objectPath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(objectPath)}?alt=media&token=${encodeURIComponent(token)}`;
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
  return urls.slice(0, 20);
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
  result.productResearchSourceUrls = sourceUrls.slice(0, 20);
  result.packageResearchSourceUrl = safeHttpUrl(result.packageResearchSourceUrl);
  ['easyStoreHtml', 'momoHtml', 'coupangDescriptionHtml'].forEach((key) => {
    result[key] = sanitizeSafeProductHtml(result[key]);
  });
  result.fieldEvidence = (Array.isArray(result.fieldEvidence) ? result.fieldEvidence : []).map((row) => ({
    field: clean(row && row.field), sourceUrl: safeHttpUrl(row && row.sourceUrl),
    note: clean(row && row.note), confidence: ['high', 'medium', 'low'].includes(clean(row && row.confidence)) ? clean(row.confidence) : 'low'
  })).filter((row) => row.field && row.note).slice(0, 60);
  result.sourceConflicts = (Array.isArray(result.sourceConflicts) ? result.sourceConflicts : []).map((row) => ({
    field: clean(row && row.field), values: (Array.isArray(row && row.values) ? row.values : []).map(clean).filter(Boolean).slice(0, 10), note: clean(row && row.note)
  })).filter((row) => row.field && row.note).slice(0, 20);
  return result;
}

function mergeSourceUrls(existing, researched) {
  const result = [];
  (Array.isArray(existing) ? existing : []).concat(Array.isArray(researched) ? researched : []).forEach((value) => {
    const url = safeHttpUrl(value);
    if (url && !result.includes(url)) result.push(url);
  });
  return result.slice(0, 20);
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
  update.identityStatus = ['confirmed', 'possible', 'conflict', 'not_found'].includes(clean(result.identityStatus)) ? clean(result.identityStatus) : 'not_found';
  update.fieldEvidence = Array.isArray(result.fieldEvidence) ? result.fieldEvidence : [];
  update.sourceConflicts = Array.isArray(result.sourceConflicts) ? result.sourceConflicts : [];

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
  const coreReady = !!(
    clean(merged.identityStatus) === 'confirmed' && sourceUrls.length &&
    clean(merged.specificationText) && clean(merged.searchKeywords) &&
    clean(merged.sellingPoints) && clean(merged.commonProductDescription)
  );
  const platformReady = !!(
    clean(merged.shopeeTitle) && clean(merged.shopeeDescription) &&
    clean(merged.momoGoodsName) && clean(merged.momoHtml) &&
    clean(merged.coupangTitle) && clean(merged.coupangDescriptionHtml)
  );
  const ready = coreReady && platformReady;
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
    identityStatus: update.identityStatus,
    evidenceCount: update.fieldEvidence.length,
    conflictCount: update.sourceConflicts.length,
    missingFields: (Array.isArray(result.missingFields) ? result.missingFields : []).map(clean).filter(Boolean).slice(0, 30),
    filledFields: Array.from(new Set(filledFields)),
    preservedManualFields: Array.from(new Set(preservedFields)),
    completedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  update.updatedBy = 'OpenAI 自動研究';
  update.schemaVersion = 3;
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
    timeoutSeconds: 540,
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
    if (!context.name && !context.brand && !context.model && !context.imageUrls.length && !context.referenceUrls.length) {
      throw new HttpsError('failed-precondition', '商品名稱、品牌、型號、參考網址與圖片都不足，無法進行研究。');
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
        schemaVersion: 3
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
        version: '2026.08.11-product-ai-v3'
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

  target.generateProductListingImage = onCall({
    region: REGION,
    timeoutSeconds: 540,
    memory: '2GiB',
    secrets: [OPENAI_API_KEY],
    enforceAppCheck: false
  }, async (request) => {
    if (!isAllowedManager(request)) throw new HttpsError('permission-denied', '請先使用管理者帳號登入。');
    const productId = clean(request && request.data && request.data.productId);
    if (!productId || productId.length > 200 || productId.includes('/')) {
      throw new HttpsError('invalid-argument', '商品 ID 格式不正確。');
    }
    const db = admin.firestore();
    const productRef = db.collection(PRODUCT_COLLECTION).doc(productId);
    const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(productId);
    const [productSnap, caseSnap] = await Promise.all([productRef.get(), caseRef.get()]);
    if (!productSnap.exists || !caseSnap.exists) throw new HttpsError('not-found', '找不到商品或上架案件。');
    const listingCase = caseSnap.data() || {};
    if (clean(listingCase.identityStatus) !== 'confirmed' || clean(listingCase.identityDecision) !== 'accepted') {
      throw new HttpsError('failed-precondition', '請先確認是同一個商品，並將「你的身分確認」設為採用。');
    }
    const context = buildProductContext(productId, productSnap.data() || {}, listingCase);
    const imageUrls = [];
    [listingCase.listingImageUrls, listingCase.referenceImageUrls].forEach((value) => pushUrlRows(imageUrls, value));
    if (!imageUrls.length) {
      throw new HttpsError('failed-precondition', '請先上傳至少一張你有權使用的真實商品照片。');
    }
    let apiKey = '';
    try { apiKey = clean(OPENAI_API_KEY.value()); } catch (_) { apiKey = clean(process.env.OPENAI_API_KEY); }
    if (!apiKey || apiKey === 'OPENAI_API_KEY_NOT_CONFIGURED') {
      throw new HttpsError('failed-precondition', 'OpenAI API 尚未設定，請先設定 Firebase Secret：OPENAI_API_KEY。');
    }
    const model = clean(process.env.OPENAI_PRODUCT_IMAGE_MODEL) || DEFAULT_IMAGE_WORKFLOW_MODEL;
    try {
      const response = await callOpenAIImage(apiKey, context, listingCase, imageUrls, model);
      const imageBase64 = responseGeneratedImageBase64(response);
      if (!imageBase64) throw new Error('OpenAI 沒有回傳可使用的候選圖片。');
      const imageBytes = Buffer.from(imageBase64, 'base64');
      if (!imageBytes.length || imageBytes.length > 25 * 1024 * 1024) throw new Error('OpenAI 回傳的圖片大小不正確。');
      const bucket = admin.storage().bucket();
      const downloadToken = crypto.randomUUID();
      const objectPath = `ops-product-listing-cases/${productId}/generated/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
      await bucket.file(objectPath).save(imageBytes, {
        resumable: false,
        metadata: {
          contentType: 'image/png',
          cacheControl: 'public,max-age=31536000,immutable',
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
            productId,
            generatedBy: 'OpenAI'
          }
        }
      });
      const imageUrl = firebaseDownloadUrl(bucket.name, objectPath, downloadToken);
      const candidates = (Array.isArray(listingCase.generatedListingImages) ? listingCase.generatedListingImages : [])
        .filter((row) => row && safeHttpUrl(row.url)).slice(-5);
      candidates.push({
        id: crypto.randomUUID(),
        url: imageUrl,
        status: 'candidate',
        model,
        responseId: clean(response && response.id),
        sourceImageUrls: imageUrls.slice(0, 4),
        instructions: clean(listingCase.imageGenerationInstructions),
        createdAt: new Date().toISOString(),
        createdBy: normalizeEmail(request.auth && request.auth.token && request.auth.token.email) || '管理者'
      });
      await caseRef.set({
        generatedListingImages: candidates,
        lastImageGeneration: {
          status: 'completed', model, responseId: clean(response && response.id), imageUrl,
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'OpenAI 候選圖製作',
        schemaVersion: 3
      }, { merge: true });
      await db.collection('opsAuditLogs').add({
        action: 'OpenAI 製作商品候選圖',
        entityType: 'productListingCase',
        entityId: productId,
        summary: `${context.sku || productId}｜${context.name || '未命名商品'}｜候選圖待人工採用`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: normalizeEmail(request.auth && request.auth.token && request.auth.token.email) || '管理者',
        version: '2026.08.11-product-ai-image-v1'
      });
      return { ok: true, status: 'candidate', productId, imageUrl, model };
    } catch (error) {
      const message = clean(error && error.message) || 'OpenAI 候選圖製作失敗。';
      console.error('generateProductListingImage failed:', error);
      await caseRef.set({
        lastImageGeneration: {
          status: 'failed', model, error: message.slice(0, 500),
          failedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'OpenAI 候選圖製作'
      }, { merge: true }).catch(() => {});
      if (/尚未設定|請先|至少一張/.test(message)) throw new HttpsError('failed-precondition', message);
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
  buildOpenAIImageRequest,
  responseGeneratedImageBase64,
  responseOutputText,
  collectResponseSourceUrls,
  parseResearchResponse,
  sanitizeSafeProductHtml,
  buildResearchUpdate,
  isAllowedManager,
  DEFAULT_MODEL,
  DEFAULT_IMAGE_WORKFLOW_MODEL
};
