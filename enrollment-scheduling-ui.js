'use strict';
(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const buildMessage=window.EnrollmentConfirmationMessage;
 const money=n=>Number(n||0).toLocaleString('zh-TW'),days='日一二三四五六';
 const endTime=(time,duration)=>{if(!time)return '';const [h,m]=time.split(':').map(Number),n=h*60+m+Number(duration);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');};
 function split(p){if(p.splitType==='ratio'){const n=Number(p.splitValue)>1?Number(p.splitValue):Number(p.splitValue)*100;return '老師 '+Number(n.toFixed(2))+'%／教室 '+Number((100-n).toFixed(2))+'%';}return p.splitType==='fixed'?'老師每堂 NT$ '+money(p.splitValue):'不計分成';}
 const planText=p=>p.name+'｜NT$ '+money(p.amount)+'／'+p.lessonCount+' 堂｜'+split(p);
 function mount({host,row,candidates,catalog,call,act,onSaved}){
  if(row.schedule){
   const s=row.schedule,n=row.confirmationNotification||{},status=n.status||'尚未建立通知';
   host.innerHTML='<section class="schedule-panel completed"><h3>課程已確認</h3><p><strong>'+esc(s.subjectName)+' · '+esc(s.teacherName)+'</strong></p><p>'+esc(s.date)+' 起，'+(s.frequency==='biweekly'?'隔週':'每週')+'星期'+days[new Date(s.date+'T12:00:00+08:00').getUTCDay()]+' '+esc(s.time+'–'+s.endTime)+'<br>'+esc(s.roomName)+'</p><p>'+esc(planText(s.plan))+'</p><div class="schedule-summary"><strong>報名確認 LINE：'+esc(status)+'</strong>'+(n.error?'<p class="schedule-error">'+esc(n.error)+'</p>':'')+(n.body?'<details><summary>查看傳送內容</summary><pre class="confirmation-message">'+esc(n.body)+'</pre></details>':'<p>此筆課程為先前建立，尚未產生報名確認訊息。</p>')+'<button id="refreshConfirmation" class="secondary">重新整理通知狀態</button></div><p class="meta">老師可在課表查看；後續調課請從正式課表操作。</p><a class="button" href="portal.html#course-calendar">查看正式課表</a></section>';
   host.querySelector('#refreshConfirmation').onclick=()=>act(()=>onSaved(''),'detailNotice');return {sync(){}};
  }
  const names=[row.form.name,...(row.form.secondName?[row.form.secondName]:[])],saved=row.scheduleDraft||{},initial={subjectId:row.form.subjectId,date:row.form.date,time:row.form.time,duration:60,frequency:'weekly',note:'',studentMessageNote:'',...saved};
  const memberSelects=row.studentIds?.length?'<p class="meta">已確認學生：'+esc(names.join('、'))+'</p>':names.map((name,n)=>'<label>學生 '+(n+1)+'：'+esc(name)+'<select data-schedule-member="'+n+'">'+(candidates.length?'<option value="">請核對既有學生或選擇新建</option>':'')+'<option value="new">建立新學生：'+esc(name)+'</option>'+candidates.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name+'｜'+c.phone)+'（既有學生）</option>').join('')+'</select></label>').join('');
  const options=(rows,label)=>'<option value="">'+label+'</option>'+rows.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>').join('');
  host.innerHTML='<section class="schedule-panel"><h3>確認正式課程</h3><p class="meta">依與學生確認的結果調整。原報名資料會保留，確認後會完成排課，並將下方訊息傳到報名者的 LINE。</p><div class="schedule-fields">'+memberSelects+'<label>科目<select id="scheduleSubject">'+options(catalog.subjects,'請選擇科目')+'</select></label><label>授課老師<select id="scheduleTeacher"></select></label><label>開始日期<input id="scheduleDate" type="date" required></label><label>開始時間<input id="scheduleTime" type="time" step="1800" required></label><label>每堂時間<select id="scheduleDuration"><option value="30">30 分鐘</option><option value="60">60 分鐘</option><option value="90">90 分鐘</option><option value="120">120 分鐘</option></select></label><label>上課方式<select id="scheduleFrequency"><option value="weekly">每週固定上課</option><option value="biweekly">隔週固定上課</option></select></label><label>教室<select id="scheduleRoom"></select></label><label class="schedule-wide">收費方案<select id="schedulePlan"></select></label><label class="schedule-wide">內部排課備註（不會傳給報名者）<textarea id="scheduleNote" rows="2" maxlength="1000"></textarea></label><label class="schedule-wide">給報名者的補充說明（選填）<textarea id="studentMessageNote" rows="2" maxlength="500" placeholder="例如：第一堂課請提早 10 分鐘到教室。"></textarea></label></div><label id="scheduleHalfHourLabel" class="schedule-check" hidden><input type="checkbox" id="scheduleHalfHour">已確認 30 分鐘課程，接下來四堂課內再安排 30 分鐘補足。</label><div id="scheduleSummary" class="schedule-summary"><strong>報名者將收到的 LINE 訊息</strong><p id="confirmationRecipient" class="meta"></p><pre id="confirmationPreview" class="confirmation-message" aria-live="polite"></pre></div><label class="schedule-check"><input type="checkbox" id="scheduleAgreement">已確認上課安排、學費及上方 LINE 訊息。</label><p id="scheduleError" class="schedule-error" role="alert"></p><div class="actions"><button id="saveScheduleDraft" class="secondary">儲存草稿</button><button id="confirmSchedule" disabled>確認排課並傳送 LINE</button></div><p class="meta">儲存草稿不會排課或傳訊息。確認時會檢查排課衝突，成功後通知報名者。</p></section>';
  const $=id=>host.querySelector('#'+id),memberInputs=[...host.querySelectorAll('[data-schedule-member]')];
  for(const [name,key] of [['scheduleSubject','subjectId'],['scheduleDate','date'],['scheduleTime','time'],['scheduleDuration','duration'],['scheduleFrequency','frequency'],['scheduleNote','note'],['studentMessageNote','studentMessageNote']])$(name).value=initial[key]??'';
  $('scheduleHalfHour').checked=initial.halfHourAcknowledged===true;
  memberInputs.forEach((s,n)=>{const value=saved.studentIds?.[n];if(value&&[...s.options].some(o=>o.value===value))s.value=value;});
  const chosenPlan=()=>catalog.feePlans.find(p=>p.id===$('schedulePlan').value);
  function fill(el,rows,preferred,label){el.innerHTML=options(rows,label);if(rows.some(r=>r.id===preferred))el.value=preferred;}
  function selections(preferred={}){
   const sid=$('scheduleSubject').value;
   fill($('scheduleTeacher'),catalog.teachers.filter(t=>t.subjectIds.includes(sid)),preferred.teacherId??$('scheduleTeacher').value,'請選擇可授課老師');
   fill($('scheduleRoom'),catalog.rooms.filter(r=>r.subjectIds.includes(sid)),preferred.roomId??$('scheduleRoom').value,'請選擇適用教室');
   fill($('schedulePlan'),catalog.feePlans.filter(p=>p.subjectId===sid).map(p=>({...p,name:planText(p)})),preferred.planId??$('schedulePlan').value,'請選擇正式收費方案');
  }
  function draft(){return {subjectId:$('scheduleSubject').value,teacherId:$('scheduleTeacher').value,roomId:$('scheduleRoom').value,planId:$('schedulePlan').value,date:$('scheduleDate').value,time:$('scheduleTime').value,duration:Number($('scheduleDuration').value),frequency:$('scheduleFrequency').value,note:$('scheduleNote').value.trim(),studentMessageNote:$('studentMessageNote').value.trim(),studentIds:row.studentIds?.length?row.studentIds:memberInputs.map(s=>s.value),halfHourAcknowledged:$('scheduleHalfHour').checked};}
  function sync(){
   const d=draft(),p=chosenPlan(),subject=catalog.subjects.find(s=>s.id===d.subjectId),teacher=catalog.teachers.find(t=>t.id===d.teacherId),room=catalog.rooms.find(r=>r.id===d.roomId);
   $('scheduleHalfHourLabel').hidden=d.duration!==30;
   $('confirmationRecipient').textContent='收件人：'+(row.line?.lineDisplayName||names.join('、'))+'（報名時驗證的 LINE 帳號）';
   $('confirmationPreview').textContent=buildMessage({...d,studentNames:names,subjectName:subject?.name,teacherName:teacher?.name,roomName:room?.name,endTime:endTime(d.time,d.duration),plan:p},row.form);
   $('confirmSchedule').disabled=!(subject&&teacher&&room&&p&&d.date&&d.time&&d.studentIds.length===names.length&&d.studentIds.every(Boolean)&&$('scheduleAgreement').checked&&(d.duration!==30||d.halfHourAcknowledged))||row.status==='closed';
   $('saveScheduleDraft').disabled=row.status==='closed';
  }
  selections(initial);sync();
  host.querySelectorAll('input,select,textarea').forEach(el=>el.addEventListener('input',()=>{if(el.id!=='scheduleAgreement')$('scheduleAgreement').checked=false;if(el.id==='scheduleSubject')selections();$('scheduleError').textContent='';sync();}));
  $('saveScheduleDraft').onclick=()=>act(async()=>{await call('saveScheduleDraft',{id:row.id,version:row.version,draft:draft()});await onSaved('草稿已儲存，尚未排課，也未傳送 LINE。');},'scheduleError');
  $('confirmSchedule').onclick=()=>{
   sync();if($('confirmSchedule').disabled)return;
   const d=draft(),p=chosenPlan();
   act(async()=>{await call('confirmSchedule',{id:row.id,version:row.version,draft:d,expectedPlan:p,expectedMessage:$('confirmationPreview').textContent,confirmedWithStudent:$('scheduleAgreement').checked});await onSaved('排課已完成，報名確認 LINE 已排入發送，通知狀態會顯示在下方。');},'scheduleError');
  };
  return {sync};
 }
 window.EnrollmentSchedulingUI={mount,planText};
})();
