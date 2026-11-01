'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {database}=require('./helpers/security-fixtures.cjs');
const {createEmployeeAttendance,networkCheck,reminderPlans}=require('../functions/employeeAttendance');
const {createScheduleComputer}=require('../functions/employeeAttendanceSchedule');
const {queueBlockReason}=require('../functions/notificationDeliveryGuard');
const employee={employeeId:'e1',email:'test@example.test',name:'測試員工',accountStatus:'active',role:'staff',identityType:'parttime',lineUserId:'line-test',lineNotifyEnabled:true};
const shift={employeeId:'e1',recordId:'s1',date:'2026-11-02',startTime:'18:00',endTime:'21:00',enabled:true};
const at=time=>new Date('2026-11-02T'+time+':00+08:00');
function setup(){return database({'employees/e1':employee,'singleDaySchedules/s1':shift,'systemSettings/employeeAttendanceReminders':{enabled:true}});}
test('company Wi-Fi is enforced on the trusted public hop; sign-out does not require it',()=>{
 assert.equal(networkCheck({rawRequest:{headers:{'x-forwarded-for':'125.229.190.123'}}}),'125.229.190.123');
 assert.throws(()=>networkCheck({rawRequest:{headers:{'x-forwarded-for':'125.229.190.123, 203.0.113.2'},ip:'125.229.190.123'},data:{clientIp:'125.229.190.123'}}),/公司 Wi-Fi/);
 assert.throws(()=>networkCheck({}),/公司 Wi-Fi/);
 assert.equal(networkCheck({rawRequest:{headers:{'x-forwarded-for':'203.0.113.2'}}},'下班打卡'),'203.0.113.2');
});
test('server clock uses authenticated owner/time/schedule, rejects offsite and duplicate submissions',async()=>{
 const f=setup();let time=at('17:59');const api=createEmployeeAttendance({...f,now:()=>time});
 const key=(await createScheduleComputer({singleDaySchedules:[shift]}).day(employee,shift.date)).schedules[0].scheduleKey;
 const request={rawRequest:{headers:{'x-forwarded-for':'125.229.190.123'}}};
 const payload={actionName:'上班打卡',scheduleKey:key,employeeId:'another',clockTime:'01:00',clientIp:'125.229.190.123'};
 await assert.rejects(api.clock(payload,{rawRequest:{headers:{'x-forwarded-for':'203.0.113.2'}}},employee),/公司 Wi-Fi/);
 await assert.rejects(api.clock({...payload,scheduleKey:'fake'},request,employee),/班表/);
 const inResult=await api.clock(payload,request,employee),row=f.rows.get('clockRecords/'+inResult.recordId);
 assert.equal(row.employeeId,'e1');assert.equal(row.clockTime,'17:59:00');assert.equal(row.status,'正常');assert.equal(row.networkVerified,true);
 await assert.rejects(api.clock(payload,request,employee),/完成/);
 time=at('21:00');const out=await api.clock({...payload,actionName:'下班打卡'},{rawRequest:{headers:{'x-forwarded-for':'203.0.113.2'}}},employee);
 assert.equal(f.rows.get('clockRecords/'+out.recordId).status,'正常');
});
test('LINE reminders are once before work, at end, once after one hour; duplicate runs do not enqueue twice',async()=>{
 const f=setup(),api=createEmployeeAttendance(f);
 for(const [time,want] of [['17:49',0],['17:50',1],['17:51',0],['18:00',0],['21:00',1],['21:01',0],['21:59',0],['22:00',1],['22:01',0],['23:00',0]])assert.equal((await api.run({at:at(time)})).queued,want,time);
 const queues=[...f.rows].filter(([k])=>k.startsWith('notificationQueue/')).map(([,v])=>v);assert.equal(queues.length,3);
 assert(queues.every(r=>r.channel==='line'&&r.emailFallbackEnabled===false&&r.body.includes('login.html?next=dashboard.html')));
 assert.equal(queueBlockReason(queues[0],at('18:00').getTime()),'打卡提醒已過時，停止補送。');
});
test('punched, approved leave, temporary coverage and disabled people are excluded; dry run never writes',async()=>{
 for(const kind of ['clock','leave','temporary','disabled','dry']){
  const f=setup();
  if(kind==='clock')f.rows.set('clockRecords/in',{employeeId:'e1',clockDate:shift.date,clockTime:'17:45',actionName:'上班打卡',status:'正常'});
  if(kind==='leave')f.rows.set('leaveRequests/l1',{employeeId:'e1',status:'已核准',leaveDate:shift.date,segments:[{date:shift.date,allDay:true}]});
  if(kind==='temporary')f.rows.set('temporaryAttendanceRequests/t1',{employeeId:'e1',status:'已核准',date:shift.date,startTime:'18:00',endTime:'21:00'});
  if(kind==='disabled')f.rows.get('employees/e1').accountStatus='disabled';
  const result=await createEmployeeAttendance(f).run({at:at('17:50'),dryRun:kind==='dry'});assert.equal(result.queued,0,kind);assert.equal(result.ok,true,JSON.stringify(result));
 }
});
test('partial leave adjusts reminders and an out punch cancels the second reminder',async()=>{
 const f=setup();f.rows.set('leaveRequests/l1',{employeeId:'e1',status:'已核准',segments:[{date:shift.date,mode:'custom',startTime:'18:00',endTime:'19:00'}]});
 const api=createEmployeeAttendance(f);assert.equal((await api.run({at:at('17:50')})).queued,0);assert.equal((await api.run({at:at('18:50')})).queued,1);
 f.rows.set('clockRecords/out',{employeeId:'e1',clockDate:shift.date,clockTime:'21:05',actionName:'下班打卡',status:'正常'});
 assert.equal((await api.run({at:at('22:00')})).queued,0);
});
test('delivery rechecks attendance and does not send stale queued reminders',async()=>{
 const f=setup(),api=createEmployeeAttendance({...f,now:()=>at('21:01')});await api.run({at:at('21:00')});
 const row=[...f.rows].find(([k])=>k.startsWith('notificationQueue/'))[1];assert.equal(await api.stillNeeded(row),true);
 f.rows.set('clockRecords/out',{employeeId:'e1',clockDate:shift.date,clockTime:'21:00',actionName:'下班打卡',status:'正常'});assert.equal(await api.stillNeeded(row),false);
});
