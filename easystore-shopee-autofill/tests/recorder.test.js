"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const recorder = require("../recorder.js");

const extensionRoot = path.join(__dirname, "..");

test("live recorder sanitizes URLs and never exports credentials or unknown query values", () => {
  assert.equal(recorder.FORMAT, "youzi-easystore-live-check-v1");
  assert.equal(
    recorder.sanitizeUrlForExport(
      "https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=16965067&account_id=11850&product_ids=4116442&request_id=140430&token=secret#private"
    ),
    "https://admin.easystore.co/channels/shopee/taiwan/products/sync?store_product_ids=16965067&account_id=11850&product_ids=4116442&request_id=140430"
  );
  assert.equal(
    recorder.sanitizeUrlForExport("https://user:password@example.com/path?password=secret#token"),
    "https://example.com/path"
  );
  assert.equal(recorder.sanitizeUrlForExport("not a url"), "");
});

test("live recorder normalizes bounded diagnostic labels", () => {
  assert.equal(recorder.normalizeDiagnosticText("  Edit\n category  "), "Edit category");
  assert.equal(recorder.normalizeDiagnosticText("ＡＢＣ", 10), "ABC");
  assert.equal(recorder.normalizeDiagnosticText("123456789", 5), "1234…");
});

test("manifest loads the always-available recorder before autofill automation", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));
  const easyStoreScriptGroup = manifest.content_scripts.find((row) =>
    row.matches.some((value) => value.includes("admin.easystore.co"))
  );
  assert.deepEqual(easyStoreScriptGroup.js, ["helpers.js", "recorder.js", "easystore.js"]);

  const source = fs.readFileSync(path.join(extensionRoot, "recorder.js"), "utf8");
  assert.match(source, /開始實機記錄/);
  assert.match(source, /完成並下載檢查檔/);
  assert.match(source, /不記錄帳密、Cookie 或文字輸入內容/);
  assert.doesNotMatch(source, /document\.cookie|localStorage|sessionStorage/);
  assert.doesNotMatch(source, /\.value\b/);
});
