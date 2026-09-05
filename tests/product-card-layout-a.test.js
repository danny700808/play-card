const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../operations-phase1.js'),'utf8');
const code=source.slice(source.indexOf('  function productCard(p)'),source.indexOf('  function productTextRow(p)'));
const render=vm.runInNewContext(code+'\nproductCard',{clean:v=>String(v||''),attr:v=>String(v||''),escapeHtml:v=>String(v||''),formatNumber:v=>v,money:v=>v,state:{},productNeedsEasyStoreVariantImage:()=>false,productPlatformStatusHtml:()=>'<footer>platforms</footer>'});
test('A shows one variant image and preserves data; platforms last',()=>{
 const html=render({docId:'x',sku:'2040934',name:'音箱',variantImageUrls:['variant','other'],parentImageUrls:['parent'],imageUrls:['general'],currentStock:3});
 assert.equal((html.match(/<img /g)||[]).length,1);
 assert.ok(html.includes('src="variant"'));
 assert.ok(!html.includes('準備上架'));
 assert.ok(html.includes('列印條碼'));
 assert.ok(html.indexOf('platforms')>html.indexOf('平均成本'));
});
test('A leaves missing images empty rather than inventing a cover',()=>{
 const html=render({docId:'x',sku:'123',name:'無圖商品'});
 assert.ok(html.includes('無圖'));
 assert.ok(!html.includes('<img '));
});
test('compact desktop catalogue uses five columns without changing mobile rules',()=>{
 const css=fs.readFileSync(require('node:path').join(__dirname,'../operations-catalog-layout-a.css'),'utf8');
 const desktop=css.slice(css.indexOf('@media(min-width:1024px)'));
 assert.ok(desktop.startsWith('@media(min-width:1024px)'));
 assert.match(desktop,/\.ops-products-grid\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
 assert.match(desktop,/grid-template-rows:116px 1fr auto/);
 assert.match(desktop,/white-space:normal;overflow:visible;text-overflow:clip/);
 for(const entry of ['portal.html','operations-hub.html']){
  const html=fs.readFileSync(require('node:path').join(__dirname,'../',entry),'utf8');
  assert.ok(html.includes('operations-catalog-layout-a.css?v=20260905-queue-folders-v6'));
 }
});
test('desktop SKU, barcode action and stock all occupy the same row',()=>{
 const css=fs.readFileSync(require('node:path').join(__dirname,'../operations-catalog-layout-a.css'),'utf8');
 const desktop=css.slice(css.indexOf('@media(min-width:1024px)'));
 assert.match(desktop,/\.ops-product-sku-main\{display:contents\}/);
 assert.match(desktop,/\.ops-product-sku-main>b\{grid-column:1;grid-row:1;/);
 assert.match(desktop,/\.ops-label-print-button\{grid-column:2;grid-row:1;/);
 assert.match(desktop,/\.ops-product-inline-stock\{grid-column:3;grid-row:1;/);
});
const formSource=source.slice(source.indexOf('  function productFormHtml('),source.indexOf('  function listingCaseValue('));
const formContext={attr:v=>String(v==null?'':v).replaceAll('&','&amp;').replaceAll('"','&quot;'),escapeHtml:v=>String(v||''),formatNumber:v=>v,productImagePanelHtml:()=>'<div>images</div>',productInlineMediaHtml:()=>'<div>three media columns</div>'};
const renderForm=vm.runInNewContext(formSource+'\nproductFormHtml',formContext);
test('editor A hides unwanted fields without losing their saved values',()=>{
 const html=renderForm({docId:'x',sku:'2040934',originalName:'音箱',storePrice:1500,easyStorePrice:1580,momoPrice:1680,coupangPrice:1600,internal:{brand:'M-VAVE',model:'Combo',barcode:'01234',category:'音箱',status:'inactive',note:'原備註'}});
 for(const [key,value] of Object.entries({brand:'M-VAVE',model:'Combo',barcode:'01234',category:'音箱',status:'inactive',note:'原備註'}))assert.ok(html.includes('type="hidden" name="'+key+'" value="'+value+'"'));
 for(const label of ['品牌','型號','國際條碼／GTIN','分類','狀態','備註','共同網路售價'])assert.ok(!html.includes('<label>'+label+'</label>'));
 assert.ok(!html.includes('重新套用到三平台'));
 assert.ok(html.includes('value="1580"')&&html.includes('value="1680"')&&html.includes('value="1600"'));
 assert.ok(html.indexOf('</form>')<html.indexOf('id="productInlineListing"'));
 assert.ok(html.includes('ops-product-identity-fields'));
});
test('editing store price fans out on user input, not when opening a product',()=>{
 const fields=[{value:'1580',dataset:{priceOverride:'1'}},{value:'1680',dataset:{priceOverride:'1'}},{value:'1600',dataset:{priceOverride:'1'}}];
 const shared={value:'1500'},form={};
 const functions=source.slice(source.indexOf('  function applySharedOnlinePrice('),source.indexOf('  function markPlatformPriceOverride('));
 const apply=vm.runInNewContext(functions+'\napplyStorePriceToPlatforms',{query:()=>shared,queryAll:()=>fields});
 assert.deepEqual(fields.map(x=>x.value),['1580','1680','1600']);
 apply({closest:()=>form,value:'1800',validity:{valid:true}});
 assert.deepEqual(fields.map(x=>x.value),['1800','1800','1800']);
 assert.ok(fields.every(x=>x.dataset.priceOverride==='0'));
 fields[1].value='1900';assert.equal(fields[0].value,'1800');
 apply({closest:()=>form,value:'',validity:{valid:true}});assert.equal(fields[1].value,'1900');
 assert.ok(source.includes('const initializingPlatformPrices=!p;'));
});
test('inline listing reads the case without rebuilding product images or nesting forms',()=>{
 assert.ok(source.includes('ensureInlineProductListing();'));
 assert.ok(source.includes('if(!inline&&completedProductImageUrls(row).length)'));
 assert.ok(source.includes("form.dataset.inline='1'"));
 assert.ok(source.includes('byId(\'productInlineListing\')!==requestedHost'));
 assert.ok(source.includes('replacement.replaceWith(oldEditor)'));
 assert.ok(source.includes('await saveProduct(master,{keepOpen:true})'));
});
