'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');

const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(request==='firebase-functions/v2/https')return {onCall:function(){},onRequest:function(){},HttpsError:class HttpsError extends Error{}};
  if(request==='firebase-functions/v2/scheduler')return {onSchedule:function(){}};
  if(request==='firebase-functions/params')return {defineSecret:function(name){return {name:name,value:function(){return '';}};}};
  if(request==='firebase-admin')return {apps:[],initializeApp:function(){},firestore:Object.assign(function(){return {};},{Timestamp:{fromDate:function(value){return value;},fromMillis:function(value){return value;}},FieldValue:{serverTimestamp:function(){return 'SERVER_TIMESTAMP';},delete:function(){return 'DELETE';}}})};
  return originalLoad.call(this,request,parent,isMain);
};
const sync=require('../platformOrderSync')._test;
Module._load=originalLoad;

test('MOMO official API date is never replaced by order-number inference',function(){
  const line=sync.normalizeLine({platform:'MOMO',externalOrderId:'66071500721372',externalOrderNo:'66071500721372',externalLineId:'A',sku:'SKU-1',quantity:1,unitPrice:100,orderedAt:'2026-08-02T10:30:00+08:00',orderDateSource:'momo-api-order-date'});
  assert.equal(line.orderDateSource,'momo-api-order-date');
  assert.equal(line.orderedAt.toISOString(),'2026-08-02T02:30:00.000Z');
  assert.equal(line.orderTimeEstimated,false);
});

test('MOMO order number is used only when official date is absent',function(){
  const line=sync.normalizeLine({platform:'MOMO',externalOrderId:'66071500721372',externalOrderNo:'66071500721372',externalLineId:'A',sku:'SKU-1',quantity:1,unitPrice:100,orderDateSource:'missing',syncReferenceAt:'2026-07-18T12:00:00+08:00'});
  assert.equal(line.orderDateSource,'momo-order-number-inferred');
  assert.equal(line.orderedAt.toISOString().slice(0,10),'2026-07-14');
  // UTC date is the previous calendar day because inferred Taiwan midnight is +08:00.
  assert.equal(line.orderTimeEstimated,true);
});

test('ambiguous fallback duplicates stop automatic inventory instead of summing observations',function(){
  const base={platform:'MOMO',externalOrderId:'ORDER-1',externalOrderNo:'ORDER-1',sku:'SKU-1',productName:'同商品',unitPrice:100,orderedAt:'2026-07-18T10:00:00+08:00',orderDateSource:'momo-api-order-date'};
  const first=sync.normalizeLine(Object.assign({},base,{quantity:1,grossAmount:100}));
  const second=sync.normalizeLine(Object.assign({},base,{quantity:2,grossAmount:200}));
  assert.equal(first.id,second.id);
  const result=sync.collapseFallbackLines([first,second]);
  assert.equal(result.length,1);
  assert.equal(result[0].quantity,2);
  assert.equal(result[0].grossAmount,200);
  assert.equal(result[0].identityAmbiguous,true);
});

test('official detail ID retries replace instead of doubling quantity',function(){
  const base={platform:'EasyStore',externalOrderId:'ORDER-2',externalOrderNo:'ORDER-2',externalLineId:'DETAIL-1',sku:'SKU-2',productName:'商品',unitPrice:50,orderedAt:'2026-07-18T10:00:00+08:00',orderDateSource:'easystore-created-at'};
  const result=sync.collapseFallbackLines([sync.normalizeLine(Object.assign({},base,{quantity:1})),sync.normalizeLine(Object.assign({},base,{quantity:2}))]);
  assert.equal(result.length,1);
  assert.equal(result[0].quantity,2);
});

test('fallback ID stays stable across SKU correction when platform product ID exists',function(){
  const base={platform:'MOMO',externalOrderId:'ORDER-3',externalOrderNo:'ORDER-3',productName:'商品',variantName:'紅色',platformIds:{productId:'GOODS-9',variantId:'RED'},quantity:1,unitPrice:100,orderedAt:'2026-07-18T10:00:00+08:00',orderDateSource:'momo-api-order-date'};
  const before=sync.normalizeLine(Object.assign({},base,{sku:'WRONG-SKU'}));
  const after=sync.normalizeLine(Object.assign({},base,{sku:'RIGHT-SKU'}));
  assert.equal(before.id,after.id);
});

test('fallback ID stays stable across product-name correction when platform IDs exist',function(){
  const base={platform:'MOMO',externalOrderId:'ORDER-4',externalOrderNo:'ORDER-4',sku:'SKU-4',platformIds:{productId:'GOODS-10',variantId:'BLUE'},quantity:1,unitPrice:100,orderedAt:'2026-07-18T10:00:00+08:00',orderDateSource:'momo-api-order-date'};
  const before=sync.normalizeLine(Object.assign({},base,{productName:'舊名稱',variantName:'藍色'}));
  const after=sync.normalizeLine(Object.assign({},base,{productName:'新名稱',variantName:'天空藍'}));
  assert.equal(before.id,after.id);
});

