const test=require('node:test');
const assert=require('node:assert/strict');
const model=require('./shipping-ui/model.js');
const row={orderNo:'TEST',stage:'shipped',paidAmountStatus:'confirmed',paidAmount:'2070',paidCurrency:'TWD',
 items:[{name:'M-VAVE Mini Universe 效果器',variant:'水藍色',sku:'2044749-17',quantity:2,remaining:0,price:999}]};
test('reprints include original shipped quantities, product variant and only the whole paid total',()=>{
 const result=model.packingLabel(row);
 assert.deepEqual(result.items,[{name:'M-VAVE Mini Universe 效果器 / 水藍色',sku:'204-4749-17',quantity:2}]);
 assert.equal(result.paidAmount,'2070');assert.equal(result.paidAmountStatus,'confirmed');
 assert.equal(JSON.stringify(result).includes('999'),false);
});
test('partial labels require known remaining quantities; never silently skip an unknown item',()=>{
 assert.throws(()=>model.packingLabel({...row,stage:'partial',items:[{...row.items[0],remaining:null}]}),/數量待核對/);
 assert.equal(model.packingLabel({...row,stage:'partial',items:[{...row.items[0],remaining:1}]}).items[0].quantity,1);
});
test('missing SKU, stale metadata, cancellation holds and invalid quantities block before printing',()=>{
 for(const changes of [{stale:true},{handlingChanged:true},{items:[{...row.items[0],sku:''}]},
  {items:[{...row.items[0],heldQuantity:1}]},...['',true,null,-1,1.5].map(quantity=>({items:[{...row.items[0],quantity}]}))])
  assert.throws(()=>model.packingLabel({...row,...changes}));
});
test('refund review and unknown amounts remain unconfirmed',()=>{
 for(const paidAmountStatus of ['review','unknown'])
  assert.equal(model.packingLabel({...row,paidAmountStatus,payableAmount:'2070'}).paidAmountStatus,'unconfirmed');
});

test('unpaid COD prints the buyer payable total without marking the order paid',()=>{
 const cod={...row,orderNo:'TEST-COD-425',paidAmount:null,paidAmountStatus:'pending_collection',payableAmount:'425'};
 const before=structuredClone(cod);
 const result=model.packingLabel(cod);
 assert.equal(result.paidAmount,'425');assert.equal(result.paidAmountStatus,'confirmed');
 assert.equal(model.paidAmount(cod).text,'待收款：NT$425');
 assert.equal(model.paidAmount(cod).confirmed,false);
 assert.deepEqual(cod,before);
});
test('COD uses its payable amount, preserving zero/cents and rejecting malformed or missing totals',()=>{
 for(const amount of ['0','425.50',425,0]){
  const result=model.packingLabel({...row,paidAmountStatus:'pending_collection',payableAmount:amount});
  assert.equal(result.paidAmount,amount);assert.equal(result.paidAmountStatus,'confirmed');
 }
 for(const amount of [null,undefined,'',true,-1,'NaN','Infinity','1e3','1.001']){
  const result=model.packingLabel({...row,paidAmountStatus:'pending_collection',payableAmount:amount});
  assert.equal(result.paidAmount,null);assert.equal(result.paidAmountStatus,'unconfirmed');
 }
 assert.equal(model.packingLabel({...row,paidCurrency:'USD'}).paidAmountStatus,'unconfirmed');
});
