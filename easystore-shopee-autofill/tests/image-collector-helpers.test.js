"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const helpers = require("../image-collector-helpers.js");

test("supplier and image URLs are restricted to approved Alibaba domains", () => {
  assert.equal(helpers.isSupplierPageUrl("https://item.taobao.com/item.htm?id=1"), true);
  assert.equal(helpers.isSupplierPageUrl("https://detail.1688.com/offer/1.html"), true);
  assert.equal(helpers.isSupplierPageUrl("https://example.com/item/1"), false);
  assert.equal(helpers.isAllowedImageUrl("https://img.alicdn.com/imgextra/a.jpg"), true);
  assert.equal(helpers.isAllowedImageUrl("https://evil-example.com/a.jpg"), false);
});

test("collector prefers the original Alibaba image and removes resize suffixes", () => {
  const selected = helpers.chooseImageUrl([
    "https://img.alicdn.com/imgextra/i1/demo.jpg_430x430q90.jpg",
    "https://img.alicdn.com/imgextra/i1/thumb.jpg"
  ], "https://item.taobao.com/item.htm?id=1");
  assert.equal(selected, "https://img.alicdn.com/imgextra/i1/demo.jpg");
});

test("collector session is bound to one product and at most 12 images", () => {
  const now = Date.now();
  const validation = helpers.normalizeSessionPayload({
    sessionId: "youzi-img-1234567890",
    productId: "catalog-product-1",
    sku: "1040160-1",
    easyStoreProductId: "16965067",
    title: "IBANEZ AZES40",
    maxImages: 99,
    currentCount: 3,
    startedAt: now,
    expiresAt: now + 60_000,
    active: true
  }, now);
  assert.equal(validation.ok, true);
  assert.equal(validation.value.productId, "catalog-product-1");
  assert.equal(validation.value.maxImages, 12);
  assert.equal(validation.value.currentCount, 3);
  assert.equal(validation.value.active, true);
});

test("full collector session stops automatically", () => {
  const now = Date.now();
  const validation = helpers.normalizeSessionPayload({
    sessionId: "youzi-img-1234567890",
    productId: "catalog-product-1",
    sku: "1040160-1",
    maxImages: 12,
    currentCount: 12,
    startedAt: now,
    expiresAt: now + 60_000,
    active: true
  }, now);
  assert.equal(validation.ok, true);
  assert.equal(validation.value.active, false);
});
