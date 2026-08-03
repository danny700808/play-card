from pathlib import Path


def require_once(text, needle, label):
    count = text.count(needle)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")


path = Path("operations-phase1.js")
js = path.read_text(encoding="utf-8")

pad_start = js.index("  function posNumberPadHtml(){")
pad_end = js.index("\n  function renderSalesV6()", pad_start)
pad_block = r'''  function posNumberPadHtml(){
    return '<div class="ops-number-pad ops-pos-number-pad" aria-label="商品編號快速數字鍵盤">'+['1','2','3','4','5','6','7','8','9','clear','0','back'].map(function(key){
      const label=key==='clear'?'清除':key==='back'?'⌫':key;
      return '<button type="button" tabindex="-1" onpointerdown="event.preventDefault()" data-action="pos-key" data-key="'+key+'">'+label+'</button>';
    }).join('')+'</div>';
  }

  let posSearchResultsTimer=0;
  function posSearchResultsHtml(){
    const usageMode=state.salesMode==='usage';
    const term=lower(state.posSearch).trim();
    const products=state.catalog.filter(function(product){return product.initialized&&product.status!=='inactive';});
    const choices=term?products.filter(function(product){
      return matchesSearch([product.originalName,product.onlineName,product.sku,formatLabelSku(product.sku),product.barcode,product.brand,product.category],term);
    }).slice(0,30):[];
    if(choices.length){
      return choices.map(function(product){
        const image=product.imageUrl||'';
        return '<button class="ops-pos-item ops-v8-pos-item" data-action="cart-add" data-id="'+attr(product.docId)+'">'
          +(image?'<img loading="lazy" src="'+attr(image)+'" alt="" onerror="this.style.display=&quot;none&quot;">':'<div class="ops-pos-no-image">無圖</div>')
          +'<div><b>'+escapeHtml(product.originalName||product.name)+'</b><small>編號 '+escapeHtml(product.sku||'未設定')+'・庫存 '+formatNumber(product.currentStock)+'</small></div>'
          +'<strong>'+(usageMode?'加入':money(product.storePrice))+'</strong></button>';
      }).join('');
    }
    if(term)return '<div class="ops-no-result">找不到商品</div>';
    return '<div class="ops-v8-sales-search-empty"><b>輸入商品編號或名稱</b><small>支援中文、英文、SKU 與條碼</small></div>';
  }
  function updatePosSearchResults(){
    const node=byId('posSearchResults');
    if(!node)return false;
    node.innerHTML=posSearchResultsHtml();
    return true;
  }
  function schedulePosSearchResultsUpdate(immediate){
    if(posSearchResultsTimer){
      global.clearTimeout(posSearchResultsTimer);
      posSearchResultsTimer=0;
    }
    const run=function(){updatePosSearchResults();};
    if(immediate){run();return;}
    posSearchResultsTimer=global.setTimeout(function(){
      posSearchResultsTimer=0;
      run();
    },180);
  }
'''
js = js[:pad_start] + pad_block + js[pad_end:]

sales_start = js.index("  function renderSalesV7(){")
sales_end = js.index("  function renderStockUsageForm(){", sales_start)
sales_block = js[sales_start:sales_end]
old_input = '<input class="ops-input grow ops-pos-search" id="posSearch" placeholder="商品編號／名稱" value="'+attr(state.posSearch)+'">'
new_input = '<input class="ops-input grow ops-pos-search" id="posSearch" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" placeholder="商品編號／名稱" value="'+attr(state.posSearch)+'">'
require_once(sales_block, old_input, "renderSalesV7 posSearch")
sales_block = sales_block.replace(old_input, new_input, 1)
old_results = '<div class="ops-pos-products">'+productHtml+'</div>'
new_results = '<div class="ops-pos-products" id="posSearchResults">'+productHtml+'</div>'
require_once(sales_block, old_results, "renderSalesV7 results")
sales_block = sales_block.replace(old_results, new_results, 1)
js = js[:sales_start] + sales_block + js[sales_end:]

