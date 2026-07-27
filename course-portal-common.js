(function (global) {
  'use strict';

  const config = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
  if (!global.firebase || !config) throw new Error('Firebase 尚未載入。');
  if (!global.firebase.apps.length) global.firebase.initializeApp(config);
  const functions = global.firebase.app().functions('us-central1');

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function escapeHtml(value) {
    return clean(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: 'TWD',
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  function monday(value) {
    const date = value ? new Date(`${value}T12:00:00`) : new Date();
    const day = date.getDay();
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function addDays(value, amount) {
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() + Number(amount || 0));
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function sessionKey(role) {
    return `youzi.coursePortal.${role}.session.v1`;
  }

  function getSession(role) {
    return clean(global.localStorage.getItem(sessionKey(role)));
  }

  function setSession(role, token) {
    if (token) global.localStorage.setItem(sessionKey(role), clean(token));
    else global.localStorage.removeItem(sessionKey(role));
  }

  async function call(name, data) {
    try {
      const result = await functions.httpsCallable(name)(data || {});
      return result && result.data || {};
    } catch (error) {
      const message = clean(
        error && error.details ||
        error && error.message ||
        '連線失敗，請稍後再試。'
      ).replace(/^FirebaseError:\s*/i, '');
      throw new Error(message);
    }
  }

  function loading(button, active, label) {
    if (!button) return;
    if (active) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.classList.add('is-loading');
      button.textContent = label || '處理中…';
    } else {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.textContent = button.dataset.originalText || button.textContent;
    }
  }

  function toast(message, type) {
    let node = document.getElementById('portalToast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'portalToast';
      node.className = 'portal-toast';
      document.body.appendChild(node);
    }
    node.className = `portal-toast show ${type || ''}`;
    node.textContent = clean(message);
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 4200);
  }

  async function copyText(value, button) {
    const text = clean(value);
    if (!text) return;
    try {
      await global.navigator.clipboard.writeText(text);
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    if (button) {
      const original = button.textContent;
      button.textContent = '已複製';
      setTimeout(() => { button.textContent = original; }, 1800);
    }
    toast('綁定文字已複製，請貼到柚子樂器官方 LINE。');
  }

  async function exchangeAccess(role) {
    const params = new URLSearchParams(global.location.search);
    const access = clean(params.get('access'));
    if (!access) return getSession(role);
    const result = await call('coursePortalExchangeAccess', { accessToken: access });
    if (result.role !== role) throw new Error('這個登入連結不屬於目前入口。');
    setSession(role, result.sessionToken);
    params.delete('access');
    const suffix = params.toString();
    global.history.replaceState({}, '', `${global.location.pathname}${suffix ? `?${suffix}` : ''}`);
    return result.sessionToken;
  }

  async function startBinding(type, form) {
    const fields = Object.fromEntries(new FormData(form).entries());
    const result = await call('coursePortalStartBinding', Object.assign({ type }, fields));
    const box = form.parentElement.querySelector('[data-bind-result]');
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = [
        '<strong>請把下面整段文字傳給柚子樂器官方 LINE：</strong>',
        `<code>${escapeHtml(result.bindText)}</code>`,
        '<div class="grid two">',
        '<button class="btn soft" type="button" data-copy-bind>複製綁定文字</button>',
        `<a class="btn primary" href="${escapeHtml(result.lineUrl)}">開啟官方 LINE</a>`,
        '</div>',
        '<small>貼上送出後，請開啟官方 LINE 回覆的登入連結。本連結有效 20 分鐘。</small>'
      ].join('');
      const copyButton = box.querySelector('[data-copy-bind]');
      if (copyButton) copyButton.addEventListener('click', () => copyText(result.bindText, copyButton));
    }
    return result;
  }

  global.CoursePortal = {
    addDays,
    call,
    clean,
    copyText,
    escapeHtml,
    exchangeAccess,
    getSession,
    loading,
    monday,
    money,
    setSession,
    startBinding,
    toast
  };
})(window);
