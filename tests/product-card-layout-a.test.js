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
