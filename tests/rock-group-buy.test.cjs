const {test}=require('node:test');
const assert=require('node:assert/strict');
const {orderPlan,changeReservation}=require('../functions/rock-group-buy/logic');
const catalog=require('../functions/rock-group-buy/catalog.json');
const config=()=>({products:structuredClone(catalog),revision:1,roster:[{id:'student',className:'學校 / 班級',name:'測試'}]});
const plan=(c,ids)=>orderPlan(c,'student',ids.map(id=>({id,quantity:1})),false);
test('guitar stock and accessory data',()=>{for(const p of catalog.filter(p=>p.kind==='guitar')){assert.equal(p.total,3);assert.equal(p.price,5250);for(const text of ['15mm','Pick 4','3m','背帶','調音器'])assert.ok(p.description.includes(text));}});
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
