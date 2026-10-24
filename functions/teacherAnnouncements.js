'use strict';

const crypto = require('node:crypto');
const {HttpsError} = require('firebase-functions/v2/https');
const {COLLECTION, validDate, datesBetween} = require('./courseClosurePolicy');
const {recipientFields} = require('./portalNotificationPolicy');
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

function createTeacherAnnouncements({db,loadSchedule,loadTeachers,uploadImage,now = () => new Date()}) {
  const announcements = db.collection('teacherAnnouncements');
  async function directory(dates) {
    const [teachers,bindings,events] = await Promise.all([loadTeachers(),db.collection('coursePortalTeacherBindings').get(),loadSchedule(dates[0],dates.at(-1))]);
    return recipients(teachers,bindings.docs.map(d=>d.data()),events);
  }
  async function closures(dates) {
    const docs=await Promise.all(dates.map(d=>db.collection(COLLECTION).doc(d).get()));
    return docs.map((d,i)=>({date:dates[i],active:d.data()?.active===true,reason:clean(d.data()?.reason),announcementId:clean(d.data()?.announcementId)}));
  }
  async function history() {
    const docs=await announcements.orderBy('createdAt','desc').limit(30).get();
    return Promise.all(docs.docs.map(async doc=>{
      const r=doc.data();
      const deliveries=await Promise.all((r.deliveries||[]).map(async d=>{
        const q=await db.collection('notificationQueue').doc(d.queueId).get();
        const value=q.data()||{};
        const fallback=value.fallbackQueueId ? await db.collection('notificationQueue').doc(value.fallbackQueueId).get() : null;
        return {teacherId:d.teacherId,name:d.name,channel:fallback?'email':d.channel,status:clean(fallback?.data()?.status || value.status)||'待發送',error:clean(fallback?.data()?.lastError || value.lastError)};
      }));
      return {id:doc.id,title:r.title,body:r.body,kind:r.kind,dates:r.dates,reason:r.reason,imageUrl:r.imageUrl||'',createdAtText:r.createdAtText,released:r.released===true,deliveries};
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
      const [rows,closed,recent]=await Promise.all([directory(dates),closures(dates),history()]);
      return {ok:true,rows:rows.map(publicRecipient),directoryVersion:hash(JSON.stringify(rows)),closures:closed,history:recent};
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
        return {ok:true,message:'已解除停課；尚未建立的未來提醒恢復原規則。恢復上課公告請另行發送。'};
      });
    }
    if(data.action !== 'submit') throw new HttpsError('invalid-argument','不支援的公告操作。');
    const dates=range(data),kind=data.kind;
    const title=clean(data.title),body=clean(data.body),reason=clean(data.reason);
    const requestId=clean(data.requestId),assetId=clean(data.assetId);
    const teacherIds=Array.isArray(data.teacherIds)?[...new Set(data.teacherIds.map(clean))].sort():[];
    if(!['closure','notice'].includes(kind)||!idOk(requestId)||!title||title.length>100||!body||body.length>3500||teacherIds.length>100||(!teacherIds.length&&kind!=='closure')||(kind==='closure'&&(!reason||reason.length>100))) throw new HttpsError('invalid-argument','請填寫標題與內容，並確認日期及收件老師（最多 100 位）。');
    if(kind==='closure' && dates[0]<dateNow()) throw new HttpsError('invalid-argument','新增停課只能選擇今天或未來日期，避免影響歷史課務。');
    const fingerprint=hash(JSON.stringify({dates,kind,title,body,reason,teacherIds,assetId}));
    const ref=announcements.doc(requestId);
    const prior=await ref.get();
    if(prior.exists){if(prior.data().fingerprint!==fingerprint||prior.data().actor!==actor)throw new HttpsError('already-exists','公告內容已變更，請重新預覽。');return {ok:true,duplicate:true,id:requestId};}
    const rows=await directory(dates),selected=teacherIds.map(id=>rows.find(r=>r.teacherId===id));
    if(data.directoryVersion!==hash(JSON.stringify(rows)))throw new HttpsError('aborted','課表或老師聯絡資料已變更，請重新載入名單後確認。');
    if(selected.some(r=>!r||!r.eligible)) throw new HttpsError('failed-precondition','收件老師或綁定資料有變更，請重新載入名單。');
    let imageUrl='';
    if(assetId){
      if(!idOk(assetId))throw new HttpsError('invalid-argument','圖片資料不正確。');
      const image=await db.collection('teacherAnnouncementImages').doc(assetId).get();
      if(!image.exists||image.data().actor!==actor)throw new HttpsError('permission-denied','請重新上傳公告圖片。');
      imageUrl=image.data().url;
    }
    const closureRefs=kind==='closure'?dates.map(date=>db.collection(COLLECTION).doc(date)):[];
    return db.runTransaction(async tx=>{
      const [existing,bindings,...closed]=await Promise.all([tx.get(ref),tx.get(db.collection('coursePortalTeacherBindings')),...closureRefs.map(r=>tx.get(r))]);
      if(existing.exists){if(existing.data().fingerprint!==fingerprint||existing.data().actor!==actor)throw new HttpsError('already-exists','公告內容已變更，請重新預覽。');return {ok:true,duplicate:true,id:requestId};}
      if(closed.some(d=>d.data()?.active))throw new HttpsError('failed-precondition','所選日期已有停課設定，請先查看或解除原設定。');
      const fresh=recipients(rows.map(r=>({id:r.teacherId,name:r.name})),bindings.docs.map(d=>d.data()),[]);
      if(selected.some(r=>{const x=fresh.find(x=>x.teacherId===r.teacherId);return !x?.eligible||x.targetLineUserId!==r.targetLineUserId||x.targetEmail!==r.targetEmail;}))throw new HttpsError('aborted','老師的通知綁定剛剛更新，請重新預覽。');
      const deliveries=selected.map(r=>({teacherId:r.teacherId,name:r.name,channel:r.channel,queueId:'teacher-announcement-'+requestId+'-'+hash(r.teacherId).slice(0,24)}));
      closureRefs.forEach((r,i)=>tx.set(r,{date:dates[i],active:true,reason,announcementId:requestId,createdAt:now(),createdBy:actor}));
      selected.forEach((r,i)=>{
        const q=deliveries[i];
        tx.create(db.collection('notificationQueue').doc(q.queueId),{...recipientFields(r),queueId:q.queueId,targetName:r.name,teacherId:r.teacherId,status:'待發送',source:'teacher-announcement',eventCode:kind==='closure'?'teacher_closure_announcement':'teacher_general_announcement',title,body,lineImageUrl:imageUrl,announcementId:requestId,createdAt:now(),createdAtText:now().toISOString(),createdBy:actor});
      });
      tx.create(ref,{actor,fingerprint,kind,title,body,reason,dates,imageUrl,deliveries,createdAt:now(),createdAtText:now().toISOString(),released:false});
      return {ok:true,id:requestId,queued:deliveries.length,message:kind==='closure'?`停課設定已生效；已建立 ${deliveries.length} 位老師的公告。`:`已建立 ${deliveries.length} 位老師的公告。`};
    });
  };
}
module.exports={createTeacherAnnouncements,recipients,range};
