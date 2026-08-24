'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');

const originalLoad = Module._load;
Module._load = function mockFirebase(request, parent, isMain) {
  if (request === 'firebase-functions/v2/https') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    return { onCall: (_options, handler) => handler, HttpsError };
  }
  if (request === 'firebase-functions/v2/firestore') return { onDocumentWritten: (_options, handler) => handler };
  if (request === 'firebase-functions/params') return { defineSecret: () => ({ value: () => '' }) };
  if (request === 'firebase-admin') {
    const firestore = () => ({ collection: () => { throw new Error('database not used in helper tests'); } });
    firestore.FieldValue = { serverTimestamp: () => ({ __serverTimestamp: true }) };
    return { firestore };
  }
  return originalLoad(request, parent, isMain);
};

const publish = require('../functions/productListingPublish');
Module._load = originalLoad;
const helpers = publish._test;

function withV2ImagePlan(listingCase, options = {}) {
  const branded = options.branded || 'https://example.com/branded-hero.jpg';
  const storefront = options.storefront || 'https://example.com/storefront-portrait.jpg';
  const clean = options.clean || 'https://example.com/clean-main.jpg';
  const cleanTwo = options.cleanTwo || 'https://example.com/clean-detail.jpg';
  const detail = Array.isArray(options.detail) ? options.detail : [];
  const safeFlags = { containsLogo: false, containsContactInfo: false, containsQrCode: false, containsText: false, greenBrandTemplate: false, momoPromotionEligible: false };
  const imageRoleAssignments = [
    { sourceImageUrl: 'https://example.com/source-branded.jpg', url: branded, roles: ['brandedHero'], assetFlags: { ...safeFlags, containsLogo: true, greenBrandTemplate: true } },
    { sourceImageUrl: 'https://example.com/source-branded.jpg', url: storefront, roles: ['storefrontPortrait'], assetFlags: { ...safeFlags, containsLogo: true, containsText: true, greenBrandTemplate: true } },
    { sourceImageUrl: 'https://example.com/source-clean.jpg', url: clean, roles: ['cleanMain'], assetFlags: { ...safeFlags, momoPromotionEligible: true } },
    { sourceImageUrl: 'https://example.com/source-clean-two.jpg', url: cleanTwo, roles: ['localizedDetail'], assetFlags: { ...safeFlags, momoPromotionEligible: true } },
    ...detail.map((url, index) => ({ sourceImageUrl: `https://example.com/source-detail-${index}.jpg`, url, roles: ['localizedDetail'], assetFlags: { ...safeFlags } }))
  ];
  return {
    ...listingCase,
    codexHandoff: {
      workflowVersion: 'youzi-four-channel-listing-v3',
      preflightSnapshot: {
        workflowVersion: 'youzi-four-channel-listing-v3', snapshotId: 'snapshot-v3-test',
        finalizedFromFrozenInput: true, inputSnapshotId: 'input-v2-test', inputSnapshotFingerprint: 'input-fingerprint-v2-test',
        cases: [{
          productId: options.productId || 'case-v2-test', sku: options.sku || 'CASE-V2',
          sourceImageUrls: Array.from(new Set(imageRoleAssignments.map((row) => row.sourceImageUrl))),
          representativeSourceImageUrl: options.representativeSourceImageUrl || '',
          representativeCompletedImageUrl: options.representativeCompletedImageUrl || '',
          preparedCase: { imageRoleAssignments }
        }],
        platformImagePlan: {
          sharedCompletedImageUrls: [storefront, branded, clean, cleanTwo, ...detail],
          easyStore: { imageUrls: [storefront, clean, cleanTwo, branded, ...detail], requiredFirstRole: 'storefrontPortrait', ready: true },
          shopee: { imageUrls: [branded, clean, cleanTwo, ...detail], requiredFirstRole: 'brandedHero', ready: true },
          coupang: { imageUrls: [clean, cleanTwo, branded, ...detail], requiredFirstRole: 'cleanMain', ready: true, brandedHeroAllowedAsSecondary: true, removeSecondaryBrandedHeroIfPlatformRejectsGalleryLogo: true },
          momo: { imageUrls: [clean, cleanTwo, branded, ...detail], requiredFirstRole: 'cleanMain', ready: true, brandedHeroAllowedAsSecondary: true, promotionImageUrl: cleanTwo, promotionImageReady: true }
        }
      }
    }
  };
}

function fakeFirestore(seed = {}) {
  const store = new Map(Object.entries(seed));
  const makeRef = (path) => ({
    id: path.split('/').at(-1), path,
    async get() { const value = store.get(path); return { exists: value !== undefined, data: () => value }; },
    async set(value, options) { store.set(path, options && options.merge ? { ...(store.get(path) || {}), ...value } : value); }
  });
  return {
    collection(name) { return { doc(id) { return makeRef(`${name}/${id}`); } }; },
    async runTransaction(handler) {
      return handler({
        get: (ref) => ref.get(),
        set: (ref, value, options) => ref.set(value, options)
      });
    },
    get(path) { return store.get(path); },
    set(path, value) { store.set(path, value); },
    keys() { return Array.from(store.keys()); }
  };
}

