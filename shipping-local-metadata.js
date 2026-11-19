'use strict';
// Read-only metadata through the same installed helper. No shipment/print calls.
(()=>{
  const namespace='youzi-shipping-helper',pending=new Map();
  let capable=false;
  const send=m=>window.postMessage({namespace,version:1,direction:'desk',...m},location.origin);
  function request(type,orders){return new Promise((resolve,reject)=>{
    const requestId=crypto.randomUUID(),timer=setTimeout(()=>{
      pending.delete(requestId);if(type!=='probe')send({type:'cancel-metadata',requestId});
      reject(Error(type==='probe'?'請重新載入桌面的蝦皮列印小幫手 1.2.8，再重新整理包貨頁。':'本機 EasyStore 讀取逾時，請確認該機已登入後再試。'));
    },type==='probe'?2500:60000);
    pending.set(requestId,{type,resolve,reject,timer});send({type,requestId,...(orders?{orders}:{})});
  });}
  window.addEventListener('message',event=>{
    const m=event.data;if(event.source!==window||event.origin!==location.origin||m?.namespace!==namespace||m.version!==1||m.direction!=='helper')return;
    const item=pending.get(m.requestId);if(!item)return;
    if(item.type==='probe'&&m.type!=='ready'||item.type!=='probe'&&m.type!=='metadata')return;
    clearTimeout(item.timer);pending.delete(m.requestId);
    if(item.type==='probe'){
      capable=m.capabilities?.readMetadata===true;
      if(capable)item.resolve(true);else item.reject(Error('請重新載入桌面的蝦皮列印小幫手 1.2.8，再重新整理包貨頁。'));
    }else if(Array.isArray(m.results)&&m.results.length<=200)item.resolve({results:m.results,error:String(m.error||''),verifiedAt:m.verifiedAt});
    else item.reject(Error('本機回傳資料不完整，請重新讀取。'));
  });
  window.YouziLocalMetadata={async read(orders){if(!capable)await request('probe');return request('get-metadata',orders);}};
})();
