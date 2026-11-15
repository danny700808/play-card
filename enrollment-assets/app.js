'use strict';
(() => {
const $=id=>document.getElementById(id), courses=[];
const assetBase=new URL('.',document.currentScript?.src||new URL('app.js',location.href));
const API='https://asia-east1-youzi-c1b74.cloudfunctions.net/enrollmentPublicHttp',CONTEXT='youzi.enrollment.pending.v1',CONSENT_VERSION='enrollment-line-2026-11-15-v1';
let inviteToken='',submitBusy=false;
let catalogLoaded=false;
const state={step:1,category:'全部',search:'',course:null,plan:null,date:'',time:'',contact:null};
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
 if(wasDuo&&state.plan.id!=='duo')$('secondName').value='';
 resetConsent();closeDialog('courseDialog');renderCatalog();go(2);
};
function renderSelected(){if(!state.course)return;
 const note=feeNote(state.course,state.plan);
 $('selectedCourse').innerHTML=`<img src="${state.course.image}" alt="${esc(state.course.name)}"><div><h2>${esc(state.course.name)}</h2><p>${esc(state.plan.name)} · NT$ ${money(state.plan.price)}／${state.plan.lessons} 堂</p>${note?`<p class="price-note">${esc(note)}</p>`:''}<button type="button" class="text-button" id="changeCourse">更換課程或班別</button></div>`;
 $('changeCourse').onclick=()=>go(1);
 $('secondNameField').hidden=state.plan.id!=='duo';$('secondName').required=state.plan.id==='duo';
 $('nameLabel').innerHTML=state.plan.id==='band'?'上課人姓名（請填團員姓名） <em>必填</em>':'上課人姓名 <em>必填</em>';
}
function updateSummary(){
 $('bottomSummary').textContent=state.course?state.course.name:'';
 $('nextButton').disabled=!state.course||(state.step===2&&!slotsFor(state.date).includes(state.time));
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
function clearDate(){state.date='';state.time='';resetConsent();$('dateError').textContent='';$('timeError').textContent='';renderSlots();renderContactFields();updateSummary();}
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
 $('slotTitle').textContent=state.date&&!dateIssue(state.date)?displayDate(state.date)+' · 選擇時段':'選好日期後，再選時段。';
 $('slots').innerHTML=slotsFor(state.date).map(t=>`<button type="button" data-time="${t}" aria-pressed="${state.time===t}" class="${state.time===t?'selected':''}">${t}–${endTime(t)}</button>`).join('');
 $('slots').querySelectorAll('[data-time]').forEach(b=>b.onclick=()=>{state.time=b.dataset.time;resetConsent();$('timeError').textContent='';renderSlots();renderContactFields();updateSummary();$('detailsHeading').focus({preventScroll:true});$('contactFields').scrollIntoView({behavior:'smooth',block:'start'});});
}
function validateTime(){
 if(slotsFor(state.date).includes(state.time))return true;
 $('timeError').textContent='請選擇有效的上課日期與時段。';return false;
}
function renderBookingSummary(){
 $('bookingSummary').innerHTML=`<div><strong>${esc(state.course.name)} · ${esc(state.plan.name)}</strong><p>${displayDate(state.date)} ${state.time}–${endTime(state.time)}</p></div><button type="button" class="text-button" id="editTime">修改時間</button>`;
 $('editTime').onclick=()=>{$('timeHeading').focus({preventScroll:true});$('timeHeading').scrollIntoView({behavior:'smooth',block:'start'});};
}
function renderContactFields(){
 const valid=slotsFor(state.date).includes(state.time);$('contactFields').hidden=!valid;
 if(valid)renderBookingSummary();
}
function renderLineSummary(){
 $('lineSummary').innerHTML=`<h3>${esc(state.course.name)}</h3><p>${esc(state.plan.name)} · NT$ ${money(state.plan.price)}／${state.plan.lessons} 堂</p><p>${displayDate(state.date)} ${state.time}–${endTime(state.time)}</p>`;
}
function validateDetails(){
 $('detailsError').textContent='';$('timeError').textContent='';
 if(!validateTime()){go(2);return false;}
 if(!$('detailsForm').reportValidity())return false;
 const phone=$('phone').value.replace(/[\s()-]/g,'');
 if(!/^(?:09\d{8}|\+8869\d{8})$/.test(phone)){$('detailsError').textContent='請確認手機號碼，例如 0912 345 678。';$('phone').focus();return false;}
 if(!$('studentName').value.trim()||(state.plan.id==='duo'&&!$('secondName').value.trim())){$('detailsError').textContent='請填寫上課人的姓名。';return false;}
 state.contact={name:$('studentName').value.trim(),secondName:state.plan.id==='duo'?$('secondName').value.trim():'',phone:$('phone').value.trim(),email:$('email').value.trim(),note:$('note').value.trim()};return true;
}
$('detailsForm').onsubmit=e=>{e.preventDefault();if(validateDetails())go(3);};
$('detailsForm').oninput=resetConsent;
function renderReview(){
 const c=state.contact;
 const rows=[['希望時間',displayDate(state.date)+' '+state.time+'–'+endTime(state.time)],['上課人',c.name+(c.secondName?'、'+c.secondName:'')],['聯絡手機',c.phone],['Email',c.email],...(c.note?[['其他需求',c.note]]:[])],note=feeNote(state.course,state.plan);
 $('review').className='review';$('review').innerHTML=`${note?`<p class="price-note">${esc(note)}</p>`:''}<dl>${rows.map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}
$('editDetails').onclick=()=>{go(2);if(!$('contactFields').hidden){$('detailsHeading').focus({preventScroll:true});$('contactFields').scrollIntoView({behavior:'smooth',block:'start'});}};
function syncConsent(){$('lineButton').disabled=submitBusy||!$('consent').checked;$('consentHint').textContent=submitBusy?'正在連接 LINE，請稍候…':$('consent').checked?'下一步在 LINE 確認授權。':'請先勾選同意。';}
$('consent').onchange=syncConsent;
$('privacyButton').onclick=()=>showDialog('privacyDialog');
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
function readContext(){try{const c=JSON.parse(sessionStorage.getItem(CONTEXT)||'null');if(c&&c.expiresAt>Date.now())return c;sessionStorage.removeItem(CONTEXT);}catch(e){}return null;}
function saveContext(c){try{sessionStorage.setItem(CONTEXT,JSON.stringify(c));}catch(e){throw new Error('請允許這個瀏覽器暫存表單，或改用 Safari／Chrome 開啟原邀請連結。');}}
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
  const form={courseId:state.course.id,optionId:state.plan.id,date:state.date,time:state.time,...state.contact};
  const previous=readContext(),same=previous?.form&&JSON.stringify(previous.form)===JSON.stringify(form)&&previous.invite===inviteToken;
  const pending={invite:inviteToken,verifier:random(),submissionKey:same?previous.submissionKey:random(),form,expiresAt:Date.now()+30*60000};
  saveContext(pending);
  const result=await request('start',{invite:inviteToken,form,consent:true,consentVersion:CONSENT_VERSION,challenge:await digest(pending.verifier),submissionKey:pending.submissionKey,returnUrl:location.origin+location.pathname});
  const target=new URL(result.authorizationUrl);if(target.origin!=='https://access.line.me'||target.pathname!=='/oauth2/v2.1/authorize')throw new Error('LINE 連結無效，請重新嘗試。');
  return target.href;
 }catch(e){$('submitError').textContent=e.message;return null;}
 finally{submitBusy=false;syncConsent();}
}
$('lineButton').onclick=async()=>{const url=await prepareLine();if(url){submitBusy=true;syncConsent();location.assign(url);}};
function showCompletion(r){
 state.step=4;state.contact=null;document.body.dataset.stage='';$('detailsForm').reset();$('accessPanel').hidden=true;
 for(let n=1;n<=4;n++)$('step'+n).hidden=n!==4;
 document.querySelector('.progress').hidden=true;$('bottomBar').hidden=true;
 $('successSummary').innerHTML=`<h3>${esc(r.courseName)}</h3><p>${esc(r.optionName)} · NT$ ${money(r.price)}／${esc(r.lessons)} 堂</p><p>${esc(r.name+(r.secondName?'、'+r.secondName:''))}</p><p>${displayDate(r.date)} ${esc(r.time)}–${endTime(r.time)}</p><p class="fine">報名編號：${esc(r.receiptId)}</p>`;
 $('successMessage').textContent=r.lineFriendFlag?'教室已收到資料，會透過 LINE 與你確認老師、時間及學費。':'教室已收到資料。請再點下方按鈕加入官方 LINE 好友，方便教室聯絡你。';
 $('officialLine').href='https://lin.ee/Fx5Y2mL';window.scrollTo({top:0,behavior:'instant'});$('successHeading').focus({preventScroll:true});
}
function resetForm(){Object.assign(state,{step:1,category:'全部',search:'',course:null,plan:null,date:'',time:'',contact:null});$('detailsForm').reset();$('search').value='';$('dateYear').innerHTML='';$('dateMonth').innerHTML='';$('dateDay').innerHTML='';$('dateError').textContent='';$('timeError').textContent='';$('submitError').textContent='';resetConsent();}
$('restart').onclick=async()=>{saveContext({invite:inviteToken,expiresAt:Date.now()+14*86400000});resetForm();await boot();};
function access(heading,message,retry=false){
 for(let n=1;n<=4;n++)$('step'+n).hidden=true;
 document.querySelector('.progress').hidden=true;$('bottomBar').hidden=true;$('accessPanel').hidden=false;
 $('accessHeading').textContent=heading;$('accessMessage').textContent=message;$('retryAccess').hidden=!retry;$('returnToForm').hidden=!retry||!readContext()?.invite;
}
function restoreForm(p){
 const f=p.form;if(!f)return false;
 const course=courses.find(c=>String(c.id)===String(f.courseId)),plan=course?.options.find(o=>o.id===f.optionId);if(!plan)return false;
 Object.assign(state,{course,plan,date:f.date,time:f.time,contact:{name:f.name,secondName:f.secondName,phone:f.phone,email:f.email,note:f.note}});
 for(const [field,key] of Object.entries({studentName:'name',secondName:'secondName',phone:'phone',email:'email',note:'note'}))$(field).value=f[key]||'';
 renderCatalog();go(slotsFor(f.date).includes(f.time)?3:2);return true;
}
async function boot(){
 access('正在確認報名連結','請稍候…');
 const fragment=new URLSearchParams(location.hash.slice(1));let pending=readContext();
 const incoming=fragment.get('invite');
 if(incoming){pending=pending?.invite===incoming?pending:{invite:incoming,expiresAt:Date.now()+14*86400000};}
 inviteToken=incoming||pending?.invite||'';
 const ticket=fragment.get('enrollmentTicket')||pending?.ticket,error=fragment.get('enrollmentError');
 try{
  if(ticket&&pending?.verifier){
   saveContext({...pending,ticket});history.replaceState(null,'',location.pathname+location.search);
   access('正在完成報名','LINE 授權已返回，正在確認送出結果…');
   const result=await request('redeem',{ticket,verifier:pending.verifier});
   saveContext({invite:inviteToken,ticket,verifier:pending.verifier,expiresAt:Math.min(pending.expiresAt,Date.now()+9*60000)});showCompletion(result);return true;
  }
  if(ticket){history.replaceState(null,'',location.pathname+location.search);throw new Error('請回到原本填寫報名表的瀏覽器完成，或重新開啟教室提供的邀請連結。');}
  if(!inviteToken){access('目前採邀請測試','請使用教室提供的報名連結。');return false;}
  await request('inviteStatus',{invite:inviteToken});saveContext(pending||{invite:inviteToken,expiresAt:Date.now()+14*86400000});
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
