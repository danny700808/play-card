(function (global) {
  'use strict';

  var VERSION = '20260729-authoritative-course-v5';
  var VIEW_MAP = {
    'course-calendar': 'calendar',
    'course-students': 'students',
    'course-teachers': 'teachers',
    'course-settings': 'settings'
  };
  var TITLE_MAP = {
    calendar: '課程日表',
    students: '學生與學費',
    teachers: '老師薪資',
    settings: '系統設定'
  };
  var scheduled = false;
  var contentObserver = null;
  var started = false;

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
    host.className = 'ops-content ops-course-content';
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

  function updateShell(view) {
    var title = global.document.getElementById('opsPageTitle');
    if (title && TITLE_MAP[view]) title.textContent = TITLE_MAP[view];
    Array.prototype.slice.call(global.document.querySelectorAll('[data-view]')).forEach(function (node) {
      node.classList.toggle('active', VIEW_MAP[node.dataset.view] === view);
    });
    var group = global.document.getElementById('opsCourseGroup');
    var submenu = global.document.getElementById('opsCourseSubmenu');
    var toggle = global.document.getElementById('opsCourseMenuToggle');
    if (group) group.classList.add('open');
    if (submenu) submenu.hidden = false;
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }

  function setCourseVisibility(active) {
    var content = global.document.getElementById('opsContent');
    var host = ensureHost();
    if (content) {
      if (content.hidden !== active) content.hidden = active;
      content.setAttribute('aria-hidden', active ? 'true' : 'false');
    }
    if (host.hidden === active) host.hidden = !active;
    host.setAttribute('aria-hidden', active ? 'false' : 'true');
  }

  function sendView(frame, view) {
    if (!frame || !view) return;
    frame.dataset.courseView = view;
    try {
      if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'youzi-course-view', view: view }, global.location.origin);
    } catch (_) {}
  }

  function ensureFrame(host) {
    var frame = host.querySelector('#opsCourseFrame');
    if (!frame) {
      frame = global.document.createElement('iframe');
      frame.id = 'opsCourseFrame';
      frame.className = 'ops-course-frame';
      frame.title = '柚子樂器課務管理';
      frame.setAttribute('loading', 'eager');
      frame.setAttribute('src', schedulerUrl());
      frame.addEventListener('load', function () {
        frame.dataset.authoritativeLoaded = '1';
        sendView(frame, courseView() || 'calendar');
      });
      host.appendChild(frame);
    } else if (String(frame.getAttribute('src') || '').indexOf('v=' + VERSION) < 0) {
      frame.dataset.authoritativeLoaded = '0';
      frame.setAttribute('src', schedulerUrl());
    }
    return frame;
  }

  function enforceCourseHost() {
    var view = courseView();
    if (!view) return;
    removeLegacyCourseWorkspaces();
    setCourseVisibility(true);
    updateShell(view);
  }

  function route() {
    scheduled = false;
    var view = courseView();
    var host = ensureHost();

    if (!view) {
      setCourseVisibility(false);
      return;
    }

    enforceCourseHost();
    sendView(ensureFrame(host), view);
  }

  function scheduleRoute() {
    if (scheduled) return;
    scheduled = true;
    global.requestAnimationFrame(route);
  }

  function handleHashChange(event) {
    if (courseView() && event && typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    scheduleRoute();
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

  function watchLegacyContent() {
    var content = global.document.getElementById('opsContent');
    if (!content || contentObserver) return;
    contentObserver = new MutationObserver(function () {
      if (courseView()) enforceCourseHost();
    });
    contentObserver.observe(content, {
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden']
    });
  }

  function start() {
    if (started) return;
    started = true;
    installStyle();
    ensureHost();
    watchLegacyContent();
    global.addEventListener('hashchange', handleHashChange, true);
    global.addEventListener('pageshow', scheduleRoute);
    route();
  }

  if (global.document.body) start();
  else global.document.addEventListener('DOMContentLoaded', start);
})(window);
