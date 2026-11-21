const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('password login persists Firebase session before authenticating',async()=>{const s=fs.readFileSync('firebase-client.js','utf8'),code=s.slice(s.indexOf('  async function firebaseLogin('),s.indexOf('  async function firebaseLogin(')+s.slice(s.indexOf('  async function firebaseLogin(')).indexOf('\n  async function ',5));const calls=[],auth={setPersistence:async mode=>calls.push(mode),signInWithCustomToken:async()=>calls.push('login')};const fn=()=>auth;fn.Auth={Persistence:{LOCAL:'local'}};const ctx={global:{firebase:{auth:fn}},lower:x=>x,secureCall:async()=>({ok:true,token:'fixture'}),localStorage:{setItem(){}},clean:x=>x};vm.createContext(ctx);vm.runInContext(code,ctx);await ctx.firebaseLogin({email:'test',password:'fixture'});assert.deepEqual(calls,['local','login']);});
test('manager login delegates the default view to the portal',()=>{const s=fs.readFileSync('app.js','utf8'),code=s.slice(s.indexOf('function loginDestination('),s.indexOf('function redirectAfterLogin('));const ctx={isExternalTeacher:()=>false,hasSettingsZoneAccess:()=>true,setPortalMode(){}};vm.createContext(ctx);vm.runInContext(code,ctx);assert.equal(ctx.loginDestination({}),'portal.html');});

test('portal chooses overview on phones, keeps desktop calendar and honors explicit routes',()=>{
  const source=fs.readFileSync('operations-phase1.js','utf8');
  const start=source.indexOf('  function selectManagerLandingView(');
  const code=source.slice(start,source.indexOf('  async function init()',start));
  for(const [mobile,hash,expected] of [[true,'','#overview'],[false,'','#course-calendar'],[true,'#course-calendar',null],[true,'#overview',null],[true,'#sales',null]]){
    const calls=[];
    const ctx={location:{hash},global:{matchMedia:()=>({matches:mobile}),history:{state:null,replaceState:(_state,_title,url)=>calls.push(url)}}};
    vm.runInNewContext(code+';selectManagerLandingView()',ctx);
    assert.deepEqual(calls,expected?[expected]:[]);
  }
});
