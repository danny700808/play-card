const test=require('node:test');
const assert=require('node:assert/strict');
const model=require('./shipping-ui/model.js');

test('one click reprint reads fresh order and submits its fingerprint once',async()=>{
  const calls=[],row={key:'Coupang:123',canDownload:true},options={carrier:'TWL_HCT'};
  const fresh={...row,action:'download',fingerprint:'fresh-order-hash'};
  const api=async(path,body)=>{calls.push({path,body});return path==='/api/preview'?fresh:{ready:true};};
  let displayed;
  assert.deepEqual(await model.obtainDocument(api,row,options,r=>displayed=r),{ready:true});
  assert.equal(displayed,fresh);
  assert.deepEqual(calls,[
    {path:'/api/preview',body:{key:row.key,options}},
    {path:'/api/process',body:{key:row.key,options,fingerprint:'fresh-order-hash'}}
  ]);
});
test('a reprint cannot become a new shipment when platform state changes',async()=>{
  let submissions=0;
  await assert.rejects(model.obtainDocument(async path=>{
    if(path==='/api/process')submissions++;
    return {key:'Coupang:123',action:'create',fingerprint:'fresh'};
  },{key:'Coupang:123',canDownload:true},{}),/未申請新出貨/);
  assert.equal(submissions,0);
});
test('wrong order or missing fingerprint never reaches submission',async()=>{
  for(const fresh of [{key:'MOMO:other',fingerprint:'fresh'},{key:'MOMO:123'}]){
    let submissions=0;
    await assert.rejects(model.obtainDocument(async path=>{
      if(path==='/api/process')submissions++;
      return fresh;
    },{key:'MOMO:123',canCreate:true},{}),/未能核對/);
    assert.equal(submissions,0);
  }
});
test('failed or uncertain submission is not automatically repeated',async()=>{
  let submissions=0;
  await assert.rejects(model.obtainDocument(async path=>{
    if(path==='/api/preview')return {key:'MOMO:123',action:'create',fingerprint:'fresh'};
    submissions++;throw Error('結果未確認');
  },{key:'MOMO:123',canCreate:true},{}),/結果未確認/);
  assert.equal(submissions,1);
});
test('already arranged new shipment request retrieves its existing label',async()=>{
  let received;
  await model.obtainDocument(async(path,body)=>{
    if(path==='/api/preview')return {key:'MOMO:123',action:'download',fingerprint:'existing'};
    received=body;return {ready:true};
  },{key:'MOMO:123',canCreate:true},{});
  assert.equal(received.fingerprint,'existing');
});
test('Shopee label page uses only validated EasyStore order ids',()=>{
  const row={platform:'EasyStore',channel:'蝦皮',externalId:'117638481',stage:'shipped'};
  assert.equal(model.shopeePrintUrl(row),'https://admin.easystore.co/channels/shopee/taiwan/orders/awb?store_order_ids=117638481');
  assert.equal(model.shopeePrintUrl({...row,stage:'pending',handled:true}),'');
  assert.equal(model.shopeePrintUrl({...row,externalId:'123&other=456'}),'');
  assert.equal(model.shopeePrintUrl({...row,channel:'官網'}),'');
});
