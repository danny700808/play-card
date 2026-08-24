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
  const VERSION = '2026.08.24-listing-intents-physical';
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
  const PRODUCT_PHYSICAL_IMAGE_MAX = 20;
  const PRODUCT_LISTING_INTENTS = ['create-single','create-group','add-variant','update-existing'];
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
    platformOrderMonth:(function(){const now=new Date();return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');})