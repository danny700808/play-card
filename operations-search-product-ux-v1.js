(function (global) {
  'use strict';

  if (global.__YOUZI_SEARCH_PRODUCT_UX_V1__) return;
  global.__YOUZI_SEARCH_PRODUCT_UX_V1__ = true;

  var SEARCH_STATE_KEYS = {
    productSearch: 'productSearch',
    purchaseLowSearch: 'purchaseLowSearch',
    purchaseEntrySearch: 'purchaseEntrySearch',
    stocktakeSearch: 'stocktakeSearch',
    inventorySearch: 'inventorySearch'
  };
  var SEARCH_IDS = Object.keys(SEARCH_STATE_KEYS);
  var timers = new Map();
  var drafts = new Map();
  var composing = new Set();
  var syntheticCommitId = '';
  var activeId = '';
  var enhanceTimer = 0;
  var restoreFrame = 0;

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function comparable(value) {
    return clean(value).toLowerCase().replace(/[\s\-_/\\.,，。・:：;；()（）\[\]【】「」『』'"`]/g, '');
  }

  function escapeHtml(value) {
    return clean(value).replace(/[&<>"']/g, function (character) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[character];
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function isStableSearch(input) {
    return Boolean(input && input.tagName === 'INPUT' && SEARCH_STATE_KEYS[input.id]);
  }

  function stateObject() {
    return global.OperationsCenterV1 && global.OperationsCenterV1.state || null;
  }

  function isMobile() {
    return Number(global.innerWidth || 0) <= 780;
  }

  function delayForInput() {
    return isMobile() ? 850 : 700;
  }

  function remember(input) {
    if (!isStableSearch(input)) return;
    var focused = document.activeElement === input;
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

  function prepareInput(input) {
    if (!isStableSearch(input)) return;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('enterkeyhint', 'search');
    input.spellcheck = false;
    input.dataset.youziStableSearch = '1';
  }

  function setPending(input, pending) {
    if (!input) return;
    input.dataset.searchPending = pending ? '1' : '0';
    var button = document.querySelector('[data-youzi-search-for="' + input.id + '"]');
    if (button) {
      button.classList.toggle('is-pending', Boolean(pending));
      button.textContent = pending ? '等待輸入…' : '搜尋';
    }
  }

  function cancelTimer(id) {
    var timer = timers.get(id);
    if (timer) global.clearTimeout(timer);
    timers.delete(id);
  }

  function applySearchState(input) {
    var state = stateObject();
    var key = SEARCH_STATE_KEYS[input && input.id];
    if (!state || !key) return false;
    state[key] = String(input.value == null ? '' : input.value);
    if (input.id === 'productSearch') {
      state.productSeries = 'all';
      state.productFilter = 'all';
      state.productVisible = 24;
    } else if (input.id === 'purchaseEntrySearch') {
      state.purchaseEntrySeries = 'all';
    } else if (input.id === 'stocktakeSearch') {
      state.stocktakeSeries = 'all';
    }
    return true;
  }

  function dispatchImmediateSearch(input) {
    if (!isStableSearch(input) || !document.contains(input)) return;
    cancelTimer(input.id);
    if (!applySearchState(input)) return;
    setPending(input, false);
    remember(input);
    syntheticCommitId = input.id;
    try {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true
      }));
    } finally {
      syntheticCommitId = '';
    }
  }

  function scheduleSearch(input) {
    if (!isStableSearch(input)) return;
    cancelTimer(input.id);
    setPending(input, true);
    var expected = String(input.value == null ? '' : input.value);
    timers.set(input.id, global.setTimeout(function () {
      timers.delete(input.id);
      var current = document.getElementById(input.id);
      if (!current || current.value !== expected) return;
      dispatchImmediateSearch(current);
    }, delayForInput()));
  }

  function restoreFocus() {
    restoreFrame = 0;
    if (!activeId) return;
    var draft = drafts.get(activeId);
    var input = document.getElementById(activeId);
    if (!draft || !input || Date.now() - draft.savedAt > 8000) return;
    prepareInput(input);
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
    restoreFrame = global.requestAnimationFrame(restoreFocus);
  }

  function focusInput(input) {
    try {
      input.focus({ preventScroll: true });
    } catch (_) {
      try { input.focus(); } catch (_) {}
    }
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
  }

  document.addEventListener('compositionstart', function (event) {
    if (!isStableSearch(event.target)) return;
    composing.add(event.target.id);
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('compositionend', function (event) {
    if (!isStableSearch(event.target)) return;
    composing.delete(event.target.id);
    remember(event.target);
    scheduleSearch(event.target);
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('input', function (event) {
    var input = event.target;
    if (!isStableSearch(input)) return;
    prepareInput(input);
    remember(input);
    if (!event.isComposing && !composing.has(input.id)) scheduleSearch(input);
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('keydown', function (event) {
    var input = event.target;
    if (!isStableSearch(input)) return;
    if (syntheticCommitId === input.id) return;
    if (event.key !== 'Enter') return;
    if (event.isComposing || composing.has(input.id)) return;
    cancelTimer(input.id);
    applySearchState(input);
    setPending(input, false);
    remember(input);
    // 不攔截 Enter，讓營運中心原本的立即搜尋與焦點恢復流程繼續執行。
  }, true);

  document.addEventListener('focusin', function (event) {
    if (isStableSearch(event.target)) {
      prepareInput(event.target);
      remember(event.target);
      return;
    }
    if (event.target && event.target !== document.body && event.target !== document.documentElement) activeId = '';
  }, true);

  document.addEventListener('click', function (event) {
    var searchButton = event.target && event.target.closest && event.target.closest('[data-youzi-search-for]');
    if (searchButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      var searchInput = document.getElementById(clean(searchButton.dataset.youziSearchFor));
      if (searchInput) dispatchImmediateSearch(searchInput);
      return;
    }

    var mobileKey = event.target && event.target.closest && event.target.closest('.ops-mobile-search-pad [data-action="mobile-key"]');
    if (!mobileKey) return;
    var targetId = clean(mobileKey.dataset.target);
    var input = document.getElementById(targetId);
    if (!isStableSearch(input)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var key = clean(mobileKey.dataset.key);
    var current = String(input.value == null ? '' : input.value);
    if (key === 'clear') input.value = '';
    else if (key === 'back') input.value = current.slice(0, -1);
    else input.value = current + key;
    focusInput(input);
    remember(input);
    scheduleSearch(input);
  }, true);

  function addSearchButton(input) {
    if (!isStableSearch(input)) return;
    prepareInput(input);
    var parent = input.parentElement;
    if (!parent || parent.querySelector('[data-youzi-search-for="' + input.id + '"]')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'ops-button soft ops-stable-search-button';
    button.dataset.youziSearchFor = input.id;
    button.textContent = '搜尋';
    input.insertAdjacentElement('afterend', button);
  }

  function addMobileSearchButton(pad) {
    if (!pad || pad.querySelector('[data-youzi-mobile-search]')) return;
    var first = pad.querySelector('[data-target]');
    var targetId = clean(first && first.dataset.target);
    if (!SEARCH_STATE_KEYS[targetId]) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'ops-mobile-search-submit';
    button.dataset.youziMobileSearch = '1';
    button.dataset.youziSearchFor = targetId;
    button.textContent = '搜尋';
    pad.appendChild(button);
  }

  function uniqueUrls(values) {
    var output = [];
    (values || []).forEach(function (value) {
      var url = clean(value);
      if (url && !output.includes(url)) output.push(url);
    });
    return output;
  }

  function productById(id) {
    var state = stateObject();
    if (!state) return null;
    return (state.catalog || []).find(function (product) { return clean(product.docId) === clean(id); }) || null;
  }

  function productIdentity(product) {
    var internal = product && product.internal || {};
    var centralName = clean(product && (product.originalName || product.name) || internal.internalName || internal.originalName || product && product.onlineName) || '未命名商品';
    var onlineName = clean(product && product.onlineName || internal.onlineName);
    var variant = clean(product && product.variantName || internal.variantName);
    if (onlineName && comparable(onlineName) === comparable(centralName)) onlineName = '';
    return { centralName: centralName, onlineName: onlineName, variant: variant };
  }

  function productImages(product) {
    var internal = product && product.internal || {};
    var variant = uniqueUrls((product && product.variantImageUrls || []).concat(internal.variantImageUrls || []));
    var parent = uniqueUrls((product && product.parentImageUrls || []).concat(internal.parentImageUrls || []));
    var all = uniqueUrls((product && product.imageUrls || []).concat(internal.imageUrls || [], product && product.imageUrl ? [product.imageUrl] : [], internal.imageUrl ? [internal.imageUrl] : []));
    return {
      variant: variant,
      parent: parent,
      all: all
    };
  }

  function imageHtml(url, alt) {
    return '<img loading="lazy" src="' + escapeAttr(url) + '" alt="' + escapeAttr(alt) + '" onerror="this.style.display=\'none\'">';
  }

  function placeholderHtml(identity, compact) {
    var heading = identity.variant || '尚無規格圖片';
    return '<div class="ops-spec-image-placeholder' + (compact ? ' compact' : '') + '"><strong>' + escapeHtml(heading) + '</strong><small>' + escapeHtml(identity.centralName) + '</small></div>';
  }

  function preferredSlots(product, compact) {
    var identity = productIdentity(product);
    var images = productImages(product);
    var slots = [];
    if (images.variant.length) {
      slots.push({ type: 'image', value: images.variant[0], alt: identity.variant || identity.centralName });
      if (!compact) {
        var second = images.variant[1] || images.parent[0] || images.all.find(function (url) { return url !== images.variant[0]; });
        if (second) slots.push({ type: 'image', value: second, alt: identity.centralName });
      }
    } else if (identity.variant) {
      slots.push({ type: 'placeholder', identity: identity });
      if (!compact) {
        var parent = images.parent[0] || images.all[0];
        if (parent) slots.push({ type: 'image', value: parent, alt: identity.centralName });
      }
    } else {
      var main = images.all[0] || images.parent[0];
      if (main) slots.push({ type: 'image', value: main, alt: identity.centralName });
      else slots.push({ type: 'placeholder', identity: identity });
      if (!compact) {
        var other = images.all.find(function (url) { return url !== main; });
        if (other) slots.push({ type: 'image', value: other, alt: identity.centralName });
      }
    }
    return { identity: identity, slots: slots };
  }

  function renderSlots(target, product, compact) {
    if (!target) return;
    var preferred = preferredSlots(product, compact);
    var signature = JSON.stringify({
      variant: preferred.identity.variant,
      central: preferred.identity.centralName,
      slots: preferred.slots.map(function (slot) { return slot.type + ':' + (slot.value || slot.identity && slot.identity.variant || ''); })
    });
    if (target.dataset.variantMediaSignature === signature) return;
    target.dataset.variantMediaSignature = signature;
    target.innerHTML = preferred.slots.map(function (slot) {
      return slot.type === 'image' ? imageHtml(slot.value, slot.alt) : placeholderHtml(slot.identity, compact);
    }).join('');
    target.classList.toggle('single', preferred.slots.length < 2);
  }

  function enhanceMainProductCard(card) {
    var product = productById(card.dataset.id);
    if (!product) return;
    var identity = productIdentity(product);
    renderSlots(card.querySelector('.ops-product-image-grid'), product, isMobile());

    var name = card.querySelector('.ops-product-name-rows');
    if (name) name.innerHTML = '<b class="ops-central-product-name">' + escapeHtml(identity.centralName) + '</b>';

    var body = card.querySelector('.ops-product-body');
    if (!body) return;
    var secondary = body.querySelector('.ops-product-variant-row');
    if (!secondary && (identity.variant || identity.onlineName)) {
      secondary = document.createElement('div');
      secondary.className = 'ops-product-variant-row';
      var detailGrid = body.querySelector('.ops-product-detail-grid');
      if (detailGrid) body.insertBefore(secondary, detailGrid);
      else body.appendChild(secondary);
    }
    if (secondary) {
      var html = '';
      if (identity.variant) html += '<span class="ops-product-spec-label">規格：' + escapeHtml(identity.variant) + '</span>';
      if (identity.onlineName) html += '<small class="ops-network-product-name">網路名稱：' + escapeHtml(identity.onlineName) + '</small>';
      secondary.innerHTML = html;
      secondary.hidden = !html;
    }
  }

  function enhanceTextProductRow(row) {
    var product = productById(row.dataset.id);
    if (!product) return;
    var identity = productIdentity(product);
    var name = row.querySelector('.ops-product-text-name');
    if (!name) return;
    var signature = identity.centralName + '|' + identity.variant + '|' + identity.onlineName;
    if (name.dataset.nameHierarchySignature === signature) return;
    name.dataset.nameHierarchySignature = signature;
    name.innerHTML = '<b>' + escapeHtml(identity.centralName) + '</b>' +
      (identity.variant ? '<small>規格：' + escapeHtml(identity.variant) + '</small>' : '') +
      (identity.onlineName ? '<em>網路名稱：' + escapeHtml(identity.onlineName) + '</em>' : '');
  }

  function enhancePurchaseProduct(card) {
    var product = productById(card.dataset.id);
    if (!product) return;
    var identity = productIdentity(product);
    renderSlots(card.querySelector('.ops-purchase-entry-thumb'), product, true);
    var body = card.querySelector('.ops-purchase-entry-product-body');
    if (!body) return;
    var children = Array.prototype.slice.call(body.children || []);
    var title = children.find(function (element) { return element.tagName === 'B'; });
    if (title) {
      title.classList.add('ops-central-product-name');
      title.textContent = identity.centralName;
    }
    var secondary = body.querySelector('.ops-product-secondary-info');
    if (!secondary) {
      secondary = document.createElement('div');
      secondary.className = 'ops-product-secondary-info';
      if (title) title.insertAdjacentElement('afterend', secondary);
      else body.appendChild(secondary);
    }
    secondary.innerHTML = (identity.variant ? '<strong>規格：' + escapeHtml(identity.variant) + '</strong>' : '') +
      (identity.onlineName ? '<small>網路名稱：' + escapeHtml(identity.onlineName) + '</small>' : '');
    secondary.hidden = !secondary.innerHTML;
  }

  function enhanceStocktakeProduct(card) {
    var product = productById(card.dataset.id);
    if (!product) return;
    var identity = productIdentity(product);
    renderSlots(card.querySelector('.ops-purchase-entry-thumb'), product, true);
    var info = card.children && card.children[1];
    if (!info) return;
    var name = info.querySelector('span');
    if (name) {
      name.classList.add('ops-central-product-name');
      name.textContent = identity.centralName;
    }
    var secondary = info.querySelector('.ops-product-secondary-info');
    if (!secondary) {
      secondary = document.createElement('div');
      secondary.className = 'ops-product-secondary-info';
      if (name) name.insertAdjacentElement('afterend', secondary);
      else info.appendChild(secondary);
    }
    secondary.innerHTML = (identity.variant ? '<strong>規格：' + escapeHtml(identity.variant) + '</strong>' : '') +
      (identity.onlineName ? '<small>網路名稱：' + escapeHtml(identity.onlineName) + '</small>' : '');
    secondary.hidden = !secondary.innerHTML;
  }

  function prepareCurrentUi() {
    SEARCH_IDS.forEach(function (id) {
      var input = document.getElementById(id);
      if (!input) return;
      addSearchButton(input);
      prepareInput(input);
    });
    document.querySelectorAll('.ops-mobile-search-pad').forEach(addMobileSearchButton);
    document.querySelectorAll('.ops-product-card[data-id]').forEach(enhanceMainProductCard);
    document.querySelectorAll('.ops-product-text-row[data-id]').forEach(enhanceTextProductRow);
    document.querySelectorAll('.ops-purchase-entry-product[data-id]').forEach(enhancePurchaseProduct);
    document.querySelectorAll('.ops-stocktake-product[data-id]').forEach(enhanceStocktakeProduct);
  }

  function scheduleEnhance() {
    global.clearTimeout(enhanceTimer);
    enhanceTimer = global.setTimeout(function () {
      enhanceTimer = 0;
      prepareCurrentUi();
      scheduleRestore();
    }, 35);
  }

  function startObserver() {
    var root = document.getElementById('opsContent') || document.body;
    var observer = new MutationObserver(scheduleEnhance);
    observer.observe(root, { childList: true, subtree: true });
    prepareCurrentUi();
  }

  global.addEventListener('pageshow', scheduleEnhance);
  global.addEventListener('resize', scheduleEnhance);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  else startObserver();
})(window);
