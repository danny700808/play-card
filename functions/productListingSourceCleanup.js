'use strict';

const { onDocumentWrittenWithAuthContext } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

const REGION = 'us-central1';
const LISTING_CASE_COLLECTION = 'opsProductListingCases';
const JOB_COLLECTION = 'opsSyncJobs';
const WORKFLOW_VERSION = 'youzi-four-channel-listing-v3';
const MAX_SOURCE_OBJECTS = 100;
const SAFE_PRODUCT_ID = /^[A-Za-z0-9_-]{1,160}$/;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sourcePrefixForProduct(productId) {
  const id = clean(productId);
  if (!SAFE_PRODUCT_ID.test(id) || id === '.' || id === '..') return '';
  return `ops-product-listing-cases/${id}/references/`;
}

function cleanupPolicy(record) {
  const source = record && typeof record === 'object' ? record : {};
  return source.sourceImageRetentionPolicy && typeof source.sourceImageRetentionPolicy === 'object'
    ? source.sourceImageRetentionPolicy : {};
}

function cleanupTriggerShouldRun(before, after) {
  const previous = clean(cleanupPolicy(before).cleanupStatus);
  const current = clean(cleanupPolicy(after).cleanupStatus);
  return current === 'required' && previous !== 'required';
}

function cleanupEventHasTrustedWriter(event) {
  return ['service_account', 'system'].includes(clean(event && event.authType).toLowerCase());
}

function jobAuthorizedProductIds(jobRecord) {
  const job = jobRecord && typeof jobRecord === 'object' ? jobRecord : {};
  const plan = job.preparedSnapshot && job.preparedSnapshot.platformImagePlan
    && typeof job.preparedSnapshot.platformImagePlan === 'object'
    ? job.preparedSnapshot.platformImagePlan : {};
  return Array.from(new Set([clean(job.productId)].concat(
    (Array.isArray(plan.imageReferenceCases) ? plan.imageReferenceCases : []).map((row) => clean(row && row.productId))
  ).filter(Boolean)));
}

function cleanupReadinessBlocker(productId, caseRecord, jobId, jobRecord) {
  const prefix = sourcePrefixForProduct(productId);
  const policy = cleanupPolicy(caseRecord);
  const job = jobRecord && typeof jobRecord === 'object' ? jobRecord : {};
  if (!prefix) return { code: 'unsafe-product-id', message: '商品案件代碼無法安全轉成 Storage 路徑' };
  if (clean(policy.cleanupStatus) !== 'required') return { code: 'cleanup-not-required', message: '案件尚未進入 required 清理階段' };
  if (policy.sourceBinaryCleanupRequired !== true || policy.cleanupWorkerRequired !== true) return { code: 'cleanup-contract-missing', message: '案件缺少來源檔清理契約' };
  if (policy.referencesVerified !== true || policy.eligibleForDeletion !== true || caseRecord.mediaReferencesVerified !== true) return { code: 'references-not-verified', message: '中央、細項或平台圖片引用尚未全部核對' };
  if (!jobId || clean(policy.verifiedJobId) !== jobId) return { code: 'verified-job-missing', message: '找不到核對本次圖片引用的完成工作' };
  if (clean(job.workflowVersion) !== WORKFLOW_VERSION || clean(job.status) !== 'completed' || clean(job.currentStage) !== 'completed') return { code: 'verified-job-incomplete', message: '核對工作不是已完成的 v3 四通路工作' };
  if (!jobAuthorizedProductIds(job).includes(clean(productId))) return { code: 'verified-job-product-mismatch', message: '完成工作未包含這一個商品案件' };
  return null;
}

function safeSourceObject(file, bucketName, prefix, productId) {
  const name = clean(file && file.name);
  const suffix = name.startsWith(prefix) ? name.slice(prefix.length) : '';
  const fileBucketName = clean(file && file.bucket && file.bucket.name);
  if (!bucketName || fileBucketName !== bucketName) return { ok: false, code: 'bucket-mismatch', path: name };
  const suffixSegments = suffix.split('/');
  if (!suffix || suffix.includes('\\') || suffixSegments.some((segment) => !segment || segment === '.' || segment === '..')) return { ok: false, code: 'unsafe-storage-path', path: name };
  if (name.includes('/completed/') || name.includes('/generated/')) return { ok: false, code: 'completed-image-path', path: name };
  return { ok: true, path: name, productId: clean(productId) };
}

function lineageRecord(file, metadata, productId, recordedAt) {
  const custom = metadata && metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
  return {
    productId: clean(productId),
    storagePath: clean(file && file.name),
    bucket: clean(file && file.bucket && file.bucket.name),
    generation: clean(metadata && metadata.generation),
    metageneration: clean(metadata && metadata.metageneration),
    md5Hash: clean(metadata && metadata.md5Hash),
    crc32c: clean(metadata && metadata.crc32c),
    size: clean(metadata && metadata.size),
    contentType: clean(metadata && metadata.contentType),
    sourceProductIdMetadata: clean(custom.productId),
    recordedAt: recordedAt
  };
}

