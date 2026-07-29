(function (global) {
  'use strict';

  if (global.__YOUZI_LIVE_SCHEDULER_ENTRY_STARTED__) return;
  global.__YOUZI_LIVE_SCHEDULER_ENTRY_STARTED__ = true;

  var VERSION = '20260729-formal-runtime-v4';
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

  function synchronizedStoreWithBackup() {
    return [
      '  async function storeSynchronizedDatabases(formal,workspace){',
      '    try{',
      '      var db=await openFormalDatabase();',
      '      await new Promise(function(resolve,reject){',
      '        var transaction=db.transaction(FORMAL_DB_STORE,"readwrite"),store=transaction.objectStore(FORMAL_DB_STORE);',
      '        var backupRequest=store.get(WORKSPACE_DB_KEY);',
      '        backupRequest.onsuccess=function(){var previous=backupRequest.result;if(previous&&previous.version===3){store.put({version:1,backedUpAt:new Date().toISOString(),baselineRunId:sandboxRunId(previous),state:clone(previous)},WORKSPACE_BACKUP_DB_KEY);}store.put(formal,FORMAL_DB_KEY);store.put(workspace,WORKSPACE_DB_KEY);};',
      '        transaction.oncomplete=resolve;',
      '        transaction.onerror=function(){reject(transaction.error||new Error("IndexedDB synchronized write failed"));};',
      '        transaction.onabort=function(){reject(transaction.error||new Error("IndexedDB synchronized write aborted"));};',
      '      });',
      '      db.close();requestPersistentStorage();return true;',
      '    }catch(_){return false;}',
      '  }'
    ].join('\n');
  }

  function replaceRequired(source, pattern, replacement, label) {
    var next = source.replace(pattern, replacement);
    if (next === source) throw new Error('正式課表初始化失敗：' + label);
    return next;
  }

  function patchSchedulerSource(source) {
    source = replaceRequired(source, "  var WORKSPACE_DB_KEY='workspace';", "  var WORKSPACE_DB_KEY='workspace';\n  var WORKSPACE_BACKUP_DB_KEY='workspaceBackup';", '備份資料鍵');
    source = replaceRequired(
      source,
      /  function loadInitialState\(\)\{\n    var cached=loadFormalCache\(\);\n    if\(cached\)return cached;/,
      "  function loadInitialState(){\n    var boot=window.__YOUZI_SCHEDULER_BOOTSTRAP_STATE__;\n    if(boot&&boot.version===3){var prepared=normalizeState(clone(boot));prepared.readOnly=false;prepared.dataMode='sandbox';return prepared;}",
      'workspace 啟動'
    );
    source = replaceRequired(
      source,
      /  async function storeSynchronizedDatabases\(formal,workspace\)\{[\s\S]*?\n  \}\n  function storeFormalCache/,
      synchronizedStoreWithBackup() + '\n  function storeFormalCache',
      '同步前備份'
    );
    source = replaceRequired(
      source,
      /  function latestPeriod\(studentId\)\{[\s\S]*?\n  function metric\(/,
      optimizedStudentRenderer() + '\n  function metric(',
      '學生索引'
    );
    source = replaceRequired(
      source,
      /  function renderTeachers\(\)\{[\s\S]*?\n  function splitText\(/,
      optimizedTeacherRenderer() + '\n\n  function splitText(',
      '老師薪資索引'
    );
    source = replaceRequired(
      source,
      /  async function restoreFormalDatabase\(\)\{[\s\S]*?\n  \}\n\n  async function loadMigrationFromMirror/,
      "  async function restoreFormalDatabase(){return false;}\n\n  async function loadMigrationFromMirror",
      '停用自動雲端還原'
    );
    source = replaceRequired(source, '\n    restoreFormalDatabase();', '\n    // workspace/latest 已由正式入口選定，不執行自動雲端讀取。', '停用啟動同步');
    source = replaceRequired(
      source,
      '更新後，新版目前測試中的課務、調課、簽到與款項紀錄會由舊音教雲最新資料覆蓋；教室排列與新版系統設定會保留。確定更新嗎？',
      '更新前會先備份目前 workspace，再以舊音教雲最新資料重建課務、調課、簽到與款項紀錄；教室排列與正式系統設定會保留。確定更新嗎？',
      '正式同步說明'
    );
    if (source.indexOf('function nextEvent(studentId)') >= 0) throw new Error('舊學生逐日掃描仍存在。');
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
      setStatus('正式課表載入失敗', '主程式執行失敗，請重新開啟。', true);
    };
    global.document.body.appendChild(script);
  }

  async function loadScheduler() {
    if (global.__YOUZI_LIVE_SCHEDULER_SCRIPT_LOADED__) return;
    global.__YOUZI_LIVE_SCHEDULER_SCRIPT_LOADED__ = true;
    var response = await fetch(SCHEDULER_SRC, { cache: 'no-cache' });
    if (!response.ok) throw new Error('正式課表主程式下載失敗。');
    appendScriptSource(patchSchedulerSource(await response.text()));
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
      await loadScheduler();
      try { console.info('[formal course scheduler] started', { source: workspace ? source : 'empty', ms: Date.now() - startedAt }); } catch (_) {}
    } catch (error) {
      global.__YOUZI_LIVE_SCHEDULER_SCRIPT_LOADED__ = false;
      setStatus('正式課務讀取失敗', clean(error && error.message || error) || '正式課務資料載入失敗', true);
      try { console.error('[formal course scheduler]', error); } catch (_) {}
    }
  }

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
