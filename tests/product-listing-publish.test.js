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
      workflowVersion: 'youzi-four-channel-listing-v2',
      preflightSnapshot: {
        workflowVersion: 'youzi-four-channel-listing-v2', snapshotId: 'snapshot-v2-test',
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
  assert.equal(snapshot.automationPolicy.version, 16);
  assert.equal(snapshot.automationPolicy.duplicateGuard.variantGroupIdentityIsClosedSkuSet, true);
  assert.equal(snapshot.automationPolicy.duplicateGuard.forbidBaseSkuAndNameFallbackForVariantGroups, true);
  assert.equal(snapshot.automationPolicy.publishVerification.easyStoreDraftCreationIsNotPublication, true);
  assert.equal(snapshot.automationPolicy.publishVerification.requireEveryVariantGroupSkuOnPublishedStorefront, true);
  assert.equal(snapshot.automationPolicy.workflowId, 'youzi-four-channel-listing-v2');
  assert.equal(snapshot.automationPolicy.immutableWorkflowUntilExplicitRuleChange, true);
  assert.equal(snapshot.automationPolicy.productDataChangesDoNotChangeExecutionOrder, true);
  assert.equal(snapshot.automationPolicy.retry.maximumAttempts, 4);
  assert.equal(snapshot.automationPolicy.retry.retrySameSkuAndDraftOnly, true);
  assert.ok(snapshot.automationPolicy.retry.transientFailureSignatures.includes('image-fetch-failed'));
  assert.deepEqual(snapshot.automationPolicy.publishVerification.requiredChecks, [
    'platform-list', 'official-catalog', 'exact-sku', 'price', 'stock', 'status',
    'applied-image-plan', 'official-image-list', 'no-frozen-source-image'
  ]);
  assert.equal(snapshot.automationPolicy.publishVerification.imageReceiptContract.officialImageUrlsMayUsePlatformCdn, true);
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
  assert.equal(snapshot.preparedPlatformFieldPlan.version, 8);
  assert.equal(snapshot.automationPolicy.version, 16);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.requireStructuredVerifiedDescriptionBeforePreparedSnapshot, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.genericFallbackDescriptionIsIncomplete, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.writeVerifiedDescriptionBackToEveryGroupedCase, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.batchFieldExecution.mode, 'section-batch');
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.batchFieldExecution.validateSectionOnceAfterBatch, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.batchFieldExecution.stableNativeControlsSinglePass, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.batchSections.length, 5);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.coupang.batchSections.length, 5);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.easyStore.batchSections.length, 4);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.shopee.batchSections.length, 4);
  assert.equal(snapshot.preparedPlatformFieldPlan.executionGraph.mode, 'staggered-parallel');
  assert.deepEqual(snapshot.preparedPlatformFieldPlan.executionGraph.parallelRoots, ['momo', 'coupang', 'easyStore']);
  assert.equal(snapshot.preparedPlatformFieldPlan.immutableForJob, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.momo.fixedFields.thirdPartyLocationCode, '000001');
  assert.equal(snapshot.preparedPlatformFieldPlan.momo.fixedFields.warrantyDays, 180);
  assert.equal(snapshot.preparedPlatformFieldPlan.shopee.fixedFields.workspace, 'easystore-shopee-channel-sync');
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.fixedDefaults.warrantyDays, 180);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.fixedDefaults.momoThirdPartyLocationCode, '000001');
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.fixedDefaults.momoThirdPartyLocationRequired, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.canonicalWorkspace, 'easystore-shopee-channel-sync');
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.singleWorkspaceOnly, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.neverOpenDirectShopeeSellerEditor, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.startImmediatelyAfterEasyStoreVerified, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.doNotWaitForMomoOrCoupang, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.executionGraph.shopeeStartsImmediatelyAfterEasyStoreVerified, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.executionGraph.shopeeDoesNotWaitForMomoOrCoupang, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.closeEmbeddedChatBeforeFormInteraction, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.variantImageSource, 'existing-easystore-completed-gallery');
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.neverOpenNativeFilePickerForVariantImages, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.fillRequiredWeightFromPreparedPackageBeforePreparePublish, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.completeVariantImagesBeforePreparePublish, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.reusePreparedPayload, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.neverRestartResearchOrImageProcessing, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.retrySameChannelProductAndPage, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.shopeeHandoff.verifyIn, 'easystore-shopee-channel-product-list');
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.coupangCreateFlow.route, 'create-via-image');
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.coupangCreateFlow.invalidGeneratedOptionRecovery.maximumRegenerations, 1);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.coupangCreateFlow.invalidGeneratedOptionRecovery.neverRegenerateAfterLaterSectionsCompleted, true);
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.coupangCreateFlow.invalidGeneratedOptionRecovery.lateFailureAction, 'repair-current-section-on-same-draft');
  assert.equal(snapshot.automationPolicy.platformExecutionPlan.coupangCreateFlow.pendingReviewIsNotActiveListing, true);
  assert.equal(snapshot.automationPolicy.momoPublishRecovery.resumeSameDraft, true);
  assert.equal(snapshot.automationPolicy.momoPublishRecovery.neverCreateReplacementDraft, true);
  assert.ok(snapshot.automationPolicy.momoPublishRecovery.reapplyWhenCleared.includes('third-party-location'));
  assert.equal(snapshot.automationPolicy.momoPublishRecovery.permissionDeniedIsPermanentBlocker, true);
  assert.equal(snapshot.automationPolicy.momoPublishRecovery.neverRetryPermissionDeniedWithReplacementDraft, true);
  assert.deepEqual(snapshot.automationPolicy.momoSpecialPromotionImage.preferredProductImagePositions, [2, 3]);
  assert.equal(snapshot.automationPolicy.momoSpecialPromotionImage.materialBankInsertRequired, true);
  assert.equal(snapshot.automationPolicy.momoSpecialPromotionImage.saveReopenAndVerifyImageRequired, true);
  assert.equal(snapshot.automationPolicy.momoSpecialPromotionImage.persistedImageEvidence, 'contenteditable-html-img-src');
  assert.equal(snapshot.automationPolicy.momoSpecialPromotionImage.editorElementIdMayChangeAfterReopen, true);
  assert.equal(snapshot.automationPolicy.momoSpecialPromotionImage.insertionTarget, 'rich-description-editor');
  assert.equal(snapshot.automationPolicy.momoSpecialPromotionImage.mainOrAdvertisementImageIsNeverPromotionEvidence, true);
  assert.equal(snapshot.automationPolicy.momoStoreCategories.maximumCount, 5);
  assert.equal(snapshot.momoSpecialPromotionImageUrl, '');
  assert.equal(snapshot.automationPolicy.browserControl.workspace, 'codex-in-app-browser');
  assert.equal(snapshot.automationPolicy.browserControl.neverUsePrimaryChrome, true);
  assert.equal(snapshot.automationPolicy.browserControl.reuseExistingAuthenticatedPlatformTabs, true);
  assert.equal(snapshot.automationPolicy.browserControl.allowSavedCredentialLoginRetry, true);
  assert.equal(snapshot.automationPolicy.browserControl.neverOpenNativeWindowsFilePicker, true);
  assert.equal(snapshot.automationPolicy.browserControl.stopForInteractiveAuthenticationOnly, true);
  assert.equal(snapshot.automationPolicy.browserTabs.keepOneAuthenticatedAnchorPerPlatform, true);
  assert.equal(snapshot.imagePolicy.mainImageTemplate, 'youzi-light-commercial-template-v3');
  assert.equal(snapshot.imagePolicy.mainImageAspectRatio, 'channel-specific');
  assert.equal(snapshot.imagePolicy.mainImageBackdrop, 'low-saturation-light-commercial');
  assert.equal(snapshot.imagePolicy.mainImageProductPlacement, 'right-or-center-right');
  assert.deepEqual(snapshot.imagePolicy.outputProfiles.storefrontPortrait, {
    role: 'storefrontPortrait', widthPx: 750, heightPx: 1000, aspectRatio: '3:4',
    firstImageFor: ['easyStore'], commercialInformationDensity: 'rich-but-readable',
    verifiedFeatureCount: { minimum: 3, maximum: 5 }, verifiedDetailInsetMaximum: 2,
    preserveGreenOuterEdge: true, removeMascot: true, removePicCollage: true,
    brandHeaderGeometryLockedToOriginalTemplate: true,
    preserveOriginalBrandHeaderHeightWidthLogoAndSloganPlacement: true,
    neverCompressStretchOrReflowBrandHeader: true
  });
  assert.equal(snapshot.imagePolicy.outputProfiles.brandedHero.brandHeaderGeometryLockedToOriginalTemplate, true);
  assert.deepEqual(snapshot.imagePolicy.sourceNormalization.preferredLongEdgeRangePx, { minimum: 1600, maximum: 2000 });
  assert.equal(snapshot.imagePolicy.sourceNormalization.targetLongEdgePx, 1800);
  assert.equal(snapshot.imagePolicy.sourceNormalization.neverUpscale, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.sourceImageNormalization.downscaleWhenAbovePx, 2400);
  assert.deepEqual(snapshot.imagePolicy.sharedDeliveryAssetStandard, {
    strategy: 'strictest-common-square-marketplace-profile',
    widthPx: 1000,
    heightPx: 1000,
    aspectRatio: '1:1',
    colorSpace: 'sRGB',
    preferredFormat: 'image/jpeg',
    maximumFileBytes: 1000000,
    normalizeOnceBeforePlatformNavigation: true,
    platformRecropForbiddenUnlessRejectedByPlatform: true,
    squareMarketplaceProfilesShareDimensions: true
  });
  assert.equal(snapshot.preparedPlatformFieldPlan.storefrontPortraitAssetStandard.aspectRatio, '3:4');
  assert.equal(snapshot.preparedPlatformFieldPlan.decisionContractVersion, 1);
  assert.equal(snapshot.decisionContract.automaticFields.easyStoreFirstImageRole, 'storefrontPortrait');
  assert.equal(snapshot.decisionContract.judgmentFields.categoryAndAttributes.neverReclassifyInsideEachPlatform, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.canonicalShippingDecision.decidedOnceBeforePlatformNavigation, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.sharedImageAssetStandard.widthPx, 1000);
  assert.equal(snapshot.preparedPlatformFieldPlan.shopee.fixedFields.closeEmbeddedChatBeforeFormInteraction, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.shopee.fixedFields.variantImageSource, 'existing-easystore-completed-gallery');
  assert.equal(snapshot.preparedPlatformFieldPlan.shopee.fixedFields.neverOpenNativeFilePickerForVariantImages, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.shopee.preparedFields.packageWeightGrams, 5000);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.version, 3);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.verifiedFromLivePage, true);
  assert.ok(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.pageSignature.stableLandmarks.includes('發佈商品'));
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.imageConstraints.main.maximumCount, 6);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.imageConstraints.main.minimumFileBytes, 38000);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.imageConstraints.main.maximumFileBytes, 1000000);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.promotionInsertFlow.target, 'rich-description-editor');
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.promotionInsertFlow.requiredBeforeFirstSubmit, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.storeCategoryConstraints.maximumCount, 5);
  assert.ok(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.batchSections.at(-1).fields.includes('promotion-material-bank-image'));
  assert.ok(snapshot.preparedPlatformFieldPlan.platformPageContracts.easyStore.fieldOrder.includes('seo-url-and-meta-description'));
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.shopee.routeKey, 'easystore-shopee-channel-sync');
  assert.ok(snapshot.preparedPlatformFieldPlan.platformPageContracts.shopee.authenticatedLandmarks.includes('已連接'));
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.coupang.loginProbe.submitLabel, '登入');
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.coupang.version, 3);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.coupang.verifiedFromLivePage, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.coupang.routeKey, 'coupang-create-via-image-or-same-draft');
  assert.ok(snapshot.preparedPlatformFieldPlan.platformPageContracts.coupang.fieldOrder.includes('generate-product-information'));
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.coupang.generatedOptionRecovery.maximumAttempts, 1);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.coupang.generatedOptionRecovery.neverRegenerateAfterLaterSectionsCompleted, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.coupang.interactionPolicy.preserveCompletedSections, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.coupang.submissionVerification.exactSkuLookupMaximum, 1);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.newCaseBoundary.resetOncePerDifferentSku, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.newCaseBoundary.keepSameSkuSameDraftOnRetry, true);
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.momo.canonicalEntry.route, 'B101 新增/管理商品');
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.coupang.canonicalEntry.route, '商品管理/建立商品');
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.easyStore.canonicalEntry.route, '商品清單/新增商品');
  assert.equal(snapshot.preparedPlatformFieldPlan.platformPageContracts.shopee.canonicalEntry.route, 'EasyStore 官方蝦皮通路商品清單');
  assert.equal(snapshot.preparedPlatformFieldPlan.coupang.fixedFields.complianceModel, 'TW_General');
  assert.equal(snapshot.preparedPlatformFieldPlan.coupang.fixedFields.responsibleSeller, '尚品樂器行');
  assert.equal(snapshot.preparedPlatformFieldPlan.coupang.preparedFields.shipping.convenienceStore.enabled, false);
  assert.equal(snapshot.preparedPlatformFieldPlan.coupang.interactionPolicy.neverSearchByTitle, true);
});

test('Coupang shipping is decided once and enables convenience stores only within 101 cm and 10 kg', () => {
  const compact = helpers.buildCoupangShipping({
    packageLengthCm: 45, packageWidthCm: 35, packageHeightCm: 15, packageWeightKg: 3
  });
  assert.equal(compact.packageTotalCm, 95);
  assert.equal(compact.sellerDelivery.enabled, true);
  assert.equal(compact.convenienceStore.enabled, true);
  assert.deepEqual(compact.convenienceStore.stores, ['7-ELEVEN', 'FamilyMart']);
  assert.equal(compact.requiresJudgment, false);

  const oversize = helpers.buildCoupangShipping({
    packageLengthCm: 60, packageWidthCm: 35, packageHeightCm: 15, packageWeightKg: 3
  });
  assert.equal(oversize.packageTotalCm, 110);
  assert.equal(oversize.sellerDelivery.enabled, true);
  assert.equal(oversize.convenienceStore.enabled, false);
  assert.deepEqual(oversize.convenienceStore.stores, []);
});

