'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('operations-phase1.js','utf8');
const start=source.indexOf('async function savePlatformReturn(');
const end=source.indexOf('function renderSync()',start);
assert(start>=0&&end>start);
function setup(extra={}) {
 const order={id:'o',productId:'p',quantity:2,costTotal:60,inventoryApplied:true,processingStatus:'manual-return-review',...extra};
 const rows=new Map([['orders/o',order],['products/p',{currentStock:8}]]);
 let counter=0,serial=Promise.resolve();const sync=[];
 const db={collection:name=>({doc:id=>({path:name+'/'+(id||++counter)})}),runTransaction(fn){const result=serial.then(async()=>{const writes=[];await fn({get:async ref=>({exists:rows.has(ref.path),data:()=>({...rows.get(ref.path)})}),set:(ref,data)=>writes.push(()=>rows.set(ref.path,{...rows.get(ref.path),...data}))});writes.forEach(fn=>fn());});serial=result.catch(()=>{});return result;}};
 const ctx={state:{db,platformOrders:[{...order}]},COLLECTIONS:{platformOrders:'orders',products:'products',inventory:'inventory'},FormData:class{constructor(form){this.form=form;}get(k){return this.form[k];}},clean:v=>String(v??'').trim(),serverTimestamp:()=>1,userLabel:()=> 'test',VERSION:'test',global:{YouziInventoryAverageCost:{snapshot:()=>({layers:[],averageCost:30,inventoryValue:300,costIncomplete:false})}},queueInventorySyncInTransaction(){},platformReturnDispositionLabel:v=>v,writeAudit:async()=>{},closeDrawer(){},toast(){},loadAll:async()=>{},openPlatformOrderDetail(){},platformOrderGroupKey:()=> 'o'};
 vm.runInNewContext(source.slice(start,end),ctx);
 ctx.queueInventorySyncInTransaction=(...args)=>sync.push(args.slice(1));
 return {rows,sync,save:(disposition,quantity=2)=>ctx.savePlatformReturn({dataset:{id:'o'},disposition,quantity})};
}
test('waiting for physical receipt never increases sellable inventory',async()=>{const x=setup();await x.save('waiting');assert.equal(x.rows.get('products/p').currentStock,8);assert.equal(x.rows.get('orders/o').returnHandlingStatus,'waiting-return');});
test('two stale manual return submissions restock only once',async()=>{const x=setup();const results=await Promise.allSettled([x.save('restock'),x.save('restock')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(x.rows.get('products/p').currentStock,10);await assert.rejects(x.save('waiting'));});
test('unknown cancellation cannot be converted to waiting and bypass review',async()=>{const x=setup({processingStatus:'cancellation-review'});await assert.rejects(x.save('waiting'));await assert.rejects(x.save('restock'));assert.equal(x.rows.get('products/p').currentStock,8);});
test('manual receipt cannot restock quantities already cancelled automatically',async()=>{const x=setup({cancellationRestockedQuantity:1});await assert.rejects(x.save('restock',2));await x.save('restock',1);assert.equal(x.rows.get('products/p').currentStock,9);});

test('ordinary deducted order can be returned and queues restored stock',async()=>{
 const x=setup({processingStatus:'inventory-applied',sku:'SKU'});
 await x.save('restock');
 assert.equal(x.rows.get('products/p').currentStock,10);
 assert.equal(x.rows.get('orders/o').returnHandlingStatus,'completed');
 assert.equal(x.rows.get('orders/o').processingStatus,'return-processed');
 assert.equal(x.sync.length,1);
 assert.deepEqual(x.sync[0],['p','SKU',10,'platformReturn']);
});

test('return list renders with rows and normal orders expose manual return',()=>{
 const row={id:'o',platform:'MOMO',productId:'p',quantity:2,inventoryApplied:true,orderedAt:'2026-10-09',externalOrderNo:'O1',productName:'Sample'};
 const ctx={state:{platformOrders:[row],platformOrderIssueFilter:'returns',platformOrderPlatform:'all',platformOrderSearch:'',platformSyncRuns:[],platformOrderMonth:'2026-10',platformOrderRange:'all'},clean:v=>String(v??'').trim(),lower:v=>String(v??'').toLowerCase(),platformOrderSkipsInventory:()=>false,platformOrderBounds:()=>({}),platformReturnRows:r=>r,visiblePlatformOrders:r=>r,platformOrderIsEffective:()=>false,dateFrom:v=>v?new Date(v):null,platformFeeMetrics:()=>({perRow:new Map()}),sum:(r,f)=>r.reduce((a,x)=>a+Number(f(x)||0),0),platformOrderGroupKey:r=>r.externalOrderNo,platformOrderFirstDate:r=>r[0].orderedAt,dateText:()=> '2026-10-09',attr:String,escapeHtml:String,platformOrderDateKey:()=> '2026-10-09',todayDateKey:()=> '2026-10-09',formatNumber:String,money:String,statusTag:String,platformOrderGross:()=>100,platformOrderCost:()=>30,platformOrderPlacedAtText:()=> '2026-10-09',kpi:()=>'',emptyHtml:()=>''};
 ctx.platformOrderIsCancelledState=()=>false;
 ctx.platformOrderIsCustomerCancelled=()=>false;
 ctx.platformOrderListRows=rows=>rows;
 vm.runInNewContext(source.slice(source.indexOf('function platformOrderCanReturn('),source.indexOf('function openPlatformOrderReturn(')),ctx);
 vm.runInNewContext(source.slice(source.indexOf('function renderSync(){'),source.indexOf('  function renderConnection(){')),ctx);
 const html=ctx.renderSync();assert.match(html,/退貨待處理/);assert.match(html,/platform-order-return/);
 assert.equal(ctx.platformOrderCanReturn({...row,returnHandlingStatus:'completed'}),false);
 assert.equal(ctx.platformOrderCanReturn({...row,inventoryApplied:false}),false);
 assert.equal(ctx.platformOrderCanReturn({...row,processingStatus:'cancellation-review'}),false);
 ctx.state.platformOrderIssueFilter='all';ctx.platformOrderIsCustomerCancelled=()=>true;ctx.platformOrderIsCancelledState=()=>true;
 const cancelled=ctx.renderSync();assert.match(cancelled,/客戶取消/);assert.doesNotMatch(cancelled,/data-action="platform-order-return"/);assert.match(cancelled,/<td class="num">0<\/td>/);
});

test('confirmed unshipped cancellations remain visible but never count as effective sales',()=>{
 const ctx={clean:v=>String(v||''),platformOrderHasFulfillment:r=>r.shipmentConfirmed===true,platformOrderIsCancelledState:r=>['ignored-cancelled','inventory-reversed'].includes(r.processingStatus),platformOrderHasReliableOrderDate:r=>!!r.orderedAt,dedupePlatformOrders:r=>r,platformOrderIsHidden:r=>r.processingStatus!=='inventory-applied',platformOrderHasReturn:r=>r.processingStatus==='manual-return-review'};
 vm.runInNewContext(source.slice(source.indexOf('function platformOrderIsCustomerCancelled('),source.indexOf('function platformOrderNeedsAttention(')),ctx);
 const active={id:'active',processingStatus:'inventory-applied',orderedAt:'2026-10-09'};
 const cancelled={id:'cancelled',processingStatus:'inventory-reversed',orderedAt:'2026-10-09',reversalApplied:true};
 const beforeSync={...cancelled,id:'never-deducted',processingStatus:'ignored-cancelled'};
 const shipped={...cancelled,id:'shipped',shipmentConfirmed:true};
 const pending={...cancelled,id:'pending',processingStatus:'cancellation-review'};
 assert.deepEqual(Array.from(ctx.platformOrderListRows([active,cancelled,beforeSync,shipped,pending]),r=>r.id),['active','cancelled','never-deducted']);
 assert.equal(ctx.platformOrderIsEffective(cancelled),false);assert.equal(ctx.platformOrderIsEffective(beforeSync),false);
});
