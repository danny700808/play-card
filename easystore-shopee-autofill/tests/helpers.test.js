"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const helpers = require("../helpers.js");

function validPayload(now) {
  return {
    schemaVersion: 5,
    workflowVersion: "youzi-four-channel-listing-v2",
    jobId: "job-shopee-v2-1",
    snapshotId: "snapshot-shopee-v2-1",
    snapshotFingerprint: "a".repeat(64),
    nonce: "azes40-prb-00000001",
    createdAt: now,
    expiresAt: now + 10 * 60 * 1000,
    productId: "catalog-azes40-prb",
    easyStoreProductId: "3969443",
    easyStoreUrl: "https://admin.easystore.co/products/3969443",
    sku: "1040160-1",
    title: "Ibanez AZES40-PRB AZ Essentials 電吉他－馬卡藍",
    publishMode: "auto",
    variantGroup: null,
    listingPolicy: {
      mode: "update-existing",
      identitySource: "central-platform-id",
      platformListingIds: ["4116442"],
      preflightSkuSearch: false,
      uncertainSubmitRecovery: "exact-sku-only"
    },
    categoryPath: ["愛好與收藏品", "樂器與樂器配件", "弦樂器", "吉他、貝斯"],
    brand: "Ibanez",
    attributes: [
      { label: "Neck Material", value: "Maple", confidence: "high", note: "Ibanez 官方規格" },
      { label: "Body Material", value: "Poplar", confidence: "high", note: "Ibanez 官方規格" },
      { label: "Fretboard Material", value: "Jatoba", confidence: "high", note: "Ibanez 官方規格" },
      { label: "Pickup Configuration", value: "HSS", confidence: "high", note: "Essentials S-S-H" },
      { label: "Guitar Type", value: "Electric Guitar", confidence: "high", note: "產品類型" },
      { label: "Hand Configuration", value: "Right Handed", confidence: "high", note: "標準右手版" },
      { label: "Number of Strings", value: "6", confidence: "high", note: "六弦電吉他" },
      { label: "Item condition", value: "New", confidence: "high", note: "新品" },
      { label: "Weight", value: "4.2 kg", confidence: "medium", note: "包裝重量" },
      { label: "Dimension (L x W x H)", value: "106.7 x 45.7 x 10.2 cm", confidence: "medium", note: "包裝尺寸" }
    ],
    package: { lengthCm: 106.7, widthCm: 45.7, heightCm: 10.2, weightKg: 4.2 },
    logistics: {
      decision: "freight",
      packageTotalCm: 162.6,
      methods: [
        { label: "黑貓宅急便", enabled: false, option: "", feeTwd: null, sellerPays: false },
        { label: "蝦皮店到店 - 隔日到貨", enabled: false, option: "", feeTwd: null, sellerPays: false },
        { label: "蝦皮店到店", enabled: false, option: "", feeTwd: null, sellerPays: false },
        { label: "7-ELEVEN", enabled: false, option: "", feeTwd: null, sellerPays: false },
        { label: "新竹物流", enabled: true, option: "S170", feeTwd: null, sellerPays: false },
        { label: "全家", enabled: false, option: "", feeTwd: null, sellerPays: false },
        { label: "賣家宅配：大型/超重物品運送", enabled: true, option: "", feeTwd: 100, sellerPays: false },
        { label: "嘉里快遞", enabled: false, option: "", feeTwd: null, sellerPays: false },
        { label: "店到家宅配", enabled: false, option: "", feeTwd: null, sellerPays: false }
      ],
      requiresConfirmation: false
    },
    preorder: { enabled: false, days: 1 },
    guard: { brand: "Ibanez", model: "AZES40-PRB", color: "Purist Blue", identityStatus: "confirmed" }
  };
}

test("normalizes exact labels without fuzzy substring matching", () => {
  assert.equal(helpers.normalizeText(" 161～170 cm （S170） "), "161~170cms170");
  assert.equal(helpers.exactApprovedMatch("楓 木", ["Maple", "楓木"]), true);
  assert.equal(helpers.exactApprovedMatch("Maple neck", ["Maple"]), false);
  assert.equal(helpers.resolveAttributeKey("Neck Material"), "neckMaterial");
  assert.equal(helpers.resolveAttributeKey("Neck"), "");
});

test("category stages require the full approved path in order", () => {
  const path = ["愛好與收藏品", "樂器與樂器配件", "弦樂器", "吉他、貝斯"];
  assert.equal(helpers.orderedCategoryPathMatch(
    "愛好與收藏品 > 樂器與樂器配件 > 弦樂器 > 吉他、貝斯",
    path
  ), true);
  assert.equal(helpers.orderedCategoryPathMatch("愛好與收藏品 > 弦樂器", path), false);
  assert.equal(helpers.orderedCategoryPathMatch(
    "吉他、貝斯 > 弦樂器 > 樂器與樂器配件 > 愛好與收藏品",
    path
  ), false);
});

test("legacy music category wording is converted to the exact EasyStore category", () => {
  const legacyPath = ["樂器與配件", "弦樂器", "吉他、貝斯"];
  assert.equal(helpers.canonicalCategorySegment("樂器與配件"), "樂器與樂器配件");
  assert.deepEqual(
    helpers.canonicalCategoryPath(legacyPath),
    ["愛好與收藏品", "樂器與樂器配件", "弦樂器", "吉他、貝斯"]
  );
  assert.deepEqual(
    helpers.canonicalCategoryPath(["愛好與收藏品", "樂器與配件", "吉他與貝斯", "電吉他"]),
    ["愛好與收藏品", "樂器與樂器配件", "弦樂器", "吉他、貝斯"]
  );
  assert.equal(
    helpers.orderedCategoryPathMatch(
      "愛好與收藏品 > 樂器與樂器配件 > 弦樂器 > 吉他、貝斯",
      legacyPath
    ),
    true
  );
  assert.equal(
    helpers.exactVisibleCategoryOptionIndex([
      categoryOption("樂器與樂器配件", 1)
    ], "樂器與配件", 1),
    0
  );
  const payload = validPayload(1_800_000_000_000);
  payload.categoryPath = legacyPath;
  const result = helpers.validateQueuePayload(payload, 1_800_000_000_000);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.categoryPath, ["愛好與收藏品", "樂器與樂器配件", "弦樂器", "吉他、貝斯"]);
});

