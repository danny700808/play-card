(function (global) {
  'use strict';

  async function call(action, payload = {}) {
    const data = { ...payload, action };
    if (action !== 'register' && action !== 'verifyEmail') {
      return global.YZProtectedData.call('parttimeOnboarding', data);
    }
    const { FIREBASE_CONFIG, FUNCTION_REGION = 'us-central1' } = global.APP_CONFIG;
    const url = 'https://' + FUNCTION_REGION + '-' + FIREBASE_CONFIG.projectId + '.cloudfunctions.net/parttimeOnboarding';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    });
    const body = await response.json();
    if (!response.ok || body.error || !body.result) {
      throw new Error(body.error?.message || '註冊服務暫時無法連線，請稍後再試。');
    }
    return body.result;
  }

  global.ParttimeOnboarding = { call };
})(window);