function mergeLineageRecords(existing, incoming) {
  const result = new Map();
  (Array.isArray(existing) ? existing : []).forEach((row) => {
    if (clean(row && row.storagePath)) result.set(clean(row.storagePath), { ...row });
  });
  (Array.isArray(incoming) ? incoming : []).forEach((row) => {
    if (clean(row && row.storagePath)) result.set(clean(row.storagePath), { ...row });
  });
  return Array.from(result.values()).sort((a, b) => clean(a.storagePath).localeCompare(clean(b.storagePath)));
}

function isNotFound(error) {
  const code = clean(error && error.code).toLowerCase();
  return code === '404' || code === 'not-found' || code === 'storage/object-not-found';
}

async function runProductListingSourceCleanup(options = {}) {
  const productId = clean(options.productId);
  const caseRecord = options.caseRecord && typeof options.caseRecord === 'object' ? options.caseRecord : {};
  const jobId = clean(options.jobId);
  const jobRecord = options.jobRecord && typeof options.jobRecord === 'object' ? options.jobRecord : {};
  const bucket = options.bucket;
  const persist = typeof options.persist === 'function' ? options.persist : async () => {};
  const isAuthorized = typeof options.isAuthorized === 'function' ? options.isAuthorized : async () => true;
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const prefix = sourcePrefixForProduct(productId);
  const originalPolicy = cleanupPolicy(caseRecord);
  const blocker = cleanupReadinessBlocker(productId, caseRecord, jobId, jobRecord);

  async function persistPolicy(patch) {
    const policy = { ...originalPolicy, ...patch };
    const applied = await persist({ sourceImageRetentionPolicy: policy });
    if (applied === false) return null;
    Object.assign(originalPolicy, policy);
    return policy;
  }

  if (blocker) {
    if (clean(originalPolicy.cleanupStatus) === 'required') {
      await persistPolicy({
        cleanupStatus: 'blocked', eligibleForDeletion: false,
        cleanupBlockedCode: blocker.code, cleanupBlockedReason: blocker.message,
        cleanupBlockedAt: now().toISOString()
      });
    }
    return { status: 'blocked', reason: blocker.code, deletedCount: 0 };
  }
  if (!bucket || !clean(bucket.name) || typeof bucket.getFiles !== 'function') {
    await persistPolicy({ cleanupStatus: 'blocked', eligibleForDeletion: false, cleanupBlockedCode: 'bucket-unavailable', cleanupBlockedReason: '無法確認 Firebase Storage 預設 bucket', cleanupBlockedAt: now().toISOString() });
    return { status: 'blocked', reason: 'bucket-unavailable', deletedCount: 0 };
  }

  let files;
  try {
    [files] = await bucket.getFiles({ prefix, autoPaginate: true });
  } catch (error) {
    const retryState = await persistPolicy({ cleanupStatus: 'required', cleanupRuntimeStatus: 'failed-retryable', eligibleForDeletion: true, cleanupFailureStage: 'storage-list', cleanupErrorCode: 'storage-list-failed', cleanupError: clean(error && error.message).slice(0, 500), cleanupFailedAt: now().toISOString() });
    if (!retryState) return { status: 'superseded', reason: 'cleanup-state-write-rejected', deletedCount: 0 };
    return { status: 'failed-retryable', reason: 'storage-list-failed', deletedCount: 0 };
  }
  files = Array.isArray(files) ? files : [];
  if (files.length > MAX_SOURCE_OBJECTS) {
    await persistPolicy({ cleanupStatus: 'blocked', eligibleForDeletion: false, cleanupBlockedCode: 'too-many-source-objects', cleanupBlockedReason: `來源目錄包含 ${files.length} 個物件，超過安全上限`, cleanupBlockedAt: now().toISOString() });
    return { status: 'blocked', reason: 'too-many-source-objects', deletedCount: 0 };
  }

  const pathChecks = files.map((file) => safeSourceObject(file, clean(bucket.name), prefix, productId));
  const unsafe = pathChecks.find((row) => !row.ok);
  if (unsafe) {
    await persistPolicy({ cleanupStatus: 'blocked', eligibleForDeletion: false, cleanupBlockedCode: unsafe.code, cleanupBlockedReason: `Storage 物件不在核准來源路徑：${unsafe.path || '未知路徑'}`, cleanupBlockedAt: now().toISOString() });
    return { status: 'blocked', reason: unsafe.code, deletedCount: 0 };
  }

  const recordedAt = now().toISOString();
  const metadataRows = [];
  for (const file of files) {
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch (error) {
      const retryState = await persistPolicy({ cleanupStatus: 'required', cleanupRuntimeStatus: 'failed-retryable', eligibleForDeletion: true, cleanupFailureStage: 'object-metadata-read', cleanupErrorCode: 'object-metadata-read-failed', cleanupError: clean(error && error.message).slice(0, 500), cleanupFailedAt: now().toISOString() });
      if (!retryState) return { status: 'superseded', reason: 'cleanup-state-write-rejected', deletedCount: 0 };
      return { status: 'failed-retryable', reason: 'object-metadata-read-failed', deletedCount: 0 };
    }
    const row = lineageRecord(file, metadata || {}, productId, recordedAt);
    if (!row.generation || (row.sourceProductIdMetadata && row.sourceProductIdMetadata !== productId)) {
      const reason = !row.generation
        ? `物件缺少 generation：${row.storagePath}`
        : `物件 productId metadata 不符：${row.storagePath}`;
      await persistPolicy({ cleanupStatus: 'blocked', eligibleForDeletion: false, cleanupBlockedCode: 'object-metadata-unverified', cleanupBlockedReason: reason.slice(0, 500), cleanupBlockedAt: now().toISOString() });
      return { status: 'blocked', reason: 'object-metadata-unverified', deletedCount: 0 };
    }
    metadataRows.push(row);
  }

  const lineage = mergeLineageRecords(originalPolicy.sourceBinaryLineageMetadata, metadataRows);
  const metadataStaged = await persistPolicy({
    cleanupStatus: 'required', cleanupRuntimeStatus: 'metadata-staged',
    cleanupPrefix: prefix, sourceBinaryLineageMetadata: lineage,
    cleanupAttemptedAt: recordedAt, cleanupErrorCode: '', cleanupError: ''
  });
  if (!metadataStaged) return { status: 'superseded', reason: 'cleanup-state-write-rejected', deletedCount: 0 };

  let deletedCount = 0;
  const failedPaths = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const row = metadataRows[index];
    if (!await isAuthorized({ productId, jobId, storagePath: row.storagePath, generation: row.generation })) {
      return { status: 'superseded', reason: 'cleanup-authorization-changed', deletedCount };
    }
    try {
      await file.delete({ preconditionOpts: { ifGenerationMatch: row.generation } });
      deletedCount += 1;
    } catch (error) {
      if (isNotFound(error)) {
        deletedCount += 1;
      } else {
        failedPaths.push({ storagePath: row.storagePath, error: clean(error && error.message).slice(0, 300) });
      }
    }
  }
  if (failedPaths.length) {
    const retryState = await persistPolicy({
      cleanupStatus: 'required', cleanupRuntimeStatus: 'failed-retryable', cleanupFailureStage: 'delete-incomplete', eligibleForDeletion: true,
      cleanupDeletedObjectCount: deletedCount, cleanupFailedObjects: failedPaths,
      cleanupErrorCode: 'storage-delete-failed', cleanupError: `${failedPaths.length} 個來源物件尚未刪除`, cleanupFailedAt: now().toISOString()
    });
    if (!retryState) return { status: 'superseded', reason: 'cleanup-state-write-rejected', deletedCount };
    return { status: 'failed-retryable', reason: 'storage-delete-failed', deletedCount, failedPaths: failedPaths.map((row) => row.storagePath) };
  }

  let remaining;
  try {
    [remaining] = await bucket.getFiles({ prefix, autoPaginate: true });
  } catch (error) {
    const retryState = await persistPolicy({ cleanupStatus: 'required', cleanupRuntimeStatus: 'failed-retryable', cleanupFailureStage: 'post-delete-list', eligibleForDeletion: true, cleanupDeletedObjectCount: deletedCount, cleanupErrorCode: 'post-delete-list-failed', cleanupError: clean(error && error.message).slice(0, 500), cleanupFailedAt: now().toISOString() });
    if (!retryState) return { status: 'superseded', reason: 'cleanup-state-write-rejected', deletedCount };
    return { status: 'failed-retryable', reason: 'post-delete-list-failed', deletedCount };
  }
  remaining = Array.isArray(remaining) ? remaining : [];
  if (remaining.length) {
    const retryState = await persistPolicy({ cleanupStatus: 'required', cleanupRuntimeStatus: 'failed-retryable', cleanupFailureStage: 'verification-found-remaining', eligibleForDeletion: true, cleanupDeletedObjectCount: deletedCount, cleanupErrorCode: 'source-objects-remain', cleanupError: `${remaining.length} 個來源物件仍存在`, cleanupFailedAt: now().toISOString() });
    if (!retryState) return { status: 'superseded', reason: 'cleanup-state-write-rejected', deletedCount };
    return { status: 'failed-retryable', reason: 'source-objects-remain', deletedCount };
  }

  const completedPolicy = await persistPolicy({
    cleanupStatus: 'completed', cleanupRuntimeStatus: 'completed', eligibleForDeletion: false,
    sourceBinaryCleanupRequired: false, cleanupWorkerRequired: false,
    sourceBinaryDeleted: true, cleanupDeletedObjectCount: deletedCount,
    cleanupFailedObjects: [], cleanupCompletedAt: now().toISOString()
  });
  if (!completedPolicy) return { status: 'superseded', reason: 'cleanup-state-write-rejected', deletedCount };
  return { status: 'completed', deletedCount, prefix, lineageCount: lineage.length };
}

