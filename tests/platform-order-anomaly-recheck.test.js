'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../operations-platform-order-anomalies-utils-v1.js');
const diagnostics = require('../operations-platform-order-anomalies-diagnostics-v1.js');
const inventory = require('../operations-platform-order-anomalies-inventory-v1.js');
const recheckOne = require('../operations-platform-order-anomalies-recheck-one-v1.js');
const recheckService = require('../operations-platform-order-anomalies-recheck-service-v1.js');
const anomaly = {
  ...utils,
  ...diagnostics,
  ...inventory,
  ...recheckService,
  _test: {
    productFallbackUnitCost: inventory.productFallbackUnitCost,
    orderHasFulfillmentEvidence: inventory.orderHasFulfillmentEvidence,
    recheckOrderWithContext: recheckOne.recheckOrderWithContext
  }
};


function makeMemoryDb(seed) {
  const store = new Map(Object.entries(seed || {}).map(([path, value]) => [path, structuredClone(value)]));

  class Snapshot {
    constructor(ref, value) {
      this.ref = ref;
      this.id = ref.id;
      this.exists = value !== undefined;
      this._value = value;
    }
    data() {
      return this.exists ? structuredClone(this._value) : undefined;
    }
  }

  class DocRef {
    constructor(path) {
      this.path = path;
      this.id = path.split('/').pop();
    }
    async get() {
      return new Snapshot(this, store.get(this.path));
    }
    async set(value, options) {
      const current = store.get(this.path) || {};
      store.set(this.path, options && options.merge ? { ...current, ...structuredClone(value) } : structuredClone(value));
    }
  }

  const db = {
    collection(name) {
      return {
        doc(id) {
          if (!id) throw new Error('test DB requires an explicit document ID');
          return new DocRef(`${name}/${id}`);
        }
      };
    },
    async runTransaction(callback) {
      const transaction = {
        get(ref) {
          return ref.get();
        },
        set(ref, value, options) {
          const current = store.get(ref.path) || {};
          store.set(ref.path, options && options.merge ? { ...current, ...structuredClone(value) } : structuredClone(value));
        }
      };
      return callback(transaction);
    },
    _get(path) {
      return structuredClone(store.get(path));
    }
  };
  return db;
}

test('normalizeSku trims spreadsheet apostrophes, spaces, and case', () => {
  assert.equal(anomaly.normalizeSku("  'ab-123\u00a0 "), 'AB-123');
  assert.equal(anomaly.normalizeSku(null), '');
});

test('classifyOrder distinguishes missing, unmatched, duplicate, and unique SKU', () => {
  const products = [
    { id: 'p1', internalSku: 'SKU-1', internalName: '商品一' },
    { id: 'p2', internalSku: 'SKU-2', internalName: '商品二' },
    { id: 'p3', internalSku: 'sku-2', internalName: '商品三' }
  ];
  const map = anomaly.buildProductMap(products);

  assert.equal(anomaly.classifyOrder({ sku: '' }, map).status, 'missing-sku');
  assert.equal(anomaly.classifyOrder({ sku: 'SKU-X' }, map).status, 'unmatched-sku');
  assert.equal(anomaly.classifyOrder({ sku: 'sku-2' }, map).status, 'duplicate-sku');
  const unique = anomaly.classifyOrder({ sku: 'sku-1' }, map);
  assert.equal(unique.status, 'matched');
  assert.equal(unique.product.id, 'p1');
});

test('issueInfo explains exactly how to repair unmatched and duplicate SKU', () => {
  const products = [
    { id: 'p1', internalSku: 'A100', internalName: '節拍器' },
    { id: 'p2', internalSku: 'DUP', internalName: '商品甲' },
    { id: 'p3', internalSku: 'DUP', internalName: '商品乙' }
  ];
  const map = anomaly.buildProductMap(products);

  const unmatched = anomaly.issueInfo({
    processingStatus: 'unmatched-sku',
    sku: 'X999',
    platform: 'MOMO',
    productName: '譜架'
  }, map);
  assert.match(unmatched.reason, /X999/);
  assert.match(unmatched.fix, /商品資訊/);
  assert.equal(unmatched.readyNow, false);

  const duplicate = anomaly.issueInfo({
    processingStatus: 'duplicate-sku',
    sku: 'DUP',
    platform: 'EasyStore',
    productName: '商品'
  }, map);
  assert.match(duplicate.reason, /2 筆商品/);
  assert.match(duplicate.fix, /只保留一筆/);
});

