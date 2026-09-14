(function(global){
'use strict';
function request(url,blob,range,progress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',url);xhr.timeout=120000;xhr.setRequestHeader('Content-Range',range);xhr.upload.onprogress=e=>{if(progress&&e.lengthComputable)progress(e.loaded);};xhr.onerror=()=>reject(Error('影片連線中斷，請按儲存重試。'));xhr.ontimeout=()=>reject(Error('影片上傳逾時，請按儲存重試。'));xhr.onload=()=>resolve({status:xhr.status,range:xhr.getResponseHeader('Range')||''});xhr.send(blob);});}
function offset(response,total){if(response.status===200||response.status===201)return total;if(response.status!==308)throw Error('影片上傳失敗（'+response.status+'），請重新選擇影片。');if(!response.range)return 0;const match=/bytes=0-(\d+)/.exec(response.range);if(!match)throw Error('無法確認影片上傳位置。');return Number(match[1])+1;}
async function upload(file,url,onProgress){
 const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='storage.googleapis.com')throw Error('影片上傳位置不正確。');
 let sent=offset(await request(url,null,'bytes */'+file.size),file.size),failures=0;const chunk=8*1024*1024;
 while(sent<file.size){const start=sent,end=Math.min(file.size,start+chunk);try{const response=await request(url,file.slice(start,end),'bytes '+start+'-'+(end-1)+'/'+file.size,loaded=>onProgress(Math.min(99,Math.floor((start+loaded)/file.size*100))));const next=offset(response,file.size);if(next<=sent||next>file.size)throw Error('無法確認影片進度，請按儲存重試。');sent=next;failures=0;}catch(error){if(++failures>=3)throw error;sent=offset(await request(url,null,'bytes */'+file.size),file.size);}onProgress(Math.floor(sent/file.size*100));}
}
global.YZVideoUpload={upload};
})(window);
