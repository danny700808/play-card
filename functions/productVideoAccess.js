'use strict';
const crypto=require('node:crypto');
const clean=v=>String(v==null?'':v).trim();
const MAX_BYTES=512*1024*1024,MAX_VIDEOS=3;
function videoBrandProfile(){const p=JSON.parse(JSON.stringify(require('./productVideoBrandProfile.json'))),base='https://danny700808.github.io/play-card/';p.manifestUrl=base+p.manifestPath;for(const key of ['intro','watermark','outro'])p[key].assetUrl=base+p[key].assetPath;return p;}
function createProductVideoAccess({db,FieldValue,bucket,authorize,now=Date.now}){
  const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
  async function start(data){
    await authorize(data.token);
    const productId=clean(data.productId),operator=clean(data.operator).slice(0,100),size=Number(data.sizeBytes),contentType=clean(data.contentType);
    if(!productId||productId.includes('/')||!operator)throw Error('請確認姓名及商品。');
    if(!['video/mp4','video/quicktime','video/webm'].includes(contentType)||!Number.isSafeInteger(size)||size<=0||size>MAX_BYTES)throw Error('請選擇 512 MB 以內的 MP4、MOV 或 WebM 影片。');
    const product=await db.collection('opsInternalProducts').doc(productId).get();
    if(!product.exists||product.data().enabled===false)throw Error('商品不存在或已停用。');
    if((product.data().productVideos||[]).length>=MAX_VIDEOS)throw Error('此商品最多保留 3 段影片。');
    const uploadId=crypto.randomUUID(),extension=contentType==='video/quicktime'?'mov':contentType==='video/webm'?'webm':'mp4';
    const path='ops-product-listing-cases/'+productId+'/video/'+uploadId+'-original.'+extension;
    const [uploadUrl]=await bucket.file(path).createResumableUpload({origin:'https://danny700808.github.io',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType,metadata:{productId,uploadedBy:operator,videoType:'product-original'}}});
    await db.collection('inventoryMediaUploads').doc(uploadId).set({productId,operator,size,contentType,path,fileName:clean(data.fileName).slice(0,180),durationSeconds:Math.max(0,Math.min(86400,Number(data.durationSeconds)||0)),sessionHash:hash(clean(data.token)),expiresAtMs:now()+8*3600000,status:'uploading',createdAt:FieldValue.serverTimestamp()});
    return {ok:true,uploadId,uploadUrl};
  }
  async function finish(data){
    await authorize(data.token);const uploadId=clean(data.uploadId);
    if(!/^[a-f0-9-]{36}$/.test(uploadId))throw Error('上傳編號不正確。');
    const ref=db.collection('inventoryMediaUploads').doc(uploadId),snapshot=await ref.get();
    if(!snapshot.exists)throw Error('找不到這次上傳。');const upload=snapshot.data();
    if(upload.sessionHash!==hash(clean(data.token))||upload.expiresAtMs<now())throw Error('上傳已失效，請重新登入並選擇影片。');
    if(upload.status==='completed')return {ok:true,video:upload.video};
    const file=bucket.file(upload.path),[metadata]=await file.getMetadata();
    if(Number(metadata.size)!==upload.size||Number(metadata.size)>MAX_BYTES||metadata.contentType!==upload.contentType)throw Error('影片尚未完整上傳或格式不符。');
    const [head]=await file.download({start:0,end:31});
    const valid=upload.contentType==='video/webm'?head.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])):head.length>=12&&['ftyp','moov','mdat','wide','free','skip'].includes(head.toString('ascii',4,8));
    if(!valid)throw Error('檔案內容不是支援的影片格式。');
    const downloadToken=uploadId;await file.setMetadata({metadata:{...(metadata.metadata||{}),firebaseStorageDownloadTokens:downloadToken}});
    const url='https://firebasestorage.googleapis.com/v0/b/'+bucket.name+'/o/'+encodeURIComponent(upload.path)+'?alt=media&token='+downloadToken;
    return db.runTransaction(async tx=>{
      const productRef=db.collection('opsInternalProducts').doc(upload.productId),queueRef=db.collection('opsProductListingCases').doc(upload.productId);
      const [state,p,q]=await Promise.all([tx.get(ref),tx.get(productRef),tx.get(queueRef)]);
      if(state.data().status==='completed')return {ok:true,video:state.data().video};
      if(!p.exists||p.data().enabled===false)throw Error('商品已停用。');const product=p.data(),videos=product.productVideos||[];
      if(videos.length>=MAX_VIDEOS)throw Error('此商品最多保留 3 段影片。');
      const profile=videoBrandProfile(),sku=clean(product.internalSku||product.sku),name=clean(product.internalName||product.originalName||product.name),duration=upload.durationSeconds;
      const video={url,originalUrl:url,storagePath:upload.path,fileName:upload.fileName,contentType:upload.contentType,sizeBytes:upload.size,durationSeconds:duration,videoBrandProfile:profile,videoBrandStatus:'pending',processedVideoAssets:{},youtubeTitle:(name+'｜商品編號 '+sku+'｜實體拍攝｜柚子樂器').slice(0,100),youtubeDescription:name+'\n商品編號：'+sku+'\n柚子樂器｜商品實拍與介紹',youtubeVisibility:'public',youtubeAudience:'not-made-for-kids',youtubeLanguage:'zh-TW',youtubeAudioLanguage:'zh-TW',youtubeTags:[sku,'柚子樂器','樂器實拍'].filter(Boolean),youtubeHashtags:['#柚子樂器','#樂器實拍'],youtubeCategoryId:'10',youtubeCategoryName:'音樂',youtubePlaylistName:'柚子樂器｜商品實拍與介紹',youtubePlaylistStatus:'pending',youtubeThumbnailStatus:'pending',youtubeThumbnailUrl:'',youtubeLicense:'youtube',youtubeEmbeddable:true,youtubeCaptionMode:'auto-if-speech',youtubeStatus:'pending',youtubeVideoId:'',youtubeUrl:'',youtubeUploadedAt:'',platformVideoResults:{},shopeeClipSelectionMode:duration>profile.shopee.maximumMainContentSeconds?'auto-best-segment':'full',shopeeClipStartSeconds:0,shopeeClipDurationSeconds:duration?Math.min(profile.shopee.maximumMainContentSeconds,duration):profile.shopee.maximumMainContentSeconds,shopeeVideoStatus:'pending',createdAt:new Date(now()).toISOString(),createdBy:upload.operator};
      const queue=q.exists?q.data():{};function fields(raw){return {productVideos:[...(raw.productVideos||[]),video],productVideoUrls:[...new Set([...(raw.productVideoUrls||[]),url])],productVideosUpdatedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),updatedBy:upload.operator};}
      tx.set(productRef,fields(product),{merge:true});tx.set(queueRef,{...fields(queue),productId:upload.productId,productSku:sku,productName:name,productImageUrl:clean(product.imageUrl),mediaQueueStatus:'queued',mediaQueueKinds:[...new Set([...(queue.mediaQueueKinds||[]),'product-video'])],mediaQueuedAt:FieldValue.serverTimestamp(),mediaQueueUpdatedAt:FieldValue.serverTimestamp(),mediaQueueError:'',mediaQueueRunId:'',mediaBatchPosition:0},{merge:true});tx.set(ref,{status:'completed',video},{merge:true});
      return {ok:true,video};
    });
  }
  return {start,finish};
}
module.exports={createProductVideoAccess,videoBrandProfile};
