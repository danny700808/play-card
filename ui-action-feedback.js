(function(){
  'use strict';
  if(window.__YZ_ACTION_FEEDBACK_V2__) return;
  window.__YZ_ACTION_FEEDBACK_V2__ = true;

  var GREEN = '#1f7a5a';
  var GREEN_DARK = '#146c43';
  var RED = '#b42318';
  var LAST_TTL = 20000;
  var autoSeq = [18, 32, 48, 64, 78, 88, 94];
  var stateMap = new WeakMap();
  var lastAction = null;

  function clean(s){ return String(s == null ? '' : s).replace(/\s+/g,' ').trim(); }
  function now(){ return Date.now(); }
  function esc(s){ return clean(s).replace(/[&<>"']/g, function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);}); }
  function isVisible(el){ return !!(el && el.nodeType===1 && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed')); }
  function isRecent(){ return !!(lastAction && lastAction.button && (now() - lastAction.time) < LAST_TTL); }
  function nearestActionHost(btn){
    if(!btn) return null;
    return btn.closest('.submit-actions,.login-actions-stack,.btn-row,.button-row,.btns,.toolbar,.final-actions,.actions,.item-actions,.small-actions,.mini-actions,.rental-actions,.contract-actions,.form-actions,.approval-actions,.cert-actions,.card-actions,.admin-actions,.settings-actions,.quote-actions,.filter-actions,.n2-modal-actions,.mn-actions,.modal-actions') || btn.parentElement || btn;
  }
  function afterAnchor(btn){ return nearestActionHost(btn) || btn; }
  function statusBox(btn){
    var host = afterAnchor(btn);
    if(!host || !host.parentNode) return null;
    var next = host.nextElementSibling;
    if(next && next.getAttribute && next.getAttribute('data-yz-action-status') === '1') return next;
    var box = document.createElement('div');
    box.setAttribute('data-yz-action-status','1');
    box.className = 'yz-action-status';
    host.parentNode.insertBefore(box, host.nextSibling);
    return box;
  }
  function showStatus(btn, text, ok, running){
    if(!btn) btn = isRecent() ? lastAction.button : null;
    var box = btn ? statusBox(btn) : null;
    if(!box){
      box = document.getElementById('yzGlobalActionStatus');
      if(!box){ box = document.createElement('div'); box.id='yzGlobalActionStatus'; box.className='yz-action-status yz-action-global'; document.body.appendChild(box); }
    }
    text = clean(text);
    if(!text){ box.style.display='none'; return; }
    box.className = 'yz-action-status ' + (running ? 'running' : (ok ? 'ok' : 'bad'));
    box.textContent = text;
    box.style.display = 'block';
  }
  function actionLabel(text){
    text = clean(text);
    if(/登入/.test(text)) return '登入中';
    if(/暫時密碼|寄送|寄出/.test(text) && !/重設/.test(text)) return '寄送中';
    if(/重設|更新|變更/.test(text)) return '更新中';
    if(/註冊|基本資料/.test(text)) return '送出中';
    if(/契約|合約/.test(text) && /送出|確認/.test(text)) return '契約送出中';
    if(/簽名|簽署/.test(text)) return '簽署中';
    if(/送出|提交|申請/.test(text)) return '送出中';
    if(/儲存|保存/.test(text)) return '儲存中';
    if(/上傳/.test(text)) return '上傳中';
    if(/下載|PDF|另存/.test(text)) return '檔案產生中';
    if(/匯出/.test(text)) return '匯出中';
    if(/讀取|載入/.test(text)) return '讀取中';
    if(/搜尋|查詢/.test(text)) return '查詢中';
    if(/檢查|驗證|確認/.test(text)) return '確認中';
    if(/複製/.test(text)) return '複製中';
    if(/核准|通過/.test(text)) return '核准中';
    if(/駁回/.test(text)) return '駁回中';
    if(/退回/.test(text)) return '退回中';
    if(/發布|公告/.test(text)) return '發布中';
    if(/開立|核發/.test(text)) return '開立中';
    if(/下載|匯出|PDF|產生/.test(text)) return '產生中';
    if(/審核|審查/.test(text)) return '審核中';
    if(/啟用|停用|封存|解封|離職|結束合作/.test(text)) return '更新中';
    if(/指派|派發|分派/.test(text)) return '指派中';
    if(/匯入/.test(text)) return '匯入中';
    if(/通知|發送|回傳/.test(text)) return '通知建立中';
    if(/刪除|移除/.test(text)) return '刪除中';
    if(/取消申請|取消案件|取消租賃/.test(text)) return '取消中';
    if(/完成|成立|結案/.test(text)) return '處理中';
    return '處理中';
  }
  function isExcludedButton(btn){
    if(!btn || btn.nodeType!==1) return true;
    if(btn.matches('[data-yz-nav-back],[data-yz-nav-logout],.yz-nav-btn,.tab,.tabs button,.approval-tab,.section-tab,.daily-filter,.entry-card,.history-year-btn,[data-close],[data-cancel]')) return true;
    var text = clean(btn.textContent || btn.value || btn.getAttribute('aria-label'));
    if(!text) return true;
    if(/^(回|返回|回到|上一頁|回登入|回首頁|取消|關閉|清空|清空表單|清空條件|停止|開始錄音|預覽|預覽確認|列印|開啟官方 LINE|開啟官方LINE|我知道了)$/.test(text)) return true;
    if(/回上一頁|回到上一頁|返回登入|回登入頁|回首頁|開啟官方 LINE|開啟官方LINE|列印預覽/.test(text)) return true;
    if(/^(全部|待審核|已核准|已退回|歷史紀錄|未處理|有遲到|有請假|有主管處理|資料需確認)$/.test(text)) return true;
    if(/^(我要詢價|公司官網詢價|公司優惠|我的紀錄|老師詢價紀錄|公司優惠商品|班表模板管理|員工班表套用|單日特別班表)$/.test(text)) return true;
    if(/^新增/.test(text) && !/儲存|送出|申請|建立/.test(text)) return true;
    return false;
  }
  function isActionButton(btn){
    if(isExcludedButton(btn)) return false;
    if(btn.dataset && btn.dataset.yzNoFeedback === '1') return false;
    var text = clean(btn.textContent || btn.value || btn.getAttribute('aria-label'));
    return /(登入|密碼|送出|提交|申請|儲存|保存|寄送|發送|通知|回傳|確認|檢查|驗證|複製|核准|駁回|退回|補件|上傳|刪除|移除|取消申請|成立|完成|結案|搜尋|查詢|讀取|載入|簽名|簽署|建立|下載|匯出|PDF|另存|產生|發布|公告|開立|核發|審核|審查|啟用|停用|封存|解封|離職|結束合作|指派|派發|分派|匯入)/.test(text);
  }
  function saveLast(btn){ lastAction = { button: btn, time: now() }; }
  function restore(btn){
    var st = stateMap.get(btn);
    if(!st) return;
    if(st.timer) clearInterval(st.timer);
    if(st.resetTimer) clearTimeout(st.resetTimer);
    if(st.changed){ btn.innerHTML = st.originalHtml; }
    btn.classList.remove('yz-feedback-active','yz-feedback-success','yz-feedback-error');
    btn.style.removeProperty('--yz-feedback-progress');
    btn.removeAttribute('aria-busy');
    stateMap.delete(btn);
  }
  function begin(btn, label){
    if(!btn || !isActionButton(btn)) return null;
    saveLast(btn);
    if(btn.classList.contains('is-loading') || btn.classList.contains('is-progressing') || btn.querySelector('.btn-progress-fill,.action-btn-fill')){
      showStatus(btn, (label || actionLabel(btn.textContent)) + '...', true, true);
      return {done:function(t){done(btn,t);}, fail:function(t){fail(btn,t);}, message:function(t,ok){showStatus(btn,t,ok!==false,false);}};
    }
    var st = stateMap.get(btn);
    if(st) return st.api;
    var originalHtml = btn.innerHTML;
    var idleText = clean(btn.textContent || btn.value || '處理');
    label = label || actionLabel(idleText);
    var i = 0;
    btn.classList.add('yz-feedback-active');
    btn.classList.remove('yz-feedback-success','yz-feedback-error');
    btn.setAttribute('aria-busy','true');
    btn.style.setProperty('--yz-feedback-progress','8%');
    btn.innerHTML = '<span class="yz-feedback-fill" aria-hidden="true"></span><span class="yz-feedback-label">'+esc(label)+' 8%</span>';
    showStatus(btn, label + '...', true, true);
    function setPct(p, txt){
      btn.style.setProperty('--yz-feedback-progress', p + '%');
      var lab = btn.querySelector('.yz-feedback-label');
      if(lab) lab.textContent = (txt || label) + ' ' + Math.round(p) + '%';
    }
    var timer = setInterval(function(){ var p = autoSeq[Math.min(i, autoSeq.length-1)]; i++; setPct(p, label); }, 360);
    var resetTimer = setTimeout(function(){ restore(btn); }, 60000);
    var api = {done:function(t){done(btn,t);}, fail:function(t){fail(btn,t);}, message:function(t,ok){showStatus(btn,t,ok!==false,false);}};
    stateMap.set(btn,{timer:timer, resetTimer:resetTimer, originalHtml:originalHtml, changed:true, api:api, label:label});
    return api;
  }
  function done(btn, text){
    if(!btn) btn = isRecent() ? lastAction.button : null;
    if(!btn) return;
    saveLast(btn);
    var st = stateMap.get(btn);
    text = clean(text || '已完成');
    if(st && st.timer) clearInterval(st.timer);
    btn.classList.remove('yz-feedback-active','yz-feedback-error');
    btn.classList.add('yz-feedback-success');
    btn.style.setProperty('--yz-feedback-progress','100%');
    var lab = btn.querySelector('.yz-feedback-label');
    if(lab) lab.textContent = '✓ ' + text;
    showStatus(btn, text, true, false);
    setTimeout(function(){ restore(btn); }, 1200);
  }
  function fail(btn, text){
    if(!btn) btn = isRecent() ? lastAction.button : null;
    if(!btn) return;
    saveLast(btn);
    var st = stateMap.get(btn);
    text = clean(text || '處理失敗');
    if(st && st.timer) clearInterval(st.timer);
    btn.classList.remove('yz-feedback-active','yz-feedback-success');
    btn.classList.add('yz-feedback-error');
    btn.style.setProperty('--yz-feedback-progress','100%');
    var lab = btn.querySelector('.yz-feedback-label');
    if(lab) lab.textContent = text.length > 12 ? '處理失敗' : text;
    showStatus(btn, text, false, false);
    setTimeout(function(){ restore(btn); }, 1800);
  }
  function relocateMessageElement(el, btn){
    if(!el || !btn || !el.parentNode) return;
    var host = afterAnchor(btn);
    if(host && host.parentNode && el !== host.nextElementSibling){
      try{ host.parentNode.insertBefore(el, host.nextSibling); }catch(_){ }
    }
  }
  function patchSetMsg(){
    if(typeof window.setMsg !== 'function' || window.setMsg.__yzPatched) return;
    var original = window.setMsg;
    var patched = function(el, text, isError){
      var r = original.apply(this, arguments);
      if(text && isRecent()){
        try{ relocateMessageElement(el, lastAction.button); }catch(_){ }
        if(isError){ fail(lastAction.button, text); } else { done(lastAction.button, text); }
      }
      return r;
    };
    patched.__yzPatched = true;
    window.setMsg = patched;
  }
  function patchRentalToast(){
    var R = window.RentalCommon || window.Rental || window.R;
    if(!R || typeof R.toast !== 'function' || R.toast.__yzPatched) return;
    var original = R.toast;
    var patched = function(msg, ok){
      if(isRecent()){
        if(ok === false) fail(lastAction.button, msg); else done(lastAction.button, msg);
        return;
      }
      return original.apply(this, arguments);
    };
    patched.__yzPatched = true;
    R.toast = patched;
  }
  function patchNamedMessageFunctions(){
    ['showMsg','setLocalMsg','setPageMsg','showStatusMessage'].forEach(function(name){
      var fn = window[name];
      if(typeof fn !== 'function' || fn.__yzPatched) return;
      var patched = function(){
        var r = fn.apply(this, arguments);
        if(isRecent()){
          var msg = '';
          for(var i=0;i<arguments.length;i++){ if(typeof arguments[i] === 'string' && arguments[i].trim()){ msg = arguments[i]; break; } }
          if(msg){
            var bad = /失敗|錯誤|無法|尚未|請先|必填|不完整|過期|沒有|找不到|不符/.test(msg);
            if(bad) fail(lastAction.button, msg); else done(lastAction.button, msg);
          }
        }
        return r;
      };
      patched.__yzPatched = true;
      window[name] = patched;
    });
  }
  function observeMessages(){
    var observer = new MutationObserver(function(muts){
      if(!isRecent()) return;
      muts.forEach(function(m){
        var el = m.target && m.target.nodeType===1 ? m.target : (m.target && m.target.parentElement);
        if(!el || !el.matches) return;
        if(!el.matches('#msg,#message,#statusMsg,#pageMsg,#localMsg,#formMsg,#saveMsg,#resultMsg,.message,.msg,.local-message,.status-message,.notice-message,.alert-message')) return;
        var txt = clean(el.textContent);
        if(!txt || !isVisible(el)) return;
        relocateMessageElement(el, lastAction.button);
        var bad = /失敗|錯誤|無法|尚未|請先|必填|不完整|過期|沒有|找不到|不符/.test(txt) || el.classList.contains('error') || el.classList.contains('bad') || el.classList.contains('err');
        if(bad) fail(lastAction.button, txt); else done(lastAction.button, txt);
      });
    });
    try{ observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style']}); }catch(_){ }
  }
  function injectStyle(){
    if(document.getElementById('yzActionFeedbackStyle')) return;
    var css = `
      button.yz-feedback-active,button.yz-feedback-success,button.yz-feedback-error{position:relative!important;overflow:hidden!important;background:${GREEN}!important;color:#fff!important;border-color:${GREEN}!important;}
      button.yz-feedback-error{background:${RED}!important;border-color:${RED}!important;}
      button.yz-feedback-success{background:${GREEN_DARK}!important;border-color:${GREEN_DARK}!important;}
      button.yz-feedback-active .yz-feedback-fill,button.yz-feedback-success .yz-feedback-fill,button.yz-feedback-error .yz-feedback-fill{position:absolute;left:0;top:0;bottom:0;width:var(--yz-feedback-progress,0%);background:rgba(255,255,255,.24);transition:width .25s ease;z-index:0;}
      button.yz-feedback-active .yz-feedback-label,button.yz-feedback-success .yz-feedback-label,button.yz-feedback-error .yz-feedback-label{position:relative;z-index:1;color:#fff!important;}
      .yz-action-status{display:none;margin:10px 0 0 0;padding:12px 14px;border-radius:14px;font-size:14px;font-weight:900;line-height:1.7;border:1px solid #cfe3d8;background:#eef9f2;color:${GREEN_DARK};box-sizing:border-box;}
      .yz-action-status.running{display:block;background:#eef9f2;color:${GREEN_DARK};border-color:#cfe3d8;}
      .yz-action-status.ok{display:block;background:#e8fff4;color:${GREEN_DARK};border-color:#b7e4c7;}
      .yz-action-status.bad{display:block;background:#fff0f0;color:${RED};border-color:#fecaca;}
      .yz-action-global{position:fixed;left:14px;right:14px;bottom:18px;z-index:100000;box-shadow:0 10px 28px rgba(15,23,42,.16);}
      @media(max-width:720px){.yz-action-status{font-size:15px}.yz-action-global{left:10px;right:10px;bottom:12px}}
    `;
    var style = document.createElement('style');
    style.id = 'yzActionFeedbackStyle';
    style.textContent = css;
    document.head.appendChild(style);
  }

  document.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if(!btn || !isActionButton(btn)) return;
    saveLast(btn);
    setTimeout(function(){
      if(!document.body.contains(btn)) return;
      begin(btn);
    }, 0);
  }, false);

  document.addEventListener('submit', function(e){
    var form = e.target;
    if(!form || !form.querySelector) return;
    var btn = form.querySelector('button[type=submit],input[type=submit]');
    if(btn && isActionButton(btn)){
      saveLast(btn);
      setTimeout(function(){ if(document.body.contains(btn)) begin(btn); }, 0);
    }
  }, true);

  document.addEventListener('submit', function(e){
    var form = e.target;
    if(!form || !form.querySelector) return;
    var btn = document.activeElement && document.activeElement.tagName === 'BUTTON' && form.contains(document.activeElement) ? document.activeElement : null;
    if(!btn){
      btn = form.querySelector('button[type="submit"], button:not([type])');
    }
    if(!btn || !isActionButton(btn)) return;
    saveLast(btn);
    setTimeout(function(){
      if(!document.body.contains(btn)) return;
      begin(btn);
    }, 0);
  }, true);

  var nativeAlert = window.alert;
  window.alert = function(msg){
    msg = clean(msg);
    if(isRecent()){
      fail(lastAction.button, msg);
      return;
    }
    var fake = document.activeElement && document.activeElement.tagName === 'BUTTON' ? document.activeElement : null;
    if(fake && isActionButton(fake)){
      saveLast(fake);
      fail(fake, msg);
      return;
    }
    return nativeAlert.call(window, msg);
  };

  window.yzActionFeedback = {
    begin: begin,
    done: done,
    fail: fail,
    status: function(text, ok){ showStatus(isRecent()?lastAction.button:null, text, ok !== false, false); },
    lastButton: function(){ return isRecent()?lastAction.button:null; }
  };

  injectStyle();
  patchSetMsg();
  observeMessages();
  setInterval(function(){ patchSetMsg(); patchRentalToast(); patchNamedMessageFunctions(); }, 350);
})();
