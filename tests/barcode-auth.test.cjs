const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('barcode-print.js','utf8');
function setup(){
 const nodes=new Map(),events=[],state={products:[]}; let allow=true,readFails=false;
 const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',focus(){},addEventListener(name,fn){this[name]=fn;}});return nodes.get(id);};
 const context={state,$,COLLECTION:'products',initDb:()=>({collection:()=>({limit:()=>({get:async()=>{events.push('read');if(readFails)throw Error('offline');return {docs:[{name:'Guitar'}]};}})})}),global:{YZManagerAuth:{requireManager:async()=>{events.push('auth');if(!allow)throw Error('login required');}}},normalize:x=>x,esc:x=>x,applySearch:()=>events.push('render')};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function loadProducts(){'),source.indexOf('  async function initApp(){')),context);
 return {context,nodes,events,deny:()=>allow=false,fail:()=>readFails=true};
}
test('restores authentication before reading and rendering products',async()=>{const f=setup();await f.context.loadProducts();assert.deepEqual(f.events,['auth','read','render']);});
test('missing login never reads products and offers return login',async()=>{const f=setup();f.deny();await f.context.loadProducts();assert.deepEqual(f.events,['auth']);assert.match(f.nodes.get('bpProducts').innerHTML,/login.html\?next=barcode-print.html/);});
test('read failure can be retried',async()=>{const f=setup();f.fail();await f.context.loadProducts();assert.equal(typeof f.nodes.get('bpRetry').click,'function');f.nodes.get('bpRetry').click();await new Promise(setImmediate);assert.deepEqual(f.events,['auth','read','auth','read']);});
test('barcode page is an allowed login return and loads auth before app',()=>{const html=fs.readFileSync('barcode-print.html','utf8'),login=fs.readFileSync('login.html','utf8');assert(html.indexOf('src="manager-auth.js')<html.indexOf('src="barcode-print.js'));const list=login.slice(login.indexOf('const loginReturnPages'),login.indexOf('function requestedLoginTarget'));assert.match(list,/'barcode-print.html'/);});
