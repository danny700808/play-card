importScripts('pairing.js','reader.js');
const endpoint='http://127.0.0.1:18765/api/delivery-bridge/';
let busy=false;
async function call(action,body){
  const r=await fetch(endpoint+action,{method:body?'POST':'GET',cache:'no-store',
    headers:{'X-Youzi-Delivery':YOUZI_DELIVERY_TOKEN,...(body?{'Content-Type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw Error('Host unavailable');return r.json();
}
async function scan(job){
  // Always use a new inactive tab, leaving the user's existing work untouched.
  const tab=await chrome.tabs.create({url:'https://admin.easystore.co/channels/shopee/taiwan/orders',active:false});
  const found=new Map();let error='missing',previous='',pages=1;
  const deadline=Date.now()+42000;
  try{
    while(Date.now()<deadline){
      let page;
      try{const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readDeliveryPage,args:[job.orders]});page=result[0]?.result;}
      catch(e){await new Promise(r=>setTimeout(r,500));continue;}
      if(!page||page.error==='loading'){await new Promise(r=>setTimeout(r,500));continue;}
      if(page.error){error=page.error;break;}
      if(previous&&page.signature===previous){await new Promise(r=>setTimeout(r,500));continue;}
      for(const row of page.results)found.set(row.key,row);
      if(found.size===job.orders.length){error='';break;}
      if(!page.next||pages>=6)break;
      previous=page.signature;pages++;
      await chrome.scripting.executeScript({target:{tabId:tab.id},func:nextDeliveryPage});
      await new Promise(r=>setTimeout(r,500));
    }
    if(Date.now()>=deadline)error='timeout';
    return {id:job.id,results:[...found.values()],error};
  }finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
}
async function poll(){
  if(busy)return;busy=true;
  try{const {job}=await call('poll');if(job)await call('result',await scan(job));}
  catch(e){/* No secrets, customer details, or platform pages in logs. */}
  finally{busy=false;}
}
chrome.alarms.create('delivery-poll',{periodInMinutes:0.5});
chrome.alarms.onAlarm.addListener(poll);
chrome.runtime.onStartup.addListener(poll);
chrome.runtime.onInstalled.addListener(poll);
setInterval(poll,5000);
poll();
