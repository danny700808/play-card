(function (global) {
  'use strict';

  var DB_NAME = 'youzi-course-scheduler';
  var STORE_NAME = 'formalSnapshots';
  var KEYS = ['workspace', 'latest'];
  var RUNTIME_SRC = 'course-center.js?v=20260729-fresh-course-v2';

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function rows(source, key) { return source && Array.isArray(source[key]) ? source[key] : []; }

  function isDemo(source) {
    var count = rows(source, 'students').filter(function (student) {
      return /^示範學生\s*[A-F]$/i.test(clean(student && student.name));
    }).length;
    return count >= 2 && !clean(source && source.dataMeta && source.dataMeta.runId);
  }

  function hasRealContent(source) {
    if (!source || Number(source.version) !== 3 || isDemo(source)) return false;
    return [
      'students', 'teachers', 'events', 'recurringRules', 'fixedCourses',
      'temporaryCourses', 'tuitionPeriods', 'teacherPayroll', 'roomRentals'
    ].some(function (key) { return rows(source, key).length > 0; });
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { resolve(null); return; }
      var request = global.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
    });
  }

  async function removeEmptySnapshots() {
    var db = await openDatabase();
    if (!db) return;
    var values = await new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readonly');
      var store = tx.objectStore(STORE_NAME);
      var requests = KEYS.map(function (key) { return store.get(key); });
      tx.oncomplete = function () { resolve(requests.map(function (request) { return request.result || null; })); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB read failed')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB read aborted')); };
    });

    var invalidKeys = KEYS.filter(function (_, index) {
      return values[index] && !hasRealContent(values[index]);
    });
    if (invalidKeys.length) {
      await new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        invalidKeys.forEach(function (key) { store.delete(key); });
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB cleanup failed')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB cleanup aborted')); };
      });
      try { console.warn('[fresh course center] removed empty snapshots', invalidKeys); } catch (_) {}
    }
    db.close();
  }

  function protectMirrorLoader() {
    var adapter = global.YouziCoursePreviewData;
    if (!adapter || typeof adapter.load !== 'function' || adapter.__freshProtected) return;
    var originalLoad = adapter.load;
    adapter.load = async function (options) {
      var result = await originalLoad.call(adapter, options);
      if (!hasRealContent(result)) throw new Error('已同步鏡像沒有學生、老師或課程資料，未建立空白 workspace。');
      return result;
    };
    adapter.__freshProtected = true;
  }

  function loadRuntime() {
    var script = document.createElement('script');
    script.src = RUNTIME_SRC;
    script.async = false;
    script.onerror = function () {
      var title = document.getElementById('statusTitle');
      var text = document.getElementById('statusText');
      if (title) title.textContent = '全新課務中心載入失敗';
      if (text) text.textContent = '請重新整理頁面後再試。';
    };
    document.body.appendChild(script);
  }

  async function start() {
    try { await removeEmptySnapshots(); }
    catch (error) { try { console.error('[fresh course center bootstrap]', error); } catch (_) {} }
    protectMirrorLoader();
    loadRuntime();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
