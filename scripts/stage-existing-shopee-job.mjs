import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const sharp = createRequire(import.meta.url)('../functions/node_modules/sharp');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// Platform copies only: retain the frozen source, layout, aspect ratio and watermark.
export async function prepareDescriptionImage(source) {
  const original = await sharp(source).metadata();
  if (original.width < 700 || original.height < 32 || original.width / original.height < .5 || original.width / original.height > 32) {
    throw Error('Description image dimensions fail Shopee preflight');
  }
  let bytes = source;
  if (!['jpeg', 'png'].includes(original.format) || bytes.length > 2000000) {
    for (const quality of [92, 85, 78]) {
      bytes = await sharp(source).resize({ width: 700 }).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (bytes.length <= 1900000) break;
    }
  }
  const meta = await sharp(bytes).metadata();
  if (bytes.length > 2000000 || meta.width < 700 || meta.height < 32 || meta.width / meta.height < .5 || meta.width / meta.height > 32) {
    throw Error('Prepared description image still fails Shopee preflight');
  }
  return { bytes, extension: meta.format === 'png' ? 'png' : 'jpg', width: meta.width, height: meta.height,
    sourceSha256: sha256(source), sha256: sha256(bytes), converted: !bytes.equals(source) };
}
export async function stage(sku, jobFile, outputRoot = 'E:/GPT資料庫/暫存') {
  if (!/^\d+(?:-\d+)?$/.test(sku || '') || !jobFile) throw Error('SKU and saved job required');
  const job = JSON.parse(await fs.readFile(jobFile, 'utf8'));
  if (job.preparedSnapshot.sku !== sku) throw Error('SKU mismatch');
  const urls = job.preparedSnapshot.platformDescriptionContentPlan?.shopee?.imageUrls;
  if (!Array.isArray(urls) || !urls.length || urls.length > 12) throw Error('Shopee description requires 1–12 planned images');
  const dir = path.resolve(outputRoot, sku, 'shopee-staging');
  await fs.mkdir(dir, { recursive: true });
  const rows = [];
  for (const [i, url] of urls.entries()) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`Image ${i + 1}: HTTP ${response.status}`);
    const prepared = await prepareDescriptionImage(Buffer.from(await response.arrayBuffer()));
    const { bytes, ...metadata } = prepared;
    const file = path.join(dir, `${String(i + 1).padStart(2, '0')}-${prepared.sha256.slice(0, 12)}.${prepared.extension}`);
    await fs.writeFile(file, bytes);
    rows.push({ file, url, ...metadata, bytes: bytes.length });
  }
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(rows, null, 2));
  return { sku, count: rows.length, dir };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await stage(...process.argv.slice(2))));
}
