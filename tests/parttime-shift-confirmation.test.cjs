'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {database}=require('./helpers/security-fixtures.cjs');
const {createEmployeeAttendance}=require('../functions/employeeAttendance');
const {createShiftConfirmation}=require('../functions/parttimeShiftConfirmation');
const date='2026-11-25', user={employeeId:'pt',identityType:'parttime',name:'測試',hourlyRate:200};
const pay='parttimeRecords/PT_pt_20261125';
function setup(time='17:00'){
  const fixture=database({'employees/pt':user,'singleDaySchedules/s':{employeeId:'pt',date,startTime:'12:00',endTime:'16:00',enabled:true}});
  const now=()=>new Date(date+'T'+time+':00+08:00');
  const service=createShiftConfirmation({...fixture,now,attendance:createEmployeeAttendance({...fixture,now})});
  const call=(mode,body={})=>service.process(user,{workDate:date,...body},mode);
  const punch=(id,action,t)=>fixture.rows.set('clockRecords/'+id,{employeeId:'pt',recordId:id,clockDate:date,clockTime:t,actionName:action,status:'正常'});
  const day=async()=>(await call('context')).shifts[0];
  const confirm=async answers=>call('submit',{scheduleKey:(await day()).key,answers});
  return {...fixture,call,punch,day,confirm,service};
}
test('normal and incomplete punches take different registration paths',async()=>{
  const f=setup('14:00');await assert.rejects(f.call('normal',{hours:4}),/打卡/);
  await assert.rejects(f.confirm([]),/先打卡/);assert.equal(f.rows.has(pay),false);
  f.punch('i','上班打卡','11:59');await assert.rejects(f.call('normal',{hours:4}),/打卡/);
  f.punch('o','下班打卡','16:01');assert.equal((await f.day()).exception,false);
  await f.call('normal',{hours:4});assert.equal(f.rows.get(pay).grossPay,800);
});
test('late clock on its own is not registered as a second deduction; repeat submit is idempotent',async()=>{
  const f=setup();f.punch('i','上班打卡','12:30');f.punch('o','下班打卡','16:00');
  await assert.rejects(f.call('normal',{hours:4}),/確認/);
  const answers=[{choice:'actual',reason:'晚到'}];
  await Promise.all([f.confirm(answers),f.confirm(answers)]);
  assert.equal(f.rows.get(pay).workedMinutes,210);assert.equal(f.rows.get(pay).grossPay-100,700);
  assert.equal([...f.rows.keys()].filter(k=>k.startsWith('clockCorrections/')).length,0);
});
test('earlier correction appears pending in hours form; applying approval updates the same payroll row',async()=>{
  const f=setup();f.punch('i','上班打卡','12:30');
  const payload={correctAction:'上班打卡',correctTime:'12:00',originalRecordId:'i',reason:'忘了打卡'};
  const r=await f.call('correction',payload);assert.equal((await f.call('correction',payload)).requestId,r.requestId);
  assert.equal(f.rows.has(pay),false);
  f.punch('o','下班打卡','16:00');
  assert.equal((await f.day()).sides[0].status,'待審核');
  await f.confirm([]);assert.equal(f.rows.get(pay).workedMinutes,210);
  assert.equal([...f.rows.keys()].filter(k=>k.startsWith('clockCorrections/')).length,1);
  const c=f.rows.get('clockCorrections/'+r.requestId);c.status='已核准';f.punch('i','上班打卡','12:00');
  await f.service.refresh(c);assert.equal(f.rows.get(pay).workedMinutes,240);assert.equal(f.rows.get(pay).grossPay,800);
});
test('missing both punches submits hours and both requests together; no salary until pair exists',async()=>{
  const f=setup();await f.confirm([{choice:'correct',time:'12:00',reason:'漏打'},{choice:'correct',time:'16:00',reason:'漏打'}]);
  assert.equal(f.rows.has(pay),false);
  const apps=[...f.rows].filter(([k])=>k.startsWith('clockCorrections/')).map(([,v])=>v);
  assert.equal(apps.length,2);
  for(const [i,c] of apps.entries()){c.status='已核准';f.punch('approved'+i,c.correctAction,c.correctTime);await f.service.refresh(c);assert.equal(f.rows.has(pay),i===1);}
  assert.equal(f.rows.get(pay).totalHours,4);
});
test('actual early finish, two shifts and double rate do not bill time twice',async()=>{
  const f=setup('20:00');
  f.rows.set('singleDaySchedules/s2',{employeeId:'pt',date,startTime:'17:00',endTime:'19:00',enabled:true});
  f.punch('i','上班打卡','12:30');f.punch('o','下班打卡','15:45');
  const [s1,s2]=(await f.call('context')).shifts;
  await f.call('submit',{scheduleKey:s1.key,doublePay:true,answers:[{choice:'actual',reason:'晚到'},{choice:'actual',reason:'早退'}]});
  assert.equal(f.rows.get(pay).grossPay-100,1300);
  f.punch('i2','上班打卡','17:00');f.punch('o2','下班打卡','19:00');
  await f.call('submit',{scheduleKey:s2.key,answers:[]});assert.equal(f.rows.get(pay).totalHours,5.25);
});

