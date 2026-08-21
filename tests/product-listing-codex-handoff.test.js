'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('operations-phase1.js', 'utf8');

function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + 1);
  assert.ok(first >= 0 && last > first, `找不到程式區段：${start}`);
  return source.slice(first, last);
}

function loadPureFunction(start, end, name, dependencies) {
  const body = section(start, end);
  const names = Object.keys(dependencies || {});
  const values = names.map((key) => dependencies[key]);
  return Function(...names, "'use strict';\n" + body + "\nreturn " + name + ";")(...values);
}

test('一鍵上架按鈕把固定 v2 工作帶入指定 Codex 對話並授權後端續跑', () => {
  assert.match(source, /const PRODUCT_LISTING_CODEX_THREAD_URL = 'codex:\/\/threads\/'/);
  assert.match(source, /function productListingCodexThreadUrl\(prompt\)/);
  assert.match(source, /params\.set\('prompt',clean\(prompt\)\)/);
  assert.match(source, /async function handoffProductListingToCodex\(form\)/);
  assert.match(source, /caseStatus:'waiting-codex'/);
  assert.match(source, /codexHandoff:\{status:'pending'/);
  assert.match(source, /workflowVersion:PRODUCT_LISTING_WORKFLOW_VERSION/);
  assert.match(source, /preflightSnapshot:snapshot/);
  assert.match(source, /neverRebuildPreflightDuringRetry:true/);
  assert.match(source, /global\.location\.href=threadUrl/);
  assert.match(source, /autoPublishAuthorization:\{granted:true/);
  assert.match(source, /noSecondConfirmation:true/);
  assert.doesNotMatch(source, /Codex 待辦已建立/);
});

test('主要按鈕不再直接執行 OpenAI 文案與圖片 API 流程', () => {
  const handler = source.match(/if\(action==='product-listing-codex-complete'\)\{[\s\S]*?\n\s*\}/)[0];
  assert.match(handler, /handoffProductListingToCodex/);
  assert.doesNotMatch(handler, /completeProductListingWithCodex/);
  assert.doesNotMatch(source, /async function completeProductListingWithCodex/);
  assert.doesNotMatch(handler, /researchProductListingCase|generateProductListingImage/);
  assert.match(source, /完成圖資料齊全後會由後端依 EasyStore、蝦皮、酷澎、MOMO 固定順序自動續跑/);
  assert.match(source, /不得重新呼叫網站的 OpenAI 文案或圖片 API/);
  assert.match(source, /已停用網頁 OpenAI/);
});

test('交接會等待收圖、保存後重讀案件，再從固定快照建立指令', () => {
  const handoff = section('async function handoffProductListingToCodex(form)', 'function productListingCodexResultDraft');
  const wait = handoff.indexOf('await finishProductImageCollectionBeforeHandoff(form)');
  const refresh = handoff.indexOf('await refreshProductListingHandoffMediaFromDatabase(form)');
  const save = handoff.indexOf('await saveProductListingCase(form,false,true,true)');
  const reload = handoff.indexOf('await loadProductListingCodexHandoffSnapshot(product)');
  const prompt = handoff.indexOf('productListingCodexHandoffPrompt(product,snapshot)');
  assert.ok(wait >= 0 && refresh > wait && save > refresh && reload > save && prompt > reload);
  assert.doesNotMatch(handoff, /const draft=productListingDraftFromForm\(form\)/);
  assert.doesNotMatch(handoff, /confirmAction\(/);
});

test('交接中用 inert 鎖住互動，但不會 disabled 表單欄位後再保存空資料', () => {
  const ui = section('function setProductListingCodexUi', 'function productListingCodexMediaSnapshot');
  assert.match(ui, /button\.disabled=running/);
  assert.match(ui, /form\.inert=running/);
  assert.doesNotMatch(ui, /lockProductListingCaseForm/);
  assert.doesNotMatch(ui, /form\.disabled/);
});

test('獨立商品真正沒有來源圖與完成圖時不建立零圖工作', () => {
  const validator = section('function requireProductListingCodexHandoffMedia', 'function productListingCodexHandoffPrompt');
  const handoff = section('async function handoffProductListingToCodex(form)', 'function productListingCodexResultDraft');
  assert.match(validator, /item\.imageStatus==='missing-source'/);
  assert.match(validator, /item\.imageStatus==='missing-lineage'/);
  assert.match(validator, /圖片尚未完整保存到商品案件/);
  assert.match(validator, /不會拿同系列商品圖片替代/);
  assert.ok(handoff.indexOf('requireProductListingCodexHandoffMedia(snapshot)') < handoff.indexOf("caseStatus:'waiting-codex'"));
});

test('交接逐案件列出來源、待繁體化、完成圖與圖片狀態', () => {
  const media = section('function productListingCodexMediaSnapshot', 'async function loadProductListingCodexHandoffCase');
  const prepared = section('function productListingCodexPreparedCase', 'async function loadProductListingCodexHandoffCase');
  const prompt = section('function productListingCodexHandoffPrompt', 'function productListingCodexThreadUrl');
  assert.match(media, /selectedReferenceImageUrls/);
  assert.match(media, /generatedListingImages/);
  assert.match(media, /sourceImageUrl/);
  assert.match(media, /completedImageUrls/);
  assert.match(media, /missing-lineage/);
  assert.match(prepared, /selectedReferenceImageUrls/);
  assert.match(prepared, /imageGenerationInstructions/);
  assert.match(prepared, /priceSnapshot/);
  assert.match(prepared, /shippingDecision/);
  assert.match(prompt, /codexHandoff\.preflightSnapshot 是不可變的 handoff input snapshot/);
  assert.match(prompt, /Codex 完成圖片後，把 generatedListingImages 寫回各商品案件/);
  assert.match(prompt, /第一次進入平台前，後端會重讀全部案件的最新完成輸出/);
  assert.match(prompt, /EasyStore、蝦皮、酷澎與 MOMO 及所有重試只准沿用該快照/);
  assert.match(prompt, /來源圖 .*待繁體化／定案 .*完成圖 .*缺少角色 .*狀態/);
  assert.match(prompt, /流程、角色與核對規則不可漂移/);
  assert.match(prompt, /EasyStore 官網、蝦皮、酷澎、MOMO/);
  assert.match(prompt, /每站送出後(?:由 verifyProductListingStage )?只核對一次正式清單與正式商品資料/);
  assert.match(prompt, /blocked-by-previous-stage/);
  assert.match(prompt, /appliedImageUrls/);
  assert.match(prompt, /officialImageUrls/);
  assert.match(prompt, /可為平台 CDN/);
  assert.match(prompt, /中央或任一細項圖片欄位只要仍等於任一凍結來源 URL 就停止/);
  assert.match(prompt, /只有 job schema、目前 automationPolicy、固定 platformOrder/);
  assert.match(prompt, /先保留至少一張 cleanMain 與一張 brandedHero/);
  assert.match(prompt, /MOMO 第 2 或第 3 張必須先保留專推圖/);
});

test('新細項的父商品會沿用已儲存的來源圖佇列，但不把未驗證完成圖當成繁體圖', () => {
  const merge = section('function mergeProductListingCodexQueuedMedia', 'async function loadProductListingCodexHandoffSnapshot');
  const snapshot = section('async function loadProductListingCodexHandoffSnapshot', 'function requireProductListingCodexHandoffMedia');
  assert.match(merge, /queuedSources=normalizeProductResearchSourceUrls\(row\.sourceImageUrls\)/);
  assert.match(merge, /selectedReferenceImageUrls:sourceImageUrls\.slice\(\)/);
  assert.match(merge, /pending-localization/);
  assert.doesNotMatch(merge, /row\.completedImageUrls/);
  assert.match(snapshot, /mergeProductListingCodexQueuedMedia\(item,queued\)/);
});

test('Codex 交接指令明確區分乾淨主圖與淺色品牌首圖', () => {
  const prompt = section('function productListingCodexHandoffPrompt', 'function productListingCodexThreadUrl');
  assert.match(prompt, /cleanMain 是無品牌框、無 Logo、無地址／電話／QR Code/);
  assert.match(prompt, /brandedHero 才使用方形 1:1「柚子樂器淺色商業展示版」/);
  assert.match(prompt, /商品去背後約占 55～65%/);
  assert.match(prompt, /最多 2 個有來源依據的輔助視覺/);
  assert.match(prompt, /不得加入價格、聯絡資訊、浮水印或虛構功能／配件/);
});

test('交接只用 v2 固定流程，不留舊版降級或第二路徑', () => {
  const prompt = section('function productListingCodexHandoffPrompt', 'function productListingCodexThreadUrl');
  assert.match(source, /const PRODUCT_LISTING_WORKFLOW_VERSION = 'youzi-four-channel-listing-v2'/);
  assert.match(prompt, /v1 或任何其他舊快照一律停止/);
  assert.match(prompt, /不得沿用、混合或降級/);
  assert.match(prompt, /禁止先全面瀏覽或搜尋任一平台商品清單/);
  assert.match(prompt, /只有送出結果不明[\s\S]*完全相同 SKU 做一次精確查詢/);
  assert.match(prompt, /不得[\s\S]*切換蝦皮賣家中心或開第二條上架路徑/);
  assert.match(prompt, /蝦皮只使用 EasyStore 官方蝦皮通路同步／編輯頁/);
  assert.doesNotMatch(prompt, /MOMO 首圖必須是 (?:brandedHero|綠底|品牌圖)/);
  assert.doesNotMatch(prompt, /(?:改用|備援使用|另開一條)[^\n。]{0,30}蝦皮賣家中心/);
});

test('四通路圖片實際依完成圖角色排序，不會把來源原圖送上平台', () => {
  const normalizeUrls = (values) => Array.from(new Set((Array.isArray(values) ? values : [])
    .filter((value) => /^https?:\/\//.test(String(value)))));
  const planImages = loadPureFunction(
    'function productListingPlatformImagePlan',
    'function immutableProductListingSnapshot',
    'productListingPlatformImagePlan',
    { normalizeProductResearchSourceUrls: normalizeUrls, PRODUCT_GROUP_LISTING_IMAGE_MAX: 12 }
  );
  const sourceUrl = 'https://supplier.example.com/simplified-source.jpg';
  const secondSourceUrl = 'https://supplier.example.com/second-simplified-source.jpg';
  const heroUrl = 'https://cdn.example.com/branded-hero-zh-tw.jpg';
  const cleanUrl = 'https://cdn.example.com/clean-main-zh-tw.jpg';
  const detailUrl = 'https://cdn.example.com/detail-zh-tw.jpg';
  const emptyFlags = {
    containsLogo: false, containsContactInfo: false, containsQrCode: false,
    greenBrandTemplate: false, momoPromotionEligible: false
  };
  const rows = [
    { sourceImageUrl: sourceUrl, url: sourceUrl, roles: ['cleanMain'], assetFlags: emptyFlags },
    { sourceImageUrl: sourceUrl, url: secondSourceUrl, roles: ['localizedDetail'], assetFlags: emptyFlags },
    { sourceImageUrl: sourceUrl, url: heroUrl, roles: ['brandedHero'], assetFlags: { ...emptyFlags, containsLogo: true, greenBrandTemplate: true } },
    { sourceImageUrl: sourceUrl, url: cleanUrl, roles: ['cleanMain'], assetFlags: emptyFlags },
    { sourceImageUrl: sourceUrl, url: detailUrl, roles: ['localizedDetail'], assetFlags: { ...emptyFlags, momoPromotionEligible: true } }
  ];
  const plan = planImages(rows, [sourceUrl, secondSourceUrl]);
  assert.deepEqual(plan.easyStore.imageUrls.slice(0, 2), [heroUrl, cleanUrl]);
  assert.deepEqual(plan.shopee.imageUrls.slice(0, 2), [heroUrl, cleanUrl]);
  assert.deepEqual(plan.coupang.imageUrls.slice(0, 2), [cleanUrl, heroUrl]);
  assert.deepEqual(plan.momo.imageUrls.slice(0, 3), [cleanUrl, detailUrl, heroUrl]);
  assert.equal(plan.momo.promotionImageUrl, detailUrl);
  assert.equal(plan.momo.promotionImageReady, true);
  for (const platform of ['easyStore', 'shopee', 'coupang', 'momo']) {
    assert.equal(plan[platform].imageUrls.includes(sourceUrl), false);
    assert.equal(plan[platform].imageUrls.includes(secondSourceUrl), false);
  }
});

test('營運中心 12 張共用池也先保留必要角色並公平涵蓋 13 個細項', () => {
  const normalizeUrls = (values) => Array.from(new Set((Array.isArray(values) ? values : [])
    .filter((value) => /^https?:\/\//.test(String(value)))));
  const sharedRows = loadPureFunction(
    'function productListingSharedCompletedRows',
    'function productListingPlatformImagePlan',
    'productListingSharedCompletedRows',
    {
      readyProductListingImageRows: (prepared) => prepared.rows || [],
      productListingConflictingRoleUrls: () => new Set(),
      normalizeProductResearchSourceUrls: normalizeUrls,
      PRODUCT_GROUP_LISTING_IMAGE_MAX: 12
    }
  );
  const cases = Array.from({ length: 13 }, (_, index) => ({
    gallerySourceImageUrls: [],
    preparedCase: { rows: [
      { sourceImageUrl: `https://supplier.example.com/${index}-clean.jpg`, url: `https://cdn.example.com/variant-${index}-clean.jpg`, roles: ['cleanMain'], sourceOrder: 1 },
      { sourceImageUrl: `https://supplier.example.com/${index}-brand.jpg`, url: `https://cdn.example.com/variant-${index}-brand.jpg`, roles: ['brandedHero'], sourceOrder: 1 }
    ] }
  }));
  const result = sharedRows(cases);
  assert.equal(result.length, 12);
  assert.equal(result.some((row) => row.roles.includes('cleanMain')), true);
  assert.equal(result.some((row) => row.roles.includes('brandedHero')), true);
  const represented = new Set(result.map((row) => /variant-(\d+)-/.exec(row.url)?.[1]).filter(Boolean));
  assert.equal(represented.size, 12);
});

test('原圖 URL 即使被舊資料誤標 ready 也不能成為完成圖', () => {
  const readyRows = section('function readyProductListingImageRows', 'function productListingConflictingRoleUrls');
  const platformPlan = section('function productListingPlatformImagePlan', 'function immutableProductListingSnapshot');
  assert.match(readyRows, /allSourceUrls\.has\(row\.url\)/);
  assert.match(platformPlan, /frozenSources\.has\(row\.url\)/);
});

test('同一案件的另一張來源圖不可冒充繁體完成圖', () => {
  const normalizeUrls = (values) => Array.from(new Set((Array.isArray(values) ? values : [])
    .filter((value) => /^https?:\/\//.test(String(value)))));
  const normalizeGenerated = (values) => (Array.isArray(values) ? values : []).map((row) => ({ ...row }));
  const readyRows = loadPureFunction(
    'function readyProductListingImageRows',
    'function productListingConflictingRoleUrls',
    'readyProductListingImageRows',
    { normalizeGeneratedListingImages: normalizeGenerated, normalizeProductResearchSourceUrls: normalizeUrls }
  );
  const sourceOne = 'https://supplier.example.com/source-one.jpg';
  const sourceTwo = 'https://supplier.example.com/source-two.jpg';
  const rows = readyRows({
    referenceImageUrls: [sourceOne, sourceTwo],
    selectedReferenceImageUrls: [sourceOne, sourceTwo],
    generatedListingImages: [
      { sourceImageUrl: sourceOne, url: sourceTwo, status: 'ready', localizationStatus: 'completed', roles: ['cleanMain'] },
      { sourceImageUrl: sourceTwo, url: 'https://cdn.example.com/source-two-zh-tw.jpg', status: 'ready', localizationStatus: 'completed', roles: ['cleanMain'] }
    ]
  });
  assert.equal(rows.some((row) => row.url === sourceTwo), false);
  assert.equal(rows.some((row) => row.url === 'https://cdn.example.com/source-two-zh-tw.jpg'), true);
});

test('同一來源可有多個角色輸出，但同一完成圖不可同時當乾淨圖與品牌圖', () => {
  const conflictingUrls = loadPureFunction(
    'function productListingConflictingRoleUrls',
    'function productListingImageRowsForRole',
    'productListingConflictingRoleUrls',
    {}
  );
  const sameSource = 'https://supplier.example.com/source.jpg';
  const validRows = [
    { sourceImageUrl: sameSource, url: 'https://cdn.example.com/clean.jpg', roles: ['cleanMain'] },
    { sourceImageUrl: sameSource, url: 'https://cdn.example.com/hero.jpg', roles: ['brandedHero'] }
  ];
  assert.deepEqual(Array.from(conflictingUrls(validRows)), []);
  const conflictRows = validRows.concat({
    sourceImageUrl: sameSource, url: 'https://cdn.example.com/clean.jpg', roles: ['brandedHero']
  });
  assert.deepEqual(Array.from(conflictingUrls(conflictRows)), ['https://cdn.example.com/clean.jpg']);
});

test('指定 v2 job 續跑只接受同一 productId 並直接交給蝦皮助手', () => {
  const resume = section('async function resumeExplicitShopeeListingFromQuery', 'function productListingTransientFailure');
  assert.match(resume, /resumeListingJob/);
  assert.match(resume, /result&&result\.jobId\)!==jobId/);
  assert.match(resume, /result&&result\.currentStage\)!=='shopee'/);
  assert.match(resume, /payload\.workflowVersion\)!==PRODUCT_LISTING_WORKFLOW_VERSION/);
  assert.match(resume, /YouziShopeeAutofill\.queue\(payload\)/);
});

test('蝦皮正式狀態儲存後沿用同一 v2 job 自動推進酷澎', () => {
  const advance = section('async function advanceFixedV2AfterShopeeStatus', 'async function saveProductPlatformStatus');
  assert.match(advance, /clean\(job\.workflowVersion\)!==PRODUCT_LISTING_WORKFLOW_VERSION/);
  assert.match(advance, /clean\(job\.currentStage\)!=='shopee'/);
  assert.match(advance, /httpsCallable\('verifyProductListingStage'/);
  assert.match(advance, /stage:'shopee'/);
  assert.match(advance, /platformListMatched:true,officialCatalogMatched:true,imageEvidenceComplete:true/);
  assert.match(advance, /appliedImageUrls:appliedImageUrls,officialImageUrls:officialImageUrls/);
  const save = section('async function saveProductPlatformStatus', 'const LABEL_PRINT_ENDPOINTS');
  assert.match(save, /advanceFixedV2AfterShopeeStatus\(p,statuses\)/);
});
