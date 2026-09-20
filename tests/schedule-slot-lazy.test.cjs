const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('operations-course-inline-runtime.js','utf8');
test('blank grid and schedule dialog never request the full workspace',()=>{
 const open=source.slice(source.indexOf('  function openSchedule('),source.indexOf('  function openPermanentSchedule('));
 const slot=source.slice(source.indexOf("var slot=event.target.closest('[data-slot-room]')"),source.indexOf("$('cancelClipboard')"));
 assert(!open.includes('afterWorkspaceReady'));assert(!slot.includes('afterWorkspaceReady'));assert(open.includes('scheduleWritable()'));
});
test('only selected student is read and late results cannot replace a newer selection',async()=>{
 const pending={},calls=[],selected=[],nodes={};const ctx={Map,Promise,state:{dataMode:'migration'},calendarPartial:()=>true,writable:()=>false,$:id=>nodes[id]||(nodes[id]={}),clean:String,toast(){},updateScheduleConflict(){},selectScheduleStudent:id=>selected.push(id),window:{YouziCoursePreviewData:{loadScheduleCatalog:async()=>[],refreshWorkspaceSlice:opts=>{calls.push(opts);return new Promise(resolve=>pending[opts.studentIds[0]]=resolve);},applyWorkspaceSlice(){}}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  var scheduleCatalogPromise='),source.indexOf('  function selectScheduleStudent(')),ctx);
 assert.equal(ctx.scheduleWritable(),true);assert.equal(calls.length,0);
 const first=ctx.loadSelectedScheduleStudent('a',true),second=ctx.loadSelectedScheduleStudent('b',true);
 pending.b({});await second;pending.a({});await first;
 assert.deepEqual(selected,['b']);assert.deepEqual(calls.map(c=>Array.from(c.studentIds)),[['a'],['b']]);assert.equal(nodes.scheduleSubmitBtn.disabled,false);
});
