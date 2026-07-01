(function(){
  'use strict';
  if(window.__YZ_ACTION_PROGRESS_SAFE__) return;
  window.__YZ_ACTION_PROGRESS_SAFE__ = true;

  function clean(v){ return String(v == null ? '' : v).replace(/\s+/g,' ').trim(); }
  function ensureStyle(){
    if(document.getElementById('yzActionProgressSafeStyle')) return;
    var style=document.createElement('style');
    style.id='yzActionProgressSafeStyle';
    style.textContent = `
      .btn-progress,.yz-progress-btn{position:relative!important;overflow:hidden!important;}
      .btn-progress .btn-progress-fill,.yz-progress-btn .btn-progress-fill{position:absolute;left:0;top:0;bottom:0;width:0%;background:rgba(255,255,255,.28);transition:width .22s ease;z-index:0;}
      .btn-progress .btn-progress-label,.yz-progress-btn .btn-progress-label{position:relative;z-index:1;color:inherit;}
      .btn-progress.is-loading,.yz-progress-btn.is-loading{background:#1f7a5a!important;color:#fff!important;border-color:#1f7a5a!important;}
      .btn-progress.is-success,.yz-progress-btn.is-success{background:#146c43!important;color:#fff!important;border-color:#146c43!important;}
      .btn-progress.is-error,.yz-progress-btn.is-error{background:#b42318!important;color:#fff!important;border-color:#b42318!important;}
      .yz-action-inline-status{margin:10px 0 0;padding:12px 14px;border-radius:14px;border:1px solid #cfe3d8;background:#eef9f2;color:#146c43;font-weight:900;line-height:1.7;box-sizing:border-box;}
      .yz-action-inline-status.bad{background:#fff0f0;color:#b42318;border-color:#fecaca;}
      .yz-action-inline-status.ok{background:#e8fff4;color:#146c43;border-color:#b7e4c7;}
    `;
    document.head.appendChild(style);
  }
  function progressStore(){ if(!window.__YZ_BTN_PROGRESS_MAP__) window.__YZ_BTN_PROGRESS_MAP__ = new WeakMap(); return window.__YZ_BTN_PROGRESS_MAP__; }
  function ensureButton(btn){
    ensureStyle();
    if(!btn) return null;
    var idle = clean(btn.dataset && btn.dataset.idleText ? btn.dataset.idleText : (btn.textContent || btn.value || '處理')) || '處理';
    btn.dataset.idleText = idle;
    if(btn.dataset.progressReady === '1'){
      return {fill:btn.querySelector('.btn-progress-fill'), label:btn.querySelector('.btn-progress-label')};
    }
    btn.classList.add('btn-progress','yz-progress-btn');
    btn.textContent='';
    var fill=document.createElement('span'); fill.className='btn-progress-fill';
    var label=document.createElement('span'); label.className='btn-progress-label'; label.textContent=idle;
    btn.appendChild(fill); btn.appendChild(label);
    btn.dataset.progressReady='1';
    return {fill:fill,label:label};
  }
  function setIdle(btn,text){
    if(!btn) return;
    var nodes=ensureButton(btn); if(!nodes) return;
    var idle=clean(text || btn.dataset.idleText || nodes.label.textContent || '處理') || '處理';
    if(text) btn.dataset.idleText=idle;
    var old=progressStore().get(btn); if(old && old.timer) clearInterval(old.timer);
    progressStore().delete(btn);
    btn.disabled=false;
    btn.classList.remove('is-loading','is-success','is-error');
    if(nodes.fill) nodes.fill.style.width='0%';
    if(nodes.label) nodes.label.textContent=idle;
  }
  function start(btn, options){
    options=options||{};
    var nodes=ensureButton(btn); if(!nodes) return {set:function(){},done:function(){},fail:function(){},reset:function(){}};
    var old=progressStore().get(btn); if(old && old.timer) clearInterval(old.timer);
    var label=clean(options.label || options.text || '處理中') || '處理中';
    var steps=Array.isArray(options.steps) && options.steps.length ? options.steps : [10,20,30,40,50,60,70,80,90];
    var state={pct:Number(options.startPct==null?steps[0]:options.startPct)||10,label:label,idx:0};
    function render(){
      var pct=Math.max(0,Math.min(100,Math.round(state.pct)));
      if(nodes.fill) nodes.fill.style.width=pct+'%';
      if(nodes.label) nodes.label.textContent=(state.label||label)+' '+pct+'%';
    }
    btn.disabled=true;
    btn.classList.add('is-loading'); btn.classList.remove('is-success','is-error');
    render();
    var timer=null;
    if(options.auto!==false){
      timer=setInterval(function(){
        var next=steps[Math.min(state.idx, steps.length-1)];
        state.idx += 1;
        if(next != null && next > state.pct){ state.pct=next; render(); }
      }, Number(options.interval||260));
    }
    function clear(){ var cur=progressStore().get(btn); if(cur && cur.timer) clearInterval(cur.timer); }
    var api={
      button:btn,
      set:function(percent,newLabel){ if(newLabel!=null) state.label=clean(newLabel)||state.label; state.pct=Number(percent)||state.pct; render(); },
      done:function(text,holdMs,keepDisabled){ clear(); state.pct=100; btn.classList.remove('is-loading','is-error'); btn.classList.add('is-success'); if(nodes.fill) nodes.fill.style.width='100%'; if(nodes.label) nodes.label.textContent='✓ '+(clean(text)||'完成'); btn.disabled=!!keepDisabled; if(!keepDisabled) setTimeout(function(){setIdle(btn);}, holdMs==null?900:holdMs); },
      fail:function(text,holdMs){ clear(); state.pct=100; btn.classList.remove('is-loading','is-success'); btn.classList.add('is-error'); if(nodes.fill) nodes.fill.style.width='100%'; if(nodes.label) nodes.label.textContent=clean(text)||'處理失敗'; btn.disabled=false; setTimeout(function(){setIdle(btn);}, holdMs==null?1400:holdMs); },
      reset:function(text){ clear(); setIdle(btn,text); }
    };
    progressStore().set(btn,{timer:timer,api:api});
    return api;
  }
  if(typeof window.startActionButtonProgress !== 'function') window.startActionButtonProgress=start;
  if(typeof window.setActionButtonIdle !== 'function') window.setActionButtonIdle=setIdle;
  if(typeof window.finishActionButtonSuccess !== 'function') window.finishActionButtonSuccess=function(btn,text,holdMs,keepDisabled){var p=start(btn,{auto:false,label:text||'完成',startPct:100});p.done(text||'完成',holdMs,keepDisabled);return p;};
  if(typeof window.finishActionButtonError !== 'function') window.finishActionButtonError=function(btn,text,holdMs){var p=start(btn,{auto:false,label:text||'失敗',startPct:100});p.fail(text||'處理失敗',holdMs);return p;};
  window.yzActionFeedback={begin:start,done:function(btn,text){window.finishActionButtonSuccess(btn,text);},fail:function(btn,text){window.finishActionButtonError(btn,text);}};
  ensureStyle();
})();
