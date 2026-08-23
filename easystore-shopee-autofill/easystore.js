(function installEasyStoreAutofill() {
  "use strict";

  const helpers = globalThis.YouziShopeeAutofillHelpers;
  if (!helpers || location.origin !== "https://admin.easystore.co") {
    return;
  }

  const queueStorage = chrome.storage && chrome.storage[helpers.QUEUE_STORAGE_AREA];
  if (!queueStorage) {
    return;
  }

  const FIELD_LABELS = Object.freeze({
    category: ["分類", "Category"],
    brand: ["品牌", "Brand"],
    sku: ["賣家 SKU", "賣家SKU", "Seller SKU"],
    preorder: ["預購", "Pre-order", "Preorder"],
    ncc: ["NCC"],
    weight: ["Weight", "重量"],
    warrantyDuration: ["Warranty Duration", "保固期間"],
    warrantyType: ["Warranty Type", "保固類型"],
    accessoryType: ["Accessory Type", "配件類型"],
    length: ["Length", "長度"],
    neckMaterial: ["Neck Material", "琴頸材質"],
    traditionalMusicInstrument: ["Traditional Music Instrument", "傳統樂器"],
    guitarShape: ["Guitar Shape", "吉他形狀"],
    handConfiguration: ["Hand Configuration", "慣用手"],
    bsmi: ["BSMI"],
    quantity: ["Quantity", "數量"],
    indication: ["indication", "Indication"],
    quantityPerPack: ["Quantity per Pack", "每包數量"],
    bodyMaterial: ["Body Material", "琴身材質"],
    guitarType: ["Guitar Type", "吉他類型"],
    pickupConfiguration: ["Pickup Configuration", "拾音器配置"],
    fretboardMaterial: ["Fretboard Material", "指板材質"],
    dimensions: ["Dimension (L x W x H)", "Dimension (L × W × H)", "尺寸（長×寬×高）"],
    numberOfStrings: ["Number of Strings", "弦數"],
    itemCondition: ["Item condition", "Item Condition", "商品狀況"],
    color: ["Color", "Colour", "顏色"]
  });

  const LOGISTICS_LABELS = Object.freeze({
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
  const ALL_LOGISTICS_LABELS = Object.freeze(
    Object.values(LOGISTICS_LABELS).flat()
  );

  const EMPTY_MARKERS = [
    "",
    "請選擇",
    "請先選擇",
    "請先選擇分類",
    "選擇品牌",
    "no category has been chosen",
    "select",
    "choose"
  ];
  const CATEGORY_EMPTY_PROMPTS = Object.freeze([
    "請先選擇分類",
    "No category has been chosen"
  ]);
  const CATEGORY_DIALOG_TITLES = Object.freeze([
    "Edit category",
    "編輯分類"
  ]);
  const SHOPEE_ENTRY_LABELS = Object.freeze([
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
  const SHOPEE_REFRESH_LABELS = Object.freeze(["刷新", "重新整理"]);
  const FINAL_PUBLISH_LABELS = Object.freeze([
    "準備發布",
    "準備發佈",
    "確認上架",
    "立即上架",
    "上架"
  ]);
  const FINAL_CONFIRM_LABELS = Object.freeze([
    "確定上架",
    "確認上架",
    "確定發布",
    "確認發布",
    "確定發佈",
    "確認發佈"
  ]);
  const ADVANCED_DESCRIPTION_LABELS = Object.freeze([
    "進階商品描述",
    "進階產品描述",
    "Advanced Product Description",
    "Advanced Description"
  ]);
  const USE_EASYSTORE_DESCRIPTION_LABELS = Object.freeze([
    "使用 EasyStore 的產品描述",
    "使用 EasyStore 的商品描述",
    "Use EasyStore Product Description",
    "Use EasyStore Product Description Content"
  ]);
  let currentRecord = null;
  let overlay = null;
  let retryTimer = null;
  let observedUrl = location.href;
  let activeFieldLabelIndex = null;

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function isVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function findTextElements(approvedTexts, root, matcher) {
    const scope = root || document;
    const approved = helpers.uniqueStrings(approvedTexts);
    const matches = typeof matcher === "function" ? matcher : helpers.exactApprovedMatch;
    const candidates = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode instanceof Element ? walker.currentNode : walker.nextNode();
    while (node) {
      if (
        node.id !== "youzi-shopee-autofill-overlay" &&
        !node.closest("#youzi-shopee-autofill-overlay") &&
        isVisible(node) &&
        matches(node.textContent, approved)
      ) {
        candidates.push(node);
      }
      node = walker.nextNode();
    }
    return candidates.sort((left, right) => {
      const childDifference = left.children.length - right.children.length;
      if (childDifference !== 0) {
        return childDifference;
      }
      return left.getBoundingClientRect().width - right.getBoundingClientRect().width;
    });
  }

  function findExactTextElements(approvedTexts, root) {
    return findTextElements(approvedTexts, root, helpers.exactApprovedMatch);
  }

  function findExactTextElement(approvedTexts, root) {
    return findExactTextElements(approvedTexts, root)[0] || null;
  }

  function buildFieldLabelIndex(labelGroups) {
    const approved = new Set(
      (labelGroups || []).flat().map((value) => helpers.normalizeText(value)).filter(Boolean)
    );
    const index = new Map();
    if (approved.size === 0) return index;
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode instanceof Element ? walker.currentNode : walker.nextNode();
    while (node) {
      if (
        node.id !== "youzi-shopee-autofill-overlay" &&
        !node.closest("#youzi-shopee-autofill-overlay") &&
        isVisible(node)
      ) {
        const key = helpers.normalizeText(node.textContent);
        if (approved.has(key)) {
          if (!index.has(key)) index.set(key, []);
          index.get(key).push(node);
        }
      }
      node = walker.nextNode();
    }
    index.forEach((elements) => elements.sort((left, right) => {
      const childDifference = left.children.length - right.children.length;
      if (childDifference !== 0) return childDifference;
      return left.getBoundingClientRect().width - right.getBoundingClientRect().width;
    }));
    return index;
  }

  async function withFieldLabelIndex(labelGroups, callback) {
    const previous = activeFieldLabelIndex;
    activeFieldLabelIndex = buildFieldLabelIndex(labelGroups);
    try {
      return await callback();
    } finally {
      activeFieldLabelIndex = previous;
    }
  }

  function findIndexedFieldLabel(labelAliases) {
    if (!activeFieldLabelIndex) return findExactTextElement(labelAliases);
    const candidates = [];
    const seen = new Set();
    helpers.uniqueStrings(labelAliases).forEach((alias) => {
      const key = helpers.normalizeText(alias);
      (activeFieldLabelIndex.get(key) || []).forEach((element) => {
        if (!seen.has(element)) {
          seen.add(element);
          candidates.push(element);
        }
      });
    });
    return candidates.sort((left, right) => {
      const childDifference = left.children.length - right.children.length;
      if (childDifference !== 0) return childDifference;
      return left.getBoundingClientRect().width - right.getBoundingClientRect().width;
    })[0] || null;
  }

  function fieldControls(container) {
    if (!container) {
      return [];
    }
    return Array.from(container.querySelectorAll([
      "input:not([type='hidden'])",
      "textarea",
      "select",
      "[role='combobox']",
      "button[aria-haspopup='listbox']",
      "[aria-haspopup='listbox']"
    ].join(","))).filter(isVisible);
  }

  function findField(labelAliases) {
    const label = findIndexedFieldLabel(labelAliases);
    if (!label) {
      return null;
    }
    if (label.tagName === "LABEL" && label.htmlFor) {
      const direct = document.getElementById(label.htmlFor);
      if (direct && isVisible(direct)) {
        return { label, container: label.parentElement || label, controls: [direct] };
      }
    }
    let container = label.parentElement;
    for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
      const controls = fieldControls(container);
      if (controls.length > 0) {
        return { label, container, controls };
      }
    }
    return { label, container: label.parentElement || label, controls: [] };
  }

  async function waitForField(labelAliases, timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const field = findField(labelAliases);
      if (field && field.controls.length > 0) return field;
      await sleep(120);
    }
    return findField(labelAliases);
  }

  function controlValue(control) {
    if (!control) {
      return "";
    }
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
      return String(control.value || "").trim();
    }
    return String(control.getAttribute("data-value") || control.textContent || "").trim();
  }

  function controlDisplayValue(control) {
    if (control instanceof HTMLSelectElement) {
      const selected = control.selectedOptions && control.selectedOptions[0];
      return String(selected ? selected.textContent : control.value || "").trim();
    }
    return controlValue(control);
  }

  function isEmptyValue(value) {
    const normalized = helpers.normalizeText(value);
    return EMPTY_MARKERS.some((marker) => helpers.normalizeText(marker) === normalized);
  }

  function setNativeValue(control, value) {
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(control, String(value));
    } else {
      control.value = String(value);
    }
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setSearchInputValue(control, value) {
    control.focus();
    control.click();
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(control, String(value));
    else control.value = String(value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function waitForExactText(approvedTexts, timeout, exclude) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = findExactTextElements(approvedTexts).find((element) => element !== exclude && !exclude?.contains(element));
      if (found) {
        return found;
      }
      await sleep(100);
    }
    return null;
  }

  function approvedOptionCandidate(approvedTexts, matcher, exclude) {
    const matches = typeof matcher === "function" ? matcher : helpers.exactApprovedMatch;
    const excluded = exclude instanceof Element ? exclude : null;
    return findTextElements(approvedTexts, document, matches)
      .filter((element) => element !== excluded && !excluded?.contains(element))
      .map((element) => {
        const clickable = element.closest("[role='option'], li, button, [data-value], [tabindex]") || element;
        const inPopup = Boolean(element.closest([
          "[role='listbox']",
          "[role='menu']",
          "[class*='dropdown' i]",
          "[class*='popover' i]",
          "[class*='option-list' i]"
        ].join(",")));
        let score = 0;
        if (clickable.matches("[role='option']")) score += 100;
        if (clickable.matches("li, [data-value]")) score += 70;
        if (clickable.matches("button")) score += 35;
        if (clickable.matches("[tabindex]")) score += 25;
        if (inPopup) score += 50;
        return { clickable, score };
      })
      .filter((candidate) => candidate.score > 0 && isEnabledClickTarget(candidate.clickable))
      .sort((left, right) => right.score - left.score)[0]?.clickable || null;
  }

  async function waitForApprovedOption(approvedTexts, matcher, timeout, exclude) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const option = approvedOptionCandidate(approvedTexts, matcher, exclude);
      if (option) return option;
      await sleep(100);
    }
    return null;
  }

  async function chooseExactOption(control, approvedOptions) {
    const options = helpers.uniqueStrings(approvedOptions);
    if (control instanceof HTMLSelectElement) {
      const option = Array.from(control.options).find((entry) => helpers.exactApprovedMatch(entry.textContent, options));
      if (!option) {
        return false;
      }
      control.value = option.value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(80);
      return helpers.exactApprovedMatch(controlDisplayValue(control), options);
    }
    control.click();
    const option = await waitForApprovedOption(options, helpers.exactApprovedMatch, 3000, control);
    if (!option) {
      return false;
    }
    option.click();
    await sleep(220);
    return !control.isConnected || helpers.exactApprovedMatch(controlDisplayValue(control), options);
  }

  function visiblePopupOptionRows() {
    const roots = Array.from(document.querySelectorAll([
      "[role='listbox']",
      ".el-select-dropdown",
      "[class*='dropdown-menu' i]",
      "[class*='option-list' i]"
    ].join(","))).filter((element) => isVisible(element) && !element.closest("#youzi-shopee-autofill-overlay"));
    const seen = new Set();
    const rows = [];
    roots.forEach((root) => {
      Array.from(root.querySelectorAll("[role='option'], li, [data-value]")).forEach((element) => {
        const clickable = element.closest("[role='option'], li, [data-value]") || element;
        const text = String(element.textContent || "").trim();
        const key = helpers.normalizeText(text);
        if (!key || seen.has(key) || !isEnabledClickTarget(clickable)) return;
        seen.add(key);
        rows.push({ text, clickable });
      });
    });
    return rows;
  }

  async function waitForVisiblePopupOptions(timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const rows = visiblePopupOptionRows();
      if (rows.length) return rows;
      await sleep(100);
    }
    return visiblePopupOptionRows();
  }

  function selectedValueInField(field, approvedOptions) {
    if (!field || !field.container) return "";
    return Array.from(field.container.querySelectorAll([
      ".el-select__selected-item",
      "[class*='selected-value' i]",
      "[data-value]"
    ].join(",")))
      .map((element) => String(element.textContent || element.getAttribute("data-value") || "").trim())
      .find((value) => helpers.exactApprovedMatch(value, approvedOptions)) || "";
  }

  async function chooseExactAttributeOption(field, control, approvedOptions) {
    const options = helpers.uniqueStrings(approvedOptions);
    if (control instanceof HTMLSelectElement) {
      const observed = Array.from(control.options).map((entry) => String(entry.textContent || "").trim()).filter(Boolean);
      const option = Array.from(control.options).find((entry) => helpers.exactApprovedMatch(entry.textContent, options));
      if (!option) return { selected: false, observed };
      control.value = option.value;
      control.dispatchEvent(new Event("input", { 