test('正式發布先完成四通路預檢，再交錯啟動三個根平台且蝦皮只依賴 EasyStore', () => {
  const backend = fs.readFileSync('functions/productListingPublish.js', 'utf8');
  const deployWorkflow = fs.readFileSync('.github/workflows/deploy-product-listing.yml', 'utf8');
  const publishStart = backend.indexOf('async function publishProductListingCaseHandler');
  const verifyStart = backend.indexOf('target.verifyProductListingStage = onCall');
  const handler = backend.slice(publishStart, verifyStart);
  const verifier = backend.slice(verifyStart, backend.indexOf('\n}', verifyStart));
  const finalizedMedia = handler.indexOf('loadFinalPreparedMediaSnapshot');
  const preflight = handler.indexOf('preflightMissing = {');
  const job = handler.indexOf('await jobRef.set', preflight);
  const roots = handler.indexOf("{ stage: 'momo', platform: 'MOMO'", job);
  const coupang = handler.indexOf("{ stage: 'coupang', platform: 'Coupang'", roots);
  const easyStore = handler.indexOf('publishEasyStoreStageWithRetry(db, jobId, snapshot, product)', coupang);
  const parallel = handler.indexOf('await Promise.all(operations.map', easyStore);
  assert.ok(finalizedMedia >= 0 && preflight > finalizedMedia && job > preflight && roots > job && coupang > roots && easyStore > coupang && parallel > easyStore);
  assert.match(handler, /platformImagePlanMissingFields\(snapshot\.platformImagePlan, \{ requireFinalized: true \}\)/);
  assert.match(handler, /queueFixedIpPlatform\(db, jobId, entry\.platform/);
  assert.match(handler, /executionMode: 'staggered-parallel'/);
  assert.match(handler, /blocked-by-dependency/);
  assert.doesNotMatch(handler, /blocked-by-previous-stage/);
  assert.match(verifier, /validatePlatformStageVerification/);
  assert.match(verifier, /requestedStage !== 'shopee'/);
  assert.doesNotMatch(verifier, /requestedStage === 'coupang'/);
  assert.match(verifier, /finalizeVerifiedShopeeStage/);
  assert.match(handler, /四通路單次預檢未通過；尚未操作任何平台/);
  assert.match(handler, /identityAllowsShopeeAutofill\(snapshot\.identityStatus, snapshot\.identityManualConfirmed\)/);
  assert.match(handler, /蝦皮商品身分／型號確認/);
  assert.match(handler, /shopeeLogistics\.requiresConfirmation/);
  assert.match(handler, /preparedSnapshot: snapshot/);
  assert.match(handler, /preparedSnapshotFingerprint: listingSnapshotFingerprint\(snapshot\)/);
  assert.match(deployWorkflow, /functions:autoPublishProductListingCase/);
  assert.match(deployWorkflow, /functions:verifyProductListingStage/);
  assert.match(backend, /target\.autoPublishProductListingCase = onDocumentWritten/);
  assert.match(deployWorkflow, /functions:applyProductListingQueueReceipt/);
  assert.match(backend, /target\.applyProductListingQueueReceipt = onDocumentWritten/);
});

test('通路正式核對必須同時符合 SKU、價格、庫存、清單與正式商品資料', () => {
  const sourceUrl = 'https://example.com/source.jpg';
  const completedUrl = 'https://example.com/completed.jpg';
  const snapshot = {
    sku: 'ABC-1', easyStorePrice: 500, coupangPrice: 520, momoPrice: 530, stock: 3,
    platformImagePlan: {
      roleAssignments: [{ sourceImageUrl: sourceUrl, url: completedUrl, roles: ['cleanMain'] }],
      coupang: { imageUrls: [completedUrl] }, momo: { imageUrls: [completedUrl] }
    }
  };
  const ok = helpers.validatePlatformStageVerification('coupang', snapshot, {
    listingId: 'CP-1', sku: 'abc-1', price: 520, stock: 3, status: 'under-review',
    platformListMatched: true, officialCatalogMatched: true,
    imageEvidenceComplete: true, appliedImageUrls: [completedUrl], officialImageUrls: ['https://platform.example.com/cdn/completed.jpg']
  });
  assert.equal(ok.verified, true);
  const bad = helpers.validatePlatformStageVerification('momo', snapshot, {
    listingId: 'MM-1', sku: 'ABC-1', price: 999, stock: 3, status: 'published',
    platformListMatched: true, officialCatalogMatched: false,
    imageEvidenceComplete: true, appliedImageUrls: [sourceUrl], officialImageUrls: [sourceUrl]
  });
  assert.equal(bad.verified, false);
  assert.ok(bad.reasons.includes('price-mismatch'));
  assert.ok(bad.reasons.includes('official-catalog-not-matched'));
  assert.ok(bad.reasons.includes('applied-image-evidence-contains-frozen-source'));
  assert.ok(bad.reasons.includes('official-image-evidence-contains-frozen-source'));
});

test('正式圖片回條分開驗證 applied plan 與平台 CDN，缺證或任一組含來源圖都拒絕', () => {
  const source = 'https://supplier.example.com/original.jpg';
  const completed = 'https://cdn.example.com/final.jpg';
  const snapshot = {
    sku: 'IMG-EVIDENCE', coupangPrice: 900, stock: 2,
    platformImagePlan: {
      roleAssignments: [{ productId: 'evidence-product', sourceImageUrl: source, url: completed, roles: ['cleanMain'] }],
      coupang: { imageUrls: [completed] }
    }
  };
  const cdnReceipt = {
    listingId: 'CP-EVIDENCE', sku: 'IMG-EVIDENCE', price: 900, stock: 2, status: 'published',
    platformListMatched: true, officialCatalogMatched: true, imageEvidenceComplete: true,
    appliedImageUrls: [completed],
    officialImageUrls: ['https://platform-cdn.example.com/resized/final-123.webp']
  };
  assert.equal(helpers.validatePlatformStageVerification('coupang', snapshot, cdnReceipt).verified, true);

  const missingOfficial = helpers.validatePlatformStageVerification('coupang', snapshot, {
    ...cdnReceipt, officialImageUrls: []
  });
  assert.equal(missingOfficial.verified, false);
  assert.ok(missingOfficial.reasons.includes('missing-or-invalid-official-image-evidence'));

  const sourceApplied = helpers.validatePlatformStageVerification('coupang', snapshot, {
    ...cdnReceipt, appliedImageUrls: [source]
  });
  assert.equal(sourceApplied.verified, false);
  assert.ok(sourceApplied.reasons.includes('applied-image-evidence-contains-frozen-source'));

  const sourceOfficial = helpers.validatePlatformStageVerification('coupang', snapshot, {
    ...cdnReceipt, officialImageUrls: [source]
  });
  assert.equal(sourceOfficial.verified, false);
  assert.ok(sourceOfficial.reasons.includes('official-image-evidence-contains-frozen-source'));
});

test('queue receipt only advances the matching v2 job, attempt and immutable snapshot', () => {
  const snapshot = {
    productId: 'product-1', sku: 'ABC-1', easyStorePrice: 500, coupangPrice: 520, momoPrice: 530,
    stock: 3, title: '商品', description: '介紹', images: ['https://example.com/1.jpg'],
    platformImagePlan: {
      roleAssignments: [{ sourceImageUrl: 'https://example.com/source-1.jpg', url: 'https://example.com/1.jpg', roles: ['cleanMain'] }],
      coupang: { imageUrls: ['https://example.com/1.jpg'] }
    }
  };
  const fingerprint = helpers.platformStageFingerprint('Coupang', snapshot);
  const snapshotFingerprint = helpers.listingSnapshotFingerprint(snapshot);
  const job = {
    id: 'job-1', workflowVersion: 'youzi-four-channel-listing-v2', productId: 'product-1', currentStage: 'coupang',
    preparedSnapshot: snapshot, preparedSnapshotFingerprint: snapshotFingerprint,
    stages: { coupang: { status: 'awaiting-verification', attemptToken: 'attempt-1', fingerprint } }
  };
  const record = {
    workflowVersion: 'youzi-four-channel-listing-v2', jobId: 'job-1', productId: 'product-1', platform: 'Coupang',
    status: 'submitted-to-platform-review', attemptToken: 'attempt-1', fingerprint, snapshotFingerprint,
    verificationReceipt: {
      stage: 'coupang', listingId: 'CP-1', sku: 'ABC-1', price: 520, stock: 3, status: 'under-review',
      platformListMatched: true, officialCatalogMatched: true,
      imageEvidenceComplete: true,
      appliedImageUrls: ['https://example.com/1.jpg'],
      officialImageUrls: ['https://platform.example.com/cdn/1.jpg']
    }
  };
  assert.equal(helpers.validateQueuedStageReceipt(job, record).verified, true);
  const staleAttempt = helpers.validateQueuedStageReceipt(job, { ...record, attemptToken: 'old-attempt' });
  assert.equal(staleAttempt.verified, false);
  assert.ok(staleAttempt.reasons.includes('attempt-token-mismatch'));
  const oldWorkflow = helpers.validateQueuedStageReceipt(job, { ...record, workflowVersion: 'youzi-four-channel-listing-v1' });
  assert.equal(oldWorkflow.verified, false);
  assert.ok(oldWorkflow.reasons.includes('workflow-version-mismatch'));
  const oldJob = helpers.validateQueuedStageReceipt({ ...job, workflowVersion: 'youzi-four-channel-listing-v1' }, record);
  assert.equal(oldJob.verified, false);
  assert.ok(oldJob.reasons.includes('workflow-version-mismatch'));
});

test('MOMO、酷澎與 EasyStore 可獨立完成，蝦皮只依賴 EasyStore，最後一張回條才完成整筆工作', async () => {
  const productId = 'state-product';
  const jobId = 'state-job';
  const cleanUrl = 'https://example.com/state-clean.jpg';
  const snapshot = helpers.buildListingSnapshot(productId, {
    internalSku: 'STATE-001', internalName: '狀態機測試商品', currentStock: 3,
    easyStorePrice: 990, momoPrice: 990, coupangPrice: 990, imageUrl: cleanUrl, imageUrls: [cleanUrl]
  }, withV2ImagePlan({ productDescription: '完整商品介紹' }, { productId, sku: 'STATE-001', clean: cleanUrl }));
  const snapshotFingerprint = helpers.listingSnapshotFingerprint(snapshot);
  const momoToken = 'momo-attempt';
  const momoFingerprint = helpers.platformStageFingerprint('MOMO', snapshot);
  const coupangToken = 'coupang-attempt';
  const coupangFingerprint = helpers.platformStageFingerprint('Coupang', snapshot);
  const stages = {
    momo: { status: 'awaiting-verification', attemptToken: momoToken, fingerprint: momoFingerprint },
    coupang: { status: 'awaiting-verification', attemptToken: coupangToken, fingerprint: coupangFingerprint },
    easyStore: { status: 'verified', productId: 'easy-product', variantIds: ['easy-variant'], receipt: verifiedPlatformReceipt('easyStore', snapshot) },
    shopee: { status: 'awaiting-verification', dependsOn: ['easyStore'] }
  };
  const db = fakeFirestore({
    [`opsSyncJobs/${jobId}`]: {
      workflowVersion: 'youzi-four-channel-listing-v2', productId, currentStage: 'shopee', status: 'submitted',
      preparedSnapshot: snapshot, preparedSnapshotFingerprint: snapshotFingerprint, stages,
      platforms: { easyStore: { status: 'created' }, shopee: { status: 'waiting-easystore-sync' } }
    },
    [`opsInternalProducts/${productId}`]: {
      internalSku: 'STATE-001', imageUrl: cleanUrl, imageUrls: [cleanUrl], completedListingImageUrls: [cleanUrl]
    },
    [`opsProductListingCases/${productId}`]: {
      centralImageReferenceVerification: { status: 'verified', cleanMainUrl: cleanUrl, imageUrls: [cleanUrl] }
    }
  });
  const queueReceipt = (platform, attemptToken, fingerprint, receipt) => ({
    workflowVersion: 'youzi-four-channel-listing-v2', jobId, productId, platform,
    attemptToken, fingerprint, snapshotFingerprint,
    status: 'completed', verificationReceipt: {
      ...receipt
    }
  });

  const shopeeResult = await helpers.finalizeVerifiedShopeeStage(db, jobId, {
    receipt: verifiedPlatformReceipt('shopee', snapshot)
  }, 'test-manager');
  assert.equal(shopeeResult.status, 'shopee-verified-waiting-other-platforms');
  assert.equal(db.get(`opsSyncJobs/${jobId}`).currentStage, 'parallel-platforms');

  const coupangReceipt = queueReceipt('Coupang', coupangToken, coupangFingerprint, verifiedPlatformReceipt('coupang', snapshot));
  const coupangResult = await helpers.applyVerifiedQueueReceipt(db, `${productId}_coupang`, coupangReceipt);
  assert.equal(coupangResult.status, 'coupang-verified');
  assert.equal(db.get(`opsSyncJobs/${jobId}`).stages.coupang.status, 'verified');
  assert.equal(db.get(`opsSyncJobs/${jobId}`).currentStage, 'parallel-platforms');

  const momoReceipt = queueReceipt('MOMO', momoToken, momoFingerprint, verifiedPlatformReceipt('momo', snapshot));
  const completion = await helpers.applyVerifiedQueueReceipt(db, `${productId}_momo`, momoReceipt);
  assert.equal(completion.status, 'completed');
  assert.equal(db.get(`opsSyncJobs/${jobId}`).currentStage, 'completed');
  assert.ok(db.get(`opsSyncJobs/${jobId}`).finishedAt);
  assert.equal(db.get(`opsProductListingCases/${productId}`).sourceImageRetentionPolicy.cleanupStatus, 'required');
  assert.equal(db.get(`opsProductListingCases/${productId}`).sourceImageRetentionPolicy.eligibleForDeletion, true);
});

test('MOMO special promotion image uses product image two or three and never store promotion assets', () => {
  const productImages = [
    'https://example.com/green-main.jpg',
    'https://example.com/product-detail-2.jpg',
    'https://example.com/product-detail-3.jpg'
  ];
  const snapshot = helpers.buildListingSnapshot('p-momo-special-promo', {
    internalSku: 'MOMO-PROMO', internalName: 'MOMO 專推圖測試', currentStock: 1,
    easyStorePrice: 1200, momoPrice: 1200, coupangPrice: 1200
  }, withV2ImagePlan({
    productDescription: '完整商品介紹', listingImageUrls: productImages,
    enabledPlatforms: { easyStoreShopee: true, momo: true, coupang: true }
  }, { branded: productImages[0], clean: productImages[1], cleanTwo: productImages[2] }));

  assert.equal(snapshot.momoSpecialPromotionImageUrl, productImages[2]);
  assert.equal(snapshot.momoSpecialPromotionImagePolicy.insertMethod, 'material-bank-selection');
  assert.equal(snapshot.momoSpecialPromotionImagePolicy.verification, 'save-reopen-confirm-image-before-publish');
  assert.notEqual(snapshot.momoSpecialPromotionImageUrl, snapshot.images.at(-1));
  assert.equal(snapshot.momoSpecialPromotionImageUrl.includes('store-promo'), false);
  assert.deepEqual(helpers.momoMissingFields(snapshot), []);
});

test('MOMO stops before queueing when only the branded first image exists', () => {
  const snapshot = helpers.buildListingSnapshot('p-momo-special-promo-missing', {
    internalSku: 'MOMO-PROMO-MISSING', internalName: '缺少專推商品圖', currentStock: 1, momoPrice: 1200
  }, {
    productDescription: '完整商品介紹', listingImageUrls: ['https://example.com/green-main.jpg'],
    enabledPlatforms: { easyStoreShopee: false, momo: true, coupang: false }
  });
  assert.equal(snapshot.momoSpecialPromotionImageUrl, '');
  assert.match(helpers.momoMissingFields(snapshot).join('、'), /MOMO cleanMain 首圖/);
  assert.match(helpers.momoMissingFields(snapshot).join('、'), /MOMO clean-only 專推圖/);
});

test('MOMO publish verification rejects a success dialog when persisted fields were cleared', () => {
  const result = helpers.evaluateMomoPublishVerification(
    { sku: '2500118', momoPrice: 350, stock: 4 },
    {
      sku: '2500118', status: '暫存', stock: 0, price: null,
      platformListMatched: true, officialCatalogMatched: false, successDialogShown: true
    }
  );
  assert.equal(result.verified, false);
  assert.equal(result.needsRetry, true);
  assert.deepEqual(result.reasons, ['still-draft', 'blank-price', 'expected-stock-mismatch', 'missing-from-official-catalog']);
  assert.equal(result.recoveryAction, 'resume-same-draft-and-reapply-cleared-fields');
  assert.equal(result.neverCreateReplacementDraft, true);
});

test('MOMO publish verification accepts matching list and official catalog data', () => {
  const result = helpers.evaluateMomoPublishVerification(
    { sku: '2500118', momoPrice: 350, stock: 4 },
    {
      sku: '2500118', status: '上架', stock: 4, price: 350,
      platformListMatched: true, officialCatalogMatched: true
    }
  );
  assert.equal(result.verified, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.recoveryAction, 'none');
});

test('listing snapshot keeps seven gallery slots and moves overflow product images before the two fixed description promos', () => {
  const productImages = Array.from({ length: 12 }, (_, index) => `https://example.com/product-${index + 1}.jpg`);
  const snapshot = helpers.buildListingSnapshot('p-images', {
    internalSku: 'IMG-12', internalName: '十二張圖片商品', currentStock: 1,
    easyStorePrice: 1200, momoPrice: 1200, coupangPrice: 1200
  }, {
    productDescription: '完整商品介紹', listingImageUrls: productImages,
    enabledPlatforms: { easyStoreShopee: true, momo: true, coupang: true }
  });

  assert.equal(snapshot.productImageUrls.length, 12);
  assert.equal(snapshot.images.length, 7);
  assert.deepEqual(snapshot.images.slice(0, 6), productImages.slice(0, 6));
  assert.match(snapshot.images[6], /product-listing-store-promo\.png$/);
  assert.deepEqual(snapshot.descriptionImageUrls, productImages.slice(6));
  assert.ok(snapshot.bodyHtml.indexOf('product-7.jpg') < snapshot.bodyHtml.indexOf('product-listing-description-promo-1.jpg'));
  assert.ok(snapshot.bodyHtml.indexOf('product-listing-description-promo-1.jpg') < snapshot.bodyHtml.indexOf('product-listing-description-promo-2.jpg'));
  assert.ok(snapshot.momoHtml.indexOf('product-7.jpg') < snapshot.momoHtml.indexOf('product-listing-description-promo-1.jpg'));
  assert.ok(snapshot.coupangDescriptionHtml.indexOf('product-7.jpg') < snapshot.coupangDescriptionHtml.indexOf('product-listing-description-promo-1.jpg'));
  assert.equal(snapshot.imagePolicy.galleryMaximum, 7);
  assert.equal(snapshot.imagePolicy.sourceImageMaximum, 20);
  assert.equal(snapshot.imagePolicy.sharedVariantGalleryMaximum, 12);
  assert.equal(snapshot.imagePolicy.balanceAcrossVariants, true);
  assert.equal(snapshot.contentPolicy.featureTarget, 10);
  assert.equal(snapshot.contentPolicy.usageTarget, 10);
  assert.equal(snapshot.contentPolicy.warrantyInDescription, false);
  assert.equal(snapshot.contentPolicy.appendStoreNameWhenSpaceAllows, '柚子樂器');
  assert.equal(snapshot.contentPolicy.interleaveCompletedImagesWhenSupported, true);
  assert.match(snapshot.description, /實際內容以收到的實體商品為準/);
  assert.match(snapshot.shopeeDescription, /實際內容以收到的實體商品為準/);
  assert.match(snapshot.momoHtml, /實際內容以收到的實體商品為準/);
  assert.match(snapshot.coupangDescriptionHtml, /實際內容以收到的實體商品為準/);
});

test('selected source images prioritize their localized completed images without exposing originals', () => {
  const sourceOne = 'https://supplier.example.com/simple-1.jpg';
  const sourceTwo = 'https://supplier.example.com/simple-2.jpg';
  const completedOne = 'https://cdn.example.com/traditional-1.jpg';
  const completedTwo = 'https://cdn.example.com/traditional-2.jpg';
  const snapshot = helpers.buildListingSnapshot('p-priority', {
    internalSku: 'PRIORITY-1', internalName: '合併圖片排序', currentStock: 1,
    easyStorePrice: 1200, momoPrice: 1200, coupangPrice: 1200
  }, {
    productDescription: '完整商品介紹',
    listingImageUrls: [completedOne, completedTwo],
    gallerySourceImageUrls: [sourceTwo],
    generatedListingImages: [
      { sourceImageUrl: sourceOne, url: completedOne, status: 'ready', localizationStatus: 'completed', roles: ['cleanMain'], assetFlags: {} },
      { sourceImageUrl: sourceTwo, url: completedTwo, status: 'ready', localizationStatus: 'completed', roles: ['cleanMain'], assetFlags: {} }
    ],
    enabledPlatforms: { easyStoreShopee: true, momo: true, coupang: true }
  });

  assert.deepEqual(snapshot.productImageUrls.slice(0, 2), [completedTwo, completedOne]);
  assert.equal(snapshot.productImageUrls.includes(sourceTwo), false);
  assert.deepEqual(helpers.prioritizedListingImageUrls({ listingImageUrls: [completedOne, completedTwo], gallerySourceImageUrls: [completedTwo] }), [completedTwo, completedOne]);
});

test('prepared role plan gives EasyStore a portrait hero, Shopee a square branded hero and Coupang/MOMO a clean main', () => {
  const productImages = Array.from({ length: 6 }, (_, index) => `https://example.com/product-${index + 1}.jpg`);
  const snapshot = helpers.buildListingSnapshot('p-platform-images', {
    internalSku: 'PLATFORM-IMG', internalName: '平台主圖測試', currentStock: 1,
    easyStorePrice: 1200, momoPrice: 1200, coupangPrice: 1200
  }, withV2ImagePlan({
    productDescription: '完整商品介紹', listingImageUrls: productImages,
    enabledPlatforms: { easyStoreShopee: true, momo: true, coupang: true }
  }, { storefront: productImages[0], branded: productImages[1], clean: productImages[2], cleanTwo: productImages[3], detail: productImages.slice(4) }));

  const momo = helpers.platformPayloadSnapshot('MOMO', snapshot);
  const coupang = helpers.platformPayloadSnapshot('Coupang', snapshot);
  assert.equal(snapshot.images[0], productImages[0]);
  assert.equal(momo.images[0], productImages[2]);
  assert.equal(momo.images[2], productImages[1]);
  assert.equal(coupang.images[0], productImages[2]);
  assert.equal(coupang.images.includes(productImages[1]), true);
  assert.equal(coupang.images.indexOf(productImages[1]) > 0, true);
  assert.equal(coupang.imagePolicy.brandedHeroAllowedAfterMain, true);
  assert.equal(coupang.imagePolicy.brandedHeroExcluded, false);
  assert.equal(coupang.imagePolicy.removeSecondaryBrandedHeroIfPlatformRejectsGalleryLogo, true);
  assert.deepEqual(helpers.coupangMissingFields(snapshot), []);
});

test('v2 image gates reject source URLs disguised as completed outputs and dirty clean-main roles', () => {
  const sameUrl = 'https://example.com/not-really-completed.jpg';
  const sameSourceCase = withV2ImagePlan({ productDescription: '介紹' }, { clean: sameUrl });
  const sameSourceAssignment = sameSourceCase.codexHandoff.preflightSnapshot.cases[0].preparedCase.imageRoleAssignments
    .find((row) => row.url === sameUrl);
  sameSourceAssignment.sourceImageUrl = sameUrl;
  const sameSourceSnapshot = helpers.buildListingSnapshot('unsafe-same-url', {
    internalSku: 'UNSAFE-1', internalName: '不安全圖', currentStock: 1,
    easyStorePrice: 100, momoPrice: 100, coupangPrice: 100
  }, sameSourceCase);
  assert.equal(sameSourceSnapshot.platformImagePlan.coupang.ready, false);
  assert.equal(helpers.localizedRepresentativeImage({ generatedListingImages: [{
    sourceImageUrl: sameUrl, url: sameUrl, status: 'ready', localizationStatus: 'completed',
    roles: ['cleanMain'], assetFlags: {}
  }] }, sameUrl), '');

  const dirtyCase = withV2ImagePlan({ productDescription: '介紹' });
  const cleanUrl = dirtyCase.codexHandoff.preflightSnapshot.platformImagePlan.coupang.imageUrls[0];
  const dirtyAssignment = dirtyCase.codexHandoff.preflightSnapshot.cases[0].preparedCase.imageRoleAssignments
    .find((row) => row.url === cleanUrl);
  dirtyAssignment.assetFlags.containsText = true;
  const dirtySnapshot = helpers.buildListingSnapshot('unsafe-clean', {
    internalSku: 'UNSAFE-2', internalName: '含字乾淨圖', currentStock: 1,
    easyStorePrice: 100, momoPrice: 100, coupangPrice: 100
  }, dirtyCase);
  assert.equal(dirtySnapshot.platformImagePlan.coupang.ready, false);
  assert.match(helpers.coupangMissingFields(dirtySnapshot).join('、'), /酷澎 cleanMain 首圖/);
});

test('12 張共用池先保留三種首圖角色並公平涵蓋 13 個細項', () => {
  const cleanFlags = { containsLogo: false, containsContactInfo: false, containsQrCode: false, containsText: false, greenBrandTemplate: false, momoPromotionEligible: true };
  const brandFlags = { ...cleanFlags, containsLogo: true, containsText: true, greenBrandTemplate: true, momoPromotionEligible: false };
  const cases = Array.from({ length: 13 }, (_, index) => ({
    productId: `variant-${index}`,
    gallerySourceImageUrls: [],
    roleRows: [
      { productId: `variant-${index}`, sourceImageUrl: `https://supplier.example.com/${index}-clean.jpg`, url: `https://cdn.example.com/variant-${index}-clean.jpg`, roles: ['cleanMain'], sourceOrder: 1, assetFlags: cleanFlags },
      { productId: `variant-${index}`, sourceImageUrl: `https://supplier.example.com/${index}-storefront.jpg`, url: `https://cdn.example.com/variant-${index}-storefront.jpg`, roles: ['storefrontPortrait'], sourceOrder: 1, assetFlags: brandFlags },
      { productId: `variant-${index}`, sourceImageUrl: `https://supplier.example.com/${index}-brand.jpg`, url: `https://cdn.example.com/variant-${index}-brand.jpg`, roles: ['brandedHero'], sourceOrder: 1, assetFlags: brandFlags }
    ]
  }));
  const plan = helpers.buildFinalPlatformImagePlan(cases);
  assert.equal(plan.sharedCompletedImageUrls.length, 12);
  assert.equal(plan.easyStore.ready, true);
  assert.equal(plan.shopee.ready, true);
  assert.match(plan.easyStore.imageUrls[0], /-storefront\.jpg$/);
  assert.match(plan.coupang.imageUrls[0], /-clean\.jpg$/);
  const represented = new Set(plan.sharedCompletedImageUrls.map((url) => /variant-(\d+)-/.exec(url)?.[1]).filter(Boolean));
  assert.equal(represented.size, 12);
});

test('上架圖片預覽未勾選的來源不會進入任何平台圖庫', () => {
  const cleanFlags = { containsLogo: false, containsContactInfo: false, containsQrCode: false, containsText: false, greenBrandTemplate: false, momoPromotionEligible: true };
  const brandFlags = { ...cleanFlags, containsLogo: true, containsText: true, greenBrandTemplate: true, momoPromotionEligible: false };
  const selectedSource = 'https://supplier.example.com/selected.jpg';
  const excludedSource = 'https://supplier.example.com/excluded.jpg';
  const plan = helpers.buildFinalPlatformImagePlan([{
    productId: 'strict-gallery', gallerySourceImageUrls: [selectedSource], roleRows: [
      { productId: 'strict-gallery', sourceImageUrl: selectedSource, url: 'https://cdn.example.com/selected-clean.jpg', roles: ['cleanMain'], sourceOrder: 1, assetFlags: cleanFlags },
      { productId: 'strict-gallery', sourceImageUrl: selectedSource, url: 'https://cdn.example.com/selected-storefront.jpg', roles: ['storefrontPortrait'], sourceOrder: 1, assetFlags: brandFlags },
      { productId: 'strict-gallery', sourceImageUrl: selectedSource, url: 'https://cdn.example.com/selected-brand.jpg', roles: ['brandedHero'], sourceOrder: 1, assetFlags: brandFlags },
      { productId: 'strict-gallery', sourceImageUrl: excludedSource, url: 'https://cdn.example.com/excluded-detail.jpg', roles: ['localizedDetail'], sourceOrder: 2, assetFlags: cleanFlags }
    ]
  }]);
  assert.equal(plan.sharedCompletedImageUrls.some((url) => url.includes('excluded-detail')), false);
  assert.equal(plan.easyStore.imageUrls.some((url) => url.includes('excluded-detail')), false);
  assert.equal(plan.coupang.imageUrls.some((url) => url.includes('excluded-detail')), false);
  assert.equal(plan.momo.imageUrls.some((url) => url.includes('excluded-detail')), false);
});

test('MOMO 前三張固定含 clean promo，且品牌次圖最多一張', () => {
  const cleanFlags = { containsLogo: false, containsContactInfo: false, containsQrCode: false, containsText: false, greenBrandTemplate: false, momoPromotionEligible: false };
  const promoFlags = { ...cleanFlags, momoPromotionEligible: true };
  const brandFlags = { ...cleanFlags, containsLogo: true, containsText: true, greenBrandTemplate: true };
  const plan = helpers.buildFinalPlatformImagePlan([{
    productId: 'momo-order', gallerySourceImageUrls: [], roleRows: [
      { productId: 'momo-order', sourceImageUrl: 'https://supplier.example.com/main.jpg', url: 'https://cdn.example.com/main-clean.jpg', roles: ['cleanMain'], sourceOrder: 1, assetFlags: cleanFlags },
      { productId: 'momo-order', sourceImageUrl: 'https://supplier.example.com/brand-1.jpg', url: 'https://cdn.example.com/brand-1.jpg', roles: ['brandedHero'], sourceOrder: 1, assetFlags: brandFlags },
      { productId: 'momo-order', sourceImageUrl: 'https://supplier.example.com/brand-2.jpg', url: 'https://cdn.example.com/brand-2.jpg', roles: ['brandedHero'], sourceOrder: 2, assetFlags: brandFlags },
      { productId: 'momo-order', sourceImageUrl: 'https://supplier.example.com/promo.jpg', url: 'https://cdn.example.com/promo-clean.jpg', roles: ['localizedDetail'], sourceOrder: 3, assetFlags: promoFlags }
    ]
  }]);
  assert.equal(plan.momo.promotionImageReady, true);
  assert.ok([plan.momo.imageUrls[1], plan.momo.imageUrls[2]].includes(plan.momo.promotionImageUrl));
  assert.equal(plan.momo.imageUrls.filter((url) => /brand-\d/.test(url)).length, 1);
});

test('中央辨識主圖保持 cleanMain，EasyStore storefrontPortrait 只另存平台圖且不覆寫中央主圖', () => {
  const productId = 'central-clean-product';
  const clean = 'https://cdn.example.com/central-clean.jpg';
  const branded = 'https://cdn.example.com/easystore-branded.jpg';
  const storefront = 'https://cdn.example.com/easystore-storefront.jpg';
  const snapshot = helpers.buildListingSnapshot(productId, {
    internalSku: 'CENTRAL-CLEAN', internalName: '中央圖測試', currentStock: 1,
    easyStorePrice: 500, momoPrice: 500, coupangPrice: 500
  }, withV2ImagePlan({ productDescription: '完整介紹' }, { productId, sku: 'CENTRAL-CLEAN', clean, branded, storefront }));
  assert.equal(snapshot.platformImagePlan.easyStore.imageUrls[0], storefront);
  const update = helpers.centralCompletedImageUpdate(snapshot, productId, {});
  assert.equal(update.imageUrl, clean);
  assert.notEqual(update.imageUrl, snapshot.platformImagePlan.easyStore.imageUrls[0]);
  assert.ok(update.imageUrls.includes(branded));
  assert.equal(update.imageUrls.some((url) => /source-/.test(url)), false);
  const backend = fs.readFileSync('functions/productListingPublish.js', 'utf8');
  assert.doesNotMatch(backend, /imageUrl:\s*snapshot\.images\[0\]/);
  assert.match(backend, /easyStoreListingImageUrls/);
});

test('第一次操作平台前先逐商品回寫中央完成圖，主商品與所有細項共用同一個安全關卡', () => {
  const backend = fs.readFileSync('functions/productListingPublish.js', 'utf8');
  const syncStart = backend.indexOf('async function syncPreparedCentralImagesBeforePublish');
  const syncEnd = backend.indexOf('function validateAllPlatformImageReceipts', syncStart);
  const sync = backend.slice(syncStart, syncEnd);
  const handlerStart = backend.indexOf('async function publishProductListingCaseHandler');
  const handlerEnd = backend.indexOf('function registerProductListingPublish', handlerStart);
  const handler = backend.slice(handlerStart, handlerEnd);
  assert.ok(syncStart >= 0 && syncEnd > syncStart);
  assert.match(sync, /preparedImageReferenceCases\(snapshot\)/);
  assert.match(sync, /centralCompletedImageUpdate\(snapshot, reference\.productId, productRecord\)/);
  assert.match(sync, /centralImageReferenceVerification/);
  assert.match(sync, /await batch\.commit\(\)/);
  assert.match(sync, /繁體完成圖回寫後重讀不一致/);
  const build = handler.indexOf('snapshot = buildListingSnapshot');
  const centralWrite = handler.indexOf('await syncPreparedCentralImagesBeforePublish', build);
  const platformLaunch = handler.indexOf('const operations = []', centralWrite);
  assert.ok(build >= 0 && centralWrite > build && platformLaunch > centralWrite);
});

test('四通路完成後主商品與每個細項都標記已發布，最近未上架不會殘留已完成細項', () => {
  const backend = fs.readFileSync('functions/productListingPublish.js', 'utf8');
  const start = backend.indexOf('async function finalizeListingJobIfReady');
  const end = backend.indexOf('async function finalizeVerifiedShopeeStage', start);
  const finalize = backend.slice(start, end);
  assert.match(finalize, /imageDocumentRefs\.map\(async \(reference\)/);
  assert.match(finalize, /reference\.caseRef\.set\(\{\s*caseStatus: 'published'/);
  assert.match(finalize, /reference\.productRef\.set\(\{/);
  assert.match(finalize, /platformListingStatusFromPublish\(reference\.product\.platformListingStatus, platforms\)/);
});

test('cleanup 前中央或細項仍引用 frozen source 即拒絕，四站完整圖片回條且中央全完成圖才通過', () => {
  const productId = 'cleanup-image-product';
  const source = 'https://example.com/source-clean.jpg';
  const clean = 'https://cdn.example.com/cleanup-clean.jpg';
  const snapshot = helpers.buildListingSnapshot(productId, {
    internalSku: 'CLEANUP-IMG', internalName: '清理安全測試', currentStock: 1,
    easyStorePrice: 500, momoPrice: 500, coupangPrice: 500
  }, withV2ImagePlan({ productDescription: '完整介紹' }, { productId, sku: 'CLEANUP-IMG', clean }));
  const stages = Object.fromEntries(['easyStore', 'shopee', 'coupang', 'momo'].map((stage) => [stage, {
    status: 'verified', receipt: verifiedPlatformReceipt(stage, snapshot)
  }]));
  const caseRecord = { centralImageReferenceVerification: { status: 'verified', cleanMainUrl: clean } };
  const unsafe = helpers.validateCompletionImageReferences(snapshot, [{
    productId, caseRecord,
    productRecord: { imageUrl: clean, imageUrls: [clean, source], variants: [{ imageUrl: source }] }
  }], stages);
  assert.equal(unsafe.verified, false);
  assert.ok(unsafe.reasons.includes(`${productId}:central-or-variant-image-still-frozen-source`));

  const safe = helpers.validateCompletionImageReferences(snapshot, [{
    productId, caseRecord,
    productRecord: { imageUrl: clean, imageUrls: [clean], completedListingImageUrls: [clean] }
  }], stages);
  assert.equal(safe.verified, true, safe.reasons.join(','));

  const missingImageReceipt = helpers.validateCompletionImageReferences(snapshot, [{
    productId, caseRecord,
    productRecord: { imageUrl: clean, imageUrls: [clean] }
  }], { ...stages, momo: { status: 'verified', receipt: { ...stages.momo.receipt, officialImageUrls: [] } } });
  assert.equal(missingImageReceipt.verified, false);
  assert.ok(missingImageReceipt.reasons.includes('momo:missing-or-invalid-official-image-evidence'));
});

test('pending handoff sources can receive later Codex outputs and become one immutable final publish snapshot', () => {
  const sourceOne = 'https://supplier.example.com/pending-1.jpg';
  const sourceTwo = 'https://supplier.example.com/pending-2.jpg';
  const flags = { containsLogo: false, containsContactInfo: false, containsQrCode: false, containsText: false, greenBrandTemplate: false, momoPromotionEligible: false };
  const frozen = {
    workflowVersion: 'youzi-four-channel-listing-v2', snapshotId: 'handoff-input-1', productId: 'late-product',
    cases: [{ productId: 'late-product', sku: 'LATE-1', sourceImageUrls: [sourceOne, sourceTwo], gallerySourceImageUrls: [sourceOne, sourceTwo] }]
  };
  const currentCase = {
    productSku: 'LATE-1', productDescription: '完整商品介紹',
    generatedListingImages: [
      { sourceImageUrl: sourceOne, url: 'https://cdn.example.com/late-clean.jpg', sourceOrder: 1, status: 'ready', localizationStatus: 'completed', roles: ['cleanMain'], assetFlags: { ...flags, momoPromotionEligible: true } },
      { sourceImageUrl: sourceOne, url: 'https://cdn.example.com/late-storefront.jpg', sourceOrder: 1, status: 'ready', localizationStatus: 'completed', roles: ['storefrontPortrait'], assetFlags: { ...flags, containsLogo: true, containsText: true, greenBrandTemplate: true } },
      { sourceImageUrl: sourceOne, url: 'https://cdn.example.com/late-branded.jpg', sourceOrder: 1, status: 'ready', localizationStatus: 'completed', roles: ['brandedHero'], assetFlags: { ...flags, containsLogo: true, containsText: true, greenBrandTemplate: true } },
      { sourceImageUrl: sourceTwo, url: 'https://cdn.example.com/late-detail.jpg', sourceOrder: 2, status: 'ready', localizationStatus: 'completed', roles: ['cleanMain'], assetFlags: { ...flags, momoPromotionEligible: true } }
    ]
  };
  const finalized = helpers.finalizePreparedMediaSnapshot(frozen, new Map([['late-product', currentCase]]));
  assert.equal(frozen.platformImagePlan, undefined);
  assert.equal(finalized.finalizedFromFrozenInput, true);
  assert.equal(finalized.inputSnapshotId, 'handoff-input-1');
  assert.equal(finalized.platformImagePlan.easyStore.imageUrls[0], 'https://cdn.example.com/late-storefront.jpg');
  assert.equal(finalized.platformImagePlan.coupang.imageUrls[0], 'https://cdn.example.com/late-clean.jpg');
  assert.equal(finalized.platformImagePlan.coupang.imageUrls[1], 'https://cdn.example.com/late-branded.jpg');
  assert.equal(finalized.platformImagePlan.momo.imageUrls[1], 'https://cdn.example.com/late-detail.jpg');
  assert.equal(finalized.platformImagePlan.momo.imageUrls[2], 'https://cdn.example.com/late-branded.jpg');
  assert.equal(finalized.platformImagePlan.momo.promotionImageUrl, 'https://cdn.example.com/late-detail.jpg');
  const rootCase = { ...currentCase, codexHandoff: { workflowVersion: 'youzi-four-channel-listing-v2', preflightSnapshot: frozen } };
  const snapshot = helpers.buildListingSnapshot('late-product', {
    internalSku: 'LATE-1', internalName: '晚到完成圖商品', currentStock: 2,
    easyStorePrice: 500, momoPrice: 500, coupangPrice: 500
  }, rootCase, null, null, finalized);
  assert.deepEqual(helpers.platformImagePlanMissingFields(snapshot.platformImagePlan, { requireFinalized: true }), []);
});

test('active v2 job 只復用目前 schema/policy/order/final snapshot/fingerprint 且必須符合案件 frozen input', () => {
  const productId = 'reuse-product';
  const frozen = {
    workflowVersion: 'youzi-four-channel-listing-v2', snapshotId: 'reuse-input', productId,
    cases: [{
      productId, sku: 'REUSE-1',
      sourceImageUrls: ['https://supplier.example.com/reuse-a.jpg', 'https://supplier.example.com/reuse-b.jpg']
    }]
  };
  const baseFlags = { containsLogo: false, containsContactInfo: false, containsQrCode: false, containsText: false, greenBrandTemplate: false, momoPromotionEligible: false };
  const listingCase = {
    productSku: 'REUSE-1', productDescription: '完整商品介紹',
    codexHandoff: { workflowVersion: 'youzi-four-channel-listing-v2', preflightSnapshot: frozen },
    generatedListingImages: [
      { sourceImageUrl: frozen.cases[0].sourceImageUrls[0], url: 'https://cdn.example.com/reuse-clean.jpg', status: 'ready', localizationStatus: 'completed', roles: ['cleanMain'], assetFlags: baseFlags },
      { sourceImageUrl: frozen.cases[0].sourceImageUrls[0], url: 'https://cdn.example.com/reuse-storefront.jpg', status: 'ready', localizationStatus: 'completed', roles: ['storefrontPortrait'], assetFlags: { ...baseFlags, containsLogo: true, containsText: true, greenBrandTemplate: true } },
      { sourceImageUrl: frozen.cases[0].sourceImageUrls[0], url: 'https://cdn.example.com/reuse-brand.jpg', status: 'ready', localizationStatus: 'completed', roles: ['brandedHero'], assetFlags: { ...baseFlags, containsLogo: true, containsText: true, greenBrandTemplate: true } },
      { sourceImageUrl: frozen.cases[0].sourceImageUrls[1], url: 'https://cdn.example.com/reuse-promo.jpg', status: 'ready', localizationStatus: 'completed', roles: ['localizedDetail'], assetFlags: { ...baseFlags, momoPromotionEligible: true } }
    ]
  };
  const finalized = helpers.finalizePreparedMediaSnapshot(frozen, new Map([[productId, listingCase]]));
  const snapshot = helpers.buildListingSnapshot(productId, {
    internalSku: 'REUSE-1', internalName: '復用測試', currentStock: 1,
    easyStorePrice: 500, momoPrice: 500, coupangPrice: 500
  }, listingCase, null, null, finalized);
  const job = {
    schemaVersion: 3,
    workflowVersion: 'youzi-four-channel-listing-v2',
    productId,
    currentStage: 'parallel-platforms',
    platformOrder: ['momo', 'coupang', 'easyStore', 'shopee'],
    preparedSnapshot: snapshot,
    preparedSnapshotFingerprint: helpers.listingSnapshotFingerprint(snapshot),
    stages: {
      momo: { status: 'verified', receipt: verifiedPlatformReceipt('momo', snapshot) },
      coupang: { status: 'awaiting-verification' },
      easyStore: { status: 'processing' },
      shopee: { status: 'blocked-by-dependency', dependsOn: ['easyStore'] }
    }
  };
  assert.deepEqual(helpers.activeV2JobReuseBlockers(job, productId, listingCase), []);
  const reverseKeys = (value) => {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).reverse().reduce((result, key) => {
      result[key] = reverseKeys(value[key]);
      return result;
    }, {});
  };
  const reorderedSnapshot = reverseKeys(snapshot);
  assert.deepEqual(helpers.activeV2JobReuseBlockers({
    ...job,
    preparedSnapshot: reorderedSnapshot,
    preparedSnapshotFingerprint: helpers.listingSnapshotFingerprint(snapshot)
  }, productId, listingCase), []);
  assert.ok(helpers.activeV2JobReuseBlockers({ ...job, schemaVersion: 1 }, productId, listingCase).includes('job-schema-version-mismatch'));
  const earlySnapshot = JSON.parse(JSON.stringify(snapshot));
  earlySnapshot.platformImagePlan.finalizedFromFrozenInput = false;
  earlySnapshot.platformImagePlan.source = 'codex-v2-prepared-snapshot';
  delete earlySnapshot.platformImagePlan.inputSnapshotFingerprint;
  assert.ok(helpers.activeV2JobReuseBlockers({
    ...job, preparedSnapshot: earlySnapshot,
    preparedSnapshotFingerprint: helpers.listingSnapshotFingerprint(earlySnapshot)
  }, productId, listingCase).includes('finalized-image-plan-invalid'));
  assert.ok(helpers.activeV2JobReuseBlockers({ ...job, platformOrder: ['momo', 'easyStore', 'coupang', 'shopee'] }, productId, listingCase).includes('job-platform-order-mismatch'));
  const changedFrozenCase = JSON.parse(JSON.stringify(listingCase));
  changedFrozenCase.codexHandoff.preflightSnapshot.cases[0].sourceImageUrls.push('https://supplier.example.com/new-source.jpg');
  assert.ok(helpers.activeV2JobReuseBlockers(job, productId, changedFrozenCase).includes('case-frozen-input-mismatch'));
  const changedFrozenData = JSON.parse(JSON.stringify(listingCase));
  changedFrozenData.codexHandoff.preflightSnapshot.preparedData = { stockSnapshot: 99 };
  assert.ok(helpers.activeV2JobReuseBlockers(job, productId, changedFrozenData).includes('case-frozen-input-mismatch'));
});

test('fingerprint 與 current policy deep compare 不受 Firestore 物件 key insertion order 影響', () => {
  const reverseKeys = (value) => {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).reverse().reduce((result, key) => {
      result[key] = reverseKeys(value[key]);
      return result;
    }, {});
  };
  const first = { z: 1, a: { second: 2, first: 1 }, rows: [{ b: 2, a: 1 }] };
  const reordered = reverseKeys(first);
  assert.equal(helpers.listingSnapshotFingerprint(first), helpers.listingSnapshotFingerprint(reordered));
  const queueSnapshot = {
    productId: 'stable-order', sku: 'STABLE-1', listingMode: 'standalone', title: '測試', description: '介紹',
    images: ['https://cdn.example.com/stable.jpg'], stock: 1,
    automationPolicy: { z: true, nested: { b: 2, a: 1 } },
    momoDelivery: { carrier: '新竹物流', method: 'third-party' }, momoCatalogPolicy: { b: 2, a: 1 }
  };
  assert.equal(
    helpers.platformQueueFingerprint('MOMO', queueSnapshot),
    helpers.platformQueueFingerprint('MOMO', reverseKeys(queueSnapshot))
  );
});

test('final publish snapshot rejects completed outputs whose source was not frozen at handoff', () => {
  const frozen = {
    workflowVersion: 'youzi-four-channel-listing-v2', snapshotId: 'handoff-input-rogue',
    cases: [{ productId: 'rogue-product', sku: 'ROGUE-1', sourceImageUrls: ['https://supplier.example.com/allowed.jpg'] }]
  };
  const flags = { containsLogo: false, containsContactInfo: false, containsQrCode: false, containsText: false, greenBrandTemplate: false, momoPromotionEligible: true };
  assert.throws(() => helpers.finalizePreparedMediaSnapshot(frozen, new Map([['rogue-product', {
    generatedListingImages: [{
      sourceImageUrl: 'https://supplier.example.com/not-frozen.jpg', url: 'https://cdn.example.com/rogue.jpg',
      status: 'ready', localizationStatus: 'completed', roles: ['cleanMain'], assetFlags: flags
    }]
  }]])), /完成圖來源不在凍結輸入清單/);
});

test('final publish snapshot rejects another frozen source URL disguised as a completed output', () => {
  const sourceOne = 'https://supplier.example.com/source-a.jpg';
  const sourceTwo = 'https://supplier.example.com/source-b.jpg';
  const frozen = {
    workflowVersion: 'youzi-four-channel-listing-v2', snapshotId: 'handoff-input-cross-source',
    cases: [{ productId: 'cross-source-product', sku: 'CROSS-1', sourceImageUrls: [sourceOne, sourceTwo] }]
  };
  const flags = { containsLogo: false, containsContactInfo: false, containsQrCode: false, containsText: false, greenBrandTemplate: false, momoPromotionEligible: true };
  assert.throws(() => helpers.finalizePreparedMediaSnapshot(frozen, new Map([['cross-source-product', {
    generatedListingImages: [
      {
        sourceImageUrl: sourceOne, url: sourceTwo,
        status: 'ready', localizationStatus: 'completed', roles: ['cleanMain'], assetFlags: flags
      },
      {
        sourceImageUrl: sourceTwo, url: 'https://cdn.example.com/localized-b.jpg',
        status: 'ready', localizationStatus: 'completed', roles: ['cleanMain'], assetFlags: flags
      }
    ]
  }]])), /完成圖仍是凍結來源原圖/);
});

test('final publish snapshot rejects a merged sibling source URL disguised as a completed output', () => {
  const sourceOne = 'https://supplier.example.com/merged-source-a.jpg';
  const sourceTwo = 'https://supplier.example.com/merged-source-b.jpg';
  const flags = { containsLogo: false, containsContactInfo: false, containsQrCode: false, containsText: false, greenBrandTemplate: false, momoPromotionEligible: true };
  const frozen = {
    workflowVersion: 'youzi-four-channel-listing-v2', snapshotId: 'handoff-input-cross-case-source',
    cases: [
      { productId: 'merged-source-a', sku: 'MERGED-A', sourceImageUrls: [sourceOne] },
      { productId: 'merged-source-b', sku: 'MERGED-B', sourceImageUrls: [sourceTwo] }
    ]
  };
  assert.throws(() => helpers.finalizePreparedMediaSnapshot(frozen, new Map([
    ['merged-source-a', { generatedListingImages: [{ sourceImageUrl: sourceOne, url: sourceTwo, status: 'ready', localizationStatus: 'completed', roles: ['cleanMain'], assetFlags: flags }] }],
    ['merged-source-b', { generatedListingImages: [{ sourceImageUrl: sourceTwo, url: 'https://cdn.example.com/merged-localized-b.jpg', status: 'ready', localizationStatus: 'completed', roles: ['cleanMain'], assetFlags: flags }] }]
  ])), /本組其他商品的凍結來源原圖/);
});

test('Coupang stops before queueing when no second clean product image exists', () => {
  const snapshot = helpers.buildListingSnapshot('p-coupang-image-missing', {
    internalSku: 'COUPANG-ONE-IMG', internalName: '只有綠底主圖', currentStock: 1, coupangPrice: 1200
  }, {
    productDescription: '完整商品介紹', listingImageUrls: ['https://example.com/green-template.jpg'],
    enabledPlatforms: { easyStoreShopee: false, momo: false, coupang: true }
  });
  assert.match(helpers.coupangMissingFields(snapshot).join('、'), /酷澎 cleanMain 首圖/);
});

test('one-click listing always targets all channels and falls back to the product price', () => {
  const snapshot = helpers.buildListingSnapshot('one-click-all', {
    internalSku: 'ONE-CLICK-ALL', internalName: '木製吉他腳踏板', currentStock: 2, storePrice: 500
  }, {
    productDescription: '木製吉他腳踏板，適合演奏時支撐腳部使用。',
    listingImageUrls: ['https://example.com/green.jpg', 'https://example.com/clean.jpg'],
    enabledPlatforms: { easyStoreShopee: false, momo: false, coupang: false }
  });

  assert.equal(snapshot.enabledEasyStoreShopee, true);
  assert.equal(snapshot.enabledMomo, true);
  assert.equal(snapshot.enabledCoupang, true);
  assert.equal(snapshot.easyStorePrice, 500);
  assert.equal(snapshot.momoPrice, 500);
  assert.equal(snapshot.coupangPrice, 500);
});

test('publish results become product-level platform status without claiming queued work is live', () => {
  const status = helpers.platformListingStatusFromPublish({}, {
    easyStore: { status: 'created', productId: 'es-1', message: '已建立' },
    momo: { status: 'awaiting-store-agent', message: '等待店內電腦' },
    coupang: { status: 'failed', message: '需處理' }
  });
  assert.equal(status.easyStore.status, 'active');
  assert.equal(status.easyStore.listingId, 'es-1');
  assert.equal(status.momo.status, 'queued');
  assert.equal(status.coupang.status, 'error');
});

test('EasyStore payload publishes one exact SKU with stock, price, package and at most seven gallery images', () => {
  const listingCase = {
    researchedProductName: 'Ibanez AZES40-MGR 電吉他',
    productDescription: '適合入門與日常練習。\n\n商品特色\n1. 輕巧好彈\n\n商品規格\n型號：AZES40-MGR',
    listingImageUrls: Array.from({ length: 12 }, (_, index) => `https://example.com/${index}.jpg`),
    packageLengthCm: 106.7, packageWidthCm: 45.7, packageHeightCm: 10.2, packageWeightKg: 4.2,
    enabledPlatforms: { easyStoreShopee: true, momo: false, coupang: false }
  };
  const snapshot = helpers.buildListingSnapshot('p1', {
    internalSku: ' 1040160-1 ', currentStock: 3, easyStorePrice: 14800, storePrice: 15900,
    latestPurchaseCost: 7400, barcode: '4549763289575'
  }, listingCase);
  const body = helpers.buildEasyStoreProductBody(snapshot, true).product;

  assert.equal(snapshot.sku, '1040160-1');
  assert.equal(snapshot.images.length, 7);
  assert.equal(body.inventory_management, 'easystore');
  assert.equal(body.images.length, 7);
  assert.equal(body.variants.length, 1);
  assert.deepEqual(body.variants[0], {
    sku: '1040160-1', barcode: '4549763289575', price: 14800, inventory_quantity: 3,
    width: 45.7, height: 10.2, length: 106.7, weight: 4.2, weight_unit: 'kg',
    inventory_policy: false, taxable: true, is_enabled: true, compare_at_price: 15900, cost_price: 7400
  });
  assert.match(body.body_html, /<h3>商品特色<\/h3>/);
  assert.match(body.published_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('zero stock remains published as out of stock and does not fail the EasyStore publish gate', () => {
  const snapshot = helpers.buildListingSnapshot('out-of-stock-1', {
    internalSku: 'OUT-OF-STOCK-1', currentStock: 0, easyStorePrice: 9800
  }, {
    researchedProductName: '缺貨但仍需上架的商品',
    productDescription: '商品資料完整，庫存稍後由既有庫存同步流程更新。',
    listingImageUrls: ['https://example.com/out-of-stock.jpg'],
    enabledPlatforms: { easyStoreShopee: true, momo: false, coupang: false }
  });
  const body = helpers.buildEasyStoreProductBody(snapshot, true).product;

  assert.equal(snapshot.stock, 0);
  assert.equal(body.variants[0].inventory_quantity, 0);
  assert.equal(body.variants[0].inventory_policy, false);
  assert.equal(body.variants[0].is_enabled, true);
  assert.match(body.published_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.deepEqual(helpers.easyStoreMissingFields(snapshot), []);
});

test('EasyStore duplicate guard matches only the exact normalized SKU', () => {
  const payload = { data: { products: [{ id: 99, variants: [
    { id: 1, sku: '1040160-10' },
    { id: 2, sku: "'1040160-1" }
  ] }] } };
  assert.deepEqual(helpers.exactEasyStoreMatches(payload, '1040160-1').map((row) => [row.productId, row.variantId]), [['99', '2']]);
});

test('EasyStore draft is never treated as a published storefront product', () => {
  assert.equal(helpers.easyStorePublicationState({ published_at: null }), 'draft');
  assert.equal(helpers.easyStorePublicationState({ published: false }), 'draft');
  assert.equal(helpers.easyStorePublicationState({ status: '未發佈' }), 'draft');
  assert.equal(helpers.easyStorePublicationState({ published_at: '2026-08-22 12:00:00' }), 'published');
  assert.equal(helpers.easyStorePublicationState({ status: 'active' }), 'published');
  assert.equal(helpers.easyStorePublicationState({ id: 1 }), 'unknown');
});

test('each platform reports missing fields instead of pretending to publish', () => {
  const empty = { sku: '', title: '', description: '', images: [], easyStorePrice: null, momoGoodsName: '', momoCategoryCode: '', momoPrice: null, coupangTitle: '', coupangCategoryCode: '', coupangPrice: null };
  assert.deepEqual(helpers.easyStoreMissingFields(empty), ['SKU', '商品名稱', '完整商品介紹', '上架圖片', 'EasyStore 售價']);
  assert.doesNotMatch(helpers.momoMissingFields(empty).join('、'), /MOMO 分類/);
  assert.doesNotMatch(helpers.coupangMissingFields(empty).join('、'), /酷澎分類/);
  assert.equal(helpers.overallPublishStatus({ easyStore: { status: 'created' }, momo: { status: 'missing-fields' } }), 'needs-input');
  assert.equal(helpers.overallPublishStatus({ easyStore: { status: 'updated' }, shopee: { status: 'waiting-easystore-sync' } }), 'submitted');
  assert.equal(helpers.overallPublishStatus({ momo: { status: 'already-queued' }, coupang: { status: 'already-completed' } }), 'submitted');
  assert.equal(helpers.overallPublishStatus({ easyStore: { status: 'failed' } }), 'partial-failed');
});

test('Shopee helper payload maps researched guitar fields and large-item logistics without changing stock', () => {
  const snapshot = helpers.buildListingSnapshot('guitar-1', {
    internalSku: '1040160-1', currentStock: 0, easyStorePrice: 14800, brand: '舊資料品牌',
    model: 'AZES40-PRB', barcode: '4549763289575'
  }, {
    researchedProductName: 'Ibanez AZES40-PRB 電吉他',
    productDescription: '完整商品介紹',
    listingImageUrls: ['https://example.com/guitar.jpg'],
    brand: '舊資料品牌', shopeeBrand: 'Ibanez', model: 'AZES40-PRB', color: 'Purist Blue', identityStatus: 'confirmed',
    shopeeTitle: 'Ibanez AZES40-PRB 電吉他',
    shopeeListingDecision: 'new',
    shopeeCategoryPath: '愛好與收藏品 > 樂器與樂器配件 > 弦樂器 > 吉他、貝斯',
    shopeeAttributeValues: [
      { label: 'Body Material', value: 'Poplar', confidence: 'high', note: 'Ibanez 官方規格' },
      { label: 'Pickup Configuration', value: 'HSS', confidence: 'high', note: 'Ibanez 官方規格' }
    ],
    packageLengthCm: 106.7, packageWidthCm: 45.7, packageHeightCm: 10.2, packageWeightKg: 4.2,
    shippingDecision: 'freight', enabledPlatforms: { easyStoreShopee: true, momo: false, coupang: false }
  });
  const payload = helpers.buildShopeeAutofillPayload(snapshot, { productId: '16403950' }, {
    jobId: 'job-shopee-v2-1', snapshotId: 'snapshot-shopee-v2-1', snapshotFingerprint: 'a'.repeat(64)
  });

  assert.equal(snapshot.stock, 0);
  assert.equal(payload.sku, '1040160-1');
  assert.equal(payload.schemaVersion, 5);
  assert.equal(payload.workflowVersion, 'youzi-four-channel-listing-v2');
  assert.equal(payload.jobId, 'job-shopee-v2-1');
  assert.equal(payload.publishMode, 'auto');
  assert.deepEqual(payload.listingPolicy, {
    mode: 'create-new', identitySource: 'new-draft', platformListingIds: [],
    preflightSkuSearch: false, uncertainSubmitRecovery: 'exact-sku-only'
  });
  assert.equal(payload.brand, 'Ibanez');
  assert.deepEqual(payload.categoryPath, ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯']);
  assert.deepEqual(payload.attributes.map((row) => [row.label, row.value]), [
    ['Body Material', 'Poplar'], ['Pickup Configuration', 'HSS'],
    ['Quantity', '1'], ['Quantity per Pack', '1']
  ]);
  assert.equal(payload.logistics.packageTotalCm, 162.6);
  assert.deepEqual(payload.logistics.methods.find((row) => row.label === '新竹物流'), {
    label: '新竹物流', enabled: true, option: 'S170', feeTwd: null, sellerPays: false
  });
  assert.deepEqual(payload.logistics.methods.find((row) => row.label === '賣家宅配：大型/超重物品運送'), {
    label: '賣家宅配：大型/超重物品運送', enabled: false, option: '', feeTwd: null, sellerPays: false
  });
  assert.deepEqual(
    payload.logistics.methods.filter((row) => row.enabled).map((row) => row.label),
    ['新竹物流']
  );
  assert.equal(payload.logistics.methods.length, 9);
  assert.ok(payload.logistics.methods
    .filter((row) => row.label !== '新竹物流')
    .every((row) => row.enabled === false));
  assert.deepEqual(payload.preorder, { enabled: false, days: 1 });
  assert.equal(payload.easyStoreUrl, 'https://admin.easystore.co/products/16403950');
  assert.match(payload.nonce, /^[a-f0-9]{32}$/);
  assert.equal(Object.hasOwn(payload, 'costPrice'), false);
});

test('legacy researched category wording is canonicalized before the EasyStore handoff', () => {
  assert.deepEqual(
    helpers.shopeeCategorySegments('樂器與配件 > 弦樂器 > 吉他、貝斯'),
    ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯']
  );
  assert.deepEqual(
    helpers.shopeeCategorySegments('愛好與收藏品 > 樂器與樂器配件 > 弦樂器 > 吉他、貝斯'),
    ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯']
  );
  assert.deepEqual(
    helpers.shopeeCategorySegments('愛好與收藏品 > 樂器與配件 > 吉他與貝斯 > 電吉他', { title: 'Ibanez AZES40 電吉他' }),
    ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯']
  );
});

test('music products choose one controlled Shopee family instead of inheriting the guitar branch', () => {
  assert.deepEqual(helpers.shopeeCategorySegments('樂器與配件 > 電鋼琴', { title: 'Roland FP-30X 電鋼琴' }).slice(0, 3),
    ['愛好與收藏品', '樂器與樂器配件', '鍵盤樂器']);
  assert.deepEqual(helpers.shopeeCategorySegments('樂器與配件 > 電子鼓', { title: 'NUX DM-210 電子鼓' }).slice(0, 3),
    ['愛好與收藏品', '樂器與樂器配件', '打擊樂器']);
  assert.deepEqual(helpers.shopeeCategorySegments('樂器與配件 > 長笛', { title: 'Yamaha YFL-212 長笛' }).slice(0, 3),
    ['愛好與收藏品', '樂器與樂器配件', '管樂器']);
  assert.deepEqual(helpers.shopeeCategorySegments('樂器與配件 > 吉他弦', { title: 'Elixir 吉他弦' }).slice(0, 3),
    ['愛好與收藏品', '樂器與樂器配件', '樂器配件']);
  assert.deepEqual(
    helpers.shopeeCategorySegments('愛好與收藏品 > 樂器與樂器配件 > 弦樂器 > 吉他、貝斯', { title: 'Elixir 吉他弦' }),
    ['愛好與收藏品', '樂器與樂器配件', '樂器配件']
  );
  assert.deepEqual(
    helpers.shopeeCategorySegments('愛好與收藏品 > 樂器與樂器配件 > 樂器配件 > 效果器', { title: 'Ibanez AZES40 電吉他' }),
    ['愛好與收藏品', '樂器與樂器配件', '弦樂器', '吉他、貝斯']
  );
});

test('Shopee helper leaves Hsinchu Logistics off when package limits are incomplete or exceeded', () => {
  const missing = helpers.buildShopeeLogistics({ shippingDecision: 'freight', packageLengthCm: 100, packageWidthCm: 40 });
  assert.equal(missing.methods.find((row) => row.label === '新竹物流').enabled, false);
  assert.deepEqual(missing.methods.find((row) => row.label === '賣家宅配：大型/超重物品運送'), {
    label: '賣家宅配：大型/超重物品運送', enabled: false, option: '', feeTwd: null, sellerPays: false
  });
  assert.equal(missing.requiresConfirmation, false);
  assert.equal(missing.requiresJudgment, true);

  const tooHeavy = helpers.buildShopeeLogistics({
    shippingDecision: 'freight', packageLengthCm: 100, packageWidthCm: 40, packageHeightCm: 20, packageWeightKg: 21
  });
  assert.equal(tooHeavy.methods.find((row) => row.label === '新竹物流').enabled, false);
  assert.deepEqual(tooHeavy.methods.find((row) => row.label === '賣家宅配：大型/超重物品運送'), {
    label: '賣家宅配：大型/超重物品運送', enabled: false, option: '', feeTwd: null, sellerPays: false
  });
  assert.ok(tooHeavy.methods
    .every((row) => row.enabled === false));
  assert.equal(tooHeavy.requiresConfirmation, false);
  assert.equal(tooHeavy.requiresJudgment, true);
});

test('backend Hsinchu tariff boundaries stay aligned with the extension contract', () => {
  assert.equal(helpers.hsinchuSizeBand(140), 'S150');
  assert.equal(helpers.hsinchuSizeBand(140.1), 'S160');
  assert.equal(helpers.hsinchuSizeBand(160), 'S160');
  assert.equal(helpers.hsinchuSizeBand(160.1), 'S170');
  assert.equal(helpers.hsinchuSizeBand(170), 'S170');
  assert.equal(helpers.hsinchuSizeBand(170.1), 'S180');
});

test('manual shipping choice controls autofill and convenience limits are enforced when measurements are known', () => {
  const manualConvenience = helpers.buildShopeeLogistics({ shippingDecision: 'convenience' });
  assert.equal(manualConvenience.methods.find((row) => row.label === '蝦皮店到店').enabled, false);
  assert.equal(manualConvenience.methods.find((row) => row.label === '新竹物流').enabled, false);
  assert.equal(manualConvenience.packageTotalCm, null);
  assert.equal(manualConvenience.requiresConfirmation, false);
  assert.equal(manualConvenience.requiresJudgment, true);

  const verifiedConvenience = helpers.buildShopeeLogistics({
    shippingDecision: 'convenience', packageLengthCm: 40, packageWidthCm: 30,
    packageHeightCm: 20, packageWeightKg: 4
  });
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '蝦皮店到店').enabled, false);
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '7-ELEVEN').enabled, true);
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '新竹物流').enabled, true);
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '新竹物流').option, 'S90');
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '黑貓宅急便').enabled, false);
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '嘉里快遞').enabled, false);
  assert.equal(verifiedConvenience.methods.find((row) => row.label === '賣家宅配：大型/超重物品運送').enabled, false);
  assert.equal(verifiedConvenience.requiresConfirmation, false);
  assert.equal(verifiedConvenience.requiresJudgment, false);

  const oversizedConvenience = helpers.buildShopeeLogistics({
    shippingDecision: 'convenience', packageLengthCm: 46, packageWidthCm: 30,
    packageHeightCm: 20, packageWeightKg: 4
  });
  assert.equal(oversizedConvenience.methods.find((row) => row.label === '蝦皮店到店').enabled, false);
  assert.equal(oversizedConvenience.requiresConfirmation, false);
  assert.equal(oversizedConvenience.requiresJudgment, true);

  const overweightConvenience = helpers.buildShopeeLogistics({
    shippingDecision: 'convenience', packageLengthCm: 40, packageWidthCm: 30,
    packageHeightCm: 20, packageWeightKg: 5.1
  });
  assert.equal(overweightConvenience.methods.find((row) => row.label === '7-ELEVEN').enabled, false);
  assert.equal(overweightConvenience.requiresConfirmation, false);
  assert.equal(overweightConvenience.requiresJudgment, true);

  const manualHome = helpers.buildShopeeLogistics({
    shippingDecision: 'home', packageLengthCm: 106.7, packageWidthCm: 45.7,
    packageHeightCm: 10.2, packageWeightKg: 4.2
  });
  assert.equal(manualHome.methods.find((row) => row.label === '新竹物流').enabled, false);
  assert.equal(manualHome.requiresConfirmation, false);
  assert.equal(manualHome.requiresJudgment, true);
});

