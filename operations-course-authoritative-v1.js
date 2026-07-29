(function (global) {
  'use strict';

  var VERSION = '20260729-authoritative-course-v3';
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

  function schedulerUrl() {
    return 'course-scheduler-live.html?v=' + VERSION + '&embed=1&view=calendar';
  }

  function ensureHost() {
    var host = global.document.getElementById('opsCoursePersistentHost');
    if (host) return host;
    host = global.document.createElement('section');
    host.id = 'opsCoursePersistentHost';
    host.hidden = true;
    host.setAttribute('aria-hidden', 'true');
    var content = global.document.getElementById('opsContent');
    if (content && content.parentNode) content.parentNode.insertBefore(host, content.nextSibling);
    else global.document.body.appendChild(host);
    return host;
  }

  function removeLegacyCourseWorkspaces() {
    var content = global.document.getElementById('opsContent');
    if (!content) return;
    Array.prototype.slice.call(content.querySelectorAll('.ops-course-workspace,#opsCourseFrame')).forEach(function (node) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
  }

  function ensureFrame(host) {
    var frame = global.document.getElementById('opsCourseFrame');
    if (frame && frame.parentNode !== host) {
      if (frame.parentNode) frame.parentNode.removeChild(frame);
      frame = null;
    }
    if (!frame) {
      frame = global.document.createElement('iframe');
      frame.id = 'opsCourseFrame';
      frame.className = 'ops-course-frame';
      frame.title = '柚子樂器課務管理';
      frame.setAttribute('loading', 'eager');
      frame.setAttribute('src', schedulerUrl());
      host.appendChild(frame);
      frame.addEventListener('load', function () {
        frame.dataset.authoritativeLoaded = '1';
        sendView(frame, courseView() || 'calendar');
      });
    } else if (String(frame.getAttribute('src') || '').indexOf('v=' + VERSION) < 0) {
      frame.dataset.authoritativeLoaded = '0';
      frame.setAttribute('src', schedulerUrl());
    }
    return frame;
  }

  function sendView(frame, view) {
    if (!frame || !view) return;
    frame.dataset.courseView = view;
    try {
      if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'youzi-course-view', view: view }, global.location.origin);
    } catch (_) {}
  }

  function route() {
    scheduled = false;
    var view = courseView();
    var content = global.document.getElementById('opsContent');
    var host = ensureHost();

    if (!view) {
      if (content) {
        content.hidden = false;
        content.setAttribute('aria-hidden', 'false');
      }
      host.hidden = true;
      host.setAttribute('aria-hidden', 'true');
      return;
    }

    if (content) {
      content.hidden = true;
      content.setAttribute('aria-hidden', 'true');
    }
    host.hidden = false;
    host.setAttribute('aria-hidden', 'false');

    removeLegacyCourseWorkspaces();
    var frame = ensureFrame(host);
    sendView(frame, view);
  }

  function scheduleRoute() {
    if (scheduled) return;
    scheduled = true;
    global.requestAnimationFrame(route);
  }

  function installStyle() {
    if (global.document.getElementById('opsAuthoritativeCourseStyle')) return;
    var style = global.document.createElement('style');
    style.id = 'opsAuthoritativeCourseStyle';
    style.textContent = [
      '#opsContent[hidden],#opsCoursePersistentHost[hidden]{display:none!important}',
      '#opsCoursePersistentHost{padding:0;min-height:calc(100dvh - 88px);background:#fff}',
      '#opsCoursePersistentHost .ops-course-frame{display:block;width:100%;height:calc(100dvh - 88px);min-height:720px;border:0;background:#fff}'
    ].join('');
    global.document.head.appendChild(style);
  }

  function start() {
    installStyle();
    ensureHost();
    observer = new MutationObserver(function () {
      if (courseView()) removeLegacyCourseWorkspaces();
      scheduleRoute();
    });
    observer.observe(global.document.body, { childList: true, subtree: true });
    global.addEventListener('hashchange', scheduleRoute);
    global.addEventListener('pageshow', scheduleRoute);
    scheduleRoute();
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
