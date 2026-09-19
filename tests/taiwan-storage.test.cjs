'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {matches,copyDecision}=require('../.github/scripts/prepare-taiwan-storage.cjs');
const source={size:'123',crc32c:'checksum',contentType:'image/png',cacheControl:'private, no-store',metadata:{firebaseStorageDownloadTokens:'test-only'}};
test('copy preparation preserves checksum, private cache control and download tokens',()=>{
  assert(matches(source,{...source,generation:'new-generation'}));
  for(const patch of [{size:'124'},{crc32c:'different'},{metadata:{}},{cacheControl:'public'},{contentType:'image/jpeg'}])assert(!matches(source,{...source,...patch}));
});
test('copy can resume but cannot overwrite a destination file or a concurrent upload',()=>{
  assert.equal(copyDecision(source,null),'copy');
  assert.equal(copyDecision(source,source),'verified');
  assert.equal(copyDecision(source,{...source,crc32c:'new-live-upload'}),'conflict');
});
