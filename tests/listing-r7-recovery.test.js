const test=require('node:test');
const assert=require('node:assert/strict');
const p=require('../functions/productListingPublish')._test;
const policy=require('../functions/listingExecutionPolicy');
test('MOMO observed count does not assume the obsolete 1000 limit',()=>{
 const r=p.selectMomoCapacityRecoveryCandidate([{sku:'OTHER',listingId:'OTHER',status:'上架',stock:0,salesCount:0}],{sku:'NEW',stock:1},{currentActiveCount:1053,maximumListings:1000});
 assert.equal(r.required,false); assert.equal(r.candidate,null);
});
test('explicit quota restriction preserves unrelated goods without added authority',()=>{
 const r=p.selectMomoCapacityRecoveryCandidate([{sku:'OTHER',listingId:'OTHER',status:'上架',stock:0,salesCount:0}],{sku:'NEW',stock:1},{currentActiveCount:1053,platformQuotaError:true});
 assert.equal(r.required,true); assert.equal(r.candidate,null); assert.equal(r.action,'keep-same-draft-pending-record-platform-error');
});
test('normal logistics never downgrade an estimate or cap overweight data',()=>{
 assert.equal((p.selectedHsinchuSizeBand||p.hsinchuSizeBand)(178,'estimated'),'S180');
 const r=p.buildShopeeLogistics({packageLengthCm:150,packageWidthCm:50,packageHeightCm:30,packageWeightKg:30,packageMeasurementSource:'estimated'});
 assert.equal(r.methods.find(x=>x.label==='新竹物流').enabled,false);
 assert.equal(r.methods.find(x=>x.label==='賣家宅配：大型/超重物品運送').enabled,true);
});
test('r7 documents verified brand fallback, accepted-vs-reviewed and Slate recovery',()=>{
 const s=policy.instructions.join('\n');
 for(const text of ['其他／Other','此規則只適用品牌','CREATE_REQ_ACCEPTED','不超過35字','HTML原始碼','超過平台上限用自訂物流'])assert.ok(s.includes(text),text);
});
