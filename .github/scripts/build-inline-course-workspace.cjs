'use strict';

const fs = require('fs');

const VERSION = '20260729-operations-inline-course-v2';
const schedulerHtmlPath = 'course-scheduler.html';
const schedulerJsPath = 'course-scheduler.js';
const operationsPath = 'operations-phase1.js';
const portalPaths = ['portal.html', 'operations-hub.html'];

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Unable to apply required inline-course transform: ${label}`);
  return next;
}

function buildTemplate() {
  const html = fs.readFileSync(schedulerHtmlPath, 'utf8');
  const main = html.match(/<main class="main-content">([\s\S]*?)<\/main>/);
  if (!main) throw new Error('Unable to locate the full course main content.');
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
  source = replaceRequired(
    source,
    '    restoreFormalDatabase();',
    '    if(!window.__YOUZI_COURSE_INLINE_MODE__)restoreFormalDatabase();',
    'disable duplicate startup restore'
  );
  source = replaceRequired(
    source,
    "  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();",
    "  if(window.__YOUZI_COURSE_INLINE_MODE__)init();else if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();",
    'immediate inline initialization'
  );
  fs.writeFileSync('operations-course-inline-runtime.js', source);
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

  source = source.replace(/\s*<script src="operations-course-inline\.js\?v=[^"]+"><\/script>\s*/g, '\n');
  const operationsTag = /<script src="operations-phase1\.js\?v=[^"]+"><\/script>/;
  if (!operationsTag.test(source)) throw new Error(`Unable to locate operations-phase1.js in ${path}`);
  source = source.replace(
    operationsTag,
    `<script src="operations-course-inline.js?v=${VERSION}"></script>\n  $&`
  );
  source = source.replace(/course-scheduler-data\.js\?v=[^"]+/g, `course-scheduler-data.js?v=${VERSION}`);
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

buildTemplate();
buildRuntime();
patchOperations();
portalPaths.forEach(patchPortal);
writeLegacyRedirect();

for (const obsolete of [
  'course-scheduler-full-bootstrap.js',
  'course-scheduler-standalone.css',
  '.github/scripts/restore-full-course-center.cjs'
]) {
  if (fs.existsSync(obsolete)) fs.unlinkSync(obsolete);
}

console.log('Built the complete in-place course workspace without iframe or page navigation.');
