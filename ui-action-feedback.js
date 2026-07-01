(function(){
  'use strict';

  // 2026-07 reset version
  // 目的：移除前一版會重複插入訊息、搬動訊息、卡在「確認中」的作法。
  // 這版只做兩件事：
  // 1. 已經有 startActionButtonProgress 的按鈕，沿用原本按鈕進度，但統一為 10/20/30... 的百分比。
  // 2. 沒有自帶進度的按鈕，顯示單一綠底白字進度框；每次只保留一個，不堆疊、不搬動既有訊息、不改資料流程。

  if (window.__YZ_ACTION_FEEDBACK_PROGRESS_RESET__) return;
  window.__YZ_ACTION_FEEDBACK_PROGRESS_RESET__ = true;

  var GREEN = '#1f7a5a';
  var GREEN_DARK = '#146c43';
  var RED = '#b42318';
  var SEQUENCE = [10,20,30,40,50,60,70,80,90];
  var AUTO_FINISH_MS = 7000;
  var ALERT_CAPTURE_MS = 20000;
  var active = null;
  var pending = null;
  var nativeAlert = window.alert;

  function clean(v){ return String(v == null ? '' : v).replace(/\s+/g,' ').trim(); }
  function now(){ return Date.now(); }
  function isElement(el){ return !!(el && el.nodeType === 1); }
  function isVisible(el){
    if(!isElement(el)) return false;
    try{
      var st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
    }catch(_){ return true; }
  }
  function actionText(btn){
    return clean((btn && (btn.getAttribute('data-yz-label') || btn.textContent || btn.value || btn.getAttribute('aria-label'))) || '');
  }
  function isExcluded(btn){
    if(!isElement(btn)) return true;
    if(btn.getAttribute('data-yz-no-feedback') === '1') return true;
    if(btn.closest('[data-yz-no-feedback="1"],.yz-no-feedback')) return true;
    if(btn.matches('.yz-nav-btn,[data-yz-nav-back],[data-yz-nav-logout],.tab,.tabs button,.approval-tab,.section-tab,[data-close],[data-cancel]')) return true;
    var text = actionText(btn);
    if(!text) return true;
    if(/^(回|返回|回到|上一頁|回首頁|回登入|取消|關閉|清空|清空表單|停止|列印|預覽|開啟官方 LINE|開啟官方LINE|我知道了)$/.test(text)) return true;
    if(/回上一頁|返回上一頁|回到上一頁|回首頁|回登入|開啟官方 LINE|開啟官方LINE|列印預覽/.test(text)) return true;
    if(/^(全部|待審核|已核准|已駁回|已退回|歷史紀錄|未處理|有遲到|有請假|資料需確認)$/.test(text)) return true;
    // 單純切換或新增一列，不需要顯示送出進度。
    if(/^新增/.test(text) && !/(儲存|送出|申請|建立|上傳)/.test(text)) return true;
    return false;
  }
  function isAction(btn){
    if(isExcluded(btn)) return false;
    var text = actionText(btn);
    return /(登入|密碼|送出|提交|申請|儲存|保存|寄送|寄出|發送|通知|回傳|確認|檢查|驗證|複製|核准|駁回|退回|補件|上傳|刪除|移除|取消申請|成立|完成|結案|搜尋|查詢|讀取|載入|簽名|簽署|建立|下載|匯出|PDF|另存|產生|發布|公告|開立|核發|審核|審查|啟用|停用|封存|解封|離職|結束合作|指派|派發|分派|匯入|續約|續租|更新|變更)/.test(text);
  }
  function runningLabel(text){
    text = clean(text);
    if(/登入/.test(text)) return '登入中';
    if(/暫時密碼|寄送|寄出|發送/.test(text) && !/重設/.test(text)) return '寄送中';
    if(/重設|更新|變更/.test(text)) return '更新中';
    if(/註冊|基本資料|送出|提交|申請/.test(text)) return '送出中';
    if(/契約|合約/.test(text) && /送出|確認|簽署|簽名/.test(text)) return '契約送出中';
    if(/簽名|簽署/.test(text)) return '簽署中';
    if(/儲存|保存/.test(text)) return '儲存中';
    if(/上傳/.test(text)) return '上傳中';
    if(/下載|PDF|另存|匯出|產生/.test(text)) return '產生中';
    if(/讀取|載入/.test(text)) return '讀取中';
    if(/搜尋|查詢/.test(text)) return '查詢中';
    if(/檢查|驗證|確認/.test(text)) return '確認中';
    if(/複製/.test(text)) return '複製中';
    if(/核准|通過/.test(text)) return '核准中';
    if(/駁回/.test(text)) return '駁回中';
    if(/退回|補件/.test(text)) return '退回中';
    if(/發布|公告/.test(text)) return '發布中';
    if(/開立|核發/.test(text)) return '開立中';
    if(/審核|審查/.test(text)) return '審核中';
    if(/啟用|停用|封存|解封|離職|結束合作/.test(text)) return '更新中';
    if(/指派|派發|分派/.test(text)) return '指派中';
    if(/匯入/.test(text)) return '匯入中';
    if(/通知|回傳/.test(text)) return '通知建立中';
    if(/刪除|移除/.test(text)) return '刪除中';
    if(/取消/.test(text)) return '取消中';
    if(/續約|續租/.test(text)) return '續約處理中';
    return '處理中';
  }
  function doneLabel(label){
    label = clean(label || '處理中');
    if(/登入/.test(label)) return '登入完成';
    if(/寄送/.test(label)) return '寄送完成';
    if(/更新/.test(label)) return '更新完成';
    if(/送出/.test(label)) return '送出完成';
    if(/契約/.test(label)) return '契約送出完成';
    if(/簽署|簽名/.test(label)) return '簽署完成';
    if(/儲存/.test(label)) return '儲存完成';
    if(/上傳/.test(label)) return '上傳完成';
    if(/產生/.test(label)) return '產生完成';
    if(/讀取/.test(label)) return '讀取完成';
    if(/查詢/.test(label)) return '查詢完成';
    if(/確認/.test(label)) return '確認完成';
    if(/複製/.test(label)) return '複製完成';
    if(/核准/.test(label)) return '核准完成';
    if(/駁回/.test(label)) return '駁回完成';
    if(/退回/.test(label)) return '退回完成';
    if(/發布/.test(label)) return '發布完成';
    if(/開立/.test(label)) return '開立完成';
    if(/審核/.test(label)) return '審核完成';
    if(/指派/.test(label)) return '指派完成';
    if(/刪除/.test(label)) return '刪除完成';
    if(/取消/.test(label)) return '取消完成';
    if(/續約/.test(label)) return '續約處理完成';
    return '處理完成';
  }
  function statusLooksBad(text){
    return /失敗|錯誤|無法|尚未|請先|必填|不完整|過期|沒有|找不到|不符|未完成|失效|權限/.test(clean(text));
  }
  function hostFor(btn){
    if(!isElement(btn)) return null;
    var host = btn.closest('.binding-actions,.toolbar,.final-actions,.login-actions-stack,.submit-actions,.form-actions,.button-row,.btn-row,.actions,.admin-actions,.rental-actions,.contract-actions,.approval-actions,.cert-actions,.settings-actions,.quote-actions,.modal-actions,.small-actions,.item-actions,.card-actions');
    if(host && isVisible(host)) return host;
    return btn;
  }
  function removeOldArtifacts(){
    document.querySelectorAll('.yz-action-status,#yzGlobalActionStatus,[data-yz-action-status="1"],#yzProgressFeedback').forEach(function(el){
      try{ el.remove(); }catch(_){ }
    });
    document.querySelectorAll('.yz-feedback-active,.yz-feedback-success,.yz-feedback-error').forEach(function(el){
      el.classList.remove('yz-feedback-active','yz-feedback-success','yz-feedback-error');
      el.style.removeProperty('--yz-feedback-progress');
      el.removeAttribute('aria-busy');
    });
    var old = document.getElementById('yzActionFeedbackStyle');
    if(old) try{ old.remove(); }catch(_){ }
  }
  function box(){
    var el = document.getElementById('yzProgressFeedback');
    if(!el){
      el = document.createElement('div');
      el.id = 'yzProgressFeedback';
      el.className = 'yz-progress-feedback';
      el.innerHTML = '<div class="yz-progress-text">處理中 10%</div><div class="yz-progress-track"><div class="yz-progress-fill"></div></div>';
    }
    return el;
  }
  function place(btn){
    var el = box();
    var host = hostFor(btn);
    if(host && host.parentNode){
      if(el.parentNode !== host.parentNode || el.previousElementSibling !== host){
        host.parentNode.insertBefore(el, host.nextSibling);
      }
    }else if(document.body){
      document.body.appendChild(el);
    }
    return el;
  }
  function setProgress(el, pct, text, mode){
    pct = Math.max(0, Math.min(100, Number(pct)||0));
    var t = el.querySelector('.yz-progress-text');
    var f = el.querySelector('.yz-progress-fill');
    if(t) t.textContent = clean(text || '處理中') + ' ' + Math.round(pct) + '%';
    if(f) f.style.width = pct + '%';
    el.className = 'yz-progress-feedback ' + (mode || 'running');
    el.style.display = 'block';
  }
  function clearTimer(st){
    if(!st) return;
    if(st.timer) clearInterval(st.timer);
    if(st.finishTimer) clearTimeout(st.finishTimer);
    if(st.hideTimer) clearTimeout(st.hideTimer);
  }
  function start(btn, explicitLabel){
    if(!isElement(btn) || !isAction(btn)) return null;
    pending = null;
    // 若原頁面自己的按鈕進度已經啟動，就不要再額外新增一個綠框，避免重複。
    if(btn.classList.contains('is-loading') || btn.classList.contains('is-success') || btn.classList.contains('is-error') || btn.querySelector('.btn-progress-fill,.action-btn-fill')){
      active = {button:btn, label:runningLabel(actionText(btn)), startedAt:now(), native:true};
      return active;
    }
    if(active) clearTimer(active);
    var label = explicitLabel || runningLabel(actionText(btn));
    var el = place(btn);
    var i = 0;
    active = {button:btn, label:label, startedAt:now(), box:el, pct:10};
    setProgress(el, 10, label, 'running');
    active.timer = setInterval(function(){
      if(!active || active.button !== btn) return;
      i += 1;
      var pct = SEQUENCE[Math.min(i, SEQUENCE.length - 1)];
      active.pct = pct;
      setProgress(el, pct, label, 'running');
    }, 360);
    active.finishTimer = setTimeout(function(){
      if(active && active.button === btn) done(btn, doneLabel(label));
    }, AUTO_FINISH_MS);
    return active;
  }
  function done(btn, text){
    if(!btn && active) btn = active.button;
    if(!active || (btn && active.button !== btn)) return;
    var el = active.box || box();
    var label = clean(text || doneLabel(active.label));
    clearTimer(active);
    setProgress(el, 100, label, 'done');
    active.hideTimer = setTimeout(function(){
      if(el && el.parentNode){ el.style.display = 'none'; }
      if(active && active.button === btn) active = null;
    }, 2400);
  }
  function fail(btn, text){
    if(!btn && active) btn = active.button;
    if(!active || (btn && active.button !== btn)) return;
    var el = active.box || place(btn);
    var label = clean(text || '處理失敗');
    clearTimer(active);
    setProgress(el, 100, label, 'fail');
    active.hideTimer = setTimeout(function(){
      if(active && active.button === btn) active = null;
    }, 5000);
  }
  function status(text, ok){
    if(!active) return;
    if(ok === false || statusLooksBad(text)) fail(active.button, text);
    else done(active.button, text || doneLabel(active.label));
  }
  function patchButtonProgressDefaults(){
    var original = window.startActionButtonProgress;
    if(typeof original !== 'function' || original.__yzProgressResetWrapped) return;
    var wrapped = function(btn, options){
      var opts = Object.assign({}, options || {});
      if(!Array.isArray(opts.sequence) && opts.fixedSteps !== false){
        opts.sequence = SEQUENCE.slice();
      }
      if(opts.startPct == null){ opts.startPct = 10; }
      if(opts.maxPct == null){ opts.maxPct = 90; }
      return original.call(this, btn, opts);
    };
    wrapped.__yzProgressResetWrapped = true;
    window.startActionButtonProgress = wrapped;
  }
  function injectStyle(){
    if(document.getElementById('yzProgressFeedbackStyle')) return;
    var css = ''+
      '.yz-progress-feedback{display:none;margin:10px 0 0 0;padding:12px 14px;border-radius:14px;box-sizing:border-box;background:'+GREEN+';color:#fff;font-weight:900;line-height:1.55;box-shadow:0 6px 18px rgba(31,122,90,.16);}\n'+
      '.yz-progress-feedback .yz-progress-text{font-size:15px;letter-spacing:.02em;}\n'+
      '.yz-progress-feedback .yz-progress-track{height:8px;border-radius:999px;background:rgba(255,255,255,.28);overflow:hidden;margin-top:9px;}\n'+
      '.yz-progress-feedback .yz-progress-fill{height:100%;width:10%;border-radius:999px;background:rgba(255,255,255,.88);transition:width .26s ease;}\n'+
      '.yz-progress-feedback.done{background:'+GREEN_DARK+';}\n'+
      '.yz-progress-feedback.fail{background:'+RED+';}\n'+
      '@media(max-width:720px){.yz-progress-feedback{font-size:15px;margin-top:10px;padding:13px 14px}.yz-progress-feedback .yz-progress-text{font-size:15px}}';
    var style = document.createElement('style');
    style.id = 'yzProgressFeedbackStyle';
    style.textContent = css;
    document.head.appendChild(style);
  }
  function onClick(e){
    var btn = e.target && e.target.closest ? e.target.closest('button,input[type="submit"],input[type="button"]') : null;
    if(!btn || !isAction(btn)) return;
    pending = {button:btn, label:runningLabel(actionText(btn)), startedAt:now()};
    // 讓原頁面的 onclick 先執行。如果原頁面已經啟動自己的進度條，這裡就不再插入額外綠框。
    setTimeout(function(){
      if(!document.documentElement.contains(btn)) return;
      if(active && active.button === btn) return;
      if(!pending || pending.button !== btn) return;
      if(btn.classList.contains('is-loading') || btn.classList.contains('is-success') || btn.classList.contains('is-error') || btn.querySelector('.btn-progress-fill,.action-btn-fill')){
        active = {button:btn, label:runningLabel(actionText(btn)), startedAt:now(), native:true};
        return;
      }
      start(btn);
    }, 80);
  }
  function onSubmit(e){
    var form = e.target;
    if(!form || !form.querySelector) return;
    var btn = document.activeElement && form.contains(document.activeElement) ? document.activeElement : null;
    if(!btn || !isAction(btn)) btn = form.querySelector('button[type="submit"],input[type="submit"],button:not([type])');
    if(!btn || !isAction(btn)) return;
    pending = {button:btn, label:runningLabel(actionText(btn)), startedAt:now()};
    setTimeout(function(){
      if(!document.documentElement.contains(btn)) return;
      if(active && active.button === btn) return;
      if(!pending || pending.button !== btn) return;
      start(btn);
    }, 80);
  }
  window.alert = function(msg){
    var text = clean(msg);
    if(active && (now() - active.startedAt) < ALERT_CAPTURE_MS){
      if(statusLooksBad(text)) fail(active.button, text);
      else done(active.button, text || doneLabel(active.label));
      return;
    }
    if(pending && (now() - pending.startedAt) < 1200 && pending.button && document.documentElement.contains(pending.button)){
      start(pending.button, pending.label);
      if(statusLooksBad(text)) fail(pending.button, text);
      else done(pending.button, text || doneLabel(pending.label));
      return;
    }
    return nativeAlert.call(window, msg);
  };
  window.yzActionFeedback = {
    begin: start,
    done: done,
    fail: fail,
    status: status,
    reset: function(){ if(active) clearTimer(active); removeOldArtifacts(); active = null; },
    lastButton: function(){ return active && (now() - active.startedAt) < ALERT_CAPTURE_MS ? active.button : null; }
  };

  injectStyle();
  removeOldArtifacts();
  patchButtonProgressDefaults();
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
  setInterval(patchButtonProgressDefaults, 500);
})();
