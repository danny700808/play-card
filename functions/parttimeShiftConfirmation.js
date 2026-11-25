'use strict';
const {createHash} = require('node:crypto');
const {createScheduleComputer, localDateKey, timeText, minutes, clean} = require('./employeeAttendanceSchedule');
const {HttpsError} = require('firebase-functions/v2/https');
const actions = ['上班打卡', '下班打卡'];
const pending = '待審核';
const tag = 'shiftConfirmation';
const short = t => clean(t).slice(0, 5);
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 32);
const status = r => clean(r.status || r['狀態']);
const fail = message => { throw new HttpsError('failed-precondition', message); };
const validTime = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const regularId = (id, date) => 'PT_' + id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0,220) + '_' + date.replace(/-/g,'');

function shiftView(s, date, corrections, entry, now) {
  const actual = [s.clockInRecord, s.clockOutRecord];
  const sides = actions.map((action, i) => {
    const rec = actual[i], time = short(rec?.time), boundary = i ? s.endTime : s.startTime;
    const raw = rec?.raw || {};
    const delta = time ? (i ? minutes(boundary)-minutes(time) : minutes(time)-minutes(boundary)) : 0;
    const candidates = corrections.filter(c => {
      const original = clean(c.originalRecordId || c['原始紀錄ID']);
      if(original) return rec && [rec.id, rec.__id].includes(original);
      return (c.correctDate || c['修正日期']) === date && (c.correctAction || c['修正動作']) === action &&
        [s.scheduleKey, ...(s.splitCount===1?[s.originalScheduleKey]:[])].includes(c.scheduleKey);
    });
    const request = candidates.find(c => status(c) === pending) ||
      candidates.find(c => entry?.requestIds?.includes(c.__id) || (rec && c.__id === raw.correctionRequestId));
    return {time, recordId:rec?.__id || rec?.id || '', delta:Math.max(0,delta), requestId:request?.__id || '',
      status:request ? status(request) : '', requestedTime:short(request?.correctTime), kind:request?.requestKind || '',
      handled:!!(raw.dataCenterEdited || raw.correctionApplied || raw.noLateDeduction || raw.lateDeductionWaived)};
  });
  const ready = sides.every(x => x.time);
  const workedMinutes = ready ? Math.max(0,Math.min(minutes(s.endTime),minutes(sides[1].time))-Math.max(minutes(s.startTime),minutes(sides[0].time))) : null;
  const ended = date < localDateKey(now) || (date===localDateKey(now) && minutes(timeText(now))>=minutes(s.endTime));
  return {key:s.scheduleKey, originalKey:s.originalScheduleKey, start:s.startTime, end:s.endTime, sides,
    ready, ended, workedMinutes, submitted:!!entry, exception:sides.some(x => !x.time || x.delta || x.status),
    separate:s.attendanceSatisfiedByTemporary || s.attendancePendingTemporary || sides.some(x=>x.kind==='earlyLeave')};
}

// Calculate the regular record only. Leave pay, temporary work and manager adjustments have their own records.
function payProjection(shifts, entries, rate, multiplier) {
  let worked=0, late=0, hasPair=false;
  for(const s of shifts){
    if(!entries[hash(s.key)] || !s.ready || s.separate) continue;
    hasPair=true;
    worked+=s.workedMinutes;
    late+=Math.min(minutes(s.end)-minutes(s.start),s.sides[0].delta);
  }
  // Existing payroll reports subtract late minutes separately at the hourly rate.
  // Record gross before that deduction even when the attendance hours already reflect the late arrival.
  return {hasPair,worked, gross:Math.round((worked*multiplier+late)*rate/60)};
}

