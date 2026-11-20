'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {createEnrollmentService}=require('../functions/enrollment');
const confirmationMessage=require('../functions/enrollmentConfirmationMessage');
const source=fs.readFileSync(require('path').join(__dirname,'../functions/coursePortal.js'),'utf8');
function harness({pair=false,blockers=[]}={}){
 const row={form:{name:'測試甲',secondName:pair?'測試乙':'',secondPhone:pair?'0922222222':'',subjectId:'piano',courseName:'古典鋼琴',optionName:pair?'雙人班':'單人班',phone:'0912345678',email:'test@example.invalid',date:'2026-11-21',time:'13:00'},line:{lineUserId:'U'+'a'.repeat(32),lineDisplayName:'已驗證測試',lineFriendFlag:true},consent:{verifiedAt:1},version:1,status:'received',studentIds:[],messages:[]};
 const docs=new Map([['runtime/version',{version:1}],['onlineEnrollmentSubmissions/enr-test',row]]);let serial=Promise.resolve();
 const at=(obj,key)=>key.split('.').reduce((v,k)=>v?.[k],obj);
 const snap=p=>({id:p.split('/').at(-1),exists:docs.has(p),ref:ref(p),data:()=>structuredClone(docs.get(p))});
 const ref=p=>({path:p,id:p.split('/').at(-1),get:async()=>snap(p)});
 const query=(name,filters=[])=>({name,filters,query:true,doc:id=>ref(name+'/'+id),where:(f,op,v)=>query(name,[...filters,{f,op,v}]),get:async()=>querySnap({name,filters})});
 const querySnap=q=>({docs:[...docs.keys()].filter(p=>p.split('/')[0]===q.name&&q.filters.every(({f,op,v})=>op==='array-contains'?(at(docs.get(p),f)||[]).includes(v):at(docs.get(p),f)===v)).map(snap)});
 const db={collection:query,runTransaction:fn=>{const p=serial.then(async()=>{let writing=false;const staged=structuredClone(docs);const result=await fn({get:async r=>{assert(!writing,'all reads precede writes');return r.query?querySnap(r):snap(r.path);},set:(r,v)=>{writing=true;staged.set(r.path,{...staged.get(r.path),...structuredClone(v)});},update:(r,v)=>{writing=true;assert(staged.has(r.path));staged.set(r.path,{...staged.get(r.path),...structuredClone(v)});},create:(r,v)=>{writing=true;assert(!staged.has(r.path));staged.set(r.path,structuredClone(v));}});docs.clear();for(const pair of staged)docs.set(...pair);return result;});serial=p.catch(()=>{});return p;}};
 const plans=[{id:'plan',subjectId:'piano',name:'外聘 6/4 2800',amount:2800,lessonCount:4,splitType:'ratio',splitValue:0.6,active:true}];
 const catalog={subjects:[{id:'piano',name:'鋼琴'}],teachers:[{id:'teacher',name:'測試老師',subjectIds:['piano']}],rooms:[{id:'room',name:'鋼琴教室',subjectIds:['piano']}],feePlans:plans};
 const minutes=t=>Number(t?.slice(0,2))*60+Number(t?.slice(3,5)),groups=()=>[...docs.entries()].filter(([p])=>p.startsWith('coursePortalStudentGroups/')).map(([,v])=>v);
 const c={db,require:()=>require('../functions/classDateAccess'),jsonValue:v=>v,TUITION_PERIODS:'coursePortalTuitionPeriods',MIRROR:{tuitionPeriods:'mirrorPeriods'},clean:v=>String(v??'').trim(),dateKey:v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v:'',timeMinutes:minutes,normalizePhone:v=>v,
  addDays:(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10),assertPortalInterval:(a,b)=>{assert(minutes(b)>minutes(a));},HttpsError:require('node:module').createRequire(require.resolve('../functions/enrollment'))('firebase-functions/v2/https').HttpsError,
  readCourseGroups:async()=>groups(),canonicalStudentId:require('../functions/courseGroups').canonicalStudentId,readScheduleVersion:async()=>docs.get('runtime/version').version,mirrorRows:async()=>structuredClone(plans),
  scheduleBundle:async()=>({resourceEvents:blockers,rooms:[{id:'room',name:'鋼琴教室',active:true}],maps:{teachers:{teacher:{active:true,subjectIds:['piano']}},subjects:{piano:{name:'鋼琴'}},students:Object.fromEntries([...docs.entries()].filter(([p])=>p.startsWith('coursePortalStudentProfiles/')).map(([p,v])=>[p.split('/').at(-1),v]))}}),
  rentalPolicySettings:async()=>({}),businessWindow:()=>({closed:false,startMinutes:600,endMinutes:1260}),roomPolicyForSlot:()=>({}),sourceId:r=>r.id,sourceActive:r=>r.active!==false,firstArray:(r,keys)=>r[keys[0]]||[],requestedSubjectResourceIds:()=>[],roomSupportsSubject:()=>true,roomAllowsInterval:()=>true,eventBlocksResource:r=>r.status!=='leave',overlaps:(a,b,c,d)=>minutes(a)<minutes(d)&&minutes(c)<minutes(b),sharedResourceConflict:()=>false,isRoomRentalEvent:r=>r.type==='rental',
  hash:v=>crypto.createHash('sha256').update(v).digest('hex'),cents:v=>{assert(Number.isFinite(v)&&v>=0);},nowText:()=>'',FieldValue:{serverTimestamp:()=>1},scheduleVersionRef:()=>ref('runtime/version'),assertScheduleWritable:s=>{if(s.data().writesBlocked)throw Error('blocked');},normalizeScheduleStatus:v=>v,attendanceLineage:e=>e.fixedCourseId||e.id};
 vm.createContext(c);for(const name of ['function mergePortalTuitionRows(','async function adminSaveSchedule(']){const start=source.indexOf(name);vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),c);}
 const scheduler={context:async()=>({...structuredClone(catalog),groups:structuredClone(groups())}),commit:(data,integration)=>c.adminSaveSchedule(data,integration)};
 const service=createEnrollmentService({db,catalog:async()=>({courses:[]}),scheduler,now:()=>Date.parse('2026-11-16T01:00:00Z'),stamp:()=>1});
 const call=data=>service.adminApi({auth:{uid:'manager',token:{role:'admin'}},data:{id:'enr-test',...data}});
 const review=r=>{const d=r.draft,n=minutes(d.time)+d.duration;const endTime=String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');r.expectedMessage=confirmationMessage({...d,studentNames:[row.form.name,row.form.secondName].filter(Boolean),subjectName:catalog.subjects.find(x=>x.id===d.subjectId)?.name,teacherName:catalog.teachers.find(x=>x.id===d.teacherId)?.name,roomName:catalog.rooms.find(x=>x.id===d.roomId)?.name,endTime,plan:r.expectedPlan},row.form);return r;};
 const request=()=>review({action:'confirmSchedule',version:docs.get('onlineEnrollmentSubmissions/enr-test').version,confirmedWithStudent:true,expectedPlan:structuredClone(plans[0]),draft:{subjectId:'piano',teacherId:'teacher',roomId:'room',planId:'plan',date:'2026-11-28',time:'14:00',duration:60,frequency:'weekly',studentIds:pair?['new','new']:['new'],note:'已與學生確認'}});
 const count=name=>[...docs.keys()].filter(p=>p.startsWith(name+'/')).length;
 return {docs,c,plans,db,catalog,scheduler,service,call,request,count,review,row:()=>docs.get('onlineEnrollmentSubmissions/enr-test')};
}
test('schedule options and confirmation remain manager-only',async()=>{const h=harness();await assert.rejects(h.service.adminApi({data:{action:'scheduleOptions',id:'enr-test'}}),/管理者/);await assert.rejects(h.service.adminApi({auth:{uid:'student',token:{role:'student'}},data:{...h.request(),id:'enr-test'}}),/管理者/);assert.equal(h.docs.size,2);});
test('draft changes persist separately from original request without scheduling or tuition',async()=>{const h=harness(),original=structuredClone(h.row().form);await h.call({action:'saveScheduleDraft',version:1,draft:h.request().draft});assert.deepEqual(h.row().form,original);assert.equal(h.row().scheduleDraft.date,'2026-11-28');assert.equal(h.row().version,2);assert.equal(h.docs.size,2);await assert.rejects(h.call({action:'saveScheduleDraft',version:1,draft:{}}),/資料已更新/);});
test('one confirmation atomically commits recurring class, unpaid tuition, student, verified LINE and admission status',async()=>{
 const h=harness(),original=structuredClone(h.row().form),r=await h.call(h.request());assert.equal(r.ok,true);assert.deepEqual(h.row().form,original);assert.equal(h.row().status,'scheduled');assert.equal(h.row().schedule.date,'2026-11-28');
 assert.equal(h.count('coursePortalStudentProfiles'),1);assert.equal(h.count('coursePortalStudentBindings'),1);assert.equal(h.count('coursePortalTuitionPeriods'),1);assert.equal(h.count('coursePortalFixedCourses'),1);assert.equal(h.count('notificationQueue'),1);
 const course=h.docs.get('coursePortalFixedCourses/'+r.schedule.courseId),period=h.docs.get('coursePortalTuitionPeriods/'+r.schedule.tuitionPeriodId);assert.equal(course.frequencyWeeks,1);assert.equal(course.startDate,'2026-11-28');assert.equal(course.status,'scheduled');assert.equal(period.expectedAmount,2800);assert.equal(period.paidAmount,0);assert.equal(period.planSnapshot.splitValue,.6);assert.equal(period.lessonCount,4);assert.equal(period.periodNo,1);
 assert.equal((await h.call(h.request())).duplicate,true);assert.equal(h.count('coursePortalFixedCourses'),1);
});
test('concurrent confirmations cannot duplicate courses or tuition',async()=>{const h=harness(),r=h.request();await Promise.all([h.call(r),h.call(r)]);assert.equal(h.count('coursePortalFixedCourses'),1);assert.equal(h.count('coursePortalTuitionPeriods'),1);assert.equal(h.count('coursePortalStudentBindings'),1);assert.equal(h.count('notificationQueue'),1);});
test('future weekly collision leaves registration, bindings, student and tuition untouched',async()=>{const h=harness({blockers:[{id:'busy',date:'2026-12-05',startTime:'14:00',endTime:'15:00',roomId:'room',status:'scheduled'}]});await assert.rejects(h.call(h.request()),/2026-12-05/);assert.equal(h.docs.size,2);assert.equal(h.row().status,'received');});
test('explicit student agreement, valid time, eligible teacher, and reviewed plan are mandatory',async()=>{
 for(const change of [r=>r.confirmedWithStudent=false,r=>r.draft.date='2026-02-30',r=>r.draft.time='14:15',r=>r.draft.date='2026-11-14',r=>r.draft.teacherId='not-teacher',r=>r.expectedPlan.amount=1,r=>r.draft.frequency='once',r=>r.draft.duration=30]){const h=harness(),r=h.request();change(r);await assert.rejects(h.call(r));assert.equal(h.docs.size,2);}
});
test('catalog price changing inside native scheduler aborts before any write',async()=>{const h=harness();h.c.mirrorRows=async()=>[{...h.plans[0],amount:3000}];await assert.rejects(h.call(h.request()),/收費方案剛剛/);assert.equal(h.docs.size,2);});
test('stale admission version prevents all native scheduler writes',async()=>{const h=harness(),r=h.request();h.row().version=2;await assert.rejects(h.call(r),/報名資料已更新/);assert.equal(h.docs.size,2);});
test('revoked LINE binding prevents the entire scheduling transaction',async()=>{const h=harness(),sid='online-enr-test-1',key=crypto.createHash('sha256').update('enrollment|'+sid+'|'+h.row().line.lineUserId).digest('hex');h.docs.set('coursePortalStudentBindings/'+key,{status:'revoked'});await assert.rejects(h.call(h.request()),/綁定曾停用/);assert.equal(h.count('coursePortalFixedCourses'),0);assert.equal(h.count('coursePortalTuitionPeriods'),0);assert.equal(h.count('coursePortalStudentProfiles'),0);});
test('new two-person class retains two students and LINE bindings but creates one shared fee period',async()=>{const h=harness({pair:true}),r=await h.call(h.request());assert.equal(h.count('coursePortalStudentProfiles'),2);assert.equal(h.count('coursePortalStudentBindings'),2);assert.equal(h.count('coursePortalStudentGroups'),1);assert.equal(h.count('coursePortalTuitionPeriods'),1);assert.equal(h.docs.get('coursePortalFixedCourses/'+r.schedule.courseId).studentIds.length,1);assert.equal(r.schedule.studentIds.length,2);const phones=['0912345678','0922222222'];assert.deepEqual(h.docs.get('coursePortalStudentGroups/'+r.schedule.scheduleStudentId).memberPhones,phones);assert.deepEqual(r.schedule.studentIds.map(id=>h.docs.get('coursePortalStudentProfiles/'+id).phone),phones);const bindings=[...h.docs].filter(([k])=>k.startsWith('coursePortalStudentBindings/')).map(([,v])=>v);assert.deepEqual(r.schedule.studentIds.map(id=>bindings.find(b=>b.studentId===id).phone),phones);});
test('existing student choice preserves contact data and continues fee period sequence',async()=>{
 const h=harness();h.docs.set('coursePortalStudentProfiles/existing',{id:'existing',name:'測試甲',phone:'0912345678',email:'unchanged@example.invalid',active:true});h.docs.set('coursePortalTuitionPeriods/prior',{id:'prior',studentId:'existing',periodNo:3,active:true});const r=h.request();r.draft.studentIds=['existing'];const result=await h.call(r);assert.equal(h.count('coursePortalStudentProfiles'),1);assert.equal(h.docs.get('coursePortalStudentProfiles/existing').email,'unchanged@example.invalid');assert.equal(h.docs.get('coursePortalTuitionPeriods/'+result.schedule.tuitionPeriodId).periodNo,4);
});
test('already admitted student is reused and cannot be swapped during confirmation',async()=>{
 const h=harness();h.docs.set('coursePortalStudentProfiles/owned',{id:'owned',name:'測試甲',phone:'0912345678',active:true,enrollmentId:'enr-test'});h.row().studentIds=['owned'];h.row().status='admitted';await assert.rejects(h.call(h.request()),/已建檔學生/);const r=h.request();r.draft.studentIds=['owned'];await h.call(r);assert.equal(h.count('coursePortalStudentProfiles'),1);
});
test('existing pair membership cannot be silently regrouped',async()=>{const h=harness();h.docs.set('coursePortalStudentProfiles/existing',{id:'existing',name:'測試甲',phone:'0912345678',active:true});h.docs.set('coursePortalStudentGroups/group',{id:'group',memberIds:['existing','another'],active:true});const r=h.request();r.draft.studentIds=['existing'];await assert.rejects(h.call(r),/分組/);assert.equal(h.count('coursePortalFixedCourses'),0);});
test('native scheduler rechecks missing teaching subjects before applying admission hook',async()=>{const h=harness(),base=h.c.scheduleBundle;h.c.scheduleBundle=async()=>{const b=await base();b.maps.teachers.teacher.subjectIds=[];return b;};await assert.rejects(h.call(h.request()),/授課科目剛剛/);assert.equal(h.docs.size,2);});


