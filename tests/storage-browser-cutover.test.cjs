'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('fresh browser configuration directs new uploads to Taiwan',()=>{const context={URLSearchParams,window:{location:{search:'',pathname:'/operations-hub.html'},setTimeout:()=>{},localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}}};vm.runInNewContext(fs.readFileSync('config.js','utf8'),context);assert.equal(context.window.APP_CONFIG.FIREBASE_CONFIG.storageBucket,'youzi-c1b74-taiwan');assert.equal(context.window.APP_CONFIG.FUNCTION_REGION,'asia-east1');});
test('rental asset deletion cleans both buckets for old URLs and stored paths, without claiming success on denied deletion',async()=>{
  const source=fs.readFileSync('rental-admin.html','utf8'),body=source.slice(source.indexOf('    async function deleteStorageRefMaybe(value){'),source.indexOf('    function collectStorageCandidates(row){'));
  let denied=false;const removed=[];
  const ref=(bucket,fullPath)=>({bucket,fullPath,delete:async()=>{removed.push(bucket+'/'+fullPath);if(denied&&bucket.includes('taiwan'))throw {code:'storage/unauthorized'};}});
  const context={R:{clean:v=>String(v||'').trim()},firebase:{storage:()=>({ref:path=>ref('youzi-c1b74-taiwan',path),refFromURL:()=>ref('youzi-c1b74.firebasestorage.app','rental-contracts/c1/old.pdf')}),app:()=>({storage:uri=>({ref:path=>ref(uri.replace('gs://',''),path)})})}};
  vm.runInNewContext(body,context);
  assert.equal(await context.deleteStorageRefMaybe('https://firebasestorage.googleapis.com/v0/b/youzi-c1b74.firebasestorage.app/o/old.pdf'),true);assert.equal(removed.length,2);
  assert.equal(await context.deleteStorageRefMaybe('rental-contracts/c1/path.pdf'),true);assert.equal(removed.length,4);
  denied=true;assert.equal(await context.deleteStorageRefMaybe('rental-contracts/c1/path.pdf'),false);assert.equal(removed.length,6);
  assert.equal(await context.deleteStorageRefMaybe('data:image/png;base64,aaa'),false);assert.equal(removed.length,6);
});
