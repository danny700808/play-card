'use strict';

const path = require('path');
const sharp = require('sharp');

const projectRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(projectRoot, 'product-listing-main-template.jpg');
const HEADER_SOURCE_RATIO = 300 / 1440;
const PANEL_BACKGROUND = '#fffaf0';
const PANEL_BORDER = '#9fbea0';

async function buildTemplate({ width, height, fileName }) {
  const source = sharp(sourcePath);
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height || Math.abs((metadata.width / metadata.height) - 0.75) > 0.002) {
    throw new Error(`品牌來源模板尺寸已改變：${metadata.width}x${metadata.height}`);
  }
  const headerSourceHeight = Math.round(metadata.height * HEADER_SOURCE_RATIO);
  const headerHeight = Math.round(headerSourceHeight * (width / metadata.width));
  const header = await source
    .clone()
    .extract({ left: 0, top: 0, width: metadata.width, height: headerSourceHeight })
    .resize(width, headerHeight, { fit: 'fill' })
    .png()
    .toBuffer();
  const margin = Math.max(12, Math.round(width * 0.018));
  const borderWidth = Math.max(2, Math.round(width * 0.003));
  const panelTop = headerHeight + margin;
  const panelWidth = width - (margin * 2);
  const panelHeight = height - panelTop - margin;
  const panelSvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="${margin}" y="${panelTop}" width="${panelWidth}" height="${panelHeight}" ` +
      `rx="${Math.round(width * 0.018)}" fill="${PANEL_BACKGROUND}" stroke="${PANEL_BORDER}" stroke-width="${borderWidth}"/>` +
    '</svg>'
  );
  const overlaySvg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="${margin}" y="${panelTop}" width="${panelWidth}" height="${panelHeight}" ` +
      `rx="${Math.round(width * 0.018)}" fill="none" stroke="${PANEL_BORDER}" stroke-width="${borderWidth}"/>` +
    '</svg>'
  );
  const outputPath = path.join(projectRoot, fileName);
  await sharp({
    create: { width, height, channels: 3, background: PANEL_BACKGROUND }
  })
    .composite([{ input: header, left: 0, top: 0 }, { input: panelSvg, left: 0, top: 0 }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath);
  const overlayPath = outputPath.replace(/\.png$/, '-overlay.png');
  await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: header, left: 0, top: 0 }, { input: overlaySvg, left: 0, top: 0 }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(overlayPath);
  return { outputPath, overlayPath, width, height, headerHeight };
}

Promise.all([
  buildTemplate({ width: 750, height: 1000, fileName: 'product-listing-brand-template-portrait.png' }),
  buildTemplate({ width: 1000, height: 1000, fileName: 'product-listing-brand-template-square.png' })
]).then((rows) => {
  rows.forEach((row) => process.stdout.write(`${row.outputPath} ${row.width}x${row.height} header=${row.headerHeight}\n${row.overlayPath}\n`));
}).catch((error) => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
