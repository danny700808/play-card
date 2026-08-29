'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const extensionHelpers = require('../easystore-shopee-autofill/helpers.js');

const root = path.resolve(__dirname, '..');
const extensionName = 'easystore-shopee-autofill';
const extensionRoot = path.join(root, extensionName);
const version = '0.3.31';
const zipName = `youzi-easystore-shopee-autofill-v${version}.zip`;
const zipPath = path.join(root, zipName);

function gitExtensionFiles() {
  const output = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', 'HEAD', '--', extensionName],
    { cwd: root, encoding: 'utf8' },
  );
  return output.trim().split(/\r?\n/)
    .filter(Boolean)
    .map((name) => name.slice(`${extensionName}/`.length))
    .sort();
}

function gitBlob(entryName) {
  return execFileSync('git', ['cat-file', 'blob', `HEAD:${entryName}`], {
    cwd: root,
    encoding: null,
  });
}

function zipFileEntries(buffer) {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const localSignature = 0x04034b50;
  let eocdOffset = -1;
  const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let index = buffer.length - 22; index >= minimumOffset; index -= 1) {
    if (buffer.readUInt32LE(index) === eocdSignature) {
      eocdOffset = index;
      break;
    }
  }
  assert.notEqual(eocdOffset, -1, 'ZIP 缺少中央目錄結尾');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);
  const files = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), centralSignature, `ZIP 中央目錄第 ${index + 1} 筆損壞`);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replaceAll('\\', '/');
    assert.doesNotMatch(name, /(^\/|(?:^|\/)\.\.(?:\/|$))/, `ZIP 含不安全路徑：${name}`);
    if (!name.endsWith('/')) {
      assert.equal(buffer.readUInt32LE(localOffset), localSignature, `ZIP 本機檔頭損壞：${name}`);
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
      const content = method === 0 ? Buffer.from(compressed)
        : method === 8 ? zlib.inflateRawSync(compressed)
          : null;
      assert.ok(content, `ZIP 使用未支援的壓縮方式 ${method}：${name}`);
      assert.equal(content.length, uncompressedSize, `ZIP 解壓長度不符：${name}`);
      assert.equal(files.has(name), false, `ZIP 有重複檔名：${name}`);
      files.set(name, content);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

test('0.3.31 ZIP contains exactly the Git extension files byte for byte', () => {
  assert.equal(fs.existsSync(zipPath), true, `缺少 ${zipName}`);
  const packaged = zipFileEntries(fs.readFileSync(zipPath));
  const sourceFiles = gitExtensionFiles();
  const expectedEntries = sourceFiles.map((name) => `${extensionName}/${name}`);
  assert.deepEqual([...packaged.keys()].sort(), expectedEntries);
  for (const relative of sourceFiles) {
    const entryName = `${extensionName}/${relative}`;
    assert.deepEqual(packaged.get(entryName), gitBlob(entryName), `ZIP 與 Git 檔案不同：${relative}`);
  }
  const packagedManifest = JSON.parse(packaged.get(extensionName + '/manifest.json').toString('utf8'));
  assert.ok(packagedManifest.host_permissions.includes('<all_urls>'));
  assert.ok(packagedManifest.permissions.includes('scripting'));
});

test('extension version, download links, cache keys and CI package contract stay aligned', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
  const operations = fs.readFileSync(path.join(root, 'operations-phase1.js'), 'utf8');
  const portal = fs.readFileSync(path.join(root, 'portal.html'), 'utf8');
  const hub = fs.readFileSync(path.join(root, 'operations-hub.html'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'verify-operations-live-search.yml'), 'utf8');
  const handoffCache = '20260823-shopee-v3-schema6';
  const operationsCssCache = '20260828-product-master-image-upload-recheck-v1';
  const operationsJsCache = '20260829-verified-covers-easystore-sync-v2';

  assert.equal(manifest.version, version);
  assert.equal(packageJson.version, version);
  assert.ok(manifest.host_permissions.includes('<all_urls>'));
  assert.ok(manifest.permissions.includes('scripting'));
  const linkedZips = [...operations.matchAll(/youzi-easystore-shopee-autofill-v[0-9.]+\.zip/g)].map((match) => match[0]);
  assert.ok(linkedZips.length > 0);
  assert.deepEqual([...new Set(linkedZips)], [zipName]);
  assert.doesNotMatch(operations, /youzi-easystore-shopee-autofill-v0\.3\.(?:21|22)\.zip|助手 0\.3\.(?:21|22)/);
  for (const markup of [portal, hub]) {
    assert.match(markup, new RegExp(`operations-shopee-autofill-handoff-v1\\.js\\?v=${handoffCache}`));
    assert.match(markup, new RegExp(`operations-phase1\\.css\\?v=${operationsCssCache}`));
    assert.match(markup, new RegExp(`operations-phase1\\.js\\?v=${operationsJsCache}`));
  }
  assert.match(workflow, new RegExp(`EXTENSION_VERSION: ${version.replaceAll('.', '\\.')}`));
  assert.match(workflow, new RegExp(`EXTENSION_ZIP: ${zipName.replaceAll('.', '\\.')}`));
  assert.match(workflow, new RegExp(handoffCache));
  assert.match(workflow, new RegExp(operationsCssCache));
  assert.match(workflow, new RegExp(operationsJsCache));
  assert.match(workflow, /diff -qr "\$EXTENSION_DIR" "\$package_dir\/\$EXTENSION_DIR"/);
  assert.equal((workflow.match(/tests\/shopee-extension-v2-package\.test\.js/g) || []).length, 2);
  const easyStoreExecutor = fs.readFileSync(path.join(extensionRoot, 'easystore.js'), 'utf8');
  assert.match(easyStoreExecutor, /function buildFieldLabelIndex\(/);
  assert.match(easyStoreExecutor, /function fillNativeAttributeBatch\(/);
  assert.match(easyStoreExecutor, /function fillAdvancedDescription\(/);
  assert.match(easyStoreExecutor, /使用 EasyStore 的產品描述/);
  assert.match(easyStoreExecutor, /payload && payload\.advancedDescription/);
  assert.match(easyStoreExecutor, /function advancedDescriptionEvidence\(/);
  assert.match(easyStoreExecutor, /use-easystore-rich-description-with-native-image-transfer/);
  assert.match(easyStoreExecutor, /fixedLastTwoComplete/);
  assert.match(easyStoreExecutor, /禁止以純文字描述發布/);
  assert.match(easyStoreExecutor, /function insertMissingAdvancedDescriptionImages\(/);
  assert.match(easyStoreExecutor, /report\.advancedDescriptionEvidence = evidence/);
  assert.match(easyStoreExecutor, /文字已帶入，但介紹圖片只有/);
  assert.match(easyStoreExecutor, /mode: "section-batch"/);
  assert.match(easyStoreExecutor, /nativeControlsFilledInSinglePass: true/);
});

test('production v3 Shopee sources contain no retired Match-product decision contract', () => {
  const productionFiles = [
    'operations-shopee-autofill-handoff-v1.js',
    'operations-phase1.js',
    'easystore-shopee-autofill/helpers.js',
    'easystore-shopee-autofill/bridge.js',
    'easystore-shopee-autofill/easystore.js',
    'easystore-shopee-autofill/README.md'
  ];
  const source = productionFiles.map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
  assert.doesNotMatch(source, /Match product|shopeeListingDecision|listingPolicy\.decision|allowCreate|existingListingIds|create-only-if-confirmed|youziShopeeAutofillQueueV1|YOUZI_SHOPEE_AUTOFILL_QUEUE(?:["']|\s|$)/);
  assert.match(source, /YOUZI_SHOPEE_AUTOFILL_QUEUE_V2/);
  assert.match(source, /youziShopeeAutofillQueueV2/);
});

test('a schema 5 record already present in storage can never be selected as a v3 job', () => {
  const legacyQueue = {
    '16403950': {
      receivedAt: 1_800_000_000_000,
      payload: {
        schemaVersion: 5,
        easyStoreProductId: '16403950',
        sku: '1040160-1',
        listingPolicy: {
          decision: 'existing', existingListingIds: ['4116442'],
          onZero: 'create-only-if-confirmed'
        }
      }
    }
  };
  assert.equal(extensionHelpers.selectQueueRecord(
    legacyQueue,
    'https://admin.easystore.co/products/16403950',
    '賣家 SKU 1040160-1',
    1_800_000_000_100
  ), null);
});
