'use strict';
const crypto=require('node:crypto');
function urls(row){return [...new Set((Array.isArray(row.lineImageUrls)?row.lineImageUrls:[row.lineImageUrl]).filter(url=>typeof url==='string'&&/^https:\/\//i.test(url)))];}
function escape(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function emailImages(row){return urls(row).map((url,i)=>`<p><a href="${escape(url)}">照片 ${i+1}</a><br><img src="${escape(url)}" alt="照片 ${i+1}" style="max-width:100%;height:auto"></p>`).join('');}
function emailText(row){return urls(row).map((url,i)=>`照片 ${i+1}：${url}`).join('\n');}
function retryKey(queueId,index){const hex=crypto.createHash('sha256').update(queueId+':announcement-images:'+index).digest('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
async function send({row,to,token,text,fetchImpl=fetch,checkpoint=async()=>{}}){
  if(!row.queueId)throw Error('缺少通知編號，無法分批發送圖片。');
  const messages=[{type:'text',text},...urls(row).map(url=>({type:'image',originalContentUrl:url,previewImageUrl:url}))];
  const batches=[];for(let i=0;i<messages.length;i+=5)batches.push(messages.slice(i,i+5));
  const done=Number.isInteger(row.announcementImageBatchesSent)?row.announcementImageBatchesSent:0;
  for(let i=done;i<batches.length;i++){
    const response=await fetchImpl('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'X-Line-Retry-Key':retryKey(row.queueId,i)},body:JSON.stringify({to,messages:batches[i]})});
    const responseText=await response.text();
    // LINE returns 409 plus this header when a prior attempt was already accepted.
    if(!response.ok&&!(response.status===409&&response.headers.get('x-line-accepted-request-id'))){const error=Error(`LINE API ${response.status}：${responseText.slice(0,500)}`);error.lineRejected=true;throw error;}
    await checkpoint(i+1);
  }
  return {provider:'line-messaging-api',responseStatus:200,responseText:`已完成 ${batches.length} 批通知`};
}
module.exports={urls,emailImages,emailText,retryKey,send};
