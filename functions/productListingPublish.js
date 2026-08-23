'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const shopeeTaxonomy = require('./shopeeMusicTaxonomy');

const EASYSTORE_ACCESS_TOKEN = defineSecret('EASYSTORE_ACCESS_TOKEN');
const REGION = 'us-central1';
const EASY_STORE_URL = 'https://www.mingtinghuang.com';
const EASY_STORE_API_BASE = '/api/3.0';
const PRODUCT_COLLECTION = 'opsInternalProducts';
const LISTING_CASE_COLLECTION = 'opsProductListingCases';
const JOB_COLLECTION = 'opsSyncJobs';
const PLATFORM_QUEUE_COLLECTION = 'opsProductListingQueue';
const LISTING_WORKFLOW_ID = 'youzi-four-channel-listing-v3';
const LISTING_JOB_SCHEMA_VERSION = 5;
const LISTING_AUTOMATION_POLICY_VERSION = 21;
const PLATFORM_EXECUTION_ORDER = Object.freeze(['momo', 'coupang', 'easyStore', 'shopee']);
const PARALLEL_ROOT_PLATFORMS = Object.freeze(['momo', 'coupang', 'easyStore']);
const REQUEST_TIMEOUT_MS = 60 * 1000;
const PUBLISH_LOCK_MS = 15 * 60 * 1000;
const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);
const SHOPEE_AUTOFILL_SCHEMA_VERSION = 6;
const PLATFORM_QUEUE_PENDING_STATUSES = new Set(['awaiting-store-agent', 'processing']);
const PLATFORM_QUEUE_COMPLETED_STATUSES = new Set(['completed', 'created', 'updated', 'published', 'success']);
const PLATFORM_QUEUE_RECEIPT_STATUSES = new Set([...PLATFORM_QUEUE_COMPLETED_STATUSES, 'submitted-to-platform-review', 'under-review']);
const LISTING_IMAGE_ROLES = new Set(['cleanMain', 'brandedHero', 'storefrontPortrait', 'localizedDetail', 'specification', 'variantRepresentative']);
const SHOP_ASSET_BASE_URL = clean(process.env.YOUZI_HOSTING_URL || 'https://danny700808.github.io/play-card').replace(/\/$/, '');
const STORE_PROMO_IMAGE_URL = `${SHOP_ASSET_BASE_URL}/product-listing-store-promo.png`;
const DESCRIPTION_PROMO_IMAGE_URLS = [
  `${SHOP_ASSET_BASE_URL}/product-listing-description-promo-1.jpg`,
  `${SHOP_ASSET_BASE_URL}/product-listing-description-promo-2.jpg`
];
const PHYSICAL_PRODUCT_DISCLAIMER = '商品圖片與規格僅供參考，實際內容以收到的實體商品為準。';
const MOMO_THIRD_PARTY_DELIVERY = {
  method: 'third-party', locationCode: '000001', locationLabel: '台中市圓環東路347號', carrier: '新竹物流'
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeSku(value) {
  return clean(value).replace(/^'+/, '').replace(/\u00a0/g, ' ').toUpperCase();
}

function numberOrNull(value) {
  if (value === null || value === undefined || clean(value) === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeHttpUrl(value) {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch (_) {
    return '';
  }
}

function normalizeUrls(value, limit = 9) {
  const result = [];
  const rows = Array.isArray(value) ? value : clean(value).split(/[\n|]+/);
  rows.forEach((row) => {
    const url = safeHttpUrl(row);
    if (url && !result.includes(url)) result.push(url);
  });
  return result.slice(0, limit);
}

function shopeeAdvancedDescriptionPlan(snapshot) {
  const imageUrls = normalizeUrls([
    ...(Array.isArray(snapshot && snapshot.descriptionImageUrls) ? snapshot.descriptionImageUrls : []),
    ...DESCRIPTION_PROMO_IMAGE_URLS
  ], 20);
  return {
    mode: 'use-easystore-rich-description',
    source: 'easystore-body-html',
    preparedBeforeNavigation: true,
    enableWhenAvailable: true,
    useEasyStoreDescription: true,
    capabilityProbe: 'single-lightweight-page-probe',
    contentFingerprint: crypto.createHash('sha256').update(clean(snapshot && snapshot.bodyHtml)).digest('hex'),
    imageUrls,
    expectedImageCount: imageUrls.length
  };
}

function platformDescriptionContentPlan(snapshot) {
  const preparedImageUrls = normalizeUrls([
    ...(Array.isArray(snapshot && snapshot.descriptionImageUrls) ? snapshot.descriptionImageUrls : []),
    ...DESCRIPTION_PROMO_IMAGE_URLS
  ], 20);
  return {
    canonicalSource: 'single-verified-product-description',
    preparedBeforePlatformNavigation: true,
    neverRewriteInsidePlatform: true,
    easyStore: {
      mode: 'safe-html',
      html: clean(snapshot && snapshot.bodyHtml),
      imageUrls: preparedImageUrls,
      supportsHeadingsParagraphsListsAndImages: true
    },
    coupang: {
      mode: 'safe-html-product-detail',
      html: clean(snapshot && snapshot.coupangDescriptionHtml),
      imageUrls: preparedImageUrls,
      supportsHeadingsParagraphsListsAndImages: true,
      excludeSellerContactAndUnrelatedPromotionContent: true
    },
    momo: {
      mode: 'momo-rich-description-blocks',
      preparedHtmlForBlockConversion: clean(snapshot && snapshot.momoHtml),
      imageUrls: preparedImageUrls,
      arbitraryRawHtmlPasteIsNotAssumed: true,
      composeWithNativeTextAndImageBlocks: true,
      imageMaximum: 20,
      imageWidthPx: 1000,
      imageHeightMaximumPx: 1500,
      imageFileMaximumBytes: 500000,
      externalEmbedPolicy: 'https-and-iframe-supported-only'
    },
    shopee: {
      mode: 'advanced-rich-description',
      importFromEasyStore: true,
      imageUrls: preparedImageUrls,
      rawHtmlPasteForbidden: true,
      verifyTextAndEveryPreparedImageBeforePublish: true
    }
  };
}

function normalizeShopeeAttributes(value) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  return rows.map((row) => {
    const label = clean(row && row.label).slice(0, 120);
    const fieldValue = clean(row && row.value).slice(0, 300);
    const confidence = ['high', 'medium', 'low'].includes(clean(row && row.confidence))
      ? clean(row.confidence) : 'low';
    if (!label || !fieldValue) return null;
    const key = label.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    return { label, value: fieldValue, confidence, note: clean(row && row.note).slice(0, 500) };
  }).filter(Boolean).slice(0, 30);
}

function canonicalShopeeCategorySegment(value) {
  return shopeeTaxonomy.canonicalSegment(value);
}

function shopeeCategorySegments(value, evidence) {
  return shopeeTaxonomy.normalizeMusicCategoryPath(value, evidence);
}

function applyShopeeAttributeTemplate(value, evidence, categoryPath) {
  const researched = normalizeShopeeAttributes(value);
  const template = shopeeTaxonomy.templateAttributeRows(evidence, categoryPath);
  if (!template.length) return researched;
  const allowed = new Map(template.map((row) => [clean(row.label).toLowerCase(), row]));
  const result = researched.filter((row) => allowed.has(clean(row.label).toLowerCase()));
  const existing = new Set(result.map((row) => clean(row.label).toLowerCase()));
  template.forEach((field) => {
    const key = clean(field.label).toLowerCase();
    if (existing.has(key) || !clean(field.defaultValue)) return;
    result.push({
      label: field.label,
      value: clean(field.defaultValue),
      confidence: 'high',
      note: clean(field.research) || '分類模板固定值'
    });
    existing.add(key);
  });
  return result.slice(0, 30);
}

function hsinchuSizeBand(totalCm) {
  const total = numberOrNull(totalCm);
  if (total === null || total <= 0 || total > 210) return '';
  if (total <= 60) return 'S60';
  if (total <= 90) return 'S90';
  if (total <= 120) return 'S120';
  if (total <= 140) return 'S150';
  if (total <= 160) return 'S160';
  if (total <= 170) return 'S170';
  if (total <= 180) return 'S180';
  if (total <= 190) return 'S190';
  if (total <= 200) return 'S200';
  return 'S210';
}

function listingAutomationPolicy() {
  return {
    version: LISTING_AUTOMATION_POLICY_VERSION,
    workflowId: LISTING_WORKFLOW_ID,
    immutableWorkflowUntilExplicitRuleChange: true,
    productDataChangesDoNotChangeExecutionOrder: true,
    duplicateGuard: {
      matchKey: 'exact-sku+existing-platform-id',
      variantGroupIdentityIsClosedSkuSet: true,
      forbidBaseSkuAndNameFallbackForVariantGroups: true,
      neverReuseUnlistedSimilarProduct: true,
      reuseExistingDraft: true,
      neverCreateNewOnRetry: true,
      stopOnMultipleMatches: true,
      skipPreSubmitCatalogSearchWhenNoPlatformId: true,
      treatHandoffSkuAsNewWhenNoPlatformId: true,
      exactLookupOnlyForUncertainSubmitRecovery: true
    },
    retry: {
      retryTransientFailureUntilVerified: true,
      backoffSeconds: [3, 10, 30],
      maximumAttempts: 4,
      waitForAsyncImageProcessing: true,
      keepFailedStepForResume: true,
      retrySameSkuAndDraftOnly: true,
      refreshLocalizedImageUrlBeforeRetry: true,
      transientFailureSignatures: [
        'http-408', 'http-425', 'http-429', 'http-500', 'http-502', 'http-503', 'http-504',
        'network-timeout', 'temporary-platform-error', 'image-fetch-failed', 'image-load-timeout', 'image-processing-pending'
      ]
    },
    publishVerification: {
      mode: 'fast-essential-checks',
      successDialogRequiresListingIdentity: true,
      easyStoreDraftCreationIsNotPublication: true,
      requireEveryVariantGroupSkuOnPublishedStorefront: true,
      requiredChecks: ['listing-id', 'exact-sku', 'price', 'status', 'one-official-list-match'],
      intentionallySkippedAfterSubmit: [
        'stock', 'duplicate-platform-list-and-official-catalog-check',
        'applied-image-url-list', 'official-image-url-list', 'reopen-saved-draft'
      ],
      imageReceiptContract: {
        verifiedOnceBeforePlatformNavigation: true,
        postSubmitImageUrlCollectionRequired: false,
        platformErrorTriggersTargetedImageCheck: true
      }
    },
    platformExecutionPlan: {
      preflightAllListingDataBeforePlatformNavigation: true,
      requireStructuredVerifiedDescriptionBeforePreparedSnapshot: true,
      genericFallbackDescriptionIsIncomplete: true,
      writeVerifiedDescriptionBackToEveryGroupedCase: true,
      prepareShopeeAdvancedDescriptionBeforeNavigation: true,
      shopeeAdvancedDescriptionSource: 'easystore-body-html',
      shopeeAdvancedDescriptionImagesAreImmutableForJob: true,
      shopeeAdvancedDescriptionCapabilityProbeMaximum: 1,
      shopeePageMayApplyPreparedContentButMustNotReanalyzeIt: true,
      shopeeAdvancedDescriptionMustVerifyTextAndEveryPreparedImageBeforePublish: true,
      shopeeAdvancedDescriptionMissingImagesMustBeInsertedIntoSameEditor: true,
      shopeeAdvancedDescriptionMayNotReportSuccessFromButtonClickAlone: true,
      prepareOneCanonicalDescriptionAndFourPlatformDeliveryProfiles: true,
      easyStoreAndCoupangUseSafeHtmlWithPreparedImages: true,
      momoUsesNativeRichDescriptionBlocksInsteadOfAssumingArbitraryRawHtml: true,
      momoRichDescriptionSupportsPreparedTextAndUpToTwentyImages: true,
      shopeeUsesAdvancedRichDescriptionRatherThanRawHtml: true,
      order: [...PLATFORM_EXECUTION_ORDER],
      mode: 'staggered-parallel',
      parallelRoots: [...PARALLEL_ROOT_PLATFORMS],
      dependencies: { momo: [], coupang: [], easyStore: [], shopee: ['easyStore'] },
      finalSubmissionAuthorizedByHandoff: true,
      routineSecondConfirmationForbidden: true,
      applicationConfirmationUiDisabledAfterHandoff: true,
      authorizationCoversRoutineFinalSubmitOnAllFourPlatforms: true,
      continueAutomaticallyAfterEachVerifiedStage: true,
      prepareCompleteFieldPlanBeforeFirstPlatform: true,
      preparedFieldPlanIsImmutableForWholeJob: true,
      batchFieldExecution: {
        version: 1,
        mode: 'section-batch',
        resolveFieldLocationsOncePerSection: true,
        fillStableNativeControlsInSingleDomPass: true,
        dispatchNativeEventsPerField: true,
        validateStableSectionAfterBatch: false,
        validateDynamicSectionOnceAfterBatch: true,
        dynamicControlsRemainSequentialWithinSection: true,
        uploadImagesAsSingleBatch: true,
        neverRescanUnchangedSection: true
      },
      pageContractReuse: {
        reuseKnownRoutesAndFieldLocations: true,
        applyFixedFieldsWithoutWholePageRescan: true,
        inspectOnlyDynamicCategoryAttributesAndErrors: true,
        rescanCurrentSectionOnlyWhenLayoutSignatureChanges: true,
        persistStableSelectorsAndFieldSemantics: true,
        fallbackToSectionRescanWithoutRestartingJob: true
      },
      fixedDefaults: {
        warrantyDays: 180,
        publishImmediately: true,
        momoThirdPartyLocationCode: MOMO_THIRD_PARTY_DELIVERY.locationCode,
        momoThirdPartyLocationRequired: true,
        momoConvenienceShippingConditionalOnPackage: true
      },
      shopeeDependsOnEasyStore: true,
      easyStoreStartsOnlyAfterMomoAndCoupangVerified: false,
      browserScheduler: {
        interactionConcurrency: 1,
        oneActiveProductPerPlatform: true,
        releaseInteractionLockDuringWait: true,
        serializedOperations: ['navigate', 'click', 'type', 'file-picker', 'image-selection', 'final-submit'],
        overlapAllowedWhileWaiting: ['navigation-response', 'image-upload', 'platform-processing', 'official-review'],
        sessionHeartbeatSeconds: 180,
        keepAuthenticatedAnchorTabPerPlatform: true,
        resumeSameDraftAfterSessionRecovery: true
      },
      prepareBeforeOpen: ['category', 'brand', 'attributes', 'logistics', 'price', 'stock', 'images', 'variants'],
      shopeeHandoff: {
        canonicalWorkspace: 'easystore-shopee-channel-sync',
        singleWorkspaceOnly: true,
        neverOpenDirectShopeeSellerEditor: true,
        startImmediatelyAfterEasyStoreVerified: true,
        doNotWaitForMomoOrCoupang: true,
        sameEasyStoreBranchContinuation: true,
        closeEmbeddedChatBeforeFormInteraction: true,
        reusePreparedPayload: true,
        neverRestartResearchOrImageProcessing: true,
        retrySameChannelProductAndPage: true,
        variantImageSource: 'existing-easystore-completed-gallery',
        selectVariantImageByCompletedAssetMapping: true,
        neverOpenNativeFilePickerForVariantImages: true,
        fillRequiredWeightFromPreparedPackageBeforePreparePublish: true,
        completeVariantImagesBeforePreparePublish: true,
        verifyIn: 'easystore-shopee-channel-product-list'
      },
      coupangCreateFlow: {
        route: 'create-via-image',
        useSameDraftOnly: true,
        fieldPlanPreparedBeforeNavigation: true,
        steps: [
          'upload-clean-main', 'upload-secondary-completed-images', 'select-music-leaf-category',
          'select-verified-brand-or-no-brand', 'generate-product-information-once',
          'fill-variants-price-stock-and-seller-sku', 'fill-shipping',
          'fill-description-and-tw-general-compliance', 'create-product', 'verify-exact-sku-once'
        ],
        invalidGeneratedOptionRecovery: {
          signatures: ['readonly-option-field', 'invalid-generated-option-value'],
          action: 'return-to-image-step-and-regenerate-once',
          maximumRegenerations: 1,
          neverCreateReplacementDraft: true,
          onlyBeforeVariantCommerceOrContentIsFilled: true,
          neverRegenerateAfterLaterSectionsCompleted: true,
          lateFailureAction: 'repair-current-section-on-same-draft',
          preserveCompletedSections: true
        },
        pendingReviewIsSuccessfulSubmission: true,
        pendingReviewIsNotActiveListing: true
      },
      verification: 'single-final-check-after-submit'
    },
    momoPublishRecovery: {
      failureSignatures: ['still-draft', 'blank-price', 'sku-mismatch', 'price-mismatch', 'missing-from-platform'],
      compareWithSubmittedSnapshot: ['sku', 'momoPrice', 'status'],
      resumeSameDraft: true,
      neverCreateReplacementDraft: true,
      reapplyWhenCleared: [
        'attributes', 'other-information', 'stock', 'sale-price', 'market-price', 'factory-sku',
        'material-grade', 'weight', 'temperature', 'shipping-methods', 'third-party-location',
        'rich-description', 'feature-copy', 'warranty'
      ],
      permissionDeniedSignatures: ['此帳號無此功能權限', 'account-not-authorized-for-publish'],
      permissionDeniedIsPermanentBlocker: true,
      neverRetryPermissionDeniedWithReplacementDraft: true,
      verifiedWhenEitherOfficialResultContainsExactSku: true
    },
    momoSpecialPromotionImage: {
      source: 'localized-completed-product-image',
      appliesToListingModes: ['independent', 'variant-group', 'add-variant'],
      onePromotionAssetPerParentListing: true,
      variantGroupMustBePreparedBeforeFirstSubmit: true,
      preferredProductImagePositions: [2, 3],
      excludeStoreAddressAndServicePromos: true,
      neverUseGalleryLastStorePromo: true,
      materialBankInsertRequired: true,
      insertionTarget: 'rich-description-editor',
      materialBankUploadFlow: ['open-rich-description-upload', 'choose-material-bank', 'upload-localized-file', 'search-exact-filename', 'select', 'confirm', 'save-draft'],
      directRichEditorUploadIsNotPersistedProof: true,
      prepareAssetBeforeMomoNavigation: true,
      uniqueFilenameAndFingerprintRequired: true,
      advertisementImagePreparedFromCleanMain: true,
      allThreeMediaSlotsRequiredBeforeFirstSubmit: true,
      saveReopenAndVerifyImageRequired: true,
      visibleInsertionAndSaveConfirmationRequired: true,
      preventDuplicatePromotionInsertion: true,
      missingPromotionErrorIsNeverExpectedControlFlow: true,
      platformErrorTriggersTargetedRecheck: true,
      mainOrAdvertisementImageIsNeverPromotionEvidence: true
    },
    momoStoreCategories: {
      maximumCount: 5,
      relevantOnly: true,
      validateBeforeSave: true,
      neverSubmitWithMoreThanMaximum: true
    },
    browserControl: {
      workspace: 'codex-in-app-browser',
      neverUsePrimaryChrome: true,
      reuseExistingAuthenticatedPlatformTabs: true,
      allowSavedCredentialLoginRetry: true,
      neverOpenNativeWindowsFilePicker: true,
      neverSwitchBrowserWorkspaceMidJob: true,
      stopForInteractiveAuthenticationOnly: true
    },
    browserTabs: {
      closeCompletedAgentTabs: true,
      keepOneAuthenticatedAnchorPerPlatform: true,
      returnAnchorToPlatformHomeOrProductList: true,
      neverCloseUnrelatedUserTabs: true
    },
    permanentBlockers: ['missing-required-data', 'explicit-platform-rejection', 'otp', 'captcha', 'login-expired'],
    humanHandoffOnlyFor: ['missing-required-data', 'explicit-platform-rejection', 'otp', 'captcha', 'login-expired', 'persistent-platform-error']
  };
}

function evaluateMomoPublishVerification(expected, observed) {
  const target = expected && typeof expected === 'object' ? expected : {};
  const actual = observed && typeof observed === 'object' ? observed : {};
  const expectedSku = normalizeSku(target.sku);
  const actualSku = normalizeSku(actual.sku);
  const expectedPrice = numberOrNull(target.momoPrice);
  const actualPrice = numberOrNull(actual.price);
  const status = clean(actual.status).toLowerCase();
  const reasons = [];

  if (expectedSku && actualSku !== expectedSku) reasons.push('sku-mismatch');
  if (!status) reasons.push('missing-status');
  if (status === 'draft' || status === '暫存') reasons.push('still-draft');
  if (actualPrice === null) reasons.push('blank-price');
  else if (expectedPrice !== null && actualPrice !== expectedPrice) reasons.push('price-mismatch');
  if (actual.platformListMatched !== true && actual.officialCatalogMatched !== true) reasons.push('missing-from-platform');

  return {
    verified: reasons.length === 0,
    needsRetry: reasons.length > 0,
    reasons,
    recoveryAction: reasons.length ? 'resume-same-draft-and-reapply-cleared-fields' : 'none',
    neverCreateReplacementDraft: true
  };
}

function buildShopeeLogistics(snapshot) {
  const dimensions = [snapshot.packageLengthCm, snapshot.packageWidthCm, snapshot.packageHeightCm].map(numberOrNull);
  const hasCompletePackage = dimensions.every((value) => value !== null && value > 0);
  const totalCm = hasCompletePackage ? dimensions.reduce((sum, value) => sum + value, 0) : 0;
  const longestCm = hasCompletePackage ? Math.max(...dimensions) : 0;
  const weightKg = numberOrNull(snapshot.packageWeightKg);
  const hasValidWeight = weightKg !== null && weightKg > 0;
  const hsinchuBand = hasCompletePackage && longestCm <= 150 && totalCm <= 210
    && hasValidWeight && weightKg <= 20 ? hsinchuSizeBand(totalCm) : '';
  const canVerifyConvenience = hasCompletePackage && hasValidWeight;
  const convenienceFits = canVerifyConvenience && longestCm <= 45 && totalCm <= 105 && weightKg <= 5;
  const storedDecision = clean(snapshot.shippingDecision);
  const decision = storedDecision || (canVerifyConvenience ? (convenienceFits ? 'convenience' : hsinchuBand ? 'freight' : 'oversize') : '');
  const convenience = decision === 'convenience' && convenienceFits;
  const freight = decision === 'freight';
  const hsinchu = Boolean((convenience || freight) && hsinchuBand);
  const methods = [
    { label: '黑貓宅急便', enabled: false },
    { label: '蝦皮店到店 - 隔日到貨', enabled: false },
    { label: '蝦皮店到店', enabled: false },
    { label: '7-ELEVEN', enabled: convenience },
    { label: '新竹物流', enabled: hsinchu, option: hsinchu ? hsinchuBand : '' },
    { label: '全家', enabled: convenience },
    {
      label: '賣家宅配：大型/超重物品運送',
      enabled: false,
      feeTwd: null
    },
    { label: '嘉里快遞', enabled: false },
    { label: '店到家宅配', enabled: false }
  ];
  return {
    decision,
    decisionSource: storedDecision ? 'manager-or-case' : decision ? 'package-dimensions' : 'unresolved',
    decidedOnceBeforePlatformNavigation: true,
    packageTotalCm: hasCompletePackage ? Math.round(totalCm * 100) / 100 : null,
    methods: methods.map((row) => ({
      label: row.label,
      enabled: row.enabled === true,
      option: clean(row.option),
      feeTwd: numberOrNull(row.feeTwd),
      sellerPays: false
    })),
    requiresJudgment: !hasCompletePackage || !hasValidWeight || !decision || decision === 'home' || decision === 'oversize'
      || (decision === 'freight' && !hsinchuBand)
      || (decision === 'convenience' && !convenienceFits),
    requiresConfirmation: false
  };
}

function buildCoupangShipping(snapshot) {
  const dimensions = [snapshot.packageLengthCm, snapshot.packageWidthCm, snapshot.packageHeightCm].map(numberOrNull);
  const hasCompletePackage = dimensions.every((value) => value !== null && value > 0);
  const packageTotalCm = hasCompletePackage ? dimensions.reduce((sum, value) => sum + value, 0) : null;
  const weightKg = numberOrNull(snapshot.packageWeightKg);
  const hasValidWeight = weightKg !== null && weightKg > 0;
  const convenienceFits = hasCompletePackage && hasValidWeight && packageTotalCm <= 101 && weightKg <= 10;
  return {
    decidedOnceBeforePlatformNavigation: true,
    packageTotalCm: packageTotalCm === null ? null : Math.round(packageTotalCm * 100) / 100,
    sellerDelivery: {
      enabled: true,
      contract: 'platform-existing-seller-delivery',
      carriers: ['Kerry', 'HCT']
    },
    convenienceStore: {
      enabled: convenienceFits,
      stores: convenienceFits ? ['7-ELEVEN', 'FamilyMart'] : [],
      maximumTotalDimensionsCm: 101,
      maximumWeightKg: 10
    },
    preparationDays: 1,
    requiresJudgment: !hasCompletePackage || !hasValidWeight,
    neverEnableConvenienceWhenOversize: true
  };
}

function buildShopeeAutofillPayload(snapshot, easyStoreResult, trace = {}) {
  const easyStoreProductId = clean(easyStoreResult && easyStoreResult.productId);
  const now = Date.now();
  const addVariant = clean(snapshot.listingMode) === 'add-variant';
  const platformListingIds = Array.isArray(snapshot.shopeeExistingListingIds)
    ? [...new Set(snapshot.shopeeExistingListingIds.map(clean).filter(Boolean))].slice(0, 20)
    : [];
  const listingMode = addVariant
    ? 'add-variant-to-existing'
    : platformListingIds.length ? 'update-existing' : 'create-new';
  return {
    schemaVersion: SHOPEE_AUTOFILL_SCHEMA_VERSION,
    workflowVersion: LISTING_WORKFLOW_ID,
    jobId: clean(trace.jobId),
    snapshotId: clean(trace.snapshotId || (snapshot.platformImagePlan && snapshot.platformImagePlan.snapshotId)),
    snapshotFingerprint: clean(trace.snapshotFingerprint),
    nonce: crypto.randomBytes(16).toString('hex'),
    createdAt: now,
    expiresAt: now + 30 * 60 * 1000,
    productId: snapshot.productId,
    easyStoreProductId,
    easyStoreUrl: easyStoreProductId ? `https://admin.easystore.co/products/${encodeURIComponent(easyStoreProductId)}` : 'https://admin.easystore.co/',
    sku: snapshot.sku,
    title: snapshot.shopeeTitle,
    // A newly created EasyStore parent already contains the complete closed
    // variant set.  Shopee must therefore use its normal EasyStore channel
    // sync path; the extension's special variantGroup contract is reserved
    // for adding one child to an existing Shopee listing.
    publishMode: addVariant ? 'add-variant-to-existing' : 'auto',
    variantGroup: addVariant ? {
      parentProductId: snapshot.variantParentProductId,
      parentSku: snapshot.variantParentSku,
      parentName: snapshot.variantParentName,
      attributeName: snapshot.variantAttributeName,
      parentAttributeValue: snapshot.variantParentAttributeValue,
      attributeValue: snapshot.variantAttributeValue,
      parentImageUrl: snapshot.variantParentImageUrl,
      imageUrl: snapshot.variantChildImageUrl
    } : null,
    listingPolicy: {
      mode: listingMode,
      identitySource: platformListingIds.length ? 'central-platform-id' : 'new-draft',
      platformListingIds,
      preflightSkuSearch: false,
      uncertainSubmitRecovery: 'exact-sku-only'
    },
    categoryPath: shopeeCategorySegments(snapshot.shopeeCategoryPath, snapshot),
    brand: snapshot.shopeeBrand || snapshot.brand,
    advancedDescription: snapshot.shopeeAdvancedDescription,
    attributes: normalizeShopeeAttributes(snapshot.shopeeAttributeValues),
    package: {
      lengthCm: snapshot.packageLengthCm,
      widthCm: snapshot.packageWidthCm,
      heightCm: snapshot.packageHeightCm,
      weightKg: snapshot.packageWeightKg
    },
    logistics: buildShopeeLogistics(snapshot),
    preorder: { enabled: false, days: 1 },
    guard: {
      brand: snapshot.brand,
      model: snapshot.model,
      color: snapshot.color,
      identityStatus: snapshot.identityStatus
    }
  };
}

function identityAllowsShopeeAutofill(status, manualConfirmed) {
  return manualConfirmed === true || ['confirmed', 'possible'].includes(clean(status));
}

function summarizePlatformsForStorage(platforms) {
  const summary = {};
  Object.entries(platforms && typeof platforms === 'object' ? platforms : {}).forEach(([platform, raw]) => {
    if (!raw || typeof raw !== 'object') return;
    const key = clean(platform).slice(0, 60);
    if (!key) return;
    const row = {
      status: clean(raw.status).slice(0, 80),
      message: clean(raw.message).slice(0, 800)
    };
    if (Array.isArray(raw.missingFields)) {
      row.missingFields = raw.missingFields.map((value) => clean(value).slice(0, 160)).filter(Boolean).slice(0, 30);
    }
    if (clean(raw.queueId)) row.queueId = clean(raw.queueId).slice(0, 200);
    summary[key] = row;
  });
  return summary;
}

function platformListingStatusFromPublish(previous, platforms) {
  const current = previous && typeof previous === 'object' ? previous : {};
  const next = { ...current };
  const statusMap = {
    created: 'active', updated: 'active', completed: 'active', 'already-completed': 'mapped',
    'waiting-easystore-sync': 'queued', 'awaiting-store-agent': 'queued', 'already-queued': 'queued', submitted: 'queued',
    'action-required': 'error', 'missing-fields': 'error', 'waiting-easystore': 'error', failed: 'error'
  };
  Object.entries(platforms && typeof platforms === 'object' ? platforms : {}).forEach(([platform, raw]) => {
    if (!raw || typeof raw !== 'object') return;
    const old = current[platform] && typeof current[platform] === 'object' ? current[platform] : {};
    next[platform] = {
      ...old,
      status: statusMap[clean(raw.status)] || clean(old.status) || 'unknown',
      listingId: clean(raw.productId || raw.listingId || old.listingId),
      note: clean(raw.message).slice(0, 800),
      lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastCheckedBy: '商品上架工作'
    };
  });
  return next;
}

function escapeHtml(value) {
  return clean(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function productDescriptionToSafeHtml(value) {
  const lines = clean(value).replace(/\r/g, '').split('\n');
  const parts = [];
  let listOpen = false;
  function closeList() {
    if (listOpen) {
      parts.push('</ul>');
      listOpen = false;
    }
  }
  lines.forEach((rawLine) => {
    const line = clean(rawLine);
    if (!line) {
      closeList();
      return;
    }
    if (/^(商品特色|商品規格|包裝內容|適用對象|使用方式|注意事項)[：:]?$/.test(line)) {
      closeList();
      parts.push(`<h3>${escapeHtml(line.replace(/[：:]$/, ''))}</h3>`);
      return;
    }
    const item = line.match(/^(?:\d+[.、]|[-•●])\s*(.+)$/);
    if (item) {
      if (!listOpen) {
        parts.push('<ul>');
        listOpen = true;
      }
      parts.push(`<li>${escapeHtml(item[1])}</li>`);
      return;
    }
    closeList();
    parts.push(`<p>${escapeHtml(line)}</p>`);
  });
  closeList();
  return parts.join('');
}

function isAllowedManager(request) {
  const auth = request && request.auth;
  const token = auth && auth.token ? auth.token : {};
  const role = clean(token.role || token.userRole || token.permissionRole).toLowerCase();
  const email = clean(token.email || (auth && auth.email)).toLowerCase();
  return Boolean(auth && (
    token.admin === true || token.manager === true || token.owner === true ||
    ['admin', 'manager', 'owner', '主管', '管理者'].includes(role) || ADMIN_EMAILS.has(email)
  ));
}

function listingName(product, listingCase) {
  return clean(listingCase.researchedProductName || listingCase.productName || product.internalName || product.originalName || product.onlineName || product.name);
}

function listingDescription(listingCase) {
  const description = clean(listingCase.productDescription || listingCase.commonProductDescription) || [
    clean(listingCase.shortDescription), clean(listingCase.featureList), clean(listingCase.specificationText)
  ].filter(Boolean).join('\n\n');
  const withoutWarranty = description.split(/\r?\n/).filter((line) => !/(?:保固|保修)/.test(line)).join('\n').trim();
  if (!withoutWarranty || withoutWarranty.includes(PHYSICAL_PRODUCT_DISCLAIMER)) return withoutWarranty;
  return `${withoutWarranty}\n\n${PHYSICAL_PRODUCT_DISCLAIMER}`;
}

function listingDescriptionContentStatus(listingCase) {
  const description = listingDescription(listingCase);
  const content = description.replace(PHYSICAL_PRODUCT_DISCLAIMER, '').trim();
  const lines = content.replace(/\r/g, '').split('\n').map(clean).filter(Boolean);
  const hasFeatureSection = lines.some((line) => /^商品特色[：:]?$/.test(line));
  const hasUsageSection = lines.some((line) => /^(?:使用方式|適用情境)[：:]?$/.test(line));
  const hasSpecificationSection = lines.some((line) => /^商品規格[：:]?$/.test(line));
  let inFeatureSection = false;
  let featureCount = 0;
  lines.forEach((line) => {
    if (/^商品特色[：:]?$/.test(line)) {
      inFeatureSection = true;
      return;
    }
    if (/^(?:使用方式|適用情境|商品規格|包裝內容|適用對象|注意事項)[：:]?$/.test(line)) {
      inFeatureSection = false;
      return;
    }
    if (inFeatureSection && /^(?:\d+[.、]|[-•●])\s*\S+/.test(line)) featureCount += 1;
  });
  const genericFallback = /本商品為柚子樂器販售的樂器或樂器配件/.test(content)
    || (!hasFeatureSection && !hasUsageSection && !hasSpecificationSection
      && /(?:商品內容與規格以|如需確認尺寸、相容性或包裝內容)/.test(content));
  const missing = [];
  if (!content) missing.push('商品介紹');
  if (!hasFeatureSection || featureCount < 1) missing.push('可驗證商品特色');
  if (!hasUsageSection) missing.push('使用方式／適用情境');
  if (!hasSpecificationSection) missing.push('商品規格');
  if (genericFallback) missing.push('通用備援文案尚未改寫');
  return {
    ready: Boolean(content) && !genericFallback && hasFeatureSection && featureCount > 0
      && hasUsageSection && hasSpecificationSection,
    genericFallback,
    featureCount,
    missing: Array.from(new Set(missing))
  };
}

function appendPhysicalProductDisclaimerHtml(html) {
  const result = clean(html);
  if (!result || result.includes(PHYSICAL_PRODUCT_DISCLAIMER)) return result;
  return `${result}<p><strong>${PHYSICAL_PRODUCT_DISCLAIMER}</strong></p>`;
}

function appendShopDescriptionPromos(html) {
  let result = clean(html);
  DESCRIPTION_PROMO_IMAGE_URLS.forEach((url) => {
    if (!result.includes(url)) result += `<p><img src="${url}" alt="柚子樂器門市與服務資訊" style="max-width:100%;height:auto"></p>`;
  });
  return result;
}

function listingImageAllocation(value) {
  const productImages = normalizeUrls(value, 30)
    .filter((url) => url !== STORE_PROMO_IMAGE_URL && !DESCRIPTION_PROMO_IMAGE_URLS.includes(url))
    .slice(0, 12);
  const galleryImages = productImages.slice(0, 6);
  if (galleryImages.length) galleryImages.push(STORE_PROMO_IMAGE_URL);
  return {
    productImages,
    galleryImages,
    descriptionImages: productImages.slice(6)
  };
}

function appendShopDescriptionImages(html, imageUrls) {
  let result = clean(html);
  DESCRIPTION_PROMO_IMAGE_URLS.forEach((url) => {
    const block = `<p><img src="${url}" alt="柚子樂器門市與服務資訊" style="max-width:100%;height:auto"></p>`;
    result = result.split(block).join('');
  });
  normalizeUrls(imageUrls, 12).forEach((url) => {
    if (!result.includes(url)) result += `<p><img src="${url}" alt="商品介紹圖片" style="max-width:100%;height:auto"></p>`;
  });
  return appendShopDescriptionPromos(result);
}

function listingImageRoles(row) {
  const values = [].concat(row && row.roles || [], row && row.imageRoles || [], row && row.role || []);
  return Array.from(new Set(values.map(clean).filter((role) => LISTING_IMAGE_ROLES.has(role))));
}

function listingImageAssetFlags(row) {
  const source = row && typeof row === 'object' ? row : {};
  const flags = source.assetFlags && typeof source.assetFlags === 'object' ? source.assetFlags : {};
  return {
    containsLogo: source.containsLogo === true || flags.containsLogo === true,
    containsContactInfo: source.containsContactInfo === true || flags.containsContactInfo === true,
    containsQrCode: source.containsQrCode === true || flags.containsQrCode === true,
    containsText: source.containsText === true || flags.containsText === true,
    greenBrandTemplate: source.greenBrandTemplate === true || flags.greenBrandTemplate === true,
    momoPromotionEligible: source.momoPromotionEligible === true || flags.momoPromotionEligible === true
  };
}

function cleanRepresentativeRoleRow(row) {
  const roles = listingImageRoles(row);
  const flags = listingImageAssetFlags(row);
  return roles.includes('cleanMain')
    && !flags.containsLogo && !flags.containsContactInfo && !flags.containsQrCode && !flags.containsText && !flags.greenBrandTemplate;
}

function storefrontPortraitRoleRow(row) {
  const roles = listingImageRoles(row);
  const flags = listingImageAssetFlags(row);
  return roles.includes('storefrontPortrait')
    && flags.containsLogo && flags.containsText && flags.greenBrandTemplate
    && !flags.containsContactInfo && !flags.containsQrCode;
}

function localizedImageRowsBySource(listingCase) {
  const rows = listingCase && Array.isArray(listingCase.generatedListingImages)
    ? listingCase.generatedListingImages : [];
  const result = new Map();
  const rolesByUrl = new Map();
  rows.forEach((row) => {
    const sourceUrl = safeHttpUrl(row && row.sourceImageUrl);
    const completedUrl = safeHttpUrl(row && row.url);
    const ready = clean(row && row.status).toLowerCase() === 'ready';
    const localized = clean(row && row.localizationStatus).toLowerCase() === 'completed'
      || clean(row && row.qaStatus).toLowerCase() === 'approved';
    const roles = listingImageRoles(row);
    if (!sourceUrl || !completedUrl || sourceUrl === completedUrl || !ready || !localized || !roles.length) return;
    const urlRoles = rolesByUrl.get(completedUrl) || new Set();
    roles.forEach((role) => urlRoles.add(role));
    rolesByUrl.set(completedUrl, urlRoles);
    const values = result.get(sourceUrl) || [];
    values.push({ sourceImageUrl: sourceUrl, url: completedUrl, roles, assetFlags: listingImageAssetFlags(row) });
    result.set(sourceUrl, values);
  });
  result.forEach((rowsForSource, sourceUrl) => {
    result.set(sourceUrl, rowsForSource.filter((row) => {
      const urlRoles = rolesByUrl.get(row.url) || new Set();
      const layoutRoles = ['cleanMain', 'brandedHero', 'storefrontPortrait'].filter((role) => urlRoles.has(role));
      return layoutRoles.length <= 1;
    }));
  });
  return result;
}

function localizedRepresentativeImage(listingCase, sourceUrl) {
  const rows = localizedImageRowsBySource(listingCase).get(safeHttpUrl(sourceUrl)) || [];
  const cleanRows = rows.filter(cleanRepresentativeRoleRow);
  const representative = cleanRows.find((row) => row.roles.includes('variantRepresentative'))
    || cleanRows.find((row) => row.roles.includes('cleanMain'));
  return representative ? representative.url : '';
}

function prioritizedListingImageUrls(listingCase) {
  const source = listingCase && typeof listingCase === 'object' ? listingCase : {};
  const listingUrls = normalizeUrls(source.listingImageUrls, 30);
  const prioritized = normalizeUrls(source.gallerySourceImageUrls, 20)
    .map((sourceUrl) => localizedRepresentativeImage(source, sourceUrl) || (listingUrls.includes(sourceUrl) ? sourceUrl : ''))
    .filter((url) => url && listingUrls.includes(url));
  return prioritized.concat(listingUrls.filter((url) => !prioritized.includes(url)));
}

function finalizedRoleRowsForCase(productId, frozenCase, currentCase) {
  const frozenSources = normalizeUrls(frozenCase && frozenCase.sourceImageUrls, 20);
  const allowedSources = new Set(frozenSources);
  if (!clean(productId) || !frozenSources.length) throw new Error(`${clean(productId) || '未知商品'}的凍結來源圖清單為空。`);
  const generated = currentCase && Array.isArray(currentCase.generatedListingImages)
    ? currentCase.generatedListingImages : [];
  const readyRows = [];
  const lineageKeys = new Set();
  generated.forEach((row) => {
    const status = clean(row && row.status).toLowerCase();
    const localized = clean(row && row.localizationStatus).toLowerCase() === 'completed'
      || clean(row && row.qaStatus).toLowerCase() === 'approved';
    if (status !== 'ready' || !localized) return;
    const sourceImageUrl = safeHttpUrl(row && row.sourceImageUrl);
    const url = safeHttpUrl(row && row.url);
    const roles = listingImageRoles(row);
    if (!sourceImageUrl || !allowedSources.has(sourceImageUrl)) {
      throw new Error(`${clean(productId)}的完成圖來源不在凍結輸入清單。`);
    }
    if (!url || allowedSources.has(url)) throw new Error(`${clean(productId)}的完成圖仍是凍結來源原圖。`);
    if (!roles.length) throw new Error(`${clean(productId)}的完成圖缺少圖片角色。`);
    const flags = row && row.assetFlags && typeof row.assetFlags === 'object' ? row.assetFlags : null;
    if (!flags || !['containsLogo', 'containsContactInfo', 'containsQrCode', 'containsText', 'greenBrandTemplate', 'momoPromotionEligible']
      .every((keyName) => typeof flags[keyName] === 'boolean')) {
      throw new Error(`${clean(productId)}的完成圖缺少完整 assetFlags。`);
    }
    roles.forEach((role) => {
      const lineageKey = `${sourceImageUrl}|${role}`;
      if (lineageKeys.has(lineageKey)) throw new Error(`${clean(productId)}的同一來源與角色有多個完成輸出。`);
      lineageKeys.add(lineageKey);
    });
    readyRows.push({
      productId: clean(productId), sourceImageUrl, url, roles,
      sourceOrder: Math.max(0, Number(row && row.sourceOrder) || frozenSources.indexOf(sourceImageUrl) + 1),
      assetFlags: listingImageAssetFlags(row)
    });
  });
  const rolesByUrl = new Map();
  readyRows.forEach((row) => {
    const roles = rolesByUrl.get(row.url) || new Set();
    row.roles.forEach((role) => roles.add(role));
    rolesByUrl.set(row.url, roles);
  });
  rolesByUrl.forEach((roles) => {
    const layoutRoles = ['cleanMain', 'brandedHero', 'storefrontPortrait'].filter((role) => roles.has(role));
    if (layoutRoles.length > 1) throw new Error(`${clean(productId)}的同一完成圖不得同時兼任不同尺寸的首圖角色。`);
  });
  frozenSources.forEach((sourceImageUrl) => {
    const rows = readyRows.filter((row) => row.sourceImageUrl === sourceImageUrl);
    if (!rows.some((row) => row.roles.some((role) => ['cleanMain', 'localizedDetail', 'specification', 'variantRepresentative'].includes(role)))) {
      throw new Error(`${clean(productId)}的凍結來源圖尚無可上架的繁體完成圖。`);
    }
  });
  return readyRows;
}

function buildFinalPlatformImagePlan(caseRows) {
  const groups = (Array.isArray(caseRows) ? caseRows : []).map((item) => {
    const allowed = new Set(normalizeUrls(item && item.gallerySourceImageUrls, 12));
    return (Array.isArray(item && item.roleRows) ? item.roleRows : [])
      .filter((row) => !allowed.size || allowed.has(row.sourceImageUrl) || allowed.has(row.url))
      .slice().sort((a, b) => {
      const rank = (row) => row.roles.includes('cleanMain') ? 0
        : row.roles.includes('storefrontPortrait') ? 1 : row.roles.includes('brandedHero') ? 2 : 3;
      return rank(a) - rank(b) || a.sourceOrder - b.sourceOrder;
    });
  });
  const pool = [];
  const seen = new Set();
  const coveredGroups = new Set();
  const pushRow = (row, groupIndex) => {
    if (!row || seen.has(row.url) || pool.length >= 12) return false;
    seen.add(row.url);
    pool.push(row);
    if (Number.isInteger(groupIndex)) coveredGroups.add(groupIndex);
    return true;
  };
  const findRoleRow = (role, excludedGroups = []) => {
    const excluded = new Set(Array.isArray(excludedGroups) ? excludedGroups : [excludedGroups]);
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      if (excluded.has(groupIndex)) continue;
      const row = groups[groupIndex].find((candidate) => candidate.roles.includes(role));
      if (row) return { row, groupIndex };
    }
    return null;
  };

  // Reserve the three channel-specific hero roles before the 12-image cap can be consumed by
  // one role. With multiple variants, put the reserved roles in different groups
  // when possible so the pool still covers as many variants as the cap permits.
  const reservedClean = findRoleRow('cleanMain');
  if (reservedClean) pushRow(reservedClean.row, reservedClean.groupIndex);
  const reservedBrand = findRoleRow('brandedHero', groups.length > 1 && reservedClean ? [reservedClean.groupIndex] : [])
    || findRoleRow('brandedHero');
  if (reservedBrand) pushRow(reservedBrand.row, reservedBrand.groupIndex);
  const occupiedHeroGroups = [reservedClean, reservedBrand].filter(Boolean).map((entry) => entry.groupIndex);
  const reservedStorefront = findRoleRow('storefrontPortrait', groups.length > occupiedHeroGroups.length ? occupiedHeroGroups : [])
    || findRoleRow('storefrontPortrait');
  if (reservedStorefront) pushRow(reservedStorefront.row, reservedStorefront.groupIndex);

  // Give every not-yet-covered variant one representative before adding second
  // images for already-covered variants. When there are more than 12 variants,
  // this deterministic pass is the fairest possible bounded allocation.
  groups.forEach((rows, groupIndex) => {
    if (coveredGroups.has(groupIndex) || pool.length >= 12) return;
    const representative = rows.find((row) => row.roles.includes('cleanMain') && cleanRepresentativeRoleRow(row))
      || rows.find((row) => row.roles.includes('variantRepresentative'))
      || rows.find((row) => row.roles.some((role) => ['localizedDetail', 'specification'].includes(role)))
      || rows[0];
    pushRow(representative, groupIndex);
  });
  for (let index = 0; pool.length < 12 && groups.some((rows) => index < rows.length); index += 1) {
    groups.forEach((rows, groupIndex) => pushRow(rows[index], groupIndex));
  }
  const urls = (values) => normalizeUrls(values.map((row) => row.url), 12);
  const cleanRows = pool.filter((row) => row.roles.includes('cleanMain') && cleanRepresentativeRoleRow(row));
  const brandedRows = pool.filter((row) => row.roles.includes('brandedHero')
    && row.assetFlags.containsLogo && row.assetFlags.greenBrandTemplate
    && !row.assetFlags.containsContactInfo && !row.assetFlags.containsQrCode);
  const storefrontRows = pool.filter(storefrontPortraitRoleRow);
  const detailRows = pool.filter((row) => row.roles.some((role) => ['localizedDetail', 'specification', 'variantRepresentative'].includes(role)));
  const safeBrandedRows = brandedRows.filter((row) => !row.assetFlags.containsContactInfo && !row.assetFlags.containsQrCode);
  const uniqueRows = (values) => {
    const found = new Set();
    return values.filter((row) => row && !found.has(row.url) && found.add(row.url));
  };
  const easyRows = uniqueRows(storefrontRows.concat(cleanRows, detailRows, brandedRows, pool));
  const shopeeRows = uniqueRows(brandedRows.concat(cleanRows, detailRows, pool));
  const cleanFirst = cleanRows.slice(0, 1);
  const promoRow = pool.find((row) => (!cleanFirst[0] || row.url !== cleanFirst[0].url)
    && row.assetFlags.momoPromotionEligible
    && !row.assetFlags.containsLogo && !row.assetFlags.containsContactInfo && !row.assetFlags.containsQrCode
    && !row.assetFlags.containsText && !row.assetFlags.greenBrandTemplate
    && row.roles.some((role) => ['cleanMain', 'localizedDetail', 'specification'].includes(role)));
  const secondaryBrand = safeBrandedRows.find((row) => !cleanFirst[0] || row.url !== cleanFirst[0].url);
  const nonBrandedRemainder = pool.filter((row) => !row.roles.includes('brandedHero') && !row.roles.includes('storefrontPortrait'));
  const coupangRows = uniqueRows(cleanFirst.concat(secondaryBrand || [], nonBrandedRemainder, detailRows));
  // MOMO's promotion material must be visible in position 2 or 3. Put it second,
  // then allow at most one safe branded secondary image.
  const momoRows = uniqueRows(cleanFirst.concat(promoRow || [], secondaryBrand || [], nonBrandedRemainder, detailRows));
  const momoPromoCandidates = momoRows.slice(1, 3);
  const orderedPromoRow = momoPromoCandidates.find((row) => row.assetFlags.momoPromotionEligible
    && !row.assetFlags.containsLogo && !row.assetFlags.containsContactInfo && !row.assetFlags.containsQrCode
    && !row.assetFlags.containsText && !row.assetFlags.greenBrandTemplate
    && row.roles.some((role) => ['cleanMain', 'localizedDetail', 'specification'].includes(role)));
  return {
    sharedCompletedImageUrls: urls(pool),
    easyStore: { imageUrls: urls(easyRows), requiredFirstRole: 'storefrontPortrait', ready: Boolean(easyRows[0] && easyRows[0].roles.includes('storefrontPortrait')) },
    shopee: { imageUrls: urls(shopeeRows), requiredFirstRole: 'brandedHero', ready: Boolean(shopeeRows[0] && shopeeRows[0].roles.includes('brandedHero')) },
    coupang: { imageUrls: urls(coupangRows), requiredFirstRole: 'cleanMain', ready: Boolean(coupangRows[0] && coupangRows[0].roles.includes('cleanMain')), brandedHeroAllowedAsSecondary: true, removeSecondaryBrandedHeroIfPlatformRejectsGalleryLogo: true },
    momo: { imageUrls: urls(momoRows), requiredFirstRole: 'cleanMain', ready: Boolean(momoRows[0] && momoRows[0].roles.includes('cleanMain')), brandedHeroAllowedAsSecondary: true, promotionImageUrl: orderedPromoRow ? orderedPromoRow.url : '', promotionImageReady: Boolean(orderedPromoRow) }
  };
}

function frozenInputSnapshotFingerprint(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return crypto.createHash('sha256').update(JSON.stringify(compactObject(source))).digest('hex');
}

function finalizePreparedMediaSnapshot(frozenInputSnapshot, currentCasesById) {
  const frozen = frozenInputSnapshot && typeof frozenInputSnapshot === 'object' ? frozenInputSnapshot : {};
  if (clean(frozen.workflowVersion) !== LISTING_WORKFLOW_ID) throw new Error('只能從 v3 凍結輸入快照建立完成圖快照。');
  const frozenCases = Array.isArray(frozen.cases) ? frozen.cases : [];
  if (!frozenCases.length) throw new Error('v3 凍結輸入快照沒有商品案件。');
  const allFrozenSourceUrls = new Set(frozenCases.flatMap((item) => normalizeUrls(item && item.sourceImageUrls, 20)));
  const currentMap = currentCasesById instanceof Map
    ? currentCasesById : new Map(Object.entries(currentCasesById && typeof currentCasesById === 'object' ? currentCasesById : {}));
  const cases = frozenCases.map((frozenCase) => {
    const productId = clean(frozenCase && frozenCase.productId);
    const currentCase = currentMap.get(productId);
    if (!productId || !currentCase) throw new Error(`${productId || '未知商品'}無法重讀最新案件。`);
    const roleRows = finalizedRoleRowsForCase(productId, frozenCase, currentCase);
    if (roleRows.some((row) => allFrozenSourceUrls.has(row.url))) {
      throw new Error(`${productId}的完成圖仍是本組其他商品的凍結來源原圖。`);
    }
    const representativeSourceImageUrl = safeHttpUrl(frozenCase && frozenCase.representativeSourceImageUrl);
    const representativeRow = representativeSourceImageUrl
      ? roleRows.find((row) => row.sourceImageUrl === representativeSourceImageUrl && cleanRepresentativeRoleRow(row)) : null;
    return {
      productId, sku: clean(frozenCase && frozenCase.sku || currentCase.productSku),
      sourceImageUrls: normalizeUrls(frozenCase && frozenCase.sourceImageUrls, 20),
      gallerySourceImageUrls: normalizeUrls(frozenCase && frozenCase.gallerySourceImageUrls, 12),
      representativeSourceImageUrl,
      representativeCompletedImageUrl: representativeRow ? representativeRow.url : '',
      roleRows,
      preparedCase: {
        imageRoleAssignments: roleRows.map((row) => ({
          sourceImageUrl: row.sourceImageUrl, url: row.url, roles: row.roles.slice(), assetFlags: { ...row.assetFlags }
        })),
        sourceImageRetention: currentCase.sourceImageRetentionPolicy && typeof currentCase.sourceImageRetentionPolicy === 'object'
          ? currentCase.sourceImageRetentionPolicy : {}
      }
    };
  });
  return {
    workflowVersion: LISTING_WORKFLOW_ID,
    snapshotId: `${clean(frozen.snapshotId) || clean(frozen.productId)}-final`,
    inputSnapshotId: clean(frozen.snapshotId),
    inputSnapshotFingerprint: frozenInputSnapshotFingerprint(frozen),
    finalizedFromFrozenInput: true,
    cases,
    platformImagePlan: buildFinalPlatformImagePlan(cases)
  };
}

async function loadFinalPreparedMediaSnapshot(db, productId, listingCase) {
  const frozen = listingCase && listingCase.codexHandoff && listingCase.codexHandoff.preflightSnapshot;
  if (!frozen || typeof frozen !== 'object') throw new Error('找不到 v3 凍結輸入快照。');
  const ids = Array.from(new Set((Array.isArray(frozen.cases) ? frozen.cases : []).map((item) => clean(item && item.productId)).filter(Boolean)));
  if (!ids.includes(clean(productId))) throw new Error('凍結輸入快照與本商品不一致。');
  const snapshots = await Promise.all(ids.map((id) => db.collection(LISTING_CASE_COLLECTION).doc(id).get()));
  const currentCases = new Map();
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) throw new Error(`${ids[index]}的商品案件已不存在。`);
    currentCases.set(ids[index], snapshot.data() || {});
  });
  return {
    rootListingCase: currentCases.get(clean(productId)), currentCases,
    preparedMediaSnapshot: finalizePreparedMediaSnapshot(frozen, currentCases)
  };
}

function preparedPlatformImagePlan(listingCase, finalizedMediaSnapshot = null) {
  const handoff = listingCase && listingCase.codexHandoff && typeof listingCase.codexHandoff === 'object'
    ? listingCase.codexHandoff : {};
  const prepared = finalizedMediaSnapshot && typeof finalizedMediaSnapshot === 'object'
    ? finalizedMediaSnapshot
    : handoff.preflightSnapshot && typeof handoff.preflightSnapshot === 'object' ? handoff.preflightSnapshot : {};
  const source = prepared.platformImagePlan && typeof prepared.platformImagePlan === 'object'
    ? prepared.platformImagePlan : {};
  const roleRows = [];
  (Array.isArray(prepared.cases) ? prepared.cases : []).forEach((item) => {
    const preparedCase = item && item.preparedCase && typeof item.preparedCase === 'object' ? item.preparedCase : {};
    const assignments = Array.isArray(preparedCase.imageRoleAssignments) ? preparedCase.imageRoleAssignments : [];
    assignments.forEach((row) => {
      const url = safeHttpUrl(row && row.url);
      const sourceImageUrl = safeHttpUrl(row && row.sourceImageUrl);
      const roles = listingImageRoles(row);
      if (!url || !sourceImageUrl || url === sourceImageUrl || !roles.length) return;
      roleRows.push({
        productId: clean(item && item.productId), sourceImageUrl, url, roles,
        assetFlags: listingImageAssetFlags(row),
        assetFlagsDeclared: Boolean(row && row.assetFlags && typeof row.assetFlags === 'object'
          && ['containsLogo', 'containsContactInfo', 'containsQrCode', 'containsText', 'greenBrandTemplate', 'momoPromotionEligible']
            .every((keyName) => typeof row.assetFlags[keyName] === 'boolean'))
      });
    });
  });
  const rolesByUrl = new Map();
  roleRows.forEach((row) => {
    const roles = rolesByUrl.get(row.url) || new Set();
    row.roles.forEach((role) => roles.add(role));
    rolesByUrl.set(row.url, roles);
  });
  const normalizePlatform = (key) => {
    const row = source[key] && typeof source[key] === 'object' ? source[key] : {};
    const imageUrls = normalizeUrls(row.imageUrls, 12);
    const imageRoleAssignments = imageUrls.map((url) => {
      const matches = roleRows.filter((candidate) => candidate.url === url);
      const roles = Array.from(rolesByUrl.get(url) || []);
      const assetFlags = matches.reduce((flags, candidate) => ({
        containsLogo: flags.containsLogo || candidate.assetFlags.containsLogo,
        containsContactInfo: flags.containsContactInfo || candidate.assetFlags.containsContactInfo,
        containsQrCode: flags.containsQrCode || candidate.assetFlags.containsQrCode,
        containsText: flags.containsText || candidate.assetFlags.containsText,
        greenBrandTemplate: flags.greenBrandTemplate || candidate.assetFlags.greenBrandTemplate,
        momoPromotionEligible: flags.momoPromotionEligible || candidate.assetFlags.momoPromotionEligible
      }), { containsLogo: false, containsContactInfo: false, containsQrCode: false, containsText: false, greenBrandTemplate: false, momoPromotionEligible: false });
      return {
        url, sourceImageUrls: Array.from(new Set(matches.map((candidate) => candidate.sourceImageUrl))), roles, assetFlags,
        metadataVerified: matches.length > 0 && matches.every((candidate) => candidate.assetFlagsDeclared)
          && ['cleanMain', 'brandedHero', 'storefrontPortrait'].filter((role) => roles.includes(role)).length <= 1
      };
    });
    const requiredFirstRole = clean(row.requiredFirstRole);
    const first = imageRoleAssignments[0] || null;
    const allMetadataVerified = imageRoleAssignments.length > 0 && imageRoleAssignments.every((entry) => entry.metadataVerified);
    const firstRoleVerified = Boolean(first && first.metadataVerified && first.roles.includes(requiredFirstRole)
      && (requiredFirstRole === 'cleanMain'
        ? cleanRepresentativeRoleRow(first)
        : requiredFirstRole === 'brandedHero'
          ? first.assetFlags.containsLogo && first.assetFlags.greenBrandTemplate
            && !first.assetFlags.containsContactInfo && !first.assetFlags.containsQrCode
          : requiredFirstRole === 'storefrontPortrait'
            ? storefrontPortraitRoleRow(first)
            : false));
    const brandedAfterMain = imageRoleAssignments.slice(1).filter((entry) => entry.roles.includes('brandedHero'));
    const safeBrandedAfterMain = brandedAfterMain.every((entry) => !entry.assetFlags.containsContactInfo && !entry.assetFlags.containsQrCode)
      && (key !== 'momo' || brandedAfterMain.length <= 1);
    const promotionImageUrl = safeHttpUrl(row.promotionImageUrl);
    const promotionEntry = imageRoleAssignments.find((entry) => entry.url === promotionImageUrl) || null;
    const promotionImageReady = row.promotionImageReady === true
      && [imageUrls[1], imageUrls[2]].filter(Boolean).includes(promotionImageUrl)
      && Boolean(promotionEntry && promotionEntry.metadataVerified
        && promotionEntry.assetFlags.momoPromotionEligible
        && !promotionEntry.assetFlags.containsLogo && !promotionEntry.assetFlags.containsContactInfo
        && !promotionEntry.assetFlags.containsQrCode && !promotionEntry.assetFlags.containsText
        && !promotionEntry.assetFlags.greenBrandTemplate
        && promotionEntry.roles.some((role) => ['cleanMain', 'localizedDetail', 'specification'].includes(role)));
    return {
      imageUrls,
      imageRoleAssignments,
      requiredFirstRole,
      firstRoleVerified,
      roleMetadataVerified: allMetadataVerified && firstRoleVerified && safeBrandedAfterMain,
      ready: row.ready === true && allMetadataVerified && firstRoleVerified && safeBrandedAfterMain,
      promotionImageUrl,
      promotionImageReady,
      brandedHeroAllowedAsSecondary: row.brandedHeroAllowedAsSecondary === true,
      removeSecondaryBrandedHeroIfPlatformRejectsGalleryLogo: row.removeSecondaryBrandedHeroIfPlatformRejectsGalleryLogo === true
    };
  };
  return {
    workflowVersion: clean(prepared.workflowVersion || handoff.workflowVersion),
    snapshotId: clean(prepared.snapshotId),
    source: prepared.finalizedFromFrozenInput === true
      ? 'codex-v3-finalized-media-snapshot'
      : clean(prepared.workflowVersion || handoff.workflowVersion) === LISTING_WORKFLOW_ID ? 'codex-v3-prepared-snapshot' : 'missing-or-legacy',
    finalizedFromFrozenInput: prepared.finalizedFromFrozenInput === true,
    inputSnapshotId: clean(prepared.inputSnapshotId),
    inputSnapshotFingerprint: clean(prepared.inputSnapshotFingerprint),
    roleAssignments: roleRows,
    imageReferenceCases: (Array.isArray(prepared.cases) ? prepared.cases : []).map((item) => ({
      productId: clean(item && item.productId),
      sku: clean(item && item.sku),
      sourceImageUrls: normalizeUrls(item && item.sourceImageUrls, 20),
      representativeSourceImageUrl: safeHttpUrl(item && item.representativeSourceImageUrl),
      representativeCompletedImageUrl: safeHttpUrl(item && item.representativeCompletedImageUrl),
      sourceImageRetention: item && item.preparedCase && item.preparedCase.sourceImageRetention && typeof item.preparedCase.sourceImageRetention === 'object'
        ? item.preparedCase.sourceImageRetention : {}
    })).filter((item) => item.productId),
    sharedCompletedImageUrls: normalizeUrls(source.sharedCompletedImageUrls, 12),
    easyStore: normalizePlatform('easyStore'),
    shopee: normalizePlatform('shopee'),
    coupang: normalizePlatform('coupang'),
    momo: normalizePlatform('momo')
  };
}

function platformImagePlanMissingFields(plan, options = {}) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const missing = [];
  const acceptedSource = source.source === 'codex-v3-prepared-snapshot' || source.source === 'codex-v3-finalized-media-snapshot';
  if (source.workflowVersion !== LISTING_WORKFLOW_ID || !acceptedSource) missing.push('v3 圖片角色預檢快照');
  if (options.requireFinalized === true && (source.source !== 'codex-v3-finalized-media-snapshot'
    || source.finalizedFromFrozenInput !== true || !source.inputSnapshotId || !source.inputSnapshotFingerprint)) {
    missing.push('來源輸入驗證後的最終完成圖快照');
  }
  [['easyStore', 'storefrontPortrait'], ['shopee', 'brandedHero'], ['coupang', 'cleanMain'], ['momo', 'cleanMain']].forEach(([platform, role]) => {
    const row = source[platform] && typeof source[platform] === 'object' ? source[platform] : {};
    if (!row.ready || !row.roleMetadataVerified || row.requiredFirstRole !== role || !row.imageUrls.length) missing.push(`${platform} 首圖角色 ${role}`);
  });
  const momo = source.momo && typeof source.momo === 'object' ? source.momo : {};
  if (!momo.promotionImageReady || !momo.promotionImageUrl) missing.push('MOMO clean-only 專推圖');
  return missing;
}

