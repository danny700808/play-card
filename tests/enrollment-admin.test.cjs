'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM,VirtualConsole}=require('jsdom');
test('admin schedules from the inbox with filtered choices, conflict recovery, explicit agreement and a final summary',async()=>{
 const errors=[],calls=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync('enrollment-admin.html','utf8'),{url:'https://danny700808.github.io/play-card/enrollment-admin.html?enrollment=enr-fixture',runScripts:'outside-only',virtualConsole:vc});
 const w=dom.window,d=w.document,$=id=>d.getElementById(id);let authorized=0,schedule=null,attempts=0,notification=null;
 const plan={id:'plan',subjectId:'piano',name:'外聘 6/4',amount:2800,lessonCount:4,splitType:'ratio',splitValue:.6};
 const catalog={subjects:[{id:'piano',name:'鋼琴'},{id:'guitar',name:'木吉他'}],teachers:[{id:'teacher',name:'測試老師',subjectIds:['piano']},{id:'wrong-teacher',name:'另一位老師',subjectIds:['guitar']}],rooms:[{id:'room',name:'平台鋼琴教室',subjectIds:['piano']},{id:'wrong-room',name:'吉他教室',subjectIds:['guitar']}],feePlans:[plan]};
 const row=()=>({id:'enr-fixture',version:schedule?2:1,status:schedule?'scheduled':'received',createdAt:Date.now(),form:{name:'<img src=x onerror=alert(1)>',secondName:'',subjectId:'piano',courseName:'鋼琴',optionName:'單人班',phone:'0912345678',email:'test@example.invalid',price:'2800～3000',lessons:4,date:'2026-11-21',time:'13:00',note:'<script>bad</script>',preferFreeTrial:true,willingToDiscussPaidTrial:true},line:{lineUserId:'U'+'a'.repeat(32),lineDisplayName:'測試 LINE',lineFriendFlag:true},messages:[],managerNote:'',studentIds:schedule?['new-student']:[],...(schedule?{schedule,confirmationNotification:notification}:{})});
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
 assert.match($('records').querySelector('.trial-tag').textContent,/優先安排免費試上（待確認）/);assert.match($('trialReminder').textContent,/告知一堂試上的費用並確認意願.*未取得同意，不要正式排課或收費/);assert.match($('records').textContent,/可先討論付費試上一堂/);assert.match($('detailContent').textContent,/尚未同意費用/);assert.match($('detailContent').textContent,/正式課程參考學費/);assert(!calls.some(c=>c.action==='confirmSchedule'));
 assert.equal($('scheduleSubject').value,'piano');assert.equal($('scheduleFrequency').value,'weekly');assert.equal($('scheduleTeacher').querySelector('[value="wrong-teacher"]'),null);assert.equal($('scheduleRoom').querySelector('[value="wrong-room"]'),null);assert($('confirmSchedule').disabled);
 const input=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new w.Event('input'));};
 input('scheduleTeacher','teacher');input('scheduleRoom','room');input('schedulePlan','plan');input('scheduleDate','2026-11-28');input('scheduleTime','14:00');
 assert.match($('schedulePlan').textContent,/2,800.*老師 60%.*教室 40%/);assert.match($('confirmationPreview').textContent,/2026\/11\/28（星期六） 14:00–15:00/);input('scheduleNote','內部用');input('studentMessageNote','請帶筆記本');assert.match($('confirmationPreview').textContent,/請帶筆記本/);assert(!$('extraContact').open);assert.equal($('confirmSchedule').textContent,'確認排課並傳送 LINE');$('scheduleAgreement').click();assert(!$('confirmSchedule').disabled);input('scheduleTime','14:30');assert(!$('scheduleAgreement').checked);assert($('confirmSchedule').disabled);
 $('scheduleAgreement').click();$('confirmSchedule').click();await settled();assert.match($('scheduleError').textContent,/2026-12-05/);assert.equal($('scheduleTime').value,'14:30');assert.equal(schedule,null);
 input('scheduleTime','15:00');$('scheduleAgreement').click();$('confirmSchedule').click();await settled();assert(schedule);assert.equal($('confirmSchedule'),null);assert.match($('detailNotice').textContent,/排課已完成/);assert.match($('scheduleHost').textContent,/LINE：待發送/);assert.match($('scheduleHost').textContent,/15:00–16:00/);assert.match($('records').textContent,/正式：2026-11-28 15:00/);assert.match($('records').textContent,/原偏好：優先安排免費試上/);assert.equal($('trialReminder'),null);assert.equal(authorized,calls.length);assert(!calls.some(c=>['message','admit'].includes(c.action)));assert.deepEqual(errors,[]);w.close();
});
test('native form loads all course image assets from its own asset directory and private data collections are not client allowlisted',()=>{
 const html=fs.readFileSync('enrollment.html','utf8'),js=fs.readFileSync('enrollment-assets/app.js','utf8');
 assert.match(html,/src="enrollment-assets\/app.js\?v=20261121-trial-label"/);assert.match(js,/document.currentScript/);assert(!html.includes('lineDialog'));assert.match(html,/id="accessPanel"/);
 for(let n=1;n<=23;n++)assert(fs.existsSync('enrollment-assets/assets/course-'+String(n).padStart(2,'0')+'.jpg'));
 const rules=fs.readFileSync('firestore.rules','utf8');assert(!/onlineEnrollment/.test(rules));assert.match(rules,/match \/\{document=\*\*\} \{\s+allow read, write: if false;/);
 const routes=require('../internal-workspace-routes');assert.deepEqual(routes.pageContext('/enrollment-admin.html','','').map(n=>n.id),['root','enrollment','online-enrollment']);
});


test('completion distinguishes verified LINE identity from formal enrollment for friends and non-friends',async()=>{
 for(const friend of [true,false]){
  const dom=new JSDOM(fs.readFileSync('enrollment.html','utf8'),{url:'https://danny700808.github.io/play-card/enrollment.html#enrollmentTicket='+ 'g'.repeat(43),runScripts:'outside-only'}),w=dom.window,d=w.document;
  w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.sessionStorage.setItem('youzi.enrollment.pending.v1',JSON.stringify({verifier:'v'.repeat(43),expiresAt:Date.now()+600000}));
  w.fetch=async(url,options)=>{assert.equal(JSON.parse(options.body).action,'redeem');return {ok:true,json:async()=>({ok:true,receiptId:'enr-test',courseName:'鋼琴',optionName:'單人班',price:2800,lessons:4,date:'2026-11-26',time:'13:30',name:'測試',lineFriendFlag:friend,preferFreeTrial:friend,...(friend?{willingToDiscussPaidTrial:true}:{})})};};
  w.eval(fs.readFileSync('enrollment-assets/app.js','utf8'));assert.equal(await w.catalogReady,true);
  assert.doesNotMatch(d.getElementById('step4').textContent,/報名編號|enr-test/);assert.equal(d.getElementById('step4').hidden,false);assert.match(d.querySelector('.success-badge').textContent,/LINE 身分已確認/);assert(!d.querySelector('.success-badge').textContent.includes('已綁定'));
  assert.match(d.getElementById('successMessage').textContent,/課程尚未排定/);if(!friend)assert.match(d.getElementById('successMessage').textContent,/加入官方 LINE/);
  assert.equal(d.getElementById('addOfficialFriend').hidden,friend);
  const chat=new URL(d.getElementById('officialLine').href);
  assert.equal(decodeURIComponent(chat.pathname),'/R/oaMessage/@046xzcpz/');
  const lineDraft=decodeURIComponent(chat.search.slice(1));assert.match(lineDraft,/測試.*鋼琴.*希望上課時間.*13:30/);assert.equal(/免費試上/.test(lineDraft),friend);
  const summary=d.getElementById('successSummary').textContent;
  assert.equal(/優先安排免費試上（待確認）/.test(summary),friend);assert.equal(/可先討論付費試上一堂；尚未同意費用/.test(summary),friend);assert.equal(/正式課程參考學費：NT\$ 2,800.*是否有費用/.test(summary),friend);assert.equal(d.getElementById('preferFreeTrial').checked,false);w.close();
 }
});


test('browser preview uses the same formatter as the server and loads it before the scheduling controls',()=>{
 assert.equal(fs.readFileSync('enrollment-confirmation-message.js','utf8').replace(/\r\n/g,'\n'),fs.readFileSync('functions/enrollmentConfirmationMessage.js','utf8').replace(/\r\n/g,'\n'));
 const html=fs.readFileSync('enrollment-admin.html','utf8');assert(html.indexOf('enrollment-confirmation-message.js')<html.indexOf('enrollment-scheduling-ui.js'));
});

test('duo registration keeps multiple dates, requires each phone, and clears companion data on return to solo',async()=>{
 const dom=new JSDOM(fs.readFileSync('enrollment.html','utf8'),{url:'https://danny700808.github.io/play-card/enrollment.html',runScripts:'outside-only'});
 const w=dom.window,d=w.document,$=id=>d.getElementById(id);
 w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const options=[{id:'solo',name:'單人班',price:2800,lessons:4},{id:'duo',name:'雙人班',price:3600,lessons:4}];
 w.fetch=async()=>({ok:true,json:async()=>({ok:true,courses:[{id:1,subjectId:'piano',name:'流行鋼琴',image:'piano.jpg',options}]})});
 w.eval(fs.readFileSync('enrollment-assets/app.js','utf8'));assert(await w.catalogReady);
 d.querySelector('[data-course]').click();d.querySelector('[value="duo"]').click();
 assert(!$('classHint').hidden);assert($('classHint').compareDocumentPosition($('classOptions'))&4);$('chooseCourse').click();
 const api=w.YouziEnrollment,dates=[];
 for(let i=1;dates.length<2;i++){const key=api.addDays(api.todayKey(),i);if(api.slotsFor(key).includes('13:00'))dates.push(key);}
 function pickDate(date){const [y,m,day]=date.split('-').map(Number);for(const [key,v] of [['dateYear',y],['dateMonth',m],['dateDay',day]]){$(key).value=String(v);$(key).dispatchEvent(new w.Event('change'));}}
 const slot=t=>d.querySelector('[data-time="'+t+'"]');
 pickDate(dates[0]);slot('13:00').click();slot('15:00').click();
 assert(!$('addDate').hidden);$('addDate').click();assert.equal($('dateDay').value,'');assert.equal(d.activeElement,$('dateDay'));
 assert.equal(api.state.times.length,2);assert.match($('chosenTimes').textContent,/已選 1 天，共 2 個時段/);
 pickDate(dates[1]);slot('13:00').click();
 assert.equal($('chosenTimes').querySelectorAll('li').length,2);assert.match($('chosenTimes').textContent,/已選 2 天，共 3 個時段/);
 assert.match($('phoneLabel').textContent,/第一位上課人行動電話/);assert.match($('secondPhoneField').textContent,/第二位上課人行動電話/);
 pickDate(dates[0]);assert.equal(slot('13:00').getAttribute('aria-pressed'),'true');slot('13:00').click();
 assert.deepEqual(Array.from(api.state.times),[dates[0]+' 15:00',dates[1]+' 13:00']);
 $('studentName').value='甲';$('phone').value='0911111111';$('secondName').value='乙';$('email').value='test@example.invalid';
 assert($('secondPhone').required);$('nextButton').click();assert.equal(api.state.step,2);
 $('secondPhone').value='0922222222';$('nextButton').click();assert.equal(api.state.step,3);assert.match($('review').textContent,/乙 · 0922222222/);
 $('editDetails').click();$('changeCourse').click();d.querySelector('[data-course]').click();d.querySelector('[value="solo"]').click();$('chooseCourse').click();
 assert($('secondPhoneField').hidden);assert.equal($('secondPhone').value,'');$('nextButton').click();assert.equal(api.state.step,3);assert.doesNotMatch($('review').textContent,/乙|0922222222/);
 w.close();
});

test('optional trial starts unchecked, survives date edits and LINE cancellation, and may be turned off',async()=>{
 const {webcrypto}=require('node:crypto');
 const dom=new JSDOM(fs.readFileSync('enrollment.html','utf8'),{url:'https://danny700808.github.io/play-card/enrollment.html',runScripts:'outside-only'});
 const w=dom.window,d=w.document,$=id=>d.getElementById(id),requests=[];
 w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});w.TextEncoder=TextEncoder;
 const options=[{id:'solo',name:'單人班',price:2800,lessons:4}];
 w.fetch=async(url,params)=>{const data=JSON.parse(params.body);requests.push(data);return {ok:true,json:async()=>({ok:true,freeTrialEligibleCourses:[{courseId:1,subjectId:'piano'}],courses:[{id:1,subjectId:'piano',name:'古典鋼琴',image:'piano.jpg',options},{id:6,subjectId:'fingerstyle',name:'民謠吉他 Fingerstyle',image:'guitar.jpg',options}],authorizationUrl:'https://access.line.me/oauth2/v2.1/authorize'})};};
 w.eval(fs.readFileSync('enrollment-assets/app.js','utf8'));assert(await w.catalogReady);
 const api=w.YouziEnrollment,context='youzi.enrollment.pending.v1',preference=$('preferFreeTrial');
 assert(!preference.checked);assert($('trialPreference').hidden);assert(!preference.required);assert($('paidTrialPreference').hidden);assert.match(d.querySelector('[data-course="1"] .trial-badge').textContent,/可洽詢免費試上/);assert.equal(d.querySelector('[data-course="6"] .trial-badge'),null);
 d.querySelector('[data-course]').click();$('chooseCourse').click();
 let day;for(let i=1;!day;i++){const candidate=api.addDays(api.todayKey(),i);if(api.slotsFor(candidate).includes('13:00'))day=candidate;}
 const [y,m,n]=day.split('-').map(Number);
 for(const [id,value] of [['dateYear',y],['dateMonth',m],['dateDay',n]]){$(id).value=String(value);$(id).dispatchEvent(new w.Event('change'));}
 assert($('trialPreference').hidden);
 d.querySelector('[data-time="13:00"]').click();assert(!$('trialPreference').hidden);assert(!preference.disabled);assert.match($('trialHelp').textContent,/雙方確認前不會安排試上或收費/);assert($('paidTrialPreference').hidden);
 $('studentName').value='測試學生';$('phone').value='0911111111';$('email').value='test@example.invalid';
 $('nextButton').click();assert.match($('review').textContent,/未要求優先安排免費試上/);
 $('consent').click();assert(await api.prepareLine());const first=requests.at(-1);assert.equal(first.form.preferFreeTrial,false);assert(!Object.hasOwn(first.form,'willingToDiscussPaidTrial'));
 // A saved old browser draft omits the field; retrying it unchecked keeps its submission identity.
 const old=JSON.parse(w.sessionStorage.getItem(context));delete old.form.preferFreeTrial;w.sessionStorage.setItem(context,JSON.stringify(old));
 w.history.replaceState(null,'','#enrollmentError=cancelled');assert(await api.boot());assert(!preference.checked);assert.equal(api.state.step,3);assert.match($('submitError').textContent,/已取消 LINE/);
 $('consent').click();assert(await api.prepareLine());assert.equal(requests.at(-1).submissionKey,first.submissionKey);
 $('editDetails').click();preference.click();assert(!$('paidTrialPreference').hidden);const paid=$('willingToDiscussPaidTrial');assert(!paid.checked);assert.match($('paidTrialHelp').textContent,/若無法安排免費試上，教室會先告知單堂費用，確認後再安排/);paid.click();$('addDate').click();assert(preference.checked);assert(paid.checked);$('nextButton').click();assert.match($('lineSummary').textContent,/優先安排免費試上（待確認）/);
 assert.match($('lineSummary').textContent,/正式課程參考學費：NT\$ 2,800.*是否有費用，將由教室先和你確認/);
 assert.equal(await api.prepareLine(),null,'preference does not accept LINE consent');
 $('consent').click();assert(await api.prepareLine());const checked=requests.at(-1);assert.equal(checked.form.preferFreeTrial,true);assert.equal(checked.form.willingToDiscussPaidTrial,true);assert.notEqual(checked.submissionKey,first.submissionKey);
 w.history.replaceState(null,'','#enrollmentError=cancelled');assert(await api.boot());assert(preference.checked);assert(paid.checked);assert.match($('review').textContent,/優先安排免費試上（待確認）/);assert.match($('review').textContent,/尚未同意費用/);
 $('editDetails').click();preference.click();assert(!paid.checked);assert($('paidTrialPreference').hidden);$('nextButton').click();assert.doesNotMatch($('lineSummary').textContent,/免費試上/);$('consent').click();assert(await api.prepareLine());assert.equal(requests.at(-1).form.preferFreeTrial,false);assert(!Object.hasOwn(requests.at(-1).form,'willingToDiscussPaidTrial'));
 $('editDetails').click();preference.click();paid.click();$('changeCourse').click();d.querySelector('[data-course="6"]').click();$('chooseCourse').click();assert($('trialPreference').hidden);assert($('paidTrialPreference').hidden);$('nextButton').click();assert.doesNotMatch($('review').textContent,/試上偏好/);$('consent').click();assert(await api.prepareLine());assert.equal(requests.at(-1).form.courseId,6);assert.equal(requests.at(-1).form.preferFreeTrial,false);assert(!Object.hasOwn(requests.at(-1).form,'willingToDiscussPaidTrial'));
 w.close();
});

