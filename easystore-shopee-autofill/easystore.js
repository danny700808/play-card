(function installEasyStoreAutofill() {
  "use strict";

  const helpers = globalThis.YouziShopeeAutofillHelpers;
  if (!helpers || location.origin !== "https://admin.easystore.co") {
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

  const EMPTY_MARKERS = ["", "請選擇", "請先選擇", "select", "choose"];
  const SHOPEE_ENTRY_LABELS = Object.freeze([
    "連接商品到蝦皮購物 Shopee Taiwan",
    "連接商品到蝦皮購物",
    "更新到蝦皮購物",
    "發佈到蝦皮購物",
    "發布到蝦皮購物",
    "同步到蝦皮購物",
    "蝦皮購物"
  ]);
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
  let currentRecord = null;
  let overlay = null;
  let retryTimer = null;
  let observedUrl = location.href;

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

  function findExactTextElements(approvedTexts, root) {
    const scope = root || document;
    const approved = helpers.uniqueStrings(approvedTexts);
    const candidates = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode instanceof Element ? walker.currentNode : walker.nextNode();
    while (node) {
      if (
        node.id !== "youzi-shopee-autofill-overlay" &&
        !node.closest("#youzi-shopee-autofill-overlay") &&
        isVisible(node) &&
        helpers.exactApprovedMatch(node.textContent, approved)
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

  function findExactTextElement(approvedTexts, root) {
    return findExactTextElements(approvedTexts, root)[0] || null;
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
    const label = findExactTextElement(labelAliases);
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

  function controlValue(control) {
    if (!control) {
      return "";
    }
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
      return String(control.value || "").trim();
    }
    return String(control.getAttribute("data-value") || control.textContent || "").trim();
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
      return true;
    }
    control.click();
    const option = await waitForExactText(options, 2600, control);
    if (!option) {
      return false;
    }
    const clickable = option.closest("[role='option'], li, button, [data-value]") || option;
    clickable.click();
    await sleep(180);
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

  async function publishToShopee(payload, report) {
    const gate = helpers.autoPublishGate(payload, report);
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

  async function fillBrand(payload, report) {
    if (!payload.brand) {
      addReport(report, "skipped", "品牌", "待人工確認");
      return;
    }
    const field = findField(FIELD_LABELS.brand);
    if (!field || field.controls.length === 0) {
      addReport(report, "missing", "品牌", "找不到欄位");
      return;
    }
    const control = field.controls[0];
    if (!isEmptyValue(controlValue(control))) {
      addReport(report, "preserved", "品牌", controlValue(control));
      return;
    }
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
      setNativeValue(control, payload.brand);
      const suggestion = await waitForExactText([payload.brand], 700, control);
      if (suggestion && !field.container.contains(suggestion)) {
        (suggestion.closest("[role='option'], li, button") || suggestion).click();
      }
      addReport(report, "filled", "品牌", payload.brand);
      return;
    }
    const selected = await chooseExactOption(control, [payload.brand]);
    addReport(report, selected ? "filled" : "missing", "品牌", selected ? payload.brand : "找不到完全相符選項");
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

  function findCategoryField() {
    const label = findExactTextElement(FIELD_LABELS.category);
    if (!label) {
      return null;
    }
    const labelZone = label.parentElement || label;
    let container = label.parentElement;
    for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
      const editControls = Array.from(container.querySelectorAll("button, [role='button']")).filter(isVisible);
      const outsideLabelZone = editControls.filter((button) => {
        const name = button.getAttribute("aria-label") || button.title || button.textContent || "";
        return !labelZone.contains(button) || /edit|編輯|修改|鉛筆/i.test(name);
      });
      if (outsideLabelZone.length > 0) {
        return { label, container, controls: fieldControls(container), editControls: outsideLabelZone };
      }
    }
    const generic = findField(FIELD_LABELS.category);
    return generic ? Object.assign({ editControls: [] }, generic) : null;
  }

  async function fillCategory(payload, report) {
    const field = findCategoryField();
    if (!field) {
      addReport(report, "missing", "分類", "找不到欄位");
      return;
    }
    const existing = categoryCurrentValue(field);
    if (existing) {
      addReport(report, "preserved", "分類", existing);
      return;
    }
    const buttons = field.editControls;
    const editButton = buttons.find((button) => /edit|編輯|鉛筆/i.test(button.getAttribute("aria-label") || button.title || button.textContent || "")) || buttons[0];
    const clickTarget = editButton || field.controls[0];
    if (!clickTarget) {
      addReport(report, "missing", "分類", "找不到編輯按鈕");
      return;
    }
    clickTarget.click();
    await sleep(250);
    for (const segment of payload.categoryPath) {
      const option = await waitForExactText([segment], 3500, null);
      if (!option) {
        addReport(report, "missing", "分類", `找不到「${segment}」`);
        return;
      }
      (option.closest("[role='option'], li, button, [data-value]") || option).click();
      await sleep(300);
    }
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
    const field = findField(labels);
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
    const shouldType = descriptor.inputMode === "text" || (
      ["auto", "composite"].includes(descriptor.inputMode) &&
      writableInput
    );
    if (shouldType) {
      setNativeValue(primary, descriptor.value);
    } else {
      const selected = await chooseExactOption(primary, descriptor.approvedOptions);
      if (!selected) {
        addReport(report, "missing", displayLabel, "找不到完全相符或核准同義詞");
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
        const selectedUnit = await chooseExactOption(unitControl, descriptor.unitOptions);
        if (!selectedUnit) {
          addReport(report, "missing", `${displayLabel}單位`, "找不到完全相符單位");
        }
      }
    }
    addReport(report, "filled", displayLabel, `${descriptor.value}${descriptor.unit ? ` ${descriptor.unit}` : ""}`);
  }

  function findLogisticsRow(labelAliases) {
    const label = findExactTextElement(labelAliases);
    if (!label) {
      return null;
    }
    let container = label.parentElement;
    for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
      const toggle = container.querySelector("[role='switch'], button[aria-checked]") ||
        Array.from(container.querySelectorAll("input[type='checkbox']")).find((control) =>
          !control.closest("label")?.textContent?.includes("我將承擔運費")
        );
      if (toggle && isVisible(toggle)) {
        return { label, container, toggle };
      }
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
    return toggle.classList.contains("active") || toggle.classList.contains("checked") || toggle.dataset.state === "checked";
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
      const row = findLogisticsRow(labels);
      if (!row) {
        addReport(report, "missing", displayLabel, "找不到物流選項");
        continue;
      }
      const wasEnabled = toggleState(row.toggle);
      let toggledByExtension = false;
      if (!method.enabled) {
        addReport(
          report,
          wasEnabled ? "preserved" : "skipped",
          displayLabel,
          wasEnabled ? "保留人工開啟狀態" : "維持關閉"
        );
        continue;
      }
      if (!wasEnabled) {
        row.toggle.click();
        toggledByExtension = true;
        await sleep(300);
      } else {
        addReport(report, "preserved", displayLabel, "原本已開啟");
      }

      if (method.option) {
        const activeRow = wasEnabled ? row : (findLogisticsRow(labels) || row);
        const controls = fieldControls(activeRow.container).filter((control) => control !== activeRow.toggle);
        const bandControl = controls.find((control) => {
          const value = controlValue(control);
          return isEmptyValue(value) || /S\s*\d+|\d+\s*[-–~至～]\s*\d+\s*cm|≤\s*\d+\s*cm/i.test(value);
        });
        if (!bandControl) {
          if (toggledByExtension) {
            activeRow.toggle.click();
          }
          addReport(report, "missing", `${displayLabel}尺寸`, "找不到尺寸級距");
          continue;
        }
        const currentBand = controlValue(bandControl);
        if (wasEnabled && !isEmptyValue(currentBand)) {
          addReport(report, "preserved", `${displayLabel}尺寸`, currentBand);
          continue;
        }
        const approvedOptions = helpers.logisticsOptionAliases(method.option);
        const selected = await chooseExactOption(bandControl, approvedOptions);
        if (!selected) {
          if (toggledByExtension) activeRow.toggle.click();
          addReport(report, "missing", `${displayLabel}尺寸`, "找不到完全相符級距");
          continue;
        }
        addReport(report, "filled", `${displayLabel}尺寸`, method.option);
        if (toggledByExtension) addReport(report, "filled", displayLabel, "已開啟");
      } else if (toggledByExtension) {
        addReport(report, "filled", displayLabel, "已開啟");
      }

      const updatedRow = findLogisticsRow(labels) || row;
      const sellerPaysLabel = findExactTextElement(["我將承擔運費"], updatedRow.container);
      const sellerPaysControl = sellerPaysLabel && (
        sellerPaysLabel.closest("label")?.querySelector("input[type='checkbox']") ||
        sellerPaysLabel.parentElement?.querySelector("input[type='checkbox'], [role='checkbox']")
      );
      if (method.sellerPays && sellerPaysControl && !toggleState(sellerPaysControl)) {
        sellerPaysControl.click();
        addReport(report, "filled", `${displayLabel}運費`, "賣家承擔");
      } else if (sellerPaysControl && toggleState(sellerPaysControl)) {
        addReport(report, "preserved", `${displayLabel}運費`, "賣家承擔");
      } else if (method.sellerPays) {
        addReport(report, "missing", `${displayLabel}運費`, "找不到賣家承擔運費欄位");
      }
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
    const label = findExactTextElement(FIELD_LABELS.preorder);
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
          } else {
            addReport(report, "preserved", "預購", `保留人工值「${checkedText || "已選擇"}」`);
          }
          return;
        }
        const desiredText = findExactTextElement(approvedOptions, container);
        const desiredRadio = desiredText?.closest("label")?.querySelector("input[type='radio']") || desiredText?.closest("[role='radio']");
        if (desiredRadio) {
          desiredRadio.click();
          addReport(report, "filled", "預購", payload.preorder.enabled ? "是" : "否");
        } else {
          addReport(report, "missing", "預購", "找不到完全相符選項");
        }
        return;
      }
    }
    addReport(report, "missing", "預購", "找不到選項");
  }

  function createReport() {
    return { filled: [], preserved: [], skipped: [], missing: [] };
  }

  function verifyIdentity(payload) {
    const ids = helpers.extractProductIds(location.href);
    if (!ids.includes(payload.easyStoreProductId)) {
      return { ok: false, message: "網址中的 EasyStore 商品 ID 與排隊資料不符。" };
    }
    if (!helpers.textContainsExactToken(document.body.innerText, payload.sku)) {
      return { ok: false, message: "頁面上的賣家 SKU 與排隊資料不符。" };
    }
    return { ok: true, message: "" };
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
    await fillBrand(payload, report);
    for (const row of payload.attributes || []) {
      await fillAttribute(row, report);
    }
    await fillLogistics(payload, report);
    await fillPreorder(payload, report);
    return report;
  }

  function consumeQueueRecord(payload) {
    return new Promise((resolve, reject) => {
      chrome.storage.session.get(helpers.QUEUE_STORAGE_KEY, (stored) => {
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
          chrome.storage.session.remove(helpers.QUEUE_STORAGE_KEY, done);
        } else {
          chrome.storage.session.set({ [helpers.QUEUE_STORAGE_KEY]: next }, done);
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

  function shopeeNavigationTargets(record) {
    const directLink = shopeeSyncLinkForProduct(record.payload.easyStoreProductId);
    const targets = directLink ? [directLink] : [];
    for (const label of findExactTextElements(SHOPEE_ENTRY_LABELS)) {
      const target = label.closest("a, button, [role='button'], [tabindex]") || label;
      if (!targets.includes(target)) {
        targets.push(target);
      }
    }
    return targets.sort((left, right) => {
      const score = (element) => {
        const href = element instanceof HTMLAnchorElement ? element.href : "";
        const text = String(element.textContent || "");
        if (href && helpers.easyStoreRouteKind(href) === "shopee-sync") return 100;
        if (/連接|更新|發佈|發布|同步/.test(text)) return 60;
        if (element instanceof HTMLAnchorElement) return 40;
        if (element.matches("button, [role='button']")) return 20;
        return 0;
      };
      return score(right) - score(left);
    });
  }

  async function waitForShopeeNavigation(record, previousUrl, timeout, ignoredLink) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (location.href !== previousUrl && helpers.easyStoreRouteKind(location.href) === "shopee-sync") {
        return { navigated: true, link: null };
      }
      const link = shopeeSyncLinkForProduct(record.payload.easyStoreProductId);
      if (link && link !== ignoredLink) {
        return { navigated: false, link };
      }
      await sleep(120);
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
      ["已填", report.filled],
      ["保留", report.preserved],
      ["略過", report.skipped],
      ["待補", report.missing]
    ].forEach(([bucketLabel, items]) => {
      items.forEach((item) => appendTextElement(list, "li", "", `${bucketLabel}｜${item}`));
    });
    container.appendChild(list);
    appendTextElement(container, "div", "youzi-autofill__notice", report.missing.length > 0
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
        const gate = helpers.autoPublishGate(currentRecord.payload, report);
        if (!gate.ok) {
          status.textContent = `已停止上架：${gate.reasons.join("；")}`;
          start.disabled = false;
          start.textContent = "補齊後重新檢查並上架";
          return;
        }
        status.textContent = "欄位已完成，正在送到蝦皮……";
        await publishToShopee(currentRecord.payload, report);
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
      const targets = shopeeNavigationTargets(record);
      if (targets.length === 0) {
        status.textContent = "找不到蝦皮入口；請在商品頁展開「銷售管道」，再點「蝦皮購物」。";
        return;
      }
      openShopee.disabled = true;
      status.textContent = "正在開啟蝦皮設定……";
      const previousUrl = location.href;
      const firstTarget = targets[0];
      firstTarget.click();
      let result = await waitForShopeeNavigation(record, previousUrl, 2200, firstTarget);
      if (result.navigated) {
        return;
      }
      if (result.link && result.link !== firstTarget) {
        result.link.click();
        result = await waitForShopeeNavigation(record, previousUrl, 2200, result.link);
        if (result.navigated) {
          return;
        }
      }
      const nextTarget = shopeeNavigationTargets(record).find((target) => target !== firstTarget && target !== result.link);
      if (nextTarget) {
        nextTarget.click();
        result = await waitForShopeeNavigation(record, previousUrl, 2200, nextTarget);
        if (result.navigated) {
          return;
        }
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
    chrome.storage.session.get(helpers.QUEUE_STORAGE_KEY, (stored) => {
      if (chrome.runtime.lastError) {
        return;
      }
      const record = helpers.selectQueueRecord(
        stored[helpers.QUEUE_STORAGE_KEY],
        location.href,
        document.body ? document.body.innerText : "",
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
    if (areaName === "session" && changes[helpers.QUEUE_STORAGE_KEY]) {
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
