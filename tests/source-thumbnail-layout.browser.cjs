const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const path=require('node:path'),root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'operations-phase1.js'),'utf8');
const fn=source.slice(source.indexOf('  function productReferenceImageSelectorHtml('),source.indexOf('  function productGeneratedImageCandidatesHtml('));
const render=vm.runInNewContext(fn+';productReferenceImageSelectorHtml',{normalizeProductResearchSourceUrls:x=>x,PRODUCT_SELECTED_IMAGE_MAX:12,attr:x=>x});
const css=['operations-phase1.css','operations-catalog-layout-a.css'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  const queueState={publishQueueTab:''};
  const queueSource=source.slice(source.indexOf('  function productListingQueueDrawerHtml('),source.indexOf('  function productListingOnlyQueueHtml('));
  const queueRow='<article><img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"><div><b>1020109 古典吉他 YAMAHA CGS104A</b><small>MOMO：尚未完成</small></div><button>交給 Codex</button></article>';
  const queueRender=vm.runInNewContext(queueSource+';productListingQueueDrawerHtml',{state:queueState,productListingQueueRows:()=>[{}],productMediaQueueRows:()=>[{}],productListingOnlyQueueHtml:()=>queueRow,productMediaQueueContentHtml:()=>queueRow});
  for(const width of [360,768]){
   await page.setViewportSize({width,height:900});queueState.publishQueueTab='';
   await page.setContent('<style>'+css+'</style>'+queueRender());
   const choices=await page.locator('.ops-queue-category').all();assert.equal(choices.length,2);
   assert.equal((await choices[0].boundingBox()).y,(await choices[1].boundingBox()).y);
   assert.equal(await page.locator('.ops-queue-compact-item').count(),0);
   queueState.publishQueueTab='media';await page.setContent('<style>'+css+'</style>'+queueRender());
   assert.equal(await page.locator('.ops-queue-expanded').isVisible(),false);
   assert.ok((await page.locator('.ops-queue-compact-item').boundingBox()).height<95);
   await page.locator('.ops-queue-compact-item>summary').click();assert.equal(await page.locator('.ops-queue-expanded').isVisible(),true);
   console.log('PASS queue categories and expand',width);
  }
  for(const width of [360,768,1458])for(const count of [1,9]){
   await page.setViewportSize({width,height:900});
   const urls=Array.from({length:count},(_,i)=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="green"/><text y="40">'+i+'</text></svg>'));
   await page.setContent('<style>'+css+'</style><div class="ops-product-inline-listing"><div class="ops-compact-source"><div id="productReferenceImagePreview">'+render(urls,urls)+'</div></div></div>');
   const result=await page.evaluate(()=>{
    const toolbar=document.querySelector('.ops-listing-source-toolbar').getBoundingClientRect();
    return [...document.querySelectorAll('.ops-listing-source-images article')].map(el=>{const r=el.getBoundingClientRect();return {width:r.width,top:r.top,toolbarBottom:toolbar.bottom,right:r.right,viewport:innerWidth,imgWidth:el.querySelector('img').getBoundingClientRect().width};});
   });
   assert.equal(result.length,count);
   for(const r of result){assert.ok(r.width>=112,JSON.stringify(r));assert.ok(r.imgWidth>=90,JSON.stringify(r));assert.ok(r.top>=r.toolbarBottom);assert.ok(r.right<=r.viewport);}
   console.log('PASS',width,count,'thumbnail width',result[0].width);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
