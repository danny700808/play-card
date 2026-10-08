'use strict';
const crypto=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const clean=v=>String(v==null?'':v).trim();
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const money=v=>Number(v).toLocaleString('zh-TW',{maximumFractionDigits:2});
const dateNow=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
function noticeBody(row,month,date){
 const [year,m]=month.split('-');
 const reminders=(row.lateReminders||[]).map(r=>`・${r.lessonDate.replaceAll('-','/')} 課程：${r.signedDate.replaceAll('-','/')} 補登，預計 ${r.expectedPayDate.replaceAll('-','/')} 發放。`);
 return `${row.name}老師您好：\n\n${year} 年 ${Number(m)} 月薪資已於 ${date.replaceAll('-','/')} 完成匯款。\n匯款金額：NT$${money(row.amount)}\n實際入帳時間依銀行作業為準，請留意帳戶入帳情形。\n\n課堂拆帳、獎勵及扣款明細，請至老師系統「薪資」查看。${reminders.length?'\n\n補簽發放提醒：\n'+reminders.join('\n'):''}\n\n如有疑問，請聯絡柚子樂器。`;
}
function lateReminders(pay,teacherId){
 const rows=[...(pay.teacherPayroll||[]),...(pay.teacherPayoutPayroll||[])];
 return [...new Map(rows.filter(r=>r.teacherId===teacherId&&r.active!==false&&!['cancelled','superseded'].includes(r.status)&&r.attendanceSignedAt&&r.expectedPayDate).map(r=>{const x={lessonDate:clean(r.lessonDate||r.date),signedDate:clean(r.attendanceSignedAt).slice(0,10),expectedPayDate:r.expectedPayDate};return [JSON.stringify(x),x];})).values()].sort((a,b)=>a.expectedPayDate.localeCompare(b.expectedPayDate)||a.lessonDate.localeCompare(b.lessonDate));
}
function payrollTotals(teachers,payroll,adjustments){return teachers.map(t=>{const id=clean(t.id),sum=payroll.filter(r=>r.teacherId===id&&r.active!==false).reduce((n,r)=>n+Number(r.teacherAmount||0),0)+adjustments.filter(r=>r.teacherId===id&&r.active!==false).reduce((n,r)=>n+(['deduction','penalty','late_attendance_fee','attendance_cancellation_fee'].includes(r.type)?-Math.abs(Number(r.amount||0)):Number(r.amount||0)),0);if(!Number.isFinite(sum))throw new HttpsError('failed-precondition','薪資金額不完整，請先核對。');return {teacherId:id,name:clean(t.name),amount:Math.round(sum*100)/100};}).filter(r=>r.teacherId&&r.amount>0);}
function bindingTarget(bindings,teacherId){const lines=[...new Set(bindings.filter(b=>b.teacherId===teacherId&&b.status==='active'&&b.active!==false).map(b=>clean(b.lineUserId)).filter(v=>/^U[0-9a-f]{32}$/i.test(v)))];if(lines.length!==1)return {line:'',reason:lines.length?'LINE 綁定不唯一，請先核對':'尚未綁定 LINE'};const line=lines[0];if(bindings.some(b=>b.teacherId!==teacherId&&b.status==='active'&&b.active!==false&&clean(b.lineUserId)===line))return {line:'',reason:'LINE 帳號與其他老師共用，請先核對'};return {line,reason:''};}
function profileId(id){return 'EXTP_'+hash('course-portal-profile-v2:'+id).slice(0,24);}
function emailTarget(profile){const v=clean(profile?.email||profile?.Email||profile?.contactEmail).toLowerCase();return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)&&v.length<=254?v:'';}
function queueId(month,id){return 'teacher-payroll-paid-'+month+'-'+hash(id);}
function createPayrollNotices({db,loadPayroll,now=()=>Date.now()}){
 const versionRef=db.collection('coursePortalRuntime').doc('scheduleVersion');
 async function readState(month){
  const v1=await versionRef.get();
  const [pay,teachers,bindings,bank,profiles]=await Promise.all([loadPayroll(month),db.collection('opsEducationMirrorTeachers').get(),db.collection('coursePortalTeacherBindings').get(),db.collection('coursePayrollTransferSettings').doc('bankAccounts').get(),db.collection('teacherPrivateProfiles').get()]);
  const v2=await versionRef.get();
  const version=Number(v1.data()?.version||0);if(version!==Number(v2.data()?.version||0))throw new HttpsError('aborted','薪資剛剛更新，請重新預覽。');
  const directory=teachers.docs.filter(d=>d.data().sourceActive!==false).map(d=>{const t=d.data().source||d.data();return {id:clean(t.id||d.id),name:t.name};});
  const bindingRows=bindings.docs.map(d=>d.data()),accounts=bank.data()?.accounts||[];
  const profileRows=new Map(profiles.docs.map(d=>[d.id,d.data()]));
  const rows=payrollTotals(directory,pay.teacherPayoutPayroll||[],pay.teacherPayoutAdjustments||[]).map(r=>{
   const target=bindingTarget(bindingRows,r.teacherId),account=accounts.find(x=>x.teacherId===r.teacherId),targetEmail=emailTarget(profileRows.get(profileId(r.teacherId)));
   return {...r,lateReminders:lateReminders(pay,r.teacherId),targetLineUserId:target.line,targetEmail,
    reason:!target.line&&!targetEmail?'未綁定 LINE 且未設定有效 Email':(!clean(account?.account)?'未設定銀行帳號，請另行付款':''),
    channelHint:[target.line?'LINE':'',targetEmail?'Email':''].filter(Boolean).join('＋'),bankFingerprint:hash(JSON.stringify(account||{}))};
  });
  return {rows,version,payout:pay.payout};
 }
 return async function(data,actor){
  if(!actor)throw new HttpsError('permission-denied','請先登入管理者帳號。');
  const month=clean(data.month);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new HttpsError('invalid-argument','請選擇薪資月份。');
  if(data.action==='notice-preview'){
   const date=clean(data.transferDate);if(!validDate(date)||date>dateNow())throw new HttpsError('invalid-argument','請填寫已完成匯款的日期，不能使用未來日期。');
   const state=await readState(month),previewId=crypto.randomUUID(),ref=db.collection('coursePayrollNoticePreviews').doc(previewId);
   const histories=await Promise.all(state.rows.map(async r=>{const id=queueId(month,r.teacherId);return Promise.all([db.collection('notificationQueue').doc(id).get(),db.collection('notificationQueue').doc(id+'-email').get(),db.collection('coursePayrollPaidBatches').doc(id).get()]);}));
   const rows=state.rows.map((r,i)=>{
    const [line,email,paid]=histories[i],pendingChannels=[];
    if(r.targetLineUserId&&!line.exists)pendingChannels.push('line');
    if(r.targetEmail&&!email.exists)pendingChannels.push('email');
    const prior=paid.data(),actualDate=prior?.transferDate||date;
    const reason=r.reason||(prior&&prior.amount!==r.amount?'已匯款金額與目前薪資不同，請先核對':'');
    return {...r,reason,pendingChannels,transferDate:actualDate,noticeStatus:[r.targetLineUserId?'LINE：'+(line.exists?clean(line.data().status)||'已建立':'尚未通知'):'',r.targetEmail?'Email：'+(email.exists?clean(email.data().status)||'已建立':'尚未通知'):''].filter(Boolean).join('；'),alreadyQueued:pendingChannels.length===0,body:noticeBody(r,month,actualDate)};
   });
   await ref.create({actor,month,transferDate:date,createdAtMs:now(),rows,version:state.version});
   return {ok:true,previewId,month,payout:state.payout,transferDate:date,rows:rows.map(({targetLineUserId,targetEmail,bankFingerprint,...r})=>({...r,eligible:!r.reason&&!r.alreadyQueued}))};
  }
  if(data.action!=='notice-send'||data.confirmedTransferred!==true)throw new HttpsError('invalid-argument','請先確認已完成匯款。');
  const previewId=clean(data.previewId);if(!/^[a-f0-9-]{36}$/.test(previewId))throw new HttpsError('invalid-argument','請重新預覽通知。');
  const ref=db.collection('coursePayrollNoticePreviews').doc(previewId),snapshot=await ref.get(),preview=snapshot.data();
  if(!snapshot.exists||preview.actor!==actor||preview.month!==month||now()-preview.createdAtMs>30*60*1000)throw new HttpsError('failed-precondition','預覽已失效，請重新確認名單。');
  const ids=Array.isArray(data.teacherIds)?[...new Set(data.teacherIds.map(clean))]:[];
  if(!ids.length||ids.length>100)throw new HttpsError('invalid-argument','請勾選 1 至 100 位已匯款老師。');
  const selected=ids.map(id=>preview.rows.find(r=>r.teacherId===id));
  if(selected.some(r=>!r||r.reason||r.alreadyQueued))throw new HttpsError('failed-precondition','名單包含無法通知或已通知的老師，請重新預覽。');
  const fresh=await readState(month);
  if(selected.some(r=>{const x=fresh.rows.find(x=>x.teacherId===r.teacherId);return !x||x.reason||x.amount!==r.amount||x.name!==r.name||x.targetLineUserId!==r.targetLineUserId||x.targetEmail!==r.targetEmail||JSON.stringify(x.lateReminders)!==JSON.stringify(r.lateReminders)||x.bankFingerprint!==r.bankFingerprint;}))throw new HttpsError('aborted','薪資或收件資料已變更，請重新預覽。');
  // Keep the original LINE queue ID, so notices created before dual delivery stay deduplicated.
  const deliveries=selected.flatMap(r=>r.pendingChannels.map(channel=>({row:r,channel,ref:db.collection('notificationQueue').doc(queueId(month,r.teacherId)+(channel==='email'?'-email':''))})));
  return db.runTransaction(async tx=>{
   const [currentPreview,version,bindings,bank,profiles,...existing]=await Promise.all([tx.get(ref),tx.get(versionRef),tx.get(db.collection('coursePortalTeacherBindings')),tx.get(db.collection('coursePayrollTransferSettings').doc('bankAccounts')),tx.get(db.collection('teacherPrivateProfiles')),...deliveries.map(d=>tx.get(d.ref)),...selected.map(r=>tx.get(db.collection('coursePayrollPaidBatches').doc(queueId(month,r.teacherId))))]);
   if(currentPreview.data()?.submitted===true)return {ok:true,duplicate:true,queued:0,message:'這份通知已送出，不會重複建立。'};
   if(Number(version.data()?.version||0)!==fresh.version)throw new HttpsError('aborted','薪資剛剛更新，請重新預覽。');
   if(existing.slice(0,deliveries.length).some(q=>q.exists))throw new HttpsError('already-exists','部分通知已建立，請重新預覽，避免重複發送。');
   const bs=bindings.docs.map(d=>d.data()),accounts=bank.data()?.accounts||[],ps=new Map(profiles.docs.map(d=>[d.id,d.data()]));
   if(selected.some(r=>bindingTarget(bs,r.teacherId).line!==r.targetLineUserId||emailTarget(ps.get(profileId(r.teacherId)))!==r.targetEmail||hash(JSON.stringify(accounts.find(x=>x.teacherId===r.teacherId)||{}))!==r.bankFingerprint))throw new HttpsError('aborted','LINE、Email 或銀行資料已更新，請重新預覽。');
   const paid=existing.slice(deliveries.length);
   if(selected.some((r,i)=>paid[i].exists&&(paid[i].data().amount!==r.amount||paid[i].data().transferDate!==r.transferDate)))throw new HttpsError('aborted','匯款紀錄已更新，請重新預覽。');
   deliveries.forEach(({row:r,channel,ref:q})=>tx.create(q,{queueId:q.id,channel,status:'待發送',...(channel==='line'?{targetLineUserId:r.targetLineUserId}:{targetEmail:r.targetEmail}),targetName:r.name,teacherId:r.teacherId,eventCode:'teacher_payroll_transfer_completed',source:'course-payroll-transfer',title:'【柚子樂器｜薪資匯款通知】',body:r.body,emailFallbackEnabled:false,payrollMonth:month,transferDate:r.transferDate,transferAmount:r.amount,createdAt:new Date(now()),createdAtText:new Date(now()).toISOString(),createdBy:actor,previewId}));
   selected.forEach((r,i)=>{if(!paid[i].exists)tx.create(db.collection('coursePayrollPaidBatches').doc(queueId(month,r.teacherId)),{teacherId:r.teacherId,batchMonth:month,amount:r.amount,transferDate:r.transferDate,confirmedAt:new Date(now()),confirmedBy:actor,previewId});});
   tx.update(ref,{submitted:true,submittedAtMs:now(),selectedTeacherIds:ids});
   return {ok:true,queued:deliveries.length,teachers:selected.length,message:`已建立 ${selected.length} 位老師、共 ${deliveries.length} 則通知（依可用 LINE／Email 發送），實際送達狀態請重新查詢。`};
  });
 };
}
module.exports={noticeBody,lateReminders,payrollTotals,bindingTarget,profileId,emailTarget,createPayrollNotices};
