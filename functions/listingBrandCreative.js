'use strict';

const STYLE_CATALOG_VERSION = 'youzi-full-commercial-poster-style-catalog-v2';
const COMMERCIAL_POSTER_STANDARD_VERSION = 'youzi-full-commercial-poster-v2';
const RENDER_PROOF_VERSION = 'youzi-brand-creative-render-v3';

const STYLE_CATALOG = Object.freeze([
  ['bold-coral-impact', '珊瑚撞色', '海報撞色', '#FFF8F1', '#F05A47|#19A974', '大標題＋斜角重點帶'],
  ['light-industrial', '淺鋼工業', '工業', '#F4F1EA', '#5E7C76|#E28B54', '結構線＋大型編號'],
  ['sunrise-racing', '晨光競速', '速度', '#FFF6E7', '#FF8A3D|#3B8C7A', '速度線＋前傾標題'],
  ['bright-warning', '明亮警示', '強調', '#FFF9E8', '#F2B705|#E95C4B', '警示標籤＋大數字'],
  ['daylight-rock', '日光搖滾', '搖滾', '#FAF6ED', '#E45D42|#235347', '粗體字＋撕紙邊'],
  ['pastel-street', '粉彩街頭', '街頭', '#FFF7F4', '#EB6F92|#4C9F91', '貼紙字＋自由格線'],
  ['athletic-white', '運動白場', '運動', '#FFFFFF', '#FF6B35|#168AAD', '號碼牌＋切角資訊'],
  ['orange-impact', '橘色衝擊', '熱力', '#FFF4E8', '#FF7417|#227C6B', '大色帶＋重點圓點'],
  ['comic-bright', '明亮漫畫', '漫畫', '#FFF9EC', '#F46B45|#2A9D8F', '對話框＋放射線'],
  ['oversized-type-light', '亮底巨字', '字體', '#FFFDF8', '#264653|#E76F51', '超大字＋產品穿插'],
  ['pale-wilderness', '淡野蒼涼', '蒼涼', '#F3F0E9', '#7A8B7A|#C98B63', '遠景留白＋細長標題'],
  ['mist-city', '霧城日常', '城市', '#F5F6F4', '#607D8B|#D97855', '霧面照片＋城市標牌'],
  ['sunrise-camp', '朝陽露營', '戶外', '#FFF5DF', '#E98B44|#4E8A68', '日輪＋營地標籤'],
  ['sand-travel', '沙色旅行', '旅行', '#F7F0E3', '#B77B52|#31877A', '郵戳＋路線線條'],
  ['high-key-monochrome', '高調單色', '極簡', '#FBFBF8', '#52796F|#D98C5F', '單色照片＋單一大標'],
  ['matte-sage', '霧鼠尾草', '自然', '#F3F6EF', '#6C8B74|#E48A63', '霧面色塊＋植物弧線'],
  ['winter-daylight', '冬日亮光', '冷冽', '#F6FAFA', '#4C7A88|#E28C67', '冷白留白＋細框'],
  ['light-vintage', '淡彩復古', '復古', '#FFF6E9', '#C86B4A|#4F7D73', '舊紙邊＋復古標籤'],
  ['bright-film', '明亮底片', '底片', '#FFF9ED', '#D65F45|#3C8377', '底片格＋日期戳'],
  ['eastern-negative-space', '東方留白', '東方', '#FCFAF4', '#B95D4B|#4E806D', '直排字＋印章點綴'],
  ['sunshine-lifestyle', '陽光生活', '生活', '#FFFBEF', '#F39C45|#2C917B', '生活照＋圓角文字'],
  ['weekend-travel', '週末出走', '旅行', '#FFF8EA', '#E87850|#438C81', '票券卡＋地圖線'],
  ['urban-commute', '城市通勤', '都會', '#F7F8F6', '#567C86|#ED7B54', '站牌格＋橫向資訊'],
  ['campus-youth', '校園青春', '青春', '#FFFDF2', '#4D9E8B|#F28C5A', '筆記貼＋手寫箭頭'],
  ['warm-family', '暖日家庭', '溫暖', '#FFF5E9', '#D97A55|#5B8D7C', '相框照片＋柔圓標籤'],
  ['natural-organic', '自然有機', '自然', '#F4F7ED', '#5F8F6B|#DB8B5A', '有機曲線＋材質紙'],
  ['handmade-collage', '手作拼貼', '手作', '#FFF8EE', '#E56B55|#3F8C7B', '紙張拼貼＋膠帶'],
  ['outdoor-picnic', '戶外野餐', '樂活', '#FFF9E8', '#F0A34A|#4B947A', '格紋小面積＋圓形資訊'],
  ['cafe-editorial', '咖啡編輯', '編輯', '#FAF5EC', '#9A6B51|#3A806F', '雜誌欄位＋小標籤'],
  ['retro-lifestyle', '復古生活', '復古', '#FFF3E4', '#D46A4C|#4D8477', '弧形標題＋生活物件'],
  ['ivory-copper-premium', '象牙銅質感', '質感', '#FFF9EF', '#B87952|#397A6D', '細銅線＋大留白'],
  ['cream-gold-premium', '奶油金質感', '質感', '#FFF8E8', '#C69B4A|#3E816F', '金色小標＋層次卡片'],
  ['bright-magazine', '明亮雜誌', '雜誌', '#FFFFFF', '#EE7654|#32897A', '封面大標＋邊欄資訊'],
  ['swiss-grid', '瑞士格線', '現代', '#FCFCF8', '#E95F4A|#167C72', '嚴謹格線＋無襯線大字'],
  ['minimal-luxury', '清亮極簡', '極簡', '#FFFCF5', '#2F6F63|#D19A62', '大留白＋精準細線'],
  ['blueprint-light', '淺藍圖紙', '技術', '#F3F8F7', '#3B8090|#E47B59', '技術標線＋規格卡'],
  ['clean-tech', '清爽科技', '科技', '#F7FAF8', '#168A7A|#FF7A59', '透明面板＋模組化圖示'],
  ['product-lab', '明亮實驗室', '專業', '#FAFCFA', '#2D8B77|#E58A55', '標本框＋數據標籤'],
  ['museum-catalog', '博物館目錄', '典藏', '#FBF8F0', '#476D63|#C88055', '典藏編號＋展示台'],
  ['daylight-showcase', '日光展售', '展示', '#FFFDF6', '#E7804F|#2F8875', '展台光影＋大標籤'],
  ['cream-vinyl', '奶油黑膠', '音樂', '#FFF5E6', '#C95F48|#2D7E70', '唱片圓形＋軌道文字'],
  ['daylight-live', '白晝現場', '現場', '#FFF8ED', '#E9674B|#258877', '舞台光束＋演出標牌'],
  ['soundwave-light', '明亮聲波', '音樂', '#F8FBF7', '#218575|#F17855', '聲波線＋節奏切格'],
  ['pastel-synth', '粉彩合成器', '電子', '#FFF7FA', '#8C7BD8|#42A38C', '鍵盤格＋柔亮波形'],
  ['daytime-jazz', '日間爵士', '爵士', '#FFF8E9', '#B56B50|#2D7B72', '弧線節奏＋不對稱留白'],
  ['classical-ivory', '象牙古典', '古典', '#FFFCF3', '#75624F|#4B8572', '細襯線＋樂譜線'],
  ['indie-festival', '清亮獨立祭', '獨立', '#FFF7EB', '#E46852|#348D78', '票根拼貼＋大日期字'],
  ['analog-cream', '奶油類比', '類比', '#FAF2E5', '#A66D50|#3E8273', '旋鈕刻度＋紙張質感'],
  ['instrument-workshop', '樂器工房', '工藝', '#FFF8EC', '#A86E4F|#3D826F', '工法標籤＋局部細節'],
  ['music-storybook', '音樂故事書', '故事', '#FFF9EF', '#E27658|#3E8A78', '章節標題＋插頁構圖']
].map(([id, name, family, background, accents, layout]) => Object.freeze({
  id, name, family, background, accents: accents.split('|'), layout
})));