test("decorated EasyStore category labels and the empty prompt remain discoverable", () => {
  assert.equal(helpers.categoryLabelTextMatch("分類"), true);
  assert.equal(helpers.categoryLabelTextMatch("* 分類 ⓘ"), true);
  assert.equal(helpers.categoryLabelTextMatch("＊Category info"), true);
  assert.equal(helpers.categoryLabelTextMatch("分類 請先選擇分類"), false);
  assert.equal(helpers.categoryLabelTextMatch("商品分類"), false);
  const source = fs.readFileSync(path.join(__dirname, "..", "easystore.js"), "utf8");
  assert.match(source, /const prompts = findExactTextElements\(CATEGORY_EMPTY_PROMPTS\)/);
  assert.match(source, /const anchors = label \? \[label, \.\.\.prompts\] : prompts/);
  assert.match(source, /for \(const anchor of anchors\)/);
  assert.match(source, /if \(card\) return result/);
});

test("category action scoring picks the right-side pencil instead of help or publish", () => {
  const pencil = helpers.categoryActionScore({
    semantic: "mdi-pencil edit",
    tagName: "BUTTON",
    role: "button",
    rightRatio: 0.94,
    width: 34,
    height: 34,
    hasIcon: true
  });
  const help = helpers.categoryActionScore({
    semantic: "help info",
    tagName: "BUTTON",
    role: "button",
    rightRatio: 0.22,
    width: 24,
    height: 24,
    hasIcon: true
  });
  const publish = helpers.categoryActionScore({
    semantic: "上架",
    tagName: "BUTTON",
    role: "button",
    rightRatio: 0.99,
    width: 58,
    height: 34,
    hasIcon: false
  });
  assert.ok(pencil > help);
  assert.ok(pencil > publish);
});

test("category card discovery climbs past a prompt-only child to the first card with its sibling pencil", () => {
  const candidates = [
    { hasPrompt: true, width: 620, height: 70, actionScores: [] },
    { hasPrompt: true, width: 760, height: 150, actionScores: [720] },
    { hasPrompt: true, width: 1100, height: 500, actionScores: [720, 400] }
  ];
  assert.equal(helpers.smallestCategoryCardIndex(candidates), 1);
  assert.equal(helpers.smallestCategoryCardIndex([
    { hasPrompt: true, width: 620, height: 70, actionScores: [] },
    { hasPrompt: false, width: 760, height: 150, actionScores: [720] }
  ]), -1);
});

test("real EasyStore category field uses its wide facil input trigger when no pencil exists", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "easystore.js"), "utf8");
  assert.match(source, /function categoryInputTriggerCandidates\(label\)/);
  assert.match(source, /\.facil-input-text \.cursor-pointer/);
  assert.match(source, /rect\.width >= fieldRect\.width \* 0\.55/);
  assert.match(
    source,
    /const clickTarget = field\.inputTriggers\[0\] \|\| field\.editControls\[0\] \|\| field\.controls\[0\]/
  );
  assert.match(source, /找不到可點擊的分類輸入框或鉛筆按鈕/);
});

test("real EasyStore logistics rows use Element Plus switches without ARIA roles", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "easystore.js"), "utf8");
  assert.match(source, /"\.el-switch"/);
  assert.match(source, /classList\.contains\("is-checked"\)/);
  assert.match(source, /!control\.classList\.contains\("is-disabled"\)/);
});

test("full category prompts remain empty controls", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "easystore.js"), "utf8");
  assert.match(source, /"請先選擇分類"/);
  assert.match(source, /"選擇品牌"/);
});

