const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/reader.js','utf8');
function run({carrier='新竹物流\n出貨期限: 明天',id='123',order='SHOPEE1',login=false,headers=['訂單編號','物流商']}={}){
  const links=[{href:`https://admin.easystore.co/orders/${id}`,innerText:'#100'},
    {href:'https://admin.easystore.co/channels/shopee/taiwan/orders/456',innerText:order}];
  const row={querySelectorAll:s=>s==='td'?[{innerText:order},{innerText:carrier}]:links};
  const table={innerText:'current-page',querySelectorAll:s=>s==='tbody tr'?[row]:headers.map(innerText=>({innerText}))};
  const document={querySelectorAll:()=>login?[]:[table],querySelector:()=>null};
  const ctx=vm.createContext({URL,document,location:{origin:'https://admin.easystore.co',pathname:login?'/login':'/channels/shopee/taiwan/orders'},module:{exports:{}}});
  vm.runInContext(source,ctx);
  return ctx.module.exports.readDeliveryPage([{key:'EasyStore:123',externalId:'123',orderNo:'SHOPEE1'}]);
}
test('read exact carrier from rendered cell without deadline text',()=>{
  for(const carrier of ['新竹物流','蝦皮店到店','店到家宅配','賣家宅配：大型/超重物品運送']){
    const result=run({carrier:carrier+'\n出貨期限: 明天'});
    assert.equal(result.results[0].deliveryMethod,carrier);
  }
});
test('both store ID and Shopee number must match; generic fees are not carriers',()=>{
  for(const args of [{id:'999'},{order:'OTHER'},{carrier:'Shipping Fee'},{carrier:'-'}])
    assert.equal(run(args).results.length,0);
});
test('login or missing table never yields a guessed carrier',()=>{
  assert.equal(run({login:true}).error,'login');
  assert.equal(run({headers:['訂單','金額']}).results.length,0);
});