const STYLE_IDS = Object.freeze(STYLE_CATALOG.map((style) => style.id));

const STYLE_SELECTION_POLICY = Object.freeze({
  version: STYLE_CATALOG_VERSION,
  commercialPosterStandardVersion: COMMERCIAL_POSTER_STANDARD_VERSION,
  catalogSize: STYLE_CATALOG.length,
  selectionMode: 'random-without-replacement',
  resetOnlyAfterAllStylesUsed: true,
  preventImmediateRepeatAcrossCycles: true,
  assignmentScope: 'root-product-group',
  sameStyleAcrossAspectRatios: true,
  sameStyleAcrossVariants: true,
  allowedAspectRatios: Object.freeze(['1:1', '7:10']),
  minimumLightAreaRatio: 0.65,
  maximumDarkAreaRatio: 0.35,
  forbidDarkFullBleedBackground: true,
  fullCommercialPosterStageRequired: true,
  approvedReferenceStandard: 'approved-commercial-poster-pair-2026-09-02',
  styleMustControlWholeComposition: true,
  requiredCreativeStages: Object.freeze([
    'art-direction-and-scene-concept',
    'integrated-product-hero-composition',
    'commercial-headline-typography',
    'three-feature-visual-story',
    'two-distinct-source-detail-insets-mapped-to-feature-copy',
    'locked-20-percent-brand-header-safe-logo-and-border-composite',
    'commercial-poster-visual-qa'
  ]),
  requiredVisualQualities: Object.freeze([
    'designed-commercial-poster-not-information-card',
    'product-integrated-with-scene-or-graphic-system',
    'strong-first-glance-hierarchy',
    'style-specific-typography-texture-and-accents',
    'three-features-integrated-into-one-poster-composition',
    'two-detail-insets-from-distinct-non-main-sources',
    'detail-insets-visually-match-their-feature-copy',
    'independent-layout-reflow-for-each-output-ratio'
  ]),
  forbiddenFallbacks: Object.freeze([
    'generic-three-box-layout',
    'flat-information-card',
    'plain-canvas-with-labels',
    'style-name-or-color-swap-only',
    'reused-identical-layout-across-style-ids'
  ])
});

