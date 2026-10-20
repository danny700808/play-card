'use strict';
const admin=require('firebase-admin');
const {onRequest}=require('firebase-functions/v2/https');
const crypto=require('node:crypto');
const {createAccess,hash}=require('./shippingDeskAccess');
const storage=require('./storageRouting');
const ORIGIN='https://danny700808.github.io';
const ENDPOINT='https://asia-east1-youzi-c1b74.cloudfunctions.net/shippingDeskApi';
const db=admin.firestore(),access=createAccess({db});
const bearer=req=>String(req.headers.authorization||'').replace(/^Bearer /,'');
async function handler(req,res){
  res.set('Cache-Control','private, no-store');
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','no-referrer');
  if(req.headers.origin===ORIGIN){res.set('Access-Control-Allow-Origin',ORIGIN);res.set('Vary','Origin');}
  if(req.method==='OPTIONS'){
    if(req.headers.origin!==ORIGIN)return res.status(403).end();
    res.set('Access-Control-Allow-Methods','POST, GET, OPTIONS');
    res.set('Access-Control-Allow-Headers','Content-Type, Authorization');
    return res.status(204).end();
  }
  try{
    if(req.method==='GET'){
      const r=await access.document(req.query.job,req.query.ticket),kind=req.query.kind||'label';
      if(!['label','combined','preview'].includes(kind)||!r.files?.[kind])throw Object.assign(Error('找不到文件。'),{status:404});
      const file=r.files[kind],[bytes]=await storage.writeBucket().file(file.path).download();
      res.set('Content-Type',file.mime);
      res.set('Content-Disposition','inline');
      res.set('Content-Security-Policy',(file.mime==='text/html'?"sandbox allow-scripts allow-modals; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; ":"")+"frame-ancestors "+ORIGIN);
      return res.status(200).send(bytes);
    }
    if(req.method!=='POST')return res.status(405).end();
    if(req.headers.origin&&req.headers.origin!==ORIGIN)return res.status(403).json({error:'來源不允許。'});
    if(!req.is('application/json'))return res.status(415).end();
    const d=req.body||{},token=bearer(req);let result;
    if(d.action==='login')result=await access.login(d.password,d.remember===true,req.ip);
    else if(d.action==='logout')result=await access.logout(token);
    else if(d.action==='orders')result=await access.orders(token);
    else if(d.action==='enqueue')result=await access.enqueue(token,d);
    else if(d.action==='result')result=await access.result(token,d.jobId);
    else if(d.action==='agentPoll')result=await access.poll(token);
    else if(d.action==='agentSnapshot'){await access.updateSnapshot(token,d.snapshot);result={ok:true};}
    else if(d.action==='agentCleanup'){
      await access.agent(token);
      const docs=(await db.collection('shippingDeskJobs').where('expiresAtMs','<',Date.now()-86400000).limit(20).get()).docs;
      for(const doc of docs){
        for(const kind of Object.keys(doc.data().files||{})){
          await storage.writeBucket().file(`shipping-desk/${doc.id}/${kind}`).delete({ignoreNotFound:true});
        }
        await doc.ref.delete();
      }
      result={ok:true};
    }
    else if(d.action==='agentComplete'){
      const prior=await access.claimed(token,d.jobId,d.claim);
      if(prior.row.status!=='running')return res.status(200).json({ok:true});
      if(d.files&&prior.row.command!=='document-link')throw Error('Invalid document job');
      let extra={},reply=d.result||{};
      if(d.files&&!d.error){
        const ticket=crypto.randomBytes(32).toString('base64url'),files={};
        reply={};
        for(const [kind,input] of Object.entries(d.files)){
          if(!['label','combined','preview'].includes(kind)||(kind==='preview'?input.mime!=='image/png':!['application/pdf','text/html'].includes(input.mime)))throw Error('Invalid document type');
          const bytes=Buffer.from(input.base64||'','base64');
          if(!bytes.length||bytes.length>10000000)throw Error('Document too large');
          if(input.mime==='application/pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')throw Error('Invalid PDF');
          if(input.mime==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid preview');
          const path=`shipping-desk/${d.jobId}/${kind}`;
          await storage.writeBucket().file(path).save(bytes,{resumable:false,metadata:{contentType:input.mime,cacheControl:'private,no-store'}});
          files[kind]={path,mime:input.mime};
          reply[kind]=ENDPOINT+'?'+new URLSearchParams({job:d.jobId,kind,ticket});
        }
        extra={files,documentTicketHash:hash(ticket)};
      }
      result=await access.complete(token,d.jobId,d.claim,reply,d.error,extra);
      if(d.snapshot)await access.updateSnapshot(token,d.snapshot);
    }else return res.status(403).json({error:'此入口只能處理包貨與列印。'});
    return res.status(200).json(result);
  }catch(e){
    return res.status(e.status||400).json({error:e.status?e.message:'連線或操作未完成，請重新讀取訂單確認。'});
  }
}
function register(exports){exports.shippingDeskApi=onRequest({region:'asia-east1',timeoutSeconds:120,memory:'256MiB',maxInstances:3},handler);}
module.exports={register};
