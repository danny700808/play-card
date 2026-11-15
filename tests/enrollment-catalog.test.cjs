'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {database}=require('./helpers/security-fixtures.cjs');
const {createEnrollmentCatalog}=require('../functions/enrollmentCatalog');
const offering=(id,subjectId,patch={})=>({id,subjectId,name:'招生課程',image:'assets/course-01.jpg',active:true,options:[{id:'single',name:'單人班',price:'2800',lessons:4,people:1}],...patch});
test('enrollment reuses shared IDs, respects activation and never substitutes a related subject',async()=>{
 const f=database({
  'opsEducationMirrorSubjects/p':{sourceActive:true,source:{id:'p',name:'鋼琴',active:true}},
  'opsEducationMirrorSubjects/k':{sourceActive:false,source:{id:'k',name:'鍵盤',active:true}},
  'coursePortalSubjectCatalog/k':{id:'k',name:'鍵盤',active:true,status:'active'},
  'coursePortalSubjectCatalog/j':{id:'j',name:'流行/爵士鋼琴',active:true,status:'active'},
  'coursePortalEnrollmentCourses/1':offering(1,'p'),
  'coursePortalEnrollmentCourses/2':offering(2,'k'),
  'coursePortalEnrollmentCourses/3':offering(3,'j'),
  'coursePortalEnrollmentCourses/4':offering(4,'missing'),
  'coursePortalEnrollmentCourses/5':offering(5,'p',{active:false})
 });
 const read=createEnrollmentCatalog(f);let result=await read();assert.deepEqual(result.courses.map(c=>c.subjectId),['p','k','j']);
 f.rows.get('coursePortalSubjectCatalog/j').active=false;f.rows.get('coursePortalSubjectCatalog/j').status='inactive';
 result=await read();assert.deepEqual(result.courses.map(c=>c.subjectId),['p','k']);
});
test('public output includes course pricing but excludes unrelated fields and malformed courses',async()=>{
 const f=database({'opsEducationMirrorSubjects/s':{sourceActive:true,source:{id:'s',name:'鋼琴',active:true}},
  'coursePortalEnrollmentCourses/1':offering(1,'s',{teacherPhone:'private',commission:.6,options:[{id:'single',name:'單人班',price:'2800～3000',lessons:4,people:1,teacherPay:420}]}),
  'coursePortalEnrollmentCourses/2':offering(2,'s',{image:'https://unapproved.invalid/tracker.jpg'}),
  'coursePortalEnrollmentCourses/3':offering(3,'s',{options:[]})});
 const result=await createEnrollmentCatalog(f)();assert.equal(result.courses.length,1);assert.equal(result.courses[0].options[0].price,'2800～3000');
 assert(!/teacherPhone|commission|teacherPay|private/.test(JSON.stringify(result)));assert.equal(result.bindingRequired,true);
});