test('issueInfo marks an old anomaly ready when the latest master now has one match', () => {
  const map = anomaly.buildProductMap([
    { id: 'p1', internalSku: 'FIXED-1', internalName: '已修正商品' }
  ]);
  const info = anomaly.issueInfo({
    processingStatus: 'unmatched-sku',
    sku: 'fixed-1',
    platform: 'Coupang',
    productName: '測試商品'
  }, map);
  assert.equal(info.readyNow, true);
  assert.equal(info.severity, 'ready');
  assert.match(info.reason, /已找到唯一對應/);
});

test('consumeFifoAllowNegative preserves FIFO cost and allows negative stock', () => {
  const result = anomaly.consumeFifoAllowNegative({
    currentStock: 2,
    costLayers: [
      { layerId: 'L1', qtyRemaining: 1, unitCost: 100, receivedAt: '2026-01-01' },
      { layerId: 'L2', qtyRemaining: 1, unitCost: 120, receivedAt: '2026-02-01' }
    ]
  }, 3);

  assert.equal(result.before, 2);
  assert.equal(result.after, -1);
  assert.equal(result.costTotal, 220);
  assert.equal(result.unknownCostQty, 1);
  assert.deepEqual(result.layers, []);
});

test('inventory application guards exclude historical, cancelled, and invalid orders', () => {
  assert.equal(anomaly.orderCanApplyInventory({ quantity: 1, lifecycle: 'active', validSale: true }), true);
  assert.equal(anomaly.orderCanApplyInventory({ quantity: 1, lifecycle: 'cancelled', validSale: true }), false);
  assert.equal(anomaly.orderCanApplyInventory({ quantity: 1, lifecycle: 'active', validSale: false }), false);
  assert.equal(anomaly.orderCanApplyInventory({ quantity: 1, lifecycle: 'active', historicalImport: true }), false);
});


test('return candidates with fulfillment evidence stay in manual review', () => {
  assert.equal(anomaly._test.orderHasFulfillmentEvidence({ orderStatus: '已出貨後退款' }), true);
  assert.equal(anomaly._test.orderHasFulfillmentEvidence({ paymentStatus: '退款', shippedAt: null }), false);
});

test('attentionRows contains all actionable reason categories while automatic recheck stays narrow', () => {
  const rows = anomaly.attentionRows([
    { id: '1', processingStatus: 'unmatched-sku' },
    { id: '2', processingStatus: 'manual-return-review' },
    { id: '3', processingStatus: 'inventory-applied' },
    { id: '4', processingStatus: 'reversal-error' }
  ]);
  assert.deepEqual(rows.map((row) => row.id).sort(), ['1', '2', '4']);
  assert.equal(anomaly.automaticRecheckEligible(rows.find((row) => row.id === '1')), true);
  assert.equal(anomaly.automaticRecheckEligible(rows.find((row) => row.id === '2')), false);
});


test('safe recheck deducts exactly once and uses the deterministic inventory document', async () => {
  const product = {
    id: 'p1',
    raw: {
      internalSku: 'SKU-1',
      internalName: '商品一',
      currentStock: 5,
      costLayers: [{ layerId: 'L1', qtyRemaining: 5, unitCost: 80, receivedAt: '2026-01-01' }],
      enabled: true
    }
  };
  const db = makeMemoryDb({
    'opsPlatformOrders/o1': {
      sku: 'SKU-1',
      platform: 'MOMO',
      externalOrderNo: 'ORDER-1',
      productName: '商品一',
      quantity: 1,
      unitPrice: 200,
      grossAmount: 200,
      lifecycle: 'active',
      validSale: true,
      inventoryApplied: false,
      processingStatus: 'unmatched-sku'
    },
    'opsInternalProducts/p1': product.raw
  });
  const context = {
    db,
    actor: 'tester',
    settings: { applyInventory: true, estimatedNetRate: 0.87 },
    productMap: anomaly.buildProductMap([product])
  };

  const first = await anomaly._test.recheckOrderWithContext('o1', context);
  assert.equal(first.status, 'applied');
  assert.equal(db._get('opsInternalProducts/p1').currentStock, 4);
  assert.equal(db._get('opsPlatformOrders/o1').inventoryApplied, true);
  assert.equal(db._get('opsInventoryTransactions/online_o1').qtyChange, -1);

  const second = await anomaly._test.recheckOrderWithContext('o1', context);
  assert.equal(second.status, 'already-applied');
  assert.equal(db._get('opsInternalProducts/p1').currentStock, 4);
});

test('summarizeResults separates applied, already-applied, unresolved, and failures', () => {
  assert.deepEqual(anomaly.summarizeResults([
    { status: 'applied' },
    { status: 'already-applied' },
    { status: 'resolved-no-stock' },
    { status: 'unresolved' },
    { status: 'error' }
  ]), {
    total: 5,
    resolved: 3,
    applied: 1,
    alreadyApplied: 1,
    unresolved: 1,
    skipped: 0,
    errors: 1
  });
});
