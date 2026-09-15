const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {withPortalReads,memoPortalRead}=require('../functions/portalReadContext');
const source=fs.readFileSync('functions/coursePortal.js','utf8');
function fixture(){
 const reads=[],bundles=[];
 const c={requireSession:async()=>({teacherId:'t'}),dateKey:v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v:'',clean:v=>String(v||''),addDays:(v,n)=>new Date(Date.parse(v+'T12:00:00Z')+n*86400000).toISOString().slice(0,10),HttpsError:Error,ATTENDANCE_CANCELLATIONS:'cancel',db:{collection:()=>({where:()=>({get:async()=>({docs:[]})})})},currentTaipeiDay:()=> '2026-09-15',eventTeacherId:r=>r.teacherId,eventStudentIds:r=>r.studentIds,eventSubjectId:r=>r.subjectId,normalizePhone:v=>v||'',sourcePhone:r=>r.phone||''};
 c.scheduleBundle=(start,end,teacher,options)=>memoPortalRead(JSON.stringify([start,end,teacher,options]),async()=>{
  reads.push({start,end,teacher,options});const bundle={maps:{teachers:{t:{name:'Teacher'}},students:{s:{name:'Own'},foreign:{name:'Other'}}},events:[{id:start,teacherId:'t',date:start,studentIds:['s']},{id:'foreign',teacherId:'other',date:start,studentIds:['foreign']}],fixedCourses:[{teacherId:'t',subjectId:'p',studentIds:['s']}],temporaryCourses:[],suspensions:[{id:'stop',status:'active',teacherId:'t',subjectId:'p',studentId:'s',effectiveDate:'2026-09-15'},{id:'foreign-stop',status:'active',teacherId:'other',studentId:'foreign'}],irregularModes:[]};bundles.push(bundle);return bundle;
 });
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function teacherFollowupSnapshot('),source.indexOf('async function teacherOwnsStudent(')),c);
 return {c,reads,run:data=>withPortalReads(()=>c.teacherPortalData(data))()};
}
test('mode refresh reads one continuous week once and returns only this teacher roster and modes',async()=>{
 const f=fixture(),dates=Array.from({length:7},(_,i)=>f.c.addDays('2026-09-14',i));
 const result=await f.run({refreshDates:dates,includeModes:true,modeWeekStart:'2026-09-14'});
 assert.equal(f.reads.length,1);assert.equal(f.reads[0].options.teacherHome,true);assert.deepEqual(f.reads.map(r=>[r.start,r.end]),[['2026-09-14','2026-09-20']]);
 assert.deepEqual(Array.from(result.events,e=>e.teacherId),['t']);assert.deepEqual(Array.from(result.modeState.stoppedCourses,r=>r.id),['stop']);assert.equal(result.modeState.roster.length,0);
});
test('ordinary refresh keeps its lightweight shape and sparse dates are not expanded into a long range',async()=>{
 const f=fixture(),r=await f.run({refreshDates:['2026-09-14','2026-10-15']});assert(!r.modeState);assert.equal(f.reads.length,2);assert(f.reads.every(row=>row.start===row.end));
 await assert.rejects(f.run({refreshDates:[]}));await assert.rejects(f.run({refreshDates:['2026-09-14'],includeModes:true,modeWeekStart:'invalid'}));
});