old_pos_key = '''    if(action==='pos-key'){
      const key=el.dataset.key||'';
      if(key==='clear')state.posSearch='';
      else if(key==='back')state.posSearch=state.posSearch.slice(0,-1);
      else state.posSearch+=key;
      return renderKeepingViewport();
    }
'''
new_pos_key = '''    if(action==='pos-key'){
      const key=el.dataset.key||'';
      const input=byId('posSearch');
      const current=input?String(input.value||''):String(state.posSearch||'');
      let next=current;
      if(key==='clear')next='';
      else if(key==='back')next=current.slice(0,-1);
      else next=current+key;
      state.posSearch=next;
      if(input){
        input.value=next;
        try{input.setSelectionRange(next.length,next.length);}catch(err){}
      }
      schedulePosSearchResultsUpdate(true);
      return;
    }
'''
require_once(js, old_pos_key, "pos-key action")
js = js.replace(old_pos_key, new_pos_key, 1)

old_clear = "    if(action==='pos-clear-search'){state.posSearch='';return renderKeepingViewport();}"
new_clear = "    if(action==='pos-clear-search'){state.posSearch='';const input=byId('posSearch');if(input)input.value='';schedulePosSearchResultsUpdate(true);return;}"
require_once(js, old_clear, "pos clear action")
js = js.replace(old_clear, new_clear, 1)

apply_start = js.index("    function applyOpsSearchInput(input){")
apply_end = js.index("    document.addEventListener('compositionstart'", apply_start)
apply_block = js[apply_start:apply_end]
apply_marker = "      state[key]=nextValue;\n"
require_once(apply_block, apply_marker, "applyOpsSearchInput state")
apply_block = apply_block.replace(
    apply_marker,
    apply_marker + '''      if(input.id==='posSearch'){
        schedulePosSearchResultsUpdate(false);
        return;
      }
''',
    1,
)
js = js[:apply_start] + apply_block + js[apply_end:]

old_enter = '''      if(event.target.dataset.opsImeComposing==='1')return;
      scheduleDeferredSearchRender(event.target.id,event.target.value,true);
'''
new_enter = '''      if(event.target.dataset.opsImeComposing==='1')return;
      if(event.target.id==='posSearch'){
        state.posSearch=event.target.value;
        schedulePosSearchResultsUpdate(true);
        return;
      }
      scheduleDeferredSearchRender(event.target.id,event.target.value,true);
'''
require_once(js, old_enter, "search Enter behavior")
js = js.replace(old_enter, new_enter, 1)

