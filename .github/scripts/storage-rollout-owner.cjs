'use strict';
const fs=require('node:fs'),{execFileSync}=require('node:child_process');
let owned=false;
if(process.env.GITHUB_EVENT_NAME==='push'){
  const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  const before=event.before;
  if(!/^[a-f0-9]{40}$/.test(before)||/^0+$/.test(before))throw Error('Missing rollout base revision');
  const changed=execFileSync('git',['diff','--name-only',before,process.env.GITHUB_SHA],{encoding:'utf8'}).split('\n');
  owned=changed.includes('.github/storage-rollout.json');
  if(owned){
    const plan=JSON.parse(fs.readFileSync('.github/storage-rollout.json','utf8'));
    if(plan.owner!=='deploy-taiwan-storage'||!Array.isArray(plan.functions)||!plan.functions.length||plan.functions.length>40||plan.functions.some(name=>!/^[A-Za-z0-9]+$/.test(name)||name==='lineWebhook'))throw Error('Invalid bounded storage deployment plan');
  }
}
console.log('STORAGE_ROLLOUT_OWNED='+owned);