test('Shopee persistence summary never stores one-time autofill handoff secrets', () => {
  const platforms = {
    easyStore: {
      status: 'created', message: 'EasyStore 商品已建立。', productId: '16403950', variantIds: ['v1']
    },
    shopee: {
      status: 'waiting-easystore-sync', message: '可啟動蝦皮助手。',
      autofillPayload: {
        nonce: '0123456789abcdef0123456789abcdef',
        createdAt: 1800000000000,
        expiresAt: 1800001800000,
        easyStoreProductId: '16403950',
        sku: '1040160-1'
      }
    },
    momo: {
      status: 'missing-fields', message: '請先補資料。', missingFields: ['MOMO 分類'], queueId: 'queue-1'
    }
  };
  const stored = helpers.summarizePlatformsForStorage(platforms);

  assert.deepEqual(stored, {
    easyStore: { status: 'created', message: 'EasyStore 商品已建立。' },
    shopee: { status: 'waiting-easystore-sync', message: '可啟動蝦皮助手。' },
    momo: { status: 'missing-fields', message: '請先補資料。', missingFields: ['MOMO 分類'], queueId: 'queue-1' }
  });
  assert.doesNotMatch(JSON.stringify(stored), /autofillPayload|nonce|createdAt|expiresAt|16403950|1040160-1/);
  assert.equal(platforms.shopee.autofillPayload.nonce, '0123456789abcdef0123456789abcdef');

  const source = fs.readFileSync('functions/productListingPublish.js', 'utf8');
  assert.match(source, /let platformsForStorage = summarizePlatformsForStorage\(platforms\)/);
  assert.match(source, /transaction\.set\(jobRef, \{[\s\S]*status, platforms: platformsForStorage, currentStage, stages,/);
  assert.match(source, /publishState: \{ jobId, status, currentStage, stages, platforms: platformsForStorage,/);
  assert.match(source, /return \{ ok:[\s\S]*status, currentStage, stages, platforms \};/);
  assert.match(source, /updatedBy: '商品上架', schemaVersion: 8/);
  assert.match(source, /version: LISTING_WORKFLOW_ID/);
  assert.doesNotMatch(source, /updatedBy: '商品上架', schemaVersion: 7/);
});

test('platform listing identity uses central IDs and reserves exact SKU lookup for uncertain submit recovery', () => {
  const product = {
    platformMappings: {
      shopee: { itemIds: ['4116442', '4116442'] },
      momo: { goodsCode: 'MOMO-100', goodsdtCodes: ['MOMO-100-RED'] },
      coupang: { vendorItemIds: ['90001'] }
    }
  };
  const snapshot = { productId: 'p1', sku: 'SKU-1' };
  assert.deepEqual(helpers.platformListingIds(product, 'shopee'), ['4116442']);
  assert.deepEqual(helpers.platformListingIds(product, 'momo'), ['MOMO-100|MOMO-100-RED']);
  assert.deepEqual(helpers.platformListingIds(product, 'coupang'), ['90001']);
  assert.deepEqual(helpers.buildPlatformQueuePolicy(product, 'MOMO', snapshot), {
    mode: 'update-existing', matchKey: 'central-platform-id', sku: 'SKU-1',
    existingListingIds: ['MOMO-100|MOMO-100-RED'], identitySource: 'central-platform-id',
    preflightSkuSearch: false, uncertainSubmitRecovery: 'exact-sku-only',
    onZero: 'create', onOne: 'update', onMultiple: 'block', onUncertain: 'exact-sku-recovery'
  });
  assert.deepEqual(helpers.buildPlatformQueuePolicy({}, 'Coupang', snapshot), {
    mode: 'create-new', matchKey: 'new-draft', sku: 'SKU-1', existingListingIds: [],
    identitySource: 'new-draft', preflightSkuSearch: false, uncertainSubmitRecovery: 'exact-sku-only',
    onZero: 'create', onOne: 'update', onMultiple: 'block', onUncertain: 'exact-sku-recovery'
  });
  assert.equal(helpers.buildPlatformQueuePolicy({
    platformMappings: { coupang: { vendorItemIds: ['90001', '90002'] } }
  }, 'Coupang', snapshot).mode, 'block-duplicate');
});

test('platform queue fingerprint is stable for a retry and changes with listing content', () => {
  const snapshot = {
    productId: 'p1', sku: 'SKU-1', title: '商品', description: '內容', images: ['https://example.com/1.jpg'],
    stock: 0, packageLengthCm: 10, packageWidthCm: 20, packageHeightCm: 30, packageWeightKg: 1,
    momoGoodsName: 'MOMO 商品', momoSlogan: '', momoCategoryCode: 'CAT', momoPrice: 100,
    coupangTitle: '酷澎商品', coupangCategoryCode: 'C-CAT', coupangPrice: 110
  };
  const first = helpers.platformQueueFingerprint('MOMO', snapshot);
  const retry = helpers.platformQueueFingerprint('MOMO', { ...snapshot });
  const changed = helpers.platformQueueFingerprint('MOMO', { ...snapshot, momoPrice: 101 });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, retry);
  assert.notEqual(first, changed);
});

test('known Shopee mapping forces update policy even when the form still says new', () => {
  const snapshot = helpers.buildListingSnapshot('p1', {
    internalSku: 'SKU-1', platformMappings: { shopee: { itemId: '4116442' } }
  }, { shopeeListingDecision: 'new' });
  const payload = helpers.buildShopeeAutofillPayload(snapshot, { productId: '16965067' });
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'shopeeListingDecision'), false);
  assert.deepEqual(payload.listingPolicy, {
    mode: 'update-existing', identitySource: 'central-platform-id', platformListingIds: ['4116442'],
    preflightSkuSearch: false, uncertainSubmitRecovery: 'exact-sku-only'
  });
});

