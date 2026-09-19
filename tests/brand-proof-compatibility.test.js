'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const creative=require('../functions/listingBrandCreative');
const source=fs.readFileSync('operations-phase1.js','utf8');
const start=source.indexOf('  function productBrandCreativeRenderProofMatches(');
const end=source.indexOf('  async function reserveProductBrandCreativeStyle',start);
const style=creative.assignment(null,'compat-test');
const browser=Function('clean','normalizedProductBrandCreativeStyleAssignment','PRODUCT_BRAND_TEMPLATE_CONTRACT',source.slice(start,end)+';return productBrandCreativeRenderProofMatches;')(
 v=>String(v||'').trim(),v=>v, {creativeStyleSystem:{renderProofVersion:creative.RENDER_PROOF_VERSION,commercialPosterStandardVersion:creative.COMMERCIAL_POSTER_STANDARD_VERSION}});
const verified={fullCommercialPosterStageCompleted:true,commercialPosterQaApproved:true,genericInformationCardFallbackDetected:false,styleControlsWholeComposition:true,productIntegratedAsHero:true,strongCommercialHierarchy:true,threeFeaturesIntegrated:true,exactlyTwoDistinctDetailInsets:true,detailInsetsUseOtherSourceImages:true,detailInsetsMatchFeatureCopy:true,independentAspectRatioReflow:true,headerHeightExactly20Percent:true,logoSafeMarginIntact:true,thinOuterFrameIntact:true,verificationSource:'verified-final-image'};
const base=creative.renderProof(style,'compat-test',verified);
function check(proof,expected){assert.equal(creative.renderProofMatches(proof,style,'compat-test'),expected,'backend');assert.equal(browser(proof,style),expected,'browser');}
test('browser and backend accept existing v3 proofs from both renderers',()=>{for(const borderLayer of ['below-logo','below-brand-header'])check({...base,borderLayer},true);});
const extra={exactOriginalRedSloganVisibleAndReadable:true,originalCircularLogoVisibleAndUnmodified:true,headerAssetPairVerifiedFromFinalPixels:true};
const v4={...base,...extra,version:'youzi-brand-creative-render-v4'};
test('v4 requires all three additional final-image checks',()=>{check(v4,true);for(const key of Object.keys(extra)){check({...v4,[key]:false},false);const missing={...v4};delete missing[key];check(missing,false);}});
test('compatibility does not bypass style, quality, border or version checks',()=>{for(const proof of [base,v4]){for(const patch of [{version:'youzi-brand-creative-render-v5'},{styleId:'wrong'},{commercialPosterQaApproved:false},{borderLayer:'above-logo'},{borderIntersectsLogo:true},{verificationSource:''},{exactlyTwoDistinctDetailInsets:false}])check({...proof,...patch},false);}});
