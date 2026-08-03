(function (global) {
  'use strict';

  if (global.__YOUZI_POS_KEYPAD_STABILITY_V2__) return;
  global.__YOUZI_POS_KEYPAD_STABILITY_V2__ = true;

  const BUTTON_SELECTOR = '.ops-pos-number-pad [data-action="pos-key"]';
  let recentPointerButton = null;
  let recentPointerAt = 0;

  function findButton(target) {
    return target && target.closest ? target.closest(BUTTON_SELECTOR) : null;
  }

  function nextSearchValue(current, key) {
    const value = String(current == null ? '' : current);
    if (key === 'clear') return '';
    if (key === 'back') return value.slice(0, -1);
    return value + String(key || '');
  }

  function dispatchSearchInput(input, key) {
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
    const input = document.getElementById('posSearch');
    if (!input || !button) return;

    const key = String(button.dataset.key || '');
    const next = nextSearchValue(input.value, key);
    input.value = next;

    // 只有原本就在輸入框時才保留游標；按螢幕數字鍵不主動叫出手機原生鍵盤。
    if (document.activeElement === input) {
      try { input.setSelectionRange(next.length, next.length); } catch (_) {}
    }

    // 交給既有的搜尋防抖流程更新 state；不再讓每顆數字按鈕直接重畫整頁。
    dispatchSearchInput(input, key);
  }

  document.addEventListener('pointerdown', function (event) {
    const button = findButton(event.target);
    if (!button) return;

    // 防止按鈕取得焦點、觸發頁面捲動或切換手機鍵盤。
    event.preventDefault();
    event.stopImmediatePropagation();
    recentPointerButton = button;
    recentPointerAt = Date.now();
    applyKey(button);
  }, true);

  document.addEventListener('click', function (event) {
    const button = findButton(event.target);
    if (!button) return;

    // 阻止 operations-phase1.js 原本的 pos-key：它會每按一碼 renderKeepingViewport()。
    event.preventDefault();
    event.stopImmediatePropagation();

    // pointerdown 已經處理過時，不要再輸入第二次；鍵盤操作產生的 click 仍可使用。
    if (button === recentPointerButton && Date.now() - recentPointerAt < 800) return;
    applyKey(button);
  }, true);

  // 舊版 iOS WebView 沒有 PointerEvent 時的備援。
  if (!global.PointerEvent) {
    document.addEventListener('touchstart', function (event) {
      const button = findButton(event.target);
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      recentPointerButton = button;
      recentPointerAt = Date.now();
      applyKey(button);
    }, { capture: true, passive: false });
  }
})(window);
