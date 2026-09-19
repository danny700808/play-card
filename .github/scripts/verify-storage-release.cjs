'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
async function main(){
  const plan=require('../storage-rollout.json'),phase=plan.phase||'backend';
  assert(['backend','frontend'].includes(phase));
  if(phase==='frontend'){
    assert(Number.isSafeInteger(plan.backendRun));assert(/^[a-f0-9]{40}$/.test(plan.backendSha));
    const response=await fetch('https://api.github.com/repos/danny700808/play-card/actions/runs/'+plan.backendRun,{headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json'}});
    assert(response.ok,'Unable to verify the storage backend deployment');
    const run=await response.json();assert.equal(run.conclusion,'success');assert.equal(run.head_sha,plan.backendSha);assert.equal(run.name,'Deploy Taiwan Storage');
    const changes=execFileSync('git',['diff','--name-only',plan.backendSha,'HEAD','--','functions/'],{encoding:'utf8'}).trim();assert.equal(changes,'','Frontend release must retain the verified function code');
    console.log('Verified backend deployment; this release changes browser hosting only.');
  }
  fs.appendFileSync(process.env.GITHUB_OUTPUT,'phase='+phase+'\n');
}
main().catch(error=>{console.error('Storage release gate failed:',error.code||error.message);process.exitCode=1;});
