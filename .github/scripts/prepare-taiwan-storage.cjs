'use strict';
const assert=require('node:assert/strict');
const PROJECT='youzi-c1b74',SOURCE=PROJECT+'.firebasestorage.app',TARGET=PROJECT+'-taiwan';
function matches(source,target){
  return Boolean(target&&String(source.size)===String(target.size)&&source.crc32c&&source.crc32c===target.crc32c&&
    JSON.stringify(source.metadata||{})===JSON.stringify(target.metadata||{})&&
    ['contentType','cacheControl','contentDisposition','contentEncoding'].every(key=>(source[key]||'')===(target[key]||'')));
}
function copyDecision(source,target){
  if(matches(source,target))return 'verified';
  if(target)return 'conflict'; // Never overwrite a destination file, including a new live upload.
  return 'copy';
}
async function main(){
  const admin=require('../../functions/node_modules/firebase-admin');
  const {Storage}=require('../../functions/node_modules/@google-cloud/storage');
  const {GoogleAuth}=require('../../functions/node_modules/google-auth-library');
  if(!admin.apps.length)admin.initializeApp({projectId:PROJECT});
  const storage=new Storage({projectId:PROJECT}),source=storage.bucket(SOURCE),target=storage.bucket(TARGET);
  const [sourceInfo]=await source.getMetadata();
  assert.equal(sourceInfo.projectNumber,'187002582910','Unexpected source project');
  const rules=await admin.securityRules().getStorageRuleset(SOURCE);
  const [exists]=await target.exists();
  if(!exists)await storage.createBucket(TARGET,{location:'ASIA-EAST1',storageClass:'STANDARD',cors:sourceInfo.cors||[],labels:{purpose:'taiwan-region-migration'}});
  const [targetInfo]=await target.getMetadata();
  assert.equal(targetInfo.location,'ASIA-EAST1');assert.equal(targetInfo.projectNumber,sourceInfo.projectNumber);
  const client=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const bucketResource=`projects/${sourceInfo.projectNumber}/buckets/${TARGET}`;
  try{await client.request({url:`https://firebasestorage.googleapis.com/v1beta/${bucketResource}`});}
  catch(error){if(error.response?.status!==404)throw error;await client.request({method:'POST',url:`https://firebasestorage.googleapis.com/v1beta/${bucketResource}:addFirebase`,data:{}});}
  // Reuse the exact currently deployed ruleset. Do not broaden access or use an unverified local copy.
  await admin.securityRules().releaseStorageRuleset(rules,TARGET);
  const targetRules=await admin.securityRules().getStorageRuleset(TARGET);
  assert.equal(targetRules.name,rules.name);
  const [sourceFiles]=await source.getFiles(),[targetFiles]=await target.getFiles();
  const destination=new Map(targetFiles.map(file=>[file.name,file.metadata]));
  let verified=0,copied=0,bytes=0,conflicts=0;
  for(let i=0;i<sourceFiles.length;i+=8){
    const batch=await Promise.allSettled(sourceFiles.slice(i,i+8).map(async file=>{
      const info=file.metadata,decision=copyDecision(info,destination.get(file.name));
      if(decision==='conflict'){conflicts++;return;}
      if(decision==='copy'){
        // Pin source generation and create-only destination, making concurrent changes safe.
        await source.file(file.name,{generation:info.generation}).copy(target.file(file.name),{preconditionOpts:{ifGenerationMatch:0}});
        const [after]=await target.file(file.name).getMetadata();
        if(!matches(info,after))throw new Error('Copied object failed integrity or metadata verification');
        copied++;
      }
      verified++;bytes+=Number(info.size||0);
    }));
    if(batch.some(row=>row.status==='rejected'))throw new Error('Storage copy failed; source retained and clients unchanged');
    if(i%400===0)console.log(JSON.stringify({checked:Math.min(i+8,sourceFiles.length),total:sourceFiles.length,copied,conflicts}));
  }
  // Re-list to detect new, removed or updated source objects during the copy.
  const [finalSource]=await source.getFiles(),[finalTarget]=await target.getFiles();
  const finalMap=new Map(finalTarget.map(file=>[file.name,file.metadata]));
  const complete=finalSource.every(file=>matches(file.metadata,finalMap.get(file.name)));
  console.log(JSON.stringify({source:SOURCE,target:TARGET,location:targetInfo.location,sourceObjects:finalSource.length,verified,copied,bytes,conflicts,rulesIdentical:true,complete}));
  if(!complete||conflicts)throw new Error('Storage snapshot changed or conflicts exist; cutover is not ready');
}
if(require.main===module)main().catch(error=>{console.error('Taiwan storage preparation failed',{code:error.code||null,message:String(error.message).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,220)});process.exitCode=1;});
module.exports={matches,copyDecision};
