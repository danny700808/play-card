'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {applyLessonSettings}=require('../functions/courseLessonSettings');
test('cloud lesson settings follow an occurrence across attendance IDs but never another date or teacher',()=>{
 const settings=[{date:'2026-09-07',teacherId:'t',eventIds:['fixed'],fields:{teacherPayAdjustment:60}}];
 const rows=[{id:'new-attendance-id',fixedCourseId:'fixed',date:'2026-09-07',teacherId:'t'},{id:'fixed',date:'2026-09-08',teacherId:'t'},{id:'fixed',date:'2026-09-07',teacherId:'other'}];
 const result=applyLessonSettings(rows,settings);assert.equal(result[0].teacherPayAdjustment,60);assert.equal(result[1].teacherPayAdjustment,undefined);assert.equal(result[2].teacherPayAdjustment,undefined);assert.equal(rows[0].teacherPayAdjustment,undefined);
});
test('zero adjustment and restored rental status overwrite prior values explicitly',()=>{
 const rows=[{id:'rental',date:'2026-09-07',status:'attended',teacherPayAdjustment:60}];
 const result=applyLessonSettings(rows,[{date:'2026-09-07',eventIds:['rental'],fields:{status:'scheduled',teacherPayAdjustment:0}}]);assert.equal(result[0].status,'scheduled');assert.equal(result[0].teacherPayAdjustment,0);
});
