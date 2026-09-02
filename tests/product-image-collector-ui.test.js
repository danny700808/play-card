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
  assert.match(operationsSource, /開始搜圖/);
  assert.match(operationsSource, /href="https:\/\/www\.taobao\.com\/"/);
  assert.match(operationsSource, /href="https:\/\/www\.1688\.com\/"/);
  assert.doesNotMatch(operationsSource, /從淘寶／1688 框選截圖/);
  assert.match(operationsSource, /PRODUCT_IMAGE_COLLECTION\.maxImages/);
  assert.doesNotMatch(operationsSource, /<label>商品網址<\/label>/);
});

test("一般商品頁預設關閉點圖，明確開啟後才攔截圖片點擊", () => {
  assert.match(supplierCollector, /directPickEnabled = false/);
  assert.match(supplierCollector, /點圖片加入：關閉/);
  assert.match(supplierCollector, /點圖片加入：開啟/);
  assert.match(supplierCollector, /directPickEnabled = !directPickEnabled/);
  assert.match(supplierCollector, /if \(!directPickEnabled\) clearHover\(\)/);
  assert.match(supplierCollector, /aria-pressed/);
  assert.match(supplierCollector, /data-youzi-crop>框選截圖/);
  assert.doesNotMatch(supplierCollector, /youzi-help|原圖點選：(?:開啟|關閉)/);
  assert.match(supplierCollector, /helpers\.CAPTURE_MESSAGE/);
  assert.match(supplierCollector, /document\.addEventListener\("paste"/);
  assert.match(background, /chrome\.tabs\.captureVisibleTab/);
  assert.match(background, /imageCollector\.CAPTURE_DATA_MESSAGE/);
  assert.doesNotMatch(background, /chrome\.contextMenus|ensureContextMenu/);
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

test("同款商品的彙整圖第一次全部預選且只記錄使用者主動排除", () => {
  assert.match(operationsSource, /variantGallerySelectionInitialized/);
  assert.match(operationsSource, /if\(!selectionInitialized\)/);
  assert.match(operationsSource, /defaultSelected\.size<PRODUCT_GROUP_LISTING_IMAGE_MAX/);
  assert.match(operationsSource, /name="variantGallerySelectionInitialized" value="1"/);
  assert.match(operationsSource, /variantGallerySelectionInitialized:variantGallerySelectionInitialized/);
});

test("細項指定照片只保存來源選擇並交由完成圖譜系對應", () => {
  assert.match(operationsSource, /representativeSourceImageUrl:safeUrl\(representativeSourceImageUrl\)/);
  assert.match(operationsSource, /variantGroupPrimaryImageUrl/);
  assert.match(operationsSource, /variantChildImageUrl/);
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

test("準備上架的主商品與每個細項都顯示供應商快速連結", () => {
  const variantStart = operationsSource.indexOf("function productVariantCollectorHtml");
  const variantEnd = operationsSource.indexOf("function productVariantRepresentativeCardHtml", variantStart);
  const variantCollector = operationsSource.slice(variantStart, variantEnd);
  const formStart = operationsSource.indexOf("function productListingCaseFormHtml");
  const formEnd = operationsSource.indexOf("async function openProductListingCase", formStart);
  const form = operationsSource.slice(formStart, formEnd);
  assert.match(form, /productSupplierShortcutsHtml\('ops-listing-single-image-controls'\)/);
  assert.match(operationsSource, />淘寶網<\/a>/);
  assert.match(operationsSource, />1688<\/a>/);
  assert.doesNotMatch(variantCollector, /productSupplierQuickLinksHtml/);
  assert.match(variantCollector, /productSupplierShortcutsHtml\('ops-listing-variant-supplier-shortcuts'\)/);
});

test("商品列表不顯示快捷合併控制，但準備上架仍保留既有商品合併規則", () => {
  const renderStart = operationsSource.indexOf('function renderProducts');
  const renderEnd = operationsSource.indexOf('function estimateFifoCostForProduct', renderStart);
  const render = operationsSource.slice(renderStart, renderEnd);
  assert.doesNotMatch(render, /product-merge-select|product-merge-open|合併／加入既有商品/);
  assert.match(operationsSource, /selected\.filter\(productHasPlatformMapping\)/);
  assert.match(operationsSource, /listingIntent:listed\.length\?'merge-existing':'create-group'/);
  assert.match(operationsSource, /合併／加入既有商品/);
  assert.match(operationsSource, /已有平台商品編號的商品放在第一筆並作為主商品/);
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

test("框選截圖拉框後確認送出，並避免網站放大鏡遮罩", () => {
  assert.match(supplierCollector, /data-crop-capture/);
  assert.match(supplierCollector, /確認截圖/);
  assert.match(supplierCollector, /data-crop-reset>重新框選/);
  assert.match(supplierCollector, /data-crop-cancel>取消框選/);
  assert.match(supplierCollector, /querySelector\("\[data-crop-cancel\]"\).*cancelCrop\(\)/);
  assert.match(supplierCollector, /已取消框選，可繼續操作原網頁/);
  assert.match(supplierCollector, /範圍正確就按/);
  assert.doesNotMatch(supplierCollector, /data-dir=|interaction\.mode|interaction\.original/);
  assert.match(supplierCollector, /suppressSupplierHoverArtifacts/);
  assert.match(supplierCollector, /youzi-image-collector-suppressed-hover-artifact/);
  assert.match(supplierCollector, /youzi-crop-capture-hidden/);
});

test("詳情頁的延遲載入與容器內圖片也能顯示綠框", () => {
  assert.match(supplierCollector, /target\.closest\("img,video,canvas,svg image"\)/);
  assert.match(supplierCollector, /data-large-img/);
  assert.match(supplierCollector, /element\.querySelectorAll\("img,video\[poster\],canvas,svg image"\)/);
  assert.match(supplierCollector, /depth < 9/);
});

test("商品主圖上方的促銷 badge 或放大遮罩不會被當成商品圖", () => {
  assert.match(supplierCollector, /function decorativeOverlayImage/);
  assert.match(supplierCollector, /badge\|watermark\|mask\|lens\|overlay\|sprite/);
  assert.match(supplierCollector, /decorativeOverlayImage\(image\)/);
  assert.match(supplierCollector, /return br\.width \* br\.height - ar\.width \* ar\.height/);
});

test("截圖權限由新版安裝一次取得，不再要求右鍵操作", () => {
  assert.ok(manifest.host_permissions.includes("<all_urls>"), "網頁面板呼叫 captureVisibleTab 必須宣告 <all_urls>");
  assert.doesNotMatch(background, /CAPTURE_USER_GESTURE_REQUIRED|右鍵|contextMenus/);
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

test("EasyStore 官網既有細項圖會自動出現在細項小框", () => {
  assert.match(operationsSource, /function productAutomaticVariantRepresentative/);
  assert.match(operationsSource, /product\.variantImageUrls/);
  assert.match(operationsSource, /source:'easystore-variant'/);
  assert.match(operationsSource, /easyStoreProductVariantCount/);
  assert.match(operationsSource, /source:'easystore-single-main'/);
  assert.match(operationsSource, /selected=explicit\|\|automatic\.url/);
  assert.match(operationsSource, /data-variant-image-origin=/);
  assert.match(operationsSource, /官網細項圖已自動帶入/);
  assert.match(operationsSource, /automaticUrls,source\.referenceImageUrls/);
  assert.match(operationsSource, /imageUrls:automatic\.url\?\[automatic\.url\]:\[\]/);
  assert.match(operationsSource, /function productNeedsEasyStoreVariantImage/);
  assert.match(operationsSource, /官網缺細項圖優先/);
  assert.match(operationsSource, /官網細項圖待補/);
});

test("同款細項可在同一畫面收圖、拖曳共用並清除代表圖", () => {
  assert.match(operationsSource, /function productVariantRepresentativePreviewHtml/);
  assert.match(operationsSource, /class="ops-listing-variant-key-fields"/);
  assert.match(operationsSource, /class="ops-listing-variant-representative/);
  assert.match(operationsSource, /data-variant-image-preview/);
  assert.match(operationsSource, /class="ops-listing-variant-key-copy"/);
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

test("同款細項圖片可由下方既有商品往上拖回目前商品", () => {
  const refreshStart = operationsSource.indexOf("function refreshProductVariantImageTarget");
  const copyStart = operationsSource.indexOf("async function copyProductVariantReferenceImage", refreshStart);
  const persistStart = operationsSource.indexOf("async function persistProductVariantReferenceImages", copyStart);
  const refresh = operationsSource.slice(refreshStart, copyStart);
  const copy = operationsSource.slice(copyStart, persistStart);

  assert.match(refresh, /query\('\[name="referenceImageUrls"\]',form\)/, "目前商品的來源圖欄位也要同步更新");
  assert.match(refresh, /source\.value=rows\.join\('\\n'\)/, "拖到目前商品後，後續代表圖檢查必須讀得到新圖片");
  assert.match(copy, /productReferenceImageSelectorHtml\(copied,copied\)/, "目前商品的圖片選擇畫面也要立即同步");
  assert.ok(
    copy.indexOf("refreshProductVariantImageTarget(form,id,copied)") < copy.lastIndexOf("selectProductVariantRepresentativeImage(form,id,sourceUrl,role)"),
    "必須先同步目前商品來源圖，再指定代表圖"
  );
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
  assert.match(snapshot, /hero-role-conflict/);
});

test("中央圖片仍先寫入重讀，快速核對不蒐集平台圖片回條且不啟動來源清理", () => {
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
  assert.match(prompt, /圖片角色、來源譜系與平台圖片計畫只在進站前完整驗證一次/);
  assert.match(prompt, /送出後不再逐張蒐集平台 CDN 網址/);
  assert.match(prompt, /只有平台明確回報圖片錯誤/);
  assert.match(operationsSource, /snapshot\.executionPolicy\.sourceBinaryCleanupRequired=false/);
  assert.match(operationsSource, /snapshot\.executionPolicy\.cleanupWorkerRequired=false/);
  assert.match(operationsSource, /snapshot\.executionPolicy\.retainSourceBinaries=true/);
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

test("準備上架直接顯示八個處理方塊，不提供網頁 OpenAI 文案或製圖按鈕", () => {
  const start = operationsSource.indexOf("function productListingCaseFormHtml");
  const end = operationsSource.indexOf("async function openProductListingCase", start);
  const renderer = operationsSource.slice(start, end);
  assert.match(renderer, /網路上架處理/);
  assert.match(renderer, /productListingActionGridHtml\(row\)/);
  assert.doesNotMatch(renderer, /data-action="product-ai-research-run"/);
  assert.doesNotMatch(renderer, /data-action="product-ai-image-generate"/);
  assert.match(renderer, /id="productCompletedImageUpload"/);
  assert.match(renderer, /進階回填完成圖/);
  assert.doesNotMatch(renderer, />上傳 Codex 已完成圖片</);
  assert.match(operationsSource, /const scopes=\['all','momo','coupang','website'\]/);
  assert.match(operationsSource, /data-action="product-listing-queue-add"/);
  assert.match(operationsSource, /data-action="product-listing-codex-complete"/);
});

test("原圖被供應商網站阻擋時會自動改用可見圖片截圖", () => {
  assert.match(supplierCollector, /原圖讀取受限，正在改用畫面截圖/);
  assert.match(supplierCollector, /const captured = await captureVisiblePage\(next\.element\)/);
  assert.match(supplierCollector, /cropVisibleCapture\(captured\.dataUrl, captured\.rect\)/);
  assert.match(supplierCollector, /deliverPreparedImage/);
});

test("Chrome 助手在一般商品網頁提供點圖開關與可取消的框選截圖", () => {
  assert.equal(manifest.version, "0.3.34");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.equal(manifest.permissions.includes("contextMenus"), false);
  assert.ok(manifest.host_permissions.includes("https://*.taobao.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.1688.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.alibaba.com/*"));
  assert.ok(manifest.host_permissions.includes("http://*/*"));
  assert.ok(manifest.host_permissions.includes("<all_urls>"), "網頁面板呼叫 captureVisibleTab 必須宣告 <all_urls>");
  const collectorEntry = manifest.content_scripts.find((entry) => entry.js.includes("supplier-collector.js"));
  assert.ok(collectorEntry.matches.includes("http://*/*"));
  assert.ok(collectorEntry.matches.includes("https://*/*"));
  assert.match(background, /if \(!imageCollector\.isCollectablePageUrl\(pageUrl\)\)/);
  assert.match(supplierCollector, /data-youzi-crop>框選截圖/);
  assert.match(supplierCollector, /data-crop-capture>確認截圖/);
  assert.match(supplierCollector, /data-crop-cancel>取消框選/);
  assert.doesNotMatch(supplierCollector, /youzi-crop-handle|mode: "resize"|mode: "move"/);
  assert.doesNotMatch(background, /contextMenus|右鍵/);
  assert.equal(manifest.commands["start-image-crop"].suggested_key.default, "Ctrl+Shift+Y");
});

test("0.3.34 具備網頁面板截圖權限並能替已開分頁補載入", () => {
  assert.ok(manifest.host_permissions.includes("<all_urls>"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /installCollectorsInOpenTabs/);
  assert.match(background, /imageCollector\.COLLECTOR_PING_MESSAGE/);
  assert.match(supplierCollector, /helpers\.COLLECTOR_PING_MESSAGE/);
});

test("截圖會核對作用中分頁、阻止連點並翻成中文錯誤", () => {
  assert.match(background, /activeTabs\.some\(\(tab\) => tab\.id === sender\.tab\.id\)/);
  assert.match(background, /capturingWindowIds\.has/);
  assert.match(background, /CAPTURE_PERMISSION_MISSING/);
  assert.match(background, /Chrome 尚未啟用完整截圖權限/);
  assert.match(supplierCollector, /let cropCaptureInFlight = false/);
  assert.match(supplierCollector, /cropCaptureInFlight = true/);
});

test("原圖回退會先解除放大、重新量座標並排除覆蓋物", () => {
  const captureStart = supplierCollector.indexOf("async function captureVisiblePage");
  const dismissAt = supplierCollector.indexOf("dismissSupplierHoverPreview()", captureStart);
  const settleAt = supplierCollector.indexOf("requestAnimationFrame(() => requestAnimationFrame(resolve))", dismissAt);
  const measureAt = supplierCollector.indexOf("elementRectInViewport(targetElement)", settleAt);
  const sendAt = supplierCollector.indexOf("chrome.runtime.sendMessage({ type: helpers.CAPTURE_MESSAGE })", measureAt);
  assert.ok(captureStart >= 0 && dismissAt > captureStart && settleAt > dismissAt && measureAt > settleAt && sendAt > measureAt);
  assert.match(supplierCollector, /\.product-badge-img/);
  assert.match(supplierCollector, /right - left/);
  assert.match(supplierCollector, /result\.code !== "IMAGE_READ_FAILED"/);
});

test("高解析截圖會自動壓縮，營運中心只接受 0.3.34 以上助手", () => {
  assert.match(supplierCollector, /async function canvasBlobWithinLimit/);
  assert.match(supplierCollector, /Math\.sqrt\(helpers\.MAX_IMAGE_BYTES \/ blob\.size\)/);
  assert.match(operationsSource, /minimumVersion:'0\.3\.34'/);
  assert.match(operationsSource, /productImageCollectionVersionAtLeast/);
  assert.match(bridge, /extensionVersion: EXTENSION_VERSION/);
  assert.match(operationsSource, /目前收圖助手版本過舊/);
});
