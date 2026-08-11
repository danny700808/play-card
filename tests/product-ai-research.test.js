'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
const serverTimestamp = Object.freeze({ __serverTimestamp: true });

Module._load = function mockFirebase(request, parent, isMain) {
  if (request === 'firebase-functions/v2/https') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    return { onCall: (_options, handler) => handler, HttpsError };
  }
  if (request === 'firebase-functions/params') {
    return { defineSecret: () => ({ value: () => '' }) };
  }
  if (request === 'firebase-admin') {
    const firestore = () => ({ collection: () => { throw new Error('database not used in helper tests'); } });
    firestore.FieldValue = { serverTimestamp: () => serverTimestamp };
    return { apps: [{}], firestore };
  }
  return originalLoad(request, parent, isMain);
};

const research = require('../functions/productAiResearch');
Module._load = originalLoad;

function completeResult(overrides = {}) {
  return {
    identityStatus: 'confirmed',
    identifiedProductName: 'JUPITER 音樂書包',
    identityEvidence: '商品圖片與原廠頁面外觀一致。',
    identityConflictSummary: null,
    brand: 'JUPITER',
    model: null,
    barcode: null,
    alternateNames: '樂器書包、譜袋',
    searchKeywords: 'JUPITER 音樂書包、管樂譜袋',
    sellingPoints: '可收納樂譜與配件',
    specificationText: '用途：樂譜收納\n品牌：JUPITER',
    includedItems: '書包本體、背帶',
    material: '聚酯纖維',
    color: '灰色',
    countryOfOrigin: null,
    warrantyInfo: '無保固',
    shortDescription: '樂譜與配件收納用書包。',
    commonProductDescription: 'JUPITER 樂器書包，適合收納樂譜與配件。',
    featureList: '1. 樂譜收納\n2. 配件分類\n3. 附背帶\n4. 輕巧攜帶\n5. 日常練習適用\n6. 管樂學習用品整理',
    faqText: 'Q：可放樂譜嗎？\nA：可以。',
    easyStoreHtml: '<h2>JUPITER 樂器書包</h2><p>適合收納樂譜與配件。</p>',
    shopeeTitle: 'JUPITER 音樂書包 樂譜收納袋',
    shopeeDescription: 'JUPITER 樂器書包，適合收納樂譜與配件。',
    shopeeRequiredNotes: '分類屬性待 EasyStore 發佈時確認。',
    momoGoodsName: 'JUPITER 音樂書包',
    momoSlogan: '樂譜與配件收納',
    momoHtml: '<h2>JUPITER 音樂書包</h2><p>樂譜收納。</p>',
    momoRequiredNotes: '分類必要屬性待確認。',
    coupangTitle: 'JUPITER 音樂書包',
    coupangDescriptionHtml: '<h2>JUPITER 音樂書包</h2><p>樂譜收納。</p>',
    coupangRequiredNotes: '分類必要屬性待確認。',
    imagePlan: '1. 白底主圖\n2. 收納空間圖',
    shopeeCategoryPath: '愛好與收藏品 > 樂器與樂器配件 > 管樂器',
    momoCategoryCode: null,
    coupangCategoryCode: null,
    shippingDecision: 'convenience',
    packageLengthCm: null,
    packageWidthCm: null,
    packageHeightCm: null,
    packageWeightKg: null,
    packageMeasurementMode: 'not_found',
    packageResearchSourceUrl: null,
    packageResearchNote: '未找到原廠外箱尺寸，小型軟袋可保守估算。',
    productResearchSourceUrls: ['https://example.com/jupiter-bag'],
    fieldEvidence: [{ field: '品牌', sourceUrl: 'https://example.com/jupiter-bag', note: '原廠頁標示 JUPITER', confidence: 'high' }],
    sourceConflicts: [],
    confidence: 'medium',
    missingFields: ['model', 'barcode'],
    imageEvidenceUsed: true,
    researchSummary: '名稱與用途可確認，外箱尺寸未找到。',
    ...overrides
  };
}

test('OpenAI request uses web search, product images and strict structured output', () => {
  const context = {
    productId: 'p1', sku: '3800106', name: 'JUPITER 音樂書包', onlineName: '',
    brand: 'JUPITER', model: '', barcode: '', category: '管樂器', variantName: '',
    productUrl: '', referenceUrls: ['https://brand.example/product'], sourceProductDescription: '', researchInstructions: '', imageUrls: ['https://example.com/one.jpg', 'https://example.com/two.jpg']
  };
  const request = research.buildOpenAIRequest(context, research.DEFAULT_MODEL, true);

  assert.deepEqual(request.tools, [{ type: 'web_search' }]);
  assert.equal(request.model, 'gpt-5.6-sol');
  assert.deepEqual(request.reasoning, { effort: 'high' });
  assert.equal(request.store, false);
  assert.equal(request.input[0].content.filter((part) => part.type === 'input_image').length, 2);
  assert.ok(request.input[0].content.filter((part) => part.type === 'input_image').every((part) => part.detail === 'high'));
  assert.match(request.input[0].content[0].text, /https:\/\/brand\.example\/product/);
  assert.doesNotMatch(request.input[0].content[0].text, /3800106/);
  assert.match(request.input[0].content[0].text, /任務是把「這一件商品」整理成可直接檢查、修改與上架的資料/);
  assert.match(request.input[0].content[0].text, /featureList 必須寫 6～10 點/);
  assert.doesNotMatch(request.input[0].content[0].text, /這是完整研究|完成下列四個階段/);
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
  assert.deepEqual(new Set(request.text.format.schema.required), new Set(Object.keys(request.text.format.schema.properties)));
});

