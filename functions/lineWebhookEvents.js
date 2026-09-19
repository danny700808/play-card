'use strict';
const crypto=require('node:crypto');
// Both regions share this ledger. A claim is never automatically reclaimed:
// LINE replies and other external effects cannot be rolled back after a timeout.
function createLineWebhookEvents({db,FieldValue,channelId,region,now=Date.now,log=console.warn}){
  async function run(event,handle){
    const eventId=String(event&&event.webhookEventId||'').trim();
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(eventId))throw new Error('Missing valid LINE webhook event ID');
    const key=crypto.createHash('sha256').update(channelId+'|'+eventId).digest('hex');
    const ref=db.collection('lineWebhookEventProcessing').doc(key);
    const claimed=await db.runTransaction(async tx=>{
      const snapshot=await tx.get(ref);
      if(snapshot.exists)return {claimed:false,...snapshot.data()};
      tx.create(ref,{status:'processing',startedAtMs:now(),createdAt:FieldValue.serverTimestamp(),region:String(region||''),eventType:'message'});
      return {claimed:true};
    });
    if(!claimed.claimed){
      if(claimed.status==='needs-review'||claimed.status==='processing'&&now()-Number(claimed.startedAtMs)>120000)log('LINE webhook needs review',{eventKey:key,status:claimed.status});
      return {duplicate:true,status:claimed.status};
    }
    try{
      await handle();
      await ref.set({status:'completed',completedAt:FieldValue.serverTimestamp()},{merge:true});
      return {duplicate:false,status:'completed'};
    }catch(error){
      // Do not persist message text, user identifiers, reply tokens or error payloads.
      await ref.set({status:'needs-review',failedAt:FieldValue.serverTimestamp()},{merge:true}).catch(()=>{});
      log('LINE webhook needs review',{eventKey:key,status:'needs-review'});
      throw error;
    }
  }
  return {run};
}
module.exports={createLineWebhookEvents};
