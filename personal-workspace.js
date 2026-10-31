(function(){
 'use strict';
 const $=id=>document.getElementById(id),model=window.PersonalWorkspaceModel;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'$'+Number(n||0).toLocaleString('zh-TW'),today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
 const params=new URLSearchParams(location.search);let preview=false,realPreview=false,state=null,tab='attendance',generation=0,previewLoad=0,attendanceMonth=today().slice(0,7),salaryMonth=today().slice(0,7);
 const icons={schedule:'▦',attendance:'◷',salary:'＄',rental:'⌂',more:'☰'};
 const features={clock:['打卡','clock.html'],hours:['填寫工時','parttime.html'],leave:['請假','leave.html'],temporary:['臨時出勤','temporary-attendance.html'],announcement:['公告','announcements.html'],task:['待辦','task.html'],routine:['定期事項','routine.html'],training:['教育訓練','training.html'],forms:['表單與證明','forms-hub.html'],notification:['通知設定','profile.html']};
 function status(text,error=false){$('personalStatus').textContent=text||'';$('personalStatus').classList.toggle('personal-error',error);}
 async function verifyIdentity(expected){
  const auth=firebase.auth();if(auth.authStateReady)await auth.authStateReady();const claims=auth.currentUser?(await auth.currentUser.getIdTokenResult()).claims:{};
  const local=getUser();if(claims.employee!==true||String(claims.employeeId||'')!==String(expected||'')||local&&!local.portalSessionBridge&&String(local.id)!==String(expected))throw Error('帳號已切換或登入到期，請重新開啟工作台。');
 }
 async function call(action,data={}){
  const expected=state?.user.id||getUser()?.id;await verifyIdentity(expected);
  const result=await window.YZProtectedData.call('personalWorkspace',{action,...data,expectedEmployeeId:expected});await verifyIdentity(expected);return result;
 }
 async function managerRead(action,data={}){
  const auth=firebase.auth();if(auth.authStateReady)await auth.authStateReady();const current=auth.currentUser,claims=current?(await current.getIdTokenResult()).claims:{};
  if(claims.employee!==true||claims.manager!==true)throw Error('請以管理者帳號開啟員工檢視。');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),170000);
  try{const response=await fetch('https://'+(APP_CONFIG.FUNCTION_REGION||'us-central1')+'-'+APP_CONFIG.FIREBASE_CONFIG.projectId+'.cloudfunctions.net/personalWorkspace',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await current.getIdToken()},body:JSON.stringify({data:{action,...data,expectedEmployeeId:claims.employeeId}}),signal:controller.signal});const result=await response.json();if(!response.ok||result.error)throw Error(result.error?.message||'讀取失敗。');if(auth.currentUser?.uid!==current.uid)throw Error('帳號已切換，請重新開啟。');return result.result||result.data;}finally{clearTimeout(timer);}
 }
 async function personalRead(action,payload){
  if(!['getTodaySchedule','getEditableClockHistory','getClockHistoryRange','getMySalaryInfo','getParttimeHistory'].includes(action))throw Error('檢視模式不支援這個操作。');
  const auth=firebase.auth(),current=auth.currentUser;
  if(realPreview){const claims=current?(await current.getIdTokenResult()).claims:{};if(claims.employee!==true||claims.manager!==true)throw Error('請重新登入管理者帳號。');}
  else if(!preview)await verifyIdentity(state.user.id);
  const result=await api(action,payload);if(auth.currentUser?.uid!==current?.uid)throw Error('帳號已切換，請重新開啟。');return result;
 }
 function button(text,action,cls=''){return '<button type="button" class="personal-btn '+cls+'" data-action="'+esc(action)+'">'+esc(text)+'</button>';}
 function row(label,value){return '<div class="personal-row"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';}
 function card(title,content){return '<section class="personal-card">'+(title?'<h2>'+esc(title)+'</h2>':'')+content+'</section>';}
 function menu(items){return '<div class="personal-menu">'+items.map(([title,action])=>button(title,action)).join('')+'</div>';}
 function actions(items){return '<div class="personal-grid">'+items.map(([title,action,icon])=>'<button type="button" class="personal-action" data-action="'+action+'"><span class="personal-icon" aria-hidden="true">'+icon+'</span>'+title+'</button>').join('')+'</div>';}
 function bindActions(){document.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click',()=>open(el.dataset.action)));}
 function body(html){$('personalBody').innerHTML=html;bindActions();}
 function nav(){
  $('personalName').textContent=state.user.name;$('personalRole').textContent=state.user.identityLabel;
  $('personalTabs').innerHTML=model.tabs(state.capabilities).map(([key,label])=>'<button type="button" class="personal-tab '+(tab===key?'active':'')+'" aria-current="'+(tab===key?'page':'false')+'" data-tab="'+key+'"><b aria-hidden="true">'+icons[key]+'</b>'+label+'</button>').join('');
  document.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>selectTab(el.dataset.tab)));
 }
 async function selectTab(next){
  if(!model.tabs(state.capabilities).some(([key])=>key===next))return;
  if(!preview)try{await verifyIdentity(state.user.id);}catch(e){status(e.message,true);body('<a class="personal-btn full" href="login.html?next=dashboard.html">重新登入</a>');return;}
  tab=next;generation++;status('');nav();if(!preview)saveUser(state.user);
  if(tab==='attendance')return attendance();if(tab==='salary')return salary();if(tab==='more')return more();
  if(tab==='schedule'||tab==='rental')return rolePanel(tab==='schedule'?'teacher':'renter');
 }
 function monthInput(id,value){return '<div class="personal-month"><label for="'+id+'">月份</label><input id="'+id+'" type="month" value="'+esc(value)+'"></div>';}
 function foldRows(lines){return lines.length?lines.slice(0,3).join('')+(lines.length>3?'<details><summary>展開其餘 '+(lines.length-3)+' 筆</summary>'+lines.slice(3).join('')+'</details>':''):'尚無資料';}
 function monthRange(month){const [y,m]=month.split('-').map(Number);return {startDate:month+'-01',endDate:month+'-'+new Date(Date.UTC(y,m,0)).getUTCDate()};}
 async function attendance(){
  body(card('',row(today(),'今日排班')+'<div id="todaySchedule" class="personal-value">讀取中…</div><div class="personal-grid" style="margin-top:12px">'+button('上／下班打卡','clock','primary')+button('補登出勤','temporary','soft')+'</div>')+actions([...(state.user.identityType==='parttime'?[['填寫工時','hours','時']]:[]),['請假申請','leave','假'],['打卡紀錄','clock','錄'],['我的班表','schedule-own','班']])+card('出勤紀錄',monthInput('attendanceMonth',attendanceMonth)+'<div id="recentAttendance">讀取中…</div>'));
  $('attendanceMonth').addEventListener('change',event=>{if(!event.target.value)return;attendanceMonth=event.target.value;generation++;attendance();});
  const version=generation,payload={userId:state.user.id};
  const results=await Promise.allSettled([personalRead('getTodaySchedule',payload),personalRead('getClockHistoryRange',{...payload,...monthRange(attendanceMonth)})]);
  if(version!==generation)return;
  const schedule=results[0];if(schedule.status==='fulfilled'&&schedule.value?.ok!==false){const r=schedule.value,rows=r.schedules||[];state.scheduleText=rows.length?rows.map(s=>[s.startTime,s.endTime].filter(Boolean).join(' — ')).join('／'):(r.startTime?[r.startTime,r.endTime].filter(Boolean).join(' — '):'今日無排班');$('todaySchedule').textContent=state.scheduleText;}else $('todaySchedule').textContent='班表讀取失敗';
  const recent=results[1];if(recent.status==='fulfilled'&&recent.value?.ok!==false){const rows=Array.isArray(recent.value)?recent.value:recent.value?.rows||[];state.clockRows=rows;state.clockHtml=foldRows(rows.map(r=>row((r.date||r.workDate||'')+'　'+(r.actionName||r.action||'打卡'),r.time||r.clockTime||r.status||'已記錄')));$('recentAttendance').innerHTML=state.clockHtml;}else $('recentAttendance').textContent='紀錄讀取失敗，請重新查詢。';
 }

 async function monthSalary(){return preview?managerRead('preview-month',{employeeDocId:$('previewPerson').value,month:salaryMonth}):call('payroll-month',{month:salaryMonth});}
 const displayMoney=value=>value===null||value===undefined?'待確認':money(value);
 async function salary(){
  body(card('薪資',monthInput('salaryMonth',salaryMonth)+'<div id="salaryInfo">讀取中…</div>')+card('每日明細','<div id="salaryHours">讀取中…</div>'));
  $('salaryMonth').addEventListener('change',event=>{if(!event.target.value)return;salaryMonth=event.target.value;generation++;salary();});
  const version=generation;try{const result=await monthSalary();if(version!==generation)return;state.salary=result;
   if(!result.hasData){$('salaryInfo').textContent='尚無資料';$('salaryHours').textContent='尚無資料';return;}
   $('salaryInfo').innerHTML=row(state.user.identityType==='parttime'?'時薪':'本薪',displayMoney(result.rate))+row('本月累計',displayMoney(result.gross))+row('個人負擔扣款',displayMoney(result.deduction))+row('預估實領',displayMoney(result.net))+'<details><summary>扣款明細</summary>'+row('勞保自付',displayMoney(result.insurance.labor))+row('健保自付',displayMoney(result.insurance.health))+row('勞退自提',displayMoney(result.insurance.retirement))+row('出勤扣款',displayMoney(result.lateDeduction))+'</details>';
   $('salaryHours').innerHTML=foldRows(result.rows.map(r=>row(r.date+'　'+r.hours+' 小時',displayMoney(r.grossPay))));
  }catch(e){if(version===generation){$('salaryInfo').textContent=e.message||'薪資讀取失敗，請重新查詢。';$('salaryHours').textContent='讀取失敗';}}
 }
 async function insurance(){
  body(card('勞健保與勞退',monthInput('insuranceMonth',salaryMonth)+'<div id="insuranceInfo">讀取中…</div>'));
  $('insuranceMonth').addEventListener('change',event=>{if(!event.target.value)return;salaryMonth=event.target.value;generation++;insurance();});
  const version=generation;try{const r=await monthSalary();if(version!==generation)return;const i=r.insurance;
   $('insuranceInfo').innerHTML=r.configKnown?row('勞保',i.laborStatus||'尚無設定')+row('勞保個人負擔',displayMoney(i.labor))+row('健保',i.healthStatus||'尚無設定')+row('健保個人負擔',displayMoney(i.health))+row('勞退自提',displayMoney(i.retirement))+row('公司勞退提撥',displayMoney(i.employerRetirement)):'尚無資料';
  }catch(e){if(version===generation)$('insuranceInfo').textContent='讀取失敗，請重新查詢。';}
 }

 function more(){body(card('',menu([['我的資料'+(state.profilePending?' · 待主管確認':state.missingFields.length?' · 待補齊':''),'profile'],['公告','announcement'],['待辦','task'],['定期事項','routine'],['教育訓練','training'],['表單與證明','forms'],['通知設定','notification'],['勞健保與勞退','insurance']]))+(!preview?button('登出','logout','full'):''));}
 function profile(){
  const groups=[['聯絡資料',['mobilePhone','address','householdAddress','emergencyContact','emergencyPhone']],['個人資料',['birthDate','idNumber']]];
  const input=key=>'<label class="'+(['address','householdAddress','bankAccount'].includes(key)?'wide':'')+'">'+model.fields[key]+'<input name="'+key+'" type="'+(key==='birthDate'?'date':'text')+'" maxlength="300" value="'+esc(state.profile[key]||'')+'" '+(state.profilePending?'disabled':'')+'></label>';
  body(card('基本資料',row('姓名',state.user.name)+row('身分',state.user.identityLabel)+row('Email',state.user.email||'未填')+row('到職日',state.hireDate||'未設定'))+'<form id="personalProfileForm">'+groups.map(([title,keys])=>card(title,'<div class="personal-form">'+keys.map(input).join('')+'</div>')).join('')+card('領薪方式','<label class="personal-select-label" for="paymentMethod">領薪方式</label><select id="paymentMethod" name="paymentMethod" '+(state.profilePending?'disabled':'')+'><option value="bank">銀行匯款</option><option value="cash">領現金，免填銀行帳戶</option></select><div id="bankFields" class="personal-form" style="margin-top:12px">'+['bankCode','bankName','bankAccount','accountName'].map(input).join('')+'</div>')+'<button class="personal-btn primary full" type="submit" '+(preview||state.profilePending?'disabled':'')+'>'+(preview?'唯讀檢視':state.profilePending?'等待主管確認':'送交主管')+'</button></form>');
  $('paymentMethod').value=state.profile.paymentMethod==='cash'?'cash':'bank';
  const toggle=()=>{const cash=$('paymentMethod').value==='cash';$('bankFields').hidden=cash;$('bankFields').querySelectorAll('input').forEach(n=>n.disabled=cash||state.profilePending);};$('paymentMethod').addEventListener('change',toggle);toggle();
  $('personalProfileForm').addEventListener('submit',async event=>{event.preventDefault();if(preview)return;const btn=event.submitter;btn.disabled=true;try{await call('profile-submit',{profile:Object.fromEntries(new FormData(event.target))});state.profilePending=true;status('已送交主管。');profile();}catch(e){status(e.message,true);btn.disabled=false;}});
 }

 function previewFeature(key){
  if(realPreview&&key==='clock'){
   body(card('打卡',row(today(),state.scheduleText||'請先查看出勤頁')+'<div class="personal-grid" style="margin-top:12px">'+'<button class="personal-btn primary" disabled>上班打卡</button><button class="personal-btn soft" disabled>下班打卡</button>'+'</div>')+card('打卡紀錄',state.clockHtml||'請先查看出勤頁')+card('',menu([['補登出勤','temporary'],['修正時間','correction']])));return;
  }
  if(realPreview&&key==='schedule-own'){body(card('我的班表',row(today(),state.scheduleText||'請先查看出勤頁')));return;}
  if(['hours','leave','temporary','correction'].includes(key)){
   const title=key==='correction'?'修正打卡':features[key][0];
   body(card(title,'<form id="previewForm" class="personal-form"><label class="wide">日期<input type="date" value="'+today()+'" required></label>'+(key==='hours'?'<label class="wide">工時<select required>'+ (realPreview?'<option value="">請選擇時數</option>':'') +Array.from({length:24},(_,i)=>'<option value="'+((i+1)/2)+'" '+(!realPreview&&i===7?'selected':'')+'>'+((i+1)/2)+' 小時</option>').join('')+'</select></label><label class="wide">計薪方式<select><option>一般計薪</option><option>雙倍計薪</option></select></label><label class="wide">備註<textarea rows="2"></textarea></label>':'<label>開始<input type="time" value="'+(realPreview?'':'14:00')+'" required></label><label>結束<input type="time" value="'+(realPreview?'':'18:00')+'" required></label>')+(key==='leave'?'<label class="wide">假別<select><option>事假</option><option>病假</option><option>婚假</option><option>喪假</option><option>特休</option></select></label>':'')+(key!=='hours'?'<label class="wide">原因<textarea rows="2" required></textarea></label>':'')+'<button class="personal-btn primary wide" type="submit" disabled>'+(key==='hours'?'確認工時':'送交主管')+'</button></form>'));$('previewForm').onsubmit=e=>{e.preventDefault();status('預覽：已完成操作，沒有正式送出。');};return;
  }
  body(card(features[key]?.[0]||'功能預覽','唯讀檢視'));
 }
 async function rolePanel(role){
  if(realPreview){body(card(role==='teacher'?'課表':'租用','已連結此身分。請從營運中心查看詳細紀錄。'));return;}

  body(card(role==='teacher'?'我的課表':'我的租用','正在開啟…'));const version=generation;
  try{const result=await call('open-role',{role});if(version!==generation)return;localStorage.setItem('youzi.coursePortal.'+role+'.session.v1',result.sessionToken);showFrame(role==='teacher'?'課表':'租用',role==='teacher'?'teacher-course-portal.html':'room-booking.html?from=employee');}catch(e){status(e.message,true);body(button('重新載入','retry-role','full'));}
 }
 function showFrame(title,url){
  $('personalBody').innerHTML='<div class="personal-frame-head">'+button('← 返回','frame-back')+'<h2>'+esc(title)+'</h2></div><iframe class="personal-frame" id="personalFrame" title="'+esc(title)+'" allow="geolocation; camera"></iframe>';bindActions();
  const frame=$('personalFrame');frame.addEventListener('load',()=>{
   try{const doc=frame.contentDocument;if(!doc||frame.contentWindow.location.origin!==location.origin)return;
    if(['teacher-course-portal.html','room-booking.html'].includes(frame.contentWindow.location.pathname.split('/').pop()))return;
    doc.body.classList.add('personal-embedded');if(!doc.getElementById('personalEmbeddedStyle')){const link=doc.createElement('link');link.id='personalEmbeddedStyle';link.rel='stylesheet';link.href='personal-embedded.css?v=20261031-mobile3';doc.head.append(link);}
    const hours=doc.getElementById('hoursSelect');if(hours){hours.removeAttribute('aria-hidden');hours.removeAttribute('tabindex');}
    const workDate=doc.getElementById('workDate');if(workDate){workDate.setAttribute('aria-label','日期');if(!doc.querySelector('label[for="workDate"]')){const label=doc.createElement('label');label.htmlFor='workDate';label.textContent='日期';workDate.before(label);}}
    // Remove only static explanatory prose; keep labels, live statuses, errors and records.
    doc.querySelectorAll('.internal-explanation,p.muted,.tile-desc,.field-hint,.form-hint').forEach(n=>{if(!n.id&&!n.querySelector('input,button,a,select,textarea,[role=alert]'))n.hidden=true;});
    const page=frame.contentWindow.location.pathname.split('/').pop();if(['dashboard.html','teacher-home.html','settings.html','login.html'].includes(page)){selectTab(tab);if(page==='login.html')status('登入已到期，請重新登入。',true);}
   }catch(e){status('頁面暫時無法顯示。',true);}
  });frame.src=url;
 }
 async function open(key){
  if(!preview)try{await verifyIdentity(state.user.id);}catch(e){status(e.message,true);return;}
  generation++;status('');if(key==='frame-back')return selectTab(tab);if(key==='profile')return profile();if(key==='insurance')return insurance();
  if(key==='retry-role')return selectTab(tab);
  if(key==='logout'){if(typeof logout==='function')logout();return;}
  if(preview)return previewFeature(key);
  if(key==='schedule-own')return showFrame('我的班表','clock.html');
  const feature=features[key];if(feature)showFrame(...feature);
 }
 async function changePerson(){
  const id=$('previewPerson').value,version=++previewLoad;generation++;window.PersonalPreviewFrame?.close();$('personalTabs').replaceChildren();body('');if(!id){$('personalName').textContent='請選擇人員';return;}status('讀取資料中…');
  try{
   if(id.startsWith('teacher:')){
    const teacherId=id.slice(8),selected=$('previewPerson').selectedOptions[0];
    const result=await managerRead('teacher-read',{teacherId,method:'coursePortalTeacherUtilitySession'});if(version!==previewLoad)return;
    state={user:{...result.user,name:result.user.name==='外聘老師'?selected.textContent.replace('（外聘老師）',''):result.user.name},capabilities:{teacher:true},profile:result.profile};realPreview=true;
    $('personalName').textContent=state.user.name;$('personalRole').textContent='外聘老師';$('previewLabel').innerHTML='<span>模擬 '+esc(state.user.name)+'</span><span>唯讀檢視</span>';status('');
    await PersonalPreviewFrame.open({container:$('personalBody'),page:'teacher-course-portal.html',user:result.user,read:(method,payload)=>managerRead('teacher-read',{teacherId,method,payload})});return;
   }
   const result=await managerRead('preview',{employeeDocId:id});if(version!==previewLoad)return;state=result;realPreview=true;$('previewLabel').innerHTML='<span>模擬 '+esc(state.user.name)+'</span><span>唯讀檢視</span>';document.title=state.user.name+'｜手機檢視';selectTab('attendance');
  }catch(e){status(e.message||'資料讀取失敗。',true);$('personalName').textContent='資料未能載入';}
 }
 async function loadPreviewRoster(){
  try{const r=await managerRead('preview-roster');for(const person of r.rows||[]){const option=document.createElement('option');option.value=person.id;option.textContent=person.name+'（'+person.identityLabel+'）';$('previewPerson').append(option);}
   $('previewPerson').addEventListener('change',changePerson);const requested=params.get('preview'),type=requested==='teacher'?'external':requested==='staff'?'staff':'parttime';const people=(r.rows||[]).filter(p=>p.identityType===type);const target=people.find(p=>p.name==='張雲慈')||people[0];if(target){$('previewPerson').value=target.id;await changePerson();}else{$('personalName').textContent='尚無可檢視的人員';status('請從上方選擇已建檔的人員。');}
  }catch(e){status(e.message||'人員名單讀取失敗。',true);}
 }
 async function init(){
  try{
   if(!firebase.apps.length)firebase.initializeApp(APP_CONFIG.FIREBASE_CONFIG);
   let user=getUser();if(!user){location.replace('login.html?next=dashboard.html');return;}
   preview=params.has('preview')||isManager(user);
   if(preview){if(firebase.auth().authStateReady)await firebase.auth().authStateReady();let claims=firebase.auth().currentUser?(await firebase.auth().currentUser.getIdTokenResult()).claims:{};
    if(claims.employee!==true||claims.manager!==true){await ensureHrSession(user);claims=(await firebase.auth().currentUser.getIdTokenResult()).claims;}if(claims.employee!==true||claims.manager!==true)throw Error('手機預覽僅供管理者使用。');
    document.body.classList.add('is-preview');$('previewBar').hidden=false;$('previewLabel').hidden=false;status('讀取人員名單中…');loadPreviewRoster();return;
   }
   if(user.portalSessionBridge){throw Error('請從老師手機版的「出勤」進入，或使用原員工帳號登入。');}
   status('正在載入您的工作台…');state=await call('overview');saveUser(state.user);status('');selectTab(state.capabilities.attendance?'attendance':state.capabilities.teacher?'schedule':'more');
  }catch(e){status(e.message||'載入失敗，請重新登入。',true);body('<a class="personal-btn full" href="login.html?next=dashboard.html">重新登入</a>');}
 }
 init();
})();
