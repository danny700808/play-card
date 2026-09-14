'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {database}=require('./helpers/security-fixtures.cjs');
const source=fs.readFileSync(path.join(__dirname,'../functions/index.js'),'utf8');
function handler(name,fixture,failNotice=false){
  const start=source.indexOf('exports.'+name+' ='),end=source.indexOf('\nexports.',start+1),context={Object,exports:{},httpEndpoint:fn=>fn,...fixture,
    clean:v=>String(v??'').trim(),nowText:()=> '2026-09-14 16:30',randomId:prefix=>prefix+'-test',webBaseUrl:()=> 'https://example.test/',
    stripUndefined:x=>x,stripRentalInlineAssets:x=>x,admin:{firestore:{FieldValue:fixture.FieldValue,Timestamp:{fromMillis:n=>new Date(n)}}},
    rentalAssetUrls:row=>({signatureUrl:row.customerSignatureUrl||row.signatureUrl,idImageUrl:row.customerIdImageUrl||row.idImageUrl}),
    getContractForToken:async id=>{const ref=fixture.db.collection('rentalContracts').doc(id),snap=await ref.get();return {ref,contract:{__id:id,...snap.data()}};},
    getRentalApplicationData:async()=>({}),buildRentalManagerNotice:()=> 'Notice',
    queueManagerNotification:async(data,writer)=>{if(failNotice)throw Error('queue failed');writer.set(fixture.db.collection('notificationQueue').doc('manager'),data);},
    createCustomerNotificationQueues:async(data,writer)=>writer.set(fixture.db.collection('notificationQueue').doc('customer'),data),
    require:name=>name.startsWith('./')?require(path.join(__dirname,'../functions',name)):require(name)
  };
  vm.runInNewContext(source.slice(start,end),context);return context.exports[name];
}
const row={signToken:'secret',status:'待簽名',endDate:'2026-09-30',rentalType:'digitalPiano'};
const url=name=>'https://us-central1-youzi-c1b74.cloudfunctions.net/privateContractAssetHttp?'+new URLSearchParams({kind:'rental',id:'c1',token:'secret',path:'rental-contracts/c1/private/'+name+'.png'});
test('actual rental sign handler commits contract and notifications together and deduplicates a retry',async()=>{
  const f=database({'rentalContracts/c1':row}),input={contractId:'c1',token:'secret',customerIdNumber:'ID',customerSignatureUrl:url('sig'),customerIdImageUrl:url('id')};
  await assert.rejects(handler('rentalSignContractHttp',f,true)(input));assert.equal(f.rows.get('rentalContracts/c1').status,'待簽名');assert.equal(f.rows.size,1);
  await handler('rentalSignContractHttp',f)(input);assert.equal(f.rows.get('rentalContracts/c1').status,'待付款確認');assert(f.rows.has('notificationQueue/customer'));
  await handler('rentalSignContractHttp',f,true)(input);
});
test('actual renewal and return handlers cannot reopen a closed contract or partially create requests',async()=>{
  for(const name of ['rentalSubmitRenewalRequestHttp','rentalSubmitReturnRequestHttp']){
    const f=database({'rentalContracts/c1':{...row,status:'已退租'}}),input={contractId:'c1',token:'secret',periods:1};
    await assert.rejects(handler(name,f)(input),/已結束/);assert.equal(f.rows.size,1);
    f.rows.get('rentalContracts/c1').status='租賃中';await assert.rejects(handler(name,f,true)(input),/queue failed/);assert.equal(f.rows.size,1);
    await handler(name,f)(input);assert(f.rows.has('notificationQueue/customer'));assert.equal(f.rows.size,4);
  }
});
