/* Executed only in our own background tab. No cookies, network interception,
   form submission, shipment action, or print action. Read rendered cells. */
function readDeliveryPage(orders) {
  if (location.origin !== 'https://admin.easystore.co' ||
      location.pathname !== '/channels/shopee/taiwan/orders') return {error:'login',results:[]};
  const table = [...document.querySelectorAll('table')].find(t=>
    [...t.querySelectorAll('th')].some(c=>c.innerText.trim()==='物流商'));
  if(!table)return {error:document.querySelector('input[type=password]')?'login':'loading',results:[]};
  const headers=[...table.querySelectorAll('thead th')].map(c=>c.innerText.trim());
  const carrier=headers.indexOf('物流商');
  if(carrier<0)return {error:'layout',results:[]};
  const wanted=new Map(orders.map(o=>[o.externalId,o])),results=[];
  for(const tr of table.querySelectorAll('tbody tr')){
    const cells=[...tr.querySelectorAll('td')];
    const links=[...tr.querySelectorAll('a[href]')];
    const store=links.find(a=>/^\/orders\/\d+$/.test(new URL(a.href).pathname));
    const channel=links.find(a=>/^\/channels\/shopee\/taiwan\/orders\/\d+$/.test(new URL(a.href).pathname));
    if(!store||!channel||!cells[carrier])continue;
    const externalId=new URL(store.href).pathname.split('/').pop(),expected=wanted.get(externalId);
    if(!expected||channel.innerText.trim()!==expected.orderNo)continue;
    const name=cells[carrier].innerText.trim().split(/\r?\n|出貨期限\s*[:：]/)[0].trim();
    if(name&&name.length<=100&& !['-','Shipping Fee','運費'].includes(name))
      results.push({...expected,deliveryMethod:name,evidenceUrl:channel.href});
  }
  const next=document.querySelector('button[aria-label="Go to next page"]');
  return {results,next:!!next&&!next.disabled,
    signature:table.innerText.slice(0,400)};
}
function nextDeliveryPage(){
  if(location.origin!=='https://admin.easystore.co'||location.pathname!=='/channels/shopee/taiwan/orders')return false;
  const b=document.querySelector('button[aria-label="Go to next page"]');
  if(!b||b.disabled)return false;
  b.click();return true;
}
if(typeof module!=='undefined')module.exports={readDeliveryPage,nextDeliveryPage};
