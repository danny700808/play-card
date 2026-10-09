'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('operations-phase1.js','utf8');
function setup(){
 const original={id:'old',externalOrderNo:'OLD',processingStatus:'manual-return-review',shipmentConfirmed:true,inventoryApplied:true,quantity:1,grossAmount:100};
 const rows=new Map([['old',{...original}],['duplicate',{...original,id:'duplicate'}],['active',{...original,id:'active',externalOrderNo:'ACTIVE',processingStatus:'inventory-applied'}]]);
 const ctx={state:{platformOrders:[...rows.values()]},COLLECTIONS:{platformOrders:'orders'},clean:v=>String(v||''),platformOrderGroupKey:r=>r.externalOrderNo,platformOrderHasReturn:r=>r.processingStatus==='manual-return-review',platformOrderIsCancelledState:()=>false,dedupePlatformOrders:rs=>rs.filter(r=>r.id!=='duplicate'),global:{confirm:()=>true},serverTimestamp:()=>123,userLabel:()=> 'manager',writeAudit:async()=>{},toast(){},loadAll:async()=>{ctx.state.platformOrders=[...rows.values()];}};
 ctx.state.db={collection(name){assert.equal(name,'orders');return {doc:id=>({id})};},async runTransaction(fn){const writes=[];await fn({get:async ref=>({exists:rows.has(ref.id),data:()=>({...rows.get(ref.id)})}),set:(ref,data,opts)=>{assert.equal(opts.merge,true);writes.push(()=>rows.set(ref.id,{...rows.get(ref.id),...data}));}});writes.forEach(fn=>fn());}};
 Object.assign(ctx,{lower:v=>String(v||'').toLowerCase(),PLATFORM_RETURN_KEYWORDS:['退貨','退款','refund','return'],platformOrderHasFulfillment:r=>r.shipmentConfirmed===true,openDrawer(){},closeDrawer(){}});
 vm.runInNewContext(source.slice(source.indexOf('function platformReturnRows('),source.indexOf('function platformReturnDispositionLabel(')),ctx);
 vm.runInNewContext(source.slice(source.indexOf('async function archivePlatformReturns('),source.indexOf('function renderSync(){')),ctx);
 return {rows,ctx,original};
}
test('archive hides old claims without adjusting stock, revenue or active orders, and can be restored',async()=>{
 const {rows,ctx,original}=setup();
 await ctx.archivePlatformReturns(false);await ctx.archivePlatformReturns(false,true);
 assert.equal(ctx.platformReturnRows(ctx.state.platformOrders).length,0);
 for(const id of ['old','duplicate']){
  assert.equal(rows.get(id).returnQueueArchived,true);
  for(const key of ['processingStatus','inventoryApplied','quantity','grossAmount'])assert.equal(rows.get(id)[key],original[key]);
 }
 assert.equal(rows.get('active').returnQueueArchived,undefined);
 assert.equal(ctx.platformReturnRows(ctx.state.platformOrders,true).length,1);
 const newer={...original,id:'new',externalOrderNo:'NEW'};rows.set('new',newer);ctx.state.platformOrders=[...rows.values()];
 assert.equal(ctx.platformReturnRows(ctx.state.platformOrders).length,1);
 await ctx.archivePlatformReturns(true);await ctx.archivePlatformReturns(true,true);
 assert.equal(ctx.platformReturnRows(ctx.state.platformOrders).length,2);
});

test('queue requires confirmed shipment plus platform claim and excludes received or unknown claims',()=>{
 const {ctx,original}=setup();
 const candidates=[
  {...original,id:'shipped-claim'},
  {...original,id:'unshipped',shipmentConfirmed:false},
  {...original,id:'unknown',shipmentConfirmed:false,processingStatus:'cancellation-review'},
  {...original,id:'completed',returnHandlingStatus:'completed'},
  {...original,id:'received',returnedReceivedAt:123},
  {...original,id:'active',processingStatus:'inventory-applied'},
  {...original,id:'platform-refund',processingStatus:'inventory-applied',paymentStatus:'refunded'},
  {...original,id:'note-only',processingStatus:'inventory-applied',note:'退貨'},
  {...original,id:'freight',processingStatus:'ignored-freight',orderStatus:'returned'},
  {...original,id:'archived',returnQueueArchived:true}
 ];
 assert.deepEqual(Array.from(ctx.platformReturnRows(candidates),r=>r.id),['shipped-claim','platform-refund']);
});

test('changed archive candidate set requires a fresh confirmation',async()=>{
 const {ctx,rows,original}=setup();await ctx.archivePlatformReturns(false);
 ctx.state.platformOrders.push({...original,id:'later',externalOrderNo:'LATER'});
 await assert.rejects(ctx.archivePlatformReturns(false,true),/案件清單已更新/);
 assert.equal(rows.get('old').returnQueueArchived,undefined);
});

test('loading stored orders preserves archive marker and platform receipt status',()=>{
 const {ctx}=setup();
 Object.assign(ctx,{firstNumber:(obj,keys)=>({value:Number(obj[keys[0]]||0)}),numberOrNull:v=>v==null?null:Number(v),dateFrom:v=>v?new Date(v):null});
 vm.runInNewContext(source.slice(source.indexOf('  function normalizePlatformOrder('),source.indexOf('  function normalizePlatformSyncRun(')),ctx);
 const loaded=ctx.normalizePlatformOrder({__id:'old',platform:'Coupang',returnQueueArchived:true,returnQueueArchivedAt:123,shipmentConfirmed:true,receiptStatus:'returns_completed',processingStatus:'manual-return-review'});
 assert.equal(loaded.returnQueueArchived,true);assert.equal(loaded.receiptStatus,'returns_completed');
 assert.equal(ctx.platformReturnRows([loaded]).length,0);
 assert.equal(ctx.platformReturnRows([loaded],true).length,1);
});
