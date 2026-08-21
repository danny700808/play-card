'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runProductListingSourceCleanup,
  cleanupProductListingCase,
  cleanupTriggerShouldRun,
  cleanupEventHasTrustedWriter,
  finalizeSourceCleanupEvent,
  sourcePrefixForProduct,
  WORKFLOW_VERSION
} = require('../functions/productListingSourceCleanup');

function verifiedCase(jobId = 'job-v2-1') {
  return {
    mediaReferencesVerified: true,
    referenceImageUrls: ['https://firebasestorage.example/source-a', 'https://supplier.example/external.jpg'],
    selectedReferenceImageUrls: ['https://firebasestorage.example/source-a'],
    generatedListingImages: [{
      sourceImageUrl: 'https://firebasestorage.example/source-a',
      url: 'https://firebasestorage.example/completed-a',
      roles: ['cleanMain']
    }],
    sourceImageRetentionPolicy: {
      mode: 'metadata-only-after-required-binary-cleanup',
      sourceBinaryCleanupRequired: true,
      cleanupWorkerRequired: true,
      cleanupStatus: 'required',
      referencesVerified: true,
      eligibleForDeletion: true,
      verifiedJobId: jobId
    }
  };
}

function completedJob(productId, otherProductIds = []) {
  return {
    productId,
    workflowVersion: WORKFLOW_VERSION,
    status: 'completed',
    currentStage: 'completed',
    preparedSnapshot: {
      platformImagePlan: {
        imageReferenceCases: [productId].concat(otherProductIds).filter(Boolean).map((id) => ({ productId: id }))
      }
    }
  };
}

class FakeFile {
  constructor(name, metadata = {}) {
    this.name = name;
    this.metadata = {
      generation: metadata.generation || String(Math.floor(Math.random() * 100000) + 1),
      metageneration: metadata.metageneration || '1',
      md5Hash: metadata.md5Hash || `md5-${name}`,
      crc32c: metadata.crc32c || `crc-${name}`,
      size: metadata.size || '123',
      contentType: metadata.contentType || 'image/jpeg',
      metadata: metadata.customMetadata || {}
    };
    this.deleted = false;
    this.deleteCalls = [];
    this.failDeleteCount = Number(metadata.failDeleteCount || 0);
  }

  async getMetadata() {
    if (this.metadataError) throw this.metadataError;
    return [this.metadata];
  }

  async delete(options) {
    this.deleteCalls.push(options);
    if (this.failDeleteCount > 0) {
      this.failDeleteCount -= 1;
      throw new Error('temporary delete failure');
    }
    if (this.deleted) {
      const error = new Error('not found');
      error.code = 404;
      throw error;
    }
    this.deleted = true;
  }
}

class FakeBucket {
  constructor(name, files, options = {}) {
    this.name = name;
    this.files = files;
    this.returnUnsafeRows = options.returnUnsafeRows === true;
    this.failListCalls = new Set(Array.isArray(options.failListCalls) ? options.failListCalls : []);
    files.forEach((file) => { file.bucket = this; });
    this.requests = [];
  }

  async getFiles(options) {
    this.requests.push({ ...options });
    if (this.failListCalls.has(this.requests.length)) throw new Error(`temporary list failure ${this.requests.length}`);
    const available = this.files.filter((file) => !file.deleted);
    if (this.returnUnsafeRows) return [available];
    return [available.filter((file) => file.name.startsWith(options.prefix))];
  }
}

function cleanupDb(caseRecord, jobRecord, beforeTransaction) {
  const documents = new Map([
    ['opsProductListingCases/product-race', caseRecord],
    ['opsSyncJobs/job-v2-1', jobRecord]
  ]);
  let transactionCount = 0;
  const makeRef = (path) => ({
    path,
    async get() {
      const value = documents.get(path);
      return { exists: value !== undefined, data: () => value };
    }
  });
  return {
    collection(name) { return { doc(id) { return makeRef(`${name}/${id}`); } }; },
    async runTransaction(handler) {
      transactionCount += 1;
      if (typeof beforeTransaction === 'function') beforeTransaction(transactionCount, documents);
      return handler({
        get: (ref) => ref.get(),
        set: (ref, value) => {
          const current = documents.get(ref.path) || {};
          documents.set(ref.path, { ...current, ...value });
        }
      });
    },
    get(path) { return documents.get(path); }
  };
}

