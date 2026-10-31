const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
test('personnel waits for authentication and exposes failures with retry',async()=>{
 const html=read('employee-admin.html');
 const source=html.slice(html.indexOf('    async function init(){'),html.indexOf('    async function loadEmployees(){'));
 const calls=[]; const box={appendChild(node){this.retry=node;}};
 let resolve;
 const c={requireLogin:()=>({id:'manager'}),hasSettingsZoneAccess:()=>true,ensureHrSession:()=>new Promise(r=>resolve=r),loadVisibilitySettings:async()=>calls.push('visibility'),loadEmployees:async()=>calls.push('employees'),showLayer:()=>{},location:{search:''},URLSearchParams,$:()=>box,document:{createElement:()=>({})}};
 vm.createContext(c);vm.runInContext(source,c);
 const pending=c.init();await Promise.resolve();assert.deepEqual(calls,[]);resolve();await pending;assert.deepEqual(calls,['visibility','employees']);
 c.ensureHrSession=async()=>{throw Error('session error');};calls.length=0;await c.init();assert.deepEqual(calls,[]);assert.match(box.textContent,/session error/);assert.equal(typeof box.retry.onclick,'function');
});
test('policy read failure cannot initialize or save an empty replacement',()=>{
 const html=read('leave-policy-admin.html');
 assert.doesNotMatch(html,/initLeavePolicySettings|loadBundle\(true\)/);
 assert.match(html,/if\(!Object.keys\(currentBundle\).length\) throw/);
});
test('all changed page scripts parse',()=>{
 for(const name of ['employee-admin.html','salary-admin.html','leave-policy-admin.html','hr-payroll-settings-hub.html','data-center.html']){
  for(const m of read(name).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1],{filename:name});
 }
});

test('policy storage errors propagate rather than return defaults',async()=>{
 const source=read('firebase-client.js');
 const start=source.indexOf('  async function getLeavePolicySettingsFirebase(payload){');
 const end=source.indexOf('  async function saveLeavePolicySettingsFirebase(payload){',start);
 let writes=0;
 const c={docGet:async()=>{throw Error('offline');},docSet:async()=>writes++,defaultLeavePolicyBundleV2:()=>({}),normalizeLeavePolicyBundleV2:x=>x};
 vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 await assert.rejects(c.getLeavePolicySettingsFirebase({}),/offline/);
 await assert.rejects(c.initLeavePolicySettingsFirebase({}),/offline/);
 assert.equal(writes,0);
});
