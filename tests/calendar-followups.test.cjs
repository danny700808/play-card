'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const runtime={};vm.runInNewContext(fs.readFileSync('course-scheduler-data.js','utf8'),{window:runtime});
const api=runtime.YouziCoursePreviewData;
const mode={enabled:true,teacherId:'t1',subjectId:'piano',studentIds:['s1'],effectiveDate:'2026-09-10',resumedFrom:'2026-09-13'};
test('irregular students follow the teacher and fixed-course effective date without duplicates',()=>{
 assert.equal(api.activeIrregularCourses([mode,mode], '2026-09-12','t1').length,1);
 assert.equal(api.activeIrregularCourses([mode], '2026-09-12','t2').length,0);
 assert.equal(api.activeIrregularCourses([mode], '2026-09-13','t1').length,0);
 assert.equal(api.activeIrregularCourses([{...mode,enabled:false}], '2026-09-12').length,0);
});
test('irregular placeholders disappear while attendance and arranged single lessons remain',()=>{
 const event={teacherId:'t1',subjectId:'piano',studentIds:['s1'],date:'2026-09-12',type:'fixed',status:'scheduled'};
 assert.equal(api.isIrregularPlaceholder(event,[mode]),true);
 assert.equal(api.isIrregularPlaceholder({...event,date:'2026-09-13'},[mode]),false);
 assert.equal(api.isIrregularPlaceholder({...event,status:'attended'},[mode]),false);
 assert.equal(api.isIrregularPlaceholder({...event,portalAction:'extra_lesson'},[mode]),false);
 assert.equal(api.isIrregularPlaceholder({...event,studentIds:['s2']},[mode]),false);
});
test('completed unpaid excludes unfinished and fully paid periods',()=>{
 const src=fs.readFileSync('operations-course-inline-runtime.js','utf8');
 const fn=src.match(/  function completedUnpaidPeriods\(\)\{[^\n]+/)[0];
 const ctx={state:{tuitionPeriods:[{id:'due',usedCount:4,remaining:0,balance:3000},{id:'paid',usedCount:4,remaining:0,balance:0},{id:'future',usedCount:2,remaining:2,balance:3000},{id:'void',usedCount:0,remaining:0,balance:3000}]},numberOf:Number,periodRemaining:p=>p.remaining,periodBalance:p=>p.balance};
 vm.createContext(ctx);vm.runInContext(fn,ctx);assert.equal(ctx.completedUnpaidPeriods().map(p=>p.id).join(','),'due');
});
