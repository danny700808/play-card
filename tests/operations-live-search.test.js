'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const engine = fs.readFileSync('operations-phase1.js', 'utf8');
const mobileHistory = fs.readFileSync('operations-mobile-pos-v4.js', 'utf8');
const portal = fs.readFileSync('portal.html', 'utf8');
const hub = fs.readFileSync('operations-hub.html', 'utf8');
const firestoreRules = fs.readFileSync('firestore.rules', 'utf8');
const storageRules = fs.readFileSync('storage.rules', 'utf8');
const productAiResearchSource = fs.readFileSync('functions/productAiResearch.js', 'utf8');
const productListingPublishSource = fs.readFileSync('functions/productListingPublish.js', 'utf8');

const searchFields = [
  ['posSearch', 'posSearchResults'],
  ['productSearch', 'productSearchResults'],
  ['physicalPhotoSearch', 'physicalPhotoSearchResults'],
  ['purchaseLowSearch', 'purchaseLowSearchResults'],
  ['purchaseEntrySearch', 'purchaseEntrySearchResults'],
  ['stocktakeSearch', 'stocktakeSearchResults'],
  ['inventorySearch', 'inventorySearchResults']
];

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace + 1, index);
    }
  }
  assert.fail(`unterminated function ${name}`);
}

test('obsolete waiting and input-stability search layers are completely removed', () => {
  for (const path of [
    'operations-search-product-ux-v1.js',
    'operations-search-product-ux-v1.css',
    'operations-input-stability-v1.js',
    'operations-input-stability-v1.css'
  ]) {
    assert.equal(fs.existsSync(path), false, `${path} must be deleted`);
  }

  for (const html of [portal, hub]) {
    assert.doesNotMatch(html, /operations-(?:search-product-ux|input-stability)-v1/);
    assert.doesNotMatch(html, /等待輸入/);
    assert.match(html, /operations-phase1\.css\?v=20260824-listing-intents-physical/);
    assert.match(html, /operations-phase1\.js\?v=20260824-listing-intents-physical/);
    assert.match(html, /operations-shopee-autofill-handoff-v1\.js\?v=20260823-shopee-v3-schema6/);
  }
});

