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

/* 打卡頁規則：班段進行中只能正常／特殊打卡，補打卡於班段結束後才開放。 */
(function(global){
  'use strict';
  var page=String((global.location&&global.location.pathname)||'').split('/').pop().toLowerCase();
  if(page!=='clock.html'||global.__YZ_CLOCK_ACTIVE_SHIFT_GUARD_INLINE_V1__) return;
  global.__YZ_CLOCK_ACTIVE_SHIFT_GUARD_INLINE_V1__=true;
  var GRACE=5;
  function text(v){return String(v==null?'':v).trim();}
  function dateText(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
  function minutes(v){var m=text(v).slice(0,5).match(/^(\d{1,2}):(\d{2})$/);if(!m)return null;var h=Number(m[1]),mi=Number(m[2]);return h>=0&&h<=23&&mi>=0&&mi<=59?h*60+mi:null;}
  function first(){for(var i=0;i<arguments.length;i+=1){var v=text(arguments[i]);if(v)return v;}return '';}
  function active(issue){issue=issue||{};var s=issue.schedule||issue.scheduleSnapshot||{};var d=first(issue.date,issue.scheduleDate,issue.correctDate,s.date,s.scheduleDate);var end=minutes(first(issue.endTime,issue.scheduleEndTime,s.endTime,s.scheduleEndTime));if(!d||end==null||d!==dateText(new Date()))return false;var now=new Date();return now.getHours()*60+now.getMinutes()<end+GRACE;}
  function pending(issue){var st=text(issue&&(issue.statusLabel||issue.status));return !!(issue&&(issue.pendingCorrection||issue.pendingLeave||issue.pendingSpecialClock||st.indexOf('待主管審核')>=0||st.indexOf('待審核')>=0));}
  function filterRows(result){if(!result||!Array.isArray(result.rows))return result;var rows=result.rows.map(function(issue){if(!issue||pending(issue)||!active(issue))return issue;var old=Array.isArray(issue.missingActions)?issue.missingActions:[];var next=old.filter(function(action){var a=text(action);return a.indexOf('上班')<0&&a.indexOf('下班')<0;});if(next.length===old.length)return issue;if(!next.length&&!issue.canEarlyLeaveRetro)return null;return Object.assign({},issue,{missingActions:next,activeShiftClockRequired:true,supplementBlockedReason:'班段仍在進行中，請使用正常打卡；補打卡只在班段結束後開放。'});}).filter(Boolean);return Object.assign({},result,{rows:rows});}
  function block(payload){payload=payload||{};if(text(payload.requestKind)!=='missingClock')return false;var action=text(payload.correctAction);if(action.indexOf('上班')<0&&action.indexOf('下班')<0)return false;return active({date:payload.scheduleDate||payload.correctDate,endTime:payload.scheduleEndTime||payload.endTime,scheduleSnapshot:payload.scheduleSnapshot||{}});}
  function message(payload){return text(payload&&payload.correctAction).indexOf('上班')>=0?'這個班段仍在進行中，不能使用補上班卡。請立即使用「標準打卡」，系統會記錄實際到班時間與遲到分鐘；若因網路或外出等特殊原因無法正常打卡，請改用「特殊打卡」送主管審核。':'這個班段仍在進行中，不能使用補下班卡。請在班段結束時使用正常下班打卡；特殊狀況請依特殊打卡或請假流程處理。';}
  function install(){var original=global.api;if(typeof original!=='function')return false;if(original.__activeShiftSupplementGuardV1)return true;var wrapped=async function(action,payload){if(action==='submitClockCorrection'&&block(payload))return {ok:false,activeShiftClockRequired:true,message:message(payload)};var result=await original.apply(this,arguments);return action==='getClockCompletionIssues'?filterRows(result):result;};wrapped.__activeShiftSupplementGuardV1=true;wrapped.__originalApi=original;global.api=wrapped;return true;}
  function copy(){var note=document.querySelector('.missing-clock-note');if(note)note.textContent='系統會檢查今日與昨日班表。班段進行中若遲到，請直接使用標準打卡，系統會記錄實際到班時間；補打卡只在班段結束後、確定漏打時開放，並送主管審核。';var items=Array.from(document.querySelectorAll('.help-box li'));var item=items.find(function(x){return text(x.textContent).indexOf('如果已經有打卡紀錄但時間錯誤')>=0;});if(item)item.innerHTML='<strong>遲到仍要正常打卡：</strong>系統會照實記錄到班時間與遲到分鐘；有異議再提出修正。只有班段結束後確定漏打，才可從「待處理事項」提出補打卡。';}
  install();var timer=global.setInterval(function(){if(install())global.clearInterval(timer);},200);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',copy,{once:true});else copy();global.addEventListener('pageshow',copy);
})(window);
