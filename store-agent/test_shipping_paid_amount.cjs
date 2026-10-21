const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('./shipping-ui/model.js');
const paid={paidAmount:'1234.50',paidCurrency:'TWD',paidAmountStatus:'confirmed'};
test('COD, refund review and parcel allocation have distinct labels',()=>{
  const cod={paidAmountStatus:'pending_collection',payableAmount:'3036',paidCurrency:'TWD'};
  assert.equal(model.paidAmount(cod).text,'待收款：NT$3,036');
  assert.equal(model.paidAmount(cod).confirmed,false);
  assert.equal(model.paidAmount({...paid,paidAmountStatus:'review'}).text,'實付金額：需核對');
  assert.equal(model.paidAmount({...paid,paidAmountScope:'parcel'}).text,'本包裹實付：NT$1,234.5');
});
test('only explicit confirmed payment is shown, preserving zero and cents',()=>{
  assert.equal(model.paidAmount(paid).text,'實付金額：NT$1,234.5');
  assert.equal(model.paidAmount({...paid,paidAmount:0}).text,'實付金額：NT$0');
  for(const raw of [null,undefined,'',true,-1,'NaN','Infinity','1e3','1.001']){
    assert.equal(model.paidAmount({...paid,paidAmount:raw}).confirmed,false);
  }
  assert.equal(model.paidAmount({total:9999,total_price:9999}).confirmed,false);
  assert.equal(model.paidAmount({...paid,paidAmountStatus:'unknown'}).confirmed,false);
  assert.equal(model.paidAmount({...paid,paidCurrency:''}).confirmed,false);
  assert.equal(model.paidAmount({...paid,stale:true}).text,'實付金額：待更新');
});
test('list, selected detail and document summary show the same actual paid amount',()=>{
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{innerHTML:'',value:'',textContent:'',
      classList:{toggle(){}},addEventListener(){},querySelectorAll(){return [];}});
    return elements.get(id);
  };
  const row={key:'EasyStore:1',platform:'EasyStore',externalId:'1',channel:'蝦皮',
    orderNo:'TEST-ORDER',stage:'shipped',date:'2026-10-20',deliveryMethod:'蝦皮店到店 - 隔日到貨',items:[],...paid};
  const window={};window.self=window;window.top=window;
  const ctx=vm.createContext({window,ShippingModel:model,row,
    document:{getElementById:element,querySelector:()=>null,documentElement:{classList:{toggle(){}}}}});
  const code=fs.readFileSync(__dirname+'/shipping-ui/app.js','utf8').split("$('refresh').addEventListener")[0];
  vm.runInContext(code+'\ndata.orders=[row];selected=row.key;render();documentSummary(row);',ctx);
  for(const id of ['orders','detail','documentSummary']){
    assert.match(element(id).innerHTML,/實付金額：NT\$1,234\.5/);
    assert.match(element(id).innerHTML,/實付金額：NT\$1,234\.5<\/span><span class="delivery-method">蝦皮店到店 - 隔日到貨/);
  }
  // The extension reads h2 text as the order number; amount must be a sibling.
  assert.match(element('detail').innerHTML,/<h2>TEST-ORDER<\/h2>/);
  row.stale=true;
  vm.runInContext('render();documentSummary(row);',ctx);
  for(const id of ['orders','detail','documentSummary']){
    assert.match(element(id).innerHTML,/實付金額：待更新/);
    assert.doesNotMatch(element(id).innerHTML,/NT\$1,234/);
  }
});

test('delivery labels distinguish real carrier names from generic fee captions',()=>{
  assert.equal(model.deliveryMethod({carrier:'Shipping Fee'}),'配送方式待平台提供');
  assert.equal(model.deliveryMethod({carrier:'第三方物流-新竹貨運'}),'新竹貨運');
  assert.equal(model.deliveryMethod({carrierCode:'TWL_HCT'}),'新竹物流');
  assert.equal(model.deliveryMethod({deliveryMethod:'賣家自行配送',carrier:'Shipping Fee'}),'賣家自行配送');
});