test('legacy Shopee decision is ignored when the central product has no platform id', () => {
  for (const legacyDecision of ['auto', 'existing']) {
    const snapshot = helpers.buildListingSnapshot(`new-${legacyDecision}`, {
      internalSku: `NEW-${legacyDecision.toUpperCase()}`
    }, { shopeeListingDecision: legacyDecision });
    const payload = helpers.buildShopeeAutofillPayload(snapshot, { productId: '16965067' });
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'shopeeListingDecision'), false);
    assert.deepEqual(payload.listingPolicy, {
      mode: 'create-new', identitySource: 'new-draft', platformListingIds: [],
      preflightSkuSearch: false, uncertainSubmitRecovery: 'exact-sku-only'
    });
  }
});

test('Shopee autofill accepts explicit manual confirmation while unresolved identity stays blocked', () => {
  assert.equal(helpers.identityAllowsShopeeAutofill('confirmed'), true);
  assert.equal(helpers.identityAllowsShopeeAutofill('possible'), true);
  assert.equal(helpers.identityAllowsShopeeAutofill('conflict'), false);
  assert.equal(helpers.identityAllowsShopeeAutofill('conflict', true), true);
  assert.equal(helpers.identityAllowsShopeeAutofill('not_found', true), true);
  assert.equal(helpers.identityAllowsShopeeAutofill('conflict', false), false);
  assert.equal(helpers.identityAllowsShopeeAutofill('not_found'), false);
  assert.equal(helpers.identityAllowsShopeeAutofill(''), false);
});

