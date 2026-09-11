const test = require('node:test');
const assert = require('node:assert/strict');
const {momoPriceTargetsForAgent,recordAgentCoupangPriceResults} = require('../functions/platformOrderSync')._test;
test('MOMO targets contain only explicitly deferred products with exact platform mappings',()=>{
  const p={id:'p',sku:'s',raw:{momoPrice:900,platformPriceSync:{MOMO:{status:'agent-required'}},platformMappings:{momo:{goodsCode:'g',goodsdtCode:'001'}}}};
  assert.deepEqual(momoPriceTargetsForAgent([p,{...p,sku:''},{...p,raw:{momoPrice:900}}]),[{productId:'p',sku:'s',platform:'MOMO',targetPrice:900,platformMappings:{goodsCode:'g',goodsdtCode:'001'}}]);
});
test('MOMO reports update MOMO only and stale price reports cannot overwrite a newer target',async()=>{
  const writes=[];
  const raw={momoPrice:900,coupangPrice:800,platformPriceSync:{Coupang:{status:'success',lastSyncedPrice:800}}};
  const db={collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>raw}),set:async data=>writes.push(data)})})};
  await recordAgentCoupangPriceResults(db,[{productId:'p',platform:'MOMO',targetPrice:880,status:'success'}],'run','report');
  assert.equal(writes.length,0);
  const result=await recordAgentCoupangPriceResults(db,[{productId:'p',platform:'MOMO',targetPrice:900,status:'success'}],'run','report');
  assert.equal(result.success,1);
  assert.equal(writes[0].platformPriceSync.MOMO.lastSyncedPrice,900);
  assert.equal(writes[0].platformPriceSync.Coupang.lastSyncedPrice,800);
});
