'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {fixture,example,date,sale,purchase,online,source} = require('./helpers/overview-cost-fixture.cjs');
const value = (html,key) => html.match(new RegExp('data-overview-cost="'+key+'"[^>]*>([^<]+)'))?.[1];

test('store and online costs net of returns share one panel with receipts and a common balance', () => {
  const f=example();
  f.state.sales.push(sale('internal',999999,'2026-10-24',{saleType:'internalUse'}));
  f.state.platformOrders.push(online('cancelled',9000,'2026-10-24',{cancelled:true}),online('returned',9000,'2026-10-24',{returned:true}));
  const html=f.render();
  assert.equal(value(html,'sold'),'NT$ 200,000');
  assert.equal(value(html,'purchased'),'NT$ 130,000');
  assert.equal(value(html,'balance'),'＋NT$ 70,000');
  assert.equal((html.match(/class="ops-overview-cost-box /g)||[]).length,2);
  assert.match(html,/data-overview-cost="balance" class="is-positive"/);
  const panel=html.slice(html.indexOf('<div class="ops-overview-cost-summary">'),html.indexOf('差額')+250);
  assert.doesNotMatch(panel,/<small|ops-overview-cost-note|門市＋網路|非銀行可用餘額/);
});

test('both paid and unpaid receipts count on receivedAt, even when entered or paid next month', () => {
  const f=fixture({state:{purchases:[
    purchase('a',30000,'2026-10-01',{paymentStatus:'unpaid',createdAt:date('2026-11-01')}),
    purchase('b',45000,'2026-10-31',{paymentStatus:'paid',paymentDate:date('2026-11-05')}),
    purchase('old',99000,'2026-09-30',{paymentDate:date('2026-10-01')}),
    purchase('next',88000,'2026-11-01'),
    {id:'no-date',totalCost:7777}
  ]}});
  assert.equal(value(f.render(),'purchased'),'NT$ 75,000');
});

test('editing one receipt recomputes rather than double-counting, including zero and negative balances', () => {
  const f=example();
  f.state.purchases[0].totalCost=210000;
  assert.equal(value(f.render(),'balance'),'−NT$ 10,000');
  assert.match(f.render(),/data-overview-cost="balance" class="is-negative"/);
  f.state.purchases[0].totalCost=200000;
  assert.equal(value(f.render(),'balance'),'NT$ 0');
  assert.match(f.render(),/data-overview-cost="balance" class="is-zero"/);
  f.state.purchases[0].receivedAt=date('2026-11-01');
  assert.equal(value(f.render(),'purchased'),'NT$ 0');
});

test('day, month, year and custom filters share the same cost and receipt bounds on desktop and mobile', () => {
  for(const mobile of [true,false])for(const [range,from,to,expected] of [
    ['today','2026-10-24','2026-10-24',400],
    ['month','2026-10-01','2026-10-31',700],
    ['year','2026-01-01','2026-12-31',1000],
    ['custom','2026-09-01','2026-10-01',500]
  ]) {
    const days=['2026-01-01','2026-09-01','2026-10-01','2026-10-24'];
    const f=fixture({mobile,from,to,state:{overviewRange:range,
      sales:days.map((d,i)=>sale('s'+i,(i+1)*100,d)),
      purchases:days.map((d,i)=>purchase('p'+i,(i+1)*50,d))
    }});
    assert.equal(value(f.render(),'sold'),'NT$ '+expected.toLocaleString('zh-TW'));
    assert.equal(value(f.render(),'purchased'),'NT$ '+(expected/2).toLocaleString('zh-TW'));
  }
});

test('missing costs and incomplete reads do not produce a misleading spendable balance', () => {
  const f=example();f.state.sales[0].costMissing=true;
  assert.equal(value(f.render(),'balance'),'待確認');
  f.state.sales[0].costMissing=false;
  f.state.diagnostics=[{collection:'opsPurchases',ok:true,count:1200}];
  assert.equal(value(f.render(),'sold'),'待確認');
  assert.equal(value(f.render(),'purchased'),'待確認');
  assert.equal(value(f.render(),'balance'),'待確認');
});

test('estimated preorder costs are identified and unrelated income does not become replenishment principal', () => {
  const f=fixture({state:{sales:[sale('preorder',8000,'2026-10-24',{saleType:'preorder',costEstimated:true})],incomes:[{occurredAt:date('2026-10-24'),category:'維修收入',receivedAmount:90000}]}});
  assert.equal(value(f.render(),'sold'),'NT$ 8,000');
  assert.equal(value(f.render(),'balance'),'約 ＋NT$ 8,000');
});

test('normalizers distinguish absent costs from an explicitly valid zero cost', () => {
  const ctx={
    clean:v=>String(v??'').trim(), lower:v=>String(v??'').trim().toLowerCase(),
    firstNumber:(obj,keys)=>{for(const k of keys)if(obj[k]!==null&&obj[k]!==undefined&&obj[k]!==''&&Number.isFinite(Number(obj[k])))return{found:true,value:Number(obj[k])};return{found:false,value:0};},
    numberOrNull:v=>v==null?null:Number(v), dateFrom:v=>v?new Date(v):null
  };
  for(const [name,next] of [['normalizeSale','normalizeCustomer'],['normalizePlatformOrder','normalizePlatformSyncRun']]){
    const start=source.indexOf('  function '+name+'('),end=source.indexOf('  function '+next+'(',start);
    assert.ok(end>start);
    vm.runInNewContext(source.slice(start,end),ctx);
    assert.equal(ctx[name]({}).costMissing,true);
    assert.equal(ctx[name]({costTotal:0}).costMissing,false);
    assert.equal(ctx[name]({costTotal:100}).costMissing,false);
  }
});

test('empty months show zero and displayed whole-dollar difference matches the two displayed amounts', () => {
  assert.equal(value(fixture().render(),'balance'),'NT$ 0');
  const f=fixture({state:{sales:[sale('a',100.4)],purchases:[purchase('p',80.6)]}});
  assert.equal(value(f.render(),'sold'),'NT$ 100');
  assert.equal(value(f.render(),'purchased'),'NT$ 81');
  assert.equal(value(f.render(),'balance'),'＋NT$ 19');
});

test('confirmed receipt creation and correction refresh the same records used by the overview', async () => {
  const f=example(), records=new Map(),products=new Map([['product',{internalName:'Test guitar',internalSku:'G1',currentStock:0,averageCost:8000}]]);
  let count=0,refreshes=0;
  const ref=(collection,id)=>({collection,id:id||'new-'+(++count)});
  const ctx=f.context;
  Object.assign(ctx,{
    global:{YouziInventoryAverageCost:require('../functions/inventoryAverageCost')},
    FormData:class{constructor(form){this.data=form.data}get(key){return this.data[key]??''}},
    queryAll:(_s,form)=>form.items,
    query:(selector,item)=>({value:item[selector.match(/name="([^"]+)"/)[1]]}),
    numberOrNull:v=>v==null||v===''?null:Number(v),
    supplierById:()=>null,uid:()=> 'PUR-TEST',serverTimestamp:()=>date('2026-10-24'),userLabel:()=> 'test',
    COLLECTIONS:{products:'products',purchases:'purchases',inventory:'inventory'},VERSION:'test',
    addFifoLayer:(raw,qty,cost,meta)=>({layers:[{layerId:meta.layerId}],averageCost:raw.averageCost,inventoryValue:(raw.currentStock+qty)*raw.averageCost,costIncomplete:false}),
    revisePurchaseLayers:(raw,no,oldItem,newItem)=>({layers:[],averageCost:raw.averageCost,inventoryValue:(raw.currentStock+newItem.qty-oldItem.qty)*raw.averageCost,costIncomplete:false}),
    queueInventorySyncInTransaction:()=>{},writeAudit:async()=>{},resetPurchaseEntry:()=>{},location:{hash:''},toast:()=>{},
    loadAll:async()=>{refreshes++;ctx.state.purchases=[...records.entries()].map(([id,r])=>({id,...r}));},
    dateText:()=> '2026-10-24'
  });
  ctx.state.db={collection:name=>({doc:id=>ref(name,id)}),runTransaction:async fn=>fn({
    get:async r=>({exists:(r.collection==='products'?products:records).has(r.id),data:()=>({...((r.collection==='products'?products:records).get(r.id))})}),
    set:(r,data)=>{if(r.collection==='purchases')records.set(r.id,data);},
    update:(r,data)=>{const map=r.collection==='products'?products:records;map.set(r.id,{...map.get(r.id),...data});}
  })};
  const a=source.indexOf('  async function savePurchase(form)'),b=source.indexOf('  function stocktakeFilteredProducts()',a);
  vm.runInContext(source.slice(a,b),ctx);
  const form={dataset:{id:''},data:{receivedAt:'2026-10-24T12:00:00+08:00',supplier:'Supplier',extraCost:'500',paymentStatus:'unpaid'},items:[{productId:'product',qty:10,unitCost:8000}]};
  await ctx.savePurchase(form);
  assert.equal(refreshes,1);assert.equal(products.get('product').currentStock,10);
  assert.equal(value(f.render(),'purchased'),'NT$ 80,500');
  assert.equal(value(f.render(),'balance'),'＋NT$ 119,500');
  form.dataset.id=ctx.state.purchases[0].id;form.items[0].qty=12;
  await ctx.savePurchase(form);
  assert.equal(refreshes,2);assert.equal(records.size,1);assert.equal(products.get('product').currentStock,12);
  assert.equal(value(f.render(),'purchased'),'NT$ 96,500');
  assert.equal(value(f.render(),'balance'),'＋NT$ 103,500');
});
