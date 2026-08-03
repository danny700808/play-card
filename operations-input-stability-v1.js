(function (global) {
  'use strict';
  if (global.__YOUZI_INPUT_STABILITY_V2__) return;
  global.__YOUZI_INPUT_STABILITY_V2__ = true;

  const SEARCH_IDS = new Set([
    'productSearch',
    'purchaseLowSearch',
    'purchaseEntrySearch',
    'stocktakeSearch',
    'inventorySearch',
    'posMemberSearch',
    'saleInvoiceSearch',
    'overviewSearch',
    'customerSearch',
    'receivableSearch',
    'platformOrderSearch'
  ]);
  const drafts = new Map();
  let activeId = '';
  let restoreFrame = 0;

  function isTracked(input) {
    return Boolean(input && input.tagName === 'INPUT' && SEARCH_IDS.has(input.id));
  }

  function remember(input) {
    if (!isTracked(input)) return;
    const focused = document.activeElement === input;
    if (focused) activeId = input.id;
    drafts.set(input.id, {
      value: String(input.value == null ? '' : input.value),
      start: typeof input.selectionStart === 'number' ? input.selectionStart : null,
      end: typeof input.selectionEnd === 'number' ? input.selectionEnd : null,
      direction: input.selectionDirection || 'none',
      focused: focused,
      savedAt: Date.now()
    });
  }

  function prepare(input) {
    if (!isTracked(input)) return;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('enterkeyhint', 'search');
    input.spellcheck = false;
    if (!input.getAttribute('inputmode')) input.setAttribute('inputmode', 'search');
  }

  function restore() {
    restoreFrame = 0;
    const id = activeId;
    const draft = id && drafts.get(id);
    const input = id && document.getElementById(id);
    if (!draft || !input || Date.now() - draft.savedAt > 5000) return;
    prepare(input);

    if (input.value !== draft.value) input.value = draft.value;
    if (!draft.focused || document.visibilityState !== 'visible') return;
    try {
      input.focus({ preventScroll: true });
    } catch (_) {
      try { input.focus(); } catch (_) {}
    }
    if (draft.start != null && draft.end != null) {
      try { input.setSelectionRange(draft.start, draft.end, draft.direction); } catch (_) {}
    }
  }

  function scheduleRestore() {
    if (restoreFrame) return;
    restoreFrame = global.requestAnimationFrame(restore);
  }

  document.addEventListener('focusin', function (event) {
    if (isTracked(event.target)) {
      prepare(event.target);
      remember(event.target);
      return;
    }
    if (event.target && event.target !== document.body && event.target !== document.documentElement) activeId = '';
  }, true);

  document.addEventListener('beforeinput', function (event) {
    if (!isTracked(event.target)) return;
    global.setTimeout(function () {
      remember(event.target);
      scheduleRestore();
    }, 0);
  }, true);

  document.addEventListener('input', function (event) {
    if (isTracked(event.target)) remember(event.target);
  }, true);

  document.addEventListener('keyup', function (event) {
    if (isTracked(event.target)) remember(event.target);
  }, true);

  const root = document.getElementById('opsContent') || document.body;
  function prepareCurrentSearchInputs() {
    SEARCH_IDS.forEach(function (id) { prepare(document.getElementById(id)); });
  }

  const observer = new MutationObserver(function () {
    prepareCurrentSearchInputs();
    scheduleRestore();
  });
  observer.observe(root, { childList: true, subtree: true });

  global.addEventListener('pageshow', scheduleRestore);
  prepareCurrentSearchInputs();
})(window);
