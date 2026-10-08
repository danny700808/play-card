const {test}=require('node:test'),assert=require('node:assert/strict');
const {label}=require('../payroll-payout-view');
const {slots}=require('../course-lesson-units');
const fs=require('node:fs'),vm=require('node:vm');
test('compact late labels preserve original lesson and distinguish cutoff batches',()=>{
 const r={date:'2026-09-05',attendanceSignedAt:'2026-10-08 10:00:00',expectedPayDate:'2026-10-10'};
 assert.equal(label(r),'補簽到｜10/8 補簽 9/5 的課｜10 月薪資・10/10 發放');
 assert.equal(label({...r,attendanceSignedAt:'2026-10-10 00:00:00',expectedPayDate:'2026-11-10'}),'補簽到｜10/10 補簽 9/5 的課｜11 月薪資・11/10 發放');
 assert.equal(label({date:'2026-09-05',expectedPayDate:'2026-10-10'}),'');
});
test('late record appends after earlier recorded lessons without changing original date or total units',()=>{
 const rows=[{id:'late',date:'2026-09-05',attendanceRecordedAt:'2026-10-08 10:00:00',late:true},{id:'third',date:'2026-09-12'},{id:'first',date:'2026-09-01'},{id:'fourth',date:'2026-09-19'}];
 const result=slots({lessonCount:4,usedCount:4},rows);
 assert.deepEqual(result.map(parts=>parts[0].id),['first','third','fourth','late']);
 assert.equal(result[3][0].date,'2026-09-05');
 assert.equal(result.flat().reduce((n,r)=>n+r.slotUnits,0),4);
 const half=slots({lessonCount:2,usedCount:2},rows.map(r=>({...r,lessonUnits:.5})));
 assert.deepEqual(half.flat().map(r=>r.id),['first','third','fourth','late']);
});
test('desktop salary navigation renders without automatic payroll or full workspace fetch',()=>{
 const source=fs.readFileSync(require.resolve('../operations-course-inline-runtime.js'),'utf8');
 const start=source.indexOf('  function switchView(view){'),end=source.indexOf('\n  function ',start+5);
 const calls=[],ctx={currentView:'calendar',studentHistoryMode:false,afterWorkspaceReady:()=>{throw Error('full workspace read');},$:()=>({classList:{},textContent:''}),$$:()=>[],renderTeachers:()=>calls.push('render'),refreshTeacherPayrollMonth:()=>calls.push('month'),teacherListMonthKey:()=> '2026-09',window:{scrollTo:()=>{}},embeddedMode:false};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'\nswitchView("teachers");',ctx);
 assert.deepEqual(calls,['render']);
});
test('calendar bootstrap preserves desktop payroll selection and loaded month',()=>{
 const source=fs.readFileSync(require.resolve('../operations-course-inline-runtime.js'),'utf8');
 const start=source.indexOf('  function applyCalendarState(loaded){'),end=source.indexOf('\n  function ',start+5);
 const payroll=[{id:'paid'}],ctx={workspaceSaveTimer:null,clearTimeout:()=>{},mobileAdmin:()=>false,currentView:'teachers',state:{teacherPayroll:payroll,teacherAdjustments:[],dataMeta:{teacherPayrollMonths:['2026-09']}},clone:x=>x,normalizeState:x=>x,preserveWorkspaceConfiguration:x=>x,updateModeUI:()=>{},refreshFormOptions:()=>{},switchView:v=>{ctx.selected=v;}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'\napplyCalendarState({dataMeta:{partial:true}});',ctx);
 assert.equal(ctx.selected,'teachers');assert.equal(ctx.state.teacherPayroll,payroll);assert.equal(ctx.state.dataMeta.teacherPayrollMonths[0],'2026-09');
});
test('manager corrections retain original lesson position despite later creation timestamp',()=>{
 const rows=[{id:'first',date:'2026-09-06'},{id:'corrected',date:'2026-09-13',late:false,attendanceRecordedAt:'2026-10-08 12:00:00'},{id:'third',date:'2026-09-20'},{id:'fourth',date:'2026-09-27'}];
 assert.deepEqual(slots({lessonCount:4,usedCount:4},rows).flat().map(r=>r.id),['first','corrected','third','fourth']);
});
