(function(global){
  'use strict';

  const ONLINE_COLLECTIONS = ['easystoreProducts','websiteProducts','officialWebsiteProducts','websiteGoods','products'];
  const INTERNAL_COLLECTION = 'opsInternalProducts';
  const IMPORT_COLLECTION = 'opsInternalProductImports';
  const ONLINE_LIMIT = 6000;
  const INTERNAL_LIMIT = 10000;
  const PAGE_SIZE = 30;
  const BATCH_SIZE = 400;
  const READ_TIMEOUT_MS = 25000;
  const AUTO_SOURCE_PREFIX = 'src_';

  const state = {
    user:null,
    db:null,
    view:'overview',
    onlineProducts:[],
    internalProducts:[],
    catalog:[],
    onlineSource:'',
    diagnostics:[],
    loading:false,
    loadedAt:null,
    visibleCount:PAGE_SIZE,
    importRows:[],
    importSummary:null,
    importFileName:'',
    editingCode:'',
    editingDocId:'',
    editingSourceKey:'',
    activeMatchFilter:'',
    autoCreating:false,
    internalPermissionError:''
  };

  const pageMeta = {
    overview:['主檔總覽','先把現有網路商品一鍵建立成內部主檔，再逐步補齊 SKU、成本、庫存與安全庫存。'],
    products:['內部商品主檔','同一件商品同時保留內部名稱、網路名稱、門市售價、網路售價與成本。'],
    import:['Excel 初始匯入','先在瀏覽器分析舊系統 Excel，確認後才批次寫入 Firebase。'],
    matching:['商品配對狀態','使用完全相同的商品編號／SKU，自動連結內部主檔與 EasyStore 商品。']
  };

  function clean(value){ return String(value == null ? '' : value).trim(); }
  function lower(value){ return clean(value).toLowerCase(); }
  function escapeHtml(value){
    return clean(value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});
  }
  function setText(id,value){ const el=document.getElementById(id); if(el) el.textContent=value; }
  function safeUrl(value){
    const raw=clean(value); if(!raw) return '';
    try{ const u=new URL(raw,global.location.href); return ['http:','https:'].includes(u.protocol)?u.href:''; }catch(err){ return ''; }
  }
  function firstValue(obj,keys){
    for(const key of keys){
      const value=getPath(obj,key);
      if(value!==undefined && value!==null && clean(value)!=='') return value;
    }
    return '';
  }
  function getPath(obj,path){
    if(!obj||!path) return undefined;
    if(Object.prototype.hasOwnProperty.call(obj,path)) return obj[path];
    const parts=String(path).split('.'); let cursor=obj;
    for(const part of parts){ if(cursor==null || !Object.prototype.hasOwnProperty.call(cursor,part)) return undefined; cursor=cursor[part]; }
    return cursor;
  }
  function numberInfo(value){
    if(value===undefined || value===null || clean(value)==='') return {found:false,value:0};
    const n=Number(String(value).replace(/,/g,'').replace(/[^0-9.\-]/g,''));
    return Number.isFinite(n)?{found:true,value:n}:{found:false,value:0};
  }
  function firstNumber(obj,keys){
    for(const key of keys){ const info=numberInfo(getPath(obj,key)); if(info.found) return info; }
    return {found:false,value:0};
  }
  function money(value){ const n=Number(value); return Number.isFinite(n)?('NT$ '+Math.round(n).toLocaleString('zh-TW')):'—'; }
  function compactMoney(value){ const n=Number(value); return Number.isFinite(n)?('$'+Math.round(n).toLocaleString('zh-TW')):'—'; }
  function pct(part,total){ return total?((Math.round(part/total*1000)/10).toFixed(1).replace('.0','')+'%'):'0%'; }
  function dateFrom(value){
    if(!value) return null;
    try{
      if(value && typeof value.toDate==='function') return value.toDate();
      if(value instanceof Date) return value;
      if(typeof value==='object' && Number.isFinite(Number(value.seconds))) return new Date(Number(value.seconds)*1000);
      const d=new Date(value); return Number.isNaN(d.getTime())?null:d;
    }catch(err){ return null; }
  }
  function dateTimeText(value){
    const d=dateFrom(value); if(!d) return '—';
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }
  function normalizeCode(value){ return clean(value).replace(/^'+/,'').replace(/\u00a0/g,' ').trim().toUpperCase(); }
  function docIdForCode(code){ return encodeURIComponent(normalizeCode(code)); }
  function decodeDocId(value){ try{return decodeURIComponent(clean(value));}catch(err){return clean(value);} }
  function hashText(value){
    let hash=2166136261;
    const text=clean(value);
    for(let i=0;i<text.length;i+=1){ hash^=text.charCodeAt(i); hash=Math.imul(hash,16777619); }
    return (hash>>>0).toString(36);
  }
  function onlineSourceKey(row){
    if(!row) return '';
    return clean(row.sourceCollection)+'::'+clean(row.id||row.docId);
  }
  function docIdForOnline(row){
    const sourceKey=onlineSourceKey(row);
    const suffix=clean(row.id||row.docId).replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,38);
    return AUTO_SOURCE_PREFIX+hashText(sourceKey)+(suffix?'_'+suffix:'');
  }
  function userLabel(){ return clean(state.user&& (state.user.id||state.user.employeeId||state.user.email||state.user.name)); }
  function imageFrom(value){
    if(!value) return '';
    if(typeof value==='string') return safeUrl(value);
    if(Array.isArray(value)){ for(const item of value){ const found=imageFrom(item); if(found) return found; } return ''; }
    if(typeof value==='object') return safeUrl(firstValue(value,['src','url','imageUrl','original','large','medium','small','secure_url','downloadURL']));
    return '';
  }
  function onlineImage(obj){
    const direct=[obj.imageUrl,obj.image,obj.picture,obj.cover,obj.featuredImage,obj.featured_image,obj.mainImage,obj.thumbnail,obj.photo,obj['圖片']];
    for(const item of direct){ const found=imageFrom(item); if(found) return found; }
    return imageFrom(obj.images||obj.photos||obj.media||[]);
  }
  function onlineCode(obj){ return normalizeCode(firstValue(obj,['sku','SKU','productCode','itemCode','internalCode','商品編號'])); }
  function onlineName(obj){ return clean(firstValue(obj,['name','title','itemName','productName','商品名稱'])) || '未命名網路商品'; }

  function normalizeOnlineBase(obj,collection,docId){
    const code=onlineCode(obj);
    const price=firstNumber(obj,['price','marketPrice','salePrice','websiteOriginalPrice','regularPrice','variantPrice','官網價格','價格']);
    const stock=firstNumber(obj,['availableQuantity','availableStock','inventoryQuantity','stockQuantity','quantity','stock','inventory','庫存','庫存數量']);
    return {
      id:clean(firstValue(obj,['productId','websiteProductId','itemId','id','__id'])) || docId,
      docId:docId,
      code:code,
      onlineName:onlineName(obj),
      onlinePriceFound:price.found,
      onlinePrice:price.value,
      onlineStockFound:stock.found,
      onlineStock:stock.value,
      imageUrl:onlineImage(obj),
      url:safeUrl(firstValue(obj,['url','productUrl','websiteProductUrl','permalink','link','連結'])),
      brand:clean(firstValue(obj,['brand','vendor','manufacturer','品牌'])),
      category:clean(firstValue(obj,['category','productType','type','分類'])),
      variantName:clean(firstValue(obj,['variantSummary','optionsText','variantName','specification','規格'])),
      sourceCollection:collection,
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
      row.id=base.id+'::'+(clean(firstValue(variant||{},['id','variantId','sku','name','title']))||String(index+1));
      row.onlineName=base.onlineName;
      row.code=row.code||base.code;
      row.onlinePriceFound=row.onlinePriceFound||base.onlinePriceFound;
      row.onlinePrice=row.onlinePriceFound?row.onlinePrice:base.onlinePrice;
      row.onlineStockFound=row.onlineStockFound||base.onlineStockFound;
      row.onlineStock=row.onlineStockFound?row.onlineStock:base.onlineStock;
      row.imageUrl=onlineImage(variant)||base.imageUrl;
      row.url=row.url||base.url;
      row.brand=row.brand||base.brand;
      row.category=row.category||base.category;
      row.variantName=clean(firstValue(variant||{},['name','title','optionName','variantName','sku']))||base.variantName;
      return row;
    });
  }
  function normalizeInternal(obj,docId){
    const explicitCode=normalizeCode(firstValue(obj,['code','productCode','sku','商品編號']));
    const sourceKey=clean(firstValue(obj,['sourceKey','onlineSourceKey']));
    const fallbackCode=(!sourceKey && !clean(docId).startsWith(AUTO_SOURCE_PREFIX))?decodeDocId(docId||''):'';
    const code=explicitCode||normalizeCode(fallbackCode);
    const cost=numberInfo(firstValue(obj,['purchaseCost','purchasePrice','cost','商品成本']));
    const storePrice=numberInfo(firstValue(obj,['storePrice','salePrice','retailPrice','門市售價']));
    const legacyStock=numberInfo(firstValue(obj,['legacyStockReference','legacyStock','withoutWarehouseStocks','stockReference','舊庫存參考']));
    const reward=numberInfo(firstValue(obj,['saleRewardPercent','rewardPercent','獎金比例']));
    return {
      docId:docId,
      code:code,
      internalName:clean(firstValue(obj,['internalName','name','商品名稱'])),
      purchaseCostFound:cost.found,
      purchaseCost:cost.value,
      storePriceFound:storePrice.found,
      storePrice:storePrice.value,
      legacyStockFound:legacyStock.found,
      legacyStock:legacyStock.value,
      rewardPercentFound:reward.found,
      rewardPercent:reward.value,
      remark:clean(firstValue(obj,['remark','note','備註'])),
      source:clean(obj.source||''),
      sourceKey:sourceKey,
      sourceCollection:clean(firstValue(obj,['sourceCollection','onlineSourceCollection'])),
      sourceProductId:clean(firstValue(obj,['sourceProductId','onlineProductId'])),
      autoCreated:obj.autoCreated===true || clean(obj.source)==='onlineAutoCreate',
      createdAt:obj.createdAt||obj.createdAtText||'',
      updatedAt:obj.updatedAt||obj.updatedAtText||'',
      raw:obj
    };
  }

  function withTimeout(promise,label){
    let timer;
    const timeout=new Promise(function(_,reject){ timer=setTimeout(function(){reject(new Error(label+' 讀取逾時'));},READ_TIMEOUT_MS); });
    return Promise.race([promise,timeout]).finally(function(){clearTimeout(timer);});
  }
  function initDb(){
    if(!global.firebase) throw new Error('Firebase SDK 尚未載入');
    const cfg=global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if(!cfg) throw new Error('找不到 Firebase 設定');
    if(!global.firebase.apps.length) global.firebase.initializeApp(cfg);
    return global.firebase.firestore();
  }
  function recordDiagnostic(collection,type,count,message,duration){ state.diagnostics.push({collection:collection,type:type,count:count||0,message:message||'',duration:duration||0}); }

  async function loadOnlineProducts(){
    state.onlineProducts=[]; state.onlineSource='';
    for(const collection of ONLINE_COLLECTIONS){
      const start=Date.now();
      try{
        const snap=await withTimeout(state.db.collection(collection).limit(ONLINE_LIMIT).get(),collection);
        const rows=[];
        snap.forEach(function(doc){
          const obj=Object.assign({},doc.data()||{},{__id:doc.id});
          rows.push.apply(rows,normalizeOnlineDoc(obj,collection,doc.id));
        });
        recordDiagnostic(collection,rows.length?'ok':'empty',rows.length,rows.length?'已讀取網路商品':'集合沒有資料',Date.now()-start);
        if(rows.length){ state.onlineProducts=rows; state.onlineSource=collection; break; }
      }catch(err){ recordDiagnostic(collection,'error',0,err.message||String(err),Date.now()-start); }
    }
  }
  async function loadInternalProducts(){
    const start=Date.now(); state.internalProducts=[]; state.internalPermissionError='';
    try{
      const snap=await withTimeout(state.db.collection(INTERNAL_COLLECTION).limit(INTERNAL_LIMIT).get(),INTERNAL_COLLECTION);
      snap.forEach(function(doc){ state.internalProducts.push(normalizeInternal(doc.data()||{},doc.id)); });
      recordDiagnostic(INTERNAL_COLLECTION,state.internalProducts.length?'ok':'empty',state.internalProducts.length,state.internalProducts.length?'已讀取內部商品主檔':'尚未建立內部商品主檔',Date.now()-start);
    }catch(err){
      state.internalPermissionError=err.message||String(err);
      recordDiagnostic(INTERNAL_COLLECTION,'error',0,state.internalPermissionError,Date.now()-start);
    }
  }

  function buildCatalog(){
    const onlineByCode=new Map();
    const onlineBySourceKey=new Map();
    state.onlineProducts.forEach(function(row){
      const code=normalizeCode(row.code);
      const sourceKey=onlineSourceKey(row);
      if(code){ if(!onlineByCode.has(code)) onlineByCode.set(code,[]); onlineByCode.get(code).push(row); }
      if(sourceKey) onlineBySourceKey.set(sourceKey,row);
    });

    const consumedOnlineIds=new Set();
    const combined=[];
    state.internalProducts.forEach(function(internal){
      let matches=[];
      if(internal.sourceKey && onlineBySourceKey.has(internal.sourceKey)){
        matches=[onlineBySourceKey.get(internal.sourceKey)];
      }else if(internal.code && onlineByCode.has(normalizeCode(internal.code))){
        matches=onlineByCode.get(normalizeCode(internal.code))||[];
      }
      matches.forEach(function(row){ consumedOnlineIds.add(row.id); });
      const online=matches[0]||null;
      const status=matches.length>1?'duplicate':(matches.length===1?'matched':'internal-only');
      combined.push(makeCatalogRow(internal,online,matches,status));
    });

    state.onlineProducts.forEach(function(row){
      if(consumedOnlineIds.has(row.id)) return;
      const sameCode=row.code?onlineByCode.get(normalizeCode(row.code))||[row]:[row];
      const status=sameCode.length>1?'duplicate':'online-only';
      combined.push(makeCatalogRow(null,row,sameCode,status));
    });

    state.catalog=combined.sort(function(a,b){
      const codeCompare=clean(a.code).localeCompare(clean(b.code),'zh-Hant',{numeric:true});
      if(codeCompare) return codeCompare;
      return clean(a.internalName||a.onlineName).localeCompare(clean(b.internalName||b.onlineName),'zh-Hant');
    });
  }
  function makeCatalogRow(internal,online,matches,status){
    const internalId=internal?clean(internal.docId):'';
    const onlineId=online?onlineSourceKey(online):'';
    return {
      id:internal?('internal:'+internalId):('online:'+onlineId),
      code:clean((internal&&internal.code)||(online&&online.code)),
      internal:internal,
      online:online,
      onlineMatches:matches||[],
      matchStatus:status,
      internalName:internal?internal.internalName:'',
      onlineName:online?online.onlineName:'',
      imageUrl:online?online.imageUrl:'',
      onlinePriceFound:!!(online&&online.onlinePriceFound),
      onlinePrice:online?online.onlinePrice:0,
      onlineStockFound:!!(online&&online.onlineStockFound),
      onlineStock:online?online.onlineStock:0,
      purchaseCostFound:!!(internal&&internal.purchaseCostFound),
      purchaseCost:internal?internal.purchaseCost:0,
      storePriceFound:!!(internal&&internal.storePriceFound),
      storePrice:internal?internal.storePrice:0,
      legacyStockFound:!!(internal&&internal.legacyStockFound),
      legacyStock:internal?internal.legacyStock:0,
      url:online?online.url:'',
      sourceCollection:online?online.sourceCollection:(internal?internal.sourceCollection:''),
      sourceKey:internal&&internal.sourceKey?internal.sourceKey:(online?onlineSourceKey(online):''),
      remark:internal?internal.remark:''
    };
  }

  function statusLabel(status){
    return {matched:'已配對', 'internal-only':'尚待 EasyStore 建檔', 'online-only':'EasyStore 單邊商品', duplicate:'編號重複'}[status]||status;
  }
  function costStatus(row){
    if(!row.internal || !row.purchaseCostFound) return 'missing';
    if(Number(row.purchaseCost)===0) return 'zero';
    return 'valid';
  }
  function catalogStats(){
    const internal=state.internalProducts.length;
    const matched=state.catalog.filter(function(r){return r.internal&&r.matchStatus==='matched';}).length;
    const internalOnly=state.catalog.filter(function(r){return r.internal&&r.matchStatus==='internal-only';}).length;
    const onlineOnly=state.catalog.filter(function(r){return !r.internal&&r.matchStatus==='online-only';}).length;
    const duplicate=state.catalog.filter(function(r){return r.matchStatus==='duplicate';}).length;
    const costIssue=state.internalProducts.filter(function(r){return !r.purchaseCostFound || Number(r.purchaseCost)===0;}).length;
    return {internal:internal,matched:matched,internalOnly:internalOnly,onlineOnly:onlineOnly,duplicate:duplicate,costIssue:costIssue};
  }
  function pendingAutoCreateRows(){
    const internalSourceKeys=new Set(state.internalProducts.map(function(row){return clean(row.sourceKey);}).filter(Boolean));
    const internalCodes=new Set(state.internalProducts.map(function(row){return normalizeCode(row.code);}).filter(Boolean));
    return state.onlineProducts.filter(function(row){
      const sourceKey=onlineSourceKey(row);
      const code=normalizeCode(row.code);
      if(sourceKey && internalSourceKeys.has(sourceKey)) return false;
      if(code && internalCodes.has(code)) return false;
      return true;
    });
  }
  function renderAutoCreateState(){
    const targets=pendingAutoCreateRows();
    const button=document.getElementById('masterAutoCreateBtn');
    const status=document.getElementById('masterAutoCreateStatus');
    const count=document.getElementById('masterAutoCreateCount');
    if(count) count.textContent=targets.length.toLocaleString('zh-TW');
    if(!button || !status) return;
    if(state.internalPermissionError){
      button.disabled=true;
      button.textContent='需先更新 Firestore 規則';
      status.className='master-import-status bad';
      status.textContent='目前無法讀寫 opsInternalProducts：'+state.internalPermissionError;
      return;
    }
    if(state.autoCreating){
      button.disabled=true;
      button.textContent='建立中...';
      return;
    }
    if(!state.onlineProducts.length){
      button.disabled=true;
      button.textContent='尚無網路商品';
      status.className='master-import-status';
      status.textContent='尚未讀到 websiteProducts／EasyStore 商品資料。';
      return;
    }
    if(!targets.length){
      button.disabled=true;
      button.textContent='商品主檔已建立完成';
      status.className='master-import-status ok';
      status.textContent='目前沒有需要新增的網路商品；已存在的內部主檔不會被覆蓋。';
      return;
    }
    button.disabled=false;
    button.textContent='一鍵建立 '+targets.length.toLocaleString('zh-TW')+' 筆商品主檔';
    status.className='master-import-status';
    status.textContent='只會新增尚未建立的商品；名稱與圖片來源會保留，SKU、成本、庫存先留空。';
  }

  function renderOverview(){
    const s=catalogStats();
    setText('masterKpiInternal',s.internal.toLocaleString('zh-TW'));
    setText('masterKpiMatched',s.matched.toLocaleString('zh-TW'));
    setText('masterKpiMatchedRate','配對率 '+pct(s.matched,s.internal));
    setText('masterKpiInternalOnly',s.internalOnly.toLocaleString('zh-TW'));
    setText('masterKpiOnlineOnly',s.onlineOnly.toLocaleString('zh-TW'));
    setText('masterKpiCostIssue',s.costIssue.toLocaleString('zh-TW'));
    setText('masterKpiDuplicate',s.duplicate.toLocaleString('zh-TW'));
    renderAutoCreateState();
  }

  function filteredCatalog(){
    const keyword=lower(document.getElementById('masterProductSearch')&&document.getElementById('masterProductSearch').value);
    const match=document.getElementById('masterMatchFilter')?document.getElementById('masterMatchFilter').value:'all';
    const cost=document.getElementById('masterCostFilter')?document.getElementById('masterCostFilter').value:'all';
    const sort=document.getElementById('masterSort')?document.getElementById('masterSort').value:'code';
    let rows=state.catalog.filter(function(row){
      if(keyword && !lower([row.code,row.internalName,row.onlineName,row.remark].join(' ')).includes(keyword)) return false;
      if(match!=='all' && row.matchStatus!==match) return false;
      if(cost!=='all' && costStatus(row)!==cost) return false;
      return true;
    });
    rows=rows.slice();
    rows.sort(function(a,b){
      if(sort==='internal') return clean(a.internalName||a.onlineName).localeCompare(clean(b.internalName||b.onlineName),'zh-Hant')||clean(a.code).localeCompare(clean(b.code),'zh-Hant',{numeric:true});
      if(sort==='online') return clean(a.onlineName||a.internalName).localeCompare(clean(b.onlineName||b.internalName),'zh-Hant')||clean(a.code).localeCompare(clean(b.code),'zh-Hant',{numeric:true});
      if(sort==='cost-desc') return Number(b.purchaseCost||-1)-Number(a.purchaseCost||-1);
      if(sort==='stock-desc') return Number(b.legacyStock||-999999)-Number(a.legacyStock||-999999);
      return clean(a.code).localeCompare(clean(b.code),'zh-Hant',{numeric:true});
    });
    return rows;
  }
  function editButton(row,label){
    const text=label||'編輯內部資料';
    if(!row || !row.internal) return '';
    return '<button class="ops-btn small" type="button" data-master-edit-doc="'+escapeHtml(row.internal.docId)+'">'+escapeHtml(text)+'</button>';
  }
  function productCard(row){
    const image=row.imageUrl?'<img loading="lazy" src="'+escapeHtml(row.imageUrl)+'" alt="'+escapeHtml(row.onlineName||row.internalName)+'">':'<div class="master-product-placeholder"><div><strong>尚無圖片</strong><br>EasyStore 完成建檔後會自動出現</div></div>';
    const internalName=row.internalName||'尚未建立內部商品';
    const onlineName=row.onlineName||'EasyStore 尚未建檔';
    const edit=row.internal?editButton(row,'編輯內部資料'):'<button class="ops-btn small primary" type="button" data-master-create-from-online="'+escapeHtml(row.id)+'">建立內部商品</button>';
    return '<article class="ops-card master-product-card">'+
      '<div class="master-product-media">'+image+'<span class="master-match-chip '+escapeHtml(row.matchStatus)+'">'+escapeHtml(statusLabel(row.matchStatus))+'</span></div>'+
      '<div class="master-product-body"><div class="master-code">商品編號：'+escapeHtml(row.code||'尚未設定')+'</div>'+
      '<div class="master-name-block internal"><span>內部商品名稱</span><strong>'+escapeHtml(internalName)+'</strong></div>'+
      '<div class="master-name-block online"><span>EasyStore 網路名稱</span><strong>'+escapeHtml(onlineName)+'</strong></div>'+
      '<div class="master-price-grid">'+
        '<div class="master-price-box"><span>商品成本</span><strong class="'+(row.purchaseCostFound&&row.purchaseCost>0?'':'missing')+'">'+escapeHtml(row.purchaseCostFound?compactMoney(row.purchaseCost):'未設定')+'</strong></div>'+
        '<div class="master-price-box"><span>門市售價</span><strong class="'+(row.storePriceFound?'':'missing')+'">'+escapeHtml(row.storePriceFound?compactMoney(row.storePrice):'未設定')+'</strong></div>'+
        '<div class="master-price-box"><span>網路售價</span><strong class="'+(row.onlinePriceFound?'':'missing')+'">'+escapeHtml(row.onlinePriceFound?compactMoney(row.onlinePrice):'未提供')+'</strong></div>'+
      '</div>'+
      '<div class="master-card-meta">舊庫存參考：'+escapeHtml(row.legacyStockFound?String(row.legacyStock):'未提供')+(row.onlineStockFound?'・EasyStore 庫存：'+escapeHtml(String(row.onlineStock)):'')+'</div>'+
      '<div class="master-card-actions"><button class="ops-btn small" type="button" data-master-detail="'+escapeHtml(row.id)+'">完整資料</button>'+edit+(row.url?'<a class="ops-btn small" href="'+escapeHtml(row.url)+'" target="_blank" rel="noopener noreferrer">網路商品</a>':'')+'</div></div></article>';
  }
  function renderProducts(){
    const rows=filteredCatalog();
    const visible=rows.slice(0,state.visibleCount);
    setText('masterProductResultMeta','符合 '+rows.length.toLocaleString('zh-TW')+' 筆／全部 '+state.catalog.length.toLocaleString('zh-TW')+' 筆');
    const grid=document.getElementById('masterProductGrid');
    if(grid) grid.innerHTML=visible.length?visible.map(productCard).join(''):'<div class="master-empty"><strong>沒有符合條件的商品</strong>請調整搜尋或篩選條件。</div>';
    const more=document.getElementById('masterProductLoadMore'); if(more) more.hidden=visible.length>=rows.length;
  }

  function filteredMatches(){
    const keyword=lower(document.getElementById('masterMatchSearch')&&document.getElementById('masterMatchSearch').value);
    const status=document.getElementById('masterMatchStatus')?document.getElementById('masterMatchStatus').value:'issues';
    return state.catalog.filter(function(row){
      if(keyword && !lower([row.code,row.internalName,row.onlineName].join(' ')).includes(keyword)) return false;
      if(status==='issues') return row.matchStatus!=='matched';
      if(status!=='all' && row.matchStatus!==status) return false;
      return true;
    });
  }
  function renderMatching(){
    const s=catalogStats();
    setText('matchKpiMatched',s.matched.toLocaleString('zh-TW'));
    setText('matchKpiInternalOnly',s.internalOnly.toLocaleString('zh-TW'));
    setText('matchKpiOnlineOnly',s.onlineOnly.toLocaleString('zh-TW'));
    setText('matchKpiDuplicate',s.duplicate.toLocaleString('zh-TW'));
    const rows=filteredMatches(); setText('masterMatchResultMeta','共 '+rows.length.toLocaleString('zh-TW')+' 筆');
    const body=document.getElementById('masterMatchBody'); if(!body) return;
    body.innerHTML=rows.length?rows.slice(0,500).map(function(row){
      const image=row.imageUrl?'<img class="thumb" src="'+escapeHtml(row.imageUrl)+'" alt="">':'—';
      const action=row.internal?editButton(row,'編輯'):'<button class="ops-btn small primary" type="button" data-master-create-from-online="'+escapeHtml(row.id)+'">建立內部商品</button>';
      return '<tr><td><strong>'+escapeHtml(row.code||'未提供')+'</strong></td><td>'+escapeHtml(row.internalName||'—')+'</td><td>'+escapeHtml(row.onlineName||'—')+(row.onlineMatches.length>1?'<div class="master-row-note">同編號 '+row.onlineMatches.length+' 筆</div>':'')+'</td><td>'+image+'</td><td><span class="master-row-state '+(row.matchStatus==='matched'?'ok':row.matchStatus==='duplicate'?'bad':row.matchStatus==='online-only'?'info':'warn')+'">'+escapeHtml(statusLabel(row.matchStatus))+'</span></td><td>'+action+'</td></tr>';
    }).join(''):'<tr><td colspan="6"><div class="ops-empty"><strong>沒有符合條件的配對資料</strong></div></td></tr>';
  }

  function importRowStatus(row){
    const notes=[];
    if(!row.code) notes.push('缺商品編號');
    if(!row.internalName) notes.push('缺內部名稱');
    if(!row.purchaseCostFound) notes.push('成本空白'); else if(row.purchaseCost===0) notes.push('成本為 0');
    if(row.legacyStockFound && row.legacyStock<0) notes.push('負庫存');
    if(row.duplicateInFile) notes.push('Excel 編號重複');
    if(row.existing) notes.push('主檔已存在');
    if(row.onlineMatches>1) notes.push('EasyStore 同編號重複');
    if(!notes.length) notes.push(row.onlineMatches===1?'可匯入並配對':'可匯入');
    return notes;
  }
  async function parseExcel(file){
    if(!global.XLSX) throw new Error('Excel 解析元件尚未載入，請重新整理後再試');
    const buffer=await file.arrayBuffer();
    const workbook=global.XLSX.read(buffer,{type:'array',cellDates:false});
    const sheet=workbook.Sheets[workbook.SheetNames[0]];
    if(!sheet) throw new Error('Excel 沒有可讀取的工作表');
    const rawRows=global.XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});
    if(!rawRows.length) throw new Error('Excel 沒有資料');
    const headers=Object.keys(rawRows[0]).map(lower);
    if(!headers.includes('code') || !headers.includes('name')) throw new Error('找不到必要欄位 code、name');
    const existingMap=new Map(state.internalProducts.map(function(r){return [normalizeCode(r.code),r];}));
    const onlineMap=new Map(); state.onlineProducts.forEach(function(r){const key=normalizeCode(r.code); if(!key)return; if(!onlineMap.has(key))onlineMap.set(key,[]); onlineMap.get(key).push(r);});
    const seen=new Map();
    const rows=rawRows.map(function(raw,index){
      const code=normalizeCode(raw.code);
      seen.set(code,(seen.get(code)||0)+1);
      const cost=numberInfo(raw.purchasePrice);
      const price=numberInfo(raw.salePrice);
      const stock=numberInfo(raw.withoutWarehouseStocks);
      const reward=numberInfo(raw.saleRewardPercent);
      return {
        rowNo:index+2,
        code:code,
        internalName:clean(raw.name),
        purchaseCostFound:cost.found,
        purchaseCost:cost.value,
        storePriceFound:price.found,
        storePrice:price.value,
        legacyStockFound:stock.found,
        legacyStock:stock.value,
        rewardPercentFound:reward.found,
        rewardPercent:reward.value,
        remark:clean(raw.remark),
        existing:existingMap.has(code),
        onlineMatches:(onlineMap.get(code)||[]).length,
        valid:!!code
      };
    });
    rows.forEach(function(row){row.duplicateInFile=!!row.code && seen.get(row.code)>1; row.notes=importRowStatus(row);});
    return rows;
  }
  function summarizeImport(rows){
    const valid=rows.filter(function(r){return r.valid;});
    return {
      raw:rows.length,
      valid:valid.length,
      newCount:valid.filter(function(r){return !r.existing;}).length,
      existing:valid.filter(function(r){return r.existing;}).length,
      matched:valid.filter(function(r){return r.onlineMatches===1;}).length,
      costIssue:valid.filter(function(r){return !r.purchaseCostFound || r.purchaseCost===0;}).length,
      dataIssue:valid.filter(function(r){return !r.internalName || (r.legacyStockFound&&r.legacyStock<0) || r.duplicateInFile;}).length,
      invalid:rows.filter(function(r){return !r.valid;}).length
    };
  }
  function renderImportPreview(){
    const rows=state.importRows; const s=state.importSummary;
    const kpis=document.getElementById('masterImportKpis'); const section=document.getElementById('masterImportPreviewSection');
    if(kpis) kpis.hidden=!s; if(section) section.hidden=!s;
    if(!s) return;
    setText('importKpiValid',s.valid.toLocaleString('zh-TW'));
    setText('importKpiNew',s.newCount.toLocaleString('zh-TW'));
    setText('importKpiExisting',s.existing.toLocaleString('zh-TW'));
    setText('importKpiMatched',s.matched.toLocaleString('zh-TW'));
    setText('importKpiCostIssue',s.costIssue.toLocaleString('zh-TW'));
    setText('importKpiDataIssue',s.dataIssue.toLocaleString('zh-TW'));
    setText('masterImportPreviewMeta','Excel '+s.raw.toLocaleString('zh-TW')+' 列，顯示前 200 筆注意資料／樣本');
    const sorted=rows.slice().sort(function(a,b){
      const ai=(a.notes.length===1&&a.notes[0].startsWith('可匯入'))?1:0;
      const bi=(b.notes.length===1&&b.notes[0].startsWith('可匯入'))?1:0;
      return ai-bi || a.rowNo-b.rowNo;
    }).slice(0,200);
    const body=document.getElementById('masterImportPreviewBody'); if(!body)return;
    body.innerHTML=sorted.map(function(row){
      const severity=row.notes.some(function(n){return /缺商品編號|重複/.test(n);})?'bad':row.notes.some(function(n){return /成本|負庫存|缺內部名稱|已存在/.test(n);})?'warn':'ok';
      return '<tr><td><strong>'+escapeHtml(row.code||'空白')+'</strong><div class="master-row-note">Excel 第 '+row.rowNo+' 列</div></td><td>'+escapeHtml(row.internalName||'—')+'</td><td>'+escapeHtml(row.purchaseCostFound?money(row.purchaseCost):'空白')+'</td><td>'+escapeHtml(row.storePriceFound?money(row.storePrice):'空白')+'</td><td>'+escapeHtml(row.legacyStockFound?String(row.legacyStock):'空白')+'</td><td>'+escapeHtml(row.onlineMatches===1?'可配對':row.onlineMatches>1?'同編號 '+row.onlineMatches+' 筆':'尚無')+'</td><td><span class="master-row-state '+severity+'">'+escapeHtml(row.notes.join('、'))+'</span></td></tr>';
    }).join('');
    updateImportButton();
  }
  function updateImportButton(){
    const button=document.getElementById('masterImportCommitBtn');
    const checked=!!(document.getElementById('masterImportConfirm')&&document.getElementById('masterImportConfirm').checked);
    if(button) button.disabled=!(state.importSummary&&state.importSummary.valid&&checked);
  }
  async function handleExcelFile(event){
    const file=event.target.files&&event.target.files[0]; if(!file)return;
    state.importFileName=file.name;
    setText('masterFileLabel',file.name);
    const status=document.getElementById('masterImportStatus');
    if(status){status.className='master-import-status';status.textContent='正在分析 Excel...';}
    try{
      state.importRows=await parseExcel(file);
      state.importSummary=summarizeImport(state.importRows);
      if(status){status.className='master-import-status ok';status.textContent='分析完成：有效商品 '+state.importSummary.valid.toLocaleString('zh-TW')+' 筆。尚未寫入 Firebase。';}
      renderImportPreview();
    }catch(err){
      state.importRows=[]; state.importSummary=null;
      if(status){status.className='master-import-status bad';status.textContent='無法讀取：'+(err.message||String(err));}
      renderImportPreview();
    }
  }
  async function commitImport(){
    const mode=document.getElementById('masterImportMode').value;
    const rows=state.importRows.filter(function(r){return r.valid && !r.duplicateInFile;});
    const targets=rows.filter(function(r){
      if(mode==='new-only') return !r.existing;
      return true;
    });
    if(!targets.length){ alert('沒有需要寫入的商品。'); return; }
    if(!global.confirm('即將寫入 '+targets.length.toLocaleString('zh-TW')+' 筆內部商品主檔。\n\n不會修改 EasyStore，也不會把舊庫存直接變成正式庫存。\n\n確定繼續嗎？')) return;
    const button=document.getElementById('masterImportCommitBtn'); const progress=document.getElementById('masterImportProgress');
    if(button){button.disabled=true;button.textContent='匯入中...';} if(progress)progress.hidden=false;
    const batchId='IMP-'+new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
    let completed=0;
    try{
      for(let start=0;start<targets.length;start+=BATCH_SIZE){
        const batch=state.db.batch(); const slice=targets.slice(start,start+BATCH_SIZE);
        slice.forEach(function(row){
          const ref=state.db.collection(INTERNAL_COLLECTION).doc(docIdForCode(row.code));
          const base={
            code:row.code,
            updatedAt:global.firebase.firestore.FieldValue.serverTimestamp(),
            updatedAtText:new Date().toISOString(),
            updatedBy:clean(state.user&& (state.user.id||state.user.employeeId||state.user.email||state.user.name)),
            source:'legacyExcel',
            sourceFileName:state.importFileName,
            importBatchId:batchId
          };
          if(mode==='cost-price-only'){
            base.purchaseCost=row.purchaseCostFound?row.purchaseCost:null;
            base.storePrice=row.storePriceFound?row.storePrice:null;
          }else{
            base.internalName=row.internalName;
            base.purchaseCost=row.purchaseCostFound?row.purchaseCost:null;
            base.storePrice=row.storePriceFound?row.storePrice:null;
            base.legacyStockReference=row.legacyStockFound?row.legacyStock:null;
            base.saleRewardPercent=row.rewardPercentFound?row.rewardPercent:null;
            base.remark=row.remark;
          }
          if(!row.existing) base.createdAt=global.firebase.firestore.FieldValue.serverTimestamp();
          batch.set(ref,base,{merge:true});
        });
        await batch.commit();
        completed+=slice.length;
        const percent=Math.round(completed/targets.length*100);
        const bar=document.getElementById('masterImportProgressBar'); if(bar)bar.style.width=percent+'%';
        setText('masterImportProgressText','已完成 '+completed.toLocaleString('zh-TW')+'／'+targets.length.toLocaleString('zh-TW')+' 筆（'+percent+'%）');
      }
      await state.db.collection(IMPORT_COLLECTION).doc(batchId).set({
        importBatchId:batchId,
        fileName:state.importFileName,
        mode:mode,
        totalRows:state.importRows.length,
        writtenRows:targets.length,
        createdAt:global.firebase.firestore.FieldValue.serverTimestamp(),
        createdAtText:new Date().toISOString(),
        createdBy:clean(state.user&& (state.user.id||state.user.employeeId||state.user.email||state.user.name))
      },{merge:true});
      const status=document.getElementById('masterImportStatus'); if(status){status.className='master-import-status ok';status.textContent='匯入完成：已寫入 '+targets.length.toLocaleString('zh-TW')+' 筆。正在重新讀取商品主檔...';}
      await reload();
      switchView('products');
      alert('匯入完成。內部商品主檔已建立。');
    }catch(err){
      const status=document.getElementById('masterImportStatus'); if(status){status.className='master-import-status bad';status.textContent='匯入失敗：'+(err.message||String(err))+'\n若顯示權限不足，請先更新 Firestore Rules。';}
      alert('匯入失敗：'+(err.message||String(err)));
    }finally{
      if(button){button.disabled=false;button.textContent='正式寫入 Firebase';}
      updateImportButton();
    }
  }

  async function autoCreateMasterProducts(){
    if(state.autoCreating) return;
    if(state.internalPermissionError){
      alert('目前 Firestore 規則尚未允許 opsInternalProducts。請先貼上 A-3 提供的完整規則並發布。');
      return;
    }
    const targets=pendingAutoCreateRows();
    if(!targets.length){ alert('目前沒有需要建立的商品主檔。'); return; }
    const message='即將把 '+targets.length.toLocaleString('zh-TW')+' 筆網路商品建立成內部商品主檔。\n\n'+
      '只新增尚未建立的商品，不會修改 websiteProducts、EasyStore、租賃、員工或其他資料。\n'+
      'SKU、成本與庫存會先留空，之後再逐步補齊。\n\n確定繼續嗎？';
    if(!global.confirm(message)) return;

    state.autoCreating=true;
    const button=document.getElementById('masterAutoCreateBtn');
    const status=document.getElementById('masterAutoCreateStatus');
    const progress=document.getElementById('masterAutoCreateProgress');
    const bar=document.getElementById('masterAutoCreateProgressBar');
    const text=document.getElementById('masterAutoCreateProgressText');
    if(progress) progress.hidden=false;
    if(button){button.disabled=true;button.textContent='建立中...';}
    if(status){status.className='master-import-status';status.textContent='正在建立商品主檔，請不要關閉頁面。';}
    let completed=0;
    const batchId='AUTO-'+new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);
    try{
      for(let start=0;start<targets.length;start+=BATCH_SIZE){
        const batch=state.db.batch();
        const slice=targets.slice(start,start+BATCH_SIZE);
        slice.forEach(function(row){
          const ref=state.db.collection(INTERNAL_COLLECTION).doc(docIdForOnline(row));
          const payload={
            internalName:row.onlineName||'未命名商品',
            source:'onlineAutoCreate',
            sourceKey:onlineSourceKey(row),
            sourceCollection:row.sourceCollection||state.onlineSource,
            sourceProductId:clean(row.id),
            sourceDocumentId:clean(row.docId),
            sourceImageUrl:row.imageUrl||'',
            sourceProductUrl:row.url||'',
            sourceOnlinePrice:row.onlinePriceFound?row.onlinePrice:null,
            code:row.code||'',
            autoCreated:true,
            masterStatus:'draft',
            createdAt:global.firebase.firestore.FieldValue.serverTimestamp(),
            createdAtText:new Date().toISOString(),
            createdBy:userLabel(),
            updatedAt:global.firebase.firestore.FieldValue.serverTimestamp(),
            updatedAtText:new Date().toISOString(),
            updatedBy:userLabel(),
            autoCreateBatchId:batchId
          };
          batch.set(ref,payload,{merge:true});
        });
        await batch.commit();
        completed+=slice.length;
        const percent=Math.round(completed/targets.length*100);
        if(bar) bar.style.width=percent+'%';
        if(text) text.textContent='已完成 '+completed.toLocaleString('zh-TW')+'／'+targets.length.toLocaleString('zh-TW')+' 筆（'+percent+'%）';
      }
      await state.db.collection(IMPORT_COLLECTION).doc(batchId).set({
        importBatchId:batchId,
        type:'onlineAutoCreate',
        sourceCollection:state.onlineSource,
        writtenRows:targets.length,
        createdAt:global.firebase.firestore.FieldValue.serverTimestamp(),
        createdAtText:new Date().toISOString(),
        createdBy:userLabel()
      },{merge:true});
      if(status){status.className='master-import-status ok';status.textContent='建立完成：已新增 '+targets.length.toLocaleString('zh-TW')+' 筆商品主檔。正在重新讀取...';}
      await reload();
      switchView('products');
      alert('商品主檔建立完成。接下來可以逐筆補上 SKU、成本與庫存參考。');
    }catch(err){
      if(status){status.className='master-import-status bad';status.textContent='建立失敗：'+(err.message||String(err));}
      alert('建立失敗：'+(err.message||String(err))+'\n\n若顯示 Missing or insufficient permissions，請先更新 Firestore 規則。');
    }finally{
      state.autoCreating=false;
      renderAutoCreateState();
    }
  }

  function openProductForm(row){
    state.editingDocId=row&&row.internal?row.internal.docId:'';
    state.editingCode=row&&row.internal?row.code:'';
    state.editingSourceKey=row?row.sourceKey:'';
    const isEditing=!!state.editingDocId;
    setText('masterProductModalTitle',isEditing?'編輯內部商品':'新增內部商品');
    document.getElementById('masterEditOriginalCode').value=state.editingCode;
    document.getElementById('masterFormCode').value=row?row.code:'';
    document.getElementById('masterFormCode').readOnly=!!(isEditing&&state.editingCode);
    document.getElementById('masterFormInternalName').value=row&&(row.internalName||row.onlineName)?(row.internalName||row.onlineName):'';
    document.getElementById('masterFormPurchaseCost').value=row&&row.purchaseCostFound?row.purchaseCost:'';
    document.getElementById('masterFormStorePrice').value=row&&row.storePriceFound?row.storePrice:'';
    document.getElementById('masterFormLegacyStock').value=row&&row.legacyStockFound?row.legacyStock:'';
    document.getElementById('masterFormRewardPercent').value=row&&row.internal&&row.internal.rewardPercentFound?row.internal.rewardPercent:'';
    document.getElementById('masterFormRemark').value=row&&row.remark?row.remark:'';
    const msg=document.getElementById('masterFormMessage'); if(msg){msg.className='master-form-message';msg.textContent='';}
    document.getElementById('masterProductModal').classList.add('is-open'); document.body.style.overflow='hidden';
  }
  function closeProductForm(){ document.getElementById('masterProductModal').classList.remove('is-open'); document.body.style.overflow=''; }
  async function saveProductForm(event){
    event.preventDefault();
    const code=normalizeCode(document.getElementById('masterFormCode').value);
    const internalName=clean(document.getElementById('masterFormInternalName').value);
    const cost=numberInfo(document.getElementById('masterFormPurchaseCost').value);
    const price=numberInfo(document.getElementById('masterFormStorePrice').value);
    const stock=numberInfo(document.getElementById('masterFormLegacyStock').value);
    const reward=numberInfo(document.getElementById('masterFormRewardPercent').value);
    const remark=clean(document.getElementById('masterFormRemark').value);
    const msg=document.getElementById('masterFormMessage'); const button=document.getElementById('masterProductSaveBtn');
    if(!code||!internalName){ if(msg){msg.className='master-form-message bad';msg.textContent='請輸入商品編號與內部商品名稱。';} return; }
    const duplicate=state.internalProducts.some(function(r){return normalizeCode(r.code)===code && clean(r.docId)!==clean(state.editingDocId);});
    if(duplicate){ if(msg){msg.className='master-form-message bad';msg.textContent='此商品編號已存在於其他商品，請使用不同編號。';} return; }
    if(button){button.disabled=true;button.textContent='儲存中...';}
    try{
      const isEditing=!!state.editingDocId;
      const payload={
        code:code,
        internalName:internalName,
        purchaseCost:cost.found?cost.value:null,
        storePrice:price.found?price.value:null,
        legacyStockReference:stock.found?stock.value:null,
        saleRewardPercent:reward.found?reward.value:null,
        remark:remark,
        source:isEditing?'manualEdit':'manualCreate',
        updatedAt:global.firebase.firestore.FieldValue.serverTimestamp(),
        updatedAtText:new Date().toISOString(),
        updatedBy:userLabel()
      };
      if(state.editingSourceKey) payload.sourceKey=state.editingSourceKey;
      if(!isEditing) payload.createdAt=global.firebase.firestore.FieldValue.serverTimestamp();
      let targetDocId=state.editingDocId;
      if(!targetDocId){
        const sourceRow=state.catalog.find(function(r){return r.sourceKey===state.editingSourceKey && r.online;});
        targetDocId=sourceRow?docIdForOnline(sourceRow.online):docIdForCode(code);
      }
      await state.db.collection(INTERNAL_COLLECTION).doc(targetDocId).set(payload,{merge:true});
      if(msg){msg.className='master-form-message ok';msg.textContent='儲存完成。';}
      await reload(); closeProductForm(); switchView('products');
    }catch(err){
      if(msg){msg.className='master-form-message bad';msg.textContent='儲存失敗：'+(err.message||String(err))+'。若顯示權限不足，請先更新 Firestore Rules。';}
    }finally{ if(button){button.disabled=false;button.textContent='儲存內部商品';} }
  }

  function rowById(id){ return state.catalog.find(function(r){return r.id===id;}); }
  function rowByCode(code){ return state.catalog.find(function(r){return r.internal&&normalizeCode(r.code)===normalizeCode(code);}); }
  function rowByInternalDocId(docId){ return state.catalog.find(function(r){return r.internal&&clean(r.internal.docId)===clean(docId);}); }
  function openCreateFromOnline(id){
    const row=rowById(id); if(!row)return;
    openProductForm(row);
    document.getElementById('masterFormInternalName').value=row.onlineName||'';
  }
  function detailRow(label,value){ return '<div class="master-detail-row"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value)+'</strong></div>'; }
  function openDetail(id){
    const row=rowById(id); if(!row)return;
    const image=row.imageUrl?'<img src="'+escapeHtml(row.imageUrl)+'" alt="">':'<div class="master-product-placeholder"><strong>尚無圖片</strong></div>';
    const internal='<div class="master-detail-group internal"><h3>內部主檔</h3>'+detailRow('商品編號',row.code||'尚未設定')+detailRow('內部商品名稱',row.internalName||'尚未建立')+detailRow('商品成本',row.purchaseCostFound?money(row.purchaseCost):'未設定')+detailRow('門市／實體售價',row.storePriceFound?money(row.storePrice):'未設定')+detailRow('舊庫存參考',row.legacyStockFound?String(row.legacyStock):'未提供')+detailRow('備註',row.remark||'—')+'</div>';
    const online='<div class="master-detail-group online"><h3>EasyStore 網路資料</h3>'+detailRow('網路商品名稱',row.onlineName||'尚未建檔')+detailRow('網路售價',row.onlinePriceFound?money(row.onlinePrice):'未提供')+detailRow('EasyStore 庫存',row.onlineStockFound?String(row.onlineStock):'未提供')+detailRow('資料來源',row.sourceCollection||'—')+detailRow('配對狀態',statusLabel(row.matchStatus))+'</div>';
    const edit=row.internal?'<button class="ops-btn primary" type="button" data-detail-edit-doc="'+escapeHtml(row.internal.docId)+'">編輯內部資料</button>':'<button class="ops-btn primary" type="button" data-detail-create="'+escapeHtml(row.id)+'">建立內部商品</button>';
    document.getElementById('masterDetailModalBody').innerHTML='<div class="master-detail-layout"><div><div class="master-detail-image">'+image+'</div><div class="master-detail-actions">'+edit+(row.url?'<a class="ops-btn" href="'+escapeHtml(row.url)+'" target="_blank" rel="noopener noreferrer">開啟網路商品</a>':'')+'</div></div><div class="master-detail-columns">'+internal+online+'</div></div>';
    document.getElementById('masterDetailModal').classList.add('is-open'); document.body.style.overflow='hidden';
  }
  function closeDetail(){ document.getElementById('masterDetailModal').classList.remove('is-open'); document.body.style.overflow=''; }

  function renderAll(){ renderOverview(); renderProducts(); renderMatching(); setText('masterLastLoadedText',state.loadedAt?('最後讀取：'+dateTimeText(state.loadedAt)+'｜網路來源：'+(state.onlineSource||'未找到')):'等待 Firebase'); }
  function renderLoading(){
    ['masterKpiInternal','masterKpiMatched','masterKpiInternalOnly','masterKpiOnlineOnly','masterKpiCostIssue','masterKpiDuplicate','matchKpiMatched','matchKpiInternalOnly','matchKpiOnlineOnly','matchKpiDuplicate'].forEach(function(id){setText(id,'…');});
    setText('masterLastLoadedText','正在讀取 Firebase...');
    const grid=document.getElementById('masterProductGrid'); if(grid)grid.innerHTML='<div class="master-empty"><strong>正在讀取商品資料</strong>請稍候...</div>';
  }
  async function reload(){
    if(state.loading)return; state.loading=true; renderLoading();
    const button=document.getElementById('masterReloadBtn'); if(button){button.disabled=true;button.textContent='讀取中...';}
    try{
      if(!state.db) state.db=initDb();
      state.diagnostics=[];
      await Promise.all([loadOnlineProducts(),loadInternalProducts()]);
      buildCatalog(); state.loadedAt=new Date(); state.visibleCount=PAGE_SIZE; renderAll();
    }catch(err){
      state.loadedAt=new Date(); renderAll();
      const grid=document.getElementById('masterProductGrid'); if(grid&& !state.catalog.length) grid.innerHTML='<div class="master-empty"><strong>資料讀取失敗</strong>'+escapeHtml(err.message||String(err))+'</div>';
    }finally{ state.loading=false; if(button){button.disabled=false;button.textContent='↻ 重新讀取';} }
  }

  function switchView(view,updateHash){
    if(!pageMeta[view])view='overview'; state.view=view;
    document.querySelectorAll('[data-master-view-panel]').forEach(function(panel){panel.classList.toggle('is-active',panel.getAttribute('data-master-view-panel')===view);});
    document.querySelectorAll('[data-master-view]').forEach(function(button){button.classList.toggle('is-active',button.getAttribute('data-master-view')===view);});
    setText('masterPageTitle',pageMeta[view][0]); setText('masterPageSubtitle',pageMeta[view][1]);
    if(updateHash!==false && global.location.hash!=='#'+view){try{history.replaceState(null,'','#'+view);}catch(err){global.location.hash=view;}}
    global.scrollTo({top:0,behavior:'smooth'});
  }
  function clearFilters(){
    document.getElementById('masterProductSearch').value=''; document.getElementById('masterMatchFilter').value='all'; document.getElementById('masterCostFilter').value='all'; document.getElementById('masterSort').value='code'; state.visibleCount=PAGE_SIZE; renderProducts();
  }
  function applyMatchFilter(status){ document.getElementById('masterMatchStatus').value=status; switchView('matching'); renderMatching(); }

  function bindEvents(){
    document.querySelectorAll('[data-master-view]').forEach(function(el){el.addEventListener('click',function(){switchView(el.getAttribute('data-master-view'));});});
    document.querySelectorAll('[data-master-view-link]').forEach(function(el){el.addEventListener('click',function(){switchView(el.getAttribute('data-master-view-link'));});});
    ['masterAddProductBtn','masterAddProductBtn2','overviewAddProductBtn'].forEach(function(id){const el=document.getElementById(id);if(el)el.addEventListener('click',function(){openProductForm(null);});});
    const reloadBtn=document.getElementById('masterReloadBtn'); if(reloadBtn)reloadBtn.addEventListener('click',reload);
    const autoCreateBtn=document.getElementById('masterAutoCreateBtn'); if(autoCreateBtn)autoCreateBtn.addEventListener('click',autoCreateMasterProducts);
    ['masterProductSearch','masterMatchFilter','masterCostFilter','masterSort'].forEach(function(id){const el=document.getElementById(id);if(el)el.addEventListener(id==='masterProductSearch'?'input':'change',function(){state.visibleCount=PAGE_SIZE;renderProducts();});});
    document.getElementById('masterClearFilters').addEventListener('click',clearFilters);
    document.getElementById('masterProductLoadMore').addEventListener('click',function(){state.visibleCount+=PAGE_SIZE;renderProducts();});
    ['masterMatchSearch','masterMatchStatus'].forEach(function(id){const el=document.getElementById(id);if(el)el.addEventListener(id==='masterMatchSearch'?'input':'change',renderMatching);});
    document.querySelectorAll('[data-match-filter]').forEach(function(el){el.addEventListener('click',function(){applyMatchFilter(el.getAttribute('data-match-filter'));});});
    document.getElementById('masterExcelFile').addEventListener('change',handleExcelFile);
    document.getElementById('masterImportConfirm').addEventListener('change',updateImportButton);
    document.getElementById('masterImportCommitBtn').addEventListener('click',commitImport);
    document.getElementById('masterProductForm').addEventListener('submit',saveProductForm);
    document.getElementById('masterProductModalClose').addEventListener('click',closeProductForm);
    document.getElementById('masterProductCancelBtn').addEventListener('click',closeProductForm);
    document.getElementById('masterDetailModalClose').addEventListener('click',closeDetail);
    document.getElementById('masterProductModal').addEventListener('click',function(e){if(e.target===e.currentTarget)closeProductForm();});
    document.getElementById('masterDetailModal').addEventListener('click',function(e){if(e.target===e.currentTarget)closeDetail();});
    document.addEventListener('click',function(event){
      const detail=event.target.closest('[data-master-detail]'); if(detail){openDetail(detail.getAttribute('data-master-detail'));return;}
      const editDoc=event.target.closest('[data-master-edit-doc]'); if(editDoc){const row=rowByInternalDocId(editDoc.getAttribute('data-master-edit-doc'));if(row)openProductForm(row);return;}
      const create=event.target.closest('[data-master-create-from-online]'); if(create){openCreateFromOnline(create.getAttribute('data-master-create-from-online'));return;}
      const detailEditDoc=event.target.closest('[data-detail-edit-doc]'); if(detailEditDoc){closeDetail();const row=rowByInternalDocId(detailEditDoc.getAttribute('data-detail-edit-doc'));if(row)openProductForm(row);return;}
      const detailCreate=event.target.closest('[data-detail-create]'); if(detailCreate){closeDetail();openCreateFromOnline(detailCreate.getAttribute('data-detail-create'));}
    });
    document.addEventListener('keydown',function(event){if(event.key==='Escape'){closeProductForm();closeDetail();}});
    global.addEventListener('hashchange',function(){switchView(clean(global.location.hash).replace(/^#/,'')||'overview',false);});
  }

  async function init(){
    if(typeof global.fillHeader==='function')global.fillHeader();
    const user=typeof global.requireLogin==='function'?global.requireLogin():null; if(!user)return;
    if(typeof global.hasSettingsZoneAccess==='function' && !global.hasSettingsZoneAccess(user)){global.location.href='dashboard.html';return;}
    if(typeof global.setPortalMode==='function')global.setPortalMode('settings');
    state.user=user;
    const name=clean(user.name||user.employeeName||user.email||'管理員'); setText('masterUserName',name); setText('masterUserInitial',name.slice(0,1)||'管');
    bindEvents(); switchView(clean(global.location.hash).replace(/^#/,'')||'overview',false); await reload();
  }

  global.OperationsProductMaster={init:init,reload:reload};
})(window);
