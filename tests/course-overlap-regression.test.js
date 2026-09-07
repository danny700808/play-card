const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = fs.readFileSync(path.join(__dirname,'../teacher-course-portal-v8.js'),'utf8');
function extract(source,name,indent='  ') {
  const start=source.indexOf(`${indent}function ${name}(`);
  assert(start>=0);
  return source.slice(start,source.indexOf(`\n${indent}}`,start)+indent.length+2);
}
const context=vm.createContext({clean:v=>String(v||'').trim(),Date});
for(const name of ['eventBlocksPlannerGap','courseDisplayRank','futureOverlapCount']) vm.runInContext(extract(ui,name),context);
const row=(status,startTime='16:00',endTime='17:00')=>({date:'2026-09-10',status,startTime,endTime});
test('leave and cancelled lessons do not create conflicts; past lessons have no warning',()=>{
  const before=Date.parse('2026-09-09T10:00:00+08:00');
  assert.equal(context.futureOverlapCount([row('scheduled'),row('leave'),row('cancelled')],before),1);
  assert.equal(context.futureOverlapCount([row('scheduled'),row('scheduled')],before),2);
  assert.equal(context.futureOverlapCount([row('attended'),row('scheduled')],Date.parse('2026-09-11')),0);
});
test('chain overlaps count concurrent lessons rather than all lessons in a group',()=>{
  assert.equal(context.futureOverlapCount([row('scheduled','16:00','17:00'),row('scheduled','16:30','17:30'),row('scheduled','17:00','18:00')],0),2);
});
test('attended first, pending next, leave last without converting pending to leave',()=>{
  const rows=[row('leave'),row('scheduled'),row('attended')];
  rows.sort((a,b)=>context.courseDisplayRank(a)-context.courseDisplayRank(b));
  assert.deepEqual(rows.map(r=>r.status),['attended','scheduled','leave']);
});
test('verified coverage includes blank dates and future audit dates, not unverified dates',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../functions/coursePortal.js'),'utf8');
  const c=vm.createContext({dateKey:v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v:''});
  vm.runInContext(extract(source,'verifiedScheduleDates',''),c);
  const dates=c.verifiedScheduleDates({auditCoveredDates:['2026-07-21'],dataQuality:{futureScheduleCoveredDates:['2026-09-30']}});
  assert(dates.has('2026-07-21')); assert(dates.has('2026-09-30')); assert(!dates.has('2026-10-01'));
  assert.equal(c.verifiedScheduleDates({}).size,0);
  assert(source.includes('if (coveredDates.has(key)) continue;'));
});
