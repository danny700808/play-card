'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const sharp = require('sharp');

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const REGION = 'us-central1';
const DEFAULT_MODEL = 'gpt-5.6-sol';
const DEFAULT_IMAGE_WORKFLOW_MODEL = 'gpt-5.6';
const DEFAULT_IMAGE_EDIT_MODEL = 'gpt-image-2';
const PRODUCT_COLLECTION = 'opsInternalProducts';
const LISTING_CASE_COLLECTION = 'opsProductListingCases';
const LOCK_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 480 * 1000;
const IMAGE_IMPORT_PAGE_LIMIT = 8;
const IMAGE_IMPORT_CANDIDATE_LIMIT = 40;
const IMAGE_IMPORT_MAX_IMAGES = 10;
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

function decodeHtmlEntities(value) {
  return clean(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code) || 0)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Math.min(0x10ffff, parseInt(code, 16) || 0)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function parseHtmlAttributes(tag) {
  const attributes = {};
  String(tag || '').replace(/([^\s=/>]+)\s*(?:=\s*(?:(["'])([\s\S]*?)\2|([^\s>]+)))?/g, (_, name, _quote, quoted, bare) => {
    const key = clean(name).toLowerCase();
    if (key && key !== 'meta' && key !== 'img' && key !== 'source' && key !== 'link') {
      attributes[key] = decodeHtmlEntities(quoted === undefined ? bare || '' : quoted);
    }
    return '';
  });
  return attributes;
}

function normalizePageAssetUrl(value, pageUrl) {
  let raw = decodeHtmlEntities(value)
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/^[\s"']+|[\s"']+$/g, '');
  if (!raw || /^(?:data|blob|javascript):/i.test(raw)) return '';
  if (/^\/\//.test(raw)) raw = `https:${raw}`;
  try {
    return safeHttpUrl(new URL(raw, pageUrl).href);
  } catch (_) {
    return '';
  }
}

function imageCandidatePenalty(url) {
  const value = clean(url).toLowerCase();
  let penalty = 0;
  if (/(?:^|[\/_\-.])(logo|icon|favicon|avatar|sprite|spacer|loading|placeholder|qrcode|qr-code)(?:[\/_\-.]|$)/.test(value)) penalty += 80;
  if (/(?:badge|payment|rating|star|flag|social|emoji|tracking|pixel)/.test(value)) penalty += 45;
  if (/\.svg(?:$|\?)/.test(value)) penalty += 100;
  return penalty;
}

function extractImageCandidatesFromHtml(html, pageUrl) {
  const candidates = new Map();
  function add(value, priority, source) {
    if (!value) return;
    const parts = /(?:srcset|set)$/i.test(source || '')
      ? String(value).split(',').map((row) => row.trim().split(/\s+/)[0])
      : [value];
    parts.forEach((part) => {
      const url = normalizePageAssetUrl(part, pageUrl);
      if (!url) return;
      const score = Math.max(0, Number(priority) || 0) - imageCandidatePenalty(url);
      const existing = candidates.get(url);
      if (!existing || score > existing.score) candidates.set(url, { url, score, source: clean(source) || 'page' });
    });
  }

  const source = String(html || '');
  (source.match(/<meta\b[^>]*>/gi) || []).forEach((tag) => {
    const attributes = parseHtmlAttributes(tag);
    const key = clean(attributes.property || attributes.name || attributes.itemprop).toLowerCase();
    if (/^(?:og:image(?::secure_url)?|twitter:image(?::src)?|image|thumbnailurl)$/.test(key)) {
      add(attributes.content, 130, `meta:${key}`);
    }
  });
  (source.match(/<link\b[^>]*>/gi) || []).forEach((tag) => {
    const attributes = parseHtmlAttributes(tag);
    const rel = clean(attributes.rel).toLowerCase();
    if (rel === 'image_src' || (rel === 'preload' && clean(attributes.as).toLowerCase() === 'image')) {
      add(attributes.href, rel === 'image_src' ? 120 : 80, `link:${rel}`);
      add(attributes.imagesrcset, 78, 'link:srcset');
    }
  });
  (source.match(/<(?:img|source)\b[^>]*>/gi) || []).forEach((tag) => {
    const attributes = parseHtmlAttributes(tag);
    ['src', 'data-src', 'data-original', 'data-lazy-src', 'data-lazyload', 'data-ks-lazyload'].forEach((key) => add(attributes[key], key === 'src' ? 70 : 85, `tag:${key}`));
    ['srcset', 'data-srcset'].forEach((key) => add(attributes[key], 75, `tag:${key}`));
  });

  function visitJson(value, depth) {
    if (!value || depth > 8) return;
    if (typeof value === 'string') return add(value, 105, 'json-ld:image');
    if (Array.isArray(value)) return value.forEach((item) => visitJson(item, depth + 1));
    if (typeof value !== 'object') return;
    ['image', 'images', 'thumbnailUrl', 'contentUrl'].forEach((key) => {
      if (value[key]) visitJson(value[key], depth + 1);
    });
    if (value.url && /imageobject/i.test(clean(value['@type']))) add(value.url, 105, 'json-ld:imageobject');
    Object.entries(value).forEach(([key, item]) => {
      if (!['image', 'images', 'thumbnailUrl', 'contentUrl', 'url'].includes(key) && item && typeof item === 'object') visitJson(item, depth + 1);
    });
  }
  const jsonLdPattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let jsonMatch;
  while ((jsonMatch = jsonLdPattern.exec(source))) {
    try { visitJson(JSON.parse(decodeHtmlEntities(jsonMatch[1])), 0); } catch (_) { /* Ignore malformed third-party markup. */ }
  }

  const normalizedSource = source.replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
  const embeddedPattern = /https?:\/\/[^"'<>\\\s]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'<>\\\s]*)?/gi;
  (normalizedSource.match(embeddedPattern) || []).forEach((url) => add(url, 45, 'embedded-url'));
  return Array.from(candidates.values())
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, IMAGE_IMPORT_CANDIDATE_LIMIT);
}

function isBlockedCommercePage(url, html, status) {
  if ([401, 403, 407, 429].includes(Number(status))) return true;
  const location = clean(url).toLowerCase();
  if (/(?:login|passport|captcha|verify|sec-check|punish)/.test(location)) return true;
  const text = clean(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 50000).toLowerCase();
  const markers = ['请登录', '請登入', '安全验证', '安全驗證', '滑动验证', '滑動驗證', '访问验证', '訪問驗證', '验证码', '驗證碼', 'captcha', 'verify you are human'];
  return markers.some((marker) => text.includes(marker));
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
    color: clean(source.color),
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
    color: context.color,
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
    '你是台灣樂器行的商品上架編輯。任務是把「這一件商品」整理成可直接檢查、修改與上架的資料，不是撰寫研究或稽核報告。',
    '先使用商品名稱、使用者貼的網址與圖片判斷商品；使用者指定的型號、顏色與版本就是本次上架對象。內部 SKU 故意不提供，不可拿 SKU 當品牌、型號或搜尋依據。',
    '如果有使用者提供的商品頁，先打開該頁；再以品牌官網、台灣代理商、型錄或可用的零售頁補齊資料。沒有網址時，直接依商品名稱、品牌、型號與圖片搜尋。',
    '目標是實用且大致正確的完整度，不必為了追求研究等級的完美而阻擋上架。但條碼、認證、產地、保固、包裝尺寸與重量不可憑空猜測；不確定就回傳 null。',
    '參考網址若是淘寶或供應商頁，可以參考圖片、排版、簡體中文與特色，但請重新寫成自然的台灣繁體中文，不逐字複製。',
    'sellingPoints 寫一句有吸引力的商品賣點；shortDescription 寫成 2～4 句自然、活潑、面向顧客的介紹，先說適合誰或使用情境，再帶出核心特色，避免研究報告口吻與空泛誇大。specificationText 一行一項，格式為「欄位：內容」。',
    'featureList 必須寫 6～10 點，每點獨立一行並以「1. 」「2. 」依序編號。可納入結構、材質、操作、音色、適用對象、收納或使用情境，但不可捏造未知功能。',
    'commonProductDescription 是本商品的完整上架介紹，要好讀且有購買參考價值；整合商品簡介、特色、規格、內容物與適用對象，不要寫研究過程、來源比對或身分確認說明。',
    '根據同一份商品事實產生 EasyStore、蝦皮、MOMO 與 Coupang／酷澎內容；相同事實不重複發明，只調整各平台的標題、格式、分類與特殊必填欄位。',
    'EasyStore、MOMO 的 HTML，以及作為 Coupang 轉接來源的格式化內容，都只使用安全的 h2、h3、p、ul、li、strong、br 標籤，不放屬性、script、style、iframe 或外部追蹤碼。蝦皮描述請純文字，不用 HTML。',
    '平台分類只能提供實際查到或合理建議的分類路徑／名稱；未查到正式分類代碼時，不可杜撰代碼，並在對應 requiredNotes 說明待人工選擇。',
    'imagePlan 是圖片製作與編排指示（主圖、規格圖、特色圖、內容物圖等），不是聲稱圖片已經生成；不得假設使用者有未提供的授權素材。',
    '包裝尺寸必須優先尋找外箱／包裝長寬高與毛重，不要把商品本體尺寸冒充包裝尺寸。',
    '若是明顯可超商寄送的小型商品，但找不到官方包裝尺寸，可用保守估算並將 packageMeasurementMode 設為 estimated；大型樂器不可估成小包裹。',
    '判斷 convenience 時，請查詢蝦皮台灣目前可用物流的材積與重量限制，並在 packageResearchNote 簡述判斷依據；若無法確認就不要把大型商品判成可超商。',
    'shippingDecision 僅能是 convenience（可超商）、home（一般宅配）或 freight（大型／新竹物流）。這只是 AI 建議，人工決定會優先。',
    'identityStatus、fieldEvidence、sourceConflicts、productResearchSourceUrls 是系統內部記錄：簡短、足夠追溯即可，不要讓這些內容取代實際的上架文案。productResearchSourceUrls 只列實際用到的完整網址，最多 20 個。',
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
        name: 'product_listing_content',
        strict: true,
        schema: productResearchSchema()
      }
    }
  };
}

function buildProductImageSourceDiscoveryRequest(context, model) {
  return {
    model: model || DEFAULT_MODEL,
    store: false,
    reasoning: { effort: 'medium' },
    max_output_tokens: 3000,
    tools: [{ type: 'web_search' }],
    include: ['web_search_call.action.sources'],
    input: [{
      role: 'user',
      content: [{
        type: 'input_text',
        text: [
          '替台灣樂器行尋找「同一品牌、同一型號、同一顏色／版本」商品的公開網頁，目的是從頁面取得商品主圖、規格圖與情境圖。',
          '優先順序：品牌官網、台灣代理商、可公開瀏覽的授權零售頁。排除需要登入、App 才能開啟、社群貼文、搜尋結果頁與明顯不同顏色或不同型號。',
          '只能列出實際搜尋到且可直接開啟的完整 https 網址，不可捏造網址；最多六頁。',
          `商品名稱：${context.name || '未提供'}`,
          `品牌：${context.brand || '未提供'}`,
          `型號：${context.model || '未提供'}`,
          `規格／顏色：${context.color || context.variantName || '未提供'}`,
          `既有商品網址：${(context.referenceUrls || []).join('\n') || '未提供'}`
        ].join('\n')
      }]
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'product_image_source_pages',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['pages'],
          properties: {
            pages: {
              type: 'array', maxItems: 6,
              items: {
                type: 'object', additionalProperties: false,
                required: ['url', 'reason'],
                properties: { url: { type: 'string' }, reason: { type: 'string' } }
              }
            }
          }
        }
      }
    }
  };
}

function buildOpenAIImageRequest(context, listingCase, imageUrls, model) {
  const source = listingCase || {};
  const content = [{
    type: 'input_text',
    text: [
      '這是一張已排版的供應商商品介紹圖，請做「最小幅度的台灣繁體中文在地化」。',
      '必須保留原圖的商品外觀、顏色、型號、材質、配件數量、拍攝角度、裁切、背景、圖示、視覺層級與整體版面；不重新設計、不改成正方形。',
      '將圖中的簡體中文改為自然的台灣繁體中文，尺寸、數字、型號、單位與已確認商品事實不變。',
      '可清除人民幣價格、折扣、購物平台介面標記、賣家聯絡方式與 QR code；但不可移除品牌標誌、著作權標示或權利人浮水印。',
      '若原文太小而無法準確辨識，保留原圖而不猜測；不新增未經確認的規格、認證、保固或贈品。',
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

function buildLocalizedImagePrompt(context, listingCase, position, total) {
  const source = listingCase || {};
  return [
    '你正在編輯一張已完成排版的供應商商品介紹圖。目標是用於台灣電商上架，只做必要的繁體中文在地化。',
    '這是圖像編輯任務，不是重新設計。輸出必須保持與輸入圖相同的寬高比與構圖。',
    '嚴格保留：商品本體、品牌、型號、顏色、材質、配件數量、拍攝角度、背景、圖示、圖片順序感、文字區塊位置及視覺風格。',
    '將可清楚辨識的簡體中文改為自然、正確的台灣繁體中文；數字、規格、型號與單位不得改變。',
    '可移除：人民幣價格、折扣、購物平台介面元素、賣家聯絡方式、賣家 QR code。',
    '必須保留：品牌標誌、合法的著作權標示、權利人浮水印。不得仿製、遮蓋或移除這些權利標示。',
    '不得猜測難以辨識的小字，不得新增來源未證實的功能、認證、價格、保固或贈品。',
    `本批第 ${Math.max(1, Number(position) || 1)} 張／共 ${Math.max(1, Number(total) || 1)} 張。`,
    `商品：${clean(source.researchedProductName) || context.name || '未命名商品'}`,
    `品牌：${clean(source.brand) || context.brand || '未提供'}`,
    `型號：${clean(source.model) || context.model || '未提供'}`,
    `顏色：${clean(source.color) || '以原圖為準'}`,
    `店家補充：${clean(source.imageGenerationInstructions) || '無；維持原版面即可'}`
  ].join('\n');
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

async function discoverPublicProductPageUrls(apiKey, context, model) {
  const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(buildProductImageSourceDiscoveryRequest(context, model))
  }, REQUEST_TIMEOUT_MS);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(openAIErrorMessage(response.status, body).replace('OpenAI 研究失敗', '公開圖片來源搜尋失敗'));
  let parsed = {};
  try { parsed = JSON.parse(responseOutputText(body) || '{}'); } catch (_) { parsed = {}; }
  const urls = [];
  (Array.isArray(parsed.pages) ? parsed.pages : []).forEach((row) => pushUrl(urls, row && row.url));
  collectResponseSourceUrls(body).forEach((url) => pushUrl(urls, url));
  return urls.slice(0, 6);
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

function isPrivateIpAddress(address) {
  const value = clean(address).toLowerCase();
  if (!value) return true;
  if (value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const ipv4 = mapped ? mapped[1] : value;
  if (net.isIP(ipv4) !== 4) return false;
  const parts = ipv4.split('.').map(Number);
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    parts[0] >= 224;
}

async function assertPublicRemoteUrl(value) {
  const url = safeHttpUrl(value);
  if (!url) throw new Error('圖片網址格式不正確。');
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('圖片網址不可使用內部主機。');
  }
  if (net.isIP(host)) {
    if (isPrivateIpAddress(host)) throw new Error('圖片網址不可使用內部 IP。');
  } else {
    const addresses = await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
    if (!addresses.length || addresses.some((row) => isPrivateIpAddress(row && row.address))) {
      throw new Error('圖片網址無法安全讀取。');
    }
  }
  return url;
}

async function fetchPublicProductPage(value) {
  let url = await assertPublicRemoteUrl(value);
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,image/png,image/jpeg;q=0.8,*/*;q=0.5',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
        'User-Agent': 'YouziProductImageImporter/1.0'
      }
    }, 90 * 1000);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = clean(response.headers.get('location'));
      if (!location || redirectCount === 5) throw new Error('商品頁轉址次數過多。');
      url = await assertPublicRemoteUrl(new URL(location, url).href);
      continue;
    }
    const contentType = clean(response.headers.get('content-type')).split(';')[0].toLowerCase();
    if (contentType.startsWith('image/')) {
      if (!response.ok) throw new Error(`無法讀取商品圖片（HTTP ${response.status}）。`);
      return { pageUrl: url, candidates: [{ url, score: 160, source: 'direct-image' }], blocked: false };
    }
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > 5 * 1024 * 1024) throw new Error('商品頁內容過大，無法安全讀取。');
    const html = await response.text();
    if (Buffer.byteLength(html, 'utf8') > 5 * 1024 * 1024) throw new Error('商品頁內容過大，無法安全讀取。');
    if (isBlockedCommercePage(url, html, response.status)) {
      const error = new Error('商品頁要求登入或安全驗證，雲端無法直接讀取；不需要提供帳號密碼。');
      error.code = 'page-blocked';
      throw error;
    }
    if (!response.ok) throw new Error(`無法讀取商品頁（HTTP ${response.status}）。`);
    if (contentType && !/(?:html|xhtml|json|text)/.test(contentType)) throw new Error('這個網址不是可讀取的商品頁。');
    const candidates = extractImageCandidatesFromHtml(html, url);
    if (!candidates.length) throw new Error('商品頁可開啟，但沒有找到可用的商品圖片。');
    return { pageUrl: url, candidates, blocked: false };
  }
  throw new Error('無法讀取商品頁。');
}

async function downloadImageForImport(value, sourcePageUrl) {
  let url = await assertPublicRemoteUrl(value);
  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5',
        Referer: safeHttpUrl(sourcePageUrl) || new URL(url).origin + '/',
        'User-Agent': 'YouziProductImageImporter/1.0'
      }
    }, 90 * 1000);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = clean(response.headers.get('location'));
      if (!location || redirectCount === 4) throw new Error('圖片轉址次數過多。');
      url = await assertPublicRemoteUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`無法讀取來源圖片（HTTP ${response.status}）。`);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > 20 * 1024 * 1024) throw new Error('來源圖片超過 20 MB。');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('來源圖片大小不正確。');
    const metadata = await sharp(bytes, { limitInputPixels: 100000000 }).metadata().catch(() => ({}));
    const width = Math.max(0, Number(metadata.width) || 0), height = Math.max(0, Number(metadata.height) || 0);
    if (!width || !height) throw new Error('來源圖片無法辨識。');
    if (Math.max(width, height) < 600 || width * height < 240000) throw new Error('圖片尺寸太小，略過圖示或縮圖。');
    const ratio = Math.max(width / height, height / width);
    if (ratio > 5) throw new Error('圖片比例過長，略過橫幅或裝飾圖。');
    const output = await sharp(bytes, { limitInputPixels: 100000000 })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
      .toBuffer();
    const outputMetadata = await sharp(output).metadata();
    return {
      bytes: output,
      contentType: 'image/jpeg',
      extension: 'jpg',
      finalUrl: url,
      width: Number(outputMetadata.width) || width,
      height: Number(outputMetadata.height) || height,
      hash: crypto.createHash('sha256').update(output).digest('hex')
    };
  }
  throw new Error('無法讀取來源圖片。');
}

async function downloadImageForEdit(value) {
  let url = await assertPublicRemoteUrl(value);
  for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.7', 'User-Agent': 'YouziProductListingImageEditor/1.0' }
    }, 90 * 1000);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = clean(response.headers.get('location'));
      if (!location || redirectCount === 4) throw new Error('圖片轉址次數過多。');
      url = await assertPublicRemoteUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`無法讀取來源圖片（HTTP ${response.status}）。`);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > 20 * 1024 * 1024) throw new Error('來源圖片超過 20 MB。');
    const contentType = clean(response.headers.get('content-type')).split(';')[0].toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      throw new Error('只支援 JPG、PNG 或 WebP 來源圖片。');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('來源圖片大小不正確。');
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const metadata = await sharp(bytes, { limitInputPixels: 100000000 }).metadata().catch(() => ({}));
    const width = Math.max(0, Number(metadata.width) || 0), height = Math.max(0, Number(metadata.height) || 0);
    if (!width || !height) throw new Error('來源圖片無法辨識。');
    return { bytes, contentType, extension, finalUrl: url, width, height };
  }
  throw new Error('無法讀取來源圖片。');
}

async function callOpenAIImageEdit(apiKey, sourceImageUrl, prompt, model) {
  const source = await downloadImageForEdit(sourceImageUrl);
  const form = new FormData();
  form.append('model', model || DEFAULT_IMAGE_EDIT_MODEL);
  form.append('image[]', new Blob([source.bytes], { type: source.contentType }), `source.${source.extension}`);
  form.append('prompt', clean(prompt));
  form.append('quality', 'high');
  form.append('size', source.width > source.height * 1.15 ? '1536x1024' : source.height > source.width * 1.15 ? '1024x1536' : '1024x1024');
  form.append('output_format', 'png');
  const response = await fetchWithTimeout('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  }, REQUEST_TIMEOUT_MS);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(openAIErrorMessage(response.status, body).replace('OpenAI 研究失敗', 'OpenAI 圖片轉換失敗'));
    error.status = response.status;
    error.rawBody = body;
    throw error;
  }
  const data = Array.isArray(body && body.data) ? body.data : [];
  const imageBase64 = clean(data[0] && data[0].b64_json);
  if (!imageBase64) throw new Error('OpenAI 沒有回傳可使用的繁體化圖片。');
  return { response: body, imageBase64, sourceFinalUrl: source.finalUrl };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => run()));
  return results;
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

function fillBlank(update, existing, key, value, filledFields, preservedFields, replaceExisting) {
  const existingValue = clean(existing[key]);
  if (existingValue && !replaceExisting) {
    if (clean(value)) preservedFields.push(key);
    return;
  }
  const normalized = clean(value);
  if (!normalized) {
    if (existingValue && replaceExisting) {
      update[key] = '';
      filledFields.push(key);
    }
    return;
  }
  update[key] = normalized;
  filledFields.push(key);
}

function buildResearchUpdate(existingCase, result, meta) {
  const existing = existingCase || {};
  const update = {};
  const filledFields = [];
  const preservedFields = [];
  const replaceFields = new Set(Array.isArray(meta.replaceFields) ? meta.replaceFields.map(clean).filter(Boolean) : []);
  fillBlank(update, existing, 'researchedProductName', result.identifiedProductName, filledFields, preservedFields, replaceFields.has('researchedProductName'));
  RESEARCH_STRING_FIELDS.forEach((key) => fillBlank(update, existing, key, result[key], filledFields, preservedFields, replaceFields.has(key)));
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
    (clean(merged.researchedProductName) || clean(merged.productName)) &&
    clean(merged.specificationText) && clean(merged.featureList) &&
    clean(merged.commonProductDescription)
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
  update.updatedBy = 'OpenAI 上架整理';
  update.schemaVersion = 4;
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
      throw new HttpsError('failed-precondition', '商品名稱、品牌、型號、參考網址與圖片都不足，無法整理上架資料。');
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
        updatedBy: 'OpenAI 上架整理',
        schemaVersion: 4
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
        inputFingerprint,
        replaceFields: force && Array.isArray(latestAi.filledFields) ? latestAi.filledFields : []
      });
      await caseRef.set(merged.update, { merge: true });
      await db.collection('opsAuditLogs').add({
        action: 'OpenAI 整理商品上架資料',
        entityType: 'productListingCase',
        entityId: productId,
        summary: `${context.sku || productId}｜${context.name || '未命名商品'}｜補入 ${merged.filledFields.length} 個欄位`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: normalizeEmail(request.auth && request.auth.token && request.auth.token.email) || '管理者',
        version: '2026.08.11-product-listing-ai-v4'
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
      const message = clean(error && error.message) || 'OpenAI 商品上架資料整理失敗。';
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
        updatedBy: 'OpenAI 上架整理'
      }, { merge: true }).catch(() => {});
      if (error instanceof HttpsError) throw error;
      if (/尚未設定/.test(message)) throw new HttpsError('failed-precondition', message);
      if (/用量|速率限制/.test(message)) throw new HttpsError('resource-exhausted', message);
      throw new HttpsError('internal', message);
    }
  });

  target.importProductListingImages = onCall({
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
    const requestedPageUrls = [];
    pushUrlRows(requestedPageUrls, request && request.data && request.data.pageUrls);
    const db = admin.firestore();
    const productRef = db.collection(PRODUCT_COLLECTION).doc(productId);
    const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(productId);
    const [productSnap, caseSnap] = await Promise.all([productRef.get(), caseRef.get()]);
    if (!productSnap.exists || !caseSnap.exists) throw new HttpsError('not-found', '找不到商品或上架案件。');
    const product = productSnap.data() || {};
    const listingCase = caseSnap.data() || {};
    const context = buildProductContext(productId, product, listingCase);
    const existingImageUrls = [];
    pushUrlRows(existingImageUrls, listingCase.referenceImageUrls);
    const availableSlots = Math.max(0, IMAGE_IMPORT_MAX_IMAGES - existingImageUrls.length);
    if (!availableSlots) throw new HttpsError('failed-precondition', '這件商品已經有 10 張來源圖片，請先移除不需要的圖片再匯入。');

    const initialPageUrls = [];
    [requestedPageUrls, listingCase.referenceUrls, listingCase.productResearchSourceUrls, context.referenceUrls]
      .forEach((value) => pushUrlRows(initialPageUrls, value));
    const pageResults = [];
    const failures = [];
    const candidateMap = new Map();
    function failureRow(pageUrl, error) {
      let host = '';
      try { host = new URL(pageUrl).hostname; } catch (_) { host = clean(pageUrl).slice(0, 120); }
      return {
        pageUrl: safeHttpUrl(pageUrl),
        host,
        blocked: clean(error && error.code) === 'page-blocked',
        message: (clean(error && error.message) || '無法讀取此頁').slice(0, 240)
      };
    }
    async function collectPages(urls, origin) {
      const unique = [];
      (urls || []).forEach((url) => {
        url = safeHttpUrl(url);
        if (url && !pageResults.some((row) => row.requestedUrl === url) && !unique.includes(url)) unique.push(url);
      });
      const results = await mapWithConcurrency(unique.slice(0, IMAGE_IMPORT_PAGE_LIMIT), 2, async (pageUrl) => {
        const result = await fetchPublicProductPage(pageUrl);
        return { ...result, requestedUrl: pageUrl, origin };
      });
      results.forEach((row, index) => {
        const requestedUrl = unique[index];
        if (!row.ok) {
          failures.push(failureRow(requestedUrl, row.error));
          pageResults.push({ requestedUrl, origin, ok: false });
          return;
        }
        const page = row.value;
        pageResults.push({ requestedUrl, pageUrl: page.pageUrl, origin, ok: true, imageCount: page.candidates.length });
        page.candidates.forEach((candidate) => {
          if (existingImageUrls.includes(candidate.url)) return;
          const current = candidateMap.get(candidate.url);
          const next = { ...candidate, sourcePageUrl: page.pageUrl, origin };
          if (!current || next.score > current.score) candidateMap.set(candidate.url, next);
        });
      });
    }

    await caseRef.set({
      lastImageImport: {
        status: 'running',
        requestedPageCount: initialPageUrls.length,
        startedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: '商品網址圖片匯入'
    }, { merge: true });

    try {
      await collectPages(initialPageUrls, 'provided');
      let searchedPublicSources = false;
      if (candidateMap.size < Math.max(6, availableSlots)) {
        let apiKey = '';
        try { apiKey = clean(OPENAI_API_KEY.value()); } catch (_) { apiKey = clean(process.env.OPENAI_API_KEY); }
        if (apiKey && apiKey !== 'OPENAI_API_KEY_NOT_CONFIGURED') {
          try {
            const discovered = await discoverPublicProductPageUrls(apiKey, context, clean(process.env.OPENAI_PRODUCT_RESEARCH_MODEL) || DEFAULT_MODEL);
            const alreadyTried = new Set(pageResults.map((row) => row.requestedUrl));
            const additional = discovered.filter((url) => !alreadyTried.has(url));
            if (additional.length) {
              searchedPublicSources = true;
              await collectPages(additional, 'public-search');
            }
          } catch (error) {
            failures.push(failureRow('https://api.openai.com/v1/responses', error));
          }
        }
      }

      const candidates = Array.from(candidateMap.values())
        .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
        .slice(0, Math.min(24, IMAGE_IMPORT_CANDIDATE_LIMIT));
      const downloaded = [];
      const seenHashes = new Set();
      for (let offset = 0; offset < candidates.length && downloaded.length < availableSlots; offset += 4) {
        const batch = candidates.slice(offset, offset + 4);
        const rows = await mapWithConcurrency(batch, 3, async (candidate) => ({ candidate, image: await downloadImageForImport(candidate.url, candidate.sourcePageUrl) }));
        rows.forEach((row) => {
          if (!row.ok || downloaded.length >= availableSlots) return;
          if (seenHashes.has(row.value.image.hash)) return;
          seenHashes.add(row.value.image.hash);
          downloaded.push(row.value);
        });
      }
      if (!downloaded.length) {
        const blocked = failures.some((row) => row.blocked);
        throw new Error(blocked
          ? '供應商頁要求登入或安全驗證，雲端無法直接讀取；系統已嘗試同型號公開頁，但仍找不到足夠圖片。請直接上傳截圖或原圖，不需要提供帳號密碼。'
          : '目前網址與同型號公開頁都沒有找到尺寸足夠的商品圖片；可以改貼原廠商品頁，或直接上傳截圖。');
      }

      const bucket = admin.storage().bucket();
      const imported = [];
      for (let index = 0; index < downloaded.length; index += 1) {
        const row = downloaded[index], downloadToken = crypto.randomUUID();
        const objectPath = `ops-product-listing-cases/${productId}/references/imported/${Date.now()}-${String(index + 1).padStart(2, '0')}-${row.image.hash.slice(0, 10)}.jpg`;
        await bucket.file(objectPath).save(row.image.bytes, {
          resumable: false,
          metadata: {
            contentType: 'image/jpeg',
            cacheControl: 'public,max-age=31536000,immutable',
            metadata: {
              firebaseStorageDownloadTokens: downloadToken,
              productId,
              importedBy: 'product-page-image-import',
              sourcePageUrl: clean(row.candidate.sourcePageUrl).slice(0, 1000),
              sourceImageUrl: clean(row.image.finalUrl).slice(0, 1000)
            }
          }
        });
        imported.push({
          id: crypto.randomUUID(),
          url: firebaseDownloadUrl(bucket.name, objectPath, downloadToken),
          sourcePageUrl: safeHttpUrl(row.candidate.sourcePageUrl),
          sourceImageUrl: safeHttpUrl(row.image.finalUrl),
          width: row.image.width,
          height: row.image.height,
          importedAt: new Date().toISOString()
        });
      }
      const referenceImageUrls = existingImageUrls.concat(imported.map((row) => row.url)).slice(0, IMAGE_IMPORT_MAX_IMAGES);
      const selectedImageUrls = [];
      [listingCase.selectedReferenceImageUrls, imported.map((row) => row.url)].forEach((value) => pushUrlRows(selectedImageUrls, value));
      const existingImported = Array.isArray(listingCase.importedReferenceImages) ? listingCase.importedReferenceImages : [];
      await caseRef.set({
        referenceImageUrls,
        selectedReferenceImageUrls: selectedImageUrls.filter((url) => referenceImageUrls.includes(url)).slice(0, IMAGE_IMPORT_MAX_IMAGES),
        importedReferenceImages: existingImported.concat(imported).slice(-30),
        lastImageImport: {
          status: 'completed',
          requestedPageCount: initialPageUrls.length,
          readablePageCount: pageResults.filter((row) => row.ok).length,
          searchedPublicSources,
          importedCount: imported.length,
          blockedPageCount: failures.filter((row) => row.blocked).length,
          failures: failures.slice(0, 12),
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: '商品網址圖片匯入',
        schemaVersion: 6
      }, { merge: true });
      await db.collection('opsAuditLogs').add({
        action: '從商品網址匯入候選圖片',
        entityType: 'productListingCase',
        entityId: productId,
        summary: `${context.sku || productId}｜${context.name || '未命名商品'}｜匯入 ${imported.length} 張｜${searchedPublicSources ? '含同型號公開來源' : '商品頁來源'}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: normalizeEmail(request.auth && request.auth.token && request.auth.token.email) || '管理者',
        version: '2026.08.11-product-image-url-import-v1'
      });
      return {
        ok: true,
        productId,
        importedCount: imported.length,
        referenceImageUrls,
        searchedPublicSources,
        blockedPageCount: failures.filter((row) => row.blocked).length,
        failures: failures.slice(0, 12)
      };
    } catch (error) {
      const message = clean(error && error.message) || '商品網址圖片匯入失敗。';
      console.error('importProductListingImages failed:', error);
      await caseRef.set({
        lastImageImport: {
          status: 'failed',
          error: message.slice(0, 500),
          failures: failures.slice(0, 12),
          failedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: '商品網址圖片匯入'
      }, { merge: true }).catch(() => {});
      if (/請先|已經有 10 張|要求登入|沒有找到|找不到足夠|改貼原廠|直接上傳/.test(message)) {
        throw new HttpsError('failed-precondition', message);
      }
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
    const context = buildProductContext(productId, productSnap.data() || {}, listingCase);
    const allowedImageUrls = [];
    [listingCase.referenceImageUrls, listingCase.listingImageUrls].forEach((value) => pushUrlRows(allowedImageUrls, value));
    const requestedImageUrls = [];
    pushUrlRows(requestedImageUrls, request && request.data && request.data.imageUrls);
    const savedSelection = [];
    pushUrlRows(savedSelection, listingCase.selectedReferenceImageUrls);
    const preferredImageUrls = requestedImageUrls.length ? requestedImageUrls : savedSelection.length ? savedSelection : allowedImageUrls;
    const imageUrls = preferredImageUrls.filter((url) => allowedImageUrls.includes(url)).slice(0, 10);
    if (!imageUrls.length) {
      throw new HttpsError('failed-precondition', '請先上傳至少一張你有權使用的真實商品照片。');
    }
    let apiKey = '';
    try { apiKey = clean(OPENAI_API_KEY.value()); } catch (_) { apiKey = clean(process.env.OPENAI_API_KEY); }
    if (!apiKey || apiKey === 'OPENAI_API_KEY_NOT_CONFIGURED') {
      throw new HttpsError('failed-precondition', 'OpenAI API 尚未設定，請先設定 Firebase Secret：OPENAI_API_KEY。');
    }
    const model = clean(process.env.OPENAI_PRODUCT_IMAGE_EDIT_MODEL) || DEFAULT_IMAGE_EDIT_MODEL;
    try {
      const bucket = admin.storage().bucket();
      await caseRef.set({
        lastImageGeneration: {
          status: 'running', model, requestedCount: imageUrls.length,
          startedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'OpenAI 圖片繁體化'
      }, { merge: true });
      const batchResults = await mapWithConcurrency(imageUrls, 2, async (sourceImageUrl, index) => {
        const prompt = buildLocalizedImagePrompt(context, listingCase, index + 1, imageUrls.length);
        const edited = await callOpenAIImageEdit(apiKey, sourceImageUrl, prompt, model);
        const imageBytes = Buffer.from(edited.imageBase64, 'base64');
        if (!imageBytes.length || imageBytes.length > 25 * 1024 * 1024) throw new Error('OpenAI 回傳的圖片大小不正確。');
        const downloadToken = crypto.randomUUID();
        const objectPath = `ops-product-listing-cases/${productId}/generated/${Date.now()}-${String(index + 1).padStart(2, '0')}-${crypto.randomBytes(4).toString('hex')}.png`;
        await bucket.file(objectPath).save(imageBytes, {
          resumable: false,
          metadata: {
            contentType: 'image/png',
            cacheControl: 'public,max-age=31536000,immutable',
            metadata: {
              firebaseStorageDownloadTokens: downloadToken,
              productId,
              generatedBy: 'OpenAI',
              workflow: 'traditional-chinese-localization'
            }
          }
        });
        return {
          id: crypto.randomUUID(),
          url: firebaseDownloadUrl(bucket.name, objectPath, downloadToken),
          status: 'ready',
          mode: 'localized',
          model,
          sourceImageUrl,
          sourceFinalUrl: edited.sourceFinalUrl,
          sourceOrder: index + 1,
          instructions: clean(listingCase.imageGenerationInstructions),
          createdAt: new Date().toISOString(),
          createdBy: normalizeEmail(request.auth && request.auth.token && request.auth.token.email) || '管理者'
        };
      });
      const completed = batchResults.filter((row) => row.ok).map((row) => row.value);
      const failed = batchResults.map((row, index) => row.ok ? null : {
        sourceImageUrl: imageUrls[index],
        message: (clean(row.error && row.error.message) || '圖片轉換失敗。').slice(0, 300)
      }).filter(Boolean);
      if (!completed.length) throw (batchResults.find((row) => !row.ok) || {}).error || new Error('圖片轉換失敗。');
      const candidates = completed.slice(0, 10);
      const listingImageUrls = [];
      pushUrlRows(listingImageUrls, candidates.map((row) => row.url));
      pushUrlRows(listingImageUrls, listingCase.listingImageUrls);
      await caseRef.set({
        generatedListingImages: candidates,
        listingImageUrls: listingImageUrls.slice(0, 10),
        lastImageGeneration: {
          status: failed.length ? 'partial' : 'completed', model,
          requestedCount: imageUrls.length, completedCount: completed.length, failedCount: failed.length,
          imageUrls: completed.map((row) => row.url), failures: failed,
          completedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'OpenAI 圖片繁體化',
        schemaVersion: 5
      }, { merge: true });
      await db.collection('opsAuditLogs').add({
        action: 'OpenAI 批次繁體化商品圖',
        entityType: 'productListingCase',
        entityId: productId,
        summary: `${context.sku || productId}｜${context.name || '未命名商品'}｜完成 ${completed.length} 張／失敗 ${failed.length} 張｜已加入準備上架`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: normalizeEmail(request.auth && request.auth.token && request.auth.token.email) || '管理者',
        version: '2026.08.11-product-image-localization-v1'
      });
      return {
        ok: true, status: failed.length ? 'partial' : 'completed', productId, model,
        requestedCount: imageUrls.length, completedCount: completed.length, failedCount: failed.length,
        imageUrls: completed.map((row) => row.url), listingImageUrls: listingImageUrls.slice(0, 10), failures: failed
      };
    } catch (error) {
      const message = clean(error && error.message) || 'OpenAI 圖片繁體化失敗。';
      console.error('generateProductListingImage failed:', error);
      await caseRef.set({
        lastImageGeneration: {
          status: 'failed', model, error: message.slice(0, 500),
          failedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'OpenAI 圖片繁體化'
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
  buildProductImageSourceDiscoveryRequest,
  buildOpenAIImageRequest,
  buildLocalizedImagePrompt,
  extractImageCandidatesFromHtml,
  isBlockedCommercePage,
  isPrivateIpAddress,
  responseGeneratedImageBase64,
  responseOutputText,
  collectResponseSourceUrls,
  parseResearchResponse,
  sanitizeSafeProductHtml,
  buildResearchUpdate,
  isAllowedManager,
  DEFAULT_MODEL,
  DEFAULT_IMAGE_WORKFLOW_MODEL,
  DEFAULT_IMAGE_EDIT_MODEL
};