history_marker = "  function renderSalesHistoryV7(){"
history_index = js.index(history_marker)
mobile_history_helper = r'''  function mobileSalesHistoryCards(rows){
    const list=Array.isArray(rows)?rows:[];
    const content=list.length?list.map(function(entry){
      const row=entry.row||{};
      const occurred=escapeHtml(dateTimeText(entry.date));
      if(entry.kind==='income'){
        const amount=Math.max(0,Number(row.amount||0));
        const received=Math.max(0,Number(row.receivedAmount==null?amount:row.receivedAmount));
        const outstanding=Math.max(0,amount-received);
        const paymentStatus=clean(row.paymentStatus)||'paid';
        const status=paymentStatus==='paid'?'已收清':paymentStatus==='partial'?'部分收款':'未收款';
        const owner=clean(row.customerName)||'門市散客';
        const item=clean(row.itemName)||clean(row.note);
        return '<article class="ops-mobile-history-card">'
          +'<header><div><time>'+occurred+'</time><strong>'+escapeHtml(row.category||'其他收入')+'</strong><small>'+escapeHtml(row.incomeNo||row.id||'')+'</small></div>'+statusTag(status,paymentStatus==='paid'?'green':'yellow')+'</header>'
          +'<div class="ops-mobile-history-owner"><span>客戶／用途</span><b>'+escapeHtml(owner)+'</b>'+(item?'<small>'+escapeHtml(item)+'</small>':'')+'</div>'
          +'<div class="ops-mobile-history-money"><div><span>金額</span><b>'+money(amount)+'</b></div><div><span>已收</span><b>'+money(received)+'</b></div>'+(outstanding?'<div><span>未收</span><b>'+money(outstanding)+'</b></div>':'')+'</div>'
          +'<button type="button" class="ops-button ghost wide" data-action="income-edit" data-id="'+attr(row.id)+'">查看／修改</button>'
          +'</article>';
      }
      const internalUse=row.saleType==='internalUse';
      const waiting=row.saleType==='preorder'&&row.fulfillmentStatus!=='delivered';
      const deliveredPreorder=row.saleType==='preorder'&&!waiting;
      const paymentStatus=clean(row.paymentStatus)||'paid';
      const status=waiting?'等待到貨':internalUse?'已扣庫存':paymentStatus==='paid'?'已收清':paymentStatus==='partial'?'部分收款':'未收款';
      const type=waiting?'預購／訂金':deliveredPreorder?'預購交貨':internalUse?'內部耗用／報廢':'商品銷售';
      const owner=internalUse?(row.usageReason||'內部耗用／報廢'):(row.customerName||'門市散客');
      const items=Array.isArray(row.items)?row.items:[];
      const itemHtml=items.length?items.map(function(item){
        const qty=Math.max(1,Number(item.qty||1));
        const lineAmount=Number(item.lineTotal==null?qty*Number(item.unitPrice||0):item.lineTotal);
        return '<div class="ops-mobile-history-item"><div><b>'+escapeHtml(clean(item.name)||clean(item.sku)||'商品')+'</b><small>'+escapeHtml(item.sku||'未設定編號')+' × '+formatNumber(qty)+'</small></div><strong>'+money(lineAmount)+'</strong></div>';
      }).join(''):'<div class="ops-mobile-history-empty">沒有商品明細</div>';
      const orderTotal=Number(row.orderTotal||row.total||0);
      const received=Math.max(0,Number(row.receivedAmount||0));
      const amount=waiting?orderTotal:Number(row.total||0);
      const cost=waiting?0:Number(row.costTotal||0);
      const profit=waiting?null:(numberOrNull(row.grossProfit)==null?amount-cost:Number(row.grossProfit));
      const action=waiting
        ?'<button type="button" class="ops-button primary wide" data-action="preorder-fulfill" data-id="'+attr(row.id)+'">到貨交貨</button>'
        :'<button type="button" class="ops-button ghost wide" data-action="sale-edit" data-id="'+attr(row.id)+'">查看／修改</button>';
      return '<article class="ops-mobile-history-card">'
        +'<header><div><time>'+occurred+'</time><strong>'+escapeHtml(type)+'</strong><small>'+escapeHtml(row.saleNo||row.id||'')+'</small></div>'+statusTag(status,waiting||internalUse||paymentStatus!=='paid'?'yellow':'green')+'</header>'
        +'<div class="ops-mobile-history-owner"><span>客戶／用途</span><b>'+escapeHtml(owner)+'</b></div>'
        +'<div class="ops-mobile-history-items">'+itemHtml+'</div>'
        +'<div class="ops-mobile-history-money"><div><span>'+(waiting?'訂單總額':'金額')+'</span><b>'+money(amount)+'</b></div>'+(waiting?'<div><span>已收訂金</span><b>'+money(received)+'</b></div>':'<div><span>成本</span><b>'+money(cost)+'</b></div><div><span>毛利</span><b>'+money(profit)+'</b></div>')+'</div>'
        +action
        +'</article>';
    }).join(''):emptyHtml('找不到符合條件的紀錄','請調整搜尋文字或日期區間。');
    return '<div class="ops-mobile-sales-history">'+content+'</div>';
  }

'''
js = js[:history_index] + mobile_history_helper + js[history_index:]

history_start = js.index(history_marker)
history_end = js.index("  function renderStockUsageForm(){", history_start)
history_block = js[history_start:history_end]
return_start = history_block.index("    return '<section class=\"ops-card ops-v8-sales-history\">")
return_end = history_block.index("\n", return_start)
old_return = history_block[return_start:return_end]
if "'+toolbar+table+'" not in old_return:
    raise SystemExit("renderSalesHistoryV7 return marker not found")
