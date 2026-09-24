const {test}=require('node:test');
const assert=require('node:assert/strict');
const policy=require('../functions/orderShipmentPolicy');
const api=require('../functions/platformOrderSync')._test;
function database(){
 const rows=new Map();let serial=Promise.resolve();
 const snap=path=>({id:path.split('/').at(-1),ref:ref(path),exists:rows.has(path),data:()=>({...rows.get(path)})});
 const ref=path=>({path,id:path.split('/').at(-1),get:async()=>snap(path),set:async(data,opts)=>rows.set(path,{...(opts&&opts.merge?rows.get(path):{}),...data})});
 const db={rows,collection:name=>({doc:id=>ref(name+'/'+id),where:(k,op,v)=>({get:async()=>({docs:[...rows].filter(([path,data])=>path.startsWith(name+'/')&&data[k]===v).map(([path])=>snap(path))})})}),runTransaction(fn){
  const task=serial.then(async()=>{const writes=[];const value=await fn({get:async r=>snap(r.path),set:(r,d,o)=>writes.push(()=>rows.set(r.path,{...(o&&o.merge?rows.get(r.path):{}),...d}))});writes.forEach(f=>f());return value;});serial=task.catch(()=>{});return task;
 }};return db;
}
function line(extra={}){return api.normalizeLine({platform:'MOMO',externalOrderId:'ORDER',externalLineId:'LINE',orderedAt:'2026-09-20T10:00:00+08:00',orderDateSource:'momo-api-order-date',sku:'SKU',productName:'test',quantity:1,unitPrice:100,grossAmount:100,orderStatus:'待出貨',...extra});}
function setup(qty=1){const db=database(),l=line({quantity:qty,grossAmount:qty*100});const ref=db.collection('opsInternalProducts').doc('p');db.rows.set(ref.path,{currentStock:10,averageCost:30});return {db,l,map:new Map([['SKU',[{id:'p',ref,raw:{}}]]]),settings:{applyInventory:true,estimatedNetRate:.87,missingBeforeReverse:2}};}
const stock=x=>x.db.rows.get('opsInternalProducts/p').currentStock;
const order=x=>x.db.rows.get('opsPlatformOrders/'+x.l.id);
const apply=(x,l=x.l)=>api.applyOrderLine(x.db,l,x.map,x.settings,'TEST');
const cancel=extra=>line({orderStatus:'客戶取消',confirmedUnshipped:true,cancellationConfirmed:true,...extra});
test('unshipped is not shipped; free text and completion date are not shipping evidence',()=>{
 assert.equal(policy.shipmentState({orderStatus:'unshipped'}),'unshipped');
 assert.equal(policy.shipmentState({orderStatus:'unfulfilled',note:'已出貨 shipped'}),'unshipped');
 assert.equal(policy.shipmentState({completedAt:'2026-09-22'}),'unknown');
});
test('all supported platform shipping boundaries are explicit',()=>{
 for(const orderStatus of ['出貨確認','配送結束','DEPARTURE','DELIVERING','FINAL_DELIVERY','NONE_TRACKING','fulfilled'])assert.equal(policy.shipmentState({orderStatus}),'shipped');
 for(const releaseStatus of ['Y','A'])assert.equal(policy.shipmentState({releaseStatus}),'shipped');
 for(const releaseStatus of ['N','S'])assert.equal(policy.shipmentState({releaseStatus}),'unshipped');
});
test('shipment history survives empty or cancelled latest status',()=>{
 assert.equal(policy.decision({shipmentConfirmed:true},cancel()),'manual-return-review');
 assert.equal(policy.decision({orderStatus:'出貨確認'},{orderStatus:'客戶取消',confirmedUnshipped:true}),'manual-return-review');
});
test('cancellation request alone or unknown shipment never restocks',()=>{
 assert.equal(policy.decision({},line({orderStatus:'取消申請',confirmedUnshipped:true})),'cancellation-review');
 assert.equal(policy.decision({},line({orderStatus:'cancelled'})),'cancellation-review');
});
test('EasyStore fulfillment history overrides cancelled/restocked state',()=>{
 assert.equal(api.easyStoreShipmentFields({is_cancelled:true,fulfillment_status:'restocked',fulfillments:[{status:'success'}]}).shipmentConfirmed,true);
 assert.equal(api.easyStoreShipmentFields({is_cancelled:true,fulfillment_status:'restocked',fulfillments:[]}).confirmedUnshipped,true);
 assert.equal(api.easyStoreShipmentFields({is_cancelled:true,fulfillment_status:'restocked'}).confirmedUnshipped,false);
});
test('10 → 9 → 10 before shipment, idempotent repeated cancellation',async()=>{
 const x=setup();await apply(x);await apply(x);assert.equal(stock(x),9);
 await apply(x,cancel());await apply(x,cancel());assert.equal(stock(x),10);assert.equal(order(x).reversalApplied,true);
});
test('cancellation before first sync never increases inventory',async()=>{
 const x=setup();await apply(x,cancel());assert.equal(stock(x),10);assert.equal(order(x).inventoryApplied,false);
});
test('shipment then refund AND cancellation never restocks',async()=>{
 const x=setup();await apply(x);await apply(x,line({orderStatus:'出貨確認'}));
 await apply(x,line({orderStatus:'退款'}));assert.equal(stock(x),9);assert.equal(order(x).shipmentConfirmed,true);
 await apply(x,cancel());assert.equal(stock(x),9);assert.equal(order(x).processingStatus,'manual-return-review');
});
test('Coupang Y receipt without dates remains manual return',async()=>{
 const x=setup();await apply(x);await apply(x,cancel({releaseStatus:'Y',orderStatus:'RETURNS_COMPLETED',receiptStatus:'RETURNS_COMPLETED',cancellationEventId:'r1',cancellationQuantity:1}));
 assert.equal(stock(x),9);assert.equal(order(x).processingStatus,'manual-return-review');
});
test('partial cancellation events restore exactly once per event',async()=>{
 const x=setup(2);await apply(x);assert.equal(stock(x),8);
 const c=cancel({quantity:2,cancellationQuantity:1,cancellationEventId:'r1'});
 await apply(x,c);await apply(x,c);assert.equal(stock(x),9);assert.equal(order(x).quantity,2);assert.equal(order(x).inventoryApplied,true);
 await apply(x,{...c,cancellationEventId:'r2'});assert.equal(stock(x),10);assert.equal(order(x).inventoryApplied,false);
});
test('claim with missing quantity is held, not a full-order reversal',async()=>{
 const x=setup(2);await apply(x);await apply(x,cancel({cancellationEventId:'r1'}));assert.equal(stock(x),8);assert.equal(order(x).processingStatus,'cancellation-review');
});
test('repeated missing platform snapshots never restock',async()=>{
 const x=setup();await apply(x);
 for(let i=0;i<5;i++)await api.reconcileMissingPlatformOrders(x.db,[],{MOMO:{status:'success',complete:true}},'2026-09-19','2026-09-24',x.map,x.settings,'TEST');
 assert.equal(stock(x),9);assert.equal(order(x).processingStatus,'missing-from-platform-review');
});
test('concurrent duplicate cancellation cannot double restock',async()=>{
 const x=setup();await apply(x);await Promise.all([apply(x,cancel()),apply(x,cancel())]);assert.equal(stock(x),10);
});
test('old active snapshot after cancellation cannot deduct again',async()=>{
 const x=setup();await apply(x);await apply(x,cancel());await apply(x);assert.equal(stock(x),10);
});
test('pending unshipped claim holds already deducted inventory',async()=>{
 const x=setup();await apply(x);await apply(x,line({orderStatus:'取消申請',confirmedUnshipped:true}));assert.equal(stock(x),9);assert.equal(order(x).processingStatus,'cancellation-review');
});
