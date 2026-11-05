const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../rental-admin.html'),'utf8');
const cut=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const handler=cut('    let customerReturnSaving=','    window.completeReturn=');
const original={__id:'RC-test',contractId:'RC-test',status:'租賃中',startDate:'2026-10-01',endDate:'2027-01-01',rentFee:2900,depositFee:2000,internalRentalCountCurrent:9,renewalEntries:[{rentFee:2900}],customerLineUserId:'binding',customerSignatureDataUrl:'signature'};
let row,fail=false,exists=true,writes=0,transactions=0,message,rendered,gate;
const btn={disabled:false,textContent:'客人退租'},search={value:'客人'};
const tabs=['active','returned','all'].map(filter=>({dataset:{filter},classList:{toggle:(name,on)=>{tabs.find(t=>t.dataset.filter===filter).active=on;}}}));
const db={collection:name=>{assert.equal(name,'rentalContracts');return {doc:id=>{assert.equal(id,'RC-test');return {id};}};},runTransaction:async fn=>{transactions++;if(gate)await gate;if(fail)throw Error('offline');return fn({get:async()=>({exists,data:()=>row}),set:(ref,patch,opts)=>{assert.equal(opts.merge,true);writes++;row={...row,...patch};}});}};
const ctx={window:{},R:{val:()=> 'RC-test',clean:v=>String(v||'').trim(),esc:v=>String(v||''),qs:k=>k==='customerReturnBtn'?btn:search,db:()=>db,nowText:()=> '2026-11-05 15:30:00',toast:(text,ok)=>{message={text,ok};}},firebase:{firestore:{FieldValue:{serverTimestamp:()=> 'SERVER_TIMESTAMP'}}},document:{querySelectorAll:()=>tabs},contracts:[],selected:null,filter:'active',searchKeyword:'客人',updateRentalSearchHint:()=>{},renderStats:()=>{},renderList:()=>{},renderContract:c=>{rendered=c;},loadAll:async()=>{},hasFormalSubmittedData:()=>false};
vm.createContext(ctx);
vm.runInContext(handler,ctx);
vm.runInContext(cut('    function actionButtons(','    function adminBaseUrl('),ctx);
vm.runInContext(cut('    function renewalAdminHtml(','    function isFinalConfirmStage('),ctx);
vm.runInContext(cut('    function rentalTodayTaiwan(','    function rentalSearchText(').split('    const rentalSearchCache')[0],ctx);
function reset(overrides={}){row=structuredClone({...original,...overrides});ctx.contracts=[row];ctx.selected=row;ctx.filter='active';ctx.searchKeyword='客人';search.value='客人';writes=0;transactions=0;fail=false;exists=true;gate=null;}
(async()=>{
  for(const status of ['租賃中','到期提醒中','續約待確認','續約待付款']){
    reset({status,pendingRenewal:status.startsWith('續約')?{startDate:'2027-01-02'}:null});
    const buttons=ctx.actionButtons('contract',row);
    assert(buttons.includes('客人退租'));
    assert(buttons.indexOf('客人退租')<buttons.indexOf('預覽 / 列印'));
    if(status==='租賃中')assert(buttons.indexOf('客人退租')>buttons.indexOf('傳送續約 / 退租連結給客人'));
    const before=structuredClone(row);
    await ctx.window.markCustomerReturned();
    assert.equal(row.status,'已退租');assert.equal(writes,1);
    for(const key of Object.keys(before).filter(k=>k!=='status'))assert.deepEqual(row[key],before[key],key+' preserved');
    assert.equal(row.returnedAt,'SERVER_TIMESTAMP');assert.equal(row.returnedAtText,'2026-11-05 15:30:00');
    assert.equal(ctx.filter,'returned');assert.equal(search.value,'');assert(tabs.find(t=>t.dataset.filter==='returned').active);
    assert.equal(rendered.status,'已退租');assert.equal(ctx.contracts[0].status,'已退租');
    assert(ctx.passFilter({...row,kind:'contract'},'returned'));assert(!ctx.passFilter({...row,kind:'contract'},'active'));
    assert(!ctx.isOverdueRental({...row,kind:'contract',endDate:'2020-01-01'}));
    assert(!ctx.actionButtons('contract',row).includes('客人退租'));
    assert(ctx.renewalAdminHtml(row).includes(row.returnedAtText));assert(!ctx.renewalAdminHtml(row).includes('申請待確認'));
    await ctx.window.markCustomerReturned();assert.equal(writes,1,'Repeat must not change the return timestamp');
  }
  reset({endDate:'',rentFee:'',internalRentalCountCurrent:null});await ctx.window.markCustomerReturned();assert.equal(writes,1,'Missing date, fee or counts cannot block return');
  reset();fail=true;await ctx.window.markCustomerReturned();assert.equal(row.status,'租賃中');assert.equal(ctx.filter,'active');assert.equal(writes,0);assert.equal(message.ok,false);assert.equal(btn.disabled,false);
  fail=false;exists=false;await ctx.window.markCustomerReturned();assert.equal(writes,0,'Do not create missing contract');
  reset();let release;gate=new Promise(resolve=>{release=resolve;});const first=ctx.window.markCustomerReturned();await ctx.window.markCustomerReturned();assert.equal(transactions,1,'Double click ignored');release();await first;assert.equal(writes,1);assert.equal(btn.disabled,false);
  console.log('Direct return: early dates, classification, preserved history, idempotency, double click and write failures passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
