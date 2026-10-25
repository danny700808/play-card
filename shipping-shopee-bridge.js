'use strict';
// The extension acquires official documents; this bridge never prints or logs in.
(function(){
  const namespace='youzi-shipping-helper',version=1;
  const pending=new Map();let connected=false,connecting=null,cancelEpoch=0;
  const progress={checking_login:'正在確認登入…',reading_order:'正在核對最新訂單…',
    getting_document:'正在取得貨運單…',preparing_preview:'正在準備預覽…',waiting_document:'已確認出貨，正在等待平台提供貨運單；不會重複申請出貨。'};
  const errors={login_required:'副機 EasyStore 登入已失效，請由店主重新登入一次。',
    shipment_label_pending:'平台已確認出貨，但貨運單尚未備妥。稍後只需取回原單，不要再次申請出貨。',
    not_ready:'平台尚未提供這筆貨運單，請更新訂單後再核對。',
    order_changed:'訂單內容或物流已變更，請讀取最新訂單後再核對。',
    unsupported:'副機取單助手需要更新，請依接續說明更新助手。'};
  function send(message){window.postMessage({namespace,version,direction:'desk',...message},location.origin);}
  function finish(id,error,value){
    const item=pending.get(id);if(!item)return;
    item.formElement?.remove();
    clearTimeout(item.timer);pending.delete(id);
    if(error)item.reject(error);else item.resolve(value);
  }
  function showShipmentForm(item,m){
    const dialog=document.getElementById('documentDialog');
    if(!dialog?.open||!['options','confirm'].includes(m.phase)||!Array.isArray(m.fields)||m.fields.length>10)return;
    const valid=m.fields.every(f=>f&&/^[a-z_0-9]{1,50}$/.test(f.id)&&typeof f.label==='string'&&f.label.length<=100&&
      (f.type==='text'&&typeof f.value==='string'&&f.value.length<=100||f.type==='select'&&Array.isArray(f.options)&&f.options.length>0&&f.options.length<=20&&f.options.every(o=>/^\d{1,3}$/.test(o.id)&&typeof o.label==='string'&&o.label.length<=180)));
    if(!valid)return;
    const renew=()=>{clearTimeout(item.timer);item.timer=setTimeout(()=>{send({type:'cancel',requestId:m.requestId});finish(m.requestId,Error('出貨結果尚未確認，請核對平台狀態；不會自動重送。'));},180000);};
    renew();
    item.formElement?.remove();
    const form=document.createElement('form');form.dataset.shipmentRequest=m.requestId;
    const title=document.createElement('p');title.textContent=m.phase==='confirm'?'確認這筆新訂單的出貨資料；確認後會向蝦皮申請出貨並取回貨運單。':'選擇這筆新訂單的出貨方式。';form.append(title);
    for(const field of m.fields){
      const label=document.createElement('label');label.style.display='block';label.style.margin='12px 0';label.append(document.createTextNode(field.label+' '));
      const input=document.createElement(field.type==='select'?'select':'input');input.name=field.id;input.required=true;
      if(field.type==='select')for(const option of field.options){const el=document.createElement('option');el.value=option.id;el.textContent=option.label;input.append(el);}
      else{input.type='text';input.maxLength=100;input.value=field.value;}
      label.append(input);form.append(label);
    }
    const button=document.createElement('button');button.type='submit';button.className='primary';button.textContent=m.phase==='confirm'?'確認出貨並取得貨運單':'繼續';form.append(button);
    form.addEventListener('submit',e=>{
      e.preventDefault();if(!pending.has(m.requestId)||!dialog.open||button.disabled)return;
      const values={};for(const field of m.fields)values[field.id]=form.elements.namedItem(field.id).value;
      button.disabled=true;send({type:'shipment-choice',requestId:m.requestId,phase:m.phase,values});
      renew();
      form.remove();item.formElement=null;
      const status=m.phase==='confirm'?'正在重新核對訂單，確認後申請出貨並取回貨運單…':'正在讀取出貨確認資料，尚未送出…';
      item.onProgress?.(status);
      const placeholder=document.getElementById('documentPlaceholder');
      if(placeholder)placeholder.textContent=status;
    });
    item.formElement=form;(document.getElementById('documentSummary')||dialog).append(form);
    item.onProgress?.(m.phase==='confirm'?'等待你確認出貨；目前尚未送出。':'等待你選擇出貨方式；目前尚未送出。');
    const placeholder=document.getElementById('documentPlaceholder');
    if(placeholder){
      placeholder.hidden=false;
      placeholder.textContent=m.phase==='confirm'?'確認左側出貨資料後，才會申請出貨並顯示正式貨運單。':'請先在左側選擇出貨方式，尚未取得貨運單。';
    }
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
    if(m.type==='shipment-form'){showShipmentForm(item,m);return;}
    if(m.type==='progress'){
      if(!item.formElement&&progress[m.stage]){
        item.onProgress?.(progress[m.stage]);
        if(m.stage==='waiting_document'){
          const placeholder=document.getElementById('documentPlaceholder');
          if(placeholder)placeholder.textContent=progress[m.stage];
        }
      }
      return;
    }
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
