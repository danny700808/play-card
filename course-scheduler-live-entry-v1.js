(function (global) {
  'use strict';

  if (global.__YOUZI_LIVE_SCHEDULER_ENTRY_STARTED__) return;
  global.__YOUZI_LIVE_SCHEDULER_ENTRY_STARTED__ = true;

  var SCHEDULER_SRC = 'course-scheduler.js?v=20260729-course-performance-v1';
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
  function runId(source) {
    return clean(source && source.dataMeta && source.dataMeta.runId);
  }
  function workspaceBaseline(source) {
    return clean(source && source.sandboxMeta && source.sandboxMeta.baselineRunId);
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
        var formalId = runId(formal);
        var workspaceCurrent = meaningful(workspace) && (
          !meaningful(formal) || !formalId || !workspaceBaseline(workspace) || workspaceBaseline(workspace) === formalId
        );
        resolve(workspaceCurrent ? workspace : (meaningful(formal) ? formal : null));
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
    if (!workspace.sandboxMeta.baselineRunId) workspace.sandboxMeta.baselineRunId = runId(source) || 'saved-course-data';
    if (!workspace.sandboxMeta.createdAt) workspace.sandboxMeta.createdAt = new Date().toISOString();
    workspace.sandboxMeta.updatedAt = workspace.sandboxMeta.updatedAt || workspace.sandboxMeta.createdAt;
    return workspace;
  }

  async function seedSnapshot(source) {
    if (!meaningful(source)) return false;
    var workspace = makeWorkspace(source);
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
      '    var started=Date.now(),indexes=buildStudentListIndexes(),search=clean($("studentSearch").value).toLowerCase(),filter=$("studentPaymentFilter").value;',
      '    var rows=state.students.filter(function(student){var periods=indexes.periodsByStudent.get(student.id)||[],hay=(student.name+" "+student.phone+" "+periods.map(function(row){return subjectById(row.subjectId).name;}).join(" ")).toLowerCase(),latest=indexes.latestByStudent.get(student.id)||{};if(search&&hay.indexOf(search)<0)return false;if(filter==="due"&&!indexes.dueByStudent.has(student.id))return false;if(filter==="low"&&!(latest.id&&periodRemaining(latest)<=1))return false;if(filter==="active"&&student.active===false)return false;return true;}).sort(bySort);',
      '    var low=state.students.reduce(function(count,student){var period=indexes.latestByStudent.get(student.id)||{};return count+(period.id&&periodRemaining(period)<=1?1:0);},0);',
      '    $("studentMetrics").innerHTML=metric("學生總數",state.students.length,"含停課資料")+metric("尚有未繳",indexes.dueByStudent.size,"依每一期付款加總")+metric("剩 1 堂以下",low,"建議準備下一期");',
      '    $("studentRows").innerHTML=rows.map(function(student){var period=indexes.latestByStudent.get(student.id)||{},event=indexes.nextByStudent.get(student.id)||{},subject=subjectById(period.subjectId),teacher=teacherById(period.teacherId);return "<tr><td><b>"+esc(student.name)+"</b><small>"+(student.active===false?"已停課":"上課中")+"</small></td><td>"+esc(student.phone||"未填")+"<small>LINE："+(student.line===true?"已綁定":student.line===false?"未綁定":"未確認")+"</small></td><td>"+esc(subject.name||"尚無學費期別")+"<small>"+esc(teacher.name||"未指定老師")+"</small></td><td>"+(period.id?"<b>"+period.usedCount+" / "+period.lessonCount+"</b><small>剩 "+periodRemaining(period)+" 堂</small>":"—")+"</td><td>"+(period.id?"<b>"+money(periodPaid(period))+" / "+money(period.expectedAmount-period.discount)+"</b><small>"+(periodBalance(period)?"尚欠 "+money(periodBalance(period)):"已繳清")+"</small>":"—")+"</td><td>"+(event.id?esc(event.date+" "+event.start):"尚未排課")+"</td><td><button class=\"btn small secondary\" data-student-id=\""+esc(student.id)+"\">查看學費紀錄</button></td></tr>";}).join("")||"<tr><td colspan=\"7\">沒有符合條件的學生。</td></tr>";',
      '    try{console.info("[course performance] students rendered",{students:rows.length,ms:Date.now()-started});}catch(_){}',
      '  }'
    ].join('\n');
  }

  function optimizedTeacherRenderer() {
    return [
      '  function renderTeachers(){',
      '    var started=Date.now(),search=clean($("teacherSearch").value).toLowerCase(),monthKey=state.currentDate.slice(0,7),payrollByTeacher=new Map(),adjustmentsByTeacher=new Map(),monthCount=0,totalPay=0;',
      '    (state.teacherPayroll||[]).forEach(function(row){if(row.date.slice(0,7)!==monthKey)return;monthCount++;var rows=payrollByTeacher.get(row.teacherId)||[];rows.push(row);payrollByTeacher.set(row.teacherId,rows);totalPay+=numberOf(row.teacherAmount);});',
      '    (state.teacherAdjustments||[]).forEach(function(row){if(row.date.slice(0,7)!==monthKey)return;var rows=adjustmentsByTeacher.get(row.teacherId)||[];rows.push(row);adjustmentsByTeacher.set(row.teacherId,rows);totalPay+=row.type==="deduction"?-numberOf(row.amount):numberOf(row.amount);});',
      '    var teachers=state.teachers.filter(function(row){var subjects=(row.subjectIds||[]).map(function(id){return subjectById(id).name;}).join(" ");return !search||(row.name+" "+row.phone+" "+subjects).toLowerCase().indexOf(search)>=0;}).sort(teacherSort);',
      '    $("teacherMetrics").innerHTML=metric("老師總數",state.teachers.length,"啟用 "+state.teachers.filter(function(row){return row.active!==false;}).length+" 位")+metric("本月完成課堂",monthCount,"只計實際簽到")+metric("本月老師薪資",money(totalPay),"含獎勵與扣薪");',
      '    $("teacherCards").innerHTML="<div class=\"teacher-list-head\"><span>老師／電話</span><span>主要教授科目</span><span>狀態</span><span>本月完成</span><span>本月薪資</span><span>操作</span></div>"+teachers.map(function(row){var completed=payrollByTeacher.get(row.id)||[],teacherAdjustments=adjustmentsByTeacher.get(row.id)||[],pay=sum(completed.map(function(item){return item.teacherAmount;}))+sum(teacherAdjustments.map(function(item){return item.type==="deduction"?-item.amount:item.amount;})),subjects=(row.subjectIds||[]).map(function(id){return subjectById(id);}).filter(function(subject){return subject.id&&subject.active!==false;}).sort(bySort),shown=subjects.slice(0,2).map(function(subject){return subject.name;}),more=subjects.length>2?" ＋"+(subjects.length-2):"";return "<article class=\"teacher-list-row"+(row.active===false?" inactive":"")+"\"><div><b>"+esc(row.name)+"</b><small>"+esc(row.phone||"未填電話")+"</small></div><div class=\"teacher-subject-summary\">"+esc(shown.join("、")||"尚未設定")+esc(more)+"</div><div><span class=\"tag "+(row.active===false?"gray":"green")+"\">"+(row.active===false?"停用":"啟用")+"</span></div><div><b>"+completed.length+" 堂</b></div><div><b>"+money(pay)+"</b></div><div class=\"teacher-list-actions\"><button class=\"btn small primary\" data-teacher-payroll=\""+row.id+"\">查看上課拆帳與薪資</button>"+(state.readOnly?"":"<button class=\"btn small outline\" data-teacher-id=\""+row.id+"\">編輯老師與科目</button>")+"</div></article>";}).join("");',
      '    try{console.info("[course performance] teachers rendered",{teachers:teachers.length,ms:Date.now()-started});}catch(_){}',
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
    source = source.replace(/  function renderStudents\(\)\{[\s\S]*?\n  function metric\(/, optimizedStudentRenderer() + '\n  function metric(');
    source = source.replace(/  function renderTeachers\(\)\{[\s\S]*?\n  function splitText\(/, optimizedTeacherRenderer() + '\n  function splitText(');
    if (source === original || source.indexOf('buildStudentListIndexes') < 0) {
      throw new Error('課表效能程式未能套用，已停止啟動以避免再次卡住。');
    }
    return source;
  }

  function appendScriptSource(source) {
    var blob = new Blob([source], { type: 'text/javascript' });
    var url = URL.createObjectURL(blob);
    var script = global.document.createElement('script');
    script.src = url;
    script.async = false;
    script.onload = function () { URL.revokeObjectURL(url); };
    script.onerror = function () {
      URL.revokeObjectURL(url);
      setStatus('完整課表載入失敗', '主程式執行失敗，請重新開啟。', true);
    };
    global.document.body.appendChild(script);
  }

  async function loadScheduler() {
    if (global.__YOUZI_LIVE_SCHEDULER_SCRIPT_LOADED__) return;
    global.__YOUZI_LIVE_SCHEDULER_SCRIPT_LOADED__ = true;
    var response = await fetch(SCHEDULER_SRC, { cache: 'force-cache' });
    if (!response.ok) throw new Error('完整課表主程式下載失敗。');
    var source = await response.text();
    appendScriptSource(patchSchedulerSource(source));
  }

  async function start() {
    try {
      var started = Date.now();
      setStatus('正在開啟完整課表', '正在讀取這台裝置已保存的可操作課表。', false);
      var source = await readDatabase().catch(function () { return null; });
      var workspace = meaningful(source) && source.dataMode === 'sandbox' && source.readOnly !== true ? makeWorkspace(source) : null;
      if (!meaningful(source)) {
        setStatus('正在開啟完整課表', '本機尚無完整資料，正在讀取雲端已同步課表；不會重新執行音教雲同步。', false);
        source = await cloudSnapshot();
      }
      if (!workspace) workspace = await seedSnapshot(source);
      global.__YOUZI_SCHEDULER_BOOTSTRAP_STATE__ = clone(workspace);
      await loadScheduler();
      try { console.info('[course performance] scheduler started', { ms: Date.now() - started }); } catch (_) {}
    } catch (error) {
      var message = clean(error && error.message || error) || '完整課表資料載入失敗';
      setStatus('完整課表讀取失敗', message, true);
      global.__YOUZI_LIVE_SCHEDULER_SCRIPT_LOADED__ = false;
      try { console.error('[live full scheduler]', error); } catch (_) {}
    }
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