function harness(caseRecord) {
  const writes = [];
  return {
    writes,
    persist: async (patch) => {
      writes.push(JSON.parse(JSON.stringify(patch)));
      if (patch.sourceImageRetentionPolicy) caseRecord.sourceImageRetentionPolicy = { ...patch.sourceImageRetentionPolicy };
    }
  };
}

test('只刪除同案件 references 前綴來源檔並先保存 lineage metadata', async () => {
  const productId = 'sku_1uk235n';
  const prefix = sourcePrefixForProduct(productId);
  const sourceA = new FakeFile(`${prefix}1710000000-0-a.jpg`, { generation: '11', customMetadata: { productId } });
  const sourceB = new FakeFile(`${prefix}1710000000-1-b.png`, { generation: '12', customMetadata: { productId } });
  const imported = new FakeFile(`${prefix}imported/1710000000-2-c.jpg`, { generation: '15', customMetadata: { productId } });
  const completed = new FakeFile(`ops-product-listing-cases/${productId}/completed/final.jpg`, { generation: '13', customMetadata: { productId } });
  const other = new FakeFile('ops-product-listing-cases/another-product/references/source.jpg', { generation: '14', customMetadata: { productId: 'another-product' } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [sourceA, sourceB, imported, completed, other]);
  const caseRecord = verifiedCase();
  const originalReferences = caseRecord.referenceImageUrls.slice();
  const io = harness(caseRecord);

  const result = await runProductListingSourceCleanup({
    productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist,
    now: () => new Date('2026-08-21T10:00:00.000Z')
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.deletedCount, 3);
  assert.equal(sourceA.deleted, true);
  assert.equal(sourceB.deleted, true);
  assert.equal(imported.deleted, true, 'references/imported 仍屬同案件來源前綴');
  assert.equal(completed.deleted, false, '完成圖不得刪除');
  assert.equal(other.deleted, false, '其他商品來源圖不得刪除');
  assert.deepEqual(caseRecord.referenceImageUrls, originalReferences, '來源 URL 譜系不得清空');
  const policy = caseRecord.sourceImageRetentionPolicy;
  assert.equal(policy.cleanupStatus, 'completed');
  assert.equal(policy.sourceBinaryDeleted, true);
  assert.equal(policy.sourceBinaryLineageMetadata.length, 3);
  assert.deepEqual(policy.sourceBinaryLineageMetadata.map((row) => row.generation).sort(), ['11', '12', '15']);
  assert.equal(policy.sourceBinaryLineageMetadata.every((row) => row.md5Hash && row.storagePath.startsWith(prefix)), true);
  assert.equal(sourceA.deleteCalls[0].preconditionOpts.ifGenerationMatch, '11');
  assert.equal(bucket.requests.every((request) => request.prefix === prefix), true);
  assert.ok(io.writes.find((write) => write.sourceImageRetentionPolicy.cleanupRuntimeStatus === 'metadata-staged'), '刪檔前必須先保存 metadata');
});

test('無法安全判定路徑時標記 blocked 且一個檔案也不刪', async () => {
  const productId = 'safe-product';
  const prefix = sourcePrefixForProduct(productId);
  const safe = new FakeFile(`${prefix}source.jpg`, { generation: '21', customMetadata: { productId } });
  const crossProduct = new FakeFile('ops-product-listing-cases/victim/references/source.jpg', { generation: '22', customMetadata: { productId: 'victim' } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [safe, crossProduct], { returnUnsafeRows: true });
  const caseRecord = verifiedCase();
  const io = harness(caseRecord);

  const result = await runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'unsafe-storage-path');
  assert.equal(safe.deleteCalls.length, 0);
  assert.equal(crossProduct.deleteCalls.length, 0);
  assert.equal(caseRecord.sourceImageRetentionPolicy.cleanupStatus, 'blocked');
});

test('物件 productId metadata 不符時拒絕刪除', async () => {
  const productId = 'product-a';
  const prefix = sourcePrefixForProduct(productId);
  const mismatched = new FakeFile(`${prefix}source.jpg`, { generation: '31', customMetadata: { productId: 'product-b' } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [mismatched]);
  const caseRecord = verifiedCase();
  const io = harness(caseRecord);

  const result = await runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'object-metadata-unverified');
  assert.equal(mismatched.deleteCalls.length, 0);
});

test('Storage bucket 不符時拒絕刪除', async () => {
  const productId = 'product-a';
  const prefix = sourcePrefixForProduct(productId);
  const foreign = new FakeFile(`${prefix}source.jpg`, { generation: '32', customMetadata: { productId } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [foreign]);
  foreign.bucket = { name: 'foreign-project.appspot.com' };
  const caseRecord = verifiedCase();
  const io = harness(caseRecord);

  const result = await runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'bucket-mismatch');
  assert.equal(foreign.deleteCalls.length, 0);
});

test('references 內若混入 generated 或 completed 子目錄會整批 blocked', async () => {
  const productId = 'protected-subtree';
  const prefix = sourcePrefixForProduct(productId);
  const safe = new FakeFile(`${prefix}source.jpg`, { generation: '321', customMetadata: { productId } });
  const generated = new FakeFile(`${prefix}generated/output.jpg`, { generation: '322', customMetadata: { productId } });
  const completed = new FakeFile(`${prefix}completed/output.jpg`, { generation: '323', customMetadata: { productId } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [safe, generated, completed]);
  const caseRecord = verifiedCase();
  const io = harness(caseRecord);

  const result = await runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'completed-image-path');
  assert.equal(safe.deleteCalls.length, 0);
  assert.equal(generated.deleteCalls.length, 0);
  assert.equal(completed.deleteCalls.length, 0);
  assert.equal(caseRecord.sourceImageRetentionPolicy.cleanupStatus, 'blocked');
});

test('第一次列檔暫時失敗會保留 required，事件重試可安全完成', async () => {
  const productId = 'list-retry';
  const prefix = sourcePrefixForProduct(productId);
  const source = new FakeFile(`${prefix}source.jpg`, { generation: '324', customMetadata: { productId } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [source], { failListCalls: [1] });
  const caseRecord = verifiedCase();
  const io = harness(caseRecord);

  const first = await runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist });
  assert.equal(first.status, 'failed-retryable');
  assert.equal(first.reason, 'storage-list-failed');
  assert.equal(source.deleted, false);
  assert.equal(caseRecord.sourceImageRetentionPolicy.cleanupStatus, 'required');

  const retry = await runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist });
  assert.equal(retry.status, 'completed');
  assert.equal(source.deleted, true);
  assert.equal(caseRecord.sourceImageRetentionPolicy.cleanupStatus, 'completed');
});

