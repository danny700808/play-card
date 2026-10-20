(function(global){
  'use strict';
  let frame=null,ready=false,timeout=null;
  function connect(){
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
    if(!frame||event.source!==frame.contentWindow||event.origin!=='http://127.0.0.1:18765'||event.data?.type!=='youzi-shipping-ready')return;
    ready=true;clearTimeout(timeout);
    const status=document.getElementById('opsShippingStatus');if(status)status.hidden=true;
  });
  global.YouziShipping={
    mount(content){
      // Preserve an open document/review when the portal refreshes its own data.
      if(frame&&content.contains(frame))return;
      content.innerHTML='<div class="ops-shipping-workspace"><div id="opsShippingStatus" class="ops-shipping-status"></div><iframe title="出貨工作台" id="opsShippingFrame" allow="local-network-access; loopback-network"></iframe><details class="ops-shipping-help"><summary>工作台沒有顯示？</summary><p>請先開啟桌面的「柚子樂器－出貨工作台」，再按重新連線。</p><button type="button" class="ops-button ghost" id="opsShippingReconnect">重新連線</button></details></div>';
      frame=document.getElementById('opsShippingFrame');
      document.getElementById('opsShippingReconnect').onclick=connect;
      connect();
    }
  };
})(window);