test('listing snapshot keeps the manual identity confirmation audit fields', () => {
  const confirmedAt = { seconds: 1800000000, nanoseconds: 0 };
  const snapshot = helpers.buildListingSnapshot('guitar-2', { internalSku: 'GUITAR-2' }, {
    identityStatus: 'conflict',
    identityManualConfirmed: true,
    identityManualConfirmedAt: confirmedAt,
    identityManualConfirmedBy: 'manager@example.com',
    identityManualConfirmationNote: '已核對型號、顏色與照片。'
  });

  assert.equal(snapshot.identityStatus, 'conflict');
  assert.equal(snapshot.identityManualConfirmed, true);
  assert.equal(snapshot.identityManualConfirmedAt, confirmedAt);
  assert.equal(snapshot.identityManualConfirmedBy, 'manager@example.com');
  assert.equal(snapshot.identityManualConfirmationNote, '已核對型號、顏色與照片。');
});

test('商品分類只在進站前判斷一次，再映射 MOMO 與酷澎正式分類', () => {
  const snapshot = { title: '敦煌牌 中胡弦套裝', shopeeCategoryPath: '愛好與收藏品 > 樂器與樂器配件 > 樂器配件' };
  const momo = helpers.platformCategoryResolution('MOMO', snapshot, {});
  const coupang = helpers.platformCategoryResolution('Coupang', { ...snapshot, coupangCategoryCode: '79995' }, {});
  assert.equal(momo.mode, 'map-once');
  assert.equal(momo.scope, 'music-instruments-only');
  assert.equal(momo.decidedOnceBeforePlatformNavigation, true);
  assert.equal(momo.forbidProductReclassificationInsidePlatform, true);
  assert.deepEqual(momo.allowedRootNames, ['樂器', '樂器配件']);
  assert.match(momo.hint, /共同分類已在進站前判定/);
  assert.equal(coupang.mode, 'provided');
  assert.equal(coupang.code, '79995');
  assert.equal(coupang.scope, 'music-instruments-only');
});

