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

test('一鍵上架按鈕把固定 v3 工作帶入指定 Codex 對話並授權後端續跑', () => {
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
  assert.match(source, /momoMainAdAndPromotionImagesAreSeparate:true/);
  assert.match(source, /momoPromotionRequiredBeforeFirstSubmit:true/);
  assert.match(source, /easyStoreImageUrlUploadFallback:true/);
  assert.match(source, /retrySameUrlInFreshInAppWorkTabWhenClaimedTabInputFails:true/);
  assert.match(source, /batchSessionPreflightBeforeFirstProduct:true/);
  assert.match(source, /requireAllPlatformSessionsOperableBeforeBatchStart:true/);
  assert.match(source, /lightweightSessionProbeBeforeEveryProductAndStage:true/);
  assert.match(source, /autoRecoverSavedCredentialSessions:true/);
  assert.match(source, /neverAskUserForRecoverableSessionRestart:true/);
  assert.match(source, /fillStableControlsInSingleSectionPass:true/);
  assert.match(source, /snapshot\.executionPolicy\.validateSectionOnceAfterBatch=false/);
  assert.match(source, /snapshot\.executionPolicy\.validateDynamicSectionOnceAfterBatch=true/);
  assert.match(source, /snapshot\.executionPolicy\.fastEssentialVerification=true/);
  assert.match(source, /dynamicControlsSequentialWithinSection:true/);
  assert.match(source, /shopeeLargeItemHctOnly:true/);
  assert.doesNotMatch(source, /Codex 待辦已建立/);
});

