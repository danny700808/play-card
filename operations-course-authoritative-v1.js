(function (global) {
  'use strict';

  var VERSION = '20260729-interactive-course-v1';
  var VIEW_MAP = {
    'course-calendar': 'calendar',
    'course-students': 'students',
    'course-teachers': 'teachers',
    'course-settings': 'settings'
  };
  var scheduled = false;

  function currentHash() {
    return String(global.location.hash || '#overview').replace(/^#/, '').split('?')[0] || 'overview';
  }

  function courseView() {
    return VIEW_MAP[currentHash()] || '';
  }

  function expectedUrl(view) {
    return 'course-scheduler-live.html?v=' + VERSION + '&embed=1&view=' + encodeURIComponent(view);
  }

  function routeInteractiveScheduler() {
    scheduled = false;
    var view = courseView();
    if (!view) return;
    var frame = global.document.getElementById('opsCourseFrame');
    if (!frame) return;
    var expected = expectedUrl(view);
    if ((frame.getAttribute('src') || '') !== expected) {
      frame.dataset.courseView = view;
      frame.setAttribute('src', expected);
      return;
    }
    try {
      if (frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'youzi-course-view', view: view }, global.location.origin);
      }
    } catch (_) {}
  }

  function scheduleRoute() {
    if (scheduled) return;
    scheduled = true;
    global.requestAnimationFrame(routeInteractiveScheduler);
  }

  function start() {
    new MutationObserver(scheduleRoute).observe(global.document.body, { childList: true, subtree: true });
    global.addEventListener('hashchange', scheduleRoute);
    global.addEventListener('pageshow', scheduleRoute);
    scheduleRoute();
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
