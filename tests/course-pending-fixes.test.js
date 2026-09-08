const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const backend=read('functions/coursePortal.js');
function extract(name){const start=backend.indexOf('function '+name+'(');return backend.slice(start,backend.indexOf('\n}',start)+2);}
const c=vm.createContext({clean:v=>String(v??'').trim()});
for(const n of ['firstFiniteNumber','transactionAmount','tuitionBasePaidAmount'])vm.runInContext(extract(n),c);
test('missing legacy payment summary derives from actual receipts, without counting retries or pending payments',()=>{
 const tx={id:'one',amount:3000,type:'payment'};
 assert.equal(c.tuitionBasePaidAmount({transactions:[tx,tx,{id:'refund',type:'refund',amount:500},{id:'pending',status:'pending_review',amount:3000}]}),2500);
 assert.equal(c.tuitionBasePaidAmount({paymentDate:'2026-08-01'}),0);
 assert.equal(c.tuitionBasePaidAmount({paidAmount:1500,transactions:[tx]}),1500);
});
test('history retains only cutoff-containing period and later periods, even with ancient debt',()=>{
 const {selectHistoryPeriods}=require('../functions/courseHistory');
 const row=(id,start,end,due)=>({id,studentId:'s',subjectId:'g',teacherId:'t',startDate:start,endDate:end,outstandingAmount:due});
 const rows=[row('old','2026-05-01','2026-05-31',3000),row('boundary','2026-07-10','2026-08-01',1000),row('new','2026-08-02','',0)];
 assert.deepEqual(selectHistoryPeriods(rows,'2026-07-21').map(r=>r.id),['new','boundary']);
 assert.deepEqual(selectHistoryPeriods([row('completed','2026-05-01','2026-05-31',3000)]),[]);
 assert.deepEqual(selectHistoryPeriods([{...row('old-unknown','2026-05-01','',3000),usedCount:4,lessonCount:4}]),[]);
 assert.deepEqual(selectHistoryPeriods([{...row('old-unused','2025-05-01','',3000),usedCount:0,lessonCount:4,hasCutoffEvidence:false}]),[]);
});
test('teacher actions allow earlier time today, reject yesterday; rentals retain minute validation',()=>{
 const x=vm.createContext({dateKey:v=>v,currentTaipeiDay:()=> '2026-09-08'});
 vm.runInContext(extract('courseDateIsPast'),x);
 assert.equal(x.courseDateIsPast('2026-09-08'),false);assert.equal(x.courseDateIsPast('2026-09-07'),true);
 assert(backend.includes('publicRentalSlotIsPast(availability.date, availability.startTime)'));
});
test('shared records exclude leave sections and roster has no duplicate add button',()=>{
 assert(!read('course-history-view.js').includes('請假紀錄（不扣堂）'));
 assert(!read('teacher-course-portal-v8.js').includes('data-student-action="${escapeHtml(student.id)}"'));
 const html=read('teacher-course-portal.html');
 assert(html.indexOf('id="teacherAnnouncementClose"') < html.indexOf('<script src="teacher-course-portal-v8.js'));
 assert(read('teacher-course-portal-v8.js').includes('event.source === frame.contentWindow'));
});

test('shared course cards show signed dates and payment details without leave dates', async()=>{
 const elements=new Map();const element=k=>{if(!elements.has(k))elements.set(k,{innerHTML:'',value:'',addEventListener(){}});return elements.get(k);};
 const host={isConnected:true,querySelector:element},window={};vm.runInNewContext(read('course-history-view.js'),{window});
 window.CourseHistoryView.mount(host,{call:async()=>({subjects:[{id:'g',name:'吉他'}],periods:[{id:'p',subjectId:'g',lessonCount:4,usedCount:1,expectedAmount:3000,paidAmount:3000,outstandingAmount:0,transactions:[{type:'payment',date:'2026-08-01'}]}],lessons:[{periodId:'p',status:'attended',date:'2026-08-02'},{periodId:'p',status:'leave',date:'2026-08-09'}]})});
 await new Promise(resolve=>setImmediate(resolve));const html=element('[data-history-cards]').innerHTML;
 assert.match(html,/2026-08-02/);assert.match(html,/已繳費/);assert.match(html,/實收 \$3,000/);assert.doesNotMatch(html,/2026-08-09|請假紀錄/);
});
test('announcement read refresh is queued if an older badge request is still running',async()=>{
 const src=read('teacher-course-portal-v8.js'),start=src.indexOf('  async function refreshTeacherUtilityStatus(force) {');
 const code=src.slice(start,src.indexOf('\n  }',start)+4);const pending=[];let calls=0;
 const x=vm.createContext({token:'test',teacherUtilityRefreshQueued:false,teacherUtilityStatusLoaded:false,teacherUtilityStatusLoadedAt:0,TEACHER_UTILITY_STATUS_TTL:100,teacherUtilityStatusLoading:false,teacherUtilityRequestId:0,invoke:()=>{calls++;return new Promise(resolve=>pending.push(resolve));},saveTeacherUtilityAuthorization:()=>{},renderTeacherUtilityStatus:()=>{}});
 vm.runInContext(code,x);x.refreshTeacherUtilityStatus(false);await x.refreshTeacherUtilityStatus(true);assert.equal(calls,1);pending.shift()({});await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);pending.shift()({});await new Promise(resolve=>setImmediate(resolve));assert.equal(x.teacherUtilityStatusLoading,false);
});
