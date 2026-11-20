/* Read rendered MOMO order cells only. No shipment, print, API or cookie access. */
function readMomoPage(orders) {
  if (location.origin !== 'https://3p.momo.com.tw' ||
      !['/','/order/all','/FrameServlet.do'].includes(location.pathname)) return {error:'login',results:[]};
  const products=[...document.querySelectorAll('.product__right')];
  if(!products.length)return {error:document.querySelector('input[type=password]')?'login':'loading',results:[]};
  const observed=new Map();
  for(const product of products){
    const text=product.innerText;
    const seq=text.match(/子訂單編號\s*[:：]\s*(\d{1,6})\b/);
    const deadlines=[...text.matchAll(/最晚出貨(?:時間|日期|日)\s*[:：]\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/g)];
    if(!seq||deadlines.length!==1)continue;
    let parent=product.parentElement,number='';
    for(let depth=0;parent&&depth<10;depth++,parent=parent.parentElement){
      const ids=[...parent.innerText.matchAll(/(?:^|\n)訂單編號\s*[:：]\s*(\d{14,15})\b/g)];
      if(ids.length>1)break;
      if(ids.length===1){number=ids[0][1];break;}
    }
    if(!number)continue;
    const key=number+':'+seq[1],date=deadlines[0][1].trim();
    if(observed.has(key)&&observed.get(key)!==date)observed.set(key,null);
    else if(!observed.has(key))observed.set(key,date);
  }
  const results=[];
  for(const order of orders){
    const seqs=order.orderSeqs||order.key.split(':')[2]?.split(',')||[];
    if(!seqs.length)continue;
    const dates=seqs.map(seq=>observed.get(order.orderNo+':'+seq));
    if(dates.some(x=>!x)||new Set(dates).size!==1)continue;
    results.push({...order,shippingDeadlineText:dates[0],evidenceUrl:'https://3p.momo.com.tw/order/all'});
  }
  const next=document.querySelector('button[aria-label="next page"]');
  return {results,next:!!next&&!next.disabled,signature:[...observed].map(([k,v])=>k+'='+v).join('|')};
}
function selectMomoAll(){
  if(location.origin==='https://3p.momo.com.tw' && (location.pathname==='/LoginServlet.do'||document.querySelector('input[type=password]')))return 'login';
  if(location.origin!=='https://3p.momo.com.tw')return false;
  const tab=[...document.querySelectorAll('[role=tab]')].find(t=>/^全部(?:\(|$)/.test(t.innerText.trim()));
  if(tab){
    if(tab.getAttribute('aria-selected')==='true')return true;
    tab.click();return false;
  }
  // A direct /order/all URL redirects to the legacy shell. Use the official
  // visible menus to reach E001; never invoke internal application handlers.
  const controls=[...document.querySelectorAll('button,[role=button],a')].filter(e=>e.getClientRects().length);
  const entry=controls.find(e=>e.innerText.trim()==='E001訂單管理');
  if(entry){entry.click();return false;}
  for(const label of ['訂單管理','訂單']){
    const menu=controls.find(e=>e.innerText.trim()===label&&e.getAttribute('aria-expanded')!=='true');
    if(menu){menu.click();break;}
  }
  return false;
}
function nextMomoPage(){
  if(location.origin!=='https://3p.momo.com.tw')return false;
  const button=document.querySelector('button[aria-label="next page"]');
  if(!button||button.disabled)return false;
  button.click();return true;
}
if(typeof module!=='undefined')module.exports={readMomoPage,selectMomoAll,nextMomoPage};