test('new SKU can safely target an existing parent as a platform variant', () => {
  const parent = {
    internalSku: 'PARENT-100', internalName: '既有商品', sourceProductId: 'es-parent',
    platformMappings: {
      easyStore: { productId: 'es-parent', variantIds: ['es-old'] },
      shopee: { itemId: 'shopee-parent' },
      momo: { goodsCode: 'momo-parent', goodsdtCode: 'momo-parent-detail' },
      coupang: { vendorItemId: 'coupang-parent' }
    }
  };
  const snapshot = helpers.buildListingSnapshot('child-1', {
    internalSku: 'CHILD-BLUE', internalName: '新顏色', currentStock: 2,
    easyStorePrice: 26000, momoPrice: 26000, coupangPrice: 26000
  }, {
    listingMode: 'add-variant', variantParentProductId: 'parent-1',
    variantAttributeName: '顏色', variantParentAttributeValue: '黑色', variantAttributeValue: '藍色',
    variantParentImageUrl: 'https://example.com/parent-source.jpg',
    variantChildImageUrl: 'https://example.com/blue-source.jpg',
    generatedListingImages: [{
      status: 'ready', localizationStatus: 'completed',
      sourceImageUrl: 'https://example.com/blue-source.jpg', url: 'https://example.com/blue-zh-tw.jpg',
      roles: ['cleanMain'], assetFlags: { containsLogo: false, containsContactInfo: false, containsQrCode: false, containsText: false, greenBrandTemplate: false }
    }],
    productDescription: '商品介紹', listingImageUrls: ['https://example.com/other-zh-tw.jpg', 'https://example.com/blue-zh-tw.jpg']
  }, parent, {
    generatedListingImages: [{
      status: 'ready', localizationStatus: 'completed',
      sourceImageUrl: 'https://example.com/parent-source.jpg', url: 'https://example.com/parent-zh-tw.jpg',
      roles: ['cleanMain'], assetFlags: { containsLogo: false, containsContactInfo: false, containsQrCode: false, greenBrandTemplate: false }
    }]
  });

  assert.equal(snapshot.listingMode, 'add-variant');
  assert.equal(snapshot.variantParentProductId, 'parent-1');
  assert.equal(snapshot.variantParentSku, 'PARENT-100');
  assert.equal(snapshot.variantParentEasyStoreProductId, 'es-parent');
  assert.equal(snapshot.variantParentImageUrl, 'https://example.com/parent-zh-tw.jpg');
  assert.equal(snapshot.variantChildImageUrl, 'https://example.com/blue-zh-tw.jpg');
  assert.equal(snapshot.images[0], 'https://example.com/other-zh-tw.jpg');
  assert.deepEqual(snapshot.shopeeExistingListingIds, ['shopee-parent']);
  assert.deepEqual(helpers.buildPlatformQueuePolicy({}, 'MOMO', snapshot), {
    mode: 'add-variant-to-existing', matchKey: 'parent-listing-id+sku', sku: 'CHILD-BLUE',
    existingListingIds: ['momo-parent|momo-parent-detail'], parentProductId: 'parent-1', parentSku: 'PARENT-100',
    identitySource: 'central-platform-id', preflightSkuSearch: false, uncertainSubmitRecovery: 'exact-sku-only',
    variantAttributeName: '顏色', variantParentAttributeValue: '黑色', variantAttributeValue: '藍色',
    variantParentImageUrl: 'https://example.com/parent-zh-tw.jpg', variantImageUrl: 'https://example.com/blue-zh-tw.jpg',
    onZero: 'block', onOne: 'append-variant', onMultiple: 'block', onUncertain: 'block'
  });
  const shopee = helpers.buildShopeeAutofillPayload(snapshot, { productId: 'es-parent' });
  assert.equal(shopee.publishMode, 'add-variant-to-existing');
  assert.deepEqual(shopee.listingPolicy, {
    mode: 'add-variant-to-existing', identitySource: 'central-platform-id',
    platformListingIds: ['shopee-parent'], preflightSkuSearch: false,
    uncertainSubmitRecovery: 'exact-sku-only'
  });
  assert.deepEqual(shopee.variantGroup, {
    parentProductId: 'parent-1', parentSku: 'PARENT-100', parentName: '既有商品',
    attributeName: '顏色', parentAttributeValue: '黑色', attributeValue: '藍色',
    parentImageUrl: 'https://example.com/parent-zh-tw.jpg', imageUrl: 'https://example.com/blue-zh-tw.jpg'
  });
});

