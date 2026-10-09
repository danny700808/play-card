const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('functions/coursePortal.js','utf8');
const body=src.slice(src.indexOf('async function applyTeacherAttendance('),src.indexOf('\nasync function adminSaveLessonSettings('));
function fixture({date='2026-09-14',gift=false,pending=[],half=false}={}){
 const records=new Map([['version',{version:1}]]);const event={id:'e',sourceId:'e',fixedCourseId:'c',date,teacherId:'t',studentIds:['combined'],studentNames:['A＋B'],subjectId:'piano',startTime:'17:00',endTime:'18:00',status:'scheduled',specialLesson:gift};
 const ref=path=>({path,id:path.split('/').at(-1)});const snapshot=r=>({exists:records.has(r.path),data:()=>records.get(r.path)});
 const c={timeAttendanceStage:(_,work)=>work(),requireSession:async()=>({teacherId:'t'}),teacherAttendanceEvent:async()=>({sourceDate:date,sourceEventId:'e',sourceCourseId:'c',event}),currentTaipeiDay:()=> '2026-09-15',clean:v=>String(v??''),normalizeScheduleStatus:v=>v||'scheduled',taipeiDateTimeMillis:()=>0,attendanceOperationId:()=> 'op',readScheduleVersion:async()=>records.get('version').version,attendanceLineage:()=> 'c',attendanceLessonLockId:()=> 'lock',hash:v=>String(v),sourceId:r=>r?.id||'',eventStudentIds:r=>r.studentIds,eventSubjectId:r=>r.subjectId,eventLessonUnits:()=>1,timeMinutes:v=>Number(v.slice(0,2))*60+Number(v.slice(3)),nowText:()=> '2026-09-15T16:00',FieldValue:{serverTimestamp:()=>1},ATTENDANCE_ADMIN_FEE:50,ATTENDANCE_PAYROLL:'payroll',ATTENDANCE_CANCELLATIONS:'cancellations',ATTENDANCE_RECORDS:'attendance',TUITION_PERIODS:'periods',TUITION_PAYMENT_REQUESTS:'payments',pendingTeacherCorrections:async()=>pending,
 attendancePeriodsForEvent:async(e,d,o)=>({rows:[],byStudent:{combined:{id:'period',lessonUnitMinutes:half?30:60}},rollovers:[],allocationsByStudent:{combined:[{periodId:'period',lessonUnits:half?(o.attendanceDurationMinutes||60)/30:1}]}}),attendancePayrollCalculation:()=>({teacherAmount:500}),attendanceChangePayload:(e,d,ei,ci,ti,status)=>({event:{...e,status}}),scheduleVersionRef:()=>ref('version'),assertScheduleWritable:()=>{},canReinstateSameDayTeacherCancellation:()=>false,HttpsError:class extends Error{constructor(code,message){super(message);this.code=code}},db:{collection:name=>({doc:id=>ref(name+'/'+id)}),runTransaction:async f=>{const writes=[];await f({get:async r=>snapshot(r),set:(r,d,o)=>writes.push([r,d,o])});for(const [r,d,o] of writes)records.set(r.path,o?.merge?{...records.get(r.path),...d}:d);}}};
 c.feeDescription=require('../functions/payrollAdjustmentDetails').feeDescription;c.eventEnd=e=>e.endTime;c.eventStart=e=>e.startTime;vm.createContext(c);vm.runInContext(src.slice(src.indexOf('function tuitionLessonUnitMinutes('),src.indexOf('function attendanceAllocations(')),c);vm.runInContext(body,c);return{c,records};
}
test('past merged lesson late attendance commits once with one payroll and NT$50 deduction',async()=>{const {c,records}=fixture();await c.applyTeacherAttendance({},true);assert.equal(records.get('coursePortalLateAttendance/op').status,'approved');assert.equal(records.get('coursePortalTeacherAdjustments/attendance-fee-op').amount,-50);assert.equal([...records.keys()].filter(k=>k.startsWith('attendance/')).length,1);assert.equal(records.get('payroll/op').teacherAmount,500);const count=records.size;await assert.rejects(c.applyTeacherAttendance({},true));assert.equal(records.size,count);});
test('gift late attendance does not charge administration fee',async()=>{const {c,records}=fixture({gift:true});await c.applyTeacherAttendance({},true);assert.equal(records.get('coursePortalLateAttendance/op').administrationFee,0);assert(!records.has('coursePortalTeacherAdjustments/attendance-fee-op'));});
test('late attendance cannot be used on today or future dates',async()=>{for(const date of ['2026-09-15','2026-09-16'])await assert.rejects(fixture({date}).c.applyTeacherAttendance({},true));});
test('ordinary attendance cannot use the past-date late permission',async()=>{await assert.rejects(fixture().c.applyTeacherAttendance({},false));});
test('pending correction returns a choice without a write; ordinary new client signs in one call',async()=>{const f=fixture({date:'2026-09-15',pending:[{id:'correction'}]});const r=await f.c.applyTeacherAttendance({returnCorrectionChoice:true},false);assert.equal(r.requiresCorrectionChoice,true);assert.equal(f.records.size,1);const g=fixture({date:'2026-09-15'});assert.equal((await g.c.applyTeacherAttendance({returnCorrectionChoice:true},false)).ok,true);assert(g.records.has('payroll/op'));});
test('existing client correction preflight remains compatible',async()=>{const f=fixture({date:'2026-09-15',pending:[{id:'correction'}]});assert.equal((await f.c.applyTeacherAttendance({},false)).ok,true);});