test('positive inventory delta offsets negative stock before creating FIFO layers',function(){
  const plusThree=sync.addPositiveInventoryDelta({currentStock:-5,costLayers:[]},3,10,{referenceId:'P1'});
  assert.equal(plusThree.after,-2);
  assert.equal(plusThree.layerQuantity,0);
  assert.deepEqual(plusThree.layers,[]);
  const plusEight=sync.addPositiveInventoryDelta({currentStock:-5,costLayers:[]},8,10,{referenceId:'P2'});
  assert.equal(plusEight.after,3);
  assert.equal(plusEight.layerQuantity,3);
  assert.equal(plusEight.layers[0].qtyRemaining,3);
});

test('applied inventory tracks quantity and product deltas, not only a boolean',function(){
  assert.deepEqual(sync.inventoryApplicationDelta({inventoryApplied:true,appliedQuantity:1,appliedProductId:'P1'},3,'P1'),{previousQuantity:1,previousProductId:'P1',nextQuantity:3,nextProductId:'P1',quantityDelta:2,productChanged:false,inventoryChanged:true});
  assert.equal(sync.inventoryApplicationDelta({inventoryApplied:true,quantity:3,productId:'P1'},3,'P2').productChanged,true);
});

test('legacy applied orders recover the actual quantity and product from the inventory ledger',function(){
  const snapshot=sync.appliedInventorySnapshot({inventoryApplied:true,quantity:5,productId:'STALE'},{qtyChange:-2,productId:'P1'});
  assert.equal(snapshot.appliedQuantity,2);
  assert.equal(snapshot.appliedProductId,'P1');
  assert.equal(snapshot.appliedSnapshotReliable,true);
  assert.equal(sync.inventoryApplicationDelta(snapshot,5,'P1').quantityDelta,3);
});

test('legacy applied orders without a reliable ledger are never auto-corrected',function(){
  const snapshot=sync.appliedInventorySnapshot({inventoryApplied:true,quantity:3,productId:'P1'},{});
  assert.equal(snapshot.appliedSnapshotReliable,false);
});

test('completed or inventory-applied returns block cancellation even when legacy quantity is missing',function(){
  assert.equal(sync.hasProcessedReturn({returnHandlingStatus:'completed',returnQuantity:0}),true);
  assert.equal(sync.hasProcessedReturn({returnInventoryApplied:true}),true);
  assert.equal(sync.hasProcessedReturn({returnHandlingStatus:'waiting-return',returnQuantity:2}),false);
});

test('legacy fallback matching never binds same-name rows with different SKUs',function(){
  assert.equal(sync.legacyFallbackIdentityDecision({sku:'SKU-A',productName:'同名',variantName:''},{sku:'SKU-B',productName:'同名',variantName:''}),'different');
  assert.equal(sync.legacyFallbackIdentityDecision({sku:'SKU-A',productName:'同名'},{sku:'SKU-A',productName:'改名'}),'match');
  assert.equal(sync.legacyFallbackIdentityDecision({sku:'',productName:'同名',variantName:'紅'},{sku:'',productName:'同名',variantName:'紅'}),'match');
  assert.equal(sync.legacyFallbackIdentityDecision({sku:'',productName:'同名'},{sku:'SKU-A',productName:'同名'}),'ambiguous');
});

test('different fallback IDs are new lines only when stable platform identities prove they differ',function(){
  assert.equal(sync.fallbackLineRelation({platformIds:{productId:'P',variantId:'V1'}},{platformIds:{productId:'P',variantId:'V2'}}),'distinct');
  assert.equal(sync.fallbackLineRelation({sku:'OLD',productName:'舊名'},{sku:'NEW',productName:'新名'}),'ambiguous');
  assert.equal(sync.fallbackLineRelation({platformIds:{productId:'P'}},{platformIds:{productId:'P'}}),'ambiguous');
  assert.equal(sync.fallbackLineRelation({platformIds:{productId:'P'}},{platformIds:{productId:'P',variantId:'V'}}),'ambiguous');
  assert.equal(sync.fallbackLineRelation({platformIds:{variantId:'V'}},{platformIds:{productId:'P',variantId:'V'}}),'ambiguous');
});

test('legacy order lookup fails closed when the query reaches its safety limit',function(){
  assert.equal(sync.queryReachedSafetyLimit(49,50),false);
  assert.equal(sync.queryReachedSafetyLimit(50,50),true);
  assert.equal(sync.queryReachedSafetyLimit(51,50),true);
});

test('only the run that owns a lock may release it',function(){
  assert.equal(sync.lockRunMatches('RUN-A','RUN-A'),true);
  assert.equal(sync.lockRunMatches('RUN-B','RUN-A'),false);
});

test('missing-from-platform is review-only even after fulfillment',function(){
  const policy=sync.missingOrderReconciliationPolicy({shippedAt:'2026-07-18T10:00:00+08:00'},9);
  assert.equal(policy.action,'review-only');
  assert.equal(policy.fulfilled,true);
  assert.match(policy.message,/保留庫存扣除/);
});