async function cleanupProductListingCase(db, bucket, productId) {
  const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(productId);
  const caseSnap = await caseRef.get();
  if (!caseSnap.exists) return { status: 'ignored-missing-case', deletedCount: 0 };
  const caseRecord = caseSnap.data() || {};
  const policy = cleanupPolicy(caseRecord);
  if (clean(policy.cleanupStatus) !== 'required') return { status: 'ignored-not-required', deletedCount: 0 };
  const jobId = clean(policy.verifiedJobId);
  const jobSnap = jobId ? await db.collection(JOB_COLLECTION).doc(jobId).get() : null;
  const jobRecord = jobSnap && jobSnap.exists ? jobSnap.data() || {} : {};
  return runProductListingSourceCleanup({
    productId, caseRecord, jobId, jobRecord, bucket,
    isAuthorized: async () => {
      const liveSnap = await caseRef.get();
      if (!liveSnap.exists) return false;
      return cleanupReadinessBlocker(productId, liveSnap.data() || {}, jobId, jobRecord) === null;
    },
    persist: (patch) => db.runTransaction(async (transaction) => {
      const liveSnap = await transaction.get(caseRef);
      if (!liveSnap.exists) return false;
      const liveRecord = liveSnap.data() || {};
      const livePolicy = cleanupPolicy(liveRecord);
      const patchPolicy = cleanupPolicy(patch);
      const liveStatus = clean(livePolicy.cleanupStatus);
      if (clean(livePolicy.verifiedJobId) !== jobId) return false;
      if (liveStatus === 'completed') return clean(patchPolicy.cleanupStatus) === 'completed';
      if (liveStatus !== 'required') return false;
      if (clean(patchPolicy.cleanupStatus) !== 'blocked' && cleanupReadinessBlocker(productId, liveRecord, jobId, jobRecord)) return false;
      transaction.set(caseRef, {
        ...patch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'product-listing-source-cleanup-v2'
      }, { merge: true });
      return true;
    })
  });
}

