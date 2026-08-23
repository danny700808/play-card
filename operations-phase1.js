(function(global){
  'use strict';

  const ONLINE_COLLECTIONS = []; // V3：網路資料只由 EasyStore API 提供
  const COLLECTIONS = {
    products:'opsInternalProducts',
    listingCases:'opsProductListingCases',
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
    platformInventoryQueue:'opsPlatformInventoryQueue',
    employees:'employees',
    employeeSalaryConfigs:'employeeSalaryConfigs',
    employeeSalaryConfigHistory:'employeeSalaryConfigHistory',
    parttimeRecords:'parttimeRecords'
  };
  const READ_LIMIT = 10000;
  const FIRESTORE_READ_TIMEOUT_MS = 45 * 1000;
  const BATCH_SIZE = 400;
  const PRODUCT_PAGE_SIZE = 24;
  const VERSION = '2026.08.23-simple-platform-presence';
  const PRODUCT_LISTING_CODEX_THREAD_ID = '019ffef6-51ed-79c3-9fb1-d73586a48e61';
  const PRODUCT_LISTING_CODEX_THREAD_URL = 'codex://threads/' + PRODUCT_LISTING_CODEX_THREAD_ID;
  const PRODUCT_LISTING_WORKFLOW_VERSION = 'youzi-four-channel-listing-v3';
  const PRODUCT_LISTING_PLATFORM_ORDER = ['momo','coupang','easyStore','shopee'];
  const PRODUCT_LISTING_IMAGE_ROLES = ['cleanMain','brandedHero','storefrontPortrait','localizedDetail','specification','variantRepresentative'];
  let pendingShopeeAutofillPayload = null;
  let pendingShopeeAutofillPayloadQueue = [];
  let productListingSpeechRecognition = null;
  const PRODUCT_REFERENCE_IMAGE_MAX = 20;
  const PRODUCT_SELECTED_IMAGE_MAX = 20;
  const PRODUCT_GROUP_LISTING_IMAGE_MAX = 12;
  const PRODUCT_IMAGE_COLLECTION = {
    source:'youzi-operations-hub',extensionSource:'youzi-image-collector-extension',
    start:'YOUZI_IMAGE_COLLECTION_START',stop:'YOUZI_IMAGE_COLLECTION_STOP',
    sessionAck:'YOUZI_IMAGE_COLLECTION_SESSION_ACK',sessionState:'YOUZI_IMAGE_COLLECTION_SESSION_STATE',stateRequest:'YOUZI_IMAGE_COLLECTION_STATE_REQUEST',
    deliver:'YOUZI_IMAGE_COLLECTION_DELIVER',fileAck:'YOUZI_IMAGE_COLLECTION_FILE_ACK',maxImages:PRODUCT_REFERENCE_IMAGE_MAX
  };
  let productImageCollectionSession = null;
  let productImageCollectionPending = null;
  let productImageCollectionPendingUploads = 0;
  let productImageCollectionUploadChain = Promise.resolve();
  let productImageCollectionDeliverySequence = 0;
  let productImageCollectionUploadFailures = [];
  const productListingSourceImageCache = new Map();
  const PRODUCT_SHIPPING_DECISIONS = {
    convenience:{label:'可超商寄',description:'小型商品；可先使用安全的估算包裝資料。'},
    home:{label:'不可超商／一般宅配',description:'超過超商限制，但仍可用一般宅配寄送。'},
    freight:{label:'大型商品／新竹物流',description:'大型或較重商品；送出平台草稿前需補齊外箱尺寸。'}
  };
  const PRODUCT_PACKAGE_PRESETS = {
    convenience:{lengthCm:40,widthCm:30,heightCm:10,weightKg:1}
  };
  // 後端最長執行 30 分鐘；瀏覽器多留 1 分鐘接收後端的最終成功／失敗回應。
  const EASYSTORE_CATALOG_CLIENT_TIMEOUT_MS = 31 * 60 * 1000;
  const DASHBOARD_CACHE_KEY = 'youzi_ops_dashboard_overview_v10_operating_expenses';
  const DASHBOARD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  const FAST_STATE_DB_NAME = 'youzi-operations-fast-start';
  const FAST_STATE_STORE = 'snapshots';
  const FAST_STATE_KEY = 'latest';
  const FAST_STATE_TTL_MS = 12 * 60 * 60 * 1000;
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
  EasyStore:{enabled:true,platformRate:0,invoiceRate:0},
  MOMO:{enabled:true,platformRate:13,invoiceRate:0},
  Coupang:{enabled:true,platformRate:13,invoiceRate:0}
};

  const OPERATING_EXPENSE_FALLBACK_CATEGORIES=[
    {id:'rent',label:'房屋租金',defaultMode:'monthly'},{id:'yamaha-authorization',label:'Yamaha 授權費',defaultMode:'monthly'},
    {id:'electricity',label:'電費',defaultMode:'bimonthly'},{id:'water',label:'水費',defaultMode:'monthly'},{id:'phone-internet',label:'電話／網路費',defaultMode:'monthly'},
    {id:'payroll',label:'薪資',defaultMode:'monthly'},
    {id:'labor-insurance',label:'勞保公司負擔',defaultMode:'monthly'},{id:'health-insurance',label:'健保公司負擔',defaultMode:'monthly'},{id:'labor-pension',label:'勞退公司提繳',defaultMode:'monthly'},
    {id:'occupational-insurance',label:'職災保險',defaultMode:'monthly'},{id:'accounting',label:'會計／記帳費',defaultMode:'monthly'},{id:'marketing',label:'廣告／行銷費',defaultMode:'actual'},
    {id:'software',label:'軟體／雲端訂閱',defaultMode:'monthly'},{id:'bank-fee',label:'銀行／刷卡手續費',defaultMode:'actual'},{id:'cleaning',label:'清潔／垃圾處理費',defaultMode:'actual'},
    {id:'supplies',label:'文具／印刷／教學耗材',defaultMode:'actual'},{id:'maintenance',label:'維修保養費',defaultMode:'actual'},{id:'transport',label:'運費／油資／停車費',defaultMode:'actual'},
    {id:'insurance',label:'公共意外／設備保險',defaultMode:'annual'},{id:'tax',label:'稅費',defaultMode:'actual'},{id:'other',label:'其他支出',defaultMode:'actual'}
  ];
  function fallbackExpenseSettings(raw){
    const source=raw&&typeof raw==='object'?raw:{},rules=Array.isArray(source.recurringRules)?source.recurringRules:[];
    function mode(value){return ['actual','monthly','bimonthly','annual'].includes(String(value||''))?String(value):'monthly';}
    function normalize(row,fallback){const found=row||{},base=fallback||{},allocationMode=mode(found.allocationMode||base.allocationMode);return {id:String(found.id||base.id||''),category:String(found.category||base.category||'其他支出'),amount:Math.max(0,Math.floor(Number(found.amount==null?base.amount:found.amount)||0)),startMonth:/^\d{4}-\d{2}$/.test(found.startMonth||'')?found.startMonth:(base.startMonth||'2026-07'),endMonth:/^\d{4}-\d{2}$/.test(found.endMonth||'')?found.endMonth:'',active:found.active==null?base.active!==false:found.active!==false,note:String(found.note||''),allocationMode:allocationMode,monthlyOverrides:(Array.isArray(found.monthlyOverrides)?found.monthlyOverrides:[]).filter(function(item){return /^\d{4}-\d{2}$/.test(item&&item.month||'');}).map(function(item){const itemMode=mode(item.mode||item.allocationMode||allocationMode),periodStartMonth=/^\d{4}-\d{2}$/.test(item.periodStartMonth||'')?item.periodStartMonth:'',periodEndMonth=/^\d{4}-\d{2}$/.test(item.periodEndMonth||'')?item.periodEndMonth:'';return {month:item.month,amount:Math.max(0,Math.floor(Number(item.amount)||0)),mode:itemMode,periodId:String(item.periodId||''),periodStartMonth:periodStartMonth,periodEndMonth:periodEndMonth,periodTotal:Math.max(0,Math.floor(Number(item.periodTotal)||0)),periodNote:String(item.periodNote||'')};}).sort(function(a,b){return a.month.localeCompare(b.month);})};}
    const defaults=[{id:'rent',category:'房屋租金',amount:42500,startMonth:'2026-07',allocationMode:'monthly',active:true},{id:'yamaha-authorization',category:'Yamaha 授權費',amount:6500,startMonth:'2026-07',allocationMode:'monthly',active:true}],normalized=defaults.map(function(base){return normalize(rules.find(function(row){return row&&row.id===base.id;}),base);});
    rules.forEach(function(row){if(row&&row.id&&!normalized.some(function(item){return item.id===row.id;}))normalized.push(normalize(row));});
    return {startMonth:'2026-07',closedWeekdays:[1],recurringRules:normalized};
  }
  function fallbackEffectiveExpenseRule(rule,month){const row=Object.assign({},rule),available=!!row.active&&month>=row.startMonth&&(!row.endMonth||month<=row.endMonth);let allocationMode=row.allocationMode||'monthly',amount=allocationMode==='monthly'||month===row.startMonth?row.amount:0,sourceMonth=row.startMonth,changedThisMonth=month===row.startMonth,periodId='',periodStartMonth='',periodEndMonth='',periodTotal=0,periodNote='';(row.monthlyOverrides||[]).forEach(function(item){if(item.month===month){amount=item.amount;allocationMode=item.mode||allocationMode;sourceMonth=item.month;changedThisMonth=true;periodId=item.periodId||'';periodStartMonth=item.periodStartMonth||'';periodEndMonth=item.periodEndMonth||'';periodTotal=Number(item.periodTotal||0);periodNote=item.periodNote||'';}else if(item.month<month){amount=(item.mode||'monthly')==='monthly'?item.amount:0;allocationMode=item.mode||allocationMode;sourceMonth=item.month;changedThisMonth=false;periodId='';periodStartMonth='';periodEndMonth='';periodTotal=0;periodNote='';}});return Object.assign(row,{amount:available?amount:0,allocationMode:allocationMode,sourceMonth:available?sourceMonth:'',changedThisMonth:available&&changedThisMonth,periodId:periodId,periodStartMonth:periodStartMonth,periodEndMonth:periodEndMonth,periodTotal:periodTotal,periodNote:periodNote,available:available});}
  const OPERATING_EXPENSE_FALLBACK_ENGINE={
    EXPENSE_CATEGORIES:OPERATING_EXPENSE_FALLBACK_CATEGORIES,
    normalizeSettings:fallbackExpenseSettings,
    effectiveRuleForMonth:fallbackEffectiveExpenseRule,
    recurringRulesForMonth:function(settings,month,includeZero){return fallbackExpenseSettings(settings).recurringRules.map(function(rule){return fallbackEffectiveExpenseRule(rule,month);}).filter(function(rule){return rule.available&&(includeZero!==false||rule.amount>0);});},
    normalizeExpenseMode:function(value){return ['actual','monthly','bimonthly','annual'].includes(String(value||''))?String(value):'actual';},
    buildLedger:function(){return [];},
    summarizeByCategory:function(){return [];},
    nextMonth:function(value,step){if(!/^\d{4}-\d{2}$/.test(String(value||'')))return '';const part=String(value).split('-').map(Number),date=new Date(part[0],part[1]-1+(Number(step)||1),1);return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0');}
  };
  function operatingExpenseEngine(){return global.YouziOperatingExpenses||OPERATING_EXPENSE_FALLBACK_ENGINE;}
  let operatingExpenseLoadPromise=null;
  function ensureOperatingExpenseEngineLoaded(){
    if(global.YouziOperatingExpenses)return Promise.resolve(true);
    if(operatingExpenseLoadPromise)return operatingExpenseLoadPromise;
    operatingExpenseLoadPromise=new Promise(function(resolve){
      let settled=false;function finish(ok){if(settled)return;settled=true;resolve(!!ok);}
      const script=document.createElement('script');script.src='operations-expenses.js?v=20260801-operating-expenses-v6-retry';script.async=false;script.onload=function(){finish(!!global.YouziOperatingExpenses);};script.onerror=function(){finish(false);};document.head.appendChild(script);setTimeout(function(){finish(!!global.YouziOperatingExpenses);},8000);
    });
    return operatingExpenseLoadPromise;
  }
  const OPERATING_EXPENSE_DEPARTMENTS=[
    {id:'store',label:'尚品樂器行',shortLabel:'營業部門'},
    {id:'academy',label:'凱立音樂補習班',shortLabel:'補習部門'}
  ];
  function zeroOperatingExpenseSettings(){
    return operatingExpenseEngine().normalizeSettings({recurringRules:[
      {id:'rent',category:'房屋租金',amount:0,startMonth:'2026-07',allocationMode:'monthly',active:true},
      {id:'yamaha-authorization',category:'Yamaha 授權費',amount:0,startMonth:'2026-07',allocationMode:'monthly',active:true}
    ]});
  }
  function normalizeOperatingExpenseSettings(raw){
    const source=raw&&typeof raw==='object'?raw:{},departments=source.departments&&typeof source.departments==='object'?source.departments:{},store=operatingExpenseEngine().normalizeSettings(departments.store||source),academy=departments.academy?operatingExpenseEngine().normalizeSettings(departments.academy):zeroOperatingExpenseSettings();
    return Object.assign({},store,{schemaVersion:2,departments:{store:store,academy:academy}});
  }
  function defaultOperatingExpenseSettings(){return normalizeOperatingExpenseSettings({});}


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
    employees:[],
    employeeSalaryConfigs:[],
    employeeSalaryConfigHistory:[],
    parttimeRecords:[],
    platformSyncPanel:'',
    platformFeeSettings:JSON.parse(JSON.stringify(DEFAULT_PLATFORM_FEE_SETTINGS)),
    operatingExpenseSettings:defaultOperatingExpenseSettings(),
    operatingExpenseDepartment:'store',
    platformLocalAgent:{},
    diagnostics:[],
    productVisible:PRODUCT_PAGE_SIZE,
    productSearch:'',
    productFilter:'all',
    productRecentOnly:false,
    productSort:'sku',
    productDisplayMode:'image',
    productSeries:'all',
    productEditId:'',
    productPreviewImages:[],
    productPreviewIndex:0,
    productPreviewTitle:'',
    physicalPhotoSearch:'',
    physicalPhotoProductId:'',
    physicalPhotoBusy:false,
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
    operatingExpenseMonth:(function(){const now=new Date(),value=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');return value<'2026-07'?'2026-07':value;})(),
    injiaoyunRequestId:'',
    importRows:[],
    importFileName:'',
    importMode:'initial',
    importSummary:null,
    confirmResolve:null
  };

  // 先讓瀏覽器畫出使用者剛輸入的內容，再更新可能很大的完整結果清單。
  const LIVE_SEARCH_INPUT_IDLE_MS = 240;
  const liveSearchJobs = Object.create(null);

  const PAGE_META = {
    overview:['營運總覽',''],
    'course-calendar':['課程日表',''],
    'course-students':['學生與學費',''],
    'course-teachers':['老師薪資',''],
    'course-settings':['系統設定',''],
    products:['商品資訊',''],
    'physical-photos':['拍實體圖','搜尋商品後直接用手機拍照，照片會保存到商品後台的「實體圖片」。'],
    sales:['現場銷售',''],
    customers:['客戶會員','會員、老師與一般客戶共用同一份客戶資料。'],
    receivables:['應收帳款','應收帳款會連回客戶與原始銷售。'],
    expenses:['營運支出','按月登錄水電、薪資、勞健保與其他費用，並查看每日攤提。'],
    purchases:['庫存作業',''],
    'purchase-entry':['進貨入庫工作台',''],
    stocktake:['庫存盤點工作台',''],
    rentals:['租賃營運','正式合約送出即列入租賃收入，押金不列入營業收入。'],
    sync:['平台訂單',''],
    connection:['資料備份','']
  };
  const COURSE_WORKSPACE_VIEWS = {
    'course-calendar':'calendar',
    'course-students':'students',
    'course-teachers':'teachers',
    'course-settings':'settings'
  };
  const COURSE_WORKSPACE_HASHES = {
    calendar:'course-calendar',
    students:'course-students',
    teachers:'course-teachers',
    settings:'course-settings'
  };

  function isCourseWorkspaceView(view){
    return Object.prototype.hasOwnProperty.call(COURSE_WORKSPACE_VIEWS,view);
  }
  function courseWorkspaceView(view){
    return COURSE_WORKSPACE_VIEWS[view]||'calendar';
  }

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
    byId('opsDrawer').classList.remove('ops-listing-case-drawer');
    setText('opsDrawerTitle',title||'資料編輯'); setText('opsDrawerSubtitle',subtitle||''); html('opsDrawerBody',body||'');
    enhanceMobileNumberInputs(byId('opsDrawerBody'));
    byId('opsDrawer').classList.add('open'); byId('opsDrawerBackdrop').classList.add('open');
  }
  function closeDrawer(){ const form=byId('productListingCaseForm');if(productImageCollectionSession&&productImageCollectionSession.active)stopProductImageCollection(form).catch(function(){});byId('opsDrawer').classList.remove('open'); byId('opsDrawerBackdrop').classList.remove('open'); }

  function recursiveValuesByKeys(value,keys,depth,seen){
    depth=depth==null?0:depth; seen=seen||new Set(); if(value==null||depth>7) return [];
    if(typeof value!=='object') return [];
    if(seen.has(value)) return []; seen.add(value);
    const wanted=new Set(keys.map(function(k){return lower(k);})); const results=[