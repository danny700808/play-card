'use strict';
const crypto=require('node:crypto');
const MAX_BYTES=5*1024*1024;
function parseAsset(data){
  const path=String(data.path||'');
  if(!/^[A-Za-z0-9_./-]{1,240}$/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('附件路徑不正確。');
  const match=/^data:(image\/(?:jpeg|png|webp)|application\/pdf|text\/html)(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/.exec(String(data.dataUrl||''));
  if(!match||match[2].length>Math.ceil(MAX_BYTES*4/3)+4)throw new Error('附件格式不支援或超過 5 MB。');
  const buffer=Buffer.from(match[2],'base64');
  if(!buffer.length||buffer.length>MAX_BYTES)throw new Error('附件大小不正確。');
  return {path,buffer,contentType:match[1]};
}
function createPrivateContractAssets({bucket,authorize,baseUrl}){
  async function upload(kind,data){
    await authorize(kind,data.id,data.token);
    const asset=parseAsset(data),id=String(data.id||'').replace(/[^a-zA-Z0-9_-]/g,'_');
    const prefix=(kind==='rental'?'rental-contracts/':'external-teachers/')+id+'/';
    if(!asset.path.startsWith(prefix))throw new Error('附件不屬於這份契約。');
    // Immutable random names prevent one upload from replacing an already signed file.
    const extension={ 'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/pdf':'.pdf','text/html':'.html'}[asset.contentType];
    const path=prefix+'private/'+crypto.randomBytes(20).toString('hex')+extension;
    await bucket.file(path).save(asset.buffer,{resumable:false,metadata:{contentType:asset.contentType,cacheControl:'private, no-store'}});
    const url=new URL(baseUrl);url.search=new URLSearchParams({kind,id:String(data.id),path,token:String(data.token)}).toString();
    return {ok:true,url:url.href,path};
  }
  async function download(data){
    const kind=String(data.kind),id=String(data.id||'');
    if(!['rental','teacher'].includes(kind))throw new Error('附件類型不正確。');
    await authorize(kind,id,data.token);
    const prefix=(kind==='rental'?'rental-contracts/':'external-teachers/')+id.replace(/[^a-zA-Z0-9_-]/g,'_')+'/private/';
    const path=String(data.path||'');
    if(!path.startsWith(prefix)||!/^[-A-Za-z0-9_./]+$/.test(path)||path.includes('..'))throw new Error('附件不屬於這份契約。');
    const file=bucket.file(path),[metadata]=await file.getMetadata();
    if(Number(metadata.size)>MAX_BYTES)throw new Error('附件大小不正確。');
    const [buffer]=await file.download();return {buffer,contentType:metadata.contentType||'application/octet-stream'};
  }
  return {upload,download};
}
function validateAssetUrl(value,{kind,id,token,previous=[],projectId=process.env.GCLOUD_PROJECT||'youzi-c1b74'}){
  const text=String(value||'');let url;try{url=new URL(text);}catch(_){throw Error('附件網址不正確。');}
  if(url.protocol!=='https:'||url.username||url.password)throw Error('附件網址不正確。');
  if(previous.includes(text))return text;
  const prefix=(kind==='rental'?'rental-contracts/':'external-teachers/')+String(id).replace(/[^a-zA-Z0-9_-]/g,'_')+'/';
  if(url.origin==='https://us-central1-'+projectId+'.cloudfunctions.net'&&url.pathname==='/privateContractAssetHttp'&&url.searchParams.get('kind')===kind&&url.searchParams.get('id')===String(id)&&url.searchParams.get('token')===String(token)){
    const path=url.searchParams.get('path')||'';
    if(path.startsWith(prefix+'private/')&&!path.includes('..'))return text;
  }
  // Old pages can finish an upload during the staged deployment.
  const match=/^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
  if(url.hostname==='firebasestorage.googleapis.com'&&match&&[projectId+'.appspot.com',projectId+'.firebasestorage.app'].includes(match[1])){
    const path=decodeURIComponent(match[2]);if(path.startsWith(prefix)&&!path.includes('..'))return text;
  }
  throw Error('附件不屬於這份契約，請重新上傳。');
}
module.exports={createPrivateContractAssets,parseAsset,validateAssetUrl};