test('variant representative source images never publish before their localized outputs exist', () => {
  const snapshot = helpers.buildListingSnapshot('child-2', {
    internalSku: 'CHILD-RED', internalName: '紅色細項', currentStock: 1,
    easyStorePrice: 1000, momoPrice: 1000, coupangPrice: 1000
  }, {
    listingMode: 'add-variant', variantParentProductId: 'parent-2',
    variantAttributeName: '顏色', variantParentAttributeValue: '黑色', variantAttributeValue: '紅色',
    variantParentImageUrl: 'https://example.com/parent-source.jpg',
    variantChildImageUrl: 'https://example.com/red-source.jpg',
    productDescription: '商品介紹', listingImageUrls: ['https://example.com/gallery.jpg']
  }, { internalSku: 'PARENT-200', sourceProductId: 'es-parent-2' }, {});

  const missing = helpers.easyStoreMissingFields(snapshot);
  assert.ok(missing.includes('原商品代表圖的繁體完成版'));
  assert.ok(missing.includes('新細項代表圖的繁體完成版'));
  assert.equal(snapshot.variantParentImageUrl, '');
  assert.equal(snapshot.variantChildImageUrl, '');
});

test('variant publishing blocks when a parent platform listing is missing or ambiguous', () => {
  const missing = helpers.buildPlatformQueuePolicy({}, 'Coupang', {
    listingMode: 'add-variant', productId: 'child', sku: 'CHILD', variantParentProductId: 'parent',
    variantParentSku: 'PARENT', variantAttributeName: '尺寸', variantParentAttributeValue: '小', variantAttributeValue: '大', variantParentPlatformMappings: {}
  });
  assert.equal(missing.mode, 'block-missing-parent');
  assert.equal(missing.onZero, 'block');

  const ambiguous = helpers.buildPlatformQueuePolicy({}, 'Coupang', {
    listingMode: 'add-variant', productId: 'child', sku: 'CHILD', variantParentProductId: 'parent',
    variantParentSku: 'PARENT', variantAttributeName: '尺寸', variantParentAttributeValue: '小', variantAttributeValue: '大',
    variantParentPlatformMappings: { coupang: { vendorItemIds: ['1', '2'] } }
  });
  assert.equal(ambiguous.mode, 'block-duplicate-parent');
});

