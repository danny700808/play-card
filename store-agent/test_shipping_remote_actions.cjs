const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('./shipping-ui/model.js');

function render(overrides={},remote=true){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{innerHTML:'',addEventListener(){},querySelectorAll(){return [];}});
    return elements.get(id);
  };
  const window={ShippingTransport:remote?{ready(){}}:undefined,addEventListener(){}};
  window.self=window;window.top=window;
  const context={window,ShippingModel:model,document:{getElementById:element,querySelector(){return null;},documentElement:{classList:{toggle(){}}}},setInterval(){}};
  const source=fs.readFileSync(__dirname+'/shipping-ui/app.js','utf8');
  // Render the real order-detail function without making any network request.
  vm.runInNewContext(source.split("$('refresh').addEventListener")[0]+`
    data.orders=[${JSON.stringify({key:'EasyStore:123',platform:'EasyStore',channel:'蝦皮',externalId:'123',orderNo:'TEST',stage:'pending',items:[],...overrides})}];
    selected=data.orders[0].key;renderDetail();`,context);
  return element('detail').innerHTML;
}
test('ready Shopee order opens the shared dialog, retaining only a hidden legacy locator',()=>{
  const html=render({tracking:'tracking'});
  assert.match(html,/href="https:\/\/admin.easystore.co\/channels\/shopee\/taiwan\/orders\/awb\?store_order_ids=123"/);
  assert.match(html,/<a hidden aria-hidden="true" tabindex="-1" data-shopee-helper-target href=/);
  assert.match(html,/<button id="shopeeDirectPrint"/);
  assert.doesNotMatch(html,/id="shopeeDirectPrint"[^>]+href=/);
  assert.doesNotMatch(html,/到 EasyStore 出貨|href="https:\/\/admin.easystore.co\/orders\//);
  assert.doesNotMatch(html,/貨運單尚待主機提供/);
});
test('new Shopee order keeps only a hidden helper locator and never redirects the user to store orders',()=>{
  const html=render();
  assert.match(html,/href="https:\/\/admin.easystore.co\/orders\/123"/);
  assert.match(html,/<a hidden aria-hidden="true" tabindex="-1" data-shopee-helper-target/);
  assert.match(html,/取得貨運單/);
  assert.doesNotMatch(html,/到 EasyStore 出貨|class="action-link primary"/);
  assert.doesNotMatch(html,/id="prepare"|id="showProvidedDocument"/);
});
test('existing official PDF keeps the local printing route for both desks',()=>{
  for(const remote of [true,false]){
    const html=render({documentReady:true},remote);
    assert.match(html,/id="showProvidedDocument"/);
    assert.doesNotMatch(html,/href="https:\/\/admin.easystore.co/);
  }
});
test('cancelled, review, stale and invalid ids cannot open an external shipping action',()=>{
  for(const row of [{stage:'cancelled',tracking:'x'},{stage:'review',tracking:'x'},{stale:true,tracking:'x'},{externalId:'123&other=456'}]){
    assert.doesNotMatch(render(row),/href="https:\/\/admin.easystore.co/);
  }
});
test('MOMO and Coupang retain their document acquisition buttons',()=>{
  for(const platform of ['MOMO','Coupang']){
    assert.match(render({platform,canDownload:true}),/id="prepare"/);
  }
});

test('a cancelled MOMO order cannot be manually marked printed or shipped',()=>{
  const html=render({platform:'MOMO',channel:'MOMO',stage:'cancelled',canCreate:false,canDownload:false,
    blockReason:'此訂單已由 MOMO 取消，不需出貨或列印。'});
  assert.doesNotMatch(html,/id="markPrinted"|id="markShipped"/);
  assert.match(html,/<button id="packing" disabled>/);
  assert.match(html,/此訂單已由 MOMO 取消/);
});

test('all platforms use identical action names for the same handling state',()=>{
  for(const [state,label] of [[{},'取得貨運單'],[{documentReady:true,handlingAction:'acquired'},'列印貨運單'],[{handlingAction:'printed'},'重印貨運單'],[{stage:'shipped'},'重印貨運單']]){
    for(const platform of ['EasyStore','MOMO','Coupang']){
      const html=render({platform,canCreate:true,...state});
      assert.match(html,new RegExp('class="primary"[^>]*>'+label+'<'));
      assert.doesNotMatch(html,/取得蝦皮|XP-420B|確認備貨並取單|申請出貨與貨運單/);
    }
  }
});
