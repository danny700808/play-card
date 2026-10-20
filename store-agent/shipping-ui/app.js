'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stageNames = {pending:'待出貨',partial:'部分待出貨',label:'可印貨運單',shipped:'已出貨',cancelled:'已取消',review:'需核對'};
const ORDER_DAYS = 3;
let data = {orders:[],errors:{},connectors:[]}, selected = '', activeChannel = '全部', activeWork = 'pending', busy = false, reviewed = null, reviewOptions = {};
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
function filtered() {
  const term=$('search').value.toLowerCase().trim(), compact=ShippingModel.searchCode(term);
  return data.orders.filter(r => (activeChannel==='全部'||r.channel===activeChannel) &&
    (activeWork==='all'||(activeWork==='done'?r.handled:!r.handled)) &&
    (!term||[r.orderNo,r.recipient,r.tracking,...r.items.map(i=>`${i.name} ${i.sku} ${i.variant}`)].join(' ').toLowerCase().includes(term)||
      (compact&&r.items.some(i=>ShippingModel.searchCode(i.sku).includes(compact)))))
    .sort((a,b)=>channels.indexOf(a.channel)-channels.indexOf(b.channel)||
      b.date.localeCompare(a.date)||b.orderNo.localeCompare(a.orderNo));
}
function render() {
  $('channels').innerHTML=channels.map(c=>`<button data-channel="${escapeHtml(c)}" aria-pressed="${c===activeChannel}" class="${c===activeChannel?'active':''}">${escapeHtml(c)}</button>`).join('');
  const channelRows=data.orders.filter(r=>activeChannel==='全部'||r.channel===activeChannel);
  $('workTabs').innerHTML=[['pending','未處理',channelRows.filter(r=>!r.handled).length],['done','已處理',channelRows.filter(r=>r.handled).length],['all','全部',channelRows.length]].map(([key,label,count])=>
    `<button data-work="${key}" class="${activeWork===key?'active':''}" aria-pressed="${activeWork===key}">${label} <strong>${count}</strong></button>`).join('');
  const rows=filtered();
  if(!rows.some(r=>r.key===selected))selected=rows[0]?.key||'';
  $('resultCount').textContent=`${rows.length} 筆`;
  $('syncTime').textContent=data.updated?`更新 ${new Date(data.updated).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}`:'';
  $('orders').innerHTML=rows.length?channels.slice(1).map(c=>{
    const group=rows.filter(r=>r.channel===c);
    if(!group.length)return '';
    return `<section class="platform-group" aria-label="${escapeHtml(c)}訂單"><div class="group-heading">${badge(group[0])}<span>${group.length} 筆</span></div>${group.map(r=>{
      const items=packingItems(r),quantity=items.reduce((n,i)=>n+i.quantity,0);
      return `<button class="order-card ${r.key===selected?'selected':''}" data-key="${escapeHtml(r.key)}" aria-pressed="${r.key===selected}"><div class="line"><span class="order-no">${escapeHtml(r.orderNo)}</span><span class="status ${r.handled?'done':'pending'}">${escapeHtml(ShippingModel.status(r))}</span></div><div class="order-name">${escapeHtml(items[0]?.name || r.items[0]?.name || '未取得商品明細')}${items.length>1?` 等 ${items.length} 項`:''}</div><div class="line order-meta"><strong>${quantity} 件</strong><span>${escapeHtml(localDay(r.date))}</span></div></button>`;
    }).join('')}</section>`;
  }).join(''):'<div class="empty">沒有符合條件的訂單</div>';
  renderDetail();
}
function renderDetail() {
  const row=data.orders.find(r=>r.key===selected);
  if(!row) {$('detail').innerHTML='<div class="empty">選擇訂單查看包貨內容</div>';return;}
  const enabled=(row.canCreate||row.canDownload)&&!row.stale;
  const easyStoreOrder = row.platform==='EasyStore' && /^\d+$/.test(String(row.externalId||''))
    ? `https://admin.easystore.co/orders/${row.externalId}` : '';
  const shopeeViaEasyStore = !!easyStoreOrder && row.channel==='蝦皮';
  const externalAction = easyStoreOrder && !remote
    ? `<a class="action-link primary" href="${easyStoreOrder}" target="_blank" rel="noopener noreferrer">${shopeeViaEasyStore?(row.handled?'到 EasyStore 重印蝦皮單':'到 EasyStore 出貨／印蝦皮單'):'開啟 EasyStore 對應訂單'} ↗</a>` : '';
  const shippingAction = row.platform==='EasyStore' ? (remote?(row.documentReady?'<button id="showProvidedDocument" class="primary">重印貨運單</button>':'<span class="muted">貨運單尚待主機提供</span>'):externalAction)
    : `<button id="prepare" class="primary" ${!enabled||busy?'disabled':''}>${row.canDownload?(row.handled?'重印貨運單':'取得貨運單'):'申請出貨與貨運單'}</button>`;
  const items=packingItems(row),quantity=items.reduce((n,i)=>n+i.quantity,0);
  const packingNote=(row.note||'').split('\n').filter(line=>!/^買家帳號[：:]/.test(line.trim())).join('\n').trim();
  $('detail').innerHTML=`<div class="detail-header"><div>${badge(row)}<span class="status ${row.handled?'done':'pending'}">${escapeHtml(ShippingModel.status(row))}</span><h2>${escapeHtml(row.orderNo)}</h2></div><div class="packing-total">共 <strong>${quantity}</strong> 件</div></div>
    ${row.handled?`<div class="handling-summary">✓ 已處理 · ${escapeHtml(ShippingModel.status(row))}${row.handledAt?' · '+escapeHtml(new Date(row.handledAt).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})):''}<span>${escapeHtml(row.handlingSource)}</span></div>`:''}
    <div class="detail-section packing-section">${items.map(itemHtml).join('')||'<div class="empty">沒有可包貨的商品</div>'}</div>
    ${packingNote?`<div class="note order-note">${escapeHtml(packingNote)}</div>`:''}
    <div class="actions">${shippingAction}<button id="packing">列印包貨明細</button>${row.documentReady?'<button id="showDocument">預覽正式貨運單</button>':''}${!remote&&row.platform==='EasyStore'?'<button id="provideDocument">提供貨運單給副機</button>':''}</div>
    <div class="handling-actions">${row.handlingAction!=='printed'&&row.handlingAction!=='shipped'?'<button id="markPrinted">我已印單</button>':''}${row.handlingAction!=='shipped'?'<button id="markShipped">我已出貨</button>':''}${row.handled?'<button id="reopen" class="quiet">移回未處理</button>':''}</div>
    ${row.jobError||row.stale||row.blockReason&&row.platform!=='EasyStore'?`<div class="block-note">${escapeHtml(row.stale?'資料尚未更新，請重新讀取。':row.jobError||row.blockReason)}</div>`:''}
    <details class="recipient-details"><summary>收件與物流資訊</summary><div class="recipient">${escapeHtml(row.recipient||'尚無資料')}　${escapeHtml(row.phone)}</div><div class="subline">${escapeHtml(row.pickupStore||'')} ${escapeHtml(row.address||'')}</div><div class="subline">${escapeHtml(row.carrier||'物流未提供')}${row.tracking?` · ${escapeHtml(row.tracking)}`:''}</div><div class="subline">平台回傳：${escapeHtml(stageNames[row.stage]||row.status)}${row.printCount?` · 開啟列印 ${row.printCount} 次`:''}</div></details>`;
  $('prepare')?.addEventListener('click',()=>prepare(row));
  $('showProvidedDocument')?.addEventListener('click',()=>showDocument(row.key).catch(e=>notice(e.message,true)));
  $('provideDocument')?.addEventListener('click',()=>provideDocument(row));
  $('packing').addEventListener('click',()=>printPacking(row));
  $('showDocument')?.addEventListener('click',()=>showDocument(row.key).catch(e=>notice(e.message,true)));
  $('markPrinted')?.addEventListener('click',()=>markHandled(row.key,'printed'));
  $('markShipped')?.addEventListener('click',()=>markHandled(row.key,'shipped'));
  $('reopen')?.addEventListener('click',()=>markHandled(row.key,'reopen'));
  $('detail').querySelectorAll('.item-photo img').forEach(img=>img.addEventListener('error',()=>{
    const button=img.parentElement;
    button.replaceWith(Object.assign(document.createElement('div'),{className:'image-placeholder',textContent:'圖片無法載入'}));
  }));
}
async function markHandled(key,action){
  try{
    await api('/api/handling',{key,action});
    data=await api('/api/orders');activeWork=action==='reopen'?'pending':'done';selected=key;render();
    notice(action==='reopen'?'已移回未處理。':'已保存處理紀錄。');
  }catch(e){notice(e.message,true);}
}
function provideDocument(row){
  const input=document.createElement('input');input.type='file';input.accept='application/pdf,.pdf';
  input.onchange=async()=>{
    const file=input.files?.[0];if(!file)return;
    if(file.size>8000000){notice('請選擇 8 MB 以內的平台正式 PDF。',true);return;}
    if(!window.confirm(`請確認 PDF 上的訂單編號是 ${row.orderNo}。\n\n檔案：${file.name}\n\n核對正確後，才提供給副機列印。`))return;
    try{
      const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
      await api('/api/provide-document',{key:row.key,base64,binding:row.documentBinding});
      data=await api('/api/orders');activeWork='done';selected=row.key;render();notice('已提供貨運單，副機重新讀取即可列印。');
    }catch(e){notice(e.message||'提供文件失敗。',true);}
  };
  input.click();
}
async function refresh() {
  if(busy)return;
  busy=true;$('refresh').disabled=true;renderDetail();notice('正在更新訂單…');
  try {
    data=await api('/api/refresh',{days:ORDER_DAYS});
    const errors=Object.values(data.errors);
    notice(errors.length?errors.join(' '):'',!!errors.length);
  }catch(e){notice(e.message,true);}
  finally{busy=false;$('refresh').disabled=false;render();}
}
async function prepare(row) {
  reviewed=null;reviewOptions={carrier:row.carrierCode||''};
  $('reviewTitle').textContent=row.canDownload?(row.handled?'重印原貨運單':'取得平台正式貨運單'):'申請出貨前核對';
  const options = !row.canDownload && row.platform==='Coupang' ? `<label class="option-row">物流公司<select id="carrier"><option value="">請選擇</option>${Object.entries(carriers).map(([k,v])=>`<option value="${k}" ${k===reviewOptions.carrier?'selected':''}>${v}</option>`).join('')}</select></label><label class="option-row">宅配出貨地址代碼<input id="outbound" inputmode="numeric" placeholder="酷澎已登記的出貨地址代碼"></label><label class="option-row">超商退貨地址代碼<input id="returnCenter" placeholder="酷澎已登記的退貨地址代碼"></label>`:'';
  $('reviewBody').innerHTML=`<div class="review-grid"><strong>${escapeHtml(row.channel)} · ${escapeHtml(row.orderNo)}</strong>${escapeHtml(row.recipient)}<br>${escapeHtml(row.address)}<br>${row.items.map(i=>`${escapeHtml(i.name)} ${escapeHtml(i.variant)} × ${i.quantity}`).join('<br>')}</div>${options}<p id="reviewMessage" class="muted">${row.canDownload?'取回原貨運單，不會重新出貨。':'新出貨尚待實單驗收。確認後會正式向平台申請出貨。'}</p>`;
  $('submitShipment').textContent='讀取最新資料並核對';$('submitShipment').disabled=false;
  $('reviewDialog').showModal();
  $('submitShipment').onclick=async()=>{
    $('submitShipment').disabled=true;
    try{
      if(!reviewed){
        reviewOptions={carrier:$('carrier')?.value||row.carrierCode||'',
          outboundShippingPlaceCode:$('outbound')?.value||'',returnCenterCode:$('returnCenter')?.value||''};
        reviewed=await api('/api/preview',{key:row.key,options:reviewOptions});
        // Replace initial review with fresh server-returned data; options cannot change unnoticed.
        $('reviewBody').innerHTML=`<div class="review-grid"><strong>${escapeHtml(reviewed.orderNo)} · ${escapeHtml(carriers[reviewed.carrierCode]||reviewed.carrier)}</strong>${escapeHtml(reviewed.recipient)}<br>${escapeHtml(reviewed.address)}<br>${reviewed.items.map(i=>`${escapeHtml(i.name)} ${escapeHtml(i.variant)} × ${i.quantity}`).join('<br>')}${reviewed.tracking?`<br>原運單號：${escapeHtml(reviewed.tracking)}`:''}</div><p id="reviewMessage" class="muted">${reviewed.action==='download'?'已重新確認平台資料，取回原單號文件，不會重新申請出貨。':'已重新確認平台資料。確認後會正式申請出貨。'}</p>`;
        $('submitShipment').textContent=reviewed.action==='download'?(row.handled?'開啟原貨運單重印':'取得正式貨運單'):'確認申請出貨';
      }else{
        $('reviewMessage').textContent='正在處理，請勿重複送出…';
        const result=await api('/api/process',{key:row.key,options:reviewOptions,fingerprint:reviewed.fingerprint});
        $('reviewDialog').close();
        data=await api('/api/orders');activeWork='done';selected=row.key;render();
        notice(result.reused?'已開啟保留的正式貨運單，可重印。':'已取得平台正式貨運單。');
        await showDocument(row.key);
      }
    }catch(e){$('reviewMessage').textContent=e.message;notice(e.message,true);reviewed=null;$('submitShipment').textContent='重新核對';}
    finally{$('submitShipment').disabled=false;}
  };
}
async function showDocument(key) {
  const links=await api('/api/document-link',{key});
  const url=links.label;
  $('documentFrame').src=url;$('openDocument').href=url;$('downloadDocument').href=url;
  const combined=data.orders.find(r=>r.key===key)?.documentKinds?.includes('combined');
  $('combinedDocument').hidden=!combined;$('combinedDocument').href=links.combined;
  const recordPrint=()=>api('/api/print-event',{key}).then(()=>api('/api/orders')).then(payload=>{data=payload;render();}).catch(e=>notice(e.message,true));
  $('openDocument').onclick=recordPrint;$('combinedDocument').onclick=recordPrint;
  $('confirmPrinted').onclick=()=>markHandled(key,'printed');
  $('documentDialog').showModal();
}
async function printPacking(row) {
  if(['cancelled','review'].includes(row.stage)){notice('此訂單需要先核對狀態，暫不列印包貨明細。',true);return;}
  if(row.stage==='partial'&&row.items.some(i=>i.remaining==null)){notice('平台未提供部分出貨的剩餘數量，請先核對，暫不列印。',true);return;}
  const items=packingItems(row);
  $('packingPrint').innerHTML=`<div class="print-top"><div><h1>柚子樂器 · 包貨明細</h1>${escapeHtml(row.channel)} / ${escapeHtml(row.orderNo)}</div><div>核對單，非貨運單<br>${escapeHtml(new Date().toLocaleString('zh-TW'))}</div></div><div class="recipient">收件人：${escapeHtml(row.recipient)}</div><div class="subline">${escapeHtml(row.address)}</div>${row.tracking?`<p>物流單號：${escapeHtml(row.tracking)}</p>`:''}${row.note?`<div class="note">${escapeHtml(row.note)}</div>`:''}${items.map(itemHtml).join('')}<div class="print-footer"><span>包貨人：________________</span><span>□ 規格　□ 數量　□ 配件／贈品</span></div>`;
  await Promise.all([...$('packingPrint').querySelectorAll('img')].map(img=>img.complete?Promise.resolve():Promise.race([new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;}),new Promise(resolve=>setTimeout(resolve,5000))])));
  window.print();
}
$('refresh').addEventListener('click',refresh);
$('channels').addEventListener('click',e=>{const b=e.target.closest('[data-channel]');if(b){activeChannel=b.dataset.channel;render();}});
$('orders').addEventListener('click',e=>{const b=e.target.closest('[data-key]');if(b){selected=b.dataset.key;render();}});
$('search').addEventListener('input',render);
$('workTabs').addEventListener('click',e=>{const b=e.target.closest('[data-work]');if(b){activeWork=b.dataset.work;render();}});
$('cancelReview').addEventListener('click',()=>$('reviewDialog').close());
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
  if(!data.updated||data.days!==ORDER_DAYS){data.orders=[];render();refresh();}
  else{render();notice(Object.values(data.errors).join(' '),!!Object.keys(data.errors).length);}
}).catch(e=>notice(e.message,true));}
if(remote)window.ShippingTransport.ready(initializeWorkbench);
else initializeWorkbench();
// Poll while this workbench is visible. Reading orders never creates shipments.
setInterval(()=>{if(!document.hidden&&!busy&&!document.querySelector('dialog[open]')&&(!remote||window.ShippingTransport.loggedIn()))refresh();},300000);
