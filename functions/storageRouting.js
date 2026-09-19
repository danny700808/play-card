'use strict';
const LEGACY_BUCKET = 'youzi-c1b74.firebasestorage.app';
const TAIWAN_BUCKET = 'youzi-c1b74-taiwan';
const COPY_GENERATION = 'youziMigrationSourceGeneration';
const COPY_METAGENERATION = 'youziMigrationSourceMetageneration';
const allowed = [TAIWAN_BUCKET, LEGACY_BUCKET];
const missing = error => Number(error && error.code) === 404;

function createStorageRouting(storage) {
  function bucket(name) {
    if (!allowed.includes(name)) throw new Error('Unrecognized storage bucket');
    return storage.bucket(name);
  }
  const writeBucket = () => bucket(TAIWAN_BUCKET);
  async function readFile(path) {
    const target = bucket(TAIWAN_BUCKET).file(path);
    let info;
    try { [info] = await target.getMetadata(); }
    catch (error) { if (!missing(error)) throw error; }
    if (!info) {
      const legacy = bucket(LEGACY_BUCKET).file(path);
      await legacy.getMetadata();
      return legacy;
    }
    const copied = info.metadata && info.metadata[COPY_GENERATION];
    if (!copied) return target;
    // Old tabs may update or delete the source after the snapshot. A copied
    // private file must never resurrect a deleted source or an obsolete token.
    const legacy = bucket(LEGACY_BUCKET).file(path);
    const [source] = await legacy.getMetadata();
    return String(source.generation) === copied &&
      String(source.metageneration) === info.metadata[COPY_METAGENERATION] ? target : legacy;
  }
  async function deletePath(path) {
    // Snapshot each generation first; never remove a concurrent replacement.
    const files = await Promise.all(allowed.map(async name => {
      const file = bucket(name).file(path);
      try { const [info] = await file.getMetadata(); return { file, generation: info.generation }; }
      catch (error) { if (!missing(error)) throw error; return null; }
    }));
    await Promise.all(files.filter(Boolean).map(async ({file,generation}) => {
      try { await file.delete({preconditionOpts:{ifGenerationMatch:generation}}); }
      catch (error) { if (!missing(error)) throw error; }
    }));
  }
  async function listFiles(options) {
    const rows = await Promise.all(allowed.map(name => bucket(name).getFiles(options)));
    return [rows.flatMap(row => row[0])];
  }
  return {writeBucket,readFile,deletePath,listFiles,bucket,buckets:()=>allowed.map(bucket)};
}
let instance;
function routing() { return instance || (instance=createStorageRouting(require('firebase-admin').storage())); }
module.exports={LEGACY_BUCKET,TAIWAN_BUCKET,COPY_GENERATION,COPY_METAGENERATION,createStorageRouting,
  writeBucket:()=>routing().writeBucket(),readFile:path=>routing().readFile(path),
  deletePath:path=>routing().deletePath(path),listFiles:options=>routing().listFiles(options),
  bucket:name=>routing().bucket(name),buckets:()=>routing().buckets()};