test('confirmed schedule queues exactly the reviewed message to the verified applicant, never internal payroll notes',async()=>{
 const h=harness(),r=h.request();r.draft.studentMessageNote='請提早 10 分鐘到教室';r.draft.note='內部專用：分成 6/4';h.review(r);
 await h.call({...r,targetLineUserId:'forged'});
 const saved=h.row().confirmationNotification,q=h.docs.get('notificationQueue/'+saved.queueId);
 assert.equal(q.body,r.expectedMessage);assert.equal(saved.body,q.body);assert.equal(q.targetLineUserId,h.row().line.lineUserId);assert.equal(q.eventCode,'online_enrollment_confirmed');assert.equal(q.emailFallbackEnabled,false);
 assert.match(q.body,/2026\/11\/28（星期六） 14:00–15:00/);assert.match(q.body,/每週星期六/);assert.match(q.body,/2,800／4 堂/);assert.match(q.body,/請提早 10 分鐘/);assert(!/6\/4|分成|內部專用/.test(q.body));
 q.status='發送失敗';q.lastError='LINE unavailable';const result=await h.call({action:'detail'});assert.equal(result.record.confirmationNotification.status,'發送失敗');assert.equal(result.record.confirmationNotification.error,'LINE unavailable');assert.equal(h.count('coursePortalFixedCourses'),1);
 await h.call(r);assert.equal(h.count('notificationQueue'),1);assert.equal(q.status,'發送失敗');
});