test('merged variants show every SKU image and persist optional priority selections', () => {
  const handoffPrompt = functionBody(engine, 'productListingCodexHandoffPrompt');
  assert.match(engine, /上架圖片預覽/);
  assert.match(engine, /ops-listing-variant-processing-flat/);
  assert.match(engine, /name="variantGallerySourceImageUrls"/);
  assert.match(engine, /gallerySourceImageUrls:gallerySourceImageUrls/);
  assert.match(engine, /gallerySourceImageUrls:item\.gallerySourceImageUrls\|\|\[\]/);
  assert.match(engine, /name="currentCompletedImageUrls"/);
  assert.match(handoffPrompt, /每個案件最多 20 張 selectedReferenceImageUrls/);
  assert.match(handoffPrompt, /每一張來源只做一輪完整檢查與台灣繁體化/);
  assert.match(handoffPrompt, /全部編號的完成輸出公平合併/);
  assert.match(handoffPrompt, /整組最多 12 個不同完成圖 URL/);
  assert.match(handoffPrompt, /未勾選的來源與完成圖不得加入任何平台圖庫/);
  assert.match(handoffPrompt, /最多 10 點不重複具體特色/);
  assert.match(handoffPrompt, /保固只填平台保固欄/);
  assert.doesNotMatch(functionBody(engine, 'productListingAutomaticDescription'), /• 保固：/);
  assert.match(handoffPrompt, /尾端加「柚子樂器」/);
  assert.match(handoffPrompt, /實際內容以收到的實體商品為準/);
  assert.match(handoffPrompt, /同一案件、同一 SKU、同一平台草稿與目前階段/);
  assert.match(handoffPrompt, /MOMO、酷澎、EasyStore 是三個獨立根節點/);
  assert.match(handoffPrompt, /單一操作鎖/);
  assert.match(handoffPrompt, /蝦皮只依賴 EasyStore/);
  assert.match(handoffPrompt, /蝦皮只使用 EasyStore 官方蝦皮通路同步／編輯頁/);
  assert.match(handoffPrompt, /不得.*切換蝦皮賣家中心或開第二條上架路徑/);
  assert.match(handoffPrompt, /每站送出後只做一次快速核對/);
  assert.match(handoffPrompt, /不再核對庫存、不重複查兩種清單/);
  assert.match(handoffPrompt, /專推圖只可從 MOMO 完成圖順序第 2 或第 3 張/);
  const variantPublisher = functionBody(engine, 'confirmAndPublishProductVariantGroup');
  assert.match(variantPublisher, /callProductListingPublishWithTransientRetry\(draft\.id/);
  assert.doesNotMatch(variantPublisher, /for\s*\(const product of products\)/);
  assert.match(functionBody(engine, 'confirmAndPublishProductListingCase'), /callProductListingPublishWithTransientRetry/);
});

test('all six searches keep their input and replace only a stable results container', () => {
  const updater = functionBody(engine, 'renderLiveSearchResults');

  for (const [inputId, resultsId] of searchFields) {
    assert.match(engine, new RegExp(`id=["']${resultsId}["']`), `${inputId} needs a stable results container`);
    assert.match(updater, new RegExp(`inputId===['"]${inputId}['"]`), `${inputId} must use the shared partial updater`);
    assert.match(updater, new RegExp(`replaceLiveSearchHtml\\(['"]${resultsId}['"]`), `${inputId} must update only ${resultsId}`);
  }

  assert.doesNotMatch(updater, /rerenderKeepingFocus|opsContent|\.innerHTML\s*=/);
  assert.match(functionBody(engine, 'replaceLiveSearchHtml'), /replaceChildren/);
});

test('search paints the typed value before it starts replacing a large result list', () => {
  const scheduler = functionBody(engine, 'scheduleLiveSearchRender');

  assert.match(scheduler, /renderLiveSearchResults\(inputId\)/);
  assert.match(scheduler, /if\(!renderLiveSearchResults\(inputId\)\)rerenderKeepingFocus/);
  assert.match(scheduler, /setTimeout\(queueAfterInputPaint,LIVE_SEARCH_INPUT_IDLE_MS\)/);
  assert.match(scheduler, /requestAnimationFrame\(waitOnePaint\)/);
  assert.match(scheduler, /requestAnimationFrame\(run\)/);
  assert.match(scheduler, /liveSearchJobs\[inputId\]!==job/);
  assert.doesNotMatch(scheduler, /if\(immediate\)return run\(\)/);
  assert.doesNotMatch(engine, /SEARCH_IDLE_DELAY_MS|scheduleDeferredSearchRender|deferredSearchTimers|requestIdleCallback/);
});

test('rapid input is coalesced and the final value gets two paint frames before results render', () => {
  const jobs = Object.create(null);
  const timers = new Map();
  const frames = new Map();
  const delays = [];
  let nextId = 0;
  let renderCount = 0;
  const input = { value: '' };
  const fakeGlobal = {
    setTimeout(callback, delay) {
      const id = ++nextId;
      delays.push(delay);
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); }
  };
  const cancel = Function('liveSearchJobs', 'global', 'inputId', functionBody(engine, 'cancelLiveSearchRender'))
    .bind(null, jobs, fakeGlobal);
  const scheduleRaw = Function(
    'cancelLiveSearchRender', 'global', 'byId', 'renderLiveSearchResults', 'rerenderKeepingFocus',
    'liveSearchJobs', 'LIVE_SEARCH_INPUT_IDLE_MS', 'inputId', 'value', 'immediate',
    functionBody(engine, 'scheduleLiveSearchRender')
  );
  function schedule(value, immediate = false) {
    input.value = value;
    return scheduleRaw(cancel, fakeGlobal, () => input, () => { renderCount += 1; return true; },
      () => assert.fail('stable search container must avoid a full render'), jobs, 240, 'productSearch', value, immediate);
  }
  function runOnly(queue) {
    assert.equal(queue.size, 1);
    const [[id, callback]] = queue;
    queue.delete(id);
    callback();
  }

  schedule('1');
  const staleOneDigitJob = [...timers.values()][0];
  assert.equal(renderCount, 0);
  schedule('12');
  assert.equal(timers.size, 1, 'the stale one-digit search must be cancelled');
  assert.deepEqual(delays, [240, 240]);
  staleOneDigitJob();
  assert.equal(frames.size, 0, 'a cancelled callback must not revive the stale one-digit search');

  runOnly(timers);
  assert.equal(renderCount, 0);
  runOnly(frames);
  assert.equal(renderCount, 0, 'the first animation frame is reserved for painting 12 in the input');
  runOnly(frames);
  assert.equal(renderCount, 1);
  assert.equal(input.value, '12');
});

