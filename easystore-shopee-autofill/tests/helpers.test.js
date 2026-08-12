"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const helpers = require("../helpers.js");

function validPayload(now) {
  return {
    schemaVersion: 2,
    nonce: "azes40-prb-00000001",
    createdAt: now,
    expiresAt: now + 10 * 60 * 1000,
    productId: "catalog-azes40-prb",
    easyStoreProductId: "3969443",
    easyStoreUrl: "https://admin.easystore.co/products/3969443",
    sku: "1040160-1",
    title: "Ibanez AZES40-PRB AZ Essentials 電吉他－馬卡藍",
    publishMode: "auto",
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
        { label: "黑貓宅急便", enabled: false, option: "", sellerPays: false },
        { label: "蝦皮店到店", enabled: false, option: "", sellerPays: false },
        { label: "7-ELEVEN", enabled: false, option: "", sellerPays: false },
        { label: "新竹物流", enabled: true, option: "S170", sellerPays: false },
        { label: "全家", enabled: false, option: "", sellerPays: false }
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

test("accepts the production page bridge payload shape", () => {
  const now = 1_800_000_000_000;
  const result = helpers.validateQueuePayload(validPayload(now), now);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.value.nonce, "azes40-prb-00000001");
  assert.equal(result.value.attributes[0].label, "Neck Material");
  assert.equal(result.value.logistics.methods.find((row) => row.label === "新竹物流").option, "S170");
});

test("valid normalized payload can be validated again after session storage", () => {
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
});

test("recognizes a user-driven route change from product page to Shopee sync page", () => {
  const productUrl = "https://admin.easystore.co/products/3969443";
  const syncUrl = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?request_id=1&product_ids=3969443";
  assert.equal(helpers.easyStoreRouteKind(productUrl), "product");
  assert.equal(helpers.easyStoreRouteKind(syncUrl), "shopee-sync");
  assert.equal(helpers.shouldInspectQueue(productUrl, syncUrl), true);
  assert.equal(helpers.shouldInspectQueue(productUrl, "https://admin.easystore.co/settings"), false);
});

test("requires both exact EasyStore product ID and exact SKU token", () => {
  const now = 1_800_000_000_000;
  const payload = helpers.validateQueuePayload(validPayload(now), now).value;
  const queue = { [payload.easyStoreProductId]: { payload, receivedAt: now } };
  const url = "https://admin.easystore.co/channels/shopee/taiwan/products/sync?product_ids=3969443";
  assert.ok(helpers.selectQueueRecord(queue, url, "賣家 SKU 1040160-1 價格 NT$14,800", now));
  assert.equal(helpers.selectQueueRecord(queue, url, "賣家 SKU 1040160-10", now), null);
  assert.equal(helpers.selectQueueRecord(queue, url.replace("3969443", "3969444"), "SKU 1040160-1", now), null);
});

test("prunes expired session records before merging a fresh one", () => {
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
  assert.match(source, /mountProductNavigationOverlay/);
  assert.match(source, /開啟蝦皮設定/);
  assert.match(source, /shopeeSyncLinkForProduct/);
  assert.match(source, /helpers\.extractProductIds\(url\.href\)\.includes/);
  assert.match(source, /openShopee\.disabled = false/);
  assert.match(source, /EasyStore 沒有轉到設定頁/);
  assert.match(source, /setInterval\([\s\S]*const nextUrl = location\.href/);
  assert.match(source, /helpers\.shouldInspectQueue\(previousUrl, nextUrl\)/);
  assert.match(source, /helpers\.autoPublishGate\(payload, report\)/);
  assert.match(source, /findEnabledExactButton/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*start\.click\(\)/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*openShopee\.click\(\)/);
  assert.match(source, /publishToShopee/);
  assert.match(source, /report\.missing\.length > 0/);
});

test("automatic publish is allowed only when the report and logistics are complete", () => {
  const payload = validPayload(1_800_000_000_000);
  assert.deepEqual(helpers.autoPublishGate(payload, { missing: [] }), { ok: true, reasons: [] });
  const missing = helpers.autoPublishGate(payload, { missing: ["分類"] });
  assert.equal(missing.ok, false);
  assert.match(missing.reasons.join(" "), /待補/);
  payload.logistics.requiresConfirmation = true;
  const logistics = helpers.autoPublishGate(payload, { missing: [] });
  assert.equal(logistics.ok, false);
  assert.match(logistics.reasons.join(" "), /物流/);
  payload.logistics.requiresConfirmation = false;
  payload.publishMode = "fill-only";
  const manual = helpers.autoPublishGate(payload, { missing: [] });
  assert.equal(manual.ok, false);
  assert.match(manual.reasons.join(" "), /人工確認/);
});
