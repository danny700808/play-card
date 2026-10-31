/* A navigable organization map; no business data or permissions are modified. */
(function(){
 'use strict';
 const routes=window.InternalWorkspaceRoutes;
 const host=document.querySelector('[data-management-tree]');
 if(!routes||!host)return;
 const counts={};
 const start=host.getAttribute('data-management-tree')||'root';
 let previous='';
 function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;return node;}
 function hashNode(){const id=location.hash.slice(1);const node=routes.treeNode(id||start);return node&&node.children?node:routes.treeNode(start);}
 function localLink(node){return node.children?'#'+node.id:routes.treeLink(node);}
 function nodeLink(node,className){
  const a=element('a',className);a.href=localLink(node);
  a.append(element('span','management-node-label',node.label));
  if(node.badge){const badge=element('span','management-count');badge.id=node.badge;const count=counts[node.badge]||0;if(count)badge.textContent=count>99?'99+':String(count);a.append(badge);}
  const arrow=element('span','management-node-arrow',node.children?'＋':'→');arrow.setAttribute('aria-hidden','true');a.append(arrow);
  if(node.children)a.setAttribute('aria-label','展開'+node.label);
  return a;
 }
 function render(){
  const current=hashNode(),path=routes.treePath(current.id);
  host.replaceChildren();
  const toolbar=element('div','management-tree-toolbar');
  const heading=element('h1','management-tree-title','管理樹狀圖');toolbar.append(heading);
  if(path.length>1){const back=element('a','management-up','← 上一層');back.href=localLink(path[path.length-2]);toolbar.append(back);}
  host.append(toolbar);
  const ancestors=element('nav','management-ancestors');ancestors.setAttribute('aria-label','樹狀位置');
  path.forEach((node,index)=>{
   if(index){const line=element('span','management-ancestor-line');line.setAttribute('aria-hidden','true');ancestors.append(line);}
   const a=element('a','management-ancestor'+(index===path.length-1?' is-current':''),node.label);a.href=localLink(node);
   if(index===path.length-1){a.setAttribute('aria-current','page');a.id='managementCurrentNode';a.tabIndex=-1;}
   ancestors.append(a);
  });
  host.append(ancestors);
  const children=element('ul','management-branches');children.style.setProperty('--branches',String(current.children.length));children.setAttribute('aria-label',current.label+'下層');
  current.children.forEach(node=>{const item=element('li','management-branch');item.append(nodeLink(node,'management-node'+(node.children?' is-branch':' is-leaf')));children.append(item);});
  host.append(children);
  if(current.common?.length){
   const details=element('details','management-common');details.append(element('summary','',current.id==='root'?'集中簽核':'共用功能'));
   const list=element('div','management-common-links');current.common.forEach(node=>list.append(nodeLink(node,'management-common-link')));details.append(list);host.append(details);
  }
  const status=element('div','management-tree-live');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.textContent='目前位置：'+path.map(node=>node.label).join('，');host.append(status);
  document.title=current.id==='root'?'管理樹狀圖':current.label+'｜管理樹狀圖';
  if(previous&&previous!==current.id)document.getElementById('managementCurrentNode')?.focus({preventScroll:true});
  previous=current.id;
 }
 window.InternalManagementTree={setCount(id,count){counts[id]=Number(count)||0;}};
 window.addEventListener('hashchange',render);
 render();
})();
