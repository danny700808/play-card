"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const operationsSource = fs.readFileSync("operations-phase1.js", "utf8");
const manifest = JSON.parse(fs.readFileSync("easystore-shopee-autofill/manifest.json", "utf8"));
const supplierCollector = fs.readFileSync("easystore-shopee-autofill/supplier-collector.js", "utf8");
const background = fs.readFileSync("easystore-shopee-autofill/background.js", "utf8");

test("準備上架提供指定商品的開始收圖入口", () => {
  assert.match(operationsSource, /data-action="product-image-collection-toggle"/);
  assert.match(operationsSource, /從淘寶／阿里巴巴框選截圖/);
  assert.match(operationsSource, /PRODUCT_IMAGE_COLLECTION\.maxImages/);
  assert.doesNotMatch(operationsSource, /<label>商品網址<\/label>/);
});

test("供應商頁以框選截圖為主且不會預設攔截商品頁點擊", () => {
  assert.match(supplierCollector, /柚子掌櫃：框選截圖/);
  assert.match(supplierCollector, /directPickEnabled = false/);
  assert.match(supplierCollector, /helpers\.CAPTURE_MESSAGE/);
  assert.match(supplierCollector, /document\.addEventListener\("paste"/);
  assert.match(background, /chrome\.tabs\.captureVisibleTab/);
  assert.match(background, /imageCollector\.CAPTURE_DATA_MESSAGE/);
  assert.match(background, /chrome\.contextMenus\.onClicked/);
});

test("截錯的來源圖片可從目前商品直接刪除", () => {
  assert.match(operationsSource, /data-action="product-source-image-remove"/);
  assert.match(operationsSource, /async function removeProductReferenceImage/);
  assert.match(operationsSource, /已從這件準備上架商品移除/);
});

test("收圖檔案沿用既有 Firebase 圖片上傳並綁定目前商品", () => {
  assert.match(operationsSource, /productId!==productImageCollectionSession\.productId/);
  assert.match(operationsSource, /uploadProductReferenceImages\(form,\[collectedImageFile\(payload\)\]\)/);
  assert.match(operationsSource, /每個商品最多保留 12 張來源圖片/);
});

test("Chrome 助手只在核准的供應商與圖片網域執行", () => {
  assert.equal(manifest.version, "0.3.17");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.ok(manifest.permissions.includes("contextMenus"));
  assert.ok(manifest.host_permissions.includes("https://*.taobao.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.1688.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.alibaba.com/*"));
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false);
  assert.equal(manifest.commands["start-image-crop"].suggested_key.default, "Ctrl+Shift+Y");
});