function variantRepresentativeMissingFields(snapshot) {
  const missing = [];
  if (snapshot.listingMode === 'add-variant') {
    if (!snapshot.variantParentSourceImageUrl) missing.push('原商品代表圖');
    else if (!snapshot.variantParentImageUrl) missing.push('原商品代表圖的繁體完成版');
    if (!snapshot.variantChildSourceImageUrl) missing.push('新細項代表圖');
    else if (!snapshot.variantChildImageUrl) missing.push('新細項代表圖的繁體完成版');
  } else if (snapshot.variantGroupEnabled) {
    if (!snapshot.variantGroupPrimarySourceImageUrl) missing.push('目前商品代表圖');
    else if (!snapshot.variantGroupPrimaryImageUrl) missing.push('目前商品代表圖的繁體完成版');
    if (!snapshot.variantGroupAttributeName) missing.push('同款商品細項種類');
    const variants = Array.isArray(snapshot.variantGroupVariants) ? snapshot.variantGroupVariants : [];
    if (variants.length < 2) missing.push('同款商品至少兩個細項');
    variants.forEach((variant, index) => {
      const label = clean(variant && (variant.sku || variant.attributeValue)) || `第 ${index + 1} 個細項`;
      if (!clean(variant && variant.sku)) missing.push(`${label} SKU`);
      if (!clean(variant && variant.attributeValue)) missing.push(`${label} 細項名稱`);
      if (!safeHttpUrl(variant && variant.sourceImageUrl)) missing.push(`${label} 指定代表圖`);
      if (!safeHttpUrl(variant && variant.imageUrl)) missing.push(`${label} 指定代表圖的繁體完成版`);
      if (numberOrNull(variant && variant.easyStorePrice) === null) missing.push(`${label} EasyStore 售價`);
      if (numberOrNull(variant && variant.momoPrice) === null) missing.push(`${label} MOMO 售價`);
      if (numberOrNull(variant && variant.coupangPrice) === null) missing.push(`${label} 酷澎售價`);
    });
  }
  return missing;
}

