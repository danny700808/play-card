const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {database}=require('./helpers/security-fixtures.cjs');
const {createInventoryCountAccess}=require('../functions/inventoryCountAccess');
function fixture(){const f=database({'opsSettings/inventoryCount':{enabled:true,pinHash:crypto.createHash('sha256').update('test-only-pin').digest('hex')},'opsInternalProducts/p1':{internalName:'Guitar',internalSku:'1234567',storePrice:3200,status:'active',latestPurchaseCost:1000}});let now=100;return {f,api:createInventoryCountAccess({...f,now:()=>now}),expire:()=>now+=9*3600000};}
test('shared PIN unlocks barcode product names, SKU and retail prices without costs',async()=>{const {api}=fixture();const {token}=await api.login({pin:'test-only-pin'});const row=(await api.products({token,action:'barcode'})).products[0];assert.equal(row.internalName,'Guitar');assert.equal(row.internalSku,'1234567');assert.equal(row.storePrice,3200);assert.equal(row.latestPurchaseCost,undefined);assert.equal((await api.products({token})).products[0].storePrice,undefined);});
test('wrong PIN, fake sessions and expired sessions cannot load barcode products',async()=>{const f=fixture();await assert.rejects(f.api.login({pin:'wrong'}));await assert.rejects(f.api.products({token:'fake',action:'barcode'}));const {token}=await f.api.login({pin:'test-only-pin'});f.expire();await assert.rejects(f.api.products({token,action:'barcode'}));});
test('frontend uses shared password service and renders returned retail price without manager auth',async()=>{
 const source=fs.readFileSync('barcode-print.js','utf8'),nodes=new Map(),events=[];
 const $=id=>{if(!nodes.has(id))nodes.set(id,{focus(){},addEventListener(name,fn){this[name]=fn;}});return nodes.get(id);};
 const ctx={state:{},$,productRequest:async(name,data)=>{events.push([name,data.action]);return {products:[{id:'p1',internalName:'Guitar',storePrice:3200}]};},normalize:doc=>({...doc.data(),enabled:true}),applySearch:()=>events.push('render'),esc:x=>x,showLogin(){}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  async function loadProducts(){'),source.indexOf('  async function initApp(){')),ctx);await ctx.loadProducts();assert.equal(ctx.state.products[0].storePrice,3200);assert.deepEqual(events,[['inventoryCountProductsHttp','barcode'],'render']);
 assert(!source.includes('requireManager'));assert(!source.includes('login.html'));assert(source.includes("productRequest('inventoryCountLoginHttp',{pin:input.value.trim()})"));
});
