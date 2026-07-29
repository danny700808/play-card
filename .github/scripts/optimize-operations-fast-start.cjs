'use strict';

// One-time idempotent patch: show cached operations data before background refresh.
const fs = require('fs');
const path = 'operations-phase1.js';
let source = fs.readFileSync(path, 'utf8');

function replaceRequired(pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error('Unable to patch: ' + label);
  source = next;
}

if (!source.includes("const FAST_STATE_DB_NAME = 'youzi-operations-fast-start'")) {
  replaceRequired(
    "  const DASHBOARD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;",
    "  const DASHBOARD_CACHE_TTL_MS = 6 * 60 * 60 * 1000;\n  const FAST_STATE_DB_NAME = 'youzi-operations-fast-start';\n  const FAST_STATE_STORE = 'snapshots';\n  const FAST_STATE_KEY = 'latest';\n  const FAST_STATE_TTL_MS = 12 * 60 * 60 * 1000;",
    'fast state constants'
  );
}

if (!source.includes('async function restoreFastStateCache()')) {
  replaceRequired(
    "  function ensureDataForCurrentView(){",
`  function openFastStateDb(){
    return new Promise(function(resolve,reject){
      if(!global.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
      const request=global.indexedDB.open(FAST_STATE_DB_NAME,1);
      request.onupgradeneeded=function(){const db=request.result;if(!db.objectStoreNames.contains(FAST_STATE_STORE))db.createObjectStore(FAST_STATE_STORE);};
      request.onsuccess=function(){resolve(request.result);};
      request.onerror=function(){reject(request.error||new Error('IndexedDB open failed'));};
    });
  }
  async function saveFastStateCache(){
    try{
      const db=await openFastStateDb();
      const payload={savedAt:Date.now(),loadedAt:state.loadedAt?state.loadedAt.toISOString():'',fullLoadedAt:state.fullLoadedAt?state.fullLoadedAt.toISOString():'',data:{
        onlineSource:state.onlineSource,onlineProducts:state.onlineProducts,easyStoreSync:state.easyStoreSync,onlineOrphans:state.onlineOrphans,matchingStats:state.matchingStats,
        internalProducts:state.internalProducts,catalog:state.catalog,rentals:state.rentals,rentalLedgers:state.rentalLedgers,sales:state.sales,incomes:state.incomes,purchases:state.purchases,inventory:state.inventory,suppliers:state.suppliers,
        inventoryCountSettings:state.inventoryCountSettings,cases:state.cases,expenses:state.expenses,syncJobs:state.syncJobs,audit:state.audit,customers:state.customers,pointTransactions:state.pointTransactions,
        receivables:state.receivables,receivablePayments:state.receivablePayments,salesReturns:state.salesReturns,educationDaily:state.educationDaily,platformOrders:state.platformOrders,platformSyncRuns:state.platformSyncRuns,
        platformInventoryQueue:state.platformInventoryQueue,platformFeeSettings:state.platformFeeSettings,platformLocalAgent:state.platformLocalAgent,membershipSettings:state.membershipSettings,injiaoyunCloudSync:state.injiaoyunCloudSync
      }};
      await new Promise(function(resolve,reject){const tx=db.transaction(FAST_STATE_STORE,'readwrite');tx.objectStore(FAST_STATE_STORE).put(payload,FAST_STATE_KEY);tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error||new Error('IndexedDB write failed'));};});
      db.close();
    }catch(error){console.warn('operations fast-state cache save failed',error);}
  }
  async function restoreFastStateCache(){
    try{
      const db=await openFastStateDb();
      const payload=await new Promise(function(resolve,reject){const tx=db.transaction(FAST_STATE_STORE,'readonly');const request=tx.objectStore(FAST_STATE_STORE).get(FAST_STATE_KEY);request.onsuccess=function(){resolve(request.result||null);};request.onerror=function(){reject(request.error||new Error('IndexedDB read failed'));};});
      db.close();
      if(!payload||!payload.savedAt||Date.now()-Number(payload.savedAt)>FAST_STATE_TTL_MS||!payload.data)return false;
      Object.keys(payload.data).forEach(function(key){state[key]=payload.data[key];});
      state.loadedAt=payload.loadedAt?new Date(payload.loadedAt):null;
      state.fullLoadedAt=payload.fullLoadedAt?new Date(payload.fullLoadedAt):null;
      state.diagnostics=[];
      return !!(state.loadedAt||state.fullLoadedAt);
    }catch(error){console.warn('operations fast-state cache restore failed',error);return false;}
  }

  function ensureDataForCurrentView(){`,
    'fast state helpers'
  );
}

if (!source.includes('saveFastStateCache();\n      render();')) {
  replaceRequired(
    "      setText('opsLastReadText','商品最後讀取：'+dateTimeText(state.loadedAt));\n      render();",
    "      setText('opsLastReadText','商品最後讀取：'+dateTimeText(state.loadedAt));\n      saveFastStateCache();\n      render();",
    'save product cache'
  );
}

if (!source.includes('saveDashboardCache();\n      saveFastStateCache();')) {
  replaceRequired(
    "      saveDashboardCache();\n      render();",
    "      saveDashboardCache();\n      saveFastStateCache();\n      render();",
    'save full cache'
  );
}

replaceRequired(
`    state.user=user; setText('opsUserChip',userLabel());
    try{state.db=initDb();}catch(error){showAlert(errorMessage(error),'error');html('opsContent',emptyHtml('Firebase初始化失敗',errorMessage(error)));return;}
    watchInjiaoyunCloudSync();
    bindEvents();
    const initialView=(location.hash||'#overview').replace('#','').split('?')[0]||'overview';
    const cache=initialView==='overview'?getDashboardCache():null;
    if(isCourseWorkspaceView(initialView)){
      render();
    }else if(initialView==='products'){
      render();
      await loadProductsOnly(false);
    }else if(cache){
      showCachedDashboard(cache);
      await loadAll(true);
    }else{
      render();
      await loadAll(false);
    }`,
`    state.user=user; setText('opsUserChip',userLabel());
    try{state.db=initDb();}catch(error){showAlert(errorMessage(error),'error');html('opsContent',emptyHtml('Firebase初始化失敗',errorMessage(error)));return;}
    const restoredFastState=await restoreFastStateCache();
    watchInjiaoyunCloudSync();
    bindEvents();
    const initialView=(location.hash||'#overview').replace('#','').split('?')[0]||'overview';
    const cache=initialView==='overview'?getDashboardCache():null;
    if(isCourseWorkspaceView(initialView)){
      render();
    }else if(initialView==='products'){
      render();
      if(restoredFastState&&state.loadedAt)loadProductsOnly(true);else await loadProductsOnly(false);
    }else if(cache){
      showCachedDashboard(cache);
      loadAll(true);
    }else if(restoredFastState&&state.fullLoadedAt){
      render();
      loadAll(true);
    }else{
      render();
      await loadAll(false);
    }`,
  'fast init path'
);

fs.writeFileSync(path, source);
console.log('Operations fast-start cache installed.');
