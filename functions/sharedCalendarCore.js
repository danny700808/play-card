'use strict';
const crypto=require('crypto');
const {hash,random,validId,fail}=require('./sharedCalendarAccess');
const PAGE='https://danny700808.github.io/play-card/shared-calendar.html';
const text=v=>String(v??'').trim();
const activeContact=r=>!['disabled','inactive','revoked','rejected','離職','停用'].includes(text(r.accountStatus||r.status).toLowerCase());
const canRead=(who,row)=>row&&row.ownerUid===who.ownerUid&&(who.role==='owner'||row.createdBy===who.id||row.assignedTo===who.id)&&(!row.draft||who.role==='owner'||row.createdBy===who.id);
const canEdit=(who,row)=>canRead(who,row)&&(who.role==='owner'||row.createdBy===who.id);
function validateTask(input){const start=Date.parse(input.start),end=Date.parse(input.end);if(!text(input.title)||text(input.title).length>200||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>31*86400000)fail('請填名稱及有效時間（每件最長 31 天）。','invalid-argument');const minutes=Number(input.reminderMinutes??10);if(![0,5,10,30,60,1440].includes(minutes))fail('提醒時間無效。');return {title:text(input.title),note:text(input.note).slice(0,12000),start:new Date(start).toISOString(),end:new Date(end).toISOString(),remind:input.remind===true,reminderMinutes:minutes};}
function createSharedCore({db,auth,bucket,ownerLine,sendLine}){
 const tasks=db.collection('sharedCalendarTasks'),members=db.collection('sharedCalendarMembers'),outbox=db.collection('sharedCalendarOutbox');
 const requireOwner=who=>{if(who.role!=='owner')fail('只有管理者能設定成員與通知。');};
 const cleanMember=d=>{const m=d.data();return {id:d.id,name:m.name,status:m.status,lineLinked:!!m.contactKey};};
 async function contactChoices(){const rows=[];for(const collection of ['employees','admins'])for(const d of (await db.collection(collection).get()).docs){const r=d.data(),line=text(r.lineUserId||r['LINE User ID']);if(activeContact(r)&&r.lineNotifyEnabled!==false&&/^U[0-9a-f]{32}$/i.test(line))rows.push({key:collection+'/'+d.id,name:text(r.name||r.displayName||r['姓名'])||d.id,masked:line.slice(0,5)+'…'+line.slice(-4)});}return rows;}
 async function lineFor(ownerUid,id){if(id==='owner')return ownerLine(ownerUid);const snap=await members.doc(id).get(),m=snap.data();if(!m||m.status!=='active'||m.ownerUid!==ownerUid||!/^((employees)|(admins))\/[^/]+$/.test(m.contactKey||''))return null;const r=(await db.doc(m.contactKey).get()).data();if(!r||!activeContact(r)||r.lineNotifyEnabled===false)return null;const line=text(r.lineUserId||r['LINE User ID']);return /^U[0-9a-f]{32}$/i.test(line)?line:null;}
 async function assigned(who,id){if(id==='owner')return {id,name:'管理者'};if(who.role!=='owner'&&id!==who.id)fail('成員只能交辦管理者或安排自己的工作。');const m=await auth.member(id);if(m.ownerUid!==who.ownerUid)fail('成員不屬於此工作區。');return {id,name:m.name};}
 const audit=(tx,who,id,operation)=>tx.set(db.doc('sharedCalendarAudit/'+crypto.randomUUID()),{ownerUid:who.ownerUid,taskId:id,actorId:who.id,actorName:who.name,operation,at:Date.now()});
 function queue(tx,who,row,id,kind,to,key){if(!to||to===who.id)return null;const ref=outbox.doc(hash(key));tx.set(ref,{ownerUid:who.ownerUid,taskId:id,to,actorId:who.id,actorName:who.name,kind,title:row.title,start:row.start,taskVersion:row.scheduleVersion||0,key:crypto.randomUUID(),state:'pending',createdAt:Date.now(),attempts:0});return ref.id;}
 async function deliver(id){
  const ref=outbox.doc(id);let job;
  await db.runTransaction(async tx=>{const r=(await tx.get(ref)).data();if(!r||['sent','cancelled'].includes(r.state)||r.leaseUntil>Date.now()||r.createdAt<Date.now()-86400000)return;job=r;tx.update(ref,{state:'sending',leaseUntil:Date.now()+90000,attempts:(r.attempts||0)+1});});if(!job)return;
  try{
   const row=(await tasks.doc(job.taskId).get()).data();
   let readable=row&&row.ownerUid===job.ownerUid&&!row.draft;
   if(readable&&job.to!=='owner'){const m=(await members.doc(job.to).get()).data();readable=m?.status==='active'&&m.ownerUid===job.ownerUid&&(row.createdBy===job.to||row.assignedTo===job.to);}
   if(job.kind==='reminder')readable=readable&&row.remind&&!['done','cancelled'].includes(row.status)&&row.scheduleVersion===job.taskVersion&&row.assignedTo===job.to;
   if(!readable){await ref.set({state:'cancelled',leaseUntil:0},{merge:true});return;}
   const target=await lineFor(job.ownerUid,job.to);if(!target)throw Error('尚未設定此收件人的有效 LINE 綁定。');
   const labels={assigned:'新交辦／內容更新',progress:'交辦進度更新',reminder:'工作時間提醒'};
   const suffix=job.to==='owner'?'?owner=1&task=':'?member='+encodeURIComponent(job.to)+'&task=';
   await sendLine(target,'🔔 '+labels[job.kind]+'\n'+job.title+'\n'+new Date(job.start).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})+'\n'+job.actorName+' · '+({pending:'待處理',in_progress:'處理中',done:'已完成',cancelled:'已取消'}[row.status]||'待處理')+'\n查看截圖／錄音：\n'+PAGE+suffix+encodeURIComponent(job.taskId),job.key);
   await ref.set({state:'sent',sentAt:Date.now(),leaseUntil:0,error:''},{merge:true});
  }catch(e){await ref.set({state:'failed',leaseUntil:0,error:text(e.message).slice(0,400)},{merge:true});}
 }
 async function notifyResult(ids){for(const id of ids.filter(Boolean))await deliver(id);const states=await Promise.all(ids.filter(Boolean).map(async id=>(await outbox.doc(id).get()).data()));return {sent:states.filter(x=>x.state==='sent').length,pending:states.filter(x=>x.state!=='sent'&&x.state!=='cancelled').length};}
 async function taskFor(who,id){if(!validId(id))fail('工作編號無效。');const row=(await tasks.doc(id).get()).data();if(!canRead(who,row))fail('找不到工作或沒有查看權限。');return row;}
 async function api(request){
  const who=await auth.identity(request),d=request.data||{},action=d.action;
  if(action==='status'){
   const list=(await members.where('ownerUid','==',who.ownerUid).get()).docs.map(cleanMember),ownerReady=!!await ownerLine(who.ownerUid);
   return {me:{id:who.id,name:who.name,role:who.role},ownerLineReady:ownerReady,myLineReady:!!await lineFor(who.ownerUid,who.id),members:who.role==='owner'?list:list.filter(x=>x.id===who.id),assignees:[{id:'owner',name:'管理者'},...(who.role==='owner'?list.filter(x=>x.status==='active'):list.filter(x=>x.id===who.id&&x.status==='active'))]};
  }
  if(action==='contacts'){requireOwner(who);return {contacts:await contactChoices()};}
  if(action==='invite'){
   requireOwner(who);const name=text(d.name);if(!name||name.length>50)fail('請填成員姓名（50 字以內）。');const contactKey=text(d.contactKey);if(contactKey&&!(await contactChoices()).some(c=>c.key===contactKey))fail('請選擇有效的既有 LINE 綁定。');
   const id=crypto.randomUUID(),token=random(),version=crypto.randomUUID(),expiresAt=Date.now()+86400000;
   await db.runTransaction(async tx=>{tx.create(members.doc(id),{ownerUid:who.ownerUid,name,contactKey,status:'invited',version,createdAt:Date.now()});tx.create(db.doc('sharedCalendarInvites/'+hash(token)),{ownerUid:who.ownerUid,memberId:id,version,expiresAt,used:false});});
   return {url:PAGE+'#invite='+token,expiresAt,memberId:id};
  }
  if(action==='reinvite'){
   requireOwner(who);if(!validId(d.memberId))fail('成員編號無效。');const token=random(),version=crypto.randomUUID(),expiresAt=Date.now()+86400000;
   await db.runTransaction(async tx=>{const ref=members.doc(d.memberId),m=(await tx.get(ref)).data();if(!m||m.ownerUid!==who.ownerUid)fail('成員不存在。');tx.update(ref,{version,status:'invited',passwordHash:'',passwordSalt:''});tx.create(db.doc('sharedCalendarInvites/'+hash(token)),{ownerUid:who.ownerUid,memberId:d.memberId,version,expiresAt,used:false});});return {url:PAGE+'#invite='+token,expiresAt};
  }
  if(action==='revoke'||action==='memberLine'){
   requireOwner(who);if(!validId(d.memberId))fail('成員編號無效。');const key=text(d.contactKey);if(action==='memberLine'&&key&&!(await contactChoices()).some(c=>c.key===key))fail('LINE 綁定無效。');
   await db.runTransaction(async tx=>{const ref=members.doc(d.memberId),m=(await tx.get(ref)).data();if(!m||m.ownerUid!==who.ownerUid)fail('成員不存在。');tx.update(ref,action==='revoke'?{status:'revoked',version:crypto.randomUUID()}: {contactKey:key});});return {ok:true};
  }
  if(action==='list'){
   const start=Date.parse(d.start),end=Date.parse(d.end);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>100*86400000)fail('查詢範圍需在 100 天內。');
   const docs=(await tasks.where('ownerUid','==',who.ownerUid).get()).docs;
   return {tasks:docs.map(doc=>({id:doc.id,...doc.data()})).filter(row=>canRead(who,row)&&Date.parse(row.start)<end&&Date.parse(row.end)>start).sort((a,b)=>a.start.localeCompare(b.start))};
  }
  if(action==='detail'){const row=await taskFor(who,d.id);const notices=(await outbox.where('taskId','==',d.id).get()).docs.map(x=>x.data()).filter(x=>x.ownerUid===who.ownerUid).map(x=>({kind:x.kind,state:x.state,at:x.sentAt||x.createdAt,error:x.error||''}));return {task:{id:d.id,...row},notifications:notices.slice(-12)};}
  if(action==='save'){
   const event=validateTask(d.event||{}),person=await assigned(who,d.assignedTo||'owner');if(!validId(d.id))fail('缺少工作編號。');const ref=tasks.doc(d.id);
   await db.runTransaction(async tx=>{const old=(await tx.get(ref)).data();if(old&&!canEdit(who,old))fail('只有建立者或管理者能修改內容。');if(Number(d.revision||0)!==Number(old?.revision||0))fail('內容已被更新，請關閉後重新開啟。','aborted');const changed=!old||old.start!==event.start||old.reminderMinutes!==event.reminderMinutes||old.assignedTo!==person.id;tx.set(ref,{...event,ownerUid:who.ownerUid,assignedTo:person.id,assignedName:person.name,createdBy:old?.createdBy||who.id,createdName:old?.createdName||who.name,createdAt:old?.createdAt||Date.now(),updatedAt:Date.now(),updatedBy:who.id,status:old?.status||'pending',draft:old?old.draft:true,assets:old?.assets||[],revision:Number(old?.revision||0)+1,scheduleVersion:Number(old?.scheduleVersion||0)+(changed?1:0),publishedRevision:old?.publishedRevision||0});audit(tx,who,d.id,'save');});return {task:{id:d.id,...(await ref.get()).data()}};
  }
  if(action==='publish'){
   const ref=tasks.doc(text(d.id));if(!validId(d.id))fail('工作編號無效。');let notices=[];
   await db.runTransaction(async tx=>{const row=(await tx.get(ref)).data();if(!canEdit(who,row))fail('沒有發佈權限。');if(row.publishedRevision===row.revision&&!row.draft)return;tx.update(ref,{draft:false,publishedRevision:row.revision});notices=[queue(tx,who,row,d.id,'assigned',row.assignedTo,d.id+'|publish|'+row.revision)];audit(tx,who,d.id,'publish');});return {ok:true,notification:await notifyResult(notices)};
  }
  if(action==='progress'){
   if(!validId(d.id)||!['pending','in_progress','done','cancelled'].includes(d.status))fail('狀態無效。');const ref=tasks.doc(d.id);let notices=[];
   await db.runTransaction(async tx=>{const row=(await tx.get(ref)).data();if(!canRead(who,row)||row.draft)fail('沒有修改權限。');if(d.status==='cancelled'&&!canEdit(who,row))fail('只有建立者或管理者能取消工作。');if(row.status===d.status)return;if(Number(d.revision)!==row.revision)fail('進度已更新，請重新開啟。','aborted');const updated={...row,status:d.status,revision:row.revision+1};tx.update(ref,{status:d.status,revision:updated.revision,updatedAt:Date.now(),updatedBy:who.id});notices=[queue(tx,who,updated,d.id,'progress',row.createdBy,d.id+'|progress|'+updated.revision)];audit(tx,who,d.id,'status:'+d.status);});return {ok:true,notification:await notifyResult(notices)};
  }
  if(action==='upload'){
   const row=await taskFor(who,d.id);if(!canEdit(who,row))fail('沒有上傳權限。');const mime=text(d.mime).split(';')[0];if(!['image/jpeg','image/png','image/webp','image/gif','audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav'].includes(mime)||typeof d.base64!=='string'||d.base64.length>7100000)fail('附件限圖片或錄音，每檔 5 MB。');const buffer=Buffer.from(d.base64,'base64');if(!buffer.length||buffer.length>5242880)fail('附件需小於 5 MB。');
   const id=validId(d.assetId)?d.assetId:crypto.randomUUID(),asset={id,name:text(d.name).slice(0,100)||'附件',mime,size:buffer.length};
   const existing=(row.assets||[]).find(a=>a.id===id);if(existing)return {asset:existing};
   const path='shared-calendar/'+hash(who.ownerUid)+'/'+d.id+'/'+id;await bucket().file(path).save(buffer,{resumable:false,metadata:{contentType:mime,cacheControl:'private,no-store'}});
   await db.runTransaction(async tx=>{const ref=tasks.doc(d.id),fresh=(await tx.get(ref)).data();if(!canEdit(who,fresh))fail('權限已改變。');if((fresh.assets||[]).some(a=>a.id===id))return;if((fresh.assets||[]).length>=12)fail('每件工作最多 12 個附件。');tx.update(ref,{assets:[...(fresh.assets||[]),asset],revision:fresh.revision+1});});return {asset};
  }
  if(action==='asset'){
   const row=await taskFor(who,d.id),asset=(row.assets||[]).find(a=>a.id===d.assetId);if(!asset)fail('附件不存在。','not-found');const [data]=await bucket().file('shared-calendar/'+hash(who.ownerUid)+'/'+d.id+'/'+asset.id).download();return {mime:asset.mime,base64:data.toString('base64')};
  }
  fail('不支援的工作操作。','invalid-argument');
 }
 async function tick(){
  const uid=await auth.ownerUid(),now=Date.now();
  const docs=(await tasks.where('ownerUid','==',uid).get()).docs;
  for(const doc of docs){const r=doc.data(),at=Date.parse(r.start)-r.reminderMinutes*60000;if(r.draft||!r.remind||['done','cancelled'].includes(r.status)||at>now||at<=now-86400000)continue;const ref=outbox.doc(hash(doc.id+'|remind|'+r.scheduleVersion));await db.runTransaction(async tx=>{if((await tx.get(ref)).exists)return;tx.create(ref,{ownerUid:uid,taskId:doc.id,to:r.assignedTo,actorId:'system',actorName:'定時提醒',kind:'reminder',title:r.title,start:r.start,taskVersion:r.scheduleVersion,key:crypto.randomUUID(),state:'pending',createdAt:now,attempts:0});});}
  const pending=(await outbox.where('ownerUid','==',uid).get()).docs.filter(d=>!['sent','cancelled'].includes(d.data().state)&&d.data().createdAt>now-86400000&&(!d.data().leaseUntil||d.data().leaseUntil<now));for(const d of pending.slice(0,40))await deliver(d.id);
 }
 return {api,tick,deliver,canRead,canEdit};
}
module.exports={createSharedCore,validateTask,canRead,canEdit};
