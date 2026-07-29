(function (global) {
  'use strict';

  if (global.__YOUZI_LIVE_SCHEDULER_ENTRY_STARTED__) return;
  global.__YOUZI_LIVE_SCHEDULER_ENTRY_STARTED__ = true;

  var SCHEDULER_SRC = 'course-scheduler.js?v=20260729-live-full-scheduler-v1';
  var CACHE_KEY = 'youzi.courseScheduler.formalCache.v1';
  var DB_NAME = 'youzi-course-scheduler';
  var STORE_NAME = 'formalSnapshots';
  var FORMAL_KEY = 'latest';
  var WORKSPACE_KEY = 'workspace';

  function hasRows(source, key) {
    return Boolean(source && Array.isArray(source[key]) && source[key].length);
  }

  function meaningful(source) {
    if (!source || Number(source.version) !== 3) return false;
    var schedule = ['events', 'recurringRules', 'fixedCourses', 'temporaryCourses', 'roomRentals']
      .some(function (key) { return hasRows(source, key); });
    return schedule && hasRows(source, 'rooms');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
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

  async function seedSnapshot(source) {
    if (!meaningful(source)) return false;
    var workspace = clone(source);
    workspace.readOnly = false;
    workspace.dataMode = 'sandbox';
    workspace.clipboard = null;
    var formal = clone(source);
    formal.readOnly = true;
    formal.dataMode = 'migration';
    formal.clipboard = null;

    try { global.localStorage.setItem(CACHE_KEY, JSON.stringify(formal)); } catch (_) {}

    var db = await openDatabase();
    if (db) {
      await new Promise(function (resolve, reject) {
        var transaction = db.transaction(STORE_NAME, 'readwrite');
        var store = transaction.objectStore(STORE_NAME);
        store.put(formal, FORMAL_KEY);
        store.put(workspace, WORKSPACE_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB write failed')); };
        transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB write aborted')); };
      });
      db.close();
    }
    return true;
  }

  function showFailure(error) {
    var message = String(error && error.message || error || '完整課表資料載入失敗');
    var meta = global.document.getElementById('dataModeMeta');
    if (meta) meta.textContent = message;
    try { console.error('[live full scheduler]', error); } catch (_) {}
  }

  function loadScheduler() {
    if (global.__YOUZI_LIVE_SCHEDULER_SCRIPT_LOADED__) return;
    global.__YOUZI_LIVE_SCHEDULER_SCRIPT_LOADED__ = true;
    var script = global.document.createElement('script');
    script.src = SCHEDULER_SRC;
    script.async = false;
    script.onerror = function () { showFailure(new Error('完整課表主程式載入失敗')); };
    global.document.body.appendChild(script);
  }

  async function start() {
    var result = null;
    try {
      if (global.YouziCourseAutoDataReady && typeof global.YouziCourseAutoDataReady.then === 'function') {
        result = await global.YouziCourseAutoDataReady;
      } else if (global.YouziCourseAutoData && typeof global.YouziCourseAutoData.ensure === 'function') {
        result = await global.YouziCourseAutoData.ensure();
      }
      if (result && meaningful(result.snapshot)) await seedSnapshot(result.snapshot);
    } catch (error) {
      showFailure(error);
    }
    loadScheduler();
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