function finalizeSourceCleanupEvent(result, productId) {
  const row = result && typeof result === 'object' ? result : {};
  if (clean(row.status) === 'failed-retryable') {
    const error = new Error(`來源圖片清理暫時失敗，將由事件重試：${clean(row.reason) || 'unknown'} (${clean(productId) || 'unknown-product'})`);
    error.code = 'product-listing-source-cleanup-retry';
    throw error;
  }
  return row;
}

function registerProductListingSourceCleanup(target) {
  target.cleanupProductListingSourceImages = onDocumentWrittenWithAuthContext({
    document: `${LISTING_CASE_COLLECTION}/{productId}`,
    region: REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
    maxInstances: 2,
    retry: true
  }, async (event) => {
    if (!cleanupEventHasTrustedWriter(event)) {
      console.warn('[cleanupProductListingSourceImages] ignored untrusted writer', {
        productId: clean(event.params && event.params.productId),
        authType: clean(event.authType) || 'unknown'
      });
      return null;
    }
    const beforeSnap = event.data && event.data.before;
    const afterSnap = event.data && event.data.after;
    if (!afterSnap || !afterSnap.exists) return null;
    const before = beforeSnap && beforeSnap.exists ? beforeSnap.data() || {} : {};
    const after = afterSnap.data() || {};
    if (!cleanupTriggerShouldRun(before, after)) return null;
    const productId = clean(event.params && event.params.productId);
    const result = await cleanupProductListingCase(admin.firestore(), admin.storage().bucket(), productId);
    console.log('[cleanupProductListingSourceImages]', { productId, ...result });
    return finalizeSourceCleanupEvent(result, productId);
  });
}

module.exports = {
  registerProductListingSourceCleanup,
  runProductListingSourceCleanup,
  cleanupProductListingCase,
  cleanupTriggerShouldRun,
  cleanupEventHasTrustedWriter,
  cleanupReadinessBlocker,
  jobAuthorizedProductIds,
  sourcePrefixForProduct,
  safeSourceObject,
  mergeLineageRecords,
  finalizeSourceCleanupEvent,
  WORKFLOW_VERSION
};