function buildCanonicalCategoryDecision(snapshot) {
  const evidence = {
    title: snapshot.title,
    shopeeTitle: snapshot.shopeeTitle,
    productName: snapshot.title,
    category: snapshot.category,
    model: snapshot.model
  };
  const family = shopeeTaxonomy.inferMusicFamily(evidence, snapshot.shopeeCategoryPath);
  const shopeePath = shopeeTaxonomy.formatCategoryPath(snapshot.shopeeCategoryPath, evidence);
  const normalizedFamily = clean(family) || '未判定';
  return {
    version: 1,
    decidedOnceBeforePlatformNavigation: true,
    scope: 'musical-instruments-and-accessories-only',
    canonicalFamily: normalizedFamily,
    canonicalKey: normalizedFamily === '未判定' ? '' : `music:${normalizedFamily}`,
    evidenceSummary: clean([snapshot.category, snapshot.title, snapshot.model].filter(Boolean).join('｜')).slice(0, 500),
    platformMappings: {
      easyStore: { value: clean(snapshot.category) || normalizedFamily, status: clean(snapshot.category) || family ? 'resolved' : 'unresolved' },
      shopee: { value: shopeePath, status: shopeePath ? 'resolved' : 'unresolved' },
      coupang: { value: clean(snapshot.coupangCategoryCode), status: clean(snapshot.coupangCategoryCode) ? 'resolved' : 'map-once-before-platform' },
      momo: { value: clean(snapshot.momoCategoryCode), status: clean(snapshot.momoCategoryCode) ? 'resolved' : 'map-once-before-platform' }
    },
    forbidPerPlatformReclassification: true,
    remapOnlyWhenPlatformTaxonomyRejectsStoredMapping: true
  };
}

function buildListingDecisionContract(snapshot) {
  return {
    version: 1,
    mode: 'deterministic-workflow-with-structured-judgment',
    immutableForJob: true,
    deterministicSteps: [
      'freeze-case-input', 'validate-completed-image-lineage', 'sync-central-clean-images',
      'prepare-platform-field-plan-once', 'run-momo-coupang-easystore-roots',
      'run-shopee-after-easystore', 'verify-each-platform-once', 'cleanup-source-binaries-after-all-verification'
    ],
    automaticFields: {
      priceFallbackOrder: ['platform-price', 'shared-online-price', 'online-price', 'store-price'],
      warrantyDays: 180,
      publishImmediately: true,
      momoThirdPartyLocationCode: MOMO_THIRD_PARTY_DELIVERY.locationCode,
      centralImageRole: 'cleanMain',
      easyStoreFirstImageRole: 'storefrontPortrait',
      shopeeFirstImageRole: 'brandedHero',
      coupangFirstImageRole: 'cleanMain',
      momoFirstImageRole: 'cleanMain',
      retryPolicy: 'same-sku-same-draft-same-stage-only',
      routineConfirmation: 'already-authorized-by-handoff'
    },
    judgmentFields: {
      imageLocalization: {
        resolver: 'codex-vision', required: true,
        output: ['sourceImageUrl', 'url', 'roles', 'assetFlags'],
        rules: ['zh-TW', 'mainland-terms-to-taiwan', 'remove-or-reflow-cropped-text', 'never-invent-unverified-content']
      },
      heroSourceSelection: {
        resolver: 'codex-vision', required: true,
        allowedRoles: ['cleanMain', 'brandedHero', 'storefrontPortrait']
      },
      verifiedProductContent: {
        resolver: 'codex-evidence', required: true,
        output: ['title', 'description', 'brand', 'model', 'verified-features', 'verified-usage', 'verified-specifications'],
        requiredDescriptionSections: ['商品特色', '使用方式／適用情境', '商品規格'],
        genericFallbackIsIncomplete: true,
        writeBackToEveryCaseBeforePreparedSnapshot: true
      },
      categoryAndAttributes: {
        resolver: 'canonical-category-once-then-platform-mapping', required: true,
        scope: 'musical-instruments-and-accessories-only',
        canonicalDecision: { ...(snapshot.canonicalCategoryDecision || {}) },
        neverReclassifyInsideEachPlatform: true
      },
      variantNames: {
        resolver: 'manager-value-first-then-codex', requiredWhen: 'variant-group',
        neverOverrideManagerValue: true
      },
      shippingByDimensions: {
        resolver: 'deterministic-once-before-platform-when-dimensions-known',
        preparedDecision: buildShopeeLogistics(snapshot),
        mapPreparedDecisionToEveryPlatform: true,
        neverRejudgeInsideEachPlatform: true,
        requireEvidenceForOversizeDecision: true
      }
    },
    forbiddenJudgment: [
      'invent-certification', 'invent-brand-or-model', 'invent-feature-or-accessory',
      'change-sku-set', 'change-platform-order', 'create-replacement-on-retry', 'request-routine-second-confirmation'
    ],
    unresolvedAction: 'stop-before-platform-navigation-with-exact-field-reason',
    sourceSnapshotId: clean(snapshot && snapshot.platformImagePlan && snapshot.platformImagePlan.snapshotId)
  };
}

function buildPlatformPageContracts() {
  const common = {
    version: 2,
    observedAt: '2026-08-22',
    cacheScope: 'platform-and-layout-signature',
    selectorStrategy: ['stable-label', 'name', 'data-attribute', 'role', 'relative-section'],
    forbidVolatileElementIdAsOnlySelector: true,
    lightweightProbeBeforeFill: true,
    fullPageInventoryIsOneTimeOnly: true,
    fillFromPreparedPlatformFieldPlan: true,
    rescanCurrentSectionOnlyWhenSignatureChanges: true,
    neverRestartCompletedPlatformStages: true,
    fieldsPreparedBeforeNavigation: true,
    batchExecution: {
      mode: 'section-batch',
      resolveFieldsOncePerSection: true,
      fillStableControlsInSinglePass: true,
      validateStableSectionAfterBatch: false,
      validateDynamicSectionOnceAfterBatch: true,
      dynamicControlsSequentialWithinSection: true,
      imageUploadAsSingleBatch: true,
      neverRescanUnchangedSection: true
    },
    loginProbeBeforeProductNavigation: true,
    resumeSameProductOrDraftAfterLoginRecovery: true,
    newCaseBoundary: {
      resetOncePerDifferentSku: true,
      discardPreviousSearchDrawerAndUnboundDraftState: true,
      bindStartToCurrentProductIdSkuAndSnapshotId: true,
      neverTreatPreviousCaseScreenAsCurrentCaseEvidence: true,
      keepSameSkuSameDraftOnRetry: true
    }
  };
  return {
    momo: {
      ...common, version: 3, routeKey: 'momo-product-create-or-same-draft',
      canonicalEntry: { route: 'B101 新增/管理商品', purpose: 'new-case-start' },
      verifiedFromLivePage: true,
      authenticatedLandmarks: ['momo 店＋管理系統', '商品', 'B101 新增/管理商品'],
      pageSignature: {
        sections: ['基本資料', '銷售資訊', '物流運費', '商品詳細介紹', '其他'],
        stableLandmarks: ['商品名稱', '平台分類', '銷售規格範本', '甲指(第三方)', '發佈商品']
      },
      fieldOrder: [
        'item-number', 'main-images', 'advertisement-image', 'youtube-id', 'brand', 'product-name',
        'platform-category', 'front-hidden', 'regulatory-certifications', 'category-attributes',
        'other-product-information', 'variant-template', 'variant-names-and-values',
        'variant-images', 'variant-stock-price-sku-barcode', 'package-dimensions-and-weight',
        'temperature', 'delivery-methods', 'free-shipping', 'rich-description', 'promotion-material-bank-image',
        'momo-promotion-consent', 'slogan-and-short-features', 'store-category',
        'warranty', 'publish-time', 'submit'
      ],
      batchSections: [
        { key: 'basic-and-media', fields: ['item-number', 'main-images', 'advertisement-image', 'youtube-id', 'brand', 'product-name'] },
        { key: 'taxonomy-and-attributes', fields: ['platform-category', 'front-hidden', 'regulatory-certifications', 'category-attributes', 'other-product-information'], dynamic: true },
        { key: 'variants-and-commerce', fields: ['variant-template', 'variant-names-and-values', 'variant-images', 'variant-stock-price-sku-barcode'] },
        { key: 'shipping', fields: ['package-dimensions-and-weight', 'temperature', 'delivery-methods', 'free-shipping'] },
        { key: 'content-and-publish', fields: ['rich-description', 'promotion-material-bank-image', 'momo-promotion-consent', 'slogan-and-short-features', 'store-category', 'warranty', 'publish-time', 'submit'] }
      ],
      imageConstraints: {
        main: { aspectRatio: '1:1', minimumFileBytes: 38000, maximumFileBytes: 1000000, minimumCount: 1, maximumCount: 6 },
        promotion: { minimumFileBytes: 38000, maximumFileBytes: 1000000, forbidOverlayTextFrameAndWatermark: true },
        promotionMaterialBankRequired: true,
        promotionMaterialMustSurviveDraftReopen: true
      },
      promotionInsertFlow: {
        target: 'rich-description-editor',
        steps: ['open-rich-description-upload', 'choose-material-bank', 'search-exact-filename', 'select-and-confirm', 'save-draft', 'verify-contenteditable-img-src', 'submit'],
        requiredBeforeFirstSubmit: true,
        mainOrAdvertisementImageIsNotEvidence: true,
        persistedEvidence: 'contenteditable-html-img-src'
      },
      firstSubmissionMediaGate: {
        requiredSlots: ['main-images', 'advertisement-image', 'promotion-material-bank-image'],
        prepareAllBeforePlatformSubmit: true,
        saveAndVerifySameDraftBeforeFirstSubmit: true,
        missingPromotionErrorIsNeverExpectedControlFlow: true,
        deduplicatePromotionAssetBeforeInsert: true
      },
      storeCategoryConstraints: { maximumCount: 5, relevantOnly: true, validateBeforeSave: true },
      fixedFields: ['warranty-days-180', 'publish-immediately', 'third-party-location-000001'],
      dynamicFields: ['mapped-leaf-category', 'category-dependent-attributes', 'regulatory-fields-when-verified', 'platform-validation-errors']
    },
    coupang: {
      ...common, version: 3, routeKey: 'coupang-create-via-image-or-same-draft',
      canonicalEntry: { route: '商品管理/建立商品', purpose: 'new-case-start' },
      verifiedFromLivePage: true,
      inventoryStatus: 'verified-from-live-create-flow-2026-08-22',
      authenticatedLandmarks: ['Coupang Wing', '商品管理'],
      loginProbe: { fields: ['輸入帳號', '輸入密碼'], submitLabel: '登入', interactiveAuthenticationMayBeRequired: true },
      pageSignature: {
        sections: ['圖片與類別', '商品資訊產生', '選項與價格庫存', '配送', '商品介紹與合規', '發布'],
        stableLandmarks: ['以圖片建立', '類別', '品牌', '產生商品資訊', '銷售價格', '庫存', '建立產品']
      },
      fieldOrder: [
        'clean-main-image', 'secondary-completed-images', 'music-leaf-category', 'verified-brand-or-no-brand',
        'generate-product-information', 'variant-color', 'variant-quantity', 'variant-size',
        'sale-price', 'stock', 'seller-sku', 'seller-delivery', 'convenience-store-by-package',
        'preparation-days', 'manual-rich-description', 'tw-general-compliance', 'responsible-seller',
        'origin', 'minor-purchase-and-tax', 'create-product', 'exact-sku-verification'
      ],
      batchSections: [
        { key: 'media-and-taxonomy', fields: ['clean-main-image', 'secondary-completed-images', 'music-leaf-category', 'verified-brand-or-no-brand'], dynamic: true },
        { key: 'generated-information', fields: ['generate-product-information'], dynamic: true },
        { key: 'variants-and-commerce', fields: ['variant-color', 'variant-quantity', 'variant-size', 'sale-price', 'stock', 'seller-sku'] },
        { key: 'shipping', fields: ['seller-delivery', 'convenience-store-by-package', 'preparation-days'] },
        { key: 'content-compliance-and-publish', fields: ['manual-rich-description', 'tw-general-compliance', 'responsible-seller', 'origin', 'minor-purchase-and-tax', 'create-product', 'exact-sku-verification'] }
      ],
      imageConstraints: {
        firstImageRole: 'cleanMain',
        secondaryRoles: ['cleanMain', 'localizedDetail', 'specification', 'variantRepresentative'],
        maximumCount: 7,
        brandedHeroOnlyWhenGalleryAllowsLogoAndText: true
      },
      generatedOptionRecovery: {
        detect: ['readonly-option-field', 'invalid-generated-option-value'],
        action: 'return-to-image-step-and-regenerate-once-on-same-draft',
        maximumAttempts: 1,
        onlyBeforeVariantCommerceOrContentIsFilled: true,
        neverRegenerateAfterLaterSectionsCompleted: true,
        lateFailureAction: 'repair-current-section-on-same-draft',
        preserveCompletedSections: true
      },
      submissionVerification: {
        successButton: '建立產品',
        acceptedStatuses: ['審核中', '上架'],
        exactSkuLookupMaximum: 1,
        underReviewMeansSubmittedNotActive: true
      },
      fixedFields: ['warranty-days-180', 'preparation-days-1', 'tw-general', 'minor-purchase-allowed', 'taxable', 'submit-for-review'],
      dynamicFields: ['mapped-music-leaf-category', 'category-dependent-attributes', 'verified-brand', 'origin', 'package-shipping', 'platform-validation-errors']
    },
    easyStore: {
      ...common, routeKey: 'easystore-product-create-or-same-product',
      canonicalEntry: { route: '商品清單/新增商品', purpose: 'new-case-start' },
      verifiedFromLivePage: true,
      authenticatedLandmarks: ['商品管理', '儲存'],
      pageSignature: {
        sections: ['商品基本資料', '商品圖片', '商品款式', '庫存與價格', '配送尺寸重量', 'SEO', '銷售通路'],
        stableLandmarks: ['商品名稱', '商品描述', '上傳圖片', '商品選項', 'SKU', '商品狀態', '儲存']
      },
      fieldOrder: [
        'product-name', 'rich-description', 'gallery-images', 'variant-option-names-and-values',
        'variant-stock-sku-price-cost-barcode', 'variant-dimensions-and-weight',
        'tax-and-free-shipping', 'inventory-tracking', 'seo-url-and-meta-description',
        'publish-state', 'sales-channels', 'category-brand-vendor-tags-notes', 'save'
      ],
      batchSections: [
        { key: 'core-and-media', fields: ['product-name', 'rich-description', 'gallery-images'] },
        { key: 'variants-and-inventory', fields: ['variant-option-names-and-values', 'variant-stock-sku-price-cost-barcode'] },
        { key: 'commerce-and-shipping', fields: ['variant-dimensions-and-weight', 'tax-and-free-shipping', 'inventory-tracking'] },
        { key: 'metadata-and-publish', fields: ['seo-url-and-meta-description', 'publish-state', 'sales-channels', 'category-brand-vendor-tags-notes', 'save'], dynamic: true }
      ],
      fixedFields: ['publish-immediately'],
      dynamicFields: ['mapped-category', 'platform-validation-errors']
    },
    shopee: {
      ...common, routeKey: 'easystore-shopee-channel-sync',
      canonicalEntry: { route: 'EasyStore 官方蝦皮通路商品清單', purpose: 'new-case-start' },
      verifiedFromLivePage: true,
      authenticatedLandmarks: ['Shopee Taiwan', '已連接', '商品'],
      pageSignature: {
        sections: ['EasyStore 商品', '進階商品描述', '蝦皮分類與屬性', '價格與庫存', '圖片與細項', '物流', '發布'],
        stableLandmarks: ['進階商品描述', '使用 EasyStore 的產品描述', '價格調整', '蝦皮分類', '浮水印標題', '狀態']
      },
      fieldOrder: [
        'channel-product', 'advanced-description-capability-probe', 'enable-advanced-description',
        'use-easystore-rich-description', 'shopee-category', 'category-attributes', 'price-adjustment',
        'variant-images', 'prepared-package-weight', 'prepared-logistics', 'prepare-publish', 'publish'
      ],
      batchSections: [
        { key: 'prepared-rich-description', fields: ['advanced-description-capability-probe', 'enable-advanced-description', 'use-easystore-rich-description'], dynamic: true },
        { key: 'taxonomy-and-attributes', fields: ['channel-product', 'shopee-category', 'category-attributes'], dynamic: true },
        { key: 'commerce-and-variants', fields: ['price-adjustment', 'variant-images'] },
        { key: 'shipping', fields: ['prepared-package-weight', 'prepared-logistics'], dynamic: true },
        { key: 'publish', fields: ['prepare-publish', 'publish'] }
      ],
      fixedFields: ['warranty-days-180', 'publish-immediately', 'close-embedded-chat', 'use-prepared-easystore-rich-description-when-supported'],
      dynamicFields: ['advanced-description-account-capability', 'mapped-leaf-category', 'category-dependent-attributes', 'prepared-size-tier', 'platform-validation-errors']
    }
  };
}

