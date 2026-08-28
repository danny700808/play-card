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

test('extracts and validates ISBN-13 embedded in a 9-series SKU', () => {
  assert.equal(covers.isValidIsbn13('9789866581816'), true);
  assert.equal(covers.isValidIsbn13('9789866581815'), false);
  assert.equal(covers.extractIsbn13('900卡林巴9789866581816'), '9789866581816');
  assert.equal(covers.extractIsbn13('900-978-986-6581-816'), '9789866581816');
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
});

test('Google Books candidate requires exact ISBN for an ISBN query', () => {
  const base = {
    id: 'book-1',
    volumeInfo: {
      title: '吉他奏法大圖鑑',
      industryIdentifiers: [{ type: 'ISBN_13', identifier: '9789866581304' }],
      imageLinks: { large: 'http://books.google.com/cover.jpg&zoom=1' }
    }
  };
  const exact = covers.googleCandidate(base, '典弦教材-吉他奏法大圖鑑', '9789866581304', true);
  assert.equal(exact.matchMethod, 'isbn');
  assert.equal(exact.matchScore, 1);
  assert.match(exact.imageUrl, /^https:/);
  assert.match(exact.imageUrl, /zoom=3/);
  assert.equal(covers.googleCandidate(base, '吉他奏法大圖鑑', '9789866581816', true), null);
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
