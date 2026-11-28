const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../operations-course-inline-runtime.js'),'utf8');
function fn(name){const start=source.indexOf('  function '+name+'(');assert(start>=0);return source.slice(start,source.indexOf('\n  function ',start+5));}
test('choosing several months performs no requests until query is invoked',()=>{
 const nodes={teacherListMonth:{value:'2026-10'}},selected=[];
 const ctx={$:id=>nodes[id],todayKey:()=> '2026-10-08',normalizedMonthKey:x=>x,renderTeachers:()=>selected.push(nodes.teacherListMonth.value),setTeacherPayrollSyncState:()=>{},refreshTeacherPayrollMonth:()=>{throw Error('unrequested fetch');}};
 vm.createContext(ctx);vm.runInContext(fn('setTeacherListMonth'),ctx);ctx.setTeacherListMonth('2026-09');ctx.setTeacherListMonth('2026-08');assert.deepEqual(selected,['2026-09','2026-08']);
});
test('cached salary opens without requests; concurrent query shares work and explicit refresh reads again',async()=>{
 let calls=0,release;const nodes=new Map(),element=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',classList:{contains:()=>false}});return nodes.get(id);};
 const ctx={state:{teacherPayroll:[],teacherAdjustments:[]},currentView:'teachers',teacherPayrollMonthRefreshes:{},normalizedMonthKey:x=>x,teacherMonthLabel:x=>x,teacherListMonthKey:()=> '2026-09',setTeacherPayrollSyncState:()=>{},$:element,renderTeachers:()=>{},save:()=>{},storedMigrationPin:()=>'',clean:x=>String(x||''),toast:()=>{},window:{YouziCoursePreviewData:{loadTeacherPayrollMonth:async()=>{calls++;if(calls===1)await new Promise(r=>release=r);return {payout:{},teacherPayoutPayroll:[],teachers:[{id:'t'}],subjects:[{id:'s'}],teacherPayroll:[],teacherAdjustments:[]};}}}};
 vm.createContext(ctx);const start=source.indexOf('  function ensureTeacherPayrollMonth('),end=source.indexOf('  function renderTeachers(',start);vm.runInContext(source.slice(start,end),ctx);
 const a=ctx.ensureTeacherPayrollMonth('2026-09'),b=ctx.ensureTeacherPayrollMonth('2026-09');assert.equal(calls,1);release();await Promise.all([a,b]);await ctx.ensureTeacherPayrollMonth('2026-09');assert.equal(calls,1);assert.equal(ctx.state.teachers[0].id,'t');await ctx.refreshTeacherPayrollMonth('2026-09');assert.equal(calls,2);
});
test('payroll first entry defers calendar until calendar is selected',()=>{
 const calls=[],ctx={currentView:'teachers',payrollEntryOnly:true,studentHistoryMode:false,$:()=>({textContent:''}),$$:()=>[],renderTeachers:()=>calls.push('teachers'),renderCalendar:()=>calls.push('calendar'),loadPublishedWorkspace:()=>calls.push('fetch-calendar'),window:{scrollTo:()=>{}},embeddedMode:false};vm.createContext(ctx);vm.runInContext(fn('switchView'),ctx);ctx.switchView('teachers');assert.deepEqual(calls,['teachers']);ctx.switchView('calendar');ctx.switchView('calendar');assert.deepEqual(calls,['teachers','calendar','fetch-calendar','calendar']);
});

test('entering teacher payroll selects and queries this month',()=>{
  const month={value:'2026-09'},requests=[];
  const ctx={currentView:'calendar',todayKey:()=>'2026-11-28',teacherListMonthKey:()=>month.value,
    $:id=>id==='teacherListMonth'?month:{},$$:()=>[],renderTeachers(){},
    refreshTeacherPayrollMonth:value=>requests.push(value),window:{scrollTo(){}},embeddedMode:false};
  vm.createContext(ctx);vm.runInContext(fn('switchView'),ctx);
  ctx.switchView('teachers');
  assert.deepEqual(requests,['2026-11']);
  month.value='2026-08';ctx.switchView('teachers');assert.equal(month.value,'2026-08');
  ctx.switchView('teachers',true);assert.equal(month.value,'2026-11');
});

test('optional student appears before the reason for both kinds of adjustments',async()=>{
  const start=source.indexOf('  async function submitTeacherAdjustment(');
  const body=source.slice(start,source.indexOf('\n  function ',start));
  const nodes={},sent=[];
  const element=id=>nodes[id]||={value:'',classList:{add(){},remove(){},contains(){return false;}}};
  const ctx={$:element,numberOf:Number,teacherById:id=>({id}),operationRunning:false,operationButton(){},state:{teacherAdjustments:[]},
    window:{YouziCoursePreviewData:{async saveTeacherAdjustment(row){sent.push(row);return {adjustment:row};}}},
    clean:String,money:String,upsert(){},save(){},closeModal(){},renderTeachers(){},toast(){},attendanceUpdater:null};
  vm.createContext(ctx);vm.runInContext(body,ctx);
  for(const [student,typed,expected] of [['學生甲','','學生甲｜代購課本'],['__manual__','學生乙','學生乙｜代購課本'],['','','代購課本'],['__manual__','','代購課本']]){
    for(const type of ['reward','deduction']){
      Object.entries({TeacherId:'T',Date:'2026-11-28',Amount:'200',Type:type,Note:'代購課本',Student:student,StudentName:typed})
        .forEach(([key,value])=>element('teacherAdjustment'+key).value=value);
      await ctx.submitTeacherAdjustment({preventDefault(){}});
      assert.equal(sent.at(-1).note,expected);assert.equal(sent.at(-1).type,type);
    }
  }
});
