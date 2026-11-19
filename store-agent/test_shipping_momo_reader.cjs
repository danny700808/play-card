'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function read(rows,orders){
 const products=rows.map(r=>({innerText:'子訂單編號：'+r.seq+'\n'+r.label+'：'+r.deadline,parentElement:{innerText:'訂單編號: '+r.orderNo,parentElement:null}}));
 const ctx=vm.createContext({location:{origin:'https://3p.momo.com.tw',pathname:'/FrameServlet.do'},document:{querySelectorAll:s=>s==='.product__right'?products:[],querySelector:()=>null},module:{exports:{}}});
 vm.runInContext(fs.readFileSync(__dirname+'/../delivery-reader/momo-reader.js','utf8'),ctx);
 return JSON.parse(JSON.stringify(ctx.module.exports.readMomoPage(orders)));
}
const order={key:'MOMO:66111900000001:001',externalId:'66111900000001',orderNo:'66111900000001'};
const base={orderNo:order.orderNo,seq:'001',label:'最晚出貨時間',deadline:'2026/11/20'};
test('reads only the explicitly labelled matching deadline and retains date-only precision',()=>{
 assert.equal(read([base],[order]).results[0].shippingDeadlineText,'2026/11/20');
 for(const row of [{...base,seq:'002'},{...base,orderNo:'66111900000002'},{...base,label:'預計出貨日'},{...base,label:'已出貨日期'}])assert.deepEqual(read([row],[order]).results,[]);
});
test('missing or contradictory suborders never produce a package deadline',()=>{
 const combined={...order,key:order.key+',002'};
 assert.deepEqual(read([base],[combined]).results,[]);
 assert.deepEqual(read([base,{...base,deadline:'2026/11/21'}],[order]).results,[]);
 assert.equal(read([base,{...base,seq:'002'}],[combined]).results.length,1);
 assert.deepEqual(read([base,{...base,seq:'002',deadline:'2026/11/21'}],[combined]).results,[]);
});
test('freight can be excluded only by the requested physical suborder identifiers',()=>{
 const combined={...order,key:order.key+',002',orderSeqs:['001']};
 assert.equal(read([base],[combined]).results.length,1);
});