function styleById(value) {
  const id = String(value == null ? '' : value).trim();
  return STYLE_CATALOG.find((style) => style.id === id) || null;
}

function deterministicStyle(seed) {
  const value = String(seed == null ? '' : seed);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return STYLE_CATALOG[Math.abs(hash >>> 0) % STYLE_CATALOG.length];
}

function assignment(existing, seed) {
  const source = existing && typeof existing === 'object' ? existing : {};
  const style = styleById(source.styleId) || deterministicStyle(seed);
  return {
    catalogVersion: STYLE_CATALOG_VERSION,
    styleId: style.id,
    styleName: style.name,
    family: style.family,
    background: style.background,
    accents: [...style.accents],
    layout: style.layout,
    selectionMode: styleById(source.styleId) ? 'persisted-random-without-replacement' : 'deterministic-fallback',
    sameStyleAcrossAspectRatios: true,
    sameStyleAcrossVariants: true
  };
}

function renderProof(existing, seed, verification) {
  const style = assignment(existing, seed);
  const checked = verification && typeof verification === 'object' ? verification : {};
  return {
    version: RENDER_PROOF_VERSION,
    styleCatalogVersion: STYLE_CATALOG_VERSION,
    styleId: style.styleId,
    styleName: style.styleName,
    family: style.family,
    background: style.background,
    accents: [...style.accents],
    layout: style.layout,
    commercialPosterStandardVersion: COMMERCIAL_POSTER_STANDARD_VERSION,
    fullCommercialPosterStageCompleted: checked.fullCommercialPosterStageCompleted === true,
    commercialPosterQaApproved: checked.commercialPosterQaApproved === true,
    genericInformationCardFallbackDetected: checked.genericInformationCardFallbackDetected === true,
    styleControlsWholeComposition: checked.styleControlsWholeComposition === true,
    productIntegratedAsHero: checked.productIntegratedAsHero === true,
    strongCommercialHierarchy: checked.strongCommercialHierarchy === true,
    threeFeaturesIntegrated: checked.threeFeaturesIntegrated === true,
    exactlyTwoDistinctDetailInsets: checked.exactlyTwoDistinctDetailInsets === true,
    detailInsetsUseOtherSourceImages: checked.detailInsetsUseOtherSourceImages === true,
    detailInsetsMatchFeatureCopy: checked.detailInsetsMatchFeatureCopy === true,
    independentAspectRatioReflow: checked.independentAspectRatioReflow === true,
    headerHeightExactly20Percent: checked.headerHeightExactly20Percent === true,
    logoSafeMarginIntact: checked.logoSafeMarginIntact === true,
    thinOuterFrameIntact: checked.thinOuterFrameIntact === true,
    verificationSource: String(checked.verificationSource || '').trim(),
    styleApplied: checked.styleControlsWholeComposition === true,
    sameStyleAcrossAspectRatios: true,
    sameStyleAcrossVariants: true,
    logoLayer: 'topmost',
    borderLayer: 'below-logo',
    borderIntersectsLogo: false
  };
}