function verifiedPlatformReceipt(stage, snapshot, listingId = `${stage}-listing`) {
  const planKey = stage === 'easyStore' ? 'easyStore' : stage;
  const price = stage === 'momo' ? snapshot.momoPrice : stage === 'coupang' ? snapshot.coupangPrice : snapshot.easyStorePrice;
  return {
    stage, listingId, sku: snapshot.sku, price, stock: snapshot.stock, status: 'published',
    platformListMatched: true, officialCatalogMatched: true,
    imageEvidenceComplete: true,
    appliedImageUrls: snapshot.platformImagePlan[planKey].imageUrls.slice(),
    officialImageUrls: snapshot.platformImagePlan[planKey].imageUrls.map((_, index) => `https://platform-cdn.example.com/${stage}/${index + 1}.jpg`)
  };
}

test('one canonical product description becomes safe marketplace HTML', () => {
  const html = helpers.productDescriptionToSafeHtml('好用的商品<script>alert(1)</script>\n\n商品特色\n1. 第一點\n2. 第二點\n\n商品規格\n型號：A&B');
  assert.equal(html, '<p>好用的商品&lt;script&gt;alert(1)&lt;/script&gt;</p><h3>商品特色</h3><ul><li>第一點</li><li>第二點</li></ul><h3>商品規格</h3><p>型號：A&amp;B</p>');
});

test('generic fallback copy is not accepted as a completed product description', () => {
  const generic = helpers.listingDescriptionContentStatus({
    productDescription: '本商品為柚子樂器販售的樂器或樂器配件，商品內容與規格以頁面圖片及實際出貨品為準。\n\n商品編號：TEST-1'
  });
  assert.equal(generic.ready, false);
  assert.equal(generic.genericFallback, true);
  assert.ok(generic.missing.includes('通用備援文案尚未改寫'));

  const structured = helpers.listingDescriptionContentStatus({
    productDescription: '商品特色\n1. 5A 規格\n\n使用方式\n1. 適合日常練習\n\n商品規格\n型號：5A'
  });
  assert.equal(structured.ready, true);
  assert.equal(structured.featureCount, 1);
});