test('刪除後的列檔驗證暫時失敗不會 completed，重試以既有 lineage 收斂', async () => {
  const productId = 'post-list-retry';
  const prefix = sourcePrefixForProduct(productId);
  const source = new FakeFile(`${prefix}source.jpg`, { generation: '325', customMetadata: { productId } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [source], { failListCalls: [2] });
  const caseRecord = verifiedCase();
  const io = harness(caseRecord);

  const first = await runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist });
  assert.equal(first.status, 'failed-retryable');
  assert.equal(first.reason, 'post-delete-list-failed');
  assert.equal(source.deleted, true);
  assert.equal(caseRecord.sourceImageRetentionPolicy.cleanupStatus, 'required');
  assert.equal(caseRecord.sourceImageRetentionPolicy.sourceBinaryLineageMetadata.length, 1);

  const retry = await runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist });
  assert.equal(retry.status, 'completed');
  assert.equal(retry.deletedCount, 0, '已刪物件不得在重試時重複計為新刪除');
  assert.equal(caseRecord.sourceImageRetentionPolicy.sourceBinaryLineageMetadata.length, 1);
});

test('lineage metadata 寫入資料庫失敗時不得先刪 Storage', async () => {
  const productId = 'metadata-db-failure';
  const prefix = sourcePrefixForProduct(productId);
  const source = new FakeFile(`${prefix}source.jpg`, { generation: '326', customMetadata: { productId } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [source]);
  const caseRecord = verifiedCase();
  const persist = async (patch) => {
    if (patch.sourceImageRetentionPolicy.cleanupRuntimeStatus === 'metadata-staged') throw new Error('firestore unavailable');
    caseRecord.sourceImageRetentionPolicy = { ...patch.sourceImageRetentionPolicy };
    return true;
  };

  await assert.rejects(
    runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist }),
    /firestore unavailable/
  );
  assert.equal(source.deleteCalls.length, 0);
  assert.notEqual(caseRecord.sourceImageRetentionPolicy.cleanupStatus, 'completed');
});