test('AI product image workflow localizes a source image without redesigning it', () => {
  const context = { name: 'aNueNue L10 木吉他', sku: '100117-1' };
  const request = research.buildOpenAIImageRequest(context, {
    researchedProductName: 'aNueNue L10 木吉他',
    shortDescription: '41 吋原聲木吉他',
    featureList: '雲杉面板\n桃花心木側背板',
    imagePlan: '乾淨白底特色圖',
    imageGenerationInstructions: '不要放價格'
  }, ['https://example.com/guitar.jpg'], research.DEFAULT_IMAGE_WORKFLOW_MODEL);

  assert.equal(request.model, 'gpt-5.6');
  assert.deepEqual(request.tools, [{ type: 'image_generation', action: 'edit' }]);
  assert.equal(request.input[0].content.filter((part) => part.type === 'input_image').length, 1);
  assert.equal(request.input[0].content[1].detail, 'high');
  assert.match(request.input[0].content[0].text, /最小幅度的台灣繁體中文在地化/);
  assert.match(request.input[0].content[0].text, /不重新設計、不改成正方形/);
  assert.doesNotMatch(request.input[0].content[0].text, /100117-1/);
  assert.equal(research.responseGeneratedImageBase64({ output: [{ type: 'image_generation_call', result: 'YWJj' }] }), 'YWJj');

  const prompt = research.buildLocalizedImagePrompt(context, {
    researchedProductName: 'aNueNue L10 木吉他',
    brand: 'aNueNue', model: 'L10', color: '原木色'
  }, 2, 10);
  assert.match(prompt, /這是圖像編輯任務，不是重新設計/);
  assert.match(prompt, /第 2 張／共 10 張/);
  assert.match(prompt, /必須保留：品牌標誌/);
  assert.equal(research.DEFAULT_IMAGE_EDIT_MODEL, 'gpt-image-2');
});

test('remote image safety blocks local and private addresses', () => {
  assert.equal(research.isPrivateIpAddress('127.0.0.1'), true);
  assert.equal(research.isPrivateIpAddress('192.168.1.10'), true);
  assert.equal(research.isPrivateIpAddress('169.254.169.254'), true);
  assert.equal(research.isPrivateIpAddress('8.8.8.8'), false);
  assert.equal(research.isPrivateIpAddress('2001:4860:4860::8888'), false);
});

test('product page image discovery finds main, lazy, JSON-LD and escaped marketplace images', () => {
  const html = `
    <meta property="og:image" content="/images/main.jpg">
    <script type="application/ld+json">{"@type":"Product","image":["https://cdn.example.com/spec.webp"]}</script>
    <img data-ks-lazyload="//cdn.example.com/lifestyle.png" src="/images/loading.gif">
    <script>window.detail={"image":"https:\\/\\/cbu01.alicdn.com\\/img\\/ibank\\/detail.jpg"}</script>
  `;
  const rows = research.extractImageCandidatesFromHtml(html, 'https://shop.example.com/item/123');
  const urls = rows.map((row) => row.url);

  assert.equal(urls[0], 'https://shop.example.com/images/main.jpg');
  assert.ok(urls.includes('https://cdn.example.com/spec.webp'));
  assert.ok(urls.includes('https://cdn.example.com/lifestyle.png'));
  assert.ok(urls.includes('https://cbu01.alicdn.com/img/ibank/detail.jpg'));
  assert.ok(urls.indexOf('https://shop.example.com/images/loading.gif') === -1 || urls.indexOf('https://shop.example.com/images/loading.gif') > 2);
});

test('commerce login and verification pages are reported as blocked without requesting passwords', () => {
  assert.equal(research.isBlockedCommercePage('https://login.taobao.com/member/login.jhtml', '<html></html>', 200), true);
  assert.equal(research.isBlockedCommercePage('https://detail.1688.com/offer/1.html', '<h1>请登录后继续</h1><p>滑动验证</p>', 200), true);
  assert.equal(research.isBlockedCommercePage('https://www.ibanez.com/na/products/detail/azes40_1p_01.html', '<h1>AZES40</h1>', 200), false);
});

