'use strict';

const crypto = require('node:crypto');
const {HttpsError} = require('firebase-functions/v2/https');
const {COLLECTION, validDate, datesBetween} = require('./courseClosurePolicy');
const {recipientFields} = require('./portalNotificationPolicy');
const {personalize} = require('./classClosureOperations');
const clean = value => String(value == null ? '' : value).trim();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const email = value => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(clean(value)) ? clean(value).toLowerCase() : '';
const line = value => /^U[0-9a-f]{32}$/i.test(clean(value)) ? clean(value) : '';
const idOk = value => /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const dateNow = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function range(data) {
  try {return datesBetween(clean(data.startDate), clean(data.endDate || data.startDate));}
  catch(error) {throw new HttpsError('invalid-argument',error.message);}
}
function recipients(teachers, bindings, events) {
  return teachers.filter(t => t.active !== false && t.__mirrorActive !== false).map(t => {
    const teacherId = clean(t.id || t.__id);
    const active = bindings.filter(b => clean(b.teacherId) === teacherId && b.status === 'active' && b.active !== false);
    const lines = [...new Set(active.map(b => line(b.lineUserId)).filter(Boolean))];
    const emails = [...new Set(active.map(b => email(b.email || b.emailNormalized)).filter(Boolean))];
    const issue = lines.length > 1 ? '有多個 LINE 綁定，請先確認帳號' : !lines.length && emails.length > 1 ? '有多個 Email 綁定，請先確認帳號' : '';
    const target = recipientFields({lineUserId:lines.length === 1 ? lines[0] : '',email:emails.length === 1 ? emails[0] : ''});
    const contactIssue = issue || (!target.targetLineUserId && !target.targetEmail ? '沒有可用的已註冊 LINE／Email' : '');
    const lessonCount = events.filter(e => e.teacherId === teacherId && !['cancelled','pending_conflict','leave','absent'].includes(e.status) && e.active !== false).length;
    return {teacherId,name:clean(t.name || t.teacherName) || '老師',lessonCount,...target,eligible:!contactIssue,reason:contactIssue};
  }).filter(r => r.teacherId).sort((a,b) => a.name.localeCompare(b.name,'zh-Hant'));
}
const publicRecipient = ({targetLineUserId,targetEmail,emailFallbackEnabled,...row}) => row;