test('主要按鈕不再直接執行 OpenAI 文案與圖片 API 流程', () => {
  const handler = source.match(/if\(action==='product-listing-codex-complete'\)\{[\s\S]*?\n\s*\}/)[0];
  assert.match(handler, /handoffProductListingToCodex/);
  assert.doesNotMatch(handler, /completeProductListingWithCodex/);
  assert.doesNotMatch(source, /async function completeProductListingWithCodex/);
  assert.doesNotMatch(handler, /researchProductListingCase|generateProductListingImage/);
  assert.match(source, /完成圖已齊全，正在啟動正式四通路工作/);
  assert.match(source, /callProductListingPublishWithTransientRetry\(id,form\)/);
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

test('沒有待存圖片時不等待舊收圖 Promise，交接進度能定位每個保存階段', () => {
  const drain = section('async function drainProductImageCollectionUploads(form)', 'async function stopProductImageCollection(form)');
  const handoff = section('async function handoffProductListingToCodex(form)', 'function productListingCodexResultDraft');
  assert.match(drain, /if\(productImageCollectionPendingUploads===0\)/);
  assert.ok(drain.indexOf('if(productImageCollectionPendingUploads===0)') < drain.indexOf('await Promise.race'));
  assert.match(drain, /productImageCollectionUploadChain=Promise\.resolve\(\)/);
  assert.match(handoff, /收圖已固定，正在重讀完成圖/);
  assert.match(handoff, /細項代表圖已確認，正在保存案件/);
  assert.match(handoff, /案件已保存，正在建立不可變快照/);
});

test('Codex deep link 只帶短交接，完整規則仍保存在案件避免多細項連結過長', () => {
  const activation = section('function productListingCodexActivationPrompt', 'function productListingCodexThreadUrl');
  const handoff = section('async function handoffProductListingToCodex(form)', 'function productListingCodexResultDraft');
  assert.match(activation, /\[固定流程 v3 短交接\]/);
  assert.match(activation, /codexHandoff\.prompt 與 codexHandoff\.preflightSnapshot/);
  assert.match(activation, /本組每個商品的繁體完成圖/);
  assert.match(activation, /MOMO、酷澎、EasyStore 三個根工作/);
  assert.match(handoff, /activationPrompt=productListingCodexActivationPrompt\(product,snapshot\)/);
  assert.match(handoff, /threadUrl=productListingCodexThreadUrl\(activationPrompt\)/);
  assert.match(handoff, /activationPrompt:activationPrompt,prompt:prompt/);
  assert.match(handoff, /copyProductListingCodexPrompt\(activationPrompt\)/);
  assert.doesNotMatch(handoff, /productListingCodexThreadUrl\(prompt\)/);
});

test('固定流程鎖定品牌頁首、MOMO 專推圖與 EasyStore 後立即接蝦皮', () => {
  assert.match(source, /頂端薄荷綠品牌區必須從 product-listing-main-template\.jpg 以確定性像素覆蓋方式直接合成/);
  assert.match(source, /圖片模型只准生成下方商品內容區/);
  assert.match(source, /禁止壓窄、拉伸、裁切或重新排版/);
  assert.match(source, /商品詳細介紹使用「上傳圖片」→「從素材銀行選擇」/);
  assert.match(source, /preparedPlatformFieldPlan 產生專推圖網址、唯一素材檔名與指紋/);
  assert.match(source, /三處未齊全時禁止第一次發布/);
  assert.match(source, /已存在就不得重複插入/);
  assert.match(source, /單一商品、同款多細項與加入既有商品成為細項都使用同一 firstSubmitMediaGate/);
  assert.match(source, /整筆主商品共用一張專推圖/);
  assert.match(source, /MOMO 商店分類最多 5 個/);
  assert.match(source, /EasyStore 一經正式核對 verified/);
  assert.match(source, /不得等待 MOMO 或酷澎完成/);
  assert.match(source, /後續區段已填後禁止返回或重新產生/);
  assert.match(source, /長邊以 1600～2000 px 為宜/);
});

test('新 SKU 必須先回正各平台固定入口，且同 SKU 重試保留原草稿', () => {
  assert.match(source, /newCaseBoundaryResetRequired:true/);
  assert.match(source, /discardPreviousCaseUiState:true/);
  assert.match(source, /openCanonicalPlatformEntryBeforeNewCase:true/);
  assert.match(source, /doNotResetSameSkuRetryDraft:true/);
  assert.match(source, /新案件邊界規則/);
  assert.match(source, /不得把上一件畫面當成資料錯誤/);
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
  assert.match(prompt, /MOMO、酷澎、EasyStore 與蝦皮及所有重試只准沿用該快照/);
  assert.match(prompt, /來源圖 .*待繁體化／定案 .*完成圖 .*實體圖 .*缺少角色 .*狀態/);
  assert.match(prompt, /流程、角色與核對規則不可漂移/);
  assert.match(prompt, /MOMO、酷澎、EasyStore 官網、蝦皮/);
  assert.match(prompt, /每站送出後只做一次快速核對/);
  assert.match(prompt, /MOMO、酷澎、EasyStore 是三個獨立根節點/);
  assert.match(prompt, /蝦皮只依賴 EasyStore/);
  assert.match(prompt, /不再逐張蒐集平台 CDN 網址/);
  assert.match(prompt, /平台明確回報圖片錯誤/);
  assert.match(prompt, /來源不符、原圖冒充完成圖、缺角色或 assetFlags 時必須停止/);
  assert.match(prompt, /最終 job preparedSnapshot 建立後，一次完成/);
  assert.match(prompt, /先保留至少一張 cleanMain、一張 storefrontPortrait 與一張 brandedHero/);
  assert.match(prompt, /MOMO 第 2 或第 3 張必須先保留專推圖/);
  assert.match(prompt, /商品主圖、廣告用圖與商品詳細介紹編輯器內的專推圖是三個互相獨立的必填位置/);
  assert.match(prompt, /甲指第三方 000001 仍保存/);
  assert.match(prompt, /EasyStore storefrontPortrait 為 750×1000 px、3:4/);
  assert.match(prompt, /蝦皮 brandedHero 為 1000×1000 px、1:1/);
  assert.match(prompt, /MOMO／酷澎 cleanMain 為 1000×1000 px、1:1/);
  assert.match(prompt, /淺色內容底板四周保留細綠邊/);
  assert.match(prompt, /同一輪圖片處理固定產生三個首圖版型/);
  assert.match(prompt, /不得進平台後才重新裁切或設計/);
  assert.match(prompt, /preflightSnapshot\.decisionContract 是唯一執行契約/);
  assert.match(prompt, /只有 judgmentFields 可以由 Codex/);
  assert.match(prompt, /Codex 對話旁邊的內建瀏覽器/);
  assert.match(prompt, /不得操作使用者主要 Chrome/);
  assert.match(prompt, /整批商品第一次開始前.*四通路工作階段預檢/);
  assert.match(prompt, /未通過前不得開始第一件商品/);
  assert.match(prompt, /酷澎與 EasyStore 若登入失效.*保存帳密重新登入/);
  assert.match(prompt, /每件商品及每個平台階段開始前只做輕量存活檢查/);
  assert.match(prompt, /不得因可恢復的頁籤失效詢問是否重開或是否繼續/);
  assert.match(prompt, /同一內建瀏覽器開一個工作頁籤載入完全相同網址/);
  assert.match(prompt, /輸入控制備援，不是第二條上架路徑/);
  assert.match(prompt, /已同時授權四通路的建立、修改與最後正式發布/);
  assert.match(prompt, /不得再產生「確認正式發布四通路／確認上架／確認提交／套用細項」/);
  assert.match(prompt, /確認正式發布四通路／確認上架／確認提交／套用細項/);
  assert.match(prompt, /商品詳細介紹使用「上傳圖片」→「從素材銀行選擇」/);
  assert.match(prompt, /商品主圖、廣告用圖、編輯器專推圖三處完成並儲存後/);
  assert.match(prompt, /只重開同一草稿一次確認專推圖仍存在/);
  assert.match(prompt, /不得先送空缺版本再回頭補/);
  assert.match(prompt, /此帳號無此功能權限/);
  assert.match(prompt, /account-permission-denied 永久阻擋/);
  assert.match(prompt, /先收合內嵌客服聊天/);
  assert.match(prompt, /已存在的繁體完成圖庫選取/);
  assert.match(prompt, /不得開啟 Windows 原生選檔視窗/);
  assert.match(prompt, /包裝重量換算的必填公克數/);
  assert.match(prompt, /進入第一個平台前先產生四站完整欄位表/);
  assert.match(prompt, /不得每站重新掃描整頁/);
  assert.match(prompt, /頁面版型未改變時直接套用已準備欄位/);
  assert.match(prompt, /MOMO 第三方 000001/);
  assert.match(prompt, /generatedListingImages 的公開完成圖網址批次加入/);
  assert.match(prompt, /蝦皮大型商品只保留符合材積級距的新竹物流/);
  assert.match(prompt, /酷澎固定走已驗證的「以圖片建立」同一草稿/);
  assert.match(prompt, /按一次「產生商品資訊」/);
  assert.match(prompt, /每一個細項各自的 cleanMain/);
  assert.match(prompt, /不得只上傳第一個細項的圖片/);
  assert.match(prompt, /以每一列為範圍/);
  assert.match(prompt, /不得用整頁動態 nth 順序跨列填寫/);
  assert.match(prompt, /立即開啟自動儲存並儲存同一草稿/);
  assert.match(prompt, /把新細項改回舊值/);
  assert.match(prompt, /細項欄位若呈唯讀或值無效，只能在尚未填寫細項商務、配送或介紹以前/);
  assert.match(prompt, /審核中只記為已送審，不得誤報已上架/);
  assert.match(prompt, /只依 preflightSnapshot\.listingIntent 決定/);
  assert.match(prompt, /新增模式遇到既有 ID 必須停止/);
  assert.match(prompt, /修改模式缺少既有 ID 必須停止/);
  assert.match(prompt, /只有送出逾時或結果不明時.*精確查詢一次/);
  assert.match(prompt, /不得用名稱廣搜/);
  assert.match(prompt, /productDescription 只有通用提醒、商品編號、免責文字時，一律視為內容尚未完成/);
  assert.match(prompt, /「商品特色」「使用方式／適用情境」「商品規格」三段/);
  assert.match(prompt, /後端重讀確認後才可建立 preparedSnapshot/);
  assert.match(prompt, /EasyStore、蝦皮、MOMO、酷澎全部沿用同一份已完成介紹/);
});

test('固定快照會標記通用備援文案未完成，避免非空白文字被誤當正式介紹', () => {
  const prepared = section('function productListingCodexPreparedCase', 'async function loadProductListingCodexHandoffCase');
  const contract = section('function productListingDecisionContract', 'async function loadProductListingCodexHandoffSnapshot');
  assert.match(source, /function productListingDescriptionStatus\(value\)/);
