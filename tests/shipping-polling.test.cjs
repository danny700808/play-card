const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
function fixture(results){
  const waits=[],requests=[],window={};
  const context={window,location:{search:''},URLSearchParams,AbortSignal,
    crypto:{randomUUID:()=> 'one-request-id'},localStorage:{getItem:()=> 'session'},
    document:{getElementById:()=>({})},setTimeout(fn,ms){waits.push(ms);fn();},
    fetch:async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);
      return {ok:true,json:async()=>body.action==='enqueue'?{jobId:'one-job'}:results.shift()};}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../shipping-desk.js','utf8'),context);
  return {api:window.ShippingTransport.api,waits,requests};
}
test('short completed jobs return promptly with only one enqueue',async()=>{
  const f=fixture([{status:'done',result:{ok:true}}]);
  assert.equal((await f.api('/api/process',{fingerprint:'reviewed'})).ok,true);
  assert.deepEqual(f.waits,[300]);
  assert.equal(f.requests.filter(r=>r.action==='enqueue').length,1);
  assert.equal(f.requests[0].body.fingerprint,'reviewed');
});
test('long jobs back off while polling the same job without resubmission',async()=>{
  const f=fixture([...Array.from({length:9},()=>({status:'running'})),{status:'done',result:{ok:true}}]);
  await f.api('/api/process',{});
  assert.equal(f.waits[0],300);assert.equal(f.waits[1],600);assert.equal(f.waits[8],1200);
  assert.equal(f.requests.filter(r=>r.action==='enqueue').length,1);
  assert.ok(f.requests.slice(1).every(r=>r.jobId==='one-job'));
});
test('failed jobs surface their error and never retry shipping',async()=>{
  const f=fixture([{status:'error',error:'核對未完成'}]);
  await assert.rejects(f.api('/api/process',{}),/核對未完成/);
  assert.equal(f.requests.filter(r=>r.action==='enqueue').length,1);
});
