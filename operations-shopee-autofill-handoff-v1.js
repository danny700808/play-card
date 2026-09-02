(function (global) {
  'use strict';

  const QUEUE_TYPE = 'YOUZI_SHOPEE_AUTOFILL_QUEUE_V2';
  const ACK_TYPE = 'YOUZI_SHOPEE_AUTOFILL_ACK_V2';
  const SOURCE = 'youzi-operations-hub';
  const SCHEMA_VERSION = 7;
  const WORKFLOW_VERSION = 'youzi-four-channel-listing-v3';
  const MAX_TTL_MS = 30 * 60 * 1000;
  const MIN_REMAINING_MS = 1000;

  function clean(value, limit) {
    return String(value == null ? '' : value).trim().slice(0, limit || 500);
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function feeOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 100000 ? parsed : null;
  }

  function safeHttpUrl(value) {
    const raw = clean(value, 1000);
    if (!raw) return '';
    try {
      const url = new URL(raw);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function sanitizePayload(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const now = Date.now();
    const categoryPath = (Array.isArray(value.categoryPath) ? value.categoryPath : [])
      .map((item) => clean(item, 120)).filter(Boolean).slice(0, 8);
    const attributes = (Array.isArray(value.attributes) ? value.attributes : []).map((row) => ({
      label: clean(row && row.label, 120),
      value: clean(row && row.value, 300),
      confidence: ['high', 'medium', 'low'].includes(clean(row && row.confidence, 20))
        ? clean(row.confidence, 20) : 'low',
      note: clean(row && row.note, 500)
    })).filter((row) => row.label && row.value).slice(0, 30);
    const methods = (value.logistics && Array.isArray(value.logistics.methods) ? value.logistics.methods : [])
      .map((row) => ({
        label: clean(row && row.label, 120),
        enabled: row && row.enabled === true,
        option: clean(row && row.option, 120),
        feeTwd: feeOrNull(row && row.feeTwd),
        sellerPays: row && row.sellerPays === true
      })).filter((row) => row.label).slice(0, 20);
    const createdAt = numberOrNull(value.createdAt);
    const expiresAt = numberOrNull(value.expiresAt);
    if (value.schemaVersion !== SCHEMA_VERSION) {
      throw new Error('蝦皮自動填寫資料版本不相容，請重新執行「確認上架」。');
    }
    if (!Number.isSafeInteger(createdAt) || createdAt <= 0 || createdAt > now + 60 * 1000) {
      throw new Error('蝦皮自動填寫資料的建立時間無效，請重新執行「確認上架」。');
    }
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= createdAt) {
      throw new Error('蝦皮自動填寫資料的有效期限無效，請重新執行「確認上架」。');
    }
    if (expiresAt <= now) {
      throw new Error('蝦皮自動填寫資料已過期，請重新執行「確認上架」。');
    }
    if (expiresAt - now < MIN_REMAINING_MS) {
      throw new Error('蝦皮自動填寫資料即將過期，請重新執行「確認上架」。');
    }
    if (expiresAt - now > MAX_TTL_MS + 5000 || now - createdAt > MAX_TTL_MS + 60 * 1000) {
      throw new Error('蝦皮自動填寫資料不在允許的 30 分鐘時窗內。');
    }
    const easyStoreProductId = clean(value.easyStoreProductId, 100);
    if (!/^[1-9]\d{0,29}$/.test(easyStoreProductId)) {
      throw new Error('EasyStore 商品 ID 無效，請重新執行「確認上架」。');
    }
    const canonicalEasyStoreUrl = `https://admin.easystore.co/products/${easyStoreProductId}`;
    const platformListingIds = (value.listingPolicy && Array.isArray(value.listingPolicy.platformListingIds)
      ? value.listingPolicy.platformListingIds : [])
      .map((item) => clean(item, 100)).filter(Boolean)
      .filter((item, index, rows) => rows.indexOf(item) === index).slice(0, 20);
    const variantSource = value.variantGroup && typeof value.variantGroup === 'object' ? value.variantGroup : {};
    const variantGroup = value.variantGroup == null ? null : {
      parentProductId: clean(variantSource.parentProductId, 200),
      parentSku: clean(variantSource.parentSku, 120),
      parentName: clean(variantSource.parentName, 255),
      attributeName: clean(variantSource.attributeName, 120),
      parentAttributeValue: clean(variantSource.parentAttributeValue, 200),
      attributeValue: clean(variantSource.attributeValue, 200),
      parentImageUrl: safeHttpUrl(variantSource.parentImageUrl),
      imageUrl: safeHttpUrl(variantSource.imageUrl)
    };
    const advancedSource = value.advancedDescription && typeof value.advancedDescription === 'object'
      ? value.advancedDescription : {};
    const advancedImageUrls = (Array.isArray(advancedSource.imageUrls) ? advancedSource.imageUrls : [])
      .map(safeHttpUrl).filter(Boolean)
      .filter((url, index, rows) => rows.indexOf(url) === index).slice(0, 12);
    const fixedLastTwoImageUrls = (Array.isArray(advancedSource.fixedLastTwoImageUrls)
      ? advancedSource.fixedLastTwoImageUrls : [])
      .map(safeHttpUrl).filter(Boolean)
      .filter((url, index, rows) => rows.indexOf(url) === index).slice(0, 2);
    const advancedTextBlocks = (Array.isArray(advancedSource.textBlocks) ? advancedSource.textBlocks : [])
      .map((row) => ({ key: clean(row && row.key, 80), text: clean(row && row.text, 5000) }))
      .filter((row) => row.key && row.text).slice(0, 8);
    const advancedBlockPlan = (Array.isArray(advancedSource.blockPlan) ? advancedSource.blockPlan : [])
      .map((row) => ({
        type: clean(row && row.type, 20),
        key: clean(row && row.key, 80),
        imageUrl: safeHttpUrl(row && row.imageUrl)
      }))
      .filter((row) => row.key && ['text', 'image'].includes(row.type))
      .slice(0, 24);
    const advancedDescription = {
      mode: clean(advancedSource.mode, 80),
      source: clean(advancedSource.source, 80),
      preparedBeforeNavigation: advancedSource.preparedBeforeNavigation === true,
      skipEasyStoreDescriptionImport: advancedSource.skipEasyStoreDescriptionImport === true,
      transferImagesThroughShopeeNativeUploader: advancedSource.transferImagesThroughShopeeNativeUploader === true,
      memoryOnlyImageStaging: advancedSource.memoryOnlyImageStaging === true,
      desktopDownloadRequired: advancedSource.desktopDownloadRequired === true,
      dedicatedLocalStagingDirectoryRequired: advancedSource.dedicatedLocalStagingDirectoryRequired === true,
      uploadEntry: clean(advancedSource.uploadEntry, 120),
      deleteLocalStagingOnlyAfterReloadVerification: advancedSource.deleteLocalStagingOnlyAfterReloadVerification === true,
      neverDeleteUntrackedUserFiles: advancedSource.neverDeleteUntrackedUserFiles === true,
      directExternalImageUrlPasteForbidden: advancedSource.directExternalImageUrlPasteForbidden === true,
      waitForEveryNativeImageUploadBeforeUpdate: advancedSource.waitForEveryNativeImageUploadBeforeUpdate === true,
      verifyNativeImageCountAndInterleavedOrderBeforeUpdate: advancedSource.verifyNativeImageCountAndInterleavedOrderBeforeUpdate === true,
      rejectZeroImageDescriptionBeforePublish: advancedSource.rejectZeroImageDescriptionBeforePublish === true,
      capabilityProbe: clean(advancedSource.capabilityProbe, 80),
      contentFingerprint: clean(advancedSource.contentFingerprint, 128),
      requiredFirstImageUrl: safeHttpUrl(advancedSource.requiredFirstImageUrl),
      fixedLastTwoImageUrls,
      imageUrls: advancedImageUrls,
      expectedImageCount: Math.max(0, Math.round(numberOrNull(advancedSource.expectedImageCount) || 0)),
      textBlocks: advancedTextBlocks,
      blockPlan: advancedBlockPlan
    };
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      workflowVersion: clean(value.workflowVersion, 80),
      jobId: clean(value.jobId, 200),
      snapshotId: clean(value.snapshotId, 200),
      snapshotFingerprint: clean(value.snapshotFingerprint, 128),
      nonce: clean(value.nonce, 100),
      createdAt,
      expiresAt,
      productId: clean(value.productId, 200),
      easyStoreProductId,
      easyStoreUrl: canonicalEasyStoreUrl,
      sku: clean(value.sku, 120),
      title: clean(value.title, 255),
      publishMode: clean(value.publishMode, 40),
      variantGroup,
      listingPolicy: {
        mode: clean(value.listingPolicy && value.listingPolicy.mode, 40),
        identitySource: clean(value.listingPolicy && value.listingPolicy.identitySource, 40),
        platformListingIds,
        preflightSkuSearch: value.listingPolicy && value.listingPolicy.preflightSkuSearch === true,
        uncertainSubmitRecovery: clean(value.listingPolicy && value.listingPolicy.uncertainSubmitRecovery, 40)
      },
      categoryPath,
      brand: clean(value.brand, 120),
      advancedDescription,
      priceAdjustment: {
        enabled: value.priceAdjustment && value.priceAdjustment.enabled === true,
        synchronizeWithEasyStorePrice: value.priceAdjustment && value.priceAdjustment.synchronizeWithEasyStorePrice === true
      },
      attributes,
      package: {
        lengthCm: numberOrNull(value.package && value.package.lengthCm),
        widthCm: numberOrNull(value.package && value.package.widthCm),
        heightCm: numberOrNull(value.package && value.package.heightCm),
        weightKg: numberOrNull(value.package && value.package.weightKg)
      },
      logistics: {
        decision: clean(value.logistics && value.logistics.decision, 30),
        packageTotalCm: numberOrNull(value.logistics && value.logistics.packageTotalCm),
        methods,
        requiresConfirmation: value.logistics && value.logistics.requiresConfirmation === true
      },
      preorder: {
        enabled: value.preorder && value.preorder.enabled === true,
        days: Math.max(1, Math.min(30, Math.round(numberOrNull(value.preorder && value.preorder.days) || 1)))
      },
      guard: {
        brand: clean(value.guard && value.guard.brand, 120),
        model: clean(value.guard && value.guard.model, 120),
        color: clean(value.guard && value.guard.color, 120),
        identityStatus: clean(value.guard && value.guard.identityStatus, 30)
      }
    };
    const expectedTextBlockKeys = [
      'features', 'specifications', 'usage', 'actual-product-notice', 'warranty-support-notice'
    ];
    const plannedTextKeys = payload.advancedDescription.blockPlan
      .filter((row) => row.type === 'text').map((row) => row.key);
    const plannedImageUrls = payload.advancedDescription.blockPlan
      .filter((row) => row.type === 'image').map((row) => row.imageUrl);
    const imageBoundaryKeys = [];
    let currentTextKey = '';
    payload.advancedDescription.blockPlan.forEach((row) => {
      if (row.type === 'text') currentTextKey = row.key;
      else if (row.type === 'image') imageBoundaryKeys.push(currentTextKey);
    });
    if (payload.workflowVersion !== WORKFLOW_VERSION) {
      throw new Error('蝦皮自動填寫資料不是目前固定版四通路流程。');
    }
    if (!payload.nonce || !payload.jobId || !payload.snapshotId || !payload.snapshotFingerprint
      || !payload.productId || !payload.sku || !payload.categoryPath.length
      || payload.advancedDescription.mode !== 'seller-center-native-file-upload-interleaved'
      || payload.advancedDescription.source !== 'prepared-text-blocks-and-downloaded-local-image-files'
      || payload.advancedDescription.preparedBeforeNavigation !== true
      || payload.advancedDescription.skipEasyStoreDescriptionImport !== true
      || payload.advancedDescription.transferImagesThroughShopeeNativeUploader !== true
      || payload.advancedDescription.memoryOnlyImageStaging !== false
      || payload.advancedDescription.desktopDownloadRequired !== true
      || payload.advancedDescription.dedicatedLocalStagingDirectoryRequired !== true
      || payload.advancedDescription.uploadEntry !== '商品描述/新增圖片/從電腦裝置上傳'
      || payload.advancedDescription.deleteLocalStagingOnlyAfterReloadVerification !== true
      || payload.advancedDescription.neverDeleteUntrackedUserFiles !== true
      || payload.advancedDescription.directExternalImageUrlPasteForbidden !== true
      || payload.advancedDescription.waitForEveryNativeImageUploadBeforeUpdate !== true
      || payload.advancedDescription.verifyNativeImageCountAndInterleavedOrderBeforeUpdate !== true
      || payload.advancedDescription.rejectZeroImageDescriptionBeforePublish !== true
      || payload.advancedDescription.capabilityProbe !== 'seller-center-rich-editor-and-file-input'
      || !/^[a-f0-9]{64}$/i.test(payload.advancedDescription.contentFingerprint)
      || payload.advancedDescription.imageUrls.length < 5
      || payload.advancedDescription.imageUrls.length > 12
      || payload.advancedDescription.imageUrls[0] !== payload.advancedDescription.requiredFirstImageUrl
      || payload.advancedDescription.fixedLastTwoImageUrls.length !== 2
      || payload.advancedDescription.imageUrls.slice(-2).join('|') !== payload.advancedDescription.fixedLastTwoImageUrls.join('|')
      || payload.advancedDescription.expectedImageCount !== payload.advancedDescription.imageUrls.length
      || payload.advancedDescription.textBlocks.length !== 5
      || payload.advancedDescription.textBlocks.map((row) => row.key).join('|') !== expectedTextBlockKeys.join('|')
      || payload.advancedDescription.blockPlan.length !== payload.advancedDescription.textBlocks.length + payload.advancedDescription.imageUrls.length
      || plannedTextKeys.join('|') !== expectedTextBlockKeys.join('|')
      || plannedImageUrls.join('|') !== payload.advancedDescription.imageUrls.join('|')
      || imageBoundaryKeys.slice(0, 3).join('|') !== 'features|specifications|usage'
      || imageBoundaryKeys.slice(3, -2).some((key) => key !== 'usage')
      || imageBoundaryKeys.slice(-2).join('|') !== 'warranty-support-notice|warranty-support-notice'
      || payload.advancedDescription.blockPlan.slice(-3).map((row) => row.key).join('|')
        !== 'warranty-support-notice|description-promo-1|description-promo-2') {
      throw new Error('蝦皮自動填寫資料不完整，請重新執行「確認上架」。');
    }
    if (payload.priceAdjustment.enabled !== true
      || payload.priceAdjustment.synchronizeWithEasyStorePrice !== true) {
      throw new Error('蝦皮價格同步設定不完整，請重新執行「確認上架」。');
    }
    const mode = payload.listingPolicy.mode;
    const expectedIdentitySource = mode === 'create-new' ? 'new-draft' : 'central-platform-id';
    const expectedIdCount = mode === 'create-new' ? 0 : 1;
    if (
      !['create-new', 'update-existing', 'add-variant-to-existing'].includes(mode) ||
      payload.listingPolicy.identitySource !== expectedIdentitySource ||
      payload.listingPolicy.platformListingIds.length !== expectedIdCount ||
      payload.listingPolicy.preflightSkuSearch !== false ||
      payload.listingPolicy.uncertainSubmitRecovery !== 'exact-sku-only' ||
      !['auto', 'add-variant-to-existing'].includes(payload.publishMode) ||
      (mode === 'add-variant-to-existing') !== (payload.publishMode === 'add-variant-to-existing')
    ) {
      throw new Error('蝦皮中央平台 ID 規則不完整，請重新執行「確認上架」。');
    }
    if (mode === 'add-variant-to-existing' && (!variantGroup || !variantGroup.parentProductId
      || !variantGroup.parentSku || !variantGroup.attributeName || !variantGroup.parentAttributeValue
      || !variantGroup.attributeValue || !variantGroup.parentImageUrl || !variantGroup.imageUrl)) {
      throw new Error('蝦皮細項資料不完整，請重新執行「確認上架」。');
    }
    if (mode !== 'add-variant-to-existing' && variantGroup !== null) {
      throw new Error('非細項商品不可夾帶蝦皮細項資料。');
    }
    return payload;
  }

  function queueSanitized(sanitized) {
    return new Promise((resolve) => {
      let finished = false;
      function finish(value) {
        if (finished) return;
        finished = true;
        global.removeEventListener('message', onMessage);
        global.clearTimeout(timer);
        resolve(value);
      }
      function onMessage(event) {
        const data = event && event.data;
        if (event.source !== global || event.origin !== global.location.origin || !data || data.type !== ACK_TYPE) return;
        if (clean(data.nonce, 100) !== sanitized.nonce) return;
        finish({ payload: sanitized, extensionReady: data.ok === true, error: clean(data.error, 300) });
      }
      global.addEventListener('message', onMessage);
      const timer = global.setTimeout(() => finish({ payload: sanitized, extensionReady: false, error: '' }), 1600);
      global.postMessage({ source: SOURCE, type: QUEUE_TYPE, payload: sanitized }, global.location.origin);
    });
  }

  function queue(payload) {
    return queueSanitized(sanitizePayload(payload));
  }

  function queueAndOpen(payload) {
    const sanitized = sanitizePayload(payload);
    const pending = queueSanitized(sanitized);
    global.open(sanitized.easyStoreUrl, '_blank', 'noopener');
    return pending;
  }

  global.YouziShopeeAutofill = Object.freeze({ queue, queueAndOpen, sanitizePayload });
})(window);
