'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {database}=require('./helpers/security-fixtures.cjs');
const {ensurePrivateInventoryPin}=require('../.github/scripts/ensure-private-inventory-pin.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
test('one-time PIN provisioning replaces only absent or public defaults and preserves private settings',async()=>{
  for(const current of [undefined,{pinHash:hash('0000')},{pinHash:hash('youZI'),enabled:false}]){
    const f=database(current?{'opsSettings/inventoryCount':current}:{});
    assert.equal((await ensurePrivateInventoryPin({...f,pinHash:hash('random-private-pin')})).changed,true);
    assert.equal(f.rows.get('opsSettings/inventoryCount').pinHash,hash('random-private-pin'));
    assert.equal(f.rows.get('opsSettings/inventoryCount').enabled,current?.enabled!==false);
    assert.equal((await ensurePrivateInventoryPin({...f,pinHash:''})).changed,false);
  }
  const f=database();await assert.rejects(ensurePrivateInventoryPin({...f,pinHash:''}));assert.equal(f.rows.size,0);
});
