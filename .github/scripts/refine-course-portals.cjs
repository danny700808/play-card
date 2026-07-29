'use strict';

const fs = require('fs');

const VERSION = '20260729-course-portals-v8';

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

function replaceRange(source, startMarkers, endMarker, replacement, label) {
  const starts = startMarkers.map((marker) => source.indexOf(marker)).filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = start >= 0 ? source.indexOf(endMarker, start) : -1;
  if (start < 0 || end < 0 || end <= start) throw new Error(`Unable to locate portal range: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

function patchCommon() {
  const path = 'course-portal-common.js';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(/const CACHE_PREFIX = '[^']+';/, "const CACHE_PREFIX = 'youzi.coursePortal.dataCache.v4.';");
  source = source.replace('    const cacheable = isCacheableCall(name);', '    const cacheable = isCacheableCall(name) && !(data && data.force === true);');

  source = replaceRange(
    source,
    ['  function sessionFingerprint(value) {', '  function setSession(role, token) {'],
    '  function isCacheableCall(name) {',
`  function sessionFingerprint(value) {
    const text = clean(value || 'public');
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ (code + index), 2246822519);
    }
    return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
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
  }

`,
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
  source = source.replace(/\n\s*clearDataCache,\n/g, '\n');
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
  source = source.replace(/<body(?: class="[^"]*")?>/, '<body class="teacher-approved-mobile">');
  source = source.replace('<p>課表・學生・薪資</p>', '<p>課表・學生・薪資・租用</p>');

  if (!source.includes('id="employeeLoginBridge"')) {
    source = replaceRequired(
      source,
      '        <button class="btn primary" type="submit">LINE 綁定</button>\n      </form>\n      <div class="bind-result hidden" data-bind-result></div>',
      '        <button class="btn primary" type="submit">LINE 綁定</button>\n      </form>\n      <div class="employee-login-bridge" id="employeeLoginBridge"><span>已有外聘老師帳號？</span><a class="btn soft" href="index.html">使用 Email／密碼登入</a><small>第一次仍需完成一次 LINE 身分確認；同一台裝置之後登入會直接開啟課表。</small></div>\n      <div class="bind-result hidden" data-bind-result></div>',
      'teacher employee login bridge'
    );
  } else {
    source = source.replace(/href="index\.html\?return=teacher-course-portal\.html"/g, 'href="index.html"');
  }

  source = source.replace(/\s*<section class="card teacher-quick-card" id="teacherQuickHome">[\s\S]*?<\/section>\s*/g, '\n');

  const bottomNav = `      <nav class="tabs teacher-bottom-tabs" aria-label="老師課務功能">
        <button class="btn active" type="button" data-tab="schedule"><span>表</span><b>課表</b></button>
        <button class="btn" type="button" data-tab="students"><span>生</span><b>學生</b></button>
        <button class="btn" type="button" data-tab="payroll"><span>薪</span><b>薪資</b></button>
        <a class="btn soft" href="room-booking.html?from=teacher"><span>租</span><b>租用</b></a>
        <button class="btn" id="teacherMoreBtn" type="button" data-open-more><span>⋯</span><b>其他</b></button>
      </nav>`;
  source = source.replace(
    /      <nav class="tabs(?: teacher-bottom-tabs)?"[^>]*>[\s\S]*?      <\/nav>/,
    bottomNav
  );
  if (!source.includes('id="teacherMoreBtn"')) throw new Error('Five-item teacher navigation was not installed.');

  if (!source.includes('id="teacherMoreBackdrop"')) {
    const sheet = `
  <div class="teacher-more-backdrop hidden" id="teacherMoreBackdrop" aria-hidden="true">
    <section class="teacher-more-sheet" role="dialog" aria-modal="true" aria-labelledby="teacherMoreTitle">
      <div class="teacher-more-handle" aria-hidden="true"></div>
      <div class="section-title"><div><h2 id="teacherMoreTitle">其他功能</h2><p class="muted">較少使用的老師功能集中在這裡。</p></div><button class="btn" id="closeTeacherMore" type="button">關閉</button></div>
      <div class="teacher-more-grid">
        <a href="profile.html"><span>人</span><b>我的資料</b><small>基本資料與通知設定</small></a>
        <a href="contract.html"><span>約</span><b>合約</b><small>查看與簽署合約</small></a>
        <a href="announcements.html"><span>告</span><b>公告</b><small>最新公告與通知</small></a>
        <a href="task.html"><span>辦</span><b>協助事項</b><small>待處理與回報</small></a>
        <a href="teacher-goods.html"><span>貨</span><b>拿貨／詢價</b><small>商品與詢價</small></a>
        <a href="forms-hub.html"><span>表</span><b>表格</b><small>集點卡與證明申請</small></a>
      </div>
      <p class="teacher-more-note">以上功能使用原本的老師帳號；不會重新載入或覆蓋課表資料。</p>
    </section>
  </div>
