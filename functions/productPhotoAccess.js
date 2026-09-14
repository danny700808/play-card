'use strict';
const crypto=require('node:crypto');
const clean=v=>String(v==null?'':v).trim();
function createProductPhotoAccess({db,FieldValue,bucket,authorize,decodeImage}){
  async function upload(data){
    await authorize(data.token);
    const id=clean(data.productId),operator=clean(data.operator).slice(0,100),operationId=clean(data.operationId);
    if(!id||id.includes('/')||!operator||!/^[a-zA-Z0-9_-]{16,100}$/.test(operationId))throw Error('請確認姓名及商品資料。');
    function bytes(value,max){const raw=clean(value);if(!raw||raw.length>Math.ceil(max*4/3)+8||!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))throw Error('圖片格式或大小不正確。');const b=Buffer.from(raw,'base64');if(!b.length||b.length>max)throw Error('圖片過大。');return b;}
    const original=bytes(data.original,15*1024*1024),labeled=bytes(data.labeled,2*1024*1024);
    const fingerprint=crypto.createHash('sha256').update(original).update(labeled).digest('hex');
    const productRef=db.collection('opsInternalProducts').doc(id),queueRef=db.collection('opsProductListingCases').doc(id);
    const doc=await productRef.get();if(!doc.exists||doc.data().enabled===false)throw Error('商品不存在或已停用。');
    function prior(row){const record=(row.physicalImages||[]).find(r=>r.operationId===operationId);if(record&&record.fingerprint!==fingerprint)throw Error('這次上傳編號已使用，請重新選取照片。');return record;}
    const old=prior(doc.data());if(old)return {ok:true,url:old.url};
    if((doc.data().physicalImageUrls||[]).length>=20)throw Error('此商品已達 20 張實體圖上限。');
    const check=decodeImage|| (async buffer=>{const sharp=require('sharp');const image=sharp(buffer,{limitInputPixels:50000000});const meta=await image.metadata();if(!['jpeg','png','webp'].includes(meta.format))throw Error('請使用 JPG、PNG 或 WebP 圖片。');await image.stats();return meta.format;});
    const format=await check(original);if(await check(labeled)!=='jpeg')throw Error('實體圖處理格式不正確。');
    const root='ops-product-listing-cases/'+id+'/physical/'+crypto.randomUUID();
    async function put(buffer,suffix,type){const path=root+suffix,token=crypto.randomUUID();await bucket.file(path).save(buffer,{resumable:false,metadata:{contentType:type,metadata:{firebaseStorageDownloadTokens:token,uploadedBy:operator}}});return {path,url:'https://firebasestorage.googleapis.com/v0/b/'+bucket.name+'/o/'+encodeURIComponent(path)+'?alt=media&token='+token};}
    const a=await put(original,'-original.'+format,'image/'+format),b=await put(labeled,'-labeled.jpg','image/jpeg');
    const record={operationId,fingerprint,url:b.url,labeledUrl:b.url,originalUrl:a.url,storagePath:b.path,labeledStoragePath:b.path,originalStoragePath:a.path,labelApplied:true,labelText:'柚子樂器｜實體圖',createdAt:new Date().toISOString(),createdBy:operator,source:'mobile-pin-photo'};
    return db.runTransaction(async tx=>{
      const [p,q]=await Promise.all([tx.get(productRef),tx.get(queueRef)]);if(!p.exists||p.data().enabled===false)throw Error('商品已停用。');
      const row=p.data(),existing=prior(row);if(existing)return {ok:true,url:existing.url};
      if((row.physicalImageUrls||[]).length>=20)throw Error('此商品已達 20 張實體圖上限。');
      function fields(raw){return {physicalImageUrls:[...new Set([...(raw.physicalImageUrls||[]),b.url])],physicalOriginalImageUrls:[...new Set([...(raw.physicalOriginalImageUrls||[]),a.url])],physicalImages:[...(raw.physicalImages||[]),record],physicalImagesUpdatedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),updatedBy:operator};}
      tx.set(productRef,fields(row),{merge:true});const queue=q.exists?q.data():{};
      tx.set(queueRef,{...fields(queue),productId:id,productSku:clean(row.internalSku||row.sku),productName:clean(row.originalName||row.internalName||row.name),productImageUrl:clean(row.imageUrl),mediaQueueStatus:'queued',mediaQueueKinds:[...new Set([...(queue.mediaQueueKinds||[]),'physical-images'])],mediaQueuedAt:FieldValue.serverTimestamp(),mediaQueueUpdatedAt:FieldValue.serverTimestamp(),mediaQueueError:'',mediaQueueRunId:'',mediaBatchPosition:0},{merge:true});
      return {ok:true,url:b.url};
    });
  }
  return {upload};
}
module.exports={createProductPhotoAccess};
