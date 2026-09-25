'use strict';
const {hash,random,validId,fail}=require('./sharedCalendarAccess');
const validLine=id=>/^U[0-9a-f]{32}$/i.test(id||'');
function createSharedLine({db,botId=async()=>''}){
 const memberRef=id=>db.doc('sharedCalendarMembers/'+id),claimRef=id=>db.doc('sharedCalendarLineOwners/'+hash(id));
 async function start(who){
  if(who.role!=='member')fail('請從成員帳號綁定自己的 LINE。');
  const official=await botId();if(!/^@[A-Za-z0-9._-]+$/.test(official))fail('官方 LINE 暫時無法連線，請稍後再試。');
  const token=random(),ref=db.doc('sharedCalendarLineTickets/'+hash(token)),expiresAt=Date.now()+15*60000;
  await db.runTransaction(async tx=>{const mr=memberRef(who.id),m=(await tx.get(mr)).data();if(!m||m.ownerUid!==who.ownerUid||m.status!=='active')fail('成員已停用。');tx.set(ref,{memberId:who.id,ownerUid:who.ownerUid,version:m.version,expiresAt,used:false});tx.update(mr,{lineBindHash:ref.id});});
  const command='柚子行事曆綁定 '+token;
  return {url:'https://line.me/R/oaMessage/'+encodeURIComponent(official)+'/?'+encodeURIComponent(command),expiresAt};
 }
 async function unlink(who){
  if(who.role!=='member')fail('請從成員帳號操作。');
  await db.runTransaction(async tx=>{const mr=memberRef(who.id),m=(await tx.get(mr)).data();if(!m||m.ownerUid!==who.ownerUid||m.status!=='active')fail('成員已停用。');if(m.lineUserId&&!m.emailVerifiedAt)fail('請先綁定 Email，再解除 LINE 登入。');const claim=validLine(m.lineUserId)?claimRef(m.lineUserId):null,c=claim?(await tx.get(claim)).data():null;if(c?.memberId===who.id)tx.delete(claim);tx.update(mr,{lineUserId:'',contactKey:'',lineBindHash:'',lineLinkedAt:0});});return {ok:true};
 }
 // Called only from the existing signature-verified LINE webhook handler.
 async function handle(event,reply){
  const message=String(event.message?.text||'').trim();if(!message.startsWith('柚子行事曆綁定'))return false;
  if(event.source?.type!=='user'||!validLine(event.source.userId)){await reply(event.replyToken,'請用自己的 LINE 私訊柚子樂器官方帳號完成綁定。');return true;}
  const token=message.match(/^柚子行事曆綁定\s+([A-Za-z0-9_-]{43})$/)?.[1];
  if(!token){await reply(event.replyToken,'綁定碼不完整，請回行事曆重新按「綁定我的 LINE」。');return true;}
  let memberId;
  try{await db.runTransaction(async tx=>{
   const tr=db.doc('sharedCalendarLineTickets/'+hash(token)),t=(await tx.get(tr)).data();
   if(!t||t.used||t.expiresAt<=Date.now()||!validId(t.memberId))fail('綁定碼已失效，請回行事曆重新綁定。');
   const mr=memberRef(t.memberId),m=(await tx.get(mr)).data(),owner=(await tx.get(db.doc('privateCalendarServer/access'))).data();
   if(!m||m.status!=='active'||m.ownerUid!==t.ownerUid||owner?.uid!==m.ownerUid||m.version!==t.version||m.lineBindHash!==tr.id)fail('綁定碼已失效，請回行事曆重新綁定。');
   const cr=claimRef(event.source.userId),c=(await tx.get(cr)).data(),other=c&&c.memberId!==t.memberId?(await tx.get(memberRef(c.memberId))).data():null;
   if(other&&other.status==='active')fail('這個 LINE 已綁定另一位共用成員，請先解除原綁定。');
   const old=validLine(m.lineUserId)&&m.lineUserId!==event.source.userId?claimRef(m.lineUserId):null,previous=old?(await tx.get(old)).data():null;
   if(previous?.memberId===t.memberId)tx.delete(old);
   tx.set(cr,{memberId:t.memberId,ownerUid:m.ownerUid});tx.update(mr,{lineUserId:event.source.userId,lineLinkedAt:Date.now(),lineBindHash:'',contactKey:''});tx.update(tr,{used:true});memberId=t.memberId;
  });}catch(e){if(e.code!=='permission-denied')throw e;await reply(event.replyToken,e.message);return true;}
  await reply(event.replyToken,'已綁定 LINE，之後交辦與時間提醒會傳到這裡。\n回行事曆：\nhttps://danny700808.github.io/play-card/shared-calendar.html?member='+encodeURIComponent(memberId)+'&openExternalBrowser=1');return true;
 }
 return {start,unlink,handle};
}
module.exports={createSharedLine};
