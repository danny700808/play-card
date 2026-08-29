'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const sharp = require('sharp');

const REGION = 'us-central1';
const PRODUCT_COLLECTION = 'opsInternalProducts';
const JOB_COLLECTION = 'opsBookCoverEnrichmentJobs';
const COVER_RULE_VERSION = 'youzi-nine-series-book-cover-v7-chinese-title-edition-aware';
const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);
const DEFAULT_CHUNK_SIZE = 6;
const MAX_CHUNK_SIZE = 10;
const FETCH_TIMEOUT_MS = 20 * 1000;
const MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024;

// These covers were checked against the Chinese product title first, then the
// subtitle/volume/edition printed on the front cover.  Keep this list keyed by
// the normalized product name rather than SKU/ISBN because the store's 9-series
// codes may contain locally-added prefixes or suffixes.
const CURATED_COVERS_BY_TITLE = new Map([
  ['新琴點撥2024版橘色', {
    sourceRecordUrl: 'https://www.musicth.com.tw/item.php?PART_NO=IA001',
    imageUrl: 'https://www.musicth.com.tw/Uploads/2024-09-25_IA001_0.jpg'
  }],
  ['超絕吉他地獄訓練所20年精華篇', {
    sourceRecordUrl: 'https://www.musicth.com.tw/item.php?PART_NO=IA02614',
    imageUrl: 'https://www.musicth.com.tw/Uploads/2025-02-14_IA02614_0.jpg'
  }],
  ['爵士鼓過門大事典413', {
    sourceRecordUrl: 'https://www.musicth.com.tw/item.php?PART_NO=IA00308',
    imageUrl: 'https://www.musicth.com.tw/Uploads/2024-03-06_IA00308_0.jpg'
  }],
  ['完整一冊鼓踏技巧百科', {
    sourceRecordUrl: 'https://www.musicth.com.tw/item.php?PART_NO=IA00309',
    imageUrl: 'https://www.musicth.com.tw/Uploads/2024-05-16_IA00309_0.jpg'
  }],
  ['yamahac調鋼琴獨奏迪士尼曲集', {
    sourceRecordUrl: 'https://www.tomleemusic.com.hk/en/products/disney-songs-in-c-major-for-piano-solo-easy-level',
    imageUrl: 'https://www.tomleemusic.com.hk/cdn/shop/products/ec1758158_1200x1602.jpg?v=1633940509'
  }],
  ['動漫歌曲女神曲集jewel鋼琴樂譜集', {
    sourceRecordUrl: 'https://www.musicth.com.tw/item.php?PART_NO=MD096281',
    imageUrl: 'https://www.musicth.com.tw/Uploads/2019-07-17_MD096281_0.jpg'
  }],
  ['yamaha吉卜力鋼琴獨奏暢銷曲入門版', {
    sourceRecordUrl: 'https://www.musicth.com.tw/item.php?PART_NO=YA096568',
    imageUrl: 'https://www.musicth.com.tw/Uploads/2020-04-15_YA096568_0.jpg'
  }]
]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function isAllowedManager(request) {
  const auth = request && request.auth;
  const token = auth && auth.token ? auth.token : {};
  const email = normalizeEmail(token.email || (auth && auth.email));
  const role = clean(token.role || token.userRole || token.permissionRole).toLowerCase();
  return !!(
    auth && (
      token.admin === true || token.manager === true || token.owner === true ||
      ['admin', 'manager', 'owner', '主管', '管理者'].includes(role) ||
      ADMIN_EMAILS.has(email)
    )
  );
}

function normalizeSku(value) {
  return clean(value).replace(/^'+/, '').replace(/\s+/g, '').toUpperCase();
}

function productSku(product) {
  const source = product || {};
  return normalizeSku(source.internalSku || source.sku || source.code || source.productSku);
}

function productName(product) {
  const source = product || {};
  return clean(source.internalName || source.originalName || source.name || source.onlineName);
}

function isNineSeriesBook(product) {
  const sku = productSku(product);
  const name = productName(product);
  if (!sku.startsWith('9')) return false;
  if (!name || /測試/i.test(name)) return false;
  return true;
}

function normalizeBookTitle(value) {
  return clean(value)
    .normalize('NFKC')
    .replace(/^(?:典[弦絃]|卓著|麥書|大陸|美樂)教材\s*[-－:：|]*/i, '')
    .replace(/(?:ISBN)?\s*(?:978|979)[\d\s-]{10,}/gi, '')
    .replace(/[\s\p{P}\p{S}_]+/gu, '')
    .toLowerCase();
}

function bookSearchTitle(value) {
  return clean(value)
    .normalize('NFKC')
    .replace(/^(?:典[弦絃]|卓著|麥書|大陸|美樂)教材\s*[-－:：|]*/i, '')
    .replace(/(?:ISBN)?\s*(?:978|979)[\d\s-]{10,}/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value) {
  return clean(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code) || 0)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Math.min(0x10ffff, parseInt(code, 16) || 0)));
}

