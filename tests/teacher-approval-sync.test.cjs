'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {database}=require('./helpers/security-fixtures.cjs');
const {createTeacherApprovalSync}=require('../functions/teacherApprovalSync');
const {mergeTeacherRows}=require('../functions/courseSubjectCatalog');
const seed=()=>({'opsEducationMirrorSubjects/g':{sourceActive:true,source:{id:'g',name:'木吉他',active:true}},'externalTeacherContracts/c1':{name:'新老師',mobile:'0912345678',status:'submitted_pending_admin',lineBindStatus:'bound',lineUserId:'line-test',signatureUrl:'signed-test',teachingAbilities:[{subjectId:'g',item:'木吉他',level:'專業'}]}});
const assignments=f=>[...f.rows].filter(([p])=>p.startsWith('coursePortalTeacherSubjectAssignments/')).map(([p,r])=>({...r,__id:p.split('/')[1]}));
test('approval atomically makes a new teacher selectable for the submitted subject and preserves proficiency',async()=>{
 const f=database(seed()),api=createTeacherApprovalSync(f),result=await api('c1','manager');
 const teachers=mergeTeacherRows([],assignments(f));assert.equal(teachers.length,1);assert.equal(teachers[0].id,result.teacherId);assert.equal(teachers[0].phone,'0912345678');assert.deepEqual(teachers[0].subjectIds,['g']);
 const employee=f.rows.get('employees/'+result.employeeId);assert.equal(employee.teachingAbilities[0].level,'專業');assert.equal(employee.coursePortalTeacherId,result.teacherId);assert.equal(f.rows.get('externalTeacherContracts/c1').status,'active');assert.equal(f.rows.get('coursePortalRuntime/scheduleVersion').version,1);
 assert(![...f.rows.keys()].some(p=>/Attendance|FixedCourses|ScheduleChanges/.test(p)));
});
test('retries and concurrent approvals reuse one teacher and employee',async()=>{
 const f=database(seed()),api=createTeacherApprovalSync(f);const [a,b]=await Promise.all([api('c1','manager'),api('c1','manager')]);assert.equal(a.teacherId,b.teacherId);await api('c1','manager');assert.equal(assignments(f).length,1);assert.equal([...f.rows.keys()].filter(p=>p.startsWith('employees/')).length,1);
});
test('existing teacher identity and deliberate manager additions survive renewal',async()=>{
 const data=seed();data['employees/e']={name:'新老師',phone:'0912345678',identityType:'external',coursePortalTeacherId:'existing'};data['opsEducationMirrorTeachers/t']={source:{id:'existing',name:'新老師',phone:'0912345678'}};data['coursePortalTeacherSubjectAssignments/existing']={teacherId:'existing',employeeId:'e',profileSubjectIds:['g'],managerAddedSubjectIds:['piano'],effectiveSubjectIds:['g','piano']};
 const f=database(data),result=await createTeacherApprovalSync(f)('c1','manager');assert.equal(result.teacherId,'existing');assert.equal(result.employeeId,'e');assert.deepEqual(assignments(f)[0].effectiveSubjectIds,['g','piano']);
});
test('unsigned, unbound, unsubmitted or unknown subject records cannot partially activate',async()=>{
 for(const patch of [{signatureUrl:''},{lineBindStatus:'pending'},{status:'waiting_contract'},{teachingAbilities:[{item:'不存在科目',level:'普通'}]}]){const data=seed();Object.assign(data['externalTeacherContracts/c1'],patch);const f=database(data),before=structuredClone([...f.rows]);await assert.rejects(createTeacherApprovalSync(f)('c1','manager'));assert.deepEqual([...f.rows],before);}
});
test('ambiguous people are not silently merged',async()=>{
 const data=seed();for(const id of ['a','b'])data['employees/'+id]={name:'新老師',phone:'0912345678',identityType:'external'};const f=database(data);await assert.rejects(createTeacherApprovalSync(f)('c1','manager'),/多筆/);assert.equal(assignments(f).length,0);
});
test('a teacher linked to another employee blocks all approval writes',async()=>{
 const data=seed();data['externalTeacherContracts/c1'].coursePortalTeacherId='t';data['coursePortalTeacherSubjectAssignments/t']={teacherId:'t',employeeId:'someone-else'};const f=database(data),before=structuredClone([...f.rows]);await assert.rejects(createTeacherApprovalSync(f)('c1','manager'),/另一位/);assert.deepEqual([...f.rows],before);
});
