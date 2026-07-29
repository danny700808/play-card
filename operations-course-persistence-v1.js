(function(){
  'use strict';

  var COURSE_HASHES=new Set(['course-calendar','course-students','course-teachers','course-settings']);
  var COURSE_VIEWS={
    'course-calendar':'calendar',
    'course-students':'students',
    'course-teachers':'teachers',
    'course-settings':'settings'
  };
  var LIVE_VERSION='20260729-live-full-scheduler-v3';
  var KEY='youzi.operations.courseWorkspacePosition.v1';
  var content,host,lastCourseHash='',saved=read();

  function hash(){return String(location.hash||'#overview').replace(/^#/,'').split('?')[0]||'overview';}
  function isCourse(value){return COURSE_HASHES.has(String(value||''));}
  function courseView(value){return COURSE_VIEWS[value]||'calendar';}
  function liveUrl(value){return 'course-scheduler-live.html?v='+LIVE_VERSION+'&embed=1&view='+encodeURIComponent(courseView(value));}
  function read(){try{var value=JSON.parse(sessionStorage.getItem(KEY)||'{}');return value&&typeof value==='object'?value:{};}catch(_){return {};}}
  function write(value){saved=value||{};try{sessionStorage.setItem(KEY,JSON.stringify(saved));}catch(_){}}
  function frame(){return document.getElementById('opsCourseFrame');}

  function ensureLiveFrame(node){
    if(!node)return false;
    var current=hash();
    if(!isCourse(current))return false;
    var desired=liveUrl(current),actual=String(node.getAttribute('src')||'');
    var needsChange=actual.indexOf('course-scheduler-live.html')<0||actual.indexOf('v='+LIVE_VERSION)<0;
    if(needsChange){
      node.dataset.courseView=courseView(current);
      node.dataset.liveSchedulerVersion=LIVE_VERSION;
      node.setAttribute('src',desired);
      return true;
    }
    node.dataset.courseView=courseView(current);
    node.dataset.liveSchedulerVersion=LIVE_VERSION;
    try{
      if(node.contentWindow)node.contentWindow.postMessage({type:'youzi-course-view',view:courseView(current)},location.origin);
    }catch(_){}
    return false;
  }

  function capture(){
    var node=frame();if(!node||!node.contentWindow)return;
    try{
      var win=node.contentWindow,doc=node.contentDocument,scroll=doc&&doc.getElementById('scheduleScroll');
      write({hash:lastCourseHash||hash(),windowX:Number(win.scrollX||0),windowY:Number(win.scrollY||0),scheduleLeft:scroll?Number(scroll.scrollLeft||0):0,scheduleTop:scroll?Number(scroll.scrollTop||0):0,capturedAt:Date.now()});
    }catch(_){}
  }

  function restore(expected){
    if(!expected||saved.hash!==expected)return;
    var node=frame();if(!node||!node.contentWindow)return;
    function apply(){
      try{
        var win=node.contentWindow,doc=node.contentDocument,scroll=doc&&doc.getElementById('scheduleScroll');
        win.scrollTo(Number(saved.windowX||0),Number(saved.windowY||0));
        if(scroll){scroll.scrollLeft=Number(saved.scheduleLeft||0);scroll.scrollTop=Number(saved.scheduleTop||0);}
      }catch(_){}
    }
    requestAnimationFrame(function(){requestAnimationFrame(apply);});
    setTimeout(apply,100);setTimeout(apply,260);
  }

  function bind(node){
    if(!node)return;
    ensureLiveFrame(node);
    if(node.dataset.persistenceBound)return;
    node.dataset.persistenceBound='1';
    node.addEventListener('load',function(){
      var current=hash();
      if(isCourse(current)){
        ensureLiveFrame(node);
        try{node.contentWindow.postMessage({type:'youzi-course-view',view:courseView(current)},location.origin);}catch(_){}
        restore(current);
      }
    });
  }

  function move(){
    if(!content||!host)return;
    var workspace=content.querySelector('.ops-course-workspace');
    if(workspace&&workspace.parentNode!==host)host.appendChild(workspace);
    var node=frame();
    if(node){ensureLiveFrame(node);bind(node);}
    sync(false);
  }

  function sync(shouldRestore){
    if(!content||!host)return;
    var current=hash(),active=isCourse(current);
    content.hidden=active;host.hidden=!active;
    content.setAttribute('aria-hidden',active?'true':'false');
    host.setAttribute('aria-hidden',active?'false':'true');
    if(active){
      var same=lastCourseHash===current||saved.hash===current;
      lastCourseHash=current;
      var node=frame();if(node)ensureLiveFrame(node);
      if(shouldRestore&&same)restore(current);
    }
  }

  function onHash(){
    var next=hash();
    if(!isCourse(next)&&!host.hidden)capture();
    var previous=lastCourseHash;
    sync(false);
    var node=frame();if(node&&isCourse(next))ensureLiveFrame(node);
    if(isCourse(next)&&previous===next)restore(next);
  }

  function style(){
    if(document.getElementById('opsCoursePersistenceStyle'))return;
    var node=document.createElement('style');
    node.id='opsCoursePersistenceStyle';
    node.textContent='#opsCoursePersistentHost[hidden],#opsContent[hidden]{display:none!important}#opsCoursePersistentHost{padding-top:0}#opsCoursePersistentHost .ops-course-workspace{min-height:calc(100dvh - 88px)}#opsCoursePersistentHost .ops-course-frame{display:block;width:100%;min-height:calc(100dvh - 88px);border:0;background:#fff}';
    document.head.appendChild(node);
  }

  function init(){
    content=document.getElementById('opsContent');host=document.getElementById('opsCoursePersistentHost');
    if(!content)return;
    if(!host){
      host=document.createElement('section');host.id='opsCoursePersistentHost';host.className='ops-content ops-course-content';host.hidden=true;host.setAttribute('aria-live','polite');content.insertAdjacentElement('afterend',host);
    }
    style();
    new MutationObserver(move).observe(content,{childList:true,subtree:true});
    new MutationObserver(function(){var node=frame();if(node&&isCourse(hash()))ensureLiveFrame(node);}).observe(host,{childList:true,subtree:true});
    addEventListener('hashchange',onHash);addEventListener('pagehide',capture);addEventListener('beforeunload',capture);
    document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'&&!host.hidden)capture();});
    if(isCourse(hash()))lastCourseHash=hash();
    move();sync(true);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
