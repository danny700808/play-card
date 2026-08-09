'use strict';

const fs = require('fs');

const VERSION = '20260809-subject-fee-separate-v3';
const schedulerHtmlPath = 'course-scheduler.html';
const schedulerJsPath = 'course-scheduler.js';
const operationsPath = 'operations-phase1.js';
const controllerPath = 'operations-course-inline.js';
const portalPaths = ['portal.html', 'operations-hub.html'];

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Unable to apply required inline-course transform: ${label}`);
  return next;
}

function buildTemplate() {
  const html = fs.readFileSync(schedulerHtmlPath, 'utf8');
  const main = html.match(/<main class="main-content">([\s\S]*?)<\/main>/);
  if (!main) {
    const existingTemplate = fs.readFileSync('operations-course-inline-template.html', 'utf8');
    const requiredIds = ['dataModePanel', 'syncInjiaoyunBtn', 'calendarPage', 'studentsPage', 'teachersPage', 'teacherListMonth', 'teacherListMonthPrev', 'teacherListMonthNext', 'teacherListMonthCurrent', 'settingsPage'];
    for (const id of requiredIds) {
      if (!existingTemplate.includes(`id="${id}"`)) throw new Error(`Existing inline course template is incomplete: ${id}`);
    }
    return;
  }
  const extrasStart = html.indexOf('  <div class="modal-backdrop"');
  const scriptsStart = html.indexOf('  <script src="config.js');
  if (extrasStart < 0 || scriptsStart < 0 || extrasStart >= scriptsStart) {
    throw new Error('Unable to locate the full course modal collection.');
  }
  const extras = html.slice(extrasStart, scriptsStart).trim();
  const template = `<div class="app-shell"><main class="main-content">${main[1]}</main></div>\n${extras}\n`;
  fs.writeFileSync('operations-course-inline-template.html', template);
}

function buildRuntime() {
  const existing = fs.existsSync('operations-course-inline-runtime.js')
    ? fs.readFileSync('operations-course-inline-runtime.js', 'utf8')
    : '';
  const existingIsScoped = existing.includes('window.__YOUZI_COURSE_INLINE_DOCUMENT__')
    && existing.includes('window.__YOUZI_COURSE_INLINE_BOOTSTRAP_STATE__');
  if (existingIsScoped) {
    const requiredMarkers = [
      'function studentPageIndex()',
      'function teacherListMonthKey()',
      'function refreshTeacherPayrollMonth(monthKey)',
      'function periodNetExpectedAmount(period)',
      'money(periodNetExpectedAmount(period))',
      'refreshPortalRentals();'
    ];
    for (const marker of requiredMarkers) {
      if (!existing.includes(marker)) throw new Error(`Existing inline course runtime is incomplete: ${marker}`);
    }
    if (existing.includes('money(period.expectedAmount-period.discount)')) {
      throw new Error('Existing inline course runtime still contains the ratio-discount regression.');
    }
    if (existing.includes('restoreFormalDatabase().then(refreshPortalRentals)')) {
      throw new Error('Existing inline course runtime still performs the duplicate startup restore.');
    }
    return;
  }

  let source = fs.readFileSync(schedulerJsPath, 'utf8');
  source = replaceRequired(
    source,
    "(function(){\n  'use strict';",
    "(function(){\n  'use strict';\n\n  var document=window.__YOUZI_COURSE_INLINE_DOCUMENT__||window.document;",
    'shadow document facade'
  );
  source = replaceRequired(
    source,
    "  function requestedView(){var view=urlOption('view');return ['calendar','students','teachers','settings'].indexOf(view)>=0?view:'calendar';}",
    "  function requestedView(){var view=clean(window.__YOUZI_COURSE_INLINE_VIEW__)||urlOption('view');return ['calendar','students','teachers','settings'].indexOf(view)>=0?view:'calendar';}",
    'inline view selection'
  );
  source = replaceRequired(
    source,
    "  function loadInitialState(){\n    var cached=loadFormalCache();\n    if(cached)return cached;",
    "  function loadInitialState(){\n    var inlineState=window.__YOUZI_COURSE_INLINE_BOOTSTRAP_STATE__;\n    if(inlineState&&inlineState.version===3){var prepared=normalizeState(clone(inlineState));prepared.readOnly=false;prepared.dataMode='sandbox';return prepared;}\n    var cached=loadFormalCache();\n    if(cached)return cached;",
    'workspace-first inline startup'
  );
  source = replaceRequired(
    source,
    "    embeddedMode=urlOption('embed')==='1';document.body.classList.toggle('embedded-in-operations',embeddedMode);requestPersistentStorage();",
    "    embeddedMode=window.__YOUZI_COURSE_INLINE_MODE__===true||urlOption('embed')==='1';document.body.classList.toggle('embedded-in-operations',embeddedMode);requestPersistentStorage();",
    'inline embedded mode'
  );
  source = replaceRequired(
    source,
    "    $('sideModeBadge').textContent=empty?'資料尚未載入':'正式資料已保存';",
    "    if($('sideModeBadge'))$('sideModeBadge').textContent=empty?'資料尚未載入':'正式資料已保存';",
    'optional removed sidebar status badge'
  );
  source = replaceRequired(
    source,
    "    ['topNewEvent','sideNewEvent','calendarNewEvent'].forEach(function(id){$(id).addEventListener('click',function(){openSchedule({date:state.currentDate});});});",
    "    ['topNewEvent','sideNewEvent','calendarNewEvent'].forEach(function(id){var node=$(id);if(node)node.addEventListener('click',function(){openSchedule({date:state.currentDate});});});",
    'optional removed sidebar quick-add button'
  );

  const studentRenderer = /  function latestPeriod\(studentId\)\{[\s\S]*?  function metric\(label,value,small\)\{/;
  if (!studentRenderer.test(source)) throw new Error('Unable to locate the original student renderer.');
  source = source.replace(studentRenderer, `  function latestPeriod(studentId){return state.tuitionPeriods.filter(function(row){return row.studentId===studentId;}).sort(function(a,b){return clean(b.startDate).localeCompare(clean(a.startDate))||numberOf(b.periodNo)-numberOf(a.periodNo);})[0]||{};}
  function studentPageIndex(){
    var meta=state.sandboxMeta||{},dataMeta=state.dataMeta||{},today=todayKey();
    var key=[today,state.students.length,state.tuitionPeriods.length,state.events.length,state.recurringRules.length,state.attendance.length,clean(meta.updatedAt),clean(dataMeta.runId)].join('|');
    if(studentPageIndex.cache&&studentPageIndex.key===key)return studentPageIndex.cache;
    var periodsByStudent=new Map(),latestByStudent=new Map(),dueByStudent=new Set(),lowByStudent=new Set();
    state.tuitionPeriods.forEach(function(period){
      var studentId=clean(period.studentId),list=periodsByStudent.get(studentId)||[];list.push(period);periodsByStudent.set(studentId,list);
      if(periodBalance(period)>0)dueByStudent.add(studentId);
      var prior=latestByStudent.get(studentId),newer=!prior||clean(period.startDate).localeCompare(clean(prior.startDate))>0||(clean(period.startDate)===clean(prior.startDate)&&numberOf(period.periodNo)>numberOf(prior.periodNo));
      if(newer)latestByStudent.set(studentId,period);
    });
    latestByStudent.forEach(function(period,studentId){if(period.id&&periodRemaining(period)<=1)lowByStudent.add(studentId);});
    var subjectMap=new Map(state.subjects.map(function(row){return [row.id,row];})),teacherMap=new Map(state.teachers.map(function(row){return [row.id,row];}));
    var scheduledStudentIds=new Set(),end=shiftDate(today,180);
    state.events.forEach(function(event){var date=dateKey(event.date);if(date<today||date>end||isHiddenEvent(event)||isNonOccupyingEvent(event))return;(event.studentIds||[]).forEach(function(id){scheduledStudentIds.add(id);});});
    state.recurringRules.forEach(function(rule){if(rule.active===false||(rule.endDate&&rule.endDate<today))return;(rule.studentIds||[]).forEach(function(id){scheduledStudentIds.add(id);});});
    var nextByStudent=new Map();
    for(var offset=0;offset<=180&&nextByStudent.size<scheduledStudentIds.size;offset++){
      effectiveEventsForDate(shiftDate(today,offset)).forEach(function(event){
        if(isHiddenEvent(event)||isNonOccupyingEvent(event))return;
        (event.studentIds||[]).forEach(function(id){if(!nextByStudent.has(id))nextByStudent.set(id,event);});
      });
    }
    var rows=state.students.map(function(student){
      var periods=periodsByStudent.get(student.id)||[],latest=latestByStudent.get(student.id)||{},subject=subjectMap.get(latest.subjectId)||{},teacher=teacherMap.get(latest.teacherId)||{};
      return {student:student,periods:periods,latest:latest,subject:subject,teacher:teacher,event:nextByStudent.get(student.id)||{},due:dueByStudent.has(student.id),low:lowByStudent.has(student.id),hay:(student.name+' '+(student.phone||'')+' '+periods.map(function(row){return (subjectMap.get(row.subjectId)||{}).name||'';}).join(' ')).toLowerCase()};
    });
    var result={rows:rows,latestByStudent:latestByStudent,dueByStudent:dueByStudent,lowByStudent:lowByStudent,nextByStudent:nextByStudent};
    studentPageIndex.key=key;studentPageIndex.cache=result;return result;
  }
  function nextEvent(studentId){return studentPageIndex().nextByStudent.get(studentId)||{};}
  function renderStudents(){
    var index=studentPageIndex(),search=clean($('studentSearch').value).toLowerCase(),filter=$('studentPaymentFilter').value;
    var rows=index.rows.filter(function(item){if(search&&item.hay.indexOf(search)<0)return false;if(filter==='due'&&!item.due)return false;if(filter==='low'&&!item.low)return false;if(filter==='active'&&item.student.active===false)return false;return true;}).sort(function(a,b){return bySort(a.student,b.student);});
    $('studentMetrics').innerHTML=metric('學生總數',state.students.length,'含停課資料')+metric('尚有未繳',index.dueByStudent.size,'依每一期付款加總')+metric('剩 1 堂以下',index.lowByStudent.size,'建議準備下一期');
    $('studentRows').innerHTML=rows.map(function(item){var student=item.student,period=item.latest,event=item.event,subject=item.subject,teacher=item.teacher;return '<tr><td><b>'+esc(student.name)+'</b><small>'+(student.active===false?'已停課':'上課中')+'</small></td><td>'+esc(student.phone||'未填')+'<small>LINE：'+(student.line===true?'已綁定':student.line===false?'未綁定':'未確認')+'</small></td><td>'+esc(subject.name||'尚無學費期別')+'<small>'+esc(teacher.name||'未指定老師')+'</small></td><td>'+(period.id?'<b>'+period.usedCount+' / '+period.lessonCount+'</b><small>剩 '+periodRemaining(period)+' 堂</small>':'—')+'</td><td>'+(period.id?'<b>'+money(periodPaid(period))+' / '+money(periodNetExpectedAmount(period))+'</b><small>'+(periodBalance(period)?'尚欠 '+money(periodBalance(period)):'已繳清')+'</small>':'—')+'</td><td>'+(event.id?esc(event.date+' '+event.start):'尚未排課')+'</td><td><button class="btn small secondary" data-student-id="'+esc(student.id)+'">查看學費紀錄</button></td></tr>';}).join('')||'<tr><td colspan="7">沒有符合條件的學生。</td></tr>';
  }
  function metric(label,value,small){`);

  source = replaceRequired(
    source,
    "      if(data.type==='youzi-course-view')switchView(data.view);",
    "      if(data.type==='youzi-course-view'){if(data.view==='calendar'){state.currentDate=todayKey();weekAnchor=state.currentDate;if(weekMode)setWeekMode(false);}switchView(data.view);}",
    'calendar always returns to today'
  );
  source = replaceRequired(
    source,
    '    if(window.__YOUZI_COURSE_INLINE_MODE__)refreshPortalRentals();else restoreFormalDatabase().then(refreshPortalRentals);',
    '    refreshPortalRentals();',
    'refresh portal rentals without duplicate startup restore'
  );
  source = replaceRequired(
    source,
    "  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();",
    "  if(window.__YOUZI_COURSE_INLINE_MODE__)init();else if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();",
    'immediate inline initialization'
  );
  fs.writeFileSync('operations-course-inline-runtime.js', source);
}

function patchController() {
  let source = fs.readFileSync(controllerPath, 'utf8');
  source = source.replace(/var VERSION = '[^']+';/, `var VERSION = '${VERSION}';`);
  source = source.replace(/\n  var PIN_KEYS = \[[\s\S]*?\n  \];\n/, '\n');
  source = source.replace(/\n  function readStoredPin\(\) \{[\s\S]*?\n  \}\n\n  async function readSavedMirror\(\) \{[\s\S]*?\n  \}\n/, '\n');
  source = source.replace(/\n    var mirror = await readSavedMirror\(\);[\s\S]*?\n    return null;/, '\n    return null;');
  if (source.includes('readSavedMirror') || source.includes('YouziCoursePreviewData.load')) {
    throw new Error('Automatic mirror loading remains in the inline controller.');
  }
  if (!source.includes("#opsCourseSubmenu a[data-view]")) {
    source = replaceRequired(
      source,
      '\n  global.YouziOperationsCourseInline = {',
      `
  global.document.addEventListener('click', function (event) {
    var link=event.target.closest&&event.target.closest('#opsCourseSubmenu a[data-view]');
    if(!link)return;
    var map={'course-calendar':'calendar','course-students':'students','course-teachers':'teachers','course-settings':'settings'};
    var view=map[link.dataset.view];if(view)sendView(view);
  });

  global.YouziOperationsCourseInline = {`,
      'same-page course navigation listener'
    );
  }
  fs.writeFileSync(controllerPath, source);
}

function patchOperations() {
  let source = fs.readFileSync(operationsPath, 'utf8');
  const oldFunctions = /  function renderCourseWorkspace\(view\)\{[\s\S]*?  function handleCourseWorkspaceMessage\(event\)\{[\s\S]*?\n  \}\n/;
  const newFunctions = `  function renderCourseWorkspace(view){
    const courseView=courseWorkspaceView(view);
    return '<div class="ops-course-inline-placeholder" data-course-view="'+attr(courseView)+'">正在開啟完整課務功能…</div>';
  }
  function sendCourseWorkspaceView(frame,view){
    if(global.YouziOperationsCourseInline&&typeof global.YouziOperationsCourseInline.show==='function')global.YouziOperationsCourseInline.show(view);
  }
  function handleCourseWorkspaceMessage(){}
`;
  if (oldFunctions.test(source)) {
    source = source.replace(oldFunctions, newFunctions);
  } else if (!source.includes('ops-course-inline-placeholder')) {
    throw new Error('Unable to locate the legacy iframe course functions.');
  }

  const oldBranch = `    content.classList.toggle('ops-course-content',courseViewActive);
    if(courseViewActive){
      const courseView=courseWorkspaceView(state.view);
      let frame=byId('opsCourseFrame');
      if(!frame){
        content.innerHTML=renderCourseWorkspace(state.view);
        frame=byId('opsCourseFrame');
        if(frame)frame.addEventListener('load',function(){sendCourseWorkspaceView(frame,frame.dataset.courseView||courseView);});
      }else{
        sendCourseWorkspaceView(frame,courseView);
      }
      return;
    }`;
  const newBranch = `    content.classList.toggle('ops-course-content',courseViewActive);
    if(courseViewActive){
      const courseView=courseWorkspaceView(state.view);
      if(global.YouziOperationsCourseInline&&typeof global.YouziOperationsCourseInline.mount==='function'){
        global.YouziOperationsCourseInline.mount(content,courseView);
      }else{
        content.innerHTML=renderCourseWorkspace(state.view);
      }
      return;
    }
    if(global.YouziOperationsCourseInline&&typeof global.YouziOperationsCourseInline.detach==='function')global.YouziOperationsCourseInline.detach();`;
  if (source.includes(oldBranch)) {
    source = source.replace(oldBranch, newBranch);
  } else if (!source.includes('YouziOperationsCourseInline.mount(content,courseView)')) {
    throw new Error('Unable to locate the legacy iframe course render branch.');
  }

  const overviewControls = /  function overviewDayNavigatorHtml\(\)\{[\s\S]*?  function mobileSearchPadHtml\(targetId\)\{/;
  if (!overviewControls.test(source)) throw new Error('Unable to locate overview date controls.');
  source = source.replace(overviewControls, `  function overviewDayNavigatorHtml(){
    const current=overviewDateKey(),today=todayDateKey(),next=dateKeyShift(current,1),disableNext=next>today,todayParts=today.split('-');
    const mobile=isCompactMobile();
    return '<div class="ops-overview-day-nav'+(mobile?' ops-mobile-overview-day-nav':'')+'">'
      +'<button type="button" class="ops-button ghost" data-action="overview-day-shift" data-step="-1">← 前一天</button>'
      +'<button type="button" class="ops-button ops-overview-today '+(state.overviewRange==='today'&&current===today?'primary':'ghost')+'" data-action="overview-range" data-range="today"><b>今天</b><small>'+Number(todayParts[1])+'/'+Number(todayParts[2])+'</small></button>'
      +'<button type="button" class="ops-button ghost" data-action="overview-day-shift" data-step="1" '+(disableNext?'disabled':'')+'>後一天 →</button>'
      +(mobile?'':'<label class="ops-overview-day-label"><span>查詢日期</span><input class="ops-input" id="overviewDate" type="date" max="'+attr(today)+'" value="'+attr(current)+'"></label>')
      +'</div>';
  }
  function overviewMonthSelectHtml(){
    const now=new Date(),year=now.getFullYear(),currentMonth=now.getMonth()+1,currentKey=year+'-'+String(currentMonth).padStart(2,'0'),selected=clean(state.overviewMonth)||currentKey;
    const options=[];
    for(let month=1;month<=12;month+=1){const key=year+'-'+String(month).padStart(2,'0');options.push('<option value="'+attr(key)+'" '+(key===selected?'selected':'')+' '+(month>currentMonth?'disabled':'')+'>'+year+' 年 '+month+' 月</option>');}
    return '<button type="button" class="ops-button '+(state.overviewRange==='month'&&selected===currentKey?'primary':'ghost')+'" data-action="overview-current-month">本月</button>'
      +'<label class="ops-overview-month-select '+(state.overviewRange==='month'?'active':'')+'"><span>選擇月份</span><select class="ops-select" id="overviewMonth">'+options.join('')+'</select></label>';
  }
  function overviewRangeControlsHtml(){
    const customLabel='自訂區間';
    if(isCompactMobile()){
      return '<div class="ops-v8-overview-range ops-mobile-overview-range">'
        +overviewDayNavigatorHtml()
        +'<div class="ops-mobile-overview-periods">'
        +overviewMonthSelectHtml()
        +'<details class="ops-overview-dropdown"><summary class="ops-button '+(state.overviewRange==='custom'?'primary':'ghost')+'">搜尋日期</summary><div class="ops-overview-dropdown-panel"><label>開始日期<input class="ops-input" id="overviewFrom" type="date" value="'+attr(state.overviewFrom)+'"></label><label>結束日期<input class="ops-input" id="overviewTo" type="date" value="'+attr(state.overviewTo)+'"></label><button type="button" class="ops-button primary wide" data-action="overview-custom-apply">查詢</button></div></details>'
        +'</div></div>';
    }
    return '<div class="ops-v8-overview-range">'
      +overviewDayNavigatorHtml()
      +overviewMonthSelectHtml()
      +'<button type="button" class="ops-button '+(state.overviewRange==='year'?'primary':'ghost')+'" data-action="overview-range" data-range="year">今年</button>'
      +'<details class="ops-overview-dropdown"><summary class="ops-button '+(state.overviewRange==='custom'?'primary':'ghost')+'">'+escapeHtml(customLabel)+'</summary><div class="ops-overview-dropdown-panel"><label>開始日期<input class="ops-input" id="overviewFrom" type="date" value="'+attr(state.overviewFrom)+'"></label><label>結束日期<input class="ops-input" id="overviewTo" type="date" value="'+attr(state.overviewTo)+'"></label><button type="button" class="ops-button primary wide" data-action="overview-custom-apply">套用區間</button></div></details>'
      +'</div>';
  }
  function mobileSearchPadHtml(targetId){`);

  const overviewRangeAction = /    if\(action==='overview-range'\)\{[\s\S]*?    \}\n    if\(action==='overview-day-shift'\)/;
  if (overviewRangeAction.test(source)) {
    source = source.replace(overviewRangeAction, `    if(action==='overview-range'){
      const nextRange=el.dataset.range||'today',now=new Date();
      state.overviewRange=nextRange;
      if(nextRange==='today')state.overviewDate=todayDateKey();
      if(nextRange==='month')state.overviewMonth=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
      return render();
    }
    if(action==='overview-current-month'){const now=new Date();state.overviewMonth=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');state.overviewRange='month';return render();}
    if(action==='overview-day-shift')`);
  } else if (!source.includes("if(action==='overview-current-month')")) {
    throw new Error('Unable to locate overview range action.');
  }

  source = source.replace("    global.addEventListener('message',handleCourseWorkspaceMessage);\n", '');
  if (source.includes('<iframe id="opsCourseFrame"')) throw new Error('Legacy course iframe remains in operations-phase1.js');
  fs.writeFileSync(operationsPath, source);
}

function patchPortal(path) {
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(/\s*<script>\s*\(function\(\)\{\s*var map=\{'#course-calendar':[\s\S]*?<\/script>\s*/g, '\n');

  const links = {
    calendar: 'course-calendar',
    students: 'course-students',
    teachers: 'course-teachers',
    settings: 'course-settings'
  };
  for (const [view, hash] of Object.entries(links)) {
    const label = {
      calendar: ['日','課程日表'],
      students: ['生','學生與學費'],
      teachers: ['師','老師薪資'],
      settings: ['設','系統設定']
    }[view];
    const replacement = `<a href="#${hash}" data-view="${hash}"><span>${label[0]}</span><div><b>${label[1]}</b></div></a>`;
    const patterns = [
      new RegExp(`<a href="course-scheduler\\.html\\?view=${view}"[^>]*>[\\s\\S]*?<\\/a>`),
      new RegExp(`<a href="course-center\\.html#${view}"[^>]*>[\\s\\S]*?<\\/a>`),
      new RegExp(`<a href="#${hash}"[^>]*>[\\s\\S]*?<\\/a>`)
    ];
    let replaced = false;
    for (const pattern of patterns) {
      if (pattern.test(source)) {
        source = source.replace(pattern, replacement);
        replaced = true;
        break;
      }
    }
    if (!replaced) throw new Error(`Unable to locate ${view} course navigation in ${path}`);
  }

  source = source.replace(/\s*<link rel="stylesheet" href="operations-mobile-course-dense-v1\.css\?v=[^"]+">\s*/g, '\n');
  source = source.replace(/\s*<script src="operations-mobile-course-fix-v1\.js\?v=[^"]+"><\/script>\s*/g, '\n');
  const operationsTag = /<script src="operations-phase1\.js\?v=[^"]+"><\/script>/;
  if (!operationsTag.test(source)) throw new Error(`Unable to locate operations-phase1.js in ${path}`);
  const inlineTag = /<script src="operations-course-inline\.js\?v=[^"]+"><\/script>/;
  if (inlineTag.test(source)) {
    source = source.replace(inlineTag, `<script src="operations-course-inline.js?v=${VERSION}"></script>`);
  } else {
    source = source.replace(
      operationsTag,
      `<script src="operations-course-inline.js?v=${VERSION}"></script>\n  $&`
    );
  }
  if (source.includes('course-scheduler.html?view=')) throw new Error(`Standalone course links remain in ${path}`);
  fs.writeFileSync(path, source);
}

function writeLegacyRedirect() {
  const redirect = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>正在返回全通路營運中心</title>
  <script>
    (function(){
      var view=String(location.hash||'#calendar').replace(/^#/,'').split('?')[0];
      var map={calendar:'course-calendar',students:'course-students',teachers:'course-teachers',settings:'course-settings'};
      location.replace('portal.html#'+(map[view]||'course-calendar'));
    })();
  </script>
</head>
<body>正在返回全通路營運中心…</body>
</html>
`;
  fs.writeFileSync('course-center.html', redirect);
}

function writeSchedulerRedirect() {
  const redirect = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex">
  <meta http-equiv="refresh" content="0;url=portal.html#course-calendar">
  <title>正在開啟課務管理｜柚子樂器</title>
  <script>
    (function(){
      var params=new URLSearchParams(location.search);
      var requested=String(params.get('view')||location.hash||'course-calendar').replace(/^#/,'').split('?')[0];
      var map={calendar:'course-calendar',students:'course-students',teachers:'course-teachers',settings:'course-settings','course-calendar':'course-calendar','course-students':'course-students','course-teachers':'course-teachers','course-settings':'course-settings'};
      location.replace('portal.html#'+(map[requested]||'course-calendar'));
    })();
  </script>
</head>
<body>
  <p>正在開啟現行課務管理… <a href="portal.html#course-calendar">立即前往</a></p>
</body>
</html>
`;
  fs.writeFileSync(schedulerHtmlPath, redirect);
}

buildTemplate();
buildRuntime();
patchController();
patchOperations();
portalPaths.forEach(patchPortal);
writeLegacyRedirect();
writeSchedulerRedirect();

for (const obsolete of [
  'course-scheduler-full-bootstrap.js',
  'course-scheduler-standalone.css',
  'operations-mobile-course-fix-v1.js',
  'operations-mobile-course-dense-v1.css',
  '.github/scripts/restore-full-course-center.cjs'
]) {
  if (fs.existsSync(obsolete)) fs.unlinkSync(obsolete);
}

console.log('Built fast students, today-first calendar, and direct overview period controls.');