function createShiftConfirmation({db, FieldValue, attendance, now=()=>new Date()}) {
  function refs(id,date){
    const key=regularId(id,date);
    return {state:db.collection('parttimeShiftConfirmations').doc(key), pay:db.collection('parttimeRecords').doc(key)};
  }
  async function process(user, input, mode){
    const date=clean(input.workDate), id=user.employeeId, at=now();
    if(user.identityType!=='parttime') fail('此功能僅供工讀生使用。');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('請選擇工時日期。');
    const ref=refs(id,date);
    if(mode==='refresh' && !(await ref.state.get()).exists) return;
    const run=async tx=>{
      const get=q=>tx?tx.get(q):q.get();
      const [snapshot,appRows,local,paySnap]=await Promise.all([
        attendance.snapshot(id,null,tx),get(db.collection('clockCorrections').where('employeeId','==',id)),
        get(ref.state),get(ref.pay)
      ]);
      const info=await createScheduleComputer(snapshot,at).day(user,date);
      const apps=appRows.docs.map(d=>({...d.data(),__id:d.id}));
      const state=local.data()||{},entries={...state.entries},old=paySnap.data()||{};
      const shifts=info.schedules.map(s=>shiftView(s,date,apps,entries[hash(s.scheduleKey)],at));
      const managed=!!(old.dataCenterEdited || old.dataCenterCreated || old.replacedByRecordId || old.deleted || old.isDeleted || /取代|刪除|作廢/.test(status(old)));
      const legacy=paySnap.exists && old.confirmationSource!==tag;
      const view={date, shifts, managed, legacy, hoursRecorded:paySnap.exists, scheduleLabel:shifts.map(s=>s.start+'–'+s.end).join('、')};
      if(mode==='context') return view;
      if(mode==='refresh' && !local.exists) return;
      if(date>localDateKey(at)) fail('尚未到這天的班次。');
      const stamp=FieldValue.serverTimestamp();
      const rate=Number(old.hourlyRate || user.hourlyRate || user.parttimeHourlyRate || user.hourRate || user['時薪']) || 0;
      const multiplier=old.payMultiplier===2 || state.doublePay || input.doublePay===true ? 2 : 1;
      const scheduled=shifts.filter(s=>!s.separate).reduce((sum,s)=>sum+minutes(s.end)-minutes(s.start),0)/60;
      const writePay=(hours,gross,extra)=>tx.set(ref.pay,{
        recordId:ref.pay.id,employeeId:id,'員工ID':id,name:user.name||'',email:user.email||'',date,workDate:date,'日期':date,
        hours,totalHours:hours,'時數':hours,'總時數':hours,grossPay:gross,'當日工資':gross,hourlyRate:rate,'時薪':rate,
        scheduledHours:scheduled,payMultiplier:multiplier,doublePay:multiplier===2,status:'正常','狀態':'正常',
        createdAt:old.createdAt||stamp,updatedAt:stamp,...extra
      },{merge:true});
      if(mode==='correction'){
        const i=actions.indexOf(input.correctAction);
        const s=shifts.find(s=>i>=0 && (input.originalRecordId?s.sides[i].recordId===input.originalRecordId:s.key===input.scheduleKey));
        if(!s || s.separate || (input.correctDate && input.correctDate!==date)) return {useExistingFlow:true};
        const x=s.sides[i], time=short(input.correctTime), reason=clean(input.reason).slice(0,500);
        if(!reason || !validTime(time)) fail('請填寫實際時間和原因。');
        if(date===localDateKey(at) && minutes(time)>minutes(timeText(at)))fail('實際工作時間不能晚於現在。');
        if(x.status===pending) return {ok:true,requestId:x.requestId,message:'同一筆更正已送出，待主管審核。'};
        if(!input.originalRecordId && x.time) fail('這個班段已有打卡紀錄。');
        const request=db.collection('clockCorrections').doc();
        tx.create(request,{requestId:request.id,requestKind:x.time?'recordCorrection':'missingClock',
          employeeId:id,'員工ID':id,name:user.name||'',email:user.email||'',correctDate:date,correctTime:time,
          correctAction:actions[i],originalTime:x.time,originalDate:date,originalRecordId:x.recordId,correctionType:'標準打卡',
          reason,scheduleKey:s.key,originalScheduleKey:s.originalKey,scheduleStartTime:s.start,scheduleEndTime:s.end,
          status:pending,'狀態':pending,createdAt:stamp,source:tag});
        return {ok:true,requestId:request.id,newRequests:1,message:'更正已送出，待主管審核。'};
      }
      if(mode==='normal'){
        const hours=Number(input.hours)+(input.halfHour===true?.5:0);
        if(managed || local.exists || !shifts.length || shifts.some(s=>s.separate || s.exception || !s.ready)) fail('請先確認這個班次的打卡與工時。');
        if(!(hours>0 && hours<=scheduled && Number.isInteger(hours*2))) fail('請選擇班表範圍內的工時。');
        writePay(hours,Math.round(hours*rate*multiplier),{note:'已確認上下班打卡'});
        return {ok:true,message:'工時已登記。'};
      }
      let newRequests=0, message='';
      if(mode==='submit'){
        const s=shifts.find(x=>x.key===input.scheduleKey);
        if(!s || s.separate) fail('班表已變更，請重新整理。');
        if(!s.ready && !s.ended) fail('請先打卡。若有漏打，可在班次結束後一併補卡。');
        const key=hash(s.key);
        if(entries[key]) return {ok:true,message:'已收到這班工時，可查看審核進度。'};
        const answers=input.answers||[], requestIds=[], reasons=[];
        let times=s.sides.map(x=>x.time);
        const toCreate=[];
        for(const [i,x] of s.sides.entries()){
          if(x.status===pending){requestIds.push(x.requestId); times[i]=x.requestedTime;continue;}
          if(x.time && (!x.delta || x.handled || x.status==='已核准')) continue;
          const a=answers[i]||{},reason=clean(a.reason).slice(0,500);
          if(!reason) fail('請填寫原因。');
          reasons.push(reason);
          if(a.choice==='actual' && x.time) continue;
          if(a.choice!=='correct' || !validTime(a.time) || (x.time===a.time)) fail('請填寫要更正的實際時間。');
          times[i]=a.time;
          const request=db.collection('clockCorrections').doc();
          requestIds.push(request.id);
          toCreate.push([request,{requestId:request.id,requestKind:x.time?'recordCorrection':'missingClock',
            employeeId:id,'員工ID':id,name:user.name||'',email:user.email||'',correctDate:date,correctTime:a.time,
            correctAction:actions[i],originalTime:x.time,originalDate:date,originalRecordId:x.recordId,
            correctionType:'標準打卡',reason,scheduleKey:s.key,originalScheduleKey:s.originalKey,scheduleStartTime:s.start,scheduleEndTime:s.end,
            status:pending,'狀態':pending,createdAt:stamp,source:tag}]);
        }
        if(!times.every(validTime) || minutes(times[0])>=minutes(times[1])) fail('下班時間須晚於上班時間。');
        if(date===localDateKey(at) && times.some(t=>minutes(t)>minutes(timeText(at)))) fail('實際工作時間不能晚於現在。');
        for(const [request,row] of toCreate) tx.create(request,row);
        newRequests=toCreate.length;
        entries[key]={requestIds,reasons,key:s.key,submittedAt:stamp};
        tx.set(ref.state,{employeeId:id,date,entries,doublePay:multiplier===2,updatedAt:stamp},{merge:true});
        message=requestIds.length?'工時已送出，更正申請待主管審核。':'工時已確認。';
        if(legacy || managed) message+=' 已保留原有工時紀錄。';
      }
      if(!managed && !legacy){
        const p=payProjection(shifts,entries,rate,multiplier);
        if(p.hasPair) writePay(p.worked/60,p.gross,{confirmationSource:tag,workedMinutes:p.worked,note:Object.values(entries).flatMap(entry=>entry.reasons||[]).join('；')||'打卡確認工時'});
      }
      return {ok:true,message,newRequests};
    };
    return mode==='context'?run(null):db.runTransaction(run);
  }
  async function refresh(c){
    const id=c.employeeId||c['員工ID'],date=c.correctDate||c['修正日期'];
    if(!id || !date || !(await refs(id,date).state.get()).exists) return;
    let employee=await db.collection('employees').doc(id).get();
    if(!employee.exists) employee=(await db.collection('employees').where('employeeId','==',id).limit(1).get()).docs[0];
    if(employee?.exists) await process({...employee.data(),employeeId:id,identityType:'parttime'},{workDate:date},'refresh');
  }
  return {process,refresh};
}
module.exports={createShiftConfirmation,shiftView,payProjection};
