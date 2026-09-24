/* Private calendar: all data and attachments go through owner-checked Functions. */
(()=>{'use strict';
 const $=id=>document.getElementById(id),S={month:new Date(),events:[],calendars:[],status:{},current:null,pending:[],urls:[],recorder:null,stream:null,saving:false};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const local=d=>{const date=new Date(d);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);};
 const stamp=d=>new Date(d).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
 let call;
 async function api(action,data={}){if(!call)throw Error('請先登入自己的管理者帳號。');return (await call({action,...data})).data;}
 function message(msg,error=false){$('status').textContent=msg;$('status').classList.toggle('error',error);}
 async function safely(fn,target='status'){try{await fn();}catch(e){if(target==='status')message(e.message,true);else $(target).textContent=e.message;}}
 function range(){return {start:new Date(S.month.getFullYear(),S.month.getMonth(),-6).toISOString(),end:new Date(S.month.getFullYear(),S.month.getMonth()+1,8).toISOString()};}
 async function refresh(){
  message('正在讀取行程…');S.status=await api('status');
  S.calendars=S.status.googleConnected?(await api('calendars')).calendars:[];
  const result=await api('list',range());S.events=result.events;render();
  $('connection').textContent=(S.status.googleConnected?'Google 已連接 · '+S.status.googleEmail:'Google 尚未連接 · 現在可先建立私人行程')+'　｜　'+(S.status.lineEnabled?'LINE 提醒已啟用':'LINE 提醒尚未啟用');
  message(result.warnings?.length?result.warnings.join('；'):'已更新。時間以台灣時間顯示；LINE 提醒需在個別行程勾選。',!!result.warnings?.length);settingsRender();
 }
 function render(){
  const y=S.month.getFullYear(),m=S.month.getMonth();$('monthTitle').textContent=y+' 年 '+(m+1)+' 月';
  $('legend').innerHTML='<span><i class="dot"></i>私人行事曆</span>'+S.calendars.filter(c=>S.status.calendarIds.includes(c.id)).map(c=>'<span><i class="dot" style="background:'+(/^#[0-9a-f]{6}$/i.test(c.color)?c.color:'#6f70a9')+'"></i>'+esc(c.summary)+(c.accessRole==='reader'?' · 唯讀':'')+'</span>').join('');
  let html=['一','二','三','四','五','六','日'].map(d=>'<div class="weekday">'+d+'</div>').join('');
  const first=new Date(y,m,1),offset=(first.getDay()+6)%7;
  for(let i=0;i<42;i++){const d=new Date(y,m,1-offset+i),next=new Date(y,m,2-offset+i),today=d.toDateString()===new Date().toDateString();
   const dayEvents=S.events.filter(e=>new Date(e.start)<next&&new Date(e.end)>d);
   html+='<div class="day '+(d.getMonth()!==m?'outside':'')+'"><div class="dayHead"><span class="'+(today?'todayNumber':'')+'">'+d.getDate()+'</span><button data-date="'+local(new Date(d.setHours(9))).slice(0,10)+'" aria-label="新增 '+(m+1)+' 月 '+d.getDate()+' 日行程">＋</button></div>'+dayEvents.map(e=>'<button class="event '+(e.source==='google'?'shared ':'')+(e.completed?'done':'')+'" data-event="'+esc(e.id)+'">'+(e.allDay?'全天':new Date(e.start).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false}))+' '+esc(e.title)+(e.remind?' 🔔':'')+'</button>').join('')+'</div>';
  }
  $('calendar').innerHTML=html;
  const rows=S.events.filter(e=>new Date(e.start).getMonth()===m&&new Date(e.start).getFullYear()===y);
  $('agenda').innerHTML=rows.length?rows.map(e=>'<div class="agendaItem"><time>'+esc(stamp(e.start))+'</time><button data-event="'+esc(e.id)+'">'+esc(e.title)+'<small> · '+esc(e.calendarName||'私人行事曆')+(e.completed?' · 已完成':'')+'</small></button></div>').join(''):'<p>這個月還沒有行程。按「新增行程」開始記事。</p>';
 }
 function cleanup(){S.urls.forEach(URL.revokeObjectURL);S.urls=[];if(S.recorder?.state==='recording')S.recorder.stop();S.stream?.getTracks().forEach(t=>t.stop());clearTimeout(S.recordTimer);S.recorder=null;S.stream=null;}
 function showEditor(row,date){
  cleanup();S.current=row?{...row}:null;S.pending=[];$('eventForm').reset();$('formStatus').textContent='';$('recordStatus').textContent='';$('record').textContent='● 開始錄音';
  const start=row?.start||date+'T09:00:00';$('title').value=row?.title||'';$('start').value=local(start);$('end').value=local(row?.end||new Date(new Date(start).getTime()+3600000));$('note').value=row?.note||'';$('remind').checked=!!row?.remind;$('minutes').value=row?.reminderMinutes??10;$('completed').checked=!!row?.completed;
  const readonly=row?.source==='google'&&(!row.editable||row.allDay);
  ['title','start','end'].forEach(id=>$(id).disabled=readonly);
  $('editorTitle').textContent=row?'行程與私人記事':'新增行程';$('sourceInfo').textContent=row?.source==='google'?row.calendarName+' · '+(readonly?'原行程唯讀；仍可加入自己的記事與提醒。':'時間與標題會同步回 Google；私人內容只存本系統。'):'私人行程只有你看得到。';
  $('destination').innerHTML='<option value="local">私人行事曆</option>'+S.calendars.filter(c=>['owner','writer'].includes(c.accessRole)).map(c=>'<option value="'+esc(c.id)+'">Google · '+esc(c.summary)+'</option>').join('');$('destinationLabel').hidden=!!row;
  $('googleLink').hidden=!row?.htmlLink;if(row?.htmlLink&&/^https:\/\/(www\.)?google\.com\/calendar|^https:\/\/calendar\.google\.com\//.test(row.htmlLink))$('googleLink').href=row.htmlLink;
  $('archive').hidden=!row||row.source!=='local';$('assets').replaceChildren();assetsRender();$('editor').showModal();
 }
 function assetNode(file,pending=false){const div=document.createElement('div');div.className='asset';const small=document.createElement('small');small.textContent=file.name+(pending?' · 等待儲存':'');div.append(small);return div;}
 async function assetsRender(){
  $('assets').replaceChildren();
  for(const file of S.current?.assets||[]){const div=assetNode(file),button=document.createElement('button');button.type='button';button.textContent=file.mime.startsWith('image/')?'查看圖片':'載入錄音';button.onclick=()=>safely(async()=>{button.disabled=true;const id=S.current.id;const data=await api('asset',{id,assetId:file.id});const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:data.mime}));S.urls.push(url);const media=document.createElement(data.mime.startsWith('image/')?'img':'audio');media.src=url;if(media.tagName==='AUDIO')media.controls=true;else media.alt=file.name;div.append(media);button.remove();},'formStatus');div.append(button);$('assets').append(div);}
  for(const file of S.pending){const div=assetNode(file,true),url=URL.createObjectURL(file);S.urls.push(url);const media=document.createElement(file.type.startsWith('image/')?'img':'audio');media.src=url;if(media.tagName==='AUDIO')media.controls=true;else media.alt=file.name;const remove=document.createElement('button');remove.type='button';remove.textContent='移除待上傳附件';remove.onclick=()=>{S.pending=S.pending.filter(x=>x!==file);assetsRender();};div.append(media,remove);$('assets').append(div);}
 }
 function addFiles(files){for(const f of files){if(f.size>5*1024*1024){$('formStatus').textContent='附件 '+f.name+' 超過 5 MB，未加入。';continue;}if((S.current?.assets?.length||0)+S.pending.length>=12){$('formStatus').textContent='每則記事最多 12 個附件。';break;}S.pending.push(f);}assetsRender();}
 $('files').onchange=e=>{addFiles([...e.target.files]);e.target.value='';};
 $('editor').addEventListener('paste',e=>{const images=[...e.clipboardData.items].filter(x=>x.kind==='file'&&x.type.startsWith('image/')).map(x=>x.getAsFile());if(images.length){e.preventDefault();addFiles(images);}});
 $('record').onclick=()=>safely(async()=>{
  if(S.recorder?.state==='recording'){S.recorder.stop();return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('此瀏覽器不支援錄音，請改用手機錄好後上傳音檔。');
  S.stream=await navigator.mediaDevices.getUserMedia({audio:true});const type=['audio/webm','audio/mp4','audio/ogg'].find(t=>MediaRecorder.isTypeSupported(t));if(!type){S.stream.getTracks().forEach(t=>t.stop());throw Error('此瀏覽器的錄音格式尚不支援，請上傳音檔。');}
  const chunks=[],rec=new MediaRecorder(S.stream,{mimeType:type,audioBitsPerSecond:64000});S.recorder=rec;rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.onstop=()=>{S.stream?.getTracks().forEach(t=>t.stop());clearTimeout(S.recordTimer);if($('editor').open)addFiles([new File(chunks,'錄音-'+new Date().toISOString().slice(0,19).replace(/:/g,'-')+'.'+(type==='audio/mp4'?'m4a':type.split('/')[1]),{type})]);$('record').textContent='● 開始錄音';$('recordStatus').textContent='錄音已停止，按儲存後才會上傳。';};rec.start();$('record').textContent='■ 停止錄音';$('recordStatus').textContent='錄音中…最長 60 秒。';S.recordTimer=setTimeout(()=>{if(rec.state==='recording')rec.stop();},60000);
 },'formStatus');
 const base64=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
 $('eventForm').onsubmit=e=>{e.preventDefault();if(S.saving)return;safely(async()=>{
  if(S.recorder?.state==='recording')throw Error('請先停止錄音，再儲存。');
  S.saving=true;$('save').disabled=true;$('formStatus').textContent='正在儲存…';
  try{
   const event={title:$('title').value,start:new Date($('start').value).toISOString(),end:new Date($('end').value).toISOString(),note:$('note').value,remind:$('remind').checked,reminderMinutes:Number($('minutes').value),completed:$('completed').checked,source:S.current?.source||'local',calendarId:S.current?.calendarId||'',googleId:S.current?.googleId||''};
   const c=S.current,googleCreate=!c&&$('destination').value!=='local',googleEdit=c?.source==='google'&&c.editable&&!c.allDay&&(event.title!==c.title||Date.parse(event.start)!==Date.parse(c.start)||Date.parse(event.end)!==Date.parse(c.end));
   if(googleCreate||googleEdit){const result=await api('googleWrite',{calendarId:c?.calendarId||$('destination').value,googleId:c?.googleId,etag:c?.etag,event});S.current={...result.event,revision:c?.revision||0,assets:c?.assets||[]};Object.assign(event,{source:'google',googleId:S.current.googleId,calendarId:S.current.calendarId});}
   const result=await api('save',{id:S.current?.id,revision:S.current?.revision||0,event});S.current={...S.current,...event,id:result.id,revision:(S.current?.revision||0)+1,assets:S.current?.assets||[]};
   while(S.pending.length){const f=S.pending[0];const upload=await api('upload',{id:result.id,mime:f.type,name:f.name,base64:await base64(f)});S.current.assets.push(upload.asset);S.current.revision++;S.pending.shift();}
   $('editor').close();cleanup();await refresh();message('已儲存。'+(event.remind&&!S.status.lineEnabled?'LINE 尚未啟用，請到連線設定完成綁定。':''));
  }finally{S.saving=false;$('save').disabled=false;}
 },'formStatus');};
 $('archive').onclick=()=>safely(async()=>{await api('archive',{id:S.current.id});$('editor').close();cleanup();await refresh();},'formStatus');
 function settingsRender(){const s=S.status;$('googleStatus').textContent=s.googleConnected?'已連接 '+s.googleEmail:s.googleConfigured?'已設定 Google 串接，請按連接完成帳號授權。':'Google 串接程式已就緒，尚需完成下方的首次 OAuth 設定。';$('connectGoogle').textContent=s.googleConnected?'重新授權 Google':'連接 Google 行事曆';$('disconnectGoogle').hidden=!s.googleConnected;$('callback').value=s.callback||'';$('oauthSetup').open=!s.googleConfigured;
  $('calendarChoices').innerHTML=S.calendars.map(c=>'<label class="check"><input type="checkbox" value="'+esc(c.id)+'" '+(s.calendarIds.includes(c.id)?'checked':'')+'>'+esc(c.summary)+' · '+(['owner','writer'].includes(c.accessRole)?'可編輯':'唯讀')+'</label>').join('');$('saveCalendars').hidden=!s.googleConnected;
  $('lineTarget').innerHTML=s.targets?.length?s.targets.map(t=>'<option value="'+esc(t.key)+'">'+esc(t.name)+' ('+esc(t.masked)+')</option>').join(''):'<option value="">尚未找到自己的 LINE 綁定</option>';if(s.targetKey)$('lineTarget').value=s.targetKey;$('lineEnabled').checked=!!s.lineEnabled;
  $('lineStatus').textContent=s.lastReminderError||(!s.lineConfigured?'官方 LINE 發送設定尚未完成。':s.lastSentAt?'上次通知已送交 LINE：'+stamp(s.lastSentAt):'尚未發送提醒。測試按鈕會實際傳送一則訊息。');
 }
 $('settingsButton').onclick=()=>{$('settingsStatus').textContent='';settingsRender();$('settings').showModal();};
 $('connectGoogle').onclick=()=>safely(async()=>{const r=await api('connect');location.assign(r.url);},'settingsStatus');
 $('disconnectGoogle').onclick=()=>safely(async()=>{await api('disconnect');await refresh();$('settingsStatus').textContent='已中斷持續同步；Google 原始行程沒有刪除。';},'settingsStatus');
 $('saveOAuth').onclick=()=>safely(async()=>{await api('configureGoogle',{clientId:$('clientId').value,clientSecret:$('clientSecret').value});$('clientSecret').value='';await refresh();$('settingsStatus').textContent='已儲存。請按「連接 Google 行事曆」完成授權。';},'settingsStatus');
 $('saveCalendars').onclick=()=>safely(async()=>{await api('settings',{calendarIds:[...$('calendarChoices').querySelectorAll('input:checked')].map(x=>x.value)});await refresh();$('settingsStatus').textContent='已更新要顯示的行事曆。';},'settingsStatus');
 $('saveLine').onclick=()=>safely(async()=>{await api('settings',{lineEnabled:$('lineEnabled').checked,targetKey:$('lineTarget').value});await refresh();$('settingsStatus').textContent='已儲存 LINE 提醒設定。';},'settingsStatus');
 $('testLine').onclick=()=>safely(async()=>{await api('testLine',{targetKey:$('lineTarget').value});$('settingsStatus').textContent='測試訊息已送交 LINE，請查看個人 LINE。';},'settingsStatus');
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{if(S.saving)return;$(b.dataset.close).close();if(b.dataset.close==='editor')cleanup();});$('editor').addEventListener('cancel',e=>{if(S.saving)e.preventDefault();else cleanup();});
 for(const id of ['calendar','agenda'])$(id).onclick=e=>{const b=e.target.closest('button');if(b?.dataset.event)showEditor(S.events.find(x=>x.id===b.dataset.event));if(b?.dataset.date)showEditor(null,b.dataset.date);};
 $('newButton').onclick=()=>showEditor(null,local(new Date()).slice(0,10));
 for(const [id,n] of [['previous',-1],['next',1]])$(id).onclick=()=>safely(async()=>{S.month=new Date(S.month.getFullYear(),S.month.getMonth()+n,1);await refresh();});
 $('today').onclick=()=>safely(async()=>{S.month=new Date();await refresh();});$('refresh').onclick=()=>safely(refresh);
 $('monthView').onclick=()=>{$('calendar').hidden=false;$('agenda').hidden=true;$('monthView').setAttribute('aria-pressed','true');$('listView').setAttribute('aria-pressed','false');};$('listView').onclick=()=>{$('calendar').hidden=true;$('agenda').hidden=false;$('monthView').setAttribute('aria-pressed','false');$('listView').setAttribute('aria-pressed','true');};
 firebase.initializeApp(APP_CONFIG.FIREBASE_CONFIG);
 firebase.auth().onAuthStateChanged(user=>safely(async()=>{
  if(!user){message('請先登入主系統，再回來開啟私人行事曆。');$('connection').innerHTML='<a href="login.html?next=private-calendar.html">前往登入</a>';return;}
  if(user.email?.toLowerCase()!=='danny700808@gmail.com')throw Error('這個試用版只開放你的管理者帳號。');
  call=firebase.app().functions('asia-east1').httpsCallable('privateCalendarApi',{timeout:120000});await refresh();$('newButton').disabled=false;
  const id=new URLSearchParams(location.search).get('event');if(id){let row=S.events.find(e=>e.id===id);if(!row){const detail=await api('detail',{id});row=detail.event;}if(row)showEditor(row);}
 }));
})();
