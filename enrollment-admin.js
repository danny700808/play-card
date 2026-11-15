'use strict';
(()=>{
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={received:'待聯絡',contacted:'已聯絡',admitted:'已建檔待排課',scheduled:'已排課',closed:'已結案'},date=v=>new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});
let rows=[],cursor='',selected=null,busy=false,scheduleController=null;
const pendingMessages=new Map();
const random=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');};
async function call(action,data={}){
 await window.YZManagerAuth.requireManager({next:'enrollment-admin.html'});
 return (await firebase.app().functions('asia-east1').httpsCallable('enrollmentAdmin',{timeout:180000})({action,...data})).data;
}
async function act(fn,target='notice'){
 if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);$(target).textContent='處理中…';
 try{await fn();}catch(e){($(target)||$('detailNotice')||$('notice')).textContent=e.message||'目前無法處理，請稍後再試。';}
 finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if($('sendMessage'))$('sendMessage').disabled=selected?.line?.lineFriendFlag!==true;scheduleController?.sync();}
}
function render(){
 const q=$('search').value.trim().toLowerCase(),status=$('statusFilter').value;
 const found=rows.filter(r=>(!status||r.status===status)&&(!q||[r.form.name,r.form.secondName,r.form.phone,r.form.courseName,r.schedule?.subjectName,r.schedule?.teacherName,r.line.lineDisplayName].join(' ').toLowerCase().includes(q)));
 $('records').innerHTML=found.length?found.map(r=>'<article class="row"><div><strong>'+esc(r.form.name+(r.form.secondName?'、'+r.form.secondName:''))+'</strong> <span class="tag">'+esc(labels[r.status]||r.status)+'</span><div>'+esc((r.schedule?.subjectName||r.form.courseName)+' · '+r.form.optionName)+'</div><div class="meta">'+esc((r.schedule?'正式：'+r.schedule.date+' '+r.schedule.time+'｜'+r.schedule.teacherName:'希望：'+r.form.date+' '+r.form.time)+'｜'+r.form.phone)+'<br>LINE：'+esc(r.line.lineDisplayName)+' · '+esc(date(r.createdAt))+'</div></div><button data-open="'+esc(r.id)+'" class="secondary">查看與聯絡</button></article>').join(''):'<p class="empty">目前沒有符合的報名。</p>';
 $('records').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>act(()=>openDetail(b.dataset.open)));
 $('more').hidden=!cursor;
}
async function load(more=false){const r=await call('list',more?{cursor}:{});rows=more?rows.concat(r.records):r.records;cursor=r.nextCursor;render();$('notice').textContent='已載入 '+rows.length+' 份完成 LINE 綁定的報名。';}
async function openDetail(id){
 const data=await call('detail',{id});selected=data.record;const r=selected,f=r.form;
 $('detailTitle').textContent=f.name+(f.secondName?'、'+f.secondName:'')+'｜報名資料';$('detailNotice').textContent='';
 const field=(label,value,wide=false)=>'<div'+(wide?' class="wide"':'')+'><small>'+esc(label)+'</small>'+esc(value)+'</div>';
 const details=[field('課程／班別',f.courseName+' · '+f.optionName),field('原報名費用','NT$ '+f.price+'／'+f.lessons+' 堂'),field('希望上課時間',f.date+' '+f.time),field('電話',f.phone),field('Email',f.email),field('LINE 帳號',r.line.lineDisplayName+'（'+(r.line.lineFriendFlag?'已確認為官方 LINE 好友':'尚未確認加入好友')+'）'),field('其他需求',f.note||'無',true)].join('');
 const names=[f.name,...(f.secondName?[f.secondName]:[])],candidates=data.matches||[];
 $('detailContent').innerHTML='<details open><summary>原報名資料與聯絡方式</summary><div class="detail-grid">'+details+'</div></details><div id="scheduleHost"><p>正在讀取正式排課選單…</p></div><h3>聯絡學生</h3><p class="meta">訊息由柚子樂器官方 LINE 發送，學生回覆可在官方 LINE 後台查看。</p><textarea id="messageText" rows="4" maxlength="2000" placeholder="輸入要傳給這位報名者的訊息"></textarea><div class="actions"><button id="sendMessage">確認發送 LINE 訊息</button><a class="button secondary" href="https://manager.line.biz/" target="_blank" rel="noopener noreferrer">開啟官方 LINE 後台</a><a class="button secondary" href="tel:'+esc(f.phone)+'">撥打電話</a></div><div id="messageHistory">'+(r.messages||[]).map(m=>'<div class="message">'+esc(m.text)+'<div class="meta">'+esc(date(m.createdAt)+' · '+m.status+(m.error?' · '+m.error:''))+'</div></div>').join('')+'</div><h3>處理紀錄</h3><label>狀態</label><select id="recordStatus">'+Object.entries(labels).map(([k,v])=>'<option value="'+k+'" '+(k===r.status?'selected ':'')+((k==='admitted'||k==='scheduled'&&!r.schedule||r.schedule&&!['scheduled','closed'].includes(k))?'disabled':'')+'>'+v+'</option>').join('')+'</select><label for="managerNote">管理備註</label><textarea id="managerNote" rows="3" maxlength="2000">'+esc(r.managerNote)+'</textarea><div class="actions"><button id="saveRecord" class="secondary">儲存處理紀錄</button></div>';
 $('sendMessage').disabled=!r.line.lineFriendFlag;
 if(!r.line.lineFriendFlag)$('messageText').placeholder='尚未確認加入官方 LINE 好友，請先用電話或官方 LINE 後台聯絡。';
 $('sendMessage').onclick=()=>{const text=$('messageText').value.trim();if(!text){$('detailNotice').textContent='請先輸入訊息。';return;}if(!confirm('發送給 '+r.line.lineDisplayName+'（'+f.name+'）：\n\n'+text))return;const key=id+'|'+text,operationId=pendingMessages.get(key)||random();pendingMessages.set(key,operationId);act(async()=>{await call('message',{id,text,operationId});pendingMessages.delete(key);await openDetail(id);$('detailNotice').textContent='訊息已加入發送佇列，請重新開啟這筆資料查看發送狀態。';await load();},'detailNotice');};
 $('saveRecord').onclick=()=>act(async()=>{await call('update',{id,version:r.version,status:$('recordStatus').value,note:$('managerNote').value});await openDetail(id);await load();$('detailNotice').textContent='處理紀錄已儲存。';},'detailNotice');
 if(!$('detailDialog').open)$('detailDialog').showModal();
 scheduleController=null;
 const mount=async()=>{const options=r.schedule?{}:await call('scheduleOptions',{id});scheduleController=window.EnrollmentSchedulingUI.mount({host:$('scheduleHost'),row:r,candidates,catalog:options.catalog,call,act,onSaved:async message=>{await openDetail(id);await load();$('detailNotice').textContent=message;}});};
 try{await mount();}catch(e){$('scheduleHost').innerHTML='<p>'+esc(e.message||'排課選單暫時無法讀取。')+'</p><button id="retryScheduleOptions" class="secondary">重新讀取排課選單</button>';$('retryScheduleOptions').onclick=()=>act(()=>openDetail(id),'detailNotice');}
}
$('closeDetail').onclick=()=>$('detailDialog').close();
$('reload').onclick=()=>act(()=>load());$('more').onclick=()=>act(()=>load(true));$('search').oninput=render;$('statusFilter').onchange=render;
$('copyRegistration').onclick=async()=>{try{await navigator.clipboard.writeText($('registrationUrl').value);$('notice').textContent='已複製報名網址。';}catch(e){$('registrationUrl').select();$('notice').textContent='請長按或使用複製功能保存網址。';}};
act(()=>load());
})();