test('half-hour preview does not write; confirmed duration is stored once without moving the timetable',async()=>{
 for(const minutes of [30,60,90]){
  const f=fixture({date:'2026-09-15',half:true});
  const preview=await f.c.applyTeacherAttendance({attendancePreview:true},false);
  assert.equal(preview.halfHourPlan,true);assert.equal(preview.defaultDurationMinutes,60);assert.deepEqual(Array.from(preview.durationOptions),[30,60,90]);assert.equal(f.records.size,1);
  const result=await f.c.applyTeacherAttendance({attendanceDurationMinutes:minutes},false);
  const saved=[...f.records].find(([k])=>k.startsWith('attendance/'))[1];
  assert.equal(saved.lessonUnits,minutes/30);assert.equal(saved.durationMinutes,minutes);assert.equal(saved.lessonUnitMinutes,30);
  assert.equal(saved.startTime,'17:00');assert.equal(saved.endTime,'18:00');
  assert.equal(f.records.get('payroll/op').durationMinutes,minutes);
  assert.equal(result.attendanceDurationMinutes,minutes);assert.match(result.message,new RegExp('已扣 '+minutes/30+' 格'));
  const status=[...f.records].find(([k])=>k.startsWith('coursePortalScheduleChanges/'))[1];
  assert.equal(status.event.endTime,'18:00');assert.equal(status.event.attendanceDurationMinutes,minutes);
  const count=f.records.size;await assert.rejects(f.c.applyTeacherAttendance({attendanceDurationMinutes:minutes},false));assert.equal(f.records.size,count);
 }
});

test('late preview charges nothing, chosen half-hour duration still produces only one late fee',async()=>{
 const f=fixture({half:true});const preview=await f.c.applyTeacherAttendance({attendancePreview:true},true);
 assert.equal(preview.lateFee,50);assert.equal(f.records.size,1);
 await f.c.applyTeacherAttendance({attendanceDurationMinutes:90},true);
 assert.equal(f.records.get('coursePortalTeacherAdjustments/attendance-fee-op').amount,-50);
 assert.equal([...f.records.keys()].filter(k=>k.startsWith('coursePortalTeacherAdjustments/')).length,1);
});
const stateCode=fs.readFileSync('teacher-operation-state.js','utf8');
function coordinator(options){const c={setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(stateCode,c);return c.YouziTeacherOperations.create(options);}
test('lesson lock suppresses duplicates and allows a different lesson',()=>{const o=coordinator({});assert(o.begin('a'));assert(!o.begin('a'));assert(o.begin('b'));o.finish('a');assert(!o.busy('a'));assert(o.busy('b'));o.finish('b');});
test('old refresh is discarded across a new write and retries only pending dates',async()=>{let resolve;const reads=[],applied=[];const o=coordinator({read:dates=>{reads.push(dates);return new Promise(r=>resolve=r)},apply:x=>applied.push(x),error:()=>{}});o.saved(['2026-09-15']);const first=o.flush();o.begin('b');resolve('stale');await first;assert.equal(applied.length,0);o.saved(['2026-09-16']);o.finish('b');const next=o.flush();resolve('fresh');await next;assert.deepEqual(Array.from(reads[1]),['2026-09-15','2026-09-16']);assert.deepEqual(applied,['fresh']);});
test('refresh failure retains dates for a read-only retry',async()=>{let count=0,errors=0;const o=coordinator({read:async()=>{if(++count===1)throw Error('offline');return{}},apply:()=>{},error:()=>errors++});o.saved(['2026-09-15']);await o.flush();assert.equal(errors,1);await o.flush();assert.equal(count,2);});
