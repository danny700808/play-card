'use strict';
const crypto=require('crypto'),{HttpsError}=require('firebase-functions/v2/https');
const confirmationMessage=require('./enrollmentConfirmationMessage');
const clean=v=>String(v??'').trim(),hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const fail=(message,code='failed-precondition')=>{throw new HttpsError(code,message);};
const planView=p=>({id:clean(p?.id),name:clean(p?.name),amount:Number(p?.amount),lessonCount:Number(p?.lessonCount),splitType:clean(p?.splitType),splitValue:Number(p?.splitValue||0)});
const samePlan=(a,b)=>JSON.stringify(planView(a))===JSON.stringify(planView(b));
function normalizeDraft(value={}){
 const d={subjectId:clean(value.subjectId),teacherId:clean(value.teacherId),roomId:clean(value.roomId),planId:clean(value.planId),date:clean(value.date),time:clean(value.time),duration:Number(value.duration||60),frequency:clean(value.frequency||'weekly'),note:clean(value.note),studentMessageNote:clean(value.studentMessageNote),studentIds:Array.isArray(value.studentIds)?value.studentIds.map(clean):[],halfHourAcknowledged:value.halfHourAcknowledged===true};
 if([d.subjectId,d.teacherId,d.roomId,d.planId,...d.studentIds].some(v=>v&&!/^[\w-]{1,130}$/.test(v))||d.studentIds.length>2||d.note.length>1000||d.studentMessageNote.length>500||![30,60,90,120].includes(d.duration)||!['weekly','biweekly'].includes(d.frequency))fail('排課資料格式無效。');
 if(d.date&&(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isFinite(Date.parse(d.date+'T12:00:00+08:00'))||new Date(d.date+'T12:00:00+08:00').toISOString().slice(0,10)!==d.date))fail('請確認開始上課日期。');
 if(d.time&&!/^([01]\d|2[0-3]):(00|30)$/.test(d.time))fail('請以整點或半點選擇上課時間。');
 return d;
}
function createEnrollmentScheduling({db,scheduler,matches,now=Date.now,stamp=()=>Date.now()}){
 async function run(data,row,actor){
  if(!scheduler)fail('排課服務尚未就緒。');
  const ref=db.collection('onlineEnrollmentSubmissions').doc(data.id);
  if(data.action==='scheduleOptions'){
   const {groups,...catalog}=await scheduler.context();return {catalog};
  }
  if(row.schedule){if(data.action==='confirmSchedule')return {ok:true,duplicate:true,schedule:row.schedule};fail('這份報名已排課，後續調整請到正式課表操作。');}
  if(row.status==='closed')fail('這份報名已結案，請先將處理狀態改回待聯絡。');
  if(!row.consent?.verifiedAt||!/^U[a-f0-9]{32}$/i.test(row.line?.lineUserId||''))fail('學生尚未完成 LINE 同意與驗證。');
  const draft=normalizeDraft(data.draft),names=[row.form.name,...(row.form.secondName?[row.form.secondName]:[])];
  if(data.action==='saveScheduleDraft'){
   await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(current?.version!==data.version||current.schedule)fail('資料已更新，請重新開啟這筆報名。','aborted');tx.update(ref,{scheduleDraft:draft,version:current.version+1,updatedAt:now(),updatedBy:actor});});
   return {ok:true};
  }
  if(data.action!=='confirmSchedule')fail('不支援的排課操作。');
  if(data.confirmedWithStudent!==true)fail('請先確認已與學生確認正式上課安排。');
  if(!draft.date||!draft.time||Date.parse(draft.date+'T'+draft.time+':00+08:00')<=now())fail('請選擇尚未開始的上課日期與時間。');
  const context=await scheduler.context(),subject=context.subjects.find(s=>s.id===draft.subjectId),teacher=context.teachers.find(t=>t.id===draft.teacherId),room=context.rooms.find(r=>r.id===draft.roomId),plan=context.feePlans.find(p=>p.id===draft.planId&&p.subjectId===draft.subjectId);
  if(!subject||!teacher||!room||!plan)fail('請選擇有效的科目、老師、教室及收費方案。');
  if(!teacher.subjectIds.includes(subject.id))fail('老師沒有此科目的授課設定，請重新選擇。');
  if(!room.subjectIds.includes(subject.id))fail('教室不適合所選科目，請重新選擇。');
  if(!data.expectedPlan||!samePlan(plan,data.expectedPlan))fail('收費方案已變更，請重新開啟報名資料確認金額及分成。');
  if(draft.duration===30&&!draft.halfHourAcknowledged)fail('請先確認 30 分鐘課程的後續補足安排。');
  const candidates=await matches(row),selected=row.studentIds?.length?row.studentIds:draft.studentIds;
  if(selected.length!==names.length)fail('請確認每位學生的建檔方式。');
  if(row.studentIds?.length&&JSON.stringify(draft.studentIds)!==JSON.stringify(row.studentIds))fail('已建檔學生不可在排課時換成其他人。');
  const newIds=new Set(),ids=selected.map((v,n)=>{if(v==='new'){const sid='online-'+data.id+'-'+(n+1);newIds.add(sid);return sid;}if(!row.studentIds?.includes(v)&&!candidates.some(c=>c.id===v))fail('請核對學生資料，或選擇建立新學生。');return v;});
  if(new Set(ids).size!==ids.length)fail('兩位學生不能選擇同一份資料。');
  const phones=[row.form.phone,row.form.secondPhone||''];
  const profiles=await Promise.all(ids.map(async sid=>({id:sid,data:(await db.collection('coursePortalStudentProfiles').doc(sid).get()).data()})));
  const groups=context.groups||[],linked=groups.filter(g=>g.active!==false&&(g.memberIds||[]).some(sid=>ids.includes(sid)));
  let group=null,createGroup=false;
  if(linked.length){if(ids.length!==2||linked.length!==1||linked[0].memberIds.length!==2||!linked[0].memberIds.every(sid=>ids.includes(sid)))fail('所選學生目前已有其他雙人班分組，請先到課務確認分組。');group=linked[0];}
  else if(ids.length===2){
   if(profiles.some(p=>!newIds.has(p.id)&&p.data?.enrollmentId!==data.id))fail('既有學生的雙人班請先在課務確認分組，再回這裡排課，避免影響原有課程。');
   group={id:ids[0],name:names.join('－'),memberIds:ids,memberNames:names,memberPhones:phones,startDate:draft.date,active:true};createGroup=true;
  }
  const scheduleStudentId=group?.id||ids[0],operationId='online-enrollment-'+hash(data.id).slice(0,32),courseId='manager-'+operationId;
  const virtualStudents=ids.flatMap((sid,n)=>newIds.has(sid)?[{id:sid,name:names[n],phone:phones[n],active:true,managerCreated:true}]:[]);
  if(group)virtualStudents.push({id:group.id,name:group.name,memberIds:group.memberIds,memberNames:group.memberNames,memberPhones:group.memberPhones,active:true});
  let savedSchedule;
  const request={operationId,event:{date:draft.date,start:draft.time,duration:draft.duration,frequency:draft.frequency,type:'fixed',roomId:draft.roomId,teacherId:draft.teacherId,subjectId:draft.subjectId,studentIds:[scheduleStudentId],note:draft.note,halfHourAcknowledged:draft.halfHourAcknowledged},enrollment:{planId:draft.planId}};
  await scheduler.commit(request,{virtualStudents,conflictStudentIds:ids,requireTeacherSubject:true,prepare:async(tx,result)=>{
   const current=(await tx.get(ref)).data();
   if(current?.version!==data.version||current.schedule||current.status==='closed')fail('報名資料已更新，請重新開啟後再排課。','aborted');
   if(!samePlan(result.tuitionPeriod?.planSnapshot,plan))fail('收費方案剛剛有變更，請重新確認後再排課。');
   const studentRefs=ids.map(sid=>db.collection('coursePortalStudentProfiles').doc(sid)),studentSnapshots=await Promise.all(studentRefs.map(r=>tx.get(r)));
   const bindingRefs=ids.map(sid=>db.collection('coursePortalStudentBindings').doc(hash('enrollment|'+sid+'|'+row.line.lineUserId))),bindingSnapshots=await Promise.all(bindingRefs.map(r=>tx.get(r)));
   if(bindingSnapshots.some(s=>s.exists&&s.data().status!=='active'))fail('此學生的 LINE 綁定曾停用，請先到綁定管理確認。');
   for(let n=0;n<ids.length;n++){if(newIds.has(ids[n])&&studentSnapshots[n].exists)fail('學生資料已建立，請重新開啟報名資料。');if(studentSnapshots[n].data()?.active===false||studentSnapshots[n].data()?.studentActive===false)fail('學生資料已停用，請先核對。');}
   const groupRef=createGroup?db.collection('coursePortalStudentGroups').doc(group.id):null;
   if(groupRef){
    if((await tx.get(groupRef)).exists)fail('雙人班分組已更新，請重新開啟。','aborted');
    for(const sid of ids.filter(s=>!newIds.has(s))){
     const periods=await tx.get(db.collection('coursePortalTuitionPeriods').where('studentId','==',sid)),courses=await tx.get(db.collection('coursePortalFixedCourses').where('studentIds','array-contains',sid));
     if(periods.docs.length||courses.docs.length)fail('學生已另有課程紀錄，請先在課務確認雙人班分組。');
    }
   }
   savedSchedule={courseId:result.id,tuitionPeriodId:result.tuitionPeriod.id,studentIds:ids,studentNames:names,scheduleStudentId,subjectId:subject.id,subjectName:subject.name,teacherId:teacher.id,teacherName:teacher.name,roomId:room.id,roomName:room.name,date:draft.date,time:draft.time,endTime:result.event.endTime,duration:draft.duration,frequency:draft.frequency,plan:planView(result.tuitionPeriod.planSnapshot),confirmedWithStudentAt:now(),confirmedAt:now(),confirmedBy:actor,note:draft.note,studentMessageNote:draft.studentMessageNote};
   const body=confirmationMessage(savedSchedule,current.form);
   if(data.expectedMessage!==body)fail('排課資料或通知內容已變更，請重新確認訊息預覽後再送出。');
   if(current.line.lineUserId!==row.line.lineUserId)fail('報名者 LINE 身分已變更，請重新開啟資料。','aborted');
   const queueId='enrollment-confirmed-'+data.id,queueRef=db.collection('notificationQueue').doc(queueId);
   if((await tx.get(queueRef)).exists)fail('報名確認通知已建立，請重新開啟確認排課結果。','aborted');
   const confirmationNotification={queueId,body,queuedAt:now()};
   return write=>{
    ids.forEach((sid,n)=>{
     if(newIds.has(sid))write.create(studentRefs[n],{id:sid,name:names[n],phone:phones[n],email:row.form.email,active:true,studentActive:true,managerCreated:true,managerNote:'由線上報名確認排課',enrollmentId:data.id,updatedAt:stamp(),updatedBy:actor});
     if(!bindingSnapshots[n].exists)write.create(bindingRefs[n],{id:bindingRefs[n].id,type:'student',studentId:sid,targetId:sid,targetName:names[n],name:names[n],phone:phones[n],email:row.form.email,status:'active',method:'line',lineUserId:row.line.lineUserId,lineDisplayName:row.line.lineDisplayName,lineFriendFlag:row.line.lineFriendFlag,authAccountId:hash('line-account|student|'+row.line.lineUserId),approvedAt:stamp(),approvedBy:actor,sourceEnrollmentId:data.id,createdAt:stamp()});
    });
    if(groupRef)write.create(groupRef,{...group,sourceCourseIds:[courseId],updatedAt:stamp(),createdBy:actor});
    write.create(queueRef,{queueId,channel:'line',status:'待發送',source:'online-enrollment-confirmed',eventCode:'online_enrollment_confirmed',targetLineUserId:current.line.lineUserId,targetName:names.join('、'),title:'柚子樂器｜報名確認',body,lineText:body,emailFallbackEnabled:false,enrollmentId:data.id,courseId:result.id,createdAt:stamp(),createdBy:actor});
    write.update(ref,{studentIds:ids,schedule:savedSchedule,scheduleDraft:{...draft,studentIds:ids},confirmationNotification,status:'scheduled',version:current.version+1,updatedAt:now(),updatedBy:actor});
   };
  }});
  const final=(await ref.get()).data();if(!final?.schedule)fail('排課結果需要重新確認，請重新開啟這筆報名。');
  return {ok:true,schedule:final.schedule};
 }
 return {run};
}
module.exports={createEnrollmentScheduling,normalizeDraft,planView};
