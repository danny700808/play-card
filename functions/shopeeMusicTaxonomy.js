'use strict';

const MUSIC_ROOT_PATH = Object.freeze(['愛好與收藏品', '樂器與樂器配件']);
const MUSIC_FAMILIES = Object.freeze([
  '鍵盤樂器',
  '打擊樂器',
  '管樂器',
  '樂器配件',
  '其他',
  '弦樂器'
]);

const SEGMENT_ALIASES = Object.freeze({
  樂器與配件: '樂器與樂器配件',
  吉他與貝斯: '吉他、貝斯',
  吉他及貝斯: '吉他、貝斯'
});

const GUITAR_BASS_ATTRIBUTE_TEMPLATE = Object.freeze([
  Object.freeze({ label: 'Weight', kind: 'number-unit', research: '查商品本體重量；找不到可靠資料就留待人工確認。' }),
  Object.freeze({
    label: 'Warranty Duration', kind: 'select', manualConfirmation: true,
    options: Object.freeze(['1 Month', '2 Months', '3 Months', '6 Months', '12 Months', '24 Months', '3 Years', '5 Years', 'No Warranty']),
    research: '依柚子樂器實際提供的保固期間，不可用品牌官網保固自行代替。'
  }),
  Object.freeze({
    label: 'Warranty Type', kind: 'select', manualConfirmation: true,
    research: '依柚子樂器實際承擔保固的方式，由管理者確認；不可猜測。'
  }),
  Object.freeze({ label: 'Neck Material', kind: 'select', research: '查品牌官方規格的琴頸材質。' }),
  Object.freeze({
    label: 'Traditional Music Instrument', kind: 'select',
    options: Object.freeze(['No', 'Yes']), research: '一般吉他與貝斯填 No。'
  }),
  Object.freeze({ label: 'Guitar Shape', kind: 'select', research: '依商品外型與原廠系列資料選擇。' }),
  Object.freeze({ label: 'Hand Configuration', kind: 'select', research: '查左手或右手版本。' }),
  Object.freeze({ label: 'Body Material', kind: 'select', research: '查品牌官方規格的琴身材質。' }),
  Object.freeze({ label: 'Guitar Type', kind: 'select', research: '辨識電吉他、木吉他或貝斯。' }),
  Object.freeze({ label: 'Pickup Configuration', kind: 'select', research: '依原廠規格查拾音器配置，例如 HSS、SSS、HH。' }),
  Object.freeze({ label: 'Fretboard Material', kind: 'select', research: '查品牌官方規格的指板材質。' }),
  Object.freeze({ label: 'Dimension (L x W x H)', kind: 'text', research: '只填商品本體尺寸；不可拿包裝尺寸代替。' }),
  Object.freeze({ label: 'Number of Strings', kind: 'select', research: '依商品實際弦數。' }),
  Object.freeze({ label: 'Quantity', kind: 'text', defaultValue: '1', research: '單件販售固定填 1。' }),
  Object.freeze({ label: 'Quantity per Pack', kind: 'select', defaultValue: '1', research: '單件販售固定填 1。' })
]);