test('listing snapshot applies fixed shop promos, MOMO delivery and compliance policy', () => {
  const snapshot = helpers.buildListingSnapshot('p-fixed', {
    internalSku: '1040160', internalName: 'Ibanez AZES40', currentStock: 1,
    easyStorePrice: 14800, momoPrice: 14800, coupangPrice: 14800
  }, {
    productDescription: '台灣繁體商品介紹', listingImageUrls: ['https://example.com/main.jpg'],
    shippingDecision: 'freight', packageLengthCm: 110, packageWidthCm: 45, packageHeightCm: 12, packageWeightKg: 5,
    enabledPlatforms: { easyStoreShopee: true, momo: true, coupang: true }
  });
  assert.match(snapshot.bodyHtml, /product-listing-description-promo-1\.jpg/);
  assert.match(snapshot.bodyHtml, /product-listing-description-promo-2\.jpg/);
  assert.deepEqual(snapshot.momoDelivery, { method: 'third-party', locationCode: '000001', locationLabel: '台中市圓環東路347號', carrier: '新竹物流' });
  assert.equal(snapshot.momoCatalogPolicy.targetListings, 1000);
  assert.equal(snapshot.momoCatalogPolicy.reservedSlots, 0);
  assert.equal(snapshot.momoCatalogPolicy.zeroStockAction, 'keep-published-by-default');
  assert.equal(snapshot.momoCatalogPolicy.preserveSoldOutWithSales, true);
  assert.equal(snapshot.regulatoryPolicy.ncc, 'fill-only-when-verified');
  assert.equal(snapshot.automationPolicy.duplicateGuard.reuseExistingDraft, true);
  assert.equal(snapshot.automationPolicy.duplicateGuard.neverCreateNewOnRetry, true);
  assert.equal(snapshot.automationPolicy.duplicateGuard.skipPreSubmitCatalogSearchWhenNoPlatformId, true);
  assert.equal(snapshot.automationPolicy.duplicateGuard.treatHandoffSkuAsNewWhenNoPlatformId, true);
  assert.equal(snapshot.automationPolicy.duplicateGuard.exactLookupOnlyForUncertainSubmitRecovery, true);
  assert.equal(snapshot.automationPolicy.version, 22);
  assert.equal(snapshot.automationPolicy.duplicateGuard.variantGroupIdentityIsClosedSkuSet, true);
  assert.equal(snapshot.automationPolicy.duplicateGuard.forbidBaseSkuAndNameFallbackForVariantGroups, true);
  assert.equal(snapshot.automationPolicy.publishVerification.easyStoreDraftCreationIsNotPublication, true);
  assert.equal(snapshot.automationPolicy.publishVerification.requireEveryVariantGroupSkuOnPublishedStorefront, true);
  assert.equal(snapshot.automationPolicy.workflowId, 'youzi-four-channel-listing-v3');
  assert.equal(snapshot.automationPolicy.immutableWorkflowUntilExplicitRuleChange, true);
  assert.equal(snapshot.automationPolicy.productDataChangesDoNotChangeExecutionOrder, true);
  assert.equal(snapshot.automationPolicy.retry.maximumAttempts, 4);
  assert.equal(snapshot.automationPolicy.retry.retrySameSkuAndDraftOnly, true);
  assert.ok(snapshot.automationPolicy.retry.transientFailureSignatures.includes('image-fetch-failed'));
  assert.deepEqual(snapshot.automationPolicy.publishVerification.requiredChecks, [
    'listing-id', 'exact-sku', 'price', 'status', 'one-official-list-match'
  ]);
  assert.equal(snapshot.automationPolicy.publishVerification.imageReceiptContract.postSubmitImageUrlCollectionRequired, false);
  assert.deepEqual(snapshot.automationPolicy.platformExecutionPlan.order, ['momo', 'coupang', 'easyStore', 'shopee']);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.mode, 'staggered-parallel');
  assert.deepEqual(snapshot.automationPolicy.platformExecutionPlan.parallelRoots, ['momo', 'coupang', 'easyStore']);
  assert.deepEqual(snapshot.automationPolicy.platformExecutionPlan.dependencies.shopee, ['easyStore']);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.easyStoreStartsOnlyAfterMomoAndCoupangVerified, false);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.browserScheduler.interactionConcurrency, 1);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.browserScheduler.releaseInteractionLockDuringWait, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.preflightAllListingDataBeforePlatformNavigation, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.finalSubmissionAuthorizedByHandoff, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.routineSecondConfirmationForbidden, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.applicationConfirmationUiDisabledAfterHandoff, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.authorizationCoversRoutineFinalSubmitOnAllFourPlatforms, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.continueAutomaticallyAfterEachVerifiedStage, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.prepareCompleteFieldPlanBeforeFirstPlatform, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.preparedFieldPlanIsImmutableForWholeJob, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.pageContractReuse.applyFixedFieldsWithoutWholePageRescan, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.pageContractReuse.inspectOnlyDynamicCategoryAttributesAndErrors, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.pageContractReuse.rescanCurrentSectionOnlyWhenLayoutSignatureChanges, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.pageContractReuse.persistStableSelectorsAndFieldSemantics, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.pageContractReuse.fallbackToSectionRescanWithoutRestartingJob, true);
  assert.deepEqual(snapshot.preparedPlatformFieldPlan.platformOrder, ['momo', 'coupang', 'easyStore', 'shopee']);
  assert.equal(snapshot.preparedPlatformFieldPlan.version, 12);
  assert.equal(snapshot.automationPolicy.version, 22);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.requireStructuredVerifiedDescriptionBeforePreparedSnapshot, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.genericFallbackDescriptionIsIncomplete, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.writeVerifiedDescriptionBackToEveryGroupedCase, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.prepareShopeeAdvancedDescriptionBeforeNavigation, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeePageMayApplyPreparedContentButMustNotReanalyzeIt, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeAdvancedDescriptionMustVerifyTextAndEveryPreparedImageBeforePublish, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeAdvancedDescriptionMissingImagesMustBeInsertedIntoSameEditor, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeAdvancedDescriptionMayNotReportSuccessFromButtonClickAlone, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.batchFieldExecution.mode, 'section-batch');
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.batchFieldExecution.validateStableSectionAfterBatch, false);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.batchFieldExecution.validateDynamicSectionOnceAfterBatch, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.batchFieldExecution.stableNativeControlsSinglePass, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.batchSections.length, 5);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.coupang.batchSections.length, 5);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.easyStore.batchSections.length, 4);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.shopee.batchSections.length, 5);
  assert.equal(snapshot.preparedPlatformFieldPlan.executionGraph.mode, 'staggered-parallel');
  assert.deepEqual(snapshot.preparedPlatformFieldPlan.executionGraph.parallelRoots, ['momo', 'coupang', 'easyStore']);
  assert.equal(snapshot.preparedPlatformFieldPlan.immutableForJob, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.momo.fixedFields.thirdPartyLocationCode, '000001');
  assert.equal(snapshot.preparedPlatformFieldPlan.momo.fixedFields.warrantyDays, 180);
  assert.equal(snapshot.preparedPlatformFieldPlan.shopee.fixedFields.workspace, 'easystore-shopee-channel-sync');
  assert.equal(snapshot.preparedPlatformFieldPlan.shopee.fixedFields.advancedDescription.requireTextAndEveryPreparedImageBeforePublish, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.shopee.fixedFields.advancedDescription.insertMissingPreparedImagesIntoSameEditor, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.fixedDefaults.warrantyDays, 180);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.fixedDefaults.momoThirdPartyLocationCode, '000001');
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.fixedDefaults.momoThirdPartyLocationRequired, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.canonicalWorkspace, 'easystore-shopee-channel-sync');
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.singleWorkspaceOnly, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.neverOpenDirectShopeeSellerEditor, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.startImmediatelyAfterEasyStoreVerified, true);
  assert.equal(snapshot.automationPolicy.platformExecution