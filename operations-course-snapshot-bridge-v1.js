(function (global) {
  'use strict';

  var DB_NAME = 'youzi-course-scheduler';
  var STORE_NAME = 'formalSnapshots';
  var FORMAL_KEY = 'latest';
  var WORKSPACE_KEY = 'workspace';
  var CACHE_KEY = 'youzi.courseScheduler.formalCache.v1';
  var seededPromise = null;
  var reloadVersion = '20260729-snapshot-bridge-v1';

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

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { resolve(null); return; }
      var request = global.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
    });
  }

  async function readSnapshot() {
    var db = await openDatabase();
    if (!db) return null;
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction(STORE_NAME, 'readonly');
      var store = transaction.objectStore(STORE_NAME);
      var workspaceRequest = store.get(WORKSPACE_KEY);
      var formalRequest = store.get(FORMAL_KEY);
      transaction.oncomplete = function () {
        var workspace = workspaceRequest.result || null;
        var formal = formalRequest.result || null;
        db.close();
        resolve(meaningful(workspace) ? workspace : (meaningful(formal) ? formal : null));
      };
      transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB read failed')); };
      transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB read aborted')); };
    });
  }

  function seedCache(snapshot) {
    if (!meaningful(snapshot)) return false;
    try {
      var formal = JSON.parse(JSON.stringify(snapshot));
      formal.readOnly = true;
      formal.dataMode = 'migration';
      formal.clipboard = null;
      global.localStorage.setItem(CACHE_KEY, JSON.stringify(formal));
      return true;
    } catch (_) {
      return false;
    }
  }

  function seedFromEvent(event) {
    var snapshot = event && event.detail && event.detail.snapshot;
    if (seedCache(snapshot)) seededPromise = Promise.resolve(snapshot);
  }

  function ensureSeeded() {
    if (seededPromise) return seededPromise;
    seededPromise = readSnapshot().then(function (snapshot) {
      if (seedCache(snapshot)) return snapshot;
      if (global.YouziCourseAutoData && typeof global.YouziCourseAutoData.ensure === 'function') {
        return global.YouziCourseAutoData.ensure().then(function (result) {
          var ready = result && result.snapshot;
          seedCache(ready);
          return ready || null;
        });
      }
      return null;
    }).catch(function () { return null; });
    return seededPromise;
  }

  function currentView() {
    return String(global.location.hash || '#overview').replace(/^#/, '').split('?')[0] || 'overview';
  }

  function cleanDuplicateSchedules() {
    if (currentView() !== 'overview') return;
    var content = global.document.getElementById('opsContent');
    if (!content) return;
    var cards = Array.prototype.slice.call(content.querySelectorAll('section.ops-card')).filter(function (card) {
      var title = card.querySelector('h2');
      return title && clean(title.textContent) === '今日課表';
    });
    if (cards.length <= 1) return;
    var keep = cards.find(function (card) { return card.classList.contains('ops-mobile-course-fix-card'); }) || cards[0];
    cards.forEach(function (card) { if (card !== keep) card.remove(); });
  }

  function refreshExistingFrame() {
    if (currentView().indexOf('course-') !== 0) return;
    var frame = global.document.getElementById('opsCourseFrame');
    if (!frame || frame.dataset.snapshotBridgeReloaded === reloadVersion) return;
    frame.dataset.snapshotBridgeReloaded = reloadVersion;
    try {
      var url = new URL(frame.getAttribute('src') || frame.src, global.location.href);
      url.searchParams.set('snapshotBridge', reloadVersion);
      frame.src = url.pathname + url.search;
    } catch (_) {}
  }

  function openCourseView(view) {
    ensureSeeded().then(function () {
      global.location.hash = view || 'course-calendar';
      global.setTimeout(refreshExistingFrame, 30);
    });
  }

  function onCaptureClick(event) {
    var target = event.target && event.target.closest && event.target.closest('[data-nav="course-calendar"],a[href="#course-calendar"]');
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCourseView('course-calendar');
  }

  function start() {
    global.addEventListener('youzi-course-auto-data-ready', seedFromEvent);
    global.document.addEventListener('click', onCaptureClick, true);
    global.addEventListener('hashchange', function () {
      cleanDuplicateSchedules();
      if (currentView().indexOf('course-') === 0) ensureSeeded().then(refreshExistingFrame);
    });
    new MutationObserver(function () {
      cleanDuplicateSchedules();
    }).observe(global.document.body, { childList: true, subtree: true });
    ensureSeeded().then(function () {
      cleanDuplicateSchedules();
      refreshExistingFrame();
    });
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
