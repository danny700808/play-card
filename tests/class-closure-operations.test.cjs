'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createClassClosureOperations,personalize,bookingRecipient,hasProtectedAttendance}=require('../functions/classClosureOperations');
const {createTeacherAnnouncements}=require('../functions/teacherAnnouncements');
const {prepareReminder}=require('../functions/courseClosurePolicy');
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86400000));
const LINE='U'+'b'.repeat(32),now=()=>new Date(day+'T08:00:00+08:00');
function fixture(){
  const store=new Map(),getField=(o,key)=>key.split('.').reduce((v,k)=>v?.[k],o);let chain=Promise.resolve();
  const snap=path=>({id:path.split('/').at(-1),ref:ref(path),exists:store.has(path),data:()=>structuredClone(store.get(path))});
  function ref(path){return {path,id:path.split('/').at(-1),get:async()=>snap(path)};}
  function collection(name,filters=[]){return {doc:id=>ref(name+'/'+id),where:(key,op,value)=>collection(name,[...filters,[key,op,value]]),orderBy:()=>collection(name,filters),limit:()=>collection(name,filters),get:async()=>({docs:[...store.keys()].filter(k=>k.startsWith(name+'/')&&filters.every(([key,op,value])=>{const actual=getField(store.get(k),key);return op==='=='?actual===value:op==='>='?actual>=value:actual<=value;})).map(snap)})};}
  const db={collection,runTransaction:fn=>{const job=chain.then(async()=>{const writes=[];let writing=false;const result=await fn({get:r=>{assert(!writing,'transaction read after write');return r.get();},set:(r,d,o)=>{writing=true;writes.push(()=>store.set(r.path,o?.merge?{...store.get(r.path),...structuredClone(d)}:structuredClone(d)));},create:(r,d)=>{writing=true;assert(!store.has(r.path));writes.push(()=>store.set(r.path,structuredClone(d)));},update:(r,d)=>{writing=true;writes.push(()=>store.set(r.path,{...store.get(r.path),...structuredClone(d)}));},delete:r=>{writing=true;writes.push(()=>store.delete(r.path));}});writes.forEach(w=>w());return result;});chain=job.catch(()=>{});return job;}};
  store.set('coursePortalRuntime/scheduleVersion',{version:3});
  store.set('coursePortalTeacherBindings/t',{teacherId:'t1',status:'active',lineUserId:LINE});
  store.set('coursePortalRenterBindings/r',{renterId:'r1',authAccountId:'acct',status:'active',email:'guest@example.test'});
  for(const [id,hour] of [['b1','14'],['b2','16']]){
    store.set('coursePortalRoomBookings/'+id,{id,date:day,startTime:hour+':00',endTime:hour+':30',roomName:'鋼琴教室',roomId:'room',role:'renter',renterId:'r1',authAccountId:'acct',clientName:'陳小明',active:true,status:'confirmed',lockIds:[id+'-lock']});
    store.set('coursePortalRoomLocks/'+id+'-lock',{bookingId:id});store.set('coursePortalScheduleChanges/rental-'+id,{action:'room_booking',active:true});
    store.set('notificationQueue/course-portal-booking-'+id+'-reminder',{status:'待發送',source:'course-portal-room-booking',bookingId:id});
  }
  const lesson=(id,students,status='scheduled')=>({id,sourceId:id,fixedCourseId:id,date:day,startTime:'15:00',endTime:'16:00',teacherId:'t1',studentIds:students,roomId:'room',subjectId:'piano',status,type:'lesson',attendanceIds:students.map(s=>id+'-'+s)});
  const events=[lesson('group',['s1','s2']),lesson('private',['s3']),lesson('done',['s4'],'attended'),lesson('leave',['s5'],'leave'),lesson('absent',['s6'],'absent'),lesson('cancel',['s7'],'cancelled')];
  const closureOperations=createClassClosureOperations({db,now,assertScheduleWritable:s=>{if(s.data()?.writesBlocked)throw Error('sync blocked');},loadSchedule:async()=>({events,priorChanges:[]}),makeLeaveChange:(e,reason)=>({id:'status-'+e.id,action:'lesson_status',active:true,sourceEventId:e.id,sourceCourseId:e.fixedCourseId,sourceDate:day,createdByTeacherId:e.teacherId,event:{...e,status:'leave',note:reason}})});
  const handle=createTeacherAnnouncements({db,closureOperations,now,loadTeachers:async()=>[{id:'t1',name:'張鈺琪'}],loadSchedule:async()=>events,uploadImage:async()=> 'https://example.test/image'});
  async function payload(extra={}){const preview=await handle({action:'inspect',startDate:day},'admin');return {action:'submit',schemaVersion:2,kind:'closure',requestId:'closure_test_12345678',startDate:day,teacherIds:['t1'],renterIds:preview.renters.filter(r=>r.eligible).map(r=>r.renterId),title:'停課通知',body:'{姓名最後兩字}老師您好：系統會自動登記為「請假」。',reason:'颱風天',renterTitle:'預約取消',renterBody:'{客人完整姓名}您好：\n{教室名稱／預約日期與時段}\n請重新預約您適合的時間。',directoryVersion:preview.directoryVersion,...extra};}
  return {db,store,events,handle,payload,closureOperations};
}
test('personalization keeps full customer name, takes final two teacher characters, and replaces all booking tokens',()=>{
  assert.equal(personalize('{姓名最後兩字}老師您好',{name:'張鈺琪'},[day],'teacher'),'鈺琪老師您好');
  assert.equal(personalize('{姓名最後兩字}老師您好',{name:'洪姐老師'},[day],'teacher'),'洪姐老師您好');
  assert.equal(personalize('{客人完整姓名}您好',{name:'歐陽小明'},[day],'renter'),'歐陽小明您好');
});
test('live attendance cancellation supersedes stale import; completed students remain protected',()=>{
 const event={studentIds:['s1','s2']},mirror=[{studentId:'s1',status:'attended'}],matches=(row,id)=>row.studentId===id;
 assert.equal(hasProtectedAttendance(event,mirror,[],matches),true);
 assert.equal(hasProtectedAttendance(event,mirror,[{studentId:'s1',status:'cancelled',active:false}],matches),false);
 assert.equal(hasProtectedAttendance(event,mirror,[{studentId:'s2',status:'attended'}],matches),true);
});
test('read-only preview groups bookings and exposes no private contact addresses',async()=>{const f=fixture(),before=JSON.stringify([...f.store]);const p=await f.handle({action:'inspect',startDate:day},'admin');assert.equal(JSON.stringify([...f.store]),before);assert.deepEqual(p.impact,{lessonCount:2,studentCount:3,bookingCount:2});assert.equal(p.renters.length,1);assert.equal(p.renters[0].bookings.length,2);assert.equal(p.renters[0].channel,'email');assert(!JSON.stringify(p).includes('guest@example.test'));});
test('atomic submission marks every student lesson leave, cancels bookings and locks, personalizes once per person, retries safely',async()=>{
  const f=fixture(),p=await f.payload();await Promise.all([f.handle(p,'admin'),f.handle(p,'admin')]);
  const group=f.store.get('coursePortalScheduleChanges/status-group');assert.equal(group.event.status,'leave');assert.deepEqual(group.event.studentIds,['s1','s2']);assert.equal(group.event.note,'颱風天');assert.equal(group.event.teacherPayable,false);
  assert.equal(f.store.get('coursePortalScheduleChanges/status-private').event.status,'leave');for(const id of ['done','leave','absent','cancel'])assert(!f.store.has('coursePortalScheduleChanges/status-'+id));
  for(const id of ['b1','b2']){assert.equal(f.store.get('coursePortalRoomBookings/'+id).status,'cancelled');assert(!f.store.has('coursePortalRoomLocks/'+id+'-lock'));assert.equal(f.store.get('notificationQueue/course-portal-booking-'+id+'-reminder').status,'已取消');}
  const notices=[...f.store.values()].filter(r=>r.source==='teacher-announcement');assert.equal(notices.length,2);assert.match(notices.find(r=>r.teacherId).body,/^鈺琪老師您好/);const customer=notices.find(r=>r.renterId);assert.match(customer.body,/^陳小明您好/);assert.match(customer.body,/14:00/);assert.match(customer.body,/16:00/);assert.equal(customer.channel,'email');assert(![...f.store.keys()].some(k=>/payroll|tuition|AttendanceRecords/.test(k)));assert.equal(f.store.get('coursePortalRuntime/scheduleVersion').version,4);
});
test('unchecking every recipient still changes all affected lessons and bookings; general announcement changes neither',async()=>{
  const f=fixture();await f.handle(await f.payload({teacherIds:[],renterIds:[]}),'admin');assert.equal(f.store.get('coursePortalRoomBookings/b1').active,false);assert.equal(f.store.get('coursePortalScheduleChanges/status-group').event.status,'leave');assert(![...f.store.values()].some(r=>r.source==='teacher-announcement'));
  const n=fixture();await n.handle(await n.payload({kind:'notice',renterIds:[]}),'admin');assert.equal(n.store.get('coursePortalRoomBookings/b1').active,true);assert(!n.store.has('coursePortalScheduleChanges/status-group'));
});
test('changed preview and racing attendance cause no partial writes or messages',async()=>{
  const f=fixture(),p=await f.payload();f.store.get('coursePortalRoomBookings/b1').startTime='17:00';const before=JSON.stringify([...f.store]);await assert.rejects(()=>f.handle(p,'admin'),/已變更/);assert.equal(JSON.stringify([...f.store]),before);
  const g=fixture(),p2=await g.payload();g.store.set('coursePortalAttendanceRecords/group-s1',{active:true,status:'attended'});const original=JSON.stringify([...g.store]);await assert.rejects(()=>g.handle(p2,'admin'),/簽到狀態已更新/);assert.equal(JSON.stringify([...g.store]),original);
});
test('releasing closure never restores cancelled bookings or leave records',async()=>{const f=fixture(),p=await f.payload();await f.handle(p,'admin');await f.handle({action:'release',id:p.requestId},'admin');assert.equal(f.store.get('courseClassClosures/'+day).active,false);assert.equal(f.store.get('coursePortalRoomBookings/b1').active,false);assert.equal(f.store.get('coursePortalScheduleChanges/status-group').event.status,'leave');});
test('binding resolution uses LINE first, Email fallback, rejects ambiguous identity and never matches names',()=>{
  const b={role:'renter',renterId:'r1',authAccountId:'acct',clientName:'陳小明'};
  const bindings=[{status:'active',renterId:'r1',authAccountId:'acct',lineUserId:LINE,email:'a@example.test'},{status:'active',renterId:'other',authAccountId:'different',name:'陳小明',email:'wrong@example.test'}];
  assert.equal(bookingRecipient(b,bindings).channel,'line');assert.equal(bookingRecipient(b,bindings).targetEmail,'a@example.test');assert.equal(bookingRecipient(b,bindings).emailFallbackEnabled,true);bindings.push({...bindings[0],lineUserId:'U'+'c'.repeat(32)});assert.equal(bookingRecipient(b,bindings).eligible,false);
});
test('last-moment rental reminder guard respects cancellation and closure, leaves cancellation notice untouched',async()=>{
  const f=fixture(),row={source:'course-portal-room-booking',bookingId:'b1'};assert.equal((await prepareReminder(f.db,row)).cancelled,false);f.store.set('courseClassClosures/'+day,{active:true});assert.equal((await prepareReminder(f.db,row)).cancelled,true);f.store.delete('courseClassClosures/'+day);f.store.get('coursePortalRoomBookings/b1').active=false;assert.equal((await prepareReminder(f.db,row)).cancelled,true);assert.equal((await prepareReminder(f.db,{...row,source:'teacher-announcement'})).cancelled,false);
});
test('legacy closure upgrades atomically without releasing the date or resending unselected teachers',async()=>{
 const f=fixture(),legacy='legacy_closure_123456';
 f.store.set('teacherAnnouncements/'+legacy,{kind:'closure',dates:[day],released:false,title:'舊通知',body:'已停課',createdAtText:now().toISOString(),deliveries:[]});
 f.store.set('courseClassClosures/'+day,{active:true,reason:'颱風停課',announcementId:legacy});
 const p=await f.payload({upgradeIds:[legacy],teacherIds:[]});await f.handle(p,'admin');await f.handle(p,'admin');
 assert.equal(f.store.get('courseClassClosures/'+day).active,true);assert.equal(f.store.get('courseClassClosures/'+day).operationsVersion,2);
 assert.equal(f.store.get('teacherAnnouncements/'+legacy).supersededBy,p.requestId);
 assert.equal(f.store.get('coursePortalScheduleChanges/status-group').event.status,'leave');
 const notices=[...f.store.values()].filter(r=>r.source==='teacher-announcement');assert.equal(notices.length,1);assert.equal(notices[0].eventCode,'renter_closure_announcement');
});
test('old client and partial legacy date range cannot silently cancel reservations',async()=>{
 const f=fixture(),p=await f.payload({schemaVersion:1}),before=JSON.stringify([...f.store]);await assert.rejects(f.handle(p,'admin'),/重新整理頁面/);assert.equal(JSON.stringify([...f.store]),before);
 const legacy='legacy_closure_123456';f.store.set('teacherAnnouncements/'+legacy,{kind:'closure',dates:[day,'2099-01-01'],released:false,createdAtText:now().toISOString(),deliveries:[]});f.store.set('courseClassClosures/'+day,{active:true,announcementId:legacy});
 const p2=await f.payload({upgradeIds:[legacy]});const snapshot=JSON.stringify([...f.store]);await assert.rejects(f.handle(p2,'admin'),/完整日期/);assert.equal(JSON.stringify([...f.store]),snapshot);
});
