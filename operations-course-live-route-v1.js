(function (global) {
  'use strict';

  var LIVE_URL = 'course-scheduler-live.html?v=20260729-live-full-scheduler-v1&embed=1&view=calendar';

  function currentCourseView() {
    var hash = String(global.location.hash || '#overview').replace(/^#/, '').split('?')[0];
    return {
      'course-calendar': 'calendar',
      'course-students': 'students',
      'course-teachers': 'teachers',
      'course-settings': 'settings'
    }[hash] || '';
  }

  function liveUrl(view) {
    return 'course-scheduler-live.html?v=20260729-live-full-scheduler-v1&embed=1&view=' + encodeURIComponent(view || 'calendar');
  }

  function routeFrame() {
    var view = currentCourseView();
    if (!view) return;
    var frame = global.document.getElementById('opsCourseFrame');
    if (!frame) return;
    var current = frame.getAttribute('src') || '';
    if (current.indexOf('course-scheduler-live.html') >= 0) return;
    frame.dataset.courseView = view;
    frame.src = liveUrl(view);
  }

  function cleanDuplicateSchedules() {
    if (String(global.location.hash || '#overview').indexOf('#overview') !== 0) return;
    var content = global.document.getElementById('opsContent');
    if (!content) return;
    var cards = Array.prototype.slice.call(content.querySelectorAll('section.ops-card')).filter(function (card) {
      var title = card.querySelector('h2');
      return title && String(title.textContent || '').trim() === '今日課表';
    });
    if (cards.length <= 1) return;
    var keep = cards.find(function (card) { return card.classList.contains('ops-mobile-course-fix-card'); }) || cards[0];
    cards.forEach(function (card) { if (card !== keep) card.remove(); });
  }

  function schedule() {
    global.requestAnimationFrame(function () {
      routeFrame();
      cleanDuplicateSchedules();
    });
  }

  new MutationObserver(schedule).observe(global.document.body, { childList: true, subtree: true });
  global.addEventListener('hashchange', schedule);
  global.addEventListener('pageshow', schedule);
  schedule();
})(window);
