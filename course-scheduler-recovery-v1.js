(function (global) {
  'use strict';

  if (global.__YOUZI_COURSE_RECOVERY_STARTED__) return;
  global.__YOUZI_COURSE_RECOVERY_STARTED__ = true;

  var VERSION = '20260729-real-data-recovery-v1';
  var DB_NAME = 'youzi-course-scheduler';
  var STORE_NAME = 'formalSnapshots';
  var LATEST_KEY = 'latest';
  var WORKSPACE_KEY = 'workspace';
  var LEGACY_FORMAL_KEY = 'youzi.courseScheduler.formalCache.v1';
  var LEGACY_SANDBOX_KEY = 'youzi.courseScheduler.sandbox.v1';
  var PIN_KEY = 'youzi.injiaoyun.preview.pin';

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function hasRows(source, key) { return Boolean(source && Array.isArray(source[key]) && source[key].length); }
  function validState(source) {
    if (!source || Number(source.version) !== 3) return false;
    return ['rooms', 'students', 'teachers', 'subjects', 'feePlans', 'tuitionPeriods', 'events', 'recurringRules']
      .some(function (key) { return hasRows(source, key); });
  }
  function isDemoState(source) {
    var students = source && Array.isArray(source.students) ? source.students : [];
    if (!students.length) return false;
    var demoCount = students.filter(function (row) { return /^示範學生\s*[A-ZＡ-Ｚ]?$/i.test(clean(row && row.name)); }).length;
    return demoCount > 0 && demoCount === students.length;
  }
  function readJson(key) {
    try { return JSON.parse(global.localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }
  function savedPin() {
    try { return clean(global.localStorage.getItem(PIN_KEY)); } catch (_) { return ''; }
  }
  function makeWorkspace(source) {
    var workspace = clone(source);
    workspace.readOnly = false;
    workspace.dataMode = 'sandbox';
    workspace.clipboard = null;
    if (!workspace.sandboxMeta || typeof workspace.sandboxMeta !== 'object') workspace.sandboxMeta = {};
    workspace.sandboxMeta.baselineRunId = clean(source && source.dataMeta && source.dataMeta.runId) || workspace.sandboxMeta.baselineRunId || 'recovered';
    workspace.sandboxMeta.createdAt = workspace.sandboxMeta.createdAt || new Date().toISOString();
    workspace.sandboxMeta.updatedAt = new Date().toISOString();
    workspace.sandboxMeta.recoveredBy = VERSION;
    return workspace;
  }
  function makeLatest(source) {
    var latest = clone(source);
    latest.readOnly = true;
    latest.dataMode = 'migration';
    latest.clipboard = null;
    return latest;
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
  async function storeRecovered(source) {
    var db = await openDatabase();
    if (!db) throw new Error('這個瀏覽器無法保存課務資料。');
    var latest = makeLatest(source);
    var workspace = makeWorkspace(source);
    await new Promise(function (resolve, reject) {
      var transaction = db.transaction(STORE_NAME, 'readwrite');
      var store = transaction.objectStore(STORE_NAME);
      store.put(latest, LATEST_KEY);
      store.put(workspace, WORKSPACE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB write failed')); };
      transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB write aborted')); };
    });
    db.close();
    return workspace;
  }
  function status(message) {
    var node = global.document.getElementById('dataModeMeta');
    if (node) node.textContent = message;
  }
  function loadFormalEntry() {
    if (global.__YOUZI_FORMAL_ENTRY_TAG_ADDED__) return;
    global.__YOUZI_FORMAL_ENTRY_TAG_ADDED__ = true;
    var script = global.document.createElement('script');
    script.src = 'course-scheduler-live-entry-v1.js?v=' + VERSION;
    script.async = false;
    global.document.body.appendChild(script);
  }
  async function recover() {
    try {
      status('正在檢查正式 workspace、latest 與舊課務資料。');
      var saved = await readDatabase().catch(function () { return { workspace: null, latest: null }; });
      if (validState(saved.workspace) && !isDemoState(saved.workspace)) return 'workspace';
      if (validState(saved.latest) && !isDemoState(saved.latest)) {
        await storeRecovered(saved.latest);
        return 'latest';
      }

      var legacyFormal = readJson(LEGACY_FORMAL_KEY);
      var legacySandbox = readJson(LEGACY_SANDBOX_KEY);
      var legacy = validState(legacySandbox) && !isDemoState(legacySandbox) ? legacySandbox : legacyFormal;
      if (validState(legacy) && !isDemoState(legacy)) {
        await storeRecovered(legacy);
        return 'legacy-cache';
      }

      var pin = savedPin();
      if (pin && global.YouziCoursePreviewData && typeof global.YouziCoursePreviewData.load === 'function') {
        status('本機沒有完整課表，正在讀取音教雲已同步鏡像；不會執行重新同步。');
        var mirror = await global.YouziCoursePreviewData.load({ manualSyncPin: pin, anchorDate: new Date() });
        if (validState(mirror) && !isDemoState(mirror)) {
          await storeRecovered(mirror);
          return 'synced-mirror';
        }
      }
      return 'empty';
    } finally {
      loadFormalEntry();
    }
  }

  global.__YOUZI_COURSE_RECOVERY_READY__ = recover().catch(function (error) {
    try { console.error('[course recovery]', error); } catch (_) {}
    status('正式資料救援失敗：' + clean(error && error.message || error));
    return 'error';
  });
})(window);
