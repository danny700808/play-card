'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const source=fs.readFileSync(require('path').join(__dirname,'../functions/coursePortal.js'),'utf8');
function fixture(blockers=[]){
 const docs=new Map([['runtime/version',{version:1}]]);let serial=Promise.resolve();
 const ref=path=>({path,id:path.split('/').at(-1),get:async()=>snap(path)}),snap=path=>({exists:docs.has(path),data:()=>docs.get(path)});
 const query=(name,field,value)=>({query:true,name,field,value});const querySnap=q=>({docs:[...docs.entries()].filter(([path,row])=>path.startsWith(q.name+'/')&&q.field.split('.').reduce((o,k)=>o&&o[k],row)===q.value).map(([path,row])=>({id:path.split('/').at(-1),data:()=>row}))});
 const db={collection:name=>({doc:id=>ref(name+'/'+id),where:(field,op,value)=>Object.assign(query(name,field,value),{get:async()=>querySnap(query(name,field,value))})}),runTransaction:work=>{const promise=serial.then(async()=>{let writing=false;const staged=new Map(docs);await work({get:async r=>{assert(!writing);return r.query?querySnap(r):snap(r.path);},set:(r,d)=>{writing=true;staged.set(r.path,{...staged.get(r.path),...d});},create:(r,d)=>{writing=true;assert(!staged.has(r.path));staged.set(r.path,d);}});docs.clear();for(const row of staged)docs.set(...row);});serial=promise.catch(()=>{});return promise;}};
 const minutes=t=>Number(t?.slice(0,2))*60+Number(t?.slice(3,5));
 const c={isRoomRentalEvent:r=>r.type==='rental',db,TUITION_PERIODS:'coursePortalTuitionPeriods',MIRROR:{tuitionPeriods:'mirrorPeriods'},normalizePhone:v=>String(v||''),mirrorRows:async()=>[{id:'plan',subjectId:'guitar',name:'四堂',amount:2800,lessonCount:4,splitType:'ratio',splitValue:0.6,active:true}],clean:v=>String(v??'').trim(),dateKey:v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v:'',timeMinutes:minutes,
 addDays:(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10),assertPortalInterval:(a,b)=>{assert(minutes(b)>minutes(a));},
 HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}},readCourseGroups:async()=>[],canonicalStudentId:v=>v,readScheduleVersion:async()=>docs.get('runtime/version').version,
 scheduleBundle:async()=>({resourceEvents:blockers,rooms:[{id:'room',active:true}],maps:{teachers:{teacher:{active:true,subjectIds:['guitar']}},subjects:{guitar:{}},students:{student:{name:'測試學生'}}}}),
 rentalPolicySettings:async()=>({}),businessWindow:()=>({closed:false,startMinutes:540,endMinutes:1260}),roomPolicyForSlot:()=>({}),
 sourceId:r=>r.id,sourceActive:r=>r.active!==false,firstArray:(r,keys)=>r[keys[0]]||[],requestedSubjectResourceIds:()=>[],roomSupportsSubject:()=>true,roomAllowsInterval:()=>true,
 eventBlocksResource:r=>r.status!=='leave',overlaps:(a,b,c,d)=>minutes(a)<minutes(d)&&minutes(c)<minutes(b),sharedResourceConflict:()=>false,
 hash:v=>crypto.createHash('sha256').update(v).digest('hex'),cents:v=>{assert(Number.isFinite(v)&&v>=0);},nowText:()=>'',FieldValue:{serverTimestamp:()=>1},
 scheduleVersionRef:()=>ref('runtime/version'),assertScheduleWritable:s=>{if(s.data().writesBlocked)throw Error('blocked');},normalizeScheduleStatus:v=>v,attendanceLineage:e=>e.fixedCourseId||e.id};
 vm.createContext(c);let start=source.indexOf('async function adminSaveSchedule(');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),c);return{c,docs};
}
const request=()=>({operationId:'op1',event:{date:'2026-09-07',start:'18:00',duration:60,roomId:'room',teacherId:'teacher',subjectId:'guitar',studentIds:['student'],type:'fixed',frequency:'weekly'},repeatUntil:'2026-09-30'});
test('recurring schedule is stored in shared cloud data without recording tuition or wages',async()=>{
 const f=fixture();await f.c.adminSaveSchedule(request());const row=f.docs.get('coursePortalFixedCourses/manager-op1');assert.equal(row.frequencyWeeks,1);assert.equal(row.source,'manager-cloud');assert.equal(row.studentIds.length,1);assert.equal(f.docs.size,2);
});
test('retry returns the same recurring rule and rejects a changed payload using the same operation ID',async()=>{
 const f=fixture();await f.c.adminSaveSchedule(request());assert.equal((await f.c.adminSaveSchedule(request())).duplicate,true);
 const changed=request();changed.event.start='19:00';await assert.rejects(f.c.adminSaveSchedule(changed));assert.equal(f.docs.size,2);
});
test('a conflict on a later weekly occurrence prevents the whole schedule write',async()=>{
 const f=fixture([{id:'other',date:'2026-09-14',startTime:'18:00',endTime:'19:00',roomId:'room',studentIds:[]}]);
 await assert.rejects(f.c.adminSaveSchedule(request()),/2026-09-14/);assert.equal(f.docs.size,1);
});
test('concurrent devices cannot commit schedules from the same stale version',async()=>{
 const f=fixture(),second=request();second.operationId='op2';const results=await Promise.allSettled([f.c.adminSaveSchedule(request()),f.c.adminSaveSchedule(second)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('a signed lesson cannot be moved without first cancelling attendance',async()=>{
 const f=fixture([{id:'old',date:'2026-09-07',startTime:'18:00',endTime:'19:00',roomId:'room',studentIds:['student'],status:'attended'}]),data=request();data.sourceEventId='old';data.sourceDate='2026-09-07';await assert.rejects(f.c.adminSaveSchedule(data),/已簽到/);
});

test('manager fixed move delegates weekly/biweekly with server-only identity and no client conflict bypass',async()=>{
 for(const frequency of ['weekly','biweekly']){
  const f=fixture(),data=request();data.mode='permanent_move';data.event.frequency=frequency;data.sourceEventId='old';data.sourceCourseId='series';data.sourceDate='2026-09-07';data.confirmPermanentConflicts=true;data.teacherSession={teacherId:'intruder'};
  f.c.recheckSchedule=async work=>work({guard:true});f.c.withPortalReads=work=>work;
  f.c.teacherActionAttempt=async(req,context,session)=>{assert.equal(session.teacherId,'teacher');assert.equal(req.frequencyWeeks,frequency==='weekly'?1:2);assert.equal(req.sourceEventId,'old');assert.equal(req.sourceCourseId,'series');assert.equal(req.confirmPermanentConflicts,undefined);assert.equal(req.teacherSession,undefined);assert.equal(context.guard,true);assert(req.managerRequestHash);return {ok:true};};
  assert.equal((await f.c.adminSaveSchedule(data)).ok,true);assert.equal(f.docs.size,1);
 }
});
test('manager fixed move conflict does not write a replacement or accept pending dates',async()=>{
 const f=fixture(),data=request();data.mode='permanent_move';f.c.recheckSchedule=async work=>work({});f.c.withPortalReads=work=>work;f.c.teacherActionAttempt=async()=>({ok:false,requiresConfirmation:true,conflicts:[{date:'2026-09-14'}]});await assert.rejects(f.c.adminSaveSchedule(data),/原課程尚未變更/);assert.equal(f.docs.size,1);
});
test('manager fixed move rejects one-off frequency before any write',async()=>{
 const f=fixture(),data=request();data.mode='permanent_move';data.event.frequency='once';await assert.rejects(f.c.adminSaveSchedule(data),/每週上課或隔週上課/);assert.equal(f.docs.size,1);
});

const enroll=()=>({...request(),enrollment:{newStudent:{name:'新學生',phone:'0912345678'},planId:'plan'}});

function morningFixture(blockers=[]) {
 const f=fixture(blockers);
 f.c.businessWindow=()=>({closed:false,startMinutes:750,endMinutes:1260});
 f.c.weekday=date=>new Date(date+'T12:00:00Z').getUTCDay();
 const policyStart=source.indexOf('function roomPolicyForSlot(');
 vm.runInContext(source.slice(policyStart,source.indexOf('\n}',policyStart)+2),f.c);
 f.docs.set('coursePortalRoomSettings/room',{policies:{thu:{'10:30':{blockSchedule:false,blockRental:true},'11:00':{blockSchedule:false,blockRental:true}}}});
 const data=enroll();data.event.date='2026-09-24';data.event.start='10:30';data.repeatUntil='2026-10-08';
 return {...f,data};
}
test('explicit classroom openings allow a new weekly student before public rental hours',async()=>{
 const f=morningFixture();const result=await f.c.adminSaveSchedule(f.data);
 assert.equal(result.ok,true);assert.equal(result.event.startTime,'10:30');assert.equal(result.event.endTime,'11:30');
 assert.equal(result.tuitionPeriod.expectedAmount,2800);
});
test('an incomplete classroom opening still rejects the whole morning course',async()=>{
 const f=morningFixture();delete f.docs.get('coursePortalRoomSettings/room').policies.thu['11:00'];
 await assert.rejects(f.c.adminSaveSchedule(f.data),/完整上課時段/);assert.equal(f.docs.size,2);
});
test('morning classroom override never opens public rental hours',async()=>{
 const f=morningFixture();delete f.data.enrollment;Object.assign(f.data.event,{type:'rental',studentIds:[],clientName:'租用測試'});
 await assert.rejects(f.c.adminSaveSchedule(f.data),/開放排課時段/);assert.equal(f.docs.size,2);
});
test('explicit morning opening retains future weekly collision checks',async()=>{
 const f=morningFixture([{id:'busy',date:'2026-10-01',startTime:'10:30',endTime:'11:30',roomId:'room',studentIds:[]}]);
 await assert.rejects(f.c.adminSaveSchedule(f.data),/2026-10-01.*已被占用/);assert.equal(f.docs.size,2);
});
test('new enrollment commits student, unpaid tuition and fixed schedule together; retry is idempotent',async()=>{
 const f=fixture(),data=enroll();const result=await f.c.adminSaveSchedule(data);const period=[...f.docs.entries()].find(([k])=>k.startsWith('coursePortalTuitionPeriods/'))[1],student=[...f.docs.entries()].find(([k])=>k.startsWith('coursePortalStudentProfiles/'))[1];
 assert.equal(f.docs.size,4);assert.equal(student.name,'新學生');assert.equal(period.studentId,student.id);assert.equal(period.periodNo,1);assert.equal(period.expectedAmount,2800);assert.equal(period.usedCount,0);assert.equal(period.paidAmount,0);assert.equal(period.transactions.length,0);assert.equal(result.event.tuitionPeriodId,period.id);assert.equal(result.event.studentIds[0],student.id);assert.equal((await f.c.adminSaveSchedule(data)).duplicate,true);assert.equal(f.docs.size,4);
 const changed=enroll();changed.enrollment.newStudent.name='另一人';await assert.rejects(f.c.adminSaveSchedule(changed),/操作編號/);assert.equal(f.docs.size,4);
});
test('later recurring conflict leaves no student or tuition behind',async()=>{
 const f=fixture([{id:'busy',date:'2026-09-14',startTime:'18:00',endTime:'19:00',roomId:'room',studentIds:[]}]);await assert.rejects(f.c.adminSaveSchedule(enroll()),/已被占用/);assert.equal(f.docs.size,1);
});
test('invalid plan leaves no partial enrollment',async()=>{
 const f=fixture(),data=enroll();data.enrollment.planId='missing';await assert.rejects(f.c.adminSaveSchedule(data),/收費方案/);assert.equal(f.docs.size,1);
});
test('existing student new scheme continues period sequence and trusts catalog prices only',async()=>{
 const f=fixture(),data=request();f.docs.set('mirrorPeriods/old',{source:{studentId:'student',periodNo:3}});data.enrollment={planId:'plan',amount:1};await f.c.adminSaveSchedule(data);const period=[...f.docs.entries()].find(([k])=>k.startsWith('coursePortalTuitionPeriods/'))[1];assert.equal(period.periodNo,4);assert.equal(period.expectedAmount,2800);assert(![...f.docs.keys()].some(k=>k.startsWith('coursePortalStudentProfiles/')));
});
test('new student cannot enter via single extra lesson',async()=>{
 const f=fixture(),data=enroll();data.event.type='single';await assert.rejects(f.c.adminSaveSchedule(data),/固定排課/);assert.equal(f.docs.size,1);
});

test('save returns committed recurring rule and enrollment for immediate UI refresh',async()=>{
 const f=fixture(),data=enroll();data.event.frequency='biweekly';const result=await f.c.adminSaveSchedule(data);
 assert.equal(result.course.frequencyWeeks,2);assert.equal(result.course.id,result.id);assert.equal(result.student.name,'新學生');assert.equal(result.tuitionPeriod.periodNo,1);assert.equal(result.tuitionPeriod.studentId,result.student.id);
});
test('student renter is contact metadata, with no tuition or payroll write',async()=>{
 const f=fixture(),data=request();Object.assign(data.event,{type:'rental',teacherId:'',subjectId:'',studentIds:[],renterStudentId:'student',clientName:'測試學生',rentalFee:150,duration:90});const result=await f.c.adminSaveSchedule(data);
 assert.equal(result.course.renterStudentId,'student');assert.equal(result.course.durationMinutes,90);assert.equal(result.course.studentIds.length,0);assert.equal(result.recurring,false);assert.equal(result.tuitionPeriod,null);assert.equal(f.docs.size,2);
});
test('invalid renter student is rejected before saving',async()=>{
 const f=fixture(),data=request();Object.assign(data.event,{type:'rental',studentIds:[],renterStudentId:'missing',clientName:'任意名稱'});await assert.rejects(f.c.adminSaveSchedule(data),/找不到所選學生/);assert.equal(f.docs.size,1);
});

test('existing drum lesson cannot be changed into another subject before any write',async()=>{
 const f=fixture([{id:'old',date:'2026-09-07',subjectId:'drums',type:'single',status:'scheduled'}]);
 const data=request();data.sourceEventId='old';data.sourceDate='2026-09-07';
 await assert.rejects(f.c.adminSaveSchedule(data),/沿用原科目/);assert.equal(f.docs.size,1);
});