test('desktop and mobile keypads share the same caret-aware core action', () => {
  const action = functionBody(engine, 'applySearchKeyInput');
  const valueBuilder = functionBody(engine, 'nextSearchKeyValue');

  for (const [inputId] of searchFields) {
    assert.match(action, new RegExp(`${inputId}:['"]${inputId}['"]`));
  }
  assert.match(engine, /action==='mobile-key'\) return applySearchKeyInput\(el\.dataset\.target,el\.dataset\.key\)/);
  assert.match(engine, /action==='pos-key'\)return applySearchKeyInput\('posSearch',el\.dataset\.key\)/);
  assert.match(engine, /action==='pos-clear-search'\)return applySearchKeyInput\('posSearch','clear'\)/);
  assert.match(valueBuilder, /selection\.start/);
  assert.match(valueBuilder, /selection\.end/);
  assert.match(valueBuilder, /key==='clear'/);
  assert.match(valueBuilder, /key==='back'/);
  assert.match(action, /scheduleLiveSearchRender\(targetId,next\.value,false\)/);
});

test('manual average cost correction becomes the new inventory cost baseline after one confirmation', () => {
  const productForm = functionBody(engine, 'productFormHtml');
  const saveProduct = functionBody(engine, 'saveProduct');
  const rebaseBody = functionBody(engine, 'rebaseCostLayersToAverage');

  assert.match(productForm, /name="averageCost"/);
  assert.doesNotMatch(productForm, /name="averageCost"[^>]*readonly/);
  assert.match(productForm, /後續進貨會從這個數字繼續計算平均值/);
  assert.equal((saveProduct.match(/global\.confirm\(/g) || []).length, 1);
  assert.match(saveProduct, /確定變動/);
  assert.match(saveProduct, /averageChangeApplied/);
  assert.match(saveProduct, /rebaseCostLayersToAverage/);
  assert.match(saveProduct, /type:finalStock!==oldStock\?\(p\?'adjustment':'opening'\):'costAdjustment'/);
  assert.match(saveProduct, /beforeAverageCost:oldAverage/);
  assert.match(saveProduct, /afterAverageCost:layerResult\.averageCost/);

  const rebase = Function('numberOrNull', 'uid', 'statsFromLayers', 'newStock', 'averageCost', 'meta', rebaseBody);
  const statsFromLayers = (layers) => ({
    layers,
    averageCost: layers[0].unitCost,
    nextFifoCost: layers[0].unitCost,
    inventoryValue: layers[0].qtyRemaining * layers[0].unitCost,
    costIncomplete: false
  });
  const result = rebase((value) => value == null || value === '' ? null : Number(value), () => 'AVG-1', statsFromLayers, 5, 120, { referenceId: 'P-1' });
  assert.equal(result.layers.length, 1);
  assert.equal(result.layers[0].qtyRemaining, 5);
  assert.equal(result.layers[0].unitCost, 120);
  assert.equal(result.layers[0].referenceType, 'manualAverageAdjustment');
  assert.equal(result.averageCost, 120);
  assert.equal(result.inventoryValue, 600);
});

test('mobile physical-photo entry opens the rear camera and stores photos separately from platform images', () => {
  const page = functionBody(engine, 'renderPhysicalPhotos');
  const capture = functionBody(engine, 'startPhysicalPhotoCapture');
  const upload = functionBody(engine, 'uploadPhysicalProductPhoto');
  const labeler = functionBody(engine, 'physicalPhotoLabeledBlob');
  const tray = functionBody(engine, 'physicalProductImageTrayHtml');
  const listingForm = functionBody(engine, 'productListingCaseFormHtml');

  assert.match(portal, /href="#physical-photos" data-view="physical-photos"/);
  assert.match(hub, /href="#physical-photos" data-view="physical-photos"/);
  assert.match(page, /id=\\?"physicalPhotoCameraInput\\?"/);
  assert.match(page, /capture=\\?"environment\\?"/);
  assert.match(page, /最近上架商品/);
  assert.match(capture, /input\.click\(\)/);
  assert.match(upload, /\/physical\//);
  assert.match(upload, /physicalImageUrls/);
  assert.match(upload, /physicalOriginalImageUrls/);
  assert.match(upload, /physicalImages/);
  assert.match(upload, /-original\./);
  assert.match(upload, /-labeled\.jpg/);
  assert.doesNotMatch(upload, /listingImageUrls|imageUrls:fv\.arrayUnion/);
  assert.match(labeler, /fillText\('實體圖'/);
  assert.match(tray, /productPhysicalImageUpload/);
  assert.match(tray, /＋ 實體圖/);
  assert.match(tray, /<strong>實體圖<\/strong>/);
  assert.doesNotMatch(tray, /ops-listing-physical-copy/);
  assert.match(listingForm, /physicalProductImageTrayHtml\(row\.physicalImageUrls,p\.docId\)/);
  assert.doesNotMatch(listingForm, /productListingSection\('實體圖片'/);
  assert.match(storageRules, /match \/ops-product-listing-cases\/\{productId\}\/physical\/\{fileName\}/);
});

test('listing form freezes one of four explicit product intents and never infers a different action inside a platform', () => {
  const intent = functionBody(engine, 'normalizeProductListingIntent');
  const policy = functionBody(engine, 'productListingIntentPolicy');
  const mode = functionBody(engine, 'productListingModeSectionHtml');
  const saver = functionBody(engine, 'saveProductListingCase');
  const prompt = functionBody(engine, 'productListingCodexHandoffPrompt');

  for (const value of ['create-single', 'create-group', 'add-variant', 'update-existing']) {
    assert.match(mode, new RegExp("choice\\('" + value + "'"));
  }
  assert.match(intent, /PRODUCT_LISTING_INTENTS\.includes\(explicit\)/);
  assert.match(policy, /preserveUnmentionedContent/);
  assert.match(saver, /listingIntent:listingIntent/);
  assert.match(saver, /listingIntentPolicy:listingIntentPolicy/);
  assert.match(saver, /listingChangeInstructions:listingChangeInstructions/);
  assert.match(saver, /listingIntent==='update-existing'&&!listingChangeInstructions/);
  assert.match(prompt, /必須只依這個 intent 執行/);
  assert.match(prompt, /不得根據平台目前是否有編號自行改成另一種處理方式/);
});

test('switching product searches skips the old editor prompt and POS clears the previous product text', () => {
  const keypad = functionBody(engine, 'applySearchKeyInput');
  const openProduct = functionBody(engine, 'openProductEdit');
  const bind = functionBody(engine, 'bindEvents');
  const cart = functionBody(engine, 'addCartProduct');

  assert.match(keypad, /targetId==='productSearch'&&!closeProductEditorForListChange\(true\)/);
  assert.match(openProduct, /closeProductEditorForListChange\(true\)/);
  assert.match(bind, /input\.id==='productSearch'[\s\S]*closeProductEditorForListChange\(true\)/);
  assert.match(cart, /state\.posSearch=''/);
  assert.match(cart, /byId\('posSearch'\)/);
  assert.match(cart, /input\.focus\(\)/);
});

test('keypad value logic handles 1, 12, backspace, clear and a middle caret', () => {
  const fakeDocument = { activeElement: null };
  const selection = Function('document', 'input', functionBody(engine, 'searchInputSelection')).bind(null, fakeDocument);
  const nextValue = Function('searchInputSelection', 'input', 'key', functionBody(engine, 'nextSearchKeyValue')).bind(null, selection);
  const input = { value: '', selectionStart: 0, selectionEnd: 0 };
  fakeDocument.activeElement = input;

  function apply(key) {
    const next = nextValue(input, key);
    input.value = next.value;
    input.selectionStart = next.caret;
    input.selectionEnd = next.caret;
    return next;
  }

  assert.deepEqual(apply('1'), { value: '1', caret: 1 });
  assert.deepEqual(apply('2'), { value: '12', caret: 2 });
  assert.deepEqual(apply('back'), { value: '1', caret: 1 });
  assert.deepEqual(apply('clear'), { value: '', caret: 0 });

  input.value = '12';
  input.selectionStart = 1;