test("brand gate uses the exact brand or approved NOBRAND aliases", () => {
  assert.deepEqual(helpers.approvedBrandOptions("Ibanez"), ["Ibanez"]);
  const noBrand = helpers.approvedBrandOptions("");
  assert.ok(noBrand.includes("NOBRAND"));
  assert.equal(helpers.exactApprovedMatch("No Brand", noBrand), true);
  assert.equal(helpers.exactApprovedMatch("Ibanez", noBrand), false);
  const source = fs.readFileSync(path.join(__dirname, "..", "easystore.js"), "utf8");
  assert.match(source, /const approvedBrands = helpers\.approvedBrandOptions\(payload\.brand\)/);
  assert.match(source, /setSearchInputValue\(control, desiredBrand\)/);
  assert.match(source, /const visibleBrandSelection = \(\) => Array\.from\(field\.container\.querySelectorAll/);
  assert.match(source, /appliedValue = selectedBrandValue\(\)/);
  assert.doesNotMatch(source, /setNativeValue\(control, desiredBrand\)/);
  assert.doesNotMatch(source, /addReport\(report, "skipped", "品牌", "待人工確認"\)/);
});

test("four category levels advance one option at a time before path verification", () => {
  const actions = [];
  const total = 4;
  for (let index = 0; index < total; index += 1) {
    actions.push(helpers.nextCategoryStage(index, total, true, false));
  }
  assert.deepEqual(actions, ["click-option", "click-option", "click-option", "click-option"]);
  assert.equal(helpers.nextCategoryStage(2, total, false, false), "wait-option");
  assert.equal(helpers.nextCategoryStage(total, total, false, false), "wait-application");
  assert.equal(helpers.nextCategoryStage(total, total, false, true), "complete");
});

function categoryOption(text, levelIndex, overrides) {
  return Object.assign({
    text,
    levelIndex,
    visible: true,
    inCategoryModal: true,
    inActiveColumn: true,
    disabled: false
  }, overrides);
}

function categoryColumn(levelIndex, overrides) {
  return Object.assign({
    levelIndex,
    visible: true,
    inCategoryModal: true,
    isListColumn: true,
    active: true,
    scrollTop: 0,
    clientHeight: 320,
    scrollHeight: 1200
  }, overrides);
}

test("category option search is exact and restricted to the visible active modal column", () => {
  const options = [
    categoryOption("樂器與樂器配件組合", 1),
    categoryOption("樂器與樂器配件", 0),
    categoryOption("樂器與樂器配件", 1, { visible: false }),
    categoryOption("樂器與樂器配件", 1, { inCategoryModal: false }),
    categoryOption("樂器與樂器配件", 1)
  ];
  assert.equal(helpers.exactVisibleCategoryOptionIndex(options, "樂器與樂器配件", 1), 4);
  assert.equal(helpers.exactVisibleCategoryOptionIndex(options, "樂器與樂器配件組", 1), -1);
  assert.equal(helpers.exactVisibleCategoryOptionIndex([
    categoryOption("弦樂器", 2),
    categoryOption("弦樂器", 2)
  ], "弦樂器", 2), -1);
  assert.equal(helpers.exactVisibleCategoryOptionIndex([
    categoryOption("愛好與收藏品", 0)
  ], "愛好與收藏品", null), -1);
});

test("category scrolling selects only one visible active list column inside the modal", () => {
  const candidates = [
    categoryColumn(2, { inCategoryModal: false }),
    categoryColumn(2, { visible: false }),
    categoryColumn(1),
    categoryColumn(2),
    categoryColumn(2, { isListColumn: false })
  ];
  assert.equal(helpers.safeCategoryScrollContainerIndex(candidates, 2), 3);
  assert.equal(helpers.safeCategoryScrollContainerIndex([
    categoryColumn(2),
    categoryColumn(2)
  ], 2), -1);
  assert.equal(helpers.safeCategoryScrollContainerIndex([
    categoryColumn(2, { active: false }),
    categoryColumn(2, { active: true })
  ], 2), 1);
  assert.equal(helpers.safeCategoryScrollContainerIndex([
    categoryColumn(2, { active: false })
  ], 2), -1);
});

test("independent vertical category columns do not get confused with the global horizontal rail", () => {
  const candidates = [
    categoryColumn(0, { active: false, scrollTop: 300 }),
    categoryColumn(1, { active: false, scrollTop: 120 }),
    categoryColumn(2, { active: true, scrollTop: 40 }),
    categoryColumn(2, {
      active: true,
      isListColumn: false,
      scrollTop: 0,
      clientHeight: 18,
      scrollHeight: 18,
      clientWidth: 700,
      scrollWidth: 1600
    })
  ];
  assert.equal(helpers.safeCategoryScrollContainerIndex(candidates, 2), 2);
  assert.equal(helpers.safeCategoryScrollContainerIndex([
    categoryColumn(2, {
      active: true,
      scrollTop: 0,
      clientHeight: 18,
      scrollHeight: 18,
      clientWidth: 700,
      scrollWidth: 1600
    })
  ], 2), -1);
});

test("category search scrolls downward in overlapping segments and stops at boundaries", () => {
  const first = helpers.planCategorySearchStep({
    levelIndex: 0,
    target: "愛好與收藏品",
    options: [],
    containers: [categoryColumn(0)],
    state: null
  });
  assert.equal(first.action, "scroll");
  assert.equal(first.reason, "scan-next-segment");
  assert.equal(first.scrollTop, 256);
  assert.equal(first.state.attempts, 1);

  const last = helpers.planCategorySearchStep({
    levelIndex: 0,
    target: "愛好與收藏品",
    options: [],
    containers: [categoryColumn(0, { scrollTop: 880 })],
    state: { levelIndex: 0, initialized: true, attempts: 4, lastObservedTop: 700 }
  });
  assert.equal(last.action, "stop");
  assert.equal(last.reason, "end-of-list");
});

test("an exact category option is selected before any scrolling is considered", () => {
  const selected = helpers.planCategorySearchStep({
    levelIndex: 2,
    target: "弦樂器",
    options: [categoryOption("弦樂器", 2)],
    containers: [],
    state: null
  });
  assert.equal(selected.action, "select");
  assert.equal(selected.reason, "exact-option");
  assert.equal(selected.optionIndex, 0);

  const invalid = helpers.planCategorySearchStep({
    levelIndex: null,
    target: "愛好與收藏品",
    options: [categoryOption("愛好與收藏品", 0)],
    containers: [categoryColumn(0)]
  });
  assert.equal(invalid.action, "stop");
  assert.equal(invalid.reason, "invalid-input");
});

test("category search stops when scrolling makes no progress or exceeds its bound", () => {
  const stalled = helpers.planCategorySearchStep({
    levelIndex: 3,
    target: "吉他、貝斯",
    options: [],
    containers: [categoryColumn(3, { scrollTop: 256 })],
    state: { levelIndex: 3, initialized: true, attempts: 1, lastObservedTop: 256 }
  });
  assert.equal(stalled.action, "stop");
  assert.equal(stalled.reason, "no-scroll-progress");

  const bounded = helpers.planCategorySearchStep({
    levelIndex: 3,
    target: "吉他、貝斯",
    options: [],
    containers: [categoryColumn(3, { scrollTop: 256 })],
    state: { levelIndex: 3, initialized: true, attempts: 3, lastObservedTop: 100 },
    maxAttempts: 3
  });
  assert.equal(bounded.action, "stop");
  assert.equal(bounded.reason, "attempt-limit");
});

test("each new category level resets its scroll state and returns to the top", () => {
  const previous = { levelIndex: 0, initialized: true, attempts: 7, lastObservedTop: 640 };
  assert.deepEqual(helpers.normalizeCategorySearchState(previous, 1), {
    levelIndex: 1,
    initialized: false,
    attempts: 0,
    lastObservedTop: null
  });
  const reset = helpers.planCategorySearchStep({
    levelIndex: 1,
    target: "樂器與樂器配件",
    options: [],
    containers: [categoryColumn(1, { scrollTop: 420 })],
    state: previous
  });
  assert.equal(reset.action, "scroll");
  assert.equal(reset.reason, "reset-level");
  assert.equal(reset.scrollTop, 0);
  assert.equal(reset.state.attempts, 0);

  const failedReset = helpers.planCategorySearchStep({
    levelIndex: 1,
    target: "樂器與樂器配件",
    options: [],
    containers: [categoryColumn(1, { scrollTop: 420 })],
    state: reset.state
  });
  assert.equal(failedReset.action, "stop");
  assert.equal(failedReset.reason, "no-scroll-progress");

  const afterSuccessfulReset = helpers.planCategorySearchStep({
    levelIndex: 1,
    target: "樂器與樂器配件",
    options: [],
    containers: [categoryColumn(1, { scrollTop: 0 })],
    state: reset.state
  });
  assert.equal(afterSuccessfulReset.action, "scroll");
  assert.equal(afterSuccessfulReset.reason, "scan-next-segment");
  assert.equal(afterSuccessfulReset.scrollTop, 256);
  assert.equal(afterSuccessfulReset.state.attempts, 1);
});

test("recognizes exact and compact compound Shopee sales-channel rows", () => {
  const approved = ["連接商品到蝦皮購物", "更新到蝦皮購物", "蝦皮購物"];
  assert.equal(helpers.shopeeEntryTextMatch("蝦皮購物", approved), true);
  assert.equal(
    helpers.shopeeEntryTextMatch("蝦皮購物  請先完成您的「蝦皮購物」設定。 刷新", approved),
    true
  );
  assert.equal(helpers.shopeeEntryTextMatch("更新到蝦皮購物｜已連線", approved), true);
  assert.equal(helpers.shopeeEntryTextMatch("蝦皮購物 已連線"), true);
  assert.equal(helpers.shopeeEntryTextMatch("發布商品到蝦皮購物"), true);
  assert.equal(helpers.shopeeEntryTextMatch("發佈商品到蝦皮購物｜尚未發布"), true);
});

test("Shopee entry matching rejects unrelated, reversed and page-sized text", () => {
  const approved = ["蝦皮購物"];
  assert.equal(helpers.shopeeEntryTextMatch("請到蝦皮購物完成設定", approved), false);
  assert.equal(helpers.shopeeEntryTextMatch("MOMO 與蝦皮購物均已連線", approved), false);
  assert.equal(helpers.shopeeEntryTextMatch("", approved), false);
  assert.equal(helpers.shopeeEntryTextMatch(`蝦皮購物${"商品管理與訂單資料".repeat(30)}`, approved), false);
  assert.equal(helpers.shopeeEntryTextMatch("蝦皮購物", []), false);
  assert.equal(helpers.shopeeEntryTextMatch("蝦皮購物", "蝦皮購物"), false);
});

test("accepts the production page bridge payload shape", () => {
  const now = 1_800_000_000_000;
  const result = helpers.validateQueuePayload(validPayload(now), now);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.value.nonce, "azes40-prb-00000001");
  assert.equal(result.value.attributes[0].label, "Neck Material");
  assert.equal(result.value.logistics.methods.find((row) => row.label === "新竹物流").option, "S170");
});

