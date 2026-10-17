const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {database}=require('./helpers/security-fixtures.cjs');
const {createInventoryCountAccess}=require('../functions/inventoryCountAccess');
const day=86400000;
function setup(){let time=100;const f=database({'opsSettings/inventoryCount':{enabled:true,pinHash:crypto.createHash('sha256').update('test-pin').digest('hex')},'opsInternalProducts/p1':{internalName:'Book',currentStock:0}});return {...f,api:createInventoryCountAccess({...f,now:()=>time}),advance:n=>time+=n};}
test('remembered login lasts beyond eight hours and renews while used',async()=>{const f=setup(),{token}=await f.api.login({pin:'test-pin',remember:true});f.advance(80*day);assert.equal((await f.api.products({token,action:'barcode'})).products[0].currentStock,0);f.advance(80*day);await f.api.session(token);f.advance(91*day);await assert.rejects(f.api.session(token));});
test('logout revokes remembered token and cannot be undone by session use',async()=>{const f=setup(),{token}=await f.api.login({pin:'test-pin',remember:true});await f.api.login({action:'logout',token});await assert.rejects(f.api.session(token));await f.api.login({action:'logout',token});await assert.rejects(f.api.session(token));});
test('password changes and disabling access invalidate remembered sessions',async()=>{for(const change of [{pinHash:'a'.repeat(64)},{enabled:false}]){const f=setup(),{token}=await f.api.login({pin:'test-pin',remember:true});await f.db.collection('opsSettings').doc('inventoryCount').set(change,{merge:true});await assert.rejects(f.api.session(token));}});
test('unremembered login retains eight-hour expiry',async()=>{const f=setup(),{token}=await f.api.login({pin:'test-pin',remember:false});f.advance(9*3600000);await assert.rejects(f.api.session(token));});
