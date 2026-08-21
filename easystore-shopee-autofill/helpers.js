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

  const SCHEMA_VERSION = 5;
  const WORKFLOW_VERSION = "youzi-four-channel-listing-v2";
  const QUEUE_STORAGE_KEY = "youziShopeeAutofillQueueV2";
  // Content scripts can always share storage.local across the Operations and
  // EasyStore tabs. storage.session requires a service-worker access-level
  // bootstrap and was observed to drop the handoff on store computers.
  const QUEUE_STORAGE_AREA = "local";
  const MAX_QUEUE_ITEMS = 20;
  const MAX_TTL_MS = 30 * 60 * 1000;
  const MIN_TTL_MS = 1000;
  const MAX_PAYLOAD_BYTES = 64 * 1024;
  const SELLER_LARGE_HOME_FEE_TWD = 100;
  const DEFAULT_SHOPEE_ENTRY_LABELS = Object.freeze([
    "連接商品到蝦皮購物 Shopee Taiwan",
    "連接商品到蝦皮購物",
    "更新到蝦皮購物",
    "發佈商品到蝦皮購物",
    "發布商品到蝦皮購物",
    "發佈到蝦皮購物",
    "發布到蝦皮購物",
    "同步到蝦皮購物",
    "蝦皮購物"
  ]);
  const MAX_SHOPEE_ENTRY_TEXT_LENGTH = 180;

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

  const CATEGORY_SEGMENT_DEFINITIONS = Object.freeze({
    "樂器與樂器配件": Object.freeze(["樂器與樂器配件", "樂器與配件"]),
    "吉他、貝斯": Object.freeze(["吉他、貝斯", "吉他與貝斯", "吉他及貝斯"])
  });
  const MUSIC_CATEGORY_FAMILIES = Object.freeze([
    "鍵盤樂器", "打擊樂器", "管樂器", "樂器配件", "其他", "弦樂器"
  ]);

  const TOP_LEVEL_KEYS = new Set([
    "schemaVersion",
    "workflowVersion",
    "jobId",
    "snapshotId",
    "snapshotFingerprint",
    "nonce",
    "createdAt",
    "expiresAt",
    "productId",
    "easyStoreProductId",
    "easyStoreUrl",
    "sku",
    "title",
    "publishMode",
    "variantGroup",
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

  function canonicalCategorySegment(value) {
    const segment = String(value == null ? "" : value).trim();
    const canonical = Object.keys(CATEGORY_SEGMENT_DEFINITIONS).find((key) =>
      exactApprovedMatch(segment, CATEGORY_SEGMENT_DEFINITIONS[key])
    );
    return canonical || segment;
  }

  function categorySegmentOptions(value) {
    const canonical = canonicalCategorySegment(value);
    return CATEGORY_SEGMENT_DEFINITIONS[canonical] || [canonical];
  }

  function canonicalCategoryPath(values) {
    const path = Array.isArray(values)
      ? values.map(canonicalCategorySegment).filter(Boolean)
      : [];
    if (path.some((segment) => exactApprovedMatch(segment, categorySegmentOptions("吉他、貝斯")))) {
      return ["愛好與收藏品", "樂器與樂器配件", "弦樂器", "吉他、貝斯"];
    }
    if (exactApprovedMatch(path[0], ["樂器與樂器配件"])) {
      path.unshift("愛好與收藏品");
    } else if (MUSIC_CATEGORY_FAMILIES.some((family) => exactApprovedMatch(path[0], [family]))) {
      path.unshift("愛好與收藏品", "樂器與樂器配件");
    }
    return path;
  }

  function orderedCategoryPathMatch(value, segments) {
    const text = normalizeText(value);
    const approved = canonicalCategoryPath(segments).map(normalizeText).filter(Boolean);
    if (!text || approved.length === 0) return false;
    let cursor = 0;
    for (const segment of approved) {
      const index = text.indexOf(segment, cursor);
      if (index < 0) return false;
      cursor = index + segment.length;
    }
    return true;
  }

  function categoryLabelTextMatch(value) {
    const text = String(value == null ? "" : value)
      .replace(/^[\s\u00a0*＊•·]+/, "")
      .replace(/[\s\u00a0]*(?:ⓘ|ℹ|information|info(?:_outline)?|說明)+[\s\u00a0]*$/gi, "")
      .normalize("NFKC")
      .toLocaleLowerCase("zh-TW")
      .replace(/[\s\u00a0]+/g, "");
    return text === "分類" || text === "category";
  }

  function categoryActionScore(candidate) {
    if (!isPlainObject(candidate)) return Number.NEGATIVE_INFINITY;
    const semantic = String(candidate.semantic || "").normalize("NFKC").toLocaleLowerCase("zh-TW");
    const tagName = String(candidate.tagName || "").toUpperCase();
    const role = String(candidate.role || "").toLowerCase();
    const rightRatio = Number(candidate.rightRatio);
    const width = Number(candidate.width);
    const height = Number(candidate.height);
    let score = 0;
    if (/edit|pencil|修改|編輯|鉛筆/.test(semantic)) score += 420;
    if (/info|help|提示|說明/.test(semantic)) score -= 260;
    if (/^上架$|publish|submit|save|儲存/.test(semantic.trim())) score -= 500;
    if (tagName === "BUTTON" || tagName === "A" || role === "button") score += 120;
    if (candidate.hasIcon === true || tagName === "SVG") score += 70;
    if (Number.isFinite(rightRatio)) {
      if (rightRatio >= 0.72) score += 180;
      else if (rightRatio >= 0.5) score += 45;
      else score -= 70;
    }
    if (Number.isFinite(width) && Number.isFinite(height)) {
      if (width > 240 || height > 100) score -= 300;
      else if (width <= 90 && height <= 70) score += 45;
    }
    return score;
  }

  function smallestCategoryCardIndex(candidates) {
    if (!Array.isArray(candidates)) return -1;
    return candidates.findIndex((candidate) => {
      if (!isPlainObject(candidate)) return false;
      const width = Number(candidate.width);
      const height = Number(candidate.height);
      const actionScores = Array.isArray(candidate.actionScores) ? candidate.actionScores : [];
      return candidate.hasPrompt === true
        && Number.isFinite(width)
        && Number.isFinite(height)
        && width > 180
        && width <= 1400
        && height > 45
        && height <= 560
        && actionScores.some((score) => Number(score) >= 200);
    });
  }

  function nextCategoryStage(currentIndex, totalSegments, optionFound, fullPathApplied) {
    const index = Number(currentIndex);
    const total = Number(totalSegments);
    if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index > total) {
      return "invalid";
    }
    if (index < total) {
      return optionFound === true ? "click-option" : "wait-option";
    }
    return fullPathApplied === true ? "complete" : "wait-application";
  }

  function nonNegativeCategoryLevel(value) {
    if (value === null || value === undefined || typeof value === "boolean") return -1;
    if (typeof value === "string" && !value.trim()) return -1;
    const level = Number(value);
    return Number.isInteger(level) && level >= 0 ? level : -1;
  }

  function finiteCategoryMetric(value) {
    if (value === null || value === undefined || typeof value === "boolean") return Number.NaN;
    if (typeof value === "string" && !value.trim()) return Number.NaN;
    const metric = Number(value);
    return Number.isFinite(metric) ? metric : Number.NaN;
  }

  function normalizeCategorySearchState(value, levelIndex) {
    const level = nonNegativeCategoryLevel(levelIndex);
    if (level < 0) return null;
    if (!isPlainObject(value) || nonNegativeCategoryLevel(value.levelIndex) !== level) {
      return {
        levelIndex: level,
        initialized: false,
        attempts: 0,
        lastObservedTop: null
      };
    }
    const attempts = finiteCategoryMetric(value.attempts);
    const lastObservedTop = finiteCategoryMetric(value.lastObservedTop);
    return {
      levelIndex: level,
      initialized: value.initialized === true,
      attempts: Number.isInteger(attempts) && attempts >= 0 ? attempts : 0,
      lastObservedTop: Number.isFinite(lastObservedTop) && lastObservedTop >= 0
        ? lastObservedTop
        : null
    };
  }

  function categoryOptionMatchIndexes(options, target, levelIndex) {
    if (!Array.isArray(options)) return [];
    const level = nonNegativeCategoryLevel(levelIndex);
    if (level < 0 || !normalizeText(target)) return [];
    const matches = [];
    options.forEach((option, index) => {
      if (!isPlainObject(option)
        || option.visible !== true
        || option.inCategoryModal !== true
        || option.inActiveColumn !== true
        || option.disabled === true
        || nonNegativeCategoryLevel(option.levelIndex) !== level) {
        return;
      }
      if (exactApprovedMatch(option.text, categorySegmentOptions(target))) matches.push(index);
    });
    return matches;
  }

  function exactVisibleCategoryOptionIndex(options, target, levelIndex) {
    const matches = categoryOptionMatchIndexes(options, target, levelIndex);
    return matches.length === 1 ? matches[0] : -1;
  }

  function safeCategoryScrollContainerIndex(candidates, levelIndex) {
    if (!Array.isArray(candidates)) return -1;
    const level = nonNegativeCategoryLevel(levelIndex);
    if (level < 0) return -1;
    const safe = [];
    candidates.forEach((candidate, index) => {
      if (!isPlainObject(candidate)
        || candidate.visible !== true
        || candidate.inCategoryModal !== true
        || candidate.isListColumn !== true
        || nonNegativeCategoryLevel(candidate.levelIndex) !== level) {
        return;
      }
      const scrollTop = finiteCategoryMetric(candidate.scrollTop);
      const clientHeight = finiteCategoryMetric(candidate.clientHeight);
      const scrollHeight = finiteCategoryMetric(candidate.scrollHeight);
      if (!Number.isFinite(scrollTop)
        || !Number.isFinite(clientHeight)
        || !Number.isFinite(scrollHeight)
        || scrollTop < 0
        || clientHeight <= 0
        // A horizontal rail or a fixed-height wrapper can still advertise an
        // overflow style. Only a column with real vertical range is safe.
        || scrollHeight <= clientHeight + 1) {
        return;
      }
      safe.push({ index, active: candidate.active === true });
    });
    const active = safe.filter((candidate) => candidate.active);
    if (active.length === 1) return active[0].index;
    return -1;
  }

  function planCategorySearchStep(input) {
    const row = isPlainObject(input) ? input : {};
    const levelIndex = nonNegativeCategoryLevel(row.levelIndex);
    const state = normalizeCategorySearchState(row.state, levelIndex);
    const stop = (reason, currentState) => ({
      action: "stop",
      reason,
      optionIndex: -1,
      containerIndex: -1,
      scrollTop: null,
      state: currentState
    });
    if (!state || !normalizeText(row.target)) return stop("invalid-input", state);

    const optionMatches = categoryOptionMatchIndexes(row.options, row.target, levelIndex);
    if (optionMatches.length > 1) return stop("ambiguous-option", state);
    if (optionMatches.length === 1) {
      return {
        action: "select",
        reason: "exact-option",
        optionIndex: optionMatches[0],
        containerIndex: -1,
        scrollTop: null,
        state
      };
    }

    const containerIndex = safeCategoryScrollContainerIndex(row.containers, levelIndex);
    if (containerIndex < 0) return stop("unsafe-container", state);
    const container = row.containers[containerIndex];
    const currentTop = finiteCategoryMetric(container.scrollTop);
    const clientHeight = finiteCategoryMetric(container.clientHeight);
    const maxScrollTop = Math.max(0, finiteCategoryMetric(container.scrollHeight) - clientHeight);
    const epsilon = 1;
    const maxAttemptsValue = Number(row.maxAttempts);
    const maxAttempts = Number.isInteger(maxAttemptsValue) && maxAttemptsValue > 0
      ? Math.min(maxAttemptsValue, 100)
      : 40;

    if (!state.initialized && currentTop > epsilon) {
      return {
        action: "scroll",
        reason: "reset-level",
        optionIndex: -1,
        containerIndex,
        scrollTop: 0,
        state: Object.assign({}, state, {
          initialized: true,
          lastObservedTop: currentTop
        })
      };
    }
    const initializedState = state.initialized ? state : Object.assign({}, state, { initialized: true });
    if (currentTop >= maxScrollTop - epsilon) return stop("end-of-list", initializedState);
    if (initializedState.attempts >= maxAttempts) return stop("attempt-limit", initializedState);
    if (initializedState.lastObservedTop !== null
      && Math.abs(currentTop - initializedState.lastObservedTop) <= epsilon) {
      return stop("no-scroll-progress", initializedState);
    }

    // Keep a 20% overlap between viewports so short or partly clipped rows are
    // never skipped while the active category column is scanned downward.
    const increment = Math.max(48, Math.floor(clientHeight * 0.8));
    const nextTop = Math.min(maxScrollTop, currentTop + increment);
    if (nextTop <= currentTop + epsilon) return stop("end-of-list", initializedState);
    return {
      action: "scroll",
      reason: "scan-next-segment",
      optionIndex: -1,
      containerIndex,
      scrollTop: nextTop,
      state: Object.assign({}, initializedState, {
        attempts: initializedState.attempts + 1,
        lastObservedTop: currentTop
      })
    };
  }

  function shopeeEntryTextMatch(value, approvedTexts) {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue || normalizedValue.length > MAX_SHOPEE_ENTRY_TEXT_LENGTH) {
      return false;
    }
    const labels = approvedTexts === undefined ? DEFAULT_SHOPEE_ENTRY_LABELS : approvedTexts;
    if (!Array.isArray(labels)) {
      return false;
    }
    return labels.some((label) => {
      const normalizedLabel = normalizeText(label);
      return normalizedLabel && (
        normalizedValue === normalizedLabel
        || normalizedValue.startsWith(normalizedLabel)
      );
    });
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
    return ["create", "update", "unknown", "conflict"].includes(mode) ? mode : "unknown";
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

  function expectedShopeeNavigationMode(listingPolicy) {
    const policy = isPlainObject(listingPolicy) ? listingPolicy : {};
    if (policy.mode === "create-new") return "create";
    if (["update-existing", "add-variant-to-existing"].includes(policy.mode)) return "update";
    return "unknown";
  }

  function directSyncNavigationMode(listingPolicy) {
    return expectedShopeeNavigationMode(listingPolicy);
  }

  function resolveShopeeNavigationMode(pageText, storedMode) {
    const observedMode = classifyShopeeActionText(pageText);
    const rememberedMode = normalizeShopeeNavigationMode(storedMode);
    if (observedMode === "unknown") return rememberedMode === "conflict" ? "conflict" : rememberedMode;
    if (rememberedMode !== "unknown" && rememberedMode !== observedMode) return "conflict";
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

  function approvedBrandOptions(value) {
    const brand = String(value == null ? "" : value).normalize("NFKC").trim();
    return brand
      ? [brand]
      : ["NOBRAND", "NO BRAND", "No Brand", "NoBrand", "無品牌", "無廠牌"];
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
    const workflowVersion = validateString(payload.workflowVersion, "workflowVersion", errors, { max: 80 });
    if (workflowVersion !== WORKFLOW_VERSION) {
      errors.push(`workflowVersion 必須是 ${WORKFLOW_VERSION}。`);
    }
    const jobId = validateString(payload.jobId, "jobId", errors, { max: 200 });
    const snapshotId = validateString(payload.snapshotId, "snapshotId", errors, { max: 200 });
    const snapshotFingerprint = validateString(payload.snapshotFingerprint, "snapshotFingerprint", errors, { max: 128 });
    if (snapshotFingerprint && !/^[a-f0-9]{64}$/i.test(snapshotFingerprint)) {
      errors.push("snapshotFingerprint 必須是 64 位十六進位雜湊。");
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
    const publishMode = validateString(payload.publishMode, "publishMode", errors, { max: 40 });
    if (publishMode && !["auto", "fill-only", "add-variant-to-existing"].includes(publishMode)) {
      errors.push("publishMode 必須是 auto、fill-only 或 add-variant-to-existing。");
    }
    const brand = validateString(payload.brand, "brand", errors, { required: false, max: 120 });

    let listingPolicy = null;
    if (!isPlainObject(payload.listingPolicy)) {
      errors.push("listingPolicy 必須是物件。");
    } else {
      rejectUnknownKeys(payload.listingPolicy, new Set([
        "mode", "identitySource", "platformListingIds", "preflightSkuSearch", "uncertainSubmitRecovery"
      ]), "listingPolicy", errors);
      const mode = validateString(payload.listingPolicy.mode, "listingPolicy.mode", errors, { max: 40 });
      if (!["create-new", "update-existing", "add-variant-to-existing"].includes(mode)) {
        errors.push("listingPolicy.mode 不支援。");
      }
      const identitySource = validateString(payload.listingPolicy.identitySource, "listingPolicy.identitySource", errors, { max: 40 });
      const platformListingIds = [];
      if (!Array.isArray(payload.listingPolicy.platformListingIds) || payload.listingPolicy.platformListingIds.length > 20) {
        errors.push("listingPolicy.platformListingIds 必須是最多 20 筆的陣列。");
      } else {
        payload.listingPolicy.platformListingIds.forEach((value, index) => {
          const id = validateString(value, `listingPolicy.platformListingIds[${index}]`, errors, { max: 100 });
          if (id && !platformListingIds.includes(id)) platformListingIds.push(id);
        });
      }
      if (payload.listingPolicy.preflightSkuSearch !== false) {
        errors.push("listingPolicy.preflightSkuSearch 必須是 false。");
      }
      const uncertainSubmitRecovery = validateString(
        payload.listingPolicy.uncertainSubmitRecovery,
        "listingPolicy.uncertainSubmitRecovery",
        errors,
        { max: 40 }
      );
      if (uncertainSubmitRecovery !== "exact-sku-only") {
        errors.push("listingPolicy.uncertainSubmitRecovery 必須是 exact-sku-only。");
      }
      const expectsNewDraft = mode === "create-new";
      if (identitySource !== (expectsNewDraft ? "new-draft" : "central-platform-id")) {
        errors.push("listingPolicy.identitySource 與 mode 不一致。");
      }
      if (platformListingIds.length !== (expectsNewDraft ? 0 : 1)) {
        errors.push(expectsNewDraft
          ? "建立新品時不可帶入中央蝦皮商品 ID。"
          : "更新或新增細項時必須且只能帶入一個中央蝦皮商品 ID。");
      }
      if ((mode === "add-variant-to-existing") !== (publishMode === "add-variant-to-existing")) {
        errors.push("publishMode 與 listingPolicy.mode 的細項模式不一致。");
      }
      listingPolicy = {
        mode,
        identitySource,
        platformListingIds,
        preflightSkuSearch: false,
        uncertainSubmitRecovery
      };
    }

    let variantGroup = null;
    if (payload.variantGroup != null) {
      if (!isPlainObject(payload.variantGroup)) {
        errors.push("variantGroup 必須是物件或 null。");
      } else {
        rejectUnknownKeys(payload.variantGroup, new Set([
          "parentProductId", "parentSku", "parentName", "attributeName", "parentAttributeValue",
          "attributeValue", "parentImageUrl", "imageUrl"
        ]), "variantGroup", errors);
        variantGroup = {
          parentProductId: validateString(payload.variantGroup.parentProductId, "variantGroup.parentProductId", errors, { max: 200 }),
          parentSku: validateString(payload.variantGroup.parentSku, "variantGroup.parentSku", errors, { max: 120 }),
          parentName: validateString(payload.variantGroup.parentName, "variantGroup.parentName", errors, { required: false, max: 255 }),
          attributeName: validateString(payload.variantGroup.attributeName, "variantGroup.attributeName", errors, { max: 120 }),
          parentAttributeValue: validateString(payload.variantGroup.parentAttributeValue, "variantGroup.parentAttributeValue", errors, { max: 200 }),
          attributeValue: validateString(payload.variantGroup.attributeValue, "variantGroup.attributeValue", errors, { max: 200 }),
          parentImageUrl: validateString(payload.variantGroup.parentImageUrl, "variantGroup.parentImageUrl", errors, { max: 1000 }),
          imageUrl: validateString(payload.variantGroup.imageUrl, "variantGroup.imageUrl", errors, { max: 1000 })
        };
        for (const key of ["parentImageUrl", "imageUrl"]) {
          try {
            const url = new URL(variantGroup[key]);
            if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
            variantGroup[key] = url.href;
          } catch (_) {
            errors.push(`variantGroup.${key} 必須是 http(s) 網址。`);
          }
        }
      }
    }
    if (listingPolicy && listingPolicy.mode === "add-variant-to-existing" && !variantGroup) {
      errors.push("add-variant-to-existing 必須帶入 variantGroup。");
    }
    if (listingPolicy && listingPolicy.mode !== "add-variant-to-existing" && variantGroup) {
      errors.push("非細項模式不可帶入 variantGroup。");
    }

    const categoryPath = [];
    if (!Array.isArray(payload.categoryPath) || payload.categoryPath.length < 1 || payload.categoryPath.length > 8) {
      errors.push("categoryPath 必須有 1 到 8 層。");
    } else {
      payload.categoryPath.forEach((entry, index) => {
        const segment = validateString(entry, `categoryPath[${index}]`, errors, { max: 120 });
        categoryPath.push(canonicalCategorySegment(segment));
      });
      const normalizedPath = canonicalCategoryPath(categoryPath);
      categoryPath.splice(0, categoryPath.length, ...normalizedPath);
      if (categoryPath.length > 8) errors.push("categoryPath 正規化後不可超過 8 層。");
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
        workflowVersion,
        jobId,
        snapshotId,
        snapshotFingerprint,
        nonce,
        createdAt: payload.createdAt,
        expiresAt: payload.expiresAt,
        productId,
        easyStoreProductId,
        easyStoreUrl,
        sku,
        title,
        publishMode,
        variantGroup,
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

  function resolveQueuePageIdentity(payload, pageUrl, pageText) {
    const targetId = parsePositiveId(payload && payload.easyStoreProductId);
    const sku = String(payload && payload.sku || "").trim();
    const routeKind = easyStoreRouteKind(pageUrl);
    if (!targetId || !sku || !routeKind) return "mismatch";

    let url;
    try {
      url = new URL(String(pageUrl));
    } catch (error) {
      return "mismatch";
    }

    if (routeKind === "product") {
      const match = url.pathname.match(/^\/products\/([1-9]\d{0,29})\/?$/);
      return match && match[1] === targetId ? "confirmed" : "mismatch";
    }

    const explicitStoreTokens = ["store_product_id", "store_product_ids"]
      .flatMap((key) => String(url.searchParams.get(key) || "").split(","))
      .map((value) => value.trim())
      .filter(Boolean);
    const explicitStoreIds = explicitStoreTokens.map(parsePositiveId).filter(Boolean);
    if (explicitStoreTokens.length !== explicitStoreIds.length) return "mismatch";
    const uniqueStoreIds = Array.from(new Set(explicitStoreIds));
    if (uniqueStoreIds.length === 1) {
      if (uniqueStoreIds[0] !== targetId) return "mismatch";
      const hasObservedSellerSku = /賣家\s*sku|seller\s*sku/i.test(String(pageText || ""));
      return hasObservedSellerSku && !textContainsExactToken(pageText, sku) ? "mismatch" : "confirmed";
    }

    const routeIds = new Set(extractProductIds(url.href));
    if (!routeIds.has(targetId)) return "mismatch";
    return textContainsExactToken(pageText, sku) ? "confirmed" : "pending";
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
    if (!easyStoreRouteKind(pageUrl)) return null;
    const candidates = Object.values(queue)
      .filter((record) => isPlainObject(record) && isPlainObject(record.payload))
      .sort((left, right) => Number(right.receivedAt || 0) - Number(left.receivedAt || 0));
    for (const record of candidates) {
      const validation = validateQueuePayload(record.payload, now);
      if (!validation.ok) continue;
      const payload = validation.value;
      if (resolveQueuePageIdentity(payload, pageUrl, pageText) === "confirmed") {
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
    const platformListingIds = Array.isArray(policy.platformListingIds) ? uniqueStrings(policy.platformListingIds) : [];
    const expectedMode = expectedShopeeNavigationMode(policy);
    if (platformListingIds.length > 1) {
      reasons.push(`中央主檔記錄了 ${platformListingIds.length} 個蝦皮商品 ID，無法安全選定更新目標。`);
    } else if (expectedMode === "unknown") {
      reasons.push("無法從 v2 中央平台 ID 規則決定建立或更新動作。");
    } else if (mode === "conflict") {
      reasons.push("EasyStore 頁面先後顯示互相矛盾的建立／更新動作，已停止送出。");
    } else if (mode !== "unknown" && mode !== expectedMode) {
      reasons.push(expectedMode === "update"
        ? "中央主檔已有蝦皮商品 ID，但 EasyStore 明確顯示建立新品，已停止送出。"
        : "中央主檔沒有蝦皮商品 ID，但 EasyStore 明確顯示更新舊商品，已停止送出。");
    }
    return { ok: reasons.length === 0, reasons };
  }

  function autoPublishGate(payload, report, navigationMode) {
    const row = payload && typeof payload === "object" ? payload : {};
    const result = report && typeof report === "object" ? report : {};
    const reasons = listingSafetyGate(row, navigationMode).reasons.slice();
    if (!["auto", "add-variant-to-existing"].includes(row.publishMode)) {
      reasons.push("這件商品設定為填寫後人工確認。");
    }
    if (row.logistics && row.logistics.requiresConfirmation === true) reasons.push("物流仍需人工確認。");
    if (Array.isArray(result.missing) && result.missing.length > 0) reasons.push(`仍有 ${result.missing.length} 個待補欄位。`);
    return { ok: reasons.length === 0, reasons };
  }

  return Object.freeze({
    SCHEMA_VERSION,
    WORKFLOW_VERSION,
    QUEUE_STORAGE_KEY,
    QUEUE_STORAGE_AREA,
    MAX_TTL_MS,
    SELLER_LARGE_HOME_FEE_TWD,
    ATTRIBUTE_DEFINITIONS,
    LOGISTICS_DEFINITIONS,
    normalizeText,
    canonicalCategorySegment,
    canonicalCategoryPath,
    normalizeShopeeNavigationMode,
    classifyShopeeActionText,
    expectedShopeeNavigationMode,
    directSyncNavigationMode,
    resolveShopeeNavigationMode,
    exactApprovedMatch,
    orderedCategoryPathMatch,
    categoryLabelTextMatch,
    categoryActionScore,
    smallestCategoryCardIndex,
    nextCategoryStage,
    normalizeCategorySearchState,
    exactVisibleCategoryOptionIndex,
    safeCategoryScrollContainerIndex,
    planCategorySearchStep,
    shopeeEntryTextMatch,
    logisticsOptionMatch,
    uniqueStrings,
    parsePositiveId,
    canonicalEasyStoreProductUrl,
    easyStoreRouteKind,
    shouldInspectQueue,
    resolveAttributeKey,
    resolveLogisticsKey,
    approvedValueOptions,
    approvedBrandOptions,
    hsinchuSizeBand,
    logisticsOptionAliases,
    validateQueuePayload,
    extractProductIds,
    textContainsExactToken,
    resolveQueuePageIdentity,
    pruneAndMergeQueue,
    withQueueNavigationMode,
    selectQueueRecord,
    listingSafetyGate,
    autoPublishGate
  });
});
