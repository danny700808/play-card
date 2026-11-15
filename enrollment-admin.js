'use strict';
(()=>{
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={received:'待聯絡',contacted:'已聯絡',admitted:'已建檔',closed:'已結案'},date=v=>new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});
let rows=[],cursor='',selected=null,busy=false;
const pendingMessages=new Map();
const random=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');};
async function call(action,data={}){
 await window.YZManagerAuth.requireManager({next:'enrollment-admin.html'});
 return (await firebase.app().functions('asia-east1').httpsCallable('enrollmentAdmin')({action,...data})).data;
}
async function act(fn,target='notice'){
 if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);$(target).textContent='處理中…';
 try{await fn();}catch(e){$(target).textContent=e.message||'目前無法處理，請稍後再試。';}
 finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if($('sendMessage'))$('sendMessage').disabled=selected?.line?.lineFriendFlag!==true;}
}
function render(){
 const q=$('search').value.trim().toLowerCase(),status=$('statusFilter').value;
 const found=rows.filter(r=>(!status||r.status===status)&&(!q||[r.form.name,r.form.secondName,r.form.phone,r.form.courseName,r.line.lineDisplayName].join(' ').toLowerCase().includes(q)));
 $('records').innerHTML=found.length?found.map(r=>'<article class="row"><div><strong>'+esc(r.form.name+(r.form.secondName?'、'+r.form.secondName:''))+'</strong> <span class="tag">'+esc(labels[r.status]||r.status)+'</span><div>'+esc(r.form.courseName+' · '+r.form.optionName)+'</div><div class="meta">'+esc(r.form.date+' '+r.form.time+'｜'+r.form.phone)+'<br>LINE：'+esc(r.line.lineDisplayName)+' · '+esc(date(r.createdAt))+'</div></div><button data-open="'+esc(r.id)+'" class="secondary">查看與聯絡</button></article>').join(''):'<p class="empty">目前沒有符合的報名。</p>';
 $('records').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>act(()=>openDetail(b.dataset.open)));
 $('more').hidden=!cursor;
}
async function load(more=false){const r=await call('list',more?{cursor}:{});rows=more?rows.concat(r.records):r.records;cursor=r.nextCursor;render();$('notice').textContent='已載入 '+rows.length+' 份完成 LINE 綁定的報名。';}
async function invitations(){
 const r=await call('invites');
 $('invites').innerHTML=r.invites.length?r.invites.map(v=>'<div class="row"><div>'+esc(v.label)+'<div class="meta">收到 '+v.usedCount+' 份 · '+(v.active&&v.expiresAt>Date.now()?'有效至 '+esc(date(v.expiresAt)):'已停用或到期')+'</div></div>'+(v.active?'<button class="secondary" data-revoke="'+esc(v.id)+'">停用</button>':'')+'</div>').join(''):'<p>尚未建立測試連結。</p>';
 $('invites').querySelectorAll('[data-revoke]').forEach(b=>b.onclick=()=>act(async()=>{await call('revokeInvite',{id:b.dataset.revoke});await invitations();$('notice').textContent='此測試連結已停用。';}));
}
async function openDetail(id){
 const data=await call('detail',{id});selected=data.record;const r=selected,f=r.form;
 $('detailTitle').textContent=f.name+(f.secondName?'、'+f.secondName:'')+'｜報名資料';$('detailNotice').textContent='';
 const field=(label,value,wide=false)=>'<div'+(wide?' class="wide"':'')+'><small>'+esc(label)+'</small>'+esc(value)+'</div>';
 const details=[field('課程／班別',f.courseName+' · '+f.optionName),field('原報名費用','NT$ '+f.price+'／'+f.lessons+' 堂'),field('希望上課時間',f.date+' '+f.time),field('電話',f.phone),field('Email',f.email),field('LINE 帳號',r.line.lineDisplayName+'（'+(r.line.lineFriendFlag?'已確認為官方 LINE 好友':'尚未確認加入好友')+'）'),field('其他需求',f.note||'無',true)].join('');
 const names=[f.name,...(f.secondName?[f.secondName]:[])],candidates=data.matches||[];
 const admission=r.studentIds?.length?'<p>已建立／連結學生資料，可到「學生與學費」選取學生安排正式課程。</p><a class="button secondary" href="portal.html#course-students">前往學生與學費</a>':names.map((name,n)=>'<label>'+esc(name)+'：確認學生資料</label><select class="admit-select" data-member="'+n+'">'+(candidates.length?'<option value="">請核對既有學生或選擇新建</option>':'')+'<option value="new">建立新學生：'+esc(name)+'</option>'+candidates.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name+'｜'+c.phone)+'（既有學生）</option>').join('')+'</select>').join('')+'<p class="meta">確認後，這次驗證的 LINE 會連結到所選學生。請先核對姓名及電話。</p><button id="admit">確認學生建檔與 LINE 綁定</button>';
 $('detailContent').innerHTML='<div class="detail-grid">'+details+'</div><h3>聯絡學生</h3><p class="meta">訊息由柚子樂器官方 LINE 發送，學生回覆可在官方 LINE 後台查看。</p><textarea id="messageText" rows="4" maxlength="2000" placeholder="輸入要傳給這位報名者的訊息"></textarea><div class="actions"><button id="sendMessage">確認發送 LINE 訊息</button><a class="button secondary" href="https://manager.line.biz/" target="_blank" rel="noopener noreferrer">開啟官方 LINE 後台</a><a class="button secondary" href="tel:'+esc(f.phone)+'">撥打電話</a></div><div id="messageHistory">'+(r.messages||[]).map(m=>'<div class="message">'+esc(m.text)+'<div class="meta">'+esc(date(m.createdAt)+' · '+m.status+(m.error?' · '+m.error:''))+'</div></div>').join('')+'</div><h3>處理紀錄</h3><label>狀態</label><select id="recordStatus">'+Object.entries(labels).map(([k,v])=>'<option value="'+k+'" '+(k===r.status?'selected ':'')+(k==='admitted'?'disabled':'')+'>'+v+'</option>').join('')+'</select><label for="managerNote">管理備註</label><textarea id="managerNote" rows="3" maxlength="2000">'+esc(r.managerNote)+'</textarea><div class="actions"><button id="saveRecord" class="secondary">儲存處理紀錄</button></div><h3>學生建檔</h3>'+admission;
 $('sendMessage').disabled=!r.line.lineFriendFlag;
 if(!r.line.lineFriendFlag)$('messageText').placeholder='尚未確認加入官方 LINE 好友，請先用電話或官方 LINE 後台聯絡。';
 $('sendMessage').onclick=()=>{const text=$('messageText').value.trim();if(!text){$('detailNotice').textContent='請先輸入訊息。';return;}if(!confirm('發送給 '+r.line.lineDisplayName+'（'+f.name+'）：\n\n'+text))return;const key=id+'|'+text,operationId=pendingMessages.get(key)||random();pendingMessages.set(key,operationId);act(async()=>{await call('message',{id,text,operationId});pendingMessages.delete(key);await openDetail(id);$('detailNotice').textContent='訊息已加入發送佇列，請重新開啟這筆資料查看發送狀態。';await load();},'detailNotice');};
 $('saveRecord').onclick=()=>act(async()=>{await call('update',{id,version:r.version,status:$('recordStatus').value,note:$('managerNote').value});await openDetail(id);await load();$('detailNotice').textContent='處理紀錄已儲存。';},'detailNotice');
 if($('admit'))$('admit').onclick=()=>{const studentIds=[...document.querySelectorAll('[data-member]')].map(s=>s.value);if(studentIds.some(v=>!v)){$('detailNotice').textContent='請先確認每位學生的建檔方式。';return;}if(!confirm('確認將 '+names.join('、')+' 與這次驗證的 LINE 帳號「'+r.line.lineDisplayName+'」連結？'))return;act(async()=>{await call('admit',{id,version:r.version,studentIds});await openDetail(id);await load();$('detailNotice').textContent='學生建檔完成，可在原本課務系統選取並排課。';},'detailNotice');};
 if(!$('detailDialog').open)$('detailDialog').showModal();
}
$('closeDetail').onclick=()=>$('detailDialog').close();
$('reload').onclick=()=>act(()=>load());$('more').onclick=()=>act(()=>load(true));$('search').oninput=render;$('statusFilter').onchange=render;
$('createInvite').onclick=()=>act(async()=>{const r=await call('createInvite',{label:$('inviteLabel').value});$('newInvite').hidden=false;$('inviteUrl').value=r.url;$('openInvite').href=r.url;await invitations();$('notice').textContent='測試連結已建立，請複製後提供給測試者。';});
$('copyInvite').onclick=async()=>{try{await navigator.clipboard.writeText($('inviteUrl').value);$('notice').textContent='已複製測試連結。';}catch(e){$('inviteUrl').select();$('notice').textContent='請長按或使用複製功能保存連結。';}};
act(async()=>{await load();await invitations();});
})();