function stripHtml(value) {
  return decodeHtml(clean(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

function resolveHttpUrl(value, baseUrl) {
  const raw = decodeHtml(value);
  if (!raw || /^(?:data|javascript):/i.test(raw)) return '';
  try {
    const parsed = new URL(raw, baseUrl);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch (_) {
    return '';
  }
}

function titleBigrams(value) {
  const text = normalizeBookTitle(value);
  if (!text) return [];
  if (text.length === 1) return [text];
  const rows = [];
  for (let index = 0; index < text.length - 1; index += 1) rows.push(text.slice(index, index + 2));
  return rows;
}

function titleSimilarity(left, right) {
  const a = titleBigrams(left);
  const b = titleBigrams(right);
  if (!a.length || !b.length) return 0;
  const counts = new Map();
  b.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
  let shared = 0;
  a.forEach((token) => {
    const available = counts.get(token) || 0;
    if (available > 0) {
      shared += 1;
      counts.set(token, available - 1);
    }
  });
  return (2 * shared) / (a.length + b.length);
}

function titleCoverage(requestedTitle, candidateTitle) {
  const requested = titleBigrams(requestedTitle);
  const candidate = titleBigrams(candidateTitle);
  if (!requested.length || !candidate.length) return 0;
  const counts = new Map();
  candidate.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
  let covered = 0;
  requested.forEach((token) => {
    const available = counts.get(token) || 0;
    if (available > 0) {
      covered += 1;
      counts.set(token, available - 1);
    }
  });
  return covered / requested.length;
}

function titleMatchScore(requestedTitle, candidateTitle) {
  return Math.max(
    titleSimilarity(requestedTitle, candidateTitle),
    titleCoverage(requestedTitle, candidateTitle)
  );
}

function titleQualifierTokens(value) {
  const text = bookSearchTitle(value).normalize('NFKC');
  const tokens = new Set();
  const patterns = [
    /第\s*[0-9一二三四五六七八九十百]+\s*(?:冊|集|篇|級|版|卷|部)/giu,
    /[0-9]+\s*(?:年|冊|集|篇|級|版|卷|部)/giu,
    /[0-9]+/gu,
    /(?:入門|簡易|初級|中階|中級|進階|高級|先修)(?:版|本|級)?/giu,
    /(?:上|中|下)(?:冊|集|篇|卷|部)/gu,
    /(?:二|三|四|五|六|七|八|九|十)版/gu,
    /\bvol(?:ume)?\.?\s*[0-9]+\b/giu
  ];
  patterns.forEach((pattern) => {
    for (const match of text.matchAll(pattern)) {
      tokens.add(clean(match[0]).replace(/\s+/g, '').toLowerCase());
    }
  });
  const standaloneLevel = text.match(/(?:^|[\s()（）\[\]【】_-])([A-Z])(?=$|[\s()（）\[\]【】_-])/i);
  if (standaloneLevel) tokens.add(standaloneLevel[1].toLowerCase());
  const trailingPart = normalizeBookTitle(text).match(/([上中下])$/u);
  if (trailingPart) tokens.add(trailingPart[1]);
  const trailingOrdinal = normalizeBookTitle(text).match(/([0-9]+|[一二三四五六七八九十]+)$/u);
  if (trailingOrdinal) tokens.add(trailingOrdinal[1]);
  return [...tokens];
}

function requestedSubtitle(value) {
  const text = bookSearchTitle(value);
  const separator = text.search(/[：:]/u);
  return separator >= 0 ? clean(text.slice(separator + 1)) : '';
}

function titleMatchesRequested(requestedTitle, candidateTitle, minimumScore = 0.8) {
  if (titleMatchScore(requestedTitle, candidateTitle) < minimumScore) return false;
  const candidateQualifiers = new Set(titleQualifierTokens(candidateTitle));
  if (titleQualifierTokens(requestedTitle).some((token) => !candidateQualifiers.has(token))) return false;
  const subtitle = requestedSubtitle(requestedTitle);
  if (normalizeBookTitle(subtitle).length >= 4 && titleCoverage(subtitle, candidateTitle) < 0.7) return false;
  return true;
}

function googleCoverUrl(volume) {
  const links = volume && volume.volumeInfo && volume.volumeInfo.imageLinks;
  if (!links || typeof links !== 'object') return '';
  const raw = links.extraLarge || links.large || links.medium || links.small || links.thumbnail || links.smallThumbnail || '';
  if (!raw) return '';
  return clean(raw).replace(/^http:/i, 'https:').replace(/&zoom=\d+/i, '&zoom=3').replace(/&edge=curl/ig, '');
}

function googleCandidate(volume, requestedTitle) {
  const info = volume && volume.volumeInfo ? volume.volumeInfo : {};
  const title = [clean(info.title), clean(info.subtitle)].filter(Boolean).join(' ');
  const similarity = titleMatchScore(requestedTitle, title);
  const imageUrl = googleCoverUrl(volume);
  if (!imageUrl) return null;
  if (!titleMatchesRequested(requestedTitle, title)) return null;
  return {
    source: 'google-books',
    sourceRecordUrl: volume && volume.id ? `https://books.google.com/books?id=${encodeURIComponent(volume.id)}` : '',
    imageUrl,
    matchedTitle: title,
    matchedIsbn: '',
    matchMethod: 'title-only',
    matchScore: similarity
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'YouziMusicBookCoverEnrichment/1.0' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7',
      'user-agent': 'Mozilla/5.0 (compatible; YouziMusicBookCoverEnrichment/1.0)'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > 4 * 1024 * 1024) throw new Error('商品頁過大');
  const text = await response.text();
  return { text: text.slice(0, 4 * 1024 * 1024), finalUrl: response.url || url };
}

function duckDuckGoResultUrls(html) {
  const urls = [];
  const expression = /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["']/gi;
  let match;
  while ((match = expression.exec(clean(html))) && urls.length < 12) {
    const href = decodeHtml(match[1]);
    let resolved = resolveHttpUrl(href.startsWith('//') ? `https:${href}` : href, 'https://duckduckgo.com/');
    try {
      const parsed = new URL(resolved);
      const target = parsed.searchParams.get('uddg');
      if (target) resolved = decodeURIComponent(target);
    } catch (_) {}
    if (!/^https?:\/\//i.test(resolved)) continue;
    if (/duckduckgo\.com|google\.com\/search|bing\.com\/search/i.test(resolved)) continue;
    if (!urls.includes(resolved)) urls.push(resolved);
  }
  return urls;
}

function bingResultUrls(html) {
  const urls = [];
  const expression = /<li\b[^>]*class=["'][^"']*b_algo[^"']*["'][^>]*>[\s\S]*?<h2\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["']/gi;
  let match;
  while ((match = expression.exec(clean(html))) && urls.length < 12) {
    const resolved = resolveHttpUrl(match[1], 'https://www.bing.com/');
    if (!resolved || /bing\.com\/(?:search|ck\/a)/i.test(resolved)) continue;
    if (!urls.includes(resolved)) urls.push(resolved);
  }
  return urls;
}

function taazeResultUrls(html, requestedTitle) {
  const urls = [];
  const expression = /<a\b[^>]*href=["'][^"']*(?:products\/|prod_cat_id=)(\d{11})(?:\.html)?[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = expression.exec(clean(html))) && urls.length < 24) {
    const label = stripHtml(match[2]);
    if (!titleMatchesRequested(requestedTitle, label)) continue;
    const url = `http://www.taaze.tw/products/${match[1]}.html`;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

function promoteTrustedCoverImageUrl(value, pageUrl) {
  const resolved = resolveHttpUrl(value, pageUrl);
  if (!resolved) return '';
  try {
    const parsed = new URL(resolved);
    if (parsed.hostname.toLowerCase() === 'media.taaze.tw' &&
        /^\/show(?:ProdImage|Thumbnail)\.html$/i.test(parsed.pathname) &&
        /^\d{11}$/.test(clean(parsed.searchParams.get('sc')))) {
      parsed.pathname = '/showProdImage.html';
      parsed.searchParams.set('width', '1000');
      parsed.searchParams.set('height', '1400');
      return parsed.href;
    }
  } catch (_) {}
  return resolved;
}

function bingImageCandidates(html, requestedTitle) {
  const candidates = [];
  const expression = /<a\b[^>]*class=["'][^"']*\biusc\b[^"']*["'][^>]*\bm=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = expression.exec(clean(html))) && candidates.length < 30) {
    let payload;
    try { payload = JSON.parse(decodeHtml(match[1])); } catch (_) { continue; }
    const imageUrl = resolveHttpUrl(payload && payload.murl, 'https://www.bing.com/');
    const sourceRecordUrl = resolveHttpUrl(payload && payload.purl, 'https://www.bing.com/');
    const matchedTitle = stripHtml(payload && (payload.t || payload.desc));
    const similarity = titleMatchScore(requestedTitle, matchedTitle);
    if (!imageUrl || !titleMatchesRequested(requestedTitle, matchedTitle)) continue;
    candidates.push({
      source: 'image-search-original',
      sourceRecordUrl,
      imageUrl,
      matchedTitle: matchedTitle || requestedTitle,
      matchedIsbn: '',
      matchMethod: 'title-only',
      matchScore: similarity
    });
  }
  return uniqueCoverCandidates(candidates);
}

function pageTitle(html) {
  const title = clean((clean(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const heading = clean((clean(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  return stripHtml([heading, title].filter(Boolean).join(' '));
}

function pageImageRows(html, pageUrl, requestedTitle) {
  const rows = [];
  function add(rawUrl, alt, baseScore) {
    const url = promoteTrustedCoverImageUrl(rawUrl, pageUrl);
    if (!url || rows.some((row) => row.url === url)) return;
    const lower = url.toLowerCase();
    if (/\.(?:svg|gif)(?:$|[?#])/.test(lower)) return;
    let score = Number(baseScore || 0);
    if (/(?:goods|product|book|cover|front|large|original|detail|upload|pic)/i.test(lower)) score += 3;
    if (/(?:goods_img|bookpic|product_image|cover_image)/i.test(lower)) score += 4;
    if (/(?:thumb|small)/i.test(lower)) score -= 1;
    if (/(?:logo|icon|sprite|avatar|banner|header|footer|qr|qrcode|loading|placeholder)/i.test(lower)) score -= 12;
    const similarity = titleMatchScore(requestedTitle, alt);
    if (similarity >= 0.8) score += 5;
    else if (similarity >= 0.45) score += 2;
    rows.push({ url, score, alt: stripHtml(alt) });
  }
  const meta = /<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["'][^>]*>|<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image(?::src)?)["'][^>]*>/gi;
  let match;
  while ((match = meta.exec(clean(html)))) add(match[1] || match[2], '', 6);
  const jsonImage = /["'](?:image|imageUrl|largeImage)["']\s*:\s*(?:\[\s*)?["']([^"']+)["']/gi;
  while ((match = jsonImage.exec(clean(html)))) add(match[1], '', 5);
  const img = /<img\b([^>]*?)>/gi;
  while ((match = img.exec(clean(html)))) {
    const attrs = match[1] || '';
    const source = (attrs.match(/(?:src|data-src|data-original|data-lazy-src)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const alt = (attrs.match(/alt\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    add(source, alt, 1);
  }
  return rows.sort((left, right) => right.score - left.score);
}

async function discoverTaazeCoverCandidates(title) {
  const queryTitle = clean(title);
  if (!queryTitle) return [];
  try {
    const searchUrl = `http://www.taaze.tw/rwd_searchResult.html?keyType%5B%5D=0&keyword%5B%5D=${encodeURIComponent(queryTitle)}`;
    const search = await fetchText(searchUrl);
    const urls = taazeResultUrls(search.text, queryTitle);
    const settled = await Promise.allSettled(urls.map((url) => candidateFromCommercePage(url, queryTitle)));
    return uniqueCoverCandidates(settled
      .filter((row) => row.status === 'fulfilled' && Array.isArray(row.value))
      .flatMap((row) => row.value));
  } catch (_) {
    return [];
  }
}

async function candidateFromCommercePage(pageUrl, requestedTitle) {
  if (/\b(?:shopee|amazon|facebook|instagram)\./i.test(pageUrl)) return null;
  const page = await fetchText(pageUrl);
  const title = pageTitle(page.text);
  const similarity = titleMatchScore(requestedTitle, title);
  if (!titleMatchesRequested(requestedTitle, title)) return null;
  const images = pageImageRows(page.text, page.finalUrl, requestedTitle).filter((row) => row.score >= 1);
  if (!images.length) return null;
  return images.slice(0, 6).map((image) => ({
    source: 'verified-commerce-page',
    sourceRecordUrl: page.finalUrl,
    imageUrl: image.url,
    matchedTitle: title || requestedTitle,
    matchedIsbn: '',
    matchMethod: 'title-only',
    matchScore: similarity + Math.max(-0.02, Math.min(0.02, Number(image.score || 0) / 1000))
  }));
}

async function discoverCommerceCoverCandidates(title) {
  if (!clean(title)) return [];
  const queries = [
    `${title} 封面 site:musicth.com.tw`,
    `${title} 封面 site:goodin.com.tw`,
    `${title} 封面 site:kaiyimusic.com.tw`,
    `${title} 封面 site:mingtinghuang.com`,
    `${title} 封面 site:talubook.com`,
    `${title} 封面 site:musikershop.com`,
    `${title} 封面 site:musicmusic.com.tw`,
    `${title} 封面 site:books.com.tw`,
    `${title} 樂譜 教材 正面封面`
  ];
  let candidates = [];
  for (const query of queries) {
    let urls = [];
    try {
      const search = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
      urls = duckDuckGoResultUrls(search.text).slice(0, 8);
    } catch (_) {}
    let settled = await Promise.allSettled(urls.map((url) => candidateFromCommercePage(url, title)));
    candidates.push(...settled
      .filter((row) => row.status === 'fulfilled' && Array.isArray(row.value))
      .flatMap((row) => row.value));
    try {
      const search = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10&setlang=zh-Hant`);
      urls = bingResultUrls(search.text).slice(0, 8);
      settled = await Promise.allSettled(urls.map((url) => candidateFromCommercePage(url, title)));
      candidates.push(...settled
        .filter((row) => row.status === 'fulfilled' && Array.isArray(row.value))
        .flatMap((row) => row.value));
    } catch (_) {}
    candidates = uniqueCoverCandidates(candidates);
    if (candidates.length >= 36) break;
  }
  candidates.sort((left, right) => Number(right.matchScore || 0) - Number(left.matchScore || 0));
  return uniqueCoverCandidates(candidates);
}

async function discoverImageSearchCandidates(title) {
  const queryTitle = clean(title);
  if (!queryTitle) return [];
  const queries = [
    `${queryTitle} 封面`,
    `"${queryTitle}" 書 封面`,
    `${queryTitle} 樂譜 教材 封面`
  ];
  const candidates = [];
  for (const query of queries) {
    try {
      const search = await fetchText(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&cc=TW&setlang=zh-TW`);
      candidates.push(...bingImageCandidates(search.text, title));
    } catch (_) {}
    if (uniqueCoverCandidates(candidates).length >= 24) break;
  }
  return uniqueCoverCandidates(candidates);
}

async function googleBooksCandidates(query, title) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=20&printType=books`;
  const payload = await fetchJson(url);
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  return items.map((item) => googleCandidate(item, title)).filter(Boolean);
}

function uniqueCoverCandidates(candidates) {
  const seen = new Set();
  return (Array.isArray(candidates) ? candidates : []).filter((candidate) => {
    const url = clean(candidate && candidate.imageUrl);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function curatedCoverCandidate(product) {
  const title = bookSearchTitle(productName(product));
  const entry = CURATED_COVERS_BY_TITLE.get(normalizeBookTitle(title));
  if (!entry) return null;
  return {
    source: 'curated-chinese-title',
    sourceRecordUrl: entry.sourceRecordUrl,
    imageUrl: entry.imageUrl,
    matchedTitle: title,
    matchedIsbn: '',
    matchMethod: 'chinese-title-edition-verified',
    matchScore: 1.1
  };
}

async function findBookCoverCandidates(product) {
  const name = productName(product);
  const searchTitle = bookSearchTitle(name);
  const candidates = [];
  const curated = curatedCoverCandidate(product);
  if (curated) candidates.push(curated);
  const queryTitle = normalizeBookTitle(searchTitle).slice(0, 80);
  if (queryTitle.length >= 2) {
    try {
      candidates.push(...await googleBooksCandidates(`intitle:${queryTitle}`, searchTitle));
    } catch (_) {}
  }
  try {
    candidates.push(...await discoverCommerceCoverCandidates(searchTitle));
  } catch (_) {}
  try {
    candidates.push(...await discoverTaazeCoverCandidates(searchTitle));
  } catch (_) {}
  try {
    candidates.push(...await discoverImageSearchCandidates(searchTitle));
  } catch (_) {}
  const uniqueCandidates = uniqueCoverCandidates(candidates);
  uniqueCandidates.sort((left, right) => Number(right.matchScore || 0) - Number(left.matchScore || 0));
  return { candidates: uniqueCandidates, isbn: '' };
}

async function findBookCoverCandidate(product) {
  const found = await findBookCoverCandidates(product);
  return { candidate: found.candidates[0] || null, isbn: found.isbn };
}

async function fetchImageBuffer(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (compatible; YouziMusicBookCoverEnrichment/1.0)'
    }
  });
  if (!response.ok) throw new Error(`封面圖片 HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_REMOTE_IMAGE_BYTES) throw new Error('封面圖片檔案過大');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_REMOTE_IMAGE_BYTES) throw new Error('封面圖片檔案無效');
  return buffer;
}

function coverDimensionsAreAcceptable(width, height) {
  const safeWidth = Number(width || 0);
  const safeHeight = Number(height || 0);
  if (safeWidth < 500 || safeHeight < 650) return false;
  const portraitRatio = safeHeight / safeWidth;
  return portraitRatio >= 1.15 && portraitRatio <= 2.2;
}

async function normalizeCoverImage(buffer) {
  const pipeline = sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate();
  const metadata = await pipeline.metadata();
  if (!coverDimensionsAreAcceptable(metadata.width, metadata.height)) {
    throw new Error('封面必須是清楚、完整的直式正面圖（至少 500×650）');
  }
  const output = await pipeline
    .resize({ width: 1200, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return { buffer: output, width: metadata.width, height: metadata.height };
}

function firebaseDownloadUrl(bucketName, objectPath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(objectPath)}?alt=media&token=${encodeURIComponent(token)}`;
}

async function saveCoverToStorage(productId, sku, candidate, image) {
  const bucket = admin.storage().bucket();
  const digest = crypto.createHash('sha256').update(image.buffer).digest('hex');
  const safeId = clean(productId).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 120) || 'product';
  const objectPath = `product-book-covers/${safeId}/${digest.slice(0, 24)}.jpg`;
  const token = crypto.randomUUID();
  await bucket.file(objectPath).save(image.buffer, {
    resumable: false,
    validation: 'md5',
    metadata: {
      contentType: 'image/jpeg',
      cacheControl: 'public,max-age=31536000,immutable',
      metadata: {
        firebaseStorageDownloadTokens: token,
        sourceUrl: candidate.imageUrl,
        sourceRecordUrl: candidate.sourceRecordUrl,
        sourceName: candidate.source,
        productSku: sku,
        ruleVersion: COVER_RULE_VERSION
      }
    }
  });
  return {
    url: firebaseDownloadUrl(bucket.name, objectPath, token),
    objectPath,
    sha256: digest
  };
}

function existingProductImages(product) {
  const rows = [];
  [product && product.imageUrl, product && product.imageUrls, product && product.parentImageUrls,
    product && product.variantImageUrls].forEach((value) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((row) => {
      const url = clean(row);
      if (/^https?:\/\//i.test(url) && !rows.includes(url)) rows.push(url);
    });
  });
  return rows;
}

async function enrichOneProduct(db, item, actor) {
  const ref = db.collection(PRODUCT_COLLECTION).doc(item.productId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return { status: 'skipped', productId: item.productId, sku: item.sku, reason: '中央商品不存在' };
  const product = snapshot.data() || {};
  if (!isNineSeriesBook(product)) return { status: 'skipped', productId: item.productId, sku: item.sku, reason: '非 9 系列正式課本' };
  const found = await findBookCoverCandidates(product);
  let acceptedCandidate = null;
  let image = null;
  const rejectedCandidates = [];
  for (const candidate of found.candidates.slice(0, 30)) {
    try {
      const remote = await fetchImageBuffer(candidate.imageUrl);
      image = await normalizeCoverImage(remote);
      acceptedCandidate = candidate;
      break;
    } catch (error) {
      rejectedCandidates.push({
        imageUrl: candidate.imageUrl,
        reason: clean(error && error.message) || '封面圖片不合格'
      });
    }
  }
  if (!acceptedCandidate || !image) {
    const priorManagedUrl = clean(product && product.bookCoverEnrichment && product.bookCoverEnrichment.storedImageUrl);
    const remainingImages = existingProductImages(product).filter((url) => url !== priorManagedUrl);
    const unresolvedUpdate = {
      bookCoverEnrichment: {
        status: 'unresolved', ruleVersion: COVER_RULE_VERSION, isbn: found.isbn,
        rejectedCandidates: rejectedCandidates.slice(0, 12),
        attemptedAt: admin.firestore.FieldValue.serverTimestamp(), attemptedBy: actor
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (priorManagedUrl) {
      unresolvedUpdate.imageUrls = remainingImages;
      unresolvedUpdate.imageUrl = remainingImages[0] || admin.firestore.FieldValue.delete();
    }
    await ref.set(unresolvedUpdate, { merge: true });
    return { status: 'unresolved', productId: item.productId, sku: productSku(product), name: productName(product), isbn: found.isbn, reason: '找不到可靠的正面封面' };
  }
  const stored = await saveCoverToStorage(item.productId, productSku(product), acceptedCandidate, image);
  const priorManagedUrl = clean(product && product.bookCoverEnrichment && product.bookCoverEnrichment.storedImageUrl);
  const previousImages = existingProductImages(product).filter((url) => url !== stored.url && url !== priorManagedUrl);
  const imageUrls = [stored.url, ...previousImages].slice(0, 20);
  const update = {
    imageUrl: stored.url,
    imageUrls,
    bookCoverEnrichment: {
      status: 'matched', ruleVersion: COVER_RULE_VERSION,
      isbn: found.isbn || acceptedCandidate.matchedIsbn || '',
      matchMethod: acceptedCandidate.matchMethod,
      matchScore: acceptedCandidate.matchScore,
      matchedTitle: acceptedCandidate.matchedTitle,
      source: acceptedCandidate.source,
      sourceRecordUrl: acceptedCandidate.sourceRecordUrl,
      sourceImageUrl: acceptedCandidate.imageUrl,
      storedImageUrl: stored.url,
      storageObjectPath: stored.objectPath,
      sha256: stored.sha256,
      sourceWidth: image.width,
      sourceHeight: image.height,
      verifiedFrontCover: true,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedBy: actor
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actor
  };
  await ref.set(update, { merge: true });
  const reread = await ref.get();
  const saved = reread.data() || {};
  if (clean(saved.imageUrl) !== stored.url || !Array.isArray(saved.imageUrls) || saved.imageUrls[0] !== stored.url) {
    throw new Error('封面寫入後驗證失敗');
  }
  return {
    status: 'matched', productId: item.productId, sku: productSku(product), name: productName(product),
    isbn: update.bookCoverEnrichment.isbn, matchMethod: acceptedCandidate.matchMethod,
    matchScore: acceptedCandidate.matchScore, matchedTitle: acceptedCandidate.matchedTitle,
    imageUrl: stored.url
  };
}

async function startJob(request) {
  const db = admin.firestore();
  const snapshot = await db.collection(PRODUCT_COLLECTION).get();
  const items = [];
  snapshot.forEach((doc) => {
    const product = doc.data() || {};
    if (!isNineSeriesBook(product)) return;
    items.push({ productId: doc.id, sku: productSku(product), name: productName(product) });
  });
  items.sort((left, right) => left.sku.localeCompare(right.sku, 'zh-Hant', { numeric: true }));
  const jobRef = db.collection(JOB_COLLECTION).doc();
  const actor = normalizeEmail(request.auth && request.auth.token && request.auth.token.email) || clean(request.auth && request.auth.uid);
  await jobRef.set({
    jobId: jobRef.id,
    ruleVersion: COVER_RULE_VERSION,
    status: items.length ? 'running' : 'completed',
    total: items.length,
    cursor: 0,
    matchedCount: 0,
    unresolvedCount: 0,
    failedCount: 0,
    items,
    requestedAt: admin.firestore.FieldValue.serverTimestamp(),
    requestedBy: actor,
    completedAt: items.length ? null : admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true, action: 'start', jobId: jobRef.id, total: items.length, cursor: 0, done: !items.length };
}

async function resumeOrStartJob(request) {
  const db = admin.firestore();
  const actor = normalizeEmail(request.auth && request.auth.token && request.auth.token.email) || clean(request.auth && request.auth.uid);
  const recent = await db.collection(JOB_COLLECTION).orderBy('requestedAt', 'desc').limit(20).get();
  let active = null;
  recent.forEach((snapshot) => {
    if (active) return;
    const row = snapshot.data() || {};
    if (clean(row.status) !== 'running') return;
    if (clean(row.ruleVersion) !== COVER_RULE_VERSION) return;
    if (normalizeEmail(row.requestedBy) !== normalizeEmail(actor)) return;
    active = { id: snapshot.id, ...row };
  });
  if (!active) return startJob(request);
  const total = Math.max(0, Number(active.total || 0));
  const cursor = Math.max(0, Number(active.cursor || 0));
  return {
    ok: true,
    action: 'resume',
    jobId: active.id,
    total,
    cursor,
    done: cursor >= total,
    matchedCount: Math.max(0, Number(active.matchedCount || 0)),
    unresolvedCount: Math.max(0, Number(active.unresolvedCount || 0)),
    failedCount: Math.max(0, Number(active.failedCount || 0))
  };
}

async function processJob(request) {
  const db = admin.firestore();
  const jobId = clean(request && request.data && request.data.jobId);
  if (!jobId || jobId.includes('/')) throw new HttpsError('invalid-argument', '批次編號不正確。');
  const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) throw new HttpsError('not-found', '找不到 9 系列封面批次。');
  const job = jobSnap.data() || {};
  if (clean(job.ruleVersion) !== COVER_RULE_VERSION) throw new HttpsError('failed-precondition', '批次規則版本不相符。');
  const items = Array.isArray(job.items) ? job.items : [];
  const cursor = Math.max(0, Number(job.cursor || 0));
  const requested = Number(request && request.data && request.data.limit);
  const limit = Math.min(MAX_CHUNK_SIZE, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : DEFAULT_CHUNK_SIZE));
  const batch = items.slice(cursor, cursor + limit);
  const actor = normalizeEmail(request.auth && request.auth.token && request.auth.token.email) || clean(request.auth && request.auth.uid);
  const results = [];
  for (const item of batch) {
    try {
      results.push(await enrichOneProduct(db, item, actor));
    } catch (error) {
      console.error('Nine-series book cover enrichment failed.', { productId: item.productId, sku: item.sku, error: error && error.message });
      results.push({ status: 'failed', productId: item.productId, sku: item.sku, name: item.name, reason: clean(error && error.message) || '未知錯誤' });
    }
  }
  const nextCursor = cursor + batch.length;
  const done = nextCursor >= items.length;
  const increments = results.reduce((counts, row) => {
    if (row.status === 'matched') counts.matched += 1;
    else if (row.status === 'unresolved') counts.unresolved += 1;
    else if (row.status === 'failed') counts.failed += 1;
    return counts;
  }, { matched: 0, unresolved: 0, failed: 0 });
  await jobRef.set({
    cursor: nextCursor,
    status: done ? 'completed' : 'running',
    matchedCount: admin.firestore.FieldValue.increment(increments.matched),
    unresolvedCount: admin.firestore.FieldValue.increment(increments.unresolved),
    failedCount: admin.firestore.FieldValue.increment(increments.failed),
    lastResults: results,
    lastProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: done ? admin.firestore.FieldValue.serverTimestamp() : null
  }, { merge: true });
  const latest = (await jobRef.get()).data() || {};
  return {
    ok: true, action: 'process', jobId, total: items.length, cursor: nextCursor, done,
    matchedCount: Number(latest.matchedCount || 0),
    unresolvedCount: Number(latest.unresolvedCount || 0),
    failedCount: Number(latest.failedCount || 0),
    results
  };
}

function registerBookCoverEnrichment(target) {
  target.runNineSeriesBookCoverBatch = onCall({
    region: REGION,
    timeoutSeconds: 540,
    memory: '1GiB',
    enforceAppCheck: false
  }, async (request) => {
    if (!isAllowedManager(request)) throw new HttpsError('permission-denied', '請先使用管理者帳號登入。');
    const action = clean(request && request.data && request.data.action) || 'start';
    if (action === 'start') return startJob(request);
    if (action === 'resume-or-start') return resumeOrStartJob(request);
    if (action === 'process') return processJob(request);
    throw new HttpsError('invalid-argument', '不支援的批次動作。');
  });
}

module.exports = {
  COVER_RULE_VERSION,
  bookSearchTitle,
  coverDimensionsAreAcceptable,
  discoverTaazeCoverCandidates,
  findBookCoverCandidates,
  findBookCoverCandidate,
  googleCandidate,
  duckDuckGoResultUrls,
  bingResultUrls,
  bingImageCandidates,
  curatedCoverCandidate,
  promoteTrustedCoverImageUrl,
  pageImageRows,
  taazeResultUrls,
  isNineSeriesBook,
  normalizeBookTitle,
  productName,
  productSku,
  registerBookCoverEnrichment,
  titleCoverage,
  titleMatchesRequested,
  titleMatchScore,
  titleQualifierTokens,
  titleSimilarity
};
