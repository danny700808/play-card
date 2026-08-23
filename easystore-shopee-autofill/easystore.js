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
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(80);
      return { selected: helpers.exactApprovedMatch(controlDisplayValue(control), options), observed };
    }
    control.focus();
    control.click();
    const rows = await waitForVisiblePopupOptions(3000);
    const exact = rows.filter((row) => helpers.exactApprovedMatch(row.text, options));
    if (exact.length !== 1) return { selected: false, observed: rows.map((row) => row.text) };
    exact[0].clickable.click();
    const started = Date.now();
    while (Date.now() - started < 2200) {
      if (!control.isConnected || selectedValueInField(field, options) || helpers.exactApprovedMatch(controlDisplayValue(control), options)) {
        return { selected: true, observed: rows.map((row) => row.text) };
      }
      await sleep(100);
    }
    return { selected: false, observed: rows.map((row) => row.text) };
  }

  function logisticsOptionMatches(actual, approvedOptions) {
    return typeof helpers.logisticsOptionMatch === "function"
      ? helpers.logisticsOptionMatch(actual, approvedOptions)
      : helpers.exactApprovedMatch(actual, approvedOptions);
  }

  async function chooseLogisticsOption(control, approvedOptions) {
    const options = helpers.uniqueStrings(approvedOptions);
    if (control instanceof HTMLSelectElement) {
      const option = Array.from(control.options).find((entry) =>
        logisticsOptionMatches(entry.textContent, options)
      );
      if (!option) return false;
      control.value = option.value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(80);
      return logisticsOptionMatches(controlDisplayValue(control), options);
    }
    control.click();
    const option = await waitForApprovedOption(options, logisticsOptionMatches, 3500, control);
    if (!option) return false;
    option.click();
    await sleep(220);
    return true;
  }

  function addReport(report, bucket, label, detail) {
    report[bucket].push(detail ? `${label}：${detail}` : label);
  }

  function isEnabledClickTarget(element) {
    if (!(element instanceof Element) || !isVisible(element)) return false;
    if (element.matches(":disabled, [disabled], [aria-disabled='true']")) return false;
    return true;
  }

  function clickableForExactText(element) {
    return element && (element.closest("button, [role='button'], a, [tabindex]") || element);
  }

  function findEnabledExactButton(labels, excludedElements) {
    const excluded = new Set((excludedElements || []).filter(Boolean));
    return findExactTextElements(labels).map(clickableForExactText).find((element) =>
      element &&
      !excluded.has(element) &&
      !element.closest("#youzi-shopee-autofill-overlay") &&
      isEnabledClickTarget(element)
    ) || null;
  }

  async function waitForEnabledExactButton(labels, timeout, excludedElements) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const button = findEnabledExactButton(labels, excludedElements);
      if (button) return button;
      await sleep(120);
    }
    return null;
  }

  async function publishToShopee(payload, report, navigationMode) {
    const identity = verifyIdentity(payload, { requireSellerSku: true });
    if (!identity.ok) {
      throw new Error(identity.message);
    }
    const gate = helpers.autoPublishGate(payload, report, navigationMode);
    if (!gate.ok) {
      throw new Error(gate.reasons.join("；"));
    }
    const publishButton = await waitForEnabledExactButton(FINAL_PUBLISH_LABELS, 3500);
    if (!publishButton) {
      throw new Error("找不到可按的 EasyStore 最後上架按鈕；請確認頁面是否仍有紅字或必填欄位。");
    }
    const beforeUrl = location.href;
    publishButton.click();
    const confirmButton = await waitForEnabledExactButton(FINAL_CONFIRM_LABELS, 2200, [publishButton]);
    if (confirmButton) confirmButton.click();
    await sleep(1400);
    const errorText = findExactTextElements([
      "請填寫所有必填欄位",
      "請完成所有必填欄位",
      "上架失敗",
      "發布失敗",
      "發佈失敗"
    ]).map((element) => String(element.textContent || "").trim()).find(Boolean);
    if (errorText) {
      throw new Error(`EasyStore 未接受上架：${errorText}`);
    }
    return { submitted: true, navigated: location.href !== beforeUrl };
  }

  function advancedDescriptionToggleCandidates(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll([
      "[role='switch']",
      "button[aria-checked]",
      "input[type='checkbox']",
      ".el-switch"
    ].join(","))).filter((control) =>
      isVisible(control) &&
      !control.matches(":disabled, [disabled], [aria-disabled='true']")
    );
  }

  function advancedDescriptionSection() {
    for (const label of findExactTextElements(ADVANCED_DESCRIPTION_LABELS)) {
      let container = label.parentElement;
      for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
        const useButton = findExactTextElements(USE_EASYSTORE_DESCRIPTION_LABELS, container)
          .map(clickableForExactText)
          .find(isEnabledClickTarget) || null;
        const toggles = advancedDescriptionToggleCandidates(container);
        if (useButton || toggles.length === 1) {
          return { label, container, toggle: toggles.length === 1 ? toggles[0] : null, useButton };
        }
        if (toggles.length > 1) break;
      }
    }
    return null;
  }

  async function waitForAdvancedDescriptionSection(timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const section = advancedDescriptionSection();
      if (section) return section;
      await sleep(120);
    }
    return advancedDescriptionSection();
  }

  async function waitForAdvancedDescriptionButton(timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const section = advancedDescriptionSection();
      if (section && section.useButton) return section;
      await sleep(120);
    }
    return advancedDescriptionSection();
  }

  function cleanErrorText(value) {
    return String(value == null ? "" : value).replace(/[\s\u00a0]+/g, " ").trim().slice(0, 180);
  }

  async function fillAdvancedDescription(payload, report) {
    const plan = payload && payload.advancedDescription;
    if (!plan || plan.mode !== "use-easystore-rich-description") {
      addReport(report, "missing", "進階商品描述", "進站前沒有準備完整的 EasyStore 圖文介紹");
      return;
    }
    let section = await waitForAdvancedDescriptionSection(4200);
    if (!section) {
      addReport(report, "skipped", "進階商品描述", "此帳號頁面未提供此功能，保留 EasyStore 同步的純文字描述");
      return;
    }
    if (section.toggle && !toggleState(section.toggle)) {
      section.toggle.click();
      const started = Date.now();
      let enabled = false;
      while (!enabled && Date.now() - started < 3000) {
        await sleep(120);
        section = advancedDescriptionSection() || section;
        enabled = !section.toggle || toggleState(section.toggle);
      }
      if (!enabled) {
        addReport(report, "missing", "進階商品描述", "找到功能但無法開啟");
        return;
      }
    }
    if (!section.useButton) {
      const expand = clickableForExactText(section.label);
      if (expand && isEnabledClickTarget(expand)) expand.click();
      section = await waitForAdvancedDescriptionButton(3000) || section;
    }
    if (!section.useButton) {
      addReport(report, "missing", "進階商品描述", "功能已出現，但找不到「使用 EasyStore 的產品描述」");
      return;
    }
    section.useButton.click();
    await sleep(900);
    const errorText = String(section.container && section.container.innerText || "").match(
      /(?:圖片|描述).{0,24}(?:失敗|錯誤|無法)|(?:failed|error).{0,24}(?:image|description)/i
    );
    if (errorText) {
      addReport(report, "missing", "進階商品描述", cleanErrorText(errorText[0]));
      return;
    }
    addReport(
      report,
      "filled",
      "進階商品描述",
      `已開啟並套用事先準備的 EasyStore 圖文介紹（${plan.expectedImageCount} 張介紹圖片）`
    );
  }

  async function fillBrand(payload, report) {
    const approvedBrands = helpers.approvedBrandOptions(payload.brand);
    const desiredBrand = payload.brand || "NOBRAND";
    const field = await waitForField(FIELD_LABELS.brand, 8000);
    if (!field || field.controls.length === 0) {
      addReport(report, "missing", "品牌", "找不到欄位");
      return;
    }
    const control = field.controls[0];
    const visibleBrandSelection = () => Array.from(field.container.querySelectorAll([
      ".el-select__selected-item .el-select__placeholder",
      ".el-select__selected-item"
    ].join(",")))
      .map((element) => String(element.textContent || "").trim())
      .find((value) => !isEmptyValue(value)) || "";
    const selectedBrandValue = () => {
      const visible = visibleBrandSelection();
      return helpers.exactApprovedMatch(visible, approvedBrands) ? visible : "";
    };
    const existingSelection = visibleBrandSelection();
    if (existingSelection) {
      if (helpers.exactApprovedMatch(existingSelection, approvedBrands)) {
        addReport(report, "preserved", "品牌", existingSelection);
      } else {
        addReport(report, "missing", "品牌", `目前品牌「${existingSelection}」與核准品牌「${desiredBrand}」不符`);
      }
      return;
    }
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
      setSearchInputValue(control, desiredBrand);
      const suggestion = await waitForApprovedOption(
        approvedBrands,
        helpers.exactApprovedMatch,
        3500,
        control
      );
      if (!suggestion) {
        addReport(report, "missing", "品牌", `找不到完全相符的「${desiredBrand}」選項`);
        return;
      }
      suggestion.click();
      const appliedStarted = Date.now();
      let appliedValue = "";
      while (!appliedValue && Date.now() - appliedStarted < 2200) {
        await sleep(100);
        appliedValue = selectedBrandValue();
      }
      addReport(
        report,
        appliedValue ? "filled" : "missing",
        "品牌",
        appliedValue || `無法套用「${desiredBrand}」`
      );
      return;
    }
    const selected = await chooseExactOption(control, approvedBrands);
    addReport(report, selected ? "filled" : "missing", "品牌", selected ? desiredBrand : "找不到完全相符選項");
  }

  function categoryCurrentValue(field) {
    const candidate = field.controls.map(controlValue).find((value) => !isEmptyValue(value));
    if (candidate) {
      return candidate;
    }
    const text = String(field.container.textContent || "");
    const withoutLabel = FIELD_LABELS.category.reduce(
      (result, label) => result.replace(label, ""),
      text
    ).trim();
    return /請先選擇分類|no category has been chosen/i.test(withoutLabel) ? "" : withoutLabel;
  }

  function elementSemanticText(element) {
    if (!(element instanceof Element)) return "";
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-cy"),
      element.className,
      element.textContent
    ].filter((value) => typeof value === "string" && value.trim()).join(" ");
  }

  function compactCategoryContainer(label) {
    let container = label && label.parentElement;
    let fallback = null;
    for (let depth = 0; container && depth < 7; depth += 1, container = container.parentElement) {
      const rect = container.getBoundingClientRect();
      const text = String(container.textContent || "");
      const hasPrompt = /請先選擇分類|no category has been chosen/i.test(text);
      if (hasPrompt && rect.width > 180 && rect.width <= 1200 && rect.height > 45 && rect.height <= 420) {
        return container;
      }
      const withoutLabel = FIELD_LABELS.category.reduce((result, value) => result.replace(value, ""), text).trim();
      if (!fallback && withoutLabel.length > 2 && rect.width > 180 && rect.width <= 1200 && rect.height > 45 && rect.height <= 420) {
        fallback = container;
      }
    }
    return fallback || (label ? label.parentElement : null);
  }

  function categoryActionCandidates(container) {
    if (!(container instanceof Element)) return [];
    const cardRect = container.getBoundingClientRect();
    const selectors = [
      "button",
      "a",
      "[role='button']",
      "[tabindex]",
      "svg",
      "[class*='edit' i]",
      "[class*='pencil' i]"
    ].join(",");
    const seen = new Set();
    return Array.from(container.querySelectorAll(selectors)).map((node) => {
      const target = node.closest("button, a, [role='button'], [tabindex]") || node;
      if (seen.has(target) || !isEnabledClickTarget(target)) return null;
      seen.add(target);
      const rect = target.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const rightRatio = cardRect.width > 0 ? (centerX - cardRect.left) / cardRect.width : 0;
      const descriptor = {
        semantic: elementSemanticText(target),
        tagName: target.tagName,
        role: target.getAttribute("role") || "",
        rightRatio,
        width: rect.width,
        height: rect.height,
        hasIcon: Boolean(target.querySelector("svg, img") || target.tagName === "SVG")
      };
      return { target, score: helpers.categoryActionScore(descriptor), rightRatio };
    }).filter((candidate) => candidate && candidate.score >= 200)
      .sort((left, right) => right.score - left.score || right.rightRatio - left.rightRatio);
  }

  function categoryInputTriggerCandidates(label) {
    if (!(label instanceof Element) || !(label.parentElement instanceof Element)) return [];
    const fieldRoot = label.parentElement;
    const fieldRect = fieldRoot.getBoundingClientRect();
    const candidates = Array.from(fieldRoot.querySelectorAll([
      ".facil-input-text .cursor-pointer",
      ".facil-input-text [role='button']",
      ".facil-input-text button"
    ].join(",")));
    const seen = new Set();
    return candidates.filter((target) => {
      if (seen.has(target) || !isEnabledClickTarget(target)) return false;
      seen.add(target);
      const inputRoot = target.closest(".facil-input-text");
      const rect = target.getBoundingClientRect();
      return inputRoot
        && fieldRoot.contains(inputRoot)
        && rect.width >= 180
        && rect.height >= 28
        && rect.height <= 84
        && rect.width >= fieldRect.width * 0.55;
    }).sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return rightRect.width - leftRect.width || leftRect.height - rightRect.height;
    });
  }

  function categoryPathIsApplied(field, categoryPath) {
    if (!field) return false;
    return helpers.orderedCategoryPathMatch(categoryCurrentValue(field), categoryPath)
      || helpers.orderedCategoryPathMatch(field.container && field.container.textContent, categoryPath);
  }

  function findCategoryField() {
    // EasyStore's required-field star and information icon can be part of the
    // same DOM node as「分類」. Prefer that decorated label because the page can
    // contain a second「請先選擇分類」inside the sales-information card.
    const label = findTextElements([], document, (value) => helpers.categoryLabelTextMatch(value))[0] || null;
    const prompts = findExactTextElements(CATEGORY_EMPTY_PROMPTS);
    const anchors = label ? [label, ...prompts] : prompts;
    if (anchors.length === 0) {
      return null;
    }
    let fallback = null;
    for (const anchor of anchors) {
      const initialContainer = compactCategoryContainer(anchor);
      const ancestors = [];
      let candidateContainer = initialContainer;
      for (let depth = 0; candidateContainer && depth < 6; depth += 1, candidateContainer = candidateContainer.parentElement) {
        if (!candidateContainer.contains(anchor)) break;
        const rect = candidateContainer.getBoundingClientRect();
        const text = String(candidateContainer.textContent || "");
        const actions = categoryActionCandidates(candidateContainer);
        ancestors.push({
          element: candidateContainer,
          actions,
          hasPrompt: /請先選擇分類|no category has been chosen/i.test(text),
          width: rect.width,
          height: rect.height,
          actionScores: actions.map((row) => row.score)
        });
      }
      const cardIndex = helpers.smallestCategoryCardIndex(ancestors);
      const card = cardIndex >= 0 ? ancestors[cardIndex] : null;
      const resolvedContainer = card ? card.element : initialContainer;
      const result = {
        label: label || anchor,
        container: resolvedContainer || anchor.parentElement || anchor,
        controls: fieldControls(resolvedContainer || anchor.parentElement || anchor),
        editControls: card ? card.actions.map((row) => row.target) : [],
        inputTriggers: categoryInputTriggerCandidates(label || anchor)
      };
      if (card) return result;
      if (!fallback) fallback = result;
    }
    return fallback;
  }

  function findActiveCategoryDialog() {
    const titles = findExactTextElements(CATEGORY_DIALOG_TITLES);
    for (const title of titles) {
      const semanticDialog = title.closest("[role='dialog'], [aria-modal='true']");
      if (semanticDialog && isVisible(semanticDialog)) return semanticDialog;

      const horizontalCandidates = [];
      const fallbackCandidates = [];
      let container = title.parentElement;
      for (let depth = 0; container && depth < 9; depth += 1, container = container.parentElement) {
        const rect = container.getBoundingClientRect();
        const style = getComputedStyle(container);
        if (rect.width >= 420
          && rect.height >= 220
          && rect.width <= Math.max(window.innerWidth * 1.05, 1400)
          && rect.height <= Math.max(window.innerHeight * 1.05, 1000)
          && style.display !== "none"
          && style.visibility !== "hidden") {
          const hasVerticalList = Array.from(container.querySelectorAll("*")).some((node) => {
            if (!(node instanceof HTMLElement)) return false;
            const nodeRect = node.getBoundingClientRect();
            const overflowY = getComputedStyle(node).overflowY;
            return nodeRect.width >= 140
              && nodeRect.width <= Math.min(560, rect.width * 0.72)
              && nodeRect.height >= 100
              && (/auto|scroll|overlay/i.test(overflowY) || node.scrollHeight > node.clientHeight + 4);
          });
          const hasHorizontalViewport = Array.from(container.querySelectorAll("*")).some((node) => {
            if (!(node instanceof HTMLElement)) return false;
            const nodeRect = node.getBoundingClientRect();
            return nodeRect.width >= 420
              && nodeRect.height >= 140
              && node.scrollWidth > node.clientWidth + 8;
          });
          const row = { element: container, area: rect.width * rect.height };
          if (hasHorizontalViewport) horizontalCandidates.push(row);
          else if (hasVerticalList) fallbackCandidates.push(row);
        }
      }
      horizontalCandidates.sort((left, right) => left.area - right.area);
      fallbackCandidates.sort((left, right) => right.area - left.area);
      // The title and the horizontally expanding columns can be siblings.
      // Prefer their smallest common modal root. Without a horizontal
      // viewport, use the largest bounded title ancestor so a later sibling
      // column cannot escape the search scope.
      if (horizontalCandidates[0]) return horizontalCandidates[0].element;
      if (fallbackCandidates[0]) return fallbackCandidates[0].element;
    }
    return null;
  }

  async function waitForCategoryDialog(timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const dialog = findActiveCategoryDialog();
      if (dialog) return dialog;
      await sleep(120);
    }
    return null;
  }

  function categoryHorizontalViewport(dialog) {
    if (!(dialog instanceof Element)) return null;
    const dialogRect = dialog.getBoundingClientRect();
    return Array.from(dialog.querySelectorAll("*")).filter((node) => {
      if (!(node instanceof HTMLElement) || !isVisible(node)) return false;
      const rect = node.getBoundingClientRect();
      const overflowX = getComputedStyle(node).overflowX;
      const horizontalStyle = /auto|scroll|overlay|hidden/i.test(overflowX);
      const compactRows = Array.from(node.querySelectorAll("*")).filter((child) => {
        if (!(child instanceof HTMLElement) || !isVisible(child)) return false;
        const childRect = child.getBoundingClientRect();
        const text = String(child.textContent || "").trim();
        return text.length > 0
          && text.length <= 90
          && childRect.height >= 14
          && childRect.height <= 72
          && !Array.from(child.children).some((grandchild) =>
            helpers.normalizeText(grandchild.textContent) === helpers.normalizeText(text)
          );
      }).length;
      return rect.width >= Math.min(420, dialogRect.width * 0.55)
        && rect.height >= 140
        && (node.scrollWidth > node.clientWidth + 8 || (horizontalStyle && compactRows >= 2));
    }).map((element) => {
      const rect = element.getBoundingClientRect();
      const overflowX = getComputedStyle(element).overflowX;
      return {
        element,
        overflow: element.scrollWidth - element.clientWidth,
        styled: /auto|scroll|overlay/i.test(overflowX) ? 1 : 0,
        area: rect.width * rect.height
      };
    }).sort((left, right) => right.styled - left.styled || right.overflow - left.overflow || left.area - right.area)[0]?.element || null;
  }

  function categoryListColumns(dialog) {
    if (!(dialog instanceof Element)) return [];
    const dialogRect = dialog.getBoundingClientRect();
    const horizontalViewport = categoryHorizontalViewport(dialog);
    const scope = horizontalViewport || dialog;
    const scopeRect = scope.getBoundingClientRect();
    const nodes = Array.from(scope.querySelectorAll("*"));
    const shortRows = nodes.filter((node) => {
      if (!(node instanceof HTMLElement) || !isVisible(node)) return false;
      const rect = node.getBoundingClientRect();
      const text = String(node.textContent || "").trim();
      if (!text || text.length > 90 || helpers.exactApprovedMatch(text, CATEGORY_DIALOG_TITLES)) return false;
      const normalized = helpers.normalizeText(text);
      if (!normalized || Array.from(node.children).some((child) => helpers.normalizeText(child.textContent) === normalized)) {
        return false;
      }
      return rect.height >= 14 && rect.height <= 72 && rect.width > 20 && rect.width <= 520;
    });

    const candidateSet = new Set();
    shortRows.forEach((row) => {
      let container = row.parentElement;
      for (let depth = 0; container && container !== scope && depth < 6; depth += 1, container = container.parentElement) {
        const rect = container.getBoundingClientRect();
        if (rect.width >= 140
          && rect.width <= Math.min(560, dialogRect.width * 0.72)
          && rect.height >= 100
          && rect.height <= dialogRect.height) {
          candidateSet.add(container);
        }
      }
    });
    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement) || !isVisible(node)) return;
      if (node.scrollHeight > node.clientHeight + 4) candidateSet.add(node);
    });

    const candidates = Array.from(candidateSet).filter((node) => {
      if (!(node instanceof HTMLElement) || !isVisible(node) || node === horizontalViewport) return false;
      const rect = node.getBoundingClientRect();
      const overflowY = getComputedStyle(node).overflowY;
      const hasVerticalRange = node.scrollHeight > node.clientHeight + 4;
      const isHorizontalRoot = node.scrollWidth > node.clientWidth + 8
        && rect.width >= Math.min(420, scopeRect.width * 0.7);
      return rect.width >= 140
        && rect.width <= Math.min(560, dialogRect.width * 0.72)
        && rect.height >= 100
        && rect.height <= dialogRect.height
        && !isHorizontalRoot
        && (hasVerticalRange || shortRows.filter((row) => node.contains(row)).length >= 2)
        && (hasVerticalRange || !/hidden/i.test(overflowY));
    }).map((element) => {
      const rect = element.getBoundingClientRect();
      const visibleRowTops = new Set(shortRows.filter((row) => element.contains(row)).map((row) =>
        Math.round(row.getBoundingClientRect().top / 4) * 4
      ));
      const overflowY = getComputedStyle(element).overflowY;
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
      let depth = 0;
      for (let parent = element.parentElement; parent && parent !== dialog; parent = parent.parentElement) depth += 1;
      const score = (/auto|scroll|overlay/i.test(overflowY) ? 500 : 0)
        + Math.min(maxScroll, 1200)
        + visibleRowTops.size * 35
        + depth * 3
        - rect.width / 20;
      return { element, rect, score };
    });

    // Group by horizontal band, then keep the most credible owner for that
    // band. This preserves four sibling columns while collapsing nested
    // wrappers inside one column.
    const bands = [];
    for (const candidate of candidates.sort((left, right) => left.rect.left - right.rect.left)) {
      let band = bands.find((row) => Math.abs(row.left - candidate.rect.left) <= 28);
      if (!band) {
        band = { left: candidate.rect.left, candidates: [] };
        bands.push(band);
      }
      band.candidates.push(candidate);
    }
    return bands.sort((left, right) => left.left - right.left).map((band) =>
      band.candidates.sort((left, right) => right.score - left.score)[0].element
    );
  }

  function intersectsCategoryColumn(element, column) {
    if (!(element instanceof Element) || !(column instanceof Element)) return false;
    const rowRect = element.getBoundingClientRect();
    const columnRect = column.getBoundingClientRect();
    return rowRect.width > 0
      && rowRect.height > 0
      && rowRect.bottom > columnRect.top + 1
      && rowRect.top < columnRect.bottom - 1;
  }

  function categoryOptionTarget(element, boundary) {
    if (!(element instanceof Element) || !(boundary instanceof Element)) return null;
    const semantic = element.closest("[role='option'], li, button, [data-value], [tabindex]");
    if (semantic && boundary.contains(semantic) && isEnabledClickTarget(semantic)) {
      const semanticRect = semantic.getBoundingClientRect();
      if (semanticRect.height <= 84 && semanticRect.width <= 560) return semantic;
    }

    // EasyStore also renders plain div rows. Walk only within the identified
    // category column and require a compact row containing exactly this text;
    // never fall back to clicking an arbitrary page text node.
    const rows = [];
    let candidate = element;
    for (let depth = 0; candidate && candidate !== boundary && depth < 6; depth += 1, candidate = candidate.parentElement) {
      const rect = candidate.getBoundingClientRect();
      if (rect.height >= 18
        && rect.height <= 84
        && rect.width >= 80
        && rect.width <= 560
        && helpers.exactApprovedMatch(candidate.textContent, [element.textContent])
        && isEnabledClickTarget(candidate)) {
        rows.push({ element: candidate, width: rect.width });
      }
    }
    return rows.sort((left, right) => right.width - left.width)[0]?.element || null;
  }

  function verticallyVisibleInDialog(element, dialog) {
    if (!(element instanceof Element) || !(dialog instanceof Element)) return false;
    const rowRect = element.getBoundingClientRect();
    let parent = element.parentElement;
    while (parent && parent !== dialog) {
      const overflowY = getComputedStyle(parent).overflowY;
      if (/auto|scroll|overlay|hidden/i.test(overflowY)) {
        const parentRect = parent.getBoundingClientRect();
        if (rowRect.bottom <= parentRect.top + 1 || rowRect.top >= parentRect.bottom - 1) return false;
      }
      parent = parent.parentElement;
    }
    return true;
  }

  function exactCategoryOptions(dialog, columns, segment, levelIndex) {
    if (!(dialog instanceof Element)) return [];
    const exactElements = findTextElements([segment], dialog, helpers.exactApprovedMatch)
      .filter((element) => !Array.from(element.children).some((child) =>
        helpers.exactApprovedMatch(child.textContent, [segment])
      ))
      .filter((element) => verticallyVisibleInDialog(element, dialog));
    const seen = new Set();
    const records = exactElements.map((element) => {
      let ownerIndex = columns.findIndex((column) => column.contains(element));
      if (ownerIndex < 0) {
        const centerX = element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2;
        ownerIndex = columns.findIndex((column) => {
          const rect = column.getBoundingClientRect();
          return centerX >= rect.left && centerX <= rect.right;
        });
      }
      const owner = ownerIndex >= 0 ? columns[ownerIndex] : null;
      const boundary = owner || categoryHorizontalViewport(dialog) || dialog;
      const target = categoryOptionTarget(element, boundary);
      return target ? { target, ownerIndex } : null;
    }).filter((record) => {
        if (!record || seen.has(record.target)) return false;
        seen.add(record.target);
        return true;
      });
    return records.filter((record) => {
        return record.ownerIndex === levelIndex;
      }).map((record) => record.target)
      .filter((target) => {
        if (!target || !dialog.contains(target)) return false;
        seen.add(target);
        return true;
      });
  }

  function categoryColumnDescriptors(columns, levelIndex, dialog) {
    return columns.map((column, index) => ({
      visible: isVisible(column),
      inCategoryModal: dialog.contains(column),
      isListColumn: true,
      levelIndex: index,
      active: index === levelIndex,
      scrollTop: column.scrollTop,
      clientHeight: column.clientHeight,
      scrollHeight: column.scrollHeight
    }));
  }

  function categoryColumnHorizontallyVisible(column, viewport) {
    if (!(column instanceof Element) || !(viewport instanceof Element)) return false;
    const columnRect = column.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const visibleWidth = Math.min(columnRect.right, viewportRect.right)
      - Math.max(columnRect.left, viewportRect.left);
    return visibleWidth >= Math.min(80, columnRect.width * 0.45);
  }

  async function ensureCategoryLevelVisible(dialog, levelIndex) {
    if (!(dialog instanceof Element)) return null;
    let columns = categoryListColumns(dialog);
    let column = columns[levelIndex];
    const viewport = categoryHorizontalViewport(dialog);
    if (!column || !viewport) return column || null;
    if (categoryColumnHorizontallyVisible(column, viewport)) return column;

    const columnRect = column.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const margin = 20;
    let nextLeft = viewport.scrollLeft;
    if (columnRect.left < viewportRect.left + margin) {
      nextLeft += columnRect.left - viewportRect.left - margin;
    } else if (columnRect.right > viewportRect.right - margin) {
      nextLeft += columnRect.right - viewportRect.right + margin;
    }
    const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    viewport.scrollLeft = Math.max(0, Math.min(maxLeft, nextLeft));
    viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await sleep(220);

    const refreshedDialog = findActiveCategoryDialog();
    if (!refreshedDialog) return null;
    columns = categoryListColumns(refreshedDialog);
    column = columns[levelIndex];
    const refreshedViewport = categoryHorizontalViewport(refreshedDialog);
    return column && refreshedViewport && categoryColumnHorizontallyVisible(column, refreshedViewport)
      ? column
      : null;
  }

  async function waitForNextCategoryColumn(levelIndex, timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const dialog = findActiveCategoryDialog();
      if (!dialog) return levelIndex >= 3;
      const columns = categoryListColumns(dialog);
      if (columns.length > levelIndex + 1) return true;
      await sleep(120);
    }
    return false;
  }

  async function waitForCategoryStage(segment, levelIndex, timeout) {
    const started = Date.now();
    let state = null;
    let lastReason = "category-dialog-not-ready";
    while (Date.now() - started < timeout) {
      const dialog = findActiveCategoryDialog();
      if (!dialog) {
        await sleep(120);
        continue;
      }
      const columns = categoryListColumns(dialog);
      let column = columns[levelIndex];
      if (!column) {
        lastReason = "category-column-not-ready";
        await sleep(120);
        continue;
      }
      const viewport = categoryHorizontalViewport(dialog);
      if (viewport && !categoryColumnHorizontallyVisible(column, viewport)) {
        column = await ensureCategoryLevelVisible(dialog, levelIndex);
        if (!column) {
          lastReason = "category-column-not-visible";
          await sleep(120);
          continue;
        }
        // Horizontal movement may have rebuilt the modal. Re-query everything
        // on the next iteration before inspecting or scrolling vertically.
        state = null;
        continue;
      }
      const targets = exactCategoryOptions(dialog, columns, segment, levelIndex);
      const optionDescriptors = targets.map(() => ({
        text: segment,
        visible: true,
        inCategoryModal: true,
        inActiveColumn: true,
        disabled: false,
        levelIndex
      }));
      const plan = helpers.planCategorySearchStep({
        levelIndex,
        target: segment,
        state,
        options: optionDescriptors,
        containers: categoryColumnDescriptors(columns, levelIndex, dialog),
        maxAttempts: 40
      });
      state = plan.state;
      lastReason = plan.reason;
      if (plan.action === "select") {
        const target = targets[plan.optionIndex];
        if (target && dialog.contains(target) && isEnabledClickTarget(target)) {
          return { option: target, reason: plan.reason };
        }
      } else if (plan.action === "scroll") {
        const targetColumn = columns[plan.containerIndex];
        if (!targetColumn || !dialog.contains(targetColumn)) {
          lastReason = "category-column-replaced";
          state = null;
          await sleep(120);
          continue;
        }
        targetColumn.scrollTop = plan.scrollTop;
        targetColumn.dispatchEvent(new Event("scroll", { bubbles: true }));
        // Give Vue/virtualized lists time to replace their visible rows before
        // taking the next 80%-overlapped step.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await sleep(220);
        continue;
      } else if (plan.reason === "ambiguous-option") {
        return { option: null, reason: plan.reason };
      }
      // A virtualized list can grow after its first render. Keep observing
      // until the bounded timeout instead of treating the first bottom as a
      // permanent failure.
      await sleep(180);
    }
    return { option: null, reason: lastReason };
  }

  async function fillCategory(payload, report) {
    const totalSteps = payload.categoryPath.length + 1;
    let field = findCategoryField();
    const started = Date.now();
    while (!field && Date.now() - started < 8000) {
      await sleep(120);
      field = findCategoryField();
    }
    if (!field) {
      addReport(report, "missing", "分類", "找不到欄位");
      return;
    }
    const existing = categoryCurrentValue(field);
    if (existing) {
      if (categoryPathIsApplied(field, payload.categoryPath)) {
        addReport(report, "preserved", "分類", existing);
      } else {
        addReport(report, "missing", "分類", `目前分類「${existing}」與核准路徑不符`);
      }
      return;
    }
    const clickTarget = field.inputTriggers[0] || field.editControls[0] || field.controls[0];
    let dialog = findActiveCategoryDialog();
    if (!dialog && !clickTarget) {
      addReport(report, "missing", "分類", `步驟 1/${totalSteps}：找不到可點擊的分類輸入框或鉛筆按鈕`);
      return;
    }
    if (!dialog) {
      clickTarget.click();
      dialog = await waitForCategoryDialog(2400);
      if (!dialog) {
        clickTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        dialog = await waitForCategoryDialog(2400);
      }
    }
    if (!dialog) {
      addReport(report, "missing", "分類", `步驟 1/${totalSteps}：已找到分類卡，但無法開啟分類視窗`);
      return;
    }
    let option = null;
    for (let index = 0; index < payload.categoryPath.length; index += 1) {
      const segment = payload.categoryPath[index];
      const stageResult = await waitForCategoryStage(segment, index, 9000);
      option = stageResult.option;
      const stage = helpers.nextCategoryStage(index, payload.categoryPath.length, Boolean(option), false);
      if (stage === "wait-option") {
        const detail = stageResult.reason === "ambiguous-option" ? "同一欄出現重複選項" : "已安全捲到底仍未找到";
        addReport(report, "missing", "分類", `步驟 ${index + 1}/${totalSteps}：${detail}「${segment}」`);
        return;
      }
      if (stage !== "click-option") {
        addReport(report, "missing", "分類", `步驟 ${index + 1}/${totalSteps}：分類選擇流程狀態不正確`);
        return;
      }
      option.click();
      await sleep(300);
      if (index < payload.categoryPath.length - 1) {
        const nextColumnReady = await waitForNextCategoryColumn(index, 3500);
        if (!nextColumnReady) {
          addReport(report, "missing", "分類", `步驟 ${index + 2}/${totalSteps}：點選「${segment}」後，右側下一欄沒有出現`);
          return;
        }
      }
    }
    const appliedStarted = Date.now();
    let applied = false;
    while (!applied && Date.now() - appliedStarted < 8000) {
      await sleep(120);
      const refreshed = findCategoryField();
      applied = categoryPathIsApplied(refreshed, payload.categoryPath);
    }
    if (!applied) {
      addReport(report, "missing", "分類", `步驟 ${totalSteps}/${totalSteps}：分類選項都已點選，但頁面沒有顯示完整分類路徑`);
      return;
    }
    await waitForField(FIELD_LABELS.brand, 8000);
    addReport(report, "filled", "分類", payload.categoryPath.join(" ＞ "));
  }

  function pickPrimaryControl(field, descriptor) {
    if (!field || field.controls.length === 0) {
      return null;
    }
    if (descriptor.inputMode === "text") {
      return field.controls.find((control) => control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) || field.controls[0];
    }
    if (descriptor.inputMode === "select") {
      return field.controls.find((control) =>
        control instanceof HTMLSelectElement ||
        control.getAttribute("role") === "combobox" ||
        control.hasAttribute("aria-haspopup") ||
        (control instanceof HTMLInputElement && control.readOnly)
      ) || field.controls[0];
    }
    return field.controls[0];
  }

  function attributeDescriptor(row, key) {
    const definition = helpers.ATTRIBUTE_DEFINITIONS[key];
    let value = row.value;
    let unit = "";
    if (["weight", "length"].includes(key)) {
      const match = String(row.value).trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(kg|公斤|g|公克|cm|公分|mm|毫米|in|inch|英吋)?$/i);
      if (match) {
        value = match[1];
        unit = match[2] || "";
      }
    }
    return {
      value,
      unit,
      approvedOptions: helpers.approvedValueOptions(key, value),
      unitOptions: unit ? helpers.approvedValueOptions(`${key}Unit`, unit) : [],
      confidence: row.confidence === "high" ? 1 : row.confidence === "medium" ? 0.75 : 0.4,
      inputMode: definition.inputMode
    };
  }

  function attributeFieldLabelGroups(rows) {
    return (rows || []).map((row) => {
      const key = helpers.resolveAttributeKey(row.label);
      return key && FIELD_LABELS[key] ? FIELD_LABELS[key] : [];
    });
  }

  function setNativeSelectValue(control, option) {
    control.value = option.value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  async function fillNativeAttributeBatch(rows, report) {
    const pending = [];
    const verification = [];
    for (const row of rows || []) {
      const key = helpers.resolveAttributeKey(row.label);
      if (!key) {
        addReport(report, "skipped", row.label, "尚未核准此欄位的自動填寫規則");
        continue;
      }
      const descriptor = attributeDescriptor(row, key);
      if (descriptor.confidence < 0.7) {
        addReport(report, "skipped", row.label, "信心為 low");
        continue;
      }
      const field = findField(FIELD_LABELS[key]);
      const primary = pickPrimaryControl(field, descriptor);
      if (!field || !primary || descriptor.unit) {
        pending.push(row);
        continue;
      }
      const existing = controlValue(primary);
      if (!isEmptyValue(existing)) {
        addReport(report, "preserved", row.label, existing);
        continue;
      }
      const writableInput = primary instanceof HTMLTextAreaElement ||
        (primary instanceof HTMLInputElement && !primary.readOnly);
      const shouldType = descriptor.inputMode === "text" ||
        (["auto", "composite"].includes(descriptor.inputMode) && writableInput);
      if (shouldType && writableInput) {
        setNativeValue(primary, descriptor.value);
        verification.push({ row, control: primary, descriptor, approvedOptions: [] });
        continue;
      }
      if (primary instanceof HTMLSelectElement) {
        const option = Array.from(primary.options).find((entry) =>
          helpers.exactApprovedMatch(entry.textContent, descriptor.approvedOptions)
        );
        if (option) {
          setNativeSelectValue(primary, option);
          verification.push({ row, control: primary, descriptor, approvedOptions: descriptor.approvedOptions });
          continue;
        }
      }
      pending.push(row);
    }
    if (verification.length) await sleep(140);
    verification.forEach(({ row, control, descriptor, approvedOptions }) => {
      const applied = approvedOptions.length
        ? helpers.exactApprovedMatch(controlDisplayValue(control), approvedOptions)
        : !isEmptyValue(controlValue(control));
      addReport(
        report,
        applied ? "filled" : "missing",
        row.label,
        applied ? `${descriptor.value}（整區批次）` : "批次帶入後欄位仍為空白"
      );
    });
    return pending;
  }

  async function fillAttribute(row, report) {
    const key = helpers.resolveAttributeKey(row.label);
    if (!key) {
      addReport(report, "skipped", row.label, "尚未核准此欄位的自動填寫規則");
      return;
    }
    const descriptor = attributeDescriptor(row, key);
    if (descriptor.confidence < 0.7) {
      addReport(report, "skipped", row.label, "信心為 low");
      return;
    }
    const labels = FIELD_LABELS[key];
    const field = await waitForField(labels, 2200);
    const displayLabel = row.label;
    if (!field || field.controls.length === 0) {
      addReport(report, "missing", displayLabel, "找不到欄位");
      return;
    }
    const primary = pickPrimaryControl(field, descriptor);
    if (!primary) {
      addReport(report, "missing", displayLabel, "找不到輸入控制項");
      return;
    }
    const existing = controlValue(primary);
    if (!isEmptyValue(existing)) {
      addReport(report, "preserved", displayLabel, existing);
      return;
    }

    const writableInput = primary instanceof HTMLTextAreaElement || (primary instanceof HTMLInputElement && !primary.readOnly);
    let observedOptionCount = 0;
    const shouldType = descriptor.inputMode === "text" || (
      ["auto", "composite"].includes(descriptor.inputMode) &&
      writableInput
    );
    if (shouldType) {
      setNativeValue(primary, descriptor.value);
      await sleep(120);
      if (isEmptyValue(controlValue(primary))) {
        addReport(report, "missing", displayLabel, "輸入後欄位仍為空白");
        return;
      }
    } else {
      const selection = await chooseExactAttributeOption(field, primary, descriptor.approvedOptions);
      observedOptionCount = helpers.uniqueStrings(selection.observed || []).length;
      if (!selection.selected) {
        const observed = helpers.uniqueStrings(selection.observed || []).slice(0, 16);
        addReport(
          report,
          "missing",
          displayLabel,
          observed.length
            ? `預先準備的「${descriptor.value}」不在蝦皮固定選項中；實際選項：${observed.join("、")}`
            : "點開後沒有讀到可選項目"
        );
        return;
      }
    }

    if (descriptor.unit) {
      const unitControl = field.controls.find((control) => control !== primary);
      if (!unitControl) {
        addReport(report, "missing", `${displayLabel}單位`, "找不到單位欄位");
      } else if (!isEmptyValue(controlValue(unitControl))) {
        addReport(report, "preserved", `${displayLabel}單位`, controlValue(unitControl));
      } else {
        const selectedUnit = await chooseExactAttributeOption(field, unitControl, descriptor.unitOptions);
        if (!selectedUnit.selected) {
          addReport(report, "missing", `${displayLabel}單位`, "找不到完全相符單位");
        }
      }
    }
    if (report.missing.some((item) => item.startsWith(`${displayLabel}單位：`))) {
      return;
    }
    addReport(
      report,
      "filled",
      displayLabel,
      `${descriptor.value}${descriptor.unit ? ` ${descriptor.unit}` : ""}${observedOptionCount ? `（已核對 ${observedOptionCount} 個固定選項）` : ""}`
    );
  }

  function isSellerPaysToggle(control) {
    const labelText = String(control.closest("label")?.textContent || "");
    return labelText.includes("我將承擔運費");
  }

  function primaryLogisticsToggles(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll([
      "[role='switch']",
      "button[aria-checked]",
      "input[type='checkbox']",
      ".el-switch"
    ].join(","))).filter((control) =>
      isVisible(control) &&
      !control.classList.contains("is-disabled") &&
      !isSellerPaysToggle(control)
    );
  }

  function distinctLogisticsLabels(container) {
    return new Set(
      findExactTextElements(ALL_LOGISTICS_LABELS, container)
        .map((element) => helpers.normalizeText(element.textContent))
        .filter(Boolean)
    );
  }

  function logisticsRowFromLabel(label) {
    let toggleContainer = label.parentElement;
    let toggle = null;
    for (let depth = 0; toggleContainer && depth < 7; depth += 1, toggleContainer = toggleContainer.parentElement) {
      const candidates = primaryLogisticsToggles(toggleContainer);
      if (candidates.length === 1) {
        toggle = candidates[0];
        break;
      }
      if (candidates.length > 1) return null;
    }
    if (!toggle || !toggleContainer) return null;

    // The switch often lives in a small heading wrapper while its dynamically
    // rendered size/fee controls are siblings. Expand only while this is still
    // exactly one logistics row, never into the whole logistics list/form.
    let container = toggleContainer;
    let parent = container.parentElement;
    for (let depth = 0; parent && depth < 6; depth += 1, parent = parent.parentElement) {
      if (!parent.contains(label) || !parent.contains(toggle)) break;
      if (primaryLogisticsToggles(parent).length > 1) break;
      if (distinctLogisticsLabels(parent).size > 1) break;
      if (findExactTextElement(FIELD_LABELS.preorder, parent)) break;
      container = parent;
    }
    return { label, container, toggle };
  }

  function findLogisticsRow(labelAliases) {
    for (const label of findExactTextElements(labelAliases)) {
      const row = logisticsRowFromLabel(label);
      if (row) return row;
    }
    return null;
  }

  function toggleState(toggle) {
    if (toggle instanceof HTMLInputElement) {
      return toggle.checked;
    }
    const aria = toggle.getAttribute("aria-checked");
    if (aria === "true" || aria === "false") {
      return aria === "true";
    }
    return toggle.classList.contains("active") ||
      toggle.classList.contains("checked") ||
      toggle.classList.contains("is-checked") ||
      toggle.dataset.state === "checked";
  }

  async function waitForLogisticsRow(labelAliases, timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const row = findLogisticsRow(labelAliases);
      if (row) return row;
      await sleep(120);
    }
    return findLogisticsRow(labelAliases);
  }

  function logisticsBandControl(row) {
    if (!row) return null;
    const sellerPays = sellerPaysControl(row);
    return fieldControls(row.container)
      .filter((control) => control !== row.toggle && control !== sellerPays)
      .map((control) => {
        const display = controlDisplayValue(control);
        let score = 0;
        if (
          control instanceof HTMLSelectElement ||
          control.getAttribute("role") === "combobox" ||
          control.hasAttribute("aria-haspopup")
        ) score += 100;
        if (/S\s*\d+|\d+\s*[-–~至～]\s*\d+\s*cm|≤\s*\d+\s*cm/i.test(display)) score += 70;
        if (isEmptyValue(display)) score += 10;
        return { control, score };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.control || null;
  }

  async function waitForLogisticsBandControl(labelAliases, timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const row = findLogisticsRow(labelAliases);
      const control = logisticsBandControl(row);
      if (row && control) return { row, control };
      await sleep(120);
    }
    const row = findLogisticsRow(labelAliases);
    return { row, control: logisticsBandControl(row) };
  }

  async function waitForLogisticsBandValue(labelAliases, approvedOptions, timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const row = findLogisticsRow(labelAliases);
      const control = logisticsBandControl(row);
      if (control && logisticsOptionMatches(controlDisplayValue(control), approvedOptions)) {
        return { row, control };
      }
      await sleep(120);
    }
    return null;
  }

  async function reconcileLogisticsToggle(labelAliases, enabled) {
    let row = await waitForLogisticsRow(labelAliases, 2500);
    if (!row) return { ok: !enabled, row: null, changed: false };
    if (toggleState(row.toggle) === enabled) return { ok: true, row, changed: false };
    row.toggle.click();
    const started = Date.now();
    while (Date.now() - started < 3000) {
      await sleep(120);
      row = findLogisticsRow(labelAliases) || row;
      if (toggleState(row.toggle) === enabled) return { ok: true, row, changed: true };
    }
    return { ok: false, row, changed: true };
  }

  function sellerPaysControl(row) {
    if (!row) return null;
    const label = findExactTextElement(["我將承擔運費"], row.container);
    return label && (
      label.closest("label")?.querySelector("input[type='checkbox'], [role='checkbox']") ||
      label.parentElement?.querySelector("input[type='checkbox'], [role='checkbox']")
    );
  }

  function sellerFeeControl(row) {
    if (!row) return null;
    const pays = sellerPaysControl(row);
    return fieldControls(row.container).find((control) =>
      control !== row.toggle &&
      control !== pays &&
      (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) &&
      !["checkbox", "radio", "hidden"].includes(String(control.type || "").toLowerCase()) &&
      !control.readOnly &&
      !control.disabled
    ) || null;
  }

  async function reconcileSellerPays(labelAliases, desired, displayLabel, report) {
    let row = findLogisticsRow(labelAliases);
    let control = sellerPaysControl(row);
    const started = Date.now();
    while (!control && Date.now() - started < 2500) {
      await sleep(120);
      row = findLogisticsRow(labelAliases);
      control = sellerPaysControl(row);
    }
    if (!control) {
      if (desired) addReport(report, "missing", `${displayLabel}運費`, "找不到賣家承擔運費欄位");
      return;
    }
    if (toggleState(control) !== desired) {
      control.click();
      const verifyStarted = Date.now();
      let applied = false;
      while (!applied && Date.now() - verifyStarted < 2000) {
        await sleep(120);
        row = findLogisticsRow(labelAliases);
        control = sellerPaysControl(row) || control;
        applied = toggleState(control) === desired;
      }
      if (!applied) {
        addReport(report, "missing", `${displayLabel}運費`, "無法套用運費承擔設定");
        return;
      }
      addReport(report, "filled", `${displayLabel}運費`, desired ? "賣家承擔" : "買家支付");
    } else {
      addReport(report, "preserved", `${displayLabel}運費`, desired ? "賣家承擔" : "買家支付");
    }
  }

  async function fillLogistics(payload, report) {
    const methods = payload.logistics && Array.isArray(payload.logistics.methods)
      ? payload.logistics.methods
      : [];
    for (const method of methods) {
      const key = helpers.resolveLogisticsKey(method.label);
      if (!key) {
        addReport(report, "skipped", method.label || "物流", "不是核准的物流名稱");
        continue;
      }
      const labels = LOGISTICS_LABELS[key];
      const displayLabel = method.label;
      const state = await reconcileLogisticsToggle(labels, method.enabled === true);
      if (!state.row) {
        addReport(
          report,
          method.enabled ? "missing" : "skipped",
          displayLabel,
          method.enabled ? "找不到物流選項" : "頁面未提供，視為關閉"
        );
        continue;
      }
      if (!state.ok) {
        addReport(report, "missing", displayLabel, method.enabled ? "無法開啟" : "無法關閉");
        continue;
      }
      let activeRow = state.row;
      if (!method.enabled) {
        addReport(report, state.changed ? "filled" : "skipped", displayLabel, state.changed ? "已關閉" : "維持關閉");
        continue;
      }
      addReport(report, state.changed ? "filled" : "preserved", displayLabel, state.changed ? "已開啟" : "原本已開啟");

      if (method.option) {
        const located = await waitForLogisticsBandControl(labels, 4000);
        activeRow = located.row || activeRow;
        const bandControl = located.control;
        if (!bandControl) {
          await reconcileLogisticsToggle(labels, false);
          addReport(report, "missing", `${displayLabel}尺寸`, "找不到尺寸級距");
          continue;
        }
        const currentBand = controlDisplayValue(bandControl);
        const approvedOptions = helpers.logisticsOptionAliases(method.option);
        if (!isEmptyValue(currentBand) && logisticsOptionMatches(currentBand, approvedOptions)) {
          addReport(report, "preserved", `${displayLabel}尺寸`, currentBand);
        } else {
          const clicked = await chooseLogisticsOption(bandControl, approvedOptions);
          const selected = clicked
            ? await waitForLogisticsBandValue(labels, approvedOptions, 3500)
            : null;
          if (!selected) {
            await reconcileLogisticsToggle(labels, false);
            addReport(report, "missing", `${displayLabel}尺寸`, "找不到完全相符級距");
            continue;
          }
          activeRow = selected.row || activeRow;
          addReport(report, "filled", `${displayLabel}尺寸`, method.option);
        }
      }

      activeRow = findLogisticsRow(labels) || activeRow;
      if (method.feeTwd !== null && method.feeTwd !== undefined) {
        let feeControl = sellerFeeControl(activeRow);
        const feeStarted = Date.now();
        while (!feeControl && Date.now() - feeStarted < 3000) {
          await sleep(120);
          activeRow = findLogisticsRow(labels) || activeRow;
          feeControl = sellerFeeControl(activeRow);
        }
        if (!feeControl) {
          addReport(report, "missing", `${displayLabel}費用`, "找不到運費輸入欄位");
          continue;
        }
        const currentFee = Number(String(controlValue(feeControl)).replace(/[^0-9.-]/g, ""));
        if (currentFee === method.feeTwd) {
          addReport(report, "preserved", `${displayLabel}費用`, `NT$${method.feeTwd}`);
        } else {
          setNativeValue(feeControl, method.feeTwd);
          await sleep(180);
          const appliedFee = Number(String(controlValue(feeControl)).replace(/[^0-9.-]/g, ""));
          if (appliedFee !== method.feeTwd) {
            addReport(report, "missing", `${displayLabel}費用`, `無法設定 NT$${method.feeTwd}`);
            continue;
          }
          addReport(report, "filled", `${displayLabel}費用`, `NT$${method.feeTwd}`);
        }
      }
      await reconcileSellerPays(labels, method.sellerPays === true, displayLabel, report);
    }
  }

  function radioChecked(element) {
    if (element instanceof HTMLInputElement) {
      return element.checked;
    }
    return element.getAttribute("aria-checked") === "true";
  }

  async function fillPreorder(payload, report) {
    if (!payload.preorder) {
      return;
    }
    let label = findExactTextElement(FIELD_LABELS.preorder);
    const labelStarted = Date.now();
    while (!label && Date.now() - labelStarted < 5000) {
      await sleep(120);
      label = findExactTextElement(FIELD_LABELS.preorder);
    }
    if (!label) {
      addReport(report, "missing", "預購", "找不到欄位");
      return;
    }
    const approvedOptions = payload.preorder.enabled ? ["是", "Yes"] : ["否", "No"];
    let container = label.parentElement;
    for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
      const radios = Array.from(container.querySelectorAll("input[type='radio'], [role='radio']")).filter(isVisible);
      if (radios.length > 0) {
        const checked = radios.find(radioChecked);
        if (checked) {
          const checkedText = String(checked.closest("label, [role='radio']")?.textContent || checked.value || "").trim();
          if (helpers.exactApprovedMatch(checkedText, approvedOptions)) {
            addReport(report, "preserved", "預購", checkedText || (payload.preorder.enabled ? "是" : "否"));
            return;
          }
        }
        const desiredRadio = radios.find((radio) => {
          const text = String(radio.closest("label, [role='radio']")?.textContent || radio.value || "").trim();
          return helpers.exactApprovedMatch(text, approvedOptions);
        });
        if (desiredRadio) {
          desiredRadio.click();
          const verifyStarted = Date.now();
          let applied = radioChecked(desiredRadio);
          while (!applied && Date.now() - verifyStarted < 2000) {
            await sleep(120);
            const refreshedLabel = findExactTextElement(FIELD_LABELS.preorder);
            let refreshedContainer = refreshedLabel?.parentElement;
            for (let refreshedDepth = 0; refreshedContainer && refreshedDepth < 6; refreshedDepth += 1, refreshedContainer = refreshedContainer.parentElement) {
              const refreshedRadios = Array.from(
                refreshedContainer.querySelectorAll("input[type='radio'], [role='radio']")
              ).filter(isVisible);
              const refreshedDesired = refreshedRadios.find((radio) => {
                const text = String(radio.closest("label, [role='radio']")?.textContent || radio.value || "").trim();
                return helpers.exactApprovedMatch(text, approvedOptions);
              });
              if (refreshedDesired) {
                applied = radioChecked(refreshedDesired);
                break;
              }
            }
          }
          if (applied) {
            addReport(report, "filled", "預購", payload.preorder.enabled ? "是" : "否");
          } else {
            addReport(report, "missing", "預購", "無法套用指定選項");
          }
        } else {
          addReport(report, "missing", "預購", "找不到完全相符選項");
        }
        return;
      }
    }
    addReport(report, "missing", "預購", "找不到選項");
  }

  function createReport() {
    return {
      filled: [], preserved: [], skipped: [], missing: [],
      execution: {
        mode: "section-batch",
        fieldLabelsIndexedOncePerSection: true,
        nativeControlsFilledInSinglePass: true,
        dynamicControlsSequentialWithinSection: true,
        sectionValidationOnce: true
      }
    };
  }

  function normalizedSellerSku(value) {
    return String(value == null ? "" : value)
      .normalize("NFKC")
      .replace(/\u00a0/g, " ")
      .trim()
      .replace(/^'+/, "")
      .toUpperCase();
  }

  function staticSellerSkuValues(label) {
    const values = [];
    const inspect = (element) => {
      if (!(element instanceof Element) || !isVisible(element)) return;
      if (element.closest("#youzi-shopee-autofill-overlay")) return;
      if (findExactTextElements(Object.values(FIELD_LABELS).flat(), element).some((candidate) => candidate !== label)) return;
      const text = String(element.textContent || "").normalize("NFKC").replace(/\u00a0/g, " ").trim();
      if (!text || text.length > 160) return;
      const sku = String(text.replace(/^[:：\s-]+/, "").split(/\s+/)[0] || "");
      if (/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(sku)) values.push(sku);
    };

    inspect(label.nextElementSibling);
    const parent = label.parentElement;
    if (parent && parent.getBoundingClientRect().width <= 720 && parent.getBoundingClientRect().height <= 180) {
      Array.from(parent.children).filter((child) => child !== label).forEach(inspect);
    }
    return values;
  }

  function visibleSellerSkuObservation() {
    const labels = findExactTextElements(FIELD_LABELS.sku);
    if (labels.length === 0) {
      return { state: "absent", values: [] };
    }

    const candidates = [];
    labels.forEach((label) => {
      if (label.tagName === "LABEL" && label.htmlFor) {
        const direct = document.getElementById(label.htmlFor);
        if (direct && isVisible(direct)) candidates.push(direct);
      }

      let container = label.parentElement;
      for (let depth = 0; container && depth < 5; depth += 1, container = container.parentElement) {
        const eligibleControls = fieldControls(container).filter((control) =>
          !control.matches("input[type='checkbox'], input[type='radio'], button")
        );
        const controls = eligibleControls.filter((control) => {
          if (control.matches("input[type='checkbox'], input[type='radio'], button")) return false;
          const metadata = [
            control.getAttribute("name"),
            control.id,
            control.getAttribute("aria-label"),
            control.getAttribute("placeholder")
          ].filter(Boolean).join(" ");
          return /seller[\s_-]*sku|賣家[\s_-]*sku|^sku$/i.test(metadata.trim());
        });
        if (controls.length > 0) {
          candidates.push(...controls);
          break;
        }
        const otherFieldLabel = findExactTextElements(Object.values(FIELD_LABELS).flat(), container)
          .find((candidate) => candidate !== label && !helpers.exactApprovedMatch(candidate.textContent, FIELD_LABELS.sku));
        if (eligibleControls.length === 1 && !otherFieldLabel) {
          candidates.push(eligibleControls[0]);
          break;
        }
      }
      candidates.push(...staticSellerSkuValues(label));
    });

    const values = helpers.uniqueStrings(
      candidates.map((candidate) => normalizedSellerSku(
        candidate instanceof Element ? controlValue(candidate) : candidate
      )).filter(Boolean)
    );
    if (values.length === 0) return { state: "empty", values: [] };
    if (values.length > 1) return { state: "ambiguous", values };
    return { state: "value", values };
  }

  function verifyIdentity(payload, options) {
    const requireSellerSku = Boolean(options && options.requireSellerSku);
    const observed = visibleSellerSkuObservation();
    const observedSkuText = observed.state === "value"
      ? `賣家 SKU ${observed.values[0]}`
      : "";
    const pageIdentity = helpers.resolveQueuePageIdentity(
      payload,
      location.href,
      observedSkuText
    );
    if (pageIdentity === "mismatch") {
      return { ok: false, message: "網址中的 EasyStore 商品 ID 與排隊資料不符。" };
    }
    if (observed.state === "ambiguous") {
      return { ok: false, message: "頁面上出現多個不同的賣家 SKU，為避免填錯商品已停止。" };
    }
    if (
      observed.state === "value"
      && observed.values[0] !== normalizedSellerSku(payload.sku)
    ) {
      return { ok: false, message: "頁面上的賣家 SKU 與排隊資料不符。" };
    }
    if (
      pageIdentity === "pending"
      || (requireSellerSku && (observed.state === "absent" || observed.state === "empty"))
    ) {
      return { ok: false, pending: true, message: "頁面尚未顯示可核對的賣家 SKU；請等待欄位載入後再試。" };
    }
    return { ok: true, message: "" };
  }

  async function waitForVerifiedSellerSku(payload, timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const identity = verifyIdentity(payload, { requireSellerSku: true });
      if (identity.ok || !identity.pending) return identity;
      await sleep(120);
    }
    return verifyIdentity(payload, { requireSellerSku: true });
  }

  async function runAutofill(payload) {
    const identity = verifyIdentity(payload);
    if (!identity.ok) {
      throw new Error(identity.message);
    }
    const validation = helpers.validateQueuePayload(payload, Date.now());
    if (!validation.ok) {
      throw new Error(validation.errors.join("；"));
    }
    const report = createReport();
    await fillCategory(payload, report);
    const categoryProblem = report.missing.find((item) => /^分類(?:：|$)/.test(item));
    if (categoryProblem) {
      report.blockedStage = "category";
      return report;
    }
    const categoryIdentity = await waitForVerifiedSellerSku(payload, 5000);
    if (!categoryIdentity.ok) {
      throw new Error(categoryIdentity.message);
    }
    const advancedDescriptionMissingBefore = report.missing.length;
    await fillAdvancedDescription(payload, report);
    if (report.missing.length > advancedDescriptionMissingBefore) {
      report.blockedStage = "advancedDescription";
      return report;
    }
    await withFieldLabelIndex([FIELD_LABELS.brand], () => fillBrand(payload, report));
    const brandProblem = report.missing.find((item) => /^品牌(?:：|$)/.test(item));
    if (brandProblem) {
      report.blockedStage = "brand";
      return report;
    }
    const attributeMissingBefore = report.missing.length;
    const attributeRows = payload.attributes || [];
    const labelGroups = attributeFieldLabelGroups(attributeRows);
    const pendingAttributes = await withFieldLabelIndex(
      labelGroups,
      () => fillNativeAttributeBatch(attributeRows, report)
    );
    if (pendingAttributes.length) {
      await withFieldLabelIndex(labelGroups, async () => {
        for (const row of pendingAttributes) await fillAttribute(row, report);
      });
    }
    if (report.missing.length > attributeMissingBefore) {
      report.blockedStage = "attributes";
      return report;
    }
    await withFieldLabelIndex(Object.values(LOGISTICS_LABELS), () => fillLogistics(payload, report));
    const logisticsProblem = report.missing.find((item) =>
      /^(?:黑貓宅急便|蝦皮店到店|7-ELEVEN|7-11|新竹物流|全家|賣家宅配|嘉里快遞|店到家宅配)/.test(item)
    );
    if (logisticsProblem) {
      report.blockedStage = "logistics";
      return report;
    }
    await withFieldLabelIndex([FIELD_LABELS.preorder], () => fillPreorder(payload, report));
    const preorderProblem = report.missing.find((item) => /^預購(?:：|$)/.test(item));
    if (preorderProblem) {
      report.blockedStage = "preorder";
      return report;
    }
    return report;
  }

  function consumeQueueRecord(payload) {
    return new Promise((resolve, reject) => {
      queueStorage.get(helpers.QUEUE_STORAGE_KEY, (stored) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const queue = stored[helpers.QUEUE_STORAGE_KEY];
        const record = queue && queue[payload.easyStoreProductId];
        if (!record || !record.payload || record.payload.nonce !== payload.nonce) {
          resolve(false);
          return;
        }
        const next = Object.assign({}, queue);
        delete next[payload.easyStoreProductId];
        const done = () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(true);
        };
        if (Object.keys(next).length === 0) {
          queueStorage.remove(helpers.QUEUE_STORAGE_KEY, done);
        } else {
          queueStorage.set({ [helpers.QUEUE_STORAGE_KEY]: next }, done);
        }
      });
    });
  }

  function appendTextElement(parent, tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function shopeeSyncLinkForProduct(productId) {
    return Array.from(document.querySelectorAll("a[href]"))
      .filter(isVisible)
      .find((link) => {
        try {
          const url = new URL(link.href, location.href);
          return helpers.easyStoreRouteKind(url.href) === "shopee-sync" &&
            helpers.extractProductIds(url.href).includes(String(productId));
        } catch (error) {
          return false;
        }
      }) || null;
  }

  function shopeeRefreshTargets() {
    const targets = [];
    for (const label of findExactTextElements(SHOPEE_REFRESH_LABELS)) {
      let parent = label.parentElement;
      let belongsToShopee = false;
      for (let depth = 0; parent && depth < 6; depth += 1, parent = parent.parentElement) {
        if (parent.id === "youzi-shopee-autofill-overlay" || parent.matches("body, html")) break;
        if (helpers.shopeeEntryTextMatch(parent.textContent, SHOPEE_ENTRY_LABELS)) {
          belongsToShopee = true;
          break;
        }
      }
      if (!belongsToShopee) continue;
      const target = label.closest("a, button, [role='button'], [tabindex]") || label;
      if (isVisible(target) && !targets.includes(target)) targets.push(target);
    }
    return targets;
  }

  function shopeeNavigationTargets(record) {
    const directLink = shopeeSyncLinkForProduct(record.payload.easyStoreProductId);
    const targets = directLink ? [directLink] : [];
    const labels = findTextElements(
      SHOPEE_ENTRY_LABELS,
      document,
      (actual, approved) => helpers.shopeeEntryTextMatch(actual, approved)
    );
    for (const label of labels) {
      const target = label.closest("a, button, [role='button'], [tabindex]") || label;
      if (!targets.includes(target)) {
        targets.push(target);
      }
    }
    for (const target of shopeeRefreshTargets()) {
      if (!targets.includes(target)) targets.push(target);
    }
    return targets.sort((left, right) => {
      const score = (element) => {
        const href = element instanceof HTMLAnchorElement ? element.href : "";
        const text = shopeeTargetText(element);
        if (href && helpers.easyStoreRouteKind(href) === "shopee-sync") return 100;
        if (isShopeeRefreshTarget(element)) return 90;
        if (helpers.classifyShopeeActionText(text) !== "unknown") return 80;
        if (element.matches("button, [role='button']")) return 20;
        if (element instanceof HTMLAnchorElement) return 10;
        return 0;
      };
      return score(right) - score(left);
    });
  }

  function isShopeeRefreshTarget(element) {
    if (!(element instanceof Element)) return false;
    return [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-label")
    ].some((value) => helpers.exactApprovedMatch(value, SHOPEE_REFRESH_LABELS));
  }

  function isShopeeFollowupTarget(record, element, allowGenericEntry) {
    if (!(element instanceof Element)) return false;
    const href = element instanceof HTMLAnchorElement ? element.href : "";
    if (href && helpers.easyStoreRouteKind(href) === "shopee-sync") return true;
    if (isShopeeRefreshTarget(element)) return true;
    if (allowGenericEntry && helpers.shopeeEntryTextMatch(shopeeTargetText(element), SHOPEE_ENTRY_LABELS)) return true;
    return shopeeNavigationModeForTarget(record, element) !== "unknown";
  }

  function productNavigationIsCurrent(record, navigationOverlay) {
    if (!record || !record.payload || !navigationOverlay || !navigationOverlay.isConnected) return false;
    if (!currentRecord || currentRecord.payload.nonce !== record.payload.nonce) return false;
    if (helpers.easyStoreRouteKind(location.href) !== "product") return false;
    return helpers.extractProductIds(location.href).includes(String(record.payload.easyStoreProductId));
  }

  async function waitForShopeeNavigationTargets(record, navigationOverlay, timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (!productNavigationIsCurrent(record, navigationOverlay)) return [];
      const targets = shopeeNavigationTargets(record);
      if (targets.length > 0) return targets;
      await sleep(250);
    }
    return productNavigationIsCurrent(record, navigationOverlay)
      ? shopeeNavigationTargets(record)
      : [];
  }

  function shopeeTargetText(element) {
    if (!(element instanceof Element)) return "";
    const parts = [];
    for (const value of [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-label")
    ]) {
      const text = String(value || "").trim();
      if (text && !parts.includes(text)) parts.push(text);
    }
    return parts.join("｜");
  }

  function shopeeNavigationModeForTarget(record, element) {
    let mode = helpers.classifyShopeeActionText(shopeeTargetText(element));
    if (mode !== "unknown") return mode;
    let parent = element instanceof Element ? element.parentElement : null;
    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      const text = String(parent.textContent || "").trim();
      if (!text || text.length > 500) continue;
      mode = helpers.classifyShopeeActionText(text);
      if (mode !== "unknown") return mode;
    }
    const policy = record && record.payload && record.payload.listingPolicy || {};
    const href = element instanceof HTMLAnchorElement ? element.href : "";
    const isDirectSyncLink = href && helpers.easyStoreRouteKind(href) === "shopee-sync";
    if (isDirectSyncLink) return helpers.directSyncNavigationMode(policy);
    return "unknown";
  }

  function rememberShopeeNavigationMode(record, mode) {
    return new Promise((resolve, reject) => {
      queueStorage.get(helpers.QUEUE_STORAGE_KEY, (stored) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const queue = helpers.withQueueNavigationMode(
          stored[helpers.QUEUE_STORAGE_KEY],
          record.payload.easyStoreProductId,
          record.payload.nonce,
          mode,
          Date.now()
        );
        queueStorage.set({ [helpers.QUEUE_STORAGE_KEY]: queue }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          record.navigationMode = helpers.normalizeShopeeNavigationMode(mode);
          record.navigationObservedAt = Date.now();
          resolve(record.navigationMode);
        });
      });
    });
  }

  async function waitForShopeeNavigation(record, navigationOverlay, previousUrl, timeout, ignoredTarget) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const routeKind = helpers.easyStoreRouteKind(location.href);
      if (location.href !== previousUrl && routeKind === "shopee-sync") {
        let storeIds = [];
        try {
          const url = new URL(location.href);
          storeIds = ["store_product_id", "store_product_ids"]
            .flatMap((key) => String(url.searchParams.get(key) || "").split(","))
            .map((value) => value.trim())
            .filter(Boolean);
        } catch (error) {
          storeIds = [];
        }
        return new Set(storeIds).size === 1 && storeIds[0] === String(record.payload.easyStoreProductId)
          ? { navigated: true, link: null }
          : { navigated: false, link: null };
      }
      if (!productNavigationIsCurrent(record, navigationOverlay)) return { navigated: false, link: null };
      const link = shopeeSyncLinkForProduct(record.payload.easyStoreProductId);
      if (link && link !== ignoredTarget) {
        return { navigated: false, link };
      }
      const allowGenericEntry = isShopeeRefreshTarget(ignoredTarget);
      const followup = shopeeNavigationTargets(record).find((target) => (
        target !== ignoredTarget
        && isShopeeFollowupTarget(record, target, allowGenericEntry)
      ));
      if (followup) return { navigated: false, link: followup };
      await sleep(250);
    }
    return { navigated: false, link: null };
  }

  function renderReport(container, report) {
    container.textContent = "";
    const counts = document.createElement("div");
    counts.className = "youzi-autofill__counts";
    [
      ["已填", report.filled.length],
      ["保留人工值", report.preserved.length],
      ["略過", report.skipped.length],
      ["待補", report.missing.length]
    ].forEach(([label, count]) => {
      appendTextElement(counts, "div", "youzi-autofill__count", `${label}：${count}`);
    });
    container.appendChild(counts);
    const list = document.createElement("ul");
    list.className = "youzi-autofill__report";
    [
      ["待補", report.missing],
      ["已填", report.filled],
      ["保留", report.preserved],
      ["略過", report.skipped]
    ].forEach(([bucketLabel, items]) => {
      items.forEach((item) => appendTextElement(list, "li", "", `${bucketLabel}｜${item}`));
    });
    container.appendChild(list);
    const stageNotices = {
      category: "分類尚未完成，因此助手已停在第一階段，沒有搜尋或修改後面的品牌、屬性、物流與預購。",
      advancedDescription: "進階商品描述已在進站前準備完成，但頁面無法套用，因此助手沒有繼續發布。",
      brand: "品牌是必填欄位；品牌尚未完成，因此助手已停在第二階段，沒有搜尋或修改後面的屬性、物流與預購。",
      attributes: "商品屬性尚未完成，因此助手已停在第三階段，沒有修改後面的物流與預購。",
      logistics: "物流是必填階段；指定物流尚未完成，因此助手已停在第四階段，沒有進入預購與最後發布。",
      preorder: "預購設定尚未完成，因此助手已停在第五階段，沒有進入最後發布。"
    };
    appendTextElement(container, "div", "youzi-autofill__notice", stageNotices[report.blockedStage]
      ? stageNotices[report.blockedStage]
      : report.missing.length > 0
      ? "仍有待補欄位，因此不會送出；補齊後可再執行一次。"
      : "資料完整時會接著按 EasyStore 的上架；若 EasyStore 仍顯示錯誤，助手會停下並保留畫面。"
    );
  }

  function mountOverlay(record) {
    currentRecord = record;
    if (overlay) {
      overlay.remove();
    }
    overlay = document.createElement("section");
    overlay.id = "youzi-shopee-autofill-overlay";
    overlay.setAttribute("aria-label", "柚子樂器蝦皮自動填寫");

    const header = document.createElement("header");
    header.className = "youzi-autofill__header";
    const heading = document.createElement("div");
    appendTextElement(heading, "h2", "youzi-autofill__title", "蝦皮資料已準備好");
    appendTextElement(heading, "div", "youzi-autofill__subtitle", "自動填寫完成且沒有待補時，接著送到蝦皮");
    header.appendChild(heading);
    const close = appendTextElement(header, "button", "youzi-autofill__close", "關閉");
    close.type = "button";
    close.addEventListener("click", () => overlay.remove());
    overlay.appendChild(header);

    const body = document.createElement("div");
    body.className = "youzi-autofill__body";
    const identity = document.createElement("div");
    identity.className = "youzi-autofill__identity";
    appendTextElement(identity, "div", "", record.payload.title || "待上架商品");
    appendTextElement(identity, "div", "", `SKU：${record.payload.sku}`);
    appendTextElement(identity, "div", "", `EasyStore 商品 ID：${record.payload.easyStoreProductId}`);
    body.appendChild(identity);
    appendTextElement(
      body,
      "div",
      "youzi-autofill__notice",
      "非空白欄位視為人工資料並保留；下拉選單只選完全相符或核准同義詞。"
    );
    const actions = document.createElement("div");
    actions.className = "youzi-autofill__actions";
    const start = appendTextElement(actions, "button", "youzi-autofill__start", "自動填寫並上架蝦皮");
    start.type = "button";
    body.appendChild(actions);
    const status = appendTextElement(body, "div", "youzi-autofill__status", "尚未修改任何欄位。 ");
    const reportContainer = document.createElement("div");
    body.appendChild(reportContainer);
    overlay.appendChild(body);
    document.documentElement.appendChild(overlay);

    async function startAutofillAndPublish() {
      start.disabled = true;
      status.textContent = "正在依欄位名稱填寫，請不要切換商品……";
      reportContainer.textContent = "";
      try {
        const report = await runAutofill(currentRecord.payload);
        renderReport(reportContainer, report);
        if (report.blockedStage) {
          status.textContent = report.missing[0] || "分類尚未完成。";
          start.disabled = false;
          start.textContent = ({
            category: "重新嘗試選擇分類",
            advancedDescription: "重新套用進階商品描述",
            brand: "重新嘗試選擇品牌",
            attributes: "重新嘗試填寫屬性",
            logistics: "重新嘗試設定物流",
            preorder: "重新嘗試設定預購"
          })[report.blockedStage] || "補齊後重新檢查";
          return;
        }
        const navigationMode = helpers.resolveShopeeNavigationMode(
          document.body ? document.body.innerText : "",
          currentRecord.navigationMode
        );
        const gate = helpers.autoPublishGate(currentRecord.payload, report, navigationMode);
        if (!gate.ok) {
          status.textContent = `已停止上架：${gate.reasons.join("；")}`;
          start.disabled = false;
          start.textContent = "補齊後重新檢查並上架";
          return;
        }
        status.textContent = "欄位已完成，正在送到蝦皮……";
        await publishToShopee(currentRecord.payload, report, navigationMode);
        await consumeQueueRecord(currentRecord.payload);
        status.textContent = "已送出 EasyStore → 蝦皮上架；請等待 EasyStore／蝦皮處理結果。";
        start.textContent = "已送出蝦皮上架";
      } catch (error) {
        status.textContent = `已停止：${error.message}`;
        start.disabled = false;
        start.textContent = "重新檢查並上架";
      }
    }
    start.addEventListener("click", startAutofillAndPublish);
    setTimeout(() => {
      if (overlay && overlay.isConnected && !start.disabled) start.click();
    }, 450);
  }

  function mountProductNavigationOverlay(record) {
    currentRecord = record;
    if (overlay) {
      overlay.remove();
    }
    overlay = document.createElement("section");
    overlay.id = "youzi-shopee-autofill-overlay";
    overlay.setAttribute("aria-label", "柚子樂器蝦皮自動填寫");

    const header = document.createElement("header");
    header.className = "youzi-autofill__header";
    const heading = document.createElement("div");
    appendTextElement(heading, "h2", "youzi-autofill__title", "蝦皮資料已準備好");
    appendTextElement(heading, "div", "youzi-autofill__subtitle", "先進入這件商品的蝦皮設定頁");
    header.appendChild(heading);
    const close = appendTextElement(header, "button", "youzi-autofill__close", "關閉");
    close.type = "button";
    close.addEventListener("click", () => overlay.remove());
    overlay.appendChild(header);

    const body = document.createElement("div");
    body.className = "youzi-autofill__body";
    const identity = document.createElement("div");
    identity.className = "youzi-autofill__identity";
    appendTextElement(identity, "div", "", record.payload.title || "待上架商品");
    appendTextElement(identity, "div", "", `SKU：${record.payload.sku}`);
    body.appendChild(identity);
    const actions = document.createElement("div");
    actions.className = "youzi-autofill__actions";
    const openShopee = appendTextElement(actions, "button", "youzi-autofill__start", "開啟蝦皮設定");
    openShopee.type = "button";
    body.appendChild(actions);
    const status = appendTextElement(body, "div", "youzi-autofill__status", "會使用 EasyStore 原本的蝦皮串接，不會改動訂單或庫存設定。");
    overlay.appendChild(body);
    document.documentElement.appendChild(overlay);

    async function openShopeeSettings() {
      openShopee.disabled = true;
      status.textContent = "正在等待 EasyStore 載入蝦皮銷售管道……";
      const navigationOverlay = overlay;
      const targets = await waitForShopeeNavigationTargets(record, navigationOverlay, 10000);
      if (!productNavigationIsCurrent(record, navigationOverlay)) return;
      if (targets.length === 0) {
        status.textContent = "找不到蝦皮入口；請在商品頁展開「銷售管道」，再點「蝦皮購物」。";
        openShopee.disabled = false;
        return;
      }
      status.textContent = "正在開啟蝦皮設定……";
      const previousUrl = location.href;
      async function clickTarget(target) {
        if (!productNavigationIsCurrent(record, navigationOverlay) || !target || !target.isConnected) return false;
        const mode = shopeeNavigationModeForTarget(record, target);
        // Opening EasyStore's product-specific sync form does not create a
        // listing by itself. Gate explicit create/update actions here, then
        // gate the final submit again after the form exposes its real mode.
        if (mode !== "unknown") {
          const gate = helpers.listingSafetyGate(record.payload, mode);
          if (!gate.ok) {
            status.textContent = `已停止：${gate.reasons.join("；")}`;
            openShopee.disabled = false;
            return false;
          }
          await rememberShopeeNavigationMode(record, mode);
        }
        target.click();
        return true;
      }
      let nextTarget = targets[0];
      for (let step = 0; step < 4 && nextTarget; step += 1) {
        if (!await clickTarget(nextTarget)) return;
        const result = await waitForShopeeNavigation(
          record,
          navigationOverlay,
          previousUrl,
          step === 0 ? 7000 : 9000,
          nextTarget
        );
        if (result.navigated) return;
        nextTarget = result.link;
      }
      openShopee.disabled = false;
      status.textContent = "蝦皮區已展開，但 EasyStore 沒有轉到設定頁；請點商品頁內的「蝦皮購物／連接商品」，進入後助手會自動接續。";
    }
    openShopee.addEventListener("click", openShopeeSettings);
    setTimeout(() => {
      if (overlay && overlay.isConnected && !openShopee.disabled) openShopee.click();
    }, 450);
  }

  function inspectQueue(attempt) {
    const routeKind = helpers.easyStoreRouteKind(location.href);
    const isSyncPage = routeKind === "shopee-sync";
    const isProductPage = routeKind === "product";
    if (!isSyncPage && !isProductPage) {
      return;
    }
    queueStorage.get(helpers.QUEUE_STORAGE_KEY, (stored) => {
      if (chrome.runtime.lastError) {
        return;
      }
      const record = helpers.selectQueueRecord(
        stored[helpers.QUEUE_STORAGE_KEY],
        location.href,
        (() => {
          const observed = isSyncPage ? visibleSellerSkuObservation() : { state: "absent", values: [] };
          return observed.state === "value" ? `賣家 SKU ${observed.values[0]}` : "";
        })(),
        Date.now()
      );
      if (record) {
        if (!currentRecord || currentRecord.payload.nonce !== record.payload.nonce) {
          if (isSyncPage) {
            mountOverlay(record);
          } else {
            mountProductNavigationOverlay(record);
          }
        }
        return;
      }
      if (attempt < 30) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => inspectQueue(attempt + 1), 1000);
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === helpers.QUEUE_STORAGE_AREA && changes[helpers.QUEUE_STORAGE_KEY]) {
      inspectQueue(0);
    }
  });

  inspectQueue(0);
  setInterval(() => {
    const nextUrl = location.href;
    if (nextUrl === observedUrl) {
      return;
    }
    const previousUrl = observedUrl;
    observedUrl = nextUrl;
    currentRecord = null;
    clearTimeout(retryTimer);
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    if (helpers.shouldInspectQueue(previousUrl, nextUrl)) {
      inspectQueue(0);
    }
  }, 750);
})();