const CATEGORY_TEMPLATES = Object.freeze([
  Object.freeze({
    id: 'guitar-bass',
    family: '弦樂器',
    path: Object.freeze([...MUSIC_ROOT_PATH, '弦樂器', '吉他、貝斯']),
    attributes: GUITAR_BASS_ATTRIBUTE_TEMPLATE
  })
]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalized(value) {
  return clean(value).normalize('NFKC').toLowerCase().replace(/[\s、，,。．·•()（）[\]【】]/g, '');
}

function canonicalSegment(value) {
  const segment = clean(value);
  const alias = Object.keys(SEGMENT_ALIASES).find((key) => normalized(key) === normalized(segment));
  return alias ? SEGMENT_ALIASES[alias] : segment;
}

function splitCategoryPath(value) {
  const rows = Array.isArray(value) ? value : clean(value).split(/\s*(?:>|＞|→|\/|｜)\s*/);
  return rows.map(canonicalSegment).filter(Boolean).slice(0, 8);
}

function evidenceText(evidence, path) {
  const row = evidence && typeof evidence === 'object' ? evidence : {};
  return [
    row.title, row.shopeeTitle, row.name, row.researchedProductName,
    row.category, row.model, row.productName,
    ...(Array.isArray(path) ? path : [])
  ].map(clean).filter(Boolean).join(' ');
}

function inferMusicFamilyFromText(text) {
  const compact = normalized(text);
  if (!compact) return '';

  // Accessory nouns take precedence so that a guitar string or keyboard stand
  // is not mistaken for the instrument it is used with.
  if (/(琴弦|吉他弦|貝斯弦|烏克麗麗弦|弦組|撥片|pick|背帶|琴袋|琴盒|琴架|鍵盤架|鼓棒|鼓皮|鼓鎖|調音器|節拍器|移調夾|capo|導線|訊號線|連接線|轉接頭|變壓器|電源供應器|效果器|踏板|簧片|吹嘴|束圈|清潔布|譜架|樂譜袋|譜袋|音樂書包|樂器書包|保養油|弱音器)/i.test(compact)) {
    return '樂器配件';
  }
  if (/(電鋼琴|數位鋼琴|電子琴|鍵盤樂器|keyboard|synthesizer|synth|合成器|鋼琴|手風琴|midi鍵盤|主控鍵盤)/i.test(compact)) return '鍵盤樂器';
  if (/(爵士鼓|電子鼓|木箱鼓|非洲鼓|手鼓|鈴鼓|定音鼓|小鼓|大鼓|軍鼓|銅鈸|鈸|cajon|drum|percussion|打擊樂器|木琴|鐵琴|馬林巴)/i.test(compact)) return '打擊樂器';
  if (/(薩克斯|薩克斯風|saxophone|長笛|短笛|單簧管|豎笛|黑管|雙簧管|巴松管|低音管|小號|長號|法國號|上低音號|低音號|直笛|陶笛|口琴|管樂器|clarinet|flute|trumpet|trombone|recorder|harmonica)/i.test(compact)) return '管樂器';
  if (/(電吉他|木吉他|古典吉他|民謠吉他|吉他|guitar|電貝斯|貝斯|bass|烏克麗麗|ukulele|小提琴|中提琴|大提琴|低音提琴|二胡|古箏|琵琶|弦樂器)/i.test(compact)) return '弦樂器';
  if (/(樂器配件)/i.test(compact)) return '樂器配件';
  if (/(其他)/i.test(compact)) return '其他';
  return '';
}

function inferMusicFamily(evidence, path) {
  // Product facts are authoritative.  A previously stored category path is
  // only fallback evidence, so stale AI output cannot override the product.
  const directFamily = inferMusicFamilyFromText(evidenceText(evidence, []));
  if (directFamily) return directFamily;
  return inferMusicFamilyFromText((Array.isArray(path) ? path : splitCategoryPath(path)).join(' '));
}

function templateForProduct(evidence, pathValue) {
  const path = splitCategoryPath(pathValue);
  const text = evidenceText(evidence, path);
  if (/(電吉他|木吉他|古典吉他|民謠吉他|吉他|guitar|電貝斯|貝斯|bass)/i.test(text)
    && inferMusicFamily(evidence, path) === '弦樂器') {
    return CATEGORY_TEMPLATES[0];
  }
  return null;
}

function normalizeMusicCategoryPath(pathValue, evidence) {
  const raw = splitCategoryPath(pathValue);
  const template = templateForProduct(evidence, raw);
  if (template) return [...template.path];

  const inferredFamily = inferMusicFamily(evidence, raw);
  const existingFamily = raw.find((segment) => MUSIC_FAMILIES.some((family) => normalized(family) === normalized(segment))) || '';
  const family = inferredFamily || existingFamily;
  if (!raw.length && !family) return [];
  const familyChanged = inferredFamily && existingFamily && normalized(inferredFamily) !== normalized(existingFamily);
  const descendants = (familyChanged ? [] : raw).filter((segment) => {
    if (MUSIC_ROOT_PATH.some((root) => normalized(root) === normalized(segment))) return false;
    if (MUSIC_FAMILIES.some((candidate) => normalized(candidate) === normalized(segment))) return false;
    return true;
  });
  const result = [...MUSIC_ROOT_PATH];
  if (family) result.push(family);
  descendants.forEach((segment) => {
    const canonical = canonicalSegment(segment);
    if (canonical && !result.some((current) => normalized(current) === normalized(canonical))) result.push(canonical);
  });
  return result.slice(0, 8);
}

function formatCategoryPath(pathValue, evidence) {
  return normalizeMusicCategoryPath(pathValue, evidence).join(' > ');
}

function templateAttributeRows(evidence, pathValue) {
  const template = templateForProduct(evidence, pathValue);
  return template ? template.attributes.map((row) => ({ ...row, options: row.options ? [...row.options] : [] })) : [];
}

module.exports = {
  MUSIC_ROOT_PATH,
  MUSIC_FAMILIES,
  CATEGORY_TEMPLATES,
  canonicalSegment,
  splitCategoryPath,
  inferMusicFamily,
  templateForProduct,
  normalizeMusicCategoryPath,
  formatCategoryPath,
  templateAttributeRows
};
