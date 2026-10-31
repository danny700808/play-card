import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { prepareDescriptionImage } from './stage-existing-shopee-job.mjs';
const sharp = createRequire(import.meta.url)('../functions/node_modules/sharp');
test('preserves valid PNG bytes and extension', async () => {
  const png = await sharp({ create: { width: 700, height: 1000, channels: 3, background: '#378755' } }).png().toBuffer();
  const result = await prepareDescriptionImage(png);
  assert.equal(result.extension, 'png'); assert.ok(result.bytes.equals(png));
  assert.equal(result.sourceSha256, result.sha256);
});
test('oversized source gets a compliant copy without changing ratio or source', async () => {
  const pixels = Buffer.alloc(2100 * 3000 * 3);
  let seed = 42;
  for (let i = 0; i < pixels.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels[i] = seed >>> 24; }
  const png = await sharp(pixels, { raw: { width: 2100, height: 3000, channels: 3 } }).png().toBuffer();
  assert.ok(png.length > 2000000);
  const before = Buffer.from(png), result = await prepareDescriptionImage(png);
  assert.ok(png.equals(before)); assert.ok(result.bytes.length < 2000000);
  assert.equal(result.width, 700); assert.equal(result.height, 1000);
  assert.equal(result.extension, 'jpg'); assert.ok(result.converted);
});
test('rejects undersized image instead of silently enlarging', async () => {
  const png = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(prepareDescriptionImage(png), /dimensions/);
});
