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
const LISTING_AUTOMATION_POLICY_VERSION = 18;
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
      preferredProductImagePositions: [2, 3],
      excludeStoreAddressAndServicePromos: true,
      neverUseGalleryLastStorePromo: true,
      materialBankInsertRequired: true,
      insertionTarget: 'rich-description-editor',
      materialBankUploadFlow: ['open-rich-description-upload', 'choose-material-bank', 'upload-localized-file', 'search-exact-filename', 'select', 'confirm', 'save-draft'],
      directRichEditorUploadIsNotPersistedProof: true,
      saveReopenAndVerifyImageRequired: false,
      visibleInsertionAndSaveConfirmationRequired: true,
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
  const expectedSku = normalizeSk