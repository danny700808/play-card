(function(){
 'use strict';
 const $=id=>document.getElementById(id),model=window.PersonalWorkspaceModel;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>'$'+Number(n||0).toLocaleString('zh-TW'),today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
 const params=new URLSearchParams(location.search);let preview=false,realPreview=false,state=null,tab='attendance',generation=0,previewLoad=0;
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
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
  try{const response=await fetch('https://'+(APP_CONFIG.FUNCTION_REGION||'us-central1')+'-'+APP_CONFIG.FIREBASE_CONFIG.projectId+'.cloudfunctions.net/personalWorkspace',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await current.getIdToken()},body:JSON.stringify({data:{action,...data,expectedEmployeeId:claims.employeeId}}),signal:controller.signal});const result=await response.json();if(!response.ok||result.error)throw Error(result.error?.message||'讀取失敗。');if(auth.currentUser?.uid!==current.uid)throw Error('帳號已切換，請重新開啟。');return result.result||result.data;}finally{clearTimeout(timer);}
 }
 async function personalRead(action,payload){
  if(!['getTodaySchedule','getEditableClockHistory','getMySalaryInfo','getParttimeHistory'].includes(action))throw Error('檢視模式不支援這個操作。');
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
 async function attendance(){
  body(card('', '<div class="personal-row"><h2 style="margin:0">'+esc(today())+'</h2><span class="personal-tag">'+(preview?'今日排班':'我的出勤')+'</span></div><div id="todaySchedule" class="personal-value">'+(preview?(state.user.identityType==='parttime'?'14:00 — 18:00':'09:00 — 18:00'):'讀取中…')+'</div><div style="margin-top:14px" class="personal-grid">'+button('上／下班打卡','clock','primary')+button('補登出勤','temporary','soft')+'</div>')+
   actions([...(state.user.identityType==='parttime'?[['填寫工時','hours','時']]:[]),['請假申請','leave','假'],['打卡紀錄','clock','錄'],['我的班表','schedule-own','班']])+
   '<h2 class="personal-section-title">近期紀錄</h2>'+card('',preview&&!realPreview?row('10/30　下班打卡','18:02')+(state.user.identityType==='parttime'?row('10/30　填寫工時','4 小時'):row('10/30　上班打卡','09:00'))+row('10/29　請假','主管已核准'):'<div id="recentAttendance" class="personal-muted">讀取中…</div>'));
  if(preview&&!realPreview)return;$('todaySchedule').textContent='讀取中…';const version=generation,payload={userId:state.user.id};
  const results=await Promise.allSettled([personalRead('getTodaySchedule',payload),personalRead('getEditableClockHistory',payload)]);
  if(version!==generation)return;
  const schedule=results[0];if(schedule.status==='fulfilled'&&schedule.value?.ok!==false){const r=schedule.value,rows=r.schedules||[];state.scheduleText=rows.length?rows.map(s=>[s.startTime,s.endTime].filter(Boolean).join(' — ')).join('／'):(r.startTime?[r.startTime,r.endTime].filter(Boolean).join(' — '):'今日無排班');$('todaySchedule').textContent=state.scheduleText;}else{$('todaySchedule').textContent='班表讀取失敗';state.scheduleText='班表讀取失敗';}
  const recent=results[1];if(recent.status==='fulfilled'&&recent.value?.ok!==false){const rows=Array.isArray(recent.value)?recent.value:recent.value?.rows||recent.value?.list||[];state.clockRows=rows;state.clockHtml=rows.slice(0,12).map(r=>row((r.date||r.workDate||r['日期']||'')+'　'+(r.actionName||r.action||r['打卡動作']||'打卡'),r.time||r.clockTime||r['時間']||r.status||'已記錄')).join('')||'尚無打卡紀錄';$('recentAttendance').innerHTML=state.clockHtml;}else $('recentAttendance').textContent='紀錄讀取失敗，請重新整理。';
 }
 function payments(){return state.payments.length?'<table class="personal-table"><thead><tr><th>發放日</th><th>月份</th><th>實領</th></tr></thead><tbody>'+state.payments.map(r=>'<tr><td>'+esc(r.paidDate)+'</td><td>'+esc(r.month)+'</td><td>'+money(r.amount)+'</td></tr>').join('')+'</tbody></table>':'<div class="personal-muted">尚無已確認的發放紀錄</div>';}
 async function salary(){
  body(card('薪資與投保','<div id="salaryInfo">讀取中…</div>')+card('薪資發放',payments())+(state.user.identityType==='parttime'?card('工時計薪',preview&&!realPreview?row('10/30　4 小時',money(800))+row('10/29　3 小時',money(600)):'<div id="salaryHours" class="personal-muted">讀取中…</div>'):''));
  if(preview&&!realPreview){$('salaryInfo').innerHTML=row(state.user.identityType==='parttime'?'時薪':'本薪',state.user.identityType==='parttime'?'$200':'$32,000')+'<details><summary>勞健保與勞退</summary>'+row('勞保','已投保')+row('健保','已投保')+row('公司勞退','依已設定級距提撥')+'</details>';return;}
  const version=generation;try{const result=await personalRead('getMySalaryInfo',{userId:state.user.id,email:state.user.email});if(version!==generation)return;if(!result||result.ok===false)throw Error(result?.message||'讀取失敗。');const info=result.info||{};
   const items=[['本薪／時薪',info.mainAmountText||info.parttimeHourlyRateText||info.staffBaseSalaryText],['職務加給',info.jobAllowanceText],['津貼',info.allowanceText],['生效日',info.effectiveDate]].filter(([,v])=>v);
   const insurance=[['勞保',info.laborStatus],['勞保自付',info.laborSelfPayText],['健保',info.healthStatus],['健保自付',info.healthSelfPayText],['公司勞退',info.retirementEmployerText],['勞退自提',info.selfRetirementText]].filter(([,v])=>v);
   $('salaryInfo').innerHTML=(items.map(([k,v])=>row(k,v)).join('')||'<div class="personal-muted">薪資尚未設定</div>')+'<details><summary>勞健保與勞退</summary>'+(insurance.map(([k,v])=>row(k,v)).join('')||'尚未設定')+'</details>';
  }catch(e){if(version===generation)$('salaryInfo').textContent='薪資讀取失敗，請重新整理。';}
  if(state.user.identityType==='parttime')try{const r=await personalRead('getParttimeHistory',{userId:state.user.id,monthText:today().slice(0,7)});if(version!==generation)return;if(r?.ok===false)throw Error();const rows=Array.isArray(r)?r:r?.rows||[];const lines=rows.map(r=>row((r.date||r.workDate||r['日期']||'')+'　'+(r.hours??r.totalHours??r['時數']??'—')+' 小時',money(r.grossPay??r['當日工資']??0)));$('salaryHours').innerHTML=lines.length?lines.slice(0,3).join('')+(lines.length>3?'<details><summary>展開本月其餘 '+(lines.length-3)+' 筆</summary>'+lines.slice(3).join('')+'</details>':''):'本月尚無工時計薪紀錄';}catch(e){if(version===generation)$('salaryHours').textContent='工時計薪讀取失敗。';}
 }
 function more(){body(card('',menu([['我的資料'+(state.profilePending?' · 待主管確認':state.missingFields.length?' · 待補齊':''),'profile'],['公告','announcement'],['待辦','task'],['定期事項','routine'],['教育訓練','training'],['表單與證明','forms'],['通知設定','notification']]))+(!preview?button('登出','logout','full'):''));}
 function profile(){
  const groups=[['聯絡資料',['mobilePhone','address','householdAddress','emergencyContact','emergencyPhone']],['個人資料',['birthDate','idNumber']],['薪資帳戶',['bankCode','bankName','bankAccount','accountName']]];
  body('<form id="personalProfileForm">'+groups.map(([title,keys])=>card(title,'<div class="personal-form">'+keys.map(key=>'<label class="'+(['address','householdAddress','bankAccount'].includes(key)?'wide':'')+'">'+model.fields[key]+'<input name="'+key+'" type="'+(key==='birthDate'?'date':'text')+'" '+(['mobilePhone','emergencyPhone','bankCode','bankAccount'].includes(key)?'inputmode="numeric" ':'')+'maxlength="300" value="'+esc(state.profile[key]||'')+'" '+(state.profilePending?'disabled':'')+'></label>').join('')+'</div>')).join('')+'<button class="personal-btn primary full" type="submit" '+(state.profilePending?'disabled':'')+'>'+(state.profilePending?'等待主管確認':'送交主管')+'</button></form>');
  $('personalProfileForm').addEventListener('submit',async event=>{event.preventDefault();if(preview){status('預覽：資料已模擬送出，未儲存。');return;}const btn=event.submitter;btn.disabled=true;try{await call('profile-submit',{profile:Object.fromEntries(new FormData(event.target))});state.profilePending=true;status('已送交主管。');profile();}catch(e){status(e.message,true);btn.disabled=false;}});
 }
 function previewFeature(key){
  if(realPreview&&key==='clock'){
   body(card('打卡',row(today(),state.scheduleText||'請先查看出勤頁')+'<div class="personal-grid" style="margin-top:12px">'+button('上班打卡','demo-send','primary')+button('下班打卡','demo-send','soft')+'</div>')+card('打卡紀錄',state.clockHtml||'請先查看出勤頁')+card('',menu([['補登出勤','temporary'],['修正時間','correction']])));return;
  }
  if(realPreview&&key==='schedule-own'){body(card('我的班表',row(today(),state.scheduleText||'請先查看出勤頁')));return;}
  if(key==='clock'){
   body(card('打卡','<div class="personal-row"><span>'+today()+'</span><span class="personal-tag">示範班表</span></div><div class="personal-value">'+(state.user.identityType==='parttime'?'14:00 — 18:00':'09:00 — 18:00')+'</div><div class="personal-grid" style="margin-top:14px">'+button('上班打卡','demo-send','primary')+button('下班打卡','demo-send','soft')+'</div>')+card('打卡紀錄',row(state.user.identityType==='parttime'?'10/30　14:00':'10/30　09:00','上班')+row('10/30　18:02','下班')+'<details><summary>補登／修正</summary>'+menu([['補登出勤','temporary'],['修正時間','correction']])+'</details>'));return;
  }
  if(key==='schedule-own'){body(card('我的班表',row('10/31　週六',state.user.identityType==='parttime'?'14:00 — 18:00':'09:00 — 18:00')+row('11/01　週日','休息')+row('11/02　週一','休息')));return;}
  if(['hours','leave','temporary','correction'].includes(key)){
   const title=key==='correction'?'修正打卡':features[key][0];
   body(card(title,'<form id="demoForm" class="personal-form"><label class="wide">日期<input type="date" value="'+today()+'" required></label>'+(key==='hours'?'<label class="wide">工時<select required>'+ (realPreview?'<option value="">請選擇時數</option>':'') +Array.from({length:24},(_,i)=>'<option value="'+((i+1)/2)+'" '+(!realPreview&&i===7?'selected':'')+'>'+((i+1)/2)+' 小時</option>').join('')+'</select></label><label class="wide">計薪方式<select><option>一般計薪</option><option>雙倍計薪</option></select></label><label class="wide">備註<textarea rows="2"></textarea></label>':'<label>開始<input type="time" value="'+(realPreview?'':'14:00')+'" required></label><label>結束<input type="time" value="'+(realPreview?'':'18:00')+'" required></label>')+(key==='leave'?'<label class="wide">假別<select><option>事假</option><option>病假</option><option>婚假</option><option>喪假</option><option>特休</option></select></label>':'')+(key!=='hours'?'<label class="wide">原因<textarea rows="2" required></textarea></label>':'')+'<button class="personal-btn primary wide" type="submit">'+(key==='hours'?'確認工時':'送交主管')+'</button></form>'));$('demoForm').onsubmit=e=>{e.preventDefault();status('預覽：已完成操作，沒有正式送出。');};return;
  }
  body(card(features[key]?.[0]||'功能預覽',realPreview?'此功能入口可用；主管檢視僅呈現版型。':key==='announcement'?row('10/31','員工公告示範'):key==='notification'?row('LINE 通知','已連結（示範）'):row('目前狀態','沒有待處理事項')));
 }
 async function rolePanel(role){
  if(realPreview){body(card(role==='teacher'?'課表':'租用','已連結此身分。請從營運中心查看詳細紀錄。'));return;}
  if(preview){body(role==='teacher'?card('我的課表',row('10/31　15:00','鋼琴課')+row('10/31　16:00','吉他課')+'<details><summary>課務與鐘點費</summary>'+row('本期鐘點費（示範）','$4,800')+'</details>'):card('我的租用',row('11/01　10:00 — 11:00','鋼琴教室')+button('預約教室','demo-send','primary full')));return;}
  body(card(role==='teacher'?'我的課表':'我的租用','正在開啟…'));const version=generation;
  try{const result=await call('open-role',{role});if(version!==generation)return;localStorage.setItem('youzi.coursePortal.'+role+'.session.v1',result.sessionToken);showFrame(role==='teacher'?'課表':'租用',role==='teacher'?'teacher-course-portal.html':'room-booking.html?from=employee');}catch(e){status(e.message,true);body(button('重新載入','retry-role','full'));}
 }
 function showFrame(title,url){
  $('personalBody').innerHTML='<div class="personal-frame-head">'+button('← 返回','frame-back')+'<h2>'+esc(title)+'</h2></div><iframe class="personal-frame" id="personalFrame" title="'+esc(title)+'" allow="geolocation; camera"></iframe>';bindActions();
  const frame=$('personalFrame');frame.addEventListener('load',()=>{
   try{const doc=frame.contentDocument;if(!doc||frame.contentWindow.location.origin!==location.origin)return;
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
  status('');if(key==='frame-back')return selectTab(tab);if(key==='profile')return profile();
  if(key==='demo-send'){status('預覽：已完成操作，沒有正式送出。');return;}
  if(key==='retry-role')return selectTab(tab);
  if(key==='logout'){if(typeof logout==='function')logout();return;}
  if(preview)return previewFeature(key);
  if(key==='schedule-own')return showFrame('我的班表','clock.html');
  const feature=features[key];if(feature)showFrame(...feature);
 }
 function refreshPreview(){realPreview=false;state=model.sample($('previewRole').value,$('previewTeacher').checked,$('previewRenter').checked);$('previewLabel').innerHTML='<span>手機版預覽</span><span>示範資料・不會送出</span>';selectTab('attendance');}
 async function changePerson(){
  const id=$('previewPerson').value,version=++previewLoad;generation++;['previewRole','previewTeacher','previewRenter'].forEach(key=>{$(key).disabled=!!id;$(key).closest('label').hidden=!!id;});
  if(!id){refreshPreview();return;}status('讀取員工資料中…');$('personalTabs').replaceChildren();body('');
  try{const result=await managerRead('preview',{employeeDocId:id});if(version!==previewLoad)return;
   state=result;realPreview=true;$('previewRole').value=state.user.identityType;$('previewTeacher').checked=state.capabilities.teacher;$('previewRenter').checked=state.capabilities.renter;
   $('previewLabel').innerHTML='<span>主管檢視・真實資料</span><span>操作僅模擬</span>';document.title=state.user.name+'｜手機檢視';selectTab('attendance');
  }catch(e){status(e.message||'員工資料讀取失敗。',true);$('personalName').textContent='資料未能載入';}
 }
 async function loadPreviewRoster(){
  try{const r=await managerRead('preview-roster');for(const person of r.rows||[]){const option=document.createElement('option');option.value=person.id;option.textContent=person.name+'（'+person.identityLabel+'）';$('previewPerson').append(option);}
   $('previewPerson').addEventListener('change',changePerson);
   if((params.get('preview')==='employee'||!params.has('preview'))){const people=(r.rows||[]).filter(p=>p.identityType==='parttime');if(people.length===1){$('previewPerson').value=people[0].id;await changePerson();}else status('請選擇要查看的員工。');}
  }catch(e){if((params.get('preview')==='employee'||!params.has('preview')))status(e.message||'員工名單讀取失敗。',true);}
 }
 async function init(){
  try{
   if(!firebase.apps.length)firebase.initializeApp(APP_CONFIG.FIREBASE_CONFIG);
   let user=getUser();if(!user){location.replace('login.html?next=dashboard.html');return;}
   preview=params.has('preview')||isManager(user);
   if(preview){if(firebase.auth().authStateReady)await firebase.auth().authStateReady();let claims=firebase.auth().currentUser?(await firebase.auth().currentUser.getIdTokenResult()).claims:{};
    if(claims.employee!==true||claims.manager!==true){await ensureHrSession(user);claims=(await firebase.auth().currentUser.getIdTokenResult()).claims;}if(claims.employee!==true||claims.manager!==true)throw Error('手機預覽僅供管理者使用。');
    document.body.classList.add('is-preview');$('previewBar').hidden=false;$('previewLabel').hidden=false;$('previewRole').value=params.get('preview')==='staff'?'staff':'parttime';
    ['previewRole','previewTeacher','previewRenter'].forEach(id=>$(id).addEventListener('change',refreshPreview));if((params.get('preview')==='employee'||!params.has('preview'))){status('讀取員工資料中…');$('previewLabel').innerHTML='<span>主管檢視</span><span>操作僅模擬</span>';}else refreshPreview();loadPreviewRoster();return;
   }
   if(user.portalSessionBridge){throw Error('請從老師手機版的「出勤」進入，或使用原員工帳號登入。');}
   status('正在載入您的工作台…');state=await call('overview');saveUser(state.user);status('');selectTab(state.capabilities.attendance?'attendance':state.capabilities.teacher?'schedule':'more');
  }catch(e){status(e.message||'載入失敗，請重新登入。',true);body('<a class="personal-btn full" href="login.html?next=dashboard.html">重新登入</a>');}
 }
 init();
})();