test("valid normalized payload can be validated again after extension storage", () => {
  const now = 1_800_000_000_000;
  const first = helpers.validateQueuePayload(validPayload(now), now);
  assert.equal(first.ok, true, first.errors.join("\n"));
  const second = helpers.validateQueuePayload(first.value, now);
  assert.equal(second.ok, true, second.errors.join("\n"));
});

test("AZES40 package total 162.6 cm maps only to approved S170 aliases", () => {
  assert.equal(helpers.hsinchuSizeBand(162.6), "S170");
  const aliases = helpers.logisticsOptionAliases("S170");
  assert.equal(helpers.exactApprovedMatch("S170", aliases), true);
  assert.equal(helpers.exactApprovedMatch("161～170 cm", aliases), true);
  assert.equal(helpers.exactApprovedMatch("170cm（含）以下", aliases), true);
  assert.equal(helpers.exactApprovedMatch("151-180cm", aliases), false);
  assert.equal(helpers.logisticsOptionMatch("161-170cm - (135 TWD)", aliases), true);
  assert.equal(helpers.logisticsOptionMatch("151-180cm - (135 TWD)", aliases), false);
});

test("Hsinchu tariff boundaries follow the approved 140/160/170 cm cutoffs", () => {
  assert.equal(helpers.hsinchuSizeBand(140), "S150");
  assert.equal(helpers.hsinchuSizeBand(140.1), "S160");
  assert.equal(helpers.hsinchuSizeBand(160), "S160");
  assert.equal(helpers.hsinchuSizeBand(160.1), "S170");
  assert.equal(helpers.hsinchuSizeBand(170), "S170");
  assert.equal(helpers.hsinchuSizeBand(170.1), "S180");
});

test("rejects expired, wrong-version, malformed SKU and unknown top-level fields", () => {
  const now = 1_800_000_000_000;
  const payload = validPayload(now);
  payload.schemaVersion = 1;
  payload.expiresAt = now - 1;
  payload.sku = "bad sku!";
  payload.unexpected = true;
  const result = helpers.validateQueuePayload(payload, now);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /schemaVersion/);
  assert.match(result.errors.join(" "), /過期/);
  assert.match(result.errors.join(" "), /sku/);
  assert.match(result.errors.join(" "), /unexpected/);
});

test("rejects EasyStore URL, logistics label and Hsinchu band mismatches", () => {
  const now = 1_800_000_000_000;
  const payload = validPayload(now);
  payload.easyStoreUrl = "https://admin.easystore.co/products/999";
  payload.logistics.methods.push({ label: "未知物流", enabled: true, option: "", sellerPays: false });
  payload.logistics.methods.find((row) => row.label === "新竹物流").option = "S180";
  const result = helpers.validateQueuePayload(payload, now);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /easyStoreUrl/);
  assert.match(result.errors.join(" "), /核准的物流名稱/);
  assert.match(result.errors.join(" "), /新竹物流級距/);
});

test("requires a complete and authoritative freight policy", () => {
  const now = 1_800_000_000_000;
  const missingMethod = validPayload(now);
  missingMethod.logistics.methods = missingMethod.logistics.methods.filter((row) => row.label !== "全家");
  const missingResult = helpers.validateQueuePayload(missingMethod, now);
  assert.equal(missingResult.ok, false);
  assert.match(missingResult.errors.join(" "), /缺少「全家」設定/);

  const wrongSellerFee = validPayload(now);
  wrongSellerFee.logistics.methods.find((row) => row.label.startsWith("賣家宅配")).feeTwd = 99;
  const wrongFeeResult = helpers.validateQueuePayload(wrongSellerFee, now);
  assert.equal(wrongFeeResult.ok, false);
  assert.match(wrongFeeResult.errors.join(" "), /固定收取 NT\$100/);

  const extraMethod = validPayload(now);
  extraMethod.logistics.methods.find((row) => row.label === "7-ELEVEN").enabled = true;
  const extraResult = helpers.validateQueuePayload(extraMethod, now);
  assert.equal(extraResult.ok, false);
  assert.match(extraResult.errors.join(" "), /不應開啟「7-ELEVEN」/);
});

