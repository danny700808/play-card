'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStorageRouting,TAIWAN_BUCKET:TW,LEGACY_BUCKET:US,COPY_GENERATION:G,COPY_METAGENERATION:M}=require('../functions/storageRouting');
function setup(){
  const rows=new Map(),removed=[],calls=[];
  const storage={bucket:name=>({name,file:path=>({name:path,bucket:{name},getMetadata:async()=>{calls.push(name);const row=rows.get(name+'/'+path);if(row instanceof Error)throw row;if(!row)throw Object.assign(new Error('missing'),{code:404});return [row];},delete:async options=>{const key=name+'/'+path,row=rows.get(key);assert.equal(options.preconditionOpts.ifGenerationMatch,row.generation);rows.delete(key);removed.push(key);}}),getFiles:async()=>[[]]})};
  return {rows,removed,calls,api:createStorageRouting(storage)};
}
const tagged={generation:'20',metadata:{[G]:'10',[M]:'1'}},source={generation:'10',metageneration:'1'};
test('new files write/read Taiwan and unknown buckets are denied',async()=>{const f=setup();assert.equal(f.api.writeBucket().name,TW);f.rows.set(TW+'/p',{generation:'30'});assert.equal((await f.api.readFile('p')).bucket.name,TW);assert.deepEqual(f.calls,[TW]);assert.throws(()=>f.api.bucket('untrusted'));});
test('verified copied content reads Taiwan; old-tab late uploads fall back to source',async()=>{const f=setup();f.rows.set(TW+'/p',tagged);f.rows.set(US+'/p',source);assert.equal((await f.api.readFile('p')).bucket.name,TW);f.rows.set(US+'/late',source);assert.equal((await f.api.readFile('late')).bucket.name,US);});
test('source changes and token revocation cannot serve a stale copy',async()=>{for(const patch of [{generation:'11'},{metageneration:'2'}]){const f=setup();f.rows.set(TW+'/p',tagged);f.rows.set(US+'/p',{...source,...patch});assert.equal((await f.api.readFile('p')).bucket.name,US);}});
test('a deleted source cannot be resurrected by its copied private object',async()=>{const f=setup();f.rows.set(TW+'/p',tagged);await assert.rejects(f.api.readFile('p'),{code:404});});
test('permission and service failures never trigger a fallback read',async()=>{for(const code of [403,500]){const f=setup();f.rows.set(TW+'/p',Object.assign(new Error('blocked'),{code}));f.rows.set(US+'/p',source);await assert.rejects(f.api.readFile('p'),{code});assert.deepEqual(f.calls,[TW]);}});
test('authorized deletion removes both generations and tolerates missing copies',async()=>{const f=setup();f.rows.set(TW+'/p',tagged);f.rows.set(US+'/p',source);await f.api.deletePath('p');assert.equal(f.removed.length,2);await f.api.deletePath('p');assert.equal(f.removed.length,2);});
test('private assets authorize before resolving a migrated file; both callback origins remain valid',async()=>{
  const {createPrivateContractAssets,validateAssetUrl}=require('../functions/privateContractAssets');let reads=0;
  const api=createPrivateContractAssets({bucket:{},baseUrl:'https://example.test',authorize:async(_kind,_id,token)=>{if(token!=='test-only')throw Error('denied');},readFile:async()=>{reads++;return {getMetadata:async()=>[{size:'1',contentType:'image/png'}],download:async()=>[Buffer.from('a')]};}});
  const data={kind:'rental',id:'c1',path:'rental-contracts/c1/private/a.png',token:'bad'};
  await assert.rejects(api.download(data),/denied/);assert.equal(reads,0);await api.download({...data,token:'test-only'});assert.equal(reads,1);
  for(const region of ['asia-east1','us-central1']){const url='https://'+region+'-youzi-c1b74.cloudfunctions.net/privateContractAssetHttp?'+new URLSearchParams({...data,token:'test-only'});assert.equal(validateAssetUrl(url,{...data,token:'test-only'}),url);assert.throws(()=>validateAssetUrl(url,{...data,token:'wrong'}));}
});
test('a pre-cutover resumable video finishes in its original bucket even without the new bucket field',async()=>{
  const {database}=require('./helpers/security-fixtures.cjs'),{createProductVideoAccess}=require('../functions/productVideoAccess');
  const f=database({'opsInternalProducts/p1':{enabled:true,productVideos:[]}}),files=new Map();
  const old={name:US,file:path=>({createResumableUpload:async()=>{files.set(path,{size:'16',contentType:'video/mp4',metadata:{}});return ['https://example.test/upload'];},getMetadata:async()=>[files.get(path)],download:async()=>[Buffer.from('0000ftypisom0000')],setMetadata:async data=>Object.assign(files.get(path),data)})};
  const current={name:TW,file:()=>{throw Error('Old upload must not access the new bucket');}};
  const common={...f,authorize:async token=>assert.equal(token,'test-only')};
  const input={token:'test-only',productId:'p1',operator:'tester',sizeBytes:16,contentType:'video/mp4'};
  const start=await createProductVideoAccess({...common,bucket:old}).start(input);
  delete f.rows.get('inventoryMediaUploads/'+start.uploadId).storageBucket;
  const api=createProductVideoAccess({...common,bucket:current,legacyBucketName:US,resolveBucket:name=>{assert.equal(name,US);return old;}});
  const result=await api.finish({token:input.token,uploadId:start.uploadId});assert(result.video.url.includes(US));assert.equal(result.video.storageBucket,US);
});
