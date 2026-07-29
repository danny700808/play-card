'use strict';

const fs = require('fs');

const schedulerPath = 'course-scheduler.html';
const portalPaths = ['portal.html', 'operations-hub.html'];
const version = '20260729-full-course-standalone-v1';

let scheduler = fs.readFileSync(schedulerPath, 'utf8');
scheduler = scheduler.replace(/<title>[\s\S]*?<\/title>/, '<title>課務管理｜柚子樂器</title>');
scheduler = scheduler.replace(
  /<link rel="stylesheet" href="course-scheduler\.css\?v=[^"]+">(?:\s*<link rel="stylesheet" href="course-scheduler-standalone\.css\?v=[^"]+">)?/,
  `<link rel="stylesheet" href="course-scheduler.css?v=${version}">\n  <link rel="stylesheet" href="course-scheduler-standalone.css?v=${version}">`
);

const sidebar = `    <aside class="sidebar">
      <a class="brand" href="portal.html#overview">
        <div class="brand-icon">♫</div>
        <div><strong>全通路營運中心</strong><small>柚子樂器營運管理</small></div>
      </a>
      <div class="mode-pill" id="sideModeBadge">資料尚未載入</div>
      <nav class="main-nav" aria-label="全通路營運中心選單">
        <a href="portal.html#overview"><span>⌂</span><b>營運總覽</b></a>
        <div class="nav-section-title"><span>課</span><b>課務管理</b></div>
        <button type="button" class="active" data-view="calendar"><span>日</span><b>課程日表</b></button>
        <button type="button" data-view="students"><span>生</span><b>學生與學費</b></button>
        <button type="button" data-view="teachers"><span>師</span><b>老師薪資</b></button>
        <button type="button" data-view="settings"><span>設</span><b>系統設定</b></button>
        <a href="portal.html#sales"><span>＄</span><b>現場銷售</b></a>
        <a href="portal.html#sync"><span>↻</span><b>平台訂單</b></a>
        <a href="portal.html#products"><span>▦</span><b>商品資訊</b></a>
        <a href="portal.html#purchases"><span>⇧</span><b>庫存作業</b></a>
        <a href="portal.html#receivables"><span>帳</span><b>應收帳款</b></a>
        <a href="portal.html#customers"><span>人</span><b>客戶會員</b></a>
        <a href="portal.html#rentals"><span>♫</span><b>租賃營運</b></a>
      </nav>
      <div class="sidebar-foot">
        <a href="settings.html">返回管理首頁</a>
        <button type="button" id="sideNewEvent">＋ 快速新增排課</button>
      </div>
    </aside>`;

if (!/<aside class="sidebar">[\s\S]*?<\/aside>/.test(scheduler)) {
  throw new Error('Unable to locate the full scheduler sidebar.');
}
scheduler = scheduler.replace(/    <aside class="sidebar">[\s\S]*?    <\/aside>/, sidebar);

const scriptStart = scheduler.indexOf('  <script src="config.js');
const bodyEnd = scheduler.lastIndexOf('</body>');
if (scriptStart < 0 || bodyEnd < 0 || scriptStart >= bodyEnd) {
  throw new Error('Unable to locate the full scheduler script block.');
}
const scripts = `  <script src="config.js?v=20260722-course-scheduler-v2"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-functions-compat.js"></script>
  <script src="course-scheduler-data.js?v=${version}"></script>
  <script src="course-scheduler-full-bootstrap.js?v=${version}"></script>
`;
scheduler = scheduler.slice(0, scriptStart) + scripts + scheduler.slice(bodyEnd);
fs.writeFileSync(schedulerPath, scheduler);

const views = ['calendar', 'students', 'teachers', 'settings'];
for (const path of portalPaths) {
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(
    /location\.replace\('course-center\.html#'\+map\[key\]\);/g,
    "location.replace('course-scheduler.html?view='+map[key]);"
  );
  source = source.replace(
    /location\.replace\('course-scheduler\.html\?view='\+map\[key\]\);/g,
    "location.replace('course-scheduler.html?view='+map[key]);"
  );
  for (const view of views) {
    source = source.replace(new RegExp(`course-center\\.html#${view}`, 'g'), `course-scheduler.html?view=${view}`);
  }
  fs.writeFileSync(path, source);
}

const redirect = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>正在開啟完整課務管理</title>
  <script>
    (function(){
      var view=String(location.hash||'#calendar').replace(/^#/,'').split('?')[0];
      if(['calendar','students','teachers','settings'].indexOf(view)<0)view='calendar';
      location.replace('course-scheduler.html?view='+view);
    })();
  </script>
</head>
<body>正在開啟完整課務管理…</body>
</html>
`;
fs.writeFileSync('course-center.html', redirect);

for (const obsolete of ['course-center.js', 'course-center.css', 'course-center-bootstrap.js']) {
  if (fs.existsSync(obsolete)) fs.unlinkSync(obsolete);
}

console.log('Published the complete standalone course scheduler and removed the simplified recovery center.');
