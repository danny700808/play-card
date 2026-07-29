'use strict';

const fs = require('fs');

const sourceHtmlPath = 'course-scheduler.html';
const liveHtmlPath = 'course-scheduler-live.html';
const sourceSchedulerPath = 'course-scheduler.js';
const formalSchedulerPath = 'course-scheduler-formal.js';
const buildVersion = '20260729-formal-build-v3';
const routeVersion = '20260729-authoritative-course-v4';

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Unable to apply required build transform: ${label}`);
  return next;
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
    '        backupRequest.onsuccess=function(){',
    '          var previous=backupRequest.result;',
    '          if(previous&&previous.version===3){store.put({version:1,backedUpAt:new Date().toISOString(),baselineRunId:sandboxRunId(previous),state:clone(previous)},WORKSPACE_BACKUP_DB_KEY);}',
    '          store.put(formal,FORMAL_DB_KEY);',
    '          store.put(workspace,WORKSPACE_DB_KEY);',
    '        };',
    '        transaction.oncomplete=resolve;',
    '        transaction.onerror=function(){reject(transaction.error||new Error("IndexedDB synchronized write failed"));};',
    '        transaction.onabort=function(){reject(transaction.error||new Error("IndexedDB synchronized write aborted"));};',
    '      });',
    '      db.close();requestPersistentStorage();return true;',
    '    }catch(_){return false;}',
    '  }'
  ].join('\n');
}

let scheduler = fs.readFileSync(sourceSchedulerPath, 'utf8');
scheduler = replaceRequired(
  scheduler,
  "  'use strict';",
  `  'use strict';\n\n  window.__YOUZI_FORMAL_BUILD_VERSION__='${buildVersion}';`,
  'formal build version'
);
scheduler = replaceRequired(
  scheduler,
  "  var WORKSPACE_DB_KEY='workspace';",
  "  var WORKSPACE_DB_KEY='workspace';\n  var WORKSPACE_BACKUP_DB_KEY='workspaceBackup';",
  'workspace backup key'
);
scheduler = replaceRequired(
  scheduler,
  /  function loadInitialState\(\)\{\n    var cached=loadFormalCache\(\);\n    if\(cached\)return cached;/,
  "  function loadInitialState(){\n    var boot=window.__YOUZI_SCHEDULER_BOOTSTRAP_STATE__;\n    if(boot&&boot.version===3){var prepared=normalizeState(clone(boot));prepared.readOnly=false;prepared.dataMode='sandbox';return prepared;}",
  'workspace-only startup'
);
scheduler = replaceRequired(
  scheduler,
  /  async function storeSynchronizedDatabases\(formal,workspace\)\{[\s\S]*?\n  \}\n  function storeFormalCache/,
  synchronizedStoreWithBackup() + '\n  function storeFormalCache',
  'atomic latest workspace backup'
);
scheduler = replaceRequired(
  scheduler,
  /  function latestPeriod\(studentId\)\{[\s\S]*?\n  function metric\(/,
  optimizedStudentRenderer() + '\n  function metric(',
  'student list index'
);
scheduler = replaceRequired(
  scheduler,
  /  function renderTeachers\(\)\{[\s\S]*?\n  function splitText\(/,
  optimizedTeacherRenderer() + '\n\n  function splitText(',
  'teacher payroll index'
);
scheduler = replaceRequired(
  scheduler,
  /  async function restoreFormalDatabase\(\)\{[\s\S]*?\n  \}\n\n  async function loadMigrationFromMirror/,
  "  async function restoreFormalDatabase(){return false;}\n\n  async function loadMigrationFromMirror",
  'disable automatic cloud restore'
);
scheduler = replaceRequired(
  scheduler,
  '\n    restoreFormalDatabase();',
  '\n    // The formal entry already selected workspace/latest. Never auto-read cloud here.',
  'disable startup restore call'
);
scheduler = replaceRequired(
  scheduler,
  '更新後，新版目前測試中的課務、調課、簽到與款項紀錄會由舊音教雲最新資料覆蓋；教室排列與新版系統設定會保留。確定更新嗎？',
  '更新前會先備份目前 workspace，再以舊音教雲最新資料重建課務、調課、簽到與款項紀錄；教室排列與正式系統設定會保留。確定更新嗎？',
  'formal sync confirmation'
);

if (scheduler.includes('function nextEvent(studentId)')) throw new Error('Legacy per-student 180-day scan is still present.');
if (!scheduler.includes('buildStudentListIndexes')) throw new Error('Student performance index was not built.');
if (!scheduler.includes('payrollByTeacher=new Map()')) throw new Error('Teacher performance index was not built.');
if (!scheduler.includes("WORKSPACE_BACKUP_DB_KEY='workspaceBackup'")) throw new Error('Workspace backup was not built.');
fs.writeFileSync(formalSchedulerPath, scheduler);

let html = fs.readFileSync(sourceHtmlPath, 'utf8');
html = html.replace(/course-scheduler\.css\?v=[^"']+/g, `course-scheduler.css?v=${buildVersion}`);
const firstScript = html.indexOf('  <script src="config.js');
const bodyEnd = html.lastIndexOf('</body>');
if (firstScript < 0 || bodyEnd < 0 || firstScript >= bodyEnd) throw new Error('Unable to locate the scheduler script block.');
const scripts = `  <script src="config.js?v=20260722-course-scheduler-v2"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-functions-compat.js"></script>
  <script src="course-scheduler-data.js?v=${buildVersion}"></script>
  <script src="course-scheduler-live-entry-v1.js?v=${buildVersion}"></script>
`;
html = html.slice(0, firstScript) + scripts + html.slice(bodyEnd);
fs.writeFileSync(liveHtmlPath, html);

const legacyScripts = [
  'course-data-auto-bootstrap-v1.js',
  'operations-course-persistence-v1.js',
  'operations-course-simple-full-v1.js',
  'operations-course-snapshot-bridge-v1.js',
  'operations-course-live-route-v1.js'
];
for (const path of ['operations-hub.html', 'portal.html']) {
  let source = fs.readFileSync(path, 'utf8');
  for (const legacy of legacyScripts) {
    const escaped = legacy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    source = source.replace(new RegExp(`\\s*<script src="${escaped}\\?v=[^"]+"><\\/script>\\s*`, 'g'), '\n');
  }
  source = source.replace(
    /operations-course-authoritative-v1\.js\?v=[^"']+/g,
    `operations-course-authoritative-v1.js?v=${routeVersion}`
  );
  fs.writeFileSync(path, source);
}

console.log(`Built ${formalSchedulerPath}, ${liveHtmlPath}, and route ${routeVersion} with ${buildVersion}`);