test('inbox distinguishes unchecked and legacy trial preferences even on closed records',async()=>{
 const dom=new JSDOM(fs.readFileSync('enrollment-admin.html','utf8'),{url:'https://danny700808.github.io/play-card/enrollment-admin.html',runScripts:'outside-only'});
 const w=dom.window,d=w.document,$=id=>d.getElementById(id);
 const form={name:'測試學生',courseName:'鋼琴',optionName:'單人班',price:'2800',lessons:4,date:'2026-11-28',time:'15:00',phone:'0912345678',email:'fixture@example.invalid'};
 const records=['enr-off','enr-legacy'].map((id,index)=>({id,form:{...form,...(index===0?{preferFreeTrial:false}:{})},line:{lineDisplayName:'測試 LINE'},status:'closed',createdAt:Date.now()}));
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.EnrollmentSchedulingUI={mount:()=>null};w.YZManagerAuth={requireManager:async()=>{}};
 w.firebase={app:()=>({functions:()=>({httpsCallable:()=>async({action,id})=>{
  if(action==='list')return {data:{records,nextCursor:''}};
  if(action==='detail')return {data:{record:records.find(r=>r.id===id)}};
  if(action==='scheduleOptions')return {data:{catalog:{}}};
  throw Error('Unexpected operation '+action);
 }})})};
 const settle=async()=>{for(let n=0;n<5;n++)await new Promise(r=>setImmediate(r));};
 w.eval(fs.readFileSync('enrollment-admin.js','utf8'));await settle();
 assert.equal($('records').querySelector('.trial-tag'),null);
 for(const [id,label] of [['enr-off',/未勾選優先安排；不代表同意付費/],['enr-legacy',/舊版報名未記錄試上偏好/]]){
  d.querySelector('[data-open="'+id+'"]').click();await settle();assert.match($('detailContent').textContent,label);assert.equal($('trialReminder'),null);
 }
 w.close();
});
