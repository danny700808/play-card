'use strict';

const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, text) {
  fs.writeFileSync(path, text);
}

function replaceRequired(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`找不到要修改的內容：${label}`);
  return text.replace(from, to);
}

function patchScheduler() {
  const path = 'course-scheduler.js';
  let text = read(path);
  const start = text.lastIndexOf('  function init(){');
  const endMarker = "  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();";
  const endStart = text.indexOf(endMarker, start);
  if (start < 0 || endStart < 0) throw new Error('找不到完整課表 init 區塊');
  const end = endStart + endMarker.length;
  const replacement = `  var schedulerInitialized=false;
  function startupSnapshot(result){
    var source=result&&result.snapshot;
    if(!source||Number(source.version)!==3)return null;
    var hasRooms=Array.isArray(source.rooms)&&source.rooms.length>0;
    var hasSchedule=['events','recurringRules','fixedCourses','temporaryCourses','roomRentals'].some(function(key){return Array.isArray(source[key])&&source[key].length>0;});
    return hasRooms&&hasSchedule?clone(source):null;
  }
  function reportStartupError(error){
    var message=clean(error&&error.message||error)||'完整課表載入失敗';
    try{console.error('[course scheduler startup]',error);}catch(_){}
    var meta=document.getElementById('dataModeMeta');if(meta)meta.textContent=message;
  }
  async function init(){
    if(schedulerInitialized)return;
    schedulerInitialized=true;
    try{localStorage.removeItem('youzi.courseScheduler.sandbox.v1');localStorage.removeItem('youzi.courseScheduler.sandboxUndo.v1');localStorage.removeItem('youzi.courseScheduler.lastMode.v1');}catch(_){}
    embeddedMode=urlOption('embed')==='1';document.body.classList.toggle('embedded-in-operations',embeddedMode);requestPersistentStorage();
    var readyResult=null;
    try{
      if(window.YouziCourseAutoDataReady&&typeof window.YouziCourseAutoDataReady.then==='function')readyResult=await window.YouziCourseAutoDataReady;
      else if(window.YouziCourseAutoData&&typeof window.YouziCourseAutoData.ensure==='function')readyResult=await window.YouziCourseAutoData.ensure();
    }catch(error){reportStartupError(error);}
    var readySnapshot=startupSnapshot(readyResult);
    if(readySnapshot){
      state=normalizeState(readySnapshot);state.readOnly=false;state.dataMode='sandbox';state.clipboard=null;
      formalState=normalizeState(clone(readySnapshot));formalState.readOnly=true;formalState.dataMode='migration';formalState.clipboard=null;
      try{localStorage.setItem(FORMAL_CACHE_KEY,JSON.stringify(formalState));}catch(_){}
      await storeSynchronizedDatabases(formalState,state);
    }else{
      state=loadInitialState();if(!formalState&&state.readOnly&&state.dataMode!=='empty')formalState=clone(state);
    }
    bindEvents();refreshFormOptions();updateModeUI();switchView(requestedView());
    if(!readySnapshot)await restoreFormalDatabase();
    if(window.__YOUZI_COURSE_SCHEDULER_TEST__===true)window.YouziCourseSchedulerTest={snapshot:function(){return clone(state);},eventsForDate:function(date){return clone(eventsForDate(date));},effectiveEventsForDate:function(date){return clone(effectiveEventsForDate(date));},storeFormalCache:function(source){return storeFormalCache(source);},readFormalDatabase:readFormalDatabase,storeFormalDatabase:storeFormalDatabase,readWorkspaceDatabase:readWorkspaceDatabase,storeWorkspaceDatabase:storeWorkspaceDatabase,restoreFormalDatabase:restoreFormalDatabase};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){init().catch(reportStartupError);});else init().catch(reportStartupError);`;
  text = text.slice(0, start) + replacement + text.slice(end);
  write(path, text);
}

function patchReviewData() {
  const path = 'course-scheduler-review-data.js';
  let text = read(path);
  const loaderStart = text.indexOf('\n(function loadAutomaticCourseBootstrap()');
  if (loaderStart >= 0) text = text.slice(0, loaderStart).trimEnd() + '\n';
  write(path, text);
}

