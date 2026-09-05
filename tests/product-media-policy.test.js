const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../operations-phase1.js'), 'utf8');
function extract(start, end, context = {}) {
  return vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end)) + '\n' + start.match(/function (\w+)/)[1], context);
}
test('physical derivative has one faint diagonal watermark, no footer, bounded size', async () => {
  const calls = [];
  const ctx = new Proxy({}, {get: (obj, key) => obj[key] || ((...args) => calls.push([key, ...args])), set: (obj, key, value) => {obj[key] = value; return true;}});
  const canvas = {getContext: () => ctx, toBlob: cb => cb({size: 1700000})};
  const fn = extract('  async function physicalPhotoLabeledBlob(', '  async function uploadPhysicalProductPhoto(', {loadPhysicalPhotoImage: async () => ({width: 4000, height: 3000}), document: {createElement: () => canvas}});
  assert.equal((await fn({})).size, 1700000);
  assert.equal(canvas.width, 2000);
  assert.equal(canvas.height, 1500);
  assert.equal(calls.filter(x => x[0] === 'fillText').length, 1);
  assert.equal(calls.filter(x => x[0] === 'fillRect').length, 1); // base white canvas only
  assert.equal(ctx.fillStyle, 'rgba(255,255,255,.22)');
  assert.ok(calls.some(x => x[0] === 'rotate' && x[1] < 0));
});
test('retry excludes successful sources and preserves published YouTube', () => {
  const fn = extract('  function productMediaResumePlan(', '  function productMediaBatchPrompt(');
  const result = fn({physicalImageUrls: ['a', 'b'], physicalImagePlatformResults: {easyStore: {status: 'completed', sourceImageUrls: ['a']}, shopee: {status: 'completed'}}, productVideos: [{originalUrl: 'v', youtubeStatus: 'published', youtubeVideoId: 'yt', platformVideoResults: {easyStore: {status: 'completed'}}}]});
  assert.deepEqual(Array.from(result[0].physicalImageUrls), ['b']);
  assert.equal(result[0].videos.length, 0);
  assert.equal(result[1].verifyExistingPhotosFirst, true);
  assert.equal(result[1].videos[0].reusePublishedYouTube, true);
});