`;
    source = source.replace('\n  <div class="modal hidden" id="actionModal">', sheet + '\n  <div class="modal hidden" id="actionModal">');
  }

  source = source.replace(
    /    let data = .*?;\n(?:    let payrollLoadedMonth = .*?;\n)?(?:    let activeTab = .*?;\n)?/,
`    let data = { teacher: {}, events: [], roster: [], payroll: [], adjustments: [], rooms: [], subjects: [], hours: { start: 10, end: 21 } };
    let payrollLoadedMonth = '';
    let activeTab = 'schedule';
`
  );

  source = source.replace(
    "      const mobile = window.matchMedia('(max-width: 760px)').matches;\n      const visibleDays = mobile ? [days[selectedDayIndex]] : days;",
    '      const visibleDays = days;'
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

    async function loadSchedule(force) {
      try {
        const result = await P.call('coursePortalTeacherData', {
          sessionToken: token,
          section: 'schedule',
          weekStart,
          force: Boolean(force)
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
          month,
          force: Boolean(force)
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

    function openTeacherMore() {
      const sheet = document.getElementById('teacherMoreBackdrop');
      sheet.classList.remove('hidden');
      sheet.setAttribute('aria-hidden', 'false');
      document.body.classList.add('teacher-more-open');
    }

    function closeTeacherMore() {
      const sheet = document.getElementById('teacherMoreBackdrop');
      sheet.classList.add('hidden');
      sheet.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('teacher-more-open');
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
  source = replaceRange(
    source,
    ['    function mergeTeacherData(next) {', '    async function load() {'],
    "    document.getElementById('bindForm')",
    newLoadBlock,
    'teacher section loading'
  );

  const listenerStart = "    document.querySelectorAll('[data-tab]')";
  const listenerEnd = "    document.getElementById('payrollMonth').value = monthKey();";
  const listenerBlock = `    document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)));
    document.getElementById('prevWeek').addEventListener('click', () => { weekStart = P.addDays(weekStart, -7); loadSchedule(true); });
    document.getElementById('nextWeek').addEventListener('click', () => { weekStart = P.addDays(weekStart, 7); loadSchedule(true); });
    document.getElementById('thisWeek').addEventListener('click', () => { weekStart = P.monday(); loadSchedule(true); });
    document.getElementById('loadPayroll').addEventListener('click', () => loadPayrollData(true));
    document.getElementById('payrollMonth').value = monthKey();
    document.getElementById('teacherMoreBtn').addEventListener('click', openTeacherMore);
    document.getElementById('closeTeacherMore').addEventListener('click', closeTeacherMore);
    document.getElementById('teacherMoreBackdrop').addEventListener('click', (event) => { if (event.target.id === 'teacherMoreBackdrop') closeTeacherMore(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeTeacherMore(); });`;
  const listenerIndex = source.indexOf(listenerStart);
  const listenerEndIndex = source.indexOf(listenerEnd, listenerIndex);
  if (listenerIndex < 0 || listenerEndIndex < 0) throw new Error('Unable to locate teacher portal listeners.');
  source = source.slice(0, listenerIndex) + listenerBlock + source.slice(listenerEndIndex + listenerEnd.length);

  source = source.replace(
    /        (?:prefillEmployeeTeacher\(\);\n        )?token = await P\.exchangeAccess\('teacher'\);\n        if \(token\) await (?:load\(\)|loadSchedule\([^\n]*\));\n        else showBound\(false\);/,
`        prefillEmployeeTeacher();
        token = await P.exchangeAccess('teacher');
        if (token) await loadSchedule(false);
        else showBound(false);`
  );
  source = source.replace(/await load\(\);/g, 'payrollLoadedMonth = \'\'; await loadSchedule(true);');

  if (source.includes('teacherQuickHome') || source.includes('data-teacher-quick')) throw new Error('Duplicate top teacher shortcuts remain.');
  if (source.includes("window.matchMedia('(max-width: 760px)').matches")) throw new Error('Teacher portal still branches into a second mobile schedule.');
  if (!source.includes('id="teacherMoreBackdrop"') || !source.includes('data-open-more')) throw new Error('Teacher other bottom sheet is missing.');
  fs.writeFileSync(path, source);
}

function patchPortalCss() {
  const path = 'course-portal.css';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(/\n\n\/\* teacher portal fixed shell v7 \*\/[\s\S]*$/g, '');
  source = source.replace(/\n\n\/\* teacher portal app shell v8 \*\/[\s\S]*$/g, '');
  source += `

/* teacher portal app shell v8 */
.employee-login-bridge{display:grid;gap:8px;margin-top:14px;padding:12px;border:1px solid var(--line);border-radius:14px;background:#f7faf8}
.employee-login-bridge span{font-weight:900}.employee-login-bridge small{color:var(--muted);line-height:1.55}.employee-login-bridge.employee-recognized{border-color:#b8dccc;background:#edf8f3}
body.teacher-approved-mobile .week-scroll{position:relative;max-height:calc(100dvh - 230px);overflow:auto;overscroll-behavior:contain;touch-action:pan-x pan-y pinch-zoom;scrollbar-gutter:stable}
body.teacher-approved-mobile .week-cell.head{position:sticky;top:0;z-index:4;background:#f0f5f2}
body.teacher-approved-mobile .week-cell.time{position:sticky;left:0;z-index:3;background:#f8faf8}
body.teacher-approved-mobile .week-grid>.week-cell.head:first-child{position:sticky;top:0;left:0;z-index:6;background:#e7f0eb}
body.teacher-approved-mobile .mobile-day-tabs{display:none!important}
body.teacher-approved-mobile .week-grid,body.teacher-approved-mobile .week-grid.mobile-day{min-width:840px;grid-template-columns:58px repeat(7,1fr)}
body.teacher-more-open{overflow:hidden}
.teacher-bottom-tabs .btn{display:flex;flex-direction:column;gap:2px}.teacher-bottom-tabs .btn span{font-size:13px;line-height:1}.teacher-bottom-tabs .btn b{font-size:11px;line-height:1.15}
.teacher-more-backdrop{position:fixed;inset:0;z-index:90;display:flex;align-items:flex-end;justify-content:center;padding:12px;background:rgba(15,35,29,.42);backdrop-filter:blur(3px)}
.teacher-more-sheet{width:min(440px,100%);max-height:min(78dvh,660px);overflow:auto;border-radius:24px 24px 18px 18px;background:#fff;border:1px solid var(--line);box-shadow:0 -20px 55px rgba(20,55,44,.22);padding:10px 14px calc(16px + env(safe-area-inset-bottom));animation:teacherSheetUp .2s ease-out}
.teacher-more-handle{width:42px;height:5px;margin:0 auto 12px;border-radius:999px;background:#c9d6d0}
.teacher-more-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.teacher-more-grid a{display:grid;grid-template-columns:38px 1fr;column-gap:9px;align-items:center;min-height:72px;padding:10px;border:1px solid var(--line);border-radius:15px;background:#f8fbf9;color:var(--ink);text-decoration:none}
.teacher-more-grid a>span{grid-row:1/span 2;display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--green-soft);color:var(--green);font-weight:900}.teacher-more-grid a>b{font-size:14px}.teacher-more-grid a>small{color:var(--muted);font-size:10px;line-height:1.3}
.teacher-more-note{margin:12px 2px 0;color:var(--muted);font-size:11px;line-height:1.55}
@keyframes teacherSheetUp{from{transform:translateY(24px);opacity:.7}to{transform:translateY(0);opacity:1}}
@media(max-width:760px){
  body.teacher-approved-mobile .portal-shell{width:100%;max-width:440px;padding:8px 8px calc(80px + env(safe-area-inset-bottom))}
  body.teacher-approved-mobile .portal-head{margin-bottom:7px}body.teacher-approved-mobile .portal-head h1{font-size:17px}body.teacher-approved-mobile .portal-head p{font-size:11px;margin-top:1px}body.teacher-approved-mobile .brand-mark{width:34px;height:34px;border-radius:10px}
  body.teacher-approved-mobile .card{padding:9px;border-radius:11px;box-shadow:none}
  body.teacher-approved-mobile .summary-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin-bottom:7px}body.teacher-approved-mobile .summary{padding:7px 6px;border-radius:11px;min-width:0}body.teacher-approved-mobile .summary span{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}body.teacher-approved-mobile .summary strong{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  body.teacher-approved-mobile #appView>.teacher-bottom-tabs{position:fixed;left:50%;bottom:0;z-index:50;width:min(440px,100%);transform:translateX(-50%);display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:3px;margin:0;padding:7px 6px calc(7px + env(safe-area-inset-bottom));border-top:1px solid var(--line);background:rgba(244,247,243,.97);backdrop-filter:blur(12px)}
  body.teacher-approved-mobile #appView>.teacher-bottom-tabs .btn{min-height:43px;padding:5px 2px;font-size:11px;white-space:normal;text-align:center;border-radius:10px}
  body.teacher-approved-mobile .section-title h2{font-size:14px}body.teacher-approved-mobile .section-title p,body.teacher-approved-mobile .muted{font-size:11px}
  body.teacher-approved-mobile .week-scroll{max-height:calc(100dvh - 210px)}
}
`;
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

function patchApp() {
  const path = 'app.js';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(
    /function redirectAfterLogin\(user\)\{[^\n]*\}/,
    "function redirectAfterLogin(user){saveUser(user); if(isExternalTeacher(user)){location.href='teacher-course-portal.html?from=employee';return;} if(hasSettingsZoneAccess(user)){setPortalMode('settings');location.href='portal.html';return;} setPortalMode('staff');location.href='dashboard.html';}"
  );
  if (!source.includes("teacher-course-portal.html?from=employee")) throw new Error('External teacher direct routing was not installed.');
  fs.writeFileSync(path, source);
}

function patchTeacherHome() {
  const path = 'teacher-home.html';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(/\s*<a class="entry-card" id="openCoursePortalBtn"[\s\S]*?<\/a>/g, '');
  fs.writeFileSync(path, source);
}

function patchIndex() {
  const path = 'index.html';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace('.teacher-apply-entry{width:100%;display:flex;align-items:center;justify-content:center;text-decoration:none}', '.teacher-apply-entry{width:100%;display:flex;align-items:center;justify-content:center;text-decoration:none}.course-entry-grid{display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:10px}');
  source = source.replace(/app\.js\?v=[^"]+/g, 'app.js?v=20260729-teacher-portal-v8');
  source = source.replace(
    /            <div class="external-entry-title">其他入口<\/div>[\s\S]*?            <a href="rental-order\.html" class="btn secondary teacher-apply-entry" style="margin-top:10px">設備租賃申請<\/a>/,
`            <div class="external-entry-title">其他入口</div>
            <div class="course-entry-grid">
              <a href="teacher-course-portal.html" class="btn secondary teacher-apply-entry">老師課務入口</a>
              <a href="student-course-portal.html" class="btn secondary teacher-apply-entry">學生／家長入口</a>
              <a href="room-booking.html" class="btn secondary teacher-apply-entry">教室租用入口</a>
            </div>
            <a href="teacher-apply.html" class="btn secondary teacher-apply-entry">應聘履歷投遞</a>
            <a href="rental-order.html" class="btn secondary teacher-apply-entry" style="margin-top:10px">設備租賃申請</a>`
  );
  if (!source.includes('href="teacher-course-portal.html"') || !source.includes('href="student-course-portal.html"') || !source.includes('href="room-booking.html"')) throw new Error('Public course entries were not installed.');
  source = source.replace(/\n    function safeLoginReturnTarget\(\)\{[\s\S]*?\n    \}\n/g, '\n');
  source = source.replace(/          const returnTarget=safeLoginReturnTarget\(\);\n          if\(returnTarget[\s\S]*?\n          else setTimeout\(\(\) => redirectAfterLogin\(r\.user\), 450\);/, '          setTimeout(() => redirectAfterLogin(r.user), 450);');
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
patchApp();
patchTeacherHome();
patchIndex();
bumpSharedPortalVersions();

console.log('Published one teacher course home with five fixed tabs and an Other bottom sheet.');
