'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM,VirtualConsole}=require('jsdom');
test('admin schedules from the inbox with filtered choices, conflict recovery, explicit agreement and a final summary',async()=>{
 const errors=[],calls=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync('enrollment-admin.html','utf8'),{url:'https://danny700808.github.io/play-card/enrollment-admin.html?enrollment=enr-fixture',runScripts:'outside-only',virtualConsole:vc});
 const w=dom.window,d=w.document,$=id=>d.getElementById(id);let authorized=0,schedule=null,attempts=0,notification=null;
 const plan={id:'plan',subjectId:'piano',name:'外聘 6/4',amount:2800,lessonCount:4,splitType:'ratio',splitValue:.6};
 const catalog={subjects:[{id:'piano',name:'鋼琴'},{id:'guitar',name:'木吉他'}],teachers:[{id:'teacher',name:'測試老師',subjectIds:['piano']},{id:'wrong-teacher',name:'另一位老師',subjectIds:['guitar']}],rooms:[{id:'room',name:'平台鋼琴教室',subjectIds:['piano']},{id:'wrong-room',name:'吉他教室',subjectIds:['guitar']}],feePlans:[plan]};
 const row=()=>({id:'enr-fixture',version:schedule?2:1,status:schedule?'scheduled':'received',createdAt:Date.now(),form:{name:'<img src=x onerror=alert(1)>',secondName:'',subjectId:'piano',courseName:'鋼琴',optionName:'單人班',phone:'0912345678',email:'test@example.invalid',price:'2800～3000',lessons:4,date:'2026-11-21',time:'13:00',note:'<script>bad</script>'},line:{lineUserId:'U'+'a'.repeat(32),lineDisplayName:'測試 LINE',lineFriendFlag:true},messages:[],managerNote:'',studentIds:schedule?['new-student']:[],...(schedule?{schedule,confirmationNotification:notification}:{})});
 w.YZManagerAuth={requireManager:async options=>{assert.equal(options.next,'enrollment-admin.html?enrollment=enr-fixture');authorized++;}};
 w.firebase={app:()=>({functions:region=>{assert.equal(region,'asia-east1');return {httpsCallable:name=>{assert.equal(name,'enrollmentAdmin');return async data=>{calls.push(data);let result;
  if(data.action==='list')result={records:[row()],nextCursor:''};
  else if(data.action==='detail')result={record:row(),matches:[]};
  else if(data.action==='scheduleOptions')result={catalog};
  else if(data.action==='confirmSchedule'){assert.deepEqual(Array.from(data.draft.studentIds),['new']);assert.equal(data.confirmedWithStudent,true);assert.equal(data.expectedPlan.amount,2800);assert.equal(data.expectedPlan.splitValue,.6);assert.equal(data.draft.frequency,'weekly');assert.equal(data.expectedMessage,$('confirmationPreview').textContent);assert(!/60%|40%|6\/4|內部用/.test(data.expectedMessage));if(++attempts===1)throw Error('2026-12-05 的老師已被占用。');schedule={subjectName:'鋼琴',teacherName:'測試老師',roomName:'平台鋼琴教室',date:data.draft.date,time:data.draft.time,endTime:'16:00',frequency:'weekly',plan};notification={body:data.expectedMessage,status:'待發送'};result={ok:true,schedule};}
  else throw Error('Unexpected operation '+data.action);
  return {data:result};
 };}};}})};
 w.confirm=()=>{throw Error('The reviewed primary action must not ask for another confirmation');};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const settled=async()=>{for(let n=0;n<10;n++)await new Promise(r=>setImmediate(r));};
 w.eval(fs.readFileSync('enrollment-confirmation-message.js','utf8'));w.eval(fs.readFileSync('enrollment-scheduling-ui.js','utf8'));w.eval(fs.readFileSync('enrollment-admin.js','utf8'));await settled();assert.match($('notice').textContent,/1 份/);assert.equal($('records').querySelectorAll('img').length,0);
 assert.equal($('registrationUrl').value,'https://danny700808.github.io/play-card/enrollment.html');assert.equal($('openRegistration').href,$('registrationUrl').value);assert.equal($('createInvite'),null);assert(!calls.some(c=>['invites','createInvite'].includes(c.action)));
 assert($('detailDialog').open,'notification deep link opens the requested record');assert.match($('detailContent').textContent,/待你確認排課後/);assert.match($('detailContent').textContent,/管理者 LINE 通知/);assert.equal($('detailContent').querySelectorAll('script,img').length,0);assert.match($('detailContent').textContent,/2800～3000/);
 assert.equal($('scheduleSubject').value,'piano');assert.equal($('scheduleFrequency').value,'weekly');assert.equal($('scheduleTeacher').querySelector('[value="wrong-teacher"]'),null);assert.equal($('scheduleRoom').querySelector('[value="wrong-room"]'),null);assert($('confirmSchedule').disabled);
 const input=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new w.Event('input'));};
 input('scheduleTeacher','teacher');input('scheduleRoom','room');input('schedulePlan','plan');input('scheduleDate','2026-11-28');input('scheduleTime','14:00');
 assert.match($('schedulePlan').textContent,/2,800.*老師 60%.*教室 40%/);assert.match($('confirmationPreview').textContent,/2026\/11\/28（星期六） 14:00–15:00/);input('scheduleNote','內部用');input('studentMessageNote','請帶筆記本');assert.match($('confirmationPreview').textContent,/請帶筆記本/);assert(!$('extraContact').open);assert.equal($('confirmSchedule').textContent,'確認排課並傳送 LINE');$('scheduleAgreement').click();assert(!$('confirmSchedule').disabled);input('scheduleTime','14:30');assert(!$('scheduleAgreement').checked);assert($('confirmSchedule').disabled);
 $('scheduleAgreement').click();$('confirmSchedule').click();await settled();assert.match($('scheduleError').textContent,/2026-12-05/);assert.equal($('scheduleTime').value,'14:30');assert.equal(schedule,null);
 input('scheduleTime','15:00');$('scheduleAgreement').click();$('confirmSchedule').click();await settled();assert(schedule);assert.equal($('confirmSchedule'),null);assert.match($('detailNotice').textContent,/排課已完成/);assert.match($('scheduleHost').textContent,/LINE：待發送/);assert.match($('scheduleHost').textContent,/15:00–16:00/);assert.match($('records').textContent,/正式：2026-11-28 15:00/);assert.equal(authorized,calls.length);assert(!calls.some(c=>['message','admit'].includes(c.action)));assert.deepEqual(errors,[]);w.close();
});
test('native form loads all course image assets from its own asset directory and private data collections are not client allowlisted',()=>{
 const html=fs.readFileSync('enrollment.html','utf8'),js=fs.readFileSync('enrollment-assets/app.js','utf8');
 assert.match(html,/src="enrollment-assets\/app.js\?v=20261116-notice"/);assert.match(js,/document.currentScript/);assert(!html.includes('lineDialog'));assert.match(html,/id="accessPanel"/);
 for(let n=1;n<=23;n++)assert(fs.existsSync('enrollment-assets/assets/course-'+String(n).padStart(2,'0')+'.jpg'));
 const rules=fs.readFileSync('firestore.rules','utf8');assert(!/onlineEnrollment/.test(rules));assert.match(rules,/match \/\{document=\*\*\} \{\s+allow read, write: if false;/);
 const routes=require('../internal-workspace-routes');assert.deepEqual(routes.pageContext('/enrollment-admin.html','','').map(n=>n.id),['root','enrollment','online-enrollment']);
});


test('completion distinguishes verified LINE identity from formal enrollment for friends and non-friends',async()=>{
 for(const friend of [true,false]){
  const dom=new JSDOM(fs.readFileSync('enrollment.html','utf8'),{url:'https://danny700808.github.io/play-card/enrollment.html#enrollmentTicket='+ 'g'.repeat(43),runScripts:'outside-only'}),w=dom.window,d=w.document;
  w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.sessionStorage.setItem('youzi.enrollment.pending.v1',JSON.stringify({verifier:'v'.repeat(43),expiresAt:Date.now()+600000}));
  w.fetch=async(url,options)=>{assert.equal(JSON.parse(options.body).action,'redeem');return {ok:true,json:async()=>({ok:true,receiptId:'enr-test',courseName:'鋼琴',optionName:'單人班',price:2800,lessons:4,date:'2026-11-26',time:'13:30',name:'測試',lineFriendFlag:friend})};};
  w.eval(fs.readFileSync('enrollment-assets/app.js','utf8'));assert.equal(await w.catalogReady,true);
  assert.equal(d.getElementById('step4').hidden,false);assert.match(d.querySelector('.success-badge').textContent,/LINE 身分已確認/);assert(!d.querySelector('.success-badge').textContent.includes('已綁定'));
  assert.match(d.getElementById('successMessage').textContent,/課程尚未排定/);if(!friend)assert.match(d.getElementById('successMessage').textContent,/加入官方 LINE/);w.close();
 }
});


test('browser preview uses the same formatter as the server and loads it before the scheduling controls',()=>{
 assert.equal(fs.readFileSync('enrollment-confirmation-message.js','utf8').replace(/\r\n/g,'\n'),fs.readFileSync('functions/enrollmentConfirmationMessage.js','utf8').replace(/\r\n/g,'\n'));
 const html=fs.readFileSync('enrollment-admin.html','utf8');assert(html.indexOf('enrollment-confirmation-message.js')<html.indexOf('enrollment-scheduling-ui.js'));
});
