'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const backend=fs.readFileSync('functions/coursePortal.js','utf8');
function extract(source,name){const start=source.indexOf('async function '+name+'(');const end=source.slice(start+1).search(/\n {0,2}(?:async )?function /);return source.slice(start,end<0?undefined:start+1+end);}
const helpers={clean:v=>String(v||'').trim(),sourceId:r=>r.id||r.__id,jsonValue:v=>v,memoPortalRead:(_,fn)=>fn(),readCourseGroups:async()=>[],projectCourseGroups:(_,rows)=>rows};
test('teacher identity reads are scoped and retain profile overrides without a collection scan',async()=>{
 const reads=[];const rows={'students/s1':{sourceActive:true,source:{id:'s1',name:'Old'}},'profiles/s1':{name:'New',phone:'0912345678'},'profiles/s2':{managerCreated:true,name:'Created',phone:''}};
 const doc=path=>({id:path.split('/').at(-1),exists:!!rows[path],data:()=>rows[path]});
 const db={collection:name=>({doc:id=>({get:async()=>{reads.push(name+'/'+id);return doc(name+'/'+id)}}),where:(field,op,ids)=>({get:async()=>{reads.push([name,field,op,Array.from(ids)]);return {docs:[]}}}),get:()=>{throw Error('full collection read')}})};
 const c={...helpers,db,MIRROR:{students:'students'},normalizePhone:v=>v||'',TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION:'assignments'};
 // Match production profile collection name in the fixture.
 c.db.collection=(original=>name=>original(name==='coursePortalStudentProfiles'?'profiles':name))(c.db.collection);
 vm.createContext(c);vm.runInContext(extract(backend,'mergeStudentProfileOverrides')+'\n'+extract(backend,'mirrorProfilesByIds'),c);
 const result=await c.mirrorProfilesByIds('students',['s1','s2','s1']);
 assert.deepEqual(Array.from(result,r=>[r.id,r.name]),[['s1','New'],['s2','Created']]);
 assert(!JSON.stringify(reads).includes('unrelated'));
 assert.equal(reads.filter(x=>x==='students/s1').length,1);
});
test('teacher homepage opts into scoped profiles and returns only own lessons',async()=>{
 let options;
 const chain={where(){return this},get:async()=>({docs:[]})};
 const bundle={maps:{teachers:{t:{name:'Teacher'}},students:{s:{name:'Student'}}},events:[{id:'own',teacherId:'t',studentIds:['s']},{id:'other',teacherId:'other',studentIds:['private']}],fixedCourses:[],temporaryCourses:[],suspensions:[],rooms:[],subjects:[],irregularModes:[]};
 const c={...helpers,requireSession:async()=>({teacherId:'t'}),dateKey:v=>v,addDays:()=> '2026-09-13',currentTaipeiDay:()=> '2026-09-10',db:{collection:()=>chain},ATTENDANCE_CANCELLATIONS:'cancel',TEACHER_PAYROLL_MIN_MONTH:'2026-07',scheduleBundle:async(a,b,id,opt)=>{options=opt;return bundle},eventTeacherId:r=>r.teacherId,eventStudentIds:r=>r.studentIds||[],eventSubjectId:r=>r.subjectId,sourcePhone:r=>r.phone,normalizePhone:v=>v||'',sourceActive:()=>true,firstArray:(r,keys)=>r[keys[0]]||[]};
 vm.createContext(c);vm.runInContext(extract(backend,'teacherPortalData'),c);
 const result=await c.teacherPortalData({weekStart:'2026-09-07'});
 assert.equal(options.teacherHome,true);assert.deepEqual(Array.from(result.events,r=>r.id),['own']);assert.deepEqual(Array.from(result.roster,r=>r.id),['s']);
});
test('candidate lookup uses nearby fourteen days and retains server conflict checks',()=>{
 const source=extract(backend,'teacherSlotOptions');
 assert(source.includes('addDays(targetDate, -7)'));assert(source.includes('addDays(candidateStart, 13)'));
 assert(source.includes('scheduleBundle(candidateStart, candidateEnd, session.teacherId)'));
 assert(source.includes('eventBlocksResource(event)'));assert(source.includes('sharedResourceConflict(blockers'));
 assert(source.includes('data.weekly === true ? 8 : 1'));
});
test('cached teacher data appears immediately then refreshes, with a visible stale-data notice',async()=>{
 const source=fs.readFileSync('teacher-course-portal-v8.js','utf8');let resolve;const messages=[],renders=[];
 const c={dataRequestVersion:0,activeTab:'schedule',token:'session',weekStart:'2026-09-07',payrollMonth:'2026-09',data:{},readCache:()=>({events:[{id:'cached'}]}),mergeData:r=>{c.data=r},renderAll:()=>renders.push(c.data.events[0].id),showDataFreshness:t=>messages.push(t),invoke:()=>new Promise(r=>resolve=r),writeCache:()=>{},PortalAuth:null};
 vm.createContext(c);vm.runInContext(extract(source,'fetchData'),c);await c.fetchData(false);assert.deepEqual(renders,['cached']);assert(messages.at(-1).includes('上次'));
 resolve({events:[{id:'fresh'}]});await new Promise(r=>setImmediate(r));assert.deepEqual(renders,['cached','fresh']);assert.equal(messages.at(-1),'');
});
