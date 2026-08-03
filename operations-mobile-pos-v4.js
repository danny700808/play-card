(function (global) {
  'use strict';

  if (global.__YOUZI_MOBILE_POS_V4__) return;
  global.__YOUZI_MOBILE_POS_V4__ = true;

  const MOBILE_QUERY = '(max-width: 780px)';
  const KEY_SELECTOR = '.ops-pos-number-pad [data-action="pos-key"]';
  const historySignatures = new WeakMap();
  let recentButton = null;
  let recentAt = 0;
  let enhanceFrame = 0;
  let resultFrame = 0;
  let composing = false;

  function isMobile() {
    return Boolean(global.matchMedia && global.matchMedia(MOBILE_QUERY).matches);
  }

  function operationsState() {
    return global.OperationsCenterV1 && global.OperationsCenterV1.state || null;
  }

  function posInput() {
    return document.getElementById('posSearch');
  }

  function prepareSearchInput(input) {
    if (!input || !isMobile()) return;
    input.setAttribute('inputmode', 'search');
    input.setAttribute('enterkeyhint', 'search');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.removeAttribute('pattern');
    input.spellcheck = false;
  }

  function normalize(value) {
    return String(value == null ? '' : value).normalize('NFKC').toLowerCase().trim();
  }

  function productMatches(product, rawTerm) {
    const term = normalize(rawTerm);
    if (!term) return false;
    const sku = String(product && product.sku || '');
    const values = [
      product && product.originalName,
      product && product.onlineName,
      product && product.name,
      sku,
      product && product.barcode,
      product && product.brand,
      product && product.category,
      product && product.variantName
    ].filter(Boolean);
    const haystack = normalize(values.join(' '));
    const compactHaystack = haystack.replace(/[\s\-_/]/g, '');
    return term.split(/\s+/).filter(Boolean).every(function (token) {
      return haystack.includes(token) || compactHaystack.includes(token.replace(/[\s\-_/]/g, ''));
    });
  }

  function money(value) {
    const amount = Math.max(0, Number(value || 0));
    return 'NT$ ' + Math.round(amount).toLocaleString('zh-TW');
  }

  function resultNode() {
    return document.querySelector('.ops-v8-sales-search-grid .ops-pos-products');
  }

  function emptyResult(title, detail) {
    const box = document.createElement('div');
    box.className = 'ops-v8-sales-search-empty';
    const strong = document.createElement('b');
    strong.textContent = title;
    box.append(strong);
    if (detail) {
      const small = document.createElement('small');
      small.textContent = detail;
      box.append(small);
    }
    return box;
  }

  function buildProductResult(product, usageMode) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ops-pos-item ops-v8-pos-item';
    button.dataset.action = 'cart-add';
    button.dataset.id = String(product.docId || '');

    if (product.imageUrl) {
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.src = product.imageUrl;
      image.alt = '';
      image.addEventListener('error', function () { image.style.display = 'none'; }, { once: true });
      button.append(image);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'ops-pos-no-image';
      placeholder.textContent = '無圖';
      button.append(placeholder);
    }

    const copy = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = String(product.originalName || product.name || product.onlineName || '未命名商品');
    const meta = document.createElement('small');
    meta.textContent = '編號 ' + String(product.sku || '未設定') + '・庫存 ' + Number(product.currentStock || 0).toLocaleString('zh-TW');
    copy.append(name, meta);
    button.append(copy);

    const value = document.createElement('strong');
    value.textContent = usageMode ? '加入' : money(product.storePrice);
    button.append(value);
    return button;
  }

  function updateSearchResults(value) {
    if (!isMobile()) return;
    const state = operationsState();
    const node = resultNode();
    if (!state || !node) return;

    const term = String(value == null ? '' : value);
    state.posSearch = term;
    node.replaceChildren();

    if (!normalize(term)) {
      node.append(emptyResult('輸入商品編號或名稱', '支援中文、英文、SKU 與條碼'));
      return;
    }

    const usageMode = state.salesMode === 'usage';
    const products = (Array.isArray(state.catalog) ? state.catalog : []).filter(function (product) {
      return product && product.initialized && product.status !== 'inactive' && productMatches(product, term);
    }).slice(0, 30);

    if (!products.length) {
      node.append(emptyResult('找不到商品', '請調整商品編號、中文或英文名稱'));
      return;
    }
    products.forEach(function (product) { node.append(buildProductResult(product, usageMode)); });
  }

  function scheduleResults(value, immediate) {
    if (resultFrame) {
      global.cancelAnimationFrame(resultFrame);
      resultFrame = 0;
    }
    const run = function () {
      resultFrame = 0;
      updateSearchResults(value);
    };
    if (immediate) run();
    else resultFrame = global.requestAnimationFrame(run);
  }

  function findKey(target) {
    return target && target.closest ? target.closest(KEY_SELECTOR) : null;
  }

  function currentSelection(input) {
    const length = String(input.value || '').length;
    if (document.activeElement !== input) return { start: length, end: length };
    const start = typeof input.selectionStart === 'number' ? input.selectionStart : length;
    const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
    return { start: Math.max(0, start), end: Math.max(0, end) };
  }

  function nextValue(input, key) {
    const value = String(input.value == null ? '' : input.value);
    const selection = currentSelection(input);
    if (key === 'clear') return { value: '', caret: 0 };
    if (key === 'back') {
      if (selection.end > selection.start) {
        return { value: value.slice(0, selection.start) + value.slice(selection.end), caret: selection.start };
      }
      if (selection.start <= 0) return { value, caret: 0 };
      return {
        value: value.slice(0, selection.start - 1) + value.slice(selection.end),
        caret: selection.start - 1
      };
    }
    const text = String(key || '');
    return {
      value: value.slice(0, selection.start) + text + value.slice(selection.end),
      caret: selection.start + text.length
    };
  }

  function applyKey(button) {
    const input = posInput();
    if (!input || !button || !isMobile()) return;
    prepareSearchInput(input);

    const key = String(button.dataset.key || '');
    const next = nextValue(input, key);
    input.value = next.value;
    if (document.activeElement === input) {
      try { input.setSelectionRange(next.caret, next.caret); } catch (_) {}
    }
    scheduleResults(next.value, true);
  }

  function cloneText(source, fallback) {
    const text = source ? String(source.textContent || '').trim() : '';
    return text || fallback || '';
  }

  function buildHistoryCards() {
    if (!isMobile()) return;
    const section = document.querySelector('.ops-v8-sales-history');
    if (!section) return;
    const tbody = section.querySelector('.ops-v8-sales-history-table tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll(':scope > tr'));
    const signature = rows.map(function (row) { return String(row.textContent || '').trim(); }).join('\u241e');
    if (historySignatures.get(section) === signature && section.querySelector('.ops-mobile-sales-history')) return;
    historySignatures.set(section, signature);

    const previous = section.querySelector('.ops-mobile-sales-history');
    if (previous) previous.remove();
    const list = document.createElement('div');
    list.className = 'ops-mobile-sales-history';

    rows.forEach(function (row) {
      const cells = Array.from(row.children);
      if (cells.length < 8) return;
      const card = document.createElement('article');
      card.className = 'ops-mobile-history-card';

      const header = document.createElement('header');
      const identity = document.createElement('div');
      const time = document.createElement('time');
      time.textContent = cloneText(cells[0]);
      const type = document.createElement('strong');
      type.textContent = cloneText(cells[1] && cells[1].querySelector('b'), cloneText(cells[1]));
      const order = document.createElement('small');
      order.textContent = cloneText(cells[1] && cells[1].querySelector('small'));
      identity.append(time, type);
      if (order.textContent) identity.append(order);
      header.append(identity);
      if (cells[4]) {
        const status = document.createElement('div');
        status.className = 'ops-mobile-history-status';
        Array.from(cells[4].childNodes).forEach(function (node) { status.append(node.cloneNode(true)); });
        header.append(status);
      }
      card.append(header);

      const owner = document.createElement('div');
      owner.className = 'ops-mobile-history-owner';
      const ownerLabel = document.createElement('span');
      ownerLabel.textContent = '客戶／用途';
      const ownerValue = document.createElement('b');
      ownerValue.textContent = cloneText(cells[2], '—');
      owner.append(ownerLabel, ownerValue);
      card.append(owner);

      const items = document.createElement('div');
      items.className = 'ops-mobile-history-items';
      const sourceItems = cells[3] ? Array.from(cells[3].querySelectorAll('.ops-sales-item-analysis')) : [];
      if (sourceItems.length) {
        sourceItems.forEach(function (source) {
          const item = document.createElement('div');
          item.className = 'ops-mobile-history-item';
          const copy = document.createElement('div');
          const name = document.createElement('b');
          name.textContent = cloneText(source.querySelector('b'), '商品');
          const detail = document.createElement('small');
          detail.textContent = cloneText(source.querySelector('small'));
          copy.append(name);
          if (detail.textContent) copy.append(detail);
          item.append(copy);
          items.append(item);
        });
      } else {
        const item = document.createElement('div');
        item.className = 'ops-mobile-history-item';
        const copy = document.createElement('div');
        const name = document.createElement('b');
        name.textContent = cloneText(cells[3], '沒有商品明細');
        copy.append(name);
        item.append(copy);
        items.append(item);
      }
      card.append(items);

      const values = document.createElement('div');
      values.className = 'ops-mobile-history-money';
      ['金額', '成本', '毛利'].forEach(function (label, index) {
        const cell = cells[5 + index];
        if (!cell) return;
        const box = document.createElement('div');
        const heading = document.createElement('span');
        heading.textContent = label;
        const value = document.createElement('b');
        value.textContent = cloneText(cell, '—');
        box.append(heading, value);
        values.append(box);
      });
      card.append(values);

      const actionSource = cells[8] && cells[8].querySelector('button, a');
      if (actionSource) {
        const action = actionSource.cloneNode(true);
        action.classList.add('wide');
        card.append(action);
      }
      list.append(card);
    });

    if (list.childElementCount) section.append(list);
  }

  function enhance() {
    enhanceFrame = 0;
    if (!isMobile()) return;
    const input = posInput();
    prepareSearchInput(input);
    if (input && document.activeElement !== input) {
      const state = operationsState();
      if (state && String(input.value || '') !== String(state.posSearch || '')) input.value = String(state.posSearch || '');
    }
    buildHistoryCards();
  }

  function scheduleEnhance() {
    if (enhanceFrame) return;
    enhanceFrame = global.requestAnimationFrame(enhance);
  }

  global.addEventListener('compositionstart', function (event) {
    if (!isMobile() || !event.target || event.target.id !== 'posSearch') return;
    composing = true;
    event.stopImmediatePropagation();
  }, true);

  global.addEventListener('compositionend', function (event) {
    if (!isMobile() || !event.target || event.target.id !== 'posSearch') return;
    event.stopImmediatePropagation();
    composing = false;
    scheduleResults(event.target.value, false);
  }, true);

  global.addEventListener('input', function (event) {
    if (!isMobile() || !event.target || event.target.id !== 'posSearch') return;
    event.stopImmediatePropagation();
    if (!composing && !event.isComposing) scheduleResults(event.target.value, false);
    else {
      const state = operationsState();
      if (state) state.posSearch = event.target.value;
    }
  }, true);

  global.addEventListener('keydown', function (event) {
    if (!isMobile() || !event.target || event.target.id !== 'posSearch' || event.key !== 'Enter') return;
    event.stopImmediatePropagation();
    scheduleResults(event.target.value, true);
  }, true);

  document.addEventListener('focusin', function (event) {
    if (event.target && event.target.id === 'posSearch') prepareSearchInput(event.target);
  }, true);

  document.addEventListener('pointerdown', function (event) {
    const button = findKey(event.target);
    if (!button || !isMobile()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    recentButton = button;
    recentAt = Date.now();
    applyKey(button);
  }, true);

  document.addEventListener('click', function (event) {
    const button = findKey(event.target);
    if (!button || !isMobile()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button === recentButton && Date.now() - recentAt < 900) return;
    applyKey(button);
  }, true);

  if (!global.PointerEvent) {
    document.addEventListener('touchstart', function (event) {
      const button = findKey(event.target);
      if (!button || !isMobile()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      recentButton = button;
      recentAt = Date.now();
      applyKey(button);
    }, { capture: true, passive: false });
  }

  const root = document.getElementById('opsContent') || document.body;
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(root, { childList: true, subtree: true });
  global.addEventListener('resize', scheduleEnhance);
  global.addEventListener('pageshow', scheduleEnhance);
  scheduleEnhance();
})(window);
