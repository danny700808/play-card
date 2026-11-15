const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {database}=require('./helpers/security-fixtures.cjs');
test('registration approval notice asks for bank details without claiming a signed contract; old contract notice is retained',async()=>{
 for(const registrationOnly of [true,false]){
  const f=database();const db={collection:name=>({doc:id=>{const ref=f.db.collection(name).doc(id);return {...ref,create:async value=>{assert(!f.rows.has(ref.path));await ref.set(value);}};}})};const admin={firestore:Object.assign(()=>db,{FieldValue:f.FieldValue})},out={exports:{}};
  const mocks={'firebase-functions/v2/firestore':{onDocumentWritten:(options,fn)=>fn},'firebase-functions/v2/scheduler':{onSchedule:(options,fn)=>fn},'firebase-admin':admin};
  vm.runInNewContext(fs.readFileSync('functions/portalContractNotices.js','utf8'),{module:out,exports:out.exports,require:name=>mocks[name]||require('../functions/'+name.replace('./',''))});
  const handlers={};out.exports.registerPortalContractNotices(handlers);
  const row={name:'Teacher',status:'active',lineUserId:'U_test',bindingMethod:'line',registrationOnly,contractStatus:registrationOnly?'not_requested':'active'};
  await handlers.portalLegacyContractNotice({params:{id:'test'},data:{before:{exists:true,data:()=>({status:'submitted_pending_admin'})},after:{exists:true,data:()=>row}}});
  const notices=[...f.rows.values()];assert.equal(notices.length,1);const note=notices[0];
  if(registrationOnly){assert.match(note.title,/資料審核/);assert.match(note.body,/台新銀行/);assert.match(note.body,/契約尚未開放/);assert.doesNotMatch(note.body,/確認生效/);}
  else assert.match(note.body,/契約已由柚子樂器確認生效/);
 }
});
