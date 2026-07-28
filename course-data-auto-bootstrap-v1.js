(function (global) {
  'use strict';

  var DB_NAME = 'youzi-course-scheduler';
  var STORE_NAME = 'formalSnapshots';
  var FORMAL_KEY = 'latest';
  var WORKSPACE_KEY = 'workspace';
  var AUTO_FUNCTION_NAME = 'loadInjiaoyunEducationMirrorAuto';
  var AUTHENTICATED_FUNCTION_NAME = 'loadInjiaoyunEducationMirror';
  var PIN_KEY = 'youzi.injiaoyun.preview.pin';
  var FETCH_LOCK_KEY = 'youzi.courseScheduler.autoRead.lock.v2';
  var RELOAD_KEY = 'youzi.courseScheduler.autoRead.reload.v2';
  var LOCK_TTL_MS = 45 * 1000;
  var WAIT_MS = 25 * 1000;
  var readyPromise = null;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function dateKey(value) {
    var date = value instanceof Date ? value : new Date(clean(value).slice(0, 10) + 'T12:00:00');
    if (!Number.isFinite(date.getTime())) return '';
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function hasRows(source, key) { return Boolean(source && Array.isArray(source[key]) && source[key].length); }

  function hasScheduleData(source) {
    return ['events', 'recurringRules', 'fixedCourses', 'temporaryCourses', 'roomRentals']
      .some(function (key) { return hasRows(source, key); });
  }

  function hasDirectoryData(source) {
    return hasRows(source, 'rooms') && (
      hasRows(source, 'students') ||
      hasRows(source, 'teachers') ||
      hasRows(source, 'roomRentals') ||
      hasRows(source, 'events')
    );
  }

  function meaningful(source) {
    if (!source || Number(source.version) !== 3) return false;
    return hasScheduleData(source) && hasDirectoryData(source);
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

  async function storeDatabase(formal, workspace) {
    var db = await openDatabase();
    if (!db) throw new Error('這個瀏覽器無法使用本機課務資料庫。');
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
    try {
      if (global.navigator && global.navigator.storage && typeof global.navigator.storage.persist === 'function') {
        global.navigator.storage.persist().catch(function () {});
      }
    } catch (_) {}
  }

  function currentAnchorDate() {
    var operations = global.OperationsCenterV1 && global.OperationsCenterV1.state || {};
    return dateKey(operations.overviewDate || operations.courseDate) || dateKey(new Date());
  }

  function formalFromState(state) {
    var formal = clone(state);
    formal.readOnly = true;
    formal.dataMode = 'migration';
    formal.clipboard = null;
    return formal;
  }

  function workspaceFromFormal(formal) {
    var workspace = clone(formal);
    workspace.readOnly = false;
    workspace.dataMode = 'sandbox';
    workspace.clipboard = null;
    workspace.sandboxMeta = Object.assign({}, workspace.sandboxMeta || {}, {
      createdAt: clean(workspace.sandboxMeta && workspace.sandboxMeta.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      baselineRunId: clean(formal.dataMeta && formal.dataMeta.runId) || clean(formal.runId) || '雲端已同步資料',
      baselineLoadedAt: clean(formal.dataMeta && formal.dataMeta.loadedAt) || clean(formal.loadedAt)
    });
    return workspace;
  }

  function pageKind() {
    var path = clean(global.location && global.location.pathname).toLowerCase();
    if (/course-scheduler\.html$/.test(path)) return 'scheduler';
    if (/operations-hub\.html$|portal\.html$/.test(path)) return 'operations';
    return '';
  }

  function installOverlayStyle() {
    if (document.getElementById('youziCourseAutoStyle')) return;
    var style = document.createElement('style');
    style.id = 'youziCourseAutoStyle';
    style.textContent = [
      '#youziCourseAutoOverlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:22px;background:rgba(238,245,242,.94);backdrop-filter:blur(7px)}',
      '#youziCourseAutoOverlay .box{width:min(460px,100%);padding:22px;border:1px solid #cbded7;border-radius:18px;background:#fff;box-shadow:0 18px 48px rgba(25,71,57,.15);color:#173f34;text-align:center}',
      '#youziCourseAutoOverlay .spinner{width:34px;height:34px;margin:0 auto 13px;border:4px solid #d4e8e0;border-right-color:#16845f;border-radius:50%;animation:youziCourseSpin .75s linear infinite}',
      '#youziCourseAutoOverlay strong{display:block;font-size:18px}',
      '#youziCourseAutoOverlay p{margin:8px 0 0;color:#657d75;font-size:13px;line-height:1.65;white-space:pre-line}',
      '#youziCourseAutoOverlay button{margin-top:15px;min-height:42px;padding:9px 18px;border:0;border-radius:11px;background:#16845f;color:#fff;font-weight:800}',
      '@keyframes youziCourseSpin{to{transform:rotate(360deg)}}'
    ].join('');
    document.head.appendChild(style);
  }

  function showOverlay(title, message, error) {
    if (!pageKind()) return null;
    installOverlayStyle();
    var node = document.getElementById('youziCourseAutoOverlay');
    if (!node) {
      node = document.createElement('div');
      node.id = 'youziCourseAutoOverlay';
      node.innerHTML = '<div class="box"><span class="spinner"></span><strong></strong><p></p><button type="button" hidden>重新讀取</button></div>';
      (document.body || document.documentElement).appendChild(node);
      node.querySelector('button').addEventListener('click', function () {
        try { global.sessionStorage.removeItem(RELOAD_KEY); } catch (_) {}
        global.location.reload();
      });
    }
    node.querySelector('strong').textContent = title;
    node.querySelector('p').textContent = message;
    node.querySelector('.spinner').style.display = error ? 'none' : '';
    node.querySelector('button').hidden = !error;
    return node;
  }

  function hideOverlay() {
    var node = document.getElementById('youziCourseAutoOverlay');
    if (node) node.remove();
  }

  function readLock() {
    try { return Number(global.localStorage.getItem(FETCH_LOCK_KEY) || 0); }
    catch (_) { return 0; }
  }
  function writeLock(value) {
    try {
      if (value) global.localStorage.setItem(FETCH_LOCK_KEY, String(value));
      else global.localStorage.removeItem(FETCH_LOCK_KEY);
    } catch (_) {}
  }

  function storedMigrationPin() {
    var value = '';
    try { value = clean(global.sessionStorage.getItem(PIN_KEY)); } catch (_) {}
    if (!value) {
      try { value = clean(global.localStorage.getItem(PIN_KEY)); } catch (_) {}
    }
    return value;
  }

  async function waitForOtherTab() {
    var started = Date.now();
    while (Date.now() - started < WAIT_MS) {
      await sleep(500);
      var rows = await readDatabase().catch(function () { return { formal: null, workspace: null }; });
      if (meaningful(rows.workspace) || meaningful(rows.formal)) return rows;
      if (Date.now() - readLock() > LOCK_TTL_MS) break;
    }
    return null;
  }

  function firebaseFunctions() {
    if (!global.firebase || typeof global.firebase.initializeApp !== 'function') throw new Error('Firebase 元件尚未載入。');
    var config = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if (!config || !config.projectId) throw new Error('找不到 Firebase 專案設定。');
    if (!global.firebase.apps.length) global.firebase.initializeApp(config);
    return global.firebase.app().functions('us-central1');
  }

  async function callCloudFunction(name, data) {
    var callable = firebaseFunctions().httpsCallable(name, { timeout: 300000 });
    var response = await callable(data || {});
    var payload = response && response.data || {};
    if (!payload.ok) throw new Error('雲端課務資料尚未完成。');
    return payload;
  }

  async function loadCloudPayload() {
    var automaticError = null;
    try {
      return await callCloudFunction(AUTO_FUNCTION_NAME, {
        source: pageKind() === 'operations' ? 'operations-hub' : 'course-scheduler'
      });
    } catch (error) {
      automaticError = error;
    }

    var pin = storedMigrationPin();
    if (pin) {
      try {
        return await callCloudFunction(AUTHENTICATED_FUNCTION_NAME, {
          source: 'course-scheduler',
          manualSyncPin: pin
        });
      } catch (fallbackError) {
        throw new Error(
          '自動課表讀取失敗：' + clean(automaticError && automaticError.message || automaticError) +
          '\n既有課表讀取也失敗：' + clean(fallbackError && fallbackError.message || fallbackError)
        );
      }
    }

    throw new Error(clean(automaticError && automaticError.message || automaticError) || '雲端課表讀取功能尚未完成。');
  }

  async function fetchCloudState(anchorDate) {
    if (!global.YouziCoursePreviewData || typeof global.YouziCoursePreviewData.buildState !== 'function') {
      throw new Error('課務資料轉換元件尚未載入。');
    }
    var payload = await loadCloudPayload();
    var state = global.YouziCoursePreviewData.buildState(payload, anchorDate || currentAnchorDate());
    if (!meaningful(state)) throw new Error('雲端已回傳資料，但沒有任何可顯示的課程事件。');
    return state;
  }

  async function ensureCourseData() {
    var rows = await readDatabase().catch(function () { return { formal: null, workspace: null }; });
    if (meaningful(rows.workspace)) {
      try { global.sessionStorage.removeItem(RELOAD_KEY); } catch (_) {}
      hideOverlay();
      return { snapshot: rows.workspace, source: 'workspace', fetched: false };
    }
    if (meaningful(rows.formal)) {
      var recoveredWorkspace = workspaceFromFormal(rows.formal);
      await storeDatabase(rows.formal, recoveredWorkspace);
      try { global.sessionStorage.removeItem(RELOAD_KEY); } catch (_) {}
      hideOverlay();
      return { snapshot: recoveredWorkspace, source: 'formal', fetched: false, recovered: true };
    }

    showOverlay('正在還原完整課表', '目前本機只有教室欄位或不完整資料。\n正在讀取雲端已同步好的課程，不會重新執行音教雲同步。', false);
    var lockTime = readLock();
    if (lockTime && Date.now() - lockTime < LOCK_TTL_MS) {
      var waited = await waitForOtherTab();
      if (waited && (meaningful(waited.workspace) || meaningful(waited.formal))) {
        global.location.reload();
        return { snapshot: waited.workspace || waited.formal, source: 'other-tab', fetched: false, reloading: true };
      }
    }

    writeLock(Date.now());
    try {
      var state = await fetchCloudState(currentAnchorDate());
      var formal = formalFromState(state);
      var workspace = workspaceFromFormal(formal);
      await storeDatabase(formal, workspace);
      var verified = await readDatabase();
      if (!meaningful(verified.workspace) && !meaningful(verified.formal)) {
        throw new Error('資料已取得，但這個瀏覽器沒有成功保存完整課務資料庫。');
      }
      global.dispatchEvent(new CustomEvent('youzi-course-auto-data-ready', { detail: { snapshot: workspace } }));
      var previousReload = 0;
      try { previousReload = Number(global.sessionStorage.getItem(RELOAD_KEY) || 0); } catch (_) {}
      if (!previousReload || Date.now() - previousReload > 20000) {
        try { global.sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch (_) {}
        global.location.reload();
        return { snapshot: workspace, source: 'cloud', fetched: true, reloading: true };
      }
      hideOverlay();
      return { snapshot: workspace, source: 'cloud', fetched: true };
    } catch (error) {
      showOverlay('完整課表讀取失敗', clean(error && error.message || error) || '請稍後重新讀取。', true);
      throw error;
    } finally {
      writeLock(0);
    }
  }

  function start() {
    if (!pageKind()) return Promise.resolve(null);
    if (!readyPromise) readyPromise = ensureCourseData();
    return readyPromise;
  }

  global.YouziCourseAutoData = {
    ensure: start,
    meaningful: meaningful,
    hasScheduleData: hasScheduleData,
    readDatabase: readDatabase
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      global.YouziCourseAutoDataReady = start();
    });
  } else {
    global.YouziCourseAutoDataReady = start();
  }
})(window);
