'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {GoogleAuth}=require('../../functions/node_modules/google-auth-library');
async function main(){
  const client=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const project='youzi-c1b74',regions=['us-central1','asia-east1'],refs=[];
  let drainSeconds=0;
  for(const region of regions){
    const {data}=await client.request({url:`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/lineWebhook`});
    assert.equal(data.state,'ACTIVE',region+' webhook must be active');
    drainSeconds=Math.max(drainSeconds,Number(data.serviceConfig?.timeoutSeconds)||60);
    const ref=(data.serviceConfig?.secretEnvironmentVariables||[]).find(row=>row.key==='LINE_CHANNEL_SECRET');assert(ref,'Webhook signing secret must be bound');
    refs.push({project:ref.projectId,secret:ref.secret,version:ref.version});
  }
  assert.deepEqual(refs[0],refs[1],'Both regions must use the same signing secret reference');
  // Let requests that began on the previous revision finish before declaring cutover ready.
  console.log('Allowing previous webhook requests to finish:',drainSeconds+15,'seconds');
  for(let remaining=drainSeconds+15;remaining>0;remaining-=30)await new Promise(resolve=>setTimeout(resolve,Math.min(30,remaining)*1000));
  const secret=fs.readFileSync(process.env.LINE_CHANNEL_SECRET_PATH,'utf8').trim();assert(secret);
  const body=JSON.stringify({events:[]});
  const signature=crypto.createHmac('sha256',secret).update(body).digest('base64');
  for(const region of regions){
    const endpoint=`https://${region}-${project}.cloudfunctions.net/lineWebhook`;
    for(const [value,expected] of [[signature,200],['invalid-signature',401]]){
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':value},body,signal:AbortSignal.timeout(60000)});
      assert.equal(response.status,expected,region+' webhook signature check');await response.text();
    }
    console.log(region+': ACTIVE, shared secret reference, signed empty event accepted, forged signature rejected');
  }
  console.log('No Messaging API setting was changed; no user event or message was sent.');
}
main().catch(error=>{console.error('Webhook regional verification failed:',error.message);process.exitCode=1;});
