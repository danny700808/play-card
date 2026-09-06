const test = require('node:test');
const assert = require('node:assert/strict');
const { imageProblems, verifyShopeeDescriptionImages } = require('../functions/listingImagePreflight');
const valid = { width: 700, height: 1000, bytes: 100000, format: 'jpeg' };
test('native width, ratio, bytes and supported format boundaries', () => {
  assert.deepEqual(imageProblems(valid), []);
  assert.deepEqual(imageProblems({ ...valid, width: 542 }), ['width-below-700px']);
  assert.ok(imageProblems({ ...valid, height: 2000 }).includes('aspect-ratio-outside-0.5-to-32'));
  assert.ok(imageProblems({ ...valid, bytes: 2000001 }).includes('file-over-2MB'));
  assert.ok(imageProblems({ ...valid, format: 'svg' }).includes('use-jpeg-or-png'));
});
test('unselected Shopee does not fetch or block other channels', async () => {
  assert.equal((await verifyShopeeDescriptionImages({ listingTargetPlatforms: ['coupang'] }, { fetch: () => { throw Error('not allowed'); } })).status, 'not-applicable');
});
const snapshot = () => ({ listingTargetPlatforms: ['shopee'], platformDescriptionContentPlan: { shopee: { imageUrls: ['https://example.test/final.jpg'] } } });
test('actual decoded bytes are checked without changing frozen input', async () => {
  const input = snapshot(), before = JSON.stringify(input);
  const result = await verifyShopeeDescriptionImages(input, { fetch: async () => new Response(Buffer.from('image')), metadata: async () => valid });
  assert.equal(result.images[0].bytes, 5);
  assert.equal(JSON.stringify(input), before);
});
test('small image cannot pass from claimed URL or metadata outside decoder', async () => {
  await assert.rejects(verifyShopeeDescriptionImages(snapshot(), { fetch: async () => new Response('image'), metadata: async () => ({ ...valid, width: 364 }) }), /第 1 張.*364/);
});
test('oversized streaming response is rejected before decoding', async () => {
  await assert.rejects(verifyShopeeDescriptionImages(snapshot(), { fetch: async () => new Response(Buffer.alloc(2000001)), metadata: async () => { throw Error('must not decode'); } }), /超過 2 MB/);
});