function buildPreparedPlatformFieldPlan(snapshot) {
  const shipping = buildShopeeLogistics(snapshot);
  const coupangShipping = buildCoupangShipping(snapshot);
  const packageWeightKg = numberOrNull(snapshot.packageWeightKg);
  const packageWeightGrams = packageWeightKg !== null && packageWeightKg > 0
    ? Math.max(1, Math.round(packageWeightKg * 1000)) : null;
  const variantGroup = snapshot.variantGroupEnabled ? {
    enabled: true,
    attributeName: clean(snapshot.variantGroupAttributeName),
    items: (Array.isArray(snapshot.variantGroupVariants) ? snapshot.variantGroupVariants : []).map((row) => ({
      productId: clean(row && row.productId),
      sku: normalizeSku(row && row.sku),
      name: clean(row && row.name),
      value: clean(row && row.attributeValue),
      imageUrl: safeHttpUrl(row && row.imageUrl),
      barcode: clean(row && row.barcode),
      stock: Math.max(0, Math.round(numberOrNull(row && row.stock) || 0)),
      easyStorePrice: numberOrNull(row && row.easyStorePrice),
      momoPrice: numberOrNull(row && row.momoPrice),
      coupangPrice: numberOrNull(row && row.coupangPrice)
    }))
  } : { enabled: false, attributeName: '', items: [] };
  const common = {
    sku: snapshot.sku,
    title: snapshot.title,
    description: snapshot.description,
    descriptionContentStatus: { ...(snapshot.descriptionContentStatus || {}) },
    stock: snapshot.stock,
    warrantyDays: 180,
    publishImmediately: true,
    variantGroup,
    package: {
      lengthCm: snapshot.packageLengthCm,
      widthCm: snapshot.packageWidthCm,
      heightCm: snapshot.packageHeightCm,
      weightKg: snapshot.packageWeightKg,
      shippingDecision: snapshot.shippingDecision
    }
  };
  const momoMainImageUrl = safeHttpUrl(snapshot.platformImagePlan
    && snapshot.platformImagePlan.momo && snapshot.platformImagePlan.momo.imageUrls
    && snapshot.platformImagePlan.momo.imageUrls[0]);
  const momoPromotionImageUrl = safeHttpUrl(snapshot.momoSpecialPromotionImageUrl);
  const momoPromotionFingerprint = momoPromotionImageUrl
    ? crypto.createHash('sha256').update(momoPromotionImageUrl).digest('hex').slice(0, 12) : '';
  const momoPromotionAssetFilename = momoPromotionFingerprint
    ? `${normalizeSku(snapshot.sku) || 'product'}-momo-promo-${momoPromotionFingerprint}.jpg` : '';
  const momoMediaReadyBeforeFirstSubmit = Boolean(momoMainImageUrl && momoPromotionImageUrl);
  return {
    version: 12,
    immutableForJob: true,
    preparedBeforePlatformNavigation: true,
    platformOrder: [...PLATFORM_EXECUTION_ORDER],
    executionGraph: {
      mode: 'staggered-parallel',
      parallelRoots: [...PARALLEL_ROOT_PLATFORMS],
      dependencies: { momo: [], coupang: [], easyStore: [], shopee: ['easyStore'] },
      shopeeStartsImmediatelyAfterEasyStoreVerified: true,
      shopeeDoesNotWaitForMomoOrCoupang: true,
      completionRequires: [...PLATFORM_EXECUTION_ORDER]
    },
    browserScheduler: {
      interactionConcurrency: 1,
      releaseInteractionLockDuringWait: true,
      sessionHeartbeatSeconds: 180,
      keepAuthenticatedAnchorTabPerPlatform: true
    },
    sharedImageAssetStandard: { ...(snapshot.imagePolicy && snapshot.imagePolicy.sharedDeliveryAssetStandard || {}) },
    storefrontPortraitAssetStandard: { ...(snapshot.imagePolicy && snapshot.imagePolicy.storefrontPortraitAssetStandard || {}) },
    sourceImageNormalization: { ...(snapshot.imagePolicy && snapshot.imagePolicy.sourceNormalization || {}) },
    decisionContractVersion: Number(snapshot.decisionContract && snapshot.decisionContract.version) || 0,
    canonicalCategoryDecision: { ...(snapshot.canonicalCategoryDecision || {}) },
    canonicalShippingDecision: { ...shipping },
    platformPageContracts: buildPlatformPageContracts(),
    batchFieldExecution: {
      mode: 'section-batch',
      resolveFieldsOncePerSection: true,
      stableNativeControlsSinglePass: true,
      dynamicControlsSequentialWithinSection: true,
      validateStableSectionAfterBatch: false,
      validateDynamicSectionOnceAfterBatch: true,
      imagesSingleBatchPerPlatform: true,
      unchangedSectionsNeverRescanned: true
    },
    common,
    momo: {
      fixedFields: {
        publishImmediately: true,
        warrantyDays: 180,
        deliveryMethod: MOMO_THIRD_PARTY_DELIVERY.method,
        thirdPartyLocationCode: MOMO_THIRD_PARTY_DELIVERY.locationCode,
        carrier: MOMO_THIRD_PARTY_DELIVERY.carrier,
        promotionImageRequiredBeforeFirstSubmit: true,
        promotionImageInsertionTarget: 'rich-description-editor',
        promotionImagePersistenceEvidence: 'contenteditable-html-img-src',
        advertisementImageRequiredBeforeFirstSubmit: true,
        firstSubmitBlockedUntilAllMediaSlotsReady: true,
        storeCategoryMaximumCount: 5
      },
      preparedFields: {
        sku: snapshot.sku,
        title: snapshot.momoGoodsName,
        slogan: snapshot.momoSlogan,
        descriptionHtml: snapshot.momoHtml,
        descriptionDelivery: { ...(snapshot.platformDescriptionContentPlan && snapshot.platformDescriptionContentPlan.momo || {}) },
        price: snapshot.momoPrice,
        stock: snapshot.stock,
        categoryCode: snapshot.momoCategoryCode,
        imageUrls: snapshot.platformImagePlan.momo.imageUrls,
        advertisementImageUrl: momoMainImageUrl,
        promotionImageUrl: momoPromotionImageUrl,
        promotionImageReady: Boolean(momoPromotionImageUrl),
        firstSubmitMediaGate: {
          ready: momoMediaReadyBeforeFirstSubmit,
          requiredSlots: ['main-images', 'advertisement-image', 'rich-description-promotion-image'],
          mainImageUrls: snapshot.platformImagePlan.momo.imageUrls,
          advertisementImageUrl: momoMainImageUrl,
          promotionImage: {
            url: momoPromotionImageUrl,
            assetFilename: momoPromotionAssetFilename,
            assetFingerprint: momoPromotionFingerprint,
            uploadTarget: 'material-bank',
            insertTarget: 'rich-description-editor',
            insertBeforeFirstSubmit: true,
            saveSameDraftBeforeSubmit: true,
            verifyPersistedOnceBeforeSubmit: true,
            neverWaitForPlatformMissingPromotionError: true,
            deduplicateBeforeInsert: true
          }
        },
        storeCategoryPolicy: { maximumCount: 5, relevantOnly: true },
        variantGroup: variantGroup.enabled ? {
          attributeName: variantGroup.attributeName,
          items: variantGroup.items.map((row) => ({ ...row, price: row.momoPrice }))
        } : null
      },
      dynamicOnly: ['official-category-recommendation-when-code-is-empty', 'category-dependent-attributes', 'platform-validation-errors']
    },
    coupang: {
      fixedFields: {
        publishImmediately: true,
        submitAction: 'create-product',
        warrantyDays: 180,
        preparationDays: 1,
        complianceModel: 'TW_General',
        responsibleSeller: '尚品樂器行',
        minorPurchaseAllowed: true,
        taxable: true
      },
      preparedFields: {
        sku: snapshot.sku,
        title: snapshot.coupangTitle,
        descriptionHtml: snapshot.coupangDescriptionHtml,
        descriptionDelivery: { ...(snapshot.platformDescriptionContentPlan && snapshot.platformDescriptionContentPlan.coupang || {}) },
        price: snapshot.coupangPrice,
        stock: snapshot.stock,
        categoryCode: snapshot.coupangCategoryCode,
        categoryResolution: { ...(snapshot.canonicalCategoryDecision || {}) },
        brand: {
          value: snapshot.brand,
          mode: snapshot.brand ? 'verified-brand' : 'no-brand',
          useNoBrandOnlyWhenUnbrandedOrVerifiedBrandRejected: true,
          recordPlatformRejectionBeforeFallback: true
        },
        model: snapshot.model,
        variantDefaults: {
          optionLabel: snapshot.variantAttributeValue || snapshot.color || snapshot.model || '單一規格',
          color: snapshot.color,
          quantity: 1,
          sizePolicy: 'verified-value-else-Free-only-when-required',
          sellerSku: snapshot.sku,
          price: snapshot.coupangPrice,
          stock: snapshot.stock
        },
        shipping: coupangShipping,
        imageUrls: snapshot.platformImagePlan.coupang.imageUrls,
        variantGroup: variantGroup.enabled ? {
          attributeName: variantGroup.attributeName,
          items: variantGroup.items.map((row) => ({ ...row, price: row.coupangPrice }))
        } : null
      },
      interactionPolicy: {
        generateProductInformationMaximumAttempts: 2,
        regenerateOnlyWhenOptionFieldsAreReadonlyOrInvalid: true,
        regenerateOnlyBeforeVariantCommerceOrContentIsFilled: true,
        neverRegenerateAfterLaterSectionsCompleted: true,
        lateFailureAction: 'repair-current-section-on-same-draft',
        preserveCompletedSections: true,
        resumeSameDraft: true,
        exactSkuVerificationMaximum: 1,
        neverSearchByTitle: true
      },
      dynamicOnly: ['official-category-recommendation-when-code-is-empty', 'category-dependent-attributes', 'verified-origin', 'platform-validation-errors']
    },
    easyStore: {
      fixedFields: { publishImmediately: true, inventoryManagement: 'easystore', shippingRequired: true },
      preparedFields: {
        sku: snapshot.sku,
        title: snapshot.title,
        descriptionHtml: snapshot.bodyHtml,
        descriptionDelivery: { ...(snapshot.platformDescriptionContentPlan && snapshot.platformDescriptionContentPlan.easyStore || {}) },
        price: snapshot.easyStorePrice,
        stock: snapshot.stock,
        imageUrls: snapshot.platformImagePlan.easyStore.imageUrls,
        variantGroup: variantGroup.enabled ? {
          attributeName: variantGroup.attributeName,
          items: variantGroup.items.map((row) => ({ ...row, price: row.easyStorePrice }))
        } : null
      },
      dynamicOnly: ['api-validation-errors']
    },
    shopee: {
      fixedFields: {
        workspace: 'easystore-shopee-channel-sync',
        publishImmediately: true,
        warrantyDays: 180,
        neverOpenDirectSellerEditor: true,
        startImmediatelyAfterEasyStoreVerified: true,
        doNotWaitForMomoOrCoupang: true,
        closeEmbeddedChatBeforeFormInteraction: true,
        variantImageSource: 'existing-easystore-completed-gallery',
        neverOpenNativeFilePickerForVariantImages: true,
        completeVariantImagesBeforePreparePublish: true,
        advancedDescription: {
          mode: 'use-easystore-rich-description',
          preparedBeforeNavigation: true,
          enableWhenAvailable: true,
          useEasyStoreDescription: true,
          capabilityProbeMaximum: 1,
          requireTextAndEveryPreparedImageBeforePublish: true,
          insertMissingPreparedImagesIntoSameEditor: true,
          buttonClickAloneIsNeverSuccess: true,
          neverAnalyzeOrRewriteInsideShopee: true
        }
      },
      preparedFields: {
        sku: snapshot.sku,
        title: snapshot.shopeeTitle,
        description: snapshot.shopeeDescription,
        advancedDescription: { ...(snapshot.shopeeAdvancedDescription || {}) },
        descriptionDelivery: { ...(snapshot.platformDescriptionContentPlan && snapshot.platformDescriptionContentPlan.shopee || {}) },
        price: snapshot.easyStorePrice,
        stock: snapshot.stock,
        categoryPath: snapshot.shopeeCategoryPath,
        attributes: snapshot.shopeeAttributeValues,
        packageWeightGrams,
        logistics: shipping,
        imageUrls: snapshot.platformImagePlan.shopee.imageUrls,
        variantGroup: variantGroup.enabled ? {
          attributeName: variantGroup.attributeName,
          items: variantGroup.items.map((row) => ({ ...row, price: row.easyStorePrice }))
        } : null
      },
      dynamicOnly: ['advanced-description-account-capability', 'category-dependent-attributes', 'platform-validation-errors']
    }
  };
}

function variantGroupContextEntry(context, productId) {
  if (!context) return {};
  if (context instanceof Map) return context.get(clean(productId)) || {};
  return context[clean(productId)] || {};
}

function variantPriceForPlatform(product, listingCase, platformKey) {
  const source = product && typeof product === 'object' ? product : {};
  const prepared = listingCase && typeof listingCase === 'object' ? listingCase : {};
  const casePrice = prepared.priceSnapshot && typeof prepared.priceSnapshot === 'object'
    ? numberOrNull(prepared.priceSnapshot[platformKey]) : null;
  const directField = platformKey === 'easyStore' ? 'easyStorePrice' : `${platformKey}Price`;
  const direct = numberOrNull(source[directField]);
  return direct ?? casePrice
    ?? numberOrNull(source.sharedOnlinePrice)
    ?? numberOrNull(source.onlinePrice)
    ?? numberOrNull(source.storePrice);
}

function buildVariantGroupRows(productId, product, listingCase, finalizedMediaSnapshot, variantGroupContext) {
  if (!(clean(listingCase && listingCase.listingMode) !== 'add-variant'
    && listingCase && listingCase.variantGroupEnabled === true)) return [];
  const mediaCases = new Map((Array.isArray(finalizedMediaSnapshot && finalizedMediaSnapshot.cases)
    ? finalizedMediaSnapshot.cases : []).map((row) => [clean(row && row.productId), row || {}]));
  const configuredItems = Array.isArray(listingCase.variantGroupItems) ? listingCase.variantGroupItems : [];
  const definitions = [{
    productId: clean(productId),
    attributeValue: clean(listingCase.variantGroupPrimaryValue),
    sourceImageUrl: safeHttpUrl(listingCase.variantGroupPrimaryImageUrl),
    root: true
  }].concat(configuredItems.map((item) => ({
    productId: clean(item && item.productId),
    attributeValue: clean(item && item.attributeValue),
    sourceImageUrl: safeHttpUrl(item && Array.isArray(item.imageUrls) && item.imageUrls[0]),
    root: false
  })));
  const seenIds = new Set();
  const seenSkus = new Set();
  const seenValues = new Set();
  return definitions.map((definition) => {
    if (!definition.productId || seenIds.has(definition.productId)) throw new Error('同款多細項案件含有空白或重複的商品 ID。');
    seenIds.add(definition.productId);
    const contextEntry = definition.root
      ? { product, listingCase }
      : variantGroupContextEntry(variantGroupContext, definition.productId);
    const variantProduct = contextEntry.product && typeof contextEntry.product === 'object' ? contextEntry.product : {};
    const variantCase = contextEntry.listingCase && typeof contextEntry.listingCase === 'object' ? contextEntry.listingCase : {};
    const media = mediaCases.get(definition.productId) || {};
    const sourceImageUrl = safeHttpUrl(media.representativeSourceImageUrl) || definition.sourceImageUrl;
    const imageUrl = safeHttpUrl(media.representativeCompletedImageUrl);
    const sku = normalizeSku(variantProduct.internalSku || variantProduct.sku || variantCase.productSku || (definition.root && listingCase.productSku));
    const attributeValue = definition.attributeValue || clean(variantCase.variantAttributeValue);
    const skuKey = sku.toLowerCase();
    const valueKey = attributeValue.toLowerCase();
    if (!sku || seenSkus.has(skuKey)) throw new Error('同款多細項案件含有空白或重複的 SKU。');
    if (!attributeValue || seenValues.has(valueKey)) throw new Error('同款多細項案件含有空白或重複的細項名稱。');
    seenSkus.add(skuKey);
    seenValues.add(valueKey);
    return {
      productId: definition.productId,
      sku,
      name: clean(variantProduct.internalName || variantProduct.originalName || variantProduct.name || variantCase.productName),
      attributeValue,
      sourceImageUrl,
      imageUrl,
      barcode: clean(variantProduct.barcode || variantCase.barcode),
      stock: Math.max(0, Math.round(numberOrNull(variantProduct.currentStock) ?? numberOrNull(variantCase.stockSnapshot) ?? 0)),
      costPrice: numberOrNull(variantProduct.latestPurchaseCost || variantProduct.averageCost),
      storePrice: numberOrNull(variantProduct.storePrice || variantProduct.originalSalePrice),
      easyStorePrice: variantPriceForPlatform(variantProduct, variantCase, 'easyStore'),
      momoPrice: variantPriceForPlatform(variantProduct, variantCase, 'momo'),
      coupangPrice: variantPriceForPlatform(variantProduct, variantCase, 'coupang')
    };
  });
}

function buildListingSnapshot(productId, product, listingCase, variantParentProduct = null, variantParentListingCase = null, finalizedMediaSnapshot = null, variantGroupContext = null) {
  const listingMode = clean(listingCase.listingMode) === 'add-variant' ? 'add-variant' : 'independent';
  const parentProduct = variantParentProduct && typeof variantParentProduct === 'object' ? variantParentProduct : {};
  const parentPlatformMappings = parentProduct.platformMappings && typeof parentProduct.platformMappings === 'object'
    ? parentProduct.platformMappings : {};
  const parentPlatformListingStatus = parentProduct.platformListingStatus && typeof parentProduct.platformListingStatus === 'object'
    ? parentProduct.platformListingStatus : {};
  const listingIdentityProduct = listingMode === 'add-variant' ? { platformMappings: parentPlatformMappings, platformListingStatus: parentPlatformListingStatus } : product;
  const shopeeExistingListingIds = platformListingIds(listingIdentityProduct, 'shopee');
  const description = listingDescription(listingCase);
  const descriptionContentStatus = listingDescriptionContentStatus(listingCase);
  const variantGroupEnabled = listingMode === 'independent' && listingCase.variantGroupEnabled === true;
  const variantParentSourceImageUrl = listingMode === 'add-variant' ? safeHttpUrl(listingCase.variantParentImageUrl) : '';
  const variantChildSourceImageUrl = listingMode === 'add-variant' ? safeHttpUrl(listingCase.variantChildImageUrl) : '';
  const variantGroupPrimarySourceImageUrl = variantGroupEnabled ? safeHttpUrl(listingCase.variantGroupPrimaryImageUrl) : '';
  const variantParentImageUrl = listingMode === 'add-variant'
    ? localizedRepresentativeImage(variantParentListingCase, variantParentSourceImageUrl) : '';
  const variantChildImageUrl = listingMode === 'add-variant'
    ? localizedRepresentativeImage(listingCase, variantChildSourceImageUrl) : '';
  let variantGroupPrimaryImageUrl = variantGroupEnabled
    ? localizedRepresentativeImage(listingCase, variantGroupPrimarySourceImageUrl) : '';
  const variantGroupVariants = buildVariantGroupRows(
    productId, product, listingCase, finalizedMediaSnapshot, variantGroupContext
  );
  if (variantGroupEnabled && variantGroupVariants.length) {
    variantGroupPrimaryImageUrl = safeHttpUrl(variantGroupVariants[0].imageUrl);
  }
  const platformImagePlan = preparedPlatformImagePlan(listingCase, finalizedMediaSnapshot);
  const easyStoreImageSource = platformImagePlan.easyStore.ready
    ? platformImagePlan.easyStore.imageUrls
    : prioritizedListingImageUrls(listingCase);
  const imageAllocation = listingImageAllocation(easyStoreImageSource);
  const images = imageAllocation.galleryImages;
  const momoSpecialPromotionImageUrl = platformImagePlan.momo.promotionImageReady
    ? platformImagePlan.momo.promotionImageUrl : '';
  const descriptionHtml = appendShopDescriptionImages(productDescriptionToSafeHtml(description), imageAllocation.descriptionImages);
  const snapshot = {
    productId: clean(productId),
    listingMode,
    variantParentProductId: listingMode === 'add-variant' ? clean(listingCase.variantParentProductId) : '',
    variantParentSku: listingMode === 'add-variant' ? normalizeSku(parentProduct.internalSku || parentProduct.sku || listingCase.variantParentSku) : '',
    variantParentName: listingMode === 'add-variant' ? clean(parentProduct.internalName || parentProduct.originalName || parentProduct.name || listingCase.variantParentName) : '',
    variantAttributeName: listingMode === 'add-variant' ? clean(listingCase.variantAttributeName) : '',
    variantParentAttributeValue: listingMode === 'add-variant' ? clean(listingCase.variantParentAttributeValue) : '',
    variantAttributeValue: listingMode === 'add-variant' ? clean(listingCase.variantAttributeValue) : '',
    variantParentSourceImageUrl,
    variantChildSourceImageUrl,
    variantParentImageUrl,
    variantChildImageUrl,
    variantGroupEnabled,
    variantGroupAttributeName: variantGroupEnabled ? clean(listingCase.variantGroupAttributeName) : '',
    variantGroupVariants,
    variantGroupPrimarySourceImageUrl,
    variantGroupPrimaryImageUrl,
    variantParentPlatformMappings: listingMode === 'add-variant' ? parentPlatformMappings : {},
    variantParentPlatformListingStatus: listingMode === 'add-variant' ? parentPlatformListingStatus : {},
    variantParentEasyStoreProductId: listingMode === 'add-variant' ? clean(platformListingIds(listingIdentityProduct, 'easyStore')[0]) : '',
    sku: normalizeSku(product.internalSku || product.sku || listingCase.productSku),
    title: listingName(product, listingCase).slice(0, 255),
    description,
    descriptionContentStatus,
    bodyHtml: descriptionHtml,
    images,
    productImageUrls: imageAllocation.productImages,
    descriptionImageUrls: imageAllocation.descriptionImages,
    platformImagePlan,
    brand: clean(listingCase.brand || product.brand),
    model: clean(listingCase.model || product.model),
    barcode: clean(listingCase.barcode || product.barcode),
    stock: Math.max(0, Math.round(numberOrNull(product.currentStock) || 0)),
    costPrice: numberOrNull(product.latestPurchaseCost || product.averageCost),
    storePrice: numberOrNull(product.storePrice || product.originalSalePrice),
    easyStorePrice: numberOrNull(product.easyStorePrice != null ? product.easyStorePrice : listingCase.priceSnapshot && listingCase.priceSnapshot.easyStore) ?? numberOrNull(product.sharedOnlinePrice != null ? product.sharedOnlinePrice : product.onlinePrice != null ? product.onlinePrice : product.storePrice),
    momoPrice: numberOrNull(product.momoPrice != null ? product.momoPrice : listingCase.priceSnapshot && listingCase.priceSnapshot.momo) ?? numberOrNull(product.sharedOnlinePrice != null ? product.sharedOnlinePrice : product.onlinePrice != null ? product.onlinePrice : product.storePrice),
    coupangPrice: numberOrNull(product.coupangPrice != null ? product.coupangPrice : listingCase.priceSnapshot && listingCase.priceSnapshot.coupang) ?? numberOrNull(product.sharedOnlinePrice != null ? product.sharedOnlinePrice : product.onlinePrice != null ? product.onlinePrice : product.storePrice),
    packageLengthCm: numberOrNull(listingCase.packageLengthCm),
    packageWidthCm: numberOrNull(listingCase.packageWidthCm),
    packageHeightCm: numberOrNull(listingCase.packageHeightCm),
    packageWeightKg: numberOrNull(listingCase.packageWeightKg),
    shippingDecision: clean(listingCase.shippingDecision),
    automationPolicy: listingAutomationPolicy(),
    contentPolicy: {
      titleOrder: ['brand', 'model', 'product-type', 'important-spec-or-material'],
      requireVerifiedBrandAndModelWhenAvailable: true,
      appendStoreNameWhenSpaceAllows: '柚子樂器',
      sharedTitleUsesCommonFactsOnly: true,
      variantDifferencesBelongInOptionNames: true,
      featureTarget: 10,
      usageTarget: 10,
      neverInventToReachTarget: true,
      requiredSections: ['商品特色', '使用方式／適用情境', '商品規格'],
      genericFallbackIsIncomplete: true,
      requireStructuredVerifiedDescriptionBeforePreparedSnapshot: true,
      descriptionContentStatus,
      includeVerifiedSpecifications: true,
      warrantyInDedicatedPlatformFieldOnly: true,
      warrantyInDescription: false,
      locale: 'zh-TW',
      richDescriptionPlatforms: ['easyStore', 'shopee-when-account-supported', 'momo', 'coupang'],
      interleaveCompletedImagesWhenSupported: true,
      physicalProductDisclaimer: PHYSICAL_PRODUCT_DISCLAIMER
    },
    momoDelivery: MOMO_THIRD_PARTY_DELIVERY,
    momoSpecialPromotionImageUrl,
    momoSpecialPromotionImagePolicy: {
      required: true,
      source: 'localized-completed-product-image',
      preferredProductImagePositions: [2, 3],
      excludedContent: ['store-address', 'store-promo', 'service-promo', 'qr-code', 'contact-information'],
      insertMethod: 'material-bank-selection',
      verification: 'save-reopen-confirm-image-before-publish'
    },
    momoCatalogPolicy: {
      maximumListings: 1000,
      targetListings: 1000,
      reservedSlots: 0,
      zeroStockAction: 'keep-published-by-default',
      preserveSoldOutWithSales: true,
      requireSalesHistoryBeforeUnpublish: true,
      violationRecovery: 'republish-when-data-is-valid-and-capacity-allows'
    },
    regulatoryPolicy: { ncc: 'fill-only-when-verified', neverFabricateCertification: true },
    imagePolicy: {
      sourceImageMaximum: 20, sharedVariantGalleryMaximum: 12, balanceAcrossVariants: true,
      sourceNormalization: {
        preferredLongEdgeRangePx: { minimum: 1600, maximum: 2000 },
        targetLongEdgePx: 1800,
        downscaleWhenAbovePx: 2400,
        neverUpscale: true,
        analyzeNormalizedCopyAndRetainSourceLineage: true
      },
      galleryMaximum: 7, galleryProductMaximum: 6, overflowToDescription: true,
      mainImageTemplate: 'youzi-light-commercial-template-v3', mainImageAspectRatio: 'channel-specific',
      mainImageBackdrop: 'low-saturation-light-commercial', mainImageProductPlacement: 'right-or-center-right',
      outputProfiles: {
        storefrontPortrait: {
          role: 'storefrontPortrait', widthPx: 750, heightPx: 1000, aspectRatio: '3:4',
          firstImageFor: ['easyStore'], commercialInformationDensity: 'rich-but-readable',
          verifiedFeatureCount: { minimum: 3, maximum: 5 }, verifiedDetailInsetMaximum: 2,
          preserveGreenOuterEdge: true, removeMascot: true, removePicCollage: true,
          brandHeaderGeometryLockedToOriginalTemplate: true,
          preserveOriginalBrandHeaderHeightWidthLogoAndSloganPlacement: true,
          neverCompressStretchOrReflowBrandHeader: true,
          brandHeaderCompositionMode: 'deterministic-master-overlay',
          brandHeaderMasterAsset: 'product-listing-main-template.jpg',
          brandHeaderModelRenderingForbidden: true,
          exactBrandHeaderPixelCopyRequired: true
        },
        brandedHero: {
          role: 'brandedHero', widthPx: 1000, heightPx: 1000, aspectRatio: '1:1',
          firstImageFor: ['shopee'], verifiedFeatureCount: { minimum: 1, maximum: 3 },
          brandHeaderGeometryLockedToOriginalTemplate: true,
          preserveOriginalBrandHeaderHeightWidthLogoAndSloganPlacement: true,
          neverCompressStretchOrReflowBrandHeader: true,
          brandHeaderCompositionMode: 'deterministic-master-overlay',
          brandHeaderMasterAsset: 'product-listing-main-template.jpg',
          brandHeaderModelRenderingForbidden: true,
          exactBrandHeaderPixelCopyRequired: true
        },
        cleanMain: {
          role: 'cleanMain', widthPx: 1000, heightPx: 1000, aspectRatio: '1:1',
          firstImageFor: ['momo', 'coupang'], textForbidden: true, logoForbidden: true
        }
      },
      fixedStorePromoLast: true, fixedDescriptionPromosLast: true,
      localizedTraditionalChinese: true, localizedVariantRepresentativesRequired: true,
      sharedDeliveryAssetStandard: {
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
      },
      storefrontPortraitAssetStandard: {
        role: 'storefrontPortrait', widthPx: 750, heightPx: 1000, aspectRatio: '3:4',
        colorSpace: 'sRGB', preferredFormat: 'image/jpeg', maximumFileBytes: 1000000,
        normalizeOnceBeforePlatformNavigation: true, preserveGreenOuterEdge: true,
        brandHeaderGeometryLockedToOriginalTemplate: true,
        preserveOriginalBrandHeaderHeightWidthLogoAndSloganPlacement: true,
        brandHeaderCompositionMode: 'deterministic-master-overlay',
        brandHeaderMasterAsset: 'product-listing-main-template.jpg',
        brandHeaderModelRenderingForbidden: true,
        exactBrandHeaderPixelCopyRequired: true
      }
    },
    shopeeTitle: clean(listingCase.shopeeTitle) || listingName(product, listingCase),
    shopeeDescription: (() => { const value = clean(listingCase.shopeeDescription) || description; return value.includes(PHYSICAL_PRODUCT_DISCLAIMER) ? value : `${value}\n\n${PHYSICAL_PRODUCT_DISCLAIMER}`; })(),
    shopeeRequiredNotes: clean(listingCase.shopeeRequiredNotes),
    shopeeExistingListingIds,
    shopeeCategoryPath: clean(listingCase.shopeeCategoryPath),
    shopeeBrand: clean(listingCase.shopeeBrand) || clean(listingCase.brand || product.brand),
    shopeeAttributeValues: normalizeShopeeAttributes(listingCase.shopeeAttributeValues),
    identityStatus: clean(listingCase.identityStatus),
    identityManualConfirmed: listingCase.identityManualConfirmed === true,
    identityManualConfirmedAt: listingCase.identityManualConfirmedAt || null,
    identityManualConfirmedBy: clean(listingCase.identityManualConfirmedBy),
    identityManualConfirmationNote: clean(listingCase.identityManualConfirmationNote),
    color: clean(listingCase.color || product.color),
    momoGoodsName: clean(listingCase.momoGoodsName) || listingName(product, listingCase),
    momoSlogan: clean(listingCase.momoSlogan),
    momoHtml: appendShopDescriptionImages(appendPhysicalProductDisclaimerHtml(clean(listingCase.momoHtml) || productDescriptionToSafeHtml(description)), imageAllocation.descriptionImages),
    momoCategoryCode: clean(listingCase.momoCategoryCode),
    coupangTitle: clean(listingCase.coupangTitle) || listingName(product, listingCase),
    coupangDescriptionHtml: appendShopDescriptionImages(appendPhysicalProductDisclaimerHtml(clean(listingCase.coupangDescriptionHtml) || productDescriptionToSafeHtml(description)), imageAllocation.descriptionImages),
    coupangCategoryCode: clean(listingCase.coupangCategoryCode),
    enabledEasyStoreShopee: true,
    enabledMomo: true,
    enabledCoupang: true
  };
  snapshot.shopeeAdvancedDescription = shopeeAdvancedDescriptionPlan(snapshot);
  snapshot.platformDescriptionContentPlan = platformDescriptionContentPlan(snapshot);
  snapshot.category = clean(listingCase.category || product.category);
  snapshot.shopeeCategoryPath = shopeeTaxonomy.formatCategoryPath(snapshot.shopeeCategoryPath, snapshot);
  snapshot.shopeeAttributeValues = applyShopeeAttributeTemplate(
    snapshot.shopeeAttributeValues,
    snapshot,
    snapshot.shopeeCategoryPath
  );
  snapshot.canonicalCategoryDecision = buildCanonicalCategoryDecision(snapshot);
  snapshot.decisionContract = buildListingDecisionContract(snapshot);
  snapshot.preparedPlatformFieldPlan = buildPreparedPlatformFieldPlan(snapshot);
  return snapshot;
}

function compactObject(value) {
  if (Array.isArray(value)) return value.map(compactObject);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  Object.keys(value).sort().forEach((key) => {
    const item = value[key];
    if (item === undefined) return;
    result[key] = compactObject(item);
  });
  return result;
}

