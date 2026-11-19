const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const model=require('./shipping-ui/model.js');
const now=new Date('2026-11-19T12:00:00+08:00');
const deadline=(at,precision='minute')=>({shippingDeadlineText:at,shippingDeadlineAt:at,shippingDeadlinePrecision:precision,shippingDeadlineSource:'EasyStore 蝦皮通路後台',shippingDeadlineVerifiedAt:'2026-11-19T11:00:00+08:00'});
test('missing MOMO deadlines preserve the host diagnosis and visibly escape it',()=>{
 const source=fs.readFileSync(__dirname+'/shipping-ui/app.js','utf8').split("$('refresh').addEventListener")[0];
 const window={};window.self=window;window.top=window;
 const ctx=vm.createContext({window,ShippingModel:model,document:{querySelector:()=>null,documentElement:{classList:{toggle(){}}}}});
 vm.runInContext(source,ctx);
 for(const note of ['主機配送讀取助手仍在執行舊版，請重新載入 1.1.0。','請在主機 Chrome 重新登入 MOMO 後台。','MOMO 後台期限讀取逾時。']){
  ctx.row={channel:'MOMO',shippingDeadlineNote:note};
  assert.equal(model.shippingDeadline(ctx.row,now).note,note);
  assert.equal(model.shippingDeadline(ctx.row,now).sort,Infinity);
  const html=vm.runInContext('deadlineHtml(row)',ctx);
  assert.ok(html.includes(`<span class="shipping-deadline-reason">${note}</span>`));
 }
 ctx.row={channel:'MOMO',shippingDeadlineNote:'<img src=x onerror=alert(1)>'};
 const html=vm.runInContext('deadlineHtml(row)',ctx);
 assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));
 ctx.row={channel:'MOMO'};
 assert.ok(!vm.runInContext('deadlineHtml(row)',ctx).includes('shipping-deadline-reason'));
});
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

test('photographed EasyStore day-first deadlines render year-month-day in 24-hour time',()=>{
 const source={shippingDeadlineSource:'本機 EasyStore 蝦皮通路後台',shippingDeadlineVerifiedAt:now.toISOString()};
 const evening={...source,shippingDeadlineText:'19-11-2026, 7:00 晚上'};
 const midnight={...source,shippingDeadlineText:'20-11-2026, 11:59 晚上'};
 assert.equal(model.shippingDeadline(evening,now).text,'最晚出貨：2026年11月19日 19:00（今日截止）');
 assert.equal(model.shippingDeadline(midnight,now).text,'最晚出貨：2026年11月20日 23:59');
 assert.equal(model.shippingDeadline(evening,now).sort,Date.parse('2026-11-19T19:00:00+08:00'));
 assert.match(model.shippingDeadline(evening,now).note,/19-11-2026, 7:00 晚上/);
 const row={key:'EasyStore:123',externalId:'123',orderNo:'TEST1234567890',platform:'EasyStore',channel:'蝦皮'};
 const patch=model.localLogistics(row,{...row,deliveryMethod:'蝦皮店到店',shippingDeadlineText:midnight.shippingDeadlineText,evidenceUrl:'https://admin.easystore.co/channels/shopee/taiwan/orders/456'},now.toISOString());
 assert.equal(patch.shippingDeadlineAt,'2026-11-20T23:59:00+08:00');
});

test('deadline formatting keeps date-only precision and uses Taiwan calendar for explicit instants',()=>{
 assert.equal(model.shippingDeadline({...deadline('2026-11-19T00:00:00+08:00','date'),handled:true},now).text,'最晚出貨：2026年11月19日');
 assert.equal(model.shippingDeadline({...deadline('2026-11-19T16:30:00Z'),handled:true},now).text,'最晚出貨：2026年11月20日 00:30');
 for(const [value,expected] of [['12:00 上午','00:00'],['12:00 下午','12:00'],['7:00 晚上','19:00']]){
  assert.equal(model.parseShippingDeadline('19-11-2026, '+value,now.toISOString(),true).at,'2026-11-19T'+expected+':00+08:00');
 }
 assert.equal(model.parseShippingDeadline('明天 下午 7:00','2026-12-31T23:30:00+08:00').at,'2027-01-01T19:00:00+08:00');
});

test('invalid calendars and ambiguous unsupported sources never gain a guessed sortable deadline',()=>{
 for(const value of ['30-02-2026, 7:00 晚上','19-11-2026, 13:00 晚上','2026-11-19 24:00','2026-11-19 12:60','2026-11-19 00:00 晚上'])assert.equal(model.parseShippingDeadline(value,now.toISOString(),true),null);
 const row={shippingDeadlineText:'05-06-2026, 7:00 晚上',shippingDeadlineSource:'MOMO',shippingDeadlineVerifiedAt:now.toISOString()};
 assert.equal(model.shippingDeadline(row,now).sort,Infinity);
 assert.equal(model.shippingDeadline({channel:'MOMO'},now).text,'最晚出貨：待確認');
});

test('local metadata preserves exact identities, calendar precision and API carrier priority',()=>{
 const row={key:'EasyStore:123',externalId:'123',orderNo:'TEST1234567890',platform:'EasyStore',channel:'蝦皮',deliveryMethod:'蝦皮店到店'};
 const observation={key:row.key,externalId:row.externalId,orderNo:row.orderNo,deliveryMethod:'新竹物流',shippingDeadlineText:'明天',evidenceUrl:'https://admin.easystore.co/channels/shopee/taiwan/orders/456'};
 const patch=model.localLogistics(row,observation,'2026-12-31T23:30:00+08:00');
 assert.equal(patch.shippingDeadlineAt,'2027-01-01T00:00:00+08:00');assert.equal(patch.shippingDeadlinePrecision,'date');assert.equal(patch.deliveryMethod,undefined);
 assert.equal(model.localLogistics(row,{...observation,orderNo:'OTHER'},now.toISOString()),null);
 assert.equal(model.localLogistics({...row,stale:true},observation,now.toISOString()),null);
 assert.equal(model.localLogistics(row,{...observation,shippingDeadlineText:'2026/02/30'},now.toISOString()).shippingDeadlineAt,'');
 assert.equal(model.localLogistics(row,{...observation,shippingDeadlineText:'2026/11/20 16:30'},now.toISOString()).shippingDeadlineAt,'2026-11-20T16:30:00+08:00');
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