test('public image-source fallback searches exact product pages and does not expose internal SKU', () => {
  const request = research.buildProductImageSourceDiscoveryRequest({
    name: 'Ibanez AZES40-MGR 薄荷綠電吉他', brand: 'Ibanez', model: 'AZES40-MGR',
    variantName: '薄荷綠', sku: '1040160-1', referenceUrls: ['https://qr.1688.com/s/example']
  }, research.DEFAULT_MODEL);

  assert.deepEqual(request.tools, [{ type: 'web_search' }]);
  assert.match(request.input[0].content[0].text, /同一品牌、同一型號、同一顏色/);
  assert.match(request.input[0].content[0].text, /AZES40-MGR/);
  assert.doesNotMatch(request.input[0].content[0].text, /1040160-1/);
  assert.equal(request.text.format.strict, true);
});

test('response parsing combines cited sources with model sources', () => {
  const result = completeResult();
  const response = {
    output: [
      { type: 'web_search_call', action: { sources: [{ type: 'source', url: 'https://brand.example/product' }] } },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }
    ]
  };
  const parsed = research.parseResearchResponse(response);

  assert.deepEqual(parsed.productResearchSourceUrls, [
    'https://brand.example/product',
    'https://example.com/jupiter-bag'
  ]);
});

test('platform HTML keeps only the small safe formatting allowlist', () => {
  const safe = research.sanitizeSafeProductHtml('<h2 class="bad">特色</h2><p onclick="x()">內容<strong>重點</strong></p><script>alert(1)</script><img src=x>');
  assert.equal(safe, '<h2>特色</h2><p>內容<strong>重點</strong></p>');
});

test('AI fills blank case fields while preserving manual copy and shipping choices', () => {
  const existing = {
    sellingPoints: '店長人工撰寫內容',
    shippingDecision: 'freight',
    packageLengthCm: 120,
    packageWidthCm: 50,
    packageHeightCm: 40,
    packageWeightKg: 18,
    packageMeasurementMode: 'measured',
    packageResearchStatus: 'manual',
    productResearchSourceUrls: ['https://shop.example/manual-source']
  };
  const merged = research.buildResearchUpdate(existing, completeResult(), {
    requestId: 'req-1', responseId: 'resp-1', model: 'gpt-5.4-mini', imageCount: 1, inputFingerprint: 'abc'
  });

  assert.equal(merged.update.brand, 'JUPITER');
  assert.equal(merged.update.researchedProductName, 'JUPITER 音樂書包');
  assert.equal(merged.update.shopeeTitle, 'JUPITER 音樂書包 樂譜收納袋');
  assert.equal(merged.update.identityStatus, 'confirmed');
  assert.equal(merged.update.schemaVersion, 4);
  assert.equal(merged.update.fieldEvidence.length, 1);
  assert.equal(merged.update.sellingPoints, undefined);
  assert.equal(merged.update.shippingDecision, undefined);
  assert.equal(merged.update.packageLengthCm, undefined);
  assert.deepEqual(merged.update.productResearchSourceUrls, [
    'https://shop.example/manual-source',
    'https://example.com/jupiter-bag'
  ]);
  assert.ok(merged.update.aiResearch.preservedManualFields.includes('sellingPoints'));
  assert.ok(merged.update.aiResearch.preservedManualFields.includes('shippingDecision'));
});

test('explicit refresh replaces only fields previously filled by AI', () => {
  const existing = {
    researchedProductName: '舊 AI 名稱',
    featureList: '舊 AI 特色',
    sellingPoints: '店長人工內容'
  };
  const merged = research.buildResearchUpdate(existing, completeResult(), {
    requestId: 'req-refresh', responseId: 'resp-refresh', model: 'gpt-5.6-sol',
    imageCount: 1, inputFingerprint: 'refresh',
    replaceFields: ['researchedProductName', 'featureList']
  });

  assert.equal(merged.update.researchedProductName, 'JUPITER 音樂書包');
  assert.match(merged.update.featureList, /^1\. /);
  assert.equal(merged.update.sellingPoints, undefined);
  assert.ok(merged.update.aiResearch.preservedManualFields.includes('sellingPoints'));
});

test('small convenience-store products receive safe estimates only when no package size exists', () => {
  const merged = research.buildResearchUpdate({}, completeResult(), {
    requestId: 'req-2', responseId: 'resp-2', model: 'gpt-5.4-mini', imageCount: 1, inputFingerprint: 'def'
  });

  assert.equal(merged.update.shippingDecision, 'convenience');
  assert.deepEqual([
    merged.update.packageLengthCm,
    merged.update.packageWidthCm,
    merged.update.packageHeightCm,
    merged.update.packageWeightKg
  ], [40, 30, 10, 1]);
  assert.equal(merged.update.packageMeasurementMode, 'estimated');
  assert.equal(merged.update.aiResearch.status, 'completed');
});
