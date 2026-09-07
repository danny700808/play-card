'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const source=fs.readFileSync(require('path').join(__dirname,'../functions/coursePortal.js'),'utf8');
function fixture(blockers=[]){
 const docs=new Map([['runtime/version',{version:1}]]);let serial=Promise.resolve();
 const ref=path=>({path,id:path.split('/').at(-1),get:async()=>snap(path)}),snap=path=>({exists:docs.has(path),data:()=>docs.get(path)});
 const db={collection:name=>({doc:id=>ref(name+'/'+id),where:()=>({get:async()=>({docs:[]})})}),runTransaction:work=>{const promise=serial.then(async()=>{let writing=false;const staged=new Map(docs);await work({get:async r=>{assert(!writing);return snap(r.path);},set:(r,d)=>{writing=true;staged.set(r.path,{...staged.get(r.path),...d});},create:(r,d)=>{writing=true;assert(!staged.has(r.path));staged.set(r.path,d);}});docs.clear();for(const row of staged)docs.set(...row);});serial=promise.catch(()=>{});return promise;}};
 const minutes=t=>Number(t?.slice(0,2))*60+Number(t?.slice(3,5));
 const c={db,clean:v=>String(v??'').trim(),dateKey:v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v:'',timeMinutes:minutes,
 addDays:(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10),assertPortalInterval:(a,b)=>{assert(minutes(b)>minutes(a));},
 HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}},readCourseGroups:async()=>[],canonicalStudentId:v=>v,readScheduleVersion:async()=>docs.get('runtime/version').version,
 scheduleBundle:async()=>({resourceEvents:blockers,rooms:[{id:'room',active:true}],maps:{teachers:{teacher:{active:true,subjectIds:['guitar']}},subjects:{guitar:{}},students:{student:{name:'測試學生'}}}}),
 rentalPolicySettings:async()=>({}),businessWindow:()=>({closed:false,startMinutes:540,endMinutes:1260}),
 sourceId:r=>r.id,sourceActive:r=>r.active!==false,firstArray:(r,keys)=>r[keys[0]]||[],requestedSubjectResourceIds:()=>[],roomSupportsSubject:()=>true,roomAllowsInterval:()=>true,
 eventBlocksResource:r=>r.status!=='leave',overlaps:(a,b,c,d)=>minutes(a)<minutes(d)&&minutes(c)<minutes(b),sharedResourceConflict:()=>false,
 hash:v=>crypto.createHash('sha256').update(v).digest('hex'),cents:v=>{assert(Number.isFinite(v)&&v>=0);},nowText:()=>'',FieldValue:{serverTimestamp:()=>1},
 scheduleVersionRef:()=>ref('runtime/version'),assertScheduleWritable:s=>{if(s.data().writesBlocked)throw Error('blocked');},normalizeScheduleStatus:v=>v,attendanceLineage:e=>e.fixedCourseId||e.id};
 vm.createContext(c);let start=source.indexOf('async function adminSaveSchedule(');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),c);return{c,docs};
}
const request=()=>({operationId:'op1',event:{date:'2026-09-07',start:'18:00',duration:60,roomId:'room',teacherId:'teacher',subjectId:'guitar',studentIds:['student'],type:'fixed',frequency:'weekly'},repeatUntil:'2026-09-30'});
test('recurring schedule is stored in shared cloud data without recording tuition or wages',async()=>{
 const f=fixture();await f.c.adminSaveSchedule(request());const row=f.docs.get('coursePortalFixedCourses/manager-op1');assert.equal(row.frequencyWeeks,1);assert.equal(row.source,'manager-cloud');assert.equal(row.studentIds.length,1);assert.equal(f.docs.size,2);
});
test('retry returns the same recurring rule and rejects a changed payload using the same operation ID',async()=>{
 const f=fixture();await f.c.adminSaveSchedule(request());assert.equal((await f.c.adminSaveSchedule(request())).duplicate,true);
 const changed=request();changed.event.start='19:00';await assert.rejects(f.c.adminSaveSchedule(changed));assert.equal(f.docs.size,2);
});
test('a conflict on a later weekly occurrence prevents the whole schedule write',async()=>{
 const f=fixture([{id:'other',date:'2026-09-14',startTime:'18:00',endTime:'19:00',roomId:'room',studentIds:[]}]);
 await assert.rejects(f.c.adminSaveSchedule(request()),/2026-09-14/);assert.equal(f.docs.size,1);
});
test('concurrent devices cannot commit schedules from the same stale version',async()=>{
 const f=fixture(),second=request();second.operationId='op2';const results=await Promise.allSettled([f.c.adminSaveSchedule(request()),f.c.adminSaveSchedule(second)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('a signed lesson cannot be moved without first cancelling attendance',async()=>{
 const f=fixture([{id:'old',date:'2026-09-07',startTime:'18:00',endTime:'19:00',roomId:'room',studentIds:['student'],status:'attended'}]),data=request();data.sourceEventId='old';data.sourceDate='2026-09-07';await assert.rejects(f.c.adminSaveSchedule(data),/已簽到/);
});
