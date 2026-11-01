const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('unified-login.js','utf8');
test('employee entry binds existing identity by email, preserves teacher routing and reuses employee binding',async()=>{
 for(const [target,choices,expected] of [['dashboard.html',[{id:'teacher'}],'email'],['dashboard.html',[{id:'renter'}],'email'],['dashboard.html',[{id:'teacher'},{id:'employee'}],'employee'],['',[{id:'teacher'}],'teacher']]){
  const nodes=new Map();let selected='';const node=id=>{if(!nodes.has(id))nodes.set(id,{addEventListener(){}});return nodes.get(id);};
  const c={key:"test-key",URLSearchParams,global:{location:{search:'?unifiedTicket=t',pathname:'/login.html',hash:''},history:{replaceState(){}},requestedLoginTarget:()=>target},document:{querySelector:()=>node('line')},node,sessionStorage:{setItem(){}},ticket:'',resumeSession:async()=>false,storedProof:()=> 'proof',call:async()=>({choices}),choose:async id=>{selected=id;},showEmail:()=>{selected='email';},message(){},clearTicket(){},submitEmail(){}};
  vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  async function init(){'),source.indexOf('  global.YouziUnifiedLogin=')),c);await c.init();assert.equal(selected,expected);
 }
});
