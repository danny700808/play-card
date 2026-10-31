const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const routes=require('../internal-workspace-routes.js');
test('shared pages keep their employee, approval, and teacher contexts',()=>{
 assert.equal(routes.resolve('/play-card/leave.html',''),'employee');
 assert.equal(routes.resolve('/play-card/leave.html','?mode=approval'),'approval');
 assert.equal(routes.resolve('/task.html','?mode=admin'),'work');
 assert.equal(routes.resolve('/task.html','?mode=admin&source=teacher-hub'),'teachers');
 assert.equal(routes.resolve('/employee-admin.html','?type=external'),'teachers');
 assert.equal(routes.resolve('/salary-admin.html','?type=staff'),'hr');
 assert.equal(routes.resolve('/rental-order.html',''),null);
 assert.equal(routes.resolve('/teacher-course-portal.html',''),null);
});
test('all linked routes exist and every scoped page loads each new asset once',()=>{
 for(const g of Object.values(routes.groups)){
  for(const [,url] of g.links)assert.ok(fs.existsSync(path.join(root,url.split('?')[0])),url);
  for(const page of g.pages){
   const html=fs.readFileSync(path.join(root,page),'utf8');
   for(const asset of ['internal-workspace.css','internal-workspace.js','internal-workspace-routes.js'])assert.equal(html.split(asset).length-1,1,page+' '+asset);
  }
 }
});
function render(user,file,search=''){
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.classList={add:()=>{}};}
  append(...nodes){this.children.push(...nodes);}
  prepend(node){this.children.unshift(node);}
  setAttribute(k,v){this.attrs[k]=v;}
 }
 const body=new Element('body');
 const context={URL,URLSearchParams,location:{pathname:'/play-card/'+file,search,href:'https://example.test/play-card/'+file+search},localStorage:{getItem:()=>JSON.stringify(user)},document:{body,readyState:'complete',querySelector:()=>null,querySelectorAll:()=>[],createElement:tag=>new Element(tag)},InternalWorkspaceRoutes:routes};
 context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'internal-workspace.js'),'utf8'),context);
 return body.children;
}
function links(nodes){return nodes.flatMap(node=>[...(node.href?[node.href]:[]),...links(node.children)]);}
test('ordinary employees do not get management links and teacher sessions are unchanged',()=>{
 const employee=render({id:'worker',identityType:'staff'},'dashboard.html');
 assert.ok(links(employee).includes('clock.html'));
 assert.ok(!links(employee).includes('settings.html'));
 assert.deepEqual(render({id:'worker',identityType:'staff'},'salary-admin.html'),[]);
 assert.deepEqual(render({id:'teacher',identityType:'external',portalSessionBridge:true},'dashboard.html'),[]);
 assert.deepEqual(render(null,'dashboard.html'),[]);
});
test('managers receive group navigation without changing any business forms',()=>{
 const result=render({id:'manager',role:'admin'},'salary-admin.html','?type=staff');
 assert.ok(links(result).includes('settings.html'));
 assert.ok(links(result).includes('leave-policy-admin.html'));
 assert.ok(links(result).includes('salary-admin.html'));
});
