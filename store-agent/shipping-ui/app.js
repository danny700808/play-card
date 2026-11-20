'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stageNames = {pending:'待出貨',partial:'部分待出貨',label:'可印貨運單',shipped:'已出貨',cancelled:'已取消',review:'需核對'};
let data = {orders:[],errors:{},connectors:[]}, selected = '', activeChannel = '全部', activeWork = 'pending', activeLogistics = 'all', busy = false;
let documentGeneration=0,externalDocumentUrls=[];
let localMetadataBusy=false,localMetadataTask=null;
let directPrintKey='',directPrintStatus='';
const checkedOrders=new Set();
let batchRun=null,batchSummary='';
const localMetadataCache=new Map();
const sessionToken=document.querySelector('meta[name="youzi-session"]')?.content||'';
const remote=!!window.ShippingTransport;
const embedded=window.self!==window.top;
document.documentElement.classList.toggle('embedded',embedded);
if(embedded)window.parent.postMessage({type:'youzi-shipping-ready'},'https://danny700808.github.io');
const channels = ['全部','蝦皮','酷澎','MOMO','官網','LINE','來源待確認'];
const carriers = {TWL_HCT:'新竹物流',TWL_KERRY:'嘉里大榮',TWL_FM:'全家',TWL_711:'7-11'};
function localDay(value) {
  if(!value)return '';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'':date.toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
}
async function api(path, body) {
  if(remote)return window.ShippingTransport.api(path,body);
  const response = await fetch(path, {headers:{'X-Youzi-Session':sessionToken,...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '連線失敗');
  return payload;
}
function notice(message, error=false) { $('notice').textContent=message;$('notice').hidden=!message;$('notice').classList.toggle('error',error); }
function badge(row) { return `<span class="badge ${row.channel==='MOMO'?'momo':row.channel==='蝦皮'?'shopee':row.channel==='酷澎'?'coupang':''}">${escapeHtml(row.channel)}</span>`; }
function paidAmountHtml(row) {
  const paid=ShippingModel.paidAmount(row);
  const deliverySource=(row.deliveryMethodSource?`${row.deliveryMethodSource} · 核對 ${row.deliveryMethodVerifiedAt}`:'平台物流資料')+(row.deliveryMethodNote?` · ${row.deliveryMethodNote}`:'');
  return `<span class="paid-amount ${paid.confirmed?'confirmed':'unconfirmed'}" title="${escapeHtml(paid.note)}">${escapeHtml(paid.text)}</span><span class="delivery-method" title="${escapeHtml(deliverySource)}">${escapeHtml(ShippingModel.deliveryMethod(row))}</span>`;
}
function deadlineHtml(row){
  const deadline=ShippingModel.shippingDeadline(row);
  const reason=deadline.tone==='unknown'&&row.shippingDeadlineNote
    ? `<span class="shipping-deadline-reason">${escapeHtml(row.shippingDeadlineNote)}</span>`:'';
  return `<span class="shipping-deadline ${deadline.tone}" title="${escapeHtml(deadline.note)}">${escapeHtml(deadline.text)}</span>${reason}`;
}
function applyLocalMetadata(){
  for(const row of data.orders){const saved=localMetadataCache.get(row.key);
    if(saved&&saved.binding===ShippingModel.metadataBinding(row)&&Date.now()-Date.parse(saved.verifiedAt)<300000&&!row.stale){
      const patch={...saved.patch};
      if(row.deliveryMethod&&!row.deliveryMethodSource)for(const key of ['deliveryMethod','deliveryMethodSource','deliveryMethodVerifiedAt','deliveryMethodNote'])delete patch[key];
      Object.assign(row,patch);
    }
  }
}
function refreshLocalMetadata(){
  if(localMetadataTask)return localMetadataTask;
  localMetadataTask=readLocalMetadata().finally(()=>{localMetadataTask=null;});
  return localMetadataTask;
}
async function readLocalMetadata(){
  if(localMetadataBusy||!window.YouziLocalMetadata)return;
  const rows=data.orders.filter(r=>r.platform==='EasyStore'&&r.channel==='蝦皮'&&!ShippingModel.isHandled(r)&&!ShippingModel.deadlineExpired(r)&&!r.stale&&!['shipped','cancelled'].includes(r.stage)&&/^\d{1,20}$/.test(String(r.externalId))&&/^[A-Z0-9]{12,24}$/.test(r.orderNo)).slice(0,200);
  if(!rows.length)return;
  const bindings=new Map(rows.map(r=>[r.key,ShippingModel.metadataBinding(r)]));
  const unconfirmed=(seen=new Set())=>{for(const row of data.orders){
    if(seen.has(row.key)||bindings.get(row.key)!==ShippingModel.metadataBinding(row)||row.shippingDeadlineSource!=='本機 EasyStore 蝦皮通路後台')continue;
    localMetadataCache.delete(row.key);row.shippingDeadlineNote='本次未能重新核對，請再次讀取本機 EasyStore。';
  }};
  localMetadataBusy=true;
  try{
    const response=await window.YouziLocalMetadata.read(rows.map(r=>({key:r.key,externalId:String(r.externalId),orderNo:r.orderNo})));
    const seen=new Set();
    for(const observation of response.results){
      const row=data.orders.find(r=>r.key===observation.key);
      if(!row||ShippingModel.isHandled(row)||!bindings.has(row.key)||bindings.get(row.key)!==ShippingModel.metadataBinding(row))continue;
      const patch=ShippingModel.localLogistics(row,observation,response.verifiedAt);if(!patch)continue;
      localMetadataCache.set(row.key,{binding:bindings.get(row.key),patch,verifiedAt:response.verifiedAt});Object.assign(row,patch);
      seen.add(row.key);
    }
    unconfirmed(seen);
    render();
  }catch(error){unconfirmed();render();}
  finally{localMetadataBusy=false;}
}
function packingItems(row) {
  const grouped=new Map();
  for(const original of row.items) {
    const item={...original};
    if(row.stage==='partial') {
      item.quantity=item.remaining;
      if(item.quantity==null) continue;
    }
    if(item.quantity<=0) continue;
    const key=item.sku?JSON.stringify([item.sku,item.name,item.variant,item.properties||[]]):item.id;
    if(grouped.has(key))grouped.get(key).quantity+=item.quantity;
    else grouped.set(key,item);
  }
  return [...grouped.values()];
}
function itemHtml(item) {
  const image = item.image && item.image.startsWith('https:')
    ? `<div class="photo-wrap"><button class="item-photo" type="button" data-image="${escapeHtml(item.image)}" data-title="${escapeHtml(item.variant || item.name)}" aria-label="放大圖片：${escapeHtml(item.variant || item.name)}"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.variant || item.name)}" referrerpolicy="no-referrer"></button>${item.imageSource==='商品主圖'?'<span class="image-kind">商品主圖</span>':''}</div>`
    : '<div class="image-placeholder">尚無圖片</div>';
  return `<div class="item">${image}<div class="item-info"><div class="sku"><span>SKU</span> ${escapeHtml(ShippingModel.formatSku(item.sku)||'未提供')}</div><div class="item-name">${escapeHtml(item.name)}</div><div class="item-variant">${escapeHtml(item.variant || '未提供規格')}</div>${item.heldQuantity ? '<div class="item-variant">有取消申請，請先核對</div>':''}</div><div class="qty">${Number(item.quantity)}<small>件</small></div></div>`;
}
function queueRows(){return data.orders.filter(r=>ShippingModel.visibleInQueue(r));}
function batchEligible(row){return !ShippingModel.isHandled(row)&&!row.stale&&!row.handlingChanged&&!['shipped','cancelled','review'].includes(row.stage);}
function renderBatch(){
  if(!batchRun){const available=new Set(queueRows().filter(batchEligible).map(r=>r.key));for(const key of checkedOrders)if(!available.has(key))checkedOrders.delete(key);}
  const rows=filtered().filter(batchEligible);
  $('selectVisible').checked=rows.length>0&&rows.every(r=>checkedOrders.has(r.key));
  $('selectVisible').indeterminate=rows.some(r=>checkedOrders.has(r.key))&&!$('selectVisible').checked;
  $('selectVisible').disabled=busy||!!batchRun||!rows.length;
  $('batchMode').disabled=busy||!!batchRun;
  $('batchPrint').disabled=busy||!!batchRun||!checkedOrders.size;
  $('clearSelection').disabled=busy||!!batchRun||!checkedOrders.size;
  $('batchPrint').textContent=`批次列印（${checkedOrders.size} 筆）`;
  $('batchStop').hidden=!batchRun;
  $('batchStop').disabled=!!batchRun?.stop;
  $('batchStatus').textContent=batchRun?`正在處理第 ${batchRun.index}／${batchRun.total} 筆 · ${batchRun.orderNo}${batchRun.stop?' · 本筆完成後停止':''}`:batchSummary;
}
async function printBatch(){
  if(busy||batchRun||!checkedOrders.size)return;
  const keys=queueRows().filter(r=>checkedOrders.has(r.key)&&batchEligible(r)).sort(ShippingModel.compareShippingPriority).map(r=>r.key);
  if(!keys.length)return;
  const run={total:keys.length,index:0,orderNo:'',stop:false,submitted:0};batchRun=run;batchSummary='';
  const packingSheet=$('batchMode').value==='packing';
  let issue='';
  try{
    for(const key of keys){
      if(run.stop)break;
      if(remote&&!window.ShippingTransport.loggedIn())throw Error('已登出，批次列印已停止。');
      run.index++;run.orderNo=data.orders.find(r=>r.key===key)?.orderNo||key;renderBatch();
      // Refresh the host snapshot for each selected order; acquisition still
      // performs its normal platform validation. Never overlap print jobs.
      data=await api('/api/orders');
      if(run.stop)break;
      const row=data.orders.find(r=>r.key===key);
      if(!row||!batchEligible(row))throw Error(`訂單 ${run.orderNo} 的狀態已變更，請重新核對。`);
      selected=key;activeChannel='全部';activeLogistics='all';activeWork=ShippingModel.deadlineExpired(row)?'expired':'pending';$('search').value='';render();
      const result=await printOrder(row,{}, {packingSheet},run);
      if(result?.submitted){run.submitted++;checkedOrders.delete(key);}
      if(!result?.submitted||!result.recorded)throw Error(result?.error||`訂單 ${run.orderNo} 尚未確認送印，已停止。`);
    }
  }catch(error){issue=error.message;}
  finally{
    batchRun=null;batchSummary=`本批已送印 ${run.submitted}／${run.total} 筆。${issue?'已暫停：'+issue:run.stop?'已停止，尚未送印的訂單保留勾選。':'列印工作已依序送出。'}`;
    activeWork='pending';activeLogistics='all';selected='';render();notice(batchSummary,!!issue);
  }
}
function filtered() {
  const term=$('search').value.toLowerCase().trim(), compact=ShippingModel.searchCode(term);
  return queueRows().filter(r => (activeChannel==='全部'||r.channel===activeChannel) &&
    (activeWork==='expired'?ShippingModel.deadlineExpired(r)&&!ShippingModel.isHandled(r):
      !ShippingModel.deadlineExpired(r)&&(activeWork==='all'||(activeWork==='done'?ShippingModel.isHandled(r):!ShippingModel.isHandled(r)))) &&
    (activeWork!=='pending'||activeLogistics==='all'||ShippingModel.logisticsGroup(r)===activeLogistics) &&
    (!term||[r.orderNo,r.recipient,r.tracking,...r.items.map(i=>`${i.name} ${i.sku} ${i.variant}`)].join(' ').toLowerCase().includes(term)||
      (compact&&r.items.some(i=>ShippingModel.searchCode(i.sku).includes(compact)))))
    .sort((a,b)=>activeWork==='pending'?ShippingModel.compareShippingPriority(a,b):channels.indexOf(a.channel)-channels.indexOf(b.channel)||
      b.date.localeCompare(a.date)||b.orderNo.localeCompare(a.orderNo));
}
function render() {
  applyLocalMetadata();
  $('channels').innerHTML=channels.map(c=>`<button data-channel="${escapeHtml(c)}" aria-pressed="${c===activeChannel}" class="${c===activeChannel?'active':''}">${escapeHtml(c)}</button>`).join('');
  const channelRows=queueRows().filter(r=>activeChannel==='全部'||r.channel===activeChannel);
  const normalRows=channelRows.filter(r=>!ShippingModel.deadlineExpired(r));
  $('workTabs').innerHTML=[['pending','未處理',normalRows.filter(r=>!ShippingModel.isHandled(r)).length],['done','已處理',normalRows.filter(r=>ShippingModel.isHandled(r)).length],['all','全部',normalRows.length],['expired','時間到未處理',channelRows.filter(r=>ShippingModel.deadlineExpired(r)&&!ShippingModel.isHandled(r)).length]].map(([key,label,count])=>
    `<button data-work="${key}" class="${activeWork===key?'active':''}" aria-pressed="${activeWork===key}">${label} <strong>${count}</strong></button>`).join('');
  const pendingRows=normalRows.filter(r=>!ShippingModel.isHandled(r));
  const logistics=[['all','全部物流'],['hct','新竹物流／貨運'],['other','其他物流'],['unknown','物流待確認']];
  $('logisticsTabs').hidden=activeWork!=='pending';
  $('logisticsTabs').innerHTML=logistics.map(([key,label])=>`<button data-logistics="${key}" aria-pressed="${activeLogistics===key}" class="${activeLogistics===key?'active':''}">${label} <strong>${pendingRows.filter(r=>key==='all'||ShippingModel.logisticsGroup(r)===key).length}</strong></button>`).join('');
  const rows=filtered();
  if(!rows.some(r=>r.key===selected))selected=rows[0]?.key||'';
  $('resultCount').textContent=`${rows.length} 筆`;
  $('syncTime').textContent=data.updated?`更新 ${new Date(data.updated).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}`:'';
  const groups=activeWork==='pending'?(activeLogistics==='all'?[{label:'依出貨期限排序',rows}]:logistics.slice(1).map(([key,label])=>({label,rows:rows.filter(r=>ShippingModel.logisticsGroup(r)===key)}))):
    channels.slice(1).map(label=>({label,rows:rows.filter(r=>r.channel===label)}));
  $('orders').innerHTML=rows.length?groups.map(({label,rows:group})=>{
    if(!group.length)return '';
    return `<section class="platform-group" aria-label="${escapeHtml(label)}訂單"><div class="group-heading"><strong>${escapeHtml(label)}</strong><span>${group.length} 筆</span></div>${group.map(r=>{
      const items=packingItems(r),quantity=items.reduce((n,i)=>n+i.quantity,0);
      return `<div class="order-select-row"><label class="order-check"><input type="checkbox" data-check="${escapeHtml(r.key)}" aria-label="選取訂單 ${escapeHtml(r.orderNo)}" ${checkedOrders.has(r.key)?'checked':''} ${busy||batchRun||!batchEligible(r)?'disabled':''}></label><button class="order-card ${r.key===selected?'selected':''}" data-key="${escapeHtml(r.key)}" aria-pressed="${r.key===selected}"><div class="line"><span class="order-identity">${badge(r)}<span class="order-no">${escapeHtml(r.orderNo)}</span>${paidAmountHtml(r)}</span><span class="status ${ShippingModel.isHandled(r)?'done':'pending'}">${escapeHtml(ShippingModel.status(r))}</span></div>${deadlineHtml(r)}<div class="order-name">${escapeHtml(items[0]?.name || r.items[0]?.name || '未取得商品明細')}${items.length>1?` 等 ${items.length} 項`:''}</div><div class="line order-meta"><strong>${quantity} 件</strong><span>${escapeHtml(localDay(r.date))}</span></div></button></div>`;
    }).join('')}</section>`;
  }).join(''):'<div class="empty">沒有符合條件的訂單</div>';
  renderBatch();renderDetail();
}
function renderDetail() {
  const row=data.orders.find(r=>r.key===selected);
  if(!row) {$('detail').innerHTML='<div class="empty">選擇訂單查看包貨內容</div>';return;}
  const expired=ShippingModel.deadlineExpired(row)&&!ShippingModel.isHandled(row);
  const enabled=(row.canCreate||row.canDownload)&&!row.stale;
  const easyStoreOrder = row.platform==='EasyStore' && /^\d+$/.test(String(row.externalId||''))
    ? `https://admin.easystore.co/orders/${row.externalId}` : '';
  const shopeeViaEasyStore = !!easyStoreOrder && row.channel==='蝦皮';
  const shopeePrintUrl=ShippingModel.shopeePrintUrl(row);
  const externalAllowed = easyStoreOrder && !row.stale && !['cancelled','review'].includes(row.stage);
  // Preserve the installed helper's locator for ready AND new orders. Never
  // send the user back to the store order page as a visible fallback.
  const shopeeHelperTarget = externalAllowed && shopeeViaEasyStore
    ? `<a hidden aria-hidden="true" tabindex="-1" data-shopee-helper-target href="${shopeePrintUrl||easyStoreOrder}"></a>` : '';
  const printLabel=directPrintKey===row.key?directPrintStatus:ShippingModel.documentActionLabel(row)==='重印貨運單'?'重印貨運單':'列印貨運單';
  const externalAction = externalAllowed
    ? shopeeViaEasyStore ? shopeeHelperTarget + `<button id="shopeeDirectPrint" class="primary" ${busy?'disabled':''}>${escapeHtml(printLabel)}</button>`
    : `<a class="action-link primary" href="${easyStoreOrder}" target="_blank" rel="noopener noreferrer">開啟 EasyStore 對應訂單 ↗</a>` : '';
  const savedDocument=ShippingModel.savedDocumentAvailable(row);
  const postal = row.documentType === 'postal-address-v1';
  const shippingAction = row.platform==='EasyStore' ? (savedDocument?`<button id="showProvidedDocument" class="primary" ${busy?'disabled':''}>${escapeHtml(printLabel)}</button>`:postal?`<button id="prepare" class="primary" ${!enabled||busy?'disabled':''}>${escapeHtml(printLabel)}</button>`:externalAction)
    : `<button id="prepare" class="primary" ${(!enabled&&!savedDocument)||busy?'disabled':''}>${escapeHtml(printLabel)}</button>`;
  const shippingNote = postal ? row.blockReason || '依原訂單產生郵局寄件標籤，郵件條碼由郵局交寄時提供。' : row.platform==='EasyStore' && !row.documentReady
    ? row.stale?'訂單資料尚未更新，請先讀取最新訂單。'
      : ['cancelled','review'].includes(row.stage)?'此訂單已取消或需要核對，暫不開啟出貨。'
      : shopeeViaEasyStore?''
      : externalAction?'這筆正式貨運單尚未接通，請在對應訂單使用原物流出貨與列印功能。'
      :'缺少對應訂單連結，請重新讀取訂單。'
    : '';
  const items=packingItems(row),quantity=items.reduce((n,i)=>n+i.quantity,0);
  const packingNote=(row.note||'').split('\n').filter(line=>!/^買家帳號[：:]/.test(line.trim())).join('\n').trim();
  $('detail').innerHTML=`<div class="detail-header"><div>${badge(row)}<span class="status ${ShippingModel.isHandled(row)?'done':'pending'}">${escapeHtml(ShippingModel.status(row))}</span></div><div class="packing-total">共 <strong>${quantity}</strong> 件</div></div>
    ${ShippingModel.isHandled(row)?`<div class="handling-summary">✓ 已處理 · ${escapeHtml(ShippingModel.status(row))}${row.handledAt?' · '+escapeHtml(new Date(row.handledAt).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})):''}<span>${escapeHtml(row.handlingSource)}</span></div>`:''}
    <div class="detail-section packing-section">${items.map(itemHtml).join('')||'<div class="empty">沒有可包貨的商品</div>'}</div>
    ${packingNote?`<div class="note order-note">${escapeHtml(packingNote)}</div>`:''}
    <div class="detail-order-summary"><div class="order-identity detail-identity"><h2>${escapeHtml(row.orderNo)}</h2>${paidAmountHtml(row)}</div>${deadlineHtml(row)}</div>
    ${shippingNote?`<p class="muted shipping-note">${escapeHtml(shippingNote)}</p>`:''}
    ${ShippingModel.isHandled(row)&&!['shipped','cancelled'].includes(row.stage)?'<div class="handling-actions"><button id="reopen" class="quiet">移回未處理</button></div>':''}
    ${row.jobError||row.stale||row.blockReason&&row.platform!=='EasyStore'?`<div class="block-note">${escapeHtml(row.stale?'資料尚未更新，請重新讀取。':row.jobError||row.blockReason)}</div>`:''}
    ${expired?'<p class="block-note">已超過平台出貨期限，仍可嘗試取得及列印貨運單；不需繼續追蹤時，可標記管理人已處理。</p>':''}
    <div class="actions">${shippingAction}<button id="packing" title="先印包貨明細，最後接著印同筆訂單的貨運單" ${busy||['cancelled','review'].includes(row.stage)?'disabled':''}>列印包貨明細</button>${row.documentReady?'<button id="showDocument" '+(busy?'disabled':'')+'>預覽正式貨運單</button>':''}${!remote&&row.platform==='EasyStore'?'<button id="provideDocument">提供貨運單給副機</button>':''}${expired?`<button id="resolveExpired" ${busy?'disabled':''}>管理人已處理</button>`:''}</div><div id="directShipmentOptions"></div>`;
  $('prepare')?.addEventListener('click',()=>printOrder(row));
  $('shopeeDirectPrint')?.addEventListener('click',()=>printOrder(row));
  $('showProvidedDocument')?.addEventListener('click',()=>printOrder(row));
  $('provideDocument')?.addEventListener('click',()=>provideDocument(row));
  $('packing')?.addEventListener('click',()=>printPacking(row));
  $('resolveExpired')?.addEventListener('click',()=>markHandled(row.key,'processed'));
  $('showDocument')?.addEventListener('click',()=>showDocument(row.key).catch(e=>notice(e.message,true)));
  $('reopen')?.addEventListener('click',()=>markHandled(row.key,'reopen'));
  $('detail').querySelectorAll('.item-photo img').forEach(img=>img.addEventListener('error',()=>{
    const button=img.parentElement;
    button.replaceWith(Object.assign(document.createElement('div'),{className:'image-placeholder',textContent:'圖片無法載入'}));
  }));
}
async function markHandled(key,action){
  if(busy||batchRun)return;
  busy=true;renderDetail();
  try{
    await api('/api/handling',{key,action});
    data=await api('/api/orders');activeWork=action==='processed'?'expired':'pending';activeLogistics='all';selected='';$('search').value='';render();
    if(action==='printed'&&$('documentDialog').open)$('documentDialog').close();
    notice(action==='processed'?'已記錄管理人處理，並移除此筆訂單。':action==='reopen'?'已移回未處理。':'已保存處理紀錄。');
  }catch(e){notice(e.message,true);}
  finally{busy=false;render();}
}
async function recordLocalSubmission(printedRow){
  // A confirmed Windows submission is enough for the packing work queue;
  // it does not assert that paper came out or that the parcel was handed over.
  const row=data.orders.find(r=>r.key===printedRow.key);
  if(!row)return false;
  if(row.orderNo!==printedRow.orderNo||(row.tracking&&printedRow.tracking&&row.tracking!==printedRow.tracking)){
    notice('貨運單已送印，但目前訂單的物流資料已變更，請核對後再標記處理狀態。',true);return false;
  }
  const fields=['handled','handlingAction','handlingSource','handledAt','printCount'];
  const before=Object.fromEntries(fields.map(k=>[k,row[k]]));
  const stronger=['printed','shipped'].includes(row.handlingAction)||['shipped','cancelled'].includes(row.stage);
  const helperDocument=row.platform==='EasyStore'&&row.channel==='蝦皮';
  const action=helperDocument?'processed':'print_requested';
  const submittedAt=new Date().toISOString();
  if(!stronger)Object.assign(row,{handled:true,handlingAction:action,handlingSource:'副機送印',handledAt:submittedAt});
  if(!helperDocument)row.printCount=(row.printCount||0)+1;
  const following=selected===row.key;
  if(following){activeWork='pending';activeLogistics='all';selected='';$('search').value='';}
  render();
  if(following&&$('documentDialog').open)$('documentDialog').close();
  notice('貨運單已送印，該單已移至「已處理」，目前顯示未處理訂單；正在保存紀錄。');
  try{
    // Shopee originals live on this PC, so the host's /print-event endpoint
    // (which requires a host document) cannot be used for these labels.
    if(helperDocument){if(!stronger)await api('/api/handling',{key:row.key,action:'processed'});}
    else await api('/api/print-event',{key:row.key});
    notice('貨運單已送印，處理紀錄已保存；需要補印可在「已處理」開啟。');
    return true;
  }catch(e){
    // Do not let a failed save look durable. Never resend paper to retry a save.
    const current=data.orders.find(r=>r.key===row.key);
    if(current===row&&(stronger||current.handledAt===submittedAt&&current.handlingSource==='副機送印')){
      Object.assign(current,before);if(selected===row.key){activeWork=before.handled?'done':'pending';}render();
    }
    notice('貨運單已送印，但處理紀錄未保存：'+e.message+'。請勿重複列印，確認出紙後可重新開啟該單，按「已印好」補記。',true);
    return false;
  }
}
function provideDocument(row){
  if(busy||batchRun)return;
  const input=document.createElement('input');input.type='file';input.accept='application/pdf,.pdf';
  input.onchange=async()=>{
    const file=input.files?.[0];if(!file)return;
    if(file.size>8000000){notice('請選擇 8 MB 以內的平台正式 PDF。',true);return;}
    if(!window.confirm(`請確認 PDF 上的訂單編號是 ${row.orderNo}。\n\n檔案：${file.name}\n\n核對正確後，才提供給副機列印。`))return;
    try{
      const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
      await api('/api/provide-document',{key:row.key,base64,binding:row.documentBinding});
      data=await api('/api/orders');selected=row.key;render();notice('已提供貨運單，副機重新讀取即可列印。');
    }catch(e){notice(e.message||'提供文件失敗。',true);}
  };
  input.click();
}
async function refresh() {
  if(busy||batchRun)return;
  busy=true;$('refresh').disabled=true;$('refresh').textContent='更新中，請等待…';renderDetail();notice('');
  try {
    await localMetadataTask;
    data=await api('/api/refresh',{});
    await refreshLocalMetadata();
    const errors=Object.values(data.errors);
    notice(errors.length?errors.join(' '):'',!!errors.length);
  }catch(e){notice(e.message,true);}
  finally{busy=false;$('refresh').disabled=false;$('refresh').textContent='更新讀取最新訂單';render();}
}
function directProgress(message){
  directPrintStatus=/等待你/.test(message)?'請在下方確認出貨資料':'列印中，請等待…';
  const buttons=$('detail').querySelectorAll('#prepare,#shopeeDirectPrint,#showProvidedDocument');
  if(selected===directPrintKey)for(const button of buttons){button.textContent=directPrintStatus;button.disabled=true;}
}
async function printOrder(original,shipmentOptions={},printOptions={},batchOwner=null){
  if(busy||batchRun&&batchOwner!==batchRun)return;
  if(original.stale||original.handlingChanged||['cancelled','review'].includes(original.stage)){
    notice('這筆訂單需要先更新並核對，尚未送印。',true);return;
  }
  if(!window.YouziLocalPrint?.printDocument){notice('列印程式尚未載入，請重新整理頁面後再試。',true);return;}
  busy=true;directPrintKey=original.key;directPrintStatus='正在取得貨運單，請等待…';
  $('refresh').disabled=true;notice('');releaseExternalDocument();window.YouziLocalPrint.reset();renderBatch();renderDetail();
  const own=documentGeneration;
  const active=()=>own===documentGeneration&&(!remote||window.ShippingTransport.loggedIn());
  let row=original,links,needsOptions=false;
  const outcome={submitted:false,recorded:false,error:''};
  try{
    await localMetadataTask;
    if(!active())return;
    // Validate items before creating or retrieving a shipment.
    ShippingModel.packingLabel(row);
    if(ShippingModel.savedDocumentAvailable(row)){
      links=await api('/api/document-link',{key:row.key});
    }else if(row.platform==='EasyStore'&&row.channel==='蝦皮'){
      if(!window.YouziShopeeBridge)throw Error('請在副機更新蝦皮取單助手。');
      const result=await window.YouziShopeeBridge.getDocument(row,directProgress,{direct:true});
      if(!active())return;
      const current=data.orders.find(r=>r.key===row.key);
      if(current===row)Object.assign(row,{tracking:result.tracking,canDownload:true,canCreate:false});
      row={...row,tracking:result.tracking};
      const url=URL.createObjectURL(new Blob([result.pdf],{type:'application/pdf'}));
      externalDocumentUrls.push(url);links={label:url,print:url};
    }else{
      if(row.platform==='EasyStore'&&row.documentType!=='postal-address-v1')throw Error('這筆訂單尚未提供正式貨運單，請先在對應平台完成物流資料。');
      if(!row.canCreate&&!row.canDownload)throw Error('這筆訂單尚未提供可列印的貨運單。');
      await ShippingModel.obtainDocument(api,row,{...shipmentOptions,carrier:row.carrierCode||''},()=>directProgress('正在取得貨運單，請等待…'));
      if(!active())return;
      data=await api('/api/orders');
      row=data.orders.find(r=>r.key===original.key);
      if(!row)throw Error('訂單已更新，請重新選取後核對。');
      links=await api('/api/document-link',{key:row.key});
    }
    if(!active())return;
    directProgress('正在準備列印，請等待…');
    await window.YouziLocalPrint.printDocument(row,links,async()=>{
      outcome.submitted=true;outcome.recorded=await recordLocalSubmission(row);
      if(!outcome.recorded)outcome.error='貨運單已送印，但處理紀錄未保存；請先核對，勿重複列印。';
    },{...printOptions,isActive:active,onStatus:directProgress});
  }catch(error){
    outcome.error=error.message;
    needsOptions=row.platform==='Coupang'&&/出貨地址代碼|退貨地址代碼/.test(error.message);
    notice(error.message,true);
  }
  finally{
    if(own===documentGeneration)releaseExternalDocument();
    busy=false;directPrintKey='';directPrintStatus='';$('refresh').disabled=!!batchRun;render();
    if(needsOptions&&selected===original.key)showDirectShippingOptions(original,printOptions);
  }
  return outcome;
}
function showDirectShippingOptions(row,printOptions={}){
  const home=['TWL_HCT','TWL_KERRY'].includes(row.carrierCode);
  const field=home?'outboundShippingPlaceCode':'returnCenterCode';
  const label=home?'酷澎出貨地址代碼':'酷澎退貨地址代碼';
  $('directShipmentOptions').innerHTML=`<form id="directShippingForm"><label class="option-row">${label}<input name="${field}" required ${home?'inputmode="numeric" pattern="[0-9]+"':''}></label><button class="primary" type="submit">確認資料並列印貨運單</button></form>`;
  $('directShippingForm').addEventListener('submit',event=>{
    event.preventDefault();if(busy||batchRun)return;
    printOrder(data.orders.find(r=>r.key===row.key)||row,{[field]:event.currentTarget.elements.namedItem(field).value},printOptions);
  });
}

