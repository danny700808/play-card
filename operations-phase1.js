(function(global){
  'use strict';

  const ONLINE_COLLECTIONS = []; // V3：網路資料只由 EasyStore API 提供
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
    settings:'opsSettings',
    customers:'opsCustomers',
    points:'opsPointTransactions',
    receivables:'opsReceivables',
    receivablePayments:'opsReceivablePayments',
    salesReturns:'opsSalesReturns',
    educationDaily:'opsEducationDaily',
    platformOrders:'opsPlatformOrders',
    platformSyncRuns:'opsPlatformSyncRuns',
    platformSyncRequests:'opsPlatformSyncRequests',
    platformInventoryQueue:'opsPlatformInventoryQueue'
  };
  const READ_LIMIT = 10000;
  const BATCH_SIZE = 400;
  const PRODUCT_PAGE_SIZE = 24;
  const VERSION = '2026.07.12-v8.0-vps-central-inventory';
  const DASHBOARD_CACHE_KEY = 'youzi_ops_dashboard_overview_v5';
  const DASHBOARD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  const DEFAULT_MEMBERSHIP_SETTINGS = {
    enabled:true,
    rewardPercent:5,
    annualRules:{},
    redeemPoints:1,
    redeemAmount:1,
    minRedeemPoints:1,
    maxRedeemPercent:20,
    redemptionMode:'auto'
  };

const DEFAULT_PLATFORM_FEE_SETTINGS = {
  EasyStore:{enabled:true,commissionRate:0,paymentRate:0,monthlyFixedFee:0,monthlyAdvertisingFee:0,allocationMethod:'order_count'},
  MOMO:{enabled:true,commissionRate:13,paymentRate:0,monthlyFixedFee:0,monthlyAdvertisingFee:0,allocationMethod:'order_count'},
  Coupang:{enabled:true,commissionRate:13,paymentRate:0,monthlyFixedFee:0,monthlyAdvertisingFee:0,allocationMethod:'order_count'}
};


  const state = {
    user:null,
    db:null,
    view:'overview',
    loading:false,
    loadedAt:null,
    onlineSource:'EasyStore API',
    onlineProducts:[],
    easyStoreSync:{},
    injiaoyunCloudSync:{},
    injiaoyunCloudSyncSignature:'',
    injiaoyunCloudSyncUnsubscribe:null,
    onlineOrphans:[],
    matchingStats:{central:0,onlineRows:0,matched:0,unmatchedCentral:0,unmatchedOnline:0},
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
    customers:[],
    pointTransactions:[],
    receivables:[],
    receivablePayments:[],
    salesReturns:[],
    educationDaily:[],
    platformOrders:[],
    platformSyncRuns:[],
    platformFeeSettings:JSON.parse(JSON.stringify(DEFAULT_PLATFORM_FEE_SETTINGS)),
    diagnostics:[],
    productVisible:PRODUCT_PAGE_SIZE,
    productSearch:'',
    productFilter:'all',
    productSort:'image',
    productEditId:'',
    productPreviewImages:[],
    productPreviewIndex:0,
    productPreviewTitle:'',
    posSearch:'',
    salesMode:'product',
    selectedCustomerId:'',
    posCustomerMode:'walkin',
    posMemberSearch:'',
    posMemberPickerOpen:false,
    checkoutPaymentMethod:'現金',
    checkoutPaymentStatus:'paid',
    checkoutDiscount:0,
    checkoutPoints:0,
    checkoutPointsTouched:false,
    checkoutEarnPoints:true,
    checkoutReceived:'',
    incomeCategory:'未登錄商品',
    directIncomeAmount:'',
    saleInvoiceSearch:'',
    saleInvoiceFrom:'',
    saleInvoiceTo:'',
    membershipSettings:Object.assign({},DEFAULT_MEMBERSHIP_SETTINGS),
    cart:[],
    financeRange:'month',
    platformOrderRange:'month',
    platformOrderPlatform:'all',
    platformOrderSearch:'',
    rentalSearch:'',
    caseSearch:'',
    inventorySearch:'',
    customerSearch:'',
    receivableSearch:'',
    overviewRange:'today',
    overviewSearch:'',
    overviewFrom:'',
    overviewTo:'',
    overviewMonth:(function(){const now=new Date();return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');})(),
    injiaoyunRequestId:'',
    importRows:[],
    importFileName:'',
    importMode:'initial',
    importSummary:null,
    confirmResolve:null
  };

  const PAGE_META = {
    overview:['營運總覽',''],
    products:['商品庫存',''],
    sales:['門市銷售',''],
    customers:['客戶會員','會員、老師與一般客戶共用同一份客戶資料。'],
    receivables:['未收款','未收款會連回客戶與原始銷售。'],
    purchases:['進貨庫存',''],
    rentals:['租賃損益','沿用既有 rentalContracts，只在獨立帳冊補收款與直接成本。'],
    sync:['平台訂單',''],
    connection:['資料備份','']
  };

  function clean(value){ return String(value == null ? '' : value).trim(); }
  function lower(value){ return clean(value).toLowerCase(); }
  function displayOnlineName(value){ return clean(value).replace(/柚子樂器/g,'').replace(/^[\s｜|·・:：—-]+|[\s｜|·・:：—-]+$/g,'').replace(/\s{2,}/g,' ').trim(); }
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
  function pushUniqueImage(list,value){
    if(!value) return;
    if(Array.isArray(value)){ value.forEach(function(item){pushUniqueImage(list,item);}); return; }
    if(typeof value==='object'){
      const direct=firstValue(value,['src','url','imageUrl','original','large','medium','small','secure_url','downloadURL']);
      if(direct) pushUniqueImage(list,direct);
      ['images','photos','media','gallery'].forEach(function(key){if(value[key]) pushUniqueImage(list,value[key]);});
      return;
    }
    const url=safeUrl(value); if(url && !list.includes(url)) list.push(url);
  }
  function collectImageUrls(obj){
    const list=[]; obj=obj||{};
    ['variantImageUrl','variantImage','imageUrl','image','picture','cover','featuredImage','featured_image','mainImage','thumbnail','photo','圖片'].forEach(function(key){pushUniqueImage(list,obj[key]);});
    ['images','photos','media','gallery','imageUrls','additionalImages'].forEach(function(key){pushUniqueImage(list,obj[key]);});
    return list;
  }
  function productImage(obj){ return collectImageUrls(obj)[0]||''; }
  function arrayLike(value){
    if(Array.isArray(value)) return value;
    if(!value || typeof value!=='object') return [];
    if(Array.isArray(value.nodes)) return value.nodes;
    if(Array.isArray(value.edges)) return value.edges.map(function(x){return x&&x.node?x.node:x;});
    return Object.keys(value).map(function(key){return value[key];}).filter(function(x){return x&&typeof x==='object';});
  }
  function unwrapOnlineObject(obj){
    obj=obj||{};
    const nested=[obj.data,obj.product,obj.item,obj.payload,obj.result,obj.rawProduct,obj.rawData].filter(function(x){return x&&typeof x==='object'&&!Array.isArray(x);});
    if(!nested.length) return obj;
    let best=obj; let score=-1;
    [obj].concat(nested).forEach(function(candidate){
      const s=(hasValue(firstValue(candidate,['name','title','productName','itemName']))?5:0)+(hasValue(firstValue(candidate,['sku','SKU','productCode']))?4:0)+(arrayLike(candidate.variants||candidate.options||candidate.skus||candidate.variations).length?6:0)+(collectImageUrls(candidate).length?2:0);
      if(s>score){score=s;best=candidate;}
    });
    return Object.assign({},obj,best);
  }
  function onlineVariantList(obj){
    const keys=['variants','options','productVariants','skus','variations','children','variantList'];
    for(const key of keys){ const arr=arrayLike(obj&&obj[key]); if(arr.length) return arr; }
    return [];
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
      const normalized=/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)?text.replace(/\s+/,'T'):text;const d=/^\d{4}-\d{2}-\d{2}$/.test(normalized)?new Date(normalized+'T00:00:00'):new Date(normalized);
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
  function startOfDay(value){ const source=dateFrom(value);const d=source?new Date(source.getTime()):new Date();d.setHours(0,0,0,0);return d; }
  function endOfDay(value){ const source=dateFrom(value);const d=source?new Date(source.getTime()):new Date();d.setHours(23,59,59,999);return d; }
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

  function recursiveValuesByKeys(value,keys,depth,seen){
    depth=depth==null?0:depth; seen=seen||new Set(); if(value==null||depth>7) return [];
    if(typeof value!=='object') return [];
    if(seen.has(value)) return []; seen.add(value);
    const wanted=new Set(keys.map(function(k){return lower(k);})); const results=[];
    Object.keys(value).forEach(function(key){
      const child=value[key]; if(wanted.has(lower(key)) && child!==undefined && child!==null && clean(child)!=='') results.push(child);
      if(child&&typeof child==='object') results.push.apply(results,recursiveValuesByKeys(child,keys,depth+1,seen));
    });
    return results;
  }
  function recursiveFirstCode(obj){
    const vals=recursiveValuesByKeys(obj,['sku','SKU','code','productCode','itemCode','internalCode','variantSku','商品編號','貨號'],0,new Set());
    for(const value of vals){ const code=normalizeCode(value); if(code && code.length<=80) return code; }
    return '';
  }
  function recursiveVariantCandidates(obj){
    const result=[],seen=new Set();
    function walk(value,depth){
      if(!value||typeof value!=='object'||depth>7||seen.has(value)) return; seen.add(value);
      const code=recursiveFirstCode(value), imgs=collectImageUrls(value), name=decodeReadable(firstValue(value,['name','title','variantName','optionName','specification','規格']));
      if(code && (imgs.length||name||firstNumber(value,['price','salePrice','variantPrice']).found)) result.push(value);
      Object.keys(value).forEach(function(k){const child=value[k]; if(child&&typeof child==='object') walk(child,depth+1);});
    }
    walk(obj,0);
    const unique=[],codes=new Set(); result.forEach(function(v){const c=recursiveFirstCode(v); if(c&&!codes.has(c)){codes.add(c);unique.push(v);}}); return unique;
  }
  function normalizeOnlineBase(obj,collection,docId){
    obj=unwrapOnlineObject(obj||{});
    const price=firstNumber(obj,['price','marketPrice','salePrice','websiteOriginalPrice','regularPrice','variantPrice','compareAtPrice','官網價格','價格']);
    const stock=firstNumber(obj,['availableQuantity','availableStock','inventoryQuantity','stockQuantity','quantity','stock','inventory','庫存','庫存數量']);
    const name=decodeReadable(firstValue(obj,['name','title','itemName','productName','商品名稱']))||'未命名網路商品';
    const sku=normalizeCode(firstValue(obj,['sku','SKU','productCode','itemCode','internalCode','variantSku','商品編號','code','貨號']))||recursiveFirstCode(obj);
    const sourceId=clean(firstValue(obj,['productId','websiteProductId','itemId','id','__id']))||docId;
    const images=collectImageUrls(obj);
    return {
      id:sourceId,docId:docId,sourceKey:collection+'::'+docId,sourceCollection:collection,sourceProductId:sourceId,
      sourceVariantId:clean(firstValue(obj,['variantId','variationId','optionId'])),onlineName:name,sku:sku,
      onlinePrice:price.found?price.value:null,onlineStock:stock.found?stock.value:null,imageUrl:images[0]||'',imageUrls:images,
      url:safeUrl(firstValue(obj,['url','productUrl','websiteProductUrl','permalink','link','連結'])),
      brand:clean(firstValue(obj,['brand','vendor','manufacturer','品牌'])),category:clean(firstValue(obj,['category','productType','type','分類'])),
      variantName:decodeReadable(firstValue(obj,['variantSummary','optionsText','variantName','specification','規格'])),raw:obj
    };
  }
  function normalizeOnlineDoc(obj,collection,docId){
    const root=unwrapOnlineObject(obj||{}); const base=normalizeOnlineBase(root,collection,docId); let variants=onlineVariantList(root); if(!variants.length) variants=recursiveVariantCandidates(root);
    if(!variants.length) return [base];
    return variants.map(function(variant,index){
      variant=unwrapOnlineObject(variant||{});
      const row=normalizeOnlineBase(Object.assign({},root,variant),collection,docId+'::'+index);
      row.sourceKey=collection+'::'+docId+'::'+clean(firstValue(variant,['id','variantId','variationId','sku','name','title'])||index);
      row.sourceProductId=base.sourceProductId; row.sourceVariantId=clean(firstValue(variant,['id','variantId','variationId','optionId']))||row.sourceVariantId;
      row.onlineName=base.onlineName; row.sku=row.sku||normalizeCode(firstValue(variant,['sku','SKU','code','productCode','itemCode','variantSku','貨號']))||recursiveFirstCode(variant)||base.sku;
      row.onlinePrice=row.onlinePrice==null?base.onlinePrice:row.onlinePrice; row.onlineStock=row.onlineStock==null?base.onlineStock:row.onlineStock;
      const variantImages=collectImageUrls(variant), baseImages=(base.imageUrls||[]).slice();
      row.parentImageUrls=baseImages;
      row.variantImageUrls=variantImages;
      row.imageUrls=[]; baseImages.concat(variantImages).forEach(function(url){if(url&&!row.imageUrls.includes(url))row.imageUrls.push(url);});
      row.imageUrl=row.imageUrls[0]||base.imageUrl; row.url=row.url||base.url; row.brand=row.brand||base.brand; row.category=row.category||base.category;
      row.variantName=decodeReadable(firstValue(variant,['name','title','optionName','variantName','sku','optionsText']))||base.variantName;
      return row;
    });
  }
  function normalizeCostLayers(value){
    const rows=Array.isArray(value)?value:[];
    return rows.map(function(layer,index){
      const qty=numberOrNull(firstValue(layer||{},['qtyRemaining','remainingQty','qty','quantity']));
      const cost=numberOrNull(firstValue(layer||{},['unitCost','cost','purchasePrice']));
      return {layerId:clean(firstValue(layer||{},['layerId','id']))||('L'+index),qtyRemaining:qty==null?0:Math.max(0,qty),originalQty:numberOrNull(firstValue(layer||{},['originalQty','qty','quantity']))||Math.max(0,qty||0),unitCost:cost,costKnown:layer&&layer.costKnown!==false&&cost!=null,receivedAt:firstValue(layer||{},['receivedAt','date','createdAt'])||'',referenceType:clean(firstValue(layer||{},['referenceType','source']))||'unknown',referenceId:clean(firstValue(layer||{},['referenceId','sourceId']))};
    }).filter(function(layer){return layer.qtyRemaining>0;}).sort(function(a,b){return (dateFrom(a.receivedAt)||0)-(dateFrom(b.receivedAt)||0);});
  }
  function costLayerStats(raw){
    const current=Math.max(0,Number(raw&&raw.currentStock||0)); const layers=normalizeCostLayers(raw&&raw.costLayers);
    const trackedQty=sum(layers,function(x){return x.qtyRemaining;}); const knownValue=sum(layers,function(x){return x.costKnown&&x.unitCost!=null?x.qtyRemaining*x.unitCost:0;});
    const knownQty=sum(layers,function(x){return x.costKnown&&x.unitCost!=null?x.qtyRemaining:0;});
    const fallback=numberOrNull(firstValue(raw||{},['averageCost','latestPurchaseCost','purchasePrice']));
    const average=trackedQty>0 && knownQty===trackedQty ? knownValue/trackedQty : fallback;
    const first=layers.find(function(x){return x.qtyRemaining>0;}); const next=first&&first.unitCost!=null?first.unitCost:fallback;
    return {layers:layers,trackedQty:trackedQty,untrackedQty:Math.max(0,current-trackedQty),inventoryValue:knownValue+(Math.max(0,current-trackedQty)*(fallback||0)),averageCost:average,nextFifoCost:next,costIncomplete:(current>0&&(knownQty<trackedQty||trackedQty<current||next==null))};
  }
  function materializeCostLayers(raw){
    raw=raw||{}; const target=Math.max(0,Number(raw.currentStock||0)); let layers=normalizeCostLayers(raw.costLayers); let total=sum(layers,function(x){return x.qtyRemaining;});
    if(total<target){ const fallback=numberOrNull(firstValue(raw,['averageCost','latestPurchaseCost','purchasePrice'])); layers.push({layerId:'fallback_'+hashText(String(target)+'_'+String(fallback)),qtyRemaining:target-total,originalQty:target-total,unitCost:fallback,costKnown:fallback!=null,receivedAt:'1970-01-01T00:00:00.000Z',referenceType:'fallback',referenceId:'LEGACY'}); total=target; }
    if(total>target){ let extra=total-target; for(let i=layers.length-1;i>=0&&extra>0;i-=1){const take=Math.min(extra,layers[i].qtyRemaining);layers[i].qtyRemaining-=take;extra-=take;} layers=layers.filter(function(x){return x.qtyRemaining>0;}); }
    return layers;
  }
  function statsFromLayers(layers){
    layers=normalizeCostLayers(layers); const qty=sum(layers,function(x){return x.qtyRemaining;}); const knownQty=sum(layers,function(x){return x.costKnown&&x.unitCost!=null?x.qtyRemaining:0;}); const value=sum(layers,function(x){return x.costKnown&&x.unitCost!=null?x.qtyRemaining*x.unitCost:0;});
    return {layers:layers,qty:qty,inventoryValue:value,averageCost:qty>0&&knownQty===qty?value/qty:null,nextFifoCost:layers.length?layers[0].unitCost:null,costIncomplete:qty>knownQty};
  }
  function consumeFifo(raw,qty){
    qty=Math.max(0,Math.round(Number(qty||0))); const layers=materializeCostLayers(raw); let remaining=qty,costTotal=0,unknownQty=0; const breakdown=[];
    for(const layer of layers){ if(remaining<=0) break; const take=Math.min(remaining,layer.qtyRemaining); if(take<=0) continue; const unit=layer.unitCost; if(unit==null){unknownQty+=take;} else costTotal+=take*unit; breakdown.push({layerId:layer.layerId,qty:take,unitCost:unit,referenceId:layer.referenceId}); layer.qtyRemaining-=take; remaining-=take; }
    if(remaining>0) throw new Error('FIFO 成本層數量不足，請先重新整理商品庫存');
    const left=layers.filter(function(x){return x.qtyRemaining>0;}); const stats=statsFromLayers(left);
    return {costTotal:costTotal,unknownCostQty:unknownQty,breakdown:breakdown,layers:left,averageCost:stats.averageCost,nextFifoCost:stats.nextFifoCost,inventoryValue:stats.inventoryValue,costIncomplete:stats.costIncomplete||unknownQty>0};
  }
  function addFifoLayer(raw,qty,unitCost,meta){
    const layers=materializeCostLayers(raw); const receivedAt=(meta&&meta.receivedAt)||new Date().toISOString();
    layers.push({layerId:(meta&&meta.layerId)||uid('LAYER'),qtyRemaining:qty,originalQty:qty,unitCost:unitCost,costKnown:unitCost!=null,receivedAt:receivedAt,referenceType:(meta&&meta.referenceType)||'purchase',referenceId:(meta&&meta.referenceId)||''});
    const stats=statsFromLayers(layers); return {layers:stats.layers,averageCost:stats.averageCost,nextFifoCost:stats.nextFifoCost,inventoryValue:stats.inventoryValue,costIncomplete:stats.costIncomplete};
  }
  function adjustFifoLayers(raw,newStock,unitCost,meta){
    const oldStock=Number(raw&&raw.currentStock||0); newStock=Number(newStock||0);
    if(newStock===oldStock){const stats=costLayerStats(raw);return {layers:stats.layers,averageCost:stats.averageCost,nextFifoCost:stats.nextFifoCost,inventoryValue:stats.inventoryValue,costIncomplete:stats.costIncomplete,consumedCost:0};}
    if(newStock>oldStock){const add=Math.max(0,newStock-Math.max(0,oldStock));const added=addFifoLayer(raw,add,unitCost,meta);return Object.assign({consumedCost:0},added);}
    if(newStock<=0){return {layers:[],averageCost:null,nextFifoCost:null,inventoryValue:0,costIncomplete:false,consumedCost:0};}
    const consume=Math.max(0,Math.max(0,oldStock)-newStock); const result=consumeFifo(raw,consume); return {layers:result.layers,averageCost:result.averageCost,nextFifoCost:result.nextFifoCost,inventoryValue:result.inventoryValue,costIncomplete:result.costIncomplete,consumedCost:result.costTotal};
  }
  function normalizeInternal(obj,docId){
    const layers=normalizeCostLayers(obj.costLayers); const raw=Object.assign({},obj,{costLayers:layers}); const stats=costLayerStats(raw);
    return {
      docId:docId,sourceKey:clean(obj.sourceKey),sourceCollection:clean(obj.sourceCollection),sourceProductId:clean(obj.sourceProductId),sourceVariantId:clean(obj.sourceVariantId),
      internalSku:normalizeCode(firstValue(obj,['internalSku','sku','code','productCode','商品編號'])),barcode:clean(firstValue(obj,['barcode','ean','條碼'])),
      internalName:clean(firstValue(obj,['internalName','originalName','name','商品名稱'])),originalName:clean(firstValue(obj,['originalName','internalName','name'])),onlineName:clean(obj.onlineName),
      imageUrl:safeUrl(obj.imageUrl),imageUrls:Array.isArray(obj.imageUrls)?obj.imageUrls.map(safeUrl).filter(Boolean):[],parentImageUrls:Array.isArray(obj.parentImageUrls)?obj.parentImageUrls.map(safeUrl).filter(Boolean):[],variantImageUrls:Array.isArray(obj.variantImageUrls)?obj.variantImageUrls.map(safeUrl).filter(Boolean):[],onlineUrl:safeUrl(obj.onlineUrl),brand:clean(obj.brand),category:clean(obj.category),variantName:clean(obj.variantName),
      onlinePrice:numberOrNull(obj.onlinePrice),storePrice:numberOrNull(firstValue(obj,['storePrice','originalSalePrice','salePrice','retailPrice'])),originalSalePrice:numberOrNull(firstValue(obj,['originalSalePrice','storePrice','salePrice'])),
      latestPurchaseCost:numberOrNull(firstValue(obj,['latestPurchaseCost','referencePurchaseCost','purchaseCost','purchasePrice'])),averageCost:stats.averageCost!=null?stats.averageCost:numberOrNull(firstValue(obj,['averageCost','avgCost','movingAverageCost'])),
      nextFifoCost:stats.nextFifoCost,inventoryValue:stats.inventoryValue,costIncomplete:stats.costIncomplete,costLayers:layers,
      currentStock:numberOrNull(firstValue(obj,['currentStock','openingStock','onHand','stock']))||0,openingStock:numberOrNull(obj.openingStock),openingUnitCost:numberOrNull(obj.openingUnitCost),reservedStock:numberOrNull(firstValue(obj,['reservedStock','reserved']))||0,safetyStock:numberOrNull(firstValue(obj,['safetyStock','minStock']))||0,
      saleRewardPercent:numberOrNull(obj.saleRewardPercent),easyStoreMatched:obj.easyStoreMatched===true||clean(obj.sourceCollection)==='easyStoreApi',easyStoreSyncedAt:obj.easyStoreSyncedAt||'',status:clean(obj.status)||'active',note:clean(firstValue(obj,['note','remark','備註'])),enabled:obj.enabled!==false,autoCreated:obj.autoCreated===true,source:clean(obj.source),sourceFile:clean(obj.sourceFile),importInitialized:obj.importInitialized===true,createdAt:obj.createdAt||'',updatedAt:obj.updatedAt||''
    };
  }
  function onlineScore(row){return (row&&row.sku?30:0)+(row&&row.variantName?10:0)+(row&&row.imageUrls?row.imageUrls.length*4:0)+(row&&row.onlinePrice!=null?3:0);}
  function mergeCatalog(){
    const active=state.internalProducts.filter(function(x){return x.enabled!==false;});
    state.onlineProducts=[];
    state.onlineOrphans=[];
    state.catalog=active.map(function(internal){
      return Object.assign({online:null,internal:internal,docId:internal.docId},buildCatalogValues(null,internal));
    });
    const matched=active.filter(function(x){return x.easyStoreMatched===true || !!x.onlineName || (Array.isArray(x.imageUrls)&&x.imageUrls.length>0);}).length;
    state.matchingStats={central:active.length,onlineRows:Number(state.easyStoreSync.variantCount||0),matched:matched,unmatchedCentral:Math.max(0,active.length-matched),unmatchedOnline:Number(state.easyStoreSync.unmatchedApiSkuCount||0)};
  }
  function buildCatalogValues(online,internal){
    const originalName=(internal&&internal.internalName)||''; const onlineName=(online&&online.onlineName)||(internal&&internal.onlineName)||''; const display=originalName||onlineName||'未命名商品';
    const sku=(internal&&internal.internalSku)||(online&&online.sku)||''; const images=[];
    const parentImages=((online&&online.parentImageUrls)||(internal&&internal.parentImageUrls)||[]).map(safeUrl).filter(Boolean);
    const variantImages=((online&&online.variantImageUrls)||(internal&&internal.variantImageUrls)||[]).map(safeUrl).filter(Boolean);
    parentImages.concat(variantImages).concat((online&&online.imageUrls)||[]).concat((internal&&internal.imageUrls)||[]).concat([(online&&online.imageUrl)||(internal&&internal.imageUrl)||'']).forEach(function(url){url=safeUrl(url);if(url&&!images.includes(url))images.push(url);});
    const onlinePrice=online&&online.onlinePrice!=null?online.onlinePrice:(internal&&internal.onlinePrice!=null?internal.onlinePrice:null); const storePrice=internal&&internal.storePrice!=null?internal.storePrice:null;
    const current=internal?Number(internal.currentStock||0):0; const reserved=internal?Number(internal.reservedStock||0):0; const safety=internal?Number(internal.safetyStock||0):0; const available=Math.max(0,current-reserved-safety);
    const costForMargin=internal?(internal.nextFifoCost!=null?internal.nextFifoCost:internal.averageCost):null; const margin=(storePrice!=null&&costForMargin!=null&&storePrice!==0)?((storePrice-costForMargin)/storePrice*100):null;
    return {name:display,originalName:originalName,onlineName:onlineName,sku:sku,imageUrl:images[0]||'',imageUrls:images,parentImageUrls:parentImages,variantImageUrls:variantImages,onlinePrice:onlinePrice,storePrice:storePrice,originalSalePrice:internal?internal.originalSalePrice:null,averageCost:internal?internal.averageCost:null,nextFifoCost:internal?internal.nextFifoCost:null,latestPurchaseCost:internal?internal.latestPurchaseCost:null,inventoryValue:internal?internal.inventoryValue:0,costIncomplete:internal?internal.costIncomplete:false,currentStock:current,reservedStock:reserved,safetyStock:safety,availableStock:available,margin:margin,status:internal?internal.status:'preview',initialized:!!internal,matchedOnline:!!online||(internal&&internal.easyStoreMatched===true),sourceCollection:(online&&online.sourceCollection)||(internal&&internal.sourceCollection)||'',onlineUrl:(online&&online.url)||(internal&&internal.onlineUrl)||'',brand:(online&&online.brand)||(internal&&internal.brand)||'',category:(online&&online.category)||(internal&&internal.category)||'',variantName:(online&&online.variantName)||(internal&&internal.variantName)||'',saleRewardPercent:internal?internal.saleRewardPercent:null,negativeStock:current<0};
  }

  function saveDashboardCache(){
    const previousRange=state.overviewRange;
    try{
      state.overviewRange='today';
      const payload={
        savedAt:Date.now(),
        loadedAt:state.loadedAt?state.loadedAt.toISOString():new Date().toISOString(),
        html:renderOverviewV7()
      };
      localStorage.setItem(DASHBOARD_CACHE_KEY,JSON.stringify(payload));
    }catch(error){ console.warn('dashboard cache save failed',error); }
    finally{state.overviewRange=previousRange;}
  }
  function getDashboardCache(){
    try{
      const raw=localStorage.getItem(DASHBOARD_CACHE_KEY); if(!raw)return null;
      const data=JSON.parse(raw); if(!data||!data.html||!data.savedAt)return null;
      if(Date.now()-Number(data.savedAt)>DASHBOARD_CACHE_TTL_MS)return null;
      return data;
    }catch(error){return null;}
  }
  function showCachedDashboard(cache){
    state.view='overview';
    setText('opsPageTitle',PAGE_META.overview[0]);
    setText('opsPageSubtitle',PAGE_META.overview[1]);
    setText('opsLastReadText','快取資料：'+dateTimeText(cache.loadedAt||cache.savedAt));
    queryAll('#opsNav a[data-view]').forEach(function(a){ a.classList.toggle('active',a.dataset.view==='overview'); });
    html('opsContent','<div class="ops-callout"><b>已顯示上次整理結果。</b><br>為避免每次進首頁重讀 5,701 筆商品，系統會直接使用快取；需要最新數字時再按「重新讀取」。</div>'+cache.html);
    bindViewSpecific();
  }
  function ensureDataForCurrentView(){
    const view=(location.hash||'#overview').replace('#','').split('?')[0]||'overview';
    if(view!=='overview'&&!state.loadedAt&&!state.loading){ loadAll(false); return true; }
    return false;
  }

  async function getCollection(name,limit,orderField,orderDirection){
    const started=Date.now();
    try{
      let request=state.db.collection(name);
      if(orderField)request=request.orderBy(orderField,orderDirection||'desc');
      const snap=await request.limit(limit||READ_LIMIT).get();
      state.diagnostics.push({collection:name,ok:true,count:snap.size,ms:Date.now()-started});
      return snap.docs.map(function(doc){ return Object.assign({__id:doc.id},doc.data()||{}); });
    }catch(error){
      state.diagnostics.push({collection:name,ok:false,count:0,ms:Date.now()-started,error:errorMessage(error)});
      return [];
    }
  }
  async function loadOnlineProducts(){
    state.onlineSource='EasyStore API';
    state.onlineProducts=[];
    try{
      const doc=await state.db.collection('opsSettings').doc('easyStoreCatalogSync').get();
      state.easyStoreSync=doc.exists?(doc.data()||{}):{};
      state.diagnostics.push({collection:'opsSettings/easyStoreCatalogSync',ok:true,count:doc.exists?1:0,ms:0});
    }catch(error){
      state.easyStoreSync={};
      state.diagnostics.push({collection:'opsSettings/easyStoreCatalogSync',ok:false,count:0,ms:0,error:errorMessage(error)});
    }
  }
  async function loadMembershipSettings(){
    try{
      const doc=await state.db.collection(COLLECTIONS.settings).doc('membershipPoints').get();
      state.membershipSettings=Object.assign({},DEFAULT_MEMBERSHIP_SETTINGS,doc.exists?(doc.data()||{}):{});
      state.diagnostics.push({collection:COLLECTIONS.settings+'/membershipPoints',ok:true,count:doc.exists?1:0,ms:0});
    }catch(error){
      state.membershipSettings=Object.assign({},DEFAULT_MEMBERSHIP_SETTINGS);
      state.diagnostics.push({collection:COLLECTIONS.settings+'/membershipPoints',ok:false,count:0,ms:0,error:errorMessage(error)});
    }
  }
  async function loadInjiaoyunCloudSync(){
    try{
      const doc=await state.db.collection(COLLECTIONS.settings).doc('injiaoyunCloudSync').get();
      state.injiaoyunCloudSync=doc.exists?(doc.data()||{}):{};
      state.injiaoyunCloudSyncSignature=syncTimestampSignature(state.injiaoyunCloudSync.lastSucceededAt);
      state.diagnostics.push({collection:COLLECTIONS.settings+'/injiaoyunCloudSync',ok:true,count:doc.exists?1:0,ms:0});
    }catch(error){
      state.injiaoyunCloudSync={};
      state.diagnostics.push({collection:COLLECTIONS.settings+'/injiaoyunCloudSync',ok:false,count:0,ms:0,error:errorMessage(error)});
    }
  }
  function syncTimestampSignature(value){
    if(!value)return '';
    if(typeof value.toMillis==='function')return String(value.toMillis());
    if(value.seconds!=null)return String(value.seconds)+':'+String(value.nanoseconds||0);
    return String(value);
  }
  function watchInjiaoyunCloudSync(){
    if(state.injiaoyunCloudSyncUnsubscribe)return;
    let initialized=false;
    state.injiaoyunCloudSyncUnsubscribe=state.db.collection(COLLECTIONS.settings).doc('injiaoyunCloudSync').onSnapshot(function(doc){
      const next=doc.exists?(doc.data()||{}):{};
      const signature=syncTimestampSignature(next.lastSucceededAt);
      const changed=initialized&&next.status==='success'&&signature&&signature!==state.injiaoyunCloudSyncSignature;
      state.injiaoyunCloudSync=next;
      state.injiaoyunCloudSyncSignature=signature;
      initialized=true;
      if(changed&&!state.loading){
        try{localStorage.removeItem(DASHBOARD_CACHE_KEY);}catch(error){}
        toast('音教雲同步完成','營運資料已自動更新','success');
        loadAll(true);
      }
    },function(error){console.warn('音教雲同步狀態監聽失敗',error);});
  }

async function loadPlatformFeeSettings(){
  try{
    const snap=await state.db.collection(COLLECTIONS.settings).doc('platformFeeSettings').get();
    const raw=snap.exists?(snap.data()||{}):{},platforms=raw.platforms&&typeof raw.platforms==='object'?raw.platforms:{};
    const merged={};
    ['EasyStore','MOMO','Coupang'].forEach(function(name){merged[name]=Object.assign({},DEFAULT_PLATFORM_FEE_SETTINGS[name],platforms[name]||{});});
    state.platformFeeSettings=merged;
    state.diagnostics.push({collection:'opsSettings/platformFeeSettings',ok:true,count:snap.exists?1:0,ms:0});
  }catch(error){
    state.platformFeeSettings=JSON.parse(JSON.stringify(DEFAULT_PLATFORM_FEE_SETTINGS));
    state.diagnostics.push({collection:'opsSettings/platformFeeSettings',ok:false,count:0,ms:0,error:errorMessage(error)});
  }
}

  async function loadAll(silent){
    if(state.loading) return;
    state.loading=true; clearAlert();
    if(!silent) html('opsContent',loadingHtml('正在整理商品、庫存、銷售、租賃與案件資料…'));
    state.diagnostics=[];
    try{
      await Promise.all([loadOnlineProducts(),loadMembershipSettings(),loadInjiaoyunCloudSync(),loadPlatformFeeSettings()]);
      const results=await Promise.all([
        getCollection(COLLECTIONS.products,10000),
        getCollection('rentalContracts',1000),
        getCollection(COLLECTIONS.rentalLedgers,1000),
        getCollection(COLLECTIONS.sales,10000),
        getCollection(COLLECTIONS.incomes,1200),
        getCollection(COLLECTIONS.purchases,1200),
        getCollection(COLLECTIONS.inventory,10000),
        getCollection(COLLECTIONS.cases,1000),
        getCollection(COLLECTIONS.expenses,1200),
        getCollection(COLLECTIONS.syncJobs,500),
        getCollection(COLLECTIONS.audit,500),
        getCollection(COLLECTIONS.customers,3000),
        getCollection(COLLECTIONS.points,3000),
        getCollection(COLLECTIONS.receivables,3000),
        getCollection(COLLECTIONS.receivablePayments,3000),
        getCollection(COLLECTIONS.salesReturns,3000),
        getCollection(COLLECTIONS.educationDaily,3000,'businessDate','desc'),
        getCollection(COLLECTIONS.platformOrders,10000,'orderedAt','desc'),
        getCollection(COLLECTIONS.platformSyncRuns,500,'startedAt','desc')
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
      state.customers=results[11].map(normalizeCustomer);
      state.pointTransactions=results[12].map(normalizePointTransaction);
      state.receivables=results[13].map(normalizeReceivable);
      state.receivablePayments=results[14].map(normalizeReceivablePayment);
      state.salesReturns=results[15].map(normalizeSaleReturn);
      state.educationDaily=results[16].map(normalizeEducationDaily);
      state.platformOrders=results[17].map(normalizePlatformOrder);
      state.platformSyncRuns=results[18].map(normalizePlatformSyncRun);
      mergeCatalog();
      state.loadedAt=new Date();
      setText('opsLastReadText','最後讀取：'+dateTimeText(state.loadedAt));
      saveDashboardCache();
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
      incomeRecognizedAt:firstValue(obj,['rentalIncomeRecognizedAt','officialConfirmedAt','confirmedAt','officialPdfGeneratedAt']),
      incomeAmount:firstNumber(obj,['rentalIncomeAmount']).found?firstNumber(obj,['rentalIncomeAmount']).value:(firstNumber(obj,['rentFee','rentalFee','monthlyRent','租金']).value+firstNumber(obj,['shippingFee','deliveryFee','運費']).value),
      status:clean(firstValue(obj,['status','contractStatus','rentalStatus','狀態']))||'未設定',
      raw:obj
    };
  }
  function normalizeRentalLedger(obj){
    return {id:clean(obj.__id),rentalContractId:clean(firstValue(obj,['rentalContractId','contractId']))||clean(obj.__id),receivedAmount:firstNumber(obj,['receivedAmount']).value,deliveryCost:firstNumber(obj,['deliveryCost']).value,maintenanceCost:firstNumber(obj,['maintenanceCost']).value,otherCost:firstNumber(obj,['otherCost']).value,note:clean(obj.note),updatedAt:obj.updatedAt||''};
  }
  function normalizeSale(obj){
    const total=firstNumber(obj,['total']).value,status=clean(obj.paymentStatus)||'paid',received=firstNumber(obj,['receivedAmount']);
    return {id:clean(obj.__id),saleNo:clean(obj.saleNo)||clean(obj.__id),soldAt:obj.soldAt||obj.createdAt||'',items:Array.isArray(obj.items)?obj.items:[],subtotal:firstNumber(obj,['subtotal']).value,manualDiscount:firstNumber(obj,['manualDiscount']).found?firstNumber(obj,['manualDiscount']).value:firstNumber(obj,['discount']).value,pointDiscount:firstNumber(obj,['pointDiscount']).value,discount:firstNumber(obj,['discount']).value,total:total,costTotal:firstNumber(obj,['costTotal']).value,returnedCost:firstNumber(obj,['returnedCost']).value,returnStatus:clean(obj.returnStatus),grossProfit:firstNumber(obj,['grossProfit']).value,paymentMethod:clean(obj.paymentMethod),customerId:clean(obj.customerId),customerName:clean(obj.customerName),customerType:clean(obj.customerType),memberNo:clean(obj.memberNo),pricingTier:clean(obj.pricingTier),paymentStatus:status,receivedAmount:received.found?received.value:(status==='paid'?total:0),pointsEarned:firstNumber(obj,['pointsEarned']).value,pendingPointsEarned:firstNumber(obj,['pendingPointsEarned']).value,pointsRedeemed:firstNumber(obj,['pointsRedeemed']).value,earnPointsEnabled:obj.earnPointsEnabled!==false,note:clean(obj.note),status:clean(obj.status)||'completed',createdAt:obj.createdAt||''};
  }
  function normalizeCustomer(obj){return {id:clean(obj.__id),name:clean(obj.name)||'未命名客戶',phone:clean(obj.phone),email:clean(obj.email),customerType:clean(obj.customerType)||'general',memberNo:clean(obj.memberNo),pricingTier:clean(obj.pricingTier)||'retail',externalTeacherId:clean(obj.externalTeacherId),pointBalance:firstNumber(obj,['pointBalance']).value,creditLimit:firstNumber(obj,['creditLimit']).value,note:clean(obj.note),enabled:obj.enabled!==false,createdAt:obj.createdAt||'',updatedAt:obj.updatedAt||''};}
  function normalizePointTransaction(obj){return {id:clean(obj.__id),customerId:clean(obj.customerId),saleId:clean(obj.saleId),type:clean(obj.type),points:firstNumber(obj,['points']).value,balanceAfter:firstNumber(obj,['balanceAfter']).value,note:clean(obj.note),createdAt:obj.createdAt||''};}
  function normalizeReceivable(obj){const total=firstNumber(obj,['totalAmount']).value,received=firstNumber(obj,['receivedAmount']).value;return {id:clean(obj.__id),receivableNo:clean(obj.receivableNo)||clean(obj.__id),sourceType:clean(obj.sourceType)||(obj.incomeId?'income':'sale'),saleId:clean(obj.saleId),saleNo:clean(obj.saleNo),incomeId:clean(obj.incomeId),incomeNo:clean(obj.incomeNo),customerId:clean(obj.customerId),customerName:clean(obj.customerName)||'未指定客戶',totalAmount:total,receivedAmount:received,outstandingAmount:Math.max(0,firstNumber(obj,['outstandingAmount']).found?firstNumber(obj,['outstandingAmount']).value:total-received),status:clean(obj.status)||'unpaid',dueDate:obj.dueDate||'',createdAt:obj.createdAt||''};}
  function normalizeReceivablePayment(obj){return {id:clean(obj.__id),receivableId:clean(obj.receivableId),sourceType:clean(obj.sourceType),saleId:clean(obj.saleId),incomeId:clean(obj.incomeId),customerId:clean(obj.customerId),amount:firstNumber(obj,['amount']).value,paymentMethod:clean(obj.paymentMethod),paidAt:obj.paidAt||obj.createdAt||'',note:clean(obj.note)};}
  function normalizeSaleReturn(obj){return {id:clean(obj.__id),returnNo:clean(obj.returnNo)||clean(obj.__id),saleId:clean(obj.saleId),saleNo:clean(obj.saleNo),customerId:clean(obj.customerId),customerName:clean(obj.customerName),items:Array.isArray(obj.items)?obj.items:[],refundAmount:firstNumber(obj,['refundAmount']).value,restockedCost:firstNumber(obj,['restockedCost']).value,pointsRestored:firstNumber(obj,['pointsRestored']).value,pointsReversed:firstNumber(obj,['pointsReversed']).value,pointRecoveryAmount:firstNumber(obj,['pointRecoveryAmount']).value,createdAt:obj.createdAt||'',status:clean(obj.status)||'completed'};}
  function normalizeEducationDaily(obj){
    const summary=obj&&typeof obj.summary==='object'?obj.summary:{};
    return {
      id:clean(obj.__id),
      source:'injiaoyun',
      studioId:clean(obj.studioId),
      studioName:clean(obj.studioName),
      dateKey:clean(obj.dateKey),
      businessDate:obj.businessDate||clean(obj.dateKey),
      includeUnpaid:obj.includeUnpaid===true,
      sessions:Array.isArray(obj.sessions)?obj.sessions:[],
      teachers:Array.isArray(obj.teachers)?obj.teachers:[],
      tuitionReceipts:Array.isArray(obj.tuitionReceipts)?obj.tuitionReceipts:[],
      roomRentals:Array.isArray(obj.roomRentals)?obj.roomRentals:[],
      summary:{
        lessonCount:firstNumber(summary,['lessonCount']).value,
        lessonGross:firstNumber(summary,['lessonGross']).value,
        teacherPayable:firstNumber(summary,['teacherPayable']).value,
        schoolShare:firstNumber(summary,['schoolShare']).value,
        tuitionReceived:firstNumber(summary,['tuitionReceived']).value,
        roomRentalReceived:firstNumber(summary,['roomRentalReceived']).value
      },
      capturedAt:obj.capturedAt||'',
      importedAt:obj.importedAt||''
    };
  }
  function normalizeIncome(obj){
    return {id:clean(obj.__id),incomeNo:clean(obj.incomeNo)||clean(obj.__id),occurredAt:obj.occurredAt||obj.createdAt||'',category:clean(obj.category)||'其他收入',amount:firstNumber(obj,['amount']).value,paymentMethod:clean(obj.paymentMethod),paymentStatus:clean(obj.paymentStatus)||'paid',receivedAmount:firstNumber(obj,['receivedAmount']).found?firstNumber(obj,['receivedAmount']).value:firstNumber(obj,['amount']).value,customerId:clean(obj.customerId),customerName:clean(obj.customerName),note:clean(obj.note),createdAt:obj.createdAt||''};
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
  function normalizePlatformOrder(obj){
    return {
      id:clean(obj.__id),platform:clean(obj.platform),externalOrderId:clean(obj.externalOrderId),externalOrderNo:clean(obj.externalOrderNo)||clean(obj.externalOrderId),externalLineId:clean(obj.externalLineId),orderedAt:obj.orderedAt||obj.createdAt||'',sku:clean(obj.sku),productName:clean(obj.productName)||'未命名商品',variantName:clean(obj.variantName),quantity:firstNumber(obj,['quantity']).value,unitPrice:firstNumber(obj,['unitPrice']).value,grossAmount:firstNumber(obj,['grossAmount']).value,estimatedNetAmount:firstNumber(obj,['estimatedNetAmount']).value,costTotal:firstNumber(obj,['costTotal']).value,estimatedProfit:firstNumber(obj,['estimatedProfit']).value,orderStatus:clean(obj.orderStatus),paymentStatus:clean(obj.paymentStatus),customerName:clean(obj.customerName),processingStatus:clean(obj.processingStatus),inventoryApplied:obj.inventoryApplied===true,inventoryBefore:firstNumber(obj,['inventoryBefore']).value,inventoryAfter:firstNumber(obj,['inventoryAfter']).value,productId:clean(obj.productId),processingError:clean(obj.processingError),lastSeenAt:obj.lastSeenAt||'',syncRunId:clean(obj.syncRunId)
    };
  }
  function normalizePlatformSyncRun(obj){
    return {id:clean(obj.__id),runId:clean(obj.runId)||clean(obj.__id),trigger:clean(obj.trigger),status:clean(obj.status),startedAt:obj.startedAt||'',finishedAt:obj.finishedAt||'',summary:obj.summary&&typeof obj.summary==='object'?obj.summary:{},error:clean(obj.error)};
  }
  function normalizeAudit(obj){ return {id:clean(obj.__id),action:clean(obj.action),entityType:clean(obj.entityType),entityId:clean(obj.entityId),summary:clean(obj.summary),createdAt:obj.createdAt||'',createdBy:clean(obj.createdBy)}; }


function queueInventorySyncInTransaction(tx,productId,sku,stock,reason){const ref=state.db.collection(COLLECTIONS.platformInventoryQueue).doc(productId);tx.set(ref,{productId:productId,sku:clean(sku),targetStock:Number(stock||0),status:'pending',reason:clean(reason),updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});}

  async function writeAudit(action,entityType,entityId,summary){
    try{ await state.db.collection(COLLECTIONS.audit).add({action:action,entityType:entityType,entityId:entityId||'',summary:summary||'',createdBy:userLabel(),createdAt:serverTimestamp(),version:VERSION}); }catch(err){}
  }

  function kpi(title,value,sub,icon){
    return '<article class="ops-kpi"><div class="ops-kpi-head"><span>'+escapeHtml(title)+'</span><span class="ops-kpi-icon">'+escapeHtml(icon||'•')+'</span></div><strong>'+escapeHtml(value)+'</strong><small>'+escapeHtml(sub||'')+'</small></article>';
  }
  function kpiAction(title,value,sub,icon,action){
    return '<button type="button" class="ops-kpi ops-kpi-action" data-action="'+attr(action)+'"><div class="ops-kpi-head"><span>'+escapeHtml(title)+'</span><span class="ops-kpi-icon">'+escapeHtml(icon||'•')+'</span></div><strong>'+escapeHtml(value)+'</strong><small>'+escapeHtml(sub||'')+'</small></button>';
  }
  function render(){
    state.view=(location.hash||'#overview').replace('#','').split('?')[0]||'overview';
    if(!PAGE_META[state.view]) state.view='overview';
    const meta=PAGE_META[state.view]; setText('opsPageTitle',meta[0]); setText('opsPageSubtitle',meta[1]);
    queryAll('#opsNav a[data-view]').forEach(function(a){ a.classList.toggle('active',a.dataset.view===state.view); });
    const content=byId('opsContent'); if(!content) return;
    if(state.loading && !state.loadedAt){ content.innerHTML=loadingHtml(); return; }
    const renderers={overview:renderOverviewV7,products:renderProducts,sales:renderSalesV6,customers:renderCustomersV6,receivables:renderReceivablesV5,purchases:renderPurchases,rentals:renderRentals,sync:renderSync,connection:renderConnection};
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
  function overviewBounds(){
    const now=new Date();let start=null,end=null,label='今天';
    if(state.overviewRange==='today'){start=startOfDay(now);end=endOfDay(now);}
    else if(state.overviewRange==='month'){
      const currentKey=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
      const selected=/^\d{4}-(0[1-9]|1[0-2])$/.test(clean(state.overviewMonth))&&state.overviewMonth<=currentKey?state.overviewMonth:currentKey;
      const parts=selected.split('-').map(Number);state.overviewMonth=selected;
      start=new Date(parts[0],parts[1]-1,1);end=selected===currentKey?endOfDay(now):endOfDay(new Date(parts[0],parts[1],0));label=selected===currentKey?'本月':parts[0]+' 年 '+parts[1]+' 月';
    }
    else if(state.overviewRange==='year'){start=new Date(now.getFullYear(),0,1);end=endOfDay(new Date(now.getFullYear(),11,31));label='今年';}
    else{label='自訂區間';if(state.overviewFrom)start=new Date(state.overviewFrom+'T00:00:00');if(state.overviewTo)end=new Date(state.overviewTo+'T23:59:59');}
    return {start:start,end:end,label:label};
  }
  function renderOverview(){
    const bounds=overviewBounds();
    const sales=state.sales.filter(function(sale){const date=dateFrom(sale.soldAt);return date&&(!bounds.start||date>=bounds.start)&&(!bounds.end||date<=bounds.end);});
    let rows=[];
    sales.forEach(function(sale){(sale.items||[]).forEach(function(item){rows.push({date:sale.soldAt,saleNo:sale.saleNo,name:clean(item.name)||'未命名商品',sku:clean(item.sku),qty:Number(item.qty||1),amount:Number(item.lineTotal!=null?item.lineTotal:Number(item.qty||1)*Number(item.unitPrice||0)),cost:Number(item.lineCost||0)});});});
    const term=lower(state.overviewSearch).trim();
    if(term)rows=rows.filter(function(row){return lower([row.name,row.sku,row.saleNo].join(' ')).includes(term);});
    rows.sort(function(a,b){return (dateFrom(b.date)||0)-(dateFrom(a.date)||0);});
    const revenue=term?sum(rows,function(row){return row.amount;}):sum(sales,function(sale){return sale.total;});
    const cost=term?sum(rows,function(row){return row.cost;}):sum(sales,function(sale){return sale.costTotal;});
    const profit=revenue-cost;
    const qty=sum(rows,function(row){return row.qty;});
    const tabs='<div class="ops-range-tabs"><button class="'+(state.overviewRange==='today'?'active':'')+'" data-action="overview-range" data-range="today">今天</button><button class="'+(state.overviewRange==='month'?'active':'')+'" data-action="overview-range" data-range="month">月份</button><button class="'+(state.overviewRange==='year'?'active':'')+'" data-action="overview-range" data-range="year">今年</button><button class="'+(state.overviewRange==='custom'?'active':'')+'" data-action="overview-range" data-range="custom">自訂區間</button></div>';
    const monthPicker=state.overviewRange==='month'?'<div class="ops-range-custom"><label>查看月份<input class="ops-input" id="overviewMonth" type="month" max="'+attr(dateText(new Date()).slice(0,7))+'" value="'+attr(state.overviewMonth)+'"></label></div>':'';
    const custom=state.overviewRange==='custom'?'<div class="ops-range-custom"><label>開始日期<input class="ops-input" id="overviewFrom" type="date" value="'+attr(state.overviewFrom)+'"></label><label>結束日期<input class="ops-input" id="overviewTo" type="date" value="'+attr(state.overviewTo)+'"></label></div>':'';
    const list=rows.length?'<div class="ops-today-list">'+rows.map(function(row){return '<div class="ops-today-row"><div class="no-image">商品</div><div><b>'+escapeHtml(row.name)+'</b><small>'+escapeHtml((row.sku?'編號 '+row.sku+'・':'')+'數量 '+row.qty+'・'+dateTimeText(row.date))+'</small></div><strong>'+money(row.amount)+'</strong></div>';}).join('')+'</div>':emptyHtml('這段期間沒有商品銷售',term?'請更換搜尋文字。':'完成現場商品銷售後會顯示。');
    return tabs+monthPicker+custom+'<div class="ops-kpi-grid ops-today-kpis">'+kpi(bounds.label+'銷售收入',money(revenue),term?rows.length+' 個符合品項':sales.length+' 筆銷售','＄')+kpi('商品成本',money(cost),'已售商品成本','成本')+kpi(bounds.label+'賺多少',money(profit),'銷售收入－商品成本','↗')+kpi('賣出數量',formatNumber(qty),term?'符合目前搜尋':'全部賣出數量','件')+'</div><section class="ops-card"><div class="ops-card-head"><div><h2>'+bounds.label+'賣了什麼</h2></div><button class="ops-button small primary" data-nav="sales">前往銷售</button></div><input class="ops-input ops-overview-search" id="overviewSearch" placeholder="搜尋商品名稱、編號或銷售單號" value="'+attr(state.overviewSearch)+'">'+list+'</section>';
  }
  function renderOverviewV6(){
    const bounds=overviewBounds();
    function inRange(value){const date=dateFrom(value);return date&&(!bounds.start||date>=bounds.start)&&(!bounds.end||date<=bounds.end);}
    const sales=state.sales.filter(function(sale){return inRange(sale.soldAt);});
    const incomes=state.incomes.filter(function(income){return inRange(income.occurredAt);});
    const rentals=state.rentals.filter(function(rental){return inRange(rental.incomeRecognizedAt);});
    const returns=state.salesReturns.filter(function(row){return inRange(row.createdAt);});
    const educationRows=state.educationDaily.filter(function(row){return inRange(row.businessDate||row.dateKey);});
    let productRows=[];
    sales.forEach(function(sale){
      const saleSubtotal=Number(sale.subtotal||0)||sum(sale.items||[],function(item){return Number(item.lineTotal!=null?item.lineTotal:Number(item.qty||1)*Number(item.unitPrice||0));});
      const ratio=saleSubtotal>0?Math.max(0,Number(sale.total||0))/saleSubtotal:1;
      (sale.items||[]).forEach(function(item){
        const lineTotal=Number(item.lineTotal!=null?item.lineTotal:Number(item.qty||1)*Number(item.unitPrice||0));
        productRows.push({type:'product',date:sale.soldAt,no:sale.saleNo,name:clean(item.name)||'未命名商品',sku:clean(item.sku),qty:Number(item.qty||1),amount:lineTotal*ratio,cost:Number(item.lineCost||0)});
      });
    });
    let incomeRows=incomes.map(function(income){const repair=income.category==='維修收入';return {type:repair?'repair':'other',date:income.occurredAt,no:income.incomeNo,name:clean([income.category,income.customerName].filter(Boolean).join('｜'))||'其他收入',sku:'',qty:0,amount:Number(income.amount||0),cost:0};});
    let rentalRows=rentals.map(function(rental){return {type:'rental',date:rental.incomeRecognizedAt,no:rental.contractNo,name:clean([rental.customer,rental.equipment].filter(Boolean).join('｜'))||'租賃收益',sku:'',qty:0,amount:Number(rental.incomeAmount||0),cost:0};});
    const productRevenue=sum(productRows,function(row){return row.amount;});
    const repairRevenue=sum(incomeRows.filter(function(row){return row.type==='repair';}),function(row){return row.amount;});
    const otherRevenue=sum(incomeRows.filter(function(row){return row.type==='other';}),function(row){return row.amount;});
    const rentalRevenue=sum(rentalRows,function(row){return row.amount;});
    const revenue=productRevenue+repairRevenue+otherRevenue+rentalRevenue;
    const cost=Math.max(0,sum(productRows,function(row){return row.cost;})-sum(returns,function(row){return row.restockedCost||0;}));
    const profit=revenue-cost;
    const qty=sum(productRows,function(row){return row.qty;});
    const educationSessions=[];
    educationRows.forEach(function(row){(row.sessions||[]).forEach(function(session){educationSessions.push(session);});});
    const educationSummary={
      lessonCount:educationSessions.length,
      lessonGross:sum(educationSessions,function(session){return session.lessonPrice;}),
      teacherPayable:sum(educationSessions,function(session){return session.teacherAmount;}),
      schoolShare:sum(educationSessions,function(session){return hasValue(session.schoolShare)?session.schoolShare:Number(session.lessonPrice||0)-Number(session.teacherAmount||0);}),
      tuitionReceived:sum(educationRows,function(row){return row.summary.tuitionReceived;}),
      roomRentalReceived:sum(educationRows,function(row){return row.summary.roomRentalReceived;})
    };
    const teacherMap=new Map();
    educationSessions.forEach(function(session){
        const key=clean(session.teacherId)||clean(session.teacherName)||'未命名';
        const current=teacherMap.get(key)||{key:key,name:clean(session.teacherName)||'未命名老師',lessonCount:0,amount:0};
        current.lessonCount+=1;
        current.amount+=Number(session.teacherAmount||0);
        teacherMap.set(key,current);
    });
    const teacherRows=Array.from(teacherMap.values()).sort(function(a,b){return b.amount-a.amount;});
    const tabs='<div class="ops-range-tabs"><button class="'+(state.overviewRange==='today'?'active':'')+'" data-action="overview-range" data-range="today">今天</button><button class="'+(state.overviewRange==='month'?'active':'')+'" data-action="overview-range" data-range="month">月份</button><button class="'+(state.overviewRange==='year'?'active':'')+'" data-action="overview-range" data-range="year">今年</button><button class="'+(state.overviewRange==='custom'?'active':'')+'" data-action="overview-range" data-range="custom">自訂區間</button></div>';
    const monthPicker=state.overviewRange==='month'?'<div class="ops-range-custom"><label>查看月份<input class="ops-input" id="overviewMonth" type="month" max="'+attr(dateText(new Date()).slice(0,7))+'" value="'+attr(state.overviewMonth)+'"></label></div>':'';
    const custom=state.overviewRange==='custom'?'<div class="ops-range-custom"><label>開始日期<input class="ops-input" id="overviewFrom" type="date" value="'+attr(state.overviewFrom)+'"></label><label>結束日期<input class="ops-input" id="overviewTo" type="date" value="'+attr(state.overviewTo)+'"></label></div>':'';
    const teacherHtml=teacherRows.length?'<div class="ops-education-teachers">'+teacherRows.map(function(teacher){return '<button type="button" data-action="education-teacher-detail" data-teacher-key="'+attr(teacher.key)+'"><b>'+escapeHtml(teacher.name)+'</b><span>'+formatNumber(teacher.lessonCount)+' 堂</span><strong>'+money(teacher.amount)+'</strong></button>';}).join('')+'</div>':educationRows.length?emptyHtml('此期間沒有上課資料',''):emptyHtml('尚未匯入課務資料','請先在音教雲同步工具選擇月份並讀取，再回到這裡匯入。');
    const educationHtml='<section class="ops-card ops-education-section"><div class="ops-card-head"><div><h2>音教雲課務</h2></div><button class="ops-button primary" data-action="injiaoyun-import">匯入音教雲</button></div><div class="ops-kpi-grid ops-education-kpis">'+kpi('上課堂數',formatNumber(educationSummary.lessonCount),'','堂')+kpi('課堂金額',money(educationSummary.lessonGross),'','課')+kpi('課堂拆帳',money(educationSummary.teacherPayable),'','師')+kpi('教室保留',money(educationSummary.schoolShare),'','留')+kpi('學費實收',money(educationSummary.tuitionReceived),'','收')+kpi('教室租用',money(educationSummary.roomRentalReceived),'','租')+'</div>'+teacherHtml+'</section>';
    return tabs+monthPicker+custom+'<div class="ops-kpi-grid ops-today-kpis">'+kpi('商品銷售',money(productRevenue),'','＄')+kpi('維修收入',money(repairRevenue),'','修')+kpi('其他收入',money(otherRevenue),'','＋')+kpi('租賃收益',money(rentalRevenue),'','租')+kpi('總收入',money(revenue),'','合')+kpi('商品成本',money(cost),'','成本')+kpi(bounds.label+'賺多少',money(profit),'','↗')+kpi('賣出數量',formatNumber(qty),'','件')+'</div>'+educationHtml;
  }

function renderOverviewV7(){
  const bounds=overviewBounds();
  function inRange(value){const date=dateFrom(value);return date&&(!bounds.start||date>=bounds.start)&&(!bounds.end||date<=bounds.end);}
  const sales=state.sales.filter(function(sale){return inRange(sale.soldAt);});
  const incomes=state.incomes.filter(function(income){return inRange(income.occurredAt);});
  const rentals=state.rentals.filter(function(rental){return inRange(rental.incomeRecognizedAt);});
  const returns=state.salesReturns.filter(function(row){return inRange(row.createdAt);});
  const paymentsInRange=state.receivablePayments.filter(function(payment){return inRange(payment.paidAt);});
  const paymentBySale=new Map(),paymentByIncome=new Map();
  state.receivablePayments.forEach(function(payment){
    if(payment.saleId)paymentBySale.set(payment.saleId,Number(paymentBySale.get(payment.saleId)||0)+Number(payment.amount||0));
    if(payment.incomeId)paymentByIncome.set(payment.incomeId,Number(paymentByIncome.get(payment.incomeId)||0)+Number(payment.amount||0));
  });
  const productRevenue=sum(sales,function(sale){return Math.max(0,Number(sale.receivedAmount||0)-Number(paymentBySale.get(sale.id)||0));})+sum(paymentsInRange.filter(function(payment){return payment.saleId||payment.sourceType==='sale';}),function(payment){return payment.amount;});
  const incomeCash={repair:0,other:0,refund:0};
  function incomeKind(income){const category=clean(income&&income.category);if(category.includes('商品退貨退款'))return 'refund';if(category.includes('維修'))return 'repair';return 'other';}
  function addIncomeCash(income,amount){incomeCash[incomeKind(income)]+=Number(amount||0);}
  incomes.forEach(function(income){addIncomeCash(income,Number(income.receivedAmount||0)-Number(paymentByIncome.get(income.id)||0));});
  paymentsInRange.filter(function(payment){return payment.incomeId||payment.sourceType==='income';}).forEach(function(payment){addIncomeCash(state.incomes.find(function(income){return income.id===payment.incomeId;})||{},payment.amount);});
  const repairRevenue=incomeCash.repair,otherRevenue=incomeCash.other,returnRefund=Math.max(0,-incomeCash.refund);
  const rentalRevenue=sum(rentals,function(rental){return rental.incomeAmount;});
  const storeCash=productRevenue+repairRevenue+otherRevenue+rentalRevenue-returnRefund;
  const productCost=sum(sales,function(sale){return sale.costTotal;})-sum(returns,function(row){return row.restockedCost||0;});
  const storeBalance=storeCash-productCost;

  const educationRows=state.educationDaily.filter(function(row){return inRange(row.businessDate||row.dateKey);}),educationSessions=[];
  educationRows.forEach(function(row){(row.sessions||[]).forEach(function(session){educationSessions.push(session);});});
  const educationSummary={
    lessonCount:educationSessions.length,
    lessonGross:sum(educationSessions,function(session){return session.lessonPrice;}),
    teacherPayable:sum(educationSessions,function(session){return session.teacherAmount;}),
    schoolShare:sum(educationSessions,function(session){return hasValue(session.schoolShare)?session.schoolShare:Number(session.lessonPrice||0)-Number(session.teacherAmount||0);}),
    tuitionReceived:sum(educationRows,function(row){return row.summary.tuitionReceived;}),
    roomRentalReceived:sum(educationRows,function(row){return row.summary.roomRentalReceived;})
  };
  const educationCash=educationSummary.tuitionReceived+educationSummary.roomRentalReceived;
  const networkRows=state.platformOrders.filter(function(row){return row.inventoryApplied===true&&inRange(row.orderedAt);}),networkFeeMetrics=platformFeeMetrics(networkRows);
  const networkGross=networkFeeMetrics.gross;
  const networkNet=networkFeeMetrics.net;
  const networkCost=networkFeeMetrics.cost;
  const networkProfit=networkFeeMetrics.profit;
  const networkQty=sum(networkRows,function(row){return row.quantity;});
  const networkOrderCount=new Set(networkRows.map(function(row){return row.platform+'|'+row.externalOrderNo;})).size;
  const tabs='<div class="ops-range-tabs"><button class="'+(state.overviewRange==='today'?'active':'')+'" data-action="overview-range" data-range="today">今天</button><button class="'+(state.overviewRange==='month'?'active':'')+'" data-action="overview-range" data-range="month">月份</button><button class="'+(state.overviewRange==='year'?'active':'')+'" data-action="overview-range" data-range="year">今年</button><button class="'+(state.overviewRange==='custom'?'active':'')+'" data-action="overview-range" data-range="custom">自訂區間</button></div>';
  const monthPicker=state.overviewRange==='month'?'<div class="ops-range-custom"><label>查看月份<input class="ops-input" id="overviewMonth" type="month" max="'+attr(dateText(new Date()).slice(0,7))+'" value="'+attr(state.overviewMonth)+'"></label></div>':'';
  const custom=state.overviewRange==='custom'?'<div class="ops-range-custom"><label>開始日期<input class="ops-input" id="overviewFrom" type="date" value="'+attr(state.overviewFrom)+'"></label><label>結束日期<input class="ops-input" id="overviewTo" type="date" value="'+attr(state.overviewTo)+'"></label></div>':'';
  const sync=state.injiaoyunCloudSync||{};
  const syncRange=clean(sync.lastStartDateKey)&&clean(sync.lastEndDateKey)?clean(sync.lastStartDateKey)+'～'+clean(sync.lastEndDateKey):'';
  const syncText=sync.status==='success'&&sync.lastSucceededAt?'最後同步：'+dateTimeText(sync.lastSucceededAt)+(syncRange?'｜資料範圍：'+syncRange:''):'尚未取得自動同步紀錄';

  const allCash=storeCash+networkNet+educationCash,knownDirectCost=productCost+networkCost+educationSummary.teacherPayable,allBalance=allCash-knownDirectCost;
  const heroHtml='<section class="ops-card ops-overview-hero"><div class="ops-card-head"><div><h2>全部營運</h2></div></div>'+tabs+monthPicker+custom+'<div class="ops-kpi-grid ops-overview-total-grid">'+kpi('門市實收',money(storeCash),'','店')+kpi('網路預估入帳',money(networkNet),networkOrderCount+' 筆訂單','網')+kpi('補習班實收',money(educationCash),'','教')+kpi('目前營運收入',money(allCash),'','合')+kpi('已知直接成本',money(knownDirectCost),'','成本')+kpi('累計結餘',money(allBalance),'','結')+'</div></section>';
  const storeHtml='<section class="ops-card ops-overview-source ops-overview-store"><div class="ops-card-head"><div><h2>門市營運</h2></div><button class="ops-button soft" data-nav="sales">前往門市銷售</button></div><div class="ops-kpi-grid ops-overview-kpis">'+kpi('商品銷售',money(productRevenue),'','＄')+kpi('維修收入',money(repairRevenue),'','修')+kpi('其他收入',money(otherRevenue),'','＋')+kpi('租賃收益',money(rentalRevenue),'','租')+kpi('退貨退款',money(returnRefund),'','退')+kpi('門市實收',money(storeCash),'','收')+kpi('商品成本／退貨沖回',money(productCost),'','成本')+kpi('門市結餘',money(storeBalance),'','結')+'</div></section>';
  const networkHtml='<section class="ops-card ops-overview-source ops-overview-network-card"><div class="ops-card-head"><div><h2>網路營運</h2></div><button class="ops-button soft" data-nav="sync">前往平台訂單</button></div><div class="ops-kpi-grid ops-overview-network ops-overview-network-live">'+kpi('成交金額',money(networkGross),'三平台訂單總額','網')+kpi('預估平台入帳',money(networkNet),'成交金額 × 0.87','收')+kpi('商品成本',money(networkCost),'中央 FIFO 成本','成本')+kpi('預估毛利',money(networkProfit),'預估入帳－商品成本','利')+kpi('訂單數',formatNumber(networkOrderCount),'不重複訂單','單')+kpi('銷售件數',formatNumber(networkQty),'商品明細數量','件')+'</div></section>';
  const educationHtml='<section class="ops-card ops-education-section ops-overview-source ops-overview-education"><div class="ops-card-head"><div><h2>補習班營運</h2><p>'+escapeHtml(syncText)+'</p></div><button class="ops-button primary" data-action="injiaoyun-import">手動同步</button></div><div class="ops-kpi-grid ops-education-kpis">'+kpiAction('學費實收',money(educationSummary.tuitionReceived),'查看每筆收款','收','education-tuition-detail')+kpiAction('教室租用',money(educationSummary.roomRentalReceived),'查看每日租用','租','education-rental-detail')+kpiAction('老師拆帳',money(educationSummary.teacherPayable),'查看各老師拆帳','師','education-teacher-summary')+kpiAction('教室保留',money(educationSummary.schoolShare),'查看課程拆帳保留','留','education-school-share-detail')+'</div></section>';
  return heroHtml+storeHtml+networkHtml+educationHtml;
}

  function educationSessionTeacherKey(session){return clean(session&&session.teacherId)||clean(session&&session.teacherName)||'未命名';}
  function educationRowsInOverviewRange(){
    const bounds=overviewBounds();
    return state.educationDaily.filter(function(day){const value=dateFrom(day.businessDate||day.dateKey);return value&&(!bounds.start||value>=bounds.start)&&(!bounds.end||value<=bounds.end);});
  }
  function educationSessionsInOverviewRange(){
    const rows=[];educationRowsInOverviewRange().forEach(function(day){(day.sessions||[]).forEach(function(session){rows.push(session);});});return rows;
  }
  function educationDrawerRows(rows,emptyTitle,emptyText){
    return rows.length?rows:emptyHtml(emptyTitle,emptyText||'');
  }
  function openEducationTuitionDetail(){
    const rows=[];educationRowsInOverviewRange().forEach(function(day){(day.tuitionReceipts||[]).forEach(function(item){if(item.isRevenue!==false)rows.push(item);});});
    rows.sort(function(a,b){return (dateFrom(b.paidAt)||0)-(dateFrom(a.paidAt)||0);});
    const body=educationDrawerRows(rows.map(function(item){return '<article class="ops-education-session-row"><div class="ops-education-session-main"><span>'+escapeHtml(dateText(item.paidAt))+'</span><b>'+escapeHtml(item.studentName||'未命名學生')+'</b><em>'+escapeHtml(item.subject||'學費收款')+'</em></div><div><span>付款方式</span><b>'+escapeHtml(item.paymentMethod||'未標示')+'</b></div><div><span>實收金額</span><b>'+money(item.amount)+'</b></div></article>';}).join(''),'此期間沒有學費實收','');
    openDrawer('學費實收',overviewBounds().label+'｜學生實際繳費明細',body+'<div class="ops-drawer-footer"><button class="ops-button primary" type="button" data-action="drawer-close">關閉</button></div>');
  }
  function openEducationRentalDetail(){
    const rows=[];educationRowsInOverviewRange().forEach(function(day){(day.roomRentals||[]).forEach(function(item){rows.push(item);});});
    rows.sort(function(a,b){return (dateFrom(b.startAt)||0)-(dateFrom(a.startAt)||0);});
    const body=educationDrawerRows(rows.map(function(item){return '<article class="ops-education-session-row"><div class="ops-education-session-main"><span>'+escapeHtml(dateText(item.startAt))+'</span><b>'+escapeHtml(item.clientName||'未命名租用人')+'</b><em>'+escapeHtml(item.roomName||'教室租用')+'</em></div><div><span>租用金額</span><b>'+money(item.amount)+'</b></div></article>';}).join(''),'此期間沒有教室租用收入','');
    openDrawer('教室租用',overviewBounds().label+'｜每日教室租用明細',body+'<div class="ops-drawer-footer"><button class="ops-button primary" type="button" data-action="drawer-close">關閉</button></div>');
  }
  function openEducationTeacherSummary(){
    const teachers=new Map();educationSessionsInOverviewRange().forEach(function(session){const key=educationSessionTeacherKey(session),row=teachers.get(key)||{key:key,name:clean(session.teacherName)||'未命名老師',lessonCount:0,amount:0};row.lessonCount+=1;row.amount+=Number(session.teacherAmount||0);teachers.set(key,row);});
    const rows=Array.from(teachers.values()).sort(function(a,b){return b.amount-a.amount;});
    const body=educationDrawerRows(rows.map(function(row){return '<button type="button" class="ops-education-teacher-row" data-action="education-teacher-detail" data-teacher-key="'+attr(row.key)+'"><b>'+escapeHtml(row.name)+'</b><span>'+formatNumber(row.lessonCount)+' 堂</span><strong>'+money(row.amount)+'</strong></button>';}).join(''),'此期間沒有老師拆帳資料','');
    openDrawer('老師拆帳',overviewBounds().label+'｜點選老師可查看每堂課的拆帳',body+'<div class="ops-drawer-footer"><button class="ops-button primary" type="button" data-action="drawer-close">關閉</button></div>');
  }
  function openEducationSchoolShareDetail(){
    const rows=educationSessionsInOverviewRange().sort(function(a,b){return (dateFrom(b.occurredAt)||0)-(dateFrom(a.occurredAt)||0);});
    const body=educationDrawerRows(rows.map(function(session){const retained=hasValue(session.schoolShare)?Number(session.schoolShare):Number(session.lessonPrice||0)-Number(session.teacherAmount||0);const label=clean(session.subject)||clean(session.chargeName)||'未標示課程';return '<article class="ops-education-session-row"><div class="ops-education-session-main"><span>'+escapeHtml(dateText(session.occurredAt))+'</span><b>'+escapeHtml(session.studentName||'未命名學生')+'</b><em>'+escapeHtml(label)+'</em></div><div><span>單堂金額</span><b>'+money(session.lessonPrice)+'</b></div><div><span>老師拆帳</span><b>'+money(session.teacherAmount)+'</b></div><div><span>教室保留</span><b>'+money(retained)+'</b></div></article>';}).join(''),'此期間沒有課程拆帳資料','');
    openDrawer('教室保留',overviewBounds().label+'｜單堂金額扣除老師拆帳後的保留金額',body+'<div class="ops-drawer-footer"><button class="ops-button primary" type="button" data-action="drawer-close">關閉</button></div>');
  }
  function educationSplitText(session){
    const hourly=Number(session&&session.hourlyFee||0),rate=Number(session&&session.allotRate||0);
    if(hourly>0)return '固定 '+money(hourly);
    if(rate>0)return percentage(rate>1?rate:rate*100);
    return '未標示';
  }
  function openEducationTeacherDetail(teacherKey){
    const bounds=overviewBounds(),sessions=[];
    state.educationDaily.forEach(function(day){
      const businessDate=dateFrom(day.businessDate||day.dateKey);
      if(!businessDate||(bounds.start&&businessDate<bounds.start)||(bounds.end&&businessDate>bounds.end))return;
      (day.sessions||[]).forEach(function(session){if(educationSessionTeacherKey(session)===teacherKey)sessions.push(session);});
    });
    sessions.sort(function(a,b){return (dateFrom(a.occurredAt)||0)-(dateFrom(b.occurredAt)||0);});
    if(!sessions.length)return toast('找不到課堂資料','請重新整理後再試。','warning');
    const teacherName=clean(sessions[0].teacherName)||'未命名老師';
    const students=new Set(sessions.map(function(session){return clean(session.studentId)||clean(session.studentName);}).filter(Boolean));
    const lessonGross=sum(sessions,function(session){return session.lessonPrice;});
    const teacherShare=sum(sessions,function(session){return session.teacherAmount;});
    const schoolShare=sum(sessions,function(session){return hasValue(session.schoolShare)?session.schoolShare:Number(session.lessonPrice||0)-Number(session.teacherAmount||0);});
    const summary='<div class="ops-education-detail-summary"><div><span>堂數</span><b>'+formatNumber(sessions.length)+'</b></div><div><span>學生</span><b>'+formatNumber(students.size)+'</b></div><div><span>課堂金額</span><b>'+money(lessonGross)+'</b></div><div><span>老師拆帳</span><b>'+money(teacherShare)+'</b></div><div><span>教室保留</span><b>'+money(schoolShare)+'</b></div></div>';
    const rows='<div class="ops-education-session-list">'+sessions.map(function(session){
      const labels=[];if(clean(session.subject))labels.push(clean(session.subject));if(clean(session.chargeName)&&!labels.includes(clean(session.chargeName)))labels.push(clean(session.chargeName));
      const retained=hasValue(session.schoolShare)?Number(session.schoolShare):Number(session.lessonPrice||0)-Number(session.teacherAmount||0);
      return '<article class="ops-education-session-row"><div class="ops-education-session-main"><span>'+escapeHtml(dateText(session.occurredAt))+'</span><b>'+escapeHtml(session.studentName||'未命名學生')+'</b><em>'+escapeHtml(labels.join('｜')||'未標示課程')+'</em></div><div><span>單堂學費</span><b>'+money(session.lessonPrice)+'</b></div><div><span>拆帳方式</span><b>'+escapeHtml(educationSplitText(session))+'</b></div><div><span>老師分得</span><b>'+money(session.teacherAmount)+'</b></div><div><span>教室保留</span><b>'+money(retained)+'</b></div></article>';
    }).join('')+'</div>';
    openDrawer(teacherName,bounds.label+'課堂明細｜不含獎勵與扣薪',summary+rows+'<div class="ops-drawer-footer"><button class="ops-button primary" type="button" data-action="drawer-close">關閉</button></div>');
  }
  function productCompletenessHtml(){
    const total=state.catalog.length||1; const image=state.catalog.filter(function(p){return p.imageUrls&&p.imageUrls.length;}).length; const cost=state.catalog.filter(function(p){return p.averageCost!=null||p.nextFifoCost!=null;}).length; const matched=state.catalog.filter(function(p){return p.matchedOnline;}).length; const nonNegative=state.catalog.filter(function(p){return p.currentStock>=0;}).length;
    function row(label,count){return '<div class="ops-status-row"><div><b>'+escapeHtml(label)+'</b><small>'+count+' / '+state.catalog.length+'</small></div><div style="width:43%"><div class="ops-progress"><span style="width:'+Math.round(count/total*100)+'%"></span></div></div></div>';}
    return row('已配對 EasyStore／網路商品',matched)+row('有商品圖片',image)+row('已有成本資料',cost)+row('非負庫存資料',nonNegative);
  }

  function productFiltered(){
    const term=lower(state.productSearch); let rows=state.catalog.filter(function(p){
      if(term&&!lower([p.originalName,p.onlineName,p.sku,p.brand,p.category,p.variantName,p.docId].join(' ')).includes(term))return false;
      if(state.productFilter==='missing-cost'&&!(p.averageCost==null&&p.nextFifoCost==null))return false;
      if(state.productFilter==='low'&&!(p.currentStock<=p.safetyStock))return false;
      if(state.productFilter==='in-stock'&&p.currentStock<=0)return false;
      if(state.productFilter==='matched'&&!p.matchedOnline)return false;
      if(state.productFilter==='unmatched'&&p.matchedOnline)return false;
      if(state.productFilter==='no-image'&&p.imageUrls.length)return false;
      if(state.productFilter==='negative'&&p.currentStock>=0)return false;
      return true;
    });
    rows.sort(function(a,b){if(state.productSort==='image'){const imageDiff=Number(Boolean(b.imageUrls.length))-Number(Boolean(a.imageUrls.length));if(imageDiff)return imageDiff;return a.name.localeCompare(b.name,'zh-Hant');}if(state.productSort==='stock')return b.currentStock-a.currentStock;if(state.productSort==='cost')return (b.nextFifoCost||b.averageCost||0)-(a.nextFifoCost||a.averageCost||0);if(state.productSort==='price')return (b.storePrice||0)-(a.storePrice||0);if(state.productSort==='sku')return a.sku.localeCompare(b.sku,'zh-Hant',{numeric:true});return a.name.localeCompare(b.name,'zh-Hant');}); return rows;
  }
  function productCard(p){
    const allImages=Array.from(new Set((p.imageUrls||[]).concat(p.imageUrl?[p.imageUrl]:[]).filter(Boolean)));
    const parentImages=Array.from(new Set((p.parentImageUrls||[]).filter(Boolean)));
    const variantImages=Array.from(new Set((p.variantImageUrls||[]).filter(Boolean)));
    const mainImage=parentImages[0]||allImages[0]||'';
    const variantImage=variantImages.find(function(url){return url!==mainImage;})||allImages.find(function(url){return url!==mainImage;})||'';
    const urls=[mainImage,variantImage].filter(Boolean);
    const cleanOnline=displayOnlineName(p.onlineName)||displayOnlineName(p.originalName)||'未命名商品';
    const variant=clean(p.variantName);
    const imageHtml=urls.length?urls.map(function(url,index){return '<img loading="lazy" src="'+attr(url)+'" alt="'+attr(index===1&&variant?variant:cleanOnline)+'" onerror="this.style.display=\'none\'">';}).join(''):'<div class="placeholder">無圖</div>';
    const active=state.productEditId===p.docId?' active':'';
    return '<button type="button" class="ops-product-card ops-product-card-full'+active+'" data-action="product-edit" data-id="'+attr(p.docId)+'"><div class="ops-product-image-grid '+(urls.length<2?'single':'')+'">'+imageHtml+'</div><div class="ops-product-body"><div class="ops-product-sku-row"><b>'+escapeHtml(p.sku||'未設定')+'</b><span class="ops-product-inline-stock">庫存 <b>'+escapeHtml(formatNumber(p.currentStock))+'</b></span></div><div class="ops-product-name-rows"><b>'+escapeHtml(cleanOnline)+'</b></div>'+(variant?'<div class="ops-product-variant-row"><b>'+escapeHtml(variant)+'</b></div>':'')+'<div class="ops-product-detail-grid"><div><span>門市定價</span><b>'+money(p.storePrice)+'</b></div><div><span>網路售價</span><b>'+money(p.onlinePrice)+'</b></div><div><span>進貨成本</span><b>'+money(p.latestPurchaseCost)+'</b></div><div><span>平均成本</span><b>'+money(p.averageCost)+'</b></div></div></div></button>';
  }
  function renderProducts(){
    const rows=productFiltered(),visible=rows.slice(0,state.productVisible),central=state.matchingStats.central;
    const stockTotal=sum(state.catalog,function(p){return p.currentStock;});
    const inventoryValue=sum(state.catalog,function(p){return p.inventoryValue||0;});
    const low=state.catalog.filter(function(p){return p.initialized&&p.currentStock<=p.safetyStock;}).length;
    const editingProduct=state.productEditId&&state.productEditId!=='__new__'?catalogById(state.productEditId):null;
    const editorHtml=state.productEditId?productFormHtml(editingProduct)+renderProductPreviewModal():'';
    return '<div class="ops-kpi-grid">'+kpi('商品總數',formatNumber(central),'全部商品','▦')+kpi('庫存總件數',formatNumber(stockTotal),'目前庫存','庫')+kpi('低庫存／缺貨',formatNumber(low),'需要注意','!')+kpi('庫存成本總額',money(inventoryValue),'目前庫存成本','＄')+'</div><section class="ops-card ops-product-section"><div class="ops-card-head"><div><h2>商品庫存</h2></div><div class="ops-card-actions"><button class="ops-button primary" data-action="product-new">新增商品</button><button class="ops-button soft" data-action="sync-easystore-api">同步圖片</button><button class="ops-button soft" data-action="open-import">'+(central?'更新商品資料':'匯入商品資料')+'</button></div></div><div class="ops-toolbar"><input class="ops-input grow" id="productSearch" placeholder="搜尋名稱或商品編號" value="'+attr(state.productSearch)+'"><select class="ops-select" id="productFilter"><option value="all">全部商品</option><option value="unmatched">尚未配對</option><option value="no-image">沒有圖片</option><option value="missing-cost">缺少成本</option><option value="low">低庫存／缺貨</option><option value="in-stock">有庫存</option><option value="negative">負庫存</option></select><select class="ops-select" id="productSort"><option value="image">有圖片優先</option><option value="name">依名稱</option><option value="sku">依商品編號</option><option value="stock">依庫存</option><option value="cost">依成本</option><option value="price">依售價</option></select></div>'+editorHtml+(visible.length?'<div class="ops-products-grid">'+visible.map(productCard).join('')+'</div>'+(visible.length<rows.length?'<div class="ops-pagination"><button class="ops-button ghost" data-action="load-more-products">顯示更多</button></div>':''):emptyHtml(central?'找不到商品':'尚未建立商品',central?'請調整搜尋條件。':'請先新增商品或匯入商品資料。','<button class="ops-button primary" data-action="product-new">新增商品</button>'))+'</section>';
  }
  function renderProductPreviewModal(){
    const images=(state.productPreviewImages||[]).filter(Boolean);
    if(!images.length)return '';
    let index=Math.max(0,Math.min(images.length-1,Number(state.productPreviewIndex)||0));
    state.productPreviewIndex=index;
    const title=state.productPreviewTitle||'商品圖片';
    const navPrev=images.length>1?'<button type="button" class="ops-product-preview-nav prev" data-action="product-preview-prev">‹</button>':'';
    const navNext=images.length>1?'<button type="button" class="ops-product-preview-nav next" data-action="product-preview-next">›</button>':'';
    const thumbs=images.map(function(url,i){return '<button type="button" class="ops-product-preview-thumb'+(i===index?' active':'')+'" data-action="product-preview-select" data-index="'+i+'"><img src="'+attr(url)+'" alt="'+attr(title)+'"></button>';}).join('');
    return '<div class="ops-product-preview-overlay"><button type="button" class="ops-product-preview-backdrop" data-action="product-preview-close" aria-label="關閉圖片預覽"></button><div class="ops-product-preview-dialog"><button type="button" class="ops-product-preview-close" data-action="product-preview-close">×</button>'+navPrev+navNext+'<div class="ops-product-preview-stage"><img src="'+attr(images[index])+'" alt="'+attr(title)+'"></div><div class="ops-product-preview-count">'+(index+1)+' / '+images.length+'</div><div class="ops-product-preview-strip">'+thumbs+'</div></div></div>';
  }
  function productEditorImages(p){
    const base=[];
    ((p&&p.imageUrls)||[]).concat(p&&p.imageUrl?[p.imageUrl]:[]).forEach(function(url){url=safeUrl(url);if(url&&!base.includes(url))base.push(url);});
    return base.slice(0,4);
  }
  function productImagePanelHtml(p){
    const original=(p&&p.originalName)||(p&&p.name)||'商品圖片';
    const images=productEditorImages(p);
    if(!images.length){
      return '<div class="ops-product-media-panel"><div class="ops-product-media-main is-empty"><div class="ops-detail-no-image">尚無商品圖片</div></div></div>';
    }
    const main=images[0];
    const thumbs=images.map(function(url,index){return '<button type="button" class="ops-product-media-thumb'+(index===0?' active':'')+'" data-action="product-preview-open" data-index="'+index+'"><img src="'+attr(url)+'" alt="'+attr(original)+'"></button>';}).join('');
    return '<div class="ops-product-media-panel"><button type="button" class="ops-product-media-main" data-action="product-preview-open" data-index="0"><img src="'+attr(main)+'" alt="'+attr(original)+'"></button><div class="ops-product-media-hint">商品圖片（可點擊放大預覽）</div><div class="ops-product-media-thumbs">'+thumbs+'</div></div>';
  }
  function productFormHtml(p){
    const internal=p&&p.internal,avg=p&&p.averageCost;
    const isNew=!p;
    const displayName=(p&&((p.originalName)||(p.onlineName)||(p.name)))||'新增商品';
    const actionTitle=isNew?'新增商品':'編輯商品：'+displayName;
    return '<form id="productForm" data-id="'+attr(p?p.docId:'')+'"><section class="ops-inline-product-editor" id="opsProductEditor"><div class="ops-inline-product-header"><div><h3>'+escapeHtml(actionTitle)+'</h3>'+(p?'<div class="ops-inline-product-meta">SKU '+escapeHtml(p.sku||'未設定')+' ・ 庫存 '+escapeHtml(formatNumber(p.currentStock))+'</div>':'<div class="ops-inline-product-meta">先建立商品主檔，再進行庫存與成本管理。</div>')+'</div><div class="ops-card-actions"><button class="ops-button ghost" type="button" data-action="product-edit-cancel">取消編輯</button><button class="ops-button primary" type="submit">'+(isNew?'儲存商品':'儲存變更')+'</button></div></div><div class="ops-inline-product-layout"><div class="ops-inline-product-media">'+productImagePanelHtml(p)+'</div><div class="ops-inline-product-fields"><div class="ops-form-grid cols-3"><div class="ops-field"><label class="ops-required">SKU／商品編號</label><input class="ops-input" name="internalSku" value="'+attr((p&&p.sku)||'')+'" required></div><div class="ops-field full cols-2"><label class="ops-required">商品名稱</label><input class="ops-input" name="internalName" value="'+attr((internal&&internal.internalName)||(p&&p.originalName)||(p&&p.onlineName)||'')+'" required></div></div><div class="ops-form-grid cols-3"><div class="ops-field"><label>品牌</label><input class="ops-input" name="brand" value="'+attr((p&&p.brand)||'')+'"></div><div class="ops-field"><label>分類</label><input class="ops-input" name="category" value="'+attr((p&&p.category)||'')+'"></div><div class="ops-field"><label>狀態</label><select class="ops-select" name="status"><option value="active">正常銷售</option><option value="inactive">停用</option><option value="discontinued">停售</option></select></div></div><div class="ops-form-grid cols-4 ops-product-value-fields"><div class="ops-field"><label>門市售價</label><input class="ops-input" type="number" min="0" step="1" name="storePrice" value="'+attr(p&&p.storePrice!=null?p.storePrice:'')+'"></div><div class="ops-field"><label>網路售價</label><input class="ops-input" type="number" value="'+attr(p&&p.onlinePrice!=null?p.onlinePrice:'')+'" readonly></div><div class="ops-field"><label>最近進貨成本</label><input class="ops-input" type="number" min="0" step="0.01" name="latestPurchaseCost" value="'+attr(p&&p.latestPurchaseCost!=null?p.latestPurchaseCost:'')+'"></div><div class="ops-field"><label>平均成本</label><input class="ops-input" value="'+attr(avg!=null?avg:'')+'" readonly></div></div><div class="ops-form-grid cols-2"><div class="ops-field"><label>現有庫存</label><input class="ops-input" type="number" min="0" step="1" name="currentStock" value="'+attr(p&&p.currentStock!=null?p.currentStock:0)+'"></div><div class="ops-field"><label>安全庫存</label><input class="ops-input" type="number" min="0" step="1" name="safetyStock" value="'+attr(p&&p.safetyStock!=null?p.safetyStock:0)+'"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note">'+escapeHtml((internal&&internal.note)||'')+'</textarea></div></div></div></div></section></form>';
  }
  function openProductEdit(id){
    const p=id?catalogById(id):null;
    if(id&&!p)return toast('找不到商品','請重新讀取資料。','error');
    state.productEditId=id||'__new__';
    state.productPreviewImages=[];
    state.productPreviewIndex=0;
    state.productPreviewTitle=(p&&((p.originalName)||(p.onlineName)||(p.name)))||'商品圖片';
    render();
    setTimeout(function(){
      const editor=byId('opsProductEditor');
      if(editor&&typeof editor.scrollIntoView==='function'){
        try{editor.scrollIntoView({behavior:'smooth',block:'start'});}catch(err){editor.scrollIntoView(true);}
      }
      const status=query('#productForm [name="status"]');
      if(status)status.value=(p&&p.internal&&p.internal.status)||'active';
    },0);
  }
  function imageGalleryHtml(images,alt){images=(images||[]).slice(0,3);if(!images.length)return '<div class="ops-detail-gallery"><div class="ops-detail-no-image">尚無圖片</div></div>';return '<div class="ops-detail-gallery">'+images.map(function(url,index){return '<img class="'+(index===0?'main':'')+'" src="'+attr(url)+'" alt="'+attr(alt)+'">';}).join('')+'</div>';}
  function openProductDetail(id){
    const p=catalogById(id);if(!p)return;const tx=state.inventory.filter(function(x){return x.productId===p.docId;}).sort(function(a,b){return (dateFrom(b.occurredAt)||0)-(dateFrom(a.occurredAt)||0);}).slice(0,10);const layers=(p.internal&&p.internal.costLayers)||[];
    const txHtml=tx.length?tx.map(function(x){return '<div class="ops-status-row"><div><b>'+escapeHtml(x.type)+'・'+(x.qtyChange>0?'+':'')+formatNumber(x.qtyChange)+'</b><small>'+escapeHtml(dateTimeText(x.occurredAt))+' '+escapeHtml(x.referenceId||'')+'</small></div><b>'+formatNumber(x.afterStock)+'</b></div>';}).join(''):emptyHtml('尚無庫存異動','進貨、銷售或盤點後會顯示。');
    const layerHtml=layers.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>批次</th><th>日期</th><th class="num">剩餘數量</th><th class="num">單位成本</th><th>來源</th></tr></thead><tbody>'+layers.map(function(l){return '<tr><td>'+escapeHtml(l.layerId)+'</td><td>'+escapeHtml(dateText(l.receivedAt))+'</td><td class="num">'+formatNumber(l.qtyRemaining)+'</td><td class="num">'+money(l.unitCost)+'</td><td>'+escapeHtml(l.referenceType+' '+(l.referenceId||''))+'</td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('尚無 FIFO 成本批次','庫存為零、成本缺漏，或尚未完成原始 Excel 匯入。');
    const body='<div class="ops-detail-hero">'+imageGalleryHtml(p.imageUrls,p.originalName||p.name)+'<div><h3>'+escapeHtml(p.originalName||p.name)+'</h3><p>網路名稱：'+escapeHtml(p.onlineName||'未上架／未配對')+'</p><p>SKU：'+escapeHtml(p.sku||'尚未設定')+'</p><p>'+escapeHtml([p.brand,p.category,p.variantName].filter(Boolean).join('・')||'未設定品牌／分類')+'</p></div></div><div class="ops-grid-equal"><div class="ops-card"><div class="ops-summary-list"><div class="ops-summary-line"><span>現有庫存</span><b>'+formatNumber(p.currentStock)+'</b></div><div class="ops-summary-line"><span>保留庫存</span><b>'+formatNumber(p.reservedStock)+'</b></div><div class="ops-summary-line"><span>安全庫存</span><b>'+formatNumber(p.safetyStock)+'</b></div><div class="ops-summary-line total"><span>可銷售庫存</span><b>'+formatNumber(p.availableStock)+'</b></div></div></div><div class="ops-card"><div class="ops-summary-list"><div class="ops-summary-line"><span>原始定價</span><b>'+money(p.storePrice)+'</b></div><div class="ops-summary-line"><span>網路售價</span><b>'+money(p.onlinePrice)+'</b></div><div class="ops-summary-line"><span>下一件 FIFO 成本</span><b>'+money(p.nextFifoCost)+'</b></div><div class="ops-summary-line"><span>剩餘平均成本</span><b>'+money(p.averageCost)+'</b></div><div class="ops-summary-line"><span>庫存總成本</span><b>'+money(p.inventoryValue)+'</b></div><div class="ops-summary-line total"><span>下一件預估毛利率</span><b>'+percentage(p.margin)+'</b></div></div></div></div><div class="ops-section-title">FIFO 剩餘成本批次</div>'+layerHtml+'<div class="ops-section-title">最近庫存異動</div>'+txHtml+'<div class="ops-drawer-footer"><button class="ops-button ghost" data-action="drawer-close">關閉</button><button class="ops-button primary" data-action="product-edit" data-id="'+attr(p.docId)+'">編輯主檔</button></div>';openDrawer('商品完整資料','原始名稱、網路名稱、圖片、庫存與 FIFO 成本。',body);
  }
  async function saveProduct(form){
    const requestedId=clean(form.dataset.id),p=requestedId?catalogById(requestedId):null;if(requestedId&&(!p||!p.internal))throw new Error('找不到中央商品主檔');
    const data=new FormData(form),sku=normalizeCode(data.get('internalSku')),name=clean(data.get('internalName'));if(!sku)throw new Error('SKU 不可空白');if(!name)throw new Error('商品名稱不可空白');
    const duplicate=state.internalProducts.find(function(x){return x.internalSku===sku&&x.docId!==requestedId;});if(duplicate)throw new Error('此 SKU 已被其他商品使用：'+sku);
    const ref=requestedId?state.db.collection(COLLECTIONS.products).doc(requestedId):state.db.collection(COLLECTIONS.products).doc(),id=ref.id,oldStock=p?Number(p.currentStock||0):0,newStock=numberOrNull(data.get('currentStock'));if(newStock==null||newStock<0)throw new Error('現有庫存格式不正確');
    const latest=numberOrNull(data.get('latestPurchaseCost')),raw=p&&p.internal?p.internal:{currentStock:0,costLayers:[]},layerResult=adjustFifoLayers(raw,newStock,latest,{referenceType:p?'manualAdjustment':'manualOpening',referenceId:id,receivedAt:new Date().toISOString()});
    const payload={internalSku:sku,internalName:name,originalName:name,barcode:p&&p.internal?clean(p.internal.barcode):'',storePrice:numberOrNull(data.get('storePrice')),originalSalePrice:numberOrNull(data.get('storePrice')),latestPurchaseCost:latest,currentStock:newStock,reservedStock:p?Number(p.reservedStock||0):0,safetyStock:numberOrNull(data.get('safetyStock'))||0,saleRewardPercent:p&&p.internal?p.internal.saleRewardPercent:null,status:clean(data.get('status'))||'active',brand:clean(data.get('brand')),category:clean(data.get('category')),note:clean(data.get('note')),costLayers:layerResult.layers,averageCost:layerResult.averageCost,inventoryValue:layerResult.inventoryValue,costIncomplete:layerResult.costIncomplete,importInitialized:true,enabled:true,source:p?clean(p.internal.source)||'manual':'manual',updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};
    if(!p){payload.createdAt=serverTimestamp();payload.createdBy=userLabel();payload.openingStock=newStock;payload.openingUnitCost=latest;}
    await ref.set(payload,{merge:true});
    if(newStock!==oldStock){await state.db.collection(COLLECTIONS.inventory).add({type:p?'adjustment':'opening',productId:id,productName:name,sku:sku,qtyChange:newStock-oldStock,beforeStock:oldStock,afterStock:newStock,unitCost:latest,referenceType:'productMaster',referenceId:id,note:p?'商品主檔直接調整；成本層同步修正':'新增商品期初庫存',occurredAt:serverTimestamp(),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});await state.db.collection(COLLECTIONS.platformInventoryQueue).doc(id).set({productId:id,sku:sku,targetStock:newStock,status:'pending',reason:p?'productEdit':'productCreate',updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});}
    state.productEditId=id;state.productPreviewImages=[];state.productPreviewIndex=0;state.productPreviewTitle=name;
    await writeAudit(p?'儲存商品主檔':'新增商品','product',id,name+'｜'+sku);toast(p?'商品已儲存':'商品已新增',name,'success');await loadAll(true);
  }
  async function autoInitProducts(){ return openImport(); }

  function addCartProduct(id){const p=catalogById(id);if(!p||!p.initialized)return;const existing=state.cart.find(function(x){return x.productId===id;});if(existing)existing.qty+=1;else state.cart.push({productId:id,name:p.originalName||p.name,sku:p.sku,imageUrl:p.imageUrl,qty:1,unitPrice:Number(p.storePrice||0),currentStock:p.currentStock});render();}
  function openCustomer(id){const row=id?state.customers.find(function(x){return x.id===id;}):null;const c=row||{id:'',name:'',phone:'',email:'',customerType:'general',memberNo:'',pricingTier:'retail',externalTeacherId:'',pointBalance:0,creditLimit:0,note:'',enabled:true};openDrawer(row?'編輯客戶':'新增客戶','先建立關係；點數與老師價格公式之後再設定。','<form id="customerForm" data-id="'+attr(c.id)+'"><div class="ops-form-grid"><div class="ops-field"><label class="ops-required">姓名／名稱</label><input class="ops-input" name="name" value="'+attr(c.name)+'" required></div><div class="ops-field"><label>電話</label><input class="ops-input" name="phone" value="'+attr(c.phone)+'"></div><div class="ops-field"><label>Email</label><input class="ops-input" type="email" name="email" value="'+attr(c.email)+'"></div><div class="ops-field"><label>客戶身分</label><select class="ops-select" name="customerType"><option value="general">一般客戶</option><option value="member">會員</option><option value="teacher">老師</option><option value="organization">機構</option></select></div><div class="ops-field"><label>會員編號</label><input class="ops-input" name="memberNo" value="'+attr(c.memberNo)+'" placeholder="留白會自動產生"></div><div class="ops-field"><label>價格層級</label><select class="ops-select" name="pricingTier"><option value="retail">一般售價</option><option value="teacher">老師價（規則待設定）</option><option value="custom">自訂價格（規則待設定）</option></select></div><div class="ops-field"><label>外聘老師資料 ID</label><input class="ops-input" name="externalTeacherId" value="'+attr(c.externalTeacherId)+'"></div><div class="ops-field"><label>信用額度</label><input class="ops-input" type="number" min="0" step="1" name="creditLimit" value="'+c.creditLimit+'"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note">'+escapeHtml(c.note)+'</textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存客戶</button></div></form>');query('#customerForm [name="customerType"]').value=c.customerType;query('#customerForm [name="pricingTier"]').value=c.pricingTier;}
  async function saveCustomer(form){const id=clean(form.dataset.id),data=new FormData(form),type=clean(data.get('customerType')),payload={name:clean(data.get('name')),phone:clean(data.get('phone')),email:clean(data.get('email')),customerType:type,memberNo:clean(data.get('memberNo'))||(type==='member'||type==='teacher'?uid('MEM'):''),pricingTier:clean(data.get('pricingTier')),externalTeacherId:clean(data.get('externalTeacherId')),creditLimit:numberOrNull(data.get('creditLimit'))||0,note:clean(data.get('note')),enabled:true,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};if(!payload.name)throw new Error('請填寫姓名或名稱');let ref;if(id){ref=state.db.collection(COLLECTIONS.customers).doc(id);await ref.set(payload,{merge:true});}else{payload.pointBalance=0;payload.createdAt=serverTimestamp();payload.createdBy=userLabel();ref=await state.db.collection(COLLECTIONS.customers).add(payload);}await writeAudit(id?'更新客戶':'新增客戶','customer',ref.id,payload.name);closeDrawer();toast('客戶已儲存',payload.name,'success');await loadAll(true);}
  function checkoutDrawer(){const subtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;}),options='<option value="">現場散客</option>'+state.customers.filter(function(x){return x.enabled;}).map(function(x){return '<option value="'+attr(x.id)+'">'+escapeHtml(x.name)+'｜'+escapeHtml(customerTypeName(x.customerType))+(x.memberNo?'｜'+escapeHtml(x.memberNo):'')+'</option>';}).join('');openDrawer('現場銷售結帳','','<form id="checkoutForm"><div class="ops-summary-list"><div class="ops-summary-line"><span>商品數量</span><b>'+sum(state.cart,function(x){return x.qty;})+' 件</b></div><div class="ops-summary-line total"><span>應收金額</span><b>'+money(subtotal)+'</b></div></div><div class="ops-form-grid" style="margin-top:15px"><div class="ops-field"><label class="ops-required">成交時間</label><input class="ops-input" type="datetime-local" name="soldAt" value="'+inputDateTime(new Date())+'" required></div><div class="ops-field"><label>客戶／會員</label><select class="ops-select" name="customerId">'+options+'</select></div><div class="ops-field"><label class="ops-required">付款方式</label><select class="ops-select" name="paymentMethod" required><option>現金</option><option>信用卡</option><option>轉帳</option><option>LINE Pay</option><option>其他</option></select></div><div class="ops-field"><label>收款狀態</label><select class="ops-select" name="paymentStatus"><option value="paid">已收清</option><option value="partial">部分收款</option><option value="unpaid">未收款</option></select></div><div class="ops-field"><label>本次已收金額</label><input class="ops-input" type="number" min="0" step="1" name="receivedAmount" placeholder="已收清可留白"></div><div class="ops-field"><label>折扣</label><input class="ops-input" type="number" min="0" step="1" name="discount" value="0"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note"></textarea></div></div><div class="ops-callout">點數先記錄為 0；老師價只連結價格層級，尚未自動改價。</div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">確認銷售並扣庫存</button></div></form>');}
  async function saveCheckout(form){
    if(!state.cart.length)throw new Error('銷售清單是空的');const data=new FormData(form),discount=numberOrNull(data.get('discount'))||0,soldAt=new Date(clean(data.get('soldAt'))),customerId=clean(data.get('customerId')),customer=state.customers.find(function(x){return x.id===customerId;})||null,paymentStatus=clean(data.get('paymentStatus'))||'paid';if(Number.isNaN(soldAt.getTime()))throw new Error('成交時間格式不正確');if(paymentStatus!=='paid'&&!customer)throw new Error('未收款或部分收款必須先選擇客戶');const saleNo=uid('SALE'),saleRef=state.db.collection(COLLECTIONS.sales).doc(),receivableRef=state.db.collection(COLLECTIONS.receivables).doc();
    await state.db.runTransaction(async function(tx){const refs=state.cart.map(function(item){return state.db.collection(COLLECTIONS.products).doc(item.productId);}),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));const prepared=[];let subtotal=0,costTotal=0,unknownCostQty=0;
      snaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品主檔不存在：'+state.cart[index].name);const raw=snap.data()||{},item=state.cart[index],current=Number(raw.currentStock||0),qty=Math.max(1,Math.round(Number(item.qty||0)));if(current<qty)throw new Error(item.name+' 庫存不足，目前 '+current+'，本次需要 '+qty);const unitPrice=Math.max(0,Number(item.unitPrice||0)),fifo=consumeFifo(raw,qty);subtotal+=qty*unitPrice;costTotal+=fifo.costTotal;unknownCostQty+=fifo.unknownCostQty;prepared.push({ref:refs[index],raw:raw,item:item,qty:qty,current:current,unitPrice:unitPrice,fifo:fifo});});
      const total=Math.max(0,subtotal-discount),grossProfit=total-costTotal,enteredReceived=numberOrNull(data.get('receivedAmount')),receivedAmount=paymentStatus==='paid'?total:Math.min(total,Math.max(0,enteredReceived||0)),actualStatus=receivedAmount>=total?'paid':receivedAmount>0?'partial':'unpaid';tx.set(saleRef,{saleNo:saleNo,soldAt:soldAt,items:prepared.map(function(x){return {productId:x.item.productId,name:x.item.name,sku:x.item.sku,imageUrl:x.item.imageUrl||'',qty:x.qty,unitPrice:x.unitPrice,lineTotal:x.qty*x.unitPrice,lineCost:x.fifo.costTotal,fifoBreakdown:x.fifo.breakdown,unknownCostQty:x.fifo.unknownCostQty};}),subtotal:subtotal,discount:discount,total:total,costTotal:costTotal,grossProfit:grossProfit,unknownCostQty:unknownCostQty,costMethod:'FIFO',paymentMethod:clean(data.get('paymentMethod')),paymentStatus:actualStatus,receivedAmount:receivedAmount,customerId:customer?customer.id:'',customerName:customer?customer.name:'',customerType:customer?customer.customerType:'walk_in',memberNo:customer?customer.memberNo:'',pricingTier:customer?customer.pricingTier:'retail',pointsEarned:0,pointsRedeemed:0,note:clean(data.get('note')),status:'completed',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});if(actualStatus!=='paid')tx.set(receivableRef,{receivableNo:uid('AR'),saleId:saleRef.id,saleNo:saleNo,customerId:customer.id,customerName:customer.name,totalAmount:total,receivedAmount:receivedAmount,outstandingAmount:total-receivedAmount,status:actualStatus,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      prepared.forEach(function(x){const after=x.current-x.qty;tx.update(x.ref,{currentStock:after,costLayers:x.fifo.layers,averageCost:x.fifo.averageCost,inventoryValue:x.fifo.inventoryValue,costIncomplete:x.fifo.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});queueInventorySyncInTransaction(tx,x.item.productId,x.item.sku,after,'storeSale');const tRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(tRef,{type:'sale',productId:x.item.productId,productName:x.item.name,sku:x.item.sku,qtyChange:-x.qty,beforeStock:x.current,afterStock:after,unitCost:x.qty?x.fifo.costTotal/x.qty:null,costMethod:'FIFO',fifoBreakdown:x.fifo.breakdown,referenceType:'storeSale',referenceId:saleNo,note:'現場銷售',occurredAt:soldAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
    });
    await writeAudit('完成現場銷售','storeSale',saleRef.id,saleNo+'｜'+money(sum(state.cart,function(x){return x.qty*x.unitPrice;})-discount)+'｜FIFO');state.cart=[];closeDrawer();toast('現場銷售完成',saleNo,'success');await loadAll(true);
  }
  function checkoutDrawerV4(){
    const subtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;}),c=selectedCustomer(),settings=state.membershipSettings||DEFAULT_MEMBERSHIP_SETTINGS,maxPoints=maxRedeemablePoints(c,subtotal),defaultPoints=c&&settings.redemptionMode==='auto'?maxPoints:0;
    openDrawer('結帳','', '<form id="checkoutFormV4"><input type="hidden" name="customerId" value="'+attr(c?c.id:'')+'"><input type="hidden" name="maxRedeemPoints" value="'+maxPoints+'"><div class="ops-checkout-person">'+(c?'<b>'+escapeHtml(c.name)+'</b><span>'+escapeHtml(customerTypeName(c.customerType))+'</span>'+(c.customerType==='member'?'<strong>'+formatNumber(c.pointBalance)+' 點</strong>':''):'<b>門市散客</b>')+'</div><div class="ops-form-grid"><div class="ops-field"><label class="ops-required">成交時間</label><input class="ops-input" type="datetime-local" name="soldAt" value="'+inputDateTime(new Date())+'" required></div><div class="ops-field"><label>付款方式</label><select class="ops-select" name="paymentMethod"><option>現金</option><option>信用卡</option><option>轉帳</option><option>LINE Pay</option><option>其他</option></select></div><div class="ops-field"><label>收款狀態</label><select class="ops-select" name="paymentStatus"><option value="paid">已收清</option><option value="partial">部分收款</option><option value="unpaid">未收款</option></select></div><div class="ops-field"><label>本次已收</label><input class="ops-input" type="number" min="0" step="1" name="receivedAmount"></div><div class="ops-field"><label>折扣金額</label><input class="ops-input" type="number" min="0" step="1" name="discount" value="0"></div>'+(c&&c.customerType==='member'&&settings.redemptionMode!=='earn-only'?'<div class="ops-field"><label>使用點數</label><input class="ops-input" type="number" min="0" max="'+maxPoints+'" step="'+Math.max(1,Math.floor(Number(settings.redeemPoints||1)))+'" name="pointsToRedeem" value="'+defaultPoints+'"></div>':'<input type="hidden" name="pointsToRedeem" value="0">')+'</div><div class="ops-summary-list ops-checkout-summary"><div class="ops-summary-line"><span>商品金額</span><b>'+money(subtotal)+'</b></div><div class="ops-summary-line"><span>點數折抵</span><b id="checkoutPointDiscount">'+money(pointDiscount(defaultPoints))+'</b></div><div class="ops-summary-line total"><span>應收金額</span><b id="checkoutTotalPreview">'+money(Math.max(0,subtotal-pointDiscount(defaultPoints)))+'</b></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">確認</button></div></form>');
  }
  function updateCheckoutPreview(){const form=byId('checkoutFormV4');if(!form)return;const subtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;}),discount=Math.max(0,Number((query('[name="discount"]',form)||{}).value||0)),pointInput=query('[name="pointsToRedeem"]',form),maxPoints=maxRedeemablePoints(selectedCustomer(),Math.max(0,subtotal-discount));if(pointInput){pointInput.max=String(maxPoints);if(Number(pointInput.value||0)>maxPoints)pointInput.value=String(maxPoints);}const points=Math.max(0,Number((pointInput||{}).value||0)),pointValue=pointDiscount(points);setText('checkoutPointDiscount',money(pointValue));setText('checkoutTotalPreview',money(Math.max(0,subtotal-discount-pointValue)));}
  async function saveCheckoutV4(form){
    if(!state.cart.length)throw new Error('銷售清單是空的');const data=new FormData(form),discount=Math.max(0,numberOrNull(data.get('discount'))||0),soldAt=new Date(),customerId=clean(data.get('customerId')),paymentChoice=clean(data.get('paymentStatus'))||'paid',requestedPoints=Math.max(0,Math.floor(numberOrNull(data.get('pointsToRedeem'))||0)),earnPointsEnabled=data.get('earnPointsEnabled')==='true';if(paymentChoice!=='paid'&&!customerId)throw new Error('未收款必須選擇會員');if(paymentChoice!=='paid'&&requestedPoints>0)throw new Error('未收款不能使用點數');
    const saleNo=uid('SALE'),saleRef=state.db.collection(COLLECTIONS.sales).doc(),receivableRef=state.db.collection(COLLECTIONS.receivables).doc(),customerRef=customerId?state.db.collection(COLLECTIONS.customers).doc(customerId):null;
    await state.db.runTransaction(async function(tx){
      const refs=state.cart.map(function(item){return state.db.collection(COLLECTIONS.products).doc(item.productId);}),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));const customerSnap=customerRef?await tx.get(customerRef):null,customerRaw=customerSnap&&customerSnap.exists?(customerSnap.data()||{}):null;if(customerRef&&!customerRaw)throw new Error('找不到客戶');
      const prepared=[];let subtotal=0,costTotal=0,unknownCostQty=0;snaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品主檔不存在：'+state.cart[index].name);const raw=snap.data()||{},item=state.cart[index],current=Number(raw.currentStock||0),qty=Math.max(1,Math.round(Number(item.qty||0)));if(current<qty)throw new Error(item.name+' 庫存不足，目前 '+current);const unitPrice=Math.max(0,Number(item.unitPrice||0)),fifo=consumeFifo(raw,qty);subtotal+=qty*unitPrice;costTotal+=fifo.costTotal;unknownCostQty+=fifo.unknownCostQty;prepared.push({ref:refs[index],raw:raw,item:item,qty:qty,current:current,unitPrice:unitPrice,fifo:fifo});});
      const customer=customerRaw?normalizeCustomer(Object.assign({__id:customerId},customerRaw)):null,maxPoints=maxRedeemablePoints(customer,Math.max(0,subtotal-discount)),activeRule=membershipRuleForDate(soldAt),redeemStep=Math.max(1,Math.floor(Number(activeRule.redeemPoints||1)));if(requestedPoints>maxPoints)throw new Error('可使用點數不足');if(requestedPoints%redeemStep!==0)throw new Error('點數請依設定單位使用');const pointsRedeemed=requestedPoints,pointValue=pointDiscount(pointsRedeemed,soldAt),total=Math.max(0,subtotal-discount-pointValue),enteredReceived=numberOrNull(data.get('receivedAmount')),receivedAmount=paymentChoice==='paid'?total:Math.min(total,Math.max(0,enteredReceived||0)),actualStatus=receivedAmount>=total?'paid':receivedAmount>0?'partial':'unpaid',pendingPoints=earnPointsEnabled&&customer&&customer.customerType==='member'?calculatePreparedRewardPoints(prepared,total,subtotal,soldAt):0,pointsEarned=actualStatus==='paid'?pendingPoints:0,grossProfit=total-costTotal;
      tx.set(saleRef,{saleNo:saleNo,soldAt:soldAt,items:prepared.map(function(x){return {productId:x.item.productId,name:x.item.name,sku:x.item.sku,imageUrl:x.item.imageUrl||'',qty:x.qty,unitPrice:x.unitPrice,lineTotal:x.qty*x.unitPrice,lineCost:x.fifo.costTotal,fifoBreakdown:x.fifo.breakdown,unknownCostQty:x.fifo.unknownCostQty,rewardPercent:productRewardPercent(x.raw,soldAt)};}),subtotal:subtotal,manualDiscount:discount,pointDiscount:pointValue,discount:discount+pointValue,total:total,costTotal:costTotal,grossProfit:grossProfit,unknownCostQty:unknownCostQty,costMethod:'FIFO',paymentMethod:clean(data.get('paymentMethod')),paymentStatus:actualStatus,receivedAmount:receivedAmount,customerId:customer?customer.id:'',customerName:customer?customer.name:'',customerType:customer?customer.customerType:'walk_in',memberNo:customer?customer.memberNo:'',pricingTier:customer?customer.pricingTier:'retail',pointsRuleYear:activeRule.year,pointsRulePercent:activeRule.rewardPercent,earnPointsEnabled:earnPointsEnabled,pointsEarned:pointsEarned,pendingPointsEarned:actualStatus==='paid'?0:pendingPoints,pointsRedeemed:pointsRedeemed,note:'',status:'completed',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      if(customer){let balance=Math.max(0,Number(customerRaw.pointBalance||0));if(pointsRedeemed){balance-=pointsRedeemed;const pointRef=state.db.collection(COLLECTIONS.points).doc();tx.set(pointRef,{customerId:customer.id,saleId:saleRef.id,type:'redeem',points:-pointsRedeemed,balanceAfter:balance,note:saleNo,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}if(pointsEarned){balance+=pointsEarned;const pointRef=state.db.collection(COLLECTIONS.points).doc();tx.set(pointRef,{customerId:customer.id,saleId:saleRef.id,type:'earn',points:pointsEarned,balanceAfter:balance,note:saleNo,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}if(pointsRedeemed||pointsEarned)tx.update(customerRef,{pointBalance:balance,updatedAt:serverTimestamp()});}
      if(actualStatus!=='paid')tx.set(receivableRef,{receivableNo:uid('AR'),sourceType:'sale',saleId:saleRef.id,saleNo:saleNo,customerId:customer.id,customerName:customer.name,totalAmount:total,receivedAmount:receivedAmount,outstandingAmount:total-receivedAmount,status:actualStatus,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      prepared.forEach(function(x){const after=x.current-x.qty;tx.update(x.ref,{currentStock:after,costLayers:x.fifo.layers,averageCost:x.fifo.averageCost,inventoryValue:x.fifo.inventoryValue,costIncomplete:x.fifo.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});queueInventorySyncInTransaction(tx,x.item.productId,x.item.sku,after,'storeSale');const tRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(tRef,{type:'sale',productId:x.item.productId,productName:x.item.name,sku:x.item.sku,qtyChange:-x.qty,beforeStock:x.current,afterStock:after,unitCost:x.qty?x.fifo.costTotal/x.qty:null,costMethod:'FIFO',fifoBreakdown:x.fifo.breakdown,referenceType:'storeSale',referenceId:saleNo,note:'現場銷售',occurredAt:soldAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
    });
    await writeAudit('完成現場銷售','storeSale',saleRef.id,saleNo);state.cart=[];state.posSearch='';state.selectedCustomerId='';state.posCustomerMode='walkin';state.posMemberSearch='';state.posMemberPickerOpen=false;state.checkoutPaymentMethod='現金';state.checkoutPaymentStatus='paid';state.checkoutDiscount=0;state.checkoutPoints=0;state.checkoutPointsTouched=false;state.checkoutEarnPoints=true;state.checkoutReceived='';toast('現場銷售完成',saleNo,'success');await loadAll(true);
  }
  function openQuickIncome(category){
    const preset=clean(category);
    openDrawer(preset||'新增其他收入','','<form id="quickIncomeForm"><div class="ops-form-grid"><div class="ops-field"><label class="ops-required">收入日期</label><input class="ops-input" type="datetime-local" name="occurredAt" value="'+inputDateTime(new Date())+'" required></div><div class="ops-field"><label class="ops-required">收入類別</label><input class="ops-input" name="category" value="'+attr(preset)+'" placeholder="例如：維修收入" required></div><div class="ops-field"><label class="ops-required">金額</label><input class="ops-input" type="number" min="0" step="1" name="amount" required></div><div class="ops-field"><label>付款方式</label><select class="ops-select" name="paymentMethod"><option>現金</option><option>信用卡</option><option>轉帳</option><option>LINE Pay</option><option>其他</option></select></div><div class="ops-field"><label>客戶姓名</label><input class="ops-input" name="customerName"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note"></textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存收入</button></div></form>');
  }
  async function saveQuickIncome(form){
    const data=new FormData(form),amount=numberOrNull(data.get('amount')),customerId=clean(data.get('customerId')),customer=state.customers.find(function(x){return x.id===customerId;})||null,paymentChoice=clean(data.get('paymentStatus'))||'paid';if(amount==null||amount<0)throw new Error('請填寫正確金額');if(paymentChoice!=='paid'&&!customer)throw new Error('未收款必須選擇客戶');const entered=numberOrNull(data.get('receivedAmount')),received=paymentChoice==='paid'?amount:Math.min(amount,Math.max(0,entered||0)),status=received>=amount?'paid':received>0?'partial':'unpaid',no=uid('INC'),ref=state.db.collection(COLLECTIONS.incomes).doc(),receivableRef=state.db.collection(COLLECTIONS.receivables).doc(),occurredAt=new Date(clean(data.get('occurredAt')));
    await state.db.runTransaction(async function(tx){tx.set(ref,{incomeNo:no,occurredAt:occurredAt,category:clean(data.get('category')),amount:amount,paymentMethod:clean(data.get('paymentMethod')),paymentStatus:status,receivedAmount:received,customerId:customer?customer.id:'',customerName:customer?customer.name:'',note:'',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});if(status!=='paid')tx.set(receivableRef,{receivableNo:uid('AR'),sourceType:'income',incomeId:ref.id,incomeNo:no,customerId:customer.id,customerName:customer.name,totalAmount:amount,receivedAmount:received,outstandingAmount:amount-received,status:status,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
    await writeAudit('新增收入','quickIncome',ref.id,no+'｜'+money(amount));state.salesMode='product';state.selectedCustomerId='';state.posCustomerMode='walkin';state.checkoutPaymentMethod='現金';state.checkoutPaymentStatus='paid';state.checkoutReceived='';state.directIncomeAmount='';closeDrawer();toast('收入已儲存',no,'success');await loadAll(true);
  }
  function openReceivablePayment(id){const r=state.receivables.find(function(x){return x.id===id;});if(!r)return;openDrawer('登記收款',r.customerName+'｜'+r.receivableNo,'<form id="receivablePaymentForm" data-id="'+attr(r.id)+'"><div class="ops-summary-list"><div class="ops-summary-line"><span>目前尚未收</span><b>'+money(r.outstandingAmount)+'</b></div></div><div class="ops-form-grid" style="margin-top:15px"><div class="ops-field"><label class="ops-required">收款日期</label><input class="ops-input" type="datetime-local" name="paidAt" value="'+inputDateTime(new Date())+'" required></div><div class="ops-field"><label class="ops-required">本次收款</label><input class="ops-input" type="number" min="1" max="'+r.outstandingAmount+'" step="1" name="amount" value="'+r.outstandingAmount+'" required></div><div class="ops-field"><label>付款方式</label><select class="ops-select" name="paymentMethod"><option>現金</option><option>信用卡</option><option>轉帳</option><option>LINE Pay</option><option>其他</option></select></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note"></textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">確認收款</button></div></form>');}
  async function saveReceivablePayment(form){
    const id=clean(form.dataset.id),data=new FormData(form),amount=numberOrNull(data.get('amount')),ref=state.db.collection(COLLECTIONS.receivables).doc(id),paymentRef=state.db.collection(COLLECTIONS.receivablePayments).doc();if(!amount||amount<=0)throw new Error('收款金額不正確');
    await state.db.runTransaction(async function(tx){
      const receivableSnap=await tx.get(ref);if(!receivableSnap.exists)throw new Error('找不到應收帳款');const raw=receivableSnap.data()||{},r=normalizeReceivable(Object.assign({__id:id},raw));if(amount>r.outstandingAmount)throw new Error('收款金額超過未收金額');const sourceRef=r.sourceType==='income'&&r.incomeId?state.db.collection(COLLECTIONS.incomes).doc(r.incomeId):(r.saleId?state.db.collection(COLLECTIONS.sales).doc(r.saleId):null),sourceSnap=sourceRef?await tx.get(sourceRef):null,customerRef=r.customerId?state.db.collection(COLLECTIONS.customers).doc(r.customerId):null,customerSnap=customerRef?await tx.get(customerRef):null,received=r.receivedAmount+amount,outstanding=Math.max(0,r.totalAmount-received),status=outstanding===0?'paid':'partial';
      tx.update(ref,{receivedAmount:received,outstandingAmount:outstanding,status:status,updatedAt:serverTimestamp(),updatedBy:userLabel()});tx.set(paymentRef,{receivableId:r.id,sourceType:r.sourceType,saleId:r.saleId,incomeId:r.incomeId,customerId:r.customerId,amount:amount,paymentMethod:clean(data.get('paymentMethod')),paidAt:new Date(clean(data.get('paidAt'))),note:clean(data.get('note')),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});if(sourceRef)tx.set(sourceRef,{receivedAmount:received,paymentStatus:status,updatedAt:serverTimestamp()},{merge:true});
      if(status==='paid'&&r.sourceType==='sale'&&sourceSnap&&sourceSnap.exists&&customerSnap&&customerSnap.exists){const sale=sourceSnap.data()||{},pending=Math.max(0,Math.floor(Number(sale.pendingPointsEarned||0)));if(pending){const balance=Math.max(0,Number((customerSnap.data()||{}).pointBalance||0))+pending,pointRef=state.db.collection(COLLECTIONS.points).doc();tx.update(customerRef,{pointBalance:balance,updatedAt:serverTimestamp()});tx.set(pointRef,{customerId:r.customerId,saleId:r.saleId,type:'earn',points:pending,balanceAfter:balance,note:clean(sale.saleNo),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});tx.set(sourceRef,{pointsEarned:pending,pendingPointsEarned:0},{merge:true});}}
    });
    await writeAudit('登記應收款','receivable',id,money(amount));closeDrawer();toast('收款已登記',money(amount),'success');await loadAll(true);
  }
  function restoreSaleItemToStock(raw,item,qtyOverride){
    const layers=materializeCostLayers(raw),breakdown=Array.isArray(item.fifoBreakdown)?item.fifoBreakdown:[],fallbackQty=Math.max(0,Math.floor(Number(qtyOverride==null?item.qty:qtyOverride)||0));if(breakdown.length){let remaining=fallbackQty;breakdown.forEach(function(part,index){const qty=Math.min(remaining,Math.max(0,Number(part.qty||0)));if(!qty)return;remaining-=qty;let layer=layers.find(function(x){return x.layerId===clean(part.layerId);});if(layer){layer.qtyRemaining+=qty;layer.originalQty=Math.max(layer.originalQty||0,layer.qtyRemaining);}else layers.push({layerId:clean(part.layerId)||('RESTORE-'+index),qtyRemaining:qty,originalQty:qty,unitCost:numberOrNull(part.unitCost),costKnown:numberOrNull(part.unitCost)!=null,receivedAt:'1970-01-01T00:00:00.000Z',referenceType:'saleRestore',referenceId:clean(item.sku)});});if(remaining>0){const lineCost=numberOrNull(item.lineCost),unit=lineCost==null?null:lineCost/Math.max(1,Number(item.qty||fallbackQty));layers.push({layerId:uid('RESTORE'),qtyRemaining:remaining,originalQty:remaining,unitCost:unit,costKnown:unit!=null,receivedAt:'1970-01-01T00:00:00.000Z',referenceType:'saleRestore',referenceId:clean(item.sku)});}}else if(fallbackQty){const lineCost=numberOrNull(item.lineCost),unit=lineCost==null?null:lineCost/Math.max(1,Number(item.qty||fallbackQty));layers.push({layerId:uid('RESTORE'),qtyRemaining:fallbackQty,originalQty:fallbackQty,unitCost:unit,costKnown:unit!=null,receivedAt:'1970-01-01T00:00:00.000Z',referenceType:'saleRestore',referenceId:clean(item.sku)});}const stats=statsFromLayers(layers),stock=Number(raw.currentStock||0)+fallbackQty;return {raw:Object.assign({},raw,{currentStock:stock,costLayers:stats.layers}),stock:stock};
  }
  function openSaleEdit(id){
    const sale=state.sales.find(function(x){return x.id===id;});if(!sale)return;const customer=state.customers.find(function(x){return x.id===sale.customerId;})||null,member=customer&&customer.customerType==='member',walkin=!sale.customerId,items=sale.items.map(function(item){return '<div class="ops-sale-edit-row" data-sale-edit-row><input type="hidden" name="productId" value="'+attr(item.productId)+'"><div><b>'+escapeHtml(item.name)+'</b><span>'+escapeHtml(item.sku||'')+'</span></div><label>數量<input class="ops-input ops-number-clean" type="number" min="1" step="1" name="qty" value="'+Math.max(1,Number(item.qty||1))+'"></label><label>售價<input class="ops-input ops-number-clean" type="number" min="0" step="1" name="unitPrice" value="'+Math.max(0,Number(item.unitPrice||0))+'"></label></div>';}).join(''),methodTiles=['現金','信用卡','轉帳'].map(function(value){return '<label class="ops-radio-tile"><input type="radio" name="paymentMethod" value="'+value+'" '+(sale.paymentMethod===value?'checked':'')+'><span>'+value+'</span></label>';}).join(''),statusValues=walkin?['paid']:['paid','partial','unpaid'],statusLabels={paid:'已收清',partial:'部分收款',unpaid:'未收款'},statusTiles=statusValues.map(function(value){return '<label class="ops-radio-tile"><input type="radio" name="paymentStatus" value="'+value+'" '+(sale.paymentStatus===value?'checked':'')+'><span>'+statusLabels[value]+'</span></label>';}).join('');
    const returnedRefund=sum(state.salesReturns.filter(function(row){return row.saleId===sale.id;}),function(row){return row.refundAmount;}),availablePoints=member?Number(customer.pointBalance||0)+Number(sale.pointsRedeemed||0):0,maxPoints=member?maxRedeemablePoints(Object.assign({},customer,{pointBalance:availablePoints}),Math.max(0,Number(sale.subtotal||0)-Number(sale.manualDiscount||0))):0,memberInfo=member?'<div class="ops-member-payment-summary"><div><span>會員</span><b>'+escapeHtml(customer.name)+' '+escapeHtml(customer.memberNo||'')+'</b></div><div><span>目前可用</span><b>'+formatNumber(customer.pointBalance)+' 點</b></div><div><span>本單折抵</span><b>'+formatNumber(sale.pointsRedeemed)+' 點／'+money(sale.pointDiscount)+'</b></div><div><span>本單累積</span><b>'+(sale.earnPointsEnabled===false?'不累積':formatNumber(sale.pointsEarned)+' 點')+'</b></div></div>':'',saleSummary='<div class="ops-summary-list"><div class="ops-summary-line"><span>商品金額</span><b>'+money(sale.subtotal)+'</b></div><div class="ops-summary-line"><span>額外折扣</span><b>'+money(sale.manualDiscount)+'</b></div><div class="ops-summary-line"><span>點數折抵</span><b>'+money(sale.pointDiscount)+'</b></div>'+(returnedRefund?'<div class="ops-summary-line"><span>已退金額</span><b>'+money(returnedRefund)+'</b></div>':'')+'<div class="ops-summary-line total"><span>本單實收</span><b>'+money(sale.total)+'</b></div></div>';
    const pointFields=member?'<div class="ops-checkout-block"><label>本次點數</label><div class="ops-choice-grid two"><label class="ops-radio-tile"><input type="radio" name="earnPointsEnabled" value="true" '+(sale.earnPointsEnabled!==false?'checked':'')+'><span>累積點數</span></label><label class="ops-radio-tile"><input type="radio" name="earnPointsEnabled" value="false" '+(sale.earnPointsEnabled===false?'checked':'')+'><span>不累積點數</span></label></div></div><div class="ops-field"><label>點數折抵</label><input class="ops-input ops-number-clean" type="number" min="0" max="'+maxPoints+'" step="1" name="pointsToRedeem" value="'+Math.max(0,Number(sale.pointsRedeemed||0))+'"></div>':'<input type="hidden" name="earnPointsEnabled" value="false"><input type="hidden" name="pointsToRedeem" value="0">';
    openDrawer('修改單據',sale.saleNo,'<form id="saleEditForm" data-id="'+attr(sale.id)+'">'+memberInfo+saleSummary+'<div class="ops-sale-edit-items">'+items+'</div><div class="ops-checkout-block"><label>付款方式</label><div class="ops-choice-grid">'+methodTiles+'</div></div><div class="ops-checkout-block"><label>收款狀態</label><div class="ops-choice-grid '+(statusValues.length===1?'one':'')+'">'+statusTiles+'</div></div><div class="ops-form-grid"><div class="ops-field"><label>額外折扣</label><input class="ops-input ops-number-clean" type="number" min="0" step="1" name="discount" value="'+sale.manualDiscount+'"></div>'+pointFields+'<div class="ops-field '+(sale.paymentStatus==='partial'?'':'hidden')+'" id="saleEditReceivedField"><label>本次已收</label><input class="ops-input ops-number-clean" type="number" min="0" step="1" name="receivedAmount" value="'+sale.receivedAmount+'"></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button soft" type="button" data-action="sale-return" data-id="'+attr(sale.id)+'">退貨／報廢</button><button class="ops-button primary" type="submit">儲存修改</button></div></form>');
  }
  async function saveSaleEdit(form){
    const id=clean(form.dataset.id),data=new FormData(form),saleRef=state.db.collection(COLLECTIONS.sales).doc(id),formRows=queryAll('[data-sale-edit-row]',form),requestedItems=formRows.map(function(row){return {productId:clean(query('[name="productId"]',row).value),qty:Math.max(1,Math.floor(Number(query('[name="qty"]',row).value||1))),unitPrice:Math.max(0,Number(query('[name="unitPrice"]',row).value||0))};}),paymentMethod=clean(data.get('paymentMethod'))||'現金',paymentStatus=clean(data.get('paymentStatus'))||'paid',manualDiscount=Math.max(0,numberOrNull(data.get('discount'))||0),requestedPoints=Math.max(0,Math.floor(numberOrNull(data.get('pointsToRedeem'))||0)),earnPointsEnabled=data.get('earnPointsEnabled')==='true',existingReceivable=state.receivables.find(function(x){return x.saleId===id;})||null,receivableRef=existingReceivable?state.db.collection(COLLECTIONS.receivables).doc(existingReceivable.id):state.db.collection(COLLECTIONS.receivables).doc();if(!requestedItems.length)throw new Error('單據沒有可修改的商品');
    await state.db.runTransaction(async function(tx){
      const saleSnap=await tx.get(saleRef);if(!saleSnap.exists)throw new Error('找不到單據');const rawSale=saleSnap.data()||{},oldItems=Array.isArray(rawSale.items)?rawSale.items:[],productRefs=requestedItems.map(function(x){return state.db.collection(COLLECTIONS.products).doc(x.productId);}),productSnaps=[];for(const ref of productRefs)productSnaps.push(await tx.get(ref));const customerRef=rawSale.customerId?state.db.collection(COLLECTIONS.customers).doc(rawSale.customerId):null,customerSnap=customerRef?await tx.get(customerRef):null,receivableSnap=existingReceivable?await tx.get(receivableRef):null;if(paymentStatus!=='paid'&&!customerRef)throw new Error('門市散客不能使用未收款');if(paymentStatus!=='paid'&&requestedPoints>0)throw new Error('未收款不能使用點數');
      const prepared=[];let subtotal=0,costTotal=0,unknownCostQty=0;productSnaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品不存在');const requested=requestedItems[index],oldItem=oldItems.find(function(x){return clean(x.productId)===requested.productId;});if(!oldItem)throw new Error('單據商品不一致');const raw=snap.data()||{},restored=restoreSaleItemToStock(raw,oldItem);if(restored.stock<requested.qty)throw new Error(clean(oldItem.name)+' 庫存不足');const fifo=consumeFifo(restored.raw,requested.qty),after=restored.stock-requested.qty,lineTotal=requested.qty*requested.unitPrice;subtotal+=lineTotal;costTotal+=fifo.costTotal;unknownCostQty+=fifo.unknownCostQty;prepared.push({ref:productRefs[index],raw:raw,oldItem:oldItem,requested:requested,fifo:fifo,after:after,lineTotal:lineTotal});});
      const customerRaw=customerSnap&&customerSnap.exists?(customerSnap.data()||{}):null,isMember=customerRaw&&(clean(rawSale.customerType)==='member'||clean(customerRaw.customerType)==='member'),oldRedeemed=Math.max(0,Math.floor(Number(rawSale.pointsRedeemed||0))),customerForLimit=isMember?Object.assign({},normalizeCustomer(Object.assign({__id:clean(rawSale.customerId)},customerRaw)),{pointBalance:Math.max(0,Number(customerRaw.pointBalance||0))+oldRedeemed}):null,maxPoints=isMember?maxRedeemablePoints(customerForLimit,Math.max(0,subtotal-manualDiscount)):0;if(requestedPoints>maxPoints)throw new Error('修改後可使用點數不足');const pointValue=pointDiscount(requestedPoints,rawSale.soldAt||new Date()),total=Math.max(0,subtotal-manualDiscount-pointValue),loggedPayments=sum(state.receivablePayments.filter(function(x){return x.saleId===id;}),function(x){return x.amount;}),enteredReceived=numberOrNull(data.get('receivedAmount')),receivedAmount=paymentStatus==='paid'?total:paymentStatus==='unpaid'?0:Math.min(total,Math.max(loggedPayments,enteredReceived||0));if(paymentStatus==='partial'&&(receivedAmount<=0||receivedAmount>=total))throw new Error('部分收款金額必須大於 0 且小於應收金額');const rewardPoints=isMember&&earnPointsEnabled?calculatePreparedRewardPoints(prepared,total,subtotal,rawSale.soldAt||new Date()):0,newEarned=paymentStatus==='paid'?rewardPoints:0,oldEarned=Math.max(0,Number(rawSale.pointsEarned||0)),pointDelta=(oldRedeemed-requestedPoints)+(newEarned-oldEarned),newPending=paymentStatus!=='paid'?rewardPoints:0;
      if(pointDelta){if(!customerRaw)throw new Error('找不到會員資料');const oldBalance=Math.max(0,Number(customerRaw.pointBalance||0)),newBalance=oldBalance+pointDelta;if(newBalance<0)throw new Error('會員點數已被後續使用，請先補收點數差額後再修改');tx.update(customerRef,{pointBalance:newBalance,updatedAt:serverTimestamp()});const pointRef=state.db.collection(COLLECTIONS.points).doc();tx.set(pointRef,{customerId:clean(rawSale.customerId),saleId:id,type:'saleEdit',points:pointDelta,balanceAfter:newBalance,note:clean(rawSale.saleNo),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}
      tx.set(saleRef,{items:prepared.map(function(x){return {productId:x.requested.productId,name:clean(x.oldItem.name),sku:clean(x.oldItem.sku),imageUrl:clean(x.oldItem.imageUrl),qty:x.requested.qty,unitPrice:x.requested.unitPrice,lineTotal:x.lineTotal,lineCost:x.fifo.costTotal,fifoBreakdown:x.fifo.breakdown,unknownCostQty:x.fifo.unknownCostQty,rewardPercent:productRewardPercent(x.raw,rawSale.soldAt||new Date())};}),subtotal:subtotal,manualDiscount:manualDiscount,pointDiscount:pointValue,discount:manualDiscount+pointValue,total:total,costTotal:costTotal,grossProfit:total-costTotal,unknownCostQty:unknownCostQty,paymentMethod:paymentMethod,paymentStatus:paymentStatus,receivedAmount:receivedAmount,pointsRedeemed:requestedPoints,earnPointsEnabled:earnPointsEnabled,pointsEarned:newEarned,pendingPointsEarned:newPending,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});
      prepared.forEach(function(x){tx.update(x.ref,{currentStock:x.after,costLayers:x.fifo.layers,averageCost:x.fifo.averageCost,inventoryValue:x.fifo.inventoryValue,costIncomplete:x.fifo.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});const oldQty=Math.max(0,Number(x.oldItem.qty||0)),delta=oldQty-x.requested.qty;if(delta){const inventoryRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(inventoryRef,{type:'saleCorrection',productId:x.requested.productId,productName:clean(x.oldItem.name),sku:clean(x.oldItem.sku),qtyChange:delta,beforeStock:Number(x.raw.currentStock||0),afterStock:x.after,referenceType:'storeSaleEdit',referenceId:clean(rawSale.saleNo),note:'修改銷售單據',occurredAt:serverTimestamp(),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}});
      if(paymentStatus==='paid'){if(receivableSnap&&receivableSnap.exists)tx.delete(receivableRef);}else{tx.set(receivableRef,{receivableNo:existingReceivable?existingReceivable.receivableNo:uid('AR'),sourceType:'sale',saleId:id,saleNo:clean(rawSale.saleNo),customerId:clean(rawSale.customerId),customerName:clean(rawSale.customerName),totalAmount:total,receivedAmount:receivedAmount,outstandingAmount:total-receivedAmount,status:paymentStatus,updatedAt:serverTimestamp(),updatedBy:userLabel(),createdAt:existingReceivable?existingReceivable.createdAt:serverTimestamp(),version:VERSION},{merge:true});}
    });
    await writeAudit('修改銷售單據','storeSale',id,id);closeDrawer();toast('單據已修改','','success');await loadAll(true);
  }
  function returnedQtyForItem(saleId,productId){return sum(state.salesReturns.filter(function(row){return row.saleId===saleId;}).flatMap(function(row){return row.items||[];}).filter(function(item){return clean(item.productId)===clean(productId);}),function(item){return Number(item.qty||0);});}
  function returnPreview(form){
    const sale=state.sales.find(function(x){return x.id===clean(form.dataset.id);});if(!sale)return;const customer=state.customers.find(function(x){return x.id===sale.customerId;})||null,rows=queryAll('[data-return-row]',form),returned=sum(rows,function(row){const item=sale.items[Number(row.dataset.index)],qty=Math.max(0,Math.min(Number(item.qty||0),Math.floor(Number(query('[name="qty"]',row).value||0))));return Number(item.lineTotal||0)*(qty/Math.max(1,Number(item.qty||1)));}),ratio=Number(sale.subtotal||0)>0?Math.min(1,returned/Number(sale.subtotal||0)):0,refund=Math.round(Number(sale.total||0)*ratio),restore=Math.round(Number(sale.pointsRedeemed||0)*ratio),reverse=Math.round(Number(sale.pointsEarned||0)*ratio),shortfall=customer?Math.max(0,reverse-(Number(customer.pointBalance||0)+restore)):0;setText('returnRefundAmount',money(refund));setText('returnPointsRestore',formatNumber(restore)+' 點');setText('returnPointsReverse',formatNumber(reverse)+' 點');setText('returnPointShortfall',shortfall?formatNumber(shortfall)+' 點需補收':'無');
  }
  function openSaleReturn(id){
    const sale=state.sales.find(function(x){return x.id===id;});if(!sale)return;const customer=state.customers.find(function(x){return x.id===sale.customerId;})||null,rows=sale.items.map(function(item,index){const remaining=Math.max(0,Number(item.qty||0)-returnedQtyForItem(sale.id,item.productId));return '<div class="ops-return-row" data-return-row data-index="'+index+'"><div><b>'+escapeHtml(item.name)+'</b><span>'+escapeHtml(item.sku||'')+'・可退 '+formatNumber(remaining)+'</span></div><label>退貨數量<input class="ops-input ops-number-clean" type="number" min="0" max="'+remaining+'" step="1" name="qty" value="0" '+(remaining?'':'disabled')+'></label><label>處理<select class="ops-select" name="disposition"><option value="restock">回庫存</option><option value="scrap">瑕疵報廢</option></select></label></div>';}).join('');
    const memberFields=customer&&customer.customerType==='member'?'<div class="ops-member-payment-summary"><div><span>會員</span><b>'+escapeHtml(customer.name)+' '+escapeHtml(customer.memberNo||'')+'</b></div><div><span>目前點數</span><b>'+formatNumber(customer.pointBalance)+' 點</b></div><div><span>退還已用點數</span><b id="returnPointsRestore">0 點</b></div><div><span>扣回本單累積</span><b id="returnPointsReverse">0 點</b></div><div><span>點數不足</span><b id="returnPointShortfall">無</b></div></div><div class="ops-field"><label>點數不足處理</label><select class="ops-select" name="pointRecoveryMode"><option value="cash">現金補收</option><option value="receivable">登記未收款</option></select></div>':'';
    openDrawer('退貨／報廢',sale.saleNo,'<form id="saleReturnForm" data-id="'+attr(sale.id)+'"><div class="ops-summary-list"><div class="ops-summary-line"><span>原單實收</span><b>'+money(sale.total)+'</b></div><div class="ops-summary-line"><span>本次退款</span><b id="returnRefundAmount">NT$ 0</b></div></div>'+memberFields+'<div class="ops-return-items">'+rows+'</div><div class="ops-form-grid"><div class="ops-field"><label>退款方式</label><select class="ops-select" name="refundMethod"><option>'+escapeHtml(sale.paymentMethod||'現金')+'</option><option>現金</option><option>信用卡</option><option>轉帳</option></select></div><div class="ops-field full"><label>退貨原因</label><input class="ops-input" name="note" required></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">確認退貨</button></div></form>');
  }
  async function saveSaleReturn(form){
    const id=clean(form.dataset.id),sale=state.sales.find(function(x){return x.id===id;});if(!sale)throw new Error('找不到原始單據');const data=new FormData(form),rowEls=queryAll('[data-return-row]',form),requested=[];rowEls.forEach(function(row){const index=Number(row.dataset.index),item=sale.items[index],already=returnedQtyForItem(sale.id,item.productId),qty=Math.max(0,Math.min(Math.max(0,Number(item.qty||0)-already),Math.floor(Number(query('[name="qty"]',row).value||0))));if(qty)requested.push({item:item,qty:qty,disposition:clean(query('[name="disposition"]',row).value)||'restock'});});if(!requested.length)throw new Error('請至少填寫一項退貨數量');
    const saleRef=state.db.collection(COLLECTIONS.sales).doc(id),returnRef=state.db.collection(COLLECTIONS.salesReturns).doc(),refundIncomeRef=state.db.collection(COLLECTIONS.incomes).doc(),returnNo=uid('RET'),customerRef=sale.customerId?state.db.collection(COLLECTIONS.customers).doc(sale.customerId):null;
    await state.db.runTransaction(async function(tx){
      const saleSnap=await tx.get(saleRef);if(!saleSnap.exists)throw new Error('找不到原始單據');const rawSale=saleSnap.data()||{},customerSnap=customerRef?await tx.get(customerRef):null,restockItems=requested.filter(function(row){return row.disposition==='restock';}),productRefs=restockItems.map(function(row){return state.db.collection(COLLECTIONS.products).doc(row.item.productId);}),productSnaps=[];for(const ref of productRefs)productSnaps.push(await tx.get(ref));
      const previousReturns=state.salesReturns.filter(function(row){return row.saleId===id;}),previousRefund=sum(previousReturns,function(row){return Number(row.refundAmount||0);}),previousRestore=sum(previousReturns,function(row){return Number(row.pointsRestored||0);}),previousReverse=sum(previousReturns,function(row){return Number(row.pointsReversed||0);}),returnedGross=sum(requested,function(row){return Number(row.item.lineTotal||0)*(row.qty/Math.max(1,Number(row.item.qty||1)));}),restockedCost=sum(requested.filter(function(row){return row.disposition==='restock';}),function(row){return Number(row.item.lineCost||0)*(row.qty/Math.max(1,Number(row.item.qty||1)));}),ratio=Number(rawSale.subtotal||0)>0?Math.min(1,returnedGross/Number(rawSale.subtotal||0)):0,refundAmount=Math.min(Math.max(0,Number(rawSale.total||0)-previousRefund),Math.round(Number(rawSale.total||0)*ratio)),pointsRestored=Math.min(Math.max(0,Number(rawSale.pointsRedeemed||0)-previousRestore),Math.round(Number(rawSale.pointsRedeemed||0)*ratio)),pointsReversed=Math.min(Math.max(0,Number(rawSale.pointsEarned||0)-previousReverse),Math.round(Number(rawSale.pointsEarned||0)*ratio)),customerRaw=customerSnap&&customerSnap.exists?(customerSnap.data()||{}):null,isMember=customerRaw&&clean(customerRaw.customerType)==='member',startingBalance=Math.max(0,Number(customerRaw&&customerRaw.pointBalance||0)),requestedBalance=startingBalance+pointsRestored-pointsReversed,pointRecoveryAmount=isMember?Math.max(0,-requestedBalance):0,newBalance=isMember?Math.max(0,requestedBalance):0;
      const returnItems=requested.map(function(row){return {productId:row.item.productId,name:row.item.name,sku:row.item.sku,qty:row.qty,disposition:row.disposition,lineAmount:Number(row.item.lineTotal||0)*(row.qty/Math.max(1,Number(row.item.qty||1)))};});
      tx.set(returnRef,{returnNo:returnNo,saleId:id,saleNo:clean(rawSale.saleNo),customerId:clean(rawSale.customerId),customerName:clean(rawSale.customerName),items:returnItems,refundAmount:refundAmount,restockedCost:restockedCost,refundMethod:clean(data.get('refundMethod'))||clean(rawSale.paymentMethod),pointsRestored:pointsRestored,pointsReversed:pointsReversed,pointRecoveryAmount:pointRecoveryAmount,pointRecoveryMode:clean(data.get('pointRecoveryMode'))||'cash',note:clean(data.get('note')),status:'completed',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      tx.set(refundIncomeRef,{incomeNo:returnNo+'-REFUND',occurredAt:new Date(),category:'商品退貨退款',amount:-refundAmount,paymentMethod:clean(data.get('refundMethod'))||clean(rawSale.paymentMethod),paymentStatus:'paid',receivedAmount:-refundAmount,customerId:clean(rawSale.customerId),customerName:clean(rawSale.customerName),note:returnNo,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      if(isMember){const appliedDelta=newBalance-startingBalance;if(appliedDelta){const pointRef=state.db.collection(COLLECTIONS.points).doc();tx.update(customerRef,{pointBalance:newBalance,updatedAt:serverTimestamp()});tx.set(pointRef,{customerId:clean(rawSale.customerId),saleId:id,type:'return',points:appliedDelta,balanceAfter:newBalance,note:returnNo,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}if(pointRecoveryAmount){if(clean(data.get('pointRecoveryMode'))==='receivable'){const arRef=state.db.collection(COLLECTIONS.receivables).doc();tx.set(arRef,{receivableNo:uid('AR'),sourceType:'returnPointRecovery',returnId:returnRef.id,saleId:id,saleNo:clean(rawSale.saleNo),customerId:clean(rawSale.customerId),customerName:clean(rawSale.customerName),totalAmount:pointRecoveryAmount,receivedAmount:0,outstandingAmount:pointRecoveryAmount,status:'unpaid',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}else{const recoveryRef=state.db.collection(COLLECTIONS.incomes).doc();tx.set(recoveryRef,{incomeNo:returnNo+'-POINT',occurredAt:new Date(),category:'退貨點數補收',amount:pointRecoveryAmount,paymentMethod:'現金',paymentStatus:'paid',receivedAmount:pointRecoveryAmount,customerId:clean(rawSale.customerId),customerName:clean(rawSale.customerName),note:returnNo,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}}}
      restockItems.forEach(function(row,index){if(!productSnaps[index].exists)throw new Error('找不到商品主檔，無法回庫：'+clean(row.item.name));const raw=productSnaps[index].data()||{},restored=restoreSaleItemToStock(raw,row.item,row.qty),stats=costLayerStats(restored.raw),inventoryRef=state.db.collection(COLLECTIONS.inventory).doc();tx.update(productRefs[index],{currentStock:restored.stock,costLayers:restored.raw.costLayers,averageCost:stats.averageCost,inventoryValue:stats.inventoryValue,costIncomplete:stats.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});queueInventorySyncInTransaction(tx,row.item.productId,row.item.sku,restored.stock,'storeReturn');tx.set(inventoryRef,{type:'saleReturn',productId:row.item.productId,productName:row.item.name,sku:row.item.sku,qtyChange:row.qty,beforeStock:Number(raw.currentStock||0),afterStock:restored.stock,referenceType:'storeSaleReturn',referenceId:returnNo,note:'退貨回庫｜'+clean(data.get('note')),occurredAt:serverTimestamp(),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
      requested.filter(function(row){return row.disposition==='scrap';}).forEach(function(row){const inventoryRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(inventoryRef,{type:'saleReturnScrap',productId:row.item.productId,productName:row.item.name,sku:row.item.sku,qtyChange:0,referenceType:'storeSaleReturn',referenceId:returnNo,note:'退貨報廢｜'+clean(data.get('note')),occurredAt:serverTimestamp(),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
      const oldReturned=Math.max(0,Number(rawSale.returnedAmount||0)),oldReturnedCost=Math.max(0,Number(rawSale.returnedCost||0)),newReturned=oldReturned+refundAmount;tx.set(saleRef,{returnedAmount:newReturned,returnedCost:oldReturnedCost+restockedCost,returnStatus:newReturned>=Number(rawSale.total||0)?'returned':'partialReturn',updatedAt:serverTimestamp(),updatedBy:userLabel()},{merge:true});
    });
    await writeAudit('完成退貨','storeSaleReturn',returnRef.id,returnNo);closeDrawer();toast('退貨已完成',returnNo,'success');await loadAll(true);
  }
  function openSalesHistory(){
    const rows=state.sales.sort(function(a,b){return (dateFrom(b.soldAt)||0)-(dateFrom(a.soldAt)||0);}).slice(0,100);
    const body=rows.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>時間／單號</th><th>品項</th><th>付款</th><th class="num">收入</th><th class="num">成本</th><th class="num">毛利</th></tr></thead><tbody>'+rows.map(function(x){return '<tr><td>'+escapeHtml(dateTimeText(x.soldAt))+'<br><small>'+escapeHtml(x.saleNo)+'</small></td><td>'+x.items.length+' 項<br><small>'+escapeHtml(x.items.map(function(i){return i.name;}).slice(0,2).join('、'))+'</small></td><td>'+escapeHtml(x.paymentMethod||'—')+'</td><td class="num">'+money(x.total)+'</td><td class="num">'+money(x.costTotal)+'</td><td class="num"><b>'+money(x.grossProfit)+'</b></td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('尚無銷售紀錄','完成現場銷售後會顯示。');
    openDrawer('現場銷售紀錄','最近 100 筆現場商品銷售。',body+'<div class="ops-drawer-footer"><button class="ops-button primary" data-action="drawer-close">關閉</button></div>');
  }

  function purchaseItemOptions(selectedId){return state.catalog.filter(function(p){return p.initialized;}).sort(function(a,b){return (a.originalName||a.name).localeCompare(b.originalName||b.name,'zh-Hant');}).map(function(p){return '<option value="'+attr(p.docId)+'" '+(p.docId===selectedId?'selected':'')+'>'+escapeHtml((p.sku?p.sku+'｜':'')+(p.originalName||p.name))+'</option>';}).join('');}
  function openPurchase(preselectedId){const first=preselectedId||((state.catalog.find(function(p){return p.initialized;})||{}).docId||'');openDrawer('新增進貨入庫','每次進貨都建立新的 FIFO 成本批次；銷售時先扣最早批次。','<form id="purchaseForm"><div class="ops-form-grid"><div class="ops-field"><label class="ops-required">到貨時間</label><input class="ops-input" type="datetime-local" name="receivedAt" value="'+inputDateTime(new Date())+'" required></div><div class="ops-field"><label class="ops-required">供應商</label><input class="ops-input" name="supplier" required></div><div class="ops-field"><label>額外費用</label><input class="ops-input" type="number" min="0" step="1" name="extraCost" value="0"><small>運費、關稅按商品金額比例分攤到批次成本。</small></div><div class="ops-field"><label>進貨單號／外部編號</label><input class="ops-input" name="externalNo"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note"></textarea></div></div><div class="ops-section-title">進貨商品</div><div id="purchaseItems">'+purchaseRowHtml(first,0)+'</div><button class="ops-button soft small" type="button" data-action="purchase-add-row">＋ 增加商品</button><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">確認驗收入庫</button></div></form>');}
  function purchaseRowHtml(selectedId,index){return '<div class="ops-cart-row purchase-row" data-index="'+index+'" style="grid-template-columns:minmax(0,1fr) 80px 110px 34px;margin-bottom:8px"><select class="ops-select" name="productId" required><option value="">選擇商品</option>'+purchaseItemOptions(selectedId)+'</select><input type="number" name="qty" min="1" step="1" value="1" required><input type="number" name="unitCost" min="0" step="0.01" placeholder="單位成本" required><button class="ops-icon-button" type="button" data-action="purchase-remove-row">×</button></div>';}
  async function savePurchase(form){
    const data=new FormData(form),rowEls=queryAll('.purchase-row',form),items=[];rowEls.forEach(function(row){const productId=clean(query('[name="productId"]',row).value),qty=numberOrNull(query('[name="qty"]',row).value),unitCost=numberOrNull(query('[name="unitCost"]',row).value);if(productId&&qty>0&&unitCost!=null)items.push({productId:productId,qty:Math.round(qty),unitCost:unitCost});});if(!items.length)throw new Error('至少需要一個有效進貨商品');const duplicate=new Set();for(const item of items){if(duplicate.has(item.productId))throw new Error('同一商品請合併成一列');duplicate.add(item.productId);}const extraCost=numberOrNull(data.get('extraCost'))||0,receivedAt=new Date(clean(data.get('receivedAt')));if(Number.isNaN(receivedAt.getTime()))throw new Error('到貨時間不正確');const purchaseNo=uid('PUR'),purchaseRef=state.db.collection(COLLECTIONS.purchases).doc();
    await state.db.runTransaction(async function(tx){const refs=items.map(function(item){return state.db.collection(COLLECTIONS.products).doc(item.productId);}),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));const subtotal=sum(items,function(i){return i.qty*i.unitCost;}),prepared=[];snaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品主檔不存在');const raw=snap.data()||{},item=items[index],before=Number(raw.currentStock||0),base=item.qty*item.unitCost,allocated=subtotal>0?extraCost*(base/subtotal):0,effectiveUnit=item.unitCost+(item.qty?allocated/item.qty:0),after=before+item.qty,added=addFifoLayer(raw,item.qty,effectiveUnit,{layerId:purchaseNo+'-'+index,receivedAt:receivedAt.toISOString(),referenceType:'purchase',referenceId:purchaseNo});prepared.push({ref:refs[index],raw:raw,item:item,before:before,after:after,allocated:allocated,effectiveUnit:effectiveUnit,added:added});});
      tx.set(purchaseRef,{purchaseNo:purchaseNo,externalNo:clean(data.get('externalNo')),receivedAt:receivedAt,supplier:clean(data.get('supplier')),items:prepared.map(function(x){return {productId:x.item.productId,name:clean(x.raw.internalName||x.raw.originalName||x.raw.onlineName),sku:clean(x.raw.internalSku),qty:x.item.qty,unitCost:x.item.unitCost,allocatedExtraCost:x.allocated,effectiveUnitCost:x.effectiveUnit,lineTotal:x.item.qty*x.item.unitCost,layerId:x.added.layers[x.added.layers.length-1].layerId};}),subtotal:subtotal,extraCost:extraCost,totalCost:subtotal+extraCost,costMethod:'FIFO',note:clean(data.get('note')),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      prepared.forEach(function(x){tx.update(x.ref,{currentStock:x.after,latestPurchaseCost:x.item.unitCost,costLayers:x.added.layers,averageCost:x.added.averageCost,inventoryValue:x.added.inventoryValue,costIncomplete:x.added.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});queueInventorySyncInTransaction(tx,x.item.productId,clean(x.raw.internalSku),x.after,'purchase');const tRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(tRef,{type:'purchase',productId:x.item.productId,productName:clean(x.raw.internalName||x.raw.originalName||x.raw.onlineName),sku:clean(x.raw.internalSku),qtyChange:x.item.qty,beforeStock:x.before,afterStock:x.after,unitCost:x.effectiveUnit,costMethod:'FIFO',referenceType:'purchase',referenceId:purchaseNo,note:'進貨入庫｜'+clean(data.get('supplier')),occurredAt:receivedAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
    });await writeAudit('進貨驗收入庫','purchase',purchaseRef.id,purchaseNo+'｜'+clean(data.get('supplier'))+'｜'+items.length+'項｜FIFO');closeDrawer();toast('進貨入庫完成',purchaseNo,'success');await loadAll(true);
  }
  function openAdjustment(preselectedId){openDrawer('盤點／庫存調整','輸入盤點後實際庫存；增加數量會使用目前最近成本建立調整批次，減少數量會依 FIFO 扣除。','<form id="adjustmentForm"><div class="ops-form-grid"><div class="ops-field full"><label class="ops-required">商品</label><select class="ops-select" name="productId" required><option value="">選擇商品</option>'+purchaseItemOptions(preselectedId||'')+'</select></div><div class="ops-field"><label class="ops-required">盤點後實際庫存</label><input class="ops-input" type="number" step="1" name="afterStock" required></div><div class="ops-field"><label>異動日期</label><input class="ops-input" type="datetime-local" name="occurredAt" value="'+inputDateTime(new Date())+'"></div><div class="ops-field full"><label class="ops-required">原因／備註</label><textarea class="ops-textarea" name="note" required></textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">確認調整</button></div></form>');}
  async function saveAdjustment(form){const data=new FormData(form),productId=clean(data.get('productId')),afterStock=numberOrNull(data.get('afterStock'));if(!productId||afterStock==null)throw new Error('請選擇商品並填寫盤點後庫存');const occurredAt=new Date(clean(data.get('occurredAt'))),ref=state.db.collection(COLLECTIONS.products).doc(productId);let productName='',sku='',before=0;
    await state.db.runTransaction(async function(tx){const snap=await tx.get(ref);if(!snap.exists)throw new Error('商品主檔不存在');const raw=snap.data()||{};before=Number(raw.currentStock||0);productName=clean(raw.internalName||raw.originalName||raw.onlineName);sku=clean(raw.internalSku);const latest=numberOrNull(firstValue(raw,['latestPurchaseCost','averageCost']));const adjusted=adjustFifoLayers(raw,afterStock,latest,{layerId:uid('ADJ-LAYER'),receivedAt:occurredAt.toISOString(),referenceType:'stocktakeIncrease',referenceId:'ADJ'});tx.update(ref,{currentStock:afterStock,costLayers:adjusted.layers,averageCost:adjusted.averageCost,inventoryValue:adjusted.inventoryValue,costIncomplete:adjusted.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});queueInventorySyncInTransaction(tx,productId,sku,afterStock,'adjustment');const tRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(tRef,{type:'adjustment',productId:productId,productName:productName,sku:sku,qtyChange:afterStock-before,beforeStock:before,afterStock:afterStock,unitCost:latest,costMethod:'FIFO',referenceType:'stocktake',referenceId:uid('ADJ'),note:clean(data.get('note')),occurredAt:occurredAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});await writeAudit('盤點調整庫存','inventory',productId,productName+'｜'+before+' → '+afterStock+'｜FIFO');closeDrawer();toast('庫存已調整',productName+'：'+before+' → '+afterStock,'success');await loadAll(true);}

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
    const header=['code','name','salePrice','purchasePrice','withoutWarehouseStocks','reservedStock','safetyStock','onlineName','onlinePrice','matchedOnline','imageUrl','saleRewardPercent','remark'];
    const rows=state.catalog.filter(function(p){return p.initialized;}).map(function(p){const i=p.internal||{};return [p.sku,p.originalName||'',p.storePrice==null?'':p.storePrice,p.latestPurchaseCost==null?'':p.latestPurchaseCost,p.currentStock,p.reservedStock,p.safetyStock,p.onlineName||'',p.onlinePrice==null?'':p.onlinePrice,p.matchedOnline?'是':'否',p.imageUrl||'',p.saleRewardPercent==null?'':p.saleRewardPercent,i.note||''];});
    const csv='\uFEFF'+[header].concat(rows).map(function(r){return r.map(csvCell).join(',');}).join('\r\n'); downloadBlob('營運中心_商品主檔匯入範本_'+dateText(new Date())+'.csv',csv,'text/csv;charset=utf-8');
  }
  function exportBackup(){
    const payload={exportedAt:new Date().toISOString(),version:VERSION,projectId:(global.APP_CONFIG&&APP_CONFIG.FIREBASE_CONFIG&&APP_CONFIG.FIREBASE_CONFIG.projectId)||'',onlineSource:state.onlineSource,data:{internalProducts:state.internalProducts,sales:state.sales,salesReturns:state.salesReturns,incomes:state.incomes,customers:state.customers,pointTransactions:state.pointTransactions,receivables:state.receivables,receivablePayments:state.receivablePayments,membershipSettings:state.membershipSettings,purchases:state.purchases,inventoryTransactions:state.inventory,rentalLedgers:state.rentalLedgers,cases:state.cases,expenses:state.expenses,syncJobs:state.syncJobs,educationDaily:state.educationDaily,auditLogs:state.audit}};
    downloadBlob('全通路營運中心_備份_'+dateText(new Date())+'.json',JSON.stringify(payload,null,2),'application/json;charset=utf-8'); toast('備份已下載','請妥善保存 JSON 檔。','success');
  }
  function exportFinance(){
    const sales=rangeRows(state.sales,function(x){return x.soldAt;}); const incomes=rangeRows(state.incomes,function(x){return x.occurredAt;}); const expenses=rangeRows(state.expenses,function(x){return x.occurredAt;}); const rows=[['日期','類型','編號／類別','收入','成本／支出','付款方式','備註']];
    sales.forEach(function(x){rows.push([dateTimeText(x.soldAt),'現場銷售',x.saleNo,x.total,x.costTotal,x.paymentMethod,x.note]);}); incomes.forEach(function(x){rows.push([dateTimeText(x.occurredAt),'快速收入',x.category,x.amount,0,x.paymentMethod,x.note]);}); expenses.forEach(function(x){rows.push([dateTimeText(x.occurredAt),'一般支出',x.category,0,x.amount,x.paymentMethod,x.note]);});
    const csv='\uFEFF'+rows.map(function(r){return r.map(csvCell).join(',');}).join('\r\n'); downloadBlob('營運中心_收支報表_'+state.financeRange+'_'+dateText(new Date())+'.csv',csv,'text/csv;charset=utf-8');
  }

  function openImport(){
    const firstImport=state.matchingStats.central===0;
    openDrawer('匯入原始商品 Excel','中央商品以 Excel 的 code 為唯一 SKU；EasyStore 只用來補網路名稱、價格與圖片。','<div class="ops-callout green"><b>正確欄位：</b> code＝SKU、name＝原始名稱、salePrice＝原始定價、purchasePrice＝期初成本、withoutWarehouseStocks＝現有庫存。</div><label class="ops-file-drop" id="importDrop"><input type="file" id="importFile" accept=".xlsx,.xls,.csv"><b>點這裡選擇原始 Excel</b><p>檔案只在瀏覽器解析，不會上傳到 GitHub。確認後才寫入 Firebase。</p></label><div class="ops-form-grid" style="margin-top:14px"><div class="ops-field full"><label>匯入方式</label><select class="ops-select" id="importMode"><option value="initial" '+(firstImport?'selected':'')+'>初次建置：匯入名稱、定價、成本與現有庫存，建立期初 FIFO 批次</option><option value="basic" '+(!firstImport?'selected':'')+'>更新基本資料：更新名稱、定價與參考成本，不覆蓋目前庫存及 FIFO 批次</option></select></div></div><div id="importPreview" style="margin-top:14px"></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="button" data-action="confirm-import" id="confirmImportBtn" disabled>確認匯入中央主檔</button></div>');
  }
  function normalizedHeader(value){return lower(value).replace(/[\s_\-\/（）()]/g,'');}
  function importValue(row,names){const keys=Object.keys(row||{});for(const name of names){const target=normalizedHeader(name);const key=keys.find(function(k){return normalizedHeader(k)===target;});if(key!==undefined&&hasValue(row[key]))return row[key];}return '';}
  async function parseImportFile(file){
    if(!file)return;state.importFileName=file.name;let rows=[];if(/\.csv$/i.test(file.name)){const text=await file.text();const wb=XLSX.read(text,{type:'string'}),ws=wb.Sheets[wb.SheetNames[0]];rows=XLSX.utils.sheet_to_json(ws,{defval:''});}else if(global.XLSX){const data=await file.arrayBuffer(),wb=XLSX.read(data,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]];rows=XLSX.utils.sheet_to_json(ws,{defval:''});}else throw new Error('Excel 解析元件尚未載入');
    state.importRows=rows.map(function(row,index){const sku=normalizeCode(importValue(row,['code','internalSku','sku','商品編號','內部商品編號'])),name=clean(importValue(row,['name','internalName','商品名稱','品名'])),cost=numberOrNull(importValue(row,['purchasePrice','latestPurchaseCost','進貨成本','最近進貨成本'])),stock=numberOrNull(importValue(row,['withoutWarehouseStocks','currentStock','stock','庫存','現有庫存']));return {row:index+2,internalSku:sku,internalName:name,storePrice:numberOrNull(importValue(row,['salePrice','storePrice','門市售價','售價'])),latestPurchaseCost:cost,currentStock:stock,saleRewardPercent:numberOrNull(importValue(row,['saleRewardPercent','獎金比例'])),note:clean(importValue(row,['remark','note','備註']))};}).filter(function(r){return r.internalSku||r.internalName;});
    const valid=state.importRows.filter(function(r){return r.internalSku;}),missingName=valid.filter(function(r){return !r.internalName;}).length,negative=valid.filter(function(r){return r.currentStock!=null&&r.currentStock<0;}).length,missingCost=valid.filter(function(r){return r.latestPurchaseCost==null;}).length,zeroCost=valid.filter(function(r){return r.latestPurchaseCost===0;}).length,positive=valid.filter(function(r){return r.currentStock>0;}).length,onlineSku=new Set(state.onlineProducts.map(function(x){return x.sku;}).filter(Boolean)),matched=valid.filter(function(r){return onlineSku.has(r.internalSku);}).length;
    state.importSummary={total:state.importRows.length,valid:valid.length,missingName:missingName,negative:negative,missingCost:missingCost,zeroCost:zeroCost,positive:positive,matched:matched};
    html('importPreview','<div class="ops-summary-list"><div class="ops-summary-line"><span>檔案</span><b>'+escapeHtml(file.name)+'</b></div><div class="ops-summary-line"><span>有效 SKU</span><b>'+formatNumber(valid.length)+'</b></div><div class="ops-summary-line"><span>預估可配對網路商品</span><b>'+formatNumber(matched)+'</b></div><div class="ops-summary-line"><span>有正庫存</span><b>'+formatNumber(positive)+'</b></div><div class="ops-summary-line"><span>負庫存（保留原值）</span><b>'+formatNumber(negative)+'</b></div><div class="ops-summary-line"><span>名稱空白</span><b>'+formatNumber(missingName)+'</b></div><div class="ops-summary-line"><span>成本空白／成本為零</span><b>'+formatNumber(missingCost)+' / '+formatNumber(zeroCost)+'</b></div></div>'+(valid.length?'<div class="ops-table-wrap" style="margin-top:12px"><table class="ops-table"><thead><tr><th>列</th><th>SKU</th><th>原始名稱</th><th class="num">定價</th><th class="num">成本</th><th class="num">庫存</th></tr></thead><tbody>'+valid.slice(0,20).map(function(r){return '<tr><td>'+r.row+'</td><td>'+escapeHtml(r.internalSku)+'</td><td>'+escapeHtml(r.internalName||'（名稱空白）')+'</td><td class="num">'+money(r.storePrice)+'</td><td class="num">'+money(r.latestPurchaseCost)+'</td><td class="num">'+formatNumber(r.currentStock)+'</td></tr>';}).join('')+'</tbody></table></div>':''));const btn=byId('confirmImportBtn');if(btn)btn.disabled=!valid.length;
  }
  async function importProducts(){
    const rows=state.importRows.filter(function(r){return r.internalSku;}),mode=(byId('importMode')&&byId('importMode').value)||'initial';if(!rows.length)return;const initial=mode==='initial';const yes=await confirmAction(initial?'確認建立中央商品主檔':'確認更新中央商品基本資料',(initial?'將以 Excel 建立／更新 '+rows.length+' 筆中央商品，匯入真實庫存與期初成本，並建立 FIFO 成本批次。':'將更新 '+rows.length+' 筆名稱、定價與參考成本，不覆蓋目前庫存與 FIFO 批次。')+' 原始網路商品不會被修改。','開始匯入');if(!yes)return;
    const bySku=new Map(state.internalProducts.filter(function(x){return x.internalSku;}).map(function(x){return [x.internalSku,x];}));const activityIds=new Set(state.inventory.map(function(x){return x.productId;}));let processed=0,created=0,updated=0,preserved=0;
    try{
      for(let start=0;start<rows.length;start+=BATCH_SIZE){const batch=state.db.batch();rows.slice(start,start+BATCH_SIZE).forEach(function(r){const existing=bySku.get(r.internalSku),id=existing?existing.docId:('sku_'+hashText(r.internalSku)),ref=state.db.collection(COLLECTIONS.products).doc(id),hasActivity=existing&&activityIds.has(existing.docId),stock=r.currentStock==null?0:r.currentStock,cost=r.latestPurchaseCost,layers=stock>0?[{layerId:'OPENING-'+hashText(r.internalSku),qtyRemaining:stock,originalQty:stock,unitCost:cost,costKnown:cost!=null,receivedAt:new Date().toISOString(),referenceType:'openingExcel',referenceId:state.importFileName}]:[];
        const payload={internalSku:r.internalSku,internalName:r.internalName,originalName:r.internalName,storePrice:r.storePrice,originalSalePrice:r.storePrice,latestPurchaseCost:cost,referencePurchaseCost:cost,note:r.note,status:'active',enabled:true,source:'originalExcel',sourceFile:state.importFileName,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};
        if(r.saleRewardPercent!=null)payload.saleRewardPercent=r.saleRewardPercent;
        if(initial&&(!existing||!hasActivity)){payload.currentStock=stock;payload.openingStock=stock;payload.openingUnitCost=cost;payload.costLayers=layers;const stats=statsFromLayers(layers);payload.averageCost=stats.averageCost!=null?stats.averageCost:cost;payload.inventoryValue=stats.inventoryValue;payload.costIncomplete=stock>0&&(cost==null);payload.importInitialized=true;payload.importedAt=serverTimestamp();if(!existing){payload.reservedStock=0;payload.safetyStock=0;payload.createdAt=serverTimestamp();payload.createdBy=userLabel();created+=1;}else updated+=1;}else{if(existing){updated+=1;if(initial&&hasActivity)preserved+=1;}else{payload.currentStock=stock;payload.openingStock=stock;payload.openingUnitCost=cost;payload.costLayers=layers;const stats=statsFromLayers(layers);payload.averageCost=stats.averageCost!=null?stats.averageCost:cost;payload.inventoryValue=stats.inventoryValue;payload.costIncomplete=stock>0&&(cost==null);payload.importInitialized=true;payload.reservedStock=0;payload.safetyStock=0;payload.createdAt=serverTimestamp();payload.createdBy=userLabel();created+=1;}}
        batch.set(ref,payload,{merge:true});});await batch.commit();processed=Math.min(rows.length,start+BATCH_SIZE);showAlert('中央商品主檔匯入中：'+processed+' / '+rows.length+'，請不要關閉頁面…','');}
      const legacy=state.internalProducts.filter(function(x){return x.autoCreated&&!x.internalSku&&x.enabled!==false;});for(let start=0;start<legacy.length;start+=BATCH_SIZE){const batch=state.db.batch();legacy.slice(start,start+BATCH_SIZE).forEach(function(x){batch.set(state.db.collection(COLLECTIONS.products).doc(x.docId),{enabled:false,status:'legacy-online-shell',updatedAt:serverTimestamp(),updatedBy:userLabel(),note:(x.note?x.note+'｜':'')+'V2 匯入後停用舊版無 SKU 網路外殼'},{merge:true});});await batch.commit();}
      await state.db.collection(COLLECTIONS.imports).add({type:initial?'centralMasterInitialImport':'centralMasterBasicRefresh',fileName:state.importFileName,count:rows.length,created:created,updated:updated,preservedOperationalStock:preserved,legacyShellsDisabled:legacy.length,status:'completed',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});await state.db.collection(COLLECTIONS.settings).doc('centralProductMaster').set({initialized:true,lastImportFile:state.importFileName,lastImportCount:rows.length,lastImportMode:mode,lastImportedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});await writeAudit(initial?'建立中央商品主檔':'更新中央商品基本資料','productImport','',state.importFileName+'｜'+rows.length+' 筆');clearAlert();closeDrawer();toast('中央商品主檔匯入完成','處理 '+rows.length+' 筆；建立 '+created+'、更新 '+updated+(preserved?'、保留已有異動庫存 '+preserved:'')+'。','success');await loadAll(true);
    }catch(error){showAlert('匯入中斷：'+errorMessage(error)+'。已完成的批次會保留，可重新選同一檔案繼續。','error');toast('匯入未完成',errorMessage(error),'error');}
  }

  async function syncEasyStoreApi(){
    if(!(global.firebase&&global.firebase.functions)) return toast('無法同步','頁面未載入 Firebase Functions SDK。','warning');
    const central=state.internalProducts.length;
    if(!central) return toast('尚無中央商品','請先匯入原始商品 Excel。','warning');
    const yes=await confirmAction('從 EasyStore API 同步','將直接讀取 EasyStore 全部商品與規格，以完全相同 SKU 對照 '+central+' 筆中央商品，補入網路名稱、售價與圖片。這個動作只讀 EasyStore，不會修改 EasyStore 商品或庫存。','開始同步');
    if(!yes) return;
    showAlert('正在從 EasyStore API 讀取全部商品、規格與圖片。商品較多時可能需要數分鐘，請勿重複按同步。','info');
    try{
      const callable=global.firebase.app().functions('us-central1').httpsCallable('syncEasyStoreCatalog');
      const response=await callable({force:true});
      const result=(response&&response.data)||{};
      if(!result.ok) throw new Error(result.message||'同步失敗');
      clearAlert();
      toast('EasyStore API 同步完成','父商品 '+formatNumber(result.productCount)+'、規格 SKU '+formatNumber(result.variantCount)+'、配對 '+formatNumber(result.matchedCount)+'、有圖片 '+formatNumber(result.imageMatchedCount),'success');
      await loadAll(true);
    }catch(error){
      console.error(error);
      const message=errorMessage(error);
      toast('EasyStore API 同步失敗',message,'warning');
      showAlert('EasyStore API 同步失敗：'+message,'error');
    }
  }

  function limitText(value,max){return clean(value).slice(0,max||160);}
  function safeSyncNumber(value){const number=Number(value);return Number.isFinite(number)?number:0;}
  function safeSyncRows(rows,max,map){return (Array.isArray(rows)?rows:[]).slice(0,max).map(map);}
  function validSyncDateKey(value){
    const dateKey=clean(value),match=dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match)return false;
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    const date=new Date(year,month-1,day,12,0,0,0);
    return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day;
  }
  function syncDateKeys(startDateKey,endDateKey){
    if(!validSyncDateKey(startDateKey)||!validSyncDateKey(endDateKey))throw new Error('同步日期格式不正確');
    if(startDateKey.slice(0,7)!==endDateKey.slice(0,7)||startDateKey>endDateKey)throw new Error('同步範圍必須是同一個月份');
    const startParts=startDateKey.split('-').map(Number),endParts=endDateKey.split('-').map(Number);
    const cursor=new Date(startParts[0],startParts[1]-1,startParts[2],12,0,0,0),end=new Date(endParts[0],endParts[1]-1,endParts[2],12,0,0,0),keys=[];
    while(cursor<=end&&keys.length<32){
      keys.push(cursor.getFullYear()+'-'+String(cursor.getMonth()+1).padStart(2,'0')+'-'+String(cursor.getDate()).padStart(2,'0'));
      cursor.setDate(cursor.getDate()+1);
    }
    if(!keys.length||keys.length>31)throw new Error('同步日期範圍不正確');
    return keys;
  }
  function sanitizeInjiaoyunPayload(raw){
    if(!raw||typeof raw!=='object')throw new Error('同步資料格式不正確');
    const dateKey=clean(raw.dateKey);
    if(!validSyncDateKey(dateKey))throw new Error('同步日期格式不正確');
    const studioId=limitText(raw.studioId,80);
    if(!studioId)throw new Error('找不到音教雲機構編號');
    const sessions=safeSyncRows(raw.sessions,500,function(row,index){return {
      sourceId:limitText(row.sourceId,120)||('session_'+index),
      occurredAt:limitText(row.occurredAt,40)||dateKey,
      subject:limitText(row.subject,80),
      teacherId:limitText(row.teacherId,80),
      teacherName:limitText(row.teacherName,80)||'未命名老師',
      studentId:limitText(row.studentId,80),
      studentName:limitText(row.studentName,80)||'未命名學生',
      chargeName:limitText(row.chargeName,120),
      packageAmount:safeSyncNumber(row.packageAmount),
      packageCourseCount:Math.max(0,Math.floor(safeSyncNumber(row.packageCourseCount))),
      discount:safeSyncNumber(row.discount),
      payByDiscount:row.payByDiscount===true,
      lessonPrice:safeSyncNumber(row.lessonPrice),
      allotRate:safeSyncNumber(row.allotRate),
      hourlyFee:safeSyncNumber(row.hourlyFee),
      teacherAmount:safeSyncNumber(row.teacherAmount),
      schoolShare:safeSyncNumber(row.schoolShare)
    };});
    const teachers=safeSyncRows(raw.teachers,150,function(row,index){return {
      teacherId:limitText(row.teacherId,80)||('teacher_'+index),
      name:limitText(row.name,80)||'未命名老師',
      lessonCount:Math.max(0,Math.floor(safeSyncNumber(row.lessonCount))),
      baseAmount:safeSyncNumber(row.baseAmount),
      rewards:0,
      reductions:0,
      finalAmount:safeSyncNumber(row.baseAmount)
    };});
    const tuitionReceipts=safeSyncRows(raw.tuitionReceipts,500,function(row,index){return {
      sourceId:limitText(row.sourceId,120)||('tuition_'+index),
      paidAt:limitText(row.paidAt,40)||dateKey,
      studentId:limitText(row.studentId,80),
      studentName:limitText(row.studentName,80)||'未命名學生',
      subject:limitText(row.subject,80),
      amount:safeSyncNumber(row.amount),
      paymentMethod:limitText(row.paymentMethod,40)||'未標示',
      isRevenue:row.isRevenue!==false
    };});
    const roomRentals=safeSyncRows(raw.roomRentals,200,function(row,index){return {
      sourceId:limitText(row.sourceId,120)||('rental_'+index),
      startAt:limitText(row.startAt,40)||dateKey,
      endAt:limitText(row.endAt,40),
      clientName:limitText(row.clientName,80)||'未命名租用人',
      roomName:limitText(row.roomName,80),
      amount:safeSyncNumber(row.amount),
      operatorName:limitText(row.operatorName,80)
    };});
    const lessonGross=sum(sessions,function(row){return row.lessonPrice;});
    const teacherPayable=teachers.length?sum(teachers,function(row){return row.finalAmount;}):sum(sessions,function(row){return row.teacherAmount;});
    return {
      schemaVersion:2,
      source:'injiaoyun',
      studioId:studioId,
      studioName:limitText(raw.studioName,120),
      dateKey:dateKey,
      includeUnpaid:raw.includeUnpaid===true,
      sessions:sessions,
      teachers:teachers,
      tuitionReceipts:tuitionReceipts,
      roomRentals:roomRentals,
      summary:{
        lessonCount:sessions.length,
        lessonGross:lessonGross,
        teacherPayable:teacherPayable,
        schoolShare:lessonGross-teacherPayable,
        tuitionReceived:sum(tuitionReceipts,function(row){return row.isRevenue?row.amount:0;}),
        roomRentalReceived:sum(roomRentals,function(row){return row.amount;})
      },
      capturedAt:dateFrom(raw.capturedAt)?new Date(raw.capturedAt).toISOString():new Date().toISOString()
    };
  }
  function sanitizeInjiaoyunMonthPayload(raw){
    if(!raw||typeof raw!=='object')throw new Error('同步資料格式不正確');
    const startDateKey=clean(raw.startDateKey),endDateKey=clean(raw.endDateKey);
    const requiredKeys=syncDateKeys(startDateKey,endDateKey);
    if(startDateKey.slice(8)!=='01')throw new Error('本月同步必須從 1 日開始');
    if(!Array.isArray(raw.days))throw new Error('找不到本月每日同步資料');
    if(raw.days.length!==requiredKeys.length)throw new Error('本月每日資料不完整，請重新讀取');
    const studioId=limitText(raw.studioId,80),studioName=limitText(raw.studioName,120);
    if(!studioId)throw new Error('找不到音教雲機構編號');
    const dayMap=new Map();
    raw.days.forEach(function(day){
      const dateKey=clean(day&&day.dateKey);
      if(dayMap.has(dateKey))throw new Error('本月同步資料含有重複日期');
      dayMap.set(dateKey,day);
    });
    const days=requiredKeys.map(function(dateKey){
      const day=dayMap.get(dateKey);
      if(!day)throw new Error('本月同步缺少 '+dateKey+' 的資料');
      return sanitizeInjiaoyunPayload(Object.assign({},day,{studioId:studioId,studioName:studioName,dateKey:dateKey,includeUnpaid:raw.includeUnpaid===true,capturedAt:raw.capturedAt||day.capturedAt}));
    });
    return {
      schemaVersion:2,
      source:'injiaoyun',
      studioId:studioId,
      studioName:studioName,
      startDateKey:startDateKey,
      endDateKey:endDateKey,
      includeUnpaid:raw.includeUnpaid===true,
      days:days,
      summary:{
        lessonCount:sum(days,function(day){return day.summary.lessonCount;}),
        lessonGross:sum(days,function(day){return day.summary.lessonGross;}),
        teacherPayable:sum(days,function(day){return day.summary.teacherPayable;}),
        schoolShare:sum(days,function(day){return day.summary.schoolShare;}),
        tuitionReceived:sum(days,function(day){return day.summary.tuitionReceived;}),
        roomRentalReceived:sum(days,function(day){return day.summary.roomRentalReceived;})
      },
      capturedAt:dateFrom(raw.capturedAt)?new Date(raw.capturedAt).toISOString():new Date().toISOString()
    };
  }
  async function importInjiaoyunPayload(raw){
    if(raw&&Array.isArray(raw.days)){
      const month=sanitizeInjiaoyunMonthPayload(raw),batch=state.db.batch();
      month.days.forEach(function(day){
        const docId='injiaoyun_'+hashText(month.studioId)+'_'+day.dateKey;
        const ref=state.db.collection(COLLECTIONS.educationDaily).doc(docId);
        batch.set(ref,Object.assign({},day,{businessDate:new Date(day.dateKey+'T12:00:00'),importedAt:serverTimestamp(),importedBy:userLabel(),version:VERSION}));
      });
      await batch.commit();
      await writeAudit('匯入音教雲本月課務','educationDaily',hashText(month.studioId)+'_'+month.startDateKey.slice(0,7),month.startDateKey+'～'+month.endDateKey+'｜'+month.summary.lessonCount+' 堂｜老師拆帳 '+money(month.summary.teacherPayable));
      return month;
    }
    const day=sanitizeInjiaoyunPayload(raw);
    const docId='injiaoyun_'+hashText(day.studioId)+'_'+day.dateKey;
    await state.db.collection(COLLECTIONS.educationDaily).doc(docId).set(Object.assign({},day,{businessDate:new Date(day.dateKey+'T12:00:00'),importedAt:serverTimestamp(),importedBy:userLabel(),version:VERSION}));
    await writeAudit('匯入音教雲課務','educationDaily',docId,day.dateKey+'｜'+day.summary.lessonCount+' 堂｜老師拆帳 '+money(day.summary.teacherPayable));
    return Object.assign({startDateKey:day.dateKey,endDateKey:day.dateKey,days:[day]},day);
  }
  function requestInjiaoyunImport(){
    const requestId='injiaoyun_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    state.injiaoyunRequestId=requestId;
    toast('正在讀取同步資料','請稍候','info');
    global.postMessage({type:'YOUZI_REQUEST_INJIAOYUN_DATA',requestId:requestId,schemaVersion:2,appVersion:VERSION},global.location.origin);
    setTimeout(function(){
      if(state.injiaoyunRequestId===requestId){
        state.injiaoyunRequestId='';
        toast('找不到音教雲同步工具','請先安裝 Chrome 同步工具並完成資料讀取。','warning');
      }
    },2200);
  }
  async function handleInjiaoyunBridgeMessage(event){
    if(event.source!==global||event.origin!==global.location.origin)return;
    const message=event.data||{};
    if(message.type!=='YOUZI_INJIAOYUN_DATA'||!message.requestId||message.requestId!==state.injiaoyunRequestId)return;
    state.injiaoyunRequestId='';
    if(message.error||!message.payload){toast('尚無可匯入資料',message.error||'請先在音教雲同步工具讀取本月資料。','warning');return;}
    try{
      const payload=await importInjiaoyunPayload(message.payload);
      global.postMessage({type:'YOUZI_INJIAOYUN_IMPORT_RESULT',requestId:message.requestId,ok:true,startDateKey:payload.startDateKey,endDateKey:payload.endDateKey},global.location.origin);
      toast('音教雲匯入完成',payload.startDateKey+'～'+payload.endDateKey+'｜'+payload.summary.lessonCount+' 堂｜學費 '+money(payload.summary.tuitionReceived)+'｜租用 '+money(payload.summary.roomRentalReceived),'success');
      state.overviewRange='month';state.overviewMonth=payload.startDateKey.slice(0,7);
      await loadAll(true);
    }catch(error){
      global.postMessage({type:'YOUZI_INJIAOYUN_IMPORT_RESULT',requestId:message.requestId,ok:false,error:errorMessage(error)},global.location.origin);
      toast('音教雲匯入失敗',errorMessage(error),'error');
    }
  }


function platformFeeFormRow(name,label){const cfg=platformFeeConfig(name);return '<section class="ops-platform-fee-form-card"><h3>'+escapeHtml(label)+'</h3><div class="ops-form-grid"><div class="ops-field"><label>平台抽成％</label><input class="ops-input" type="number" min="0" max="100" step="0.01" name="'+name+'_commissionRate" value="'+attr(cfg.commissionRate)+'"></div><div class="ops-field"><label>金流費％</label><input class="ops-input" type="number" min="0" max="100" step="0.01" name="'+name+'_paymentRate" value="'+attr(cfg.paymentRate)+'"></div><div class="ops-field"><label>每月固定費</label><input class="ops-input" type="number" min="0" step="1" name="'+name+'_monthlyFixedFee" value="'+attr(cfg.monthlyFixedFee)+'"></div><div class="ops-field"><label>每月廣告／其他固定費</label><input class="ops-input" type="number" min="0" step="1" name="'+name+'_monthlyAdvertisingFee" value="'+attr(cfg.monthlyAdvertisingFee)+'"></div><div class="ops-field full"><label>固定費攤提方式</label><select class="ops-select" name="'+name+'_allocationMethod"><option value="order_count">依當月訂單明細平均攤提</option><option value="sales_amount">依當月銷售金額比例攤提</option><option value="monthly_only">不攤入單筆，只在月報扣除</option></select></div></div></section>';}
function openPlatformFeeSettings(){openDrawer('平台費用與毛利設定','設定會儲存在 Firestore；修改後不需要重新部署 VPS。','<form id="platformFeeSettingsForm">'+platformFeeFormRow('EasyStore','EasyStore')+platformFeeFormRow('MOMO','MOMO')+platformFeeFormRow('Coupang','Coupang／酷澎')+'<div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存費用設定</button></div></form>');['EasyStore','MOMO','Coupang'].forEach(function(name){const select=query('[name="'+name+'_allocationMethod"]');if(select)select.value=platformFeeConfig(name).allocationMethod||'order_count';});}
async function savePlatformFeeSettings(form){const data=new FormData(form),platforms={};['EasyStore','MOMO','Coupang'].forEach(function(name){platforms[name]={enabled:true,commissionRate:Math.max(0,Number(data.get(name+'_commissionRate')||0)),paymentRate:Math.max(0,Number(data.get(name+'_paymentRate')||0)),monthlyFixedFee:Math.max(0,Number(data.get(name+'_monthlyFixedFee')||0)),monthlyAdvertisingFee:Math.max(0,Number(data.get(name+'_monthlyAdvertisingFee')||0)),allocationMethod:clean(data.get(name+'_allocationMethod'))||'order_count'};});await state.db.collection(COLLECTIONS.settings).doc('platformFeeSettings').set({platforms:platforms,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});state.platformFeeSettings=platforms;await writeAudit('更新平台費用設定','platformFeeSettings','platformFeeSettings','EasyStore／MOMO／Coupang');closeDrawer();toast('平台費用設定已儲存','下一次同步與報表會使用新設定。','success');renderKeepingViewport();}
async function syncPlatformOrdersNow(){const yes=await confirmAction('要求 VPS 立即同步','系統會建立同步請求；VPS 最慢約 2 分鐘內讀取並執行。若同步正在進行，不會重複執行。','建立請求');if(!yes)return;const ref=state.db.collection(COLLECTIONS.platformSyncRequests).doc();await ref.set({requestId:ref.id,status:'pending',requestedAt:serverTimestamp(),requestedBy:userLabel(),source:'operations-hub',version:VERSION});toast('同步請求已建立','VPS 會在 2 分鐘內處理，稍後按重新讀取查看結果。','success');}


  function handleAction(action,el){
    if(action==='sync-easystore-api'){ syncEasyStoreApi(); return; }
    if(action==='refresh'){ try{localStorage.removeItem(DASHBOARD_CACHE_KEY);}catch(err){} return loadAll(false); }
    if(action==='platform-sync-now') return syncPlatformOrdersNow();
    if(action==='platform-fee-settings') return openPlatformFeeSettings();
    if(action==='platform-order-range'){state.platformOrderRange=el.dataset.range||'month';return renderKeepingViewport();}
    if(action==='platform-order-platform'){state.platformOrderPlatform=el.dataset.platform||'all';return renderKeepingViewport();}
    if(action==='injiaoyun-import') return requestInjiaoyunImport();
    if(action==='education-tuition-detail') return openEducationTuitionDetail();
    if(action==='education-rental-detail') return openEducationRentalDetail();
    if(action==='education-teacher-summary') return openEducationTeacherSummary();
    if(action==='education-school-share-detail') return openEducationSchoolShareDetail();
    if(action==='education-teacher-detail') return openEducationTeacherDetail(el.dataset.teacherKey||'');
    if(action==='drawer-close') return closeDrawer();
    if(action==='overview-range'){state.overviewRange=el.dataset.range||'today';return render();}
    if(action==='sales-mode'){state.salesMode=el.dataset.mode||'product';return renderKeepingViewport();}
    if(action==='pos-customer-mode'){const mode=el.dataset.mode||'walkin';if(mode==='walkin'){state.posCustomerMode='walkin';state.selectedCustomerId='';state.posMemberSearch='';state.posMemberPickerOpen=false;state.checkoutPaymentStatus='paid';state.checkoutPoints=0;state.checkoutPointsTouched=false;state.checkoutEarnPoints=true;}else{const alreadyMember=state.posCustomerMode==='member';state.posCustomerMode='member';state.posMemberPickerOpen=alreadyMember?!state.posMemberPickerOpen:true;}return renderKeepingViewport();}
    if(action==='pos-member-select'){state.selectedCustomerId=el.dataset.id||'';state.posCustomerMode='member';state.posMemberPickerOpen=false;state.checkoutPaymentStatus='paid';state.checkoutPoints=0;state.checkoutPointsTouched=false;state.checkoutEarnPoints=true;return renderKeepingViewport();}
    if(action==='pos-choice'){const name=el.dataset.name,value=el.dataset.value;if(name==='paymentMethod')state.checkoutPaymentMethod=value;if(name==='paymentStatus')state.checkoutPaymentStatus=value;if(name==='earnPointsEnabled')state.checkoutEarnPoints=value==='earn';if(name==='paymentStatus'&&value!=='partial')state.checkoutReceived='';return renderKeepingViewport();}
    if(action==='income-category'){state.incomeCategory=el.dataset.value||'其他收入';const input=byId('incomeCategory');if(input)input.value=state.incomeCategory;queryAll('[data-action="income-category"]').forEach(function(btn){btn.classList.toggle('active',btn===el);});return;}
    if(action==='pos-key'){
      const key=el.dataset.key||'';
      if(key==='clear')state.posSearch='';
      else if(key==='back')state.posSearch=state.posSearch.slice(0,-1);
      else state.posSearch+=key;
      return renderKeepingViewport();
    }
    if(action==='auto-init-products') return autoInitProducts();
    if(action==='product-new') return openProductEdit('');
    if(action==='product-edit') return openProductEdit(el.dataset.id);
    if(action==='product-edit-cancel'){state.productEditId='';state.productPreviewImages=[];state.productPreviewIndex=0;state.productPreviewTitle='';return renderKeepingViewport();}
    if(action==='product-preview-open'){const p=state.productEditId&&state.productEditId!=='__new__'?catalogById(state.productEditId):null;state.productPreviewImages=productEditorImages(p);state.productPreviewIndex=Math.max(0,Number(el.dataset.index)||0);state.productPreviewTitle=(p&&((p.originalName)||(p.onlineName)||(p.name)))||'商品圖片';return renderKeepingViewport();}
    if(action==='product-preview-close'){state.productPreviewImages=[];state.productPreviewIndex=0;return renderKeepingViewport();}
    if(action==='product-preview-prev'){const total=(state.productPreviewImages||[]).length||1;state.productPreviewIndex=(state.productPreviewIndex-1+total)%total;return renderKeepingViewport();}
    if(action==='product-preview-next'){const total=(state.productPreviewImages||[]).length||1;state.productPreviewIndex=(state.productPreviewIndex+1)%total;return renderKeepingViewport();}
    if(action==='product-preview-select'){state.productPreviewIndex=Math.max(0,Number(el.dataset.index)||0);return renderKeepingViewport();}
    if(action==='product-detail') return openProductDetail(el.dataset.id);
    if(action==='load-more-products'){state.productVisible+=PRODUCT_PAGE_SIZE;return render();}
    if(action==='cart-add') return addCartProduct(el.dataset.id);
    if(action==='cart-remove'){state.cart.splice(Number(el.dataset.index),1);return renderKeepingViewport();}
    if(action==='pos-clear-search'){state.posSearch='';return renderKeepingViewport();}
      if(action==='cart-clear'){state.cart=[];return renderKeepingViewport();}
    if(action==='checkout') return;
    if(action==='customer-new') return openCustomerV4();
    if(action==='pos-customer-new') return openCustomerV4('',true,'member');
    if(action==='customer-edit') return openCustomerV4(el.dataset.id);
    if(action==='customer-history') return openCustomerHistory(el.dataset.id);
    if(action==='membership-settings') return openMembershipSettingsV5();
    if(action==='point-adjust') return openPointAdjustment(el.dataset.id);
    if(action==='receivable-payment') return openReceivablePayment(el.dataset.id);
    if(action==='sale-edit') return openSaleEdit(el.dataset.id);
    if(action==='sale-return') return openSaleReturn(el.dataset.id);
    if(action==='open-quick-income') return openQuickIncome(el.dataset.category||'');
    if(action==='show-sales-history') return openSalesHistory();
    if(action==='sale-history-reset-range'){state.saleInvoiceFrom='';state.saleInvoiceTo='';return renderKeepingViewport();}
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
      else if(form.id==='checkoutFormInline') await saveCheckoutV4(form);
      else if(form.id==='platformFeeSettingsForm') await savePlatformFeeSettings(form);
      else if(form.id==='saleEditForm') await saveSaleEdit(form);
      else if(form.id==='saleReturnForm') await saveSaleReturn(form);
      else if(form.id==='customerFormV4') await saveCustomerV4(form);
      else if(form.id==='membershipSettingsForm') await saveMembershipSettings(form);
      else if(form.id==='membershipSettingsFormV5') await saveMembershipSettingsV5(form);
      else if(form.id==='pointAdjustmentForm') await savePointAdjustment(form);
      else if(form.id==='receivablePaymentForm') await saveReceivablePayment(form);
      else if(form.id==='quickIncomeForm') await saveQuickIncome(form);
      else if(form.id==='purchaseForm') await savePurchase(form);
      else if(form.id==='adjustmentForm') await saveAdjustment(form);
      else if(form.id==='rentalLedgerForm') await saveRentalLedger(form);
      else if(form.id==='caseForm') await saveCase(form);
      else if(form.id==='expenseForm') await saveExpense(form);
    }catch(error){ toast('無法儲存',errorMessage(error),'error'); if(submit) submit.disabled=false; }
  }


function renderKeepingViewport(){
  const y=global.scrollY||global.pageYOffset||0;
  render();
  setTimeout(function(){ try{global.scrollTo(0,y);}catch(err){} },0);
}
function rerenderKeepingFocus(id,value){
  const y=global.scrollY||global.pageYOffset||0;
  render();
  setTimeout(function(){
    try{global.scrollTo(0,y);}catch(err){}
    const input=byId(id);
    if(input){
      try{ input.focus({preventScroll:true}); }catch(err){ input.focus(); }
      const len=clean(value).length;
      try{input.setSelectionRange(len,len);}catch(err){}
    }
  },0);
}

  function updateCartTotals(){
    const subtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;});
    setText('cartSubtotal',money(subtotal));
  }
  function updateInlineCheckoutTotals(){
    const form=byId('checkoutFormInline');if(!form)return;const subtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;}),discount=Math.max(0,Number(state.checkoutDiscount||0)),c=selectedCustomer(),maxPoints=maxRedeemablePoints(c,Math.max(0,subtotal-discount)),pointInput=query('[name="pointsToRedeem"]',form),rule=membershipRuleForDate(new Date());if(pointInput){pointInput.max=String(maxPoints);if(c&&rule.redemptionMode==='auto'&&!state.checkoutPointsTouched){state.checkoutPoints=maxPoints;pointInput.value=String(maxPoints);}else if(Number(pointInput.value||0)>maxPoints){pointInput.value=String(maxPoints);state.checkoutPoints=maxPoints;}}const pointValue=pointDiscount(state.checkoutPoints),total=Math.max(0,subtotal-discount-pointValue),prepared=state.cart.map(function(item){const p=catalogById(item.productId);return {qty:item.qty,unitPrice:item.unitPrice,raw:p&&p.internal?p.internal:{}};}),member=!!(c&&c.customerType==='member'),earned=member&&state.checkoutEarnPoints!==false?calculatePreparedRewardPoints(prepared,total,subtotal,new Date()):0;setText('inlineDiscountTotal',money(discount+pointValue));setText('inlineCheckoutTotal',money(total));setText('inlinePointDiscount',formatNumber(state.checkoutPoints)+' 點／'+money(pointValue));setText('inlinePointRemaining',formatNumber(Math.max(0,Number(c&&c.pointBalance||0)-state.checkoutPoints))+' 點');setText('inlinePointsEarned',member&&state.checkoutEarnPoints!==false?formatNumber(earned)+' 點':'不累積');
  }

  function bindEvents(){
    document.addEventListener('click',function(event){
      const nav=event.target.closest('[data-nav]'); if(nav){event.preventDefault();location.hash=nav.dataset.nav;return;}
      const actionEl=event.target.closest('[data-action]'); if(actionEl){event.preventDefault();handleAction(actionEl.dataset.action,actionEl);return;}
      const navLink=event.target.closest('#opsNav a[data-view]'); if(navLink){ closeMobileMenu(); }
    });
    document.addEventListener('submit',function(event){const form=event.target.closest('form'); if(!form)return; event.preventDefault();handleSubmit(form);});
    const opsSearchStateMap={
      productSearch:'productSearch',
      posSearch:'posSearch',
      posMemberSearch:'posMemberSearch',
      saleInvoiceSearch:'saleInvoiceSearch',
      overviewSearch:'overviewSearch',
      customerSearch:'customerSearch',
      platformOrderSearch:'platformOrderSearch',
      receivableSearch:'receivableSearch',
      rentalSearch:'rentalSearch',
      caseSearch:'caseSearch',
      inventorySearch:'inventorySearch'
    };
    function isOpsSearchInput(target){return !!(target&&opsSearchStateMap[target.id]);}
    function applyOpsSearchInput(input){
      const key=opsSearchStateMap[input.id];
      if(!key)return;
      state[key]=input.value;
      if(input.id==='productSearch')state.productVisible=PRODUCT_PAGE_SIZE;
      rerenderKeepingFocus(input.id,state[key]);
    }
    document.addEventListener('compositionstart',function(event){
      if(isOpsSearchInput(event.target)) event.target.dataset.opsImeComposing='1';
    },true);
    document.addEventListener('compositionend',function(event){
      if(!isOpsSearchInput(event.target)) return;
      const input=event.target;
      delete input.dataset.opsImeComposing;
      // iPhone 注音在組字完成前不可重建輸入框，否則中文字會被中斷。
      setTimeout(function(){
        if(document.contains(input)) applyOpsSearchInput(input);
      },0);
    },true);
    document.addEventListener('input',function(event){
      if(isOpsSearchInput(event.target)){
        // iOS Safari 的注音組字期間會觸發 input；此時完全不重新 render。
        if(event.isComposing||event.target.dataset.opsImeComposing==='1') return;
        applyOpsSearchInput(event.target);
      }
      else if(event.target.matches('[data-cart-qty]')){const item=state.cart[Number(event.target.dataset.cartQty)];if(item){item.qty=Math.max(1,Math.round(Number(event.target.value||1)));updateCartTotals();updateInlineCheckoutTotals();}}
      else if(event.target.matches('[data-cart-price]')){const item=state.cart[Number(event.target.dataset.cartPrice)];if(item){item.unitPrice=Math.max(0,Number(event.target.value||0));updateCartTotals();updateInlineCheckoutTotals();}}
      else if(event.target.closest('#checkoutFormInline')&&event.target.name==='discount'){state.checkoutDiscount=Math.max(0,Number(event.target.value||0));if(state.checkoutDiscount>0){state.checkoutEarnPoints=false;const earnInput=query('[name="earnPointsEnabled"]',event.target.closest('#checkoutFormInline'));if(earnInput)earnInput.value='false';queryAll('[data-name="earnPointsEnabled"]').forEach(function(button){button.classList.toggle('active',button.dataset.value==='none');});}updateInlineCheckoutTotals();}
      else if(event.target.closest('#checkoutFormInline')&&event.target.name==='pointsToRedeem'){state.checkoutPoints=Math.max(0,Math.floor(Number(event.target.value||0)));state.checkoutPointsTouched=true;updateInlineCheckoutTotals();}
      else if(event.target.closest('#saleReturnForm')&&event.target.matches('[name="qty"]')) returnPreview(event.target.closest('#saleReturnForm'));
      else if(event.target.closest('#saleEditForm')&&event.target.name==='discount'&&Number(event.target.value||0)>0){const noEarn=query('[name="earnPointsEnabled"][value="false"]',event.target.closest('#saleEditForm'));if(noEarn)noEarn.checked=true;}
      else if(event.target.closest('#checkoutFormInline')&&event.target.name==='receivedAmount'){state.checkoutReceived=event.target.value;}
      else if(event.target.closest('#quickIncomeForm')&&event.target.name==='receivedAmount'){state.checkoutReceived=event.target.value;}
      else if(event.target.closest('#quickIncomeForm')&&event.target.name==='amount'){state.directIncomeAmount=event.target.value;}
      else if(event.target.closest('#checkoutFormV4')&&(event.target.name==='discount'||event.target.name==='pointsToRedeem')) updateCheckoutPreview();
    });
    document.addEventListener('change',function(event){
      if(event.target.id==='productFilter'){state.productFilter=event.target.value;state.productVisible=PRODUCT_PAGE_SIZE;render();}
      else if(event.target.id==='productSort'){state.productSort=event.target.value;render();}
      else if(event.target.id==='financeRange'){state.financeRange=event.target.value;render();}
      else if(event.target.id==='saleInvoiceFrom'){state.saleInvoiceFrom=event.target.value;renderKeepingViewport();}
      else if(event.target.id==='saleInvoiceTo'){state.saleInvoiceTo=event.target.value;renderKeepingViewport();}
      else if(event.target.id==='overviewMonth'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)){state.overviewMonth=event.target.value;state.overviewRange='month';render();}
      else if(event.target.id==='overviewFrom'){state.overviewFrom=event.target.value;render();}
      else if(event.target.id==='overviewTo'){state.overviewTo=event.target.value;render();}
      else if(event.target.id==='posCustomerSelect'){state.selectedCustomerId=event.target.value;render();}
      else if(event.target.closest('#saleEditForm')&&event.target.name==='paymentStatus'){const field=byId('saleEditReceivedField');if(field)field.classList.toggle('hidden',event.target.value!=='partial');}
      else if(event.target.id==='importFile'){parseImportFile(event.target.files&&event.target.files[0]).catch(function(error){toast('檔案解析失敗',errorMessage(error),'error');});}
    });
    global.addEventListener('hashchange',function(){closeMobileMenu(); if(!ensureDataForCurrentView())render();});
    global.addEventListener('message',handleInjiaoyunBridgeMessage);
    const refreshBtn=byId('opsRefreshBtn'); if(refreshBtn)refreshBtn.addEventListener('click',function(){try{localStorage.removeItem(DASHBOARD_CACHE_KEY);}catch(err){} loadAll(false);});
    const backBtn=byId('opsBackBtn'); if(backBtn)backBtn.addEventListener('click',function(){history.back();});
    const logoutBtn=byId('opsLogoutBtn'); if(logoutBtn)logoutBtn.addEventListener('click',function(){ if(typeof global.logout==='function')global.logout();else location.href='index.html'; });
    byId('opsDrawerClose').addEventListener('click',closeDrawer); byId('opsDrawerBackdrop').addEventListener('click',closeDrawer);
    byId('opsConfirmClose').addEventListener('click',function(){closeConfirm(false);}); byId('opsConfirmCancel').addEventListener('click',function(){closeConfirm(false);}); byId('opsConfirmOk').addEventListener('click',function(){closeConfirm(true);});
    const menuBtn=byId('opsMenuBtn'); if(menuBtn)menuBtn.addEventListener('click',openMobileMenu);
    document.addEventListener('keydown',function(event){if(event.key==='Escape'){closeDrawer();closeConfirm(false);closeMobileMenu();if((state.productPreviewImages||[]).length){state.productPreviewImages=[];state.productPreviewIndex=0;renderKeepingViewport();}}});
  }
  function openMobileMenu(){ const sidebar=byId('opsSidebar'); if(!sidebar)return; sidebar.classList.add('open'); let overlay=query('.ops-mobile-overlay'); if(!overlay){overlay=document.createElement('div');overlay.className='ops-mobile-overlay';overlay.addEventListener('click',closeMobileMenu);document.body.appendChild(overlay);} overlay.classList.add('open'); }
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
    watchInjiaoyunCloudSync();
    bindEvents();
    const initialView=(location.hash||'#overview').replace('#','').split('?')[0]||'overview';
    const cache=initialView==='overview'?getDashboardCache():null;
    if(cache){ showCachedDashboard(cache); await loadAll(true); }
    else { render(); await loadAll(false); }
  }

  global.OperationsCenterV1={init:init,reload:function(){return loadAll(false);},state:state};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
