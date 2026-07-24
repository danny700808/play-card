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
  const VERSION = '2026.07.18-education-retained-rental-v20';
  // 後端最長執行 30 分鐘；瀏覽器多留 1 分鐘接收後端的最終成功／失敗回應。
  const EASYSTORE_CATALOG_CLIENT_TIMEOUT_MS = 31 * 60 * 1000;
  const DASHBOARD_CACHE_KEY = 'youzi_ops_dashboard_overview_v7_order_detail';
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
    fullLoadedAt:null,
    onlineSource:'EasyStore API',
    onlineProducts:[],
    easyStoreSync:{},
    easyStoreSyncPending:false,
    injiaoyunCloudSync:{},
    injiaoyunCloudSyncSignature:'',
    injiaoyunCloudStatusSignature:'',
    injiaoyunCloudSyncUnsubscribe:null,
    injiaoyunCloudStatusTimer:null,
    injiaoyunManualRequestPending:false,
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
    suppliers:[],
    inventoryCountSettings:{enabled:true,pinHash:'',updatedAt:''},
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
    platformInventoryQueue:[],
    platformSyncPanel:'',
    platformFeeSettings:JSON.parse(JSON.stringify(DEFAULT_PLATFORM_FEE_SETTINGS)),
    platformLocalAgent:{},
    diagnostics:[],
    productVisible:PRODUCT_PAGE_SIZE,
    productSearch:'',
    productFilter:'all',
    productSort:'sku',
    productDisplayMode:'image',
    productSeries:'all',
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
    checkoutOrderType:'sale',
    checkoutDiscount:0,
    checkoutPoints:0,
    checkoutPointsTouched:false,
    checkoutEarnPoints:true,
    checkoutActualCash:'',
    checkoutReceived:'',
    incomeCategory:'其他收入',
    directIncomeAmount:'',
    stockUsageReason:'店內自用',
    stockUsageNote:'',
    saleInvoiceSearch:'',
    saleInvoiceFrom:'',
    saleInvoiceTo:'',
    salesHistoryExpanded:false,
    purchaseWorkspaceTab:'inbound',
    purchaseLowSearch:'',
    purchaseRange:'today',
    purchaseDate:dateText(new Date()),
    purchaseMonth:(function(){const now=new Date();return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');})(),
    purchaseFrom:'',
    purchaseTo:'',
    purchaseEntrySearch:'',
    purchaseEntrySeries:'all',
    purchaseEntrySort:'sku',
    purchaseEntryDisplayMode:'image',
    purchaseEntryCart:[],
    purchaseEntryReceivedAt:'',
    purchaseEntrySupplier:'',
    purchaseEntrySupplierId:'',
    purchaseEntryExternalNo:'',
    purchaseEntryExtraCost:0,
    purchaseEntryNote:'',
    purchaseEntryPaymentStatus:'unpaid',
    purchaseEntryPaymentDate:'',
    purchaseEntryPaymentMethod:'',
    purchaseEditId:'',
    stocktakeSearch:'',
    stocktakeSeries:'all',
    stocktakeSort:'sku',
    stocktakeCart:[],
    stocktakeOperator:'',
    stocktakeNote:'',
    stocktakeCorrectionId:'',
    membershipSettings:Object.assign({},DEFAULT_MEMBERSHIP_SETTINGS),
    cart:[],
    financeRange:'month',
    platformOrderRange:'today',
    platformOrderDate:dateText(new Date()),
    platformOrderMonth:(function(){const now=new Date();return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');})(),
    platformOrderFrom:'',
    platformOrderTo:'',
    platformOrderPlatform:'all',
    platformOrderSearch:'',
    platformOrderIssueFilter:'all',
    rentalSearch:'',
    caseSearch:'',
    inventorySearch:'',
    customerSearch:'',
    receivableSearch:'',
    overviewRange:'today',
    overviewDate:dateText(new Date()),
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

  // 搜尋輸入優先：先接收完整文字，等瀏覽器空閒後才更新結果列表。
  const deferredSearchTimers = Object.create(null);
  const SEARCH_IDLE_DELAY_MS = 240;

  const PAGE_META = {
    overview:['營運總覽',''],
    'course-calendar':['課程日表','保留舊版音教雲，同時提供新版排課系統設計預覽。'],
    products:['商品資訊',''],
    sales:['現場銷售',''],
    customers:['客戶會員','會員、老師與一般客戶共用同一份客戶資料。'],
    receivables:['應收帳款','應收帳款會連回客戶與原始銷售。'],
    purchases:['庫存作業',''],
    'purchase-entry':['進貨入庫工作台',''],
    stocktake:['庫存盤點工作台',''],
    rentals:['租賃營運','正式合約送出即列入租賃收入，押金不列入營業收入。'],
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
  function formatLabelSku(value){
    const raw=clean(value).replace(/\s+/g,'');
    if(!raw)return '';
    if(/^\d{3}-/.test(raw))return raw;
    const match=raw.match(/^(\d{3})(\d{4})(.*)$/);
    return match?match[1]+'-'+match[2]+match[3]:raw;
  }
  function compactSearchCode(value){return lower(value).replace(/[^a-z0-9]/g,'');}
  function matchesSearch(values,term){
    const hay=lower((Array.isArray(values)?values:[values]).join(' '));
    const needle=lower(term);
    return !needle||hay.includes(needle)||(compactSearchCode(needle)&&compactSearchCode(hay).includes(compactSearchCode(needle)));
  }
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
  function inferMomoOrderDateFromNumber(orderNo,referenceValue){
    // MOMO 訂單編號如 66071500721372，第 3～6 碼代表 MMDD。
    // 舊版同步曾把「本次同步時間」寫進 orderedAt；遇到這種資料時，以編號內的日期回復正確日期，絕不沿用同步時間。
    const digits=clean(orderNo).replace(/\D/g,''),match=digits.match(/^\d{2}(\d{2})(\d{2})\d{6,}$/);
    if(!match)return null;
    const month=Number(match[1]),day=Number(match[2]),reference=dateFrom(referenceValue)||new Date();
    if(month<1||month>12||day<1||day>31)return null;
    let candidate=new Date(reference.getFullYear(),month-1,day,0,0,0,0);
    if(candidate.getMonth()!==month-1||candidate.getDate()!==day)return null;
    if(candidate.getTime()>reference.getTime()+2*24*60*60*1000)candidate=new Date(reference.getFullYear()-1,month-1,day,0,0,0,0);
    return candidate;
  }
  function platformOrderLooksLikeSyncTime(obj,orderedAt){
    const ordered=dateFrom(orderedAt),seen=dateFrom(obj&&(obj.firstSeenAt||obj.lastSeenAt||obj.updatedAt||obj.createdAt));
    return !!(ordered&&seen&&Math.abs(ordered.getTime()-seen.getTime())<=15*60*1000);
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
    enhanceMobileNumberInputs(byId('opsDrawerBody'));
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
  function consumeFifo(raw,qty,allowNegativeStock){
    qty=Math.max(0,Math.round(Number(qty||0))); const layers=materializeCostLayers(raw); let remaining=qty,costTotal=0,unknownQty=0; const breakdown=[];
    for(const layer of layers){ if(remaining<=0) break; const take=Math.min(remaining,layer.qtyRemaining); if(take<=0) continue; const unit=layer.unitCost; if(unit==null){unknownQty+=take;} else costTotal+=take*unit; breakdown.push({layerId:layer.layerId,qty:take,unitCost:unit,referenceId:layer.referenceId}); layer.qtyRemaining-=take; remaining-=take; }
    if(remaining>0){
      if(!allowNegativeStock) throw new Error('FIFO 成本層數量不足，請先重新整理商品庫存');
      const fallback=numberOrNull(firstValue(raw||{},['averageCost','latestPurchaseCost','purchasePrice']));
      if(fallback==null)unknownQty+=remaining;else costTotal+=remaining*fallback;
      breakdown.push({layerId:'NEGATIVE_STOCK',qty:remaining,unitCost:fallback,referenceId:'NEGATIVE_STOCK'});
      remaining=0;
    }
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
    const pricesInitialized=obj.platformPricesInitialized===true;
    const sharedOnlinePrice=numberOrNull(firstValue(obj,['easyStorePrice','onlinePrice','momoPrice','coupangPrice']));
    function platformPrice(field){
      const own=Object.prototype.hasOwnProperty.call(obj,field),value=numberOrNull(obj[field]);
      if(pricesInitialized)return own?value:null;
      return value!=null?value:sharedOnlinePrice;
    }
    return {
      docId:docId,sourceKey:clean(obj.sourceKey),sourceCollection:clean(obj.sourceCollection),sourceProductId:clean(obj.sourceProductId),sourceVariantId:clean(obj.sourceVariantId),
      internalSku:normalizeCode(firstValue(obj,['internalSku','sku','code','productCode','商品編號'])),barcode:clean(firstValue(obj,['barcode','ean','條碼'])),
      internalName:clean(firstValue(obj,['internalName','originalName','name','商品名稱'])),originalName:clean(firstValue(obj,['originalName','internalName','name'])),onlineName:clean(obj.onlineName),
      imageUrl:safeUrl(obj.imageUrl),imageUrls:Array.isArray(obj.imageUrls)?obj.imageUrls.map(safeUrl).filter(Boolean):[],parentImageUrls:Array.isArray(obj.parentImageUrls)?obj.parentImageUrls.map(safeUrl).filter(Boolean):[],variantImageUrls:Array.isArray(obj.variantImageUrls)?obj.variantImageUrls.map(safeUrl).filter(Boolean):[],onlineUrl:safeUrl(obj.onlineUrl),brand:clean(obj.brand),category:clean(obj.category),variantName:clean(obj.variantName),
      onlinePrice:numberOrNull(obj.onlinePrice),storePrice:numberOrNull(firstValue(obj,['storePrice','originalSalePrice','salePrice','retailPrice'])),originalSalePrice:numberOrNull(firstValue(obj,['originalSalePrice','storePrice','salePrice'])),
      easyStorePrice:platformPrice('easyStorePrice'),momoPrice:platformPrice('momoPrice'),coupangPrice:platformPrice('coupangPrice'),platformPricesInitialized:pricesInitialized,
      latestPurchaseCost:numberOrNull(firstValue(obj,['latestPurchaseCost','referencePurchaseCost','purchaseCost','purchasePrice'])),averageCost:stats.averageCost!=null?stats.averageCost:numberOrNull(firstValue(obj,['averageCost','avgCost','movingAverageCost'])),
      nextFifoCost:stats.nextFifoCost,inventoryValue:stats.inventoryValue,costIncomplete:stats.costIncomplete,costLayers:layers,
      platformPriceSync:obj.platformPriceSync&&typeof obj.platformPriceSync==='object'?obj.platformPriceSync:{},platformMappings:obj.platformMappings&&typeof obj.platformMappings==='object'?obj.platformMappings:{},
      zeroCostConfirmed:obj.zeroCostConfirmed===true,zeroCostConfirmedAt:obj.zeroCostConfirmedAt||'',zeroCostConfirmedBy:clean(obj.zeroCostConfirmedBy),
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
    const pricesInitialized=!!(internal&&internal.platformPricesInitialized===true);
    const sharedOnlinePrice=[internal&&internal.easyStorePrice,onlinePrice,internal&&internal.momoPrice,internal&&internal.coupangPrice].map(numberOrNull).find(function(value){return value!=null;});
    const easyStorePrice=internal&&internal.easyStorePrice!=null?internal.easyStorePrice:(!pricesInitialized?sharedOnlinePrice:null),momoPrice=internal&&internal.momoPrice!=null?internal.momoPrice:(!pricesInitialized?sharedOnlinePrice:null),coupangPrice=internal&&internal.coupangPrice!=null?internal.coupangPrice:(!pricesInitialized?sharedOnlinePrice:null);
    const current=internal?Number(internal.currentStock||0):0; const reserved=internal?Number(internal.reservedStock||0):0; const safety=internal?Number(internal.safetyStock||0):0; const available=Math.max(0,current-reserved-safety);
    const costForMargin=internal?(internal.nextFifoCost!=null?internal.nextFifoCost:internal.averageCost):null; const margin=(storePrice!=null&&costForMargin!=null&&storePrice!==0)?((storePrice-costForMargin)/storePrice*100):null;
    return {name:display,originalName:originalName,onlineName:onlineName,sku:sku,imageUrl:images[0]||'',imageUrls:images,parentImageUrls:parentImages,variantImageUrls:variantImages,onlinePrice:onlinePrice,storePrice:storePrice,easyStorePrice:easyStorePrice,momoPrice:momoPrice,coupangPrice:coupangPrice,platformPricesInitialized:pricesInitialized,originalSalePrice:internal?internal.originalSalePrice:null,averageCost:internal?internal.averageCost:null,nextFifoCost:internal?internal.nextFifoCost:null,latestPurchaseCost:internal?internal.latestPurchaseCost:null,inventoryValue:internal?internal.inventoryValue:0,costIncomplete:internal?internal.costIncomplete:false,zeroCostConfirmed:!!(internal&&internal.zeroCostConfirmed===true),zeroCostConfirmedAt:internal?internal.zeroCostConfirmedAt:'',zeroCostConfirmedBy:internal?internal.zeroCostConfirmedBy:'',currentStock:current,reservedStock:reserved,safetyStock:safety,availableStock:available,margin:margin,status:internal?internal.status:'preview',initialized:!!internal,matchedOnline:!!online||(internal&&internal.easyStoreMatched===true),sourceCollection:(online&&online.sourceCollection)||(internal&&internal.sourceCollection)||'',onlineUrl:(online&&online.url)||(internal&&internal.onlineUrl)||'',brand:(online&&online.brand)||(internal&&internal.brand)||'',category:(online&&online.category)||(internal&&internal.category)||'',variantName:(online&&online.variantName)||(internal&&internal.variantName)||'',saleRewardPercent:internal?internal.saleRewardPercent:null,platformPriceSync:internal?internal.platformPriceSync||{}:{},negativeStock:current<0};
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
    if(view==='products'){
      if(!state.loadedAt&&!state.loading){ loadProductsOnly(false); return true; }
      return false;
    }
    if(!state.fullLoadedAt&&!state.loading){ loadAll(false); return true; }
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
      state.injiaoyunCloudStatusSignature=injiaoyunStatusSignature(state.injiaoyunCloudSync);
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
  function injiaoyunStatusSignature(value){
    const row=value||{};
    return [clean(row.status),syncTimestampSignature(row.lastStartedAt),syncTimestampSignature(row.lastSucceededAt),syncTimestampSignature(row.lastFailedAt),clean(row.lastError),clean(row.manualRequestId)].join('|');
  }
  function syncTimestampMillis(value){
    if(!value)return 0;
    if(typeof value.toMillis==='function')return value.toMillis();
    if(value.seconds!=null)return Number(value.seconds)*1000;
    const date=dateFrom(value);
    return date?date.getTime():0;
  }
  function injiaoyunSyncIsBusy(value){
    const row=value||{},status=lower(row.status);
    if(status!=='queued'&&status!=='running')return false;
    const started=status==='queued'?syncTimestampMillis(row.manualRequestedAt):syncTimestampMillis(row.lastStartedAt);
    if(!started)return state.injiaoyunManualRequestPending;
    return Date.now()-started<(status==='queued'?16*60*1000:25*60*1000);
  }
  function scheduleInjiaoyunStatusRefresh(value){
    if(state.injiaoyunCloudStatusTimer){clearTimeout(state.injiaoyunCloudStatusTimer);state.injiaoyunCloudStatusTimer=null;}
    const row=value||{},status=lower(row.status);
    if(status!=='queued'&&status!=='running')return;
    const started=status==='queued'?syncTimestampMillis(row.manualRequestedAt):syncTimestampMillis(row.lastStartedAt);
    if(!started)return;
    const remaining=(status==='queued'?16*60*1000:25*60*1000)-(Date.now()-started)+1000;
    if(remaining<=0)return;
    state.injiaoyunCloudStatusTimer=setTimeout(function(){state.injiaoyunCloudStatusTimer=null;if(state.view==='overview')renderKeepingViewport();},remaining);
  }
  function watchInjiaoyunCloudSync(){
    if(state.injiaoyunCloudSyncUnsubscribe)return;
    let initialized=false;
    state.injiaoyunCloudSyncUnsubscribe=state.db.collection(COLLECTIONS.settings).doc('injiaoyunCloudSync').onSnapshot(function(doc){
      const next=doc.exists?(doc.data()||{}):{};
      const signature=syncTimestampSignature(next.lastSucceededAt);
      const statusSignature=injiaoyunStatusSignature(next);
      const successChanged=initialized&&next.status==='success'&&signature&&signature!==state.injiaoyunCloudSyncSignature;
      const failureChanged=initialized&&next.status==='error'&&statusSignature!==state.injiaoyunCloudStatusSignature;
      const statusChanged=initialized&&statusSignature!==state.injiaoyunCloudStatusSignature;
      state.injiaoyunCloudSync=next;
      state.injiaoyunCloudSyncSignature=signature;
      state.injiaoyunCloudStatusSignature=statusSignature;
      scheduleInjiaoyunStatusRefresh(next);
      initialized=true;
      if(successChanged&&!state.loading){
        try{localStorage.removeItem(DASHBOARD_CACHE_KEY);}catch(error){}
        toast('音教雲同步完成',(clean(next.lastStartDateKey)&&clean(next.lastEndDateKey)?clean(next.lastStartDateKey)+'～'+clean(next.lastEndDateKey)+'｜':'')+'營運資料已更新','success');
        loadAll(true);
      }else if(failureChanged&&!state.loading){
        toast('音教雲同步失敗',clean(next.lastError)||'請查看雲端同步記錄。','error');
        if(state.view==='overview')renderKeepingViewport();
      }else if(statusChanged&&!state.loading&&state.view==='overview'){
        renderKeepingViewport();
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


async function loadPlatformLocalAgent(){
  try{
    const snap=await state.db.collection(COLLECTIONS.settings).doc('platformLocalAgent').get();
    state.platformLocalAgent=snap.exists?(snap.data()||{}):{};
    state.diagnostics.push({collection:'opsSettings/platformLocalAgent',ok:true,count:snap.exists?1:0,ms:0});
  }catch(error){
    state.platformLocalAgent={};
    state.diagnostics.push({collection:'opsSettings/platformLocalAgent',ok:false,count:0,ms:0,error:errorMessage(error)});
  }
}

  async function loadSupplierDirectory(){
    const started=Date.now();
    try{
      const snap=await state.db.collection(COLLECTIONS.settings).doc('suppliers').collection('directory').limit(1000).get();
      state.suppliers=snap.docs.map(function(doc){const raw=doc.data()||{};return {id:doc.id,name:clean(raw.name),contactName:clean(raw.contactName),phone:clean(raw.phone),mobile:clean(raw.mobile),email:clean(raw.email),address:clean(raw.address),taxId:clean(raw.taxId),paymentInfo:clean(raw.paymentInfo),note:clean(raw.note),enabled:raw.enabled!==false,createdAt:raw.createdAt||'',updatedAt:raw.updatedAt||''};}).filter(function(row){return row.enabled!==false;}).sort(function(a,b){return a.name.localeCompare(b.name,'zh-Hant');});
      state.diagnostics.push({collection:'opsSettings/suppliers/directory',ok:true,count:state.suppliers.length,ms:Date.now()-started});
    }catch(error){state.suppliers=[];state.diagnostics.push({collection:'opsSettings/suppliers/directory',ok:false,count:0,ms:Date.now()-started,error:errorMessage(error)});}
  }
  async function loadInventoryCountSettings(){
    const started=Date.now();
    try{
      const snap=await state.db.collection(COLLECTIONS.settings).doc('inventoryCount').get();
      const raw=snap.exists?(snap.data()||{}):{};
      state.inventoryCountSettings={enabled:raw.enabled!==false,pinHash:clean(raw.pinHash),updatedAt:raw.updatedAt||''};
      state.diagnostics.push({collection:'opsSettings/inventoryCount',ok:true,count:snap.exists?1:0,ms:Date.now()-started});
    }catch(error){state.inventoryCountSettings={enabled:true,pinHash:'',updatedAt:''};state.diagnostics.push({collection:'opsSettings/inventoryCount',ok:false,count:0,ms:Date.now()-started,error:errorMessage(error)});}
  }
  async function loadPlatformInventoryQueueErrors(){
    const started=Date.now();
    try{
      const snap=await state.db.collection(COLLECTIONS.platformInventoryQueue).where('lastAttemptStatus','==','error').limit(1000).get();
      state.platformInventoryQueue=snap.docs.map(function(doc){return normalizePlatformInventoryQueue(Object.assign({__id:doc.id},doc.data()||{}));});
      state.diagnostics.push({collection:COLLECTIONS.platformInventoryQueue+'(errors)',ok:true,count:state.platformInventoryQueue.length,ms:Date.now()-started});
    }catch(error){state.platformInventoryQueue=[];state.diagnostics.push({collection:COLLECTIONS.platformInventoryQueue+'(errors)',ok:false,count:0,ms:Date.now()-started,error:errorMessage(error)});}
  }

  async function loadProductsOnly(silent){
    if(state.loading) return;
    state.loading=true; clearAlert();
    if(!silent) html('opsContent',loadingHtml('正在讀取商品資料…'));
    state.diagnostics=[];
    try{
      await loadOnlineProducts();
      const rows=await getCollection(COLLECTIONS.products,10000);
      state.internalProducts=rows.map(function(row){ return normalizeInternal(row,row.__id); });
      mergeCatalog();
      state.loadedAt=new Date();
      setText('opsLastReadText','商品最後讀取：'+dateTimeText(state.loadedAt));
      render();
    }catch(error){
      showAlert('商品資料讀取失敗：'+errorMessage(error),'error');
      html('opsContent',emptyHtml('無法載入商品資料','請確認網路、Firebase設定與Firestore規則後重新讀取。','<button class="ops-button primary" data-action="refresh">重新讀取</button>'));
    }finally{ state.loading=false; }
  }

  async function loadAll(silent){
    if(state.loading) return;
    state.loading=true; clearAlert();
    if(!silent) html('opsContent',loadingHtml('正在整理商品、庫存、銷售、租賃與案件資料…'));
    state.diagnostics=[];
    try{
      await Promise.all([loadOnlineProducts(),loadMembershipSettings(),loadInjiaoyunCloudSync(),loadPlatformFeeSettings(),loadPlatformLocalAgent(),loadSupplierDirectory(),loadInventoryCountSettings(),loadPlatformInventoryQueueErrors()]);
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
      state.sales=results[3].map(normalizeSale).filter(function(row){return clean(row.status)!=='voided';});
      state.incomes=results[4].map(normalizeIncome).filter(function(row){return clean(row.status)!=='voided';});
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
      state.fullLoadedAt=state.loadedAt;
      setText('opsLastReadText','最後讀取：'+dateTimeText(state.loadedAt));
      saveDashboardCache();
      render();
    }catch(error){
      showAlert('資料讀取失敗：'+errorMessage(error),'error');
      html('opsContent',emptyHtml('無法載入營運資料','請確認網路、Firebase設定與Firestore規則後重新讀取。','<button class="ops-button primary" data-action="refresh">重新讀取</button>'));
    }finally{ state.loading=false; }
  }

  function normalizeRental(obj){
    const start=firstValue(obj,['officialStartDate','startDate','rentalStartDate','contractStartDate','deliveryDate','開始日期']);
    const end=firstValue(obj,['officialEndDate','endDate','rentalEndDate','contractEndDate','到期日期']);
    const equipmentItems=Array.isArray(obj.equipmentItems)?obj.equipmentItems:[];
    const firstEquipment=equipmentItems.length?(clean(equipmentItems[0]&&equipmentItems[0].name)||clean(equipmentItems[0]&&equipmentItems[0].title)):'';
    const rentInfo=firstNumber(obj,['rentalIncomeAmount','rentFee','rentalFee','monthlyRent','租金']);
    const rentFee=firstNumber(obj,['rentFee','rentalFee','monthlyRent','租金']).value;
    const shippingFee=firstNumber(obj,['shippingFee','deliveryFee','floorExtraFee','運費']).value;
    return {
      id:clean(obj.__id),
      contractNo:clean(firstValue(obj,['contractNo','contractId','rentalContractNo','applicationNo','編號']))||clean(obj.__id),
      customer:clean(firstValue(obj,['customerName','name','applicantName','承租人','客戶']))||'未提供',
      phone:clean(firstValue(obj,['customerPhone','phone','customerMobile','mobile','電話'])),
      equipment:clean(firstValue(obj,['equipmentName','rentalItem','equipmentCategory','instrumentName','productName','deviceName','equipmentType','設備']))||firstEquipment||'未提供',
      brand:clean(firstValue(obj,['equipmentBrand','brand','品牌'])),
      model:clean(firstValue(obj,['equipmentModel','modelName','model','型號'])),
      assetNo:clean(firstValue(obj,['equipmentNo','assetNo','serialNo','設備編號'])),
      startDate:start,
      endDate:end,
      rentFee:rentFee,
      shippingFee:shippingFee,
      depositFee:firstNumber(obj,['depositFee','deposit','押金']).value,
      incomeRecognizedAt:firstValue(obj,['rentalIncomeRecognizedAt','officialConfirmedAt','officialContractNoticeQueueCreatedAt','officialContractNoticeSentAt','confirmedAt','officialPdfGeneratedAt']),
      incomeAmount:firstNumber(obj,['rentalIncomeAmount']).found?firstNumber(obj,['rentalIncomeAmount']).value:(rentFee+shippingFee),
      status:clean(firstValue(obj,['status','contractStatus','rentalStatus','狀態']))||'未設定',
      raw:obj
    };
  }
  function normalizeRentalLedger(obj){
    return {id:clean(obj.__id),rentalContractId:clean(firstValue(obj,['rentalContractId','contractId']))||clean(obj.__id),receivedAmount:firstNumber(obj,['receivedAmount']).value,deliveryCost:firstNumber(obj,['deliveryCost']).value,maintenanceCost:firstNumber(obj,['maintenanceCost']).value,otherCost:firstNumber(obj,['otherCost']).value,note:clean(obj.note),updatedAt:obj.updatedAt||''};
  }
  function normalizeSale(obj){
    const total=firstNumber(obj,['total']).value,status=clean(obj.paymentStatus)||'paid',received=firstNumber(obj,['receivedAmount']),orderValue=firstNumber(obj,['orderTotal']),saleType=clean(obj.saleType)||'sale',fulfillment=clean(obj.fulfillmentStatus)||(saleType==='preorder'&&clean(obj.status)!=='completed'?'waiting_stock':'delivered');
    return {id:clean(obj.__id),saleNo:clean(obj.saleNo)||clean(obj.__id),soldAt:obj.soldAt||obj.createdAt||'',preorderAt:obj.preorderAt||'',deliveredAt:obj.deliveredAt||'',saleType:saleType,fulfillmentStatus:fulfillment,usageReason:clean(obj.usageReason),usageNote:clean(obj.usageNote),items:Array.isArray(obj.items)?obj.items:[],subtotal:firstNumber(obj,['subtotal']).value,manualDiscount:firstNumber(obj,['manualDiscount']).found?firstNumber(obj,['manualDiscount']).value:firstNumber(obj,['discount']).value,pointDiscount:firstNumber(obj,['pointDiscount']).value,discount:firstNumber(obj,['discount']).value,orderTotal:orderValue.found?orderValue.value:total,total:total,costTotal:firstNumber(obj,['costTotal']).value,returnedCost:firstNumber(obj,['returnedCost']).value,returnStatus:clean(obj.returnStatus),grossProfit:firstNumber(obj,['grossProfit']).value,paymentMethod:clean(obj.paymentMethod),customerId:clean(obj.customerId),customerName:clean(obj.customerName),customerType:clean(obj.customerType),memberNo:clean(obj.memberNo),pricingTier:clean(obj.pricingTier),paymentStatus:status,receivedAmount:received.found?received.value:(status==='paid'?(orderValue.found?orderValue.value:total):0),pointsEarned:firstNumber(obj,['pointsEarned']).value,pendingPointsEarned:firstNumber(obj,['pendingPointsEarned']).value,pointsRedeemed:firstNumber(obj,['pointsRedeemed']).value,earnPointsEnabled:obj.earnPointsEnabled!==false,note:clean(obj.note),status:clean(obj.status)||'completed',createdAt:obj.createdAt||''};
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
    return {id:clean(obj.__id),incomeNo:clean(obj.incomeNo)||clean(obj.__id),occurredAt:obj.occurredAt||obj.createdAt||'',category:clean(obj.category)||'其他收入',itemName:clean(obj.itemName||obj.title||obj.description),amount:firstNumber(obj,['amount']).value,paymentMethod:clean(obj.paymentMethod),paymentStatus:clean(obj.paymentStatus)||'paid',receivedAmount:firstNumber(obj,['receivedAmount']).found?firstNumber(obj,['receivedAmount']).value:firstNumber(obj,['amount']).value,customerId:clean(obj.customerId),customerName:clean(obj.customerName),note:clean(obj.note),status:clean(obj.status)||'completed',voidedAt:obj.voidedAt||'',createdAt:obj.createdAt||''};
  }
  function normalizePurchase(obj){
    return {id:clean(obj.__id),purchaseNo:clean(obj.purchaseNo)||clean(obj.__id),externalNo:clean(obj.externalNo),receivedAt:obj.receivedAt||obj.createdAt||'',supplierId:clean(obj.supplierId),supplier:clean(obj.supplier),items:Array.isArray(obj.items)?obj.items:[],subtotal:firstNumber(obj,['subtotal']).value,extraCost:firstNumber(obj,['extraCost']).value,totalCost:firstNumber(obj,['totalCost']).value,paymentStatus:clean(obj.paymentStatus)||'unpaid',paymentDate:obj.paymentDate||'',paymentMethod:clean(obj.paymentMethod),note:clean(obj.note),revisionHistory:Array.isArray(obj.revisionHistory)?obj.revisionHistory:[],createdAt:obj.createdAt||'',updatedAt:obj.updatedAt||''};
  }
  function normalizeInventory(obj){
    return {id:clean(obj.__id),type:clean(obj.type),productId:clean(obj.productId),productName:clean(obj.productName),sku:clean(obj.sku),qtyChange:firstNumber(obj,['qtyChange']).value,beforeStock:firstNumber(obj,['beforeStock']).value,afterStock:firstNumber(obj,['afterStock']).value,unitCost:numberOrNull(obj.unitCost),referenceType:clean(obj.referenceType),referenceId:clean(obj.referenceId),stocktakeNo:clean(obj.stocktakeNo),counterName:clean(obj.counterName||obj.operatorName),source:clean(obj.source),correctionOf:clean(obj.correctionOf),note:clean(obj.note),occurredAt:obj.occurredAt||obj.createdAt||'',createdAt:obj.createdAt||'',correctedAt:obj.correctedAt||'',correctedTo:firstNumber(obj,['correctedTo']).found?firstNumber(obj,['correctedTo']).value:null};
  }
  function normalizeCase(obj){
    const quoted=firstNumber(obj,['quotedAmount']).value; const received=firstNumber(obj,['receivedAmount']).value;
    const material=firstNumber(obj,['materialCost']).value; const labor=firstNumber(obj,['laborCost']).value; const transport=firstNumber(obj,['transportCost']).value; const other=firstNumber(obj,['otherCost']).value;
    return {id:clean(obj.__id),caseNo:clean(obj.caseNo)||clean(obj.__id),name:clean(obj.name)||'未命名案件',customer:clean(obj.customer),status:clean(obj.status)||'planning',quotedAmount:quoted,receivedAmount:received,materialCost:material,laborCost:labor,transportCost:transport,otherCost:other,totalCost:material+labor+transport+other,profit:received-(material+labor+transport+other),outstanding:Math.max(0,quoted-received),startDate:obj.startDate||'',dueDate:obj.dueDate||'',note:clean(obj.note),createdAt:obj.createdAt||'',updatedAt:obj.updatedAt||''};
  }
  function normalizeExpense(obj){ return {id:clean(obj.__id),expenseNo:clean(obj.expenseNo)||clean(obj.__id),occurredAt:obj.occurredAt||obj.createdAt||'',category:clean(obj.category)||'其他支出',amount:firstNumber(obj,['amount']).value,paymentMethod:clean(obj.paymentMethod),referenceType:clean(obj.referenceType),referenceId:clean(obj.referenceId),note:clean(obj.note),createdAt:obj.createdAt||''}; }
  function normalizeSyncJob(obj){ return {id:clean(obj.__id),jobNo:clean(obj.jobNo)||clean(obj.__id),type:clean(obj.type),status:clean(obj.status)||'preview',platforms:Array.isArray(obj.platforms)?obj.platforms:[],productCount:firstNumber(obj,['productCount']).value,createdAt:obj.createdAt||'',createdBy:clean(obj.createdBy),note:clean(obj.note)}; }
  function normalizePlatformOrder(obj){
    const quantity=firstNumber(obj,['quantity']).value,unitPrice=firstNumber(obj,['unitPrice']).value,grossAmount=firstNumber(obj,['grossAmount']).value,costTotal=firstNumber(obj,['costTotal']).value;
    const platform=clean(obj.platform),externalOrderId=clean(obj.externalOrderId),externalOrderNo=clean(obj.externalOrderNo)||externalOrderId,storedOrderedAt=obj.orderedAt||'';
    const initialSource=lower(obj.orderDateSource),knownSource=['easystore-created-at','coupang-ordered-at','momo-api-order-date','momo-order-number-inferred','agent-order-time-validated'].includes(initialSource);
    // 可信的平台原始下單時間優先於舊版留下的 hasOriginalOrderDate=false。
    // 舊資料可能已經有 EasyStore created_at，但在舊同步流程中被標成 false；
    // 不能因此把真正當天下單的訂單全部從畫面隱藏。
    let orderedAt=storedOrderedAt,hasOriginalOrderDate=(knownSource&&!!dateFrom(storedOrderedAt))||obj.hasOriginalOrderDate===true,orderDateSource=clean(obj.orderDateSource),orderTimeEstimated=obj.orderTimeEstimated===true,orderDateRepaired=obj.orderDateRepaired===true;
    if(platform==='MOMO'){
      const inferred=inferMomoOrderDateFromNumber(externalOrderNo||externalOrderId,storedOrderedAt||obj.firstSeenAt||obj.lastSeenAt),storedDate=dateFrom(storedOrderedAt),source=lower(orderDateSource);
      const dateMismatch=!!(inferred&&(!storedDate||dateText(storedDate)!==dateText(inferred)));
      const syncTime=platformOrderLooksLikeSyncTime(obj,storedOrderedAt);
      const explicitlySyncTime=['sync','sync-time','synchronized-at','legacy-sync','missing','unknown'].includes(source);
      if(inferred&&(dateMismatch||syncTime||explicitlySyncTime)){
        orderedAt=inferred;
        hasOriginalOrderDate=true;
        orderDateSource='momo-order-number-inferred';
        orderTimeEstimated=true;
        orderDateRepaired=true;
      }
    }
    return {
      id:clean(obj.__id),platform:platform,externalOrderId:externalOrderId,externalOrderNo:externalOrderNo,externalLineId:clean(obj.externalLineId),orderedAt:orderedAt,reportedOrderedAt:orderDateRepaired?(obj.reportedOrderedAt||storedOrderedAt):(obj.reportedOrderedAt||''),hasOriginalOrderDate:hasOriginalOrderDate,orderDateSource:orderDateSource,orderTimeEstimated:orderTimeEstimated,orderDateRepaired:orderDateRepaired,paidAt:obj.paidAt||'',shippedAt:obj.shippedAt||'',completedAt:obj.completedAt||'',settledAt:obj.settledAt||'',refundedAt:obj.refundedAt||'',cancelledAt:obj.cancelledAt||'',statusUpdatedAt:obj.statusUpdatedAt||'',sku:clean(obj.sku),productName:clean(obj.productName)||'未命名商品',variantName:clean(obj.variantName),quantity:quantity,unitPrice:unitPrice,grossAmount:grossAmount,estimatedNetAmount:firstNumber(obj,['estimatedNetAmount']).value,actualSettledAmount:numberOrNull(obj.actualSettledAmount),refundAmount:numberOrNull(obj.refundAmount),costTotal:costTotal,costEstimated:obj.costEstimated===true,costSource:clean(obj.costSource),estimatedProfit:firstNumber(obj,['estimatedProfit']).value,orderStatus:clean(obj.orderStatus),paymentStatus:clean(obj.paymentStatus),customerName:clean(obj.customerName),processingStatus:clean(obj.processingStatus),inventoryApplied:obj.inventoryApplied===true,inventoryReversed:obj.inventoryReversed===true,reversalApplied:obj.reversalApplied===true,reversalReason:clean(obj.reversalReason||obj.cancellationReason),reversalQuantity:firstNumber(obj,['reversalQuantity']).value,reversalCostTotal:firstNumber(obj,['reversalCostTotal']).value,inventoryBefore:firstNumber(obj,['inventoryBefore']).value,inventoryAfter:firstNumber(obj,['inventoryAfter']).value,inventoryBeforeReversal:firstNumber(obj,['inventoryBeforeReversal']).value,inventoryAfterReversal:firstNumber(obj,['inventoryAfterReversal']).value,missingFromPlatformCount:firstNumber(obj,['missingFromPlatformCount']).value,productId:clean(obj.productId),processingError:clean(obj.processingError),firstSeenAt:obj.firstSeenAt||'',lastSeenAt:obj.lastSeenAt||'',reversedAt:obj.reversedAt||'',syncRunId:clean(obj.syncRunId),returnHandlingStatus:clean(obj.returnHandlingStatus),returnDisposition:clean(obj.returnDisposition),returnQuantity:firstNumber(obj,['returnQuantity']).value,returnNote:clean(obj.returnNote),returnedReceivedAt:obj.returnedReceivedAt||'',returnProcessedAt:obj.returnProcessedAt||'',returnInventoryApplied:obj.returnInventoryApplied===true
    };
  }
  function normalizePlatformSyncRun(obj){
    return {id:clean(obj.__id),runId:clean(obj.runId)||clean(obj.__id),trigger:clean(obj.trigger),status:clean(obj.status),startedAt:obj.startedAt||'',finishedAt:obj.finishedAt||'',summary:obj.summary&&typeof obj.summary==='object'?obj.summary:{},error:clean(obj.error)};
  }
  function normalizePlatformInventoryQueue(obj){
    return {
      id:clean(obj.__id),
      productId:clean(obj.productId)||clean(obj.__id),
      sku:clean(obj.sku),
      productName:clean(obj.productName),
      targetStock:firstNumber(obj,['targetStock']).value,
      status:clean(obj.status)||'pending',
      reason:clean(obj.reason),
      lastAttemptStatus:clean(obj.lastAttemptStatus),
      lastAttemptAt:obj.lastAttemptAt||'',
      updatedAt:obj.updatedAt||'',
      runId:clean(obj.runId),
      results:obj.results&&typeof obj.results==='object'?obj.results:{}
    };
  }
  function inventorySyncAnomalyReason(status,message){
    const raw=clean(message),text=lower([status,raw].join(' '));
    if(text.includes('externalvendorsku')||text.includes('sellerproductid')||text.includes('vendoritemid'))return '找不到平台商品或規格 SKU 配對';
    if(text.includes('商品代碼')||text.includes('規格代碼')||text.includes('找不到')||text.includes('not found')||text.includes('no match'))return '找不到平台商品配對';
    if(text.includes('unauthorized')||text.includes('forbidden')||text.includes('401')||text.includes('403'))return '平台授權或權限異常';
    if(text.includes('timeout')||text.includes('timed out')||text.includes('逾時'))return '平台連線逾時';
    if(text.includes('rate limit')||text.includes('too many requests')||text.includes('429'))return '平台呼叫次數受限';
    if(clean(status)==='NOT_RUN')return '平台庫存更新未執行';
    return raw||clean(status)||'平台回傳未明錯誤';
  }
  function inventorySyncAnomalies(){
    const rows=[];
    (state.platformInventoryQueue||[]).forEach(function(queue){
      if(queue.lastAttemptStatus!=='error')return;
      const results=queue.results||{},platformNames=Object.keys(results);
      if(!platformNames.length){
        rows.push({queueId:queue.id,productId:queue.productId,sku:queue.sku,productName:queue.productName,targetStock:queue.targetStock,platform:'未辨識平台',status:'ERROR',message:'同步程式沒有留下平台明細',reason:'同步結果不完整',lastAttemptAt:queue.lastAttemptAt||queue.updatedAt,runId:queue.runId});
        return;
      }
      platformNames.forEach(function(platform){
        const result=results[platform]&&typeof results[platform]==='object'?results[platform]:{};
        if(result.success===true)return;
        rows.push({queueId:queue.id,productId:queue.productId,sku:queue.sku,productName:queue.productName,targetStock:queue.targetStock,platform:platform,status:clean(result.status)||'ERROR',message:clean(result.message),reason:inventorySyncAnomalyReason(result.status,result.message),lastAttemptAt:queue.lastAttemptAt||queue.updatedAt,runId:queue.runId});
      });
    });
    return rows.sort(function(a,b){return (dateFrom(b.lastAttemptAt)||0)-(dateFrom(a.lastAttemptAt)||0)||a.platform.localeCompare(b.platform,'zh-Hant')||a.sku.localeCompare(b.sku,'zh-Hant');});
  }
  function priceSyncAnomalyReason(status,message){
    const raw=clean(message),text=lower([status,raw].join(' '));
    if(clean(status)==='unsupported')return raw||'目前同步程式尚未支援此平台直接改價';
    if(text.includes('productid')||text.includes('variantid')||text.includes('vendoritemid')||text.includes('sku')||text.includes('找不到')||text.includes('unmapped'))return '找不到平台商品或規格配對';
    if(text.includes('unauthorized')||text.includes('forbidden')||text.includes('401')||text.includes('403'))return '平台授權或改價權限異常';
    if(text.includes('timeout')||text.includes('timed out')||text.includes('逾時'))return '平台改價連線逾時';
    if(text.includes('price')||text.includes('售價')||text.includes('價格'))return raw||'平台拒絕價格更新';
    return raw||clean(status)||'平台價格同步失敗';
  }
  function priceSyncAnomalies(){
    const rows=[];
    (state.catalog||[]).forEach(function(product){
      const sync=product.platformPriceSync&&typeof product.platformPriceSync==='object'?product.platformPriceSync:{};
      ['EasyStore','MOMO','Coupang'].forEach(function(platform){
        const row=sync[platform]&&typeof sync[platform]==='object'?sync[platform]:{},status=clean(row.status).toLowerCase();
        if(!['error','unmapped'].includes(status))return;
        rows.push({kind:'price',productId:product.docId,sku:product.sku,productName:product.originalName||product.name,targetPrice:numberOrNull(row.targetPrice),platform:platform,status:status.toUpperCase(),message:clean(row.message),reason:priceSyncAnomalyReason(status,row.message),lastAttemptAt:row.lastAttemptAt||row.requestedAt||sync.lastUpdatedAt,runId:clean(row.runId)});
      });
    });
    return rows;
  }
  function platformSyncAnomalies(){
    const inventory=inventorySyncAnomalies().map(function(row){return Object.assign({kind:'inventory'},row);});
    return inventory.concat(priceSyncAnomalies()).sort(function(a,b){return (dateFrom(b.lastAttemptAt)||0)-(dateFrom(a.lastAttemptAt)||0)||a.platform.localeCompare(b.platform,'zh-Hant')||clean(a.sku).localeCompare(clean(b.sku),'zh-Hant');});
  }
  function anomalyNameKey(value){
    return lower(clean(value)).replace(/\s+/g,'').replace(/[\-_/\\.,，。・:：;；()（）\[\]【】「」『』'"`]/g,'');
  }
  function platformSyncAnomalyGroups(rows){
    const catalogByDoc={},catalogBySku={},catalogByName={};
    (state.catalog||[]).forEach(function(product){
      const docId=clean(product.docId),sku=lower(clean(product.sku)),name=clean(product.originalName||product.onlineName||product.name),nameKey=anomalyNameKey(name);
      if(docId)catalogByDoc[docId]=product;
      if(sku&&!catalogBySku[sku])catalogBySku[sku]=product;
      if(nameKey&&!catalogByName[nameKey])catalogByName[nameKey]=product;
    });
    const groups=[],aliases={};
    (rows||[]).forEach(function(source,index){
      const row=Object.assign({},source),rawId=clean(row.productId),rawSku=clean(row.sku),rawName=clean(row.productName);
      const matched=(rawId&&catalogByDoc[rawId])||(rawSku&&catalogBySku[lower(rawSku)])||(rawName&&catalogByName[anomalyNameKey(rawName)])||null;
      const productId=rawId||clean(matched&&matched.docId),sku=rawSku||clean(matched&&matched.sku),productName=rawName||clean(matched&&(matched.originalName||matched.onlineName||matched.name));
      row.productId=productId;row.sku=sku;row.productName=productName;
      const candidateAliases=[];
      if(productId)candidateAliases.push('id:'+productId);
      if(sku)candidateAliases.push('sku:'+lower(sku));
      const nameKey=anomalyNameKey(productName);if(nameKey)candidateAliases.push('name:'+nameKey);
      let group=null;
      candidateAliases.some(function(alias){if(aliases[alias]){group=aliases[alias];return true;}return false;});
      if(!group){group={key:'anomaly-'+groups.length,productId:productId,sku:sku,productName:productName,issues:[],lastAttemptAt:row.lastAttemptAt};groups.push(group);}
      if(!group.productId&&productId)group.productId=productId;
      if(!group.sku&&sku)group.sku=sku;
      if(!group.productName&&productName)group.productName=productName;
      candidateAliases.forEach(function(alias){aliases[alias]=group;});
      const issueKey=[row.platform,row.kind,row.reason,row.message,row.targetPrice,row.targetStock].map(clean).join('|');
      if(!group.issues.some(function(issue){return issue.__issueKey===issueKey;})){row.__issueKey=issueKey;group.issues.push(row);}
      if((dateFrom(row.lastAttemptAt)||0)>(dateFrom(group.lastAttemptAt)||0))group.lastAttemptAt=row.lastAttemptAt;
    });
    groups.forEach(function(group){group.issues.sort(function(a,b){return a.platform.localeCompare(b.platform,'zh-Hant')||a.kind.localeCompare(b.kind,'zh-Hant');});});
    return groups.sort(function(a,b){return (dateFrom(b.lastAttemptAt)||0)-(dateFrom(a.lastAttemptAt)||0)||clean(a.productName).localeCompare(clean(b.productName),'zh-Hant')||clean(a.sku).localeCompare(clean(b.sku),'zh-Hant');});
  }
  function normalizeAudit(obj){ return {id:clean(obj.__id),action:clean(obj.action),entityType:clean(obj.entityType),entityId:clean(obj.entityId),summary:clean(obj.summary),createdAt:obj.createdAt||'',createdBy:clean(obj.createdBy)}; }


function queueInventorySyncInTransaction(tx,productId,sku,stock,reason){const ref=state.db.collection(COLLECTIONS.platformInventoryQueue).doc(productId);tx.set(ref,{productId:productId,sku:clean(sku),targetStock:Math.max(0,Number(stock||0)),status:'pending',reason:clean(reason),updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});}

  async function writeAudit(action,entityType,entityId,summary){
    try{ await state.db.collection(COLLECTIONS.audit).add({action:action,entityType:entityType,entityId:entityId||'',summary:summary||'',createdBy:userLabel(),createdAt:serverTimestamp(),version:VERSION}); }catch(err){}
  }

  function kpi(title,value,sub,icon){
    return '<article class="ops-kpi"><div class="ops-kpi-head"><span>'+escapeHtml(title)+'</span><span class="ops-kpi-icon">'+escapeHtml(icon||'•')+'</span></div><strong>'+escapeHtml(value)+'</strong><small>'+escapeHtml(sub||'')+'</small></article>';
  }
  function kpiAction(title,value,sub,icon,action){
    return '<button type="button" class="ops-kpi ops-kpi-action" data-action="'+attr(action)+'"><div class="ops-kpi-head"><span>'+escapeHtml(title)+'</span><span class="ops-kpi-icon">'+escapeHtml(icon||'•')+'</span></div><strong>'+escapeHtml(value)+'</strong><small>'+escapeHtml(sub||'')+'</small></button>';
  }
  const INJIAOYUN_DAILY_CALENDAR_URL='https://www.injiaoyun.com/dashboard/#/app/roomCalendar/day';
  function renderCourseCalendar(){
    return '<section class="ops-banner"><div class="icon">日</div><div><h3>請選擇要使用的課程日表</h3><p>舊版仍維持原本的音教雲流程；新版以相近日課表與操作方式重建，並可載入已移轉的課務資料進行唯讀核對。</p></div></section>'
      +'<div class="ops-grid-equal">'
      +'<section class="ops-card"><div class="ops-card-head"><div><span class="ops-tag blue">現行正式系統</span><h2 style="margin-top:10px">舊版課程日表（音教雲）</h2><p>沿用目前的排課、學生簽到與課務資料。</p></div></div><div class="ops-status-row"><div><b>資料來源</b><small>音教雲正式資料</small></div><span class="ops-status-dot">正式使用</span></div><p style="color:var(--ops-muted);font-size:12px;min-height:56px">會在新分頁開啟音教雲。未登入時先登入一次即可；帳號密碼不會存入 GitHub 網頁。</p><a class="ops-button dark" href="'+attr(INJIAOYUN_DAILY_CALENDAR_URL)+'" target="_blank" rel="noopener noreferrer">開啟舊版音教雲</a></section>'
      +'<section class="ops-card"><div class="ops-card-head"><div><span class="ops-tag green">新版課務關聯版</span><h2 style="margin-top:10px">新版排課系統</h2><p>30 分鐘格線、教室規則、衝突檢查、堂數扣抵、學生多期學費與完整課務紀錄。</p></div></div><div class="ops-status-row"><div><b>資料來源</b><small>示範資料／已移轉課務資料</small></div><span class="ops-status-dot warn">真實資料唯讀</span></div><p style="color:var(--ops-muted);font-size:12px;min-height:56px">示範模式可直接操作；輸入手動同步密碼後，可唯讀核對學生、繳費、老師、教室與排課。新版只讀取課務白名單，不讀取商品、庫存或銷售資料。</p><a class="ops-button primary" href="course-scheduler.html">開啟新版排課預覽</a></section>'
      +'</div>';
  }

  function render(){
    state.view=(location.hash||'#overview').replace('#','').split('?')[0]||'overview';
    if(!PAGE_META[state.view]) state.view='overview';
    const meta=PAGE_META[state.view]; setText('opsPageTitle',meta[0]); setText('opsPageSubtitle',meta[1]);
    const pageClock=byId('opsPageClock'); if(pageClock) pageClock.classList.toggle('hidden',state.view!=='sales');
    const navView=(state.view==='purchase-entry'||state.view==='stocktake')?'purchases':state.view;
    queryAll('#opsNav a[data-view]').forEach(function(a){ a.classList.toggle('active',a.dataset.view===navView); });
    const content=byId('opsContent'); if(!content) return;
    if(state.loading && !state.loadedAt){ content.innerHTML=loadingHtml(); return; }
    const renderers={overview:renderOverviewV7,'course-calendar':renderCourseCalendar,products:renderProducts,sales:renderSalesV7,customers:renderCustomersV6,receivables:renderReceivablesV5,purchases:renderPurchases,'purchase-entry':renderPurchaseEntry,stocktake:renderStocktakeWorkspace,rentals:renderRentals,sync:renderSync,connection:renderConnection};
    content.innerHTML=(renderers[state.view]||renderOverview)();
    enhanceMobileNumberInputs(content);
    bindViewSpecific();
  }

  function todayRows(rows,getDate){ const start=startOfDay(new Date()); const end=endOfDay(new Date()); return rows.filter(function(row){ const d=dateFrom(getDate(row)); return d&&d>=start&&d<=end; }); }
  function currentMonthRows(rows,getDate){ const now=new Date(); return rows.filter(function(row){ const d=dateFrom(getDate(row)); return d&&d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth(); }); }
  function isCompactMobile(){ return (global.innerWidth||0)<=780; }
  function todayDateKey(){ return dateText(new Date()); }
  function overviewDateKey(){
    const today=todayDateKey();
    const raw=clean(state.overviewDate);
    const valid=/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:today;
    state.overviewDate=valid>today?today:valid;
    return state.overviewDate;
  }
  function dateKeyShift(dateKey,step){ const base=new Date(dateKey+'T00:00:00'); base.setDate(base.getDate()+Number(step||0)); return dateText(base); }
  function weekdayText(value){ return '日一二三四五六'[new Date(value).getDay()]||''; }
  function overviewDateLabel(dateKey){ return dateKey.replace(/-/g,'/')+'（'+weekdayText(dateKey)+'）'; }
  function overviewDayNavigatorHtml(){
    const current=overviewDateKey(),today=todayDateKey(),next=dateKeyShift(current,1),disableNext=next>today;
    return '<div class="ops-overview-day-nav"><button type="button" class="ops-button ghost" data-action="overview-day-shift" data-step="-1">← 前一天</button><label class="ops-overview-day-label"><span>查詢日期</span><input class="ops-input" id="overviewDate" type="date" max="'+attr(today)+'" value="'+attr(current)+'"></label><button type="button" class="ops-button ghost" data-action="overview-day-shift" data-step="1" '+(disableNext?'disabled':'')+'>後一天 →</button></div>';
  }
  function overviewMonthSelectHtml(){
    const now=new Date(),year=now.getFullYear(),currentMonth=now.getMonth()+1,selected=clean(state.overviewMonth)||year+'-'+String(currentMonth).padStart(2,'0');
    const options=[];
    for(let month=1;month<=12;month+=1){
      const key=year+'-'+String(month).padStart(2,'0');
      options.push('<option value="'+attr(key)+'" '+(key===selected?'selected':'')+' '+(month>currentMonth?'disabled':'')+'>'+year+' 年 '+month+' 月</option>');
    }
    return '<label class="ops-overview-month-select '+(state.overviewRange==='month'?'active':'')+'"><span>月份</span><select class="ops-select" id="overviewMonth">'+options.join('')+'</select></label>';
  }
  function overviewRangeControlsHtml(){
    const todayActive=state.overviewRange==='today'&&overviewDateKey()===todayDateKey();
    const customLabel=state.overviewFrom&&state.overviewTo?'自訂區間':'自訂區間';
    return '<div class="ops-v8-overview-range">'
      +'<button type="button" class="ops-button ops-overview-today '+(todayActive?'primary':'ghost')+'" data-action="overview-range" data-range="today">今天</button>'
      +overviewDayNavigatorHtml()
      +overviewMonthSelectHtml()
      +'<button type="button" class="ops-button '+(state.overviewRange==='year'?'primary':'ghost')+'" data-action="overview-range" data-range="year">今年</button>'
      +'<details class="ops-overview-dropdown"><summary class="ops-button '+(state.overviewRange==='custom'?'primary':'ghost')+'">'+escapeHtml(customLabel)+'</summary><div class="ops-overview-dropdown-panel"><label>開始日期<input class="ops-input" id="overviewFrom" type="date" value="'+attr(state.overviewFrom)+'"></label><label>結束日期<input class="ops-input" id="overviewTo" type="date" value="'+attr(state.overviewTo)+'"></label><button type="button" class="ops-button primary wide" data-action="overview-custom-apply">套用區間</button></div></details>'
      +'</div>';
  }
  function mobileSearchPadHtml(targetId){
    if(!isCompactMobile()) return '';
    return '<div class="ops-mobile-search-pad" aria-label="SKU 數字鍵盤">'+['1','2','3','4','5','6','7','8','9','clear','0','back'].map(function(key){const label=key==='clear'?'清除':key==='back'?'⌫':key;return '<button type="button" data-action="mobile-key" data-target="'+attr(targetId)+'" data-key="'+key+'">'+label+'</button>';}).join('')+'</div>';
  }
  function scheduleDeferredSearchRender(inputId,value,immediate){
    const previous=deferredSearchTimers[inputId];
    if(previous){global.clearTimeout(previous);delete deferredSearchTimers[inputId];}
    const captured=String(value==null?'':value);
    const run=function(){
      const input=byId(inputId);
      if(!input||input.value!==captured)return;
      rerenderKeepingFocus(inputId,captured);
    };
    if(immediate)return run();
    deferredSearchTimers[inputId]=global.setTimeout(function(){
      delete deferredSearchTimers[inputId];
      // 空閒回呼可用時，讓輸入事件、游標及手機鍵盤先完成，再更新大型列表。
      if(typeof global.requestIdleCallback==='function')global.requestIdleCallback(run,{timeout:800});
      else global.setTimeout(run,0);
    },SEARCH_IDLE_DELAY_MS);
  }
  function setSearchInputValue(inputId,value){
    const input=byId(inputId);
    if(!input)return;
    input.value=String(value==null?'':value);
    try{input.focus({preventScroll:true});}catch(error){try{input.focus();}catch(ignore){}}
    try{input.setSelectionRange(input.value.length,input.value.length);}catch(error){}
  }
  function applyMobileKeyInput(targetId,key){
    const map={productSearch:'productSearch',purchaseLowSearch:'purchaseLowSearch',purchaseEntrySearch:'purchaseEntrySearch',stocktakeSearch:'stocktakeSearch',inventorySearch:'inventorySearch'};
    const stateKey=map[targetId];
    if(!stateKey) return;
    if(targetId==='productSearch'&&!closeProductEditorForListChange()) return;
    const current=String(state[stateKey]||'');
    let next=current;
    if(key==='clear') next='';
    else if(key==='back') next=current.slice(0,-1);
    else next=current+String(key||'');
    state[stateKey]=next;
    if(targetId==='productSearch'){ state.productSeries='all'; state.productFilter='all'; state.productVisible=PRODUCT_PAGE_SIZE; }
    if(targetId==='purchaseEntrySearch') state.purchaseEntrySeries='all';
    if(targetId==='stocktakeSearch') state.stocktakeSeries='all';
    setSearchInputValue(targetId,next);
    scheduleDeferredSearchRender(targetId,next,false);
  }
  function enhanceMobileNumberInputs(scope){
    if(!isCompactMobile()) return;
    const root=scope||document;
    queryAll('input[type="number"]',root).forEach(function(input){
      const step=clean(input.getAttribute('step'));
      const decimal=!!(step && step!=='1');
      input.setAttribute('inputmode',decimal?'decimal':'numeric');
      if(!decimal) input.setAttribute('pattern','[0-9]*');
    });
  }
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
    if(state.overviewRange==='today'){const selected=new Date(overviewDateKey()+'T00:00:00');start=startOfDay(selected);end=endOfDay(selected);label=overviewDateLabel(overviewDateKey());}
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
    const educationSyncBusy=state.injiaoyunManualRequestPending||injiaoyunSyncIsBusy(state.injiaoyunCloudSync);
    const teacherHtml=teacherRows.length?'<div class="ops-education-teachers">'+teacherRows.map(function(teacher){return '<button type="button" data-action="education-teacher-detail" data-teacher-key="'+attr(teacher.key)+'"><b>'+escapeHtml(teacher.name)+'</b><span>'+formatNumber(teacher.lessonCount)+' 堂</span><strong>'+money(teacher.amount)+'</strong></button>';}).join('')+'</div>':educationRows.length?emptyHtml('此期間沒有上課資料',''):emptyHtml('尚未取得課務資料','請按上方手動同步，或等待每天 22:00 自動同步。');
    const educationHtml='<section class="ops-card ops-education-section"><div class="ops-card-head"><div><h2>音教雲課務</h2></div><button class="ops-button primary" data-action="injiaoyun-import" '+(educationSyncBusy?'disabled':'')+'>'+(educationSyncBusy?'同步中…':'手動同步')+'</button></div><div class="ops-kpi-grid ops-education-kpis">'+kpi('上課堂數',formatNumber(educationSummary.lessonCount),'','堂')+kpi('課堂金額',money(educationSummary.lessonGross),'','課')+kpi('課堂拆帳',money(educationSummary.teacherPayable),'','師')+kpi('教室保留',money(educationSummary.schoolShare),'','留')+kpi('學費實收',money(educationSummary.tuitionReceived),'','收')+kpi('教室租用',money(educationSummary.roomRentalReceived),'','租')+'</div>'+teacherHtml+'</section>';
    return tabs+monthPicker+custom+'<div class="ops-kpi-grid ops-today-kpis">'+kpi('商品銷售',money(productRevenue),'','＄')+kpi('維修收入',money(repairRevenue),'','修')+kpi('其他收入',money(otherRevenue),'','＋')+kpi('租賃收益',money(rentalRevenue),'','租')+kpi('總收入',money(revenue),'','合')+kpi('商品成本',money(cost),'','成本')+kpi(bounds.label+'賺多少',money(profit),'','↗')+kpi('賣出數量',formatNumber(qty),'','件')+'</div>'+educationHtml;
  }

function renderOverviewV7(){
  const bounds=overviewBounds();
  function inRange(value){const date=dateFrom(value);return date&&(!bounds.start||date>=bounds.start)&&(!bounds.end||date<=bounds.end);}
  const sales=state.sales.filter(function(sale){return inRange(sale.soldAt);});
  const incomes=state.incomes.filter(function(income){return inRange(income.occurredAt);});
  const rentals=state.rentals.filter(function(rental){return rentalIsEstablished(rental)&&inRange(rental.incomeRecognizedAt);});
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
  const storeCash=productRevenue+repairRevenue+otherRevenue-returnRefund;
  const productCost=sum(sales,function(sale){return sale.costTotal;})-sum(returns,function(row){return row.restockedCost||0;});
  const storeBalance=storeCash-productCost;

  const rentalRevenue=sum(rentals,function(rental){return rental.incomeAmount;});
  const rentalCountLabel=state.overviewRange==='month'?(Number((state.overviewMonth||'').slice(5,7))||new Date().getMonth()+1)+' 月租賃件數':state.overviewRange==='today'?'今日租賃件數':state.overviewRange==='year'?'今年租賃件數':'區間租賃件數';

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
  const educationRetainedWithRental=educationSummary.schoolShare+educationSummary.roomRentalReceived;
  const networkRows=visiblePlatformOrders(state.platformOrders).filter(function(row){return platformOrderIsEffective(row)&&inRange(row.orderedAt);}),networkFeeMetrics=platformFeeMetrics(networkRows);
  const networkGross=networkFeeMetrics.gross,networkNet=networkFeeMetrics.net,networkCost=networkFeeMetrics.cost,networkProfit=networkFeeMetrics.profit;
  const networkQty=sum(networkRows,function(row){return row.quantity;});
  const networkOrderCount=new Set(networkRows.map(function(row){return row.platform+'|'+row.externalOrderNo;})).size;
  const networkFees=networkFeeMetrics.variableFees,networkFixedFees=networkFeeMetrics.fixedFees;

  const rangeControls=overviewRangeControlsHtml();
  const sync=state.injiaoyunCloudSync||{};
  const syncRange=clean(sync.lastStartDateKey)&&clean(sync.lastEndDateKey)?clean(sync.lastStartDateKey)+'～'+clean(sync.lastEndDateKey):'';
  const syncStatus=lower(sync.status),syncBusy=state.injiaoyunManualRequestPending||injiaoyunSyncIsBusy(sync),syncStale=(syncStatus==='queued'||syncStatus==='running')&&!syncBusy;
  let syncText='尚未取得同步紀錄';
  if(syncStale)syncText='上次同步可能中斷或逾時，可重新按「手動同步」。';
  else if(syncStatus==='queued')syncText='手動同步已排隊，正在等待雲端工作啟動…';
  else if(syncStatus==='running')syncText='音教雲正在同步中'+(clean(sync.currentStartDateKey)&&clean(sync.currentEndDateKey)?'｜資料範圍：'+clean(sync.currentStartDateKey)+'～'+clean(sync.currentEndDateKey):'')+'…';
  else if(syncStatus==='error')syncText='同步失敗'+(sync.lastFailedAt?'（'+dateTimeText(sync.lastFailedAt)+'）':'')+'：'+(clean(sync.lastError)||'請查看雲端執行記錄。').slice(0,180);
  else if(syncStatus==='success'&&sync.lastSucceededAt)syncText='最後同步：'+dateTimeText(sync.lastSucceededAt)+(syncRange?'｜資料範圍：'+syncRange:'')+(clean(sync.lastTrigger)==='manual'?'｜手動':'｜22:00 自動');

  const allBalance=storeBalance+networkProfit+rentalRevenue+educationRetainedWithRental;
  const syncAnomalies=platformSyncAnomalies(),syncAnomalyGroups=platformSyncAnomalyGroups(syncAnomalies),syncAnomalyCount=syncAnomalyGroups.length;
  const pendingPlatformRows=visiblePlatformOrders(state.platformOrders).filter(function(row){return platformOrderNeedsAttention(row)&&clean(row.processingStatus)!=='manual-return-review';}),pendingPlatform=pendingPlatformRows.length;
  const openReceivables=state.receivables.filter(function(row){return row.status!=='paid'&&Number(row.outstandingAmount||0)>0;});
  const outstanding=sum(openReceivables,function(row){return row.outstandingAmount;});
  const lowStock=state.catalog.filter(function(product){return product.initialized&&Number(product.currentStock||0)<=Number(product.safetyStock||0);});
  const attentionKinds=(syncAnomalyCount?1:0)+(pendingPlatform?1:0)+(openReceivables.length?1:0)+(lowStock.length?1:0);
  const cashStatus=openReceivables.length?'有未收款':'正常';
  const cashSub=openReceivables.length?money(outstanding)+' 尚未收回':'目前沒有未結清帳款';

  function summaryBox(label,value,kind){return '<div class="ops-v8-summary-box '+(kind||'')+'"><span>'+escapeHtml(label)+'</span><b>'+value+'</b></div>';}
  function metricRow(label,value){return '<div class="ops-v8-metric-row"><span>'+escapeHtml(label)+'</span><b>'+value+'</b></div>';}
  function metricAction(label,value,action){return '<button type="button" class="ops-v8-metric-row ops-v8-metric-action" data-action="'+attr(action)+'"><span>'+escapeHtml(label)+'</span><b>'+value+'</b></button>';}

  const rangeHtml=rangeControls;
  const heroHtml='<section class="ops-card ops-v8-overview-hero"><div class="ops-v8-hero-primary"><span>全通路預估淨利</span><strong class="'+(allBalance<0?'negative':'')+'">'+money(allBalance)+'</strong></div><div class="ops-v8-hero-secondary ops-v8-hero-secondary-simple">'+summaryBox('現金流狀態',escapeHtml(cashStatus),openReceivables.length?'warning':'success')+'<small class="ops-v8-cash-note">'+escapeHtml(cashSub)+'</small></div></section>';

  const storeHtml='<section class="ops-card ops-v8-channel-card ops-v8-channel-store"><div class="ops-v8-channel-accent"></div><div class="ops-v8-channel-head"><div><h2>門市營運</h2><p>現場商品、維修與其他收入</p></div><button class="ops-button small soft" data-nav="sales">前往銷售</button></div><div class="ops-v8-channel-summary">'+summaryBox('門市實收',money(storeCash))+summaryBox('預估毛利',money(storeBalance),storeBalance<0?'warning':'success')+'</div><div class="ops-v8-metric-list">'+metricRow('商品銷售',money(productRevenue))+metricRow('維修／其他',money(repairRevenue+otherRevenue))+metricRow('商品成本',money(productCost))+metricRow('退貨退款',money(returnRefund))+'</div></section>';
  const networkHtml='<section class="ops-card ops-v8-channel-card ops-v8-channel-network"><div class="ops-v8-channel-accent"></div><div class="ops-v8-channel-head"><div><h2>網路營運</h2><p>EasyStore、MOMO、Coupang</p></div><button class="ops-button small ghost" data-nav="sync">平台訂單</button></div><div class="ops-v8-channel-summary">'+summaryBox('預估入帳',money(networkNet))+summaryBox('預估毛利',money(networkProfit),networkProfit<0?'warning':'success')+'</div><div class="ops-v8-metric-list">'+metricRow('成交金額',money(networkGross))+metricRow('平台與金流費',money(networkFees))+metricRow('固定費用攤提',money(networkFixedFees))+metricRow('商品成本',money(networkCost))+metricRow('訂單／件數',formatNumber(networkOrderCount)+' 單／'+formatNumber(networkQty)+' 件')+'</div></section>';
  const rentalHtml='<section class="ops-card ops-v8-channel-card ops-v8-channel-rental"><div class="ops-v8-channel-accent"></div><div class="ops-v8-channel-head"><div><h2>租賃營運</h2><p>依上方選擇的日期區間統計</p></div><button class="ops-button small ghost" data-nav="rentals">查看租賃</button></div><div class="ops-v8-channel-summary">'+summaryBox('租賃收入',money(rentalRevenue))+summaryBox(rentalCountLabel,formatNumber(rentals.length)+' 件','success')+'</div><div class="ops-v8-metric-list">'+metricRow(bounds.label+'成立合約',formatNumber(rentals.length)+' 件')+'</div></section>';
  const educationHtml='<section class="ops-card ops-v8-channel-card ops-v8-channel-school"><div class="ops-v8-channel-accent"></div><div class="ops-v8-channel-head"><div><h2>補習班營運</h2><p>'+escapeHtml(syncText)+'</p></div><button class="ops-button small primary" data-action="injiaoyun-import" '+(syncBusy?'disabled':'')+'>'+(syncBusy?'同步中…':'手動同步')+'</button></div><div class="ops-v8-channel-summary">'+summaryBox('補習班實收',money(educationCash))+summaryBox('教室保留＋教室租用',money(educationRetainedWithRental),'success')+'</div><div class="ops-v8-metric-list">'+metricAction('學費實收',money(educationSummary.tuitionReceived),'education-tuition-detail')+metricAction('教室租用',money(educationSummary.roomRentalReceived),'education-rental-detail')+metricAction('老師拆帳',money(educationSummary.teacherPayable),'education-teacher-summary')+metricAction('教室保留明細',money(educationSummary.schoolShare),'education-school-share-detail')+'</div></section>';

  const alerts=[];
  if(syncAnomalyCount){const counts={};syncAnomalies.forEach(function(row){counts[row.platform]=Number(counts[row.platform]||0)+1;});const detail=Object.keys(counts).sort().map(function(name){return name+' '+counts[name]+' 項';}).join('、');alerts.push('<button type="button" class="ops-v8-attention-row" data-action="overview-sync-errors"><span class="ops-v8-attention-icon danger">同</span><span><b>平台同步異常</b><small>'+formatNumber(syncAnomalyCount)+' 件商品'+(detail?'：'+escapeHtml(detail):'')+'</small></span><em>查看明細</em></button>');}
  if(pendingPlatform){const matchCount=pendingPlatformRows.filter(function(row){return ['missing-sku','unmatched-sku','duplicate-sku'].includes(row.processingStatus);}).length,otherCount=Math.max(0,pendingPlatform-matchCount);alerts.push('<button type="button" class="ops-v8-attention-row" data-action="overview-order-errors"><span class="ops-v8-attention-icon">網</span><span><b>平台訂單資料待確認</b><small>'+formatNumber(pendingPlatform)+' 筆：SKU '+formatNumber(matchCount)+'、其他 '+formatNumber(otherCount)+'</small></span><em>查看</em></button>');}
  if(openReceivables.length)alerts.push('<button type="button" class="ops-v8-attention-row" data-nav="receivables"><span class="ops-v8-attention-icon danger">帳</span><span><b>門市應收帳款</b><small>'+formatNumber(openReceivables.length)+' 筆，共 '+money(outstanding)+'</small></span><em>查看</em></button>');
  if(lowStock.length)alerts.push('<button type="button" class="ops-v8-attention-row" data-action="overview-low-stock"><span class="ops-v8-attention-icon warning">庫</span><span><b>低於安全庫存</b><small>'+formatNumber(lowStock.length)+' 項商品需要確認補貨</small></span><em>處理</em></button>');
  const attentionHtml=alerts.length?alerts.join(''):'<div class="ops-v8-attention-empty"><b>目前沒有需要立即處理的項目</b><span>主要營運與同步狀態正常。</span></div>';
  const bottomHtml='<div class="ops-v8-overview-bottom ops-v8-overview-bottom-single"><section class="ops-card"><div class="ops-v8-section-head"><div><h2>需要注意</h2><p>同步異常、訂單異常、應收帳款與低庫存會集中顯示</p></div>'+(attentionKinds?'<span class="ops-tag yellow">'+formatNumber(attentionKinds)+' 類</span>':'<span class="ops-tag green">正常</span>')+'</div><div class="ops-v8-attention-list">'+attentionHtml+'</div></section></div>';
  return rangeHtml+heroHtml+'<div class="ops-v8-channel-grid">'+storeHtml+networkHtml+rentalHtml+educationHtml+'</div>'+bottomHtml;
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

  const PRODUCT_SERIES=[
    ['100','木吉他'],['102','古典吉他'],['104','電吉他'],['106','電貝斯'],['108','烏克麗麗'],
    ['120','電鋼琴'],['122','電子琴'],['130','爵士鼓'],['132','電子鼓'],['134','木箱鼓'],['138','世界打擊樂'],
    ['140','口琴'],['142','陶笛'],['144','卡林巴'],['146','直笛'],['148','綜合小樂器'],
    ['150','二胡／胡琴'],['152','中國笛'],['154','琵琶'],['156','柳琴'],['158','阮類'],['160','古箏'],
    ['162','揚琴'],['164','國樂管樂'],['166','其他國樂'],['180','長笛'],['182','小號'],['184','電子吹管'],['192','小提琴／中提琴'],
    ['5','電子類','5系列 電子類'],['9','書籍','9系列 書籍']
  ];
  function productSeriesLabel(row){return row[2]||row[0]+' '+row[1];}
  function productSeriesTabs(){
    return '<div class="ops-product-series-tabs"><button type="button" class="'+(state.productSeries==='all'?'active':'')+'" data-action="product-series" data-series="all">全部</button>'+PRODUCT_SERIES.map(function(row){return '<button type="button" class="'+(state.productSeries===row[0]?'active':'')+'" data-action="product-series" data-series="'+row[0]+'">'+escapeHtml(productSeriesLabel(row))+'</button>';}).join('')+'</div>';
  }
  function compareCatalogSku(a,b){
    const aSku=clean(a&&a.sku),bSku=clean(b&&b.sku);
    if(!aSku&&!bSku)return clean(a&&(a.originalName||a.name)).localeCompare(clean(b&&(b.originalName||b.name)),'zh-Hant',{numeric:true,sensitivity:'base'});
    if(!aSku)return 1;
    if(!bSku)return -1;
    const bySku=aSku.localeCompare(bSku,'zh-Hant',{numeric:true,sensitivity:'base'});
    if(bySku)return bySku;
    return clean(a&&(a.originalName||a.name)).localeCompare(clean(b&&(b.originalName||b.name)),'zh-Hant',{numeric:true,sensitivity:'base'});
  }
  function displayModeToggleHtml(action,currentMode,label){
    const mode=currentMode==='text'?'text':'image';
    return '<div class="ops-display-mode-toggle" role="group" aria-label="'+attr(label||'顯示模式')+'"><button type="button" class="'+(mode==='image'?'active':'')+'" data-action="'+attr(action)+'" data-mode="image" aria-pressed="'+(mode==='image'?'true':'false')+'">圖片模式</button><button type="button" class="'+(mode==='text'?'active':'')+'" data-action="'+attr(action)+'" data-mode="text" aria-pressed="'+(mode==='text'?'true':'false')+'">文字模式</button></div>';
  }
  function productFiltered(){
    const term=lower(state.productSearch); let rows=state.catalog.filter(function(p){
      if(state.productSeries!=='all'&&!clean(p.sku).startsWith(state.productSeries))return false;
      if(term&&!matchesSearch([p.originalName,p.onlineName,p.sku,formatLabelSku(p.sku),p.brand,p.category,p.variantName,p.docId],term))return false;
      if(state.productFilter==='missing-cost'&&!(p.averageCost==null&&p.nextFifoCost==null))return false;
      if(state.productFilter==='low'&&!(p.currentStock<=p.safetyStock))return false;
      if(state.productFilter==='in-stock'&&p.currentStock<=0)return false;
      if(state.productFilter==='matched'&&!p.matchedOnline)return false;
      if(state.productFilter==='unmatched'&&p.matchedOnline)return false;
      if(state.productFilter==='no-image'&&p.imageUrls.length)return false;
      if(state.productFilter==='negative'&&p.currentStock>=0)return false;
      return true;
    });
    rows.sort(compareCatalogSku); return rows;
  }
  function productCard(p){
    const allImages=Array.from(new Set((p.imageUrls||[]).concat(p.imageUrl?[p.imageUrl]:[]).filter(Boolean)));
    const parentImages=Array.from(new Set((p.parentImageUrls||[]).filter(Boolean)));
    const variantImages=Array.from(new Set((p.variantImageUrls||[]).filter(Boolean)));
    const mainImage=parentImages[0]||allImages[0]||'';
    const variantImage=variantImages.find(function(url){return url!==mainImage;})||allImages.find(function(url){return url!==mainImage;})||'';
    const urls=(isCompactMobile()?[mainImage]:[mainImage,variantImage]).filter(Boolean);
    const cleanOnline=displayOnlineName(p.onlineName)||displayOnlineName(p.originalName)||'未命名商品';
    const variant=clean(p.variantName);
    const imageHtml=urls.length?urls.map(function(url,index){return '<img loading="lazy" src="'+attr(url)+'" alt="'+attr(index===1&&variant?variant:cleanOnline)+'" onerror="this.style.display=\'none\'">';}).join(''):'<div class="placeholder">無圖</div>';
    const active=state.productEditId===p.docId?' active':'';
    return '<article class="ops-product-card ops-product-card-full'+active+'" data-action="product-edit" data-id="'+attr(p.docId)+'" role="button" tabindex="0"><div class="ops-product-image-grid '+(urls.length<2?'single':'')+'">'+imageHtml+'</div><div class="ops-product-body"><div class="ops-product-sku-row"><div class="ops-product-sku-main"><b>'+escapeHtml(p.sku||'未設定')+'</b>'+(p.sku?'<button type="button" class="ops-label-print-button" data-action="product-print-label" data-id="'+attr(p.docId)+'">列印條碼</button>':'')+'</div><span class="ops-product-inline-stock">庫存 <strong>'+escapeHtml(formatNumber(p.currentStock))+'</strong></span></div><div class="ops-product-name-rows"><b>'+escapeHtml(cleanOnline)+'</b></div>'+(variant?'<div class="ops-product-variant-row"><b>'+escapeHtml(variant)+'</b></div>':'')+'<div class="ops-product-detail-grid"><div><span>門市定價</span><b>'+money(p.storePrice)+'</b></div><div><span>網路售價</span><b>'+money(p.onlinePrice)+'</b></div><div><span>進貨成本</span><b>'+money(p.latestPurchaseCost)+'</b></div><div><span>平均成本</span><b>'+money(p.averageCost)+'</b></div></div></div></article>';
  }
  function productTextRow(p){
    const name=displayOnlineName(p.onlineName)||displayOnlineName(p.originalName)||'未命名商品';
    const variant=clean(p.variantName);
    const active=state.productEditId===p.docId?' active':'';
    return '<button type="button" class="ops-product-text-row'+active+'" data-action="product-edit" data-id="'+attr(p.docId)+'"><span class="ops-product-text-sku">'+escapeHtml(p.sku||'未設定')+'</span><span class="ops-product-text-name"><b>'+escapeHtml(name)+'</b>'+(variant?'<small>'+escapeHtml(variant)+'</small>':'')+'</span><span class="ops-product-text-value"><small>庫存</small><b>'+escapeHtml(formatNumber(p.currentStock))+'</b></span><span class="ops-product-text-value"><small>門市售價</small><b>'+money(p.storePrice)+'</b></span><span class="ops-product-text-value"><small>進貨成本</small><b>'+money(p.latestPurchaseCost)+'</b></span><span class="ops-product-text-value"><small>平均成本</small><b>'+money(p.averageCost)+'</b></span><span class="ops-product-text-value"><small>EasyStore</small><b>'+money(p.easyStorePrice)+'</b></span><span class="ops-product-text-value"><small>MOMO</small><b>'+money(p.momoPrice)+'</b></span><span class="ops-product-text-value"><small>酷澎</small><b>'+money(p.coupangPrice)+'</b></span></button>';
  }

  const LABEL_PRINT_ENDPOINTS=['http://127.0.0.1:18181','http://localhost:18181'];
  let labelPrintEndpoint='';
  function labelPrintProductData(product){
    const name=clean(product&&(product.originalName||product.onlineName||product.name))||'未命名商品';
    const variant=clean(product&&product.variantName);
    const storePrice=numberOrNull(product&&product.storePrice);
    const onlinePrice=numberOrNull(product&&product.onlinePrice);
    const sku=clean(product&&product.sku);
    return {productId:clean(product&&product.docId),sku:sku,displaySku:formatLabelSku(sku),name:name,variant:variant,price:Math.round(storePrice!=null?storePrice:(onlinePrice!=null?onlinePrice:0))};
  }
  async function labelPrintFetch(path,options){
    const endpoints=labelPrintEndpoint?[labelPrintEndpoint].concat(LABEL_PRINT_ENDPOINTS.filter(function(url){return url!==labelPrintEndpoint;})):LABEL_PRINT_ENDPOINTS.slice();
    let lastError=null;
    for(const endpoint of endpoints){
      try{
        const controller=typeof AbortController!=='undefined'?new AbortController():null;
        const timer=controller?setTimeout(function(){controller.abort();},3500):null;
        let response;
        try{response=await fetch(endpoint+path,Object.assign({cache:'no-store',mode:'cors'},options||{},controller?{signal:controller.signal}:{}));}
        finally{if(timer)clearTimeout(timer);}
        const bodyText=await response.text();let payload={};
        try{payload=bodyText?JSON.parse(bodyText):{};}catch(err){payload={message:bodyText};}
        if(!response.ok)throw new Error(clean(payload.error||payload.message)||('列印服務回應 '+response.status));
        labelPrintEndpoint=endpoint;return payload;
      }catch(error){lastError=error;}
    }
    throw lastError||new Error('找不到條碼列印服務');
  }
  function labelPreviewHalf(data){
    const displaySku=data.displaySku||formatLabelSku(data.sku);
    const skuLength=displaySku.length;
    const skuClass=skuLength>12?'long':(skuLength>10?'compact':'normal');
    const productText=[data.name,data.variant].filter(Boolean).join(' ');
    const textLength=productText.length;
    const textClass=textLength>30?'small':(textLength>22?'compact':'normal');
    return '<div class="ops-label-preview-half"><div class="ops-label-preview-left"><div class="ops-label-preview-qr"><i></i></div><div class="ops-label-preview-price">'+escapeHtml(String(data.price))+'</div></div><div class="ops-label-preview-right"><div class="ops-label-preview-sku '+skuClass+'">'+escapeHtml(displaySku)+'</div><div class="ops-label-preview-name '+textClass+'">'+escapeHtml(productText||'未命名商品')+'</div></div></div>';
  }
  function openProductLabelPrint(productId){
    const product=catalogById(productId);if(!product)return toast('找不到商品','請重新讀取商品資料。','error');
    const data=labelPrintProductData(product);if(!data.sku)return toast('無法列印條碼','這項商品尚未設定商品編號。','warning');
    const body='<form id="labelPrintForm" data-product-id="'+attr(productId)+'"><div class="ops-label-print-summary"><div><span>商品編號</span><b>'+escapeHtml(data.displaySku||data.sku)+'</b></div><div><span>門市售價</span><b>'+money(data.price)+'</b></div><div class="full"><span>商品名稱</span><b>'+escapeHtml(data.name)+(data.variant?'｜'+escapeHtml(data.variant):'')+'</b></div></div><div class="ops-label-preview">'+labelPreviewHalf(data)+labelPreviewHalf(data)+'</div><p class="ops-label-print-note">35 × 25 mm 雙聯標籤，上下內容相同；顯示編號採 500-1234-1 格式，QR Code 仍對應商品編號。</p><div class="ops-label-service-status checking" id="labelPrintServiceStatus">正在確認這台電腦的 TSC 列印服務…</div><div class="ops-field"><label class="ops-required">列印張數</label><input class="ops-input ops-label-copies" name="copies" type="number" inputmode="numeric" min="1" max="500" step="1" value="1" required></div><button class="ops-button primary wide" id="labelPrintSubmit" type="submit">列印條碼</button></form>';
    openDrawer('列印條碼','TSC TTP-244 Plus｜35 × 25 mm 雙聯標籤',body);
    setTimeout(checkLabelPrintService,30);
  }
  async function checkLabelPrintService(){
    const status=byId('labelPrintServiceStatus');if(!status)return;
    try{
      const result=await labelPrintFetch('/health',{method:'GET'});
      if(result.printerInstalled===false)throw new Error('Windows 找不到 '+clean(result.printerName||'TSC TTP-244 Plus'));
      status.className='ops-label-service-status ready';
      status.textContent='已連線：'+clean(result.printerName||'TSC TTP-244 Plus')+'，可以直接列印。';
    }catch(error){
      status.className='ops-label-service-status offline';
      status.textContent='尚未連線。請確認條碼機電腦的自動列印服務已安裝並啟動。';
    }
  }
  async function saveLabelPrint(form){
    const product=catalogById(form.dataset.productId);if(!product)throw new Error('找不到商品資料');
    const data=labelPrintProductData(product);const formData=new FormData(form);const copies=Math.max(1,Math.min(500,Math.round(Number(formData.get('copies')||1))));
    const status=byId('labelPrintServiceStatus');if(status){status.className='ops-label-service-status checking';status.textContent='正在送出列印工作…';}
    const result=await labelPrintFetch('/print',{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({sku:data.displaySku||data.sku,rawSku:data.sku,displaySku:data.displaySku||data.sku,name:data.name,variant:data.variant,price:data.price,copies:copies,labelLayoutVersion:'20260716-v2'})});
    closeDrawer();toast('條碼已送出',(data.displaySku||data.sku)+'｜'+copies+' 張｜'+clean(result.printerName||'TSC TTP-244 Plus'),'success');
  }

  function renderProducts(){
    const rows=productFiltered(),visible=rows.slice(0,state.productVisible),central=state.matchingStats.central;
    const inventoryValue=sum(state.catalog,function(p){return p.inventoryValue||0;});
    const low=state.catalog.filter(function(p){return p.initialized&&p.currentStock<=p.safetyStock;}).length;
    const editingProduct=state.productEditId&&state.productEditId!=='__new__'?catalogById(state.productEditId):null;
    const editorHtml=state.productEditId?productFormHtml(editingProduct):'';
    const previewHtml=renderProductPreviewModal();
    const lowActive=state.productFilter==='low';
    const listHtml=visible.length
      ?(state.productDisplayMode==='text'?'<div class="ops-product-text-list">'+visible.map(productTextRow).join('')+'</div>':'<div class="ops-products-grid">'+visible.map(productCard).join('')+'</div>')+(visible.length<rows.length?'<div class="ops-pagination"><button class="ops-button ghost" data-action="load-more-products">顯示更多</button></div>':'')
      :emptyHtml(central?'找不到商品':'尚未建立商品',central?'請調整搜尋條件。':'請先新增商品或匯入商品資料。','<button class="ops-button primary" data-action="product-new">新增商品</button>');
    return '<section class="ops-card ops-product-section"><div class="ops-product-title-row"><div class="ops-product-title-group"><h2>商品庫存</h2><div class="ops-product-title-stat">庫存成本總額：<b>'+money(inventoryValue)+'</b></div><button type="button" class="ops-product-low-button '+(lowActive?'active':'')+'" data-action="product-low-stock">低於安全庫存：<b>'+formatNumber(low)+' 項</b></button></div><div class="ops-card-actions"><button class="ops-button primary" data-action="product-new">新增商品</button><button class="ops-button soft" data-action="sync-easystore-api" '+(state.easyStoreSyncPending?'disabled aria-busy="true"':'')+'>'+(state.easyStoreSyncPending?'圖片同步中…':'同步圖片')+'</button><button class="ops-button soft" data-action="open-import">'+(central?'更新商品資料':'匯入商品資料')+'</button></div></div>'+productSeriesTabs()+'<div class="ops-product-toolbar"><input class="ops-input" id="productSearch" placeholder="搜尋商品名稱或 SKU" value="'+attr(state.productSearch)+'">'+displayModeToggleHtml('product-display-mode',state.productDisplayMode,'商品顯示方式')+'</div>'+mobileSearchPadHtml('productSearch')+editorHtml+listHtml+'</section>'+previewHtml;
  }

  function estimateFifoCostForProduct(p,qty){if(!p||!p.internal)return 0;try{return consumeFifo(p.internal,qty).costTotal;}catch(err){return qty*Number(p.nextFifoCost||p.averageCost||0);}}
  function estimateCartCost(){return sum(state.cart,function(item){const p=catalogById(item.productId);return estimateFifoCostForProduct(p,item.qty);});}
  function renderDirectIncomeForm(mode){
    const repair=mode==='repair';
    const title=repair?'維修收入':'未登錄商品／其他收入';
    const category=repair?'維修收入':'';
    return '<section class="ops-card ops-direct-income"><div class="ops-card-head"><div><h2>'+title+'</h2></div></div><form id="quickIncomeForm"><input type="hidden" name="occurredAt" value="'+inputDateTime(new Date())+'"><div class="ops-form-grid"><div class="ops-field full"><label class="ops-required">'+(repair?'維修項目':'收入項目')+'</label><input class="ops-input" name="category" value="'+attr(category)+'" placeholder="'+(repair?'例如：吉他維修':'例如：未登錄商品、搬運費')+'" required></div><div class="ops-field"><label class="ops-required">金額</label><input class="ops-input" type="number" inputmode="decimal" min="0" step="1" name="amount" required></div><div class="ops-field"><label>付款方式</label><select class="ops-select" name="paymentMethod"><option>現金</option><option>信用卡</option><option>轉帳</option><option>LINE Pay</option><option>其他</option></select></div><div class="ops-field"><label>客戶姓名</label><input class="ops-input" name="customerName"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note"></textarea></div></div><button class="ops-button primary wide" type="submit">確認收款</button></form></section>';
  }
  function renderSales(){
    const products=state.catalog.filter(function(p){return p.initialized&&p.status!=='inactive';}); const term=lower(state.posSearch).trim();
    const choices=term.length>=1?products.filter(function(p){return matchesSearch([p.originalName,p.onlineName,p.sku,formatLabelSku(p.sku),p.barcode,p.brand,p.category],term);}).slice(0,30):[];
    const cartSubtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;});
    const todaySales=todayRows(state.sales,function(x){return x.soldAt;});const todayIncome=todayRows(state.incomes,function(x){return x.occurredAt;});
    let productHtml='';
    if(choices.length) productHtml=choices.map(function(p){const image=p.imageUrl||'';return '<button class="ops-pos-item" data-action="cart-add" data-id="'+attr(p.docId)+'">'+(image?'<img loading="lazy" src="'+attr(image)+'" alt="" onerror="this.style.display=\'none\'">':'<div class="ops-pos-no-image">無圖</div>')+'<div><b>'+escapeHtml(p.originalName||p.name)+'</b>'+(p.onlineName?'<small class="ops-pos-online">網路：'+escapeHtml(p.onlineName)+'</small>':'')+'<small>編號 '+escapeHtml(p.sku||'未設定')+'・庫存 '+formatNumber(p.currentStock)+'・'+money(p.storePrice)+'</small></div></button>';}).join('');
    else if(term) productHtml='<div class="ops-no-result">找不到商品</div>';
    const cartHtml=state.cart.length?state.cart.map(function(item,index){const p=catalogById(item.productId);return '<div class="ops-cart-row"><div><b>'+escapeHtml(item.name)+'</b><small>編號 '+escapeHtml(item.sku||'')+'・庫存 '+formatNumber(p?p.currentStock:item.currentStock)+'</small></div><input aria-label="數量" type="number" min="1" step="1" value="'+item.qty+'" data-cart-qty="'+index+'"><input aria-label="售價" type="number" min="0" step="1" value="'+item.unitPrice+'" data-cart-price="'+index+'"><button class="ops-icon-button" data-action="cart-remove" data-index="'+index+'">×</button></div>';}).join(''):'<div class="ops-empty"><strong>尚未選商品</strong></div>';
    const productRevenue=sum(todaySales,function(x){return x.total;});const otherRevenue=sum(todayIncome,function(x){return x.amount;});const todayProfit=sum(todaySales,function(x){return x.grossProfit;})+otherRevenue;
    return '<div class="ops-pos-layout"><section class="ops-card"><div class="ops-toolbar"><input class="ops-input grow ops-pos-search" id="posSearch" placeholder="商品編號／名稱" value="'+attr(state.posSearch)+'"><button class="ops-button ghost" data-action="pos-clear-search">清除</button></div><div class="ops-pos-products">'+productHtml+'</div></section><section class="ops-card"><div class="ops-card-head"><div><h2>要賣的商品</h2></div><button class="ops-button small ghost" data-action="cart-clear">清空</button></div><div class="ops-cart">'+cartHtml+'</div>'+(state.cart.length?'<div class="ops-summary-line total" style="margin-top:12px"><span>這次應收金額</span><b id="cartSubtotal">'+money(cartSubtotal)+'</b></div>':'')+'<div style="margin-top:13px"><button class="ops-button primary wide" data-action="checkout" '+(state.cart.length?'':'disabled')+'>前往結帳</button></div></section></div><div class="ops-income-shortcuts" style="margin-top:15px"><button class="ops-button soft" data-action="open-quick-income" data-category="維修收入">＋ 維修收入</button><button class="ops-button soft" data-action="open-quick-income" data-category="未登錄商品">＋ 未登錄商品</button><button class="ops-button soft" data-action="open-quick-income" data-category="其他收入">＋ 其他收入</button></div><section class="ops-card"><div class="ops-card-head"><div><h2>今天收入</h2></div><button class="ops-button small ghost" data-action="show-sales-history">查看銷售紀錄</button></div><div class="ops-kpi-grid" style="margin-bottom:0">'+kpi('商品銷售',money(productRevenue),todaySales.length+' 筆','＄')+kpi('其他收入',money(otherRevenue),todayIncome.length+' 筆','＋')+kpi('今天賺多少',money(todayProfit),'收入扣除商品成本','↗')+'</div></section>';
  }

  function customerTypeName(value){return {general:'一般客戶',member:'會員',teacher:'老師',organization:'機構'}[value]||'一般客戶';}
  function pricingTierName(value){return {retail:'一般售價',teacher:'老師價',custom:'自訂價格'}[value]||'一般售價';}
  function renderCustomers(){
    const term=lower(state.customerSearch);const rows=state.customers.filter(function(x){return !term||lower([x.name,x.phone,x.email,x.memberNo,x.customerType].join(' ')).includes(term);}).sort(function(a,b){return a.name.localeCompare(b.name,'zh-Hant');});
    const table=rows.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>客戶</th><th>身分／價格</th><th>聯絡方式</th><th class="num">點數</th><th class="num">未收款</th><th></th></tr></thead><tbody>'+rows.map(function(x){const due=sum(state.receivables.filter(function(r){return r.customerId===x.id&&r.status!=='paid';}),function(r){return r.outstandingAmount;});return '<tr><td><b>'+escapeHtml(x.name)+'</b><br><small>'+escapeHtml(x.memberNo||'尚無會員編號')+'</small></td><td>'+statusTag(customerTypeName(x.customerType),x.customerType==='teacher'?'yellow':'green')+'<br><small>'+escapeHtml(pricingTierName(x.pricingTier))+'</small></td><td>'+escapeHtml(x.phone||'—')+'<br><small>'+escapeHtml(x.email||'')+'</small></td><td class="num">'+formatNumber(x.pointBalance)+'</td><td class="num">'+money(due)+'</td><td><button class="ops-button small ghost" data-action="customer-edit" data-id="'+attr(x.id)+'">編輯</button></td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('尚無客戶資料','先建立會員、老師或一般客戶。','<button class="ops-button primary" data-action="customer-new">新增客戶</button>');
    return '<div class="ops-kpi-grid">'+kpi('客戶總數',formatNumber(state.customers.length),'全部客戶','人')+kpi('會員',formatNumber(state.customers.filter(function(x){return x.customerType==='member';}).length),'已建立會員','點')+kpi('老師',formatNumber(state.customers.filter(function(x){return x.customerType==='teacher';}).length),'可套用老師價','師')+kpi('累積未收款',money(sum(state.receivables,function(x){return x.outstandingAmount;})),'連結應收帳款','帳')+'</div><section class="ops-card"><div class="ops-card-head"><div><h2>客戶與會員</h2><p>點數規則與老師折扣先保留，之後再設定。</p></div><button class="ops-button primary" data-action="customer-new">新增客戶</button></div><div class="ops-toolbar"><input class="ops-input grow" id="customerSearch" placeholder="搜尋姓名、電話、Email 或會員編號" value="'+attr(state.customerSearch)+'"></div>'+table+'</section>';
  }

  function selectedCustomer(){return state.customers.find(function(x){return x.id===state.selectedCustomerId&&x.enabled;})||null;}
  function customerOptions(selectedId){
    return '<option value="">門市散客</option>'+state.customers.filter(function(x){return x.enabled;}).sort(function(a,b){return a.name.localeCompare(b.name,'zh-Hant');}).map(function(x){return '<option value="'+attr(x.id)+'" '+(x.id===selectedId?'selected':'')+'>'+escapeHtml(x.name)+(x.memberNo?'｜'+escapeHtml(x.memberNo):'')+'</option>';}).join('');
  }
  function membershipRuleForDate(value){
    const s=state.membershipSettings||DEFAULT_MEMBERSHIP_SETTINGS,d=dateFrom(value)||new Date(),year=String(d.getFullYear()),rules=s.annualRules&&typeof s.annualRules==='object'?s.annualRules:{},years=Object.keys(rules).filter(function(y){return /^\d{4}$/.test(y)&&Number(y)<=Number(year);}).sort();const yearly=rules[year]||(years.length?rules[years[years.length-1]]:null)||{};return Object.assign({},DEFAULT_MEMBERSHIP_SETTINGS,s,yearly,{year:Number(yearly.year||year),annualRules:rules});
  }
  function membershipRuleActive(value){const rule=membershipRuleForDate(value);return rule.enabled!==false;}
  function calculateEarnPoints(amount,value){const rule=membershipRuleForDate(value);if(rule.enabled===false)return 0;return Math.floor(Math.max(0,Number(amount||0))*Math.max(0,Number(rule.rewardPercent||0))/100);}
  function pointDiscount(points,value){const s=membershipRuleForDate(value);if(Number(s.redeemPoints)<=0)return 0;return Math.floor(Math.max(0,Number(points||0))/Number(s.redeemPoints))*Math.max(0,Number(s.redeemAmount||0));}
  function productRewardPercent(raw,value){const custom=numberOrNull(raw&&raw.saleRewardPercent);return custom==null?Math.max(0,Number(membershipRuleForDate(value).rewardPercent||0)):Math.max(0,custom);}
  function calculatePreparedRewardPoints(prepared,total,subtotal,value){if(!membershipRuleActive(value)||subtotal<=0||total<=0)return 0;const ratio=Math.min(1,total/subtotal),rawPoints=sum(prepared,function(x){return (x.qty*x.unitPrice)*ratio*productRewardPercent(x.raw,value)/100;});return Math.floor(Math.max(0,rawPoints));}
  function maxRedeemablePoints(customer,subtotal){
    if(!customer||customer.customerType!=='member'||!membershipRuleActive())return 0;const s=membershipRuleForDate(new Date()),step=Math.max(1,Math.floor(Number(s.redeemPoints||1))),balance=Math.floor(Math.max(0,Number(customer.pointBalance||0))/step)*step,percent=Math.max(0,Math.min(100,Number(s.maxRedeemPercent||0))),maxDiscount=Math.max(0,Number(subtotal||0))*percent/100,units=Number(s.redeemAmount)>0?Math.floor(maxDiscount/Number(s.redeemAmount)):0,maxByAmount=units*step,result=Math.min(balance,maxByAmount);return result>=Math.max(step,Math.floor(Number(s.minRedeemPoints||1)))?result:0;
  }
  function posCustomerBar(){
    const c=selectedCustomer();return '<section class="ops-card ops-pos-customer"><select class="ops-select" id="posCustomerSelect">'+customerOptions(c?c.id:'')+'</select><button class="ops-button primary" data-action="pos-customer-new">新增會員</button>'+(c?'<button class="ops-button ghost" data-action="customer-history" data-id="'+attr(c.id)+'">消費紀錄</button><div class="ops-pos-customer-info"><b>'+escapeHtml(c.name)+'</b><span>'+escapeHtml(customerTypeName(c.customerType))+'</span>'+(c.customerType==='member'?'<strong>'+formatNumber(c.pointBalance)+' 點</strong>':'')+'</div>':'')+'</section>';
  }
  function renderDirectIncomeV4(mode){
    const repair=mode==='repair',c=selectedCustomer();return '<section class="ops-card ops-direct-income"><form id="quickIncomeForm"><input type="hidden" name="occurredAt" value="'+inputDateTime(new Date())+'"><input type="hidden" name="customerId" value="'+attr(c?c.id:'')+'"><div class="ops-form-grid"><div class="ops-field full"><label class="ops-required">'+(repair?'維修項目':'收入項目')+'</label>'+(repair?'<input class="ops-input" name="category" value="維修收入" required>':'<select class="ops-select" name="category"><option value="未登錄商品">未登錄商品</option><option value="其他收入">其他收入</option></select>')+'</div><div class="ops-field"><label class="ops-required">金額</label><input class="ops-input" type="number" inputmode="decimal" min="0" step="1" name="amount" required></div><div class="ops-field"><label>付款方式</label><select class="ops-select" name="paymentMethod"><option>現金</option><option>信用卡</option><option>轉帳</option><option>LINE Pay</option><option>其他</option></select></div><div class="ops-field"><label>收款狀態</label><select class="ops-select" name="paymentStatus"><option value="paid">已收清</option><option value="partial">部分收款</option><option value="unpaid">未收款</option></select></div><div class="ops-field"><label>本次已收</label><input class="ops-input" type="number" inputmode="decimal" min="0" step="1" name="receivedAmount"></div></div><button class="ops-button primary wide" type="submit">確認</button></form></section>';
  }
  function renderSalesV4(){
    const products=state.catalog.filter(function(p){return p.initialized&&p.status!=='inactive';}),term=lower(state.posSearch).trim(),choices=term?products.filter(function(p){return matchesSearch([p.originalName,p.onlineName,p.sku,formatLabelSku(p.sku),p.barcode,p.brand,p.category],term);}).slice(0,30):[],cartSubtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;}),todaySales=todayRows(state.sales,function(x){return x.soldAt;}),todayIncome=todayRows(state.incomes,function(x){return x.occurredAt;}),repairIncome=todayIncome.filter(function(x){return x.category==='維修收入';}),otherIncome=todayIncome.filter(function(x){return x.category!=='維修收入';});
    let main='';
    if(state.salesMode==='product'){
      let productHtml='';if(choices.length)productHtml=choices.map(function(p){const image=p.imageUrl||'';return '<button class="ops-pos-item" data-action="cart-add" data-id="'+attr(p.docId)+'">'+(image?'<img loading="lazy" src="'+attr(image)+'" alt="" onerror="this.style.display=\'none\'">':'<div class="ops-pos-no-image">無圖</div>')+'<div><b>'+escapeHtml(p.originalName||p.name)+'</b><small>編號 '+escapeHtml(p.sku||'未設定')+'・庫存 '+formatNumber(p.currentStock)+'・'+money(p.storePrice)+'</small></div></button>';}).join('');else if(term)productHtml='<div class="ops-no-result">找不到商品</div>';
      const cartHtml=state.cart.length?state.cart.map(function(item,index){const p=catalogById(item.productId);return '<div class="ops-cart-row"><div><b>'+escapeHtml(item.name)+'</b><small>編號 '+escapeHtml(item.sku||'')+'・庫存 '+formatNumber(p?p.currentStock:item.currentStock)+'</small></div><input aria-label="數量" type="number" min="1" step="1" value="'+item.qty+'" data-cart-qty="'+index+'"><input aria-label="售價" type="number" min="0" step="1" value="'+item.unitPrice+'" data-cart-price="'+index+'"><button class="ops-icon-button" data-action="cart-remove" data-index="'+index+'">×</button></div>';}).join(''):'<div class="ops-empty"><strong>尚未選商品</strong></div>';
      main='<div class="ops-pos-layout"><section class="ops-card"><div class="ops-toolbar"><input class="ops-input grow ops-pos-search" id="posSearch" placeholder="商品編號／名稱" value="'+attr(state.posSearch)+'"><button class="ops-button ghost" data-action="pos-clear-search">清除</button></div><div class="ops-pos-products">'+productHtml+'</div></section><section class="ops-card"><div class="ops-card-head"><h2>要賣的商品</h2><button class="ops-button small ghost" data-action="cart-clear">清空</button></div><div class="ops-cart">'+cartHtml+'</div>'+(state.cart.length?'<div class="ops-summary-line total"><span>應收金額</span><b id="cartSubtotal">'+money(cartSubtotal)+'</b></div>':'')+'<button class="ops-button primary wide" data-action="checkout" '+(state.cart.length?'':'disabled')+'>結帳</button></section></div>';
    }else main=renderDirectIncomeV4(state.salesMode);
    const productRevenue=sum(todaySales,function(x){return x.total;}),repairRevenue=sum(repairIncome,function(x){return x.amount;}),otherRevenue=sum(otherIncome,function(x){return x.amount;});
    return posCustomerBar()+'<div class="ops-sales-modes"><button data-action="sales-mode" data-mode="product" class="'+(state.salesMode==='product'?'active':'')+'">商品銷售</button><button data-action="sales-mode" data-mode="repair" class="'+(state.salesMode==='repair'?'active':'')+'">維修收入</button><button data-action="sales-mode" data-mode="other" class="'+(state.salesMode==='other'?'active':'')+'">其他收入</button></div>'+main+'<section class="ops-card ops-sales-total"><div class="ops-kpi-grid">'+kpi('商品銷售',money(productRevenue),'','＄')+kpi('維修收入',money(repairRevenue),'','修')+kpi('其他收入',money(otherRevenue),'','＋')+kpi('今日總計',money(productRevenue+repairRevenue+otherRevenue),'','合')+'</div></section>';
  }
  function posChoiceButtons(name,current,items){return '<div class="ops-choice-grid '+(items.length===2?'two':'')+'">'+items.map(function(item){return '<button type="button" class="'+(item.value===current?'active':'')+'" data-action="pos-choice" data-name="'+attr(name)+'" data-value="'+attr(item.value)+'">'+escapeHtml(item.label)+'</button>';}).join('')+'</div>';}


function posCustomerBarV5(){
  const c=selectedCustomer(),term=lower(state.posMemberSearch),members=state.customers.filter(function(x){return x.enabled&&x.customerType==='member'&&(!term||lower([x.name,x.phone,x.email,x.memberNo].join(' ')).includes(term));}).slice(0,12);
  let popover='';
  if(state.posCustomerMode==='member'&&state.posMemberPickerOpen){
    const resultHtml=term?(members.length?members.map(function(x){return '<button type="button" class="'+(x.id===state.selectedCustomerId?'active':'')+'" data-action="pos-member-select" data-id="'+attr(x.id)+'"><b>'+escapeHtml(x.name)+'</b><span>'+escapeHtml(x.phone||x.email||x.memberNo||'')+'</span><strong>'+formatNumber(x.pointBalance)+' 點</strong></button>';}).join(''):'<div class="ops-member-empty">找不到會員</div>'):'<div class="ops-member-empty">輸入姓名、電話、Email 或會員編號</div>';
    popover='<div class="ops-member-popover"><input class="ops-input" id="posMemberSearch" placeholder="搜尋會員" value="'+attr(state.posMemberSearch)+'"><div class="ops-member-results">'+resultHtml+'</div></div>';
  }
  return '<section class="ops-card ops-pos-customer-v5 ops-pos-customer-compact"><div class="ops-customer-mode-grid"><button type="button" class="'+(state.posCustomerMode==='walkin'?'active':'')+'" data-action="pos-customer-mode" data-mode="walkin">門市散客</button><button type="button" class="'+(state.posCustomerMode==='member'?'active':'')+'" data-action="pos-customer-mode" data-mode="member">'+(c&&state.posCustomerMode==='member'?escapeHtml(c.name):'選擇會員')+'</button><button type="button" data-action="pos-customer-new">新增會員</button></div>'+popover+'</section>';
}

  function renderInlineCheckout(){
    if(!state.cart.length)return '';
    const preorder=state.checkoutOrderType==='preorder',subtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;}),c=selectedCustomer(),walkin=!c||state.posCustomerMode==='walkin',settings=membershipRuleForDate(new Date());
    let manualDiscount=Math.max(0,Number(state.checkoutDiscount||0)),maxPoints=(preorder||walkin)?0:maxRedeemablePoints(c,Math.max(0,subtotal-manualDiscount));
    if(!preorder&&!walkin&&settings.redemptionMode==='auto'&&!state.checkoutPointsTouched)state.checkoutPoints=maxPoints;
    if(preorder){state.checkoutPoints=0;state.checkoutPointsTouched=true;}
    let points=Math.min(maxPoints,Math.max(0,Math.floor(Number(state.checkoutPoints||0)))),pointValue=pointDiscount(points);
    if(!preorder&&clean(state.checkoutActualCash)!==''){
      const actualCash=Math.max(0,Number(state.checkoutActualCash||0));
      manualDiscount=Math.max(0,subtotal-pointValue-actualCash);
      state.checkoutDiscount=manualDiscount;
      maxPoints=walkin?0:maxRedeemablePoints(c,Math.max(0,subtotal-manualDiscount));
      points=Math.min(maxPoints,points);
      pointValue=pointDiscount(points);
      manualDiscount=Math.max(0,subtotal-pointValue-actualCash);
      state.checkoutDiscount=manualDiscount;
    }
    const total=Math.max(0,subtotal-manualDiscount-pointValue),status=preorder?'partial':walkin?'paid':state.checkoutPaymentStatus,member=!!(c&&c.customerType==='member'),earnEnabled=member&&state.checkoutEarnPoints!==false;
    const prepared=state.cart.map(function(item){const p=catalogById(item.productId);return {qty:item.qty,unitPrice:item.unitPrice,raw:p&&p.internal?p.internal:{}};}),earned=earnEnabled?calculatePreparedRewardPoints(prepared,total,subtotal,new Date()):0,remaining=Math.max(0,Number(c&&c.pointBalance||0)-points);
    state.checkoutPoints=points;if(walkin&&!preorder){state.checkoutPaymentStatus='paid';state.checkoutReceived='';state.checkoutPointsTouched=false;state.checkoutEarnPoints=true;}
    const memberSummary=member?'<div class="ops-member-payment-summary"><div><span>會員</span><b>'+escapeHtml(c.name)+' '+escapeHtml(c.memberNo||'')+'</b></div><div><span>可用點數</span><b>'+formatNumber(c.pointBalance)+' 點</b></div><div><span>本次折抵</span><b id="inlinePointDiscount">'+formatNumber(points)+' 點／'+money(pointValue)+'</b></div><div><span>折抵後剩餘</span><b id="inlinePointRemaining">'+formatNumber(remaining)+' 點</b></div><div><span>'+(preorder?'交貨結清後累積':'本次累積')+'</span><b id="inlinePointsEarned">'+(earnEnabled?formatNumber(earned)+' 點':'不累積')+'</b></div></div><input type="hidden" name="earnPointsEnabled" value="'+(earnEnabled?'true':'false')+'"><div class="ops-checkout-block"><label>本次點數</label>'+posChoiceButtons('earnPointsEnabled',earnEnabled?'earn':'none',[{value:'earn',label:'累積點數'},{value:'none',label:'不累積點數'}])+'</div>':'<input type="hidden" name="earnPointsEnabled" value="false">';
    const orderTypeBlock='<div class="ops-checkout-block"><label>交易方式</label>'+posChoiceButtons('orderType',preorder?'preorder':'sale',[{value:'sale',label:'現貨銷售'},{value:'preorder',label:'預購／收訂金'}])+'</div>';
    const paymentBlock=preorder?'<input type="hidden" name="paymentStatus" value="partial"><div class="ops-callout green"><b>預購／訂金模式</b><br><span>先建立待交貨訂單，不扣庫存；商品入庫後再按「到貨交貨」轉成正式銷售。</span></div><div class="ops-field"><label>本次收到的訂金</label><input class="ops-input ops-number-clean" type="number" inputmode="decimal" min="0" max="'+total+'" step="1" name="receivedAmount" value="'+attr(state.checkoutReceived)+'" placeholder="可輸入 0"></div>':'<input type="hidden" name="paymentStatus" value="'+attr(status)+'"><div class="ops-checkout-block"><label>收款狀態</label>'+posChoiceButtons('paymentStatus',status,walkin?[{value:'paid',label:'已收清'}]:[{value:'paid',label:'已收清'},{value:'partial',label:'部分收款'},{value:'unpaid',label:'未收款'}])+'</div>'+(status==='partial'?'<div class="ops-field"><label>本次已收</label><input class="ops-input ops-number-clean" type="number" inputmode="decimal" min="0" step="1" name="receivedAmount" value="'+attr(state.checkoutReceived)+'"></div>':'');
    const pointField=member&&!preorder&&settings.redemptionMode!=='earn-only'?'<div class="ops-field"><label>點數折抵</label><input class="ops-input ops-number-clean" type="number" inputmode="numeric" min="0" max="'+maxPoints+'" step="'+Math.max(1,Math.floor(Number(settings.redeemPoints||1)))+'" name="pointsToRedeem" value="'+points+'"></div>':'<input type="hidden" name="pointsToRedeem" value="0">';
    const actualCashField=preorder?'':'<div class="ops-field"><label>實際收到的現金</label><input class="ops-input ops-number-clean" type="number" inputmode="decimal" min="0" max="'+Math.max(0,subtotal-pointValue)+'" step="1" name="actualCashReceived" value="'+attr(state.checkoutActualCash)+'" placeholder="輸入後自動計算折扣"></div>';
    return '<form id="checkoutFormInline" class="ops-inline-checkout"><h3>'+(preorder?'建立預購／訂金單':'結帳')+'</h3><input type="hidden" name="orderType" value="'+(preorder?'preorder':'sale')+'"><input type="hidden" name="customerId" value="'+attr(walkin?'':c.id)+'"><input type="hidden" name="paymentMethod" value="'+attr(state.checkoutPaymentMethod)+'">'+orderTypeBlock+(preorder&&walkin?'<div class="ops-callout"><b>請先選擇或新增會員</b><br><span>預購需要保留客戶資料，方便到貨後直接找到原訂單完成交貨。</span></div>':'')+memberSummary+'<div class="ops-checkout-block"><label>付款方式</label>'+posChoiceButtons('paymentMethod',state.checkoutPaymentMethod,[{value:'現金',label:'現金'},{value:'信用卡',label:'信用卡'},{value:'轉帳',label:'轉帳'}])+'</div>'+paymentBlock+'<div class="ops-checkout-fields">'+actualCashField+'<div class="ops-field"><label>額外折扣</label><input class="ops-input ops-number-clean" type="number" inputmode="decimal" min="0" step="1" name="discount" value="'+attr(state.checkoutDiscount)+'"></div>'+pointField+'</div><div class="ops-summary-list"><div class="ops-summary-line"><span>商品金額</span><b id="inlineProductSubtotal">'+money(subtotal)+'</b></div><div class="ops-summary-line"><span>折扣</span><b id="inlineDiscountTotal">'+money(manualDiscount+pointValue)+'</b></div><div class="ops-summary-line total"><span>'+(preorder?'訂單總額':'應收金額')+'</span><b id="inlineCheckoutTotal">'+money(total)+'</b></div></div><button class="ops-button primary wide" type="submit">'+(preorder?'確認建立預購單':'確認結帳')+'</button></form>';
  }
  function renderDirectIncomeV5(mode){
    const repair=mode==='repair',category=repair?'維修收入':'其他收入',c=selectedCustomer(),walkin=!c||state.posCustomerMode==='walkin',status=walkin?'paid':state.checkoutPaymentStatus;
    if(walkin)state.checkoutPaymentStatus='paid';
    return '<section class="ops-card ops-direct-income ops-v10-direct-income"><div class="ops-v8-section-head"><div><h2>'+category+'</h2><p>'+(repair?'填寫維修內容、金額與收款狀態。':'填寫收入項目、金額與收款狀態。')+'</p></div></div><form id="quickIncomeForm"><input type="hidden" name="occurredAt" value="'+inputDateTime(new Date())+'"><input type="hidden" name="customerId" value="'+attr(walkin?'':c.id)+'"><input type="hidden" name="category" value="'+attr(category)+'"><input type="hidden" name="paymentMethod" value="'+attr(state.checkoutPaymentMethod)+'"><input type="hidden" name="paymentStatus" value="'+attr(status)+'"><div class="ops-form-grid"><div class="ops-field full"><label class="ops-required">'+(repair?'維修項目':'收入項目')+'</label><input class="ops-input" name="itemName" placeholder="'+(repair?'例如：吉他換弦、導線維修':'例如：搬運費、場地費、其他收入內容')+'" required></div><div class="ops-field full"><label class="ops-required">金額</label><input class="ops-input ops-number-clean" type="number" inputmode="decimal" min="0" step="1" name="amount" value="'+attr(state.directIncomeAmount)+'" required></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note" placeholder="可補充客戶需求、處理內容或其他說明"></textarea></div></div><div class="ops-checkout-block"><label>付款方式</label>'+posChoiceButtons('paymentMethod',state.checkoutPaymentMethod,[{value:'現金',label:'現金'},{value:'信用卡',label:'信用卡'},{value:'轉帳',label:'轉帳'}])+'</div><div class="ops-checkout-block"><label>收款狀態</label>'+posChoiceButtons('paymentStatus',status,walkin?[{value:'paid',label:'已收清'}]:[{value:'paid',label:'已收清'},{value:'partial',label:'部分收款'},{value:'unpaid',label:'未收款'}])+'</div>'+(status==='partial'?'<div class="ops-field"><label>本次已收</label><input class="ops-input ops-number-clean" type="number" inputmode="decimal" min="0" step="1" name="receivedAmount" value="'+attr(state.checkoutReceived)+'"></div>':'')+'<button class="ops-button primary wide" type="submit">確認</button></form></section>';
  }

function renderTodayInvoices(){
  const term=lower(state.saleInvoiceSearch).trim(),from=state.saleInvoiceFrom?new Date(state.saleInvoiceFrom+'T00:00:00'):null,to=state.saleInvoiceTo?new Date(state.saleInvoiceTo+'T23:59:59'):null;
  const rows=state.sales.filter(function(x){
    const soldAt=dateFrom(x.soldAt),customer=state.customers.find(function(row){return row.id===x.customerId;});
    if(from&&(!soldAt||soldAt<from))return false;
    if(to&&(!soldAt||soldAt>to))return false;
    return !term||lower([x.saleNo,x.customerName,x.paymentMethod,customer&&customer.phone].concat(x.items.map(function(i){return i.name+' '+i.sku;})).join(' ')).includes(term);
  }).sort(function(a,b){return (dateFrom(b.soldAt)||0)-(dateFrom(a.soldAt)||0);}).slice(0,120);
  return '<section class="ops-card ops-invoice-list ops-sales-history-simple"><div class="ops-card-head"><h2>銷售記錄</h2></div><div class="ops-history-toolbar"><input class="ops-input grow" id="saleInvoiceSearch" placeholder="搜尋單號、會員、電話或商品" value="'+attr(state.saleInvoiceSearch)+'"><label class="ops-inline-field"><span>開始日期</span><input class="ops-input" id="saleInvoiceFrom" type="date" value="'+attr(state.saleInvoiceFrom)+'"></label><label class="ops-inline-field"><span>結束日期</span><input class="ops-input" id="saleInvoiceTo" type="date" value="'+attr(state.saleInvoiceTo)+'"></label><button class="ops-button ghost" data-action="sale-history-reset-range">清除區間</button></div><div class="ops-invoice-rows">'+(rows.length?rows.map(function(x){return '<button type="button" data-action="sale-edit" data-id="'+attr(x.id)+'"><span>'+escapeHtml(dateText(x.soldAt))+'</span><b>'+escapeHtml(x.saleNo)+'</b><em>'+escapeHtml(x.customerName||'門市散客')+(x.returnStatus?'・已退貨':'')+'</em><strong>'+money(x.total)+'</strong><i>處理</i></button>';}).join(''):emptyHtml('找不到符合條件的銷售記錄','請調整搜尋文字或日期區間。'))+'</div></section>';
}


function renderSalesV5(){
  const products=state.catalog.filter(function(p){return p.initialized&&p.status!=='inactive';}),term=lower(state.posSearch).trim(),choices=term?products.filter(function(p){return matchesSearch([p.originalName,p.onlineName,p.sku,formatLabelSku(p.sku),p.barcode,p.brand,p.category],term);}).slice(0,30):[],cartSubtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;}),todaySales=todayRows(state.sales,function(x){return x.soldAt;}),todayIncome=todayRows(state.incomes,function(x){return x.occurredAt;}),repairIncome=todayIncome.filter(function(x){return x.category==='維修收入';}),otherIncome=todayIncome.filter(function(x){return x.category!=='維修收入';});
  let main='';
  if(state.salesMode==='product'){
    let productHtml='';
    if(choices.length)productHtml=choices.map(function(p){const image=p.imageUrl||'';return '<button class="ops-pos-item" data-action="cart-add" data-id="'+attr(p.docId)+'">'+(image?'<img loading="lazy" src="'+attr(image)+'" alt="" onerror="this.style.display=&quot;none&quot;">':'<div class="ops-pos-no-image">無圖</div>')+'<div><b>'+escapeHtml(p.originalName||p.name)+'</b><small>編號 '+escapeHtml(p.sku||'未設定')+'・庫存 '+formatNumber(p.currentStock)+'・'+money(p.storePrice)+'</small></div></button>';}).join('');
    else if(term)productHtml='<div class="ops-no-result">找不到商品</div>';
    const cartHtml=state.cart.length?state.cart.map(function(item,index){const p=catalogById(item.productId);return '<div class="ops-cart-row"><div><b>'+escapeHtml(item.name)+'</b><small>編號 '+escapeHtml(item.sku||'')+'・庫存 '+formatNumber(p?p.currentStock:item.currentStock)+'</small></div><input class="ops-number-clean" aria-label="數量" type="number" min="1" step="1" value="'+item.qty+'" data-cart-qty="'+index+'"><input class="ops-number-clean" aria-label="售價" type="number" min="0" step="1" value="'+item.unitPrice+'" data-cart-price="'+index+'"><button class="ops-icon-button" data-action="cart-remove" data-index="'+index+'">×</button></div>';}).join(''):'<div class="ops-empty"><strong>尚未選商品</strong></div>';
    main='<div class="ops-pos-layout"><section class="ops-card"><div class="ops-toolbar"><input class="ops-input grow ops-pos-search" id="posSearch" placeholder="商品編號／名稱" value="'+attr(state.posSearch)+'"><button class="ops-button ghost" data-action="pos-clear-search">清除</button></div><div class="ops-pos-products">'+productHtml+'</div></section><section class="ops-card"><div class="ops-card-head"><h2>要賣的商品</h2><button class="ops-button small ghost" data-action="cart-clear">清空</button></div><div class="ops-cart">'+cartHtml+'</div>'+(state.cart.length?'<div class="ops-summary-line total"><span>商品金額</span><b id="cartSubtotal">'+money(cartSubtotal)+'</b></div>':'')+renderInlineCheckout()+'</section></div>';
  }else main=renderDirectIncomeV5(state.salesMode);
  const productRevenue=sum(todaySales,function(x){return x.total;}),repairRevenue=sum(repairIncome,function(x){return x.amount;}),otherRevenue=sum(otherIncome,function(x){return x.amount;});
  return '<div class="ops-sales-simple">'+posCustomerBarV5()+'<section class="ops-sale-workspace ops-sales-main-simple"><div class="ops-sales-modes ops-sales-modes-simple"><button data-action="sales-mode" data-mode="product" class="'+(state.salesMode==='product'?'active':'')+'">商品銷售</button><button data-action="sales-mode" data-mode="repair" class="'+(state.salesMode==='repair'?'active':'')+'">維修收入</button><button data-action="sales-mode" data-mode="other" class="'+(state.salesMode==='other'?'active':'')+'">其他收入</button></div><div class="ops-sales-main-label"><h2>主要銷售區</h2><span class="ops-sales-clock" id="opsSalesClock">'+formatSalesClock(new Date())+'</span></div>'+main+'</section><section class="ops-card ops-sales-total ops-sales-total-simple"><div class="ops-kpi-grid">'+kpi('商品銷售',money(productRevenue),'','＄')+kpi('維修收入',money(repairRevenue),'','修')+kpi('其他收入',money(otherRevenue),'','＋')+kpi('今日總計',money(productRevenue+repairRevenue+otherRevenue),'','合')+'</div></section>'+renderTodayInvoices()+'</div>';
}

  function posNumberPadHtml(){return '<div class="ops-number-pad ops-pos-number-pad" aria-label="商品編號數字鍵盤">'+['1','2','3','4','5','6','7','8','9','clear','0','back'].map(function(key){const label=key==='clear'?'清除':key==='back'?'⌫':key;return '<button type="button" data-action="pos-key" data-key="'+key+'">'+label+'</button>';}).join('')+'</div>';}
  function renderSalesV6(){return renderSalesV5().replace('<div class="ops-pos-products">',posNumberPadHtml()+'<div class="ops-pos-products">');}

  function renderSalesHistoryV7(){
    const term=lower(state.saleInvoiceSearch).trim(),from=state.saleInvoiceFrom?new Date(state.saleInvoiceFrom+'T00:00:00'):null,to=state.saleInvoiceTo?new Date(state.saleInvoiceTo+'T23:59:59'):null,entries=[];
    state.sales.forEach(function(sale){const waiting=sale.saleType==='preorder'&&sale.fulfillmentStatus!=='delivered';entries.push({kind:'sale',date:waiting?(sale.preorderAt||sale.soldAt):sale.soldAt,row:sale});});
    state.incomes.forEach(function(income){entries.push({kind:'income',date:income.occurredAt,row:income});});
    const rows=entries.filter(function(entry){
      const date=dateFrom(entry.date),row=entry.row,customer=state.customers.find(function(item){return item.id===row.customerId;});
      if(from&&(!date||date<from))return false;
      if(to&&(!date||date>to))return false;
      const search=entry.kind==='income'?[row.incomeNo,row.category,row.itemName,row.customerName,row.paymentMethod,row.note,customer&&customer.phone]:[row.saleNo,row.customerName,row.paymentMethod,row.saleType,row.fulfillmentStatus,row.usageReason,row.usageNote,customer&&customer.phone,customer&&customer.email].concat((row.items||[]).map(function(item){return item.name+' '+item.sku;}));
      return !term||lower(search.join(' ')).includes(term);
    }).sort(function(a,b){return (dateFrom(b.date)||0)-(dateFrom(a.date)||0);});
    const visible=rows.slice(0,160);
    const todayKey=dateText(new Date()),monthStart=todayKey.slice(0,8)+'01',rangeMode=!state.saleInvoiceFrom&&!state.saleInvoiceTo?'all':state.saleInvoiceFrom===todayKey&&state.saleInvoiceTo===todayKey?'today':state.saleInvoiceFrom===monthStart&&state.saleInvoiceTo===todayKey?'month':state.saleInvoiceFrom&&state.saleInvoiceFrom===state.saleInvoiceTo?'day':'custom';
    const quick='<div class="ops-sales-history-quick"><span>快速日期</span><button class="'+(rangeMode==='today'?'active':'')+'" data-action="sale-history-range" data-mode="today">今天</button><button data-action="sale-history-range" data-mode="prev">← 前一天</button><button data-action="sale-history-range" data-mode="next">後一天 →</button><button class="'+(rangeMode==='month'?'active':'')+'" data-action="sale-history-range" data-mode="month">本月</button><button class="'+(rangeMode==='all'?'active':'')+'" data-action="sale-history-range" data-mode="all">全部</button><button class="'+(rangeMode==='custom'?'active':'')+'" data-action="sale-history-range" data-mode="custom">自訂區間</button></div>';
    const toolbar='<div class="ops-v8-sales-history-tools">'+quick+'<div class="ops-sales-history-fields"><input class="ops-input grow" id="saleInvoiceSearch" placeholder="搜尋單號、項目、用途、電話或商品" value="'+attr(state.saleInvoiceSearch)+'"><label><span>開始日期</span><input class="ops-input" id="saleInvoiceFrom" type="date" value="'+attr(state.saleInvoiceFrom)+'"></label><label><span>結束日期</span><input class="ops-input" id="saleInvoiceTo" type="date" value="'+attr(state.saleInvoiceTo)+'"></label><button class="ops-button small ghost" data-action="sale-history-reset-range">清除區間</button></div></div>';
    const rowHtml=visible.length?visible.map(function(entry){
      if(entry.kind==='income'){
        const income=entry.row,paymentStatus=clean(income.paymentStatus)||'paid',status=paymentStatus==='paid'?'已收清':paymentStatus==='partial'?'部分收款':'未收款',type=income.category==='維修收入'?'維修收入':'其他收入',content=income.itemName||income.note||type;
        return '<tr><td>'+escapeHtml(dateTimeText(income.occurredAt))+'</td><td><b>'+escapeHtml(type)+'</b><br><small>'+escapeHtml(income.incomeNo||income.id)+'</small></td><td>'+escapeHtml(income.customerName||'門市散客')+'</td><td>'+escapeHtml(content)+'</td><td>'+statusTag(status,paymentStatus==='paid'?'green':'yellow')+'</td><td class="num"><b>'+money(income.amount)+'</b></td><td class="num">'+money(0)+'</td><td class="num"><b>'+money(income.amount)+'</b></td><td><button class="ops-button small ghost" data-action="income-edit" data-id="'+attr(income.id)+'">修改</button></td></tr>';
      }
      const sale=entry.row,internalUse=sale.saleType==='internalUse',waiting=sale.saleType==='preorder'&&sale.fulfillmentStatus!=='delivered',deliveredPreorder=sale.saleType==='preorder'&&!waiting,items=(sale.items||[]),paymentStatus=clean(sale.paymentStatus)||'paid',status=waiting?'等待到貨':internalUse?'已扣庫存':paymentStatus==='paid'?'已收清':paymentStatus==='partial'?'部分收款':'未收款',ownerText=internalUse?(sale.usageReason||'內部耗用／報廢'):(sale.customerName||'門市散客'),type=waiting?'預購／訂金':deliveredPreorder?'預購交貨':internalUse?'內部耗用／報廢':'商品銷售',orderTotal=Number(sale.orderTotal||sale.total||0),outstanding=Math.max(0,orderTotal-Number(sale.receivedAmount||0)),saleAmount=waiting?orderTotal:Number(sale.total||0),saleCost=waiting?0:Number(sale.costTotal||0),saleProfit=waiting?null:(numberOrNull(sale.grossProfit)==null?saleAmount-saleCost:Number(sale.grossProfit)),itemDetails=items.length?items.map(function(item){const qty=Math.max(1,Number(item.qty||1)),lineAmount=Number(item.lineTotal==null?qty*Number(item.unitPrice||0):item.lineTotal),lineCost=Number(item.lineCost||0),name=clean(item.name)||clean(item.sku)||'商品';return '<div class="ops-sales-item-analysis"><b>'+escapeHtml(name)+'</b><small>'+escapeHtml(item.sku||'未設定編號')+' × '+formatNumber(qty)+'｜小計 '+money(lineAmount)+'｜'+(waiting?'成本於交貨時計算':'成本 '+money(lineCost))+'</small></div>';}).join(''):'—',amountHtml=waiting?'<b>'+money(orderTotal)+'</b><br><small>已收 '+money(sale.receivedAmount)+'／尾款 '+money(outstanding)+'</small>':'<b>'+money(saleAmount)+'</b>';
      return '<tr><td>'+escapeHtml(dateTimeText(entry.date))+'</td><td><b>'+escapeHtml(type)+'</b><br><small>'+escapeHtml(sale.saleNo||sale.id)+'</small></td><td>'+escapeHtml(ownerText)+'</td><td>'+itemDetails+(sale.returnStatus?'<div class="ops-sales-return-note">已退回／處理中</div>':'')+'</td><td>'+statusTag(status,waiting?'yellow':internalUse?'yellow':paymentStatus==='paid'?'green':'yellow')+'</td><td class="num">'+amountHtml+'</td><td class="num">'+(waiting?'—':money(saleCost))+'</td><td class="num">'+(waiting?'—':'<b>'+money(saleProfit)+'</b>')+'</td><td>'+(waiting?'<button class="ops-button small primary" data-action="preorder-fulfill" data-id="'+attr(sale.id)+'">到貨交貨</button>':'<button class="ops-button small ghost" data-action="sale-edit" data-id="'+attr(sale.id)+'">修改</button>')+'</td></tr>';
    }).join(''):'';
    const table=rowHtml?'<div class="ops-table-wrap"><table class="ops-table ops-v8-sales-history-table"><thead><tr><th>時間</th><th>類型／單號</th><th>客戶／用途</th><th>商品與成本明細</th><th>收款／狀態</th><th class="num">金額</th><th class="num">成本</th><th class="num">毛利</th><th></th></tr></thead><tbody>'+rowHtml+'</tbody></table></div>':emptyHtml('找不到符合條件的紀錄','請調整搜尋文字或日期區間。');
    return '<section class="ops-card ops-v8-sales-history"><div class="ops-v8-section-head"><div><h2>最近銷售、預購、收入與耗用紀錄</h2></div></div>'+toolbar+table+'</section>';
  }

  function renderStockUsageForm(){
    if(!state.cart.length)return '';
    const reason=state.stockUsageReason||'店內自用',recordedAmount=sum(state.cart,function(item){return Math.max(1,Number(item.qty||1))*Math.max(0,Number(item.unitPrice||0));}),estimatedCost=estimateCartCost(),estimatedResult=recordedAmount-estimatedCost,reasonOptions=['店內自用','消耗品','報廢','其他'];
    const reasonButtons=reasonOptions.map(function(value){return '<button type="button" class="'+(reason===value?'active':'')+'" data-action="stock-usage-reason" data-value="'+attr(value)+'">'+escapeHtml(value)+'</button>';}).join('');
    return '<form id="stockUsageForm" class="ops-inline-checkout ops-stock-usage-form"><h3>內部耗用／報廢</h3><div class="ops-callout"><b>記錄金額預設為 0 元，但可以修改。</b><br>無論金額多少，都會依數量扣除中央庫存，並在下一次同步時更新到各平台。</div><div class="ops-checkout-block"><label>處理原因</label><div class="ops-choice-grid ops-stock-usage-reasons">'+reasonButtons+'</div><input type="hidden" name="usageReason" value="'+attr(reason)+'"></div><div class="ops-field"><label>備註</label><textarea class="ops-textarea" id="stockUsageNote" name="usageNote" placeholder="例如：門市展示使用、包裝耗材、損壞報廢">'+escapeHtml(state.stockUsageNote)+'</textarea></div><div class="ops-summary-list"><div class="ops-summary-line"><span>記錄金額</span><b id="stockUsageAmount">'+money(recordedAmount)+'</b></div><div class="ops-summary-line"><span>預估庫存成本</span><b>'+money(estimatedCost)+'</b></div><div class="ops-summary-line total"><span>預估損益</span><b id="stockUsageResult">'+money(estimatedResult)+'</b></div></div><button class="ops-button primary wide" type="submit">確認扣除庫存</button></form>';
  }

  function renderSalesV7(){
    const products=state.catalog.filter(function(product){return product.initialized&&product.status!=='inactive';}),term=lower(state.posSearch).trim(),choices=term?products.filter(function(product){return matchesSearch([product.originalName,product.onlineName,product.sku,formatLabelSku(product.sku),product.barcode,product.brand,product.category],term);}).slice(0,30):[],usageMode=state.salesMode==='usage',cartSubtotal=sum(state.cart,function(item){return item.qty*item.unitPrice;}),todaySales=todayRows(state.sales,function(sale){return sale.soldAt;}),regularSales=todaySales.filter(function(sale){return sale.saleType!=='internalUse'&&!(sale.saleType==='preorder'&&sale.fulfillmentStatus!=='delivered');}),usageSales=todaySales.filter(function(sale){return sale.saleType==='internalUse';}),todayIncome=todayRows(state.incomes,function(income){return income.occurredAt;}),repairIncome=todayIncome.filter(function(income){return income.category==='維修收入';}),otherIncome=todayIncome.filter(function(income){return income.category!=='維修收入';});
    let main='';
    if(state.salesMode==='product'||usageMode){
      let productHtml='';
      if(choices.length)productHtml=choices.map(function(product){const image=product.imageUrl||'';return '<button class="ops-pos-item ops-v8-pos-item" data-action="cart-add" data-id="'+attr(product.docId)+'">'+(image?'<img loading="lazy" src="'+attr(image)+'" alt="" onerror="this.style.display=&quot;none&quot;">':'<div class="ops-pos-no-image">無圖</div>')+'<div><b>'+escapeHtml(product.originalName||product.name)+'</b><small>編號 '+escapeHtml(product.sku||'未設定')+'・庫存 '+formatNumber(product.currentStock)+'</small></div><strong>'+(usageMode?'加入':money(product.storePrice))+'</strong></button>';}).join('');
      else if(term)productHtml='<div class="ops-no-result">找不到商品</div>';
      else productHtml='<div class="ops-v8-sales-search-empty"><b>輸入商品編號或名稱</b><span>'+(usageMode?'選取要自用、消耗或報廢的商品。':'也可以使用左側數字鍵盤快速輸入 SKU。')+'</span></div>';
      const cartHtml=state.cart.length?state.cart.map(function(item,index){const product=catalogById(item.productId),lineTotal=Math.max(1,Number(item.qty||1))*Math.max(0,Number(item.unitPrice||0));return '<div class="ops-cart-row"><div><b>'+escapeHtml(item.name)+'</b><small>編號 '+escapeHtml(item.sku||'')+'・庫存 '+formatNumber(product?product.currentStock:item.currentStock)+'</small></div><input class="ops-quantity-spinner" aria-label="數量" title="使用上下箭頭調整數量" type="number" inputmode="numeric" min="1" step="1" value="'+item.qty+'" data-cart-qty="'+index+'">'+'<input class="ops-cart-line-total" aria-label="商品小計" title="數量乘以單價後的商品小計" type="number" value="'+lineTotal+'" data-cart-line-total="'+index+'" readonly>'+'<button class="ops-icon-button" data-action="cart-remove" data-index="'+index+'">×</button></div>';}).join(''):'<div class="ops-v8-cart-empty"><b>尚未選商品</b><span>從左側搜尋結果點選商品後，會加入本次'+(usageMode?'耗用／報廢':'銷售')+'。</span></div>';
      main='<div class="ops-v8-sales-workspace"><section class="ops-card ops-v8-sales-search-card"><div class="ops-v8-section-head"><div><h2>商品搜尋</h2><p>輸入商品編號或名稱，再點選結果加入'+(usageMode?'耗用清單':'銷售')+'</p></div><span class="ops-tag '+(usageMode?'yellow':'green')+'">'+(usageMode?'扣庫存':'主要操作')+'</span></div><div class="ops-toolbar ops-v8-sales-searchbar"><input class="ops-input grow ops-pos-search" id="posSearch" placeholder="商品編號／名稱" value="'+attr(state.posSearch)+'"><button class="ops-button ghost" data-action="pos-clear-search">清除</button></div><div class="ops-v8-sales-search-grid">'+posNumberPadHtml()+'<div class="ops-pos-products">'+productHtml+'</div></div></section><section class="ops-card ops-v8-sales-cart-card"><div class="ops-v8-section-head"><div><h2>'+(usageMode?'本次內部耗用／報廢':'本次銷售')+'</h2><p>'+(usageMode?'記錄金額預設 0 元，可自行修改；商品仍會正常扣庫存':'商品、價格與收款集中在同一區')+'</p></div><button class="ops-button small ghost" data-action="cart-clear">清空</button></div><div class="ops-cart">'+cartHtml+'</div>'+(state.cart.length?'<div class="ops-summary-line total ops-v8-cart-subtotal"><span>'+(usageMode?'帳面收入':'商品金額')+'</span><b id="cartSubtotal">'+money(cartSubtotal)+'</b></div>':'')+(usageMode?renderStockUsageForm():renderInlineCheckout())+'</section></div>';
    }else{
      main='<div class="ops-v8-sales-income-mode">'+renderDirectIncomeV5(state.salesMode)+'</div>';
    }
    const productRevenue=sum(regularSales,function(sale){return sale.total;}),usageRevenue=sum(usageSales,function(sale){return sale.total;}),usageCost=sum(usageSales,function(sale){return sale.costTotal;}),repairRevenue=sum(repairIncome,function(income){return income.amount;}),otherRevenue=sum(otherIncome,function(income){return income.amount;}),totalRevenue=productRevenue+usageRevenue+repairRevenue+otherRevenue;
    const customerBlock='<div class="ops-v10-sales-customer-block"><span class="ops-v10-sales-label">選擇客戶</span>'+posCustomerBarV5()+(usageMode?'<small class="ops-v10-usage-note">內部耗用／報廢不會連結客戶，也不會累積會員點數。</small>':'')+'</div>';
    const modes='<div class="ops-v10-sales-type-block"><span class="ops-v10-sales-label">選擇交易類型</span><div class="ops-sales-modes ops-v8-sales-modes"><button data-action="sales-mode" data-mode="product" class="'+(state.salesMode==='product'?'active':'')+'">商品銷售</button><button data-action="sales-mode" data-mode="repair" class="'+(state.salesMode==='repair'?'active':'')+'">維修收入</button><button data-action="sales-mode" data-mode="other" class="'+(state.salesMode==='other'?'active':'')+'">其他收入</button><button data-action="sales-mode" data-mode="usage" class="'+(usageMode?'active':'')+'">內部耗用／報廢</button></div></div>';
    const salesTop='<div class="ops-v10-sales-top"><div class="ops-v10-sales-top-grid">'+customerBlock+modes+'</div></div>';
    const totals='<section class="ops-v8-sales-totals"><div class="ops-kpi-grid">'+kpi('今日商品銷售',money(productRevenue),regularSales.length+' 筆','＄')+kpi('維修收入',money(repairRevenue),repairIncome.length+' 筆','修')+kpi('其他收入',money(otherRevenue),otherIncome.length+' 筆','＋')+kpi('內部耗用／報廢',money(usageRevenue),usageSales.length+' 筆／成本 '+money(usageCost),'耗')+kpi('今日總收入',money(totalRevenue),'含有填寫金額的內部耗用','合')+'</div></section>';
    return '<div class="ops-v8-sales-page"><section class="ops-v10-sales-zone">'+salesTop+'<div class="ops-v10-sales-body">'+main+totals+'</div></section>'+renderSalesHistoryV7()+'</div>';
  }
  function renderCustomersV4(){
    const term=lower(state.customerSearch),rows=state.customers.filter(function(x){return !term||lower([x.name,x.phone,x.email,x.memberNo,x.customerType].join(' ')).includes(term);}).sort(function(a,b){return a.name.localeCompare(b.name,'zh-Hant');}),table=rows.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>客戶</th><th>身分</th><th>電話</th><th class="num">點數</th><th class="num">購買</th><th class="num">未收款</th><th></th></tr></thead><tbody>'+rows.map(function(x){const sales=state.sales.filter(function(s){return s.customerId===x.id;}),incomes=state.incomes.filter(function(i){return i.customerId===x.id;}),due=sum(state.receivables.filter(function(r){return r.customerId===x.id&&r.status!=='paid';}),function(r){return r.outstandingAmount;});return '<tr><td><b>'+escapeHtml(x.name)+'</b><br><small>'+escapeHtml(x.memberNo||'—')+'</small></td><td>'+statusTag(customerTypeName(x.customerType),x.customerType==='teacher'?'yellow':'green')+'</td><td>'+escapeHtml(x.phone||'—')+'</td><td class="num">'+formatNumber(x.pointBalance)+'</td><td class="num">'+formatNumber(sales.length+incomes.length)+'</td><td class="num">'+money(due)+'</td><td><div class="ops-card-actions"><button class="ops-button small ghost" data-action="customer-history" data-id="'+attr(x.id)+'">紀錄</button><button class="ops-button small ghost" data-action="customer-edit" data-id="'+attr(x.id)+'">編輯</button></div></td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('尚無客戶','','<button class="ops-button primary" data-action="customer-new">新增客戶</button>');
    return '<div class="ops-kpi-grid">'+kpi('客戶',formatNumber(state.customers.length),'','人')+kpi('會員',formatNumber(state.customers.filter(function(x){return x.customerType==='member';}).length),'','點')+kpi('老師',formatNumber(state.customers.filter(function(x){return x.customerType==='teacher';}).length),'','師')+kpi('未收款',money(sum(state.receivables,function(x){return x.outstandingAmount;})),'','帳')+'</div><section class="ops-card"><div class="ops-card-head"><h2>客戶會員</h2><div class="ops-card-actions"><button class="ops-button ghost" data-action="membership-settings">點數設定</button><button class="ops-button primary" data-action="customer-new">新增客戶</button></div></div><div class="ops-toolbar"><input class="ops-input grow" id="customerSearch" placeholder="姓名／電話／Email／會員編號" value="'+attr(state.customerSearch)+'"></div>'+table+'</section>';
  }
  function renderCustomersV6(){const rule=membershipRuleForDate(new Date()),year=rule.year||new Date().getFullYear();return renderCustomersV4().replace('>點數設定</button>','>'+year+' 點數 '+formatNumber(rule.rewardPercent)+'%</button>');}
  function openCustomerV4(id,returnToSales,defaultType){
    const row=id?state.customers.find(function(x){return x.id===id;}):null,c=row||{id:'',name:'',phone:'',email:'',customerType:defaultType||'general',memberNo:'',pricingTier:'retail',creditLimit:0,note:''};
    openDrawer(row?'編輯客戶':'新增客戶','姓名、電話、Email、會員編號任一項有填即可儲存。', '<form id="customerFormV4" data-id="'+attr(c.id)+'" data-return-sales="'+(returnToSales?'1':'0')+'"><div class="ops-form-grid"><div class="ops-field"><label>姓名／名稱</label><input class="ops-input" name="name" value="'+attr(c.name)+'"></div><div class="ops-field"><label>聯絡電話</label><input class="ops-input" name="phone" value="'+attr(c.phone)+'" placeholder="手機、市話或其他聯絡號碼皆可"></div><div class="ops-field"><label>Email</label><input class="ops-input" type="text" inputmode="email" name="email" value="'+attr(c.email)+'"></div><div class="ops-field"><label>客戶身分</label><select class="ops-select" name="customerType"><option value="general">一般客戶</option><option value="member">會員</option><option value="teacher">老師</option><option value="organization">機構</option></select></div><div class="ops-field"><label>會員編號</label><input class="ops-input" name="memberNo" value="'+attr(c.memberNo)+'"></div><div class="ops-field"><label>價格</label><select class="ops-select" name="pricingTier"><option value="retail">一般售價</option><option value="teacher">老師價</option><option value="custom">自訂價格</option></select></div><div class="ops-field"><label>信用額度</label><input class="ops-input" type="number" min="0" step="1" name="creditLimit" value="'+c.creditLimit+'"></div><div class="ops-field"><label>目前點數</label><input class="ops-input" value="'+formatNumber(c.pointBalance||0)+'" readonly></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note">'+escapeHtml(c.note)+'</textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存</button></div></form>');
    const phoneInput=query('#customerFormV4 [name="phone"]');if(phoneInput)phoneInput.inputMode='tel';
    query('#customerFormV4 [name="customerType"]').value=c.customerType;query('#customerFormV4 [name="pricingTier"]').value=c.pricingTier;
  }
  async function saveCustomerV4(form){
    const id=clean(form.dataset.id),data=new FormData(form),type=clean(data.get('customerType')),name=clean(data.get('name')),phone=clean(data.get('phone')),email=clean(data.get('email')),enteredMemberNo=clean(data.get('memberNo'));if(!name&&!phone&&!email&&!enteredMemberNo)throw new Error('姓名、電話、Email 或會員編號至少填寫一項');const memberNo=enteredMemberNo||(type==='member'?uid('MEM'):''),displayLabel=name||phone||email||memberNo,payload={name:name,phone:phone,email:email,customerType:type,memberNo:memberNo,pricingTier:clean(data.get('pricingTier')),creditLimit:numberOrNull(data.get('creditLimit'))||0,note:clean(data.get('note')),enabled:true,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};let ref;if(id){ref=state.db.collection(COLLECTIONS.customers).doc(id);await ref.set(payload,{merge:true});}else{payload.pointBalance=0;payload.createdAt=serverTimestamp();payload.createdBy=userLabel();ref=await state.db.collection(COLLECTIONS.customers).add(payload);}if(form.dataset.returnSales==='1'){state.selectedCustomerId=ref.id;state.posCustomerMode='member';state.posMemberSearch=phone||name||email||memberNo;state.posMemberPickerOpen=false;state.checkoutPoints=0;state.checkoutPointsTouched=false;state.checkoutEarnPoints=true;}await writeAudit(id?'更新客戶':'新增客戶','customer',ref.id,displayLabel);closeDrawer();toast('客戶已儲存',displayLabel,'success');await loadAll(true);
  }
  function openCustomerHistory(id){
    const c=state.customers.find(function(x){return x.id===id;});if(!c)return;const sales=state.sales.filter(function(x){return x.customerId===id;}).sort(function(a,b){return (dateFrom(b.soldAt)||0)-(dateFrom(a.soldAt)||0);}),incomes=state.incomes.filter(function(x){return x.customerId===id;}).sort(function(a,b){return (dateFrom(b.occurredAt)||0)-(dateFrom(a.occurredAt)||0);}),points=state.pointTransactions.filter(function(x){return x.customerId===id;}).sort(function(a,b){return (dateFrom(b.createdAt)||0)-(dateFrom(a.createdAt)||0);}),dues=state.receivables.filter(function(x){return x.customerId===id&&x.status!=='paid';}),rows=[];
    sales.forEach(function(x){rows.push({date:x.soldAt,no:x.saleNo,items:x.items.map(function(i){return i.name+' × '+i.qty;}).join('、'),amount:x.total});});incomes.forEach(function(x){rows.push({date:x.occurredAt,no:x.incomeNo,items:x.category,amount:x.amount});});rows.sort(function(a,b){return (dateFrom(b.date)||0)-(dateFrom(a.date)||0);});
    const history=rows.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>日期</th><th>編號</th><th>內容</th><th class="num">金額</th></tr></thead><tbody>'+rows.map(function(x){return '<tr><td>'+escapeHtml(dateText(x.date))+'</td><td>'+escapeHtml(x.no)+'</td><td>'+escapeHtml(x.items)+'</td><td class="num">'+money(x.amount)+'</td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('尚無消費紀錄','');
    const pointRows=points.length?points.slice(0,30).map(function(x){return '<div class="ops-summary-line"><span>'+escapeHtml(dateText(x.createdAt))+' '+escapeHtml(x.note||x.type)+'</span><b>'+(x.points>0?'+':'')+formatNumber(x.points)+'</b></div>';}).join(''):'<div class="ops-empty">尚無點數紀錄</div>';
    openDrawer(c.name,'','<div class="ops-customer-stats"><div><span>點數</span><b>'+formatNumber(c.pointBalance)+'</b></div><div><span>消費</span><b>'+money(sum(rows,function(x){return x.amount;}))+'</b></div><div><span>未收款</span><b>'+money(sum(dues,function(x){return x.outstandingAmount;}))+'</b></div></div><div class="ops-card-actions" style="justify-content:flex-start;margin:14px 0"><button class="ops-button ghost" data-action="point-adjust" data-id="'+attr(c.id)+'">調整點數</button><button class="ops-button ghost" data-action="customer-edit" data-id="'+attr(c.id)+'">編輯客戶</button></div><details class="ops-history-block" open><summary>消費紀錄</summary>'+history+'</details><details class="ops-history-block"><summary>點數紀錄</summary><div class="ops-summary-list">'+pointRows+'</div></details>');
  }
  function openMembershipSettings(){
    const s=state.membershipSettings||DEFAULT_MEMBERSHIP_SETTINGS;openDrawer('點數設定','', '<form id="membershipSettingsForm"><div class="ops-form-grid"><div class="ops-field full"><label>啟用點數</label><select class="ops-select" name="enabled"><option value="true">啟用</option><option value="false">停用</option></select></div><div class="ops-field"><label>消費金額</label><input class="ops-input" type="number" min="1" step="1" name="earnAmount" value="'+Number(s.earnAmount||100)+'"></div><div class="ops-field"><label>獲得點數</label><input class="ops-input" type="number" min="0" step="1" name="earnPoints" value="'+Number(s.earnPoints||1)+'"></div><div class="ops-field"><label>使用點數</label><input class="ops-input" type="number" min="1" step="1" name="redeemPoints" value="'+Number(s.redeemPoints||1)+'"></div><div class="ops-field"><label>折抵金額</label><input class="ops-input" type="number" min="0" step="1" name="redeemAmount" value="'+Number(s.redeemAmount||1)+'"></div><div class="ops-field"><label>最低使用點數</label><input class="ops-input" type="number" min="1" step="1" name="minRedeemPoints" value="'+Number(s.minRedeemPoints||1)+'"></div><div class="ops-field"><label>單筆最高折抵％</label><input class="ops-input" type="number" min="0" max="100" step="1" name="maxRedeemPercent" value="'+Number(s.maxRedeemPercent||20)+'"></div><div class="ops-field"><label>開始日期</label><input class="ops-input" type="date" name="validFrom" value="'+attr(s.validFrom||'')+'"></div><div class="ops-field"><label>結束日期</label><input class="ops-input" type="date" name="validTo" value="'+attr(s.validTo||'')+'"></div><div class="ops-field full"><label>結帳折抵</label><select class="ops-select" name="redemptionMode"><option value="ask">結帳時選擇</option><option value="auto">自動使用最多點數</option><option value="earn-only">只累積點數</option></select></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存</button></div></form>');query('#membershipSettingsForm [name="enabled"]').value=s.enabled===false?'false':'true';query('#membershipSettingsForm [name="redemptionMode"]').value=s.redemptionMode||'ask';
  }
  async function saveMembershipSettings(form){const data=new FormData(form),payload={enabled:data.get('enabled')==='true',earnAmount:Math.max(1,Number(data.get('earnAmount')||100)),earnPoints:Math.max(0,Math.floor(Number(data.get('earnPoints')||0))),redeemPoints:Math.max(1,Math.floor(Number(data.get('redeemPoints')||1))),redeemAmount:Math.max(0,Number(data.get('redeemAmount')||0)),minRedeemPoints:Math.max(1,Math.floor(Number(data.get('minRedeemPoints')||1))),maxRedeemPercent:Math.max(0,Math.min(100,Number(data.get('maxRedeemPercent')||0))),validFrom:clean(data.get('validFrom')),validTo:clean(data.get('validTo')),redemptionMode:clean(data.get('redemptionMode'))||'ask',updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};if(payload.validFrom&&payload.validTo&&payload.validFrom>payload.validTo)throw new Error('日期區間不正確');await state.db.collection(COLLECTIONS.settings).doc('membershipPoints').set(payload,{merge:true});state.membershipSettings=Object.assign({},DEFAULT_MEMBERSHIP_SETTINGS,payload);closeDrawer();toast('點數設定已儲存','','success');render();}
  function openMembershipSettingsV5(){
    const nowYear=new Date().getFullYear(),active=membershipRuleForDate(new Date()),rules=(state.membershipSettings&&state.membershipSettings.annualRules)||{},rows=Object.keys(rules).sort().reverse().map(function(year){const r=rules[year]||{};return '<div class="ops-rule-row"><b>'+escapeHtml(year)+' 年</b><span>'+formatNumber(Number(r.rewardPercent||0))+'%</span><span>最高折 '+formatNumber(Number(r.maxRedeemPercent||20))+'%</span><span>'+(r.redemptionMode==='auto'?'自動折抵':'選擇折抵')+'</span></div>';}).join('');
    openDrawer('年度點數設定','', '<form id="membershipSettingsFormV5"><div class="ops-form-grid"><div class="ops-field"><label>設定年度</label><input class="ops-input" type="number" min="2020" max="2100" step="1" name="year" value="'+nowYear+'"></div><div class="ops-field"><label>全店回饋％</label><input class="ops-input" type="number" min="0" max="100" step="0.1" name="rewardPercent" value="'+Number(active.rewardPercent||5)+'"></div><div class="ops-field"><label>單筆最高折抵％</label><input class="ops-input" type="number" min="0" max="100" step="1" name="maxRedeemPercent" value="'+Number(active.maxRedeemPercent||20)+'"></div><div class="ops-field"><label>點數使用</label><select class="ops-select" name="redemptionMode"><option value="auto">自動使用最多點數</option><option value="ask">結帳時選擇</option><option value="earn-only">只累積不折抵</option></select></div><div class="ops-field full"><label>年度狀態</label><div class="ops-choice-grid two"><label class="ops-radio-tile"><input type="radio" name="enabled" value="true" '+(active.enabled!==false?'checked':'')+'><span>啟用</span></label><label class="ops-radio-tile"><input type="radio" name="enabled" value="false" '+(active.enabled===false?'checked':'')+'><span>停用</span></label></div></div></div>'+(rows?'<div class="ops-section-title">已設定年度</div><div class="ops-rule-list">'+rows+'</div>':'')+'<div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存年度設定</button></div></form>');query('#membershipSettingsFormV5 [name="redemptionMode"]').value=active.redemptionMode||'auto';
  }
  async function saveMembershipSettingsV5(form){
    const data=new FormData(form),year=String(Math.floor(Number(data.get('year')||new Date().getFullYear()))),rules=Object.assign({},(state.membershipSettings&&state.membershipSettings.annualRules)||{}),rule={year:Number(year),enabled:data.get('enabled')!=='false',rewardPercent:Math.max(0,Math.min(100,Number(data.get('rewardPercent')||0))),redeemPoints:1,redeemAmount:1,minRedeemPoints:1,maxRedeemPercent:Math.max(0,Math.min(100,Number(data.get('maxRedeemPercent')||0))),redemptionMode:clean(data.get('redemptionMode'))||'auto'};rules[year]=rule;const payload={enabled:true,rewardPercent:rule.rewardPercent,redeemPoints:1,redeemAmount:1,minRedeemPoints:1,maxRedeemPercent:rule.maxRedeemPercent,redemptionMode:rule.redemptionMode,annualRules:rules,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};await state.db.collection(COLLECTIONS.settings).doc('membershipPoints').set(payload,{merge:true});state.membershipSettings=Object.assign({},DEFAULT_MEMBERSHIP_SETTINGS,payload);state.checkoutPointsTouched=false;closeDrawer();toast(year+' 年點數設定已儲存',formatNumber(rule.rewardPercent)+'%','success');render();
  }
  function openPointAdjustment(id){const c=state.customers.find(function(x){return x.id===id;});if(!c)return;openDrawer('調整點數',c.name,'<form id="pointAdjustmentForm" data-id="'+attr(c.id)+'"><div class="ops-form-grid"><div class="ops-field"><label>目前點數</label><input class="ops-input" value="'+formatNumber(c.pointBalance)+'" readonly></div><div class="ops-field"><label class="ops-required">增加／扣除</label><input class="ops-input" type="number" step="1" name="points" required></div><div class="ops-field full"><label class="ops-required">原因</label><input class="ops-input" name="note" required></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存</button></div></form>');}
  async function savePointAdjustment(form){const id=clean(form.dataset.id),c=state.customers.find(function(x){return x.id===id;});if(!c)throw new Error('找不到客戶');const data=new FormData(form),points=Math.trunc(Number(data.get('points')||0)),note=clean(data.get('note'));if(!points||!note)throw new Error('請填寫點數與原因');const customerRef=state.db.collection(COLLECTIONS.customers).doc(id),pointRef=state.db.collection(COLLECTIONS.points).doc();await state.db.runTransaction(async function(tx){const snap=await tx.get(customerRef);if(!snap.exists)throw new Error('找不到客戶');const balance=Math.max(0,Number((snap.data()||{}).pointBalance||0)+points);if(Number((snap.data()||{}).pointBalance||0)+points<0)throw new Error('點數不足');tx.update(customerRef,{pointBalance:balance,updatedAt:serverTimestamp()});tx.set(pointRef,{customerId:id,type:'adjustment',points:points,balanceAfter:balance,note:note,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});closeDrawer();toast('點數已調整','','success');await loadAll(true);}
  function renderReceivables(){
    const term=lower(state.receivableSearch);const rows=state.receivables.filter(function(x){return !term||lower([x.receivableNo,x.saleNo,x.customerName].join(' ')).includes(term);}).sort(function(a,b){return (dateFrom(b.createdAt)||0)-(dateFrom(a.createdAt)||0);});
    const table=rows.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>帳款</th><th>客戶</th><th class="num">原金額</th><th class="num">尚未收</th><th>狀態</th><th></th></tr></thead><tbody>'+rows.map(function(x){return '<tr><td><b>'+escapeHtml(x.receivableNo)+'</b><br><small>'+escapeHtml(x.sourceType==='income'?'收入 '+(x.incomeNo||''):'銷售 '+(x.saleNo||''))+'</small></td><td>'+escapeHtml(x.customerName)+'</td><td class="num">'+money(x.totalAmount)+'</td><td class="num"><b>'+money(x.outstandingAmount)+'</b></td><td>'+statusTag(x.status==='paid'?'已收清':x.status==='partial'?'部分收款':'未收款',x.status==='paid'?'green':'yellow')+'</td><td>'+(x.status!=='paid'?'<button class="ops-button small primary" data-action="receivable-payment" data-id="'+attr(x.id)+'">登記收款</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('目前沒有未收款','');
    return '<div class="ops-kpi-grid">'+kpi('尚未收款',money(sum(state.receivables,function(x){return x.outstandingAmount;})),'全部未結清帳款','帳')+kpi('未結清筆數',formatNumber(state.receivables.filter(function(x){return x.status!=='paid';}).length),'含部分收款','筆')+kpi('已收回',money(sum(state.receivablePayments,function(x){return x.amount;})),'帳款收款流水','收')+'</div><section class="ops-card"><div class="ops-card-head"><div><h2>應收帳款</h2><p>每筆帳款都連回客戶與原始銷售。</p></div></div><div class="ops-toolbar"><input class="ops-input grow" id="receivableSearch" placeholder="搜尋客戶、銷售編號或帳款編號" value="'+attr(state.receivableSearch)+'"></div>'+table+'</section>';
  }
  function renderReceivablesV5(){
    const term=lower(state.receivableSearch),enriched=state.receivables.map(function(x){const customer=state.customers.find(function(c){return c.id===x.customerId;})||null,sale=x.saleId?state.sales.find(function(s){return s.id===x.saleId;}):null,income=x.incomeId?state.incomes.find(function(i){return i.id===x.incomeId;}):null,items=sale?(sale.items||[]).map(function(i){return clean(i.name)+' '+clean(i.sku);}).join('、'):(income?income.category:'');return {row:x,customer:customer,sale:sale,items:items,search:[x.receivableNo,x.saleNo,x.incomeNo,x.customerName,customer&&customer.phone,customer&&customer.memberNo,items].join(' ')};}).filter(function(x){return !term||lower(x.search).includes(term);}).sort(function(a,b){return (dateFrom(b.row.createdAt)||0)-(dateFrom(a.row.createdAt)||0);});
    const table=enriched.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>帳款</th><th>客戶／行動電話</th><th>購買內容</th><th class="num">原金額</th><th class="num">尚未收</th><th></th></tr></thead><tbody>'+enriched.map(function(x){const r=x.row;return '<tr><td><b>'+escapeHtml(r.receivableNo)+'</b><br><small>'+escapeHtml(r.sourceType==='income'?(r.incomeNo||'收入'):(r.saleNo||'銷售'))+'</small></td><td><b>'+escapeHtml(r.customerName)+'</b><br><small>'+escapeHtml((x.customer&&x.customer.phone)||'—')+'</small></td><td>'+escapeHtml(x.items||'—')+'</td><td class="num">'+money(r.totalAmount)+'</td><td class="num"><b>'+money(r.outstandingAmount)+'</b></td><td><div class="ops-card-actions">'+(r.customerId?'<button class="ops-button small ghost" data-action="customer-history" data-id="'+attr(r.customerId)+'">客戶</button>':'')+(r.status!=='paid'?'<button class="ops-button small primary" data-action="receivable-payment" data-id="'+attr(r.id)+'">收款</button>':'')+'</div></td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('找不到未收款','');
    return '<div class="ops-kpi-grid">'+kpi('尚未收款',money(sum(state.receivables,function(x){return x.outstandingAmount;})),'','帳')+kpi('未結清筆數',formatNumber(state.receivables.filter(function(x){return x.status!=='paid';}).length),'','筆')+kpi('已收回',money(sum(state.receivablePayments,function(x){return x.amount;})),'','收')+'</div><section class="ops-card"><div class="ops-card-head"><h2>應收帳款</h2></div><input class="ops-input" id="receivableSearch" placeholder="姓名／行動電話／單號／買過的商品" value="'+attr(state.receivableSearch)+'"><div style="height:10px"></div>'+table+'</section>';
  }

  function purchaseEntrySeriesTabs(){
    return '<div class="ops-purchase-series-tabs ops-series-grid-tabs"><button type="button" class="'+(state.purchaseEntrySeries==='all'?'active':'')+'" data-action="purchase-entry-series" data-series="all">全部</button>'+PRODUCT_SERIES.map(function(row){return '<button type="button" class="'+(state.purchaseEntrySeries===row[0]?'active':'')+'" data-action="purchase-entry-series" data-series="'+row[0]+'">'+escapeHtml(productSeriesLabel(row))+'</button>';}).join('')+'</div>';
  }
  function purchaseEntryFilteredProducts(){
    const term=lower(state.purchaseEntrySearch).trim();
    let rows=state.catalog.filter(function(product){
      if(!product.initialized)return false;
      if(state.purchaseEntrySeries!=='all'&&!clean(product.sku).startsWith(state.purchaseEntrySeries))return false;
      return !term||matchesSearch([product.sku,formatLabelSku(product.sku),product.originalName,product.onlineName,product.name,product.brand,product.category,product.variantName],term);
    });
    rows.sort(compareCatalogSku);
    return rows;
  }
  function purchaseEntryCost(product){
    const latest=numberOrNull(product&&product.latestPurchaseCost);
    if(latest!=null)return latest;
    const average=numberOrNull(product&&product.averageCost);
    return average!=null?average:0;
  }
  function addPurchaseEntryProduct(productId){
    const product=catalogById(productId);if(!product||!product.initialized)return;
    const existing=state.purchaseEntryCart.find(function(item){return item.productId===productId;});
    if(existing)existing.qty+=1;
    else state.purchaseEntryCart.push({productId:productId,qty:1,unitCost:purchaseEntryCost(product)});
  }
  function purchaseEntryTextRow(product){
    const name=displayOnlineName(product.onlineName)||displayOnlineName(product.originalName)||'未命名商品';
    const variant=clean(product.variantName);
    const average=numberOrNull(product.averageCost),storePrice=numberOrNull(product.storePrice),costText=average==null?'成本待補':money(Math.round(average));
    return '<button type="button" class="ops-purchase-entry-text-row" data-action="purchase-entry-add" data-id="'+attr(product.docId)+'"><span class="ops-purchase-entry-text-sku">'+escapeHtml(product.sku||'未設定')+'</span><span class="ops-purchase-entry-text-name"><b>'+escapeHtml(name)+'</b>'+(variant?'<small>'+escapeHtml(variant)+'</small>':'')+'</span><span class="ops-purchase-entry-text-value"><small>庫存</small><b>'+formatNumber(product.currentStock)+'</b></span><span class="ops-purchase-entry-text-value"><small>門市定價</small><b>'+(storePrice==null?'未設定':money(storePrice))+'</b></span><span class="ops-purchase-entry-text-value '+(average==null?'is-anomaly':'')+'"><small>目前庫存平均成本</small><b>'+escapeHtml(costText)+'</b></span></button>';
  }
  function supplierById(id){return state.suppliers.find(function(row){return row.id===id;})||null;}
  function supplierSelectOptions(selectedId){
    return '<option value="">直接輸入供應商名稱</option>'+state.suppliers.map(function(row){return '<option value="'+attr(row.id)+'" '+(row.id===selectedId?'selected':'')+'>'+escapeHtml(row.name)+(row.contactName?'｜'+escapeHtml(row.contactName):'')+'</option>';}).join('');
  }
  function resetPurchaseEntry(){
    state.purchaseEntrySearch='';state.purchaseEntrySeries='all';state.purchaseEntrySort='sku';state.purchaseEntryCart=[];
    state.purchaseEntryReceivedAt='';state.purchaseEntrySupplier='';state.purchaseEntrySupplierId='';state.purchaseEntryExternalNo='';state.purchaseEntryExtraCost=0;state.purchaseEntryNote='';
    state.purchaseEntryPaymentStatus='unpaid';state.purchaseEntryPaymentDate='';state.purchaseEntryPaymentMethod='';state.purchaseEditId='';
  }
  function openPurchaseWorkspace(preselectedId){
    resetPurchaseEntry();
    state.purchaseEntryReceivedAt=inputDateTime(new Date());
    if(preselectedId)addPurchaseEntryProduct(preselectedId);
    location.hash='purchase-entry';
  }
  function startPurchaseEdit(id){
    const purchase=state.purchases.find(function(row){return row.id===id;});if(!purchase)return toast('找不到進貨單','請重新讀取資料。','error');
    state.purchaseEditId=purchase.id;
    state.purchaseEntryCart=(purchase.items||[]).map(function(item){return {productId:clean(item.productId),qty:Math.max(1,Math.round(Number(item.qty||1))),unitCost:Math.max(0,Number(item.unitCost||0))};}).filter(function(item){return item.productId&&catalogById(item.productId);});
    state.purchaseEntryReceivedAt=inputDateTime(purchase.receivedAt||new Date());
    state.purchaseEntrySupplierId=purchase.supplierId||((state.suppliers.find(function(row){return row.name===purchase.supplier;})||{}).id||'');
    state.purchaseEntrySupplier=purchase.supplier||((supplierById(state.purchaseEntrySupplierId)||{}).name||'');
    state.purchaseEntryExternalNo=purchase.externalNo||'';state.purchaseEntryExtraCost=Number(purchase.extraCost||0);state.purchaseEntryNote=purchase.note||'';
    state.purchaseEntryPaymentStatus=purchase.paymentStatus||'unpaid';state.purchaseEntryPaymentDate=purchase.paymentDate&&dateText(purchase.paymentDate)!=='—'?dateText(purchase.paymentDate):'';state.purchaseEntryPaymentMethod=purchase.paymentMethod||'';
    state.purchaseEntrySearch='';state.purchaseEntrySeries='all';state.purchaseEntrySort='sku';location.hash='purchase-entry';
  }
  function openSupplierManager(id){
    const row=id?supplierById(id):null,s=row||{id:'',name:'',contactName:'',phone:'',mobile:'',email:'',address:'',taxId:'',paymentInfo:'',note:''};
    const list=state.suppliers.length?'<div class="ops-supplier-directory">'+state.suppliers.map(function(item){return '<button type="button" class="ops-supplier-directory-row" data-action="supplier-edit" data-id="'+attr(item.id)+'"><div><b>'+escapeHtml(item.name)+'</b><small>'+escapeHtml([item.contactName,item.phone||item.mobile].filter(Boolean).join('｜')||'尚未填聯絡資料')+'</small></div><span>編輯</span></button>';}).join('')+'</div>':emptyHtml('尚無供應商','建立後可在每張進貨單快速選擇。');
    openDrawer(row?'編輯供應商':'供應商資料庫','供應商名稱必填，其餘聯絡及付款資訊皆可選填。','<form id="supplierForm" data-id="'+attr(s.id)+'"><div class="ops-form-grid"><div class="ops-field full"><label class="ops-required">供應商名稱</label><input class="ops-input" name="name" value="'+attr(s.name)+'" required></div><div class="ops-field"><label>聯絡人</label><input class="ops-input" name="contactName" value="'+attr(s.contactName)+'"></div><div class="ops-field"><label>電話</label><input class="ops-input" name="phone" value="'+attr(s.phone)+'"></div><div class="ops-field"><label>手機</label><input class="ops-input" name="mobile" value="'+attr(s.mobile)+'"></div><div class="ops-field"><label>Email</label><input class="ops-input" type="email" name="email" value="'+attr(s.email)+'"></div><div class="ops-field"><label>統一編號</label><input class="ops-input" name="taxId" value="'+attr(s.taxId)+'"></div><div class="ops-field full"><label>地址</label><input class="ops-input" name="address" value="'+attr(s.address)+'"></div><div class="ops-field full"><label>匯款／付款資訊</label><textarea class="ops-textarea" name="paymentInfo">'+escapeHtml(s.paymentInfo)+'</textarea></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note">'+escapeHtml(s.note)+'</textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存供應商</button></div></form><div class="ops-section-title">既有供應商</div>'+list);
  }
  async function saveSupplier(form){
    const id=clean(form.dataset.id),data=new FormData(form),payload={name:clean(data.get('name')),contactName:clean(data.get('contactName')),phone:clean(data.get('phone')),mobile:clean(data.get('mobile')),email:clean(data.get('email')),address:clean(data.get('address')),taxId:clean(data.get('taxId')),paymentInfo:clean(data.get('paymentInfo')),note:clean(data.get('note')),enabled:true,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};
    if(!payload.name)throw new Error('請填寫供應商名稱');
    const duplicate=state.suppliers.find(function(row){return row.id!==id&&row.name===payload.name;});if(duplicate)throw new Error('已經有相同名稱的供應商');
    const base=state.db.collection(COLLECTIONS.settings).doc('suppliers').collection('directory');let ref;
    if(id){ref=base.doc(id);await ref.set(payload,{merge:true});}else{payload.createdAt=serverTimestamp();payload.createdBy=userLabel();ref=await base.add(payload);}
    state.purchaseEntrySupplierId=ref.id;state.purchaseEntrySupplier=payload.name;await writeAudit(id?'更新供應商':'新增供應商','supplier',ref.id,payload.name);closeDrawer();toast('供應商已儲存',payload.name,'success');await loadAll(true);
  }
  function purchaseSupplierSummary(){
    const supplier=supplierById(state.purchaseEntrySupplierId);if(!supplier)return '';
    const contact=[supplier.contactName,supplier.phone||supplier.mobile,supplier.email].filter(Boolean).join('｜');
    return '<div class="ops-purchase-supplier-summary"><b>'+escapeHtml(supplier.name)+'</b><span>'+escapeHtml(contact||'尚未填聯絡資料')+'</span>'+(supplier.paymentInfo?'<small>'+escapeHtml(supplier.paymentInfo)+'</small>':'')+'</div>';
  }
  function renderPurchaseEntry(){
    if(!state.purchaseEntryReceivedAt)state.purchaseEntryReceivedAt=inputDateTime(new Date());
    const rows=purchaseEntryFilteredProducts().slice(0,240),editing=state.purchaseEditId?state.purchases.find(function(row){return row.id===state.purchaseEditId;}):null;
    const productHtml=rows.length?rows.map(function(product){
      if(state.purchaseEntryDisplayMode==='text')return purchaseEntryTextRow(product);
      const image=product.imageUrl?'<img loading="lazy" src="'+attr(product.imageUrl)+'" alt="'+attr(product.originalName||product.name)+'">':'<div class="ops-purchase-entry-no-image">無圖</div>';
      const average=numberOrNull(product.averageCost),storePrice=numberOrNull(product.storePrice);
      return '<button type="button" class="ops-purchase-entry-product" data-action="purchase-entry-add" data-id="'+attr(product.docId)+'"><div class="ops-purchase-entry-thumb">'+image+'</div><div class="ops-purchase-entry-product-body"><div class="ops-purchase-entry-sku">'+escapeHtml(product.sku||'未設定')+'</div><b>'+escapeHtml(product.originalName||product.name||'未命名商品')+'</b><div class="ops-purchase-entry-product-meta"><span>庫存 '+formatNumber(product.currentStock)+'</span><span>門市 '+(storePrice==null?'未設定':money(storePrice))+'</span><span class="'+(average==null?'is-anomaly':'')+'">平均成本 '+(average==null?'待補':money(Math.round(average)))+'</span></div></div></button>';
    }).join(''):emptyHtml('找不到商品','請更換商品編號、名稱或分類。');
    let subtotal=0,qtyTotal=0;
    const cartHtml=state.purchaseEntryCart.length?state.purchaseEntryCart.map(function(item,index){
      const product=catalogById(item.productId);if(!product)return '';
      const qty=Math.max(1,Math.round(Number(item.qty||1))),unitCost=Math.max(0,Number(item.unitCost||0));qtyTotal+=qty;subtotal+=qty*unitCost;
      return '<div class="ops-purchase-entry-cart-row purchase-row" data-index="'+index+'"><input type="hidden" name="productId" value="'+attr(item.productId)+'"><div class="ops-purchase-entry-cart-title"><div><b>'+escapeHtml(product.originalName||product.name)+'</b><small>SKU '+escapeHtml(product.sku||'未設定')+'｜目前庫存 '+formatNumber(product.currentStock)+'</small></div><strong>'+money(qty*unitCost)+'</strong></div><div class="ops-purchase-entry-cart-fields"><label><span>數量</span><input class="ops-input" type="number" min="1" step="1" inputmode="numeric" name="qty" value="'+qty+'" data-purchase-entry-qty="'+index+'" required></label><label><span>單位成本</span><input class="ops-input" type="number" min="0" step="0.01" inputmode="decimal" name="unitCost" value="'+unitCost+'" data-purchase-entry-cost="'+index+'" required></label><button class="ops-icon-button" type="button" data-action="purchase-entry-remove" data-index="'+index+'" aria-label="移除商品">×</button></div></div>';
    }).join(''):emptyHtml('尚未加入進貨商品','請從左側搜尋並點選商品。');
    const extra=Math.max(0,Number(state.purchaseEntryExtraCost||0)),grand=subtotal+extra;
    const title=editing?'修改進貨單 '+escapeHtml(editing.purchaseNo):'進貨入庫工作台';
    const submitText=editing?'儲存修改並同步庫存':'確認驗收入庫';
    return '<div class="ops-purchase-entry-top"><button class="ops-button ghost" type="button" data-action="purchase-entry-back">← 返回庫存作業</button><div><h2>'+title+'</h2><p>'+(editing?'修改數量後，系統會依差異同步更正庫存並保留修改紀錄。':'左側快速找商品，右側整理本次進貨數量與成本。')+'</p></div></div><form id="purchaseWorkspaceForm" data-id="'+attr(state.purchaseEditId)+'"><div class="ops-purchase-entry-layout"><section class="ops-card ops-purchase-entry-products"><div class="ops-v8-section-head"><div><h2>選擇進貨商品</h2><p>可輸入 SKU、名稱、品牌或分類</p></div><span class="ops-tag green">'+formatNumber(rows.length)+' 項</span></div>'+purchaseEntrySeriesTabs()+'<div class="ops-purchase-entry-search-row"><input class="ops-input" id="purchaseEntrySearch" placeholder="輸入 SKU、商品名稱、品牌或分類" value="'+attr(state.purchaseEntrySearch)+'"><select class="ops-select" id="purchaseEntrySort"><option value="sku" '+(state.purchaseEntrySort==='sku'?'selected':'')+'>依商品編號</option><option value="stock" '+(state.purchaseEntrySort==='stock'?'selected':'')+'>庫存少的優先</option><option value="name" '+(state.purchaseEntrySort==='name'?'selected':'')+'>依名稱</option></select><button class="ops-button soft" type="button" data-action="purchase-entry-new-product">新增商品主檔</button></div>'+mobileSearchPadHtml('purchaseEntrySearch')+'<div class="ops-purchase-entry-grid">'+productHtml+'</div></section><section class="ops-card ops-purchase-entry-cart"><div class="ops-v8-section-head"><div><h2>本次進貨</h2><p>供應商、付款狀態與商品成本</p></div><button class="ops-button small ghost" type="button" data-action="purchase-entry-clear">清空商品</button></div><div class="ops-purchase-entry-info"><div class="ops-field"><label class="ops-required">到貨時間</label><input class="ops-input" type="datetime-local" name="receivedAt" id="purchaseEntryReceivedAt" value="'+attr(state.purchaseEntryReceivedAt)+'" required></div><div class="ops-field"><label>選擇既有供應商</label><div class="ops-inline-control"><select class="ops-select" name="supplierId" id="purchaseEntrySupplierId">'+supplierSelectOptions(state.purchaseEntrySupplierId)+'</select><button class="ops-button soft" type="button" data-action="supplier-manager">管理</button></div></div><div class="ops-field full"><label class="ops-required">供應商名稱</label><input class="ops-input" name="supplier" id="purchaseEntrySupplier" value="'+attr(state.purchaseEntrySupplier)+'" placeholder="可直接輸入新供應商" required>'+purchaseSupplierSummary()+'</div><div class="ops-field"><label>進貨單號／外部編號</label><input class="ops-input" name="externalNo" id="purchaseEntryExternalNo" value="'+attr(state.purchaseEntryExternalNo)+'"></div><div class="ops-field"><label>額外費用</label><input class="ops-input" type="number" min="0" step="1" inputmode="numeric" name="extraCost" id="purchaseEntryExtraCost" value="'+attr(extra)+'"><small>運費、關稅會按商品金額比例分攤。</small></div><div class="ops-field"><label>付款狀態</label><select class="ops-select" name="paymentStatus" id="purchaseEntryPaymentStatus"><option value="unpaid" '+(state.purchaseEntryPaymentStatus!=='paid'?'selected':'')+'>未付款</option><option value="paid" '+(state.purchaseEntryPaymentStatus==='paid'?'selected':'')+'>已付款</option></select></div><div class="ops-field"><label>付款日期</label><input class="ops-input" type="date" name="paymentDate" id="purchaseEntryPaymentDate" value="'+attr(state.purchaseEntryPaymentDate)+'"></div><div class="ops-field"><label>付款方式</label><select class="ops-select" name="paymentMethod" id="purchaseEntryPaymentMethod"><option value="">未設定</option><option '+(state.purchaseEntryPaymentMethod==='轉帳'?'selected':'')+'>轉帳</option><option '+(state.purchaseEntryPaymentMethod==='現金'?'selected':'')+'>現金</option><option '+(state.purchaseEntryPaymentMethod==='信用卡'?'selected':'')+'>信用卡</option><option '+(state.purchaseEntryPaymentMethod==='其他'?'selected':'')+'>其他</option></select></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note" id="purchaseEntryNote">'+escapeHtml(state.purchaseEntryNote)+'</textarea></div></div><div class="ops-purchase-entry-cart-list">'+cartHtml+'</div><div class="ops-purchase-entry-summary"><div><span>商品種類</span><b>'+formatNumber(state.purchaseEntryCart.length)+'</b></div><div><span>進貨總件數</span><b>'+formatNumber(qtyTotal)+'</b></div><div><span>商品成本小計</span><b>'+money(subtotal)+'</b></div><div><span>額外費用</span><b>'+money(extra)+'</b></div><div class="total"><span>本次進貨總成本</span><b>'+money(grand)+'</b></div></div><button class="ops-button primary ops-purchase-entry-submit" type="submit" '+(state.purchaseEntryCart.length?'':'disabled')+'>'+submitText+'</button></section></div></form>';
  }
  function revisePurchaseLayers(raw,purchaseNo,oldItem,newItem,effectiveUnit,receivedAt){
    const oldQty=Math.max(0,Math.round(Number(oldItem&&oldItem.qty||0))),newQty=Math.max(0,Math.round(Number(newItem&&newItem.qty||0)));
    const oldLayerId=clean(oldItem&&oldItem.layerId),layers=materializeCostLayers(raw),matched=layers.filter(function(layer){return (layer.referenceType==='purchase'&&layer.referenceId===purchaseNo)||(oldLayerId&&layer.layerId===oldLayerId);});
    const remainingOld=sum(matched,function(layer){return layer.qtyRemaining;}),soldQty=Math.max(0,oldQty-remainingOld);
    if(newQty<soldQty)throw new Error((clean(raw.internalName)||clean(raw.originalName)||'商品')+' 已有 '+soldQty+' 件從此進貨批次售出，進貨量不可改低於已售數量');
    const next=layers.filter(function(layer){return !matched.includes(layer);}),remainingNew=Math.max(0,newQty-soldQty);
    if(remainingNew>0)next.push({layerId:oldLayerId||purchaseNo+'-'+clean(raw.internalSku||newItem.productId),qtyRemaining:remainingNew,originalQty:newQty,unitCost:effectiveUnit,costKnown:effectiveUnit!=null,receivedAt:receivedAt.toISOString(),referenceType:'purchase',referenceId:purchaseNo});
    const stats=statsFromLayers(next);return {layers:stats.layers,averageCost:stats.averageCost,nextFifoCost:stats.nextFifoCost,inventoryValue:stats.inventoryValue,costIncomplete:stats.costIncomplete,soldQty:soldQty};
  }
  async function savePurchase(form){
    const data=new FormData(form),rowEls=queryAll('.purchase-row',form),items=[];rowEls.forEach(function(row){const productId=clean(query('[name="productId"]',row).value),qty=numberOrNull(query('[name="qty"]',row).value),unitCost=numberOrNull(query('[name="unitCost"]',row).value);if(productId&&qty>0&&unitCost!=null)items.push({productId:productId,qty:Math.round(qty),unitCost:unitCost});});
    if(!items.length)throw new Error('至少需要一個有效進貨商品');const duplicate=new Set();for(const item of items){if(duplicate.has(item.productId))throw new Error('同一商品請合併成一列');duplicate.add(item.productId);}
    const extraCost=numberOrNull(data.get('extraCost'))||0,receivedAt=new Date(clean(data.get('receivedAt')));if(Number.isNaN(receivedAt.getTime()))throw new Error('到貨時間不正確');
    const supplierId=clean(data.get('supplierId')),selectedSupplier=supplierById(supplierId),supplierName=clean(data.get('supplier'))||(selectedSupplier&&selectedSupplier.name)||'';if(!supplierName)throw new Error('請填寫供應商');
    const paymentStatus=clean(data.get('paymentStatus'))==='paid'?'paid':'unpaid',paymentDate=paymentStatus==='paid'?(clean(data.get('paymentDate'))||dateText(new Date())):'',paymentMethod=paymentStatus==='paid'?clean(data.get('paymentMethod')):'';
    const editingId=clean(form.dataset.id),editing=editingId?state.purchases.find(function(row){return row.id===editingId;}):null;
    if(!editing){
      const purchaseNo=uid('PUR'),purchaseRef=state.db.collection(COLLECTIONS.purchases).doc();
      await state.db.runTransaction(async function(tx){const refs=items.map(function(item){return state.db.collection(COLLECTIONS.products).doc(item.productId);}),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));const subtotal=sum(items,function(i){return i.qty*i.unitCost;}),prepared=[];snaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品主檔不存在');const raw=snap.data()||{},item=items[index],before=Number(raw.currentStock||0),base=item.qty*item.unitCost,allocated=subtotal>0?extraCost*(base/subtotal):0,effectiveUnit=item.unitCost+(item.qty?allocated/item.qty:0),after=before+item.qty,added=addFifoLayer(raw,item.qty,effectiveUnit,{layerId:purchaseNo+'-'+index,receivedAt:receivedAt.toISOString(),referenceType:'purchase',referenceId:purchaseNo});prepared.push({ref:refs[index],raw:raw,item:item,before:before,after:after,allocated:allocated,effectiveUnit:effectiveUnit,added:added});});
        tx.set(purchaseRef,{purchaseNo:purchaseNo,externalNo:clean(data.get('externalNo')),receivedAt:receivedAt,supplierId:supplierId,supplier:supplierName,items:prepared.map(function(x){return {productId:x.item.productId,name:clean(x.raw.internalName||x.raw.originalName||x.raw.onlineName),sku:clean(x.raw.internalSku),qty:x.item.qty,unitCost:x.item.unitCost,allocatedExtraCost:x.allocated,effectiveUnitCost:x.effectiveUnit,lineTotal:x.item.qty*x.item.unitCost,layerId:x.added.layers[x.added.layers.length-1].layerId};}),subtotal:subtotal,extraCost:extraCost,totalCost:subtotal+extraCost,paymentStatus:paymentStatus,paymentDate:paymentDate?new Date(paymentDate+'T12:00:00'):'',paymentMethod:paymentMethod,costMethod:'FIFO',note:clean(data.get('note')),revisionHistory:[],createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
        prepared.forEach(function(x){tx.update(x.ref,{currentStock:x.after,latestPurchaseCost:x.item.unitCost,costLayers:x.added.layers,averageCost:x.added.averageCost,inventoryValue:x.added.inventoryValue,costIncomplete:x.added.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});queueInventorySyncInTransaction(tx,x.item.productId,clean(x.raw.internalSku),x.after,'purchase');const tRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(tRef,{type:'purchase',productId:x.item.productId,productName:clean(x.raw.internalName||x.raw.originalName||x.raw.onlineName),sku:clean(x.raw.internalSku),qtyChange:x.item.qty,beforeStock:x.before,afterStock:x.after,unitCost:x.effectiveUnit,costMethod:'FIFO',referenceType:'purchase',referenceId:purchaseNo,note:'進貨入庫｜'+supplierName,occurredAt:receivedAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
      });await writeAudit('進貨驗收入庫','purchase',purchaseRef.id,purchaseNo+'｜'+supplierName+'｜'+items.length+'項｜FIFO');resetPurchaseEntry();state.purchaseWorkspaceTab='inbound';location.hash='purchases';toast('進貨入庫完成',purchaseNo,'success');await loadAll(true);return;
    }
    const purchaseRef=state.db.collection(COLLECTIONS.purchases).doc(editing.id),purchaseNo=editing.purchaseNo;
    await state.db.runTransaction(async function(tx){
      const purchaseSnap=await tx.get(purchaseRef);if(!purchaseSnap.exists)throw new Error('進貨單不存在');const rawPurchase=purchaseSnap.data()||{},oldItems=Array.isArray(rawPurchase.items)?rawPurchase.items:[];
      const ids=Array.from(new Set(oldItems.map(function(item){return clean(item.productId);}).concat(items.map(function(item){return item.productId;})).filter(Boolean))),refs=ids.map(function(id){return state.db.collection(COLLECTIONS.products).doc(id);}),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));
      const rawById=new Map();snaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品主檔不存在');rawById.set(ids[index],snap.data()||{});});
      const oldMap=new Map(oldItems.map(function(item){return [clean(item.productId),item];})),newMap=new Map(items.map(function(item){return [item.productId,item];})),subtotal=sum(items,function(item){return item.qty*item.unitCost;}),newStoredItems=[];
      ids.forEach(function(productId,index){const raw=rawById.get(productId),oldItem=oldMap.get(productId)||{productId:productId,qty:0,unitCost:0},newItem=newMap.get(productId)||{productId:productId,qty:0,unitCost:0},base=newItem.qty*newItem.unitCost,allocated=subtotal>0?extraCost*(base/subtotal):0,effectiveUnit=newItem.qty?newItem.unitCost+allocated/newItem.qty:null,delta=newItem.qty-oldItem.qty,before=Number(raw.currentStock||0),after=before+delta;if(after<0)throw new Error((clean(raw.internalName)||'商品')+' 庫存不足，無法套用此次修改');const revised=revisePurchaseLayers(raw,purchaseNo,oldItem,newItem,effectiveUnit,receivedAt),ref=refs[index];
        tx.update(ref,{currentStock:after,latestPurchaseCost:newItem.qty?newItem.unitCost:(numberOrNull(raw.latestPurchaseCost)),costLayers:revised.layers,averageCost:revised.averageCost,inventoryValue:revised.inventoryValue,costIncomplete:revised.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});queueInventorySyncInTransaction(tx,productId,clean(raw.internalSku),after,'purchaseCorrection');
        const oldEffective=numberOrNull(oldItem.effectiveUnitCost),costChanged=newItem.qty&&Math.abs(Number(effectiveUnit||0)-Number(oldEffective||0))>.0001;if(delta!==0||costChanged){const tRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(tRef,{type:'purchaseCorrection',productId:productId,productName:clean(raw.internalName||raw.originalName||raw.onlineName),sku:clean(raw.internalSku),qtyChange:delta,beforeStock:before,afterStock:after,unitCost:effectiveUnit,costMethod:'FIFO',referenceType:'purchaseCorrection',referenceId:purchaseNo,note:'修改進貨單｜'+supplierName,occurredAt:new Date(),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}
        if(newItem.qty>0)newStoredItems.push({productId:productId,name:clean(raw.internalName||raw.originalName||raw.onlineName),sku:clean(raw.internalSku),qty:newItem.qty,unitCost:newItem.unitCost,allocatedExtraCost:allocated,effectiveUnitCost:effectiveUnit,lineTotal:newItem.qty*newItem.unitCost,layerId:clean(oldItem.layerId)||purchaseNo+'-'+index});
      });
      const history=Array.isArray(rawPurchase.revisionHistory)?rawPurchase.revisionHistory.slice():[];history.push({changedAt:new Date().toISOString(),changedBy:userLabel(),supplier:clean(rawPurchase.supplier),subtotal:Number(rawPurchase.subtotal||0),extraCost:Number(rawPurchase.extraCost||0),totalCost:Number(rawPurchase.totalCost||0),paymentStatus:clean(rawPurchase.paymentStatus)||'unpaid',items:oldItems.map(function(item){return {productId:clean(item.productId),sku:clean(item.sku),qty:Number(item.qty||0),unitCost:Number(item.unitCost||0)};})});
      tx.update(purchaseRef,{externalNo:clean(data.get('externalNo')),receivedAt:receivedAt,supplierId:supplierId,supplier:supplierName,items:newStoredItems,subtotal:subtotal,extraCost:extraCost,totalCost:subtotal+extraCost,paymentStatus:paymentStatus,paymentDate:paymentDate?new Date(paymentDate+'T12:00:00'):'',paymentMethod:paymentMethod,note:clean(data.get('note')),revisionHistory:history,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION});
    });await writeAudit('修改進貨單','purchase',editing.id,purchaseNo+'｜'+supplierName+'｜同步庫存');resetPurchaseEntry();state.purchaseWorkspaceTab='inbound';location.hash='purchases';toast('進貨單已修改',purchaseNo,'success');await loadAll(true);
  }
  function stocktakeFilteredProducts(){
    const term=lower(state.stocktakeSearch).trim();let rows=state.catalog.filter(function(product){if(!product.initialized)return false;if(state.stocktakeSeries!=='all'&&!clean(product.sku).startsWith(state.stocktakeSeries))return false;return !term||matchesSearch([product.sku,formatLabelSku(product.sku),product.originalName,product.onlineName,product.name,product.brand,product.category],term);});
    rows.sort(function(a,b){if(state.stocktakeSort==='stock')return Number(a.currentStock||0)-Number(b.currentStock||0);if(state.stocktakeSort==='name')return clean(a.originalName||a.name).localeCompare(clean(b.originalName||b.name),'zh-Hant');return clean(a.sku).localeCompare(clean(b.sku),'zh-Hant',{numeric:true});});return rows;
  }
  function addStocktakeProduct(productId,counted){const product=catalogById(productId);if(!product)return;const existing=state.stocktakeCart.find(function(item){return item.productId===productId;});if(existing){if(counted!==undefined)existing.countedStock=counted;}else state.stocktakeCart.push({productId:productId,countedStock:counted===undefined?'':counted});}
  function resetStocktake(){state.stocktakeSearch='';state.stocktakeSeries='all';state.stocktakeSort='sku';state.stocktakeCart=[];state.stocktakeOperator='';state.stocktakeNote='';state.stocktakeCorrectionId='';}
  function openStocktakeWorkspace(preselectedId){resetStocktake();if(preselectedId)addStocktakeProduct(preselectedId);location.hash='stocktake';}
  function startStocktakeCorrection(id){const row=state.inventory.find(function(item){return item.id===id;});if(!row)return toast('找不到盤點紀錄','','error');resetStocktake();state.stocktakeCorrectionId=row.id;state.stocktakeNote='更正盤點：'+(row.note||'');addStocktakeProduct(row.productId,row.afterStock);location.hash='stocktake';}
  function stocktakeSeriesTabs(){return '<div class="ops-purchase-series-tabs ops-series-grid-tabs"><button type="button" class="'+(state.stocktakeSeries==='all'?'active':'')+'" data-action="stocktake-series" data-series="all">全部</button>'+PRODUCT_SERIES.map(function(row){return '<button type="button" class="'+(state.stocktakeSeries===row[0]?'active':'')+'" data-action="stocktake-series" data-series="'+row[0]+'">'+escapeHtml(productSeriesLabel(row))+'</button>';}).join('')+'</div>';}
  function renderStocktakeWorkspace(){
    const rows=stocktakeFilteredProducts().slice(0,240),correction=state.stocktakeCorrectionId?state.inventory.find(function(row){return row.id===state.stocktakeCorrectionId;}):null;
    const products=rows.length?rows.map(function(product){const image=product.imageUrl?'<img src="'+attr(product.imageUrl)+'" alt="'+attr(product.originalName||product.name)+'">':'<div class="ops-purchase-entry-no-image">無圖</div>';return '<button type="button" class="ops-stocktake-product" data-action="stocktake-add" data-id="'+attr(product.docId)+'"><div class="ops-purchase-entry-thumb">'+image+'</div><div><b>'+escapeHtml(product.sku||'未設定')+'</b><span>'+escapeHtml(product.originalName||product.name)+'</span><strong>目前 '+formatNumber(product.currentStock)+'</strong></div></button>';}).join(''):emptyHtml('找不到商品','請更換 SKU 或商品名稱。');
    let diffCount=0;
    const cart=state.stocktakeCart.length?state.stocktakeCart.map(function(item,index){const product=catalogById(item.productId);if(!product)return '';const counted=item.countedStock,has=counted!==''&&counted!=null&&!Number.isNaN(Number(counted)),diff=has?Number(counted)-Number(product.currentStock||0):0;if(has&&diff!==0)diffCount+=1;return '<div class="ops-stocktake-cart-row"><div class="ops-stocktake-cart-product"><b>'+escapeHtml(product.originalName||product.name)+'</b><small>SKU '+escapeHtml(product.sku||'未設定')+'</small></div><div class="ops-stocktake-current"><span>系統數量</span><b>'+formatNumber(product.currentStock)+'</b></div><label><span>實際盤點</span><input class="ops-input" type="number" min="0" step="1" inputmode="numeric" name="countedStock" value="'+attr(counted)+'" data-stocktake-count="'+index+'" placeholder="留白不修改"></label><div class="ops-stocktake-diff '+(diff>0?'plus':diff<0?'minus':'')+'"><span>差異</span><b>'+(has?(diff>0?'+':'')+formatNumber(diff):'—')+'</b></div><button class="ops-icon-button" type="button" data-action="stocktake-remove" data-index="'+index+'">×</button></div>';}).join(''):emptyHtml('尚未加入盤點商品','請從左側搜尋並點選商品。');
    return '<div class="ops-purchase-entry-top"><button class="ops-button ghost" type="button" data-action="stocktake-back">← 返回庫存作業</button><div><h2>'+(correction?'更正盤點紀錄':'庫存盤點工作台')+'</h2><p>'+(correction?'輸入原盤點應有的正確數量，系統會以差額補正目前庫存。':'左側選商品，右側輸入實際盤點數量；留白的商品不會異動。')+'</p></div></div><form id="stocktakeForm"><div class="ops-stocktake-layout"><section class="ops-card"><div class="ops-v8-section-head"><div><h2>選擇盤點商品</h2><p>可輸入 SKU、名稱或品牌</p></div><span class="ops-tag green">'+formatNumber(rows.length)+' 項</span></div>'+stocktakeSeriesTabs()+'<div class="ops-purchase-entry-search-row"><input class="ops-input" id="stocktakeSearch" placeholder="輸入 SKU 或商品名稱" value="'+attr(state.stocktakeSearch)+'"><select class="ops-select" id="stocktakeSort"><option value="sku" '+(state.stocktakeSort==='sku'?'selected':'')+'>依商品編號</option><option value="stock" '+(state.stocktakeSort==='stock'?'selected':'')+'>庫存少的優先</option><option value="name" '+(state.stocktakeSort==='name'?'selected':'')+'>依名稱</option></select></div>'+mobileSearchPadHtml('stocktakeSearch')+'<div class="ops-stocktake-product-grid">'+products+'</div></section><section class="ops-card"><div class="ops-v8-section-head"><div><h2>本次盤點</h2><p>'+formatNumber(state.stocktakeCart.length)+' 項商品｜'+formatNumber(diffCount)+' 項有差異</p></div><button class="ops-button small ghost" type="button" data-action="stocktake-clear">清空</button></div><div class="ops-callout green"><b>盤點人：'+escapeHtml(userLabel())+'</b><br><span>管理端會依目前登入帳號自動記錄，不需要另外輸入姓名。</span></div><div class="ops-form-grid"><div class="ops-field full"><label>盤點備註</label><input class="ops-input" name="note" id="stocktakeNote" value="'+attr(state.stocktakeNote)+'"></div></div><div class="ops-stocktake-cart">'+cart+'</div><button class="ops-button primary ops-purchase-entry-submit" type="submit" '+(state.stocktakeCart.length?'':'disabled')+'>'+(correction?'確認盤點更正':'確認完成盤點')+'</button></section></div></form>';
  }
  async function saveStocktake(form){
    const operator=userLabel(),note=clean(new FormData(form).get('note'));
    const entries=state.stocktakeCart.map(function(item){const value=item.countedStock;return {productId:item.productId,countedStock:value===''||value==null?null:Math.max(0,Math.round(Number(value)))};}).filter(function(item){return item.countedStock!=null&&!Number.isNaN(item.countedStock);});if(!entries.length)throw new Error('至少輸入一項實際盤點數量');
    const correction=state.stocktakeCorrectionId?state.inventory.find(function(row){return row.id===state.stocktakeCorrectionId;}):null,stocktakeNo=correction?(correction.stocktakeNo||uid('COUNT-CORR')):uid('COUNT');
    await state.db.runTransaction(async function(tx){const refs=entries.map(function(item){return state.db.collection(COLLECTIONS.products).doc(item.productId);}),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));
      snaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品主檔不存在');const raw=snap.data()||{},entry=entries[index],current=Number(raw.currentStock||0),target=correction&&correction.productId===entry.productId?current+(entry.countedStock-Number(correction.afterStock||0)):entry.countedStock;if(target<0)throw new Error('更正後庫存不可小於 0');const latest=numberOrNull(firstValue(raw,['latestPurchaseCost','averageCost'])),adjusted=adjustFifoLayers(raw,target,latest,{layerId:uid('COUNT-LAYER'),receivedAt:new Date().toISOString(),referenceType:correction?'stocktakeCorrection':'stocktakeIncrease',referenceId:stocktakeNo}),ref=refs[index];tx.update(ref,{currentStock:target,costLayers:adjusted.layers,averageCost:adjusted.averageCost,inventoryValue:adjusted.inventoryValue,costIncomplete:adjusted.costIncomplete,updatedAt:serverTimestamp(),updatedBy:operator});queueInventorySyncInTransaction(tx,entry.productId,clean(raw.internalSku),target,correction?'stocktakeCorrection':'stocktake');const tRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(tRef,{type:'adjustment',productId:entry.productId,productName:clean(raw.internalName||raw.originalName||raw.onlineName),sku:clean(raw.internalSku),qtyChange:target-current,beforeStock:current,afterStock:target,unitCost:latest,costMethod:'FIFO',referenceType:correction?'stocktakeCorrection':'stocktake',referenceId:stocktakeNo,stocktakeNo:stocktakeNo,counterName:operator,source:'admin',correctionOf:correction?correction.id:'',note:note||'庫存盤點',occurredAt:new Date(),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
      if(correction){const oldRef=state.db.collection(COLLECTIONS.inventory).doc(correction.id);tx.set(oldRef,{correctedAt:serverTimestamp(),correctedBy:operator,correctedTo:entries[0].countedStock},{merge:true});}
    });await writeAudit(correction?'更正盤點紀錄':'完成庫存盤點','inventory',stocktakeNo,operator+'｜'+entries.length+' 項');resetStocktake();state.purchaseWorkspaceTab='history';location.hash='purchases';toast(correction?'盤點已更正':'盤點已完成',stocktakeNo,'success');await loadAll(true);
  }
  async function sha256Text(value){const bytes=new TextEncoder().encode(clean(value)),hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash)).map(function(byte){return byte.toString(16).padStart(2,'0');}).join('');}
  function openInventoryCountSettings(){
    const url=new URL('inventory-count.html',location.href).href;
    openDrawer('工讀生手機盤點入口','只有獨立手機入口會要求盤點密碼與盤點人姓名。預設密碼為 youZI，可在下方修改。','<form id="inventoryCountSettingsForm"><div class="ops-callout green"><b>盤點網址</b><br><span class="ops-break-url">'+escapeHtml(url)+'</span></div><div class="ops-form-grid"><div class="ops-field full"><label>入口狀態</label><select class="ops-select" name="enabled"><option value="true" '+(state.inventoryCountSettings.enabled!==false?'selected':'')+'>啟用</option><option value="false" '+(state.inventoryCountSettings.enabled===false?'selected':'')+'>停用</option></select></div><div class="ops-field full"><label>設定新密碼</label><input class="ops-input" type="password" inputmode="text" minlength="4" maxlength="20" autocapitalize="none" spellcheck="false" name="pin" placeholder="留白代表不變；預設為 youZI"></div></div><div class="ops-card-actions" style="justify-content:flex-start;margin-top:12px"><button class="ops-button ghost" type="button" data-action="inventory-count-copy">複製網址</button><button class="ops-button ghost" type="button" data-action="inventory-count-open">開啟手機盤點</button></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存設定</button></div></form>');
  }
  async function saveInventoryCountSettings(form){const data=new FormData(form),pin=clean(data.get('pin')),payload={enabled:data.get('enabled')!=='false',updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};if(pin){if(!/^[A-Za-z0-9]{4,20}$/.test(pin))throw new Error('盤點密碼請輸入 4 至 20 位英文字母或數字，並注意大小寫');payload.pinHash=await sha256Text(pin);}else if(!state.inventoryCountSettings.pinHash){payload.pinHash=await sha256Text('youZI');}await state.db.collection(COLLECTIONS.settings).doc('inventoryCount').set(payload,{merge:true});closeDrawer();toast('手機盤點設定已儲存','入口密碼已更新','success');await loadAll(true);}

  function purchaseDateKey(){
    const value=clean(state.purchaseDate);
    return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:todayDateKey();
  }
  function purchaseRangeBounds(){
    const now=new Date(),range=state.purchaseRange||'today';
    if(range==='all')return {start:null,end:null,label:'全部'};
    if(range==='month'){
      const selected=/^\d{4}-(0[1-9]|1[0-2])$/.test(clean(state.purchaseMonth))?state.purchaseMonth:dateText(now).slice(0,7),parts=selected.split('-').map(Number);
      return {start:new Date(parts[0],parts[1]-1,1),end:endOfDay(new Date(parts[0],parts[1],0)),label:parts[0]+' 年 '+parts[1]+' 月'};
    }
    if(range==='custom'){
      const from=clean(state.purchaseFrom),to=clean(state.purchaseTo);
      if(/^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to)&&from<=to)return {start:startOfDay(new Date(from+'T00:00:00')),end:endOfDay(new Date(to+'T00:00:00')),label:from+'～'+to};
    }
    const key=purchaseDateKey(),selected=new Date(key+'T00:00:00');
    return {start:startOfDay(selected),end:endOfDay(selected),label:key===todayDateKey()?'今天':key};
  }
  function purchaseRangeMatches(value,bounds){
    const date=dateFrom(value);if(!date)return false;
    if(bounds.start&&date<bounds.start)return false;
    if(bounds.end&&date>bounds.end)return false;
    return true;
  }
  function purchaseMetricLabels(){
    const range=state.purchaseRange||'today',today=purchaseDateKey()===todayDateKey();
    if(range==='month')return {purchase:'本月進貨',movement:'本月異動'};
    if(range==='all')return {purchase:'全部進貨',movement:'全部異動'};
    if(range==='custom')return {purchase:'區間進貨',movement:'區間異動'};
    return {purchase:today?'今日進貨':'當日進貨',movement:today?'今日異動':'當日異動'};
  }
  function purchaseRangeControlsHtml(){
    const monthValue=/^\d{4}-(0[1-9]|1[0-2])$/.test(clean(state.purchaseMonth))?state.purchaseMonth:dateText(new Date()).slice(0,7),year=Number(monthValue.slice(0,4))||new Date().getFullYear();
    const monthOptions=Array.from({length:12},function(_,index){const month=index+1,key=year+'-'+String(month).padStart(2,'0');return '<option value="'+attr(key)+'" '+(key===monthValue?'selected':'')+'>'+year+' 年 '+month+' 月</option>';}).join('');
    const tools='<div class="ops-platform-date-tools ops-inventory-date-tools"><button type="button" class="ops-platform-quick-button '+(state.purchaseRange==='today'&&purchaseDateKey()===todayDateKey()?'active':'')+'" data-action="purchase-range" data-range="today">今天</button><button type="button" class="ops-platform-quick-button" data-action="purchase-day-shift" data-step="-1">前一天</button><label class="ops-platform-date-input '+(state.purchaseRange==='today'?'active':'')+'"><span>查詢日期</span><input id="purchaseDate" type="date" value="'+attr(purchaseDateKey())+'"></label><button type="button" class="ops-platform-quick-button" data-action="purchase-day-shift" data-step="1">後一天</button><label class="ops-platform-month-select '+(state.purchaseRange==='month'?'active':'')+'"><span>月份</span><select id="purchaseMonth">'+monthOptions+'</select></label><button type="button" class="ops-platform-quick-button '+(state.purchaseRange==='all'?'active':'')+'" data-action="purchase-range" data-range="all">全部</button><button type="button" class="ops-platform-quick-button '+(state.purchaseRange==='custom'?'active':'')+'" data-action="purchase-range" data-range="custom">自訂區間</button></div>';
    const custom=state.purchaseRange==='custom'?'<div class="ops-platform-custom-range"><label>開始日期<input class="ops-input" id="purchaseFrom" type="date" value="'+attr(state.purchaseFrom)+'"></label><span>至</span><label>結束日期<input class="ops-input" id="purchaseTo" type="date" value="'+attr(state.purchaseTo)+'"></label><button type="button" class="ops-button primary" data-action="purchase-custom-apply">套用區間</button></div>':'';
    return '<section class="ops-card ops-inventory-range-card"><div class="ops-inventory-range-title"><h2>庫存日期查詢</h2><p>進貨金額、進貨單與庫存異動依實際發生日期計算。</p></div>'+tools+custom+'</section>';
  }
  function inventoryCostAnomalies(){
    return state.catalog.filter(function(product){return product.initialized;}).map(function(product){
      const stock=Number(product.currentStock||0),average=numberOrNull(product.averageCost),issues=[];
      if(stock<0)issues.push({code:'negative-stock',label:'負庫存',detail:'目前庫存為 '+formatNumber(stock)+'，需要盤點確認。',level:'red'});
      if(stock>0){
        if(average==null)issues.push({code:'missing-cost',label:'缺少成本',detail:'有庫存但沒有可用的 FIFO／平均成本。',level:'red'});
        else if(average===0&&product.zeroCostConfirmed!==true)issues.push({code:'zero-cost',label:'零成本待確認',detail:'平均成本為 0；若確實為贈品或零成本，可確認為正常。',level:'yellow'});
        if(product.costIncomplete===true)issues.push({code:'incomplete-layer',label:'成本層不完整',detail:'FIFO 成本層數量或單價尚未完整對應目前庫存。',level:'yellow'});
      }
      return issues.length?{product:product,issues:issues}:null;
    }).filter(Boolean).sort(function(a,b){
      const aRed=a.issues.some(function(issue){return issue.level==='red';}),bRed=b.issues.some(function(issue){return issue.level==='red';});
      return Number(bRed)-Number(aRed)||clean(a.product.sku).localeCompare(clean(b.product.sku),'zh-Hant',{numeric:true});
    });
  }
  async function confirmInventoryZeroCost(productId){
    const product=catalogById(productId);if(!product)throw new Error('找不到商品');
    const average=numberOrNull(product.averageCost);if(average!==0)throw new Error('此商品目前平均成本已不是 0，請重新整理');
    const confirmed=await confirmAction('確認正常零成本','確認「'+(product.originalName||product.name)+'」確實為零成本商品？確認後會從異常清單移除。','確認為正常');
    if(!confirmed)return;
    await state.db.collection(COLLECTIONS.products).doc(productId).set({zeroCostConfirmed:true,zeroCostConfirmedAt:serverTimestamp(),zeroCostConfirmedBy:userLabel(),updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});
    await writeAudit('確認零成本商品','product',productId,(product.originalName||product.name)+'｜SKU '+(product.sku||''));
    toast('已確認為正常零成本',product.originalName||product.name,'success');await loadAll(true);
  }
  function renderPurchases(){
    const bounds=purchaseRangeBounds(),labels=purchaseMetricLabels();
    const periodPurchases=state.purchases.filter(function(row){return purchaseRangeMatches(row.receivedAt,bounds);}),periodPurchaseTotal=sum(periodPurchases,function(row){return row.totalCost;});
    const periodInventory=state.inventory.filter(function(row){return purchaseRangeMatches(row.occurredAt,bounds);});
    const lowAll=state.catalog.filter(function(product){return product.initialized&&Number(product.currentStock||0)<=Number(product.safetyStock||0);}).sort(function(a,b){return Number(a.currentStock||0)-Number(b.currentStock||0);}),lowTerm=lower(state.purchaseLowSearch).trim(),lowRows=lowAll.filter(function(product){return !lowTerm||matchesSearch([product.originalName,product.name,product.sku,formatLabelSku(product.sku)],lowTerm);});
    const inventoryValue=sum(state.catalog,function(product){const explicit=numberOrNull(product.inventoryValue),average=numberOrNull(product.averageCost),stock=Math.max(0,Number(product.currentStock||0));return explicit!=null?explicit:(average==null?0:average*stock);});
    const recentPurchases=periodPurchases.slice().sort(function(a,b){return (dateFrom(b.receivedAt)||0)-(dateFrom(a.receivedAt)||0);}).slice(0,80),anomalies=inventoryCostAnomalies(),allowedTabs=['low','inbound','history','anomaly'];if(!allowedTabs.includes(state.purchaseWorkspaceTab))state.purchaseWorkspaceTab='inbound';
    function workTab(tab,label,count){return '<button type="button" class="is-'+attr(tab)+' '+(state.purchaseWorkspaceTab===tab?'active':'')+'" data-action="purchase-worktab" data-tab="'+tab+'">'+escapeHtml(label)+(count!=null?'<span>'+formatNumber(count)+'</span>':'')+'</button>';}
    function workAction(action,label,count,className){return '<button type="button" class="'+(className||'')+'" data-action="'+action+'">'+escapeHtml(label)+(count!=null?'<span>'+formatNumber(count)+'</span>':'')+'</button>';}
    let panel='';
    if(state.purchaseWorkspaceTab==='low'){
      const html=lowRows.length?'<div class="ops-v8-low-stock-list">'+lowRows.slice(0,80).map(function(product){const out=Number(product.currentStock||0)<=0;return '<div class="ops-v8-low-stock-row"><div><b>'+escapeHtml(product.originalName||product.name)+'</b><small>SKU '+escapeHtml(product.sku||'未設定')+'</small></div><strong class="'+(out?'danger':'warning')+'">'+formatNumber(product.currentStock)+' / 安全 '+formatNumber(product.safetyStock)+'</strong><span class="ops-tag '+(out?'red':'yellow')+'">'+(out?'缺貨':'偏低')+'</span><button class="ops-button small primary" data-action="purchase-this" data-id="'+attr(product.docId)+'">進貨</button></div>';}).join('')+'</div>':emptyHtml('目前沒有低庫存商品','所有商品都高於安全庫存。');panel='<div class="ops-v8-purchase-panel"><div class="ops-toolbar"><input class="ops-input grow" id="purchaseLowSearch" placeholder="搜尋低庫存商品或 SKU" value="'+attr(state.purchaseLowSearch)+'"></div>'+mobileSearchPadHtml('purchaseLowSearch')+html+'</div>';
    }else if(state.purchaseWorkspaceTab==='inbound'){
      const table=recentPurchases.length?'<div class="ops-purchase-card-list">'+recentPurchases.map(function(row){const qty=sum(row.items||[],function(item){return item.qty;}),paid=row.paymentStatus==='paid';return '<article class="ops-purchase-history-card"><div class="ops-purchase-history-main"><div><b>'+escapeHtml(row.purchaseNo||row.id)+'</b><small>'+escapeHtml(dateTimeText(row.receivedAt))+(row.externalNo?'｜外部 '+escapeHtml(row.externalNo):'')+'</small></div><div><span>供應商</span><strong>'+escapeHtml(row.supplier||'未填供應商')+'</strong></div><div><span>品項／件數</span><strong>'+formatNumber((row.items||[]).length)+' 項／'+formatNumber(qty)+' 件</strong></div><div><span>總成本</span><strong>'+money(row.totalCost)+'</strong></div><div>'+statusTag(paid?'已付款':'未付款',paid?'green':'yellow')+(paid&&row.paymentDate?'<small>'+escapeHtml(dateText(row.paymentDate))+'</small>':'')+'</div><button class="ops-button small primary" data-action="purchase-edit" data-id="'+attr(row.id)+'">修改</button></div></article>';}).join('')+'</div>':emptyHtml('所選期間沒有進貨單','點上方「進貨入庫」可直接建立新進貨單。');panel='<div class="ops-v8-purchase-panel"><div class="ops-v8-inbound-summary"><div><span>'+escapeHtml(labels.purchase)+'</span><b>'+money(periodPurchaseTotal)+'</b><small>'+formatNumber(periodPurchases.length)+' 張進貨單</small></div><div><span>供應商資料庫</span><b>'+formatNumber(state.suppliers.length)+' 家</b><small>保留聯絡與付款資料</small></div><button class="ops-button ghost" data-action="supplier-manager">管理供應商</button></div><div class="ops-v8-subsection-head"><h3>所選期間進貨單</h3></div>'+table+'</div>';
    }else if(state.purchaseWorkspaceTab==='anomaly'){
      const rows=anomalies.length?'<div class="ops-inventory-anomaly-list">'+anomalies.map(function(entry){const product=entry.product,average=numberOrNull(product.averageCost),zeroIssue=entry.issues.some(function(issue){return issue.code==='zero-cost';}),negative=entry.issues.some(function(issue){return issue.code==='negative-stock';});return '<article class="ops-inventory-anomaly-row"><div class="ops-inventory-anomaly-main"><div><b>'+escapeHtml(product.originalName||product.name)+'</b><small>SKU '+escapeHtml(product.sku||'未設定')+'</small></div><div class="ops-inventory-anomaly-numbers"><span>庫存 <b>'+formatNumber(product.currentStock)+'</b></span><span>平均成本 <b>'+(average==null?'待補':money(Math.round(average)))+'</b></span></div></div><div class="ops-inventory-anomaly-issues">'+entry.issues.map(function(issue){return '<div class="ops-inventory-anomaly-issue '+issue.level+'">'+statusTag(issue.label,issue.level)+'<span>'+escapeHtml(issue.detail)+'</span></div>';}).join('')+'</div><div class="ops-inventory-anomaly-actions">'+(zeroIssue?'<button class="ops-button small ghost" data-action="inventory-zero-cost-confirm" data-id="'+attr(product.docId)+'">確認為正常零成本</button>':'')+(negative?'<button class="ops-button small ghost" data-action="inventory-anomaly-stocktake" data-id="'+attr(product.docId)+'">前往盤點</button>':'')+'<button class="ops-button small primary" data-action="inventory-anomaly-product" data-id="'+attr(product.docId)+'" data-sku="'+attr(product.sku)+'">修改商品資料</button></div></article>';}).join('')+'</div>':emptyHtml('目前沒有庫存異常','零成本已確認、成本層完整且沒有負庫存。');panel='<div class="ops-v8-purchase-panel"><div class="ops-callout yellow"><b>異常判斷</b><br><span>有庫存卻缺少成本、零成本尚未確認、FIFO 成本層不完整或負庫存，會集中顯示在這裡。</span></div>'+rows+'</div>';
    }else{
      const term=lower(state.inventorySearch),inventoryRows=periodInventory.filter(function(row){return !term||lower([row.productName,row.sku,row.referenceId,row.note].join(' ')).includes(term);}).sort(function(a,b){return (dateFrom(b.occurredAt)||0)-(dateFrom(a.occurredAt)||0);}).slice(0,300);panel='<div class="ops-v8-purchase-panel"><div class="ops-toolbar"><input class="ops-input grow" id="inventorySearch" placeholder="搜尋商品、SKU、來源或備註" value="'+attr(state.inventorySearch)+'"></div>'+mobileSearchPadHtml('inventorySearch')+(inventoryRows.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>時間</th><th>類型</th><th>商品</th><th class="num">異動</th><th class="num">異動後</th><th>來源／備註</th></tr></thead><tbody>'+inventoryRows.map(function(row){return '<tr><td>'+escapeHtml(dateTimeText(row.occurredAt))+'</td><td>'+escapeHtml(row.referenceType||row.type)+'</td><td><b>'+escapeHtml(row.productName)+'</b><br><small>'+escapeHtml(row.sku)+'</small></td><td class="num">'+(row.qtyChange>0?'+':'')+formatNumber(row.qtyChange)+'</td><td class="num">'+formatNumber(row.afterStock)+'</td><td>'+escapeHtml(row.referenceId)+'<br><small>'+escapeHtml(row.note)+'</small></td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('所選期間沒有庫存異動','請更換日期或查詢區間。'))+'</div>';
    }
    const metrics='<div class="ops-kpi-grid ops-v8-purchase-kpis">'+kpi(labels.purchase,money(periodPurchaseTotal),periodPurchases.length+' 張進貨單','⇧')+kpi('低庫存待補',formatNumber(lowAll.length),'目前即時庫存','!')+kpi('庫存價值',money(inventoryValue),'目前 FIFO 庫存成本','＄')+kpi(labels.movement,formatNumber(periodInventory.length),'入庫、銷售與盤點','↕')+'</div>';
    const tabs='<div class="ops-v8-worktabs">'+workAction('open-purchase','進貨入庫',null,state.purchaseWorkspaceTab==='inbound'?'active':'')+workAction('open-adjustment','庫存盤點')+workTab('low','待補待辦',lowAll.length)+workTab('history','異動記錄')+workAction('inventory-count-settings','工讀生手機入口／密碼',null,'utility')+workTab('anomaly','異常',anomalies.length)+'</div>';
    return purchaseRangeControlsHtml()+metrics+'<section class="ops-card ops-v8-purchase-workbench"><div class="ops-v8-section-head"><div><h2>進貨與庫存作業</h2><p>進貨、盤點、待補、異動與成本異常集中管理</p></div></div>'+tabs+panel+'</section>';
  }

  function rentalStatusText(rental){
    const status=clean(rental&&rental.status),days=daysUntil(rental&&rental.endDate);
    if(days!==null&&days<0)return '已到期';
    if(days!==null&&days<=30&&rentalIsEstablished(rental))return '即將到期';
    return status||'未設定';
  }
  function rentalIsCancelled(rental){
    const text=lower([rental&&rental.status,rental&&rental.raw&&rental.raw.stage].filter(Boolean).join(' '));
    return ['已取消','取消申請','作廢','已封存','封存','archived','cancelled','canceled'].some(function(word){return text.includes(word);});
  }
  function rentalIsEstablished(rental){
    if(!rental||rentalIsCancelled(rental))return false;
    const raw=rental.raw||{};
    if(rental.incomeRecognizedAt||raw.rentalIncomeReceived===true||raw.officialConfirmedAt||raw.rentalIncomeRecognizedAt||raw.officialContractNoticeQueueCreatedAt||raw.officialContractNoticeSentAt)return true;
    const text=lower(rental.status);
    return ['租賃中','租用中','已成立','待配送 / 待安裝','待配送','待安裝','到期提醒中','續約詢問中','續約待付款','續約待確認','退租申請中','退租待安排','已退租','active','confirmed','completed','returned'].some(function(word){return text.includes(word);});
  }
  function rentalIsActive(rental){
    if(!rentalIsEstablished(rental))return false;
    const text=lower(rental.status);
    if(['已退租','退租完成','cancelled','canceled','completed','returned'].some(function(word){return text.includes(word);}))return false;
    const end=dateFrom(rental.endDate);
    return !end||end>=startOfDay(new Date());
  }
  function mergedRentals(){
    const ledgers=new Map(state.rentalLedgers.map(function(x){return [x.rentalContractId,x];}));
    return state.rentals.map(function(r){const ledger=ledgers.get(r.id)||ledgers.get(r.contractNo)||null;return Object.assign({},r,{ledger:ledger,expectedIncome:Number(r.incomeAmount||0)||Number(r.rentFee||0)+Number(r.shippingFee||0)});});
  }
  function renderRentals(){
    const term=lower(state.rentalSearch);
    const rows=mergedRentals().filter(function(r){return !rentalIsCancelled(r);}).filter(function(r){return !term||lower([r.contractNo,r.customer,r.equipment,r.brand,r.model,r.assetNo,r.status].join(' ')).includes(term);}).sort(function(a,b){return (dateFrom(b.incomeRecognizedAt||b.raw&&b.raw.updatedAtText||b.startDate)||0)-(dateFrom(a.incomeRecognizedAt||a.raw&&a.raw.updatedAtText||a.startDate)||0);});
    const established=rows.filter(rentalIsEstablished),totalIncome=sum(established,function(r){return r.expectedIncome;}),active=established.filter(rentalIsActive),due=active.filter(function(r){const d=daysUntil(r.endDate);return d!==null&&d>=0&&d<=30;});
    const table=rows.length?'<div class="ops-table-wrap"><table class="ops-table ops-rental-operations-table"><thead><tr><th>日期／合約</th><th>客戶</th><th>設備</th><th>租期／到期</th><th class="num">租賃收入</th><th>狀態</th></tr></thead><tbody>'+rows.map(function(r){const isEstablished=rentalIsEstablished(r),d=daysUntil(r.endDate),status=rentalStatusText(r),color=!isEstablished?'gray':d!==null&&d<0?'blue':d!==null&&d<=30?'yellow':'green';return '<tr><td>'+escapeHtml(dateText(r.incomeRecognizedAt||r.raw&&r.raw.updatedAtText||r.startDate))+'<br><small>'+escapeHtml(r.contractNo)+'</small></td><td><b>'+escapeHtml(r.customer)+'</b><br><small>'+escapeHtml(r.phone)+'</small></td><td><b>'+escapeHtml([r.brand,r.model].filter(Boolean).join(' ')||r.equipment)+'</b><br><small>'+escapeHtml(r.assetNo||r.equipment)+'</small></td><td>'+escapeHtml(dateText(r.startDate))+'<br><small>至 '+escapeHtml(dateText(r.endDate))+'</small></td><td class="num">'+(isEstablished?'<b>'+money(r.expectedIncome)+'</b><br><small>租金 '+money(r.rentFee)+'＋運費 '+money(r.shippingFee)+'；押金不計</small>':'<b>—</b><br><small>流程中，尚未列入收入</small>')+'</td><td>'+statusTag(status,color)+(isEstablished?'<small class="ops-rental-income-note">已列入租賃收入</small>':'<small class="ops-rental-income-note muted">保留顯示，尚未成立</small>')+'</td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('尚無租賃合約資料','目前 rentalContracts 沒有可顯示的合約；可按右上角進入原租賃管理確認。');
    return '<div class="ops-kpi-grid ops-rental-kpis">'+kpi('租賃收入',money(totalIncome),'已成立合約的租金＋運費','＄')+kpi('成立合約',formatNumber(established.length),'押金不列入收入','約')+kpi('租用中',formatNumber(active.length),'目前仍在租期內','租')+kpi('30 日內到期',formatNumber(due.length),'需要安排續租或退租','!')+'</div><section class="ops-card"><div class="ops-card-head"><div><h2>租賃營運</h2><p>已成立合約才計入租賃收入；流程中的合約仍保留在清單，不會再整頁顯示空白。</p></div><div class="ops-card-actions">'+(due.length?statusTag('30 日內到期 '+due.length+' 件','yellow'):'')+'<a class="ops-button ghost" href="rental-system-hub.html">原租賃管理</a></div></div><div class="ops-toolbar"><input class="ops-input grow" id="rentalSearch" placeholder="搜尋合約、客戶、設備、品牌或型號" value="'+attr(state.rentalSearch)+'"></div>'+table+'</section>';
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
    return '<div class="ops-toolbar"><select class="ops-select" id="financeRange"><option value="today">今天</option><option value="7d">最近 7 天</option><option value="month">本月</option><option value="year">本年</option></select><button class="ops-button primary" data-action="expense-new">新增支出</button><button class="ops-button ghost" data-action="export-finance">匯出收支 CSV</button></div><div class="ops-kpi-grid">'+kpi('商品銷售收入',money(salesRevenue),sales.length+' 筆現場銷售','＄')+kpi('快速收入',money(quick),incomes.length+' 筆非商品收入','＋')+kpi('商品成本',money(cogs),'售出商品成本','成本')+kpi('一般支出',money(general),expenses.length+' 筆支出','－')+kpi('期間暫估損益',money(profit),'收入－成本－一般支出','↗')+kpi('商品毛利率',percentage(salesRevenue?((salesRevenue-cogs)/salesRevenue*100):0),'不含快速收入與一般支出','%')+'</div><div class="ops-grid-2"><section class="ops-card"><div class="ops-card-head"><div><h2>期間損益結構</h2></div></div><div class="ops-summary-list">'+sourceRows.map(function(x,i){return '<div class="ops-summary-line '+(i===sourceRows.length-1?'':'')+'"><span>'+escapeHtml(x[0])+'</span><b>'+money(x[1])+'</b></div>';}).join('')+'<div class="ops-summary-line total"><span>暫估損益</span><b>'+money(profit)+'</b></div></div></section><section class="ops-card"><div class="ops-card-head"><div><h2>租賃與案件概況</h2></div></div><div class="ops-summary-list"><div class="ops-summary-line"><span>租賃已收款</span><b>'+money(sum(state.rentalLedgers,function(x){return x.receivedAmount;}))+'</b></div><div class="ops-summary-line"><span>租賃直接成本</span><b>'+money(sum(state.rentalLedgers,function(x){return x.deliveryCost+x.maintenanceCost+x.otherCost;}))+'</b></div><div class="ops-summary-line"><span>案件已收款</span><b>'+money(sum(state.cases,function(x){return x.receivedAmount;}))+'</b></div><div class="ops-summary-line"><span>案件直接成本</span><b>'+money(sum(state.cases,function(x){return x.totalCost;}))+'</b></div></div></section></div><section class="ops-card" style="margin-top:15px"><div class="ops-card-head"><div><h2>一般支出明細</h2></div></div>'+expenseTable+'</section>';
  }


function platformOrderDateKey(){
  const value=clean(state.platformOrderDate);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:todayDateKey();
}
function platformOrderBounds(){
  const now=new Date(),range=state.platformOrderRange||'today';let start=null,end=null,label='今天';
  if(range==='all')return {start:null,end:null,label:'全部'};
  if(range==='month'){
    const selected=/^\d{4}-(0[1-9]|1[0-2])$/.test(clean(state.platformOrderMonth))?state.platformOrderMonth:dateText(now).slice(0,7),parts=selected.split('-').map(Number);
    start=new Date(parts[0],parts[1]-1,1);end=endOfDay(new Date(parts[0],parts[1],0));label=parts[0]+' 年 '+parts[1]+' 月';
    return {start:start,end:end,label:label};
  }
  if(range==='custom'){
    const from=clean(state.platformOrderFrom),to=clean(state.platformOrderTo);
    if(/^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to)&&from<=to){
      start=startOfDay(new Date(from+'T00:00:00'));end=endOfDay(new Date(to+'T00:00:00'));label=from+'～'+to;
      return {start:start,end:end,label:label};
    }
  }
  const key=platformOrderDateKey(),selected=new Date(key+'T00:00:00');start=startOfDay(selected);end=endOfDay(selected);label=key===todayDateKey()?'今天':key;
  return {start:start,end:end,label:label};
}
function platformOrderGross(row){
  const gross=Math.max(0,Number(row&&row.grossAmount||0));
  if(gross>0)return gross;
  return Math.max(0,Number(row&&row.unitPrice||0)*Math.max(0,Number(row&&row.quantity||0)));
}
function platformOrderCost(row){return Math.max(0,Number(row&&row.costTotal||0));}
// 未付款／unpaid 可能只是 EasyStore 貨到付款的正常付款進度，不能當成取消。
const PLATFORM_CANCEL_KEYWORDS=['取消','客戶取消','買家取消','賣家取消','已取消','取消完成','作廢','已作廢','無效','未成立','交易失敗','付款失敗','付款逾期','逾期未付','cancel','canceled','cancelled','cancellation','void','voided','failed','failure','expired','payment failed'];
const PLATFORM_RETURN_KEYWORDS=['退貨','退款','拒收','退回','refund','refunded','return','returned'];
const PLATFORM_FULFILLMENT_KEYWORDS=['出貨確認','已出貨','出貨完成','配送中','配送結束','已配送','送達','已送達','已收貨','已簽收','shipped','shipping','departure','delivering','delivered','final_delivery','final delivery','delivery completed'];
function platformOrderStatusText(row){return lower([row&&row.orderStatus,row&&row.paymentStatus,row&&row.note,row&&row.reversalReason,row&&row.cancellationReason].filter(Boolean).join(' '));}
function platformOrderHasFulfillment(row){
  if(!row)return false;
  if(dateFrom(row.shippedAt)||dateFrom(row.completedAt))return true;
  const text=platformOrderStatusText(row);
  return PLATFORM_FULFILLMENT_KEYWORDS.some(function(keyword){return text.includes(keyword);});
}
function platformOrderHasReturnRequest(row){return !!row&&PLATFORM_RETURN_KEYWORDS.some(function(keyword){return platformOrderStatusText(row).includes(keyword);});}
function platformOrderIsCancelledState(row){
  if(!row)return false;
  if(row.reversalApplied===true||row.inventoryReversed===true)return true;
  if(['ignored-cancelled','inventory-reversed'].includes(clean(row.processingStatus)))return true;
  // 未出貨的「退貨／退款」就是取消訂單，不能留在今天或退貨清單。
  if(platformOrderHasReturnRequest(row)&&!platformOrderHasFulfillment(row)&&clean(row.returnHandlingStatus)!=='completed')return true;
  return PLATFORM_CANCEL_KEYWORDS.some(function(keyword){return platformOrderStatusText(row).includes(keyword);});
}
function platformOrderHasReliableOrderDate(row){
  if(!row)return false;
  const ordered=dateFrom(row.orderedAt);if(!ordered)return false;
  const source=lower(row.orderDateSource);
  // 平台明確提供的原始時間（尤其 EasyStore created_at）本身就是可信依據；
  // 不再讓舊資料的 false 標記覆蓋它。
  if(['easystore-created-at','coupang-ordered-at','momo-api-order-date','momo-order-number-inferred','agent-order-time-validated'].includes(source))return true;
  if(row.hasOriginalOrderDate===false)return false;
  // 舊版只寫 platform 時，僅在能證明它不是同步當下時間時暫時保留；其餘來源一律不進入「今天」。
  if(source==='platform'&&row.hasOriginalOrderDate===true){const seen=dateFrom(row.firstSeenAt||row.lastSeenAt);return !!seen&&!platformOrderLooksLikeSyncTime(row,row.orderedAt);}
  return false;
}
function platformOrderPlacedAtText(row){
  if(!row)return '—';
  if(row.orderTimeEstimated===true)return dateText(row.orderedAt)+'（MOMO 訂單編號日期）';
  return dateTimeText(row.orderedAt);
}
function platformOrderIsHidden(row){
  if(!row)return true;
  const status=clean(row.processingStatus);
  if(!platformOrderHasReliableOrderDate(row))return true;
  if(platformOrderIsCancelledState(row))return true;
  // 單次同步暫時漏抓時仍保留原成交紀錄；只有明確取消，或後端連續確認不存在並完成回補後才移除。
  return ['ignored','ignored-freight','ignored-missing-order-date'].includes(status);
}
function platformOrderRevisionTime(row){
  const value=row&&(row.statusUpdatedAt||row.lastSeenAt||row.updatedAt||row.reversedAt||row.orderedAt),date=dateFrom(value);
  return date?date.getTime():0;
}
function platformOrderDisplayKey(row){
  const platform=lower(row&&row.platform),order=clean(row&&(row.externalOrderNo||row.externalOrderId||row.id)),sku=lower(row&&(row.sku||row.productName)),variant=lower(row&&row.variantName);
  return [platform,order,sku,variant].join('|');
}
function dedupePlatformOrders(rows){
  const map=new Map();
  (rows||[]).forEach(function(row){
    const key=platformOrderDisplayKey(row),previous=map.get(key);
    if(!previous){map.set(key,row);return;}
    const previousCancelled=platformOrderIsCancelledState(previous),currentCancelled=platformOrderIsCancelledState(row);
    if(currentCancelled&&!previousCancelled){map.set(key,row);return;}
    if(previousCancelled&&!currentCancelled)return;
    const previousTime=platformOrderRevisionTime(previous),currentTime=platformOrderRevisionTime(row);
    if(currentTime>previousTime){map.set(key,row);return;}
    if(currentTime===previousTime&&row.inventoryApplied===true&&previous.inventoryApplied!==true)map.set(key,row);
  });
  return Array.from(map.values());
}
function visiblePlatformOrders(rows){return dedupePlatformOrders(rows).filter(function(row){return !platformOrderIsHidden(row);});}
function platformOrderIsEffective(row){
  // 一般「今天」訂單只代表當日仍成立的成交；退貨、退款、取消都不再混入。
  return !!row&&!platformOrderIsHidden(row)&&!platformOrderHasReturn(row)&&row.reversalApplied!==true&&row.inventoryReversed!==true&&!['inventory-reversed','ignored-return'].includes(clean(row.processingStatus));
}
function platformOrderNeedsAttention(row){
  return !platformOrderIsHidden(row)&&['missing-sku','unmatched-sku','duplicate-sku','error','missing-from-platform-review','reversal-error','manual-return-review'].includes(clean(row&&row.processingStatus));
}
function platformOrderProcessingLabel(row){
  const map={'inventory-applied':'已扣中央庫存','already-applied':'已處理','dry-run':'有效訂單／尚未扣庫存','unmatched-sku':'SKU 未配對','duplicate-sku':'SKU 重複','missing-sku':'缺少 SKU','ignored':'已排除','ignored-freight':'運費已排除','ignored-cancelled':'未成交／取消，未扣庫存','ignored-return':'退貨狀態，未扣庫存','manual-return-review':'退貨／退款請手動處理','return-processed':'退貨已完成處理','missing-from-platform-review':'平台本次未再出現，等待複核','inventory-reversed':'取消／未付款，庫存已回補','reversal-error':'取消回補失敗','error':'處理失敗'};
  return map[row.processingStatus]||row.processingStatus||'待處理';
}
function platformOrderHasReturn(row){
  if(!row)return false;
  if(clean(row.processingStatus)==='return-processed'||clean(row.returnHandlingStatus)==='completed')return true;
  return platformOrderHasFulfillment(row)&&platformOrderHasReturnRequest(row);
}
function platformReturnRows(rows){
  // 退貨是獨立待處理工作，不受一般成交清單的「有效訂單」規則影響。
  return dedupePlatformOrders(rows).filter(function(row){return !platformOrderIsCancelledState(row)&&platformOrderHasReturn(row);});
}
function platformReturnDispositionLabel(value){
  return ({waiting:'尚未收到商品',restock:'恢復正常庫存',defective:'瑕疵品／展示品',inspect:'待檢查／送修',scrap:'報廢',supplier:'退回供應商'})[clean(value)]||'尚未處理';
}
function platformOrderProcessingColor(row){
  if(row.processingStatus==='return-processed')return 'green';
  if(row.processingStatus==='inventory-reversed')return 'blue';
  if(platformOrderNeedsAttention(row))return row.processingStatus==='manual-return-review'||row.processingStatus==='missing-from-platform-review'?'yellow':'red';
  if(row.processingStatus==='dry-run')return 'yellow';
  if(platformOrderIsEffective(row))return 'green';
  if(['ignored','ignored-freight','ignored-cancelled','ignored-return'].includes(row.processingStatus))return 'yellow';
  return 'blue';
}
function nextPlatformSyncText(){
  const now=new Date(),candidates=[[14,0],[20,30]].map(function(parts){const d=new Date(now);d.setHours(parts[0],parts[1],0,0);return d;});
  let next=candidates.find(function(d){return d>now;});
  if(!next){next=new Date(now);next.setDate(next.getDate()+1);next.setHours(14,0,0,0);}
  return dateTimeText(next);
}

function platformFeeConfig(name){return Object.assign({},DEFAULT_PLATFORM_FEE_SETTINGS[name]||{},state.platformFeeSettings[name]||{});}
function platformMonthKey(value){const d=dateFrom(value);if(!d)return '';return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
function platformOrderGroupKey(row){return clean(row.platform)+'|'+(clean(row.externalOrderNo)||clean(row.externalOrderId)||clean(row.id));}
function platformFeeMetrics(rows){
  const allValid=visiblePlatformOrders(state.platformOrders).filter(platformOrderIsEffective),monthGroups={};
  allValid.forEach(function(row){const key=row.platform+'|'+platformMonthKey(row.orderedAt);if(!monthGroups[key])monthGroups[key]=[];monthGroups[key].push(row);});
  let gross=0,variableFees=0,fixedFees=0,cost=0,profit=0;
  const perRow=new Map(),monthlyOnlyApplied=new Set();
  rows.forEach(function(row){
    const key=row.platform+'|'+platformMonthKey(row.orderedAt),monthRows=monthGroups[key]||[row],cfg=platformFeeConfig(row.platform),rate=(Number(cfg.commissionRate||0)+Number(cfg.paymentRate||0))/100,fixed=Math.max(0,Number(cfg.monthlyFixedFee||0))+Math.max(0,Number(cfg.monthlyAdvertisingFee||0)),rowGross=platformOrderGross(row),monthGross=sum(monthRows,platformOrderGross),variable=rowGross*rate;let allocated=0;
    if(cfg.allocationMethod==='order_count'){
      const orderKeys=Array.from(new Set(monthRows.map(platformOrderGroupKey))),orderCount=Math.max(1,orderKeys.length),orderKey=platformOrderGroupKey(row),sameOrder=monthRows.filter(function(x){return platformOrderGroupKey(x)===orderKey;}),orderGross=sum(sameOrder,platformOrderGross),orderShare=fixed/orderCount;
      allocated=orderGross>0?orderShare*(rowGross/orderGross):orderShare/Math.max(1,sameOrder.length);
    }else if(cfg.allocationMethod==='sales_amount'&&monthGross>0)allocated=fixed*(rowGross/monthGross);
    const rowCost=platformOrderCost(row),net=rowGross-variable-allocated,p=net-rowCost;
    perRow.set(row.id,{gross:rowGross,variableFee:variable,fixedFee:allocated,net:net,cost:rowCost,profit:p});
    gross+=rowGross;variableFees+=variable;fixedFees+=allocated;cost+=rowCost;profit+=p;
    if(cfg.allocationMethod==='monthly_only'&&!monthlyOnlyApplied.has(key)){monthlyOnlyApplied.add(key);fixedFees+=fixed;profit-=fixed;}
  });
  return {gross:gross,variableFees:variableFees,fixedFees:fixedFees,cost:cost,net:gross-variableFees-fixedFees,profit:profit,perRow:perRow};
}

function platformOrderRowsByGroupKey(key){
  return visiblePlatformOrders(state.platformOrders).filter(function(row){return platformOrderGroupKey(row)===key;}).sort(function(a,b){return clean(a.sku).localeCompare(clean(b.sku),'zh-Hant');});
}
function platformOrderFirstDate(rows,field,useLatest){
  const values=(rows||[]).map(function(row){return dateFrom(row&&row[field]);}).filter(Boolean).sort(function(a,b){return a-b;});
  if(!values.length)return null;
  return useLatest?values[values.length-1]:values[0];
}
function platformOrderFirstNumber(rows,field){
  for(const row of rows||[]){const value=numberOrNull(row&&row[field]);if(value!=null)return value;}
  return null;
}
function platformOrderDetailDate(label,value,dateOnly){return '<div class="ops-order-timeline-row"><span>'+escapeHtml(label)+'</span><b>'+(value?escapeHtml(dateOnly?dateText(value)+'（MOMO 訂單編號日期）':dateTimeText(value)):'尚無資料')+'</b></div>';}
function openPlatformOrderDetail(groupKey){
  const rows=platformOrderRowsByGroupKey(groupKey);if(!rows.length)return toast('找不到訂單','請重新整理後再試。','warning');
  const first=rows[0],effective=rows.filter(platformOrderIsEffective),metrics=platformFeeMetrics(effective),gross=sum(rows,platformOrderGross),estimatedNet=metrics.net,actualSettled=platformOrderFirstNumber(rows,'actualSettledAmount'),refundAmount=platformOrderFirstNumber(rows,'refundAmount'),pendingAmount=actualSettled==null?estimatedNet:Math.max(0,estimatedNet-actualSettled),qty=sum(rows,function(row){return row.quantity;});
  const statusText=Array.from(new Set(rows.map(function(row){return [row.paymentStatus,row.orderStatus].filter(Boolean).join('／');}).filter(Boolean))).join('、')||'平台未提供';
  const timeline='<div class="ops-order-detail-section"><h3>交易時間</h3><div class="ops-order-timeline">'+platformOrderDetailDate('下單日期',platformOrderFirstDate(rows,'orderedAt',false),rows.some(function(row){return row.orderTimeEstimated===true;}))+platformOrderDetailDate('付款日期',platformOrderFirstDate(rows,'paidAt',false))+platformOrderDetailDate('出貨日期',platformOrderFirstDate(rows,'shippedAt',false))+platformOrderDetailDate('完成日期',platformOrderFirstDate(rows,'completedAt',true))+platformOrderDetailDate('平台撥款日期',platformOrderFirstDate(rows,'settledAt',true))+platformOrderDetailDate('退款日期',platformOrderFirstDate(rows,'refundedAt',true))+'</div></div>';
  const finance='<div class="ops-order-detail-section"><h3>金額狀態</h3><div class="ops-order-money-grid"><div><span>商品成交金額</span><b>'+money(gross)+'</b></div><div><span>預估平台與金流費</span><b>'+money(metrics.variableFees+metrics.fixedFees)+'</b></div><div><span>預估可收金額</span><b>'+money(estimatedNet)+'</b></div><div><span>實際入帳金額</span><b>'+(actualSettled==null?'尚未確認':money(actualSettled))+'</b></div><div><span>待入帳金額</span><b>'+money(pendingAmount)+'</b></div><div><span>退款金額</span><b>'+(refundAmount==null?'尚無資料':money(refundAmount))+'</b></div></div><p class="ops-order-detail-note">「預估可收」依目前平台費用設定計算；「實際入帳」只有平台有回傳撥款資料時才顯示，不會自行猜測。</p></div>';
  const itemHtml=rows.map(function(row){
    const returnState=clean(row.returnHandlingStatus),returnText=returnState?(returnState==='waiting-return'?'等待商品退回':platformReturnDispositionLabel(row.returnDisposition)):(platformOrderHasReturn(row)?'退貨待處理':'無退貨');
    const canHandle=platformOrderHasReturn(row)&&returnState!=='completed';
    return '<article class="ops-order-item-detail"><div class="ops-order-item-main"><div><b>'+escapeHtml(row.productName)+'</b><small>'+escapeHtml((row.sku?'SKU '+row.sku:'缺少 SKU')+(row.variantName?'・'+row.variantName:''))+'</small></div><div class="ops-order-item-numbers"><span>'+formatNumber(row.quantity)+' 件</span><b>'+money(platformOrderGross(row))+'</b></div></div><div class="ops-order-item-status">'+statusTag(platformOrderProcessingLabel(row),platformOrderProcessingColor(row))+(platformOrderHasReturn(row)?statusTag(returnText,returnState==='completed'?'green':'yellow'):'')+'</div>'+(row.returnNote?'<p>'+escapeHtml(row.returnNote)+'</p>':'')+(canHandle?'<button class="ops-button small primary" type="button" data-action="platform-return-open" data-id="'+attr(row.id)+'">處理退貨</button>':'')+'</article>';
  }).join('');
  const basic='<div class="ops-order-detail-section"><h3>訂單基本資料</h3><div class="ops-order-basic-grid"><div><span>平台</span><b>'+escapeHtml(first.platform||'—')+'</b></div><div><span>訂單編號</span><b>'+escapeHtml(first.externalOrderNo||'—')+'</b></div><div><span>客戶</span><b>'+escapeHtml(first.customerName||'尚無資料')+'</b></div><div><span>目前狀態</span><b>'+escapeHtml(statusText)+'</b></div><div><span>商品項目</span><b>'+formatNumber(rows.length)+' 項</b></div><div><span>總件數</span><b>'+formatNumber(qty)+' 件</b></div></div></div>';
  openDrawer('網路訂單細項',first.platform+'｜'+(first.externalOrderNo||'未提供訂單編號'),basic+timeline+finance+'<div class="ops-order-detail-section"><h3>成交商品</h3><div class="ops-order-items">'+itemHtml+'</div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">關閉</button></div>');
}
function openPlatformReturn(rowId){
  const row=state.platformOrders.find(function(item){return item.id===rowId;});if(!row)return toast('找不到退貨商品','請重新整理後再試。','warning');
  const maxQty=Math.max(1,Math.round(Number(row.quantity||1))),current=clean(row.returnDisposition)||'waiting';
  const options=[['waiting','尚未收到商品'],['restock','恢復正常庫存'],['defective','瑕疵品／展示品'],['inspect','待檢查／送修'],['scrap','報廢'],['supplier','退回供應商']].map(function(item){return '<option value="'+item[0]+'"'+(current===item[0]?' selected':'')+'>'+item[1]+'</option>';}).join('');
  openDrawer('處理網路退貨',row.platform+'｜'+(row.externalOrderNo||'未提供訂單編號'),'<form id="platformReturnForm" data-id="'+attr(row.id)+'"><div class="ops-callout"><b>'+escapeHtml(row.productName)+'</b><br><span>'+escapeHtml((row.sku?'SKU '+row.sku:'缺少 SKU')+'・原訂單 '+formatNumber(row.quantity)+' 件')+'</span></div><div class="ops-form-grid"><div class="ops-field"><label>退貨數量</label><input class="ops-input" type="number" min="1" max="'+maxQty+'" step="1" name="quantity" value="'+attr(row.returnQuantity||maxQty)+'" required></div><div class="ops-field"><label>處理方式</label><select class="ops-select" name="disposition">'+options+'</select></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note" placeholder="可留空；例如外盒損傷、等待物流退回">'+escapeHtml(row.returnNote||'')+'</textarea></div></div><div class="ops-callout yellow">選「尚未收到商品」不會調整任何庫存；只有「恢復正常庫存」會增加可銷售庫存。</div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="platform-order-detail" data-key="'+attr(platformOrderGroupKey(row))+'">返回訂單</button><button class="ops-button primary" type="submit">確認處理</button></div></form>');
}
async function savePlatformReturn(form){
  const id=clean(form.dataset.id),row=state.platformOrders.find(function(item){return item.id===id;});if(!row)throw new Error('找不到原始平台訂單');
  const data=new FormData(form),disposition=clean(data.get('disposition'))||'waiting',quantity=Math.max(1,Math.min(Math.max(1,Math.round(Number(row.quantity||1))),Math.round(Number(data.get('quantity')||1)))),note=clean(data.get('note')),orderRef=state.db.collection(COLLECTIONS.platformOrders).doc(id),now=new Date();
  if(disposition==='waiting'){
    await orderRef.set({returnHandlingStatus:'waiting-return',returnDisposition:'waiting',returnQuantity:quantity,returnNote:note,returnProcessedAt:serverTimestamp(),processingStatus:'manual-return-review',updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});
  }else{
    if(!row.productId)throw new Error('這筆訂單尚未配對中央商品，請先完成 SKU 配對');
    const productRef=state.db.collection(COLLECTIONS.products).doc(row.productId),inventoryRef=state.db.collection(COLLECTIONS.inventory).doc();
    await state.db.runTransaction(async function(tx){
      const [orderSnap,productSnap]=await Promise.all([tx.get(orderRef),tx.get(productRef)]),existing=orderSnap.exists?orderSnap.data()||{}:{};
      if(existing.returnHandlingStatus==='completed')throw new Error('這筆退貨已經完成處理，為避免重複入庫不能再次執行');
      if(!productSnap.exists)throw new Error('找不到中央商品主檔');
      const raw=productSnap.data()||{},before=Number(raw.currentStock||0),after=disposition==='restock'?before+quantity:before,unitCost=Number(row.quantity||0)>0&&Number(row.costTotal||0)>0?Number(row.costTotal||0)/Number(row.quantity||1):numberOrNull(firstValue(raw,['averageCost','latestPurchaseCost','purchasePrice']));
      if(disposition==='restock'){
        const positiveRestored=Math.max(0,after)-Math.max(0,before),layers=materializeCostLayers(raw);
        if(positiveRestored>0)layers.push({layerId:uid('WEB-RETURN'),qtyRemaining:positiveRestored,originalQty:positiveRestored,unitCost:unitCost,costKnown:unitCost!=null,receivedAt:now.toISOString(),referenceType:'platformReturn',referenceId:row.externalOrderNo||id});
        const stats=statsFromLayers(layers);
        tx.set(productRef,{currentStock:after,costLayers:stats.layers,averageCost:stats.averageCost,inventoryValue:stats.inventoryValue,costIncomplete:stats.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});
        queueInventorySyncInTransaction(tx,row.productId,row.sku,after,'platformReturn');
      }else{
        const fieldMap={defective:'defectiveStock',inspect:'inspectionStock',scrap:'scrapStock',supplier:'supplierReturnStock'},field=fieldMap[disposition],fv=fieldValue(),patch={updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};
        if(field)patch[field]=fv&&fv.increment?fv.increment(quantity):Number(raw[field]||0)+quantity;
        tx.set(productRef,patch,{merge:true});
      }
      tx.set(inventoryRef,{type:disposition==='restock'?'platformReturnRestock':'platformReturnDisposition',platform:row.platform,productId:row.productId,productName:row.productName,sku:row.sku,qtyChange:disposition==='restock'?quantity:0,beforeStock:before,afterStock:after,secondaryQtyChange:disposition==='restock'?0:quantity,secondaryStockType:disposition,referenceType:'platformOrderReturn',referenceId:row.externalOrderNo||id,orderLineId:id,note:platformReturnDispositionLabel(disposition)+(note?'｜'+note:''),occurredAt:serverTimestamp(),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      tx.set(orderRef,{returnHandlingStatus:'completed',returnDisposition:disposition,returnQuantity:quantity,returnNote:note,returnedReceivedAt:serverTimestamp(),returnProcessedAt:serverTimestamp(),returnInventoryApplied:disposition==='restock',processingStatus:'return-processed',updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});
    });
  }
  await writeAudit('處理網路退貨','platformOrder',id,(row.externalOrderNo||id)+'｜'+platformReturnDispositionLabel(disposition));
  closeDrawer();toast('退貨處理已儲存',platformReturnDispositionLabel(disposition),'success');await loadAll(true);openPlatformOrderDetail(platformOrderGroupKey(row));
}

function renderSync(){
  const bounds=platformOrderBounds(),term=lower(state.platformOrderSearch).trim();
  // 一般清單只放指定日期「下單且仍有效」的成交。退貨改由獨立頁籤集中處理，
  // 不會再和今天的新訂單混在一起。
  const showingReturns=state.platformOrderIssueFilter==='returns';
  let rows=(showingReturns?platformReturnRows(state.platformOrders):visiblePlatformOrders(state.platformOrders).filter(platformOrderIsEffective)).filter(function(row){
    // 退貨頁籤保留待處理退貨，不以原下單日隱藏；一般列表則嚴格以原下單日篩選。
    const date=dateFrom(row.orderedAt);if(!showingReturns&&bounds.start&&(!date||date<bounds.start))return false;if(!showingReturns&&bounds.end&&(!date||date>bounds.end))return false;
    if(state.platformOrderPlatform!=='all'&&lower(row.platform)!==lower(state.platformOrderPlatform))return false;
    return !term||lower([row.platform,row.externalOrderNo,row.sku,row.productName,row.variantName,row.customerName,row.orderStatus,row.paymentStatus,row.processingStatus,row.reversalReason,row.returnNote].join(' ')).includes(term);
  }).sort(function(a,b){return (dateFrom(b.orderedAt)||0)-(dateFrom(a.orderedAt)||0);});
  const validRows=rows.filter(platformOrderIsEffective),fees=platformFeeMetrics(validRows),qty=sum(validRows,function(row){return row.quantity;}),orderCount=new Set(validRows.map(platformOrderGroupKey)).size;
  // 清單以「一張平台訂單」為單位，而不是以商品明細為單位。
  // 同一張 MOMO／EasyStore／Coupang 訂單購買多個商品時，會合併成同一列，查看才展開商品。
  const groupedOrders=Array.from(rows.reduce(function(map,row){
    const key=platformOrderGroupKey(row);
    if(!map.has(key))map.set(key,{key:key,rows:[]});
    map.get(key).rows.push(row);
    return map;
  },new Map()).values()).sort(function(a,b){return (dateFrom(platformOrderFirstDate(b.rows,'orderedAt',false))||0)-(dateFrom(platformOrderFirstDate(a.rows,'orderedAt',false))||0);});
  const latestRun=state.platformSyncRuns.slice().sort(function(a,b){return (dateFrom(b.startedAt)||0)-(dateFrom(a.startedAt)||0);})[0]||null;
  const latestFetch=latestRun&&latestRun.summary&&latestRun.summary.platformFetch&&typeof latestRun.summary.platformFetch==='object'?latestRun.summary.platformFetch:{};
  const fetchSummary=['EasyStore','MOMO','Coupang'].map(function(platform){const info=latestFetch[platform]||{},status=lower(info.status);return platform+' '+(status==='success'?formatNumber(info.lines||0)+' 項':status==='error'?'失敗':'未回報');}).join('・');
  const syncErrors=platformSyncAnomalies(),syncErrorGroups=platformSyncAnomalyGroups(syncErrors),errorCounts={};
  syncErrors.forEach(function(row){errorCounts[row.platform]=Number(errorCounts[row.platform]||0)+1;});
  const errorDetail=Object.keys(errorCounts).sort().map(function(name){return name+' '+errorCounts[name]+' 項';}).join('、');
  const errorSub=syncErrorGroups.length?formatNumber(syncErrorGroups.length)+' 件商品'+(errorDetail?'（'+errorDetail+'）':''):'目前沒有待處理異常';
  const monthValue=/^\d{4}-(0[1-9]|1[0-2])$/.test(clean(state.platformOrderMonth))?state.platformOrderMonth:dateText(new Date()).slice(0,7),monthYear=Number(monthValue.slice(0,4))||new Date().getFullYear();
  const monthOptions=Array.from({length:12},function(_,index){const month=index+1,key=monthYear+'-'+String(month).padStart(2,'0');return '<option value="'+attr(key)+'" '+(key===monthValue?'selected':'')+'>'+monthYear+' 年 '+month+' 月</option>';}).join('');
  const quickDate='<div class="ops-platform-date-tools"><button type="button" class="ops-platform-quick-button '+(state.platformOrderRange==='today'&&platformOrderDateKey()===todayDateKey()?'active':'')+'" data-action="platform-order-range" data-range="today">今天</button><button type="button" class="ops-platform-quick-button" data-action="platform-order-day-shift" data-step="-1">前一天</button><label class="ops-platform-date-input '+(state.platformOrderRange==='today'?'active':'')+'"><span>查詢日期</span><input id="platformOrderDate" type="date" value="'+attr(platformOrderDateKey())+'"></label><button type="button" class="ops-platform-quick-button" data-action="platform-order-day-shift" data-step="1">後一天</button><label class="ops-platform-month-select '+(state.platformOrderRange==='month'?'active':'')+'"><span>月份</span><select id="platformOrderMonth">'+monthOptions+'</select></label><button type="button" class="ops-platform-quick-button '+(state.platformOrderRange==='all'?'active':'')+'" data-action="platform-order-range" data-range="all">全部</button><button type="button" class="ops-platform-quick-button '+(state.platformOrderRange==='custom'?'active':'')+'" data-action="platform-order-range" data-range="custom">自訂區間</button></div>';
  const syncTools='<div class="ops-platform-sync-tools"><span class="ops-platform-last-sync"><span>最後一次同步 <b>'+(latestRun?escapeHtml(dateTimeText(latestRun.startedAt)):'尚未執行')+'</b></span>'+(latestRun?'<small>本次抓單：'+escapeHtml(fetchSummary)+'</small>':'')+'</span><button type="button" class="ops-platform-sync-anomaly '+(syncErrorGroups.length?'has-error':'')+' '+(state.platformSyncPanel==='errors'?'active':'')+'" data-action="platform-sync-panel" data-panel="errors">同步異常 '+formatNumber(syncErrorGroups.length)+' 件</button><button class="ops-button small ghost" data-action="platform-fee-settings">費用設定</button><button class="ops-button small primary" data-action="platform-sync-now">立即同步</button></div>';
  const customPanel=state.platformOrderRange==='custom'?'<div class="ops-platform-custom-range"><label>開始日期<input class="ops-input" id="platformOrderFrom" type="date" value="'+attr(state.platformOrderFrom)+'"></label><span>至</span><label>結束日期<input class="ops-input" id="platformOrderTo" type="date" value="'+attr(state.platformOrderTo)+'"></label><button class="ops-button primary" data-action="platform-order-custom-apply">套用區間</button></div>':'';
  const errorList=syncErrorGroups.length?'<div class="ops-sync-anomaly-list">'+syncErrorGroups.map(function(group){
    const issueCount=group.issues.length,platformCount=new Set(group.issues.map(function(issue){return issue.platform;})).size;
    const issuesHtml=group.issues.map(function(row){
      const platformColor=row.platform==='EasyStore'?'green':row.platform==='MOMO'?'blue':row.platform==='Coupang'?'yellow':'red',isPrice=row.kind==='price',targetText=isPrice?'目標售價 '+money(row.targetPrice):'目標庫存 '+formatNumber(row.targetStock),actionHtml=isPrice?'<button class="ops-button small primary" data-action="price-anomaly-product" data-id="'+attr(group.productId||row.productId)+'" data-sku="'+attr(group.sku||row.sku)+'">前往商品價格</button>':'<button class="ops-button small primary" data-action="inventory-anomaly-product" data-id="'+attr(group.productId||row.productId)+'" data-sku="'+attr(group.sku||row.sku)+'">前往商品庫存</button>';
      return '<div class="ops-sync-platform-issue"><div class="ops-sync-platform-issue-head"><span>'+statusTag(row.platform,platformColor)+'</span><span class="ops-tag '+(isPrice?'blue':'green')+'">'+(isPrice?'價格':'庫存')+'</span></div><div class="ops-sync-platform-issue-body"><strong>'+escapeHtml(row.reason)+'</strong><small>'+escapeHtml(targetText)+'・最後嘗試 '+escapeHtml(dateTimeText(row.lastAttemptAt))+(row.runId?'・批次 '+escapeHtml(row.runId):'')+'</small>'+(row.message?'<p>'+escapeHtml(row.message)+'</p>':'')+'</div><div class="ops-sync-anomaly-actions">'+actionHtml+'</div></div>';
    }).join('');
    return '<article class="ops-sync-product-anomaly"><header><div><b>'+escapeHtml(group.productName||'未命名商品')+'</b><small>SKU：'+escapeHtml(group.sku||'未設定')+'</small></div><span class="ops-sync-product-count">'+formatNumber(platformCount)+' 個平台／'+formatNumber(issueCount)+' 項問題</span></header><div class="ops-sync-product-issues">'+issuesHtml+'</div></article>';
  }).join('')+'</div>':emptyHtml('目前沒有平台同步異常','下一次同步若成功，原本的庫存或價格異常會自動從這裡消失。');
  const errorPanel=state.platformSyncPanel==='errors'?'<section class="ops-card ops-platform-expand-panel ops-platform-error-panel"><div class="ops-card-head"><div><h2>同步異常明細</h2><p>'+escapeHtml(errorSub)+'。完成商品配對、權限或價格修正後，下一次同步會自動重試。</p></div><button class="ops-button small ghost" data-action="platform-sync-panel" data-panel="errors">收合</button></div>'+errorList+'</section>':'';
  const allReturnRows=platformReturnRows(state.platformOrders).filter(function(row){return clean(row.returnHandlingStatus)!=='completed';}),returnOrderCount=new Set(allReturnRows.map(platformOrderGroupKey)).size;
  const platformTabs='<div class="ops-platform-tabs ops-platform-tabs-compact"><button class="'+(state.platformOrderPlatform==='all'&&state.platformOrderIssueFilter!=='returns'?'active':'')+'" data-action="platform-order-platform" data-platform="all">全部平台</button><button class="'+(state.platformOrderPlatform==='EasyStore'&&state.platformOrderIssueFilter!=='returns'?'active':'')+'" data-action="platform-order-platform" data-platform="EasyStore">EASY STORE</button><button class="'+(state.platformOrderPlatform==='MOMO'&&state.platformOrderIssueFilter!=='returns'?'active':'')+'" data-action="platform-order-platform" data-platform="MOMO">MOMO</button><button class="'+(state.platformOrderPlatform==='Coupang'&&state.platformOrderIssueFilter!=='returns'?'active':'')+'" data-action="platform-order-platform" data-platform="Coupang">Coupang／酷澎</button><button class="ops-platform-return-tab '+(state.platformOrderIssueFilter==='returns'?'active':'')+'" data-action="platform-return-filter">查看退貨'+(returnOrderCount?' '+formatNumber(returnOrderCount):'')+'</button></div>';
  const orderTable=groupedOrders.length?'<div class="ops-table-wrap ops-platform-orders-table"><table class="ops-table"><thead><tr><th>平台／下單時間</th><th>訂單</th><th>商品</th><th class="num">數量</th><th class="num">成交</th><th class="num">平台費</th><th class="num">固定費攤提</th><th class="num">成本</th><th class="num">預估毛利</th><th>中央庫存</th><th>細項</th></tr></thead><tbody>'+groupedOrders.slice(0,500).map(function(group){
    const groupRows=group.rows,first=groupRows[0],effectiveRows=groupRows.filter(platformOrderIsEffective),effective=effectiveRows.length>0,metrics=groupRows.reduce(function(total,row){const item=fees.perRow.get(row.id)||{gross:platformOrderGross(row),variableFee:0,fixedFee:0,cost:platformOrderCost(row),profit:0};total.gross+=Number(item.gross||0);total.variableFee+=Number(item.variableFee||0);total.fixedFee+=Number(item.fixedFee||0);total.cost+=Number(item.cost||0);total.profit+=Number(item.profit||0);return total;},{gross:0,variableFee:0,fixedFee:0,cost:0,profit:0}),groupQty=sum(groupRows,function(row){return row.quantity;}),hasEstimatedCost=groupRows.some(function(row){return row.costEstimated;}),costNote=hasEstimatedCost?'<br><small>含目前成本估算</small>':'',profitHtml=effective?'<b>'+money(metrics.profit)+'</b>':'<small>不列入有效成交</small>',productHtml=groupRows.slice(0,3).map(function(row){return '<small>'+escapeHtml(row.productName)+' × '+formatNumber(row.quantity)+(row.variantName?'・'+escapeHtml(row.variantName):'')+'</small>';}).join('<br>')+(groupRows.length>3?'<br><small>另有 '+formatNumber(groupRows.length-3)+' 項商品</small>':''),allApplied=groupRows.every(function(row){return row.inventoryApplied===true;}),stockHtml=allApplied?statusTag('已扣中央庫存','green'):statusTag(platformOrderProcessingLabel(first),platformOrderProcessingColor(first));
    if(showingReturns)stockHtml+='<br><small class="ops-text-danger">'+escapeHtml(first.returnHandlingStatus==='completed'?'退貨已處理':'退貨待處理')+'</small>';
    return '<tr><td>'+statusTag(first.platform,first.platform==='EasyStore'?'green':first.platform==='MOMO'?'blue':'yellow')+'<br><small>'+escapeHtml(platformOrderPlacedAtText(first))+'</small></td><td><b>'+escapeHtml(first.externalOrderNo||'—')+'</b><br><small>'+escapeHtml(first.customerName||'')+'・'+formatNumber(groupRows.length)+' 項商品</small></td><td>'+productHtml+'</td><td class="num">'+formatNumber(groupQty)+'</td><td class="num">'+money(metrics.gross)+'</td><td class="num">'+money(metrics.variableFee)+'</td><td class="num">'+money(metrics.fixedFee)+'</td><td class="num">'+money(metrics.cost)+costNote+'</td><td class="num">'+profitHtml+'</td><td>'+stockHtml+'</td><td><button class="ops-button small ghost" data-action="platform-order-detail" data-key="'+attr(group.key)+'">查看</button></td></tr>';
  }).join('')+'</tbody></table></div>':emptyHtml('目前沒有符合條件的平台訂單','請更換日期、平台或搜尋條件。');
  return '<section class="ops-card ops-platform-control-card"><div class="ops-platform-control-title"><h2>平台訂單</h2></div><div class="ops-platform-control-row">'+quickDate+'<span class="ops-platform-control-divider" aria-hidden="true"></span>'+syncTools+'</div>'+customPanel+'</section>'+errorPanel+'<section class="ops-card ops-platform-order-list ops-platform-order-list-compact">'+platformTabs+'<div class="ops-kpi-grid ops-platform-kpis">'+kpi('成交金額',money(fees.gross),orderCount+' 筆訂單','＄')+kpi('平台與金流費',money(fees.variableFees),'依各平台設定','費')+kpi('固定費用攤提',money(fees.fixedFees),'月費＋廣告費','固')+kpi('商品成本',money(fees.cost),'中央 FIFO／估算成本','成本')+kpi('預估毛利',money(fees.profit),'成交－全部費用－成本','利')+kpi('銷售件數',formatNumber(qty),'有效成交數量','件')+'</div><div class="ops-toolbar ops-platform-search"><input class="ops-input grow" id="platformOrderSearch" placeholder="搜尋訂單編號、SKU、商品、客戶或狀態" value="'+attr(state.platformOrderSearch)+'"></div>'+orderTable+'</section>';
}

  function renderConnection(){
    const diagnostics=state.diagnostics.map(function(d){return '<div class="ops-status-row"><div><b>'+escapeHtml(d.collection)+'</b><small>'+d.count+' 筆・'+d.ms+' ms'+(d.error?'・'+escapeHtml(d.error):'')+'</small></div><span class="ops-status-dot '+(d.ok?'':'error')+'">'+(d.ok?'已連線':'讀取失敗')+'</span></div>';}).join('');
    const audit=state.audit.sort(function(a,b){return (dateFrom(b.createdAt)||0)-(dateFrom(a.createdAt)||0);}).slice(0,30);
    const auditHtml=audit.length?audit.map(function(x){return '<div class="ops-activity"><div class="ops-activity-icon">•</div><div><b>'+escapeHtml(x.action)+'｜'+escapeHtml(x.summary||x.entityId)+'</b><small>'+escapeHtml(x.createdBy||'')+'・'+escapeHtml(dateTimeText(x.createdAt))+'</small></div></div>';}).join(''):emptyHtml('尚無營運操作紀錄','完成主檔、銷售、進貨或案件操作後會顯示。');
    return '<div class="ops-grid-2"><section class="ops-card"><div class="ops-card-head"><div><h2>Firebase 與集合狀態</h2><p>專案：'+escapeHtml((global.APP_CONFIG&&APP_CONFIG.FIREBASE_CONFIG&&APP_CONFIG.FIREBASE_CONFIG.projectId)||'未辨識')+'・版本 '+VERSION+'</p></div><button class="ops-button ghost" data-action="refresh">重新讀取</button></div>'+diagnostics+'</section><section class="ops-card"><div class="ops-card-head"><div><h2>備份與匯入</h2><p>可先下載營運資料備份，再進行大量匯入或調整。</p></div></div><div class="ops-summary-list"><div class="ops-summary-line"><span>網路商品來源</span><b>'+escapeHtml(state.onlineSource||'未找到')+'</b></div><div class="ops-summary-line"><span>內部商品主檔</span><b>'+state.internalProducts.length+' 筆</b></div><div class="ops-summary-line"><span>營運集合</span><b>'+Object.keys(COLLECTIONS).length+' 個</b></div></div><div class="ops-card-actions" style="margin-top:14px;justify-content:flex-start"><button class="ops-button primary" data-action="export-backup">下載 JSON 備份</button><button class="ops-button ghost" data-action="open-import">Excel 匯入商品主檔</button><button class="ops-button ghost" data-action="download-product-template">下載 CSV 範本</button></div></section></div><section class="ops-card" style="margin-top:15px"><div class="ops-card-head"><div><h2>最近營運操作</h2><p>只顯示 opsAuditLogs，不會混入原系統操作。</p></div></div>'+auditHtml+'</section>';
  }


function formatSalesClock(now){
  const roc=now.getFullYear()-1911,m=now.getMonth()+1,d=now.getDate();
  const hh=String(now.getHours()).padStart(2,'0'),mm=String(now.getMinutes()).padStart(2,'0'),ss=String(now.getSeconds()).padStart(2,'0');
  return roc+'年'+m+'月'+d+'日 '+hh+':'+mm+':'+ss;
}
function updateSalesClock(){
  const value=formatSalesClock(new Date());
  const el=byId('opsSalesClock'); if(el) el.textContent=value;
  const pageEl=byId('opsPageClock'); if(pageEl) pageEl.textContent=value;
}
function ensureSalesClock(){
  if(state.view==='sales'){
    updateSalesClock();
    if(!global.__opsSalesClockTimer) global.__opsSalesClockTimer=global.setInterval(updateSalesClock,1000);
  }else if(global.__opsSalesClockTimer){
    global.clearInterval(global.__opsSalesClockTimer);
    global.__opsSalesClockTimer=null;
  }
}

  function bindViewSpecific(){
    const purchaseEntrySort=byId('purchaseEntrySort');
    if(purchaseEntrySort)purchaseEntrySort.outerHTML=displayModeToggleHtml('purchase-entry-display-mode',state.purchaseEntryDisplayMode,'進貨商品顯示方式');
    const financeRange=byId('financeRange'); if(financeRange) financeRange.value=state.financeRange;
    ensureSalesClock();
  }

  function catalogById(id){ return state.catalog.find(function(p){return p.docId===id;})||null; }
  function rentalById(id){ return mergedRentals().find(function(r){return r.id===id;})||null; }
  function caseById(id){ return state.cases.find(function(c){return c.id===id;})||null; }

  function productEditorImages(p){
    const images=[];
    ((p&&p.imageUrls)||[]).concat(p&&p.imageUrl?[p.imageUrl]:[]).forEach(function(url){url=safeUrl(url);if(url&&!images.includes(url))images.push(url);});
    return images.slice(0,4);
  }
  function productImagePanelHtml(p){
    const title=(p&&((p.originalName)||(p.onlineName)||(p.name)))||'商品圖片';
    const images=productEditorImages(p);
    if(!images.length)return '<div class="ops-product-media-panel"><div class="ops-product-media-main is-empty"><div class="ops-detail-no-image">尚無商品圖片</div></div></div>';
    const main=images[0];
    const thumbs=images.map(function(url,index){return '<button type="button" class="ops-product-media-thumb'+(index===0?' active':'')+'" data-action="product-preview-open" data-index="'+index+'"><img src="'+attr(url)+'" alt="'+attr(title)+'"></button>';}).join('');
    return '<div class="ops-product-media-panel"><button type="button" class="ops-product-media-main" data-action="product-preview-open" data-index="0"><img src="'+attr(main)+'" alt="'+attr(title)+'"></button><div class="ops-product-media-hint">商品圖片（可點擊放大預覽）</div><div class="ops-product-media-thumbs">'+thumbs+'</div></div>';
  }
  function renderProductPreviewModal(){
    const images=(state.productPreviewImages||[]).filter(Boolean);
    if(!images.length)return '';
    const index=Math.max(0,Math.min(images.length-1,Number(state.productPreviewIndex)||0));
    const title=state.productPreviewTitle||'商品圖片';
    const prev=images.length>1?'<button type="button" class="ops-product-preview-nav prev" data-action="product-preview-prev">‹</button>':'';
    const next=images.length>1?'<button type="button" class="ops-product-preview-nav next" data-action="product-preview-next">›</button>':'';
    const thumbs=images.map(function(url,i){return '<button type="button" class="ops-product-preview-thumb'+(i===index?' active':'')+'" data-action="product-preview-select" data-index="'+i+'"><img src="'+attr(url)+'" alt="'+attr(title)+'"></button>';}).join('');
    return '<div class="ops-product-preview-overlay"><button type="button" class="ops-product-preview-backdrop" data-action="product-preview-close" aria-label="關閉圖片預覽"></button><div class="ops-product-preview-dialog"><button type="button" class="ops-product-preview-close" data-action="product-preview-close" aria-label="關閉">×</button>'+prev+next+'<div class="ops-product-preview-stage"><img src="'+attr(images[index])+'" alt="'+attr(title)+'"></div><div class="ops-product-preview-count">'+(index+1)+' / '+images.length+'</div><div class="ops-product-preview-strip">'+thumbs+'</div></div></div>';
  }
  function clearProductEditorState(){
    state.productEditId='';
    state.productPreviewImages=[];
    state.productPreviewIndex=0;
    state.productPreviewTitle='';
  }
  function productEditorHasUnsavedChanges(){
    const form=byId('productForm');
    if(!form)return false;
    return Array.from(form.elements||[]).some(function(field){
      if(!field||field.disabled||field.readOnly||!field.name)return false;
      const type=lower(field.type);
      if(type==='checkbox'||type==='radio')return field.checked!==field.defaultChecked;
      if(field.tagName==='SELECT')return Array.from(field.options||[]).some(function(option){return option.selected!==option.defaultSelected;});
      return String(field.value==null?'':field.value)!==String(field.defaultValue==null?'':field.defaultValue);
    });
  }
  function closeProductEditorForListChange(){
    if(!state.productEditId)return true;
    if(productEditorHasUnsavedChanges()&&!global.confirm('目前商品尚未儲存，是否放棄修改？'))return false;
    clearProductEditorState();
    return true;
  }
  function productFormHtml(p){
    const internal=p&&p.internal,avg=p&&p.averageCost,isNew=!p;
    const displayName=(p&&((p.originalName)||(p.onlineName)||(p.name)))||'新增商品';
    const title=isNew?'新增商品':'編輯商品：'+displayName;
    const easyStorePrice=p&&p.easyStorePrice!=null?p.easyStorePrice:(p&&p.onlinePrice!=null?p.onlinePrice:'');
    const momoPrice=p&&p.momoPrice!=null?p.momoPrice:'';
    const coupangPrice=p&&p.coupangPrice!=null?p.coupangPrice:'';
    return '<form id="productForm" data-id="'+attr(p?p.docId:'')+'"><section class="ops-inline-product-editor" id="opsProductEditor"><div class="ops-inline-product-header"><div><h3>'+escapeHtml(title)+'</h3>'+(p?'<div class="ops-inline-product-meta">SKU '+escapeHtml(p.sku||'未設定')+' ・ 庫存 '+escapeHtml(formatNumber(p.currentStock))+'</div>':'')+'</div><div class="ops-card-actions"><button class="ops-button ghost" type="button" data-action="product-edit-cancel">取消編輯</button><button class="ops-button primary" type="submit">'+(isNew?'儲存商品':'儲存變更')+'</button></div></div><div class="ops-inline-product-layout"><div class="ops-inline-product-media">'+productImagePanelHtml(p)+'</div><div class="ops-inline-product-fields"><div class="ops-form-grid cols-3"><div class="ops-field"><label class="ops-required">SKU／商品編號</label><input class="ops-input" name="internalSku" value="'+attr((p&&p.sku)||'')+'" required></div><div class="ops-field full ops-product-name-field"><label class="ops-required">商品名稱</label><input class="ops-input" name="internalName" value="'+attr((internal&&internal.internalName)||(p&&p.originalName)||(p&&p.onlineName)||'')+'" required></div></div><div class="ops-form-grid cols-3"><div class="ops-field"><label>品牌</label><input class="ops-input" name="brand" value="'+attr((p&&p.brand)||'')+'"></div><div class="ops-field"><label>分類</label><input class="ops-input" name="category" value="'+attr((p&&p.category)||'')+'"></div><div class="ops-field"><label>狀態</label><select class="ops-select" name="status"><option value="active">正常銷售</option><option value="inactive">停用</option><option value="discontinued">停售</option></select></div></div><div class="ops-section-title">成本資訊</div><div class="ops-form-grid cols-2 ops-product-value-fields"><div class="ops-field"><label>進貨成本</label><input class="ops-input" type="number" min="0" step="0.01" name="latestPurchaseCost" value="'+attr(p&&p.latestPurchaseCost!=null?p.latestPurchaseCost:'')+'"></div><div class="ops-field"><label>平均成本</label><input class="ops-input" value="'+attr(avg!=null?avg:'')+'" readonly></div></div><div class="ops-section-title">售價資訊</div><div class="ops-form-grid cols-4 ops-product-value-fields"><div class="ops-field"><label>門市售價</label><input class="ops-input" type="number" min="0" step="1" name="storePrice" value="'+attr(p&&p.storePrice!=null?p.storePrice:'')+'"></div><div class="ops-field"><label>EASY STORE 售價</label><input class="ops-input" type="number" min="0" step="1" name="easyStorePrice" value="'+attr(easyStorePrice)+'"></div><div class="ops-field"><label>MOMO 售價</label><input class="ops-input" type="number" min="0" step="1" name="momoPrice" value="'+attr(momoPrice)+'"></div><div class="ops-field"><label>Coupang／酷澎售價</label><input class="ops-input" type="number" min="0" step="1" name="coupangPrice" value="'+attr(coupangPrice)+'"></div><div class="ops-field full"><small>第一次只有一個網路價時會先帶入三平台。之後可分別修改；EasyStore 可自動送出，MOMO 尚待官方改價權限，酷澎價格須為 10 元倍數並由店內固定 IP 同步。</small></div></div><div class="ops-form-grid"><div class="ops-field"><label>現有庫存</label><input class="ops-input" type="number" step="1" name="currentStock" value="'+attr(p&&p.currentStock!=null?p.currentStock:0)+'"><small>標準流程請使用「庫存作業／盤點調整」；在此修改時會先要求確認並留下盤點紀錄。</small></div><div class="ops-field"><label>安全庫存</label><input class="ops-input" type="number" min="0" step="1" name="safetyStock" value="'+attr(p&&p.safetyStock!=null?p.safetyStock:0)+'"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note">'+escapeHtml((internal&&internal.note)||'')+'</textarea></div></div></div></div></section></form>';
  }

  function imageGalleryHtml(images,alt){images=(images||[]).slice(0,3);if(!images.length)return '<div class="ops-detail-gallery"><div class="ops-detail-no-image">尚無圖片</div></div>';return '<div class="ops-detail-gallery">'+images.map(function(url,index){return '<img class="'+(index===0?'main':'')+'" src="'+attr(url)+'" alt="'+attr(alt)+'">';}).join('')+'</div>';}
  function openProductEdit(id){
    const targetId=id||'__new__';
    if(state.productEditId&&state.productEditId!==targetId&&!closeProductEditorForListChange())return;
    const p=id?catalogById(id):null;
    if(id&&!p)return toast('找不到商品','請重新讀取資料。','error');
    state.productEditId=targetId;
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
      if(status){
        status.value=(p&&p.internal&&p.internal.status)||'active';
        Array.from(status.options||[]).forEach(function(option){option.defaultSelected=option.selected;});
      }
    },0);
  }
  function openProductDetail(id){
    const p=catalogById(id);if(!p)return;const tx=state.inventory.filter(function(x){return x.productId===p.docId;}).sort(function(a,b){return (dateFrom(b.occurredAt)||0)-(dateFrom(a.occurredAt)||0);}).slice(0,10);const layers=(p.internal&&p.internal.costLayers)||[];
    const txHtml=tx.length?tx.map(function(x){return '<div class="ops-status-row"><div><b>'+escapeHtml(x.type)+'・'+(x.qtyChange>0?'+':'')+formatNumber(x.qtyChange)+'</b><small>'+escapeHtml(dateTimeText(x.occurredAt))+' '+escapeHtml(x.referenceId||'')+'</small></div><b>'+formatNumber(x.afterStock)+'</b></div>';}).join(''):emptyHtml('尚無庫存異動','進貨、銷售或盤點後會顯示。');
    const layerHtml=layers.length?'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>批次</th><th>日期</th><th class="num">剩餘數量</th><th class="num">單位成本</th><th>來源</th></tr></thead><tbody>'+layers.map(function(l){return '<tr><td>'+escapeHtml(l.layerId)+'</td><td>'+escapeHtml(dateText(l.receivedAt))+'</td><td class="num">'+formatNumber(l.qtyRemaining)+'</td><td class="num">'+money(l.unitCost)+'</td><td>'+escapeHtml(l.referenceType+' '+(l.referenceId||''))+'</td></tr>';}).join('')+'</tbody></table></div>':emptyHtml('尚無 FIFO 成本批次','庫存為零、成本缺漏，或尚未完成原始 Excel 匯入。');
    const body='<div class="ops-detail-hero">'+imageGalleryHtml(p.imageUrls,p.originalName||p.name)+'<div><h3>'+escapeHtml(p.originalName||p.name)+'</h3><p>網路名稱：'+escapeHtml(p.onlineName||'未上架／未配對')+'</p><p>SKU：'+escapeHtml(p.sku||'尚未設定')+'</p><p>'+escapeHtml([p.brand,p.category,p.variantName].filter(Boolean).join('・')||'未設定品牌／分類')+'</p></div></div><div class="ops-grid-equal"><div class="ops-card"><div class="ops-summary-list"><div class="ops-summary-line"><span>現有庫存</span><b>'+formatNumber(p.currentStock)+'</b></div><div class="ops-summary-line"><span>保留庫存</span><b>'+formatNumber(p.reservedStock)+'</b></div><div class="ops-summary-line"><span>安全庫存</span><b>'+formatNumber(p.safetyStock)+'</b></div><div class="ops-summary-line total"><span>可銷售庫存</span><b>'+formatNumber(p.availableStock)+'</b></div></div></div><div class="ops-card"><div class="ops-summary-list"><div class="ops-summary-line"><span>門市售價</span><b>'+money(p.storePrice)+'</b></div><div class="ops-summary-line"><span>EASY STORE 售價</span><b>'+money(p.easyStorePrice)+'</b></div><div class="ops-summary-line"><span>MOMO 售價</span><b>'+money(p.momoPrice)+'</b></div><div class="ops-summary-line"><span>Coupang／酷澎售價</span><b>'+money(p.coupangPrice)+'</b></div><div class="ops-summary-line"><span>下一件 FIFO 成本</span><b>'+money(p.nextFifoCost)+'</b></div><div class="ops-summary-line"><span>剩餘平均成本</span><b>'+money(p.averageCost)+'</b></div><div class="ops-summary-line"><span>庫存總成本</span><b>'+money(p.inventoryValue)+'</b></div><div class="ops-summary-line total"><span>下一件預估毛利率</span><b>'+percentage(p.margin)+'</b></div></div></div></div><div class="ops-section-title">FIFO 剩餘成本批次</div>'+layerHtml+'<div class="ops-section-title">最近庫存異動</div>'+txHtml+'<div class="ops-drawer-footer"><button class="ops-button ghost" data-action="drawer-close">關閉</button><button class="ops-button primary" data-action="product-edit" data-id="'+attr(p.docId)+'">編輯主檔</button></div>';openDrawer('商品完整資料','原始名稱、網路名稱、圖片、庫存與 FIFO 成本。',body);
  }
  async function saveProduct(form){
    const requestedId=clean(form.dataset.id),p=requestedId?catalogById(requestedId):null;if(requestedId&&(!p||!p.internal))throw new Error('找不到中央商品主檔');
    const data=new FormData(form),sku=normalizeCode(data.get('internalSku')),name=clean(data.get('internalName'));if(!sku)throw new Error('SKU 不可空白');if(!name)throw new Error('商品名稱不可空白');
    const duplicate=state.internalProducts.find(function(x){return x.internalSku===sku&&x.docId!==requestedId;});if(duplicate)throw new Error('此 SKU 已被其他商品使用：'+sku);
    const ref=requestedId?state.db.collection(COLLECTIONS.products).doc(requestedId):state.db.collection(COLLECTIONS.products).doc(),id=ref.id,oldStock=p?Number(p.currentStock||0):0,requestedStock=numberOrNull(data.get('currentStock'));if(requestedStock==null)throw new Error('現有庫存格式不正確');
    let finalStock=requestedStock,stockAdjustmentConfirmed=true;
    if(p&&requestedStock!==oldStock){
      stockAdjustmentConfirmed=global.confirm('確認調整庫存？\n\n原庫存：'+formatNumber(oldStock)+'\n調整後：'+formatNumber(requestedStock)+'\n\n確認後會同步建立一筆盤點調整紀錄。');
      if(!stockAdjustmentConfirmed)finalStock=oldStock;
    }
    const latest=numberOrNull(data.get('latestPurchaseCost')),raw=p&&p.internal?p.internal:{currentStock:0,costLayers:[]},layerResult=adjustFifoLayers(raw,finalStock,latest,{referenceType:p?'manualAdjustment':'manualOpening',referenceId:id,receivedAt:new Date().toISOString()});
    const prices={storePrice:numberOrNull(data.get('storePrice')),easyStorePrice:numberOrNull(data.get('easyStorePrice')),momoPrice:numberOrNull(data.get('momoPrice')),coupangPrice:numberOrNull(data.get('coupangPrice'))};
    const initializingPlatformPrices=!p||!p.internal||p.internal.platformPricesInitialized!==true;
    if(initializingPlatformPrices){
      const seed=[prices.easyStorePrice,prices.momoPrice,prices.coupangPrice,p&&p.onlinePrice].find(function(value){return value!=null;});
      if(seed!=null){if(prices.easyStorePrice==null)prices.easyStorePrice=seed;if(prices.momoPrice==null)prices.momoPrice=seed;if(prices.coupangPrice==null)prices.coupangPrice=seed;}
    }
    // 酷澎台灣站 API 只接受 10 元倍數；初始化帶入的共用網路售價也必須先檢查。
    if(prices.coupangPrice!=null&&(!Number.isInteger(prices.coupangPrice)||prices.coupangPrice%10!==0))throw new Error('酷澎售價必須是 10 元倍數（例如 390、400）。請修改後再儲存。');
    const currentPriceSync=p&&p.internal&&p.internal.platformPriceSync&&typeof p.internal.platformPriceSync==='object'?p.internal.platformPriceSync:{},nextPriceSync=Object.assign({},currentPriceSync);let priceChanged=false,needsSyncRequest=false;
    [['EasyStore','easyStorePrice'],['MOMO','momoPrice'],['Coupang','coupangPrice']].forEach(function(pair){
      const platform=pair[0],field=pair[1],oldPrice=p&&p[field]!=null?Number(p[field]):null,newPrice=prices[field];
      const same=(oldPrice==null&&newPrice==null)||(oldPrice!=null&&newPrice!=null&&Number(oldPrice)===Number(newPrice));if(same)return;
      priceChanged=true;
      let status='pending',message='等待平台價格同步';
      if(newPrice==null){status='cleared';message='已清除平台目標售價';}
      else if(platform==='MOMO'){status='manual-required';message='已保存 MOMO 目標售價；尚未取得官方自動改價端點／權限。';}
      else if(platform==='Coupang'&&Math.round(newPrice)%10!==0){status='manual-required';message='酷澎台灣售價須為 10 元倍數，請調整後再同步。';}
      if(status==='pending')needsSyncRequest=true;
      nextPriceSync[platform]=Object.assign({},currentPriceSync[platform]||{},{targetPrice:newPrice,status:status,message:message,requestedAt:serverTimestamp()});
    });
    if(priceChanged)nextPriceSync.lastUpdatedAt=serverTimestamp();
    const payload={internalSku:sku,internalName:name,originalName:name,barcode:p&&p.internal?clean(p.internal.barcode):'',storePrice:prices.storePrice,originalSalePrice:prices.storePrice,easyStorePrice:prices.easyStorePrice,momoPrice:prices.momoPrice,coupangPrice:prices.coupangPrice,platformPricesInitialized:true,latestPurchaseCost:latest,currentStock:finalStock,reservedStock:p?Number(p.reservedStock||0):0,safetyStock:numberOrNull(data.get('safetyStock'))||0,saleRewardPercent:p&&p.internal?p.internal.saleRewardPercent:null,status:clean(data.get('status'))||'active',brand:clean(data.get('brand')),category:clean(data.get('category')),note:clean(data.get('note')),costLayers:layerResult.layers,averageCost:layerResult.averageCost,inventoryValue:layerResult.inventoryValue,costIncomplete:layerResult.costIncomplete,platformPriceSync:nextPriceSync,importInitialized:true,enabled:true,source:p?clean(p.internal.source)||'manual':'manual',updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};
    if(!p){payload.createdAt=serverTimestamp();payload.createdBy=userLabel();payload.openingStock=finalStock;payload.openingUnitCost=latest;}
    const batch=state.db.batch();batch.set(ref,payload,{merge:true});
    if(needsSyncRequest){const syncRef=state.db.collection(COLLECTIONS.platformSyncRequests).doc();batch.set(syncRef,{requestId:syncRef.id,status:'pending',reason:'platform-price-change',productIds:[id],requestedAt:serverTimestamp(),requestedBy:userLabel(),source:'product-editor',version:VERSION});}
    if(finalStock!==oldStock){const inventoryRef=state.db.collection(COLLECTIONS.inventory).doc(),queueRef=state.db.collection(COLLECTIONS.platformInventoryQueue).doc(id);batch.set(inventoryRef,{type:p?'adjustment':'opening',productId:id,productName:name,sku:sku,qtyChange:finalStock-oldStock,beforeStock:oldStock,afterStock:finalStock,unitCost:latest,referenceType:'productMaster',referenceId:id,note:p?'商品資訊修改':'新增商品期初庫存',occurredAt:serverTimestamp(),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});batch.set(queueRef,{productId:id,sku:sku,productName:name,targetStock:Math.max(0,finalStock),status:'pending',reason:p?'productEdit':'productCreate',updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});}
    await batch.commit();
    clearProductEditorState();await writeAudit(p?'儲存商品主檔':'新增商品','product',id,name+'｜'+sku);const stockNote=p&&requestedStock!==oldStock&&!stockAdjustmentConfirmed?'；庫存維持 '+formatNumber(oldStock):'';toast(p?'商品已儲存':'商品已新增',name+stockNote,'success');await loadProductsOnly(true);setTimeout(function(){const savedCard=queryAll('[data-action="product-edit"]').find(function(card){return card.dataset.id===id;});if(savedCard&&typeof savedCard.scrollIntoView==='function'){try{savedCard.scrollIntoView({behavior:'smooth',block:'center'});}catch(err){savedCard.scrollIntoView(true);}}},0);
  }
  async function autoInitProducts(){ return openImport(); }

  function addCartProduct(id){const p=catalogById(id);if(!p||!p.initialized)return;const usageMode=state.salesMode==='usage',existing=state.cart.find(function(x){return x.productId===id;});if(existing){existing.qty+=1;if(usageMode)existing.unitPrice=0;}else state.cart.push({productId:id,name:p.originalName||p.name,sku:p.sku,imageUrl:p.imageUrl,qty:1,unitPrice:usageMode?0:Number(p.storePrice||0),currentStock:p.currentStock});render();}
  function openCustomer(id){const row=id?state.customers.find(function(x){return x.id===id;}):null;const c=row||{id:'',name:'',phone:'',email:'',customerType:'general',memberNo:'',pricingTier:'retail',externalTeacherId:'',pointBalance:0,creditLimit:0,note:'',enabled:true};openDrawer(row?'編輯客戶':'新增客戶','先建立關係；點數與老師價格公式之後再設定。','<form id="customerForm" data-id="'+attr(c.id)+'"><div class="ops-form-grid"><div class="ops-field"><label class="ops-required">姓名／名稱</label><input class="ops-input" name="name" value="'+attr(c.name)+'" required></div><div class="ops-field"><label>電話</label><input class="ops-input" name="phone" value="'+attr(c.phone)+'"></div><div class="ops-field"><label>Email</label><input class="ops-input" type="email" name="email" value="'+attr(c.email)+'"></div><div class="ops-field"><label>客戶身分</label><select class="ops-select" name="customerType"><option value="general">一般客戶</option><option value="member">會員</option><option value="teacher">老師</option><option value="organization">機構</option></select></div><div class="ops-field"><label>會員編號</label><input class="ops-input" name="memberNo" value="'+attr(c.memberNo)+'" placeholder="留白會自動產生"></div><div class="ops-field"><label>價格層級</label><select class="ops-select" name="pricingTier"><option value="retail">一般售價</option><option value="teacher">老師價（規則待設定）</option><option value="custom">自訂價格（規則待設定）</option></select></div><div class="ops-field"><label>外聘老師資料 ID</label><input class="ops-input" name="externalTeacherId" value="'+attr(c.externalTeacherId)+'"></div><div class="ops-field"><label>信用額度</label><input class="ops-input" type="number" min="0" step="1" name="creditLimit" value="'+c.creditLimit+'"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note">'+escapeHtml(c.note)+'</textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存客戶</button></div></form>');query('#customerForm [name="customerType"]').value=c.customerType;query('#customerForm [name="pricingTier"]').value=c.pricingTier;}
  async function saveCustomer(form){const id=clean(form.dataset.id),data=new FormData(form),type=clean(data.get('customerType')),payload={name:clean(data.get('name')),phone:clean(data.get('phone')),email:clean(data.get('email')),customerType:type,memberNo:clean(data.get('memberNo'))||(type==='member'||type==='teacher'?uid('MEM'):''),pricingTier:clean(data.get('pricingTier')),externalTeacherId:clean(data.get('externalTeacherId')),creditLimit:numberOrNull(data.get('creditLimit'))||0,note:clean(data.get('note')),enabled:true,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};if(!payload.name)throw new Error('請填寫姓名或名稱');let ref;if(id){ref=state.db.collection(COLLECTIONS.customers).doc(id);await ref.set(payload,{merge:true});}else{payload.pointBalance=0;payload.createdAt=serverTimestamp();payload.createdBy=userLabel();ref=await state.db.collection(COLLECTIONS.customers).add(payload);}await writeAudit(id?'更新客戶':'新增客戶','customer',ref.id,payload.name);closeDrawer();toast('客戶已儲存',payload.name,'success');await loadAll(true);}
  function checkoutDrawer(){const subtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;}),options='<option value="">現場散客</option>'+state.customers.filter(function(x){return x.enabled;}).map(function(x){return '<option value="'+attr(x.id)+'">'+escapeHtml(x.name)+'｜'+escapeHtml(customerTypeName(x.customerType))+(x.memberNo?'｜'+escapeHtml(x.memberNo):'')+'</option>';}).join('');openDrawer('現場銷售結帳','','<form id="checkoutForm"><div class="ops-summary-list"><div class="ops-summary-line"><span>商品數量</span><b>'+sum(state.cart,function(x){return x.qty;})+' 件</b></div><div class="ops-summary-line total"><span>應收金額</span><b>'+money(subtotal)+'</b></div></div><div class="ops-form-grid" style="margin-top:15px"><div class="ops-field"><label class="ops-required">成交時間</label><input class="ops-input" type="datetime-local" name="soldAt" value="'+inputDateTime(new Date())+'" required></div><div class="ops-field"><label>客戶／會員</label><select class="ops-select" name="customerId">'+options+'</select></div><div class="ops-field"><label class="ops-required">付款方式</label><select class="ops-select" name="paymentMethod" required><option>現金</option><option>信用卡</option><option>轉帳</option><option>LINE Pay</option><option>其他</option></select></div><div class="ops-field"><label>收款狀態</label><select class="ops-select" name="paymentStatus"><option value="paid">已收清</option><option value="partial">部分收款</option><option value="unpaid">未收款</option></select></div><div class="ops-field"><label>本次已收金額</label><input class="ops-input" type="number" min="0" step="1" name="receivedAmount" placeholder="已收清可留白"></div><div class="ops-field"><label>折扣</label><input class="ops-input" type="number" min="0" step="1" name="discount" value="0"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note"></textarea></div></div><div class="ops-callout">點數先記錄為 0；老師價只連結價格層級，尚未自動改價。</div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">確認銷售並扣庫存</button></div></form>');}
  async function saveCheckout(form){
    if(!state.cart.length)throw new Error('銷售清單是空的');const data=new FormData(form),discount=numberOrNull(data.get('discount'))||0,soldAt=new Date(clean(data.get('soldAt'))),customerId=clean(data.get('customerId')),customer=state.customers.find(function(x){return x.id===customerId;})||null,paymentStatus=clean(data.get('paymentStatus'))||'paid';if(Number.isNaN(soldAt.getTime()))throw new Error('成交時間格式不正確');if(paymentStatus!=='paid'&&!customer)throw new Error('未收款或部分收款必須先選擇客戶');const saleNo=uid('SALE'),saleRef=state.db.collection(COLLECTIONS.sales).doc(),receivableRef=state.db.collection(COLLECTIONS.receivables).doc();
    await state.db.runTransaction(async function(tx){const refs=state.cart.map(function(item){return state.db.collection(COLLECTIONS.products).doc(item.productId);}),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));const prepared=[];let subtotal=0,costTotal=0,unknownCostQty=0;
      snaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品主檔不存在：'+state.cart[index].name);const raw=snap.data()||{},item=state.cart[index],current=Number(raw.currentStock||0),qty=Math.max(1,Math.round(Number(item.qty||0)));const unitPrice=Math.max(0,Number(item.unitPrice||0)),fifo=consumeFifo(raw,qty,true);subtotal+=qty*unitPrice;costTotal+=fifo.costTotal;unknownCostQty+=fifo.unknownCostQty;prepared.push({ref:refs[index],raw:raw,item:item,qty:qty,current:current,unitPrice:unitPrice,fifo:fifo});});
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
    if(!state.cart.length)throw new Error('銷售清單是空的');
    const data=new FormData(form),orderType=clean(data.get('orderType'))||'sale',preorder=orderType==='preorder',discount=Math.max(0,numberOrNull(data.get('discount'))||0),soldAt=new Date(),customerId=clean(data.get('customerId')),paymentChoice=clean(data.get('paymentStatus'))||'paid',requestedPoints=preorder?0:Math.max(0,Math.floor(numberOrNull(data.get('pointsToRedeem'))||0)),earnPointsEnabled=data.get('earnPointsEnabled')==='true';
    if(preorder&&!customerId)throw new Error('預購／訂金必須先選擇或新增會員');
    if(!preorder&&paymentChoice!=='paid'&&!customerId)throw new Error('未收款必須選擇會員');
    if(!preorder&&paymentChoice!=='paid'&&requestedPoints>0)throw new Error('未收款不能使用點數');
    const saleNo=uid(preorder?'PRE':'SALE'),saleRef=state.db.collection(COLLECTIONS.sales).doc(),receivableRef=state.db.collection(COLLECTIONS.receivables).doc(),depositPaymentRef=state.db.collection(COLLECTIONS.receivablePayments).doc(),customerRef=customerId?state.db.collection(COLLECTIONS.customers).doc(customerId):null;
    await state.db.runTransaction(async function(tx){
      const refs=state.cart.map(function(item){return state.db.collection(COLLECTIONS.products).doc(item.productId);}),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));const customerSnap=customerRef?await tx.get(customerRef):null,customerRaw=customerSnap&&customerSnap.exists?(customerSnap.data()||{}):null;if(customerRef&&!customerRaw)throw new Error('找不到客戶');
      const prepared=[];let subtotal=0,costTotal=0,unknownCostQty=0;snaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品主檔不存在：'+state.cart[index].name);const raw=snap.data()||{},item=state.cart[index],current=Number(raw.currentStock||0),qty=Math.max(1,Math.round(Number(item.qty||0))),unitPrice=Math.max(0,Number(item.unitPrice||0)),fifo=preorder?{costTotal:0,unknownCostQty:0,breakdown:[],layers:materializeCostLayers(raw),averageCost:numberOrNull(raw.averageCost),inventoryValue:Number(raw.inventoryValue||0),costIncomplete:raw.costIncomplete===true}:consumeFifo(raw,qty,true);subtotal+=qty*unitPrice;if(!preorder){costTotal+=fifo.costTotal;unknownCostQty+=fifo.unknownCostQty;}prepared.push({ref:refs[index],raw:raw,item:item,qty:qty,current:current,unitPrice:unitPrice,fifo:fifo});});
      const customer=customerRaw?normalizeCustomer(Object.assign({__id:customerId},customerRaw)):null,maxPoints=preorder?0:maxRedeemablePoints(customer,Math.max(0,subtotal-discount)),activeRule=membershipRuleForDate(soldAt),redeemStep=Math.max(1,Math.floor(Number(activeRule.redeemPoints||1)));if(requestedPoints>maxPoints)throw new Error('可使用點數不足');if(requestedPoints%redeemStep!==0)throw new Error('點數請依設定單位使用');const pointsRedeemed=requestedPoints,pointValue=pointDiscount(pointsRedeemed,soldAt),orderTotal=Math.max(0,subtotal-discount-pointValue),enteredReceived=numberOrNull(data.get('receivedAmount')),receivedAmount=preorder?Math.min(orderTotal,Math.max(0,enteredReceived||0)):(paymentChoice==='paid'?orderTotal:Math.min(orderTotal,Math.max(0,enteredReceived||0))),actualStatus=receivedAmount>=orderTotal?'paid':receivedAmount>0?'partial':'unpaid',pendingPoints=earnPointsEnabled&&customer&&customer.customerType==='member'?calculatePreparedRewardPoints(prepared,orderTotal,subtotal,soldAt):0,pointsEarned=!preorder&&actualStatus==='paid'?pendingPoints:0,grossProfit=preorder?0:orderTotal-costTotal;
      tx.set(saleRef,{saleNo:saleNo,soldAt:soldAt,preorderAt:preorder?soldAt:'',deliveredAt:preorder?'':soldAt,saleType:preorder?'preorder':'sale',fulfillmentStatus:preorder?'waiting_stock':'delivered',items:prepared.map(function(x){return {productId:x.item.productId,name:x.item.name,sku:x.item.sku,imageUrl:x.item.imageUrl||'',qty:x.qty,unitPrice:x.unitPrice,lineTotal:x.qty*x.unitPrice,lineCost:preorder?0:x.fifo.costTotal,fifoBreakdown:preorder?[]:x.fifo.breakdown,unknownCostQty:preorder?0:x.fifo.unknownCostQty,rewardPercent:productRewardPercent(x.raw,soldAt)};}),subtotal:subtotal,manualDiscount:discount,pointDiscount:pointValue,discount:discount+pointValue,orderTotal:orderTotal,total:preorder?0:orderTotal,costTotal:costTotal,grossProfit:grossProfit,unknownCostQty:unknownCostQty,costMethod:'FIFO',paymentMethod:clean(data.get('paymentMethod')),paymentStatus:actualStatus,receivedAmount:receivedAmount,customerId:customer?customer.id:'',customerName:customer?customer.name:'',customerType:customer?customer.customerType:'walk_in',memberNo:customer?customer.memberNo:'',pricingTier:customer?customer.pricingTier:'retail',pointsRuleYear:activeRule.year,pointsRulePercent:activeRule.rewardPercent,earnPointsEnabled:earnPointsEnabled,pointsEarned:pointsEarned,pendingPointsEarned:preorder?pendingPoints:(actualStatus==='paid'?0:pendingPoints),pointsRedeemed:pointsRedeemed,note:preorder?'預購／訂金，等待到貨交付':'',status:preorder?'awaiting_fulfillment':'completed',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      if(customer&&!preorder){let balance=Math.max(0,Number(customerRaw.pointBalance||0));if(pointsRedeemed){balance-=pointsRedeemed;const pointRef=state.db.collection(COLLECTIONS.points).doc();tx.set(pointRef,{customerId:customer.id,saleId:saleRef.id,type:'redeem',points:-pointsRedeemed,balanceAfter:balance,note:saleNo,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}if(pointsEarned){balance+=pointsEarned;const pointRef=state.db.collection(COLLECTIONS.points).doc();tx.set(pointRef,{customerId:customer.id,saleId:saleRef.id,type:'earn',points:pointsEarned,balanceAfter:balance,note:saleNo,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}if(pointsRedeemed||pointsEarned)tx.update(customerRef,{pointBalance:balance,updatedAt:serverTimestamp()});}
      if(actualStatus!=='paid')tx.set(receivableRef,{receivableNo:uid('AR'),sourceType:'sale',saleId:saleRef.id,saleNo:saleNo,customerId:customer.id,customerName:customer.name,totalAmount:orderTotal,receivedAmount:receivedAmount,outstandingAmount:orderTotal-receivedAmount,status:actualStatus,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      if(preorder&&receivedAmount>0)tx.set(depositPaymentRef,{receivableId:actualStatus!=='paid'?receivableRef.id:'',sourceType:'sale',saleId:saleRef.id,customerId:customer.id,amount:receivedAmount,paymentMethod:clean(data.get('paymentMethod')),paidAt:soldAt,note:'預購訂金｜'+saleNo,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      if(!preorder)prepared.forEach(function(x){const after=x.current-x.qty;tx.update(x.ref,{currentStock:after,costLayers:x.fifo.layers,averageCost:x.fifo.averageCost,inventoryValue:x.fifo.inventoryValue,costIncomplete:x.fifo.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});queueInventorySyncInTransaction(tx,x.item.productId,x.item.sku,after,'storeSale');const tRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(tRef,{type:'sale',productId:x.item.productId,productName:x.item.name,sku:x.item.sku,qtyChange:-x.qty,beforeStock:x.current,afterStock:after,unitCost:x.qty?x.fifo.costTotal/x.qty:null,costMethod:'FIFO',fifoBreakdown:x.fifo.breakdown,referenceType:'storeSale',referenceId:saleNo,note:'現場銷售',occurredAt:soldAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
    });
    await writeAudit(preorder?'建立預購／訂金單':'完成現場銷售',preorder?'preorder':'storeSale',saleRef.id,saleNo);state.cart=[];state.posSearch='';state.selectedCustomerId='';state.posCustomerMode='walkin';state.posMemberSearch='';state.posMemberPickerOpen=false;state.checkoutPaymentMethod='現金';state.checkoutPaymentStatus='paid';state.checkoutOrderType='sale';state.checkoutDiscount=0;state.checkoutPoints=0;state.checkoutPointsTouched=false;state.checkoutEarnPoints=true;state.checkoutActualCash='';state.checkoutReceived='';toast(preorder?'預購單已建立':'現場銷售完成',preorder?saleNo+'｜等待到貨交付':saleNo,'success');await loadAll(true);
  }
  async function saveStockUsage(form){
    if(!state.cart.length)throw new Error('耗用清單是空的');
    const data=new FormData(form),usageReason=clean(data.get('usageReason'))||'店內自用',usageNote=clean(data.get('usageNote')),occurredAt=new Date(),usageNo=uid('USE'),saleRef=state.db.collection(COLLECTIONS.sales).doc();
    await state.db.runTransaction(async function(tx){
      const refs=state.cart.map(function(item){return state.db.collection(COLLECTIONS.products).doc(item.productId);}),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));
      const prepared=[];let subtotal=0,costTotal=0,unknownCostQty=0;
      snaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品主檔不存在：'+state.cart[index].name);const raw=snap.data()||{},item=state.cart[index],current=Number(raw.currentStock||0),qty=Math.max(1,Math.round(Number(item.qty||0)));if(current<qty)throw new Error(item.name+' 庫存不足，目前 '+current);const unitPrice=Math.max(0,Number(item.unitPrice||0)),fifo=consumeFifo(raw,qty);subtotal+=qty*unitPrice;costTotal+=fifo.costTotal;unknownCostQty+=fifo.unknownCostQty;prepared.push({ref:refs[index],raw:raw,item:item,qty:qty,current:current,unitPrice:unitPrice,fifo:fifo});});
      tx.set(saleRef,{saleNo:usageNo,soldAt:occurredAt,saleType:'internalUse',usageReason:usageReason,usageNote:usageNote,items:prepared.map(function(x){return {productId:x.item.productId,name:x.item.name,sku:x.item.sku,imageUrl:x.item.imageUrl||'',qty:x.qty,unitPrice:x.unitPrice,lineTotal:x.qty*x.unitPrice,lineCost:x.fifo.costTotal,fifoBreakdown:x.fifo.breakdown,unknownCostQty:x.fifo.unknownCostQty,rewardPercent:0};}),subtotal:subtotal,manualDiscount:0,pointDiscount:0,discount:0,total:subtotal,costTotal:costTotal,grossProfit:subtotal-costTotal,unknownCostQty:unknownCostQty,costMethod:'FIFO',paymentMethod:'內部耗用',paymentStatus:'paid',receivedAmount:subtotal,customerId:'',customerName:'',customerType:'internal',memberNo:'',pricingTier:'internal',earnPointsEnabled:false,pointsEarned:0,pendingPointsEarned:0,pointsRedeemed:0,note:[usageReason,usageNote].filter(Boolean).join('｜'),status:'completed',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      prepared.forEach(function(x){const after=x.current-x.qty;tx.update(x.ref,{currentStock:after,costLayers:x.fifo.layers,averageCost:x.fifo.averageCost,inventoryValue:x.fifo.inventoryValue,costIncomplete:x.fifo.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});queueInventorySyncInTransaction(tx,x.item.productId,x.item.sku,after,'internalUse');const inventoryRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(inventoryRef,{type:usageReason==='報廢'?'scrap':'internalUse',productId:x.item.productId,productName:x.item.name,sku:x.item.sku,qtyChange:0-x.qty,beforeStock:x.current,afterStock:after,unitCost:x.qty?x.fifo.costTotal/x.qty:null,costMethod:'FIFO',fifoBreakdown:x.fifo.breakdown,referenceType:'internalUse',referenceId:usageNo,note:'內部耗用／報廢｜'+usageReason+(usageNote?'｜'+usageNote:''),occurredAt:occurredAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
    });
    await writeAudit('內部耗用／報廢','internalUse',saleRef.id,usageNo+'｜'+usageReason+'｜'+money(sum(state.cart,function(item){return item.qty*item.unitPrice;})));state.cart=[];state.posSearch='';state.stockUsageReason='店內自用';state.stockUsageNote='';toast('庫存已扣除',usageNo+'｜'+usageReason,'success');await loadAll(true);
  }
  function openQuickIncome(category){
    const preset=clean(category);
    openDrawer(preset||'新增其他收入','','<form id="quickIncomeForm"><div class="ops-form-grid"><div class="ops-field"><label class="ops-required">收入日期</label><input class="ops-input" type="datetime-local" name="occurredAt" value="'+inputDateTime(new Date())+'" required></div><div class="ops-field"><label class="ops-required">收入類別</label><input class="ops-input" name="category" value="'+attr(preset)+'" placeholder="例如：維修收入" required></div><div class="ops-field"><label class="ops-required">金額</label><input class="ops-input" type="number" min="0" step="1" name="amount" required></div><div class="ops-field"><label>付款方式</label><select class="ops-select" name="paymentMethod"><option>現金</option><option>信用卡</option><option>轉帳</option><option>LINE Pay</option><option>其他</option></select></div><div class="ops-field"><label>客戶姓名</label><input class="ops-input" name="customerName"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note"></textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存收入</button></div></form>');
  }
  async function saveQuickIncome(form){
    const data=new FormData(form),amount=numberOrNull(data.get('amount')),customerId=clean(data.get('customerId')),customer=state.customers.find(function(x){return x.id===customerId;})||null,paymentChoice=clean(data.get('paymentStatus'))||'paid';if(amount==null||amount<0)throw new Error('請填寫正確金額');if(paymentChoice!=='paid'&&!customer)throw new Error('未收款必須選擇客戶');const entered=numberOrNull(data.get('receivedAmount')),received=paymentChoice==='paid'?amount:Math.min(amount,Math.max(0,entered||0)),status=received>=amount?'paid':received>0?'partial':'unpaid',no=uid('INC'),ref=state.db.collection(COLLECTIONS.incomes).doc(),receivableRef=state.db.collection(COLLECTIONS.receivables).doc(),occurredAt=new Date(clean(data.get('occurredAt')));
    await state.db.runTransaction(async function(tx){tx.set(ref,{incomeNo:no,occurredAt:occurredAt,category:clean(data.get('category'))||'其他收入',itemName:clean(data.get('itemName')),amount:amount,paymentMethod:clean(data.get('paymentMethod')),paymentStatus:status,receivedAmount:received,customerId:customer?customer.id:'',customerName:customer?customer.name:'',note:clean(data.get('note')),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});if(status!=='paid')tx.set(receivableRef,{receivableNo:uid('AR'),sourceType:'income',incomeId:ref.id,incomeNo:no,customerId:customer.id,customerName:customer.name,totalAmount:amount,receivedAmount:received,outstandingAmount:amount-received,status:status,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
    await writeAudit('新增收入','quickIncome',ref.id,no+'｜'+money(amount));state.salesMode='product';state.selectedCustomerId='';state.posCustomerMode='walkin';state.checkoutPaymentMethod='現金';state.checkoutPaymentStatus='paid';state.checkoutReceived='';state.directIncomeAmount='';closeDrawer();toast('收入已儲存',no,'success');await loadAll(true);
  }
  function openIncomeEdit(id){
    const income=state.incomes.find(function(row){return row.id===id;});if(!income)return;
    const customer=state.customers.find(function(row){return row.id===income.customerId;})||null,walkin=!customer,status=clean(income.paymentStatus)||'paid',category=income.category==='維修收入'?'維修收入':'其他收入',options=['現金','信用卡','轉帳','LINE Pay','其他'].map(function(value){return '<option '+(income.paymentMethod===value?'selected':'')+'>'+value+'</option>';}).join(''),statusOptions=(walkin?['paid']:['paid','partial','unpaid']).map(function(value){const label=value==='paid'?'已收清':value==='partial'?'部分收款':'未收款';return '<option value="'+value+'" '+(status===value?'selected':'')+'>'+label+'</option>';}).join('');
    openDrawer('修改'+category,income.incomeNo,'<form id="incomeEditForm" data-id="'+attr(income.id)+'"><div class="ops-form-grid"><div class="ops-field"><label>收入日期</label><input class="ops-input" type="datetime-local" name="occurredAt" value="'+attr(inputDateTime(dateFrom(income.occurredAt)||new Date()))+'" required></div><div class="ops-field"><label>收入類型</label><input class="ops-input" value="'+attr(category)+'" readonly><input type="hidden" name="category" value="'+attr(category)+'"></div><div class="ops-field full"><label class="ops-required">'+(category==='維修收入'?'維修項目':'收入項目')+'</label><input class="ops-input" name="itemName" value="'+attr(income.itemName||'')+'" required></div><div class="ops-field"><label class="ops-required">金額</label><input class="ops-input" type="number" min="0" step="1" name="amount" value="'+attr(income.amount)+'" required></div><div class="ops-field"><label>付款方式</label><select class="ops-select" name="paymentMethod">'+options+'</select></div><div class="ops-field"><label>收款狀態</label><select class="ops-select" name="paymentStatus">'+statusOptions+'</select></div><div class="ops-field"><label>本次已收</label><input class="ops-input" type="number" min="0" step="1" name="receivedAmount" value="'+attr(income.receivedAmount)+'"></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note">'+escapeHtml(income.note)+'</textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button danger-outline" type="button" data-action="income-void" data-id="'+attr(income.id)+'">刪除這筆收入</button><button class="ops-button primary" type="submit">儲存修改</button></div></form>');
  }
  async function saveIncomeEdit(form){
    const id=clean(form.dataset.id),income=state.incomes.find(function(row){return row.id===id;});if(!income)throw new Error('找不到收入紀錄');const data=new FormData(form),amount=numberOrNull(data.get('amount'));if(amount==null||amount<0)throw new Error('請填寫正確金額');const customer=state.customers.find(function(row){return row.id===income.customerId;})||null,choice=clean(data.get('paymentStatus'))||'paid';if(choice!=='paid'&&!customer)throw new Error('沒有客戶資料的紀錄只能設定為已收清');const entered=numberOrNull(data.get('receivedAmount')),received=choice==='paid'?amount:Math.min(amount,Math.max(0,entered||0)),status=received>=amount?'paid':received>0?'partial':'unpaid',incomeRef=state.db.collection(COLLECTIONS.incomes).doc(id),existingReceivable=state.receivables.find(function(row){return row.incomeId===id;})||null,receivableRef=existingReceivable?state.db.collection(COLLECTIONS.receivables).doc(existingReceivable.id):state.db.collection(COLLECTIONS.receivables).doc(),occurredAt=new Date(clean(data.get('occurredAt')));if(Number.isNaN(occurredAt.getTime()))throw new Error('收入日期不正確');
    await state.db.runTransaction(async function(tx){const snap=await tx.get(incomeRef);if(!snap.exists)throw new Error('收入紀錄不存在');tx.update(incomeRef,{occurredAt:occurredAt,category:clean(data.get('category'))||'其他收入',itemName:clean(data.get('itemName')),amount:amount,paymentMethod:clean(data.get('paymentMethod')),paymentStatus:status,receivedAmount:received,note:clean(data.get('note')),updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION});if(status==='paid'){if(existingReceivable)tx.set(receivableRef,{totalAmount:amount,receivedAmount:amount,outstandingAmount:0,status:'paid',updatedAt:serverTimestamp(),updatedBy:userLabel()},{merge:true});}else{const payload={receivableNo:existingReceivable?existingReceivable.receivableNo:uid('AR'),sourceType:'income',incomeId:id,incomeNo:income.incomeNo,customerId:customer.id,customerName:customer.name,totalAmount:amount,receivedAmount:received,outstandingAmount:amount-received,status:status,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};if(!existingReceivable){payload.createdAt=serverTimestamp();payload.createdBy=userLabel();}tx.set(receivableRef,payload,{merge:true});}});
    await writeAudit('修改收入','quickIncome',id,income.incomeNo+'｜'+money(amount));closeDrawer();toast('收入紀錄已修改',income.incomeNo,'success');await loadAll(true);
  }
  function openReceivablePayment(id){const r=state.receivables.find(function(x){return x.id===id;});if(!r)return;openDrawer('登記收款',r.customerName+'｜'+r.receivableNo,'<form id="receivablePaymentForm" data-id="'+attr(r.id)+'"><div class="ops-summary-list"><div class="ops-summary-line"><span>目前尚未收</span><b>'+money(r.outstandingAmount)+'</b></div></div><div class="ops-form-grid" style="margin-top:15px"><div class="ops-field"><label class="ops-required">收款日期</label><input class="ops-input" type="datetime-local" name="paidAt" value="'+inputDateTime(new Date())+'" required></div><div class="ops-field"><label class="ops-required">本次收款</label><input class="ops-input" type="number" min="1" max="'+r.outstandingAmount+'" step="1" name="amount" value="'+r.outstandingAmount+'" required></div><div class="ops-field"><label>付款方式</label><select class="ops-select" name="paymentMethod"><option>現金</option><option>信用卡</option><option>轉帳</option><option>LINE Pay</option><option>其他</option></select></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="note"></textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">確認收款</button></div></form>');}
  async function saveReceivablePayment(form){
    const id=clean(form.dataset.id),data=new FormData(form),amount=numberOrNull(data.get('amount')),ref=state.db.collection(COLLECTIONS.receivables).doc(id),paymentRef=state.db.collection(COLLECTIONS.receivablePayments).doc();if(!amount||amount<=0)throw new Error('收款金額不正確');
    await state.db.runTransaction(async function(tx){
      const receivableSnap=await tx.get(ref);if(!receivableSnap.exists)throw new Error('找不到應收帳款');const raw=receivableSnap.data()||{},r=normalizeReceivable(Object.assign({__id:id},raw));if(amount>r.outstandingAmount)throw new Error('收款金額超過未收金額');const sourceRef=r.sourceType==='income'&&r.incomeId?state.db.collection(COLLECTIONS.incomes).doc(r.incomeId):(r.saleId?state.db.collection(COLLECTIONS.sales).doc(r.saleId):null),sourceSnap=sourceRef?await tx.get(sourceRef):null,customerRef=r.customerId?state.db.collection(COLLECTIONS.customers).doc(r.customerId):null,customerSnap=customerRef?await tx.get(customerRef):null,received=r.receivedAmount+amount,outstanding=Math.max(0,r.totalAmount-received),status=outstanding===0?'paid':'partial';
      tx.update(ref,{receivedAmount:received,outstandingAmount:outstanding,status:status,updatedAt:serverTimestamp(),updatedBy:userLabel()});tx.set(paymentRef,{receivableId:r.id,sourceType:r.sourceType,saleId:r.saleId,incomeId:r.incomeId,customerId:r.customerId,amount:amount,paymentMethod:clean(data.get('paymentMethod')),paidAt:new Date(clean(data.get('paidAt'))),note:clean(data.get('note')),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});if(sourceRef)tx.set(sourceRef,{receivedAmount:received,paymentStatus:status,updatedAt:serverTimestamp()},{merge:true});
      if(status==='paid'&&r.sourceType==='sale'&&sourceSnap&&sourceSnap.exists&&customerSnap&&customerSnap.exists&&clean((sourceSnap.data()||{}).fulfillmentStatus)!=='waiting_stock'){const sale=sourceSnap.data()||{},pending=Math.max(0,Math.floor(Number(sale.pendingPointsEarned||0)));if(pending){const balance=Math.max(0,Number((customerSnap.data()||{}).pointBalance||0))+pending,pointRef=state.db.collection(COLLECTIONS.points).doc();tx.update(customerRef,{pointBalance:balance,updatedAt:serverTimestamp()});tx.set(pointRef,{customerId:r.customerId,saleId:r.saleId,type:'earn',points:pending,balanceAfter:balance,note:clean(sale.saleNo),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});tx.set(sourceRef,{pointsEarned:pending,pendingPointsEarned:0},{merge:true});}}
    });
    await writeAudit('登記應收款','receivable',id,money(amount));closeDrawer();toast('收款已登記',money(amount),'success');await loadAll(true);
  }
  function restoreSaleItemToStock(raw,item,qtyOverride){
    const layers=materializeCostLayers(raw),breakdown=Array.isArray(item.fifoBreakdown)?item.fifoBreakdown:[],fallbackQty=Math.max(0,Math.floor(Number(qtyOverride==null?item.qty:qtyOverride)||0));if(breakdown.length){let remaining=fallbackQty;breakdown.forEach(function(part,index){const qty=Math.min(remaining,Math.max(0,Number(part.qty||0)));if(!qty)return;remaining-=qty;let layer=layers.find(function(x){return x.layerId===clean(part.layerId);});if(layer){layer.qtyRemaining+=qty;layer.originalQty=Math.max(layer.originalQty||0,layer.qtyRemaining);}else layers.push({layerId:clean(part.layerId)||('RESTORE-'+index),qtyRemaining:qty,originalQty:qty,unitCost:numberOrNull(part.unitCost),costKnown:numberOrNull(part.unitCost)!=null,receivedAt:'1970-01-01T00:00:00.000Z',referenceType:'saleRestore',referenceId:clean(item.sku)});});if(remaining>0){const lineCost=numberOrNull(item.lineCost),unit=lineCost==null?null:lineCost/Math.max(1,Number(item.qty||fallbackQty));layers.push({layerId:uid('RESTORE'),qtyRemaining:remaining,originalQty:remaining,unitCost:unit,costKnown:unit!=null,receivedAt:'1970-01-01T00:00:00.000Z',referenceType:'saleRestore',referenceId:clean(item.sku)});}}else if(fallbackQty){const lineCost=numberOrNull(item.lineCost),unit=lineCost==null?null:lineCost/Math.max(1,Number(item.qty||fallbackQty));layers.push({layerId:uid('RESTORE'),qtyRemaining:fallbackQty,originalQty:fallbackQty,unitCost:unit,costKnown:unit!=null,receivedAt:'1970-01-01T00:00:00.000Z',referenceType:'saleRestore',referenceId:clean(item.sku)});}const stats=statsFromLayers(layers),stock=Number(raw.currentStock||0)+fallbackQty;return {raw:Object.assign({},raw,{currentStock:stock,costLayers:stats.layers}),stock:stock};
  }

  function openPreorderFulfillment(id){
    const sale=state.sales.find(function(row){return row.id===id;});if(!sale)return;
    if(sale.saleType!=='preorder'||sale.fulfillmentStatus==='delivered')return openSaleEdit(id);
    const orderTotal=Math.max(0,Number(sale.orderTotal||sale.subtotal-sale.discount||0)),received=Math.max(0,Number(sale.receivedAmount||0)),outstanding=Math.max(0,orderTotal-received),items=(sale.items||[]).map(function(item){const product=catalogById(item.productId),stock=Number(product&&product.currentStock||0),enough=stock>=Number(item.qty||0);return '<div class="ops-sale-edit-row"><div><b>'+escapeHtml(item.name)+'</b><span>'+escapeHtml(item.sku||'')+'｜需要 '+formatNumber(item.qty)+'｜目前庫存 '+formatNumber(stock)+'</span></div><strong>'+statusTag(enough?'可交貨':'尚未入庫',enough?'green':'yellow')+'</strong></div>';}).join('');
    openDrawer('預購到貨交付',sale.saleNo,'<form id="preorderFulfillmentForm" data-id="'+attr(sale.id)+'"><div class="ops-member-payment-summary"><div><span>客戶</span><b>'+escapeHtml(sale.customerName||'未指定')+'</b></div><div><span>訂單總額</span><b>'+money(orderTotal)+'</b></div><div><span>目前已收</span><b>'+money(received)+'</b></div><div><span>剩餘尾款</span><b>'+money(outstanding)+'</b></div></div><div class="ops-sale-edit-items">'+items+'</div><div class="ops-callout green"><b>確認後才會正式扣庫存</b><br><span>如果任何商品尚未入庫，系統會阻止交貨，不會讓這張預購單造成負庫存。</span></div><div class="ops-form-grid"><div class="ops-field"><label>本次收取尾款</label><input class="ops-input ops-number-clean" type="number" min="0" max="'+outstanding+'" step="1" name="receivedAmount" value="'+outstanding+'" '+(outstanding?'':'readonly')+'></div><div class="ops-field"><label>尾款方式</label><select class="ops-select" name="paymentMethod"><option>現金</option><option>信用卡</option><option>轉帳</option><option>LINE Pay</option><option>其他</option></select></div><div class="ops-field full"><label>交貨備註</label><textarea class="ops-textarea" name="note" placeholder="例如：門市自取、已通知客人"></textarea></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button danger-outline" type="button" data-action="sale-void" data-id="'+attr(sale.id)+'">刪除這筆訂單</button><button class="ops-button primary" type="submit">確認交貨並扣庫存</button></div></form>');
  }
  async function savePreorderFulfillment(form){
    const id=clean(form.dataset.id),data=new FormData(form),additional=Math.max(0,numberOrNull(data.get('receivedAmount'))||0),deliveredAt=new Date(),saleRef=state.db.collection(COLLECTIONS.sales).doc(id),existingReceivable=state.receivables.find(function(row){return row.saleId===id;})||null,receivableRef=existingReceivable?state.db.collection(COLLECTIONS.receivables).doc(existingReceivable.id):state.db.collection(COLLECTIONS.receivables).doc(),paymentRef=state.db.collection(COLLECTIONS.receivablePayments).doc();
    await state.db.runTransaction(async function(tx){
      const saleSnap=await tx.get(saleRef);if(!saleSnap.exists)throw new Error('找不到預購單');const rawSale=saleSnap.data()||{};if(clean(rawSale.saleType)!=='preorder'||clean(rawSale.fulfillmentStatus)==='delivered')throw new Error('這張訂單已完成交貨');const items=Array.isArray(rawSale.items)?rawSale.items:[],productRefs=items.map(function(item){return state.db.collection(COLLECTIONS.products).doc(clean(item.productId));}),productSnaps=[];for(const ref of productRefs)productSnaps.push(await tx.get(ref));const receivableSnap=existingReceivable?await tx.get(receivableRef):null,customerRef=rawSale.customerId?state.db.collection(COLLECTIONS.customers).doc(clean(rawSale.customerId)):null,customerSnap=customerRef?await tx.get(customerRef):null;
      const prepared=[];let costTotal=0,unknownCostQty=0;productSnaps.forEach(function(snap,index){const item=items[index];if(!snap.exists)throw new Error('商品主檔不存在：'+clean(item.name));const raw=snap.data()||{},current=Number(raw.currentStock||0),qty=Math.max(1,Math.round(Number(item.qty||0)));if(current<qty)throw new Error(clean(item.name)+' 尚未入庫，目前 '+current+'，需要 '+qty);const fifo=consumeFifo(raw,qty,false),after=current-qty;costTotal+=fifo.costTotal;unknownCostQty+=fifo.unknownCostQty;prepared.push({ref:productRefs[index],raw:raw,item:item,qty:qty,current:current,after:after,fifo:fifo});});
      const orderTotal=Math.max(0,Number(rawSale.orderTotal||rawSale.subtotal||0)-Number(rawSale.orderTotal?0:rawSale.discount||0)),alreadyReceived=Math.max(0,Number(rawSale.receivedAmount||0)),outstandingBefore=Math.max(0,orderTotal-alreadyReceived);if(additional>outstandingBefore)throw new Error('本次收款超過剩餘尾款');const receivedAmount=Math.min(orderTotal,alreadyReceived+additional),outstanding=Math.max(0,orderTotal-receivedAmount),paymentStatus=outstanding===0?'paid':receivedAmount>0?'partial':'unpaid',pendingPoints=Math.max(0,Math.floor(Number(rawSale.pendingPointsEarned||0))),awardPoints=paymentStatus==='paid'?pendingPoints:0;
      const nextItems=prepared.map(function(x){return Object.assign({},x.item,{lineCost:x.fifo.costTotal,fifoBreakdown:x.fifo.breakdown,unknownCostQty:x.fifo.unknownCostQty});});
      tx.set(saleRef,{soldAt:deliveredAt,deliveredAt:deliveredAt,fulfillmentStatus:'delivered',status:'completed',items:nextItems,total:orderTotal,costTotal:costTotal,grossProfit:orderTotal-costTotal,unknownCostQty:unknownCostQty,paymentMethod:additional>0?clean(data.get('paymentMethod')):clean(rawSale.paymentMethod),paymentStatus:paymentStatus,receivedAmount:receivedAmount,pointsEarned:Number(rawSale.pointsEarned||0)+awardPoints,pendingPointsEarned:awardPoints?0:pendingPoints,note:[clean(rawSale.note),clean(data.get('note'))].filter(Boolean).join('｜'),updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});
      prepared.forEach(function(x){tx.update(x.ref,{currentStock:x.after,costLayers:x.fifo.layers,averageCost:x.fifo.averageCost,inventoryValue:x.fifo.inventoryValue,costIncomplete:x.fifo.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});queueInventorySyncInTransaction(tx,clean(x.item.productId),clean(x.item.sku),x.after,'preorderFulfillment');const inventoryRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(inventoryRef,{type:'sale',productId:clean(x.item.productId),productName:clean(x.item.name),sku:clean(x.item.sku),qtyChange:-x.qty,beforeStock:x.current,afterStock:x.after,unitCost:x.qty?x.fifo.costTotal/x.qty:null,costMethod:'FIFO',fifoBreakdown:x.fifo.breakdown,referenceType:'preorderFulfillment',referenceId:clean(rawSale.saleNo),note:'預購到貨交貨',occurredAt:deliveredAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
      if(existingReceivable){tx.set(receivableRef,{totalAmount:orderTotal,receivedAmount:receivedAmount,outstandingAmount:outstanding,status:paymentStatus,updatedAt:serverTimestamp(),updatedBy:userLabel()},{merge:true});}else if(outstanding>0){tx.set(receivableRef,{receivableNo:uid('AR'),sourceType:'sale',saleId:id,saleNo:clean(rawSale.saleNo),customerId:clean(rawSale.customerId),customerName:clean(rawSale.customerName),totalAmount:orderTotal,receivedAmount:receivedAmount,outstandingAmount:outstanding,status:paymentStatus,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}
      if(additional>0)tx.set(paymentRef,{receivableId:existingReceivable?existingReceivable.id:(outstanding>0?receivableRef.id:''),sourceType:'sale',saleId:id,customerId:clean(rawSale.customerId),amount:additional,paymentMethod:clean(data.get('paymentMethod')),paidAt:deliveredAt,note:'預購交貨尾款｜'+clean(rawSale.saleNo),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      if(awardPoints&&customerRef&&customerSnap&&customerSnap.exists){const balance=Math.max(0,Number((customerSnap.data()||{}).pointBalance||0))+awardPoints,pointRef=state.db.collection(COLLECTIONS.points).doc();tx.update(customerRef,{pointBalance:balance,updatedAt:serverTimestamp()});tx.set(pointRef,{customerId:clean(rawSale.customerId),saleId:id,type:'earn',points:awardPoints,balanceAfter:balance,note:clean(rawSale.saleNo),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}
    });
    await writeAudit('完成預購交貨','preorder',id,id+'｜尾款 '+money(additional));closeDrawer();toast('預購已完成交貨','庫存已扣除，訂單已轉為正式銷售。','success');await loadAll(true);
  }

  function openSaleEdit(id){
    const sale=state.sales.find(function(x){return x.id===id;});if(!sale)return;if(sale.saleType==='preorder'&&sale.fulfillmentStatus!=='delivered')return openPreorderFulfillment(id);if(sale.saleType==='internalUse'){
      const reasonOptions=['店內自用','消耗品','報廢','其他'].map(function(value){return '<option value="'+attr(value)+'" '+((sale.usageReason||'店內自用')===value?'selected':'')+'>'+escapeHtml(value)+'</option>';}).join(''),items=(sale.items||[]).map(function(item){return '<div class="ops-sale-edit-row" data-internal-usage-edit-row><input type="hidden" name="productId" value="'+attr(item.productId)+'"><div><b>'+escapeHtml(item.name)+'</b><span>'+escapeHtml(item.sku||'')+'｜原成本 '+money(item.lineCost)+'</span></div><label>數量<input class="ops-input ops-number-clean" type="number" min="1" step="1" name="qty" value="'+Math.max(1,Number(item.qty||1))+'"></label><label>記錄金額<input class="ops-input ops-number-clean" type="number" min="0" step="1" name="unitPrice" value="'+Math.max(0,Number(item.unitPrice||0))+'"></label></div>';}).join('');
      openDrawer('修改內部耗用／報廢',sale.saleNo,'<form id="internalUsageEditForm" data-id="'+attr(sale.id)+'"><div class="ops-form-grid"><div class="ops-field"><label>紀錄時間</label><input class="ops-input" type="datetime-local" name="soldAt" value="'+attr(inputDateTime(dateFrom(sale.soldAt)||new Date()))+'" required></div><div class="ops-field"><label>處理原因</label><select class="ops-select" name="usageReason">'+reasonOptions+'</select></div><div class="ops-field full"><label>備註</label><textarea class="ops-textarea" name="usageNote">'+escapeHtml(sale.usageNote||'')+'</textarea></div></div><div class="ops-sale-edit-items">'+items+'</div><div class="ops-callout">修改數量時，系統會依差額更正中央庫存，並重新排入三個平台的庫存同步。</div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button danger-outline" type="button" data-action="sale-void" data-id="'+attr(sale.id)+'">刪除這筆紀錄</button><button class="ops-button primary" type="submit">儲存修改</button></div></form>');return;
    }const customer=state.customers.find(function(x){return x.id===sale.customerId;})||null,member=customer&&customer.customerType==='member',walkin=!sale.customerId,items=sale.items.map(function(item){return '<div class="ops-sale-edit-row" data-sale-edit-row><input type="hidden" name="productId" value="'+attr(item.productId)+'"><div><b>'+escapeHtml(item.name)+'</b><span>'+escapeHtml(item.sku||'')+'</span></div><label>數量<input class="ops-input ops-number-clean" type="number" min="1" step="1" name="qty" value="'+Math.max(1,Number(item.qty||1))+'"></label><label>售價<input class="ops-input ops-number-clean" type="number" min="0" step="1" name="unitPrice" value="'+Math.max(0,Number(item.unitPrice||0))+'"></label></div>';}).join(''),methodTiles=['現金','信用卡','轉帳'].map(function(value){return '<label class="ops-radio-tile"><input type="radio" name="paymentMethod" value="'+value+'" '+(sale.paymentMethod===value?'checked':'')+'><span>'+value+'</span></label>';}).join(''),statusValues=walkin?['paid']:['paid','partial','unpaid'],statusLabels={paid:'已收清',partial:'部分收款',unpaid:'未收款'},statusTiles=statusValues.map(function(value){return '<label class="ops-radio-tile"><input type="radio" name="paymentStatus" value="'+value+'" '+(sale.paymentStatus===value?'checked':'')+'><span>'+statusLabels[value]+'</span></label>';}).join('');
    const returnedRefund=sum(state.salesReturns.filter(function(row){return row.saleId===sale.id;}),function(row){return row.refundAmount;}),availablePoints=member?Number(customer.pointBalance||0)+Number(sale.pointsRedeemed||0):0,maxPoints=member?maxRedeemablePoints(Object.assign({},customer,{pointBalance:availablePoints}),Math.max(0,Number(sale.subtotal||0)-Number(sale.manualDiscount||0))):0,memberInfo=member?'<div class="ops-member-payment-summary"><div><span>會員</span><b>'+escapeHtml(customer.name)+' '+escapeHtml(customer.memberNo||'')+'</b></div><div><span>目前可用</span><b>'+formatNumber(customer.pointBalance)+' 點</b></div><div><span>本單折抵</span><b>'+formatNumber(sale.pointsRedeemed)+' 點／'+money(sale.pointDiscount)+'</b></div><div><span>本單累積</span><b>'+(sale.earnPointsEnabled===false?'不累積':formatNumber(sale.pointsEarned)+' 點')+'</b></div></div>':'',saleSummary='<div class="ops-summary-list"><div class="ops-summary-line"><span>商品金額</span><b>'+money(sale.subtotal)+'</b></div><div class="ops-summary-line"><span>額外折扣</span><b>'+money(sale.manualDiscount)+'</b></div><div class="ops-summary-line"><span>點數折抵</span><b>'+money(sale.pointDiscount)+'</b></div>'+(returnedRefund?'<div class="ops-summary-line"><span>已退金額</span><b>'+money(returnedRefund)+'</b></div>':'')+'<div class="ops-summary-line total"><span>本單實收</span><b>'+money(sale.total)+'</b></div></div>';
    const pointFields=member?'<div class="ops-checkout-block"><label>本次點數</label><div class="ops-choice-grid two"><label class="ops-radio-tile"><input type="radio" name="earnPointsEnabled" value="true" '+(sale.earnPointsEnabled!==false?'checked':'')+'><span>累積點數</span></label><label class="ops-radio-tile"><input type="radio" name="earnPointsEnabled" value="false" '+(sale.earnPointsEnabled===false?'checked':'')+'><span>不累積點數</span></label></div></div><div class="ops-field"><label>點數折抵</label><input class="ops-input ops-number-clean" type="number" min="0" max="'+maxPoints+'" step="1" name="pointsToRedeem" value="'+Math.max(0,Number(sale.pointsRedeemed||0))+'"></div>':'<input type="hidden" name="earnPointsEnabled" value="false"><input type="hidden" name="pointsToRedeem" value="0">';
    openDrawer('修改單據',sale.saleNo,'<form id="saleEditForm" data-id="'+attr(sale.id)+'">'+memberInfo+saleSummary+'<div class="ops-sale-edit-items">'+items+'</div><div class="ops-checkout-block"><label>付款方式</label><div class="ops-choice-grid">'+methodTiles+'</div></div><div class="ops-checkout-block"><label>收款狀態</label><div class="ops-choice-grid '+(statusValues.length===1?'one':'')+'">'+statusTiles+'</div></div><div class="ops-form-grid"><div class="ops-field"><label>額外折扣</label><input class="ops-input ops-number-clean" type="number" min="0" step="1" name="discount" value="'+sale.manualDiscount+'"></div>'+pointFields+'<div class="ops-field '+(sale.paymentStatus==='partial'?'':'hidden')+'" id="saleEditReceivedField"><label>本次已收</label><input class="ops-input ops-number-clean" type="number" min="0" step="1" name="receivedAmount" value="'+sale.receivedAmount+'"></div></div><div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button danger-outline" type="button" data-action="sale-void" data-id="'+attr(sale.id)+'">刪除這筆訂單</button><button class="ops-button soft" type="button" data-action="sale-return" data-id="'+attr(sale.id)+'">退貨／報廢</button><button class="ops-button primary" type="submit">儲存修改</button></div></form>');
  }
  async function saveInternalUsageEdit(form){
    const id=clean(form.dataset.id),data=new FormData(form),saleRef=state.db.collection(COLLECTIONS.sales).doc(id),rows=queryAll('[data-internal-usage-edit-row]',form),requested=rows.map(function(row){return {productId:clean(query('[name="productId"]',row).value),qty:Math.max(1,Math.floor(Number(query('[name="qty"]',row).value||1))),unitPrice:Math.max(0,Number(query('[name="unitPrice"]',row).value||0))};}),usageReason=clean(data.get('usageReason'))||'店內自用',usageNote=clean(data.get('usageNote')),soldAt=new Date(clean(data.get('soldAt')));if(!requested.length)throw new Error('沒有可修改的商品');if(Number.isNaN(soldAt.getTime()))throw new Error('紀錄時間不正確');
    await state.db.runTransaction(async function(tx){const saleSnap=await tx.get(saleRef);if(!saleSnap.exists)throw new Error('找不到紀錄');const rawSale=saleSnap.data()||{},oldItems=Array.isArray(rawSale.items)?rawSale.items:[],refs=requested.map(function(item){return state.db.collection(COLLECTIONS.products).doc(item.productId);}),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));const prepared=[];let subtotal=0,costTotal=0,unknownCostQty=0;
      snaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品主檔不存在');const raw=snap.data()||{},item=requested[index],oldItem=oldItems.find(function(row){return clean(row.productId)===item.productId;});if(!oldItem)throw new Error('紀錄商品不一致');const current=Number(raw.currentStock||0),oldQty=Math.max(1,Math.floor(Number(oldItem.qty||1)));let after=current,lineCost=Number(oldItem.lineCost||0),fifoBreakdown=Array.isArray(oldItem.fifoBreakdown)?oldItem.fifoBreakdown:[],unknown=Number(oldItem.unknownCostQty||0),productUpdate=null;
        if(item.qty!==oldQty){const restored=restoreSaleItemToStock(raw,oldItem,oldQty);if(restored.stock<item.qty)throw new Error(clean(oldItem.name)+' 庫存不足');const fifo=consumeFifo(restored.raw,item.qty);after=restored.stock-item.qty;lineCost=fifo.costTotal;fifoBreakdown=fifo.breakdown;unknown=fifo.unknownCostQty;productUpdate={currentStock:after,costLayers:fifo.layers,averageCost:fifo.averageCost,inventoryValue:fifo.inventoryValue,costIncomplete:fifo.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()};tx.update(refs[index],productUpdate);queueInventorySyncInTransaction(tx,item.productId,clean(oldItem.sku),after,'internalUseCorrection');const inventoryRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(inventoryRef,{type:'internalUseCorrection',productId:item.productId,productName:clean(oldItem.name),sku:clean(oldItem.sku),qtyChange:oldQty-item.qty,beforeStock:current,afterStock:after,unitCost:item.qty?lineCost/item.qty:null,costMethod:'FIFO',fifoBreakdown:fifoBreakdown,referenceType:'internalUseCorrection',referenceId:clean(rawSale.saleNo)||id,note:'修改內部耗用／報廢｜'+usageReason+(usageNote?'｜'+usageNote:''),occurredAt:soldAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}
        subtotal+=item.qty*item.unitPrice;costTotal+=lineCost;unknownCostQty+=unknown;prepared.push({productId:item.productId,name:clean(oldItem.name),sku:clean(oldItem.sku),imageUrl:clean(oldItem.imageUrl),qty:item.qty,unitPrice:item.unitPrice,lineTotal:item.qty*item.unitPrice,lineCost:lineCost,fifoBreakdown:fifoBreakdown,unknownCostQty:unknown,rewardPercent:0});
      });
      tx.update(saleRef,{soldAt:soldAt,usageReason:usageReason,usageNote:usageNote,items:prepared,subtotal:subtotal,total:subtotal,receivedAmount:subtotal,costTotal:costTotal,grossProfit:subtotal-costTotal,unknownCostQty:unknownCostQty,note:[usageReason,usageNote].filter(Boolean).join('｜'),updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION});
    });
    await writeAudit('修改內部耗用／報廢','internalUse',id,usageReason);closeDrawer();toast('耗用／報廢紀錄已修改','庫存差額已重新排入同步','success');await loadAll(true);
  }
  async function saveSaleEdit(form){
    const id=clean(form.dataset.id),data=new FormData(form),saleRef=state.db.collection(COLLECTIONS.sales).doc(id),formRows=queryAll('[data-sale-edit-row]',form),requestedItems=formRows.map(function(row){return {productId:clean(query('[name="productId"]',row).value),qty:Math.max(1,Math.floor(Number(query('[name="qty"]',row).value||1))),unitPrice:Math.max(0,Number(query('[name="unitPrice"]',row).value||0))};}),paymentMethod=clean(data.get('paymentMethod'))||'現金',paymentStatus=clean(data.get('paymentStatus'))||'paid',manualDiscount=Math.max(0,numberOrNull(data.get('discount'))||0),requestedPoints=Math.max(0,Math.floor(numberOrNull(data.get('pointsToRedeem'))||0)),earnPointsEnabled=data.get('earnPointsEnabled')==='true',existingReceivable=state.receivables.find(function(x){return x.saleId===id;})||null,receivableRef=existingReceivable?state.db.collection(COLLECTIONS.receivables).doc(existingReceivable.id):state.db.collection(COLLECTIONS.receivables).doc();if(!requestedItems.length)throw new Error('單據沒有可修改的商品');
    await state.db.runTransaction(async function(tx){
      const saleSnap=await tx.get(saleRef);if(!saleSnap.exists)throw new Error('找不到單據');const rawSale=saleSnap.data()||{},oldItems=Array.isArray(rawSale.items)?rawSale.items:[],productRefs=requestedItems.map(function(x){return state.db.collection(COLLECTIONS.products).doc(x.productId);}),productSnaps=[];for(const ref of productRefs)productSnaps.push(await tx.get(ref));const customerRef=rawSale.customerId?state.db.collection(COLLECTIONS.customers).doc(rawSale.customerId):null,customerSnap=customerRef?await tx.get(customerRef):null,receivableSnap=existingReceivable?await tx.get(receivableRef):null;if(paymentStatus!=='paid'&&!customerRef)throw new Error('門市散客不能使用未收款');if(paymentStatus!=='paid'&&requestedPoints>0)throw new Error('未收款不能使用點數');
      const prepared=[];let subtotal=0,costTotal=0,unknownCostQty=0;productSnaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品不存在');const requested=requestedItems[index],oldItem=oldItems.find(function(x){return clean(x.productId)===requested.productId;});if(!oldItem)throw new Error('單據商品不一致');const raw=snap.data()||{},restored=restoreSaleItemToStock(raw,oldItem);const fifo=consumeFifo(restored.raw,requested.qty,true),after=restored.stock-requested.qty,lineTotal=requested.qty*requested.unitPrice;subtotal+=lineTotal;costTotal+=fifo.costTotal;unknownCostQty+=fifo.unknownCostQty;prepared.push({ref:productRefs[index],raw:raw,oldItem:oldItem,requested:requested,fifo:fifo,after:after,lineTotal:lineTotal});});
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
  function openPurchase(preselectedId){openPurchaseWorkspace(preselectedId||'');}
  function purchaseRowHtml(selectedId,index){return '<div class="ops-cart-row purchase-row" data-index="'+index+'" style="grid-template-columns:minmax(0,1fr) 80px 110px 34px;margin-bottom:8px"><select class="ops-select" name="productId" required><option value="">選擇商品</option>'+purchaseItemOptions(selectedId)+'</select><input type="number" name="qty" min="1" step="1" value="1" required><input type="number" name="unitCost" min="0" step="0.01" placeholder="單位成本" required><button class="ops-icon-button" type="button" data-action="purchase-remove-row">×</button></div>';}
  async function savePurchaseLegacy(form){
    const data=new FormData(form),rowEls=queryAll('.purchase-row',form),items=[];rowEls.forEach(function(row){const productId=clean(query('[name="productId"]',row).value),qty=numberOrNull(query('[name="qty"]',row).value),unitCost=numberOrNull(query('[name="unitCost"]',row).value);if(productId&&qty>0&&unitCost!=null)items.push({productId:productId,qty:Math.round(qty),unitCost:unitCost});});if(!items.length)throw new Error('至少需要一個有效進貨商品');const duplicate=new Set();for(const item of items){if(duplicate.has(item.productId))throw new Error('同一商品請合併成一列');duplicate.add(item.productId);}const extraCost=numberOrNull(data.get('extraCost'))||0,receivedAt=new Date(clean(data.get('receivedAt')));if(Number.isNaN(receivedAt.getTime()))throw new Error('到貨時間不正確');const purchaseNo=uid('PUR'),purchaseRef=state.db.collection(COLLECTIONS.purchases).doc();
    await state.db.runTransaction(async function(tx){const refs=items.map(function(item){return state.db.collection(COLLECTIONS.products).doc(item.productId);}),snaps=[];for(const ref of refs)snaps.push(await tx.get(ref));const subtotal=sum(items,function(i){return i.qty*i.unitCost;}),prepared=[];snaps.forEach(function(snap,index){if(!snap.exists)throw new Error('商品主檔不存在');const raw=snap.data()||{},item=items[index],before=Number(raw.currentStock||0),base=item.qty*item.unitCost,allocated=subtotal>0?extraCost*(base/subtotal):0,effectiveUnit=item.unitCost+(item.qty?allocated/item.qty:0),after=before+item.qty,added=addFifoLayer(raw,item.qty,effectiveUnit,{layerId:purchaseNo+'-'+index,receivedAt:receivedAt.toISOString(),referenceType:'purchase',referenceId:purchaseNo});prepared.push({ref:refs[index],raw:raw,item:item,before:before,after:after,allocated:allocated,effectiveUnit:effectiveUnit,added:added});});
      tx.set(purchaseRef,{purchaseNo:purchaseNo,externalNo:clean(data.get('externalNo')),receivedAt:receivedAt,supplier:clean(data.get('supplier')),items:prepared.map(function(x){return {productId:x.item.productId,name:clean(x.raw.internalName||x.raw.originalName||x.raw.onlineName),sku:clean(x.raw.internalSku),qty:x.item.qty,unitCost:x.item.unitCost,allocatedExtraCost:x.allocated,effectiveUnitCost:x.effectiveUnit,lineTotal:x.item.qty*x.item.unitCost,layerId:x.added.layers[x.added.layers.length-1].layerId};}),subtotal:subtotal,extraCost:extraCost,totalCost:subtotal+extraCost,costMethod:'FIFO',note:clean(data.get('note')),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});
      prepared.forEach(function(x){tx.update(x.ref,{currentStock:x.after,latestPurchaseCost:x.item.unitCost,costLayers:x.added.layers,averageCost:x.added.averageCost,inventoryValue:x.added.inventoryValue,costIncomplete:x.added.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});queueInventorySyncInTransaction(tx,x.item.productId,clean(x.raw.internalSku),x.after,'purchase');const tRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(tRef,{type:'purchase',productId:x.item.productId,productName:clean(x.raw.internalName||x.raw.originalName||x.raw.onlineName),sku:clean(x.raw.internalSku),qtyChange:x.item.qty,beforeStock:x.before,afterStock:x.after,unitCost:x.effectiveUnit,costMethod:'FIFO',referenceType:'purchase',referenceId:purchaseNo,note:'進貨入庫｜'+clean(data.get('supplier')),occurredAt:receivedAt,createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
    });await writeAudit('進貨驗收入庫','purchase',purchaseRef.id,purchaseNo+'｜'+clean(data.get('supplier'))+'｜'+items.length+'項｜FIFO');resetPurchaseEntry();state.purchaseWorkspaceTab='inbound';location.hash='purchases';toast('進貨入庫完成',purchaseNo,'success');await loadAll(true);
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
    const header=['code','name','salePrice','easyStorePrice','momoPrice','coupangPrice','purchasePrice','withoutWarehouseStocks','reservedStock','safetyStock','onlineName','onlinePrice','matchedOnline','imageUrl','saleRewardPercent','remark'];
    const rows=state.catalog.filter(function(p){return p.initialized;}).map(function(p){const i=p.internal||{};return [p.sku,p.originalName||'',p.storePrice==null?'':p.storePrice,p.easyStorePrice==null?'':p.easyStorePrice,p.momoPrice==null?'':p.momoPrice,p.coupangPrice==null?'':p.coupangPrice,p.latestPurchaseCost==null?'':p.latestPurchaseCost,p.currentStock,p.reservedStock,p.safetyStock,p.onlineName||'',p.onlinePrice==null?'':p.onlinePrice,p.matchedOnline?'是':'否',p.imageUrl||'',p.saleRewardPercent==null?'':p.saleRewardPercent,i.note||''];});
    const csv='\uFEFF'+[header].concat(rows).map(function(r){return r.map(csvCell).join(',');}).join('\r\n'); downloadBlob('營運中心_商品主檔匯入範本_'+dateText(new Date())+'.csv',csv,'text/csv;charset=utf-8');
  }
  function exportBackup(){
    const payload={exportedAt:new Date().toISOString(),version:VERSION,projectId:(global.APP_CONFIG&&APP_CONFIG.FIREBASE_CONFIG&&APP_CONFIG.FIREBASE_CONFIG.projectId)||'',onlineSource:state.onlineSource,data:{internalProducts:state.internalProducts,sales:state.sales,salesReturns:state.salesReturns,incomes:state.incomes,customers:state.customers,pointTransactions:state.pointTransactions,receivables:state.receivables,receivablePayments:state.receivablePayments,membershipSettings:state.membershipSettings,purchases:state.purchases,inventoryTransactions:state.inventory,rentalLedgers:state.rentalLedgers,cases:state.cases,expenses:state.expenses,syncJobs:state.syncJobs,educationDaily:state.educationDaily,auditLogs:state.audit}};
    downloadBlob('全通路營運中心_備份_'+dateText(new Date())+'.json',JSON.stringify(payload,null,2),'application/json;charset=utf-8'); toast('備份已下載','請妥善保存 JSON 檔。','success');
  }
  function exportFinance(){
    const sales=rangeRows(state.sales,function(x){return x.soldAt;}); const incomes=rangeRows(state.incomes,function(x){return x.occurredAt;}); const expenses=rangeRows(state.expenses,function(x){return x.occurredAt;}); const rows=[['日期','類型','編號／類別','收入','成本／支出','付款方式','備註']];
    sales.forEach(function(x){rows.push([dateTimeText(x.soldAt),x.saleType==='internalUse'?'內部耗用／報廢':'現場銷售',x.saleNo,x.total,x.costTotal,x.saleType==='internalUse'?(x.usageReason||'內部耗用'):x.paymentMethod,x.usageNote||x.note]);}); incomes.forEach(function(x){rows.push([dateTimeText(x.occurredAt),'快速收入',x.category,x.amount,0,x.paymentMethod,x.note]);}); expenses.forEach(function(x){rows.push([dateTimeText(x.occurredAt),'一般支出',x.category,0,x.amount,x.paymentMethod,x.note]);});
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
    state.importRows=rows.map(function(row,index){const sku=normalizeCode(importValue(row,['code','internalSku','sku','商品編號','內部商品編號'])),name=clean(importValue(row,['name','internalName','商品名稱','品名'])),cost=numberOrNull(importValue(row,['purchasePrice','latestPurchaseCost','進貨成本','最近進貨成本'])),stock=numberOrNull(importValue(row,['withoutWarehouseStocks','currentStock','stock','庫存','現有庫存']));return {row:index+2,internalSku:sku,internalName:name,storePrice:numberOrNull(importValue(row,['salePrice','storePrice','門市售價','售價'])),easyStorePrice:numberOrNull(importValue(row,['easyStorePrice','EASY STORE 售價','EasyStore售價'])),momoPrice:numberOrNull(importValue(row,['momoPrice','MOMO 售價','MOMO售價'])),coupangPrice:numberOrNull(importValue(row,['coupangPrice','Coupang 售價','酷澎售價'])),latestPurchaseCost:cost,currentStock:stock,saleRewardPercent:numberOrNull(importValue(row,['saleRewardPercent','獎金比例'])),note:clean(importValue(row,['remark','note','備註']))};}).filter(function(r){return r.internalSku||r.internalName;});
    const valid=state.importRows.filter(function(r){return r.internalSku;}),missingName=valid.filter(function(r){return !r.internalName;}).length,negative=valid.filter(function(r){return r.currentStock!=null&&r.currentStock<0;}).length,missingCost=valid.filter(function(r){return r.latestPurchaseCost==null;}).length,zeroCost=valid.filter(function(r){return r.latestPurchaseCost===0;}).length,positive=valid.filter(function(r){return r.currentStock>0;}).length,onlineSku=new Set(state.onlineProducts.map(function(x){return x.sku;}).filter(Boolean)),matched=valid.filter(function(r){return onlineSku.has(r.internalSku);}).length;
    state.importSummary={total:state.importRows.length,valid:valid.length,missingName:missingName,negative:negative,missingCost:missingCost,zeroCost:zeroCost,positive:positive,matched:matched};
    html('importPreview','<div class="ops-summary-list"><div class="ops-summary-line"><span>檔案</span><b>'+escapeHtml(file.name)+'</b></div><div class="ops-summary-line"><span>有效 SKU</span><b>'+formatNumber(valid.length)+'</b></div><div class="ops-summary-line"><span>預估可配對網路商品</span><b>'+formatNumber(matched)+'</b></div><div class="ops-summary-line"><span>有正庫存</span><b>'+formatNumber(positive)+'</b></div><div class="ops-summary-line"><span>負庫存（保留原值）</span><b>'+formatNumber(negative)+'</b></div><div class="ops-summary-line"><span>名稱空白</span><b>'+formatNumber(missingName)+'</b></div><div class="ops-summary-line"><span>成本空白／成本為零</span><b>'+formatNumber(missingCost)+' / '+formatNumber(zeroCost)+'</b></div></div>'+(valid.length?'<div class="ops-table-wrap" style="margin-top:12px"><table class="ops-table"><thead><tr><th>列</th><th>SKU</th><th>原始名稱</th><th class="num">定價</th><th class="num">成本</th><th class="num">庫存</th></tr></thead><tbody>'+valid.slice(0,20).map(function(r){return '<tr><td>'+r.row+'</td><td>'+escapeHtml(r.internalSku)+'</td><td>'+escapeHtml(r.internalName||'（名稱空白）')+'</td><td class="num">'+money(r.storePrice)+'</td><td class="num">'+money(r.latestPurchaseCost)+'</td><td class="num">'+formatNumber(r.currentStock)+'</td></tr>';}).join('')+'</tbody></table></div>':''));const btn=byId('confirmImportBtn');if(btn)btn.disabled=!valid.length;
  }
  async function importProducts(){
    const rows=state.importRows.filter(function(r){return r.internalSku;}),mode=(byId('importMode')&&byId('importMode').value)||'initial';if(!rows.length)return;const initial=mode==='initial';const yes=await confirmAction(initial?'確認建立中央商品主檔':'確認更新中央商品基本資料',(initial?'將以 Excel 建立／更新 '+rows.length+' 筆中央商品，匯入真實庫存與期初成本，並建立 FIFO 成本批次。':'將更新 '+rows.length+' 筆名稱、定價與參考成本，不覆蓋目前庫存與 FIFO 批次。')+' 原始網路商品不會被修改。','開始匯入');if(!yes)return;
    const bySku=new Map(state.internalProducts.filter(function(x){return x.internalSku;}).map(function(x){return [x.internalSku,x];}));const activityIds=new Set(state.inventory.map(function(x){return x.productId;}));let processed=0,created=0,updated=0,preserved=0;
    try{
      for(let start=0;start<rows.length;start+=BATCH_SIZE){const batch=state.db.batch();rows.slice(start,start+BATCH_SIZE).forEach(function(r){const existing=bySku.get(r.internalSku),id=existing?existing.docId:('sku_'+hashText(r.internalSku)),ref=state.db.collection(COLLECTIONS.products).doc(id),hasActivity=existing&&activityIds.has(existing.docId),stock=r.currentStock==null?0:r.currentStock,cost=r.latestPurchaseCost,layers=stock>0?[{layerId:'OPENING-'+hashText(r.internalSku),qtyRemaining:stock,originalQty:stock,unitCost:cost,costKnown:cost!=null,receivedAt:new Date().toISOString(),referenceType:'openingExcel',referenceId:state.importFileName}]:[];
        const payload={internalSku:r.internalSku,internalName:r.internalName,originalName:r.internalName,storePrice:r.storePrice,originalSalePrice:r.storePrice,easyStorePrice:r.easyStorePrice,momoPrice:r.momoPrice,coupangPrice:r.coupangPrice,latestPurchaseCost:cost,referencePurchaseCost:cost,note:r.note,status:'active',enabled:true,source:'originalExcel',sourceFile:state.importFileName,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION};
        if(r.saleRewardPercent!=null)payload.saleRewardPercent=r.saleRewardPercent;
        if(initial&&(!existing||!hasActivity)){payload.currentStock=stock;payload.openingStock=stock;payload.openingUnitCost=cost;payload.costLayers=layers;const stats=statsFromLayers(layers);payload.averageCost=stats.averageCost!=null?stats.averageCost:cost;payload.inventoryValue=stats.inventoryValue;payload.costIncomplete=stock>0&&(cost==null);payload.importInitialized=true;payload.importedAt=serverTimestamp();if(!existing){payload.reservedStock=0;payload.safetyStock=0;payload.createdAt=serverTimestamp();payload.createdBy=userLabel();created+=1;}else updated+=1;}else{if(existing){updated+=1;if(initial&&hasActivity)preserved+=1;}else{payload.currentStock=stock;payload.openingStock=stock;payload.openingUnitCost=cost;payload.costLayers=layers;const stats=statsFromLayers(layers);payload.averageCost=stats.averageCost!=null?stats.averageCost:cost;payload.inventoryValue=stats.inventoryValue;payload.costIncomplete=stock>0&&(cost==null);payload.importInitialized=true;payload.reservedStock=0;payload.safetyStock=0;payload.createdAt=serverTimestamp();payload.createdBy=userLabel();created+=1;}}
        batch.set(ref,payload,{merge:true});});await batch.commit();processed=Math.min(rows.length,start+BATCH_SIZE);showAlert('中央商品主檔匯入中：'+processed+' / '+rows.length+'，請不要關閉頁面…','');}
      const legacy=state.internalProducts.filter(function(x){return x.autoCreated&&!x.internalSku&&x.enabled!==false;});for(let start=0;start<legacy.length;start+=BATCH_SIZE){const batch=state.db.batch();legacy.slice(start,start+BATCH_SIZE).forEach(function(x){batch.set(state.db.collection(COLLECTIONS.products).doc(x.docId),{enabled:false,status:'legacy-online-shell',updatedAt:serverTimestamp(),updatedBy:userLabel(),note:(x.note?x.note+'｜':'')+'V2 匯入後停用舊版無 SKU 網路外殼'},{merge:true});});await batch.commit();}
      await state.db.collection(COLLECTIONS.imports).add({type:initial?'centralMasterInitialImport':'centralMasterBasicRefresh',fileName:state.importFileName,count:rows.length,created:created,updated:updated,preservedOperationalStock:preserved,legacyShellsDisabled:legacy.length,status:'completed',createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});await state.db.collection(COLLECTIONS.settings).doc('centralProductMaster').set({initialized:true,lastImportFile:state.importFileName,lastImportCount:rows.length,lastImportMode:mode,lastImportedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});await writeAudit(initial?'建立中央商品主檔':'更新中央商品基本資料','productImport','',state.importFileName+'｜'+rows.length+' 筆');clearAlert();closeDrawer();toast('中央商品主檔匯入完成','處理 '+rows.length+' 筆；建立 '+created+'、更新 '+updated+(preserved?'、保留已有異動庫存 '+preserved:'')+'。','success');await loadAll(true);
    }catch(error){showAlert('匯入中斷：'+errorMessage(error)+'。已完成的批次會保留，可重新選同一檔案繼續。','error');toast('匯入未完成',errorMessage(error),'error');}
  }

  async function syncEasyStoreApi(){
    if(!(global.firebase&&global.firebase.functions)) return toast('無法同步','頁面未載入 Firebase Functions SDK。','warning');
    if(state.easyStoreSyncPending) return toast('圖片仍在同步','請等待目前這次同步完成，不要重複按。','warning');
    const central=state.internalProducts.length;
    if(!central) return toast('尚無中央商品','請先匯入原始商品 Excel。','warning');
    const yes=await confirmAction('從 EasyStore API 同步','將直接讀取 EasyStore 全部商品與規格，以完全相同 SKU 對照 '+central+' 筆中央商品，補入網路名稱、售價與圖片。這個動作只讀 EasyStore，不會修改 EasyStore 商品或庫存。','開始同步');
    if(!yes) return;
    state.easyStoreSyncPending=true;
    if(state.view==='products')render();
    showAlert('正在從 EasyStore API 讀取全部商品、規格與圖片。約需數分鐘，完成前請勿關閉頁面或重複按同步。','info');
    try{
      const callable=global.firebase.app().functions('us-central1').httpsCallable('syncEasyStoreCatalog',{timeout:EASYSTORE_CATALOG_CLIENT_TIMEOUT_MS});
      const response=await callable({force:false});
      const result=(response&&response.data)||{};
      if(!result.ok) throw new Error(result.message||'同步失敗');
      clearAlert();
      toast('EasyStore API 同步完成','父商品 '+formatNumber(result.productCount)+'、規格 SKU '+formatNumber(result.variantCount)+'、配對 '+formatNumber(result.matchedCount)+'、有圖片 '+formatNumber(result.imageMatchedCount),'success');
      await loadAll(true);
    }catch(error){
      console.error(error);
      const message=errorMessage(error);
      if(message.indexOf('deadline-exceeded')!==-1){
        toast('同步仍可能在雲端執行','請勿重複按；稍候數分鐘後重新整理商品資料。','warning');
        showAlert('網頁等待時間已到，但雲端同步仍可能繼續執行。請勿重複按，稍候數分鐘後重新整理商品資料。','info');
      }else if(message.indexOf('already-exists')!==-1||message.indexOf('正在執行')!==-1){
        toast('已有圖片同步正在執行','請等待目前這次完成。','warning');
        showAlert('已有 EasyStore 圖片同步正在執行，請勿重複按；稍候數分鐘後重新整理。','info');
      }else{
        toast('EasyStore API 同步失敗',message,'warning');
        showAlert('EasyStore API 同步失敗：'+message,'error');
      }
    }finally{
      state.easyStoreSyncPending=false;
      if(state.view==='products')render();
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
  function getInjiaoyunManualSyncPin(){
    const key='youzi_injiaoyun_manual_sync_pin';
    let value='';
    try{value=clean(sessionStorage.getItem(key));}catch(error){}
    if(value)return value;
    value=clean(global.prompt('請輸入音教雲「手動同步密碼」：')||'');
    if(!value)return '';
    if(value.length<12||value.length>64){toast('密碼格式不正確','手動同步密碼應為 12～64 碼。','warning');return '';}
    try{sessionStorage.setItem(key,value);}catch(error){}
    return value;
  }
  function clearInjiaoyunManualSyncPin(){try{sessionStorage.removeItem('youzi_injiaoyun_manual_sync_pin');}catch(error){}}
  async function requestInjiaoyunImport(){
    if(state.injiaoyunManualRequestPending||injiaoyunSyncIsBusy(state.injiaoyunCloudSync)){
      toast('音教雲正在同步','請等待本次同步完成。','info');return;
    }
    const manualSyncPin=getInjiaoyunManualSyncPin();
    if(!manualSyncPin)return;
    if(!global.firebase||!global.firebase.app||!global.firebase.functions){toast('同步功能尚未載入','請重新整理頁面後再試。','error');return;}
    state.injiaoyunManualRequestPending=true;
    if(state.view==='overview')renderKeepingViewport();
    toast('正在啟動音教雲同步','雲端會讀取本月 1 日到今天，請稍候。','info');
    try{
      const callable=global.firebase.app().functions('us-central1').httpsCallable('runInjiaoyunSyncNow');
      const response=await callable({source:'operations-hub',requestedBy:userLabel(),manualSyncPin:manualSyncPin,appVersion:VERSION});
      const result=response&&response.data||{};
      if(result.status==='cooldown'){
        toast('剛剛已執行過同步',result.message||'請稍後再試。','info');return;
      }
      state.injiaoyunCloudSync=Object.assign({},state.injiaoyunCloudSync,{status:'queued',manualRequestId:result.requestId||'',manualRequestedAt:new Date(),requestedEndDateKey:result.requestedEndDateKey||todayDateKey(),lastError:''});
      state.injiaoyunCloudStatusSignature=injiaoyunStatusSignature(state.injiaoyunCloudSync);
      scheduleInjiaoyunStatusRefresh(state.injiaoyunCloudSync);
      toast(result.status==='already-running'?'同步已在執行':'手動同步已啟動',result.message||'完成後畫面會自動更新。','success');
    }catch(error){
      const message=errorMessage(error);
      if(message.includes('密碼')||clean(error&&error.code).includes('permission-denied'))clearInjiaoyunManualSyncPin();
      toast('音教雲手動同步失敗',message,'error');
    }finally{
      state.injiaoyunManualRequestPending=false;
      if(state.view==='overview')renderKeepingViewport();
    }
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


function platformFeeFormRow(name,label){const cfg=platformFeeConfig(name);return '<section class="ops-platform-fee-form-card"><h3>'+escapeHtml(label)+'</h3><div class="ops-form-grid"><div class="ops-field"><label>平台抽成％</label><input class="ops-input" type="number" min="0" max="100" step="0.01" name="'+name+'_commissionRate" value="'+attr(cfg.commissionRate)+'"></div><div class="ops-field"><label>金流費％</label><input class="ops-input" type="number" min="0" max="100" step="0.01" name="'+name+'_paymentRate" value="'+attr(cfg.paymentRate)+'"></div><div class="ops-field"><label>每月固定費</label><input class="ops-input" type="number" min="0" step="1" name="'+name+'_monthlyFixedFee" value="'+attr(cfg.monthlyFixedFee)+'"></div><div class="ops-field"><label>每月廣告／其他固定費</label><input class="ops-input" type="number" min="0" step="1" name="'+name+'_monthlyAdvertisingFee" value="'+attr(cfg.monthlyAdvertisingFee)+'"></div><div class="ops-field full"><label>固定費攤提方式</label><select class="ops-select" name="'+name+'_allocationMethod"><option value="order_count">依當月訂單平均攤提</option><option value="sales_amount">依當月銷售金額比例攤提</option><option value="monthly_only">不攤入單筆，只在月報扣除</option></select></div></div></section>';}
function openPlatformFeeSettings(){openDrawer('平台費用與毛利設定','設定會儲存在 Firestore；修改後不需要重新安裝店內程式。','<form id="platformFeeSettingsForm">'+platformFeeFormRow('EasyStore','EasyStore')+platformFeeFormRow('MOMO','MOMO')+platformFeeFormRow('Coupang','Coupang／酷澎')+'<div class="ops-drawer-footer"><button class="ops-button ghost" type="button" data-action="drawer-close">取消</button><button class="ops-button primary" type="submit">儲存費用設定</button></div></form>');['EasyStore','MOMO','Coupang'].forEach(function(name){const select=query('[name="'+name+'_allocationMethod"]');if(select)select.value=platformFeeConfig(name).allocationMethod||'order_count';});}
async function savePlatformFeeSettings(form){const data=new FormData(form),platforms={};['EasyStore','MOMO','Coupang'].forEach(function(name){platforms[name]={enabled:true,commissionRate:Math.max(0,Number(data.get(name+'_commissionRate')||0)),paymentRate:Math.max(0,Number(data.get(name+'_paymentRate')||0)),monthlyFixedFee:Math.max(0,Number(data.get(name+'_monthlyFixedFee')||0)),monthlyAdvertisingFee:Math.max(0,Number(data.get(name+'_monthlyAdvertisingFee')||0)),allocationMethod:clean(data.get(name+'_allocationMethod'))||'order_count'};});await state.db.collection(COLLECTIONS.settings).doc('platformFeeSettings').set({platforms:platforms,updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});state.platformFeeSettings=platforms;await writeAudit('更新平台費用設定','platformFeeSettings','platformFeeSettings','EasyStore／MOMO／Coupang');closeDrawer();toast('平台費用設定已儲存','下一次同步與報表會使用新設定。','success');renderKeepingViewport();}
async function syncPlatformOrdersNow(){const yes=await confirmAction('要求店內電腦立即同步','系統會建立同步請求；店內電腦開機且背景程式正常時，最慢約 20 秒內接收。若同步正在進行，不會重複執行。','建立請求');if(!yes)return;const ref=state.db.collection(COLLECTIONS.platformSyncRequests).doc();await ref.set({requestId:ref.id,status:'pending',requestedAt:serverTimestamp(),requestedBy:userLabel(),source:'operations-hub',version:VERSION});toast('同步請求已建立','店內電腦會在約 20 秒內接收，完成後重新讀取即可查看結果。','success');}



  function salesHistoryBaseDate(){
    const value=(state.saleInvoiceFrom&&state.saleInvoiceFrom===state.saleInvoiceTo?state.saleInvoiceFrom:(state.saleInvoiceTo||state.saleInvoiceFrom||dateText(new Date())));
    return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:dateText(new Date());
  }
  function applySalesHistoryRange(mode){
    const today=dateText(new Date());
    if(mode==='all'){state.saleInvoiceFrom='';state.saleInvoiceTo='';return renderKeepingViewport();}
    if(mode==='today'){state.saleInvoiceFrom=today;state.saleInvoiceTo=today;return renderKeepingViewport();}
    if(mode==='month'){state.saleInvoiceFrom=today.slice(0,8)+'01';state.saleInvoiceTo=today;return renderKeepingViewport();}
    if(mode==='prev'||mode==='next'){
      const shifted=dateKeyShift(salesHistoryBaseDate(),mode==='prev'?-1:1);
      state.saleInvoiceFrom=shifted;state.saleInvoiceTo=shifted;return renderKeepingViewport();
    }
    if(mode==='custom'){
      setTimeout(function(){const input=byId('saleInvoiceFrom');if(input){input.focus();try{input.showPicker&&input.showPicker();}catch(err){}}},0);
    }
  }

  async function voidIncomeRecord(id){
    const income=state.incomes.find(function(row){return row.id===id;});if(!income)return;
    if(income.category==='商品退貨退款'||income.category==='退貨點數補收')return toast('這筆紀錄不能直接刪除','請回到原始銷售單的退貨流程修正，避免退款與庫存紀錄不一致。','warning');
    const yes=await confirmAction('刪除這筆收入','這筆資料會從原發生日期的收入統計中排除；相關未收款也會一併取消。系統仍會保留作廢紀錄供追查。','確認刪除');if(!yes)return;
    const incomeRef=state.db.collection(COLLECTIONS.incomes).doc(id),receivable=state.receivables.find(function(row){return row.incomeId===id;})||null,payments=state.receivablePayments.filter(function(row){return row.incomeId===id||(receivable&&row.receivableId===receivable.id);});
    await state.db.runTransaction(async function(tx){const snap=await tx.get(incomeRef);if(!snap.exists)throw new Error('找不到收入紀錄');tx.set(incomeRef,{status:'voided',voidedAt:serverTimestamp(),voidedBy:userLabel(),voidReason:'手動刪除錯誤紀錄',updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});if(receivable)tx.delete(state.db.collection(COLLECTIONS.receivables).doc(receivable.id));payments.forEach(function(row){tx.delete(state.db.collection(COLLECTIONS.receivablePayments).doc(row.id));});});
    await writeAudit('刪除收入紀錄','income',id,(income.incomeNo||id)+'｜原日期 '+dateText(income.occurredAt));closeDrawer();toast('收入紀錄已刪除','原日期統計已重新計算。','success');await loadAll(true);
  }

  async function voidSaleRecord(id){
    const sale=state.sales.find(function(row){return row.id===id;});if(!sale)return;
    if(state.salesReturns.some(function(row){return row.saleId===id;}))return toast('這張單已有退貨紀錄','為避免庫存重複回補，請先處理或更正既有退貨紀錄，不能直接刪除。','warning');
    const typeLabel=sale.saleType==='internalUse'?'內部耗用／報廢紀錄':sale.saleType==='preorder'&&sale.fulfillmentStatus!=='delivered'?'預購訂單':'銷售訂單';
    const yes=await confirmAction('刪除這筆'+typeLabel,'這不是退貨，而是作廢錯誤資料。商品庫存會依原單完整加回，原成交日收入、成本、毛利、應收款與會員點數會同步更正。','確認刪除');if(!yes)return;
    const saleRef=state.db.collection(COLLECTIONS.sales).doc(id),items=Array.isArray(sale.items)?sale.items:[],shouldRestore=!(sale.saleType==='preorder'&&sale.fulfillmentStatus!=='delivered'),groups={};
    if(shouldRestore)items.forEach(function(item){const key=clean(item.productId);if(!key)return;if(!groups[key])groups[key]=[];groups[key].push(item);});
    const productIds=Object.keys(groups),productRefs=productIds.map(function(productId){return state.db.collection(COLLECTIONS.products).doc(productId);}),receivable=state.receivables.find(function(row){return row.saleId===id;})||null,payments=state.receivablePayments.filter(function(row){return row.saleId===id||(receivable&&row.receivableId===receivable.id);}),customerRef=sale.customerId?state.db.collection(COLLECTIONS.customers).doc(sale.customerId):null;
    await state.db.runTransaction(async function(tx){
      const saleSnap=await tx.get(saleRef);if(!saleSnap.exists)throw new Error('找不到原始單據');const rawSale=saleSnap.data()||{},productSnaps=[];for(const ref of productRefs)productSnaps.push(await tx.get(ref));const customerSnap=customerRef?await tx.get(customerRef):null;
      if(customerRef&&customerSnap&&customerSnap.exists){const rawCustomer=customerSnap.data()||{},oldBalance=Math.max(0,Number(rawCustomer.pointBalance||0)),redeemed=Math.max(0,Number(rawSale.pointsRedeemed||0)),earned=Math.max(0,Number(rawSale.pointsEarned||0)),newBalance=oldBalance+redeemed-earned;if(newBalance<0)throw new Error('會員點數已被後續使用，無法直接刪除；請先補回點數差額。');if(newBalance!==oldBalance){tx.update(customerRef,{pointBalance:newBalance,updatedAt:serverTimestamp()});const pointRef=state.db.collection(COLLECTIONS.points).doc();tx.set(pointRef,{customerId:clean(rawSale.customerId),saleId:id,type:'saleVoid',points:newBalance-oldBalance,balanceAfter:newBalance,note:'作廢 '+clean(rawSale.saleNo),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});}}
      productIds.forEach(function(productId,index){const snap=productSnaps[index];if(!snap.exists)throw new Error('找不到商品主檔，無法恢復庫存');let raw=snap.data()||{},before=Number(raw.currentStock||0);groups[productId].forEach(function(item){raw=restoreSaleItemToStock(raw,item).raw;});const after=Number(raw.currentStock||0),stats=costLayerStats(raw);tx.update(productRefs[index],{currentStock:after,costLayers:raw.costLayers||[],averageCost:stats.averageCost,inventoryValue:stats.inventoryValue,costIncomplete:stats.costIncomplete,updatedAt:serverTimestamp(),updatedBy:userLabel()});queueInventorySyncInTransaction(tx,productId,clean(groups[productId][0]&&groups[productId][0].sku),after,'saleVoid');const invRef=state.db.collection(COLLECTIONS.inventory).doc();tx.set(invRef,{type:sale.saleType==='internalUse'?'internalUseVoid':'saleVoid',productId:productId,productName:clean(groups[productId][0]&&groups[productId][0].name),sku:clean(groups[productId][0]&&groups[productId][0].sku),qtyChange:after-before,beforeStock:before,afterStock:after,referenceType:'storeSaleVoid',referenceId:clean(rawSale.saleNo)||id,note:'刪除錯誤單據｜原交易日 '+dateText(rawSale.soldAt||rawSale.preorderAt),occurredAt:serverTimestamp(),createdAt:serverTimestamp(),createdBy:userLabel(),version:VERSION});});
      tx.set(saleRef,{status:'voided',voidedAt:serverTimestamp(),voidedBy:userLabel(),voidReason:'手動刪除錯誤單據',updatedAt:serverTimestamp(),updatedBy:userLabel(),version:VERSION},{merge:true});if(receivable)tx.delete(state.db.collection(COLLECTIONS.receivables).doc(receivable.id));payments.forEach(function(row){tx.delete(state.db.collection(COLLECTIONS.receivablePayments).doc(row.id));});
    });
    await writeAudit('刪除銷售單據','storeSale',id,(sale.saleNo||id)+'｜原日期 '+dateText(sale.soldAt||sale.preorderAt));closeDrawer();toast('單據已刪除','庫存與原交易日統計已更正。','success');await loadAll(true);
  }

  function handleAction(action,el){
    if(action==='sync-easystore-api'){ syncEasyStoreApi(); return; }
    if(action==='refresh'){ try{localStorage.removeItem(DASHBOARD_CACHE_KEY);}catch(err){} return state.view==='products'?loadProductsOnly(false):loadAll(false); }
    if(action==='platform-sync-now') return syncPlatformOrdersNow();
    if(action==='platform-fee-settings') return openPlatformFeeSettings();
    if(action==='platform-order-range'){const range=el.dataset.range||'today';state.platformOrderRange=range;if(range==='today')state.platformOrderDate=todayDateKey();if(range==='custom'){if(!state.platformOrderFrom)state.platformOrderFrom=dateText(new Date(new Date().getFullYear(),new Date().getMonth(),1));if(!state.platformOrderTo)state.platformOrderTo=todayDateKey();}return renderKeepingViewport();}
    if(action==='platform-order-day-shift'){state.platformOrderDate=dateKeyShift(platformOrderDateKey(),Number(el.dataset.step||0));state.platformOrderRange='today';return renderKeepingViewport();}
    if(action==='platform-order-custom-apply'){if(!state.platformOrderFrom||!state.platformOrderTo){toast('請選擇完整日期','開始日期與結束日期都需要選擇。','warning');return;}if(state.platformOrderFrom>state.platformOrderTo){toast('日期範圍不正確','開始日期不能晚於結束日期。','warning');return;}state.platformOrderRange='custom';return renderKeepingViewport();}
    if(action==='platform-order-platform'){state.platformOrderPlatform=el.dataset.platform||'all';state.platformOrderIssueFilter='all';return renderKeepingViewport();}
    if(action==='platform-return-filter'){state.platformOrderIssueFilter=state.platformOrderIssueFilter==='returns'?'all':'returns';state.platformOrderPlatform='all';if(state.platformOrderIssueFilter==='returns')state.platformOrderRange='all';return renderKeepingViewport();}
    if(action==='platform-order-detail')return openPlatformOrderDetail(clean(el.dataset.key));
    if(action==='platform-return-open')return openPlatformReturn(clean(el.dataset.id));
    if(action==='platform-sync-panel'){const panel=el.dataset.panel||'';state.platformSyncPanel=state.platformSyncPanel===panel?'':panel;return renderKeepingViewport();}
    if(action==='overview-sync-errors'){state.platformSyncPanel='errors';location.hash='sync';return;}
    if(action==='overview-order-errors'){state.platformSyncPanel='';state.platformOrderRange='all';state.platformOrderPlatform='all';state.platformOrderIssueFilter='all';state.platformOrderSearch='';location.hash='sync';return;}
    if(action==='purchase-range'){
      const range=el.dataset.range||'today';state.purchaseRange=range;
      if(range==='today')state.purchaseDate=todayDateKey();
      if(range==='custom'){
        if(!state.purchaseFrom)state.purchaseFrom=dateText(new Date(new Date().getFullYear(),new Date().getMonth(),1));
        if(!state.purchaseTo)state.purchaseTo=todayDateKey();
      }
      return renderKeepingViewport();
    }
    if(action==='purchase-day-shift'){state.purchaseDate=dateKeyShift(purchaseDateKey(),Number(el.dataset.step||0));state.purchaseRange='today';return renderKeepingViewport();}
    if(action==='purchase-custom-apply'){
      if(!state.purchaseFrom||!state.purchaseTo){toast('請選擇完整日期','開始日期與結束日期都需要選擇。','warning');return;}
      if(state.purchaseFrom>state.purchaseTo){toast('日期範圍不正確','開始日期不能晚於結束日期。','warning');return;}
      state.purchaseRange='custom';return renderKeepingViewport();
    }
    if(action==='inventory-zero-cost-confirm')return confirmInventoryZeroCost(clean(el.dataset.id)).catch(function(error){toast('無法確認零成本',errorMessage(error),'error');});
    if(action==='inventory-anomaly-stocktake')return openStocktakeWorkspace(clean(el.dataset.id));
    if(action==='inventory-anomaly-product'){state.productSearch=clean(el.dataset.sku);state.productFilter='all';state.productSeries='all';state.productVisible=PRODUCT_PAGE_SIZE;state.productEditId=clean(el.dataset.id)||'';location.hash='products';return;}
    if(action==='price-anomaly-product'){state.productSearch=clean(el.dataset.sku);state.productFilter='all';state.productSeries='all';state.productVisible=PRODUCT_PAGE_SIZE;state.productEditId=clean(el.dataset.id)||'';location.hash='products';return;}
    if(action==='injiaoyun-import') return requestInjiaoyunImport();
    if(action==='education-tuition-detail') return openEducationTuitionDetail();
    if(action==='education-rental-detail') return openEducationRentalDetail();
    if(action==='education-teacher-summary') return openEducationTeacherSummary();
    if(action==='education-school-share-detail') return openEducationSchoolShareDetail();
    if(action==='education-teacher-detail') return openEducationTeacherDetail(el.dataset.teacherKey||'');
    if(action==='drawer-close') return closeDrawer();
    if(action==='overview-range'){
      const nextRange=el.dataset.range||'today';
      state.overviewRange=nextRange;
      if(nextRange==='today')state.overviewDate=todayDateKey();
      return render();
    }
    if(action==='overview-day-shift'){const step=Number(el.dataset.step||0);state.overviewDate=dateKeyShift(overviewDateKey(),step);if(state.overviewDate>todayDateKey())state.overviewDate=todayDateKey();state.overviewRange='today';return render();}
    if(action==='overview-custom-apply'){
      if(!state.overviewFrom||!state.overviewTo){toast('請選擇完整日期','開始日期與結束日期都需要選擇。','warning');return;}
      if(state.overviewFrom>state.overviewTo){toast('日期範圍不正確','開始日期不能晚於結束日期。','warning');return;}
      state.overviewRange='custom';return render();
    }
    if(action==='mobile-key') return applyMobileKeyInput(el.dataset.target,el.dataset.key);
    if(action==='overview-low-stock'){state.productFilter='low';state.productSeries='all';state.productSearch='';state.productVisible=PRODUCT_PAGE_SIZE;location.hash='products';return;}
    if(action==='sales-mode'){const nextMode=el.dataset.mode||'product';if(nextMode==='usage'){state.cart.forEach(function(item){item.unitPrice=0;});state.checkoutDiscount=0;state.checkoutPoints=0;state.checkoutPointsTouched=false;state.checkoutEarnPoints=false;state.checkoutActualCash='';}else if(state.salesMode==='usage'){state.cart.forEach(function(item){const product=catalogById(item.productId);item.unitPrice=Number(product&&product.storePrice||0);});state.checkoutEarnPoints=true;state.checkoutActualCash='';}state.salesMode=nextMode;return renderKeepingViewport();}
    if(action==='stock-usage-reason'){state.stockUsageReason=el.dataset.value||'店內自用';return renderKeepingViewport();}
    if(action==='sales-history-toggle'){state.salesHistoryExpanded=!state.salesHistoryExpanded;if(!state.salesHistoryExpanded){state.saleInvoiceSearch='';state.saleInvoiceFrom='';state.saleInvoiceTo='';}return renderKeepingViewport();}
    if(action==='pos-customer-mode'){const mode=el.dataset.mode||'walkin';if(mode==='walkin'){state.posCustomerMode='walkin';state.selectedCustomerId='';state.posMemberSearch='';state.posMemberPickerOpen=false;state.checkoutPaymentStatus='paid';state.checkoutPoints=0;state.checkoutPointsTouched=false;state.checkoutEarnPoints=true;}else{const alreadyMember=state.posCustomerMode==='member';state.posCustomerMode='member';state.posMemberPickerOpen=alreadyMember?!state.posMemberPickerOpen:true;}return renderKeepingViewport();}
    if(action==='pos-member-select'){state.selectedCustomerId=el.dataset.id||'';state.posCustomerMode='member';state.posMemberPickerOpen=false;state.checkoutPaymentStatus='paid';state.checkoutPoints=0;state.checkoutPointsTouched=false;state.checkoutEarnPoints=true;return renderKeepingViewport();}
    if(action==='pos-choice'){const name=el.dataset.name,value=el.dataset.value;if(name==='paymentMethod')state.checkoutPaymentMethod=value;if(name==='paymentStatus')state.checkoutPaymentStatus=value;if(name==='earnPointsEnabled')state.checkoutEarnPoints=value==='earn';if(name==='orderType'){state.checkoutOrderType=value==='preorder'?'preorder':'sale';state.checkoutPaymentStatus=state.checkoutOrderType==='preorder'?'partial':'paid';state.checkoutPoints=0;state.checkoutPointsTouched=state.checkoutOrderType==='preorder';state.checkoutActualCash='';state.checkoutReceived='';}if(name==='paymentStatus'&&value!=='partial')state.checkoutReceived='';return renderKeepingViewport();}
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
    if(action==='product-print-label') return openProductLabelPrint(el.dataset.id);
    if(action==='product-series'){if(!closeProductEditorForListChange())return;state.productSeries=el.dataset.series||'all';state.productFilter='all';state.productSearch='';state.productVisible=PRODUCT_PAGE_SIZE;return renderKeepingViewport();}
    if(action==='product-low-stock'){if(!closeProductEditorForListChange())return;state.productFilter=state.productFilter==='low'?'all':'low';state.productSeries='all';state.productSearch='';state.productVisible=PRODUCT_PAGE_SIZE;return renderKeepingViewport();}
    if(action==='product-display-mode'){if(!closeProductEditorForListChange())return;state.productDisplayMode=el.dataset.mode==='text'?'text':'image';state.productVisible=PRODUCT_PAGE_SIZE;return renderKeepingViewport();}
    if(action==='product-edit-cancel'){clearProductEditorState();return renderKeepingViewport();}
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
      if(action==='cart-clear'){state.cart=[];state.checkoutActualCash='';state.checkoutDiscount=0;return renderKeepingViewport();}
    if(action==='checkout') return;
    if(action==='customer-new') return openCustomerV4();
    if(action==='pos-customer-new') return openCustomerV4('',true,'member');
    if(action==='customer-edit') return openCustomerV4(el.dataset.id);
    if(action==='customer-history') return openCustomerHistory(el.dataset.id);
    if(action==='membership-settings') return openMembershipSettingsV5();
    if(action==='point-adjust') return openPointAdjustment(el.dataset.id);
    if(action==='receivable-payment') return openReceivablePayment(el.dataset.id);
    if(action==='preorder-fulfill') return openPreorderFulfillment(el.dataset.id);
    if(action==='sale-edit') return openSaleEdit(el.dataset.id);
    if(action==='income-edit') return openIncomeEdit(el.dataset.id);
    if(action==='sale-return') return openSaleReturn(el.dataset.id);
    if(action==='sale-void') return voidSaleRecord(el.dataset.id);
    if(action==='income-void') return voidIncomeRecord(el.dataset.id);
    if(action==='open-quick-income') return openQuickIncome(el.dataset.category||'');
    if(action==='show-sales-history') return openSalesHistory();
    if(action==='sale-history-range') return applySalesHistoryRange(el.dataset.mode||'all');
    if(action==='sale-history-reset-range'){state.saleInvoiceFrom='';state.saleInvoiceTo='';return renderKeepingViewport();}
    if(action==='purchase-worktab'){state.purchaseWorkspaceTab=el.dataset.tab||'inbound';return renderKeepingViewport();}
    if(action==='open-purchase') return openPurchase();
    if(action==='purchase-this') return openPurchase(el.dataset.id);
    if(action==='purchase-entry-back'){location.hash='purchases';return;}
    if(action==='purchase-entry-series'){state.purchaseEntrySeries=el.dataset.series||'all';state.purchaseEntrySearch='';return renderKeepingViewport();}
    if(action==='purchase-entry-display-mode'){state.purchaseEntryDisplayMode=el.dataset.mode==='text'?'text':'image';return renderKeepingViewport();}
    if(action==='purchase-entry-add'){addPurchaseEntryProduct(el.dataset.id);return renderKeepingViewport();}
    if(action==='purchase-entry-remove'){state.purchaseEntryCart.splice(Math.max(0,Number(el.dataset.index)||0),1);return renderKeepingViewport();}
    if(action==='purchase-entry-clear'){state.purchaseEntryCart=[];return renderKeepingViewport();}
    if(action==='purchase-entry-new-product'){location.hash='products';setTimeout(function(){openProductEdit('');},0);return;}
    if(action==='purchase-edit') return startPurchaseEdit(el.dataset.id);
    if(action==='supplier-manager') return openSupplierManager('');
    if(action==='supplier-edit') return openSupplierManager(el.dataset.id);
    if(action==='purchase-add-row'){const box=byId('purchaseItems'); if(box) box.insertAdjacentHTML('beforeend',purchaseRowHtml('',queryAll('.purchase-row',box).length)); return;}
    if(action==='purchase-remove-row'){const row=el.closest('.purchase-row'); if(row&&queryAll('.purchase-row').length>1)row.remove();return;}
    if(action==='open-adjustment') return openStocktakeWorkspace();
    if(action==='stocktake-back'){location.hash='purchases';return;}
    if(action==='stocktake-series'){state.stocktakeSeries=el.dataset.series||'all';state.stocktakeSearch='';return renderKeepingViewport();}
    if(action==='stocktake-add'){addStocktakeProduct(el.dataset.id);return renderKeepingViewport();}
    if(action==='stocktake-remove'){state.stocktakeCart.splice(Math.max(0,Number(el.dataset.index)||0),1);return renderKeepingViewport();}
    if(action==='stocktake-clear'){state.stocktakeCart=[];return renderKeepingViewport();}
    if(action==='stocktake-edit') return startStocktakeCorrection(el.dataset.id);
    if(action==='inventory-count-settings') return openInventoryCountSettings();
    if(action==='inventory-count-open'){global.open('inventory-count.html','_blank','noopener');return;}
    if(action==='inventory-count-copy'){const url=new URL('inventory-count.html',location.href).href;if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(url).then(function(){toast('已複製盤點網址',url,'success');});else{const input=document.createElement('textarea');input.value=url;document.body.appendChild(input);input.select();document.execCommand('copy');input.remove();toast('已複製盤點網址',url,'success');}return;}
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
      else if(form.id==='labelPrintForm') await saveLabelPrint(form);
      else if(form.id==='checkoutFormInline') await saveCheckoutV4(form);
      else if(form.id==='preorderFulfillmentForm') await savePreorderFulfillment(form);
      else if(form.id==='stockUsageForm') await saveStockUsage(form);
      else if(form.id==='platformFeeSettingsForm') await savePlatformFeeSettings(form);
      else if(form.id==='platformReturnForm') await savePlatformReturn(form);
      else if(form.id==='saleEditForm') await saveSaleEdit(form);
      else if(form.id==='internalUsageEditForm') await saveInternalUsageEdit(form);
      else if(form.id==='incomeEditForm') await saveIncomeEdit(form);
      else if(form.id==='saleReturnForm') await saveSaleReturn(form);
      else if(form.id==='customerFormV4') await saveCustomerV4(form);
      else if(form.id==='membershipSettingsForm') await saveMembershipSettings(form);
      else if(form.id==='membershipSettingsFormV5') await saveMembershipSettingsV5(form);
      else if(form.id==='pointAdjustmentForm') await savePointAdjustment(form);
      else if(form.id==='receivablePaymentForm') await saveReceivablePayment(form);
      else if(form.id==='quickIncomeForm') await saveQuickIncome(form);
      else if(form.id==='purchaseForm'||form.id==='purchaseWorkspaceForm') await savePurchase(form);
      else if(form.id==='supplierForm') await saveSupplier(form);
      else if(form.id==='stocktakeForm') await saveStocktake(form);
      else if(form.id==='inventoryCountSettingsForm') await saveInventoryCountSettings(form);
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
    const form=byId('checkoutFormInline');
    if(!form)return;
    const subtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;}),c=selectedCustomer(),pointInput=query('[name="pointsToRedeem"]',form),actualCashInput=query('[name="actualCashReceived"]',form),discountInput=query('[name="discount"]',form),rule=membershipRuleForDate(new Date());
    let discount=Math.max(0,Number(state.checkoutDiscount||0)),maxPoints=maxRedeemablePoints(c,Math.max(0,subtotal-discount));
    if(pointInput){
      pointInput.max=String(maxPoints);
      if(c&&rule.redemptionMode==='auto'&&!state.checkoutPointsTouched){state.checkoutPoints=maxPoints;pointInput.value=String(maxPoints);}
      else if(Number(pointInput.value||0)>maxPoints){pointInput.value=String(maxPoints);state.checkoutPoints=maxPoints;}
    }
    let pointValue=pointDiscount(state.checkoutPoints);
    if(actualCashInput&&clean(state.checkoutActualCash)!==''){
      const actualCash=Math.max(0,Number(state.checkoutActualCash||0));
      discount=Math.max(0,subtotal-pointValue-actualCash);
      state.checkoutDiscount=discount;
      maxPoints=maxRedeemablePoints(c,Math.max(0,subtotal-discount));
      if(pointInput&&state.checkoutPoints>maxPoints){state.checkoutPoints=maxPoints;pointInput.value=String(maxPoints);pointInput.max=String(maxPoints);pointValue=pointDiscount(state.checkoutPoints);discount=Math.max(0,subtotal-pointValue-actualCash);state.checkoutDiscount=discount;}
      actualCashInput.max=String(Math.max(0,subtotal-pointValue));
      if(discountInput)discountInput.value=String(discount);
    }
    const total=Math.max(0,subtotal-discount-pointValue),prepared=state.cart.map(function(item){const p=catalogById(item.productId);return {qty:item.qty,unitPrice:item.unitPrice,raw:p&&p.internal?p.internal:{}};}),member=!!(c&&c.customerType==='member'),earned=member&&state.checkoutEarnPoints!==false?calculatePreparedRewardPoints(prepared,total,subtotal,new Date()):0;
    setText('inlineProductSubtotal',money(subtotal));setText('inlineDiscountTotal',money(discount+pointValue));setText('inlineCheckoutTotal',money(total));setText('inlinePointDiscount',formatNumber(state.checkoutPoints)+' 點／'+money(pointValue));setText('inlinePointRemaining',formatNumber(Math.max(0,Number(c&&c.pointBalance||0)-state.checkoutPoints))+' 點');setText('inlinePointsEarned',member&&state.checkoutEarnPoints!==false?formatNumber(earned)+' 點':'不累積');
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
      inventorySearch:'inventorySearch',
      purchaseLowSearch:'purchaseLowSearch',
      purchaseEntrySearch:'purchaseEntrySearch',
      stocktakeSearch:'stocktakeSearch'
    };
    function isOpsSearchInput(target){return !!(target&&opsSearchStateMap[target.id]);}
    function applyOpsSearchInput(input){
      const key=opsSearchStateMap[input.id];
      if(!key)return;
      const nextValue=input.value;
      if(input.id==='productSearch'){
        if(!closeProductEditorForListChange()){
          input.value=state[key];
          return;
        }
        state.productSeries='all';
        state.productFilter='all';
        state.productVisible=PRODUCT_PAGE_SIZE;
      }
      state[key]=nextValue;
      if(input.id==='purchaseEntrySearch')state.purchaseEntrySeries='all';
      if(input.id==='stocktakeSearch')state.stocktakeSeries='all';
      // 不在每個字元輸入時重繪整頁；先讓輸入框完整接收數字，再更新結果。
      scheduleDeferredSearchRender(input.id,state[key],false);
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
    document.addEventListener('keydown',function(event){
      if(event.key!=='Enter'||!isOpsSearchInput(event.target))return;
      if(event.target.dataset.opsImeComposing==='1')return;
      scheduleDeferredSearchRender(event.target.id,event.target.value,true);
    },true);
    document.addEventListener('input',function(event){
      if(isOpsSearchInput(event.target)){
        // iOS Safari 的注音組字期間會觸發 input；此時完全不重新 render。
        if(event.isComposing||event.target.dataset.opsImeComposing==='1') return;
        applyOpsSearchInput(event.target);
      }
      else if(event.target.matches('[data-cart-qty]')){const item=state.cart[Number(event.target.dataset.cartQty)];if(item){item.qty=Math.max(1,Math.round(Number(event.target.value||1)));const cartRow=event.target.closest('.ops-cart-row'),lineTotalInput=cartRow&&query('[data-cart-line-total]',cartRow);if(lineTotalInput)lineTotalInput.value=String(item.qty*item.unitPrice);updateCartTotals();updateInlineCheckoutTotals();if(state.salesMode==='usage'){const amount=sum(state.cart,function(row){return row.qty*row.unitPrice;}),cost=estimateCartCost();setText('stockUsageAmount',money(amount));setText('stockUsageResult',money(amount-cost));}}}
      else if(event.target.matches('[data-cart-price]')){const item=state.cart[Number(event.target.dataset.cartPrice)];if(item){item.unitPrice=Math.max(0,Number(event.target.value||0));updateCartTotals();updateInlineCheckoutTotals();if(state.salesMode==='usage'){const amount=sum(state.cart,function(row){return row.qty*row.unitPrice;}),cost=estimateCartCost();setText('stockUsageAmount',money(amount));setText('stockUsageResult',money(amount-cost));}}}
      else if(event.target.closest('#checkoutFormInline')&&event.target.name==='actualCashReceived'){state.checkoutActualCash=event.target.value;updateInlineCheckoutTotals();if(state.checkoutDiscount>0){state.checkoutEarnPoints=false;const checkoutForm=event.target.closest('#checkoutFormInline'),earnInput=query('[name="earnPointsEnabled"]',checkoutForm);if(earnInput)earnInput.value='false';queryAll('[data-name="earnPointsEnabled"]').forEach(function(button){button.classList.toggle('active',button.dataset.value==='none');});updateInlineCheckoutTotals();}}
      else if(event.target.closest('#checkoutFormInline')&&event.target.name==='discount'){state.checkoutDiscount=Math.max(0,Number(event.target.value||0));const checkoutForm=event.target.closest('#checkoutFormInline'),actualInput=query('[name="actualCashReceived"]',checkoutForm),subtotal=sum(state.cart,function(x){return x.qty*x.unitPrice;}),pointValue=pointDiscount(state.checkoutPoints);if(actualInput){state.checkoutActualCash=String(Math.max(0,subtotal-state.checkoutDiscount-pointValue));actualInput.value=state.checkoutActualCash;}if(state.checkoutDiscount>0){state.checkoutEarnPoints=false;const earnInput=query('[name="earnPointsEnabled"]',checkoutForm);if(earnInput)earnInput.value='false';queryAll('[data-name="earnPointsEnabled"]').forEach(function(button){button.classList.toggle('active',button.dataset.value==='none');});}updateInlineCheckoutTotals();}
      else if(event.target.closest('#checkoutFormInline')&&event.target.name==='pointsToRedeem'){state.checkoutPoints=Math.max(0,Math.floor(Number(event.target.value||0)));state.checkoutPointsTouched=true;updateInlineCheckoutTotals();}
      else if(event.target.closest('#saleReturnForm')&&event.target.matches('[name="qty"]')) returnPreview(event.target.closest('#saleReturnForm'));
      else if(event.target.closest('#saleEditForm')&&event.target.name==='discount'&&Number(event.target.value||0)>0){const noEarn=query('[name="earnPointsEnabled"][value="false"]',event.target.closest('#saleEditForm'));if(noEarn)noEarn.checked=true;}
      else if(event.target.closest('#checkoutFormInline')&&event.target.name==='receivedAmount'){state.checkoutReceived=event.target.value;}
      else if(event.target.closest('#quickIncomeForm')&&event.target.name==='receivedAmount'){state.checkoutReceived=event.target.value;}
      else if(event.target.closest('#quickIncomeForm')&&event.target.name==='amount'){state.directIncomeAmount=event.target.value;}
      else if(event.target.id==='stockUsageNote'){state.stockUsageNote=event.target.value;}
      else if(event.target.closest('#checkoutFormV4')&&(event.target.name==='discount'||event.target.name==='pointsToRedeem')) updateCheckoutPreview();
      else if(event.target.matches('[data-purchase-entry-qty]')){const item=state.purchaseEntryCart[Number(event.target.dataset.purchaseEntryQty)];if(item)item.qty=Math.max(1,Math.round(Number(event.target.value||1)));}
      else if(event.target.matches('[data-purchase-entry-cost]')){const item=state.purchaseEntryCart[Number(event.target.dataset.purchaseEntryCost)];if(item)item.unitCost=Math.max(0,Number(event.target.value||0));}
      else if(event.target.id==='purchaseEntryReceivedAt'){state.purchaseEntryReceivedAt=event.target.value;}
      else if(event.target.id==='purchaseEntrySupplier'){state.purchaseEntrySupplier=event.target.value;}
      else if(event.target.id==='purchaseEntryExternalNo'){state.purchaseEntryExternalNo=event.target.value;}
      else if(event.target.id==='purchaseEntryExtraCost'){state.purchaseEntryExtraCost=Math.max(0,Number(event.target.value||0));}
      else if(event.target.id==='purchaseEntryNote'){state.purchaseEntryNote=event.target.value;}
      else if(event.target.id==='purchaseEntryPaymentDate'){state.purchaseEntryPaymentDate=event.target.value;}
      else if(event.target.id==='stocktakeNote'){state.stocktakeNote=event.target.value;}
      else if(event.target.matches('[data-stocktake-count]')){const item=state.stocktakeCart[Number(event.target.dataset.stocktakeCount)];if(item)item.countedStock=event.target.value;}
    });
    document.addEventListener('change',function(event){
      if(event.target.matches('[data-cart-qty]')){const item=state.cart[Number(event.target.dataset.cartQty)];if(item){item.qty=Math.max(1,Math.round(Number(event.target.value||1)));event.target.value=String(item.qty);const cartRow=event.target.closest('.ops-cart-row'),lineTotalInput=cartRow&&query('[data-cart-line-total]',cartRow);if(lineTotalInput)lineTotalInput.value=String(item.qty*item.unitPrice);updateCartTotals();updateInlineCheckoutTotals();}return;}
      if(event.target.id==='productFilter'){
        if(!closeProductEditorForListChange()){event.target.value=state.productFilter;return;}
        state.productFilter=event.target.value;state.productSeries='all';state.productSearch='';state.productVisible=PRODUCT_PAGE_SIZE;render();
      }
      else if(event.target.id==='productSort'){
        if(!closeProductEditorForListChange()){event.target.value=state.productSort;return;}
        state.productSort=event.target.value;render();
      }
      else if(event.target.id==='purchaseEntrySort'){state.purchaseEntrySort=event.target.value;renderKeepingViewport();}
      else if(event.target.matches('[data-purchase-entry-qty]')){const item=state.purchaseEntryCart[Number(event.target.dataset.purchaseEntryQty)];if(item)item.qty=Math.max(1,Math.round(Number(event.target.value||1)));renderKeepingViewport();}
      else if(event.target.matches('[data-purchase-entry-cost]')){const item=state.purchaseEntryCart[Number(event.target.dataset.purchaseEntryCost)];if(item)item.unitCost=Math.max(0,Number(event.target.value||0));renderKeepingViewport();}
      else if(event.target.id==='purchaseEntryExtraCost'){state.purchaseEntryExtraCost=Math.max(0,Number(event.target.value||0));renderKeepingViewport();}
      else if(event.target.id==='purchaseEntrySupplierId'){state.purchaseEntrySupplierId=event.target.value;const supplier=supplierById(state.purchaseEntrySupplierId);if(supplier)state.purchaseEntrySupplier=supplier.name;renderKeepingViewport();}
      else if(event.target.id==='purchaseEntryPaymentStatus'){state.purchaseEntryPaymentStatus=event.target.value;if(state.purchaseEntryPaymentStatus==='paid'&&!state.purchaseEntryPaymentDate)state.purchaseEntryPaymentDate=dateText(new Date());renderKeepingViewport();}
      else if(event.target.id==='purchaseEntryPaymentMethod'){state.purchaseEntryPaymentMethod=event.target.value;}
      else if(event.target.id==='stocktakeSort'){state.stocktakeSort=event.target.value;renderKeepingViewport();}
      else if(event.target.matches('[data-stocktake-count]')){const item=state.stocktakeCart[Number(event.target.dataset.stocktakeCount)];if(item)item.countedStock=event.target.value;renderKeepingViewport();}
      else if(event.target.id==='financeRange'){state.financeRange=event.target.value;render();}
      else if(event.target.id==='saleInvoiceFrom'){state.saleInvoiceFrom=event.target.value;renderKeepingViewport();}
      else if(event.target.id==='saleInvoiceTo'){state.saleInvoiceTo=event.target.value;renderKeepingViewport();}
      else if(event.target.id==='overviewDate'&&/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)){state.overviewDate=event.target.value>todayDateKey()?todayDateKey():event.target.value;state.overviewRange='today';render();}
      else if(event.target.id==='overviewMonth'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)){state.overviewMonth=event.target.value;state.overviewRange='month';render();}
      else if(event.target.id==='overviewFrom'){state.overviewFrom=event.target.value;}
      else if(event.target.id==='overviewTo'){state.overviewTo=event.target.value;}
      else if(event.target.id==='purchaseDate'&&/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)){state.purchaseDate=event.target.value;state.purchaseRange='today';renderKeepingViewport();}
      else if(event.target.id==='purchaseMonth'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)){state.purchaseMonth=event.target.value;state.purchaseRange='month';renderKeepingViewport();}
      else if(event.target.id==='purchaseFrom'){state.purchaseFrom=event.target.value;}
      else if(event.target.id==='purchaseTo'){state.purchaseTo=event.target.value;}
      else if(event.target.id==='platformOrderDate'&&/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)){state.platformOrderDate=event.target.value;state.platformOrderRange='today';renderKeepingViewport();}
      else if(event.target.id==='platformOrderMonth'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)){state.platformOrderMonth=event.target.value;state.platformOrderRange='month';renderKeepingViewport();}
      else if(event.target.id==='platformOrderFrom'){state.platformOrderFrom=event.target.value;}
      else if(event.target.id==='platformOrderTo'){state.platformOrderTo=event.target.value;}
      else if(event.target.id==='posCustomerSelect'){state.selectedCustomerId=event.target.value;render();}
      else if(event.target.closest('#saleEditForm')&&event.target.name==='paymentStatus'){const field=byId('saleEditReceivedField');if(field)field.classList.toggle('hidden',event.target.value!=='partial');}
      else if(event.target.id==='importFile'){parseImportFile(event.target.files&&event.target.files[0]).catch(function(error){toast('檔案解析失敗',errorMessage(error),'error');});}
    });
    global.addEventListener('hashchange',function(){closeMobileMenu(); if(!ensureDataForCurrentView())render();});
    global.addEventListener('message',handleInjiaoyunBridgeMessage);
    const refreshBtn=byId('opsRefreshBtn'); if(refreshBtn)refreshBtn.addEventListener('click',function(){try{localStorage.removeItem(DASHBOARD_CACHE_KEY);}catch(err){} if(state.view==='products')loadProductsOnly(false);else loadAll(false);});
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
    if(initialView==='products'){
      render();
      await loadProductsOnly(false);
    }else if(cache){
      showCachedDashboard(cache);
      await loadAll(true);
    }else{
      render();
      await loadAll(false);
    }
  }

  global.OperationsCenterV1={init:init,reload:function(){return loadAll(false);},state:state};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
