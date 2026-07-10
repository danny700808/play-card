(function(global){
  'use strict';

  const PRODUCT_COLLECTIONS = [
    'easystoreProducts',
    'websiteProducts',
    'officialWebsiteProducts',
    'websiteGoods',
    'products'
  ];
  const PRODUCT_MAX_DOCS = 800;
  const RENTAL_MAX_DOCS = 500;
  const PRODUCT_PAGE_SIZE = 24;
  const READ_TIMEOUT_MS = 15000;

  const state = {
    user: null,
    db: null,
    view: 'overview',
    products: [],
    rentals: [],
    productSource: '',
    productVisibleCount: PRODUCT_PAGE_SIZE,
    diagnostics: [],
    loadedAt: null,
    loading: false,
    activeProductFilter: ''
  };

  const pageMeta = {
    overview: ['營運總覽', '把既有商品、圖片、庫存欄位與租賃資料整理成每天可閱讀的營運畫面。'],
    products: ['商品與庫存', '唯讀檢視商品圖片、SKU、庫存、成本欄位與商品毛利試算。'],
    rentals: ['租賃概況', '直接讀取原租賃合約，整理到期與登錄金額，不在此頁修改合約。'],
    connection: ['資料連線狀態', '查看 Firebase 專案、集合來源、讀取筆數、耗時與錯誤訊息。']
  };

  function clean(value){ return String(value == null ? '' : value).trim(); }
  function lower(value){ return clean(value).toLowerCase(); }
  function escapeHtml(value){
    return clean(value).replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  function safeUrl(value){
    const raw = clean(value);
    if(!raw) return '';
    try{
      const url = new URL(raw, global.location.href);
      if(url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    }catch(err){}
    return '';
  }
  function decodeReadable(value){
    let text = clean(value);
    if(!text) return '';
    for(let i=0;i<2;i++){
      try{
        const decoded = decodeURIComponent(text.replace(/\+/g, '%20'));
        if(decoded === text) break;
        text = decoded;
      }catch(err){ break; }
    }
    return text.replace(/[\u0000-\u001f]/g, '').trim();
  }
  function looksLikeUrlOrEncoded(value){
    const text = clean(value);
    return /^https?:\/\//i.test(text) || /%[0-9a-f]{2}/i.test(text) || text.length > 120;
  }
  function firstValue(obj, keys){
    for(const key of keys){
      const value = getPath(obj, key);
      if(value !== undefined && value !== null && clean(value) !== '') return value;
    }
    return '';
  }
  function getPath(obj, path){
    if(!obj || !path) return undefined;
    if(Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];
    const parts = String(path).split('.');
    let cursor = obj;
    for(const part of parts){
      if(cursor == null || !Object.prototype.hasOwnProperty.call(cursor, part)) return undefined;
      cursor = cursor[part];
    }
    return cursor;
  }
  function firstNumber(obj, keys){
    for(const key of keys){
      const raw = getPath(obj, key);
      if(raw === undefined || raw === null || clean(raw) === '') continue;
      const number = Number(String(raw).replace(/[^0-9.\-]/g, ''));
      if(Number.isFinite(number)) return {found:true, value:number, key:key};
    }
    return {found:false, value:0, key:''};
  }
  function firstBoolean(obj, keys){
    for(const key of keys){
      const raw = getPath(obj, key);
      if(raw === undefined || raw === null || clean(raw) === '') continue;
      if(typeof raw === 'boolean') return {found:true,value:raw,key:key};
      const text = lower(raw);
      if(['true','1','yes','y','是','上架','啟用','enabled','active'].includes(text)) return {found:true,value:true,key:key};
      if(['false','0','no','n','否','下架','停用','disabled','inactive'].includes(text)) return {found:true,value:false,key:key};
    }
    return {found:false,value:false,key:''};
  }
  function money(value){
    const number = Number(value);
    if(!Number.isFinite(number)) return '—';
    return 'NT$ ' + Math.round(number).toLocaleString('zh-TW');
  }
  function compactMoney(value){
    const number = Number(value);
    if(!Number.isFinite(number)) return '—';
    return '$' + Math.round(number).toLocaleString('zh-TW');
  }
  function percentage(part, total){
    if(!total) return '0%';
    return (Math.round((part / total) * 1000) / 10).toFixed(1).replace('.0','') + '%';
  }
  function percentValue(value){
    if(!Number.isFinite(Number(value))) return '—';
    return (Math.round(Number(value) * 10) / 10).toFixed(1).replace('.0','') + '%';
  }
  function dateFrom(value){
    if(!value) return null;
    try{
      if(value && typeof value.toDate === 'function'){
        const d = value.toDate();
        return Number.isNaN(d.getTime()) ? null : d;
      }
      if(value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
      if(typeof value === 'object' && Number.isFinite(Number(value.seconds))){
        const d = new Date(Number(value.seconds) * 1000);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      const raw = clean(value);
      if(!raw) return null;
      const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw + 'T00:00:00') : new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d;
    }catch(err){ return null; }
  }
  function dateText(value){
    const d = dateFrom(value);
    if(!d) return clean(value) || '—';
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return y + '-' + m + '-' + day;
  }
  function dateTimeText(value){
    const d = dateFrom(value);
    if(!d) return clean(value) || '—';
    const date = dateText(d);
    const h = String(d.getHours()).padStart(2,'0');
    const m = String(d.getMinutes()).padStart(2,'0');
    return date + ' ' + h + ':' + m;
  }
  function daysUntil(value){
    const d = dateFrom(value);
    if(!d) return null;
    const today = new Date();
    today.setHours(0,0,0,0);
    d.setHours(0,0,0,0);
    return Math.ceil((d.getTime() - today.getTime()) / 86400000);
  }
  function extractImage(value){
    if(!value) return '';
    if(typeof value === 'string') return safeUrl(value);
    if(Array.isArray(value)){
      for(const item of value){
        const found = extractImage(item);
        if(found) return found;
      }
      return '';
    }
    if(typeof value === 'object'){
      return safeUrl(firstValue(value, ['src','url','imageUrl','original','large','medium','small','secure_url','downloadURL']));
    }
    return '';
  }
  function imageFromProduct(obj){
    const direct = [
      obj.imageUrl, obj.image, obj.picture, obj.cover, obj.featuredImage,
      obj.featured_image, obj.mainImage, obj.thumbnail, obj.photo, obj['圖片']
    ];
    for(const candidate of direct){
      const found = extractImage(candidate);
      if(found) return found;
    }
    return extractImage(obj.images || obj.photos || obj.media || []);
  }
  function sourceId(obj){
    return clean(firstValue(obj, ['productId','websiteProductId','itemId','__id','id','sku','SKU','handle']));
  }
  function productName(obj){
    return decodeReadable(firstValue(obj, ['name','title','itemName','productName','商品名稱'])) || '未命名商品';
  }
  function displayProductId(obj, fallbackId, sku){
    let value = clean(firstValue(obj, ['productCode','itemCode','internalCode','productId','websiteProductId','itemId','__id','id','商品編號']));
    value = decodeReadable(value);
    if(!value || looksLikeUrlOrEncoded(value)) value = clean(sku) || clean(fallbackId);
    if(value.length > 80) value = value.slice(0,77) + '…';
    return value || '未提供';
  }
  function normalizeProductBase(obj, collection){
    const price = firstNumber(obj, ['price','marketPrice','salePrice','websiteOriginalPrice','regularPrice','variantPrice','官網價格','價格']);
    const stock = firstNumber(obj, ['onHand','onHandQuantity','currentStock','physicalStock','inventoryQuantity','stockQuantity','quantity','stock','inventory','庫存','庫存數量']);
    const available = firstNumber(obj, ['availableQuantity','availableStock','availableToSell','sellableQuantity','sellableStock','可售庫存','可販售庫存']);
    const reserved = firstNumber(obj, ['reservedQuantity','reservedStock','allocatedQuantity','committedQuantity','保留庫存','已保留']);
    const safety = firstNumber(obj, ['safetyStock','minimumStock','minStock','lowStockThreshold','安全庫存','最低庫存']);
    const averageCost = firstNumber(obj, ['averageCost','avgCost','movingAverageCost','inventoryAverageCost','平均成本','移動平均成本']);
    const latestCost = firstNumber(obj, ['latestPurchaseCost','lastPurchaseCost','purchasePrice','costPrice','unitCost','cost','進貨成本','最近進貨成本']);
    const enabled = firstBoolean(obj, ['enabled','active','published','isPublished','是否上架','上架']);
    const imageUrl = imageFromProduct(obj);
    const id = sourceId(obj) || collection + '-' + Math.random().toString(36).slice(2,9);
    const sku = clean(firstValue(obj, ['sku','SKU','productCode','itemCode','商品編號']));
    const preferredCostFound = averageCost.found || latestCost.found;
    const preferredCost = averageCost.found ? averageCost.value : latestCost.value;
    const grossProfitFound = price.found && preferredCostFound;
    const grossProfit = grossProfitFound ? price.value - preferredCost : 0;
    const grossMargin = grossProfitFound && price.value > 0 ? grossProfit / price.value * 100 : 0;
    const inventoryValueFound = stock.found && preferredCostFound;
    return {
      id: id,
      sourceProductId: id,
      displayProductId: displayProductId(obj, id, sku),
      name: productName(obj),
      brand: decodeReadable(firstValue(obj, ['brand','vendor','manufacturer','品牌'])),
      category: decodeReadable(firstValue(obj, ['category','productType','type','分類'])),
      sku: sku,
      barcode: clean(firstValue(obj, ['barcode','ean','upc','gtin','條碼'])),
      variantName: decodeReadable(firstValue(obj, ['variantSummary','optionsText','variantName','specification','規格'])),
      url: safeUrl(firstValue(obj, ['url','productUrl','websiteProductUrl','permalink','link','連結'])),
      imageUrl: imageUrl,
      priceFound: price.found,
      price: price.value,
      stockFound: stock.found,
      stock: stock.value,
      availableFound: available.found,
      available: available.value,
      reservedFound: reserved.found,
      reserved: reserved.value,
      safetyFound: safety.found,
      safety: safety.value,
      stockStatus: decodeReadable(firstValue(obj, ['stockStatus','inventoryStatus','availability','庫存狀態'])) || (stock.found ? (stock.value > 0 ? '有庫存' : '缺貨') : '庫存未提供'),
      averageCostFound: averageCost.found,
      averageCost: averageCost.value,
      latestCostFound: latestCost.found,
      latestCost: latestCost.value,
      costFound: preferredCostFound,
      preferredCost: preferredCost,
      grossProfitFound: grossProfitFound,
      grossProfit: grossProfit,
      grossMargin: grossMargin,
      inventoryValueFound: inventoryValueFound,
      inventoryValue: inventoryValueFound ? stock.value * preferredCost : 0,
      enabledFound: enabled.found,
      enabled: enabled.value,
      sourceCollection: collection,
      updatedAt: firstValue(obj, ['updatedAt','updatedAtText','modifiedAt','lastSyncedAt','syncAt']),
      raw: obj
    };
  }
  function normalizeProductsFromDoc(obj, collection){
    const base = normalizeProductBase(obj, collection);
    const variants = Array.isArray(obj.variants) ? obj.variants : (Array.isArray(obj.options) ? obj.options : []);
    if(!variants.length) return [base];
    const rows = [];
    for(let index=0; index<variants.length; index++){
      const variant = variants[index] || {};
      const combined = Object.assign({}, obj, variant);
      const row = normalizeProductBase(combined, collection);
      const variantId = clean(firstValue(variant, ['id','variantId','sku','name','title'])) || String(index+1);
      row.id = base.sourceProductId + '::' + variantId;
      row.sourceProductId = base.sourceProductId;
      row.displayProductId = displayProductId(variant, base.displayProductId, row.sku || base.sku);
      row.name = base.name;
      row.brand = row.brand || base.brand;
      row.category = row.category || base.category;
      row.sku = row.sku || base.sku;
      row.barcode = row.barcode || base.barcode;
      row.variantName = decodeReadable(firstValue(variant, ['name','title','optionName','variantName','sku'])) || base.variantName;
      row.url = row.url || base.url;
      row.imageUrl = imageFromProduct(variant) || base.imageUrl;
      if(!row.priceFound && base.priceFound){ row.priceFound = true; row.price = base.price; }
      if(!row.stockFound && base.stockFound){ row.stockFound = true; row.stock = base.stock; row.stockStatus = base.stockStatus; }
      if(!row.availableFound && base.availableFound){ row.availableFound = true; row.available = base.available; }
      if(!row.reservedFound && base.reservedFound){ row.reservedFound = true; row.reserved = base.reserved; }
      if(!row.safetyFound && base.safetyFound){ row.safetyFound = true; row.safety = base.safety; }
      if(!row.averageCostFound && base.averageCostFound){ row.averageCostFound = true; row.averageCost = base.averageCost; }
      if(!row.latestCostFound && base.latestCostFound){ row.latestCostFound = true; row.latestCost = base.latestCost; }
      row.costFound = row.averageCostFound || row.latestCostFound;
      row.preferredCost = row.averageCostFound ? row.averageCost : row.latestCost;
      row.grossProfitFound = row.priceFound && row.costFound;
      row.grossProfit = row.grossProfitFound ? row.price - row.preferredCost : 0;
      row.grossMargin = row.grossProfitFound && row.price > 0 ? row.grossProfit / row.price * 100 : 0;
      row.inventoryValueFound = row.stockFound && row.costFound;
      row.inventoryValue = row.inventoryValueFound ? row.stock * row.preferredCost : 0;
      rows.push(row);
    }
    return rows;
  }
  function dedupeProducts(rows){
    const map = new Map();
    for(const row of rows){
      const key = row.sku ? ('sku:' + lower(row.sku)) : ('id:' + lower(row.id));
      if(!map.has(key)) map.set(key, row);
      else{
        const existing = map.get(key);
        const merged = Object.assign({}, existing, {
          imageUrl: existing.imageUrl || row.imageUrl,
          url: existing.url || row.url,
          barcode: existing.barcode || row.barcode,
          priceFound: existing.priceFound || row.priceFound,
          price: existing.priceFound ? existing.price : row.price,
          stockFound: existing.stockFound || row.stockFound,
          stock: existing.stockFound ? existing.stock : row.stock,
          availableFound: existing.availableFound || row.availableFound,
          available: existing.availableFound ? existing.available : row.available,
          reservedFound: existing.reservedFound || row.reservedFound,
          reserved: existing.reservedFound ? existing.reserved : row.reserved,
          safetyFound: existing.safetyFound || row.safetyFound,
          safety: existing.safetyFound ? existing.safety : row.safety,
          stockStatus: existing.stockStatus !== '庫存未提供' ? existing.stockStatus : row.stockStatus,
          averageCostFound: existing.averageCostFound || row.averageCostFound,
          averageCost: existing.averageCostFound ? existing.averageCost : row.averageCost,
          latestCostFound: existing.latestCostFound || row.latestCostFound,
          latestCost: existing.latestCostFound ? existing.latestCost : row.latestCost,
          costFound: existing.costFound || row.costFound,
          updatedAt: existing.updatedAt || row.updatedAt
        });
        merged.preferredCost = merged.averageCostFound ? merged.averageCost : merged.latestCost;
        merged.grossProfitFound = merged.priceFound && merged.costFound;
        merged.grossProfit = merged.grossProfitFound ? merged.price - merged.preferredCost : 0;
        merged.grossMargin = merged.grossProfitFound && merged.price > 0 ? merged.grossProfit / merged.price * 100 : 0;
        merged.inventoryValueFound = merged.stockFound && merged.costFound;
        merged.inventoryValue = merged.inventoryValueFound ? merged.stock * merged.preferredCost : 0;
        map.set(key, merged);
      }
    }
    return Array.from(map.values()).sort(function(a,b){
      return a.name.localeCompare(b.name, 'zh-Hant') || a.sku.localeCompare(b.sku, 'zh-Hant');
    });
  }

  function rentalTypeLabel(value){
    const raw = clean(value);
    if(raw === 'digitalPiano') return '電鋼琴';
    if(raw === 'electronicDrum') return '電子鼓';
    if(raw === 'other') return '其他設備';
    return raw || '租賃設備';
  }
  function normalizeRental(obj){
    const rentFee = firstNumber(obj, ['rentFee','rentalFee','monthlyRent','totalRent','租金']);
    const shippingFee = firstNumber(obj, ['shippingFee','deliveryFee','transportFee','運費']);
    const depositFee = firstNumber(obj, ['depositFee','deposit','securityDeposit','押金']);
    const receivedAmount = firstNumber(obj, ['receivedAmount','paidAmount','totalReceived','actualReceived','已收款','實收金額']);
    const deliveryCost = firstNumber(obj, ['deliveryCost','shippingCost','transportCost','搬運成本','運送成本']);
    const maintenanceCost = firstNumber(obj, ['maintenanceCost','repairCost','serviceCost','維修成本']);
    const outstandingAmount = firstNumber(obj, ['outstandingAmount','unpaidAmount','balanceDue','未收款','應收餘額']);
    const status = decodeReadable(firstValue(obj, ['status','contractStatus','租賃狀態'])) || '未設定';
    const type = rentalTypeLabel(firstValue(obj, ['rentalType','type','equipmentType','設備類型']));
    const brand = decodeReadable(firstValue(obj, ['equipmentBrand','brand','deviceBrand','品牌']));
    const model = decodeReadable(firstValue(obj, ['equipmentModel','model','modelName','deviceModel','型號']));
    const equipmentName = decodeReadable(firstValue(obj, ['equipmentName','itemName','rentalItemName','deviceName','設備名稱'])) || [brand, model].filter(Boolean).join(' ') || type;
    const startDate = firstValue(obj, ['startDate','officialStartDate','rentalStartDate','deliveryDate','起租日']);
    const endDate = firstValue(obj, ['currentEndDate','endDate','officialEndDate','rentalEndDate','到期日']);
    const contractId = clean(firstValue(obj, ['contractId','__id','id']));
    const registeredIncome = (rentFee.found ? rentFee.value : 0) + (shippingFee.found ? shippingFee.value : 0);
    let outstandingFound = outstandingAmount.found;
    let outstanding = outstandingAmount.value;
    if(!outstandingFound && receivedAmount.found && (rentFee.found || shippingFee.found)){
      outstandingFound = true;
      outstanding = Math.max(0, registeredIncome - receivedAmount.value);
    }
    return {
      id: contractId,
      contractNo: decodeReadable(firstValue(obj, ['contractNo','contractNumber','agreementNo','合約編號'])) || contractId || '未編號',
      customerName: decodeReadable(firstValue(obj, ['customerName','partyAName','applicantName','name','客戶姓名'])) || '未填客戶',
      equipmentName: equipmentName,
      equipmentType: type,
      brand: brand,
      model: model,
      serialNo: decodeReadable(firstValue(obj, ['serialNo','machineCode','equipmentNo','assetNo','設備編號'])),
      startDate: startDate,
      endDate: endDate,
      nextPaymentDate: firstValue(obj, ['nextPaymentDate','nextDueDate','下次收款日']),
      status: status,
      rentFeeFound: rentFee.found,
      rentFee: rentFee.value,
      shippingFeeFound: shippingFee.found,
      shippingFee: shippingFee.value,
      depositFeeFound: depositFee.found,
      depositFee: depositFee.value,
      registeredIncomeFound: rentFee.found || shippingFee.found,
      registeredIncome: registeredIncome,
      receivedAmountFound: receivedAmount.found,
      receivedAmount: receivedAmount.value,
      outstandingAmountFound: outstandingFound,
      outstandingAmount: outstanding,
      deliveryCostFound: deliveryCost.found,
      deliveryCost: deliveryCost.value,
      maintenanceCostFound: maintenanceCost.found,
      maintenanceCost: maintenanceCost.value,
      updatedAt: firstValue(obj, ['updatedAt','updatedAtText','officialConfirmedAt','createdAt','createdAtText']),
      raw: obj
    };
  }
  function rentalIsClosed(row){ return /已退租|已取消|取消|終止|作廢|已結案|已歸還|結束/.test(row.status); }
  function rentalIsDraft(row){ return /草稿|新申請|待簽|待確認|待建檔/.test(row.status); }
  function rentalIsActive(row){
    if(rentalIsClosed(row) || rentalIsDraft(row)) return false;
    return /租賃中|有效|已成立|待歸還|續約|已確認|已簽署|配送中|安裝完成/.test(row.status) || !!row.startDate;
  }
  function rentalIsExpiring(row){
    if(rentalIsClosed(row)) return false;
    const days = daysUntil(row.endDate);
    return days !== null && days >= 0 && days <= 30;
  }
  function rentalIsOverdue(row){
    if(rentalIsClosed(row)) return false;
    const days = daysUntil(row.endDate);
    return days !== null && days < 0;
  }
  function rentalDeadline(row){
    const days = daysUntil(row.endDate);
    if(days === null) return {text:'未提供到期日',cls:'info'};
    if(rentalIsClosed(row)) return {text:'已結束',cls:'info'};
    if(days < 0) return {text:'已逾期 ' + Math.abs(days) + ' 天',cls:'bad'};
    if(days === 0) return {text:'今天到期',cls:'bad'};
    if(days <= 7) return {text:days + ' 天後到期',cls:'warn'};
    if(days <= 30) return {text:days + ' 天後到期',cls:'warn'};
    return {text:days + ' 天後到期',cls:'ok'};
  }
  function statusClass(status){
    if(/租賃中|有效|已成立|已確認|有庫存|上架|正常/.test(status)) return 'ok';
    if(/待|即將|低庫存|未提供|未設定/.test(status)) return 'warn';
    if(/取消|退租|缺貨|失敗|錯誤|停用|逾期/.test(status)) return 'bad';
    return 'info';
  }

  function initDb(){
    const cfg = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if(!cfg || !cfg.projectId) throw new Error('找不到 Firebase 設定');
    if(!global.firebase || !global.firebase.firestore) throw new Error('Firebase Firestore SDK 尚未載入');
    const app = global.firebase.apps && global.firebase.apps.length ? global.firebase.app() : global.firebase.initializeApp(cfg);
    return global.firebase.firestore(app);
  }
  function withTimeout(promise, ms, label){
    let timer = null;
    const timeout = new Promise(function(_, reject){
      timer = setTimeout(function(){ reject(new Error((label || '讀取') + '逾時')); }, ms);
    });
    return Promise.race([promise, timeout]).finally(function(){ if(timer) clearTimeout(timer); });
  }
  async function readCollectionPaged(name, maxDocs){
    const rows = [];
    const pageSize = Math.min(200, maxDocs);
    let query = state.db.collection(name).limit(pageSize);
    while(rows.length < maxDocs){
      const snap = await withTimeout(query.get(), READ_TIMEOUT_MS, name);
      let lastDoc = null;
      snap.forEach(function(doc){
        lastDoc = doc;
        rows.push(Object.assign({__id:doc.id}, doc.data() || {}));
      });
      if(snap.size < pageSize || !lastDoc || rows.length >= maxDocs) break;
      query = state.db.collection(name).startAfter(lastDoc).limit(Math.min(pageSize, maxDocs - rows.length));
    }
    return rows.slice(0, maxDocs);
  }
  function recordDiagnostic(collection, type, count, message, duration){
    state.diagnostics.push({collection:collection,type:type,count:Number(count||0),message:clean(message),duration:Number(duration||0)});
  }
  async function loadProducts(){
    let selectedRows = [];
    let selectedCollection = '';
    for(const collection of PRODUCT_COLLECTIONS){
      const started = Date.now();
      try{
        const docs = await readCollectionPaged(collection, PRODUCT_MAX_DOCS);
        const normalized = [];
        docs.forEach(function(doc){
          normalizeProductsFromDoc(doc, collection).forEach(function(row){
            if(row.name || row.sku) normalized.push(row);
          });
        });
        recordDiagnostic(collection, normalized.length ? 'ok' : 'empty', normalized.length, normalized.length ? '已讀取，採用此集合' : '集合可讀取，但目前沒有可顯示商品', Date.now()-started);
        if(normalized.length){
          selectedRows = dedupeProducts(normalized);
          selectedCollection = collection;
          break;
        }
      }catch(err){
        recordDiagnostic(collection, 'error', 0, err && err.message ? err.message : String(err), Date.now()-started);
      }
    }
    state.products = selectedRows;
    state.productSource = selectedCollection;
  }
  async function loadRentals(){
    const started = Date.now();
    try{
      const docs = await readCollectionPaged('rentalContracts', RENTAL_MAX_DOCS);
      state.rentals = docs.map(normalizeRental).sort(function(a,b){
        const da = dateFrom(a.endDate); const db = dateFrom(b.endDate);
        if(da && db) return da - db;
        if(da) return -1;
        if(db) return 1;
        return clean(b.updatedAt).localeCompare(clean(a.updatedAt));
      });
      recordDiagnostic('rentalContracts', state.rentals.length ? 'ok' : 'empty', state.rentals.length, state.rentals.length ? '租賃合約讀取完成' : '集合可讀取，但目前沒有合約', Date.now()-started);
    }catch(err){
      state.rentals = [];
      recordDiagnostic('rentalContracts', 'error', 0, err && err.message ? err.message : String(err), Date.now()-started);
    }
  }

  function setText(id, text){ const el = document.getElementById(id); if(el) el.textContent = text; }
  function productStockState(row){
    if(row.stockFound) return row.stock > 0 ? 'in' : 'out';
    if(/缺貨|售完|無庫存|out of stock/i.test(row.stockStatus)) return 'out';
    if(/有庫存|現貨|可購買|available|in stock/i.test(row.stockStatus)) return 'in';
    return 'unknown';
  }
  function productCostText(row){
    if(row.averageCostFound) return compactMoney(row.averageCost);
    if(row.latestCostFound) return compactMoney(row.latestCost);
    return '尚未設定';
  }
  function productStockText(row){
    if(row.stockFound) return String(row.stock.toLocaleString('zh-TW'));
    return clean(row.stockStatus || '未提供');
  }
  function productAvailableText(row){
    if(row.availableFound) return String(row.available.toLocaleString('zh-TW'));
    return '未提供';
  }
  function productGrossText(row){
    return row.grossProfitFound ? compactMoney(row.grossProfit) : '待成本';
  }
  function filteredProducts(){
    const keyword = lower(document.getElementById('productSearch') && document.getElementById('productSearch').value);
    const imageFilter = clean(document.getElementById('productImageFilter') && document.getElementById('productImageFilter').value) || 'all';
    const skuFilter = clean(document.getElementById('productSkuFilter') && document.getElementById('productSkuFilter').value) || 'all';
    const stockFilter = clean(document.getElementById('productStockFilter') && document.getElementById('productStockFilter').value) || 'all';
    const costFilter = clean(document.getElementById('productCostFilter') && document.getElementById('productCostFilter').value) || 'all';
    const sort = clean(document.getElementById('productSort') && document.getElementById('productSort').value) || 'name';
    const rows = state.products.filter(function(row){
      const hay = [row.name,row.sku,row.variantName,row.brand,row.category,row.displayProductId,row.barcode,row.stockStatus].join(' ').toLowerCase();
      if(keyword && hay.indexOf(keyword) < 0) return false;
      if(imageFilter === 'with' && !row.imageUrl) return false;
      if(imageFilter === 'without' && row.imageUrl) return false;
      if(skuFilter === 'with' && !row.sku) return false;
      if(skuFilter === 'without' && row.sku) return false;
      if(stockFilter === 'known' && !row.stockFound) return false;
      if(stockFilter !== 'all' && stockFilter !== 'known' && productStockState(row) !== stockFilter) return false;
      if(costFilter === 'with' && !row.costFound) return false;
      if(costFilter === 'without' && row.costFound) return false;
      return true;
    });
    rows.sort(function(a,b){
      if(sort === 'stock-low'){
        const av = a.stockFound ? a.stock : Number.MAX_SAFE_INTEGER;
        const bv = b.stockFound ? b.stock : Number.MAX_SAFE_INTEGER;
        return av - bv || a.name.localeCompare(b.name,'zh-Hant');
      }
      if(sort === 'price-high') return (b.priceFound?b.price:-1) - (a.priceFound?a.price:-1) || a.name.localeCompare(b.name,'zh-Hant');
      if(sort === 'margin-high') return (b.grossProfitFound?b.grossMargin:-999) - (a.grossProfitFound?a.grossMargin:-999) || a.name.localeCompare(b.name,'zh-Hant');
      if(sort === 'cost-missing') return Number(a.costFound) - Number(b.costFound) || a.name.localeCompare(b.name,'zh-Hant');
      if(sort === 'updated-new'){
        const ad = dateFrom(a.updatedAt); const bd = dateFrom(b.updatedAt);
        return (bd?bd.getTime():0) - (ad?ad.getTime():0) || a.name.localeCompare(b.name,'zh-Hant');
      }
      return a.name.localeCompare(b.name,'zh-Hant') || a.sku.localeCompare(b.sku,'zh-Hant');
    });
    return rows;
  }
  function filteredRentals(){
    const keyword = lower(document.getElementById('rentalSearch') && document.getElementById('rentalSearch').value);
    const filter = clean(document.getElementById('rentalStatusFilter') && document.getElementById('rentalStatusFilter').value) || 'all';
    return state.rentals.filter(function(row){
      const hay = [row.contractNo,row.customerName,row.equipmentName,row.equipmentType,row.brand,row.model,row.serialNo,row.status].join(' ').toLowerCase();
      if(keyword && hay.indexOf(keyword) < 0) return false;
      if(filter === 'active' && !rentalIsActive(row)) return false;
      if(filter === 'expiring' && !rentalIsExpiring(row)) return false;
      if(filter === 'overdue' && !rentalIsOverdue(row)) return false;
      if(filter === 'closed' && !rentalIsClosed(row)) return false;
      return true;
    });
  }

  function renderOverview(){
    const productCount = state.products.length;
    const imageCount = state.products.filter(function(p){return !!p.imageUrl;}).length;
    const missingSku = state.products.filter(function(p){return !p.sku;}).length;
    const stockKnown = state.products.filter(function(p){return p.stockFound;}).length;
    const missingCost = state.products.filter(function(p){return !p.costFound;}).length;
    const activeRentals = state.rentals.filter(rentalIsActive);
    const expiringRentals = state.rentals.filter(rentalIsExpiring);
    const overdueRentals = state.rentals.filter(rentalIsOverdue);

    setText('kpiProductCount', productCount.toLocaleString('zh-TW'));
    setText('kpiProductSource', state.productSource ? ('來源：' + state.productSource) : '尚未找到商品集合');
    setText('kpiMissingSku', missingSku.toLocaleString('zh-TW'));
    setText('kpiStockKnown', stockKnown.toLocaleString('zh-TW'));
    setText('kpiStockRate', '數量覆蓋率 ' + percentage(stockKnown, productCount));
    setText('kpiMissingCost', missingCost.toLocaleString('zh-TW'));
    setText('kpiActiveRentals', activeRentals.length.toLocaleString('zh-TW'));
    setText('kpiRentalTotal', '合約共 ' + state.rentals.length.toLocaleString('zh-TW') + ' 筆');
    setText('kpiExpiringRentals', expiringRentals.length.toLocaleString('zh-TW'));
    setText('kpiOverdueRentals', '逾期 ' + overdueRentals.length.toLocaleString('zh-TW') + ' 筆');

    setText('readinessMissingImage', (productCount-imageCount).toLocaleString('zh-TW'));
    setText('readinessMissingSku', missingSku.toLocaleString('zh-TW'));
    setText('readinessUnknownStock', (productCount-stockKnown).toLocaleString('zh-TW'));
    setText('readinessMissingCost', missingCost.toLocaleString('zh-TW'));

    const rentTotal = activeRentals.reduce(function(sum,row){return sum + (row.rentFeeFound ? row.rentFee : 0);},0);
    const shippingTotal = activeRentals.reduce(function(sum,row){return sum + (row.shippingFeeFound ? row.shippingFee : 0);},0);
    const depositTotal = activeRentals.reduce(function(sum,row){return sum + (row.depositFeeFound ? row.depositFee : 0);},0);
    setText('summaryRentFee', money(rentTotal));
    setText('summaryShippingFee', money(shippingTotal));
    setText('summaryRegisteredIncome', money(rentTotal + shippingTotal));
    setText('summaryDepositFee', money(depositTotal));

    const statusList = document.getElementById('overviewStatusList');
    if(statusList){
      const productStatus = state.productSource ? {cls:'ok',text:'已連線',detail:state.productSource + '／' + productCount + ' 筆'} : {cls:'warn',text:'未找到資料',detail:'已嘗試既有商品集合'};
      const rentalDiag = state.diagnostics.find(function(d){return d.collection === 'rentalContracts';});
      const rentalStatus = rentalDiag && rentalDiag.type === 'error' ? {cls:'bad',text:'讀取失敗',detail:rentalDiag.message} : {cls:'ok',text:'已連線',detail:'rentalContracts／' + state.rentals.length + ' 筆'};
      statusList.innerHTML = [
        '<div class="ops-status-row"><div><strong>Firebase 專案</strong><small>沿用原主系統設定</small></div><div class="ops-status-value"><span class="ops-status-dot ok"></span>'+escapeHtml(firebaseProjectId())+'</div></div>',
        '<div class="ops-status-row"><div><strong>商品與圖片</strong><small>'+escapeHtml(productStatus.detail)+'</small></div><div class="ops-status-value"><span class="ops-status-dot '+productStatus.cls+'"></span>'+escapeHtml(productStatus.text)+'</div></div>',
        '<div class="ops-status-row"><div><strong>租賃合約</strong><small>'+escapeHtml(rentalStatus.detail)+'</small></div><div class="ops-status-value"><span class="ops-status-dot '+rentalStatus.cls+'"></span>'+escapeHtml(rentalStatus.text)+'</div></div>',
        '<div class="ops-status-row"><div><strong>最後讀取</strong><small>重新整理頁面或按重新讀取即可更新</small></div><div class="ops-status-value"><span class="ops-status-dot ok"></span>'+escapeHtml(state.loadedAt ? dateTimeText(state.loadedAt) : '尚未完成')+'</div></div>',
        '<div class="ops-status-row"><div><strong>資料模式</strong><small>未使用 set、add、update、delete</small></div><div class="ops-status-value"><span class="ops-status-dot ok"></span>唯讀</div></div>'
      ].join('');
    }

    const body = document.getElementById('overviewRentalBody');
    if(body){
      const upcoming = state.rentals.filter(function(row){return !rentalIsClosed(row) && dateFrom(row.endDate);}).slice(0,8);
      body.innerHTML = upcoming.length ? upcoming.map(rentalTableRow).join('') : '<tr><td colspan="7"><div class="ops-empty"><strong>目前沒有可排序的租賃到期資料</strong>請到「資料連線狀態」確認 rentalContracts 是否有讀取成功。</div></td></tr>';
    }
  }

  function rentalTableRow(row){
    const href = 'rental-admin.html?contractId=' + encodeURIComponent(row.id || row.contractNo);
    const deadline = rentalDeadline(row);
    const incomeText = row.registeredIncomeFound ? money(row.registeredIncome) : '未設定';
    const incomeSub = [
      row.rentFeeFound ? ('租金 ' + compactMoney(row.rentFee)) : '',
      row.shippingFeeFound ? ('運費 ' + compactMoney(row.shippingFee)) : '',
      row.receivedAmountFound ? ('已收 ' + compactMoney(row.receivedAmount)) : ''
    ].filter(Boolean).join('／') || '原合約未提供金額';
    return '<tr>'+
      '<td><div class="ops-cell-main">'+escapeHtml(row.contractNo)+'</div><div class="ops-cell-sub">'+escapeHtml(row.customerName)+'</div></td>'+
      '<td><div class="ops-cell-main">'+escapeHtml(row.equipmentName)+'</div><div class="ops-cell-sub">'+escapeHtml([row.brand,row.model,row.serialNo].filter(Boolean).join('／') || row.equipmentType)+'</div></td>'+
      '<td><div class="ops-cell-main">'+escapeHtml(dateText(row.startDate))+'～'+escapeHtml(dateText(row.endDate))+'</div><div class="ops-cell-sub"><span class="ops-status-chip '+deadline.cls+'">'+escapeHtml(deadline.text)+'</span></div></td>'+
      '<td><div class="ops-cell-main">'+escapeHtml(incomeText)+'</div><div class="ops-cell-sub">'+escapeHtml(incomeSub)+'</div></td>'+
      '<td><div class="ops-cell-main">'+escapeHtml(row.depositFeeFound ? money(row.depositFee) : '未設定')+'</div></td>'+
      '<td><span class="ops-status-chip '+statusClass(row.status)+'">'+escapeHtml(row.status)+'</span></td>'+
      '<td><a class="ops-btn small" href="'+escapeHtml(href)+'">原系統查看</a></td>'+
    '</tr>';
  }

  function productBadges(row){
    const badges = [];
    const stockState = productStockState(row);
    badges.push('<span class="ops-product-badge '+(stockState==='in'?'ok':stockState==='out'?'bad':'warn')+'">'+escapeHtml(row.stockFound ? ('庫存 ' + row.stock.toLocaleString('zh-TW')) : row.stockStatus)+'</span>');
    if(!row.sku) badges.push('<span class="ops-product-badge warn">缺 SKU</span>');
    if(!row.costFound) badges.push('<span class="ops-product-badge warn">成本未設定</span>');
    if(row.enabledFound && !row.enabled) badges.push('<span class="ops-product-badge bad">已下架</span>');
    return badges.join('');
  }
  function renderProducts(){
    const grid = document.getElementById('productGrid');
    const loadMore = document.getElementById('productLoadMore');
    if(!grid) return;
    const rows = filteredProducts();
    const visible = rows.slice(0, state.productVisibleCount);
    setText('productResultMeta', '顯示 ' + visible.length.toLocaleString('zh-TW') + '／' + rows.length.toLocaleString('zh-TW') + ' 筆' + (state.productSource ? '・來源 ' + state.productSource : ''));
    renderActiveFilter();
    if(!rows.length){
      grid.innerHTML = '<div class="ops-empty" style="grid-column:1/-1"><strong>沒有符合條件的商品</strong>'+(state.products.length ? '請調整搜尋或篩選條件。' : '目前尚未從既有商品集合讀到資料；請查看「資料連線狀態」。')+'</div>';
      if(loadMore) loadMore.hidden = true;
      return;
    }
    grid.innerHTML = visible.map(function(row){
      const image = row.imageUrl ? '<img loading="lazy" src="'+escapeHtml(row.imageUrl)+'" alt="'+escapeHtml(row.name)+'" data-ops-image>' : '';
      const variant = row.variantName ? '<div>規格：<strong>'+escapeHtml(row.variantName)+'</strong></div>' : '';
      const brandCategory = [row.brand,row.category].filter(Boolean).join('／');
      const external = row.url ? '<a class="ops-btn small" href="'+escapeHtml(row.url)+'" target="_blank" rel="noopener noreferrer">官網</a>' : '';
      return '<article class="ops-card ops-product-card">'+
        '<div class="ops-product-media"><div class="ops-product-placeholder">尚無商品圖片</div>'+image+'<div class="ops-product-source">'+escapeHtml(row.sourceCollection)+'</div></div>'+
        '<div class="ops-product-body">'+
          '<div class="ops-product-badges">'+productBadges(row)+'</div>'+
          '<div class="ops-product-name">'+escapeHtml(row.name)+'</div>'+
          '<div class="ops-product-meta"><div>SKU：<strong>'+escapeHtml(row.sku || '未提供')+'</strong></div>'+variant+(brandCategory?'<div>'+escapeHtml(brandCategory)+'</div>':'')+'</div>'+
          '<div class="ops-product-stats">'+
            '<div class="ops-mini-stat"><span>官網售價</span><strong>'+escapeHtml(row.priceFound ? compactMoney(row.price) : '未提供')+'</strong></div>'+
            '<div class="ops-mini-stat"><span>目前庫存</span><strong>'+escapeHtml(productStockText(row))+'</strong></div>'+
            '<div class="ops-mini-stat"><span>可售庫存</span><strong>'+escapeHtml(productAvailableText(row))+'</strong></div>'+
            '<div class="ops-mini-stat"><span>最近成本</span><strong class="'+(row.latestCostFound?'':'missing')+'">'+escapeHtml(row.latestCostFound ? compactMoney(row.latestCost) : '未設定')+'</strong></div>'+
            '<div class="ops-mini-stat"><span>平均成本</span><strong class="'+(row.averageCostFound?'':'missing')+'">'+escapeHtml(row.averageCostFound ? compactMoney(row.averageCost) : '未設定')+'</strong></div>'+
            '<div class="ops-mini-stat"><span>商品毛利／率</span><strong class="'+(row.grossProfitFound?'':'missing')+'">'+escapeHtml(row.grossProfitFound ? (compactMoney(row.grossProfit)+'／'+percentValue(row.grossMargin)) : '待成本')+'</strong></div>'+
          '</div>'+
          '<div class="ops-product-actions"><button class="ops-btn small" type="button" data-product-detail="'+escapeHtml(row.id)+'">詳細資料</button>'+external+'</div>'+
        '</div></article>';
    }).join('');
    grid.querySelectorAll('img[data-ops-image]').forEach(function(img){
      img.addEventListener('error', function(){ img.remove(); }, {once:true});
    });
    if(loadMore) loadMore.hidden = visible.length >= rows.length;
  }

  function renderActiveFilter(){
    const box = document.getElementById('productActiveFilter');
    if(!box) return;
    const labels = [];
    const values = [
      ['productImageFilter',{with:'有圖片',without:'無圖片'}],
      ['productSkuFilter',{with:'有 SKU',without:'無 SKU'}],
      ['productStockFilter',{known:'已提供庫存數量',in:'有庫存',out:'缺貨／零庫存',unknown:'庫存未提供'}],
      ['productCostFilter',{with:'已有成本',without:'成本未設定'}]
    ];
    values.forEach(function(pair){
      const el = document.getElementById(pair[0]);
      if(el && el.value !== 'all' && pair[1][el.value]) labels.push(pair[1][el.value]);
    });
    const keyword = clean(document.getElementById('productSearch') && document.getElementById('productSearch').value);
    if(keyword) labels.push('搜尋：「' + keyword + '」');
    if(state.activeProductFilter) labels.push(state.activeProductFilter);
    if(!labels.length){ box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.innerHTML = '<strong>目前篩選：</strong>' + escapeHtml(Array.from(new Set(labels)).join('、'));
  }

  function renderRentals(){
    const rows = filteredRentals();
    const active = state.rentals.filter(rentalIsActive);
    const expiring = state.rentals.filter(rentalIsExpiring);
    const overdue = state.rentals.filter(rentalIsOverdue);
    const activeIncome = active.reduce(function(sum,row){return sum + (row.registeredIncomeFound ? row.registeredIncome : 0);},0);
    setText('rentalResultMeta', '共 ' + rows.length.toLocaleString('zh-TW') + ' 筆');
    setText('rentalKpiActive', active.length.toLocaleString('zh-TW'));
    setText('rentalKpiExpiring', expiring.length.toLocaleString('zh-TW'));
    setText('rentalKpiOverdue', overdue.length.toLocaleString('zh-TW'));
    setText('rentalKpiIncome', money(activeIncome));
    const body = document.getElementById('rentalTableBody');
    const mobile = document.getElementById('rentalMobileList');
    if(body){
      body.innerHTML = rows.length ? rows.map(rentalTableRow).join('') : '<tr><td colspan="7"><div class="ops-empty"><strong>沒有符合條件的租賃合約</strong>請調整搜尋或篩選條件，或查看連線狀態。</div></td></tr>';
    }
    if(mobile){
      mobile.innerHTML = rows.length ? rows.map(function(row){
        const href = 'rental-admin.html?contractId=' + encodeURIComponent(row.id || row.contractNo);
        const deadline = rentalDeadline(row);
        return '<article class="ops-card ops-rental-card">'+
          '<div class="ops-rental-card-head"><div><h3>'+escapeHtml(row.contractNo)+'</h3><div class="meta">'+escapeHtml(row.customerName)+'・'+escapeHtml(row.equipmentName)+'</div></div><span class="ops-status-chip '+statusClass(row.status)+'">'+escapeHtml(row.status)+'</span></div>'+
          '<div class="ops-rental-deadline"><span class="ops-status-chip '+deadline.cls+'">'+escapeHtml(deadline.text)+'</span><span>'+escapeHtml(dateText(row.startDate))+'～'+escapeHtml(dateText(row.endDate))+'</span></div>'+
          '<div class="ops-rental-grid">'+
            '<div class="ops-rental-field"><span>登錄收入</span><strong>'+escapeHtml(row.registeredIncomeFound ? money(row.registeredIncome) : '未設定')+'</strong></div>'+
            '<div class="ops-rental-field"><span>押金</span><strong>'+escapeHtml(row.depositFeeFound ? money(row.depositFee) : '未設定')+'</strong></div>'+
            '<div class="ops-rental-field"><span>已收款</span><strong>'+escapeHtml(row.receivedAmountFound ? money(row.receivedAmount) : '尚未建立')+'</strong></div>'+
            '<div class="ops-rental-field"><span>未收款</span><strong>'+escapeHtml(row.outstandingAmountFound ? money(row.outstandingAmount) : '尚未建立')+'</strong></div>'+
            '<div class="ops-rental-field"><span>搬運成本</span><strong>'+escapeHtml(row.deliveryCostFound ? money(row.deliveryCost) : '尚未建立')+'</strong></div>'+
            '<div class="ops-rental-field"><span>維修成本</span><strong>'+escapeHtml(row.maintenanceCostFound ? money(row.maintenanceCost) : '尚未建立')+'</strong></div>'+
          '</div><div class="ops-rental-actions"><a class="ops-btn small" href="'+escapeHtml(href)+'">原系統查看</a></div></article>';
      }).join('') : '<div class="ops-empty"><strong>沒有符合條件的租賃合約</strong>請調整搜尋或篩選條件。</div>';
    }
  }

  function firebaseProjectId(){
    return clean(global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG.projectId) || '未設定';
  }
  function renderConnection(){
    setText('connectionProjectId', firebaseProjectId());
    setText('connectionProductSource', state.productSource || '未找到可用集合');
    setText('connectionLoadedAt', state.loadedAt ? dateTimeText(state.loadedAt) : '尚未完成');
    setText('opsLastLoadedText', state.loadedAt ? ('最後讀取：' + dateTimeText(state.loadedAt)) : '等待 Firebase');
    const list = document.getElementById('diagnosticList');
    if(!list) return;
    if(!state.diagnostics.length){
      list.innerHTML = '<div class="ops-empty"><strong>尚無診斷資料</strong>按「重新讀取」開始檢查。</div>';
      return;
    }
    list.innerHTML = state.diagnostics.map(function(item){
      const label = item.type === 'ok' ? '成功' : (item.type === 'empty' ? '無資料' : '失敗');
      const cls = item.type === 'ok' ? 'ok' : (item.type === 'empty' ? 'warn' : 'bad');
      const timing = item.duration ? ('・' + (item.duration/1000).toFixed(1) + ' 秒') : '';
      return '<div class="ops-diagnostic-row"><div class="collection">'+escapeHtml(item.collection)+'</div><div><span class="ops-status-chip '+cls+'">'+label+' '+item.count.toLocaleString('zh-TW')+' 筆</span></div><div class="detail">'+escapeHtml(item.message + timing)+'</div></div>';
    }).join('');
  }
  function renderAll(){
    renderOverview();
    renderProducts();
    renderRentals();
    renderConnection();
  }

  function renderLoading(){
    ['kpiProductCount','kpiMissingSku','kpiStockKnown','kpiMissingCost','kpiActiveRentals','kpiExpiringRentals','rentalKpiActive','rentalKpiExpiring','rentalKpiOverdue','rentalKpiIncome'].forEach(function(id){ setText(id,'…'); });
    setText('opsLastLoadedText','正在讀取 Firebase...');
    setText('productResultMeta','正在讀取 Firebase...');
    setText('rentalResultMeta','正在讀取 Firebase...');
    const grid = document.getElementById('productGrid');
    if(grid){
      grid.innerHTML = Array.from({length:8}).map(function(){
        return '<article class="ops-card ops-product-card"><div class="ops-product-media ops-skeleton"></div><div class="ops-product-body"><div class="ops-product-name ops-skeleton">讀取中</div><div class="ops-product-meta ops-skeleton">讀取中</div><div class="ops-product-stats"><div class="ops-mini-stat ops-skeleton">讀取中</div><div class="ops-mini-stat ops-skeleton">讀取中</div><div class="ops-mini-stat ops-skeleton">讀取中</div></div></div></article>';
      }).join('');
    }
  }
  async function reload(){
    if(state.loading) return;
    state.loading = true;
    state.diagnostics = [];
    state.products = [];
    state.rentals = [];
    state.productSource = '';
    state.productVisibleCount = PRODUCT_PAGE_SIZE;
    renderLoading();
    const button = document.getElementById('opsReloadBtn');
    if(button){ button.disabled = true; button.textContent = '讀取中...'; }
    try{
      if(!state.db) state.db = initDb();
      await Promise.allSettled([loadProducts(), loadRentals()]);
      state.loadedAt = new Date();
      renderAll();
    }catch(err){
      recordDiagnostic('Firebase', 'error', 0, err && err.message ? err.message : String(err), 0);
      state.loadedAt = new Date();
      renderAll();
    }finally{
      state.loading = false;
      if(button){ button.disabled = false; button.textContent = '↻ 重新讀取'; }
    }
  }

  function switchView(view, updateHash){
    if(!pageMeta[view]) view = 'overview';
    state.view = view;
    document.querySelectorAll('[data-ops-view-panel]').forEach(function(panel){
      panel.classList.toggle('is-active', panel.getAttribute('data-ops-view-panel') === view);
    });
    document.querySelectorAll('[data-ops-view]').forEach(function(button){
      button.classList.toggle('is-active', button.getAttribute('data-ops-view') === view);
    });
    const meta = pageMeta[view];
    setText('opsPageTitle', meta[0]);
    setText('opsPageSubtitle', meta[1]);
    if(updateHash !== false && global.location.hash !== '#' + view){
      try{ history.replaceState(null, '', '#' + view); }catch(err){ global.location.hash = view; }
    }
    global.scrollTo({top:0,behavior:'smooth'});
  }

  function detailBox(label, value, className){
    return '<div class="ops-detail-box '+escapeHtml(className||'')+'"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value)+'</strong></div>';
  }
  function detailSection(title, body){
    return '<section class="ops-detail-section"><h4>'+escapeHtml(title)+'</h4><div class="ops-detail-grid">'+body+'</div></section>';
  }
  function openProductDetail(id){
    const row = state.products.find(function(item){ return item.id === id; });
    if(!row) return;
    const modal = document.getElementById('productModal');
    const body = document.getElementById('productModalBody');
    if(!modal || !body) return;
    const image = row.imageUrl ? '<img src="'+escapeHtml(row.imageUrl)+'" alt="'+escapeHtml(row.name)+'">' : '<div class="ops-empty" style="min-height:160px"><strong>尚無圖片</strong>原商品資料沒有可顯示的圖片網址。</div>';
    const grossNote = row.grossProfitFound ? '售價減商品成本，尚未扣除平台費、運費、廣告與其他成本。' : '目前缺少售價或成本，因此無法試算商品毛利。';
    body.innerHTML = '<div class="ops-detail-product"><div class="ops-detail-media">'+image+'<div class="ops-product-badges detail">'+productBadges(row)+'</div></div><div><h3 class="ops-detail-title">'+escapeHtml(row.name)+'</h3><div class="ops-detail-sub">'+escapeHtml([row.brand,row.category,row.variantName].filter(Boolean).join('・') || '未提供品牌／分類／規格')+'</div>'+
      detailSection('商品識別',
        detailBox('SKU', row.sku || '未提供')+
        detailBox('商品編號', row.displayProductId || '未提供')+
        detailBox('條碼', row.barcode || '未提供')+
        detailBox('Firestore 集合', row.sourceCollection)
      )+
      detailSection('庫存',
        detailBox('目前庫存', row.stockFound ? row.stock.toLocaleString('zh-TW') : '未提供')+
        detailBox('可售庫存', row.availableFound ? row.available.toLocaleString('zh-TW') : '未提供')+
        detailBox('保留庫存', row.reservedFound ? row.reserved.toLocaleString('zh-TW') : '未提供')+
        detailBox('安全庫存', row.safetyFound ? row.safety.toLocaleString('zh-TW') : '未提供')+
        detailBox('庫存狀態', row.stockStatus || '未提供')+
        detailBox('目前庫存價值', row.inventoryValueFound ? money(row.inventoryValue) : '待庫存與成本')
      )+
      detailSection('售價與成本',
        detailBox('官網售價', row.priceFound ? money(row.price) : '未提供')+
        detailBox('最近進貨成本', row.latestCostFound ? money(row.latestCost) : '尚未設定')+
        detailBox('移動平均成本', row.averageCostFound ? money(row.averageCost) : '尚未設定')+
        detailBox('商品毛利', row.grossProfitFound ? money(row.grossProfit) : '無法試算')+
        detailBox('商品毛利率', row.grossProfitFound ? percentValue(row.grossMargin) : '無法試算')+
        detailBox('最後更新', row.updatedAt ? dateTimeText(row.updatedAt) : '未提供')
      )+
      '<div class="ops-detail-note">'+escapeHtml(grossNote)+'</div>'+
      (row.url?'<div class="ops-detail-actions"><a class="ops-btn primary" href="'+escapeHtml(row.url)+'" target="_blank" rel="noopener noreferrer">開啟商品頁</a></div>':'')+
    '</div></div>';
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function closeProductDetail(){
    const modal = document.getElementById('productModal');
    if(modal) modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function clearProductFilters(){
    ['productSearch'].forEach(function(id){ const el=document.getElementById(id); if(el) el.value=''; });
    ['productImageFilter','productSkuFilter','productStockFilter','productCostFilter'].forEach(function(id){ const el=document.getElementById(id); if(el) el.value='all'; });
    const sort = document.getElementById('productSort'); if(sort) sort.value='name';
    state.activeProductFilter = '';
    state.productVisibleCount = PRODUCT_PAGE_SIZE;
    renderProducts();
  }
  function applyProductQuickFilter(type){
    clearProductFilters();
    if(type === 'image-missing'){
      document.getElementById('productImageFilter').value = 'without';
      state.activeProductFilter = '無圖片';
    }else if(type === 'sku-missing'){
      document.getElementById('productSkuFilter').value = 'without';
      state.activeProductFilter = '無 SKU';
    }else if(type === 'stock-unknown'){
      document.getElementById('productStockFilter').value = 'unknown';
      state.activeProductFilter = '庫存未提供';
    }else if(type === 'stock-known'){
      document.getElementById('productStockFilter').value = 'known';
      state.activeProductFilter = '已提供庫存數量';
    }else if(type === 'cost-missing'){
      document.getElementById('productCostFilter').value = 'without';
      state.activeProductFilter = '成本未設定';
    }
    state.productVisibleCount = PRODUCT_PAGE_SIZE;
    switchView('products');
    renderProducts();
  }

  function bindEvents(){
    document.querySelectorAll('[data-ops-view]').forEach(function(button){
      button.addEventListener('click', function(){ if(!button.disabled) switchView(button.getAttribute('data-ops-view')); });
    });
    document.querySelectorAll('[data-ops-view-link]').forEach(function(button){
      button.addEventListener('click', function(){ switchView(button.getAttribute('data-ops-view-link')); });
    });
    document.querySelectorAll('[data-product-quick-filter]').forEach(function(button){
      const run = function(){ applyProductQuickFilter(button.getAttribute('data-product-quick-filter')); };
      button.addEventListener('click', run);
      button.addEventListener('keydown', function(event){ if(event.key === 'Enter' || event.key === ' '){ event.preventDefault(); run(); } });
    });
    const reloadButton = document.getElementById('opsReloadBtn');
    if(reloadButton) reloadButton.addEventListener('click', reload);
    ['productSearch','productImageFilter','productSkuFilter','productStockFilter','productCostFilter','productSort'].forEach(function(id){
      const el = document.getElementById(id);
      if(el) el.addEventListener(id === 'productSearch' ? 'input' : 'change', function(){ state.productVisibleCount = PRODUCT_PAGE_SIZE; state.activeProductFilter=''; renderProducts(); });
    });
    ['rentalSearch','rentalStatusFilter'].forEach(function(id){
      const el = document.getElementById(id);
      if(el) el.addEventListener(id === 'rentalSearch' ? 'input' : 'change', renderRentals);
    });
    const clear = document.getElementById('productClearFilters');
    if(clear) clear.addEventListener('click', clearProductFilters);
    const more = document.getElementById('productLoadMore');
    if(more) more.addEventListener('click', function(){ state.productVisibleCount += PRODUCT_PAGE_SIZE; renderProducts(); });
    const grid = document.getElementById('productGrid');
    if(grid) grid.addEventListener('click', function(event){
      const button = event.target.closest('[data-product-detail]');
      if(button) openProductDetail(button.getAttribute('data-product-detail'));
    });
    const close = document.getElementById('productModalClose');
    if(close) close.addEventListener('click', closeProductDetail);
    const modal = document.getElementById('productModal');
    if(modal) modal.addEventListener('click', function(event){ if(event.target === modal) closeProductDetail(); });
    document.addEventListener('keydown', function(event){ if(event.key === 'Escape') closeProductDetail(); });
    global.addEventListener('hashchange', function(){ switchView(clean(global.location.hash).replace(/^#/,'') || 'overview', false); });
  }

  async function init(){
    if(typeof global.fillHeader === 'function') global.fillHeader();
    const user = typeof global.requireLogin === 'function' ? global.requireLogin() : null;
    if(!user) return;
    if(typeof global.hasSettingsZoneAccess === 'function' && !global.hasSettingsZoneAccess(user)){
      global.location.href = 'dashboard.html';
      return;
    }
    if(typeof global.setPortalMode === 'function') global.setPortalMode('settings');
    state.user = user;
    const name = clean(user.name || user.employeeName || user.email || '管理員');
    setText('opsUserName', name);
    setText('opsUserInitial', name.slice(0,1) || '管');
    bindEvents();
    switchView(clean(global.location.hash).replace(/^#/,'') || 'overview', false);
    await reload();
  }

  global.OperationsPhase1 = {init:init,reload:reload};
})(window);