test('changed notification preview or missing message approval cannot partially create class, tuition or notification',async()=>{
 for(const update of [r=>delete r.expectedMessage,r=>r.expectedMessage+='changed',r=>r.draft.time='15:00',r=>r.draft.studentMessageNote='not reviewed']){
  const h=harness(),r=h.request();update(r);await assert.rejects(h.call(r),/訊息預覽/);assert.equal(h.docs.size,2);
 }
});

test('public message note can be saved without contacting anyone and is limited in length',async()=>{
 const h=harness(),draft={...h.request().draft,studentMessageNote:'帶筆記本'};await h.call({action:'saveScheduleDraft',version:1,draft});assert.equal(h.row().scheduleDraft.studentMessageNote,'帶筆記本');assert.equal(h.count('notificationQueue'),0);
 await assert.rejects(h.call({action:'saveScheduleDraft',version:2,draft:{...draft,studentMessageNote:'a'.repeat(501)}}),/格式/);
});


test('the existing LINE delivery service sends the exact preview without an extra header',async()=>{
 const h=harness(),r=h.request();await h.call(r);const q=h.docs.get('notificationQueue/'+h.row().confirmationNotification.queueId);let pushed;
 const delivery=fs.readFileSync(require('path').join(__dirname,'../functions/index.js'),'utf8');
 const context={clean:v=>String(v||'').trim(),queueTargetLineUserId:r=>r.targetLineUserId,isValidLinePushTargetId:()=>true,getLineAccessToken:async()=> 'fixture-token',queueTitle:r=>r.title,queueBody:r=>r.body,lineImageUrlFromQueue:()=>'',...require('../functions/trialNotificationNotice'),fetch:async(url,options)=>{assert.equal(url,'https://api.line.me/v2/bot/message/push');pushed=JSON.parse(options.body);return {ok:true,status:200,text:async()=>'{}'};}};
 vm.createContext(context);const start=delivery.indexOf('async function sendLinePush(');vm.runInContext(delivery.slice(start,delivery.indexOf('\n}',start)+2),context);await context.sendLinePush(q);
 assert.equal(pushed.to,h.row().line.lineUserId);assert.equal(pushed.messages.length,1);assert.equal(pushed.messages[0].text,r.expectedMessage);
});
