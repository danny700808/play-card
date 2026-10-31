/* Navigation map only. Existing pages own permissions, reads and mutations. */
(function(){
 'use strict';
 const routes=window.InternalWorkspaceRoutes,host=document.querySelector('[data-management-tree]');
 if(!routes||!host)return;
 const counts={},start=host.getAttribute('data-management-tree')||'root';let previous='';
 function element(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;}
 function hashNode(){const n=routes.treeNode(location.hash.slice(1)||start);return n&&n.children?n:routes.treeNode(start);}
 function localLink(n){return n.children?'#'+n.id:routes.treeLink(n);}
 function nodeLink(n,cls){
  const a=element('a',cls);a.href=localLink(n);a.dataset.nodeId=n.id;
  a.append(element('span','management-node-label',n.label));
  const b=element('span','management-count');b.id=n.badge||'node-count-'+n.id;b.dataset.countNode=n.id;paint(b,counts[b.id]);a.append(b);
  const arrow=element('span','management-node-arrow','›');arrow.setAttribute('aria-hidden','true');a.append(arrow);
  if(n.children)a.setAttribute('aria-label','查看'+n.label);
  return a;
 }
 function common(nodes){
  const details=element('details','management-common');details.append(element('summary','','共用功能'));
  details.append(children(nodes));return details;
 }
 function children(nodes){
  const list=element('ul','management-children');
  [...nodes.filter(n=>!n.children),...nodes.filter(n=>n.children)].forEach(n=>{
   const item=element('li',n.children?'management-row':'management-leaf');
   item.append(nodeLink(n,'management-node '+(n.children?'is-branch':'is-leaf')));
   if(n.children){const body=element('div','management-descendants');body.append(children(n.children));if(n.common?.length)body.append(common(n.common));item.append(body);}
   list.append(item);
  });return list;
 }
 function render(){
  const current=hashNode(),path=routes.treePath(current.id);host.replaceChildren();
  const toolbar=element('div','management-tree-toolbar');toolbar.append(element('h1','management-tree-title','管理樹狀圖'));
  if(path.length>1){const back=element('a','management-up','← 上一層');back.href=localLink(path[path.length-2]);toolbar.append(back);}host.append(toolbar);
  const crumbs=element('nav','management-ancestors');crumbs.setAttribute('aria-label','樹狀位置');
  path.forEach((n,i)=>{if(i){const sep=element('span','management-ancestor-line','›');sep.setAttribute('aria-hidden','true');crumbs.append(sep);}const a=element('a','management-ancestor'+(i===path.length-1?' is-current':''),n.label);a.href=localLink(n);if(i===path.length-1){a.setAttribute('aria-current','page');a.id='managementCurrentNode';a.tabIndex=-1;}crumbs.append(a);});host.append(crumbs);
  const viewport=element('div','management-map-viewport');viewport.tabIndex=0;viewport.setAttribute('aria-label','左右樹狀導覽');
  const map=element('div','management-map'+(current.id==='root'?' is-root':''));
  map.append(nodeLink(current,'management-node management-origin'));
  const descendants=element('div','management-descendants');descendants.append(children(current.children));if(current.common?.length)descendants.append(common(current.common));map.append(descendants);viewport.append(map);host.append(viewport);
  const status=element('div','management-tree-live');status.setAttribute('role','status');status.textContent='目前位置：'+path.map(n=>n.label).join('，');host.append(status);
  document.title=current.id==='root'?'管理樹狀圖':current.label+'｜管理樹狀圖';
  if(previous&&previous!==current.id)document.getElementById('managementCurrentNode')?.focus({preventScroll:true});previous=current.id;
 }
 function paint(b,count){b.textContent=count===null?'?':count?String(count):'';b.setAttribute('aria-label',count===null?'待處理數字未能讀取':count?'待處理 '+count+' 件':'沒有待處理事項');b.title=count===null?'讀取失敗，請重新整理':count?'待處理 '+count+' 件':'';}
 function setCount(id,count){counts[id]=count===null?null:Number(count)||0;const b=document.getElementById(id);if(b)paint(b,counts[id]);}
 window.InternalManagementTree={setCount,setNodeCount(id,count){const node=routes.treeNode(id);if(node)setCount(node.badge||'node-count-'+id,count);}};
 window.addEventListener('hashchange',render);render();
})();
