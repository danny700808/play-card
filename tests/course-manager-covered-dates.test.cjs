'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('functions/coursePortal.js','utf8');
const start=source.indexOf('  const expanded = [];',source.indexOf('async function scheduleBundleUncached('));
const block=source.slice(start,source.indexOf('  const overlay =',start));
function expand(overrides={}, exact=[]){
  const context={fixed:[{id:'new-course',date:'2026-09-22',startTime:'17:00',endTime:'18:00',source:'manager-cloud',active:true,...overrides}],
    startDate:'2026-09-21',endDate:'2026-10-06',coveredDates:new Set(['2026-09-22','2026-09-29']),exactKeys:new Set(exact),
    livePortalSource:r=>/^course-portal/i.test(r.source||''),clean:v=>String(v||'').trim(),eventDate:r=>r.date,
    eventStart:r=>r.startTime,eventEnd:r=>r.endTime,dateKey:v=>v||'',sourceActive:r=>r.active!==false,
    safeFrequencyWeeks:v=>Number(v)===2?2:1,sourceId:r=>r.id,normalizeScheduleStatus:v=>v||'scheduled',
    addDays:(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10)};
  vm.runInNewContext(block+'\nresult=expanded;',context);
  return Array.from(context.result,r=>r.date);
}
test('new cloud fixed lessons remain visible on imported dates and later weeks',()=>{
  assert.deepEqual(expand(),['2026-09-22','2026-09-29','2026-10-06']);
});
test('imported daily coverage still suppresses legacy recurrence',()=>{
  assert.deepEqual(expand({source:'injiaoyun'}),['2026-10-06']);
});
test('cloud recurrence retains cancellation, exact occurrence, end date and fortnight rules',()=>{
  assert.deepEqual(expand({statusByDate:{'2026-09-22':'cancelled'}}),['2026-09-29','2026-10-06']);
  assert.deepEqual(expand({},['new-course|2026-09-22']),['2026-09-29','2026-10-06']);
  assert.deepEqual(expand({recurrenceEndDate:'2026-09-29'}),['2026-09-22','2026-09-29']);
  assert.deepEqual(expand({frequencyWeeks:2}),['2026-09-22','2026-10-06']);
});
