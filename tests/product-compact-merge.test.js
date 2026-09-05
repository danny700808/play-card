const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../operations-phase1.js'),'utf8');
function part(a,b){return source.slice(source.indexOf('  function '+a+'('),source.indexOf('  function '+b+'('));}
test('merge retirement plan never retires keeper and only includes selected platforms',()=>{
 const products={a:{docId:'a',sku:'A',ids:{momo:'keep',shopee:'s1'}},b:{docId:'b',sku:'B',ids:{momo:'old',shopee:'s2'}},c:{docId:'c',sku:'C',ids:{momo:'keep'}}};
 const build=vm.runInNewContext(part('buildMergeLifecyclePlan','decorateMergeProductRows')+';buildMergeLifecyclePlan',{productListingTargetPlatforms:()=>['momo'],normalizeProductListingTargetScope:x=>x,productPlatformMappingId:(p,k)=>p.ids[k]||'',catalogById:id=>products[id]});
 const result=JSON.parse(JSON.stringify(build(products.a,[{productId:'b',sku:'B'},{productId:'c',sku:'C'}],'momo')));
 assert.deepEqual(result.platforms,[{platform:'momo',keepListingId:'keep',requiredSkus:['A','B','C'],retireListingIds:['old'],status:'awaiting-primary-verification'}]);
 assert.equal(result.retireOnlyAfterPrimaryVerified,true);assert.equal(result.preserveCentralProducts,true);assert.equal(result.deleteOriginalImages,false);
});
test('optional instruction wrapper preserves balanced workspace and fields',()=>{
 const compact=vm.runInNewContext(part('compactListingSourceHtml','productCompactListingActions')+';compactListingSourceHtml');
 assert.equal(compact('<div><p>photos</p><div class="ops-listing-instruction-grid"><textarea name="instructions"></textarea></div></div>'),'<div><p>photos</p><details class="ops-optional-image-instructions"><summary>文字與圖片修改要求</summary><div class="ops-listing-instruction-grid"><textarea name="instructions"></textarea></div></details></div>');
});
test('five modes, separate reorder gestures, persisted gallery choices and final submit',()=>{
 const form=part('productListingCaseFormHtml','compactListingSourceHtml');
 assert.ok(form.indexOf('② 商品與圖片')<form.indexOf('③ 介紹與必要資料'));
 assert.ok(form.indexOf('③ 介紹與必要資料')<form.indexOf('④ 上架通路與送出'));
 assert.ok(source.includes("choice('add-variant','加入既有細項')"));
 assert.ok(source.includes('application/x-youzi-merge-product'));assert.ok(source.includes('application/x-youzi-variant-image'));
 assert.ok(source.includes('requestedHost.dataset.openRequest!==requestToken'));
 assert.ok(source.includes('galleryDisplayOrder:raw.galleryDisplayOrder||[]'));
 assert.ok(source.includes('retireOnlyAfterPrimaryVerified:true'));
});
