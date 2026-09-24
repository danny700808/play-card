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
 let counter=0,serial=Promise.resolve();
 const db={collection:name=>({doc:id=>({path:name+'/'+(id||++counter)})}),runTransaction(fn){const result=serial.then(async()=>{const writes=[];await fn({get:async ref=>({exists:rows.has(ref.path),data:()=>({...rows.get(ref.path)})}),set:(ref,data)=>writes.push(()=>rows.set(ref.path,{...rows.get(ref.path),...data}))});writes.forEach(fn=>fn());});serial=result.catch(()=>{});return result;}};
 const ctx={state:{db,platformOrders:[{...order}]},COLLECTIONS:{platformOrders:'orders',products:'products',inventory:'inventory'},FormData:class{constructor(form){this.form=form;}get(k){return this.form[k];}},clean:v=>String(v??'').trim(),serverTimestamp:()=>1,userLabel:()=> 'test',VERSION:'test',global:{YouziInventoryAverageCost:{snapshot:()=>({layers:[],averageCost:30,inventoryValue:300,costIncomplete:false})}},queueInventorySyncInTransaction(){},platformReturnDispositionLabel:v=>v,writeAudit:async()=>{},closeDrawer(){},toast(){},loadAll:async()=>{},openPlatformOrderDetail(){},platformOrderGroupKey:()=> 'o'};
 vm.runInNewContext(source.slice(start,end),ctx);
 return {rows,save:(disposition,quantity=2)=>ctx.savePlatformReturn({dataset:{id:'o'},disposition,quantity})};
}
test('waiting for physical receipt never increases sellable inventory',async()=>{const x=setup();await x.save('waiting');assert.equal(x.rows.get('products/p').currentStock,8);assert.equal(x.rows.get('orders/o').returnHandlingStatus,'waiting-return');});
test('two stale manual return submissions restock only once',async()=>{const x=setup();const results=await Promise.allSettled([x.save('restock'),x.save('restock')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(x.rows.get('products/p').currentStock,10);await assert.rejects(x.save('waiting'));});
test('unknown cancellation cannot be converted to waiting and bypass review',async()=>{const x=setup({processingStatus:'cancellation-review'});await assert.rejects(x.save('waiting'));await assert.rejects(x.save('restock'));assert.equal(x.rows.get('products/p').currentStock,8);});
test('manual receipt cannot restock quantities already cancelled automatically',async()=>{const x=setup({cancellationRestockedQuantity:1});await assert.rejects(x.save('restock',2));await x.save('restock',1);assert.equal(x.rows.get('products/p').currentStock,9);});
