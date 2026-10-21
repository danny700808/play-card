const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const file of ['course-scheduler.js','operations-course-inline-runtime.js']){
 const source=fs.readFileSync(file,'utf8');
 function extract(name){const start=source.indexOf('  function '+name+'(');assert(start>=0);let end=source.indexOf('\n  function ',start+1);return source.slice(start,end);}
 function context(extra={}){const c={numberOf:v=>Number(v)||0,clean:v=>String(v||''),Math,Array,money:v=>'$'+v,...extra};vm.createContext(c);return c;}
 test(file+': legacy ratios convert to amounts without changing tuition',()=>{
  const c=context();vm.runInContext(extract('periodNetExpectedAmount')+extract('tuitionReductionAmount'),c);
  for(const [period,reduction,net] of [[{expectedAmount:2800,discount:.25},700,2100],[{expectedAmount:2800,discount:.75},2100,700],[{expectedAmount:2800,discount:2100,discountType:'amount'},2100,700],[{expectedAmount:2800,discount:1,discountType:'amount'},1,2799],[{expectedAmount:2800,discount:.25,discountType:'amount'},.25,2799.75]]){
   assert.equal(c.tuitionReductionAmount(period),reduction);assert.equal(c.periodNetExpectedAmount({...period,discount:reduction,discountType:'amount'}),net);
  }
 });
 test(file+': an inactive historical student can remain selected without changing active status',()=>{
  const select={options:[],appendChild(o){this.options.push(o);}};
  const c=context({$:()=>select,studentById:()=>({name:'林明彥',active:false}),document:{createElement:()=>({})}});vm.runInContext(extract('selectTuitionStudent'),c);
  c.selectTuitionStudent('legacy');c.selectTuitionStudent('legacy');assert.equal(select.options.length,1);assert.equal(select.value,'legacy');assert.equal(select.options[0].textContent,'林明彥');
 });
 test(file+': save uses the original student and explicit currency discount, preserves payment and voided slots',async()=>{
  const base={id:'p4',studentId:'legacy',periodNo:4,usedCount:1,voidedLessonCount:3,transactions:[{amount:700}],lessonAdjustments:[{slotNo:2},{slotNo:3},{slotNo:4}]};
  const values={tuitionId:'p4',tuitionStudent:'',tuitionPlan:'plan',tuitionAmount:'2800',tuitionDiscount:'2100',tuitionLessonCount:'4',tuitionSubject:'drums',tuitionStartDate:'2026-02-13',tuitionNote:''};const fields={};for(const [key,value] of Object.entries(values))fields[key]={value};
  let payload,pending;const c=context({$:id=>fields[id]||(fields[id]={value:'',dataset:{},classList:{contains:()=>false}}),writable:()=>true,feeById:()=>({id:'plan'}),periodById:()=>base,tuitionPurchaseCount:()=>1,state:{tuitionPeriods:[base]},uid:()=> 'operation',runUiOperation:(_m,_b,fn)=>pending=fn(),window:{YouziCoursePreviewData:{saveTuitionPeriods:async p=>payload=p}},storedMigrationPin:()=>'',teacherListMonthKey:()=>'',teacherPayrollMonthRefreshes:{},refreshTeacherPayrollMonth:async()=>{},save(){},studentById:()=>({name:'林明彥'}),scheduleDraftAfterTuition:null,closeModal(){},currentView:'calendar',toast(){},clone:v=>structuredClone(v),todayKey:()=> '2026-10-21'});
  vm.runInContext(extract('submitTuition'),c);c.submitTuition({preventDefault(){}});await pending;
  assert.equal(payload.periods[0].studentId,'legacy');assert.equal(payload.periods[0].discount,2100);assert.equal(payload.periods[0].discountType,'amount');assert.equal(base.transactions[0].amount,700);assert.equal(base.voidedLessonCount,3);assert.equal(base.lessonAdjustments.length,3);
 });
}
