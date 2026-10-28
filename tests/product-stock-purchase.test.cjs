'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../operations-phase1.js'),'utf8');
const model=require('../functions/inventoryAverageCost');
function extract(name){const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=source.slice(start),end=rest.slice(1).search(/\n  (?:async )?function /);return end<0?rest:rest.slice(0,end+1);}
const clean=x=>x==null?'':String(x).trim(),num=x=>x==null||x===''?null:Number(x);
function fixture(options={}){
  let seq=0,commits=0,choices=0;
  const raw={internalSku:'2000110',internalName:'測試吉他弦',averageCost:470,latestPurchaseCost:450,currentStock:options.before??0,updatedAt:new Date('2026-10-27T01:00:00Z'),storePrice:720,easyStorePrice:720,momoPrice:720,coupangPrice:720,...options.raw};
  const rows=new Map();if(!options.newProduct)rows.set('products/p1',{...raw});
  const fields=Object.fromEntries(Object.entries({internalSku:raw.internalSku,internalName:raw.internalName,currentStock:options.after??4,averageCost:options.average??470,latestPurchaseCost:450,storePrice:720,easyStorePrice:720,momoPrice:720,coupangPrice:720,...options.fields}).map(([name,value])=>[name,{name,value,defaultValue:value}]));
  const submit={disabled:true},form={dataset:{id:options.newProduct?'':'p1'},fields,elements:Object.values(fields)};
  const state={internalProducts:options.newProduct?[]:[{...raw,docId:'p1'}],purchases:[],inventory:[],suppliers:[{id:'s1',name:'供應商甲'}]};
  const snapshot=ref=>({exists:rows.has(ref.path),data:()=>rows.get(ref.path)});
  const db={collection:collection=>({doc(id){const ref={id:id||'id'+(++seq)};ref.path=collection+'/'+ref.id;ref.get=async()=>{if(options.readFailure)throw Error('read failed');return snapshot(ref);};return ref;}}),async runTransaction(fn){
    if(options.concurrent)rows.set('products/p1',{...raw,currentStock:raw.currentStock+1});
    if(options.concurrentMetadata)rows.set('products/p1',{...raw,updatedAt:new Date('2026-10-28T01:00:00Z')});
    let pending=[];const tx={get:async ref=>snapshot(ref),set:(ref,data,opts)=>pending.push({ref,data,merge:opts?.merge}),update:(ref,data)=>pending.push({ref,data,merge:true})};
    if(options.retry){await fn(tx);pending=[];}
    await fn(tx);if(options.failCommit)throw Error('commit failed');
    for(const op of pending)rows.set(op.ref.path,{...(op.merge?rows.get(op.ref.path):{}),...op.data});commits++;
  }};state.db=db;
  const context={state,Date,Number,Map,Set,Array,Math,Error,console,FormData:class{constructor(form){this.form=form;}get(key){return this.form.fields[key]?.value??'';}},COLLECTIONS:{products:'products',purchases:'purchases',inventory:'inventory',platformInventoryQueue:'queue',platformSyncRequests:'priceQueue'},VERSION:'test',global:{YouziInventoryAverageCost:model,confirm:()=>true},clean,normalizeCode:clean,numberOrNull:num,firstValue:(obj,keys)=>{for(const key of keys)if(obj[key]!=null&&obj[key]!=='')return obj[key];return null;},firstNumber:(obj,keys)=>({value:Number(obj[keys.find(k=>obj[k]!=null)]||0)}),uid:prefix=>prefix+'-'+(++seq),userLabel:()=> 'tester',serverTimestamp:()=>new Date('2026-10-28T05:00:00Z'),dateFrom:x=>x?new Date(x):null,formatNumber:String,money:x=>'NT$ '+Number(x).toLocaleString('en-US'),query:(selector,form)=>selector==='[type="submit"]'?submit:form.fields[selector.match(/name="([^"]+)"/)[1]],queryAll:()=>[],catalogById:id=>{const p=state.internalProducts.find(p=>p.docId===id);return p?{...p,internal:p}:null;},normalizeInternal:(raw,id)=>({...raw,docId:id}),mergeCatalog(){},replaceLiveSearchHtml(){},productSearchResultsHtml:()=>'',writeAudit:async()=>{},toast(){},clearProductEditorState(){},loadProductsOnly:async()=>{},setTimeout(){},location:{},dateText:x=>new Date(x).toISOString().slice(0,10),sum:(arr,fn)=>arr.reduce((a,x)=>a+fn(x),0),queueInventorySyncInTransaction(){},resetPurchaseEntry(){},loadAll:async()=>{}};
  for(const name of ['supplierById','normalizeCostLayers','statsFromLayers','normalizePurchase','normalizeInventory','productStockPurchase','adjustFifoLayers','rebaseCostLayersToAverage','addFifoLayer','revisePurchaseLayers','saveProduct','saveProductChanges','savePurchase'])vm.runInNewContext(extract(name),context);
  context.chooseProductStockSave=async details=>{choices++;if(options.waitChoice)await options.waitChoice;if(options.cancel)return null;return {mode:options.mode||'purchase',supplierId:'',supplier:'',receivedAt:'',paymentStatus:'unknown',...options.choice};};
  return {context,state,rows,form,submit,raw,save:()=>context.saveProduct(form,{keepOpen:true}),list:collection=>[...rows].filter(([key])=>key.startsWith(collection+'/')).map(([,value])=>value),get commits(){return commits;},get choices(){return choices;}};
}
test('0 to 4 uses the entered purchase price and replaces the empty-stock average; metadata can be blank',async()=>{
  const f=fixture();await f.save();const p=f.list('purchases')[0],m=f.list('inventory')[0];
  assert.equal(f.list('products')[0].currentStock,4);assert.equal(f.list('products')[0].averageCost,450);
  assert.equal(p.items[0].qty,4);assert.equal(p.items[0].unitCost,450);assert.equal(p.totalCost,1800);
  assert.equal(p.supplier,'');assert.equal(p.receivedAt,null);assert.equal(p.paymentStatus,'unknown');assert.equal(p.paymentDate,'');
  assert.equal(m.type,'purchase');assert.equal(m.qtyChange,4);assert.equal(m.referenceId,p.purchaseNo);assert.equal(m.beforeStock,0);assert.equal(m.afterStock,4);
  assert.equal(f.list('inventory').length,1);assert.equal(f.list('queue')[0].targetStock,4);assert.equal(f.commits,1);assert.equal(f.submit.disabled,false);
  const visible=f.state.purchases[0];assert.equal(visible.receivedAtProvided,false);assert.equal(visible.receivedAt.getTime(),visible.createdAt.getTime());assert.equal(f.context.normalizePurchase(p).receivedAt.getTime(),p.createdAt.getTime());assert.equal(visible.paymentStatus,'unknown');
});
test('3 to 7 weights only the four added units against the saved average, ignoring simultaneous manual average edits',async()=>{
  const f=fixture({before:3,after:7,average:500,fields:{latestPurchaseCost:490}});await f.save();assert.equal(f.list('purchases')[0].totalCost,1960);assert.equal(f.list('purchases')[0].items[0].qty,4);assert.equal(f.list('products')[0].currentStock,7);assert.equal(f.list('products')[0].inventoryValue,3367);assert.equal(f.list('inventory').length,1);assert.equal(f.list('inventory')[0].beforeAverageCost,470);assert.equal(f.list('inventory')[0].afterAverageCost,481);
});
test('plain correction creates no receipt and does not replace purchase cost',async()=>{
  const f=fixture({mode:'adjustment'});await f.save();assert.equal(f.list('purchases').length,0);assert.equal(f.list('inventory')[0].type,'adjustment');assert.equal(f.list('products')[0].latestPurchaseCost,450);
});

test('4 at 475 plus 5 at 490 saves 483, preserves receipt price and uses 483 for the next sale',async()=>{
  const f=fixture({before:4,after:9,raw:{averageCost:475},average:475,fields:{latestPurchaseCost:490}});
  f.rows.set('sales/history',{costTotal:475});await f.save();
  const p=f.list('products')[0],receipt=f.list('purchases')[0];
  assert.equal(p.averageCost,483);assert.equal(p.latestPurchaseCost,490);assert.equal(p.inventoryValue,4347);
  assert.equal(receipt.totalCost,2450);assert.equal(receipt.items[0].unitCost,490);assert.equal(receipt.items[0].beforeAverageCost,475);
  assert.equal(f.form.fields.averageCost.value,483);assert.equal(model.consume(p,2).costTotal,966);assert.equal(f.rows.get('sales/history').costTotal,475);
});

test('initial receipts need no old average; plain stock edits retain their existing average',async()=>{
  const f=fixture({newProduct:true,fields:{averageCost:'',latestPurchaseCost:490.5}});await f.save();assert.equal(f.list('products')[0].averageCost,491);assert.equal(f.list('purchases')[0].items[0].unitCost,490.5);
  const g=fixture({before:4,after:9,mode:'adjustment',raw:{averageCost:475},average:475,fields:{latestPurchaseCost:490}});await g.save();assert.equal(g.list('products')[0].averageCost,475);assert.equal(g.list('purchases').length,0);
});

function receiptForm(f,{id='',qty=5,unitCost=490,extraCost=0}={}){
  const form={dataset:{id},fields:Object.fromEntries(Object.entries({receivedAt:'',supplier:'',supplierId:'',paymentStatus:'unknown',extraCost}).map(([name,value])=>[name,{value}]))};
  const row={fields:Object.fromEntries(Object.entries({productId:'p1',qty,unitCost}).map(([name,value])=>[name,{value}]))};
  f.context.queryAll=selector=>selector==='.purchase-row'?[row]:[];return form;
}

test('normal inventory receipts use the same weighted integer cost and retain actual price and optional metadata',async()=>{
  for(const extraCost of [0,50]){
    const f=fixture({before:4,raw:{averageCost:475}});await f.context.savePurchase(receiptForm(f,{extraCost}));
    const p=f.list('products')[0],receipt=f.list('purchases')[0];
    assert.equal(p.currentStock,9);assert.equal(p.averageCost,extraCost?489:483);assert.equal(p.latestPurchaseCost,490);
    assert.equal(receipt.items[0].unitCost,490);assert.equal(receipt.items[0].effectiveUnitCost,extraCost?500:490);assert.equal(receipt.totalCost,2450+extraCost);
    assert.equal(receipt.receivedAt,null);assert.equal(receipt.paymentStatus,'unknown');assert.equal(receipt.supplier,'');
  }
});

test('editing receipt metadata preserves average; quantity or price corrections recompute from the original baseline without rounding drift',async()=>{
  const f=fixture({before:4,after:9,raw:{averageCost:475},average:475,fields:{latestPurchaseCost:490}});await f.save();const id=f.state.purchases[0].id;
  await f.context.savePurchase(receiptForm(f,{id}));assert.equal(f.list('products')[0].averageCost,483);assert.equal(f.list('inventory').length,1);
  await f.context.savePurchase(receiptForm(f,{id,qty:4}));assert.equal(f.list('products')[0].averageCost,483);assert.equal(f.list('products')[0].currentStock,8);
  await f.context.savePurchase(receiptForm(f,{id,qty:5,unitCost:500}));assert.equal(f.list('products')[0].averageCost,489);assert.equal(f.list('products')[0].currentStock,9);
  await f.context.savePurchase(receiptForm(f,{id,qty:5,unitCost:490}));assert.equal(f.list('products')[0].averageCost,483);assert.equal(f.list('purchases').length,1);
});
test('new products can record initial stock as a receipt instead of a second opening movement',async()=>{
  const f=fixture({newProduct:true});await f.save();assert.equal(f.list('products')[0].openingStock,0);assert.equal(f.list('products')[0].currentStock,4);assert.equal(f.list('purchases').length,1);assert.equal(f.list('inventory').length,1);assert.equal(f.list('inventory')[0].type,'purchase');
});
test('decreases and unchanged stock do not offer or create receipts',async()=>{
  for(const after of [2,4]){const f=fixture({before:4,after});await f.save();assert.equal(f.choices,0);assert.equal(f.list('purchases').length,0);assert.equal(f.list('products')[0].currentStock,after);}
});
test('cancel and transaction failure leave all records unchanged and re-enable save',async()=>{
  for(const opts of [{cancel:true},{failCommit:true}]){const f=fixture(opts);await assert.rejects(f.save());assert.equal(f.list('products')[0].currentStock,0);assert.equal(f.list('purchases').length,0);assert.equal(f.list('inventory').length,0);assert.equal(f.list('queue').length,0);assert.equal(f.submit.disabled,false);}
});
test('concurrent inventory or metadata changes reject the stale product save',async()=>{
  for(const opts of [{concurrent:true},{concurrentMetadata:true}]){const f=fixture(opts);await assert.rejects(f.save(),/重新整理/);assert.equal(f.list('purchases').length,0);assert.equal(f.list('inventory').length,0);assert.equal(f.commits,0);}
});
test('transaction retries, repeated saves and a failed post-save read never add stock twice',async()=>{
  const f=fixture({retry:true});await f.save();await f.save();assert.equal(f.list('purchases').length,1);assert.equal(f.list('inventory').length,1);assert.equal(f.list('products')[0].currentStock,4);
  const g=fixture({readFailure:true});await g.save();await g.save();assert.equal(g.list('purchases').length,1);assert.equal(g.list('products')[0].currentStock,4);
});
test('parallel clicks cannot open a second receipt save',async()=>{
  let release;const waitChoice=new Promise(resolve=>release=resolve),f=fixture({waitChoice});const saving=f.save();await assert.rejects(f.save(),/正在儲存/);release();await saving;assert.equal(f.list('purchases').length,1);
});
test('optional supplier, arrival and payment values are preserved without inventing a payment date',async()=>{
  const f=fixture({choice:{supplierId:'s1',receivedAt:'2026-10-25T10:00',paymentStatus:'paid'}});await f.save();const p=f.list('purchases')[0];assert.equal(p.supplier,'供應商甲');assert.equal(p.paymentStatus,'paid');assert.equal(p.paymentDate,'');assert.equal(p.receivedAt.getTime(),new Date('2026-10-25T10:00').getTime());assert.equal(f.list('inventory')[0].occurredAt.getTime(),p.receivedAt.getTime());
});
test('zero purchase price is valid; missing or negative prices cannot turn into a receipt',async()=>{
  const f=fixture({fields:{latestPurchaseCost:0}});await f.save();assert.equal(f.list('purchases')[0].totalCost,0);assert.equal(f.list('products')[0].averageCost,0);
  for(const unitCost of [null,-1,NaN]){const g=fixture();assert.throws(()=>g.context.productStockPurchase({mode:'purchase'},{before:0,after:4,unitCost}),/最近一次進貨成本/);}
});
test('receipt edits can keep metadata empty and change quantity by the delta',async()=>{
  const f=fixture();await f.save();const purchase=f.state.purchases[0];
  const receiptForm={dataset:{id:purchase.id},fields:Object.fromEntries(Object.entries({receivedAt:'',supplier:'',supplierId:'',paymentStatus:'unknown',extraCost:0}).map(([name,value])=>[name,{value}]))};
  const row={fields:Object.fromEntries(Object.entries({productId:'p1',qty:6,unitCost:470}).map(([name,value])=>[name,{value}]))};
  f.context.queryAll=selector=>selector==='.purchase-row'?[row]:[];
  await f.context.savePurchase(receiptForm);assert.equal(f.list('purchases').length,1);assert.equal(f.list('purchases')[0].receivedAt,null);assert.equal(f.list('purchases')[0].paymentStatus,'unknown');assert.equal(f.list('products')[0].currentStock,6);assert.equal(f.list('purchases')[0].totalCost,2820);
});
test('rendering or reopening a receipt does not fill in an omitted arrival time',()=>{
  const f=fixture();Object.assign(f.context,{purchaseEntrySearchResult:()=>({rows:[],html:''}),emptyHtml:()=>'',purchaseEntrySeriesTabs:()=>'',mobileSearchPadHtml:()=>'',supplierSelectOptions:()=>'',purchaseSupplierSummary:()=>'',attr:clean,escapeHtml:clean});Object.assign(f.state,{purchaseEntryReceivedAt:'',purchaseEntryCart:[]});vm.runInNewContext(extract('renderPurchaseEntry'),f.context);const html=f.context.renderPurchaseEntry();assert.equal(f.state.purchaseEntryReceivedAt,'');assert.match(html,/value="unknown"/);assert.doesNotMatch(html,/id="purchaseEntryReceivedAt"[^>]*required/);assert.doesNotMatch(html,/id="purchaseEntrySupplier"[^>]*required/);
});
