'use strict';
const crypto=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {createScheduleComputer,localDateKey,timeText,minutes,clean,truthy}=require('./employeeAttendanceSchedule');
const {accountStatus,isManager}=require('./employeeAuth');
const COMPANY_IP='125.229.190.123';
const SOURCE='employee-attendance-reminder-v1';
const URL='https://danny700808.github.io/play-card/login.html?next=dashboard.html';
const collections=['singleDaySchedules','employeeSchedules','scheduleTemplates','leaveRequests','clockRecords','temporaryAttendanceRequests'];
const idOf=r=>clean(r.employeeId||r['員工ID']||r.__id);
function active(row){return ['active','enabled','啟用','是'].includes(accountStatus(row))&&row.active!==false&&!row.personDeleted&&!row.hiddenFromActiveLists&&!['resigned','disabled','archived','deleted','suspended'].includes(clean(row.employmentStatus||row.workStatus).toLowerCase());}
function requestIp(request){
  // Use the rightmost public client hop appended by the platform, never body.clientIp
  // or the spoofable first entry. Private/GFE proxy hops do not identify the client.
  const raw=request.rawRequest||{},forwarded=clean(raw.headers&&raw.headers['x-forwarded-for']);
  const ips=(forwarded?forwarded.split(','):[raw.ip||raw.socket?.remoteAddress]).map(v=>clean(v).replace(/^::ffff:/,''));
  return ips.filter(ip=>ip&&!/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|35\.191\.|130\.211\.[0-3]\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip)).at(-1)||'';
}
function networkCheck(request,action='上班打卡'){
  const ip=requestIp(request);
  if(action==='上班打卡'&&ip!==COMPANY_IP)throw new HttpsError('failed-precondition','上班打卡必須連接公司 Wi-Fi，請關閉行動網路並連接公司 Wi-Fi 後再試。');
  return ip;
}
function hash(s){return crypto.createHash('sha256').update(s).digest('hex').slice(0,32);}
function reminderPlans(info,now){
  const rows=[];
  for(const s of info.schedules||[]){
    if(s.attendanceSatisfiedByTemporary)continue;
    const start=Date.parse(info.date+'T'+s.startTime+':00+08:00'),end=Date.parse(info.date+'T'+s.endTime+':00+08:00');
    for(const [kind,due,action,done] of [['in',start-600000,'上班打卡',s.hasClockIn],['out',end,'下班打卡',s.hasClockOut],['out-followup',end+3600000,'下班打卡',s.hasClockOut]]){
      if(done||now.getTime()<due||now.getTime()>=due+5*60000)continue;
      const boundary=kind==='in'?minutes(s.startTime):minutes(s.endTime);
      if((s.approvedTemporaryAttendanceBlocks||[]).some(b=>kind==='in'?b.start<=boundary&&b.end>boundary:b.start<boundary&&b.end>=boundary))continue;
      rows.push({kind,due,action,scheduleKey:s.scheduleKey,date:info.date,startTime:s.startTime,endTime:s.endTime});
    }
  }
  return rows;
}
function createEmployeeAttendance({db,FieldValue,now=()=>new Date()}){
  async function snapshot(employeeId,templates){
    const result={};
    await Promise.all(collections.map(async col=>{
      if(col==='scheduleTemplates'){result[col]=templates||(await db.collection(col).get()).docs.map(d=>({__id:d.id,...d.data()}));return;}
      const chunks=await Promise.all(['employeeId','員工ID','userId'].map(key=>db.collection(col).where(key,'==',employeeId).get()));
      result[col]=[...new Map(chunks.flatMap(s=>s.docs).map(d=>[d.id,{__id:d.id,...d.data()}])).values()];
    }));
    return result;
  }
  async function clock(payload,request,user){
    if(!active(user))throw new HttpsError('permission-denied','人員目前未啟用，無法打卡。');
    const action=clean(payload.actionName);
    if(!['上班打卡','下班打卡'].includes(action)||clean(payload.clockType||'標準打卡')!=='標準打卡'||payload.isSupplement)throw new HttpsError('invalid-argument','補打卡與特殊打卡請使用主管審核申請。');
    const ip=networkCheck(request,action),at=now(),date=localDateKey(at),clockTime=timeText(at),employeeId=user.employeeId;
    const data=await snapshot(employeeId),info=await createScheduleComputer(data,at).day(user,date);
    const s=info.schedules.find(s=>s.scheduleKey===clean(payload.scheduleKey));
    if(!s||s.attendanceSatisfiedByTemporary)throw new HttpsError('failed-precondition','班表已變更或不需要打卡，請重新整理。');
    const isIn=action==='上班打卡';
    if(isIn&&minutes(clockTime)<Math.max(0,minutes(s.startTime)-60))throw new HttpsError('failed-precondition','尚未到這個班段的上班打卡時間。');
    if(!isIn&&!s.hasClockIn)throw new HttpsError('failed-precondition','請先完成上班打卡；漏打請送補打卡申請。');
    if(isIn?s.hasClockIn:s.hasClockOut)throw new HttpsError('already-exists','這個班段已完成此項打卡。');
    const late=isIn?Math.max(0,minutes(clockTime)-minutes(s.startTime)):0,early=isIn?0:Math.max(0,minutes(s.endTime)-minutes(clockTime));
    const status=late?'遲到':early?'早退':'正常',recordId='CLK_SEC_'+hash(employeeId+'|'+s.scheduleKey+'|'+action),ref=db.collection('clockRecords').doc(recordId);
    await db.runTransaction(async tx=>{
      if((await tx.get(ref)).exists)throw new HttpsError('already-exists','這個班段已完成此項打卡。');
      tx.create(ref,{recordId,employeeId,name:user.name||'',email:user.email||'',clockDate:date,clockTime,actionName:action,clockType:'標準打卡',status,lateMinutes:late,finalLateMinutes:late,earlyLeaveMinutes:early,
        note:clean(payload.note).slice(0,500),sourceIp:ip,networkVerified:isIn,isSupplement:false,scheduleLinked:true,scheduleKey:s.scheduleKey,effectiveSegmentKey:s.scheduleKey,originalScheduleKey:s.originalScheduleKey,
        scheduleDate:date,scheduleId:s.id||'',scheduleSource:s.source||'',scheduleStartTime:s.startTime,scheduleEndTime:s.endTime,originalScheduleStartTime:s.originalStartTime,originalScheduleEndTime:s.originalEndTime,
        source:'protected-employee-clock-v1',createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
    });
    return {ok:true,recordId,clockTime,lateMinutes:late,earlyLeaveMinutes:early,message:action+'成功'+(late?'，遲到 '+late+' 分鐘':early?'，早退 '+early+' 分鐘':''),usedSchedule:s};
  }
  async function run({dryRun=false,at=now()}={}){
    const config=await db.collection('systemSettings').doc('employeeAttendanceReminders').get();
    if(!config.exists||config.data().enabled!==true)return {ok:true,enabled:false,planned:0,queued:0};
    const employees=(await db.collection('employees').get()).docs.map(d=>({__id:d.id,...d.data()})).filter(r=>active(r)&&!isManager(r,'employees'));
    const templates=(await db.collection('scheduleTemplates').get()).docs.map(d=>({__id:d.id,...d.data()}));
    let planned=0,queued=0;const missingLine=[],errors=[];
    const today=localDateKey(at),dates=[today,new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10),new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10)];
    for(const employee of employees){
      const employeeId=idOf(employee),line=clean(employee.lineUserId||employee['LINE User ID']);
      try{
        const computer=createScheduleComputer(await snapshot(employeeId,templates),at);
        const plans=(await Promise.all(dates.map(date=>computer.day(employee,date)))).flatMap(info=>reminderPlans(info,at));
        planned+=plans.length;if(!plans.length)continue;
        if(!line||employee.lineNotifyEnabled===false||employee.lineNotifyEnabled==='否'){missingLine.push(employeeId);continue;}
        if(dryRun)continue;
        for(const plan of plans){
          const queueId='employee-clock-'+hash(employeeId+'|'+plan.date+'|'+plan.scheduleKey+'|'+plan.kind),ref=db.collection('notificationQueue').doc(queueId);
          const title=plan.kind==='in'?'上班打卡提醒':plan.kind==='out'?'下班打卡提醒':'下班打卡再次提醒';
          const body=(employee.name||employee['姓名']||'')+'，'+(plan.kind==='in'?'今天 '+plan.startTime+' 上班，還有 10 分鐘。\n上班打卡請連接公司 Wi-Fi。':plan.kind==='out'?'已到 '+plan.endTime+' 下班時間，請記得打下班卡。':'下班已過一小時，尚未看到下班打卡，請記得完成。')+'\n開啟出勤：'+URL;
          const created=await db.runTransaction(async tx=>{if((await tx.get(ref)).exists)return false;tx.create(ref,{queueId,status:'待發送',channel:'line',emailFallbackEnabled:false,targetEmployeeId:employeeId,targetLineUserId:line,targetName:employee.name||'',targetRole:'employee',title,body,message:body,source:SOURCE,eventKey:'clock.'+plan.kind,attendanceReminder:plan,expiresAt:new Date(plan.due+5*60000).toISOString(),createdAt:FieldValue.serverTimestamp()});return true;});
          if(created)queued++;
        }
      }catch(e){errors.push({employeeId,message:e.message});}
    }
    return {ok:errors.length===0,enabled:true,planned,queued,missingLine,errors};
  }
  async function stillNeeded(row){
    if(row.source!==SOURCE)return true;
    if(Date.parse(row.expiresAt)<=now().getTime())return false;
    const config=await db.collection('systemSettings').doc('employeeAttendanceReminders').get();if(!config.exists||config.data().enabled!==true)return false;
    const doc=await db.collection('employees').doc(row.targetEmployeeId).get();
    let employee=doc.exists?{__id:doc.id,...doc.data()}:null;
    if(!employee){const q=await db.collection('employees').where('employeeId','==',row.targetEmployeeId).limit(1).get();if(!q.empty)employee={__id:q.docs[0].id,...q.docs[0].data()};}
    if(!employee||!active(employee)||employee.lineNotifyEnabled===false||employee.lineNotifyEnabled==='否'||clean(employee.lineUserId||employee['LINE User ID'])!==row.targetLineUserId)return false;
    const info=await createScheduleComputer(await snapshot(row.targetEmployeeId),now()).day(employee,row.attendanceReminder.date);
    return reminderPlans(info,now()).some(p=>p.kind===row.attendanceReminder.kind&&p.scheduleKey===row.attendanceReminder.scheduleKey);
  }
  return {clock,run,stillNeeded,snapshot};
}
module.exports={createEmployeeAttendance,requestIp,networkCheck,reminderPlans,SOURCE};
