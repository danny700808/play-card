'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync,spawnSync}=require('node:child_process');
test('ordinary deployments retain ownership; a committed storage plan delegates only bounded non-webhook work',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'storage-scope-')),script=path.resolve('.github/scripts/storage-rollout-owner.cjs');
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  try{
    git('init','-q');git('config','user.name','Scope test');git('config','user.email','scope@example.invalid');
    fs.writeFileSync(path.join(dir,'ordinary'),'base');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
    fs.writeFileSync(path.join(dir,'ordinary'),'updated');git('add','.');git('commit','-qm','ordinary');
    const event=path.join(dir,'event.json');fs.writeFileSync(event,JSON.stringify({before:base}));
    const run=()=>spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'push',GITHUB_EVENT_PATH:event,GITHUB_SHA:git('rev-parse','HEAD')}});
    assert.equal(run().stdout.trim(),'STORAGE_ROLLOUT_OWNED=false');
    fs.mkdirSync(path.join(dir,'.github'));const manifest=path.join(dir,'.github/storage-rollout.json');
    fs.writeFileSync(manifest,JSON.stringify({owner:'deploy-taiwan-storage',functions:['privateContractAssetHttp']}));git('add','.github');git('commit','-qm','storage');
    assert.equal(run().stdout.trim(),'STORAGE_ROLLOUT_OWNED=true');
    fs.writeFileSync(manifest,JSON.stringify({owner:'deploy-taiwan-storage',functions:['lineWebhook']}));git('add','.github');git('commit','-qm','invalid');
    assert.notEqual(run().status,0);assert.equal(run().stdout,'');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
