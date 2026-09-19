'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.GCLOUD_PROJECT='youzi-c1b74';
const functions=require('../functions/courseLoginIndexV3');
test('every website HTTP and callable handler has a Taiwan deployment',()=>{
  let count=0;
  for(const [name,fn] of Object.entries(functions)){
    const endpoint=JSON.parse(JSON.stringify(fn.__endpoint));
    if(!endpoint?.httpsTrigger&&!endpoint?.callableTrigger)continue;
    count++;
    assert(endpoint.region.includes('asia-east1'),name);
    assert(!endpoint.minInstances||endpoint.minInstances===0,name+' must not enable paid idle instances');
    if(!name.endsWith('Taiwan'))assert(endpoint.region.includes('us-central1'),name+' must preserve old clients during cutover');
  }
  assert(count>=180);
});
test('background jobs have exactly one region, preventing duplicated scheduled actions',()=>{
  for(const [name,fn] of Object.entries(functions)){
    const endpoint=JSON.parse(JSON.stringify(fn.__endpoint));
    if(endpoint&&!endpoint.httpsTrigger&&!endpoint.callableTrigger)assert.equal(endpoint.region.length,1,name);
  }
});
