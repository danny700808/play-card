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
    identifiedProductName: 'JUPITER 音樂書包',
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
    commonProductDescription: 'JUPITER 樂器書包，適合收納樂譜與配件。',
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
    productUrl: '', imageUrls: ['https://example.com/one.jpg', 'https://example.com/two.jpg']
  };
  const request = research.buildOpenAIRequest(context, 'gpt-5.4-mini', true);

  assert.deepEqual(request.tools, [{ type: 'web_search' }]);
  assert.equal(request.store, false);
  assert.equal(request.input[0].content.filter((part) => part.type === 'input_image').length, 2);
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
  assert.deepEqual(new Set(request.text.format.schema.required), new Set(Object.keys(request.text.format.schema.properties)));
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
