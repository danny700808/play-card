const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

for(const file of ['course-scheduler.js','operations-course-inline-runtime.js']) {
  const source=fs.readFileSync(file,'utf8');
  const start=source.indexOf("$('scheduleGrid').addEventListener('click',");
  const registration=source.slice(start,source.indexOf("$('cancelClipboard')",start));
  function fixture({clipboard=true,status='leave',readOnly=false,pasteResult=true}={}) {
    const calls=[];
    const row={id:'leave-record',roomId:'drum-room',start:'14:00',duration:60,status};
    const context={state:{clipboard:clipboard?{mode:'cut',eventId:'already-moved-lesson'}:null,currentDate:'2026-09-27'},
      clean:v=>String(v||'').trim(),findEvent:()=>row,isReadOnly:()=>readOnly,calendarPartial:()=>false,
      eventDetails:r=>calls.push(['details',r.id]),pasteToSlot:(room,time)=>{calls.push(['paste',room,time]);return pasteResult;},
      toast:()=>calls.push(['blocked']),openSchedule:r=>calls.push(['new',r.roomId,r.start]),
      $:()=>({addEventListener:(name,fn)=>{context.click=fn;}})};
    const statuses=source.slice(source.indexOf('  function normalizedStatus('),source.indexOf('  function statusBadge('));
    const occupancy=source.match(/  function isNonOccupyingEvent\(event\)\{[^\n]+/)[0];
    vm.runInNewContext(statuses+occupancy+'\n'+registration,context);
    function click(kind){context.click({target:{closest:selector=>kind==='event'&&selector==='[data-event-id]'?{dataset:{eventId:row.id}}:kind==='slot'&&selector==='[data-slot-room]'?{dataset:{slotRoom:'empty-room',slotTime:'15:00'}}:null}});}
    return {calls,row,click};
  }
  test(file+': moving onto a leave card uses its released room/time and preserves the leave record',()=>{
    for(const status of ['leave','請假','cancelled']) {
      const f=fixture({status}),before=JSON.stringify(f.row);f.click('event');
      assert.deepEqual(f.calls,[['paste','drum-room','14:00']]);assert.equal(JSON.stringify(f.row),before);
    }
  });
  test(file+': ordinary viewing and occupied lessons still open details',()=>{
    for(const options of [{clipboard:false},{status:'scheduled'},{status:'attended'},{status:'absent'}]) {
      const f=fixture(options);f.click('event');assert.deepEqual(f.calls,[['details','leave-record']]);
    }
  });
  test(file+': read-only calendar cannot move onto leave cards',()=>{
    const f=fixture({readOnly:true});f.click('event');assert.deepEqual(f.calls,[['blocked']]);
  });
  test(file+': blank slots keep their paste and new-schedule behavior',()=>{
    const f=fixture();f.click('slot');assert.deepEqual(f.calls,[['paste','empty-room','15:00']]);
    const g=fixture({clipboard:false,pasteResult:false});g.click('slot');assert.deepEqual(g.calls,[['paste','empty-room','15:00'],['new','empty-room','15:00']]);
  });
}
