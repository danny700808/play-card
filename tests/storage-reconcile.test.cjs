'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {matches,decision}=require('../.github/scripts/reconcile-taiwan-storage.cjs');
const src={size:'3',crc32c:'abc',generation:'10',metageneration:'1',contentType:'image/png',cacheControl:'private,no-store',metadata:{firebaseStorageDownloadTokens:'test-only'}};
test('reconciliation preserves content/cache policy and removes bearer tokens from migrated copies',()=>{
  const tagged={...src,metadata:{youziMigrationSourceGeneration:'10',youziMigrationSourceMetageneration:'1'}};
  assert(matches(src,tagged));assert.equal(decision(src,tagged),'tag');
  assert(!matches(src,{...tagged,metadata:{...tagged.metadata,firebaseStorageDownloadTokens:'revoked'}}));
  assert(!matches(src,{...tagged,cacheControl:'public'}));
});
test('different unmarked Taiwan uploads cannot be overwritten; only known copies can refresh',()=>{
  assert.equal(decision(src,null),'copy');
  assert.equal(decision(src,{...src,crc32c:'new'}),'conflict');
  assert.equal(decision(src,{...src,crc32c:'old',metadata:{youziMigrationSourceGeneration:'8'}}),'refresh-copy');
});
