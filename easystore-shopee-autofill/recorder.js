(function installEasyStoreLiveRecorder(global) {
  "use strict";

  const FORMAT = "youzi-easystore-live-check-v1";
  const STORAGE_KEY = "youziEasyStoreLiveCheckV1";
  const ROOT_ID = "youzi-easystore-live-recorder";
  const MAX_SNAPSHOTS = 60;
  const MAX_ELEMENTS = 220;
  const MAX_SESSION_AGE_MS = 2 * 60 * 60 * 1000;
  const ALLOWED_QUERY_KEYS = Object.freeze([
    "store_product_id",
    "store_product_ids",
    "account_id",
    "product_id",
    "product_ids",
    "request_id"
  ]);

  function normalizeDiagnosticText(value, maximumLength) {
    const limit = Number.isFinite(maximumLength) && maximumLength > 0
      ? Math.floor(maximumLength)
      : 180;
    const normalized = String(value == null ? "" : value)
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
    return normalized.length > limit
      ? `${normalized.slice(0, Math.max(0, limit - 1))}…`
      : normalized;
  }

  function sanitizeUrlForExport(value) {
    try {
      const source = new URL(String(value || ""));
      const safe = new URL(`${source.origin}${source.pathname}`);
      for (const key of ALLOWED_QUERY_KEYS) {
        for (const rawValue of source.searchParams.getAll(key)) {
          const cleaned = normalizeDiagnosticText(rawValue, 80);
          if (/^[\p{L}\p{N}_.:,\-]+$/u.test(cleaned)) {
            safe.searchParams.append(key, cleaned);
          }
        }
      }
      return safe.toString();
    } catch (_error) {
      return "";
    }
  }

  function safeAttributeValue(value, maximumLength) {
    return normalizeDiagnosticText(value, maximumLength || 160);
  }

  const testingApi = Object.freeze({
    FORMAT,
    STORAGE_KEY,
    normalizeDiagnosticText,
    sanitizeUrlForExport,
    safeAttributeValue
  });

  if (typeof module === "object" && module && module.exports) {
    module.exports = testingApi;
    return;
  }

  if (
    !global ||
    !global.document ||
    !global.chrome ||
    !global.chrome.storage ||
    !global.chrome.storage.local ||
    global.location.origin !== "https://admin.easystore.co"
  ) {
    return;
  }

  const storage = global.chrome.storage.local;
  let recorderRoot = null;
  let primaryButton = null;
  let cancelButton = null;
  let statusElement = null;
  let session = null;
  let mutationObserver = null;
  let scheduledSnapshot = null;
  let scheduledReason = "";
  let scheduledTarget = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function isRecorderElement(element) {
    return Boolean(element instanceof Element && element.closest(`#${ROOT_ID}`));
  }

  function isVisible(element) {
    if (!(element instanceof Element) || isRecorderElement(element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) !== 0 &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function roundedRect(element) {
    const rect = element.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  function safeHref(element) {
    if (!(element instanceof HTMLAnchorElement) || !element.href) return "";
    return sanitizeUrlForExport(element.href);
  }

  function elementPath(element) {
    const parts = [];
    let current = element;
    for (let depth = 0; current instanceof Element && depth < 8; depth += 1) {
      const tag = current.tagName.toLowerCase();
      const id = safeAttributeValue(current.id, 70);
      const role = safeAttributeValue(current.getAttribute("role"), 40);
      const classes = Array.from(current.classList || [])
        .slice(0, 4)
        .map((value) => safeAttributeValue(value, 50))
        .filter(Boolean);
      const parent = current.parentElement;
      const siblingIndex = parent
        ? Array.prototype.indexOf.call(parent.children, current) + 1
        : 1;
      parts.unshift(`${tag}${id ? `#${id}` : ""}${classes.map((value) => `.${value}`).join("")}${role ? `[role=${role}]` : ""}:nth-child(${siblingIndex})`);
      current = parent;
    }
    return parts.join(" > ");
  }

  function safeTextForElement(element) {
    if (!(element instanceof Element)) return "";
    if (element.matches("input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']")) {
      return "";
    }
    if (element instanceof HTMLSelectElement) {
      const selected = element.selectedOptions && element.selectedOptions[0];
      return normalizeDiagnosticText(selected ? selected.textContent : "", 160);
    }
    return normalizeDiagnosticText(element.innerText || element.textContent || "", 160);
  }

  function describeElement(element) {
    const attributes = {};
    for (const name of [
      "id",
      "class",
      "role",
      "name",
      "type",
      "title",
      "aria-label",
      "aria-haspopup",
      "aria-expanded",
      "aria-controls",
      "aria-selected",
      "aria-checked",
      "aria-disabled",
      "data-testid",
      "data-test",
      "data-qa"
    ]) {
      const value = safeAttributeValue(element.getAttribute(name), name === "class" ? 220 : 160);
      if (value) attributes[name] = value;
    }
    const href = safeHref(element);
    if (href) attributes.href = href;
    const description = {
      path: elementPath(element),
      tag: element.tagName.toLowerCase(),
      text: safeTextForElement(element),
      attributes,
      rect: roundedRect(element),
      childElementCount: element.childElementCount
    };
    if (
      element.scrollHeight > element.clientHeight + 1 ||
      element.scrollWidth > element.clientWidth + 1
    ) {
      description.scroll = {
        top: Math.round(element.scrollTop),
        left: Math.round(element.scrollLeft),
        clientWidth: Math.round(element.clientWidth),
        clientHeight: Math.round(element.clientHeight),
        scrollWidth: Math.round(element.scrollWidth),
        scrollHeight: Math.round(element.scrollHeight),
        overflowX: safeAttributeValue(getComputedStyle(element).overflowX, 30),
        overflowY: safeAttributeValue(getComputedStyle(element).overflowY, 30)
      };
    }
    if (element instanceof HTMLInputElement) {
      description.checked = ["checkbox", "radio"].includes(element.type)
        ? Boolean(element.checked)
        : undefined;
    }
    return description;
  }

  function candidateElements() {
    const semanticSelector = [
      "button",
      "a[href]",
      "label",
      "select",
      "option:checked",
      "input[type='checkbox']",
      "input[type='radio']",
      "[role]",
      "[aria-label]",
      "[aria-haspopup]",
      "[aria-expanded]",
      "[data-testid]",
      "[data-test]",
      "[data-qa]"
    ].join(",");
    const candidates = Array.from(document.querySelectorAll(semanticSelector));
    for (const node of document.querySelectorAll("div, span, li, p, h1, h2, h3, h4")) {
      if (candidates.length >= MAX_ELEMENTS * 3) break;
      if (!isVisible(node) || node.childElementCount > 2) continue;
      const text = safeTextForElement(node);
      const rect = node.getBoundingClientRect();
      if (text && text.length <= 160 && rect.height <= 96 && rect.width <= 900) {
        candidates.push(node);
      }
    }
    const unique = [];
    const seen = new Set();
    for (const element of candidates) {
      if (!isVisible(element)) continue;
      const path = elementPath(element);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      unique.push(element);
      if (unique.length >= MAX_ELEMENTS) break;
    }
    return unique;
  }

  function targetContext(target) {
    const context = [];
    let current = target instanceof Element ? target : null;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      if (!isRecorderElement(current)) context.push(describeElement(current));
    }
    return context;
  }

  function snapshotSignature(snapshot) {
    return JSON.stringify([
      snapshot.url,
      snapshot.elements.map((row) => [
        row.path,
        row.text,
        row.attributes.role || "",
        row.attributes["aria-expanded"] || "",
        row.attributes["aria-selected"] || "",
        row.checked,
        row.scroll ? row.scroll.top : "",
        row.scroll ? row.scroll.left : ""
      ])
    ]);
  }

  function persistSession() {
    if (!session) return;
    storage.set({ [STORAGE_KEY]: session });
  }

  function addSnapshot(reason, target) {
    if (!session || session.recording !== true) return;
    const snapshot = {
      capturedAt: nowIso(),
      reason,
      url: sanitizeUrlForExport(location.href),
      viewport: {
        width: Math.round(global.innerWidth || 0),
        height: Math.round(global.innerHeight || 0),
        devicePixelRatio: Number(global.devicePixelRatio || 1)
      },
      targetContext: targetContext(target),
      elements: candidateElements().map(describeElement)
    };
    snapshot.signature = snapshotSignature(snapshot);
    const previous = session.snapshots[session.snapshots.length - 1];
    if (previous && previous.signature === snapshot.signature && !reason.startsWith("click")) {
      return;
    }
    if (session.snapshots.length >= MAX_SNAPSHOTS) {
      const removable = session.snapshots.findIndex((row) => !String(row.reason).startsWith("click"));
      if (reason.startsWith("click") && removable >= 0) {
        session.snapshots.splice(removable, 1);
      } else {
        session.truncated = true;
        persistSession();
        return;
      }
      session.truncated = true;
    }
    session.snapshots.push(snapshot);
    persistSession();
    updateStatus();
  }

  function scheduleSnapshot(reason, target, delay) {
    if (!session || session.recording !== true) return;
    scheduledReason = reason;
    scheduledTarget = target instanceof Element ? target : null;
    clearTimeout(scheduledSnapshot);
    scheduledSnapshot = setTimeout(() => {
      scheduledSnapshot = null;
      addSnapshot(scheduledReason, scheduledTarget);
      scheduledTarget = null;
    }, delay || 260);
  }

  function onDocumentClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || isRecorderElement(target) || !session || session.recording !== true) return;
    addSnapshot("click-before", target);
    setTimeout(() => addSnapshot("click-after", target.isConnected ? target : null), 240);
    setTimeout(() => addSnapshot("click-settled", target.isConnected ? target : null), 800);
  }

  function onDocumentScroll(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || isRecorderElement(target)) return;
    scheduleSnapshot("scroll", target, 240);
  }

  function onDocumentChange(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || isRecorderElement(target)) return;
    scheduleSnapshot("selection-changed", target, 180);
  }

  function startObservers() {
    if (mutationObserver) return;
    document.addEventListener("click", onDocumentClick, true);
    document.addEventListener("scroll", onDocumentScroll, true);
    document.addEventListener("change", onDocumentChange, true);
    mutationObserver = new MutationObserver(() => scheduleSnapshot("page-changed", null, 320));
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "role",
        "aria-expanded",
        "aria-selected",
        "aria-checked",
        "aria-disabled"
      ]
    });
  }

  function stopObservers() {
    document.removeEventListener("click", onDocumentClick, true);
    document.removeEventListener("scroll", onDocumentScroll, true);
    document.removeEventListener("change", onDocumentChange, true);
    if (mutationObserver) mutationObserver.disconnect();
    mutationObserver = null;
    clearTimeout(scheduledSnapshot);
    scheduledSnapshot = null;
  }

  function updateStatus(message) {
    if (!recorderRoot || !primaryButton || !statusElement || !cancelButton) return;
    const active = Boolean(session && session.recording === true);
    recorderRoot.dataset.recording = active ? "true" : "false";
    primaryButton.textContent = active ? "完成並下載檢查檔" : "開始實機記錄";
    cancelButton.hidden = !active;
    if (message) {
      statusElement.textContent = message;
    } else if (active) {
      statusElement.textContent = `記錄中（${session.snapshots.length} 個畫面）：請照平常方式開啟選單與欄位，不要按最後上架。`;
    } else {
      statusElement.textContent = "不需要先從營運中心排隊；按下後照平常方式操作一次即可。";
    }
  }

  function startRecording() {
    session = {
      format: FORMAT,
      recording: true,
      startedAt: nowIso(),
      extensionVersion: chrome.runtime.getManifest().version,
      snapshots: [],
      truncated: false,
      privacy: "No cookies, passwords, authentication tokens, typed text, or text-input values are collected."
    };
    persistSession();
    startObservers();
    addSnapshot("recording-started", null);
    updateStatus();
  }

  function downloadSession(completedSession) {
    const exportValue = Object.assign({}, completedSession, {
      recording: false,
      endedAt: nowIso()
    });
    for (const snapshot of exportValue.snapshots) delete snapshot.signature;
    const blob = new Blob([JSON.stringify(exportValue, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `youzi-easystore-live-check-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.hidden = true;
    recorderRoot.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function finishRecording() {
    if (!session || session.recording !== true) return;
    addSnapshot("recording-finished", null);
    const completed = session;
    stopObservers();
    session = null;
    storage.remove(STORAGE_KEY);
    downloadSession(completed);
    updateStatus("檢查檔已下載。請把剛下載的 JSON 檔傳給我，我會依實際頁面結構修正助手。");
  }

  function cancelRecording() {
    stopObservers();
    session = null;
    storage.remove(STORAGE_KEY);
    updateStatus("本次記錄已取消，沒有下載檔案。需要時可重新開始。");
  }

  function mountRecorder() {
    if (document.getElementById(ROOT_ID)) return;
    recorderRoot = document.createElement("section");
    recorderRoot.id = ROOT_ID;
    recorderRoot.setAttribute("aria-label", "EasyStore 實機檢查");

    const title = document.createElement("strong");
    title.className = "youzi-recorder__title";
    title.textContent = "EasyStore 實機檢查";
    recorderRoot.appendChild(title);

    const privacy = document.createElement("div");
    privacy.className = "youzi-recorder__privacy";
    privacy.textContent = "只記錄按鈕、選項與畫面結構；不記錄帳密、Cookie 或文字輸入內容。";
    recorderRoot.appendChild(privacy);

    statusElement = document.createElement("div");
    statusElement.className = "youzi-recorder__status";
    recorderRoot.appendChild(statusElement);

    const actions = document.createElement("div");
    actions.className = "youzi-recorder__actions";
    primaryButton = document.createElement("button");
    primaryButton.type = "button";
    primaryButton.className = "youzi-recorder__primary";
    primaryButton.addEventListener("click", () => {
      if (session && session.recording === true) finishRecording();
      else startRecording();
    });
    actions.appendChild(primaryButton);

    cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "youzi-recorder__cancel";
    cancelButton.textContent = "取消";
    cancelButton.addEventListener("click", cancelRecording);
    actions.appendChild(cancelButton);
    recorderRoot.appendChild(actions);
    document.documentElement.appendChild(recorderRoot);
    updateStatus();
  }

  function restoreSession() {
    storage.get(STORAGE_KEY, (stored) => {
      const candidate = stored && stored[STORAGE_KEY];
      const startedAt = candidate && Date.parse(candidate.startedAt);
      if (
        candidate &&
        candidate.format === FORMAT &&
        candidate.recording === true &&
        Number.isFinite(startedAt) &&
        Date.now() - startedAt <= MAX_SESSION_AGE_MS &&
        Array.isArray(candidate.snapshots)
      ) {
        session = candidate;
        startObservers();
        addSnapshot("page-loaded", null);
      } else if (candidate) {
        storage.remove(STORAGE_KEY);
      }
      updateStatus();
    });
  }

  mountRecorder();
  restoreSession();
})(typeof globalThis !== "undefined" ? globalThis : this);