new_return = "    const mobileCards=mobileSalesHistoryCards(rows);\n" + old_return.replace("'+toolbar+table+'", "'+toolbar+table+mobileCards+'", 1)
history_block = history_block[:return_start] + new_return + history_block[return_end:]
js = js[:history_start] + history_block + js[history_end:]

path.write_text(js, encoding="utf-8")

input_js_path = Path("operations-input-stability-v1.js")
input_js = input_js_path.read_text(encoding="utf-8")
input_js = input_js.replace("__YOUZI_INPUT_STABILITY_V1__", "__YOUZI_INPUT_STABILITY_V2__")
require_once(input_js, "    'posSearch',\n", "generic input stability posSearch")
input_js = input_js.replace("    'posSearch',\n", "", 1)
input_js_path.write_text(input_js, encoding="utf-8")

Path("operations-input-stability-v1.css").write_text(r'''/* 手機商品、進貨與盤點搜尋穩定化；現場銷售由 operations-mobile-pos-v4.css 管理。 */
@media (max-width:780px){
  html{scroll-behavior:auto!important}
  .ops-topbar{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
  .ops-mobile-search-pad{
    display:grid!important;
    grid-template-columns:repeat(5,minmax(0,1fr))!important;
    grid-auto-flow:row!important;
    gap:6px!important;
    margin:6px 0 10px!important;
    align-items:stretch!important;
  }
  .ops-mobile-search-pad button{
    width:100%!important;
    min-width:0!important;
    min-height:42px!important;
    padding:0 4px!important;
    border-radius:10px!important;
    font-size:16px!important;
    line-height:1!important;
    box-shadow:0 1px 4px rgba(18,48,65,.05)!important;
  }
  .ops-mobile-search-pad button:nth-child(10){grid-column:1 / 3!important;grid-row:3!important;font-size:13px!important}
  .ops-mobile-search-pad button:nth-child(11){grid-column:5!important;grid-row:2!important}
  .ops-mobile-search-pad button:nth-child(12){grid-column:3 / 6!important;grid-row:3!important;font-size:18px!important}
  .ops-product-toolbar{margin-bottom:6px!important}
  .ops-mobile-search-pad + .ops-inline-product-editor{margin-top:8px}
}
@media (max-width:420px){
  .ops-mobile-search-pad{gap:5px!important}
  .ops-mobile-search-pad button{min-height:40px!important;font-size:15px!important}
}
#productSearch,#purchaseEntrySearch,#stocktakeSearch,#inventorySearch,#purchaseLowSearch{font-variant-numeric:tabular-nums}
.ops-products-grid,.ops-product-text-list,.ops-purchase-entry-grid,.ops-stocktake-product-grid{overflow-anchor:none}
''', encoding="utf-8")

portal_path = Path("portal.html")
portal = portal_path.read_text(encoding="utf-8")
portal = portal.replace('<link rel="stylesheet" href="operations-input-stability-v1.css?v=20260803-input-stability-v3">','<link rel="stylesheet" href="operations-input-stability-v1.css?v=20260803-input-stability-v4">')
portal = portal.replace('<link rel="stylesheet" href="operations-mobile-pos-v3.css?v=20260803-mobile-pos-v3">','<link rel="stylesheet" href="operations-mobile-pos-v4.css?v=20260803-mobile-pos-v4">')
portal = portal.replace('<script src="operations-phase1.js?v=20260803-input-stability-v1"></script>','<script src="operations-phase1.js?v=20260803-mobile-pos-v4"></script>')
portal = portal.replace('<script src="operations-input-stability-v1.js?v=20260803-input-stability-v3"></script>','<script src="operations-input-stability-v1.js?v=20260803-input-stability-v4"></script>')
portal = portal.replace('  <script src="operations-mobile-pos-v3.js?v=20260803-mobile-pos-v3"></script>\n', '')
portal_path.write_text(portal, encoding="utf-8")

for obsolete in ["operations-mobile-pos-v3.css", "operations-mobile-pos-v3.js", "operations-pos-keypad-stability-v2.js"]:
    old = Path(obsolete)
    if old.exists():
        old.unlink()

Path("scripts/rebuild_mobile_pos_v4.py").unlink()
Path(".github/workflows/rebuild-mobile-pos-v4.yml").unlink()
