'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('operations-phase1.js','utf8');
function setup(){
 const original={id:'old',externalOrderNo:'OLD',processingStatus:'manual-return-review',inventoryApplied:true,quantity:1,grossAmount:100};
 const rows=new Map([['old',{...original}],['duplicate',{...original,id:'duplicate'}],['active',{...original,id:'active',externalOrderNo:'ACTIVE',processingStatus:'inventory-applied'}]]);
 const ctx={state:{platformOrders:[...rows.values()]},COLLECTIONS:{platformOrders:'orders'},clean:v=>String(v||''),platformOrderGroupKey:r=>r.externalOrderNo,platformOrderHasReturn:r=>r.processingStatus==='manual-return-review',platformOrderIsCancelledState:()=>false,dedupePlatformOrders:rs=>rs.filter(r=>r.id!=='duplicate'),global:{confirm:()=>true},serverTimestamp:()=>123,userLabel:()=> 'manager',writeAudit:async()=>{},toast(){},loadAll:async()=>{ctx.state.platformOrders=[...rows.values()];}};
 ctx.state.db={collection(name){assert.equal(name,'orders');return {doc:id=>({id})};},async runTransaction(fn){const writes=[];await fn({get:async ref=>({exists:rows.has(ref.id),data:()=>({...rows.get(ref.id)})}),set:(ref,data,opts)=>{assert.equal(opts.merge,true);writes.push(()=>rows.set(ref.id,{...rows.get(ref.id),...data}));}});writes.forEach(fn=>fn());}};
 vm.runInNewContext(source.slice(source.indexOf('function platformReturnRows('),source.indexOf('function platformReturnDispositionLabel(')),ctx);
 vm.runInNewContext(source.slice(source.indexOf('async function archivePlatformReturns('),source.indexOf('function renderSync(){')),ctx);
 return {rows,ctx,original};
}
test('archive hides old claims without adjusting stock, revenue or active orders, and can be restored',async()=>{
 const {rows,ctx,original}=setup();
 await ctx.archivePlatformReturns(false);
 assert.equal(ctx.platformReturnRows(ctx.state.platformOrders).length,0);
 for(const id of ['old','duplicate']){
  assert.equal(rows.get(id).returnQueueArchived,true);
  for(const key of ['processingStatus','inventoryApplied','quantity','grossAmount'])assert.equal(rows.get(id)[key],original[key]);
 }
 assert.equal(rows.get('active').returnQueueArchived,undefined);
 assert.equal(ctx.platformReturnRows(ctx.state.platformOrders,true).length,1);
 const newer={...original,id:'new',externalOrderNo:'NEW'};rows.set('new',newer);ctx.state.platformOrders=[...rows.values()];
 assert.equal(ctx.platformReturnRows(ctx.state.platformOrders).length,1);
 await ctx.archivePlatformReturns(true);
 assert.equal(ctx.platformReturnRows(ctx.state.platformOrders).length,2);
});
