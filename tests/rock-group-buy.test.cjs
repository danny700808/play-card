const {test}=require('node:test');
const assert=require('node:assert/strict');
const {orderPlan,changeReservation}=require('../functions/rock-group-buy/logic');
const catalog=require('../functions/rock-group-buy/catalog.json');
const config=()=>({products:structuredClone(catalog),revision:1,roster:[{id:'student',className:'學校 / 班級',name:'測試'}]});
const plan=(c,ids)=>orderPlan(c,'student',ids.map(id=>({id,quantity:1})),false);
test('guitar stock and accessory data',()=>{for(const p of catalog.filter(p=>p.family==='irin')){assert.equal(p.total,3);assert.equal(p.price,5250);for(const text of ['15mm','Pick 4','3m','背帶','調音器'])assert.ok(p.description.includes(text));}});
test('all bundle totals and standalone amplifier prices',()=>{
 for(const guitar of ['irin-white','irin-black'])for(const [amp,total] of [['joyo-ja01',5500],['s4',6750],['aroma',7250],['m-vave',7750]])assert.equal(plan(config(),[guitar,amp]).total,total);
 for(const [amp,total] of [['s4',1650],['aroma',2350],['m-vave',2750]])assert.equal(plan(config(),[amp]).total,total);
 assert.throws(()=>plan(config(),['joyo-ja01']),/僅限/);
});
test('one guitar and one amp; no duplicate lines or sold-out orders',()=>{
 assert.throws(()=>plan(config(),['irin-white','irin-black']),/最多/);
 assert.throws(()=>plan(config(),['s4','aroma']),/最多/);
 assert.throws(()=>plan(config(),['s4','s4']));
 const c=config();for(let i=0;i<3;i++)changeReservation(c,plan(c,['irin-white']).items,1);
 assert.throws(()=>plan(c,['irin-white']),/剩餘數量不足/);
 assert.equal(plan(c,['irin-black']).total,5250);
 changeReservation(c,[{id:'irin-white',quantity:1}],-1);
 assert.equal(plan(c,['irin-white']).total,5250);
});

test('Farida variants, bundle totals and independent stock',()=>{
 for(const id of ['farida-pink','farida-gray','farida-green']){
  const c=config();const p=c.products.find(p=>p.id===id);assert.equal(p.total,1);assert.equal(p.price,6500);
  for(const [amp,extra] of [['joyo-ja01',250],['s4',1500],['aroma',2000],['m-vave',2500]])assert.equal(plan(c,[id,amp]).total,6500+extra);
  changeReservation(c,plan(c,[id]).items,1);assert.throws(()=>plan(c,[id]),/剩餘數量不足/);assert.equal(plan(c,['irin-white']).total,5250);
 }
 assert.throws(()=>plan(config(),['irin-white','farida-green']),/最多/);
 assert.equal(catalog.find(p=>p.id==='s4').name,'SCURU S4 音箱');
 assert.equal(catalog.find(p=>p.id==='aroma').name,'AROMA TG08 音箱');
 assert.equal(catalog.find(p=>p.id==='m-vave').name,'M-VAVE SP100 音箱');
});
test('Ibanez color quotas and bundle prices',()=>{
 for(const [id,total] of [['ibanez-black',1],['ibanez-white',2],['ibanez-blue',1],['ibanez-pink',1]]){
  const c=config();assert.equal(c.products.find(p=>p.id===id).total,total);
  for(const [amp,extra] of [['joyo-ja01',250],['s4',1500],['aroma',2000],['m-vave',2500]])assert.equal(plan(c,[id,amp]).total,7500+extra);
  for(let i=0;i<total;i++)changeReservation(c,plan(c,[id]).items,1);
  assert.throws(()=>plan(c,[id]),/剩餘數量不足/);
 }
 assert.throws(()=>plan(config(),['farida-pink','ibanez-white']),/最多/);
});
test('Tagima shares 6500 group with distinct name and one guitar quota',()=>{
 const c=config(),p=c.products.find(p=>p.id==='tagima-white');assert.equal(p.total,1);assert.equal(p.family,'farida');assert.match(p.name,/Tagima TG520/);
 for(const [amp,extra] of [['joyo-ja01',250],['s4',1500],['aroma',2000],['m-vave',2500]])assert.equal(plan(c,[p.id,amp]).total,6500+extra);
 changeReservation(c,plan(c,[p.id]).items,1);assert.throws(()=>plan(c,[p.id]),/剩餘數量不足/);assert.equal(plan(c,['farida-pink']).total,6500);
});
test('Ibanez macaron green is an additional one-unit variant',()=>{
 const c=config(),p=c.products.find(p=>p.id==='ibanez-green');assert.equal(p.total,1);assert.equal(p.sku,'1040136-5');assert.equal(c.products.find(p=>p.id==='ibanez-blue').sku,'1040136-3');assert.equal(plan(c,[p.id,'s4']).total,9000);changeReservation(c,plan(c,[p.id]).items,1);assert.throws(()=>plan(c,[p.id]),/剩餘數量不足/);
});
test('bass prices, limited stock and instrument selection',()=>{
 for(const [id,price] of [['bass-irin',5800],['bass-bensons',5500]]){const c=config();const order=plan(c,[id]);assert.equal(order.total,price);for(let i=0;i<c.products.find(p=>p.id===id).total;i++)changeReservation(c,order.items,1);assert.throws(()=>plan(c,[id]),/剩餘數量不足/);}
 assert.throws(()=>plan(config(),['bass-irin','irin-white']),/最多/);
 assert.throws(()=>plan(config(),['bass-irin','marshall-mg10']),/Bass/);
});
