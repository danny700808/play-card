'use strict';

// Native Shopee description limits observed in the seller editor. Decode actual
// bytes, not filenames or claimed dimensions. Never silently upscale a source.
function imageProblems({ width, height, bytes, format }) {
  const problems = [];
  if (!Number.isFinite(width) || width < 700) problems.push('width-below-700px');
  if (!Number.isFinite(height) || height < 32) problems.push('height-below-32px');
  if (width / height < 0.5 || width / height > 32) problems.push('aspect-ratio-outside-0.5-to-32');
  if (!Number.isFinite(bytes) || bytes > 2000000) problems.push('file-over-2MB');
  if (!['jpeg', 'png'].includes(format)) problems.push('use-jpeg-or-png');
  return problems;
}

async function verifyShopeeDescriptionImages(snapshot, dependencies = {}) {
  const targets = snapshot.listingTargetPlatforms || [];
  if (!targets.includes('shopee')) return { status: 'not-applicable', images: [] };
  const urls = snapshot.platformDescriptionContentPlan?.shopee?.imageUrls || [];
  if (!urls.length || urls.length > 12) throw new Error('蝦皮描述圖片數量必須為 1～12 張。');
  const fetchImage = dependencies.fetch || globalThis.fetch;
  const metadata = dependencies.metadata || (buffer => require('sharp')(buffer).metadata());
  const images = [];
  for (const [index, url] of urls.entries()) {
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error(`蝦皮描述第 ${index + 1} 張不是安全完成圖網址。`);
    const response = await fetchImage(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`蝦皮描述第 ${index + 1} 張下載失敗：HTTP ${response.status}`);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 2000000) throw new Error(`蝦皮描述第 ${index + 1} 張超過 2 MB；尚未操作平台。`);
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    const decoded = await metadata(buffer);
    const row = { position: index + 1, url, width: decoded.width, height: decoded.height, format: decoded.format, bytes };
    const problems = imageProblems(row);
    if (problems.length) throw new Error(`蝦皮描述第 ${row.position} 張 ${row.width}×${row.height}px／${bytes} bytes 不合規：${problems.join(', ')}。保留原圖，補合規完成輸出後續跑；尚未操作平台。`);
    images.push(row);
  }
  return { status: 'verified', version: 'shopee-native-description-byte-preflight-v1', checkedAt: new Date().toISOString(), images };
}

module.exports = { imageProblems, verifyShopeeDescriptionImages };
