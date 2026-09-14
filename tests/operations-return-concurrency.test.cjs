'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync('operations-phase1.js','utf8').replace(/\r\n/g,'\n');
const begin=source.indexOf('  function returnLedgerVersion('),end=source.indexOf('\n  function openSalesHistory()',begin);
assert(begin>=0&&end>begin);
function database(qty=1){
  let serial=Promise.resolve(),counter=0;
  const rows=new Map([['sales/s1',{saleNo:'S1',items:[{productId:'p1',name:'sample',sku:'P1',qty,lineTotal:100*qty,lineCost:30*qty}],subtotal:100*qty,total:100*qty,customerId:'',status:'completed'}],['products/p1',{currentStock:10-qty,costLayers:[]}]]);
  const snapshot=path=>{const exists=rows.has(path),value=structuredClone(rows.get(path)||{});return {id:path.split('/').at(-1),exists,data:()=>structuredClone(value)};};
  const reference=path=>({path,id:path.split('/').at(-1),get:async()=>snapshot(path)});
  const db={rows,loseReplyOnce:false,failCommit:false,collection:name=>({doc:id=>reference(name+'/'+(id||'id-'+(++counter))),where:(field,op,value)=>({get:async()=>({docs:[...rows.keys()].filter(path=>path.startsWith(name+'/')&&rows.get(path)[field]===value).map(snapshot)})})}),runTransaction(fn){
    const result=serial.then(async()=>{
      const writes=[];
      const value=await fn({get:async ref=>snapshot(ref.path),set:(ref,data,options)=>writes.push(()=>rows.set(ref.path,{...(options&&options.merge?rows.get(ref.path):{}),...structuredClone(data)})),update:(ref,data)=>writes.push(()=>rows.set(ref.path,{...rows.get(ref.path),...structuredClone(data)}))});
      if(db.failCommit)throw new Error('transaction rejected');
      writes.forEach(write=>write());
      if(db.loseReplyOnce){db.loseReplyOnce=false;throw new Error('response lost');}
      return value;
    });serial=result.catch(()=>{});return result;
  }};return db;
}
function client(db){
  const storage=new Map();
  const sale={id:'s1',...structuredClone(db.rows.get('sales/s1'))};
  const ctx={state:{db,user:{id:'manager-a'},sales:[sale],salesReturns:[]},COLLECTIONS:{sales:'sales',salesReturns:'returns',products:'products',incomes:'incomes',inventory:'inventory'},global:{crypto},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},FormData:class{get(){return '';}},clean:v=>String(v??'').trim(),queryAll:()=>[{dataset:{index:0}}],query:selector=>({value:selector.includes('qty')?'1':'restock'}),returnedQtyForItem:()=>0,sum:(rows,fn)=>rows.reduce((sum,row)=>sum+fn(row),0),uid:()=>crypto.randomUUID(),serverTimestamp:()=>1,userLabel:()=> 'manager',VERSION:'test',restoreSaleItemToStock:(raw,item,qty)=>({raw,stock:raw.currentStock+qty}),costLayerStats:()=>({averageCost:30,inventoryValue:300,costIncomplete:false}),queueInventorySyncInTransaction(){},writeAudit:async()=>{},closeDrawer(){},toast(){},loadAll:async()=>{}};
  vm.runInNewContext(source.slice(begin,end),ctx);
  return {save:()=>ctx.saveSaleReturn({dataset:{id:'s1'}}),storage};
}
function returns(db){return [...db.rows.entries()].filter(([path])=>path.startsWith('returns/')).map(([,row])=>row);}
test('two stale counters cannot refund or restock one sold item twice',async()=>{
  const db=database(),a=client(db),b=client(db);
  const result=await Promise.allSettled([a.save(),b.save()]);
  assert.equal(result.filter(row=>row.status==='fulfilled').length,1);
  assert.equal(returns(db).length,1);assert.equal(returns(db)[0].refundAmount,100);
  assert.equal(db.rows.get('products/p1').currentStock,10);
});
test('lost successful response reuses the operation without another refund',async()=>{
  const db=database(),a=client(db);db.loseReplyOnce=true;
  await assert.rejects(a.save(),/response lost/);
  assert.equal(returns(db).length,1);assert.equal(a.storage.size,1);
  await a.save();assert.equal(returns(db).length,1);assert.equal(a.storage.size,0);
  assert.equal(db.rows.get('products/p1').currentStock,10);
});
test('another legitimate partial return may proceed when quantity remains',async()=>{
  const db=database(2),a=client(db),b=client(db);
  await Promise.all([a.save(),b.save()]);
  assert.equal(returns(db).length,2);assert.equal(db.rows.get('products/p1').currentStock,10);
  assert.equal(returns(db).reduce((sum,row)=>sum+row.refundAmount,0),200);
});
test('failed commit changes no refund, inventory, or order fields',async()=>{
  const db=database(),a=client(db),before=structuredClone([...db.rows]);db.failCommit=true;
  await assert.rejects(a.save(),/transaction rejected/);
  assert.deepEqual([...db.rows],before);
});
