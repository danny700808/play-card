(function(global){
  'use strict';
  const PRINT_BASE='http://127.0.0.1:18181';
  const COLLECTION='opsInternalProducts';
  const PAGE_SIZE=80;
  const PASSWORD_HASH='c52cbddc9be708cc43aea50035588b91743634605dd20b46cd8a4855b87270aa';
  const SESSION_KEY='yuzuBarcodePrintUnlockedV3';
  const state={db:null,products:[],filtered:[],visible:PAGE_SIZE,selected:null,serviceReady:false,searchComposing:false};
  const $=function(id){return document.getElementById(id);};
  function clean(v){return String(v==null?'':v).trim();}
  function lower(v){return clean(v).toLowerCase();}
  function formatLabelSku(value){const raw=clean(value).replace(/\s+/g,'');if(!raw)return '';if(/^\d{3}-/.test(raw))return raw;const match=raw.match(/^(\d{3})(\d{4})(.*)$/);return match?match[1]+'-'+match[2]+match[3]:raw;}
  // 原本只保留英數，中文會被清成空字串，造成「中文搜尋」變成所有商品都符合。
  // 僅移除 SKU 常見分隔符，保留中文、英文與數字一起比對。
  function compactCode(value){return lower(value).replace(/[\s\-_.\/\\]/g,'');}
  function esc(v){return clean(v).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  function attr(v){return esc(v).replace(/`/g,'&#96;');}
  function number(v){const n=Number(String(v==null?'':v).replace(/,/g,'').replace(/[^0-9.\-]/g,''));return Number.isFinite(n)?n:null;}
  function first(obj,keys){for(const k of keys){if(obj&&obj[k]!==undefined&&obj[k]!==null&&clean(obj[k])!=='')return obj[k];}return '';}
  function safeUrl(v){const s=clean(v);return /^https?:\/\//i.test(s)?s:'';}
  function imageList(raw){const out=[];function add(v){const u=safeUrl(typeof v==='object'&&v?v.url||v.src||v.imageUrl:v);if(u&&!out.includes(u))out.push(u);}['variantImageUrl','imageUrl','image','picture','cover','thumbnail'].forEach(function(k){add(raw[k]);});['variantImageUrls','parentImageUrls','imageUrls','images','photos'].forEach(function(k){const arr=raw[k];if(Array.isArray(arr))arr.forEach(add);});return out;}
  function normalize(doc){
    const raw=doc.data()||{};
    const sku=clean(first(raw,['internalSku','sku','code','productCode','商品編號']));
    const original=clean(first(raw,['internalName','originalName','name','商品名稱']));
    const online=clean(raw.onlineName);
    const name=original||online||'未命名商品';
    const variant=clean(raw.variantName);
    const price=number(first(raw,['storePrice','originalSalePrice','salePrice','retailPrice']))||0;
    const images=imageList(raw);
    return {id:doc.id,sku:sku,name:name,onlineName:online,variant:variant,price:price,imageUrl:images[0]||'',enabled:raw.enabled!==false,status:clean(raw.status)||'active'};
  }
  function formatMoney(v){return 'NT$ '+Math.round(Number(v||0)).toLocaleString('zh-TW');}
  async function sha256(value){
    const data=new TextEncoder().encode(String(value||''));
    const digest=await crypto.subtle.digest('SHA-256',data);
    return Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  }
  function showApp(){
    document.body.classList.remove('bp-locked');
    const login=$('bpLoginScreen');
    const app=$('bpApp');
    if(login)login.hidden=true;
    if(app)app.hidden=false;
  }
  function bindLogin(){
    const form=$('bpLoginForm');
    const input=$('bpPassword');
    const error=$('bpLoginError');
    if(!form||!input)return;
    form.addEventListener('submit',async function(event){
      event.preventDefault();
      error.textContent='';
      const submit=form.querySelector('button[type="submit"]');
      submit.disabled=true;
      submit.textContent='確認中…';
      try{
        const hash=await sha256(input.value);
        if(hash!==PASSWORD_HASH){
          error.textContent='密碼錯誤，請重新輸入。';
          input.select();
          return;
        }
        sessionStorage.setItem(SESSION_KEY,'1');
        showApp();
        await initApp();
      }finally{
        submit.disabled=false;
        submit.textContent='進入條碼列印';
      }
    });
  }
  function initDb(){const cfg=global.APP_CONFIG&&global.APP_CONFIG.FIREBASE_CONFIG;if(!cfg||!cfg.projectId)throw new Error('找不到 Firebase 設定');if(!global.firebase.apps.length)global.firebase.initializeApp(cfg);return global.firebase.firestore();}
  function toast(text){const el=$('bpToast');el.textContent=text;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(function(){el.classList.remove('show');},2600);}
  function setService(ready,text){state.serviceReady=ready;const el=$('bpServiceStatus');el.className='bp-service '+(ready?'ready':'offline');el.textContent=text;}
  async function localFetch(path,options){
    const controller=new AbortController();const timer=setTimeout(function(){controller.abort();},2500);
    try{const response=await fetch(PRINT_BASE+path,Object.assign({},options||{},{signal:controller.signal}));const text=await response.text();let data={};try{data=text?JSON.parse(text):{};}catch(err){data={message:text};}if(!response.ok)throw new Error(data.message||('HTTP '+response.status));return data;}finally{clearTimeout(timer);}
  }
  async function checkService(){
    const el=$('bpServiceStatus');el.className='bp-service checking';el.textContent='檢查條碼機';
    try{const r=await localFetch('/health',{method:'GET'});if(r.printerInstalled===false)throw new Error('找不到印表機');setService(true,'條碼機已連線');}
    catch(err){setService(false,'條碼機未連線');}
  }
  function applySearch(){
    const term=lower($('bpSearch').value);state.visible=PAGE_SIZE;
    const compactTerm=compactCode(term);
    state.filtered=state.products.filter(function(p){
      if(!term)return true;
      const hay=lower([p.name,p.onlineName,p.variant,p.sku,formatLabelSku(p.sku)].join(' '));
      return hay.indexOf(term)>=0||(compactTerm!==''&&compactCode(hay).indexOf(compactTerm)>=0);
    });
    render();
  }
  function productCard(p){
    const image=p.imageUrl?'<img loading="lazy" src="'+attr(p.imageUrl)+'" alt="" onerror="this.parentNode.innerHTML=\'<div class=&quot;bp-no-image&quot;>沒有圖片</div>\'">':'<div class="bp-no-image">沒有圖片</div>';
    return '<article class="bp-card"><div class="bp-image">'+image+'</div><div class="bp-card-body"><h2 class="bp-name">'+esc(p.name)+'</h2>'+(p.variant?'<div class="bp-variant">'+esc(p.variant)+'</div>':'')+'<div class="bp-sku">'+esc(formatLabelSku(p.sku)||'未設定編號')+'</div><div class="bp-price">'+formatMoney(p.price)+'</div><button class="bp-print-btn" type="button" data-print="'+attr(p.id)+'" '+(!p.sku?'disabled':'')+'>列印條碼</button></div></article>';
  }
  function render(){
    const rows=state.filtered.slice(0,state.visible);const wrap=$('bpProducts');
    wrap.innerHTML=rows.length?rows.map(productCard).join(''):'<div class="bp-empty">找不到符合的商品</div>';
    $('bpLoadMore').classList.toggle('hidden',state.visible>=state.filtered.length);
    const term=clean($('bpSearch').value);$('bpSearchHelp').textContent=(term?'找到 ':'共 ')+state.filtered.length.toLocaleString('zh-TW')+' 項商品';
  }
  function openModal(product){
    state.selected=product;$('bpCopies').value='1';document.querySelectorAll('[data-copies]').forEach(function(b){b.classList.toggle('active',b.dataset.copies==='1');});
    $('bpModalProduct').innerHTML='<h2 id="bpModalTitle">'+esc(product.name)+'</h2>'+(product.variant?'<p>'+esc(product.variant)+'</p>':'')+'<p>商品編號：'+esc(formatLabelSku(product.sku))+'</p><strong>'+formatMoney(product.price)+'</strong>';
    $('bpModalStatus').className='bp-modal-status';$('bpModalStatus').textContent=state.serviceReady?'條碼機已連線，可以直接列印。':'條碼機尚未連線，請先完成電腦端的一次安裝。';
    $('bpPrintSubmit').disabled=!state.serviceReady;$('bpModal').classList.add('open');setTimeout(function(){$('bpCopies').select();},80);
  }
  function closeModal(){$('bpModal').classList.remove('open');state.selected=null;}
  async function printSelected(event){
    event.preventDefault();const p=state.selected;if(!p)return;const copies=Math.max(1,Math.min(500,Math.round(Number($('bpCopies').value||1))));
    const btn=$('bpPrintSubmit');btn.disabled=true;btn.textContent='列印中…';$('bpModalStatus').className='bp-modal-status';$('bpModalStatus').textContent='正在送到 TSC TTP-244 Plus…';
    try{const displaySku=formatLabelSku(p.sku);await localFetch('/print',{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({sku:displaySku,rawSku:p.sku,displaySku:displaySku,name:p.name,variant:p.variant,price:p.price,copies:copies,labelLayoutVersion:'20260716-v2'})});closeModal();toast(displaySku+' 已列印 '+copies+' 張');}
    catch(err){state.serviceReady=false;setService(false,'條碼機未連線');$('bpModalStatus').className='bp-modal-status error';$('bpModalStatus').textContent='列印失敗：'+clean(err.message||err);btn.disabled=false;}
    finally{btn.textContent='確定列印';if(state.serviceReady)btn.disabled=false;}
  }
  function bind(){
    let searchTimer;
    function queueSearch(delay){clearTimeout(searchTimer);searchTimer=setTimeout(applySearch,delay==null?120:delay);}
    // 中文輸入法組字中不重繪搜尋結果；組字完成或按 Enter 才送出完整關鍵字。
    $('bpSearch').addEventListener('compositionstart',function(){state.searchComposing=true;clearTimeout(searchTimer);});
    $('bpSearch').addEventListener('compositionend',function(){state.searchComposing=false;queueSearch(0);});
    $('bpSearch').addEventListener('input',function(){if(!state.searchComposing)queueSearch(120);});
    $('bpSearch').addEventListener('keydown',function(event){if(event.key==='Enter'&&!state.searchComposing){event.preventDefault();queueSearch(0);}});
    $('bpClear').addEventListener('click',function(){$('bpSearch').value='';applySearch();$('bpSearch').focus();});
    $('bpLoadMore').addEventListener('click',function(){state.visible+=PAGE_SIZE;render();});
    $('bpProducts').addEventListener('click',function(e){const b=e.target.closest('[data-print]');if(!b)return;const p=state.products.find(function(x){return x.id===b.dataset.print;});if(p)openModal(p);});
    $('bpModalClose').addEventListener('click',closeModal);$('bpModal').addEventListener('click',function(e){if(e.target===$('bpModal'))closeModal();});
    document.querySelectorAll('[data-copies]').forEach(function(b){b.addEventListener('click',function(){$('bpCopies').value=b.dataset.copies;document.querySelectorAll('[data-copies]').forEach(function(x){x.classList.toggle('active',x===b);});});});
    $('bpCopies').addEventListener('input',function(){document.querySelectorAll('[data-copies]').forEach(function(x){x.classList.toggle('active',x.dataset.copies===$('bpCopies').value);});});
    $('bpPrintForm').addEventListener('submit',printSelected);document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal();});
  }
  let appInitialized=false;
  async function initApp(){
    if(appInitialized)return;
    appInitialized=true;
    bind();
    try{state.db=initDb();const snap=await state.db.collection(COLLECTION).limit(10000).get();state.products=snap.docs.map(normalize).filter(function(p){return p.enabled&&p.status!=='inactive'&&p.status!=='discontinued';}).sort(function(a,b){const imageDiff=Number(!!b.imageUrl)-Number(!!a.imageUrl);return imageDiff||a.name.localeCompare(b.name,'zh-Hant',{numeric:true});});state.filtered=state.products.slice();render();$('bpSearch').focus();}
    catch(err){$('bpProducts').innerHTML='<div class="bp-empty">商品資料讀取失敗：'+esc(err.message||err)+'</div>';$('bpSearchHelp').textContent='請確認網路與 Firebase 權限';}
    checkService();setInterval(checkService,30000);
  }
  function init(){
    bindLogin();
    if(sessionStorage.getItem(SESSION_KEY)==='1'){showApp();initApp();}
    else{const input=$('bpPassword');if(input)setTimeout(function(){input.focus();},50);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
