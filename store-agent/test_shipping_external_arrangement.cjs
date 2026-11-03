const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const model=require('./shipping-ui/model.js');
const row={key:'Coupang:123',platform:'Coupang',channel:'酷澎',orderNo:'TEST',status:'DEPARTURE',
  stage:'label',tracking:'ORIGINAL',canCreate:false,canDownload:true,handled:true,
  handlingAction:'arranged',handlingSource:'平台',handledAt:'',printCount:0,documentReady:false,items:[],date:''};

test('external arrangement appears only in handled list with original-label retrieval',()=>{
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,
      addEventListener(){},querySelectorAll(){return [];},classList:{toggle(){}}});
    return elements.get(id);
  };
  const window={ShippingTransport:{api(){assert.fail('render must never contact platform');}}};
  window.self=window;window.top=window;
  const ctx=vm.createContext({window,ShippingModel:model,row,
    document:{getElementById:element,querySelector:()=>null,documentElement:{classList:{toggle(){}}}}});
  vm.runInContext(fs.readFileSync(__dirname+'/shipping-ui/app.js','utf8').split("$('refresh').addEventListener")[0]+
    '\ndata.orders=[row];selected=row.key;',ctx);
  assert.equal(vm.runInContext("activeWork='pending';filtered().length",ctx),0);
  assert.equal(vm.runInContext("activeWork='done';filtered().length",ctx),1);
  vm.runInContext('render()',ctx);
  assert.match(element('orders').innerHTML,/已安排出貨/);
  assert.match(element('detail').innerHTML,/<button id="prepare" class="primary" >取回原貨運單<\/button>/);
  assert.doesNotMatch(element('detail').innerHTML,/已處理 · 已印單|已處理 · 已取單|開啟列印 \d+ 次/);
});

test('external arrangement keeps download-only review and never marks or prints during retrieval',async()=>{
  const calls=[];
  await model.obtainDocument(async(path,body)=>{
    calls.push({path,body});
    return path==='/api/preview'?{...row,action:'download',fingerprint:'fresh'}:{ready:true};
  },row,{});
  assert.deepEqual(calls.map(c=>c.path),['/api/preview','/api/process']);
  assert.equal(calls[1].body.fingerprint,'fresh');
  let submissions=0;
  await assert.rejects(model.obtainDocument(async path=>{
    if(path==='/api/process')submissions++;
    return {...row,action:'create',fingerprint:'changed'};
  },row,{}),/未申請新出貨/);
  assert.equal(submissions,0);
});

test('arrangement caption does not replace genuine acquired or printed history',()=>{
  assert.equal(model.status(row),'已安排出貨');
  assert.equal(model.documentActionLabel(row),'取回原貨運單');
  assert.equal(model.status({...row,handlingAction:'printed'}),'已印單');
  assert.equal(model.documentActionLabel({...row,handlingAction:'printed'}),'重印貨運單');
  assert.equal(model.status({...row,handlingAction:'acquired'}),'已取單');
  assert.equal(model.documentActionLabel({...row,handlingAction:'acquired'}),'列印貨運單');
});
