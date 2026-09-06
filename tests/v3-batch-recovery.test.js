const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../operations-phase1.js'),'utf8');
test('platform login blockers are isolated and complete brand previews are required',()=>{
 assert.ok(source.includes('requireAllPlatformSessionsOperableBeforeBatchStart:false'));
 assert.ok(source.includes('platformSessionBlockersAreIsolated:true'));
 assert.ok(!source.includes('已選通路未通過前不得開始第一件商品'));
 assert.ok(source.includes('每件完成圖片後，清楚顯示本件官網'));
 assert.ok(source.includes('Warranty Duration=6 Months、Warranty Type=Supplier Warranty'));
});
test('recovery keeps frozen v3 input and refuses a missing snapshot on an existing job',async()=>{
 let raw={codexHandoff:{preflightSnapshot:{workflowVersion:'v3',productId:'one',snapshotId:'frozen'}}};let created=0;
 const ctx={clean:x=>x,catalogById:()=>({docId:'one'}),COLLECTIONS:{listingCases:'cases'},PRODUCT_LISTING_WORKFLOW_VERSION:'v3',loadProductListingCodexHandoffSnapshot:async()=>{created++;throw Error('must not rebuild');},state:{db:{collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>raw})})})}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  async function prepareSavedV3Handoff('),source.indexOf('  async function resumeSavedV3Listing(')),ctx);
 const r=await ctx.prepareSavedV3Handoff('one');assert.equal(r.snapshot.snapshotId,'frozen');assert.equal(created,0);
 raw={publishState:{jobId:'existing'}};await assert.rejects(ctx.prepareSavedV3Handoff('one'),/禁止另建/);assert.equal(created,0);
 raw={codexHandoff:{preflightSnapshot:{workflowVersion:'v1',productId:'one'}}};await assert.rejects(ctx.prepareSavedV3Handoff('one'),/停止覆蓋/);
});
test('batch freezes before dispatch without claiming that platform processing has started',()=>{
 const start=source.slice(source.indexOf('  async function startProductListingQueue('),source.indexOf('  function renderProducts('));assert.ok(start.indexOf('await prepareSavedV3Handoff')<start.indexOf('await batch.commit()'));assert.ok(start.includes("batchHandoffStatus:'awaiting-codex'"));assert.ok(!start.includes("batchQueueStatus:'processing'"));
});
