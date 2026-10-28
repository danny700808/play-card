const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const model=require('../functions/inventoryAverageCost');
const raw={averageCost:8000,latestPurchaseCost:8200,currentStock:2,costLayers:[{layerId:'old',qtyRemaining:2,unitCost:14500}]};
test('manual average is authoritative despite contradictory old FIFO batches',()=>{const r=model.consume(raw,1);assert.equal(r.costTotal,8000);assert.equal(r.averageCost,8000);assert.equal(r.inventoryValue,8000);assert.equal(raw.costLayers[0].unitCost,14500);});
test('selling out and negative stock preserve manually entered cost',()=>{for(const qty of [2,3]){const r=model.consume(raw,qty,true);assert.equal(r.costTotal,qty*8000);assert.equal(r.averageCost,8000);assert.equal(r.inventoryValue,0);}assert.throws(()=>model.consume(raw,3,false),/庫存不足/);});
test('missing or invalid average cannot silently use selling price, purchase cost or FIFO',()=>{for(const value of [null,undefined,'',-1,NaN])assert.throws(()=>model.consume({...raw,averageCost:value},1,true),/平均成本/);assert.equal(model.consume({...raw,averageCost:0},1).costTotal,0);});
const src=fs.readFileSync('operations-phase1.js','utf8');
function extract(name){const a=src.indexOf('  function '+name+'('),line=src.indexOf('\n',a);if(src.slice(a,line).trim().endsWith('}'))return src.slice(a,line);return src.slice(a,src.indexOf('\n  }',a)+4);}
const ctx={global:{YouziInventoryAverageCost:model},uid:()=> 'receipt',numberOrNull:x=>x==null?null:Number(x)};
for(const n of ['costLayerStats','consumeFifo','addFifoLayer','adjustFifoLayers','revisePurchaseLayers','restoreSaleItemToStock'])vm.runInNewContext(extract(n),ctx);
test('receipts weight the incoming cost while stocktakes retain the master average',()=>{assert.equal(ctx.addFifoLayer(raw,3,20000,{}).averageCost,15200);assert.equal(ctx.addFifoLayer(raw,3,20000,{}).inventoryValue,76000);assert.equal(ctx.adjustFifoLayers(raw,0,20000,{}).averageCost,8000);assert.equal(ctx.adjustFifoLayers(raw,4,20000,{}).inventoryValue,32000);assert.equal(ctx.revisePurchaseLayers(raw,'p',{qty:2},{qty:3},20000,new Date()).averageCost,12000);});
test('returning an old sale restores stock at current master cost without replacing it with historical cost',()=>{const r=ctx.restoreSaleItemToStock(raw,{qty:1,lineCost:14500,fifoBreakdown:[{layerId:'old',qty:1,unitCost:14500}]});assert.equal(r.stock,3);assert.equal(r.raw.averageCost,8000);assert.equal(ctx.costLayerStats(r.raw).inventoryValue,24000);});
test('browser and server execute the same average cost module',()=>{const context={};vm.runInNewContext(fs.readFileSync('functions/inventoryAverageCost.js','utf8'),context);assert.equal(context.YouziInventoryAverageCost.consume(raw,1).costTotal,model.consume(raw,1).costTotal);for(const f of ['portal.html','operations-hub.html']){const html=fs.readFileSync(f,'utf8');assert(html.indexOf('functions/inventoryAverageCost.js')<html.indexOf('<script src="operations-phase1.js'));}});

test('weighted receipts round halves up, preserve actual decimal unit prices and accept free stock',()=>{
  const baseline={currentStock:4,averageCost:475};
  for(const [qty,price,expected] of [[5,490,483],[4,490,483],[1,490,478],[4,490.01,483],[4,0,238]]){
    const r=model.receive(baseline,qty,price);assert.equal(r.averageCost,expected);assert.equal(r.receiptUnitCost,price);assert.equal(r.receiptTotal,qty*price);assert.equal(r.inventoryValue,(4+qty)*expected);
  }
  assert.equal(baseline.averageCost,475);
});

test('zero and negative old stock use the new price; positive stock cannot guess a missing average',()=>{
  for(const stock of [0,-2])assert.equal(model.receive({currentStock:stock,averageCost:null},4,490.5).averageCost,491);
  assert.throws(()=>model.receive({currentStock:2,averageCost:null},4,490),/平均成本/);
  for(const price of [null,'',undefined,-1,NaN,Infinity])assert.throws(()=>model.receive(raw,4,price),/進貨成本/);
  for(const qty of [0,-1,1.5,NaN])assert.throws(()=>model.receive(raw,qty,490),/進貨數量/);
});

test('receipt correction after a sale adjusts only remaining inventory value, leaving sale costs untouched',()=>{
  const old={qty:5,unitCost:490,effectiveUnitCost:490,costMethod:'WEIGHTED_AVERAGE_ROUNDED',beforeStock:4,beforeAverageCost:475,afterStock:9,afterAverageCost:483};
  const sale=model.consume({currentStock:9,averageCost:483},2),remaining={currentStock:sale.after,averageCost:sale.averageCost};
  const corrected=model.reviseReceipt(remaining,old,{qty:5},500);
  assert.equal(corrected.averageCost,490);assert.equal(corrected.inventoryValue,3430);assert.equal(sale.costTotal,966);
  assert.throws(()=>model.reviseReceipt({currentStock:1,averageCost:483},old,{qty:1},0),/庫存不可/);
});
