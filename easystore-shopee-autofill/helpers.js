(function attachYouziShopeeAutofillHelpers(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.YouziShopeeAutofillHelpers = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function buildHelpers() {
  "use strict";

  const SCHEMA_VERSION = 4;
  const QUEUE_STORAGE_KEY = "youziShopeeAutofillQueueV1";
  // Content scripts can always share storage.local across the Operations and
  // EasyStore tabs. storage.session requires a service-worker access-level
  // bootstrap and was observed to drop the handoff on store computers.
  const QUEUE_STORAGE_AREA = "local";
  const MAX_QUEUE_ITEMS = 20;
  const MAX_TTL_MS = 30 * 60 * 1000;
  const MIN_TTL_MS = 1000;
  const MAX_PAYLOAD_BYTES = 64 * 1024;
  const SELLER_LARGE_HOME_FEE_TWD = 100;

  const ATTRIBUTE_DEFINITIONS = Object.freeze({
    ncc: { labels: ["NCC"], inputMode: "text" },
    weight: { labels: ["Weight", "重量"], inputMode: "composite" },
    warrantyDuration: { labels: ["Warranty Duration", "保固期間"], inputMode: "select" },
    warrantyType: { labels: ["Warranty Type", "保固類型"], inputMode: "select" },
    accessoryType: { labels: ["Accessory Type", "配件類型"], inputMode: "select" },
    length: { labels: ["Length", "長度"], inputMode: "composite" },
    neckMaterial: { labels: ["Neck Material", "琴頸材質"], inputMode: "select" },
    traditionalMusicInstrument: { labels: ["Traditional Music Instrument", "傳統樂器"], inputMode: "select" },
    guitarShape: { labels: ["Guitar Shape", "吉他形狀"], inputMode: "select" },
    handConfiguration: { labels: ["Hand Configuration", "慣用手"], inputMode: "select" },
    bsmi: { labels: ["BSMI"], inputMode: "text" },
    quantity: { labels: ["Quantity", "數量"], inputMode: "text" },
    indication: { labels: ["indication", "Indication"], inputMode: "text" },
    quantityPerPack: { labels: ["Quantity per Pack", "每包數量"], inputMode: "select" },
    bodyMaterial: { labels: ["Body Material", "琴身材質"], inputMode: "select" },
    guitarType: { labels: ["Guitar Type", "吉他類型"], inputMode: "select" },
    pickupConfiguration: { labels: ["Pickup Configuration", "拾音器配置"], inputMode: "select" },
    fretboardMaterial: { labels: ["Fretboard Material", "指板材質"], inputMode: "select" },
    dimensions: {
      labels: ["Dimension (L x W x H)", "Dimension (L × W × H)", "尺寸（長×寬×高）"],
      inputMode: "text"
    },
    numberOfStrings: { labels: ["Number of Strings", "弦數"], inputMode: "select" },
    itemCondition: { labels: ["Item condition", "Item Condition", "商品狀況"], inputMode: "select" },
    color: { labels: ["Color", "Colour", "顏色"], inputMode: "select" }
  });

  const LOGISTICS_DEFINITIONS = Object.freeze({
    blackCat: ["黑貓宅急便"],
    shopeeNextDay: ["蝦皮店到店 - 隔日到貨", "蝦皮店到店－隔日到貨"],
    shopeeStoreToStore: ["蝦皮店到店"],
    sevenEleven: ["7-ELEVEN", "7-11"],
    hct: ["新竹物流"],
    familyMart: ["全家"],
    sellerLargeHome: ["賣家宅配：大型/超重物品運送", "賣家宅配 - 大型/超重物品運送"],
    kerry: ["嘉里快遞"],
    homeDelivery: ["店到家宅配"]
  });

  const TOP_LEVEL_KEYS = new Set([
    "schemaVersion",
    "nonce",
    "createdAt",
    "expiresAt",
    "productId",
    "easyStoreProductId",
    "easyStoreUrl",
    "sku",
    "title",
    "publishMode",
    "listingPolicy",
    "categoryPath",
    "brand",
    "attributes",
    "package",
    "logistics",
    "preorder",
    "guard"
  ]);

  function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== "[object Object]") {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .normalize("NFKC")
      .toLocaleLowerCase("zh-TW")
      .replace(/[\s\u00a0]+/g, "")
      .replace(/[：:，,。．·•()（）\[\]【】]/g, "")
      .trim();
  }

  function exactApprovedMatch(actual, approvedValues) {
    const normalizedActual = normalizeText(actual);
    if (!normalizedActual || !Array.isArray(approvedValues)) {
      return false;
    }
    return approvedValues.some((candidate) => normalizeText(candidate) === normalizedActual);
  }

  function logisticsOptionMatch(actual, approvedValues) {
    const withoutPrice = String(actual == null ? "" : actual).replace(
      /\s*[-–—]\s*\(?\s*(?:(?:NT\$|TWD)\s*)?\d+(?:\.\d+)?\s*(?:TWD)?\s*\)?\s*$/i,
      ""
    );
    return exactApprovedMatch(withoutPrice, approvedValues);
  }

  function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
      const text = String(value == null ? "" : value).trim();
      const normalized = normalizeText(text);
      if (!text || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      result.push(text);
    }
    return result;
  }

  function parsePositiveId(value) {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value > 0 ? String(value) : "";
    }
    const text = String(value == null ? "" : value).trim();
    return /^[1-9]\d{0,29}$/.test(text) ? text : "";
  }

  function canonicalEasyStoreProductUrl(value) {
    const id = parsePositiveId(value);
    return id ? `https://admin.easystore.co/products/${id}` : "";
  }

  function easyStoreRouteKind(urlValue) {
    try {
      const url = new URL(String(urlValue));
      if (url.origin !== "https://admin.easystore.co") return "";
      if (/^\/products\/[1-9]\d{0,29}\/?$/.test(url.pathname)) return "product";
      if (/^\/channels\/shopee\/taiwan\/products\/sync\/?$/.test(url.pathname)) return "shopee-sync";
    } catch (error) {
      return "";
    }
    return "";
  }

  function shouldInspectQueue(previousUrl, nextUrl) {
    return String(previousUrl || "") !== String(nextUrl || "") && easyStoreRouteKind(nextUrl) !== "";
  }

  function normalizeShopeeNavigationMode(value) {
    const mode = String(value == null ? "" : value).trim().toLowerCase();
    return ["create", "update", "unknown"].includes(mode) ? mode : "unknown";
  }

  function classifyShopeeActionText(value) {
    const text = String(value == null ? "" : value).normalize("NFKC").toLocaleLowerCase("zh-TW");
    if (!text.trim()) return "unknown";
    const hasUpdate = /(?:重新|再次|再)同步|同步最新|重新發[佈布]|更新(?:商品|至蝦皮)?|sync\s*again|re-?sync|republish|update(?:\s+product)?/.test(text);
    const hasCreate = /連接商品(?:到|至)?\s*蝦皮|發[佈布](?:商品)?(?:到|至)?\s*蝦皮|上架(?:到|至)?\s*蝦皮|publish\s+(?:on|to)\s+shopee|新品上架/.test(text);
    if (hasUpdate === hasCreate) return "unknown";
    if (hasUpdate) return "update";
    if (hasCreate) return "create";
    return "unknown";
  }

  function directSyncNavigationMode(listingPolicy) {
    const policy = isPlainObject(listingPolicy) ? listingPolicy : {};
    const existingListingIds = Array.isArray(policy.existingListingIds)
      ? uniqueStrings(policy.existingListingIds)
      : [];
    return policy.decision === "new" && policy.allowCreate === true && existingListingIds.length === 0
      ? "create"
      : "unknown";
  }

  function resolveShopeeNavigationMode(pageText, storedMode) {
    const observedMode = classifyShopeeActionText(pageText);
    const rememberedMode = normalizeShopeeNavigationMode(storedMode);
    if (observedMode === "unknown") return rememberedMode;
    if (rememberedMode !== "unknown" && rememberedMode !== observedMode) return "unknown";
    return observedMode;
  }

  function validateString(value, name, errors, options) {
    const config = Object.assign({ required: true, min: 1, max: 200 }, options || {});
    if ((value == null || value === "") && !config.required) {
      return "";
    }
    if (typeof value !== "string") {
      errors.push(`${name} 必須是文字。`);
      return "";
    }
    const text = value.trim();
    if (text.length < config.min || text.length > config.max) {
      errors.push(`${name} 長度必須介於 ${config.min} 到 ${config.max} 個字元。`);
      return "";
    }
    return text;
  }

  function rejectUnknownKeys(object, allowedKeys, name, errors) {
    for (const key of Object.keys(object)) {
      if (!allowedKeys.has(key)) {
        errors.push(`${name} 含有不支援的欄位：${key}`);
      }
    }
  }

  function resolveAttributeKey(label) {
    return Object.keys(ATTRIBUTE_DEFINITIONS).find((key) =>
      exactApprovedMatch(label, ATTRIBUTE_DEFINITIONS[key].labels)
    ) || "";
  }

  function resolveLogisticsKey(label) {
    return Object.keys(LOGISTICS_DEFINITIONS).find((key) =>
      exactApprovedMatch(label, LOGISTICS_DEFINITIONS[key])
    ) || "";
  }

  function approvedValueOptions(key, value) {
    const text = String(value == null ? "" : value).trim();
    const normalized = normalizeText(text);
    const groups = [
      ["maple", "楓木"],
      ["poplar", "楊木"],
      ["jatoba", "孿葉蘇木"],
      ["hss", "h-s-s"],
      ["new", "新品", "全新"],
      ["electricguitar", "電吉他"],
      ["righthanded", "right-hand", "right hand", "右手", "右手琴"],
      ["lefthanded", "left-hand", "left hand", "左手", "左手琴"],
      ["yes", "是"],
      ["no", "否"],
      ["nowarranty", "無保固"],
      ["6", "6strings", "六弦"],
      ["1", "1piece", "單件"]
    ];
    const approved = [text];
    for (const group of groups) {
      if (group.some((candidate) => normalizeText(candidate) === normalized)) {
        approved.push(...group);
      }
    }
    if (key === "pickupConfiguration" && /^hss$/i.test(text)) {
      approved.push("HSS");
    }
    return uniqueStrings(approved);
  }

  function hsinchuSizeBand(totalCm) {
    const total = Number(totalCm);
    if (!Number.isFinite(total) || total <= 0 || total > 210) return "";
    if (total <= 60) return "S60";
    if (total <= 90) return "S90";
    if (total <= 120) return "S120";
    if (total <= 140) return "S150";
    if (total <= 160) return "S160";
    if (total <= 170) return "S170";
    if (total <= 180) return "S180";
    if (total <= 190) return "S190";
    if (total <= 200) return "S200";
    return "S210";
  }

  function logisticsOptionAliases(value) {
    const text = String(value == null ? "" : value).trim().toUpperCase();
    const match = /^S(60|90|120|150|160|170|180|190|200|210)$/.exec(text);
    if (!match) return uniqueStrings([value]);
    const code = Number(match[1]);
    const limitsByBand = {
      60: [0, 60],
      90: [61, 90],
      120: [91, 120],
      150: [121, 140],
      160: [141, 160],
      170: [161, 170],
      180: [171, 180],
      190: [181, 190],
      200: [191, 200],
      210: [201, 210]
    };
    const [lower, upper] = limitsByBand[code];
    const aliases = [text, `S ${code}`];
    if (lower === 0) {
      aliases.push(`0-${upper}cm`, `0～${upper} cm`, `${upper}cm（含）以下`, `≤${upper}cm`, `<=${upper}cm`);
    } else {
      aliases.push(
        `${lower}-${upper}cm`,
        `${lower}～${upper} cm`,
        `${lower}–${upper} cm`,
        `${upper}cm（含）以下`,
        `≤${upper}cm`,
        `<=${upper}cm`
      );
    }
    return uniqueStrings(aliases);
  }

  function numberOrNull(value, name, errors, max) {
    if (value == null || value === "") return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) {
      errors.push(`${name} 必須是大於 0 且不超過 ${max} 的數字，或 null。`);
      return null;
    }
    return value;
  }

  function feeOrNull(value, name, errors) {
    if (value == null || value === "") return null;
    if (!Number.isSafeInteger(value) || value < 0 || value > 100000) {
      errors.push(`${name} 必須是 0 到 100000 的整數，或 null。`);
      return null;
    }
    return value;
  }

  function validateQueuePayload(payload, now) {
    const errors = [];
    const timestamp = Number.isFinite(now) ? now : Date.now();
    if (!isPlainObject(payload)) {
      return { ok: false, errors: ["payload 必須是一般物件。"], value: null };
    }
    try {
      if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_PAYLOAD_BYTES) {
        errors.push(`payload 不可超過 ${MAX_PAYLOAD_BYTES} bytes。`);
      }
    } catch (error) {
      errors.push("payload 無法序列化。");
    }
    rejectUnknownKeys(payload, TOP_LEVEL_KEYS, "payload", errors);

    if (payload.schemaVersion !== SCHEMA_VERSION) {
      errors.push(`schemaVersion 必須是 ${SCHEMA_VERSION}。`);
    }
    const nonce = validateString(payload.nonce, "nonce", errors, { min: 8, max: 100 });
    if (nonce && !/^[A-Za-z0-9._:-]+$/.test(nonce)) {
      errors.push("nonce 格式不正確。");
    }
    if (!Number.isSafeInteger(payload.createdAt) || payload.createdAt <= 0) {
      errors.push("createdAt 必須是毫秒整數。");
    } else if (payload.createdAt > timestamp + 60 * 1000 || timestamp - payload.createdAt > MAX_TTL_MS + 60 * 1000) {
      errors.push("createdAt 不在允許的 30 分鐘時窗內。");
    }
    if (!Number.isSafeInteger(payload.expiresAt)) {
      errors.push("expiresAt 必須是毫秒整數。");
    } else {
      const remaining = payload.expiresAt - timestamp;
      if (remaining < MIN_TTL_MS) errors.push("資料已過期或即將過期。");
      if (remaining > MAX_TTL_MS + 5000) errors.push("資料有效期限不可超過 30 分鐘。");
      if (Number.isSafeInteger(payload.createdAt) && payload.expiresAt <= payload.createdAt) {
        errors.push("expiresAt 必須晚於 createdAt。");
      }
    }

    const productId = validateString(payload.productId, "productId", errors, { max: 200 });
    const easyStoreProductId = parsePositiveId(payload.easyStoreProductId);
    if (!easyStoreProductId) errors.push("easyStoreProductId 必須是正整數 ID。");
    const suppliedEasyStoreUrl = validateString(payload.easyStoreUrl, "easyStoreUrl", errors, { max: 500 });
    const easyStoreUrl = canonicalEasyStoreProductUrl(easyStoreProductId);
    if (suppliedEasyStoreUrl) {
      try {
        const url = new URL(suppliedEasyStoreUrl);
        if (!easyStoreUrl || url.href !== easyStoreUrl) {
          errors.push("easyStoreUrl 必須是由 easyStoreProductId 重建的標準商品網址。");
        }
      } catch (error) {
        errors.push("easyStoreUrl 格式不正確。");
      }
    }
    const sku = validateString(payload.sku, "sku", errors, { max: 120 });
    if (sku && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(sku)) {
      errors.push("sku 只可使用英數字、點、底線、斜線與連字號。");
    }
    const title = validateString(payload.title, "title", errors, { required: false, max: 255 });
    const publishMode = validateString(payload.publishMode, "publishMode", errors, { max: 20 });
    if (publishMode && !["auto", "fill-only"].includes(publishMode)) {
      errors.push("publishMode 必須是 auto 或 fill-only。");
    }
    const brand = validateString(payload.brand, "brand", errors, { required: false, max: 120 });

    let listingPolicy = null;
    if (!isPlainObject(payload.listingPolicy)) {
      errors.push("listingPolicy 必須是物件。");
    } else {
      rejectUnknownKeys(
        payload.listingPolicy,
        new Set(["decision", "matchKey", "allowCreate", "existingListingIds", "onZero", "onOne", "onMultiple"]),
        "listingPolicy",
        errors
      );
      const decision = validateString(payload.listingPolicy.decision, "listingPolicy.decision", errors, { max: 20 });
      if (!['auto', 'new', 'existing'].includes(decision)) {
        errors.push("listingPolicy.decision 必須是 auto、new 或 existing。");
      }
      const matchKey = validateString(payload.listingPolicy.matchKey, "listingPolicy.matchKey", errors, { max: 20 });
      if (matchKey !== "sku") errors.push("listingPolicy.matchKey 必須是 sku。");
      if (typeof payload.listingPolicy.allowCreate !== "boolean") {
        errors.push("listingPolicy.allowCreate 必須是布林值。");
      }
      if (payload.listingPolicy.allowCreate !== (decision === 'new')) {
        errors.push("只有明確確認蝦皮無既有商品時，listingPolicy.allowCreate 才能為 true。");
      }
      const existingListingIds = [];
      if (!Array.isArray(payload.listingPolicy.existingListingIds) || payload.listingPolicy.existingListingIds.length > 20) {
        errors.push("listingPolicy.existingListingIds 必須是最多 20 筆的陣列。");
      } else {
        payload.listingPolicy.existingListingIds.forEach((value, index) => {
          const id = validateString(value, `listingPolicy.existingListingIds[${index}]`, errors, { max: 100 });
          if (id && !existingListingIds.includes(id)) existingListingIds.push(id);
        });
      }
      if (existingListingIds.length > 0 && decision !== "existing") {
        errors.push("已有蝦皮商品編號時 listingPolicy.decision 必須是 existing。");
      }
      const onZero = validateString(payload.listingPolicy.onZero, "listingPolicy.onZero", errors, { max: 40 });
      const onOne = validateString(payload.listingPolicy.onOne, "listingPolicy.onOne", errors, { max: 20 });
      const onMultiple = validateString(payload.listingPolicy.onMultiple, "listingPolicy.onMultiple", errors, { max: 20 });
      if (onZero !== "create-only-if-confirmed") errors.push("listingPolicy.onZero 規則不正確。");
      if (onOne !== "update") errors.push("listingPolicy.onOne 規則不正確。");
      if (onMultiple !== "block") errors.push("listingPolicy.onMultiple 規則不正確。");
      listingPolicy = {
        decision,
        matchKey,
        allowCreate: payload.listingPolicy.allowCreate === true,
        existingListingIds,
        onZero,
        onOne,
        onMultiple
      };
    }

    const categoryPath = [];
    if (!Array.isArray(payload.categoryPath) || payload.categoryPath.length < 1 || payload.categoryPath.length > 8) {
      errors.push("categoryPath 必須有 1 到 8 層。");
    } else {
      payload.categoryPath.forEach((entry, index) => {
        categoryPath.push(validateString(entry, `categoryPath[${index}]`, errors, { max: 120 }));
      });
    }

    const attributes = [];
    if (!Array.isArray(payload.attributes) || payload.attributes.length > 30) {
      errors.push("attributes 必須是最多 30 筆的陣列。");
    } else {
      const seenLabels = new Set();
      payload.attributes.forEach((row, index) => {
        const name = `attributes[${index}]`;
        if (!isPlainObject(row)) {
          errors.push(`${name} 必須是物件。`);
          return;
        }
        rejectUnknownKeys(row, new Set(["label", "value", "confidence", "note"]), name, errors);
        const label = validateString(row.label, `${name}.label`, errors, { max: 120 });
        const fieldValue = validateString(row.value, `${name}.value`, errors, { max: 300 });
        const confidence = validateString(row.confidence, `${name}.confidence`, errors, { max: 20 });
        if (!['high', 'medium', 'low'].includes(confidence)) {
          errors.push(`${name}.confidence 必須是 high、medium 或 low。`);
        }
        const note = validateString(row.note, `${name}.note`, errors, { required: false, max: 500 });
        const normalizedLabel = normalizeText(label);
        if (seenLabels.has(normalizedLabel)) errors.push(`${name}.label 不可重複。`);
        seenLabels.add(normalizedLabel);
        attributes.push({
          label,
          value: fieldValue,
          confidence,
          note
        });
      });
    }

    let packageInfo = null;
    if (!isPlainObject(payload.package)) {
      errors.push("package 必須是物件。");
    } else {
      rejectUnknownKeys(payload.package, new Set(["lengthCm", "widthCm", "heightCm", "weightKg"]), "package", errors);
      packageInfo = {
        lengthCm: numberOrNull(payload.package.lengthCm, "package.lengthCm", errors, 10000),
        widthCm: numberOrNull(payload.package.widthCm, "package.widthCm", errors, 10000),
        heightCm: numberOrNull(payload.package.heightCm, "package.heightCm", errors, 10000),
        weightKg: numberOrNull(payload.package.weightKg, "package.weightKg", errors, 1000)
      };
    }

    let logistics = null;
    if (!isPlainObject(payload.logistics)) {
      errors.push("logistics 必須是物件。");
    } else {
      rejectUnknownKeys(
        payload.logistics,
        new Set(["decision", "packageTotalCm", "methods", "requiresConfirmation"]),
        "logistics",
        errors
      );
      const decision = validateString(payload.logistics.decision, "logistics.decision", errors, {
        required: false,
        max: 30
      });
      if (decision && !["convenience", "home", "freight"].includes(decision)) {
        errors.push("logistics.decision 不支援。");
      }
      const packageTotalCm = numberOrNull(payload.logistics.packageTotalCm, "logistics.packageTotalCm", errors, 30000);
      if (typeof payload.logistics.requiresConfirmation !== "boolean") {
        errors.push("logistics.requiresConfirmation 必須是布林值。");
      }
      const methods = [];
      if (!Array.isArray(payload.logistics.methods) || payload.logistics.methods.length > 20) {
        errors.push("logistics.methods 必須是最多 20 筆的陣列。");
      } else {
        const seenMethods = new Set();
        payload.logistics.methods.forEach((row, index) => {
          const name = `logistics.methods[${index}]`;
          if (!isPlainObject(row)) {
            errors.push(`${name} 必須是物件。`);
            return;
          }
          rejectUnknownKeys(row, new Set(["label", "enabled", "option", "feeTwd", "sellerPays"]), name, errors);
          const label = validateString(row.label, `${name}.label`, errors, { max: 120 });
          const key = resolveLogisticsKey(label);
          if (!key) errors.push(`${name}.label 不是核准的物流名稱。`);
          if (seenMethods.has(key || normalizeText(label))) errors.push(`${name}.label 不可重複。`);
          seenMethods.add(key || normalizeText(label));
          if (typeof row.enabled !== "boolean") errors.push(`${name}.enabled 必須是布林值。`);
          if (typeof row.sellerPays !== "boolean") errors.push(`${name}.sellerPays 必須是布林值。`);
          const option = validateString(row.option, `${name}.option`, errors, { required: false, max: 120 });
          const feeTwd = feeOrNull(row.feeTwd, `${name}.feeTwd`, errors);
          methods.push({
            label,
            enabled: row.enabled === true,
            option,
            feeTwd,
            sellerPays: row.sellerPays === true
          });
        });
        Object.keys(LOGISTICS_DEFINITIONS).forEach((key) => {
          if (!seenMethods.has(key)) {
            errors.push(`logistics.methods 缺少「${LOGISTICS_DEFINITIONS[key][0]}」設定。`);
          }
        });
      }
      logistics = {
        decision,
        packageTotalCm,
        methods,
        requiresConfirmation: payload.logistics.requiresConfirmation === true
      };
    }

    let preorder = null;
    if (!isPlainObject(payload.preorder)) {
      errors.push("preorder 必須是物件。");
    } else {
      rejectUnknownKeys(payload.preorder, new Set(["enabled", "days"]), "preorder", errors);
      if (typeof payload.preorder.enabled !== "boolean") errors.push("preorder.enabled 必須是布林值。");
      if (!Number.isInteger(payload.preorder.days) || payload.preorder.days < 1 || payload.preorder.days > 30) {
        errors.push("preorder.days 必須是 1 到 30 的整數。");
      }
      preorder = {
        enabled: payload.preorder.enabled === true,
        days: payload.preorder.days
      };
    }

    let guard = null;
    if (!isPlainObject(payload.guard)) {
      errors.push("guard 必須是物件。");
    } else {
      rejectUnknownKeys(payload.guard, new Set(["brand", "model", "color", "identityStatus"]), "guard", errors);
      guard = {
        brand: validateString(payload.guard.brand, "guard.brand", errors, { required: false, max: 120 }),
        model: validateString(payload.guard.model, "guard.model", errors, { required: false, max: 120 }),
        color: validateString(payload.guard.color, "guard.color", errors, { required: false, max: 120 }),
        identityStatus: validateString(payload.guard.identityStatus, "guard.identityStatus", errors, {
          required: false,
          max: 30
        })
      };
    }

    if (packageInfo && logistics) {
      const dimensions = [packageInfo.lengthCm, packageInfo.widthCm, packageInfo.heightCm];
      if (dimensions.every((value) => value !== null)) {
        const total = dimensions.reduce((sum, value) => sum + value, 0);
        if (logistics.packageTotalCm !== null && Math.abs(logistics.packageTotalCm - total) > 0.11) {
          errors.push("logistics.packageTotalCm 與 package 三邊總和不符。");
        }
        const hct = logistics.methods.find((method) => resolveLogisticsKey(method.label) === "hct");
        const expectedBand = Math.max(...dimensions) <= 150 && packageInfo.weightKg !== null && packageInfo.weightKg <= 20
          ? hsinchuSizeBand(total)
          : "";
        if (hct && hct.enabled && (!expectedBand || !hct.option || !exactApprovedMatch(hct.option, logisticsOptionAliases(expectedBand)))) {
          errors.push("新竹物流級距與包裝尺寸／重量不相符。");
        }
        if (logistics.decision === "freight" && expectedBand && (!hct || !hct.enabled)) {
          errors.push("大型商品在符合新竹物流限制時必須同時開啟新竹物流。");
        }
      }
      const sellerLargeHome = logistics.methods.find((method) => resolveLogisticsKey(method.label) === "sellerLargeHome");
      if (logistics.decision === "freight") {
        if (
          !sellerLargeHome ||
          !sellerLargeHome.enabled ||
          sellerLargeHome.feeTwd !== SELLER_LARGE_HOME_FEE_TWD ||
          sellerLargeHome.sellerPays
        ) {
          errors.push(`大型商品必須開啟賣家宅配，並固定收取 NT$${SELLER_LARGE_HOME_FEE_TWD}。`);
        }
        logistics.methods.forEach((method) => {
          const key = resolveLogisticsKey(method.label);
          if (!['hct', 'sellerLargeHome'].includes(key) && method.enabled) {
            errors.push(`大型商品不應開啟「${method.label}」。`);
          }
        });
      } else if (sellerLargeHome && sellerLargeHome.enabled) {
        errors.push("非大型商品不應開啟大型／超重賣家宅配。");
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      value: errors.length === 0 ? {
        schemaVersion: SCHEMA_VERSION,
        nonce,
        createdAt: payload.createdAt,
        expiresAt: payload.expiresAt,
        productId,
        easyStoreProductId,
        easyStoreUrl,
        sku,
        title,
        publishMode,
        listingPolicy,
        categoryPath,
        brand,
        attributes,
        package: packageInfo,
        logistics,
        preorder,
        guard
      } : null
    };
  }

  function extractProductIds(urlValue) {
    const ids = new Set();
    let url;
    try {
      url = new URL(String(urlValue));
    } catch (error) {
      return [];
    }
    const routeKind = easyStoreRouteKind(url.href);
    const storeKeys = ["store_product_id", "store_product_ids"];
    const genericKeys = ["product_id", "product_ids", "productId", "id"];
    const hasStoreId = storeKeys.some((key) => String(url.searchParams.get(key) || "").trim());
    const queryKeys = routeKind === "shopee-sync" && hasStoreId ? storeKeys : genericKeys;
    queryKeys.forEach((key) => {
      const raw = url.searchParams.get(key);
      if (!raw) return;
      raw.split(",").forEach((entry) => {
        const id = parsePositiveId(entry);
        if (id) ids.add(id);
      });
    });
    const matches = url.pathname.matchAll(/\/products?(?:\/sync)?\/([1-9]\d{0,29})(?:\/|$)/g);
    for (const match of matches) ids.add(match[1]);
    return Array.from(ids);
  }

  function textContainsExactToken(text, token) {
    const escaped = String(token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!escaped) return false;
    return new RegExp(`(^|[^A-Za-z0-9._/-])${escaped}(?![A-Za-z0-9._/-])`, "i").test(String(text || ""));
  }

  function pruneAndMergeQueue(currentQueue, payload, receivedAt, now) {
    const timestamp = Number.isFinite(now) ? now : Date.now();
    const next = {};
    if (isPlainObject(currentQueue)) {
      Object.entries(currentQueue).forEach(([key, record]) => {
        if (!isPlainObject(record) || !isPlainObject(record.payload)) return;
        const validation = validateQueuePayload(record.payload, timestamp);
        if (validation.ok) {
          next[key] = {
            payload: validation.value,
            receivedAt: Number.isFinite(record.receivedAt) ? record.receivedAt : timestamp,
            navigationMode: normalizeShopeeNavigationMode(record.navigationMode),
            navigationObservedAt: Number.isFinite(record.navigationObservedAt) ? record.navigationObservedAt : null
          };
        }
      });
    }
    next[payload.easyStoreProductId] = {
      payload,
      receivedAt: Number.isFinite(receivedAt) ? receivedAt : timestamp
    };
    return Object.fromEntries(
      Object.entries(next)
        .sort((left, right) => right[1].receivedAt - left[1].receivedAt)
        .slice(0, MAX_QUEUE_ITEMS)
    );
  }

  function withQueueNavigationMode(queue, easyStoreProductId, nonce, navigationMode, now) {
    if (!isPlainObject(queue)) return queue;
    const key = parsePositiveId(easyStoreProductId);
    const record = key && queue[key];
    if (!isPlainObject(record) || !isPlainObject(record.payload) || record.payload.nonce !== nonce) return queue;
    return Object.assign({}, queue, {
      [key]: Object.assign({}, record, {
        navigationMode: normalizeShopeeNavigationMode(navigationMode),
        navigationObservedAt: Number.isFinite(now) ? now : Date.now()
      })
    });
  }

  function selectQueueRecord(queue, pageUrl, pageText, now) {
    if (!isPlainObject(queue)) return null;
    const ids = new Set(extractProductIds(pageUrl));
    if (ids.size === 0) return null;
    const routeKind = easyStoreRouteKind(pageUrl);
    const candidates = Object.values(queue)
      .filter((record) => isPlainObject(record) && isPlainObject(record.payload))
      .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0));
    for (const record of candidates) {
      const validation = validateQueuePayload(record.payload, now);
      if (!validation.ok) continue;
      const payload = validation.value;
      const idMatches = ids.has(payload.easyStoreProductId);
      const identityMatches = routeKind === "product" || textContainsExactToken(pageText, payload.sku);
      if (idMatches && identityMatches) {
        return {
          payload,
          receivedAt: record.receivedAt,
          navigationMode: normalizeShopeeNavigationMode(record.navigationMode),
          navigationObservedAt: Number.isFinite(record.navigationObservedAt) ? record.navigationObservedAt : null
        };
      }
    }
    return null;
  }

  function listingSafetyGate(payload, navigationMode) {
    const reasons = [];
    const row = payload && typeof payload === "object" ? payload : {};
    const mode = normalizeShopeeNavigationMode(navigationMode);
    const policy = isPlainObject(row.listingPolicy) ? row.listingPolicy : {};
    const existingListingIds = Array.isArray(policy.existingListingIds) ? uniqueStrings(policy.existingListingIds) : [];
    if (existingListingIds.length > 1) {
      reasons.push(`同一 SKU 已對到 ${existingListingIds.length} 個蝦皮商品，為避免更新錯商品已停止。`);
    } else if (mode === "unknown") {
      reasons.push(existingListingIds.length > 0 || policy.decision === "existing"
        ? "已記錄蝦皮既有商品，但 EasyStore 沒有顯示明確的更新動作；請先用 Match product 配對後再重新同步。"
        : "無法確認這是更新舊商品還是建立新品，為避免重複已停止。");
    } else if (mode === "create" && existingListingIds.length > 0) {
      reasons.push("已記錄蝦皮既有商品；請使用 Match product 配對／更新，不能建立新品。");
    } else if (mode === "create" && policy.allowCreate !== true) {
      reasons.push(policy.decision === "existing"
        ? "你已標示蝦皮有舊商品；請先從蝦皮匯入並使用 Match product 配對，不能直接新增。"
        : "尚未明確確認蝦皮沒有相同 SKU，不能建立新品。");
    }
    return { ok: reasons.length === 0, reasons };
  }

  function autoPublishGate(payload, report, navigationMode) {
    const row = payload && typeof payload === "object" ? payload : {};
    const result = report && typeof report === "object" ? report : {};
    const reasons = listingSafetyGate(row, navigationMode).reasons.slice();
    if (row.publishMode !== "auto") reasons.push("這件商品設定為填寫後人工確認。");
    if (row.logistics && row.logistics.requiresConfirmation === true) reasons.push("物流仍需人工確認。");
    if (Array.isArray(result.missing) && result.missing.length > 0) reasons.push(`仍有 ${result.missing.length} 個待補欄位。`);
    return { ok: reasons.length === 0, reasons };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    QUEUE_STORAGE_KEY,
    QUEUE_STORAGE_AREA,
    MAX_TTL_MS,
    SELLER_LARGE_HOME_FEE_TWD,
    ATTRIBUTE_DEFINITIONS,
    LOGISTICS_DEFINITIONS,
    normalizeText,
    normalizeShopeeNavigationMode,
    classifyShopeeActionText,
    directSyncNavigationMode,
    resolveShopeeNavigationMode,
    exactApprovedMatch,
    logisticsOptionMatch,
    uniqueStrings,
    parsePositiveId,
    canonicalEasyStoreProductUrl,
    easyStoreRouteKind,
    shouldInspectQueue,
    resolveAttributeKey,
    resolveLogisticsKey,
    approvedValueOptions,
    hsinchuSizeBand,
    logisticsOptionAliases,
    validateQueuePayload,
    extractProductIds,
    textContainsExactToken,
    pruneAndMergeQueue,
    withQueueNavigationMode,
    selectQueueRecord,
    listingSafetyGate,
    autoPublishGate
  });
});