function renderProofMatches(value, expected, seed) {
  const proof = value && typeof value === 'object' ? value : {};
  const style = assignment(expected, seed);
  return proof.version === RENDER_PROOF_VERSION
    && proof.styleCatalogVersion === STYLE_CATALOG_VERSION
    && proof.styleId === style.styleId
    && proof.styleName === style.styleName
    && proof.family === style.family
    && String(proof.background || '').toUpperCase() === style.background.toUpperCase()
    && Array.isArray(proof.accents)
    && proof.accents.length === style.accents.length
    && proof.accents.every((accent, index) => String(accent || '').toUpperCase() === style.accents[index].toUpperCase())
    && proof.layout === style.layout
    && proof.commercialPosterStandardVersion === COMMERCIAL_POSTER_STANDARD_VERSION
    && proof.fullCommercialPosterStageCompleted === true
    && proof.commercialPosterQaApproved === true
    && proof.genericInformationCardFallbackDetected === false
    && proof.styleControlsWholeComposition === true
    && proof.productIntegratedAsHero === true
    && proof.strongCommercialHierarchy === true
    && proof.threeFeaturesIntegrated === true
    && proof.exactlyTwoDistinctDetailInsets === true
    && proof.detailInsetsUseOtherSourceImages === true
    && proof.detailInsetsMatchFeatureCopy === true
    && proof.independentAspectRatioReflow === true
    && proof.headerHeightExactly20Percent === true
    && proof.logoSafeMarginIntact === true
    && proof.thinOuterFrameIntact === true
    && Boolean(String(proof.verificationSource || '').trim())
    && proof.styleApplied === true
    && proof.sameStyleAcrossAspectRatios === true
    && proof.sameStyleAcrossVariants === true
    && proof.logoLayer === 'topmost'
    && proof.borderLayer === 'below-logo'
    && proof.borderIntersectsLogo === false;
}

module.exports = {
  STYLE_CATALOG_VERSION,
  COMMERCIAL_POSTER_STANDARD_VERSION,
  RENDER_PROOF_VERSION,
  STYLE_CATALOG,
  STYLE_IDS,
  STYLE_SELECTION_POLICY,
  styleById,
  deterministicStyle,
  assignment,
  renderProof,
  renderProofMatches
};