function buildEasyStoreProductBody(snapshot, includeVariant = true) {
  const product = {
    title: snapshot.title,
    description: snapshot.description,
    body_html: snapshot.bodyHtml,
    inventory_management: 'easystore',
    taxable: true,
    shipping_required: true,
    published_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    images: snapshot.images.map((url) => ({ url }))
  };
  if (includeVariant) {
    const grouped = snapshot.variantGroupEnabled === true
      ? (Array.isArray(snapshot.variantGroupVariants) ? snapshot.variantGroupVariants : [])
      : [];
    const rows = grouped.length ? grouped : [{
      sku: snapshot.sku, barcode: snapshot.barcode, easyStorePrice: snapshot.easyStorePrice,
      stock: snapshot.stock, storePrice: snapshot.storePrice, costPrice: snapshot.costPrice,
      attributeValue: ''
    }];
    product.variants = rows.map((row) => {
      const variant = {
      sku: normalizeSku(row && row.sku),
      barcode: clean(row && row.barcode) || null,
      price: numberOrNull(row && row.easyStorePrice),
      inventory_quantity: Math.max(0, Math.round(numberOrNull(row && row.stock) || 0)),
      width: snapshot.packageWidthCm,
      height: snapshot.packageHeightCm,
      length: snapshot.packageLengthCm,
      weight: snapshot.packageWeightKg,
      weight_unit: 'kg',
      inventory_policy: false,
      taxable: true,
      is_enabled: true
      };
      const attributeValue = clean(row && row.attributeValue);
      if (attributeValue) {
        variant.name = attributeValue;
        variant.option1 = attributeValue;
      }
      const storePrice = numberOrNull(row && row.storePrice);
      const salePrice = numberOrNull(row && row.easyStorePrice);
      const costPrice = numberOrNull(row && row.costPrice);
      if (storePrice != null && salePrice != null && storePrice > salePrice) variant.compare_at_price = storePrice;
      if (costPrice != null) variant.cost_price = costPrice;
      return variant;
    });
  }
  return compactObject({ product });
}

function extractProducts(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['products', 'data', 'items', 'results']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.data && typeof payload.data === 'object') {
    for (const key of ['products', 'items', 'results']) {
      if (Array.isArray(payload.data[key])) return payload.data[key];
    }
    if (payload.data.product && typeof payload.data.product === 'object') return [payload.data.product];
  }
  if (payload.product && typeof payload.product === 'object') return [payload.product];
  return [];
}

function productVariants(product) {
  if (!product || typeof product !== 'object') return [];
  for (const key of ['variants', 'product_variants', 'productVariants', 'items']) {
    if (Array.isArray(product[key])) return product[key];
  }
  if (product.sku || product.code || product.product_code) return [product];
  return [];
}

function productIdOf(product) {
  return clean(product && (product.id || product.product_id || product.productId));
}

function variantIdOf(variant) {
  return clean(variant && (variant.id || variant.variant_id || variant.variantId));
}

function platformListingIds(product, platform) {
  const mappings = product && product.platformMappings && typeof product.platformMappings === 'object'
    ? product.platformMappings : {};
  const key = clean(platform).toLowerCase();
  const mappingKey = key === 'easystore' ? 'easyStore' : key;
  const mapping = mappings[mappingKey] && typeof mappings[mappingKey] === 'object' ? mappings[mappingKey] : {};
  const statuses = product && product.platformListingStatus && typeof product.platformListingStatus === 'object' ? product.platformListingStatus : {};
  const status = statuses[mappingKey] && typeof statuses[mappingKey] === 'object' ? statuses[mappingKey] : {};
  const manualListingId = clean(status.listingId || status.externalId);
  let candidates = [];
  if (key === 'shopee') {
    candidates = [mapping.itemIds, mapping.itemId, mapping.channelProductIds, mapping.channelProductId, mapping.productIds, mapping.productId, manualListingId];
  } else if (key === 'momo') {
    const goodsCodes = (Array.isArray(mapping.goodsCodes) ? mapping.goodsCodes : [mapping.goodsCode]).map(clean).filter(Boolean);
    const goodsdtCodes = (Array.isArray(mapping.goodsdtCodes) ? mapping.goodsdtCodes : [mapping.goodsdtCode]).map(clean).filter(Boolean);
    const entpGoodsNos = (Array.isArray(mapping.entpGoodsNos) ? mapping.entpGoodsNos : [mapping.entpGoodsNo]).map(clean).filter(Boolean);
    if (goodsCodes.length && goodsCodes.length === goodsdtCodes.length) {
      candidates = goodsCodes.map((goodsCode, index) => `${goodsCode}|${goodsdtCodes[index]}`);
    } else if (entpGoodsNos.length) candidates = entpGoodsNos;
    else candidates = goodsdtCodes.length ? goodsdtCodes : goodsCodes;
    if (manualListingId) candidates.push(manualListingId);
  } else if (key === 'coupang') {
    candidates = [mapping.vendorItemIds, mapping.vendorItemId, mapping.sellerProductIds, mapping.sellerProductId, manualListingId];
  } else if (key === 'easystore') {
    candidates = [mapping.productId, product && product.sourceProductId, manualListingId];
  }
  const ids = [];
  candidates.forEach((value) => {
    const rows = Array.isArray(value) ? value : [value];
    rows.forEach((row) => {
      const id = clean(row);
      if (id && !ids.includes(id)) ids.push(id);
    });
  });
  return ids.slice(0, 50);
}

function platformQueueFingerprint(platform, snapshot) {
  const key = clean(platform).toLowerCase();
  const platformFields = key === 'momo'
    ? [snapshot.momoGoodsName, snapshot.momoSlogan, snapshot.momoCategoryCode, snapshot.momoPrice, snapshot.momoHtml, snapshot.momoSpecialPromotionImageUrl]
    : [snapshot.coupangTitle, snapshot.coupangCategoryCode, snapshot.coupangPrice, snapshot.coupangDescriptionHtml];
  return crypto.createHash('sha256').update(JSON.stringify(compactObject({
    platform: key,
    productId: snapshot.productId,
    sku: snapshot.sku,
    listingMode: snapshot.listingMode,
    variantGroup: snapshot.variantGroupEnabled ? {
      attributeName: snapshot.variantGroupAttributeName,
      variants: snapshot.variantGroupVariants
    } : [snapshot.variantParentProductId, snapshot.variantParentSku, snapshot.variantAttributeName, snapshot.variantParentAttributeValue, snapshot.variantAttributeValue, snapshot.variantParentImageUrl, snapshot.variantChildImageUrl],
    parentPlatformListingIds: platformListingIds({ platformMappings: snapshot.variantParentPlatformMappings, platformListingStatus: snapshot.variantParentPlatformListingStatus }, key),
    title: snapshot.title,
    description: snapshot.description,
    images: snapshot.images,
    stock: snapshot.stock,
    package: [snapshot.packageLengthCm, snapshot.packageWidthCm, snapshot.packageHeightCm, snapshot.packageWeightKg],
    automationPolicy: snapshot.automationPolicy,
    momoDelivery: snapshot.momoDelivery,
    momoSpecialPromotionImageUrl: snapshot.momoSpecialPromotionImageUrl,
    momoSpecialPromotionImagePolicy: snapshot.momoSpecialPromotionImagePolicy,
    momoCatalogPolicy: snapshot.momoCatalogPolicy,
    platformFields
  }))).digest('hex');
}

function listingSnapshotFingerprint(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(compactObject(snapshot || {}))).digest('hex');
}

function buildPlatformQueuePolicy(product, platform, snapshot) {
  const addVariant = clean(snapshot && snapshot.listingMode) === 'add-variant';
  const identityProduct = addVariant
    ? {
      platformMappings: snapshot.variantParentPlatformMappings && typeof snapshot.variantParentPlatformMappings === 'object' ? snapshot.variantParentPlatformMappings : {},
      platformListingStatus: snapshot.variantParentPlatformListingStatus && typeof snapshot.variantParentPlatformListingStatus === 'object' ? snapshot.variantParentPlatformListingStatus : {}
    }
    : product;
  const existingListingIds = platformListingIds(identityProduct, platform);
  if (addVariant) {
    return {
      mode: existingListingIds.length > 1 ? 'block-duplicate-parent' : existingListingIds.length ? 'add-variant-to-existing' : 'block-missing-parent',
      matchKey: 'parent-listing-id+sku', sku: snapshot.sku, existingListingIds,
      identitySource: 'central-platform-id', preflightSkuSearch: false, uncertainSubmitRecovery: 'exact-sku-only',
      parentProductId: clean(snapshot.variantParentProductId), parentSku: clean(snapshot.variantParentSku),
      variantAttributeName: clean(snapshot.variantAttributeName), variantParentAttributeValue: clean(snapshot.variantParentAttributeValue), variantAttributeValue: clean(snapshot.variantAttributeValue),
      variantParentImageUrl: safeHttpUrl(snapshot.variantParentImageUrl), variantImageUrl: safeHttpUrl(snapshot.variantChildImageUrl),
      onZero: 'block', onOne: 'append-variant', onMultiple: 'block', onUncertain: 'block'
    };
  }
  if (snapshot && snapshot.variantGroupEnabled === true) {
    return {
      mode: existingListingIds.length > 1 ? 'block-duplicate' : existingListingIds.length ? 'update-existing-variant-group' : 'create-new-variant-group',
      matchKey: existingListingIds.length ? 'central-platform-id+closed-sku-set' : 'new-variant-group',
      sku: snapshot.sku,
      skus: (snapshot.variantGroupVariants || []).map((row) => normalizeSku(row && row.sku)).filter(Boolean),
      attributeName: clean(snapshot.variantGroupAttributeName),
      existingListingIds,
      identitySource: existingListingIds.length ? 'central-platform-id' : 'new-draft',
      preflightSkuSearch: false,
      uncertainSubmitRecovery: 'exact-root-sku-only',
      onZero: 'create-one-parent-with-variants',
      onOne: 'update-one-parent-with-closed-variant-set',
      onMultiple: 'block',
      onUncertain: 'exact-root-sku-recovery'
    };
  }
  return {
    mode: existingListingIds.length > 1 ? 'block-duplicate' : existingListingIds.length ? 'update-existing' : 'create-new',
    matchKey: existingListingIds.length ? 'central-platform-id' : 'new-draft',
    sku: snapshot.sku,
    existingListingIds,
    identitySource: existingListingIds.length ? 'central-platform-id' : 'new-draft',
    preflightSkuSearch: false,
    uncertainSubmitRecovery: 'exact-sku-only',
    onZero: 'create',
    onOne: 'update',
    onMultiple: 'block',
    onUncertain: 'exact-sku-recovery'
  };
}

function exactEasyStoreMatches(payload, sku) {
  const normalizedSku = normalizeSku(sku);
  const matches = [];
  extractProducts(payload).forEach((product) => {
    productVariants(product).forEach((variant) => {
      if (normalizeSku(variant && (variant.sku || variant.code || variant.product_code)) === normalizedSku) {
        matches.push({ product, variant, productId: productIdOf(product), variantId: variantIdOf(variant) });
      }
    });
  });
  return matches.filter((row) => row.productId && row.variantId);
}

