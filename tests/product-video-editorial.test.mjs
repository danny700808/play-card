import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const s=await fs.readFile(new URL('../operations-phase1.js',import.meta.url),'utf8');
const ctx={clean:x=>String(x||'').trim(),lower:x=>String(x||'').toLowerCase(),productMediaKindLabel:x=>x,PRODUCT_VIDEO_BRAND_PROFILE:{version:'test'}};vm.createContext(ctx);
vm.runInContext(s.slice(s.indexOf('  function productVideoYoutubeRawName('),s.indexOf('  function readProductVideoMetadata(')),ctx);
const products=[{name:'KAPAER 小提琴弱音器（銅合金夾式｜4/4・3/4・1/2 通用｜降低音量不改變音色）｜柚子樂器',sku:'2920219',brand:'KAPAER'},{name:'Yamaha F310 木吉他',brand:'Yamaha',model:'F310',sku:'1000129'},{name:'配件'.repeat(120),sku:'9'.repeat(150)},{}];
const examples=products.map(p=>({title:ctx.productVideoYoutubeTitle(p),description:ctx.productVideoYoutubeDescription(p),tags:ctx.productVideoTags(p)}));
for(const e of examples){assert.ok(e.title.length<=100);assert.equal(e.title.split('柚子樂器').length,2);assert.match(e.title,/實體拍攝商品介紹/);assert.doesNotMatch(e.title+e.description,/商品編號|以收到|不改變音色/);assert.ok(e.description.length<=5000);assert.ok(e.tags.length<=12);}
assert.ok(s.includes("youtubeMetadataVersion:'youtube-introduction-v1-20261001',youtubeTitle:"));assert.match(examples[0].description,/#小提琴弱音器/);assert.match(examples[1].description,/#木吉他/);assert.doesNotMatch(examples[1].description,/小提琴/);
const start=s.indexOf('  function productMediaResumePlan('),end=s.indexOf('\n  async function ',start);vm.runInContext(s.slice(start,end),ctx);
const row={physicalImageUrls:['a','b','c','d'],physicalOriginalImageUrls:['oa','ob','oc','od'],physicalImagePlatformResults:{shopee:{status:'completed',sourceImageUrls:['a']}},productVideos:[]};const plan=ctx.productMediaResumePlan(row);assert.equal(plan[1].allPhysicalImageUrls.length,4);assert.equal(plan[1].physicalImageUrls.length,3);
const prompt=ctx.productMediaBatchPrompt([{productId:'test',mediaQueueKinds:[],mediaResumePlan:plan}],'test');for(const text of ['youtube-introduction-v1-20261001','尚未發布的舊紀錄','已發布影片維持原youtubeVideoId','physical-collage-v1-20261001','不新增文字'])assert.ok(prompt.includes(text),text);
const single=s.slice(s.indexOf('  function productListingCodexHandoffPrompt('),s.indexOf('  function productListingCodexActivationPrompt('));assert.ok(single.includes('productVideoYoutubeEditorialPolicy(),'));

console.log('YouTube editorial metadata and physical-photo resume checks passed');
