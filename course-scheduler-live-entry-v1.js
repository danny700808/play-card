(function (global) {
  'use strict';

  if (global.__YOUZI_LIVE_SCHEDULER_ENTRY_STARTED__) return;
  global.__YOUZI_LIVE_SCHEDULER_ENTRY_STARTED__ = true;

  var VERSION = '20260729-formal-build-v3';
  var SCHEDULER_SRC = 'course-scheduler-formal.js?v=' + VERSION;
  var DB_NAME = 'youzi-course-scheduler';
  var STORE_NAME = 'formalSnapshots';
  var LATEST_KEY = 'latest';
  var WORKSPACE_KEY = 'workspace';

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function hasRows(source, key) { return Boolean(source && Array.isArray(source[key]) && source[key].length); }
  function meaningful(source) {
    if (!source || Number(source.version) !== 3) return false;
    return hasRows(source, 'rooms') && ['events', 'recurringRules', 'fixedCourses', 'temporaryCourses', 'roomRentals']
      .some(function (key) { return hasRows(source, key); });
  }

  function setStatus(title, message, error) {
    var titleNode = global.document.getElementById('dataModeTitle');
    var metaNode = global.document.getElementById('dataModeMeta');
    var chipNode = global.document.getElementById('dataModeChip');
    if (titleNode) titleNode.textContent = title;
    if (metaNode) metaNode.textContent = message;
    if (chipNode) chipNode.textContent = error ? '尚未載入' : '正在載入';
  }

  function requestPersistentStorage() {
    try {
      if (global.navigator && global.navigator.storage && typeof global.navigator.storage.persist === 'function') {
        global.navigator.storage.persist().catch(function () {});
      }
    } catch (_) {}
  }

  function removeLegacyCaches() {
    try {
      [
        'youzi.courseScheduler.formalCache.v1',
        'youzi.courseScheduler.sandbox.v1',
        'youzi.courseScheduler.sandboxUndo.v1',
        'youzi.courseScheduler.lastMode.v1',
        'youzi.courseScheduler.autoRead.lock.v2',
        'youzi.courseScheduler.autoRead.reload.v2'
      ].forEach(function (key) { global.localStorage.removeItem(key); });
    } catch (_) {}
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

  async function readSavedData() {
    var db = await openDatabase();
    if (!db) return { workspace: null, latest: null };
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction(STORE_NAME, 'readonly');
      var store = transaction.objectStore(STORE_NAME);
      var workspaceRequest = store.get(WORKSPACE_KEY);
      var latestRequest = store.get(LATEST_KEY);
      transaction.oncomplete = function () {
        var result = { workspace: workspaceRequest.result || null, latest: latestRequest.result || null };
        db.close();
        resolve(result);
      };
      transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB read failed')); };
      transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB read aborted')); };
    });
  }

  function makeWorkspace(source) {
    var workspace = clone(source);
    workspace.readOnly = false;
    workspace.dataMode = 'sandbox';
    workspace.clipboard = null;
    if (!workspace.sandboxMeta || typeof workspace.sandboxMeta !== 'object') workspace.sandboxMeta = {};
    workspace.sandboxMeta.baselineRunId = clean(source && source.dataMeta && source.dataMeta.runId) || workspace.sandboxMeta.baselineRunId || 'latest';
    workspace.sandboxMeta.createdAt = workspace.sandboxMeta.createdAt || new Date().toISOString();
    workspace.sandboxMeta.updatedAt = workspace.sandboxMeta.updatedAt || workspace.sandboxMeta.createdAt;
    return workspace;
  }

  async function storeWorkspace(workspace) {
    var db = await openDatabase();
    if (!db) throw new Error('這個瀏覽器無法建立本機課務工作資料。');
    await new Promise(function (resolve, reject) {
      var transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(workspace, WORKSPACE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB write failed')); };
      transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB write aborted')); };
    });
    db.close();
  }

  function appendFormalScheduler() {
    return new Promise(function (resolve, reject) {
      if (global.__YOUZI_FORMAL_SCHEDULER_SCRIPT_LOADING__) { resolve(); return; }
      global.__YOUZI_FORMAL_SCHEDULER_SCRIPT_LOADING__ = true;
      var script = global.document.createElement('script');
      script.src = SCHEDULER_SRC;
      script.async = false;
      script.onload = resolve;
      script.onerror = function () {
        global.__YOUZI_FORMAL_SCHEDULER_SCRIPT_LOADING__ = false;
        reject(new Error('正式課表主程式下載失敗。'));
      };
      global.document.body.appendChild(script);
    });
  }

  async function start() {
    var startedAt = Date.now();
    try {
      requestPersistentStorage();
      removeLegacyCaches();
      setStatus('正在開啟正式課務', '正在讀取這台裝置保存的 workspace。', false);

      var saved = await readSavedData().catch(function () { return { workspace: null, latest: null }; });
      var workspace = meaningful(saved.workspace) ? makeWorkspace(saved.workspace) : null;
      var source = 'workspace';

      if (!workspace && meaningful(saved.latest)) {
        source = 'latest';
        workspace = makeWorkspace(saved.latest);
        await storeWorkspace(workspace);
      }

      if (workspace) {
        global.__YOUZI_SCHEDULER_BOOTSTRAP_STATE__ = clone(workspace);
        global.__YOUZI_SCHEDULER_BOOTSTRAP_SOURCE__ = source;
      } else {
        setStatus('尚未建立正式課務資料', '請按「更新音教雲最新資料」建立 latest 與 workspace；系統不會自行同步。', true);
      }

      await appendFormalScheduler();
      try {
        console.info('[formal course scheduler] started', {
          source: workspace ? source : 'empty',
          ms: Date.now() - startedAt
        });
      } catch (_) {}
    } catch (error) {
      setStatus('正式課務讀取失敗', clean(error && error.message || error) || '正式課務資料載入失敗', true);
      try { console.error('[formal course scheduler]', error); } catch (_) {}
    }
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
