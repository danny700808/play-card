'use strict';
const crypto=require('crypto');
const {hash,fail}=require('./sharedCalendarAccess');
function createSharedEmail({db,sendEmail}){
 const ref=id=>db.doc('sharedCalendarEmailTickets/'+id),mr=id=>db.doc('sharedCalendarMembers/'+id);
 const memberOnly=who=>{if(who.role!=='member')fail('請從自己的成員帳號操作。');};
 async function start(who,email){
  memberOnly(who);email=String(email||'').trim().toLowerCase();if(email.length>254||!/^[^\s@,;<>]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(email))fail('請填有效的 Email。');
  const code=String(crypto.randomInt(100000,1000000)),salt=crypto.randomBytes(16).toString('hex');
  await db.runTransaction(async tx=>{const m=(await tx.get(mr(who.id))).data(),old=(await tx.get(ref(who.id))).data()||{};if(!m||m.status!=='active'||m.ownerUid!==who.ownerUid)fail('成員已停用。');const now=Date.now(),count=old.windowUntil>now?old.count||0:0;if(old.sentAt>now-60000||count>=5)fail('請稍後再寄送驗證碼。');tx.set(ref(who.id),{memberId:who.id,ownerUid:who.ownerUid,version:m.version,email,salt,codeHash:hash(salt+'|'+code),expiresAt:now+600000,attempts:0,sentAt:now,count:count+1,windowUntil:old.windowUntil>now?old.windowUntil:now+3600000});});
  await sendEmail(email,'柚子共用行事曆 Email 驗證','你的驗證碼：'+code+'\n10 分鐘內有效。');return {ok:true};
 }
 async function verify(who,code){
  memberOnly(who);const ok=await db.runTransaction(async tx=>{const r=ref(who.id),t=(await tx.get(r)).data(),m=(await tx.get(mr(who.id))).data();if(!m||m.status!=='active'||m.ownerUid!==who.ownerUid||!t||t.used||t.version!==m.version||t.expiresAt<Date.now()||t.attempts>=5)fail('驗證碼已失效，請重新寄送。');if(hash(t.salt+'|'+String(code||''))!==t.codeHash){tx.update(r,{attempts:t.attempts+1});return false;}const claim=db.doc('sharedCalendarEmailOwners/'+hash(t.email)),c=(await tx.get(claim)).data(),other=c&&c.memberId!==who.id?(await tx.get(mr(c.memberId))).data():null;if(other&&['active','invited'].includes(other.status)&&other.email===t.email)fail('這個 Email 已綁定另一位成員。');const old=m.email&&m.email!==t.email?db.doc('sharedCalendarEmailOwners/'+hash(m.email)):null,previous=old?(await tx.get(old)).data():null;if(previous?.memberId===who.id)tx.delete(old);tx.set(claim,{memberId:who.id,ownerUid:m.ownerUid});tx.update(r,{used:true,codeHash:'',salt:''});tx.update(mr(who.id),{email:t.email,emailVerifiedAt:Date.now()});return true;});if(!ok)fail('驗證碼不正確。');return {ok:true};
 }
 async function unlink(who){memberOnly(who);await db.runTransaction(async tx=>{const m=(await tx.get(mr(who.id))).data();if(!m||m.ownerUid!==who.ownerUid||m.status!=='active')fail('成員已停用。');if(m.emailVerifiedAt&&!m.lineUserId)fail('請先綁定 LINE，再解除 Email 登入。');const claim=m.email?db.doc('sharedCalendarEmailOwners/'+hash(m.email)):null,c=claim?(await tx.get(claim)).data():null;if(c?.memberId===who.id)tx.delete(claim);tx.update(mr(who.id),{email:'',emailVerifiedAt:0});tx.delete(ref(who.id));});return {ok:true};}
 return {start,verify,unlink};
}
module.exports={createSharedEmail};
