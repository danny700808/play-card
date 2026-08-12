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

test("extension package no longer needs a background service worker for handoff", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"));
  const bridge = fs.readFileSync(path.join(extensionRoot, "bridge.js"), "utf8");
  const easystore = fs.readFileSync(path.join(extensionRoot, "easystore.js"), "utf8");

  assert.equal(manifest.version, "0.3.7");
  assert.equal(manifest.background, undefined);
  assert.match(bridge, /chrome\.storage\[helpers\.QUEUE_STORAGE_AREA\]/);
  assert.match(easystore, /chrome\.storage\[helpers\.QUEUE_STORAGE_AREA\]/);
  assert.doesNotMatch(bridge, /chrome\.storage\.session/);
  assert.doesNotMatch(easystore, /chrome\.storage\.session|areaName === ["']session["']/);
});
