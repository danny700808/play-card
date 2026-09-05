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
  assert.ok(html.includes('operations-catalog-layout-a.css?v=20260905-compact-five-v2'));
 }
});
test('desktop stock sits right of barcode printing on the same row below SKU',()=>{
 const css=fs.readFileSync(require('node:path').join(__dirname,'../operations-catalog-layout-a.css'),'utf8');
 const desktop=css.slice(css.indexOf('@media(min-width:1024px)'));
 assert.match(desktop,/\.ops-product-sku-main\{display:contents\}/);
 assert.match(desktop,/\.ops-product-sku-main>b\{grid-column:1\/-1;grid-row:1;/);
 assert.match(desktop,/\.ops-label-print-button\{grid-column:1;grid-row:2;/);
 assert.match(desktop,/\.ops-product-inline-stock\{grid-column:2;grid-row:2;/);
});
