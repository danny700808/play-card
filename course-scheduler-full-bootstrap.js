(function (global) {
  'use strict';

  if (global.__YOUZI_FULL_COURSE_BOOTSTRAP_STARTED__) return;
  global.__YOUZI_FULL_COURSE_BOOTSTRAP_STARTED__ = true;

  var VERSION = '20260729-full-course-standalone-v1';
  var RUNTIME_SRC = 'course-scheduler.js?v=' + VERSION;
  var DB_NAME = 'youzi-course-scheduler';
  var STORE_NAME = 'formalSnapshots';
  var FORMAL_KEY = 'latest';
  var WORKSPACE_KEY = 'workspace';
  var CACHE_KEY = 'youzi.courseScheduler.formalCache.v1';
  var LEGACY_KEYS = [CACHE_KEY, 'youzi.courseScheduler.sandbox.v1'];
  var PIN_KEYS = [
    'youzi.injiaoyun.preview.pin',
    'youzi.injiaoyun.manualSyncPin.v1',
    'youzi.injiaoyun.sync.pin',
    'injiaoyunMigrationPin'
  ];

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function rows(source, key) { return source && Array.isArray(source[key]) ? source[key] : []; }

  function isDemo(source) {
    var count = rows(source, 'students').filter(function (student) {
      return /^示範學生\s*[A-F]$/i.test(clean(student && student.name));
    }).length;
    return count >= 2 && !clean(source && source.dataMeta && source.dataMeta.runId);
  }

  function hasRealContent(source) {
    if (!source || Number(source.version) !== 3 || isDemo(source)) return false;
    if (!rows(source, 'rooms').length) return false;
    return [
      'students', 'teachers', 'events', 'recurringRules', 'fixedCourses',
      'temporaryCourses', 'tuitionPeriods', 'teacherPayroll', 'roomRentals'
    ].some(function (key) { return rows(source, key).length > 0; });
  }

  function makeFormal(source) {
    var formal = clone(source);
    formal.version = 3;
    formal.readOnly = true;
    formal.dataMode = 'migration';
    formal.clipboard = null;
    return formal;
  }

  function makeWorkspace(source) {
    var workspace = clone(source);
    workspace.version = 3;
    workspace.readOnly = false;
    workspace.dataMode = 'sandbox';
    workspace.clipboard = null;
    if (!workspace.sandboxMeta || typeof workspace.sandboxMeta !== 'object') workspace.sandboxMeta = {};
    workspace.sandboxMeta.baselineRunId = clean(source && source.dataMeta && source.dataMeta.runId) || clean(workspace.sandboxMeta.baselineRunId) || 'latest';
    workspace.sandboxMeta.createdAt = clean(workspace.sandboxMeta.createdAt) || new Date().toISOString();
    workspace.sandboxMeta.updatedAt = new Date().toISOString();
    return workspace;
  }

  function setStatus(title, description, meta, error) {
    var panel = document.getElementById('dataModePanel');
    var titleNode = document.getElementById('dataModeTitle');
    var descriptionNode = document.getElementById('dataModeDescription');
    var metaNode = document.getElementById('dataModeMeta');
    var chip = document.getElementById('dataModeChip');
    if (titleNode) titleNode.textContent = title;
    if (descriptionNode) descriptionNode.textContent = description;
    if (metaNode) metaNode.textContent = meta;
    if (chip) chip.textContent = error ? '尚未載入' : '自動儲存';
    if (panel) panel.classList.toggle('error', Boolean(error));
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

  async function readDatabase() {
    var db = await openDatabase();
    if (!db) return { formal: null, workspace: null };
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction(STORE_NAME, 'readonly');
      var store = transaction.objectStore(STORE_NAME);
      var formalRequest = store.get(FORMAL_KEY);
      var workspaceRequest = store.get(WORKSPACE_KEY);
      transaction.oncomplete = function () {
        var result = { formal: formalRequest.result || null, workspace: workspaceRequest.result || null };
        db.close();
        resolve(result);
      };
      transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB read failed')); };
      transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB read aborted')); };
    });
  }

  async function writeDatabase(formal, workspace) {
    var db = await openDatabase();
    if (!db) return false;
    await new Promise(function (resolve, reject) {
      var transaction = db.transaction(STORE_NAME, 'readwrite');
      var store = transaction.objectStore(STORE_NAME);
      if (formal) store.put(formal, FORMAL_KEY);
      if (workspace) store.put(workspace, WORKSPACE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB write failed')); };
      transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB write aborted')); };
    });
    db.close();
    return true;
  }

  function readLegacyState() {
    for (var index = 0; index < LEGACY_KEYS.length; index += 1) {
      try {
        var parsed = JSON.parse(global.localStorage.getItem(LEGACY_KEYS[index]) || 'null');
        if (hasRealContent(parsed)) return parsed;
      } catch (_) {}
    }
    return null;
  }

  function readStoredPin() {
    for (var index = 0; index < PIN_KEYS.length; index += 1) {
      try {
        var pin = clean(global.localStorage.getItem(PIN_KEYS[index]));
        if (pin) return pin;
      } catch (_) {}
    }
    return '';
  }

  async function readSavedMirror(pin) {
    if (!pin || !global.YouziCoursePreviewData || typeof global.YouziCoursePreviewData.load !== 'function') return null;
    setStatus('正在讀取已同步課務資料', '只讀取上次成功保存的音教雲鏡像，不會重新執行同步。', '完成後會建立 latest 與 workspace。', false);
    var loaded = await global.YouziCoursePreviewData.load({ manualSyncPin: pin, anchorDate: new Date().toISOString().slice(0, 10) });
    return hasRealContent(loaded) ? loaded : null;
  }

  function seedFormalCache(formal) {
    try { global.localStorage.setItem(CACHE_KEY, JSON.stringify(formal)); return true; }
    catch (_) { return false; }
  }

  async function resolveData() {
    var saved = await readDatabase().catch(function () { return { formal: null, workspace: null }; });
    if (hasRealContent(saved.workspace)) {
      var workspaceFormal = hasRealContent(saved.formal) ? makeFormal(saved.formal) : makeFormal(saved.workspace);
      if (!hasRealContent(saved.formal)) await writeDatabase(workspaceFormal, saved.workspace);
      return { formal: workspaceFormal, workspace: makeWorkspace(saved.workspace), source: 'workspace' };
    }
    if (hasRealContent(saved.formal)) {
      var formalWorkspace = makeWorkspace(saved.formal);
      await writeDatabase(makeFormal(saved.formal), formalWorkspace);
      return { formal: makeFormal(saved.formal), workspace: formalWorkspace, source: 'latest' };
    }

    var legacy = readLegacyState();
    if (hasRealContent(legacy)) {
      var legacyFormal = makeFormal(legacy);
      var legacyWorkspace = makeWorkspace(legacy);
      await writeDatabase(legacyFormal, legacyWorkspace);
      return { formal: legacyFormal, workspace: legacyWorkspace, source: '舊正式資料' };
    }

    var pin = readStoredPin();
    if (pin) {
      try {
        var mirror = await readSavedMirror(pin);
        if (mirror) {
          var mirrorFormal = makeFormal(mirror);
          var mirrorWorkspace = makeWorkspace(mirror);
          await writeDatabase(mirrorFormal, mirrorWorkspace);
          return { formal: mirrorFormal, workspace: mirrorWorkspace, source: '已同步鏡像' };
        }
      } catch (error) {
        try { console.error('[full course bootstrap mirror]', error); } catch (_) {}
      }
    }
    return null;
  }

  function loadRuntime() {
    var script = document.createElement('script');
    script.src = RUNTIME_SRC;
    script.async = false;
    script.onerror = function () {
      setStatus('完整課務程式載入失敗', '功能主程式沒有成功開啟。', '請重新整理頁面。', true);
    };
    document.body.appendChild(script);
  }

  async function start() {
    setStatus('正在開啟完整課務系統', '優先讀取這台裝置保存的 workspace。', '不會自動重新同步音教雲。', false);
    var resolved = await resolveData();
    if (resolved) {
      seedFormalCache(resolved.formal);
      global.__YOUZI_FULL_COURSE_BOOTSTRAP_SOURCE__ = resolved.source;
      setStatus('正式課務資料已保存', '目前直接使用上次保存的工作資料；需要舊音教雲最新內容時才按更新。', '資料來源：' + resolved.source, false);
    } else {
      try { global.localStorage.removeItem(CACHE_KEY); } catch (_) {}
      setStatus('尚未建立正式課務資料', '請按右側「更新音教雲最新資料」建立 latest 與 workspace。', '系統不會載入示範學生。', true);
    }
    loadRuntime();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
