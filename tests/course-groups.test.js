'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {canonicalStudentId,projectCourseGroups}=require('../functions/courseGroups');
const group={id:'a',active:true,name:'甲－乙',memberIds:['a','b'],memberNames:['甲','乙'],startDate:'2026-07-21',sourceCourseIds:['course'],hiddenPeriodIds:['pb'],attendanceAliases:{aa:'aa',ab:'aa'}};
test('group uses one student and one period while preserving identity aliases for login',()=>{
 const students=[{id:'a',phone:'1'},{id:'b',phone:'2'},{id:'c'}];
 assert.equal(canonicalStudentId('b',[group]),'a');assert.equal(canonicalStudentId('c',[group]),'c');
 assert.equal(projectCourseGroups('students',students,[group]).length,2);
 assert.equal(projectCourseGroups('students',students,[group],{includeAliases:true})[1].phone,'2');
 assert.deepEqual(projectCourseGroups('tuitionPeriods',[{id:'pa'},{id:'pb'}],[group]),[{id:'pa'}]);
});
test('group projects one shared course and deduction without changing unrelated single lessons',()=>{
 const event={id:'e',sourceCourseId:'course',date:'2026-09-01',studentIds:['a','b']};
 assert.deepEqual(projectCourseGroups('events',[event],[group])[0].studentIds,['a']);
 const rows=[{id:'aa',date:'2026-09-01'},{id:'ab',date:'2026-09-01'},{id:'other',date:'2026-09-01'}];
 assert.equal(projectCourseGroups('attendance',rows,[group]).length,2);
});
test('shared payroll is aggregated once with zero handled exactly',()=>{
 for(const amount of [0,270]){
  const rows=[{id:'aa',date:'2026-09-01',teacherAmount:amount},{id:'ab',date:'2026-09-01',teacherAmount:amount}];
  const once=projectCourseGroups('teacherPayroll',rows,[group]);assert.equal(once.length,1);assert.equal(once[0].teacherAmount,amount*2);
  assert.deepEqual(projectCourseGroups('teacherPayroll',once,[group]),once);
 }
});
test('unmatched salaries and data before cutoff are retained',()=>{
 assert.equal(projectCourseGroups('teacherPayroll',[{id:'ab',date:'2026-09-01',teacherAmount:270}],[group]).length,1);
 assert.equal(projectCourseGroups('attendance',[{id:'ab',date:'2026-07-20'}],[group]).length,1);
});