async function prepare(row) {
  if(busy||batchRun)return;
  // Reuse the same saved-document route as "預覽正式貨運單". The host still
  // validates the saved document's binding against its current order snapshot.
  if(ShippingModel.savedDocumentAvailable(row)){
    return showDocument(row.key);
  }
  beginDocument(row);
  if(!row.canDownload&&row.platform==='Coupang'){
    if(!Object.hasOwn(carriers,row.carrierCode)){
      $('documentStatus').textContent='平台尚未提供可核對的配送方式，請先核對原訂單。';
      $('documentPlaceholder').textContent='尚未建立出貨。';
      return;
    }
    $('documentStatus').textContent='請填寫這筆出貨使用的物流資料。';
    $('documentPlaceholder').textContent='出貨成功後，貨運單會顯示在這裡。';
    $('shipmentOptions').hidden=false;
    $('shipmentOptions').innerHTML=`<div class="option-row">訂單配送方式：${escapeHtml(carriers[row.carrierCode])}</div><label id="outboundOption" class="option-row">宅配出貨地址代碼<input id="outbound" inputmode="numeric" pattern="[0-9]+" placeholder="酷澎已登記的出貨地址代碼"></label><label id="returnOption" class="option-row">超商退貨地址代碼<input id="returnCenter" placeholder="酷澎已登記的退貨地址代碼"></label><button type="submit" class="primary">確認出貨並取單</button>`;
    const chooseCarrier=()=>{
      const home=['TWL_HCT','TWL_KERRY'].includes(row.carrierCode);
      const store=['TWL_FM','TWL_711'].includes(row.carrierCode);
      $('outboundOption').hidden=!home;$('outbound').required=home;
      $('returnOption').hidden=!store;$('returnCenter').required=store;
    };
    chooseCarrier();
    $('shipmentOptions').onsubmit=e=>{
      e.preventDefault();
      if(busy||batchRun)return;
      obtainDocument(row,{carrier:row.carrierCode,outboundShippingPlaceCode:$('outbound').value,returnCenterCode:$('returnCenter').value});
    };
    // The host resolves a unique official shipping location. Keep the form
    // available only when a choice is required or that lookup fails.
    if(['TWL_HCT','TWL_KERRY'].includes(row.carrierCode)){
      $('shipmentOptions').hidden=true;
      if(await obtainDocument(row,{carrier:row.carrierCode})===false)$('shipmentOptions').hidden=false;
    }
  }else await obtainDocument(row,{carrier:row.carrierCode||''});
}
function documentSummary(row){
  const maskedMomo=row.channel==='MOMO'&&/[○◯●＊*]/.test(`${row.recipient||''}${row.address||''}`);
  $('documentSummary').innerHTML=`<div class="document-order">${badge(row)}<h3>${escapeHtml(row.orderNo)}</h3>${paidAmountHtml(row)}</div><div class="document-items">${packingItems(row).map(itemHtml).join('')}</div><div class="subline">${escapeHtml(row.recipient)}${row.pickupStore?' · '+escapeHtml(row.pickupStore):''}</div><div class="subline">${escapeHtml(row.address)}</div>${maskedMomo?'<p class="muted">MOMO 訂單資料已遮蔽部分姓名或地址；完整配送資訊請核對正式貨運單。</p>':''}${row.tracking?`<p class="tracking-number">物流單號：${escapeHtml(row.tracking)}</p>`:''}`;
  $('printerHint').textContent=['MOMO','酷澎','蝦皮','官網','LINE'].includes(row.channel)?'使用副機 XP-420B；正在確認本機列印助手。':'請選擇這張貨運單使用的印表機與紙張。';
  $('momoPasswordHint').hidden=row.channel!=='MOMO';
}
function beginDocument(row){
  releaseExternalDocument();
  window.YouziLocalPrint?.reset();
  if($('documentMore'))$('documentMore').open=false;
  documentSummary(row);
  $('documentControls').hidden=true;$('documentFrame').hidden=true;$('documentFrame').src='about:blank';
  $('documentPreviewImage').hidden=true;$('documentPreviewImage').removeAttribute('src');$('previewCaption').hidden=true;$('zoomDocumentPreview').hidden=true;
  $('documentPlaceholder').hidden=false;$('documentPlaceholder').textContent='正在取回貨運單…';
  $('documentStatus').textContent='正在核對訂單資料…';
  $('shipmentOptions').hidden=true;$('shipmentOptions').innerHTML='';
  if(!$('documentDialog').open)$('documentDialog').showModal();
}
function documentBusy(value){
  busy=value;$('refresh').disabled=value;
  $('shipmentOptions').querySelectorAll('input,select,button').forEach(el=>el.disabled=value);
  renderDetail();
}
function documentError(error){
  $('documentStatus').textContent=error.message;
  $('documentPlaceholder').textContent='未能開啟貨運單，請依左側訊息處理。';
  notice(error.message,true);
}
async function obtainDocument(row,options){
  documentBusy(true);
  try{
    await ShippingModel.obtainDocument(api,row,options,fresh=>{
      documentSummary({...row,...fresh});
      $('documentStatus').textContent=fresh.action==='download'?'正在取回原貨運單…':fresh.action==='postal'?'正在產生郵局寄件標籤…':'正在申請出貨，請勿重複操作…';
    });
    data=await api('/api/orders');selected=row.key;render();
    $('documentStatus').textContent='貨運單已取得，正在傳回預覽與列印檔…';
    await loadDocument(row.key);
    notice('已取得正式貨運單，可直接列印。');
  }catch(e){documentError(e);return false;}
  finally{documentBusy(false);}
}
async function loadDocument(key){
  const links=await api('/api/document-link',{key});
  // A logout can close the dialog while the remote document is being prepared.
  if(remote&&!window.ShippingTransport.loggedIn())return;
  const row=data.orders.find(r=>r.key===key);
  // Opening a PDF alone does not confirm printing. The local submission callback
  // or the explicit "已印好" confirmation records completion.
  presentDocument(row,links,async()=>{});
}
function presentDocument(row,links,recordPrint){
  const key=row.key;
  if(row)documentSummary(row);
  const url=links.label;
  $('openDocument').href=links.print||url;$('downloadDocument').href=url;
  $('momoPasswordHint').textContent=links.print?'列印副本已解密；下載的原檔保留平台密碼。':'MOMO 若要求 PDF 密碼，請輸入供應商公司統編。';
  const combined=row?.documentKinds?.includes('combined');
  $('combinedDocument').hidden=!combined;$('combinedDocument').href=links.combined;
  $('openDocument').onclick=recordPrint;$('combinedDocument').onclick=recordPrint;
  window.YouziLocalPrint?.attach(row,links,recordPrint,()=>recordLocalSubmission(row));
  $('confirmPrinted').onclick=()=>markHandled(key,'printed');
  $('shipmentOptions').hidden=true;$('documentStatus').textContent='貨運單已備妥。';
  $('documentControls').hidden=false;
  if(links.preview){
    $('documentPreviewImage').src=links.preview;$('documentPreviewImage').hidden=false;
    $('zoomDocumentPreview').hidden=false;
    $('zoomDocumentPreview').onclick=()=>{$('largeImage').src=links.preview;$('largeImage').alt='貨運單預覽';$('imageTitle').textContent='貨運單第一頁預覽';$('imageDialog').showModal();};
    $('previewCaption').hidden=false;$('documentPlaceholder').hidden=true;
  }else{
    $('documentPlaceholder').hidden=false;
    $('documentPlaceholder').textContent=row?.channel==='MOMO'?'這張 PDF 有加密，請開啟原單並輸入公司統編。':'請按「開啟原單列印」查看完整貨運單。';
  }
}
function releaseExternalDocument(){
  documentGeneration++;window.YouziShopeeBridge?.cancel();
  for(const url of externalDocumentUrls)URL.revokeObjectURL(url);
  externalDocumentUrls=[];
}
async function prepareShopee(row){
  if(busy||batchRun)return;
  beginDocument(row);documentBusy(true);
  const own=documentGeneration;
  try{
    if(!window.YouziShopeeBridge)throw Error('請在副機更新蝦皮取單助手。');
    const result=await window.YouziShopeeBridge.getDocument(row,message=>{
      if(own===documentGeneration)$('documentStatus').textContent=message;
    });
    if(own!==documentGeneration||!$('documentDialog').open||(remote&&!window.ShippingTransport.loggedIn()))return;
    // Keep the verified logistics number for an immediate reprint in this view.
    // The host may not have published its next order snapshot yet.
    if(data.orders.find(r=>r.key===row.key)===row){
      Object.assign(row,{tracking:result.tracking,canDownload:true,canCreate:false});renderDetail();
    }
    const url=URL.createObjectURL(new Blob([result.pdf],{type:'application/pdf'}));
    externalDocumentUrls.push(url);
    // Acquisition alone does not finish packing. The local print callback moves
    // this order only after a confirmed submission, without claiming handover.
    presentDocument({...row,tracking:result.tracking},{label:url,print:url,preview:result.preview},async()=>{});
  }catch(e){if(own===documentGeneration)documentError(e);}
  finally{documentBusy(false);}
}
async function showDocument(key) {
  if(busy||batchRun)return;
  const row=data.orders.find(r=>r.key===key);
  if(!row)return;
  beginDocument(row);documentBusy(true);
  $('documentStatus').textContent='正在開啟已備妥的貨運單，無須重新向平台取單…';
  try{await loadDocument(key);}catch(e){documentError(e);}
  finally{documentBusy(false);}
}
async function printPacking(row) {
  return printOrder(row, {}, {packingSheet:true});
}
$('refresh').addEventListener('click',refresh);
$('batchPrint').addEventListener('click',printBatch);
$('batchStop').addEventListener('click',()=>{if(batchRun){batchRun.stop=true;renderBatch();}});
$('clearSelection').addEventListener('click',()=>{if(!busy&&!batchRun){checkedOrders.clear();render();}});
$('selectVisible').addEventListener('change',e=>{if(busy||batchRun)return;for(const row of filtered().filter(batchEligible)){if(e.target.checked)checkedOrders.add(row.key);else checkedOrders.delete(row.key);}render();});
$('orders').addEventListener('change',e=>{if(busy||batchRun||!e.target.dataset.check)return;const key=e.target.dataset.check;if(e.target.checked)checkedOrders.add(key);else checkedOrders.delete(key);renderBatch();});
// Keep the older installed helper usable until the packing PC is updated.
// Normalize its label, but never invoke its click handler automatically.
if(typeof MutationObserver!=='undefined')new MutationObserver(()=>{
  const fallback=$('shopeeDirectPrint');
  if(!fallback)return;
  const row=data.orders.find(r=>r.key===selected);
  const helpers=[...$('detail').querySelectorAll('button,a')].filter(el=>el!==fallback&&
    (el.dataset.youziLegacyShopee==='1'||/取得蝦皮貨運單/.test(el.textContent)&&/XP-420B/.test(el.textContent)));
  const modern=window.YouziShopeeBridge?.available();
  for(const el of helpers){
    el.dataset.youziLegacyShopee='1';
    const label=ShippingModel.documentActionLabel(row||{});
    if(el.textContent!==label)el.textContent=label;
    if(!el.hidden)el.hidden=true;
  }
  const hide=false;
  if(fallback.hidden!==hide)fallback.hidden=hide;
}).observe($('detail'),{childList:true,subtree:true,characterData:true});
window.addEventListener('youzi-shopee-helper-ready',()=>renderDetail());
$('documentDialog').addEventListener('close',()=>{releaseExternalDocument();window.YouziLocalPrint?.reset();});
$('channels').addEventListener('click',e=>{if(directPrintKey||batchRun)return;const b=e.target.closest('[data-channel]');if(b){activeChannel=b.dataset.channel;render();}});
$('logisticsTabs').addEventListener('click',e=>{if(directPrintKey||batchRun)return;const b=e.target.closest('[data-logistics]');if(b){activeLogistics=b.dataset.logistics;render();}});
$('orders').addEventListener('click',e=>{if(directPrintKey||batchRun)return;const b=e.target.closest('[data-key]');if(b){selected=b.dataset.key;render();}});
$('search').addEventListener('input',()=>{if(!directPrintKey&&!batchRun)render();});
$('workTabs').addEventListener('click',e=>{if(directPrintKey||batchRun)return;const b=e.target.closest('[data-work]');if(b){activeWork=b.dataset.work;render();}});
$('detail').addEventListener('click',e=>{
  const button=e.target.closest('[data-image]');
  if(!button)return;
  $('largeImage').src=button.dataset.image;
  $('largeImage').alt=button.dataset.title;
  $('imageTitle').textContent=button.dataset.title;
  $('imageDialog').showModal();
});
async function initializeWorkbench(){return api('/api/orders').then(payload=>{
  data=payload;
  if(!data.updated){data.orders=[];render();refresh();}
  else{render();notice(Object.values(data.errors).join(' '),!!Object.keys(data.errors).length);refreshLocalMetadata();}
}).catch(e=>notice(e.message,true));}
if(remote)window.ShippingTransport.ready(initializeWorkbench);
else initializeWorkbench();
// Poll while this workbench is visible. Reading orders never creates shipments.
setInterval(async()=>{
  if(document.hidden||busy||batchRun||document.querySelector('dialog[open]')||remote&&!window.ShippingTransport.loggedIn())return;
  // The host already refreshes platforms periodically. Each open browser only
  // reads the resulting snapshot; it must not enqueue another full refresh.
  const own=documentGeneration;
  try{const latest=await api('/api/orders');if(!busy&&!batchRun&&own===documentGeneration){data=latest;render();}}catch{}
},300000);
setInterval(()=>{if(!document.hidden&&!busy&&!batchRun&&!document.querySelector('dialog[open]')&&(!remote||window.ShippingTransport.loggedIn()))render();},60000);




