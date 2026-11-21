'use strict';
(() => {
const $=id=>document.getElementById(id), courses=[];
const assetBase=new URL('.',document.currentScript?.src||new URL('app.js',location.href));
const API='https://asia-east1-youzi-c1b74.cloudfunctions.net/enrollmentPublicHttp',CONTEXT='youzi.enrollment.pending.v1',CONSENT_VERSION='enrollment-line-2026-11-15-v1';
let submitBusy=false;
let catalogLoaded=false;
const state={step:1,category:'全部',search:'',course:null,plan:null,date:'',times:[],contact:null};
const todayKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dateOf=key=>new Date(key+'T12:00:00+08:00');
const dayOf=key=>dateOf(key).getUTCDay();
const keyOf=(year,month,day)=>`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
const displayDate=key=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(dateOf(key));
const MAX_BOOKING_DAYS=45;
const addDays=(key,days)=>{const d=dateOf(key);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
const validDate=key=>/^\d{4}-\d{2}-\d{2}$/.test(key)&&!Number.isNaN(dateOf(key).getTime())&&dateOf(key).toISOString().slice(0,10)===key;
const dateIssue=key=>!validDate(key)?'missing':key<todayKey()?'past':key>addDays(todayKey(),MAX_BOOKING_DAYS)?'far':dayOf(key)===1?'closed':'';
const money=value=>String(value).split('～').map(n=>Number(n).toLocaleString('en-US')).join('～');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const trialStatus=preferred=>preferred?'優先安排免費試上（待確認）':'未要求優先安排免費試上';
const trialPendingNote='免費試上能否安排、是否有費用，將由教室先和你確認。';
let draftCourse=null,draftPlan=null;
function showDialog(id){const el=$(id);el.showModal();document.body.style.overflow='hidden';}
function closeDialog(id){$(id).close();document.body.style.overflow='';}
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('close',()=>document.body.style.overflow=''));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeDialog(b.dataset.close)));
function resetConsent(){$('consent').checked=false;syncConsent();}
function renderCatalog(){
if(!catalogLoaded){$('courseCount').textContent='課程資料讀取中…';$('courseGrid').innerHTML='<p class="empty-results">正在讀取課程，請稍候。</p>';return;}

 $('filters').innerHTML=['全部','鍵盤','吉他','打擊','弦樂','管樂','其他'].map(name=>`<button type="button" class="${state.category===name?'active':''}" aria-pressed="${state.category===name}" data-category="${name}">${name}</button>`).join('');
 $('filters').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.category=b.dataset.category;renderCatalog();});
 const found=courses.filter(c=>(state.category==='全部'||c.category===state.category)&&(!state.search||`${c.name} ${c.originalLabel}`.toLowerCase().includes(state.search.toLowerCase())));
 $('courseCount').textContent=`${found.length} 門課程`;
 $('courseGrid').innerHTML=found.length?found.map(c=>{
  const first=c.options[0],selected=state.course?.id===c.id;
  return `<button type="button" class="course-card ${selected?'selected':''}" data-course="${c.id}" aria-pressed="${selected}" aria-label="選擇${esc(c.name)}，${esc(first.name)} ${money(first.price)} 元／${first.lessons} 堂"><div class="photo"><img src="${c.image}" alt="${esc(c.name)}" loading="lazy" width="260" height="166">${selected?'<span class="selected-mark" aria-hidden="true">✓</span>':''}</div><h3>${esc(c.name)}</h3><p class="course-price">NT$ ${money(first.price)} <small>／${first.lessons} 堂</small></p><div class="course-type"><span>${c.options.map(p=>esc(p.name)).join(' · ')}</span><b aria-hidden="true">↗</b></div></button>`;
 }).join(''):'<p class="empty-results">找不到這個樂器，試試其他名稱。</p>';
 $('courseGrid').querySelectorAll('[data-course]').forEach(b=>b.onclick=()=>openCourse(Number(b.dataset.course)));
}
function openCourse(id){
 draftCourse=courses.find(c=>c.id===id);if(!draftCourse)return;draftPlan=state.course?.id===id?state.plan:draftCourse.options[0];
 $('dialogImage').src=draftCourse.image;$('dialogImage').alt=draftCourse.name;$('dialogTitle').textContent=draftCourse.name;
 $('classOptions').innerHTML=draftCourse.options.map(p=>`<label class="class-option"><input type="radio" name="coursePlan" value="${esc(p.id)}" ${p.id===draftPlan.id?'checked':''}><span>${esc(p.name)}</span><strong>NT$ ${money(p.price)} <small>／${p.lessons} 堂</small></strong></label>`).join('');
 $('classOptions').querySelectorAll('input').forEach(i=>i.onchange=()=>{draftPlan=draftCourse.options.find(p=>p.id===i.value);planHint();});
 planHint();showDialog('courseDialog');
}
function feeNote(course,plan){
 const prices=String(plan.price).split('～');if(prices.length!==2)return '';
 if(Number(course.id)===1)return `${plan.name}每期 ${plan.lessons} 堂：部分老師收費 ${money(prices[0])} 元，部分資深老師收費 ${money(prices[1])} 元。會依你希望的時間安排老師，再告知實際學費。`;
 return '會依你希望的時間安排老師，再告知實際學費。';
}
function planHint(){
 $('priceNote').textContent=feeNote(draftCourse,draftPlan);$('priceNote').hidden=!$('priceNote').textContent;
 $('classHint').textContent=draftPlan.id==='duo'?'雙人班請自行找好同伴，教室不配對。':'';$('classHint').hidden=!$('classHint').textContent;
}
$('chooseCourse').onclick=()=>{
 const wasDuo=state.plan?.id==='duo';state.course=draftCourse;state.plan=draftPlan;
 if(wasDuo&&state.plan.id!=='duo'){ $('secondName').value=''; $('secondPhone').value=''; }
 resetConsent();closeDialog('courseDialog');renderCatalog();go(2);
};
function renderSelected(){if(!state.course)return;
 const duo=state.plan.id==='duo',note=feeNote(state.course,state.plan);
 $('selectedCourse').innerHTML=`<img src="${state.course.image}" alt="${esc(state.course.name)}"><div><h2>${esc(state.course.name)}</h2><p>${esc(state.plan.name)} · NT$ ${money(state.plan.price)}／${state.plan.lessons} 堂</p>${duo?'<p>雙人班請自行找好同伴，教室不配對。</p>':''}${note?`<p class="price-note">${esc(note)}</p>`:''}<button type="button" class="text-button" id="changeCourse">更換課程或班別</button></div>`;
 $('changeCourse').onclick=()=>go(1);
 for(const field of ['secondName','secondPhone']){ $(field+'Field').hidden=!duo; $(field).required=duo; $(field).disabled=!duo; }
 $('phoneLabel').innerHTML=(duo?'第一位上課人行動電話':'行動電話')+' <em>必填</em>';
 $('nameLabel').innerHTML=state.plan.id==='band'?'上課人姓名（請填團員姓名） <em>必填</em>' : (duo?'第一位上課人姓名':'上課人姓名')+' <em>必填</em>';
}
function updateSummary(){
 $('bottomSummary').textContent=state.course?state.course.name:'';
 $('nextButton').disabled=!state.course||(state.step===2&&!state.times.length);
 $('nextButton').textContent='確認資料，前往 LINE →';
 $('bottomBar').hidden=state.step!==2;
}
function go(step){
 if(step>1&&!state.course)return;
 if(step>=3&&!validateTime())return;
 if(step>=3&&!state.contact)return;
 document.activeElement?.blur();
 state.step=step;
 document.body.dataset.stage=step===3?'line':'';
 for(let n=1;n<=4;n++)$('step'+n).hidden=n!==step;
 document.querySelector('.progress').hidden=step===4;
 document.querySelectorAll('[data-step]').forEach(b=>{const n=Number(b.dataset.step);b.disabled=n>step;b.removeAttribute('aria-current');if(n===step)b.setAttribute('aria-current','step');});
 if(step===2){renderSelected();renderDateFields();renderSlots();renderContactFields();}
 if(step===3){renderLineSummary();renderReview();$('reviewDetails').open=false;resetConsent();}
 updateSummary();window.scrollTo({top:0,behavior:'instant'});
 const heading=$(['','courseHeading','timeHeading','confirmHeading','successHeading'][step]);heading?.focus({preventScroll:true});
}
document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>go(Number(b.dataset.step)));
$('backButton').onclick=()=>go(Math.max(1,state.step-1));
$('nextButton').onclick=()=>{if(state.step===2&&validateDetails())go(3);};
$('search').oninput=e=>{state.search=e.target.value.trim();renderCatalog();};
function slotsFor(key){
 if(dateIssue(key))return [];
 const start=[0,6].includes(dayOf(key))?600:750;
 const nowTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
 return Array.from({length:(1200-start)/30+1},(_,i)=>formatTime(start+i*30)).filter(t=>key!==todayKey()||t>nowTime);
}
function formatTime(minutes){return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
function endTime(time){const [h,m]=time.split(':').map(Number);return formatTime(h*60+m+60);}
function renderDateFields(){
 const [ty,tm]=todayKey().split('-').map(Number),selected=state.date?state.date.split('-').map(Number):[];
 const year=selected[0]||Number($('dateYear').value)||ty,month=selected[1]||Number($('dateMonth').value)||tm;
 $('dateYear').innerHTML=[ty,ty+1].map(y=>`<option value="${y}" ${y===year?'selected':''}>${y}</option>`).join('');
 renderMonthOptions(month);renderDayOptions(selected[2]||'');
}
function renderMonthOptions(preferred){
 const [ty,tm]=todayKey().split('-').map(Number),year=Number($('dateYear').value),start=year===ty?tm:1;
 const chosen=Math.max(start,Number(preferred)||start);
 $('dateMonth').innerHTML=Array.from({length:13-start},(_,i)=>{const m=start+i;return `<option value="${m}" ${m===chosen?'selected':''}>${m} 月</option>`;}).join('');
}
function renderDayOptions(preferred=''){
 const year=Number($('dateYear').value),month=Number($('dateMonth').value),total=new Date(Date.UTC(year,month,0)).getUTCDate();
 let options='<option value="">請選日期</option>';
 for(let d=1;d<=total;d++){
  const key=keyOf(year,month-1,d);
  if(key<todayKey()||dayOf(key)===1||(key===todayKey()&&!slotsFor(key).length))continue;
  options+=`<option value="${d}" ${Number(preferred)===d?'selected':''}>${d} 日（${'日一二三四五六'[dayOf(key)]}）</option>`;
 }
 $('dateDay').innerHTML=options;
}
function clearDate(){state.date='';resetConsent();$('dateError').textContent='';$('timeError').textContent='';renderSlots();renderContactFields();updateSummary();}
$('addDate').onclick=()=>{
 $('dateDay').value='';clearDate();
 $('dateDay').focus();$('dateFields').scrollIntoView({block:'center'});
};
$('dateYear').onchange=()=>{clearDate();renderMonthOptions(1);renderDayOptions();};
$('dateMonth').onchange=()=>{clearDate();renderDayOptions();};
$('dateDay').onchange=()=>{
 clearDate();if(!$('dateDay').value)return;
 state.date=keyOf(Number($('dateYear').value),Number($('dateMonth').value)-1,Number($('dateDay').value));
 const issue=dateIssue(state.date);
 if(issue==='far'){
  const message=`目前可預約未來 45 天內的課程，最晚至 ${displayDate(addDays(todayKey(),45))}。這個日期還無法安排，請接近上課日期時再報名。`;
  $('dateError').textContent=message;$('dateLimitMessage').textContent=message;showDialog('dateLimitDialog');
 }else if(issue){$('dateError').textContent=issue==='closed'?'週一公休，請選擇其他日期。':'請選擇有效的上課日期。';}
 renderSlots();updateSummary();
};
$('dateLimitDialog').addEventListener('close',()=>$('dateDay').focus());
function renderSlots(){
 $('slotTitle').textContent=state.date&&!dateIssue(state.date)?displayDate(state.date)+' · 可複選時段':'選好日期後，再選時段。';
 $('slots').innerHTML=slotsFor(state.date).map(t=>`<button type="button" data-time="${t}" aria-pressed="${state.times.includes(state.date+' '+t)}" class="${state.times.includes(state.date+' '+t)?'selected':''}">${t}–${endTime(t)}</button>`).join('');
 $('slots').querySelectorAll('[data-time]').forEach(b=>b.onclick=()=>{const key=state.date+' '+b.dataset.time;state.times=state.times.includes(key)?state.times.filter(v=>v!==key):[...state.times,key].sort();resetConsent();$('timeError').textContent='';renderSlots();renderContactFields();updateSummary();});
 const days=new Map();
 for(const key of state.times){
  const [date,time]=key.split(' ');
  if(!days.has(date))days.set(date,[]);
  days.get(date).push(time+'–'+endTime(time));
 }
 const chosen=$('chosenTimes');
 chosen.replaceChildren();
 if(days.size){
  const heading=document.createElement('strong');heading.textContent='已選 '+days.size+' 天，共 '+state.times.length+' 個時段';chosen.append(heading);
  const list=document.createElement('ul');
  for(const [date,ranges] of days){
   const item=document.createElement('li');item.textContent=displayDate(date)+'　'+ranges.join('、');list.append(item);
  }
  chosen.append(list);
 }
 $('addDate').hidden=!days.has(state.date);
}
function describeTimes(times){return times.map(key=>{const [date,time]=key.split(' ');return date.slice(5).replace('-','/')+' '+time+'–'+endTime(time);}).join('、');}
function validateTime(){
 const expired=state.times.filter(key=>{const [date,time]=key.split(' ');return dateIssue(date)||Date.parse(date+'T'+time+':00+08:00')<=Date.now();});
 if(expired.length){
  state.times=state.times.filter(key=>!expired.includes(key));
  renderSlots();renderContactFields();updateSummary();resetConsent();
  $('timeError').textContent='部分時段已過，請確認剩餘時段或重新選擇。';return false;
 }
 if(state.times.length)return true;
 $('timeError').textContent='請選擇有效的上課日期與時段。';return false;
}
function renderBookingSummary(){
 $('bookingSummary').innerHTML=`<div><strong>${esc(state.course.name)} · ${esc(state.plan.name)}</strong><p>${esc(describeTimes(state.times))}</p></div><button type="button" class="text-button" id="editTime">修改時間</button>`;
 $('editTime').onclick=()=>{$('timeHeading').focus({preventScroll:true});$('timeHeading').scrollIntoView({behavior:'smooth',block:'start'});};
}
function renderContactFields(){
 const valid=state.times.length>0;$('contactFields').hidden=!valid;
 $('trialPreference').hidden=!valid;$('preferFreeTrial').disabled=!valid;
 if(valid)renderBookingSummary();
}
$('preferFreeTrial').onchange=resetConsent;
function renderLineSummary(){
 const preferred=$('preferFreeTrial').checked;
 $('lineSummary').innerHTML=`<h3>${esc(state.course.name)}</h3><p>${esc(state.plan.name)} · ${preferred?'正式課程參考學費：':''}NT$ ${money(state.plan.price)}／${state.plan.lessons} 堂</p><p>${esc(describeTimes(state.times))}</p>${preferred?`<p>${trialStatus(true)}。${trialPendingNote}</p>`:''}`;
}
function validateDetails(){
 $('detailsError').textContent='';$('timeError').textContent='';
 if(!validateTime()){go(2);return false;}
 if(!$('detailsForm').reportValidity())return false;
 for(const id of state.plan.id==='duo'?['phone','secondPhone']:['phone']){
  if(!/^(?:09\d{8}|\+8869\d{8})$/.test($(id).value.replace(/[\s()-]/g,''))){$('detailsError').textContent='請確認'+(id==='secondPhone'?'第二位上課人的':'')+'行動電話號碼，例如 0912 345 678。';$(id).focus();return false;}
 }
 if(!$('studentName').value.trim()||(state.plan.id==='duo'&&!$('secondName').value.trim())){$('detailsError').textContent='請填寫上課人的姓名。';return false;}
 state.contact={name:$('studentName').value.trim(),secondName:state.plan.id==='duo'?$('secondName').value.trim():'',phone:$('phone').value.trim(),...(state.plan.id==='duo'?{secondPhone:$('secondPhone').value.trim()}:{}),email:$('email').value.trim(),note:$('note').value.trim()};return true;
}
$('detailsForm').onsubmit=e=>{e.preventDefault();if(validateDetails())go(3);};
$('detailsForm').oninput=resetConsent;
function renderReview(){
 const c=state.contact;
 const rows=[['希望時間',describeTimes(state.times)],['試上偏好',trialStatus($('preferFreeTrial').checked)],...(c.secondName?[['第一位上課人',c.name+' · '+c.phone],['第二位上課人',c.secondName+' · '+c.secondPhone]]:[['上課人',c.name],['行動電話',c.phone]]),['Email',c.email],...(c.note?[['其他需求',c.note]]:[])],note=feeNote(state.course,state.plan);
 $('review').className='review';$('review').innerHTML=`${note?`<p class="price-note">${esc(note)}</p>`:''}<dl>${rows.map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}
$('editDetails').onclick=()=>{go(2);if(!$('contactFields').hidden){$('detailsHeading').focus({preventScroll:true});$('contactFields').scrollIntoView({behavior:'smooth',block:'start'});}};
function syncConsent(){$('lineButton').disabled=submitBusy||!$('consent').checked;$('consentHint').textContent=submitBusy?'正在連接 LINE，請稍候…':$('consent').checked?'下一步在 LINE 確認授權。':'請先勾選同意。';}
$('consent').onchange=syncConsent;
$('privacyButton').onclick=()=>showDialog('privacyDialog');
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
function readContext(){try{const c=JSON.parse(sessionStorage.getItem(CONTEXT)||'null');if(c&&c.expiresAt>Date.now())return c;sessionStorage.removeItem(CONTEXT);}catch(e){}return null;}
function saveContext(c){try{sessionStorage.setItem(CONTEXT,JSON.stringify(c));}catch(e){throw new Error('請允許這個瀏覽器暫存表單，或改用 Safari／Chrome 開啟報名網址。');}}
async function request(action,data={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
 try{const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify({action,...data}),signal:controller.signal});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.message||'暫時無法連線，請稍後再試。');return result;}
 catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw new Error('連線暫時中斷，請確認網路後重試。');throw e;}
 finally{clearTimeout(timer);}
}
async function prepareLine(){
 if(submitBusy||!$('consent').checked||!state.contact)return null;
 if(!validateTime()){go(2);return null;}
 submitBusy=true;syncConsent();$('submitError').textContent='';
 try{
  const form={courseId:state.course.id,optionId:state.plan.id,date:state.times[0].slice(0,10),time:state.times[0].slice(11),times:state.times,...state.contact,preferFreeTrial:$('preferFreeTrial').checked};
  const previous=readContext(),same=previous?.form&&JSON.stringify({...previous.form,preferFreeTrial:previous.form.preferFreeTrial===true})===JSON.stringify(form);
  const pending={verifier:random(),submissionKey:same?previous.submissionKey:random(),form,expiresAt:Date.now()+30*60000};
  saveContext(pending);
  const result=await request('start',{form,consent:true,consentVersion:CONSENT_VERSION,challenge:await digest(pending.verifier),submissionKey:pending.submissionKey,returnUrl:location.origin+location.pathname});
  const target=new URL(result.authorizationUrl);if(target.origin!=='https://access.line.me'||target.pathname!=='/oauth2/v2.1/authorize')throw new Error('LINE 連結無效，請重新嘗試。');
  return target.href;
 }catch(e){$('submitError').textContent=e.message;return null;}
 finally{submitBusy=false;syncConsent();}
}
$('lineButton').onclick=async()=>{const url=await prepareLine();if(url){submitBusy=true;syncConsent();location.assign(url);}};
function showCompletion(r){
 state.step=4;state.contact=null;document.body.dataset.stage='';$('detailsForm').reset();$('preferFreeTrial').checked=false;$('accessPanel').hidden=true;
 for(let n=1;n<=4;n++)$('step'+n).hidden=n!==4;
 document.querySelector('.progress').hidden=true;$('bottomBar').hidden=true;
 const preferred=r.preferFreeTrial===true;
 $('successSummary').innerHTML=`<h3>${esc(r.courseName)}</h3><p>${esc(r.optionName)} · ${preferred?'正式課程參考學費：':''}NT$ ${money(r.price)}／${esc(r.lessons)} 堂</p><p>${esc(r.name+(r.secondName?'、'+r.secondName:''))}</p><p>希望時段：${esc(describeTimes(r.times||[r.date+' '+r.time]))}</p>${preferred?`<p>${trialStatus(true)}。${trialPendingNote}</p>`:''}`;
 $('addOfficialFriend').hidden = r.lineFriendFlag === true;
 $('successMessage').textContent = r.lineFriendFlag
   ? '謝謝你的報名！課程尚未排定。請開啟聊天室，按「傳送」把已填好的報名訊息傳給我們，我們會在 LINE 和你確認上課時間。'
   : '謝謝你的報名！課程尚未排定。請先加入官方 LINE 好友，再回到這裡開啟聊天室，按「傳送」把已填好的報名訊息傳給我們，方便一起確認上課時間。';
 const message = `您好，我是${r.name}，剛報名${r.courseName}（${r.optionName}），希望上課時間是${r.times?.length>5?'報名表所列的 '+r.times.length+' 個可選時段':describeTimes(r.times||[r.date+' '+r.time])}，${preferred?'想請教室優先詢問是否能安排免費試上，':'想和教室確認時段，'}謝謝！`;
 $('officialLine').href = 'https://line.me/R/oaMessage/%40046xzcpz/?' + encodeURIComponent(message);
 window.scrollTo({top:0,behavior:'instant'});$('successHeading').focus({preventScroll:true});
}
function resetForm(){Object.assign(state,{step:1,category:'全部',search:'',course:null,plan:null,date:'',times:[],contact:null});$('detailsForm').reset();$('preferFreeTrial').checked=false;$('search').value='';$('dateYear').innerHTML='';$('dateMonth').innerHTML='';$('dateDay').innerHTML='';$('dateError').textContent='';$('timeError').textContent='';$('submitError').textContent='';resetConsent();}
$('restart').onclick=async()=>{saveContext({expiresAt:Date.now()+30*60000});resetForm();await boot();};
function access(heading,message,retry=false){
 for(let n=1;n<=4;n++)$('step'+n).hidden=true;
 document.querySelector('.progress').hidden=true;$('bottomBar').hidden=true;$('accessPanel').hidden=false;
 $('accessHeading').textContent=heading;$('accessMessage').textContent=message;$('retryAccess').hidden=!retry;$('returnToForm').hidden=!retry;
}
function restoreForm(p){
 const f=p.form;if(!f)return false;
 const course=courses.find(c=>String(c.id)===String(f.courseId)),plan=course?.options.find(o=>o.id===f.optionId);if(!plan)return false;
 Object.assign(state,{course,plan,date:f.date,times:f.times||[f.date+' '+f.time],contact:{name:f.name,secondName:f.secondName,phone:f.phone,secondPhone:f.secondPhone,email:f.email,note:f.note}});
 $('preferFreeTrial').checked=f.preferFreeTrial===true;
 for(const [field,key] of Object.entries({studentName:'name',secondName:'secondName',phone:'phone',secondPhone:'secondPhone',email:'email',note:'note'}))$(field).value=f[key]||'';
 state.times=state.times.filter(key=>{const [date,time]=key.split(' ');return slotsFor(date).includes(time);});renderCatalog();go(state.times.length&&(plan.id!=='duo'||f.secondPhone)?3:2);return true;
}
async function boot(){
 access('正在載入報名表','請稍候…');
 const fragment=new URLSearchParams(location.hash.slice(1)),pending=readContext();
 const ticket=fragment.get('enrollmentTicket')||pending?.ticket,error=fragment.get('enrollmentError');
 try{
  if(ticket&&pending?.verifier){
   saveContext({...pending,ticket});history.replaceState(null,'',location.pathname+location.search);
   access('正在完成報名','LINE 授權已返回，正在確認送出結果…');
   const result=await request('redeem',{ticket,verifier:pending.verifier});
   saveContext({ticket,verifier:pending.verifier,expiresAt:Math.min(pending.expiresAt,Date.now()+9*60000)});showCompletion(result);return true;
  }
  if(ticket){history.replaceState(null,'',location.pathname+location.search);throw new Error('請回到原本填寫報名表的瀏覽器完成，或返回表單重新填寫。');}
  await request('status');
  if(location.hash)history.replaceState(null,'',location.pathname+location.search);
  $('accessPanel').hidden=true;go(1);
  const loaded=await loadCatalog();if(!loaded)return false;
  if(pending?.form){restoreForm(pending);$('submitError').textContent=error==='cancelled'?'已取消 LINE 授權，報名尚未送出。你可以修改資料或重新綁定。':error?'LINE 授權已逾時，請重新勾選同意並綁定。':'';}
  return true;
 }catch(e){access('尚未完成報名',e.message,true);return false;}
}
$('retryAccess').onclick=()=>{window.catalogReady=boot();};
$('returnToForm').onclick=()=>{const p=readContext();if(p){delete p.ticket;delete p.verifier;saveContext(p);}history.replaceState(null,'',location.pathname+location.search);window.catalogReady=boot();};
async function loadCatalog(){
  catalogLoaded=false;renderCatalog();$('nextButton').disabled=true;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch('https://asia-east1-youzi-c1b74.cloudfunctions.net/enrollmentCatalogHttp',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:'{}',signal:controller.signal});
    const data=await response.json();if(!response.ok||!data.ok||!Array.isArray(data.courses))throw new Error('catalog unavailable');
    const rows=data.courses.filter(c=>c.subjectId&&c.name&&Array.isArray(c.options)&&c.options.length);
    if(!rows.length)throw new Error('empty catalog');
    courses.splice(0,courses.length,...rows.map(c=>({...c,image:new URL(c.image,assetBase).href})));catalogLoaded=true;renderCatalog();updateSummary();return true;
  }catch(error){$('courseCount').textContent='暫時無法載入課程';$('courseGrid').innerHTML='<div class="empty-results"><p>課程清單暫時無法讀取，請重新載入後選課。</p><button type="button" class="secondary" id="retryCatalog">重新載入</button></div>';$('retryCatalog').onclick=loadCatalog;return false;}
  finally{clearTimeout(timeout);}
}
renderCatalog();updateSummary();
window.catalogReady=boot();
window.YouziEnrollment={state,slotsFor,displayDate,dateIssue,todayKey,addDays,endTime,feeNote,prepareLine,boot};
})();
