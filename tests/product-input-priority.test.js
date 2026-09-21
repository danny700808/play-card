const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('operations-phase1.js','utf8');
function code(name){const start=source.indexOf('  function '+name+'(');assert.ok(start>=0);const end=source.indexOf('\n  function ',start+1);return source.slice(start,end);}
function inputHarness(){
  let now=0,id=0;const timers=new Map(),frames=new Map(),rendered=[];
  const input={value:''};const ctx={state:{},PRODUCT_PAGE_SIZE:24,LIVE_SEARCH_INPUT_IDLE_MS:240,liveSearchJobs:{},document:{activeElement:null},byId:()=>input,closeProductEditorForListChange:()=>true,renderLiveSearchResults:()=>{rendered.push(input.value);return true;},rerenderKeepingFocus:()=>assert.fail('full render'),global:{setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:i=>timers.delete(i),requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:i=>frames.delete(i)}};
  vm.createContext(ctx);vm.runInContext(['cancelLiveSearchRender','scheduleLiveSearchRender','searchInputSelection','nextSearchKeyValue','applySearchKeyInput'].map(code).join('\n'),ctx);
  function advance(ms){now+=ms;for(const [i,t] of [...timers])if(t.at<=now){timers.delete(i);t.fn();}}
  function paint(){for(const [i,fn] of [...frames]){frames.delete(i);fn();}}
  return {ctx,input,timers,frames,rendered,advance,paint,key:k=>ctx.applySearchKeyInput('productSearch',k)};
}
test('six-digit SKU updates immediately; 300ms taps do not trigger intermediate searches',()=>{
  const h=inputHarness();let expected='';for(const k of '120111'){h.key(k);expected+=k;assert.equal(h.input.value,expected);assert.equal(h.ctx.state.productSearch,expected);h.advance(300);h.paint();h.paint();assert.equal(h.rendered.length,0);}
  h.advance(200);h.paint();assert.equal(h.rendered.length,0);h.paint();assert.deepEqual(h.rendered,['120111']);
});
test('delete and clear replace pending work; stale frame cannot restore old results',()=>{
  const h=inputHarness();h.key('1');h.advance(500);h.paint();const stale=[...h.frames.values()][0];h.key('back');assert.equal(h.input.value,'');h.key('2');stale();assert.equal(h.rendered.length,0);h.key('clear');assert.equal(h.input.value,'');h.advance(500);h.paint();h.paint();assert.deepEqual(h.rendered,['']);
});
test('Enter bypasses the pause while POS keeps its existing 240ms delay',()=>{
  const h=inputHarness();h.input.value='12';h.ctx.scheduleLiveSearchRender('productSearch','12',true);assert.equal(h.timers.size,0);h.paint();h.paint();assert.deepEqual(h.rendered,['12']);h.ctx.scheduleLiveSearchRender('posSearch','12',false);h.advance(239);assert.equal(h.frames.size,0);h.advance(1);assert.equal(h.frames.size,1);
});
test('recent-listing search checks platform status only for matching SKUs across 6000 products',()=>{
  const rows=Array.from({length:6000},(_,i)=>({sku:String(100000+i),currentStock:1,internal:{}}));let checked=0,compared=0;
  const ctx={state:{productSearch:'105999',productSeries:'all',productFilter:'all',productRecentOnly:true},lower:s=>String(s).toLowerCase(),clean:s=>String(s),catalogRowsInSkuOrder:()=>rows,hasListingSku:()=>true,catalogMatchesSearch:(p,s)=>p.sku.includes(s),productAppearsInRecentListing:()=>{checked++;return true;},productCreatedTime:()=>0,compareCatalogSku:(a,b)=>{compared++;return a.sku.localeCompare(b.sku);}};
  vm.createContext(ctx);vm.runInContext(code('productFiltered'),ctx);assert.equal(ctx.productFiltered()[0].sku,'105999');assert.equal(checked,1);
  ctx.state.productRecentOnly=false;ctx.state.productSearch='';ctx.state.productSort='sku';assert.deepEqual(Array.from(ctx.productFiltered(),p=>p.sku),rows.map(p=>p.sku));assert.equal(compared,0,'cached SKU order must not be sorted again');
});
