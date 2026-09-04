'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const shopeeTaxonomy = require('./shopeeMusicTaxonomy');
const listingBrandCreative = require('./listingBrandCreative');

const EASYSTORE_ACCESS_TOKEN = defineSecret('EASYSTORE_ACCESS_TOKEN');
const REGION = 'us-central1';
const EASY_STORE_URL = 'https://www.mingtinghuang.com';
const EASY_STORE_API_BASE = '/api/3.0';
const PRODUCT_COLLECTION = 'opsInternalProducts';
const LISTING_CASE_COLLECTION = 'opsProductListingCases';
const JOB_COLLECTION = 'opsSyncJobs';
const PLATFORM_QUEUE_COLLECTION = 'opsProductListingQueue';
const LISTING_WORKFLOW_ID = 'youzi-four-channel-listing-v3';
const LISTING_JOB_SCHEMA_VERSION = 5;
const LISTING_AUTOMATION_POLICY_VERSION = 39;
const RICH_CONTENT_STANDARD_VERSION = 'youzi-rich-product-content-v2';
const RICH_CONTENT_FEATURE_TARGET = 10;
const RICH_CONTENT_USAGE_TARGET = 8;
const RICH_CONTENT_MINIMUM_FEATURES = 3;
const RICH_CONTENT_MINIMUM_USAGE_POINTS = 3;
const RICH_CONTENT_MINIMUM_POINT_CHARACTERS = 16;
const DESCRIPTION_LAYOUT_VERSION = 'youzi-interleaved-description-v3';
const DESCRIPTION_MEDIA_REFRESH_PURPOSE = 'refresh-description-media';
const PLATFORM_EXECUTION_ORDER = Object.freeze(['momo', 'coupang', 'easyStore', 'shopee']);
const EASYSTORE_COLLECTION_CATALOG = Object.freeze([
  '彈撥樂器', '民謠吉他&週邊商品', '電吉他&效果器&週邊', '古典吉他&週邊商品', '貝士&週邊',
  '烏克麗麗&週邊', '電鋼琴&MIDI鍵盤&鋼琴譜', '卡林巴&拇指琴', '琵琶/柳琴&週邊',
  '大中小阮/月琴&週邊', '古箏&週邊', '精選商品', '打擊樂器', '爵士鼓&電子鼓&週邊',
  '木箱鼓&非洲鼓', '空靈鼓&手碟', '鼓棒&中國鼓鼓棒&揚琴棒', '兒童啟蒙樂具&鈴鼓&響板其他',
  '拉弦樂器', '二胡&高胡&京胡', '提琴類&週邊商品', '吹奏樂器', '薩克斯風&週邊商品',
  '長笛&週邊商品', '豎笛&週邊商品', '電音管&週邊商品', '中國笛&蕭&週邊商品',
  '直笛&口風琴&口琴&其他', '嗩吶&其他國樂吹奏', '錄音&電子', '錄音設備&麥克風& 耳機週邊',
  '電子效果器&週邊', '音箱&週邊', '鍵盤&MIDI&週邊', '調音器&節拍器'
]);
const EASYSTORE_COLLECTION_RULES = Object.freeze([
  { keywords: ['中胡', '二胡', '高胡', '京胡', '胡琴弦', '胡琴'], collections: ['拉弦樂器', '二胡&高胡&京胡'] },
  { keywords: ['小提琴', '中提琴', '大提琴', '低音提琴', '提琴'], collections: ['拉弦樂器', '提琴類&週邊商品'] },
  { keywords: ['電吉他'], collections: ['彈撥樂器', '電吉他&效果器&週邊'] },
  { keywords: ['古典吉他'], collections: ['彈撥樂器', '古典吉他&週邊商品'] },
  { keywords: ['木吉他', '民謠吉他', 'acoustic guitar'], collections: ['彈撥樂器', '民謠吉他&週邊商品'] },
  { keywords: ['bass', '貝士', '貝斯'], collections: ['彈撥樂器', '貝士&週邊'] },
  { keywords: ['烏克麗麗', 'ukulele'], collections: ['彈撥樂器', '烏克麗麗&週邊'] },
  { keywords: ['卡林巴', '拇指琴'], collections: ['彈撥樂器', '卡林巴&拇指琴'] },
  { keywords: ['琵琶', '柳琴'], collections: ['彈撥樂器', '琵琶/柳琴&週邊'] },
  { keywords: ['阮', '月琴'], collections: ['彈撥樂器', '大中小阮/月琴&週邊'] },
  { keywords: ['古箏'], collections: ['彈撥樂器', '古箏&週邊'] },
  { keywords: ['鼓棒', '揚琴棒'], collections: ['打擊樂器', '鼓棒&中國鼓鼓棒&揚琴棒'] },
  { keywords: ['爵士鼓', '電子鼓', '鼓椅', '鼓凳'], collections: ['打擊樂器', '爵士鼓&電子鼓&週邊'] },
  { keywords: ['木箱鼓', '非洲鼓'], collections: ['打擊樂器', '木箱鼓&非洲鼓'] },
  { keywords: ['空靈鼓', '手碟'], collections: ['打擊樂器', '空靈鼓&手碟'] },
  { keywords: ['鈴鼓', '響板', '兒童啟蒙樂具'], collections: ['打擊樂器', '兒童啟蒙樂具&鈴鼓&響板其他'] },
  { keywords: ['薩克斯風', '薩克斯'], collections: ['吹奏樂器', '薩克斯風&週邊商品'] },
  { keywords: ['長笛'], collections: ['吹奏樂器', '長笛&週邊商品'] },
  { keywords: ['豎笛', '單簧管'], collections: ['吹奏樂器', '豎笛&週邊商品'] },
  { keywords: ['電音管'], collections: ['吹奏樂器', '電音管&週邊商品'] },
  { keywords: ['中國笛', '笛袋', '竹笛', '洞簫', '洞箫', '蕭'], collections: ['吹奏樂器', '中國笛&蕭&週邊商品'] },
  { keywords: ['直笛', '口風琴', '口琴'], collections: ['吹奏樂器', '直笛&口風琴&口琴&其他'] },
  { keywords: ['嗩吶'], collections: ['吹奏樂器', '嗩吶&其他國樂吹奏'] },
  { keywords: ['麥克風', '耳機', '錄音', 'di box', 'di-box'], collections: ['錄音&電子', '錄音設備&麥克風& 耳機週邊'] },
  { keywords: ['效果器'], collections: ['錄音&電子', '電子效果器&週邊'] },
  { keywords: ['音箱', '擴大機'], collections: ['錄音&電子', '音箱&週邊'] },
  { keywords: ['電子琴', '電鋼琴', 'midi', '鍵盤'], collections: ['錄音&電子', '鍵盤&MIDI&週邊'] },
  { keywords: ['調音器', '節拍器'], collections: ['錄音&電子', '調音器&節拍器'] }
]);
const PARALLEL_ROOT_PLATFORMS = Object.freeze(['momo', 'coupang', 'easyStore']);
const LISTING_TARGET_SCOPES = Object.freeze({
  all: Object.freeze(['momo', 'coupang', 'easyStore', 'shopee']),
  momo: Object.freeze(['momo']),
  coupang: Object.freeze(['coupang']),
  website: Object.freeze(['easyStore', 'shopee'])
});
const REQUEST_TIMEOUT_MS = 60 * 1000;
const PUBLISH_LOCK_MS = 15 * 60 * 1000;
const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);
const SHOPEE_AUTOFILL_SCHEMA_VERSION = 7;
const PLATFORM_QUEUE_PENDING_STATUSES = new Set(['awaiting-store-agent', 'processing']);
const PLATFORM_QUEUE_COMPLETED_STATUSES = new Set(['completed', 'created', 'updated', 'published', 'success']);
const PLATFORM_QUEUE_RECEIPT_STATUSES = new Set([...PLATFORM_QUEUE_COMPLETED_STATUSES, 'submitted-to-platform-review', 'under-review']);
const LISTING_IMAGE_ROLES = new Set(['cleanMain', 'brandedHero', 'storefrontPortrait', 'localizedDetail', 'specification', 'variantRepresentative']);
const LISTING_INTENTS = new Set(['create-single', 'create-group', 'merge-existing', 'add-variant', 'update-existing']);
const SHOP_ASSET_BASE_URL = clean(process.env.YOUZI_HOSTING_URL || 'https://danny700808.github.io/play-card').replace(/\/$/, '');
const DESCRIPTION_PROMO_ASSET_BASE_URL = clean(process.env.YOUZI_DESCRIPTION_ASSET_URL || 'https://youzi-c1b74.web.app').replace(/\/$/, '');
const STORE_PROMO_IMAGE_URL = `${SHOP_ASSET_BASE_URL}/product-listing-store-promo.png`;
const DESCRIPTION_PROMO_IMAGE_URLS = [
  `${DESCRIPTION_PROMO_ASSET_BASE_URL}/product-listing-description-promo-1.jpg`,
  `${DESCRIPTION_PROMO_ASSET_BASE_URL}/product-listing-description-promo-2.jpg`
];
const SHOPEE_IMPORTED_DESCRIPTION_IMAGE_STANDARD = Object.freeze({
  preparedBeforeEasyStorePublish: true,
  sourceFilesMustExistLocallyBeforeSellerCenterUpload: true,
  uploadEntry: '商品描述/新增圖片/從電腦裝置上傳',
  minimumSourceShortEdgePx: 700,
  preferredSquareSizePx: 1000,
  storefrontPortraitWidthPx: 1000,
  storefrontPortraitHeightPx: 750,
  maximumImageCount: 12,
  responsiveHtmlStyle: 'max-width:100%;height:auto',
  verifyPlatformAcceptanceAfterPreparePublish: true,
  doNotResizeAgainInsideShopee: true
});
const BRAND_TEMPLATE_CONTRACT = Object.freeze({
  version: 'youzi-commercial-poster-brand-template-v4',
  sourceAsset: Object.freeze({
    url: `${SHOP_ASSET_BASE_URL}/product-listing-main-template.jpg`,
    sha256: 'e62ded7e4cd4d740d60f8aace2aaa62577973244ee3a0f7545b4c513ec608d12'
  }),
  slogan: '有音樂的生活更有風格',
  logoIdentity: 'youzi-round-green-logo',
  immutableRegions: Object.freeze(['green-header-background', 'slogan', 'round-logo-artwork', 'header-height-ratio', 'logo-overlap-geometry', 'outer-green-border']),
  forbiddenLegacyElements: Object.freeze(['bottom-left-mascot', 'pic-collage-mark']),
  storefrontPortrait: Object.freeze({
    url: `${SHOP_ASSET_BASE_URL}/product-listing-brand-template-portrait.png`,
    sha256: 'dff948f29b8374897a08f1ee78c15fcdf3db4c0caf6eff60e0d40eeb8fbda9ce',
    widthPx: 1000, heightPx: 750, aspectRatio: '4:3', headerHeightPx: 83
  }),
  brandedHero: Object.freeze({
    url: `${SHOP_ASSET_BASE_URL}/product-listing-brand-template-square.png`,
    sha256: '5f0e7743102c00b97befef0c240ec67d76686c1ed0e69dd8aa741cad4a73a1fe',
    widthPx: 1000, heightPx: 1000, aspectRatio: '1:1', headerHeightPx: 111
  }),
  header: Object.freeze({ heightRatio: 1 / 9, background: 'approved-youzi-green', sloganAndLogoArtworkMustRemainUnchanged: true }),
  logo: Object.freeze({
    anchor: 'upper-right', diameterRatioOfCanvasHeight: 0.28,
    overlapHeaderAndContent: true, selectedReference: 'approved-large-overlap-version',
    onlyElementAllowedToCrossHeaderBoundary: true, mayNotCoverProductOrPrimaryCopy: true,
    layer: 'topmost', mustCoverBorderAtOverlap: true
  }),
  contentPanel: Object.freeze({
    background: '#fffaf0', narrowGreenBorderRequired: true,
    borderStyle: 'continuous-thin-rounded-green-outline', borderWidthPx: Object.freeze({ minimum: 3, maximum: 6 }),
    borderLayer: 'below-logo', borderMayNotCrossLogoArtwork: true,
    allCreativeLayersMustStayInsideBorder: true, minimumLightAreaRatio: 0.65,
    maximumDarkAreaRatio: 0.35, darkFullBleedForbidden: true
  }),
  creativeStyleSystem: Object.freeze({
    ...listingBrandCreative.STYLE_SELECTION_POLICY,
    renderProofVersion: listingBrandCreative.RENDER_PROOF_VERSION,
    renderedStyleMustMatchAssignment: true,
    commercialPosterVisualQaRequired: true,
    oldInformationCardDesignsAccepted: false,
    styles: listingBrandCreative.STYLE_CATALOG
  }),
  approvedVisualReference: Object.freeze({
    id: 'approved-commercial-poster-pair-2026-09-02',
    minimumQuality: 'complete-commercial-poster',
    archetypes: Object.freeze(['bright-industrial-integrated-poster', 'bright-lifestyle-editorial-poster']),
    doNotCopyLayoutLiterally: true
  }),
  composition: 'locked-one-ninth-brand-header-full-commercial-poster-v4'
});
const LEGACY_PHYSICAL_PRODUCT_DISCLAIMER = '商品圖片與規格僅供參考，實際內容以收到的實體商品為準。';
const PHYSICAL_PRODUCT_DISCLAIMER = '商品圖片與文字說明僅供參考；不同批次的包裝、印刷、配色或細節可能略有差異，實際內容以收到的商品為準。';
const WARRANTY_SUPPORT_NOTICE = '保固會依商品類型而有所不同。耗材及正常使用產生的自然耗損不在一般保固範圍；若商品附有原廠保固，則以原廠提供的保固時間與方式為主。收到商品若發現新品本身有異常，歡迎聯絡我們協助確認與處理。';
const FIXED_DESCRIPTION_NOTICES = Object.freeze([PHYSICAL_PRODUCT_DISCLAIMER, WARRANTY_SUPPORT_NOTICE]);
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

function normalizeListingTargetScope(value) {
  const scope = clean(value);
  return Object.prototype.hasOwnProperty.call(LISTING_TARGET_SCOPES, scope) ? scope : 'all';
}

function listingTargetPlatforms(value) {
  const source = value && typeof value === 'object' ? value : { listingTargetScope: value };
  return [...LISTING_TARGET_SCOPES[normalizeListingTargetScope(source.listingTargetScope)]];
}

function listingTargetLabel(value) {
  const scope = normalizeListingTargetScope(value && typeof value === 'object' ? value.listingTargetScope : value);
  return { all: '全部平台', momo: 'MOMO', coupang: '酷澎', website: '官網' }[scope];
}

function listingStageSelected(snapshot, stage) {
  return listingTargetPlatforms(snapshot).includes(stage);
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

function resolveEasyStoreCollectionNames(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const explicitSource = source.easyStoreCollectionNames || source.easyStoreCategories || source.easyStoreCollections;
  const explicit = (Array.isArray(explicitSource) ? explicitSource : clean(explicitSource).split(/[|,，\n]+/))
    .map(clean).filter((name) => EASYSTORE_COLLECTION_CATALOG.includes(name));
  if (explicit.length) return Array.from(new Set(explicit));
  const haystack = [
    source.category, source.title, source.productName, source.commonProductName,
    source.model, source.description, source.shopeeCategoryPath
  ].map(clean).filter(Boolean).join(' ').normalize('NFKC').toLowerCase();
  const matched = EASYSTORE_COLLECTION_RULES.find((rule) => (
    rule.keywords.some((keyword) => haystack.includes(clean(keyword).normalize('NFKC').toLowerCase()))
  ));
  return matched ? [...matched.collections] : [];
}

function normalizeListingIntent(listingCase, product = null) {
  const source = listingCase && typeof listingCase === 'object' ? listingCase : {};
  const explicit = clean(source.listingIntent);
  if (LISTING_INTENTS.has(explicit)) return explicit;
  if (clean(source.listingMode) === 'add-variant') return 'add-variant';
  if (clean(source.listingMode) === 'merge-existing') return 'merge-existing';
  if (source.variantGroupEnabled === true) return 'create-group';
  const central = product && typeof product === 'object' ? product : {};
  const hasExistingTarget = ['easyStore', 'shopee', 'momo', 'coupang']
    .some((platform) => platformListingIds(central, platform).length > 0);
  return hasExistingTarget ? 'update-existing' : 'create-single';
}

function listingIntentPolicy(intent) {
  const normalized = LISTING_INTENTS.has(clean(intent)) ? clean(intent) : 'create-single';
  const policies = {
    'create-single': { label: '新增獨立商品', contentAction: 'create-complete-content', identityAction: 'create-one-new-product' },
    'create-group': { label: '新增多細項商品', contentAction: 'create-shared-content-with-variant-differences', identityAction: 'create-one-parent-with-closed-variant-set' },
    'merge-existing': { label: '合併／加入既有商品', contentAction: 'merge-variant-group-into-existing-content', identityAction: 'reuse-existing-primary-and-attach-selected-variants' },
    'add-variant': { label: '加入既有商品細項', contentAction: 'merge-new-variant-into-existing-content', identityAction: 'append-one-variant-to-exact-parent' },
    'update-existing': { label: '修改既有商品', contentAction: 'replace-outdated-content-in-place', identityAction: 'update-exact-sku-and-platform-id' }
  };
  return {
    intent: normalized,
    ...policies[normalized],
    preserveUnmentionedContent: ['merge-existing', 'add-variant', 'update-existing'].includes(normalized),
    neverCreateDuplicate: true
  };
}

function listingPhysicalImageUrls(listingCase, finalizedMediaSnapshot = null) {
  const collected = [];
  const cases = Array.isArray(finalizedMediaSnapshot && finalizedMediaSnapshot.cases)
    ? finalizedMediaSnapshot.cases : [];
  cases.forEach((item) => {
    const prepared = item && item.preparedCase && typeof item.preparedCase === 'object' ? item.preparedCase : {};
    normalizeUrls(prepared.physicalImageUrls, 20).forEach((url) => {
      if (!collected.includes(url)) collected.push(url);
    });
  });
  if (!collected.length) {
    normalizeUrls(listingCase && listingCase.physicalImageUrls, 20).forEach((url) => {
      if (!collected.includes(url)) collected.push(url);
    });
  }
  return collected.slice(0, 20);
}

function listingCasePhysicalImageUrls(listingCase, finalizedMediaSnapshot, productId) {
  const match = (Array.isArray(finalizedMediaSnapshot && finalizedMediaSnapshot.cases)
    ? finalizedMediaSnapshot.cases : [])
    .find((item) => clean(item && item.productId) === clean(productId));
  const prepared = match && match.preparedCase && typeof match.preparedCase === 'object'
    ? match.preparedCase : {};
  const frozen = normalizeUrls(prepared.physicalImageUrls, 20);
  return frozen.length ? frozen : normalizeUrls(listingCase && listingCase.physicalImageUrls, 20);
}

function listingCaseDetailImageUrls(listingCase, finalizedMediaSnapshot, productId) {
  const match = (Array.isArray(finalizedMediaSnapshot && finalizedMediaSnapshot.cases)
    ? finalizedMediaSnapshot.cases : [])
    .find((item) => clean(item && item.productId) === clean(productId));
  const prepared = match && match.preparedCase && typeof match.preparedCase === 'object'
    ? match.preparedCase : {};
  const assignments = Array.isArray(prepared.imageRoleAssignments) ? prepared.imageRoleAssignments : [];
  const completed = assignments.filter((row) => listingImageRoles(row)
    .some((role) => ['cleanMain', 'localizedDetail', 'specification', 'variantRepresentative'].includes(role)))
    .map((row) => safeHttpUrl(row && row.url));
  const fallback = normalizeUrls(listingCase && listingCase.listingImageUrls, 12);
  return normalizeUrls(completed.length ? completed : fallback, 12)
    .filter((url) => url !== STORE_PROMO_IMAGE_URL && !DESCRIPTION_PROMO_IMAGE_URLS.includes(url));
}

function shopeeDescriptionTextBlocks(value) {
  const text = stripFixedDescriptionNoticesText(clean(value)).replace(/\r\n?/g, '\n').trim();
  const headingIndex = (pattern) => {
    const match = pattern.exec(text);
    return match ? match.index + (match[1] ? match[1].length : 0) : -1;
  };
  const specificationIndex = headingIndex(/(^|\n)商品規格(?=\s*(?:\n|$))/m);
  const usageIndex = headingIndex(/(^|\n)(?:使用方式(?:／|\/)適用情境|使用方式|使用建議|適用情境)(?=\s*(?:\n|$))/m);
  const firstStructuredIndex = [specificationIndex, usageIndex]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const features = Number.isInteger(firstStructuredIndex) ? text.slice(0, firstStructuredIndex).trim() : '';
  const specifications = specificationIndex >= 0
    ? text.slice(specificationIndex, usageIndex > specificationIndex ? usageIndex : text.length).trim() : '';
  const usage = usageIndex >= 0
    ? text.slice(usageIndex, specificationIndex > usageIndex ? specificationIndex : text.length).trim() : '';
  return [
    { key: 'features', text: features },
    { key: 'specifications', text: specifications },
    { key: 'usage', text: usage },
    { key: 'actual-product-notice', text: PHYSICAL_PRODUCT_DISCLAIMER },
    { key: 'warranty-support-notice', text: WARRANTY_SUPPORT_NOTICE }
  ];
}

function momoProductName(value, brand) {
  const original = clean(value).replace(/\s+/g, ' ');
  const exactBrand = clean(brand).replace(/\s+/g, ' ');
  if (!original) return '';
  if (!exactBrand) return original.slice(0, 60);
  const escapedBrand = exactBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutRepeatedBrand = original
    .replace(new RegExp(`^${escapedBrand}(?:\\s+|[-–—_／/｜|：:]+\\s*)`, 'i'), '')
    .trim();
  return (withoutRepeatedBrand || original).slice(0, 60);
}

function momoShortFeaturePlan(description, explicitSlogan) {
  const text = stripFixedDescriptionNoticesText(clean(description)).replace(/\r\n?/g, '\n');
  const featureSection = (text.match(/(?:^|\n)商品特色\s*\n([\s\S]*?)(?=\n(?:商品規格|使用方式(?:／|\/)?適用情境|使用方式|使用建議|適用情境)\s*(?:\n|$)|$)/) || [])[1] || '';
  const verifiedLines = featureSection.split('\n').map((line) => line
    .replace(/^\s*(?:[-•●▪◦]|\d+[.)、．]|[（(]?\d+[）)])\s*/, '')
    .replace(/[。；;，,：:]\s*$/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const snippets = verifiedLines.map((line) => {
    const clauses = line.split(/[，,；;。]/).map(clean).filter(Boolean);
    const conciseClause = clauses.find((clause) => {
      const length = Array.from(clause).length;
      return length >= 4 && length <= 15;
    });
    return Array.from(conciseClause || line).slice(0, 15).join('');
  });
  const unique = Array.from(new Set(snippets)).slice(0, 3);
  const explicit = Array.from(clean(explicitSlogan).replace(/\s+/g, ' ')).slice(0, 15).join('');
  return {
    slogan: explicit || unique[0] || '',
    featureTexts: unique,
    maximumCharactersPerField: 15,
    source: explicit ? 'explicit-slogan-and-verified-description-features' : 'verified-description-features',
    neverInventToFillEmptySlot: true
  };
}

function normalizeMomoAttributes(value) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  return rows.map((row) => {
    const label = clean(row && (row.label || row.name)).slice(0, 120);
    const fieldValue = clean(row && row.value).slice(0, 300);
    const confidence = ['high', 'medium', 'low'].includes(clean(row && row.confidence))
      ? clean(row.confidence) : 'low';
    if (!label || !fieldValue) return null;
    const key = label.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    return { label, value: fieldValue, confidence, note: clean(row && row.note).slice(0, 500) };
  }).filter(Boolean).slice(0, 40);
}

function momoMarketPrice(snapshot) {
  const explicit = numberOrNull(snapshot && snapshot.momoMarketPrice);
  const sale = numberOrNull(snapshot && snapshot.momoPrice);
  if (explicit !== null && (sale === null || explicit > sale)) return Math.ceil(explicit);
  return sale !== null && sale > 0 ? Math.ceil(sale * 1.35) : null;
}

function shopeeAdvancedDescriptionPlan(snapshot) {
  const preparedProductImageUrls = normalizeUrls(Array.isArray(snapshot && snapshot.descriptionImageUrls)
    ? snapshot.descriptionImageUrls : [], 10)
    .filter((url) => !DESCRIPTION_PROMO_IMAGE_URLS.includes(url));
  const requiredFirstImageUrl = safeHttpUrl(snapshot && snapshot.descriptionHeroImageUrl)
    || preparedProductImageUrls[0] || '';
  const imageUrls = normalizeUrls([
    requiredFirstImageUrl,
    ...preparedProductImageUrls.filter((url) => url !== requiredFirstImageUrl),
    ...DESCRIPTION_PROMO_IMAGE_URLS
  ], 12);
  const textBlocks = shopeeDescriptionTextBlocks(snapshot && snapshot.shopeeDescription);
  const productImageUrls = imageUrls.slice(0, Math.max(0, imageUrls.length - 2));
  const fixedPromoUrls = imageUrls.slice(-2);
  const blockPlan = [
    { type: 'text', key: 'features' },
    ...(productImageUrls[0] ? [{ type: 'image', key: 'product-image-1', imageUrl: productImageUrls[0] }] : []),
    { type: 'text', key: 'specifications' },
    ...(productImageUrls[1] ? [{ type: 'image', key: 'product-image-2', imageUrl: productImageUrls[1] }] : []),
    { type: 'text', key: 'usage' },
    ...(productImageUrls[2] ? [{ type: 'image', key: 'product-image-3', imageUrl: productImageUrls[2] }] : []),
    ...productImageUrls.slice(3).map((imageUrl, index) => ({
      type: 'image', key: `remaining-product-image-${index + 1}`, imageUrl
    })),
    { type: 'text', key: 'actual-product-notice' },
    { type: 'text', key: 'warranty-support-notice' },
    { type: 'image', key: 'description-promo-1', imageUrl: fixedPromoUrls[0] || '' },
    { type: 'image', key: 'description-promo-2', imageUrl: fixedPromoUrls[1] || '' }
  ];
  const contentFingerprint = crypto.createHash('sha256').update(JSON.stringify({
    textBlocks,
    blockPlan,
    imageUrls
  })).digest('hex');
  return {
    mode: 'seller-center-native-file-upload-interleaved',
    source: 'prepared-text-blocks-and-downloaded-local-image-files',
    preparedBeforeNavigation: true,
    skipEasyStoreDescriptionImport: true,
    transferImagesThroughShopeeNativeUploader: true,
    memoryOnlyImageStaging: false,
    desktopDownloadRequired: true,
    dedicatedLocalStagingDirectoryRequired: true,
    uploadEntry: '商品描述/新增圖片/從電腦裝置上傳',
    deleteLocalStagingOnlyAfterReloadVerification: true,
    neverDeleteUntrackedUserFiles: true,
    directExternalImageUrlPasteForbidden: true,
    waitForEveryNativeImageUploadBeforeUpdate: true,
    verifyNativeImageCountAndInterleavedOrderBeforeUpdate: true,
    rejectZeroImageDescriptionBeforePublish: true,
    capabilityProbe: 'seller-center-rich-editor-and-file-input',
    imagePreflight: { ...SHOPEE_IMPORTED_DESCRIPTION_IMAGE_STANDARD },
    contentFingerprint,
    requiredFirstImageUrl,
    fixedLastTwoImageUrls: [...DESCRIPTION_PROMO_IMAGE_URLS],
    imageUrls,
    expectedImageCount: imageUrls.length,
    textBlocks,
    blockPlan
  };
}

function platformDescriptionContentPlan(snapshot) {
  const preparedImageUrls = normalizeUrls(Array.isArray(snapshot && snapshot.descriptionImageUrls)
    ? snapshot.descriptionImageUrls : [], 20);
  const fixedLayout = {
    version: DESCRIPTION_LAYOUT_VERSION,
    order: ['introduction-and-features', 'product-image-1', 'specifications', 'product-image-2', 'usage-advice', 'product-image-3', 'remaining-product-images', 'actual-product-notice', 'warranty-support-notice', 'description-promo-1', 'description-promo-2'],
    storePromoGalleryImageUrl: STORE_PROMO_IMAGE_URL,
    storePromoMustBeLastGalleryImage: true,
    descriptionPromoImageUrls: [...DESCRIPTION_PROMO_IMAGE_URLS],
    descriptionPromosMustBeLastImages: true,
    missingPreparedImageBlocksCompletion: true
  };
  return {
    canonicalSource: 'single-verified-product-description',
    contentStandardVersion: RICH_CONTENT_STANDARD_VERSION,
    layout: fixedLayout,
    preparedBeforePlatformNavigation: true,
    neverRewriteInsidePlatform: true,
    easyStore: {
      mode: 'safe-html',
      html: clean(snapshot && snapshot.bodyHtml),
      imageUrls: preparedImageUrls,
      supportsHeadingsParagraphsListsAndImages: true,
      verifySavedTextAndEveryPreparedImage: true
    },
    coupang: {
      mode: 'safe-html-product-detail',
      html: clean(snapshot && snapshot.coupangDescriptionHtml),
      imageUrls: preparedImageUrls,
      supportsHeadingsParagraphsListsAndImages: true,
      preserveFixedStoreServicePromosAtEnd: true,
      verifyAfterSaveAndReopen: true
    },
    momo: {
      mode: 'momo-rich-description-blocks',
      preparedHtmlForBlockConversion: clean(snapshot && snapshot.momoHtml),
      imageUrls: preparedImageUrls,
      textBlocks: Array.isArray(snapshot && snapshot.shopeeAdvancedDescription && snapshot.shopeeAdvancedDescription.textBlocks)
        ? snapshot.shopeeAdvancedDescription.textBlocks.map((row) => ({ ...row })) : [],
      blockPlan: Array.isArray(snapshot && snapshot.shopeeAdvancedDescription && snapshot.shopeeAdvancedDescription.blockPlan)
        ? snapshot.shopeeAdvancedDescription.blockPlan.map((row) => ({ ...row })) : [],
      arbitraryRawHtmlPasteIsNotAssumed: true,
      composeWithNativeTextAndImageBlocks: true,
      preserveInterleavedTextAndImageOrder: true,
      warrantyNoticeImmediatelyBeforeFixedLastTwoImages: true,
      verifySavedTextImagesAndOrderAfterDraftReopen: true,
      imageMaximum: 20,
      imageWidthPx: 1000,
      imageHeightMaximumPx: 1500,
      imageFileMaximumBytes: 500000,
      externalEmbedPolicy: 'https-and-iframe-supported-only'
    },
    shopee: {
      ...(snapshot && snapshot.shopeeAdvancedDescription || {}),
      importFromEasyStore: false,
      rawHtmlPasteForbidden: true
    }
  };
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

function listingAutomationPolicy() {
  return {
    version: LISTING_AUTOMATION_POLICY_VERSION,
    workflowId: LISTING_WORKFLOW_ID,
    immutableWorkflowUntilExplicitRuleChange: true,
    productDataChangesDoNotChangeExecutionOrder: true,
    listingIntent: {
      allowed: Array.from(LISTING_INTENTS),
      selectedIntentIsAuthoritative: true,
      createRequiresNoExistingTargetId: true,
      updateRequiresExactExistingTargetId: true,
      mergeExistingReusesMappedPrimaryAndCreatesOnlyWhereMissing: true,
      addVariantPreservesExistingContentAndMergesNewSection: true,
      updateExistingReplacesOnlyRequestedOutdatedContent: true,
      neverInferCreateOrUpdateFromPlatformIdAfterHandoff: true
    },
    duplicateGuard: {
      matchKey: 'exact-sku+existing-platform-id',
      variantGroupIdentityIsClosedSkuSet: true,
      forbidBaseSkuAndNameFallbackForVariantGroups: true,
      neverReuseUnlistedSimilarProduct: true,
      reuseExistingDraft: true,
      neverCreateNewOnRetry: true,
      stopOnMultipleMatches: true,
      skipPreSubmitCatalogSearchWhenNoPlatformId: true,
      treatHandoffSkuAsNewWhenNoPlatformId: true,
      exactLookupOnlyForUncertainSubmitRecovery: true
    },
    retry: {
      retryTransientFailureUntilVerified: true,
      backoffSeconds: [3, 10, 30],
      maximumAttempts: 4,
      waitForAsyncImageProcessing: true,
      keepFailedStepForResume: true,
      retrySameSkuAndDraftOnly: true,
      refreshLocalizedImageUrlBeforeRetry: true,
      transientFailureSignatures: [
        'http-408', 'http-425', 'http-429', 'http-500', 'http-502', 'http-503', 'http-504',
        'network-timeout', 'temporary-platform-error', 'image-fetch-failed', 'image-load-timeout', 'image-processing-pending',
        'platform-session-expired', 'redirected-to-login', 'authenticated-tab-control-lost'
      ]
    },
    publishVerification: {
      mode: 'required-field-check-and-same-listing-repair',
      successDialogRequiresListingIdentity: true,
      easyStoreDraftCreationIsNotPublication: true,
      requireEveryVariantGroupSkuOnPublishedStorefront: true,
      requiredChecks: [
        'listing-id', 'exact-sku', 'price', 'stock', 'status', 'one-official-list-match',
        'complete-variant-sku-set', 'variant-name', 'variant-price', 'variant-stock', 'variant-image'
      ],
      intentionallySkippedAfterSubmit: [
        'duplicate-platform-list-and-official-catalog-check', 'reopen-saved-draft'
      ],
      imageReceiptContract: {
        verifiedOnceBeforePlatformNavigation: true,
        postSubmitImageUrlCollectionRequired: false,
        platformErrorTriggersTargetedImageCheck: true,
        groupedAndAddVariantRequireEveryVariantImage: true
      },
      repairLoop: {
        missingOrMismatchedRequiredFieldIsNotCompleted: true,
        action: 'resume-same-listing-or-draft-and-reapply-only-missing-fields',
        resubmitSameListingAfterRepair: true,
        verifyExactSkuAgainAfterRepair: true,
        neverCreateReplacementListing: true,
        preserveAlreadyVerifiedFields: true
      }
    },
    platformExecutionPlan: {
      preflightAllListingDataBeforePlatformNavigation: true,
      requireStructuredVerifiedDescriptionBeforePreparedSnapshot: true,
      genericFallbackDescriptionIsIncomplete: true,
      writeVerifiedDescriptionBackToEveryGroupedCase: true,
      prepareShopeeAdvancedDescriptionBeforeNavigation: true,
      shopeeAdvancedDescriptionSource: 'prepared-text-blocks-and-downloaded-local-image-files',
      shopeeAdvancedDescriptionImagesAreImmutableForJob: true,
      shopeeAdvancedDescriptionCapabilityProbeMaximum: 1,
      skipEasyStoreAdvancedDescriptionImport: true,
      shopeeSellerCenterAppliesPreparedContentButMustNotReanalyzeIt: true,
      shopeeAdvancedDescriptionMustVerifyTextAndEveryPreparedImageBeforePublish: true,
      shopeeAdvancedDescriptionMissingImagesMustUseNativeFileUpload: true,
      shopeeAdvancedDescriptionMustDownloadPreparedImagesBeforeNativeFileUpload: true,
      shopeeAdvancedDescriptionLocalStorageScope: 'job-specific-temporary-directory',
      shopeeAdvancedDescriptionRemoteUrlOrMemoryBlobAloneIsInsufficient: true,
      shopeeAdvancedDescriptionUserDesktopFolderForbidden: true,
      shopeeAdvancedDescriptionUploadEntry: '商品描述/新增圖片/從電腦裝置上傳',
      shopeeAdvancedDescriptionOfficialZeroOfTwelveIsIncomplete: true,
      shopeeAdvancedDescriptionMustReplaceAllEditorImagesWithPreparedSet: true,
      shopeeAdvancedDescriptionMustRejectDataAndBlobImages: true,
      shopeeAdvancedDescriptionMustPreserveInterleavedPreparedOrder: true,
      shopeeAdvancedDescriptionMustUseNativeImageTransferInsteadOfExternalUrlPaste: true,
      shopeeAdvancedDescriptionMustWaitUntilImageTransferOverlayCloses: true,
      shopeeAdvancedDescriptionMustVerifyFixedLastTwoImagesAfterTransfer: true,
      shopeeAdvancedDescriptionMayNotReportSuccessFromButtonClickAlone: true,
      fixedInterleavedDescriptionLayoutVersion: DESCRIPTION_LAYOUT_VERSION,
      fixedStorePromoMustBeLastGalleryImage: true,
      fixedDescriptionPromosMustBeLastTwoDescriptionImages: true,
      everySelectedIntentUsesFixedDescriptionLayout: true,
      missingDescriptionImageBlocksCompletionOnEveryPlatform: true,
      prepareOneCanonicalDescriptionAndFourPlatformDeliveryProfiles: true,
      easyStoreAndCoupangUseSafeHtmlWithPreparedImages: true,
      momoUsesNativeRichDescriptionBlocksInsteadOfAssumingArbitraryRawHtml: true,
      momoRichDescriptionSupportsPreparedTextAndUpToTwentyImages: true,
      shopeeUsesAdvancedRichDescriptionRatherThanRawHtml: true,
      order: [...PLATFORM_EXECUTION_ORDER],
      mode: 'staggered-parallel',
      parallelRoots: [...PARALLEL_ROOT_PLATFORMS],
      dependencies: { momo: [], coupang: [], easyStore: [], shopee: ['easyStore'] },
      finalSubmissionAuthorizedByHandoff: true,
      routineSecondConfirmationForbidden: true,
      applicationConfirmationUiDisabledAfterHandoff: true,
      authorizationCoversRoutineFinalSubmitOnAllFourPlatforms: true,
      continueAutomaticallyAfterEachVerifiedStage: true,
      prepareCompleteFieldPlanBeforeFirstPlatform: true,
      preparedFieldPlanIsImmutableForWholeJob: true,
      batchFieldExecution: {
        version: 1,
        mode: 'section-batch',
        resolveFieldLocationsOncePerSection: true,
        fillStableNativeControlsInSingleDomPass: true,
        dispatchNativeEventsPerField: true,
        validateStableSectionAfterBatch: false,
        validateDynamicSectionOnceAfterBatch: true,
        dynamicControlsRemainSequentialWithinSection: true,
        uploadImagesAsSingleBatch: true,
        neverRescanUnchangedSection: true
      },
      pageContractReuse: {
        reuseKnownRoutesAndFieldLocations: true,
        applyFixedFieldsWithoutWholePageRescan: true,
        inspectOnlyDynamicCategoryAttributesAndErrors: true,
        rescanCurrentSectionOnlyWhenLayoutSignatureChanges: true,
        persistStableSelectorsAndFieldSemantics: true,
        fallbackToSectionRescanWithoutRestartingJob: true
      },
      fixedDefaults: {
        warrantyDays: 180,
        publishImmediately: true,
        momoThirdPartyLocationCode: MOMO_THIRD_PARTY_DELIVERY.locationCode,
        momoThirdPartyLocationRequired: true,
        momoConvenienceShippingConditionalOnPackage: true
      },
      shopeeDependsOnEasyStore: true,
      easyStoreStartsOnlyAfterMomoAndCoupangVerified: false,
      browserScheduler: {
        interactionConcurrency: 1,
        oneActiveProductPerPlatform: true,
        releaseInteractionLockDuringWait: true,
        serializedOperations: ['navigate', 'click', 'type', 'file-picker', 'image-selection', 'final-submit'],
        overlapAllowedWhileWaiting: ['navigation-response', 'image-upload', 'platform-processing', 'official-review'],
        sessionHeartbeatSeconds: 180,
        keepAuthenticatedAnchorTabPerPlatform: true,
        resumeSameDraftAfterSessionRecovery: true
      },
      prepareBeforeOpen: ['category', 'brand', 'attributes', 'logistics', 'price', 'stock', 'images', 'variants'],
      shopeeHandoff: {
        canonicalWorkspace: 'easystore-shopee-channel-sync',
        singleWorkspaceOnly: true,
        neverOpenDirectShopeeSellerEditor: false,
        sellerCenterDescriptionStageRequired: true,
        sellerCenterDescriptionUsesSameListingIdentity: true,
        startImmediatelyAfterEasyStoreVerified: true,
        doNotWaitForMomoOrCoupang: true,
        sameProductCrossSurfaceContinuation: true,
        closeEmbeddedChatBeforeFormInteraction: true,
        reusePreparedPayload: true,
        neverRestartResearchOrImageProcessing: true,
        retrySameChannelProductAndPage: true,
        variantImageSource: 'existing-easystore-completed-gallery',
        selectVariantImageByCompletedAssetMapping: true,
        neverOpenNativeFilePickerForVariantImages: true,
        fillRequiredWeightFromPreparedPackageBeforePreparePublish: true,
        completeVariantImagesBeforePreparePublish: true,
        verifyIn: 'shopee-seller-center-same-product-after-reload'
      },
      coupangCreateFlow: {
        route: 'create-via-image',
        useSameDraftOnly: true,
        fieldPlanPreparedBeforeNavigation: true,
        steps: [
          'upload-clean-main', 'upload-secondary-completed-images', 'select-music-leaf-category',
          'select-verified-brand-or-no-brand', 'generate-product-information-once',
          'fill-variants-price-stock-and-seller-sku', 'fill-shipping',
          'fill-description-and-tw-general-compliance', 'create-product', 'verify-exact-sku-once'
        ],
        invalidGeneratedOptionRecovery: {
          signatures: ['readonly-option-field', 'invalid-generated-option-value'],
          action: 'return-to-image-step-and-regenerate-once',
          maximumRegenerations: 1,
          neverCreateReplacementDraft: true,
          onlyBeforeVariantCommerceOrContentIsFilled: true,
          neverRegenerateAfterLaterSectionsCompleted: true,
          lateFailureAction: 'repair-current-section-on-same-draft',
          preserveCompletedSections: true
        },
        pendingReviewIsSuccessfulSubmission: true,
        pendingReviewIsNotActiveListing: true
      },
      coupangExistingListingEditFlow: {
        route: 'exact-sku-existing-listing-edit',
        requireUniqueVendorInventoryId: true,
        stayOnSameListingId: true,
        fillOnlyVerifiedAttributes: true,
        neverGuessAttributes: ['原聲吉他型態', '琴弦材質', '慣用手方向', '產地', '認證'],
        verifiedSixStringMapping: {
          field: '吉他琴橋線(弦)數', unit: '弦', value: 6,
          requiredScopes: ['product-basic-information', 'each-option-attribute-dialog'],
          saveOptionAttributeBeforeSubmit: true,
          recheckProductValueAfterOptionSave: true
        },
        validationRecovery: {
          optionCheckField: '開啟該選項的編輯屬性，補齊同一組已驗證產品屬性後儲存',
          productBasicInformationCheckField: '重新讀取並補齊商品層級的同一已驗證屬性',
          neverInventGtinsOrUnknownAttributes: true,
          remainOnSameVendorInventoryId: true
        },
        gallery: {
          maximumCount: 7,
          maximumProductImagesBeforeStorePromo: 6,
          preserveExistingProductImageOrder: true,
          storePromoMustBeFinalSupplementImage: true
        },
        htmlDescription: {
          existingRowLandmark: '已寫入HTML',
          editAction: '修改',
          previewAction: 'PC 預覽',
          saveAction: '儲存',
          fixedNoticesBeforeFinalPromos: true,
          fixedPromoImagesAtTail: 2,
          noContentAfterSecondFixedImage: true,
          previewAndReopenBeforeSubmit: true
        },
        submitAction: '申請修改',
        reviewMayPauseSales: true,
        pendingReviewIsNotActiveListing: true
      },
      verification: 'single-final-check-after-submit'
    },
    momoPublishRecovery: {
      failureSignatures: [
        'still-draft', 'blank-price', 'sku-mismatch', 'price-mismatch', 'stock-mismatch',
        'variant-sku-set-mismatch', 'variant-price-mismatch', 'variant-stock-mismatch',
        'variant-image-missing', 'missing-from-platform'
      ],
      compareWithSubmittedSnapshot: ['sku', 'momoPrice', 'stock', 'variant-sku-set', 'variant-price', 'variant-stock', 'variant-image', 'status'],
      resumeSameDraft: true,
      neverCreateReplacementDraft: true,
      reapplyWhenCleared: [
        'attributes', 'other-information', 'stock', 'sale-price', 'market-price', 'factory-sku',
        'material-grade', 'weight', 'temperature', 'shipping-methods', 'third-party-location',
        'main-images', 'advertisement-image', 'promotion-material-bank-image', 'variant-images',
        'rich-description', 'feature-copy', 'warranty'
      ],
      permissionDeniedSignatures: ['此帳號無此功能權限', 'account-not-authorized-for-publish'],
      permissionDeniedIsPermanentBlocker: false,
      classifyPermissionDeniedByCurrentAction: true,
      permissionDeniedRecovery: {
        materialBankSameNameSelection: {
          classification: 'asset-route-conflict',
          action: 'upload-directly-with-unique-filename',
          filenameMustContain: ['sku', 'variant-sku-or-value', 'content-fingerprint'],
          neverRetrySameNameMaterialBankSelection: true,
          neverTreatAsAccountWidePermissionFailure: true
        },
        publishedVariantImageSubmit: {
          classification: 'published-listing-edit-route-restricted',
          action: 'resume-same-listing-through-specification-change-route',
          reuseUploadedVariantAssets: true,
          preserveExactGoodsCodeAndSkuSet: true,
          neverReuploadCompletedAssets: true,
          neverReloginForThisSignature: true,
          neverCreateReplacementDraft: true,
          maximumRouteFallbackAttempts: 1
        },
        permanentOnlyAfterFallbackAlsoDenied: true
      },
      neverRetryPermissionDeniedWithReplacementDraft: true,
      verifiedWhenEitherOfficialResultContainsExactSku: true
    },
    momoCapacityRecovery: {
      enabled: true,
      trigger: 'positive-stock-new-listing-and-active-count-at-capacity',
      maximumListings: 1000,
      slotsPerParentListing: 1,
      checkBeforeFirstPublish: true,
      candidateMustBeActive: true,
      candidateMustHaveZeroStock: true,
      excludeCurrentSkuAndListing: true,
      excludeCurrentBatch: true,
      excludeProtectedOrPinnedListings: true,
      excludePendingOrders: true,
      preserveSoldOutListingsWithSales: true,
      preferExplicitLowPriorityThenZeroSalesThenOldestUpdate: true,
      action: 'temporarily-downlist-one-safe-zero-stock-item',
      neverDelete: true,
      verifyCandidateDownlistedAndSlotAvailableBeforePublish: true,
      resumeSamePreparedDraftAfterSlotRecovery: true,
      createReplacementDraftForbidden: true,
      routineConfirmationForbiddenAfterAuthorizedHandoff: true,
      noSafeCandidateAction: 'stop-with-exact-reason'
    },
    momoSpecialPromotionImage: {
      source: 'localized-completed-product-image',
      appliesToListingModes: ['independent', 'variant-group', 'add-variant'],
      onePromotionAssetPerParentListing: true,
      variantGroupMustBePreparedBeforeFirstSubmit: true,
      preferredProductImagePositions: [2, 3],
      excludeStoreAddressAndServicePromos: true,
      neverUseGalleryLastStorePromo: true,
      materialBankInsertRequired: false,
      insertionTarget: 'rich-description-editor',
      deviceUploadFlow: ['prepare-unique-filename', 'focus-exact-text-boundary', 'open-rich-description-upload', 'choose-device-upload', 'set-files', 'wait-cdn-insert', 'save-draft', 'reopen-same-product', 'verify-text-image-order-and-src'],
      sameNameMaterialBankConflictReuseForbidden: true,
      finalTwoImagesInsertAtDocumentEnd: true,
      finalTwoImagesUploadTogetherInFixedOrder: true,
      noContentAfterSecondFixedImage: true,
      directDeviceUploadRequiresSaveReopenProof: true,
      prepareAssetBeforeMomoNavigation: true,
      uniqueFilenameAndFingerprintRequired: true,
      advertisementImagePreparedFromCleanMain: true,
      allThreeMediaSlotsRequiredBeforeFirstSubmit: true,
      saveReopenAndVerifyImageRequired: true,
      visibleInsertionAndSaveConfirmationRequired: true,
      preventDuplicatePromotionInsertion: true,
      missingPromotionErrorIsNeverExpectedControlFlow: true,
      platformErrorTriggersTargetedRecheck: true,
      mainOrAdvertisementImageIsNeverPromotionEvidence: true
    },
    momoStoreCategories: {
      maximumCount: 5,
      relevantOnly: true,
      validateBeforeSave: true,
      neverSubmitWithMoreThanMaximum: true
    },
    browserControl: {
      workspace: 'codex-in-app-browser',
      neverUsePrimaryChrome: true,
      reuseExistingAuthenticatedPlatformTabs: true,
      allowSavedCredentialLoginRetry: true,
      authenticatedTabIsPrimarySessionEvidence: true,
      deepLinkFailureAloneDoesNotMeanLoggedOut: true,
      retryCanonicalEntryBeforeLogin: true,
      submitSavedCredentialsWithoutRoutineConfirmation: true,
      resumeSameJobSkuDraftAndStageAfterLogin: true,
      neverOpenNativeWindowsFilePicker: true,
      nativeFileUploadUsesJobSpecificLocalPathsDirectly: true,
      userDesktopFolderForbiddenForTemporaryUploads: true,
      neverSwitchBrowserWorkspaceMidJob: true,
      stopForInteractiveAuthenticationOnly: true
    },
    browserTabs: {
      closeCompletedAgentTabs: true,
      keepOneAuthenticatedAnchorPerPlatform: true,
      returnAnchorToPlatformHomeOrProductList: true,
      neverCloseUnrelatedUserTabs: true
    },
    recoverableAuthenticationStates: ['login-expired', 'redirected-to-login', 'authenticated-tab-control-lost'],
    permanentBlockers: ['missing-required-data', 'explicit-platform-rejection', 'otp', 'captcha', 'saved-credentials-rejected', 'platform-account-disabled'],
    humanHandoffOnlyFor: ['missing-required-data', 'explicit-platform-rejection', 'otp', 'captcha', 'saved-credentials-rejected', 'platform-account-disabled', 'persistent-platform-error']
  };
}

function evaluateMomoPublishVerification(expected, observed) {
  const target = expected && typeof expected === 'object' ? expected : {};
  const actual = observed && typeof observed === 'object' ? observed : {};
  const expectedSku = normalizeSku(target.sku);
  const actualSku = normalizeSku(actual.sku);
  const expectedPrice = numberOrNull(target.momoPrice);
  const expectedStock = numberOrNull(target.stock);
  const actualPrice = numberOrNull(actual.price);
  const actualStock = numberOrNull(actual.stock);
  const status = clean(actual.status).toLowerCase();
  const reasons = [];

  if (expectedSku && actualSku !== expectedSku) reasons.push('sku-mismatch');
  if (!status) reasons.push('missing-status');
  if (status === 'draft' || status === '暫存') reasons.push('still-draft');
  if (actualPrice === null) reasons.push('blank-price');
  else if (expectedPrice !== null && actualPrice !== expectedPrice) reasons.push('price-mismatch');
  if (expectedStock !== null && actualStock !== expectedStock) reasons.push('stock-mismatch');
  if (actual.platformListMatched !== true && actual.officialCatalogMatched !== true) reasons.push('missing-from-platform');

  return {
    verified: reasons.length === 0,
    needsRetry: reasons.length > 0,
    reasons,
    recoveryAction: reasons.length ? 'resume-same-draft-and-reapply-cleared-fields' : 'none',
    neverCreateReplacementDraft: true
  };
}

function selectMomoCapacityRecoveryCandidate(listings, target, options = {}) {
  const rows = Array.isArray(listings) ? listings : [];
  const expected = target && typeof target === 'object' ? target : {};
  const maximumListings = Math.max(1, Math.round(numberOrNull(options.maximumListings) || 1000));
  const activeStatuses = new Set(['active', 'published', 'on-sale', 'onsale', '上架', '銷售中']);
  const targetStock = Math.max(0, Math.round(numberOrNull(expected.stock) || 0));
  const targetSku = normalizeSku(expected.sku);
  const targetListingIds = new Set([
    expected.listingId, expected.platformListingId, expected.goodsCode, expected.goodsId
  ].map(clean).filter(Boolean));
  const activeRows = rows.filter((row) => activeStatuses.has(clean(row && row.status).toLowerCase()));
  const explicitCount = numberOrNull(options.currentActiveCount);
  const currentActiveCount = explicitCount === null ? activeRows.length : Math.max(0, Math.round(explicitCount));
  const isNewListing = expected.isNewListing !== false && !targetListingIds.size;
  const required = targetStock > 0 && isNewListing && currentActiveCount >= maximumListings;
  if (!required) {
    return {
      required: false,
      currentActiveCount,
      maximumListings,
      candidate: null,
      action: 'none',
      reason: targetStock <= 0 ? 'target-has-no-stock'
        : !isNewListing ? 'existing-listing-does-not-require-new-slot' : 'capacity-available'
    };
  }

  const candidates = activeRows.map((row, index) => {
    const source = row && typeof row === 'object' ? row : {};
    const listingId = clean(source.listingId || source.goodsCode || source.goodsId || source.productId);
    const sku = normalizeSku(source.sku || source.factorySku || source.vendorSku);
    const stock = numberOrNull(source.stock != null ? source.stock : source.currentStock);
    const salesCount = numberOrNull(source.salesCount != null ? source.salesCount : source.recentSalesCount);
    const pendingOrders = numberOrNull(source.pendingOrderCount != null ? source.pendingOrderCount : source.pendingOrders);
    const protectedListing = source.protected === true || source.pinned === true || source.keepListed === true
      || source.quotaRecoveryEligible === false || ['high', 'protected'].includes(clean(source.priority).toLowerCase());
    const currentBatch = source.inCurrentBatch === true || source.currentBatch === true;
    const sameTarget = Boolean((targetSku && sku === targetSku) || (listingId && targetListingIds.has(listingId)));
    const explicitLowPriority = source.quotaRecoveryEligible === true
      || ['low', 'unimportant'].includes(clean(source.priority).toLowerCase());
    const updatedAt = Date.parse(clean(source.updatedAt || source.lastUpdatedAt || source.publishedAt)) || Number.MAX_SAFE_INTEGER;
    return {
      index, listingId, sku, stock, salesCount, pendingOrders, protectedListing, currentBatch, sameTarget,
      explicitLowPriority, updatedAt,
      rank: (explicitLowPriority ? 100 : 0) + (salesCount === 0 ? 40 : salesCount === null ? 0 : -100)
        + (numberOrNull(source.viewCount) === 0 ? 10 : 0)
    };
  }).filter((row) => row.stock === 0 && !row.protectedListing && !row.currentBatch && !row.sameTarget
    && (row.pendingOrders === null || row.pendingOrders === 0) && row.salesCount === 0);

  candidates.sort((left, right) => right.rank - left.rank || left.updatedAt - right.updatedAt
    || left.listingId.localeCompare(right.listingId) || left.index - right.index);
  const candidate = candidates[0] || null;
  return {
    required: true,
    currentActiveCount,
    maximumListings,
    candidate,
    action: candidate ? 'temporarily-downlist-one-safe-zero-stock-item' : 'stop-no-safe-candidate',
    reason: candidate ? 'safe-zero-stock-candidate-selected' : 'no-safe-zero-stock-candidate',
    neverDelete: true,
    verifyBeforePublish: ['candidate-status-is-downlisted', 'active-count-below-maximum'],
    resumeSamePreparedDraft: true
  };
}

function buildShopeeLogistics(snapshot) {
  const dimensions = [snapshot.packageLengthCm, snapshot.packageWidthCm, snapshot.packageHeightCm].map(numberOrNull);
  const hasCompletePackage = dimensions.every((value) => value !== null && value > 0);
  const totalCm = hasCompletePackage ? dimensions.reduce((sum, value) => sum + value, 0) : 0;
  const longestCm = hasCompletePackage ? Math.max(...dimensions) : 0;
  const sortedDimensions = hasCompletePackage ? dimensions.slice().sort((left, right) => right - left) : [];
  const secondLongestCm = sortedDimensions[1] || 0;
  const weightKg = numberOrNull(snapshot.packageWeightKg);
  const hasValidWeight = weightKg !== null && weightKg > 0;
  const hsinchuBand = hasCompletePackage && longestCm <= 150 && totalCm <= 210
    && hasValidWeight && weightKg <= 20 ? hsinchuSizeBand(totalCm) : '';
  const canVerifyConvenience = hasCompletePackage && hasValidWeight;
  const shopeeStoreFits = canVerifyConvenience && longestCm <= 45 && totalCm <= 105 && weightKg <= 5;
  const sevenElevenFits = canVerifyConvenience && longestCm <= 45 && totalCm <= 105 && weightKg <= 10;
  const familyMartFits = canVerifyConvenience && longestCm <= 45 && secondLongestCm <= 30
    && totalCm <= 105 && weightKg < 10;
  const homeDeliveryFits = canVerifyConvenience && longestCm <= 100 && totalCm <= 150 && weightKg <= 15;
  const convenienceFits = shopeeStoreFits || sevenElevenFits || familyMartFits;
  const storedDecision = clean(snapshot.shippingDecision);
  const normalizedStoredDecision = ['convenience', 'home', 'freight', 'oversize'].includes(storedDecision)
    ? storedDecision
    : /大型|超重|不啟用超商|不可超商/.test(storedDecision)
      ? 'oversize'
      : /新竹物流/.test(storedDecision)
        ? 'freight'
        : /宅配|自訂物流/.test(storedDecision)
          ? 'home'
      : '';
  const decision = normalizedStoredDecision
    || (canVerifyConvenience ? (convenienceFits ? 'convenience' : hsinchuBand ? 'freight' : 'oversize') : '');
  const convenience = decision === 'convenience' && convenienceFits;
  const freight = decision === 'freight';
  const hsinchu = Boolean((convenience || freight) && hsinchuBand);
  const sellerLargeDelivery = Boolean(canVerifyConvenience && !convenience
    && (decision === 'home' || decision === 'oversize' || decision === 'freight'));
  const methods = [
    { label: '黑貓宅急便', enabled: false },
    { label: '蝦皮店到店 - 隔日到貨', enabled: convenience && shopeeStoreFits },
    { label: '蝦皮店到店', enabled: convenience && shopeeStoreFits },
    { label: '7-ELEVEN', enabled: convenience && sevenElevenFits },
    { label: '新竹物流', enabled: hsinchu, option: hsinchu ? hsinchuBand : '' },
    { label: '全家', enabled: convenience && familyMartFits },
    {
      label: '賣家宅配：大型/超重物品運送',
      enabled: sellerLargeDelivery,
      feeTwd: sellerLargeDelivery ? 100 : null
    },
    { label: '嘉里快遞', enabled: false },
    { label: '店到家宅配', enabled: homeDeliveryFits }
  ];
  return {
    decision,
    decisionSource: normalizedStoredDecision ? 'manager-or-case' : decision ? 'package-dimensions' : 'unresolved',
    decidedOnceBeforePlatformNavigation: true,
    packageTotalCm: hasCompletePackage ? Math.round(totalCm * 100) / 100 : null,
    methods: methods.map((row) => ({
      label: row.label,
      enabled: row.enabled === true,
      option: clean(row.option),
      feeTwd: numberOrNull(row.feeTwd),
      sellerPays: false
    })),
    requiresJudgment: !hasCompletePackage || !hasValidWeight || !decision
      || (decision === 'convenience' && !convenienceFits),
    requiresConfirmation: false
  };
}

function buildCoupangShipping(snapshot) {
  const dimensions = [snapshot.packageLengthCm, snapshot.packageWidthCm, snapshot.packageHeightCm].map(numberOrNull);
  const hasCompletePackage = dimensions.every((value) => value !== null && value > 0);
  const packageTotalCm = hasCompletePackage ? dimensions.reduce((sum, value) => sum + value, 0) : null;
  const weightKg = numberOrNull(snapshot.packageWeightKg);
  const hasValidWeight = weightKg !== null && weightKg > 0;
  const convenienceFits = hasCompletePackage && hasValidWeight && packageTotalCm <= 101 && weightKg <= 10;
  return {
    decidedOnceBeforePlatformNavigation: true,
    packageTotalCm: packageTotalCm === null ? null : Math.round(packageTotalCm * 100) / 100,
    sellerDelivery: {
      enabled: true,
      contract: 'platform-existing-seller-delivery',
      carrier: 'HCT',
      carriers: ['HCT'],
      convenienceCarriersForbiddenWhenOversize: true
    },
    convenienceStore: {
      enabled: false,
      stores: [],
      packageWouldFit: convenienceFits,
      disabledByFixedCarrierPolicy: true,
      maximumTotalDimensionsCm: 101,
      maximumWeightKg: 10
    },
    preparationDays: 1,
    requiresJudgment: !hasCompletePackage || !hasValidWeight,
    neverEnableConvenienceWhenOversize: true
  };
}

function buildMomoShipping(snapshot) {
  const dimensions = [snapshot.packageLengthCm, snapshot.packageWidthCm, snapshot.packageHeightCm].map(numberOrNull);
  const hasCompletePackage = dimensions.every((value) => value !== null && value > 0);
  const packageTotalCm = hasCompletePackage ? dimensions.reduce((sum, value) => sum + value, 0) : null;
  const weightKg = numberOrNull(snapshot.packageWeightKg);
  const hasValidWeight = weightKg !== null && weightKg > 0;
  const storedDecision = clean(snapshot.shippingDecision);
  const explicitlyOversize = /大型|超重|不啟用超商|不可超商|oversize|freight/i.test(storedDecision);
  const convenienceFitsConservativeLimit = hasCompletePackage && hasValidWeight
    && packageTotalCm <= 101 && weightKg <= 10 && !explicitlyOversize;
  return {
    decidedOnceBeforePlatformNavigation: true,
    temperature: 'ambient',
    packageTotalCm: packageTotalCm === null ? null : Math.round(packageTotalCm * 100) / 100,
    thirdParty: {
      enabled: true,
      method: MOMO_THIRD_PARTY_DELIVERY.method,
      locationCode: MOMO_THIRD_PARTY_DELIVERY.locationCode,
      locationLabel: MOMO_THIRD_PARTY_DELIVERY.locationLabel,
      carrier: MOMO_THIRD_PARTY_DELIVERY.carrier
    },
    convenienceStore: {
      enabled: convenienceFitsConservativeLimit,
      packageWouldFit: convenienceFitsConservativeLimit,
      conservativePreparedMaximumTotalDimensionsCm: 101,
      conservativePreparedMaximumWeightKg: 10,
      finalAvailabilityMustMatchCurrentMomoForm: true
    },
    oversizeMeansThirdPartyOnly: true,
    requiresJudgment: !hasCompletePackage || !hasValidWeight,
    source: explicitlyOversize ? 'manager-or-case-oversize' : convenienceFitsConservativeLimit
      ? 'package-dimensions-conservative-limit' : hasCompletePackage && hasValidWeight
        ? 'package-dimensions-third-party-only' : 'unresolved-package-measurements'
  };
}

function buildShopeeAutofillPayload(snapshot, easyStoreResult, trace = {}) {
  const easyStoreProductId = clean(easyStoreResult && easyStoreResult.productId);
  const now = Date.now();
  const listingIntent = normalizeListingIntent(snapshot);
  const addVariant = listingIntent === 'add-variant';
  const platformListingIds = Array.isArray(snapshot.shopeeExistingListingIds)
    ? [...new Set(snapshot.shopeeExistingListingIds.map(clean).filter(Boolean))].slice(0, 20)
    : [];
  const listingMode = addVariant ? 'add-variant-to-existing'
    : listingIntent === 'merge-existing' ? 'merge-variant-group-into-existing'
      : listingIntent === 'update-existing' ? 'update-existing' : 'create-new';
  return {
    schemaVersion: SHOPEE_AUTOFILL_SCHEMA_VERSION,
    workflowVersion: LISTING_WORKFLOW_ID,
    jobId: clean(trace.jobId),
    snapshotId: clean(trace.snapshotId || (snapshot.platformImagePlan && snapshot.platformImagePlan.snapshotId)),
    snapshotFingerprint: clean(trace.snapshotFingerprint),
    nonce: crypto.randomBytes(16).toString('hex'),
    createdAt: now,
    expiresAt: now + 30 * 60 * 1000,
    productId: snapshot.productId,
    easyStoreProductId,
    easyStoreUrl: easyStoreProductId ? `https://admin.easystore.co/products/${encodeURIComponent(easyStoreProductId)}` : 'https://admin.easystore.co/',
    sku: snapshot.sku,
    title: snapshot.shopeeTitle,
    // A newly created EasyStore parent already contains the complete closed
    // variant set.  Shopee must therefore use its normal EasyStore channel
    // sync path; the extension's special variantGroup contract is reserved
    // for adding one child to an existing Shopee listing.
    publishMode: addVariant ? 'add-variant-to-existing' : 'auto',
    variantGroup: addVariant ? {
      parentProductId: snapshot.variantParentProductId,
      parentSku: snapshot.variantParentSku,
      parentName: snapshot.variantParentName,
      attributeName: snapshot.variantAttributeName,
      parentAttributeValue: snapshot.variantParentAttributeValue,
      attributeValue: snapshot.variantAttributeValue,
      parentImageUrl: snapshot.variantParentImageUrl,
      imageUrl: snapshot.variantChildImageUrl
    } : null,
    listingPolicy: {
      mode: listingMode,
      identitySource: platformListingIds.length ? 'central-platform-id' : 'new-draft',
      platformListingIds,
      preflightSkuSearch: false,
      uncertainSubmitRecovery: 'exact-sku-only'
    },
    categoryPath: shopeeCategorySegments(snapshot.shopeeCategoryPath, snapshot),
    brand: snapshot.shopeeBrand || snapshot.brand,
    advancedDescription: snapshot.shopeeAdvancedDescription,
    priceAdjustment: {
      enabled: true,
      synchronizeWithEasyStorePrice: true,
      doNotSetAdjustmentModeOrValue: true
    },
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

function platformListingStatusFromPublish(previous, platforms, stages) {
  const current = previous && typeof previous === 'object' ? previous : {};
  const stageRows = stages && typeof stages === 'object' ? stages : {};
  const next = { ...current };
  const statusMap = {
    'waiting-easystore-sync': 'queued', 'awaiting-store-agent': 'queued', 'already-queued': 'queued', submitted: 'queued',
    'submitted-to-platform-review': 'pending-review', 'under-review': 'pending-review',
    'action-required': 'error', 'missing-fields': 'error', 'waiting-easystore': 'error', failed: 'error'
  };
  Object.entries(platforms && typeof platforms === 'object' ? platforms : {}).forEach(([platform, raw]) => {
    if (!raw || typeof raw !== 'object') return;
    const old = current[platform] && typeof current[platform] === 'object' ? current[platform] : {};
    const stage = stageRows[platform] && typeof stageRows[platform] === 'object' ? stageRows[platform] : {};
    const receipt = stage.receipt && typeof stage.receipt === 'object' ? stage.receipt : {};
    const receiptStatus = clean(receipt.status).toLowerCase();
    const rawStatus = clean(raw.status).toLowerCase();
    const stageVerified = clean(stage.status).toLowerCase() === 'verified';
    const pendingReview = platform === 'coupang' && [receiptStatus, rawStatus].some((value) => ['under-review', 'submitted-to-platform-review', 'pending-review', '審核中'].includes(value));
    const successSubmitted = ['created', 'updated', 'completed', 'already-completed'].includes(rawStatus);
    const preservedLiveStatus = ['active', 'mapped', 'inactive'].includes(clean(old.status)) ? clean(old.status) : '';
    const resolvedStatus = pendingReview
      ? 'pending-review'
      : stageVerified && successSubmitted
        ? 'active'
        : successSubmitted
          ? (preservedLiveStatus || 'queued')
          : (statusMap[rawStatus] || clean(old.status) || 'unknown');
    const checkedAt = stageVerified ? admin.firestore.FieldValue.serverTimestamp() : (old.lastCheckedAt || null);
    next[platform] = {
      ...old,
      status: resolvedStatus,
      listingId: clean(receipt.listingId || raw.productId || raw.listingId || old.listingId),
      note: clean(pendingReview ? '酷澎已送審，等待正式核准；請於 24 小時及 48 小時後重查。' : raw.message).slice(0, 800),
      lastCheckedAt: checkedAt,
      lastCheckedBy: stageVerified ? '商品上架正式清單核對' : (old.lastCheckedBy || ''),
      lastAttemptedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewSubmittedAt: pendingReview ? (old.reviewSubmittedAt || admin.firestore.FieldValue.serverTimestamp()) : (old.reviewSubmittedAt || null),
      nextReviewCheckAt: pendingReview ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
      finalReviewCheckAt: pendingReview ? new Date(Date.now() + 48 * 60 * 60 * 1000) : null
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
    if (/^(商品特色|商品規格|包裝內容|適用對象|使用方式(?:／適用情境)?|適用情境|使用重點|使用建議|注意事項)[：:]?$/.test(line)) {
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

function stripFixedDescriptionNoticesText(value) {
  return [LEGACY_PHYSICAL_PRODUCT_DISCLAIMER, ...FIXED_DESCRIPTION_NOTICES]
    .reduce((result, notice) => result.split(notice).join(''), clean(value))
    .trim();
}

function listingDescription(listingCase) {
  const description = clean(listingCase.productDescription || listingCase.commonProductDescription) || [
    clean(listingCase.shortDescription), clean(listingCase.featureList), clean(listingCase.specificationText)
  ].filter(Boolean).join('\n\n');
  const withoutWarranty = description.split(/\r?\n/).filter((line) => !/(?:保固|保修)/.test(line)).join('\n').trim();
  const content = stripFixedDescriptionNoticesText(withoutWarranty);
  return content ? `${content}\n\n${FIXED_DESCRIPTION_NOTICES.join('\n\n')}` : '';
}

function mergedVariantListingDescription(parentListingCase, childListingCase) {
  const stripDisclaimer = (value) => stripFixedDescriptionNoticesText(value);
  const parent = stripDisclaimer(listingDescription(parentListingCase || {}));
  const child = stripDisclaimer(listingDescription(childListingCase || {}));
  let merged = child;
  if (parent && child && !child.includes(parent)) {
    merged = parent.includes(child) ? parent : `${parent}\n\n新增細項｜${clean(childListingCase && childListingCase.variantAttributeName) || '規格'}：${clean(childListingCase && childListingCase.variantAttributeValue) || '新細項'}\n${child}`;
  } else if (parent && !child) merged = parent;
  if (!merged) return '';
  return `${merged}\n\n${FIXED_DESCRIPTION_NOTICES.join('\n\n')}`;
}

function listingDescriptionContentStatus(listingCase) {
  const description = listingDescription(listingCase);
  const content = stripFixedDescriptionNoticesText(description);
  const lines = content.replace(/\r/g, '').split('\n').map(clean).filter(Boolean);
  const hasFeatureSection = lines.some((line) => /^商品特色[：:]?$/.test(line));
  const hasUsageSection = lines.some((line) => /^(?:使用方式(?:／適用情境)?|適用情境|使用重點|使用建議)[：:]?$/.test(line));
  const hasSpecificationSection = lines.some((line) => /^商品規格[：:]?$/.test(line));
  let activeSection = '';
  let featureCount = 0;
  let usageCount = 0;
  let specificationCount = 0;
  const featurePoints = [];
  const usagePoints = [];
  lines.forEach((line) => {
    if (/^商品特色[：:]?$/.test(line)) {
      activeSection = 'features';
      return;
    }
    if (/^(?:使用方式(?:／適用情境)?|適用情境|使用重點|使用建議)[：:]?$/.test(line)) {
      activeSection = 'usage';
      return;
    }
    if (/^商品規格[：:]?$/.test(line)) {
      activeSection = 'specifications';
      return;
    }
    if (/^(?:包裝內容|適用對象|注意事項)[：:]?$/.test(line)) {
      activeSection = '';
      return;
    }
    const listItem = /^(?:\d+[.、]|[-•●])\s*\S+/.test(line);
    if (activeSection === 'features' && listItem) {
      featureCount += 1;
      featurePoints.push(line.replace(/^(?:\d+[.、]|[-•●])\s*/, ''));
    }
    if (activeSection === 'usage' && listItem) {
      usageCount += 1;
      usagePoints.push(line.replace(/^(?:\d+[.、]|[-•●])\s*/, ''));
    }
    if (activeSection === 'specifications' && (listItem || /[：:]/.test(line))) specificationCount += 1;
  });
  const genericFallback = /(?:本商品為柚子樂器販售的樂器或樂器配件|此商品尚待依精確型號、條碼、案件圖片與可驗證網路資料完成正式商品介紹)/.test(content)
    || (!hasFeatureSection && !hasUsageSection && !hasSpecificationSection
      && /(?:商品內容與規格以|如需確認尺寸、相容性或包裝內容)/.test(content));
  const missing = [];
  if (!content) missing.push('商品介紹');
  if (!hasFeatureSection || featureCount < 1) missing.push('可驗證商品特色');
  if (!hasUsageSection || usageCount < 1) missing.push('使用方式／適用情境');
  if (!hasSpecificationSection || specificationCount < 1) missing.push('可驗證商品規格');
  const featureDetailCount = featurePoints.filter((point) => point.length >= RICH_CONTENT_MINIMUM_POINT_CHARACTERS).length;
  const usageDetailCount = usagePoints.filter((point) => point.length >= RICH_CONTENT_MINIMUM_POINT_CHARACTERS).length;
  const consumerReady = featureCount >= RICH_CONTENT_MINIMUM_FEATURES
    && usageCount >= RICH_CONTENT_MINIMUM_USAGE_POINTS
    && featureDetailCount === featureCount
    && usageDetailCount === usageCount;
  if (!consumerReady) missing.push('商品特色與使用方式須以完整、自然且對消費者有意義的句子撰寫');
  if (genericFallback) missing.push('通用備援文案尚未改寫');
  return {
    ready: Boolean(content) && !genericFallback && hasFeatureSection && featureCount > 0
      && hasUsageSection && usageCount > 0 && hasSpecificationSection && specificationCount > 0 && consumerReady,
    genericFallback,
    featureCount,
    usageCount,
    featureDetailCount,
    usageDetailCount,
    minimumPointCharacters: RICH_CONTENT_MINIMUM_POINT_CHARACTERS,
    consumerReady,
    specificationCount,
    featureTarget: RICH_CONTENT_FEATURE_TARGET,
    usageTarget: RICH_CONTENT_USAGE_TARGET,
    targetComplete: featureCount >= RICH_CONTENT_FEATURE_TARGET && usageCount >= RICH_CONTENT_USAGE_TARGET,
    standardVersion: RICH_CONTENT_STANDARD_VERSION,
    missing: Array.from(new Set(missing))
  };
}

function richContentLifecycle(listingIntent, descriptionStatus) {
  const legacyUpgrade = clean(listingIntent) === 'update-existing';
  const ready = Boolean(descriptionStatus && descriptionStatus.ready);
  return {
    standardVersion: RICH_CONTENT_STANDARD_VERSION,
    mode: legacyUpgrade ? 'legacy-upgrade-in-place' : 'new-product-required',
    status: ready ? 'ready' : (legacyUpgrade ? 'needs-upgrade' : 'required-before-first-publish'),
    featureTarget: RICH_CONTENT_FEATURE_TARGET,
    usageTarget: RICH_CONTENT_USAGE_TARGET,
    requireVerifiedExactModelOrBarcode: true,
    fillEveryVerifiablePlatformAttribute: true,
    neverInventToReachTarget: true,
    preserveExistingListingIdentity: legacyUpgrade,
    blockFirstPublishUntilReady: !legacyUpgrade,
    descriptionStatus: { ...(descriptionStatus || {}) }
  };
}

function appendPhysicalProductDisclaimerHtml(html) {
  let result = clean(html);
  ['實體商品說明', '出貨與保固說明', '保固協助說明'].forEach((heading) => {
    result = result.replace(new RegExp(`<h[23]>\\s*${heading}\\s*<\\/h[23]>`, 'gi'), '');
  });
  const blocks = [LEGACY_PHYSICAL_PRODUCT_DISCLAIMER, ...FIXED_DESCRIPTION_NOTICES]
    .flatMap((notice) => [`<p><strong>${notice}</strong></p>`, `<p>${notice}</p>`]);
  blocks.forEach((block) => { result = result.split(block).join(''); });
  result += `<h3>實體商品說明</h3><p>${PHYSICAL_PRODUCT_DISCLAIMER}</p>`;
  result += `<h3>出貨與保固說明</h3><p>${WARRANTY_SUPPORT_NOTICE}</p>`;
  return result;
}

function appendShopDescriptionPromos(html) {
  let result = clean(html);
  DESCRIPTION_PROMO_IMAGE_URLS.forEach((url) => {
    const block = `<p><img src="${url}" alt="柚子樂器門市與服務資訊" style="max-width:100%;height:auto"></p>`;
    result = result.split(block).join('');
  });
  DESCRIPTION_PROMO_IMAGE_URLS.forEach((url) => {
    result += `<p><img src="${url}" alt="柚子樂器門市與服務資訊" style="max-width:100%;height:auto"></p>`;
  });
  return result;
}

function listingImageAllocation(value) {
  const productImages = normalizeUrls(value, 30)
    .filter((url) => url !== STORE_PROMO_IMAGE_URL && !DESCRIPTION_PROMO_IMAGE_URLS.includes(url))
    .slice(0, 10);
  const galleryProductImages = productImages.slice(0, 6);
  const galleryImages = galleryProductImages.length ? [...galleryProductImages, STORE_PROMO_IMAGE_URL] : [];
  return {
    productImages,
    galleryImages,
    galleryProductImages,
    descriptionImages: productImages.slice()
  };
}

function galleryImagesWithStorePromo(value, maximumCount = 7) {
  const limit = Math.max(1, Math.min(7, Math.floor(Number(maximumCount) || 7)));
  const productImages = normalizeUrls(value, 30)
    .filter((url) => url !== STORE_PROMO_IMAGE_URL && !DESCRIPTION_PROMO_IMAGE_URLS.includes(url))
    .slice(0, limit - 1);
  return productImages.length ? [...productImages, STORE_PROMO_IMAGE_URL] : [];
}

function easyStoreGalleryImages(snapshot) {
  const plan = snapshot && snapshot.platformImagePlan && snapshot.platformImagePlan.easyStore
    && typeof snapshot.platformImagePlan.easyStore === 'object'
    ? snapshot.platformImagePlan.easyStore : {};
  const baseImages = normalizeUrls([
    ...(Array.isArray(plan.imageUrls) ? plan.imageUrls : []),
    ...(Array.isArray(snapshot && snapshot.images) ? snapshot.images : [])
  ], 30).filter((url) => url !== STORE_PROMO_IMAGE_URL && !DESCRIPTION_PROMO_IMAGE_URLS.includes(url));
  const variants = snapshot && snapshot.variantGroupEnabled === true
    ? (Array.isArray(snapshot.variantGroupVariants) ? snapshot.variantGroupVariants : []) : [];
  if (!variants.length) return galleryImagesWithStorePromo(baseImages, 7);

  // EasyStore 官方商品圖上限為 9 張，細項 image_id 又只能指向同一父商品圖片。
  // 群組商品固定保留 1 張官網首圖、最多 7 張不同細項代表圖與最後 1 張店址圖；
  // 有剩餘名額時才加入其他介紹圖。超過容量不得靜默漏掉細項圖。
  const representativeImages = normalizeUrls(variants.map((row) => row && row.imageUrl), 30);
  const marketingImages = baseImages.filter((url) => !representativeImages.includes(url));
  if (!marketingImages[0] || representativeImages.length > 7) return [];
  const productImages = normalizeUrls([
    marketingImages[0],
    ...representativeImages,
    ...marketingImages.slice(1)
  ], 8);
  if (representativeImages.some((url) => !productImages.includes(url))) {
    return [];
  }
  return productImages.length ? [...productImages, STORE_PROMO_IMAGE_URL] : [];
}

function fixedDescriptionSections(html) {
  let source = clean(html);
  ['實體商品說明', '出貨與保固說明', '保固協助說明'].forEach((heading) => {
    source = source.replace(new RegExp(`<h[23]>\\s*${heading}\\s*<\\/h[23]>`, 'gi'), '');
  });
  [LEGACY_PHYSICAL_PRODUCT_DISCLAIMER, ...FIXED_DESCRIPTION_NOTICES].forEach((notice) => {
    source = source
      .split(`<p><strong>${notice}</strong></p>`).join('')
      .split(`<p>${notice}</p>`).join('');
  });
  source = source.replace(/<p[^>]*>\s*<img\b[^>]*>\s*<\/p>/gi, '');
  const matches = [];
  const pattern = /<h[23]>\s*(商品特色|商品規格|使用方式(?:／適用情境)?|適用情境|使用重點|使用建議)\s*<\/h[23]>[\s\S]*?(?=<h[23]>|$)/gi;
  let match;
  while ((match = pattern.exec(source))) {
    matches.push({ heading: clean(match[1]), html: match[0], index: match.index });
  }
  if (!matches.length) return { introduction: source, specifications: '', usage: '', remainder: '' };
  const firstIndex = matches[0].index;
  const introduction = source.slice(0, firstIndex) + matches.filter((row) => row.heading === '商品特色').map((row) => row.html).join('');
  const specifications = matches.filter((row) => row.heading === '商品規格').map((row) => row.html).join('');
  const usage = matches.filter((row) => /^(?:使用方式(?:／適用情境)?|適用情境|使用重點|使用建議)$/.test(row.heading)).map((row) => row.html).join('');
  const consumed = new Set(matches.map((row) => row.html));
  let remainder = source.slice(firstIndex);
  consumed.forEach((block) => { remainder = remainder.replace(block, ''); });
  return { introduction: clean(introduction), specifications: clean(specifications), usage: clean(usage), remainder: clean(remainder) };
}

function descriptionImageBlock(url, alt = '商品介紹圖片') {
  return `<p><img src="${url}" alt="${alt}" style="max-width:100%;height:auto"></p>`;
}

function appendShopDescriptionImages(html, imageUrls) {
  const sections = fixedDescriptionSections(html);
  const images = normalizeUrls(imageUrls, 10)
    .filter((url) => url !== STORE_PROMO_IMAGE_URL && !DESCRIPTION_PROMO_IMAGE_URLS.includes(url));
  let result = sections.introduction;
  if (images[0]) result += descriptionImageBlock(images[0]);
  result += sections.specifications;
  if (images[1]) result += descriptionImageBlock(images[1]);
  result += sections.usage;
  if (images[2]) result += descriptionImageBlock(images[2]);
  result += sections.remainder;
  images.slice(3).forEach((url) => { result += descriptionImageBlock(url); });
  return appendShopDescriptionPromos(appendPhysicalProductDisclaimerHtml(result));
}

function listingImageRoles(row) {
  const values = [].concat(row && row.roles || [], row && row.imageRoles || [], row && row.role || []);
  return Array.from(new Set(values.map(clean).filter((role) => LISTING_IMAGE_ROLES.has(role))));
}

function listingImageAssetFlags(row) {
  const source = row && typeof row === 'object' ? row : {};
  const flags = source.assetFlags && typeof source.assetFlags === 'object' ? source.assetFlags : {};
  return {
    containsLogo: source.containsLogo === true || flags.containsLogo === true,
    containsContactInfo: source.containsContactInfo === true || flags.containsContactInfo === true,
    containsQrCode: source.containsQrCode === true || flags.containsQrCode === true,
    containsText: source.containsText === true || flags.containsText === true,
    greenBrandTemplate: source.greenBrandTemplate === true || flags.greenBrandTemplate === true,
    momoPromotionEligible: source.momoPromotionEligible === true || flags.momoPromotionEligible === true
  };
}

function listingImageTemplateMetadata(row) {
  const source = row && typeof row === 'object' ? row : {};
  const metadata = source.templateContract && typeof source.templateContract === 'object'
    ? source.templateContract : {};
  return {
    version: clean(source.templateVersion || metadata.version),
    assetSha256: clean(source.templateAssetSha256 || metadata.assetSha256).toLowerCase(),
    composition: clean(source.templateComposition || metadata.composition),
    creativeStyleAssignment: source.creativeStyleAssignment && typeof source.creativeStyleAssignment === 'object'
      ? { ...source.creativeStyleAssignment }
      : metadata.creativeStyleAssignment && typeof metadata.creativeStyleAssignment === 'object'
        ? { ...metadata.creativeStyleAssignment } : null,
    brandRenderProof: source.brandRenderProof && typeof source.brandRenderProof === 'object'
      ? { ...source.brandRenderProof }
      : metadata.brandRenderProof && typeof metadata.brandRenderProof === 'object'
        ? { ...metadata.brandRenderProof } : null,
    brandCommercialPosterQa: source.brandCommercialPosterQa && typeof source.brandCommercialPosterQa === 'object'
      ? { ...source.brandCommercialPosterQa }
      : metadata.brandCommercialPosterQa && typeof metadata.brandCommercialPosterQa === 'object'
        ? { ...metadata.brandCommercialPosterQa } : null
  };
}

function brandTemplateMetadataMatches(row, role, expectedAssignment, seed) {
  const profile = BRAND_TEMPLATE_CONTRACT[role];
  if (!profile) return true;
  const metadata = listingImageTemplateMetadata(row);
  return metadata.version === BRAND_TEMPLATE_CONTRACT.version
    && metadata.assetSha256 === profile.sha256
    && metadata.composition === BRAND_TEMPLATE_CONTRACT.composition
    && metadata.creativeStyleAssignment
    && listingBrandCreative.renderProofMatches(
      metadata.brandRenderProof,
      expectedAssignment || metadata.creativeStyleAssignment,
      seed || `${role}|${metadata.assetSha256}`
    );
}

function cleanRepresentativeRoleRow(row) {
  const roles = listingImageRoles(row);
  const flags = listingImageAssetFlags(row);
  return roles.includes('cleanMain')
    && !flags.containsLogo && !flags.containsContactInfo && !flags.containsQrCode && !flags.containsText && !flags.greenBrandTemplate;
}

function storefrontPortraitRoleRow(row) {
  const roles = listingImageRoles(row);
  const flags = listingImageAssetFlags(row);
  return roles.includes('storefrontPortrait')
    && (flags.containsText || (flags.containsLogo && flags.greenBrandTemplate))
    && !flags.containsContactInfo && !flags.containsQrCode
    && brandTemplateMetadataMatches(row, 'storefrontPortrait');
}

function localizedImageRowsBySource(listingCase) {
  const rows = listingCase && Array.isArray(listingCase.generatedListingImages)
    ? listingCase.generatedListingImages : [];
  const result = new Map();
  const rolesByUrl = new Map();
  rows.forEach((row) => {
    const sourceUrl = safeHttpUrl(row && row.sourceImageUrl);
    const completedUrl = safeHttpUrl(row && row.url);
    const ready = clean(row && row.status).toLowerCase() === 'ready';
    const localized = clean(row && row.localizationStatus).toLowerCase() === 'completed'
      || clean(row && row.qaStatus).toLowerCase() === 'approved';
    const roles = listingImageRoles(row);
    if (!sourceUrl || !completedUrl || sourceUrl === completedUrl || !ready || !localized || !roles.length) return;
    const urlRoles = rolesByUrl.get(completedUrl) || new Set();
    roles.forEach((role) => urlRoles.add(role));
    rolesByUrl.set(completedUrl, urlRoles);
    const values = result.get(sourceUrl) || [];
    values.push({
      sourceImageUrl: sourceUrl, url: completedUrl, roles, assetFlags: listingImageAssetFlags(row),
      templateContract: listingImageTemplateMetadata(row)
    });
    result.set(sourceUrl, values);
  });
  result.forEach((rowsForSource, sourceUrl) => {
    result.set(sourceUrl, rowsForSource.filter((row) => {
      const urlRoles = rolesByUrl.get(row.url) || new Set();
      const layoutRoles = ['cleanMain', 'brandedHero', 'storefrontPortrait'].filter((role) => urlRoles.has(role));
      return layoutRoles.length <= 1;
    }));
  });
  return result;
}

function localizedRepresentativeImage(listingCase, sourceUrl) {
  const rows = localizedImageRowsBySource(listingCase).get(safeHttpUrl(sourceUrl)) || [];
  const cleanRows = rows.filter(cleanRepresentativeRoleRow);
  const representative = cleanRows.find((row) => row.roles.includes('variantRepresentative'))
    || cleanRows.find((row) => row.roles.includes('cleanMain'));
  return representative ? representative.url : '';
}

function prioritizedListingImageUrls(listingCase) {
  const source = listingCase && typeof listingCase === 'object' ? listingCase : {};
  const listingUrls = normalizeUrls(source.listingImageUrls, 30);
  const prioritized = normalizeUrls(source.gallerySourceImageUrls, 20)
    .map((sourceUrl) => localizedRepresentativeImage(source, sourceUrl) || (listingUrls.includes(sourceUrl) ? sourceUrl : ''))
    .filter((url) => url && listingUrls.includes(url));
  return prioritized.concat(listingUrls.filter((url) => !prioritized.includes(url)));
}

function finalizedRoleRowsForCase(productId, frozenCase, currentCase) {
  const frozenSources = normalizeUrls(frozenCase && frozenCase.sourceImageUrls, 20);
  const allowedSources = new Set(frozenSources);
  if (!clean(productId) || !frozenSources.length) throw new Error(`${clean(productId) || '未知商品'}的凍結來源圖清單為空。`);
  const generated = currentCase && Array.isArray(currentCase.generatedListingImages)
    ? currentCase.generatedListingImages : [];
  const readyRows = [];
  const lineageKeys = new Set();
  const expectedBrandStyle = listingBrandCreative.assignment(
    currentCase && currentCase.brandCreativeStyleAssignment,
    `${clean(productId)}|${normalizeSku(frozenCase && frozenCase.sku || currentCase && currentCase.productSku)}`
  );
  generated.forEach((row) => {
    const status = clean(row && row.status).toLowerCase();
    const localized = clean(row && row.localizationStatus).toLowerCase() === 'completed'
      || clean(row && row.qaStatus).toLowerCase() === 'approved';
    if (status !== 'ready' || !localized) return;
    const sourceImageUrl = safeHttpUrl(row && row.sourceImageUrl);
    const url = safeHttpUrl(row && row.url);
    const roles = listingImageRoles(row);
    if (!sourceImageUrl || !allowedSources.has(sourceImageUrl)) {
      throw new Error(`${clean(productId)}的完成圖來源不在凍結輸入清單。`);
    }
    if (!url || allowedSources.has(url)) throw new Error(`${clean(productId)}的完成圖仍是凍結來源原圖。`);
    if (!roles.length) throw new Error(`${clean(productId)}的完成圖缺少圖片角色。`);
    const flags = row && row.assetFlags && typeof row.assetFlags === 'object' ? row.assetFlags : null;
    if (!flags || !['containsLogo', 'containsContactInfo', 'containsQrCode', 'containsText', 'greenBrandTemplate', 'momoPromotionEligible']
      .every((keyName) => typeof flags[keyName] === 'boolean')) {
      throw new Error(`${clean(productId)}的完成圖缺少完整 assetFlags。`);
    }
    ['storefrontPortrait', 'brandedHero'].forEach((role) => {
      if (roles.includes(role) && !brandTemplateMetadataMatches(row, role, expectedBrandStyle, clean(productId))) {
        throw new Error(`${clean(productId)}的 ${role} 未使用固定綠底品牌母版 ${BRAND_TEMPLATE_CONTRACT.version}，或實際風格／圖層證明與本商品指派不符。`);
      }
    });
    roles.forEach((role) => {
      const lineageKey = `${sourceImageUrl}|${role}`;
      if (lineageKeys.has(lineageKey)) throw new Error(`${clean(productId)}的同一來源與角色有多個完成輸出。`);
      lineageKeys.add(lineageKey);
    });
    readyRows.push({
      productId: clean(productId), sourceImageUrl, url, roles,
      sourceOrder: Math.max(0, Number(row && row.sourceOrder) || frozenSources.indexOf(sourceImageUrl) + 1),
      assetFlags: listingImageAssetFlags(row),
      templateContract: listingImageTemplateMetadata(row),
      creativeStyleAssignment: listingImageTemplateMetadata(row).creativeStyleAssignment,
      brandRenderProof: listingImageTemplateMetadata(row).brandRenderProof,
      brandCommercialPosterQa: listingImageTemplateMetadata(row).brandCommercialPosterQa
    });
  });
  const rolesByUrl = new Map();
  readyRows.forEach((row) => {
    const roles = rolesByUrl.get(row.url) || new Set();
    row.roles.forEach((role) => roles.add(role));
    rolesByUrl.set(row.url, roles);
  });
  rolesByUrl.forEach((roles) => {
    const layoutRoles = ['cleanMain', 'brandedHero', 'storefrontPortrait'].filter((role) => roles.has(role));
    if (layoutRoles.length > 1) throw new Error(`${clean(productId)}的同一完成圖不得同時兼任不同尺寸的首圖角色。`);
  });
  frozenSources.forEach((sourceImageUrl) => {
    const rows = readyRows.filter((row) => row.sourceImageUrl === sourceImageUrl);
    if (!rows.some((row) => row.roles.some((role) => ['cleanMain', 'localizedDetail', 'specification', 'variantRepresentative'].includes(role)))) {
      throw new Error(`${clean(productId)}的凍結來源圖尚無可上架的繁體完成圖。`);
    }
  });
  return readyRows;
}

function buildFinalPlatformImagePlan(caseRows) {
  const groups = (Array.isArray(caseRows) ? caseRows : []).map((item) => {
    const allowed = new Set(normalizeUrls(item && item.gallerySourceImageUrls, 12));
    return (Array.isArray(item && item.roleRows) ? item.roleRows : [])
      .filter((row) => !allowed.size || allowed.has(row.sourceImageUrl) || allowed.has(row.url))
      .slice().sort((a, b) => {
      const rank = (row) => row.roles.includes('cleanMain') ? 0
        : row.roles.includes('storefrontPortrait') ? 1 : row.roles.includes('brandedHero') ? 2 : 3;
      return rank(a) - rank(b) || a.sourceOrder - b.sourceOrder;
    });
  });
  const pool = [];
  const seen = new Set();
  const pushRow = (row, groupIndex) => {
    if (!row || seen.has(row.url) || pool.length >= 12) return false;
    seen.add(row.url);
    pool.push(row);
    return true;
  };
  const rootRows = groups[0] || [];

  // storefrontPortrait and brandedHero describe the whole parent listing. They are
  // singleton group assets and must come from the root case; child variants only
  // contribute their clean representative and genuinely distinct detail images.
  pushRow(rootRows.find(storefrontPortraitRoleRow), 0);
  pushRow(rootRows.find((row) => row.roles.includes('brandedHero')), 0);

  // Give every variant one clean representative before adding any additional detail.
  // The two group-level heroes consume two of the twelve shared slots, so at most ten
  // variant representatives can fit when a group has more than ten variants.
  groups.forEach((rows, groupIndex) => {
    if (pool.length >= 12) return;
    const representative = rows.find((row) => row.roles.includes('cleanMain') && cleanRepresentativeRoleRow(row))
      || rows.find((row) => row.roles.includes('variantRepresentative'))
      || rows.find((row) => row.roles.some((role) => ['localizedDetail', 'specification'].includes(role)));
    pushRow(representative, groupIndex);
  });
  // Reserve MOMO's clean promotion image before the shared twelve-image pool
  // fills with ordinary detail images. The promotion gate requires this image
  // to occupy position 2 or 3, so discovering it only after truncation can
  // incorrectly reject an otherwise complete case.
  const representativeClean = pool.find((row) => row.roles.includes('cleanMain') && cleanRepresentativeRoleRow(row));
  const reservedPromotion = groups.flat().find((row) => (
    (!representativeClean || row.url !== representativeClean.url)
    && row.assetFlags.momoPromotionEligible
    && !row.assetFlags.containsLogo && !row.assetFlags.containsText
    && !row.assetFlags.containsContactInfo && !row.assetFlags.containsQrCode
    && !row.assetFlags.greenBrandTemplate
    && row.roles.some((role) => ['cleanMain', 'localizedDetail', 'specification'].includes(role))
  ));
  pushRow(reservedPromotion, 0);
  const additionalRows = groups.map((rows) => rows.filter((row) => (
    !row.roles.includes('storefrontPortrait') && !row.roles.includes('brandedHero')
  )));
  for (let index = 0; pool.length < 12 && additionalRows.some((rows) => index < rows.length); index += 1) {
    additionalRows.forEach((rows, groupIndex) => pushRow(rows[index], groupIndex));
  }
  const urls = (values) => normalizeUrls(values.map((row) => row.url), 12);
  const cleanRows = pool.filter((row) => row.roles.includes('cleanMain') && cleanRepresentativeRoleRow(row));
  const brandedRows = pool.filter((row) => row.roles.includes('brandedHero')
    && (row.assetFlags.containsText || (row.assetFlags.containsLogo && row.assetFlags.greenBrandTemplate))
    && !row.assetFlags.containsContactInfo && !row.assetFlags.containsQrCode);
  const storefrontRows = pool.filter(storefrontPortraitRoleRow);
  const detailRows = pool.filter((row) => row.roles.some((role) => ['localizedDetail', 'specification', 'variantRepresentative'].includes(role)));
  const safeBrandedRows = brandedRows.filter((row) => !row.assetFlags.containsContactInfo && !row.assetFlags.containsQrCode);
  const uniqueRows = (values) => {
    const found = new Set();
    return values.filter((row) => row && !found.has(row.url) && found.add(row.url));
  };
  const nonHeroRows = pool.filter((row) => !row.roles.includes('brandedHero') && !row.roles.includes('storefrontPortrait'));
  // Each platform gallery may contain only one green Youzi template. EasyStore
  // uses the locked 4:3 storefront output, so the square branded hero must not
  // be appended again later in the same gallery.
  const easyRows = uniqueRows(storefrontRows.concat(cleanRows, detailRows, nonHeroRows));
  const shopeeRows = uniqueRows(brandedRows.concat(cleanRows, detailRows, nonHeroRows));
  const cleanFirst = cleanRows.slice(0, 1);
  const promoRow = pool.find((row) => (!cleanFirst[0] || row.url !== cleanFirst[0].url)
    && row.assetFlags.momoPromotionEligible
    && !row.assetFlags.containsLogo && !row.assetFlags.containsContactInfo && !row.assetFlags.containsQrCode
    && !row.assetFlags.containsText && !row.assetFlags.greenBrandTemplate
    && row.roles.some((role) => ['cleanMain', 'localizedDetail', 'specification'].includes(role)));
  const secondaryBrand = safeBrandedRows.find((row) => !cleanFirst[0] || row.url !== cleanFirst[0].url);
  const coupangRows = uniqueRows(cleanFirst.concat(secondaryBrand || [], nonHeroRows, detailRows));
  // MOMO's promotion material must be visible in position 2 or 3. Put it second,
  // then allow at most one safe branded secondary image.
  const momoRows = uniqueRows(cleanFirst.concat(promoRow || [], secondaryBrand || [], nonHeroRows, detailRows));
  const momoPromoCandidates = momoRows.slice(1, 3);
  const orderedPromoRow = momoPromoCandidates.find((row) => row.assetFlags.momoPromotionEligible
    && !row.assetFlags.containsLogo && !row.assetFlags.containsContactInfo && !row.assetFlags.containsQrCode
    && !row.assetFlags.containsText && !row.assetFlags.greenBrandTemplate
    && row.roles.some((role) => ['cleanMain', 'localizedDetail', 'specification'].includes(role)));
  return {
    sharedCompletedImageUrls: urls(pool),
    easyStore: { imageUrls: urls(easyRows), requiredFirstRole: 'storefrontPortrait', ready: Boolean(easyRows[0] && easyRows[0].roles.includes('storefrontPortrait')) },
    shopee: { imageUrls: urls(shopeeRows), requiredFirstRole: 'brandedHero', ready: Boolean(shopeeRows[0] && shopeeRows[0].roles.includes('brandedHero')) },
    coupang: { imageUrls: urls(coupangRows), requiredFirstRole: 'cleanMain', ready: Boolean(coupangRows[0] && coupangRows[0].roles.includes('cleanMain')), brandedHeroAllowedAsSecondary: true, removeSecondaryBrandedHeroIfPlatformRejectsGalleryLogo: true },
    momo: { imageUrls: urls(momoRows), requiredFirstRole: 'cleanMain', ready: Boolean(momoRows[0] && momoRows[0].roles.includes('cleanMain')), brandedHeroAllowedAsSecondary: true, promotionImageUrl: orderedPromoRow ? orderedPromoRow.url : '', promotionImageReady: Boolean(orderedPromoRow) }
  };
}

function frozenInputSnapshotFingerprint(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return crypto.createHash('sha256').update(JSON.stringify(compactObject(source))).digest('hex');
}

function finalizePreparedMediaSnapshot(frozenInputSnapshot, currentCasesById) {
  const frozen = frozenInputSnapshot && typeof frozenInputSnapshot === 'object' ? frozenInputSnapshot : {};
  if (clean(frozen.workflowVersion) !== LISTING_WORKFLOW_ID) throw new Error('只能從 v3 凍結輸入快照建立完成圖快照。');
  const frozenCases = Array.isArray(frozen.cases) ? frozen.cases : [];
  if (!frozenCases.length) throw new Error('v3 凍結輸入快照沒有商品案件。');
  const allFrozenSourceUrls = new Set(frozenCases.flatMap((item) => normalizeUrls(item && item.sourceImageUrls, 20)));
  const currentMap = currentCasesById instanceof Map
    ? currentCasesById : new Map(Object.entries(currentCasesById && typeof currentCasesById === 'object' ? currentCasesById : {}));
  const cases = frozenCases.map((frozenCase) => {
    const productId = clean(frozenCase && frozenCase.productId);
    const currentCase = currentMap.get(productId);
    if (!productId || !currentCase) throw new Error(`${productId || '未知商品'}無法重讀最新案件。`);
    const roleRows = finalizedRoleRowsForCase(productId, frozenCase, currentCase);
    if (roleRows.some((row) => allFrozenSourceUrls.has(row.url))) {
      throw new Error(`${productId}的完成圖仍是本組其他商品的凍結來源原圖。`);
    }
    const representativeSourceImageUrl = safeHttpUrl(frozenCase && frozenCase.representativeSourceImageUrl);
    const representativeRow = representativeSourceImageUrl
      ? roleRows.find((row) => row.sourceImageUrl === representativeSourceImageUrl && cleanRepresentativeRoleRow(row)) : null;
    const frozenPreparedCase = frozenCase && frozenCase.preparedCase && typeof frozenCase.preparedCase === 'object'
      ? frozenCase.preparedCase : {};
    const physicalImageUrls = normalizeUrls(
      Array.isArray(frozenPreparedCase.physicalImageUrls) ? frozenPreparedCase.physicalImageUrls : currentCase.physicalImageUrls,
      20
    );
    const physicalOriginalImageUrls = normalizeUrls(
      Array.isArray(frozenPreparedCase.physicalOriginalImageUrls) ? frozenPreparedCase.physicalOriginalImageUrls : currentCase.physicalOriginalImageUrls,
      20
    );
    return {
      productId, sku: clean(frozenCase && frozenCase.sku || currentCase.productSku),
      sourceImageUrls: normalizeUrls(frozenCase && frozenCase.sourceImageUrls, 20),
      gallerySourceImageUrls: normalizeUrls(frozenCase && frozenCase.gallerySourceImageUrls, 12),
      representativeSourceImageUrl,
      representativeCompletedImageUrl: representativeRow ? representativeRow.url : '',
      roleRows,
      preparedCase: {
        imageRoleAssignments: roleRows.map((row) => ({
          sourceImageUrl: row.sourceImageUrl, url: row.url, roles: row.roles.slice(), assetFlags: { ...row.assetFlags },
          templateContract: row.templateContract && row.templateContract.version ? { ...row.templateContract } : null,
          creativeStyleAssignment: row.creativeStyleAssignment ? { ...row.creativeStyleAssignment } : null,
          brandRenderProof: row.brandRenderProof ? { ...row.brandRenderProof } : null,
          brandCommercialPosterQa: row.brandCommercialPosterQa ? { ...row.brandCommercialPosterQa } : null
        })),
        physicalImageUrls,
        physicalOriginalImageUrls,
        physicalImagePolicy: {
          preserveOriginal: true,
          customerFacingDerivative: 'label-only',
          labelText: '實體圖',
          aiEditingForbidden: true,
          placement: 'description-only-after-completed-images-before-fixed-notices-and-final-promos',
          neverUseAsMainImage: true
        },
        sourceImageRetention: currentCase.sourceImageRetentionPolicy && typeof currentCase.sourceImageRetentionPolicy === 'object'
          ? currentCase.sourceImageRetentionPolicy : {}
      }
    };
  });
  return {
    workflowVersion: LISTING_WORKFLOW_ID,
    snapshotId: `${clean(frozen.snapshotId) || clean(frozen.productId)}-final`,
    inputSnapshotId: clean(frozen.snapshotId),
    inputSnapshotFingerprint: frozenInputSnapshotFingerprint(frozen),
    finalizedFromFrozenInput: true,
    cases,
    platformImagePlan: buildFinalPlatformImagePlan(cases)
  };
}

async function loadFinalPreparedMediaSnapshot(db, productId, listingCase) {
  const frozen = listingCase && listingCase.codexHandoff && listingCase.codexHandoff.preflightSnapshot;
  if (!frozen || typeof frozen !== 'object') throw new Error('找不到 v3 凍結輸入快照。');
  const ids = Array.from(new Set((Array.isArray(frozen.cases) ? frozen.cases : []).map((item) => clean(item && item.productId)).filter(Boolean)));
  if (!ids.includes(clean(productId))) throw new Error('凍結輸入快照與本商品不一致。');
  const snapshots = await Promise.all(ids.map((id) => db.collection(LISTING_CASE_COLLECTION).doc(id).get()));
  const currentCases = new Map();
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) throw new Error(`${ids[index]}的商品案件已不存在。`);
    currentCases.set(ids[index], snapshot.data() || {});
  });
  return {
    rootListingCase: currentCases.get(clean(productId)), currentCases,
    preparedMediaSnapshot: finalizePreparedMediaSnapshot(frozen, currentCases)
  };
}

function preparedPlatformImagePlan(listingCase, finalizedMediaSnapshot = null) {
  const handoff = listingCase && listingCase.codexHandoff && typeof listingCase.codexHandoff === 'object'
    ? listingCase.codexHandoff : {};
  const prepared = finalizedMediaSnapshot && typeof finalizedMediaSnapshot === 'object'
    ? finalizedMediaSnapshot
    : handoff.preflightSnapshot && typeof handoff.preflightSnapshot === 'object' ? handoff.preflightSnapshot : {};
  const source = prepared.platformImagePlan && typeof prepared.platformImagePlan === 'object'
    ? prepared.platformImagePlan : {};
  const roleRows = [];
  (Array.isArray(prepared.cases) ? prepared.cases : []).forEach((item) => {
    const preparedCase = item && item.preparedCase && typeof item.preparedCase === 'object' ? item.preparedCase : {};
    const assignments = Array.isArray(preparedCase.imageRoleAssignments) ? preparedCase.imageRoleAssignments : [];
    assignments.forEach((row) => {
      const url = safeHttpUrl(row && row.url);
      const sourceImageUrl = safeHttpUrl(row && row.sourceImageUrl);
      const roles = listingImageRoles(row);
      if (!url || !sourceImageUrl || url === sourceImageUrl || !roles.length) return;
      roleRows.push({
        productId: clean(item && item.productId), sourceImageUrl, url, roles,
        assetFlags: listingImageAssetFlags(row),
        templateContract: listingImageTemplateMetadata(row),
        assetFlagsDeclared: Boolean(row && row.assetFlags && typeof row.assetFlags === 'object'
          && ['containsLogo', 'containsContactInfo', 'containsQrCode', 'containsText', 'greenBrandTemplate', 'momoPromotionEligible']
            .every((keyName) => typeof row.assetFlags[keyName] === 'boolean'))
      });
    });
  });
  const rolesByUrl = new Map();
  roleRows.forEach((row) => {
    const roles = rolesByUrl.get(row.url) || new Set();
    row.roles.forEach((role) => roles.add(role));
    rolesByUrl.set(row.url, roles);
  });
  const normalizePlatform = (key) => {
    const row = source[key] && typeof source[key] === 'object' ? source[key] : {};
    const imageUrls = normalizeUrls(row.imageUrls, 12);
    const imageRoleAssignments = imageUrls.map((url) => {
      const matches = roleRows.filter((candidate) => candidate.url === url);
      const roles = Array.from(rolesByUrl.get(url) || []);
      const assetFlags = matches.reduce((flags, candidate) => ({
        containsLogo: flags.containsLogo || candidate.assetFlags.containsLogo,
        containsContactInfo: flags.containsContactInfo || candidate.assetFlags.containsContactInfo,
        containsQrCode: flags.containsQrCode || candidate.assetFlags.containsQrCode,
        containsText: flags.containsText || candidate.assetFlags.containsText,
        greenBrandTemplate: flags.greenBrandTemplate || candidate.assetFlags.greenBrandTemplate,
        momoPromotionEligible: flags.momoPromotionEligible || candidate.assetFlags.momoPromotionEligible
      }), { containsLogo: false, containsContactInfo: false, containsQrCode: false, containsText: false, greenBrandTemplate: false, momoPromotionEligible: false });
      const templateMetadataVerified = matches.every((candidate) => candidate.roles.every((role) => (
        !['storefrontPortrait', 'brandedHero'].includes(role) || brandTemplateMetadataMatches(candidate, role)
      )));
      return {
        url, sourceImageUrls: Array.from(new Set(matches.map((candidate) => candidate.sourceImageUrl))), roles, assetFlags,
        metadataVerified: matches.length > 0 && matches.every((candidate) => candidate.assetFlagsDeclared)
          && templateMetadataVerified
          && ['cleanMain', 'brandedHero', 'storefrontPortrait'].filter((role) => roles.includes(role)).length <= 1,
        templateContract: matches.map((candidate) => candidate.templateContract).find((value) => value && value.version) || null
      };
    });
    const requiredFirstRole = clean(row.requiredFirstRole);
    const first = imageRoleAssignments[0] || null;
    const allMetadataVerified = imageRoleAssignments.length > 0 && imageRoleAssignments.every((entry) => entry.metadataVerified);
    const firstRoleVerified = Boolean(first && first.metadataVerified && first.roles.includes(requiredFirstRole)
      && (requiredFirstRole === 'cleanMain'
        ? cleanRepresentativeRoleRow(first)
        : requiredFirstRole === 'brandedHero'
          ? (first.assetFlags.containsText || (first.assetFlags.containsLogo && first.assetFlags.greenBrandTemplate))
            && !first.assetFlags.containsContactInfo && !first.assetFlags.containsQrCode
            && brandTemplateMetadataMatches(first, 'brandedHero')
          : requiredFirstRole === 'storefrontPortrait'
            ? storefrontPortraitRoleRow(first)
            : false));
    const brandedAfterMain = imageRoleAssignments.slice(1).filter((entry) => entry.roles.includes('brandedHero'));
    const safeBrandedAfterMain = brandedAfterMain.every((entry) => !entry.assetFlags.containsContactInfo && !entry.assetFlags.containsQrCode)
      && (key !== 'momo' || brandedAfterMain.length <= 1);
    const promotionImageUrl = safeHttpUrl(row.promotionImageUrl);
    const promotionEntry = imageRoleAssignments.find((entry) => entry.url === promotionImageUrl) || null;
    const promotionImageReady = row.promotionImageReady === true
      && [imageUrls[1], imageUrls[2]].filter(Boolean).includes(promotionImageUrl)
      && Boolean(promotionEntry && promotionEntry.metadataVerified
        && promotionEntry.assetFlags.momoPromotionEligible
        && !promotionEntry.assetFlags.containsLogo && !promotionEntry.assetFlags.containsContactInfo
        && !promotionEntry.assetFlags.containsQrCode && !promotionEntry.assetFlags.containsText
        && !promotionEntry.assetFlags.greenBrandTemplate
        && promotionEntry.roles.some((role) => ['cleanMain', 'localizedDetail', 'specification'].includes(role)));
    return {
      imageUrls,
      imageRoleAssignments,
      requiredFirstRole,
      firstRoleVerified,
      roleMetadataVerified: allMetadataVerified && firstRoleVerified && safeBrandedAfterMain,
      ready: row.ready === true && allMetadataVerified && firstRoleVerified && safeBrandedAfterMain,
      promotionImageUrl,
      promotionImageReady,
      brandedHeroAllowedAsSecondary: row.brandedHeroAllowedAsSecondary === true,
      removeSecondaryBrandedHeroIfPlatformRejectsGalleryLogo: row.removeSecondaryBrandedHeroIfPlatformRejectsGalleryLogo === true
    };
  };
  return {
    workflowVersion: clean(prepared.workflowVersion || handoff.workflowVersion),
    snapshotId: clean(prepared.snapshotId),
    source: prepared.finalizedFromFrozenInput === true
      ? 'codex-v3-finalized-media-snapshot'
      : clean(prepared.workflowVersion || handoff.workflowVersion) === LISTING_WORKFLOW_ID ? 'codex-v3-prepared-snapshot' : 'missing-or-legacy',
    finalizedFromFrozenInput: prepared.finalizedFromFrozenInput === true,
    inputSnapshotId: clean(prepared.inputSnapshotId),
    inputSnapshotFingerprint: clean(prepared.inputSnapshotFingerprint),
    roleAssignments: roleRows,
    imageReferenceCases: (Array.isArray(prepared.cases) ? prepared.cases : []).map((item) => ({
      productId: clean(item && item.productId),
      sku: clean(item && item.sku),
      sourceImageUrls: normalizeUrls(item && item.sourceImageUrls, 20),
      representativeSourceImageUrl: safeHttpUrl(item && item.representativeSourceImageUrl),
      representativeCompletedImageUrl: safeHttpUrl(item && item.representativeCompletedImageUrl),
      sourceImageRetention: item && item.preparedCase && item.preparedCase.sourceImageRetention && typeof item.preparedCase.sourceImageRetention === 'object'
        ? item.preparedCase.sourceImageRetention : {}
    })).filter((item) => item.productId),
    sharedCompletedImageUrls: normalizeUrls(source.sharedCompletedImageUrls, 12),
    easyStore: normalizePlatform('easyStore'),
    shopee: normalizePlatform('shopee'),
    coupang: normalizePlatform('coupang'),
    momo: normalizePlatform('momo')
  };
}

function platformImagePlanMissingFields(plan, options = {}) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const missing = [];
  const selected = new Set(Array.isArray(options.targetPlatforms) && options.targetPlatforms.length
    ? options.targetPlatforms.map(clean) : PLATFORM_EXECUTION_ORDER);
  const acceptedSource = source.source === 'codex-v3-prepared-snapshot' || source.source === 'codex-v3-finalized-media-snapshot';
  if (source.workflowVersion !== LISTING_WORKFLOW_ID || !acceptedSource) missing.push('v3 圖片角色預檢快照');
  if (options.requireFinalized === true && (source.source !== 'codex-v3-finalized-media-snapshot'
    || source.finalizedFromFrozenInput !== true || !source.inputSnapshotId || !source.inputSnapshotFingerprint)) {
    missing.push('來源輸入驗證後的最終完成圖快照');
  }
  [['easyStore', 'storefrontPortrait'], ['shopee', 'brandedHero'], ['coupang', 'cleanMain'], ['momo', 'cleanMain']].forEach(([platform, role]) => {
    if (!selected.has(platform)) return;
    const row = source[platform] && typeof source[platform] === 'object' ? source[platform] : {};
    if (!row.ready || !row.roleMetadataVerified || row.requiredFirstRole !== role || !row.imageUrls.length) missing.push(`${platform} 首圖角色 ${role}`);
  });
  const momo = source.momo && typeof source.momo === 'object' ? source.momo : {};
  if (selected.has('momo') && (!momo.promotionImageReady || !momo.promotionImageUrl)) missing.push('MOMO clean-only 專推圖');
  return missing;
}

function variantRepresentativeMissingFields(snapshot) {
  const missing = [];
  const selected = new Set(listingTargetPlatforms(snapshot));
  if (snapshot.listingMode === 'add-variant') {
    if (!snapshot.variantParentSourceImageUrl) missing.push('原商品代表圖');
    else if (!snapshot.variantParentImageUrl) missing.push('原商品代表圖的繁體完成版');
    if (!snapshot.variantChildSourceImageUrl) missing.push('新細項代表圖');
    else if (!snapshot.variantChildImageUrl) missing.push('新細項代表圖的繁體完成版');
  } else if (snapshot.variantGroupEnabled) {
    if (!snapshot.variantGroupPrimarySourceImageUrl) missing.push('目前商品代表圖');
    else if (!snapshot.variantGroupPrimaryImageUrl) missing.push('目前商品代表圖的繁體完成版');
    if (!snapshot.variantGroupAttributeName) missing.push('同款商品細項種類');
    const variants = Array.isArray(snapshot.variantGroupVariants) ? snapshot.variantGroupVariants : [];
    if (variants.length < 2) missing.push('同款商品至少兩個細項');
    variants.forEach((variant, index) => {
      const label = clean(variant && (variant.sku || variant.attributeValue)) || `第 ${index + 1} 個細項`;
      if (!clean(variant && variant.sku)) missing.push(`${label} SKU`);
      if (!clean(variant && variant.attributeValue)) missing.push(`${label} 細項名稱`);
      if (!safeHttpUrl(variant && variant.sourceImageUrl)) missing.push(`${label} 指定代表圖`);
      if (!safeHttpUrl(variant && variant.imageUrl)) missing.push(`${label} 指定代表圖的繁體完成版`);
      if (selected.has('easyStore') && numberOrNull(variant && variant.easyStorePrice) === null) missing.push(`${label} EasyStore 售價`);
      if (selected.has('momo') && numberOrNull(variant && variant.momoPrice) === null) missing.push(`${label} MOMO 售價`);
      if (selected.has('coupang') && numberOrNull(variant && variant.coupangPrice) === null) missing.push(`${label} 酷澎售價`);
    });
  }
  return missing;
}

function buildCanonicalCategoryDecision(snapshot) {
  const evidence = {
    title: snapshot.title,
    shopeeTitle: snapshot.shopeeTitle,
    productName: snapshot.title,
    category: snapshot.category,
    model: snapshot.model
  };
  const family = shopeeTaxonomy.inferMusicFamily(evidence, snapshot.shopeeCategoryPath);
  const shopeePath = shopeeTaxonomy.formatCategoryPath(snapshot.shopeeCategoryPath, evidence);
  const normalizedFamily = clean(family) || '未判定';
  return {
    version: 1,
    decidedOnceBeforePlatformNavigation: true,
    scope: 'musical-instruments-and-accessories-only',
    canonicalFamily: normalizedFamily,
    canonicalKey: normalizedFamily === '未判定' ? '' : `music:${normalizedFamily}`,
    evidenceSummary: clean([snapshot.category, snapshot.title, snapshot.model].filter(Boolean).join('｜')).slice(0, 500),
    platformMappings: {
      easyStore: { value: clean(snapshot.category) || normalizedFamily, status: clean(snapshot.category) || family ? 'resolved' : 'unresolved' },
      shopee: { value: shopeePath, status: shopeePath ? 'resolved' : 'unresolved' },
      coupang: { value: clean(snapshot.coupangCategoryCode), status: clean(snapshot.coupangCategoryCode) ? 'resolved' : 'map-once-before-platform' },
      momo: { value: clean(snapshot.momoCategoryCode), status: clean(snapshot.momoCategoryCode) ? 'resolved' : 'map-once-before-platform' }
    },
    forbidPerPlatformReclassification: true,
    remapOnlyWhenPlatformTaxonomyRejectsStoredMapping: true
  };
}

function buildListingDecisionContract(snapshot) {
  return {
    version: 2,
    mode: 'deterministic-workflow-with-structured-judgment',
    immutableForJob: true,
    deterministicSteps: [
      'freeze-case-input', 'validate-completed-image-lineage', 'sync-central-clean-images',
      'prepare-platform-field-plan-once', 'run-momo-coupang-easystore-roots',
      'run-shopee-after-easystore', 'verify-each-platform-once', 'cleanup-source-binaries-after-all-verification'
    ],
    automaticFields: {
      priceFallbackOrder: ['platform-price', 'shared-online-price', 'online-price', 'store-price'],
      warrantyDays: 180,
      publishImmediately: true,
      momoThirdPartyLocationCode: MOMO_THIRD_PARTY_DELIVERY.locationCode,
      centralImageRole: 'cleanMain',
      easyStoreFirstImageRole: 'storefrontPortrait',
      shopeeFirstImageRole: 'brandedHero',
      coupangFirstImageRole: 'cleanMain',
      momoFirstImageRole: 'cleanMain',
      singleGreenBrandTemplatePerPlatformGallery: true,
      easyStoreTaxable: false,
      easyStoreCompareAtMarkupPercent: 35,
      easyStoreBarcodeOptional: true,
      easyStoreFeatureBulletMinChars: 24,
      easyStoreFeatureBulletMaxChars: 30,
      easyStoreSeoTitleMaxChars: 70,
      easyStoreSeoDescriptionMaxChars: 180,
      easyStoreSeoUiFallbackWhenPublicApiIgnoresFields: true,
      coupangAttributeNameMaxChars: 25,
      coupangExcludedRedundantAttributes: ['Parent Manufacturer Part Number', 'Manufacturer Part Number'],
      coupangContentType: 'HTML',
      coupangContentDetailType: 'TEXT',
      coupangContentDetailMustRemainNonEmpty: true,
      physicalImageTransform: 'label-only-with-original-retained',
      physicalImagePlacement: 'description-only-after-completed-images-before-fixed-notices-and-final-promos',
      galleryLastImage: STORE_PROMO_IMAGE_URL,
      descriptionLayoutVersion: DESCRIPTION_LAYOUT_VERSION,
      descriptionLastImageUrls: [...DESCRIPTION_PROMO_IMAGE_URLS],
      retryPolicy: 'same-sku-same-draft-same-stage-only',
      routineConfirmation: 'already-authorized-by-handoff'
    },
    judgmentFields: {
      listingContentMutation: {
        resolver: 'selected-listing-intent',
        required: true,
        intent: clean(snapshot.listingIntent),
        policy: { ...(snapshot.listingIntentPolicy || {}) },
        changeInstructions: clean(snapshot.listingChangeInstructions),
        addVariantRule: 'preserve-existing-and-merge-new-variant-content',
        updateExistingRule: 'replace-only-requested-outdated-content-on-exact-sku-and-platform-id',
        neverCreateDuplicate: true
      },
      imageLocalization: {
        resolver: 'codex-vision', required: true,
        output: ['sourceImageUrl', 'url', 'roles', 'assetFlags'],
        rules: ['zh-TW', 'mainland-terms-to-taiwan', 'remove-or-reflow-cropped-text', 'never-invent-unverified-content'],
        ordinaryDetailMode: 'text-localization-only',
        appliesToRoles: ['localizedDetail', 'specification', 'variantRepresentative'],
        excludesRoles: ['cleanMain', 'brandedHero', 'storefrontPortrait'],
        preserveExactly: [
          'product', 'layout', 'composition', 'background', 'crop', 'aspect-ratio',
          'colors', 'icons', 'information-hierarchy', 'text-position', 'typography-style'
        ],
        allowedMutations: [
          'simplified-to-traditional-chinese',
          'remove-third-party-watermark-or-outbound-seller-information',
          'remove-entire-truncated-text-block-or-retype-only-verified-complete-copy',
          'format-normalization-without-recomposition'
        ],
        forbiddenMutations: [
          'redesign', 'recompose', 'change-background', 'change-product',
          'add-marketing-copy', 'invent-feature', 'reorder-information', 'crop-product'
        ],
        textReplacementMethod: 'ocr-recognize-erase-original-text-and-retype-with-real-traditional-chinese-font',
        handDrawnOrPaintedGlyphsForbidden: true,
        preserveOriginalTypographyCharacterWhenPossible: true,
        blurryTinyOrIncompleteSourceAction: 'find-clearer-complete-source-or-skip',
        blurrySourceUpscalingForbidden: true,
        newMarketingCopyForbidden: true,
        unchangedWhenNoSimplifiedTextOrForbiddenMarks: true,
        failClosedWhenPixelPreservationCannotBeVerified: true
      },
      heroSourceSelection: {
        resolver: 'codex-vision', required: true,
        allowedRoles: ['cleanMain', 'brandedHero', 'storefrontPortrait']
      },
      verifiedProductContent: {
        resolver: 'codex-evidence', required: true,
        output: ['title', 'description', 'brand', 'model', 'verified-features', 'verified-usage', 'verified-specifications', 'fieldEvidence'],
        standardVersion: RICH_CONTENT_STANDARD_VERSION,
        featureTarget: RICH_CONTENT_FEATURE_TARGET,
        usageTarget: RICH_CONTENT_USAGE_TARGET,
        requiredDescriptionSections: ['商品特色', '使用方式／適用情境', '商品規格'],
        fillEveryVerifiableAttribute: true,
        requireExactModelOrBarcodeEvidence: true,
        neverInventToReachTarget: true,
        forbidStoreNameInTitleAndCopy: true,
        fixedDescriptionNoticesBeforeFinalPromos: [...FIXED_DESCRIPTION_NOTICES],
        newProductRule: 'complete-before-first-publish',
        existingProductRule: 'upgrade-in-place-and-preserve-listing-identity',
        genericFallbackIsIncomplete: true,
        writeBackToEveryCaseBeforePreparedSnapshot: true
      },
      categoryAndAttributes: {
        resolver: 'canonical-category-once-then-platform-mapping', required: true,
        scope: 'musical-instruments-and-accessories-only',
        canonicalDecision: { ...(snapshot.canonicalCategoryDecision || {}) },
        neverReclassifyInsideEachPlatform: true
      },
      variantNames: {
        resolver: 'manager-value-first-then-codex', requiredWhen: 'variant-group',
        neverOverrideManagerValue: true
      },
      shippingByDimensions: {
        resolver: 'deterministic-once-before-platform-when-dimensions-known',
        preparedDecision: buildShopeeLogistics(snapshot),
        mapPreparedDecisionToEveryPlatform: true,
        neverRejudgeInsideEachPlatform: true,
        requireEvidenceForOversizeDecision: true
      }
    },
    forbiddenJudgment: [
      'invent-certification', 'invent-brand-or-model', 'invent-feature-or-accessory',
      'change-sku-set', 'change-platform-order', 'create-replacement-on-retry', 'request-routine-second-confirmation'
    ],
    unresolvedAction: 'stop-before-platform-navigation-with-exact-field-reason',
    sourceSnapshotId: clean(snapshot && snapshot.platformImagePlan && snapshot.platformImagePlan.snapshotId)
  };
}

function buildPlatformPageContracts() {
  const common = {
    version: 4,
    observedAt: '2026-08-30',
    cacheScope: 'platform-and-layout-signature',
    selectorStrategy: ['stable-label', 'name', 'data-attribute', 'role', 'relative-section'],
    forbidVolatileElementIdAsOnlySelector: true,
    lightweightProbeBeforeFill: true,
    fullPageInventoryIsOneTimeOnly: true,
    fillFromPreparedPlatformFieldPlan: true,
    rescanCurrentSectionOnlyWhenSignatureChanges: true,
    neverRestartCompletedPlatformStages: true,
    fieldsPreparedBeforeNavigation: true,
    batchExecution: {
      mode: 'section-batch',
      resolveFieldsOncePerSection: true,
      fillStableControlsInSinglePass: true,
      validateStableSectionAfterBatch: false,
      validateDynamicSectionOnceAfterBatch: true,
      dynamicControlsSequentialWithinSection: true,
      imageUploadAsSingleBatch: true,
      neverRescanUnchangedSection: true
    },
    loginProbeBeforeProductNavigation: true,
    resumeSameProductOrDraftAfterLoginRecovery: true,
    loginRecoveryPolicy: {
      automatic: true,
      browserWorkspace: 'codex-in-app-browser-only',
      sourcePriority: [
        'current-authenticated-tab',
        'saved-credentials-in-current-browser',
        'known-platform-entry-from-current-job',
        'previous-successful-route-from-project-context'
      ],
      submitSavedCredentialsWithoutRoutineConfirmation: true,
      deepLinkFailureAloneDoesNotProveLogout: true,
      retryCanonicalEntryBeforeCredentialLogin: true,
      verifyAuthenticatedLandmarkAfterRecovery: true,
      resumeSameJobSkuDraftAndStage: true,
      neverSwitchToPrimaryChrome: true,
      userActionOnlyFor: ['otp', 'captcha', 'saved-credentials-rejected', 'platform-account-disabled']
    },
    newCaseBoundary: {
      resetOncePerDifferentSku: true,
      discardPreviousSearchDrawerAndUnboundDraftState: true,
      bindStartToCurrentProductIdSkuAndSnapshotId: true,
      neverTreatPreviousCaseScreenAsCurrentCaseEvidence: true,
      keepSameSkuSameDraftOnRetry: true
    }
  };
  return {
    momo: {
      ...common, version: 5, routeKey: 'momo-product-create-or-same-draft',
      canonicalEntry: { route: 'B101 新增/管理商品', purpose: 'new-case-start' },
      verifiedFromLivePage: true,
      authenticatedLandmarks: ['momo 店＋管理系統', '商品', 'B101 新增/管理商品'],
      pageSignature: {
        sections: ['基本資料', '銷售資訊', '物流運費', '商品詳細介紹', '其他'],
        stableLandmarks: ['商品名稱', '平台分類', '銷售規格範本', '甲指(第三方)', '發佈商品']
      },
      fieldOrder: [
        'item-number', 'main-images', 'advertisement-image', 'youtube-id', 'brand', 'product-name',
        'platform-category', 'front-hidden', 'regulatory-certifications', 'category-attributes',
        'other-product-information', 'variant-template', 'variant-names-and-values',
        'variant-images', 'variant-stock-price-sku-barcode', 'package-dimensions-and-weight',
        'temperature', 'delivery-methods', 'free-shipping', 'rich-description', 'promotion-material-bank-image',
        'momo-promotion-consent', 'slogan-and-short-features', 'store-category',
        'warranty', 'publish-time', 'submit'
      ],
      batchSections: [
        { key: 'basic-and-media', fields: ['item-number', 'main-images', 'advertisement-image', 'youtube-id', 'brand', 'product-name'] },
        { key: 'taxonomy-and-attributes', fields: ['platform-category', 'front-hidden', 'regulatory-certifications', 'category-attributes', 'other-product-information'], dynamic: true },
        { key: 'variants-and-commerce', fields: ['variant-template', 'variant-names-and-values', 'variant-images', 'variant-stock-price-sku-barcode'] },
        { key: 'shipping', fields: ['package-dimensions-and-weight', 'temperature', 'delivery-methods', 'free-shipping'] },
        { key: 'content-and-publish', fields: ['rich-description', 'promotion-material-bank-image', 'momo-promotion-consent', 'slogan-and-short-features', 'store-category', 'warranty', 'publish-time', 'submit'] }
      ],
      imageConstraints: {
        main: { aspectRatio: '1:1', widthPx: 1000, heightPx: 1000, minimumFileBytes: 38000, maximumFileBytes: 1000000, minimumCount: 1, maximumCount: 6 },
        advertisement: { aspectRatio: '1:1', widthPx: 1000, heightPx: 1000, minimumFileBytes: 38000, maximumFileBytes: 1000000, forbidOverlayTextFrameAndWatermark: true },
        richDescription: { widthPx: 1000, maximumHeightPx: 1500, maximumFileBytes: 500000, maximumCount: 20 },
        promotionMaterialBankRequired: false,
        uniqueDeviceFilenameRequired: true,
        sameNameMaterialBankConflictReuseForbidden: true,
        promotionMaterialMustSurviveDraftReopen: true
      },
      titleConstraints: { maximumCharacters: 60, displayedBrandIsPrependedByPlatform: true, repeatBrandInProductName: false },
      shortFeatureConstraints: { sloganMaximumCharacters: 15, featureMaximumCharacters: 15, featureMaximumCount: 3 },
      otherProductInformationPolicy: {
        purpose: 'category-dependent-facts-and-compliance-not-marketing-copy',
        fillOnlyFromVerifiedEvidence: true,
        neverInventCertificationOriginMaterialOrAccessory: true
      },
      promotionInsertFlow: {
        target: 'rich-description-editor',
        steps: ['prepare-unique-filename', 'focus-exact-text-boundary', 'open-rich-description-upload', 'choose-device-upload', 'set-files', 'wait-cdn-insert', 'save-draft', 'reopen-same-product', 'verify-text-image-order-and-src', 'submit'],
        finalTwoImagesCursorPlacement: 'document-end',
        finalTwoImagesBatchOrder: ['description-promo-1', 'description-promo-2'],
        noTextOrImageAfterSecondFixedImage: true,
        requiredBeforeFirstSubmit: true,
        mainOrAdvertisementImageIsNotEvidence: true,
        persistedEvidence: 'contenteditable-html-img-src'
      },
      firstSubmissionMediaGate: {
        requiredSlots: ['main-images', 'advertisement-image', 'rich-description-images'],
        prepareAllBeforePlatformSubmit: true,
        saveAndVerifySameDraftBeforeFirstSubmit: true,
        missingPromotionErrorIsNeverExpectedControlFlow: true,
        deduplicatePromotionAssetBeforeInsert: true
      },
      draftReopenPersistenceGate: {
        verifyBeforeSubmit: [
          'rich-description-editor-image', 'advertisement-image', 'package-dimensions',
          'package-weight', 'temperature', 'delivery-methods', 'third-party-location-000001'
        ],
        reapplyOnlyMissingFieldsOnSameDraft: true,
        neverCreateReplacementDraft: true
      },
      listingQuotaRecovery: {
        maximumListings: 1000,
        triggerOnlyOnExplicitQuotaError: true,
        releaseExactlyOneSlotAtATime: true,
        candidateOrder: ['zero-stock-no-sales', 'zero-stock-low-sales'],
        preserveZeroStockHighSales: true,
        unknownSalesMeansPreserve: true,
        action: 'temporarily-downlist-never-delete',
        verifyCountDecrementBeforeRetry: true,
        retrySameDraftAfterSlotReleased: true
      },
      exactListSearch: {
        queryBy: ['seller-sku', 'momo-product-number'],
        trigger: 'search-append-control',
        enterKeyAloneIsNotVerification: true,
        maximumQueriesAfterSubmit: 1
      },
      storeCategoryConstraints: { maximumCount: 5, relevantOnly: true, validateBeforeSave: true },
      fixedFields: ['warranty-days-180', 'publish-immediately', 'third-party-location-000001'],
      dynamicFields: ['mapped-leaf-category', 'category-dependent-attributes', 'regulatory-fields-when-verified', 'platform-validation-errors']
    },
    coupang: {
      ...common, version: 4, routeKey: 'coupang-create-via-image-or-exact-existing-listing',
      canonicalEntry: { route: '商品管理/建立商品', purpose: 'new-case-start' },
      verifiedFromLivePage: true,
      inventoryStatus: 'verified-from-live-create-and-existing-edit-flow-2026-08-30',
      authenticatedLandmarks: ['Coupang Wing', '商品管理'],
      loginProbe: { fields: ['輸入帳號', '輸入密碼'], submitLabel: '登入', interactiveAuthenticationMayBeRequired: true },
      pageSignature: {
        sections: ['圖片與類別', '商品資訊產生', '選項與價格庫存', '配送', '商品介紹與合規', '發布'],
        stableLandmarks: ['以圖片建立', '類別', '品牌', '產生商品資訊', '銷售價格', '庫存', '建立產品']
      },
      existingListingEditSignature: {
        sections: ['顯示商品名稱', '產品基本資訊', '產品屬性', '選項', '商品圖片', '詳細說明', '重要商品資訊', '出貨資訊', '退貨資訊'],
        stableLandmarks: ['商品已審核通過', '已寫入HTML', 'PC 預覽', '申請修改'],
        exactIdentityFields: ['Vendor Inventory ID', '賣家商品編號', '型號']
      },
      fieldOrder: [
        'clean-main-image', 'secondary-completed-images', 'music-leaf-category', 'verified-brand-or-no-brand',
        'generate-product-information', 'variant-color', 'variant-quantity', 'variant-size', 'variant-images',
        'sale-price', 'stock', 'seller-sku', 'seller-delivery', 'convenience-store-by-package',
        'preparation-days', 'manual-rich-description', 'tw-general-compliance', 'responsible-seller',
        'origin', 'minor-purchase-and-tax', 'create-product', 'exact-sku-verification'
      ],
      batchSections: [
        { key: 'media-and-taxonomy', fields: ['clean-main-image', 'secondary-completed-images', 'music-leaf-category', 'verified-brand-or-no-brand'], dynamic: true },
        { key: 'generated-information', fields: ['generate-product-information'], dynamic: true },
        { key: 'variants-and-commerce', fields: ['variant-color', 'variant-quantity', 'variant-size', 'variant-images', 'sale-price', 'stock', 'seller-sku'] },
        { key: 'shipping', fields: ['seller-delivery', 'convenience-store-by-package', 'preparation-days'] },
        { key: 'content-compliance-and-publish', fields: ['manual-rich-description', 'tw-general-compliance', 'responsible-seller', 'origin', 'minor-purchase-and-tax', 'create-product', 'exact-sku-verification'] }
      ],
      imageConstraints: {
        firstImageRole: 'cleanMain',
        secondaryRoles: ['cleanMain', 'localizedDetail', 'specification', 'variantRepresentative'],
        maximumCount: 7,
        brandedHeroOnlyWhenGalleryAllowsLogoAndText: true
      },
      generatedOptionRecovery: {
        detect: ['readonly-option-field', 'invalid-generated-option-value'],
        action: 'return-to-image-step-and-regenerate-once-on-same-draft',
        maximumAttempts: 1,
        onlyBeforeVariantCommerceOrContentIsFilled: true,
        neverRegenerateAfterLaterSectionsCompleted: true,
        lateFailureAction: 'repair-current-section-on-same-draft',
        preserveCompletedSections: true
      },
      submissionVerification: {
        successButton: '建立產品',
        acceptedStatuses: ['審核中', '上架'],
        exactSkuLookupMaximum: 1,
        underReviewMeansSubmittedNotActive: true
      },
      existingListingEditFlow: {
        exactSkuAndVendorInventoryIdRequired: true,
        expandAvailableProductAttributesOnce: true,
        fillOnlyVerifiedAttributes: true,
        leaveUnknownAttributesBlank: true,
        verifiedSixStringMapping: {
          unit: '弦', value: 6,
          requiredScopes: ['product-basic-information', 'each-option-attribute-dialog'],
          recheckBothScopesBeforeSubmit: true
        },
        galleryFinalSlot: 'product-listing-store-promo.png',
        htmlEditSequence: ['修改', '寫入固定內容', 'PC 預覽', '儲存', '重開核對', '申請修改'],
        fixedNoticeHeadings: ['實體商品說明', '出貨與保固說明'],
        secondFixedImageMustEndDescription: true,
        submitMayTriggerReviewAndPauseSales: true
      },
      fixedFields: ['warranty-days-180', 'preparation-days-1', 'tw-general', 'minor-purchase-allowed', 'taxable', 'submit-for-review'],
      dynamicFields: ['mapped-music-leaf-category', 'category-dependent-attributes', 'verified-brand', 'origin', 'package-shipping', 'platform-validation-errors']
    },
    easyStore: {
      ...common, routeKey: 'easystore-product-create-or-same-product',
      canonicalEntry: { route: '商品清單/新增商品', purpose: 'new-case-start' },
      verifiedFromLivePage: true,
      authenticatedLandmarks: ['商品管理', '儲存'],
      pageSignature: {
        sections: ['商品基本資料', '商品圖片', '商品款式', '庫存與價格', '配送尺寸重量', 'SEO', '銷售通路'],
        stableLandmarks: ['商品名稱', '商品描述', '上傳圖片', '商品選項', 'SKU', '商品狀態', '儲存']
      },
      fieldOrder: [
        'product-name', 'rich-description', 'gallery-images', 'variant-option-names-and-values',
        'variant-images', 'variant-stock-sku-price-cost-barcode', 'variant-dimensions-and-weight',
        'tax-and-free-shipping', 'inventory-tracking', 'seo-url-and-meta-description',
        'publish-state', 'sales-channels', 'category-brand-vendor-tags-notes', 'save'
      ],
      batchSections: [
        { key: 'core-and-media', fields: ['product-name', 'rich-description', 'gallery-images'] },
        { key: 'variants-and-inventory', fields: ['variant-option-names-and-values', 'variant-images', 'variant-stock-sku-price-cost-barcode'] },
        { key: 'commerce-and-shipping', fields: ['variant-dimensions-and-weight', 'tax-and-free-shipping', 'inventory-tracking'] },
        { key: 'metadata-and-publish', fields: ['seo-url-and-meta-description', 'publish-state', 'sales-channels', 'category-brand-vendor-tags-notes', 'save'], dynamic: true }
      ],
      fixedFields: [
        'publish-immediately', 'taxable-off', 'inventory-tracking-on', 'seo-title-max-70', 'seo-description-max-180',
        'pre-resolved-existing-store-collections', 'exact-brand-only'
      ],
      dynamicFields: ['unmapped-category-exception', 'brand-not-found-exception', 'platform-validation-errors']
    },
    shopee: {
      ...common, routeKey: 'easystore-shopee-channel-sync',
      canonicalEntry: { route: 'EasyStore 官方蝦皮通路商品清單', purpose: 'new-case-start' },
      verifiedFromLivePage: true,
      authenticatedLandmarks: ['Shopee Taiwan', '已連接', '商品'],
      pageSignature: {
        sections: ['EasyStore 商品', '進階商品描述', '蝦皮分類與屬性', '價格與庫存', '圖片與細項', '物流', '發布'],
        stableLandmarks: ['進階商品描述', '使用 EasyStore 的產品描述', '價格調整', '蝦皮分類', '浮水印標題', '狀態']
      },
      fieldOrder: [
        'channel-product', 'advanced-description-capability-probe', 'enable-advanced-description',
        'use-easystore-rich-description', 'shopee-category', 'category-attributes', 'price-adjustment',
        'variant-images', 'prepared-package-weight', 'prepared-logistics', 'prepare-publish', 'publish'
      ],
      batchSections: [
        { key: 'prepared-rich-description', fields: ['advanced-description-capability-probe', 'enable-advanced-description', 'use-easystore-rich-description'], dynamic: true },
        { key: 'taxonomy-and-attributes', fields: ['channel-product', 'shopee-category', 'category-attributes'], dynamic: true },
        { key: 'commerce-and-variants', fields: ['price-adjustment', 'variant-images'] },
        { key: 'shipping', fields: ['prepared-package-weight', 'prepared-logistics'], dynamic: true },
        { key: 'publish', fields: ['prepare-publish', 'publish'] }
      ],
      fixedFields: ['warranty-days-180', 'publish-immediately', 'close-embedded-chat', 'use-prepared-easystore-rich-description-when-supported'],
      dynamicFields: ['advanced-description-account-capability', 'mapped-leaf-category', 'category-dependent-attributes', 'prepared-size-tier', 'platform-validation-errors']
    }
  };
}

function buildPreparedPlatformFieldPlan(snapshot) {
  const shipping = buildShopeeLogistics(snapshot);
  const coupangShipping = buildCoupangShipping(snapshot);
  const momoShipping = buildMomoShipping(snapshot);
  const momoFeatures = snapshot.momoShortFeatures && typeof snapshot.momoShortFeatures === 'object'
    ? {
      ...snapshot.momoShortFeatures,
      slogan: Array.from(clean(snapshot.momoShortFeatures.slogan)).slice(0, 15).join(''),
      featureTexts: (Array.isArray(snapshot.momoShortFeatures.featureTexts)
        ? snapshot.momoShortFeatures.featureTexts : [])
        .map((value) => Array.from(clean(value)).slice(0, 15).join('')).filter(Boolean).slice(0, 3)
    }
    : momoShortFeaturePlan(snapshot.description, snapshot.momoSlogan);
  const preparedMomoMarketPrice = momoMarketPrice(snapshot);
  const easyStoreCollections = resolveEasyStoreCollectionNames(snapshot);
  const packageWeightKg = numberOrNull(snapshot.packageWeightKg);
  const packageWeightGrams = packageWeightKg !== null && packageWeightKg > 0
    ? Math.max(1, Math.round(packageWeightKg * 1000)) : null;
  const variantGroup = snapshot.variantGroupEnabled ? {
    enabled: true,
    attributeName: clean(snapshot.variantGroupAttributeName),
    items: (Array.isArray(snapshot.variantGroupVariants) ? snapshot.variantGroupVariants : []).map((row) => ({
      productId: clean(row && row.productId),
      sku: normalizeSku(row && row.sku),
      name: clean(row && row.name),
      value: clean(row && row.attributeValue),
      imageUrl: safeHttpUrl(row && row.imageUrl),
      barcode: clean(row && row.barcode),
      stock: Math.max(0, Math.round(numberOrNull(row && row.stock) || 0)),
      easyStorePrice: numberOrNull(row && row.easyStorePrice),
      momoPrice: numberOrNull(row && row.momoPrice),
      coupangPrice: numberOrNull(row && row.coupangPrice)
    }))
  } : { enabled: false, attributeName: '', items: [] };
  const common = {
    sku: snapshot.sku,
    workflowPurpose: clean(snapshot.workflowPurpose) || 'standard-listing',
    listingIntent: clean(snapshot.listingIntent),
    listingIntentPolicy: { ...(snapshot.listingIntentPolicy || {}) },
    listingChangeInstructions: clean(snapshot.listingChangeInstructions),
    title: snapshot.title,
    description: snapshot.description,
    descriptionContentStatus: { ...(snapshot.descriptionContentStatus || {}) },
    stock: snapshot.stock,
    warrantyDays: 180,
    publishImmediately: true,
    physicalImageUrls: normalizeUrls(snapshot.physicalImageUrls, 20),
    physicalImagePolicy: { ...(snapshot.physicalImagePolicy || {}) },
    descriptionLayout: { ...(snapshot.platformDescriptionContentPlan && snapshot.platformDescriptionContentPlan.layout || {}) },
    variantGroup,
    package: {
      lengthCm: snapshot.packageLengthCm,
      widthCm: snapshot.packageWidthCm,
      heightCm: snapshot.packageHeightCm,
      weightKg: snapshot.packageWeightKg,
      shippingDecision: snapshot.shippingDecision
    }
  };
  const momoMainImageUrl = safeHttpUrl(snapshot.platformImagePlan
    && snapshot.platformImagePlan.momo && snapshot.platformImagePlan.momo.imageUrls
    && snapshot.platformImagePlan.momo.imageUrls[0]);
  const momoPromotionImageUrl = safeHttpUrl(snapshot.momoSpecialPromotionImageUrl);
  const momoPromotionFingerprint = momoPromotionImageUrl
    ? crypto.createHash('sha256').update(momoPromotionImageUrl).digest('hex').slice(0, 12) : '';
  const momoPromotionAssetFilename = momoPromotionFingerprint
    ? `${normalizeSku(snapshot.sku) || 'product'}-momo-promo-${momoPromotionFingerprint}.jpg` : '';
  const momoMediaReadyBeforeFirstSubmit = Boolean(momoMainImageUrl && momoPromotionImageUrl);
  return {
    version: 21,
    immutableForJob: true,
    preparedBeforePlatformNavigation: true,
    platformOrder: [...PLATFORM_EXECUTION_ORDER],
    executionGraph: {
      mode: 'staggered-parallel',
      parallelRoots: [...PARALLEL_ROOT_PLATFORMS],
      dependencies: { momo: [], coupang: [], easyStore: [], shopee: ['easyStore'] },
      shopeeStartsImmediatelyAfterEasyStoreVerified: true,
      shopeeDoesNotWaitForMomoOrCoupang: true,
      completionRequires: [...PLATFORM_EXECUTION_ORDER]
    },
    browserScheduler: {
      interactionConcurrency: 1,
      releaseInteractionLockDuringWait: true,
      sessionHeartbeatSeconds: 180,
      keepAuthenticatedAnchorTabPerPlatform: true,
      loginRecovery: {
        automatic: true,
        consultKnownRoutesAndPriorSuccessfulProjectContext: true,
        useSavedCredentialsBeforeRequestingUser: true,
        currentAuthenticatedTabHasPriority: true,
        deepLinkFailureAloneDoesNotProveLogout: true,
        retryCanonicalEntryBeforeCredentialLogin: true,
        verifyAuthenticatedLandmarkAfterRecovery: true,
        resumeSameJobAndDraft: true,
        stopOnlyForOtpCaptchaOrRejectedCredentials: true
      },
      postSubmitRepair: {
        verifyRequiredFieldsOnExactSku: true,
        reapplyOnlyMissingFieldsToSameListing: true,
        resubmitAndVerifyAgain: true,
        neverCreateReplacementListing: true
      }
    },
    sharedImageAssetStandard: { ...(snapshot.imagePolicy && snapshot.imagePolicy.sharedDeliveryAssetStandard || {}) },
    storefrontPortraitAssetStandard: { ...(snapshot.imagePolicy && snapshot.imagePolicy.storefrontPortraitAssetStandard || {}) },
    brandTemplateContract: JSON.parse(JSON.stringify(snapshot.imagePolicy && snapshot.imagePolicy.brandTemplateContract || BRAND_TEMPLATE_CONTRACT)),
    sourceImageNormalization: { ...(snapshot.imagePolicy && snapshot.imagePolicy.sourceNormalization || {}) },
    ordinaryDetailImageLocalization: { ...(
      snapshot.decisionContract && snapshot.decisionContract.judgmentFields
      && snapshot.decisionContract.judgmentFields.imageLocalization || {}
    ) },
    decisionContractVersion: Number(snapshot.decisionContract && snapshot.decisionContract.version) || 0,
    canonicalCategoryDecision: { ...(snapshot.canonicalCategoryDecision || {}) },
    canonicalShippingDecision: { ...shipping },
    platformPageContracts: buildPlatformPageContracts(),
    batchFieldExecution: {
      mode: 'section-batch',
      resolveFieldsOncePerSection: true,
      stableNativeControlsSinglePass: true,
      dynamicControlsSequentialWithinSection: true,
      validateStableSectionAfterBatch: false,
      validateDynamicSectionOnceAfterBatch: true,
      imagesSingleBatchPerPlatform: true,
      unchangedSectionsNeverRescanned: true
    },
    common,
    momo: {
      fixedFields: {
        publishImmediately: true,
        warrantyEnabled: true,
        warrantyDays: 180,
        deliveryMethod: MOMO_THIRD_PARTY_DELIVERY.method,
        thirdPartyLocationCode: MOMO_THIRD_PARTY_DELIVERY.locationCode,
        carrier: MOMO_THIRD_PARTY_DELIVERY.carrier,
        promotionImageRequiredBeforeFirstSubmit: true,
        promotionImageInsertionTarget: 'rich-description-editor',
        promotionImagePersistenceEvidence: 'contenteditable-html-img-src',
        advertisementImageRequiredBeforeFirstSubmit: true,
        firstSubmitBlockedUntilAllMediaSlotsReady: true,
        storeCategoryMaximumCount: 5
      },
      preparedFields: {
        sku: snapshot.sku,
        itemNumber: snapshot.sku,
        manufacturerProductNumber: clean(snapshot.model) || snapshot.sku,
        barcode: clean(snapshot.barcode),
        brand: {
          value: clean(snapshot.brand),
          mode: 'exact-verified-brand',
          neverApproximate: true,
          missingExactBrandAction: 'stop-for-brand-resolution'
        },
        title: momoProductName(snapshot.momoGoodsName, snapshot.brand),
        titlePolicy: {
          maximumCharacters: 60,
          platformDisplaysSelectedBrandBeforeName: true,
          repeatBrandInsideName: false
        },
        slogan: momoFeatures.slogan,
        shortFeatures: momoFeatures,
        descriptionHtml: snapshot.momoHtml,
        descriptionDelivery: { ...(snapshot.platformDescriptionContentPlan && snapshot.platformDescriptionContentPlan.momo || {}) },
        price: snapshot.momoPrice,
        marketPrice: preparedMomoMarketPrice,
        marketPricePolicy: {
          explicitVerifiedValueHasPriority: true,
          fallbackMarkupRate: 0.35,
          allowedManagerRange: { minimum: 0.30, maximum: 0.40 },
          mustExceedSalePrice: true
        },
        stock: snapshot.stock,
        categoryCode: snapshot.momoCategoryCode,
        categoryAttributes: normalizeMomoAttributes(snapshot.momoAttributeValues),
        otherProductInformation: {
          values: normalizeMomoAttributes(snapshot.momoOtherProductInformation),
          purpose: 'category-dependent-product-facts-and-compliance',
          marketingCopyForbidden: true,
          fillOnlyFromVerifiedEvidence: true,
          neverGuess: ['NCC', 'BSMI', '產地', '材質', '配件', '認證字號'],
          unresolvedRequiredFieldAction: 'stop-before-submit-with-exact-label'
        },
        imageUrls: galleryImagesWithStorePromo(snapshot.platformImagePlan.momo.imageUrls, 6),
        advertisementImageUrl: momoMainImageUrl,
        promotionImageUrl: momoPromotionImageUrl,
        promotionImageReady: Boolean(momoPromotionImageUrl),
        firstSubmitMediaGate: {
          ready: momoMediaReadyBeforeFirstSubmit,
          requiredSlots: ['main-images', 'advertisement-image', 'rich-description-promotion-image'],
          mainImageUrls: galleryImagesWithStorePromo(snapshot.platformImagePlan.momo.imageUrls, 6),
          advertisementImageUrl: momoMainImageUrl,
          promotionImage: {
            url: momoPromotionImageUrl,
            assetFilename: momoPromotionAssetFilename,
            assetFingerprint: momoPromotionFingerprint,
            uploadTarget: 'material-bank',
            insertTarget: 'rich-description-editor',
            insertBeforeFirstSubmit: true,
            saveSameDraftBeforeSubmit: true,
            verifyPersistedOnceBeforeSubmit: true,
            neverWaitForPlatformMissingPromotionError: true,
            deduplicateBeforeInsert: true
          }
        },
        shipping: momoShipping,
        storeCategoryNames: Array.isArray(snapshot.momoStoreCategoryNames)
          ? snapshot.momoStoreCategoryNames.slice(0, 5) : [],
        warranty: { enabled: true, days: 180 },
        capacityGate: {
          enabled: true,
          maximumListings: Number(snapshot.momoCatalogPolicy && snapshot.momoCatalogPolicy.maximumListings) || 1000,
          targetStock: Math.max(0, Math.round(numberOrNull(snapshot.stock) || 0)),
          checkBeforeFirstPublish: true,
          trigger: 'positive-stock-new-listing-and-active-count-at-capacity',
          action: 'temporarily-downlist-one-safe-zero-stock-item',
          candidatePolicy: {
            activeAndZeroStockOnly: true,
            excludeCurrentSkuListingAndBatch: true,
            excludeProtectedPinnedAndPendingOrderListings: true,
            preserveListingsWithSales: true,
            preferExplicitLowPriorityThenZeroSalesThenOldestUpdate: true
          },
          verification: ['candidate-status-is-downlisted', 'active-count-below-maximum'],
          resumeSamePreparedDraft: true,
          neverDelete: true,
          neverCreateReplacementDraft: true,
          noSafeCandidateAction: 'stop-with-exact-reason'
        },
        storeCategoryPolicy: {
          maximumCount: 5,
          relevantOnly: true,
          resolveFromAuthenticatedAccountOptionsOnce: true,
          matchUsing: ['canonical-category', 'verified-product-type', 'title'],
          userSpecificAndNotInferableBeforeLogin: true
        },
        variantGroup: variantGroup.enabled ? {
          attributeName: variantGroup.attributeName,
          items: variantGroup.items.map((row) => ({ ...row, price: row.momoPrice }))
        } : null
      },
      dynamicOnly: [
        'official-category-recommendation-when-code-is-empty',
        'category-dependent-attributes',
        'authenticated-account-store-category-options',
        'platform-validation-errors'
      ]
    },
    coupang: {
      fixedFields: {
        publishImmediately: true,
        submitAction: 'create-product',
        warrantyDays: 180,
        preparationDays: 1,
        complianceModel: 'TW_General',
        responsibleSeller: '尚品樂器行',
        minorPurchaseAllowed: true,
        taxable: true
      },
      preparedFields: {
        sku: snapshot.sku,
        title: snapshot.coupangTitle,
        descriptionHtml: snapshot.coupangDescriptionHtml,
        contentPayload: {
          contentsType: 'HTML',
          detailType: 'TEXT',
          preserveNonEmptyContentWhenRemovingImages: true
        },
        descriptionDelivery: { ...(snapshot.platformDescriptionContentPlan && snapshot.platformDescriptionContentPlan.coupang || {}) },
        price: snapshot.coupangPrice,
        stock: snapshot.stock,
        categoryCode: snapshot.coupangCategoryCode,
        categoryResolution: { ...(snapshot.canonicalCategoryDecision || {}) },
        brand: {
          value: snapshot.brand,
          mode: snapshot.brand ? 'verified-brand' : 'no-brand',
          useNoBrandOnlyWhenUnbrandedOrVerifiedBrandRejected: true,
          recordPlatformRejectionBeforeFallback: true
        },
        model: snapshot.model,
        variantDefaults: {
          optionLabel: snapshot.variantAttributeValue || snapshot.color || snapshot.model || '單一規格',
          color: snapshot.color,
          quantity: 1,
          sizePolicy: 'verified-value-else-Free-only-when-required',
          sellerSku: snapshot.sku,
          price: snapshot.coupangPrice,
          stock: snapshot.stock
        },
        attributePolicy: {
          maximumNameCharacters: 25,
          excludeRedundantNames: ['Parent Manufacturer Part Number', 'Manufacturer Part Number'],
          retainModelAndSkuFields: true,
          fillOnlyVerifiedFacts: true,
          leaveUnknownFactsBlank: true,
          verifiedSixStringMapping: {
            field: '吉他琴橋線(弦)數', unit: '弦', value: 6,
            requiredScopes: ['product-basic-information', 'each-option-attribute-dialog']
          }
        },
        existingListingEdit: {
          preserveVendorInventoryId: true,
          galleryStorePromoMustBeLast: true,
          htmlEditorRowLandmark: '已寫入HTML',
          htmlPreviewAction: 'PC 預覽',
          fixedNoticeHeadings: ['實體商品說明', '出貨與保固說明'],
          noContentAfterSecondFixedImage: true,
          submitAction: '申請修改',
          optionAttributeEditAction: '編輯',
          saveEachOptionAttributeBeforeSubmit: true,
          recheckProductAndOptionAttributesBeforeSubmit: true,
          successLandmark: '修改申請完成'
        },
        shipping: coupangShipping,
        imageUrls: galleryImagesWithStorePromo(snapshot.platformImagePlan.coupang.imageUrls),
        variantGroup: variantGroup.enabled ? {
          attributeName: variantGroup.attributeName,
          items: variantGroup.items.map((row) => ({ ...row, price: row.coupangPrice }))
        } : null
      },
      interactionPolicy: {
        generateProductInformationMaximumAttempts: 2,
        regenerateOnlyWhenOptionFieldsAreReadonlyOrInvalid: true,
        regenerateOnlyBeforeVariantCommerceOrContentIsFilled: true,
        neverRegenerateAfterLaterSectionsCompleted: true,
        lateFailureAction: 'repair-current-section-on-same-draft',
        preserveCompletedSections: true,
        resumeSameDraft: true,
        exactSkuVerificationMaximum: 1,
        neverSearchByTitle: true,
        existingListingEditMustRemainOnSameVendorInventoryId: true,
        previewSaveAndReopenHtmlBeforeSubmit: true,
        optionValidationRecoveryStaysOnSameListing: true,
        finalExactSkuVerificationRequiresSameVendorInventoryId: true
      },
      dynamicOnly: ['official-category-recommendation-when-code-is-empty', 'category-dependent-attributes', 'verified-origin', 'platform-validation-errors']
    },
    easyStore: {
      fixedFields: {
        publishImmediately: true,
        inventoryManagement: 'easystore',
        shippingRequired: true,
        categoryAndBrandPreparedBeforeNavigation: true,
        exactBrandOnly: true,
        neverUseApproximateBrand: true
      },
      preparedFields: {
        sku: snapshot.sku,
        title: snapshot.title,
        descriptionHtml: snapshot.bodyHtml,
        descriptionDelivery: { ...(snapshot.platformDescriptionContentPlan && snapshot.platformDescriptionContentPlan.easyStore || {}) },
        price: snapshot.easyStorePrice,
        stock: snapshot.stock,
        collectionNames: easyStoreCollections,
        categoryResolution: {
          source: snapshot.easyStoreCollectionNames && snapshot.easyStoreCollectionNames.length ? 'explicit-case-selection' : 'fixed-catalog-keyword-map',
          resolvedBeforeNavigation: easyStoreCollections.length > 0,
          availableCollectionNames: [...EASYSTORE_COLLECTION_CATALOG]
        },
        brand: {
          value: snapshot.brand,
          mode: snapshot.brand ? 'exact-brand' : 'blank-until-verified',
          createOnlyExactVerifiedBrand: true,
          neverUseApproximateBrand: true
        },
        imageUrls: galleryImagesWithStorePromo(snapshot.platformImagePlan.easyStore.imageUrls),
        variantGroup: variantGroup.enabled ? {
          attributeName: variantGroup.attributeName,
          items: variantGroup.items.map((row) => ({ ...row, price: row.easyStorePrice }))
        } : null
      },
      dynamicOnly: ['unmapped-category-exception', 'brand-not-found-exception', 'api-validation-errors']
    },
    shopee: {
      fixedFields: {
        workspace: 'easystore-shopee-channel-sync',
        publishImmediately: true,
        warrantyDays: 180,
        neverOpenDirectSellerEditor: false,
        verifyInShopeeSellerCenterAfterEasyStoreSync: true,
        directSellerEditorFallbackWhenDescriptionImagesMissing: true,
        sellerCenterDescriptionImageCountMustPersistAfterReload: true,
        easyStorePreviewIsNotFinalShopeeEvidence: true,
        startImmediatelyAfterEasyStoreVerified: true,
        doNotWaitForMomoOrCoupang: true,
        closeEmbeddedChatBeforeFormInteraction: true,
        variantImageSource: 'existing-easystore-completed-gallery',
        neverOpenNativeFilePickerForVariantImages: true,
        completeVariantImagesBeforePreparePublish: true,
        advancedDescription: {
          mode: 'seller-center-native-file-upload-interleaved',
          preparedBeforeNavigation: true,
          skipEasyStoreDescriptionImport: true,
          transferImagesThroughShopeeNativeUploader: true,
          memoryOnlyImageStaging: false,
          desktopDownloadRequired: true,
          dedicatedLocalStagingDirectoryRequired: true,
          uploadEntry: '商品描述/新增圖片/從電腦裝置上傳',
          deleteLocalStagingOnlyAfterReloadVerification: true,
          neverDeleteUntrackedUserFiles: true,
          expectedEditorImageCountSource: 'prepared-description-images',
          rejectZeroImageDescriptionBeforePublish: true,
          requiredFirstImageRole: 'brandedHero',
          fixedLastTwoImageCount: 2,
          platformMaximumImageCount: 12,
          imagePreflight: { ...SHOPEE_IMPORTED_DESCRIPTION_IMAGE_STANDARD },
          requireTextAndEveryPreparedImageBeforePublish: true,
          replaceSellerEditorWithPreparedTextBlocks: true,
          uploadPreparedImagesAtPlannedTextBoundaries: true,
          rejectDataAndBlobImagesBeforePublish: true,
          requireExactPreparedImageCountAndOrder: true,
          placement: 'interleaved-fixed-layout-v1',
          buttonClickAloneIsNeverSuccess: true,
          requireShopeeSellerCenterReloadEvidence: true,
          neverAnalyzeOrRewriteInsideShopee: true
        }
      },
      preparedFields: {
        sku: snapshot.sku,
        title: snapshot.shopeeTitle,
        description: snapshot.shopeeDescription,
        advancedDescription: { ...(snapshot.shopeeAdvancedDescription || {}) },
        priceAdjustment: {
          enabled: true,
          synchronizeWithEasyStorePrice: true,
          doNotSetAdjustmentModeOrValue: true
        },
        descriptionDelivery: { ...(snapshot.platformDescriptionContentPlan && snapshot.platformDescriptionContentPlan.shopee || {}) },
        price: snapshot.easyStorePrice,
        stock: snapshot.stock,
        categoryPath: snapshot.shopeeCategoryPath,
        attributes: snapshot.shopeeAttributeValues,
        packageWeightGrams,
        logistics: shipping,
        imageUrls: galleryImagesWithStorePromo(snapshot.platformImagePlan.shopee.imageUrls),
        variantGroup: variantGroup.enabled ? {
          attributeName: variantGroup.attributeName,
          items: variantGroup.items.map((row) => ({ ...row, price: row.easyStorePrice }))
        } : null
      },
      dynamicOnly: ['advanced-description-account-capability', 'category-dependent-attributes', 'platform-validation-errors']
    }
  };
}

function variantGroupContextEntry(context, productId) {
  if (!context) return {};
  if (context instanceof Map) return context.get(clean(productId)) || {};
  return context[clean(productId)] || {};
}

function variantPriceForPlatform(product, listingCase, platformKey) {
  const source = product && typeof product === 'object' ? product : {};
  const prepared = listingCase && typeof listingCase === 'object' ? listingCase : {};
  const casePrice = prepared.priceSnapshot && typeof prepared.priceSnapshot === 'object'
    ? numberOrNull(prepared.priceSnapshot[platformKey]) : null;
  const directField = platformKey === 'easyStore' ? 'easyStorePrice' : `${platformKey}Price`;
  const direct = numberOrNull(source[directField]);
  return direct ?? casePrice
    ?? numberOrNull(source.sharedOnlinePrice)
    ?? numberOrNull(source.onlinePrice)
    ?? numberOrNull(source.storePrice);
}

function buildVariantGroupRows(productId, product, listingCase, finalizedMediaSnapshot, variantGroupContext) {
  if (!(clean(listingCase && listingCase.listingMode) !== 'add-variant'
    && listingCase && listingCase.variantGroupEnabled === true)) return [];
  const mediaCases = new Map((Array.isArray(finalizedMediaSnapshot && finalizedMediaSnapshot.cases)
    ? finalizedMediaSnapshot.cases : []).map((row) => [clean(row && row.productId), row || {}]));
  const configuredItems = Array.isArray(listingCase.variantGroupItems) ? listingCase.variantGroupItems : [];
  const definitions = [{
    productId: clean(productId),
    attributeValue: clean(listingCase.variantGroupPrimaryValue),
    sourceImageUrl: safeHttpUrl(listingCase.variantGroupPrimaryImageUrl),
    root: true
  }].concat(configuredItems.map((item) => ({
    productId: clean(item && item.productId),
    attributeValue: clean(item && item.attributeValue),
    sourceImageUrl: safeHttpUrl(item && Array.isArray(item.imageUrls) && item.imageUrls[0]),
    root: false
  })));
  const seenIds = new Set();
  const seenSkus = new Set();
  const seenValues = new Set();
  return definitions.map((definition) => {
    if (!definition.productId || seenIds.has(definition.productId)) throw new Error('同款多細項案件含有空白或重複的商品 ID。');
    seenIds.add(definition.productId);
    const contextEntry = definition.root
      ? { product, listingCase }
      : variantGroupContextEntry(variantGroupContext, definition.productId);
    const variantProduct = contextEntry.product && typeof contextEntry.product === 'object' ? contextEntry.product : {};
    const variantCase = contextEntry.listingCase && typeof contextEntry.listingCase === 'object' ? contextEntry.listingCase : {};
    const media = mediaCases.get(definition.productId) || {};
    const sourceImageUrl = safeHttpUrl(media.representativeSourceImageUrl) || definition.sourceImageUrl;
    const imageUrl = safeHttpUrl(media.representativeCompletedImageUrl);
    const sku = normalizeSku(variantProduct.internalSku || variantProduct.sku || variantCase.productSku || (definition.root && listingCase.productSku));
    const attributeValue = definition.attributeValue || clean(variantCase.variantAttributeValue);
    const skuKey = sku.toLowerCase();
    const valueKey = attributeValue.toLowerCase();
    if (!sku || seenSkus.has(skuKey)) throw new Error('同款多細項案件含有空白或重複的 SKU。');
    if (!attributeValue || seenValues.has(valueKey)) throw new Error('同款多細項案件含有空白或重複的細項名稱。');
    seenSkus.add(skuKey);
    seenValues.add(valueKey);
    return {
      productId: definition.productId,
      sku,
      name: clean(variantProduct.internalName || variantProduct.originalName || variantProduct.name || variantCase.productName),
      attributeValue,
      sourceImageUrl,
      imageUrl,
      barcode: clean(variantProduct.barcode || variantCase.barcode),
      stock: Math.max(0, Math.round(numberOrNull(variantProduct.currentStock) ?? numberOrNull(variantCase.stockSnapshot) ?? 0)),
      costPrice: numberOrNull(variantProduct.latestPurchaseCost || variantProduct.averageCost),
      storePrice: numberOrNull(variantProduct.storePrice || variantProduct.originalSalePrice),
      easyStorePrice: variantPriceForPlatform(variantProduct, variantCase, 'easyStore'),
      momoPrice: variantPriceForPlatform(variantProduct, variantCase, 'momo'),
      coupangPrice: variantPriceForPlatform(variantProduct, variantCase, 'coupang')
    };
  });
}

function buildListingSnapshot(productId, product, listingCase, variantParentProduct = null, variantParentListingCase = null, finalizedMediaSnapshot = null, variantGroupContext = null) {
  const listingIntent = normalizeListingIntent(listingCase, product);
  const intentPolicy = listingIntentPolicy(listingIntent);
  const listingTargetScope = normalizeListingTargetScope(listingCase && listingCase.listingTargetScope);
  const selectedPlatforms = listingTargetPlatforms(listingTargetScope);
  const listingMode = listingIntent === 'add-variant' ? 'add-variant'
    : listingIntent === 'merge-existing' ? 'merge-existing' : 'independent';
  const parentProduct = variantParentProduct && typeof variantParentProduct === 'object' ? variantParentProduct : {};
  const parentPlatformMappings = parentProduct.platformMappings && typeof parentProduct.platformMappings === 'object'
    ? parentProduct.platformMappings : {};
  const parentPlatformListingStatus = parentProduct.platformListingStatus && typeof parentProduct.platformListingStatus === 'object'
    ? parentProduct.platformListingStatus : {};
  const listingIdentityProduct = listingMode === 'add-variant' ? { platformMappings: parentPlatformMappings, platformListingStatus: parentPlatformListingStatus } : product;
  const existingPlatformListingIds = {
    easyStore: platformListingIds(listingIdentityProduct, 'easyStore'),
    shopee: platformListingIds(listingIdentityProduct, 'shopee'),
    momo: platformListingIds(listingIdentityProduct, 'momo'),
    coupang: platformListingIds(listingIdentityProduct, 'coupang')
  };
  const shopeeExistingListingIds = existingPlatformListingIds.shopee;
  const description = listingMode === 'add-variant'
    ? mergedVariantListingDescription(variantParentListingCase, listingCase)
    : listingDescription(listingCase);
  const descriptionContentStatus = listingDescriptionContentStatus({ productDescription: description });
  const variantGroupEnabled = ['create-group', 'merge-existing'].includes(listingIntent);
  const variantParentSourceImageUrl = listingMode === 'add-variant' ? safeHttpUrl(listingCase.variantParentImageUrl) : '';
  const variantChildSourceImageUrl = listingMode === 'add-variant' ? safeHttpUrl(listingCase.variantChildImageUrl) : '';
  const variantGroupPrimarySourceImageUrl = variantGroupEnabled ? safeHttpUrl(listingCase.variantGroupPrimaryImageUrl) : '';
  const variantParentImageUrl = listingMode === 'add-variant'
    ? localizedRepresentativeImage(variantParentListingCase, variantParentSourceImageUrl) : '';
  const variantChildImageUrl = listingMode === 'add-variant'
    ? localizedRepresentativeImage(listingCase, variantChildSourceImageUrl) : '';
  let variantGroupPrimaryImageUrl = variantGroupEnabled
    ? localizedRepresentativeImage(listingCase, variantGroupPrimarySourceImageUrl) : '';
  const variantGroupVariants = buildVariantGroupRows(
    productId, product, listingCase, finalizedMediaSnapshot, variantGroupContext
  );
  if (variantGroupEnabled && variantGroupVariants.length) {
    variantGroupPrimaryImageUrl = safeHttpUrl(variantGroupVariants[0].imageUrl);
  }
  const platformImagePlan = preparedPlatformImagePlan(listingCase, finalizedMediaSnapshot);
  const easyStoreImageSource = platformImagePlan.easyStore.ready
    ? platformImagePlan.easyStore.imageUrls
    : prioritizedListingImageUrls(listingCase);
  const imageAllocation = listingImageAllocation(easyStoreImageSource);
  const images = imageAllocation.galleryImages;
  const physicalImageUrls = listingMode === 'add-variant'
    ? normalizeUrls([
      ...listingCasePhysicalImageUrls(variantParentListingCase, finalizedMediaSnapshot, listingCase.variantParentProductId),
      ...listingCasePhysicalImageUrls(listingCase, finalizedMediaSnapshot, productId)
    ], 20)
    : listingPhysicalImageUrls(listingCase, finalizedMediaSnapshot);
  const normalDescriptionImageUrls = listingMode === 'add-variant'
    ? normalizeUrls([
      ...listingCaseDetailImageUrls(variantParentListingCase, finalizedMediaSnapshot, listingCase.variantParentProductId),
      ...listingCaseDetailImageUrls(listingCase, finalizedMediaSnapshot, productId)
    ], 19)
    : imageAllocation.descriptionImages;
  const descriptionHeroImageUrl = safeHttpUrl(
    platformImagePlan.shopee && platformImagePlan.shopee.imageUrls && platformImagePlan.shopee.imageUrls[0]
  ) || safeHttpUrl(
    platformImagePlan.easyStore && platformImagePlan.easyStore.imageUrls && platformImagePlan.easyStore.imageUrls[0]
  ) || safeHttpUrl(normalDescriptionImageUrls[0]);
  const descriptionImageUrls = normalizeUrls([
    descriptionHeroImageUrl,
    ...normalDescriptionImageUrls.filter((url) => url !== descriptionHeroImageUrl),
    ...physicalImageUrls
  ], 10);
  const momoSpecialPromotionImageUrl = platformImagePlan.momo.promotionImageReady
    ? platformImagePlan.momo.promotionImageUrl : '';
  const descriptionHtml = appendShopDescriptionImages(productDescriptionToSafeHtml(description), descriptionImageUrls);
  const brandCreativeStyleAssignment = listingBrandCreative.assignment(
    listingCase && listingCase.brandCreativeStyleAssignment,
    `${clean(productId)}|${normalizeSku(product.internalSku || product.sku || listingCase.productSku)}`
  );
  const snapshot = {
    productId: clean(productId),
    workflowPurpose: clean(listingCase.workflowPurpose) === DESCRIPTION_MEDIA_REFRESH_PURPOSE ? DESCRIPTION_MEDIA_REFRESH_PURPOSE : 'standard-listing',
    listingIntent,
    listingIntentPolicy: intentPolicy,
    listingChangeInstructions: clean(listingCase.listingChangeInstructions),
    listingMode,
    brandCreativeStyleAssignment,
    variantParentProductId: listingMode === 'add-variant' ? clean(listingCase.variantParentProductId) : '',
    variantParentSku: listingMode === 'add-variant' ? normalizeSku(parentProduct.internalSku || parentProduct.sku || listingCase.variantParentSku) : '',
    variantParentName: listingMode === 'add-variant' ? clean(parentProduct.internalName || parentProduct.originalName || parentProduct.name || listingCase.variantParentName) : '',
    variantAttributeName: listingMode === 'add-variant' ? clean(listingCase.variantAttributeName) : '',
    variantParentAttributeValue: listingMode === 'add-variant' ? clean(listingCase.variantParentAttributeValue) : '',
    variantAttributeValue: listingMode === 'add-variant' ? clean(listingCase.variantAttributeValue) : '',
    variantParentSourceImageUrl,
    variantChildSourceImageUrl,
    variantParentImageUrl,
    variantChildImageUrl,
    variantGroupEnabled,
    variantGroupAttributeName: variantGroupEnabled ? clean(listingCase.variantGroupAttributeName) : '',
    variantGroupVariants,
    variantGroupPrimarySourceImageUrl,
    variantGroupPrimaryImageUrl,
    variantParentPlatformMappings: listingMode === 'add-variant' ? parentPlatformMappings : {},
    variantParentPlatformListingStatus: listingMode === 'add-variant' ? parentPlatformListingStatus : {},
    variantParentEasyStoreProductId: listingMode === 'add-variant' ? clean(platformListingIds(listingIdentityProduct, 'easyStore')[0]) : '',
    sku: normalizeSku(product.internalSku || product.sku || listingCase.productSku),
    title: listingName(product, listingCase).slice(0, 255),
    description,
    descriptionContentStatus,
    bodyHtml: descriptionHtml,
    richContentStandard: richContentLifecycle(listingIntent, descriptionContentStatus),
    images,
    productImageUrls: imageAllocation.productImages,
    descriptionHeroImageUrl,
    descriptionImageUrls,
    physicalImageUrls,
    physicalImagePolicy: {
      preserveOriginal: true,
      customerFacingDerivative: 'watermark-only',
      labelText: '柚子樂器｜實體圖',
      aiEditingForbidden: true,
      placement: 'description-only-after-completed-images-before-fixed-notices-and-final-promos',
      neverUseAsMainImage: true,
      includedCount: descriptionImageUrls.filter((url) => physicalImageUrls.includes(url)).length,
      storedCount: physicalImageUrls.length
    },
    existingPlatformListingIds,
    platformImagePlan,
    category: clean(listingCase.category || product.category),
    easyStoreCollectionNames: (Array.isArray(listingCase.easyStoreCollectionNames)
      ? listingCase.easyStoreCollectionNames : [])
      .map(clean).filter((name) => EASYSTORE_COLLECTION_CATALOG.includes(name)),
    brand: clean(listingCase.brand || product.brand),
    model: clean(listingCase.model || product.model),
    barcode: clean(listingCase.barcode || product.barcode),
    stock: Math.max(0, Math.round(numberOrNull(product.currentStock) || 0)),
    costPrice: numberOrNull(product.latestPurchaseCost || product.averageCost),
    storePrice: numberOrNull(product.storePrice || product.originalSalePrice),
    easyStorePrice: numberOrNull(product.easyStorePrice != null ? product.easyStorePrice : listingCase.priceSnapshot && listingCase.priceSnapshot.easyStore) ?? numberOrNull(product.sharedOnlinePrice != null ? product.sharedOnlinePrice : product.onlinePrice != null ? product.onlinePrice : product.storePrice),
    momoPrice: numberOrNull(product.momoPrice != null ? product.momoPrice : listingCase.priceSnapshot && listingCase.priceSnapshot.momo) ?? numberOrNull(product.sharedOnlinePrice != null ? product.sharedOnlinePrice : product.onlinePrice != null ? product.onlinePrice : product.storePrice),
    coupangPrice: numberOrNull(product.coupangPrice != null ? product.coupangPrice : listingCase.priceSnapshot && listingCase.priceSnapshot.coupang) ?? numberOrNull(product.sharedOnlinePrice != null ? product.sharedOnlinePrice : product.onlinePrice != null ? product.onlinePrice : product.storePrice),
    packageLengthCm: numberOrNull(listingCase.packageLengthCm),
    packageWidthCm: numberOrNull(listingCase.packageWidthCm),
    packageHeightCm: numberOrNull(listingCase.packageHeightCm),
    packageWeightKg: numberOrNull(listingCase.packageWeightKg),
    shippingDecision: clean(listingCase.shippingDecision),
    automationPolicy: listingAutomationPolicy(),
    contentPolicy: {
      standardVersion: RICH_CONTENT_STANDARD_VERSION,
      titleOrder: ['brand', 'model', 'product-type', 'important-spec-or-material'],
      requireVerifiedBrandAndModelWhenAvailable: true,
      appendStoreNameToTitleOrCopy: false,
      storePromotionContentInProductDescription: 'forbidden',
      websiteThemeOwnsStoreBranding: true,
      sharedTitleUsesCommonFactsOnly: true,
      variantDifferencesBelongInOptionNames: true,
      featureTarget: RICH_CONTENT_FEATURE_TARGET,
      usageTarget: RICH_CONTENT_USAGE_TARGET,
      neverInventToReachTarget: true,
      requiredSections: ['商品特色', '使用方式／適用情境', '商品規格'],
      fillEveryVerifiableAttribute: true,
      exactModelOrBarcodeEvidenceRequired: true,
      newProductRule: 'complete-rich-content-before-first-publish',
      existingProductRule: 'upgrade-in-place-gradually-without-changing-listing-identity',
      genericFallbackIsIncomplete: true,
      requireStructuredVerifiedDescriptionBeforePreparedSnapshot: true,
      descriptionContentStatus,
      includeVerifiedSpecifications: true,
      warrantyInDedicatedPlatformField: true,
      warrantySupportNoticeInDescription: WARRANTY_SUPPORT_NOTICE,
      locale: 'zh-TW',
      richDescriptionPlatforms: ['easyStore', 'shopee-when-account-supported', 'momo', 'coupang'],
      interleaveCompletedImagesWhenSupported: true,
      fixedDescriptionLayoutVersion: DESCRIPTION_LAYOUT_VERSION,
      fixedDescriptionOrder: ['商品介紹與特色', '商品圖一', '商品規格', '商品圖二', '使用建議', '商品圖三', '其餘商品圖', '實體商品說明', '出貨與保固說明', '固定介紹圖一', '固定介紹圖二'],
      storePromoGalleryImageUrl: STORE_PROMO_IMAGE_URL,
      storePromoMustBeLastGalleryImage: true,
      descriptionPromoImageUrls: [...DESCRIPTION_PROMO_IMAGE_URLS],
      descriptionPromosMustBeLastTwoImages: true,
      appliesToListingIntents: Array.from(LISTING_INTENTS),
      platformCompletionRequiresSavedTextAndImages: true,
      physicalProductDisclaimer: PHYSICAL_PRODUCT_DISCLAIMER,
      warrantySupportNotice: WARRANTY_SUPPORT_NOTICE,
      listingIntent: intentPolicy,
      mergeExistingContentRule: 'reuse-mapped-primary-preserve-unmentioned-content-and-attach-selected-independent-stock-variants',
      addVariantContentRule: 'preserve-existing-content-and-merge-new-variant-images-and-description',
      updateExistingContentRule: 'replace-only-requested-outdated-content-in-place-and-preserve-unmentioned-content',
      physicalImages: {
        originalRetained: true,
        customerFacingChange: 'watermark-only',
        labelText: '柚子樂器｜實體圖',
        aiEditingForbidden: true,
        neverUseAsMainOrGalleryImage: true,
        appendAfterCompletedDescriptionImagesBeforeFixedNoticesAndFinalPromos: true
      }
    },
    momoDelivery: MOMO_THIRD_PARTY_DELIVERY,
    momoSpecialPromotionImageUrl,
    momoSpecialPromotionImagePolicy: {
      required: true,
      source: 'localized-completed-product-image',
      preferredProductImagePositions: [2, 3],
      excludedContent: ['store-address', 'store-promo', 'service-promo', 'qr-code', 'contact-information'],
      insertMethod: 'material-bank-selection',
      verification: 'save-reopen-confirm-image-before-publish'
    },
    momoCatalogPolicy: {
      maximumListings: 1000,
      targetListings: 1000,
      reservedSlots: 0,
      targetMustHavePositiveStock: true,
      capacityCheckBeforeFirstPublish: true,
      zeroStockAction: 'temporarily-downlist-one-safe-zero-stock-item-before-publish-when-at-capacity',
      candidateMustBeActiveAndZeroStock: true,
      excludeCurrentSkuListingAndBatch: true,
      excludeProtectedPinnedAndPendingOrderListings: true,
      preferExplicitLowPriorityThenZeroSalesThenOldestUpdate: true,
      preserveSoldOutWithSales: true,
      requireSalesHistoryBeforeUnpublish: true,
      neverDeleteForQuotaRecovery: true,
      verifyDownlistedListingIdAndCountBeforeRetry: true,
      resumeSamePreparedDraftAfterSlotRecovery: true,
      neverCreateReplacementDraft: true,
      noSafeCandidateAction: 'stop-with-exact-reason',
      violationRecovery: 'republish-when-data-is-valid-and-capacity-allows'
    },
    regulatoryPolicy: { ncc: 'fill-only-when-verified', neverFabricateCertification: true },
    imagePolicy: {
      sourceImageMaximum: 20, sharedVariantGalleryMaximum: 12, balanceAcrossVariants: true,
      sourceNormalization: {
        preferredLongEdgeRangePx: { minimum: 1600, maximum: 2000 },
        targetLongEdgePx: 1800,
        downscaleWhenAbovePx: 2400,
        neverUpscale: true,
        analyzeNormalizedCopyAndRetainSourceLineage: true
      },
      galleryMaximum: 7, galleryProductMaximum: 6, overflowToDescription: true,
      mainImageTemplate: BRAND_TEMPLATE_CONTRACT.version, mainImageAspectRatio: '1:1-and-4:3-matched-pair',
      mainImageBackdrop: 'locked-one-ninth-youzi-green-header-logo-above-border-and-full-commercial-poster',
      mainImageProductPlacement: 'within-thin-green-border-and-never-under-logo',
      fullCommercialPosterStageRequired: true,
      genericInformationCardFallbackForbidden: true,
      approvedVisualReference: { ...BRAND_TEMPLATE_CONTRACT.approvedVisualReference },
      brandCreativeStyleAssignment,
      brandTemplateContract: JSON.parse(JSON.stringify(BRAND_TEMPLATE_CONTRACT)),
      outputProfiles: {
        storefrontPortrait: {
          role: 'storefrontPortrait', widthPx: BRAND_TEMPLATE_CONTRACT.storefrontPortrait.widthPx,
          heightPx: BRAND_TEMPLATE_CONTRACT.storefrontPortrait.heightPx,
          aspectRatio: BRAND_TEMPLATE_CONTRACT.storefrontPortrait.aspectRatio,
          firstImageFor: ['easyStore'], commercialInformationDensity: 'rich-but-readable',
          verifiedFeatureCount: { minimum: 3, maximum: 3 }, verifiedDetailInsetMaximum: 2,
          templateVersion: BRAND_TEMPLATE_CONTRACT.version,
          templateAssetUrl: BRAND_TEMPLATE_CONTRACT.storefrontPortrait.url,
          templateAssetSha256: BRAND_TEMPLATE_CONTRACT.storefrontPortrait.sha256,
          fixedStoreSlogan: BRAND_TEMPLATE_CONTRACT.slogan,
          fixedStoreLogoRequired: true, fixedHeaderPixelsRequired: true,
          fixedHeaderHeightRatio: BRAND_TEMPLATE_CONTRACT.header.heightRatio,
          selectedLargeLogoOverlapRequired: true, thinOuterGreenBorderRequired: true,
          logoLayer: BRAND_TEMPLATE_CONTRACT.logo.layer,
          borderLayer: BRAND_TEMPLATE_CONTRACT.contentPanel.borderLayer,
          borderMayNotCrossLogoArtwork: BRAND_TEMPLATE_CONTRACT.contentPanel.borderMayNotCrossLogoArtwork,
          brandRenderProofRequired: true,
          commercialPosterVisualQaRequired: true,
          genericInformationCardFallbackForbidden: true,
          creativeStyleAssignment: brandCreativeStyleAssignment,
          contactInformationForbidden: true, outboundMessagingForbidden: true,
          manufacturerLogoAllowedOnlyWhenOfficiallyVerifiedAndPlatformPermitted: true
        },
        brandedHero: {
          role: 'brandedHero', widthPx: BRAND_TEMPLATE_CONTRACT.brandedHero.widthPx,
          heightPx: BRAND_TEMPLATE_CONTRACT.brandedHero.heightPx,
          aspectRatio: BRAND_TEMPLATE_CONTRACT.brandedHero.aspectRatio,
          firstImageFor: ['shopee'], verifiedFeatureCount: { minimum: 3, maximum: 3 },
          templateVersion: BRAND_TEMPLATE_CONTRACT.version,
          templateAssetUrl: BRAND_TEMPLATE_CONTRACT.brandedHero.url,
          templateAssetSha256: BRAND_TEMPLATE_CONTRACT.brandedHero.sha256,
          fixedStoreSlogan: BRAND_TEMPLATE_CONTRACT.slogan,
          fixedStoreLogoRequired: true, fixedHeaderPixelsRequired: true,
          fixedHeaderHeightRatio: BRAND_TEMPLATE_CONTRACT.header.heightRatio,
          selectedLargeLogoOverlapRequired: true, thinOuterGreenBorderRequired: true,
          logoLayer: BRAND_TEMPLATE_CONTRACT.logo.layer,
          borderLayer: BRAND_TEMPLATE_CONTRACT.contentPanel.borderLayer,
          borderMayNotCrossLogoArtwork: BRAND_TEMPLATE_CONTRACT.contentPanel.borderMayNotCrossLogoArtwork,
          brandRenderProofRequired: true,
          commercialPosterVisualQaRequired: true,
          genericInformationCardFallbackForbidden: true,
          creativeStyleAssignment: brandCreativeStyleAssignment,
          contactInformationForbidden: true, outboundMessagingForbidden: true,
          manufacturerLogoAllowedOnlyWhenOfficiallyVerifiedAndPlatformPermitted: true
        },
        cleanMain: {
          role: 'cleanMain', widthPx: 1000, heightPx: 1000, aspectRatio: '1:1',
          firstImageFor: ['momo', 'coupang'], textForbidden: true, logoForbidden: true
        }
      },
      storePromoGalleryImageDisabled: false, storePromoGalleryImageMustBeLast: true,
      storePromoDescriptionImagesDisabled: false,
      localizedTraditionalChinese: true, localizedVariantRepresentativesRequired: true,
      sharedDeliveryAssetStandard: {
        strategy: 'strictest-common-square-marketplace-profile',
        widthPx: 1000,
        heightPx: 1000,
        aspectRatio: '1:1',
        colorSpace: 'sRGB',
        preferredFormat: 'image/jpeg',
        maximumFileBytes: 1000000,
        normalizeOnceBeforePlatformNavigation: true,
        platformRecropForbiddenUnlessRejectedByPlatform: true,
        squareMarketplaceProfilesShareDimensions: true
      },
      storefrontPortraitAssetStandard: {
        role: 'storefrontPortrait', widthPx: BRAND_TEMPLATE_CONTRACT.storefrontPortrait.widthPx,
        heightPx: BRAND_TEMPLATE_CONTRACT.storefrontPortrait.heightPx,
        aspectRatio: BRAND_TEMPLATE_CONTRACT.storefrontPortrait.aspectRatio,
        colorSpace: 'sRGB', preferredFormat: 'image/jpeg', maximumFileBytes: 1000000,
        normalizeOnceBeforePlatformNavigation: true,
        templateVersion: BRAND_TEMPLATE_CONTRACT.version,
        templateAssetUrl: BRAND_TEMPLATE_CONTRACT.storefrontPortrait.url,
        templateAssetSha256: BRAND_TEMPLATE_CONTRACT.storefrontPortrait.sha256,
        fixedHeaderPixelsRequired: true,
        fixedHeaderHeightRatio: BRAND_TEMPLATE_CONTRACT.header.heightRatio,
        selectedLargeLogoOverlapRequired: true,
        logoLayer: BRAND_TEMPLATE_CONTRACT.logo.layer,
        borderLayer: BRAND_TEMPLATE_CONTRACT.contentPanel.borderLayer,
        borderMayNotCrossLogoArtwork: BRAND_TEMPLATE_CONTRACT.contentPanel.borderMayNotCrossLogoArtwork,
        brandRenderProofRequired: true,
        commercialPosterVisualQaRequired: true,
        genericInformationCardFallbackForbidden: true,
        thinOuterGreenBorderRequired: true,
        creativeStyleAssignment: brandCreativeStyleAssignment,
        contactInformationForbidden: true,
        outboundMessagingForbidden: true,
        manufacturerLogoAllowedOnlyWhenOfficiallyVerifiedAndPlatformPermitted: true
      }
    },
    shopeeTitle: listingMode === 'add-variant'
      ? clean(variantParentListingCase && variantParentListingCase.shopeeTitle) || listingName(parentProduct, variantParentListingCase || {})
      : clean(listingCase.shopeeTitle) || listingName(product, listingCase),
    shopeeDescription: (() => { const value = listingMode === 'add-variant' ? description : clean(listingCase.shopeeDescription) || description; const content = stripFixedDescriptionNoticesText(value); return content ? `${content}\n\n${FIXED_DESCRIPTION_NOTICES.join('\n\n')}` : ''; })(),
    shopeeRequiredNotes: clean(listingCase.shopeeRequiredNotes),
    shopeeExistingListingIds,
    shopeeCategoryPath: listingMode === 'add-variant'
      ? clean(variantParentListingCase && variantParentListingCase.shopeeCategoryPath) || clean(listingCase.shopeeCategoryPath)
      : clean(listingCase.shopeeCategoryPath),
    shopeeBrand: listingMode === 'add-variant'
      ? clean(variantParentListingCase && (variantParentListingCase.shopeeBrand || variantParentListingCase.brand)) || clean(parentProduct.brand) || clean(listingCase.shopeeBrand || listingCase.brand || product.brand)
      : clean(listingCase.shopeeBrand) || clean(listingCase.brand || product.brand),
    shopeeAttributeValues: normalizeShopeeAttributes(listingCase.shopeeAttributeValues),
    identityStatus: clean(listingCase.identityStatus),
    identityManualConfirmed: listingCase.identityManualConfirmed === true,
    identityManualConfirmedAt: listingCase.identityManualConfirmedAt || null,
    identityManualConfirmedBy: clean(listingCase.identityManualConfirmedBy),
    identityManualConfirmationNote: clean(listingCase.identityManualConfirmationNote),
    color: clean(listingCase.color || product.color),
    momoGoodsName: listingMode === 'add-variant'
      ? clean(variantParentListingCase && variantParentListingCase.momoGoodsName) || listingName(parentProduct, variantParentListingCase || {})
      : clean(listingCase.momoGoodsName) || listingName(product, listingCase),
    momoSlogan: listingMode === 'add-variant'
      ? clean(variantParentListingCase && variantParentListingCase.momoSlogan) || clean(listingCase.momoSlogan)
      : clean(listingCase.momoSlogan),
    momoHtml: descriptionHtml,
    momoCategoryCode: listingMode === 'add-variant'
      ? clean(variantParentListingCase && variantParentListingCase.momoCategoryCode) || clean(listingCase.momoCategoryCode)
      : clean(listingCase.momoCategoryCode),
    momoMarketPrice: numberOrNull(listingCase.momoMarketPrice != null
      ? listingCase.momoMarketPrice : listingCase.priceSnapshot && listingCase.priceSnapshot.momoMarket),
    momoAttributeValues: normalizeMomoAttributes(listingMode === 'add-variant'
      ? (variantParentListingCase && variantParentListingCase.momoAttributeValues) || listingCase.momoAttributeValues
      : listingCase.momoAttributeValues),
    momoOtherProductInformation: normalizeMomoAttributes(listingMode === 'add-variant'
      ? (variantParentListingCase && variantParentListingCase.momoOtherProductInformation) || listingCase.momoOtherProductInformation
      : listingCase.momoOtherProductInformation),
    momoStoreCategoryNames: Array.from(new Set((Array.isArray(listingMode === 'add-variant'
      ? (variantParentListingCase && variantParentListingCase.momoStoreCategoryNames) || listingCase.momoStoreCategoryNames
      : listingCase.momoStoreCategoryNames)
      ? (listingMode === 'add-variant'
        ? (variantParentListingCase && variantParentListingCase.momoStoreCategoryNames) || listingCase.momoStoreCategoryNames
        : listingCase.momoStoreCategoryNames)
      : []).map(clean).filter(Boolean))).slice(0, 5),
    coupangTitle: listingMode === 'add-variant'
      ? clean(variantParentListingCase && variantParentListingCase.coupangTitle) || listingName(parentProduct, variantParentListingCase || {})
      : clean(listingCase.coupangTitle) || listingName(product, listingCase),
    coupangDescriptionHtml: descriptionHtml,
    coupangCategoryCode: listingMode === 'add-variant'
      ? clean(variantParentListingCase && variantParentListingCase.coupangCategoryCode) || clean(listingCase.coupangCategoryCode)
      : clean(listingCase.coupangCategoryCode),
    listingTargetScope,
    listingTargetPlatforms: selectedPlatforms,
    enabledEasyStoreShopee: selectedPlatforms.includes('easyStore'),
    enabledMomo: selectedPlatforms.includes('momo'),
    enabledCoupang: selectedPlatforms.includes('coupang')
  };
  snapshot.momoGoodsName = momoProductName(snapshot.momoGoodsName, snapshot.brand);
  snapshot.momoMarketPrice = momoMarketPrice(snapshot);
  snapshot.momoShortFeatures = momoShortFeaturePlan(snapshot.description, snapshot.momoSlogan);
  snapshot.momoSlogan = snapshot.momoShortFeatures.slogan;
  snapshot.shopeeAdvancedDescription = shopeeAdvancedDescriptionPlan(snapshot);
  snapshot.platformDescriptionContentPlan = platformDescriptionContentPlan(snapshot);
  snapshot.category = clean(listingCase.category || product.category);
  snapshot.shopeeCategoryPath = shopeeTaxonomy.formatCategoryPath(snapshot.shopeeCategoryPath, snapshot);
  snapshot.shopeeAttributeValues = applyShopeeAttributeTemplate(
    snapshot.shopeeAttributeValues,
    snapshot,
    snapshot.shopeeCategoryPath
  );
  snapshot.canonicalCategoryDecision = buildCanonicalCategoryDecision(snapshot);
  snapshot.decisionContract = buildListingDecisionContract(snapshot);
  snapshot.preparedPlatformFieldPlan = buildPreparedPlatformFieldPlan(snapshot);
  return snapshot;
}

function compactObject(value) {
  if (Array.isArray(value)) return value.map(compactObject);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  Object.keys(value).sort().forEach((key) => {
    const item = value[key];
    if (item === undefined) return;
    result[key] = compactObject(item);
  });
  return result;
}

function easyStoreSeoDescription(snapshot) {
  const title = clean(snapshot && snapshot.title);
  const lines = clean(snapshot && snapshot.description).split(/\r?\n/).map(clean).filter(Boolean);
  const features = [];
  let inFeatures = false;
  for (const line of lines) {
    if (line === '商品特色') { inFeatures = true; continue; }
    if (inFeatures && /^(?:使用方式|適用情境|商品規格)/.test(line)) break;
    if (!inFeatures) continue;
    features.push(line.replace(/^(?:\d+[.、]|[-•●])\s*/, ''));
  }
  const candidates = [title, ...(features.length ? features : lines.filter((line) => !/^(?:商品特色|使用方式|適用情境|商品規格)/.test(line)))];
  const parts = [];
  for (const candidate of candidates) {
    const next = [...parts, candidate].filter(Boolean).join('｜');
    if (Array.from(next).length > 180) break;
    if (candidate && !parts.includes(candidate)) parts.push(candidate);
  }
  return parts.join('｜') || Array.from(title).slice(0, 180).join('');
}

function buildEasyStoreProductBody(snapshot, includeVariant = true) {
  const galleryImages = easyStoreGalleryImages(snapshot);
  const product = {
    title: snapshot.title,
    description: snapshot.description,
    body_html: snapshot.bodyHtml,
    inventory_management: 'easystore',
    taxable: false,
    shipping_required: true,
    metafields_global_title_tag: Array.from(clean(snapshot.title)).slice(0, 70).join(''),
    metafields_global_description_tag: easyStoreSeoDescription(snapshot),
    published_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    images: galleryImages.map((url) => ({ url }))
  };
  if (includeVariant) {
    const grouped = snapshot.variantGroupEnabled === true
      ? (Array.isArray(snapshot.variantGroupVariants) ? snapshot.variantGroupVariants : [])
      : [];
    const rows = grouped.length ? grouped : [{
      sku: snapshot.sku, barcode: snapshot.barcode, easyStorePrice: snapshot.easyStorePrice,
      stock: snapshot.stock, storePrice: snapshot.storePrice, costPrice: snapshot.costPrice,
      attributeValue: ''
    }];
    product.variants = rows.map((row) => {
      const variant = {
      sku: normalizeSku(row && row.sku),
      barcode: clean(row && row.barcode) || null,
      price: numberOrNull(row && row.easyStorePrice),
      inventory_quantity: Math.max(0, Math.round(numberOrNull(row && row.stock) || 0)),
      width: snapshot.packageWidthCm,
      height: snapshot.packageHeightCm,
      length: snapshot.packageLengthCm,
      weight: snapshot.packageWeightKg,
      weight_unit: 'kg',
      inventory_policy: false,
      taxable: false,
      is_enabled: true
      };
      const attributeValue = clean(row && row.attributeValue);
      if (attributeValue) {
        variant.name = attributeValue;
        variant.option1 = attributeValue;
      }
      const storePrice = numberOrNull(row && row.storePrice);
      const salePrice = numberOrNull(row && row.easyStorePrice);
      const costPrice = numberOrNull(row && row.costPrice);
      if (salePrice != null) {
        // The storefront compare-at price is a deterministic 35% reference-price
        // uplift when no verified higher original price was saved. Round upward to
        // a clean NT$10 boundary so the same product never changes between runs.
        variant.compare_at_price = storePrice != null && storePrice > salePrice
          ? storePrice
          : Math.ceil((salePrice * 1.35) / 10) * 10;
      }
      if (costPrice != null) variant.cost_price = costPrice;
      return variant;
    });
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
    ? [
      snapshot.momoGoodsName, snapshot.momoSlogan, snapshot.momoShortFeatures,
      snapshot.momoCategoryCode, snapshot.momoAttributeValues, snapshot.momoOtherProductInformation,
      snapshot.momoStoreCategoryNames, snapshot.momoPrice, snapshot.momoMarketPrice,
      snapshot.momoHtml, snapshot.momoSpecialPromotionImageUrl
    ]
    : [snapshot.coupangTitle, snapshot.coupangCategoryCode, snapshot.coupangPrice, snapshot.coupangDescriptionHtml];
  return crypto.createHash('sha256').update(JSON.stringify(compactObject({
    platform: key,
    productId: snapshot.productId,
    sku: snapshot.sku,
    workflowPurpose: snapshot.workflowPurpose,
    listingIntent: snapshot.listingIntent,
    listingIntentPolicy: snapshot.listingIntentPolicy,
    listingChangeInstructions: snapshot.listingChangeInstructions,
    listingMode: snapshot.listingMode,
    variantGroup: snapshot.variantGroupEnabled ? {
      attributeName: snapshot.variantGroupAttributeName,
      variants: snapshot.variantGroupVariants
    } : [snapshot.variantParentProductId, snapshot.variantParentSku, snapshot.variantAttributeName, snapshot.variantParentAttributeValue, snapshot.variantAttributeValue, snapshot.variantParentImageUrl, snapshot.variantChildImageUrl],
    parentPlatformListingIds: platformListingIds({ platformMappings: snapshot.variantParentPlatformMappings, platformListingStatus: snapshot.variantParentPlatformListingStatus }, key),
    title: snapshot.title,
    description: snapshot.description,
    descriptionImageUrls: snapshot.descriptionImageUrls,
    physicalImageUrls: snapshot.physicalImageUrls,
    images: snapshot.images,
    stock: snapshot.stock,
    package: [snapshot.packageLengthCm, snapshot.packageWidthCm, snapshot.packageHeightCm, snapshot.packageWeightKg],
    automationPolicy: snapshot.automationPolicy,
    momoDelivery: snapshot.momoDelivery,
    momoSpecialPromotionImageUrl: snapshot.momoSpecialPromotionImageUrl,
    momoSpecialPromotionImagePolicy: snapshot.momoSpecialPromotionImagePolicy,
    momoCatalogPolicy: snapshot.momoCatalogPolicy,
    platformFields
  }))).digest('hex');
}

function listingSnapshotFingerprint(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(compactObject(snapshot || {}))).digest('hex');
}

function buildPlatformQueuePolicy(product, platform, snapshot) {
  const listingIntent = normalizeListingIntent(snapshot, product);
  const addVariant = listingIntent === 'add-variant';
  const identityProduct = addVariant
    ? {
      platformMappings: snapshot.variantParentPlatformMappings && typeof snapshot.variantParentPlatformMappings === 'object' ? snapshot.variantParentPlatformMappings : {},
      platformListingStatus: snapshot.variantParentPlatformListingStatus && typeof snapshot.variantParentPlatformListingStatus === 'object' ? snapshot.variantParentPlatformListingStatus : {}
    }
    : product;
  const platformKey = clean(platform).toLowerCase() === 'easystore' ? 'easyStore' : clean(platform).toLowerCase();
  const frozenIds = snapshot && snapshot.existingPlatformListingIds && typeof snapshot.existingPlatformListingIds === 'object'
    && Object.prototype.hasOwnProperty.call(snapshot.existingPlatformListingIds, platformKey)
    ? snapshot.existingPlatformListingIds[platformKey] : null;
  const existingListingIds = frozenIds === null
    ? platformListingIds(identityProduct, platform)
    : Array.from(new Set((Array.isArray(frozenIds) ? frozenIds : [frozenIds]).map(clean).filter(Boolean))).slice(0, 50);
  if (addVariant) {
    return {
      mode: existingListingIds.length > 1 ? 'block-duplicate-parent' : existingListingIds.length ? 'add-variant-to-existing' : 'block-missing-parent',
      matchKey: 'parent-listing-id+sku', sku: snapshot.sku, existingListingIds,
      identitySource: 'central-platform-id', preflightSkuSearch: false, uncertainSubmitRecovery: 'exact-sku-only',
      parentProductId: clean(snapshot.variantParentProductId), parentSku: clean(snapshot.variantParentSku),
      variantAttributeName: clean(snapshot.variantAttributeName), variantParentAttributeValue: clean(snapshot.variantParentAttributeValue), variantAttributeValue: clean(snapshot.variantAttributeValue),
      variantParentImageUrl: safeHttpUrl(snapshot.variantParentImageUrl), variantImageUrl: safeHttpUrl(snapshot.variantChildImageUrl),
      onZero: 'block', onOne: 'append-variant', onMultiple: 'block', onUncertain: 'block'
    };
  }
  if (listingIntent === 'create-group') {
    const mode = existingListingIds.length > 1 ? 'block-duplicate'
      : existingListingIds.length ? 'block-existing-target-for-create' : 'create-new-variant-group';
    return {
      mode,
      listingIntent,
      matchKey: existingListingIds.length ? 'conflicting-central-platform-id' : 'new-variant-group',
      sku: snapshot.sku,
      skus: (snapshot.variantGroupVariants || []).map((row) => normalizeSku(row && row.sku)).filter(Boolean),
      attributeName: clean(snapshot.variantGroupAttributeName),
      existingListingIds,
      identitySource: existingListingIds.length ? 'conflicting-central-platform-id' : 'new-draft',
      preflightSkuSearch: false,
      uncertainSubmitRecovery: 'exact-root-sku-only',
      onZero: 'create-one-parent-with-variants',
      onOne: 'block-existing-target-for-create',
      onMultiple: 'block',
      onUncertain: 'exact-root-sku-recovery'
    };
  }
  if (listingIntent === 'merge-existing') {
    const mode = existingListingIds.length > 1 ? 'block-duplicate'
      : existingListingIds.length ? 'merge-variant-group-into-existing' : 'create-new-variant-group';
    return {
      mode,
      listingIntent,
      matchKey: existingListingIds.length ? 'exact-primary-platform-id+closed-selected-sku-set' : 'new-variant-group',
      sku: snapshot.sku,
      skus: (snapshot.variantGroupVariants || []).map((row) => normalizeSku(row && row.sku)).filter(Boolean),
      attributeName: clean(snapshot.variantGroupAttributeName),
      existingListingIds,
      identitySource: existingListingIds.length ? 'central-platform-id' : 'new-draft',
      preflightSkuSearch: false,
      uncertainSubmitRecovery: 'exact-root-sku-only',
      contentAction: existingListingIds.length ? 'preserve-existing-and-merge-selected-variants' : 'create-complete-variant-group',
      preserveUnmentionedContent: existingListingIds.length > 0,
      onZero: 'create-one-parent-with-variants',
      onOne: 'merge-selected-variants-into-exact-target',
      onMultiple: 'block',
      onUncertain: existingListingIds.length ? 'block' : 'exact-root-sku-recovery'
    };
  }
  if (listingIntent === 'update-existing') {
    return {
      mode: existingListingIds.length > 1 ? 'block-duplicate' : existingListingIds.length ? 'update-existing' : 'block-missing-existing-target',
      listingIntent,
      matchKey: 'exact-sku+central-platform-id',
      sku: snapshot.sku,
      existingListingIds,
      identitySource: 'central-platform-id',
      preflightSkuSearch: false,
      uncertainSubmitRecovery: 'exact-sku-only',
      contentAction: 'replace-requested-outdated-content-in-place',
      preserveUnmentionedContent: true,
      onZero: 'block',
      onOne: 'update-exact-target',
      onMultiple: 'block',
      onUncertain: 'block'
    };
  }
  return {
    mode: existingListingIds.length > 1 ? 'block-duplicate' : existingListingIds.length ? 'block-existing-target-for-create' : 'create-new',
    listingIntent: 'create-single',
    matchKey: existingListingIds.length ? 'conflicting-central-platform-id' : 'new-draft',
    sku: snapshot.sku,
    existingListingIds,
    identitySource: existingListingIds.length ? 'conflicting-central-platform-id' : 'new-draft',
    preflightSkuSearch: false,
    uncertainSubmitRecovery: 'exact-sku-only',
    onZero: 'create',
    onOne: 'block-existing-target-for-create',
    onMultiple: 'block',
    onUncertain: 'exact-sku-recovery'
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

function easyStoreVariantPrice(variant) {
  return numberOrNull(variant && (variant.price ?? variant.sale_price ?? variant.regular_price));
}

function easyStoreVariantStock(variant) {
  return numberOrNull(variant && (variant.inventory_quantity ?? variant.quantity ?? variant.stock ?? variant.inventory));
}

function easyStoreProductImages(product) {
  if (!product || typeof product !== 'object') return [];
  for (const key of ['images', 'product_images', 'productImages']) {
    if (Array.isArray(product[key])) return product[key];
  }
  return [];
}

function easyStoreImageId(row) {
  return clean(row && (row.id || row.image_id || row.imageId));
}

function easyStoreImageUrl(row) {
  if (!row || typeof row !== 'object') return '';
  for (const key of ['url', 'src', 'source_url', 'sourceUrl', 'original_url', 'originalUrl']) {
    const url = safeHttpUrl(row[key]);
    if (url) return url;
  }
  return collectImageUrls(row, true)[0] || '';
}

function imageFileStem(value) {
  const url = safeHttpUrl(value);
  if (!url) return '';
  try {
    const path = decodeURIComponent(new URL(url).pathname).replace(/\\/g, '/');
    return clean(path.split('/').filter(Boolean).pop()).replace(/\.(?:jpe?g|png|webp)$/i, '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function easyStoreImageIdForPlannedUrl(product, plannedUrl, plannedGallery = []) {
  const target = safeHttpUrl(plannedUrl);
  if (!target) return '';
  const rows = easyStoreProductImages(product);
  const direct = rows.find((row) => collectImageUrls(row, true).some((url) => safeHttpUrl(url) === target));
  if (direct && easyStoreImageId(direct)) return easyStoreImageId(direct);
  const targetStem = imageFileStem(target);
  const byName = rows.find((row) => {
    const title = clean(row && (row.title || row.name || row.filename || row.file_name))
      .replace(/\.(?:jpe?g|png|webp)$/i, '').toLowerCase();
    return Boolean(targetStem && (title === targetStem || imageFileStem(easyStoreImageUrl(row)) === targetStem));
  });
  if (byName && easyStoreImageId(byName)) return easyStoreImageId(byName);
  const index = normalizeUrls(plannedGallery, 30).indexOf(target);
  return index >= 0 ? easyStoreImageId(rows[index]) : '';
}

function easyStoreVariantImageUrl(variant, product = null) {
  if (!variant || typeof variant !== 'object') return '';
  for (const key of ['image_url', 'imageUrl', 'photo_url', 'photoUrl', 'thumbnail_url', 'thumbnailUrl']) {
    const url = safeHttpUrl(variant[key]);
    if (url) return url;
  }
  const direct = collectImageUrls(variant, true)[0] || '';
  if (direct) return direct;
  const variantImageId = clean(variant.image_id || variant.imageId);
  if (!variantImageId || !product) return '';
  const image = easyStoreProductImages(product).find((row) => easyStoreImageId(row) === variantImageId);
  return easyStoreImageUrl(image);
}

function easyStorePublicationState(product) {
  if (!product || typeof product !== 'object') return 'unknown';
  for (const key of ['published', 'is_published', 'isPublished']) {
    if (!Object.prototype.hasOwnProperty.call(product, key)) continue;
    return product[key] === true ? 'published' : 'draft';
  }
  for (const key of ['published_at', 'publishedAt']) {
    if (!Object.prototype.hasOwnProperty.call(product, key)) continue;
    return clean(product[key]) ? 'published' : 'draft';
  }
  const status = clean(product.status || product.publish_status || product.publishStatus).toLowerCase();
  if (['published', 'active', 'live', '已發佈', '已發布', '已上架'].includes(status)) return 'published';
  if (['draft', 'unpublished', 'inactive', 'hidden', '未發佈', '未發布', '未上架', '草稿'].includes(status)) return 'draft';
  return 'unknown';
}

async function verifyEasyStorePublishedListing(snapshot, token, result) {
  let lastReasons = ['missing-from-official-catalog'];
  for (const delayMs of [0, 1000, 2500]) {
    if (delayMs) await wait(delayMs);
    let match = await findEasyStoreMappingInProduct(snapshot, token, clean(result && result.productId));
    if (!match && result && result.recoveredAfterUncertainResponse === true) {
      match = await findEasyStoreMappingBySku(snapshot, token);
    }
    if (!match) continue;
    const publicationState = easyStorePublicationState(match.product);
    if (publicationState === 'draft') {
      lastReasons = ['still-draft'];
      continue;
    }
    const price = easyStoreVariantPrice(match.variant);
    const stock = easyStoreVariantStock(match.variant);
    const variants = snapshot.variantGroupEnabled === true ? productVariants(match.product).map((variant) => ({
      sku: normalizeSku(variant && (variant.sku || variant.code || variant.product_code)),
      value: clean(variant && (variant.option1 || variant.name || variant.title || variant.option_name)),
      price: easyStoreVariantPrice(variant),
      stock: easyStoreVariantStock(variant),
      imageUrl: easyStoreVariantImageUrl(variant, match.product)
    })) : [];
    const verification = validatePlatformStageVerification('easyStore', snapshot, {
      listingId: match.productId,
      sku: snapshot.sku,
      price,
      stock,
      variants,
      status: publicationState === 'published' ? 'published' : 'official-catalog-matched',
      platformListMatched: false,
      officialCatalogMatched: true
    });
    if (verification.verified) {
      return {
        verified: true,
        productId: match.productId,
        variantId: match.variantId,
        variantIds: snapshot.variantGroupEnabled === true
          ? productVariants(match.product).map(variantIdOf).filter(Boolean) : [match.variantId],
        ...verification.receipt
      };
    }
    lastReasons = verification.reasons;
  }
  throw new Error(`EasyStore 正式商品資料核對未通過：${lastReasons.join('、')}`);
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

async function updateEasyStoreParentContent(snapshot, productId, token) {
  await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token, {
    method: 'PUT',
    body: {
      product: {
        description: clean(snapshot.description),
        body_html: clean(snapshot.bodyHtml)
      }
    }
  });
}

async function addEasyStoreVariant(snapshot, product, token) {
  const productId = clean(snapshot.variantParentEasyStoreProductId);
  if (!productId) throw new Error('父商品缺少 EasyStore productId；為避免建立重複商品已停止。');
  if (!clean(snapshot.variantAttributeName) || !clean(snapshot.variantParentAttributeValue) || !clean(snapshot.variantAttributeValue)) throw new Error('請先填寫細項名稱、父商品細項值與新細項值。');
  const childMappingIds = platformListingIds(product, 'easyStore');
  if (childMappingIds.length > 1 || (childMappingIds.length === 1 && childMappingIds[0] !== productId)) {
    throw new Error(`SKU ${snapshot.sku} 的中央 EasyStore 編號與父商品不一致，為避免移錯商品已停止。`);
  }
  const existingInParent = await findEasyStoreMappingInProduct(snapshot, token, productId);
  const variantTemplate = {
    ...buildEasyStoreProductBody(snapshot, true).product.variants[0],
    name: snapshot.variantAttributeValue
  };
  if (existingInParent) {
    await easyStoreRequest(`/products/${encodeURIComponent(productId)}/variants.json`, token, {
      method: 'PUT', body: { variants: [{ id: existingInParent.variantId, ...variantTemplate }] }
    });
    await updateEasyStoreParentContent(snapshot, productId, token);
    return { action: 'variant-updated', productId, variantIds: [existingInParent.variantId], parentContentMerged: true };
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
  await updateEasyStoreParentContent(snapshot, productId, token);
  return { action: 'variant-created', productId, variantIds: [variantId], recoveredAfterUncertainResponse: Boolean(optionError), imageWarning, parentContentMerged: true };
}

function easyStoreVariantValue(variant) {
  return clean(variant && (variant.option1 || variant.name || variant.title || variant.option_name || variant.optionName));
}

function easyStoreVariantTemplate(snapshot, row) {
  const groupedSnapshot = {
    ...snapshot,
    variantGroupEnabled: false,
    sku: normalizeSku(row && row.sku),
    barcode: clean(row && row.barcode),
    easyStorePrice: numberOrNull(row && row.easyStorePrice),
    stock: numberOrNull(row && row.stock),
    storePrice: numberOrNull(row && row.storePrice),
    costPrice: numberOrNull(row && row.costPrice)
  };
  const template = buildEasyStoreProductBody(groupedSnapshot, true).product.variants[0];
  const value = clean(row && row.attributeValue);
  return { ...template, name: value, option1: value };
}

function easyStoreVariantCoreMatches(remote, planned) {
  if (!remote || !planned) return false;
  if (normalizeSku(remote.sku) !== normalizeSku(planned.sku)) return false;
  if (easyStoreVariantValue(remote) !== clean(planned.name || planned.option1)) return false;
  const remoteBarcode = clean(remote.barcode);
  const plannedBarcode = clean(planned.barcode);
  if (remoteBarcode !== plannedBarcode) return false;
  const pairs = [
    [remote.price, planned.price],
    [remote.inventory_quantity ?? remote.stock, planned.inventory_quantity],
    [remote.width, planned.width],
    [remote.height, planned.height],
    [remote.length, planned.length],
    [remote.weight, planned.weight]
  ];
  return pairs.every(([actual, expected]) => numberOrNull(actual) === numberOrNull(expected));
}

async function bindAndVerifyEasyStoreVariantImages(snapshot, productId, token, expectedRows) {
  const expected = (Array.isArray(expectedRows) ? expectedRows : [])
    .map((row) => ({ sku: normalizeSku(row && row.sku), imageUrl: safeHttpUrl(row && row.imageUrl) }))
    .filter((row) => row.sku && row.imageUrl);
  if (!expected.length) throw new Error('EasyStore 細項圖片計畫為空，不能完成細項同步。');
  const plannedGallery = easyStoreGalleryImages(snapshot);
  if (!plannedGallery.length || plannedGallery[plannedGallery.length - 1] !== STORE_PROMO_IMAGE_URL) {
    throw new Error('EasyStore 圖片計畫不完整：最後一張不是固定店址圖。');
  }
  const missingFromGallery = expected.filter((row) => !plannedGallery.includes(row.imageUrl));
  if (missingFromGallery.length) {
    throw new Error(`EasyStore 細項代表圖未納入父商品圖片：${missingFromGallery.map((row) => row.sku).join('、')}`);
  }

  let payload = await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token);
  let product = extractProducts(payload)[0] || payload.product || payload;
  const finalBySku = new Map(productVariants(product).map((variant) => [
    normalizeSku(variant && (variant.sku || variant.code || variant.product_code)), variant
  ]));
  const failures = expected.filter((row) => {
    const variant = finalBySku.get(row.sku);
    const expectedImageId = easyStoreImageIdForPlannedUrl(product, row.imageUrl, plannedGallery);
    const actualImageId = clean(variant && (variant.image_id || variant.imageId));
    return !expectedImageId || !actualImageId || expectedImageId !== actualImageId;
  });
  if (failures.length) {
    throw new Error(`EASYSTORE_VARIANT_IMAGE_UI_REQUIRED：請在 Codex 內建瀏覽器的 EasyStore 商品後台，依 SKU 從父商品圖庫選入指定完成圖並儲存；再由 API 回讀 image_id。未完成：${failures.map((row) => row.sku).join('、')}`);
  }
  return product;
}

async function syncEasyStoreVariantGroup(snapshot, productId, token) {
  const expected = Array.isArray(snapshot.variantGroupVariants) ? snapshot.variantGroupVariants : [];
  if (expected.length < 2 || !clean(snapshot.variantGroupAttributeName)) {
    throw new Error('同款多細項缺少完整細項名稱或至少兩個細項。');
  }
  let payload = await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token);
  let remoteProduct = extractProducts(payload)[0] || payload.product || payload;
  let remoteVariants = productVariants(remoteProduct);
  const expectedSkus = new Set(expected.map((row) => normalizeSku(row && row.sku)));
  let missing = expected.filter((row) => !remoteVariants.some((variant) => normalizeSku(variant && variant.sku) === normalizeSku(row && row.sku)));
  if (missing.length) {
    const variantTypes = Array.isArray(remoteProduct.variant_types) ? remoteProduct.variant_types : [];
    if (variantTypes.length > 1) throw new Error('EasyStore 既有主商品含兩種以上細項欄位，無法安全套用本次單一細項群組。');
    if (variantTypes.length === 1 && clean(variantTypes[0].name).toLowerCase() !== clean(snapshot.variantGroupAttributeName).toLowerCase()) {
      throw new Error(`EasyStore 既有細項是「${clean(variantTypes[0].name)}」，與本次「${snapshot.variantGroupAttributeName}」不同。`);
    }
    const existingValues = new Set(remoteVariants.map(easyStoreVariantValue).map((value) => value.toLowerCase()).filter(Boolean));
    const requestedValues = expected.map((row) => clean(row.attributeValue)).filter((value) => !existingValues.has(value.toLowerCase()));
    if (!variantTypes.length) {
      if (remoteVariants.length !== 1) throw new Error('EasyStore 主商品沒有細項名稱但已有多個規格，無法安全建立群組。');
      await easyStoreRequest(`/products/${encodeURIComponent(productId)}/options.json`, token, {
        method: 'POST', body: { option_type: snapshot.variantGroupAttributeName, option_values: expected.map((row) => clean(row.attributeValue)) }
      });
    } else if (requestedValues.length) {
      await easyStoreRequest(`/products/${encodeURIComponent(productId)}/options.json`, token, {
        method: 'POST', body: { option_type: snapshot.variantGroupAttributeName, option_values: requestedValues }
      });
    }
    payload = await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token);
    remoteProduct = extractProducts(payload)[0] || payload.product || payload;
    remoteVariants = productVariants(remoteProduct);
  }

  const unused = remoteVariants.slice();
  const updates = expected.map((row) => {
    const sku = normalizeSku(row && row.sku);
    const value = clean(row && row.attributeValue).toLowerCase();
    let index = unused.findIndex((variant) => normalizeSku(variant && variant.sku) === sku);
    if (index < 0) index = unused.findIndex((variant) => easyStoreVariantValue(variant).toLowerCase() === value);
    if (index < 0) throw new Error(`EasyStore 未產生細項「${clean(row && row.attributeValue)}」；為避免錯配 SKU 已停止。`);
    const variant = unused.splice(index, 1)[0];
    const id = variantIdOf(variant);
    if (!id) throw new Error(`EasyStore 細項「${clean(row && row.attributeValue)}」缺少規格編號。`);
    return { id, ...easyStoreVariantTemplate(snapshot, row) };
  });
  const unexpectedSkus = remoteVariants.map((variant) => normalizeSku(variant && variant.sku)).filter((sku) => sku && !expectedSkus.has(sku));
  if (unexpectedSkus.length) throw new Error(`EasyStore 主商品仍含不屬於本組的 SKU：${unexpectedSkus.join('、')}；為避免誤刪既有資料已停止。`);
  const currentById = new Map(remoteVariants.map((variant) => [variantIdOf(variant), variant]));
  const coreAlreadyMatches = updates.every((update) => easyStoreVariantCoreMatches(currentById.get(clean(update.id)), update));
  if (!coreAlreadyMatches) {
    await easyStoreRequest(`/products/${encodeURIComponent(productId)}/variants.json`, token, {
      method: 'PUT', body: { variants: updates }
    });
  }
  await bindAndVerifyEasyStoreVariantImages(snapshot, productId, token, expected);
  return updates.map((row) => clean(row.id));
}

async function upsertEasyStoreProduct(snapshot, product, token) {
  if (snapshot.listingMode === 'add-variant') return addEasyStoreVariant(snapshot, product, token);
  const listingIntent = normalizeListingIntent(snapshot, product);
  const grouped = snapshot.variantGroupEnabled === true;
  const mappings = product.platformMappings && typeof product.platformMappings === 'object' ? product.platformMappings : {};
  const mapped = mappings.easyStore && typeof mappings.easyStore === 'object' ? mappings.easyStore : {};
  const frozenEasyStoreIds = snapshot.existingPlatformListingIds && Array.isArray(snapshot.existingPlatformListingIds.easyStore)
    ? snapshot.existingPlatformListingIds.easyStore.map(clean).filter(Boolean) : [];
  if (frozenEasyStoreIds.length > 1) throw new Error('中央商品含有多個 EasyStore productId；為避免更新錯商品已停止。');
  const mappedProductId = clean(frozenEasyStoreIds[0] || mapped.productId || product.sourceProductId);
  if (['create-single', 'create-group'].includes(listingIntent) && mappedProductId) {
    throw new Error(`本案選的是新增商品，但中央商品已有 EasyStore productId ${mappedProductId}；為避免重複建立或覆蓋舊商品已停止。`);
  }
  if (listingIntent === 'update-existing' && !mappedProductId) {
    throw new Error('本案選的是修改既有商品，但缺少 EasyStore productId；為避免誤建新品已停止。');
  }
  let productId = '';
  let variantIds = [];
  const existing = await findEasyStoreMappingInProduct(snapshot, token, mappedProductId);
  if (mappedProductId && !existing) {
    throw new Error(`中央商品記錄的 EasyStore productId ${mappedProductId} 找不到相同 SKU；已停止，不會改走全站 SKU 搜尋或建立替代商品。`);
  }
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
      if (grouped) {
        const groupedVariantIds = await syncEasyStoreVariantGroup(snapshot, recovered.productId, token);
        return { action: 'created', productId: recovered.productId, variantIds: groupedVariantIds, recoveredAfterUncertainResponse: true };
      }
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
    if (grouped) {
      variantIds = await syncEasyStoreVariantGroup(snapshot, productId, token);
      return { action, productId, variantIds };
    }
    if (!variantIds.length) throw new Error('EasyStore 商品已存在，但缺少規格編號，為避免改錯商品已停止。');
    const variantTemplate = buildEasyStoreProductBody(snapshot, true).product.variants[0];
    await easyStoreRequest(`/products/${encodeURIComponent(productId)}/variants.json`, token, {
      method: 'PUT', body: { variants: variantIds.map((id) => ({ id, ...variantTemplate })) }
    });
  }
  if (grouped) variantIds = await syncEasyStoreVariantGroup(snapshot, productId, token);
  return { action, productId, variantIds };
}

function listingIntentIdentityMissingFields(snapshot, platform) {
  const intent = normalizeListingIntent(snapshot);
  const key = clean(platform).toLowerCase() === 'easystore' ? 'easyStore' : clean(platform).toLowerCase();
  const source = snapshot && snapshot.existingPlatformListingIds && typeof snapshot.existingPlatformListingIds === 'object'
    ? snapshot.existingPlatformListingIds : {};
  const ids = Array.from(new Set((Array.isArray(source[key]) ? source[key] : [source[key]]).map(clean).filter(Boolean)));
  if (ids.length > 1) return [`${platform} ${intent === 'add-variant' ? '父商品' : '既有商品'}編號重複`];
  if (intent === 'add-variant' && ids.length !== 1) return [`${platform} 父商品編號（加入細項不可建立替代主商品）`];
  if (intent === 'update-existing' && ids.length !== 1) return [`${platform} 既有商品編號（修改模式不可建立新品）`];
  if (['create-single', 'create-group'].includes(intent) && ids.length) return [`${platform} 已有商品編號（新增模式不可覆蓋或重複建立）`];
  return [];
}

function fixedDescriptionMediaMissingFields(snapshot, platform, html, galleryImages) {
  const missing = [];
  const detailImages = normalizeUrls(snapshot && snapshot.descriptionImageUrls, 10);
  const gallery = normalizeUrls(galleryImages, 20);
  const source = clean(html);
  if (!source && !detailImages.length && !gallery.length) return missing;
  if (detailImages.length < 3) missing.push(`${platform} 詳細介紹至少三張商品圖片`);
  if (!gallery.length || gallery[gallery.length - 1] !== STORE_PROMO_IMAGE_URL) missing.push(`${platform} 橫向圖片最後一張店址圖`);
  const renderedImageUrls = [];
  source.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (_, url) => {
    const normalized = safeHttpUrl(url);
    if (normalized) renderedImageUrls.push(normalized);
    return _;
  });
  detailImages.forEach((url) => {
    if (!renderedImageUrls.includes(url)) missing.push(`${platform} 詳細介紹商品圖片`);
  });
  if (renderedImageUrls.slice(-2).join('|') !== DESCRIPTION_PROMO_IMAGE_URLS.join('|')) missing.push(`${platform} 詳細介紹最後兩張固定介紹圖`);
  const featureIndex = source.search(/<h[23]>\s*商品特色\s*<\/h[23]>/i);
  const specificationIndex = source.search(/<h[23]>\s*商品規格\s*<\/h[23]>/i);
  const usageIndex = source.search(/<h[23]>\s*(?:使用方式(?:／適用情境)?|適用情境|使用重點|使用建議)\s*<\/h[23]>/i);
  const firstImageIndex = detailImages[0] ? source.indexOf(detailImages[0]) : -1;
  const secondImageIndex = detailImages[1] ? source.indexOf(detailImages[1]) : -1;
  const thirdImageIndex = detailImages[2] ? source.indexOf(detailImages[2]) : -1;
  if (!(featureIndex >= 0 && firstImageIndex > featureIndex && specificationIndex > firstImageIndex
    && secondImageIndex > specificationIndex && usageIndex > secondImageIndex && thirdImageIndex > usageIndex)) {
    missing.push(`${platform} 固定圖文穿插順序`);
  }
  const actualProductHeadingBlock = '<h3>實體商品說明</h3>';
  const actualProductNoticeBlock = `<p>${PHYSICAL_PRODUCT_DISCLAIMER}</p>`;
  const warrantyHeadingBlock = '<h3>出貨與保固說明</h3>';
  const warrantyNoticeBlock = `<p>${WARRANTY_SUPPORT_NOTICE}</p>`;
  const actualProductHeadingIndex = source.indexOf(actualProductHeadingBlock);
  const actualProductNoticeIndex = source.indexOf(actualProductNoticeBlock);
  const warrantyHeadingIndex = source.indexOf(warrantyHeadingBlock);
  const warrantyNoticeIndex = source.indexOf(warrantyNoticeBlock);
  const firstPromoIndex = source.indexOf(DESCRIPTION_PROMO_IMAGE_URLS[0]);
  const secondPromoIndex = source.indexOf(DESCRIPTION_PROMO_IMAGE_URLS[1]);
  if (!(actualProductHeadingIndex >= 0 && actualProductNoticeIndex > actualProductHeadingIndex
    && warrantyHeadingIndex > actualProductNoticeIndex && warrantyNoticeIndex > warrantyHeadingIndex
    && firstPromoIndex > warrantyNoticeIndex && secondPromoIndex > firstPromoIndex)) {
    missing.push(`${platform} 實體商品與保固說明須位於最後兩張固定介紹圖之前`);
  }
  const finalPromoBlock = `<p><img src="${DESCRIPTION_PROMO_IMAGE_URLS[1]}" alt="柚子樂器門市與服務資訊" style="max-width:100%;height:auto"></p>`;
  if (!source.endsWith(finalPromoBlock)) missing.push(`${platform} 詳細介紹須以第二張固定介紹圖結尾`);
  return Array.from(new Set(missing));
}

function easyStoreMissingFields(snapshot) {
  const missing = [];
  missing.push(...listingIntentIdentityMissingFields(snapshot, 'EasyStore'));
  if (normalizeListingIntent(snapshot) === 'update-existing' && !clean(snapshot.listingChangeInstructions)) missing.push('修改既有商品的明確替換要求');
  missing.push(...variantRepresentativeMissingFields(snapshot));
  if (snapshot.listingMode === 'add-variant' && !snapshot.variantParentEasyStoreProductId) missing.push('父商品 EasyStore 編號');
  if (snapshot.listingMode === 'add-variant' && (!snapshot.variantAttributeName || !snapshot.variantParentAttributeValue || !snapshot.variantAttributeValue)) missing.push('細項名稱、父商品細項值與新細項值');
  if (!snapshot.sku) missing.push('SKU');
  if (!snapshot.title) missing.push('商品名稱');
  if (!snapshot.description) missing.push('完整商品介紹');
  if (!snapshot.images.length) missing.push('上架圖片');
  missing.push(...fixedDescriptionMediaMissingFields(snapshot, '官網／蝦皮', snapshot.bodyHtml, snapshot.images));
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
  missing.push(...listingIntentIdentityMissingFields(snapshot, 'momo'));
  const imagePlan = snapshot.platformImagePlan && snapshot.platformImagePlan.momo || {};
  missing.push(...variantRepresentativeMissingFields(snapshot));
  if (!snapshot.sku) missing.push('SKU');
  if (!snapshot.momoGoodsName) missing.push('MOMO 商品名稱');
  if (!snapshot.description) missing.push('完整商品介紹');
  missing.push(...fixedDescriptionMediaMissingFields(snapshot, 'MOMO', snapshot.momoHtml, galleryImagesWithStorePromo(imagePlan.imageUrls, 6)));
  if (!imagePlan.ready || imagePlan.requiredFirstRole !== 'cleanMain' || !Array.isArray(imagePlan.imageUrls) || !imagePlan.imageUrls.length) missing.push('MOMO cleanMain 首圖');
  if (!imagePlan.promotionImageReady || !snapshot.momoSpecialPromotionImageUrl) missing.push('MOMO clean-only 專推圖');
  if (snapshot.momoPrice == null) missing.push('MOMO 售價');
  const salePrice = numberOrNull(snapshot.momoPrice);
  const marketPrice = momoMarketPrice(snapshot);
  if (salePrice !== null && (marketPrice === null || marketPrice <= salePrice)) missing.push('MOMO 市價（須高於售價）');
  if (buildMomoShipping(snapshot).requiresJudgment) missing.push('MOMO 外箱長寬高與重量');
  return missing;
}

function coupangMissingFields(snapshot) {
  const missing = [];
  missing.push(...listingIntentIdentityMissingFields(snapshot, 'coupang'));
  const imagePlan = snapshot.platformImagePlan && snapshot.platformImagePlan.coupang || {};
  missing.push(...variantRepresentativeMissingFields(snapshot));
  if (!snapshot.sku) missing.push('SKU');
  if (!snapshot.coupangTitle) missing.push('酷澎標題');
  if (!snapshot.description) missing.push('完整商品介紹');
  missing.push(...fixedDescriptionMediaMissingFields(snapshot, '酷澎', snapshot.coupangDescriptionHtml, galleryImagesWithStorePromo(imagePlan.imageUrls)));
  if (!imagePlan.ready || imagePlan.requiredFirstRole !== 'cleanMain' || !Array.isArray(imagePlan.imageUrls) || !imagePlan.imageUrls.length) missing.push('酷澎 cleanMain 首圖');
  if (snapshot.coupangPrice == null) missing.push('酷澎售價');
  return missing;
}

function platformPayloadSnapshot(platform, snapshot) {
  const key = clean(platform).toLowerCase();
  if (!['coupang', 'momo'].includes(key)) return snapshot;
  const plan = snapshot.platformImagePlan && snapshot.platformImagePlan[key] && typeof snapshot.platformImagePlan[key] === 'object'
    ? snapshot.platformImagePlan[key] : {};
  const images = galleryImagesWithStorePromo(plan.imageUrls, key === 'momo' ? 6 : 7);
  return {
    ...snapshot,
    images,
    momoSpecialPromotionImageUrl: key === 'momo' ? safeHttpUrl(plan.promotionImageUrl) : snapshot.momoSpecialPromotionImageUrl,
    imagePolicy: {
      ...(snapshot.imagePolicy || {}),
      platformMainImage: key === 'coupang' || key === 'momo' ? 'cleanMain' : 'brandedHero',
      brandedHeroAllowedAfterMain: plan.brandedHeroAllowedAsSecondary === true,
      brandedHeroExcluded: false,
      removeSecondaryBrandedHeroIfPlatformRejectsGalleryLogo: plan.removeSecondaryBrandedHeroIfPlatformRejectsGalleryLogo === true
    }
  };
}

function platformStageFingerprint(platform, snapshot) {
  return platformQueueFingerprint(platform, platformPayloadSnapshot(platform, snapshot));
}

function platformCategoryResolution(platform, snapshot, product) {
  const key = clean(platform).toLowerCase();
  const code = key === 'momo' ? clean(snapshot.momoCategoryCode) : clean(snapshot.coupangCategoryCode);
  const canonical = snapshot.canonicalCategoryDecision && typeof snapshot.canonicalCategoryDecision === 'object'
    ? snapshot.canonicalCategoryDecision : buildCanonicalCategoryDecision(snapshot);
  const productHint = clean(canonical.evidenceSummary || snapshot.shopeeCategoryPath || product.category || snapshot.title).slice(0, 420);
  const hint = `共同分類已在進站前判定為「${clean(canonical.canonicalFamily) || '未判定'}」；只將它映射至本平台葉分類：${productHint}`.slice(0, 500);
  const constraint = {
    scope: 'music-instruments-only',
    allowedRootNames: ['樂器', '樂器配件'],
    canonicalCategoryKey: clean(canonical.canonicalKey),
    canonicalFamily: clean(canonical.canonicalFamily),
    decidedOnceBeforePlatformNavigation: true,
    forbidProductReclassificationInsidePlatform: true,
    selectionRule: '沿用進站前的共同商品分類，只在樂器或樂器配件分類樹內映射最接近的有效葉分類。'
  };
  return code
    ? { mode: 'provided', code, hint, source: 'listing-case', ...constraint }
    : { mode: 'map-once', code: '', hint, source: 'canonical-category-to-official-platform-taxonomy', ...constraint };
}

async function queueFixedIpPlatform(db, jobId, platform, snapshot, product, missingFields, attemptToken) {
  if (missingFields.length) {
    return { status: 'missing-fields', message: `請先補：${missingFields.join('、')}`, missingFields };
  }
  const normalizedAttemptToken = clean(attemptToken);
  if (!normalizedAttemptToken) throw new Error(`${platform} 缺少本次逐站排程 attemptToken，已停止以避免舊回條混入。`);
  const platformSnapshot = platformPayloadSnapshot(platform, snapshot);
  const queueRef = db.collection(PLATFORM_QUEUE_COLLECTION).doc(`${snapshot.productId}_${platform.toLowerCase()}`);
  if (platformSnapshot.variantGroupEnabled === true) {
    const childQueueRefs = (platformSnapshot.variantGroupVariants || []).slice(1)
      .map((row) => clean(row && row.productId)).filter(Boolean)
      .map((childId) => db.collection(PLATFORM_QUEUE_COLLECTION).doc(`${childId}_${platform.toLowerCase()}`));
    await Promise.all(childQueueRefs.map(async (childRef) => {
      const childSnap = await childRef.get();
      if (!childSnap.exists) return;
      const childQueue = childSnap.data() || {};
      if (!PLATFORM_QUEUE_PENDING_STATUSES.has(clean(childQueue.status).toLowerCase())) return;
      await childRef.set({
        status: 'superseded-by-variant-group', supersededByJobId: jobId,
        supersededByProductId: platformSnapshot.productId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }));
  }
  const listingPolicy = buildPlatformQueuePolicy(product, platform, platformSnapshot);
  const categoryResolution = platformCategoryResolution(platform, platformSnapshot, product);
  if (listingPolicy.mode === 'block-duplicate' || listingPolicy.mode === 'block-duplicate-parent') {
    return {
      status: 'action-required',
      message: `${platform} 已對到 ${listingPolicy.existingListingIds.length} 個可能的${listingPolicy.mode === 'block-duplicate-parent' ? '父商品' : '相同 SKU 商品'}，為避免更新錯商品已停止。`
    };
  }
  if (listingPolicy.mode === 'block-missing-parent') {
    return { status: 'action-required', message: `${platform} 尚未找到父商品的平台編號；請先確認父商品已上架，再加入新細項。` };
  }
  if (listingPolicy.mode === 'block-existing-target-for-create') {
    return { status: 'action-required', message: `${platform} 已保存既有商品編號 ${listingPolicy.existingListingIds.join('、')}，但本案選的是新增商品；為避免建立重複商品或覆蓋舊商品已停止。` };
  }
  if (listingPolicy.mode === 'block-missing-existing-target') {
    return { status: 'action-required', message: `${platform} 缺少本案要原地修改的既有商品編號；為避免誤建新品已停止。` };
  }
  const fingerprint = platformQueueFingerprint(platform, platformSnapshot);
  let reusedStatus = '';
  await db.runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(queueRef);
    const existing = existingSnapshot.exists ? existingSnapshot.data() || {} : {};
    const sameIdentity = normalizeSku(existing.sku) === snapshot.sku
      && clean(existing.productId) === platformSnapshot.productId;
    const sameFingerprint = clean(existing.fingerprint) === fingerprint;
    const existingStatus = clean(existing.status).toLowerCase();
    const sameAttempt = clean(existing.workflowVersion) === LISTING_WORKFLOW_ID
      && clean(existing.jobId) === jobId
      && clean(existing.attemptToken || existing.stageToken) === normalizedAttemptToken;
    if (sameIdentity && sameFingerprint && sameAttempt && PLATFORM_QUEUE_PENDING_STATUSES.has(existingStatus)) {
      reusedStatus = 'already-queued';
      return;
    }
    if (sameIdentity && sameFingerprint && !sameAttempt && PLATFORM_QUEUE_PENDING_STATUSES.has(existingStatus)) {
      // A newer v3 job for the exact same SKU and immutable payload may safely
      // take over an unfinished queue slot.  Keep the previous attempt in the
      // audit trail, but never reuse its receipt or stage token.
      transaction.set(queueRef, {
        supersededAttempt: {
          jobId: clean(existing.jobId),
          attemptToken: clean(existing.attemptToken || existing.stageToken),
          status: existingStatus,
          supersededAt: admin.firestore.FieldValue.serverTimestamp()
        }
      }, { merge: true });
    }
    if (sameIdentity && sameFingerprint && sameAttempt && PLATFORM_QUEUE_RECEIPT_STATUSES.has(existingStatus)) {
      reusedStatus = 'already-completed';
      return;
    }
    transaction.set(queueRef, {
      jobId, productId: platformSnapshot.productId, sku: platformSnapshot.sku, platform,
      workflowVersion: LISTING_WORKFLOW_ID,
      attemptToken: normalizedAttemptToken,
      stageToken: normalizedAttemptToken,
      snapshotFingerprint: listingSnapshotFingerprint(snapshot),
      status: 'awaiting-store-agent', payload: { ...platformSnapshot, categoryResolution }, listingPolicy, fingerprint,
      verificationRequirements: snapshot.automationPolicy && snapshot.automationPolicy.publishVerification,
      verificationReceipt: null, verifiedChecks: null, completedAt: null, error: '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: '全通路營運中心', schemaVersion: 3
    }, { merge: true });
  });
  if (reusedStatus === 'already-queued') {
    return {
      status: 'already-queued',
      message: `${platform} 相同 SKU 的工作已在處理中，本次不會再排第二筆。`,
      queueId: queueRef.id,
      fingerprint,
      attemptToken: normalizedAttemptToken
    };
  }
  if (reusedStatus === 'already-completed') {
    return {
      status: 'already-completed',
      message: `${platform} 相同版本已處理完成，本次不會重複建立。`,
      queueId: queueRef.id,
      fingerprint,
      attemptToken: normalizedAttemptToken
    };
  }
  const categoryPrefix = categoryResolution.mode === 'map-once' ? `${platform} 會沿用進站前已判定的共同分類，只映射一次本平台的樂器／樂器配件葉分類；` : '';
  const message = categoryPrefix + (listingPolicy.mode === 'add-variant-to-existing'
    ? `${platform} 將把 SKU ${platformSnapshot.sku} 加入指定的既有商品，子編號的庫存與價格仍獨立。`
    : listingPolicy.mode === 'merge-variant-group-into-existing'
      ? `${platform} 將以既有平台商品編號為主商品，把所選 SKU 合併成同一組細項；各編號的庫存與價格仍獨立。`
    : listingPolicy.existingListingIds.length
    ? `${platform} 已找到既有平台編號，將更新原商品，不會建立第二筆。`
    : `${platform} 沒有中央平台編號，將直接建立同一份草稿；只有送出結果不明時才用完全相同 SKU 回查，不會先掃描全站商品。`);
  return {
    status: 'awaiting-store-agent',
    message,
    queueId: queueRef.id,
    fingerprint,
    attemptToken: normalizedAttemptToken
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

function expectedStagePrice(stage, snapshot) {
  if (stage === 'momo') return numberOrNull(snapshot.momoPrice);
  if (stage === 'coupang') return numberOrNull(snapshot.coupangPrice);
  return numberOrNull(snapshot.easyStorePrice);
}

function collectImageUrls(value, imageContext = false, result = [], visited = new Set()) {
  if (value === null || value === undefined) return result;
  if (typeof value === 'string') {
    if (imageContext) {
      const url = safeHttpUrl(value);
      if (url && !result.includes(url)) result.push(url);
    }
    return result;
  }
  if (typeof value !== 'object' || visited.has(value)) return result;
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => collectImageUrls(entry, imageContext, result, visited));
    return result;
  }
  Object.entries(value).forEach(([key, entry]) => {
    const nextImageContext = imageContext || /(image|photo|picture|thumbnail|gallery)/i.test(key);
    if (typeof entry === 'string') {
      if (nextImageContext || (imageContext && /^(url|src)$/i.test(key))) collectImageUrls(entry, true, result, visited);
    } else {
      collectImageUrls(entry, nextImageContext, result, visited);
    }
  });
  return result;
}

function frozenSourceImageUrls(snapshot) {
  const plan = snapshot && snapshot.platformImagePlan && typeof snapshot.platformImagePlan === 'object'
    ? snapshot.platformImagePlan : {};
  const values = [];
  (Array.isArray(plan.roleAssignments) ? plan.roleAssignments : []).forEach((row) => values.push(row && row.sourceImageUrl));
  (Array.isArray(plan.imageReferenceCases) ? plan.imageReferenceCases : []).forEach((row) => {
    values.push(row && row.representativeSourceImageUrl);
    (Array.isArray(row && row.sourceImageUrls) ? row.sourceImageUrls : []).forEach((url) => values.push(url));
  });
  return new Set(normalizeUrls(values, 1000));
}

function validatePlatformImageEvidence(stage, snapshot, verification) {
  const name = clean(stage).toLowerCase();
  const planKey = name === 'easystore' ? 'easyStore' : name;
  const observed = verification && typeof verification === 'object' ? verification : {};
  const plan = snapshot && snapshot.platformImagePlan && typeof snapshot.platformImagePlan === 'object'
    ? snapshot.platformImagePlan : {};
  const platformPlan = plan[planKey] && typeof plan[planKey] === 'object' ? plan[planKey] : {};
  const expected = normalizeUrls(platformPlan.imageUrls, 12);
  const rawAppliedImageUrls = Array.isArray(observed.appliedImageUrls) ? observed.appliedImageUrls : [];
  const rawOfficialImageUrls = Array.isArray(observed.officialImageUrls) ? observed.officialImageUrls : [];
  const appliedImageUrls = normalizeUrls(rawAppliedImageUrls, 100);
  const officialImageUrls = normalizeUrls(rawOfficialImageUrls, 100);
  const sourceUrls = frozenSourceImageUrls(snapshot);
  const allowed = new Set(expected);
  if (name === 'easystore' || name === 'shopee') {
    normalizeUrls(snapshot && snapshot.images, 20).forEach((url) => allowed.add(url));
  }
  const reasons = [];
  const hasPostSubmitEvidence = rawAppliedImageUrls.length > 0 || rawOfficialImageUrls.length > 0;
  if (!hasPostSubmitEvidence) {
    return {
      verified: true,
      reasons,
      appliedImageUrls,
      officialImageUrls,
      imageEvidenceComplete: false,
      skippedAfterPreflight: true
    };
  }
  if (appliedImageUrls.some((url) => sourceUrls.has(url))) reasons.push('applied-image-evidence-contains-frozen-source');
  if (officialImageUrls.some((url) => sourceUrls.has(url))) reasons.push('official-image-evidence-contains-frozen-source');
  if (appliedImageUrls.some((url) => !allowed.has(url))) reasons.push('applied-image-evidence-outside-final-plan');
  if (appliedImageUrls.length && expected[0] && appliedImageUrls[0] !== expected[0]) reasons.push('applied-image-evidence-first-role-mismatch');
  return {
    verified: reasons.length === 0,
    reasons,
    appliedImageUrls,
    officialImageUrls,
    imageEvidenceComplete: observed.imageEvidenceComplete === true
  };
}

function validatePlatformStageVerification(stage, snapshot, verification) {
  const name = clean(stage).toLowerCase();
  const observed = verification && typeof verification === 'object' ? verification : {};
  const reasons = [];
  const expectedSku = normalizeSku(snapshot && snapshot.sku);
  const observedSku = normalizeSku(observed.sku);
  const expectedPrice = expectedStagePrice(name, snapshot || {});
  const expectedStock = numberOrNull(snapshot && snapshot.stock);
  const observedPrice = numberOrNull(observed.price);
  const observedStock = numberOrNull(observed.stock);
  const grouped = snapshot && snapshot.variantGroupEnabled === true;
  const addVariant = clean(snapshot && snapshot.listingMode) === 'add-variant' || clean(snapshot && snapshot.listingIntent) === 'add-variant';
  const expectedVariants = grouped ? (Array.isArray(snapshot.variantGroupVariants) ? snapshot.variantGroupVariants : []) : [];
  const expectedVariantImages = grouped ? expectedVariants : addVariant ? [{
    sku: normalizeSku(snapshot && snapshot.sku),
    imageUrl: safeHttpUrl(snapshot && snapshot.variantChildImageUrl)
  }] : [];
  const observedVariants = (grouped || addVariant) ? (Array.isArray(observed.variants) ? observed.variants : []).map((row) => ({
    sku: normalizeSku(row && row.sku),
    value: clean(row && (row.value || row.attributeValue || row.name || row.title)),
    price: numberOrNull(row && row.price),
    stock: numberOrNull(row && row.stock),
    imageUrl: safeHttpUrl(row && row.imageUrl)
  })) : [];
  if (!['easystore', 'shopee', 'coupang', 'momo'].includes(name)) reasons.push('unsupported-stage');
  if (!clean(observed.listingId || observed.productId)) reasons.push('missing-listing-id');
  if (!expectedSku || observedSku !== expectedSku) reasons.push('sku-mismatch');
  if (!grouped && expectedPrice !== null && observedPrice !== expectedPrice) reasons.push('price-mismatch');
  if (!grouped && expectedStock !== null && observedStock !== expectedStock) reasons.push('stock-mismatch');
  const observedByVariantSku = new Map(observedVariants.map((row) => [normalizeSku(row && row.sku), row]));
  if (grouped) {
    const expectedBySku = new Map(expectedVariants.map((row) => [normalizeSku(row && row.sku), row]));
    if (expectedBySku.size < 2 || observedVariants.length !== expectedBySku.size || observedByVariantSku.size !== expectedBySku.size) reasons.push('variant-sku-set-mismatch');
    expectedBySku.forEach((expected, sku) => {
      const actual = observedByVariantSku.get(sku);
      if (!actual) return;
      const platformPrice = name === 'momo' ? numberOrNull(expected.momoPrice)
        : name === 'coupang' ? numberOrNull(expected.coupangPrice) : numberOrNull(expected.easyStorePrice);
      if (platformPrice !== null && actual.price !== platformPrice) reasons.push(`variant-price-mismatch:${sku}`);
      const platformStock = numberOrNull(expected && expected.stock);
      if (platformStock !== null && actual.stock !== platformStock) reasons.push(`variant-stock-mismatch:${sku}`);
      if (clean(expected.attributeValue) && actual.value && actual.value !== clean(expected.attributeValue)) reasons.push(`variant-value-mismatch:${sku}`);
    });
  }
  const sourceUrls = frozenSourceImageUrls(snapshot || {});
  expectedVariantImages.forEach((expected) => {
    const sku = normalizeSku(expected && expected.sku);
    const plannedImageUrl = safeHttpUrl(expected && expected.imageUrl);
    const actual = observedByVariantSku.get(sku);
    if (!plannedImageUrl) reasons.push(`variant-image-plan-missing:${sku}`);
    if (!actual) {
      if (addVariant) reasons.push(`variant-sku-missing:${sku}`);
      return;
    }
    if (!actual.imageUrl) reasons.push(`variant-image-missing:${sku}`);
    else if (sourceUrls.has(actual.imageUrl)) reasons.push(`variant-image-frozen-source:${sku}`);
  });
  if (name === 'shopee' && snapshot && snapshot.shopeeAdvancedDescription) {
    const advancedEvidence = observed.advancedDescriptionEvidence && typeof observed.advancedDescriptionEvidence === 'object'
      ? observed.advancedDescriptionEvidence : {};
    const expectedDescriptionImageCount = Number(snapshot.shopeeAdvancedDescription.expectedImageCount) || 0;
    if (advancedEvidence.complete !== true) reasons.push('shopee-advanced-description-not-verified');
    if (advancedEvidence.verificationSurface !== 'shopee-seller-center') {
      reasons.push('shopee-advanced-description-not-verified-in-seller-center');
    }
    if (advancedEvidence.persistedAfterReload !== true) {
      reasons.push('shopee-advanced-description-not-persisted-after-reload');
    }
    if (advancedEvidence.exactImageCount !== true
      || Number(advancedEvidence.observedImageCount) !== expectedDescriptionImageCount) {
      reasons.push('shopee-advanced-description-image-count-mismatch');
    }
    if (advancedEvidence.imageOrderComplete !== true) reasons.push('shopee-advanced-description-image-order-mismatch');
    if (advancedEvidence.fixedLastTwoComplete !== true) reasons.push('shopee-advanced-description-final-promos-mismatch');
    if (advancedEvidence.fixedNoticesBeforePromos !== true) reasons.push('shopee-advanced-description-fixed-notices-mismatch');
    const priceEvidence = observed.priceAdjustmentEvidence && typeof observed.priceAdjustmentEvidence === 'object'
      ? observed.priceAdjustmentEvidence : {};
    if (priceEvidence.enabled !== true || priceEvidence.synchronizeWithEasyStorePrice !== true) {
      reasons.push('shopee-price-sync-not-verified');
    }
  }
  const observedStatus = clean(observed.status);
  if (!observedStatus) reasons.push('missing-status');
  else if (['draft', 'unpublished', 'inactive', 'failed', 'rejected', 'error', '暫存', '草稿', '未上架', '未發布', '未發佈'].includes(observedStatus.toLowerCase())) reasons.push('not-submitted-or-published');
  if (observed.platformListMatched !== true && observed.officialCatalogMatched !== true) reasons.push('no-official-list-match');
  const imageVerification = validatePlatformImageEvidence(name, snapshot || {}, observed);
  reasons.push(...imageVerification.reasons);
  return {
    verified: reasons.length === 0,
    reasons,
    receipt: {
      stage: name,
      listingId: clean(observed.listingId || observed.productId),
      sku: observedSku,
      price: observedPrice,
      stock: observedStock,
      variants: observedVariants,
      status: clean(observed.status),
      platformListMatched: observed.platformListMatched === true,
      officialCatalogMatched: observed.officialCatalogMatched === true,
      imageEvidenceComplete: imageVerification.imageEvidenceComplete,
      appliedImageUrls: imageVerification.appliedImageUrls,
      officialImageUrls: imageVerification.officialImageUrls,
      advancedDescriptionEvidence: observed.advancedDescriptionEvidence || null,
      priceAdjustmentEvidence: observed.priceAdjustmentEvidence || null
    }
  };
}

function initialListingStages(snapshot = null) {
  const selected = new Set(listingTargetPlatforms(snapshot || 'all'));
  return {
    momo: { status: selected.has('momo') ? 'ready' : 'skipped' },
    coupang: { status: selected.has('coupang') ? 'ready' : 'skipped' },
    easyStore: { status: selected.has('easyStore') ? 'ready' : 'skipped' },
    shopee: selected.has('shopee') ? { status: 'blocked-by-dependency', dependsOn: ['easyStore'] } : { status: 'skipped' }
  };
}

function listingStageVerified(stages, stage) {
  const state = stages && stages[stage] && typeof stages[stage] === 'object' ? stages[stage] : {};
  return ['verified', 'skipped'].includes(clean(state.status).toLowerCase());
}

function listingStageExplicitlyVerified(stages, stage) {
  const state = stages && stages[stage] && typeof stages[stage] === 'object' ? stages[stage] : {};
  return clean(state.status).toLowerCase() === 'verified';
}

function allListingStagesVerified(stages) {
  return PLATFORM_EXECUTION_ORDER.every((stage) => listingStageVerified(stages, stage));
}

function deriveListingCurrentStage(stages) {
  if (allListingStagesVerified(stages)) return 'finalizing';
  if (listingStageVerified(stages, 'easyStore') && !listingStageVerified(stages, 'shopee')) return 'shopee';
  return 'parallel-platforms';
}

const LISTING_BATCH_FAILURE_STATUSES = new Set([
  'failed', 'error', 'missing-fields', 'action-required', 'blocked', 'rejected',
  'rate-limited', 'limit-reached', 'permission-denied', 'unavailable'
]);

function listingBatchPlatformLabel(stage) {
  return ({ easyStore: 'EasyStore 官網', shopee: '官方蝦皮', momo: 'MOMO', coupang: '酷澎' })[stage] || stage;
}

function listingRetryAtMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value === 'number') return value < 100000000000 ? value * 1000 : value;
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function listingBatchFailurePayload(snapshot, stages, platforms, fallbackMessage = '') {
  const currentStages = stages && typeof stages === 'object' ? stages : {};
  const currentPlatforms = platforms && typeof platforms === 'object' ? platforms : {};
  const selected = listingTargetPlatforms(snapshot);
  const failures = {};
  const retryPlatforms = [];
  const retryTimes = [];
  selected.forEach((stage) => {
    const stageState = currentStages[stage] && typeof currentStages[stage] === 'object' ? currentStages[stage] : {};
    const platformState = currentPlatforms[stage] && typeof currentPlatforms[stage] === 'object' ? currentPlatforms[stage] : {};
    const stageStatus = clean(stageState.status).toLowerCase();
    const platformStatus = clean(platformState.status).toLowerCase();
    const failed = LISTING_BATCH_FAILURE_STATUSES.has(stageStatus)
      || LISTING_BATCH_FAILURE_STATUSES.has(platformStatus)
      || (stageStatus === 'blocked-by-dependency' && clean(fallbackMessage));
    if (!failed && !clean(fallbackMessage)) return;
    if (!failed && listingStageVerified(currentStages, stage)) return;
    const reason = clean(stageState.message || platformState.message || platformState.error || fallbackMessage)
      || `${listingBatchPlatformLabel(stage)}尚未完成。`;
    const retryAt = stageState.retryAt || stageState.nextRetryAt || platformState.retryAt
      || platformState.nextRetryAt || platformState.availableAt || null;
    const retryable = stageState.retryable !== false && platformState.retryable !== false;
    failures[stage] = {
      status: stageStatus || platformStatus || 'failed', reason: reason.slice(0, 800), retryable,
      lastAttemptAt: new Date()
    };
    if (retryAt) {
      failures[stage].retryAt = retryAt;
      const retryMillis = listingRetryAtMillis(retryAt);
      if (retryMillis) retryTimes.push({ millis: retryMillis, value: retryAt });
    }
    retryPlatforms.push(stage);
  });
  if (!retryPlatforms.length) return null;
  retryTimes.sort((left, right) => right.millis - left.millis);
  return {
    batchQueueStatus: 'failed',
    batchQueueError: retryPlatforms.map((stage) => `${listingBatchPlatformLabel(stage)}：${failures[stage].reason}`).join('；').slice(0, 1600),
    batchPlatformFailures: failures,
    batchRetryPlatforms: retryPlatforms,
    batchNextRetryAt: retryTimes.length ? retryTimes[0].value : null,
    batchQueueUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

function listingRootStageNeedsResume(snapshot, stages) {
  return ['momo', 'coupang'].some((stage) => {
    if (!listingStageSelected(snapshot, stage)) return false;
    const state = stages && stages[stage] && typeof stages[stage] === 'object' ? stages[stage] : {};
    return !['awaiting-verification', 'verified', 'skipped'].includes(clean(state.status).toLowerCase());
  });
}

function queueStageFromPlatform(platform) {
  const key = clean(platform).toLowerCase();
  if (key === 'coupang' || key === 'momo') return key;
  return '';
}

function validateQueuedStageReceiptIdentity(job, queueRecord) {
  const currentJob = job && typeof job === 'object' ? job : {};
  const record = queueRecord && typeof queueRecord === 'object' ? queueRecord : {};
  const stage = queueStageFromPlatform(record.platform);
  const stages = currentJob.stages && typeof currentJob.stages === 'object' ? currentJob.stages : {};
  const stageState = stage && stages[stage] && typeof stages[stage] === 'object' ? stages[stage] : {};
  const reasons = [];
  if (!stage) reasons.push('unsupported-platform');
  if (clean(currentJob.workflowVersion) !== LISTING_WORKFLOW_ID || clean(record.workflowVersion) !== LISTING_WORKFLOW_ID) reasons.push('workflow-version-mismatch');
  if (!clean(currentJob.productId) || clean(record.productId) !== clean(currentJob.productId)) reasons.push('product-mismatch');
  if (!clean(record.jobId) || clean(record.jobId) !== clean(currentJob.id || currentJob.jobId)) reasons.push('job-mismatch');
  if (!clean(record.attemptToken) || clean(record.attemptToken) !== clean(stageState.attemptToken)) reasons.push('attempt-token-mismatch');
  if (!clean(record.fingerprint) || clean(record.fingerprint) !== clean(stageState.fingerprint)) reasons.push('fingerprint-mismatch');
  if (!clean(record.snapshotFingerprint) || clean(record.snapshotFingerprint) !== clean(currentJob.preparedSnapshotFingerprint)) reasons.push('snapshot-fingerprint-mismatch');
  return { verified: reasons.length === 0, reasons: Array.from(new Set(reasons)), stage };
}

function validateQueuedStageReceipt(job, queueRecord) {
  const currentJob = job && typeof job === 'object' ? job : {};
  const record = queueRecord && typeof queueRecord === 'object' ? queueRecord : {};
  const identity = validateQueuedStageReceiptIdentity(currentJob, record);
  const stage = identity.stage;
  const reasons = identity.reasons.slice();
  if (!PLATFORM_QUEUE_RECEIPT_STATUSES.has(clean(record.status).toLowerCase())) reasons.push('queue-status-not-verified');
  const receipt = record.verificationReceipt && typeof record.verificationReceipt === 'object' ? record.verificationReceipt : {};
  if (clean(receipt.stage) && clean(receipt.stage).toLowerCase() !== stage) reasons.push('receipt-stage-mismatch');
  const verification = validatePlatformStageVerification(stage, currentJob.preparedSnapshot || {}, receipt);
  reasons.push(...verification.reasons);
  return { verified: reasons.length === 0, reasons: Array.from(new Set(reasons)), stage, receipt: verification.receipt };
}

function preparedImageReferenceCases(snapshot) {
  const plan = snapshot && snapshot.platformImagePlan && typeof snapshot.platformImagePlan === 'object'
    ? snapshot.platformImagePlan : {};
  return (Array.isArray(plan.imageReferenceCases) ? plan.imageReferenceCases : []).map((row) => ({
    productId: clean(row && row.productId),
    sku: clean(row && row.sku),
    sourceImageUrls: normalizeUrls(row && row.sourceImageUrls, 20),
    representativeSourceImageUrl: safeHttpUrl(row && row.representativeSourceImageUrl),
    representativeCompletedImageUrl: safeHttpUrl(row && row.representativeCompletedImageUrl)
  })).filter((row) => row.productId);
}

function centralCompletedImageUpdate(snapshot, productId, productRecord = {}) {
  const plan = snapshot && snapshot.platformImagePlan && typeof snapshot.platformImagePlan === 'object'
    ? snapshot.platformImagePlan : {};
  const rows = (Array.isArray(plan.roleAssignments) ? plan.roleAssignments : []).filter((row) => (
    clean(row && row.productId) === clean(productId)
    && safeHttpUrl(row && row.url)
    && safeHttpUrl(row && row.url) !== safeHttpUrl(row && row.sourceImageUrl)
  ));
  const completedUrls = normalizeUrls(rows.map((row) => row.url), 100);
  const references = preparedImageReferenceCases(snapshot);
  const reference = references.find((row) => row.productId === clean(productId)) || {};
  const representativeUrl = safeHttpUrl(reference.representativeCompletedImageUrl);
  const representativeRow = rows.find((row) => safeHttpUrl(row.url) === representativeUrl && cleanRepresentativeRoleRow(row));
  const cleanRow = rows.find((row) => row.roles.includes('cleanMain') && cleanRepresentativeRoleRow(row))
    || rows.find((row) => row.roles.includes('variantRepresentative') && cleanRepresentativeRoleRow(row));
  const existingUrl = safeHttpUrl(productRecord && productRecord.imageUrl);
  const imageUrl = representativeRow ? representativeRow.url : cleanRow ? cleanRow.url : completedUrls.includes(existingUrl) ? existingUrl : '';
  if (!imageUrl) return {};
  return {
    imageUrl,
    imageUrls: [imageUrl].concat(completedUrls.filter((url) => url !== imageUrl)),
    completedListingImageUrls: completedUrls
  };
}

function completedVariantRecords(productRecord, completedBySku, fallbackUpdate, frozenSources) {
  const variants = Array.isArray(productRecord && productRecord.variants) ? productRecord.variants : null;
  if (!variants) return null;
  return variants.map((variant) => {
    if (!variant || typeof variant !== 'object') return variant;
    const matched = completedBySku.get(normalizeSku(variant.sku || variant.internalSku || variant.code));
    const hasFrozenImage = collectImageUrls(variant, false).some((url) => frozenSources.has(url));
    const update = matched || (hasFrozenImage ? fallbackUpdate : null);
    if (!update || !safeHttpUrl(update.imageUrl)) return variant;
    const next = { ...variant };
    ['imageUrl', 'image', 'picture', 'photo', 'thumbnail'].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(next, key) || matched || hasFrozenImage) next[key] = update.imageUrl;
    });
    ['imageUrls', 'images', 'photos', 'gallery'].forEach((key) => {
      if (Array.isArray(next[key])) next[key] = update.imageUrls.slice();
    });
    return next;
  });
}

async function syncPreparedCentralImagesBeforePublish(db, snapshot, actor = '固定四通路流程 v3') {
  const references = preparedImageReferenceCases(snapshot);
  if (!references.length) throw new Error('完成圖快照沒有可回寫的中央商品。');
  const documents = await Promise.all(references.map(async (reference) => {
    const productRef = db.collection(PRODUCT_COLLECTION).doc(reference.productId);
    const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(reference.productId);
    const productSnap = await productRef.get();
    if (!productSnap.exists) throw new Error(`${reference.sku || reference.productId}的中央商品已不存在。`);
    const productRecord = productSnap.data() || {};
    const update = centralCompletedImageUpdate(snapshot, reference.productId, productRecord);
    if (!safeHttpUrl(update.imageUrl) || !normalizeUrls(update.imageUrls, 100).length) {
      throw new Error(`${reference.sku || reference.productId}缺少可回寫的 cleanMain／variantRepresentative 完成圖。`);
    }
    return { reference, productRef, caseRef, productRecord, update };
  }));
  const frozenSources = frozenSourceImageUrls(snapshot);
  const completedBySku = new Map(documents.map((row) => [normalizeSku(row.reference.sku), row.update]).filter((row) => row[0]));
  const batch = db.batch();
  documents.forEach((row) => {
    const imageUrls = normalizeUrls(row.update.imageUrls, 100);
    if (imageUrls.some((url) => frozenSources.has(url))) throw new Error(`${row.reference.sku || row.reference.productId}的中央商品完成圖仍包含來源原圖。`);
    const variants = completedVariantRecords(row.productRecord, completedBySku, row.update, frozenSources);
    const productUpdate = {
      imageUrl: row.update.imageUrl,
      imageUrls,
      parentImageUrls: [],
      variantImageUrls: [],
      completedListingImageUrls: normalizeUrls(row.update.completedListingImageUrls || imageUrls, 100),
      imageSource: 'localized-clean-main',
      completedListingImagesUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: actor
    };
    if (variants) productUpdate.variants = variants;
    batch.set(row.productRef, productUpdate, { merge: true });
    batch.set(row.caseRef, {
      centralImageReferenceVerification: {
        status: 'verified', cleanMainUrl: row.update.imageUrl, imageUrls,
        representativeSourceImageUrl: row.reference.representativeSourceImageUrl || '',
        representativeCompletedImageUrl: row.reference.representativeCompletedImageUrl || '',
        verifiedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      sourceImageRetentionPolicy: {
        mode: 'retain-source-binaries-fast-validation', sourceBinaryCleanupRequired: false,
        cleanupStatus: 'retained', cleanupWorkerRequired: false, eligibleForDeletion: false
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: actor
    }, { merge: true });
  });
  await batch.commit();
  const verified = await Promise.all(documents.map(async (row) => {
    const [productSnap, caseSnap] = await Promise.all([row.productRef.get(), row.caseRef.get()]);
    const productRecord = productSnap.exists ? productSnap.data() || {} : {};
    const caseRecord = caseSnap.exists ? caseSnap.data() || {} : {};
    const central = caseRecord.centralImageReferenceVerification && typeof caseRecord.centralImageReferenceVerification === 'object'
      ? caseRecord.centralImageReferenceVerification : {};
    const productImages = collectImageUrls(productRecord, false);
    if (safeHttpUrl(productRecord.imageUrl) !== safeHttpUrl(row.update.imageUrl)
      || !productImages.includes(safeHttpUrl(row.update.imageUrl))
      || productImages.some((url) => frozenSources.has(url))
      || clean(central.status).toLowerCase() !== 'verified'
      || safeHttpUrl(central.cleanMainUrl) !== safeHttpUrl(row.update.imageUrl)) {
      throw new Error(`${row.reference.sku || row.reference.productId}的繁體完成圖回寫後重讀不一致，尚未操作任何平台。`);
    }
    return { productId: row.reference.productId, sku: row.reference.sku, imageUrl: row.update.imageUrl, imageUrls: normalizeUrls(row.update.imageUrls, 100) };
  }));
  return { verified: true, products: verified };
}

function validateAllPlatformImageReceipts(snapshot, stages) {
  const source = stages && typeof stages === 'object' ? stages : {};
  const reasons = [];
  const receipts = {};
  PLATFORM_EXECUTION_ORDER.forEach((stage) => {
    if (!listingStageSelected(snapshot, stage)) return;
    const state = source[stage] && typeof source[stage] === 'object' ? source[stage] : {};
    const receipt = state.receipt && typeof state.receipt === 'object' ? state.receipt : {};
    if (clean(state.status).toLowerCase() !== 'verified') reasons.push(`${stage}:stage-not-verified`);
    const verification = validatePlatformStageVerification(stage, snapshot || {}, receipt);
    receipts[stage] = verification.receipt;
    verification.reasons.forEach((reason) => reasons.push(`${stage}:${reason}`));
  });
  return { verified: reasons.length === 0, reasons: Array.from(new Set(reasons)), receipts };
}

function validateCompletionImageReferences(snapshot, records, stages = null) {
  const plan = snapshot && snapshot.platformImagePlan && typeof snapshot.platformImagePlan === 'object'
    ? snapshot.platformImagePlan : {};
  const reasons = platformImagePlanMissingFields(plan, { requireFinalized: true, targetPlatforms: listingTargetPlatforms(snapshot) }).map((field) => `platform-image-plan:${field}`);
  const roleRows = Array.isArray(plan.roleAssignments) ? plan.roleAssignments : [];
  const roleRowsFor = (productId, url, sourceUrl) => roleRows.filter((row) => {
    if (productId && clean(row && row.productId) !== clean(productId)) return false;
    if (url && safeHttpUrl(row && row.url) !== safeHttpUrl(url)) return false;
    if (sourceUrl && safeHttpUrl(row && row.sourceImageUrl) !== safeHttpUrl(sourceUrl)) return false;
    return true;
  });
  const isCleanRole = (row) => cleanRepresentativeRoleRow(row);
  const references = preparedImageReferenceCases(snapshot);
  const frozenSources = frozenSourceImageUrls(snapshot);
  if (!references.length) reasons.push('missing-image-reference-cases');
  const recordsByProductId = new Map((Array.isArray(records) ? records : []).map((row) => [clean(row && row.productId), row]));
  references.forEach((reference) => {
    const record = recordsByProductId.get(reference.productId) || {};
    const caseRecord = record.caseRecord && typeof record.caseRecord === 'object' ? record.caseRecord : {};
    const productRecord = record.productRecord && typeof record.productRecord === 'object' ? record.productRecord : {};
    const central = caseRecord.centralImageReferenceVerification && typeof caseRecord.centralImageReferenceVerification === 'object'
      ? caseRecord.centralImageReferenceVerification : {};
    const centralUrl = safeHttpUrl(central.cleanMainUrl);
    const productImages = collectImageUrls(productRecord, false).slice(0, 1000);
    if (productImages.some((url) => frozenSources.has(url))) reasons.push(`${reference.productId}:central-or-variant-image-still-frozen-source`);
    if (centralUrl && frozenSources.has(centralUrl)) reasons.push(`${reference.productId}:central-verification-still-frozen-source`);
    if (clean(central.status).toLowerCase() !== 'verified') reasons.push(`${reference.productId}:central-image-not-verified`);
    const centralRows = roleRowsFor(reference.productId, centralUrl, '');
    if (!centralUrl || !centralRows.some(isCleanRole)) reasons.push(`${reference.productId}:central-image-not-clean-role-output`);
    if (!centralUrl || safeHttpUrl(productRecord.imageUrl) !== centralUrl || !productImages.includes(centralUrl)) {
      reasons.push(`${reference.productId}:central-product-image-reference-mismatch`);
    }
    if (reference.representativeSourceImageUrl) {
      const representativeRows = roleRowsFor(reference.productId, reference.representativeCompletedImageUrl, reference.representativeSourceImageUrl);
      if (!reference.representativeCompletedImageUrl || !representativeRows.some(isCleanRole)) {
        reasons.push(`${reference.productId}:variant-representative-not-clean-role-output`);
      } else if (!productImages.includes(reference.representativeCompletedImageUrl)) {
        reasons.push(`${reference.productId}:variant-representative-not-in-central-images`);
      }
    }
  });
  if (stages) {
    const platformVerification = validateAllPlatformImageReceipts(snapshot, stages);
    reasons.push(...platformVerification.reasons);
  } else {
    reasons.push('missing-selected-platform-image-receipts');
  }
  return { verified: reasons.length === 0, reasons: Array.from(new Set(reasons)), references };
}

async function publishEasyStoreStage(db, jobId, snapshot, product, dependencies = {}) {
  const token = clean(Object.prototype.hasOwnProperty.call(dependencies, 'easyStoreToken')
    ? dependencies.easyStoreToken : EASYSTORE_ACCESS_TOKEN.value());
  if (!token) throw new Error('尚未設定 EASYSTORE_ACCESS_TOKEN。');
  const upsert = dependencies.upsertEasyStoreProduct || upsertEasyStoreProduct;
  const verify = dependencies.verifyEasyStorePublishedListing || verifyEasyStorePublishedListing;
  const result = await upsert(snapshot, product, token);
  const receipt = await verify(snapshot, token, result);
  const productId = clean(snapshot.productId);
  const productRef = db.collection(PRODUCT_COLLECTION).doc(productId);
  const previousMappings = product.platformMappings && typeof product.platformMappings === 'object' ? product.platformMappings : {};
  const centralImageUpdate = centralCompletedImageUpdate(snapshot, productId, product);
  await productRef.set({
    sourceCollection: 'EasyStore API', sourceProductId: result.productId, sourceVariantId: result.variantIds[0] || '',
    onlineName: snapshot.title, onlinePrice: snapshot.easyStorePrice,
    ...centralImageUpdate,
    easyStoreListingImageUrls: normalizeUrls(snapshot.images, 20),
    easyStoreMatched: true, easyStoreMatchStatus: 'matched',
    platformMappings: {
      ...previousMappings,
      easyStore: { ...(previousMappings.easyStore || {}), productId: result.productId, variantIds: result.variantIds }
    },
    variantGroup: snapshot.variantGroupEnabled === true ? {
      rootProductId: snapshot.productId, rootSku: snapshot.sku,
      attributeName: snapshot.variantGroupAttributeName,
      items: (snapshot.variantGroupVariants || []).map((row, index) => ({
        productId: row.productId, sku: row.sku, attributeValue: row.attributeValue,
        imageUrl: row.imageUrl, variantId: result.variantIds[index] || ''
      }))
    } : snapshot.listingMode === 'add-variant' ? {
      parentProductId: snapshot.variantParentProductId, parentSku: snapshot.variantParentSku,
      parentName: snapshot.variantParentName, attributeName: snapshot.variantAttributeName,
      parentAttributeValue: snapshot.variantParentAttributeValue, attributeValue: snapshot.variantAttributeValue
    } : null,
    easyStoreSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '商品上架'
  }, { merge: true });
  if (snapshot.variantGroupEnabled === true) {
    await Promise.all((snapshot.variantGroupVariants || []).map(async (row, index) => {
      if (clean(row && row.productId) === productId) return;
      const variantProductRef = db.collection(PRODUCT_COLLECTION).doc(clean(row && row.productId));
      const variantProductSnap = await variantProductRef.get();
      const variantProduct = variantProductSnap.exists ? (variantProductSnap.data() || {}) : {};
      const variantMappings = variantProduct.platformMappings && typeof variantProduct.platformMappings === 'object'
        ? variantProduct.platformMappings : {};
      return variantProductRef.set({
        sourceCollection: 'EasyStore API', sourceProductId: result.productId,
        sourceVariantId: result.variantIds[index] || '', onlineName: snapshot.title,
        onlinePrice: numberOrNull(row && row.easyStorePrice), easyStoreMatched: true,
        easyStoreMatchStatus: 'matched', easyStoreListingImageUrls: normalizeUrls(snapshot.images, 20),
        platformMappings: {
          ...variantMappings,
          easyStore: {
            ...(variantMappings.easyStore || {}),
            productId: result.productId,
            variantIds: [result.variantIds[index] || ''].filter(Boolean)
          }
        },
        variantGroup: {
          rootProductId: snapshot.productId, rootSku: snapshot.sku,
          attributeName: snapshot.variantGroupAttributeName, attributeValue: clean(row && row.attributeValue)
        },
        easyStoreSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '商品上架'
      }, { merge: true });
    }));
  }
  return {
    result,
    receipt,
    platform: {
      status: result.action === 'created' ? 'created' : 'updated',
      message: (result.action === 'variant-created' ? 'EasyStore 已在既有商品中建立新細項。'
        : result.action === 'variant-updated' ? 'EasyStore 既有細項已更新。'
          : result.action === 'created' ? 'EasyStore 商品已建立。' : 'EasyStore 商品已更新。') + (result.imageWarning || ''),
      productId: result.productId, variantIds: result.variantIds, verification: receipt
    },
    autofillPayload: buildShopeeAutofillPayload(snapshot, result, {
      jobId,
      snapshotFingerprint: listingSnapshotFingerprint(snapshot)
    })
  };
}

async function publishEasyStoreStageWithRetry(db, jobId, snapshot, product, dependencies = {}) {
  const delays = dependencies.retryDelays || [0, 3000, 10000, 30000];
  let lastError = null;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await wait(delays[attempt]);
    try {
      return await publishEasyStoreStage(db, jobId, snapshot, product, dependencies);
    } catch (error) {
      lastError = error;
      if (!isTransientListingPublishFailure(error) || attempt === delays.length - 1) break;
    }
  }
  throw lastError || new Error('EasyStore 上架失敗。');
}

async function applyVerifiedQueueReceipt(db, queueId, queueRecord, dependencies = {}) {
  const record = queueRecord && typeof queueRecord === 'object' ? queueRecord : {};
  const jobId = clean(record.jobId);
  if (!jobId || clean(record.workflowVersion) !== LISTING_WORKFLOW_ID) return { status: 'ignored-legacy-or-unversioned-queue' };
  const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
  const initialJobSnap = await jobRef.get();
  if (!initialJobSnap.exists) return { status: 'ignored-missing-job' };
  const initialJob = { ...(initialJobSnap.data() || {}), id: jobId };
  const snapshot = initialJob.preparedSnapshot && typeof initialJob.preparedSnapshot === 'object'
    ? initialJob.preparedSnapshot : {};
  const requestedStage = queueStageFromPlatform(record.platform);
  if (requestedStage && !listingStageSelected(snapshot, requestedStage)) {
    return { status: 'ignored-unselected-stage', stage: requestedStage };
  }
  const queueStatus = clean(record.status).toLowerCase();
  if (LISTING_BATCH_FAILURE_STATUSES.has(queueStatus)) {
    const identity = validateQueuedStageReceiptIdentity(initialJob, record);
    if (!identity.verified) {
      console.warn('[applyVerifiedQueueReceipt] ignored failed receipt', { queueId, jobId, reasons: identity.reasons });
      return { status: 'ignored-unverified-failed-receipt', reasons: identity.reasons };
    }
    const productId = clean(initialJob.productId);
    const productRef = db.collection(PRODUCT_COLLECTION).doc(productId);
    const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(productId);
    const reason = clean(record.error || record.message || record.failureReason || record.lastError).slice(0, 800)
      || `${listingBatchPlatformLabel(identity.stage)}尚未完成。`;
    const retryAt = record.retryAt || record.nextRetryAt || record.availableAt || null;
    let failedJob = null;
    await db.runTransaction(async (transaction) => {
      const latestSnap = await transaction.get(jobRef);
      if (!latestSnap.exists) return;
      const latest = { ...(latestSnap.data() || {}), id: jobId };
      if (clean(latest.currentStage) === 'completed') return;
      const latestIdentity = validateQueuedStageReceiptIdentity(latest, record);
      if (!latestIdentity.verified) return;
      const stages = latest.stages && typeof latest.stages === 'object' ? { ...latest.stages } : initialListingStages(snapshot);
      const stageState = {
        ...(stages[identity.stage] || {}), status: 'failed', failureStatus: queueStatus,
        message: reason, retryable: record.retryable !== false, queueId: clean(queueId),
        attemptToken: clean(record.attemptToken), fingerprint: clean(record.fingerprint)
      };
      if (retryAt) stageState.retryAt = retryAt;
      stages[identity.stage] = stageState;
      const platforms = {
        ...(latest.platforms || {}),
        [identity.stage]: { status: 'failed', failureStatus: queueStatus, message: reason, retryable: record.retryable !== false, ...(retryAt ? { retryAt } : {}) }
      };
      const batchFailure = listingBatchFailurePayload(snapshot, stages, platforms, reason);
      failedJob = { ...latest, status: 'failed', currentStage: deriveListingCurrentStage(stages), stages, platforms: summarizePlatformsForStorage(platforms) };
      transaction.set(jobRef, {
        status: 'failed', currentStage: failedJob.currentStage, stages, platforms: failedJob.platforms,
        error: reason, transitionToken: '',
        stageRevision: Math.max(1, Number(latest.stageRevision) || 1) + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(), failedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.set(caseRef, {
        caseStatus: 'submitted',
        publishState: {
          jobId, status: 'failed', currentStage: failedJob.currentStage, stages,
          platforms: failedJob.platforms, submittedAt: admin.firestore.FieldValue.serverTimestamp(),
          submittedBy: '固定四通路 queue receipt'
        },
        ...(batchFailure || {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '固定四通路流程 v3'
      }, { merge: true });
    });
    if (!failedJob) return { status: 'ignored-stale-failed-receipt' };
    const productSnap = await productRef.get();
    if (productSnap.exists) {
      const product = productSnap.data() || {};
      await productRef.set({
        platformListingStatus: platformListingStatusFromPublish(product.platformListingStatus, failedJob.platforms, failedJob.stages),
        platformListingStatusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '固定四通路流程 v3'
      }, { merge: true });
    }
    return { status: 'failed-recorded-for-retry', stage: identity.stage, jobId, reason, retryAt };
  }
  const initialVerification = validateQueuedStageReceipt(initialJob, record);
  if (!initialVerification.verified) {
    console.warn('[applyVerifiedQueueReceipt] ignored receipt', { queueId, jobId, reasons: initialVerification.reasons });
    return { status: 'ignored-unverified-receipt', reasons: initialVerification.reasons };
  }
  const productId = clean(initialJob.productId);
  const productRef = db.collection(PRODUCT_COLLECTION).doc(productId);
  const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(productId);
  let updatedJob = null;
  let alreadyCompleted = false;
  await db.runTransaction(async (transaction) => {
    const latestSnap = await transaction.get(jobRef);
    if (!latestSnap.exists) return;
    const latest = { ...(latestSnap.data() || {}), id: jobId };
    if (clean(latest.currentStage) === 'completed') {
      updatedJob = latest;
      alreadyCompleted = true;
      return;
    }
    const verification = validateQueuedStageReceipt(latest, record);
    if (!verification.verified) return;
    const stages = latest.stages && typeof latest.stages === 'object' ? { ...latest.stages } : initialListingStages(snapshot);
    const stage = verification.stage;
    stages[stage] = {
      ...(stages[stage] || {}), status: 'verified', receipt: verification.receipt,
      queueId: clean(queueId), attemptToken: clean(record.attemptToken), fingerprint: clean(record.fingerprint)
    };
    const platforms = {
      ...(latest.platforms || {}),
      [stage]: { status: 'completed', message: `${stage === 'momo' ? 'MOMO' : '酷澎'} 已由正式清單核對完成。` }
    };
    const currentStage = deriveListingCurrentStage(stages);
    const status = currentStage === 'finalizing' ? 'running' : overallPublishStatus(platforms);
    updatedJob = { ...latest, status, currentStage, stages, platforms: summarizePlatformsForStorage(platforms) };
    transaction.set(jobRef, {
      status, currentStage, stages, platforms: updatedJob.platforms,
      transitionToken: '',
      stageRevision: Math.max(1, Number(latest.stageRevision) || 1) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  if (!updatedJob) return { status: 'ignored-stale-queue-receipt' };
  if (alreadyCompleted) return { status: 'already-completed', jobId, currentStage: 'completed' };
  const productSnap = await productRef.get();
  if (!productSnap.exists) throw new Error('中央商品主檔已不存在，不會建立替代商品。');
  const product = productSnap.data() || {};
  const updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await caseRef.set({
    caseStatus: 'submitted',
    publishState: {
      jobId, status: updatedJob.status, currentStage: updatedJob.currentStage, stages: updatedJob.stages,
      platforms: updatedJob.platforms,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(), submittedBy: '固定四通路 queue receipt'
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '固定四通路流程 v3'
  }, { merge: true });
  await productRef.set({
    platformListingStatus: platformListingStatusFromPublish(product.platformListingStatus, updatedJob.platforms, updatedJob.stages),
    platformListingStatusUpdatedAt: updatedAt, updatedAt, updatedBy: '固定四通路流程 v3'
  }, { merge: true });
  const finalized = await finalizeListingJobIfReady(
    db,
    jobId,
    clean(dependencies.actor) || '固定四通路 queue receipt'
  );
  if (['completed', 'already-completed', 'blocked-image-reference-verification'].includes(clean(finalized && finalized.status))) return finalized;
  return {
    status: `${initialVerification.stage}-verified`, jobId,
    currentStage: updatedJob.currentStage, stages: updatedJob.stages
  };
}

function sameOrderedStrings(left, right) {
  const a = Array.isArray(left) ? left.map(clean) : [];
  const b = Array.isArray(right) ? right.map(clean) : [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function activeV3JobReuseBlockers(candidate, productId, listingCase) {
  const job = candidate && typeof candidate === 'object' ? candidate : {};
  const snapshot = job.preparedSnapshot && typeof job.preparedSnapshot === 'object' ? job.preparedSnapshot : {};
  const policy = snapshot.automationPolicy && typeof snapshot.automationPolicy === 'object' ? snapshot.automationPolicy : {};
  const frozen = listingCase && listingCase.codexHandoff && listingCase.codexHandoff.preflightSnapshot
    && typeof listingCase.codexHandoff.preflightSnapshot === 'object'
    ? listingCase.codexHandoff.preflightSnapshot : {};
  const reasons = [];
  if (clean(job.workflowVersion) !== LISTING_WORKFLOW_ID) reasons.push('workflow-version-mismatch');
  if (Number(job.schemaVersion) !== LISTING_JOB_SCHEMA_VERSION) reasons.push('job-schema-version-mismatch');
  if (clean(job.productId) !== clean(productId) || clean(snapshot.productId) !== clean(productId)) reasons.push('product-mismatch');
  if (!sameOrderedStrings(job.platformOrder, PLATFORM_EXECUTION_ORDER)) reasons.push('job-platform-order-mismatch');
  if (Number(policy.version) !== LISTING_AUTOMATION_POLICY_VERSION
    || clean(policy.workflowId) !== LISTING_WORKFLOW_ID
    || !sameOrderedStrings(policy.platformExecutionPlan && policy.platformExecutionPlan.order, PLATFORM_EXECUTION_ORDER)
    || JSON.stringify(compactObject(policy)) !== JSON.stringify(compactObject(listingAutomationPolicy()))) {
    reasons.push('automation-policy-mismatch');
  }
  if (!snapshot || !Object.keys(snapshot).length) reasons.push('missing-prepared-snapshot');
  if (!clean(job.preparedSnapshotFingerprint)
    || clean(job.preparedSnapshotFingerprint) !== listingSnapshotFingerprint(snapshot)) reasons.push('prepared-snapshot-fingerprint-mismatch');
  const imagePlan = snapshot.platformImagePlan && typeof snapshot.platformImagePlan === 'object' ? snapshot.platformImagePlan : {};
  if (platformImagePlanMissingFields(imagePlan, { requireFinalized: true, targetPlatforms: listingTargetPlatforms(snapshot) }).length) reasons.push('finalized-image-plan-invalid');
  if (clean(frozen.workflowVersion) !== LISTING_WORKFLOW_ID || !clean(frozen.snapshotId)) reasons.push('case-frozen-input-invalid');
  if (clean(imagePlan.inputSnapshotId) !== clean(frozen.snapshotId)
    || clean(imagePlan.inputSnapshotFingerprint) !== frozenInputSnapshotFingerprint(frozen)) reasons.push('case-frozen-input-mismatch');
  const currentStage = clean(job.currentStage);
  const allowedStages = ['parallel-platforms', 'shopee', 'finalizing'];
  if (!allowedStages.includes(currentStage)) reasons.push('invalid-active-stage');
  const stages = job.stages && typeof job.stages === 'object' ? job.stages : {};
  PLATFORM_EXECUTION_ORDER.forEach((stage) => {
    const state = stages[stage] && typeof stages[stage] === 'object' ? stages[stage] : {};
    if (clean(state.status).toLowerCase() !== 'verified') return;
    const verification = validatePlatformStageVerification(stage, snapshot, state.receipt);
    if (!verification.verified) reasons.push(`${stage}-receipt-invalid`);
  });
  const shopeeState = stages.shopee && typeof stages.shopee === 'object' ? stages.shopee : {};
  if (!['blocked-by-dependency', 'ready'].includes(clean(shopeeState.status).toLowerCase())
    && !listingStageVerified(stages, 'easyStore')) reasons.push('shopee-dependency-not-verified');
  return Array.from(new Set(reasons));
}

const PRODUCT_LISTING_PUBLISH_OPTIONS = {
  region: REGION,
  timeoutSeconds: 540,
  memory: '512MiB',
  secrets: [EASYSTORE_ACCESS_TOKEN],
  enforceAppCheck: false
};

function codexAutoPublishGrant(listingCase) {
  const handoff = listingCase && listingCase.codexHandoff && typeof listingCase.codexHandoff === 'object'
    ? listingCase.codexHandoff : {};
  const frozen = handoff.preflightSnapshot && typeof handoff.preflightSnapshot === 'object'
    ? handoff.preflightSnapshot : {};
  const grant = handoff.autoPublishAuthorization && typeof handoff.autoPublishAuthorization === 'object'
    ? handoff.autoPublishAuthorization : {};
  const email = clean(grant.grantedByEmail).toLowerCase();
  const grantScope = clean(grant.scope);
  const listingScope = normalizeListingTargetScope(frozen.listingTargetScope);
  const authorizedTargets = listingTargetPlatforms(listingScope);
  const grantTargets = Array.isArray(grant.listingTargetPlatforms)
    ? grant.listingTargetPlatforms.map(clean) : authorizedTargets;
  if (clean(handoff.workflowVersion) !== LISTING_WORKFLOW_ID
    || clean(frozen.workflowVersion) !== LISTING_WORKFLOW_ID
    || clean(grant.workflowVersion) !== LISTING_WORKFLOW_ID
    || !['fixed-v3-four-channel-publish', 'fixed-v3-selected-channel-publish'].includes(grantScope)
    || (grantScope === 'fixed-v3-selected-channel-publish'
      && normalizeListingTargetScope(grant.listingTargetScope) !== listingScope)
    || !sameOrderedStrings(grantTargets, authorizedTargets)
    || grant.granted !== true
    || grant.noSecondConfirmation !== true
    || !clean(frozen.snapshotId)
    || clean(grant.snapshotId) !== clean(frozen.snapshotId)
    || !ADMIN_EMAILS.has(email)) return null;
  return { email, snapshotId: clean(frozen.snapshotId), scope: grantScope, listingTargetScope: listingScope, listingTargetPlatforms: authorizedTargets };
}

function codexAutoPublishInputFingerprint(listingCase) {
  const handoff = listingCase && listingCase.codexHandoff && typeof listingCase.codexHandoff === 'object'
    ? listingCase.codexHandoff : {};
  const frozen = handoff.preflightSnapshot && typeof handoff.preflightSnapshot === 'object'
    ? handoff.preflightSnapshot : {};
  return listingSnapshotFingerprint({
    workflowVersion: clean(handoff.workflowVersion),
    snapshotId: clean(frozen.snapshotId),
    frozenInputFingerprint: frozenInputSnapshotFingerprint(frozen),
    generatedListingImages: Array.isArray(listingCase && listingCase.generatedListingImages)
      ? listingCase.generatedListingImages : [],
    listingImageUrls: normalizeUrls(listingCase && listingCase.listingImageUrls, 20),
    physicalImageUrls: normalizeUrls(listingCase && listingCase.physicalImageUrls, 20),
    researchedProductName: clean(listingCase && listingCase.researchedProductName),
    productDescription: clean(listingCase && listingCase.productDescription),
    prices: {
      shared: numberOrNull(listingCase && listingCase.sharedOnlinePrice),
      easyStore: numberOrNull(listingCase && listingCase.easyStorePrice),
      shopee: numberOrNull(listingCase && listingCase.shopeePrice),
      coupang: numberOrNull(listingCase && listingCase.coupangPrice),
      momo: numberOrNull(listingCase && listingCase.momoPrice)
    },
    stock: numberOrNull(listingCase && listingCase.stock),
    shippingDecision: clean(listingCase && listingCase.shippingDecision),
    packageLengthCm: numberOrNull(listingCase && listingCase.packageLengthCm),
    packageWidthCm: numberOrNull(listingCase && listingCase.packageWidthCm),
    packageHeightCm: numberOrNull(listingCase && listingCase.packageHeightCm),
    packageWeightKg: numberOrNull(listingCase && listingCase.packageWeightKg),
    listingIntent: clean(listingCase && listingCase.listingIntent),
    listingChangeInstructions: clean(listingCase && listingCase.listingChangeInstructions),
    listingMode: clean(listingCase && listingCase.listingMode),
    variantGroupItems: Array.isArray(listingCase && listingCase.variantGroupItems) ? listingCase.variantGroupItems : []
  });
}

function isTransientListingPublishFailure(value) {
  const message = clean(value && value.message ? value.message : value).toLowerCase();
  if (!message) return false;
  if (/otp|驗證碼|captcha|saved.credentials.rejected|保存帳密.*(?:拒絕|錯誤)|platform.account.disabled|帳號.*停用|permission-denied|明確拒絕|必填資料/.test(message)) return false;
  return /\b(408|425|429|500|502|503|504)\b|timeout|timed out|network|temporar|暫時|逾時|登入(?:已)?失效|login expired|session expired|redirected.to.login|跳回登入|authenticated.tab.control.lost|圖片.*(讀不到|處理中|失敗)|image.*(fetch|processing|unavailable|failed)/.test(message);
}

function publishResultFailureMessage(result) {
  if (!result || result.ok !== false) return '';
  const rows = result.platforms && typeof result.platforms === 'object' ? Object.values(result.platforms) : [];
  return rows.map((row) => clean(row && row.message)).filter(Boolean).join('；') || clean(result.status) || '發布未完成';
}

async function publishProductListingCaseHandler(request) {

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
    let listingCase = caseSnap.data() || {};
    const priorJobId = clean(request && request.data && request.data.jobId)
      || clean(listingCase.publishState && listingCase.publishState.jobId);
    let reusableJob = null;
    let reusableJobRef = null;
    if (priorJobId && !priorJobId.includes('/')) {
      const candidateRef = db.collection(JOB_COLLECTION).doc(priorJobId);
      const candidateSnap = await candidateRef.get();
      const candidate = candidateSnap.exists ? candidateSnap.data() || {} : {};
      if (candidateSnap.exists && clean(candidate.workflowVersion) === LISTING_WORKFLOW_ID
        && clean(candidate.currentStage) !== 'completed') {
        const reuseBlockers = activeV3JobReuseBlockers(candidate, productId, listingCase);
        if (reuseBlockers.length) {
          await candidateRef.set({
            status: 'superseded-by-current-v3-handoff',
            currentStage: 'superseded',
            supersededBySnapshotId: clean(listingCase.codexHandoff && listingCase.codexHandoff.preflightSnapshot && listingCase.codexHandoff.preflightSnapshot.snapshotId),
            supersededReasons: reuseBlockers,
            supersededAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } else {
          reusableJob = candidate;
          reusableJobRef = candidateRef;
        }
      }
    }
    if (reusableJob && clean(reusableJob.currentStage) === 'finalizing') {
      const finalizing = await finalizeListingJobIfReady(
        db,
        reusableJobRef.id,
        clean(request.auth && request.auth.token && request.auth.token.email) || '管理者'
      );
      return { ok: finalizing.status !== 'blocked-image-reference-verification', resumed: true, ...finalizing };
    }
    if (reusableJob && listingStageVerified(reusableJob.stages || {}, 'easyStore')
      && !listingRootStageNeedsResume(reusableJob.preparedSnapshot || {}, reusableJob.stages || {})) {
      const resumedStages = reusableJob.stages && typeof reusableJob.stages === 'object'
        ? reusableJob.stages : initialListingStages(reusableJob.preparedSnapshot);
      const resumedPlatforms = reusableJob.platforms && typeof reusableJob.platforms === 'object' ? { ...reusableJob.platforms } : {};
      if (!listingStageVerified(resumedStages, 'shopee')) {
        const easyStoreStage = resumedStages.easyStore && typeof resumedStages.easyStore === 'object' ? resumedStages.easyStore : {};
        resumedPlatforms.shopee = {
          status: 'waiting-easystore-sync',
          message: '沿用同一份 immutable 快照與 EasyStore 商品，等待蝦皮正式清單核對。',
          autofillPayload: buildShopeeAutofillPayload(reusableJob.preparedSnapshot, {
            productId: clean(easyStoreStage.productId),
            variantIds: Array.isArray(easyStoreStage.variantIds) ? easyStoreStage.variantIds : []
          }, {
            jobId: reusableJobRef.id,
            snapshotFingerprint: clean(reusableJob.preparedSnapshotFingerprint)
          })
        };
      }
      return {
        ok: true, resumed: true, productId, jobId: reusableJobRef.id,
        status: clean(reusableJob.status) || 'submitted', currentStage: deriveListingCurrentStage(resumedStages),
        stages: resumedStages, platforms: resumedPlatforms
      };
    }
    let snapshot = reusableJob ? reusableJob.preparedSnapshot : null;
    let preflightMissing = reusableJob && reusableJob.preflightMissing && typeof reusableJob.preflightMissing === 'object'
      ? reusableJob.preflightMissing : null;
    if (!snapshot) {
      let finalizedMedia;
      try {
        finalizedMedia = await loadFinalPreparedMediaSnapshot(db, productId, listingCase);
      } catch (error) {
        throw new HttpsError('failed-precondition', `完成圖最終預檢未通過：${clean(error && error.message) || '無法從凍結來源建立完成圖快照。'}`);
      }
      listingCase = finalizedMedia.rootListingCase || listingCase;
      let variantParentProduct = null;
      let variantParentListingCase = null;
      let variantGroupContext = null;
      if (clean(listingCase.listingMode) === 'add-variant') {
        const parentId = clean(listingCase.variantParentProductId);
        if (!parentId || parentId === productId || parentId.includes('/')) throw new HttpsError('failed-precondition', '請選擇另一個有效的父商品。');
        const [parentSnap, parentCaseSnap] = await Promise.all([
          db.collection(PRODUCT_COLLECTION).doc(parentId).get(),
          db.collection(LISTING_CASE_COLLECTION).doc(parentId).get()
        ]);
        if (!parentSnap.exists) throw new HttpsError('failed-precondition', '選定的父商品已不存在，請重新選擇。');
        variantParentProduct = parentSnap.data() || {};
        variantParentListingCase = finalizedMedia.currentCases.get(parentId)
          || (parentCaseSnap.exists ? parentCaseSnap.data() || {} : {});
      }
      if (clean(listingCase.listingMode) !== 'add-variant' && listingCase.variantGroupEnabled === true) {
        const itemIds = (Array.isArray(listingCase.variantGroupItems) ? listingCase.variantGroupItems : [])
          .map((item) => clean(item && item.productId)).filter(Boolean);
        if (new Set(itemIds).size !== itemIds.length || itemIds.includes(productId)) {
          throw new HttpsError('failed-precondition', '同款多細項案件含有重複的商品；尚未操作任何平台。');
        }
        const childSnaps = await Promise.all(itemIds.map((id) => db.collection(PRODUCT_COLLECTION).doc(id).get()));
        variantGroupContext = new Map([[productId, { product, listingCase }]]);
        childSnaps.forEach((childSnap, index) => {
          const childId = itemIds[index];
          if (!childSnap.exists) throw new HttpsError('failed-precondition', `同款細項 ${childId} 的中央商品已不存在；尚未操作任何平台。`);
          const childCase = finalizedMedia.currentCases.get(childId);
          if (!childCase) throw new HttpsError('failed-precondition', `同款細項 ${childId} 缺少目前 v3 案件；尚未操作任何平台。`);
          variantGroupContext.set(childId, { product: childSnap.data() || {}, listingCase: childCase });
        });
      }
      snapshot = buildListingSnapshot(
        productId, product, listingCase, variantParentProduct, variantParentListingCase,
        finalizedMedia.preparedMediaSnapshot, variantGroupContext
      );
      await syncPreparedCentralImagesBeforePublish(db, snapshot, '固定四通路流程 v3 圖片回寫');
      if (!listingTargetPlatforms(snapshot).length) {
        throw new HttpsError('failed-precondition', '這次沒有指定要處理的上架通路。');
      }
      const representativeMissing = variantRepresentativeMissingFields(snapshot);
      if (representativeMissing.length) {
        throw new HttpsError('failed-precondition', `細項代表圖尚未完成繁體化：${representativeMissing.join('、')}。請先完成圖片處理；系統不會直接使用簡體原圖。`);
      }
      const shopeeLogistics = buildShopeeLogistics(snapshot);
      preflightMissing = {
        content: snapshot.descriptionContentStatus && snapshot.descriptionContentStatus.ready
          ? [] : ['商品介紹（需包含可驗證的商品特色、使用方式／適用情境與商品規格；通用備援文案不算完成）'],
        images: platformImagePlanMissingFields(snapshot.platformImagePlan, { requireFinalized: true, targetPlatforms: listingTargetPlatforms(snapshot) }),
        easyStore: snapshot.enabledEasyStoreShopee ? easyStoreMissingFields(snapshot) : [],
        shopee: snapshot.enabledEasyStoreShopee ? [].concat(
          listingIntentIdentityMissingFields(snapshot, 'shopee'),
          !snapshot.shopeeCategoryPath ? ['蝦皮分類'] : [],
          identityAllowsShopeeAutofill(snapshot.identityStatus, snapshot.identityManualConfirmed) ? [] : ['蝦皮商品身分／型號確認'],
          shopeeLogistics.requiresConfirmation ? ['蝦皮物流（包裝尺寸、重量或配送方式尚未能安全判定）'] : []
        ) : [],
        coupang: snapshot.enabledCoupang ? coupangMissingFields(snapshot) : [],
        momo: snapshot.enabledMomo ? momoMissingFields(snapshot) : []
      };
      const missingSummary = Object.entries(preflightMissing)
        .filter(([, rows]) => rows.length)
        .map(([platform, rows]) => `${platform}：${rows.join('、')}`);
      if (missingSummary.length) {
        throw new HttpsError('failed-precondition', `本次所選通路預檢未通過；尚未操作任何平台。${missingSummary.join('；')}`);
      }
    }
    const jobRef = reusableJobRef || db.collection(JOB_COLLECTION).doc();
    const jobId = jobRef.id;
    const createdBy = clean(request.auth && request.auth.token && request.auth.token.email) || '管理者';
    const platforms = reusableJob && reusableJob.platforms && typeof reusableJob.platforms === 'object' ? { ...reusableJob.platforms } : {};
    const stages = reusableJob && reusableJob.stages && typeof reusableJob.stages === 'object' ? { ...reusableJob.stages } : initialListingStages(snapshot);
    let currentStage = reusableJob ? clean(reusableJob.currentStage) : 'parallel-platforms';
    let lockStatus = 'failed';
    await acquirePublishLock(db, caseRef, jobId, createdBy);
    try {
      if (reusableJob) {
        await jobRef.set({
          status: 'running', resumedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        await jobRef.set({
          jobNo: `PUB-${Date.now()}`, type: 'productListingPublish', status: 'running', dryRun: false,
          productId, productSku: snapshot.sku, productName: snapshot.title,
          workflowVersion: snapshot.automationPolicy.workflowId,
          platformOrder: snapshot.automationPolicy.platformExecutionPlan.order,
          preparedSnapshot: snapshot,
          preparedSnapshotFingerprint: listingSnapshotFingerprint(snapshot),
          preflightMissing,
          currentStage,
          stages,
          stageRevision: 1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(), schemaVersion: LISTING_JOB_SCHEMA_VERSION
        });
      }

      const operations = [];
      [
        { stage: 'momo', platform: 'MOMO', missing: momoMissingFields(snapshot) },
        { stage: 'coupang', platform: 'Coupang', missing: coupangMissingFields(snapshot) }
      ].forEach((entry) => {
        if (!listingStageSelected(snapshot, entry.stage)) return;
        const state = stages[entry.stage] && typeof stages[entry.stage] === 'object' ? stages[entry.stage] : {};
        const status = clean(state.status).toLowerCase();
        if (['awaiting-verification', 'verified'].includes(status)) {
          if (status === 'verified') platforms[entry.stage] = { status: 'completed' };
          return;
        }
        const attemptToken = clean(state.attemptToken) || crypto.randomBytes(16).toString('hex');
        const fingerprint = platformStageFingerprint(entry.platform, snapshot);
        stages[entry.stage] = { ...state, status: 'queueing', attemptToken, fingerprint };
        operations.push({
          stage: entry.stage,
          kind: 'queue',
          attemptToken,
          fingerprint,
          run: () => queueFixedIpPlatform(db, jobId, entry.platform, snapshot, product, entry.missing, attemptToken)
        });
      });
      const easyStoreState = stages.easyStore && typeof stages.easyStore === 'object' ? stages.easyStore : {};
      if (listingStageSelected(snapshot, 'easyStore') && !listingStageVerified(stages, 'easyStore')) {
        stages.easyStore = { ...easyStoreState, status: 'processing' };
        operations.push({
          stage: 'easyStore',
          kind: 'easyStore',
          run: () => publishEasyStoreStageWithRetry(db, jobId, snapshot, product)
        });
      }
      currentStage = 'parallel-platforms';
      await jobRef.set({
        status: 'running', currentStage, stages,
        executionMode: 'staggered-parallel',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const settled = await Promise.all(operations.map(async (operation) => {
        try {
          return { operation, ok: true, value: await operation.run() };
        } catch (error) {
          return { operation, ok: false, error };
        }
      }));
      settled.forEach((row) => {
        const { operation } = row;
        if (operation.kind === 'queue') {
          if (!row.ok) {
            const message = clean(row.error && row.error.message).slice(0, 800) || `${operation.stage} 排隊失敗。`;
            stages[operation.stage] = { ...(stages[operation.stage] || {}), status: 'failed', message };
            platforms[operation.stage] = { status: 'failed', message };
            return;
          }
          const queued = row.value || {};
          const queueBlocked = ['missing-fields', 'action-required'].includes(clean(queued.status));
          stages[operation.stage] = {
            ...(stages[operation.stage] || {}),
            status: queueBlocked ? clean(queued.status) : 'awaiting-verification',
            queueId: clean(queued.queueId), attemptToken: operation.attemptToken,
            fingerprint: clean(queued.fingerprint) || operation.fingerprint,
            message: clean(queued.message)
          };
          platforms[operation.stage] = queued;
          return;
        }
        if (!row.ok) {
          const message = clean(row.error && row.error.message).slice(0, 800) || 'EasyStore 上架失敗。';
          stages.easyStore = { status: 'failed', message };
          stages.shopee = { status: 'blocked-by-dependency', dependsOn: ['easyStore'], message: 'EasyStore 尚未完成。' };
          platforms.easyStore = { status: 'failed', message };
          platforms.shopee = { status: 'waiting-easystore', message: 'EasyStore 尚未完成，因此尚未送往蝦皮。' };
          return;
        }
        const easyStoreResult = row.value;
        platforms.easyStore = easyStoreResult.platform;
        platforms.shopee = {
          status: 'waiting-easystore-sync',
          message: `EasyStore 商品已完成；可啟動蝦皮助手自動填寫：${snapshot.shopeeCategoryPath}`,
          autofillPayload: easyStoreResult.autofillPayload
        };
        stages.easyStore = {
          status: 'verified', productId: easyStoreResult.result.productId,
          variantIds: easyStoreResult.result.variantIds, receipt: easyStoreResult.receipt
        };
        stages.shopee = { status: 'awaiting-verification', dependsOn: ['easyStore'] };
      });
      currentStage = deriveListingCurrentStage(stages);
      let status = overallPublishStatus(platforms);
      let platformsForStorage = summarizePlatformsForStorage(platforms);
      let completedDuringLaunch = false;
      await db.runTransaction(async (transaction) => {
        const latestSnap = await transaction.get(jobRef);
        if (!latestSnap.exists) return;
        const latest = latestSnap.data() || {};
        if (clean(latest.currentStage) === 'completed') {
          completedDuringLaunch = true;
          currentStage = 'completed';
          status = 'completed';
          Object.assign(stages, latest.stages || {});
          platformsForStorage = latest.platforms || platformsForStorage;
          return;
        }
        const latestStages = latest.stages && typeof latest.stages === 'object' ? latest.stages : {};
        PLATFORM_EXECUTION_ORDER.forEach((stage) => {
          if (listingStageExplicitlyVerified(latestStages, stage)) stages[stage] = latestStages[stage];
        });
        const latestPlatforms = latest.platforms && typeof latest.platforms === 'object' ? latest.platforms : {};
        PLATFORM_EXECUTION_ORDER.forEach((stage) => {
          if (listingStageExplicitlyVerified(stages, stage)) platforms[stage] = { ...(latestPlatforms[stage] || {}), status: 'completed' };
        });
        currentStage = deriveListingCurrentStage(stages);
        status = overallPublishStatus(platforms);
        platformsForStorage = summarizePlatformsForStorage(platforms);
        transaction.set(jobRef, {
          status, platforms: platformsForStorage, currentStage, stages,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });
      if (completedDuringLaunch) {
        lockStatus = 'completed';
        return { ok: true, productId, jobId, status, currentStage, stages, platforms: platformsForStorage };
      }
      const platformListingStatus = platformListingStatusFromPublish(product.platformListingStatus, platforms, stages);
      const batchFailure = listingBatchFailurePayload(snapshot, stages, platforms);
      await Promise.all([
        caseRef.set({
          caseStatus: status === 'completed' ? 'published' : 'submitted',
          shopeeCategoryPath: snapshot.shopeeCategoryPath,
          shopeeAttributeValues: snapshot.shopeeAttributeValues,
          publishState: { jobId, status, currentStage, stages, platforms: platformsForStorage, submittedAt: admin.firestore.FieldValue.serverTimestamp(), submittedBy: createdBy },
          ...(batchFailure || {}),
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
          version: LISTING_WORKFLOW_ID
        })
      ]);
      lockStatus = status;
      return { ok: !Object.values(platforms).some((row) => row.status === 'failed'), productId, jobId, status, currentStage, stages, platforms };
    } catch (error) {
      lockStatus = 'failed';
      const failureMessage = clean(error && error.message).slice(0, 800) || '商品上架工作未完成。';
      const batchFailure = listingBatchFailurePayload(snapshot, stages, platforms, failureMessage);
      await Promise.all([
        jobRef.set({
          status: 'failed', error: failureMessage,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(), failedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true }),
        caseRef.set({
          ...(batchFailure || { batchQueueStatus: 'failed', batchQueueError: failureMessage, batchRetryPlatforms: listingTargetPlatforms(snapshot), batchNextRetryAt: null, batchQueueUpdatedAt: admin.firestore.FieldValue.serverTimestamp() }),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '商品上架'
        }, { merge: true })
      ]).catch(() => null);
      throw error;
    } finally {
      try {
        await releasePublishLock(caseRef, jobId, lockStatus);
      } catch (error) {
        console.error('Unable to release product listing publish lock', { productId, jobId, message: clean(error && error.message) });
      }
    }
}

async function finalizeListingJobIfReady(db, jobId, actor) {
  const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
  const initialJobSnap = await jobRef.get();
  if (!initialJobSnap.exists) throw new HttpsError('not-found', '找不到這筆上架工作。');
  const initialJob = initialJobSnap.data() || {};
  const snapshot = initialJob.preparedSnapshot && typeof initialJob.preparedSnapshot === 'object' ? initialJob.preparedSnapshot : {};
  const productId = clean(initialJob.productId);
  const imageDocumentRefs = preparedImageReferenceCases(snapshot).map((reference) => ({
    ...reference,
    caseRef: db.collection(LISTING_CASE_COLLECTION).doc(reference.productId),
    productRef: db.collection(PRODUCT_COLLECTION).doc(reference.productId)
  }));
  let completedStages = null;
  let waitingStages = null;
  let waitingCurrentStage = '';
  let imageReferenceBlockers = [];
  let alreadyCompleted = false;
  await db.runTransaction(async (transaction) => {
    const latestSnap = await transaction.get(jobRef);
    if (!latestSnap.exists) return;
    const latest = latestSnap.data() || {};
    if (clean(latest.currentStage) === 'completed') {
      completedStages = latest.stages || {};
      alreadyCompleted = true;
      return;
    }
    const stages = latest.stages && typeof latest.stages === 'object' ? { ...latest.stages } : initialListingStages(snapshot);
    if (!allListingStagesVerified(stages)) {
      waitingStages = stages;
      waitingCurrentStage = deriveListingCurrentStage(stages);
      return;
    }
    const imageDocuments = await Promise.all(imageDocumentRefs.map(async (reference) => {
      const [caseSnap, productSnap] = await Promise.all([
        transaction.get(reference.caseRef), transaction.get(reference.productRef)
      ]);
      return {
        productId: reference.productId,
        caseRecord: caseSnap.exists ? caseSnap.data() || {} : {},
        productRecord: productSnap.exists ? productSnap.data() || {} : {}
      };
    }));
    const referenceVerification = validateCompletionImageReferences(snapshot, imageDocuments, stages);
    if (!referenceVerification.verified) {
      imageReferenceBlockers = referenceVerification.reasons;
      return;
    }
    completedStages = stages;
    transaction.set(jobRef, {
      status: 'completed', currentStage: 'completed', stages,
      transitionToken: '', updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      finishedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    imageDocumentRefs.forEach((reference) => {
      transaction.set(reference.caseRef, {
        mediaReferencesVerified: true,
        sourceImageRetentionPolicy: {
          mode: 'retain-source-binaries-fast-validation',
          sourceBinaryCleanupRequired: false,
          cleanupWorkerRequired: false,
          cleanupStatus: 'retained',
          referencesVerified: true,
          eligibleForDeletion: false,
          verifiedJobId: jobId,
          verifiedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '固定四通路流程 v3'
      }, { merge: true });
    });
  });
  if (imageReferenceBlockers.length) {
    await jobRef.set({
      status: 'needs-input', currentStage: 'finalizing', imageReferenceBlockers,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { status: 'blocked-image-reference-verification', jobId, currentStage: 'finalizing', reasons: imageReferenceBlockers };
  }
  if (!completedStages) {
    return {
      status: 'waiting-other-platforms', jobId, productId,
      currentStage: waitingCurrentStage || deriveListingCurrentStage(waitingStages || {}),
      stages: waitingStages || {}
    };
  }
  const platforms = { ...(initialJob.platforms || {}) };
  listingTargetPlatforms(snapshot).forEach((stage) => { platforms[stage] = { status: 'completed' }; });
  const storedPlatforms = summarizePlatformsForStorage(platforms);
  const finalImageDocuments = await Promise.all(imageDocumentRefs.map(async (reference) => {
    const productSnap = await reference.productRef.get();
    return { ...reference, product: productSnap.exists ? productSnap.data() || {} : {} };
  }));
  const finalWrites = [];
  finalImageDocuments.forEach((reference) => {
    finalWrites.push(reference.caseRef.set({
      caseStatus: 'published',
      publishState: { jobId, status: 'completed', currentStage: 'completed', stages: completedStages, platforms: storedPlatforms, verifiedAt: admin.firestore.FieldValue.serverTimestamp() },
      batchQueueStatus: 'completed', batchCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      batchQueueError: '', batchPlatformFailures: {}, batchRetryPlatforms: [], batchNextRetryAt: null,
      batchQueueUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '固定四通路流程 v3'
    }, { merge: true }));
    finalWrites.push(reference.productRef.set({
      platformListingStatus: platformListingStatusFromPublish(reference.product.platformListingStatus, platforms, completedStages),
      platformListingStatusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '固定四通路流程 v3'
    }, { merge: true }));
  });
  finalWrites.push(db.collection('opsAuditLogs').doc(`${jobId}_selected_channel_completed`).set({
      action: '網路上架完成', entityType: 'productListingPublish', entityId: jobId,
      summary: `${clean(snapshot.sku)}｜${listingTargetLabel(snapshot)}已核對完成`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: clean(actor) || '固定 v3 上架流程',
      version: LISTING_WORKFLOW_ID
    }, { merge: true }));
  await Promise.all(finalWrites);
  return { status: alreadyCompleted ? 'already-completed' : 'completed', jobId, productId, currentStage: 'completed', stages: completedStages };
}

async function finalizeVerifiedShopeeStage(db, jobId, verification, actor) {
  const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
  const initialJobSnap = await jobRef.get();
  if (!initialJobSnap.exists) throw new HttpsError('not-found', '找不到這筆上架工作。');
  const initialJob = initialJobSnap.data() || {};
  if (clean(initialJob.currentStage) === 'completed') {
    return { status: 'already-completed', jobId, productId: clean(initialJob.productId), currentStage: 'completed', stages: initialJob.stages || {} };
  }
  const snapshot = initialJob.preparedSnapshot && typeof initialJob.preparedSnapshot === 'object' ? initialJob.preparedSnapshot : {};
  if (!listingStageSelected(snapshot, 'shopee')) {
    throw new HttpsError('failed-precondition', '蝦皮不在本次所選通路內，不能建立或核對蝦皮工作。');
  }
  const initialStages = initialJob.stages && typeof initialJob.stages === 'object' ? initialJob.stages : initialListingStages(snapshot);
  if (!listingStageVerified(initialStages, 'easyStore')) {
    throw new HttpsError('failed-precondition', 'EasyStore 尚未正式核對完成，蝦皮不能提前發布。');
  }
  let updatedJob = null;
  await db.runTransaction(async (transaction) => {
    const latestSnap = await transaction.get(jobRef);
    if (!latestSnap.exists) return;
    const latest = latestSnap.data() || {};
    if (clean(latest.currentStage) === 'completed') {
      updatedJob = { ...latest, alreadyCompleted: true };
      return;
    }
    const stages = latest.stages && typeof latest.stages === 'object' ? { ...latest.stages } : initialListingStages(snapshot);
    if (!listingStageVerified(stages, 'easyStore')) return;
    stages.shopee = { ...(stages.shopee || {}), status: 'verified', receipt: verification.receipt };
    const platforms = {
      ...(latest.platforms || {}),
      shopee: { status: 'completed', message: '蝦皮已由 EasyStore 官方通路清單核對完成。' }
    };
    const currentStage = deriveListingCurrentStage(stages);
    updatedJob = { ...latest, currentStage, stages, platforms: summarizePlatformsForStorage(platforms) };
    transaction.set(jobRef, {
      status: 'submitted', currentStage, stages, platforms: updatedJob.platforms,
      stageRevision: Math.max(1, Number(latest.stageRevision) || 1) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  if (!updatedJob) throw new HttpsError('failed-precondition', 'EasyStore 尚未正式核對完成，蝦皮不能提前發布。');
  if (updatedJob.alreadyCompleted) {
    return { status: 'already-completed', jobId, productId: clean(updatedJob.productId), currentStage: 'completed', stages: updatedJob.stages || {} };
  }
  const finalized = await finalizeListingJobIfReady(db, jobId, actor);
  if (clean(finalized.status) !== 'waiting-other-platforms') return finalized;
  const productId = clean(updatedJob.productId);
  const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(productId);
  await caseRef.set({
    caseStatus: 'submitted',
    publishState: {
      jobId, status: 'submitted', currentStage: finalized.currentStage,
      stages: finalized.stages, platforms: updatedJob.platforms,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(), submittedBy: clean(actor) || '固定四通路流程'
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '固定四通路流程 v3'
  }, { merge: true });
  return { ...finalized, status: 'shopee-verified-waiting-other-platforms' };
}

function registerProductListingPublish(target) {
  target.publishProductListingCase = onCall(PRODUCT_LISTING_PUBLISH_OPTIONS, publishProductListingCaseHandler);

  target.autoPublishProductListingCase = onDocumentWritten({
    document: `${LISTING_CASE_COLLECTION}/{productId}`,
    region: REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [EASYSTORE_ACCESS_TOKEN]
  }, async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return null;
    const productId = clean(event.params && event.params.productId);
    const listingCase = after.data() || {};
    const grant = codexAutoPublishGrant(listingCase);
    if (!productId || !grant || clean(listingCase.publishState && listingCase.publishState.jobId)) return null;

    const db = admin.firestore();
    try {
      await loadFinalPreparedMediaSnapshot(db, productId, listingCase);
    } catch (_) {
      return null;
    }
    const fingerprint = codexAutoPublishInputFingerprint(listingCase);
    const attemptToken = crypto.randomBytes(16).toString('hex');
    const claimed = await db.runTransaction(async (transaction) => {
      const freshSnap = await transaction.get(after.ref);
      if (!freshSnap.exists) return false;
      const fresh = freshSnap.data() || {};
      const freshGrant = codexAutoPublishGrant(fresh);
      const current = fresh.codexAutoPublish && typeof fresh.codexAutoPublish === 'object' ? fresh.codexAutoPublish : {};
      if (!freshGrant || clean(fresh.publishState && fresh.publishState.jobId)) return false;
      if (clean(current.fingerprint) === fingerprint
        && ['starting', 'submitted', 'failed'].includes(clean(current.status))) return false;
      transaction.set(after.ref, {
        codexAutoPublish: {
          status: 'starting', workflowVersion: LISTING_WORKFLOW_ID, snapshotId: grant.snapshotId,
          fingerprint, attemptToken, startedAt: admin.firestore.FieldValue.serverTimestamp(),
          startedBy: grant.email, backendFirst: true, desktopControlFallbackOnly: true
        }
      }, { merge: true });
      return true;
    });
    if (!claimed) return null;

    const delays = [0, 3000, 10000, 30000];
    let lastError = null;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt]) await wait(delays[attempt]);
      try {
        const result = await publishProductListingCaseHandler({
          data: { productId },
          auth: { uid: `codex-auto:${productId}`, token: { email: grant.email, manager: true } }
        });
        const failureMessage = publishResultFailureMessage(result);
        if (failureMessage && isTransientListingPublishFailure(failureMessage) && attempt < delays.length - 1) {
          lastError = new Error(failureMessage);
          continue;
        }
        if (failureMessage) throw new Error(failureMessage);
        await after.ref.set({
          codexAutoPublish: {
            status: 'submitted', workflowVersion: LISTING_WORKFLOW_ID, snapshotId: grant.snapshotId,
            fingerprint, attemptToken, jobId: clean(result && result.jobId),
            currentStage: clean(result && result.currentStage), completedAt: admin.firestore.FieldValue.serverTimestamp()
          }
        }, { merge: true });
        return result;
      } catch (error) {
        lastError = error;
        if (!isTransientListingPublishFailure(error) || attempt === delays.length - 1) break;
      }
    }
    const failureMessage = clean(lastError && lastError.message).slice(0, 800) || '發布未完成';
    const batchPlatformFailures = {};
    grant.listingTargetPlatforms.forEach((platform) => {
      batchPlatformFailures[platform] = {
        status: 'failed', reason: failureMessage, retryable: true, lastAttemptAt: new Date()
      };
    });
    await after.ref.set({
      codexAutoPublish: {
        status: 'failed', workflowVersion: LISTING_WORKFLOW_ID, snapshotId: grant.snapshotId,
        fingerprint, attemptToken, error: failureMessage,
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      batchQueueStatus: 'failed', batchQueueError: failureMessage,
      batchPlatformFailures, batchRetryPlatforms: grant.listingTargetPlatforms,
      batchNextRetryAt: null, batchQueueUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return null;
  });

  target.verifyProductListingStage = onCall({
    region: REGION,
    timeoutSeconds: 180,
    memory: '512MiB',
    enforceAppCheck: false
  }, async (request) => {
    if (!isAllowedManager(request)) throw new HttpsError('permission-denied', '請先使用管理者帳號登入。');
    const jobId = clean(request && request.data && request.data.jobId);
    const requestedStage = clean(request && request.data && request.data.stage).toLowerCase();
    if (!jobId || jobId.length > 200 || jobId.includes('/')) throw new HttpsError('invalid-argument', '上架工作編號格式不正確。');
    if (requestedStage !== 'shopee') throw new HttpsError('invalid-argument', '只有蝦皮正式清單核對可由這支 callable 送出；酷澎與 MOMO 只接受同一 queue worker 的 verified receipt。');
    const db = admin.firestore();
    const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
    const initialJobSnap = await jobRef.get();
    if (!initialJobSnap.exists) throw new HttpsError('not-found', '找不到這筆上架工作。');
    const initialJob = initialJobSnap.data() || {};
    const snapshot = initialJob.preparedSnapshot && typeof initialJob.preparedSnapshot === 'object' ? initialJob.preparedSnapshot : null;
    if (!snapshot || clean(initialJob.workflowVersion) !== LISTING_WORKFLOW_ID) throw new HttpsError('failed-precondition', '這筆工作不是目前固定版網路上架流程；舊 job 只能查看，不能沿用舊回條繼續。');
    if (!listingStageSelected(snapshot, requestedStage)) throw new HttpsError('failed-precondition', '蝦皮不在本次所選通路內，不能送出核對。');
    const verification = validatePlatformStageVerification(requestedStage, snapshot, request && request.data && request.data.verification);
    if (!verification.verified) throw new HttpsError('failed-precondition', `正式清單核對未通過：${verification.reasons.join('、')}`);
    const result = await finalizeVerifiedShopeeStage(
      db,
      jobId,
      verification,
      clean(request.auth && request.auth.token && request.auth.token.email) || '管理者'
    );
    if (result.status === 'blocked-image-reference-verification') {
      throw new HttpsError('failed-precondition', `本次所選通路圖片引用核對未通過：${result.reasons.join('、')}`);
    }
    return { ok: true, verifiedStage: requestedStage, ...result };
  });

  target.applyProductListingQueueReceipt = onDocumentWritten({
    document: `${PLATFORM_QUEUE_COLLECTION}/{queueId}`,
    region: REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [EASYSTORE_ACCESS_TOKEN]
  }, async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return null;
    const before = event.data && event.data.before;
    const current = after.data() || {};
    const previous = before && before.exists ? before.data() || {} : {};
    const sameReceipt = clean(previous.status) === clean(current.status)
      && clean(previous.jobId) === clean(current.jobId)
      && clean(previous.attemptToken) === clean(current.attemptToken)
      && clean(previous.fingerprint) === clean(current.fingerprint)
      && JSON.stringify(previous.verificationReceipt || null) === JSON.stringify(current.verificationReceipt || null);
    if (sameReceipt) return null;
    return applyVerifiedQueueReceipt(admin.firestore(), clean(event.params && event.params.queueId), current);
  });
}

module.exports = {
  registerProductListingPublish,
  _test: {
    normalizeSku,
    normalizeListingTargetScope,
    listingTargetPlatforms,
    listingTargetLabel,
    resolveEasyStoreCollectionNames,
    easyStoreCollectionCatalog: () => [...EASYSTORE_COLLECTION_CATALOG],
    normalizeListingIntent,
    listingIntentPolicy,
    listingPhysicalImageUrls,
    productDescriptionToSafeHtml,
    listingDescriptionContentStatus,
    richContentLifecycle,
    buildListingSnapshot,
    buildEasyStoreProductBody,
    momoProductName,
    momoShortFeaturePlan,
    normalizeMomoAttributes,
    momoMarketPrice,
    normalizeShopeeAttributes,
    applyShopeeAttributeTemplate,
    canonicalShopeeCategorySegment,
    shopeeCategorySegments,
    hsinchuSizeBand,
    buildShopeeLogistics,
    buildMomoShipping,
    buildCoupangShipping,
    buildShopeeAutofillPayload,
    platformListingIds,
    platformQueueFingerprint,
    platformStageFingerprint,
    listingSnapshotFingerprint,
    buildPlatformQueuePolicy,
    evaluateMomoPublishVerification,
    selectMomoCapacityRecoveryCandidate,
    identityAllowsShopeeAutofill,
    summarizePlatformsForStorage,
    platformListingStatusFromPublish,
    appendShopDescriptionPromos,
    appendShopDescriptionImages,
    listingImageAllocation,
    easyStoreGalleryImages,
    easyStoreVariantImageUrl,
    easyStoreImageIdForPlannedUrl,
    prioritizedListingImageUrls,
    localizedRepresentativeImage,
    finalizedRoleRowsForCase,
    buildFinalPlatformImagePlan,
    finalizePreparedMediaSnapshot,
    preparedPlatformImagePlan,
    platformImagePlanMissingFields,
    platformPayloadSnapshot,
    exactEasyStoreMatches,
    easyStoreMissingFields,
    listingIntentIdentityMissingFields,
    momoMissingFields,
    coupangMissingFields,
    platformCategoryResolution,
    validatePlatformImageEvidence,
    validatePlatformStageVerification,
    validateQueuedStageReceiptIdentity,
    validateQueuedStageReceipt,
    listingStageVerified,
    listingStageExplicitlyVerified,
    initialListingStages,
    allListingStagesVerified,
    deriveListingCurrentStage,
    listingBatchFailurePayload,
    listingRootStageNeedsResume,
    validateAllPlatformImageReceipts,
    centralCompletedImageUpdate,
    completedVariantRecords,
    syncPreparedCentralImagesBeforePublish,
    validateCompletionImageReferences,
    activeV3JobReuseBlockers,
    frozenInputSnapshotFingerprint,
    buildCanonicalCategoryDecision,
    buildListingDecisionContract,
    brandTemplateContract: () => JSON.parse(JSON.stringify(BRAND_TEMPLATE_CONTRACT)),
    brandCreativeStyleCatalog: () => JSON.parse(JSON.stringify(listingBrandCreative.STYLE_CATALOG)),
    brandCreativeStyleAssignment: listingBrandCreative.assignment,
    brandCreativeStyleRenderProof: listingBrandCreative.renderProof,
    buildPlatformPageContracts,
    buildPreparedPlatformFieldPlan,
    publishEasyStoreStage,
    publishEasyStoreStageWithRetry,
    applyVerifiedQueueReceipt,
    finalizeListingJobIfReady,
    finalizeVerifiedShopeeStage,
    easyStoreVariantPrice,
    easyStoreVariantStock,
    easyStorePublicationState,
    overallPublishStatus,
    codexAutoPublishGrant,
    codexAutoPublishInputFingerprint,
    isTransientListingPublishFailure,
    publishResultFailureMessage
  }
};
