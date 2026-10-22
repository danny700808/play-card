'use strict';
// The extension acquires official documents; this bridge never prints or logs in.
(function(){
  const namespace='youzi-shipping-helper',version=1;
  const pending=new Map();let connected=false,connecting=null,cancelEpoch=0;
  const progress={checking_login:'正在確認登入…',reading_order:'正在核對最新訂單…',
    getting_document:'正在取得貨運單…',preparing_preview:'正在準備預覽…'};
  const errors={login_required:'副機 EasyStore 登入已失效，請由店主重新登入一次。',
    not_ready:'平台尚未提供這筆貨運單，請更新訂單後再核對。',
    order_changed:'訂單內容或物流已變更，請讀取最新訂單後再核對。',
    unsupported:'副機取單助手需要更新，請依接續說明更新助手。'};
  function send(message){window.postMessage({namespace,version,direction:'desk',...message},location.origin);}
  function finish(id,error,value){
    const item=pending.get(id);if(!item)return;
    clearTimeout(item.timer);pending.delete(id);
    if(error)item.reject(error);else item.resolve(value);
  }
  function request(type,row,onProgress){
    return new Promise((resolve,reject)=>{
      const requestId=crypto.randomUUID();
      const timer=setTimeout(()=>{
        send({type:'cancel',requestId});
        finish(requestId,Error(type==='probe'?'副機取單助手尚未支援統一視窗，請先更新助手。':'取單結果尚未確認，請讀取最新訂單核對；不會自動重送出貨。'));
      },type==='probe'?2000:180000);
      pending.set(requestId,{resolve,reject,timer,row,onProgress,type});
      send({type,requestId,...(row?{order:{key:row.key,orderNo:row.orderNo,externalId:row.externalId,
        tracking:row.tracking||'',mode:row.tracking||row.stage==='shipped'||row.canDownload?'reprint':'create'}}:{})});
    });
  }
  function decodePdf(value){
    if(typeof value!=='string'||value.length>21000000||!/^JVBERi0[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('取單助手沒有回傳有效 PDF。');
    const binary=atob(value);if(!binary.startsWith('%PDF-'))throw Error('貨運單格式不正確。');
    return Uint8Array.from(binary,c=>c.charCodeAt(0));
  }
  window.addEventListener('message',event=>{
    const m=event.data;
    if(event.source!==window||event.origin!==location.origin||!m||m.namespace!==namespace||m.version!==version||m.direction!=='helper')return;
    const item=pending.get(m.requestId);if(!item)return;
    if(item.type==='probe'){
      if(m.type!=='ready'||m.capabilities?.unifiedDocument!==true)return;
      connected=true;finish(m.requestId,null,true);
      window.dispatchEvent(new Event('youzi-shopee-helper-ready'));return;
    }
    if(m.key!==item.row.key||m.orderNo!==item.row.orderNo)return;
    if(m.type==='progress'){if(progress[m.stage])item.onProgress?.(progress[m.stage]);return;}
    if(m.type==='error'){finish(m.requestId,Error(errors[m.code]||'副機取單未完成，請確認助手狀態後再試。'));return;}
    if(m.type!=='document')return;
    try{
      if(!m.tracking||(item.row.tracking&&m.tracking!==item.row.tracking))throw Error('貨運單物流號碼不一致，請更新訂單後重新核對。');
      if(typeof m.previewDataUrl!=='string'||m.previewDataUrl.length>12000000||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(m.previewDataUrl))throw Error('取單助手未提供有效預覽圖片。');
      finish(m.requestId,null,{pdf:decodePdf(m.pdfBase64),preview:m.previewDataUrl,tracking:m.tracking});
    }catch(e){finish(m.requestId,e);}
  });
  function connect(){
    if(connected)return Promise.resolve(true);
    if(!connecting)connecting=request('probe').finally(()=>{connecting=null;});
    return connecting;
  }
  function cancel(){
    cancelEpoch++;
    for(const [id,item] of pending){if(item.type==='probe')continue;send({type:'cancel',requestId:id});finish(id,Error('已關閉貨運單。'));}
  }
  window.YouziShopeeBridge={version,available:()=>connected,connect,cancel,
    async getDocument(row,onProgress){
      if(row.platform!=='EasyStore'||row.channel!=='蝦皮'||row.stale||['cancelled','review','partial'].includes(row.stage)||
        !/^\d+$/.test(String(row.externalId))||row.key!=='EasyStore:'+row.externalId)throw Error('此訂單需先更新並核對。');
      const own=cancelEpoch;
      await connect();if(own!==cancelEpoch)throw Error('已關閉貨運單。');
      return request('get-document',row,onProgress);
    }};
  // Discovery only. Loading the page can never acquire a label or create a shipment.
  connect().catch(()=>{});
})();