async function easyStoreRequest(path, token, options = {}, attempt = 0) {
  const url = `${EASY_STORE_URL}${EASY_STORE_API_BASE}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'EasyStore-Access-Token': token,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if ((options.method || 'GET') !== 'POST' && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (2 ** attempt)));
      return easyStoreRequest(path, token, options, attempt + 1);
    }
    throw new Error(`EasyStore 連線失敗：${clean(error && error.message) || '未知錯誤'}`);
  }
  const text = await response.text();
  if ((options.method || 'GET') !== 'POST' && [408, 425, 429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 800 * (2 ** attempt)));
    return easyStoreRequest(path, token, options, attempt + 1);
  }
  if (!response.ok) {
    const error = new Error(`EasyStore HTTP ${response.status}：${text.slice(0, 700)}`);
    error.status = response.status;
    throw error;
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`EasyStore 回傳格式不正確：${text.slice(0, 300)}`);
  }
}

async function findEasyStoreMappingBySku(snapshot, token) {
  const params = new URLSearchParams({ skus: snapshot.sku, limit: '100' });
  const payload = await easyStoreRequest(`/products.json?${params.toString()}`, token);
  const matches = exactEasyStoreMatches(payload, snapshot.sku);
  if (matches.length > 1) throw new Error(`EasyStore 找到 ${matches.length} 筆相同 SKU，為避免更新錯商品已停止。`);
  return matches[0] || null;
}

async function findEasyStoreMappingInProduct(snapshot, token, productId) {
  if (!productId) return null;
  let payload;
  try {
    payload = await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token);
  } catch (error) {
    if (error && error.status === 404) return null;
    throw error;
  }
  const matches = exactEasyStoreMatches(payload, snapshot.sku);
  if (matches.length > 1) throw new Error(`EasyStore 商品 ${productId} 內找到 ${matches.length} 個相同 SKU，為避免更新錯規格已停止。`);
  return matches[0] || null;
}

function easyStoreVariantPrice(variant) {
  return numberOrNull(variant && (variant.price ?? variant.sale_price ?? variant.regular_price));
}

function easyStoreVariantStock(variant) {
  return numberOrNull(variant && (variant.inventory_quantity ?? variant.quantity ?? variant.stock ?? variant.inventory));
}

function easyStorePublicationState(product) {
  if (!product || typeof product !== 'object') return 'unknown';
  for (const key of ['published', 'is_published', 'isPublished']) {
    if (!Object.prototype.hasOwnProperty.call(product, key)) continue;
    return product[key] === true ? 'published' : 'draft';
  }
  for (const key of ['published_at', 'publishedAt']) {
    if (!Object.prototype.hasOwnProperty.call(product, key)) continue;
    return clean(product[key]) ? 'published' : 'draft';
  }
  const status = clean(product.status || product.publish_status || product.publishStatus).toLowerCase();
  if (['published', 'active', 'live', '已發佈', '已發布', '已上架'].includes(status)) return 'published';
  if (['draft', 'unpublished', 'inactive', 'hidden', '未發佈', '未發布', '未上架', '草稿'].includes(status)) return 'draft';
  return 'unknown';
}

async function verifyEasyStorePublishedListing(snapshot, token, result) {
  let lastReasons = ['missing-from-official-catalog'];
  for (const delayMs of [0, 1000, 2500]) {
    if (delayMs) await wait(delayMs);
    let match = await findEasyStoreMappingInProduct(snapshot, token, clean(result && result.productId));
    if (!match && result && result.recoveredAfterUncertainResponse === true) {
      match = await findEasyStoreMappingBySku(snapshot, token);
    }
    if (!match) continue;
    const publicationState = easyStorePublicationState(match.product);
    if (publicationState === 'draft') {
      lastReasons = ['still-draft'];
      continue;
    }
    const price = easyStoreVariantPrice(match.variant);
    const variants = snapshot.variantGroupEnabled === true ? productVariants(match.product).map((variant) => ({
      sku: normalizeSku(variant && (variant.sku || variant.code || variant.product_code)),
      value: clean(variant && (variant.option1 || variant.name || variant.title || variant.option_name)),
      price: easyStoreVariantPrice(variant)
    })) : [];
    const verification = validatePlatformStageVerification('easyStore', snapshot, {
      listingId: match.productId,
      sku: snapshot.sku,
      price,
      variants,
      status: publicationState === 'published' ? 'published' : 'official-catalog-matched',
      platformListMatched: false,
      officialCatalogMatched: true
    });
    if (verification.verified) {
      return {
        verified: true,
        productId: match.productId,
        variantId: match.variantId,
        variantIds: snapshot.variantGroupEnabled === true
          ? productVariants(match.product).map(variantIdOf).filter(Boolean) : [match.variantId],
        ...verification.receipt
      };
    }
    lastReasons = verification.reasons;
  }
  throw new Error(`EasyStore 正式商品資料核對未通過：${lastReasons.join('、')}`);
}

async function recoverEasyStoreCreateBySku(snapshot, token) {
  let lastError = null;
  for (const delayMs of [1200, 2500, 5000, 10000]) {
    await wait(delayMs);
    try {
      const recovered = await findEasyStoreMappingBySku(snapshot, token);
      if (recovered) return recovered;
    } catch (error) {
      lastError = error;
      if (/找到 \d+ 筆相同 SKU/.test(clean(error && error.message))) throw error;
    }
  }
  if (lastError && /找到 \d+ 筆相同 SKU/.test(clean(lastError && lastError.message))) throw lastError;
  return null;
}

async function addEasyStoreVariant(snapshot, product, token) {
  const productId = clean(snapshot.variantParentEasyStoreProductId);
  if (!productId) throw new Error('父商品缺少 EasyStore productId；為避免建立重複商品已停止。');
  if (!clean(snapshot.variantAttributeName) || !clean(snapshot.variantParentAttributeValue) || !clean(snapshot.variantAttributeValue)) throw new Error('請先填寫細項名稱、父商品細項值與新細項值。');
  const childMappingIds = platformListingIds(product, 'easyStore');
  if (childMappingIds.length > 1 || (childMappingIds.length === 1 && childMappingIds[0] !== productId)) {
    throw new Error(`SKU ${snapshot.sku} 的中央 EasyStore 編號與父商品不一致，為避免移錯商品已停止。`);
  }
  const existingInParent = await findEasyStoreMappingInProduct(snapshot, token, productId);
  const variantTemplate = {
    ...buildEasyStoreProductBody(snapshot, true).product.variants[0],
    name: snapshot.variantAttributeValue
  };
  if (existingInParent) {
    await easyStoreRequest(`/products/${encodeURIComponent(productId)}/variants.json`, token, {
      method: 'PUT', body: { variants: [{ id: existingInParent.variantId, ...variantTemplate }] }
    });
    return { action: 'variant-updated', productId, variantIds: [existingInParent.variantId] };
  }

  const beforePayload = await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token);
  const beforeProduct = extractProducts(beforePayload)[0] || beforePayload.product || beforePayload;
  const beforeVariants = productVariants(beforeProduct);
  const beforeIds = new Set(beforeVariants.map(variantIdOf).filter(Boolean));
  const variantTypes = Array.isArray(beforeProduct.variant_types) ? beforeProduct.variant_types : [];
  if (variantTypes.length > 1) throw new Error('父商品目前有兩種以上的細項欄位；一個新 SKU 無法安全判定完整組合，請先人工整理父商品。');
  if (variantTypes.length === 1 && clean(variantTypes[0].name).toLowerCase() !== clean(snapshot.variantAttributeName).toLowerCase()) {
    throw new Error(`父商品既有細項是「${clean(variantTypes[0].name)}」，與這次的「${snapshot.variantAttributeName}」不同；為避免改壞既有細項已停止。`);
  }
  if (!variantTypes.length && beforeVariants.length !== 1) throw new Error('父商品沒有細項名稱，但已有多個規格；無法安全判定舊 SKU，請先人工整理。');
  const optionValues = variantTypes.length
    ? [snapshot.variantAttributeValue]
    : [snapshot.variantParentAttributeValue, snapshot.variantAttributeValue];
  let optionError = null;
  try {
    await easyStoreRequest(`/products/${encodeURIComponent(productId)}/options.json`, token, {
      method: 'POST', body: { option_type: snapshot.variantAttributeName, option_values: optionValues }
    });
  } catch (error) {
    // POST 回應可能中途斷線；不盲目重送，改用前後 variant id 差異確認是否已建立。
    optionError = error;
  }
  const afterPayload = await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token);
  const afterProduct = extractProducts(afterPayload)[0] || afterPayload.product || afterPayload;
  const newVariantIds = productVariants(afterProduct).map(variantIdOf).filter((id) => id && !beforeIds.has(id));
  const recovered = exactEasyStoreMatches(afterPayload, snapshot.sku)[0] || null;
  const variantId = recovered && recovered.variantId || (newVariantIds.length === 1 ? newVariantIds[0] : '');
  if (!variantId) {
    if (optionError) throw optionError;
    throw new Error(`EasyStore 已新增「${snapshot.variantAttributeValue}」選項，但產生 ${newVariantIds.length} 個新規格，無法安全判定哪一個屬於 SKU ${snapshot.sku}；請人工確認後再繼續。`);
  }
  await easyStoreRequest(`/products/${encodeURIComponent(productId)}/variants.json`, token, {
    method: 'PUT', body: { variants: [{ id: variantId, ...variantTemplate }] }
  });
  let imageWarning = '';
  const existingImages = Array.isArray(beforeProduct.images) ? beforeProduct.images : [];
  const existingImageUrls = new Set(existingImages.map((row) => safeHttpUrl(row && (row.url || row.src))).filter(Boolean));
  const availableImageSlots = Math.max(0, 9 - existingImages.length);
  const newImages = (snapshot.images || []).filter((url) => !existingImageUrls.has(safeHttpUrl(url))).slice(0, availableImageSlots);
  if (newImages.length) {
    try {
      await easyStoreRequest(`/products/${encodeURIComponent(productId)}/images.json`, token, { method: 'POST', body: { images: newImages } });
    } catch (error) {
      imageWarning = `；細項已建立，但圖片未能加入父商品：${clean(error && error.message).slice(0, 240)}`;
    }
  }
  return { action: 'variant-created', productId, variantIds: [variantId], recoveredAfterUncertainResponse: Boolean(optionError), imageWarning };
}

function easyStoreVariantValue(variant) {
  return clean(variant && (variant.option1 || variant.name || variant.title || variant.option_name || variant.optionName));
}

function easyStoreVariantTemplate(snapshot, row) {
  const groupedSnapshot = {
    ...snapshot,
    variantGroupEnabled: false,
    sku: normalizeSku(row && row.sku),
    barcode: clean(row && row.barcode),
    easyStorePrice: numberOrNull(row && row.easyStorePrice),
    stock: numberOrNull(row && row.stock),
    storePrice: numberOrNull(row && row.storePrice),
    costPrice: numberOrNull(row && row.costPrice)
  };
  const template = buildEasyStoreProductBody(groupedSnapshot, true).product.variants[0];
  const value = clean(row && row.attributeValue);
  return { ...template, name: value, option1: value };
}

async function syncEasyStoreVariantGroup(snapshot, productId, token) {
  const expected = Array.isArray(snapshot.variantGroupVariants) ? snapshot.variantGroupVariants : [];
  if (expected.length < 2 || !clean(snapshot.variantGroupAttributeName)) {
    throw new Error('同款多細項缺少完整細項名稱或至少兩個細項。');
  }
  let payload = await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token);
  let remoteProduct = extractProducts(payload)[0] || payload.product || payload;
  let remoteVariants = productVariants(remoteProduct);
  const expectedSkus = new Set(expected.map((row) => normalizeSku(row && row.sku)));
  let missing = expected.filter((row) => !remoteVariants.some((variant) => normalizeSku(variant && variant.sku) === normalizeSku(row && row.sku)));
  if (missing.length) {
    const variantTypes = Array.isArray(remoteProduct.variant_types) ? remoteProduct.variant_types : [];
    if (variantTypes.length > 1) throw new Error('EasyStore 既有主商品含兩種以上細項欄位，無法安全套用本次單一細項群組。');
    if (variantTypes.length === 1 && clean(variantTypes[0].name).toLowerCase() !== clean(snapshot.variantGroupAttributeName).toLowerCase()) {
      throw new Error(`EasyStore 既有細項是「${clean(variantTypes[0].name)}」，與本次「${snapshot.variantGroupAttributeName}」不同。`);
    }
    const existingValues = new Set(remoteVariants.map(easyStoreVariantValue).map((value) => value.toLowerCase()).filter(Boolean));
    const requestedValues = expected.map((row) => clean(row.attributeValue)).filter((value) => !existingValues.has(value.toLowerCase()));
    if (!variantTypes.length) {
      if (remoteVariants.length !== 1) throw new Error('EasyStore 主商品沒有細項名稱但已有多個規格，無法安全建立群組。');
      await easyStoreRequest(`/products/${encodeURIComponent(productId)}/options.json`, token, {
        method: 'POST', body: { option_type: snapshot.variantGroupAttributeName, option_values: expected.map((row) => clean(row.attributeValue)) }
      });
    } else if (requestedValues.length) {
      await easyStoreRequest(`/products/${encodeURIComponent(productId)}/options.json`, token, {
        method: 'POST', body: { option_type: snapshot.variantGroupAttributeName, option_values: requestedValues }
      });
    }
    payload = await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token);
    remoteProduct = extractProducts(payload)[0] || payload.product || payload;
    remoteVariants = productVariants(remoteProduct);
  }

  const unused = remoteVariants.slice();
  const updates = expected.map((row) => {
    const sku = normalizeSku(row && row.sku);
    const value = clean(row && row.attributeValue).toLowerCase();
    let index = unused.findIndex((variant) => normalizeSku(variant && variant.sku) === sku);
    if (index < 0) index = unused.findIndex((variant) => easyStoreVariantValue(variant).toLowerCase() === value);
    if (index < 0) throw new Error(`EasyStore 未產生細項「${clean(row && row.attributeValue)}」；為避免錯配 SKU 已停止。`);
    const variant = unused.splice(index, 1)[0];
    const id = variantIdOf(variant);
    if (!id) throw new Error(`EasyStore 細項「${clean(row && row.attributeValue)}」缺少規格編號。`);
    return { id, ...easyStoreVariantTemplate(snapshot, row) };
  });
  const unexpectedSkus = remoteVariants.map((variant) => normalizeSku(variant && variant.sku)).filter((sku) => sku && !expectedSkus.has(sku));
  if (unexpectedSkus.length) throw new Error(`EasyStore 主商品仍含不屬於本組的 SKU：${unexpectedSkus.join('、')}；為避免誤刪既有資料已停止。`);
  await easyStoreRequest(`/products/${encodeURIComponent(productId)}/variants.json`, token, {
    method: 'PUT', body: { variants: updates }
  });
  return updates.map((row) => clean(row.id));
}

async function upsertEasyStoreProduct(snapshot, product, token) {
  if (snapshot.listingMode === 'add-variant') return addEasyStoreVariant(snapshot, product, token);
  const grouped = snapshot.variantGroupEnabled === true;
  const mappings = product.platformMappings && typeof product.platformMappings === 'object' ? product.platformMappings : {};
  const mapped = mappings.easyStore && typeof mappings.easyStore === 'object' ? mappings.easyStore : {};
  const mappedProductId = clean(mapped.productId || product.sourceProductId);
  let productId = '';
  let variantIds = [];
  const existing = await findEasyStoreMappingInProduct(snapshot, token, mappedProductId);
  if (mappedProductId && !existing) {
    throw new Error(`中央商品記錄的 EasyStore productId ${mappedProductId} 找不到相同 SKU；已停止，不會改走全站 SKU 搜尋或建立替代商品。`);
  }
  if (existing) {
    productId = existing.productId;
    variantIds = [existing.variantId];
  }
  let action = 'updated';
  if (!productId) {
    action = 'created';
    let createdPayload;
    try {
      createdPayload = await easyStoreRequest('/products.json', token, { method: 'POST', body: buildEasyStoreProductBody(snapshot, true) });
    } catch (error) {
      // POST 可能已成功但回應在途中斷線；等待 EasyStore 完成索引，再以完全相同 SKU 回查。
      // 不在同一個不確定回應後盲目重送 POST，避免建立重複商品。
      let recovered = null;
      try {
        recovered = await recoverEasyStoreCreateBySku(snapshot, token);
      } catch (recoveryError) {
        if (/找到 \d+ 筆相同 SKU/.test(clean(recoveryError && recoveryError.message))) throw recoveryError;
        throw error;
      }
      if (!recovered) throw error;
      if (grouped) {
        const groupedVariantIds = await syncEasyStoreVariantGroup(snapshot, recovered.productId, token);
        return { action: 'created', productId: recovered.productId, variantIds: groupedVariantIds, recoveredAfterUncertainResponse: true };
      }
      return { action: 'created', productId: recovered.productId, variantIds: [recovered.variantId], recoveredAfterUncertainResponse: true };
    }
    const createdProduct = extractProducts(createdPayload)[0] || (createdPayload && createdPayload.product) || createdPayload;
    productId = productIdOf(createdProduct);
    variantIds = productVariants(createdProduct).map(variantIdOf).filter(Boolean);
    if (!productId || !variantIds.length) {
      const resolved = await findEasyStoreMappingBySku(snapshot, token);
      if (!resolved) throw new Error('EasyStore 已接受建立商品，但尚未回傳可追蹤的商品／規格編號。請到 EasyStore 後台確認。');
      productId = resolved.productId;
      variantIds = [resolved.variantId];
    }
  } else {
    await easyStoreRequest(`/products/${encodeURIComponent(productId)}.json`, token, {
      method: 'PUT', body: buildEasyStoreProductBody(snapshot, false)
    });
    if (grouped) {
      variantIds = await syncEasyStoreVariantGroup(snapshot, productId, token);
      return { action, productId, variantIds };
    }
    if (!variantIds.length) throw new Error('EasyStore 商品已存在，但缺少規格編號，為避免改錯商品已停止。');
    const variantTemplate = buildEasyStoreProductBody(snapshot, true).product.variants[0];
    await easyStoreRequest(`/products/${encodeURIComponent(productId)}/variants.json`, token, {
      method: 'PUT', body: { variants: variantIds.map((id) => ({ id, ...variantTemplate })) }
    });
  }
  if (grouped) variantIds = await syncEasyStoreVariantGroup(snapshot, productId, token);
  return { action, productId, variantIds };
}

function easyStoreMissingFields(snapshot) {
  const missing = [];
  missing.push(...variantRepresentativeMissingFields(snapshot));
  if (snapshot.listingMode === 'add-variant' && !snapshot.variantParentEasyStoreProductId) missing.push('父商品 EasyStore 編號');
  if (snapshot.listingMode === 'add-variant' && (!snapshot.variantAttributeName || !snapshot.variantParentAttributeValue || !snapshot.variantAttributeValue)) missing.push('細項名稱、父商品細項值與新細項值');
  if (!snapshot.sku) missing.push('SKU');
  if (!snapshot.title) missing.push('商品名稱');
  if (!snapshot.description) missing.push('完整商品介紹');
  if (!snapshot.images.length) missing.push('上架圖片');
  if (snapshot.easyStorePrice == null) missing.push('EasyStore 售價');
  const template = shopeeTaxonomy.templateAttributeRows(snapshot, snapshot.shopeeCategoryPath);
  const attributes = new Map(normalizeShopeeAttributes(snapshot.shopeeAttributeValues)
    .map((row) => [clean(row.label).toLowerCase(), row]));
  template.filter((field) => field.manualConfirmation === true).forEach((field) => {
    const row = attributes.get(clean(field.label).toLowerCase());
    if (!row || row.confidence !== 'high') missing.push(`蝦皮屬性 ${field.label}`);
  });
  return missing;
}

function momoMissingFields(snapshot) {
  const missing = [];
  const imagePlan = snapshot.platformImagePlan && snapshot.platformImagePlan.momo || {};
  missing.push(...variantRepresentativeMissingFields(snapshot));
  if (!snapshot.sku) missing.push('SKU');
  if (!snapshot.momoGoodsName) missing.push('MOMO 商品名稱');
  if (!snapshot.description) missing.push('完整商品介紹');
  if (!imagePlan.ready || imagePlan.requiredFirstRole !== 'cleanMain' || !Array.isArray(imagePlan.imageUrls) || !imagePlan.imageUrls.length) missing.push('MOMO cleanMain 首圖');
  if (!imagePlan.promotionImageReady || !snapshot.momoSpecialPromotionImageUrl) missing.push('MOMO clean-only 專推圖');
  if (snapshot.momoPrice == null) missing.push('MOMO 售價');
  return missing;
}

function coupangMissingFields(snapshot) {
  const missing = [];
  const imagePlan = snapshot.platformImagePlan && snapshot.platformImagePlan.coupang || {};
  missing.push(...variantRepresentativeMissingFields(snapshot));
  if (!snapshot.sku) missing.push('SKU');
  if (!snapshot.coupangTitle) missing.push('酷澎標題');
  if (!snapshot.description) missing.push('完整商品介紹');
  if (!imagePlan.ready || imagePlan.requiredFirstRole !== 'cleanMain' || !Array.isArray(imagePlan.imageUrls) || !imagePlan.imageUrls.length) missing.push('酷澎 cleanMain 首圖');
  if (snapshot.coupangPrice == null) missing.push('酷澎售價');
  return missing;
}

function platformPayloadSnapshot(platform, snapshot) {
  const key = clean(platform).toLowerCase();
  if (!['coupang', 'momo'].includes(key)) return snapshot;
  const plan = snapshot.platformImagePlan && snapshot.platformImagePlan[key] && typeof snapshot.platformImagePlan[key] === 'object'
    ? snapshot.platformImagePlan[key] : {};
  const images = normalizeUrls(plan.imageUrls, 7);
  return {
    ...snapshot,
    images,
    momoSpecialPromotionImageUrl: key === 'momo' ? safeHttpUrl(plan.promotionImageUrl) : snapshot.momoSpecialPromotionImageUrl,
    imagePolicy: {
      ...(snapshot.imagePolicy || {}),
      platformMainImage: key === 'coupang' || key === 'momo' ? 'cleanMain' : 'brandedHero',
      brandedHeroAllowedAfterMain: plan.brandedHeroAllowedAsSecondary === true,
      brandedHeroExcluded: false,
      removeSecondaryBrandedHeroIfPlatformRejectsGalleryLogo: plan.removeSecondaryBrandedHeroIfPlatformRejectsGalleryLogo === true
    }
  };
}

function platformStageFingerprint(platform, snapshot) {
  return platformQueueFingerprint(platform, platformPayloadSnapshot(platform, snapshot));
}

function platformCategoryResolution(platform, snapshot, product) {
  const key = clean(platform).toLowerCase();
  const code = key === 'momo' ? clean(snapshot.momoCategoryCode) : clean(snapshot.coupangCategoryCode);
  const canonical = snapshot.canonicalCategoryDecision && typeof snapshot.canonicalCategoryDecision === 'object'
    ? snapshot.canonicalCategoryDecision : buildCanonicalCategoryDecision(snapshot);
  const productHint = clean(canonical.evidenceSummary || snapshot.shopeeCategoryPath || product.category || snapshot.title).slice(0, 420);
  const hint = `共同分類已在進站前判定為「${clean(canonical.canonicalFamily) || '未判定'}」；只將它映射至本平台葉分類：${productHint}`.slice(0, 500);
  const constraint = {
    scope: 'music-instruments-only',
    allowedRootNames: ['樂器', '樂器配件'],
    canonicalCategoryKey: clean(canonical.canonicalKey),
    canonicalFamily: clean(canonical.canonicalFamily),
    decidedOnceBeforePlatformNavigation: true,
    forbidProductReclassificationInsidePlatform: true,
    selectionRule: '沿用進站前的共同商品分類，只在樂器或樂器配件分類樹內映射最接近的有效葉分類。'
  };
  return code
    ? { mode: 'provided', code, hint, source: 'listing-case', ...constraint }
    : { mode: 'map-once', code: '', hint, source: 'canonical-category-to-official-platform-taxonomy', ...constraint };
}

async function queueFixedIpPlatform(db, jobId, platform, snapshot, product, missingFields, attemptToken) {
  if (missingFields.length) {
    return { status: 'missing-fields', message: `請先補：${missingFields.join('、')}`, missingFields };
  }
  const normalizedAttemptToken = clean(attemptToken);
  if (!normalizedAttemptToken) throw new Error(`${platform} 缺少本次逐站排程 attemptToken，已停止以避免舊回條混入。`);
  const platformSnapshot = platformPayloadSnapshot(platform, snapshot);
  const queueRef = db.collection(PLATFORM_QUEUE_COLLECTION).doc(`${snapshot.productId}_${platform.toLowerCase()}`);
  if (platformSnapshot.variantGroupEnabled === true) {
    const childQueueRefs = (platformSnapshot.variantGroupVariants || []).slice(1)
      .map((row) => clean(row && row.productId)).filter(Boolean)
      .map((childId) => db.collection(PLATFORM_QUEUE_COLLECTION).doc(`${childId}_${platform.toLowerCase()}`));
    await Promise.all(childQueueRefs.map(async (childRef) => {
      const childSnap = await childRef.get();
      if (!childSnap.exists) return;
      const childQueue = childSnap.data() || {};
      if (!PLATFORM_QUEUE_PENDING_STATUSES.has(clean(childQueue.status).toLowerCase())) return;
      await childRef.set({
        status: 'superseded-by-variant-group', supersededByJobId: jobId,
        supersededByProductId: platformSnapshot.productId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }));
  }
  const listingPolicy = buildPlatformQueuePolicy(product, platform, platformSnapshot);
  const categoryResolution = platformCategoryResolution(platform, platformSnapshot, product);
  if (listingPolicy.mode === 'block-duplicate' || listingPolicy.mode === 'block-duplicate-parent') {
    return {
      status: 'action-required',
      message: `${platform} 已對到 ${listingPolicy.existingListingIds.length} 個可能的${listingPolicy.mode === 'block-duplicate-parent' ? '父商品' : '相同 SKU 商品'}，為避免更新錯商品已停止。`
    };
  }
  if (listingPolicy.mode === 'block-missing-parent') {
    return { status: 'action-required', message: `${platform} 尚未找到父商品的平台編號；請先確認父商品已上架，再加入新細項。` };
  }
  const fingerprint = platformQueueFingerprint(platform, platformSnapshot);
  let reusedStatus = '';
  await db.runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(queueRef);
    const existing = existingSnapshot.exists ? existingSnapshot.data() || {} : {};
    const sameIdentity = normalizeSku(existing.sku) === snapshot.sku
      && clean(existing.productId) === platformSnapshot.productId;
    const sameFingerprint = clean(existing.fingerprint) === fingerprint;
    const existingStatus = clean(existing.status).toLowerCase();
    const sameAttempt = clean(existing.workflowVersion) === LISTING_WORKFLOW_ID
      && clean(existing.jobId) === jobId
      && clean(existing.attemptToken || existing.stageToken) === normalizedAttemptToken;
    if (sameIdentity && sameFingerprint && sameAttempt && PLATFORM_QUEUE_PENDING_STATUSES.has(existingStatus)) {
      reusedStatus = 'already-queued';
      return;
    }
    if (sameIdentity && sameFingerprint && !sameAttempt && PLATFORM_QUEUE_PENDING_STATUSES.has(existingStatus)) {
      // A newer v3 job for the exact same SKU and immutable payload may safely
      // take over an unfinished queue slot.  Keep the previous attempt in the
      // audit trail, but never reuse its receipt or stage token.
      transaction.set(queueRef, {
        supersededAttempt: {
          jobId: clean(existing.jobId),
          attemptToken: clean(existing.attemptToken || existing.stageToken),
          status: existingStatus,
          supersededAt: admin.firestore.FieldValue.serverTimestamp()
        }
      }, { merge: true });
    }
    if (sameIdentity && sameFingerprint && sameAttempt && PLATFORM_QUEUE_RECEIPT_STATUSES.has(existingStatus)) {
      reusedStatus = 'already-completed';
      return;
    }
    transaction.set(queueRef, {
      jobId, productId: platformSnapshot.productId, sku: platformSnapshot.sku, platform,
      workflowVersion: LISTING_WORKFLOW_ID,
      attemptToken: normalizedAttemptToken,
      stageToken: normalizedAttemptToken,
      snapshotFingerprint: listingSnapshotFingerprint(snapshot),
      status: 'awaiting-store-agent', payload: { ...platformSnapshot, categoryResolution }, listingPolicy, fingerprint,
      verificationRequirements: snapshot.automationPolicy && snapshot.automationPolicy.publishVerification,
      verificationReceipt: null, verifiedChecks: null, completedAt: null, error: '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: '全通路營運中心', schemaVersion: 3
    }, { merge: true });
  });
  if (reusedStatus === 'already-queued') {
    return {
      status: 'already-queued',
      message: `${platform} 相同 SKU 的工作已在處理中，本次不會再排第二筆。`,
      queueId: queueRef.id,
      fingerprint,
      attemptToken: normalizedAttemptToken
    };
  }
  if (reusedStatus === 'already-completed') {
    return {
      status: 'already-completed',
      message: `${platform} 相同版本已處理完成，本次不會重複建立。`,
      queueId: queueRef.id,
      fingerprint,
      attemptToken: normalizedAttemptToken
    };
  }
  const categoryPrefix = categoryResolution.mode === 'map-once' ? `${platform} 會沿用進站前已判定的共同分類，只映射一次本平台的樂器／樂器配件葉分類；` : '';
  const message = categoryPrefix + (listingPolicy.mode === 'add-variant-to-existing'
    ? `${platform} 將把 SKU ${platformSnapshot.sku} 加入指定的既有商品，子編號的庫存與價格仍獨立。`
    : listingPolicy.existingListingIds.length
    ? `${platform} 已找到既有平台編號，將更新原商品，不會建立第二筆。`
    : `${platform} 沒有中央平台編號，將直接建立同一份草稿；只有送出結果不明時才用完全相同 SKU 回查，不會先掃描全站商品。`);
  return {
    status: 'awaiting-store-agent',
    message,
    queueId: queueRef.id,
    fingerprint,
    attemptToken: normalizedAttemptToken
  };
}

async function acquirePublishLock(db, caseRef, jobId, createdBy) {
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(caseRef);
    if (!snapshot.exists) throw new HttpsError('failed-precondition', '請先儲存商品上架資料。');
    const data = snapshot.data() || {};
    const lock = data.publishLock && typeof data.publishLock === 'object' ? data.publishLock : {};
    const expiresAt = lock.expiresAt && typeof lock.expiresAt.toMillis === 'function' ? lock.expiresAt.toMillis() : 0;
    if (lock.status === 'running' && expiresAt > now) {
      throw new HttpsError('already-exists', '這件商品正在上架，請等待目前工作完成，不要重複送出。');
    }
    transaction.set(caseRef, {
      publishLock: {
        status: 'running', jobId, createdBy,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(now + PUBLISH_LOCK_MS)
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function releasePublishLock(caseRef, jobId, status) {
  await caseRef.set({
    publishLock: {
      status: clean(status) || 'finished', jobId,
      expiresAt: admin.firestore.Timestamp.fromMillis(0),
      finishedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

function overallPublishStatus(platforms) {
  const states = Object.values(platforms).map((row) => clean(row && row.status));
  if (states.some((status) => status === 'failed')) return 'partial-failed';
  if (states.some((status) => status === 'missing-fields')) return 'needs-input';
  if (states.some((status) => ['awaiting-store-agent', 'waiting-easystore-sync', 'action-required', 'already-queued'].includes(status))) return 'submitted';
  return states.length ? 'completed' : 'no-platform';
}

function expectedStagePrice(stage, snapshot) {
  if (stage === 'momo') return numberOrNull(snapshot.momoPrice);
  if (stage === 'coupang') return numberOrNull(snapshot.coupangPrice);
  return numberOrNull(snapshot.easyStorePrice);
}

function collectImageUrls(value, imageContext = false, result = [], visited = new Set()) {
  if (value === null || value === undefined) return result;
  if (typeof value === 'string') {
    if (imageContext) {
      const url = safeHttpUrl(value);
      if (url && !result.includes(url)) result.push(url);
    }
    return result;
  }
  if (typeof value !== 'object' || visited.has(value)) return result;
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => collectImageUrls(entry, imageContext, result, visited));
    return result;
  }
  Object.entries(value).forEach(([key, entry]) => {
    const nextImageContext = imageContext || /(image|photo|picture|thumbnail|gallery)/i.test(key);
    if (typeof entry === 'string') {
      if (nextImageContext || (imageContext && /^(url|src)$/i.test(key))) collectImageUrls(entry, true, result, visited);
    } else {
      collectImageUrls(entry, nextImageContext, result, visited);
    }
  });
  return result;
}

function frozenSourceImageUrls(snapshot) {
  const plan = snapshot && snapshot.platformImagePlan && typeof snapshot.platformImagePlan === 'object'
    ? snapshot.platformImagePlan : {};
  const values = [];
  (Array.isArray(plan.roleAssignments) ? plan.roleAssignments : []).forEach((row) => values.push(row && row.sourceImageUrl));
  (Array.isArray(plan.imageReferenceCases) ? plan.imageReferenceCases : []).forEach((row) => {
    values.push(row && row.representativeSourceImageUrl);
    (Array.isArray(row && row.sourceImageUrls) ? row.sourceImageUrls : []).forEach((url) => values.push(url));
  });
  return new Set(normalizeUrls(values, 1000));
}

function validatePlatformImageEvidence(stage, snapshot, verification) {
  const name = clean(stage).toLowerCase();
  const planKey = name === 'easystore' ? 'easyStore' : name;
  const observed = verification && typeof verification === 'object' ? verification : {};
  const plan = snapshot && snapshot.platformImagePlan && typeof snapshot.platformImagePlan === 'object'
    ? snapshot.platformImagePlan : {};
  const platformPlan = plan[planKey] && typeof plan[planKey] === 'object' ? plan[planKey] : {};
  const expected = normalizeUrls(platformPlan.imageUrls, 12);
  const rawAppliedImageUrls = Array.isArray(observed.appliedImageUrls) ? observed.appliedImageUrls : [];
  const rawOfficialImageUrls = Array.isArray(observed.officialImageUrls) ? observed.officialImageUrls : [];
  const appliedImageUrls = normalizeUrls(rawAppliedImageUrls, 100);
  const officialImageUrls = normalizeUrls(rawOfficialImageUrls, 100);
  const sourceUrls = frozenSourceImageUrls(snapshot);
  const allowed = new Set(expected);
  if (name === 'easystore' || name === 'shopee') {
    normalizeUrls(snapshot && snapshot.images, 20).forEach((url) => allowed.add(url));
  }
  const reasons = [];
  const hasPostSubmitEvidence = rawAppliedImageUrls.length > 0 || rawOfficialImageUrls.length > 0;
  if (!hasPostSubmitEvidence) {
    return {
      verified: true,
      reasons,
      appliedImageUrls,
      officialImageUrls,
      imageEvidenceComplete: false,
      skippedAfterPreflight: true
    };
  }
  if (appliedImageUrls.some((url) => sourceUrls.has(url))) reasons.push('applied-image-evidence-contains-frozen-source');
  if (officialImageUrls.some((url) => sourceUrls.has(url))) reasons.push('official-image-evidence-contains-frozen-source');
  if (appliedImageUrls.some((url) => !allowed.has(url))) reasons.push('applied-image-evidence-outside-final-plan');
  if (appliedImageUrls.length && expected[0] && appliedImageUrls[0] !== expected[0]) reasons.push('applied-image-evidence-first-role-mismatch');
  return {
    verified: reasons.length === 0,
    reasons,
    appliedImageUrls,
    officialImageUrls,
    imageEvidenceComplete: observed.imageEvidenceComplete === true
  };
}

function validatePlatformStageVerification(stage, snapshot, verification) {
  const name = clean(stage).toLowerCase();
  const observed = verification && typeof verification === 'object' ? verification : {};
  const reasons = [];
  const expectedSku = normalizeSku(snapshot && snapshot.sku);
  const observedSku = normalizeSku(observed.sku);
  const expectedPrice = expectedStagePrice(name, snapshot || {});
  const observedPrice = numberOrNull(observed.price);
  const observedStock = numberOrNull(observed.stock);
  const grouped = snapshot && snapshot.variantGroupEnabled === true;
  const expectedVariants = grouped ? (Array.isArray(snapshot.variantGroupVariants) ? snapshot.variantGroupVariants : []) : [];
  const observedVariants = grouped ? (Array.isArray(observed.variants) ? observed.variants : []).map((row) => ({
    sku: normalizeSku(row && row.sku),
    value: clean(row && (row.value || row.attributeValue || row.name || row.title)),
    price: numberOrNull(row && row.price),
    stock: numberOrNull(row && row.stock),
    imageUrl: safeHttpUrl(row && row.imageUrl)
  })) : [];
  if (!['easystore', 'shopee', 'coupang', 'momo'].includes(name)) reasons.push('unsupported-stage');
  if (!clean(observed.listingId || observed.productId)) reasons.push('missing-listing-id');
  if (!expectedSku || observedSku !== expectedSku) reasons.push('sku-mismatch');
  if (!grouped && expectedPrice !== null && observedPrice !== expectedPrice) reasons.push('price-mismatch');
  if (grouped) {
    const expectedBySku = new Map(expectedVariants.map((row) => [normalizeSku(row && row.sku), row]));
    const observedBySku = new Map(observedVariants.map((row) => [normalizeSku(row && row.sku), row]));
    if (expectedBySku.size < 2 || observedVariants.length !== expectedBySku.size || observedBySku.size !== expectedBySku.size) reasons.push('variant-sku-set-mismatch');
    expectedBySku.forEach((expected, sku) => {
      const actual = observedBySku.get(sku);
      if (!actual) return;
      const platformPrice = name === 'momo' ? numberOrNull(expected.momoPrice)
        : name === 'coupang' ? numberOrNull(expected.coupangPrice) : numberOrNull(expected.easyStorePrice);
      if (platformPrice !== null && actual.price !== platformPrice) reasons.push(`variant-price-mismatch:${sku}`);
      if (clean(expected.attributeValue) && actual.value && actual.value !== clean(expected.attributeValue)) reasons.push(`variant-value-mismatch:${sku}`);
    });
  }
  const observedStatus = clean(observed.status);
  if (!observedStatus) reasons.push('missing-status');
  else if (['draft', 'unpublished', 'inactive', 'failed', 'rejected', 'error', '暫存', '草稿', '未上架', '未發布', '未發佈'].includes(observedStatus.toLowerCase())) reasons.push('not-submitted-or-published');
  if (observed.platformListMatched !== true && observed.officialCatalogMatched !== true) reasons.push('no-official-list-match');
  const imageVerification = validatePlatformImageEvidence(name, snapshot || {}, observed);
  reasons.push(...imageVerification.reasons);
  return {
    verified: reasons.length === 0,
    reasons,
    receipt: {
      stage: name,
      listingId: clean(observed.listingId || observed.productId),
      sku: observedSku,
      price: observedPrice,
      stock: observedStock,
      variants: observedVariants,
      status: clean(observed.status),
      platformListMatched: observed.platformListMatched === true,
      officialCatalogMatched: observed.officialCatalogMatched === true,
      imageEvidenceComplete: imageVerification.imageEvidenceComplete,
      appliedImageUrls: imageVerification.appliedImageUrls,
      officialImageUrls: imageVerification.officialImageUrls
    }
  };
}

function initialListingStages() {
  return {
    momo: { status: 'ready' },
    coupang: { status: 'ready' },
    easyStore: { status: 'ready' },
    shopee: { status: 'blocked-by-dependency', dependsOn: ['easyStore'] }
  };
}

function listingStageVerified(stages, stage) {
  const state = stages && stages[stage] && typeof stages[stage] === 'object' ? stages[stage] : {};
  return clean(state.status).toLowerCase() === 'verified';
}

function allListingStagesVerified(stages) {
  return PLATFORM_EXECUTION_ORDER.every((stage) => listingStageVerified(stages, stage));
}

function deriveListingCurrentStage(stages) {
  if (allListingStagesVerified(stages)) return 'finalizing';
  if (listingStageVerified(stages, 'easyStore') && !listingStageVerified(stages, 'shopee')) return 'shopee';
  return 'parallel-platforms';
}

function queueStageFromPlatform(platform) {
  const key = clean(platform).toLowerCase();
  if (key === 'coupang' || key === 'momo') return key;
  return '';
}

function validateQueuedStageReceipt(job, queueRecord) {
  const currentJob = job && typeof job === 'object' ? job : {};
  const record = queueRecord && typeof queueRecord === 'object' ? queueRecord : {};
  const stage = queueStageFromPlatform(record.platform);
  const stages = currentJob.stages && typeof currentJob.stages === 'object' ? currentJob.stages : {};
  const stageState = stage && stages[stage] && typeof stages[stage] === 'object' ? stages[stage] : {};
  const reasons = [];
  if (!stage) reasons.push('unsupported-platform');
  if (clean(currentJob.workflowVersion) !== LISTING_WORKFLOW_ID || clean(record.workflowVersion) !== LISTING_WORKFLOW_ID) reasons.push('workflow-version-mismatch');
  if (!clean(currentJob.productId) || clean(record.productId) !== clean(currentJob.productId)) reasons.push('product-mismatch');
  if (!clean(record.jobId) || clean(record.jobId) !== clean(currentJob.id || currentJob.jobId)) reasons.push('job-mismatch');
  if (!clean(record.attemptToken) || clean(record.attemptToken) !== clean(stageState.attemptToken)) reasons.push('attempt-token-mismatch');
  if (!clean(record.fingerprint) || clean(record.fingerprint) !== clean(stageState.fingerprint)) reasons.push('fingerprint-mismatch');
  if (!clean(record.snapshotFingerprint) || clean(record.snapshotFingerprint) !== clean(currentJob.preparedSnapshotFingerprint)) reasons.push('snapshot-fingerprint-mismatch');
  if (!PLATFORM_QUEUE_RECEIPT_STATUSES.has(clean(record.status).toLowerCase())) reasons.push('queue-status-not-verified');
  const receipt = record.verificationReceipt && typeof record.verificationReceipt === 'object' ? record.verificationReceipt : {};
  if (clean(receipt.stage) && clean(receipt.stage).toLowerCase() !== stage) reasons.push('receipt-stage-mismatch');
  const verification = validatePlatformStageVerification(stage, currentJob.preparedSnapshot || {}, receipt);
  reasons.push(...verification.reasons);
  return { verified: reasons.length === 0, reasons: Array.from(new Set(reasons)), stage, receipt: verification.receipt };
}

function preparedImageReferenceCases(snapshot) {
  const plan = snapshot && snapshot.platformImagePlan && typeof snapshot.platformImagePlan === 'object'
    ? snapshot.platformImagePlan : {};
  return (Array.isArray(plan.imageReferenceCases) ? plan.imageReferenceCases : []).map((row) => ({
    productId: clean(row && row.productId),
    sku: clean(row && row.sku),
    sourceImageUrls: normalizeUrls(row && row.sourceImageUrls, 20),
    representativeSourceImageUrl: safeHttpUrl(row && row.representativeSourceImageUrl),
    representativeCompletedImageUrl: safeHttpUrl(row && row.representativeCompletedImageUrl)
  })).filter((row) => row.productId);
}

function centralCompletedImageUpdate(snapshot, productId, productRecord = {}) {
  const plan = snapshot && snapshot.platformImagePlan && typeof snapshot.platformImagePlan === 'object'
    ? snapshot.platformImagePlan : {};
  const rows = (Array.isArray(plan.roleAssignments) ? plan.roleAssignments : []).filter((row) => (
    clean(row && row.productId) === clean(productId)
    && safeHttpUrl(row && row.url)
    && safeHttpUrl(row && row.url) !== safeHttpUrl(row && row.sourceImageUrl)
  ));
  const completedUrls = normalizeUrls(rows.map((row) => row.url), 100);
  const references = preparedImageReferenceCases(snapshot);
  const reference = references.find((row) => row.productId === clean(productId)) || {};
  const representativeUrl = safeHttpUrl(reference.representativeCompletedImageUrl);
  const representativeRow = rows.find((row) => safeHttpUrl(row.url) === representativeUrl && cleanRepresentativeRoleRow(row));
  const cleanRow = rows.find((row) => row.roles.includes('cleanMain') && cleanRepresentativeRoleRow(row))
    || rows.find((row) => row.roles.includes('variantRepresentative') && cleanRepresentativeRoleRow(row));
  const existingUrl = safeHttpUrl(productRecord && productRecord.imageUrl);
  const imageUrl = representativeRow ? representativeRow.url : cleanRow ? cleanRow.url : completedUrls.includes(existingUrl) ? existingUrl : '';
  if (!imageUrl) return {};
  return {
    imageUrl,
    imageUrls: [imageUrl].concat(completedUrls.filter((url) => url !== imageUrl)),
    completedListingImageUrls: completedUrls
  };
}

function completedVariantRecords(productRecord, completedBySku, fallbackUpdate, frozenSources) {
  const variants = Array.isArray(productRecord && productRecord.variants) ? productRecord.variants : null;
  if (!variants) return null;
  return variants.map((variant) => {
    if (!variant || typeof variant !== 'object') return variant;
    const matched = completedBySku.get(normalizeSku(variant.sku || variant.internalSku || variant.code));
    const hasFrozenImage = collectImageUrls(variant, false).some((url) => frozenSources.has(url));
    const update = matched || (hasFrozenImage ? fallbackUpdate : null);
    if (!update || !safeHttpUrl(update.imageUrl)) return variant;
    const next = { ...variant };
    ['imageUrl', 'image', 'picture', 'photo', 'thumbnail'].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(next, key) || matched || hasFrozenImage) next[key] = update.imageUrl;
    });
    ['imageUrls', 'images', 'photos', 'gallery'].forEach((key) => {
      if (Array.isArray(next[key])) next[key] = update.imageUrls.slice();
    });
    return next;
  });
}

async function syncPreparedCentralImagesBeforePublish(db, snapshot, actor = '固定四通路流程 v3') {
  const references = preparedImageReferenceCases(snapshot);
  if (!references.length) throw new Error('完成圖快照沒有可回寫的中央商品。');
  const documents = await Promise.all(references.map(async (reference) => {
    const productRef = db.collection(PRODUCT_COLLECTION).doc(reference.productId);
    const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(reference.productId);
    const productSnap = await productRef.get();
    if (!productSnap.exists) throw new Error(`${reference.sku || reference.productId}的中央商品已不存在。`);
    const productRecord = productSnap.data() || {};
    const update = centralCompletedImageUpdate(snapshot, reference.productId, productRecord);
    if (!safeHttpUrl(update.imageUrl) || !normalizeUrls(update.imageUrls, 100).length) {
      throw new Error(`${reference.sku || reference.productId}缺少可回寫的 cleanMain／variantRepresentative 完成圖。`);
    }
    return { reference, productRef, caseRef, productRecord, update };
  }));
  const frozenSources = frozenSourceImageUrls(snapshot);
  const completedBySku = new Map(documents.map((row) => [normalizeSku(row.reference.sku), row.update]).filter((row) => row[0]));
  const batch = db.batch();
  documents.forEach((row) => {
    const imageUrls = normalizeUrls(row.update.imageUrls, 100);
    if (imageUrls.some((url) => frozenSources.has(url))) throw new Error(`${row.reference.sku || row.reference.productId}的中央商品完成圖仍包含來源原圖。`);
    const variants = completedVariantRecords(row.productRecord, completedBySku, row.update, frozenSources);
    const productUpdate = {
      imageUrl: row.update.imageUrl,
      imageUrls,
      parentImageUrls: [],
      variantImageUrls: [],
      completedListingImageUrls: normalizeUrls(row.update.completedListingImageUrls || imageUrls, 100),
      imageSource: 'localized-clean-main',
      completedListingImagesUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: actor
    };
    if (variants) productUpdate.variants = variants;
    batch.set(row.productRef, productUpdate, { merge: true });
    batch.set(row.caseRef, {
      centralImageReferenceVerification: {
        status: 'verified', cleanMainUrl: row.update.imageUrl, imageUrls,
        representativeSourceImageUrl: row.reference.representativeSourceImageUrl || '',
        representativeCompletedImageUrl: row.reference.representativeCompletedImageUrl || '',
        verifiedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      sourceImageRetentionPolicy: {
        mode: 'retain-source-binaries-fast-validation', sourceBinaryCleanupRequired: false,
        cleanupStatus: 'retained', cleanupWorkerRequired: false, eligibleForDeletion: false
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: actor
    }, { merge: true });
  });
  await batch.commit();
  const verified = await Promise.all(documents.map(async (row) => {
    const [productSnap, caseSnap] = await Promise.all([row.productRef.get(), row.caseRef.get()]);
    const productRecord = productSnap.exists ? productSnap.data() || {} : {};
    const caseRecord = caseSnap.exists ? caseSnap.data() || {} : {};
    const central = caseRecord.centralImageReferenceVerification && typeof caseRecord.centralImageReferenceVerification === 'object'
      ? caseRecord.centralImageReferenceVerification : {};
    const productImages = collectImageUrls(productRecord, false);
    if (safeHttpUrl(productRecord.imageUrl) !== safeHttpUrl(row.update.imageUrl)
      || !productImages.includes(safeHttpUrl(row.update.imageUrl))
      || productImages.some((url) => frozenSources.has(url))
      || clean(central.status).toLowerCase() !== 'verified'
      || safeHttpUrl(central.cleanMainUrl) !== safeHttpUrl(row.update.imageUrl)) {
      throw new Error(`${row.reference.sku || row.reference.productId}的繁體完成圖回寫後重讀不一致，尚未操作任何平台。`);
    }
    return { productId: row.reference.productId, sku: row.reference.sku, imageUrl: row.update.imageUrl, imageUrls: normalizeUrls(row.update.imageUrls, 100) };
  }));
  return { verified: true, products: verified };
}

function validateAllPlatformImageReceipts(snapshot, stages) {
  const source = stages && typeof stages === 'object' ? stages : {};
  const reasons = [];
  const receipts = {};
  PLATFORM_EXECUTION_ORDER.forEach((stage) => {
    const state = source[stage] && typeof source[stage] === 'object' ? source[stage] : {};
    const receipt = state.receipt && typeof state.receipt === 'object' ? state.receipt : {};
    if (clean(state.status).toLowerCase() !== 'verified') reasons.push(`${stage}:stage-not-verified`);
    const verification = validatePlatformStageVerification(stage, snapshot || {}, receipt);
    receipts[stage] = verification.receipt;
    verification.reasons.forEach((reason) => reasons.push(`${stage}:${reason}`));
  });
  return { verified: reasons.length === 0, reasons: Array.from(new Set(reasons)), receipts };
}

function validateCompletionImageReferences(snapshot, records, stages = null) {
  const plan = snapshot && snapshot.platformImagePlan && typeof snapshot.platformImagePlan === 'object'
    ? snapshot.platformImagePlan : {};
  const reasons = platformImagePlanMissingFields(plan, { requireFinalized: true }).map((field) => `platform-image-plan:${field}`);
  const roleRows = Array.isArray(plan.roleAssignments) ? plan.roleAssignments : [];
  const roleRowsFor = (productId, url, sourceUrl) => roleRows.filter((row) => {
    if (productId && clean(row && row.productId) !== clean(productId)) return false;
    if (url && safeHttpUrl(row && row.url) !== safeHttpUrl(url)) return false;
    if (sourceUrl && safeHttpUrl(row && row.sourceImageUrl) !== safeHttpUrl(sourceUrl)) return false;
    return true;
  });
  const isCleanRole = (row) => cleanRepresentativeRoleRow(row);
  const references = preparedImageReferenceCases(snapshot);
  const frozenSources = frozenSourceImageUrls(snapshot);
  if (!references.length) reasons.push('missing-image-reference-cases');
  const recordsByProductId = new Map((Array.isArray(records) ? records : []).map((row) => [clean(row && row.productId), row]));
  references.forEach((reference) => {
    const record = recordsByProductId.get(reference.productId) || {};
    const caseRecord = record.caseRecord && typeof record.caseRecord === 'object' ? record.caseRecord : {};
    const productRecord = record.productRecord && typeof record.productRecord === 'object' ? record.productRecord : {};
    const central = caseRecord.centralImageReferenceVerification && typeof caseRecord.centralImageReferenceVerification === 'object'
      ? caseRecord.centralImageReferenceVerification : {};
    const centralUrl = safeHttpUrl(central.cleanMainUrl);
    const productImages = collectImageUrls(productRecord, false).slice(0, 1000);
    if (productImages.some((url) => frozenSources.has(url))) reasons.push(`${reference.productId}:central-or-variant-image-still-frozen-source`);
    if (centralUrl && frozenSources.has(centralUrl)) reasons.push(`${reference.productId}:central-verification-still-frozen-source`);
    if (clean(central.status).toLowerCase() !== 'verified') reasons.push(`${reference.productId}:central-image-not-verified`);
    const centralRows = roleRowsFor(reference.productId, centralUrl, '');
    if (!centralUrl || !centralRows.some(isCleanRole)) reasons.push(`${reference.productId}:central-image-not-clean-role-output`);
    if (!centralUrl || safeHttpUrl(productRecord.imageUrl) !== centralUrl || !productImages.includes(centralUrl)) {
      reasons.push(`${reference.productId}:central-product-image-reference-mismatch`);
    }
    if (reference.representativeSourceImageUrl) {
      const representativeRows = roleRowsFor(reference.productId, reference.representativeCompletedImageUrl, reference.representativeSourceImageUrl);
      if (!reference.representativeCompletedImageUrl || !representativeRows.some(isCleanRole)) {
        reasons.push(`${reference.productId}:variant-representative-not-clean-role-output`);
      } else if (!productImages.includes(reference.representativeCompletedImageUrl)) {
        reasons.push(`${reference.productId}:variant-representative-not-in-central-images`);
      }
    }
  });
  if (stages) {
    const platformVerification = validateAllPlatformImageReceipts(snapshot, stages);
    reasons.push(...platformVerification.reasons);
  } else {
    reasons.push('missing-all-platform-image-receipts');
  }
  return { verified: reasons.length === 0, reasons: Array.from(new Set(reasons)), references };
}

async function publishEasyStoreStage(db, jobId, snapshot, product, dependencies = {}) {
  const token = clean(Object.prototype.hasOwnProperty.call(dependencies, 'easyStoreToken')
    ? dependencies.easyStoreToken : EASYSTORE_ACCESS_TOKEN.value());
  if (!token) throw new Error('尚未設定 EASYSTORE_ACCESS_TOKEN。');
  const upsert = dependencies.upsertEasyStoreProduct || upsertEasyStoreProduct;
  const verify = dependencies.verifyEasyStorePublishedListing || verifyEasyStorePublishedListing;
  const result = await upsert(snapshot, product, token);
  const receipt = await verify(snapshot, token, result);
  const productId = clean(snapshot.productId);
  const productRef = db.collection(PRODUCT_COLLECTION).doc(productId);
  const previousMappings = product.platformMappings && typeof product.platformMappings === 'object' ? product.platformMappings : {};
  const centralImageUpdate = centralCompletedImageUpdate(snapshot, productId, product);
  await productRef.set({
    sourceCollection: 'EasyStore API', sourceProductId: result.productId, sourceVariantId: result.variantIds[0] || '',
    onlineName: snapshot.title, onlinePrice: snapshot.easyStorePrice,
    ...centralImageUpdate,
    easyStoreListingImageUrls: normalizeUrls(snapshot.images, 20),
    easyStoreMatched: true, easyStoreMatchStatus: 'matched',
    platformMappings: {
      ...previousMappings,
      easyStore: { ...(previousMappings.easyStore || {}), productId: result.productId, variantIds: result.variantIds }
    },
    variantGroup: snapshot.variantGroupEnabled === true ? {
      rootProductId: snapshot.productId, rootSku: snapshot.sku,
      attributeName: snapshot.variantGroupAttributeName,
      items: (snapshot.variantGroupVariants || []).map((row, index) => ({
        productId: row.productId, sku: row.sku, attributeValue: row.attributeValue,
        imageUrl: row.imageUrl, variantId: result.variantIds[index] || ''
      }))
    } : snapshot.listingMode === 'add-variant' ? {
      parentProductId: snapshot.variantParentProductId, parentSku: snapshot.variantParentSku,
      parentName: snapshot.variantParentName, attributeName: snapshot.variantAttributeName,
      parentAttributeValue: snapshot.variantParentAttributeValue, attributeValue: snapshot.variantAttributeValue
    } : null,
    easyStoreSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '商品上架'
  }, { merge: true });
  if (snapshot.variantGroupEnabled === true) {
    await Promise.all((snapshot.variantGroupVariants || []).map(async (row, index) => {
      if (clean(row && row.productId) === productId) return;
      const variantProductRef = db.collection(PRODUCT_COLLECTION).doc(clean(row && row.productId));
      const variantProductSnap = await variantProductRef.get();
      const variantProduct = variantProductSnap.exists ? (variantProductSnap.data() || {}) : {};
      const variantMappings = variantProduct.platformMappings && typeof variantProduct.platformMappings === 'object'
        ? variantProduct.platformMappings : {};
      return variantProductRef.set({
        sourceCollection: 'EasyStore API', sourceProductId: result.productId,
        sourceVariantId: result.variantIds[index] || '', onlineName: snapshot.title,
        onlinePrice: numberOrNull(row && row.easyStorePrice), easyStoreMatched: true,
        easyStoreMatchStatus: 'matched', easyStoreListingImageUrls: normalizeUrls(snapshot.images, 20),
        platformMappings: {
          ...variantMappings,
          easyStore: {
            ...(variantMappings.easyStore || {}),
            productId: result.productId,
            variantIds: [result.variantIds[index] || ''].filter(Boolean)
          }
        },
        variantGroup: {
          rootProductId: snapshot.productId, rootSku: snapshot.sku,
          attributeName: snapshot.variantGroupAttributeName, attributeValue: clean(row && row.attributeValue)
        },
        easyStoreSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '商品上架'
      }, { merge: true });
    }));
  }
  return {
    result,
    receipt,
    platform: {
      status: result.action === 'created' ? 'created' : 'updated',
      message: (result.action === 'variant-created' ? 'EasyStore 已在既有商品中建立新細項。'
        : result.action === 'variant-updated' ? 'EasyStore 既有細項已更新。'
          : result.action === 'created' ? 'EasyStore 商品已建立。' : 'EasyStore 商品已更新。') + (result.imageWarning || ''),
      productId: result.productId, variantIds: result.variantIds, verification: receipt
    },
    autofillPayload: buildShopeeAutofillPayload(snapshot, result, {
      jobId,
      snapshotFingerprint: listingSnapshotFingerprint(snapshot)
    })
  };
}

async function publishEasyStoreStageWithRetry(db, jobId, snapshot, product, dependencies = {}) {
  const delays = dependencies.retryDelays || [0, 3000, 10000, 30000];
  let lastError = null;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await wait(delays[attempt]);
    try {
      return await publishEasyStoreStage(db, jobId, snapshot, product, dependencies);
    } catch (error) {
      lastError = error;
      if (!isTransientListingPublishFailure(error) || attempt === delays.length - 1) break;
    }
  }
  throw lastError || new Error('EasyStore 上架失敗。');
}

async function applyVerifiedQueueReceipt(db, queueId, queueRecord, dependencies = {}) {
  const record = queueRecord && typeof queueRecord === 'object' ? queueRecord : {};
  const jobId = clean(record.jobId);
  if (!jobId || clean(record.workflowVersion) !== LISTING_WORKFLOW_ID) return { status: 'ignored-legacy-or-unversioned-queue' };
  const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
  const initialJobSnap = await jobRef.get();
  if (!initialJobSnap.exists) return { status: 'ignored-missing-job' };
  const initialJob = { ...(initialJobSnap.data() || {}), id: jobId };
  const initialVerification = validateQueuedStageReceipt(initialJob, record);
  if (!initialVerification.verified) {
    console.warn('[applyVerifiedQueueReceipt] ignored receipt', { queueId, jobId, reasons: initialVerification.reasons });
    return { status: 'ignored-unverified-receipt', reasons: initialVerification.reasons };
  }
  const productId = clean(initialJob.productId);
  const productRef = db.collection(PRODUCT_COLLECTION).doc(productId);
  const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(productId);
  let updatedJob = null;
  let alreadyCompleted = false;
  await db.runTransaction(async (transaction) => {
    const latestSnap = await transaction.get(jobRef);
    if (!latestSnap.exists) return;
    const latest = { ...(latestSnap.data() || {}), id: jobId };
    if (clean(latest.currentStage) === 'completed') {
      updatedJob = latest;
      alreadyCompleted = true;
      return;
    }
    const verification = validateQueuedStageReceipt(latest, record);
    if (!verification.verified) return;
    const stages = latest.stages && typeof latest.stages === 'object' ? { ...latest.stages } : initialListingStages();
    const stage = verification.stage;
    stages[stage] = {
      ...(stages[stage] || {}), status: 'verified', receipt: verification.receipt,
      queueId: clean(queueId), attemptToken: clean(record.attemptToken), fingerprint: clean(record.fingerprint)
    };
    const platforms = {
      ...(latest.platforms || {}),
      [stage]: { status: 'completed', message: `${stage === 'momo' ? 'MOMO' : '酷澎'} 已由正式清單核對完成。` }
    };
    const currentStage = deriveListingCurrentStage(stages);
    const status = currentStage === 'finalizing' ? 'running' : overallPublishStatus(platforms);
    updatedJob = { ...latest, status, currentStage, stages, platforms: summarizePlatformsForStorage(platforms) };
    transaction.set(jobRef, {
      status, currentStage, stages, platforms: updatedJob.platforms,
      transitionToken: '',
      stageRevision: Math.max(1, Number(latest.stageRevision) || 1) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  if (!updatedJob) return { status: 'ignored-stale-queue-receipt' };
  if (alreadyCompleted) return { status: 'already-completed', jobId, currentStage: 'completed' };
  const productSnap = await productRef.get();
  if (!productSnap.exists) throw new Error('中央商品主檔已不存在，不會建立替代商品。');
  const product = productSnap.data() || {};
  const updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await caseRef.set({
    caseStatus: 'submitted',
    publishState: {
      jobId, status: updatedJob.status, currentStage: updatedJob.currentStage, stages: updatedJob.stages,
      platforms: updatedJob.platforms,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(), submittedBy: '固定四通路 queue receipt'
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '固定四通路流程 v3'
  }, { merge: true });
  await productRef.set({
    platformListingStatus: platformListingStatusFromPublish(product.platformListingStatus, updatedJob.platforms),
    platformListingStatusUpdatedAt: updatedAt, updatedAt, updatedBy: '固定四通路流程 v3'
  }, { merge: true });
  const finalized = await finalizeListingJobIfReady(
    db,
    jobId,
    clean(dependencies.actor) || '固定四通路 queue receipt'
  );
  if (['completed', 'already-completed', 'blocked-image-reference-verification'].includes(clean(finalized && finalized.status))) return finalized;
  return {
    status: `${initialVerification.stage}-verified`, jobId,
    currentStage: updatedJob.currentStage, stages: updatedJob.stages
  };
}

function sameOrderedStrings(left, right) {
  const a = Array.isArray(left) ? left.map(clean) : [];
  const b = Array.isArray(right) ? right.map(clean) : [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function activeV3JobReuseBlockers(candidate, productId, listingCase) {
  const job = candidate && typeof candidate === 'object' ? candidate : {};
  const snapshot = job.preparedSnapshot && typeof job.preparedSnapshot === 'object' ? job.preparedSnapshot : {};
  const policy = snapshot.automationPolicy && typeof snapshot.automationPolicy === 'object' ? snapshot.automationPolicy : {};
  const frozen = listingCase && listingCase.codexHandoff && listingCase.codexHandoff.preflightSnapshot
    && typeof listingCase.codexHandoff.preflightSnapshot === 'object'
    ? listingCase.codexHandoff.preflightSnapshot : {};
  const reasons = [];
  if (clean(job.workflowVersion) !== LISTING_WORKFLOW_ID) reasons.push('workflow-version-mismatch');
  if (Number(job.schemaVersion) !== LISTING_JOB_SCHEMA_VERSION) reasons.push('job-schema-version-mismatch');
  if (clean(job.productId) !== clean(productId) || clean(snapshot.productId) !== clean(productId)) reasons.push('product-mismatch');
  if (!sameOrderedStrings(job.platformOrder, PLATFORM_EXECUTION_ORDER)) reasons.push('job-platform-order-mismatch');
  if (Number(policy.version) !== LISTING_AUTOMATION_POLICY_VERSION
    || clean(policy.workflowId) !== LISTING_WORKFLOW_ID
    || !sameOrderedStrings(policy.platformExecutionPlan && policy.platformExecutionPlan.order, PLATFORM_EXECUTION_ORDER)
    || JSON.stringify(compactObject(policy)) !== JSON.stringify(compactObject(listingAutomationPolicy()))) {
    reasons.push('automation-policy-mismatch');
  }
  if (!snapshot || !Object.keys(snapshot).length) reasons.push('missing-prepared-snapshot');
  if (!clean(job.preparedSnapshotFingerprint)
    || clean(job.preparedSnapshotFingerprint) !== listingSnapshotFingerprint(snapshot)) reasons.push('prepared-snapshot-fingerprint-mismatch');
  const imagePlan = snapshot.platformImagePlan && typeof snapshot.platformImagePlan === 'object' ? snapshot.platformImagePlan : {};
  if (platformImagePlanMissingFields(imagePlan, { requireFinalized: true }).length) reasons.push('finalized-image-plan-invalid');
  if (clean(frozen.workflowVersion) !== LISTING_WORKFLOW_ID || !clean(frozen.snapshotId)) reasons.push('case-frozen-input-invalid');
  if (clean(imagePlan.inputSnapshotId) !== clean(frozen.snapshotId)
    || clean(imagePlan.inputSnapshotFingerprint) !== frozenInputSnapshotFingerprint(frozen)) reasons.push('case-frozen-input-mismatch');
  const currentStage = clean(job.currentStage);
  const allowedStages = ['parallel-platforms', 'shopee', 'finalizing'];
  if (!allowedStages.includes(currentStage)) reasons.push('invalid-active-stage');
  const stages = job.stages && typeof job.stages === 'object' ? job.stages : {};
  PLATFORM_EXECUTION_ORDER.forEach((stage) => {
    const state = stages[stage] && typeof stages[stage] === 'object' ? stages[stage] : {};
    if (clean(state.status).toLowerCase() !== 'verified') return;
    const verification = validatePlatformStageVerification(stage, snapshot, state.receipt);
    if (!verification.verified) reasons.push(`${stage}-receipt-invalid`);
  });
  const shopeeState = stages.shopee && typeof stages.shopee === 'object' ? stages.shopee : {};
  if (!['blocked-by-dependency', 'ready'].includes(clean(shopeeState.status).toLowerCase())
    && !listingStageVerified(stages, 'easyStore')) reasons.push('shopee-dependency-not-verified');
  return Array.from(new Set(reasons));
}

const PRODUCT_LISTING_PUBLISH_OPTIONS = {
  region: REGION,
  timeoutSeconds: 540,
  memory: '512MiB',
  secrets: [EASYSTORE_ACCESS_TOKEN],
  enforceAppCheck: false
};

function codexAutoPublishGrant(listingCase) {
  const handoff = listingCase && listingCase.codexHandoff && typeof listingCase.codexHandoff === 'object'
    ? listingCase.codexHandoff : {};
  const frozen = handoff.preflightSnapshot && typeof handoff.preflightSnapshot === 'object'
    ? handoff.preflightSnapshot : {};
  const grant = handoff.autoPublishAuthorization && typeof handoff.autoPublishAuthorization === 'object'
    ? handoff.autoPublishAuthorization : {};
  const email = clean(grant.grantedByEmail).toLowerCase();
  if (clean(handoff.workflowVersion) !== LISTING_WORKFLOW_ID
    || clean(frozen.workflowVersion) !== LISTING_WORKFLOW_ID
    || clean(grant.workflowVersion) !== LISTING_WORKFLOW_ID
    || clean(grant.scope) !== 'fixed-v3-four-channel-publish'
    || grant.granted !== true
    || grant.noSecondConfirmation !== true
    || !clean(frozen.snapshotId)
    || clean(grant.snapshotId) !== clean(frozen.snapshotId)
    || !ADMIN_EMAILS.has(email)) return null;
  return { email, snapshotId: clean(frozen.snapshotId), scope: clean(grant.scope) };
}

function codexAutoPublishInputFingerprint(listingCase) {
  const handoff = listingCase && listingCase.codexHandoff && typeof listingCase.codexHandoff === 'object'
    ? listingCase.codexHandoff : {};
  const frozen = handoff.preflightSnapshot && typeof handoff.preflightSnapshot === 'object'
    ? handoff.preflightSnapshot : {};
  return listingSnapshotFingerprint({
    workflowVersion: clean(handoff.workflowVersion),
    snapshotId: clean(frozen.snapshotId),
    frozenInputFingerprint: frozenInputSnapshotFingerprint(frozen),
    generatedListingImages: Array.isArray(listingCase && listingCase.generatedListingImages)
      ? listingCase.generatedListingImages : [],
    listingImageUrls: normalizeUrls(listingCase && listingCase.listingImageUrls, 20),
    researchedProductName: clean(listingCase && listingCase.researchedProductName),
    productDescription: clean(listingCase && listingCase.productDescription),
    prices: {
      shared: numberOrNull(listingCase && listingCase.sharedOnlinePrice),
      easyStore: numberOrNull(listingCase && listingCase.easyStorePrice),
      shopee: numberOrNull(listingCase && listingCase.shopeePrice),
      coupang: numberOrNull(listingCase && listingCase.coupangPrice),
      momo: numberOrNull(listingCase && listingCase.momoPrice)
    },
    stock: numberOrNull(listingCase && listingCase.stock),
    shippingDecision: clean(listingCase && listingCase.shippingDecision),
    packageLengthCm: numberOrNull(listingCase && listingCase.packageLengthCm),
    packageWidthCm: numberOrNull(listingCase && listingCase.packageWidthCm),
    packageHeightCm: numberOrNull(listingCase && listingCase.packageHeightCm),
    packageWeightKg: numberOrNull(listingCase && listingCase.packageWeightKg),
    listingMode: clean(listingCase && listingCase.listingMode),
    variantGroupItems: Array.isArray(listingCase && listingCase.variantGroupItems) ? listingCase.variantGroupItems : []
  });
}

function isTransientListingPublishFailure(value) {
  const message = clean(value && value.message ? value.message : value).toLowerCase();
  if (!message) return false;
  if (/otp|驗證碼|captcha|登入失效|login expired|permission-denied|明確拒絕|必填資料/.test(message)) return false;
  return /\b(408|425|429|500|502|503|504)\b|timeout|timed out|network|temporar|暫時|逾時|圖片.*(讀不到|處理中|失敗)|image.*(fetch|processing|unavailable|failed)/.test(message);
}

function publishResultFailureMessage(result) {
  if (!result || result.ok !== false) return '';
  const rows = result.platforms && typeof result.platforms === 'object' ? Object.values(result.platforms) : [];
  return rows.map((row) => clean(row && row.message)).filter(Boolean).join('；') || clean(result.status) || '發布未完成';
}

async function publishProductListingCaseHandler(request) {

    if (!isAllowedManager(request)) throw new HttpsError('permission-denied', '請先使用管理者帳號登入。');
    const productId = clean(request && request.data && request.data.productId);
    if (!productId || productId.length > 200 || productId.includes('/')) throw new HttpsError('invalid-argument', '商品 ID 格式不正確。');
    const db = admin.firestore();
    const productRef = db.collection(PRODUCT_COLLECTION).doc(productId);
    const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(productId);
    const [productSnap, caseSnap] = await Promise.all([productRef.get(), caseRef.get()]);
    if (!productSnap.exists) throw new HttpsError('not-found', '找不到中央商品主檔。');
    if (!caseSnap.exists) throw new HttpsError('failed-precondition', '請先儲存商品上架資料。');
    const product = productSnap.data() || {};
    let listingCase = caseSnap.data() || {};
    const priorJobId = clean(request && request.data && request.data.jobId)
      || clean(listingCase.publishState && listingCase.publishState.jobId);
    let reusableJob = null;
    let reusableJobRef = null;
    if (priorJobId && !priorJobId.includes('/')) {
      const candidateRef = db.collection(JOB_COLLECTION).doc(priorJobId);
      const candidateSnap = await candidateRef.get();
      const candidate = candidateSnap.exists ? candidateSnap.data() || {} : {};
      if (candidateSnap.exists && clean(candidate.workflowVersion) === LISTING_WORKFLOW_ID
        && clean(candidate.currentStage) !== 'completed') {
        const reuseBlockers = activeV3JobReuseBlockers(candidate, productId, listingCase);
        if (reuseBlockers.length) {
          await candidateRef.set({
            status: 'superseded-by-current-v3-handoff',
            currentStage: 'superseded',
            supersededBySnapshotId: clean(listingCase.codexHandoff && listingCase.codexHandoff.preflightSnapshot && listingCase.codexHandoff.preflightSnapshot.snapshotId),
            supersededReasons: reuseBlockers,
            supersededAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } else {
          reusableJob = candidate;
          reusableJobRef = candidateRef;
        }
      }
    }
    if (reusableJob && clean(reusableJob.currentStage) === 'finalizing') {
      const finalizing = await finalizeListingJobIfReady(
        db,
        reusableJobRef.id,
        clean(request.auth && request.auth.token && request.auth.token.email) || '管理者'
      );
      return { ok: finalizing.status !== 'blocked-image-reference-verification', resumed: true, ...finalizing };
    }
    if (reusableJob && listingStageVerified(reusableJob.stages || {}, 'easyStore')) {
      const resumedStages = reusableJob.stages && typeof reusableJob.stages === 'object' ? reusableJob.stages : initialListingStages();
      const resumedPlatforms = reusableJob.platforms && typeof reusableJob.platforms === 'object' ? { ...reusableJob.platforms } : {};
      if (!listingStageVerified(resumedStages, 'shopee')) {
        const easyStoreStage = resumedStages.easyStore && typeof resumedStages.easyStore === 'object' ? resumedStages.easyStore : {};
        resumedPlatforms.shopee = {
          status: 'waiting-easystore-sync',
          message: '沿用同一份 immutable 快照與 EasyStore 商品，等待蝦皮正式清單核對。',
          autofillPayload: buildShopeeAutofillPayload(reusableJob.preparedSnapshot, {
            productId: clean(easyStoreStage.productId),
            variantIds: Array.isArray(easyStoreStage.variantIds) ? easyStoreStage.variantIds : []
          }, {
            jobId: reusableJobRef.id,
            snapshotFingerprint: clean(reusableJob.preparedSnapshotFingerprint)
          })
        };
      }
      return {
        ok: true, resumed: true, productId, jobId: reusableJobRef.id,
        status: clean(reusableJob.status) || 'submitted', currentStage: deriveListingCurrentStage(resumedStages),
        stages: resumedStages, platforms: resumedPlatforms
      };
    }
    let snapshot = reusableJob ? reusableJob.preparedSnapshot : null;
    let preflightMissing = reusableJob && reusableJob.preflightMissing && typeof reusableJob.preflightMissing === 'object'
      ? reusableJob.preflightMissing : null;
    if (!snapshot) {
      let finalizedMedia;
      try {
        finalizedMedia = await loadFinalPreparedMediaSnapshot(db, productId, listingCase);
      } catch (error) {
        throw new HttpsError('failed-precondition', `完成圖最終預檢未通過：${clean(error && error.message) || '無法從凍結來源建立完成圖快照。'}`);
      }
      listingCase = finalizedMedia.rootListingCase || listingCase;
      let variantParentProduct = null;
      let variantParentListingCase = null;
      let variantGroupContext = null;
      if (clean(listingCase.listingMode) === 'add-variant') {
        const parentId = clean(listingCase.variantParentProductId);
        if (!parentId || parentId === productId || parentId.includes('/')) throw new HttpsError('failed-precondition', '請選擇另一個有效的父商品。');
        const [parentSnap, parentCaseSnap] = await Promise.all([
          db.collection(PRODUCT_COLLECTION).doc(parentId).get(),
          db.collection(LISTING_CASE_COLLECTION).doc(parentId).get()
        ]);
        if (!parentSnap.exists) throw new HttpsError('failed-precondition', '選定的父商品已不存在，請重新選擇。');
        variantParentProduct = parentSnap.data() || {};
        variantParentListingCase = finalizedMedia.currentCases.get(parentId)
          || (parentCaseSnap.exists ? parentCaseSnap.data() || {} : {});
      }
      if (clean(listingCase.listingMode) !== 'add-variant' && listingCase.variantGroupEnabled === true) {
        const itemIds = (Array.isArray(listingCase.variantGroupItems) ? listingCase.variantGroupItems : [])
          .map((item) => clean(item && item.productId)).filter(Boolean);
        if (new Set(itemIds).size !== itemIds.length || itemIds.includes(productId)) {
          throw new HttpsError('failed-precondition', '同款多細項案件含有重複的商品；尚未操作任何平台。');
        }
        const childSnaps = await Promise.all(itemIds.map((id) => db.collection(PRODUCT_COLLECTION).doc(id).get()));
        variantGroupContext = new Map([[productId, { product, listingCase }]]);
        childSnaps.forEach((childSnap, index) => {
          const childId = itemIds[index];
          if (!childSnap.exists) throw new HttpsError('failed-precondition', `同款細項 ${childId} 的中央商品已不存在；尚未操作任何平台。`);
          const childCase = finalizedMedia.currentCases.get(childId);
          if (!childCase) throw new HttpsError('failed-precondition', `同款細項 ${childId} 缺少目前 v3 案件；尚未操作任何平台。`);
          variantGroupContext.set(childId, { product: childSnap.data() || {}, listingCase: childCase });
        });
      }
      snapshot = buildListingSnapshot(
        productId, product, listingCase, variantParentProduct, variantParentListingCase,
        finalizedMedia.preparedMediaSnapshot, variantGroupContext
      );
      await syncPreparedCentralImagesBeforePublish(db, snapshot, '固定四通路流程 v3 圖片回寫');
      if (!snapshot.enabledEasyStoreShopee || !snapshot.enabledMomo || !snapshot.enabledCoupang) {
        throw new HttpsError('failed-precondition', '固定新版流程必須同時發布 EasyStore、蝦皮、酷澎與 MOMO，不接受舊的通路勾選或第二套路徑。');
      }
      const representativeMissing = variantRepresentativeMissingFields(snapshot);
      if (representativeMissing.length) {
        throw new HttpsError('failed-precondition', `細項代表圖尚未完成繁體化：${representativeMissing.join('、')}。請先完成圖片處理；系統不會直接使用簡體原圖。`);
      }
      const shopeeLogistics = buildShopeeLogistics(snapshot);
      preflightMissing = {
        content: snapshot.descriptionContentStatus && snapshot.descriptionContentStatus.ready
          ? [] : ['商品介紹（需包含可驗證的商品特色、使用方式／適用情境與商品規格；通用備援文案不算完成）'],
        images: platformImagePlanMissingFields(snapshot.platformImagePlan, { requireFinalized: true }),
        easyStore: easyStoreMissingFields(snapshot),
        shopee: [].concat(
          !snapshot.shopeeCategoryPath ? ['蝦皮分類'] : [],
          identityAllowsShopeeAutofill(snapshot.identityStatus, snapshot.identityManualConfirmed) ? [] : ['蝦皮商品身分／型號確認'],
          shopeeLogistics.requiresConfirmation ? ['蝦皮物流（包裝尺寸、重量或配送方式尚未能安全判定）'] : []
        ),
        coupang: coupangMissingFields(snapshot),
        momo: momoMissingFields(snapshot)
      };
      const missingSummary = Object.entries(preflightMissing)
        .filter(([, rows]) => rows.length)
        .map(([platform, rows]) => `${platform}：${rows.join('、')}`);
      if (missingSummary.length) {
        throw new HttpsError('failed-precondition', `四通路單次預檢未通過；尚未操作任何平台。${missingSummary.join('；')}`);
      }
    }
    const jobRef = reusableJobRef || db.collection(JOB_COLLECTION).doc();
    const jobId = jobRef.id;
    const createdBy = clean(request.auth && request.auth.token && request.auth.token.email) || '管理者';
    const platforms = reusableJob && reusableJob.platforms && typeof reusableJob.platforms === 'object' ? { ...reusableJob.platforms } : {};
    const stages = reusableJob && reusableJob.stages && typeof reusableJob.stages === 'object' ? { ...reusableJob.stages } : initialListingStages();
    let currentStage = reusableJob ? clean(reusableJob.currentStage) : 'parallel-platforms';
    let lockStatus = 'failed';
    await acquirePublishLock(db, caseRef, jobId, createdBy);
    try {
      if (reusableJob) {
        await jobRef.set({
          status: 'running', resumedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        await jobRef.set({
          jobNo: `PUB-${Date.now()}`, type: 'productListingPublish', status: 'running', dryRun: false,
          productId, productSku: snapshot.sku, productName: snapshot.title,
          workflowVersion: snapshot.automationPolicy.workflowId,
          platformOrder: snapshot.automationPolicy.platformExecutionPlan.order,
          preparedSnapshot: snapshot,
          preparedSnapshotFingerprint: listingSnapshotFingerprint(snapshot),
          preflightMissing,
          currentStage,
          stages,
          stageRevision: 1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(), schemaVersion: LISTING_JOB_SCHEMA_VERSION
        });
      }

      const operations = [];
      [
        { stage: 'momo', platform: 'MOMO', missing: momoMissingFields(snapshot) },
        { stage: 'coupang', platform: 'Coupang', missing: coupangMissingFields(snapshot) }
      ].forEach((entry) => {
        const state = stages[entry.stage] && typeof stages[entry.stage] === 'object' ? stages[entry.stage] : {};
        const status = clean(state.status).toLowerCase();
        if (['awaiting-verification', 'verified'].includes(status)) {
          if (status === 'verified') platforms[entry.stage] = { status: 'completed' };
          return;
        }
        const attemptToken = clean(state.attemptToken) || crypto.randomBytes(16).toString('hex');
        const fingerprint = platformStageFingerprint(entry.platform, snapshot);
        stages[entry.stage] = { ...state, status: 'queueing', attemptToken, fingerprint };
        operations.push({
          stage: entry.stage,
          kind: 'queue',
          attemptToken,
          fingerprint,
          run: () => queueFixedIpPlatform(db, jobId, entry.platform, snapshot, product, entry.missing, attemptToken)
        });
      });
      const easyStoreState = stages.easyStore && typeof stages.easyStore === 'object' ? stages.easyStore : {};
      if (!listingStageVerified(stages, 'easyStore')) {
        stages.easyStore = { ...easyStoreState, status: 'processing' };
        operations.push({
          stage: 'easyStore',
          kind: 'easyStore',
          run: () => publishEasyStoreStageWithRetry(db, jobId, snapshot, product)
        });
      }
      currentStage = 'parallel-platforms';
      await jobRef.set({
        status: 'running', currentStage, stages,
        executionMode: 'staggered-parallel',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const settled = await Promise.all(operations.map(async (operation) => {
        try {
          return { operation, ok: true, value: await operation.run() };
        } catch (error) {
          return { operation, ok: false, error };
        }
      }));
      settled.forEach((row) => {
        const { operation } = row;
        if (operation.kind === 'queue') {
          if (!row.ok) {
            const message = clean(row.error && row.error.message).slice(0, 800) || `${operation.stage} 排隊失敗。`;
            stages[operation.stage] = { ...(stages[operation.stage] || {}), status: 'failed', message };
            platforms[operation.stage] = { status: 'failed', message };
            return;
          }
          const queued = row.value || {};
          const queueBlocked = ['missing-fields', 'action-required'].includes(clean(queued.status));
          stages[operation.stage] = {
            ...(stages[operation.stage] || {}),
            status: queueBlocked ? clean(queued.status) : 'awaiting-verification',
            queueId: clean(queued.queueId), attemptToken: operation.attemptToken,
            fingerprint: clean(queued.fingerprint) || operation.fingerprint,
            message: clean(queued.message)
          };
          platforms[operation.stage] = queued;
          return;
        }
        if (!row.ok) {
          const message = clean(row.error && row.error.message).slice(0, 800) || 'EasyStore 上架失敗。';
          stages.easyStore = { status: 'failed', message };
          stages.shopee = { status: 'blocked-by-dependency', dependsOn: ['easyStore'], message: 'EasyStore 尚未完成。' };
          platforms.easyStore = { status: 'failed', message };
          platforms.shopee = { status: 'waiting-easystore', message: 'EasyStore 尚未完成，因此尚未送往蝦皮。' };
          return;
        }
        const easyStoreResult = row.value;
        platforms.easyStore = easyStoreResult.platform;
        platforms.shopee = {
          status: 'waiting-easystore-sync',
          message: `EasyStore 商品已完成；可啟動蝦皮助手自動填寫：${snapshot.shopeeCategoryPath}`,
          autofillPayload: easyStoreResult.autofillPayload
        };
        stages.easyStore = {
          status: 'verified', productId: easyStoreResult.result.productId,
          variantIds: easyStoreResult.result.variantIds, receipt: easyStoreResult.receipt
        };
        stages.shopee = { status: 'awaiting-verification', dependsOn: ['easyStore'] };
      });
      currentStage = deriveListingCurrentStage(stages);
      let status = overallPublishStatus(platforms);
      let platformsForStorage = summarizePlatformsForStorage(platforms);
      let completedDuringLaunch = false;
      await db.runTransaction(async (transaction) => {
        const latestSnap = await transaction.get(jobRef);
        if (!latestSnap.exists) return;
        const latest = latestSnap.data() || {};
        if (clean(latest.currentStage) === 'completed') {
          completedDuringLaunch = true;
          currentStage = 'completed';
          status = 'completed';
          Object.assign(stages, latest.stages || {});
          platformsForStorage = latest.platforms || platformsForStorage;
          return;
        }
        const latestStages = latest.stages && typeof latest.stages === 'object' ? latest.stages : {};
        PLATFORM_EXECUTION_ORDER.forEach((stage) => {
          if (listingStageVerified(latestStages, stage)) stages[stage] = latestStages[stage];
        });
        const latestPlatforms = latest.platforms && typeof latest.platforms === 'object' ? latest.platforms : {};
        PLATFORM_EXECUTION_ORDER.forEach((stage) => {
          if (listingStageVerified(stages, stage)) platforms[stage] = { ...(latestPlatforms[stage] || {}), status: 'completed' };
        });
        currentStage = deriveListingCurrentStage(stages);
        status = overallPublishStatus(platforms);
        platformsForStorage = summarizePlatformsForStorage(platforms);
        transaction.set(jobRef, {
          status, platforms: platformsForStorage, currentStage, stages,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });
      if (completedDuringLaunch) {
        lockStatus = 'completed';
        return { ok: true, productId, jobId, status, currentStage, stages, platforms: platformsForStorage };
      }
      const platformListingStatus = platformListingStatusFromPublish(product.platformListingStatus, platforms);
      await Promise.all([
        caseRef.set({
          caseStatus: status === 'completed' ? 'published' : 'submitted',
          shopeeCategoryPath: snapshot.shopeeCategoryPath,
          shopeeAttributeValues: snapshot.shopeeAttributeValues,
          publishState: { jobId, status, currentStage, stages, platforms: platformsForStorage, submittedAt: admin.firestore.FieldValue.serverTimestamp(), submittedBy: createdBy },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '商品上架', schemaVersion: 8
        }, { merge: true }),
        productRef.set({
          platformListingStatus,
          platformListingStatusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '商品上架工作'
        }, { merge: true }),
        db.collection('opsAuditLogs').add({
          action: '確認商品上架', entityType: 'productListingPublish', entityId: jobId,
          summary: `${snapshot.sku || productId}｜${snapshot.title}｜${status}`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy,
          version: LISTING_WORKFLOW_ID
        })
      ]);
      lockStatus = status;
      return { ok: !Object.values(platforms).some((row) => row.status === 'failed'), productId, jobId, status, currentStage, stages, platforms };
    } catch (error) {
      lockStatus = 'failed';
      await jobRef.set({
        status: 'failed', error: clean(error && error.message).slice(0, 800) || '商品上架工作未完成。',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(), failedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(() => null);
      throw error;
    } finally {
      try {
        await releasePublishLock(caseRef, jobId, lockStatus);
      } catch (error) {
        console.error('Unable to release product listing publish lock', { productId, jobId, message: clean(error && error.message) });
      }
    }
}

async function finalizeListingJobIfReady(db, jobId, actor) {
  const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
  const initialJobSnap = await jobRef.get();
  if (!initialJobSnap.exists) throw new HttpsError('not-found', '找不到這筆上架工作。');
  const initialJob = initialJobSnap.data() || {};
  const snapshot = initialJob.preparedSnapshot && typeof initialJob.preparedSnapshot === 'object' ? initialJob.preparedSnapshot : {};
  const productId = clean(initialJob.productId);
  const imageDocumentRefs = preparedImageReferenceCases(snapshot).map((reference) => ({
    ...reference,
    caseRef: db.collection(LISTING_CASE_COLLECTION).doc(reference.productId),
    productRef: db.collection(PRODUCT_COLLECTION).doc(reference.productId)
  }));
  let completedStages = null;
  let waitingStages = null;
  let waitingCurrentStage = '';
  let imageReferenceBlockers = [];
  let alreadyCompleted = false;
  await db.runTransaction(async (transaction) => {
    const latestSnap = await transaction.get(jobRef);
    if (!latestSnap.exists) return;
    const latest = latestSnap.data() || {};
    if (clean(latest.currentStage) === 'completed') {
      completedStages = latest.stages || {};
      alreadyCompleted = true;
      return;
    }
    const stages = latest.stages && typeof latest.stages === 'object' ? { ...latest.stages } : initialListingStages();
    if (!allListingStagesVerified(stages)) {
      waitingStages = stages;
      waitingCurrentStage = deriveListingCurrentStage(stages);
      return;
    }
    const imageDocuments = await Promise.all(imageDocumentRefs.map(async (reference) => {
      const [caseSnap, productSnap] = await Promise.all([
        transaction.get(reference.caseRef), transaction.get(reference.productRef)
      ]);
      return {
        productId: reference.productId,
        caseRecord: caseSnap.exists ? caseSnap.data() || {} : {},
        productRecord: productSnap.exists ? productSnap.data() || {} : {}
      };
    }));
    const referenceVerification = validateCompletionImageReferences(snapshot, imageDocuments, stages);
    if (!referenceVerification.verified) {
      imageReferenceBlockers = referenceVerification.reasons;
      return;
    }
    completedStages = stages;
    transaction.set(jobRef, {
      status: 'completed', currentStage: 'completed', stages,
      transitionToken: '', updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      finishedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    imageDocumentRefs.forEach((reference) => {
      transaction.set(reference.caseRef, {
        mediaReferencesVerified: true,
        sourceImageRetentionPolicy: {
          mode: 'retain-source-binaries-fast-validation',
          sourceBinaryCleanupRequired: false,
          cleanupWorkerRequired: false,
          cleanupStatus: 'retained',
          referencesVerified: true,
          eligibleForDeletion: false,
          verifiedJobId: jobId,
          verifiedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '固定四通路流程 v3'
      }, { merge: true });
    });
  });
  if (imageReferenceBlockers.length) {
    await jobRef.set({
      status: 'needs-input', currentStage: 'finalizing', imageReferenceBlockers,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { status: 'blocked-image-reference-verification', jobId, currentStage: 'finalizing', reasons: imageReferenceBlockers };
  }
  if (!completedStages) {
    return {
      status: 'waiting-other-platforms', jobId, productId,
      currentStage: waitingCurrentStage || deriveListingCurrentStage(waitingStages || {}),
      stages: waitingStages || {}
    };
  }
  const platforms = {
    ...(initialJob.platforms || {}),
    momo: { status: 'completed' }, coupang: { status: 'completed' },
    easyStore: { status: 'completed' }, shopee: { status: 'completed' }
  };
  const storedPlatforms = summarizePlatformsForStorage(platforms);
  const finalImageDocuments = await Promise.all(imageDocumentRefs.map(async (reference) => {
    const productSnap = await reference.productRef.get();
    return { ...reference, product: productSnap.exists ? productSnap.data() || {} : {} };
  }));
  const finalWrites = [];
  finalImageDocuments.forEach((reference) => {
    finalWrites.push(reference.caseRef.set({
      caseStatus: 'published',
      publishState: { jobId, status: 'completed', currentStage: 'completed', stages: completedStages, platforms: storedPlatforms, verifiedAt: admin.firestore.FieldValue.serverTimestamp() },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '固定四通路流程 v3'
    }, { merge: true }));
    finalWrites.push(reference.productRef.set({
      platformListingStatus: platformListingStatusFromPublish(reference.product.platformListingStatus, platforms),
      platformListingStatusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '固定四通路流程 v3'
    }, { merge: true }));
  });
  finalWrites.push(db.collection('opsAuditLogs').doc(`${jobId}_four_channel_completed`).set({
      action: '四通路上架完成', entityType: 'productListingPublish', entityId: jobId,
      summary: `${clean(snapshot.sku)}｜MOMO、酷澎、EasyStore、蝦皮已獨立核對完成`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: clean(actor) || '固定四通路流程',
      version: LISTING_WORKFLOW_ID
    }, { merge: true }));
  await Promise.all(finalWrites);
  return { status: alreadyCompleted ? 'already-completed' : 'completed', jobId, productId, currentStage: 'completed', stages: completedStages };
}

async function finalizeVerifiedShopeeStage(db, jobId, verification, actor) {
  const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
  const initialJobSnap = await jobRef.get();
  if (!initialJobSnap.exists) throw new HttpsError('not-found', '找不到這筆上架工作。');
  const initialJob = initialJobSnap.data() || {};
  if (clean(initialJob.currentStage) === 'completed') {
    return { status: 'already-completed', jobId, productId: clean(initialJob.productId), currentStage: 'completed', stages: initialJob.stages || {} };
  }
  const initialStages = initialJob.stages && typeof initialJob.stages === 'object' ? initialJob.stages : initialListingStages();
  if (!listingStageVerified(initialStages, 'easyStore')) {
    throw new HttpsError('failed-precondition', 'EasyStore 尚未正式核對完成，蝦皮不能提前發布。');
  }
  let updatedJob = null;
  await db.runTransaction(async (transaction) => {
    const latestSnap = await transaction.get(jobRef);
    if (!latestSnap.exists) return;
    const latest = latestSnap.data() || {};
    if (clean(latest.currentStage) === 'completed') {
      updatedJob = { ...latest, alreadyCompleted: true };
      return;
    }
    const stages = latest.stages && typeof latest.stages === 'object' ? { ...latest.stages } : initialListingStages();
    if (!listingStageVerified(stages, 'easyStore')) return;
    stages.shopee = { ...(stages.shopee || {}), status: 'verified', receipt: verification.receipt };
    const platforms = {
      ...(latest.platforms || {}),
      shopee: { status: 'completed', message: '蝦皮已由 EasyStore 官方通路清單核對完成。' }
    };
    const currentStage = deriveListingCurrentStage(stages);
    updatedJob = { ...latest, currentStage, stages, platforms: summarizePlatformsForStorage(platforms) };
    transaction.set(jobRef, {
      status: 'submitted', currentStage, stages, platforms: updatedJob.platforms,
      stageRevision: Math.max(1, Number(latest.stageRevision) || 1) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
  if (!updatedJob) throw new HttpsError('failed-precondition', 'EasyStore 尚未正式核對完成，蝦皮不能提前發布。');
  if (updatedJob.alreadyCompleted) {
    return { status: 'already-completed', jobId, productId: clean(updatedJob.productId), currentStage: 'completed', stages: updatedJob.stages || {} };
  }
  const finalized = await finalizeListingJobIfReady(db, jobId, actor);
  if (clean(finalized.status) !== 'waiting-other-platforms') return finalized;
  const productId = clean(updatedJob.productId);
  const caseRef = db.collection(LISTING_CASE_COLLECTION).doc(productId);
  await caseRef.set({
    caseStatus: 'submitted',
    publishState: {
      jobId, status: 'submitted', currentStage: finalized.currentStage,
      stages: finalized.stages, platforms: updatedJob.platforms,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(), submittedBy: clean(actor) || '固定四通路流程'
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: '固定四通路流程 v3'
  }, { merge: true });
  return { ...finalized, status: 'shopee-verified-waiting-other-platforms' };
}

function registerProductListingPublish(target) {
  target.publishProductListingCase = onCall(PRODUCT_LISTING_PUBLISH_OPTIONS, publishProductListingCaseHandler);

  target.autoPublishProductListingCase = onDocumentWritten({
    document: `${LISTING_CASE_COLLECTION}/{productId}`,
    region: REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [EASYSTORE_ACCESS_TOKEN]
  }, async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return null;
    const productId = clean(event.params && event.params.productId);
    const listingCase = after.data() || {};
    const grant = codexAutoPublishGrant(listingCase);
    if (!productId || !grant || clean(listingCase.publishState && listingCase.publishState.jobId)) return null;

    const db = admin.firestore();
    try {
      await loadFinalPreparedMediaSnapshot(db, productId, listingCase);
    } catch (_) {
      return null;
    }
    const fingerprint = codexAutoPublishInputFingerprint(listingCase);
    const attemptToken = crypto.randomBytes(16).toString('hex');
    const claimed = await db.runTransaction(async (transaction) => {
      const freshSnap = await transaction.get(after.ref);
      if (!freshSnap.exists) return false;
      const fresh = freshSnap.data() || {};
      const freshGrant = codexAutoPublishGrant(fresh);
      const current = fresh.codexAutoPublish && typeof fresh.codexAutoPublish === 'object' ? fresh.codexAutoPublish : {};
      if (!freshGrant || clean(fresh.publishState && fresh.publishState.jobId)) return false;
      if (clean(current.fingerprint) === fingerprint
        && ['starting', 'submitted', 'failed'].includes(clean(current.status))) return false;
      transaction.set(after.ref, {
        codexAutoPublish: {
          status: 'starting', workflowVersion: LISTING_WORKFLOW_ID, snapshotId: grant.snapshotId,
          fingerprint, attemptToken, startedAt: admin.firestore.FieldValue.serverTimestamp(),
          startedBy: grant.email, backendFirst: true, desktopControlFallbackOnly: true
        }
      }, { merge: true });
      return true;
    });
    if (!claimed) return null;

    const delays = [0, 3000, 10000, 30000];
    let lastError = null;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt]) await wait(delays[attempt]);
      try {
        const result = await publishProductListingCaseHandler({
          data: { productId },
          auth: { uid: `codex-auto:${productId}`, token: { email: grant.email, manager: true } }
        });
        const failureMessage = publishResultFailureMessage(result);
        if (failureMessage && isTransientListingPublishFailure(failureMessage) && attempt < delays.length - 1) {
          lastError = new Error(failureMessage);
          continue;
        }
        if (failureMessage) throw new Error(failureMessage);
        await after.ref.set({
          codexAutoPublish: {
            status: 'submitted', workflowVersion: LISTING_WORKFLOW_ID, snapshotId: grant.snapshotId,
            fingerprint, attemptToken, jobId: clean(result && result.jobId),
            currentStage: clean(result && result.currentStage), completedAt: admin.firestore.FieldValue.serverTimestamp()
          }
        }, { merge: true });
        return result;
      } catch (error) {
        lastError = error;
        if (!isTransientListingPublishFailure(error) || attempt === delays.length - 1) break;
      }
    }
    await after.ref.set({
      codexAutoPublish: {
        status: 'failed', workflowVersion: LISTING_WORKFLOW_ID, snapshotId: grant.snapshotId,
        fingerprint, attemptToken, error: clean(lastError && lastError.message).slice(0, 800) || '發布未完成',
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    }, { merge: true });
    return null;
  });

  target.verifyProductListingStage = onCall({
    region: REGION,
    timeoutSeconds: 180,
    memory: '512MiB',
    enforceAppCheck: false
  }, async (request) => {
    if (!isAllowedManager(request)) throw new HttpsError('permission-denied', '請先使用管理者帳號登入。');
    const jobId = clean(request && request.data && request.data.jobId);
    const requestedStage = clean(request && request.data && request.data.stage).toLowerCase();
    if (!jobId || jobId.length > 200 || jobId.includes('/')) throw new HttpsError('invalid-argument', '上架工作編號格式不正確。');
    if (requestedStage !== 'shopee') throw new HttpsError('invalid-argument', '只有蝦皮正式清單核對可由這支 callable 送出；酷澎與 MOMO 只接受同一 queue worker 的 verified receipt。');
    const db = admin.firestore();
    const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
    const initialJobSnap = await jobRef.get();
    if (!initialJobSnap.exists) throw new HttpsError('not-found', '找不到這筆上架工作。');
    const initialJob = initialJobSnap.data() || {};
    const snapshot = initialJob.preparedSnapshot && typeof initialJob.preparedSnapshot === 'object' ? initialJob.preparedSnapshot : null;
    if (!snapshot || clean(initialJob.workflowVersion) !== LISTING_WORKFLOW_ID) throw new HttpsError('failed-precondition', '這筆工作不是目前固定版四通路流程；舊 job 只能查看，不能沿用舊回條繼續。');
    const verification = validatePlatformStageVerification(requestedStage, snapshot, request && request.data && request.data.verification);
    if (!verification.verified) throw new HttpsError('failed-precondition', `正式清單核對未通過：${verification.reasons.join('、')}`);
    const result = await finalizeVerifiedShopeeStage(
      db,
      jobId,
      verification,
      clean(request.auth && request.auth.token && request.auth.token.email) || '管理者'
    );
    if (result.status === 'blocked-image-reference-verification') {
      throw new HttpsError('failed-precondition', `四通路圖片引用核對未通過：${result.reasons.join('、')}`);
    }
    return { ok: true, verifiedStage: requestedStage, ...result };
  });

  target.applyProductListingQueueReceipt = onDocumentWritten({
    document: `${PLATFORM_QUEUE_COLLECTION}/{queueId}`,
    region: REGION,
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [EASYSTORE_ACCESS_TOKEN]
  }, async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return null;
    const before = event.data && event.data.before;
    const current = after.data() || {};
    const previous = before && before.exists ? before.data() || {} : {};
    const sameReceipt = clean(previous.status) === clean(current.status)
      && clean(previous.jobId) === clean(current.jobId)
      && clean(previous.attemptToken) === clean(current.attemptToken)
      && clean(previous.fingerprint) === clean(current.fingerprint)
      && JSON.stringify(previous.verificationReceipt || null) === JSON.stringify(current.verificationReceipt || null);
    if (sameReceipt) return null;
    return applyVerifiedQueueReceipt(admin.firestore(), clean(event.params && event.params.queueId), current);
  });
}

module.exports = {
  registerProductListingPublish,
  _test: {
    normalizeSku,
    productDescriptionToSafeHtml,
    listingDescriptionContentStatus,
    buildListingSnapshot,
    buildEasyStoreProductBody,
    normalizeShopeeAttributes,
    applyShopeeAttributeTemplate,
    canonicalShopeeCategorySegment,
    shopeeCategorySegments,
    hsinchuSizeBand,
    buildShopeeLogistics,
    buildCoupangShipping,
    buildShopeeAutofillPayload,
    platformListingIds,
    platformQueueFingerprint,
    platformStageFingerprint,
    listingSnapshotFingerprint,
    buildPlatformQueuePolicy,
    evaluateMomoPublishVerification,
    identityAllowsShopeeAutofill,
    summarizePlatformsForStorage,
    platformListingStatusFromPublish,
    appendShopDescriptionPromos,
    appendShopDescriptionImages,
    listingImageAllocation,
    prioritizedListingImageUrls,
    localizedRepresentativeImage,
    finalizedRoleRowsForCase,
    buildFinalPlatformImagePlan,
    finalizePreparedMediaSnapshot,
    preparedPlatformImagePlan,
    platformImagePlanMissingFields,
    platformPayloadSnapshot,
    exactEasyStoreMatches,
    easyStoreMissingFields,
    momoMissingFields,
    coupangMissingFields,
    platformCategoryResolution,
    validatePlatformImageEvidence,
    validatePlatformStageVerification,
    validateQueuedStageReceipt,
    listingStageVerified,
    allListingStagesVerified,
    deriveListingCurrentStage,
    validateAllPlatformImageReceipts,
    centralCompletedImageUpdate,
    completedVariantRecords,
    syncPreparedCentralImagesBeforePublish,
    validateCompletionImageReferences,
    activeV3JobReuseBlockers,
    frozenInputSnapshotFingerprint,
    buildCanonicalCategoryDecision,
    buildListingDecisionContract,
    buildPlatformPageContracts,
    buildPreparedPlatformFieldPlan,
    publishEasyStoreStage,
    publishEasyStoreStageWithRetry,
    applyVerifiedQueueReceipt,
    finalizeListingJobIfReady,
    finalizeVerifiedShopeeStage,
    easyStoreVariantPrice,
    easyStoreVariantStock,
    easyStorePublicationState,
    overallPublishStatus,
    codexAutoPublishGrant,
    codexAutoPublishInputFingerprint,
    isTransientListingPublishFailure,
    publishResultFailureMessage
  }
};
