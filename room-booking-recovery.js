(function (root) {
  'use strict';
  function create(options) {
    let pending = null, busy = false, timer = null, stopped = false;
    const storage = options.storage;
    const schedule = options.schedule || ((fn, ms) => setTimeout(fn, ms));
    const cancel = options.cancel || clearTimeout;
    const report = (state, extra = {}) => options.onState({ state, ...extra });
    try { pending = JSON.parse(storage.getItem(options.key) || 'null'); }
    catch (_) { throw new Error('無法讀取待確認預約，請保留此頁並稍後重試。'); }
    function later() {
      if (!stopped && pending) timer = schedule(() => check(), 5000);
    }
    async function run(send) {
      if (busy || !pending || stopped) return;
      busy = true;
      if (timer) cancel(timer);
      try {
        report('pending');
        let result = await options.call(send ? 'coursePortalCreateRoomBooking' : 'coursePortalRoomBookingOperation',
          send ? pending : { operationId: pending.operationId });
        if (!send && result.state === 'pending' && result.retryAllowed) {
          result = await options.call('coursePortalCreateRoomBooking', pending);
        }
        if (result.state === 'confirmed' || result.state === 'failed') {
          // Never clear a journal before the server has returned a definite outcome.
          storage.removeItem(options.key);
          pending = null;
          report(result.state, result);
        } else report('pending');
      } catch (error) {
        report('pending', { message: '連線中斷或伺服器仍在處理，正在查回預約結果，請勿重複預約。' });
      } finally { busy = false; later(); }
    }
    function check() { return run(false); }
    return {
      hasPending: () => Boolean(pending),
      async submit(payload) {
        if (pending) return check();
        const request = { ...payload, operationId: options.newId() };
        // Storage must succeed before a booking request is sent.
        storage.setItem(options.key, JSON.stringify(request));
        pending = request;
        return run(true);
      },
      check,
      stop() { stopped = true; if (timer) cancel(timer); }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
  else root.YouziBookingRecovery = { create };
})(typeof window !== 'undefined' ? window : globalThis);