function createTeacherAnnouncements({db,loadSchedule,loadTeachers,uploadImage,closureOperations,now = () => new Date()}) {
  const announcements = db.collection('teacherAnnouncements');
  async function directory(dates) {
    const [teachers,bindings,events] = await Promise.all([loadTeachers(),db.collection('coursePortalTeacherBindings').get(),loadSchedule(dates[0],dates.at(-1))]);
    return recipients(teachers,bindings.docs.map(d=>d.data()),events);
  }
  async function closures(dates) {
    const docs=await Promise.all(dates.map(d=>db.collection(COLLECTION).doc(d).get()));
    return docs.map((d,i)=>({date:dates[i],active:d.data()?.active===true,reason:clean(d.data()?.reason),announcementId:clean(d.data()?.announcementId),operationsVersion:Number(d.data()?.operationsVersion||1)}));
  }
  async function history() {
    const docs=await announcements.orderBy('createdAt','desc').limit(30).get();
    return Promise.all(docs.docs.map(async doc=>{
      const r=doc.data();
      const deliveries=await Promise.all((r.deliveries||[]).map(async d=>{
        const q=await db.collection('notificationQueue').doc(d.queueId).get();
        const value=q.data()||{};
        const fallback=value.fallbackQueueId ? await db.collection('notificationQueue').doc(value.fallbackQueueId).get() : null;
        return {teacherId:d.teacherId||'',renterId:d.renterId||'',audience:d.audience||'teacher',name:d.name,channel:fallback?'email':d.channel,status:clean(fallback?.data()?.status || value.status)||'待發送',error:clean(fallback?.data()?.lastError || value.lastError)};
      }));
      return {id:doc.id,title:r.title,body:r.body,renterTitle:r.renterTitle||'',renterBody:r.renterBody||'',renterImageUrl:r.renterImageUrl||'',impact:r.impact||null,kind:r.kind,dates:r.dates,reason:r.reason,imageUrl:r.imageUrl||'',createdAtText:r.createdAtText,released:r.released===true,supersededBy:clean(r.supersededBy),deliveries};
    }));
  }
  return async function handle(data,actor) {
    if (!actor) throw new HttpsError('permission-denied','請先登入管理者帳號。');
    if(data.action==='detail') {
      if(!idOk(clean(data.id)))throw new HttpsError('invalid-argument','公告編號不正確。');
      const snapshot=await announcements.doc(data.id).get(),row=snapshot.data();
      if(!row)throw new HttpsError('not-found','找不到這筆公告。');
      return {ok:true,row:{id:snapshot.id,kind:row.kind,dates:row.dates,released:row.released===true}};
    }
    if (data.action === 'inspect') {
      const dates=range(data);
      const [rows,closed,recent,context]=await Promise.all([directory(dates),closures(dates),history(),closureOperations?.inspect(dates)]);
      return {ok:true,rows:rows.map(publicRecipient),renters:(context?.renters||[]).map(publicRecipient),impact:context?.impact||null,directoryVersion:hash(JSON.stringify({rows,closure:context?.signature||''})),closures:closed,history:recent};
    }
    if (data.action === 'upload') {
      const encoded=clean(data.base64);
      if(!encoded || encoded.length>5600000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new HttpsError('invalid-argument','請選擇 4 MB 以下的 JPG、PNG 或 WebP 圖片。');
      const assetId=crypto.randomUUID().replaceAll('-','');
      const bytes=Buffer.from(encoded,'base64');
      if(!bytes.length||bytes.length>4*1024*1024)throw new HttpsError('invalid-argument','圖片最多 4 MB。');
      const url=await uploadImage(bytes,assetId);
      await db.collection('teacherAnnouncementImages').doc(assetId).create({actor,url,createdAt:now()});
      return {ok:true,assetId,url};
    }
    if(data.action === 'release') {
      if(!idOk(clean(data.id))) throw new HttpsError('invalid-argument','公告編號不正確。');
      const ref=announcements.doc(data.id);
      return db.runTransaction(async tx=>{
        const snapshot=await tx.get(ref), row=snapshot.data();
        if(!row || row.kind!=='closure') throw new HttpsError('not-found','找不到停課設定。');
        const refs=row.dates.map(d=>db.collection(COLLECTION).doc(d));
        const current=await Promise.all(refs.map(r=>tx.get(r)));
        if(row.released) return {ok:true,duplicate:true};
        current.forEach((s,i)=>{if(s.data()?.announcementId===data.id)tx.set(refs[i],{active:false,releasedBy:actor,releasedAt:now()},{merge:true});});
        tx.update(ref,{released:true,releasedAt:now(),releasedBy:actor});
        return {ok:true,message:'已解除停課。已登記的請假及已取消預約保留，請另行安排。'};
      });
    }
    if(data.action !== 'submit') throw new HttpsError('invalid-argument','不支援的公告操作。');
    const dates=range(data),kind=data.kind;
    if(kind==='closure' && closureOperations && data.schemaVersion!==2)throw new HttpsError('failed-precondition','停課功能已更新，請重新整理頁面後確認課程與預約。');
    const title=clean(data.title),body=clean(data.body),reason=clean(data.reason);
    const requestId=clean(data.requestId),assetId=clean(data.assetId);
    const upgradeIds=Array.isArray(data.upgradeIds)?[...new Set(data.upgradeIds.map(clean))].sort():[];
    if(upgradeIds.length>31 || upgradeIds.some(id=>!idOk(id)) || upgradeIds.length&&kind!=='closure')throw new HttpsError('invalid-argument','舊停課資料不正確，請重新載入。');
    const renterTitle=clean(data.renterTitle),renterBody=clean(data.renterBody),renterAssetId=clean(data.renterAssetId);
    const renterIds=Array.isArray(data.renterIds)?[...new Set(data.renterIds.map(clean))].sort():[];
    const teacherIds=Array.isArray(data.teacherIds)?[...new Set(data.teacherIds.map(clean))].sort():[];
    if(!['closure','notice'].includes(kind)||!idOk(requestId)||!title||title.length>100||!body||body.length>3500||teacherIds.length+renterIds.length>100||(!teacherIds.length&&kind!=='closure')||(kind==='closure'&&(!reason||reason.length>100))||(renterIds.length&&(!renterTitle||renterTitle.length>100||!renterBody||renterBody.length>3500||kind!=='closure'))) throw new HttpsError('invalid-argument','請填寫通知內容，並確認收件名單（最多 100 位）。');
    if(kind==='closure' && dates[0]<dateNow()) throw new HttpsError('invalid-argument','新增停課只能選擇今天或未來日期，避免影響歷史課務。');
    const fingerprint=hash(JSON.stringify({dates,kind,title,body,reason,teacherIds,assetId,renterIds,renterTitle,renterBody,renterAssetId,upgradeIds}));
    const ref=announcements.doc(requestId);
    const prior=await ref.get();
    if(prior.exists){if(prior.data().fingerprint!==fingerprint||prior.data().actor!==actor)throw new HttpsError('already-exists','公告內容已變更，請重新預覽。');return {ok:true,duplicate:true,id:requestId};}
    const [rows,context]=await Promise.all([directory(dates),closureOperations?.inspect(dates)]);
    const selected=teacherIds.map(id=>rows.find(r=>r.teacherId===id)),selectedRenters=renterIds.map(id=>context?.renters.find(r=>r.renterId===id));
    if(data.directoryVersion!==hash(JSON.stringify({rows,closure:context?.signature||''})))throw new HttpsError('aborted','課表、預約或聯絡資料已變更，請重新載入名單後確認。');
    if(selected.some(r=>!r||!r.eligible)) throw new HttpsError('failed-precondition','收件老師或綁定資料有變更，請重新載入名單。');
    if(selectedRenters.some(r=>!r||!r.eligible))throw new HttpsError('failed-precondition','收件客人或聯絡資料有變更，請重新載入名單。');
    async function imageFor(id){
      if(!id)return '';
      if(!idOk(id))throw new HttpsError('invalid-argument','圖片資料不正確。');
      const image=await db.collection('teacherAnnouncementImages').doc(id).get();
      if(!image.exists||image.data().actor!==actor)throw new HttpsError('permission-denied','請重新上傳公告圖片。');
      return image.data().url;
    }
    const [imageUrl,renterImageUrl]=await Promise.all([imageFor(assetId),imageFor(renterAssetId)]);
    const closureRefs=kind==='closure'?dates.map(date=>db.collection(COLLECTION).doc(date)):[];
    return db.runTransaction(async tx=>{
      const [existing,bindings,...closed]=await Promise.all([tx.get(ref),tx.get(db.collection('coursePortalTeacherBindings')),...closureRefs.map(r=>tx.get(r))]);
      if(existing.exists){if(existing.data().fingerprint!==fingerprint||existing.data().actor!==actor)throw new HttpsError('already-exists','公告內容已變更，請重新預覽。');return {ok:true,duplicate:true,id:requestId};}
      if(closed.some(d=>d.data()?.active && (Number(d.data().operationsVersion||1)>=2 || !upgradeIds.includes(d.data().announcementId))))throw new HttpsError('failed-precondition','所選日期已有停課設定，請先查看原設定。');
      const priorAnnouncements=await Promise.all(upgradeIds.map(id=>tx.get(announcements.doc(id))));
      if(priorAnnouncements.some(s=>!s.exists || s.data().kind!=='closure' || s.data().released || !s.data().dates.every(date=>dates.includes(date)) || !closed.some(c=>c.data()?.active && c.data()?.announcementId===s.id)))throw new HttpsError('failed-precondition','請選擇原停課的完整日期範圍後補齊處理。');
      const fresh=recipients(rows.map(r=>({id:r.teacherId,name:r.name})),bindings.docs.map(d=>d.data()),[]);
      if(selected.some(r=>{const x=fresh.find(x=>x.teacherId===r.teacherId);return !x?.eligible||x.targetLineUserId!==r.targetLineUserId||x.targetEmail!==r.targetEmail;}))throw new HttpsError('aborted','老師的通知綁定剛剛更新，請重新預覽。');
      const applyClosure=kind==='closure'&&closureOperations ? await closureOperations.prepare(tx,context,{requestId,reason,actor,extraWrites:closureRefs.length+selected.length+selectedRenters.length+upgradeIds.length+1}) : ()=>{};
      const targets=[...selected.map(r=>({...r,audience:'teacher'})),...selectedRenters.map(r=>({...r,audience:'renter'}))];
      const deliveries=targets.map(r=>({teacherId:r.teacherId||'',renterId:r.renterId||'',audience:r.audience,name:r.name,channel:r.channel,queueId:'teacher-announcement-'+requestId+'-'+hash(r.audience+':'+(r.teacherId||r.renterId)).slice(0,24)}));
      applyClosure();
      closureRefs.forEach((r,i)=>tx.set(r,{date:dates[i],active:true,reason,announcementId:requestId,operationsVersion:closureOperations?2:1,createdAt:now(),createdBy:actor}));
      upgradeIds.forEach(id=>tx.set(announcements.doc(id),{released:true,supersededBy:requestId,releasedAt:now(),releasedBy:actor},{merge:true}));
      targets.forEach((r,i)=>{
        const q=deliveries[i];
        const isRenter=r.audience==='renter',text=personalize(isRenter?renterBody:body,r,dates,r.audience);
        if(text.length>4500)throw new HttpsError('invalid-argument','通知內容加上預約明細後過長，請縮短內容或日期範圍。');
        tx.create(db.collection('notificationQueue').doc(q.queueId),{...recipientFields(r),queueId:q.queueId,targetName:r.name,teacherId:r.teacherId||'',renterId:r.renterId||'',status:'待發送',source:'teacher-announcement',eventCode:isRenter?'renter_closure_announcement':kind==='closure'?'teacher_closure_announcement':'teacher_general_announcement',title:isRenter?renterTitle:title,body:text,lineImageUrl:isRenter?renterImageUrl:imageUrl,announcementId:requestId,createdAt:now(),createdAtText:now().toISOString(),createdBy:actor});
      });
      tx.create(ref,{actor,fingerprint,kind,title,body,reason,dates,imageUrl,renterTitle,renterBody,renterImageUrl,upgradedFrom:upgradeIds,impact:kind==='closure'?context?.impact||null:null,deliveries,createdAt:now(),createdAtText:now().toISOString(),released:false});
      return {ok:true,id:requestId,queued:deliveries.length,message:kind==='closure'?`已停課：${context?.impact.lessonCount||0} 堂請假、${context?.impact.bookingCount||0} 筆預約取消，已建立 ${deliveries.length} 位通知。`:`已建立 ${deliveries.length} 位老師的公告。`};
    });
  };
}
module.exports={createTeacherAnnouncements,recipients,range};