test("requires the canonical EasyStore product URL and never trusts query or fragment variants", () => {
  const now = 1_800_000_000_000;
  const payload = validPayload(now);
  payload.easyStoreUrl = "https://admin.easystore.co/products/3969443?next=/settings#unsafe";
  const result = helpers.validateQueuePayload(payload, now);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /標準商品網址/);
  assert.equal(helpers.canonicalEasyStoreProductUrl("3969443"), "https://admin.easystore.co/products/3969443");
});

test("extracts product IDs from EasyStore sync and product URLs", () => {
  assert.deepEqual(
    helpers.extractProductIds("https://admin.easystore.co/channels/shopee/taiwan/products/sync?request_id=1&product_ids=3969443"),
    ["3969443"]
  );
  assert.deepEqual(helpers.extractProductIds("https://admin.easystore.co/products/3969443"), ["3969443"]);
  assert.deepEqual(
    helpers.extractProductIds("https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=16965067&account_id=11850&product_ids=4116442&request_id=139658"),
    ["16965067"]
  );
});

test("real EasyStore sync URL matches the queued store product, not Shopee's channel product id", () => {
  const now = 1_800_000_000_000;
  const storePayload = validPayload(now);
  storePayload.easyStoreProductId = "16965067";
  storePayload.easyStoreUrl = "https://admin.easystore.co/products/16965067";
  const channelPayload = validPayload(now);
  channelPayload.nonce = "channel-00000001";
  channelPayload.easyStoreProductId = "4116442";
  channelPayload.easyStoreUrl = "https://admin.easystore.co/products/4116442";
  const storeRecord = helpers.validateQueuePayload(storePayload, now).value;
  const channelRecord = helpers.validateQueuePayload(channelPayload, now).value;
  const queue = {
    "16965067": { payload: storeRecord, receivedAt: now },
    "4116442": { payload: channelRecord, receivedAt: now + 1 }
  };
  const url = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=16965067&account_id=11850&product_ids=4116442&request_id=139658";
  const selected = helpers.selectQueueRecord(queue, url, "賣家 SKU 1040160-1", now);
  assert.equal(selected.payload.easyStoreProductId, "16965067");
});

test("real Shopee sync form confirms its canonical store product before SKU and category render", () => {
  const now = 1_800_000_000_000;
  const payload = validPayload(now);
  payload.easyStoreProductId = "16965067";
  payload.easyStoreUrl = "https://admin.easystore.co/products/16965067";
  const validated = helpers.validateQueuePayload(payload, now).value;
  const url = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=16965067&account_id=11850&product_ids=4116442&request_id=140315";
  const initialText = "蝦皮購物 規格 分類 請先選擇分類 銷售資訊 請先選擇分類";

  assert.deepEqual(helpers.extractProductIds(url), ["16965067"]);
  assert.equal(helpers.resolveQueuePageIdentity(validated, url, initialText), "confirmed");
  assert.equal(
    helpers.selectQueueRecord({ "16965067": { payload: validated, receivedAt: now } }, url, initialText, now).payload.easyStoreProductId,
    "16965067"
  );
});

test("canonical store_product_ids wins over a newer queue record for Shopee's channel product id", () => {
  const now = 1_800_000_000_000;
  const storePayload = validPayload(now);
  storePayload.easyStoreProductId = "16965067";
  storePayload.easyStoreUrl = "https://admin.easystore.co/products/16965067";
  const channelPayload = validPayload(now);
  channelPayload.nonce = "channel-4116442-1";
  channelPayload.easyStoreProductId = "4116442";
  channelPayload.easyStoreUrl = "https://admin.easystore.co/products/4116442";
  const storeRecord = helpers.validateQueuePayload(storePayload, now).value;
  const channelRecord = helpers.validateQueuePayload(channelPayload, now).value;
  const queue = {
    "16965067": { payload: storeRecord, receivedAt: now },
    "4116442": { payload: channelRecord, receivedAt: now + 1000 }
  };
  const url = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=16965067&account_id=11850&product_ids=4116442&request_id=140315";

  assert.equal(helpers.resolveQueuePageIdentity(channelRecord, url, ""), "mismatch");
  assert.equal(helpers.selectQueueRecord(queue, url, "", now).payload.easyStoreProductId, "16965067");
});

test("queue page identity rejects wrong routes and waits for exact SKU on ambiguous or legacy sync URLs", () => {
  const now = 1_800_000_000_000;
  const payload = validPayload(now);
  payload.easyStoreProductId = "16965067";
  payload.easyStoreUrl = "https://admin.easystore.co/products/16965067";
  const validated = helpers.validateQueuePayload(payload, now).value;
  const exactSkuText = "商品名稱 Ibanez AZES40-PRB 賣家 SKU 1040160-1 價格 NT$14,800";
  const wrongSkuText = "商品名稱 Ibanez AZES40-PRB 賣家 SKU 1040160-10 價格 NT$14,800";
  const ambiguousUrl = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=16965067,16965068&product_ids=4116442";
  const legacyUrl = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?product_ids=16965067";

  assert.equal(helpers.resolveQueuePageIdentity(validated, "https://admin.easystore.co/products/16965067", ""), "confirmed");
  assert.equal(helpers.resolveQueuePageIdentity(validated, "https://admin.easystore.co/products/16965068", exactSkuText), "mismatch");
  assert.equal(
    helpers.resolveQueuePageIdentity(
      validated,
      "https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=16965068&product_ids=4116442",
      exactSkuText
    ),
    "mismatch"
  );
  assert.equal(
    helpers.resolveQueuePageIdentity(
      validated,
      "https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=16965067&product_ids=4116442",
      "賣家 SKU 1040160-10"
    ),
    "mismatch"
  );
  assert.equal(
    helpers.resolveQueuePageIdentity(
      validated,
      "https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=16965067,unsafe&product_ids=4116442",
      exactSkuText
    ),
    "mismatch"
  );
  assert.equal(helpers.resolveQueuePageIdentity(validated, ambiguousUrl, "請先選擇分類"), "pending");
  assert.equal(helpers.resolveQueuePageIdentity(validated, ambiguousUrl, wrongSkuText), "pending");
  assert.equal(helpers.resolveQueuePageIdentity(validated, ambiguousUrl, exactSkuText), "confirmed");
  assert.equal(helpers.resolveQueuePageIdentity(validated, legacyUrl, "請先選擇分類"), "pending");
  assert.equal(helpers.resolveQueuePageIdentity(validated, legacyUrl, wrongSkuText), "pending");
  assert.equal(helpers.resolveQueuePageIdentity(validated, legacyUrl, exactSkuText), "confirmed");
  assert.equal(helpers.resolveQueuePageIdentity(validated, "https://admin.easystore.co/settings?product_ids=16965067", exactSkuText), "mismatch");
  assert.equal(helpers.resolveQueuePageIdentity(validated, "https://example.com/products/16965067", exactSkuText), "mismatch");
});

