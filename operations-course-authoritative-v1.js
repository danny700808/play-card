(function (global) {
  'use strict';

  var VERSION = '20260729-interactive-course-v2';
  var VIEW_MAP = {
    'course-calendar': 'calendar',
    'course-students': 'students',
    'course-teachers': 'teachers',
    'course-settings': 'settings'
  };
  var scheduled = false;
  var observer = null;

  function currentHash() {
    return String(global.location.hash || '#overview').replace(/^#/, '').split('?')[0] || 'overview';
  }

  function courseView() {
    return VIEW_MAP[currentHash()] || '';
  }

  function stableUrl() {
    return 'course-scheduler-live.html?v=' + VERSION + '&embed=1&view=calendar';
  }

  function nodes() {
    return {
      content: global.document.getElementById('opsContent'),
      host: global.document.getElementById('opsCoursePersistentHost'),
      frame: global.document.getElementById('opsCourseFrame')
    };
  }

  function sendView(frame, view) {
    if (!frame || !view) return;
    frame.dataset.courseView = view;
    try {
      if (frame.contentWindow) {
        frame.contentWindow.postMessage({ type: 'youzi-course-view', view: view }, global.location.origin);
      }
    } catch (_) {}
  }

  function bindFrame(frame) {
    if (!frame || frame.dataset.authoritativeBound === '1') return;
    frame.dataset.authoritativeBound = '1';
    frame.addEventListener('load', function () {
      frame.dataset.authoritativeLoaded = '1';
      sendView(frame, courseView());
    });
  }

  function ensureStableFrame(frame, view) {
    if (!frame) return;
    bindFrame(frame);
    var src = String(frame.getAttribute('src') || '');
    var expected = stableUrl();
    if (src.indexOf('course-scheduler-live.html') < 0 || src.indexOf('v=' + VERSION) < 0) {
      frame.dataset.authoritativeLoaded = '0';
      frame.dataset.courseView = view || 'calendar';
      frame.setAttribute('src', expected);
      return;
    }
    sendView(frame, view);
  }

  function moveWorkspaceToHost(content, host, frame) {
    if (!content || !host || !frame) return;
    var workspace = frame.closest('.ops-course-workspace');
    if (workspace && workspace.parentNode !== host) host.appendChild(workspace);
  }

  function routeInteractiveScheduler() {
    scheduled = false;
    var view = courseView();
    var current = nodes();

    if (!view) {
      if (current.content) {
        current.content.hidden = false;
        current.content.setAttribute('aria-hidden', 'false');
      }
      if (current.host) {
        current.host.hidden = true;
        current.host.setAttribute('aria-hidden', 'true');
      }
      return;
    }

    if (!current.frame) {
      global.setTimeout(scheduleRoute, 24);
      return;
    }

    moveWorkspaceToHost(current.content, current.host, current.frame);
    if (current.content) {
      current.content.hidden = true;
      current.content.setAttribute('aria-hidden', 'true');
    }
    if (current.host) {
      current.host.hidden = false;
      current.host.setAttribute('aria-hidden', 'false');
    }
    ensureStableFrame(current.frame, view);
  }

  function scheduleRoute() {
    if (scheduled) return;
    scheduled = true;
    global.requestAnimationFrame(routeInteractiveScheduler);
  }

  function installStyle() {
    if (global.document.getElementById('opsAuthoritativeCourseStyle')) return;
    var style = global.document.createElement('style');
    style.id = 'opsAuthoritativeCourseStyle';
    style.textContent = [
      '#opsContent[hidden],#opsCoursePersistentHost[hidden]{display:none!important}',
      '#opsCoursePersistentHost{padding-top:0}',
      '#opsCoursePersistentHost .ops-course-workspace{min-height:calc(100dvh - 88px)}',
      '#opsCoursePersistentHost .ops-course-frame{display:block;width:100%;min-height:calc(100dvh - 88px);border:0;background:#fff}'
    ].join('');
    global.document.head.appendChild(style);
  }

  function start() {
    installStyle();
    var content = global.document.getElementById('opsContent');
    if (content) {
      observer = new MutationObserver(scheduleRoute);
      observer.observe(content, { childList: true, subtree: true });
    }
    global.addEventListener('hashchange', function () {
      scheduleRoute();
      global.setTimeout(scheduleRoute, 30);
    });
    global.addEventListener('pageshow', scheduleRoute);
    scheduleRoute();
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