function patchSchedulerHtml() {
  const path = 'course-scheduler.html';
  let text = read(path);
  text = text.replace(/course-scheduler\.css\?v=[^"']+/g, 'course-scheduler.css?v=20260729-full-scheduler-v4');
  text = text.replace(/\n\s*<script src="course-data-auto-bootstrap-v1\.js[^>]*><\/script>/g, '');
  const scriptsPattern = /\n\s*<script src="course-scheduler-data\.js[^>]*><\/script>\s*\n\s*<script src="course-scheduler-review-data\.js[^>]*><\/script>\s*\n\s*<script src="course-scheduler\.js[^>]*><\/script>/;
  if (!scriptsPattern.test(text)) throw new Error('找不到完整課表腳本載入區塊');
  text = text.replace(scriptsPattern, `
  <script src="course-scheduler-data.js?v=20260729-full-scheduler-v4"></script>
  <script src="course-data-auto-bootstrap-v1.js?v=20260729-auto-cloud-v5"></script>
  <script src="course-scheduler-review-data.js?v=20260729-full-scheduler-v4"></script>
  <script src="course-scheduler.js?v=20260729-full-scheduler-v4"></script>`);
  write(path, text);
}

function patchMobileHome() {
  const path = 'operations-mobile-home-v1.js';
  let text = read(path);
  text = text.replace("var VERSION = 'approved-mobile-home-v1';", "var VERSION = 'approved-mobile-home-v2';");
  const oldBlock = `    if (details) {
      details.insertAdjacentHTML('beforebegin', scheduleHtml() + productsHtml());
    } else if (quick) {
      quick.insertAdjacentHTML('afterend', scheduleHtml() + productsHtml());
    } else {
      content.insertAdjacentHTML('beforeend', scheduleHtml() + productsHtml());
    }`;
  const newBlock = `    if (details) {
      details.insertAdjacentHTML('beforebegin', productsHtml());
    } else if (quick) {
      quick.insertAdjacentHTML('afterend', productsHtml());
    } else {
      content.insertAdjacentHTML('beforeend', productsHtml());
    }`;
  text = replaceRequired(text, oldBlock, newBlock, 'mobile-home 重複課表');
  write(path, text);
}

function patchMobileCourse() {
  const path = 'operations-mobile-course-fix-v1.js';
  let text = read(path);
  const oldBlock = `    var original = content.querySelector('.ops-approved-schedule-card');
    var current = content.querySelector('.ops-mobile-course-fix-card');
    if (current) current.outerHTML = scheduleCardHtml();
    else if (original) original.outerHTML = scheduleCardHtml();`;
  const newBlock = `    var original = content.querySelector('.ops-approved-schedule-card');
    var current = content.querySelector('.ops-mobile-course-fix-card');
    if (current) current.outerHTML = scheduleCardHtml();
    else if (original) original.outerHTML = scheduleCardHtml();
    else {
      var productCard = content.querySelector('.ops-approved-products-card');
      var details = document.getElementById('opsMobileOverviewDetails');
      var quick = content.querySelector('.ops-mobile-direct-card');
      if (productCard) productCard.insertAdjacentHTML('beforebegin', scheduleCardHtml());
      else if (details) details.insertAdjacentHTML('beforebegin', scheduleCardHtml());
      else if (quick) quick.insertAdjacentHTML('afterend', scheduleCardHtml());
      else content.insertAdjacentHTML('beforeend', scheduleCardHtml());
    }
    content.querySelectorAll('.ops-approved-schedule-card').forEach(function (node) { node.remove(); });`;
  text = replaceRequired(text, oldBlock, newBlock, '唯一首頁簡易課表');
  write(path, text);
}

function patchOperationsEntry() {
  {
    const path = 'operations-phase1.js';
    let text = read(path);
    text = text.replace(/course-scheduler\.html\?cv=[^&"']+&embed=1/g, 'course-scheduler.html?cv=20260729-full-scheduler-v4&embed=1');
    write(path, text);
  }
  for (const path of ['operations-hub.html', 'portal.html']) {
    let text = read(path);
    text = text.replace(/operations-phase1\.js\?v=[^"']+/g, 'operations-phase1.js?v=20260729-full-scheduler-v5');
    text = text.replace(/operations-mobile-home-v1\.js\?v=[^"']+/g, 'operations-mobile-home-v1.js?v=20260729-approved-mobile-home-v2');
    text = text.replace(/operations-mobile-course-fix-v1\.js\?v=[^"']+/g, 'operations-mobile-course-fix-v1.js?v=20260729-mobile-course-fix-v3');
    write(path, text);
  }
}

function patchTests() {
  const path = 'tests/course-auto-cloud-load.test.js';
  let text = read(path);
  const oldAssertion = "assert(reviewData.includes('loadAutomaticCourseBootstrap'), '獨立課程日表未在初始化前啟動自動復原');";
  const newAssertions = "assert(!reviewData.includes('loadAutomaticCourseBootstrap'), '完整課表不得再動態重複載入主程式');\nassert(scheduler.includes('async function init()'), '完整課表初始化沒有等待課務資料');\nassert(scheduler.includes('window.YouziCourseAutoDataReady'), '完整課表未等待自動課務資料完成');\nassert(schedulerHtml.includes('course-data-auto-bootstrap-v1.js'), '完整課表 HTML 未直接載入自動課務資料');";
  text = replaceRequired(text, oldAssertion, newAssertions, '完整課表啟動測試');
  write(path, text);
}

patchScheduler();
patchReviewData();
patchSchedulerHtml();
patchMobileHome();
patchMobileCourse();
patchOperationsEntry();
patchTests();
console.log('Full scheduler and mobile overview patch completed.');
