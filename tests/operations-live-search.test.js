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
    assert.match(html, /operations-phase1\.css\?v=20260825-rich-content-v1/);
    assert.match(html, /operations-phase1\.js\?v=20260825-rich-content-v1/);
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
  assert.match(handoffPrompt, /目標 10 點不重複、具體且可驗證特色/);
  assert.match(handoffPrompt, /目標 8 點有來源的使用方式／使用心得/);
  assert.match(handoffPrompt, /保固只填平台保固欄/);
  assert.doesNotMatch(functionBody(engine, 'productListingAutomaticDescription'), /• 保固：/);
  assert.match(handoffPrompt, /標題、內文、圖卡都不得加入「柚子樂器」/);
  assert.match(handoffPrompt, /實際內容以收到的實體商品為準/);
  assert.match(handoffPrompt, /同一案件、同一 SKU、同一平台草稿與目前階段/);
  assert.match(handoffPrompt, /本次根節點為/);
  assert.match(handoffPrompt, /未選通路不得建立、修改、排隊或送出/);
  assert.match(handoffPrompt, /單一操作鎖/);
  assert.match(handoffPrompt, /蝦皮.*只依賴 EasyStore/);
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

test('standalone physical-photo entry is removed while inline listing photos stay separate from platform images', () => {
  const upload = functionBody(engine, 'uploadPhysicalProductPhoto');
  const labeler = functionBody(engine, 'physicalPhotoLabeledBlob');
  const tray = functionBody(engine, 'physicalProductImageTrayHtml');
  const listingForm = functionBody(engine, 'productListingCaseFormHtml');

  assert.doesNotMatch(portal, /href="#physical-photos"|拍實體圖/);
  assert.doesNotMatch(hub, /href="#physical-photos"|拍實體圖/);
  assert.doesNotMatch(engine, /function renderPhysicalPhotos|function startPhysicalPhotoCapture|physicalPhotoCameraInput/);
  assert.match(upload, /\/physical\//);
  assert.match(upload, /physicalImageUrls/);
  assert.match(upload, /physicalOriginalImageUrls/);
  assert.match(upload, /physicalImages/);
  assert.match(upload, /-original\./);
  assert.match(upload, /-labeled\.jpg/);
  assert.doesNotMatch(upload, /listingImageUrls|imageUrls:fv\.arrayUnion/);
  assert.match(labeler, /fillText\('實體圖'/);
  assert.match(tray, /<strong>實體圖<\/strong>/);
  assert.doesNotMatch(tray, /＋ 實體圖|ops-listing-physical-add/);
  assert.doesNotMatch(tray, /ops-listing-physical-copy/);
  assert.match(listingForm, /productPhysicalImageUpload/);
  assert.match(listingForm, /physicalProductImageTrayHtml\(row\.physicalImageUrls,p\.docId\)/);
  assert.doesNotMatch(listingForm, /productListingSection\('實體圖片'/);
  assert.match(storageRules, /match \/ops-product-listing-cases\/\{productId\}\/physical\/\{fileName\}/);
});

test('product header owns the saved listing queue and starts it sequentially in Codex', () => {
  const products = functionBody(engine, 'renderProducts');
  const queue = functionBody(engine, 'productListingQueueDrawerHtml');
  const start = functionBody(engine, 'startProductListingQueue');
  const prompt = functionBody(engine, 'productListingBatchActivationPrompt');
  const listingForm = functionBody(engine, 'productListingCaseFormHtml');
  const actionGrid = functionBody(engine, 'productListingActionGridHtml');

  assert.match(products, /product-new[\s\S]*product-listing-queue-open[\s\S]*product-recent/);
  assert.match(products, /待網路上架商品/);
  assert.match(products, /新增未上架/);
  assert.match(queue, /開始處理全部/);
  assert.match(listingForm, /productListingActionGridHtml\(row\)/);
  assert.match(actionGrid, /data-action="product-listing-queue-add"/);
  assert.match(start, /batchQueueStatus:'processing'/);
  assert.match(start, /batchPosition:index\+1/);
  assert.match(start, /productListingCodexThreadUrl/);
  assert.match(prompt, /一件完成後才處理下一件/);
  assert.match(prompt, /batchQueueStatus 設為 completed/);
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
  assert.doesNotMatch(mode, /<small>|一個 SKU 建立一個全新商品|只修改同一件商品|listingChangeInstructions/);
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
  input.selectionEnd = 1;
  assert.deepEqual(apply('3'), { value: '132', caret: 2 });
  input.selectionStart = 0;
  input.selectionEnd = 2;
  assert.deepEqual(apply('back'), { value: '2', caret: 0 });
});

test('mobile enhancement has no second POS search implementation', () => {
  assert.doesNotMatch(mobileHistory, /posSearch|updateSearchResults|stopImmediatePropagation/);
  assert.match(mobileHistory, /buildHistoryCards/);
});

test('IME Enter cannot start a search while iPhone composition is still active', () => {
  assert.match(engine, /event\.isComposing\|\|event\.keyCode===229\|\|event\.target\.dataset\.opsImeComposing==='1'/);
});

test('catalog search text and SKU order are prepared once and reused', () => {
  assert.match(engine, /prepareCatalogSearchIndex\(\)/);
  assert.match(engine, /function catalogRowsInSkuOrder\(/);
  assert.match(engine, /function catalogMatchesSearch\(/);
  assert.match(functionBody(engine, 'productFiltered'), /catalogRowsInSkuOrder\(\)/);
  assert.match(functionBody(engine, 'purchaseEntryFilteredProducts'), /catalogRowsInSkuOrder\(\)/);
  assert.match(functionBody(engine, 'stocktakeFilteredProducts'), /catalogRowsInSkuOrder\(\)/);
});

test('product search renders 24 at a time while the other working searches retain their existing bounds', () => {
  const product = functionBody(engine, 'productSearchResultsHtml');
  const pos = functionBody(engine, 'posSearchResultsHtml');
  const purchaseEntry = functionBody(engine, 'purchaseEntrySearchResult');
  const stocktake = functionBody(engine, 'stocktakeSearchResult');
  const purchaseLow = functionBody(engine, 'purchaseLowSearchResult');
  const inventory = functionBody(engine, 'inventorySearchResult');

  assert.match(product, /visible=rows\.slice\(0,state\.productVisible\)/);
  assert.doesNotMatch(product, /hasSearch\?rows/);
  assert.match(pos, /catalogRowsInSkuOrder\(\)\.filter/);
  assert.match(purchaseEntry, /clean\(state\.purchaseEntrySearch\)\?all:all\.slice\(0,240\)/);
  assert.match(stocktake, /clean\(state\.stocktakeSearch\)\?all:all\.slice\(0,240\)/);
  assert.match(purchaseLow, /term\?filtered:filtered\.slice\(0,80\)/);
  assert.match(inventory, /term\?filtered:filtered\.slice\(0,300\)/);

  for (const body of [product, pos, purchaseEntry, stocktake, purchaseLow, inventory]) {
    assert.doesNotMatch(body, /slice\(0,\s*30\)|length\s*>=\s*30|\?30:/);
  }
  for (const name of ['renderSales', 'renderSalesV4', 'renderSalesV5']) {
    assert.doesNotMatch(functionBody(engine, name), /slice\(0,\s*30\)|length\s*>=\s*30/);
  }
});

test('listing preparation is a simple per-product workspace and no longer part of the product editor', () => {
  const productForm = functionBody(engine, 'productFormHtml');
  const saveProduct = functionBody(engine, 'saveProduct');
  const openCase = functionBody(engine, 'openProductListingCase');
  const caseForm = functionBody(engine, 'productListingCaseFormHtml');
  const saveCase = functionBody(engine, 'saveProductListingCase');

  for (const field of ['productResearchStatus', 'shopeeCategoryPath', 'shippingDecision', 'packageLengthCm']) {
    assert.doesNotMatch(productForm, new RegExp(field), `${field} must stay out of the main product form`);
    assert.doesNotMatch(saveProduct, new RegExp(field), `${field} must not be written by saveProduct`);
    assert.match(saveCase, new RegExp(field), `${field} must be written by saveProductListingCase`);
  }
  assert.match(caseForm, /productResearchStatus/);
  assert.match(caseForm, /shopeeCategoryPath/);
  assert.match(caseForm, /productShippingChoiceHtml\(shipping\.decision\)/);
  assert.match(caseForm, /name="shopeeAttributeValues"/);
  assert.match(saveCase, /shopeeAttributeValues:productShopeeAttributesFromForm/);
  assert.match(caseForm, /productShopeeAttributeEditorHtml\(p,row\)/);
  assert.match(engine, /愛好與收藏品 > 樂器與樂器配件 > 弦樂器 > 吉他、貝斯/);
  assert.match(engine, /Warranty Duration/);
  assert.match(engine, /Warranty Type/);
  assert.match(engine, /管理者於上架前確認/);
  assert.match(engine, /function productMusicFamily\(p,row,path\)/);
  assert.match(engine, /shopeeMusicFamilyFromText\(productText\)\|\|shopeeMusicFamilyFromText\(path\)/);
  assert.match(engine, /const descendants=family===existingFamily/);
  assert.match(engine, /data-shopee-attribute-original/);
  assert.match(caseForm, /packageLengthCm/);

  assert.match(engine, /listingCases:'opsProductListingCases'/);
  assert.match(firestoreRules, /'opsProductListingCases'/);
  assert.match(openCase, /COLLECTIONS\.listingCases\)\.doc\(id\)\.get\(\)/);
  assert.doesNotMatch(engine, /getCollection\(COLLECTIONS\.listingCases/);
  assert.match(engine, /data-action="product-listing-case-open"/);
  assert.match(saveCase, /COLLECTIONS\.listingCases\)\.doc\(id\)/);
  assert.match(saveCase, /priceSnapshot/);
  assert.match(saveCase, /easyStore:productListingAutomaticPrice\(p,'easyStorePrice'\)/);
  assert.match(saveCase, /enabledPlatforms:\{easyStoreShopee:true,momo:true,coupang:true\}/);
  assert.match(caseForm, /name="enabledEasyStoreShopee" value="1"/);
  assert.match(caseForm, /name="enabledMomo" value="1"/);
  assert.match(caseForm, /name="enabledCoupang" value="1"/);
  assert.doesNotMatch(caseForm, /type="checkbox" name="enabled(?:EasyStoreShopee|Momo|Coupang)"/);
  assert.match(caseForm, /不需勾選/);
  assert.match(functionBody(engine, 'productListingAutomaticPrice'), /p&&p\.storePrice/);
  assert.match(caseForm, /不先搜尋平台目錄/);
  assert.match(caseForm, /新增商品遇到既有平台編號會停止/);
  assert.match(caseForm, /修改商品缺少既有編號也會停止/);
  assert.doesNotMatch(caseForm, /shopeeListingDecision/);
  assert.doesNotMatch(caseForm, /蝦皮防重複檢查|Match product|系統先檢查/);
  assert.doesNotMatch(caseForm, /<label>商品網址<\/label>/);
  assert.doesNotMatch(caseForm, /<label>注意事項<\/label>|商品資料、抓圖範圍或不能出現的內容/);
  assert.match(caseForm, /ops-listing-media-actions/);
  assert.match(caseForm, /開始搜圖/);
  assert.match(caseForm, /href="https:\/\/www\.taobao\.com\/"/);
  assert.match(caseForm, /href="https:\/\/www\.1688\.com\/"/);
  assert.match(caseForm, /ops-listing-supplier-shortcuts/);
  assert.match(caseForm, /productReferenceImageUpload/);
  assert.match(caseForm, /選擇圖片上傳/);
  assert.match(caseForm, /productPhysicalImageUpload/);
  assert.doesNotMatch(caseForm, /從淘寶／1688 框選截圖/);
  assert.match(caseForm, /product-image-collection-toggle/);
  assert.doesNotMatch(caseForm, /這一步只收圖，不做簡繁轉換|截錯可在下方直接刪除|Ctrl＋Shift＋Y/);
  assert.match(caseForm, /productReferenceImageSelectorHtml/);
  assert.doesNotMatch(caseForm, /重新製作勾選圖片/);
  assert.match(caseForm, /imageGenerationInstructions/);
  assert.match(caseForm, /name="listingChangeInstructions"/);
  assert.match(caseForm, /ops-listing-instruction-grid/);
  assert.ok(caseForm.indexOf('productReferenceImagePreview') < caseForm.indexOf('name="listingChangeInstructions"'));
  assert.equal((caseForm.match(/data-action="product-listing-speech"/g) || []).length, 2);
  assert.doesNotMatch(caseForm, /product-ai-image-generate/);
  assert.doesNotMatch(caseForm, /整理文案與圖片/);
  assert.match(caseForm, /id="productCompletedImageUpload"/);
  assert.match(caseForm, /進階回填角色完成圖/);
  assert.doesNotMatch(caseForm, />上傳 Codex 已完成圖片</);
  assert.match(caseForm, /product-listing-speech/);
  assert.doesNotMatch(caseForm, /圖片來源可選一種|固定圖片格式已套用|商品與抓圖注意事項|進階：直接貼圖片網址/);
  assert.match(engine, /const warrantyInfo=[^\n]+\|\|'保固半年'/);
  assert.match(engine, /warrantyInfo:warrantyInfo/);
  assert.match(caseForm, /完整商品介紹/);
  assert.match(caseForm, /固定目標為 10 個可驗證特色、8 個使用重點/);
  assert.match(caseForm, /實體商品免責句固定放在最後/);
  assert.match(caseForm, /商品規格/);
  assert.match(caseForm, /name="productDescription"/);
  assert.match(caseForm, /<textarea name="sellingPoints" hidden>/);
  assert.match(caseForm, /<textarea name="commonProductDescription" hidden>/);
  assert.doesNotMatch(caseForm, /一句商品賣點|活潑商品介紹|勾選的原圖直接上架|先把你有的資料放進來|有網址或照片就放進來|ops-detail-no-image/);
  assert.doesNotMatch(caseForm, /完整研究|身分確認依據|版本／來源衝突|實際採用的研究來源/);
  assert.match(caseForm, /commonContentDecision/);
  assert.match(caseForm, /momoHtml/);
  assert.match(caseForm, /coupangDescriptionHtml/);
  assert.match(functionBody(engine, 'productResearchReady'), /draft\.productDescription/);
});

test('listing page does not expose its legacy OpenAI runner and never starts it on open', () => {
  const runner = functionBody(engine, 'runProductAiResearch');
  const saveProduct = functionBody(engine, 'saveProduct');
  const openCase = functionBody(engine, 'openProductListingCase');
  const caseForm = functionBody(engine, 'productListingCaseFormHtml');

  assert.doesNotMatch(caseForm, /data-action="product-ai-research-run"/);
  assert.doesNotMatch(caseForm, /data-action="product-ai-image-generate"/);
  assert.match(engine, /researchProductListingCase/);
  assert.match(runner, /productId:id/);
  assert.match(runner, /requestProductListingImageGeneration/);
  assert.match(runner, /selectedReferenceImageUrls/);
  assert.match(runner, /COLLECTIONS\.listingCases|openProductListingCase/);
  assert.doesNotMatch(runner, /COLLECTIONS\.products|opsInternalProducts/);
  assert.doesNotMatch(saveProduct, /aiResearch|researchProductListingCase/);
  assert.doesNotMatch(engine, /function shouldAutoResearchProductListingCase/);
  assert.doesNotMatch(openCase, /runProductAiResearch/);
  assert.doesNotMatch(caseForm, /整理文案與圖片/);
  assert.match(engine, /已停用網頁 OpenAI/);
  assert.doesNotMatch(engine, /OPENAI_API_KEY|api\.openai\.com/);
});

test('Codex handoff repairs legacy decision states instead of blocking the task', () => {
  const normalizer = functionBody(engine, 'normalizeProductListingDecision');
  const caseNormalizer = functionBody(engine, 'normalizeProductListingCase');
  const saver = functionBody(engine, 'saveProductListingCase');
  const draft = functionBody(engine, 'productListingDraftFromForm');

  assert.match(normalizer, /pending.*accepted.*rejected/);
  assert.match(normalizer, /:['"]pending['"]/);
  assert.match(caseNormalizer, /normalizeProductListingDecision\(source\.identityDecision\)/);
  assert.match(saver, /decisionValues\[name\]=normalizeProductListingDecision/);
  assert.doesNotMatch(saver, /採用狀態格式不正確/);
  assert.match(draft, /normalizeProductListingDecision\(data\.get\('identityDecision'\)\)/);
});

test('listing case supports manager-only image processing and a truthful actual publish call', () => {
  const uploader = functionBody(engine, 'uploadProductReferenceImages');
  const completedUploader = functionBody(engine, 'uploadProductCompletedListingImages');
  const completedImageSync = functionBody(engine, 'syncCompletedListingImagesToProduct');
  const urlImporter = functionBody(engine, 'importProductListingImagesFromUrls');
  const generator = functionBody(engine, 'generateProductListingImage');
  const generationRequester = functionBody(engine, 'requestProductListingImageGeneration');
  const publisher = functionBody(engine, 'prepareProductListingPublish');
  const formRenderer = functionBody(engine, 'productListingCaseFormHtml');
  const storageRules = fs.readFileSync('storage.rules', 'utf8');

  assert.match(hub, /firebase-storage-compat\.js/);
  assert.match(uploader, /requireEasyStoreManagerAuth/);
  assert.match(urlImporter, /importProductListingImages/);
  assert.match(urlImporter, /requireEasyStoreManagerAuth/);
  assert.match(uploader, /ops-product-listing-cases/);
  assert.match(uploader, /image\/jpeg/);
  assert.match(storageRules, /ops-product-listing-cases/);
  assert.match(storageRules, /isManagerAuth/);
  assert.match(storageRules, /generated/);
  assert.match(storageRules, /completed/);
  assert.match(generator, /requireEasyStoreManagerAuth/);
  assert.match(generator, /requestProductListingImageGeneration/);
  assert.match(generationRequester, /generateProductListingImage/);
  assert.match(generator, /selectedReferenceImageUrls/);
  assert.match(generationRequester, /imageUrls:reference/);
  assert.match(productAiResearchSource, /listingImageUrls: listingImageUrls\.slice\(0, 12\)/);
  assert.doesNotMatch(productAiResearchSource, /STORE_PROMO_IMAGE_URL/);
  assert.match(productAiResearchSource, /status: 'ready'/);
  assert.match(productAiResearchSource, /已加入準備上架/);
  assert.match(uploader, /slice\(0,PRODUCT_REFERENCE_IMAGE_MAX\)/);
  assert.match(completedUploader, /slice\(0,PRODUCT_SELECTED_IMAGE_MAX\)/);
  assert.match(formRenderer, /id="productCompletedImageUpload"/);
  assert.match(formRenderer, /進階回填角色完成圖/);
  assert.doesNotMatch(formRenderer, /上傳 Codex 已完成圖片/);
  assert.match(completedUploader, /requireEasyStoreManagerAuth/);
  assert.match(completedUploader, /codex-chat-single-pass/);
  assert.match(completedUploader, /localizationStatus:'completed'/);
  assert.match(completedUploader, /qaStatus:'approved'/);
  assert.match(completedUploader, /listingImageUrls:sharedListingUrls/);
  assert.match(completedUploader, /syncCompletedListingImagesToProduct\(id,completedCase\)/);
  assert.match(completedImageSync, /COLLECTIONS\.products/);
  assert.match(completedImageSync, /imageUrl:images\[0\]/);
  assert.match(completedImageSync, /imageUrls:images/);
  assert.match(completedImageSync, /parentImageUrls:\[\]/);
  assert.match(completedImageSync, /variantImageUrls:\[\]/);
  assert.doesNotMatch(completedImageSync, /referenceImageUrls:\[\]/);
  assert.doesNotMatch(completedImageSync, /selectedReferenceImageUrls:\[\]/);
  assert.doesNotMatch(completedImageSync, /referenceImagesCleared:true/);
  assert.doesNotMatch(functionBody(engine, 'openProductListingCase'), /syncCompletedListingImagesToProduct\(id,row,true\)/);
  assert.doesNotMatch(completedUploader, /requestProductListingImageGeneration/);
  assert.doesNotMatch(generator, /identityDecision|identityStatus/);
  assert.match(publisher, /confirmAndPublishProductVariantGroup|confirmAndPublishProductListingCase/);
  assert.doesNotMatch(publisher, /dryRun:true|status:'prepared'/);
  assert.match(functionBody(engine, 'confirmAndPublishProductListingCase'), /callProductListingPublish/);
  assert.match(functionBody(engine, 'callProductListingPublish'), /publishProductListingCase/);
  assert.match(productListingPublishSource, /dryRun: false/);
  assert.match(productListingPublishSource, /upsertEasyStoreProduct/);
  assert.match(productListingPublishSource, /findEasyStoreMappingInProduct/);
  assert.match(productListingPublishSource, /acquirePublishLock/);
  assert.match(productListingPublishSource, /正在上架，請等待目前工作完成/);
  assert.match(productListingPublishSource, /platformQueueFingerprint/);
  assert.match(productListingPublishSource, /already-queued/);
  assert.match(productListingPublishSource, /mode === 'block-duplicate'/);
  assert.match(productListingPublishSource, /onMultiple: 'block'/);
  assert.match(productListingPublishSource, /awaiting-store-agent/);
  assert.match(productListingPublishSource, /waiting-easystore-sync/);
  assert.match(firestoreRules, /'opsProductListingQueue'/);
});

test('listing case offers eight direct platform actions and keeps detailed fields collapsed', () => {
  const renderer = functionBody(engine, 'productListingCaseFormHtml');
  const actionGrid = functionBody(engine, 'productListingActionGridHtml');
  const oneClick = functionBody(engine, 'handoffProductListingToCodex');

  assert.match(renderer, /網路上架處理/);
  assert.match(renderer, /直接點一個方塊/);
  assert.match(renderer, /productListingActionGridHtml\(row\)/);
  assert.match(actionGrid, /\['all','momo','coupang','website'\]/);
  assert.match(actionGrid, /data-action="product-listing-queue-add"/);
  assert.match(actionGrid, /data-action="product-listing-codex-complete"/);
  assert.match(actionGrid, /加入待處理/);
  assert.match(actionGrid, /立即處理/);
  assert.match(renderer, /需要時才修改/);
  assert.doesNotMatch(renderer, /儲存並檢查/);
  assert.match(oneClick, /saveProductListingCase/);
  assert.match(oneClick, /caseStatus:'waiting-codex'/);
  assert.match(oneClick, /codexHandoff:\{status:'pending'/);
  assert.match(oneClick, /productListingCodexThreadUrl/);
  assert.doesNotMatch(oneClick, /researchProductListingCase/);
  assert.doesNotMatch(oneClick, /requestProductListingImageGeneration/);
  assert.match(oneClick, /completedMediaReady/);
  assert.match(oneClick, /listingTargetScope:listingTargetScope/);
  assert.match(oneClick, /listingTargetPlatforms:listingTargetPlatforms/);
  assert.match(oneClick, /callProductListingPublishWithTransientRetry/);
  assert.match(functionBody(engine, 'productListingImageGenerationReady'), /status\)\.toLowerCase\(\)!=='completed'/);
  assert.match(functionBody(engine, 'productListingImageGenerationReady'), /sourceImageUrls/);
  assert.match(functionBody(engine, 'productListingImageGenerationReady'), /failedCount/);
  assert.match(functionBody(engine, 'productListingImageGenerationReady'), /processedCount/);
  assert.match(functionBody(engine, 'productListingImageGenerationReady'), /localizationStatus==='completed'/);
  assert.doesNotMatch(oneClick, /dryRun/);
  assert.match(productAiResearchSource, /分類必須限定在「樂器／樂器配件」分類樹內/);
  assert.match(productAiResearchSource, /Only outputs created by this localization run may enter the publish list/);
  assert.doesNotMatch(productAiResearchSource, /existingListingImageUrls\.filter/);
  const generatorStart = productAiResearchSource.indexOf('target.generateProductListingImage = onCall');
  assert.notEqual(generatorStart, -1);
  const generator = productAiResearchSource.slice(generatorStart);
  assert.match(generator, /processingMode: 'single-pass'/);
  assert.match(generator, /localizationStatus: 'completed'/);
  assert.doesNotMatch(generator, /callOpenAIImageQa\(/);
  assert.doesNotMatch(generator, /buildProductImageCorrectionPrompt\(/);
});

test('listing review honors manager identity and brand decisions and gates logistics truthfully', () => {
  const normalizer = functionBody(engine, 'normalizeProductListingCase');
  const formRenderer = functionBody(engine, 'productListingCaseFormHtml');
  const identityRenderer = functionBody(engine, 'productIdentityReviewHtml');
  const saver = functionBody(engine, 'saveProductListingCase');
  const drafter = functionBody(engine, 'productListingDraftFromForm');
  const logistics = functionBody(engine, 'productListingShopeeLogisticsReady');
  const readiness = functionBody(engine, 'productListingReadiness');
  const preview = functionBody(engine, 'openProductListingPreview');
  const resultRenderer = functionBody(engine, 'openProductListingPublishResult');
  const savedPublisher = functionBody(engine, 'publishSavedProductListingCase');
  const publisher = functionBody(engine, 'prepareProductListingPublish');

  assert.match(normalizer, /identityManualConfirmed/);
  assert.match(normalizer, /identityManualConfirmedAt/);
  assert.match(normalizer, /identityManualConfirmedBy/);
  assert.match(normalizer, /identityManualConfirmationNote/);
  assert.match(formRenderer, /productIdentityReviewHtml/);
  assert.match(identityRenderer, /我已人工核對，確認是同一件商品/);
  assert.match(saver, /shopeeBrand:clean\(data\.get\('shopeeBrand'\)\)\|\|clean\(data\.get\('brand'\)\)/);
  assert.match(saver, /identityManualConfirmedAt=serverTimestamp\(\)/);
  assert.match(saver, /writeAudit\('人工確認同一商品'/);
  assert.match(saver, /productPackageFromFormData\(data,false\)/);
  assert.doesNotMatch(saver, /shopeeListingDecision/);
  assert.match(drafter, /productPackageFromFormData\(data,false\)/);
  assert.doesNotMatch(drafter, /shopeeListingDecision/);
  assert.match(logistics, /longest<=45&&total<=105&&weight<=5/);
  assert.match(logistics, /shippingDecision==='home'\)return true/);
  assert.match(logistics, /longest<=150&&total<=210&&weight<=20/);
  assert.match(readiness, /shopeeLogisticsReady/);
  assert.match(readiness, /shopeeLogisticsManualConfirmationRequired/);
  assert.match(preview, /一般宅配可以先送出/);
  assert.match(preview, /蝦皮實際物流尚未自動選好/);
  assert.match(preview, /可送出・待選物流/);
  assert.match(preview, /listingIntentPolicy\.identityAction/);
  assert.match(preview, /禁止建立重複商品/);
  assert.match(preview, /不預先搜尋平台目錄/);
  assert.match(preview, /還有幾個上架欄位需要補/);
  assert.doesNotMatch(preview, /Match product|防重複方式/);
  assert.match(resultRenderer, /一般宅配的實際物流仍須確認/);
  assert.match(resultRenderer, /已凍結的處理方式與中央平台 ID/);
  assert.match(resultRenderer, /不會自行改成新增或修改/);
  assert.match(resultRenderer, /不先搜尋平台目錄/);
  assert.doesNotMatch(resultRenderer, /新增／更新狀態仍須確認|多筆或不確定就停止/);
  assert.match(savedPublisher, /shippingDecision:clean\(raw\.shippingDecision\)/);
  assert.doesNotMatch(savedPublisher, /shopeeListingDecision/);
  assert.match(publisher, /if\(!readiness\.all\)/);
  assert.match(publisher, /尚未送出上架/);
});

test('variant-first product images are retained in the core renderer', () => {
  assert.match(engine, /const mainImage=variantImages\[0\]\|\|parentImages\[0\]/);
  assert.match(engine, /const systemName=clean\(p\.originalName\|\|p\.name\|\|p\.onlineName\)/);
});
