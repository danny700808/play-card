const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const api=require('../product-blog-editorial');
const source=fs.readFileSync(require('node:path').join(__dirname,'../operations-phase1.js'),'utf8');
test('snapshot isolates selected product and excludes internal commercial data',()=>{
 const p=api.snapshot({docId:'one',sku:'15801-02',originalName:'大阮',latestPurchaseCost:100,internal:{note:'private',brand:'品牌'},imageUrls:['javascript:alert(1)','https://example.com/a.jpg','https://example.com/a.jpg']});
 assert.equal(p.id,'one');assert.equal(p.brand,'品牌');assert.deepEqual(p.images,['https://example.com/a.jpg']);assert.ok(!JSON.stringify(p).includes('private'));assert.ok(!('latestPurchaseCost' in p));assert.throws(()=>api.snapshot({}));
});
test('brief preserves model identity and includes truthful publication requirements',()=>{
 const b=api.brief(api.snapshot({docId:'two',name:'M-VAVE FM-1'}),'聲音實驗室','比較新手用途');
 for(const value of ['M-VAVE FM-1','聲音實驗室','details','SEO','不杜撰','不授權更動商品售價','發布失敗不可宣稱成功'])assert.ok(b.includes(value),value);
 assert.ok(!b.includes('LL6'));assert.equal(api.url('javascript:alert(1)'),'');
});
function harness(options={}){
 const fields={'#opsBlogStyle':{value:api.styles[0]},'#opsBlogNotes':{value:''},'#opsBlogPrompt':{},'#opsBlogFallback':{},'#opsBlogStatus':{}};
 const panel={dataset:{id:'one'},isConnected:true},calls=[];
 const context={byId:()=>panel,catalogById:()=>({docId:'one',name:'Test'}),query:s=>fields[s],global:{YouziProductBlog:api,location:{}},requireEasyStoreManagerAuth:async()=>{calls.push('auth');if(options.authFail)throw Error('auth');},state:{db:{collection:name=>{calls.push(name);return{doc:id=>({set:async data=>{calls.push(id);if(options.saveFail)throw Error('save');calls.push(data);}})}}}},COLLECTIONS:{settings:'opsSettings'},serverTimestamp:()=>123,errorMessage:e=>e.message,encodeURIComponent};
 const start=vm.runInNewContext(source.slice(source.indexOf('  async function startProductBlog('),source.indexOf('  function productFormHtml('))+'\nstartProductBlog',context);
 return {start,context,fields,calls,button:{dataset:{id:'one'},disabled:false}};
}
test('successful handoff saves only an editorial request before opening Codex',async()=>{
 const h=harness();await h.start(h.button);
 assert.equal(h.calls[0],'auth');assert.equal(h.calls[1],'opsSettings');assert.equal(h.calls[3].status,'awaiting-codex');assert.match(h.context.global.location.href,/^codex:\/\/threads\//);assert.match(h.fields['#opsBlogStatus'].textContent,/尚未發布/);assert.equal(h.button.disabled,false);
});
test('auth and storage failure never open Codex or report success',async()=>{
 for(const o of [{authFail:true},{saveFail:true}]){const h=harness(o);await h.start(h.button);assert.equal(h.context.global.location.href,undefined);assert.match(h.fields['#opsBlogStatus'].textContent,/尚未送出/);assert.equal(h.button.disabled,false);}
});
test('busy button cannot create duplicate requests',async()=>{const h=harness();h.button.disabled=true;await h.start(h.button);assert.equal(h.calls.length,0);});
test('entry is a non-submit button beside editor title, with template loaded first',()=>{
 assert.match(source,/<h3>'\+escapeHtml\(title\)\+'<\/h3>'\+\(p\?'<button[^>]+type="button"[^>]+data-action="product-blog-open"/);
 for(const name of ['portal.html','operations-hub.html']){const html=fs.readFileSync(require('node:path').join(__dirname,'../',name),'utf8');assert.ok(html.indexOf('product-blog-editorial.js')<html.indexOf('operations-phase1.js'));}
});
