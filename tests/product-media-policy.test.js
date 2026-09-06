const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
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
test('every new product video is locked to the fixed intro, watermark, outro and platform budgets', () => {
  assert.match(source, /youzi-product-video-brand-v1-2026-09-06/);
  assert.match(source, /youzi-intro-v1-3s-16x9\.mp4/);
  assert.match(source, /youzi-watermark-green-v1\.png/);
  assert.match(source, /youzi-outro-v1-1\.2s-16x9\.mp4/);
  assert.match(source, /opacity:\.13,widthRatio:\.17,placement:'top-right',marginRatio:\.025/);
  assert.match(source, /maximumDurationSeconds:59,targetDurationSeconds:58\.9,maximumBytes:30000000,targetMaximumBytes:29000000,maximumMainContentSeconds:54\.7/);
  assert.match(source, /videoBrandProfile:brandProfile,videoBrandStatus:'pending',processedVideoAssets:\{\}/);
  assert.match(source, /YouTube 必須先製作並上傳品牌完整版，不得上傳原片/);
  assert.match(source, /總長硬上限 59\.0 秒、目標不超過 58\.9 秒/);
  assert.match(source, /不得覆蓋 originalUrl/);
  assert.doesNotMatch(source, /YouTube 使用完整原片/);
  assert.equal(fs.existsSync(path.join(__dirname, '../scripts/render-youzi-product-video.py')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '../assets/product-video-brand/profile-v1.json')), true);
});
test('fixed product-video binaries match the immutable profile hashes', () => {
  const assetDir = path.join(__dirname, '../assets/product-video-brand');
  const profile = JSON.parse(fs.readFileSync(path.join(assetDir, 'profile-v1.json'), 'utf8'));
  for (const section of ['intro', 'watermark', 'outro']) {
    const bytes = fs.readFileSync(path.join(assetDir, profile[section].asset));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), profile[section].sha256);
  }
});
