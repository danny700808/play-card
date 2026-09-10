(function (global) {
  'use strict';

  if (global.YouziOperationsCourseInline) return;

  var VERSION = '20260910-stopped-receivables-v4';
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
      '@media(min-width:1100px){.course-inline-body #calendarPage{font-family:"PMingLiU","新細明體","Noto Serif TC",serif;font-size:13px;line-height:1.2}.course-inline-body #calendarPage button,.course-inline-body #calendarPage input{font-family:inherit}.course-inline-body:has(#calendarPage.active) .cloud-refresh-bar{display:none!important}.course-inline-body .calendar-toolbar{padding:5px 8px;margin-bottom:5px}.course-inline-body .date-actions{gap:5px}.course-inline-body .date-heading strong{font-size:15px}.course-inline-body .date-heading span{font-size:11px}.course-inline-body #calendarPage .btn,.course-inline-body #calendarPage .control{padding:4px 8px;min-height:28px;font-size:13px}.course-inline-body .icon-btn{width:28px;height:28px;font-size:18px}.course-inline-body .kpi-grid{gap:6px;margin-bottom:5px}.course-inline-body .kpi{display:flex;align-items:baseline;gap:6px;padding:6px 8px;min-height:0}.course-inline-body .kpi span,.course-inline-body .kpi small{font-size:12px}.course-inline-body .kpi strong{font-size:16px;display:inline}.course-inline-body .legend{padding:5px 8px;margin-bottom:5px;gap:8px;font-size:11px}.course-inline-body .schedule-scroll{max-height:none;min-height:0}.course-inline-body .room-head,.course-inline-body .grid-corner{min-height:0;padding:3px;font-size:12px}.course-inline-body .room-head small{font-size:10px}.course-inline-body .time-label{min-height:0;padding:2px 4px;font-size:11px}.course-inline-body .time-label.hour{font-size:12px}.course-inline-body .event{min-height:0;padding:2px 4px;margin:1px 2px}.course-inline-body .event-top{font-size:10px;line-height:1.1}.course-inline-body .event-main{font-size:13px;line-height:1.1}.course-inline-body .event-sub{font-size:11px;line-height:1.1}.course-inline-body .schedule-card{margin-bottom:0}.course-inline-body .main-content{padding-bottom:8px}}',
      '@media(min-width:1100px){#calendarPage .calendar-toolbar{justify-content:flex-start;gap:8px;flex-wrap:nowrap}#calendarPage .date-actions{flex-wrap:nowrap;gap:4px;flex-shrink:0}#calendarPage .date-heading{min-width:0;margin-right:5px}#calendarPage #dailyKpis{display:flex;flex:1;gap:8px;margin:0;align-items:center;justify-content:flex-start}#calendarPage #dailyKpis.hidden{display:none}#calendarPage .kpi{border:0;box-shadow:none;background:transparent;padding:2px;gap:4px;flex-wrap:wrap;justify-content:flex-start}#calendarPage .kpi small{flex-basis:100%;font-size:11px}#calendarPage .kpi strong{font-size:15px}#calendarPage .legend{font-size:13px;font-weight:400;gap:10px;padding:6px 8px}#calendarPage .legend b,#calendarPage .legend span{font-weight:400;font-size:13px}#calendarPage .schedule-grid{width:100%;min-width:0}#calendarPage .schedule-grid>*{min-width:0}#calendarPage .room-head{overflow:hidden;overflow-wrap:anywhere}#calendarPage .week-toolbar{justify-content:flex-start;padding:7px 9px}#calendarPage .week-controls{justify-content:flex-start}#calendarPage #closeWeekBtn{display:none}#calendarPage .teacher-week-grid{min-width:0;grid-template-columns:48px repeat(7,minmax(0,1fr))}}',
      '.desktop-followup{display:none!important}@media(min-width:1100px){#calendarPage .desktop-followup{display:flex!important}#calendarPage .date-heading{text-align:center}#calendarPage #dailyKpis{gap:6px;min-width:0}#calendarPage .kpi{border:1px solid var(--line);border-radius:8px;background:#f8fbfa;padding:5px 7px;flex:1;min-width:0}#calendarPage .kpi span{font-size:12px}#calendarPage .kpi small{display:none}#calendarPage .kpi strong{font-size:15px}#calendarPage .teacher-week-empty{display:none}#calendarPage .week-days{min-height:0;max-height:none}#calendarPage .teacher-week-grid{grid-template-rows:36px;grid-auto-rows:var(--week-slot,32px)}#calendarPage .teacher-week-day-head time{order:-1;font-size:12px}#calendarPage .teacher-week-day-head b{font-size:12px;font-weight:400}#calendarPage .teacher-week-time{font-size:11px;padding:2px 4px}#calendarPage .week-event{padding:2px 4px;font-family:inherit}#calendarPage .week-event time{font-size:10px}#calendarPage .week-event b{font-size:13px}#calendarPage .week-event span{font-size:11px}#calendarPage .week-toolbar strong{font-size:15px}#calendarPage .week-toolbar>div:first-child{text-align:center}#calendarPage .week-controls select{font-family:inherit}#calendarPage .teacher-week-day-head{padding:3px}#calendarPage .week-event.fixed{background:var(--blue)}#calendarPage .week-event.single{background:var(--teal)}}',
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
      var heading = document.getElementById('opsPageTitle');
      var compactRefresh = document.getElementById('desktopCourseRefresh');
      if (heading && !compactRefresh) {
        compactRefresh = document.createElement('button');compactRefresh.id='desktopCourseRefresh';compactRefresh.textContent='重新整理';compactRefresh.type='button';compactRefresh.className='ops-button';
        heading.parentNode.appendChild(compactRefresh);
        compactRefresh.addEventListener('click',function(){var original=shadow.querySelector('#refreshCloudBtn');if(original)original.click();});
        var style=document.createElement('style');style.textContent='#desktopCourseRefresh{display:none}@media(min-width:1100px){#desktopCourseRefresh:not([hidden]){display:inline-block;padding:4px 10px;font:13px PMingLiU,serif;margin-left:12px}.ops-title-wrap:has(#desktopCourseRefresh:not([hidden])){display:flex;align-items:center}.ops-title-wrap:has(#desktopCourseRefresh:not([hidden])) h1{font:700 22px PMingLiU,serif}}';document.head.appendChild(style);
      }
      function fitDesktopCalendar(){
        var desktop=global.matchMedia('(min-width:1100px)').matches,calendar=global.location.hash==='#course-calendar';
        if(compactRefresh)compactRefresh.hidden=!desktop||!calendar;
        if(!inlineBody)return;
        var grid=shadow.querySelector('#scheduleGrid'),scroll=shadow.querySelector('#scheduleScroll');
        var kpis=shadow.querySelector('#dailyKpis'),toolbar=shadow.querySelector('.calendar-toolbar'),legend=shadow.querySelector('#dailyLegend');
        if(kpis&&toolbar&&legend){if(desktop){if(kpis.parentNode!==toolbar)toolbar.appendChild(kpis);}else if(kpis.parentNode===toolbar){legend.parentNode.insertBefore(kpis,legend);}}
        var weekButton=shadow.querySelector('#weekScheduleBtn');if(weekButton)weekButton.textContent=desktop&&weekButton.classList.contains('active')?'返回日表':'週課表';
        var weekGrid=shadow.querySelector('.teacher-week-grid'),weekScroll=shadow.querySelector('#weekScheduleDays');
        if(weekGrid&&weekScroll){if(desktop&&calendar){weekGrid.style.setProperty('--week-slot',Math.max(22,Math.floor((global.innerHeight-weekScroll.getBoundingClientRect().top-55)/(Number(weekGrid.dataset.slotCount)||17)))+'px');}else{weekGrid.style.removeProperty('--week-slot');}}
        if(!grid||!scroll)return;
        if(!desktop||!calendar){['--slot','--room-head-height','--room-col','--time-col'].forEach(function(key){grid.style.removeProperty(key);});return;}
        var count=Number(grid.dataset.slotCount)||17;
        var available=global.innerHeight-scroll.getBoundingClientRect().top-16;
        grid.style.setProperty('--slot',Math.max(22,Math.floor((available-36)/count))+'px');
        grid.style.setProperty('--room-head-height','36px');grid.style.setProperty('--time-col','48px');grid.style.setProperty('--room-col','minmax(0,1fr)');
      }
      global.addEventListener('resize',fitDesktopCalendar);global.addEventListener('hashchange',fitDesktopCalendar);
      global.addEventListener('youzi-calendar-layout',function(){global.requestAnimationFrame(fitDesktopCalendar);});
      fitDesktopCalendar();

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

  global.document.addEventListener('click', function (event) {
    var link=event.target.closest&&event.target.closest('#opsCourseSubmenu a[data-view]');
    if(!link)return;
    var map={'course-calendar':'calendar','course-students':'students','course-teachers':'teachers','course-settings':'settings'};
    var view=map[link.dataset.view];if(view)sendView(view);
  });

  global.YouziOperationsCourseInline = {
    mount: mount,
    detach: detach,
    show: sendView,
    version: VERSION
  };
})(window);
