(function (global) {
  'use strict';

  if (global.__YOUZI_SIMPLE_FULL_COURSE__) return;
  global.__YOUZI_SIMPLE_FULL_COURSE__ = true;

  var VERSION = '20260729-simple-full-v1';
  var CACHE_KEY = 'youzi.operations.simpleFullScheduleHtml.v1';
  var HASH = 'course-calendar';
  var observer = null;
  var queued = false;
  var cachedHtml = readCache();

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function currentHash() {
    return clean(global.location.hash || '#overview').replace(/^#/, '').split('?')[0] || 'overview';
  }

  function isCalendar() {
    return currentHash() === HASH;
  }

  function readCache() {
    try { return global.localStorage.getItem(CACHE_KEY) || ''; }
    catch (_) { return ''; }
  }

  function writeCache(value) {
    cachedHtml = clean(value);
    if (!cachedHtml) return;
    try { global.localStorage.setItem(CACHE_KEY, cachedHtml); } catch (_) {}
  }

  function overviewCard() {
    var content = global.document.getElementById('opsContent');
    if (!content) return null;
    return content.querySelector('.ops-mobile-course-fix-card') || content.querySelector('.ops-approved-schedule-card');
  }

  function cacheOverviewCard() {
    var card = overviewCard();
    if (!card) return false;
    var hasGrid = card.querySelector('.ops-mobile-course-grid,.ops-approved-schedule-grid');
    if (!hasGrid) return false;
    writeCache(card.outerHTML);
    return true;
  }

  function installStyle() {
    if (global.document.getElementById('opsSimpleFullCourseStyle')) return;
    var style = global.document.createElement('style');
    style.id = 'opsSimpleFullCourseStyle';
    style.textContent = [
      '#opsSimpleFullCourse{min-height:calc(100dvh - 88px);padding:12px 12px 30px;color:#173f34}',
      '#opsSimpleFullCourse *{box-sizing:border-box}',
      '#opsSimpleFullCourse .simple-full-tabs{position:sticky;top:0;z-index:30;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;padding:9px;border-radius:17px;background:#153f36;box-shadow:0 10px 24px rgba(12,55,45,.14)}',
      '#opsSimpleFullCourse .simple-full-tabs button{min-height:49px;border:0;border-radius:12px;background:rgba(255,255,255,.08);color:#e9f5f1;font-weight:800;font-size:14px}',
      '#opsSimpleFullCourse .simple-full-tabs button.active{background:#fff;color:#173f34}',
      '#opsSimpleFullCourse .simple-full-note{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-top:12px;padding:13px 15px;border:1px solid #cfe0da;border-radius:17px;background:#fff}',
      '#opsSimpleFullCourse .simple-full-note b{display:block;font-size:17px}',
      '#opsSimpleFullCourse .simple-full-note span{display:block;margin-top:4px;color:#667d76;font-size:12px;line-height:1.55}',
      '#opsSimpleFullCourse .simple-full-back{min-height:42px;padding:8px 14px;border:0;border-radius:11px;background:#167e5e;color:#fff;font-weight:800;white-space:nowrap}',
      '#opsSimpleFullCourse .ops-mobile-course-fix-card,#opsSimpleFullCourse .ops-approved-schedule-card{margin-top:12px!important;overflow:hidden;border:1px solid #cfe0da;border-radius:17px;background:#fff;box-shadow:0 8px 22px rgba(17,73,58,.06)}',
      '#opsSimpleFullCourse .ops-card-head{padding:15px 16px 12px}',
      '#opsSimpleFullCourse .ops-card-head h2{font-size:22px}',
      '#opsSimpleFullCourse .ops-card-head .ops-approved-link-button{display:none!important}',
      '#opsSimpleFullCourse .ops-mobile-course-wrap,#opsSimpleFullCourse .ops-approved-schedule-wrap{width:100%;padding:0 10px 12px;overflow:auto!important;-webkit-overflow-scrolling:touch}',
      '#opsSimpleFullCourse .ops-mobile-course-grid{--slot-height:34px!important;min-width:max(920px,100%)!important;grid-template-columns:58px repeat(var(--room-count),minmax(78px,1fr))!important;grid-template-rows:44px repeat(var(--slot-count),var(--slot-height))!important;overflow:visible!important}',
      '#opsSimpleFullCourse .ops-mobile-course-room,#opsSimpleFullCourse .ops-mobile-course-corner{font-size:11px!important;line-height:1.15!important;padding:5px 3px!important;word-break:normal!important}',
      '#opsSimpleFullCourse .ops-mobile-course-time{font-size:10px!important;padding-top:5px!important}',
      '#opsSimpleFullCourse .ops-mobile-course-event{margin:2px!important;padding:5px 3px!important;border-radius:7px!important}',
      '#opsSimpleFullCourse .ops-mobile-course-event b{font-size:11px!important;line-height:1.15!important;max-height:none!important;word-break:normal!important}',
      '#opsSimpleFullCourse .ops-approved-schedule-grid{min-width:max(920px,100%)!important}',
      '#opsSimpleFullCourse .simple-full-empty{display:grid;place-items:center;min-height:520px;margin-top:12px;padding:26px;border:1px solid #cfe0da;border-radius:17px;background:#fff;text-align:center}',
      '#opsSimpleFullCourse .simple-full-empty b{display:block;font-size:18px}',
      '#opsSimpleFullCourse .simple-full-empty span{display:block;margin-top:8px;color:#6b817a;line-height:1.6}',
      '@media(max-width:640px){#opsSimpleFullCourse{padding:8px 8px 24px}#opsSimpleFullCourse .simple-full-tabs{gap:5px;padding:7px}#opsSimpleFullCourse .simple-full-tabs button{min-height:45px;font-size:12px}#opsSimpleFullCourse .simple-full-note{align-items:flex-start;flex-direction:column}#opsSimpleFullCourse .simple-full-back{width:100%}}'
    ].join('');
    global.document.head.appendChild(style);
  }

  function tabsHtml() {
    return '<nav class="simple-full-tabs" aria-label="課務管理">'
      + '<button type="button" class="active" data-simple-course-hash="course-calendar">課程日表</button>'
      + '<button type="button" data-simple-course-hash="course-students">學生與學費</button>'
      + '<button type="button" data-simple-course-hash="course-teachers">老師與薪資</button>'
      + '<button type="button" data-simple-course-hash="course-settings">系統設定</button>'
      + '</nav>';
  }

  function prepareCard(html) {
    var box = global.document.createElement('div');
    box.innerHTML = html;
    var card = box.querySelector('.ops-mobile-course-fix-card,.ops-approved-schedule-card');
    if (!card) return '';
    card.classList.add('simple-full-course-card');
    var title = card.querySelector('h2');
    if (title) title.textContent = '完整課表';
    card.querySelectorAll('[data-nav="course-calendar"],.ops-approved-link-button').forEach(function (node) {
      if (node.matches('button,a')) node.remove();
      else node.removeAttribute('data-nav');
    });
    card.querySelectorAll('.ops-mobile-course-event,.ops-approved-schedule-event').forEach(function (node) {
      node.removeAttribute('data-nav');
      node.type = 'button';
    });
    return card.outerHTML;
  }

  function shellHtml() {
    var cardHtml = prepareCard(cachedHtml || readCache());
    var html = tabsHtml();
    html += '<section class="simple-full-note"><div><b>完整課表使用營運總覽同一份資料</b><span>目前保留並顯示上次成功保存的課表。只有你主動按「更新音教雲最新資料」且更新成功後，內容才會換成新資料；更新過程不會先清空舊課表。</span></div><button type="button" class="simple-full-back" data-simple-course-home>返回營運總覽</button></section>';
    if (cardHtml) return html + cardHtml;
    return html + '<section class="simple-full-empty"><div><b>正在取得營運總覽課表</b><span>請先返回營運總覽，等簡易課表出現後再按「完整課表」。系統會直接把同一張課表放大顯示，不再開啟另一套複雜課表。</span></div></section>';
  }

  function hostNode() {
    return global.document.getElementById('opsCoursePersistentHost');
  }

  function render() {
    queued = false;
    if (!isCalendar()) return;
    installStyle();
    cacheOverviewCard();
    var host = hostNode();
    if (!host) return;
    host.hidden = false;
    host.setAttribute('aria-hidden', 'false');
    host.querySelectorAll('.ops-course-workspace').forEach(function (node) { node.remove(); });
    var root = host.querySelector('#opsSimpleFullCourse');
    if (!root) {
      root = global.document.createElement('div');
      root.id = 'opsSimpleFullCourse';
      host.appendChild(root);
    }
    root.dataset.version = VERSION;
    root.innerHTML = shellHtml();
    bind(root);
  }

  function queueRender() {
    if (queued) return;
    queued = true;
    global.requestAnimationFrame(render);
  }

  function bind(root) {
    root.querySelectorAll('[data-simple-course-hash]').forEach(function (button) {
      button.addEventListener('click', function () { global.location.hash = button.dataset.simpleCourseHash; });
    });
    var home = root.querySelector('[data-simple-course-home]');
    if (home) home.addEventListener('click', function () { global.location.hash = 'overview'; });
  }

  function removeWhenInactive() {
    if (isCalendar()) return;
    var host = hostNode();
    var root = host && host.querySelector('#opsSimpleFullCourse');
    if (root) root.remove();
  }

  function start() {
    installStyle();
    cacheOverviewCard();
    observer = new MutationObserver(function () {
      if (currentHash() === 'overview') cacheOverviewCard();
      if (isCalendar()) queueRender();
    });
    observer.observe(global.document.body, { childList: true, subtree: true });
    global.document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest && event.target.closest('[data-nav="course-calendar"],a[href="#course-calendar"]');
      if (target) cacheOverviewCard();
    }, true);
    global.addEventListener('hashchange', function () {
      if (isCalendar()) queueRender();
      else removeWhenInactive();
    });
    global.addEventListener('pageshow', function () {
      if (currentHash() === 'overview') cacheOverviewCard();
      if (isCalendar()) queueRender();
    });
    global.addEventListener('youzi-course-auto-data-ready', function () {
      global.setTimeout(function () {
        cacheOverviewCard();
        if (isCalendar()) queueRender();
      }, 60);
    });
    if (isCalendar()) queueRender();
  }

  global.YouziSimpleFullCourse = {
    refresh: queueRender,
    cacheOverview: cacheOverviewCard
  };

  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
