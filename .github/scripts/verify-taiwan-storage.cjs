'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
async function main(){
  const admin=require('../../functions/node_modules/firebase-admin');
  if(!admin.apps.length)admin.initializeApp({projectId:'youzi-c1b74'});
  const routing=require('../../functions/storageRouting');
  const path='teacher-private-profiles/__migration_probe_'+crypto.randomUUID()+'/probe.bin';
  const target=routing.writeBucket().file(path),source=routing.bucket(routing.LEGACY_BUCKET).file(path);
  assert.equal(target.bucket.name,routing.TAIWAN_BUCKET);
  const sample=Buffer.from('private migration probe '+crypto.randomUUID());
  try{
    await target.save(sample,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/octet-stream',cacheControl:'private,no-store'}});
    const [metadata]=await target.getMetadata();assert(!metadata.metadata?.firebaseStorageDownloadTokens);
    const [actual]=await (await routing.readFile(path)).download();assert.deepEqual(actual,sample);
    const endpoint='https://firebasestorage.googleapis.com/v0/b/'+routing.TAIWAN_BUCKET+'/o/'+encodeURIComponent(path)+'?alt=media';
    const denied=await fetch(endpoint,{signal:AbortSignal.timeout(30000)});assert.equal(denied.status,403,'Private probe must not be public');await denied.arrayBuffer();
    const [signed]=await target.getSignedUrl({action:'read',expires:Date.now()+60000});
    const allowed=await fetch(signed,{signal:AbortSignal.timeout(30000)});assert.equal(allowed.status,200);assert.deepEqual(Buffer.from(await allowed.arrayBuffer()),sample);
    await source.save(sample,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/octet-stream',cacheControl:'private,no-store'}});
    const [legacy]=await source.getMetadata();
    await target.setMetadata({metadata:{[routing.COPY_GENERATION]:legacy.generation,[routing.COPY_METAGENERATION]:legacy.metageneration}});
    assert.equal((await routing.readFile(path)).bucket.name,routing.TAIWAN_BUCKET);
    await source.setMetadata({cacheControl:'private,no-store,max-age=0'});
    assert.equal((await routing.readFile(path)).bucket.name,routing.LEGACY_BUCKET,'Legacy metadata changes must invalidate the copy');
    await source.delete();
    await assert.rejects(routing.readFile(path),error=>Number(error.code)===404,'Deleted originals must not be resurrected');
    console.log('Taiwan storage write/read, anonymous denial, signed read, legacy changes and deletion checks passed.');
  }finally{await routing.deletePath(path);console.log('Synthetic migration probe cleaned up in both buckets.');}
}
main().catch(error=>{console.error('Storage smoke verification failed:',error.code||error.message);process.exitCode=1;});
