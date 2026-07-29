'use strict';

const fs = require('fs');

const VERSION = '20260729-course-portals-v7';

function replaceRequired(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Unable to apply portal refinement: ${label}`);
  return next;
}

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`Unable to locate portal block: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

function patchCommon() {
  const path = 'course-portal-common.js';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(/const CACHE_PREFIX = '[^']+';/, "const CACHE_PREFIX = 'youzi.coursePortal.dataCache.v3.';");

  source = replaceRequired(
    source,
    /  function setSession\(role, token\) \{[\s\S]*?\n  \}\n\n  function cacheKey\(name, data\) \{[\s\S]*?\n  \}/,
`  function sessionFingerprint(value) {
    const text = clean(value || 'public');
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ (code + index), 2246822519);
    }
    return ((first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0'));
  }

  function setSession(role, token) {
    const prior = getSession(role);
    const next = clean(token);
    if (next) global.localStorage.setItem(sessionKey(role), next);
    else global.localStorage.removeItem(sessionKey(role));
    if (prior !== next) clearDataCache();
  }

  function cacheKey(name, data) {
    const safe = Object.assign({}, data || {});
    const scope = sessionFingerprint(safe.sessionToken || 'public');
    delete safe.sessionToken;
    delete safe.manualSyncPin;
    return CACHE_PREFIX + scope + '.' + name + '.' + encodeURIComponent(JSON.stringify(safe));
  }`,
    'session-scoped portal cache'
  );

  const minimalRuntime = `  function installPortalRuntimeStyle() {
    if (document.getElementById('coursePortalRuntimeStyle')) return;
    const style = document.createElement('style');
    style.id = 'coursePortalRuntimeStyle';
    style.textContent = \`
      .portal-session-card{max-width:540px;margin:7vh auto 0;display:flex;align-items:center;gap:14px}
      .portal-session-card p{margin:3px 0 0;color:var(--muted)}
      .portal-session-spinner{width:28px;height:28px;flex:0 0 auto;border:3px solid #cce6db;border-right-color:var(--green);border-radius:50%;animation:spin .7s linear infinite}
    \`;
    document.head.appendChild(style);
  }

  installPortalRuntimeStyle();

`;
  source = replaceBetween(
    source,
    '  function installPortalRuntimeStyle() {',
    '  global.CoursePortal = {',
    minimalRuntime,
    'dynamic teacher layout removal'
  );
  source = source.replace('    setSession,\n', '    setSession,\n    clearDataCache,\n');
  if (source.includes('installTeacherApprovedLayout') || source.includes('__YOUZI_TEACHER_WEEK_MEDIA_FIXED__')) {
    throw new Error('Dynamic teacher layout or matchMedia override remains in common runtime.');
  }
  fs.writeFileSync(path, source);
}

function patchTeacherPortal() {
  const path = 'teacher-course-portal.html';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(/course-portal\.css\?v=[^"]+/g, `course-portal.css?v=${VERSION}`);
  source = source.replace(/course-portal-common\.js\?v=[^"]+/g, `course-portal-common.js?v=${VERSION}`);
  source = source.replace('<body>', '<body class="teacher-approved-mobile">');

  if (!source.includes('id="employeeLoginBridge"')) {
    source = replaceRequired(
      source,
      '        <button class="btn primary" type="submit">LINE 綁定</button>\n      </form>\n      <div class="bind-result hidden" data-bind-result></div>',
      '        <button class="btn primary" type="submit">LINE 綁定</button>\n      </form>\n      <div class="employee-login-bridge" id="employeeLoginBridge"><span>已經有外聘老師帳號？</span><a class="btn soft" href="index.html?return=teacher-course-portal.html">使用 Email／密碼登入</a><small>同一台裝置若已完成課務綁定，登入後可直接開啟；第一次仍需完成一次 LINE 身分確認。</small></div>\n      <div class="bind-result hidden" data-bind-result></div>',
      'teacher employee login bridge'
    );
  }

  if (!source.includes('id="teacherQuickHome"')) {
    source = replaceRequired(
      source,
      '    <section class="hidden" id="appView">\n      <div class="summary-grid">',
      '    <section class="hidden" id="appView">\n      <section class="card teacher-quick-card" id="teacherQuickHome"><h2>常用功能</h2><div class="teacher-quick-grid"><button class="btn primary" type="button" data-teacher-quick="schedule"><b>1</b>本週課表</button><button class="btn primary" type="button" data-teacher-quick="students"><b>2</b>我的學生</button><button class="btn primary" type="button" data-teacher-quick="payroll"><b>3</b>薪資查詢</button><button class="btn" type="button" data-teacher-quick="extra"><b>4</b>增加課程</button><button class="btn" type="button" data-teacher-quick="move"><b>5</b>老師調課</button><a class="btn" href="room-booking.html?from=teacher"><b>6</b>租用教室</a></div></section>\n      <div class="summary-grid">',
      'static teacher quick actions'
    );
  }

  source = source.replace('<nav class="tabs">', '<nav class="tabs teacher-bottom-tabs" aria-label="老師課務功能">');
  source = source.replace('    let data = null;', "    let data = { teacher: {}, events: [], roster: [], payroll: [], adjustments: [], rooms: [], subjects: [], hours: { start: 10, end: 21 } };\n    let payrollLoadedMonth = '';\n    let activeTab = 'schedule';");
  source = replaceRequired(
    source,
    "      const mobile = window.matchMedia('(max-width: 760px)').matches;\n      const visibleDays = mobile ? [days[selectedDayIndex]] : days;",
    "      const visibleDays = days;",
    'teacher always-seven-day grid'
  );
  source = source.replace("      grid.classList.toggle('mobile-day', mobile);", "      grid.classList.remove('mobile-day');");
  source = source.replace(/      document\.getElementById\('mobileDayTabs'\)\.innerHTML = days\.map\([\s\S]*?      `\)\.join\(''\);/, "      document.getElementById('mobileDayTabs').innerHTML = '';");

  const newLoadBlock = `    function mergeTeacherData(next) {
      data = Object.assign({}, data, next || {});
      ['events','roster','payroll','adjustments','rooms','subjects'].forEach((key) => {
        if (!Array.isArray(data[key])) data[key] = [];
      });
      if (!data.hours) data.hours = { start: 10, end: 21 };
      if (!data.teacher) data.teacher = {};
    }

    function handlePortalError(error) {
      if (/登入|綁定|權限|到期/.test(error.message || '')) {
        P.setSession('teacher', '');
        token = '';
        showBound(false);
      }
      P.toast(error.message || '讀取失敗', 'error');
    }

    async function loadSchedule(options) {
      options = options || {};
      try {
        const result = await P.call('coursePortalTeacherData', {
          sessionToken: token,
          section: 'schedule',
          weekStart
        });
        mergeTeacherData(result);
        document.getElementById('teacherName').textContent = data.teacher.name || '老師';
        renderWeek();
        renderRoster();
        showBound(true);
      } catch (error) {
        handlePortalError(error);
      }
    }

    async function loadPayrollData(force) {
      const month = document.getElementById('payrollMonth').value || monthKey();
      if (!force && payrollLoadedMonth === month) {
        renderPayroll();
        return;
      }
      const button = document.getElementById('loadPayroll');
      P.loading(button, true, '讀取中…');
      try {
        const result = await P.call('coursePortalTeacherData', {
          sessionToken: token,
          section: 'payroll',
          month
        });
        mergeTeacherData(result);
        payrollLoadedMonth = month;
        document.getElementById('teacherName').textContent = data.teacher.name || document.getElementById('teacherName').textContent;
        renderPayroll();
      } catch (error) {
        handlePortalError(error);
      } finally {
        P.loading(button, false);
      }
    }

    function activateTab(tab) {
      activeTab = ['schedule','students','payroll'].includes(tab) ? tab : 'schedule';
      document.querySelectorAll('[data-tab]').forEach((node) => node.classList.toggle('active', node.dataset.tab === activeTab));
      document.querySelectorAll('[data-panel]').forEach((node) => node.classList.toggle('hidden', node.dataset.panel !== activeTab));
      if (activeTab === 'payroll') loadPayrollData(false);
      const panel = document.querySelector('[data-panel="' + activeTab + '"]');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function prefillEmployeeTeacher() {
      let employee = null;
      try { employee = JSON.parse(localStorage.getItem('employeeUser') || 'null'); } catch (_) {}
      if (!employee) return;
      const identity = String(employee.identityType || '').toLowerCase();
      if (identity && identity !== 'external') return;
      const form = document.getElementById('bindForm');
      if (form && form.elements.name && !form.elements.name.value) form.elements.name.value = employee.name || employee.displayName || '';
      if (form && form.elements.phone && !form.elements.phone.value) form.elements.phone.value = employee.phone || employee.mobile || employee.tel || '';
      const bridge = document.getElementById('employeeLoginBridge');
      if (bridge) bridge.classList.add('employee-recognized');
    }

`;
  source = source.replace(/    async function load\(\) \{[\s\S]*?\n    \}\n\n    document\.getElementById\('bindForm'\)/, newLoadBlock + "    document.getElementById('bindForm')");
  if (!source.includes("section: 'schedule'") || !source.includes("section: 'payroll'")) throw new Error('Teacher section loading was not installed.');

  source = source.replace(
    /    document\.querySelectorAll\('\[data-tab\]'\)\.forEach\(\(button\) => button\.addEventListener\('click', \(\) => \{[\s\S]*?    document\.getElementById\('payrollMonth'\)\.value = monthKey\(\);/,
`    document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)));
    document.getElementById('teacherQuickHome').addEventListener('click', (event) => {
      const button = event.target.closest('[data-teacher-quick]');
      if (!button) return;
      const action = button.dataset.teacherQuick;
      activateTab(['students','payroll'].includes(action) ? action : 'schedule');
      if (action === 'extra') P.toast('請在課表點空堂，即可選學生增加一堂。');
      if (action === 'move') P.toast('請點原課程，即可選擇單次調課或永久調課。');
    });
    document.getElementById('prevWeek').addEventListener('click', () => { weekStart = P.addDays(weekStart, -7); loadSchedule({ force: true }); });
    document.getElementById('nextWeek').addEventListener('click', () => { weekStart = P.addDays(weekStart, 7); loadSchedule({ force: true }); });
    document.getElementById('thisWeek').addEventListener('click', () => { weekStart = P.monday(); loadSchedule({ force: true }); });
    document.getElementById('loadPayroll').addEventListener('click', () => loadPayrollData(true));
    document.getElementById('payrollMonth').value = monthKey();`,
    'lazy teacher tab loading'
  );

  source = source.replace(/await load\(\);/g, "payrollLoadedMonth = ''; await loadSchedule({ force: true });");
  source = replaceRequired(
    source,
    "        token = await P.exchangeAccess('teacher');\n        if (token) await load();\n        else showBound(false);",
    "        prefillEmployeeTeacher();\n        token = await P.exchangeAccess('teacher');\n        if (token) await loadSchedule();\n        else showBound(false);",
    'teacher initial session loading'
  );
  if (source.includes("window.matchMedia('(max-width: 760px)').matches")) throw new Error('Teacher portal still branches into a second mobile schedule.');
  fs.writeFileSync(path, source);
}

function patchPortalCss() {
  const path = 'course-portal.css';
  let source = fs.readFileSync(path, 'utf8');
  const marker = '/* teacher portal fixed shell v7 */';
  if (!source.includes(marker)) {
    source += `\n\n${marker}
.employee-login-bridge{display:grid;gap:8px;margin-top:14px;padding:12px;border:1px solid var(--line);border-radius:14px;background:#f7faf8}
.employee-login-bridge span{font-weight:900}.employee-login-bridge small{color:var(--muted);line-height:1.55}.employee-login-bridge.employee-recognized{border-color:#b8dccc;background:#edf8f3}
.teacher-quick-card{margin-bottom:12px;padding:10px}.teacher-quick-card h2{margin:0 0 7px;font-size:14px}.teacher-quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.teacher-quick-grid .btn{min-height:50px;padding:7px 4px;font-size:11px;line-height:1.25}.teacher-quick-grid .btn b{display:block;font-size:13px}
body.teacher-approved-mobile .week-scroll{position:relative;max-height:calc(100dvh - 250px);overflow:auto;overscroll-behavior:contain;touch-action:pan-x pan-y pinch-zoom;scrollbar-gutter:stable}
body.teacher-approved-mobile .week-cell.head{position:sticky;top:0;z-index:4;background:#f0f5f2}
body.teacher-approved-mobile .week-cell.time{position:sticky;left:0;z-index:3;background:#f8faf8}
body.teacher-approved-mobile .week-grid>.week-cell.head:first-child{position:sticky;top:0;left:0;z-index:6;background:#e7f0eb}
body.teacher-approved-mobile .mobile-day-tabs{display:none!important}
body.teacher-approved-mobile .week-grid,body.teacher-approved-mobile .week-grid.mobile-day{min-width:840px;grid-template-columns:58px repeat(7,1fr)}
@media(max-width:760px){
  body.teacher-approved-mobile .portal-shell{width:100%;max-width:440px;padding:8px 8px calc(78px + env(safe-area-inset-bottom))}
  body.teacher-approved-mobile .portal-head{margin-bottom:7px}body.teacher-approved-mobile .portal-head h1{font-size:17px}body.teacher-approved-mobile .portal-head p{font-size:11px;margin-top:1px}body.teacher-approved-mobile .brand-mark{width:34px;height:34px;border-radius:10px}
  body.teacher-approved-mobile .card{padding:9px;border-radius:11px;box-shadow:none}
  body.teacher-approved-mobile .summary-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin-bottom:7px}body.teacher-approved-mobile .summary{padding:7px 6px;border-radius:11px;min-width:0}body.teacher-approved-mobile .summary span{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}body.teacher-approved-mobile .summary strong{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  body.teacher-approved-mobile #appView>.teacher-bottom-tabs{position:fixed;left:50%;bottom:0;z-index:30;width:min(440px,100%);transform:translateX(-50%);display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:0;padding:7px 8px calc(7px + env(safe-area-inset-bottom));border-top:1px solid var(--line);background:rgba(244,247,243,.96);backdrop-filter:blur(12px)}
  body.teacher-approved-mobile #appView>.teacher-bottom-tabs .btn{min-height:38px;padding:5px 3px;font-size:11px;white-space:normal;text-align:center}
  body.teacher-approved-mobile .section-title h2{font-size:14px}body.teacher-approved-mobile .section-title p,body.teacher-approved-mobile .muted{font-size:11px}
  body.teacher-approved-mobile .week-scroll{max-height:calc(100dvh - 225px)}
}
`;
  }
  fs.writeFileSync(path, source);
}

function patchCoursePortalBackend() {
  const path = 'functions/coursePortal.js';
  let source = fs.readFileSync(path, 'utf8');
  const replacement = `async function teacherPortalData(data) {
  const session = await requireSession(data, ['teacher']);
  const requestedSection = clean(data.section).toLowerCase();
  const section = ['schedule', 'payroll', 'all'].includes(requestedSection) ? requestedSection : 'all';
  const month = clean(data.month).match(/^\\d{4}-\\d{2}$/) ? clean(data.month) : new Intl.DateTimeFormat('en-CA', { timeZone: TAIPEI, year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);

  if (section === 'payroll') {
    const teachers = await mirrorRows('teachers');
    const teacher = teachers.find((row) => sourceId(row) === session.teacherId && sourceActive(row));
    if (!teacher) throw new HttpsError('not-found', '找不到已綁定老師資料。');
    const [payroll, adjustments] = await Promise.all([
      mirrorRowsByField('teacherPayroll', 'teacherId', session.teacherId),
      mirrorRowsByField('teacherAdjustments', 'teacherId', session.teacherId)
    ]);
    return {
      ok: true,
      section,
      teacher: { id: session.teacherId, name: clean(teacher.name), phoneLast4: normalizePhone(sourcePhone(teacher)).slice(-4), subjectIds: firstArray(teacher, ['subjectIds', 'subjects']) },
      payroll: payroll.filter((row) => clean(row.month || row.payrollMonth || eventDate(row).slice(0, 7)) === month),
      adjustments: adjustments.filter((row) => clean(row.month || row.payrollMonth || eventDate(row).slice(0, 7)) === month)
    };
  }

  const start = dateKey(data.weekStart);
  if (!start) throw new HttpsError('invalid-argument', '週起始日期格式錯誤。');
  const end = addDays(start, 6);
  const bundle = await scheduleBundle(start, end, session.teacherId);
  const teacher = bundle.maps.teachers[session.teacherId];
  if (!teacher) throw new HttpsError('not-found', '找不到已綁定老師資料。');
  const ownEvents = bundle.events.filter((row) => row.teacherId === session.teacherId);
  const [allFixed, allTemporary] = await Promise.all([mirrorRows('fixedCourses'), mirrorRows('temporaryCourses')]);
  const studentIds = [...new Set([...allFixed, ...allTemporary].filter((row) => eventTeacherId(row) === session.teacherId).flatMap(eventStudentIds).concat(ownEvents.flatMap((row) => row.studentIds)))];
  const roster = studentIds.map((id) => { const student = bundle.maps.students[id] || {}; return { id, name: clean(student.name), phoneLast4: normalizePhone(sourcePhone(student)).slice(-4) }; }).filter((row) => row.name);
  const result = {
    ok: true,
    section,
    teacher: { id: session.teacherId, name: clean(teacher.name), phoneLast4: normalizePhone(sourcePhone(teacher)).slice(-4), subjectIds: firstArray(teacher, ['subjectIds', 'subjects']) },
    week: { start, end },
    hours: { start: 10, end: 21, closedWeekday: 2 },
    rooms: bundle.rooms.map((room) => ({ id: sourceId(room), name: clean(room.name), rentalFee: Number(room.rentalFee || room.price || 0), allowedSubjectIds: firstArray(room, ['allowedSubjectIds', 'subjectIds']) })),
    subjects: bundle.subjects.map((subject) => ({ id: sourceId(subject), name: clean(subject.name) })),
    events: bundle.events,
    roster
  };
  if (section === 'all') {
    const [payroll, adjustments] = await Promise.all([
      mirrorRowsByField('teacherPayroll', 'teacherId', session.teacherId),
      mirrorRowsByField('teacherAdjustments', 'teacherId', session.teacherId)
    ]);
    result.payroll = payroll.filter((row) => clean(row.month || row.payrollMonth || eventDate(row).slice(0, 7)) === month);
    result.adjustments = adjustments.filter((row) => clean(row.month || row.payrollMonth || eventDate(row).slice(0, 7)) === month);
  }
  return result;
}

`;
  source = source.replace(/async function teacherPortalData\(data\) \{[\s\S]*?\n\}\n\nasync function teacherAvailability/, replacement + 'async function teacherAvailability');
  if (!source.includes("section === 'payroll'") || !source.includes("section === 'all'")) throw new Error('Sectioned teacher callable was not installed.');
  fs.writeFileSync(path, source);
}

function patchTeacherHome() {
  const path = 'teacher-home.html';
  let source = fs.readFileSync(path, 'utf8');
  if (!source.includes('id="openCoursePortalBtn"')) {
    source = replaceRequired(
      source,
      '    <section class="section cards" id="cardsSection">',
      '    <section class="section cards" id="cardsSection">\n      <a class="entry-card" id="openCoursePortalBtn" href="teacher-course-portal.html?from=employee"><div class="entry-top"><div class="entry-title">我的課務</div><div class="entry-count">課</div></div><div class="entry-desc">本週課表、學生、調課、薪資與教室租用</div></a>',
      'teacher home course entry'
    );
  }
  fs.writeFileSync(path, source);
}

function patchIndex() {
  const path = 'index.html';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace('.teacher-apply-entry{width:100%;display:flex;align-items:center;justify-content:center;text-decoration:none}', '.teacher-apply-entry{width:100%;display:flex;align-items:center;justify-content:center;text-decoration:none}.course-entry-grid{display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:10px}');
  if (!source.includes('teacher-course-portal.html" class="btn secondary teacher-apply-entry"')) {
    source = replaceRequired(
      source,
      '            <div class="external-entry-title">其他入口</div>\n            <a href="teacher-apply.html" class="btn secondary teacher-apply-entry">應聘履歷投遞</a>',
      '            <div class="external-entry-title">其他入口</div>\n            <div class="course-entry-grid"><a href="teacher-course-portal.html" class="btn secondary teacher-apply-entry">老師課務入口</a><a href="student-course-portal.html" class="btn secondary teacher-apply-entry">學生／家長入口</a><a href="room-booking.html" class="btn secondary teacher-apply-entry">教室租用入口</a></div>\n            <a href="teacher-apply.html" class="btn secondary teacher-apply-entry">應聘履歷投遞</a>',
      'three public course entries'
    );
  }
  if (!source.includes('function safeLoginReturnTarget')) {
    source = replaceRequired(
      source,
      "    qs('#loginBtn').onclick = async () => {",
      `    function safeLoginReturnTarget(){
      const raw=new URLSearchParams(location.search).get('return')||'';
      return ['teacher-course-portal.html'].includes(raw)?raw:'';
    }

    qs('#loginBtn').onclick = async () => {`,
      'safe login return target'
    );
  }
  source = replaceRequired(
    source,
    '          setTimeout(() => redirectAfterLogin(r.user), 450);',
    "          const returnTarget=safeLoginReturnTarget();\n          if(returnTarget && typeof isExternalTeacher==='function' && isExternalTeacher(r.user)){saveUser(r.user);setTimeout(()=>{location.href=returnTarget;},450);}\n          else setTimeout(() => redirectAfterLogin(r.user), 450);",
    'teacher login return routing'
  );
  fs.writeFileSync(path, source);
}

function bumpSharedPortalVersions() {
  ['student-course-portal.html','room-booking.html','course-portal-admin.html'].forEach((path) => {
    if (!fs.existsSync(path)) return;
    let source = fs.readFileSync(path, 'utf8');
    source = source.replace(/course-portal\.css\?v=[^"]+/g, `course-portal.css?v=${VERSION}`);
    source = source.replace(/course-portal-common\.js\?v=[^"]+/g, `course-portal-common.js?v=${VERSION}`);
    fs.writeFileSync(path, source);
  });
}

patchCommon();
patchTeacherPortal();
patchPortalCss();
patchCoursePortalBackend();
patchTeacherHome();
patchIndex();
bumpSharedPortalVersions();

console.log('Refined course portals without creating a second course data flow.');
