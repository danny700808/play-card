(function attachYouziImageCollectorHelpers(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.YouziImageCollectorHelpers = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildImageCollectorHelpers() {
  "use strict";

  const OPERATIONS_ORIGIN = "https://danny700808.github.io";
  const OPERATIONS_SOURCE = "youzi-operations-hub";
  const EXTENSION_SOURCE = "youzi-image-collector-extension";
  const SESSION_STORAGE_KEY = "youziProductImageCollectionSessionV1";
  const START_MESSAGE = "YOUZI_IMAGE_COLLECTION_START";
  const STOP_MESSAGE = "YOUZI_IMAGE_COLLECTION_STOP";
  const SESSION_ACK_MESSAGE = "YOUZI_IMAGE_COLLECTION_SESSION_ACK";
  const SESSION_STATE_MESSAGE = "YOUZI_IMAGE_COLLECTION_SESSION_STATE";
  const STATE_REQUEST_MESSAGE = "YOUZI_IMAGE_COLLECTION_STATE_REQUEST";
  const BIND_OPERATIONS_TAB_MESSAGE = "YOUZI_IMAGE_COLLECTION_BIND_OPERATIONS_TAB";
  const FETCH_MESSAGE = "YOUZI_IMAGE_COLLECTION_FETCH";
  const CAPTURE_MESSAGE = "YOUZI_IMAGE_COLLECTION_CAPTURE_VISIBLE";
  const CAPTURE_DATA_MESSAGE = "YOUZI_IMAGE_COLLECTION_CAPTURE_DATA";
  const START_CROP_MESSAGE = "YOUZI_IMAGE_COLLECTION_START_CROP";
  const DELIVER_MESSAGE = "YOUZI_IMAGE_COLLECTION_DELIVER";
  const FILE_ACK_MESSAGE = "YOUZI_IMAGE_COLLECTION_FILE_ACK";
  const MAX_IMAGES = 12;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_SESSION_AGE_MS = 4 * 60 * 60 * 1000;

  const SUPPLIER_HOST_SUFFIXES = [
    "taobao.com",
    "tmall.com",
    "1688.com",
    "alibaba.com"
  ];
  const IMAGE_HOST_SUFFIXES = SUPPLIER_HOST_SUFFIXES.concat([
    "alicdn.com",
    "alicdn.cn",
    "tbcdn.cn",
    "alibabausercontent.com"
  ]);

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function boundedInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(number)));
  }

  function hostnameMatches(hostname, suffixes) {
    const normalized = text(hostname).toLowerCase().replace(/^\.+|\.+$/g, "");
    return suffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
  }

  function parsedHttpsUrl(value, baseUrl) {
    try {
      const url = new URL(text(value), text(baseUrl) || undefined);
      if (url.protocol !== "https:") return null;
      url.hash = "";
      return url;
    } catch (error) {
      return null;
    }
  }

  function isSupplierPageUrl(value) {
    const url = parsedHttpsUrl(value);
    return Boolean(url && hostnameMatches(url.hostname, SUPPLIER_HOST_SUFFIXES));
  }

  function isAllowedImageUrl(value) {
    const url = parsedHttpsUrl(value);
    return Boolean(url && hostnameMatches(url.hostname, IMAGE_HOST_SUFFIXES));
  }

  function stripAlibabaResizeSuffix(value) {
    const url = parsedHttpsUrl(value);
    if (!url || !hostnameMatches(url.hostname, ["alicdn.com", "alicdn.cn", "tbcdn.cn"])) {
      return url ? url.href : "";
    }
    url.pathname = url.pathname.replace(
      /(\.(?:jpe?g|png|webp|gif))(?:_[^/]+)+$/i,
      "$1"
    );
    return url.href;
  }

  function normalizeImageUrl(value, baseUrl) {
    const url = parsedHttpsUrl(value, baseUrl);
    if (!url || !hostnameMatches(url.hostname, IMAGE_HOST_SUFFIXES)) return "";
    return stripAlibabaResizeSuffix(url.href);
  }

  function srcsetUrls(value) {
    return text(value)
      .split(",")
      .map((entry) => {
        const parts = entry.trim().split(/\s+/);
        const descriptor = parts[parts.length - 1] || "";
        const score = /^(\d+(?:\.\d+)?)w$/.test(descriptor)
          ? Number(descriptor.slice(0, -1))
          : /^(\d+(?:\.\d+)?)x$/.test(descriptor)
            ? Number(descriptor.slice(0, -1)) * 1000
            : 0;
        return { url: parts[0] || "", score };
      })
      .filter((entry) => entry.url)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.url);
  }

  function chooseImageUrl(candidates, baseUrl) {
    const seen = new Set();
    for (const candidate of candidates || []) {
      const values = typeof candidate === "string" && candidate.includes(",")
        ? srcsetUrls(candidate)
        : [candidate];
      for (const value of values) {
        const normalized = normalizeImageUrl(value, baseUrl);
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          return normalized;
        }
      }
    }
    return "";
  }

  function normalizeSessionPayload(payload, now) {
    const row = payload && typeof payload === "object" ? payload : {};
    const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const sessionId = text(row.sessionId);
    const productId = text(row.productId);
    const sku = text(row.sku);
    const easyStoreProductId = text(row.easyStoreProductId);
    const title = text(row.title);
    const maxImages = boundedInteger(row.maxImages, 1, MAX_IMAGES, MAX_IMAGES);
    const currentCount = boundedInteger(row.currentCount, 0, maxImages, 0);
    const startedAt = Number(row.startedAt || timestamp);
    const expiresAt = Number(row.expiresAt || (startedAt + MAX_SESSION_AGE_MS));
    const active = row.active !== false && currentCount < maxImages && expiresAt > timestamp;
    const operationsTabId = Number.isInteger(Number(row.operationsTabId)) && Number(row.operationsTabId) > 0
      ? Number(row.operationsTabId)
      : 0;
    const errors = [];
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(sessionId)) errors.push("收圖工作代碼不正確");
    if (!productId || productId.length > 180) errors.push("找不到準備上架商品");
    if (!sku || sku.length > 120) errors.push("商品 SKU 不正確");
    if (easyStoreProductId.length > 120) errors.push("EasyStore 商品 ID 不正確");
    if (title.length > 240) errors.push("商品名稱過長");
    if (!Number.isFinite(startedAt) || startedAt > timestamp + 60_000) errors.push("收圖開始時間不正確");
    if (!Number.isFinite(expiresAt) || expiresAt <= startedAt || expiresAt - startedAt > MAX_SESSION_AGE_MS) {
      errors.push("收圖有效時間不正確");
    }
    return {
      ok: errors.length === 0,
      errors,
      value: {
        sessionId,
        productId,
        sku,
        easyStoreProductId,
        title,
        maxImages,
        currentCount,
        startedAt,
        expiresAt,
        active,
        operationsTabId,
        stoppedReason: text(row.stoppedReason)
      }
    };
  }

  function imageMimeType(value) {
    const mime = text(value).toLowerCase().split(";")[0];
    return ["image/jpeg", "image/png", "image/webp"].includes(mime) ? mime : "";
  }

  function imageFileExtension(mime) {
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    return "jpg";
  }

  function safeImageFileName(urlValue, mime) {
    const extension = imageFileExtension(mime);
    let base = "supplier-image";
    try {
      const url = new URL(urlValue);
      const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
      base = last.replace(/\.[A-Za-z0-9]+(?:_[^.]*)?$/, "") || base;
    } catch (error) {}
    base = base.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "supplier-image";
    return `${base}.${extension}`;
  }

  return Object.freeze({
    OPERATIONS_ORIGIN,
    OPERATIONS_SOURCE,
    EXTENSION_SOURCE,
    SESSION_STORAGE_KEY,
    START_MESSAGE,
    STOP_MESSAGE,
    SESSION_ACK_MESSAGE,
    SESSION_STATE_MESSAGE,
    STATE_REQUEST_MESSAGE,
    BIND_OPERATIONS_TAB_MESSAGE,
    FETCH_MESSAGE,
    CAPTURE_MESSAGE,
    CAPTURE_DATA_MESSAGE,
    START_CROP_MESSAGE,
    DELIVER_MESSAGE,
    FILE_ACK_MESSAGE,
    MAX_IMAGES,
    MAX_IMAGE_BYTES,
    MAX_SESSION_AGE_MS,
    isSupplierPageUrl,
    isAllowedImageUrl,
    normalizeImageUrl,
    srcsetUrls,
    chooseImageUrl,
    normalizeSessionPayload,
    imageMimeType,
    imageFileExtension,
    safeImageFileName
  });
});
