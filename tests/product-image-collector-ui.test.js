"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const operationsSource = fs.readFileSync("operations-phase1.js", "utf8");
const manifest = JSON.parse(fs.readFileSync("easystore-shopee-autofill/manifest.json", "utf8"));
const supplierCollector = fs.readFileSync("easystore-shopee-autofill/supplier-collector.js", "utf8");
const background = fs.readFileSync("easystore-shopee-autofill/background.js", "utf8");
const bridge = fs.readFileSync("easystore-shopee-autofill/bridge.js", "utf8");

test("準備上架提供指定商品的開始收圖入口", () => {
  assert.match(operationsSource, /data-action="product-image-collection-toggle"/);
  assert.match(operationsSource, /從淘寶／1688 框選截圖/);
  assert.match(operationsSource, /PRODUCT_IMAGE_COLLECTION\.maxImages/);
  assert.doesNotMatch(operationsSource, /<label>商品網址<\/label>/);
});

test("供應商頁以框選截圖為主且不會預設攔截商品頁點擊", () => {
  assert.match(supplierCollector, /directPickEnabled = false/);
  assert.match(supplierCollector, /＋ 快速點圖/);
  assert.match(supplierCollector, /頁面右鍵 → 柚子掌櫃；也可按 Ctrl＋Shift＋Y/);
  assert.doesNotMatch(supplierCollector, /youzi-help|原圖點選：(?:開啟|關閉)/);
  assert.match(supplierCollector, /helpers\.CAPTURE_MESSAGE/);
  assert.match(supplierCollector, /document\.addEventListener\("paste"/);
  assert.match(background, /chrome\.tabs\.captureVisibleTab/);
  assert.match(background, /imageCollector\.CAPTURE_DATA_MESSAGE/);
  assert.match(background, /chrome\.contextMenus\.onClicked/);
  assert.match(background, /contexts: \["page", "image"\]/);
  assert.match(background, /chrome\.runtime\.onStartup\.addListener\(ensureContextMenu\)/);
});

test("截錯的來源圖片可從目前商品直接刪除", () => {
  assert.match(operationsSource, /data-action="product-source-image-remove"/);
  assert.match(operationsSource, /data-action="product-variant-source-image-remove"/);
  assert.match(operationsSource, /async function removeProductReferenceImage/);
  assert.match(operationsSource, /async function removeProductVariantReferenceImage/);
  assert.match(operationsSource, /已從這件準備上架商品移除/);
});

test("上架圖片預覽可排除圖片且排除後不會進入平台共用圖池", () => {
  assert.match(operationsSource, /data-action="product-variant-gallery-toggle"/);
  assert.match(operationsSource, /不會上架|不上架/);
  assert.match(operationsSource, /allowed\.has\(row\.sourceImageUrl\)\|\|allowed\.has\(row\.url\)/);
  assert.match(operationsSource, /至少保留一張上架圖/);
});

test("收圖檔案沿用既有 Firebase 圖片上傳並綁定目前商品", () => {
  assert.match(operationsSource, /productId!==productImageCollectionSession\.productId/);
  assert.match(operationsSource, /uploadProductVariantReferenceImages\(form,productId,\[collectedImageFile\(payload\)\]\)/);
  assert.match(operationsSource, /每個商品最多保留 20 張來源圖片/);
  assert.match(operationsSource, /PRODUCT_REFERENCE_IMAGE_MAX = 20/);
  assert.match(operationsSource, /PRODUCT_SELECTED_IMAGE_MAX = 20/);
});

test("營運中心重新整理後會主動恢復既有收圖工作", () => {
  assert.match(operationsSource, /YOUZI_IMAGE_COLLECTION_STATE_REQUEST/);
  assert.match(operationsSource, /requestProductImageCollectionSessionState\(\)/);
  assert.match(bridge, /imageCollector\.STATE_REQUEST_MESSAGE/);
  assert.match(bridge, /postCurrentImageCollectionState/);
  assert.match(bridge, /Object\.assign\(\{\}, message\.payload, \{ session: current \}\)/);
  assert.match(operationsSource, /payload&&payload\.session/);
  assert.match(operationsSource, /async function resumeProductImageCollectionForm/);
  assert.match(operationsSource, /openProductListingCase\(productId,\{skipAutoResearch:true\}\)/);
  assert.match(background, /chrome\.tabs\.create\(\{ url: OPERATIONS_PRODUCTS_URL, active: false \}\)/);
  assert.match(background, /portal\.html#products/);
});

test("淘寶與 1688 快速連結固定顯示在單品與每個細項收圖區", () => {
  const helperStart = operationsSource.indexOf("function productSupplierQuickLinksHtml");
  const helperEnd = operationsSource.indexOf("function productVariantCollectorHtml", helperStart);
  const helper = operationsSource.slice(helperStart, helperEnd);
  const variantStart = helperEnd;
  const variantEnd = operationsSource.indexOf("function productVariantRepresentativeCardHtml", variantStart);
  const variantCollector = operationsSource.slice(variantStart, variantEnd);
  const formStart = operationsSource.indexOf("function productListingCaseFormHtml");
  const formEnd = operationsSource.indexOf("async function openProductListingCase", formStart);
  const form = operationsSource.slice(formStart, formEnd);
  assert.match(helper, /開啟淘寶/);
  assert.match(helper, /開啟 1688/);
  assert.doesNotMatch(helper, /開啟阿里巴巴|alibaba\.com/);
  assert.match(variantCollector, /productSupplierQuickLinksHtml\(\)/);
  assert.match(form, /productSupplierQuickLinksHtml\(\)/);
});

test("收圖成功或失敗訊息不會立刻被等待文字覆蓋", () => {
  assert.match(supplierCollector, /let statusMessage = ""/);
  assert.match(supplierCollector, /!sending && !statusMessage/);
  assert.match(supplierCollector, /statusText\.classList\.toggle\("youzi-error", statusIsError\)/);
});

test("框選截圖完成後立即恢復已加入與結束收圖面板", () => {
  assert.match(supplierCollector, /let captureUiHidden = false/);
  assert.match(supplierCollector, /panel\.hidden = Boolean\(cropOverlay \|\| captureUiHidden\)/);
  assert.match(supplierCollector, /async function captureVisiblePage/);
  assert.match(supplierCollector, /captureUiHidden = false;\s*updatePanel\(\);/);
  assert.doesNotMatch(supplierCollector, /panel\.hidden = true;\s*captureSelection\(rect\)/);
});

test("框選截圖可在送出前移動縮放並避免供應商放大鏡遮罩", () => {
  assert.match(supplierCollector, /data-dir="nw"/);
  assert.match(supplierCollector, /data-dir="se"/);
  assert.match(supplierCollector, /data-crop-capture/);
  assert.match(supplierCollector, /截取這個範圍/);
  assert.match(supplierCollector, /interaction\.mode === "move"/);
  assert.match(supplierCollector, /const original = interaction\.original, dir = interaction\.dir/);
  assert.match(supplierCollector, /suppressSupplierHoverArtifacts/);
  assert.match(supplierCollector, /youzi-image-collector-suppressed-hover-artifact/);
  assert.match(supplierCollector, /youzi-crop-capture-hidden/);
});

test("詳情頁的延遲載入與容器內圖片也能顯示綠框", () => {
  assert.match(supplierCollector, /target\.closest\("img"\)/);
  assert.match(supplierCollector, /data-large-img/);
  assert.match(supplierCollector, /element\.querySelectorAll\("img"\)/);
  assert.match(supplierCollector, /depth < 9/);
});

test("綠框原圖受限時不顯示 Chrome 英文權限錯誤", () => {
  assert.match(background, /CAPTURE_USER_GESTURE_REQUIRED/);
  assert.match(background, /第一次請在頁面按右鍵/);
  assert.match(background, /柚子掌櫃：框選截圖/);
});

test("同一張圖完成後可再次收圖且不必重新整理", () => {
  assert.doesNotMatch(supplierCollector, /collectedUrls/);
  assert.match(supplierCollector, /queuedElements\.delete\(next\.element\)/);
  assert.match(supplierCollector, /if \(hoveredElement === next\.element\) hoveredElement = null/);
  assert.doesNotMatch(supplierCollector, /這張圖片已經選過了/);
});

test("收圖保存不會被尚未選完的細項父商品阻擋", () => {
  assert.match(operationsSource, /async function persistProductVariantReferenceImages/);
  assert.match(operationsSource, /await persistProductVariantReferenceImages\(form,id,urls,urls\)/);
  const helperStart = operationsSource.indexOf("async function persistProductVariantReferenceImages");
  const uploadStart = operationsSource.indexOf("async function uploadProductVariantReferenceImages", helperStart);
  const completedStart = operationsSource.indexOf("async function uploadProductCompletedListingImages", uploadStart);
  const intakeBlock = operationsSource.slice(helperStart, completedStart);
  assert.doesNotMatch(intakeBlock, /saveProductListingCase\(form/);
});

test("同款商品從各自已收圖片中指定一張代表圖", () => {
  assert.match(operationsSource, /function productVariantGroupPrimaryItemHtml/);
  assert.match(operationsSource, /function productVariantImagePickerOptionsHtml/);
  assert.match(operationsSource, /data-action="product-variant-image-select"/);
  assert.match(operationsSource, /async function selectProductVariantRepresentativeImage/);
  assert.match(operationsSource, /請從目前已收的圖片中選擇/);
  assert.match(operationsSource, /imageUrls:imageUrls\.slice\(0,1\)/);
  assert.match(operationsSource, /\.ops-listing-variant-item\[data-variant-role\^="group-child-"\]/);
  assert.match(operationsSource, /sourceImageUrls:sourceImageUrls/);
  assert.match(operationsSource, /loadProductListingVariantMedia\(item\.productId\)/);
});

test("同款細項可在同一畫面收圖、拖曳共用並清除代表圖", () => {
  assert.match(operationsSource, /function productVariantCollectorHtml/);
  assert.match(operationsSource, /data-action="product-variant-image-collection"/);
  assert.match(operationsSource, /data-variant-collector-count/);
  assert.match(operationsSource, /data-variant-collector-status/);
  assert.match(operationsSource, /targetButton\.closest\('\.ops-listing-variant-item'\)/);
  assert.match(operationsSource, /if\(status&&!singleMode\)status\.innerHTML=''/);
  assert.match(operationsSource, /data-action="product-variant-image-clear"/);
  assert.match(operationsSource, /data-variant-image-dropzone="1"/);
  assert.match(operationsSource, /draggable="true"/);
  assert.match(operationsSource, /application\/x-youzi-variant-image/);
  assert.match(operationsSource, /async function copyProductVariantReferenceImage/);
  assert.match(operationsSource, /await persistProductVariantReferenceImages\(form,id,copied,copied\)/);
  assert.match(operationsSource, /await selectProductVariantRepresentativeImage\(form,id,sourceUrl,role\)/);
  assert.doesNotMatch(operationsSource, /shared-variant-/);
  assert.match(operationsSource, /startProductImageCollection\(byId\('productListingCaseForm'\),el\.dataset\.id\)/);
});

test("同款商品會自動辨識顏色並用白話顯示區分方式", () => {
  assert.match(operationsSource, /function productVariantGroupAttributeSuggestion/);
  assert.match(operationsSource, /function productVariantResolvedValue/);
  assert.match(operationsSource, /stored==='編號 '\+sku/);
  assert.match(operationsSource, /return '顏色'/);
  assert.match(operationsSource, /這組商品以什麼區分/);
  assert.match(operationsSource, /例如：顏色、尺寸、規格/);
  assert.doesNotMatch(operationsSource, /<label class="ops-required">細項種類<\/label>/);
});

test("加入同款細項後會從案件來源或完成圖譜系恢復圖片", () => {
  assert.match(operationsSource, /function productListingRecoveredMedia/);
  assert.match(operationsSource, /generatedListingImages\.map\(function\(row\)\{return row\.sourceImageUrl/);
  assert.match(operationsSource, /productVariantImages\(p\)/);
  assert.match(operationsSource, /completedSources\.length\?completedSources/);
  assert.match(operationsSource, /referenceImagesCleared:rows\.length===0/);
  assert.match(operationsSource, /productListingSourceImageCache\.set\(id,row\.referenceImageUrls\.slice\(\)\)/);
});

test("繁體完成圖同步只更換中央商品圖，不刪除案件來源譜系", () => {
  const syncStart = operationsSource.indexOf("async function syncCompletedListingImagesToProduct");
  const syncEnd = operationsSource.indexOf("function normalizeProductShopeeAttributes", syncStart);
  const sync = operationsSource.slice(syncStart, syncEnd);
  assert.doesNotMatch(sync, /referenceImageUrls:\[\]|selectedReferenceImageUrls:\[\]|referenceImagesCleared:true/);

  const loadStart = operationsSource.indexOf("async function loadProductListingVariantMedia");
  const loadEnd = operationsSource.indexOf("function productVariantImageThumbsHtml", loadStart);
  const load = operationsSource.slice(loadStart, loadEnd);
  assert.doesNotMatch(load, /syncCompletedListingImagesToProduct\([^)]*,true\)|row\.referenceImageUrls=\[\]|row\.selectedReferenceImageUrls=\[\]/);

  const openStart = operationsSource.indexOf("async function openProductListingCase");
  const openEnd = operationsSource.indexOf("function validateProductListingHtml", openStart);
  const open = operationsSource.slice(openStart, openEnd);
  assert.doesNotMatch(open, /syncCompletedListingImagesToProduct\([^)]*,true\)|row\.referenceImageUrls=\[\]|row\.selectedReferenceImageUrls=\[\]/);

  const uploadStart = operationsSource.indexOf("async function uploadProductCompletedListingImages");
  const uploadEnd = operationsSource.indexOf("function productImageCollectionId", uploadStart);
  const upload = operationsSource.slice(uploadStart, uploadEnd);
  assert.match(upload, /referenceImageUrls:sourceImages/);
  assert.match(upload, /selectedReferenceImageUrls:sourceImages/);
  assert.match(upload, /referenceImagesCleared:false/);
  assert.doesNotMatch(upload, /syncCompletedListingImagesToProduct\([^)]*,true\)|sourceInput\.value=''|input\.checked=false/);
});

test("完成圖會保留來源與多角色譜系，不把同一來源壓成單一 URL", () => {
  const normalizeStart = operationsSource.indexOf("function normalizeGeneratedListingImages");
  const normalizeEnd = operationsSource.indexOf("function normalizeProductShopeeAttributes", normalizeStart);
  const normalize = operationsSource.slice(normalizeStart, normalizeEnd);
  assert.match(normalize, /roles:normalizeProductListingImageRoles\(row\)/);
  assert.match(normalize, /assetFlags:normalizeProductListingImageFlags\(row\)/);
  assert.match(normalize, /sourceImageUrl:safeUrl\(row&&row\.sourceImageUrl\)/);
  assert.match(normalize, /slice\(-120\)/);

  const snapshotStart = operationsSource.indexOf("function productListingCodexMediaSnapshot");
  const snapshotEnd = operationsSource.indexOf("function productListingCodexPreparedCase", snapshotStart);
  const snapshot = operationsSource.slice(snapshotStart, snapshotEnd);
  assert.match(snapshot, /readyRowsBySource=new Map\(\)/);
  assert.match(snapshot, /const rows=readyRowsBySource\.get\(row\.sourceImageUrl\)\|\|\[\];rows\.push\(row\)/);
  assert.doesNotMatch(snapshot, /readyBySource\.set\(row\.sourceImageUrl,row\.url\)/);
  assert.match(snapshot, /cleanMain\/brandedHero-role-conflict/);
});

test("中央圖片先寫入並重讀核對，來源 binary 清理在全部引用核對前保持阻擋", () => {
  const syncStart = operationsSource.indexOf("async function syncCompletedListingImagesToProduct");
  const syncEnd = operationsSource.indexOf("function normalizeProductShopeeAttributes", syncStart);
  const sync = operationsSource.slice(syncStart, syncEnd);
  const persist = sync.indexOf("await productRef.set");
  const reload = sync.indexOf("await productRef.get");
  const verify = sync.indexOf("重新讀取不一致");
  const retain = sync.indexOf("blocked-until-all-central-variant-platform-references-verified");
  assert.ok(persist >= 0 && reload > persist && verify > reload && retain > verify);
  assert.match(sync, /sourceBinaryCleanupRequired:true/);
  assert.match(sync, /cleanupWorkerRequired:true/);
  assert.match(sync, /eligibleForDeletion:false/);
  assert.doesNotMatch(sync, /\.delete\(|deleteObject|referenceImageUrls:\[\]/);

  const promptStart = operationsSource.indexOf("function productListingCodexHandoffPrompt");
  const promptEnd = operationsSource.indexOf("function productListingCodexThreadUrl", promptStart);
  const prompt = operationsSource.slice(promptStart, promptEnd);
  assert.match(prompt, /先寫入新完成圖引用並重讀資料庫/);
  assert.match(prompt, /核對中央、所有細項與四平台已全面換成完成圖/);
  assert.match(prompt, /cleanupStatus 推進到 required/);
  assert.match(prompt, /永久只保留來源 URL／hash、順序、角色與輸出譜系 metadata/);
});

test("一鍵交接會等待最後一張收圖保存完成", () => {
  assert.match(operationsSource, /let productImageCollectionPendingUploads = 0/);
  assert.match(operationsSource, /let productImageCollectionDeliverySequence = 0/);
  assert.match(operationsSource, /let productImageCollectionUploadFailures = \[\]/);
  assert.match(operationsSource, /function queueProductImageCollectionFile/);
  assert.match(operationsSource, /productImageCollectionUploadChain=next\.catch[\s\S]*?\.finally/);
  assert.match(operationsSource, /async function drainProductImageCollectionUploads/);
  assert.match(operationsSource, /await drainProductImageCollectionUploads\(form\)/);
  assert.match(operationsSource, /productImageCollectionSession=null/);
  assert.match(operationsSource, /if\(message\.type===PRODUCT_IMAGE_COLLECTION\.deliver\)queueProductImageCollectionFile\(payload\)\.catch/);
  assert.match(operationsSource, /index<PRODUCT_SELECTED_IMAGE_MAX/);
});

test("準備上架只顯示 Codex 入口，不提供網頁 OpenAI 文案或製圖按鈕", () => {
  const start = operationsSource.indexOf("function productListingCaseFormHtml");
  const end = operationsSource.indexOf("async function openProductListingCase", start);
  const renderer = operationsSource.slice(start, end);
  assert.match(renderer, /帶入這個 Codex 對話/);
  assert.doesNotMatch(renderer, /data-action="product-ai-research-run"/);
  assert.doesNotMatch(renderer, /data-action="product-ai-image-generate"/);
  assert.match(renderer, /id="productCompletedImageUpload"/);
  assert.match(renderer, /進階回填角色完成圖/);
  assert.doesNotMatch(renderer, />上傳 Codex 已完成圖片</);
  assert.equal((renderer.match(/data-action="product-listing-codex-complete"/g) || []).length, 1);
});

test("原圖被供應商網站阻擋時會自動改用可見圖片截圖", () => {
  assert.match(supplierCollector, /原圖讀取受限，正在改用畫面截圖/);
  assert.match(supplierCollector, /const dataUrl = await captureVisiblePage\(\)/);
  assert.match(supplierCollector, /cropVisibleCapture\(dataUrl, rect\)/);
  assert.match(supplierCollector, /deliverPreparedImage/);
});

test("Chrome 助手只在核准的供應商與圖片網域執行", () => {
  assert.equal(manifest.version, "0.3.24");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.ok(manifest.permissions.includes("contextMenus"));
  assert.ok(manifest.host_permissions.includes("https://*.taobao.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.1688.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.alibaba.com/*"));
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false);
  assert.ok(manifest.optional_host_permissions.includes("<all_urls>"));
  assert.match(background, /chrome\.permissions\.request\(PERSISTENT_CAPTURE_PERMISSION\)/);
  assert.match(background, /if \(!imageCollector\.isSupplierPageUrl\(pageUrl\)\)/);
  assert.equal(manifest.commands["start-image-crop"].suggested_key.default, "Ctrl+Shift+Y");
});
