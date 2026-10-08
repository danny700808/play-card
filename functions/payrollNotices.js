'use strict';
const crypto=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const clean=v=>String(v==null?'':v).trim();
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const money=v=>Number(v).toLocaleString('zh-TW',{maximumFractionDigits:2});
const dateNow=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
function noticeBody(row,month,date){return `${row.name}老師您好：\n\n${month.replace('-',' 年 ')} 月結算批次薪資（含本期應發的補簽，逾期補簽順延）已於 ${date.replaceAll('-','/')} 完成匯款。\n匯款金額：NT$${money(row.amount)}\n\n課堂拆帳、獎勵及扣款明細，請進入老師系統「薪資」查看：\nhttps://danny700808.github.io/play-card/teacher-course-portal.html\n\n請協助確認入帳，如有疑問請聯絡柚子樂器，謝謝。`;}
function payrollTotals(teachers,payroll,adjustments){return teachers.map(t=>{const id=clean(t.id),sum=payroll.filter(r=>r.teacherId===id&&r.active!==false).reduce((n,r)=>n+Number(r.teacherAmount||0),0)+adjustments.filter(r=>r.teacherId===id&&r.active!==false).reduce((n,r)=>n+(['deduction','penalty','late_attendance_fee','attendance_cancellation_fee'].includes(r.type)?-Math.abs(Number(r.amount||0)):Number(r.amount||0)),0);if(!Number.isFinite(sum))throw new HttpsError('failed-precondition','薪資金額不完整，請先核對。');return {teacherId:id,name:clean(t.name),amount:Math.round(sum*100)/100};}).filter(r=>r.teacherId&&r.amount>0);}
function bindingTarget(bindings,teacherId){const lines=[...new Set(bindings.filter(b=>b.teacherId===teacherId&&b.status==='active'&&b.active!==false).map(b=>clean(b.lineUserId)).filter(v=>/^U[0-9a-f]{32}$/i.test(v)))];if(lines.length!==1)return {line:'',reason:lines.length?'LINE 綁定不唯一，請先核對':'尚未綁定 LINE'};const line=lines[0];if(bindings.some(b=>b.teacherId!==teacherId&&b.status==='active'&&b.active!==false&&clean(b.lineUserId)===line))return {line:'',reason:'LINE 帳號與其他老師共用，請先核對'};return {line,reason:''};}
function queueId(month,id){return 'teacher-payroll-paid-'+month+'-'+hash(id);}
function createPayrollNotices({db,loadPayroll,now=()=>Date.now()}){
 const versionRef=db.collection('coursePortalRuntime').doc('scheduleVersion');
 async function readState(month){
  const v1=await versionRef.get();
  const [pay,teachers,bindings,bank]=await Promise.all([loadPayroll(month),db.collection('opsEducationMirrorTeachers').get(),db.collection('coursePortalTeacherBindings').get(),db.collection('coursePayrollTransferSettings').doc('bankAccounts').get()]);
  const v2=await versionRef.get();
  const version=Number(v1.data()?.version||0);if(version!==Number(v2.data()?.version||0))throw new HttpsError('aborted','薪資剛剛更新，請重新預覽。');
  const directory=teachers.docs.filter(d=>d.data().sourceActive!==false).map(d=>{const t=d.data().source||d.data();return {id:clean(t.id||d.id),name:t.name};});
  const bindingRows=bindings.docs.map(d=>d.data()),accounts=bank.data()?.accounts||[];
  const rows=payrollTotals(directory,pay.teacherPayoutPayroll||[],pay.teacherPayoutAdjustments||[]).map(r=>{const target=bindingTarget(bindingRows,r.teacherId),account=accounts.find(x=>x.teacherId===r.teacherId);return {...r,targetLineUserId:target.line,reason:target.reason||(!clean(account?.account)?'未設定銀行帳號，請另行付款':''),bankFingerprint:hash(JSON.stringify(account||{}))};});
  return {rows,version,payout:pay.payout};
 }
 return async function(data,actor){
  if(!actor)throw new HttpsError('permission-denied','請先登入管理者帳號。');
  const month=clean(data.month);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new HttpsError('invalid-argument','請選擇薪資月份。');
  if(data.action==='notice-preview'){
   const date=clean(data.transferDate);if(!validDate(date)||date>dateNow())throw new HttpsError('invalid-argument','請填寫已完成匯款的日期，不能使用未來日期。');
   const state=await readState(month),previewId=crypto.randomUUID(),ref=db.collection('coursePayrollNoticePreviews').doc(previewId);
   const histories=await Promise.all(state.rows.map(r=>db.collection('notificationQueue').doc(queueId(month,r.teacherId)).get()));
   const rows=state.rows.map((r,i)=>({...r,noticeStatus:histories[i].exists?clean(histories[i].data().status)||'已建立通知':'尚未通知',alreadyQueued:histories[i].exists,body:noticeBody(r,month,date)}));
   await ref.create({actor,month,transferDate:date,createdAtMs:now(),rows,version:state.version});
   return {ok:true,previewId,month,payout:state.payout,transferDate:date,rows:rows.map(({targetLineUserId,bankFingerprint,...r})=>({...r,eligible:!r.reason&&!r.alreadyQueued}))};
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
  if(selected.some(r=>{const x=fresh.rows.find(x=>x.teacherId===r.teacherId);return !x||x.reason||x.amount!==r.amount||x.name!==r.name||x.targetLineUserId!==r.targetLineUserId||x.bankFingerprint!==r.bankFingerprint;}))throw new HttpsError('aborted','薪資或收件資料已變更，請重新預覽。');
  const queueRefs=selected.map(r=>db.collection('notificationQueue').doc(queueId(month,r.teacherId)));
  return db.runTransaction(async tx=>{
   const [currentPreview,version,bindings,bank,...queues]=await Promise.all([tx.get(ref),tx.get(versionRef),tx.get(db.collection('coursePortalTeacherBindings')),tx.get(db.collection('coursePayrollTransferSettings').doc('bankAccounts')),...queueRefs.map(q=>tx.get(q))]);
   if(currentPreview.data()?.submitted===true)return {ok:true,duplicate:true,queued:0,message:'這份通知已送出，不會重複建立。'};
   if(Number(version.data()?.version||0)!==fresh.version)throw new HttpsError('aborted','薪資剛剛更新，請重新預覽。');
   if(queues.some(q=>q.exists))throw new HttpsError('already-exists','部分老師本月已有通知，請重新預覽，避免重複發送。');
   const bs=bindings.docs.map(d=>d.data()),accounts=bank.data()?.accounts||[];
   if(selected.some(r=>bindingTarget(bs,r.teacherId).line!==r.targetLineUserId||hash(JSON.stringify(accounts.find(x=>x.teacherId===r.teacherId)||{}))!==r.bankFingerprint))throw new HttpsError('aborted','LINE 或銀行資料已更新，請重新預覽。');
   selected.forEach((r,i)=>tx.create(queueRefs[i],{queueId:queueRefs[i].id,channel:'line',status:'待發送',targetLineUserId:r.targetLineUserId,targetName:r.name,teacherId:r.teacherId,eventCode:'teacher_payroll_transfer_completed',source:'course-payroll-transfer',title:'【柚子樂器｜薪資匯款通知】',body:r.body,emailFallbackEnabled:false,payrollMonth:month,transferDate:preview.transferDate,transferAmount:r.amount,createdAt:new Date(now()),createdAtText:new Date(now()).toISOString(),createdBy:actor,previewId}));
   selected.forEach(r=>tx.create(db.collection('coursePayrollPaidBatches').doc(queueId(month,r.teacherId)),{teacherId:r.teacherId,batchMonth:month,amount:r.amount,transferDate:preview.transferDate,confirmedAt:new Date(now()),confirmedBy:actor,previewId}));
   tx.update(ref,{submitted:true,submittedAtMs:now(),selectedTeacherIds:ids});
   return {ok:true,queued:selected.length,message:`已建立 ${selected.length} 位老師的 LINE 通知，實際送達狀態請重新查詢。`};
  });
 };
}
module.exports={noticeBody,payrollTotals,bindingTarget,createPayrollNotices};