test('完成狀態寫入失敗時不宣稱 completed，重試可由已保存 lineage 完成', async () => {
  const productId = 'completion-db-failure';
  const prefix = sourcePrefixForProduct(productId);
  const source = new FakeFile(`${prefix}source.jpg`, { generation: '327', customMetadata: { productId } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [source]);
  const caseRecord = verifiedCase();
  const failingPersist = async (patch) => {
    if (patch.sourceImageRetentionPolicy.cleanupStatus === 'completed') throw new Error('completion write unavailable');
    caseRecord.sourceImageRetentionPolicy = { ...patch.sourceImageRetentionPolicy };
    return true;
  };

  await assert.rejects(
    runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: failingPersist }),
    /completion write unavailable/
  );
  assert.equal(source.deleted, true);
  assert.equal(caseRecord.sourceImageRetentionPolicy.cleanupStatus, 'required');
  assert.equal(caseRecord.sourceImageRetentionPolicy.sourceBinaryLineageMetadata.length, 1);

  const io = harness(caseRecord);
  const retry = await runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist });
  assert.equal(retry.status, 'completed');
  assert.equal(caseRecord.sourceImageRetentionPolicy.sourceBinaryLineageMetadata.length, 1);
});

test('live cleanup 狀態在 metadata-staged 前改變時不得復活 required 或刪檔', async () => {
  const productId = 'product-race';
  const prefix = sourcePrefixForProduct(productId);
  const source = new FakeFile(`${prefix}source.jpg`, { generation: '328', customMetadata: { productId } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [source]);
  const caseRecord = verifiedCase();
  const db = cleanupDb(caseRecord, completedJob(productId), (transactionCount, documents) => {
    if (transactionCount !== 1) return;
    const live = documents.get(`opsProductListingCases/${productId}`);
    live.sourceImageRetentionPolicy = { ...live.sourceImageRetentionPolicy, cleanupStatus: 'blocked', eligibleForDeletion: false };
  });

  const result = await cleanupProductListingCase(db, bucket, productId);

  assert.equal(result.status, 'superseded');
  assert.equal(result.reason, 'cleanup-state-write-rejected');
  assert.equal(source.deleteCalls.length, 0);
  assert.equal(db.get(`opsProductListingCases/${productId}`).sourceImageRetentionPolicy.cleanupStatus, 'blocked');
});

test('讀取來源檔 metadata 暫時失敗時可重試且不刪檔', async () => {
  const productId = 'metadata-retry';
  const prefix = sourcePrefixForProduct(productId);
  const source = new FakeFile(`${prefix}source.jpg`, { generation: '33', customMetadata: { productId } });
  source.metadataError = new Error('temporary metadata outage');
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [source]);
  const caseRecord = verifiedCase();
  const io = harness(caseRecord);

  const result = await runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist });

  assert.equal(result.status, 'failed-retryable');
  assert.equal(result.reason, 'object-metadata-read-failed');
  assert.equal(source.deleteCalls.length, 0);
  assert.equal(caseRecord.sourceImageRetentionPolicy.cleanupStatus, 'required');
  assert.equal(caseRecord.sourceImageRetentionPolicy.cleanupRuntimeStatus, 'failed-retryable');
  assert.equal(caseRecord.sourceImageRetentionPolicy.eligibleForDeletion, true);
});

test('刪除失敗不會標記 completed，重新要求後可冪等續刪', async () => {
  const productId = 'retry-product';
  const prefix = sourcePrefixForProduct(productId);
  const first = new FakeFile(`${prefix}first.jpg`, { generation: '41', customMetadata: { productId } });
  const second = new FakeFile(`${prefix}second.jpg`, { generation: '42', customMetadata: { productId }, failDeleteCount: 1 });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [first, second]);
  const caseRecord = verifiedCase();
  const io = harness(caseRecord);

  const failed = await runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist });
  assert.equal(failed.status, 'failed-retryable');
  assert.equal(caseRecord.sourceImageRetentionPolicy.cleanupStatus, 'required');
  assert.equal(caseRecord.sourceImageRetentionPolicy.cleanupRuntimeStatus, 'failed-retryable');
  assert.equal(caseRecord.sourceImageRetentionPolicy.eligibleForDeletion, true);
  assert.equal(first.deleted, true);
  assert.equal(second.deleted, false);
  assert.equal(caseRecord.sourceImageRetentionPolicy.sourceBinaryLineageMetadata.length, 2);

  const retried = await runProductListingSourceCleanup({ productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist });
  assert.equal(retried.status, 'completed');
  assert.equal(second.deleted, true);
  assert.equal(caseRecord.sourceImageRetentionPolicy.sourceBinaryLineageMetadata.length, 2, '重試不可遺失已刪來源的 metadata');
});

