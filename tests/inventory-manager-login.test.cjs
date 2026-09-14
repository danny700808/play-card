const {test}=require('node:test'),assert=require('node:assert/strict');
const {database}=require('./helpers/security-fixtures.cjs');
const {createInventoryCountAccess}=require('../functions/inventoryCountAccess');
const req={headers:{authorization:'Bearer valid'}};
test('manager reads without PIN and saves under verified identity',async()=>{
 const f=database({'opsSettings/inventoryCount':{enabled:true},'opsInternalProducts/p1':{currentStock:2,internalSku:'P1',internalName:'Piano'}});
 let calls=0;const api=createInventoryCountAccess({...f,requireManager:async r=>{assert.equal(r,req);calls++;return {employeeId:'e1',email:'manager@example.test'};}});
 assert.equal((await api.products({},req)).products.length,1);
 await api.save({productId:'p1',operationId:'abcdefghijklmnop',target:3,expectedStock:2,operator:'forged'},req);
 assert.equal(f.rows.get('opsInternalProducts/p1').updatedBy,'manager@example.test');assert.equal(calls,2);
});
test('invalid manager identity cannot fall back to PIN or supplied claims',async()=>{
 const f=database();const api=createInventoryCountAccess({...f,requireManager:async()=>{throw Error('denied');}});
 await assert.rejects(api.products({manager:true,token:'x'},req),/denied/);
 await assert.rejects(api.products({manager:true}),/密碼/);
});
test('disabled inventory blocks manager access too',async()=>{
 const f=database({'opsSettings/inventoryCount':{enabled:false}});const api=createInventoryCountAccess({...f,requireManager:async()=>({employeeId:'e1'})});
 await assert.rejects(api.products({},req),/停用/);
});
test('login return survives LINE callback but rejects external and expired destinations',()=>{
 const fs=require('fs'),vm=require('vm'),source=fs.readFileSync('login.html','utf8');const code=source.slice(source.indexOf('    function requestedLoginTarget(){'),source.indexOf('    function redirectToLoginTarget'));
 const values=new Map(),location={search:'?next=inventory-count.html'};const ctx={window:{location},URLSearchParams,loginReturnPages:new Set(['inventory-count.html']),localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}};
 vm.createContext(ctx);vm.runInContext(code,ctx);assert.equal(ctx.requestedLoginTarget(),'inventory-count.html');location.search='?ticket=line-callback';assert.equal(ctx.requestedLoginTarget(),'inventory-count.html');location.search='?next=https://evil.test';assert.equal(ctx.requestedLoginTarget(),'');location.search='';values.set('youzi-login-return-v1',JSON.stringify({value:'inventory-count.html',expires:1}));assert.equal(ctx.requestedLoginTarget(),'');
});
