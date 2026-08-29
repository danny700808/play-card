"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const extensionRoot = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(extensionRoot, "background.js"), "utf8");

function backgroundHarness(overrides = {}) {
  let messageListener = null;
  let captureCalls = 0;
  const activeTabs = overrides.activeTabs || [{ id: 7, active: true, windowId: 2 }];
  const chrome = {
    runtime: { onMessage: { addListener(listener) { messageListener = listener; } } },
    tabs: {
      query: async () => activeTabs,
      captureVisibleTab: async () => {
        captureCalls += 1;
        if (overrides.captureError) throw new Error(overrides.captureError);
        return "data:image/png;base64,AAAA";
      },
      sendMessage: async () => ({ ok: true }),
      get: async () => null,
      create: async () => null
    },
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener() {} }
    },
    scripting: { executeScript: async () => {} },
    action: { onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } }
  };
  const helpers = {
    OPERATIONS_ORIGIN: "https://danny700808.github.io",
    SESSION_STORAGE_KEY: "session",
    BIND_OPERATIONS_TAB_MESSAGE: "BIND",
    CAPTURE_MESSAGE: "CAPTURE",
    FETCH_MESSAGE: "FETCH",
    CAPTURE_DATA_MESSAGE: "CAPTURE_DATA",
    START_CROP_MESSAGE: "START_CROP",
    COLLECTOR_PING_MESSAGE: "PING",
    DELIVER_MESSAGE: "DELIVER",
    MAX_IMAGE_BYTES: 8 * 1024 * 1024,
    isCollectablePageUrl(value) { return /^https?:\/\//.test(String(value)); },
    normalizeSessionPayload() { return { ok: false, value: null }; }
  };
  const sandbox = {
    chrome,
    importScripts() {},
    YouziImageCollectorHelpers: helpers,
    URL, AbortController, setTimeout, clearTimeout,
    btoa(value) { return Buffer.from(value, "binary").toString("base64"); },
    crypto: { randomUUID() { return "request-id"; } },
    console
  };
  sandbox.globalThis = sandbox;
  vm.runInContext(source, vm.createContext(sandbox), { filename: "background.js" });
  return {
    captureCalls: () => captureCalls,
    async capture(sender = { tab: { id: 7, active: true, windowId: 2, url: "https://shop.example/item" } }) {
      return new Promise((resolve) => {
        const keepAlive = messageListener({ type: "CAPTURE" }, sender, resolve);
        assert.equal(keepAlive, true);
      });
    }
  };
}

test("content-panel capture succeeds with an active matching tab", async () => {
  const harness = backgroundHarness();
  const result = await harness.capture();
  assert.equal(result.ok, true);
  assert.equal(result.dataUrl, "data:image/png;base64,AAAA");
  assert.equal(harness.captureCalls(), 1);
});

test("Chrome permission error is translated to an actionable Chinese response", async () => {
  const harness = backgroundHarness({ captureError: "Either the '<all_urls>' or activeTab permission is required." });
  const result = await harness.capture();
  assert.equal(result.ok, false);
  assert.equal(result.code, "CAPTURE_PERMISSION_MISSING");
  assert.match(result.error, /0\.3\.32/);
  assert.doesNotMatch(result.error, /Either the/);
});

test("capture refuses a stale sender after the user switches tabs", async () => {
  const harness = backgroundHarness({ activeTabs: [{ id: 8, active: true, windowId: 2 }] });
  const result = await harness.capture();
  assert.equal(result.ok, false);
  assert.equal(result.code, "IMAGE_PAGE_NOT_ACTIVE");
  assert.equal(harness.captureCalls(), 0);
});
