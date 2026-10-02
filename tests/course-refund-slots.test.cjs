const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ledger=require('../course-lesson-units');
for(const file of ['course-scheduler.js','operations-course-inline-runtime.js']){
  function fixture(){
    const source=fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8');
    const period={id:'p',lessonCount:4,usedCount:2,lessonAdjustments:[]};
    const fields={},boxes=[];
    const get=id=>fields[id]||(fields[id]={value:'',innerHTML:'',classList:{toggle(){}}});
    Object.defineProperty(get('refundSlotChoices'),'innerHTML',{set(html){this.html=html;boxes.splice(0);for(const m of html.matchAll(/data-refund-slot="(\d+)" ([^>]*)/g))boxes.push({checked:m[2].includes('checked'),dataset:{refundSlot:m[1]}});},get(){return this.html;}});
    const context={state:{attendance:[{periodId:'p',lessonNo:1,status:'attended',date:'2026-09-01'},{periodId:'p',lessonNo:2,status:'attended',date:'2026-09-08'}]},window:{YouziLessonUnits:ledger},numberOf:v=>Number(v)||0,clean:v=>String(v||''),normalizedStatus:v=>v,periodById:()=>period,periodNetExpectedAmount:()=>2800,money:v=>String(v),esc:v=>String(v),$:get,$$:()=>boxes,isSandbox:()=>true};
    vm.createContext(context);
    for(const name of ['refundOccupiedSlots','availableRefundSlots','attendanceAtSlot','renderRefundLessonOptions','syncRefundSelection','periodLessonSlots']){
      const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  function ',start+5);vm.runInContext(source.slice(start,end),context);
    }
    get('transactionType').value='refund';get('transactionPeriodId').value='p';
    return {context,period,get,boxes};
  }
  test(file+': defaults to all unconsumed lessons and computes the amount',()=>{
    const f=fixture();f.context.renderRefundLessonOptions();
    assert.deepEqual(f.boxes.map(b=>[b.dataset.refundSlot,b.checked]),[['3',true],['4',true]]);
    assert.equal(f.get('transactionRefundCount').value,'2');assert.equal(f.get('transactionAmount').value,1400);
    f.get('transactionRefundCount').value='1';f.context.syncRefundSelection(true);assert.deepEqual(f.boxes.map(b=>b.checked),[true,false]);
    f.boxes.forEach(b=>b.checked=false);f.context.syncRefundSelection(false);assert.equal(f.get('transactionAmount').value,0);assert.equal(f.get('transactionRefundCount').value,'');
  });
  test(file+': explicit slot selection, previous refund and half lesson handling',()=>{
    const f=fixture();f.get('transactionPreferredSlot').value='4';f.context.renderRefundLessonOptions();assert.deepEqual(f.boxes.filter(b=>b.checked).map(b=>b.dataset.refundSlot),['4']);
    f.period.lessonAdjustments=[{slotNo:4,type:'refund',date:'2026-10-02'}];
    f.period.usedCount=2.5;f.context.state.attendance.push({periodId:'p',lessonNo:3,status:'attended',lessonUnits:0.5,date:'2026-09-15'});
    assert.equal(f.context.availableRefundSlots(f.period).length,0);
    assert.match(f.context.periodLessonSlots(f.period),/已退費/);
  });
  test(file+': normal lesson grid shows refunded third and fourth lessons',()=>{
    const f=fixture();f.period.lessonAdjustments=[3,4].map(slotNo=>({slotNo,type:'refund',date:'2026-10-02'}));
    const html=f.context.periodLessonSlots(f.period);assert.equal((html.match(/已退費/g)||[]).length,2);assert.equal((html.match(/已上課/g)||[]).length,2);
  });
}
