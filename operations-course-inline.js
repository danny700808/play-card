(function (global) {
  'use strict';

  if (global.YouziOperationsCourseInline) return;

  var VERSION = '20260729-operations-inline-course-v3';
  var TEMPLATE_URL = 'operations-course-inline-template.html?v=' + VERSION;
  var RUNTIME_URL = 'operations-course-inline-runtime.js?v=' + VERSION;
  var STYLE_URL = 'course-scheduler.css?v=' + VERSION;
  var DB_NAME = 'youzi-course-scheduler';
  var STORE_NAME = 'formalSnapshots';
  var WORKSPACE_KEY = 'workspace';
  var LATEST_KEY = 'latest';
  var CACHE_KEY = 'youzi.courseScheduler.formalCache.v1';
  var LEGACY_KEYS = [CACHE_KEY, 'youzi.courseScheduler.sandbox.v1'];
  var HASH_BY_VIEW = {
    calendar: 'course-calendar',
    students: 'course-students',
    teachers: 'course-teachers',
    settings: 'course-settings'
  };

  var host = null;
  var shadow = null;
  var inlineBody = null;
  var runtimeLoaded = false;
  var loadingPromise = null;
  var desiredView = 'calendar';

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

  async function writeDatabase(latest, workspace) {
    var db = await openDatabase();
    if (!db) return false;
    await new Promise(function (resolve, reject) {
      var transaction = db.transaction(STORE_NAME, 'readwrite');
      var store = transaction.objectStore(STORE_NAME);
      if (latest) store.put(latest, LATEST_KEY);
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
        var value = JSON.parse(global.localStorage.getItem(LEGACY_KEYS[index]) || 'null');
        if (hasRealContent(value)) return value;
      } catch (_) {}
    }
    return null;
  }


  async function resolveWorkspace() {
    var saved = await readDatabase().catch(function () { return { workspace: null, latest: null }; });
    if (hasRealContent(saved.workspace)) return makeWorkspace(saved.workspace);
    if (hasRealContent(saved.latest)) {
      var fromLatest = makeWorkspace(saved.latest);
      await writeDatabase(makeFormal(saved.latest), fromLatest);
      return fromLatest;
    }
    var legacy = readLegacyState();
    if (legacy) {
      var legacyWorkspace = makeWorkspace(legacy);
      await writeDatabase(makeFormal(legacy), legacyWorkspace);
      return legacyWorkspace;
    }
    return null;
  }

  function createDocumentFacade(root, body) {
    var real = global.document;
    return new Proxy(real, {
      get: function (target, property) {
        if (property === 'body') return body;
        if (property === 'readyState') return 'complete';
        if (property === 'getElementById') return function (id) { return root.querySelector('#' + global.CSS.escape(id)); };
        if (property === 'querySelector') return root.querySelector.bind(root);
        if (property === 'querySelectorAll') return root.querySelectorAll.bind(root);
        if (property === 'addEventListener') return real.addEventListener.bind(real);
        if (property === 'removeEventListener') return real.removeEventListener.bind(real);
        var value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  function showLoading(message) {
    if (!shadow) return;
    shadow.innerHTML = '<style>:host{display:block;min-height:520px}.inline-course-loading{min-height:520px;display:grid;place-items:center;border:1px solid #d6e0dc;border-radius:16px;background:#fff;color:#31544a;font:700 16px "Microsoft JhengHei",sans-serif}</style><div class="inline-course-loading">' + message + '</div>';
  }

  function inlineOverrides() {
    return [
      ':host{display:block;min-width:0;--ink:#162723;--muted:#5f716b;--line:#d3dfda;--line-strong:#b7c9c1;--page:#edf3f0;--card:#fff;--green:#18745b;--green-dark:#105743;--nav:#173a34;--nav-2:#102c28;--blue:#2574c5;--teal:#16816d;--pink:#bd3b70;--orange:#c97818;--red:#bd4741;--gray:#7b8884;--shadow:0 12px 32px rgba(18,53,45,.10);--radius:16px;--slot:48px}',
      '.course-inline-body{margin:0;background:var(--page);color:var(--ink);font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:17px;line-height:1.6;min-height:calc(100dvh - 110px)}',
      '.course-inline-body .app-shell{display:block;min-height:0}',
      '.course-inline-body .sidebar{display:none!important}',
      '.course-inline-body .main-content{grid-column:auto;min-width:0;padding:0 0 42px}',
      '.course-inline-body .page-header{display:none!important}',
      '.course-inline-body .sidebar-foot{display:none!important}',
      '.course-inline-body .schedule-scroll{max-height:calc(100dvh - 300px)}',
      '@media(max-width:860px){.course-inline-body{font-size:11px}.course-inline-body .main-content{padding:0 4px 20px}}'
    ].join('');
  }

  async function loadTemplate() {
    var response = await fetch(TEMPLATE_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error('完整課務畫面下載失敗');
    return response.text();
  }

  function loadRuntime() {
    return new Promise(function (resolve, reject) {
      if (runtimeLoaded) { resolve(); return; }
      var script = global.document.createElement('script');
      script.src = RUNTIME_URL;
      script.async = false;
      script.onload = function () { runtimeLoaded = true; resolve(); };
      script.onerror = function () { reject(new Error('完整課務程式載入失敗')); };
      global.document.body.appendChild(script);
    });
  }

  function sendView(view) {
    desiredView = HASH_BY_VIEW[view] ? view : 'calendar';
    global.__YOUZI_COURSE_INLINE_VIEW__ = desiredView;
    if (!runtimeLoaded) return;
    global.postMessage({ type: 'youzi-course-view', view: desiredView }, global.location.origin);
  }

  async function initialize() {
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async function () {
      showLoading('正在開啟完整課務功能…');
      var template = await loadTemplate();
      var workspace = await resolveWorkspace();
      shadow.innerHTML = '<link rel="stylesheet" href="' + STYLE_URL + '"><style>' + inlineOverrides() + '</style><div class="course-inline-body">' + template + '</div>';
      inlineBody = shadow.querySelector('.course-inline-body');
      global.__YOUZI_COURSE_INLINE_MODE__ = true;
      global.__YOUZI_COURSE_INLINE_VIEW__ = desiredView;
      global.__YOUZI_COURSE_INLINE_ROOT__ = shadow;
      global.__YOUZI_COURSE_INLINE_DOCUMENT__ = createDocumentFacade(shadow, inlineBody);
      global.__YOUZI_COURSE_INLINE_BOOTSTRAP_STATE__ = workspace ? clone(workspace) : null;
      if (workspace) {
        try { global.localStorage.setItem(CACHE_KEY, JSON.stringify(makeFormal(workspace))); } catch (_) {}
      } else {
        try { global.localStorage.removeItem(CACHE_KEY); } catch (_) {}
      }
      shadow.addEventListener('click', function (event) {
        var button = event.target.closest && event.target.closest('[data-view]');
        if (!button || !HASH_BY_VIEW[button.dataset.view]) return;
        var hash = '#' + HASH_BY_VIEW[button.dataset.view];
        if (global.location.hash !== hash) global.location.hash = hash;
      });
      await loadRuntime();
      sendView(desiredView);
    })().catch(function (error) {
      showLoading('課務功能載入失敗：' + clean(error && error.message || error));
      throw error;
    });
    return loadingPromise;
  }

  function ensureHost() {
    if (host) return host;
    host = global.document.createElement('div');
    host.id = 'opsCourseInlineShadowHost';
    host.style.display = 'block';
    host.style.width = '100%';
    host.style.minWidth = '0';
    shadow = host.attachShadow({ mode: 'open' });
    return host;
  }

  function mount(content, view) {
    desiredView = HASH_BY_VIEW[view] ? view : 'calendar';
    var node = ensureHost();
    if (node.parentNode !== content) {
      content.innerHTML = '';
      content.appendChild(node);
    }
    initialize().then(function () { sendView(desiredView); }).catch(function () {});
  }

  function detach() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }

  global.YouziOperationsCourseInline = {
    mount: mount,
    detach: detach,
    show: sendView,
    version: VERSION
  };
})(window);
