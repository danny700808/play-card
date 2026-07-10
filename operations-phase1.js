(function(global){
  'use strict';

  const ONLINE_COLLECTIONS = ['easystoreProducts','websiteProducts','officialWebsiteProducts','websiteGoods','products'];
  const COLLECTIONS = {
    products:'opsInternalProducts',
    inventory:'opsInventoryTransactions',
    sales:'opsStoreSales',
    incomes:'opsQuickIncomes',
    purchases:'opsPurchases',
    rentalLedgers:'opsRentalLedgers',
    cases:'opsCases',
    expenses:'opsExpenses',
    syncJobs:'opsSyncJobs',
    audit:'opsAuditLogs',
    imports:'opsInternalProductImports',
    settings:'opsSettings'
  };
  const READ_LIMIT = 1500;
  const BATCH_SIZE = 400;
  const PRODUCT_PAGE_SIZE = 24;
  const VERSION = '2026.07.10-v1';

  const state = {
    user:null,
    db:null,
    view:'overview',
    loading:false,
    loadedAt:null,
    onlineSource:'',
    onlineProducts:[],
    internalProducts:[],
    catalog:[],
    rentals:[],
    rentalLedgers:[],
    sales:[],
    incomes:[],
    purchases:[],
    inventory:[],
    cases:[],
    expenses:[],
    syncJobs:[],
    audit:[],
    diagnostics:[],
    productVisible:PRODUCT_PAGE_SIZE,
    productSearch:'',
    productFilter:'all',
    productSort:'name',
    posSearch:'',
    cart:[],
    financeRange:'month',
    rentalSearch:'',
    caseSearch:'',
    inventorySearch:'',
    importRows:[],
    importFileName:'',
    confirmResolve:null
  };

  const PAGE_META = {
    overview:['營運總覽','把商品、庫存、現場銷售、進貨、租賃與案件集中在同一個畫面。'],
    products:['商品與庫存','用商品圖片快速查詢，管理內部 SKU、成本、現有庫存與安全庫存。'],
    sales:['現場銷售／收入','建立現場商品銷售或不影響庫存的快速收入。'],
    purchases:['進貨與庫存異動','驗收入庫、更新移動平均成本，並保留完整庫存流水。'],
    rentals:['租賃損益','沿用既有 rentalContracts，只在獨立帳冊補收款與直接成本。'],
    cases:['案件管理','記錄案件報價、已收款、成本、應收與案件毛利。'],
    finance:['毛利與收支','彙整現場銷售、快速收入、租賃、案件與一般支出。'],
    sync:['平台訂單／同步','先建立安全的同步預覽與工作紀錄；平台密鑰不放在瀏覽器。'],
    connection:['資料連線與備份','查看 Firebase 資料來源、下載備份、Excel 匯入與操作紀錄。']
  };

  function clean(value){ return String(value == null ? '' : value).trim(); }
  function lower(value){ return clean(value).toLowerCase(); }
  function escapeHtml(value){
    return clean(value).replace(/[&<>"']/g,function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]; });
  }
  function attr(value){ return escapeHtml(value).replace(/`/g,'&#96;'); }
  function getPath(obj,path){
    if(!obj || !path) return undefined;
    if(Object.prototype.hasOwnProperty.call(obj,path)) return obj[path];
    let cursor=obj;
    for(const part of String(path).split('.')){
      if(cursor==null || !Object.prototype.hasOwnProperty.call(cursor,part)) return undefined;
      cursor=cursor[part];
    }
    return cursor;
  }
  function firstValue(obj,keys){
    for(const key of keys){
      const value=getPath(obj,key);
      if(value!==undefined && value!==null && clean(value)!=='') return value;
    }
    return '';
  }
  function numberInfo(value){
    if(value===undefined || value===null || clean(value)==='') return {found:false,value:0};
    const n=Number(String(value).replace(/,/g,'').replace(/[^0-9.\-]/g,''));
    return Number.isFinite(n)?{found:true,value:n}:{found:false,value:0};
  }
  function firstNumber(obj,keys){
    for(const key of keys){ const result=numberInfo(getPath(obj,key)); if(result.found) return result; }
    return {found:false,value:0};
  }
  function boolValue(value,defaultValue){
    if(typeof value==='boolean') return value;
    const text=lower(value);
    if(['1','true','yes','y','是','啟用','上架','active','enabled'].includes(text)) return true;
    if(['0','false','no','n','否','停用','下架','inactive','disabled'].includes(text)) return false;
    return !!defaultValue;
  }
  function safeUrl(value){
    const raw=clean(value); if(!raw) return '';
    try{ const url=new URL(raw,global.location.href); return ['http:','https:'].includes(url.protocol)?url.href:''; }catch(err){ return ''; }
  }
  function imageFrom(value){
    if(!value) return '';
    if(typeof value==='string') return safeUrl(value);
    if(Array.isArray(value)){ for(const item of value){ const found=imageFrom(item); if(found) return found; } return ''; }
    if(typeof value==='object') return safeUrl(firstValue(value,['src','url','imageUrl','original','large','medium','small','secure_url','downloadURL']));
    return '';
  }
  function productImage(obj){
    const direct=[obj.imageUrl,obj.image,obj.picture,obj.cover,obj.featuredImage,obj.featured_image,obj.mainImage,obj.thumbnail,obj.photo,obj['圖片']];
    for(const item of direct){ const found=imageFrom(item); if(found) return found; }
    return imageFrom(obj.images||obj.photos||obj.media||[]);
  }
  function decodeReadable(value){
    let text=clean(value); if(!text) return '';
    for(let i=0;i<2;i+=1){
      try{ const next=decodeURIComponent(text.replace(/\+/g,'%20')); if(next===text) break; text=next; }catch(err){ break; }
    }
    return text.replace(/[\u0000-\u001f]/g,'').trim();
  }
  function normalizeCode(value){ return clean(value).replace(/^'+/,'').replace(/\u00a0/g,' ').trim().toUpperCase(); }
  function hashText(value){
    let hash=2166136261;
    const text=clean(value);
    for(let i=0;i<text.length;i+=1){ hash^=text.charCodeAt(i); hash=Math.imul(hash,16777619); }
    return (hash>>>0).toString(36);
  }
  function dateFrom(value){
    if(!value) return null;
    try{
      if(value && typeof value.toDate==='function') return value.toDate();
      if(value instanceof Date) return Number.isNaN(value.getTime())?null:value;
      if(typeof value==='object' && Number.isFinite(Number(value.seconds))) return new Date(Number(value.seconds)*1000);
      const text=clean(value); if(!text) return null;
      const d=/^\d{4}-\d{2}-\d{2}$/.test(text)?new Date(text+'T00:00:00'):new Date(text);
      return Number.isNaN(d.getTime())?null:d;
    }catch(err){ return null; }
  }
  function dateText(value){
    const d=dateFrom(value); if(!d) return clean(value)||'—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function dateTimeText(value){
    const d=dateFrom(value); if(!d) return clean(value)||'—';
    return dateText(d)+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }
  function inputDateTime(value){
    const d=dateFrom(value)||new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }
  function startOfDay(value){ const d=dateFrom(value)||new Date(); d.setHours(0,0,0,0); return d; }
  function endOfDay(value){ const d=dateFrom(value)||new Date(); d.setHours(23,59,59,999); return d; }
  function daysUntil(value){ const d=startOfDay(value); return Math.ceil((d.getTime()-startOfDay(new Date()).getTime())/86400000); }
  function money(value){ const n=Number(value); return Number.isFinite(n)?'NT$ '+Math.round(n).toLocaleString('zh-TW'):'—'; }
  function compactMoney(value){ const n=Number(value); return Number.isFinite(n)?'$'+Math.round(n).toLocaleString('zh-TW'):'—'; }
  function formatNumber(value){ const n=Number(value); return Number.isFinite(n)?n.toLocaleString('zh-TW',{maximumFractionDigits:2}):'—'; }
  function percentage(value){ const n=Number(value); return Number.isFinite(n)?(Math.round(n*10)/10).toFixed(1).replace('.0','')+'%':'—'; }
  function sum(rows,fn){ return rows.reduce(function(total,row){ const n=Number(fn(row)); return total+(Number.isFinite(n)?n:0); },0); }
  function uid(prefix){ return prefix+'-'+new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)+'-'+Math.random().toString(36).slice(2,7).toUpperCase(); }
  function userLabel(){ return clean(state.user && (state.user.id||state.user.employeeId||state.user.email||state.user.name||state.user.displayName)) || '管理者'; }
  function fieldValue(){ return global.firebase && firebase.firestore && firebase.firestore.FieldValue ? firebase.firestore.FieldValue : null; }
  function serverTimestamp(){ const fv=fieldValue(); return fv?fv.serverTimestamp():new Date().toISOString(); }
  function setText(id,value){ const el=document.getElementById(id); if(el) el.textContent=value; }
  function html(id,value){ const el=document.getElementById(id); if(el) el.innerHTML=value; }
  function byId(id){ return document.getElementById(id); }
  function query(selector,root){ return (root||document).querySelector(selector); }
  function queryAll(selector,root){ return Array.from((root||document).querySelectorAll(selector)); }
  function hasValue(value){ return value!==undefined && value!==null && clean(value)!==''; }
  function numberOrNull(value){ const info=numberInfo(value); return info.found?info.value:null; }
  function statusTag(text,type){ return '<span class="ops-tag '+(type||'')+'">'+escapeHtml(text)+'</span>'; }
  function errorMessage(error){ return clean(error && (error.message||error.code||error)) || '未知錯誤'; }

  function toast(title,message,type){
    const stack=byId('opsToastStack'); if(!stack) return;
    const el=document.createElement('div'); el.className='ops-toast '+(type||'');
    el.innerHTML='<b>'+escapeHtml(title)+'</b><span>'+escapeHtml(message||'')+'</span>';
    stack.appendChild(el);
    setTimeout(function(){ el.remove(); },4200);
  }
  function showAlert(message,type){
    const el=byId('opsGlobalAlert'); if(!el) return;
    el.className='ops-alert '+(type||''); el.textContent=message; el.classList.remove('hidden');
  }
  function clearAlert(){ const el=byId('opsGlobalAlert'); if(el) el.classList.add('hidden'); }
  function loadingHtml(text){ return '<div class="ops-loading"><div class="ops-spinner"></div>'+escapeHtml(text||'資料讀取中…')+'</div>'; }
  function emptyHtml(title,text,button){
    return '<div class="ops-empty"><strong>'+escapeHtml(title)+'</strong><p>'+escapeHtml(text||'')+'</p>'+(button||'')+'</div>';
  }

  function confirmAction(title,message,okText){
    return new Promise(function(resolve){
      state.confirmResolve=resolve;
      setText('opsConfirmTitle',title||'確認操作');
      setText('opsConfirmMessage',message||'是否確認執行？');
      setText('opsConfirmOk',okText||'確認');
      byId('opsConfirmModal').classList.add('open');
    });
  }
  function closeConfirm(result){
    const modal=byId('opsConfirmModal'); if(modal) modal.classList.remove('open');
    const resolver=state.confirmResolve; state.confirmResolve=null; if(resolver) resolver(!!result);
  }
  function openDrawer(title,subtitle,body){
    setText('opsDrawerTitle',title||'資料編輯'); setText('opsDrawerSubtitle',subtitle||''); html('opsDrawerBody',body||'');
    byId('opsDrawer').classList.add('open'); byId('opsDrawerBackdrop').classList.add('open');
  }
  function closeDrawer(){ byId('opsDrawer').classList.remove('open'); byId('opsDrawerBackdrop').classList.remove('open'); }

  function normalizeOnlineBase(obj,collection,docId){
    const price=firstNumber(obj,['price','marketPrice','salePrice','websiteOriginalPrice','regularPrice','variantPrice','官網價格','價格']);
    const stock=firstNumber(obj,['availableQuantity','availableStock','inventoryQuantity','stockQuantity','quantity','stock','inventory','庫存','庫存數量']);
    let name=decodeReadable(firstValue(obj,['name','title','itemName','productName','商品名稱']))||'未命名商品';
    const sku=normalizeCode(firstValue(obj,['sku','SKU','productCode','itemCode','internalCode','商品編號']));
    const sourceId=clean(firstValue(obj,['productId','websiteProductId','itemId','id','__id']))||docId;
    return {
      id:sourceId,
      docId:docId,
      sourceKey:collection+'::'+docId,
      sourceCollection:collection,
      sourceProductId:sourceId,
      onlineName:name,
      sku:sku,
      onlinePrice:price.found?price.value:null,
      onlineStock:stock.found?stock.value:null,
      imageUrl:productImage(obj),
      url:safeUrl(firstValue(obj,['url','productUrl','websiteProductUrl','permalink','link','連結'])),
      brand:clean(firstValue(obj,['brand','vendor','manufacturer','品牌'])),
      category:clean(firstValue(obj,['category','productType','type','分類'])),
      variantName:clean(firstValue(obj,['variantSummary','optionsText','variantName','specification','規格'])),
      raw:obj
    };
  }
  function normalizeOnlineDoc(obj,collection,docId){
    const base=normalizeOnlineBase(obj,collection,docId);
    const variants=Array.isArray(obj.variants)?obj.variants:(Array.isArray(obj.options)?obj.options:[]);
    if(!variants.length) return [base];
    return variants.map(function(variant,index){
      const combined=Object.assign({},obj,variant||{});
      const row=normalizeOnlineBase(combined,collection,docId+'::'+index);
      row.sourceKey=collection+'::'+docId+'::'+clean(firstValue(variant||{},['id','variantId','sku','name','title'])||index);
      row.sourceProductId=base.sourceProductId;
      row.onlineName=base.onlineName;
      row.sku=row.sku||base.sku;
      row.onlinePrice=row.onlinePrice==null?base.onlinePrice:row.onlinePrice;
      row.onlineStock=row.onlineStock==null?base.onlineStock:row.onlineStock;
      row.imageUrl=row.imageUrl||base.imageUrl;
      row.url=row.url||base.url;
      row.brand=row.brand||base.brand;
      row.category=row.category||base.category;
      row.variantName=clean(firstValue(variant||{},['name','title','optionName','variantName','sku']))||base.variantName;
      return row;
    });
  }
  function normalizeInternal(obj,docId){
    return {
      docId:docId,
      sourceKey:clean(obj.sourceKey),
      sourceCollection:clean(obj.sourceCollection),
      sourceProductId:clean(obj.sourceProductId),
      internalSku:normalizeCode(firstValue(obj,['internalSku','sku','code','productCode','商品編號'])),
      barcode:clean(firstValue(obj,['barcode','ean','條碼'])),
      internalName:clean(firstValue(obj,['internalName','name','商品名稱'])),
      onlineName:clean(obj.onlineName),
      imageUrl:safeUrl(obj.imageUrl),
      onlineUrl:safeUrl(obj.onlineUrl),
      brand:clean(obj.brand),
      category:clean(obj.category),
      variantName:clean(obj.variantName),
      onlinePrice:numberOrNull(obj.onlinePrice),
      storePrice:numberOrNull(firstValue(obj,['storePrice','salePrice','retailPrice'])),
      latestPurchaseCost:numberOrNull(firstValue(obj,['latestPurchaseCost','purchaseCost','purchasePrice'])),
      averageCost:numberOrNull(firstValue(obj,['averageCost','avgCost','movingAverageCost'])),
      currentStock:numberOrNull(firstValue(obj,['currentStock','onHand','stock']))||0,
      reservedStock:numberOrNull(firstValue(obj,['reservedStock','reserved']))||0,
      safetyStock:numberOrNull(firstValue(obj,['safetyStock','minStock']))||0,
      status:clean(obj.status)||'active',
      note:clean(firstValue(obj,['note','remark','備註'])),
      enabled:obj.enabled!==false,
      autoCreated:obj.autoCreated===true,
      createdAt:obj.createdAt||'',
      updatedAt:obj.updatedAt||''
    };
  }
  function internalDocIdForOnline(row){ return 'src_'+hashText(row.sourceKey)+'_'+clean(row.docId).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,30); }
  function mergeCatalog(){
    const bySource=new Map(); const bySku=new Map();
    state.internalProducts.forEach(function(item){ if(item.sourceKey) bySource.set(item.sourceKey,item); if(item.internalSku) bySku.set(item.internalSku,item); });
    const used=new Set(); const merged=[];
    state.onlineProducts.forEach(function(online){
      const internal=bySource.get(online.sourceKey)||(online.sku?bySku.get(online.sku):null)||null;
      if(internal) used.add(internal.docId);
      merged.push(Object.assign({online:online,internal:internal,docId:internal?internal.docId:internalDocIdForOnline(online)},buildCatalogValues(online,internal)));
    });
    state.internalProducts.forEach(function(internal){
      if(used.has(internal.docId)) return;
      merged.push(Object.assign({online:null,internal:internal,docId:internal.docId},buildCatalogValues(null,internal)));
    });
    state.catalog=merged;
  }
  function buildCatalogValues(online,internal){
    const name=(internal&&internal.internalName)||(online&&online.onlineName)||(internal&&internal.onlineName)||'未命名商品';
    const sku=(internal&&internal.internalSku)||(online&&online.sku)||'';
    const image=(internal&&internal.imageUrl)||(online&&online.imageUrl)||'';
    const onlinePrice=internal&&internal.onlinePrice!=null?internal.onlinePrice:(online&&online.onlinePrice!=null?online.onlinePrice:null);
    const storePrice=internal&&internal.storePrice!=null?internal.storePrice:onlinePrice;
    const avg=internal&&internal.averageCost!=null?internal.averageCost:(internal&&internal.latestPurchaseCost!=null?internal.latestPurchaseCost:null);
    const current=internal?Number(internal.currentStock||0):0;
    const reserved=internal?Number(internal.reservedStock||0):0;
    const safety=internal?Number(internal.safetyStock||0):0;
    const available=Math.max(0,current-reserved-safety);
    const margin=(storePrice!=null&&avg!=null&&storePrice!==0)?((storePrice-avg)/storePrice*100):null;
    return {name:name,sku:sku,imageUrl:image,onlinePrice:onlinePrice,storePrice:storePrice,averageCost:avg,latestPurchaseCost:internal?internal.latestPurchaseCost:null,currentStock:current,reservedStock:reserved,safetyStock:safety,availableStock:available,margin:margin,status:internal?internal.status:'uninitialized',initialized:!!internal,sourceCollection:(online&&online.sourceCollection)||(internal&&internal.sourceCollection)||'',onlineUrl:(online&&online.url)||(internal&&internal.onlineUrl)||'',brand:(internal&&internal.brand)||(online&&online.brand)||'',category:(internal&&internal.category)||(online&&online.category)||'',variantName:(internal&&internal.variantName)||(online&&online.variantName)||''};
  }

  async function getCollection(name,limit){
    const started=Date.now();
    try{
      const snap=await state.db.collection(name).limit(limit||READ_LIMIT).get();
      state.diagnostics.push({collection:name,ok:true,count:snap.size,ms:Date.now()-started});
      return snap.docs.map(function(doc){ return Object.assign({__id:doc.id},doc.data()||{}); });
    }catch(error){
      state.diagnostics.push({collection:name,ok:false,count:0,ms:Date.now()-started,error:errorMessage(error)});
      return [];
    }
  }
  async function loadOnlineProducts(){
    for(const collection of ONLINE_COLLECTIONS){
      const rows=await getCollection(collection,6000);
      if(rows.length){
        state.onlineSource=collection;
        state.onlineProducts=[];
        rows.forEach(function(row){ state.onlineProducts.push.apply(state.onlineProducts,normalizeOnlineDoc(row,collection,row.__id)); });
        return;
      }
    }
    state.onlineSource=''; state.onlineProducts=[];
  }
  async function loadAll(silent){
    if(state.loading) return;
    state.loading=true; clearAlert();
    if(!silent) html('opsContent',loadingHtml('正在整理商品、庫存、銷售、租賃與案件資料…'));
    state.diagnostics=[];
    try{
      await loadOnlineProducts();
      const results=await Promise.all([
        getCollection(COLLECTIONS.products,5000),
        getCollection('rentalContracts',1000),
        getCollection(COLLECTIONS.rentalLedgers,1000),
        getCollection(COLLECTIONS.sales,1200),
        getCollection(COLLECTIONS.incomes,1200),
        getCollection(COLLECTIONS.purchases,1200),
        getCollection(COLLECTIONS.inventory,2000),
        getCollection(COLLECTIONS.cases,1000),
        getCollection(COLLECTIONS.expenses,1200),
        getCollection(COLLECTIONS.syncJobs,500),
        getCollection(COLLECTIONS.audit,500)
      ]);
      state.internalProducts=results[0].map(function(row){ return normalizeInternal(row,row.__id); });
      state.rentals=results[1].map(normalizeRental);
      state.rentalLedgers=results[2].map(normalizeRentalLedger);
      state.sales=results[3].map(normalizeSale);
      state.incomes=results[4].map(normalizeIncome);
      state.purchases=results[5].map(normalizePurchase);
      state.inventory=results[6].map(normalizeInventory);
      state.cases=results[7].map(normalizeCase);
      state.expenses=results[8].map(normalizeExpense);
      state.syncJobs=results[9].map(normalizeSyncJob);
      state.audit=results[10].map(normalizeAudit);
      mergeCatalog();
      state.loadedAt=new Date();
      setText('opsLastReadText','最後讀取：'+dateTimeText(state.loadedAt));
      render();
    }catch(error){
      showAlert('資料讀取失敗：'+errorMessage(error),'error');
      html('opsContent',emptyHtml('無法載入營運資料','請確認網路、Firebase設定與Firestore規則後重新讀取。','<button class="ops-button primary" data-action="refresh">重新讀取</button>'));
    }finally{ state.loading=false; }
  }

  function normalizeRental(obj){
    const start=firstValue(obj,['startDate','rentalStartDate','contractStartDate','開始日期']);
    const end=firstValue(obj,['endDate','rentalEndDate','contractEndDate','到期日期']);
    return {
      id:clean(obj.__id),
      contractNo:clean(firstValue(obj,['contractNo','contractId','rentalContractNo','編號']))||clean(obj.__id),
      customer:clean(firstValue(obj,['customerName','name','applicantName','承租人','客戶']))||'未提供',
      phone:clean(firstValue(obj,['phone','customerPhone','mobile','電話'])),
      equipment:clean(firstValue(obj,['equipmentName','instrumentName','productName','deviceName','equipmentType','設備']))||'未提供',
      brand:clean(firstValue(obj,['brand','equipmentBrand','品牌'])),
      model:clean(firstValue(obj,['model','equipmentModel','型號'])),
      assetNo:clean(firstValue(obj,['equipmentNo','assetNo','serialNo','設備編號'])),
      startDate:start,
      endDate:end,
      rentFee:firstNumber(obj,['rentFee','rentalFee','monthlyRent','租金']).value,
      shippingFee:firstNumber(obj,['shippingFee','deliveryFee','運費']).value,
      depositFee:firstNumber(obj,['depositFee','deposit','押金']).value,
      status:clean(firstValue(obj,['status','contractStatus','rentalStatus','狀態']))||'未設定',
      raw:obj
    };
  }
  function normalizeRentalLedger(obj){
    return {id:clean(obj.__id),rentalContractId:clean(firstValue(obj,['rentalContractId','contractId']))||clean(obj.__id),receivedAmount:firstNumber(obj,['receivedAmount']).value,deliveryCost:firstNumber(obj,['deliveryCost']).value,maintenanceCost:firstNumber(obj,['maintenanceCost']).value,otherCost:firstNumber(obj,['otherCost']).value,note:clean(obj.note),updatedAt:obj.updatedAt||''};
  }
  function normalizeSale(obj){
    return {id:clean(obj.__id),saleNo:clean(obj.saleNo)||clean(obj.__id),soldAt:obj.soldAt||obj.createdAt||'',items:Array.isArray(obj.items)?obj.items:[],subtotal:firstNumber(obj,['subtotal']).value,discount:firstNumber(obj,['discount']).value,total:firstNumber(obj,['total']).value,costTotal:firstNumber(obj,['costTotal']).value,grossProfit:firstNumber(obj,['grossProfit']).value,paymentMethod:clean(obj.paymentMethod),customerName:clean(obj.customerName),note:clean(obj.note),status:clean(obj.status)||'completed',createdAt:obj.createdAt||''};
  }
  function normalizeIncome(obj){
    return {id:clean(obj.__id),incomeNo:clean(obj.incomeNo)||clean(obj.__id),occurredAt:obj.occurredAt||obj.createdAt||'',category:clean(obj.category)||'其他收入',amount:firstNumber(obj,['amount']).value,paymentMethod:clean(obj.paymentMethod),customerName:clean(obj.customerName),note:clean(obj.note),createdAt:obj.createdAt||''};
  }
  function normalizePurchase(obj){
    return {id:clean(obj.__id),purchaseNo:clean(obj.purchaseNo)||clean(obj.__id),receivedAt:obj.receivedAt||obj.createdAt||'',supplier:clean(obj.supplier),items:Array.isArray(obj.items)?obj.items:[],subtotal:firstNumber(obj,['subtotal']).value,extraCost:firstNumber(obj,['extraCost']).value,totalCost:firstNumber(obj,['totalCost']).value,note:clean(obj.note),createdAt:obj.createdAt||''};
  }
  function normalizeInventory(obj){
    return {id:clean(obj.__id),type:clean(obj.type),productId:clean(obj.productId),productName:clean(obj.productName),sku:clean(obj.sku),qtyChange:firstNumber(obj,['qtyChange']).value,beforeStock:firstNumber(obj,['beforeStock']).value,afterStock:firstNumber(obj,['afterStock']).value,unitCost:numberOrNull(obj.unitCost),referenceType:clean(obj.referenceType),referenceId:clean(obj.referenceId),note:clean(obj.note),occurredAt:obj.occurredAt||obj.createdAt||'',createdAt:obj.createdAt||''};
  }
  function normalizeCase(obj){
    const quoted=firstNumber(obj,['quotedAmount']).value; const received=firstNumber(obj,['receivedAmount']).value;
    const material=firstNumber(obj,['materialCost']).value; const labor=firstNumber(obj,['laborCost']).value; const transport=firstNumber(obj,['transportCost']).value; const other=firstNumber(obj,['otherCost']).value;
    return {id:clean(obj.__id),caseNo:clean(obj.caseNo)||clean(obj.__id),name:clean(obj.name)||'未命名案件',customer:clean(obj.customer),status:clean(obj.status)||'planning',quotedAmount:quoted,receivedAmount:received,materialCost:material,laborCost:labor,transportCost:transport,otherCost:other,totalCost:material+labor+transport+other,profit:received-(material+labor+transport+other),outstanding:Math.max(0,quoted-received),startDate:obj.startDate||'',dueDate:obj.dueDate||'',note:clean(obj.note),createdAt:obj.createdAt||'',updatedAt:obj.updatedAt||''};
  }
  function normalizeExpense(obj){ return {id:clean(obj.__id),expenseNo:clean(obj.expenseNo)||clean(obj.__id),occurredAt:obj.occurredAt||obj.createdAt||'',category:clean(obj.category)||'其他支出',amount:firstNumber(obj,['amount']).value,paymentMethod:clean(obj.paymentMethod),referenceType:clean(obj.referenceType),referenceId:clean(obj.referenceId),note:clean(obj.note),createdAt:obj.createdAt||''}; }
  function normalizeSyncJob(obj){ return {id:clean(obj.__id),jobNo:clean(obj.jobNo)||clean(obj.__id),type:clean(obj.type),status:clean(obj.status)||'preview',platforms:Array.isArray(obj.platforms)?obj.platforms:[],productCount:firstNumber(obj,['productCount']).value,createdAt:obj.createdAt||'',createdBy:clean(obj.createdBy),note:clean(obj.note)}; }
  function normalizeAudit(obj){ return {id:clean(obj.__id),action:clean(obj.action),entityType:clean(obj.entityType),entityId:clean(obj.entityId),summary:clean(obj.summary),createdAt:obj.createdAt||'',createdBy:clean(obj.createdBy)}; }

  async function writeAudit(action,entityType,entityId,summary){
    try{ await state.db.collection(COLLECTIONS.audit).add({action:action,entityType:entityType,entityId:entityId||'',summary:summary||'',createdBy:userLabel(),createdAt:serverTimestamp(),version:VERSION}); }catch(err){}
  }

  function kpi(title,value,sub,icon){
    return '<article class="ops-kpi"><div class="ops-kpi-head"><span>'+escapeHtml(title)+'</span><span class="ops-kpi-icon">'+escapeHtml(icon||'•')+'</span></div><strong>'+escapeHtml(value)+'</strong><small>'+escapeHtml(sub||'')+'</small></article>';
  }
  function render(){
    state.view=(location.hash||'#overview').replace('#','').split('?')[0]||'overview';
    if(!PAGE_META[state.view]) state.view='overview';
    const meta=PAGE_META[state.view]; setText('opsPageTitle',meta[0]); setText('opsPageSubtitle',meta[1]);
    queryAll('#opsNav a[data-view]').forEach(function(a){ a.classList.toggle('active',a.dataset.view===state.view); });
    const content=byId('opsContent'); if(!content) return;
    if(state.loading && !state.loadedAt){ content.innerHTML=loadingHtml(); return; }
    const renderers={overview:renderOverview,products:renderProducts,sales:renderSales,purchases:renderPurchases,rentals:renderRentals,cases:renderCases,finance:renderFinance,sync:renderSync,connection:renderConnection};
    content.innerHTML=(renderers[state.view]||renderOverview)();
    bindViewSpecific();
  }

  function todayRows(rows,getDate){ const start=startOfDay(new Date()); const end=endOfDay(new Date()); return rows.filter(function(row){ const d=dateFrom(getDate(row)); return d&&d>=start&&d<=end; }); }
  function currentMonthRows(rows,getDate){ const now=new Date(); return rows.filter(function(row){ const d=dateFrom(getDate(row)); return d&&d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth(); }); }
  function recentActivity(){
    const rows=[];
    state.sales.forEach(function(x){ rows.push({date:x.soldAt,type:'現場銷售',icon:'＄',title:x.saleNo,sub:money(x.total)}); });
    state.incomes.forEach(function(x){ rows.push({date:x.occurredAt,type:'快速收入',icon:'＋',title:x.category,sub:money(x.amount)}); });
    state.purchases.forEach(function(x){ rows.push({date:x.receivedAt,type:'進貨入庫',icon:'⇧',title:x.purchaseNo,sub:money(x.totalCost)}); });
    state.cases.forEach(function(x){ rows.push({date:x.updatedAt||x.createdAt,type:'案件',icon:'▣',title:x.name,sub:'已收 '+money(x.receivedAmount)}); });
    return rows.sort(function(a,b){ return (dateFrom(b.date)||0)-(dateFrom(a.date)||0); }).slice(0,8);
  }
  function renderOverview(){
    const todaySales=todayRows(state.sales,function(x){return x.soldAt;});
    const todayIncome=todayRows(state.incomes,function(x){return x.occurredAt;});
    const monthSales=currentMonthRows(state.sales,function(x){return x.soldAt;});
    const monthIncome=currentMonthRows(state.incomes,function(x){return x.occurredAt;});
    const todayRevenue=sum(todaySales,function(x){return x.total;})+sum(todayIncome,function(x){return x.amount;});
    const todayProfit=sum(todaySales,function(x){return x.grossProfit;})+sum(todayIncome,function(x){return x.amount;});
    const monthRevenue=sum(monthSales,function(x){return x.total;})+sum(monthIncome,function(x){return x.amount;});
    const low=state.catalog.filter(function(p){ return p.initialized && p.currentStock<=p.safetyStock; });
    const uninitialized=state.catalog.filter(function(p){return !p.initialized;}).length;
    const due=state.rentals.filter(function(r){ const d=daysUntil(r.endDate); return d!==null&&d>=0&&d<=30; });
    const activeRentals=state.rentals.filter(function(r){ return !/退租|終止|取消|完成/i.test(r.status); });
    const caseOutstanding=sum(state.cases,function(c){return c.outstanding;});
    const invValue=sum(state.catalog,function(p){return (p.averageCost||0)*(p.currentStock||0);});
    const activities=recentActivity();
    const days=[]; const now=new Date();
    for(let i=6;i>=0;i-=1){ const d=new Date(now); d.setDate(now.getDate()-i); d.setHours(0,0,0,0); const end=endOfDay(d); const sales=state.sales.filter(function(x){const dt=dateFrom(x.soldAt);return dt&&dt>=d&&dt<=end;}); const inc=state.incomes.filter(function(x){const dt=dateFrom(x.occurredAt);return dt&&dt>=d&&dt<=end;}); days.push({label:(d.getMonth()+1)+'/'+d.getDate(),value:sum(sales,function(x){return x.total;})+sum(inc,function(x){return x.amount;})}); }
    const max=Math.max.apply(null,days.map(function(x){return x.value;}))||1;
    const bars=days.map(function(x){return '<div class="ops-chart-bar"><b>'+compactMoney(x.value)+'</b><i style="height:'+Math.max(2,Math.round(x.value/max*115))+'px"></i><span>'+x.label+'</span></div>';}).join('');
    const activityHtml=activities.length?activities.map(function(x){return '<div class="ops-activity"><div class="ops-activity-icon">'+x.icon+'</div><div><b>'+escapeHtml(x.type)+'｜'+escapeHtml(x.title)+'</b><small>'+escapeHtml(x.sub)+'・'+escapeHtml(dateTimeText(x.date))+'</small></div></div>';}).join(''):emptyHtml('尚無營運紀錄','完成現場銷售、快速收入或進貨後會顯示在這裡。');
    return '<div class="ops-banner"><div class="icon">i</div><div><h3>完整第一版已整合核心內部營運</h3><p>商品主檔、庫存流水、現場銷售、進貨、租賃損益、案件與收支都寫入獨立 ops 集合；平台正式 API 同步仍維持安全預覽模式。</p></div></div>'+
      '<div class="ops-kpi-grid">'+
        kpi('今日收入',money(todayRevenue),'現場銷售＋快速收入','＄')+
        kpi('今日暫估毛利',money(todayProfit),'尚未扣除一般支出','↗')+
        kpi('本月收入',money(monthRevenue),'現場與快速收入','月')+
        kpi('低庫存商品',String(low.length),'庫存 ≤ 安全庫存','!')+
        kpi('進行中租賃',String(activeRentals.length),'30日內到期 '+due.length+' 件','♫')+
        kpi('案件待收款',money(caseOutstanding),'全部未結案件','▣')+
      '</div>'+
      '<div class="ops-grid-2">'+
        '<section class="ops-card"><div class="ops-card-head"><div><h2>最近 7 日現場收入</h2><p>只統計已在營運中心登錄的現場銷售與快速收入。</p></div><div class="ops-card-actions"><button class="ops-button small soft" data-nav="sales">新增銷售</button></div></div><div class="ops-chart-bars">'+bars+'</div></section>'+
        '<section class="ops-card"><div class="ops-card-head"><div><h2>今日待處理</h2><p>優先處理資料缺口與營運風險。</p></div></div><div class="ops-summary-list">'+
          '<div class="ops-summary-line"><span>尚未建立內部主檔</span><b>'+uninitialized+' 項</b></div>'+
          '<div class="ops-summary-line"><span>低庫存或缺貨</span><b>'+low.length+' 項</b></div>'+
          '<div class="ops-summary-line"><span>30 日內租賃到期</span><b>'+due.length+' 件</b></div>'+
          '<div class="ops-summary-line"><span>進行中案件待收</span><b>'+money(caseOutstanding)+'</b></div>'+
          '<div class="ops-summary-line total"><span>目前庫存帳面價值</span><b>'+money(invValue)+'</b></div>'+
        '</div></section>'+
      '</div><div class="ops-grid-equal" style="margin-top:15px">'+
        '<section class="ops-card"><div class="ops-card-head"><div><h2>商品資料完整度</h2><p>以 '+escapeHtml(state.onlineSource||'尚無來源')+' 與內部主檔合併計算。</p></div><button class="ops-button small ghost" data-nav="products">查看商品</button></div>'+productCompletenessHtml()+'</section>'+
        '<section class="ops-card"><div class="ops-card-head"><div><h2>最近活動</h2><p>跨銷售、收入、進貨與案件的最新紀錄。</p></div></div>'+activityHtml+'</section>'+
      '</div>';
  }
  function productCompletenessHtml(){
    const total=state.catalog.length||1;
    const sku=state.catalog.filter(function(p){return !!p.sku;}).length;
    const cost=state.catalog.filter(function(p){return p.averageCost!=null;}).length;
    const stock=state.catalog.filter(function(p){return p.initialized;}).length;
    const image=state.catalog.filter(function(p){return !!p.imageUrl;}).length;
    function row(label,count){return '<div class="ops-status-row"><div><b>'+escapeHtml(label)+'</b><small>'+count+' / '+state.catalog.length+'</small></div><div style="width:43%"><div class="ops-progress"><span style="width:'+Math.round(count/total*100)+'%"></span></div></div></div>';}
    return row('有商品圖片',image)+row('有 SKU',sku)+row('已建立成本',cost)+row('已建立庫存主檔',stock);
  }

  function productFiltered(){
    const term=lower(state.productSearch);
    let rows=state.catalog.filter(function(p){
      if(term && !lower([p.name,p.sku,p.brand,p.category,p.variantName,p.docId].join(' ')).includes(term)) return false;
      if(state.productFilter==='uninitialized' && p.initialized) return false;
      if(state.productFilter==='missing-sku' && p.sku) return false;
      if(state.productFilter==='missing-cost' && p.averageCost!=null) return false;
      if(state.productFilter==='low' && !(p.initialized&&p.currentStock<=p.safetyStock)) return false;
      if(state.productFilter==='in-stock' && p.currentStock<=0) return false;
      return true;
    });
    rows.sort(function(a,b){
      if(state.productSort==='stock') return b.currentStock-a.currentStock;
      if(state.productSort==='cost') return (b.averageCost||0)-(a.averageCost||0);
      if(state.productSort==='price') return (b.storePrice||0)-(a.storePrice||0);
      return a.name.localeCompare(b.name,'zh-Hant');
    });
    return rows;
  }
  function productCard(p){
    const stockClass=!p.initialized?'':(p.currentStock<=0?'out':(p.currentStock<=p.safetyStock?'low':''));
    const stockLabel=p.initialized?('庫存 '+formatNumber(p.currentStock)):'未建主檔';
    return '<article class="ops-product-card">'+
      '<div class="ops-product-image">'+(p.imageUrl?'<img loading="lazy" src="'+attr(p.imageUrl)+'" alt="'+attr(p.name)+'" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\'"><div class="placeholder" style="display:none">尚無圖片</div>':'<div class="placeholder">尚無圖片</div>')+'<span class="ops-source-badge">'+escapeHtml(p.sourceCollection||'內部')+'</span><span class="ops-stock-badge '+stockClass+'">'+escapeHtml(stockLabel)+'</span></div>'+
      '<div class="ops-product-body"><div class="ops-product-name">'+escapeHtml(p.name)+'</div><div class="ops-product-meta">SKU：'+escapeHtml(p.sku||'尚未設定')+(p.variantName?'・'+escapeHtml(p.variantName):'')+'</div>'+
      '<div class="ops-product-values"><div class="ops-value-box"><span>售價</span><b>'+money(p.storePrice)+'</b></div><div class="ops-value-box"><span>平均成本</span><b>'+money(p.averageCost)+'</b></div><div class="ops-value-box"><span>可銷售</span><b>'+formatNumber(p.availableStock)+'</b></div><div class="ops-value-box"><span>毛利率</span><b>'+percentage(p.margin)+'</b></div></div>'+
      '<div class="ops-product-actions"><button class="ops-button small ghost" data-action="product-detail" data-id="'+attr(p.docId)+'">詳細資料</button><button class="ops-button small primary" data-action="product-edit" data-id="'+attr(p.docId)+'">'+(p.initialized?'編輯主檔':'建立主檔')+'</button></div></div></article>';
  }
  function renderProducts(){
    const rows=productFiltered(); const visible=rows.slice(0,state.productVisible);
    const initialized=state.catalog.filter(function(p){return p.initialized;}).length;
    const missing=state.catalog.length-initialized;
    const low=state.catalog.filter(function(p){return p.initialized&&p.currentStock<=p.safetyStock;}).length;
    return '<div class="ops-banner"><div class="icon">▦</div><div><h3>圖片來自 '+escapeHtml(state.onlineSource||'網路商品來源')+'，內部欄位獨立保存</h3><p>修改 SKU、成本、庫存不會覆蓋 EasyStore／官網的商品名稱、圖片或售價。第一次可直接一鍵建立全部主檔。</p></div></div>'+
      '<div class="ops-kpi-grid">'+kpi('商品／規格',String(state.catalog.length),'合併網路與內部資料','▦')+kpi('已建立主檔',String(initialized),'可管理成本與庫存','✓')+kpi('尚未建立',String(missing),'可一鍵批次建立','＋')+kpi('低庫存',String(low),'庫存不高於安全庫存','!')+kpi('庫存總件數',formatNumber(sum(state.catalog,function(p){return p.currentStock;})),'已建立內部主檔','庫')+kpi('庫存價值',money(sum(state.catalog,function(p){return (p.averageCost||0)*p.currentStock;})),'平均成本 × 現有庫存','＄')+'</div>'+
      '<section class="ops-card"><div class="ops-card-head"><div><h2>商品與庫存</h2><p>顯示 '+visible.length+' / '+rows.length+' 筆；來源 '+escapeHtml(state.onlineSource||'尚未找到')+'。</p></div><div class="ops-card-actions"><button class="ops-button soft" data-action="download-product-template">下載 Excel/CSV 範本</button><button class="ops-button primary" data-action="auto-init-products" '+(missing?'':'disabled')+'>一鍵建立 '+missing+' 筆主檔</button></div></div>'+
      '<div class="ops-toolbar"><input class="ops-input grow" id="productSearch" placeholder="搜尋商品名稱、SKU、品牌、分類" value="'+attr(state.productSearch)+'"><select class="ops-select" id="productFilter"><option value="all">全部商品</option><option value="uninitialized">尚未建立主檔</option><option value="missing-sku">尚未設定 SKU</option><option value="missing-cost">尚未設定成本</option><option value="low">低庫存／缺貨</option><option value="in-stock">有庫存</option></select><select class="ops-select" id="productSort"><option value="name">依商品名稱</option><option value="stock">依庫存</option><option value="cost">依成本</option><option value="price">依售價</option></select><button class="ops-button ghost" data-action="open-import">Excel 匯入</button></div>'+
      (visible.length?'<div class="ops-products-grid">'+visible.map(productCard).join('')+'</div>'+(visible.length<rows.length?'<div class="ops-pagination"><button class="ops-button ghost" data-action="load-more-products">顯示更多</button></div>':''):emptyHtml('找不到符合條件的商品','請調整搜尋字或篩選條件。'))+'</section>';
  }

  function renderSales(){
    const products=state.catalog.filter(function(p){return p.initialized&&p.status!=='inactive';});
    const term=lower(state.posSearch); const choices=products.filter(function(p){return !term||lower([p.name,p.sku].join(' ')).includes(term);}).slice(0,100);
    const cartSubtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;});
    const cartCost=sum(state.cart,function(x){return x.qty*(x.averageCost||0);});
    const todaySales=todayRows(state.sales,function(x){return x.soldAt;}); const todayIncome=todayRows(state.incomes,function(x){return x.occurredAt;});
    const productHtml=choices.length?choices.map(function(p){return '<button class="ops-pos-item" data-action="cart-add" data-id="'+attr(p.docId)+'"><img src="'+attr(p.imageUrl||'yuzu-logo-green.png')+'" alt=""><div><b>'+escapeHtml(p.name)+'</b><small>SKU '+escapeHtml(p.sku||'未設定')+'・庫存 '+formatNumber(p.currentStock)+'・'+money(p.storePrice)+'</small></div></button>';}).join(''):emptyHtml('沒有可銷售商品','請先建立商品主檔與售價。');
    const cartHtml=state.cart.length?state.cart.map(function(item,index){return '<div class="ops-cart-row"><div><b>'+escapeHtml(item.name)+'</b><small>庫存 '+formatNumber(item.currentStock)+'・成本 '+money(item.averageCost)+'</small></div><input type="number" min="1" step="1" value="'+item.qty+'" data-cart-qty="'+index+'"><input type="number" min="0" step="1" value="'+item.unitPrice+'" data-cart-price="'+index+'"><button class="ops-icon-button" data-action="cart-remove" data-index="'+index+'">×</button></div>';}).join(''):emptyHtml('銷售清單是空的','點左側商品加入本次現場銷售。');
    return '<div class="ops-kpi-grid">'+kpi('今日現場銷售',money(sum(todaySales,function(x){return x.total;})),todaySales.length+' 筆','＄')+kpi('今日快速收入',money(sum(todayIncome,function(x){return x.amount;})),todayIncome.length+' 筆','＋')+kpi('今日商品成本',money(sum(todaySales,function(x){return x.costTotal;})),'依售出當下平均成本','成本')+kpi('今日暫估毛利',money(sum(todaySales,function(x){return x.grossProfit;})+sum(todayIncome,function(x){return x.amount;})),'未扣一般支出','↗')+kpi('本次銷售小計',money(cartSubtotal),state.cart.length+' 個品項','單')+kpi('本次預估成本',money(cartCost),'依目前平均成本','庫')+'</div>'+
      '<div class="ops-tabs"><button class="ops-tab active" data-sales-tab="product">商品銷售</button><button class="ops-tab" data-action="open-quick-income">＋ 快速收入</button><button class="ops-tab" data-action="show-sales-history">銷售紀錄</button></div>'+
      '<div class="ops-pos-layout"><section class="ops-card"><div class="ops-card-head"><div><h2>選擇商品</h2><p>可用名稱或 SKU 搜尋，點商品加入銷售清單。</p></div></div><div class="ops-toolbar"><input class="ops-input grow" id="posSearch" placeholder="搜尋現場商品" value="'+attr(state.posSearch)+'"></div><div class="ops-pos-products">'+productHtml+'</div></section>'+
      '<section class="ops-card"><div class="ops-card-head"><div><h2>本次銷售</h2><p>完成後會扣除庫存並建立庫存流水。</p></div><button class="ops-button small ghost" data-action="cart-clear">清空</button></div><div class="ops-cart">'+cartHtml+'</div><div class="ops-summary-list" style="margin-top:13px"><div class="ops-summary-line"><span>商品小計</span><b id="cartSubtotal">'+money(cartSubtotal)+'</b></div><div class="ops-summary-line"><span>預估商品成本</span><b id="cartCost">'+money(cartCost)+'</b></div></div><div style="margin-top:13px"><button class="ops-button primary" style="width:100%" data-action="checkout" '+(state.cart.length?'':'disabled')+'>結帳並扣庫存</button></div></section></div>';
  }

  function renderPurchases(){
    const low=state.catalog.filter(function(p){return p.initialized&&p.currentStock<=p.safetyStock;}).sort(function(a,b){return a.currentStock-b.currentStock;});
    const rows=state.inventory.filter(function(x){
      const term=lower(state.inventorySearch); return !term||lower([x.productName,x.sku,x.referenceId,x.note].join(' ')).includes(term);
    }).sort(function(a,b){return (dateFrom(b.occurredAt)||0)-(dateFrom(a.occurredAt)||0);}).slice(0,100);
    const typeName={opening:'期初庫存',purchase:'進貨入庫',sale:'現場銷售',adjustment:'盤點調整',return:'退貨入庫',caseUsage:'案件領用'};
    const table=rows.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>時間</th><th>類型</th><th>商品</th><th class="num">異動</th><th class="num">異動後</th><th>來源／備註</th></tr></thead><tbody>'+rows.map(function(x){return '<tr><td>'+escapeHtml(dateTimeText(x.occurredAt))+'</td><td>'+statusTag(typeName[x.type]||x.type,x.qtyChange>=0?'green':'yellow')+'</td><td><b>'+escapeHtml(x.productName||'未命名')+'</b><br><small>'+escapeHtml(x.sku||'')+'</small></td><td class="num"><b>'+(x.qtyChange>0?'+':'')+formatNumber(x.qtyChange)+'</b></td><td class="num">'+formatNumber(x.afterStock)+'</td><td>'+escapeHtml(x.referenceId||'')+'<br><small>'+escapeHtml(x.note||'')+'</small></td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('尚無庫存流水','完成進貨、銷售或盤點後會自動建立紀錄。');
    return '<div class="ops-kpi-grid">'+kpi('低庫存商品',String(low.length),'建議優先補貨','!')+kpi('本月進貨',money(sum(currentMonthRows(state.purchases,function(x){return x.receivedAt;}),function(x){return x.totalCost;})),currentMonthRows(state.purchases,function(x){return x.receivedAt;}).length+' 張進貨單','⇧')+kpi('庫存總件數',formatNumber(sum(state.catalog,function(p){return p.currentStock;})),'所有已建立主檔商品','庫')+kpi('庫存價值',money(sum(state.catalog,function(p){return (p.averageCost||0)*p.currentStock;})),'依移動平均成本','＄')+kpi('今日異動',String(todayRows(state.inventory,function(x){return x.occurredAt;}).length),'全部庫存流水','↕')+kpi('進貨供應商',String(new Set(state.purchases.map(function(x){return x.supplier;}).filter(Boolean)).size),'歷史供應商數','商')+'</div>'+
      '<div class="ops-grid-2"><section class="ops-card"><div class="ops-card-head"><div><h2>庫存異動流水</h2><p>每次銷售、進貨與盤點都有前後庫存紀錄。</p></div><div class="ops-card-actions"><button class="ops-button ghost" data-action="open-adjustment">盤點／調整</button><button class="ops-button primary" data-action="open-purchase">新增進貨入庫</button></div></div><div class="ops-toolbar"><input class="ops-input grow" id="inventorySearch" placeholder="搜尋商品、SKU、來源或備註" value="'+attr(state.inventorySearch)+'"></div>'+table+'</section><section class="ops-card"><div class="ops-card-head"><div><h2>低庫存清單</h2><p>現有庫存不高於安全庫存。</p></div></div>'+(low.length?low.slice(0,20).map(function(p){return '<div class="ops-status-row"><div><b>'+escapeHtml(p.name)+'</b><small>SKU '+escapeHtml(p.sku||'未設定')+'</small></div><div style="text-align:right"><b>'+formatNumber(p.currentStock)+' / 安全 '+formatNumber(p.safetyStock)+'</b><br><button class="ops-button small soft" data-action="purchase-this" data-id="'+attr(p.docId)+'">進貨</button></div></div>';}).join(''):emptyHtml('目前沒有低庫存商品','所有已建立商品都高於安全庫存。'))+'</section></div>';
  }

  function mergedRentals(){
    const ledgers=new Map(state.rentalLedgers.map(function(x){return [x.rentalContractId,x];}));
    return state.rentals.map(function(r){ const l=ledgers.get(r.id)||ledgers.get(r.contractNo)||null; const received=l?l.receivedAmount:0; const cost=l?(l.deliveryCost+l.maintenanceCost+l.otherCost):0; return Object.assign({},r,{ledger:l,receivedAmount:received,directCost:cost,profit:received-cost,expectedIncome:r.rentFee+r.shippingFee,outstanding:Math.max(0,r.rentFee+r.shippingFee-received)}); });
  }
  function renderRentals(){
    const term=lower(state.rentalSearch); const rows=mergedRentals().filter(function(r){return !term||lower([r.contractNo,r.customer,r.equipment,r.brand,r.model].join(' ')).includes(term);}).sort(function(a,b){return (dateFrom(a.endDate)||Infinity)-(dateFrom(b.endDate)||Infinity);});
    const totalExpected=sum(rows,function(r){return r.expectedIncome;}); const received=sum(rows,function(r){return r.receivedAmount;}); const costs=sum(rows,function(r){return r.directCost;}); const due=rows.filter(function(r){const d=daysUntil(r.endDate);return d!==null&&d>=0&&d<=30;});
    const table=rows.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>合約／客戶</th><th>設備</th><th>租期／到期</th><th class="num">合約收入</th><th class="num">已收</th><th class="num">直接成本</th><th class="num">目前損益</th><th>操作</th></tr></thead><tbody>'+rows.map(function(r){const d=daysUntil(r.endDate);return '<tr><td><b>'+escapeHtml(r.contractNo)+'</b><br><small>'+escapeHtml(r.customer)+' '+escapeHtml(r.phone)+'</small></td><td><b>'+escapeHtml([r.brand,r.model].filter(Boolean).join(' ')||r.equipment)+'</b><br><small>'+escapeHtml(r.assetNo||r.equipment)+'</small></td><td>'+escapeHtml(dateText(r.startDate))+'<br><small>至 '+escapeHtml(dateText(r.endDate))+' '+(d!==null&&d<=30&&d>=0?statusTag(d+'天到期','yellow'):'')+'</small></td><td class="num">'+money(r.expectedIncome)+'<br><small>押金 '+money(r.depositFee)+'</small></td><td class="num">'+money(r.receivedAmount)+'</td><td class="num">'+money(r.directCost)+'</td><td class="num"><b>'+money(r.profit)+'</b><br><small>未收 '+money(r.outstanding)+'</small></td><td><button class="ops-button small primary" data-action="rental-edit" data-id="'+attr(r.id)+'">補收款／成本</button></td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('尚無租賃合約','目前 rentalContracts 沒有可顯示資料。');
    return '<div class="ops-kpi-grid">'+kpi('租賃合約',String(rows.length),'沿用 rentalContracts','♫')+kpi('登錄租金＋運費',money(totalExpected),'不含押金','應')+kpi('已收款',money(received),'依營運帳冊登錄','收')+kpi('尚未收款',money(Math.max(0,totalExpected-received)),'合約收入－已收款','!')+kpi('直接成本',money(costs),'搬運＋維修＋其他','成本')+kpi('目前租賃損益',money(received-costs),'已收款－直接成本','↗')+'</div><section class="ops-card"><div class="ops-card-head"><div><h2>租賃損益帳冊</h2><p>原合約只讀；收款、搬運、維修成本寫入 opsRentalLedgers。</p></div><div class="ops-card-actions">'+(due.length?statusTag('30日內到期 '+due.length+' 件','yellow'):'')+'<a class="ops-button ghost" href="rental-contract-admin.html">原租賃管理</a></div></div><div class="ops-toolbar"><input class="ops-input grow" id="rentalSearch" placeholder="搜尋合約、客戶、設備、品牌或型號" value="'+attr(state.rentalSearch)+'"></div>'+table+'</section>';
  }

  function renderCases(){
    const term=lower(state.caseSearch); const rows=state.cases.filter(function(c){return !term||lower([c.caseNo,c.name,c.customer,c.status].join(' ')).includes(term);}).sort(function(a,b){return (dateFrom(b.updatedAt||b.createdAt)||0)-(dateFrom(a.updatedAt||a.createdAt)||0);});
    const active=rows.filter(function(c){return !['completed','cancelled'].includes(c.status);});
    const table=rows.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>案件</th><th>客戶／期限</th><th>狀態</th><th class="num">報價</th><th class="num">已收</th><th class="num">成本</th><th class="num">損益／待收</th><th>操作</th></tr></thead><tbody>'+rows.map(function(c){const statusMap={planning:'規劃中',quoted:'已報價',active:'進行中',completed:'已完成',cancelled:'已取消'};return '<tr><td><b>'+escapeHtml(c.caseNo)+'</b><br><small>'+escapeHtml(c.name)+'</small></td><td>'+escapeHtml(c.customer||'未填客戶')+'<br><small>期限 '+escapeHtml(dateText(c.dueDate))+'</small></td><td>'+statusTag(statusMap[c.status]||c.status,c.status==='completed'?'green':(c.status==='cancelled'?'red':'blue'))+'</td><td class="num">'+money(c.quotedAmount)+'</td><td class="num">'+money(c.receivedAmount)+'</td><td class="num">'+money(c.totalCost)+'</td><td class="num"><b>'+money(c.profit)+'</b><br><small>待收 '+money(c.outstanding)+'</small></td><td><button class="ops-button small primary" data-action="case-edit" data-id="'+attr(c.id)+'">編輯</button></td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('尚無案件','建立案件後即可追蹤報價、收款、成本與毛利。','<button class="ops-button primary" data-action="case-new">建立第一個案件</button>');
    return '<div class="ops-kpi-grid">'+kpi('全部案件',String(rows.length),'包含完成與取消','▣')+kpi('進行中案件',String(active.length),'尚未完成或取消','進')+kpi('案件報價總額',money(sum(rows,function(c){return c.quotedAmount;})),'所有案件','報')+kpi('案件已收款',money(sum(rows,function(c){return c.receivedAmount;})),'實際已收','收')+kpi('案件直接成本',money(sum(rows,function(c){return c.totalCost;})),'材料、人工、交通、其他','成本')+kpi('案件待收款',money(sum(rows,function(c){return c.outstanding;})),'報價－已收','!')+'</div><section class="ops-card"><div class="ops-card-head"><div><h2>案件清單</h2><p>案件可單獨管理收入、成本、進度與應收款。</p></div><button class="ops-button primary" data-action="case-new">新增案件</button></div><div class="ops-toolbar"><input class="ops-input grow" id="caseSearch" placeholder="搜尋案件編號、名稱、客戶或狀態" value="'+attr(state.caseSearch)+'"></div>'+table+'</section>';
  }

  function rangeRows(rows,getDate){
    const now=new Date(); let start;
    if(state.financeRange==='today') start=startOfDay(now);
    else if(state.financeRange==='7d'){ start=startOfDay(now); start.setDate(start.getDate()-6); }
    else if(state.financeRange==='year') start=new Date(now.getFullYear(),0,1);
    else start=new Date(now.getFullYear(),now.getMonth(),1);
    return rows.filter(function(r){const d=dateFrom(getDate(r));return d&&d>=start&&d<=endOfDay(now);});
  }
  function renderFinance(){
    const sales=rangeRows(state.sales,function(x){return x.soldAt;}); const incomes=rangeRows(state.incomes,function(x){return x.occurredAt;}); const expenses=rangeRows(state.expenses,function(x){return x.occurredAt;});
    const salesRevenue=sum(sales,function(x){return x.total;}); const quick=sum(incomes,function(x){return x.amount;}); const cogs=sum(sales,function(x){return x.costTotal;}); const general=sum(expenses,function(x){return x.amount;}); const profit=salesRevenue+quick-cogs-general;
    const expenseTable=expenses.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>日期</th><th>類別</th><th class="num">金額</th><th>付款方式</th><th>備註</th></tr></thead><tbody>'+expenses.sort(function(a,b){return (dateFrom(b.occurredAt)||0)-(dateFrom(a.occurredAt)||0);}).map(function(x){return '<tr><td>'+escapeHtml(dateText(x.occurredAt))+'</td><td>'+escapeHtml(x.category)+'</td><td class="num">'+money(x.amount)+'</td><td>'+escapeHtml(x.paymentMethod||'—')+'</td><td>'+escapeHtml(x.note||'')+'</td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('這段期間沒有一般支出','按「新增支出」登錄廣告、租金、耗材或其他費用。');
    const sourceRows=[['現場商品銷售',salesRevenue],['快速收入',quick],['商品成本',-cogs],['一般支出',-general]];
    return '<div class="ops-toolbar"><select class="ops-select" id="financeRange"><option value="today">今天</option><option value="7d">最近 7 天</option><option value="month">本月</option><option value="year">本年</option></select><button class="ops-button primary" data-action="expense-new">新增支出</button><button class="ops-button ghost" data-action="export-finance">匯出收支 CSV</button></div><div class="ops-kpi-grid">'+kpi('商品銷售收入',money(salesRevenue),sales.length+' 筆現場銷售','＄')+kpi('快速收入',money(quick),incomes.length+' 筆非商品收入','＋')+kpi('商品成本',money(cogs),'售出商品平均成本','成本')+kpi('一般支出',money(general),expenses.length+' 筆支出','－')+kpi('期間暫估損益',money(profit),'收入－成本－一般支出','↗')+kpi('商品毛利率',percentage(salesRevenue?((salesRevenue-cogs)/salesRevenue*100):0),'不含快速收入與一般支出','%')+'</div><div class="ops-grid-2"><section class="ops-card"><div class="ops-card-head"><div><h2>期間損益結構</h2><p>租賃與案件因收款日期未完整記錄，另於各自頁面呈現。</p></div></div><div class="ops-summary-list">'+sourceRows.map(function(x,i){return '<div class="ops-summary-line '+(i===sourceRows.length-1?'':'')+'"><span>'+escapeHtml(x[0])+'</span><b>'+money(x[1])+'</b></div>';}).join('')+'<div class="ops-summary-line total"><span>暫估損益</span><b>'+money(profit)+'</b></div></div></section><section class="ops-card"><div class="ops-card-head"><div><h2>租賃與案件概況</h2><p>不強制混入期間損益，避免日期不明造成誤判。</p></div></div><div class="ops-summary-list"><div class="ops-summary-line"><span>租賃已收款</span><b>'+money(sum(state.rentalLedgers,function(x){return x.receivedAmount;}))+'</b></div><div class="ops-summary-line"><span>租賃直接成本</span><b>'+money(sum(state.rentalLedgers,function(x){return x.deliveryCost+x.maintenanceCost+x.otherCost;}))+'</b></div><div class="ops-summary-line"><span>案件已收款</span><b>'+money(sum(state.cases,function(x){return x.receivedAmount;}))+'</b></div><div class="ops-summary-line"><span>案件直接成本</span><b>'+money(sum(state.cases,function(x){return x.totalCost;}))+'</b></div></div></section></div><section class="ops-card" style="margin-top:15px"><div class="ops-card-head"><div><h2>一般支出明細</h2><p>廣告、租金、耗材、人事以外的直接登錄費用。</p></div></div>'+expenseTable+'</section>';
  }

  function renderSync(){
    const jobs=state.syncJobs.sort(function(a,b){return (dateFrom(b.createdAt)||0)-(dateFrom(a.createdAt)||0);});
    const table=jobs.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>建立時間</th><th>工作編號</th><th>類型</th><th>平台</th><th class="num">商品數</th><th>狀態</th><th>建立者</th></tr></thead><tbody>'+jobs.map(function(x){return '<tr><td>'+escapeHtml(dateTimeText(x.createdAt))+'</td><td>'+escapeHtml(x.jobNo)+'</td><td>'+escapeHtml(x.type||'庫存同步預覽')+'</td><td>'+escapeHtml(x.platforms.join('、')||'尚未指定')+'</td><td class="num">'+formatNumber(x.productCount)+'</td><td>'+statusTag(x.status,x.status==='completed'?'green':(x.status==='failed'?'red':'yellow'))+'</td><td>'+escapeHtml(x.createdBy||'—')+'</td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('尚無同步工作','目前尚未建立平台同步預覽。');
    return '<div class="ops-callout red"><b>平台密鑰不能放在 GitHub 或瀏覽器。</b><br>本頁先完成同步預覽、商品資料完整度與工作紀錄。EasyStore／momo／Coupang 的正式讀寫必須由 Firebase Cloud Functions 或 Cloud Run 執行，設定密鑰後才會啟用。</div><div class="ops-grid-3"><section class="ops-card"><div class="ops-card-head"><div><h3>EasyStore</h3><p>商品圖片來源可用；正式訂單與庫存寫入待後端連線。</p></div>'+statusTag('待設定後端','yellow')+'</div></section><section class="ops-card"><div class="ops-card-head"><div><h3>momo</h3><p>需要平台 API 帳號、權限與來源 IP 驗證。</p></div>'+statusTag('待設定後端','yellow')+'</div></section><section class="ops-card"><div class="ops-card-head"><div><h3>Coupang</h3><p>需要 Vendor ID、Access Key 與 Secret Key。</p></div>'+statusTag('待設定後端','yellow')+'</div></section></div><section class="ops-card" style="margin-top:15px"><div class="ops-card-head"><div><h2>同步工作預覽</h2><p>只建立工作紀錄，不會直接更動任何平台庫存。</p></div><button class="ops-button primary" data-action="create-sync-preview">建立庫存同步預覽</button></div><div class="ops-summary-list" style="margin-bottom:13px"><div class="ops-summary-line"><span>已建立內部主檔</span><b>'+state.catalog.filter(function(p){return p.initialized;}).length+' 項</b></div><div class="ops-summary-line"><span>有 SKU</span><b>'+state.catalog.filter(function(p){return p.initialized&&p.sku;}).length+' 項</b></div><div class="ops-summary-line"><span>有庫存數字</span><b>'+state.catalog.filter(function(p){return p.initialized;}).length+' 項</b></div><div class="ops-summary-line"><span>可進入同步預覽</span><b>'+state.catalog.filter(function(p){return p.initialized&&p.sku;}).length+' 項</b></div></div>'+table+'</section>';
  }

  function renderConnection(){
    const diagnostics=state.diagnostics.map(function(d){return '<div class="ops-status-row"><div><b>'+escapeHtml(d.collection)+'</b><small>'+d.count+' 筆・'+d.ms+' ms'+(d.error?'・'+escapeHtml(d.error):'')+'</small></div><span class="ops-status-dot '+(d.ok?'':'error')+'">'+(d.ok?'已連線':'讀取失敗')+'</span></div>';}).join('');
    const audit=state.audit.sort(function(a,b){return (dateFrom(b.createdAt)||0)-(dateFrom(a.createdAt)||0);}).slice(0,30);
    const auditHtml=audit.length?audit.map(function(x){return '<div class="ops-activity"><div class="ops-activity-icon">•</div><div><b>'+escapeHtml(x.action)+'｜'+escapeHtml(x.summary||x.entityId)+'</b><small>'+escapeHtml(x.createdBy||'')+'・'+escapeHtml(dateTimeText(x.createdAt))+'</small></div></div>';}).join(''):emptyHtml('尚無營運操作紀錄','完成主檔、銷售、進貨或案件操作後會顯示。');
    return '<div class="ops-grid-2"><section class="ops-card"><div class="ops-card-head"><div><h2>Firebase 與集合狀態</h2><p>專案：'+escapeHtml((global.APP_CONFIG&&APP_CONFIG.FIREBASE_CONFIG&&APP_CONFIG.FIREBASE_CONFIG.projectId)||'未辨識')+'・版本 '+VERSION+'</p></div><button class="ops-button ghost" data-action="refresh">重新讀取</button></div>'+diagnostics+'</section><section class="ops-card"><div class="ops-card-head"><div><h2>備份與匯入</h2><p>可先下載營運資料備份，再進行大量匯入或調整。</p></div></div><div class="ops-summary-list"><div class="ops-summary-line"><span>網路商品來源</span><b>'+escapeHtml(state.onlineSource||'未找到')+'</b></div><div class="ops-summary-line"><span>內部商品主檔</span><b>'+state.internalProducts.length+' 筆</b></div><div class="ops-summary-line"><span>營運集合</span><b>'+Object.keys(COLLECTIONS).length+' 個</b></div></div><div class="ops-card-actions" style="margin-top:14px;justify-content:flex-start"><button class="ops-button primary" data-action="export-backup">下載 JSON 備份</button><button class="ops-button ghost" data-action="open-import">Excel 匯入商品主檔</button><button class="ops-button ghost" data-action="download-product-template">下載 CSV 範本</button></div></section></div><section class="ops-card" style="margin-top:15px"><div class="ops-card-head"><div><h2>最近營運操作</h2><p>只顯示 opsAuditLogs，不會混入原系統操作。</p></div></div>'+auditHtml+'</section>';
  }

  function bindViewSpecific(){
    const productFilter=byId('productFilter'); if(productFilter) productFilter.value=state.productFilter;
    const productSort=byId('productSort'); if(productSort) productSort.value=state.productSort;
    const financeRange=byId('financeRange'); if(financeRange) financeRange.value=state.financeRange;
  }

  function catalogById(id){ return state.catalog.find(function(p){return p.docId===id;})||null; }
  function rentalById(id){ return mergedRentals().find(function(r){return r.id===id;})||null; }
  function caseById(id){ return state.cases.find(function(c){return c.id===id;})||null; }

  function productFormHtml(p){
    const online=p&&p.online; const internal=p&&p.internal;
    return '<form id="productForm" data-id="'+attr(p?p.docId:'')+'">'+
      '<div class="ops-detail-hero"><img src="'+attr((p&&p.imageUrl)||'yuzu-logo-green.png')+'" alt=""><div><h3>'+escapeHtml((p&&p.name)||'新商品主檔')+'</h3><p>網路來源：'+escapeHtml((p&&p.sourceCollection)||'無')+'</p><p>來源編號：'+escapeHtml((online&&online.sourceProductId)||'—')+'</p></div></div>'+
      '<div class="ops-form-grid"><div class="ops-field"><label class="ops-required">內部 SKU／商品編號</label><input class="ops-input" name="internalSku" value="'+attr((p&&p.sku)||'')+'" placeholder="例如 YZ-CABLE-001" required></div><div class="ops-field"><label>條碼</label><input class="ops-input" name="barcode" value="'+attr((internal&&internal.barcode)||'')+'" placeholder="可留空"></div><div class="ops-field full"><label class="ops-required">內部商品名稱</label><input class="ops-input" name="internalName" value="'+attr((internal&&internal.internalName)||(p&&p.name)||'')+'" required></div><div class="ops-field"><label>門市售價</label><input class="ops-input" type="number" min="0" step="1" name="storePrice" value="'+attr(p&&p.storePrice!=null?p.storePrice:'')+'"></div><div class="ops-field"><label>網路售價參考</label><input class="ops-input" type="number" min="0" step="1" name="onlinePrice" value="'+attr(p&&p.onlinePrice!=null?p.onlinePrice:'')+'"></div><div class="ops-field"><label>最近進貨成本</label><input class="ops-input" type="number" min="0" step="0.01" name="latestPurchaseCost" value="'+attr(p&&p.latestPurchaseCost!=null?p.latestPurchaseCost:'')+'"></div><div class="ops-field"><label>移動平均成本</label><input class="ops-input" type="number" min="0" step="0.01" name="averageCost" value="'+attr(p&&p.averageCost!=null?p.averageCost:'')+'"><small>首次建立可與最近成本相同；之後進貨會自動計算。</small></div><div class="ops-field"><label>現有庫存</label><input class="ops-input" type="number" step="1" name="currentStock" value="'+attr(p&&p.currentStock!=null?p.currentStock:0)+'"></div><div class="ops-field"><label>保留庫存</label><input class="ops-input" type="number" min="0" step="1" name="reservedStock" value="'+attr(p&&p.reservedStock!=null?p.reservedStock:0)+'"></div><div class="ops-field"><label>安全庫存</label><input class="ops-input" type="number" min="0" step="1" name="safetyStock" value="'+attr(p&&p.safetyStock!=null?p.safetyStock:0)+'"></div><div class="ops-field"><label>狀態</label><select class="ops-select" name="status"><option value="active">正常銷售</option><option value="inactive">停用</option><option value="discontinued">停售</option></select></div><div class="ops-field"><label>品牌</label><input class="ops-input" name="brand" value="'+attr((p&&p.brand)||'')+'"></div><div class="ops-field"><label>分類</label><input class="ops-input" name="category" value="'+attr((p&&p.category)||'')+'"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note">'+escapeHtml((internal&&internal.note)||'')+'</textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存商品主檔</button></div></form>';
  }
  function openProductEdit(id){
    const p=catalogById(id); if(!p) return toast('找不到商品','請重新讀取資料。','error');
    openDrawer(p.initialized?'編輯商品主檔':'建立商品主檔','只修改 opsInternalProducts，不會改動原網路商品。',productFormHtml(p));
    const status=query('#productForm [name="status"]'); if(status) status.value=(p.internal&&p.internal.status)||'active';
  }
  function openProductDetail(id){
    const p=catalogById(id); if(!p) return;
    const tx=state.inventory.filter(function(x){return x.productId===p.docId;}).sort(function(a,b){return (dateFrom(b.occurredAt)||0)-(dateFrom(a.occurredAt)||0);}).slice(0,10);
    const txHtml=tx.length?tx.map(function(x){return '<div class="ops-status-row"><div><b>'+escapeHtml(x.type)+'・'+(x.qtyChange>0?'+':'')+formatNumber(x.qtyChange)+'</b><small>'+escapeHtml(dateTimeText(x.occurredAt))+' '+escapeHtml(x.referenceId||'')+'</small></div><b>'+formatNumber(x.afterStock)+'</b></div>';}).join(''):emptyHtml('尚無庫存異動','進貨、銷售或盤點後會顯示。');
    const body='<div class="ops-detail-hero"><img src="'+attr(p.imageUrl||'yuzu-logo-green.png')+'" alt=""><div><h3>'+escapeHtml(p.name)+'</h3><p>SKU：'+escapeHtml(p.sku||'尚未設定')+'</p><p>'+escapeHtml([p.brand,p.category,p.variantName].filter(Boolean).join('・')||'未設定品牌／分類')+'</p></div></div><div class="ops-grid-equal"><div class="ops-card"><div class="ops-summary-list"><div class="ops-summary-line"><span>現有庫存</span><b>'+formatNumber(p.currentStock)+'</b></div><div class="ops-summary-line"><span>保留庫存</span><b>'+formatNumber(p.reservedStock)+'</b></div><div class="ops-summary-line"><span>安全庫存</span><b>'+formatNumber(p.safetyStock)+'</b></div><div class="ops-summary-line total"><span>可銷售庫存</span><b>'+formatNumber(p.availableStock)+'</b></div></div></div><div class="ops-card"><div class="ops-summary-list"><div class="ops-summary-line"><span>門市售價</span><b>'+money(p.storePrice)+'</b></div><div class="ops-summary-line"><span>平均成本</span><b>'+money(p.averageCost)+'</b></div><div class="ops-summary-line"><span>單件毛利</span><b>'+money(p.storePrice!=null&&p.averageCost!=null?p.storePrice-p.averageCost:null)+'</b></div><div class="ops-summary-line total"><span>毛利率</span><b>'+percentage(p.margin)+'</b></div></div></div></div><div class="ops-section-title">最近庫存異動</div>'+txHtml+'<div class="ops-drawer-footer"><button class="ops-button ghost" data-action="drawer-close">關閉</button><button class="ops-button primary" data-action="product-edit" data-id="'+attr(p.docId)+'">編輯主檔</button></div>';
    openDrawer('商品完整資料','商品、庫存、成本與最近異動。',body);
  }
  async function saveProduct(form){
    const id=clean(form.dataset.id); const p=catalogById(id); if(!p) throw new Error('找不到商品資料');
    const data=new FormData(form); const internalSku=normalizeCode(data.get('internalSku')); const internalName=clean(data.get('internalName'));
    if(!internalSku||!internalName) throw new Error('請填寫內部 SKU 與商品名稱');
    const duplicate=state.internalProducts.find(function(x){return x.internalSku===internalSku&&x.docId!==id;}); if(duplicate) throw new Error('此 SKU 已被其他商品使用：'+internalSku);
    const oldStock=p.initialized?p.currentStock:0; const newStock=numberOrNull(data.get('currentStock'))||0;
    const payload={
      sourceKey:(p.online&&p.online.sourceKey)||(p.internal&&p.internal.sourceKey)||'',sourceCollection:p.sourceCollection||'',sourceProductId:(p.online&&p.online.sourceProductId)||(p.internal&&p.internal.sourceProductId)||'',internalSku:internalSku,barcode:clean(data.get('barcode')),internalName:internalName,onlineName:(p.online&&p.online.onlineName)||(p.internal&&p.internal.onlineName)||'',imageUrl:p.imageUrl||'',onlineUrl:p.onlineUrl||'',brand:clean(data.get('brand')),category:clean(data.get('category')),variantName:p.variantName||'',onlinePrice:numberOrNull(data.get('onlinePrice')),storePrice:numberOrNull(data.get('storePrice')),latestPurchaseCost:numberOrNull(data.get('latestPurchaseCost')),averageCost:numberOrNull(data.get('averageCost')),currentStock:newStock,reservedStock:numberOrNull(data.get('reservedStock'))||0,safetyStock:numberOrNull(data.get('safetyStock'))||0,status:clean(data.get('status'))||'active',note:clean(data.get('note')),enabled:true,autoCreated:p.internal?p.internal.autoCreated:false,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION
    };
    if(!p.initialized){ payload.createdAt=serverTimestamp(); payload.createdBy=userLabel(); }
    await state.db.collection(COLLECTIONS.products).doc(id).set(payload,{merge:true});
    if(newStock!==oldStock){
      await state.db.collection(COLLECTIONS.inventory).add({type:p.initialized?'adjustment':'opening',productId:id,productName:internalName,sku:internalSku,qtyChange:newStock-oldStock,beforeStock:oldStock,afterStock:newStock,referenceType:'productMaster',referenceId:id,note:p.initialized?'商品主檔直接調整':'建立期初庫存',occurredAt:serverTimestamp(),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
    }
    await writeAudit('儲存商品主檔','product',id,internalName+'｜'+internalSku);
    closeDrawer(); toast('商品已儲存',internalName,'success'); await loadAll(true);
  }

  async function autoInitProducts(){
    const missing=state.catalog.filter(function(p){return !p.initialized&&p.online;});
    if(!missing.length) return toast('不需要建立','所有網路商品都已有內部主檔。','success');
    const yes=await confirmAction('一鍵建立商品主檔','將從 '+state.onlineSource+' 建立 '+missing.length+' 筆 opsInternalProducts。原商品資料不會被修改，成本與庫存先設為 0。','開始建立');
    if(!yes) return;
    showAlert('正在建立 '+missing.length+' 筆商品主檔，請不要關閉頁面…','');
    try{
      for(let start=0;start<missing.length;start+=BATCH_SIZE){
        const batch=state.db.batch();
        missing.slice(start,start+BATCH_SIZE).forEach(function(p){
          const ref=state.db.collection(COLLECTIONS.products).doc(p.docId);
          batch.set(ref,{sourceKey:p.online.sourceKey,sourceCollection:p.online.sourceCollection,sourceProductId:p.online.sourceProductId,internalSku:p.online.sku||'',barcode:'',internalName:p.online.onlineName,onlineName:p.online.onlineName,imageUrl:p.online.imageUrl||'',onlineUrl:p.online.url||'',brand:p.online.brand||'',category:p.online.category||'',variantName:p.online.variantName||'',onlinePrice:p.online.onlinePrice,storePrice:p.online.onlinePrice,latestPurchaseCost:null,averageCost:null,currentStock:0,reservedStock:0,safetyStock:0,status:'active',note:'',enabled:true,autoCreated:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:userLabel(),updatedBy:userLabel(),version:VERSION},{merge:false});
        });
        await batch.commit();
      }
      await state.db.collection(COLLECTIONS.imports).add({type:'autoCreateFromOnline',sourceCollection:state.onlineSource,count:missing.length,status:'completed',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      await writeAudit('一鍵建立商品主檔','productImport','',state.onlineSource+' → '+missing.length+' 筆');
      clearAlert(); toast('商品主檔建立完成','共建立 '+missing.length+' 筆。','success'); await loadAll(true);
    }catch(error){ clearAlert(); showAlert('建立失敗：'+errorMessage(error),'error'); }
  }

  function addCartProduct(id){
    const p=catalogById(id); if(!p||!p.initialized) return;
    const existing=state.cart.find(function(x){return x.productId===id;});
    if(existing) existing.qty+=1;
    else state.cart.push({productId:id,name:p.name,sku:p.sku,imageUrl:p.imageUrl,qty:1,unitPrice:Number(p.storePrice||0),averageCost:Number(p.averageCost||0),currentStock:p.currentStock});
    render();
  }
  function checkoutDrawer(){
    const subtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;}); const cost=sum(state.cart,function(x){return x.qty*x.averageCost;});
    openDrawer('現場銷售結帳','完成後會寫入銷售單、扣庫存並建立庫存流水。','<form id="checkoutForm"><div class="ops-summary-list"><div class="ops-summary-line"><span>品項</span><b>'+state.cart.length+' 項</b></div><div class="ops-summary-line"><span>商品小計</span><b>'+money(subtotal)+'</b></div><div class="ops-summary-line"><span>預估成本</span><b>'+money(cost)+'</b></div></div><div class="ops-form-grid" style="margin-top:15px"><div class="ops-field"><label class="ops-required">成交時間</label><input class="ops-input" type="datetime-local" name="soldAt" value="'+inputDateTime(new Date())+'" required></div><div class="ops-field"><label class="ops-required">付款方式</label><select class="ops-select" name="paymentMethod" required><option value="現金">現金</option><option value="信用卡">信用卡</option><option value="轉帳">轉帳</option><option value="LINE Pay">LINE Pay</option><option value="其他">其他</option></select></div><div class="ops-field"><label>整單折扣</label><input class="ops-input" type="number" min="0" step="1" name="discount" value="0"></div><div class="ops-field"><label>客戶姓名</label><input class="ops-input" name="customerName"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note"></textarea></div></div><div class="ops-callout">若商品庫存不足，系統會停止整張銷售，不會只扣部分商品。</div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">確認收款並扣庫存</button></div></form>');
  }
  async function saveCheckout(form){
    if(!state.cart.length) throw new Error('銷售清單是空的');
    const data=new FormData(form); const discount=numberOrNull(data.get('discount'))||0; const soldAt=new Date(clean(data.get('soldAt'))); if(Number.isNaN(soldAt.getTime())) throw new Error('成交時間格式不正確');
    const saleNo=uid('SALE'); const saleRef=state.db.collection(COLLECTIONS.sales).doc();
    await state.db.runTransaction(async function(tx){
      const refs=state.cart.map(function(item){return state.db.collection(COLLECTIONS.products).doc(item.productId);});
      const snaps=[]; for(const ref of refs){ snaps.push(await tx.get(ref)); }
      const prepared=[]; let subtotal=0; let costTotal=0;
      snaps.forEach(function(snap,index){
        if(!snap.exists) throw new Error('商品主檔不存在：'+state.cart[index].name);
        const raw=snap.data()||{}; const current=Number(raw.currentStock||0); const item=state.cart[index]; const qty=Math.max(1,Math.round(Number(item.qty||0))); if(current<qty) throw new Error(item.name+' 庫存不足，目前 '+current+'，本次需要 '+qty);
        const unitPrice=Math.max(0,Number(item.unitPrice||0)); const avg=Number(raw.averageCost!=null?raw.averageCost:(raw.latestPurchaseCost||0)); subtotal+=qty*unitPrice; costTotal+=qty*avg;
        prepared.push({ref:refs[index],snap:snap,item:item,qty:qty,current:current,unitPrice:unitPrice,avg:avg});
      });
      const total=Math.max(0,subtotal-discount); const grossProfit=total-costTotal;
      tx.set(saleRef,{saleNo:saleNo,soldAt:soldAt,items:prepared.map(function(x){return {productId:x.item.productId,name:x.item.name,sku:x.item.sku,qty:x.qty,unitPrice:x.unitPrice,lineTotal:x.qty*x.unitPrice,unitCost:x.avg,lineCost:x.qty*x.avg};}),subtotal:subtotal,discount:discount,total:total,costTotal:costTotal,grossProfit:grossProfit,paymentMethod:clean(data.get('paymentMethod')),customerName:clean(data.get('customerName')),note:clean(data.get('note')),status:'completed',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      prepared.forEach(function(x){
        const after=x.current-x.qty; tx.update(x.ref,{currentStock:after,updatedAt:serverTimestamp(),updatedBy:userLabel()});
        const tRef=state.db.collection(COLLECTIONS.inventory).doc(); tx.set(tRef,{type:'sale',productId:x.item.productId,productName:x.item.name,sku:x.item.sku,qtyChange:-x.qty,beforeStock:x.current,afterStock:after,unitCost:x.avg,referenceType:'storeSale',referenceId:saleNo,note:'現場銷售',occurredAt:soldAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      });
    });
    await writeAudit('完成現場銷售','storeSale',saleRef.id,saleNo+'｜'+money(sum(state.cart,function(x){return x.qty*x.unitPrice;})-discount));
    state.cart=[]; closeDrawer(); toast('現場銷售完成',saleNo,'success'); await loadAll(true);
  }
  function openQuickIncome(){
    openDrawer('新增快速收入','適用於調音、搬運、服務費或其他不扣商品庫存的收入。','<form id="quickIncomeForm"><div class="ops-form-grid"><div class="ops-field"><label class="ops-required">收入日期</label><input class="ops-input" type="datetime-local" name="occurredAt" value="'+inputDateTime(new Date())+'" required></div><div class="ops-field"><label class="ops-required">收入類別</label><input class="ops-input" name="category" placeholder="例如：調音服務" required></div><div class="ops-field"><label class="ops-required">金額</label><input class="ops-input" type="number" min="0" step="1" name="amount" required></div><div class="ops-field"><label>付款方式</label><select class="ops-select" name="paymentMethod"><option>現金</option><option>信用卡</option><option>轉帳</option><option>LINE Pay</option><option>其他</option></select></div><div class="ops-field"><label>客戶姓名</label><input class="ops-input" name="customerName"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note"></textarea></div></div><div class="ops-callout">未登錄成本時，這筆金額會先視為暫估毛利；相關支出可在「毛利與收支」新增。</div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存收入</button></div></form>');
  }
  async function saveQuickIncome(form){
    const data=new FormData(form); const amount=numberOrNull(data.get('amount')); if(amount==null||amount<0) throw new Error('請填寫正確金額'); const no=uid('INC');
    const ref=await state.db.collection(COLLECTIONS.incomes).add({incomeNo:no,occurredAt:new Date(clean(data.get('occurredAt'))),category:clean(data.get('category')),amount:amount,paymentMethod:clean(data.get('paymentMethod')),customerName:clean(data.get('customerName')),note:clean(data.get('note')),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
    await writeAudit('新增快速收入','quickIncome',ref.id,no+'｜'+money(amount)); closeDrawer(); toast('快速收入已儲存',no,'success'); await loadAll(true);
  }
  function openSalesHistory(){
    const rows=state.sales.sort(function(a,b){return (dateFrom(b.soldAt)||0)-(dateFrom(a.soldAt)||0);}).slice(0,100);
    const body=rows.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>時間／單號</th><th>品項</th><th>付款</th><th class="num">收入</th><th class="num">成本</th><th class="num">毛利</th></tr></thead><tbody>'+rows.map(function(x){return '<tr><td>'+escapeHtml(dateTimeText(x.soldAt))+'<br><small>'+escapeHtml(x.saleNo)+'</small></td><td>'+x.items.length+' 項<br><small>'+escapeHtml(x.items.map(function(i){return i.name;}).slice(0,2).join('、'))+'</small></td><td>'+escapeHtml(x.paymentMethod||'—')+'</td><td class="num">'+money(x.total)+'</td><td class="num">'+money(x.costTotal)+'</td><td class="num"><b>'+money(x.grossProfit)+'</b></td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('尚無銷售紀錄','完成現場銷售後會顯示。');
    openDrawer('現場銷售紀錄','最近 100 筆現場商品銷售。',body+'<div class="ops-drawer-footer"><button class="ops-button primary" data-action="drawer-close">關閉</button></div>');
  }

  function purchaseItemOptions(selectedId){
    return state.catalog.filter(function(p){return p.initialized;}).sort(function(a,b){return a.name.localeCompare(b.name,'zh-Hant');}).map(function(p){return '<option value="'+attr(p.docId)+'" '+(p.docId===selectedId?'selected':'')+'>'+escapeHtml((p.sku?p.sku+'｜':'')+p.name)+'</option>';}).join('');
  }
  function openPurchase(preselectedId){
    const first=preselectedId||((state.catalog.find(function(p){return p.initialized;})||{}).docId||'');
    openDrawer('新增進貨入庫','一次可驗收多個商品；系統會增加庫存並重新計算移動平均成本。','<form id="purchaseForm"><div class="ops-form-grid"><div class="ops-field"><label class="ops-required">到貨時間</label><input class="ops-input" type="datetime-local" name="receivedAt" value="'+inputDateTime(new Date())+'" required></div><div class="ops-field"><label class="ops-required">供應商</label><input class="ops-input" name="supplier" placeholder="供應商名稱" required></div><div class="ops-field"><label>額外費用</label><input class="ops-input" type="number" min="0" step="1" name="extraCost" value="0"><small>運費、關稅等會按商品金額比例分攤。</small></div><div class="ops-field"><label>進貨單號／外部編號</label><input class="ops-input" name="externalNo"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note"></textarea></div></div><div class="ops-section-title">進貨商品</div><div id="purchaseItems">'+purchaseRowHtml(first,0)+'</div><button class="ops-button soft small" type="button" data-action="purchase-add-row">＋ 增加商品</button><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">確認驗收入庫</button></div></form>');
  }
  function purchaseRowHtml(selectedId,index){
    return '<div class="ops-cart-row purchase-row" data-index="'+index+'" style="grid-template-columns:minmax(0,1fr) 80px 110px 34px;margin-bottom:8px"><select class="ops-select" name="productId" required><option value="">選擇商品</option>'+purchaseItemOptions(selectedId)+'</select><input type="number" name="qty" min="1" step="1" value="1" required><input type="number" name="unitCost" min="0" step="0.01" placeholder="單位成本" required><button class="ops-icon-button" type="button" data-action="purchase-remove-row">×</button></div>';
  }
  async function savePurchase(form){
    const data=new FormData(form); const rowEls=queryAll('.purchase-row',form); const items=[];
    rowEls.forEach(function(row){
      const productId=clean(query('[name="productId"]',row).value); const qty=numberOrNull(query('[name="qty"]',row).value); const unitCost=numberOrNull(query('[name="unitCost"]',row).value); if(productId&&qty>0&&unitCost!=null) items.push({productId:productId,qty:Math.round(qty),unitCost:unitCost});
    });
    if(!items.length) throw new Error('至少需要一個有效進貨商品');
    const duplicate=new Set(); for(const item of items){ if(duplicate.has(item.productId)) throw new Error('同一商品請合併成一列'); duplicate.add(item.productId); }
    const extraCost=numberOrNull(data.get('extraCost'))||0; const receivedAt=new Date(clean(data.get('receivedAt'))); if(Number.isNaN(receivedAt.getTime())) throw new Error('到貨時間不正確'); const purchaseNo=uid('PUR'); const purchaseRef=state.db.collection(COLLECTIONS.purchases).doc();
    await state.db.runTransaction(async function(tx){
      const refs=items.map(function(item){return state.db.collection(COLLECTIONS.products).doc(item.productId);}); const snaps=[]; for(const ref of refs){snaps.push(await tx.get(ref));}
      const subtotal=sum(items,function(i){return i.qty*i.unitCost;}); const prepared=[];
      snaps.forEach(function(snap,index){
        if(!snap.exists) throw new Error('商品主檔不存在'); const raw=snap.data()||{}; const item=items[index]; const before=Number(raw.currentStock||0); const oldAvg=Number(raw.averageCost!=null?raw.averageCost:(raw.latestPurchaseCost||0)); const base=item.qty*item.unitCost; const allocated=subtotal>0?extraCost*(base/subtotal):0; const effectiveUnit=item.unitCost+(item.qty?allocated/item.qty:0); const after=before+item.qty; const newAvg=after>0?((Math.max(0,before)*oldAvg)+(item.qty*effectiveUnit))/after:effectiveUnit; prepared.push({ref:refs[index],raw:raw,item:item,before:before,after:after,allocated:allocated,effectiveUnit:effectiveUnit,newAvg:newAvg});
      });
      tx.set(purchaseRef,{purchaseNo:purchaseNo,externalNo:clean(data.get('externalNo')),receivedAt:receivedAt,supplier:clean(data.get('supplier')),items:prepared.map(function(x){return {productId:x.item.productId,name:clean(x.raw.internalName||x.raw.onlineName),sku:clean(x.raw.internalSku),qty:x.item.qty,unitCost:x.item.unitCost,allocatedExtraCost:x.allocated,effectiveUnitCost:x.effectiveUnit,lineTotal:x.item.qty*x.item.unitCost};}),subtotal:subtotal,extraCost:extraCost,totalCost:subtotal+extraCost,note:clean(data.get('note')),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      prepared.forEach(function(x){
        tx.update(x.ref,{currentStock:x.after,latestPurchaseCost:x.item.unitCost,averageCost:x.newAvg,updatedAt:serverTimestamp(),updatedBy:userLabel()});
        const tRef=state.db.collection(COLLECTIONS.inventory).doc(); tx.set(tRef,{type:'purchase',productId:x.item.productId,productName:clean(x.raw.internalName||x.raw.onlineName),sku:clean(x.raw.internalSku),qtyChange:x.item.qty,beforeStock:x.before,afterStock:x.after,unitCost:x.effectiveUnit,referenceType:'purchase',referenceId:purchaseNo,note:'進貨入庫｜'+clean(data.get('supplier')),occurredAt:receivedAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      });
    });
    await writeAudit('進貨驗收入庫','purchase',purchaseRef.id,purchaseNo+'｜'+clean(data.get('supplier'))+'｜'+items.length+'項'); closeDrawer(); toast('進貨入庫完成',purchaseNo,'success'); await loadAll(true);
  }
  function openAdjustment(preselectedId){
    openDrawer('盤點／庫存調整','輸入盤點後的實際庫存，系統會自動計算異動量。','<form id="adjustmentForm"><div class="ops-form-grid"><div class="ops-field full"><label class="ops-required">商品</label><select class="ops-select" name="productId" required><option value="">選擇商品</option>'+purchaseItemOptions(preselectedId||'')+'</select></div><div class="ops-field"><label class="ops-required">盤點後實際庫存</label><input class="ops-input" type="number" step="1" name="afterStock" required></div><div class="ops-field"><label>異動日期</label><input class="ops-input" type="datetime-local" name="occurredAt" value="'+inputDateTime(new Date())+'"></div><div class="ops-field full"><label class="ops-required">原因／備註</label><textarea class="ops-textarea" name="note" placeholder="例如：2026年7月盤點修正" required></textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">確認調整</button></div></form>');
  }
  async function saveAdjustment(form){
    const data=new FormData(form); const productId=clean(data.get('productId')); const afterStock=numberOrNull(data.get('afterStock')); if(!productId||afterStock==null) throw new Error('請選擇商品並填寫盤點後庫存'); const occurredAt=new Date(clean(data.get('occurredAt'))); const ref=state.db.collection(COLLECTIONS.products).doc(productId); let productName=''; let sku=''; let before=0;
    await state.db.runTransaction(async function(tx){ const snap=await tx.get(ref); if(!snap.exists) throw new Error('商品主檔不存在'); const raw=snap.data()||{}; before=Number(raw.currentStock||0); productName=clean(raw.internalName||raw.onlineName); sku=clean(raw.internalSku); tx.update(ref,{currentStock:afterStock,updatedAt:serverTimestamp(),updatedBy:userLabel()}); const tRef=state.db.collection(COLLECTIONS.inventory).doc(); tx.set(tRef,{type:'adjustment',productId:productId,productName:productName,sku:sku,qtyChange:afterStock-before,beforeStock:before,afterStock:afterStock,unitCost:numberOrNull(raw.averageCost),referenceType:'stocktake',referenceId:uid('ADJ'),note:clean(data.get('note')),occurredAt:occurredAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION}); });
    await writeAudit('盤點調整庫存','inventory',productId,productName+'｜'+before+' → '+afterStock); closeDrawer(); toast('庫存已調整',productName+'：'+before+' → '+afterStock,'success'); await loadAll(true);
  }

  function openRentalEdit(id){
    const r=rentalById(id); if(!r) return;
    openDrawer('租賃收款與成本','原合約維持不變；這裡只補營運帳冊。','<form id="rentalLedgerForm" data-id="'+attr(r.id)+'"><div class="ops-callout green"><b>'+escapeHtml(r.contractNo)+'｜'+escapeHtml(r.customer)+'</b><br>'+escapeHtml([r.brand,r.model,r.equipment].filter(Boolean).join(' '))+'・合約租金與運費 '+money(r.expectedIncome)+'・押金 '+money(r.depositFee)+'</div><div class="ops-form-grid"><div class="ops-field"><label>已收租金／運費</label><input class="ops-input" type="number" min="0" step="1" name="receivedAmount" value="'+r.receivedAmount+'"></div><div class="ops-field"><label>搬運／運送成本</label><input class="ops-input" type="number" min="0" step="1" name="deliveryCost" value="'+(r.ledger?r.ledger.deliveryCost:0)+'"></div><div class="ops-field"><label>維修成本</label><input class="ops-input" type="number" min="0" step="1" name="maintenanceCost" value="'+(r.ledger?r.ledger.maintenanceCost:0)+'"></div><div class="ops-field"><label>其他直接成本</label><input class="ops-input" type="number" min="0" step="1" name="otherCost" value="'+(r.ledger?r.ledger.otherCost:0)+'"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note">'+escapeHtml(r.ledger?r.ledger.note:'')+'</textarea></div></div><div class="ops-callout">押金不列入營業收入。損益以「已收租金／運費－直接成本」計算。</div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存租賃帳冊</button></div></form>');
  }
  async function saveRentalLedger(form){
    const id=clean(form.dataset.id); const r=rentalById(id); if(!r) throw new Error('找不到租賃合約'); const data=new FormData(form); const payload={rentalContractId:r.id,contractNo:r.contractNo,customer:r.customer,equipment:r.equipment,receivedAmount:numberOrNull(data.get('receivedAmount'))||0,deliveryCost:numberOrNull(data.get('deliveryCost'))||0,maintenanceCost:numberOrNull(data.get('maintenanceCost'))||0,otherCost:numberOrNull(data.get('otherCost'))||0,note:clean(data.get('note')),updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};
    if(!r.ledger){payload.createdAt=serverTimestamp();payload.createdBy=userLabel();}
    await state.db.collection(COLLECTIONS.rentalLedgers).doc(r.id).set(payload,{merge:true}); await writeAudit('更新租賃損益','rental',r.id,r.contractNo+'｜已收 '+money(payload.receivedAmount)); closeDrawer(); toast('租賃帳冊已更新',r.contractNo,'success'); await loadAll(true);
  }

  function caseFormHtml(c){
    const row=c||{id:'',caseNo:uid('CASE'),name:'',customer:'',status:'planning',quotedAmount:0,receivedAmount:0,materialCost:0,laborCost:0,transportCost:0,otherCost:0,startDate:dateText(new Date()),dueDate:'',note:''};
    return '<form id="caseForm" data-id="'+attr(row.id||'')+'"><div class="ops-form-grid"><div class="ops-field"><label class="ops-required">案件編號</label><input class="ops-input" name="caseNo" value="'+attr(row.caseNo)+'" required></div><div class="ops-field"><label class="ops-required">案件名稱</label><input class="ops-input" name="name" value="'+attr(row.name)+'" required></div><div class="ops-field"><label>客戶</label><input class="ops-input" name="customer" value="'+attr(row.customer)+'"></div><div class="ops-field"><label>狀態</label><select class="ops-select" name="status"><option value="planning">規劃中</option><option value="quoted">已報價</option><option value="active">進行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></div><div class="ops-field"><label>開始日期</label><input class="ops-input" type="date" name="startDate" value="'+attr(dateText(row.startDate)==='—'?'':dateText(row.startDate))+'"></div><div class="ops-field"><label>預計完成日</label><input class="ops-input" type="date" name="dueDate" value="'+attr(dateText(row.dueDate)==='—'?'':dateText(row.dueDate))+'"></div><div class="ops-field"><label>報價金額</label><input class="ops-input" type="number" min="0" step="1" name="quotedAmount" value="'+row.quotedAmount+'"></div><div class="ops-field"><label>目前已收款</label><input class="ops-input" type="number" min="0" step="1" name="receivedAmount" value="'+row.receivedAmount+'"></div><div class="ops-field"><label>材料成本</label><input class="ops-input" type="number" min="0" step="1" name="materialCost" value="'+row.materialCost+'"></div><div class="ops-field"><label>人工／外包成本</label><input class="ops-input" type="number" min="0" step="1" name="laborCost" value="'+row.laborCost+'"></div><div class="ops-field"><label>交通／搬運成本</label><input class="ops-input" type="number" min="0" step="1" name="transportCost" value="'+row.transportCost+'"></div><div class="ops-field"><label>其他成本</label><input class="ops-input" type="number" min="0" step="1" name="otherCost" value="'+row.otherCost+'"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note">'+escapeHtml(row.note)+'</textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存案件</button></div></form>';
  }
  function openCase(id){ const c=id?caseById(id):null; openDrawer(c?'編輯案件':'新增案件','記錄報價、收款、直接成本與應收款。',caseFormHtml(c)); const select=query('#caseForm [name="status"]'); if(select) select.value=c?c.status:'planning'; }
  async function saveCase(form){
    const id=clean(form.dataset.id); const data=new FormData(form); const payload={caseNo:clean(data.get('caseNo')),name:clean(data.get('name')),customer:clean(data.get('customer')),status:clean(data.get('status')),startDate:clean(data.get('startDate')),dueDate:clean(data.get('dueDate')),quotedAmount:numberOrNull(data.get('quotedAmount'))||0,receivedAmount:numberOrNull(data.get('receivedAmount'))||0,materialCost:numberOrNull(data.get('materialCost'))||0,laborCost:numberOrNull(data.get('laborCost'))||0,transportCost:numberOrNull(data.get('transportCost'))||0,otherCost:numberOrNull(data.get('otherCost'))||0,note:clean(data.get('note')),updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION}; if(!payload.caseNo||!payload.name) throw new Error('請填寫案件編號與名稱');
    let ref; if(id){ref=state.db.collection(COLLECTIONS.cases).doc(id); await ref.set(payload,{merge:true});}else{payload.createdAt=serverTimestamp();payload.createdBy=userLabel();ref=await state.db.collection(COLLECTIONS.cases).add(payload);} await writeAudit(id?'更新案件':'新增案件','case',ref.id,payload.caseNo+'｜'+payload.name); closeDrawer(); toast('案件已儲存',payload.caseNo,'success'); await loadAll(true);
  }

  function openExpense(){
    openDrawer('新增一般支出','適用於廣告、耗材、租金、交通或其他非商品進貨支出。','<form id="expenseForm"><div class="ops-form-grid"><div class="ops-field"><label class="ops-required">支出日期</label><input class="ops-input" type="datetime-local" name="occurredAt" value="'+inputDateTime(new Date())+'" required></div><div class="ops-field"><label class="ops-required">類別</label><input class="ops-input" name="category" placeholder="例如：廣告費" required></div><div class="ops-field"><label class="ops-required">金額</label><input class="ops-input" type="number" min="0" step="1" name="amount" required></div><div class="ops-field"><label>付款方式</label><select class="ops-select" name="paymentMethod"><option>現金</option><option>信用卡</option><option>轉帳</option><option>其他</option></select></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note"></textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存支出</button></div></form>');
  }
  async function saveExpense(form){
    const data=new FormData(form); const amount=numberOrNull(data.get('amount')); if(amount==null) throw new Error('請填寫支出金額'); const no=uid('EXP'); const ref=await state.db.collection(COLLECTIONS.expenses).add({expenseNo:no,occurredAt:new Date(clean(data.get('occurredAt'))),category:clean(data.get('category')),amount:amount,paymentMethod:clean(data.get('paymentMethod')),note:clean(data.get('note')),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION}); await writeAudit('新增一般支出','expense',ref.id,no+'｜'+money(amount)); closeDrawer(); toast('支出已儲存',no,'success'); await loadAll(true);
  }

  async function createSyncPreview(){
    const eligible=state.catalog.filter(function(p){return p.initialized&&p.sku;}); if(!eligible.length) return toast('無可同步商品','請先建立商品主檔與 SKU。','warning'); const yes=await confirmAction('建立同步預覽','將建立 '+eligible.length+' 筆商品的同步工作紀錄，但不會呼叫任何平台 API。','建立預覽'); if(!yes) return; const jobNo=uid('SYNC'); const ref=await state.db.collection(COLLECTIONS.syncJobs).add({jobNo:jobNo,type:'inventoryPreview',status:'preview',platforms:['EasyStore','momo','Coupang'],productCount:eligible.length,items:eligible.slice(0,500).map(function(p){return {productId:p.docId,sku:p.sku,targetStock:p.availableStock};}),note:'僅預覽；尚未連接後端平台API',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION}); await writeAudit('建立平台同步預覽','syncJob',ref.id,jobNo+'｜'+eligible.length+'項'); toast('同步預覽已建立',jobNo,'success'); await loadAll(true);
  }

  function downloadBlob(filename,content,type){
    const blob=new Blob([content],{type:type||'text/plain;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){URL.revokeObjectURL(url);},500);
  }
  function csvCell(value){ const text=clean(value).replace(/"/g,'""'); return '"'+text+'"'; }
  function downloadProductTemplate(){
    const header=['internalSku','internalName','barcode','storePrice','latestPurchaseCost','averageCost','currentStock','reservedStock','safetyStock','brand','category','note'];
    const rows=state.catalog.filter(function(p){return p.initialized;}).map(function(p){const i=p.internal||{};return [p.sku,p.name,i.barcode||'',p.storePrice==null?'':p.storePrice,p.latestPurchaseCost==null?'':p.latestPurchaseCost,p.averageCost==null?'':p.averageCost,p.currentStock,p.reservedStock,p.safetyStock,p.brand,p.category,i.note||''];});
    const csv='\uFEFF'+[header].concat(rows).map(function(r){return r.map(csvCell).join(',');}).join('\r\n'); downloadBlob('營運中心_商品主檔匯入範本_'+dateText(new Date())+'.csv',csv,'text/csv;charset=utf-8');
  }
  function exportBackup(){
    const payload={exportedAt:new Date().toISOString(),version:VERSION,projectId:(global.APP_CONFIG&&APP_CONFIG.FIREBASE_CONFIG&&APP_CONFIG.FIREBASE_CONFIG.projectId)||'',onlineSource:state.onlineSource,data:{internalProducts:state.internalProducts,sales:state.sales,incomes:state.incomes,purchases:state.purchases,inventoryTransactions:state.inventory,rentalLedgers:state.rentalLedgers,cases:state.cases,expenses:state.expenses,syncJobs:state.syncJobs,auditLogs:state.audit}};
    downloadBlob('全通路營運中心_備份_'+dateText(new Date())+'.json',JSON.stringify(payload,null,2),'application/json;charset=utf-8'); toast('備份已下載','請妥善保存 JSON 檔。','success');
  }
  function exportFinance(){
    const sales=rangeRows(state.sales,function(x){return x.soldAt;}); const incomes=rangeRows(state.incomes,function(x){return x.occurredAt;}); const expenses=rangeRows(state.expenses,function(x){return x.occurredAt;}); const rows=[['日期','類型','編號／類別','收入','成本／支出','付款方式','備註']];
    sales.forEach(function(x){rows.push([dateTimeText(x.soldAt),'現場銷售',x.saleNo,x.total,x.costTotal,x.paymentMethod,x.note]);}); incomes.forEach(function(x){rows.push([dateTimeText(x.occurredAt),'快速收入',x.category,x.amount,0,x.paymentMethod,x.note]);}); expenses.forEach(function(x){rows.push([dateTimeText(x.occurredAt),'一般支出',x.category,0,x.amount,x.paymentMethod,x.note]);});
    const csv='\uFEFF'+rows.map(function(r){return r.map(csvCell).join(',');}).join('\r\n'); downloadBlob('營運中心_收支報表_'+state.financeRange+'_'+dateText(new Date())+'.csv',csv,'text/csv;charset=utf-8');
  }

  function openImport(){
    state.importRows=[]; state.importFileName='';
    openDrawer('Excel／CSV 匯入商品主檔','先在瀏覽器預覽；確認後才寫入 opsInternalProducts。','<div class="ops-callout">支援欄位：SKU／商品編號、商品名稱、門市售價、進貨成本、平均成本、現有庫存、保留庫存、安全庫存、品牌、分類、備註。</div><label class="ops-file-drop" id="importDrop"><input type="file" id="importFile" accept=".xlsx,.xls,.csv"><b>點這裡選擇 Excel 或 CSV</b><p>檔案只在瀏覽器解析，預覽確認前不會寫入 Firebase。</p></label><div id="importPreview" style="margin-top:14px"></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="button" data-action="confirm-import" id="confirmImportBtn" disabled>確認匯入</button></div>');
  }
  function normalizedHeader(value){ return lower(value).replace(/[\s_\-\/（）()]/g,''); }
  function importValue(row,names){
    const keys=Object.keys(row||{}); for(const name of names){ const wanted=normalizedHeader(name); const key=keys.find(function(k){return normalizedHeader(k)===wanted;}); if(key!==undefined&&hasValue(row[key])) return row[key]; } return '';
  }
  async function parseImportFile(file){
    if(!file) return; state.importFileName=file.name; const buffer=await file.arrayBuffer(); let rows=[];
    if(global.XLSX){ const wb=XLSX.read(buffer,{type:'array',cellDates:true}); const ws=wb.Sheets[wb.SheetNames[0]]; rows=XLSX.utils.sheet_to_json(ws,{defval:''}); }
    else throw new Error('Excel解析元件尚未載入');
    state.importRows=rows.map(function(row,index){
      const sku=normalizeCode(importValue(row,['internalSku','sku','商品編號','內部商品編號','code'])); const name=clean(importValue(row,['internalName','name','商品名稱','品名']));
      return {row:index+2,internalSku:sku,internalName:name,barcode:clean(importValue(row,['barcode','條碼'])),storePrice:numberOrNull(importValue(row,['storePrice','salePrice','門市售價','售價'])),latestPurchaseCost:numberOrNull(importValue(row,['latestPurchaseCost','purchasePrice','進貨成本','最近進貨成本'])),averageCost:numberOrNull(importValue(row,['averageCost','平均成本','移動平均成本'])),currentStock:numberOrNull(importValue(row,['currentStock','stock','庫存','現有庫存'])),reservedStock:numberOrNull(importValue(row,['reservedStock','保留庫存'])),safetyStock:numberOrNull(importValue(row,['safetyStock','安全庫存','最低庫存'])),brand:clean(importValue(row,['brand','品牌'])),category:clean(importValue(row,['category','分類'])),note:clean(importValue(row,['note','remark','備註']))};
    }).filter(function(r){return r.internalSku||r.internalName;});
    const valid=state.importRows.filter(function(r){return r.internalSku&&r.internalName;}); const invalid=state.importRows.length-valid.length;
    html('importPreview','<div class="ops-summary-list"><div class="ops-summary-line"><span>檔案</span><b>'+escapeHtml(file.name)+'</b></div><div class="ops-summary-line"><span>讀取列數</span><b>'+state.importRows.length+'</b></div><div class="ops-summary-line"><span>有效列</span><b>'+valid.length+'</b></div><div class="ops-summary-line"><span>缺少 SKU 或名稱</span><b>'+invalid+'</b></div></div>'+(valid.length?'<div class="ops-table-wrap" style="margin-top:12px"><table class="ops-table"><thead><tr><th>列</th><th>SKU</th><th>商品名稱</th><th class="num">庫存</th><th class="num">成本</th></tr></thead><tbody>'+valid.slice(0,20).map(function(r){return '<tr><td>'+r.row+'</td><td>'+escapeHtml(r.internalSku)+'</td><td>'+escapeHtml(r.internalName)+'</td><td class="num">'+formatNumber(r.currentStock)+'</td><td class="num">'+money(r.averageCost!=null?r.averageCost:r.latestPurchaseCost)+'</td></tr>';}).join('')+'</tbody></table></div>':''));
    const btn=byId('confirmImportBtn'); if(btn) btn.disabled=!valid.length;
  }
  async function importProducts(){
    const rows=state.importRows.filter(function(r){return r.internalSku&&r.internalName;}); if(!rows.length) return; const yes=await confirmAction('確認匯入商品主檔','將新增或更新 '+rows.length+' 筆 opsInternalProducts。相同 SKU 會更新內部欄位；原網路商品不會修改。','開始匯入'); if(!yes) return;
    const bySku=new Map(state.internalProducts.filter(function(x){return x.internalSku;}).map(function(x){return [x.internalSku,x];}));
    try{
      for(let start=0;start<rows.length;start+=BATCH_SIZE){ const batch=state.db.batch(); rows.slice(start,start+BATCH_SIZE).forEach(function(r){ const existing=bySku.get(r.internalSku); const id=existing?existing.docId:('manual_'+hashText(r.internalSku)); const payload={internalSku:r.internalSku,internalName:r.internalName,barcode:r.barcode,storePrice:r.storePrice,latestPurchaseCost:r.latestPurchaseCost,averageCost:r.averageCost!=null?r.averageCost:r.latestPurchaseCost,currentStock:r.currentStock!=null?r.currentStock:(existing?existing.currentStock:0),reservedStock:r.reservedStock!=null?r.reservedStock:(existing?existing.reservedStock:0),safetyStock:r.safetyStock!=null?r.safetyStock:(existing?existing.safetyStock:0),brand:r.brand,category:r.category,note:r.note,status:'active',enabled:true,source:'excelImport',updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION}; if(!existing){payload.createdAt=serverTimestamp();payload.createdBy=userLabel();} batch.set(state.db.collection(COLLECTIONS.products).doc(id),payload,{merge:true}); }); await batch.commit(); }
      await state.db.collection(COLLECTIONS.imports).add({type:'excelImport',fileName:state.importFileName,count:rows.length,status:'completed',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION}); await writeAudit('Excel 匯入商品主檔','productImport','',state.importFileName+'｜'+rows.length+' 筆'); closeDrawer(); toast('匯入完成','共處理 '+rows.length+' 筆商品。','success'); await loadAll(true);
    }catch(error){ toast('匯入失敗',errorMessage(error),'error'); }
  }

  function handleAction(action,el){
    if(action==='refresh') return loadAll(false);
    if(action==='drawer-close') return closeDrawer();
    if(action==='auto-init-products') return autoInitProducts();
    if(action==='product-edit') return openProductEdit(el.dataset.id);
    if(action==='product-detail') return openProductDetail(el.dataset.id);
    if(action==='load-more-products'){state.productVisible+=PRODUCT_PAGE_SIZE;return render();}
    if(action==='cart-add') return addCartProduct(el.dataset.id);
    if(action==='cart-remove'){state.cart.splice(Number(el.dataset.index),1);return render();}
    if(action==='cart-clear'){state.cart=[];return render();}
    if(action==='checkout') return checkoutDrawer();
    if(action==='open-quick-income') return openQuickIncome();
    if(action==='show-sales-history') return openSalesHistory();
    if(action==='open-purchase') return openPurchase();
    if(action==='purchase-this') return openPurchase(el.dataset.id);
    if(action==='purchase-add-row'){const box=byId('purchaseItems'); if(box) box.insertAdjacentHTML('beforeend',purchaseRowHtml('',queryAll('.purchase-row',box).length)); return;}
    if(action==='purchase-remove-row'){const row=el.closest('.purchase-row'); if(row&&queryAll('.purchase-row').length>1)row.remove();return;}
    if(action==='open-adjustment') return openAdjustment();
    if(action==='rental-edit') return openRentalEdit(el.dataset.id);
    if(action==='case-new') return openCase();
    if(action==='case-edit') return openCase(el.dataset.id);
    if(action==='expense-new') return openExpense();
    if(action==='create-sync-preview') return createSyncPreview();
    if(action==='export-backup') return exportBackup();
    if(action==='export-finance') return exportFinance();
    if(action==='download-product-template') return downloadProductTemplate();
    if(action==='open-import') return openImport();
    if(action==='confirm-import') return importProducts();
  }
  async function handleSubmit(form){
    const submit=query('[type="submit"]',form); if(submit) submit.disabled=true;
    try{
      if(form.id==='productForm') await saveProduct(form);
      else if(form.id==='checkoutForm') await saveCheckout(form);
      else if(form.id==='quickIncomeForm') await saveQuickIncome(form);
      else if(form.id==='purchaseForm') await savePurchase(form);
      else if(form.id==='adjustmentForm') await saveAdjustment(form);
      else if(form.id==='rentalLedgerForm') await saveRentalLedger(form);
      else if(form.id==='caseForm') await saveCase(form);
      else if(form.id==='expenseForm') await saveExpense(form);
    }catch(error){ toast('無法儲存',errorMessage(error),'error'); if(submit) submit.disabled=false; }
  }

  function rerenderKeepingFocus(id,value){
    render();
    setTimeout(function(){
      const input=byId(id);
      if(input){ input.focus(); const len=clean(value).length; try{input.setSelectionRange(len,len);}catch(err){} }
    },0);
  }
  function updateCartTotals(){
    const subtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;});
    const cost=sum(state.cart,function(x){return x.qty*x.averageCost;});
    setText('cartSubtotal',money(subtotal)); setText('cartCost',money(cost));
  }

  function bindEvents(){
    document.addEventListener('click',function(event){
      const nav=event.target.closest('[data-nav]'); if(nav){event.preventDefault();location.hash=nav.dataset.nav;return;}
      const actionEl=event.target.closest('[data-action]'); if(actionEl){event.preventDefault();handleAction(actionEl.dataset.action,actionEl);return;}
      const navLink=event.target.closest('#opsNav a[data-view]'); if(navLink){ closeMobileMenu(); }
    });
    document.addEventListener('submit',function(event){const form=event.target.closest('form'); if(!form)return; event.preventDefault();handleSubmit(form);});
    document.addEventListener('input',function(event){
      if(event.target.id==='productSearch'){state.productSearch=event.target.value;state.productVisible=PRODUCT_PAGE_SIZE;rerenderKeepingFocus('productSearch',state.productSearch);}
      else if(event.target.id==='posSearch'){state.posSearch=event.target.value;rerenderKeepingFocus('posSearch',state.posSearch);}
      else if(event.target.id==='rentalSearch'){state.rentalSearch=event.target.value;rerenderKeepingFocus('rentalSearch',state.rentalSearch);}
      else if(event.target.id==='caseSearch'){state.caseSearch=event.target.value;rerenderKeepingFocus('caseSearch',state.caseSearch);}
      else if(event.target.id==='inventorySearch'){state.inventorySearch=event.target.value;rerenderKeepingFocus('inventorySearch',state.inventorySearch);}
      else if(event.target.matches('[data-cart-qty]')){const item=state.cart[Number(event.target.dataset.cartQty)];if(item){item.qty=Math.max(1,Math.round(Number(event.target.value||1)));updateCartTotals();}}
      else if(event.target.matches('[data-cart-price]')){const item=state.cart[Number(event.target.dataset.cartPrice)];if(item){item.unitPrice=Math.max(0,Number(event.target.value||0));updateCartTotals();}}
    });
    document.addEventListener('change',function(event){
      if(event.target.id==='productFilter'){state.productFilter=event.target.value;state.productVisible=PRODUCT_PAGE_SIZE;render();}
      else if(event.target.id==='productSort'){state.productSort=event.target.value;render();}
      else if(event.target.id==='financeRange'){state.financeRange=event.target.value;render();}
      else if(event.target.id==='importFile'){parseImportFile(event.target.files&&event.target.files[0]).catch(function(error){toast('檔案解析失敗',errorMessage(error),'error');});}
    });
    global.addEventListener('hashchange',function(){render();closeMobileMenu();});
    byId('opsRefreshBtn').addEventListener('click',function(){loadAll(false);});
    byId('opsBackBtn').addEventListener('click',function(){history.back();});
    byId('opsLogoutBtn').addEventListener('click',function(){ if(typeof global.logout==='function')global.logout();else location.href='index.html'; });
    byId('opsDrawerClose').addEventListener('click',closeDrawer); byId('opsDrawerBackdrop').addEventListener('click',closeDrawer);
    byId('opsConfirmClose').addEventListener('click',function(){closeConfirm(false);}); byId('opsConfirmCancel').addEventListener('click',function(){closeConfirm(false);}); byId('opsConfirmOk').addEventListener('click',function(){closeConfirm(true);});
    byId('opsMenuBtn').addEventListener('click',openMobileMenu);
    document.addEventListener('keydown',function(event){if(event.key==='Escape'){closeDrawer();closeConfirm(false);closeMobileMenu();}});
  }
  function openMobileMenu(){ byId('opsSidebar').classList.add('open'); let overlay=query('.ops-mobile-overlay'); if(!overlay){overlay=document.createElement('div');overlay.className='ops-mobile-overlay';overlay.addEventListener('click',closeMobileMenu);document.body.appendChild(overlay);} overlay.classList.add('open'); }
  function closeMobileMenu(){ const sidebar=byId('opsSidebar'); if(sidebar)sidebar.classList.remove('open'); const overlay=query('.ops-mobile-overlay'); if(overlay)overlay.classList.remove('open'); }

  function initDb(){
    const cfg=global.APP_CONFIG&&global.APP_CONFIG.FIREBASE_CONFIG; if(!cfg||!cfg.projectId) throw new Error('找不到 Firebase 設定'); if(!global.firebase||!global.firebase.firestore) throw new Error('Firebase Firestore SDK 尚未載入'); if(!global.firebase.apps.length)global.firebase.initializeApp(cfg); return global.firebase.firestore();
  }
  async function init(){
    if(typeof global.fillHeader==='function')global.fillHeader();
    const user=typeof global.requireLogin==='function'?global.requireLogin():null; if(!user)return;
    if(typeof global.hasSettingsZoneAccess==='function'&&!global.hasSettingsZoneAccess(user)){location.href='dashboard.html';return;}
    if(typeof global.setPortalMode==='function')global.setPortalMode('settings');
    state.user=user; setText('opsUserChip',userLabel());
    try{state.db=initDb();}catch(error){showAlert(errorMessage(error),'error');html('opsContent',emptyHtml('Firebase初始化失敗',errorMessage(error)));return;}
    bindEvents(); render(); await loadAll(false);
  }

  global.OperationsCenterV1={init:init,reload:function(){return loadAll(false);},state:state};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
