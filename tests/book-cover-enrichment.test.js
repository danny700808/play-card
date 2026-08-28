'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function mockFirebase(request, parent, isMain) {
  if (request === 'firebase-functions/v2/https') {
    class HttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    return { onCall: (_options, handler) => handler, HttpsError };
  }
  if (request === 'firebase-admin') {
    const firestore = () => ({ collection: () => { throw new Error('database not used in helper tests'); } });
    firestore.FieldValue = { serverTimestamp: () => ({}), increment: (value) => value };
    return { apps: [{}], firestore, storage: () => ({ bucket: () => ({}) }) };
  }
  if (request === 'sharp') {
    return function sharpMock() { throw new Error('sharp not used in helper tests'); };
  }
  return originalLoad(request, parent, isMain);
};

const covers = require('../functions/bookCoverEnrichment');
Module._load = originalLoad;

test('cover lookup strips ISBN-like digits and searches by the product name only', () => {
  assert.equal(covers.bookSearchTitle('吉他奏法大圖鑑 ISBN 9789866581304'), '吉他奏法大圖鑑');
  assert.equal(covers.bookSearchTitle('典弦教材-MELODY寫一首簡單的歌'), 'MELODY寫一首簡單的歌');
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'functions', 'bookCoverEnrichment.js'), 'utf8');
  assert.doesNotMatch(source, /`isbn:\$\{/i);
  assert.doesNotMatch(source, /openlibrary\.org\/api\/books/i);
});

test('9-series selection excludes explicit test products', () => {
  assert.equal(covers.isNineSeriesBook({ internalSku: '900AG9789866581304', internalName: '典弦教材-吉他奏法大圖鑑' }), true);
  assert.equal(covers.isNineSeriesBook({ internalSku: '9IN331', internalName: '測試（書）' }), false);
  assert.equal(covers.isNineSeriesBook({ internalSku: '2100307', internalName: '譜架' }), false);
});

test('book-title matching accepts roughly 80 percent identity after normalization', () => {
  assert.equal(covers.normalizeBookTitle('典弦教材-新琴點撥 2024版 橘色'), '新琴點撥2024版橘色');
  assert.ok(covers.titleSimilarity('典弦教材-新琴點撥 2024版 橘色', '新琴點撥 2024版（橘色）') >= 0.8);
  assert.ok(covers.titleSimilarity('吉他奏法大圖鑑', '電子琴入門教程') < 0.8);
  assert.equal(covers.titleCoverage('吉客開始 客家歌謠吉他入門', '吉客開始 客家歌謠吉他入門｜網路書店商品頁'), 1);
  assert.ok(covers.titleMatchScore('吉客開始 客家歌謠吉他入門', '吉客開始 客家歌謠吉他入門｜網路書店商品頁') >= 0.8);
});

test('Google Books candidate uses title similarity only', () => {
  const base = {
    id: 'book-1',
    volumeInfo: {
      title: '吉他奏法大圖鑑',
      industryIdentifiers: [{ type: 'ISBN_13', identifier: '9789866581304' }],
      imageLinks: { large: 'http://books.google.com/cover.jpg&zoom=1' }
    }
  };
  const match = covers.googleCandidate(base, '典弦教材-吉他奏法大圖鑑');
  assert.equal(match.matchMethod, 'title-only');
  assert.ok(match.matchScore >= 0.8);
  assert.match(match.imageUrl, /^https:/);
  assert.match(match.imageUrl, /zoom=3/);
  assert.equal(covers.googleCandidate(base, '電子琴入門教程'), null);
});

test('commerce fallback includes the approved music-book sources', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'functions', 'bookCoverEnrichment.js'), 'utf8');
  for (const domain of ['talubook.com', 'musikershop.com', 'musicmusic.com.tw', 'books.com.tw']) {
    assert.match(source, new RegExp(`site:${domain.replace(/\./g, '\\.')}`));
  }
  assert.doesNotMatch(source, /site:overtop-music\.com/);
});

test('Taaze title search finds product pages and promotes the product image instead of a thumbnail', () => {
  const html = '<a href="/products/11100161819.html">Melody：寫一首簡單的歌</a>';
  assert.deepEqual(covers.taazeResultUrls(html, 'MELODY寫一首簡單的歌'), ['http://www.taaze.tw/products/11100161819.html']);
  assert.equal(
    covers.promoteTrustedCoverImageUrl(
      'https://media.taaze.tw/showThumbnail.html?sc=11100161819&height=400&width=310',
      'http://www.taaze.tw/products/11100161819.html'
    ),
    'https://media.taaze.tw/showProdImage.html?sc=11100161819&height=1400&width=1000'
  );
});

test('the portal resumes the current cover job instead of restarting completed chunks', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const functionSource = fs.readFileSync(path.join(__dirname, '..', 'functions', 'bookCoverEnrichment.js'), 'utf8');
  const portalSource = fs.readFileSync(path.join(__dirname, '..', 'operations-phase1.js'), 'utf8');
  assert.match(functionSource, /action === 'resume-or-start'/);
  assert.match(portalSource, /callable\(\{action:'resume-or-start'\}\)/);
  assert.doesNotMatch(portalSource, /callable\(\{action:'start'\}\)/);
});

test('book covers must be clear, complete portrait images', () => {
  assert.equal(covers.coverDimensionsAreAcceptable(800, 1200), true);
  assert.equal(covers.coverDimensionsAreAcceptable(1000, 1000), false);
  assert.equal(covers.coverDimensionsAreAcceptable(1200, 700), false);
  assert.equal(covers.coverDimensionsAreAcceptable(240, 360), false);
  assert.equal(covers.coverDimensionsAreAcceptable(500, 1200), false);
});

test('image-search candidates require strong title similarity without ISBN matching', () => {
  const good = JSON.stringify({
    murl: 'https://cdn.example.com/full-cover.jpg',
    purl: 'https://shop.example.com/books/9789866581366',
    t: '節奏吉他完全解析 附 CD'
  }).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const wrong = JSON.stringify({
    murl: 'https://cdn.example.com/cat.jpg',
    purl: 'https://example.com/cat',
    t: '可愛貓咪海報'
  }).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const html = `<a class="iusc" m="${good}"></a><a class="iusc" m="${wrong}"></a>`;
  const rows = covers.bingImageCandidates(html, '典絃教材-節奏吉他完全解析');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].imageUrl, 'https://cdn.example.com/full-cover.jpg');
  assert.equal(rows[0].matchMethod, 'title-only');
});
