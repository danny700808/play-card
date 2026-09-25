'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function section(src,start,end){const at=src.indexOf(start);assert(at>=0);return src.slice(at,src.indexOf(end,at));}
for(const file of ['operations-course-inline-runtime.js','course-scheduler.js']){
 const src=fs.readFileSync(file,'utf8');
 function fixture(){
  const nodes=new Map(),writes=[],jobs=[],messages=[];
  const original={id:'rental',portalBookingId:'booking',type:'rental',date:'2026-09-25',start:'15:00',duration:60,roomId:'room',clientName:'租用者',rentalFee:100,rentalPaymentStatus:'onsite_unpaid',status:'scheduled'};
  const ctx={clean:v=>String(v||'').trim(),numberOf:v=>Number(v)||0,clone:v=>JSON.parse(JSON.stringify(v)),permanentScheduleSource:null,scheduleSelectionVersion:0,scheduleDataLoading:false,scheduleStudentLoads:new Map(),
   $:id=>{if(!nodes.has(id))nodes.set(id,{value:'',dataset:{},classList:{toggle(){}},querySelector:()=>({disabled:false}),reset(){}});return nodes.get(id);},
   writable:()=>true,scheduleWritable:()=>true,refreshFormOptions(){},clearScheduleForm(){},updateEventStartOptionsForDate(){},updateTeacherOptions(){},updateTuitionOptions(){},updateRoomOptions(){},updateSpecialLessonFields(){},updateScheduleConflict:()=>[],openModal(){},closeModal(){},roomKindOf:()=>'',roomById:()=>({}),scheduleIsNewStudent:()=>false,findEvent:()=>original,uid:()=> 'request',storedMigrationPin:()=>'',materializeEvent:v=>v,renderCalendar(){},scheduleWorkspaceSave(){},toast:(...args)=>messages.push(args),
   runUiOperation:(label,button,job)=>jobs.push(job),window:{YouziCoursePreviewData:{saveLessonSettings:async data=>{writes.push(data);return {ok:true,fields:{rentalFee:data.event.rentalFee,rentalPaymentStatus:data.event.rentalPaymentStatus,status:data.event.rentalPaymentStatus==='paid'?'attended':'scheduled'}};}}}};
  // Match a real HTML select: assigning a value absent from its options clears it.
  let payment='unpaid';Object.defineProperty(ctx.$('eventRentalPaymentStatus'),'value',{get:()=>payment,set:value=>payment=['paid','unpaid'].includes(value)?value:''});
  vm.createContext(ctx);
  for(const [start,end] of [['  function rentalPaymentValue(','  function rentalPaymentName('],['  function updateScheduleSaveLabels(','  function setScheduleKind('],['  function openSchedule(','  function openPermanentSchedule('],['  function formEvent(){','  function showSavedRefreshRetry('],['  async function persistScheduleChange(','  function nextPeriodNumber(']])vm.runInContext(section(src,start,end),ctx);
  ctx.setScheduleKind=type=>ctx.updateScheduleSaveLabels(type);
  return {ctx,original,writes,jobs,messages};
 }
 test(file+': online unpaid and legacy paid values select valid form options without saving',()=>{
  const f=fixture();for(const [input,expected] of [['onsite_unpaid','unpaid'],['unpaid','unpaid'],['','unpaid'],['paid','paid'],['received','paid'],['已收款','paid']]){
   f.ctx.openSchedule({event:{...f.original,rentalPaymentStatus:input}});assert.equal(f.ctx.$('eventRentalPaymentStatus').value,expected);assert.equal(f.ctx.formEvent().rentalPaymentStatus,expected);
  }
  assert.equal(f.writes.length,0);assert.equal(f.jobs.length,0);
  assert.equal(f.ctx.$('scheduleSubmitBtn').innerHTML,'<span>確定儲存</span>');assert.equal(f.ctx.$('scheduleModalTitle').textContent,'編輯租用資料');
  f.ctx.updateScheduleSaveLabels('fixed');assert.equal(f.ctx.$('scheduleSubmitBtn').innerHTML,'<span>儲存排課</span>');
 });
 test(file+': price and payment drafts stay local until one explicit submit, unpaid never becomes attended',async()=>{
  for(const paid of [false,true]){
   const f=fixture();f.ctx.openSchedule({event:f.original});f.ctx.$('eventRentalFee').value='150';f.ctx.$('eventRentalPaymentStatus').value=paid?'paid':'unpaid';
   assert.equal(f.writes.length,0);assert.equal(f.original.rentalFee,100);assert.equal(f.original.status,'scheduled');
   f.ctx.submitSchedule({preventDefault(){}});assert.equal(f.jobs.length,1);await f.jobs[0]();assert.equal(f.writes.length,1);
   assert.equal(f.writes[0].bookingId,'booking');assert.equal(f.writes[0].kind,'rentalDetails');assert.equal(f.original.rentalFee,150);assert.equal(f.original.status,paid?'attended':'scheduled');assert.equal(f.original.rentalPaymentStatus,paid?'paid':'unpaid');
   assert.equal(f.messages[0][0],'租用資料已儲存');
  }
 });
 test(file+': cancelling a paid draft does not check in; a failed save leaves committed price and status intact',async()=>{
  const f=fixture();f.ctx.openSchedule({event:f.original});f.ctx.$('eventRentalPaymentStatus').value='paid';f.ctx.$('eventRentalFee').value='150';
  f.ctx.openSchedule({event:f.original});assert.equal(f.ctx.$('eventRentalPaymentStatus').value,'unpaid');assert.equal(Number(f.ctx.$('eventRentalFee').value),100);assert.equal(f.writes.length,0);
  f.ctx.$('eventRentalFee').value='200';f.ctx.window.YouziCoursePreviewData.saveLessonSettings=async()=>{throw Error('offline');};f.ctx.submitSchedule({preventDefault(){}});await assert.rejects(f.jobs[0](),/offline/);assert.equal(f.original.rentalFee,100);assert.equal(f.original.status,'scheduled');
 });
 test(file+': saving an attended rental as unpaid removes completion only after confirmation',async()=>{
  const f=fixture();f.original.status='attended';f.original.rentalPaymentStatus='paid';f.ctx.openSchedule({event:f.original});f.ctx.$('eventRentalPaymentStatus').value='unpaid';f.ctx.$('eventRentalFee').value='50';
  assert.equal(f.original.status,'attended');f.ctx.submitSchedule({preventDefault(){}});await f.jobs[0]();assert.equal(f.original.status,'scheduled');assert.equal(f.original.rentalPaymentStatus,'unpaid');assert.equal(f.original.rentalFee,50);
 });
 test(file+': payment selection no longer invokes a write handler',()=>{
  assert.doesNotMatch(src,/autoSaveRentalPayment/);
  assert.doesNotMatch(src,/\$\('eventRentalPaymentStatus'\)\.addEventListener/);
 });
}
