'use strict';

const crypto = require('node:crypto');
const {HttpsError} = require('firebase-functions/v2/https');
const {recipientFields} = require('./portalNotificationPolicy');
const clean = v => String(v == null ? '' : v).trim();
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const stable = v => JSON.stringify(v,(_,value)=>value && typeof value==='object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])) : value);
const startMillis = row => Date.parse(`${row.date}T${row.startTime}:00+08:00`);
const activeBooking = (row, now) => row.active !== false && !['cancelled','completed'].includes(row.status) && startMillis(row) > +now;
const contact = row => ({lineUserId:/^U[0-9a-f]{32}$/i.test(clean(row.lineUserId)) ? clean(row.lineUserId) : '',email:/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(clean(row.email || row.emailNormalized)) ? clean(row.email || row.emailNormalized).toLowerCase() : ''});
const bindingCollection = role => role === 'teacher' ? 'coursePortalTeacherBindings' : role === 'student' ? 'coursePortalStudentBindings' : 'coursePortalRenterBindings';

function bookingRecipient(booking, bindings) {
  const role = clean(booking.role), targetField = role === 'teacher' ? 'teacherId' : 'renterId';
  const candidates = bindings.filter(row => row.active !== false && row.status === 'active' && (
    booking.authAccountId || booking.lineUserId
      ? (booking.authAccountId && row.authAccountId === booking.authAccountId || booking.lineUserId && row.lineUserId === booking.lineUserId)
      : role !== 'student' && booking[targetField] && row[targetField] === booking[targetField]
  ) && (role === 'student' || !booking[targetField] || row[targetField] === booking[targetField]));
  const own = contact({lineUserId:booking.lineUserId,email:booking.notificationEmail});
  const lines = [...new Set([own.lineUserId,...candidates.map(r=>contact(r).lineUserId)].filter(Boolean))];
  const emails = [...new Set([own.email,...candidates.map(r=>contact(r).email)].filter(Boolean))];
  const fields = recipientFields({lineUserId:lines.length===1?lines[0]:'',email:emails.length===1?emails[0]:''});
  const reason = lines.length>1 || !lines.length && emails.length>1 ? '聯絡帳號不唯一' : !fields.targetLineUserId && !fields.targetEmail ? '缺少 LINE／Email' : '';
  return {...fields,eligible:!reason,reason};
}
function renterDirectory(bookings, bindings) {
  const groups = new Map();
  for (const b of bookings) {
    const target = bookingRecipient(b, bindings[bindingCollection(b.role)] || []);
    const name = clean(b.clientName || b.renterName) || '顧客';
    // Never merge different names merely because they share a family account.
    const key = hash(JSON.stringify([target.targetLineUserId || target.targetEmail || b.ownerKey || b.id,name]));
    if(!groups.has(key))groups.set(key,{renterId:key,name,...target,bookings:[]});
    groups.get(key).bookings.push({id:b.id,date:b.date,startTime:b.startTime,endTime:b.endTime,roomName:clean(b.roomName)||'教室'});
  }
  return [...groups.values()].map(r=>({...r,bookings:r.bookings.sort((a,b)=>(a.date+a.startTime+a.id).localeCompare(b.date+b.startTime+b.id))})).sort((a,b)=>a.renterId.localeCompare(b.renterId));
}
function personalize(body, row, dates, audience) {
  const name = audience === 'teacher' ? Array.from(clean(row.name).replace(/老師$/u,'')).slice(-2).join('') : clean(row.name);
  const date = dates.length===1 ? dates[0] : `${dates[0]} 至 ${dates.at(-1)}`;
  const bookings = (row.bookings||[]).map(b=>`${b.roomName}／${b.date} ${b.startTime}～${b.endTime}`).join('\n');
  const values={'姓名最後兩字':name,'客人完整姓名':name,'日期':date,'教室名稱／預約日期與時段':bookings};
  return body.replace(/\{(姓名最後兩字|客人完整姓名|日期|教室名稱／預約日期與時段)\}/g,(_,key)=>values[key]);
}
function hasProtectedAttendance(event,mirror,portal,matches,normalize=value=>value){
  return event.studentIds.some(studentId=>{
    const matching=row=>matches(row,studentId,event);
    const current=portal.filter(matching);
    // An explicit live cancellation supersedes the older imported attendance.
    return (current.length?current:mirror.filter(matching)).some(row=>row.active!==false&&['attended','absent','leave'].includes(normalize(row.status)));
  });
}

function createClassClosureOperations({db,loadSchedule,makeLeaveChange,assertScheduleWritable,now=()=>new Date()}) {
  const versionRef = db.collection('coursePortalRuntime').doc('scheduleVersion');
  async function bindingsFor(bookings,reader) {
    const names=[...new Set(bookings.map(b=>bindingCollection(b.role)))];
    return Object.fromEntries(await Promise.all(names.map(async name=>[name,(await reader(db.collection(name))).docs.map(doc=>doc.data())])));
  }
  async function inspect(dates) {
    const version = await versionRef.get();
    assertScheduleWritable(version);
    const [schedule,bookingSnapshot] = await Promise.all([loadSchedule(dates[0],dates.at(-1)),db.collection('coursePortalRoomBookings').where('date','>=',dates[0]).where('date','<=',dates.at(-1)).get()]);
    const lessons = schedule.events.filter(e=>e.status==='scheduled' && e.studentIds?.length && !e.protectedAttendance && !/rental|room_booking/.test(e.type+' '+e.portalAction));
    const bookings = bookingSnapshot.docs.map(d=>({...d.data(),id:d.id})).filter(b=>activeBooking(b,now())).sort((a,b)=>a.id.localeCompare(b.id));
    const bindings = await bindingsFor(bookings,ref=>ref.get());
    const renters = renterDirectory(bookings,bindings);
    const locks = (await Promise.all(bookings.map(b=>db.collection('coursePortalRoomLocks').where('bookingId','==',b.id).get()))).flatMap(s=>s.docs.map(d=>({id:d.id,...d.data()})));
    const versionNumber=Number(version.data()?.version||0);
    const after = await versionRef.get();
    assertScheduleWritable(after);
    if(Number(after.data()?.version||0)!==versionNumber)throw new HttpsError('aborted','課表剛剛更新，請重新載入。');
    const impact={lessonCount:lessons.length,studentCount:lessons.reduce((sum,e)=>sum+e.studentIds.length,0),bookingCount:bookings.length};
    const signature=hash(stable({version:versionNumber,lessons,renters,bookings}));
    return {version:versionNumber,lessons,bookings,renters,locks,priorChanges:schedule.priorChanges||[],impact,signature};
  }
  async function prepare(tx,context,{requestId,reason,actor,extraWrites=0}) {
    const version=await tx.get(versionRef);
    assertScheduleWritable(version);
    if(Number(version.data()?.version||0)!==context.version)throw new HttpsError('aborted','課表剛剛更新，請重新載入名單。');
    const bookingRefs=context.bookings.map(b=>db.collection('coursePortalRoomBookings').doc(b.id));
    const freshBookings=await Promise.all(bookingRefs.map(r=>tx.get(r)));
    if(freshBookings.some((s,i)=>!s.exists||stable({...s.data(),id:s.id})!==stable(context.bookings[i])||!activeBooking(s.data(),now())))throw new HttpsError('aborted','租用預約已更新或已開始，請重新載入。');
    const freshRenters=renterDirectory(context.bookings,await bindingsFor(context.bookings,ref=>tx.get(ref)));
    if(JSON.stringify(freshRenters)!==JSON.stringify(context.renters))throw new HttpsError('aborted','客人聯絡資料已更新，請重新載入。');
    const changes=context.lessons.map(e=>makeLeaveChange(e,reason));
    const attendanceRefs=context.lessons.flatMap(e=>e.attendanceIds||[]).map(id=>db.collection('coursePortalAttendanceRecords').doc(id));
    const attendance=await Promise.all(attendanceRefs.map(ref=>tx.get(ref)));
    if(attendance.some(s=>s.exists&&s.data().active!==false&&['attended','absent','leave'].includes(s.data().status)))throw new HttpsError('aborted','課程簽到狀態已更新，請重新載入。');
    const prior=context.priorChanges.filter(c=>c.action==='lesson_status' && changes.some(change=>change.id!==c.id && change.createdByTeacherId===c.createdByTeacherId && change.sourceDate===c.sourceDate && (change.sourceCourseId && change.sourceCourseId===c.sourceCourseId || change.sourceEventId===c.sourceEventId)));
    const lockIds=[...new Set([...context.locks.map(l=>l.id),...context.bookings.flatMap(b=>b.lockIds||[])])];
    const lockRefs=lockIds.map(id=>db.collection('coursePortalRoomLocks').doc(id));
    const lockSnapshots=await Promise.all(lockRefs.map(r=>tx.get(r)));
    const deleteLocks=lockRefs.filter((r,i)=>lockSnapshots[i].exists&&context.bookings.some(b=>b.id===lockSnapshots[i].data().bookingId));
    const queueRefs=context.bookings.map(b=>db.collection('notificationQueue').doc(`course-portal-booking-${b.id}-reminder`));
    const queues=await Promise.all(queueRefs.map(r=>tx.get(r)));
    const writes=changes.length+prior.length+context.bookings.length*2+queues.filter(q=>q.exists&&!['已發送','sent'].includes(q.data().status)).length+deleteLocks.length+1+extraWrites;
    if(writes>490)throw new HttpsError('resource-exhausted','本次課程與預約筆數較多，請縮短日期範圍後分次設定。');
    // All reads finish before the caller writes closures or notifications.
    return ()=>{
      const stamp=now(),base={announcementId:requestId,updatedAt:stamp};
      changes.forEach(change=>tx.set(db.collection('coursePortalScheduleChanges').doc(change.id),{...change,...base,createdByManager:actor,approvedByManager:true,event:{...change.event,note:reason,reason,teacherPayable:false,paymentStatus:'student_leave'}}));
      prior.forEach(c=>tx.set(db.collection('coursePortalScheduleChanges').doc(c.id),{active:false,...base,supersededBy:requestId},{merge:true}));
      const cancellation={...base,active:false,status:'cancelled',cancelledAt:stamp,cancelledAtText:stamp.toISOString(),cancelledBy:'admin',cancellationReason:reason};
      context.bookings.forEach((b,i)=>{tx.set(bookingRefs[i],cancellation,{merge:true});tx.set(db.collection('coursePortalScheduleChanges').doc(`rental-${b.id}`),cancellation,{merge:true});});
      deleteLocks.forEach(ref=>tx.delete(ref));
      queues.forEach((q,i)=>{if(q.exists&&!['已發送','sent'].includes(q.data().status))tx.set(queueRefs[i],{status:'已取消',active:false,cancelledAt:stamp,announcementId:requestId},{merge:true});});
      tx.set(versionRef,{version:context.version+1,updatedAt:stamp,updatedBy:'class-closure'},{merge:true});
    };
  }
  return {inspect,prepare};
}
module.exports={createClassClosureOperations,bookingRecipient,renterDirectory,personalize,activeBooking,hasProtectedAttendance};
