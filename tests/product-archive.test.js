const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../operations-phase1.js'),'utf8');
test('archive and restore persist only archive metadata, never stock, prices or platform state',async()=>{
 const writes=[],p={docId:'p',sku:'SKU',name:'Example',internal:{productArchived:false,currentStock:3,momoPrice:880}};
 const state={internalProducts:[p.internal],db:{collection:name=>{assert.equal(name,'products');return {doc:id=>({update:async patch=>writes.push(patch)})};}}};
 const code=source.slice(source.indexOf('  async function toggleProductArchived('),source.indexOf('  function productFormHtml('));
 const toggle=vm.runInNewContext(code+';toggleProductArchived',{state,COLLECTIONS:{products:'products'},catalogById:()=>p,confirmAction:async()=>true,productEditorHasUnsavedChanges:()=>false,serverTimestamp:()=>1,userLabel:()=>'staff',clearProductEditorState:()=>{},mergeCatalog:()=>{},renderKeepingViewport:()=>{},toast:()=>{},writeAudit:async()=>{}});
 await toggle('p');await toggle('p');
 assert.deepEqual(writes.map(x=>x.productArchived),[true,false]);
 for(const patch of writes)assert.deepEqual(Object.keys(patch).sort(),['productArchived','productArchivedAt','productArchivedBy']);
 assert.equal(p.internal.currentStock,3);assert.equal(p.internal.momoPrice,880);
});
test('normal and archived views separate results while retaining search behavior',()=>{
 const rows=[{sku:'A',internal:{productArchived:false}},{sku:'B',internal:{productArchived:true}}];
 const state={productSearch:'',productSeries:'all',productFilter:'all',productSort:'sku'};
 const start=source.indexOf('  function productFiltered(){'),end=source.indexOf('\n  function ',start+10);
 const filter=vm.runInNewContext(source.slice(start,end)+';productFiltered',{state,lower:x=>x,clean:x=>x,hasListingSku:()=>true,catalogRowsInSkuOrder:()=>rows,compareCatalogSku:(a,b)=>a.sku.localeCompare(b.sku),catalogMatchesSearch:(p,s)=>p.sku===s});
 assert.equal(filter()[0].sku,'A');assert.equal(filter().length,1);
 state.productArchivedOnly=true;assert.equal(filter()[0].sku,'B');
 state.productSearch='A';assert.equal(filter().length,0);
});
