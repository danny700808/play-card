(function (global) {
  'use strict';

  if (global.__YOUZI_MOBILE_POS_V4__) return;
  global.__YOUZI_MOBILE_POS_V4__ = true;

  const MOBILE_QUERY = '(max-width: 780px)';
  const historySignatures = new WeakMap();
  let enhanceFrame = 0;

  function isMobile() {
    return Boolean(global.matchMedia && global.matchMedia(MOBILE_QUERY).matches);
  }

  function cloneText(source, fallback) {
    const value = source ? String(source.textContent || '').trim() : '';
    return value || fallback || '';
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
        const name = document.createElement('b');
        name.textContent = cloneText(cells[3], '沒有商品明細');
        item.append(name);
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
    buildHistoryCards();
  }

  function scheduleEnhance() {
    if (enhanceFrame) return;
    enhanceFrame = global.requestAnimationFrame(enhance);
  }

  const root = document.getElementById('opsContent') || document.body;
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(root, { childList: true, subtree: true });
  global.addEventListener('resize', scheduleEnhance);
  global.addEventListener('pageshow', scheduleEnhance);
  scheduleEnhance();
})(window);
