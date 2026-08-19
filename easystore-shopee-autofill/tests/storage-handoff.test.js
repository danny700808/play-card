"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.join(__dirname, "..");

test("bridge writes the validated queue to shared local storage and acknowledges it", () => {
  const origin = "https://danny700808.github.io";
  const listeners = {};
  const acknowledgements = [];
  const storageCalls = [];
  let stored = {};
  const payload = {
    nonce: "azes40-prb-00000001",
    sku: "1040160-1",
    easyStoreProductId: "16965067",
    expiresAt: 1_800_000_600_000
  };
  const local = {
    get(key, callback) {
      storageCalls.push(["get", key]);
      callback(stored);
    },
    set(value, callback) {
      storageCalls.push(["set", value]);
      stored = Object.assign({}, stored, value);
      callback();
    }
  };
  const storage = { local };
  Object.defineProperty(storage, "session", {
    get() {
      throw new Error("bridge must not depend on session storage");
    }
  });
  const sandbox = {
    location: { origin },
    chrome: { storage, runtime: { lastError: null } },
    YouziShopeeAutofillHelpers: {
      QUEUE_STORAGE_AREA: "local",
      QUEUE_STORAGE_KEY: "youziShopeeAutofillQueueV1",
      validateQueuePayload(value) {
        return { ok: true, errors: [], value };
      },
      pruneAndMergeQueue(current, value, receivedAt) {
        return {
          [value.easyStoreProductId]: { payload: value, receivedAt }
        };
      }
    },
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    postMessage(message, targetOrigin) {
      acknowledgements.push({ message, targetOrigin });
    },
    __listeners: listeners,
    __payload: payload
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(extensionRoot, "bridge.js"), "utf8");
  vm.runInContext(source, context, { filename: "bridge.js" });

  assert.equal(typeof listeners.message, "function");
  vm.runInContext(`__listeners.message({
    source: window,
    origin: location.origin,
    data: {
      source: "youzi-operations-hub",
      type: "YOUZI_SHOPEE_AUTOFILL_QUEUE",
      payload: __payload
    }
  })`, context);

  assert.deepEqual(storageCalls.map((row) => row[0]), ["get", "set"]);
  assert.equal(stored.youziShopeeAutofillQueueV1["16965067"].payload.sku, "1040160-1");
  assert.equal(acknowledgements.length, 1);
  assert.equal(acknowledgements[0].targetOrigin, origin);
  assert.equal(acknowledgements[0].message.ok, true);
  assert.equal(acknowledgements[0].message.code, "QUEUED");
});

test("bridge stores one product-bound image collection session", () => {
  const origin = "https://danny700808.github.io";
  const listeners = {};
  const acknowledgements = [];
  let stored = {};
  const local = {
    get(key, callback) { callback(stored); },
    set(value, callback) { stored = Object.assign({}, stored, value); callback(); },
    remove(key, callback) { delete stored[key]; callback(); }
  };
  const session = {
    sessionId: "youzi-img-1234567890",
    productId: "catalog-product-1",
    sku: "1040160-1",
    easyStoreProductId: "16965067",
    title: "IBANEZ AZES40",
    maxImages: 12,
    currentCount: 2,
    startedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    active: true
  };
  const sandbox = {
    location: { origin },
    chrome: { storage: { local }, runtime: { lastError: null } },
    YouziShopeeAutofillHelpers: {
      QUEUE_STORAGE_AREA: "local",
      QUEUE_STORAGE_KEY: "youziShopeeAutofillQueueV1"
    },
    YouziImageCollectorHelpers: Object.assign(
      {},
      require("../image-collector-helpers.js"),
      { normalizeSessionPayload() { return { ok: true, errors: [], value: session }; } }
    ),
    addEventListener(type, listener) { listeners[type] = listener; },
    postMessage(message, targetOrigin) { acknowledgements.push({ message, targetOrigin }); },
    __listeners: listeners,
    __session: session
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(extensionRoot, "bridge.js"), "utf8");
  vm.runInContext(source, context, { filename: "bridge.js" });

  vm.runInContext(`__listeners.message({
    source: window,
    origin: location.origin,
    data: {
      source: "youzi-operations-hub",
      type: "YOUZI_IMAGE_COLLECTION_START",
      payload: __session
    }
  })`, context);

  assert.equal(stored.youziProductImageCollectionSessionV1.productId, "catalog-product-1");
  const ack = acknowledgements.find((entry) => entry.message.type === "YOUZI_IMAGE_COLLECTION_SESSION_ACK");
  assert.ok(ack);
  assert.equal(ack.message.payload.ok, true);
  assert.equal(ack.message.payload.sku, "1040160-1");

  vm.runInContext(`__listeners.message({
    source: window,
    origin: location.origin,
    data: {
      source: "youzi-operations-hub",
      type: "YOUZI_IMAGE_COLLECTION_STATE_REQUEST",
      payload: {}
    }
  })`, context);
  const restored = acknowledgements.find((entry) =>
    entry.message.type === "YOUZI_IMAGE_COLLECTION_SESSION_STATE"
  );
  assert.ok(restored);
  assert.equal(restored.message.payload.session.sessionId, session.sessionId);
  assert.equal(restored.message.payload.session.productId, session.productId);
});

test("extension package enables the supplier image collector service worker", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));
  const bridge = fs.readFileSync(path.join(extensionRoot, "bridge.js"), "utf8");
  const easystore = fs.readFileSync(path.join(extensionRoot, "easystore.js"), "utf8");

  assert.equal(manifest.version, "0.3.19");
  assert.equal(manifest.background.service_worker, "background.js");
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.ok(manifest.permissions.includes("contextMenus"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.host_permissions.includes("https://*.taobao.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.1688.com/*"));
  assert.ok(manifest.content_scripts.some((entry) =>
    entry.js.includes("supplier-collector.js") && entry.js.includes("image-collector-helpers.js")
  ));
  assert.match(bridge, /chrome\.storage\[helpers\.QUEUE_STORAGE_AREA\]/);
  assert.match(easystore, /chrome\.storage\[helpers\.QUEUE_STORAGE_AREA\]/);
  assert.doesNotMatch(bridge, /chrome\.storage\.session/);
  assert.doesNotMatch(easystore, /chrome\.storage\.session|areaName === ["']session["']/);
});