test('verified job 在刪除前改變時立即停止且不刪來源檔', async () => {
  const productId = 'superseded-product';
  const prefix = sourcePrefixForProduct(productId);
  const source = new FakeFile(`${prefix}source.jpg`, { generation: '51', customMetadata: { productId } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [source]);
  const caseRecord = verifiedCase();
  const io = harness(caseRecord);

  const result = await runProductListingSourceCleanup({
    productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob(productId), bucket, persist: io.persist,
    isAuthorized: async () => false
  });

  assert.equal(result.status, 'superseded');
  assert.equal(result.reason, 'cleanup-authorization-changed');
  assert.equal(source.deleteCalls.length, 0);
  assert.notEqual(caseRecord.sourceImageRetentionPolicy.cleanupStatus, 'completed');
  assert.equal(caseRecord.sourceImageRetentionPolicy.sourceBinaryLineageMetadata.length, 1, '停止前仍保留已取得的來源譜系 metadata');
});

test('完成工作若不包含本商品案件則 blocked 且不刪檔', async () => {
  const productId = 'case-product';
  const prefix = sourcePrefixForProduct(productId);
  const source = new FakeFile(`${prefix}source.jpg`, { generation: '52', customMetadata: { productId } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [source]);
  const caseRecord = verifiedCase();
  const io = harness(caseRecord);

  const result = await runProductListingSourceCleanup({
    productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob('another-product'), bucket, persist: io.persist
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'verified-job-product-mismatch');
  assert.equal(source.deleteCalls.length, 0);
});

test('合併商品列在工作 imageReferenceCases 時仍可安全清理自己的前綴', async () => {
  const productId = 'variant-product';
  const prefix = sourcePrefixForProduct(productId);
  const source = new FakeFile(`${prefix}source.jpg`, { generation: '53', customMetadata: { productId } });
  const bucket = new FakeBucket('youzi-c1b74.appspot.com', [source]);
  const caseRecord = verifiedCase();
  const io = harness(caseRecord);

  const result = await runProductListingSourceCleanup({
    productId, caseRecord, jobId: 'job-v2-1', jobRecord: completedJob('root-product', [productId]), bucket, persist: io.persist
  });

  assert.equal(result.status, 'completed');
  assert.equal(source.deleted, true);
});

test('只有 required 的新狀態會啟動 worker，危險商品 ID 永遠沒有 prefix', () => {
  assert.equal(cleanupTriggerShouldRun(
    { sourceImageRetentionPolicy: { cleanupStatus: 'blocked' } },
    { sourceImageRetentionPolicy: { cleanupStatus: 'required' } }
  ), true);
  assert.equal(cleanupTriggerShouldRun(
    { sourceImageRetentionPolicy: { cleanupStatus: 'required' } },
    { sourceImageRetentionPolicy: { cleanupStatus: 'required' } }
  ), false);
  assert.equal(sourcePrefixForProduct('../victim'), '');
  assert.equal(sourcePrefixForProduct('victim/child'), '');
});

test('只有後端 service account 或 system 寫入能啟動刪檔事件', () => {
  assert.equal(cleanupEventHasTrustedWriter({ authType: 'service_account' }), true);
  assert.equal(cleanupEventHasTrustedWriter({ authType: 'system' }), true);
  assert.equal(cleanupEventHasTrustedWriter({ authType: 'unauthenticated' }), false);
  assert.equal(cleanupEventHasTrustedWriter({ authType: 'api_key' }), false);
  assert.equal(cleanupEventHasTrustedWriter({ authType: 'unknown' }), false);
  assert.equal(cleanupEventHasTrustedWriter({}), false);
});

test('暫時失敗結果會拋錯交給 retry:true 重送，blocked 與 completed 不重試', () => {
  assert.throws(
    () => finalizeSourceCleanupEvent({ status: 'failed-retryable', reason: 'storage-list-failed' }, 'sku-1'),
    (error) => error && error.code === 'product-listing-source-cleanup-retry'
  );
  assert.equal(finalizeSourceCleanupEvent({ status: 'blocked', reason: 'unsafe-storage-path' }, 'sku-1').status, 'blocked');
  assert.equal(finalizeSourceCleanupEvent({ status: 'completed' }, 'sku-1').status, 'completed');
});
