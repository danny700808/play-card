const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('operations-phase1.js','utf8');
function extract(name){const start=src.search(new RegExp('  (?:async )?function '+name+'\\('));return src.slice(start,src.indexOf('\n  }',start)+4);}
function setup(){
 const raw={imageUrl:'old',imageUrls:['old','new'],currentStock:2,averageCost:1015,updatedAt:123};
 const product={docId:'p',sku:'RD',imageUrl:'old',imageUrls:['old','new'],internal:raw};
 const ctx={Set,clean:x=>x,safeUrl:x=>x||'',PRODUCT_REFERENCE_IMAGE_MAX:20,normalizeProductResearchSourceUrls:x=>[...new Set(x||[])],catalogById:()=>product,COLLECTIONS:{products:'products'},serverTimestamp:()=>456,userLabel:()=> 'tester',writeAudit:async()=>{},toast:()=>{},refreshProductInlineMedia:()=>{},mergeCatalog:()=>{},state:{internalProducts:[raw],db:{collection:()=>({doc:()=>({})}),runTransaction:async fn=>fn({get:async()=>({exists:true,data:()=>raw}),set:(ref,payload)=>Object.assign(raw,payload)})}}};
 vm.createContext(ctx);vm.runInContext(extract('productEditorImages')+'\n'+extract('archiveProductMasterImage'),ctx);return {ctx,raw,product};
}
test('removal is reversible and preserves image binaries, inventory and cost baseline',async()=>{
 const {ctx,raw,product}=setup();await ctx.archiveProductMasterImage('p','old',false);
 assert.deepEqual(Array.from(ctx.productEditorImages(product)),['new']);
 assert.deepEqual(raw.imageUrls,['old','new']);assert.equal(raw.updatedAt,123);assert.equal(raw.currentStock,2);assert.equal(raw.averageCost,1015);
 await ctx.archiveProductMasterImage('p','old',true);assert.deepEqual(Array.from(ctx.productEditorImages(product)),['old','new']);
});
test('removing twice is idempotent and restoring one image preserves others in archive',async()=>{
 const {ctx,raw}=setup();await ctx.archiveProductMasterImage('p','old',false);await ctx.archiveProductMasterImage('p','old',false);await ctx.archiveProductMasterImage('p','new',false);
 assert.deepEqual(Array.from(raw.archivedProductImageUrls),['old','new']);await ctx.archiveProductMasterImage('p','old',true);assert.deepEqual(Array.from(raw.archivedProductImageUrls),['new']);
});

