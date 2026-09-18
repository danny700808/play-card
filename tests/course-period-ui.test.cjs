const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const file of ['course-scheduler.js','operations-course-inline-runtime.js']) {
 const source=fs.readFileSync(file,'utf8');
 test(file+': each historical period exposes its own edit, delete, and payment correction',()=>{
  const start=source.indexOf('  function tuitionTableHtml('),end=source.indexOf('  var tuitionReceiptViewer',start);
  const state={tuitionPeriods:Array.from({length:28},(_,i)=>({id:'p'+(i+1),studentId:'s',subjectId:'drums',periodNo:i+1,transactions:[{id:'t'+i,date:'2026-09-18',amount:2800}],planSnapshot:{name:'鼓'}}))};
  const ctx={state,displayTransactionMethod:x=>String(x||''),clean:x=>String(x||''),esc:x=>String(x||''),numberOf:Number,money:x=>String(x),feeById:()=>({}),periodBalance:()=>0,subjectById:()=>({name:'鼓'}),isSandbox:()=>true,periodLessonSlots:()=>''};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
  const html=ctx.tuitionTableHtml('s',{eventId:'event',currentPeriodId:'p26'});assert.equal((html.match(/data-period-delete=/g)||[]).length,28);assert.equal((html.match(/data-transaction-correct=/g)||[]).length,28);assert.ok(!html.includes('data-event-action'));
 });
 test(file+': receipt stays in page, one request despite repeated clicks, and remains closed when dismissed',async()=>{
  const start=source.indexOf('  var tuitionReceiptViewer'),end=source.indexOf('  async function refreshTuitionAfterCorrection',start);let resolve,calls=0,opens=0,panel;
  const body={textContent:'',innerHTML:'',querySelector:()=>({})};const close={};
  const document={createElement:()=>panel={style:{},isConnected:false,setAttribute(){},remove(){this.isConnected=false;},querySelector:s=>s==='[data-receipt-close]'?close:body},body:{appendChild:p=>p.isConnected=true}};
  const window={open:()=>{opens++;},YouziCoursePreviewData:{ensureTuitionReceipt:()=>{calls++;return new Promise(r=>resolve=r);}}};
  const ctx={document,window,clean:x=>String(x||''),esc:x=>String(x||''),numberOf:Number,periodById:()=>({id:'p',transactions:[{id:'t',date:'2026-09-18',amount:2800}]}),toast(){}};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
  const button={dataset:{tuitionReceiptPeriod:'p',tuitionReceiptIndex:'0'}};const pending=ctx.ensureAndOpenTuitionReceipt(button);await ctx.ensureAndOpenTuitionReceipt(button);assert.equal(calls,1);assert.equal(opens,0);assert.equal(button.disabled,true);close.onclick();resolve({receiptImageUrl:'https://example.com/r.png'});await pending;assert.equal(panel.isConnected,false);assert.equal(button.disabled,false);assert.equal(opens,0);
 });
}