function groupedListingFixture(count) {
  const rootId = 'group-root';
  const products = Array.from({ length: count }, (_, index) => ({
    id: index ? `group-child-${index}` : rootId,
    sku: `GROUP-${index + 1}`,
    value: `款式${index + 1}`,
    source: `https://supplier.example.com/group-${index + 1}.jpg`,
    completed: `https://cdn.example.com/group-${index + 1}-zh-tw.jpg`,
    product: {
      internalSku: `GROUP-${index + 1}`, internalName: `同款商品 ${index + 1}`,
      currentStock: index + 1, storePrice: 600 + index,
      easyStorePrice: 500 + index, momoPrice: 510 + index, coupangPrice: 520 + index
    }
  }));
  const rootCase = {
    productSku: products[0].sku,
    productName: products[0].product.internalName,
    variantGroupEnabled: true,
    variantGroupAttributeName: '顏色',
    variantGroupPrimaryValue: products[0].value,
    variantGroupPrimaryImageUrl: products[0].source,
    variantGroupItems: products.slice(1).map((row) => ({
      productId: row.id, attributeValue: row.value, imageUrls: [row.source]
    })),
    productDescription: '同款商品介紹',
    listingImageUrls: products.map((row) => row.completed)
  };
  const media = {
    cases: products.map((row) => ({
      productId: row.id, sku: row.sku,
      representativeSourceImageUrl: row.source,
      representativeCompletedImageUrl: row.completed
    })),
    platformImagePlan: {}
  };
  const context = new Map(products.map((row) => [row.id, {
    product: row.product,
    listingCase: row.id === rootId ? rootCase : { productSku: row.sku, productName: row.product.internalName }
  }]));
  return {
    products,
    snapshot: helpers.buildListingSnapshot(rootId, products[0].product, rootCase, null, null, media, context)
  };
}

test('同款兩個細項只建立一筆主商品，並保留各自 SKU、名稱、圖片、價格與庫存', () => {
  const { snapshot } = groupedListingFixture(2);
  assert.equal(snapshot.variantGroupEnabled, true);
  assert.equal(snapshot.variantGroupVariants.length, 2);
  assert.deepEqual(snapshot.variantGroupVariants.map((row) => row.sku), ['GROUP-1', 'GROUP-2']);
  assert.deepEqual(snapshot.variantGroupVariants.map((row) => row.imageUrl), [
    'https://cdn.example.com/group-1-zh-tw.jpg', 'https://cdn.example.com/group-2-zh-tw.jpg'
  ]);
  const body = helpers.buildEasyStoreProductBody(snapshot, true);
  assert.equal(body.product.variants.length, 2);
  assert.deepEqual(body.product.variants.map((row) => [row.sku, row.name, row.price, row.inventory_quantity]), [
    ['GROUP-1', '款式1', 500, 1], ['GROUP-2', '款式2', 501, 2]
  ]);
  assert.equal(snapshot.preparedPlatformFieldPlan.momo.preparedFields.variantGroup.items.length, 2);
  assert.equal(snapshot.preparedPlatformFieldPlan.coupang.preparedFields.variantGroup.items[1].price, 521);
  assert.equal(snapshot.preparedPlatformFieldPlan.easyStore.preparedFields.variantGroup.items[1].price, 501);
  assert.equal(snapshot.preparedPlatformFieldPlan.shopee.preparedFields.variantGroup.items[1].price, 501);
  const policy = helpers.buildPlatformQueuePolicy({}, 'MOMO', snapshot);
  assert.equal(policy.mode, 'create-new-variant-group');
  assert.deepEqual(policy.skus, ['GROUP-1', 'GROUP-2']);
});

test('同款群組可擴充為三個或五個細項，仍只有一個封閉主商品工作', () => {
  [3, 5].forEach((count) => {
    const { snapshot } = groupedListingFixture(count);
    assert.equal(snapshot.variantGroupVariants.length, count);
    assert.equal(new Set(snapshot.variantGroupVariants.map((row) => row.sku)).size, count);
    assert.equal(helpers.buildEasyStoreProductBody(snapshot, true).product.variants.length, count);
    assert.equal(snapshot.preparedPlatformFieldPlan.common.variantGroup.items.length, count);
    const shopeePayload = helpers.buildShopeeAutofillPayload(snapshot, { productId: 'es-group' });
    assert.equal(shopeePayload.publishMode, 'auto');
    assert.equal(shopeePayload.variantGroup, null);
  });
});

test('同款群組正式核對要求完全相同的 SKU 集合及每個細項價格庫存', () => {
  const { snapshot } = groupedListingFixture(2);
  const verification = {
    listingId: 'platform-parent', sku: 'GROUP-1', status: 'published',
    platformListMatched: true, officialCatalogMatched: true, imageEvidenceComplete: true,
    appliedImageUrls: [], officialImageUrls: [],
    variants: [
      { sku: 'GROUP-1', value: '款式1', price: 500, stock: 1 },
      { sku: 'GROUP-2', value: '款式2', price: 501, stock: 2 }
    ]
  };
  const valid = helpers.validatePlatformStageVerification('easyStore', snapshot, verification);
  assert.equal(valid.reasons.includes('variant-sku-set-mismatch'), false);
  assert.equal(valid.reasons.some((reason) => reason.startsWith('variant-price-mismatch')), false);
  const missing = helpers.validatePlatformStageVerification('easyStore', snapshot, {
    ...verification, variants: verification.variants.slice(0, 1)
  });
  assert.equal(missing.reasons.includes('variant-sku-set-mismatch'), true);
  const wrongPrice = helpers.validatePlatformStageVerification('easyStore', snapshot, {
    ...verification,
    variants: [verification.variants[0], { ...verification.variants[1], price: 999 }]
  });
  assert.equal(wrongPrice.reasons.includes('variant-price-mismatch:GROUP-2'), true);
});

test('Codex 單次授權綁定 v2 快照並由後端自動續跑，不接受舊版或第二次確認', () => {
  const base = {
    researchedProductName: '桌上型木製譜架', sharedOnlinePrice: 450, stock: 2,
    shippingDecision: 'convenience', packageLengthCm: 40, packageWidthCm: 30,
    packageHeightCm: 10, packageWeightKg: 1,
    generatedListingImages: [{
      sourceImageUrl: 'https://supplier.example.com/2100307-4.jpg',
      url: 'https://cdn.example.com/2100307-4-clean.jpg', roles: ['cleanMain']
    }],
    codexHandoff: {
      workflowVersion: 'youzi-four-channel-listing-v2',
      preflightSnapshot: { workflowVersion: 'youzi-four-channel-listing-v2', snapshotId: 'Ui7HQyrWtdcfG1r7nKlt-mt2l5818', cases: [] },
      autoPublishAuthorization: {
        granted: true, scope: 'fixed-v2-four-channel-publish',
        workflowVersion: 'youzi-four-channel-listing-v2', snapshotId: 'Ui7HQyrWtdcfG1r7nKlt-mt2l5818',
        grantedByEmail: 'danny700808@gmail.com', noSecondConfirmation: true
      }
    }
  };
  assert.deepEqual(helpers.codexAutoPublishGrant(base), {
    email: 'danny700808@gmail.com', snapshotId: 'Ui7HQyrWtdcfG1r7nKlt-mt2l5818', scope: 'fixed-v2-four-channel-publish'
  });
  assert.equal(helpers.codexAutoPublishGrant({ ...base, codexHandoff: { ...base.codexHandoff, workflowVersion: 'youzi-four-channel-listing-v1' } }), null);
  assert.equal(helpers.codexAutoPublishGrant({ ...base, codexHandoff: { ...base.codexHandoff, autoPublishAuthorization: { ...base.codexHandoff.autoPublishAuthorization, snapshotId: 'other' } } }), null);
  assert.equal(helpers.codexAutoPublishInputFingerprint(base), helpers.codexAutoPublishInputFingerprint(JSON.parse(JSON.stringify(base))));
  assert.notEqual(helpers.codexAutoPublishInputFingerprint(base), helpers.codexAutoPublishInputFingerprint({ ...base, stock: 3 }));
  assert.equal(helpers.isTransientListingPublishFailure('HTTP 504 暫時錯誤'), true);
  assert.equal(helpers.isTransientListingPublishFailure('OTP 驗證碼'), false);
  assert.equal(helpers.publishResultFailureMessage({ ok: false, platforms: { easyStore: { message: 'HTTP 503' } } }), 'HTTP 503');
});

test('營運中心 v2 交接即授權自動發布，介面不再要求一般二次確認', () => {
  const frontend = fs.readFileSync('operations-phase1.js', 'utf8');
  assert.match(frontend, /scope:'fixed-v2-four-channel-publish'/);
  assert.match(frontend, /noSecondConfirmation:true/);
  assert.match(frontend, /backendFirst:true/);
  assert.match(frontend, /desktopControlFallbackOnly:true/);
  assert.match(frontend, /croppedTextMustBeReflowedReplacedOrRemoved:true/);
  assert.match(frontend, /completedMediaReady/);
  assert.match(frontend, /callProductListingPublishWithTransientRetry\(id,form\)/);
  assert.doesNotMatch(frontend, /confirmAction\('確認上架'/);
  assert.doesNotMatch(frontend, /confirmAction\('確認整組上架'/);
});

test('相同 SKU 與相同不可變資料的新 v2 嘗試會取代舊的未完成 queue', () => {
  const handler = fs.readFileSync('functions/productListingPublish.js', 'utf8');
  assert.match(handler, /supersededAttempt:/);
  assert.match(handler, /sameIdentity && sameFingerprint && !sameAttempt/);
  assert.doesNotMatch(handler, /reusedStatus = 'conflicting-pending'/);
  assert.doesNotMatch(handler, /尚有另一筆工作使用同一個 queue/);
});

test('目前交接遇到不相容的舊 v2 工作時會留下取代紀錄並建立新工作', () => {
  const handler = fs.readFileSync('functions/productListingPublish.js', 'utf8');
  assert.match(handler, /status: 'superseded-by-current-v2-handoff'/);
  assert.match(handler, /supersededReasons: reuseBlockers/);
  assert.match(handler, /else \{\s*reusableJob = candidate;\s*reusableJobRef = candidateRef;/);
  assert.doesNotMatch(handler, /既有 v2 工作不符合目前固定流程，已拒絕復用/);
});
test('2100307-4 固定 v2 實際資料可在不送出的模擬通過四通路預檢', () => {
  const productId = 'Ui7HQyrWtdcfG1r7nKlt';
  const sources = Array.from({ length: 8 }, (_, index) => `https://supplier.example.com/2100307-4-source-${index + 1}.png`);
  const cleanFlags = { containsLogo: false, containsText: false, containsContactInfo: false, containsQrCode: false, greenBrandTemplate: false, momoPromotionEligible: false };
  const completed = [
    { sourceImageUrl: sources[0], url: 'https://cdn.example.com/2100307-4-clean-main.png', roles: ['cleanMain'], assetFlags: { ...cleanFlags } },
    { sourceImageUrl: sources[0], url: 'https://cdn.example.com/2100307-4-storefront-portrait.png', roles: ['storefrontPortrait'], assetFlags: { ...cleanFlags, containsLogo: true, containsText: true, greenBrandTemplate: true } },
    { sourceImageUrl: sources[0], url: 'https://cdn.example.com/2100307-4-branded-hero.png', roles: ['brandedHero'], assetFlags: { ...cleanFlags, containsLogo: true, containsText: true, greenBrandTemplate: true } },
    { sourceImageUrl: sources[1], url: 'https://cdn.example.com/2100307-4-localized-2.png', roles: ['localizedDetail'], assetFlags: { ...cleanFlags } },
    { sourceImageUrl: sources[1], url: 'https://cdn.example.com/2100307-4-momo-promo.png', roles: ['specification'], assetFlags: { ...cleanFlags, momoPromotionEligible: true } },
    { sourceImageUrl: sources[2], url: 'https://cdn.example.com/2100307-4-clean-detail.png', roles: ['cleanMain'], assetFlags: { ...cleanFlags } },
    ...sources.slice(2).map((sourceImageUrl, index) => ({
      sourceImageUrl, url: `https://cdn.example.com/2100307-4-localized-${index + 3}.png`,
      roles: ['localizedDetail'], assetFlags: { ...cleanFlags }
    }))
  ].map((row, index) => ({ ...row, sourceOrder: index + 1, status: 'ready', localizationStatus: 'completed' }));
  assert.equal(completed.length, 12);
  const frozen = {
    workflowVersion: 'youzi-four-channel-listing-v2', snapshotId: 'Ui7HQyrWtdcfG1r7nKlt-mt2l5818', productId,
    cases: [{ productId, sku: '2100307-4', sourceImageUrls: sources, gallerySourceImageUrls: [] }]
  };
  const listingCase = {
    productSku: '2100307-4', researchedProductName: '桌上型木製閱讀譜架 升降款 原木色 柚子樂器',
    productDescription: '木製面板搭配鋁合金底座，適合桌上閱讀與樂譜使用。\n\n商品特色\n1. 桌上型設計\n2. 高度可調\n\n商品規格\n面板：30 × 24 公分\n高度：4.4～39 公分\n底座：23.5 × 18.5 公分',
    sharedOnlinePrice: 450, stock: 2, warrantyMonths: 6,
    shippingDecision: 'convenience', packageLengthCm: 40, packageWidthCm: 30, packageHeightCm: 10, packageWeightKg: 1,
    shopeeCategoryPath: '愛好與收藏品 > 樂器與樂器配件 > 樂器配件 > 樂譜架',
    identityStatus: 'confirmed', identityManualConfirmed: true,
    generatedListingImages: completed,
    codexHandoff: { workflowVersion: 'youzi-four-channel-listing-v2', preflightSnapshot: frozen }
  };
  const finalMedia = helpers.finalizePreparedMediaSnapshot(frozen, new Map([[productId, listingCase]]));
  const snapshot = helpers.buildListingSnapshot(productId, {
    internalSku: '2100307-4', internalName: '譜架-升降款 桌上型-原木色', currentStock: 2,
    storePrice: 450, easyStorePrice: 450, coupangPrice: 450, momoPrice: 450
  }, listingCase, null, null, finalMedia);
  assert.deepEqual(helpers.platformImagePlanMissingFields(snapshot.platformImagePlan, { requireFinalized: true }), []);
  assert.deepEqual(helpers.easyStoreMissingFields(snapshot), []);
  assert.deepEqual(helpers.coupangMissingFields(snapshot), []);
  assert.deepEqual(helpers.momoMissingFields(snapshot), []);
  assert.equal(helpers.buildShopeeLogistics(snapshot).requiresConfirmation, false);
  assert.equal(snapshot.platformImagePlan.easyStore.imageUrls[0], 'https://cdn.example.com/2100307-4-storefront-portrait.png');
  assert.equal(snapshot.platformImagePlan.coupang.imageUrls[0], 'https://cdn.example.com/2100307-4-clean-main.png');
  assert.equal(snapshot.platformImagePlan.momo.imageUrls[0], 'https://cdn.example.com/2100307-4-clean-main.png');
});
