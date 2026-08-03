(function (global) {
  'use strict';

  if (global.__YOUZI_MOBILE_POS_V3__) return;
  global.__YOUZI_MOBILE_POS_V3__ = true;

  const MOBILE_QUERY = '(max-width: 780px)';
  const BUTTON_SELECTOR = '.ops-pos-number-pad [data-action="pos-key"]';
  let recentButton = null;
  let recentAt = 0;

  function mobile() {
    return Boolean(global.matchMedia && global.matchMedia(MOBILE_QUERY).matches);
  }

  function posInput() {
    return document.getElementById('posSearch');
  }

  function prepareInput(input) {
    if (!input || !mobile()) return;
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('pattern', '[0-9]*');
    input.setAttribute('enterkeyhint', 'search');
    input.setAttribute('autocomplete', 'off');
    input.spellcheck = false;
  }

  function findButton(target) {
    return target && target.closest ? target.closest(BUTTON_SELECTOR) : null;
  }

  function nextValue(current, key) {
    const value = String(current == null ? '' : current);
    if (key === 'clear') return '';
    if (key === 'back') return value.slice(0, -1);
    return value + String(key || '');
  }

  function emitInput(input, key) {
    let event;
    try {
      event = new InputEvent('input', {
        bubbles: true,
        inputType: key === 'back' ? 'deleteContentBackward' : 'insertText',
        data: /^[0-9]$/.test(key) ? key : null
      });
    } catch (_) {
      event = new Event('input', { bubbles: true });
    }
    input.dispatchEvent(event);
  }

  function applyKey(button) {
    const input = posInput();
    if (!input || !button || !mobile()) return;

    prepareInput(input);

    // 自製數字鍵使用時，先收起手機原生鍵盤，避免數字／英文鍵盤互相切換。
    if (document.activeElement === input) {
      try { input.blur(); } catch (_) {}
    }

    const key = String(button.dataset.key || '');
    input.value = nextValue(input.value, key);
    emitInput(input, key);
  }

  document.addEventListener('focusin', function (event) {
    if (event.target && event.target.id === 'posSearch') prepareInput(event.target);
  }, true);

  document.addEventListener('pointerdown', function (event) {
    const button = findButton(event.target);
    if (!button || !mobile()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    recentButton = button;
    recentAt = Date.now();
    applyKey(button);
  }, true);

  document.addEventListener('click', function (event) {
    const button = findButton(event.target);
    if (!button || !mobile()) return;

    // 阻止舊版 pos-key 每按一碼就重畫整個銷售頁。
    event.preventDefault();
    event.stopImmediatePropagation();

    if (button === recentButton && Date.now() - recentAt < 900) return;
    applyKey(button);
  }, true);

  if (!global.PointerEvent) {
    document.addEventListener('touchstart', function (event) {
      const button = findButton(event.target);
      if (!button || !mobile()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      recentButton = button;
      recentAt = Date.now();
      applyKey(button);
    }, { capture: true, passive: false });
  }

  const root = document.getElementById('opsContent') || document.body;
  const observer = new MutationObserver(function () {
    prepareInput(posInput());
  });
  observer.observe(root, { childList: true, subtree: true });

  prepareInput(posInput());
})(window);
