const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../operations-phase1.js'),'utf8');
function part(a,b){return source.slice(source.indexOf('  '+a),source.indexOf('  '+b));}
test('existing image assignment is atomic, same-product only and does not edit original images',async()=>{
 const p={docId:'one',sku:'SKU',imageUrls:['photo'],physicalImageUrls:[]};let writes=[],urls=[],processing=false;
 const ctx={clean:x=>x,safeUrl:x=>x,catalogById:id=>id==='one'?p:null,productEditorImages:()=>p.imageUrls,requireEasyStoreManagerAuth:async()=>{},fieldValue:()=>({arrayUnion:x=>x}),PRODUCT_PHYSICAL_IMAGE_MAX:2,serverTimestamp:()=>1,userLabel:()=>'',VERSION:'test',upsertProductMediaQueueState:()=>{},loadProductMediaReceipt:async()=>{},toast:()=>{},state:{db:{collection:name=>({doc:id=>({name,id})}),runTransaction:async fn=>fn({get:async ref=>({exists:true,data:()=>({physicalImageUrls:urls,mediaQueueStatus:processing?'processing':''})}),set:(ref,value)=>writes.push({ref,value})})}}};
 ctx.COLLECTIONS={listingCases:'cases',products:'products'};
 vm.createContext(ctx);vm.runInContext(part('async function assignExistingPhysicalPhoto(','async function uploadPhysicalProductPhoto('),ctx);
 await assert.rejects(ctx.assignExistingPhysicalPhoto('one','foreign'),/自己的/);assert.equal(writes.length,0);
 await ctx.assignExistingPhysicalPhoto('one','photo');assert.equal(writes.length,2);assert.deepEqual(p.imageUrls,['photo']);
 for(const w of writes){assert.equal(w.value.physicalImageUrls,'photo');assert.ok(!('imageUrls' in w.value));assert.ok(!('physicalImagePlatformResults' in w.value));assert.equal(w.value.physicalImages.source,'existing-product-image');}
 urls=['photo'];writes=[];await ctx.assignExistingPhysicalPhoto('one','photo');assert.equal(writes.length,0);
 urls=[];processing=true;await assert.rejects(ctx.assignExistingPhysicalPhoto('one','photo'),/正在處理/);
});
test('missing source receipts require platform comparison before upload',()=>{
 const ctx={};vm.createContext(ctx);vm.runInContext(part('function productMediaResumePlan(','function productMediaBatchPrompt('),ctx);
 const plan=ctx.productMediaResumePlan({physicalImageUrls:['old','new'],physicalImagePlatformResults:{shopee:{status:'completed',sourceImageUrls:['old']}}});
 const shopee=plan.find(x=>x.platform==='shopee');assert.deepEqual(Array.from(shopee.physicalImageUrls),['new']);assert.equal(shopee.verifyExistingPhotosFirst,true);
 assert.ok(source.includes('無法確認時保留待核對'));assert.ok(source.includes('application/x-youzi-physical-photo'));assert.ok(source.includes('data-physical-dropzone'));
});
