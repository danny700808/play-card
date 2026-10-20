(function(global){
  'use strict';
  let frame=null;
  global.YouziShipping={
    mount(content){
      // Preserve an open document/review when the portal refreshes its own data.
      if(frame&&content.contains(frame))return;
      content.innerHTML='<div class="ops-shipping-workspace"><iframe title="出貨工作台" id="opsShippingFrame" src="http://127.0.0.1:18765/?embedded=1" allow="local-network-access; loopback-network"></iframe><details class="ops-shipping-help"><summary>工作台沒有顯示？</summary><p>請先開啟桌面的「柚子樂器－出貨工作台」，再按重新連線。</p><button type="button" class="ops-button ghost" id="opsShippingReconnect">重新連線</button></details></div>';
      frame=document.getElementById('opsShippingFrame');
      document.getElementById('opsShippingReconnect').onclick=function(){frame.src='http://127.0.0.1:18765/?embedded=1';};
    }
  };
})(window);
