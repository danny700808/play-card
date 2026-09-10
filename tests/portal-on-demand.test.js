'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {withPortalReads, memoPortalRead} = require('../functions/portalReadContext');
const source = fs.readFileSync('functions/coursePortal.js', 'utf8');
function extract(name) {
  const begin = source.indexOf(`async function ${name}(`);
  const rest = source.slice(begin + 1);
  const end = rest.search(/\n(?:async )?function /);
  return source.slice(begin, end < 0 ? undefined : begin + 1 + end);
}
function context(name, values) {
  const ctx = {Date, Map, Set, Promise, JSON, clean:v=>String(v || '').trim(), ...values};
  vm.runInNewContext(extract(name), ctx);
  return ctx[name];
}
test('concurrent reads are shared per request, never between accounts; failures retry', async () => {
  let reads = 0;
  const run = withPortalReads(async owner => {
    const values = await Promise.all([1,2,3].map(() => memoPortalRead('same', async () => { reads++; return owner; })));
    return values;
  });
  assert.deepEqual(await Promise.all([run('a'),run('b')]), [['a','a','a'],['b','b','b']]);
  assert.equal(reads,2);
  await withPortalReads(async () => {
    await assert.rejects(memoPortalRead('bad',()=>Promise.reject(new Error('offline'))));
    assert.equal(await memoPortalRead('bad',()=>42),42);
  })();
});
test('overview loads only selected student, never tuition or contact book; sparse next lesson extends range', async () => {
  const calls=[];
  const overview=context('studentPortalOverview', {
    requireSession:async()=>({role:'student'}), activeStudentBindingsForSession:async()=>[{studentId:'a'},{studentId:'b'}],
    canonicalStudentId:x=>x, readCourseGroups:async()=>[], currentTaipeiDay:()=> '2026-09-10',
    addDays:(day,n)=>String(n), mirrorRowsIncludingInactive:async()=>[{id:'a',name:'A'},{id:'b',name:'B'}],
    reconcileStudentSuspensionsForNewSchedules:async ids=>{assert.deepEqual(Array.from(ids),['b']);return [];},
    scheduleBundle:async(start,end,teacher,options)=>{calls.push({start,end,options});return {maps:{teachers:{},subjects:{}},fixedCourses:[],temporaryCourses:[],resourceEvents:start==='2026-09-10'?[{id:'first'}]:[{id:'second'}]};},
    nextStudentLessons:events=>events, activeLearningStudentIds:()=>new Set(['b']), sourceId:r=>r.id,
    eventStudentIds:()=>['b'],eventTeacherId:()=>'',eventSubjectId:()=>'',eventDate:()=>'',eventStart:()=>'',eventEnd:()=>'',
    HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}}
  });
  const result=await overview({studentId:'b'});
  assert.equal(result.selectedStudentId,'b'); assert.equal(result.upcoming.length,2);
  assert.equal(calls.length,2); assert.equal(calls[0].end,'60'); assert.equal(calls[1].end,'120');
  assert(calls.every(row=>row.options.historyStudentId==='b'));
  assert.equal(result.periods.length,0); assert.equal(result.contactBook.length,0);
  await assert.rejects(overview({studentId:'stranger'}), /查看權限/);
});
test('event queries include student and date bounds for both legacy shapes and group members', async () => {
  const queries=[];
  const read=context('historyStudentEvents',{
    readCourseGroups:async()=>[{id:'group',active:true,memberIds:['member']}],
    MIRROR:{events:'events'}, db:{collection:()=>{const filters=[];return {where(...args){filters.push(args);return this;},async get(){queries.push(filters);return {docs:[]};}};}},
    projectCourseGroups:(type,rows)=>rows, eventStudentIds:r=>r.studentIds
  });
  await read('group','2026-08-01','2026-09-10');
  assert.equal(queries.length,4);
  for(const filters of queries) assert.deepEqual(filters.slice(1),[['source.date','>=','2026-08-01'],['source.date','<=','2026-09-10']]);
});
test('unchanged tuition requests are not rewritten; changed subject updates once', async()=>{
  const existing={id:'request',studentId:'a',sourcePeriodId:'p',nextPeriodNo:2,status:'payment_due',active:true,createdAtText:'old',subjectName:'Piano'};
  const writes=[];
  let subject='Piano';
  const ensure=context('ensureTuitionPaymentRequests',{
    buildTuitionPaymentCandidates:()=>[{...existing,createdAtText:'new',subjectName:subject}],
    tuitionPaymentRequestsForStudents:async()=>[{...existing}],
    TUITION_PAYMENT_REQUESTS:'requests',FieldValue:{serverTimestamp:()=>1},sourceId:r=>r.id,
    db:{collection:()=>({doc:()=>({get:async()=>{throw new Error('redundant read');},set:async row=>writes.push(row)})})}
  });
  await ensure({studentIds:['a'],periods:[]});assert.equal(writes.length,0);
  subject='Violin';await ensure({studentIds:['a'],periods:[]});assert.equal(writes.length,1);
  assert.equal(writes[0].createdAtText,'old');
});
test('temporary-only students retain future course metadata without reading other students', async()=>{
  const filters=[];
  const read=context('studentTemporaryCourses',{
    readCourseGroups:async()=>[],MIRROR:{temporaryCourses:'temporary'},jsonValue:x=>x,
    projectCourseGroups:(type,rows)=>rows,
    db:{collection:()=>({where(field,op,id){filters.push([field,op,id]);return this;},async get(){return {docs:[
      {id:'future',data:()=>({sourceActive:true,source:{studentId:'a',date:'2026-12-01'}})},
      {id:'inactive',data:()=>({sourceActive:false,source:{studentId:'a'}})}
    ]};}})}
  });
  const rows=await read('a');
  assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-12-01');
  assert.equal(filters.length,2);assert(filters.every(row=>row[2]==='a'));
});
