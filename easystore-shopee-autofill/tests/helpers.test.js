"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const helpers = require("../helpers.js");

function validPayload(now) {
  return {
    schemaVersion: 4,
    nonce: "azes40-prb-00000001",
    createdAt: now,
    expiresAt: now + 10 * 60 * 1000,
    productId: "catalog-azes40-prb",
    easyStoreProductId: "3969443",
    easyStoreUrl: "https://admin.easystore.co/products/3969443",
    sku: "1040160-1",
    title: "Ibanez AZES40-PRB AZ Essentials 電吉他－馬卡藍",
    publishMode: "auto",
    listingPolicy: {
      decision: "auto",
      matchKey: "sku",
      allowCreate: false,
      existingListingIds: [],
      onZero: "create-only-if-confirmed",
      onOne: "update",
      onMultiple: "block"
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

test("recognizes exact and compact compound Shopee sales-channel rows", () => {
  const approved = ["連接商品到蝦皮購物", "更新到蝦皮購物", "蝦皮購物"];
  assert.equal(helpers.shopeeEntryTextMatch("蝦皮購物", approved), true);
  assert.equal(
    helpers.shopeeEntryTextMatch("蝦皮購物  請先完成您的「蝦皮購物」設定。 刷新", approved),
    true
  );
  assert.equal(helpers.shopeeEntryTextMatch("更新到蝦皮購物｜已連線", approved), true);
  assert.equal(helpers.shopeeEntryTextMatch("蝦皮購物 已連線"), true);
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

test("a direct sync URL never becomes update solely because an old listing id is stored", () => {
  const existing = validPayload(1_800_000_000_000).listingPolicy;
  existing.decision = "existing";
  existing.existingListingIds = ["4116442"];
  assert.equal(helpers.directSyncNavigationMode(existing), "unknown");

  const confirmedNew = validPayload(1_800_000_000_000).listingPolicy;
  confirmedNew.decision = "new";
  confirmedNew.allowCreate = true;
  assert.equal(helpers.directSyncNavigationMode(confirmedNew), "create");

  assert.equal(helpers.resolveShopeeNavigationMode("發布商品到蝦皮購物", "unknown"), "create");
  assert.equal(helpers.resolveShopeeNavigationMode("發布商品到蝦皮購物", "update"), "unknown");
  assert.equal(helpers.resolveShopeeNavigationMode("重新同步到蝦皮", "update"), "update");
});

test("duplicate guard permits updates but requires explicit confirmation before creation", () => {
  const auto = validPayload(1_800_000_000_000);
  assert.deepEqual(helpers.listingSafetyGate(auto, "update"), { ok: true, reasons: [] });
  assert.equal(helpers.listingSafetyGate(auto, "create").ok, false);
  assert.match(helpers.listingSafetyGate(auto, "create").reasons.join(" "), /不能建立新品/);
  assert.equal(helpers.listingSafetyGate(auto, "unknown").ok, false);
  assert.match(helpers.listingSafetyGate(auto, "unknown").reasons.join(" "), /無法確認/);

  const existing = validPayload(1_800_000_000_000);
  existing.listingPolicy.decision = "existing";
  existing.listingPolicy.existingListingIds = ["4116442"];
  assert.equal(helpers.listingSafetyGate(existing, "create").ok, false);
  assert.match(helpers.listingSafetyGate(existing, "create").reasons.join(" "), /Match product/);
  assert.equal(helpers.listingSafetyGate(existing, "update").ok, true);

  existing.listingPolicy.existingListingIds = ["4116442", "4116443"];
  assert.equal(helpers.listingSafetyGate(existing, "update").ok, false);
  assert.match(helpers.listingSafetyGate(existing, "update").reasons.join(" "), /2 個蝦皮商品/);

  const newListing = validPayload(1_800_000_000_000);
  newListing.listingPolicy.decision = "new";
  newListing.listingPolicy.allowCreate = true;
  assert.equal(helpers.listingSafetyGate(newListing, "create").ok, true);

  newListing.listingPolicy.existingListingIds = ["4116442"];
  assert.equal(helpers.listingSafetyGate(newListing, "create").ok, false);
  assert.match(helpers.listingSafetyGate(newListing, "create").reasons.join(" "), /不能建立新品/);
});

test("rejects a create decision that also claims an existing Shopee listing", () => {
  const now = 1_800_000_000_000;
  const payload = validPayload(now);
  payload.listingPolicy.decision = "new";
  payload.listingPolicy.allowCreate = true;
  payload.listingPolicy.existingListingIds = ["4116442"];
  const result = helpers.validateQueuePayload(payload, now);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /必須是 existing/);
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
