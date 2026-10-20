'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stageNames = {pending:'待處理',partial:'部分出貨',label:'已有貨運單號',shipped:'已出貨',cancelled:'已取消',review:'需要核對'};
let data = {orders:[],errors:{},connectors:[]}, selected = '', activeChannel = '全部', busy = false, reviewed = null, reviewOptions = {};
const channels = ['全部','官網','蝦皮','酷澎','MOMO','LINE','來源待確認'];
const carriers = {TWL_HCT:'新竹物流',TWL_KERRY:'嘉里大榮',TWL_FM:'全家',TWL_711:'7-11'};
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || '連線失敗');
  return payload;
}
function notice(message, error=false) { $('notice').textContent=message;$('notice').classList.toggle('error',error); }
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
  const image = item.image && item.image.startsWith('https:') ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.variant || item.name)}" referrerpolicy="no-referrer">` : '<div class="image-placeholder">圖片待配對</div>';
  return `<div class="item">${image}<div><div class="item-name">${escapeHtml(item.name)}</div><div class="item-variant">${escapeHtml(item.variant || '未提供規格')}</div><div class="sku">SKU ${escapeHtml(item.sku || '缺少商品編號')}</div>${item.remaining != null && item.remaining !== item.quantity ? `<div class="sku">尚未出貨 ${Number(item.remaining)} 件</div>`:''}${item.heldQuantity ? '<div class="item-variant">有取消申請，請先核對</div>':''}</div><div class="qty">${Number(item.quantity)} <small>件</small></div></div>`;
}
function filtered() {
  const term=$('search').value.toLowerCase().trim(), stage=$('stage').value;
  return data.orders.filter(r => (activeChannel==='全部'||r.channel===activeChannel) &&
    (stage==='all'||stage==='active'&&['pending','partial','label','review'].includes(r.stage)||r.stage===stage) &&
    (!term||[r.orderNo,r.recipient,r.tracking,...r.items.map(i=>`${i.name} ${i.sku} ${i.variant}`)].join(' ').toLowerCase().includes(term)))
    .sort((a,b)=>b.date.localeCompare(a.date)||a.orderNo.localeCompare(b.orderNo));
}
function render() {
  $('pendingCount').textContent=data.orders.filter(r=>['pending','partial'].includes(r.stage)).length;
  $('labelCount').textContent=data.orders.filter(r=>r.stage==='label').length;
  $('documentCount').textContent=data.orders.filter(r=>r.documentReady).length;
  $('reviewCount').textContent=data.orders.filter(r=>r.stage==='review'||['uncertain','sending'].includes(r.jobState)).length;
  $('channels').innerHTML=channels.map(c=>`<button data-channel="${escapeHtml(c)}" class="${c===activeChannel?'active':''}">${escapeHtml(c)}</button>`).join('');
  const rows=filtered();
  $('resultCount').textContent=`${rows.length} 個訂單／包裹`;
  $('syncTime').textContent=data.updated?`更新 ${new Date(data.updated).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})} · 近 ${data.days} 天`:'';
  $('orders').innerHTML=rows.length?rows.map(r=>`<button class="order-card ${r.key===selected?'selected':''}" data-key="${escapeHtml(r.key)}"><div class="line"><div>${badge(r)}<span class="order-no">${escapeHtml(r.orderNo)}</span></div><span class="status">${escapeHtml(r.documentReady?'文件已取回':stageNames[r.stage])}</span></div><div class="order-name">${escapeHtml(r.items[0]?.name || '未取得商品明細')}${r.items.length>1?` 等 ${r.items.length} 項`:''}</div><div class="line order-meta"><span>${escapeHtml(r.recipient || '未提供收件人')} · ${r.items.reduce((n,i)=>n+i.quantity,0)} 件</span><span>${escapeHtml(r.date.slice(0,10)||r.carrier)}</span></div></button>`).join(''):'<div class="empty">沒有符合條件的訂單<br><small>可切換來源、狀態或搜尋條件。</small></div>';
  $('connectors').innerHTML=data.connectors.map(c=>`<div class="connector"><b>${escapeHtml(c.name)}</b><span>${escapeHtml(c.status)}</span><small>${escapeHtml(c.detail)}</small></div>`).join('');
  renderDetail();
}
function renderDetail() {
  const row=data.orders.find(r=>r.key===selected);
  if(!row) {$('detail').innerHTML='<div class="empty">選擇一張訂單<br><small>在這裡核對商品及取得正式貨運單。</small></div>';return;}
  const enabled=(row.canCreate||row.canDownload)&&!row.stale;
  $('detail').innerHTML=`<div class="detail-header">${badge(row)}<span class="status">${escapeHtml(stageNames[row.stage])}</span><h2>${escapeHtml(row.orderNo)}</h2><p>${escapeHtml(row.carrier||'物流方式待確認')}${row.packageId?` · 包裹／明細 ${escapeHtml(row.packageId)}`:''}</p>${row.tracking?`<p>正式物流單號：<b>${escapeHtml(row.tracking)}</b></p>`:''}</div>
    <div class="detail-section"><div class="section-label">收件資訊</div><div class="recipient">${escapeHtml(row.recipient||'尚無資料')}　<span class="subline">${escapeHtml(row.phone)}</span></div><div class="subline">${escapeHtml(row.pickupStore||'')} ${escapeHtml(row.address||'尚無地址資料')}</div>${row.note?`<div class="note">訂單備註<br>${escapeHtml(row.note)}</div>`:''}</div>
    <div class="detail-section"><div class="section-label">包貨內容 · ${packingItems(row).length} 種商品規格</div>${packingItems(row).map(itemHtml).join('')}<p class="muted">相同 SKU 與規格合計數量。組合贈品若未列在平台明細，需先核對內容再包貨。</p></div>
    <div class="actions"><button id="prepare" class="primary" ${!enabled||busy?'disabled':''}>${row.canDownload?'取得／重印正式貨運單':'申請出貨與貨運單'}</button><button id="packing">列印包貨明細</button>${row.documentReady?'<button id="showDocument">預覽正式貨運單</button>':''}</div>
    ${row.blockReason||row.jobError||row.stale?`<div class="block-note">${escapeHtml(row.stale?'此平台資料尚未更新，請重新讀取後再操作。':row.jobError||row.blockReason)}</div>`:''}`;
  $('prepare').addEventListener('click',()=>prepare(row));
  $('packing').addEventListener('click',()=>printPacking(row));
  $('showDocument')?.addEventListener('click',()=>showDocument(row.key));
}
async function refresh() {
  if(busy)return;
  busy=true;$('refresh').disabled=true;renderDetail();notice('正在向 EasyStore、MOMO、酷澎讀取近 30 天訂單…');
  try {
    data=await api('/api/refresh',{days:30});
    const errors=Object.values(data.errors);
    notice(errors.length?errors.join(' '):`已讀取 ${data.orders.length} 個訂單／包裹。選取訂單即可核對包貨內容。`,!!errors.length);
  }catch(e){notice(e.message,true);}
  finally{busy=false;$('refresh').disabled=false;render();}
}
async function prepare(row) {
  reviewed=null;reviewOptions={carrier:row.carrierCode||''};
  $('reviewTitle').textContent=row.canDownload?'取得平台正式貨運單':'申請出貨前核對';
  const options = !row.canDownload && row.platform==='Coupang' ? `<label class="option-row">物流公司<select id="carrier"><option value="">請選擇</option>${Object.entries(carriers).map(([k,v])=>`<option value="${k}" ${k===reviewOptions.carrier?'selected':''}>${v}</option>`).join('')}</select></label><label class="option-row">宅配出貨地址代碼<input id="outbound" inputmode="numeric" placeholder="酷澎已登記的出貨地址代碼"></label><label class="option-row">超商退貨地址代碼<input id="returnCenter" placeholder="酷澎已登記的退貨地址代碼"></label>`:'';
  $('reviewBody').innerHTML=`<div class="review-grid"><strong>${escapeHtml(row.channel)} · ${escapeHtml(row.orderNo)}</strong>${escapeHtml(row.recipient)}<br>${escapeHtml(row.address)}<br>${row.items.map(i=>`${escapeHtml(i.name)} ${escapeHtml(i.variant)} × ${i.quantity}`).join('<br>')}</div>${options}<p id="reviewMessage" class="muted">${row.canDownload?'將重新確認平台目前資料，並取回原單號的正式文件。':'送出會向對應平台申請出貨及運單；請先核對收件人、商品及物流。'}</p>`;
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
        $('submitShipment').textContent=reviewed.action==='download'?'取回正式貨運單':'確認申請出貨';
      }else{
        $('reviewMessage').textContent='正在處理，請勿重複送出…';
        const result=await api('/api/process',{key:row.key,options:reviewOptions,fingerprint:reviewed.fingerprint});
        $('reviewDialog').close();
        data=await api('/api/orders');render();
        notice(result.reused?'已開啟保留的正式貨運單，可重印。':'已取得平台正式貨運單。');
        showDocument(row.key);
      }
    }catch(e){$('reviewMessage').textContent=e.message;notice(e.message,true);reviewed=null;$('submitShipment').textContent='重新核對';}
    finally{$('submitShipment').disabled=false;}
  };
}
function showDocument(key) {
  const url='/api/document?key='+encodeURIComponent(key);
  $('documentFrame').src=url;$('openDocument').href=url;$('downloadDocument').href=url;
  const combined=data.orders.find(r=>r.key===key)?.documentKinds?.includes('combined');
  $('combinedDocument').hidden=!combined;$('combinedDocument').href=url+'&kind=combined';
  $('openDocument').onclick=()=>api('/api/print-event',{key}).catch(()=>{});
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
$('search').addEventListener('input',render);$('stage').addEventListener('change',render);
$('cancelReview').addEventListener('click',()=>$('reviewDialog').close());
api('/api/orders').then(payload=>{data=payload;render();if(!data.updated)refresh();}).catch(e=>notice(e.message,true));
// Poll while this workbench is visible. Reading orders never creates shipments.
setInterval(()=>{if(!document.hidden&&!busy&&!document.querySelector('dialog[open]'))refresh();},300000);
