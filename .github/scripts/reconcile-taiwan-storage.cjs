'use strict';
const assert=require('node:assert/strict');
const SOURCE='youzi-c1b74.firebasestorage.app',TARGET='youzi-c1b74-taiwan';
const GENERATION='youziMigrationSourceGeneration',META='youziMigrationSourceMetageneration';
function custom(info){const value={...(info.metadata||{})};delete value[GENERATION];delete value[META];return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));}
function expectedCustom(source,target){const value=custom(source);if(target?.metadata?.[GENERATION])delete value.firebaseStorageDownloadTokens;return value;}
function matches(a,b){return !!b&&String(a.size)===String(b.size)&&!!a.crc32c&&a.crc32c===b.crc32c&&JSON.stringify(expectedCustom(a,b))===JSON.stringify(custom(b))&&['contentType','cacheControl','contentDisposition','contentEncoding'].every(k=>(a[k]||'')===(b[k]||''));}
function decision(source,target){
  if(!target)return 'copy';
  if(matches(source,target))return 'tag';
  if(target.metadata?.[GENERATION])return 'refresh-copy';
  return 'conflict'; // An unmarked, different object may be a live Taiwan upload.
}
async function main(){
  const admin=require('../../functions/node_modules/firebase-admin');
  const {Storage}=require('../../functions/node_modules/@google-cloud/storage');
  if(!admin.apps.length)admin.initializeApp({projectId:'youzi-c1b74'});
  const storage=new Storage(),source=storage.bucket(SOURCE),target=storage.bucket(TARGET);
  const [[s],[t]]=await Promise.all([source.getMetadata(),target.getMetadata()]);
  assert.equal(t.location,'ASIA-EAST1');assert.equal(t.projectNumber,'187002582910');assert.equal(s.projectNumber,t.projectNumber);
  const [rules,targetRules]=await Promise.all([admin.securityRules().getStorageRuleset(SOURCE),admin.securityRules().getStorageRuleset(TARGET)]);
  assert.equal(targetRules.name,rules.name,'Storage access rules must remain identical');
  assert.deepEqual(t.cors||[],s.cors||[],'Browser CORS must remain identical');
  const [[sourceFiles],[targetFiles]]=await Promise.all([source.getFiles(),target.getFiles()]);
  const targets=new Map(targetFiles.map(f=>[f.name,f.metadata]));
  const stats={sourceObjects:sourceFiles.length,copied:0,refreshed:0,tagged:0,conflicts:0};
  for(let i=0;i<sourceFiles.length;i+=8){
    await Promise.all(sourceFiles.slice(i,i+8).map(async file=>{
      const src=file.metadata,dst=targets.get(file.name),action=decision(src,dst);
      if(action==='conflict'){stats.conflicts++;return;}
      const metadata={...custom(src),[GENERATION]:String(src.generation),[META]:String(src.metageneration)};
      delete metadata.firebaseStorageDownloadTokens; // Old links retain their original bucket; copied private objects get no bearer token.
      if(action==='tag'){
        if(dst.metadata?.[GENERATION]!==metadata[GENERATION]||dst.metadata?.[META]!==metadata[META]||dst.metadata?.firebaseStorageDownloadTokens){
          await target.file(file.name).setMetadata({metadata:{...metadata,firebaseStorageDownloadTokens:null}},{ifGenerationMatch:dst.generation,ifMetagenerationMatch:dst.metageneration});stats.tagged++;
        }
      }else{
        await source.file(file.name,{generation:src.generation}).copy(target.file(file.name),{
          metadata,...Object.fromEntries(['contentType','cacheControl','contentDisposition','contentEncoding'].filter(k=>src[k]).map(k=>[k,src[k]])),preconditionOpts:{ifGenerationMatch:dst?dst.generation:0, ...(dst?{ifMetagenerationMatch:dst.metageneration}:{})}
        });
        stats[action==='copy'?'copied':'refreshed']++;
      }
      const [after]=await target.file(file.name).getMetadata();assert(matches(src,after),'Object content or metadata mismatch');
    }));
    if(i%400===0)console.log(JSON.stringify({checked:Math.min(i+8,sourceFiles.length),...stats}));
  }
  const [[finalSource],[finalTarget]]=await Promise.all([source.getFiles(),target.getFiles()]);
  const finalMap=new Map(finalTarget.map(f=>[f.name,f.metadata])),sourceNames=new Set(finalSource.map(f=>f.name));
  const staleCopies=finalTarget.filter(f=>!sourceNames.has(f.name)&&f.metadata.metadata?.[GENERATION]).length;
  const unclassifiedOrphans=finalTarget.filter(f=>!sourceNames.has(f.name)&&!f.metadata.metadata?.[GENERATION]).length;
  const complete=finalSource.every(f=>matches(f.metadata,finalMap.get(f.name))&&finalMap.get(f.name)?.metadata?.[GENERATION]===String(f.metadata.generation)&&finalMap.get(f.name)?.metadata?.[META]===String(f.metadata.metageneration));
  console.log(JSON.stringify({...stats,finalSourceObjects:finalSource.length,staleCopies,unclassifiedOrphans,rulesIdentical:true,corsIdentical:true,complete}));
  // Do not delete orphaned objects here. Runtime authorizes first and checks the
  // source generation of every tagged copy, including deletion/token changes.
  assert(complete&&!stats.conflicts&&!unclassifiedOrphans,'Snapshot changed or an unclassified destination exists; cutover blocked');
}
if(require.main===module)main().catch(error=>{console.error('Storage reconciliation failed',{code:error.code||null,message:typeof error.code==='undefined'?String(error.message).slice(0,180):'Storage API operation failed'});process.exitCode=1;});
module.exports={matches,decision};
