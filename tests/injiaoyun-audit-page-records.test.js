const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeAuditPageRecords } = require('../functions/injiaoyunAuditPageRecords');
const run={startDate:'2026-07-21',endDate:'2026-07-27'};
const normalize={dateKey:x=>String(x||'').slice(0,10),timeKey:x=>String(x||'')};
test('uses real session date when response arrives after the calendar moved',()=>{
 const record={_id:'temp1',startDate:'2026-07-21T07:00:00Z',startsAt:'14:30',endsAt:'15:30',room:'r1',students:[{_id:'s1',name:'Student'}]};
 const result=mergeAuditPageRecords([],[],[{requestedDate:'2026-07-22',urlPath:'/v1/studios/example/tempCourses/one/day',record,responseStatus:200}],run,normalize);
 assert.equal(result.candidateRows[0].dateKey,'2026-07-21');
 assert.deepEqual(result.candidateRows[0].studentIds,['s1']);
});
test('deduplicates repeated page records while retaining attendance evidence',()=>{
 const rawRows=[{sourceType:'fixed-course',sourceId:'f1',raw:{_id:'f1',checkins:[{_id:'c1',date:'2026-07-21'}]}}];
 const capture={urlPath:'/v1/studios/example/fixCourses/one/day',responseStatus:200,record:{_id:'f1',checkins:[{_id:'c2',date:'2026-07-22'}]}};
 const result=mergeAuditPageRecords(rawRows,[],[capture,capture],run,normalize);
 assert.equal(result.rawRows.length,1);
 assert.deepEqual(result.rawRows[0].raw.checkins.map(x=>x._id),['c1','c2']);
 assert.equal(result.candidateRows.length,0);
});
test('never creates an out-of-range session or uses an unsuccessful response',()=>{
 const captures=[{urlPath:'/x/tempCourses/one/day',responseStatus:200,record:{_id:'old',startDate:'2026-07-20'}},{urlPath:'/x/tempCourses/one/day',responseStatus:500,record:{_id:'bad',startDate:'2026-07-21'}}];
 const result=mergeAuditPageRecords([],[],captures,run,normalize);
 assert.equal(result.candidateRows.length,0);
 assert.equal(result.rawRows.some(x=>x.sourceId==='bad'),false);
});
