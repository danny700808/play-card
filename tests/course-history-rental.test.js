'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {selectHistoryPeriods, rentalRateForRole} = require('../functions/courseHistory');
const rows = Array.from({length:5}, (_,i) => ({id:`g${i}`,studentId:'a',subjectId:'g',teacherId:'t',startDate:`2026-08-${String(i*5+1).padStart(2,'0')}`,periodNo:i+1,outstandingAmount:i===0?500:0}));
test('all debts and two paid periods per subject, not two periods per student',()=>{
 const result=selectHistoryPeriods(rows.concat(rows.map(r=>({...r,id:'p'+r.id,subjectId:'p'}))));
 assert.deepEqual(result.map(r=>r.id).sort(),['g0','g3','g4','pg0','pg3','pg4'].sort());
});
test('history includes containing period through latest, retaining earlier debt',()=>{
 assert.deepEqual(selectHistoryPeriods(rows,'2026-08-13').map(r=>r.id),['g4','g3','g2','g0']);
 assert.deepEqual(selectHistoryPeriods(rows,'2026-08-16').map(r=>r.id),['g4','g3','g0']);
});
test('teacher personal is half, guest full; renter cannot claim teacher or student discount',()=>{
 assert.equal(rentalRateForRole('teacher','teacher',false,false,.3).rate,.5);
 assert.equal(rentalRateForRole('teacher','general',true,true,.5).rate,1);
 assert.equal(rentalRateForRole('renter','teacher',true,true,.5).rate,1);
 assert.equal(rentalRateForRole('student','teacher',true,false,.5).rate,1);
 assert.equal(rentalRateForRole('student','',true,true,.5).rate,.5);
});
