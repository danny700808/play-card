(function(global){
  'use strict';
  let frame=null,ready=false,timeout=null,remote=false;
  function useRemote(){
    return /Android|iPhone|iPad|iPod/i.test(global.navigator.userAgent)||
      (global.navigator.platform==='MacIntel'&&global.navigator.maxTouchPoints>1);
  }
  function connectRemote(){
    remote=true;ready=false;clearTimeout(timeout);
    const status=document.getElementById('opsShippingStatus');
    if(status){status.hidden=false;status.textContent='正在載入出貨工作台…';}
    frame.onload=function(){ready=true;if(status)status.hidden=true;};
    frame.src='shipping-desk.html?embedded=1';
  }
  function connect(){
    if(useRemote()){connectRemote();return;}
    remote=false;frame.onload=null;
    ready=false;
    const status=document.getElementById('opsShippingStatus');
    if(status){status.hidden=false;status.innerHTML='<span>正在連接出貨工作台…</span>';}
    frame.src='http://127.0.0.1:18765/?embedded=1';
    clearTimeout(timeout);
    timeout=setTimeout(function(){
      if(!ready&&status){
        status.innerHTML='<button type="button" class="ops-button primary" id="opsShippingConnect">連接店內出貨工作台</button><span>請確認桌面的出貨程式已開啟。</span>';
        document.getElementById('opsShippingConnect').onclick=connect;
      }
    },2500);
  }
  global.addEventListener('message',function(event){
    if(remote||!frame||event.source!==frame.contentWindow||event.origin!=='http://127.0.0.1:18765'||event.data?.type!=='youzi-shipping-ready')return;
    ready=true;clearTimeout(timeout);
    const status=document.getElementById('opsShippingStatus');if(status)status.hidden=true;
  });
  global.YouziShipping={
    mount(content){
      // Preserve an open document/review when the portal refreshes its own data.
      if(frame&&content.contains(frame))return;
      content.innerHTML='<div class="ops-shipping-workspace"><div id="opsShippingStatus" class="ops-shipping-status"></div><iframe title="出貨工作台" id="opsShippingFrame" allow="local-network-access; loopback-network"></iframe><details class="ops-shipping-help"><summary>工作台沒有顯示？</summary><p>手機會沿用系統登入，直接載入遠端工作台。電腦使用本機工作台時，請先開啟桌面的出貨程式。</p><button type="button" class="ops-button ghost" id="opsShippingReconnect">重新連線</button><button type="button" class="ops-button ghost" id="opsShippingRemote">使用遠端工作台</button></details></div>';
      frame=document.getElementById('opsShippingFrame');
      document.getElementById('opsShippingReconnect').onclick=connect;
      document.getElementById('opsShippingRemote').onclick=connectRemote;
      connect();
    }
  };
})(window);
