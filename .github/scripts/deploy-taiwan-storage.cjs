'use strict';
const assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const plan=require('../storage-rollout.json');
async function main(){
  const {GoogleAuth}=require('../../functions/node_modules/google-auth-library');
  const client=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const exported=require('../../functions');
  assert.equal(plan.owner,'deploy-taiwan-storage');assert(plan.functions.length<=40);
  for(const name of plan.functions){assert(/^[A-Za-z0-9]+$/.test(name));assert.notEqual(name,'lineWebhook');assert(exported[name]?.__endpoint,'Missing function '+name);}
  function deploy(names){
    const result=spawnSync('firebase',['deploy','--project','youzi-c1b74','--non-interactive','--only',names.map(n=>'functions:'+n).join(',')],{encoding:'utf8',maxBuffer:24*1024*1024,env:process.env});
    const log=(String(result.stdout||'')+'\n'+String(result.stderr||'')).replace(/\x1b\[[0-9;]*m/g,'');
    for(const line of log.split('\n').filter(l=>/functions\[|CPU|quota|Error:/.test(l)))console.log(line);
    return {ok:result.status===0,log};
  }
  async function verify(name,log){
    for(const region of exported[name].__endpoint.region){
      assert(log.split('\n').some(l=>l.includes('functions['+name+'('+region+')')&&/Successful (update|create) operation|Skipped/.test(l)),'Deployment completion missing: '+name+' '+region);
      const {data}=await client.request({url:`https://cloudfunctions.googleapis.com/v2/projects/youzi-c1b74/locations/${region}/functions/${name}`});
      assert.equal(data.state,'ACTIVE',name+' '+region+' must be ACTIVE');
      console.log(JSON.stringify({name,region,state:data.state,updated:data.updateTime}));
    }
  }
  // Readers/validators are listed first. At most two names (four regional
  // revisions) update together; failures are retried singly, never as a fleet.
  for(let i=0;i<plan.functions.length;i+=2){
    const batch=plan.functions.slice(i,i+2);console.log('Storage deployment batch:',batch.join(','));
    const result=deploy(batch);
    if(result.ok){for(const name of batch)await verify(name,result.log);}
    else for(const name of batch){
      await new Promise(resolve=>setTimeout(resolve,45000));
      const single=deploy([name]);assert(single.ok,'Isolated retry failed: '+name);await verify(name,single.log);
    }
    await new Promise(resolve=>setTimeout(resolve,15000));
  }
  console.log('Bounded storage function deployment complete; LINE webhook and login settings were not changed.');
}
main().catch(error=>{console.error('Storage deployment failed:',error.code||error.message);process.exitCode=1;});
