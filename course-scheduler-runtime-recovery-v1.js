(function (global) {
  'use strict';

  var MAX_WAIT_MS = 15000;
  var POLL_MS = 120;
  var started = false;

  global.__YOUZI_COURSE_SCHEDULER_TEST__ = true;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function hasRows(source, key) {
    return Boolean(source && Array.isArray(source[key]) && source[key].length);
  }

  function meaningful(source) {
    if (!source || Number(source.version) !== 3) return false;
    var hasSchedule = ['events', 'recurringRules', 'fixedCourses', 'temporaryCourses', 'roomRentals']
      .some(function (key) { return hasRows(source, key); });
    return hasRows(source, 'rooms') && hasSchedule;
  }

  function sleep(ms) {
    return new Promise(function (resolve) { global.setTimeout(resolve, ms); });
  }

  function showMessage(message) {
    var meta = global.document && global.document.getElementById('dataModeMeta');
    if (meta) meta.textContent = message;
  }

  async function waitForSchedulerApi() {
    var startedAt = Date.now();
    while (Date.now() - startedAt < MAX_WAIT_MS) {
      var api = global.YouziCourseSchedulerTest;
      if (api && typeof api.restoreFormalDatabase === 'function' && typeof api.snapshot === 'function') return api;
      await sleep(POLL_MS);
    }
    return null;
  }

  async function readyCourseData() {
    try {
      if (global.YouziCourseAutoDataReady && typeof global.YouziCourseAutoDataReady.then === 'function') {
        return await global.YouziCourseAutoDataReady;
      }
      if (global.YouziCourseAutoData && typeof global.YouziCourseAutoData.ensure === 'function') {
        return await global.YouziCourseAutoData.ensure();
      }
    } catch (error) {
      console.warn('[full scheduler course data]', error);
    }
    return null;
  }

  async function restore() {
    if (started) return;
    started = true;

    showMessage('正在開啟完整課表資料');
    var dataResult = await readyCourseData();
    var api = await waitForSchedulerApi();
    if (!api) {
      showMessage('完整課表程式尚未完成載入，請重新開啟一次');
      return;
    }

    for (var attempt = 0; attempt < 4; attempt += 1) {
      try {
        await api.restoreFormalDatabase();
      } catch (error) {
        console.warn('[full scheduler restore]', error);
      }
      var current = null;
      try { current = api.snapshot(); } catch (_) {}
      if (meaningful(current)) {
        showMessage((current.students || []).length + ' 位學生・' + (current.events || []).length + ' 筆課表');
        global.dispatchEvent(new CustomEvent('youzi-course-full-scheduler-ready', { detail: { snapshot: current } }));
        return;
      }
      await sleep(250);
    }

    var fallback = dataResult && dataResult.snapshot;
    if (meaningful(fallback)) {
      showMessage('課表資料已取得，正在重新套用');
      try {
        global.sessionStorage.removeItem('youzi.courseScheduler.localRecoveryReload.v2');
      } catch (_) {}
      global.location.reload();
      return;
    }

    showMessage('完整課表資料尚未成功套用');
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', restore);
  } else {
    restore();
  }
})(window);
