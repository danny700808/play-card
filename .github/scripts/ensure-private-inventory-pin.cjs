'use strict';
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const publicDefaults=new Set([hash('0000'),hash('youZI')]);
async function ensurePrivateInventoryPin({db,FieldValue,pinHash}){
  pinHash=String(pinHash||'').trim().toLowerCase();
  const ref=db.collection('opsSettings').doc('inventoryCount');
  return db.runTransaction(async tx=>{
    const snapshot=await tx.get(ref),row=snapshot.exists?snapshot.data():{},existing=String(row.pinHash||'').trim().toLowerCase();
    if(/^[a-f0-9]{64}$/.test(existing)&&!publicDefaults.has(existing))return {changed:false};
    if(!/^[a-f0-9]{64}$/.test(pinHash||'')||publicDefaults.has(pinHash))throw Error('A private inventory PIN must be provisioned before restricting access.');
    tx.set(ref,{pinHash,enabled:row.enabled!==false,updatedAt:FieldValue.serverTimestamp(),updatedBy:'private-access-migration',version:'20260914-private-pin'},{merge:true});
    return {changed:true};
  });
}
if(require.main===module){
  const admin=require('../../functions/node_modules/firebase-admin');
  admin.initializeApp({projectId:'youzi-c1b74',credential:admin.credential.applicationDefault()});
  ensurePrivateInventoryPin({db:admin.firestore(),FieldValue:admin.firestore.FieldValue,pinHash:process.env.INVENTORY_COUNT_PIN_HASH||''})
    .then(result=>console.log(result.changed?'Private inventory PIN provisioned.':'Existing private inventory PIN preserved.'))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={ensurePrivateInventoryPin};
