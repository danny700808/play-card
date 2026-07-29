(function (global) {
  'use strict';

  if (global.__YOUZI_LIVE_SCHEDULER_ENTRY_STARTED__) return;
  global.__YOUZI_LIVE_SCHEDULER_ENTRY_STARTED__ = true;

  var VERSION = '20260729-formal-data-flow-v2';
  var SCHEDULER_SRC = 'course-scheduler.js?v=' + VERSION;
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
    if (!db) return false;
    await new Promise(function (resolve, reject) {
      var transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(workspace, WORKSPACE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = function () { reject(transaction.error || new Error('IndexedDB write failed')); };
      transaction.onabort = function () { reject(transaction.error || new Error('IndexedDB write aborted')); };
    });
    db.close();
    return true;
  }

  function optimizedStudentRenderer() {
    return [
      '  function buildStudentListIndexes(){',
      '    var periodsByStudent=new Map(),latestByStudent=new Map(),dueByStudent=new Set(),nextByStudent=new Map();',
      '    state.tuitionPeriods.forEach(function(period){var rows=periodsByStudent.get(period.studentId)||[];rows.push(period);periodsByStudent.set(period.studentId,rows);if(periodBalance(period)>0)dueByStudent.add(period.studentId);var prior=latestByStudent.get(period.studentId),newer=!prior||clean(period.startDate).localeCompare(clean(prior.startDate))>0||(clean(period.startDate)===clean(prior.startDate)&&numberOf(period.periodNo)>numberOf(prior.periodNo));if(newer)latestByStudent.set(period.studentId,period);});',
      '    var today=todayKey(),end=shiftDate(today,180),overrides=new Map();',
      '    state.events.forEach(function(event){if(event.recurrenceKey)overrides.set(event.recurrenceKey,event);});',
      '    function consider(event){if(!event||!event.date||event.date<today||event.date>end||isHiddenEvent(event)||isNonOccupyingEvent(event))return;var key=event.date+" "+event.start;(event.studentIds||[]).forEach(function(studentId){var prior=nextByStudent.get(studentId),priorKey=prior&&(prior.date+" "+prior.start);if(!prior||key<priorKey)nextByStudent.set(studentId,event);});}',
      '    state.events.forEach(consider);',
      '    state.recurringRules.forEach(function(rule){if(!rule||rule.active===false||!rule.startDate)return;var step=Math.max(1,numberOf(rule.intervalWeeks)||1)*7,start=rule.startDate,date=start;if(date<today){var days=Math.floor((new Date(today+"T12:00:00")-new Date(start+"T12:00:00"))/86400000);date=shiftDate(start,Math.max(0,Math.ceil(days/step))*step);}var stop=rule.endDate&&rule.endDate<end?rule.endDate:end,guard=0;while(date<=stop&&guard<40){var override=overrides.get(recurrenceKey(rule.id,date));if(override){if(!isHiddenEvent(override)&&!isNonOccupyingEvent(override)){consider(override);break;}}else{consider(recurringOccurrence(rule,date));break;}date=shiftDate(date,step);guard++;}});',
      '    return {periodsByStudent:periodsByStudent,latestByStudent:latestByStudent,dueByStudent:dueByStudent,nextByStudent:nextByStudent};',
      '  }',
      '  function renderStudents(){',
      '    var indexes=buildStudentListIndexes(),search=clean($("studentSearch").value).toLowerCase(),filter=$("studentPaymentFilter").value;',
      '    var rows=state.students.filter(function(student){var periods=indexes.periodsByStudent.get(student.id)||[],hay=(student.name+" "+student.phone+" "+periods.map(function(row){return subjectById(row.subjectId).name;}).join(" ")).toLowerCase(),latest=indexes.latestByStudent.get(student.id)||{};if(search&&hay.indexOf(search)<0)return false;if(filter==="due"&&!indexes.dueByStudent.has(student.id))return false;if(filter==="low"&&!(latest.id&&periodRemaining(latest)<=1))return false;if(filter==="active"&&student.active===false)return false;return true;}).sort(bySort);',
      '    var low=state.students.reduce(function(count,student){var period=indexes.latestByStudent.get(student.id)||{};return count+(period.id&&periodRemaining(period)<=1?1:0);},0);',
      '    $("studentMetrics").innerHTML=metric("學生總數",state.students.length,"含停課資料")+metric("尚有未繳",indexes.dueByStudent.size,"依每一期付款加總")+metric("剩 1 堂以下",low,"建議準備下一期");',
      '    $("studentRows").innerHTML=rows.map(function(student){var period=indexes.latestByStudent.get(student.id)||{},event=indexes.nextByStudent.get(student.id)||{},subject=subjectById(period.subjectId),teacher=teacherById(period.teacherId);return "<tr><td><b>"+esc(student.name)+"</b><small>"+(student.active===false?"已停課":"上課中")+"</small></td><td>"+esc(student.phone||"未填")+"<small>LINE："+(student.line===true?"已綁定":student.line===false?"未綁定":"未確認")+"</small></td><td>"+esc(subject.name||"尚無學費期別")+"<small>"+esc(teacher.name||"未指定老師")+"</small></td><td>"+(period.id?"<b>"+period.usedCount+" / "+period.lessonCount+"</b><small>剩 "+periodRemaining(period)+" 堂</small>":"—")+"</td><td>"+(period.id?"<b>"+money(periodPaid(period))+" / "+money(period.expectedAmount-period.discount)+"</b><small>"+(periodBalance(period)?"尚欠 "+money(periodBalance(period)):"已繳清")+"</small>":"—")+"</td><td>"+(event.id?esc(event.date+" "+event.start):"尚未排課")+"</td><td><button class=\"btn small secondary\" data-student-id=\""+esc(student.id)+"\">查看學費紀錄</button></td></tr>";}).join("")||"<tr><td colspan=\"7\">沒有符合條件的學生。</td></tr>";',
      '  }'
    ].join('\n');
  }

  function patchSchedulerSource(source) {
    var original = source;
    source = source.replace(
      /  function loadInitialState\(\)\{\n    var cached=loadFormalCache\(\);/,
      "  function loadInitialState(){\n    var boot=window.__YOUZI_SCHEDULER_BOOTSTRAP_STATE__;\n    if(boot&&boot.version===3){var prepared=normalizeState(clone(boot));prepared.readOnly=false;prepared.dataMode='sandbox';return prepared;}\n    var cached=loadFormalCache();"
    );
    source = source.replace(
      /state=loadInitialState\(\);if\(!formalState&&state\.readOnly&&state\.dataMode!=='empty'\)formalState=clone\(state\);bindEvents\(\);refreshFormOptions\(\);updateModeUI\(\);switchView\(requestedView\(\)\);\n    restoreFormalDatabase\(\);/,
      "state=loadInitialState();if(!formalState&&state.readOnly&&state.dataMode!=='empty')formalState=clone(state);bindEvents();refreshFormOptions();updateModeUI();switchView(requestedView());\n    if(!window.__YOUZI_SCHEDULER_BOOTSTRAP_STATE__)restoreFormalDatabase();"
    );
    source = source.replace(
      /    var pin=storedMigrationPin\(\);[\s\S]*?    \}finally\{loadingMigration=false;updateModeUI\(\);\}\n  \}/,
      "    return false;\n  }"
    );
    source = source.replace(/  function renderStudents\(\)\{[\s\S]*?\n  function metric\(/, optimizedStudentRenderer() + '\n  function metric(');
    if (source === original || source.indexOf('buildStudentListIndexes') < 0) throw new Error('課表正式入口無法完成初始化。');
    return source;
  }

  function appendScript(source) {
    var blob = new Blob([source], { type: 'text/javascript' });
    var url = URL.createObjectURL(blob);
    var script = global.document.createElement('script');
    script.src = url;
    script.async = false;
    script.onload = function () { URL.revokeObjectURL(url); };
    script.onerror = function () { URL.revokeObjectURL(url); setStatus('完整課表載入失敗', '主程式執行失敗，請重新開啟。', true); };
    global.document.body.appendChild(script);
  }

  async function loadScheduler() {
    var response = await fetch(SCHEDULER_SRC, { cache: 'force-cache' });
    if (!response.ok) throw new Error('完整課表主程式下載失敗。');
    appendScript(patchSchedulerSource(await response.text()));
  }

  async function start() {
    try {
      setStatus('正在開啟完整課表', '正在讀取這台裝置保存的工作資料。', false);
      var saved = await readSavedData().catch(function () { return { workspace: null, latest: null }; });
      var workspace = meaningful(saved.workspace) ? makeWorkspace(saved.workspace) : null;
      if (!workspace && meaningful(saved.latest)) {
        workspace = makeWorkspace(saved.latest);
        await storeWorkspace(workspace);
      }
      if (workspace) global.__YOUZI_SCHEDULER_BOOTSTRAP_STATE__ = clone(workspace);
      else setStatus('尚未建立正式課務資料', '請按「更新音教雲最新資料」建立 latest 與 workspace；系統不會自行同步。', true);
      await loadScheduler();
    } catch (error) {
      setStatus('完整課表讀取失敗', clean(error && error.message || error) || '完整課表資料載入失敗', true);
      try { console.error('[formal course scheduler]', error); } catch (_) {}
    }
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
