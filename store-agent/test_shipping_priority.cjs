const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const model=require('./shipping-ui/model.js');
const now=new Date('2026-11-19T12:00:00+08:00');
const deadline=(at,precision='minute')=>({shippingDeadlineText:at,shippingDeadlineAt:at,shippingDeadlinePrecision:precision,shippingDeadlineSource:'EasyStore 蝦皮通路後台',shippingDeadlineVerifiedAt:'2026-11-19T11:00:00+08:00'});
test('HCT aliases across platforms group together while missing logistics remain visible',()=>{
 for(const carrier of ['新竹貨運','新竹物流','HCT','第三方物流-新竹貨運'])assert.equal(model.logisticsGroup({carrier}),'hct');
 assert.equal(model.logisticsGroup({carrierCode:'TWL_HCT'}),'hct');
 assert.equal(model.logisticsGroup({deliveryMethod:'全家店到店'}),'other');
 assert.equal(model.logisticsGroup({carrier:'Shipping Fee'}),'unknown');
});
test('date-only deadlines do not become overdue during that day; stale deadlines lose urgency',()=>{
 assert.equal(model.shippingDeadline(deadline('2026-11-19T00:00:00+08:00','date'),now).tone,'today');
 assert.equal(model.shippingDeadline(deadline('2026-11-18T23:00:00+08:00'),now).tone,'overdue');
 assert.equal(model.shippingDeadline({...deadline('2026-11-19T17:00:00+08:00'),shippingDeadlineNote:'讀取逾時'},now).sort,Infinity);
 assert.equal(model.shippingDeadline({...deadline('2026-11-19T17:00:00+08:00'),shippingDeadlineVerifiedAt:'2026-11-17T11:00:00+08:00'},now).tone,'unknown');
 assert.match(model.shippingDeadline({},now).text,/待確認/);
 assert.equal(model.shippingDeadline({...deadline('2026-11-18T23:00:00+08:00'),handled:true},now).tone,'normal');
});
test('earliest verified platform deadline sorts first, never the 17:00 shop reminder',()=>{
 const rows=[{orderNo:'unknown'}, {orderNo:'later',...deadline('2026-11-20T12:00:00+08:00')},{orderNo:'earlier',...deadline('2026-11-19T14:00:00+08:00')}];
 rows.sort((a,b)=>model.compareShippingPriority(a,b,now));assert.deepEqual(rows.map(r=>r.orderNo),['earlier','later','unknown']);
});
test('logistics filters intersect platform and pending status, and preserve unknown orders',()=>{
 const source=fs.readFileSync(__dirname+'/shipping-ui/app.js','utf8').split("$('refresh').addEventListener")[0];
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false});return elements.get(id);};
 const window={};window.self=window;window.top=window;
 const rows=[{key:'1',channel:'蝦皮',carrier:'新竹物流',handled:false},{key:'2',channel:'MOMO',carrier:'新竹貨運',handled:false},{key:'3',channel:'蝦皮',carrier:'Shipping Fee',handled:false},{key:'4',channel:'MOMO',carrier:'新竹貨運',handled:true}].map(r=>({...r,orderNo:r.key,date:'2026-11-19',items:[]}));
 const ctx=vm.createContext({window,ShippingModel:model,rows,document:{getElementById:element,querySelector:()=>null,documentElement:{classList:{toggle(){}}}}});
 vm.runInContext(source+"\ndata.orders=rows;renderDetail=()=>{};activeLogistics='hct';render();",ctx);
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(filtered().map(r=>r.key))',ctx)),['1','2']);
 assert.match(element('orders').innerHTML,/新竹物流／貨運訂單/);assert.match(element('orders').innerHTML,/MOMO/);
 vm.runInContext("activeChannel='蝦皮';render();",ctx);assert.equal(vm.runInContext('filtered().length',ctx),1);
 vm.runInContext("activeLogistics='unknown';render();",ctx);assert.equal(vm.runInContext('filtered()[0].key',ctx),'3');
 vm.runInContext("activeWork='done';activeChannel='全部';render();",ctx);assert.equal(vm.runInContext('filtered()[0].key',ctx),'4');assert.equal(element('logisticsTabs').hidden,true);
});