test("selectQueueRecord only returns confirmed identities, never pending legacy or ambiguous sync forms", () => {
  const now = 1_800_000_000_000;
  const payload = validPayload(now);
  payload.easyStoreProductId = "16965067";
  payload.easyStoreUrl = "https://admin.easystore.co/products/16965067";
  const validated = helpers.validateQueuePayload(payload, now).value;
  const queue = { "16965067": { payload: validated, receivedAt: now } };
  const ambiguousUrl = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=16965067,16965068";
  const legacyUrl = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?product_ids=16965067";

  assert.equal(helpers.selectQueueRecord(queue, ambiguousUrl, "請先選擇分類", now), null);
  assert.equal(helpers.selectQueueRecord(queue, legacyUrl, "請先選擇分類", now), null);
  assert.ok(helpers.selectQueueRecord(queue, ambiguousUrl, "賣家 SKU 1040160-1", now));
  assert.ok(helpers.selectQueueRecord(queue, legacyUrl, "賣家 SKU 1040160-1", now));
});

test("recognizes a user-driven route change from product page to Shopee sync page", () => {
  const productUrl = "https://admin.easystore.co/products/3969443";
  const syncUrl = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?request_id=1&product_ids=3969443";
  assert.equal(helpers.easyStoreRouteKind(productUrl), "product");
  assert.equal(helpers.easyStoreRouteKind(syncUrl), "shopee-sync");
  assert.equal(helpers.shouldInspectQueue(productUrl, syncUrl), true);
  assert.equal(helpers.shouldInspectQueue(productUrl, "https://admin.easystore.co/settings"), false);
});

test("canonical product and explicit store_product_ids routes select without waiting for visible SKU", () => {
  const now = 1_800_000_000_000;
  const payload = helpers.validateQueuePayload(validPayload(now), now).value;
  const queue = { [payload.easyStoreProductId]: { payload, receivedAt: now } };
  const productUrl = "https://admin.easystore.co/products/3969443";
  const explicitUrl = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=3969443&account_id=11850&product_ids=4116442&request_id=140313";
  const legacyUrl = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?product_ids=3969443";
  assert.ok(helpers.selectQueueRecord(queue, productUrl, "商品名稱與介紹，畫面暫時沒有顯示 SKU", now));
  assert.equal(helpers.selectQueueRecord(queue, productUrl.replace("3969443", "3969444"), "", now), null);
  assert.ok(helpers.selectQueueRecord(queue, explicitUrl, "畫面尚未顯示 SKU", now));
  assert.equal(helpers.selectQueueRecord(queue, explicitUrl.replace("3969443", "3969444"), "SKU 1040160-1", now), null);
  assert.ok(helpers.selectQueueRecord(queue, legacyUrl, "賣家 SKU 1040160-1 價格 NT$14,800", now));
  assert.equal(helpers.selectQueueRecord(queue, legacyUrl, "畫面尚未顯示 SKU", now), null);
  assert.equal(helpers.selectQueueRecord(queue, legacyUrl, "賣家 SKU 1040160-10", now), null);
});

test("multi-product Shopee sync never trusts an ambiguous store_product_ids list", () => {
  const now = 1_800_000_000_000;
  const payload = helpers.validateQueuePayload(validPayload(now), now).value;
  const queue = { [payload.easyStoreProductId]: { payload, receivedAt: now } };
  const url = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=3969443,3969444";
  assert.equal(helpers.selectQueueRecord(queue, url, "畫面尚未顯示 SKU", now), null);
  assert.ok(helpers.selectQueueRecord(queue, url, "賣家 SKU 1040160-1", now));
});

test("uses reliable local handoff storage and prunes expired records before merging a fresh one", () => {
  assert.equal(helpers.QUEUE_STORAGE_AREA, "local");
  const now = 1_800_000_000_000;
  const stale = validPayload(now);
  stale.nonce = "stale-00000001";
  stale.easyStoreProductId = "999";
  stale.easyStoreUrl = "https://admin.easystore.co/products/999";
  stale.expiresAt = now - 1000;
  const fresh = helpers.validateQueuePayload(validPayload(now), now).value;
  const queue = helpers.pruneAndMergeQueue(
    { "999": { payload: stale, receivedAt: now - 5000 } },
    fresh,
    now,
    now
  );
  assert.deepEqual(Object.keys(queue), ["3969443"]);
});

