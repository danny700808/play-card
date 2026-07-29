(function (global) {
  'use strict';

  if (global.__YOUZI_LIVE_SCHEDULER_ENTRY_STARTED__) return;
  global.__YOUZI_LIVE_SCHEDULER_ENTRY_STARTED__ = true;

  var SCHEDULER_SRC = 'course-scheduler.js?v=20260729-live-full-scheduler-v2';
  var CACHE_KEY = 'youzi.courseScheduler.formalCache.v1';
  var DB_NAME = 'youzi-course-scheduler';
  var STORE_NAME = 'formalSnapshots';
  var FORMAL_KEY = 'latest';
  var WORKSPACE_KEY = 'workspace';
  var CLOUD_FUNCTION = 'loadInjiaoyunEducationMirrorAuto';

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function pad(value) { return String(value).padStart(2, '0'); }
  function todayKey() {
    var date = new Date();
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
  function hasRows(source, key) { return Boolean(source && Array.isArray(source[key]) && source[key].length); }
  function meaningful(source) {
    if (!source || Number(source.version) !== 3) return false;
    var schedule = ['events', 'recurringRules', 'fixedCourses', 'temporaryCourses', 'roomRentals']
      .some(function (key) { return hasRows(source, key); });
    return schedule && hasRows(source, 'rooms');
  }

  function setStatus(title, message, error) {
    var titleNode = global.document.getElementById('dataModeTitle');
    var metaNode = global.document.getElementById('dataModeMeta');
    var chipNode = global.document.getElementById('dataModeChip');
    if (titleNode) titleNode.textContent = title;
    if (metaNode) metaNode.textContent = message;
    if (chipNode) chipNode.textContent = error ? '讀取失敗' : '正在載入';
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

  async function readDatabase() {
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
    return workspace;
  }

  function parentSnapshot(timeoutMs) {
    return new Promise(function (resolve) {
      if (!global.parent || global.parent === global) { resolve(null); return; }
      var finished = false;
      function done(value) {
        if (finished) return;
        finished = true;
        global.removeEventListener('message', onMessage);
        resolve(value || null);
      }
      function onMessage(event) {
        if (event.origin !== global.location.origin) return;
        var data = event.data || {};
        if (data.type === 'youzi-course-snapshot-response' && meaningful(data.snapshot)) done(data.snapshot);
      }
      global.addEventListener('message', onMessage);
      try { global.parent.postMessage({ type: 'youzi-course-snapshot-request' }, global.location.origin); } catch (_) {}
      global.setTimeout(function () { done(null); }, timeoutMs || 1000);
    });
  }

  function firebaseFunctions() {
    if (!global.firebase || typeof global.firebase.initializeApp !== 'function') throw new Error('Firebase 元件尚未載入。');
    var config = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if (!config || !config.projectId) throw new Error('找不到 Firebase 專案設定。');
    if (!global.firebase.apps.length) global.firebase.initializeApp(config);
    return global.firebase.app().functions('us-central1');
  }

  async function cloudSnapshot() {
    if (!global.YouziCoursePreviewData || typeof global.YouziCoursePreviewData.buildState !== 'function') {
      throw new Error('課務資料轉換元件尚未載入。');
    }
    var callable = firebaseFunctions().httpsCallable(CLOUD_FUNCTION, { timeout: 300000 });
    var response = await callable({ source: 'course-scheduler' });
    var payload = response && response.data || {};
    if (!payload.ok) throw new Error('雲端課務資料尚未完成。');
    var state = global.YouziCoursePreviewData.buildState(payload, todayKey());
    if (!meaningful(state)) throw new Error('雲端已回傳資料，但沒有可顯示的課程。');
    return state;
  }

  function loadScheduler() {
    if (global.__YOUZI_LIVE_SCHEDULER_SCRIPT_LOADED__) return;
    global.__YOUZI_LIVE_SCHEDULER_SCRIPT_LOADED__ = true;
    var script = global.document.createElement('script');
    script.src = SCHEDULER_SRC;
    script.async = false;
    script.onerror = function () { setStatus('完整課表載入失敗', '主程式載入失敗，請重新開啟。', true); };
    global.document.body.appendChild(script);
  }

  async function start() {
    try {
      setStatus('正在開啟完整課表', '正在取得營運總覽目前使用的課表資料。', false);
      var source = await parentSnapshot(1200);
      if (!meaningful(source)) source = await readDatabase().catch(function () { return null; });
      if (!meaningful(source)) {
        setStatus('正在開啟完整課表', '本機尚無完整資料，正在讀取雲端已同步課表；不會重新執行音教雲同步。', false);
        source = await cloudSnapshot();
      }
      await seedSnapshot(source);
      loadScheduler();
    } catch (error) {
      var message = clean(error && error.message || error) || '完整課表資料載入失敗';
      setStatus('完整課表讀取失敗', message, true);
      try { console.error('[live full scheduler]', error); } catch (_) {}
    }
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