test("product-page handoff survives EasyStore SPA navigation and final publish stays gated", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "easystore.js"), "utf8");
  assert.match(source, /chrome\.storage\[helpers\.QUEUE_STORAGE_AREA\]/);
  assert.match(source, /areaName === helpers\.QUEUE_STORAGE_AREA/);
  assert.doesNotMatch(source, /chrome\.storage\.session|areaName === ["']session["']/);
  assert.match(source, /mountProductNavigationOverlay/);
  assert.match(source, /開啟蝦皮設定/);
  assert.match(source, /shopeeSyncLinkForProduct/);
  assert.match(source, /helpers\.extractProductIds\(url\.href\)\.includes/);
  assert.match(source, /helpers\.shopeeEntryTextMatch\(actual, approved\)/);
  assert.match(source, /waitForShopeeNavigationTargets\(record, navigationOverlay, 10000\)/);
  assert.match(source, /productNavigationIsCurrent\(record, navigationOverlay\)/);
  assert.match(source, /\["store_product_id", "store_product_ids"\]/);
  assert.match(source, /new Set\(storeIds\)\.size === 1 && storeIds\[0\] === String\(record\.payload\.easyStoreProductId\)/);
  assert.match(source, /正在等待 EasyStore 載入蝦皮銷售管道/);
  assert.match(source, /SHOPEE_REFRESH_LABELS/);
  assert.match(source, /"發布商品到蝦皮購物"/);
  assert.match(source, /const allowGenericEntry = isShopeeRefreshTarget\(ignoredTarget\)/);
  assert.match(source, /isShopeeFollowupTarget\(record, target, allowGenericEntry\)/);
  assert.match(source, /for \(let step = 0; step < 4 && nextTarget/);
  assert.doesNotMatch(source, /attemptedTargetKeys/);
  assert.match(source, /openShopee\.disabled = false/);
  assert.match(source, /EasyStore 沒有轉到設定頁/);
  assert.match(source, /setInterval\([\s\S]*const nextUrl = location\.href/);
  assert.match(source, /helpers\.shouldInspectQueue\(previousUrl, nextUrl\)/);
  assert.match(source, /helpers\.resolveShopeeNavigationMode/);
  assert.match(source, /helpers\.autoPublishGate\(currentRecord\.payload, report, navigationMode\)/);
  assert.match(source, /helpers\.listingSafetyGate\(record\.payload, mode\)/);
  assert.match(source, /if \(mode !== "unknown"\) \{[\s\S]*helpers\.listingSafetyGate\(record\.payload, mode\)/);
  assert.doesNotMatch(source, /mode !== "unknown" \|\| isDirectSyncLink/);
  assert.match(source, /rememberShopeeNavigationMode/);
  assert.match(source, /findEnabledExactButton/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*start\.click\(\)/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*openShopee\.click\(\)/);
  assert.match(source, /publishToShopee/);
  assert.match(source, /helpers\.resolveQueuePageIdentity/);
  assert.match(source, /visibleSellerSkuObservation/);
  assert.match(source, /const identity = verifyIdentity\(payload\);[\s\S]*await fillCategory/);
  assert.match(source, /await fillCategory\(payload, report\);[\s\S]*await waitForVerifiedSellerSku\(payload, 5000\)/);
  assert.match(source, /report\.blockedStage = "category";[\s\S]*return report;/);
  assert.match(source, /report\.blockedStage = "brand";[\s\S]*return report;/);
  assert.match(source, /report\.blockedStage = "attributes";[\s\S]*return report;/);
  assert.match(source, /report\.blockedStage = "logistics";[\s\S]*return report;/);
  assert.match(source, /report\.blockedStage = "preorder";[\s\S]*return report;/);
  assert.match(source, /if \(report\.blockedStage\)[\s\S]*重新嘗試選擇分類[\s\S]*重新嘗試選擇品牌[\s\S]*重新嘗試填寫屬性[\s\S]*重新嘗試設定物流[\s\S]*重新嘗試設定預購/);
  assert.match(source, /helpers\.categoryActionScore/);
  assert.match(source, /categoryPathIsApplied/);
  assert.match(source, /async function publishToShopee[\s\S]*verifyIdentity\(payload, \{ requireSellerSku: true \}\)/);
  assert.doesNotMatch(source, /textContainsExactToken\(document\.body\.innerText/);
  assert.match(source, /report\.missing\.length > 0/);
  assert.match(source, /const state = await reconcileLogisticsToggle\(labels, method\.enabled === true\)/);
  assert.match(source, /const currentBand = controlDisplayValue\(bandControl\)/);
  assert.match(source, /logisticsOptionMatches\(currentBand, approvedOptions\)/);
  assert.match(source, /await reconcileLogisticsToggle\(labels, false\)/);
  assert.match(source, /setNativeValue\(feeControl, method\.feeTwd\)/);
  assert.match(source, /await reconcileSellerPays\(labels, method\.sellerPays === true/);
  assert.match(source, /if \(helpers\.exactApprovedMatch\(checkedText, approvedOptions\)\)[\s\S]*desiredRadio\.click\(\)/);
});

test("automatic publish is allowed only when the report and logistics are complete", () => {
  const payload = validPayload(1_800_000_000_000);
  assert.deepEqual(helpers.autoPublishGate(payload, { missing: [] }, "update"), { ok: true, reasons: [] });
  const missing = helpers.autoPublishGate(payload, { missing: ["分類"] }, "update");
  assert.equal(missing.ok, false);
  assert.match(missing.reasons.join(" "), /待補/);
  payload.logistics.requiresConfirmation = true;
  const logistics = helpers.autoPublishGate(payload, { missing: [] }, "update");
  assert.equal(logistics.ok, false);
  assert.match(logistics.reasons.join(" "), /物流/);
  payload.logistics.requiresConfirmation = false;
  payload.publishMode = "fill-only";
  const manual = helpers.autoPublishGate(payload, { missing: [] }, "update");
  assert.equal(manual.ok, false);
  assert.match(manual.reasons.join(" "), /人工確認/);
});

test("classifies update and create actions conservatively", () => {
  assert.equal(helpers.classifyShopeeActionText("重新同步到蝦皮"), "update");
  assert.equal(helpers.classifyShopeeActionText("Sync again"), "update");
  assert.equal(helpers.classifyShopeeActionText("連接商品到蝦皮購物 Shopee Taiwan"), "create");
  assert.equal(helpers.classifyShopeeActionText("發佈到蝦皮購物"), "create");
  assert.equal(helpers.classifyShopeeActionText("發布商品到蝦皮購物"), "create");
  assert.equal(helpers.classifyShopeeActionText("更新到蝦皮購物｜發佈到蝦皮購物"), "unknown");
  assert.equal(helpers.classifyShopeeActionText("蝦皮購物"), "unknown");
});

test("the v2 central platform id determines direct sync mode without a catalog search", () => {
  const existing = validPayload(1_800_000_000_000).listingPolicy;
  assert.equal(helpers.directSyncNavigationMode(existing), "update");

  const newDraft = validPayload(1_800_000_000_000).listingPolicy;
  newDraft.mode = "create-new";
  newDraft.identitySource = "new-draft";
  newDraft.platformListingIds = [];
  assert.equal(helpers.directSyncNavigationMode(newDraft), "create");

  assert.equal(helpers.resolveShopeeNavigationMode("發布商品到蝦皮購物", "unknown"), "create");
  assert.equal(helpers.resolveShopeeNavigationMode("發布商品到蝦皮購物", "update"), "conflict");
  assert.equal(helpers.resolveShopeeNavigationMode("重新同步到蝦皮", "update"), "update");
});

test("add-variant-to-existing survives schema validation and remains auto-publishable", () => {
  const now = 1_800_000_000_000;
  const payload = validPayload(now);
  payload.publishMode = "add-variant-to-existing";
  payload.listingPolicy.mode = "add-variant-to-existing";
  payload.variantGroup = {
    parentProductId: "parent-1",
    parentSku: "PARENT-100",
    parentName: "既有商品",
    attributeName: "顏色",
    parentAttributeValue: "黑色",
    attributeValue: "藍色",
    parentImageUrl: "https://example.com/parent-zh-tw.jpg",
    imageUrl: "https://example.com/blue-zh-tw.jpg"
  };
  const validated = helpers.validateQueuePayload(payload, now);
  assert.equal(validated.ok, true, validated.errors.join("\n"));
  assert.deepEqual(validated.value.variantGroup, payload.variantGroup);
  assert.equal(JSON.stringify(validated.value).includes("listingDecision"), false);
  assert.equal(JSON.stringify(validated.value).includes("onZero"), false);
  assert.deepEqual(helpers.autoPublishGate(validated.value, { missing: [] }, "unknown"), { ok: true, reasons: [] });
  assert.equal(helpers.autoPublishGate(validated.value, { missing: [] }, "create").ok, false);
});

test("v2 gate trusts the central id when page wording is unknown and blocks explicit contradictions", () => {
  const existing = validPayload(1_800_000_000_000);
  assert.deepEqual(helpers.listingSafetyGate(existing, "update"), { ok: true, reasons: [] });
  assert.deepEqual(helpers.listingSafetyGate(existing, "unknown"), { ok: true, reasons: [] });
  assert.deepEqual(helpers.autoPublishGate(existing, { missing: [] }, "unknown"), { ok: true, reasons: [] });
  assert.equal(helpers.listingSafetyGate(existing, "create").ok, false);
  assert.equal(helpers.autoPublishGate(existing, { missing: [] }, "create").ok, false);
  assert.match(helpers.listingSafetyGate(existing, "create").reasons.join(" "), /中央主檔已有/);
  assert.equal(helpers.listingSafetyGate(existing, "conflict").ok, false);

  existing.listingPolicy.platformListingIds = ["4116442", "4116443"];
  assert.equal(helpers.listingSafetyGate(existing, "update").ok, false);
  assert.match(helpers.listingSafetyGate(existing, "update").reasons.join(" "), /2 個蝦皮商品 ID/);
  const invalidExisting = helpers.validateQueuePayload(existing, 1_800_000_000_000);
  assert.equal(invalidExisting.ok, false);
  assert.match(invalidExisting.errors.join(" "), /必須且只能帶入一個/);

  const newListing = validPayload(1_800_000_000_000);
  newListing.listingPolicy.mode = "create-new";
  newListing.listingPolicy.identitySource = "new-draft";
  newListing.listingPolicy.platformListingIds = [];
  assert.equal(helpers.listingSafetyGate(newListing, "create").ok, true);
  assert.equal(helpers.listingSafetyGate(newListing, "unknown").ok, true);
  assert.deepEqual(helpers.autoPublishGate(newListing, { missing: [] }, "unknown"), { ok: true, reasons: [] });
  assert.equal(helpers.listingSafetyGate(newListing, "update").ok, false);
  assert.equal(helpers.autoPublishGate(newListing, { missing: [] }, "update").ok, false);
});

test("schema 4 and its legacy Shopee policy keys cannot enter the v2 queue", () => {
  const now = 1_800_000_000_000;
  const legacy = validPayload(now);
  legacy.schemaVersion = 4;
  legacy.listingPolicy = {
    decision: "existing",
    matchKey: "sku",
    allowCreate: false,
    existingListingIds: ["4116442"],
    onZero: "create-only-if-confirmed",
    onOne: "update",
    onMultiple: "block"
  };
  const result = helpers.validateQueuePayload(legacy, now);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /schemaVersion 必須是 5/);
  assert.match(result.errors.join(" "), /不支援的欄位：decision/);
  assert.equal(result.value, null);
});

test("rejects create-new when a central Shopee platform id is also present", () => {
  const now = 1_800_000_000_000;
  const payload = validPayload(now);
  payload.listingPolicy.mode = "create-new";
  payload.listingPolicy.identitySource = "new-draft";
  const result = helpers.validateQueuePayload(payload, now);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /建立新品時不可帶入/);
});

test("navigation mode remains attached to the exact queued product and nonce", () => {
  const now = 1_800_000_000_000;
  const payload = helpers.validateQueuePayload(validPayload(now), now).value;
  const queue = helpers.pruneAndMergeQueue({}, payload, now, now);
  const updated = helpers.withQueueNavigationMode(queue, payload.easyStoreProductId, payload.nonce, "update", now + 1);
  const selected = helpers.selectQueueRecord(
    updated,
    `https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=${payload.easyStoreProductId}`,
    `SKU ${payload.sku}`,
    now + 2
  );
  assert.equal(selected.navigationMode, "update");
  const unchanged = helpers.withQueueNavigationMode(updated, payload.easyStoreProductId, "wrong-nonce", "create", now + 3);
  assert.equal(unchanged[payload.easyStoreProductId].navigationMode, "update");
});
